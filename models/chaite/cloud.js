import { DefaultToolCloudService, ToolManager } from 'chaite'
import ChatGPTConfig from '../../config/config.js'
import { createToolsSettingsStorage } from './tool_settings_storage.js'
const ChatGPTToolCloudService = new DefaultToolCloudService(ChatGPTConfig.cloudBaseUrl, '', {})
/**
 * @type {import('chaite').ToolManager}
 */
let ChatGPTToolManager
ToolManager.getInstance(ChatGPTConfig.toolsDirPath, createToolsSettingsStorage(), ChatGPTToolCloudService).then((manager) => {
  ChatGPTToolManager = manager
})

/**
 * 认证，以便共享上传
 * @param apiKey
 * @returns {Promise<import('chaite').User>}
 */
export async function authCloud (apiKey) {
  const user = await ChatGPTToolCloudService.authenticate(apiKey)
  ChatGPTToolManager.setCloudService(ChatGPTToolCloudService)
  return user
}

export default {
  ChatGPTToolCloudService,
  ChatGPTToolManager
}

