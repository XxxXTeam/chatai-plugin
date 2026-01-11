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
            text = result.content.map(block => (block.type === 'text' ? block.text : JSON.stringify(block))).join('\n')
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

/**
 * API 提供商信息
 */
export const API_PROVIDERS = {
    openai: {
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        features: ['chat', 'embedding', 'vision', 'audio', 'tools'],
        models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    gemini: {
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        features: ['chat', 'vision', 'tools', 'grounding'],
        models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'],
        authHeader: 'x-goog-api-key',
        authPrefix: ''
    },
    claude: {
        name: 'Anthropic Claude',
        baseUrl: 'https://api.anthropic.com',
        features: ['chat', 'vision', 'tools', 'thinking'],
        models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
        authHeader: 'x-api-key',
        authPrefix: '',
        extraHeaders: { 'anthropic-version': '2023-06-01' }
    },
    grok: {
        name: 'xAI Grok',
        baseUrl: 'https://api.x.ai/v1',
        features: ['chat', 'tools'],
        models: ['grok-3', 'grok-3-mini', 'grok-2'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    mistral: {
        name: 'Mistral AI',
        baseUrl: 'https://api.mistral.ai/v1',
        features: ['chat', 'embedding', 'tools'],
        models: ['mistral-large-latest', 'mistral-medium-latest', 'codestral-latest'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    groq: {
        name: 'Groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        features: ['chat', 'tools'],
        models: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },

    // 国内厂商
    deepseek: {
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        features: ['chat', 'tools', 'reasoning'],
        models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    zhipu: {
        name: '智谱AI',
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        features: ['chat', 'vision', 'tools', 'embedding'],
        models: ['glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-4v-plus'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    qwen: {
        name: '阿里通义千问',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        features: ['chat', 'vision', 'tools', 'embedding'],
        models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-vl-max'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    moonshot: {
        name: 'Moonshot Kimi',
        baseUrl: 'https://api.moonshot.cn/v1',
        features: ['chat', 'tools', 'file'],
        models: ['moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    minimax: {
        name: 'MiniMax',
        baseUrl: 'https://api.minimax.chat/v1',
        features: ['chat', 'tools', 'tts'],
        models: ['abab6.5s-chat', 'abab6.5g-chat', 'abab5.5-chat'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    yi: {
        name: '零一万物',
        baseUrl: 'https://api.lingyiwanwu.com/v1',
        features: ['chat', 'vision', 'tools'],
        models: ['yi-lightning', 'yi-large', 'yi-medium', 'yi-vision'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    baichuan: {
        name: '百川智能',
        baseUrl: 'https://api.baichuan-ai.com/v1',
        features: ['chat', 'tools'],
        models: ['Baichuan4', 'Baichuan3-Turbo', 'Baichuan3-Turbo-128k'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },

    // 中转服务
    openrouter: {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        features: ['chat', 'vision', 'tools', 'multi-model'],
        models: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-pro'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer ',
        extraHeaders: { 'HTTP-Referer': 'https://github.com/your-app' }
    },
    siliconflow: {
        name: '硅基流动',
        baseUrl: 'https://api.siliconflow.cn/v1',
        features: ['chat', 'vision', 'tools', 'embedding'],
        models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    },
    together: {
        name: 'Together AI',
        baseUrl: 'https://api.together.xyz/v1',
        features: ['chat', 'tools', 'embedding'],
        models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    }
}

/**
 * 检测模型特性
 * @param {string} model - 模型名称
 * @returns {Object} 模型特性
 */
export function detectModelFeatures(model) {
    const modelLower = model.toLowerCase()

    return {
        isReasoning: /reasoner|thinking|o1|o3|r1|deepseek-r/i.test(model),

        // 视觉能力
        hasVision: /vision|vl|4o|gemini|claude-3|gpt-4-turbo|qwen-vl/i.test(model),

        // 长上下文
        isLongContext: /128k|200k|long|1m/i.test(model),

        // 代码专用
        isCoder: /coder|codestral|code/i.test(model),

        // 快速/轻量
        isFast: /flash|mini|lite|turbo|instant|fast|speed/i.test(model),

        // 高级/大型
        isAdvanced: /plus|pro|large|max|opus|ultra|premium/i.test(model),

        // 嵌入模型
        isEmbedding: /embed|embedding/i.test(model),

        // 多模态
        isMultimodal: /vision|vl|4o|gemini|claude-3|omni/i.test(model)
    }
}

/**
 * 根据 baseUrl 检测 API 提供商
 * @param {string} baseUrl - API 地址
 * @returns {string|null} 提供商标识
 */
export function detectProviderFromUrl(baseUrl) {
    if (!baseUrl) return null
    const url = baseUrl.toLowerCase()

    if (url.includes('openai.com')) return 'openai'
    if (url.includes('anthropic.com')) return 'claude'
    if (url.includes('googleapis.com') || url.includes('gemini')) return 'gemini'
    if (url.includes('x.ai') || url.includes('grok')) return 'grok'
    if (url.includes('mistral.ai')) return 'mistral'
    if (url.includes('groq.com')) return 'groq'
    if (url.includes('deepseek.com')) return 'deepseek'
    if (url.includes('bigmodel.cn') || url.includes('zhipu')) return 'zhipu'
    if (url.includes('dashscope.aliyuncs.com') || url.includes('qwen')) return 'qwen'
    if (url.includes('moonshot.cn')) return 'moonshot'
    if (url.includes('minimax.chat')) return 'minimax'
    if (url.includes('lingyiwanwu.com')) return 'yi'
    if (url.includes('baichuan-ai.com')) return 'baichuan'
    if (url.includes('openrouter.ai')) return 'openrouter'
    if (url.includes('siliconflow.cn')) return 'siliconflow'
    if (url.includes('together.xyz')) return 'together'
    if (url.includes('fireworks.ai')) return 'fireworks'
    if (url.includes('volces.com') || url.includes('doubao')) return 'doubao'
    if (url.includes('xf-yun.com') || url.includes('spark')) return 'spark'
    if (url.includes('hunyuan')) return 'hunyuan'
    if (url.includes('baidubce.com') || url.includes('wenxin')) return 'baidu'

    return null
}

/**
 * 获取提供商的默认配置
 * @param {string} provider - 提供商标识
 * @returns {Object|null} 提供商配置
 */
export function getProviderConfig(provider) {
    return API_PROVIDERS[provider] || null
}

/**
 * 构建认证头
 * @param {string} provider - 提供商标识
 * @param {string} apiKey - API Key
 * @returns {Object} 认证头对象
 */
export function buildAuthHeaders(provider, apiKey) {
    const config = API_PROVIDERS[provider]
    if (!config) {
        // 默认使用 Bearer 认证
        return { Authorization: `Bearer ${apiKey}` }
    }

    const headers = {
        [config.authHeader]: `${config.authPrefix}${apiKey}`
    }

    // 添加额外的必需头
    if (config.extraHeaders) {
        Object.assign(headers, config.extraHeaders)
    }

    return headers
}

/**
 * 规范化 API 响应错误
 * @param {Error} error - 原始错误
 * @param {string} provider - 提供商
 * @returns {Object} 规范化的错误对象
 */
export function normalizeApiError(error, provider) {
    const status = error.status || error.response?.status
    const code = error.code || error.error?.code
    const message = error.message || error.error?.message || '未知错误'

    // 常见错误类型映射
    let errorType = 'unknown'
    let suggestion = ''

    if (status === 401 || code === 'invalid_api_key') {
        errorType = 'auth_error'
        suggestion = '请检查 API Key 是否正确'
    } else if (status === 429 || code === 'rate_limit_exceeded') {
        errorType = 'rate_limit'
        suggestion = '请求过于频繁，请稍后重试'
    } else if (status === 400 || code === 'invalid_request_error') {
        errorType = 'invalid_request'
        suggestion = '请检查请求参数是否正确'
    } else if (status === 404) {
        errorType = 'not_found'
        suggestion = '模型或接口不存在，请检查配置'
    } else if (status === 500 || status === 502 || status === 503) {
        errorType = 'server_error'
        suggestion = '服务端错误，请稍后重试'
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
        errorType = 'network_error'
        suggestion = '网络连接失败，请检查网络或代理配置'
    }

    return {
        provider,
        status,
        code,
        type: errorType,
        message,
        suggestion,
        originalError: error
    }
}

/**
 * 重试工具函数
 * @param {Function} fn - 要重试的函数
 * @param {Object} options - 重试选项
 * @returns {Promise<any>}
 */
export async function withRetry(fn, options = {}) {
    const { maxRetries = 3, delay = 1000, backoff = 2, shouldRetry = () => true } = options

    let lastError
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error
            if (i < maxRetries - 1 && shouldRetry(error, i)) {
                const waitTime = delay * Math.pow(backoff, i)
                await new Promise(resolve => setTimeout(resolve, waitTime))
            }
        }
    }
    throw lastError
}
