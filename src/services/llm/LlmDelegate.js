/**
 * LlmDelegate - 旁路 LLM 调用统一助手
 *
 * 记忆、知识图谱、总结等子模块绕过 ChatService 直接调用适配器时，
 * 过去既未遵循渠道 advanced.streaming 配置，失败时也不做渠道切换与重试。
 * 本模块为这些旁路调用提供与 ChatService 主路径一致的契约：
 *
 * 1. 渠道选择：优先指定模型可用渠道，回退启用的通用渠道；
 * 2. 流式遵循：请求参数统一携带渠道 advanced.streaming.enabled；
 * 3. 失败重试：错误上报渠道冷却、切换同模型其他渠道、指数退避重试，
 *    全部失败后才抛出错误，由调用方按既有语义降级（返回空/回退策略）。
 *
 * 纯函数式组合，无单例状态；渠道元信息随调用返回，供调用方回填统计。
 */

import { chatLogger } from '../../core/utils/logger.js'
import { LlmService } from './LlmService.js'
import { channelManager } from './ChannelManager.js'
import config from '../../../config/config.js'

const logger = chatLogger

/** 渠道切换后冷却保护：同一次调用中不重复尝试的渠道 ID */
const RETRYABLE_ERROR_SAMPLES = {
    auth: ['401', 'Unauthorized', 'invalid_api_key'],
    quota: ['429', 'quota', 'rate_limit'],
    timeout: ['timeout', 'ETIMEDOUT'],
    network: ['ECONNREFUSED', 'network'],
    server: ['500', '503', '502']
}

/**
 * 按消息文本分析错误类别（与 ChatService._sendMessageImpl 保持同一分类口径）
 * @param {string|Error} error - 错误对象或消息
 * @returns {string} 错误类别
 */
function classifyDelegateError(error) {
    const message = typeof error === 'string' ? error : error?.message || ''
    for (const [type, samples] of Object.entries(RETRYABLE_ERROR_SAMPLES)) {
        if (samples.some(sample => message.includes(sample))) return type
    }
    return 'unknown'
}

/**
 * 延迟等待（毫秒）
 * @param {number} ms - 延迟时长
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 读几何配置：重试次数、退避基础延迟、是否允许渠道切换。
 * 默认与 ChatService 的 llm.fallback 保持一致（maxRetries 3 / retryDelay 500）。
 * @returns {{maxRetries: number, retryDelay: number, enableChannelSwitch: boolean}}
 */
export function getDelegateFallbackConfig() {
    const fallback = configGetFallback()
    return {
        maxRetries: Math.max(1, fallback.maxRetries || 3),
        retryDelay: Math.max(50, fallback.retryDelay || 500),
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
    const { maxRetries, retryDelay, enableChannelSwitch } = getDelegateFallbackConfig()
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
            return {
                response,
                model: actualModel,
                channel: pick,
                stream: useStream,
                tries: attempt + 1
            }
        } catch (error) {
            lastError = error
            const errorType = classifyDelegateError(error)
            logger.error(`[LlmDelegate] ${caller} 渠道 ${pick.name} 请求失败 (${errorType}): ${error.message}`)
            try {
                await channelManager.reportError(pick.id, {
                    keyIndex,
                    errorType,
                    errorMessage: error.message,
                    isRetry: attempt > 0
                })
            } catch (reportError) {
                logger.debug('[LlmDelegate] 上报渠道错误失败:', reportError.message)
            }
            // 渠道切换开关关闭时不再尝试其他渠道，直接退出重试
            if (!enableChannelSwitch) {
                break
            }
            if (attempt < max) {
                const delay = Math.min(retryDelay * Math.pow(2, attempt), 10000)
                logger.debug(`[LlmDelegate] ${caller} ${delay}ms 后重试 (${attempt + 1}/${max})`)
                await sleep(delay)
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
