import ChatGPTStorage from '../storage.js'
import { ChaiteStorage } from 'chaite'

/**
 * @extends {ChaiteStorage<import('chaite').ToolDTO>}
 */
class LowDBToolSettingsStorage extends ChaiteStorage {
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
    this.collection = this.storage.collection('tools')
  }

  /**
   *
   * @param {string} key
   * @returns {Promise<import('chaite').ToolDTO>}
   */
  async getItem (key) {
    return this.collection.findOne({ id: key })
  }

  /**
   *
   * @param {string} id
   * @param {import('chaite').ToolDTO} tools
   * @returns {Promise<string>}
   */
  async setItem (id, tools) {
    if (id) {
      await this.collection.updateById(id, tools)
      return id
    }
    const result = await this.collection.insert(tools)
    return result.id
  }

  /**
   *
   * @param {string} key
   * @returns {Promise<void>}
   */
  async removeItem (key) {
    await this.collection.deleteById(key)
  }

  /**
   *
   * @returns {Promise<import('chaite').ToolDTO[]>}
   */
  async listItems () {
    return this.collection.findAll()
  }

  async clear () {
    await this.collection.deleteAll()
  }
}

export default new LowDBToolSettingsStorage()
