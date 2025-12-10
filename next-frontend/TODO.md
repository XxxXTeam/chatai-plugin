# Next.js 前端重构 TODO

> 对标 Vue 版本，完善所有功能

## 功能对比概览

| 模块 | Vue 版本 | Next.js 版本 | 状态 |
|------|----------|--------------|------|
| 仪表盘 | ✅ Dashboard.vue | ✅ page.tsx | ✅ 完成 |
| 渠道管理 | ✅ Channels.vue | ✅ channels/page.tsx | ✅ 完成 |
| 预设管理 | ✅ Presets.vue | ✅ presets/page.tsx | ✅ 完成 |
| 系统设置 | ✅ Settings.vue | ✅ settings/page.tsx | ✅ 完成 |
| 工具管理 | ✅ ToolsManager.vue | ✅ tools/page.tsx | ✅ 完成 |
| 独立人格 | ✅ ScopeManager.vue | ✅ scope/page.tsx | ✅ 完成 |
| 对话历史 | ✅ ChatHistory.vue | ✅ conversations/page.tsx | ✅ 完成 |
| 记忆库 | ✅ MemoryView.vue | ✅ memory/page.tsx | ✅ 完成 |
| 用户管理 | ✅ Users.vue | ✅ users/page.tsx | ✅ 完成 |
| MCP服务 | ✅ McpServers.vue | ✅ mcp/page.tsx | ✅ 完成 |
| 工具日志 | ✅ ToolLogs.vue | ✅ history/page.tsx | ✅ 完成 |
| 消息调试 | ✅ MessageDebug.vue | ⏭️ 不需要 | ⏭️ 跳过 |
| 事件监听 | ✅ EventsView.vue | ✅ 整合到Settings高级功能 | ✅ 完成 |
| 功能配置 | ✅ FeaturesConfig.vue | ✅ 整合到Settings高级功能 | ✅ 完成 |
| 监听配置 | ✅ ListenerConfig.vue | ✅ 整合到Settings触发配置 | ✅ 完成 |

---

## 一、Settings 系统设置 ✅ 已完成

### 1.1 AI触发配置 (trigger) ✅
- [x] 私聊触发开关 `trigger.private.enabled`
- [x] 私聊模式 (always/prefix/off) `trigger.private.mode`
- [x] 群聊触发开关 `trigger.group.enabled`
- [x] @机器人触发 `trigger.group.at`
- [x] 前缀触发 `trigger.group.prefix`
- [x] 关键词触发 `trigger.group.keyword`
- [x] 随机触发 + 随机概率 `trigger.group.random/randomRate`
- [x] 触发前缀列表 `trigger.prefixes` (动态标签)
- [x] 触发关键词 `trigger.keywords` (动态标签)
- [x] 前缀人格映射 `trigger.prefixPersonas` (前缀-预设绑定)
- [x] 采集群消息开关 `trigger.collectGroupMsg`
- [x] 访问控制: 群白名单/黑名单 `trigger.whitelistGroups/blacklistGroups`
- [x] 访问控制: 用户白名单/黑名单 `trigger.whitelistUsers/blacklistUsers`

### 1.2 基础配置 (basic) ✅
- [x] 命令前缀 `basic.commandPrefix`
- [x] 思考提示 `basic.showThinkingMessage`
- [x] 引用回复 `basic.quoteReply`
- [x] 调试模式 `basic.debug`
- [x] 调试仅控制台 `basic.debugToConsoleOnly`
- [x] 自动撤回开关 `basic.autoRecall.enabled`
- [x] 撤回延迟 `basic.autoRecall.delay`
- [x] 撤回错误消息 `basic.autoRecall.recallError`

### 1.3 管理配置 (admin) ✅
- [x] 主人QQ `admin.masterQQ` (动态标签)
- [x] 登录链接私聊推送 `admin.loginNotifyPrivate`
- [x] 敏感命令仅主人 `admin.sensitiveCommandMasterOnly`

### 1.4 模型配置 (llm) ✅
- [x] 默认模型 `llm.defaultModel`
- [x] 对话模型 `llm.models.chat` (ModelSelector 多选)
- [x] 伪人模型 `llm.models.roleplay` (ModelSelector 多选)
- [x] 工具调用模型 `llm.models.toolCall` (ModelSelector 多选)
- [x] 搜索模型 `llm.models.search` (ModelSelector 多选)
- [x] 思考模型 `llm.models.reasoning` (ModelSelector 多选)
- [x] 备选模型轮询 `llm.fallback` (启用/模型列表/重试次数/延迟/通知)

### 1.5 伪人模式 (bym) ✅
- [x] 启用开关 `bym.enable`
- [x] 触发概率 `bym.probability` (滑块)
- [x] 回复温度 `bym.temperature` (滑块)
- [x] 最大Token `bym.maxTokens`
- [x] 启用记忆 `bym.recall`
- [x] 使用模型 `bym.model`
- [x] 系统提示词 `bym.systemPrompt`

### 1.6 工具调用 (tools) ✅
- [x] 显示调用日志 `tools.showCallLogs`
- [x] 日志合并转发 `tools.useForwardMsg`
- [x] 并行执行 `tools.parallelExecution`
- [x] 发送中间回复 `tools.sendIntermediateReply`
- [x] 人格上下文隔离配置

### 1.7 深度思考 (thinking) ✅
- [x] 启用思考适配 `thinking.enabled`
- [x] 显示思考内容 `thinking.showThinkingContent`
- [x] 思考合并转发 `thinking.useForwardMsg`

### 1.8 高级功能 (features) ✅
- [x] 群聊总结配置
- [x] 个人画像配置
- [x] 戳一戳响应配置
- [x] 表情回应配置
- [x] AI图片生成配置
- [x] 错误处理配置
- [x] 长期记忆配置

---

## 二、Channels 渠道管理 ✅ 已完成

- [x] 导入渠道 (importChannels)
- [x] 导出渠道 (exportChannels)  
- [x] 渠道增删改查
- [x] 测试连接
- [x] 模型选择

---

## 三、Presets 预设管理 ✅ 已完成

- [x] 导入/导出预设
- [x] 设为默认预设
- [x] 预设增删改查
- [x] 刷新功能

---

## 四、ToolsManager 工具管理 ✅ 已完成

- [x] 工具列表表格
- [x] 工具详情弹窗
- [x] 工具测试弹窗  
- [x] 内置工具配置
- [x] JS工具管理

---

## 五、对话历史 `/conversations` ✅ 已完成

- [x] 搜索功能 (搜索会话ID/用户)
- [x] 一键清空所有对话
- [x] 导出对话 (JSON格式)
- [x] 会话详情查看

---

## 六、记忆库 `/memory` ✅ 已完成

- [x] 统计卡片: 用户数, 当前用户记忆数
- [x] 用户选择器 (下拉框+搜索+自定义输入)
- [x] 添加记忆功能
- [x] 记忆搜索功能
- [x] 清空用户记忆
- [x] 一键清空所有用户记忆
- [x] 记忆列表显示相似度分数

---

## 七、工具日志 `/history` ✅ 已完成

- [x] 工具调用日志列表
- [x] 日志筛选 (按工具名)
- [x] 日志详情 (输入参数, 输出结果, 耗时)
- [x] 统计卡片
- [x] 清空日志

---

## 八、组件增强 ✅ 已完成

### DynamicTags 动态标签输入
- [x] 创建通用动态标签组件
- [x] 支持回车添加

### DynamicInput 动态输入  
- [x] 创建通用动态输入组件
- [x] 支持自定义项目结构

---

## 进度追踪 ✅ 全部完成

- [x] Settings - AI触发配置
- [x] Settings - 管理配置  
- [x] Settings - 工具调用配置
- [x] Settings - 高级功能配置
- [x] Settings - 思考适配开关
- [x] Settings - 模型配置优化 (ModelSelector组件)
- [x] Channels - 导入导出
- [x] Presets - 导入导出 + 设置默认
- [x] 对话历史增强 - 搜索 + 导出
- [x] 记忆库增强
- [x] 工具日志页面
- [x] 组件开发 - DynamicTags/DynamicInput/ModelSelector
- [x] 事件/功能/监听配置 - 整合到Settings

---

*最后更新: 2024-12-10*
*状态: ✅ 全部完成 (消息调试页面不需要)*
