/**
 * @typedef {import('../types/adapter').HistoryManager} HistoryManager
 * @typedef {import('../types/models').HistoryMessage} HistoryMessage
 */

/**
 * Default in-memory history manager
 * @implements {HistoryManager}
 */
import { databaseService } from '../../services/DatabaseService.js'

/**
 * Default persistent history manager
 * @implements {HistoryManager}
 */
class DefaultHistoryManager {
    constructor() {
        this.name = 'DefaultHistoryManager'
        // Initialize DB with default path, or it should be initialized by the main app
        // For safety, we try to init here if not already
        databaseService.init()
    }

    /**
     * @param {HistoryMessage} message
     * @param {string} conversationId
     */
    async saveHistory(message, conversationId) {
        databaseService.saveMessage(conversationId, message)
    }

    /**
     * @param {string} [messageId]
     * @param {string} [conversationId]
     * @returns {Promise<HistoryMessage[]>}
     */
    async getHistory(messageId, conversationId) {
        if (!conversationId) {
            return []
        }

        const history = databaseService.getMessages(conversationId, 100) // Default limit 100

        if (!messageId) {
            return history
        }

        // Find the message and return history up to that point
        // Note: messageId matching might be tricky if we don't store original IDs or if they are generated.
        // The current implementation assumes message objects have IDs.
        // DatabaseService stores content as JSON, so if ID is in content/metadata, we need to check.
        // But the previous implementation assumed 'msg.id'.
        // Let's assume the message object passed to saveHistory had an ID and it's preserved in the JSON content or we need to look at DB ID.
        // For now, let's filter the returned array.

        const index = history.findIndex(msg => msg.id === messageId)
        if (index === -1) {
            return []
        }

        return history.slice(0, index + 1)
    }

    /**
     * Trim history to keep only the last N messages
     * @param {string} conversationId
     * @param {number} maxMessages
     */
    async trimHistory(conversationId, maxMessages) {
        databaseService.trimMessages(conversationId, maxMessages)
    }

    /**
     * @param {string} conversationId
     */
    async deleteConversation(conversationId) {
        databaseService.deleteConversation(conversationId)
    }

    /**
     * @param {string} messageId
     * @param {string} conversationId
     * @returns {Promise<HistoryMessage | undefined>}
     */
    async getOneHistory(messageId, conversationId) {
        const history = await this.getHistory(undefined, conversationId)
        return history.find(msg => msg.id === messageId)
    }
}

export default new DefaultHistoryManager()
