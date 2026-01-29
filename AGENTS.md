# ChatAI Plugin 项目上下文

## 项目概述

ChatAI Plugin 是一个功能强大的 Yunzai-Bot AI 聊天插件，旨在为 QQ 机器人提供完整的 AI 对话体验。它集成了多种大语言模型（LLM）和丰富的工具调用能力，支持多轮对话、长期记忆、人格预设、主动聊天、智能代理等高级功能。

### 核心特性

- **多模型支持**: OpenAI (GPT-4o/O1)、Google Gemini、Anthropic Claude、DeepSeek、通义千问、月相等
- **MCP 工具调用**: 内置 50+ 实用工具，支持 MCP 协议标准，可自定义扩展
- **智能对话管理**: 多轮上下文记忆、用户/群组会话隔离、可配置的清理策略
- **长期记忆系统**: 自动提取关键信息、向量相似度搜索、用户画像分析
- **人格预设系统**: 角色预设管理、独立人格设置、动态变量替换
- **Web 管理面板**: 可视化配置、实时监控、预设和渠道管理
- **AI 语音合成**: 支持 GPT-SoVITS、Fish-Audio 等语音合成服务
- **智能技能系统**: 基于工具组的智能调度，支持并行工具执行
- **主动聊天功能**: 基于概率和活跃度的自动聊天参与
- **AI绘图功能**: 支持图像生成、编辑和分析
- **事件处理系统**: 戳一戳、表情回应、消息撤回、入群欢迎等事件响应
- **Telemetry 服务**: 插件使用统计和公告推送

## 技术架构

### 项目结构

```
chatai-plugin/
├── apps/                   # 应用模块（Yunzai 插件入口）
│   ├── bym.js              # 伪人模式功能
│   ├── chat.js             # 主聊天功能
│   ├── Commands.js         # 命令处理
│   ├── EmojiThief.js       # 表情窃取功能
│   ├── GroupEvents.js      # 群事件处理
│   ├── ImageGen.js         # 图像生成功能
│   ├── Management.js       # 管理命令
│   ├── MessageInspector.js # 消息检查器
│   ├── Poke.js             # 戳一戳事件响应
│   ├── Reaction.js         # 表情回应处理
│   └── Update.js           # 更新功能
├── config/                 # 配置文件
├── data/                   # 运行时数据（数据库、工具、预设）
├── docs/                   # 文档
├── frontend/               # Web 前端源码（Next.js）
├── resources/web/          # 前端构建产物
├── src/                    # 核心源代码
│   ├── core/              # 核心模块（适配器、缓存、工具）
│   │   ├── adapters/      # LLM 适配器
│   │   ├── cache/         # 缓存管理
│   │   ├── types/         # 类型定义
│   │   └── utils/         # 核心工具函数
│   ├── mcp/               # MCP 模块（工具实现、客户端、管理器）
│   │   ├── tools/         # MCP 工具实现
│   │   ├── BuiltinMcpServer.js
│   │   ├── McpClient.js
│   │   └── McpManager.js
│   ├── services/          # 服务层（LLM、存储、媒体、预设等）
│   │   ├── agent/         # 技能代理系统
│   │   ├── llm/           # LLM 服务和适配器
│   │   ├── media/         # 媒体处理服务
│   │   ├── memory/        # 记忆服务
│   │   ├── middleware/    # 中间件服务
│   │   ├── permission/    # 权限管理服务
│   │   ├── preset/        # 预设管理服务
│   │   ├── proxy/         # 代理服务
│   │   ├── qqbot/         # QQ官方Bot代理服务
│   │   ├── routes/        # Web路由服务
│   │   ├── scheduler/     # 任务调度服务
│   │   ├── scope/         # 作用域管理服务
│   │   ├── skills/        # 技能配置和加载器
│   │   ├── stats/         # 统计服务
│   │   ├── storage/       # 存储服务
│   │   ├── telemetry/     # 遥测服务
│   │   ├── tools/         # 工具服务
│   │   └── webServer.js   # Web服务器主入口
├── index.js               # 插件主入口（导出 apps 和 skills）
└── package.json           # 项目依赖和配置
```

### 核心模块

1. **LLM 适配器层** (`src/core/adapters/`)
   - 统一接口适配不同 LLM 提供商（OpenAI, Gemini, Claude, Qwen 等）
   - 支持流式响应和非流式响应
   - 模型配置管理（对话模型、工具模型、调度模型、图像模型等）

2. **服务层** (`src/services/`)
   - `webServer.js`: Web 管理面板服务入口
   - `agent/`: 技能代理系统，支持工具组和MCP工具管理
   - `llm/`: LLM 服务和适配器管理
   - `storage/`: 数据存储服务（数据库、文件等）
   - `telemetry/`: 遥测服务，统计和公告推送
   - `middleware/`: 中间件服务
   - `permission/`: 权限管理服务
   - `routes/`: API 路由服务
   - `scheduler/`: 任务调度服务
   - `scope/`: 作用域管理服务
   - `stats/`: 统计服务
   - `skills/`: 技能配置和加载器系统
   - `memory/`: 记忆服务，提供结构化记忆功能

3. **MCP 系统** (`src/mcp/`)
   - `McpManager.js`: 统一管理所有 MCP 服务器
   - `McpClient.js`: MCP 客户端实现
   - `BuiltinMcpServer.js`: 内置工具服务器
   - `tools/`: 内置工具实现（按类别组织）

4. **应用层** (`apps/`)
   - `chat.js`: 主聊天功能
   - `Commands.js`: 命令处理
   - `Management.js`: 管理命令
   - `GroupEvents.js`: 群事件处理
   - `bym.js`: 伪人模式
   - `ImageGen.js`: AI绘图功能
   - `Poke.js`: 戳一戳响应
   - `Reaction.js`: 表情回应处理
   - `MessageInspector.js`: 消息检查器

5. **Skills 系统** (`index.js` 导出)
   - 全局技能代理实例管理
   - 工具执行和 MCP 服务器管理接口
   - 支持动态工具加载和启用/禁用管理

## 开发与构建

### 环境要求

- Node.js >= 18 (推荐 LTS 版本)
- pnpm >= 8.0
- 编译工具 (用于 better-sqlite3 原生模块)

### 安装步骤

```bash
# 克隆插件到 Yunzai 目录
git clone --depth=1 https://github.com/XxxXTeam/chatai-plugin.git ./plugins/chatai-plugin

# 在 Yunzai 根目录安装依赖并构建原生模块
cd ../..  # 回到 Yunzai 根目录
pnpm install
pnpm approve-builds  # 必须执行，编译 SQLite 原生模块
```

### 启动方式

```bash
# 在 Yunzai 根目录启动
pnpm start
# 或
node app
```

### 前端开发

```bash
# 进入前端目录
cd plugins/chatai-plugin/frontend

# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建生产版本
pnpm build

# 构建并同步到 resources/web
pnpm export

# ESLint 检查
pnpm lint

# 分析构建产物
pnpm build:analyze
```

### 代码规范

项目使用以下工具保证代码质量：

- **Prettier**: 代码格式化
  - 配置: `.prettierrc`
  - 单引号、4空格缩进、无分号、120字符宽度
- **Husky**: Git 钩子
  - `pre-commit` 钩子自动格式化代码
- **lint-staged**: 暂存文件检查

**格式化命令**: `pnpm format` (插件根目录)

## 配置说明

主要配置文件位于 `config/config.js` 和运行时生成的 `data/config.yaml`。

### 基础配置

```yaml
basic:
  commandPrefix: "#ai"      # AI命令前缀
  debug: false              # 调试模式
  showThinkingMessage: true # 是否发送"思考中..."提示
  debugToConsoleOnly: true  # 调试信息仅输出到控制台
  quoteReply: true          # 是否引用触发消息
  autoRecall:
    enabled: false          # 是否启用自动撤回
    delay: 60               # 撤回延迟（秒）
    recallError: true       # 是否撤回错误消息
```

### LLM 配置

```yaml
llm:
  defaultModel: "qwen/qwen3-next-80b-a3b-instruct" # 默认模型
  defaultChatPresetId: "default" # 默认聊天预设ID
  embeddingModel: "text-embedding-004" # 嵌入模型
  dimensions: 1536          # 嵌入向量维度
  models:                   # 模型分类配置
    chat: ''                # 对话模型 - 用于普通聊天
    tool: ''                # 工具模型 - 用于执行工具调用
    dispatch: ''            # 调度模型 - 用于分析需要调用哪些工具组
    image: ''               # 图像模型 - 用于图像理解和生成
    roleplay: ''            # 伪人模型 - 用于模拟真人回复
    search: ''              # 搜索模型 - 用于联网搜索
  fallback:                 # 备选模型配置
    enabled: true           # 启用备选模型轮询
    models: []              # 备选模型列表
    maxRetries: 3           # 最大重试次数
    retryDelay: 500         # 重试间隔(ms)
    notifyOnFallback: false # 切换模型时是否通知用户
```

### 渠道配置

```yaml
channels: []                # API渠道列表
```

### 伪人模式配置

```yaml
bym:
  enable: false             # 是否启用伪人模式
  enableTools: false        # 是否允许伪人模式使用工具
  probability: 0.02         # 伪人模式触发概率
  temperature: 0.9          # 生成温度
  maxTokens: 100           # 最大生成token数
  recall: false            # 是否撤回消息
  model: ''                # 使用的模型
  systemPrompt: '你是一个真实的人类用户，正在和朋友们聊天...' # 系统提示
  inheritPersonality: true # 继承人格配置
  presetId: ''             # 伪人模式专用预设ID
  processImage: true       # 是否处理图片消息
  exclusiveFeatures: ['groupSummary', 'userPortrait'] # 仅伪人模式可用的功能
```

### 伪人模式群组配置

伪人模式支持群组级别的独立配置：

| 配置项 | 说明 |
|--------|------|
| `bymEnabled` | 是否在该群启用伪人模式 |
| `bymProbability` | 该群的伪人模式触发概率 |
| `bymModel` | 该群使用的伪人模型 |
| `bymTemperature` | 该群的生成温度 |
| `bymMaxTokens` | 该群的最大生成token数 |
| `bymEnableTools` | 该群伪人模式是否允许使用工具 |
| `bymPresetId` | 该群的伪人专用预设（`__default__`使用默认，`__custom__`使用自定义提示词） |
| `bymPrompt` | 该群的自定义伪人提示词（仅bymPresetId为`__custom__`时使用） |

### 伪人模式群组知识库

伪人模式支持群组知识库集成：
- 自动加载群组配置的知识库内容
- 知识库内容会添加到系统提示词中
- 支持预设知识库和群组知识库的混合使用
- 群聊上下文缓冲功能，可基于最近聊天记录自然参与对话

### 主动聊天配置

```yaml
proactiveChat:
  enabled: false            # 全局开关
  pollInterval: 5           # 轮询间隔（分钟）
  minMessagesBeforeTrigger: 10 # 触发前最少需要的群消息数
  maxConcurrentTriggers: 3  # 单次轮询最大触发群数
  baseProbability: 0.05     # 基础触发概率 (5%)
  maxProbability: 0.5       # 最大触发概率上限 (50%)
  quietHoursStart: 0        # 静默开始时间（0-23）
  quietHoursEnd: 6          # 静默结束时间（0-23）
  allowQuietHoursOverride: false # 是否允许在静默时段触发
  # 时段概率乘数
  timePeriodMultipliers: {
    late_night: 0.1,        # 深夜 (0:00-5:00) 大幅降低
    early_morning: 0.3,     # 清晨 (5:00-7:00) 降低
    morning: 1.0,           # 上午 (7:00-12:00) 正常
    afternoon: 1.2,         # 下午 (12:00-18:00) 略高
    evening: 1.5,           # 傍晚 (18:00-21:00) 最活跃
    night: 0.8              # 晚上 (21:00-24:00) 略低
  },
  # 星期乘数
  weekdayMultipliers: {
    0: 1.3,                 # 周日
    1: 0.8,                 # 周一（工作日开始，较低）
    2: 0.9,                 # 周二
    3: 1.0,                 # 周三
    4: 1.0,                 # 周四
    5: 1.2,                 # 周五
    6: 1.4                  # 周六（周末，较高）
  },
  # 活跃度检测配置
  highFreqMessagesPerMinute: 2    # 判定为高频对话的消息速率（条/分钟）
  activeMessagesIn30Min: 15       # 30分钟内达到此消息数判定为活跃
  lowMessagesIn30Min: 3           # 30分钟内低于此消息数判定为低活跃
  deadMinutesWithoutMessage: 120  # 超过此分钟数无消息判定为死群
  inactiveMinutesLimit: 180       # 最近活跃距离现在超过该分钟则不主动触发
  # 活跃度级别乘数
  activityMultipliers: {
    dead: 0,                # 死群不触发
    low: 0.3,               # 低活跃降低概率
    normal: 1.0,            # 正常
    active: 1.5,            # 活跃提高概率
    high_freq: 0.1          # 高频对话中大幅降低（避免打扰）
  },
  model: ''                 # 使用的模型
  systemPrompt: '你是群里的一员，正在查看群聊记录...' # 系统提示
  maxTokens: 150           # 最大生成token数
  temperature: 0.9          # 生成温度
  enabledGroups: []         # 启用的群列表
  blacklistGroups: []       # 黑名单群
  # 防刷屏
  cooldownMinutes: 30       # 同一群触发后的冷却时间（分钟）
  maxDailyMessages: 20      # 每日每群最大主动消息数
  maxHourlyMessages: 5      # 每小时每群最大主动消息数
  # 记忆和上下文
  useGroupContext: true     # 使用群聊上下文
  contextMessageCount: 20   # 携带的上下文消息数
```

### 工具调用配置

```yaml
tools:
  showCallLogs: true        # 显示工具调用日志
  useForwardMsg: true       # 工具日志使用合并转发
  parallelExecution: true   # 启用并行工具执行
  sendIntermediateReply: true # 工具调用前发送模型的中间回复
  useToolGroups: true       # 启用工具组模式
  dispatchFirst: true       # 先用调度模型选择工具组，再用工具模型执行
```

### 工具组定义

```yaml
toolGroups:                 # 工具组定义
  - index: 0
    name: 'system'
    description: '系统工具：获取时间、日期、系统信息等'
    tools: ['get_time', 'get_date', 'get_system_info']
  - index: 1
    name: 'qq'
    description: 'QQ操作：发消息、获取群信息、管理成员等'
    tools: ['send_message', 'get_group_info', 'get_member_info', 'kick_member', 'mute_member']
  - index: 2
    name: 'web'
    description: '网络工具：搜索、获取网页内容、访问URL等'
    tools: ['web_search', 'fetch_url', 'read_webpage']
  - index: 3
    name: 'file'
    description: '文件操作：读写文件、列目录等'
    tools: ['read_file', 'write_file', 'list_directory']
  - index: 4
    name: 'memory'
    description: '记忆管理：保存和检索用户记忆'
    tools: ['save_memory', 'get_memory', 'search_memory']
  - index: 5
    name: 'image'
    description: '图像处理：生成、编辑、分析图片'
    tools: ['generate_image', 'edit_image', 'analyze_image']
```

### MCP 工具配置

```yaml
builtinTools:
  enabled: true
  allowedTools: []          # 允许的工具（空=全部）
  disabledTools: []         # 禁用的工具
  dangerousTools:           # 危险工具列表
    - kick_member
    - mute_member
    - recall_message
  allowDangerous: false     # 是否允许危险操作
```

### 技能系统配置 (Skills)

新增独立的 `skills.yaml` 配置文件，用于管理技能系统的独立配置，与 MCP 服务器配置解耦：

```yaml
skills:
  enabled: true
  mode: 'hybrid'            # 'hybrid', 'skills-only', 'mcp-only'
  sources:
    builtin:
      enabled: true
      categories: []        # 空数组表示启用所有类别
      disabledTools: []     # 禁用的工具列表
    custom:
      enabled: true
      path: 'data/tools'    # 自定义工具路径
      autoReload: true      # 自动重载
    mcp:
      enabled: true
      servers: []           # 启用的MCP服务器（空表示全部）
      disabledServers: []   # 禁用的MCP服务器
  groups: []                # 工具组配置
  execution:
    timeout: 30000          # 工具执行超时时间
    maxParallel: 5          # 最大并行执行数
    retryOnError: false     # 错误重试
    maxRetries: 2           # 最大重试次数
    cacheResults: true      # 缓存结果
    cacheTTL: 60000         # 缓存TTL
  dispatch:
    enabled: true           # 调度功能启用
    useSummary: true        # 使用摘要模式
    maxGroups: 3            # 最大工具组数
  security:
    dangerousTools: ['kick_member', 'mute_member', 'recall_message', 'set_group_admin', 'write_file']
    allowDangerous: false   # 是否允许危险操作
    dangerousRequiredPermission: 'admin'  # 危险工具需要的权限
```

### 上下文管理配置

```yaml
context:
  maxMessages: 20           # 最大消息数
  maxTokens: 4000          # 最大token数
  cleaningStrategy: 'auto'  # 清理策略
  autoSummarize:            # 自动总结配置
    enabled: true
    intervalMinutes: 10
    maxMessagesBefore: 60
    minInactiveMinutes: 30  # 在该时间段无人发言才会总结
    retainMessagesAfterSummary: 0  # 总结后保留的最近消息数量
    model: ''               # 总结使用的模型（留空使用默认）
    maxTokens: 400          # 总结输出长度
    windowMessages: 80      # 参与总结的最多消息数
  isolation:                # 隔离模式配置
    groupUserIsolation: false # 群聊用户隔离
    privateIsolation: true  # 私聊隔离
  autoContext:              # 自动上下文配置
    enabled: true
    maxHistoryMessages: 20
    includeToolCalls: false # 是否包含工具调用记录
  autoEnd:                  # 自动结束对话
    enabled: false
    maxRounds: 50
    notifyUser: true        # 结束时是否通知用户
    notifyMessage: '对话已达到最大轮数限制，已自动开始新会话。'
  groupContextSharing: true # 群聊上下文传递
  globalSystemPrompt: ''    # 全局系统提示词
  globalPromptMode: 'append' # 全局提示词模式: append(追加) | prepend(前置) | override(覆盖)
```

### 记忆管理配置

```yaml
memory:
  enabled: false            # 启用记忆系统
  storage: 'database'       # 存储方式
  autoExtract: true         # 自动从对话提取记忆
  pollInterval: 5           # 轮询间隔（分钟）
  maxMemories: 50          # 每用户最大记忆数
  model: ''                 # 记忆提取使用的模型（留空使用默认模型）
  groupContext:             # 群聊上下文采集
    enabled: true
    collectInterval: 10
    maxMessagesPerCollect: 50
    analyzeThreshold: 20    # 触发分析的最小消息数
    extractUserInfo: true   # 提取用户信息作为记忆
    extractTopics: true     # 提取讨论话题
    extractRelations: true  # 提取用户关系
```

### 预设和人格配置

```yaml
presets:
  defaultId: 'default'      # 默认预设ID
  allowUserSwitch: true     # 是否允许用户切换预设
  perUserPreset: false      # 每个用户独立预设
  perGroupPreset: false     # 每个群组独立预设

personality:
  priority: ['group', 'group_user', 'user', 'default'] # 人格优先级
  useIndependent: true      # 启用独立人格
  isolateContext:           # 独立人格上下文设置
    enabled: false
    clearOnSwitch: false
```

### 渲染和显示配置

```yaml
render:
  mathFormula: true         # 启用数学公式自动渲染为图片
  theme: 'light'           # 渲染主题
  width: 800               # 渲染宽度

thinking:
  enabled: true            # 思考适配总开关
  defaultLevel: 'low'      # 思考深度
  enableReasoning: false   # 启用推理模式
  showThinkingContent: true # 显示思考内容
  useForwardMsg: true      # 思考内容使用合并转发
```

### 高级功能配置

```yaml
features:
  groupSummary:
    enabled: true          # 群聊总结功能
    maxMessages: 100       # 总结最近N条消息
    autoTrigger: false     # 自动触发
    maxChars: 6000         # 总结最大字符数
    push:                  # 定时推送配置
      enabled: false
      intervalType: 'day'
      intervalValue: 1
      pushHour: 20         # 每日推送时间（小时，0-23）
      messageCount: 100    # 总结消息数量
      model: ''            # 总结使用的模型（留空使用默认）
  userPortrait:
    enabled: true          # 个人画像分析
    minMessages: 10        # 最少需要N条消息才能分析
  poke:
    enabled: false         # 戳一戳响应
    pokeBack: false        # 是否回戳
    message: '别戳了~'     # AI失败时的默认回复
  reaction:
    enabled: false         # 表情回应处理
    prompt: ''             # 添加回应的提示词模板
    removePrompt: ''       # 取消回应的提示词模板
  recall:
    enabled: false         # 消息撤回响应
    aiResponse: true       # 使用AI响应撤回
    prompt: ''             # 自定义提示词（留空使用默认）
  welcome:
    enabled: false         # 入群欢迎
    message: ''            # 默认欢迎语
    prompt: ''             # 自定义提示词（留空使用默认）
  goodbye:
    enabled: false         # 退群通知
    aiResponse: false      # 使用AI响应退群
    prompt: ''             # 自定义提示词（留空使用默认）
  ban:
    enabled: false         # 禁言事件响应
    aiResponse: true       # 使用AI响应禁言
    prompt: ''             # 自定义提示词（留空使用默认）
  admin:
    enabled: false         # 管理员变更响应
    prompt: ''             # 自定义提示词（留空使用默认）
  luckyKing:
    enabled: false         # 运气王响应
    congratulate: false    # 祝贺他人成为运气王
    prompt: ''             # 自定义提示词（留空使用默认）
  honor:
    enabled: false         # 荣誉变更响应（龙王、群聊之火等）
    prompt: ''             # 自定义提示词（留空使用默认）
  essence:
    enabled: false         # 精华消息响应
    prompt: ''             # 自定义提示词（留空使用默认）
  imageGen:               # AI绘图
    enabled: true          # 启用绘图功能
    model: 'gemini-3-pro-image' # 默认模型
    videoModel: 'veo-2.0-generate-001' # 视频生成模型
    timeout: 600000        # 超时时间（毫秒）
    maxImages: 3          # 最大图片数
    apis:                 # API列表
      - baseUrl: 'https://business.928100.xyz/v1/chat/completions'
        apiKey: 'X-Free'
    presetSources:        # 预设来源配置
      - name: '云端预设'
        url: 'https://ht.pippi.top/data.json'
        enabled: true
    customPresets: []      # 自定义预设（面板可编辑）
  voiceReply:            # 语音回复（旧配置，兼容）
    enabled: false
    ttsProvider: 'system'
    triggerOnTool: false
    triggerAlways: false
    maxTextLength: 500
```

### AI声聊配置

```yaml
voice:
  enabled: false           # 全局开关
  defaultCharacter: ''     # 默认AI声聊角色
  maxTextLength: 500       # 最大文本长度
```

### QQ官方Bot代理配置

```yaml
qqBotProxy:
  enabled: false           # 是否启用QQ官方Bot代理
  proxyUrl: 'http://localhost:2173' # 代理服务器地址
  bots: []                 # Bot配置列表 [{appid, secret, sandbox, intents}]
  autoReconnect: true      # 自动重连
  reconnectInterval: 5000  # 重连间隔(ms)
  maxReconnectAttempts: 10 # 最大重连次数
  messageHandler:          # 消息处理配置
    enabled: true          # 是否处理消息
    useAI: true            # 使用AI处理消息
    presetId: ''           # 使用的预设ID（留空使用默认）
  icRelay:                 # IC代发配置：IC触发时使用官方Bot回复
    enabled: false         # 启用IC代发模式
    globalRelay: false     # 全局代发（所有群都代发，否则只代发白名单群）
    officialBotQQ: ''      # 官方Bot的QQ号
    groups: {}             # 群号映射: {"IC群号": "group_openid"}
    whitelistGroups: []    # 代发白名单群（globalRelay=false时生效）
    blacklistGroups: []    # 代发黑名单群（globalRelay=true时生效）
    fallbackToIC: true     # 获取被动ID失败时回退到IC发送
    markdown:              # Markdown模板配置
      enabled: false       # 是否使用MD模板发送
      templateId: ''       # MD模板ID
      templateKeys: 'abcdefghij' # 模板参数键名
    button:                # 按钮配置
      enabled: false       # 是否发送按钮
      appid: ''           # 按钮appid
      templateId: ''       # 按钮模板ID（keyboard_id）
  events:                  # 事件处理配置
    READY: true
    AT_MESSAGE_CREATE: true
    DIRECT_MESSAGE_CREATE: true
    C2C_MESSAGE_CREATE: true
    GROUP_AT_MESSAGE_CREATE: true
    MESSAGE_CREATE: true
    GUILD_CREATE: true
    GUILD_DELETE: true
    INTERACTION_CREATE: true
```

### 流式响应配置

```yaml
streaming:
  enabled: true           # 启用流式响应
```

### IP探针配置

```yaml
probe:
  serverUrl: 'http://127.0.0.1:9527' # 探针服务器地址
  secretKey: 'your-secret-key-change-me' # API密钥，需与服务端一致
```

### AI触发配置

```yaml
trigger:
  private:
    enabled: true          # 是否响应私聊
    mode: 'prefix'         # 私聊触发模式: 'always'(总是), 'prefix'(需前缀), 'off'(关闭)
  group:
    enabled: true          # 是否响应群聊
    at: true               # @机器人触发
    prefix: true           # 前缀触发
    keyword: false         # 关键词触发
    random: false          # 随机触发
    randomRate: 0.05       # 随机触发概率
  prefixes: ['#chat']      # 前缀列表
  keywords: []             # 关键词列表
  collectGroupMsg: true    # 采集群消息用于记忆
  blacklistUsers: []       # 用户黑名单
  whitelistUsers: []       # 用户白名单（空=不限）
  blacklistGroups: []      # 群黑名单
  whitelistGroups: []      # 群白名单（空=不限）
```

## 工具开发

### 自定义工具

在 `data/tools/` 目录下创建 JS 文件即可自动加载：

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
                name: { type: 'string', description: '用户名称' }
            },
            required: ['name']
        }
    },
    async run(args, context) {
        return { success: true, message: `你好，${args.name}！` }
    }
}
```

### 工具上下文

`context` 参数提供了丰富的运行时信息：

```javascript
async run(args, context) {
    const event = context.getEvent()     // 获取当前事件
    const bot = context.getBot()         // 获取 Bot 实例
    const isIcqq = context.isIcqq()      // 判断适配器类型
    
    // 发送消息
    await event.reply('文本消息')
    await event.reply(segment.image('url'))
}
```

## Web 管理面板

### 访问方式

1. 发送命令 `#ai管理面板` 获取临时访问链接
2. 发送命令 `#ai管理面板 永久` 获取永久访问链接
3. 默认端口：3000

### 功能模块

- **基础配置**: 触发方式、命令前缀等
- **渠道管理**: API 渠道配置、测试连接
- **预设管理**: 角色预设的增删改查
- **工具管理**: 内置/自定义工具配置
- **记忆管理**: 用户记忆查看和管理
- **MCP 服务器**: MCP 服务器连接管理
- **高级功能**: 主动聊天、群聊总结、个人画像等高级功能配置

## 调试与日志

### 启用调试模式

在 `config.yaml` 中设置：

```yaml
basic:
  debug: true
```

### 日志格式

使用内置的 `chatLogger`:

```javascript
import { chatLogger } from '../core/utils/logger.js'

chatLogger.info('Module', '消息内容')
chatLogger.warn('Module', '警告信息')
chatLogger.error('Module', '错误信息')
```

## 版本管理

遵循语义化版本和 Conventional Commits 规范：

```bash
# 新功能
git commit -m "feat(mcp): 添加天气查询工具"

# Bug修复
git commit -m "fix(adapter): 修复流式响应中断问题"

# 版本发布
npm version patch|minor|major
```

## 技能系统

### 智能调度

插件支持基于工具组的智能调度模式：
- 调度模型只接收工具组摘要，选中后返回完整工具列表
- 支持并行工具执行
- 工具组分类管理（系统、QQ、网络、文件、记忆、图像等）

### 技能代理 (SkillsAgent)

- `SkillsAgent`: 统一管理所有内置、自定义和MCP工具
- 支持工具启用/禁用动态管理
- 支持工具分类和搜索功能
- 支持MCP服务器管理
- 支持技能配置和加载器系统

### Skills 配置和加载器 (SkillsConfig & SkillsLoader)

- `SkillsConfig`: 负责加载、管理和验证 `skills.yaml` 配置文件
- `SkillsLoader`: 根据配置独立加载工具，统一处理内置工具、自定义JS工具和外部MCP服务器工具
- 支持热重载和动态管理配置

### Skills 导出模块

`index.js` 导出了 skills 模块，提供全局访问接口：

```javascript
import { skills } from './index.js'

// 获取全局技能代理实例
const agent = skills.agent

// 获取所有可用工具
const tools = await skills.getAllTools()

// 执行工具
const result = await skills.executeTool('tool_name', args, context)

// MCP 服务器管理
const servers = await skills.getMcpServers()
await skills.connectMcpServer(name, config)
await skills.disconnectMcpServer(name)

// 工具管理
const categories = await skills.getToolCategories()
await skills.toggleTool(toolName, enabled)
await skills.reloadAllTools()

// 技能配置管理
await skills.reloadConfig()
await skills.updateConfig(updates)
const mode = skills.getMode()
const groups = skills.getGroups()
```

**SkillsAgent 初始化**: 在插件加载时自动初始化，统计内置工具、自定义工具和MCP工具数量，并输出到日志。

## 主动聊天功能

### 概率触发机制

- 基础触发概率配置
- 时段概率乘数（深夜、清晨、上午、下午、傍晚、晚上）
- 星期乘数（工作日、周末不同概率）
- 活跃度检测（死群、低活跃、正常、活跃、高频对话）

### 防刷屏机制

- 冷却时间配置
- 每日/每小时最大消息数限制
- 消息速率检测

## 事件处理系统

插件支持多种QQ事件的处理：

- **戳一戳事件**: Poke.js
- **表情回应**: Reaction.js
- **消息撤回**: 撤回后AI响应
- **入群欢迎**: 欢迎新成员
- **退群通知**: 成员离开时的通知
- **禁言事件**: 成员被禁言时的响应
- **管理员变更**: 管理员角色变更响应
- **荣誉变更**: 龙王、群聊之火等荣誉变更响应
- **精华消息**: 精华消息设置时的响应
- **消息检查**: MessageInspector.js 对消息进行预处理和分析

## Telemetry 服务

系统集成了遥测服务，用于：
- 统计插件使用情况
- 推送公告和更新信息
- 收集插件全局启动次数
- 记录模型使用统计（不含敏感信息）

## 前端技术栈

### 技术版本

- **框架**: Next.js 16.0.10
- **React**: 19.2.1
- **UI 库**: Radix UI + Tailwind CSS 4
- **状态管理**: Zustand
- **数据获取**: SWR
- **表单**: React Hook Form + Zod
- **组件库**: shadcn/ui
- **语言**: TypeScript 5.x

### 主要依赖

- `@hookform/resolvers`: 表单验证解析器
- `@lobehub/icons`: 图标库
- `@radix-ui/*`: Radix UI 组件库
- `lucide-react`: 图标
- `sonner`: Toast 通知
- `react-markdown`: Markdown 渲染
- `prismjs`: 代码高亮
- `next-themes`: 主题切换
- `clsx` / `tailwind-merge`: CSS 工具类
- `zod`: 模式验证
- `zustand`: 状态管理

### 开发脚本

```bash
# 开发模式
pnpm dev

# 构建
pnpm build

# 生产环境启动
pnpm start

# ESLint 检查
pnpm lint

# 构建并同步到 resources/web
pnpm export

# 分析构建产物
pnpm build:analyze
```

### 前端配置

- **Next.js 配置**: `next.config.ts`
  - 静态导出模式 (`output: 'export'`)
  - 构建输出到 `out` 目录
  - 图片不优化（适用于静态部署）
  - 生产环境移除 console（保留 error 和 warn）
  - 启用 CSS 优化
  - 禁用 poweredByHeader
  - 启用 React 严格模式

- **TypeScript 配置**: `tsconfig.json`
  - 目标: ES2017
  - 严格模式: 关闭（noImplicitAny: false）
  - JSX: react-jsx
  - 路径别名: `@/*` 映射到 `./*`

## 服务层新增模块

### Middleware 服务 (`src/services/middleware/`)
提供中间件功能，用于处理请求/响应的拦截和转换。

### Permission 服务 (`src/services/permission/`)
统一管理用户和群组的权限控制。

### Proxy 服务 (`src/services/proxy/`)
处理代理配置，支持 HTTP、SOCKS 等代理协议。

### QQBot 服务 (`src/services/qqbot/`)
提供 QQ 官方 Bot 代理能力。

### Routes 服务 (`src/services/routes/`)
Web API 路由管理，统一的 RESTful API 入口。

### Scheduler 服务 (`src/services/scheduler/`)
任务调度系统，支持定时任务管理。

### Scope 服务 (`src/services/scope/`)
作用域管理，处理不同维度的上下文隔离。

### Skills 服务 (`src/services/skills/`)
技能配置和加载器系统，提供独立的技能管理功能。

### Stats 服务 (`src/services/stats/`)
统计服务，收集和分析使用数据。

### Memory 服务 (`src/services/memory/`)
提供结构化记忆服务，支持用户记忆管理。

## 开发工具链

### Prettier 配置 (`.prettierrc`)

```json
{
  "semi": false,
  "singleQuote": true,
  "tabWidth": 4,
  "useTabs": false,
  "trailingComma": "none",
  "printWidth": 120,
  "bracketSpacing": true,
  "arrowParens": "avoid",
  "endOfLine": "lf"
}
```

### Husky Git 钩子 (`.husky/`)

- `pre-commit`: 在提交前自动执行代码格式化

### lint-staged 配置

```json
{
  "*.{js,ts,tsx}": "prettier --write --ignore-path .prettierignore"
}
```

### 可用命令

```bash
# 插件根目录
pnpm format          # 格式化所有代码
pnpm format:check    # 检查代码格式

# 前端目录
cd frontend
pnpm dev             # 前端开发服务器
pnpm build           # 构建前端
pnpm lint            # ESLint 检查
pnpm export          # 构建并同步到 resources/web
```