/**
 * 系统路由模块 - 健康检查、指标、系统信息
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'

const router = express.Router()

// GET /health - 健康检查（公开）
router.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: Date.now(),
        uptime: process.uptime(),
        memoryUsage: {
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
        }
    }
    res.json(health)
})

// GET /metrics - 性能指标
router.get('/metrics', async (req, res) => {
    try {
        const metrics = {
            timestamp: Date.now(),
            uptime: process.uptime(),
            process: {
                pid: process.pid,
                cpu: process.cpuUsage(),
                memory: process.memoryUsage()
            },
            system: {
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version
            }
        }
        res.json(ChaiteResponse.ok(metrics))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /system/info - 系统信息
router.get('/system/info', async (req, res) => {
    try {
        const { presetManager } = await import('../preset/PresetManager.js')
        await presetManager.init()
        res.json(ChaiteResponse.ok({
            version: '1.0.0',
            systemInfo: {
                nodejs: process.version,
                platform: process.platform,
                arch: process.arch,
                memory: {
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
                }
            },
            stats: {
                totalConversations: 0,
                activeUsers: 0,
                apiCalls: 0,
                presets: presetManager.getAll().length
            }
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats - 基础统计
router.get('/stats', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const stats = statsService.getOverview()
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/full - 完整统计
router.get('/stats/full', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const stats = statsService.getStats()
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /stats/reset - 重置统计
router.post('/stats/reset', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        statsService.reset()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/usage - API使用统计
router.get('/stats/usage', async (req, res) => {
    try {
        const { usageStats } = await import('../stats/UsageStats.js')
        const today = await usageStats.getTodayStats()
        const recent = await usageStats.getRecent(50)
        const modelRanking = await usageStats.getModelRanking(10)
        const channelRanking = await usageStats.getChannelRanking(10)
        res.json(ChaiteResponse.ok({ today, recent, modelRanking, channelRanking }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/usage/recent - 最近使用记录
router.get('/stats/usage/recent', async (req, res) => {
    try {
        const { usageStats } = await import('../stats/UsageStats.js')
        const { limit = 100, channelId, model, success, status, source } = req.query
        const filter = {}
        if (channelId) filter.channelId = channelId
        if (model) filter.model = model
        if (success !== undefined) filter.success = success === 'true'
        else if (status !== undefined) filter.success = status === 'success'
        if (source) filter.source = source
        const records = await usageStats.getRecent(parseInt(limit), filter)
        res.json(ChaiteResponse.ok(records))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/usage/channel/:id - 渠道使用统计
router.get('/stats/usage/channel/:id', async (req, res) => {
    try {
        const { usageStats } = await import('../stats/UsageStats.js')
        const stats = await usageStats.getChannelStats(req.params.id)
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /stats/usage/clear - 清除使用统计
router.post('/stats/usage/clear', async (req, res) => {
    try {
        const { usageStats } = await import('../stats/UsageStats.js')
        await usageStats.clear()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/tool-calls - 工具调用统计
router.get('/stats/tool-calls', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const summary = await statsService.getToolCallSummary()
        res.json(ChaiteResponse.ok(summary))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/tool-calls/records - 工具调用记录
router.get('/stats/tool-calls/records', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const { limit = 100, toolName, success, userId, groupId, keyword, startTime, endTime } = req.query
        const filter = {}
        if (toolName) filter.toolName = toolName
        if (success !== undefined) filter.success = success === 'true'
        if (userId) filter.userId = userId
        if (groupId) filter.groupId = groupId
        if (keyword) filter.keyword = keyword
        if (startTime) filter.startTime = parseInt(startTime)
        if (endTime) filter.endTime = parseInt(endTime)
        const records = await statsService.getToolCallRecords(filter, parseInt(limit))
        res.json(ChaiteResponse.ok(records))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/tool-calls/record/:id - 单条记录详情
router.get('/stats/tool-calls/record/:id', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const record = await statsService.getToolCallRecord(req.params.id)
        if (!record) return res.status(404).json(ChaiteResponse.fail(null, '记录不存在'))
        res.json(ChaiteResponse.ok(record))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/tool-calls/errors - 工具调用错误
router.get('/stats/tool-calls/errors', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const { limit = 50 } = req.query
        const errors = await statsService.getToolErrors(parseInt(limit))
        res.json(ChaiteResponse.ok(errors))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/unified - 统一完整统计
router.get('/stats/unified', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const stats = await statsService.getUnifiedStats()
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /stats/tool-calls/clear - 清除工具调用统计
router.post('/stats/tool-calls/clear', async (req, res) => {
    try {
        const { toolCallStats } = await import('../stats/ToolCallStats.js')
        await toolCallStats.clear()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
