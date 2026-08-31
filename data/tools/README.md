# 自定义工具开发指南

本目录用于存放**用户自定义**的 JS 工具文件，放入后重启即自动加载。

> 📖 完整开发文档请参阅 [docs/TOOLS.md](../../docs/TOOLS.md)

## 快速开始

### 简单对象格式（推荐）

```javascript
// my_tool.js
export default {
  name: 'my_tool',
  
  function: {
    name: 'my_tool',
    description: '工具描述，AI会根据描述决定何时调用',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: '参数说明' }
      },
      required: ['param1']
    }
  },

  async run(args, context) {
    const api = context.getApi()
    await api.reply(context.message.text(`处理完成: ${args.param1}`))
    
    // 返回结果给AI
    return { success: true, message: '操作完成' }
  }
}
```

### 类继承格式

```javascript
import { CustomTool } from './CustomTool.js'

class MyTool extends CustomTool {
  name = 'my_tool'

  function = {
    name: 'my_tool',
    description: '工具描述',
    parameters: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: '参数说明' }
      },
      required: ['param1']
    }
  }

  async run(args, context) {
    return { success: true, result: args.param1 }
  }
}

export default new MyTool()
```

## Context 对象

| 方法 | 说明 |
|------|------|
| `context.getApi()` | 标准平台接口，发送、查询、管理统一从这里调用 |
| `context.message` | 标准 Yunzai 消息段工厂 |
| `context.getEvent()` | 当前消息事件 (e) |
| `context.isMaster()` | 当前调用者是否为主人 |

`context.getBot()`、`context.getAdapter()`、`context.isIcqq()`、`context.isNapCat()`、
`context.isNT()` 与 `context.isQQBot()` 仅用于旧工具兼容。新工具不得用它们建立协议分支。

## 由模型创建并立即调用

开启“允许危险工具”后，主人会话可使用 `create_custom_tool`、`update_custom_tool`、
`invoke_custom_tool`、`delete_custom_tool`。创建接口接收结构化的 `name`、
`description`、`input_schema` 与 `handler_code`；`handler_code` 是
`async run(args, context)` 的函数体，不是完整模块源码。

- 写入采用同目录临时文件、语法/schema 校验、原子替换和失败回滚。
- 新工具固定标记为 `dangerous: true`、`requireMaster: true`，生成的 handler 内也会再次检查主人权限。
- `create_custom_tool.invoke_arguments` 可在创建完成的同一轮立即执行；也可随后通过稳定的
  `invoke_custom_tool` 代理调用。下一轮新建客户端会直接包含该工具。
- 创建时拒绝与内置工具、YAML 工具或远程 MCP 工具同名；更新/删除仅允许命中
  `custom-tools` 下已注册的 JS 工具。
- 工具名必须以字母或下划线开头，并且只能包含字母、数字、下划线，以兼容各协议及 JSON 工具调用兜底。

## 协议边界

`context.getApi()` 会保留 QQBot OpenID，并统一处理 QQBot、ICQQ、OneBot 与 NapCat 的标准能力。
工具不得自行转换 `group_id`/`user_id`，不得直接调用 `pickGroup`、`pickFriend`、`sendApi`，
也不得自行拼接多套消息段。协议端不支持的能力会明确失败，不会伪造成功。

## 示例文件

- `example_tool.js` - 简单对象格式示例

## 注意事项

1. 工具名称不能与内置工具冲突
2. 修改工具后可使用管理面板热重载
3. 敏感操作需要权限验证
4. 内置工具已包含：天气、一言、骰子、倒计时、提醒、插画等（见 `src/mcp/tools/extra.js`）
