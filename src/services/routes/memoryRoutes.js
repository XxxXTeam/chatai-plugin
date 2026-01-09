/**
 * 记忆路由模块 - 用户记忆管理
 */
import express from 'express'
import { ChaiteResponse, getRawDatabase } from './shared.js'

const router = express.Router()

// GET /users - 获取所有有记忆的用户
router.get('/users', async (req, res) => {
    try {
        const { memoryManager } = await import('../storage/MemoryManager.js')
        const users = await memoryManager.listUsers()
        res.json(ChaiteResponse.ok(users))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /clear-all - 清空所有用户记忆（必须在/:userId之前注册）
router.delete('/clear-all', async (req, res) => {
    try {
        const db = getRawDatabase()
        const allMemories = db.prepare('SELECT DISTINCT user_id FROM memories').all()
        let clearedCount = 0
        for (const row of allMemories) {
            db.prepare('DELETE FROM memories WHERE user_id = ?').run(row.user_id)
            clearedCount++
        }
        res.json(ChaiteResponse.ok({ 
            success: true, 
            message: `已清空 ${clearedCount} 个用户的记忆`,
            clearedUsers: clearedCount
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /search - 搜索记忆
router.post('/search', async (req, res) => {
    try {
        const { userId, query, limit } = req.body
        const { memoryManager } = await import('../storage/MemoryManager.js')
        await memoryManager.init()
        const memories = await memoryManager.searchMemories(userId, query, limit || 10)
        res.json(ChaiteResponse.ok(memories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /group/:groupId/summarize - 群记忆总结
router.post('/group/:groupId/summarize', async (req, res) => {
    try {
        const { memoryManager } = await import('../storage/MemoryManager.js')
        const result = await memoryManager.summarizeGroupMemory(req.params.groupId)
        if (result) {
            res.json(ChaiteResponse.ok(result))
        } else {
            res.status(400).json(ChaiteResponse.fail(null, '无法生成总结'))
        }
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /:userId - 获取用户记忆
router.get('/:userId', async (req, res) => {
    try {
        const { memoryManager } = await import('../storage/MemoryManager.js')
        await memoryManager.init()
        const memories = await memoryManager.getAllMemories(req.params.userId)
        res.json(ChaiteResponse.ok(memories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST / - 添加记忆
router.post('/', async (req, res) => {
    try {
        const { userId, content, metadata } = req.body
        if (!userId || !content) {
            return res.status(400).json(ChaiteResponse.fail(null, 'userId and content are required'))
        }
        const { memoryManager } = await import('../storage/MemoryManager.js')
        await memoryManager.init()
        const memory = await memoryManager.addMemory(userId, content, metadata)
        res.status(201).json(ChaiteResponse.ok(memory))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /:userId/summarize - 用户记忆总结
router.post('/:userId/summarize', async (req, res) => {
    try {
        const { memoryManager } = await import('../storage/MemoryManager.js')
        const result = await memoryManager.summarizeUserMemory(req.params.userId)
        if (result) {
            res.json(ChaiteResponse.ok(result))
        } else {
            res.status(400).json(ChaiteResponse.fail(null, '无法生成总结'))
        }
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /:userId/:memoryId - 删除特定记忆
router.delete('/:userId/:memoryId', async (req, res) => {
    try {
        const { memoryManager } = await import('../storage/MemoryManager.js')
        await memoryManager.init()
        await memoryManager.deleteMemory(req.params.userId, req.params.memoryId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /:userId - 清空用户所有记忆
router.delete('/:userId', async (req, res) => {
    try {
        const { memoryManager } = await import('../storage/MemoryManager.js')
        await memoryManager.clearMemory(req.params.userId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
