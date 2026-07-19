import express from 'express'
import { statsService } from '../stats/StatsService.js'
import { usageStats } from '../stats/UsageStats.js'
import { modelPricingService } from '../stats/ModelPricingService.js'
import { ApiResponse } from './shared.js'
import { chatLogger } from '../../core/utils/logger.js'

const router = express.Router()

// GET /api/stats - 概览统计（兼容旧路径）
// GET /api/stats/overview - 概览统计
const handleOverview = async (req, res) => {
    try {
        const stats = await statsService.getOverview()
        let pricing = null
        try {
            pricing = await modelPricingService.calculateStatsOverviewCost(stats)
        } catch (e) {
            chatLogger.debug('[Stats] 获取价格数据失败:', e.message)
        }
        res.json(ApiResponse.ok({ ...stats, pricing }))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
}
router.get('/', handleOverview)
router.get('/overview', handleOverview)

// GET /api/stats/api-calls
router.get('/api-calls', async (req, res) => {
    try {
        const { page = 1, limit = 20, channelId, success, startTime, endTime } = req.query
        const stats = await statsService.getApiCalls({
            page: parseInt(page),
            limit: parseInt(limit),
            channelId,
            success: success === 'true' ? true : success === 'false' ? false : undefined,
            startTime: startTime ? parseInt(startTime) : undefined,
            endTime: endTime ? parseInt(endTime) : undefined
        })
        res.json(ApiResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/stats/channels
router.get('/channels', async (req, res) => {
    try {
        const stats = await statsService.getChannelStats()
        res.json(ApiResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/stats/models
router.get('/models', async (req, res) => {
    try {
        const stats = await statsService.getModelStats()
        res.json(ApiResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/stats/usage
router.get('/usage', async (req, res) => {
    try {
        const { days = 7 } = req.query
        const stats = await usageStats.getStats(parseInt(days))
        const today = await usageStats.getTodayStats()
        res.json(ApiResponse.ok({ ...stats, today }))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/stats/usage/recent - 获取最近的使用记录
router.get('/usage/recent', async (req, res) => {
    try {
        const { limit = 50, source, status } = req.query
        const filter = {}
        if (source) filter.source = source
        if (status === 'success') filter.success = true
        else if (status === 'failed') filter.success = false
        const records = await usageStats.getRecent(parseInt(limit) || 50, filter)
        res.json(ApiResponse.ok(records))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/stats/usage/clear - 清除使用统计
router.post('/usage/clear', async (req, res) => {
    try {
        await usageStats.clear()
        res.json(ApiResponse.ok(null))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/stats/usage/channel/:id
router.get('/usage/channel/:id', async (req, res) => {
    try {
        const stats = await usageStats.getChannelStats(req.params.id)
        res.json(ApiResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// DELETE /api/stats/clear
// POST /api/stats/reset - 重置统计（兼容前端）
const handleClear = async (req, res) => {
    try {
        await statsService.clear()
        res.json(ApiResponse.ok(null))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
}
router.delete('/clear', handleClear)
router.post('/reset', handleClear)

// GET /api/stats/pricing - 获取模型价格信息
router.get('/pricing', async (req, res) => {
    try {
        const pricing = await modelPricingService.getPricingInfo()
        res.json(ApiResponse.ok(pricing))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/stats/pricing/calculate - 计算指定模型的费用
router.get('/pricing/calculate', async (req, res) => {
    try {
        const { model, inputTokens, outputTokens } = req.query
        if (!model) return res.status(400).json(ApiResponse.fail(null, '缺少 model 参数'))
        await modelPricingService.fetchPricing()
        const cost = modelPricingService.calculateCost(model, parseInt(inputTokens) || 0, parseInt(outputTokens) || 0)
        res.json(ApiResponse.ok(cost))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// POST /api/stats/pricing/refresh - 强制刷新价格缓存
router.post('/pricing/refresh', async (req, res) => {
    try {
        modelPricingService.lastFetch = 0
        await modelPricingService.fetchPricing()
        res.json(ApiResponse.ok({ lastUpdate: modelPricingService.lastFetch }))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

export default router
