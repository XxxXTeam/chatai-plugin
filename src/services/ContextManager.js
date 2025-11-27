import { redisClient } from '../core/cache/RedisClient.js'
import config from '../../config/config.js'
import historyManager from '../core/utils/history.js'

/**
 * Context Manager - Manages user contexts and conversation isolation
 */
export class ContextManager {
    constructor() {
        this.locks = new Map()
        this.initialized = false
    }

    /**
     * Initialize context manager
     */
    async init() {
        if (this.initialized) return
        await redisClient.init()
        this.initialized = true
        logger.info('[ContextManager] Initialized')
    }

    /**
     * Get context lock for a user
     * @param {string} userId
     * @returns {boolean} True if lock acquired
     */
    async acquireLock(userId) {
        if (this.locks.get(userId)) {
            return false
        }
        this.locks.set(userId, true)
        return true
    }

    /**
     * Release context lock
     * @param {string} userId
     */
    releaseLock(userId) {
        this.locks.delete(userId)
    }

    /**
     * Get conversation ID for a user
     * @param {string} userId
     * @param {string} [groupId] Optional group ID for group chats
     * @returns {string} Conversation ID
     */
    getConversationId(userId, groupId = null) {
        // If it's a group chat, we might want a shared context or per-user context in group
        // For now, let's assume per-user isolation even in groups, or group-wide context
        // The requirement is "user isolation", so we prioritize userId.

        // Format: "user:<userId>" or "group:<groupId>:user:<userId>"
        if (groupId) {
            return `group:${groupId}:user:${userId}`
        }
        return `user:${userId}`
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
     * @param {string} conversationId
     */
    /**
     * Clean context based on strategy
     * @param {string} conversationId
     */
    async cleanContext(conversationId) {
        const maxMessages = config.get('context.maxMessages') || 20
        const strategy = config.get('context.cleaningStrategy') || 'truncate'

        const history = await historyManager.getHistory(undefined, conversationId)

        if (history.length > maxMessages) {
            if (strategy === 'summary') {
                try {
                    // Dynamically import to avoid potential circular deps if any
                    const { LlmService } = await import('./LlmService.js')

                    // Messages to summarize (all except last N/2)
                    const keepCount = Math.floor(maxMessages / 2)
                    const messagesToSummarize = history.slice(0, history.length - keepCount)
                    const messagesToKeep = history.slice(history.length - keepCount)

                    if (messagesToSummarize.length < 2) return // Too few to summarize

                    // Create summarization client
                    const client = await LlmService.createClient({ enableTools: false })

                    const summaryPrompt = `Please summarize the following conversation history into a concise paragraph, retaining key facts and context:\n\n${JSON.stringify(messagesToSummarize)}`

                    const response = await client.sendMessage(
                        { role: 'user', content: summaryPrompt },
                        { model: 'gpt-4o-mini', systemOverride: 'You are a helpful assistant that summarizes conversations.' }
                    )

                    const summaryText = response.contents
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('')

                    if (summaryText) {
                        const newHistory = [
                            { role: 'system', content: `Previous conversation summary: ${summaryText}` },
                            ...messagesToKeep
                        ]

                        // We need a way to replace history. 
                        // HistoryManager currently only has trimHistory (which truncates from start).
                        // We need 'replaceHistory' or similar.
                        // Let's assume we can overwrite it using delete + save loop or add a method.
                        // Since we are in deep optimization, let's add `setHistory` to HistoryManager or just use delete+save loop for now.

                        await historyManager.deleteConversation(conversationId)
                        for (const msg of newHistory) {
                            await historyManager.saveHistory(msg, conversationId)
                        }
                        return
                    }
                } catch (error) {
                    logger.error('[ContextManager] Summarization failed, falling back to truncate', error)
                }
            }

            // Fallback or default: Truncate
            await historyManager.trimHistory(conversationId, maxMessages)
        }
    }
}

export const contextManager = new ContextManager()
