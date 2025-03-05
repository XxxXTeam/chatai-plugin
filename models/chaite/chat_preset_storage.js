import ChatGPTStorage from '../storage.js'

/**
 * @returns {import('chaite').ChatPresetsStorage}
 */
export async function createChatPresetsStorage () {
  return new LowDBChatPresetsStorage(ChatGPTStorage)
}

class LowDBChatPresetsStorage {
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
    this.collection = this.storage.collection('chat_presets')
  }

  /**
   *
   * @param {import('chaite').ChatPreset} preset
   * @returns {Promise<void>}
   */
  async savePreset (preset) {
    await this.collection.insert(preset)
  }

  /**
   *
   * @param { string } name
   * @returns {Promise<import('chaite').ChatPreset | null>}
   */
  async getPreset (name) {
    return this.collection.findOne({ name })
  }

  /**
   *
   * @returns {Promise<import('chaite').ChatPreset[]>}
   */
  async getAllPresets () {
    return this.collection.findAll()
  }

  async deletePreset (name) {
    await this.collection.delete({ name })
  }
}
