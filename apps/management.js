import ChatGPTConfig from '../config/config.js'
import { createCRUDCommandRules, createSwitchCommandRules } from '../utils/command.js'

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
          reg: `^${cmdPrefix}结束(全部)?对话$`,
          fnc: 'destroyConversation'
        },
        ...createCRUDCommandRules(cmdPrefix, '渠道', 'channels'),
        ...createCRUDCommandRules(cmdPrefix, '预设', 'presets'),
        ...createCRUDCommandRules(cmdPrefix, '工具', 'tools'),
        ...createCRUDCommandRules(cmdPrefix, '处理器', 'processors'),
        createSwitchCommandRules(cmdPrefix, '(预设切换|其他人切换预设)', 'customPreset', 1),
        createSwitchCommandRules(cmdPrefix, '(调试|debug)(模式)?', 'debug'),
        ...createCRUDCommandRules(cmdPrefix, '预设切换黑名单', 'blackCustomPreset', false),
        ...createCRUDCommandRules(cmdPrefix, '预设切换白名单', 'whiteCustomPreset', false),
        ...createCRUDCommandRules(cmdPrefix, '输入屏蔽词', 'blackPromptWords', false),
        ...createCRUDCommandRules(cmdPrefix, '输出屏蔽词', 'blackResponseWords', false),
        ...createCRUDCommandRules(cmdPrefix, '黑名单群', 'blackGroups', false),
        ...createCRUDCommandRules(cmdPrefix, '白名单群', 'whiteGroups', false),
        ...createCRUDCommandRules(cmdPrefix, '黑名单用户', 'blackUsers', false),
        ...createCRUDCommandRules(cmdPrefix, '白名单用户', 'whiteUsers', false)
      ]
    })
  }
}
