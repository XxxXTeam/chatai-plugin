/**
 * 日志路由模块
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'

const router = express.Router()
const placeholdersRouter = express.Router()

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

/*
 * 占位符相关路由
 * 注意：本路由模块同时挂载在 /api/logs 和 /api/placeholders
 * 当挂载在 /api/placeholders 时，GET / 应返回占位符列表而非日志
 * 因此 /placeholders 和 /preview 路径是为 /api/placeholders 挂载点准备的兼容路由
 */

/* 占位符处理函数（logs 和 placeholders 路由共用） */
async function handleGetPlaceholders(req, res) {
    try {
        const { requestTemplateService } = await import('../tools/RequestTemplateService.js')
        const placeholders = requestTemplateService.getAvailablePlaceholders()
        res.json(ChaiteResponse.ok(placeholders))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
}
async function handlePreviewPlaceholders(req, res) {
    try {
        const { requestTemplateService } = await import('../tools/RequestTemplateService.js')
        const { template, context } = req.body
        const result = requestTemplateService.previewTemplate(template, context || {})
        res.json(ChaiteResponse.ok({ result }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
}

// /api/logs/placeholders 路径
router.get('/placeholders', handleGetPlaceholders)
router.post('/placeholders/preview', handlePreviewPlaceholders)

// 独立占位符路由（挂载在 /api/placeholders）
placeholdersRouter.get('/', handleGetPlaceholders)
placeholdersRouter.post('/preview', handlePreviewPlaceholders)

export default router
export { placeholdersRouter }
