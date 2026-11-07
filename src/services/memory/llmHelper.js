/**
 * 记忆模块共享 LLM 调用辅助函数
 * 消除 MemoryExtractor 和 MemorySummarizer 中的重复 callLLM 实现
 */
import { chatLogger } from '../../core/utils/logger.js'
import { resolveClientTemperature } from '../llm/TemperatureResolver.js'
import { delegateRequest } from '../llm/LlmDelegator.js'
import { memoryLlmScheduler } from './MemoryLlmScheduler.js'

const logger = chatLogger

/**
 * 从各协议客户端的响应对象中提取文本。
 * 覆盖内部统一 content/contents、OpenAI choices/output、Claude content blocks，
 * 以及 Gemini candidates/response.text() 形状。
 *
 * @param {unknown} response - LLM 原始响应
 * @returns {Promise<string>} 提取出的文本
 */
export async function extractMemoryLLMText(response) {
    if (typeof response === 'string') return response
    if (!response || typeof response !== 'object') return ''

    const readTextValue = async value => {
        if (typeof value === 'string') return value
        if (typeof value === 'function') {
            const resolved = await value.call(response)
            return typeof resolved === 'string' ? resolved : ''
        }
        return ''
    }
    const joinParts = parts => {
        if (typeof parts === 'string') return parts
        if (!Array.isArray(parts)) return ''
        return parts
            .map(part => {
                if (typeof part === 'string') return part
                if (!part || typeof part !== 'object') return ''
                if (typeof part.text === 'string') return part.text
                if (typeof part.text?.value === 'string') return part.text.value
                if (typeof part.content === 'string') return part.content
                return joinParts(part.content || part.parts)
            })
            .join('')
    }

    const directText = await readTextValue(response.text)
    if (directText) return directText
    if (typeof response.output_text === 'string') return response.output_text

    const unified = joinParts(response.contents) || joinParts(response.content)
    if (unified) return unified

    const choiceContent = response.choices?.[0]?.message?.content ?? response.choices?.[0]?.text
    const choiceText = joinParts(choiceContent) || (typeof choiceContent === 'string' ? choiceContent : '')
    if (choiceText) return choiceText

    const geminiText = joinParts(response.candidates?.[0]?.content?.parts)
    if (geminiText) return geminiText

    const outputText = joinParts(
        Array.isArray(response.output) ? response.output.flatMap(item => item?.content || []) : response.output
    )
    if (outputText) return outputText

    if (response.response && response.response !== response) {
        const nested = response.response
        if (typeof nested?.text === 'function') {
            const value = await nested.text()
            if (typeof value === 'string') return value
        }
        return extractMemoryLLMText(nested)
    }

    return ''
}

/**
 * 统一的 LLM 调用方法：全部经 LlmDelegator 委托（模型-渠道过滤/渠道切换/Key 轮换/重试统一调度）。
 * @param {Object} llmClient - LLM 客户端实例（须为 LlmService.getChatClient 构造的内部客户端）
 * @param {string} prompt - 提示词
 * @param {Object} [options] - 调用选项
 * @param {number} [options.maxTokens=1000] - 最大 token 数
 * @param {number} [options.temperature=0.3] - 温度参数
 * @param {string} [options.caller='MemoryLLM'] - 调用者标识（用于日志）
 * @param {string} [options.groupId] - 群组 ID（用于群独立渠道选择）
 * @param {string} [options.scopeKey] - 并发闸门兼容键（默认取 caller，不参与冷却）
 * @param {number} [options.timeoutMs] - 单请求超时（默认 memory.llmTimeoutMs）
 * @returns {Promise<string>} LLM 响应文本
 */
export async function callMemoryLLM(llmClient, prompt, options = {}) {
    const { maxTokens = 1000, temperature = 0.3, caller = 'MemoryLLM', scopeKey = null, timeoutMs = null } = options

    if (!llmClient) {
        throw new Error('LLM client not configured')
    }
    if (
        typeof llmClient._channelInfo?.id !== 'string' ||
        (typeof llmClient.sendMessage !== 'function' && typeof llmClient.sendMessageWithHistory !== 'function')
    ) {
        throw new Error('[MemoryLLM] 非内部客户端无法委托调度，请使用 LlmService.getChatClient 构造客户端')
    }

    const resolvedTemp = resolveClientTemperature(llmClient, temperature)
    const tempOpts = resolvedTemp !== undefined ? { temperature: resolvedTemp } : {}

    const model = llmClient._channelInfo?.model || options.model || ''
    /* 并发闸门内执行 delegateRequest：复用调用方 client，但调度器负责限流 */
    return memoryLlmScheduler.run(
        async () => {
            const delegated = await delegateRequest({
                userMessage: { role: 'user', content: [{ type: 'text', text: prompt }] },
                initialModel: model,
                initialChannel: llmClient._channelInfo?.channel || null,
                initialClient: llmClient,
                clientBaseOptions: {},
                requestOptions: {
                    ...(model ? { model } : {}),
                    maxToken: maxTokens,
                    ...tempOpts
                },
                event: null,
                source: caller
            })
            logger.debug(`[${caller}] LlmDelegator 调用完成: model=${model}`)
            return extractMemoryLLMText(delegated.response)
        },
        { caller, scopeKey, timeoutMs }
    )
}

/**
 * 格式化时间戳为中文时间
 * @param {number} timestamp - 时间戳
 * @returns {string} 格式化的时间字符串
 */
export function formatMemoryTime(timestamp) {
    if (!timestamp) return '未知'
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    })
}
