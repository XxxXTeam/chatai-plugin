import { ChaiteStorage, TriggerDTO } from 'chaite'

/**
 * @extends {ChaiteStorage<import('chaite').TriggerDTO>}
 */
export class LowDBTriggerStorage extends ChaiteStorage {
  getName () {
    return 'LowDBTriggerStorage'
  }

  /**
   * @param {LowDBStorage} storage
   */
  constructor (storage) {
    super()
    this.storage = storage
    /**
     * 集合
     * @type {LowDBCollection}
     */
    this.collection = this.storage.collection('triggers')
  }

  /**
   * 获取单个触发器
   * @param {string} key
   * @returns {Promise<import('chaite').TriggerDTO>}
   */
  async getItem (key) {
    const obj = await this.collection.findOne({ id: key })
    if (!obj) {
      return null
    }
    return new TriggerDTO(obj)
  }

  /**
   * 保存触发器
   * @param {string} id
   * @param {import('chaite').TriggerDTO} trigger
   * @returns {Promise<string>}
   */
  async setItem (id, trigger) {
    // 设置或更新时间戳
    if (!trigger.createdAt) {
      trigger.createdAt = new Date().toISOString()
    }
    trigger.updatedAt = new Date().toISOString()

    if (id && await this.getItem(id)) {
      await this.collection.updateById(id, trigger)
      return id
    }
    const result = await this.collection.insert(trigger)
    return result.id
  }

  /**
   * 删除触发器
   * @param {string} key
   * @returns {Promise<void>}
   */
  async removeItem (key) {
    await this.collection.deleteById(key)
  }

  /**
   * 获取所有触发器
   * @returns {Promise<import('chaite').TriggerDTO[]>}
   */
  async listItems () {
    const list = await this.collection.findAll()
    return list.map(item => new TriggerDTO({}).fromString(JSON.stringify(item)))
  }

  /**
   * 根据条件筛选触发器
   * @param {Record<string, unknown>} filter
   * @returns {Promise<import('chaite').TriggerDTO[]>}
   */
  async listItemsByEqFilter (filter) {
    const allList = await this.listItems()
    return allList.filter(item => {
      for (const key in filter) {
        if (item[key] !== filter[key]) {
          return false
        }
      }
      return true
    })
  }

  /**
   * 根据IN条件筛选触发器
   * @param {Array<{
   *         field: string;
   *         values: unknown[];
   *     }>} query
   * @returns {Promise<import('chaite').TriggerDTO[]>}
   */
  async listItemsByInQuery (query) {
    const allList = await this.listItems()
    return allList.filter(item => {
      for (const { field, values } of query) {
        if (!values.includes(item[field])) {
          return false
        }
      }
      return true
    })
  }

  /**
   * 清空所有触发器
   * @returns {Promise<void>}
   */
  async clear () {
    await this.collection.deleteAll()
  }
}

export default LowDBTriggerStorage
