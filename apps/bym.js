import ChatGPTConfig from '../config/config.js'
import { Chaite } from 'chaite'
import { intoUserMessage, toYunzai } from '../utils/message.js'
import common from '../../../lib/common/common.js'

export class bym extends plugin {
  constructor () {
    super({
      name: 'ChatGPT-Plugin伪人模式',
      dsc: 'ChatGPT-Plugin伪人模式',
      event: 'message',
      priority: -150,
      rule: [
        {
          reg: '^#chatgpt伪人模式$',
          fnc: 'bym'
        }
      ]
    })
  }

  async bym (e) {
    if (!ChatGPTConfig.bym.enable) {
      return false
    }
    let recall = false
    let presetId = ChatGPTConfig.bym.defaultPreset
    if (ChatGPTConfig.bym.presetMap && ChatGPTConfig.bym.presetMap.length > 0) {
      const option = ChatGPTConfig.bym.presetMap.sort((a, b) => a.priority - b.priority)
        .find(item => item.keywords.find(keyword => e.msg.includes(keyword)))
      if (option) {
        presetId = option.presetId
      }
      recall = !!option.recall
    }

    const presetManager = Chaite.getInstance().getChatPresetManager()
    let preset = await presetManager.getInstance(presetId)
    if (!preset) {
      preset = await presetManager.getInstance(ChatGPTConfig.bym.defaultPreset)
    }
    if (!preset) {
      logger.debug('未找到预设，请检查配置文件')
      return false
    }
    if (ChatGPTConfig.bym.presetPrefix) {
      if (!preset.sendMessageOption.systemOverride) {
        preset.sendMessageOption.systemOverride = ''
      }
      preset.sendMessageOption.systemOverride = ChatGPTConfig.bym.presetPrefix + preset.sendMessageOption.systemOverride
    }
    const userMessage = await intoUserMessage(e, {
      handleReplyText: true,
      handleReplyImage: true,
      useRawMessage: true,
      handleAtMsg: true,
      excludeAtBot: false,
      toggleMode: ChatGPTConfig.basic.toggleMode,
      togglePrefix: ChatGPTConfig.basic.togglePrefix
    })
    // 伪人不记录历史
    preset.sendMessageOption.disableHistoryRead = true
    preset.sendMessageOption.disableHistorySave = true
    // 设置多轮调用回掉
    preset.sendMessageOption.onMessageWithToolCall = async content => {
      const { msgs, forward } = await toYunzai(e, [content])
      if (msgs.length > 0) {
        await e.reply(msgs)
      }
      for (let forwardElement of forward) {
        this.reply(forwardElement)
      }
    }
    // 发送
    const response = await Chaite.getInstance().sendMessage(userMessage, e, {
      ...preset.sendMessageOption,
      chatPreset: preset
    })
    const { msgs, forward } = await toYunzai(e, response.contents)
    if (msgs.length > 0) {
      // await e.reply(msgs, false, { recallMsg: recall })
      for (let msg of msgs) {
        await e.reply(msg, false, { recallMsg: recall ? 10 : 0 })
        await common.sleep(Math.floor(Math.random() * 2000) + 1000)
      }
    }
    if (ChatGPTConfig.bym.sendReasoning) {
      for (let forwardElement of forward) {
        await e.reply(forwardElement, false, { recallMsg: recall ? 10 : 0 })
      }
    }
  }
}
