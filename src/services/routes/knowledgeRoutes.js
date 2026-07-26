/**
 * 知识库路由模块
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'

const router = express.Router()

// GET / - 获取所有知识库文档
router.get('/', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        const docs = knowledgeService.getAll()

        // 列表模式只返回摘要
        const summaryDocs = docs.map(doc => ({
            ...doc,
            content: doc.content?.substring(0, 500) || '',
            contentLength: doc.content?.length || 0,
            truncated: (doc.content?.length || 0) > 500
        }))

        res.json(ChaiteResponse.ok(summaryDocs))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /search - 搜索知识库（放在/:id之前）
router.get('/search', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        const { query, presetId, limit = 10 } = req.query
        // query 缺失时 KnowledgeService.search 内部的 query.toLowerCase() 会抛错，
        // 校验方式与 memoryRoutes 的 POST /search 保持一致
        if (!query || typeof query !== 'string' || !query.trim()) {
            return res.status(400).json(ChaiteResponse.fail(null, 'query is required'))
        }
        // parseInt('abc') 为 NaN，绑定到 better-sqlite3 会抛 datatype mismatch；
        // 空串同样要走默认值，否则 ?limit= 会被钳成 1
        const parsedLimit = limit === '' ? NaN : Number(limit)
        const safeLimit = Number.isFinite(parsedLimit) ? Math.min(100, Math.max(1, Math.trunc(parsedLimit))) : 10
        const results = await knowledgeService.search(query, { presetId, limit: safeLimit })
        res.json(ChaiteResponse.ok(results))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /:id - 获取单个知识库
router.get('/:id', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        const doc = knowledgeService.get(req.params.id)
        if (!doc) return res.status(404).json(ChaiteResponse.fail(null, 'Document not found'))
        res.json(ChaiteResponse.ok(doc))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST / - 创建知识库
router.post('/', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        const doc = await knowledgeService.create(req.body)
        res.status(201).json(ChaiteResponse.ok(doc))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /import - 导入知识库
router.post('/import', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        const { data, format = 'raw', name } = req.body
        const doc = await knowledgeService.importKnowledge(data, { format, name })
        res.status(201).json(ChaiteResponse.ok(doc))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /:id - 更新知识库
router.put('/:id', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        const doc = await knowledgeService.update(req.params.id, req.body)
        res.json(ChaiteResponse.ok(doc))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /:id - 删除知识库
router.delete('/:id', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        const deleted = await knowledgeService.delete(req.params.id)
        if (!deleted) return res.status(404).json(ChaiteResponse.fail(null, 'Document not found'))
        res.json(ChaiteResponse.ok(null))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /:id/link/:presetId - 关联知识库到预设
router.post('/:id/link/:presetId', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        await knowledgeService.linkToPreset(req.params.id, req.params.presetId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /:id/link/:presetId - 取消关联
router.delete('/:id/link/:presetId', async (req, res) => {
    try {
        const { knowledgeService } = await import('../storage/KnowledgeService.js')
        await knowledgeService.init()
        await knowledgeService.unlinkFromPreset(req.params.id, req.params.presetId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
