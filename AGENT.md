# ChatAI Plugin - Agent 开发指南

本文档为 AI Agent 提供项目的完整上下文，帮助快速理解和参与开发。

## 项目概述

**ChatAI Plugin** 是一个 Yunzai-Bot 的 AI 聊天插件，支持多种大语言模型 (OpenAI、Claude、Gemini)，具备 MCP 工具调用、记忆系统、Web 管理面板等功能。

### 技术栈
| 类别 | 技术 |
|------|------|
| 运行时 | Node.js >= 18 |
| 模块系统 | ES Module (`import/export`) |
| 框架 | Yunzai-Bot 插件系统 |
| AI SDK | OpenAI, Anthropic Claude, Google Generative AI |
| Web 服务 | Express |
| 前端 | React (frontend/) |
| 数据库 | better-sqlite3 |
| 代码规范 | Prettier, Conventional Commits |

---

## 项目架构

```
chatgpt-plugin/
├── index.js              # 插件入口，初始化和导出
├── apps/                 # 插件模块 (Yunzai 插件类)
│   ├── chat.js           # 核心聊天功能
│   ├── Commands.js       # 命令系统 (#指令)
│   ├── ImageGen.js       # AI 绘图
│   ├── Management.js     # 群管理
│   ├── GroupEvents.js    # 群事件处理
│   └── ...
├── src/
│   ├── core/             # 核心模块
│   │   ├── adapters/     # LLM 适配器
│   │   │   ├── AbstractClient.js  # 基类
│   │   │   ├── openai/   # OpenAI 实现
│   │   │   ├── claude/   # Claude 实现
│   │   │   └── gemini/   # Gemini 实现
│   │   ├── cache/        # 缓存系统
│   │   ├── types/        # 类型定义
│   │   └── utils/        # 核心工具函数
│   ├── services/         # 服务层
│   │   ├── agent/        # Agent 系统
│   │   │   ├── ChatAgent.js    # 聊天智能体
│   │   │   └── SkillsAgent.js  # 技能执行器
│   │   ├── llm/          # LLM 服务
│   │   │   └── ChatService.js  # 聊天服务
│   │   ├── memory/       # 记忆系统
│   │   ├── storage/      # 存储服务
│   │   ├── skills/       # 技能系统
│   │   ├── preset/       # 预设系统
│   │   ├── proxy/        # 代理服务
│   │   ├── routes/       # API 路由
│   │   └── webServer.js  # Express 服务器
│   ├── mcp/              # MCP 工具系统
│   │   ├── McpManager.js      # 工具管理器
│   │   ├── McpClient.js       # MCP 客户端
│   │   ├── BuiltinMcpServer.js # 内置服务器
│   │   └── tools/             # 工具实现
│   │       ├── message.js     # 消息工具
│   │       ├── search.js      # 搜索工具
│   │       ├── media.js       # 媒体工具
│   │       ├── group.js       # 群组工具
│   │       ├── memory.js      # 记忆工具
│   │       ├── schedule.js    # 定时任务
│   │       └── ...
│   └── utils/            # 通用工具
├── config/               # 配置文件
│   ├── config.js         # 配置管理类
│   └── default.yaml      # 默认配置
├── frontend/             # Web 管理面板 (React)
├── data/                 # 运行时数据
├── resources/            # 静态资源
└── docs/                 # 文档
```

---

## 核心模块说明

### 1. 插件入口 (`index.js`)
- 初始化全局配置 `global.chatgptPluginConfig`
- 启动 Web 服务器
- 加载 Skills 系统和 MCP 工具
- 导出 `apps` 和 `skills` 接口

### 2. Apps 模块 (`apps/`)
Yunzai-Bot 插件类，处理用户交互：
```javascript
export class Chat extends plugin {
    constructor() {
        super({
            name: 'AI-Chat',
            event: 'message',
            rule: [{ reg: '', fnc: 'handleMessage' }]
        })
    }
    async handleMessage() { /* ... */ }
}
```

### 3. LLM 适配器 (`src/core/adapters/`)
统一的 LLM 调用接口：
```javascript
class AbstractClient {
    async chat(messages, options)      // 普通聊天
    async chatStream(messages, options) // 流式聊天
    formatMessages(messages)            // 消息格式转换
}
```

### 4. MCP 工具 (`src/mcp/tools/`)
工具定义格式：
```javascript
{
    name: 'tool_name',
    description: '工具描述',
    parameters: { /* JSON Schema */ },
    handler: async (params, context) => {
        return { success: true, data: result }
    }
}
```

### 5. 配置系统 (`config/`)
- `config.get('key.subkey')` 读取配置
- `config.set('key', value)` 设置配置
- 全局访问: `global.chatgptPluginConfig`

---

## 数据流

### 消息处理流程
```
用户消息 → apps/chat.js (handleMessage)
         → src/services/llm/ChatService.js
         → src/core/adapters/* (LLM 调用)
         → [MCP 工具调用 (如有)]
         → 响应返回
```

### 工具调用流程
```
LLM 返回工具调用 → McpManager.executeTool()
                → tools/*.js (具体工具)
                → 结果返回给 LLM
```

---

## 代码规范

### 命名约定
| 类型 | 规范 | 示例 |
|------|------|------|
| 变量/函数 | camelCase | `getUserInfo` |
| 类 | PascalCase | `ChatService` |
| 常量 | UPPER_SNAKE_CASE | `MAX_TOKENS` |
| 文件 | camelCase 或 PascalCase | `chatService.js` |
| MCP 工具名 | snake_case | `send_message` |

### 异步处理
```javascript
// ✅ 推荐
const result = await asyncFunction()

// ❌ 避免
asyncFunction().then(result => { ... })
```

### 错误处理
```javascript
try {
    const result = await riskyOperation()
    return { success: true, data: result }
} catch (error) {
    chatLogger.error('Tag', '错误描述:', error)
    return { success: false, error: error.message }
}
```

### 日志系统
```javascript
import { chatLogger } from './src/core/utils/logger.js'

chatLogger.info('Tag', '信息')
chatLogger.warn('Tag', '警告')
chatLogger.error('Tag', '错误', error)
chatLogger.debug('Tag', '调试信息')
```

---

## 提交规范 (Conventional Commits)

### 格式
```
<type>(<scope>): <subject>
```

### Type 类型
| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `refactor` | 重构 |
| `perf` | 性能优化 |
| `chore` | 构建/工具 |

### Scope 范围
| Scope | 说明 |
|-------|------|
| `core` | 核心模块 |
| `mcp` | MCP 相关 |
| `web` | Web 管理面板 |
| `adapter` | LLM 适配器 |
| `tool` | 内置工具 |
| `config` | 配置相关 |

### 示例
```bash
feat(mcp): 添加新的搜索工具
fix(adapter): 修复 Claude 流式响应中断
refactor(core): 重构消息处理流程
```

---

## 关键文件速查

| 需求 | 文件 |
|------|------|
| 理解插件入口 | `index.js` |
| 修改聊天逻辑 | `apps/chat.js` |
| 添加新命令 | `apps/Commands.js` |
| 修改 LLM 调用 | `src/services/llm/ChatService.js` |
| 添加 LLM 适配器 | `src/core/adapters/` |
| 添加 MCP 工具 | `src/mcp/tools/` |
| 修改配置 | `config/config.js` |
| Web API | `src/services/routes/` |
| 记忆系统 | `src/services/memory/` |

---

## 常见开发任务

### 添加新的 MCP 工具
1. 在 `src/mcp/tools/` 中找到合适的文件或创建新文件
2. 定义工具对象 (name, description, parameters, handler)
3. 在 `src/mcp/tools/index.js` 中注册

### 添加新的 LLM 适配器
1. 创建 `src/core/adapters/newprovider/` 目录
2. 继承 `AbstractClient` 实现必要方法
3. 在 `src/core/adapters/index.js` 中注册

### 添加新的命令
1. 在 `apps/Commands.js` 的 rule 数组中添加规则
2. 实现对应的处理函数

### 修改配置项
1. 更新 `config/default.yaml` 添加默认值
2. 使用 `config.get('key')` 读取

---

## Agent Workflows

项目提供了以下 Agent Workflows (`.windsurf/workflows/`):

| 命令 | 用途 |
|------|------|
| `/feature` | 新功能开发 |
| `/bugfix` | Bug 修复 |
| `/context` | 代码理解 |
| `/mcp-tool` | MCP 工具开发 |
| `/adapter` | LLM 适配器开发 |
| `/refactor` | 代码重构 |
| `/review` | 代码审查 |

---

## 注意事项

1. **保持兼容**: 修改时注意向后兼容，特别是导出接口
2. **配置优先**: 可配置的值不要硬编码
3. **错误处理**: 所有异步操作都要有错误处理
4. **日志记录**: 关键操作要有日志，便于调试
5. **代码风格**: 遵循现有代码风格，使用 Prettier 格式化
6. **测试验证**: 修改后确保语法正确 (`node --check <file>`)
