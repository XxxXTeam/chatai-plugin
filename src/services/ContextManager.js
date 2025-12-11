import { redisClient } from '../core/cache/RedisClient.js'
import config from '../../config/config.js'
import historyManager from '../core/utils/history.js'

/**
 * Context Manager - 管理用户上下文和会话隔离
 * 
 * 支持:
 * - 用户 uin 标签
 * - 最多 20 条上文构建请求
 * - 群聊用户隔离模式
 * - 多用户消息区分
 * - 异步锁防止并发冲突
 */
export class ContextManager {
    constructor() {
        this.locks = new Map()          // 异步锁: key -> { promise, resolve, acquiredAt }
        this.initialized = false
        this.maxContextMessages = 20    // 最多20条上文
        this.requestCounters = new Map() // 请求计数器（用于检测并发）
        this.messageQueues = new Map()  // 消息队列（确保消息不丢失）
        this.processingFlags = new Map() // 处理中标记
    }

    /**
     * Initialize context manager
     */
    async init() {
        if (this.initialized) return
        await redisClient.init()
        this.initialized = true
        logger.debug('[ContextManager] Initialized')
    }

    /**
     * 获取异步锁 - 简洁的 Promise-based 互斥锁
     * @param {string} key - 锁的key（conversationId）
     * @param {number} timeout - 超时时间(ms)，默认60秒
     * @returns {Promise<Function>} 释放锁的函数
     */
    async acquireLock(key, timeout = 60000) {
        const maxLockDuration = 90000 // 锁最长持有时间 90秒
        const startTime = Date.now()
        
        // 等待现有锁释放
        while (this.locks.has(key)) {
            const existingLock = this.locks.get(key)
            
            // 检查现有锁是否过期
            if (existingLock && (Date.now() - existingLock.acquiredAt > maxLockDuration)) {
                // 强制释放过期锁
                this._forceRelease(key)
                break
            }
            
            // 检查等待超时
            if (Date.now() - startTime > timeout) {
                throw new Error(`获取锁超时: ${key}`)
            }
            
            // 等待锁释放
            if (existingLock?.promise) {
                await Promise.race([
                    existingLock.promise,
                    new Promise(r => setTimeout(r, 1000)) // 每秒检查一次
                ])
            } else {
                await new Promise(r => setTimeout(r, 100))
            }
        }
        
        // 创建新锁
        let lockResolve
        const lockPromise = new Promise(resolve => { lockResolve = resolve })
        
        this.locks.set(key, {
            acquiredAt: Date.now(),
            promise: lockPromise,
            resolve: lockResolve
        })
        
        // 返回释放函数
        let released = false
        return () => {
            if (!released) {
                released = true
                this._forceRelease(key)
            }
        }
    }

    /**
     * 内部方法：强制释放锁
     * @private
     */
    _forceRelease(key) {
        const lock = this.locks.get(key)
        if (lock?.resolve) {
            lock.resolve()
        }
        this.locks.delete(key)
    }

    /**
     * 释放锁（外部调用）
     * @param {string} key
     */
    releaseLock(key) {
        this._forceRelease(key)
    }

    /**
     * 记录请求（用于并发检测）
     * @param {string} conversationId
     * @returns {number} 当前并发数
     */
    recordRequest(conversationId) {
        const count = (this.requestCounters.get(conversationId) || 0) + 1
        this.requestCounters.set(conversationId, count)
        
        // 5秒后自动减少计数
        setTimeout(() => {
            const current = this.requestCounters.get(conversationId) || 0
            if (current > 0) {
                this.requestCounters.set(conversationId, current - 1)
            }
        }, 5000)
        
        return count
    }

    /**
     * 检查是否有并发请求
     * @param {string} conversationId
     * @returns {boolean}
     */
    hasConcurrentRequests(conversationId) {
        return (this.requestCounters.get(conversationId) || 0) > 1
    }

    /**
     * 添加消息到队列
     * @param {string} conversationId
     * @param {Object} message - 消息对象
     * @returns {number} 队列长度
     */
    enqueueMessage(conversationId, message) {
        if (!this.messageQueues.has(conversationId)) {
            this.messageQueues.set(conversationId, [])
        }
        const queue = this.messageQueues.get(conversationId)
        queue.push({
            ...message,
            enqueuedAt: Date.now()
        })
        
        // 防止队列无限增长，最多保留100条
        if (queue.length > 100) {
            queue.shift()
            logger.warn(`[ContextManager] 消息队列过长，丢弃旧消息: ${conversationId}`)
        }
        
        return queue.length
    }

    /**
     * 从队列获取消息
     * @param {string} conversationId
     * @returns {Object|null}
     */
    dequeueMessage(conversationId) {
        const queue = this.messageQueues.get(conversationId)
        if (!queue || queue.length === 0) return null
        return queue.shift()
    }

    /**
     * 获取队列长度
     * @param {string} conversationId
     * @returns {number}
     */
    getQueueLength(conversationId) {
        const queue = this.messageQueues.get(conversationId)
        return queue?.length || 0
    }

    /**
     * 清空队列
     * @param {string} conversationId
     */
    clearQueue(conversationId) {
        this.messageQueues.delete(conversationId)
    }

    /**
     * 标记正在处理
     * @param {string} conversationId
     * @param {boolean} processing
     */
    setProcessing(conversationId, processing) {
        if (processing) {
            this.processingFlags.set(conversationId, Date.now())
        } else {
            this.processingFlags.delete(conversationId)
        }
    }

    /**
     * 检查是否正在处理
     * @param {string} conversationId
     * @returns {boolean}
     */
    isProcessing(conversationId) {
        const startTime = this.processingFlags.get(conversationId)
        if (!startTime) return false
        
        // 超过60秒认为处理已超时，自动重置
        if (Date.now() - startTime > 60000) {
            this.processingFlags.delete(conversationId)
            return false
        }
        return true
    }

    /**
     * 获取会话ID - 用于上下文隔离
     * @param {string} userId - 用户 uin
     * @param {string} [groupId] - 群号
     * @returns {string} 会话ID
     * 
     * 隔离策略 (configurable):
     * - 群聊: 
     *   - groupUserIsolation=false: 群共享上下文（默认）
     *   - groupUserIsolation=true: 每用户独立上下文
     * - 私聊:
     *   - privateIsolation=true: 每用户独立上下文（默认）
     */
    getConversationId(userId, groupId = null) {
        const isolation = config.get('context.isolation') || {}
        const groupUserIsolation = isolation.groupUserIsolation ?? false
        const privateIsolation = isolation.privateIsolation ?? true

        if (groupId) {
            if (groupUserIsolation) {
                // 群聊用户隔离：每个用户独立上下文
                return `group:${groupId}:user:${userId}`
            }
            // 群聊共享：同一群的所有用户共享上下文
            return `group:${groupId}`
        }
        
        if (privateIsolation) {
            // 私聊隔离：每用户独立
            return `user:${userId}`
        }
        // 私聊共享（罕见场景）
        return `private:shared`
    }

    /**
     * 获取上下文历史 - 限制最多20条
     * @param {string} conversationId
     * @param {number} [limit] - 限制数量，默认20
     * @returns {Promise<Array>} 历史消息
     */
    async getContextHistory(conversationId, limit = null) {
        const maxMessages = limit || config.get('context.maxMessages') || this.maxContextMessages
        const history = await historyManager.getHistory(undefined, conversationId)
        
        // 限制最多返回数量
        if (history.length > maxMessages) {
            return history.slice(-maxMessages)
        }
        return history
    }

    /**
     * 构建带用户标签的上下文消息
     * 用于多用户群聊场景，AI可以区分不同用户的发言
     * 
     * @param {Array} history - 历史消息
     * @param {Object} currentSender - 当前发送者信息
     * @returns {Array} 带用户标签的消息
     */
    buildLabeledContext(history, currentSender = null) {
        return history.map((msg, index) => {
            // 只处理用户消息
            if (msg.role === 'user') {
                // 有 sender 信息
                if (msg.sender && msg.sender.user_id) {
                    const label = msg.sender.card || msg.sender.nickname || `用户`
                    const labeledContent = this.addUserLabelToContent(msg.content, label, msg.sender.user_id)
                    return {
                        ...msg,
                        content: labeledContent
                    }
                } else {
                    // 没有 sender 信息的历史消息，添加默认标签
                    const labeledContent = this.addUserLabelToContent(msg.content, '用户', `历史#${index}`)
                    return {
                        ...msg,
                        content: labeledContent
                    }
                }
            }
            return msg
        })
    }

    /**
     * 给消息内容添加用户标签
     * @param {Array|string} content - 消息内容
     * @param {string} label - 用户标签
     * @param {number|string} userId - 用户ID
     * @returns {Array} 带标签的内容
     */
    addUserLabelToContent(content, label, userId) {
        if (!content) return content
        
        // 如果是字符串，转换为数组格式
        if (typeof content === 'string') {
            return [{ type: 'text', text: `[${label}(${userId})]: ${content}` }]
        }
        
        // 如果是数组，给第一个文本内容添加标签
        if (Array.isArray(content)) {
            const labeled = [...content]
            const textIndex = labeled.findIndex(c => c.type === 'text')
            if (textIndex >= 0) {
                labeled[textIndex] = {
                    ...labeled[textIndex],
                    text: `[${label}(${userId})]: ${labeled[textIndex].text || ''}`
                }
            }
            return labeled
        }
        
        return content
    }

    /**
     * 获取隔离模式描述
     * @returns {Object} 隔离模式信息
     */
    getIsolationMode() {
        const isolation = config.get('context.isolation') || {}
        return {
            groupUserIsolation: isolation.groupUserIsolation ?? false,
            privateIsolation: isolation.privateIsolation ?? true,
            description: {
                group: (isolation.groupUserIsolation ?? false) 
                    ? '群聊用户独立上下文' 
                    : '群聊共享上下文',
                private: (isolation.privateIsolation ?? true)
                    ? '私聊用户独立上下文'
                    : '私聊共享上下文'
            }
        }
    }

    /**
     * Get context (history) for a user
     * @param {string} userId
     * @param {string} conversationId
     * @returns {Promise<Array>} History messages
     */
    async getContext(conversationId) {
        return await historyManager.getHistory(undefined, conversationId)
    }

    /**
     * Update context metadata
     * @param {string} conversationId
     * @param {Object} metadata
     */
    async updateContext(conversationId, metadata) {
        const key = `context:${conversationId}`
        const existing = await redisClient.get(key)
        let data = {}
        if (existing) {
            try {
                data = JSON.parse(existing)
            } catch (e) { }
        }

        data = { ...data, ...metadata, lastUpdated: Date.now() }

        // Save metadata (7 days TTL)
        await redisClient.set(key, JSON.stringify(data), 7 * 24 * 60 * 60)

        // Add to active contexts set
        if (redisClient.isConnected) {
            await redisClient.client.sadd('active_contexts', conversationId)
        }
    }

    /**
     * Get all active contexts
     * @returns {Promise<Array>}
     */
    async getActiveContexts() {
        if (!redisClient.isConnected) return []

        const ids = await redisClient.client.smembers('active_contexts')
        const contexts = []

        for (const id of ids) {
            const data = await redisClient.get(`context:${id}`)
            if (data) {
                try {
                    contexts.push({
                        id,
                        ...JSON.parse(data)
                    })
                } catch (e) { }
            } else {
                // Cleanup if metadata missing
                await redisClient.client.srem('active_contexts', id)
            }
        }

        return contexts.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))
    }

    /**
     * Clean context based on strategy
     * 优化的上下文清理机制，保留最近的重要对话
     * @param {string} conversationId
     */
    async cleanContext(conversationId) {
        const maxMessages = config.get('context.maxMessages') || 20
        const strategy = config.get('context.cleaningStrategy') || 'truncate'

        const history = await historyManager.getHistory(undefined, conversationId)

        if (history.length <= maxMessages) {
            return // 不需要清理
        }

        logger.debug(`[ContextManager] 清理上下文: ${conversationId}, ${history.length} -> ${maxMessages}`)

        if (strategy === 'smart') {
            // 智能清理：保留最近对话和重要消息
            try {
                const keepCount = maxMessages
                
                // 标记重要消息（包含关键信息的消息）
                const importantIndicators = ['记住', '我是', '我叫', '我的', '重要', '记得', '别忘']
                const importantMessages = []
                const recentMessages = history.slice(-keepCount)
                
                // 从早期消息中提取重要内容
                const earlyMessages = history.slice(0, -keepCount)
                for (const msg of earlyMessages) {
                    const content = Array.isArray(msg.content) 
                        ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('')
                        : msg.content
                    
                    if (importantIndicators.some(ind => content?.includes(ind))) {
                        importantMessages.push(msg)
                        if (importantMessages.length >= 3) break // 最多保留3条重要消息
                    }
                }
                
                // 合并重要消息和最近消息
                const newHistory = [...importantMessages, ...recentMessages]
                
                // 如果仍然超出限制，截断
                if (newHistory.length > maxMessages) {
                    await historyManager.trimHistory(conversationId, maxMessages)
                }
                
                logger.debug(`[ContextManager] 智能清理: 保留${importantMessages.length}条重要+${recentMessages.length}条最近`)
                return
            } catch (error) {
                logger.error('[ContextManager] 智能清理失败，回退到截断模式', error)
            }
        }

        // 默认/回退: 简单截断，保留最近的消息
        await historyManager.trimHistory(conversationId, maxMessages)
    }
    
    /**
     * 获取上下文统计信息
     * @param {string} conversationId
     * @returns {Object}
     */
    async getContextStats(conversationId) {
        const history = await historyManager.getHistory(undefined, conversationId)
        const maxMessages = config.get('context.maxMessages') || 20
        
        return {
            messageCount: history.length,
            maxMessages,
            needsCleaning: history.length > maxMessages,
            userMessages: history.filter(m => m.role === 'user').length,
            assistantMessages: history.filter(m => m.role === 'assistant').length
        }
    }

    /**
     * 检查对话轮数并自动结束
     * @param {string} conversationId
     * @returns {Promise<{shouldEnd: boolean, currentRounds: number, maxRounds: number}>}
     */
    async checkAutoEnd(conversationId) {
        const autoEndConfig = config.get('context.autoEnd') || {}
        
        if (!autoEndConfig.enabled) {
            return { shouldEnd: false, currentRounds: 0, maxRounds: 0 }
        }
        
        const maxRounds = autoEndConfig.maxRounds || 50
        const history = await historyManager.getHistory(undefined, conversationId)
        
        // 计算对话轮数（每次用户消息+AI回复算一轮）
        const userMessages = history.filter(m => m.role === 'user').length
        const currentRounds = userMessages
        
        const shouldEnd = currentRounds >= maxRounds
        
        if (shouldEnd) {
            logger.debug(`[ContextManager] 对话达到轮数限制: ${conversationId}, ${currentRounds}/${maxRounds}`)
        }
        
        return {
            shouldEnd,
            currentRounds,
            maxRounds,
            notifyUser: autoEndConfig.notifyUser !== false,
            notifyMessage: autoEndConfig.notifyMessage || '对话已达到最大轮数限制，已自动开始新会话。'
        }
    }

    /**
     * 执行自动结束对话
     * @param {string} conversationId
     * @returns {Promise<boolean>}
     */
    async executeAutoEnd(conversationId) {
        try {
            await historyManager.deleteConversation(conversationId)
            await this.cleanContext(conversationId)
            logger.debug(`[ContextManager] 自动结束对话: ${conversationId}`)
            return true
        } catch (error) {
            logger.error(`[ContextManager] 自动结束对话失败: ${error.message}`)
            return false
        }
    }
}

export const contextManager = new ContextManager()
