/**
 * API使用统计模块
 * 记录每次API请求的详细信息
 */

import { redisClient } from '../../core/cache/RedisClient.js'
import { encode } from 'gpt-tokenizer'

const STATS_KEY = 'chaite:usage_stats'
const STATS_LIST_KEY = 'chaite:usage_list'
const MAX_RECORDS = 10000  // 最多保留记录数

/**
 * 使用记录结构
 * @typedef {Object} UsageRecord
 * @property {string} id - 唯一ID
 * @property {number} timestamp - 时间戳
 * @property {string} channelId - 渠道ID
 * @property {string} channelName - 渠道名称
 * @property {string} model - 使用的模型
 * @property {number} keyIndex - 使用的Key索引 (-1表示单key)
 * @property {string} keyName - Key名称
 * @property {string} strategy - 轮询策略
 * @property {number} inputTokens - 输入token数
 * @property {number} outputTokens - 输出token数
 * @property {number} totalTokens - 总token数
 * @property {number} duration - 耗时(ms)
 * @property {boolean} success - 是否成功
 * @property {string} [error] - 错误信息
 * @property {boolean} channelSwitched - 是否切换了渠道
 * @property {string} [previousChannelId] - 切换前的渠道ID
 * @property {string[]} [switchChain] - 渠道切换链 (1 > 2 > 3)
 * @property {string} source - 请求来源 (chat/test/api)
 * @property {string} [userId] - 用户ID
 * @property {string} [groupId] - 群组ID
 * @property {boolean} stream - 是否流式请求
 */

class UsageStats {
    constructor() {
        this.initialized = false
        // 内存缓存最近的统计
        this.recentStats = []
        this.maxMemoryRecords = 100
    }

    async init() {
        if (this.initialized) return
        this.initialized = true
        logger.info('[UsageStats] 初始化完成')
    }

    /**
     * @param {string} text - 文本内容
     * @returns {number} token数
     */
    estimateTokens(text) {
        if (!text) return 0
        try {
            const tokens = encode(text)
            return tokens.length
        } catch (e) {
            // 回退到估算方式
            const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
            const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
            const otherChars = text.length - chineseChars - (text.match(/[a-zA-Z]+/g) || []).join('').length
            return Math.ceil(chineseChars / 1.5 + englishWords * 1.3 + otherChars / 4)
        }
    }

    /**
     * 估算消息数组的tokens
     * @param {Array} messages - 消息数组
     * @returns {number}
     */
    estimateMessagesTokens(messages) {
        if (!messages || !Array.isArray(messages)) return 0
        let total = 0
        for (const msg of messages) {
            if (typeof msg === 'string') {
                total += this.estimateTokens(msg)
            } else if (msg.content) {
                if (typeof msg.content === 'string') {
                    total += this.estimateTokens(msg.content)
                } else if (Array.isArray(msg.content)) {
                    for (const c of msg.content) {
                        if (c.type === 'text' && c.text) {
                            total += this.estimateTokens(c.text)
                        }
                    }
                }
            } 
            total += 4
        }
        return total
    }

    /**
     * 记录一次API使用
     * @param {Partial<UsageRecord>} record 
     * @returns {Promise<string>} 记录ID
     */
    async record(record) {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const fullRecord = {
            id,
            timestamp: Date.now(),
            channelId: record.channelId || 'unknown',
            channelName: record.channelName || 'Unknown',
            model: record.model || 'unknown',
            keyIndex: record.keyIndex ?? -1,
            keyName: record.keyName || '',
            strategy: record.strategy || '',
            inputTokens: record.inputTokens || 0,
            outputTokens: record.outputTokens || 0,
            totalTokens: record.totalTokens || (record.inputTokens || 0) + (record.outputTokens || 0),
            duration: record.duration || 0,
            success: record.success !== false,
            error: record.error || null,
            channelSwitched: record.channelSwitched || false,
            previousChannelId: record.previousChannelId || null,
            switchChain: record.switchChain || null,
            source: record.source || 'chat',
            userId: record.userId || null,
            groupId: record.groupId || null,
            stream: record.stream || false,
            isEstimated: record.isEstimated || false,  // 标记是否为估算值
        }

        // 记录日志
        const keyInfo = fullRecord.keyIndex >= 0 ? ` Key#${fullRecord.keyIndex + 1}(${fullRecord.keyName})` : ''
        const tokenInfo = fullRecord.totalTokens > 0 ? ` tokens:${fullRecord.inputTokens}/${fullRecord.outputTokens}` : ''
        const statusIcon = fullRecord.success ? '✓' : '✗'
        logger.info(`[UsageStats] ${statusIcon} ${fullRecord.channelName}${keyInfo} | ${fullRecord.model} | ${fullRecord.duration}ms${tokenInfo}`)

        // 保存到内存
        this.recentStats.unshift(fullRecord)
        if (this.recentStats.length > this.maxMemoryRecords) {
            this.recentStats.pop()
        }

        // 保存到Redis
        try {
            await redisClient.lpush(STATS_LIST_KEY, JSON.stringify(fullRecord))
            await redisClient.ltrim(STATS_LIST_KEY, 0, MAX_RECORDS - 1)

            // 更新汇总统计
            await this.updateAggregateStats(fullRecord)
            
            // 更新用户统计
            await this.updateUserStats(fullRecord)
        } catch (error) {
            logger.debug('[UsageStats] Redis保存失败，仅使用内存缓存:', error.message)
        }

        return id
    }

    /**
     * 更新汇总统计
     */
    async updateAggregateStats(record) {
        const today = new Date().toISOString().split('T')[0]
        const hourKey = new Date().toISOString().split(':')[0]
        
        const statsKey = `${STATS_KEY}:${today}`
        const hourlyKey = `${STATS_KEY}:hourly:${hourKey}`
        const channelKey = `${STATS_KEY}:channel:${record.channelId}`

        const updates = [
            ['totalCalls', 1],
            ['successCalls', record.success ? 1 : 0],
            ['failedCalls', record.success ? 0 : 1],
            ['totalInputTokens', record.inputTokens],
            ['totalOutputTokens', record.outputTokens],
            ['totalDuration', record.duration],
        ]

        for (const [field, value] of updates) {
            await redisClient.hincrby(statsKey, field, value)
            await redisClient.hincrby(hourlyKey, field, value)
            await redisClient.hincrby(channelKey, field, value)
        }

        // 设置过期时间
        await redisClient.expire(statsKey, 86400 * 30)  // 30天
        await redisClient.expire(hourlyKey, 86400 * 7)   // 7天
        await redisClient.expire(channelKey, 86400 * 90) // 90天
    }

    /**
     * 获取最近的使用记录
     * @param {number} limit 
     * @param {Object} filter 
     */
    async getRecent(limit = 50, filter = {}) {
        let records = []

        try {
            const rawRecords = await redisClient.lrange(STATS_LIST_KEY, 0, limit * 2)
            records = rawRecords.map(r => {
                try { return JSON.parse(r) } catch { return null }
            }).filter(Boolean)
        } catch {
            records = [...this.recentStats]
        }

        // 应用过滤器
        if (filter.channelId) {
            records = records.filter(r => r.channelId === filter.channelId)
        }
        if (filter.model) {
            records = records.filter(r => r.model === filter.model)
        }
        if (filter.success !== undefined) {
            records = records.filter(r => r.success === filter.success)
        }
        if (filter.source) {
            records = records.filter(r => r.source === filter.source)
        }
        if (filter.startTime) {
            records = records.filter(r => r.timestamp >= filter.startTime)
        }
        if (filter.endTime) {
            records = records.filter(r => r.timestamp <= filter.endTime)
        }

        return records.slice(0, limit)
    }

    /**
     * 获取今日统计
     */
    async getTodayStats() {
        const today = new Date().toISOString().split('T')[0]
        const statsKey = `${STATS_KEY}:${today}`

        try {
            const stats = await redisClient.hgetall(statsKey)
            return {
                date: today,
                totalCalls: parseInt(stats?.totalCalls || '0'),
                successCalls: parseInt(stats?.successCalls || '0'),
                failedCalls: parseInt(stats?.failedCalls || '0'),
                totalInputTokens: parseInt(stats?.totalInputTokens || '0'),
                totalOutputTokens: parseInt(stats?.totalOutputTokens || '0'),
                totalDuration: parseInt(stats?.totalDuration || '0'),
                avgDuration: stats?.totalCalls > 0 
                    ? Math.round(parseInt(stats?.totalDuration || '0') / parseInt(stats?.totalCalls || '1'))
                    : 0,
                successRate: stats?.totalCalls > 0
                    ? Math.round((parseInt(stats?.successCalls || '0') / parseInt(stats?.totalCalls || '1')) * 100)
                    : 0,
            }
        } catch {
            // 从内存计算
            const today = new Date().setHours(0, 0, 0, 0)
            const todayRecords = this.recentStats.filter(r => r.timestamp >= today)
            return this.calculateStats(todayRecords, new Date().toISOString().split('T')[0])
        }
    }

    /**
     * 获取渠道统计
     */
    async getChannelStats(channelId) {
        const channelKey = `${STATS_KEY}:channel:${channelId}`

        try {
            const stats = await redisClient.hgetall(channelKey)
            return {
                channelId,
                totalCalls: parseInt(stats?.totalCalls || '0'),
                successCalls: parseInt(stats?.successCalls || '0'),
                failedCalls: parseInt(stats?.failedCalls || '0'),
                totalInputTokens: parseInt(stats?.totalInputTokens || '0'),
                totalOutputTokens: parseInt(stats?.totalOutputTokens || '0'),
                totalDuration: parseInt(stats?.totalDuration || '0'),
                avgDuration: stats?.totalCalls > 0 
                    ? Math.round(parseInt(stats?.totalDuration || '0') / parseInt(stats?.totalCalls || '1'))
                    : 0,
            }
        } catch {
            const channelRecords = this.recentStats.filter(r => r.channelId === channelId)
            return this.calculateStats(channelRecords, channelId)
        }
    }

    /**
     * 从记录计算统计
     */
    calculateStats(records, label = '') {
        const totalCalls = records.length
        const successCalls = records.filter(r => r.success).length
        const totalInputTokens = records.reduce((sum, r) => sum + (r.inputTokens || 0), 0)
        const totalOutputTokens = records.reduce((sum, r) => sum + (r.outputTokens || 0), 0)
        const totalDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0)

        return {
            label,
            totalCalls,
            successCalls,
            failedCalls: totalCalls - successCalls,
            totalInputTokens,
            totalOutputTokens,
            totalDuration,
            avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
            successRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0,
        }
    }

    /**
     * 获取模型使用排行
     */
    async getModelRanking(limit = 10) {
        const records = await this.getRecent(1000)
        const modelCounts = {}

        for (const record of records) {
            const model = record.model
            if (!modelCounts[model]) {
                modelCounts[model] = { model, calls: 0, tokens: 0, duration: 0 }
            }
            modelCounts[model].calls++
            modelCounts[model].tokens += record.totalTokens || 0
            modelCounts[model].duration += record.duration || 0
        }

        return Object.values(modelCounts)
            .sort((a, b) => b.calls - a.calls)
            .slice(0, limit)
    }

    /**
     * 获取渠道使用排行
     */
    async getChannelRanking(limit = 10) {
        const records = await this.getRecent(1000)
        const channelCounts = {}

        for (const record of records) {
            const id = record.channelId
            if (!channelCounts[id]) {
                channelCounts[id] = { 
                    channelId: id, 
                    channelName: record.channelName,
                    calls: 0, 
                    successCalls: 0,
                    tokens: 0, 
                    duration: 0 
                }
            }
            channelCounts[id].calls++
            if (record.success) channelCounts[id].successCalls++
            channelCounts[id].tokens += record.totalTokens || 0
            channelCounts[id].duration += record.duration || 0
        }

        return Object.values(channelCounts)
            .sort((a, b) => b.calls - a.calls)
            .slice(0, limit)
    }

    /**
     * 获取用户统计（真实统计，非估算）
     * @param {string} userId - 用户ID
     * @returns {Promise<Object>} 用户统计数据
     */
    async getUserStats(userId) {
        if (!userId) return null
        
        const userKey = `${STATS_KEY}:user:${userId}`
        
        try {
            // 先尝试从 Redis 获取
            const stats = await redisClient.hgetall(userKey)
            if (stats && Object.keys(stats).length > 0) {
                return {
                    userId,
                    totalCalls: parseInt(stats.totalCalls || '0'),
                    successCalls: parseInt(stats.successCalls || '0'),
                    totalInputTokens: parseInt(stats.totalInputTokens || '0'),
                    totalOutputTokens: parseInt(stats.totalOutputTokens || '0'),
                    totalDuration: parseInt(stats.totalDuration || '0'),
                    lastUpdated: parseInt(stats.lastUpdated || '0'),
                }
            }
        } catch {}
        
        // 从内存记录计算
        const userRecords = this.recentStats.filter(r => r.userId === userId)
        if (userRecords.length === 0) return null
        
        return {
            userId,
            totalCalls: userRecords.length,
            successCalls: userRecords.filter(r => r.success).length,
            totalInputTokens: userRecords.reduce((sum, r) => sum + (r.inputTokens || 0), 0),
            totalOutputTokens: userRecords.reduce((sum, r) => sum + (r.outputTokens || 0), 0),
            totalDuration: userRecords.reduce((sum, r) => sum + (r.duration || 0), 0),
            lastUpdated: userRecords[0]?.timestamp || 0,
        }
    }

    /**
     * 更新用户统计（在 record 时调用）
     * @param {Object} record - 使用记录
     */
    async updateUserStats(record) {
        if (!record.userId) return
        
        const userKey = `${STATS_KEY}:user:${record.userId}`
        
        try {
            await redisClient.hincrby(userKey, 'totalCalls', 1)
            await redisClient.hincrby(userKey, 'successCalls', record.success ? 1 : 0)
            await redisClient.hincrby(userKey, 'totalInputTokens', record.inputTokens || 0)
            await redisClient.hincrby(userKey, 'totalOutputTokens', record.outputTokens || 0)
            await redisClient.hincrby(userKey, 'totalDuration', record.duration || 0)
            await redisClient.hset(userKey, 'lastUpdated', Date.now())
            await redisClient.expire(userKey, 86400 * 90) // 90天
        } catch (error) {
            logger.debug('[UsageStats] 更新用户统计失败:', error.message)
        }
    }

    /**
     * 清除统计数据
     */
    async clear() {
        this.recentStats = []
        try {
            const keys = await redisClient.keys(`${STATS_KEY}*`)
            if (keys.length > 0) {
                await redisClient.del(...keys)
            }
            await redisClient.del(STATS_LIST_KEY)
        } catch (error) {
            logger.debug('[UsageStats] 清除Redis数据失败:', error.message)
        }
        logger.info('[UsageStats] 统计数据已清除')
    }
}

export const usageStats = new UsageStats()
export default usageStats
