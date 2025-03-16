import { ChaiteStorage, Channel } from 'chaite'

export class LowDBChannelStorage extends ChaiteStorage {
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
    this.collection = this.storage.collection('channel')
  }

  /**
   *
   * @param {string} key
   * @returns {Promise<import('chaite').Channel>}
   */
  async getItem (key) {
    const obj = await this.collection.findOne({ id: key })
    return new Channel({}).fromString(JSON.stringify(obj))
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
    const list = await this.collection.findAll()
    return list.map(item => new Channel({}).fromString(JSON.stringify(item)))
  }

  async clear () {
    await this.collection.deleteAll()
  }
}
