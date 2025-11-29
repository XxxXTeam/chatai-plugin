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
        const index = history.findIndex(msg => msg.id === messageId)
        if (index === -1) {
            // If messageId not found, return full history (might be a new message just saved)
            return history
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
