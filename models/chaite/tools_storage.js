import { ChaiteStorage, ToolDTO } from 'chaite'

/**
 * @extends {ChaiteStorage<import('chaite').ToolDTO>}
 */
export class LowDBToolsStorage extends ChaiteStorage {
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
    this.collection = this.storage.collection('tools')
  }

  /**
   *
   * @param {string} key
   * @returns {Promise<import('chaite').ToolDTO>}
   */
  async getItem (key) {
    const obj = await this.collection.findOne({ id: key })
    return new ToolDTO({}).fromString(JSON.stringify(obj))
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
    const list = await this.collection.findAll()
    return list.map(item => new ToolDTO({}).fromString(JSON.stringify(item)))
  }

  async clear () {
    await this.collection.deleteAll()
  }
}
