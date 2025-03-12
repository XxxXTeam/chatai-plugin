import Config from '../config/config.js'
import { Chaite, SendMessageOption } from 'chaite'
export class Chat extends plugin {
  constructor () {
    let toggleMode = Config.basic.toggleMode
    let prefix = Config.basic.togglePrefix
    super({
      name: 'ChatGPT-Plugin对话',
      dsc: 'ChatGPT-Plugin对话',
      event: 'message',
      priority: 0,
      rule: [
        {
          reg: toggleMode === 'at' ? '^[^#][sS]*' : `^#?(图片)?${prefix}[^gpt][sS]*`,
          fnc: 'chat'
        }
      ]
    })
  }

  async chat (e) {

    const state = await Chaite.getInstance().getUserStateStorage().getItem(e.sender.user_id + '')
    const userSettings = state.settings
    const sendMessageOptions = SendMessageOption.create({
      model: userSettings.model,
      temperature: userSettings.temperature,
      max_tokens: userSettings.maxToken,
      systemOverride: userSettings.systemOverride,

    })
    Chaite.getInstance().sendMessage(msg, e, )
  }
}
