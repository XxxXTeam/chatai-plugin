/**
 * @typedef {import('../types/adapter').HistoryManager} HistoryManager
 * @typedef {import('../types/models').HistoryMessage} HistoryMessage
 */

/**
 * 默认内存历史管理器
 * @implements {HistoryManager}
 */
import { databaseService } from '../../services/storage/DatabaseService.js'

/**
 * 默认持久化历史管理器
 * @implements {HistoryManager}
 */
class DefaultHistoryManager {
    constructor() {
        this.name = 'DefaultHistoryManager'
        // 使用默认路径初始化数据库，或者应该由主应用初始化
        // 为安全起见，如果未初始化，我们在这里尝试初始化
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

        // 查找消息并返回到该点为止的历史记录
        const index = history.findIndex(msg => msg.id === messageId)
        if (index === -1) {
            // 如果未找到messageId，返回完整历史（可能是刚保存的新消息）
            return history
        }

        return history.slice(0, index + 1)
    }

    /**
     * 修剪历史记录，只保留最后N条消息
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
