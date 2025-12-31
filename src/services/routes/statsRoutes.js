import express from 'express'
import { statsService } from '../stats/StatsService.js'
import { usageStats } from '../stats/UsageStats.js'
import { chatLogger } from '../../core/utils/logger.js'

const router = express.Router()

// Response helper
class ApiResponse {
    static ok(data) {
        return { code: 0, data, message: 'ok' }
    }
    static fail(data, msg) {
        return { code: -1, data, message: msg }
    }
}

// GET /api/stats/overview
router.get('/overview', async (req, res) => {
    try {
        const stats = await statsService.getOverview()
        res.json(ApiResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

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
        res.json(ApiResponse.ok(stats))
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
router.delete('/clear', async (req, res) => {
    try {
        await statsService.clear()
        res.json(ApiResponse.ok(null))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

export default router
