/**
 * 对话路由模块
 */

import express from 'express'
import { ChaiteResponse, getDatabase } from './shared.js'
import { chatLogger as logger } from '../../core/utils/logger.js'

/**
 * 创建对话路由
 * @param {Function} authMiddleware - 认证中间件
 * @returns {express.Router}
 */
export function createConversationRoutes(authMiddleware) {
    const router = express.Router()

    // GET /api/conversations/list - List all conversations
    router.get('/list', authMiddleware, async (req, res) => {
        try {
            const db = getDatabase()
            const conversations = db.getConversations()
            res.json(ChaiteResponse.ok(conversations))
        } catch (error) {
            res.status(500).json(ChaiteResponse.fail(null, error.message))
        }
    })
    router.delete('/clear-all', authMiddleware, async (req, res) => {
        try {
            const db = getDatabase()
            const deletedCount = db.clearAllConversations()

            const { contextManager } = await import('../llm/ContextManager.js')
            await contextManager.init()
            contextManager.locks?.clear()
            contextManager.processingFlags?.clear()
            contextManager.messageQueues?.clear()
            contextManager.requestCounters?.clear()
            contextManager.groupContextCache?.clear()
            contextManager.sessionStates?.clear()

            logger.info(`[WebServer] 清空所有对话完成, 删除: ${deletedCount}条消息`)
            res.json(ChaiteResponse.ok({ success: true, deletedCount }))
        } catch (error) {
            logger.error('[WebServer] 清空对话失败:', error)
            res.status(500).json(ChaiteResponse.fail(null, error.message))
        }
    })

    // GET /api/conversations/:id/messages - Get messages for a conversation
    router.get('/:id/messages', authMiddleware, async (req, res) => {
        try {
            const db = getDatabase()
            const limit = parseInt(req.query.limit) || 100
            const messages = db.getMessages(req.params.id, limit)
            res.json(ChaiteResponse.ok(messages))
        } catch (error) {
            res.status(500).json(ChaiteResponse.fail(null, error.message))
        }
    })

    // DELETE /api/conversations/:id - Delete a conversation
    router.delete('/:id', authMiddleware, async (req, res) => {
        try {
            const db = getDatabase()
            db.deleteConversation(req.params.id)
            res.json(ChaiteResponse.ok({ success: true }))
        } catch (error) {
            res.status(500).json(ChaiteResponse.fail(null, error.message))
        }
    })

    return router
}

/**
 * 创建上下文路由
 * @param {Function} authMiddleware - 认证中间件
 * @returns {express.Router}
 */
export function createContextRoutes(authMiddleware) {
    const router = express.Router()

    // GET /api/context/list - List active contexts
    router.get('/list', authMiddleware, async (req, res) => {
        try {
            const { contextManager } = await import('../llm/ContextManager.js')
            await contextManager.init()
            const contexts = await contextManager.getActiveContexts()
            res.json(ChaiteResponse.ok(contexts))
        } catch (error) {
            res.status(500).json(ChaiteResponse.fail(null, error.message))
        }
    })

    // POST /api/context/clear - Clear context
    router.post('/clear', authMiddleware, async (req, res) => {
        const { userId, conversationId } = req.body
        try {
            const { contextManager } = await import('../llm/ContextManager.js')
            await contextManager.init()

            const targetConvId = conversationId || contextManager.getConversationId(userId)
            await contextManager.cleanContext(targetConvId)

            const { default: historyManager } = await import('../../core/utils/history.js')
            await historyManager.deleteConversation(targetConvId)

            res.json(ChaiteResponse.ok({ success: true, message: 'Context cleared' }))
        } catch (error) {
            res.status(500).json(ChaiteResponse.fail(null, error.message))
        }
    })

    return router
}

export default { createConversationRoutes, createContextRoutes }
