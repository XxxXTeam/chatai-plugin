import ChatGPTStorage from '../storage.js'

/**
 * @returns {import('chaite').ChannelsStorage}
 */
export async function createChannelsStorage () {
  return new LowDBChannelStorage(ChatGPTStorage)
}

class LowDBChannelStorage {
  /**
   *
   * @param { LowDBStorage } storage
   */
  constructor (storage) {
    this.storage = storage
    /**
     * 集合
     * @type {LowDBCollection}
     */
    this.collection = this.storage.collection('channel')
  }

  async saveChannel (channel) {
    await this.collection.insert(channel)
  }

  async getChannel (id) {
    return this.collection.collection()
  }

  /**
   *
   * @param name
   * @returns {Promise<import('chaite').Channel[]>}
   */
  async getChannelByName (name) {
    return this.collection.find({ name })
  }

  async deleteChannel (name) {
    await this.collection.delete({ name })
  }

  /**
   * 获取所有渠道
   * @param {string?} model
   * @returns {Promise<import('chaite').Channel[]>}
   */
  async getAllChannels (model) {
    if (model) {
      return this.collection.find({ 'options.model': model })
    }
    return this.collection.findAll()
  }

  /**
   *
   * @param {import('chaite').ClientType} type
   * @returns {Promise<Object[]>}
   */
  async getChannelByType (type) {
    return this.collection.find({ type })
  }

  /**
   *
   * @param {'enabled' | 'disabled'} status
   * @returns {Promise<*>}
   */
  async getChannelByStatus (status) {
    return this.collection.find({ status })
  }
}
