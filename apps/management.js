import ChatGPTConfig from '../config/config.js'
import { createCRUDCommandRules, createSwitchCommandRules } from '../utils/command.js'
import { Chaite } from 'chaite'
import * as crypto from 'node:crypto'

export class ChatGPTManagement extends plugin {
  constructor () {
    const cmdPrefix = ChatGPTConfig.basic.commandPrefix
    super({
      name: 'ChatGPT-Plugin管理',
      dsc: 'ChatGPT-Plugin管理',
      event: 'message',
      priority: 20,
      rule: [
        {
          reg: `^${cmdPrefix}管理面板$`,
          fnc: 'managementPanel',
          permission: 'master'
        },
        {
          reg: `^(${cmdPrefix})?#?结束(全部)?对话$`,
          fnc: 'destroyConversation'
        },
        {
          reg: `^${cmdPrefix}(bym|伪人)设置默认预设`,
          fnc: 'setDefaultBymPreset',
          permission: 'master'
        }
      ]
    })
    if (!Chaite.getInstance()) {
      const waitForChaite = async () => {
        while (!Chaite.getInstance()) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
        return Chaite.getInstance()
      }
      waitForChaite().then(() => {
        this.initCommand(cmdPrefix)
      })
    } else {
      this.initCommand(cmdPrefix)
    }
  }

  initCommand (cmdPrefix) {
    this.rule.push(...[
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '渠道', 'channels'),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '预设', 'presets'),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '工具', 'tools'),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '处理器', 'processors'),
      createSwitchCommandRules.bind(this)(cmdPrefix, '(预设切换|其他人切换预设)', 'customPreset', 1),
      createSwitchCommandRules.bind(this)(cmdPrefix, '(调试|debug)(模式)?', 'debug'),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '预设切换黑名单', 'customPresetUserBlackList', false),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '预设切换白名单', 'customPresetUserWhiteList', false),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '输入屏蔽词', 'promptBlockWords', false),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '输出屏蔽词', 'responseBlockWords', false),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '黑名单群', 'blackGroups', false),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '白名单群', 'whiteGroups', false),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '黑名单用户', 'blackUsers', false),
      ...createCRUDCommandRules.bind(this)(cmdPrefix, '白名单用户', 'whiteUsers', false),
      createSwitchCommandRules(cmdPrefix, '(伪人|bym)', 'bym')
    ])
  }

  managementPanel (e) {
    // todo
    // this.reply(`(todo)管理面板地址：http://${ChatGPTConfig.chaite.host}:${ChatGPTConfig.chaite.host}`)
    const token = Chaite.getInstance().getFrontendAuthHandler().generateToken(300)
    this.reply(`token: ${token}, 有效期300秒`, true)
  }

  async setDefaultBymPreset (e) {
    const presetId = e.msg.replace(`${ChatGPTConfig.basic.commandPrefix}伪人设置默认预设`, '')
    const preset = await Chaite.getInstance().getChatPresetManager().getInstance(presetId)
    if (preset) {
      ChatGPTConfig.bym.defaultPreset = presetId
      this.reply(`伪人模式默认预设已切换为${presetId}(${preset.name})`)
    } else {
      this.reply(`未找到预设${presetId}`)
    }
  }

  async destroyConversation (e) {
    if (e.msg.includes('全部')) {
      if (!e.isMaster) {
        this.reply('仅限主人使用')
        return false
      }
      const userStates = await Chaite.getInstance().getUserStateStorage().listItems()
      let num = 0
      for (const userState of userStates) {
        if (userState.current.conversationId && userState.current.messageId) {
          num++
          userState.current.conversationId = crypto.randomUUID()
          userState.current.messageId = ''
          await Chaite.getInstance().getUserStateStorage().setItem(userState.userId + '', userState)
        }
      }
      this.reply(`已结束${num}个用户的对话`)
    } else {
      const state = await Chaite.getInstance().getUserStateStorage().getItem(e.sender.user_id + '')
      if (!state || !state.current.conversationId || !state.current.messageId) {
        this.reply('当前未开启对话')
        return false
      }
      state.current.conversationId = crypto.randomUUID()
      state.current.messageId = ''
      await Chaite.getInstance().getUserStateStorage().setItem(e.sender.user_id + '', state)
      this.reply('已结束当前对话')
    }
  }
}
