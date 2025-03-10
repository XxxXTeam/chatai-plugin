import ChatGPTStorage from '../storage.js'
import { ChaiteStorage } from 'chaite'

class LowDBChannelStorage extends ChaiteStorage {
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
    this.collection = this.storage.collection('channel')
  }

  /**
   *
   * @param {string} key
   * @returns {Promise<import('chaite').Channel>}
   */
  async getItem (key) {
    return this.collection.findOne({ id: key })
  }

  /**
   *
   * @param {string} id
   * @param {import('chaite').Channel} channel
   * @returns {Promise<string>}
   */
  async setItem (id, channel) {
    if (id) {
      await this.collection.updateById(id, channel)
      return id
    }
    const result = await this.collection.insert(channel)
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
   * @returns {Promise<import('chaite').Channel[]>}
   */
  async listItems () {
    return this.collection.findAll()
  }

  async clear () {
    await this.collection.deleteAll()
  }
}

export default new LowDBChannelStorage()
