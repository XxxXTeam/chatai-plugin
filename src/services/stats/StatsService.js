/**
 * 统计服务 - 消息、模型、tokens 统计
 * 统一管理所有统计数据来源
 */
import { databaseService } from '../storage/DatabaseService.js'
import { toolCallStats } from './ToolCallStats.js'
import { usageStats } from './UsageStats.js'
import { telemetryService } from '../telemetry/index.js'
import { chatLogger } from '../../core/utils/logger.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const logger = chatLogger

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** 统计数据落盘节流间隔(ms) */
const STATS_FLUSH_INTERVAL = 5000
/** byUser / byGroup 等实体维度保留的最大条目数 */
const STATS_MAX_ENTITY_KEYS = 2000

class StatsService {
    constructor() {
        this.statsFile = path.join(__dirname, '../../../data/stats.json')
        this.stats = {
            messages: { total: 0, byType: {}, byGroup: {}, byUser: {}, byHour: {} },
            models: { total: 0, byModel: {}, byChannel: {} },
            tokens: {
                total: { input: 0, output: 0 },
                cache: { readTokens: 0, writeTokens: 0, readCount: 0, writeCount: 0 },
                reasoning: { tokens: 0 },
                byModel: {},
                byUser: {}
            },
            tools: { total: 0, byTool: {} },
            startTime: Date.now(),
            lastUpdate: Date.now()
        }
        this.loaded = false

        // 落盘节流状态
        this._dirty = false
        this._flushTimer = null
        this._writing = false
        this._exitHookRegistered = false

        // 实时RPM跟踪（滑动窗口）
        this.requestTimestamps = [] // 请求时间戳数组
        this.rpmWindowMs = 60 * 1000 // 1分钟窗口
        this.rpm5WindowMs = 5 * 60 * 1000 // 5分钟窗口
        this.maxTimestamps = 10000 // 最多保留的时间戳数
    }

    /**
     * 记录一次请求时间戳
     */
    recordRequestTimestamp() {
        const now = Date.now()
        this.requestTimestamps.push(now)
        const cutoff = now - this.rpm5WindowMs
        while (this.requestTimestamps.length > 0 && this.requestTimestamps[0] < cutoff) {
            this.requestTimestamps.shift()
        }
        if (this.requestTimestamps.length > this.maxTimestamps) {
            this.requestTimestamps = this.requestTimestamps.slice(-this.maxTimestamps)
        }
    }

    /**
     * 获取实时RPM统计
     * @returns {{ rpm: number, rpm5: number, successRate: number }}
     */
    getRealTimeRpm() {
        const now = Date.now()
        const oneMinuteAgo = now - this.rpmWindowMs
        const fiveMinutesAgo = now - this.rpm5WindowMs

        // 计算最近1分钟和5分钟的请求数
        const lastMinuteCount = this.requestTimestamps.filter(t => t >= oneMinuteAgo).length
        const lastFiveMinutesCount = this.requestTimestamps.filter(t => t >= fiveMinutesAgo).length

        return {
            rpm: lastMinuteCount,
            rpm5: lastFiveMinutesCount > 0 ? Math.round(lastFiveMinutesCount / 5) : 0,
            totalRequests: this.requestTimestamps.length
        }
    }

    /**
     * 初始化/加载统计数据
     */
    init() {
        if (this.loaded) return
        try {
            if (fs.existsSync(this.statsFile)) {
                const data = fs.readFileSync(this.statsFile, 'utf8')
                this.stats = { ...this.stats, ...JSON.parse(data) }
            }
            this._ensureStatsShape()
            this.loaded = true
        } catch (err) {
            console.error('[StatsService] 加载统计数据失败:', err.message)
        }
    }

    /**
     * 补齐旧统计文件中不存在的新字段。
     */
    _ensureStatsShape() {
        this.stats.messages ||= { total: 0, byType: {}, byGroup: {}, byUser: {}, byHour: {} }
        this.stats.models ||= { total: 0, byModel: {}, byChannel: {} }
        this.stats.tokens ||= {}
        this.stats.tokens.total ||= { input: 0, output: 0 }
        this.stats.tokens.total.input ??= 0
        this.stats.tokens.total.output ??= 0
        this.stats.tokens.cache ||= { readTokens: 0, writeTokens: 0, readCount: 0, writeCount: 0 }
        this.stats.tokens.cache.readTokens ??= 0
        this.stats.tokens.cache.writeTokens ??= 0
        this.stats.tokens.cache.readCount ??= 0
        this.stats.tokens.cache.writeCount ??= 0
        this.stats.tokens.reasoning ||= { tokens: 0 }
        this.stats.tokens.reasoning.tokens ??= 0
        this.stats.tokens.byModel ||= {}
        this.stats.tokens.byUser ||= {}
        this.stats.tools ||= { total: 0, byTool: {} }
    }

    /**
     * 保存统计数据（同步全量写盘，仅用于重置、退出等必须立即落盘的场景）
     * 高频路径请改用 markDirty()
     * @returns {void}
     */
    save() {
        try {
            const dir = path.dirname(this.statsFile)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            this._capEntityRecords()
            this.stats.lastUpdate = Date.now()
            fs.writeFileSync(this.statsFile, JSON.stringify(this.stats))
            this._dirty = false
        } catch (err) {
            console.error('[StatsService] 保存统计数据失败:', err.message)
        }
    }

    /**
     * 标记统计数据已变更，交由节流任务异步落盘
     * 高频路径（每次 token 记录 / 工具调用）若直接同步全量写盘会阻塞事件循环
     * @returns {void}
     */
    markDirty() {
        this._dirty = true
        this.registerExitHook()

        if (this._flushTimer) return
        this._flushTimer = setTimeout(() => {
            this._flushTimer = null
            this.flush().catch(err => logger.warn('[StatsService] 异步保存统计失败:', err.message))
        }, STATS_FLUSH_INTERVAL)
        this._flushTimer.unref?.()
    }

    /**
     * 异步落盘（串行化，避免并发写入导致文件内容交错）
     * @returns {Promise<void>}
     */
    async flush() {
        if (!this._dirty || this._writing) return
        this._writing = true
        this._dirty = false

        try {
            this._capEntityRecords()
            await fs.promises.mkdir(path.dirname(this.statsFile), { recursive: true })
            this.stats.lastUpdate = Date.now()
            await fs.promises.writeFile(this.statsFile, JSON.stringify(this.stats))
        } catch (err) {
            this._dirty = true // 写失败保留脏标记，下次继续尝试
            logger.warn('[StatsService] 保存统计数据失败:', err.message)
        } finally {
            this._writing = false
        }
    }

    /**
     * 注册进程退出钩子，确保未落盘的统计不丢失
     * @returns {void}
     */
    registerExitHook() {
        if (this._exitHookRegistered || typeof process === 'undefined') return
        this._exitHookRegistered = true

        // exit 事件内无法等待异步操作，只能同步写
        process.once('exit', () => {
            if (this._dirty) this.save()
        })
    }

    /**
     * 限制按用户 / 群维度的统计条目数，防止随 QQ 号无限累积
     * 超限时保留活跃度最高的条目
     * @returns {void}
     */
    _capEntityRecords() {
        this._capRecord(this.stats.messages?.byUser, v => v || 0)
        this._capRecord(this.stats.messages?.byGroup, v => v || 0)
        this._capRecord(this.stats.tokens?.byUser, v => (v?.input || 0) + (v?.output || 0))
    }

    /**
     * 按权重裁剪统计对象的条目数
     * @param {Object} record - 待裁剪的统计对象
     * @param {Function} weightOf - 从条目值计算排序权重
     * @returns {void}
     */
    _capRecord(record, weightOf) {
        if (!record || typeof record !== 'object') return
        const keys = Object.keys(record)
        if (keys.length <= STATS_MAX_ENTITY_KEYS) return

        keys.sort((a, b) => weightOf(record[b]) - weightOf(record[a]))
        for (const key of keys.slice(STATS_MAX_ENTITY_KEYS)) {
            delete record[key]
        }
    }

    /**
     * 记录消息
     * @param {Object} options
     */
    recordMessage({ type = 'text', groupId, userId, source = 'unknown' }) {
        this.init()

        this.stats.messages.total++

        // 按类型统计
        this.stats.messages.byType[type] = (this.stats.messages.byType[type] || 0) + 1

        // 按群统计
        if (groupId) {
            this.stats.messages.byGroup[groupId] = (this.stats.messages.byGroup[groupId] || 0) + 1
        }

        // 按用户统计
        if (userId) {
            this.stats.messages.byUser[userId] = (this.stats.messages.byUser[userId] || 0) + 1
        }

        // 按小时统计
        const hour = new Date().getHours()
        this.stats.messages.byHour[hour] = (this.stats.messages.byHour[hour] || 0) + 1

        this.markDirty()
    }

    /**
     * 记录模型调用（内部方法，仅更新内存统计）
     * @deprecated 请使用 recordApiCall() 代替
     * @param {Object} options
     */
    recordModelCall({ model, channelId, userId, inputTokens = 0, outputTokens = 0, success = true }) {
        this._updateModelStats({ model, channelId, userId, inputTokens, outputTokens, success })
    }

    /**
     * 更新内存中的模型统计（内部方法）
     * @private
     */
    _updateModelStats({
        model,
        channelId,
        userId,
        inputTokens = 0,
        outputTokens = 0,
        cacheReadTokens = 0,
        cacheWriteTokens = 0,
        cacheReadCount = 0,
        cacheWriteCount = 0,
        reasoningTokens = 0,
        success = true
    }) {
        this.init()
        this._ensureStatsShape()

        this.stats.models.total++

        // 按模型统计
        if (!this.stats.models.byModel[model]) {
            this.stats.models.byModel[model] = {
                calls: 0,
                success: 0,
                failed: 0,
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                cacheReadCount: 0,
                cacheWriteCount: 0,
                reasoningTokens: 0
            }
        }
        const modelStats = this.stats.models.byModel[model]
        modelStats.cacheReadTokens ??= 0
        modelStats.cacheWriteTokens ??= 0
        modelStats.cacheReadCount ??= 0
        modelStats.cacheWriteCount ??= 0
        modelStats.reasoningTokens ??= 0
        modelStats.calls++
        if (success) modelStats.success++
        else modelStats.failed++
        modelStats.inputTokens += inputTokens
        modelStats.outputTokens += outputTokens
        modelStats.cacheReadTokens += cacheReadTokens
        modelStats.cacheWriteTokens += cacheWriteTokens
        modelStats.cacheReadCount += cacheReadCount
        modelStats.cacheWriteCount += cacheWriteCount
        modelStats.reasoningTokens += reasoningTokens

        // 按渠道统计
        if (channelId) {
            if (!this.stats.models.byChannel[channelId]) {
                this.stats.models.byChannel[channelId] = {
                    calls: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    cacheReadCount: 0,
                    cacheWriteCount: 0,
                    reasoningTokens: 0
                }
            }
            const channelStats = this.stats.models.byChannel[channelId]
            channelStats.cacheReadTokens ??= 0
            channelStats.cacheWriteTokens ??= 0
            channelStats.cacheReadCount ??= 0
            channelStats.cacheWriteCount ??= 0
            channelStats.reasoningTokens ??= 0
            channelStats.calls++
            channelStats.inputTokens += inputTokens
            channelStats.outputTokens += outputTokens
            channelStats.cacheReadTokens += cacheReadTokens
            channelStats.cacheWriteTokens += cacheWriteTokens
            channelStats.cacheReadCount += cacheReadCount
            channelStats.cacheWriteCount += cacheWriteCount
            channelStats.reasoningTokens += reasoningTokens
        }

        // 总tokens
        this.stats.tokens.total.input += inputTokens
        this.stats.tokens.total.output += outputTokens
        this.stats.tokens.cache.readTokens += cacheReadTokens
        this.stats.tokens.cache.writeTokens += cacheWriteTokens
        this.stats.tokens.cache.readCount += cacheReadCount
        this.stats.tokens.cache.writeCount += cacheWriteCount
        this.stats.tokens.reasoning.tokens += reasoningTokens

        // 按用户tokens
        if (userId) {
            if (!this.stats.tokens.byUser[userId]) {
                this.stats.tokens.byUser[userId] = {
                    input: 0,
                    output: 0,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    reasoningTokens: 0
                }
            }
            const userStats = this.stats.tokens.byUser[userId]
            userStats.cacheReadTokens ??= 0
            userStats.cacheWriteTokens ??= 0
            userStats.reasoningTokens ??= 0
            userStats.input += inputTokens
            userStats.output += outputTokens
            userStats.cacheReadTokens += cacheReadTokens
            userStats.cacheWriteTokens += cacheWriteTokens
            userStats.reasoningTokens += reasoningTokens
        }

        // 按模型tokens
        if (!this.stats.tokens.byModel[model]) {
            this.stats.tokens.byModel[model] = {
                input: 0,
                output: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                reasoningTokens: 0
            }
        }
        const tokenModelStats = this.stats.tokens.byModel[model]
        tokenModelStats.cacheReadTokens ??= 0
        tokenModelStats.cacheWriteTokens ??= 0
        tokenModelStats.reasoningTokens ??= 0
        tokenModelStats.input += inputTokens
        tokenModelStats.output += outputTokens
        tokenModelStats.cacheReadTokens += cacheReadTokens
        tokenModelStats.cacheWriteTokens += cacheWriteTokens
        tokenModelStats.reasoningTokens += reasoningTokens

        this.markDirty()
    }

    /**
     * 统一的API调用记录入口（推荐使用）
     * 同时更新内存统计和Redis详细记录，确保数据一致性
     *
     * @param {Object} options - 调用信息
     * @param {string} options.channelId - 渠道ID
     * @param {string} options.channelName - 渠道名称
     * @param {string} options.model - 模型名称
     * @param {number} [options.keyIndex] - Key索引
     * @param {string} [options.keyName] - Key名称
     * @param {string} [options.strategy] - 轮询策略
     * @param {number} [options.inputTokens] - 输入tokens（优先使用API返回值，否则估算）
     * @param {number} [options.outputTokens] - 输出tokens（优先使用API返回值，否则估算）
     * @param {number} [options.duration] - 耗时(ms)
     * @param {boolean} [options.success=true] - 是否成功
     * @param {string} [options.error] - 错误信息
     * @param {string} [options.source='chat'] - 请求来源
     * @param {string} [options.userId] - 用户ID
     * @param {string} [options.groupId] - 群组ID
     * @param {boolean} [options.stream] - 是否流式
     * @param {Object} [options.request] - 请求信息
     * @param {Object} [options.response] - 响应信息（仅失败时）
     * @param {number} [options.retryCount] - 重试次数
     * @param {boolean} [options.channelSwitched] - 是否切换了渠道
     * @param {boolean} [options.fallbackUsed] - 是否使用了备选模型
     * @param {string} [options.previousChannelId] - 切换前的渠道ID
     * @param {Array} [options.messages] - 消息数组（用于估算tokens）
     * @param {string} [options.responseText] - 响应文本（用于估算tokens）
     * @param {Object} [options.apiUsage] - API返回的usage对象
     * @returns {Promise<string>} 记录ID
     */
    async recordApiCall(options) {
        // 记录请求时间戳用于实时RPM计算
        this.recordRequestTimestamp()

        const {
            channelId,
            channelName,
            model,
            keyIndex = -1,
            keyName = '',
            strategy = '',
            inputTokens: providedInputTokens,
            outputTokens: providedOutputTokens,
            duration = 0,
            success = true,
            error = null,
            source = 'chat',
            userId = null,
            groupId = null,
            stream = false,
            request = null,
            response = null,
            retryCount = 0,
            channelSwitched = false,
            fallbackUsed = false,
            previousChannelId = null,
            switchChain = null,
            messages = null,
            responseText = null,
            apiUsage = null
        } = options
        const reportedModel =
            options.reportedModel ||
            options.responseModel ||
            response?.model ||
            apiUsage?.model ||
            apiUsage?.responseModel ||
            null
        const effectiveModel = reportedModel || model || 'unknown'
        let inputTokens = providedInputTokens
        let outputTokens = providedOutputTokens
        let cacheReadTokens = 0
        let cacheCreationTokens = 0
        let cacheWriteTokens = 0
        let cacheReadCount = 0
        let cacheWriteCount = 0
        let reasoningTokens = 0
        let isEstimated = false
        if (apiUsage) {
            if (apiUsage.prompt_tokens !== undefined) {
                inputTokens = apiUsage.prompt_tokens
            } else if (apiUsage.promptTokens !== undefined) {
                inputTokens = apiUsage.promptTokens
            } else if (apiUsage.input_tokens !== undefined) {
                inputTokens = apiUsage.input_tokens
            }

            if (apiUsage.completion_tokens !== undefined) {
                outputTokens = apiUsage.completion_tokens
            } else if (apiUsage.completionTokens !== undefined) {
                outputTokens = apiUsage.completionTokens
            } else if (apiUsage.output_tokens !== undefined) {
                outputTokens = apiUsage.output_tokens
            }

            cacheReadTokens =
                apiUsage.cache_read_input_tokens ||
                apiUsage.cacheReadTokens ||
                apiUsage.cachedTokens ||
                apiUsage.cached_tokens ||
                apiUsage.prompt_tokens_details?.cached_tokens ||
                apiUsage.input_tokens_details?.cached_tokens ||
                apiUsage.cachedContentTokenCount ||
                0
            cacheCreationTokens =
                apiUsage.cache_creation_input_tokens ||
                apiUsage.cacheCreationTokens ||
                apiUsage.cacheWriteTokens ||
                apiUsage.prompt_tokens_details?.cache_creation_tokens ||
                apiUsage.input_tokens_details?.cache_creation_tokens ||
                0
            cacheWriteTokens = apiUsage.cacheWriteTokens || cacheCreationTokens || 0
            cacheReadCount = apiUsage.cacheReadCount || (cacheReadTokens > 0 ? 1 : 0)
            cacheWriteCount = apiUsage.cacheWriteCount || (cacheWriteTokens > 0 ? 1 : 0)
            reasoningTokens =
                apiUsage.completion_tokens_details?.reasoning_tokens ||
                apiUsage.output_tokens_details?.reasoning_tokens ||
                apiUsage.reasoning_tokens ||
                apiUsage.reasoningTokens ||
                0
        }
        if (inputTokens === undefined || inputTokens === null) {
            if (messages) {
                inputTokens = usageStats.estimateMessagesTokens(messages)
            } else {
                inputTokens = 0
            }
            isEstimated = true
        }

        if (outputTokens === undefined || outputTokens === null) {
            if (responseText) {
                outputTokens = usageStats.estimateTokens(responseText)
            } else {
                outputTokens = 0
            }
            isEstimated = true
        }

        const totalTokens = inputTokens + outputTokens

        // 1. 更新内存统计（同步）
        try {
            this._updateModelStats({
                model: effectiveModel,
                channelId,
                userId,
                inputTokens,
                outputTokens,
                cacheReadTokens,
                cacheWriteTokens,
                cacheReadCount,
                cacheWriteCount,
                reasoningTokens,
                success
            })
        } catch (err) {
            logger.warn('[StatsService] 更新内存统计失败:', err.message)
        }

        // 2. 记录到遥测服务（异步，不含敏感信息）
        try {
            telemetryService.recordUsage({
                model: effectiveModel,
                inputTokens,
                outputTokens,
                success,
                duration
            })
        } catch (err) {
            logger.debug('[StatsService] 遥测记录失败:', err.message)
        }

        // 3. 记录到Redis详细统计（异步）
        let recordId = null
        try {
            recordId = await usageStats.record({
                channelId: channelId || 'unknown',
                channelName: channelName || 'Unknown',
                model: effectiveModel,
                requestedModel: model || 'unknown',
                reportedModel,
                keyIndex,
                keyName,
                strategy,
                inputTokens,
                outputTokens,
                totalTokens,
                cacheReadTokens,
                cacheCreationTokens,
                cacheWriteTokens,
                cacheReadCount,
                cacheWriteCount,
                reasoningTokens,
                duration,
                success,
                error,
                retryCount,
                channelSwitched,
                fallbackUsed,
                previousChannelId,
                switchChain,
                source,
                userId,
                groupId,
                stream,
                isEstimated,
                request,
                response: !success ? response : null
            })
        } catch (err) {
            logger.warn('[StatsService] 记录详细统计失败:', err.message)
        }

        return recordId
    }

    /**
     * 记录工具调用（简化版，用于快速计数）
     */
    recordToolCall(toolName, success = true) {
        this.init()

        this.stats.tools.total++

        if (!this.stats.tools.byTool[toolName]) {
            this.stats.tools.byTool[toolName] = { calls: 0, success: 0, failed: 0 }
        }
        this.stats.tools.byTool[toolName].calls++
        if (success) this.stats.tools.byTool[toolName].success++
        else this.stats.tools.byTool[toolName].failed++

        this.markDirty()
    }

    /**
     * 记录完整工具调用（包含请求和响应详情）
     * @param {Object} options - 调用详情
     */
    async recordToolCallFull(options) {
        const {
            toolName,
            request,
            response,
            success = true,
            error,
            duration = 0,
            userId,
            groupId,
            source = 'mcp'
        } = options

        // 更新简化统计
        this.recordToolCall(toolName, success)

        // 记录到详细统计
        try {
            await toolCallStats.record({
                toolName,
                request,
                response,
                success,
                error: error?.message || error,
                errorStack: error?.stack,
                duration,
                userId,
                groupId,
                source
            })
        } catch (err) {
            console.error('[StatsService] 记录工具调用详情失败:', err.message)
        }
    }

    /**
     * 获取完整统计
     */
    getStats() {
        this.init()
        return { ...this.stats }
    }

    /**
     * 获取概览统计（用于面板显示）
     */
    getOverview() {
        this.init()

        const db = databaseService
        if (!db.initialized) {
            db.init()
        }
        const dbStats = db.getStats()

        // 计算运行时间
        const uptime = Date.now() - this.stats.startTime
        const days = Math.floor(uptime / (24 * 60 * 60 * 1000))
        const hours = Math.floor((uptime % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))

        return {
            // 消息统计
            messages: {
                total: this.stats.messages.total,
                conversations: dbStats.conversationCount,
                dbMessages: dbStats.messageCount,
                types: this.stats.messages.byType,
                topGroups: this.getTopN(this.stats.messages.byGroup, 10),
                topUsers: this.getTopN(this.stats.messages.byUser, 10),
                hourlyDistribution: this.stats.messages.byHour
            },
            // 模型统计
            models: {
                totalCalls: this.stats.models.total,
                byModel: Object.entries(this.stats.models.byModel)
                    .map(([name, stats]) => ({ name, ...stats }))
                    .sort((a, b) => b.calls - a.calls),
                byChannel: this.stats.models.byChannel
            },
            // Tokens统计
            tokens: {
                total: this.stats.tokens.total,
                totalSum: this.stats.tokens.total.input + this.stats.tokens.total.output,
                cache: this.stats.tokens.cache,
                reasoning: this.stats.tokens.reasoning,
                byModel: Object.entries(this.stats.tokens.byModel)
                    .map(([name, stats]) => ({
                        name,
                        ...stats,
                        cacheReadTokens: stats.cacheReadTokens || 0,
                        cacheWriteTokens: stats.cacheWriteTokens || 0,
                        reasoningTokens: stats.reasoningTokens || 0,
                        total: stats.input + stats.output
                    }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 10),
                topUsers: Object.entries(this.stats.tokens.byUser)
                    .map(([userId, stats]) => ({
                        userId,
                        ...stats,
                        cacheReadTokens: stats.cacheReadTokens || 0,
                        cacheWriteTokens: stats.cacheWriteTokens || 0,
                        reasoningTokens: stats.reasoningTokens || 0,
                        total: stats.input + stats.output
                    }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 10)
            },
            // 工具统计
            tools: {
                totalCalls: this.stats.tools.total,
                byTool: Object.entries(this.stats.tools.byTool)
                    .map(([name, stats]) => ({ name, ...stats }))
                    .sort((a, b) => b.calls - a.calls)
                    .slice(0, 20)
            },
            // 运行时间
            uptime: { days, hours, startTime: this.stats.startTime },
            lastUpdate: this.stats.lastUpdate
        }
    }

    /**
     * 获取前 N 个
     */
    getTopN(obj, n = 10) {
        return Object.entries(obj)
            .map(([key, value]) => ({ id: key, count: value }))
            .sort((a, b) => b.count - a.count)
            .slice(0, n)
    }

    /**
     * 重置统计
     */
    async reset() {
        this.stats = {
            messages: { total: 0, byType: {}, byGroup: {}, byUser: {}, byHour: {} },
            models: { total: 0, byModel: {}, byChannel: {} },
            tokens: {
                total: { input: 0, output: 0 },
                cache: { readTokens: 0, writeTokens: 0, readCount: 0, writeCount: 0 },
                reasoning: { tokens: 0 },
                byModel: {},
                byUser: {}
            },
            tools: { total: 0, byTool: {} },
            startTime: Date.now(),
            lastUpdate: Date.now()
        }
        this.save()

        // 同时清空工具调用详细统计
        try {
            await toolCallStats.clear()
        } catch (err) {
            console.error('[StatsService] 清空工具调用统计失败:', err.message)
        }

        // 同时清空使用统计
        try {
            await usageStats.clear()
        } catch (err) {
            console.error('[StatsService] 清空使用统计失败:', err.message)
        }
    }

    /**
     * 获取今日统计
     */
    getTodayStats() {
        // 简化版：返回当前内存中的统计
        // 后续可以添加按日期分割的统计
        return this.getOverview()
    }

    /**
     * 获取工具调用详细记录
     * @param {Object} filter - 过滤条件
     * @param {number} limit - 返回数量
     */
    async getToolCallRecords(filter = {}, limit = 100) {
        return await toolCallStats.getRecords(filter, limit)
    }

    /**
     * 获取工具调用统计汇总
     */
    async getToolCallSummary() {
        return await toolCallStats.getSummary()
    }

    /**
     * 获取单条工具调用记录详情
     */
    async getToolCallRecord(id) {
        return await toolCallStats.getRecord(id)
    }

    /**
     * 获取工具错误记录
     */
    async getToolErrors(limit = 50) {
        return await toolCallStats.getErrors(limit)
    }

    /**
     * 获取统一的完整统计（合并所有来源）
     */
    async getUnifiedStats() {
        this.init()

        const overview = this.getOverview()
        const toolCallSummary = await toolCallStats.getSummary()
        let usageToday = {}

        try {
            usageToday = await usageStats.getTodayStats()
        } catch {}

        return {
            ...overview,
            // 工具调用详细统计
            toolCalls: {
                summary: toolCallSummary,
                recentErrors: toolCallSummary.recentErrors
            },
            // API 使用统计
            apiUsage: usageToday
        }
    }

    /**
     * 导出所有统计数据
     */
    async exportAll() {
        const stats = this.getStats()
        const toolCallData = await toolCallStats.export()

        return {
            general: stats,
            toolCalls: toolCallData,
            exportTime: Date.now()
        }
    }

    /**
     * 获取 API 调用记录
     */
    async getApiCalls({ page = 1, limit = 20, channelId, success, startTime, endTime } = {}) {
        const safePage = Math.max(1, Number(page) || 1)
        const safeLimit = Math.min(200, Math.max(1, Number(limit) || 20))
        const filter = {}
        if (channelId) filter.channelId = channelId
        if (success !== undefined) filter.success = success
        if (startTime) filter.startTime = startTime
        if (endTime) filter.endTime = endTime

        const records = await usageStats.getRecent(safePage * safeLimit, filter)
        const start = (safePage - 1) * safeLimit
        return {
            records: records.slice(start, start + safeLimit),
            pagination: {
                page: safePage,
                limit: safeLimit,
                total: records.length,
                hasMore: records.length > start + safeLimit
            }
        }
    }

    /**
     * 获取渠道调用统计
     */
    async getChannelStats() {
        return await usageStats.getChannelRanking(100)
    }

    /**
     * 获取模型调用统计
     */
    async getModelStats() {
        return await usageStats.getModelRanking(100)
    }

    /**
     * 清除所有统计数据
     */
    async clear() {
        return await this.reset()
    }

    /**
     * 获取今日API使用统计
     */
    async getUsageTodayStats() {
        return await usageStats.getTodayStats()
    }

    /**
     * 获取最近的使用记录
     * @param {number} limit - 数量限制
     * @param {Object} filter - 过滤条件
     */
    async getUsageRecent(limit = 50, filter = {}) {
        return await usageStats.getRecent(limit, filter)
    }

    /**
     * 获取模型使用排行
     * @param {number} limit - 数量限制
     */
    async getModelRanking(limit = 10) {
        return await usageStats.getModelRanking(limit)
    }

    /**
     * 获取渠道使用排行
     * @param {number} limit - 数量限制
     */
    async getChannelRanking(limit = 10) {
        return await usageStats.getChannelRanking(limit)
    }

    /**
     * 获取渠道统计
     * @param {string} channelId - 渠道ID
     */
    async getChannelUsageStats(channelId) {
        return await usageStats.getChannelStats(channelId)
    }

    /**
     * 获取用户统计
     * @param {string} userId - 用户ID
     */
    async getUserUsageStats(userId) {
        return await usageStats.getUserStats(userId)
    }

    /**
     * 清除使用统计
     */
    async clearUsageStats() {
        return await usageStats.clear()
    }

    /**
     * Token估算辅助方法
     * @param {string} text - 文本
     */
    estimateTokens(text) {
        return usageStats.estimateTokens(text)
    }

    /**
     * 消息数组Token估算
     * @param {Array} messages - 消息数组
     */
    estimateMessagesTokens(messages) {
        return usageStats.estimateMessagesTokens(messages)
    }
}

export const statsService = new StatsService()
