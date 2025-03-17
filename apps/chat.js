import Config from '../config/config.js'
import { Chaite, SendMessageOption } from 'chaite'
import { getPreset, intoUserMessage, toYunzai } from '../utils/message.js'

export class Chat extends plugin {
  constructor () {
    super({
      name: 'ChatGPT-Plugin对话',
      dsc: 'ChatGPT-Plugin对话',
      event: 'message',
      priority: 0,
      rule: [
        {
          reg: '^[^#][sS]*',
          fnc: 'chat',
          log: false
        }
      ]
    })
  }

  async chat (e) {
    const state = await Chaite.getInstance().getUserStateStorage().getItem(e.sender.user_id + '')
    const sendMessageOptions = SendMessageOption.create(state?.settings)
    sendMessageOptions.onMessageWithToolCall = async content => {
      const { msgs, forward } = await toYunzai(e, [content])
      if (msgs.length > 0) {
        await e.reply(msgs)
      }
      for (let forwardElement of forward) {
        this.reply(forwardElement)
      }
    }
    const preset = await getPreset(e, state?.settings.preset || Config.llm.defaultChatPresetId, Config.basic.toggleMode, Config.basic.togglePrefix)
    if (!preset) {
      logger.debug('不满足对话触发条件或未找到预设，不进入对话')
      return false
    }
    const userMessage = await intoUserMessage(e, {
      handleReplyText: false,
      handleReplyImage: true,
      useRawMessage: false,
      handleAtMsg: true,
      excludeAtBot: false,
      toggleMode: Config.basic.toggleMode,
      togglePrefix: Config.basic.togglePrefix
    })
    const response = await Chaite.getInstance().sendMessage(userMessage, e, {
      ...sendMessageOptions,
      chatPreset: preset
    })
    const { msgs, forward } = await toYunzai(e, response.contents)
    if (msgs.length > 0) {
      await e.reply(msgs, true)
    }
    for (let forwardElement of forward) {
      this.reply(forwardElement)
    }
  }
}
