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
  variable = variable.charAt(0).toUpperCase() + variable.slice(1)
  const rules = [
    {
      reg: cmdPrefix + `${name}列表$`,
      fnc: `list${variable}`
    },
    {
      reg: cmdPrefix + `(编辑|修改)${name}`,
      fnc: `edit${variable}`
    },
    {
      reg: cmdPrefix + `(添加|新增)${name}$`,
      fnc: `add${variable}`
    },

    {
      reg: cmdPrefix + `删除${name}`,
      fnc: `remove${variable}`
    }
  ]
  if (detail) {
    rules.push({
      reg: cmdPrefix + `${name}详情$`,
      fnc: `detail${variable}`
    })
  }
  // todo
  // 定义对应的函数
  this[`list${variable}`] = async function (e) {

  }
  return rules
}
const switchCommandPreset = {
  0: ['开启', '关闭'],
  1: ['允许', '禁止']
}
export function createSwitchCommandRules (cmdPrefix, name, variable, preset = 0) {
  variable = variable.charAt(0).toUpperCase() + variable.slice(1)
  return {
    reg: cmdPrefix + `(${switchCommandPreset[preset][0]}|${switchCommandPreset[preset][1]})${name}$`,
    fnc: `switch${variable}`
  }
}
