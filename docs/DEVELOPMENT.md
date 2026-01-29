# 开发者文档

本文档为 ChatAI Plugin 的开发者提供项目架构、代码规范和开发指南。

## 目录

- [项目架构](#项目架构)
- [目录结构](#目录结构)
- [核心模块](#核心模块)
- [服务层](#服务层)
- [MCP 系统](#mcp-系统)
- [开发环境](#开发环境)
- [代码规范](#代码规范)
- [测试指南](#测试指南)
- [发布流程](#发布流程)

---

## 项目架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Yunzai Bot                          │
├─────────────────────────────────────────────────────────────┤
│                      ChatAI Plugin                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    Apps Layer                         │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │  │
│  │  │  Chat   │ │Commands │ │ Events  │ │  ...    │    │  │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘    │  │
│  └───────┼───────────┼───────────┼───────────┼──────────┘  │
│          │           │           │           │              │
│  ┌───────▼───────────▼───────────▼───────────▼──────────┐  │
│  │                   Services Layer                      │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │  │
│  │  │   LLM   │ │ Storage │ │  Media  │ │  Preset │    │  │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘    │  │
│  └───────┼───────────┼───────────┼───────────┼──────────┘  │
│          │           │           │           │              │
│  ┌───────▼───────────▼───────────▼───────────▼──────────┐  │
│  │                     Core Layer                        │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │  │
│  │  │Adapters │ │  Cache  │ │  Utils  │ │  Types  │    │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                     MCP System                        │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │  │
│  │  │ McpManager  │ │ McpClient   │ │BuiltinTools│    │  │
│  │  └─────────────┘ └─────────────┘ └─────────────┘    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
chatai-plugin/
├── apps/                      # 应用层 - Yunzai 插件模块
│   ├── chat.js               # 主对话处理
│   ├── ChatListener.js       # 消息监听器
│   ├── Commands.js           # 命令处理
│   ├── Management.js         # 管理命令
│   ├── GroupEvents.js        # 群事件处理
│   ├── ImageGen.js           # 图片生成
│   ├── MessageInspector.js   # 消息检查
│   ├── Poke.js               # 戳一戳响应
│   ├── Reaction.js           # 表情回应
│   ├── bym.js                # 伪人模式
│   └── update.js             # 更新功能
│
├── src/                       # 源代码
│   ├── core/                 # 核心模块
│   │   ├── adapters/         # LLM 适配器
│   │   │   ├── BaseAdapter.js
│   │   │   ├── OpenAIAdapter.js
│   │   │   ├── GeminiAdapter.js
│   │   │   ├── ClaudeAdapter.js
│   │   │   └── ...
│   │   ├── cache/            # 缓存管理
│   │   │   └── RedisClient.js
│   │   ├── types/            # 类型定义
│   │   └── utils/            # 核心工具
│   │       ├── helpers.js
│   │       ├── history.js
│   │       └── ...
│   │
│   ├── mcp/                  # MCP 模块
│   │   ├── BuiltinMcpServer.js  # 内置 MCP 服务器
│   │   ├── McpClient.js         # MCP 客户端
│   │   ├── McpManager.js        # MCP 管理器
│   │   └── tools/               # 内置工具
│   │       ├── index.js
│   │       ├── basic.js
│   │       ├── user.js
│   │       ├── group.js
│   │       ├── message.js
│   │       ├── admin.js
│   │       ├── media.js
│   │       ├── search.js
│   │       └── ...
│   │
│   ├── services/             # 服务层
│   │   ├── index.js          # 服务导出
│   │   ├── llm/              # LLM 服务
│   │   │   ├── ChatService.js
│   │   │   ├── ChannelManager.js
│   │   │   └── ContextManager.js
│   │   ├── storage/          # 存储服务
│   │   │   ├── DatabaseService.js
│   │   │   ├── MemoryManager.js
│   │   │   └── KnowledgeService.js
│   │   ├── media/            # 媒体服务
│   │   ├── preset/           # 预设服务
│   │   ├── middleware/       # 中间件
│   │   ├── proxy/            # 代理服务
│   │   ├── routes/           # API 路由
│   │   ├── scope/            # 作用域管理
│   │   ├── stats/            # 统计服务
│   │   └── webServer.js      # Web 服务
│   │
│   └── utils/                # 工具函数
│       ├── common.js
│       ├── messageParser.js
│       ├── platformAdapter.js
│       ├── eventDetector.js
│       └── ...
│
├── config/                    # 配置
│   ├── config.js             # 配置管理器
│   └── config.yaml           # 用户配置
│
├── data/                      # 数据目录
│   ├── *.db                  # SQLite 数据库
│   ├── tools/                # 自定义工具
│   ├── presets/              # 预设文件
│   └── ...
│
├── frontend/                  # Web 前端源码
│   ├── src/
│   ├── package.json
│   └── ...
│
├── resources/                 # 资源文件
│   └── web/                  # 前端构建产物
│
├── docs/                      # 文档
│   ├── TOOLS.md              # 工具开发文档
│   └── DEVELOPMENT.md        # 开发者文档
│
├── index.js                   # 插件入口
├── package.json
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

---

## 核心模块

### LLM 适配器

适配器位于 `src/core/adapters/`，负责与不同 LLM 提供商的 API 通信。

#### 基类结构

```javascript
// src/core/adapters/BaseAdapter.js
export class BaseAdapter {
    constructor(config) {
        this.config = config
        this.name = 'base'
    }

    // 发送聊天请求
    async chat(messages, options = {}) {
        throw new Error('Not implemented')
    }

    // 流式聊天
    async *chatStream(messages, options = {}) {
        throw new Error('Not implemented')
    }

    // 获取可用模型列表
    async listModels() {
        return []
    }

    // 测试连接
    async testConnection() {
        return { success: false, error: 'Not implemented' }
    }
}
```

#### 添加新适配器

1. 在 `src/core/adapters/` 创建新文件：

```javascript
// src/core/adapters/NewProviderAdapter.js
import { BaseAdapter } from './BaseAdapter.js'

export class NewProviderAdapter extends BaseAdapter {
    constructor(config) {
        super(config)
        this.name = 'newprovider'
        this.client = new NewProviderSDK({
            apiKey: config.apiKey,
            baseURL: config.baseUrl
        })
    }

    async chat(messages, options = {}) {
        const response = await this.client.chat({
            model: options.model || this.config.defaultModel,
            messages: this.formatMessages(messages),
            temperature: options.temperature,
            max_tokens: options.maxTokens
        })
        
        return {
            content: response.choices[0].message.content,
            usage: response.usage,
            model: response.model
        }
    }

    async *chatStream(messages, options = {}) {
        const stream = await this.client.chat({
            model: options.model,
            messages: this.formatMessages(messages),
            stream: true
        })

        for await (const chunk of stream) {
            yield {
                content: chunk.choices[0]?.delta?.content || '',
                done: chunk.choices[0]?.finish_reason === 'stop'
            }
        }
    }

    formatMessages(messages) {
        // 转换消息格式
        return messages.map(m => ({
            role: m.role,
            content: m.content
        }))
    }
}
```

2. 在 `src/core/adapters/index.js` 注册：

```javascript
import { NewProviderAdapter } from './NewProviderAdapter.js'

export const adapters = {
    openai: OpenAIAdapter,
    gemini: GeminiAdapter,
    claude: ClaudeAdapter,
    newprovider: NewProviderAdapter  // 添加新适配器
}
```

### 缓存系统

使用 Redis 进行缓存：

```javascript
import { redisClient } from '../core/cache/RedisClient.js'

// 设置缓存
await redisClient.set('key', 'value', 3600)  // 1小时过期

// 获取缓存
const value = await redisClient.get('key')

// 删除缓存
await redisClient.del('key')

// 使用 Hash
await redisClient.hset('hash', 'field', 'value')
await redisClient.hget('hash', 'field')
```

---

## 服务层

### ChatService

核心对话服务，处理消息并生成回复：

```javascript
import { chatService } from '../services/llm/ChatService.js'

// 发送消息并获取回复
const response = await chatService.chat({
    userId: '12345',
    groupId: '67890',
    message: '你好',
    options: {
        model: 'gpt-4o',
        temperature: 0.7
    }
})
```

### ContextManager

上下文管理，维护对话历史：

```javascript
import { contextManager } from '../services/llm/ContextManager.js'

// 获取会话ID
const convId = contextManager.getConversationId(userId, groupId)

// 获取上下文历史
const history = await contextManager.getContextHistory(convId)

// 添加消息到上下文
await contextManager.addMessage(convId, {
    role: 'user',
    content: '你好'
})

// 清除上下文
await contextManager.clearContext(convId)
```

### MemoryManager

长期记忆管理：

```javascript
import { memoryManager } from '../services/storage/MemoryManager.js'

// 获取用户记忆
const memories = await memoryManager.getMemories(userId)

// 添加记忆
await memoryManager.addMemory(userId, '用户喜欢编程', {
    category: 'preference',
    importance: 0.8
})

// 搜索记忆
const results = await memoryManager.searchMemories(userId, '编程')

// 删除记忆
await memoryManager.deleteMemory(memoryId)
```

### DatabaseService

SQLite 数据库服务：

```javascript
import { databaseService } from '../services/storage/DatabaseService.js'

// 执行查询
const rows = await databaseService.query(
    'SELECT * FROM users WHERE id = ?',
    [userId]
)

// 执行更新
await databaseService.run(
    'INSERT INTO users (id, name) VALUES (?, ?)',
    [userId, userName]
)
```

---

## MCP 系统

### 架构概述

```
┌─────────────────────────────────────────────────────────┐
│                      McpManager                          │
│  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  BuiltinServer  │  │     External MCP Servers     │  │
│  │  ┌───────────┐  │  │  ┌─────────┐  ┌─────────┐  │  │
│  │  │  Tools    │  │  │  │ Server1 │  │ Server2 │  │  │
│  │  └───────────┘  │  │  └─────────┘  └─────────┘  │  │
│  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### McpManager

MCP 管理器，统一管理所有 MCP 服务器：

```javascript
import mcpManager from '../mcp/McpManager.js'

// 获取所有可用工具
const tools = await mcpManager.getTools()

// 调用工具
const result = await mcpManager.callTool('get_weather', { city: '北京' })

// 连接外部 MCP 服务器
await mcpManager.connectServer({
    name: 'filesystem',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/']
})
```

### 工具类别

工具按功能分类，位于 `src/mcp/tools/`：

| 文件 | 类别 | 说明 |
|------|------|------|
| `basic.js` | basic | 基础工具 |
| `user.js` | user | 用户信息 |
| `group.js` | group | 群组信息 |
| `message.js` | message | 消息操作 |
| `admin.js` | admin | 群管理 |
| `media.js` | media | 媒体处理 |
| `file.js` | file | 文件操作 |
| `web.js` | web | 网页访问 |
| `search.js` | search | 搜索功能 |
| `utils.js` | utils | 实用工具 |
| `memory.js` | memory | 记忆管理 |
| `context.js` | context | 上下文管理 |
| `bot.js` | bot | Bot信息 |
| `voice.js` | voice | 语音功能 |

### 添加内置工具

1. 在对应类别文件中添加工具定义：

```javascript
// src/mcp/tools/basic.js
export const basicTools = [
    // ... 现有工具
    
    {
        name: 'new_tool',
        description: '新工具描述',
        inputSchema: {
            type: 'object',
            properties: {
                param1: { type: 'string', description: '参数1' }
            },
            required: ['param1']
        },
        handler: async (args, ctx) => {
            // 实现逻辑
            return { success: true, result: '...' }
        }
    }
]
```

2. 如果是新类别，在 `index.js` 中注册：

```javascript
// src/mcp/tools/index.js
import { newTools } from './new.js'

export const toolCategories = {
    // ... 现有类别
    new: {
        name: '新类别',
        description: '类别描述',
        icon: 'IconName',
        tools: newTools
    }
}
```

---

## 开发环境

### 环境要求

- Node.js >= 18
- pnpm >= 8.0
- Redis (可选，用于缓存)
- 编译工具 (用于 better-sqlite3)

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/XxxXTeam/chatai-plugin.git
cd chatai-plugin

# 安装依赖
pnpm install

# 构建原生模块
pnpm rebuild better-sqlite3

# 开发模式启动（需要在 Yunzai 环境中）
# 将插件目录链接到 Yunzai 的 plugins 目录
```

### 前端开发

```bash
cd frontend

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
```

### 调试配置

在 `config.yaml` 中启用调试：

```yaml
basic:
  debug: true
```

VSCode 调试配置 (`.vscode/launch.json`)：

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "node",
            "request": "attach",
            "name": "Attach to Yunzai",
            "port": 9229,
            "restart": true
        }
    ]
}
```

启动 Yunzai 时启用调试：

```bash
node --inspect app
```

---

## 代码规范

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件名 | camelCase 或 PascalCase | `ChatService.js`, `helpers.js` |
| 类名 | PascalCase | `ChatService`, `ContextManager` |
| 函数名 | camelCase | `getUserInfo`, `parseMessage` |
| 常量 | UPPER_SNAKE_CASE | `MAX_TOKENS`, `DEFAULT_MODEL` |
| 变量 | camelCase | `userId`, `groupId` |

### 代码风格

```javascript
// ✅ 使用 async/await
async function fetchData() {
    const response = await fetch(url)
    return response.json()
}

// ❌ 避免回调地狱
function fetchData(callback) {
    fetch(url).then(res => {
        res.json().then(data => {
            callback(data)
        })
    })
}
```

### 错误处理

```javascript
// ✅ 统一的错误处理
async function processRequest() {
    try {
        const result = await doSomething()
        return { success: true, data: result }
    } catch (error) {
        logger.error('[Module] 处理失败:', error)
        return { success: false, error: error.message }
    }
}
```

### 日志规范

```javascript
// 日志级别使用
logger.debug('[Module] 调试信息')    // 调试信息
logger.info('[Module] 一般信息')     // 重要信息
logger.warn('[Module] 警告信息')     // 警告
logger.error('[Module] 错误信息')    // 错误

// 格式：[模块名] 消息内容
logger.info('[ChatService] 收到消息:', userId)
```

### 注释规范

```javascript
/**
 * 获取用户信息
 * @param {string} userId - 用户ID
 * @param {Object} options - 选项
 * @param {boolean} options.cache - 是否使用缓存
 * @returns {Promise<Object>} 用户信息
 */
async function getUserInfo(userId, options = {}) {
    // ...
}
```

---

## 测试指南

### 单元测试

```javascript
// tests/services/ChatService.test.js
import { describe, it, expect } from 'vitest'
import { chatService } from '../../src/services/llm/ChatService.js'

describe('ChatService', () => {
    it('should process message correctly', async () => {
        const result = await chatService.chat({
            userId: 'test',
            message: 'hello'
        })
        
        expect(result).toBeDefined()
        expect(result.content).toBeTruthy()
    })
})
```

### 工具测试

```javascript
// tests/tools/basic.test.js
import { describe, it, expect } from 'vitest'
import { basicTools } from '../../src/mcp/tools/basic.js'

describe('Basic Tools', () => {
    const getCurrentTime = basicTools.find(t => t.name === 'get_current_time')
    
    it('should return current time', async () => {
        const result = await getCurrentTime.handler({})
        
        expect(result.success).toBe(true)
        expect(result.timestamp).toBeDefined()
    })
})
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定测试
pnpm test -- --grep "ChatService"

# 覆盖率报告
pnpm test -- --coverage
```

---

## 发布流程

### 版本管理

遵循 [语义化版本](https://semver.org/lang/zh-CN/)：

- **MAJOR**: 不兼容的 API 变更
- **MINOR**: 向下兼容的功能新增
- **PATCH**: 向下兼容的问题修复

### 发布步骤

1. **更新版本号**
   ```bash
   npm version patch|minor|major
   ```

2. **生成更新日志**
   ```bash
   pnpm changelog
   ```

3. **提交并推送**
   ```bash
   git push && git push --tags
   ```

4. **创建 Release**
   - 在 GitHub 创建 Release
   - 填写更新说明
   - 发布

### 提交规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```bash
# 新功能
git commit -m "feat(mcp): 添加天气查询工具"

# Bug修复
git commit -m "fix(adapter): 修复流式响应中断问题"

# 文档更新
git commit -m "docs: 更新开发文档"

# 重构
git commit -m "refactor(core): 重构消息处理流程"

# 破坏性变更
git commit -m "feat(config): 重构配置结构

BREAKING CHANGE: 配置文件格式已更改"
```

---

## 常见问题

### Q: 如何调试适配器？

1. 启用 debug 模式
2. 使用 `logger.debug` 输出调试信息
3. 检查 API 请求和响应

### Q: 如何添加新的 API 路由？

在 `src/services/routes/` 添加路由文件，然后在 `webServer.js` 中注册。

### Q: 数据库表结构在哪里？

表结构在 `src/services/storage/DatabaseService.js` 的初始化方法中定义。

### Q: 如何处理多 Bot 场景？

使用 `ctx.getBot(botId)` 获取指定 Bot 实例，通过 `getBotFramework()` 判断框架类型。

---

## 相关链接

### 核心文档

- [架构文档](./ARCHITECTURE.md) - MCP 与 Skills Agent 架构详解
- [工具开发指南](./TOOLS.md) - 工具编写完整教程
- [贡献指南](../CONTRIBUTING.md) - 代码贡献规范

### Wiki 详细文档

项目 Wiki 位于 `docs/content/` 目录，包含更详细的技术文档：

#### 开发必读
| 文档 | 说明 |
|------|------|
| [开发者指南](content/开发者指南.md) | 开发环境搭建与代码规范 |
| [快速开始](content/快速开始.md) | 完整的安装部署流程 |
| [故障排除](content/故障排除.md) | 常见问题与解决方案 |

#### 核心架构
| 文档 | 说明 |
|------|------|
| [系统概览](content/核心架构/系统概览.md) | 整体架构设计与分层 |
| [核心架构](content/核心架构/核心架构.md) | Apps/Services/Core 层详解 |
| [组件交互机制](content/核心架构/组件交互机制.md) | 模块间通信与事件流 |
| [设计模式应用](content/核心架构/设计模式应用.md) | 适配器、工厂、单例等模式 |
| [服务层架构](content/核心架构/服务层架构/) | LLM/存储/媒体等服务详解 |
| [模块系统](content/核心架构/模块系统/) | 模块加载与生命周期 |

#### 模型适配器
| 文档 | 说明 |
|------|------|
| [AI 模型适配器](content/AI%20模型适配器/) | OpenAI/Gemini/Claude 等适配器实现 |

#### 工具开发
| 文档 | 说明 |
|------|------|
| [工具调用系统](content/工具调用系统/工具调用系统.md) | 工具系统概述 |
| [MCP 协议实现](content/工具调用系统/MCP%20协议实现.md) | MCP 协议详解 |
| [自定义工具开发](content/工具调用系统/自定义工具开发.md) | 工具开发完整指南 |
| [工具安全控制](content/工具调用系统/工具安全控制.md) | 权限与安全策略 |
| [内置工具管理](content/工具调用系统/内置工具管理/) | 各类内置工具文档 |

#### API 开发
| 文档 | 说明 |
|------|------|
| [API 接口参考](content/API%20接口参考/) | REST API 完整文档 |
| [Web 管理面板](content/Web%20管理面板/) | 面板组件与路由 |

#### 配置参考
| 文档 | 说明 |
|------|------|
| [配置管理](content/配置管理/配置管理.md) | 配置系统概述 |
| [渠道配置](content/配置管理/渠道配置.md) | API 渠道配置 |
| [模型配置](content/配置管理/模型配置.md) | 模型参数调优 |
| [MCP 配置](content/配置管理/MCP%20配置.md) | MCP 服务器配置 |

### 外部资源

- [MCP 协议文档](https://modelcontextprotocol.io/) - Model Context Protocol 官方文档
- [Yunzai-Bot 文档](https://github.com/yoimiya-kokomi/Miao-Yunzai) - Yunzai-Bot V3 文档
- [OpenAI API 文档](https://platform.openai.com/docs/) - OpenAI 官方 API 文档
- [Google Gemini 文档](https://ai.google.dev/docs) - Gemini API 文档
- [Anthropic Claude 文档](https://docs.anthropic.com/) - Claude API 文档

---

如有问题，欢迎提交 Issue 或加入开发者交流群。
