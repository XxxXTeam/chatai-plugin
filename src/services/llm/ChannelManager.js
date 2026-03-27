/**
 * @fileoverview 渠道管理模块
 * @module services/llm/ChannelManager
 * @description 管理多个API渠道，支持负载均衡、故障转移和APIKey轮询
 */

import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import config from '../../../config/config.js'
import crypto from 'node:crypto'
import { redisClient } from '../../core/cache/RedisClient.js'
import { statsService } from '../stats/StatsService.js'

/**
 * @constant {Object} DEFAULT_BASE_URLS
 * @description 各适配器的默认API地址
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
 * @param {string|string[]} baseUrl - 单个URL或URL数组
 * @param {string} adapterType
 * @returns {string|string[]} 规范化后的URL或URL数组
 */
export function normalizeBaseUrl(baseUrl, adapterType) {
    // 如果为空，使用默认地址
    if (!baseUrl) {
        return DEFAULT_BASE_URLS[adapterType] || ''
    }

    // 处理数组格式
    if (Array.isArray(baseUrl)) {
        return baseUrl.map(url => normalizeSingleBaseUrl(url, adapterType)).filter(Boolean)
    }

    return normalizeSingleBaseUrl(baseUrl, adapterType)
}

/**
 * 规范化单个 Base URL
 * @param {string} baseUrl
 * @param {string} adapterType
 * @returns {string}
 */
function normalizeSingleBaseUrl(baseUrl, adapterType) {
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

/**
 * 从原始配置解析 baseUrls 列表。
 * saveToConfig 会写入 baseUrls；旧数据或仅单地址时可能为 [] 但仍带 baseUrl，此时必须回退到 baseUrl，否则会误用 DEFAULT_BASE_URLS。
 */
function resolveChannelBaseUrls(raw) {
    let urls = []
    if (Array.isArray(raw.baseUrls) && raw.baseUrls.length > 0) {
        urls = raw.baseUrls.filter(u => u != null && String(u).trim())
    } else if (raw.baseUrl != null && String(raw.baseUrl).trim()) {
        urls = [String(raw.baseUrl).trim()]
    }
    return urls
}

// APIKey轮询策略
export const KeyStrategy = {
    ROUND_ROBIN: 'round-robin', // 轮询
    RANDOM: 'random', // 随机
    WEIGHTED: 'weighted', // 权重
    LEAST_USED: 'least-used', // 最少使用
    FAILOVER: 'failover' // 故障转移（按顺序，失败后换下一个）
}

// 渠道状态
export const ChannelStatus = {
    IDLE: 'idle',
    ACTIVE: 'active',
    ERROR: 'error',
    DISABLED: 'disabled',
    QUOTA_EXCEEDED: 'quota_exceeded'
}

/**
 * @class ChannelManager
 * @classdesc 渠道管理器 - 负责管理API渠道的选择、负载均衡和故障转移
 *
 * @description
 * @example
 * // 获取适合请求的渠道
 * const channel = await channelManager.selectChannel({ model: 'gpt-4o' })
 *
 * // 获取所有可用模型
 * const models = channelManager.getAllModels()
 */
export class ChannelManager {
    constructor() {
        /** @type {Map<string, Object>} 渠道ID -> 渠道配置 */
        this.channels = new Map()
        /** @type {Map<string, Object>} 活跃请求追踪 */
        this.activeRequests = new Map()
        /** @type {Map<string, Object>} 渠道使用统计 */
        this.channelStats = new Map()
        /** @type {Map<string, Object>} APIKey使用统计 */
        this.keyStats = new Map()
        /** @type {boolean} 是否已初始化 */
        this.initialized = false
        /** @type {NodeJS.Timeout|null} 健康检查定时器 */
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
     * 测试baseUrl的延迟（HTTP GET）
     * @param {string} baseUrl - 要测试的baseUrl
     * @param {Object} options - 选项
     * @param {number} options.timeout - 超时时间(ms)，默认5000
     * @returns {Promise<{latency: number, success: boolean, error?: string}>}
     */
    async testBaseUrlLatency(baseUrl, options = {}) {
        const { timeout = 5000 } = options

        if (!baseUrl || !baseUrl.trim()) {
            return { latency: Infinity, success: false, error: 'BaseUrl为空' }
        }

        try {
            // 构建测试URL（使用健康检查端点或根路径）
            let testUrl = baseUrl.replace(/\/+$/, '')

            // 根据适配器类型选择测试端点
            // 对于OpenAI兼容API，尝试/models端点
            // 对于其他API，尝试根路径
            if (testUrl.includes('/v1')) {
                testUrl = testUrl + '/models'
            } else {
                testUrl = testUrl + '/'
            }

            const startTime = Date.now()
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)

            try {
                const response = await fetch(testUrl, {
                    method: 'GET',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        Accept: 'application/json'
                    }
                })
                clearTimeout(timeoutId)

                const latency = Date.now() - startTime

                // 即使返回错误状态码，也记录延迟（说明网络可达）
                return {
                    latency,
                    success: response.ok || response.status === 401 || response.status === 403, // 401/403表示API可达但需要认证
                    status: response.status
                }
            } catch (fetchError) {
                clearTimeout(timeoutId)
                if (fetchError.name === 'AbortError') {
                    return { latency: timeout, success: false, error: '请求超时' }
                }
                throw fetchError
            }
        } catch (error) {
            logger.debug(`[ChannelManager] BaseUrl延迟测试失败: ${baseUrl}, 错误: ${error.message}`)
            return { latency: Infinity, success: false, error: error.message }
        }
    }

    /**
     * 测试所有baseUrl的延迟并选择最优的
     * @param {string} channelId - 渠道ID
     * @param {Object} options - 选项
     * @param {boolean} options.forceRetest - 强制重新测试，默认false
     * @returns {Promise<{selectedIndex: number, latencies: Object, selectedUrl: string}>}
     */
    async testAndSelectBestBaseUrl(channelId, options = {}) {
        const { forceRetest = false } = options
        const channel = this.channels.get(channelId)
        if (!channel) {
            throw new Error('Channel not found')
        }

        const baseUrls = channel.baseUrls || []
        if (baseUrls.length === 0) {
            return { selectedIndex: 0, latencies: {}, selectedUrl: channel.baseUrl || '' }
        }

        // 如果已有测试结果且不强制重测，直接使用
        if (!forceRetest && channel.baseUrlLatencies && Object.keys(channel.baseUrlLatencies).length > 0) {
            const bestIndex = this.selectBestBaseUrlIndex(channel)
            return {
                selectedIndex: bestIndex,
                latencies: channel.baseUrlLatencies,
                selectedUrl: baseUrls[bestIndex] || ''
            }
        }

        // 并行测试所有baseUrl
        logger.info(`[ChannelManager] 开始测试渠道 ${channel.name} 的 ${baseUrls.length} 个baseUrl延迟`)
        const testResults = await Promise.allSettled(baseUrls.map(url => this.testBaseUrlLatency(url)))

        const latencies = {}
        const validResults = []

        for (let i = 0; i < baseUrls.length; i++) {
            const result = testResults[i]
            if (result.status === 'fulfilled' && result.value.success) {
                latencies[baseUrls[i]] = result.value.latency
                validResults.push({
                    index: i,
                    url: baseUrls[i],
                    latency: result.value.latency
                })
                logger.debug(`[ChannelManager] BaseUrl ${baseUrls[i]} 延迟: ${result.value.latency}ms`)
            } else {
                latencies[baseUrls[i]] = Infinity
                logger.warn(
                    `[ChannelManager] BaseUrl ${baseUrls[i]} 测试失败: ${result.status === 'rejected' ? result.reason?.message : result.value?.error}`
                )
            }
        }

        // 选择延迟最低的baseUrl
        if (validResults.length === 0) {
            logger.warn(`[ChannelManager] 所有baseUrl测试失败，使用第一个作为默认`)
            const selectedIndex = 0
            channel.baseUrlLatencies = latencies
            channel.selectedBaseUrlIndex = selectedIndex
            channel.baseUrl = baseUrls[selectedIndex] || ''
            await this.saveToConfig()
            return { selectedIndex, latencies, selectedUrl: baseUrls[selectedIndex] || '' }
        }

        // 按延迟排序，选择最快的
        validResults.sort((a, b) => a.latency - b.latency)
        const bestResult = validResults[0]

        channel.baseUrlLatencies = latencies
        channel.selectedBaseUrlIndex = bestResult.index
        channel.baseUrl = bestResult.url
        await this.saveToConfig()

        logger.info(
            `[ChannelManager] 渠道 ${channel.name} 选择最优baseUrl: ${bestResult.url} (延迟: ${bestResult.latency}ms)`
        )

        return {
            selectedIndex: bestResult.index,
            latencies,
            selectedUrl: bestResult.url
        }
    }

    /**
     * 根据延迟测试结果选择最优baseUrl索引
     * @param {Object} channel - 渠道对象
     * @returns {number} 选中的baseUrl索引
     */
    selectBestBaseUrlIndex(channel) {
        const baseUrls = channel.baseUrls || []
        if (baseUrls.length === 0) return 0

        const latencies = channel.baseUrlLatencies || {}
        let bestIndex = 0
        let bestLatency = Infinity

        for (let i = 0; i < baseUrls.length; i++) {
            const latency = latencies[baseUrls[i]]
            if (latency !== undefined && latency < bestLatency) {
                bestLatency = latency
                bestIndex = i
            }
        }

        return bestIndex
    }

    /**
     * 获取当前渠道的最佳baseUrl（自动选择）
     * @param {string} channelId - 渠道ID
     * @returns {string} 当前使用的baseUrl
     */
    getCurrentBaseUrl(channelId) {
        const channel = this.channels.get(channelId)
        if (!channel) return ''

        const baseUrls = channel.baseUrls || []
        if (baseUrls.length === 0) return channel.baseUrl || ''

        const selectedIndex =
            channel.selectedBaseUrlIndex !== undefined
                ? channel.selectedBaseUrlIndex
                : this.selectBestBaseUrlIndex(channel)

        return baseUrls[selectedIndex] || baseUrls[0] || channel.baseUrl || ''
    }

    /**
     * 切换到下一个可用的baseUrl（用于失败重试）
     * @param {string} channelId - 渠道ID
     * @param {number} currentIndex - 当前使用的baseUrl索引
     * @returns {string|null} 下一个baseUrl，如果没有则返回null
     */
    switchToNextBaseUrl(channelId, currentIndex) {
        const channel = this.channels.get(channelId)
        if (!channel) return null

        const baseUrls = channel.baseUrls || []
        if (baseUrls.length <= 1) return null

        // 尝试下一个baseUrl
        const nextIndex = (currentIndex + 1) % baseUrls.length
        if (nextIndex === currentIndex) return null // 已经循环一圈

        channel.selectedBaseUrlIndex = nextIndex
        channel.baseUrl = baseUrls[nextIndex]
        logger.info(
            `[ChannelManager] 渠道 ${channel.name} 切换到下一个baseUrl: ${baseUrls[nextIndex]} (索引: ${nextIndex})`
        )

        // 异步保存，不阻塞
        this.saveToConfig().catch(err => {
            logger.error(`[ChannelManager] 保存baseUrl切换失败: ${err.message}`)
        })

        return baseUrls[nextIndex]
    }

    /**
     * 从配置加载渠道
     */
    async loadChannels() {
        const channels = config.get('channels') || []

        for (const channelConfig of channels) {
            let baseUrls = resolveChannelBaseUrls(channelConfig)
            if (baseUrls.length === 0) {
                baseUrls = [DEFAULT_BASE_URLS[channelConfig.adapterType] || '']
            }

            // 规范化所有baseUrl
            const normalizedUrls = baseUrls
                .map(url => normalizeSingleBaseUrl(url, channelConfig.adapterType))
                .filter(Boolean)

            // 加载baseUrl延迟测试结果
            const baseUrlLatencies = channelConfig.baseUrlLatencies || {}
            const selectedBaseUrlIndex =
                channelConfig.selectedBaseUrlIndex !== undefined
                    ? channelConfig.selectedBaseUrlIndex
                    : normalizedUrls.length > 0
                      ? 0
                      : null

            this.channels.set(channelConfig.id, {
                ...channelConfig,
                baseUrl: normalizedUrls[selectedBaseUrlIndex] || normalizedUrls[0] || '', // 兼容旧代码
                baseUrls: normalizedUrls, // 多baseUrl数组
                baseUrlLatencies: baseUrlLatencies, // 延迟测试结果 { url: latency }
                selectedBaseUrlIndex: selectedBaseUrlIndex, // 当前选中的baseUrl索引
                // 规范化高级配置，确保新增字段有默认值
                advanced: this.normalizeAdvanced(channelConfig.advanced),
                status: channelConfig.status || ChannelStatus.IDLE,
                lastHealthCheck: channelConfig.lastHealthCheck || null,
                testedAt: channelConfig.testedAt || null,
                // 自定义请求头
                customHeaders: channelConfig.customHeaders || {},
                headersTemplate: channelConfig.headersTemplate || '',
                requestBodyTemplate: channelConfig.requestBodyTemplate || '',
                // 自定义路径配置
                chatPath: channelConfig.chatPath || '',
                modelsPath: channelConfig.modelsPath || '',
                // 多APIKey支持
                apiKeys: this.normalizeApiKeys(channelConfig.apiKeys || []),
                strategy: channelConfig.strategy || KeyStrategy.ROUND_ROBIN,
                // 拓展覆盖配置
                overrides: channelConfig.overrides || {},
                endpoints: channelConfig.endpoints || {},
                auth: channelConfig.auth || { type: 'bearer' },
                // 图片处理配置
                imageConfig: channelConfig.imageConfig || {},
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
     * 规范化渠道高级配置，确保所有字段都有默认值
     * @param {Object} advanced - 原始高级配置
     * @returns {Object} 标准化后的高级配置
     */
    normalizeAdvanced(advanced) {
        const src = advanced || {}
        return {
            streaming: {
                enabled: src.streaming?.enabled || false,
                chunkSize: src.streaming?.chunkSize || 1024
            },
            thinking: {
                enableReasoning: src.thinking?.enableReasoning || false,
                defaultLevel: src.thinking?.defaultLevel || 'medium',
                adaptThinking: src.thinking?.adaptThinking !== false,
                sendThinkingAsMessage: src.thinking?.sendThinkingAsMessage || false,
                /** auto: 按 baseUrl 识别 BigModel/智谱并附加 thinking.type；glm: 始终附加；off: 不附加 */
                vendorThinkingControl: ['auto', 'off', 'glm'].includes(src.thinking?.vendorThinkingControl)
                    ? src.thinking.vendorThinkingControl
                    : 'auto'
            },
            llm: {
                temperature: src.llm?.temperature ?? 0.7,
                maxTokens: src.llm?.maxTokens || 4000,
                topP: src.llm?.topP ?? 1,
                frequencyPenalty: src.llm?.frequencyPenalty ?? 0,
                presencePenalty: src.llm?.presencePenalty ?? 0,
                /* 字符上限，0 表示不限制 */
                maxCharacters: src.llm?.maxCharacters || 0
            }
        }
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

        let baseUrls = resolveChannelBaseUrls(channelData)
        if (baseUrls.length === 0) {
            baseUrls = [DEFAULT_BASE_URLS[channelData.adapterType] || '']
        }

        // 规范化所有baseUrl
        const normalizedUrls = baseUrls.map(url => normalizeSingleBaseUrl(url, channelData.adapterType)).filter(Boolean)

        // 自动测试延迟并选择最优的
        let selectedIndex = 0
        let baseUrlLatencies = {}
        if (normalizedUrls.length > 1) {
            try {
                // 创建临时渠道对象用于测试
                const tempChannel = { baseUrls: normalizedUrls, adapterType: channelData.adapterType }
                const testResults = await Promise.allSettled(normalizedUrls.map(url => this.testBaseUrlLatency(url)))

                const validResults = []
                for (let i = 0; i < normalizedUrls.length; i++) {
                    const result = testResults[i]
                    if (result.status === 'fulfilled' && result.value.success) {
                        baseUrlLatencies[normalizedUrls[i]] = result.value.latency
                        validResults.push({ index: i, latency: result.value.latency })
                    } else {
                        baseUrlLatencies[normalizedUrls[i]] = Infinity
                    }
                }

                if (validResults.length > 0) {
                    validResults.sort((a, b) => a.latency - b.latency)
                    selectedIndex = validResults[0].index
                }
            } catch (error) {
                logger.warn(`[ChannelManager] 创建渠道时测试baseUrl延迟失败: ${error.message}`)
            }
        }

        const channel = {
            id,
            name: channelData.name,
            adapterType: channelData.adapterType,
            baseUrl: normalizedUrls[selectedIndex] || normalizedUrls[0] || '', // 兼容旧代码
            baseUrls: normalizedUrls, // 多baseUrl数组
            baseUrlLatencies: baseUrlLatencies, // 延迟测试结果
            selectedBaseUrlIndex: selectedIndex, // 当前选中的baseUrl索引
            apiKey: channelData.apiKey,
            models: channelData.models || [],
            priority: channelData.priority || 100,
            enabled: channelData.enabled !== false,
            advanced: this.normalizeAdvanced(channelData.advanced),
            apiKeys: this.normalizeApiKeys(channelData.apiKeys || []),
            strategy: channelData.strategy || KeyStrategy.ROUND_ROBIN,
            customHeaders: channelData.customHeaders || {},
            headersTemplate: channelData.headersTemplate || '',
            requestBodyTemplate: channelData.requestBodyTemplate || '',
            chatPath: channelData.chatPath || '',
            modelsPath: channelData.modelsPath || '',
            overrides: {
                temperature: channelData.overrides?.temperature, // 温度 0-2
                maxTokens: channelData.overrides?.maxTokens, // 最大输出token
                topP: channelData.overrides?.topP, // Top-P采样
                topK: channelData.overrides?.topK, // Top-K采样
                frequencyPenalty: channelData.overrides?.frequencyPenalty, // 频率惩罚
                presencePenalty: channelData.overrides?.presencePenalty, // 存在惩罚
                stopSequences: channelData.overrides?.stopSequences || [], // 停止序列
                systemPromptPrefix: channelData.overrides?.systemPromptPrefix || '', // 系统提示前缀
                systemPromptSuffix: channelData.overrides?.systemPromptSuffix || '', // 系统提示后缀
                modelMapping: channelData.overrides?.modelMapping || {},
                ...(channelData.overrides || {})
            },
            endpoints: {
                chat: channelData.endpoints?.chat || '', // 聊天端点，如 /chat/completions
                models: channelData.endpoints?.models || '', // 模型列表端点
                embeddings: channelData.endpoints?.embeddings || '', // 嵌入端点
                images: channelData.endpoints?.images || '', // 图像生成端点
                ...(channelData.endpoints || {})
            },
            // 认证方式覆盖
            auth: {
                type: channelData.auth?.type || 'bearer', // bearer/api-key/custom
                headerName: channelData.auth?.headerName || '', // 自定义认证头名称
                prefix: channelData.auth?.prefix || '', // 认证值前缀
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
            'name',
            'adapterType',
            'baseUrl',
            'baseUrls',
            'baseUrlLatencies',
            'selectedBaseUrlIndex',
            'apiKey',
            'apiKeys',
            'strategy',
            'models',
            'priority',
            'enabled',
            'advanced',
            'customHeaders',
            'headersTemplate',
            'requestBodyTemplate',
            'timeout',
            'retry',
            'quota',
            'weight',
            'overrides',
            'endpoints',
            'auth',
            'imageConfig',
            'chatPath', // 自定义对话路径
            'modelsPath' // 自定义模型列表路径
        ]
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                // 处理baseUrls更新
                if (field === 'baseUrls') {
                    const adapterType = updates.adapterType || channel.adapterType
                    const baseUrls = Array.isArray(updates.baseUrls) ? updates.baseUrls : [updates.baseUrls]
                    channel.baseUrls = baseUrls.map(url => normalizeSingleBaseUrl(url, adapterType)).filter(Boolean)
                    // 更新baseUrl为第一个（兼容旧代码）
                    channel.baseUrl = channel.baseUrls[0] || ''
                    // 清除延迟测试结果，需要重新测试
                    channel.baseUrlLatencies = {}
                    channel.selectedBaseUrlIndex = 0
                } else if (field === 'baseUrl') {
                    // 兼容旧格式：单个baseUrl转换为数组
                    const adapterType = updates.adapterType || channel.adapterType
                    const normalizedUrl = normalizeSingleBaseUrl(updates.baseUrl, adapterType)
                    channel.baseUrl = normalizedUrl
                    if (!channel.baseUrls || channel.baseUrls.length === 0) {
                        channel.baseUrls = [normalizedUrl]
                        channel.selectedBaseUrlIndex = 0
                    }
                } else {
                    channel[field] = updates[field]
                }
            }
        }

        // 如果凭据或适配器类型变更，清除模型缓存
        if (updates.apiKey || updates.baseUrl || updates.baseUrls || updates.apiKeys || updates.adapterType) {
            channel.modelsCached = false
            channel.status = undefined // Reset status when config changes
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
        // 使用当前选中的baseUrl
        const currentBaseUrl =
            channel.baseUrls && channel.baseUrls.length > 0
                ? channel.baseUrls[channel.selectedBaseUrlIndex] || channel.baseUrls[0]
                : channel.baseUrl

        // 支持自定义模型列表端点
        const customModelsPath = channel.endpoints?.models || channel.modelsPath
        const clientOptions = {
            apiKey: channel.apiKey,
            baseURL: currentBaseUrl,
            defaultHeaders: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            }
        }

        // 如果配置了自定义模型列表端点，使用自定义fetch
        if (customModelsPath) {
            const baseUrlClean = currentBaseUrl?.replace(/\/+$/, '') || ''
            const modelsEndpoint = customModelsPath.startsWith('/') ? customModelsPath : '/' + customModelsPath
            clientOptions.fetch = async (url, init) => {
                let newUrl = url.toString()
                if (newUrl.includes('/models')) {
                    newUrl = baseUrlClean + modelsEndpoint
                    logger.debug(`[ChannelManager] 使用自定义模型列表端点: ${newUrl}`)
                }
                return fetch(newUrl, init)
            }
        }

        const openai = new OpenAI(clientOptions)

        const modelsList = await openai.models.list()
        const models = modelsList.data.map(m => m.id).sort()

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
                    if (!k.lastError || Date.now() - k.lastError > 5 * 60 * 1000) {
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
        const originalIndex = channel.apiKeys.findIndex(
            k => (typeof k === 'string' && k === keyValue) || (typeof k === 'object' && k.key === keyValue)
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
            keyIndex: originalIndex, // 返回原始数组中的索引
            keyObj: selectedKey,
            keyName: keyDisplay, // 返回key名称
            strategy // 返回使用的策略
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
            keyPreview:
                typeof k === 'string'
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
                // 应用模型映射/重定向
                const mapping = this.getActualModel(id, testModel)
                const actualModel = mapping.actualModel
                if (mapping.mapped) {
                    logger.info(`[ChannelManager] 健康检查模型重定向: ${testModel} -> ${actualModel}`)
                }

                // 使用当前选中的baseUrl
                const currentBaseUrl = this.getCurrentBaseUrl(id) || channel.baseUrl

                const client = new OpenAIClient({
                    apiKey: apiKey,
                    baseUrl: currentBaseUrl,
                    chatPath: channel.chatPath, // 自定义对话路径（兼容旧格式）
                    modelsPath: channel.modelsPath, // 自定义模型列表路径（兼容旧格式）
                    endpoints: channel.endpoints || {}, // 自定义端点配置
                    imageConfig: channel.imageConfig || {},
                    features: ['chat'],
                    tools: []
                })

                try {
                    const testStartTime = Date.now()
                    const response = await client.sendMessage(
                        { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                        { model: actualModel, maxToken: 20 }
                    )

                    const replyText =
                        response.contents
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
                            request: { messages: [{ role: 'user', content: '说一声你好' }], model: testModel }
                        })
                    } catch (e) {
                        /* 统计失败不影响主流程 */
                    }

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
                const currentBaseUrl = this.getCurrentBaseUrl(id) || channel.baseUrl

                const client = new GeminiClient({
                    apiKey: this.getChannelKey(channel).key,
                    baseUrl: currentBaseUrl,
                    chatPath: channel.chatPath, // 自定义对话路径（兼容旧格式）
                    modelsPath: channel.modelsPath, // 自定义模型列表路径（兼容旧格式）
                    endpoints: channel.endpoints || {}, // 自定义端点配置
                    imageConfig: channel.imageConfig || {},
                    features: ['chat'],
                    tools: []
                })

                const testModel = model || channel.models?.[0] || 'gemini-pro'
                // 应用模型映射/重定向
                const mapping = this.getActualModel(id, testModel)
                const actualModel = mapping.actualModel

                const geminiStartTime = Date.now()
                const response = await client.sendMessage(
                    { role: 'user', content: [{ type: 'text', text: '你好' }] },
                    { model: actualModel, maxToken: 20 }
                )

                const replyText =
                    response.contents
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
                        request: { messages: [{ role: 'user', content: '说一声你好' }], model: testModel }
                    })
                } catch (e) {
                    /* 统计失败不影响主流程 */
                }

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
                const currentBaseUrl = this.getCurrentBaseUrl(id) || channel.baseUrl

                const client = new ClaudeClient({
                    apiKey: this.getChannelKey(channel).key,
                    baseUrl: currentBaseUrl,
                    chatPath: channel.chatPath, // 自定义对话路径（兼容旧格式）
                    endpoints: channel.endpoints || {}, // 自定义端点配置
                    imageConfig: channel.imageConfig || {},
                    features: ['chat'],
                    tools: []
                })

                const testModel = model || channel.models?.[0] || 'claude-3-haiku-20240307'
                // 应用模型映射/重定向
                const mapping = this.getActualModel(id, testModel)
                const actualModel = mapping.actualModel

                const claudeStartTime = Date.now()
                const response = await client.sendMessage(
                    { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                    { model: actualModel, maxToken: 20 }
                )

                const replyText =
                    response.contents
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
                        request: { messages: [{ role: 'user', content: '说一声你好' }], model: testModel }
                    })
                } catch (e) {
                    /* 统计失败不影响主流程 */
                }

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
     * @param {string} model
     * @param {Object} options - 选项
     * @param {boolean} options.ignoreErrorCooldown - 忽略错误冷却时间，默认false
     * @returns {Object|null}
     */
    getBestChannel(model, options = {}) {
        const { ignoreErrorCooldown = false } = options
        const strategy = config.get('loadBalancing.strategy') || 'priority'
        const allChannels = Array.from(this.channels.values())
        const modelChannels = allChannels.filter(ch => {
            const hasModel = ch.models?.includes(model) || ch.models?.includes('*')
            const isEnabled = ch.enabled !== false
            return hasModel && isEnabled
        })
        const modelChannelsCount = modelChannels.length
        let candidates = modelChannels.filter(ch => {
            const notError = ch.status !== 'error'
            if (!notError) {
                logger.debug(`[ChannelManager] 渠道 ${ch.id} 被过滤: status=${ch.status}`)
            }
            return notError
        })
        const now = Date.now()
        if (!ignoreErrorCooldown) {
            candidates = candidates.filter(ch => {
                const errorCount = ch.errorCount || 0
                let cooldownMs = 0
                if (errorCount === 1)
                    cooldownMs = 30 * 1000 // 30秒
                else if (errorCount === 2)
                    cooldownMs = 60 * 1000 // 1分钟
                else if (errorCount >= 3) cooldownMs = 5 * 60 * 1000 // 5分钟

                if (ch.lastErrorTime && cooldownMs > 0 && now - ch.lastErrorTime < cooldownMs) {
                    logger.debug(
                        `[ChannelManager] 渠道 ${ch.id} 在冷却中: 错误${errorCount}次, 剩余${Math.ceil((cooldownMs - (now - ch.lastErrorTime)) / 1000)}秒`
                    )
                    return false
                }
                return true
            })
            if (candidates.length === 0 && modelChannelsCount > 0) {
                candidates = allChannels.filter(ch => {
                    const hasModel = ch.models?.includes(model) || ch.models?.includes('*')
                    const isEnabled = ch.enabled !== false
                    const notDisabled = ch.status !== ChannelStatus.DISABLED
                    return hasModel && isEnabled && notDisabled
                })
            }
        }
        candidates = candidates.filter(ch => {
            if (ch.quota && ch.usage && ch.quota.daily > 0) {
                const today = new Date().toISOString().split('T')[0]
                if (ch.usage.date === today && ch.usage.count >= ch.quota.daily) {
                    logger.debug(
                        `[ChannelManager] 渠道 ${ch.id} 因超出每日配额被过滤: ${ch.usage.count}/${ch.quota.daily}`
                    )
                    return false
                }
            }
            return true
        })
        if (candidates.length === 0 && modelChannelsCount > 0) {
            candidates = modelChannels.filter(ch => ch.status !== ChannelStatus.DISABLED)
        }

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
     * 为群组解析最佳渠道（优先群独立渠道，回退全局渠道）
     * 统一的群独立渠道选择逻辑，供 ChatService / ChatAgent / LlmService 等复用
     *
     * @param {Object} groupChannelConfig - 群渠道配置（来自 ScopeManager.getGroupChannelConfig）
     * @param {string} model - 当前请求的模型名称
     * @param {string} groupId - 群组ID（仅用于日志）
     * @returns {{ channel: Object|null, source: string, model: string }}
     *   channel: 解析后的渠道对象（或 null），source: 渠道来源标识，model: 可能被修改的模型名
     */
    resolveGroupChannel(groupChannelConfig, model, groupId) {
        if (!groupChannelConfig) {
            return { channel: null, source: 'global', model }
        }

        let resolvedModel = model

        /* 多独立渠道优先 */
        const independentChannels = groupChannelConfig.independentChannels || []
        const enabled = independentChannels.filter(ch => ch.enabled !== false && ch.baseUrl && ch.apiKey)

        if (enabled.length > 0) {
            /* models 兼容数组和逗号分隔字符串两种格式 */
            const modelsList = ch => {
                const raw = ch.models
                if (Array.isArray(raw)) return raw.map(m => String(m).trim()).filter(Boolean)
                return (raw || '')
                    .split(',')
                    .map(m => m.trim())
                    .filter(Boolean)
            }

            let matched = enabled
                .filter(ch => {
                    const m = modelsList(ch)
                    return m.length === 0 || m.includes(model) || m.includes('*')
                })
                .sort((a, b) => (a.priority || 100) - (b.priority || 100))

            if (matched.length === 0) {
                matched = enabled.sort((a, b) => (a.priority || 100) - (b.priority || 100))
            }

            const best = matched[0]
            const channel = {
                id: best.id || `group-${groupId}-ch-0`,
                name: best.name || `群${groupId}独立渠道`,
                adapterType: best.adapterType || 'openai',
                baseUrl: best.baseUrl,
                apiKey: best.apiKey,
                enabled: true,
                priority: best.priority || 100,
                models: modelsList(best),
                chatPath: best.chatPath || undefined,
                modelsPath: best.modelsPath || undefined,
                imageConfig: best.imageConfig || {},
                advanced: {},
                overrides: {}
            }
            logger.info(`[ChannelManager] 群 ${groupId} 使用独立渠道: ${channel.name} (${channel.baseUrl})`)
            return { channel, source: 'group-independent-multi', model: resolvedModel }
        }

        /* 遗留单渠道兼容 */
        if (groupChannelConfig.baseUrl && groupChannelConfig.apiKey) {
            const channel = {
                id: `group-${groupId}-independent`,
                name: `群${groupId}独立渠道`,
                adapterType: groupChannelConfig.adapterType || 'openai',
                baseUrl: groupChannelConfig.baseUrl,
                apiKey: groupChannelConfig.apiKey,
                enabled: true,
                priority: 1000,
                models: groupChannelConfig.modelId ? [groupChannelConfig.modelId] : [],
                advanced: {},
                overrides: {}
            }
            if (groupChannelConfig.modelId) {
                resolvedModel = groupChannelConfig.modelId
            }
            logger.info(`[ChannelManager] 群 ${groupId} 使用遗留独立渠道`)
            return { channel, source: 'group-independent', model: resolvedModel }
        }

        /* 检查 forbidGlobal */
        if (groupChannelConfig.forbidGlobal === true) {
            return { channel: null, source: 'forbidden', model: resolvedModel }
        }

        return { channel: null, source: 'global', model: resolvedModel }
    }

    /**
     * 获取实际请求的模型名称
     * @param {string} channelId - 渠道ID
     * @param {string} requestedModel - 请求的模型名称
     * @returns {Object} { actualModel: 实际请求的模型, originalModel: 原始请求模型, mapped: 是否进行了映射 }
     */
    getActualModel(channelId, requestedModel) {
        const channel = this.channels.get(channelId)
        if (!channel) {
            logger.debug(`[ChannelManager] getActualModel: 渠道 ${channelId} 不存在`)
            return { actualModel: requestedModel, originalModel: requestedModel, mapped: false }
        }

        const modelMapping = channel.overrides?.modelMapping || {}
        const mappingKeys = Object.keys(modelMapping)
        if (mappingKeys.length > 0) {
            logger.debug(
                `[ChannelManager] 渠道 ${channel.name} 模型映射配置: ${JSON.stringify(modelMapping)}, 请求模型: ${requestedModel}`
            )
        }

        if (modelMapping[requestedModel]) {
            const actualModel = modelMapping[requestedModel]
            logger.debug(`[ChannelManager] 模型映射: ${requestedModel} -> ${actualModel} (渠道: ${channel.name})`)
            return { actualModel, originalModel: requestedModel, mapped: true }
        }
        for (const [pattern, target] of Object.entries(modelMapping)) {
            if (pattern.includes('*')) {
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i')
                if (regex.test(requestedModel)) {
                    logger.debug(
                        `[ChannelManager] 模型映射(通配符): ${requestedModel} -> ${target} (渠道: ${channel.name})`
                    )
                    return { actualModel: target, originalModel: requestedModel, mapped: true }
                }
            }
        }

        return { actualModel: requestedModel, originalModel: requestedModel, mapped: false }
    }

    /**
     * 获取渠道的模型映射配置
     * @param {string} channelId - 渠道ID
     * @returns {Object} 模型映射配置
     */
    getModelMapping(channelId) {
        const channel = this.channels.get(channelId)
        return channel?.overrides?.modelMapping || {}
    }

    /**
     * 设置渠道的模型映射配置
     * @param {string} channelId - 渠道ID
     * @param {Object} mapping - 模型映射配置，如 { "glm4": "gemini-1.5-pro" }
     * @returns {boolean} 是否成功
     */
    async setModelMapping(channelId, mapping) {
        const channel = this.channels.get(channelId)
        if (!channel) return false

        if (!channel.overrides) {
            channel.overrides = {}
        }
        channel.overrides.modelMapping = mapping || {}

        await this.saveToConfig()
        logger.info(`[ChannelManager] 更新渠道 ${channel.name} 的模型映射: ${JSON.stringify(mapping)}`)
        return true
    }

    /**
     * 添加单个模型映射
     * @param {string} channelId - 渠道ID
     * @param {string} fromModel - 源模型名称（框架内使用）
     * @param {string} toModel - 目标模型名称（实际API请求）
     * @returns {boolean} 是否成功
     */
    async addModelMapping(channelId, fromModel, toModel) {
        const channel = this.channels.get(channelId)
        if (!channel) return false

        if (!channel.overrides) {
            channel.overrides = {}
        }
        if (!channel.overrides.modelMapping) {
            channel.overrides.modelMapping = {}
        }

        channel.overrides.modelMapping[fromModel] = toModel
        await this.saveToConfig()
        logger.info(`[ChannelManager] 渠道 ${channel.name} 添加模型映射: ${fromModel} -> ${toModel}`)
        return true
    }

    /**
     * 删除单个模型映射
     * @param {string} channelId - 渠道ID
     * @param {string} fromModel - 源模型名称
     * @returns {boolean} 是否成功
     */
    async removeModelMapping(channelId, fromModel) {
        const channel = this.channels.get(channelId)
        if (!channel?.overrides?.modelMapping) return false

        delete channel.overrides.modelMapping[fromModel]
        await this.saveToConfig()
        logger.info(`[ChannelManager] 渠道 ${channel.name} 删除模型映射: ${fromModel}`)
        return true
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
     * @param {boolean} options.isRetry - 是否为重试请求（重试时不增加错误计数）
     */
    async reportError(channelId, options = {}) {
        const channel = this.channels.get(channelId)
        if (!channel) return

        const { keyIndex = -1, errorType = 'unknown', errorMessage = '', isRetry = false } = options

        channel.lastErrorType = errorType
        channel.lastErrorMessage = errorMessage

        // 如果指定了key索引，记录key级别的错误
        if (keyIndex >= 0) {
            this.reportKeyError(channelId, keyIndex)
        }

        // 重试请求不增加渠道级别的错误计数
        if (!isRetry) {
            channel.lastErrorTime = Date.now()
            channel.errorCount = (channel.errorCount || 0) + 1
        }

        // 根据错误类型决定渠道状态
        if (errorType === 'auth') {
            // 认证错误，5次后标记为error
            if (channel.errorCount >= 5) {
                channel.status = ChannelStatus.ERROR
                logger.warn(`[ChannelManager] 渠道 ${channel.name} 认证错误次数过多，已禁用`)
            }
        } else if (errorType === 'quota') {
            // 配额超限
            channel.status = ChannelStatus.QUOTA_EXCEEDED
            logger.warn(`[ChannelManager] 渠道 ${channel.name} 配额超限`)
        } else if (channel.errorCount >= 10) {
            // 非认证错误需要更多次数才禁用
            channel.status = ChannelStatus.ERROR
            logger.warn(`[ChannelManager] 渠道 ${channel.name} 错误次数过多(${channel.errorCount})，已禁用`)
        }

        logger.debug(`[ChannelManager] 渠道 ${channel.name} 错误: ${errorType}, 累计${channel.errorCount}次`)
    }

    /**
     * 报告渠道请求成功，重置错误计数
     * @param {string} channelId
     */
    reportSuccess(channelId) {
        const channel = this.channels.get(channelId)
        if (!channel) return

        // 成功时重置错误计数
        if (channel.errorCount > 0) {
            channel.errorCount = 0
            channel.lastErrorTime = null
            channel.lastErrorType = null
            channel.lastErrorMessage = null
            logger.debug(`[ChannelManager] 渠道 ${channel.name} 请求成功，重置错误计数`)
        }

        // 如果之前是error状态，恢复为idle
        if (channel.status === ChannelStatus.ERROR) {
            channel.status = ChannelStatus.IDLE
            logger.info(`[ChannelManager] 渠道 ${channel.name} 恢复正常`)
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

        let candidates = Array.from(this.channels.values()).filter(ch => {
            // 基础过滤
            if (!ch.enabled) return false
            if (excludeChannelId && ch.id === excludeChannelId) return false

            // 模型支持检查
            const hasModel = ch.models?.includes(model) || ch.models?.includes('*')
            if (!hasModel) return false

            // 状态检查
            if (!includeErrorChannels && ch.status === ChannelStatus.ERROR) return false
            if (ch.status === ChannelStatus.QUOTA_EXCEEDED) return false

            // 错误冷却检查（动态冷却时间）
            const errorCount = ch.errorCount || 0
            let cooldownMs = 0
            if (errorCount === 1) cooldownMs = 30 * 1000
            else if (errorCount === 2) cooldownMs = 60 * 1000
            else if (errorCount >= 3) cooldownMs = 5 * 60 * 1000

            if (ch.lastErrorTime && cooldownMs > 0 && now - ch.lastErrorTime < cooldownMs) {
                // 但如果有多个key，可能还有可用的
                const availableKeys = this.getAvailableKeysCount(ch)
                if (availableKeys === 0) return false
            }

            return true
        })

        return candidates.sort((a, b) => {
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
     * @param {string} model - 模型名称
     * @param {Function} executor - 执行函数，接收 (channel, keyInfo) 返回 Promise
     * @param {Object} options - 选项
     * @param {number} options.maxRetries - 最大重试次数，默认3
     * @param {number} options.retryDelay - 重试延迟(ms)，默认1000
     * @param {boolean} options.switchChannel - 是否尝试切换渠道，默认true
     * @param {boolean} options.switchKey - 是否尝试切换同渠道的Key，默认true
     * @param {boolean} options.switchBaseUrl - 是否尝试切换baseUrl，默认true
     * @returns {Promise<{success: boolean, result?: any, error?: string, attempts: number, channelsUsed: string[]}>}
     */
    async withRetry(model, executor, options = {}) {
        const {
            maxRetries = 3,
            retryDelay = 1000,
            switchChannel = true,
            switchKey = true,
            switchBaseUrl = true
        } = options

        let attempts = 0
        let lastError = null
        const channelsUsed = []
        const triedChannels = new Set()
        const triedBaseUrls = new Map() // channelId -> Set<baseUrlIndex>

        // 获取初始渠道
        let currentChannel = this.getBestChannel(model)
        if (!currentChannel) {
            return {
                success: false,
                error: `未找到支持模型 ${model} 的可用渠道`,
                attempts: 0,
                channelsUsed: []
            }
        }

        // 获取当前使用的baseUrl索引
        let currentBaseUrlIndex =
            currentChannel.selectedBaseUrlIndex !== undefined
                ? currentChannel.selectedBaseUrlIndex
                : currentChannel.baseUrls?.length > 0
                  ? 0
                  : null

        while (attempts < maxRetries) {
            attempts++
            channelsUsed.push(currentChannel.id)
            triedChannels.add(currentChannel.id)

            // 获取当前渠道的Key信息
            const keyInfo = this.getChannelKey(currentChannel)

            // 确保使用正确的baseUrl
            if (currentChannel.baseUrls && currentChannel.baseUrls.length > 0) {
                const currentBaseUrl = this.getCurrentBaseUrl(currentChannel.id)
                if (currentBaseUrl !== currentChannel.baseUrl) {
                    currentChannel.baseUrl = currentBaseUrl
                }
            }

            try {
                this.startRequest(currentChannel.id)

                logger.debug(
                    `[ChannelManager] 执行请求: 渠道=${currentChannel.name}, baseUrl=${currentChannel.baseUrl}, 尝试=${attempts}/${maxRetries}`
                )

                const result = await executor(currentChannel, keyInfo)

                // 成功，报告并返回
                this.reportSuccess(currentChannel.id)
                this.endRequest(currentChannel.id)

                return {
                    success: true,
                    result,
                    attempts,
                    channelsUsed
                }
            } catch (error) {
                this.endRequest(currentChannel.id)
                lastError = error

                // 分析错误类型
                const errorType = this.classifyError(error)
                logger.warn(
                    `[ChannelManager] 请求失败: 渠道=${currentChannel.name}, baseUrl=${currentChannel.baseUrl}, 类型=${errorType}, 错误=${error.message}`
                )

                // 报告错误
                await this.reportError(currentChannel.id, {
                    keyIndex: keyInfo.keyIndex,
                    errorType,
                    errorMessage: error.message,
                    isRetry: attempts > 1
                })

                // 判断是否需要重试
                if (attempts >= maxRetries) {
                    break
                }

                // 尝试切换策略
                let switched = false

                // 1. 先尝试切换baseUrl（如果是网络错误）
                if (switchBaseUrl && currentChannel.baseUrls && currentChannel.baseUrls.length > 1) {
                    if (!triedBaseUrls.has(currentChannel.id)) {
                        triedBaseUrls.set(currentChannel.id, new Set())
                    }
                    const triedIndices = triedBaseUrls.get(currentChannel.id)

                    // 尝试下一个未使用过的baseUrl
                    for (let i = 0; i < currentChannel.baseUrls.length; i++) {
                        const nextIndex = (currentBaseUrlIndex + i + 1) % currentChannel.baseUrls.length
                        if (!triedIndices.has(nextIndex)) {
                            const nextBaseUrl = this.switchToNextBaseUrl(currentChannel.id, currentBaseUrlIndex)
                            if (nextBaseUrl) {
                                triedIndices.add(nextIndex)
                                currentBaseUrlIndex = nextIndex
                                currentChannel.baseUrl = nextBaseUrl
                                logger.info(
                                    `[ChannelManager] 切换baseUrl: ${currentChannel.name} -> ${nextBaseUrl} (索引: ${nextIndex})`
                                )
                                switched = true
                                break
                            }
                        }
                    }
                }

                // 2. baseUrl切换失败，尝试同渠道切换Key
                if (!switched && switchKey && currentChannel.apiKeys?.length > 1) {
                    const nextKey = this.getNextAvailableKey(currentChannel.id, keyInfo.keyIndex)
                    if (nextKey) {
                        logger.info(
                            `[ChannelManager] 切换Key: ${currentChannel.name} Key#${keyInfo.keyIndex + 1} -> Key#${nextKey.keyIndex + 1}`
                        )
                        currentChannel.keyIndex = nextKey.keyIndex
                        switched = true
                    }
                }

                // 3. Key切换失败，尝试切换渠道
                if (!switched && switchChannel) {
                    const fallbackChannels = this.getAvailableChannels(model, {
                        excludeChannelId: currentChannel.id
                    }).filter(ch => !triedChannels.has(ch.id))

                    if (fallbackChannels.length > 0) {
                        const nextChannel = fallbackChannels[0]
                        logger.info(`[ChannelManager] 切换渠道: ${currentChannel.name} -> ${nextChannel.name}`)
                        currentChannel = nextChannel
                        currentBaseUrlIndex =
                            nextChannel.selectedBaseUrlIndex !== undefined
                                ? nextChannel.selectedBaseUrlIndex
                                : nextChannel.baseUrls?.length > 0
                                  ? 0
                                  : null
                        switched = true
                    }
                }

                // 4. 都无法切换，延迟后重试当前渠道
                if (!switched) {
                    logger.debug(`[ChannelManager] 无可切换选项，延迟${retryDelay}ms后重试`)
                }

                // 延迟重试
                await new Promise(r => setTimeout(r, retryDelay * attempts))
            }
        }

        return {
            success: false,
            error: lastError?.message || '请求失败，已达最大重试次数',
            attempts,
            channelsUsed
        }
    }

    /**
     * 分类错误类型
     * @param {Error} error
     * @returns {string} 错误类型
     */
    classifyError(error) {
        const msg = error.message?.toLowerCase() || ''

        if (
            msg.includes('401') ||
            msg.includes('403') ||
            msg.includes('unauthorized') ||
            msg.includes('invalid api key')
        ) {
            return 'auth'
        }
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('exceeded')) {
            return 'quota'
        }
        if (
            msg.includes('timeout') ||
            msg.includes('timed out') ||
            msg.includes('econnrefused') ||
            msg.includes('enotfound')
        ) {
            return 'network'
        }
        if (
            msg.includes('choices字段缺失') ||
            msg.includes('未能生成回复') ||
            (msg.includes('completion_tokens') && msg.includes('0'))
        ) {
            return 'empty'
        }
        if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
            return 'server'
        }

        return 'unknown'
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
            const errA = typeof a.key === 'object' ? a.key.errorCount || 0 : 0
            const errB = typeof b.key === 'object' ? b.key.errorCount || 0 : 0
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
                baseUrl: ch.baseUrl, // 保留兼容性
                baseUrls: ch.baseUrls || (ch.baseUrl ? [ch.baseUrl] : []), // 多baseUrl数组
                baseUrlLatencies: ch.baseUrlLatencies || {}, // 延迟测试结果
                selectedBaseUrlIndex: ch.selectedBaseUrlIndex !== undefined ? ch.selectedBaseUrlIndex : 0, // 选中的索引
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
                overrides: ch.overrides,
                imageConfig: ch.imageConfig,
                // 自定义路径配置
                chatPath: ch.chatPath,
                modelsPath: ch.modelsPath,
                endpoints: ch.endpoints,
                // 认证方式
                auth: ch.auth,
                // 高级配置
                timeout: ch.timeout,
                retry: ch.retry,
                quota: ch.quota,
                weight: ch.weight,
                // 状态
                status: ch.status,
                lastHealthCheck: ch.lastHealthCheck,
                testedAt: ch.testedAt,
                errorCount: ch.errorCount,
                lastErrorTime: ch.lastErrorTime
            }))

        config.set('channels', channelsArray)
    }

    /**
     * 记录渠道使用
     * @param {string} channelId
     * @param {Object} usage { tokens, success, duration, model, keyIndex, switched, previousChannelId }
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
                avgDuration: 0,
                lastUsed: null,
                // 新增统计项
                modelUsage: {}, // 按模型统计
                keyUsage: {}, // 按Key统计
                switchCount: 0, // 切换次数
                errorTypes: {}, // 错误类型统计
                hourlyStats: {}, // 按小时统计
                dailyStats: {} // 按日统计
            }
            this.channelStats.set(channelId, stats)
        }

        const now = Date.now()
        const hour = new Date().getHours()
        const day = new Date().toISOString().split('T')[0]

        stats.totalCalls++
        if (usage.success !== false) {
            stats.successCalls++
        } else {
            stats.failedCalls++
            // 记录错误类型
            if (usage.errorType) {
                stats.errorTypes[usage.errorType] = (stats.errorTypes[usage.errorType] || 0) + 1
            }
        }
        if (usage.tokens) {
            stats.totalTokens += usage.tokens
        }
        if (usage.duration) {
            stats.totalDuration += usage.duration
            stats.avgDuration = Math.round(stats.totalDuration / stats.totalCalls)
        }
        stats.lastUsed = now

        // 按模型统计
        if (usage.model) {
            if (!stats.modelUsage[usage.model]) {
                stats.modelUsage[usage.model] = { calls: 0, tokens: 0, success: 0, failed: 0 }
            }
            stats.modelUsage[usage.model].calls++
            if (usage.tokens) stats.modelUsage[usage.model].tokens += usage.tokens
            if (usage.success !== false) {
                stats.modelUsage[usage.model].success++
            } else {
                stats.modelUsage[usage.model].failed++
            }
        }

        // 按Key统计
        if (usage.keyIndex !== undefined && usage.keyIndex >= 0) {
            const keyId = `key_${usage.keyIndex}`
            if (!stats.keyUsage[keyId]) {
                stats.keyUsage[keyId] = { calls: 0, success: 0, failed: 0, errors: 0 }
            }
            stats.keyUsage[keyId].calls++
            if (usage.success !== false) {
                stats.keyUsage[keyId].success++
            } else {
                stats.keyUsage[keyId].failed++
            }
        }

        // 记录渠道切换
        if (usage.switched) {
            stats.switchCount++
        }

        // 按小时统计（保留最近24小时）
        if (!stats.hourlyStats[hour]) {
            stats.hourlyStats[hour] = { calls: 0, success: 0, tokens: 0 }
        }
        stats.hourlyStats[hour].calls++
        if (usage.success !== false) stats.hourlyStats[hour].success++
        if (usage.tokens) stats.hourlyStats[hour].tokens += usage.tokens

        // 按日统计（保留最近7天）
        if (!stats.dailyStats[day]) {
            stats.dailyStats[day] = { calls: 0, success: 0, tokens: 0 }
            // 清理旧数据（保留7天）
            const days = Object.keys(stats.dailyStats).sort()
            if (days.length > 7) {
                delete stats.dailyStats[days[0]]
            }
        }
        stats.dailyStats[day].calls++
        if (usage.success !== false) stats.dailyStats[day].success++
        if (usage.tokens) stats.dailyStats[day].tokens += usage.tokens
    }

    /**
     * 获取渠道统计
     * @param {string} channelId
     * @returns {Object|null}
     */
    getStats(channelId) {
        if (channelId) {
            const stats = this.channelStats.get(channelId)
            if (!stats) return null

            // 计算成功率
            const successRate = stats.totalCalls > 0 ? Math.round((stats.successCalls / stats.totalCalls) * 100) : 0

            return {
                ...stats,
                successRate,
                avgTokensPerCall: stats.totalCalls > 0 ? Math.round(stats.totalTokens / stats.totalCalls) : 0
            }
        }
        // 返回所有统计（带计算字段）
        const allStats = {}
        for (const [id, stats] of this.channelStats) {
            const successRate = stats.totalCalls > 0 ? Math.round((stats.successCalls / stats.totalCalls) * 100) : 0
            allStats[id] = {
                ...stats,
                successRate,
                avgTokensPerCall: stats.totalCalls > 0 ? Math.round(stats.totalTokens / stats.totalCalls) : 0
            }
        }
        return allStats
    }

    /**
     * 获取渠道负载均衡统计摘要
     * @returns {Object}
     */
    getLoadBalanceSummary() {
        const channels = Array.from(this.channels.values())
        const stats = this.getStats()

        const summary = {
            totalChannels: channels.length,
            enabledChannels: channels.filter(ch => ch.enabled !== false).length,
            healthyChannels: channels.filter(ch => ch.status !== 'error' && ch.status !== 'disabled').length,
            totalCalls: 0,
            totalSuccess: 0,
            totalFailed: 0,
            totalTokens: 0,
            totalSwitches: 0,
            avgSuccessRate: 0,
            channelBreakdown: [],
            topModels: [],
            errorSummary: {}
        }

        // 聚合统计
        for (const ch of channels) {
            const chStats = stats[ch.id] || {}
            summary.totalCalls += chStats.totalCalls || 0
            summary.totalSuccess += chStats.successCalls || 0
            summary.totalFailed += chStats.failedCalls || 0
            summary.totalTokens += chStats.totalTokens || 0
            summary.totalSwitches += chStats.switchCount || 0

            // 错误类型聚合
            if (chStats.errorTypes) {
                for (const [type, count] of Object.entries(chStats.errorTypes)) {
                    summary.errorSummary[type] = (summary.errorSummary[type] || 0) + count
                }
            }

            // 渠道详情
            summary.channelBreakdown.push({
                id: ch.id,
                name: ch.name,
                status: ch.status || 'idle',
                calls: chStats.totalCalls || 0,
                successRate: chStats.successRate || 0,
                tokens: chStats.totalTokens || 0,
                avgDuration: chStats.avgDuration || 0,
                errorCount: ch.errorCount || 0
            })
        }

        // 计算平均成功率
        summary.avgSuccessRate =
            summary.totalCalls > 0 ? Math.round((summary.totalSuccess / summary.totalCalls) * 100) : 0

        // 按调用量排序
        summary.channelBreakdown.sort((a, b) => b.calls - a.calls)

        // 聚合模型使用统计
        const modelStats = new Map()
        for (const chStats of Object.values(stats)) {
            if (chStats.modelUsage) {
                for (const [model, mStats] of Object.entries(chStats.modelUsage)) {
                    if (!modelStats.has(model)) {
                        modelStats.set(model, { calls: 0, tokens: 0 })
                    }
                    const existing = modelStats.get(model)
                    existing.calls += mStats.calls || 0
                    existing.tokens += mStats.tokens || 0
                }
            }
        }
        summary.topModels = Array.from(modelStats.entries())
            .map(([model, s]) => ({ model, ...s }))
            .sort((a, b) => b.calls - a.calls)
            .slice(0, 10)

        return summary
    }

    /**
     * 获取所有渠道及其统计
     */
    getAllWithStats() {
        return Array.from(this.channels.values()).map(ch => ({
            ...ch,
            stats: this.getStats(ch.id) || {
                totalCalls: 0,
                successCalls: 0,
                failedCalls: 0,
                totalTokens: 0,
                successRate: 0
            }
        }))
    }

    /**
     * 清空统计
     * @param {string} [channelId] - 指定渠道ID，不传则清空所有
     */
    clearStats(channelId) {
        if (channelId) {
            this.channelStats.delete(channelId)
        } else {
            this.channelStats.clear()
        }
    }
}

// Export singleton
export const channelManager = new ChannelManager()
