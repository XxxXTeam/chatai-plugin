/**
 * 记忆模块共享 LLM 调用辅助函数
 * 消除 MemoryExtractor 和 MemorySummarizer 中的重复 callLLM 实现
 */
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

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

    try {
        // 方式1: sendMessage (ChatGPT/Claude style)
        if (typeof llmClient.sendMessage === 'function') {
            const response = await llmClient.sendMessage(prompt, { maxTokens, temperature })
            return response?.text || response?.content || (typeof response === 'string' ? response : '')
        }

        // 方式2: complete (Completion style)
        if (typeof llmClient.complete === 'function') {
            const response = await llmClient.complete(prompt, { maxTokens, temperature })
            return typeof response === 'string' ? response : response?.text || response?.content || ''
        }

        // 方式3: chat (Chat style)
        if (typeof llmClient.chat === 'function') {
            const response = await llmClient.chat([{ role: 'user', content: prompt }], { maxTokens, temperature })
            return (
                response?.choices?.[0]?.message?.content ||
                response?.content ||
                (typeof response === 'string' ? response : '')
            )
        }

        // 方式4: sendMessageWithHistory (内部 LLM 客户端)
        if (typeof llmClient.sendMessageWithHistory === 'function') {
            const response = await llmClient.sendMessageWithHistory([{ role: 'user', content: prompt }], {
                maxTokens,
                temperature
            })
            const contentArray = Array.isArray(response?.content) ? response.content : []
            return (
                contentArray
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('') || ''
            )
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
