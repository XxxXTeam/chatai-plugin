/**
 * 统计服务 - 消息、模型、tokens 统计
 * 统一管理所有统计数据来源
 */
import { databaseService } from '../storage/DatabaseService.js'
import { toolCallStats } from './ToolCallStats.js'
import { usageStats } from './UsageStats.js'
import { chatLogger } from '../../core/utils/logger.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const logger = chatLogger

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

class StatsService {
    constructor() {
        this.statsFile = path.join(__dirname, '../../../data/stats.json')
        this.stats = {
            messages: { total: 0, byType: {}, byGroup: {}, byUser: {}, byHour: {} },
            models: { total: 0, byModel: {}, byChannel: {} },
            tokens: { total: { input: 0, output: 0 }, byModel: {}, byUser: {} },
            tools: { total: 0, byTool: {} },
            startTime: Date.now(),
            lastUpdate: Date.now()
        }
        this.loaded = false
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
            this.loaded = true
        } catch (err) {
            console.error('[StatsService] 加载统计数据失败:', err.message)
        }
    }

    /**
     * 保存统计数据
     */
    save() {
        try {
            const dir = path.dirname(this.statsFile)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            this.stats.lastUpdate = Date.now()
            fs.writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2))
        } catch (err) {
            console.error('[StatsService] 保存统计数据失败:', err.message)
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

        // 定期保存（每100条消息保存一次）
        if (this.stats.messages.total % 100 === 0) {
            this.save()
        }
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
    _updateModelStats({ model, channelId, userId, inputTokens = 0, outputTokens = 0, success = true }) {
        this.init()

        this.stats.models.total++

        // 按模型统计
        if (!this.stats.models.byModel[model]) {
            this.stats.models.byModel[model] = { calls: 0, success: 0, failed: 0, inputTokens: 0, outputTokens: 0 }
        }
        const modelStats = this.stats.models.byModel[model]
        modelStats.calls++
        if (success) modelStats.success++
        else modelStats.failed++
        modelStats.inputTokens += inputTokens
        modelStats.outputTokens += outputTokens

        // 按渠道统计
        if (channelId) {
            if (!this.stats.models.byChannel[channelId]) {
                this.stats.models.byChannel[channelId] = { calls: 0, inputTokens: 0, outputTokens: 0 }
            }
            this.stats.models.byChannel[channelId].calls++
            this.stats.models.byChannel[channelId].inputTokens += inputTokens
            this.stats.models.byChannel[channelId].outputTokens += outputTokens
        }

        // 总tokens
        this.stats.tokens.total.input += inputTokens
        this.stats.tokens.total.output += outputTokens

        // 按用户tokens
        if (userId) {
            if (!this.stats.tokens.byUser[userId]) {
                this.stats.tokens.byUser[userId] = { input: 0, output: 0 }
            }
            this.stats.tokens.byUser[userId].input += inputTokens
            this.stats.tokens.byUser[userId].output += outputTokens
        }

        // 按模型tokens
        if (!this.stats.tokens.byModel[model]) {
            this.stats.tokens.byModel[model] = { input: 0, output: 0 }
        }
        this.stats.tokens.byModel[model].input += inputTokens
        this.stats.tokens.byModel[model].output += outputTokens

        this.save()
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
     * @param {string} [options.previousChannelId] - 切换前的渠道ID
     * @param {Array} [options.messages] - 消息数组（用于估算tokens）
     * @param {string} [options.responseText] - 响应文本（用于估算tokens）
     * @param {Object} [options.apiUsage] - API返回的usage对象
     * @returns {Promise<string>} 记录ID
     */
    async recordApiCall(options) {
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
            previousChannelId = null,
            switchChain = null,
            messages = null,
            responseText = null,
            apiUsage = null
        } = options
        let inputTokens = providedInputTokens
        let outputTokens = providedOutputTokens
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
                model,
                channelId,
                userId,
                inputTokens,
                outputTokens,
                success
            })
        } catch (err) {
            logger.warn('[StatsService] 更新内存统计失败:', err.message)
        }

        // 2. 记录到Redis详细统计（异步）
        let recordId = null
        try {
            recordId = await usageStats.record({
                channelId: channelId || 'unknown',
                channelName: channelName || 'Unknown',
                model: model || 'unknown',
                keyIndex,
                keyName,
                strategy,
                inputTokens,
                outputTokens,
                totalTokens,
                duration,
                success,
                error,
                retryCount,
                channelSwitched,
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

        // 保存统计数据
        this.save()
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
                byModel: Object.entries(this.stats.tokens.byModel)
                    .map(([name, stats]) => ({ name, ...stats, total: stats.input + stats.output }))
                    .sort((a, b) => b.total - a.total)
                    .slice(0, 10),
                topUsers: Object.entries(this.stats.tokens.byUser)
                    .map(([userId, stats]) => ({ userId, ...stats, total: stats.input + stats.output }))
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
            tokens: { total: { input: 0, output: 0 }, byModel: {}, byUser: {} },
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
