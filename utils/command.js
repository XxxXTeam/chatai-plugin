import { Chaite } from 'chaite'
import common from '../../../lib/common/common.js'
import ChatGPTConfig from '../config/config.js'
import { getBotFramework } from './bot.js'
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
      fnc: `list${upperVariable}`,
      permission: 'master'
    },
    {
      reg: cmdPrefix + `(编辑|修改)${name}`,
      fnc: `edit${upperVariable}`,
      permission: 'master'
    },
    {
      reg: cmdPrefix + `(添加|新增)${name}$`,
      fnc: `add${upperVariable}`,
      permission: 'master'
    },
    {
      reg: cmdPrefix + `删除${name}`,
      fnc: `remove${upperVariable}`,
      permission: 'master'
    }
  ]
  const manager = getManagerByName(upperVariable)
  if (detail) {
    rules.push({
      reg: cmdPrefix + `${name}详情`,
      fnc: `detail${upperVariable}`,
      permission: 'master'
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
    rules.push({
      reg: cmdPrefix + `上传${name}(.*)`,
      fnc: `upload${upperVariable}`,
      permission: 'master'
    })
    this[`upload${upperVariable}`] = async function (e) {
      const match = e.msg.match(new RegExp(cmdPrefix + `上传${name}(.*)`))
      if (match) {
        const id = match[1].trim()
        console.log(id)
        const instance = await manager.getInstanceT(id)
        if (instance) {
          const result = await manager.shareToCloud(id)
          if (result) {
            e.reply(`上传成功，云端${name}ID为：${result}`)
          } else {
            e.reply('上传失败')
          }
        } else {
          e.reply(`${name}不存在`)
        }
      }
    }
    rules.push({
      reg: cmdPrefix + `浏览云端${name}(.*?)(页码(\\d+))?$`,
      fnc: `listCloud${upperVariable}`
    })
    this[`listCloud${upperVariable}`] = async function (e) {
      const match = e.msg.match(new RegExp(cmdPrefix + `浏览云端${name}(.*?)(页码(\\d+))?$`))
      if (match) {
        const query = match[1].trim()
        const page = match[3] ? parseInt(match[3]) : 1 // 如果没有指定页码，默认为第1页

        const result = await manager?.listFromCloud({}, query, {
          page,
          pageSize: 10,
          searchFields: ['name', 'description']
        })

        logger.debug(result)
        if (result.items && result.items.length > 0) {
          const msgs = result.items.map(i => i.toFormatedString(!e.isGroup))

          // 构建分页信息
          const { currentPage, totalPages, totalItems, pageSize } = result.pagination
          const pageInfo = `云端${name}查询结果 - 第${currentPage}/${totalPages}页，共${totalItems}条，每页${pageSize}条`

          // 添加翻页提示
          let pageHint = ''
          if (result.pagination.hasNextPage) {
            pageHint += `\n发送 ${cmdPrefix}浏览云端${name}${query || ''}页码${currentPage + 1} 查看下一页`
          }
          if (result.pagination.hasPreviousPage) {
            pageHint += `\n发送 ${cmdPrefix}浏览云端${name}${query || ''}页码${currentPage - 1} 查看上一页`
          }

          const forwardedMsg = await common.makeForwardMsg(e, msgs, pageInfo + pageHint)
          e.reply(forwardedMsg)
        } else {
          e.reply(`未找到相关的云端${name}或页码超出范围`)
        }
      } else {
        e.reply(`格式错误，正确格式：${cmdPrefix}浏览云端${name}[关键词][页码数字]`)
      }
    }
    rules.push({
      reg: cmdPrefix + `导入${name}`,
      fnc: `importCloud${upperVariable}`
    })
    this[`importCloud${upperVariable}`] = async function (e) {
      const id = e.msg.replace(new RegExp(cmdPrefix + `导入${name}`), '')
      if (id) {
        const instance = await manager.getInstanceByCloudId(id)
        if (instance) {
          e.reply(`${name}已存在，尝试导入最新版本`, true)
        }
        const result = await manager.getFromCloud(id)
        if (result) {
          result.cloudId = result.id
          delete result.id
          const newId = await manager.addInstance(result)
          e.reply(`导入成功，${name}ID为：${newId}`, true)
        } else {
          e.reply(`获取${name}失败，请检查id是否正确`, true)
        }
      } else {
        e.reply(`格式错误，正确格式：${cmdPrefix}导入${name}[id]`)
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
      const id = e.msg.replace(new RegExp(cmdPrefix + `(添加|新增)${name}`), '')
      if (variable in ChatGPTConfig.llm) {
        /** @type {string[]} */
        const list = ChatGPTConfig.llm[variable]
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
  if (getBotFramework() === 'trss') {
    rules.forEach(rule => {
      rule.reg = new RegExp(rule.reg)
    })
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
  const rule = {
    reg: cmdPrefix + `(${switchCommandPreset[preset][0]}|${switchCommandPreset[preset][1]})${name}$`,
    fnc: `switch${upperVariable}`
  }
  if (getBotFramework() === 'trss') {
    rule.reg = new RegExp(rule.reg)
  }
  return rule
}
