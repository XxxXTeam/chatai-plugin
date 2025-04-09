import {
  Chaite,
  ChannelsManager,
  ChatPresetManager,
  DefaultChannelLoadBalancer,
  GeminiClient,
  OpenAIClient,
  ProcessorsManager,
  RAGManager,
  ToolManager,
  ToolsGroupManager
} from 'chaite'
import ChatGPTConfig from '../../config/config.js'
import { LowDBChannelStorage } from './storage/lowdb/channel_storage.js'
import { LowDBChatPresetsStorage } from './storage/lowdb/chat_preset_storage.js'
import { LowDBToolsStorage } from './storage/lowdb/tools_storage.js'
import { LowDBProcessorsStorage } from './storage/lowdb/processors_storage.js'
import { ChatGPTUserModeSelector } from './user_mode_selector.js'
import { LowDBUserStateStorage } from './storage/lowdb/user_state_storage.js'
import { LowDBHistoryManager } from './storage/lowdb/history_manager.js'
import { VectraVectorDatabase } from './vector_database.js'
import path from 'path'
import fs from 'fs'
import { migrateDatabase } from '../../utils/initDB.js'
import { SQLiteChannelStorage } from './storage/sqlite/channel_storage.js'
import { dataDir } from '../../utils/common.js'
import { SQLiteChatPresetStorage } from './storage/sqlite/chat_preset_storage.js'
import { SQLiteToolsStorage } from './storage/sqlite/tools_storage.js'
import { SQLiteProcessorsStorage } from './storage/sqlite/processors_storage.js'
import { SQLiteUserStateStorage } from './storage/sqlite/user_state_storage.js'
import { SQLiteToolsGroupStorage } from './storage/sqlite/tool_groups_storage.js'
import { checkMigrate } from './storage/sqlite/migrate.js'
import { SQLiteHistoryManager } from './storage/sqlite/history_manager.js'

/**
 * 认证，以便共享上传
 * @param apiKey
 * @returns {Promise<import('chaite').User | null>}
 */
export async function authCloud (apiKey = ChatGPTConfig.chaite.cloudApiKey) {
  try {
    await Chaite.getInstance().auth(apiKey)
    return Chaite.getInstance().getToolsManager().cloudService.getUser()
  } catch (err) {
    logger.error(err)
  }
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
      const result = await client.getEmbedding(text, {
        model,
        dimensions
      })
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
  const vectorDBPath = path.resolve('./plugins/chatgpt-plugin', ChatGPTConfig.chaite.dataDir, 'vector_index')
  if (!fs.existsSync(vectorDBPath)) {
    fs.mkdirSync(vectorDBPath, { recursive: true })
  }
  const vectorDB = new VectraVectorDatabase(vectorDBPath)
  await vectorDB.init()
  const ragManager = new RAGManager(vectorDB, vectorizer)
  return Chaite.getInstance().setRAGManager(ragManager)
}

export async function initChaite () {
  const storage = ChatGPTConfig.chaite.storage
  let channelsStorage, chatPresetsStorage, toolsStorage, processorsStorage, userStateStorage, historyStorage, toolsGroupStorage
  switch (storage) {
    case 'sqlite': {
      const dbPath = path.join(dataDir, 'data.db')
      channelsStorage = new SQLiteChannelStorage(dbPath)
      await channelsStorage.initialize()
      chatPresetsStorage = new SQLiteChatPresetStorage(dbPath)
      await chatPresetsStorage.initialize()
      toolsStorage = new SQLiteToolsStorage(dbPath)
      await toolsStorage.initialize()
      processorsStorage = new SQLiteProcessorsStorage(dbPath)
      await processorsStorage.initialize()
      userStateStorage = new SQLiteUserStateStorage(dbPath)
      await userStateStorage.initialize()
      toolsGroupStorage = new SQLiteToolsGroupStorage(dbPath)
      await toolsGroupStorage.initialize()
      historyStorage = new SQLiteHistoryManager(dbPath, path.join(dataDir, 'images'))
      await checkMigrate()
      break
    }
    case 'lowdb': {
      const ChatGPTStorage = (await import('storage/lowdb/storage.js')).default
      await ChatGPTStorage.init()
      channelsStorage = new LowDBChannelStorage(ChatGPTStorage)
      chatPresetsStorage = new LowDBChatPresetsStorage(ChatGPTStorage)
      toolsStorage = new LowDBToolsStorage(ChatGPTStorage)
      processorsStorage = new LowDBProcessorsStorage(ChatGPTStorage)
      userStateStorage = new LowDBUserStateStorage(ChatGPTStorage)
      const ChatGPTHistoryStorage = (await import('storage/lowdb/storage.js')).ChatGPTHistoryStorage
      await ChatGPTHistoryStorage.init()
      historyStorage = new LowDBHistoryManager(ChatGPTHistoryStorage)
      break
    }
  }
  const channelsManager = await ChannelsManager.init(channelsStorage, new DefaultChannelLoadBalancer())
  const toolsDir = path.resolve('./plugins/chatgpt-plugin', ChatGPTConfig.chaite.toolsDirPath)
  if (!fs.existsSync(toolsDir)) {
    fs.mkdirSync(toolsDir, { recursive: true })
  }
  const toolsManager = await ToolManager.init(toolsDir, toolsStorage)
  const processorsDir = path.resolve('./plugins/chatgpt-plugin', ChatGPTConfig.chaite.processorsDirPath)
  if (!fs.existsSync(processorsDir)) {
    fs.mkdirSync(processorsDir, { recursive: true })
  }
  const processorsManager = await ProcessorsManager.init(processorsDir, processorsStorage)
  const chatPresetManager = await ChatPresetManager.init(chatPresetsStorage)
  const toolsGroupManager = await ToolsGroupManager.init(toolsGroupStorage)
  const userModeSelector = new ChatGPTUserModeSelector()
  let chaite = Chaite.init(channelsManager, toolsManager, processorsManager, chatPresetManager, toolsGroupManager,
    userModeSelector, userStateStorage, historyStorage, logger)
  logger.info('Chaite 初始化完成')
  chaite.setCloudService(ChatGPTConfig.chaite.cloudBaseUrl)
  logger.info('Chaite.Cloud 初始化完成')
  await migrateDatabase()
  if (ChatGPTConfig.chaite.cloudApiKey) {
    const user = await authCloud(ChatGPTConfig.chaite.cloudApiKey)
    logger.info(`Chaite.Cloud 认证成功, 当前用户${user.username || user.email} (${user.user_id})`)
  }
  await initRagManager(ChatGPTConfig.llm.embeddingModel, ChatGPTConfig.llm.dimensions)
  if (!ChatGPTConfig.chaite.authKey) {
    ChatGPTConfig.chaite.authKey = Chaite.getInstance().getFrontendAuthHandler().generateToken(0, true)
  }
  chaite.getGlobalConfig().setAuthKey(ChatGPTConfig.chaite.authKey)
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
      if (typeof config[key] === 'object' && config[key] !== null && ChatGPTConfig[key]) {
        deepMerge(ChatGPTConfig[key], config[key])
      } else {
        ChatGPTConfig[key] = config[key]
      }
    })
    // 回传部分需要同步的配置，以防不一致
    chaite.getGlobalConfig().setDebug(ChatGPTConfig.basic.debug)
    chaite.getGlobalConfig().setAuthKey(ChatGPTConfig.chaite.authKey)
  })
  // 授予Chaite获取插件配置的能力以便通过api放出
  chaite.setGetConfig(async () => {
    return ChatGPTConfig
  })
  chaite.getGlobalConfig().setHost(ChatGPTConfig.chaite.host)
  chaite.getGlobalConfig().setPort(ChatGPTConfig.chaite.port)
  chaite.getGlobalConfig().setDebug(ChatGPTConfig.basic.debug)
  logger.info('Chaite.RAGManager 初始化完成')
  chaite.runApiServer()
}

function deepMerge (target, source) {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      if (typeof source[key] === 'object' && source[key] !== null && target[key]) {
        // 如果是对象且目标属性存在，递归合并
        deepMerge(target[key], source[key])
      } else {
        // 否则直接赋值
        target[key] = source[key]
      }
    }
  }
}
