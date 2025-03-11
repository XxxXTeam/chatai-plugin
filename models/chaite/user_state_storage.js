import { ChaiteStorage } from 'chaite'

/**
 * @extends {ChaiteStorage<import('chaite').UserState>}
 */
export class LowDBUserStateStorage extends ChaiteStorage {
  /**
   *
   * @param {LowDBStorage} storage
   */
  constructor (storage) {
    super()
    this.storage = storage
    /**
     * 集合
     * @type {LowDBCollection}
     */
    this.collection = this.storage.collection('user_states')
  }

  /**
   *
   * @param {string} key
   * @returns {Promise<import('chaite').UserState>}
   */
  async getItem (key) {
    return this.collection.findOne({ id: key })
  }

  /**
   *
   * @param {string} id
   * @param {import('chaite').UserState} state
   * @returns {Promise<string>}
   */
  async setItem (id, state) {
    if (id) {
      await this.collection.updateById(id, state)
      return id
    }
    const result = await this.collection.insert(state)
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
   * @returns {Promise<import('chaite').UserState[]>}
   */
  async listItems () {
    return this.collection.findAll()
  }

  async clear () {
    await this.collection.deleteAll()
  }
}
