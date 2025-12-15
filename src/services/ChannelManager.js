import config from '../../config/config.js'
import crypto from 'node:crypto'
import { redisClient } from '../core/cache/RedisClient.js'

/**
 * 默认 API 地址
 */
const DEFAULT_BASE_URLS = {
    openai: 'https://api.openai.com/v1',
    claude: 'https://api.anthropic.com/v1',
    gemini: 'https://generativelanguage.googleapis.com'
}

/**
 * 规范化 API Base URL
 * @param {string} baseUrl 
 * @param {string} adapterType 
 * @returns {string}
 */
function normalizeBaseUrl(baseUrl, adapterType) {
    // 如果为空，使用默认地址
    if (!baseUrl || !baseUrl.trim()) {
        return DEFAULT_BASE_URLS[adapterType] || ''
    }
    
    // 移除末尾斜杠
    let url = baseUrl.trim().replace(/\/+$/, '')
    
    // OpenAI 兼容 API 自动添加 /v1
    if (adapterType === 'openai') {
        if (!url.endsWith('/v1') && !url.includes('/chat/') && !url.includes('/models')) {
            url = url + '/v1'
        }
    }
    
    // Claude API 自动添加 /v1
    if (adapterType === 'claude') {
        if (!url.endsWith('/v1') && !url.includes('/messages')) {
            url = url + '/v1'
        }
    }
    
    return url
}

/**
 * Channel Manager - Manages multiple API channels
 */
export class ChannelManager {
    constructor() {
        this.channels = new Map()
        this.activeRequests = new Map()
        this.channelStats = new Map() // 渠道使用统计
        this.initialized = false
    }

    /**
     * Initialize channel manager
     */
    async init() {
        if (this.initialized) return

        await this.loadChannels()
        await redisClient.init()
        this.initialized = true
        logger.info('[ChannelManager] Initialized')
    }

    /**
     * Load channels from configuration
     */
    async loadChannels() {
        const channels = config.get('channels') || []

        for (const channelConfig of channels) {
            // 规范化 baseUrl（兼容旧配置）
            const normalizedUrl = normalizeBaseUrl(channelConfig.baseUrl, channelConfig.adapterType)
            
            this.channels.set(channelConfig.id, {
                ...channelConfig,
                baseUrl: normalizedUrl,
                status: channelConfig.status || 'idle',
                lastHealthCheck: channelConfig.lastHealthCheck || null,
                testedAt: channelConfig.testedAt || null,
                // 自定义请求头
                customHeaders: channelConfig.customHeaders || {},
                headersTemplate: channelConfig.headersTemplate || '',
                requestBodyTemplate: channelConfig.requestBodyTemplate || '',
                modelsCached: false,
                keyIndex: 0
            })
        }
    }

    /**
     * Get all channels
     * @returns {Array} List of channels
     */
    getAll() {
        return Array.from(this.channels.values())
    }

    /**
     * Get channel by ID
     * @param {string} id
     * @returns {Object|null}
     */
    get(id) {
        return this.channels.get(id) || null
    }

    /**
     * Create new channel
     * @param {Object} channelData
     * @returns {Object} Created channel
     */
    async create(channelData) {
        const id = channelData.id || `${channelData.adapterType}-${crypto.randomBytes(4).toString('hex')}`
        
        // 规范化 baseUrl
        const normalizedUrl = normalizeBaseUrl(channelData.baseUrl, channelData.adapterType)

        const channel = {
            id,
            name: channelData.name,
            adapterType: channelData.adapterType,
            baseUrl: normalizedUrl,
            apiKey: channelData.apiKey,
            models: channelData.models || [],
            priority: channelData.priority || 100,
            enabled: channelData.enabled !== false,
            advanced: channelData.advanced || {},
            apiKeys: channelData.apiKeys || [],
            strategy: channelData.strategy || 'round-robin',
            // 自定义请求头配置（支持JSON模板和占位符）
            customHeaders: channelData.customHeaders || {},
            // 请求头JSON模板（支持占位符如 {{API_KEY}}, {{UA}}, {{XFF}} 等）
            headersTemplate: channelData.headersTemplate || '',
            // 自定义请求体模板（JSON格式）
            requestBodyTemplate: channelData.requestBodyTemplate || '',
            status: 'idle',
            lastHealthCheck: null,
            modelsCached: false,
            keyIndex: 0
        }

        this.channels.set(id, channel)
        await this.saveToConfig()

        return channel
    }

    /**
     * Update channel
     * @param {string} id
     * @param {Object} updates
     * @returns {Object|null}
     */
    async update(id, updates) {
        const channel = this.channels.get(id)
        if (!channel) return null

        // Update allowed fields
        const allowedFields = ['name', 'adapterType', 'baseUrl', 'apiKey', 'apiKeys', 'strategy', 'models', 'priority', 'enabled', 'advanced', 'customHeaders', 'headersTemplate', 'requestBodyTemplate']
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                // 规范化 baseUrl
                if (field === 'baseUrl') {
                    const adapterType = updates.adapterType || channel.adapterType
                    channel[field] = normalizeBaseUrl(updates[field], adapterType)
                } else {
                    channel[field] = updates[field]
                }
            }
        }

        // Clear model cache if credentials or adapter type changed
        if (updates.apiKey || updates.baseUrl || updates.apiKeys || updates.adapterType) {
            channel.modelsCached = false
            channel.status = undefined  // Reset status when config changes
            await redisClient.del(`models:${id}`)
        }

        this.channels.set(id, channel)
        await this.saveToConfig()

        return channel
    }

    /**
     * Delete channel
     * @param {string} id
     * @returns {boolean}
     */
    async delete(id) {
        // Don't allow deleting default channels, only disable them
        if (id.endsWith('-default')) {
            const channel = this.channels.get(id)
            if (channel) {
                channel.enabled = false
                await this.saveToConfig()
                return true
            }
            return false
        }

        const deleted = this.channels.delete(id)
        if (deleted) {
            await redisClient.del(`models:${id}`)
            await this.saveToConfig()
        }
        return deleted
    }

    /**
     * Fetch models from API for a channel
     * @param {string} id
     * @returns {Promise<Array>}
     */
    async fetchModels(id) {
        const channel = this.channels.get(id)
        if (!channel) {
            throw new Error('Channel not found')
        }

        // Check cache
        const cached = await redisClient.get(`models:${id}`)
        if (cached) {
            try {
                return JSON.parse(cached)
            } catch (e) {
                // Ignore parse error
            }
        }

        let models = []

        try {
            if (channel.adapterType === 'openai') {
                models = await this.fetchOpenAIModels(channel)
            } else if (channel.adapterType === 'gemini') {
                models = await this.fetchGeminiModels(channel)
            } else if (channel.adapterType === 'claude') {
                models = await this.fetchClaudeModels(channel)
            }

            // Cache the result (1 hour)
            await redisClient.set(`models:${id}`, JSON.stringify(models), 3600)

            // Update channel
            channel.models = models
            channel.modelsCached = true
            channel.status = 'active'
            this.channels.set(id, channel)

            return models
        } catch (error) {
            channel.status = 'error'
            this.channels.set(id, channel)
            throw error
        }
    }

    /**
     * Fetch OpenAI models
     */
    async fetchOpenAIModels(channel) {
        const OpenAI = (await import('openai')).default
        const openai = new OpenAI({
            apiKey: channel.apiKey,
            baseURL: channel.baseUrl,
            // 添加浏览器请求头避免 CF 拦截
            defaultHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
        })

        const modelsList = await openai.models.list()
        // 不过滤模型，返回所有
        const models = modelsList.data
            .map(m => m.id)
            .sort()

        return models
    }

    /**
     * Fetch Gemini models
     */
    async fetchGeminiModels(channel) {
        // Gemini doesn't have a public models list API yet
        // Return known models
        return [
            'gemini-pro',
            'gemini-pro-vision',
            'gemini-1.5-pro',
            'gemini-1.5-pro-latest',
            'gemini-1.5-flash',
            'gemini-1.5-flash-latest',
            'gemini-1.5-flash-8b',
            'gemini-2.0-flash-exp',
            'text-embedding-004'
        ]
    }

    /**
     * Fetch Claude models
     */
    async fetchClaudeModels(channel) {
        // Claude doesn't have a models list API
        // Return known models
        return [
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307'
        ]
    }

    /**
     * Get API key for channel (handles rotation)
     * @param {Object} channel
     * @returns {string} apiKey
     */
    getChannelKey(channel) {
        // Legacy/Single key
        if (!channel.apiKeys || channel.apiKeys.length === 0) {
            return channel.apiKey
        }

        const activeKeys = channel.apiKeys.filter(k => typeof k === 'string' || k.enabled !== false)

        if (activeKeys.length === 0) {
            return channel.apiKey
        }

        // Strategy
        if (channel.strategy === 'random') {
            const randomKey = activeKeys[Math.floor(Math.random() * activeKeys.length)]
            return typeof randomKey === 'string' ? randomKey : randomKey.key
        } else {
            // Round-robin
            let index = channel.keyIndex || 0
            if (index >= activeKeys.length) index = 0

            const keyObj = activeKeys[index]
            const key = typeof keyObj === 'string' ? keyObj : keyObj.key

            // Update index
            channel.keyIndex = (index + 1) % activeKeys.length

            return key
        }
    }

    /**
     * Test channel connection
     * @param {string} id
     * @param {Object} options - 测试选项
     * @param {string} options.model - 指定测试模型
     * @param {boolean} options.skipModelCheck - 跳过模型列表检查
     * @returns {Promise<Object>}
     */
    async testConnection(id, options = {}) {
        const channel = this.channels.get(id)
        if (!channel) {
            throw new Error('Channel not found')
        }

        const { model, skipModelCheck = false } = options
        
        try {
            if (channel.adapterType === 'openai') {
                const { OpenAIClient } = await import('../core/adapters/index.js')
                const apiKey = this.getChannelKey(channel)
                
                // 选择测试模型：优先使用指定模型，其次使用渠道配置的第一个模型，最后使用默认模型
                const testModel = model || channel.models?.[0] || 'gpt-3.5-turbo'
                
                const client = new OpenAIClient({
                    apiKey: apiKey,
                    baseUrl: channel.baseUrl,
                    features: ['chat'],
                    tools: []
                })

                try {
                    const response = await client.sendMessage(
                        { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                        { model: testModel, maxToken: 20 }
                    )

                    const replyText = response.contents
                        ?.filter(c => c.type === 'text')
                        ?.map(c => c.text)
                        ?.join('') || ''

                    channel.status = 'active'
                    channel.lastHealthCheck = Date.now()
                    channel.testedAt = Date.now()
                    channel.errorCount = 0 // 重置错误计数
                    this.channels.set(id, channel)
                    await this.saveToConfig() // 持久化状态

                    return {
                        success: true,
                        message: replyText ? `连接成功！AI回复：${replyText}` : '连接成功！',
                        testResponse: replyText,
                        model: testModel
                    }
                } catch (chatError) {
                    // 某些中转站可能chat接口报401但实际可用（需要特定模型）
                    // 尝试获取模型列表来验证API Key是否有效
                    if (chatError.message?.includes('401') || chatError.message?.includes('Unauthorized')) {
                        logger.warn(`[ChannelManager] 测试聊天失败(401)，尝试获取模型列表验证: ${channel.name}`)
                        
                        try {
                            // 尝试获取模型列表
                            const models = await this.fetchModels(id)
                            if (models && models.length > 0) {
                                channel.status = 'active'
                                channel.lastHealthCheck = Date.now()
                                channel.testedAt = Date.now()
                                channel.errorCount = 0
                                this.channels.set(id, channel)
                                await this.saveToConfig() // 持久化状态
                                
                                return {
                                    success: true,
                                    message: `连接验证成功（通过模型列表）！可用模型数: ${models.length}`,
                                    models: models.slice(0, 5),
                                    note: '聊天测试返回401，但API Key有效。请确认使用正确的模型名称。'
                                }
                            }
                        } catch (modelError) {
                            // 模型列表也失败，可能是真正的认证问题
                            logger.warn(`[ChannelManager] 获取模型列表也失败: ${modelError.message}`)
                        }
                    }
                    throw chatError
                }
            } else if (channel.adapterType === 'gemini') {
                // Gemini 测试
                const { GeminiClient } = await import('../core/adapters/index.js')
                const client = new GeminiClient({
                    apiKey: this.getChannelKey(channel),
                    baseUrl: channel.baseUrl,
                    features: ['chat'],
                    tools: []
                })
                
                const testModel = model || channel.models?.[0] || 'gemini-pro'
                const response = await client.sendMessage(
                    { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                    { model: testModel, maxToken: 20 }
                )
                
                const replyText = response.contents
                    ?.filter(c => c.type === 'text')
                    ?.map(c => c.text)
                    ?.join('') || ''
                
                channel.status = 'active'
                channel.lastHealthCheck = Date.now()
                channel.testedAt = Date.now()
                this.channels.set(id, channel)
                await this.saveToConfig() // 持久化状态
                
                return {
                    success: true,
                    message: replyText ? `连接成功！AI回复：${replyText}` : '连接成功！',
                    testResponse: replyText
                }
            } else if (channel.adapterType === 'claude') {
                // Claude 测试
                const { ClaudeClient } = await import('../core/adapters/index.js')
                const client = new ClaudeClient({
                    apiKey: this.getChannelKey(channel),
                    baseUrl: channel.baseUrl,
                    features: ['chat'],
                    tools: []
                })
                
                const testModel = model || channel.models?.[0] || 'claude-3-haiku-20240307'
                const response = await client.sendMessage(
                    { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                    { model: testModel, maxToken: 20 }
                )
                
                const replyText = response.contents
                    ?.filter(c => c.type === 'text')
                    ?.map(c => c.text)
                    ?.join('') || ''
                
                channel.status = 'active'
                channel.lastHealthCheck = Date.now()
                channel.testedAt = Date.now()
                this.channels.set(id, channel)
                await this.saveToConfig() // 持久化状态
                
                return {
                    success: true,
                    message: replyText ? `连接成功！AI回复：${replyText}` : '连接成功！',
                    testResponse: replyText
                }
            }

            // 未知适配器类型
            return { success: true, message: '该适配器类型暂不支持完整测试' }
        } catch (error) {
            channel.status = 'error'
            channel.lastHealthCheck = Date.now()
            channel.errorCount = (channel.errorCount || 0) + 1
            this.channels.set(id, channel)
            await this.saveToConfig() // 持久化错误状态
            throw error
        }
    }

    /**
     * Get best channel for a model
     * @param {string} model
     * @returns {Object|null}
     */
    getBestChannel(model) {
        const strategy = config.get('loadBalancing.strategy') || 'priority'

        // Filter channels that support the model and are enabled
        let candidates = Array.from(this.channels.values()).filter(ch =>
            ch.enabled &&
            ch.status !== 'error' &&
            (ch.models.includes(model) || ch.models.includes('*'))
        )

        // Filter out channels that failed health check recently (e.g. last 5 mins)
        const now = Date.now()
        candidates = candidates.filter(ch => {
            if (ch.lastErrorTime && (now - ch.lastErrorTime < 5 * 60 * 1000)) {
                return false
            }
            return true
        })

        // Filter out channels over quota
        candidates = candidates.filter(ch => {
            if (ch.quota && ch.usage) {
                // Check daily quota
                const today = new Date().toISOString().split('T')[0]
                if (ch.usage.date === today && ch.usage.count >= ch.quota.daily) {
                    return false
                }
            }
            return true
        })

        if (candidates.length === 0) return null

        if (strategy === 'priority') {
            return candidates.sort((a, b) => a.priority - b.priority)[0]
        } else if (strategy === 'round-robin') {
            // Simple round robin based on last used time
            return candidates.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))[0]
        } else if (strategy === 'random') {
            return candidates[Math.floor(Math.random() * candidates.length)]
        } else if (strategy === 'least-connection') {
            // Least connection strategy
            return candidates.sort((a, b) => {
                const countA = this.activeRequests.get(a.id) || 0
                const countB = this.activeRequests.get(b.id) || 0
                return countA - countB
            })[0]
        }

        return candidates[0]
    }

    /**
     * Start tracking a request for a channel
     * @param {string} channelId 
     */
    startRequest(channelId) {
        const count = this.activeRequests.get(channelId) || 0
        this.activeRequests.set(channelId, count + 1)
    }

    /**
     * End tracking a request for a channel
     * @param {string} channelId 
     */
    endRequest(channelId) {
        const count = this.activeRequests.get(channelId) || 0
        if (count > 0) {
            this.activeRequests.set(channelId, count - 1)
        }
    }

    /**
     * Report channel usage
     * @param {string} channelId 
     * @param {number} tokens 
     */
    async reportUsage(channelId, tokens = 0) {
        const channel = this.channels.get(channelId)
        if (!channel) return

        channel.lastUsed = Date.now()

        // Update usage stats
        const today = new Date().toISOString().split('T')[0]
        if (!channel.usage || channel.usage.date !== today) {
            channel.usage = { date: today, count: 0, tokens: 0 }
        }

        channel.usage.count++
        channel.usage.tokens += tokens

        // Persist changes (mock)
        // await this.saveChannels()
    }

    /**
     * Report channel error
     * @param {string} channelId 
     */
    async reportError(channelId) {
        const channel = this.channels.get(channelId)
        if (!channel) return

        channel.lastErrorTime = Date.now()
        channel.errorCount = (channel.errorCount || 0) + 1

        // If too many errors, mark as error status
        if (channel.errorCount > 5) {
            channel.status = 'error'
        }
    }

    /**
     * Save channels to config
     */
    async saveToConfig() {
        const channelsArray = Array.from(this.channels.values())
            .filter(ch => !ch.id.endsWith('-default')) // Don't save default channels
            .map(ch => ({
                id: ch.id,
                name: ch.name,
                adapterType: ch.adapterType,
                baseUrl: ch.baseUrl,
                apiKey: ch.apiKey,
                models: ch.models,
                priority: ch.priority,
                enabled: ch.enabled,
                advanced: ch.advanced,
                apiKeys: ch.apiKeys,
                strategy: ch.strategy,
                // 自定义请求头
                customHeaders: ch.customHeaders,
                // 请求头/请求体JSON模板
                headersTemplate: ch.headersTemplate,
                requestBodyTemplate: ch.requestBodyTemplate,
                // 保存状态信息
                status: ch.status,
                lastHealthCheck: ch.lastHealthCheck,
                testedAt: ch.testedAt
            }))

        config.set('channels', channelsArray)
    }

    /**
     * 记录渠道使用
     * @param {string} channelId 
     * @param {Object} usage { tokens, success, duration }
     */
    recordUsage(channelId, usage = {}) {
        let stats = this.channelStats.get(channelId)
        if (!stats) {
            stats = {
                totalCalls: 0,
                successCalls: 0,
                failedCalls: 0,
                totalTokens: 0,
                totalDuration: 0,
                lastUsed: null
            }
            this.channelStats.set(channelId, stats)
        }

        stats.totalCalls++
        if (usage.success !== false) {
            stats.successCalls++
        } else {
            stats.failedCalls++
        }
        if (usage.tokens) {
            stats.totalTokens += usage.tokens
        }
        if (usage.duration) {
            stats.totalDuration += usage.duration
        }
        stats.lastUsed = Date.now()
    }

    /**
     * 获取渠道统计
     * @param {string} channelId 
     */
    getStats(channelId) {
        if (channelId) {
            return this.channelStats.get(channelId) || null
        }
        // 返回所有统计
        const allStats = {}
        for (const [id, stats] of this.channelStats) {
            allStats[id] = stats
        }
        return allStats
    }

    /**
     * 获取所有渠道及其统计
     */
    getAllWithStats() {
        return Array.from(this.channels.values()).map(ch => ({
            ...ch,
            stats: this.channelStats.get(ch.id) || {
                totalCalls: 0,
                successCalls: 0,
                failedCalls: 0,
                totalTokens: 0
            }
        }))
    }

    /**
     * 清空统计
     */
    clearStats() {
        this.channelStats.clear()
    }
}

// Export singleton
export const channelManager = new ChannelManager()
