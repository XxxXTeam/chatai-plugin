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
    const e = context.getEvent()  // 当前消息事件
    const bot = context.getBot()  // 机器人实例
    
    // 回复消息
    await e.reply(`处理完成: ${args.param1}`)
    
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
| `context.getEvent()` | 当前消息事件 (e) |
| `context.getBot()` | 机器人实例 (Bot) |
| `context.getAdapter()` | 适配器信息 `{ adapter, isNT }` |
| `context.isIcqq()` | 是否为 icqq 适配器 |
| `context.isNapCat()` | 是否为 NapCat 适配器 |
| `context.isNT()` | 是否为 NT 协议 |

## 示例文件

- `example_tool.js` - 简单对象格式示例

## 注意事项

1. 工具名称不能与内置工具冲突
2. 修改工具后可使用管理面板热重载
3. 敏感操作需要权限验证
4. 内置工具已包含：天气、一言、骰子、倒计时、提醒、插画等（见 `src/mcp/tools/extra.js`）
