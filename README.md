# ChatAI Plugin - Yunzai AI 聊天插件

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-XxxXTeam%2Fchatai--plugin-blue?logo=github)](https://github.com/XxxXTeam/chatai-plugin)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-yellow)

**一款功能强大的 Yunzai-Bot AI 聊天插件，集成多种 LLM 模型和丰富的工具调用能力**

[安装指南](#-安装) • [快速开始](#-快速开始) • [配置说明](#️-配置说明) • [常见问题](#-常见问题)

</div>

---

## ✨ 功能特点

| 功能 | 说明 |
|------|------|
| 🤖 **多模型支持** | OpenAI (GPT-4o/O1)、Google Gemini、Anthropic Claude、DeepSeek、通义千问等 |
| 🔧 **MCP 工具调用** | 内置 50+ 实用工具，支持 MCP 协议标准，可自定义扩展 |
| 💬 **智能对话管理** | 多轮上下文记忆、用户/群组会话隔离、可配置的清理策略 |
| 🧠 **长期记忆系统** | 自动提取关键信息、向量相似度搜索、用户画像分析 |
| 🎭 **人格预设系统** | 角色预设管理、独立人格设置、动态变量替换 |
| 🌐 **Web 管理面板** | 可视化配置、实时监控、预设和渠道管理 |
| 🎙️ **AI 语音合成** | 支持 GPT-SoVITS、Fish-Audio 等语音合成服务 |

---

## 📦 安装

### 环境要求

| 依赖 | 版本要求 | 说明 |
|------|----------|------|
| Node.js | >= 18 | 推荐使用 LTS 版本 |
| pnpm | >= 8.0 | 推荐使用 pnpm 作为包管理器 |
| Yunzai-Bot | V3 | 支持 [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) / [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai) |
| Redis | 可选 | 用于缓存和会话存储 |

### 安装步骤

#### 1. 克隆插件

在 **Yunzai 根目录** 下执行：

```bash
git clone --depth=1 https://github.com/XxxXTeam/chatai-plugin.git ./plugins/chatai-plugin
```

#### 2. 安装依赖并构建原生模块

在 **Yunzai 根目录** 下执行：

```bash
pnpm install
pnpm approve-builds
```

> ⚠️ **重要**：`pnpm approve-builds` 会编译 SQLite 原生模块，**必须执行**

<details>
<summary><b>常见构建问题</b></summary>

| 问题 | 解决方案 |
|------|----------|
| **缺少编译工具** | Ubuntu/Debian: `sudo apt install build-essential python3`<br>CentOS/RHEL: `sudo yum groupinstall "Development Tools"`<br>Windows: 安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) |
| **node-gyp 错误** | `npm install -g node-gyp` |
| **Python 未找到** | 确保 Python 3 已安装并在 PATH 中 |
| **权限问题** | Linux/macOS: 不要使用 `sudo`，确保目录权限正确 |

</details>

#### 3. 启动 Yunzai

返回 **Yunzai 根目录** 启动：

```bash
cd ../..
pnpm start
# 或
node app
```

#### 4. 首次配置

启动成功后，向机器人发送以下命令获取管理面板：

```
#ai管理面板
```

机器人会返回一个临时登录链接，点击进入 Web 管理面板完成配置：

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | **添加渠道** | 配置 API 密钥、Base URL 和可用模型 |
| 2 | **设置触发** | 选择 @触发、前缀触发或两者兼用 |
| 3 | **配置预设** | 设置默认人格和系统提示词 |
| 4 | **测试连接** | 在渠道管理中测试 API 连接是否正常 |

> 💡 **提示**：发送 `#ai管理面板 永久` 可获取永久有效的登录链接

---

### 更新插件

```bash
# 方式一：使用命令更新（推荐）
#ai更新

# 方式二：手动更新
cd plugins/chatai-plugin
git pull
cd ../..
pnpm install
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
chatai-plugin/
├── apps/                   # 应用模块
│   ├── chat.js            # 主聊天功能
│   ├── ChatListener.js    # 消息监听器
│   ├── Management.js      # 管理命令
│   ├── GroupEvents.js     # 群事件处理
│   └── ...                # 其他功能模块
├── config/                 # 配置文件
│   └── config.js          # 配置管理器
├── data/                   # 数据目录（运行时生成）
│   ├── *.db               # SQLite 数据库文件
│   └── mcp-servers.json   # MCP 服务器配置
├── resources/              # 资源文件
│   └── web/               # Web 前端构建产物
├── src/                    # 源代码
│   ├── core/              # 核心模块
│   │   ├── adapters/      # LLM 适配器（OpenAI/Gemini/Claude）
│   │   └── utils/         # 核心工具函数
│   ├── mcp/               # MCP 模块
│   │   ├── tools/         # 内置工具实现
│   │   ├── BuiltinMcpServer.js
│   │   ├── McpClient.js
│   │   └── McpManager.js
│   ├── services/          # 服务模块
│   │   ├── llm/           # LLM 相关服务
│   │   ├── media/         # 媒体处理服务
│   │   ├── storage/       # 存储服务（数据库/记忆/知识库）
│   │   └── webServer.js   # Web 管理面板服务
│   └── utils/             # 工具函数
├── frontend/          # Next.js 前端源码（开发用）
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

## ❓ 常见问题

<details>
<summary><b>Q: 安装依赖时报错 better-sqlite3 编译失败？</b></summary>

确保已安装编译工具：
```bash
# Ubuntu/Debian
sudo apt install build-essential python3

# CentOS/RHEL
sudo yum groupinstall "Development Tools"

# 然后重新构建
pnpm rebuild better-sqlite3
```
</details>

<details>
<summary><b>Q: 启动时提示 "数据库初始化失败"？</b></summary>

1. 确保已执行 `pnpm run rebuild` 或 `pnpm rebuild better-sqlite3`
2. 检查 `data/` 目录是否有写入权限
3. 尝试删除 `data/*.db` 文件后重启
</details>

<details>
<summary><b>Q: AI 不回复消息？</b></summary>

1. 检查是否配置了有效的 API 渠道（发送 `#ai管理面板` 进入配置）
2. 检查触发方式是否正确（@机器人 或 前缀触发）
3. 查看 Yunzai 控制台日志是否有错误信息
</details>

<details>
<summary><b>Q: 如何更新插件？</b></summary>

```bash
# 方式一：使用命令更新
发送：#ai更新

# 方式二：手动更新
cd plugins/chatai-plugin
git pull
pnpm install
pnpm run rebuild
```
</details>

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📝 更新日志

### v1.0.0 (2024-12)
- 🎉 初始版本发布
- ✨ 支持 OpenAI, Gemini, Claude 等多模型
- ✨ 内置 50+ 实用工具调用
- ✨ 现代化 Web 管理面板
- ✨ 长期记忆与向量检索系统
- ✨ 人格预设与独立人格管理
- ✨ MCP 协议完整支持
- ✨ AI 语音合成集成

---

## 📄 许可证

本项目基于 [MIT 许可证](LICENSE) 开源。

---

## ⚠️ 免责声明

- 本插件仅供学习交流使用
- 请遵守相关法律法规和平台服务条款
- 使用 AI 服务需遵守对应服务商的使用条款
- 内置的群管理工具（如踢人、禁言等）属于敏感操作，请谨慎使用
- AI 生成的内容可能存在错误或偏见，请勿完全依赖
- 建议在生产环境中禁用危险工具（`builtinTools.allowDangerous: false`）
- 开发者不对使用本插件造成的任何后果负责

---

## 💖 鸣谢

### 原项目

本项目基于 [chatgpt-plugin](https://github.com/ikechan8370/chatgpt-plugin) 重构开发，感谢 **ikechan8370** 及原项目所有贡献者的付出！

### 内测用户

感谢以下用户在内测期间提供的宝贵建议、反馈和 Bug 报告：

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/haanxuan">
        <img src="https://github.com/haanxuan.png" width="80px;" alt="haanxuan"/><br/>
        <sub><b>haanxuan</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/HHXXYY123">
        <img src="https://github.com/HHXXYY123.png" width="80px;" alt="HHXXYY123"/><br/>
        <sub><b>HHXXYY123</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/dndss">
        <img src="https://github.com/dndss.png" width="80px;" alt="dndss"/><br/>
        <sub><b>dndss</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/ColdMoonBUG">
        <img src="https://github.com/ColdMoonBUG.png" width="80px;" alt="ColdMoonBUG"/><br/>
        <sub><b>ColdMoonBUG</b></sub>
      </a>
    </td>
  </tr>
</table>

### 相关项目

- [Yunzai-Bot](https://gitee.com/Le-niao/Yunzai-Bot) - QQ 机器人框架
- [Miao-Yunzai](https://github.com/yoimiya-kokomi/Miao-Yunzai) - Yunzai V3 版本
- [TRSS-Yunzai](https://github.com/TimeRainStarSky/Yunzai) - TRSS 版 Yunzai
- [OpenAI](https://openai.com/) - GPT 系列模型
- [Google Gemini](https://ai.google.dev/) - Gemini 系列模型
- [Anthropic Claude](https://www.anthropic.com/) - Claude 系列模型
- [MCP Protocol](https://modelcontextprotocol.io/) - Model Context Protocol

---

<div align="center">

**如果觉得本项目对你有帮助，欢迎 Star ⭐**

[![Star History Chart](https://api.star-history.com/svg?repos=XxxXTeam/chatai-plugin&type=Date)](https://star-history.com/#XxxXTeam/chatai-plugin&Date)

</div>
