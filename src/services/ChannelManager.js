import config from '../../config/config.js'
import crypto from 'node:crypto'
import { redisClient } from '../core/cache/RedisClient.js'

/**
 * Channel Manager - Manages multiple API channels
 */
export class ChannelManager {
    constructor() {
        this.channels = new Map()
        this.activeRequests = new Map()
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
            this.channels.set(channelConfig.id, {
                ...channelConfig,
                status: 'idle',
                lastHealthCheck: null,
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

        const channel = {
            id,
            name: channelData.name,
            adapterType: channelData.adapterType,
            baseUrl: channelData.baseUrl,
            apiKey: channelData.apiKey,
            models: channelData.models || [],
            priority: channelData.priority || 100,
            enabled: channelData.enabled !== false,
            advanced: channelData.advanced || {},
            apiKeys: channelData.apiKeys || [],
            strategy: channelData.strategy || 'round-robin',
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
        const allowedFields = ['name', 'baseUrl', 'apiKey', 'apiKeys', 'strategy', 'models', 'priority', 'enabled', 'advanced']
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                channel[field] = updates[field]
            }
        }

        // Clear model cache if credentials changed
        if (updates.apiKey || updates.baseUrl || updates.apiKeys) {
            channel.modelsCached = false
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
            baseURL: channel.baseUrl
        })

        const modelsList = await openai.models.list()
        const models = modelsList.data
            .map(m => m.id)
            .filter(id => {
                // Filter for chat and embedding models
                return id.includes('gpt') ||
                    id.includes('text-embedding') ||
                    id.includes('o1') ||
                    id.includes('davinci') ||
                    id.includes('babbage') ||
                    id.includes('curie')
            })
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
     * @returns {Promise<Object>}
     */
    async testConnection(id) {
        const channel = this.channels.get(id)
        if (!channel) {
            throw new Error('Channel not found')
        }

        try {
            if (channel.adapterType === 'openai') {
                const { OpenAIClient } = await import('../core/adapters/index.js')
                const client = new OpenAIClient({
                    apiKey: this.getChannelKey(channel),
                    baseUrl: channel.baseUrl,
                    features: ['chat'],
                    tools: []
                })

                const response = await client.sendMessage(
                    { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                    { model: channel.models[0] || 'gpt-3.5-turbo', maxToken: 20 }
                )

                const replyText = response.contents
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('')

                channel.status = 'active'
                channel.lastHealthCheck = Date.now()
                this.channels.set(id, channel)

                return {
                    success: true,
                    message: '连接成功！AI回复：' + replyText,
                    testResponse: replyText
                }
            }

            // For other adapters, just return success for now
            return { success: true, message: '该适配器暂不支持测试' }
        } catch (error) {
            channel.status = 'error'
            channel.lastHealthCheck = Date.now()
            this.channels.set(id, channel)
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
                strategy: ch.strategy
            }))

        config.set('channels', channelsArray)
    }
}

// Export singleton
export const channelManager = new ChannelManager()
