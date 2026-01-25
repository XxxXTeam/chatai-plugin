/**
 * 记忆路由模块 - 结构化用户记忆管理
 * 使用新的 MemoryService 进行记忆管理
 */
import express from 'express'
import { ChaiteResponse, getRawDatabase } from './shared.js'
import { memoryService } from '../memory/MemoryService.js'
import { memorySummarizer } from '../memory/MemorySummarizer.js'
import { MemoryCategory, CategoryLabels, isValidCategory } from '../memory/MemoryTypes.js'

const router = express.Router()

// ==================== 统计和用户列表 ====================

// GET /users - 获取所有有记忆的用户列表
router.get('/users', async (req, res) => {
    try {
        const users = await memoryService.listUsers()
        res.json(ChaiteResponse.ok(users))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats - 获取记忆统计
router.get('/stats', async (req, res) => {
    try {
        const stats = await memoryService.getStats()
        res.json(
            ChaiteResponse.ok({
                ...stats,
                categories: CategoryLabels
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /categories - 获取所有分类定义
router.get('/categories', async (req, res) => {
    try {
        res.json(
            ChaiteResponse.ok({
                categories: MemoryCategory,
                labels: CategoryLabels
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 搜索 ====================

// POST /search - 搜索记忆
router.post('/search', async (req, res) => {
    try {
        const { query, userId, groupId, category, limit = 20 } = req.body
        if (!query) {
            return res.status(400).json(ChaiteResponse.fail(null, 'query is required'))
        }
        const memories = await memoryService.searchMemories(query, {
            userId,
            groupId,
            category,
            limit
        })
        res.json(ChaiteResponse.ok(memories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 全局操作 ====================

// DELETE /clear-all - 清空所有用户记忆（危险操作）
router.delete('/clear-all', async (req, res) => {
    try {
        const db = getRawDatabase()
        // 清空结构化记忆表
        const result = db.prepare('DELETE FROM structured_memories').run()
        // 也清空旧表（兼容）
        const oldResult = db.prepare('DELETE FROM memories').run()

        res.json(
            ChaiteResponse.ok({
                success: true,
                message: `已清空所有记忆`,
                deletedCount: result.changes + oldResult.changes
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 用户记忆操作 ====================

// GET /user/:userId - 获取用户完整记忆（树状结构）
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params
        const { format = 'tree', groupId } = req.query

        if (format === 'tree') {
            const tree = await memoryService.getMemoryTree(userId, { groupId })
            res.json(ChaiteResponse.ok(tree))
        } else {
            const memories = await memoryService.getMemoriesByUser(userId, { groupId })
            res.json(ChaiteResponse.ok(memories))
        }
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /user/:userId/stats - 获取用户记忆统计
router.get('/user/:userId/stats', async (req, res) => {
    try {
        const stats = await memoryService.getStats(req.params.userId)
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /user/:userId/category/:category - 按分类获取用户记忆
router.get('/user/:userId/category/:category', async (req, res) => {
    try {
        const { userId, category } = req.params
        if (!isValidCategory(category)) {
            return res.status(400).json(ChaiteResponse.fail(null, `Invalid category: ${category}`))
        }
        const memories = await memoryService.getMemoriesByUser(userId, { category })
        res.json(ChaiteResponse.ok(memories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /user/:userId - 为用户添加记忆
router.post('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params
        const { content, category = 'custom', subType, groupId, confidence, metadata } = req.body

        if (!content) {
            return res.status(400).json(ChaiteResponse.fail(null, 'content is required'))
        }

        const memory = await memoryService.saveMemory({
            userId,
            groupId,
            category,
            subType,
            content,
            confidence: confidence || 0.9,
            source: 'manual',
            metadata
        })

        res.status(201).json(ChaiteResponse.ok(memory))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /user/:userId/summarize - 触发用户记忆总结
router.post('/user/:userId/summarize', async (req, res) => {
    try {
        const { userId } = req.params
        const { useLLM = false } = req.body

        const result = await memorySummarizer.summarizeUserMemories(userId, { useLLM })
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /user/:userId - 清空用户所有记忆
router.delete('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params
        const { hard = false } = req.query

        const count = await memoryService.clearUserMemories(userId, hard === 'true')
        res.json(
            ChaiteResponse.ok({
                success: true,
                deletedCount: count
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 群组记忆操作 ====================

// GET /group/:groupId - 获取群组记忆
router.get('/group/:groupId', async (req, res) => {
    try {
        const { groupId } = req.params
        const { userId, category, limit = 100 } = req.query

        const memories = await memoryService.getMemoriesByGroup(groupId, {
            userId,
            category,
            limit: parseInt(limit)
        })
        res.json(ChaiteResponse.ok(memories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /user/:userId/group/:groupId - 获取用户在特定群的记忆
router.get('/user/:userId/group/:groupId', async (req, res) => {
    try {
        const { userId, groupId } = req.params
        const { format = 'list' } = req.query

        if (format === 'tree') {
            const tree = await memoryService.getMemoryTree(userId, { groupId })
            res.json(ChaiteResponse.ok(tree))
        } else {
            const memories = await memoryService.getMemoriesByUser(userId, { groupId })
            res.json(ChaiteResponse.ok(memories))
        }
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 单条记忆操作 ====================

// GET /:id - 获取单条记忆
router.get('/:id(\\d+)', async (req, res) => {
    try {
        const memory = await memoryService.getMemoryById(parseInt(req.params.id))
        if (!memory) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Memory not found'))
        }
        res.json(ChaiteResponse.ok(memory))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /:id - 更新记忆
router.put('/:id(\\d+)', async (req, res) => {
    try {
        const { content, category, subType, confidence, metadata } = req.body

        const updates = {}
        if (content !== undefined) updates.content = content
        if (category !== undefined) updates.category = category
        if (subType !== undefined) updates.subType = subType
        if (confidence !== undefined) updates.confidence = confidence
        if (metadata !== undefined) updates.metadata = metadata

        const memory = await memoryService.updateMemory(parseInt(req.params.id), updates)
        if (!memory) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Memory not found'))
        }
        res.json(ChaiteResponse.ok(memory))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /:id - 删除记忆
router.delete('/:id(\\d+)', async (req, res) => {
    try {
        const { hard = false } = req.query
        await memoryService.deleteMemory(parseInt(req.params.id), hard === 'true')
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 批量操作 ====================

// POST /batch - 批量添加记忆
router.post('/batch', async (req, res) => {
    try {
        const { memories } = req.body
        if (!Array.isArray(memories) || memories.length === 0) {
            return res.status(400).json(ChaiteResponse.fail(null, 'memories array is required'))
        }

        const results = await memoryService.saveMemories(memories)
        res.json(
            ChaiteResponse.ok({
                total: memories.length,
                success: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /merge/:userId - 合并用户重复记忆
router.post('/merge/:userId', async (req, res) => {
    try {
        const result = await memoryService.mergeMemories(req.params.userId)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 兼容旧 API ====================

// POST / - 添加记忆（兼容旧接口）
router.post('/', async (req, res) => {
    try {
        const { userId, content, category = 'custom', metadata } = req.body
        if (!userId || !content) {
            return res.status(400).json(ChaiteResponse.fail(null, 'userId and content are required'))
        }

        const memory = await memoryService.saveMemory({
            userId,
            category,
            content,
            confidence: 0.9,
            source: 'manual',
            metadata
        })

        res.status(201).json(ChaiteResponse.ok(memory))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /:userId - 获取用户记忆（兼容旧接口，放在最后）
router.get('/:userId', async (req, res) => {
    try {
        // 检查是否是数字ID（单条记忆查询）
        if (/^\d+$/.test(req.params.userId)) {
            const memory = await memoryService.getMemoryById(parseInt(req.params.userId))
            if (memory) {
                return res.json(ChaiteResponse.ok(memory))
            }
        }

        // 否则作为用户ID处理
        const memories = await memoryService.getMemoriesByUser(req.params.userId)
        res.json(ChaiteResponse.ok(memories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /:userId/:memoryId - 删除特定记忆（兼容旧接口）
router.delete('/:userId/:memoryId', async (req, res) => {
    try {
        await memoryService.deleteMemory(parseInt(req.params.memoryId))
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /:userId - 清空用户所有记忆（兼容旧接口）
router.delete('/:userId', async (req, res) => {
    try {
        const count = await memoryService.clearUserMemories(req.params.userId)
        res.json(ChaiteResponse.ok({ success: true, deletedCount: count }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
