/**
 * 记忆模块共享 LLM 调用辅助函数
 * 消除 MemoryExtractor 和 MemorySummarizer 中的重复 callLLM 实现
 */
import { chatLogger } from '../../core/utils/logger.js'
import { resolveClientTemperature } from '../llm/TemperatureResolver.js'

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
 * 统一的 LLM 调用方法
 * 兼容多种客户端接口：sendMessage / complete / chat
 * @param {Object} llmClient - LLM 客户端实例
 * @param {string} prompt - 提示词
 * @param {Object} [options] - 调用选项
 * @param {number} [options.maxTokens=1000] - 最大 token 数
 * @param {number} [options.temperature=0.3] - 温度参数
 * @param {string} [options.caller='MemoryLLM'] - 调用者标识（用于日志）
 * @returns {Promise<string>} LLM 响应文本
 */
export async function callMemoryLLM(llmClient, prompt, options = {}) {
    const { maxTokens = 1000, temperature = 0.3, caller = 'MemoryLLM' } = options

    if (!llmClient) {
        throw new Error('LLM client not configured')
    }

    const resolvedTemp = resolveClientTemperature(llmClient, temperature)
    const tempOpts = resolvedTemp !== undefined ? { temperature: resolvedTemp } : {}

    try {
        // 方式1: 内部统一客户端。该客户端同时也有 sendMessage，必须优先选择此契约；
        // 否则字符串 prompt 会被当作内部消息对象展开，且 contents 响应无法被旧逻辑读取。
        if (typeof llmClient.sendMessageWithHistory === 'function') {
            const response = await llmClient.sendMessageWithHistory(
                [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
                {
                    maxToken: maxTokens,
                    ...tempOpts
                }
            )
            return extractMemoryLLMText(response)
        }

        // 方式2: sendMessage (SDK/包装客户端)
        if (typeof llmClient.sendMessage === 'function') {
            const response = await llmClient.sendMessage(prompt, { maxTokens, ...tempOpts })
            return extractMemoryLLMText(response)
        }

        // 方式3: complete (Completion style)
        if (typeof llmClient.complete === 'function') {
            const response = await llmClient.complete(prompt, { maxTokens, ...tempOpts })
            return extractMemoryLLMText(response)
        }

        // 方式4: chat (Chat style)
        if (typeof llmClient.chat === 'function') {
            const response = await llmClient.chat([{ role: 'user', content: prompt }], { maxTokens, ...tempOpts })
            return extractMemoryLLMText(response)
        }

        throw new Error('Unknown LLM client type - no supported method found')
    } catch (error) {
        logger.error(`[${caller}] LLM call failed:`, error.message)
        throw error
    }
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
