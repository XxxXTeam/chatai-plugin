import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import { redisClient } from '../../core/cache/RedisClient.js'
import config from '../../../config/config.js'
import historyManager from '../../core/utils/history.js'


export class ContextManager {
    constructor() {
        this.locks = new Map()          // 异步锁: key -> { promise, resolve, acquiredAt }
        this.initialized = false
        this.maxContextMessages = 20    // 最多20条上文
        this.requestCounters = new Map() // 请求计数器（用于检测并发）
        this.messageQueues = new Map()  // 消息队列（确保消息不丢失）
        this.processingFlags = new Map() // 处理中标记
        this.groupContextCache = new Map() // 群聊上下文缓存 (groupId -> context)
        this.sessionStates = new Map()   // 会话状态 (conversationId -> state)
    }

    /**
     * 初始化上下文管理器
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
     * @param {Object} [options] - 选项
     * @param {boolean} [options.includeToolCalls] - 是否包含工具调用记录
     * @returns {Promise<Array>} 历史消息
     */
    async getContextHistory(conversationId, limit = null, options = {}) {
        // 读取 autoContext 配置
        const autoContextConfig = config.get('context.autoContext') || {}
        const autoContextEnabled = autoContextConfig.enabled !== false
        
        // 如果自动上下文禁用，返回空历史
        if (!autoContextEnabled) {
            logger.debug('[ContextManager] 自动上下文已禁用，不携带历史消息')
            return []
        }
        
        // 优先使用 autoContext 配置的 maxHistoryMessages
        const maxMessages = limit || autoContextConfig.maxHistoryMessages || config.get('context.maxMessages') || this.maxContextMessages
        const includeToolCalls = options.includeToolCalls ?? autoContextConfig.includeToolCalls ?? false
        
        let history = await historyManager.getHistory(undefined, conversationId)
        
        // 如果不包含工具调用，过滤掉 tool 角色的消息和包含 toolCalls 的消息
        if (!includeToolCalls) {
            history = history.filter(msg => {
                // 过滤掉 tool 角色的消息
                if (msg.role === 'tool') return false
                // 过滤掉包含 toolCalls 的 assistant 消息（但保留有文本内容的）
                if (msg.role === 'assistant' && msg.toolCalls?.length > 0) {
                    // 检查是否有有意义的文本内容
                    const hasText = Array.isArray(msg.content) 
                        ? msg.content.some(c => c.type === 'text' && c.text?.trim())
                        : (typeof msg.content === 'string' && msg.content.trim())
                    // 如果没有文本内容，过滤掉
                    if (!hasText) return false
                }
                return true
            })
        }
        
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
     * @param {Object} options - 额外选项
     * @returns {Array} 带用户标签的消息
     */
    buildLabeledContext(history, currentSender = null, options = {}) {
        const { includeTimestamp = false, maxAge = 0 } = options
        const now = Date.now()
        // 过滤过期消息
        let filtered = history
        if (maxAge > 0) {
            filtered = history.filter(msg => {
                if (!msg.timestamp) return true
                return (now - msg.timestamp) < maxAge
            })
        }

        return filtered.map((msg, index) => {
            // 只处理用户消息
            if (msg.role === 'user') {
                // 有 sender 信息
                if (msg.sender && msg.sender.user_id) {
                    const label = msg.sender.card || msg.sender.nickname || `用户`
                    let labeledContent = this.addUserLabelToContent(msg.content, label, msg.sender.user_id)
                    
                    // 添加时间戳（可选）
                    if (includeTimestamp && msg.timestamp) {
                        const timeStr = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
                        labeledContent = this.prependTimeToContent(labeledContent, timeStr)
                    }
                    
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
     * 在内容前添加时间戳
     * @param {Array|string} content
     * @param {string} timeStr
     * @returns {Array}
     */
    prependTimeToContent(content, timeStr) {
        if (!content) return content
        
        if (typeof content === 'string') {
            return [{ type: 'text', text: `[${timeStr}] ${content}` }]
        }
        
        if (Array.isArray(content)) {
            const labeled = [...content]
            const textIndex = labeled.findIndex(c => c.type === 'text')
            if (textIndex >= 0) {
                const existingText = labeled[textIndex].text || ''
                // 在用户标签后插入时间
                const updated = existingText.replace(/^(\[[^\]]+\])/, `$1[${timeStr}]`)
                labeled[textIndex] = { ...labeled[textIndex], text: updated }
            }
            return labeled
        }
        
        return content
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
     * 缓存群聊上下文
     * @param {string} groupId
     * @param {Object} context
     */
    cacheGroupContext(groupId, context) {
        this.groupContextCache.set(groupId, {
            context,
            timestamp: Date.now()
        })
        
        // 清理过期缓存
        if (this.groupContextCache.size > 100) {
            const expireTime = 30 * 60 * 1000 // 30分钟
            const now = Date.now()
            for (const [id, cached] of this.groupContextCache) {
                if (now - cached.timestamp > expireTime) {
                    this.groupContextCache.delete(id)
                }
            }
        }
    }

    /**
     * 获取缓存的群聊上下文
     * @param {string} groupId
     * @returns {Object|null}
     */
    getCachedGroupContext(groupId) {
        const cached = this.groupContextCache.get(groupId)
        if (!cached) return null
        
        // 检查是否过期（5分钟）
        if (Date.now() - cached.timestamp > 5 * 60 * 1000) {
            this.groupContextCache.delete(groupId)
            return null
        }
        
        return cached.context
    }

    /**
     * 清除群聊上下文缓存
     * @param {string} groupId
     */
    clearGroupContextCache(groupId) {
        this.groupContextCache.delete(groupId)
    }

    /**
     * 设置会话状态
     * @param {string} conversationId
     * @param {Object} state
     */
    setSessionState(conversationId, state) {
        const existing = this.sessionStates.get(conversationId) || {}
        this.sessionStates.set(conversationId, {
            ...existing,
            ...state,
            updatedAt: Date.now()
        })
    }

    /**
     * 获取会话状态
     * @param {string} conversationId
     * @returns {Object|null}
     */
    getSessionState(conversationId) {
        return this.sessionStates.get(conversationId) || null
    }

    /**
     * 清除会话状态
     * @param {string} conversationId
     */
    clearSessionState(conversationId) {
        this.sessionStates.delete(conversationId)
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
            this.clearSessionState(conversationId)
            logger.debug(`[ContextManager] 自动结束对话: ${conversationId}`)
            return true
        } catch (error) {
            logger.error(`[ContextManager] 自动结束对话失败: ${error.message}`)
            return false
        }
    }

    /**
     * 构建群聊上下文摘要
     * 用于在系统提示词中提供群聊背景信息
     * @param {string} groupId
     * @param {Object} options
     * @returns {Promise<string>}
     */
    async buildGroupContextSummary(groupId, options = {}) {
        const { includeMembers = true, includeTopics = true, maxLength = 500 } = options
        
        const cached = this.getCachedGroupContext(groupId)
        if (cached?.summary) {
            return cached.summary
        }
        
        const parts = []
        
        // 获取群信息
        try {
            const bot = global.Bot
            if (bot?.pickGroup) {
                const group = bot.pickGroup(parseInt(groupId))
                const info = await group.getInfo?.()
                if (info) {
                    parts.push(`群名: ${info.group_name || groupId}`)
                    if (info.member_count) {
                        parts.push(`成员数: ${info.member_count}`)
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        
        const summary = parts.join('\n').substring(0, maxLength)
        
        // 缓存摘要
        this.cacheGroupContext(groupId, { summary })
        
        return summary
    }

    /**
     * 获取群聊天历史记录
     * 兼容 miao-adapter/icqq 和 OneBot/NapCat
     * @param {Object} group - 群对象 (Bot.pickGroup(groupId))
     * @param {number} num - 获取数量
     * @param {Object} options - 选项
     * @returns {Promise<Array>} 聊天记录数组
     */
    async getChatHistoryGroup(group, num = 20, options = {}) {
        if (!group || typeof group.getChatHistory !== 'function') {
            return []
        }

        const { formatMessages = false } = options
        const allowedMessageTypes = ['text', 'at', 'image', 'video', 'bface', 'forward', 'json', 'reply']
        const seenMessageIds = new Set()

        try {
            // 处理和过滤消息
            const processChats = (rawChats) => {
                return rawChats.filter(chat => {
                    const messageId = chat.seq || chat.message_seq || chat.message_id
                    if (seenMessageIds.has(messageId)) {
                        return false
                    }
                    if (!chat.sender?.user_id || !chat.message?.length) {
                        return false
                    }
                    if (!chat.message.some(msgPart => allowedMessageTypes.includes(msgPart.type))) {
                        return false
                    }
                    seenMessageIds.add(messageId)
                    return true
                })
            }

            // 获取初始消息
            let initialChats = await group.getChatHistory(0, 20)
            if (!initialChats || initialChats.length === 0) {
                return []
            }

            let chats = processChats(initialChats)
            let seq = initialChats[0]?.seq || initialChats[0]?.message_seq || initialChats[0]?.message_id

            // 继续获取更多消息直到达到数量
            while (chats.length < num && seq) {
                try {
                    const chatHistory = await group.getChatHistory(seq, 20)
                    const newSeq = chatHistory[0]?.seq || chatHistory[0]?.message_seq || chatHistory[0]?.message_id

                    if (!chatHistory || chatHistory.length === 0 || seq === newSeq) {
                        break
                    }

                    seq = newSeq
                    const newChats = processChats(chatHistory)

                    if (newChats.length === 0) {
                        break
                    }

                    chats.unshift(...newChats)
                } catch (err) {
                    logger.debug(`[ContextManager] 获取更多聊天记录失败: ${err.message}`)
                    break
                }
            }

            // 只保留最近的 num 条
            chats = chats.slice(Math.max(0, chats.length - num))

            return chats
        } catch (err) {
            logger.error('[ContextManager] 获取群聊天记录失败:', err.message)
            return []
        }
    }

    /**
     * 格式化聊天消息内容
     * @param {Object} group - 群对象
     * @param {Object} chat - 聊天消息
     * @returns {Promise<string>} 格式化后的消息文本
     */
    async formatChatMessage(group, chat) {
        const roleMap = { owner: '群主', admin: '管理员', member: '普通成员' }
        const sender = chat.sender || {}
        const chatTime = chat.time || Math.floor(Date.now() / 1000)
        const senderId = sender.user_id

        // 获取成员信息
        let senderName = sender.card || sender.nickname || senderId || '未知用户'
        let memberInfo = null
        try {
            const member = group.pickMember?.(senderId)
            memberInfo = member?.info || await member?.getInfo?.(true)
            if (memberInfo) {
                senderName = memberInfo.card || memberInfo.nickname || senderName
            }
        } catch {
            try {
                memberInfo = (await group.pickMember(Number(senderId)))?.info
                if (memberInfo) {
                    senderName = memberInfo.card || memberInfo.nickname || senderName
                }
            } catch {}
        }

        const senderRole = roleMap[sender.role] || '普通成员'
        const timeStr = new Date(chatTime * 1000).toLocaleTimeString('zh-CN', { hour12: false })

        // 构建消息头
        let messageHeader = `【${senderName}】(QQ:${senderId}, 角色:${senderRole}`
        if (sender.title) {
            messageHeader += `, 头衔:${sender.title}`
        }
        messageHeader += `, 时间:${timeStr}`
        const seq = chat.seq || chat.message_seq
        if (seq) {
            messageHeader += `, seq:${seq}`
        }

        // 处理引用消息
        const replyPart = chat.message?.find(msg => msg.type === 'reply')
        if (replyPart) {
            const replyId = replyPart.id || replyPart.data?.id
            if (replyId) {
                try {
                    const originalMsgArray = await group.getChatHistory(replyId, 1)
                    const originalMsg = originalMsgArray?.[0]
                    if (originalMsg?.sender) {
                        const originalSenderId = originalMsg.sender.user_id
                        let originalSenderName = originalMsg.sender.card || originalMsg.sender.nickname || originalSenderId
                        const originalContent = this._extractMessageText(originalMsg.message)
                        messageHeader += `, 引用了${originalSenderName}(QQ:${originalSenderId})的消息"${originalContent.substring(0, 50)}"`
                    }
                } catch {}
            }
        }

        messageHeader += `) 说：`

        // 提取消息内容
        const messageContent = this._extractMessageText(chat.message?.filter(m => m.type !== 'reply'))

        return `${messageHeader}${messageContent}`
    }

    /**
     * @private
     * @param {Array} messageParts - 消息段数组
     * @param {boolean} deepParse - 是否深度解析
     */
    _extractMessageText(messageParts, deepParse = false) {
        if (!messageParts) return ''
        if (typeof messageParts === 'string') return messageParts
        if (!Array.isArray(messageParts)) {
            if (messageParts.raw_message) return messageParts.raw_message
            if (messageParts.message) return this._extractMessageText(messageParts.message, deepParse)
            return String(messageParts)
        }
        
        const contentParts = []
        for (const msgPart of messageParts) {
            if (!msgPart) continue
            
            const data = msgPart.data || msgPart
            const type = msgPart.type || data.type
            
            switch (type) {
                case 'text':
                    contentParts.push(data.text || msgPart.text || '')
                    break
                case 'at':
                    const atName = data.name || msgPart.name || ''
                    const atQQ = data.qq || msgPart.qq || ''
                    contentParts.push(atName ? `@${atName}` : `@${atQQ}`)
                    break
                case 'image': {
                    const isAnimated = data.asface === true || data.sub_type === 1
                    const summary = data.summary || data.file_unique || ''
                    if (summary && deepParse) {
                        contentParts.push(`[图片:${summary}]`)
                    } else {
                        contentParts.push(isAnimated ? '[动画表情]' : '[图片]')
                    }
                    break
                }
                case 'video':
                    contentParts.push('[视频]')
                    break
                case 'bface':
                case 'mface':
                    contentParts.push(data.text || msgPart.text || data.summary || '[表情]')
                    break
                case 'forward':
                    contentParts.push('[聊天记录]')
                    break
                case 'json':
                    try {
                        const jsonStr = data.data || msgPart.data
                        const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
                        if (jsonData?.meta?.detail?.resid) {
                            contentParts.push('[聊天记录]')
                        } else if (jsonData?.meta?.news?.title) {
                            contentParts.push(`[分享:${jsonData.meta.news.title}]`)
                        } else if (jsonData?.prompt) {
                            contentParts.push(`[卡片:${jsonData.prompt}]`)
                        } else {
                            contentParts.push('[卡片消息]')
                        }
                    } catch {
                        contentParts.push('[卡片消息]')
                    }
                    break
                case 'xml':
                    try {
                        const xmlStr = data.data || msgPart.data || ''
                        const briefMatch = xmlStr.match(/brief="([^"]*)"/)
                        if (briefMatch) {
                            contentParts.push(`[XML:${briefMatch[1]}]`)
                        } else {
                            contentParts.push('[XML消息]')
                        }
                    } catch {
                        contentParts.push('[XML消息]')
                    }
                    break
                case 'face':
                    contentParts.push(`[表情:${data.id || msgPart.id}]`)
                    break
                case 'record':
                    contentParts.push('[语音]')
                    break
                case 'file':
                    contentParts.push(`[文件:${data.name || data.file || '未知'}]`)
                    break
                case 'share':
                    contentParts.push(`[分享:${data.title || '链接'}]`)
                    break
                case 'location':
                    contentParts.push(`[位置:${data.title || data.address || '未知'}]`)
                    break
                case 'poke':
                    contentParts.push('[戳一戳]')
                    break
                case 'reply':
                    // 忽略引用标记本身
                    break
                case 'markdown':
                    contentParts.push(data.content || data.text || '[Markdown]')
                    break
                default:
                    // 深度解析：尝试从未知类型提取内容
                    if (deepParse) {
                        if (data.text) contentParts.push(data.text)
                        else if (data.content) contentParts.push(data.content)
                        else if (data.summary) contentParts.push(`[${type}:${data.summary}]`)
                        else if (type) contentParts.push(`[${type}]`)
                    }
                    break
            }
        }
        return contentParts.join('').replace(/\n/g, ' ').trim()
    }

    /**
     * 构建完整的群聊上下文提示
     * 包含群信息、当前用户、聊天历史
     * @param {string|number} groupId - 群号
     * @param {Object} options - 选项
     * @returns {Promise<string>} 群聊上下文提示
     */
    async buildGroupPrompt(groupId, options = {}) {
        const { sender, contextLength = 20, promptHeader = null } = options
        let systemPromptWithContext = ''

        const bot = global.Bot
        const group = bot?.pickGroup?.(parseInt(groupId))
        if (!group) return ''

        // 构建头部信息
        if (promptHeader) {
            systemPromptWithContext += promptHeader
        } else {
            // 获取机器人在群内的信息
            let botName = bot.nickname || bot.uin
            try {
                const botMember = group.pickMember?.(bot.uin)
                const botInfo = botMember?.info || await botMember?.getInfo?.(true)
                if (botInfo) {
                    botName = botInfo.card || botInfo.nickname || botName
                }
            } catch {}

            // 获取群信息
            let groupName = groupId
            try {
                const groupInfo = await group.getInfo?.()
                groupName = groupInfo?.group_name || groupInfo?.name || groupId
            } catch {}

            systemPromptWithContext += `你目前正在一个QQ群聊中。`
            systemPromptWithContext += `\n群名称: ${groupName}, 群号: ${groupId}。`
            systemPromptWithContext += `你现在是这个QQ群的成员，你的昵称是"${botName}"(QQ:${bot.uin})。`

            // 当前用户信息
            if (sender) {
                const latestSenderName = sender.card || sender.nickname || sender.user_id
                const roleMap = { owner: '群主', admin: '管理员', member: '普通成员' }
                systemPromptWithContext += `\n当前向你提问的用户是: ${latestSenderName}(QQ:${sender.user_id})。`
                systemPromptWithContext += ` (角色: ${roleMap[sender.role] || '普通成员'}`
                if (sender.title) systemPromptWithContext += `, 群头衔: ${sender.title}`
                systemPromptWithContext += `)。\n`
            }
        }

        // 获取聊天历史
        let chats = []
        try {
            chats = await this.getChatHistoryGroup(group, contextLength)
        } catch (err) {
            logger.debug(`[ContextManager] 获取群聊历史失败: ${err.message}`)
        }

        // 格式化聊天历史
        if (chats && chats.length > 0) {
            systemPromptWithContext += `\n当你需要艾特(@)别人时，可以直接在回复中添加'@QQ'，其中QQ为你需要艾特(@)的人的QQ号，如'@123456'。以下是最近群内的聊天记录。请你仔细阅读这些记录，理解群内成员的对话内容和趋势，并以此为基础来生成你的回复。你的回复应该自然融入当前对话，就像一个真正的群成员一样：\n`
            
            const formattedChats = await Promise.all(
                chats.map(chat => this.formatChatMessage(group, chat))
            )
            systemPromptWithContext += formattedChats.join('\n')
        }

        // 缓存结果
        this.cacheGroupContext(groupId, { prompt: systemPromptWithContext })

        return systemPromptWithContext
    }

    /**
     * @param {Object} e - 事件对象
     * @param {Object} options - 选项
     * @param {boolean} options.includeChain - 是否获取引用链
     * @param {number} options.maxDepth - 引用链最大深度
     * @returns {Promise<{text: string, chain: Array}>} 引用消息文本和引用链
     */
    async getQuoteContent(e, options = {}) {
        const { includeChain = true, maxDepth = 3 } = options
        let quoteText = ''
        const chain = []

        if (!e.source && !e.reply_id) {
            const replyPart = e.message?.find(msg => msg.type === 'reply')
            if (!replyPart) {
                return { text: quoteText, chain }
            }
        }

        const bot = e.bot || global.Bot
        const getMessage = async (messageId, seq) => {
            try {
                if (bot?.getMsg && messageId) {
                    const msg = await bot.getMsg(messageId)
                    if (msg) return msg.data || msg
                }
                if (bot?.sendApi && messageId) {
                    const result = await bot.sendApi('get_msg', { message_id: messageId })
                    if (result) return result.data || result
                }
                if (e.group?.getChatHistory && (seq || messageId)) {
                    const history = await e.group.getChatHistory(seq || messageId, 1)
                    if (history?.[0]) return history[0]
                }
                if (e.getReply && typeof e.getReply === 'function') {
                    return await e.getReply()
                }
                if (bot?.pickGroup && e.group_id && seq) {
                    const group = bot.pickGroup(e.group_id)
                    if (group?.getMsg) {
                        return await group.getMsg(seq)
                    }
                }
            } catch (err) {
                logger.debug(`[ContextManager] 获取消息失败: ${err.message}`)
            }
            return null
        }

        /**
         * 检查消息是否包含引用
         */
        const getNestedReply = (msg) => {
            if (!msg) return null
            // 检查 source
            if (msg.source) {
                return { seq: msg.source.seq, message_id: msg.source.message_id }
            }
            // 检查消息段中的 reply
            const message = msg.message || msg
            if (Array.isArray(message)) {
                const replySeg = message.find(m => m.type === 'reply')
                if (replySeg) {
                    return { message_id: replySeg.id || replySeg.data?.id }
                }
            }
            return null
        }

        // 获取第一层引用消息
        const messageId = e.source?.message_id || e.reply_id
        const seq = e.source?.seq
        const replyPart = e.message?.find(msg => msg.type === 'reply')
        const replyMsgId = messageId || replyPart?.id || replyPart?.data?.id

        let originalMsg = await getMessage(replyMsgId, seq)
        if (!originalMsg && e.source) {
            if (e.source.message || e.source.raw_message) {
                originalMsg = e.source
            }
        }

        // 格式化引用内容
        if (originalMsg) {
            const originalSenderId = originalMsg.user_id || originalMsg.sender?.user_id
            let originalSenderName = originalMsg.sender?.card || originalMsg.sender?.nickname || originalSenderId || '未知用户'
            
            // 尝试获取更准确的昵称
            if (e.group?.pickMember && originalSenderId) {
                try {
                    const member = e.group.pickMember(originalSenderId)
                    const memberInfo = member?.info || await member?.getInfo?.(true)
                    if (memberInfo) {
                        originalSenderName = memberInfo.card || memberInfo.nickname || originalSenderName
                    }
                } catch {}
            }

            // 深度解析消息内容
            let originalContent = ''
            if (originalMsg.raw_message) {
                originalContent = originalMsg.raw_message
            } else if (originalMsg.message) {
                originalContent = this._extractMessageText(originalMsg.message, true)
            } else {
                // 尝试深度解析整个消息体
                originalContent = this._extractMessageText(originalMsg, true)
            }

            // 截断过长内容
            if (originalContent.length > 500) {
                originalContent = originalContent.substring(0, 500) + '...'
            }

            quoteText = ` 引用了${originalSenderName}(QQ:${originalSenderId})的消息"${originalContent}"`
            
            const originalSeq = originalMsg.seq || originalMsg.message_seq || originalMsg.message_id
            if (originalSeq) {
                quoteText += `(seq:${originalSeq})`
            }

            // 添加到引用链
            chain.push({
                depth: 0,
                user_id: String(originalSenderId || ''),
                nickname: originalSenderName,
                content: originalContent,
                message_id: originalMsg.message_id || replyMsgId
            })

            // 获取引用链（如果被引用的消息也引用了其他消息）
            if (includeChain) {
                let currentMsg = originalMsg
                let depth = 0
                
                while (depth < maxDepth) {
                    const nestedReply = getNestedReply(currentMsg)
                    if (!nestedReply) break
                    
                    const nestedMsg = await getMessage(nestedReply.message_id, nestedReply.seq)
                    if (!nestedMsg) break
                    
                    const nestedSenderId = nestedMsg.user_id || nestedMsg.sender?.user_id
                    const nestedSenderName = nestedMsg.sender?.card || nestedMsg.sender?.nickname || nestedSenderId || '未知'
                    let nestedContent = nestedMsg.raw_message || this._extractMessageText(nestedMsg.message || nestedMsg, true)
                    
                    if (nestedContent.length > 300) {
                        nestedContent = nestedContent.substring(0, 300) + '...'
                    }
                    
                    chain.push({
                        depth: depth + 1,
                        user_id: String(nestedSenderId || ''),
                        nickname: nestedSenderName,
                        content: nestedContent,
                        message_id: nestedMsg.message_id
                    })
                    
                    // 在引用文本中添加嵌套引用信息
                    if (depth === 0) {
                        quoteText += `\n  └ 该消息引用了${nestedSenderName}的消息"${nestedContent.substring(0, 100)}${nestedContent.length > 100 ? '...' : ''}"`
                    }
                    
                    currentMsg = nestedMsg
                    depth++
                }
            }
        }

        return { text: quoteText, chain }
    }
}

export const contextManager = new ContextManager()
