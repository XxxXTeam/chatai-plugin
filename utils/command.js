import { Chaite } from 'chaite'
import common from '../../../lib/common/common.js'
import ChatGPTConfig from '../config/config.js'
/**
 * 模板
 * @param cmdPrefix
 * @param name
 * @param variable
 * @param detail
 * @returns {{reg: string, fnc: string}[]}
 */
export function createCRUDCommandRules (cmdPrefix, name, variable, detail = true) {
  // make the first letter of variable capable
  const upperVariable = variable.charAt(0).toUpperCase() + variable.slice(1)
  const rules = [
    {
      reg: cmdPrefix + `${name}列表$`,
      fnc: `list${upperVariable}`
    },
    {
      reg: cmdPrefix + `(编辑|修改)${name}`,
      fnc: `edit${upperVariable}`
    },
    {
      reg: cmdPrefix + `(添加|新增)${name}$`,
      fnc: `add${upperVariable}`
    },
    {
      reg: cmdPrefix + `删除${name}`,
      fnc: `remove${upperVariable}`
    }
  ]
  const manager = getManagerByName(upperVariable)
  if (detail) {
    rules.push({
      reg: cmdPrefix + `${name}详情$`,
      fnc: `detail${upperVariable}`
    })
    this[`detail${upperVariable}`] = async function (e) {
      const verbose = !e.isGroup
      const id = e.msg.replace(new RegExp(cmdPrefix + `${name}详情`), '')
      const instance = await manager.getInstance(id)
      if (instance) {
        e.reply(instance.toFormatedString(verbose))
      } else {
        e.reply(`${name}不存在`)
      }
    }
  }
  // todo
  // 定义对应的函数
  this[`list${upperVariable}`] = async function (e) {
    const verbose = !e.isGroup
    if (manager) {
      const instances = await manager.listInstances()
      if (instances.length === 0) {
        e.reply(`暂无${name}`)
        return true
      }
      const msgs = instances.map(i => {
        return i.toFormatedString(verbose)
      })
      const forwardedMsg = await common.makeForwardMsg(e, msgs, `${name}列表`)
      this.reply(forwardedMsg)
    }
  }
  this[`edit${upperVariable}`] = async function (e) {
    this.reply(`暂不支持编辑${name}，请使用后台管理面板编辑`)
  }
  this[`add${upperVariable}`] = async function (e) {
    if (manager) {
      this.reply(`暂不支持添加${name}，请使用后台管理面板添加`)
    } else {
      if (variable in ChatGPTConfig.llm) {
        /** @type {string[]} */
        const list = ChatGPTConfig.llm[variable]
        const id = e.msg.replace(new RegExp(cmdPrefix + `(添加|新增)${name}`), '')
        if (list.indexOf(id) > 0) {
          e.reply(`${name}已存在`)
        } else {
          list.push(id)
          e.reply(`已添加${name}`)
        }
      }
      if (variable in ChatGPTConfig.management) {
        if ((/** @type {string[]} **/ChatGPTConfig.management[variable]).indexOf(id) > 0) {
          e.reply(`${name}已存在`)
        } else {
          (/** @type {string[]} **/ChatGPTConfig.management[variable]).push(id)
          e.reply(`已添加${name}`)
        }
      } else {
        e.reply(`暂不支持添加${name}，请使用后台管理面板添加`)
      }
    }
  }
  this[`remove${upperVariable}`] = async function (e) {
    const id = e.msg.replace(new RegExp(cmdPrefix + `删除${name}`), '')
    if (manager) {
      const instance = await manager.getInstance(id)
      if (instance) {
        await manager.deleteInstance(id)
        e.reply(`已删除${name}`)
      } else {
        e.reply(`${name}不存在`)
      }
    } else {
      if (variable in ChatGPTConfig.llm) {
        if ((/** @type {string[]} **/ChatGPTConfig.llm[variable]).indexOf(id) > 0) {
          (/** @type {string[]} **/ChatGPTConfig.llm[variable]).splice(
            (/** @type {string[]} **/ChatGPTConfig.llm[variable]).indexOf(id),
            1
          )
          e.reply(`已删除${name}`)
        } else {
          e.reply(`${name}不存在`)
        }
      } else if (variable in ChatGPTConfig.management) {
        if ((/** @type {string[]} **/ChatGPTConfig.management[variable]).indexOf(id) > 0) {
          (/** @type {string[]} **/ChatGPTConfig.management[variable]).splice(
            (/** @type {string[]} **/ChatGPTConfig.management[variable]).indexOf(id),
            1
          )
          e.reply(`已删除${name}`)
        } else {
          e.reply(`${name}不存在`)
        }
      } else {
        e.reply(`暂不支持删除${name}，请使用后台管理面板删除`)
      }
    }
  }
  return rules
}

/**
 * 获取管理器
 * @param {string} name
 * @returns {import('chaite').NonExecutableShareableManager | import('chaite').ExecutableShareableManager | null}
 */
function getManagerByName (name) {
  switch (name.toLowerCase()) {
    case 'channels': {
      return Chaite.getInstance().getChannelsManager()
    }
    case 'presets': {
      return Chaite.getInstance().getChatPresetManager()
    }
    case 'processors': {
      return Chaite.getInstance().getProcessorsManager()
    }
    case 'tools': {
      return Chaite.getInstance().getToolsManager()
    }
  }
  return null
}
const switchCommandPreset = {
  0: ['开启', '关闭'],
  1: ['允许', '禁止']
}
export function createSwitchCommandRules (cmdPrefix, name, variable, preset = 0) {
  const upperVariable = variable.charAt(0).toUpperCase() + variable.slice(1)
  return {
    reg: cmdPrefix + `(${switchCommandPreset[preset][0]}|${switchCommandPreset[preset][1]})${name}$`,
    fnc: `switch${upperVariable}`
  }
}
