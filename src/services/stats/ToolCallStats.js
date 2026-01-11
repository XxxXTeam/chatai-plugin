/**
 * 工具调用统计服务
 * 记录完整的请求信息与错误返回，固定保存1000条
 */

import { redisClient } from '../../core/cache/RedisClient.js'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

const TOOL_STATS_KEY = 'chaite:tool_stats'
const TOOL_STATS_LIST_KEY = 'chaite:tool_stats_list'
const MAX_RECORDS = 1000 // 固定保存1000条

/**
 * 工具调用记录结构
 * @typedef {Object} ToolCallRecord
 * @property {string} id - 唯一ID
 * @property {number} timestamp - 时间戳
 * @property {string} toolName - 工具名称
 * @property {Object} request - 完整请求参数
 * @property {Object} response - 完整响应（包含错误）
 * @property {boolean} success - 是否成功
 * @property {string} [error] - 错误信息
 * @property {string} [errorStack] - 错误堆栈
 * @property {number} duration - 执行耗时(ms)
 * @property {string} [userId] - 用户ID
 * @property {string} [groupId] - 群组ID
 * @property {string} source - 调用来源
 */

class ToolCallStats {
    constructor() {
        this.initialized = false
        // 内存缓存记录
        this.records = []
        this.maxRecords = MAX_RECORDS
        // 汇总统计
        this.summary = {
            total: 0,
            success: 0,
            failed: 0,
            byTool: {},
            byHour: {},
            recentErrors: []
        }
    }

    async init() {
        if (this.initialized) return

        try {
            // 从 Redis 加载历史记录
            const rawRecords = await redisClient.lrange(TOOL_STATS_LIST_KEY, 0, MAX_RECORDS - 1)
            this.records = rawRecords
                .map(r => {
                    try {
                        return JSON.parse(r)
                    } catch {
                        return null
                    }
                })
                .filter(Boolean)

            // 从 Redis 加载汇总统计
            const summaryData = await redisClient.get(TOOL_STATS_KEY)
            if (summaryData) {
                try {
                    this.summary = { ...this.summary, ...JSON.parse(summaryData) }
                } catch {}
            }

            logger.info(`[ToolCallStats] 初始化完成，已加载 ${this.records.length} 条记录`)
        } catch (err) {
            logger.debug('[ToolCallStats] Redis加载失败，使用内存模式:', err.message)
        }

        this.initialized = true
    }

    /**
     * 记录一次工具调用
     * @param {Object} options
     * @returns {Promise<string>} 记录ID
     */
    async record(options) {
        await this.init()

        const {
            toolName,
            request,
            response,
            success = true,
            error = null,
            errorStack = null,
            duration = 0,
            userId = null,
            groupId = null,
            source = 'mcp'
        } = options

        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

        const record = {
            id,
            timestamp: Date.now(),
            toolName,
            request: this.sanitizeRequest(request),
            response: this.sanitizeResponse(response),
            success,
            error,
            errorStack: errorStack?.substring(0, 500), // 限制堆栈长度
            duration,
            userId,
            groupId,
            source
        }

        // 添加到内存
        this.records.unshift(record)
        if (this.records.length > this.maxRecords) {
            this.records.pop()
        }

        // 更新汇总统计
        this.updateSummary(record)

        // 保存到 Redis
        try {
            await redisClient.lpush(TOOL_STATS_LIST_KEY, JSON.stringify(record))
            await redisClient.ltrim(TOOL_STATS_LIST_KEY, 0, MAX_RECORDS - 1)
            await redisClient.set(TOOL_STATS_KEY, JSON.stringify(this.summary))
        } catch (err) {
            logger.debug('[ToolCallStats] Redis保存失败:', err.message)
        }

        // 日志
        const icon = success ? '✓' : '✗'
        const errorInfo = error ? ` | ${error.substring(0, 50)}` : ''
        logger.debug(`[ToolCallStats] ${icon} ${toolName} | ${duration}ms${errorInfo}`)

        return id
    }

    /**
     * 清理请求数据（移除敏感信息，限制大小）
     */
    sanitizeRequest(request) {
        if (!request) return null

        try {
            const sanitized = { ...request }

            // 限制大文本字段
            for (const [key, value] of Object.entries(sanitized)) {
                if (typeof value === 'string' && value.length > 1000) {
                    sanitized[key] = value.substring(0, 1000) + '...[truncated]'
                }
                // 移除可能的敏感字段
                if (['password', 'token', 'secret', 'key', 'apiKey'].includes(key.toLowerCase())) {
                    sanitized[key] = '[REDACTED]'
                }
            }

            return sanitized
        } catch {
            return { _raw: String(request).substring(0, 500) }
        }
    }

    /**
     * 清理响应数据
     */
    sanitizeResponse(response) {
        if (!response) return null

        try {
            const sanitized = { ...response }

            // 限制大文本字段
            for (const [key, value] of Object.entries(sanitized)) {
                if (typeof value === 'string' && value.length > 2000) {
                    sanitized[key] = value.substring(0, 2000) + '...[truncated]'
                }
                if (Array.isArray(value) && value.length > 50) {
                    sanitized[key] = value.slice(0, 50)
                    sanitized[`${key}_truncated`] = true
                    sanitized[`${key}_total`] = value.length
                }
            }

            return sanitized
        } catch {
            return { _raw: String(response).substring(0, 1000) }
        }
    }

    /**
     * 更新汇总统计
     */
    updateSummary(record) {
        this.summary.total++
        if (record.success) {
            this.summary.success++
        } else {
            this.summary.failed++
            // 记录最近错误
            this.summary.recentErrors.unshift({
                id: record.id,
                timestamp: record.timestamp,
                toolName: record.toolName,
                error: record.error
            })
            if (this.summary.recentErrors.length > 50) {
                this.summary.recentErrors.pop()
            }
        }

        // 按工具统计
        if (!this.summary.byTool[record.toolName]) {
            this.summary.byTool[record.toolName] = { calls: 0, success: 0, failed: 0, totalDuration: 0 }
        }
        const toolStats = this.summary.byTool[record.toolName]
        toolStats.calls++
        toolStats.totalDuration += record.duration
        if (record.success) toolStats.success++
        else toolStats.failed++

        // 按小时统计
        const hour = new Date().getHours()
        this.summary.byHour[hour] = (this.summary.byHour[hour] || 0) + 1
    }

    /**
     * 获取记录列表
     * @param {Object} filter - 过滤条件
     * @param {number} limit - 返回数量
     */
    async getRecords(filter = {}, limit = 100) {
        await this.init()

        let results = [...this.records]

        // 应用过滤器
        if (filter.toolName) {
            results = results.filter(r => r.toolName === filter.toolName)
        }
        if (filter.success !== undefined) {
            results = results.filter(r => r.success === filter.success)
        }
        if (filter.userId) {
            results = results.filter(r => r.userId === filter.userId)
        }
        if (filter.groupId) {
            results = results.filter(r => r.groupId === filter.groupId)
        }
        if (filter.startTime) {
            results = results.filter(r => r.timestamp >= filter.startTime)
        }
        if (filter.endTime) {
            results = results.filter(r => r.timestamp <= filter.endTime)
        }
        if (filter.keyword) {
            const kw = filter.keyword.toLowerCase()
            results = results.filter(
                r =>
                    r.toolName.toLowerCase().includes(kw) ||
                    r.error?.toLowerCase().includes(kw) ||
                    JSON.stringify(r.request).toLowerCase().includes(kw)
            )
        }

        return results.slice(0, limit)
    }

    /**
     * 获取单条记录详情
     */
    async getRecord(id) {
        await this.init()
        return this.records.find(r => r.id === id) || null
    }

    /**
     * 获取汇总统计
     */
    async getSummary() {
        await this.init()

        const toolRanking = Object.entries(this.summary.byTool)
            .map(([name, stats]) => ({
                name,
                ...stats,
                avgDuration: stats.calls > 0 ? Math.round(stats.totalDuration / stats.calls) : 0,
                successRate: stats.calls > 0 ? Math.round((stats.success / stats.calls) * 100) : 0
            }))
            .sort((a, b) => b.calls - a.calls)

        return {
            total: this.summary.total,
            success: this.summary.success,
            failed: this.summary.failed,
            successRate: this.summary.total > 0 ? Math.round((this.summary.success / this.summary.total) * 100) : 0,
            toolRanking,
            hourlyDistribution: this.summary.byHour,
            recentErrors: this.summary.recentErrors.slice(0, 20),
            recordCount: this.records.length,
            maxRecords: this.maxRecords
        }
    }

    /**
     * 获取工具统计详情
     */
    async getToolStats(toolName) {
        await this.init()

        const stats = this.summary.byTool[toolName]
        if (!stats) return null

        const recentCalls = this.records.filter(r => r.toolName === toolName).slice(0, 50)

        return {
            name: toolName,
            ...stats,
            avgDuration: stats.calls > 0 ? Math.round(stats.totalDuration / stats.calls) : 0,
            successRate: stats.calls > 0 ? Math.round((stats.success / stats.calls) * 100) : 0,
            recentCalls
        }
    }

    /**
     * 获取错误记录
     */
    async getErrors(limit = 50) {
        await this.init()
        return this.records.filter(r => !r.success).slice(0, limit)
    }

    /**
     * 清除所有统计数据
     */
    async clear() {
        this.records = []
        this.summary = {
            total: 0,
            success: 0,
            failed: 0,
            byTool: {},
            byHour: {},
            recentErrors: []
        }

        try {
            await redisClient.del(TOOL_STATS_KEY)
            await redisClient.del(TOOL_STATS_LIST_KEY)
        } catch (err) {
            logger.debug('[ToolCallStats] 清除Redis数据失败:', err.message)
        }

        logger.info('[ToolCallStats] 统计数据已清除')
    }

    /**
     * 导出统计数据
     */
    async export() {
        await this.init()
        return {
            records: this.records,
            summary: this.summary,
            exportTime: Date.now()
        }
    }
}

export const toolCallStats = new ToolCallStats()
export default toolCallStats
