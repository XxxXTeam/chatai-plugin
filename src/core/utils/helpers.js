import crypto from 'node:crypto'
import { DefaultLogger } from '../types/common.js'

// Round-robin 计数器
const roundRobinCounters = new Map()

/**
 * Helper to get API key from single or multiple keys
 * @param {string | string[]} apiKey
 * @param {'random' | 'round-robin' | 'conversation-hash'} [strategy='random']
 * @param {string} [conversationId] - 用于 conversation-hash 策略
 * @returns {Promise<string>}
 */
export async function getKey(apiKey, strategy = 'random', conversationId) {
    if (typeof apiKey === 'string') {
        return apiKey
    }

    if (!Array.isArray(apiKey) || apiKey.length === 0) {
        throw new Error('No API key provided')
    }

    if (apiKey.length === 1) {
        return apiKey[0]
    }

    switch (strategy) {
        case 'round-robin': {
            // 基于 apiKey 数组的哈希作为 key
            const keyHash = crypto.createHash('md5').update(apiKey.join(',')).digest('hex')
            const current = roundRobinCounters.get(keyHash) || 0
            roundRobinCounters.set(keyHash, (current + 1) % apiKey.length)
            return apiKey[current]
        }
        
        case 'conversation-hash': {
            if (conversationId) {
                // 根据 conversationId 哈希选择固定的 key
                const hash = crypto.createHash('md5').update(conversationId).digest('hex')
                const index = parseInt(hash.substring(0, 8), 16) % apiKey.length
                return apiKey[index]
            }
            // fallback to random
        }
        
        case 'random':
        default: {
            const randomIndex = Math.floor(Math.random() * apiKey.length)
            return apiKey[randomIndex]
        }
    }
}

/**
 * Extract class name from code string
 * @param {string} code
 * @returns {string | null}
 */
export function extractClassName(code) {
    const classMatch = code.match(/class\s+(\w+)/)
    return classMatch ? classMatch[1] : null
}

/**
 * Simple async local storage implementation
 */
class AsyncLocalStorage {
    constructor() {
        this.store = new Map()
    }

    /**
     * @param {any} store
     * @param {Function} callback
     */
    async run(store, callback) {
        const id = crypto.randomUUID()
        this.store.set(id, store)
        try {
            return await callback()
        } finally {
            this.store.delete(id)
        }
    }

    getStore() {
        // Return the most recent store
        const values = Array.from(this.store.values())
        return values[values.length - 1]
    }
}

export const asyncLocalStorage = new AsyncLocalStorage()

export { DefaultLogger }

/**
 * 估算 tokens 数量（简易版）
 * @param {string} text - 文本
 * @returns {number} 估算的 token 数
 */
export function estimateTokens(text) {
    if (!text) return 0
    // 粗略估算：英文约 4 字符/token，中文约 1.5 字符/token
    const englishChars = (text.match(/[a-zA-Z0-9\s]/g) || []).length
    const otherChars = text.length - englishChars
    return Math.ceil(englishChars / 4 + otherChars / 1.5)
}

/**
 * 截断消息历史以适应 token 限制
 * @param {Array} messages - 消息数组
 * @param {number} maxTokens - 最大 token 数
 * @param {Object} [options] - 选项
 * @param {boolean} [options.keepSystem=true] - 是否保留系统消息
 * @param {boolean} [options.keepLast=true] - 是否优先保留最新消息
 * @returns {Array} 截断后的消息
 */
export function truncateMessages(messages, maxTokens, options = {}) {
    const { keepSystem = true, keepLast = true } = options
    if (!messages || messages.length === 0) return []
    
    let totalTokens = 0
    const result = []
    
    // 分离系统消息和其他消息
    const systemMessages = keepSystem ? messages.filter(m => m.role === 'system') : []
    const otherMessages = messages.filter(m => m.role !== 'system')
    
    // 计算系统消息的 tokens
    for (const msg of systemMessages) {
        const content = extractTextContent(msg.content)
        totalTokens += estimateTokens(content)
    }
    
    // 从最新到最旧添加消息
    const orderedMessages = keepLast ? [...otherMessages].reverse() : otherMessages
    const selectedMessages = []
    
    for (const msg of orderedMessages) {
        const content = extractTextContent(msg.content)
        const msgTokens = estimateTokens(content)
        
        if (totalTokens + msgTokens <= maxTokens) {
            selectedMessages.push(msg)
            totalTokens += msgTokens
        } else {
            break
        }
    }
    
    // 恢复顺序
    if (keepLast) {
        selectedMessages.reverse()
    }
    
    return [...systemMessages, ...selectedMessages]
}

/**
 * 从消息内容中提取文本
 * @param {string|Array} content - 消息内容
 * @returns {string}
 */
export function extractTextContent(content) {
    if (!content) return ''
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .filter(c => c.type === 'text')
            .map(c => c.text || '')
            .join('\n')
    }
    return ''
}

/**
 * 格式化工具调用结果
 * @param {*} result - 工具调用结果
 * @param {number} [maxLength=2000] - 最大长度
 * @returns {string}
 */
export function formatToolResult(result, maxLength = 2000) {
    if (!result) return 'No result'
    
    let text
    if (typeof result === 'string') {
        text = result
    } else if (result.content) {
        // MCP 格式
        if (Array.isArray(result.content)) {
            text = result.content
                .map(block => block.type === 'text' ? block.text : JSON.stringify(block))
                .join('\n')
        } else {
            text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content)
        }
    } else {
        text = JSON.stringify(result, null, 2)
    }
    
    // 截断过长的结果
    if (text.length > maxLength) {
        return text.substring(0, maxLength) + `\n... [截断，共 ${text.length} 字符]`
    }
    return text
}

/**
 * 验证消息格式
 * @param {Object} message - 消息对象
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMessage(message) {
    if (!message) {
        return { valid: false, error: 'Message is null or undefined' }
    }
    
    if (!message.role) {
        return { valid: false, error: 'Message missing role' }
    }
    
    const validRoles = ['system', 'user', 'assistant', 'tool', 'developer']
    if (!validRoles.includes(message.role)) {
        return { valid: false, error: `Invalid role: ${message.role}` }
    }
    
    // assistant 消息可以没有 content（只有 tool_calls）
    if (message.role !== 'assistant' && !message.content) {
        return { valid: false, error: 'Message missing content' }
    }
    
    return { valid: true }
}

/**
 * 清理消息历史中的无效消息
 * @param {Array} messages - 消息数组
 * @returns {Array}
 */
export function cleanMessages(messages) {
    if (!Array.isArray(messages)) return []
    return messages.filter(msg => validateMessage(msg).valid)
}

/**
 * 生成请求追踪 ID
 * @returns {string}
 */
export function generateTraceId() {
    return `trace_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
}

/**
 * 创建带超时的 AbortController
 * @param {number} ms - 超时时间（毫秒）
 * @returns {{ controller: AbortController, timeout: NodeJS.Timeout }}
 */
export function createAbortController(ms) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ms)
    return { controller, timeout }
}

/**
 * 合并多个 AbortSignal
 * @param  {...AbortSignal} signals
 * @returns {AbortSignal}
 */
export function mergeAbortSignals(...signals) {
    const controller = new AbortController()
    for (const signal of signals) {
        if (signal?.aborted) {
            controller.abort()
            break
        }
        signal?.addEventListener('abort', () => controller.abort())
    }
    return controller.signal
}
