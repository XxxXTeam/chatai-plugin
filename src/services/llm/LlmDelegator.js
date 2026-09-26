/**
 * @fileoverview LLM 请求委托器
 * @module services/llm/LlmDelegator
 * @description 完整的 LLM 发送执行器（完全委托模式的核心）。
 *
 * 调用方（对话/Agent/旁路）只负责组装 userMessage 与 requestOptions 模板；
 * 渠道管理、Key 轮换、渠道切换、模型切换、错误分类、退避与审计追踪全部由
 * 本委托器接管，不再各自内联重试实现。
 *
 * 语义基线（与 ChatService 原重试循环同口径，配置以 llm.fallback 为准）：
 * 1. 模型 → 渠道 → Key 三级迭代；备选模型只在主模型所有渠道耗尽后启用；
 * 2. 候选渠道全程做模型过滤（models 包含 / 通配符 `*` / 模型映射目标），
 *    不支持该模型的渠道一律不参与，避免向渠道发出它没有的模型请求；
 * 3. 空响应独立预算 emptyRetries；重试/切换不重复计费：已试 Key 与已试渠道
 *    集合共同防循环，Key 切换独立预算 maxKeySwitches = max(2, maxRetries*2)；
 * 4. 错误分类与可重试白名单与 BackoffPolicy 同口径（403 不归 auth、client/unknown
 *    不触发切换）；同一请求内同一渠道只累加一次渠道级 errorCount；
 * 5. 空文本响应重试耗尽后按成功收场（保留原 ChatService 语义）；
 * 6. lockChannel（渠道健康检查/连通性测试专用）：锁定初始渠道，跳过渠道模型过滤
 *    检查、禁止渠道切换、忽略备选模型，仅在该渠道内按重试预算重试，避免测到别的渠道。
 */

import { chatLogger } from '../../core/utils/logger.js'
import { LlmService } from './LlmService.js'
import { channelManager } from './ChannelManager.js'
import { computeDelay, classifyRetryError, expectRetryable, pickChannelRetryPolicy } from './BackoffPolicy.js'
import { PromptCacheService } from './PromptCacheService.js'
import config from '../../../config/config.js'

const logger = chatLogger

/** 模型不匹配专用错误标识：与普通 API 错误区分，不重试直接换渠道 */
const MODEL_MISMATCH = 'LLM_DELEGATOR_MODEL_MISMATCH'

/**
 * 判断渠道是否支持指定模型。
 * 口径与 getBestChannel / getAvailableChannels 的 models 匹配一致（包含或通配符 `*`）；
 * 此外透传模型映射目标：若渠道对源模型存在映射，且映射目标在渠道 models 内，也视为支持。
 *
 * @param {Object|null} channel - 渠道对象（可能为 null）
 * @param {string} model - 目标模型名称
 * @returns {boolean} 渠道是否支持该模型
 */
export function channelSupportsModel(channel, model) {
    if (!channel || !model) return false
    const models = channel.models
    if (Array.isArray(models)) {
        const list = models.map(m => String(m).trim()).filter(Boolean)
        if (list.includes(model) || list.includes('*')) return true
    }
    const mappingKeys = Object.keys(channel.overrides?.modelMapping || {})
    if (mappingKeys.length > 0) {
        const resolved = channelManager.getActualModel(channel.id, model)
        if (resolved.mapped && resolved.actualModel && resolved.actualModel !== model) {
            return channelSupportsModel(channel, resolved.actualModel)
        }
    }
    return false
}

/**
 * 从渠道构造发送客户端。
 * 客户端选项统一由渠道对象生成；baseOptions 只补充非渠道字段
 * （tools/event/preset/thinking/toolChoice 等）。
 *
 * @param {Object} channel - 渠道对象
 * @param {Object} [baseOptions] - 基底客户端选项（不含渠道字段）
 * @param {Object} [requestMeta] - 请求元信息 { model }
 * @returns {Promise<{client: Object|null, keyIndex: number}>}
 */
export async function buildClientForChannel(channel, baseOptions = {}, requestMeta = {}) {
    try {
        const keyInfo = channelManager.getChannelKey(channel)
        const clientOptions = {
            ...baseOptions,
            apiKey: keyInfo.key,
            keyIndex: keyInfo.keyIndex,
            baseUrl: channelManager.getCurrentBaseUrl(channel.id) || channel.baseUrl,
            chatPath: channel.chatPath || '',
            modelsPath: channel.modelsPath || '',
            responsePath: channel.responsePath || channel.endpoints?.responses || '',
            endpoints: channel.endpoints || {},
            apiInterface: channel.apiInterface || channel.openaiApiInterface || 'chat',
            openaiApiInterface: channel.apiInterface || channel.openaiApiInterface || 'chat',
            experimental: channel.experimental || {},
            openaiResponses: channel.openaiResponses || {},
            customHeaders: channel.customHeaders || {},
            headersTemplate: channel.headersTemplate || '',
            requestBodyTemplate: channel.requestBodyTemplate || '',
            systemPromptConfig: channel.systemPromptConfig || null,
            channelId: channel.id,
            channelName: channel.name,
            features: ['chat'],
            tools: [],
            imageConfig: channel.imageConfig || {},
            ...(channel.timeout ? { timeout: channel.timeout } : {}),
            ...(channel.userAgent ? { userAgent: channel.userAgent } : {}),
            ...(channel.xff ? { xff: channel.xff } : {})
        }
        const mapped = channelManager.getActualModel(channel.id, requestMeta.model)
        if (mapped.actualModel) {
            clientOptions.model = mapped.actualModel
        }
        const client = await LlmService.createClient({
            ...clientOptions,
            adapterType: channel.adapterType,
            enableTools: baseOptions.enableTools !== false && !!baseOptions.preSelectedTools?.length
        })
        return { client, keyIndex: keyInfo.keyIndex }
    } catch (error) {
        logger.debug(`[LlmDelegator] 构造渠道客户端失败: ${channel?.name}, ${error.message}`)
        return { client: null, keyIndex: -1 }
    }
}

/**
 * 从渠道模型映射解析实际请求模型。
 *
 * @param {Object|null} channel - 渠道对象
 * @param {string} model - 请求模型名称
 * @returns {string} 实际请求模型
 */
export function resolveActualModel(channel, model) {
    return channel ? channelManager.getActualModel(channel.id, model).actualModel || model : model
}

/**
 * 判断响应是否含可用内容（内容块或工具调用日志）。
 *
 * @param {Object|null} response - 客户端响应
 * @returns {boolean} 是否可用
 */
function isUsableResponse(response) {
    return Boolean(response?.contents?.length > 0 || response?.toolCallLogs?.length > 0)
}

/**
 * 判断响应是否含非空文本。
 *
 * @param {Object|null} response - 客户端响应
 * @returns {boolean} 是否含非空文本
 */
function hasTextContent(response) {
    return Boolean(response?.contents?.some(c => c.type === 'text' && c.text?.trim()))
}

/**
 * LLM 委托请求核心。
 *
 * @param {Object} params - 委托参数
 * @param {Object} params.userMessage - 用户消息（内部格式 { role, content }）
 * @param {Object|null} [params.initialChannel] - 初始渠道对象（调用方已选定）
 * @param {Object|null} [params.initialClient] - 初始客户端（可选，避免首轮重建）
 * @param {string} params.initialModel - 初始请求模型
 * @param {Object} [params.clientBaseOptions] - 基底客户端选项（不含渠道字段）
 * @param {Object} [params.requestOptions] - 请求选项模板（model/maxToken/temperature 等）
 * @param {Function} [params.resolveChannelPrompt] - (channel) => { systemPrompt, systemPromptConfig }
 * @param {Function} [params.resolveThinkingOptions] - (channel) => thinking 选项
 * @param {Function} [params.resolveToolChoiceForChannel] - (channel) => toolChoice
 * @param {Function} [params.resolveChannelForModel] - (model) => Promise<Object|null>，备选/主模型选渠
 * @param {Function} [params.onClientBuilt] - (channel, client) => void，委托器重建客户端后回调
 *   （供调用方补挂中间消息回调等一次性注册逻辑；初始客户端复用时不触发）
 * @param {Function} [params.clientFactory] - (channel, baseOptions, { model }) => Promise<{client, keyIndex}>，
 *   自定义客户端构造器（默认 buildClientForChannel；测试/特殊场景可注入 mock 客户端）
 * @param {Object} [params.event] - Yunzai 事件对象（notifyOnFallback / reply 使用）
 * @param {string} [params.source='delegate'] - 统计/日志来源标签
 * @param {boolean} [params.testMode=false] - 测试模式：跳过退避等待
 * @param {boolean} [params.lockChannel=false] - 锁定初始渠道（渠道健康检查/连通性测试专用）：
 *   跳过渠道模型过滤检查、禁止切换渠道与切换模型、仅锁定渠道内切 Key 与原地重试
 * @returns {Promise<Object>} 委托结果（response/usage/usedModel/usedChannel/switchChain/retryStats 等）
 */
export async function delegateRequest(params) {
    const {
        userMessage,
        initialChannel = null,
        initialClient = null,
        initialModel,
        clientBaseOptions = {},
        requestOptions = {},
        resolveChannelPrompt = null,
        resolveThinkingOptions = null,
        resolveToolChoiceForChannel = null,
        resolveChannelForModel = null,
        onClientBuilt = null,
        clientFactory = null,
        event = null,
        source = 'delegate',
        testMode = false,
        lockChannel = false
    } = params

    await channelManager.init()

    // 调用方未显式给模型时，从请求选项/初始客户端渠道信息兜底
    // （如测试进程 config 为空、总结入口只传 requestOptions 的场景）
    let resolvedInitialModel = initialModel
    if (!resolvedInitialModel) {
        resolvedInitialModel =
            requestOptions?.model || initialClient?._channelInfo?.model || initialChannel?.models?.[0] || null
    }

    const fallbackConfig = config.get('llm.fallback') || {}
    const fallbackEnabled = fallbackConfig.enabled !== false
    const fallbackModels = fallbackConfig.models || []
    const maxRetries = fallbackConfig.maxRetries || 3
    const retryDelay = fallbackConfig.retryDelay || 500
    const notifyOnFallback = fallbackConfig.notifyOnFallback
    const enableChannelSwitch = fallbackConfig.enableChannelSwitch !== false
    const enableKeyRotation = fallbackConfig.enableKeyRotation !== false
    const emptyRetries = fallbackConfig.emptyRetries ?? 2
    const retryJitter = Math.max(0, Math.min(0.8, Number(fallbackConfig.retryJitter ?? 0.3)))
    const fallbackBackoff = fallbackConfig.backoff || 'exponential'

    const modelsToTry = [
        resolvedInitialModel ?? initialModel,
        ...fallbackModels.filter(m => m && m !== (resolvedInitialModel ?? initialModel))
    ]

    // 审计追踪
    const switchChain = []
    const retryStats = {
        totalAttempts: 0,
        channelsTriedForMainModel: new Set(),
        keysTriedPerChannel: new Map(),
        channelsErrorReported: new Set(),
        keySwitchCount: 0,
        errors: [],
        mainModelExhausted: false
    }
    const maxKeySwitches = Math.max(2, maxRetries * 2)
    const startedChannels = new Set() // 已 startRequest 的渠道，结束时统一 endRequest

    let response = null
    let finalUsage = null
    let usedModel = resolvedInitialModel ?? initialModel
    let usedChannel = null
    let fallbackUsed = false
    let channelSwitched = false
    let totalRetryCount = 0
    let lastError = null
    let upstreamReportedModel = null
    let allToolLogs = []

    /**
     * 记录某渠道本次请求已尝试的 Key 索引（防多 Key 循环重复计费）
     * @param {string} channelId - 渠道ID
     * @param {number} keyIndex - Key 索引
     * @returns {void}
     */
    const markKeyTried = (channelId, keyIndex) => {
        if (!channelId || !(keyIndex >= 0)) return
        if (!retryStats.keysTriedPerChannel.has(channelId)) {
            retryStats.keysTriedPerChannel.set(channelId, new Set())
        }
        retryStats.keysTriedPerChannel.get(channelId).add(keyIndex)
    }

    /** @type {(channelId: string) => Set<number>|null} 渠道已试 Key 集合 */
    const getTriedKeys = channelId => retryStats.keysTriedPerChannel.get(channelId) || null

    /**
     * 标记渠道活跃（委托器统一管理 start/end 配对）
     * @param {Object} channel - 渠道对象
     * @returns {void}
     */
    const markChannelActive = channel => {
        if (channel && !startedChannels.has(channel.id)) {
            channelManager.startRequest(channel.id)
            startedChannels.add(channel.id)
        }
    }

    /**
     * 按渠道级/全局策略计算退避并等待
     * @param {number} attempt - 重试序号（从 1 开始）
     * @param {Object} channel - 当前渠道
     * @returns {Promise<void>}
     */
    const waitBackoff = async (attempt, channel) => {
        const retryPolicy = pickChannelRetryPolicy(channel, retryDelay, fallbackBackoff)
        const delay = computeDelay(attempt, {
            backoff: retryPolicy.backoff,
            baseDelay: retryPolicy.delay,
            maxDelay: 10000,
            jitterRatio: retryJitter
        })
        logger.debug(`[LlmDelegator] ${source} 退避 ${delay}ms (${retryPolicy.backoff})`)
        if (!testMode && delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay))
        }
    }

    /** 模型不匹配错误构造（带标识，catch 里识别为立即换渠道） */
    const modelMismatchError = channelName => {
        const error = new Error(`渠道 ${channelName} 不支持模型，已跳过`)
        error.code = MODEL_MISMATCH
        return error
    }

    /**
     * 切换 Key：选择下一可用 Key 并重建 client。
     * @param {Object} channel - 渠道对象
     * @param {number} currentKeyIndex - 当前 Key 索引
     * @param {string} reason - 切换原因
     * @returns {Promise<{keyIndex: number}|null>} 新 Key 索引；无可切换返回 null
     */
    const tryRotateKey = async (channel, currentKeyIndex, reason) => {
        // lockChannel：健康检查/连通性测试只测当前 Key，不做 Key 轮换，避免稀释真实错误
        if (
            lockChannel ||
            !enableKeyRotation ||
            !channel ||
            currentKeyIndex < 0 ||
            retryStats.keySwitchCount >= maxKeySwitches
        ) {
            return null
        }
        const nextKey = channelManager.getNextAvailableKey(channel.id, currentKeyIndex, getTriedKeys(channel.id))
        if (!nextKey) return null
        logger.info(
            `[LlmDelegator] ${source} ${reason}后切换Key: ${channel.name} Key#${currentKeyIndex + 1} -> Key#${nextKey.keyIndex + 1}`
        )
        switchChain.push({
            type: 'key',
            channel: channel.name,
            fromKey: currentKeyIndex + 1,
            toKey: nextKey.keyIndex + 1,
            reason
        })
        retryStats.keySwitchCount++
        markKeyTried(channel.id, nextKey.keyIndex)
        return { keyIndex: nextKey.keyIndex }
    }

    /**
     * 切换渠道：选择渠道并返回其起始 Key。
     * @param {Object} channel - 当前渠道
     * @param {string} model - 请求模型
     * @param {string} reason - 切换原因
     * @param {Set<string>} triedSet - 本模型迭代内已尝试的渠道集合（按模型隔离）
     * @returns {Promise<{channel: Object, keyIndex: number}|null>} 新渠道与起始 Key；无可切换返回 null
     */
    const tryRotateChannel = async (channel, model, reason, triedSet) => {
        if (!enableChannelSwitch) return null
        const candidates = channelManager
            .getAvailableChannels(model, { excludeChannelId: channel?.id })
            .filter(ch => ch.id !== channel?.id)
            .filter(ch => !triedSet.has(ch.id))
            .filter(ch => channelSupportsModel(ch, model))
        if (candidates.length === 0) return null
        const altChannel = candidates[0]
        logger.info(`[LlmDelegator] ${source} ${reason}后切换渠道: ${channel?.name} -> ${altChannel.name}`)
        switchChain.push({ type: 'channel', from: channel?.name, to: altChannel.name, reason })
        triedSet.add(altChannel.id)
        // 全局统计口径保留（主模型耗尽判定与审计报表读取该集合）
        retryStats.channelsTriedForMainModel.add(altChannel.id)
        channelSwitched = true
        const keyInfo = channelManager.getChannelKey(altChannel)
        markKeyTried(altChannel.id, keyInfo.keyIndex)
        return { channel: altChannel, keyIndex: keyInfo.keyIndex }
    }

    /**
     * 单模型迭代：主模型/备选模型共用。
     * @param {string} model - 请求模型
     * @param {boolean} isMainModel - 是否主模型
     * @returns {Promise<boolean>} 是否成功取得有效响应
     */
    const runModelPass = async (model, isMainModel) => {
        // 渠道切换仅主模型可用（维持原 ChatService 语义：备选模型只切 Key + 原地重试）
        // lockChannel 场景渠道切换恒无效：健康检查/连通性测试只测锁定渠道
        // 切换候选集按模型迭代隔离（runModelPass 每次新建）：每个模型的重试链独立循环其支持渠道
        const modelTriedChannels = new Set()
        const trySwitchChannel = async (ch, mdl, reason) =>
            lockChannel
                ? null
                : isMainModel
                  ? tryRotateChannel(ch, mdl, reason, modelTriedChannels)
                  : tryRotateChannel(ch, mdl, reason, modelTriedChannels)
        const channelFailStreak = new Map() // 渠道连续失败计数（抛错与空返回均计入）
        const bumpStreak = ch => {
            if (ch) channelFailStreak.set(ch.id, (channelFailStreak.get(ch.id) || 0) + 1)
        }
        let retryCount = 0
        let emptyRetryCount = 0

        // 确定起始渠道：主模型用调用方选定渠道，备选模型按模型选渠
        // lockChannel 场景只允许使用锁定渠道，缺失时直接失败（不自动选渠）
        let currentChannel = null
        let currentKeyIndex = -1
        let currentClient = null
        if (isMainModel && initialChannel) {
            currentChannel = initialChannel
            currentClient = initialClient
            currentKeyIndex = clientBaseOptions?.keyIndex ?? initialClient?.options?.keyIndex ?? -1
        } else if (lockChannel) {
            currentChannel = null
        } else {
            const resolved = resolveChannelForModel ? await resolveChannelForModel(model) : null
            currentChannel = resolved || channelManager.getBestChannel(model)
        }

        if (!currentChannel) {
            // 无任何渠道可用且调用方直接提供了可发送客户端（mock/外部客户端，未归属渠道）：
            // 委托器统一收口发送一次——无渠道/Key/模型切换语义，但保证所有 LLM 请求都经委托器
            if (!lockChannel && initialClient && typeof initialClient.sendMessage === 'function') {
                logger.debug(`[LlmDelegator] ${source} 无渠道归属客户端，委托器收口直发: model=${model}`)
                const privateOptions = { ...requestOptions }
                const result = await initialClient.sendMessage(userMessage, privateOptions)
                if (result?.model) {
                    upstreamReportedModel = result.model
                }
                usedModel = model
                usedChannel = initialChannel
                response = result
                finalUsage = result?.usage || {}
                allToolLogs = result?.toolCallLogs || []
                switchChain.push({ type: 'unmanaged', model })
                return true
            }
            lastError = new Error(lockChannel ? '未找到被测试的锁定渠道' : `未找到支持模型 ${model} 的可用渠道`)
            logger.warn(`[LlmDelegator] ${source} ${lastError.message}`)
            return false
        }

        // 本模型迭代的起始渠道入试集（切换候选按模型隔离，防跨模型误判耗尽）
        modelTriedChannels.add(currentChannel.id)

        // 首选渠道模型过滤：调用方选渠的兜底口径（如 getChatClient 的"首个启用渠道"）
        // 不校验模型，可能选出不含该模型的渠道；这里兜住并换到真正支持该模型的渠道。
        // 仅当渠道未在渠道管理器登记（无 models 定义，如 getChannelKey 无记录的测试注入渠道）
        // 时跳过：私域渠道无法做模型匹配，放行以保留旧有旁路契约。
        const channelRegistered = currentChannel.models !== undefined || channelManager.channels.has(currentChannel.id)
        if (!lockChannel && channelRegistered && !channelSupportsModel(currentChannel, model)) {
            const replacement = await trySwitchChannel(currentChannel, model, 'model-mismatch')
            if (!replacement) {
                lastError = modelMismatchError(currentChannel.name)
                logger.warn(
                    `[LlmDelegator] ${source} 首选渠道 ${currentChannel.name} 不支持模型 ${model}，且无其他支持渠道`
                )
                return false
            }
            logger.info(
                `[LlmDelegator] ${source} 首选渠道 ${currentChannel.name} 不支持模型 ${model}，改用 ${replacement.channel.name}`
            )
            currentChannel = replacement.channel
            currentKeyIndex = replacement.keyIndex
            currentClient = null
        }

        if (currentKeyIndex < 0) {
            const keyInfo = channelManager.getChannelKey(currentChannel)
            currentKeyIndex = keyInfo.keyIndex
        }
        retryStats.channelsTriedForMainModel.add(currentChannel.id)
        markKeyTried(currentChannel.id, currentKeyIndex)
        markChannelActive(currentChannel)

        // 预算：主模型与回落模型均使用统一重试预算（llm.fallback.maxRetries）；每个模型
        // 的重试链在其自己筛选出的渠道集合上独立运转（用户口径：主模型重试 n 次 →
        // 回落模型1 按模型筛渠道重试 → 回落模型2 按模型筛渠道重试）
        const retryBudget = maxRetries

        while (retryCount <= retryBudget) {
            retryStats.totalAttempts++
            try {
                if (!lockChannel && channelRegistered && !channelSupportsModel(currentChannel, model)) {
                    throw modelMismatchError(currentChannel.name)
                }
                if (!currentClient) {
                    const built = clientFactory
                        ? await clientFactory(currentChannel, clientBaseOptions, { model })
                        : await buildClientForChannel(currentChannel, clientBaseOptions, { model })
                    if (!built.client) {
                        throw new Error(`渠道 ${currentChannel.name} 客户端构造失败`)
                    }
                    currentClient = built.client
                    if (onClientBuilt) {
                        try {
                            await onClientBuilt(currentChannel, currentClient)
                        } catch (hookErr) {
                            logger.debug(`[LlmDelegator] ${source} 客户端构建回调失败: ${hookErr.message}`)
                        }
                    }
                }

                const promptState = resolveChannelPrompt ? resolveChannelPrompt(currentChannel) : {}
                const thinkingPatch = resolveThinkingOptions ? resolveThinkingOptions(currentChannel) : {}
                const toolChoicePatch = resolveToolChoiceForChannel
                    ? resolveToolChoiceForChannel(currentChannel)
                    : undefined
                const finalOptions = {
                    ...requestOptions,
                    ...thinkingPatch,
                    model: resolveActualModel(currentChannel, model),
                    ...(promptState?.systemPrompt !== undefined ? { systemOverride: promptState.systemPrompt } : {}),
                    ...(promptState?.systemPromptConfig !== undefined
                        ? { systemPromptConfig: promptState.systemPromptConfig }
                        : {}),
                    ...(toolChoicePatch !== undefined ? { toolChoice: toolChoicePatch } : {}),
                    ...(currentChannel?.id
                        ? { promptCacheKey: PromptCacheService.getPromptCacheKey(currentChannel.id) }
                        : {})
                }
                logger.debug(
                    `[LlmDelegator] ${source} 发送: channel=${currentChannel.name}, model=${finalOptions.model}, key=${currentKeyIndex}`
                )
                const result = await currentClient.sendMessage(userMessage, finalOptions)
                if (result?.model) {
                    upstreamReportedModel = result.model
                }

                const hasToolCalls = result?.toolCallLogs?.length > 0
                const hasAnyContent = isUsableResponse(result)
                if (result && hasAnyContent) {
                    if (!hasToolCalls && !hasTextContent(result) && emptyRetryCount < emptyRetries) {
                        // 空文本：独立预算内原地退避重试
                        bumpStreak(currentChannel)
                        emptyRetryCount++
                        logger.warn(`[LlmDelegator] ${source} 模型 ${model} 返回空文本，重试第${emptyRetryCount}次...`)
                        await waitBackoff(emptyRetryCount, currentChannel)
                        continue
                    }
                    // 成功
                    usedModel = model
                    usedChannel = currentChannel
                    response = result
                    finalUsage = result.usage || {}
                    allToolLogs = result.toolCallLogs || []
                    switchChain.push({ type: 'success', channel: currentChannel.name, model })
                    if (!isMainModel) {
                        fallbackUsed = true
                        logger.info(`[LlmDelegator] ${source} 使用备选模型成功: ${model}`)
                        if (notifyOnFallback && event?.reply) {
                            try {
                                await event.reply(`[已切换至备选模型: ${model}]`, false)
                            } catch {}
                        }
                    }
                    channelManager.resetChannelError(currentChannel.id)
                    channelManager.reportSuccess(currentChannel.id)
                    return true
                }

                // 空响应：先原地退避，再切 Key → 切渠道 → 渠道连续失败强制切换 → 原地重试
                bumpStreak(currentChannel)
                emptyRetryCount++
                if (emptyRetryCount <= emptyRetries) {
                    logger.warn(`[LlmDelegator] ${source} 模型 ${model} 返回空响应，重试第${emptyRetryCount}次...`)
                    await waitBackoff(emptyRetryCount, currentChannel)
                    continue
                }

                const rotatedKey = await tryRotateKey(currentChannel, currentKeyIndex, 'empty')
                if (rotatedKey) {
                    currentKeyIndex = rotatedKey.keyIndex
                    currentClient = null
                    emptyRetryCount = 0
                    continue
                }
                const rotatedChannel = await trySwitchChannel(currentChannel, model, 'empty')
                if (rotatedChannel) {
                    currentChannel = rotatedChannel.channel
                    currentKeyIndex = rotatedChannel.keyIndex
                    currentClient = null
                    emptyRetryCount = 0
                    markChannelActive(currentChannel)
                    continue
                }

                // 渠道级 retry.maxAttempts 连续失败强制切换
                emptyRetryCount = 0
                const channelMaxAttempts = currentChannel?.retry?.maxAttempts ?? maxRetries
                const streak = channelFailStreak.get(currentChannel.id) || 0
                if (streak >= channelMaxAttempts) {
                    logger.warn(
                        `[LlmDelegator] ${source} 渠道 ${currentChannel.name} 连续失败 ${streak} 次(阈值 ${channelMaxAttempts})，优先尝试切换`
                    )
                    const forcedKey = await tryRotateKey(currentChannel, currentKeyIndex, 'empty')
                    if (forcedKey) {
                        currentKeyIndex = forcedKey.keyIndex
                        currentClient = null
                        continue
                    }
                    const forcedChannel = await trySwitchChannel(currentChannel, model, 'empty')
                    if (forcedChannel) {
                        currentChannel = forcedChannel.channel
                        currentKeyIndex = forcedChannel.keyIndex
                        currentClient = null
                        markChannelActive(currentChannel)
                        continue
                    }
                }

                // 无可切换：原地退避重试（消耗 retryCount）
                retryCount++
                totalRetryCount++
                if (retryCount <= retryBudget) {
                    logger.info(
                        `[LlmDelegator] ${source} 空响应，无可切换选项，延迟后重试 (${retryCount}/${retryBudget})`
                    )
                    switchChain.push({
                        type: 'retry',
                        channel: currentChannel?.name,
                        reason: 'empty',
                        attempt: retryCount
                    })
                    await waitBackoff(retryCount, currentChannel)
                    emptyRetryCount = 0
                    continue
                }
                break
            } catch (error) {
                lastError = error
                const errorMsg = error.message || ''
                const errorType = error.code === MODEL_MISMATCH ? 'model-mismatch' : classifyRetryError(error).type

                if (error.code !== MODEL_MISMATCH) {
                    logger.error(`[LlmDelegator] ${source} 模型 ${model} 请求失败 (${errorType}): ${errorMsg}`)
                    bumpStreak(currentChannel)
                    // 同一请求内同一渠道只累加一次渠道级 errorCount
                    if (currentChannel) {
                        const alreadyReported = retryStats.channelsErrorReported.has(currentChannel.id)
                        retryStats.channelsErrorReported.add(currentChannel.id)
                        try {
                            await channelManager.reportError(currentChannel.id, {
                                keyIndex: currentKeyIndex,
                                errorType,
                                errorMessage: errorMsg,
                                isRetry: alreadyReported
                            })
                        } catch (reportErr) {
                            logger.debug('[LlmDelegator] 上报渠道错误失败:', reportErr.message)
                        }
                    }
                }

                // 模型不匹配：不重试，仅换渠道；无可换则放弃该模型
                // lockChannel 场景本分支不会出现（循环内已跳过模型过滤），兜底直接放弃
                if (error.code === MODEL_MISMATCH) {
                    if (lockChannel) {
                        logger.warn(`[LlmDelegator] ${source} 锁定渠道 ${currentChannel?.name} 不满足条件，放弃`)
                        break
                    }
                    const rotatedChannel = await trySwitchChannel(currentChannel, model, 'model-mismatch')
                    if (rotatedChannel) {
                        currentChannel = rotatedChannel.channel
                        currentKeyIndex = rotatedChannel.keyIndex
                        currentClient = null
                        markChannelActive(currentChannel)
                        continue
                    }
                    break
                }

                // 可重试类别：先切 Key 再切渠道
                const shouldTrySwitch = expectRetryable(errorType)
                if (shouldTrySwitch) {
                    const rotatedKey = await tryRotateKey(currentChannel, currentKeyIndex, errorType)
                    if (rotatedKey) {
                        currentKeyIndex = rotatedKey.keyIndex
                        currentClient = null
                        continue
                    }
                    const rotatedChannel = await trySwitchChannel(currentChannel, model, errorType)
                    if (rotatedChannel) {
                        currentChannel = rotatedChannel.channel
                        currentKeyIndex = rotatedChannel.keyIndex
                        currentClient = null
                        markChannelActive(currentChannel)
                        continue
                    }
                }

                // 无可切换：原地退避重试
                retryCount++
                totalRetryCount++
                retryStats.errors.push({
                    model,
                    channel: currentChannel?.name,
                    errorType,
                    errorMessage: errorMsg,
                    attempt: retryCount
                })
                if (retryCount <= retryBudget) {
                    logger.info(
                        `[LlmDelegator] ${source} 无可切换选项，${errorType}后重试 (${retryCount}/${retryBudget})`
                    )
                    switchChain.push({
                        type: 'retry',
                        channel: currentChannel?.name,
                        reason: errorType,
                        attempt: retryCount
                    })
                    await waitBackoff(retryCount, currentChannel)
                }
            }
        }

        return false
    }

    try {
        switchChain.push({ type: 'init', channel: initialChannel?.name || initialChannel?.id || 'unknown' })

        // lockChannel：只允许初始模型一轮（忽略备选模型，不得切换模型）
        const passCount = lockChannel ? 1 : modelsToTry.length
        for (let modelIndex = 0; modelIndex < passCount; modelIndex++) {
            const model = modelsToTry[modelIndex]
            const isMainModel = modelIndex === 0

            if (!isMainModel && retryStats.mainModelExhausted !== true) {
                logger.debug(`[LlmDelegator] ${source} 主模型渠道未耗尽，跳过备选模型 ${model}`)
                continue
            }

            const ok = await runModelPass(model, isMainModel)
            if (ok) break

            if (!response && !lastError) {
                lastError = new Error(`模型 ${model} 无有效响应`)
            }

            // 主模型渠道耗尽判定：为后续备选模型启用标记
            if (isMainModel && !response) {
                const allChannelsForMainModel = channelManager.getAvailableChannels(model) || []
                const triedAllChannels =
                    allChannelsForMainModel.length === 0 ||
                    allChannelsForMainModel.every(ch => retryStats.channelsTriedForMainModel.has(ch.id))
                if (triedAllChannels) {
                    retryStats.mainModelExhausted = true
                    logger.info(
                        `[LlmDelegator] ${source} 主模型 ${model} 所有渠道已耗尽 (尝试了 ${retryStats.channelsTriedForMainModel.size} 个渠道)`
                    )
                    switchChain.push({
                        type: 'exhausted',
                        model,
                        channelsTried: retryStats.channelsTriedForMainModel.size,
                        totalChannels: allChannelsForMainModel.length
                    })
                }
            }

            if (!fallbackEnabled) break
        }
    } finally {
        for (const channelId of startedChannels) {
            channelManager.endRequest(channelId)
        }
    }

    if (!response && lastError) {
        throw lastError
    }
    if (!response) {
        logger.warn(`[LlmDelegator] ${source} 所有模型和渠道尝试后仍无有效响应`)
    }

    return {
        response,
        usage: finalUsage || {},
        reportedModel: upstreamReportedModel,
        toolCallLogs: allToolLogs,
        usedModel,
        usedChannel,
        fallbackUsed,
        channelSwitched,
        totalRetryCount,
        switchChain,
        retryStats,
        lastError
    }
}

export default { delegateRequest, channelSupportsModel, buildClientForChannel, resolveActualModel }
