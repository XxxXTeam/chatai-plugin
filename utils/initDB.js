// initDB.js
// 插件初始化的基本数据库内容

import { BaseClientOptions, Chaite, Channel, ProcessorDTO, SendMessageOption } from 'chaite'
import fs from 'fs'
import path from 'path'
import { md5 } from './common.js'

/**
 * 默认系统用户
 * @type {import('chaite').User}
 */
const systemUser = {
  username: 'system',
  user_id: '00000'
}

/**
 * 注入内置的处理器
 * @param {string} resourcesDir
 * @param {import('chaite').ProcessorsManager} processorsManager
 * @param {'pre' | 'post'} type
 * @param {string} name
 * @param {string} description
 * @returns {Promise<void>}
 */
async function addEmbeddedProcessor (resourcesDir, processorsManager, type, name, description) {
  const codeBuf = fs.readFileSync(path.resolve(resourcesDir, name))
  let code = Buffer.from(codeBuf.toString(), 'base64').toString()
  await processorsManager.addInstance(new ProcessorDTO({
    id: md5(name),
    type,
    name,
    uploader: systemUser,
    description,
    code
  }))
}

export async function migrateDatabase () {
  logger.debug('检查数据库初始化...')
  const resourcesDir = path.resolve('./plugins/chatgpt-plugin', 'resources/embedded')
  // 1. 设置初始化的预处理器
  const processorsManager = Chaite.getInstance().getProcessorsManager()
  if (!await processorsManager.getInstance('BlackPostProcessor')) {
    logger.info('初始化内置的屏蔽词前置处理器')
    await addEmbeddedProcessor(resourcesDir, processorsManager, 'pre', 'BlackPostProcessor', '内置的屏蔽词前置处理器')
  }
  if (!await processorsManager.getInstance('BlackPreProcessor')) {
    logger.info('初始化内置的屏蔽词后置处理器')
    await addEmbeddedProcessor(resourcesDir, processorsManager, 'post', 'BlackPreProcessor', '内置的屏蔽词前置处理器')
  }
  // 2. 设置默认渠道
  const channelsManager = Chaite.getInstance().getChannelsManager()
  try {
    await channelsManager.getChannelByModel('Qwen/Qwen2.5-7B-Instruct')
  } catch (err) {
    if (err.message === 'No available channels') {
      await channelsManager.addInstance(new Channel({
        id: 'free',
        name: 'free',
        models: ['Qwen/Qwen2.5-7B-Instruct'],
        adapterType: 'openai',
        type: 'openai',
        weight: 1,
        priority: 0,
        status: 'enabled',
        options: new BaseClientOptions({
          features: ['tool', 'chat'],
          baseUrl: 'https://oneapi.ikechan8370.com/v1',
          apiKey: 'sk-uIzofH2TIMVu6giK56BeCeD5E98b42EbBe695597B5FeAc68',
          postProcessorIds: [md5('BlackPreProcessor'), md5('BlackPostProcessor')]
        }),
        uploader: systemUser
      }))
      logger.info('初始化内置的免费渠道')
    }
  }
  // 3. 设置默认预设
  let chatPresetManager = Chaite.getInstance().getChatPresetManager()
  if (!await chatPresetManager.getInstance('default_local')) {
    await chatPresetManager.addInstance({
      id: 'default_local',
      local: true,
      name: '默认预设',
      prefix: 'chaite',
      sendMessageOption: new SendMessageOption({
        model: 'Qwen/Qwen2.5-7B-Instruct',
        temperature: 0.8,
        maxToken: 4096,
        systemOverride: '你是Chaite，一个在QQ群聊中活跃的AI助手。你可以与群友进行聊天，提供帮助和解答问题。'
      }),
      uploader: systemUser
    })
    logger.info('初始化内置的默认预设')
  }

  // 4. 设置默认工具组
  let toolGroupsManager = Chaite.getInstance().getToolsGroupManager()
  if (!await toolGroupsManager.getInstance('default_local')) {
    await toolGroupsManager.addInstance({
      id: 'default_local',
      name: '默认工具组',
      description: '默认工具组仅用于占位，包括全部非禁用的工具',
      toolIds: [],
      status: 'enabled',
      isDefault: true,
      uploader: systemUser
    })
  }

  // 5. 扫描同步工具
  const toolManager = Chaite.getInstance().getToolsManager()

  logger.info('初始化内置的工具组')
  logger.debug('数据库初始化完成')
}
