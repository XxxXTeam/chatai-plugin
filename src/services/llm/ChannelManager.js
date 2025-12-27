import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import config from '../../../config/config.js'
import crypto from 'node:crypto'
import { redisClient } from '../../core/cache/RedisClient.js'
import { statsService } from '../stats/StatsService.js'

/**
 * 默认 API 地址
 */
const DEFAULT_BASE_URLS = {
    openai: 'https://api.openai.com/v1',
    claude: 'https://api.anthropic.com/v1',
    gemini: 'https://generativelanguage.googleapis.com'
}

/*
 * @param {string} url 
 * @returns {boolean}
 */
function hasCustomPath(url) {
    try {
        const parsed = new URL(url)
        const path = parsed.pathname.replace(/\/+$/, '')
        return path && path !== ''
    } catch (e) {
        return /\/v\d+/.test(url) || /\/api\//.test(url) || /\/openai\//.test(url)
    }
}

/**
 * 规范化 API Base URL
 * 默认添加 /v1，除非用户已指定自定义路径
 * @param {string} baseUrl 
 * @param {string} adapterType 
 * @returns {string}
 */
export function normalizeBaseUrl(baseUrl, adapterType) {
    // 如果为空，使用默认地址
    if (!baseUrl || !baseUrl.trim()) {
        return DEFAULT_BASE_URLS[adapterType] || ''
    }
    
    // 移除末尾斜杠
    let url = baseUrl.trim().replace(/\/+$/, '')
    if (hasCustomPath(url)) {
        return url
    }
    if (adapterType === 'openai') {
        url = url + '/v1'
    }
    if (adapterType === 'claude') {
        url = url + '/v1'
    }
    
    return url
}

// APIKey轮询策略
export const KeyStrategy = {
    ROUND_ROBIN: 'round-robin',  // 轮询
    RANDOM: 'random',            // 随机
    WEIGHTED: 'weighted',        // 权重
    LEAST_USED: 'least-used',    // 最少使用
    FAILOVER: 'failover'         // 故障转移（按顺序，失败后换下一个）
}

// 渠道状态
export const ChannelStatus = {
    IDLE: 'idle',
    ACTIVE: 'active',
    ERROR: 'error',
    DISABLED: 'disabled',
    QUOTA_EXCEEDED: 'quota_exceeded'
}

export class ChannelManager {
    constructor() {
        this.channels = new Map()
        this.activeRequests = new Map()
        this.channelStats = new Map() // 渠道使用统计
        this.keyStats = new Map()     // APIKey使用统计
        this.initialized = false
        this.healthCheckInterval = null
    }

    async init() {
        if (this.initialized) return

        await this.loadChannels()
        await redisClient.init()
        this.initialized = true
        logger.info('[ChannelManager] Initialized')
    }

    /**
     * 从配置加载渠道
     */
    async loadChannels() {
        const channels = config.get('channels') || []

        for (const channelConfig of channels) {
            const normalizedUrl = normalizeBaseUrl(channelConfig.baseUrl, channelConfig.adapterType)
            
            this.channels.set(channelConfig.id, {
                ...channelConfig,
                baseUrl: normalizedUrl,
                status: channelConfig.status || ChannelStatus.IDLE,
                lastHealthCheck: channelConfig.lastHealthCheck || null,
                testedAt: channelConfig.testedAt || null,
                // 自定义请求头
                customHeaders: channelConfig.customHeaders || {},
                headersTemplate: channelConfig.headersTemplate || '',
                requestBodyTemplate: channelConfig.requestBodyTemplate || '',
                // 多APIKey支持
                apiKeys: this.normalizeApiKeys(channelConfig.apiKeys || []),
                strategy: channelConfig.strategy || KeyStrategy.ROUND_ROBIN,
                // 拓展覆盖配置
                overrides: channelConfig.overrides || {},
                endpoints: channelConfig.endpoints || {},
                auth: channelConfig.auth || { type: 'bearer' },
                // 高级配置
                timeout: channelConfig.timeout || { connect: 10000, read: 60000 },
                retry: channelConfig.retry || { maxAttempts: 3, delay: 1000, backoff: 'exponential' },
                quota: channelConfig.quota || { daily: 0, hourly: 0, perMinute: 0 }, // 0表示无限制
                weight: channelConfig.weight || 100, // 权重 1-100
                // 运行时状态
                modelsCached: false,
                keyIndex: 0,
                errorCount: channelConfig.errorCount || 0,
                lastErrorTime: channelConfig.lastErrorTime || null
            })
        }
    }

    /**
     * @param {Array} keys - 原始key数组
     * @returns {Array} 标准化后的key对象数组
     */
    normalizeApiKeys(keys) {
        if (!Array.isArray(keys)) return []
        return keys.map((k, index) => {
            if (typeof k === 'string') {
                return {
                    key: k,
                    name: `Key ${index + 1}`,
                    enabled: true,
                    weight: 100,
                    usageCount: 0,
                    errorCount: 0,
                    lastUsed: null,
                    lastError: null
                }
            }
            return {
                key: k.key,
                name: k.name || `Key ${index + 1}`,
                enabled: k.enabled !== false,
                weight: k.weight || 100,
                usageCount: k.usageCount || 0,
                errorCount: k.errorCount || 0,
                lastUsed: k.lastUsed || null,
                lastError: k.lastError || null
            }
        })
    }

    /**
     * 获取所有渠道
     * @returns {Array} 渠道列表
     */
    getAll() {
        return Array.from(this.channels.values())
    }

    /**
     * 根据ID获取渠道
     * @param {string} id - 渠道ID
     * @returns {Object|null} 渠道对象或null
     */
    get(id) {
        return this.channels.get(id) || null
    }

    /**
     * 创建新渠道
     * @param {Object} channelData - 渠道数据
     * @returns {Object} 创建的渠道
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
            apiKeys: this.normalizeApiKeys(channelData.apiKeys || []),
            strategy: channelData.strategy || KeyStrategy.ROUND_ROBIN,
            customHeaders: channelData.customHeaders || {},
            headersTemplate: channelData.headersTemplate || '',
            requestBodyTemplate: channelData.requestBodyTemplate || '',
            overrides: {
                temperature: channelData.overrides?.temperature,       // 温度 0-2
                maxTokens: channelData.overrides?.maxTokens,           // 最大输出token
                topP: channelData.overrides?.topP,                     // Top-P采样
                topK: channelData.overrides?.topK,                     // Top-K采样
                frequencyPenalty: channelData.overrides?.frequencyPenalty, // 频率惩罚
                presencePenalty: channelData.overrides?.presencePenalty,   // 存在惩罚
                stopSequences: channelData.overrides?.stopSequences || [],  // 停止序列
                systemPromptPrefix: channelData.overrides?.systemPromptPrefix || '', // 系统提示前缀
                systemPromptSuffix: channelData.overrides?.systemPromptSuffix || '', // 系统提示后缀
                modelMapping: channelData.overrides?.modelMapping || {}, 
                ...(channelData.overrides || {})
            },
            endpoints: {
                chat: channelData.endpoints?.chat || '',           // 聊天端点，如 /chat/completions
                models: channelData.endpoints?.models || '',       // 模型列表端点
                embeddings: channelData.endpoints?.embeddings || '',// 嵌入端点
                images: channelData.endpoints?.images || '',       // 图像生成端点
                ...(channelData.endpoints || {})
            },
            // 认证方式覆盖
            auth: {
                type: channelData.auth?.type || 'bearer',          // bearer/api-key/custom
                headerName: channelData.auth?.headerName || '',    // 自定义认证头名称
                prefix: channelData.auth?.prefix || '',            // 认证值前缀
                ...(channelData.auth || {})
            },
            // 图片处理配置
            imageConfig: {
                // 图片传递方式: 'base64' | 'url' | 'auto'
                transferMode: channelData.imageConfig?.transferMode || 'auto',
                // 是否转换图片格式 (gif/webp -> png/jpg)
                convertFormat: channelData.imageConfig?.convertFormat !== false,
                // 目标格式: 'png' | 'jpeg' | 'auto'
                targetFormat: channelData.imageConfig?.targetFormat || 'auto',
                // 是否压缩图片
                compress: channelData.imageConfig?.compress !== false,
                // 压缩质量 (0-100)
                quality: channelData.imageConfig?.quality || 85,
                // 最大尺寸 (像素)
                maxSize: channelData.imageConfig?.maxSize || 4096,
                // 是否处理动图 (gif)
                processAnimated: channelData.imageConfig?.processAnimated !== false,
                ...(channelData.imageConfig || {})
            },
            // 高级配置
            timeout: channelData.timeout || { connect: 10000, read: 60000 },
            retry: channelData.retry || { maxAttempts: 3, delay: 1000, backoff: 'exponential' },
            quota: channelData.quota || { daily: 0, hourly: 0, perMinute: 0 },
            weight: channelData.weight || 100,
            // 运行时状态
            status: ChannelStatus.IDLE,
            lastHealthCheck: null,
            modelsCached: false,
            keyIndex: 0,
            errorCount: 0,
            lastErrorTime: null
        }

        this.channels.set(id, channel)
        await this.saveToConfig()

        return channel
    }

    /**
     * 更新渠道
     * @param {string} id - 渠道ID
     * @param {Object} updates - 更新内容
     * @returns {Object|null} 更新后的渠道或null
     */
    async update(id, updates) {
        const channel = this.channels.get(id)
        if (!channel) return null

        // 更新允许的字段
        const allowedFields = [
            'name', 'adapterType', 'baseUrl', 'apiKey', 'apiKeys', 'strategy', 
            'models', 'priority', 'enabled', 'advanced', 'customHeaders', 
            'headersTemplate', 'requestBodyTemplate', 'timeout', 'retry', 'quota', 'weight',
            'overrides', 'endpoints', 'auth', 'imageConfig'  // 新增图片处理配置字段
        ]
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

        // 如果凭据或适配器类型变更，清除模型缓存
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
     * 删除渠道
     * @param {string} id - 渠道ID
     * @returns {boolean} 是否删除成功
     */
    async delete(id) {
        // 不允许删除默认渠道，只能禁用
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
     * 从渠道API获取模型列表
     * @param {string} id - 渠道ID
     * @returns {Promise<Array>} 模型列表
     */
    async fetchModels(id) {
        const channel = this.channels.get(id)
        if (!channel) {
            throw new Error('Channel not found')
        }

        // 检查缓存
        const cached = await redisClient.get(`models:${id}`)
        if (cached) {
            try {
                return JSON.parse(cached)
            } catch (e) {
                // 忽略解析错误
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

            // 缓存结果（1小时）
            await redisClient.set(`models:${id}`, JSON.stringify(models), 3600)

            // 更新渠道
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
     * 获取OpenAI模型列表
     */
    async fetchOpenAIModels(channel) {
        const OpenAI = (await import('openai')).default
        const openai = new OpenAI({
            apiKey: channel.apiKey,
            baseURL: channel.baseUrl,
            defaultHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
        })

        const modelsList = await openai.models.list()
        const models = modelsList.data
            .map(m => m.id)
            .sort()

        return models
    }

    /**
     * 获取Gemini模型列表
     */
    async fetchGeminiModels(channel) {
        // Gemini暂无公开的模型列表API
        // 返回已知模型
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
     * 获取Claude模型列表
     */
    async fetchClaudeModels(channel) {
        return [
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307'
        ]
    }

    /**
     * Get API key for channel (handles rotation with multiple strategies)
     * @param {Object} channel
     * @param {Object} options - 选项
     * @param {boolean} options.recordUsage - 是否记录使用
     * @returns {{ key: string, keyIndex: number, keyObj: Object }}
     */
    getChannelKey(channel, options = {}) {
        const { recordUsage = true } = options

        // 旧版/单个key
        if (!channel.apiKeys || channel.apiKeys.length === 0) {
            return { key: channel.apiKey, keyIndex: -1, keyObj: null }
        }

        const activeKeys = channel.apiKeys.filter(k => {
            if (typeof k === 'string') return true
            return k.enabled !== false && (k.errorCount || 0) < 10 // 错误超过10次自动禁用
        })

        if (activeKeys.length === 0) {
            return { key: channel.apiKey, keyIndex: -1, keyObj: null }
        }

        let selectedIndex = 0
        let selectedKey = null
        const strategy = channel.strategy || KeyStrategy.ROUND_ROBIN

        switch (strategy) {
            case KeyStrategy.RANDOM:
                selectedIndex = Math.floor(Math.random() * activeKeys.length)
                break

            case KeyStrategy.WEIGHTED:
                // 根据权重随机选择
                const totalWeight = activeKeys.reduce((sum, k) => sum + (k.weight || 100), 0)
                let random = Math.random() * totalWeight
                for (let i = 0; i < activeKeys.length; i++) {
                    random -= activeKeys[i].weight || 100
                    if (random <= 0) {
                        selectedIndex = i
                        break
                    }
                }
                break

            case KeyStrategy.LEAST_USED:
                // 选择使用次数最少的
                let minUsage = Infinity
                for (let i = 0; i < activeKeys.length; i++) {
                    const usage = activeKeys[i].usageCount || 0
                    if (usage < minUsage) {
                        minUsage = usage
                        selectedIndex = i
                    }
                }
                break

            case KeyStrategy.FAILOVER:
                // 按顺序选择第一个可用的
                for (let i = 0; i < activeKeys.length; i++) {
                    const k = activeKeys[i]
                    if (!k.lastError || (Date.now() - k.lastError > 5 * 60 * 1000)) {
                        selectedIndex = i
                        break
                    }
                }
                break

            case KeyStrategy.ROUND_ROBIN:
            default:
                // 轮询
                let index = channel.keyIndex || 0
                if (index >= activeKeys.length) index = 0
                selectedIndex = index
                channel.keyIndex = (index + 1) % activeKeys.length
                break
        }

        selectedKey = activeKeys[selectedIndex]
        const keyValue = typeof selectedKey === 'string' ? selectedKey : selectedKey.key
        const keyName = typeof selectedKey === 'object' ? selectedKey.name : null

        // 在原始apiKeys数组中找到真实索引
        const originalIndex = channel.apiKeys.findIndex(k => 
            (typeof k === 'string' && k === keyValue) || 
            (typeof k === 'object' && k.key === keyValue)
        )

        // 记录使用
        if (recordUsage && typeof selectedKey === 'object') {
            selectedKey.usageCount = (selectedKey.usageCount || 0) + 1
            selectedKey.lastUsed = Date.now()
        }
        const keyDisplay = keyName || `Key#${originalIndex + 1}`
        const keyPreview = keyValue ? `${keyValue.slice(0, 8)}...${keyValue.slice(-4)}` : 'N/A'
        if (channel.apiKeys && channel.apiKeys.length > 1) {
            logger.info(`[ChannelManager] 使用 ${channel.name} 的 ${keyDisplay} (${keyPreview}), 策略: ${strategy}`)
        } else {
            logger.debug(`[ChannelManager] 使用 ${channel.name} 的 ${keyDisplay} (${keyPreview})`)
        }

        // 保存到channel以便后续获取
        channel.lastUsedKey = {
            keyIndex: originalIndex,
            keyName: keyDisplay,
            strategy
        }

        return { 
            key: keyValue, 
            keyIndex: originalIndex,  // 返回原始数组中的索引
            keyObj: selectedKey,
            keyName: keyDisplay,      // 返回key名称
            strategy                  // 返回使用的策略
        }
    }

    /**
     * 报告APIKey错误
     * @param {string} channelId 
     * @param {number} keyIndex 
     */
    reportKeyError(channelId, keyIndex) {
        const channel = this.channels.get(channelId)
        if (!channel || keyIndex < 0 || !channel.apiKeys?.[keyIndex]) return

        const keyObj = channel.apiKeys[keyIndex]
        if (typeof keyObj === 'object') {
            keyObj.errorCount = (keyObj.errorCount || 0) + 1
            keyObj.lastError = Date.now()
        }
    }

    /**
     * 重置APIKey错误计数
     * @param {string} channelId 
     * @param {number} keyIndex - -1表示重置所有
     */
    resetKeyErrors(channelId, keyIndex = -1) {
        const channel = this.channels.get(channelId)
        if (!channel || !channel.apiKeys) return

        if (keyIndex === -1) {
            channel.apiKeys.forEach(k => {
                if (typeof k === 'object') {
                    k.errorCount = 0
                    k.lastError = null
                }
            })
        } else if (channel.apiKeys[keyIndex] && typeof channel.apiKeys[keyIndex] === 'object') {
            channel.apiKeys[keyIndex].errorCount = 0
            channel.apiKeys[keyIndex].lastError = null
        }
    }

    /**
     * 获取APIKey统计信息
     * @param {string} channelId 
     * @returns {Array}
     */
    getKeyStats(channelId) {
        const channel = this.channels.get(channelId)
        if (!channel || !channel.apiKeys) return []

        return channel.apiKeys.map((k, i) => ({
            index: i,
            name: k.name || `Key ${i + 1}`,
            enabled: typeof k === 'string' ? true : k.enabled !== false,
            weight: k.weight || 100,
            usageCount: k.usageCount || 0,
            errorCount: k.errorCount || 0,
            lastUsed: k.lastUsed,
            lastError: k.lastError,
            // 隐藏key的大部分内容
            keyPreview: typeof k === 'string' 
                ? `${k.substring(0, 8)}...${k.slice(-4)}`
                : `${k.key.substring(0, 8)}...${k.key.slice(-4)}`
        }))
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
                const { key: apiKey } = this.getChannelKey(channel)
                
                // 选择测试模型：优先使用指定模型，其次使用渠道配置的第一个模型，最后使用默认模型
                const testModel = model || channel.models?.[0] || 'gpt-3.5-turbo'
                
                const client = new OpenAIClient({
                    apiKey: apiKey,
                    baseUrl: channel.baseUrl,
                    features: ['chat'],
                    tools: []
                })

                try {
                    const testStartTime = Date.now()
                    const response = await client.sendMessage(
                        { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                        { model: testModel, maxToken: 20 }
                    )

                    const replyText = response.contents
                        ?.filter(c => c.type === 'text')
                        ?.map(c => c.text)
                        ?.join('') || ''
                    try {
                        await statsService.recordApiCall({
                            channelId: id,
                            channelName: channel.name,
                            model: testModel,
                            duration: Date.now() - testStartTime,
                            success: true,
                            source: 'health_check',
                            responseText: replyText,
                            request: { messages: [{ role: 'user', content: '说一声你好' }], model: testModel },
                        })
                    } catch (e) { /* 统计失败不影响主流程 */ }

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
                    if (chatError.message?.includes('401') || chatError.message?.includes('Unauthorized')) {
                        
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
                            logger.warn(`[ChannelManager] 获取模型列表也失败: ${modelError.message}`)
                        }
                    }
                    throw chatError
                }
            } else if (channel.adapterType === 'gemini') {
                // Gemini 测试
                const { GeminiClient } = await import('../core/adapters/index.js')
                const client = new GeminiClient({
                    apiKey: this.getChannelKey(channel).key,
                    baseUrl: channel.baseUrl,
                    features: ['chat'],
                    tools: []
                })
                
                const testModel = model || channel.models?.[0] || 'gemini-pro'
                const geminiStartTime = Date.now()
                const response = await client.sendMessage(
                    { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                    { model: testModel, maxToken: 20 }
                )
                
                const replyText = response.contents
                    ?.filter(c => c.type === 'text')
                    ?.map(c => c.text)
                    ?.join('') || ''
                
                // 记录统计
                try {
                    await statsService.recordApiCall({
                        channelId: id,
                        channelName: channel.name,
                        model: testModel,
                        duration: Date.now() - geminiStartTime,
                        success: true,
                        source: 'health_check',
                        responseText: replyText,
                        request: { messages: [{ role: 'user', content: '说一声你好' }], model: testModel },
                    })
                } catch (e) { /* 统计失败不影响主流程 */ }
                
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
                    apiKey: this.getChannelKey(channel).key,
                    baseUrl: channel.baseUrl,
                    features: ['chat'],
                    tools: []
                })
                
                const testModel = model || channel.models?.[0] || 'claude-3-haiku-20240307'
                const claudeStartTime = Date.now()
                const response = await client.sendMessage(
                    { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                    { model: testModel, maxToken: 20 }
                )
                
                const replyText = response.contents
                    ?.filter(c => c.type === 'text')
                    ?.map(c => c.text)
                    ?.join('') || ''
                
                // 记录统计
                try {
                    await statsService.recordApiCall({
                        channelId: id,
                        channelName: channel.name,
                        model: testModel,
                        duration: Date.now() - claudeStartTime,
                        success: true,
                        source: 'health_check',
                        responseText: replyText,
                        request: { messages: [{ role: 'user', content: '说一声你好' }], model: testModel },
                    })
                } catch (e) { /* 统计失败不影响主流程 */ }
                
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
        const allChannels = Array.from(this.channels.values())
        logger.debug(`[ChannelManager] getBestChannel(${model}): 总渠道数=${allChannels.length}`)
        
        let candidates = allChannels.filter(ch => {
            const hasModel = ch.models?.includes(model) || ch.models?.includes('*')
            const isEnabled = ch.enabled !== false
            const notError = ch.status !== 'error'
            if (!hasModel || !isEnabled || !notError) {
                logger.debug(`[ChannelManager] 渠道 ${ch.id} 被过滤: enabled=${isEnabled}, status=${ch.status}, hasModel=${hasModel}`)
            }
            return isEnabled && notError && hasModel
        })
        const now = Date.now()
        
        candidates = candidates.filter(ch => {
            if (ch.lastErrorTime && (now - ch.lastErrorTime < 5 * 60 * 1000)) {
                return false
            }
            return true
        })

        logger.debug(`[ChannelManager] 错误时间过滤后候选: ${candidates.map(c => c.id).join(', ')}`)
        candidates = candidates.filter(ch => {
            if (ch.quota && ch.usage && ch.quota.daily > 0) {
                const today = new Date().toISOString().split('T')[0]
                if (ch.usage.date === today && ch.usage.count >= ch.quota.daily) {
                    logger.debug(`[ChannelManager] 渠道 ${ch.id} 因超出每日配额被过滤: ${ch.usage.count}/${ch.quota.daily}`)
                    return false
                }
            }
            return true
        })
        
        if (candidates.length === 0) return null

        let result = null
        if (strategy === 'priority') {
            result = candidates.sort((a, b) => a.priority - b.priority)[0]
        } else if (strategy === 'round-robin') {
            result = candidates.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))[0]
        } else if (strategy === 'random') {
            result = candidates[Math.floor(Math.random() * candidates.length)]
        } else if (strategy === 'least-connection') {
            result = candidates.sort((a, b) => {
                const countA = this.activeRequests.get(a.id) || 0
                const countB = this.activeRequests.get(b.id) || 0
                return countA - countB
            })[0]
        } else {
            result = candidates[0]
        }
        return result
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
     * @param {Object} options - 错误选项
     * @param {number} options.keyIndex - 出错的key索引
     * @param {string} options.errorType - 错误类型: 'auth' | 'quota' | 'timeout' | 'network' | 'empty' | 'unknown'
     * @param {string} options.errorMessage - 错误信息
     */
    async reportError(channelId, options = {}) {
        const channel = this.channels.get(channelId)
        if (!channel) return

        const { keyIndex = -1, errorType = 'unknown', errorMessage = '' } = options
        
        channel.lastErrorTime = Date.now()
        channel.errorCount = (channel.errorCount || 0) + 1
        channel.lastErrorType = errorType
        channel.lastErrorMessage = errorMessage

        // 如果指定了key索引，记录key级别的错误
        if (keyIndex >= 0) {
            this.reportKeyError(channelId, keyIndex)
        }

        // 根据错误类型决定渠道状态
        if (errorType === 'auth') {
            // 认证错误，5次后标记为error
            if (channel.errorCount >= 3) {
                channel.status = ChannelStatus.ERROR
                logger.warn(`[ChannelManager] 渠道 ${channel.name} 认证错误次数过多，已禁用`)
            }
        } else if (errorType === 'quota') {
            // 配额超限
            channel.status = ChannelStatus.QUOTA_EXCEEDED
            logger.warn(`[ChannelManager] 渠道 ${channel.name} 配额超限`)
        } else if (channel.errorCount > 5) {
            channel.status = ChannelStatus.ERROR
        }
    }

    /**
     * 重置渠道错误状态
     * @param {string} channelId
     */
    resetChannelError(channelId) {
        const channel = this.channels.get(channelId)
        if (!channel) return
        
        channel.errorCount = 0
        channel.lastErrorTime = null
        channel.lastErrorType = null
        channel.lastErrorMessage = null
        if (channel.status === ChannelStatus.ERROR) {
            channel.status = ChannelStatus.IDLE
        }
    }

    /**
     * 获取指定模型的所有可用渠道（用于重试）
     * @param {string} model - 模型名称
     * @param {Object} options - 选项
     * @param {string} options.excludeChannelId - 排除的渠道ID
     * @param {boolean} options.includeErrorChannels - 是否包含错误状态的渠道
     * @returns {Array} 可用渠道列表
     */
    getAvailableChannels(model, options = {}) {
        const { excludeChannelId = null, includeErrorChannels = false } = options
        const now = Date.now()
        
        return Array.from(this.channels.values())
            .filter(ch => {
                // 基础过滤
                if (!ch.enabled) return false
                if (excludeChannelId && ch.id === excludeChannelId) return false
                
                // 模型支持检查
                const hasModel = ch.models?.includes(model) || ch.models?.includes('*')
                if (!hasModel) return false
                
                // 状态检查
                if (!includeErrorChannels && ch.status === ChannelStatus.ERROR) return false
                if (ch.status === ChannelStatus.QUOTA_EXCEEDED) return false
                
                // 错误冷却检查（5分钟）
                if (ch.lastErrorTime && (now - ch.lastErrorTime < 5 * 60 * 1000)) {
                    // 但如果有多个key，可能还有可用的
                    const availableKeys = this.getAvailableKeysCount(ch)
                    if (availableKeys === 0) return false
                }
                
                return true
            })
            .sort((a, b) => {
                // 优先级排序：priority > 错误次数少 > 最近未使用
                if (a.priority !== b.priority) return a.priority - b.priority
                if ((a.errorCount || 0) !== (b.errorCount || 0)) return (a.errorCount || 0) - (b.errorCount || 0)
                return (a.lastUsed || 0) - (b.lastUsed || 0)
            })
    }

    /**
     * 获取渠道中可用的APIKey数量
     * @param {Object} channel
     * @returns {number}
     */
    getAvailableKeysCount(channel) {
        if (!channel.apiKeys || channel.apiKeys.length === 0) {
            return channel.apiKey ? 1 : 0
        }
        
        return channel.apiKeys.filter(k => {
            if (typeof k === 'string') return true
            return k.enabled !== false && (k.errorCount || 0) < 10
        }).length
    }

    /**
     * 尝试获取下一个可用的Key（同一渠道内切换）
     * @param {string} channelId
     * @param {number} currentKeyIndex - 当前失败的key索引
     * @returns {{ key: string, keyIndex: number, keyObj: Object } | null}
     */
    getNextAvailableKey(channelId, currentKeyIndex) {
        const channel = this.channels.get(channelId)
        if (!channel || !channel.apiKeys || channel.apiKeys.length <= 1) {
            return null
        }

        const activeKeys = channel.apiKeys
            .map((k, i) => ({ key: k, index: i }))
            .filter(({ key, index }) => {
                if (index === currentKeyIndex) return false // 排除当前失败的key
                if (typeof key === 'string') return true
                return key.enabled !== false && (key.errorCount || 0) < 10
            })

        if (activeKeys.length === 0) return null

        // 选择错误次数最少的key
        activeKeys.sort((a, b) => {
            const errA = typeof a.key === 'object' ? (a.key.errorCount || 0) : 0
            const errB = typeof b.key === 'object' ? (b.key.errorCount || 0) : 0
            return errA - errB
        })

        const selected = activeKeys[0]
        const keyValue = typeof selected.key === 'string' ? selected.key : selected.key.key
        
        logger.info(`[ChannelManager] 渠道 ${channel.name} 切换到备用Key #${selected.index + 1}`)
        
        return {
            key: keyValue,
            keyIndex: selected.index,
            keyObj: selected.key
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
