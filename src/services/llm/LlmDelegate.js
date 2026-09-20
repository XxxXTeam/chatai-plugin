import { chatLogger } from '../../core/utils/logger.js'
import { LlmService } from './LlmService.js'
import { channelManager } from './ChannelManager.js'
import { classifyRetryError, computeDelay } from './BackoffPolicy.js'
import config from '../../../config/config.js'

const logger = chatLogger

/**
 * 延迟等待（毫秒）
 * @param {number} ms - 延迟时长
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 读几何配置：重试次数、退避基础延迟、退避策略、抖动、是否允许渠道切换。
 * 默认与 ChatService 的 llm.fallback 保持一致（maxRetries 3 / retryDelay 500 / backoff exponential / retryJitter 0.3）。
 * @returns {{maxRetries: number, retryDelay: number, backoff: string, retryJitter: number, enableChannelSwitch: boolean}}
 */
export function getDelegateFallbackConfig() {
    const fallback = configGetFallback()
    return {
        maxRetries: Math.max(1, fallback.maxRetries || 3),
        retryDelay: Math.max(50, fallback.retryDelay || 500),
        backoff: fallback.backoff || 'exponential',
        retryJitter: Math.max(0, Math.min(0.8, Number(fallback.retryJitter ?? 0.3))),
        enableChannelSwitch: fallback.enableChannelSwitch !== false
    }
}

function configGetFallback() {
    return config.get('llm.fallback') || {}
}

/**
 * 为旁路调用挑选符合模型与开关语义的候选渠道。
 * 渠道对象已经是 normalizeAdvanced 后的形态，advanced.streaming.enabled 不会缺失。
 * @param {string} [model] - 目标模型（空则跳过模型匹配）
 * @param {string} [groupId] - 群组 ID（传群独立渠道优先）
 * @returns {Promise<{channels: Array, preferChannel: Object|null}>} 候选渠道与首选渠道
 */
async function resolveDelegateCandidates(model, groupId) {
    await channelManager.init()
    let preferred = null
    if (groupId) {
        try {
            const sm = await import('../scope/ScopeManager.js').then(m => m.getScopeManager())
            const groupChannelConfig = await sm.getGroupChannelConfig(String(groupId))
            const groupModel = model
            const resolved = channelManager.resolveGroupChannel(groupChannelConfig, groupModel, groupId)
            preferred = resolved.channel
        } catch (error) {
            logger.debug('[LlmDelegate] 获取群独立渠道失败:', error.message)
        }
    }

    const channels = []
    const seen = new Set()
    if (preferred) {
        channels.push(preferred)
        seen.add(preferred.id)
    }

    let candidates = []
    if (model) {
        candidates = channelManager.getBestChannel(model) ? [channelManager.getBestChannel(model)] : []
    }
    for (const ch of candidates) {
        if (ch && !seen.has(ch.id)) {
            channels.push(ch)
            seen.add(ch.id)
        }
    }
    for (const ch of channelManager.getAll()) {
        if (!seen.has(ch.id) && ch.enabled !== false && ch.apiKey) {
            channels.push(ch)
            seen.add(ch.id)
        }
    }

    const first = preferred || (model ? channelManager.getBestChannel(model) : null) || channels[0] || null
    return { channels, preferChannel: first }
}

/**
 * 从渠道构造客户端（与 LlmService.getChatClient 同构，但保留渠道元信息）
 * @param {Object} channel - 渠道对象
 * @param {Object} options - 调用方选项
 * @returns {Promise<{client: Object|null, model: string|null, channel: Object, keyIndex: number}>}
 */
async function buildClientForChannel(channel, options) {
    try {
        const keyInfo = channelManager.getChannelKey(channel)
        const clientOptions = {
            apiKey: keyInfo.key,
            baseUrl: channelManager.getCurrentBaseUrl(channel.id) || channel.baseUrl,
            chatPath: channel.chatPath || '',
            modelsPath: channel.modelsPath || '',
            responsePath: channel.responsePath || channel.endpoints?.responses || '',
            endpoints: channel.endpoints || {},
            apiInterface: channel.apiInterface || channel.openaiApiInterface || 'chat',
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
            ...(channel.timeout ? { timeout: channel.timeout } : {})
        }
        const client = await LlmService.createClient({
            ...clientOptions,
            adapterType: channel.adapterType,
            enableTools: false
        })
        if (client) {
            client._channelInfo = {
                id: channel.id,
                name: channel.name,
                model: options.model,
                maxCharacters: channel.advanced?.llm?.maxCharacters || 0,
                llm: channel.advanced?.llm || {},
                overrides: channel.overrides || {}
            }
        }
        return {
            client,
            model: options.model,
            channel,
            keyIndex: keyInfo.keyIndex
        }
    } catch (error) {
        logger.debug('[LlmDelegate] 构造渠道客户端失败:', error.message)
        return { client: null, model: options.model, channel, keyIndex: -1 }
    }
}

/**
 * 从渠道配置解析流式开关（遵循渠道 advanced.streaming.enabled）
 * @param {Object} channel - 渠道对象
 * @param {boolean|undefined} explicitStream - 调用方显式指定（true/false/undefined）
 * @returns {boolean} 是否使用流式
 */
export function resolveChannelStream(channel, explicitStream) {
    if (typeof explicitStream === 'boolean') return explicitStream
    return channel?.advanced?.streaming?.enabled === true
}

/**
 * 上报旁路调用失败并等待退避延迟（空返回与请求异常共用同一失败处理路径）
 * @param {Object} channel - 失败渠道对象
 * @param {number} keyIndex - 当前 Key 索引
 * @param {Error} error - 失败错误（空返回时为合成错误）
 * @param {string} errorType - 错误类别（空返回传 'empty'）
 * @param {number} attempt - 当前尝试序号（从 0 开始）
 * @param {string} caller - 调用者标签
 * @param {boolean} enableChannelSwitch - 是否允许渠道切换
 * @param {number} max - 重试上限
 * @param {Object} backoffOptions - 退避选项 { backoff, retryDelay, retryJitter }
 * @returns {Promise<void>}
 */
async function reportDelegateFailure(
    channel,
    keyIndex,
    error,
    errorType,
    attempt,
    caller,
    enableChannelSwitch,
    max,
    backoffOptions
) {
    logger.error(`[LlmDelegate] ${caller} 渠道 ${channel.name} 请求失败 (${errorType}): ${error.message}`)
    try {
        await channelManager.reportError(channel.id, {
            keyIndex,
            errorType,
            errorMessage: error.message,
            isRetry: attempt > 0
        })
    } catch (reportError) {
        logger.debug('[LlmDelegate] 上报渠道错误失败:', reportError.message)
    }
    if (!enableChannelSwitch) {
        return
    }
    if (attempt < max) {
        const delay = computeDelay(attempt + 1, {
            backoff: backoffOptions.backoff,
            baseDelay: backoffOptions.retryDelay,
            maxDelay: 10000,
            jitterRatio: backoffOptions.retryJitter
        })
        logger.debug(`[LlmDelegate] ${caller} ${delay}ms 后重试 (${attempt + 1}/${max})`)
        await sleep(delay)
    }
}

/**
 * 旁路 LLM 调用（带渠道流式遵循 + 渠道切换重试）
 * @param {Object} message - 用户消息 { role, content }（内部格式）
 * @param {Object} [options] - 调用选项
 * @param {string} [options.model] - 目标模型
 * @param {string} [options.groupId] - 群组 ID
 * @param {number} [options.maxToken] - 最大 token
 * @param {number} [options.temperature] - 温度
 * @param {string} [options.systemOverride] - 系统提示词
 * @param {boolean} [options.disableHistorySave] - 是否禁用历史保存
 * @param {boolean} [options.stream] - 显式流式开关（默认遵循渠道配置）
 * @param {string} [options.caller] - 调用者标签（日志）
 * @param {number} [options.maxRetries] - 重试上限（覆盖 fallback 配置）
 * @returns {Promise<{response: *, model: string|null, channel: Object|null, stream: boolean, tries: number}>} 响应与渠道元信息
 */
export async function callWithChannelDelegate(message, options = {}) {
    const caller = options.caller || 'LlmDelegate'
    const { maxRetries, retryDelay, backoff, retryJitter, enableChannelSwitch } = getDelegateFallbackConfig()
    const max = options.maxRetries ?? maxRetries

    const { channels, preferChannel } = await resolveDelegateCandidates(options.model, options.groupId)
    if (channels.length === 0) {
        throw new Error('[LlmDelegate] 未找到可用的 API 渠道配置')
    }

    let lastError = null
    const tried = new Set()

    for (let attempt = 0; attempt <= max; attempt++) {
        const channel = preferChannel && !tried.has(preferChannel.id) ? preferChannel : null
        const pick = channel || channels.find(ch => !tried.has(ch.id))
        if (!pick) break
        tried.add(pick.id)

        const { client, model, keyIndex } = await buildClientForChannel(pick, options)
        const useStream = resolveChannelStream(pick, options.stream)
        if (!client) {
            lastError = new Error(`渠道 ${pick.name} 客户端构造失败`)
            continue
        }
        const modelMapping = channelManager.getActualModel(pick.id, model)
        const actualModel = modelMapping?.actualModel || model

        try {
            const requestOptions = {
                model: actualModel,
                ...(options.maxToken !== undefined ? { maxToken: options.maxToken } : {}),
                ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                ...(options.systemOverride ? { systemOverride: options.systemOverride } : {}),
                ...(options.disableHistorySave !== undefined ? { disableHistorySave: options.disableHistorySave } : {}),
                stream: useStream
            }
            logger.debug(`[LlmDelegate] ${caller} 调用: channel=${pick.name} model=${actualModel} stream=${useStream}`)
            const response = await client.sendMessage(message, requestOptions)
            const usableContents = response?.contents?.filter(c => c.type === 'text' && c.text?.trim()).length > 0
            const hasToolCalls = response?.toolCallLogs?.length > 0
            if (hasToolCalls || usableContents) {
                return {
                    response,
                    model: actualModel,
                    channel: pick,
                    stream: useStream,
                    tries: attempt + 1
                }
            }

            // 空返回视为可重试失败：继续尝试下一候选渠道，耗尽后抛出
            lastError = new Error(`渠道 ${pick.name} 返回空响应`)
            logger.warn(`[LlmDelegate] ${caller} 渠道 ${pick.name} 返回空响应，尝试下一渠道`)
            await reportDelegateFailure(pick, keyIndex, lastError, 'empty', attempt, caller, enableChannelSwitch, max, {
                backoff,
                retryDelay,
                retryJitter
            })
            if (!enableChannelSwitch || attempt >= max) {
                break
            }
        } catch (error) {
            lastError = error
            await reportDelegateFailure(
                pick,
                keyIndex,
                error,
                classifyRetryError(error).type,
                attempt,
                caller,
                enableChannelSwitch,
                max,
                {
                    backoff,
                    retryDelay,
                    retryJitter
                }
            )
            if (!enableChannelSwitch || attempt >= max) {
                break
            }
        }
    }

    throw lastError || new Error('[LlmDelegate] LLM 调用失败且无可切换渠道')
}

export default {
    callWithChannelDelegate,
    resolveChannelStream,
    getDelegateFallbackConfig
}
