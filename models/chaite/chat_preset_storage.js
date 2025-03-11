import { ChaiteStorage } from 'chaite'

/**
 * @extends {ChaiteStorage<import('chaite').ChatPreset>}
 */
export class LowDBChatPresetsStorage extends ChaiteStorage {
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
    this.collection = this.storage.collection('chat_presets')
  }

  /**
   *
   * @param key
   * @returns {Promise<import('chaite').ChatPreset>}
   */
  async getItem (key) {

  }

  /**
   *
   * @param {string} id
   * @param {import('chaite').ChatPreset} preset
   * @returns {Promise<string>}
   */
  async setItem (id, preset) {
    if (id) {
      await this.collection.updateById(id, preset)
      return id
    }
    const result = await this.collection.insert(preset)
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
   * @returns {Promise<import('chaite').ChatPreset[]>}
   */
  async listItems () {
    return this.collection.findAll()
  }

  async clear () {
    await this.collection.deleteAll()
  }
}
