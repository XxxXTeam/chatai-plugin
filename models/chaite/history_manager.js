import { AbstractHistoryManager } from 'chaite'
import ChatGPTStorage from '../storage.js'

export class LowDBHistoryManager extends AbstractHistoryManager {
  /**
   *
   * @param { LowDBStorage } storage
   */
  constructor (storage = ChatGPTStorage) {
    super()
    this.storage = storage
    /**
     * 集合
     * @type {LowDBCollection}
     */
    this.collection = this.storage.collection('history')
  }

  async saveHistory (message, conversationId) {
    const historyObj = { ...message, conversationId }
    if (message.id) {
      await this.collection.updateById(message.id, historyObj)
    }
    await this.collection.insert(historyObj)
  }

  /**
   *
   * @param messageId
   * @param conversationId
   * @returns {Promise<import('chaite').HistoryMessage[]>}
   */
  async getHistory (messageId, conversationId) {
    if (messageId) {
      const messages = []
      let currentId = messageId
      while (currentId) {
        const message = await this.collection.findOne({ id: currentId })
        if (!message) break
        messages.unshift(message)
        currentId = message.parentMessageId
      }
      return messages
    } else if (conversationId) {
      return this.collection.find({ conversationId })
    }
    return this.collection.findAll()
  }

  async deleteConversation (conversationId) {
    await this.collection.delete({ conversationId })
  }

  async getOneHistory (messageId, conversationId) {
    return this.collection.findOne({ id: messageId, conversationId })
  }
}
