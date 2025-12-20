/**
 * 统计服务 - 消息、模型、tokens 统计
 */
import { databaseService } from '../storage/DatabaseService.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
     * 记录模型调用
     * @param {Object} options
     */
    recordModelCall({ model, channelId, userId, inputTokens = 0, outputTokens = 0, success = true }) {
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
     * 记录工具调用
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
    reset() {
        this.stats = {
            messages: { total: 0, byType: {}, byGroup: {}, byUser: {}, byHour: {} },
            models: { total: 0, byModel: {}, byChannel: {} },
            tokens: { total: { input: 0, output: 0 }, byModel: {}, byUser: {} },
            tools: { total: 0, byTool: {} },
            startTime: Date.now(),
            lastUpdate: Date.now()
        }
        this.save()
    }

    /**
     * 获取今日统计
     */
    getTodayStats() {
        // 简化版：返回当前内存中的统计
        // 后续可以添加按日期分割的统计
        return this.getOverview()
    }
}

export const statsService = new StatsService()
