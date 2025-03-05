import ChatGPTStorage from '../storage.js'

/**
 * @returns {import('chaite').ToolSettingsStorage}
 */
export function createToolsSettingsStorage () {
  return new LowDBToolsSettingsStorage(ChatGPTStorage)
}

class LowDBToolsSettingsStorage {
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
    this.collection = this.storage.collection('tool_settings')
  }

  /**
   *
   * @param {import('chaite').ToolSettings} settings
   * @returns {Promise<void>}
   */
  async saveToolSettings (settings) {
    await this.collection.insert(settings)
  }

  /**
   *
   * @param { string } name
   * @returns {Promise<import('chaite').ToolSettings | null>}
   */
  async getToolSettings (name) {
    return this.collection.findOne({ name })
  }

  /**
   *
   * @returns {Promise<import('chaite').ToolSettings[]>}
   */
  async getAllToolSettings () {
    return this.collection.findAll()
  }

  async deleteToolSettings (name) {
    await this.collection.delete({ name })
  }
}
