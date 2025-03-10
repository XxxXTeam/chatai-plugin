import { Chaite, ChannelsManager, ChatPresetManager, DefaultChannelLoadBalancer, GeminiClient, OpenAIClient, ProcessorsManager, RAGManager, ToolManager } from 'chaite'
import ChatGPTConfig from '../../config/config.js'
import ChatGPTChannelStorage from './channel_storage.js'
import ChatPresetStorage from './chat_preset_storage.js'
import ChatGPTToolStorage from './tools_storage.js'
import ChatGPTProcessorsStorage from './processors_storage.js'
import { ChatGPTUserModeSelector } from './user_mode_selector.js'
import { LowDBUserStateStorage } from './user_state_storage.js'
import { LowDBHistoryManager } from './history_manager.js'
import { ChatGPTVectorDatabase } from './vector_database.js'

/**
 * 认证，以便共享上传
 * @param apiKey
 * @returns {Promise<import('chaite').User> | null}
 */
export async function authCloud (apiKey = ChatGPTConfig.cloudApiKey) {
  await Chaite.getInstance().auth(apiKey)
  return Chaite.getInstance().getToolsManager().cloudService.getUser()
}

/**
 *
 * @param {import('chaite').Channel} channel
 * @returns {Promise<import('chaite').IClient>}
 */
async function getIClientByChannel (channel) {
  await channel.ready()
  switch (channel.adapterType) {
    case 'openai': {
      return new OpenAIClient(channel.options)
    }
    case 'gemini': {
      return new GeminiClient(channel.options)
    }
    case 'claude': {
      throw new Error('claude doesn\'t support embedding')
    }
  }
}

/**
 * 初始化RAG管理器
 * @param {string} model
 * @param {number} dimensions
 */
export async function initRagManager (model, dimensions) {
  const vectorizer = new class {
    async textToVector (text) {
      const channels = await Chaite.getInstance().getChannelsManager().getChannelByModel(model)
      if (channels.length === 0) {
        throw new Error('No channel found for model: ' + model)
      }
      const channel = channels[0]
      const client = await getIClientByChannel(channel)
      const result = await client.getEmbedding(text)
      return result.embeddings[0]
    }

    /**
     *
     * @param {string[]} texts
     * @returns {Promise<Array<number>[]>}
     */
    async batchTextToVector (texts) {
      const availableChannels = (await Chaite.getInstance().getChannelsManager().getAllChannels()).filter(c => c.models.includes(model))
      if (availableChannels.length === 0) {
        throw new Error('No channel found for model: ' + model)
      }
      const channels = await Chaite.getInstance().getChannelsManager().getChannelsByModel(model, texts.length)
      /**
       * @type {import('chaite').IClient[]}
       */
      const clients = await Promise.all(channels.map(({ channel }) => getIClientByChannel(channel)))
      const results = []
      let startIndex = 0
      for (let i = 0; i < channels.length; i++) {
        const { quantity } = channels[i]
        const textsSlice = texts.slice(startIndex, startIndex + quantity)
        const embeddings = await clients[i].getEmbedding(textsSlice, {
          model,
          dimensions
        })
        results.push(...embeddings.embeddings)
        startIndex += quantity
      }
      return results
    }
  }()
  const ragManager = new RAGManager(ChatGPTVectorDatabase, vectorizer)
  return Chaite.getInstance().setRAGManager(ragManager)
}

export async function initChaite () {
  const channelsManager = await ChannelsManager.init(ChatGPTChannelStorage, new DefaultChannelLoadBalancer())
  const toolsManager = await ToolManager.init(ChatGPTConfig.toolsDirPath, ChatGPTToolStorage)
  const processorsManager = await ProcessorsManager.init(ChatGPTConfig.processorsDirPath, ChatGPTProcessorsStorage)
  const chatPresetManager = await ChatPresetManager.init(ChatPresetStorage)
  const userModeSelector = new ChatGPTUserModeSelector()
  const userStateStorage = new LowDBUserStateStorage()
  const historyManager = new LowDBHistoryManager()
  let chaite = Chaite.init(channelsManager, toolsManager, processorsManager, chatPresetManager,
    userModeSelector, userStateStorage, historyManager, logger)
  logger.info('Chaite 初始化完成')
  chaite.setCloudService(ChatGPTConfig.cloudBaseUrl)
  logger.info('Chaite.Cloud 初始化完成')
  ChatGPTConfig.cloudApiKey && await chaite.auth(ChatGPTConfig.cloudApiKey)
  await initRagManager(ChatGPTConfig.embeddingModel, ChatGPTConfig.dimensions)
  // 监听Chaite配置变化，同步需要同步的配置
  chaite.on('config-change', obj => {
    const { key, newVal, oldVal } = obj
    if (key === 'authKey') {
      ChatGPTConfig.serverAuthKey = newVal
    }
    logger.debug(`Chaite config changed: ${key} from ${oldVal} to ${newVal}`)
  })
  // 监听通过chaite对插件配置修改
  chaite.setUpdateConfigCallback(config => {
    logger.debug('chatgpt-plugin config updated')
    Object.keys(config).forEach(key => {
      ChatGPTConfig[key] = config[key]
      // 回传部分需要同步的配置，以防不一致
      if (key === 'serverAuthKey') {
        chaite.getGlobalConfig().setAuthKey(config[key])
      }
    })
  })
  // 授予Chaite获取插件配置的能力以便通过api放出
  chaite.setGetConfig(async () => {
    return ChatGPTConfig
  })
  logger.info('Chaite.RAGManager 初始化完成')
}
