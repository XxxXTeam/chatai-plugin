/**
 * 日志路由模块
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'

const router = express.Router()

// GET / - 获取日志文件列表
router.get('/', async (req, res) => {
    try {
        const { logService } = await import('../stats/LogService.js')
        const files = logService.getLogFiles()
        res.json(ChaiteResponse.ok(files))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /recent - 获取最近的错误日志
router.get('/recent', async (req, res) => {
    try {
        const { logService } = await import('../stats/LogService.js')
        const lines = parseInt(req.query.lines) || 100
        const errors = logService.getRecentErrors(lines)
        res.json(ChaiteResponse.ok(errors))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /placeholders - 获取可用占位符列表
router.get('/placeholders', async (req, res) => {
    try {
        const { requestTemplateService } = await import('../tools/RequestTemplateService.js')
        const placeholders = requestTemplateService.getAvailablePlaceholders()
        res.json(ChaiteResponse.ok(placeholders))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /placeholders/preview - 预览占位符替换
router.post('/placeholders/preview', async (req, res) => {
    try {
        const { requestTemplateService } = await import('../tools/RequestTemplateService.js')
        const { template, context } = req.body
        const result = requestTemplateService.previewTemplate(template, context || {})
        res.json(ChaiteResponse.ok({ result }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
