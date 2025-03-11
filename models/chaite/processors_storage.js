import { ChaiteStorage } from 'chaite'

/**
 * @extends {ChaiteStorage<import('chaite').Processor>}
 */
export class LowDBProcessorsStorage extends ChaiteStorage {
  /**
   *
   * @param { LowDBStorage } storage
   */
  constructor (storage) {
    super()
    this.storage = storage
    /**
     * 集合
     * @type {LowDBCollection}
     */
    this.collection = this.storage.collection('processors')
  }

  /**
   *
   * @param {string} key
   * @returns {Promise<import('chaite').Processor>}
   */
  async getItem (key) {
    return this.collection.findOne({ id: key })
  }

  /**
   *
   * @param {string} id
   * @param {import('chaite').Processor} processor
   * @returns {Promise<string>}
   */
  async setItem (id, processor) {
    if (id) {
      await this.collection.updateById(id, processor)
      return id
    }
    const result = await this.collection.insert(processor)
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
   * @returns {Promise<import('chaite').Processor[]>}
   */
  async listItems () {
    return this.collection.findAll()
  }

  async clear () {
    await this.collection.deleteAll()
  }
}
