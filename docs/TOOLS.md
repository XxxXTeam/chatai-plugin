# 工具开发指南

本文档介绍如何为 ChatAI Plugin 开发自定义工具。

## 目录

- [工具概述](#工具概述)
- [快速开始](#快速开始)
- [工具结构](#工具结构)
- [参数定义](#参数定义)
- [上下文访问](#上下文访问)
- [返回格式](#返回格式)
- [最佳实践](#最佳实践)
- [示例工具](#示例工具)
- [内置工具列表](#内置工具列表)

---

## 工具概述

ChatAI Plugin 支持两种方式扩展工具：

| 方式 | 位置 | 说明 |
|------|------|------|
| **JS 工具文件** | `data/tools/*.js` | 推荐方式，完整的 JavaScript 模块 |
| **YAML 配置** | `config.yaml` 中的 `customTools` | 简单场景，直接在配置中定义 |

工具遵循 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 标准，可被 AI 模型自动调用。

---

## 快速开始

### 1. 创建工具文件

在 `data/tools/` 目录下创建 JS 文件：

```javascript
// data/tools/hello.js
export default {
    name: 'say_hello',
    
    function: {
        name: 'say_hello',
        description: '向指定用户说你好',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '用户名称'
                }
            },
            required: ['name']
        }
    },

    async run(args, context) {
        const { name } = args
        return {
            success: true,
            message: `你好，${name}！`
        }
    }
}
```

### 2. 重载工具

工具会在插件启动时自动加载。也可以通过管理面板手动重载。

### 3. 测试工具

向机器人发送消息让 AI 调用你的工具：
```
@机器人 请向张三问好
```

---

## 工具结构

### 完整结构

```javascript
export default {
    // 工具名称（必须，用于调用）
    name: 'tool_name',
    
    // 工具定义（必须）
    function: {
        name: 'tool_name',           // 与上面保持一致
        description: '工具功能描述',   // AI 会根据描述决定何时调用
        parameters: {                 // JSON Schema 格式的参数定义
            type: 'object',
            properties: {
                // 参数定义...
            },
            required: []              // 必填参数列表
        }
    },

    // 工具执行函数（必须）
    async run(args, context) {
        // args: 调用参数
        // context: 执行上下文
        return { /* 返回结果 */ }
    }
}
```

### 简化结构

也可以使用简化结构：

```javascript
export default {
    name: 'tool_name',
    description: '工具功能描述',
    parameters: {
        type: 'object',
        properties: { /* ... */ }
    },
    
    async run(args, context) {
        return { /* ... */ }
    }
}
```

---

## 参数定义

使用 [JSON Schema](https://json-schema.org/) 格式定义参数：

### 基本类型

```javascript
parameters: {
    type: 'object',
    properties: {
        // 字符串
        text: {
            type: 'string',
            description: '文本内容'
        },
        
        // 数字
        count: {
            type: 'integer',
            description: '数量'
        },
        
        // 浮点数
        price: {
            type: 'number',
            description: '价格'
        },
        
        // 布尔值
        enabled: {
            type: 'boolean',
            description: '是否启用'
        },
        
        // 数组
        tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签列表'
        },
        
        // 枚举
        type: {
            type: 'string',
            enum: ['type1', 'type2', 'type3'],
            description: '类型选择'
        }
    },
    required: ['text']  // 必填参数
}
```

### 复杂类型

```javascript
parameters: {
    type: 'object',
    properties: {
        // 嵌套对象
        user: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                age: { type: 'integer' }
            }
        },
        
        // 对象数组
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    value: { type: 'number' }
                }
            }
        }
    }
}
```

---

## 上下文访问

`context` 参数提供了丰富的运行时信息和能力：

### 基础上下文

```javascript
async run(args, context) {
    // 获取当前事件（消息事件）
    const event = context.getEvent()
    // event.user_id    - 发送者QQ号
    // event.group_id   - 群号（私聊为空）
    // event.message_id - 消息ID
    // event.sender     - 发送者信息
    
    // 获取 Bot 实例
    const bot = context.getBot()
    
    // 获取适配器信息
    const adapter = context.getAdapter()
    // adapter.adapter  - 适配器类型：'icqq'|'napcat'|'onebot'
    // adapter.isNT     - 是否为 NT 协议
    
    // 快捷判断
    const isIcqq = context.isIcqq()
    const isNapCat = context.isNapCat()
    const isNT = context.isNT()
}
```

### 发送消息

```javascript
async run(args, context) {
    const e = context.getEvent()
    
    // 回复当前消息
    await e.reply('文本消息')
    
    // 发送图片
    await e.reply(segment.image('https://example.com/image.png'))
    
    // 发送多条消息
    await e.reply([
        '第一条消息',
        segment.image('file:///path/to/image.png'),
        segment.at(12345678)
    ])
    
    // 发送到指定群
    const bot = context.getBot()
    await bot.pickGroup(群号).sendMsg('消息内容')
    
    // 发送私聊
    await bot.pickFriend(QQ号).sendMsg('消息内容')
}
```

### 消息段类型

```javascript
// 文本
segment.text('文本内容')

// 图片
segment.image('https://...')       // URL
segment.image('file:///path/...')  // 本地文件
segment.image('base64://...')      // Base64

// @用户
segment.at(用户QQ号)
segment.at('all')  // @全体成员

// 表情
segment.face(表情ID)

// 语音
segment.record('file:///path/to/audio.mp3')

// 视频
segment.video('file:///path/to/video.mp4')

// JSON 卡片
segment.json({ /* JSON数据 */ })

// 合并转发
segment.xml('<xml>...</xml>')
```

---

## 返回格式

### 基本返回

```javascript
// 成功返回
return {
    success: true,
    message: '操作成功',
    data: { /* 任意数据 */ }
}

// 错误返回
return {
    error: '错误信息描述'
}
```

### MCP 标准格式

```javascript
// 文本内容
return {
    content: [
        { type: 'text', text: '返回的文本内容' }
    ]
}

// 图片内容
return {
    content: [
        { type: 'text', text: '图片描述' },
        { 
            type: 'image', 
            data: 'base64编码的图片数据',
            mimeType: 'image/png'
        }
    ]
}

// 混合内容
return {
    content: [
        { type: 'text', text: '处理结果：' },
        { type: 'image', data: '...', mimeType: 'image/png' },
        { type: 'text', text: '处理完成' }
    ]
}
```

### 简化返回

插件会自动将简化格式转换为 MCP 标准格式：

```javascript
// 直接返回对象（自动转为 JSON 文本）
return { name: '张三', age: 18 }

// 返回 text 字段
return { text: '处理结果' }

// 返回 image 字段
return { 
    image: { 
        base64: '...', 
        mimeType: 'image/png' 
    } 
}
```

---

## 最佳实践

### 1. 良好的描述

```javascript
// ✅ 好的描述 - 清晰说明功能和使用场景
description: '查询指定城市的实时天气信息，包括温度、湿度、风力等'

// ❌ 差的描述 - 模糊不清
description: '获取天气'
```

### 2. 参数验证

```javascript
async run(args, context) {
    const { city } = args
    
    // 验证必要参数
    if (!city || typeof city !== 'string') {
        return { error: '请提供有效的城市名称' }
    }
    
    // 验证参数范围
    if (city.length > 50) {
        return { error: '城市名称过长' }
    }
    
    // ... 业务逻辑
}
```

### 3. 错误处理

```javascript
async run(args, context) {
    try {
        const response = await fetch(apiUrl)
        
        if (!response.ok) {
            return { error: `API请求失败: HTTP ${response.status}` }
        }
        
        const data = await response.json()
        return { success: true, data }
        
    } catch (error) {
        // 记录日志
        logger.error('[MyTool] 执行失败:', error)
        
        // 返回用户友好的错误信息
        return { error: `操作失败: ${error.message}` }
    }
}
```

### 4. 超时控制

```javascript
async run(args, context) {
    try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        
        const response = await fetch(url, {
            signal: controller.signal
        })
        
        clearTimeout(timeout)
        return { success: true, data: await response.json() }
        
    } catch (error) {
        if (error.name === 'AbortError') {
            return { error: '请求超时' }
        }
        return { error: error.message }
    }
}
```

### 5. 日志记录

```javascript
async run(args, context) {
    logger.debug('[MyTool] 开始执行:', args)
    
    // ... 业务逻辑
    
    logger.info('[MyTool] 执行成功')
    return result
}
```

---

## 示例工具

### 天气查询

```javascript
// data/tools/weather.js
export default {
    name: 'get_weather',
    
    function: {
        name: 'get_weather',
        description: '查询指定城市的天气信息',
        parameters: {
            type: 'object',
            properties: {
                city: {
                    type: 'string',
                    description: '城市名称'
                }
            },
            required: ['city']
        }
    },

    async run(args, context) {
        const { city } = args
        
        try {
            const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`
            const response = await fetch(url)
            const data = await response.json()
            
            const current = data.current_condition[0]
            
            return {
                success: true,
                city,
                temperature: `${current.temp_C}°C`,
                weather: current.weatherDesc[0].value,
                humidity: `${current.humidity}%`
            }
        } catch (error) {
            return { error: `获取天气失败: ${error.message}` }
        }
    }
}
```

### 随机图片

```javascript
// data/tools/random_image.js
export default {
    name: 'random_image',
    
    function: {
        name: 'random_image',
        description: '获取一张随机图片',
        parameters: {
            type: 'object',
            properties: {
                category: {
                    type: 'string',
                    description: '图片类别',
                    enum: ['anime', 'nature', 'cat', 'dog']
                }
            }
        }
    },

    async run(args, context) {
        const e = context.getEvent()
        const { category = 'anime' } = args
        
        const apis = {
            anime: 'https://api.example.com/anime',
            nature: 'https://api.example.com/nature',
            cat: 'https://api.thecatapi.com/v1/images/search',
            dog: 'https://api.thedogapi.com/v1/images/search'
        }
        
        try {
            const response = await fetch(apis[category])
            const data = await response.json()
            const imageUrl = Array.isArray(data) ? data[0].url : data.url
            
            await e.reply(segment.image(imageUrl))
            
            return { success: true, message: '图片已发送' }
        } catch (error) {
            return { error: `获取图片失败: ${error.message}` }
        }
    }
}
```

### 群管理操作

```javascript
// data/tools/group_manage.js
export default {
    name: 'group_welcome',
    
    function: {
        name: 'group_welcome',
        description: '设置群欢迎语',
        parameters: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: '欢迎语内容，支持{at}表示@新成员'
                }
            },
            required: ['message']
        }
    },

    async run(args, context) {
        const e = context.getEvent()
        
        if (!e.group_id) {
            return { error: '此工具只能在群聊中使用' }
        }
        
        // 检查权限
        if (!e.member?.is_admin && !e.member?.is_owner) {
            return { error: '需要管理员权限' }
        }
        
        // 保存欢迎语（这里使用 Redis 或数据库）
        // await redis.set(`welcome:${e.group_id}`, args.message)
        
        return {
            success: true,
            message: `已设置群欢迎语: ${args.message}`
        }
    }
}
```



---


## 内置工具列表

### 基础工具 (basic)
| 工具名 | 说明 |
|--------|------|
| `get_current_time` | 获取当前时间 |
| `sleep` | 等待指定时间 |
| `echo` | 原样返回内容 |
| `get_environment` | 获取运行环境 |
| `list_available_tools` | 列出所有工具 |
| `get_tool_info` | 获取工具详情 |
| `get_lunar_date` | 获取农历日期 |
| `get_festival` | 获取近期节日 |
| `format_number` | 格式化数字 |

### 用户信息 (user)
| 工具名 | 说明 |
|--------|------|
| `get_user_info` | 获取用户信息 |
| `get_friend_list` | 获取好友列表 |
| `send_like` | 给好友点赞 |

### 群组信息 (group)
| 工具名 | 说明 |
|--------|------|
| `get_group_info` | 获取群信息 |
| `get_group_list` | 获取群列表 |
| `get_group_member_list` | 获取群成员列表 |
| `get_group_member_info` | 获取群成员详情 |

### 消息操作 (message)
| 工具名 | 说明 |
|--------|------|
| `send_private_message` | 发送私聊消息 |
| `send_group_message` | 发送群消息 |
| `reply_current_message` | 回复当前消息 |
| `at_user` | @用户 |
| `random_at_members` | 随机@群成员 |
| `make_forward_message` | 发送合并转发 |
| `get_chat_history` | 获取聊天记录 |

### 群管理 (admin)
| 工具名 | 说明 |
|--------|------|
| `set_group_card` | 设置群名片 |
| `mute_member` | 禁言成员 |
| `kick_member` | 踢出成员 |
| `recall_message` | 撤回消息 |
| `set_group_admin` | 设置管理员 |
| `set_group_whole_ban` | 全群禁言 |

### 媒体处理 (media)
| 工具名 | 说明 |
|--------|------|
| `parse_image` | 解析图片 |
| `send_image` | 发送图片 |
| `parse_video` | 解析视频 |
| `send_video` | 发送视频 |
| `get_avatar` | 获取头像 |
| `image_ocr` | 图片文字识别 |
| `generate_qrcode` | 生成二维码 |

### 网页访问 (web)
| 工具名 | 说明 |
|--------|------|
| `website` | 访问网页获取内容 |
| `fetch_url` | 获取URL内容 |

### 搜索工具 (search)
| 工具名 | 说明 |
|--------|------|
| `web_search` | 网页搜索 |
| `search_wiki` | 维基百科搜索 |
| `translate` | 文本翻译 |

### 实用工具 (utils)
| 工具名 | 说明 |
|--------|------|
| `calculate` | 数学计算 |
| `encode_decode` | 编码转换 |
| `hash` | 哈希计算 |
| `uuid` | 生成UUID |

### 记忆管理 (memory)
| 工具名 | 说明 |
|--------|------|
| `get_memories` | 获取用户记忆 |
| `add_memory` | 添加记忆 |
| `search_memories` | 搜索记忆 |
| `delete_memory` | 删除记忆 |

### 上下文管理 (context)
| 工具名 | 说明 |
|--------|------|
| `get_current_context` | 获取当前上下文 |
| `get_group_context` | 获取群聊上下文 |
| `clear_context` | 清除上下文 |

### 语音工具 (voice)
| 工具名 | 说明 |
|--------|------|
| `text_to_speech` | 文字转语音 |
| `ai_voice_chat` | AI语音对话 |

---

## 调试技巧

### 1. 启用调试模式

在 `config.yaml` 中启用：
```yaml
basic:
  debug: true
```

### 2. 查看工具调用日志

调试模式下，所有工具调用都会在控制台输出详细日志。

### 3. 手动测试工具

可以在管理面板的「工具管理」中测试工具执行。

---

## 常见问题

### Q: 工具没有被加载？

1. 检查文件是否在 `data/tools/` 目录下
2. 检查文件是否有 `export default`
3. 检查是否有 `name` 和 `run` 函数
4. 查看控制台是否有加载错误

### Q: AI 不调用我的工具？

1. 检查 `description` 是否清晰描述了工具功能
2. 确保工具名称有意义
3. 在对话中明确需要该功能

### Q: 如何访问数据库？

```javascript
async run(args, context) {
    // 使用内置的数据库服务
    const { databaseService } = await import('../../src/services/storage/DatabaseService.js')
    
    // 或使用 Redis
    const { redisClient } = await import('../../src/core/cache/RedisClient.js')
}
```

---

## 外部 MCP 服务器

除了 JS 工具，还可以通过连接外部 MCP 服务器来扩展工具能力。支持四种连接类型：

### 连接类型对比

| 类型 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| npm | 使用 npm 包形式发布的 MCP 服务器 | 易用、自动安装 | 依赖 Node.js 环境 |
| stdio | 本地进程，任意语言实现 | 灵活、高性能 | 需要手动管理进程 |
| SSE | 远程服务，实时连接 | 持久连接、实时响应 | 需要稳定网络 |
| HTTP | 远程服务，无状态 | 简单、易部署 | 每次请求新连接 |

### npm 包形式

最推荐的方式，使用 npm 发布的 MCP 服务器包：

```json
// data/mcp-servers.json
{
  "servers": {
    "filesystem": {
      "type": "npm",
      "package": "@anthropic/mcp-server-filesystem",
      "args": ["/home/user/documents"]
    },
    "memory": {
      "type": "npm",
      "package": "@modelcontextprotocol/server-memory"
    },
    "github": {
      "type": "npm",
      "package": "@anthropic/mcp-server-github",
      "env": {
        "GITHUB_TOKEN": "ghp_xxxxxxxxxxxx"
      }
    }
  }
}
```

**常用 npm MCP 包：**

| 包名 | 功能 | 环境变量 |
|------|------|----------|
| `@anthropic/mcp-server-filesystem` | 文件系统访问 | - |
| `@modelcontextprotocol/server-memory` | 知识图谱记忆 | - |
| `@anthropic/mcp-server-brave-search` | Brave 搜索 | `BRAVE_API_KEY` |
| `@anthropic/mcp-server-github` | GitHub 操作 | `GITHUB_TOKEN` |
| `@anthropic/mcp-server-fetch` | HTTP 请求 | - |
| `@anthropic/mcp-server-puppeteer` | 浏览器自动化 | - |
| `@anthropic/mcp-server-sqlite` | SQLite 数据库 | - |
| `@anthropic/mcp-server-postgres` | PostgreSQL 数据库 | `POSTGRES_*` |
| `@upstash/context7-mcp` | Context7 知识库 | `CONTEXT7_API_KEY` |

### stdio 本地进程

用于连接本地运行的 MCP 服务器进程：

```json
{
  "servers": {
    "python-server": {
      "type": "stdio",
      "command": "python",
      "args": ["mcp_server.py"],
      "env": {
        "PYTHONPATH": "/path/to/lib"
      },
      "cwd": "/path/to/server"
    },
    "node-server": {
      "type": "stdio",
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

**Python MCP 服务器示例：**

```python
# mcp_server.py
import json
import sys

def handle_request(request):
    method = request.get('method')
    
    if method == 'initialize':
        return {
            'protocolVersion': '2024-11-05',
            'capabilities': {'tools': {'listChanged': False}},
            'serverInfo': {'name': 'my-server', 'version': '1.0.0'}
        }
    
    if method == 'tools/list':
        return {
            'tools': [{
                'name': 'my_tool',
                'description': '我的工具',
                'inputSchema': {
                    'type': 'object',
                    'properties': {
                        'input': {'type': 'string'}
                    }
                }
            }]
        }
    
    if method == 'tools/call':
        params = request.get('params', {})
        return {
            'content': [{
                'type': 'text',
                'text': f"处理结果: {params.get('arguments', {})}"
            }]
        }
    
    return {'error': {'code': -32601, 'message': 'Method not found'}}

if __name__ == '__main__':
    for line in sys.stdin:
        request = json.loads(line)
        response = {
            'jsonrpc': '2.0',
            'id': request.get('id'),
            'result': handle_request(request)
        }
        print(json.dumps(response), flush=True)
```

### SSE 远程服务

用于连接支持 Server-Sent Events 的远程 MCP 服务：

```json
{
  "servers": {
    "remote-sse": {
      "type": "sse",
      "url": "https://mcp.example.com/sse",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

**SSE 协议流程：**

1. 客户端连接 SSE 端点
2. 服务器发送 `endpoint` 事件，告知消息端点 URL
3. 客户端通过 POST 发送请求到消息端点
4. 服务器返回 202 Accepted，实际响应通过 SSE 流返回

**服务端实现示例（Express.js）：**

```javascript
const express = require('express')
const app = express()
const sessions = new Map()

// SSE 端点
app.get('/sse', (req, res) => {
    const sessionId = crypto.randomUUID()
    
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    
    // 发送消息端点
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`)
    
    sessions.set(sessionId, res)
    
    req.on('close', () => sessions.delete(sessionId))
})

// 消息端点
app.post('/messages', express.json(), (req, res) => {
    const { sessionId } = req.query
    const sseRes = sessions.get(sessionId)
    
    if (!sseRes) {
        return res.status(400).send('Invalid session')
    }
    
    // 处理请求
    const response = handleMcpRequest(req.body)
    
    // 通过 SSE 发送响应
    sseRes.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
    
    res.status(202).send('Accepted')
})
```

### HTTP 无状态

用于连接简单的 HTTP API 形式的 MCP 服务：

```json
{
  "servers": {
    "remote-http": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key",
        "Content-Type": "application/json"
      },
      "timeout": 30000
    }
  }
}
```

**HTTP 服务端示例：**

```javascript
app.post('/mcp', express.json(), (req, res) => {
    const { method, params, id } = req.body
    
    let result
    switch (method) {
        case 'initialize':
            result = {
                protocolVersion: '2024-11-05',
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'http-server', version: '1.0.0' }
            }
            break
        case 'tools/list':
            result = { tools: [/* 工具列表 */] }
            break
        case 'tools/call':
            result = handleToolCall(params)
            break
        default:
            return res.json({
                jsonrpc: '2.0',
                id,
                error: { code: -32601, message: 'Method not found' }
            })
    }
    
    res.json({ jsonrpc: '2.0', id, result })
})
```

### 通过管理面板配置

除了编辑 JSON 文件，也可以通过 Web 管理面板配置 MCP 服务器：

1. 打开管理面板
2. 进入「MCP 服务器」页面
3. 点击「添加服务器」
4. 选择类型并填写配置
5. 点击「连接」测试

### 调试外部服务器

```yaml
# 在 config.yaml 中启用 MCP 调试
mcp:
  enabled: true
  debug: true  # 输出详细的连接和调用日志
```

**常见问题：**

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 连接超时 | 网络问题或服务器未启动 | 检查网络和服务器状态 |
| 初始化失败 | 协议版本不兼容 | 确保服务器支持 2024-11-05 版本 |
| 工具列表为空 | 服务器未正确返回工具 | 检查 tools/list 响应 |
| npm 包启动失败 | 缺少依赖或权限问题 | 手动运行 npx 命令测试 |

---

## MCP 管理 API

插件提供 HTTP API 用于管理 MCP 服务器和工具。

### MCP 服务器 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/mcp/servers` | GET | 获取所有服务器列表 |
| `/api/mcp/servers` | POST | 添加新服务器 |
| `/api/mcp/servers/:name` | DELETE | 删除服务器 |
| `/api/mcp/servers/:name/reconnect` | POST | 重连服务器 |
| `/api/mcp/import` | POST | 导入 Claude Desktop 配置 |

### 工具管理 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/tools` | GET | 获取所有工具 |
| `/api/tools/test` | POST | 测试工具执行 |
| `/api/tools/categories` | GET | 获取工具分类 |
| `/api/tools/categories/:key/toggle` | POST | 切换分类启用状态 |
| `/api/tools/builtin/config` | GET/PUT | 内置工具配置 |
| `/api/tools/js` | GET | 获取 JS 工具列表 |
| `/api/tools/js` | POST | 创建 JS 工具 |
| `/api/tools/js/:name` | PUT | 更新 JS 工具 |
| `/api/tools/js/:name` | DELETE | 删除 JS 工具 |
| `/api/tools/reload` | POST | 重载所有工具 |

### 示例：添加 MCP 服务器

```javascript
// 添加 npm 包类型的 MCP 服务器
const response = await fetch('/api/mcp/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        name: 'filesystem',
        config: {
            type: 'npm',
            package: '@anthropic/mcp-server-filesystem',
            args: ['/home/user/documents']
        }
    })
})
```

### 示例：测试工具

```javascript
// 测试工具执行
const response = await fetch('/api/tools/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        toolName: 'get_current_time',
        arguments: { timezone: 'Asia/Shanghai' }
    })
})
```

---

## 常用 MCP 工具包推荐

### 官方包

| 包名 | 功能 | 环境变量 |
|------|------|----------|
| `@anthropic/mcp-server-filesystem` | 文件系统读写 | - |
| `@anthropic/mcp-server-fetch` | HTTP 请求 | - |
| `@anthropic/mcp-server-puppeteer` | 浏览器自动化 | - |
| `@anthropic/mcp-server-sqlite` | SQLite 操作 | - |
| `@anthropic/mcp-server-postgres` | PostgreSQL 操作 | `POSTGRES_*` |
| `@anthropic/mcp-server-brave-search` | Brave 搜索 | `BRAVE_API_KEY` |
| `@anthropic/mcp-server-github` | GitHub 操作 | `GITHUB_TOKEN` |
| `@anthropic/mcp-server-memory` | 知识图谱记忆 | - |

### 社区包

| 包名 | 功能 | 环境变量 |
|------|------|----------|
| `@upstash/context7-mcp` | Context7 知识库 | `CONTEXT7_API_KEY` |
| `mcp-server-discord` | Discord 机器人 | `DISCORD_TOKEN` |
| `mcp-server-youtube` | YouTube 视频信息 | `YOUTUBE_API_KEY` |
| `mcp-server-notion` | Notion 文档 | `NOTION_TOKEN` |
| `mcp-server-slack` | Slack 集成 | `SLACK_TOKEN` |
| `mcp-server-google-drive` | Google Drive | Google OAuth |
| `mcp-server-todoist` | Todoist 任务 | `TODOIST_API_TOKEN` |
| `mcp-server-weather` | 天气查询 | 各服务 API Key |

---

## 相关文档

- [架构文档](ARCHITECTURE.md) - MCP 与 Skills 的关系说明
- [开发者文档](DEVELOPMENT.md) - 项目开发与贡献指南
- [MCP 官方文档](https://modelcontextprotocol.io/) - Model Context Protocol 规范

---

如有更多问题，欢迎提交 Issue 或加入交流群讨论。
