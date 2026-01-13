# ChatAI Plugin 架构文档

本文档详细说明项目的核心架构设计，包括 MCP（Model Context Protocol）与 Skills Agent 的关系、工具系统的层次结构、以及各类型工具的连接与维护。

## 目录

- [概念定义](#概念定义)
- [架构层次](#架构层次)
- [MCP 模块详解](#mcp-模块详解)
- [Skills Agent 详解](#skills-agent-详解)
- [工具类型与连接](#工具类型与连接)
- [数据流与调用链路](#数据流与调用链路)

---

## 概念定义

### MCP (Model Context Protocol)

**MCP** 是一套标准化的协议规范，由 Anthropic 提出，用于定义 AI 模型与外部工具/资源的交互方式。在本项目中，MCP 模块负责：

- 管理与外部 MCP 服务器的连接（stdio、npm、SSE、HTTP）
- 提供统一的工具调用接口
- 处理协议层面的初始化、心跳、重连等

**核心组件**：
| 组件 | 文件 | 职责 |
|------|------|------|
| McpManager | `src/mcp/McpManager.js` | 统一管理所有工具来源，协调内置/外部工具 |
| McpClient | `src/mcp/McpClient.js` | MCP 客户端实现，支持多种传输协议 |
| BuiltinMcpServer | `src/mcp/BuiltinMcpServer.js` | 内置工具服务器，管理模块化工具和 JS 工具 |

### Skills Agent

**Skills Agent** 是在 MCP 之上的高层抽象，为业务层提供更友好的接口。它：

- 整合所有工具来源为统一的"技能"概念
- 提供权限过滤、参数自动填充等业务逻辑
- 支持按预设、用户、群组等维度的工具访问控制

**核心组件**：
| 组件 | 文件 | 职责 |
|------|------|------|
| SkillsAgent | `src/services/agent/SkillsAgent.js` | 统一技能代理，提供业务友好的工具调用接口 |
| ToolFilterService | `src/services/tools/ToolFilterService.js` | 工具过滤与权限控制服务 |

### 关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                        业务层 (Apps)                             │
│                    chat.js / ChatListener.js                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │ 调用
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Skills Agent 层                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  SkillsAgent                                             │    │
│  │  - 统一技能接口                                          │    │
│  │  - 权限过滤                                              │    │
│  │  - 参数自动填充                                          │    │
│  │  - 执行日志                                              │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬───────────────────────────────────┘
                              │ 调用
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MCP 层                                     │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────┐  │
│  │ McpManager    │ │ McpClient     │ │ BuiltinMcpServer      │  │
│  │ - 工具注册    │ │ - stdio 连接  │ │ - 模块化工具          │  │
│  │ - 服务器管理  │ │ - npm/npx     │ │ - JS 工具             │  │
│  │ - 缓存管理    │ │ - SSE 连接    │ │ - 自定义工具          │  │
│  │ - 调用日志    │ │ - HTTP 连接   │ │ - 文件监听热重载      │  │
│  └───────────────┘ └───────────────┘ └───────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │ 连接
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     工具实现层                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ 内置工具      │ │ JS 工具      │ │ 外部 MCP 服务器          │ │
│  │ src/mcp/tools │ │ data/tools   │ │ npm包/stdio/SSE/HTTP    │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 架构层次

### 1. 工具实现层

最底层，包含实际的工具逻辑：

- **内置模块化工具** (`src/mcp/tools/`)
  - 按功能分类（basic、user、group、message、media 等）
  - 每个类别是独立的 JS 模块
  - 支持配置启用/禁用

- **自定义 JS 工具** (`data/tools/`)
  - 用户编写的工具脚本
  - 支持热重载
  - 访问完整的运行时环境

- **外部 MCP 服务器**
  - npm 包形式（如 `@anthropic/mcp-server-filesystem`）
  - 本地进程（stdio）
  - 远程服务（SSE/HTTP）

### 2. MCP 协议层

处理工具的注册、发现、调用：

```javascript
// McpManager 核心功能
class McpManager {
    // 工具注册表
    tools = new Map()      // name -> tool definition
    servers = new Map()    // name -> server info
    
    // 初始化：加载所有工具源
    async init() {
        await this.initBuiltinServer()     // 内置工具
        await this.initCustomToolsServer() // JS 工具
        await this.loadServers()           // 外部服务器
    }
    
    // 统一调用接口
    async callTool(name, args, options) {
        // 1. 查找工具
        // 2. 权限检查
        // 3. 调用执行
        // 4. 记录日志
    }
}
```

### 3. Skills Agent 层

业务逻辑封装：

```javascript
// SkillsAgent 核心功能
class SkillsAgent {
    // 创建带上下文的代理
    constructor(options) {
        this.event = options.event       // 消息事件
        this.presetId = options.presetId // 预设ID
        this.userId = options.userId     // 用户ID
    }
    
    // 获取可用技能（已过滤）
    getExecutableSkills() {
        // 应用预设配置
        // 过滤危险工具
        // 过滤用户权限
    }
    
    // 执行技能（带业务逻辑）
    async execute(skillName, args) {
        // 1. 权限检查
        // 2. 参数自动填充
        // 3. 调用 McpManager
        // 4. 记录执行日志
    }
}
```

---

## MCP 模块详解

### McpClient - 传输层实现

支持四种传输类型：

#### 1. stdio - 标准输入输出

用于本地进程通信：

```javascript
// 配置示例
{
    type: 'stdio',
    command: 'node',
    args: ['server.js'],
    env: { DEBUG: 'true' }
}
```

#### 2. npm/npx - npm 包

自动安装并运行 npm 包形式的 MCP 服务器：

```javascript
// 配置示例
{
    type: 'npm',
    package: '@anthropic/mcp-server-filesystem',
    args: ['/home/user/documents'],
    env: { }
}
```

支持的热门 npm 包：
- `@anthropic/mcp-server-filesystem` - 文件系统访问
- `@modelcontextprotocol/server-memory` - 知识图谱记忆
- `@anthropic/mcp-server-brave-search` - Brave 搜索
- `@anthropic/mcp-server-github` - GitHub 操作
- `@anthropic/mcp-server-fetch` - HTTP 请求

#### 3. SSE - Server-Sent Events

用于远程服务的实时连接：

```javascript
// 配置示例
{
    type: 'sse',
    url: 'https://mcp.example.com/sse',
    headers: {
        'Authorization': 'Bearer xxx'
    }
}
```

工作流程：
1. 连接 SSE 端点
2. 接收 `endpoint` 事件获取消息端点
3. POST 请求发送到消息端点
4. 通过 SSE 流接收响应

#### 4. HTTP - Streamable HTTP

用于无状态的 HTTP API：

```javascript
// 配置示例
{
    type: 'http',
    url: 'https://api.example.com/mcp',
    headers: {
        'Authorization': 'Bearer xxx'
    }
}
```

支持的响应格式：
- 标准 JSON-RPC 响应
- SSE 流式响应 (Streamable HTTP)

### BuiltinMcpServer - 内置工具管理

管理所有内置工具：

```javascript
class BuiltinMcpServer {
    // 模块化工具（按类别组织）
    modularTools = []
    toolCategories = {}
    
    // JS 文件工具
    jsTools = new Map()
    
    // 文件监听器（热重载）
    fileWatchers = []
    
    // 加载模块化工具
    async loadModularTools() {
        // 从 src/mcp/tools/ 加载
        // 根据配置过滤启用的类别
    }
    
    // 加载 JS 工具
    async loadJsTools() {
        // 从 data/tools/ 加载
        // 支持热重载
    }
}
```

---

## Skills Agent 详解

### 创建与初始化

```javascript
// 方式 1: 工厂函数
const agent = await createSkillsAgent({
    event: e,           // 消息事件
    presetId: 'default', // 预设ID
    includeMcpTools: true,
    includeBuiltinTools: true
})

// 方式 2: 类构造
const agent = new SkillsAgent({
    userId: '123456',
    groupId: '789',
    userPermission: 'admin'
})
await agent.init()
```

### 工具过滤机制

```
┌─────────────────────────────────────────────────┐
│            所有注册的工具                        │
└─────────────────────┬───────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────┐
│ 1. 配置过滤                                      │
│    - builtinTools.enabledCategories             │
│    - builtinTools.disabledTools                 │
└─────────────────────┬───────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────┐
│ 2. 预设过滤                                      │
│    - preset.allowedTools                        │
│    - preset.excludedTools                       │
└─────────────────────┬───────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────┐
│ 3. 权限过滤                                      │
│    - 危险工具检查                               │
│    - 用户权限检查                               │
└─────────────────────┬───────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────┐
│            可用工具列表                          │
└─────────────────────────────────────────────────┘
```

### 静态方法 vs 实例方法

| 方法类型 | 用途 | 示例 |
|----------|------|------|
| 静态方法 | MCP 服务器管理，无需上下文 | `SkillsAgent.getMcpServers()` |
| 实例方法 | 工具执行，需要用户上下文 | `agent.execute('get_time', {})` |

```javascript
// 静态方法 - 管理操作
const servers = SkillsAgent.getMcpServers()
await SkillsAgent.connectMcpServer('my-server', config)
await SkillsAgent.reloadAllTools()

// 实例方法 - 执行操作
const result = await agent.execute('send_message', { text: 'Hello' })
const skills = agent.getSkillsByCategory('message')
```

---

## 工具类型与连接

### 工具来源分类

| 来源 | serverName | 说明 | 配置位置 |
|------|------------|------|----------|
| 内置模块化 | `builtin` | 核心功能工具 | `src/mcp/tools/` |
| 自定义JS | `custom-tools` | 用户脚本 | `data/tools/` |
| 外部MCP | 自定义名称 | npm/stdio/SSE/HTTP | `data/mcp-servers.json` |

### MCP 服务器配置格式

```json
{
  "servers": {
    "filesystem": {
      "type": "npm",
      "package": "@anthropic/mcp-server-filesystem",
      "args": ["/home/user/docs"]
    },
    "memory": {
      "type": "npm",
      "package": "@modelcontextprotocol/server-memory"
    },
    "remote-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    },
    "realtime-service": {
      "type": "sse",
      "url": "https://mcp.example.com/sse"
    },
    "local-server": {
      "type": "stdio",
      "command": "python",
      "args": ["mcp_server.py"],
      "env": {
        "DEBUG": "1"
      }
    }
  }
}
```

### 连接生命周期

```
┌─────────┐     ┌───────────┐     ┌───────────┐     ┌─────────┐
│ 配置加载 │ --> │ 连接建立   │ --> │ 初始化    │ --> │ 就绪    │
└─────────┘     └───────────┘     └───────────┘     └─────────┘
                     │                                   │
                     │ 失败                              │ 断开
                     ▼                                   ▼
                ┌───────────┐                      ┌───────────┐
                │ 重试/错误  │                      │ 自动重连   │
                └───────────┘                      └───────────┘
```

### 工具执行流程

```
请求: callTool('tool_name', { arg1: 'value' })
         │
         ▼
    ┌─────────────────┐
    │ 1. 查找工具定义  │
    │    (tools Map)  │
    └────────┬────────┘
             ▼
    ┌─────────────────┐
    │ 2. 权限检查      │
    │ - 危险工具拦截   │
    │ - 禁用工具检查   │
    └────────┬────────┘
             ▼
    ┌─────────────────┐
    │ 3. 参数验证      │
    │    (JSON Schema) │
    └────────┬────────┘
             ▼
    ┌─────────────────┐
    │ 4. 路由到处理器  │
    │ - builtin: 本地 │
    │ - external: RPC │
    └────────┬────────┘
             ▼
    ┌─────────────────┐
    │ 5. 执行并格式化  │
    │    结果         │
    └────────┬────────┘
             ▼
    ┌─────────────────┐
    │ 6. 记录日志     │
    │   & 缓存结果    │
    └─────────────────┘
```

---

## 数据流与调用链路

### 消息处理流程

```
用户消息
    │
    ▼
ChatListener.js
    │ 解析触发词
    ▼
chat.js
    │ 1. 获取预设配置
    │ 2. 构建上下文
    │ 3. 创建 SkillsAgent
    ▼
SkillsAgent
    │ getExecutableSkills()
    ▼
LLM Adapter (OpenAI/Claude/Gemini)
    │ 调用 AI 模型
    │ 模型返回 tool_calls
    ▼
SkillsAgent.execute()
    │
    ▼
McpManager.callTool()
    │ 路由到正确的工具源
    ▼
执行结果 → 返回给 AI → 生成回复 → 发送给用户
```

### API 路由结构

```
/api
├── /mcp                    # MCP 直接操作（底层）
│   ├── /servers           # 服务器管理
│   ├── /resources         # 资源读取
│   └── /prompts           # 提示词管理
│
├── /skills                 # Skills Agent 接口（推荐）
│   ├── /sse               # SSE 实时状态
│   ├── /status            # 整体状态
│   ├── /tools             # 工具列表
│   ├── /tools/by-source   # 按来源分组
│   ├── /execute           # 执行工具
│   ├── /categories        # 工具类别
│   ├── /reload            # 重载工具
│   └── /mcp/servers       # MCP 服务器管理
│
└── /tools                  # 工具配置（管理面板）
    ├── /builtin           # 内置工具配置
    ├── /custom            # 自定义工具
    ├── /js                # JS 工具管理
    └── /dangerous         # 危险工具配置
```

---

## 最佳实践

### 1. 工具开发建议

- 内置工具放在 `src/mcp/tools/` 按类别组织
- 用户工具放在 `data/tools/` 使用热重载
- 第三方服务使用 MCP 外部服务器接入

### 2. 性能优化

- 启用工具结果缓存（`useCache: true`）
- 使用并行调用（`callToolsParallel`）处理无依赖的工具
- 合理配置心跳间隔（默认 30s）

### 3. 安全考虑

- 生产环境禁用 `allowDangerous`
- 配置 `disabledTools` 禁用不需要的工具
- 使用预设的 `allowedTools` 白名单模式

### 4. 调试技巧

- 开启 `debug` 模式查看详细日志
- 使用 `/api/tools/logs` 查看工具调用记录
- 监控 SSE 事件追踪状态变更

---

## 相关文档

- [工具开发指南](TOOLS.md) - 详细的工具编写教程
- [开发者文档](DEVELOPMENT.md) - 项目开发与贡献指南
- [README](../README.md) - 项目介绍与快速开始
