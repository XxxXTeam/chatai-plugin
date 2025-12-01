# New-Plugin - Yunzai AI 聊天插件

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

**一款功能强大的 Yunzai-Bot AI 聊天插件，集成多种 LLM 模型和丰富的工具调用能力**

</div>

## ✨ 功能特点

### 🤖 多模型支持
- **OpenAI** - GPT-3.5, GPT-4, O1 等系列模型
- **Google Gemini** - Gemini Pro, Gemini Flash 等
- **Anthropic Claude** - Claude 3 系列模型
- 支持任意 OpenAI 兼容 API（如 DeepSeek, 通义千问等）

### 🔧 MCP 工具调用
- 内置 50+ 实用工具（发消息、获取群信息、图片处理等）
- 支持 MCP (Model Context Protocol) 标准协议
- 自定义工具扩展能力

### 💬 智能对话管理
- 多轮对话上下文记忆
- 用户/群组独立会话隔离
- 可配置的上下文长度和清理策略

### 🧠 长期记忆系统
- 自动提取对话中的关键信息
- 基于向量数据库的相似度搜索
- 用户画像分析和群聊总结

### 🎭 人格预设系统
- 丰富的角色预设管理
- 用户/群组独立人格设置
- 动态提示词变量替换

### 🌐 Web 管理面板
- 可视化配置管理
- 实时监控和日志查看
- 预设和渠道管理

## 📦 安装

### 前置要求

- Node.js >= 18
- [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot) 或 [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) 或 [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai)
- Redis（可选，用于缓存和会话存储）

### 安装步骤

1. **克隆插件到 Yunzai 插件目录**

```bash
cd Yunzai-Bot/plugins
git clone https://github.com/XxxXTeam/chatgpt-plugin.git new-plugin
```

2. **安装依赖**

```bash
cd new-plugin
pnpm install
# 或
npm install
```

3. **构建前端面板**

```bash
cd vue-frontend
npm install
npm run build
```

4. **配置插件**

编辑 `config/config.yaml`，配置 API 密钥和基础设置：

```yaml
basic:
  toggleMode: at        # 触发模式：at/@机器人, prefix/前缀, both/两者皆可
  togglePrefix: "#chat" # 前缀触发关键词
  commandPrefix: "#ai"  # 管理命令前缀

channels:
  - id: my-openai
    name: OpenAI
    adapterType: openai
    baseUrl: https://api.openai.com/v1
    apiKey: sk-your-api-key
    models:
      - gpt-4o
      - gpt-3.5-turbo
    enabled: true
```

5. **重启 Yunzai**

```bash
# 返回 Yunzai 根目录
cd ../../
pnpm run start
# 或
node app
```

## 🚀 快速开始

### 基础对话

- **@机器人** + 消息内容 - 触发 AI 对话
- **#chat** + 消息内容 - 前缀触发对话（可配置）

### 常用命令

| 命令 | 说明 |
|------|------|
| `#结束对话` | 结束当前对话，清除上下文 |
| `#清除记忆` | 清除用户记忆数据 |
| `#对话状态` | 查看当前对话状态 |
| `#群聊总结` | 总结最近的群聊消息 |
| `#个人画像` | 分析用户个人画像 |
| `#ai帮助` | 显示所有可用命令 |

### 管理命令（需要主人权限）

| 命令 | 说明 |
|------|------|
| `#ai管理面板` | 获取管理面板临时链接 |
| `#ai管理面板 永久` | 获取永久管理面板链接 |
| `#ai状态` | 查看插件运行状态 |
| `#ai更新` | 更新插件到最新版本 |
| `#ai强制更新` | 强制更新（覆盖本地修改） |

## ⚙️ 配置说明

### 基础配置 (`basic`)

```yaml
basic:
  toggleMode: at          # 触发模式
  togglePrefix: "#chat"   # 前缀触发词
  commandPrefix: "#ai"    # 命令前缀
  debug: false            # 调试模式
  showThinkingMessage: true  # 显示"思考中..."提示
  quoteReply: true        # 引用触发消息回复
  autoRecall:
    enabled: false        # 自动撤回
    delay: 60             # 撤回延迟（秒）
```

### 渠道配置 (`channels`)

支持配置多个 API 渠道，实现负载均衡和故障转移：

```yaml
channels:
  - id: openai-main
    name: OpenAI 主渠道
    adapterType: openai   # openai, gemini, claude
    baseUrl: https://api.openai.com/v1
    apiKey: sk-xxx
    models:
      - gpt-4o
      - gpt-4o-mini
    priority: 1
    enabled: true
    advanced:
      streaming:
        enabled: true
      llm:
        temperature: 0.7
        maxTokens: 4000
```

### 上下文配置 (`context`)

```yaml
context:
  maxMessages: 20         # 最大历史消息数
  maxTokens: 8096         # 最大 Token 数
  cleaningStrategy: auto  # 清理策略
  isolation:
    groupUserIsolation: false  # 群聊用户隔离
    privateIsolation: true     # 私聊隔离
```

### 记忆配置 (`memory`)

```yaml
memory:
  enabled: true           # 启用记忆功能
  storage: database       # 存储方式
  autoExtract: true       # 自动提取记忆
  maxMemories: 50         # 每用户最大记忆数
```

### MCP 配置 (`mcp`)

```yaml
mcp:
  enabled: true
  servers:
    filesystem:
      type: stdio
      command: npx
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/']
```

### 内置工具配置 (`builtinTools`)

```yaml
builtinTools:
  enabled: true
  allowedTools: []        # 允许的工具（空=全部）
  disabledTools: []       # 禁用的工具
  dangerousTools:         # 危险工具列表
    - kick_member
    - mute_member
    - recall_message
  allowDangerous: false   # 是否允许危险操作
```

### 伪人模式配置 (`bym`)

```yaml
bym:
  enable: false           # 是否启用
  probability: 0.02       # 随机回复概率
  temperature: 0.9        # 温度参数
  maxTokens: 100          # 最大 Token
  systemPrompt: "你是一个真实的人类用户..."
```

## 🛠️ 内置工具列表

插件内置了丰富的 QQ 机器人操作工具：

### 用户信息
- `get_user_info` - 获取用户信息
- `get_friend_list` - 获取好友列表
- `send_like` - 给好友点赞

### 群组操作
- `get_group_info` - 获取群信息
- `get_group_list` - 获取群列表
- `get_group_member_list` - 获取群成员列表
- `get_group_member_info` - 获取群成员详情
- `get_group_files` - 获取群文件列表

### 消息发送
- `send_private_message` - 发送私聊消息
- `send_group_message` - 发送群消息
- `reply_current_message` - 回复当前消息
- `at_user` - @用户
- `random_at_members` - 随机@群成员
- `make_forward_message` - 发送合并转发消息

### 图片/视频
- `parse_image` - 解析图片
- `send_image` - 发送图片
- `parse_video` - 解析视频
- `send_video` - 发送视频
- `get_avatar` - 获取头像
- `image_ocr` - 图片文字识别

### 群管理（危险操作）
- `set_group_card` - 设置群名片
- `mute_member` - 禁言成员
- `kick_member` - 踢出成员
- `recall_message` - 撤回消息
- `set_group_admin` - 设置管理员
- `set_group_whole_ban` - 全群禁言

### 其他
- `get_current_context` - 获取当前上下文
- `get_chat_history` - 获取聊天记录
- `website` - 访问网页获取内容

## 📁 目录结构

```
new-plugin/
├── apps/                   # 应用模块
│   ├── chat.js            # 主聊天功能
│   ├── ChatListener.js    # 消息监听器
│   ├── Management.js      # 管理命令
│   ├── bym.js             # 伪人模式
│   └── update.js          # 插件更新
├── config/                 # 配置文件
│   ├── config.js          # 配置管理器
│   └── config.yaml        # 配置文件
├── data/                   # 数据目录
├── resources/              # 资源文件
│   └── web/               # 前端构建产物
├── src/                    # 源代码
│   ├── core/              # 核心模块
│   │   ├── adapters/      # LLM 适配器
│   │   ├── cache/         # 缓存模块
│   │   ├── types/         # 类型定义
│   │   └── utils/         # 工具函数
│   ├── mcp/               # MCP 模块
│   │   ├── BuiltinMcpServer.js  # 内置 MCP 服务器
│   │   ├── McpClient.js   # MCP 客户端
│   │   └── McpManager.js  # MCP 管理器
│   ├── services/          # 服务模块
│   │   ├── ChatService.js      # 聊天服务
│   │   ├── ContextManager.js   # 上下文管理
│   │   ├── ChannelManager.js   # 渠道管理
│   │   ├── DatabaseService.js  # 数据库服务
│   │   ├── ImageService.js     # 图片服务
│   │   ├── KeyManager.js       # API Key 管理
│   │   ├── LlmService.js       # LLM 服务
│   │   ├── MemoryManager.js    # 记忆管理
│   │   ├── PresetManager.js    # 预设管理
│   │   ├── ScopeManager.js     # 作用域管理
│   │   └── webServer.js        # Web 服务器
│   └── utils/             # 工具函数
├── utils/                  # 公共工具
├── vue-frontend/           # 前端源码
│   ├── src/               # Vue 源代码
│   ├── package.json       # 前端依赖
│   └── vite.config.js     # Vite 配置
├── index.js               # 插件入口
└── package.json           # 项目配置
```

## 🌐 Web 管理面板

插件提供了功能完善的 Web 管理面板：

### 访问方式

1. 发送命令 `#ai管理面板` 获取临时访问链接
2. 发送命令 `#ai管理面板 永久` 获取永久访问链接
3. 默认端口：3000

### 面板功能

- **基础配置** - 触发方式、命令前缀等
- **渠道管理** - API 渠道配置、测试连接
- **预设管理** - 角色预设的增删改查
- **工具管理** - 内置/自定义工具配置
- **记忆管理** - 用户记忆查看和管理
- **MCP 服务器** - MCP 服务器连接管理
- **高级设置** - 上下文、记忆、思考等配置

## 🔌 API 兼容性

### 支持的 OpenAI 兼容 API

插件支持任何遵循 OpenAI API 格式的服务商：

- OpenAI 官方
- Azure OpenAI
- DeepSeek
- 通义千问
- 智谱 AI
- Moonshot (Kimi)
- 零一万物
- OpenRouter
- 其他 OpenAI 兼容 API

### 配置示例

```yaml
# DeepSeek
channels:
  - id: deepseek
    adapterType: openai
    baseUrl: https://api.deepseek.com/v1
    apiKey: sk-xxx
    models:
      - deepseek-chat
      - deepseek-coder

# 通义千问
channels:
  - id: qwen
    adapterType: openai
    baseUrl: https://dashscope.aliyuncs.com/compatible-mode/v1
    apiKey: sk-xxx
    models:
      - qwen-turbo
      - qwen-plus
```

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📝 更新日志

### v1.0.0
- 🎉 初始版本发布
- ✨ 支持 OpenAI, Gemini, Claude 多模型
- ✨ 内置 50+ 工具调用
- ✨ Web 管理面板
- ✨ 长期记忆系统
- ✨ 人格预设管理
- ✨ MCP 协议支持

## 📄 许可证

本项目基于 MIT 许可证开源。

## ⚠️ 免责声明

- 本插件仅供学习交流使用
- 请遵守相关法律法规和平台规定
- 使用 AI 服务需遵守对应服务商的使用条款
- 内置的群管理工具（如踢人、禁言等）属于敏感操作，请谨慎使用
- AI 生成的内容可能存在错误或偏见，请勿完全依赖
- 建议在生产环境中禁用危险工具（通过 `builtinTools.allowDangerous: false`）
- 开发者不对使用本插件造成的任何后果负责

## 💖 鸣谢

- [Yunzai-Bot](https://github.com/Le-niao/Yunzai-Bot)
- [OpenAI](https://openai.com/)
- [Google Gemini](https://ai.google.dev/)
- [Anthropic Claude](https://www.anthropic.com/)
- [MCP Protocol](https://modelcontextprotocol.io/)
