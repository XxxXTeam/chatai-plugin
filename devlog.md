# 开发日志

## 2026-07-28 工具历史乱序 / 动态标签 / MCP 代理 / 图谱编辑（已完成，未提交）

### 工具历史乱序与孤儿 tool
- **根因**：① `DatabaseService.getMessages` 仅按 `timestamp` 排序，同毫秒写入的工具轮次顺序未定义；② `saveMessage` 按 role+content 哈希去重会误删合法重复消息，且按 `content LIKE %"id":"..."%` 匹配消息 ID 可被 LIKE 通配符误伤；③ 同会话并发外层请求（群共享 `group:${groupId}`）各自读相同历史后按 API 完成顺序交错写入，`ChatService` 只 `recordRequest` 计数不串行化。
- **修复**：`getMessages` 改为 `timestamp, id` 稳定双键排序（DESC/ASC 内外层一致）；`saveMessage` 改为解析 JSON 精确比较消息 ID 去重，移除内容哈希去重；`ChatService.sendMessage` 用 `ContextManager.acquireLock('chat:'+conversationId, 1800000)` 包住完整工具递归轮次；锁最长持有时间改为 `max(90s, timeout+60s)`。
- **存量清理**：群会话 `group:3889048706:08FDA3D8EEA00156718757B92060AA77` 核对 86 行，5 条 tool 结果行（id 8103-8106, 8109）的声明 assistant 已被历史修剪删除 → 一次性 DELETE，清理后 81 行、孤儿 tool 结果 0。
- 历史中的 tool_calls **只作为上下文传给模型，不会重新执行**；20:04 日志中的 `Stream chunk: 检测到tool_calls` 是本轮新响应的流式分片，同一调用会按 index/id 聚合后执行一次。

### 动态个人标签
- `PersonalTagService.js`（新建）：预设声明 `<好感变化:+X>` → `parsePersonalTagDefinitions`；回复中 `<好感变化:+1>` → `parsePersonalTagChanges` 剥离+delta；`applyPersonalTagChanges` 累加到 `kv_store: personal-tags:<userId>`（钳制 ±100），并以 `custom` 分类、`metadata.type=personal_dynamic_tag` upsert 到 `structured_memories`（同一 stateName 复用一条记忆，不产生重复）；`buildPersonalTagContext` 注入系统提示。
- 定义从**最终渠道系统提示词**解析（覆盖独立人设/前缀人设/渠道提示词，`ChatService` 在 resolveChannelSystemPrompt 之后执行）。
- `memoryRoutes` 清空用户记忆/清空全部记忆时同步清理对应 KV。

### MCP 代理
- `McpClient` 全部 4 处远程 fetch（SSE notification/request、Streamable HTTP init/httpRequest）改用 node-fetch + `proxyService.getFetchOptions(url,'api')`；SSE EventSource 自定义 fetch 同。
- stdio/npm 子进程 env 注入 HTTP(S)_PROXY/ALL_PROXY 大小写六个变量；`request` 默认超时 30 分钟（config.js/config.yaml/skills.yaml/SkillsConfig.js 同步）。

### 知识图谱编辑
- 后端：`graphRoutes` 新增 `PUT /api/graph/relationships/:relationshipId`。
- 前端（独立工作树 `/tmp/chatgpt-plugin-frontend`，frontend 分支）：memory/page.tsx 增加实体新建/编辑 Dialog、关系新建/编辑 Dialog（编辑仅允许改属性，与后端一致）、实体/关系删除确认 DeleteDialog、作用域切换清理旧详情、刷新按钮刷新当前作用域数据、记忆统计卡改用 `stats.totalMemories`；`graphApi` 增加 `updateRelationship`。

### 验证
- 后端全部修改文件 `node --check` + Prettier 通过。
- 动态标签脚本测试：解析/过滤、累加钳制 100、KV+结构化记忆同步、上下文注入 —— 通过（`personal-tag-migration-ok`）。
- 前端 `next build` 33 页通过、`tsc --noEmit` 通过；全量 lint 被仓库既有其他页面规则错误阻断（非本次改动）。
- **未提交、未推送、未重启服务**；前端构建产物在 `/tmp/chatgpt-plugin-frontend/out`，尚未同步到 `resources/web`。

## 2026-07-26 全项目深度审计（审计完成 / 修复被 API 限额中断）

### 本轮状态

- **审计阶段：已完成**。多路 SubAgent 覆盖 `src/` 全部 150 个 JS 文件 + `frontend/` 全部页面组件，关键结论均由主控二次实证复核。
- **修复阶段：仅落地 1 处即中断**。4 个修复 Agent（MCP 安全 / Web 安全 / 可靠性 / Skills 链路）派发后遭遇 API 会话限额（17:40 重置），仅 `src/services/webServer.js` 的 `FingerprintValidator` 改动落地（新增容量上限 5000 + 30 天 TTL + `remove()`，`node --check` 通过）。**其余全部待修**。

### 用户已确认的决策

| 议题 | 决定 |
|---|---|
| 执行范围 | Skills 链路 + 可靠性/死配置 + 前端样式 + 安全/确定性 Bug，四批全做 |
| `common.js:208` PLUGIN_DEVELOPERS 硬编码 master | **保持现状不动** |
| 19 段硬编码大 Prompt | 优化这些硬编码提示词（非外置为配置） |
| 前端交付方式 | 改 `frontend/` 源码并重建同步到 `resources/web/` |

### 已实证确认的问题清单（附证据）

**严重（可被未授权或低权限触发）**

1. `BuiltinMcpServer.js:968` `firstDefined = vals.find(v => v !== undefined)`，而 `config.yaml:192` 的 `dangerousTools: []` 是空数组而非 undefined → 立即短路，末尾 `|| []` 也不生效 → `execute_command`/`write_file`/`delete_file` 全部不受 `allowDangerous:false` 约束。`McpManager.js:988` 同缺陷。
2. `file.js:1166-1168` `download_to_file`：`args.filename` 未 `basename`、拼接后无二次校验。**实测** `../../../../../../../../etc/cron.d/pwn` → `/etc/cron.d/pwn`。`file.js:1218-1253` 的 `download_group_file_to_file` 同型，且 `originalName` 取自协议端群文件名（外部可控）。
3. `configRoutes.js:48-90` 原型污染，**实测三种载荷全部成立**：`{"__proto__.x":"1"}`、`{"a":{"__proto__":{"x":"1"}}}`、`{"constructor.prototype.x":"1"}`。`config/config.js` 的 `set()` 同缺陷。
4. `toolsRoutes.js:374-389/348-372/437-453` 路径遍历：`req.params.name` 未 `basename`，Express 解码 `%2f` 后可写插件目录内任意 `.js`，配合紧随的 `reloadJsTools()` 即代码执行。
5. `channelRoutes.js:487`+`:577-581`：`concurrency` 解构默认值只挡 undefined，传 `0`/负数/`null` → **实测无限循环**（500 万次迭代不退出），事件循环饥饿且不触发 OOM。`testPanelRoutes.js:31`+`:205-215` 同型。
6. `gameRoutes.js:398` `/edit/create` 未挂 auth 且 `userId` 取自 body，`:599` `/game-edit/login` 亦无鉴权，`:713-722` 用该 userId 落库 → 可篡改任意用户存档与人设（人设进 LLM system prompt）。
7. `web.js:106-133` `website` 走 puppeteer `page.goto`，**实测 `file:///etc/passwd` 可读**。
8. `ImageService.js:472-487/382-387/294-299`：非 http(s) 前缀即 `fs.readFileSync`，**实测** `prepareImageForApi('/etc/passwd')` 返回 base64 → 经 `generate_image` 的 `image_urls` 外发至第三方 API。
9. `RenderService.js:398-407` `getBrowser()` 判断与赋值间隔 await，并发即泄漏 Chromium 进程（150-300MB/个）；`closeBrowser()` 全项目无调用点。
10. `ChatService.js:614` 的 `startRequest` 在 try(`:996`) 之外，而 `endRequest` 在 finally(`:1651`) → 中间任何抛错使计数永久 +1 → `least-connection` 调度永久排除该渠道。
11. `ChatService.js:1752-1756` `message.substring` 未空值保护 → 纯图片消息 + 模型返回 >50 字符即抛错 → 触发 `autoCleanOnError` **直接清空用户历史**。
12. `ContextManager.js:269-278` 会话总结先 `deleteConversation` 再 `saveHistory`，后者失败则历史永久丢失，catch 仅 `logger.debug` 静默吞掉；该路径由 setInterval 后台自动触发。
13. `KnowledgeService.js:327/343-344` `Object.assign` 合并整个 req.body，可注入 `filePath` → 认证后任意文件写（`../../../apps/chat.js` 即 RCE）。

**高**

14. 三个适配器 `AbortController|AbortSignal|signal:` 零命中，`buildOpenAIClientOptions`(`OpenAIClient.js:429-433`)/`buildClaudeClientOptions`(`ClaudeClient.js:61`) 均未传 `timeout` → 渠道 `timeout.{connect,read}`（`ChannelManager.js:529/751/1644/1685` 写入）读取端零命中，是死配置；实际走 SDK 默认 10 分钟。
15. `ImageService.js:939` `this.uploadDir` 为全项目唯一引用，构造函数(`:19`)只定义 `this.storagePath` → `extractText()` OCR 必崩。
16. `webServer.js:316-317` CORS 反射 Origin + `Allow-Credentials: true`；`:689` 的 `botExpress.use(this.app)` 使其在 TRSS 模式下污染整个 Yunzai 服务。
17. `webServer.js` 从未 `app.use(errorHandler)`（`ApiResponse.js:214` 已实现），项目未设 NODE_ENV → 500 返回带绝对路径的堆栈 HTML。
18. `imageRoutes.js:512` 硬编码 `IMAGE_TOKEN_SECRET`，`:541` 非常量时间比较，`:556` `startsWith` 前缀匹配 → 可自签 token 并遍历下载全部图片；`:634-635` `createReadStream` 无 error 监听 → 未捕获异常直接终止进程。
19. `ChatService.js:1438/1494` 切换 Key 不累加 retryCount + `getNextAvailableKey` 仅排除当前 index → 单次请求最多约 10×N 次计费调用。
20. `AbstractClient.js:1415-1423` 工具调用递归仅靠 `toolChoice:none` 依赖模型服从，而 `parseXmlToolCalls` 会从纯文本再解析出工具调用 → 无限递归；`:1211` 的 `maxTotalToolCalls:25` 从未被读取。
21. `NLSchedulerService.js:24-44` `initialized = true` 在 await 之后，且有两个不 await 的并发调用点（`webServer.js:660`、`nlSchedule.js:7` 模块顶层）→ 创建两个 setInterval，前一句柄被覆盖 → **定时提醒发送两次**。
22. `StatsService.js:311/548` 每次 recordTokens/recordToolCall 都无条件 `fs.writeFileSync(JSON.stringify(stats, null, 2))` → 一次 Agent 对话 5-10 次同步全量写盘。
23. `extra.js:449` 与 `reminder.js:116` 均注册 `set_reminder`：`McpManager:627` 的 `Map.set` 让**后者**的 schema 暴露给 LLM，而 `BuiltinMcpServer:1211` 的 `find` 执行**前者**的 handler 并用前者 schema 校验 → 该工具在任何调用下都失败。`get_friend_list`/`send_like` 同型冲突。
24. `emoji.js:74/106/152` 用 `parameters:` 而非 `inputSchema:` → 暴露给 LLM 的 schema 为 undefined，且 `BuiltinMcpServer:1216` 的校验分支被跳过。

**Skills 链路（前端渲染断链）**

25. `data/skills.yaml` 顶层仅 7 个节点，**缺 `documents`**（`SkillsConfig.js:53-60` 有默认值），且 `documents.paths` 首项 `data/skills` 目录不存在。
26. `skillsRoutes.js:171-179` 的 `/documents` 未返回 `priority`/`autoActivate`/`capabilities`/`type`，而前端 `skills/page.tsx:141/148` 读 `document.metadata?.*` → `:302-316` 的「优先级」「自动激活」Badge **永不渲染**。注意 `autoActivate` 默认 true 的语义在 `SkillDocumentLoader.js:319`，必须回传顶层规范化字段而非 metadata 原值。
27. 后端广播 `skill-loaded`(`:584`)/`skill-unloaded`(`:605`)/`batch-executed`(`:281`)，前端 `useSSE.ts:107-122` 的 eventTypes 不含这三个；具名事件不触发 onmessage → 永远收不到。

**前端**

28. `memory/page.tsx:307` `viewMode` 的 setter 全文件零引用，恒为 `'tree'` → `:369-380` 写入 `memories` 的 else 分支不可达，而 `memoryTree` 无任何 JSX 读取 → **查询结果永远显示「该用户暂无记忆」**（P0）。
29. `frontend/out`（buildId `E1LzavdJrp8VNowDHv8ol`，07-19）与 `resources/web`（07-18，残留两个 buildId 目录，其中 `bko0gqbrrWzXk2BK82hPg` 为空目录）有 423 处差异；`package.json` 的 `export` 脚本是 PowerShell，Linux 不可用。
30. 数字 `&&` 短路渲染出裸 `0`：`memory/page.tsx:211`、`stats/page.tsx:592-600/939-947`、`knowledge/page.tsx:575-581`。
31. `router.push()` 缺尾斜杠 9 处（项目配置 `trailingSlash: true`，且 `layout.tsx:55` 已有正确写法作对照）。
32. 17+ 处纯图标按钮无 `aria-label`；多处硬编码色缺 `dark:` 变体（`mcp/page.tsx:866/936/942`、`page.tsx:288-298`、`history/page.tsx:217-233`、`memory/page.tsx:199/259` 等）。

### 已核实为误报（勿再修）

- `imageRoutes.js:550-559` `findImageFile` 的 `^[a-f0-9]+$` 白名单正则确实阻断了路径遍历。
- `stats/page.tsx:309` SVG `fill="white"` + `className="dark:fill-gray-900"`：类选择器具体度高于表现性属性，暗色下正常工作。
- 各页面日期 `toLocaleString` 均被 `loading` 初始 true 的骨架屏门控，不产生 hydration mismatch。
- `useResponsive.ts:119-122` 的 `getServerSnapshot` 返回固定 false 是 React 官方 SSR 安全写法，仅有首屏布局跳变的已知权衡。
- storage 层不存在 SQL 注入，4 处字符串拼接全是字面量或由数组长度生成的 `?` 占位符；真实风险在 LIKE 通配符未转义（`DatabaseService.js:852-860/633-640`）。

### 修复结果（限额恢复后完成）

五路 Agent 并行 + 主控逐项复核。**主控发现并补修了 Agent 的 3 处遗漏**，均为原问题的同源缺陷。

**安全（全部实测验证，非仅读码）**

- 危险工具拦截失效 —— **三处全修**。Agent 只修了调用拦截层 `BuiltinMcpServer.js:1015`，主控补修工具暴露层 `McpManager.js:819` 与面板展示 `toolsRoutes.js:651`（前者决定哪些工具暴露给模型，漏修则拦截链路不完整）。统一改用 `mergeDangerousTools` 取"内置默认 ∪ 用户配置"。实测空配置下 16 项默认黑名单全部生效。
- 路径沙箱 —— `getSafePath` 由黑名单改为 `resolveSandboxPath`（含 realpath 符号链接解析），保留原黑名单作为额外层。实测拒绝：路径穿越、绝对路径、`~/.ssh/id_rsa`、Yunzai 主配置。
- SSRF 守卫 —— 新增 `assertSafeUrl`（async，走真实 DNS 解析）。实测拒绝 `127.0.0.1`、`169.254.169.254`、`file://`、`192.168.1.1`、`[::1]`，**十进制 IP `2130706433` 亦被解析为 127.0.0.1 并拦截**。
- 原型污染 —— `configRoutes` 与 `config/config.js` 均引入 `FORBIDDEN_CONFIG_KEYS`。
- CORS —— 改为白名单：同源 / loopback / `web.publicUrl` / `loginLinks` / 新增 `web.corsOrigins`；不可信来源不下发任何 CORS 头且预检 403；加 `Vary: Origin`。loopback 放行保证本机默认部署可用。
- 其余：`toolsRoutes` 路径遍历、两处 `concurrency` 钳制（实测的进程假死）、`errorHandler` 挂载、图片 token 随机化、工具重名消除（`set_reminder`/`get_friend_list`/`send_like`）、`emoji.js` 的 `parameters:` → `inputSchema:`。
- 死代码删除 846+ 行（`authRoutes.js` 313、`middleware/auth.js` 533、`middleware/index.js`、`SIGNATURE_SECRET` + `RequestSignatureValidator`）。**`ApiResponse.js` 与 `routeFactory.js` 未删** —— 它们在活链 `presetRoutes.js:7`/`gameRoutes.js:8` → `routeFactory.js:1` → `ApiResponse.js` 上，且 `errorHandler` 正要启用。

**确定性崩溃**

- `ImageService` 的 `uploadDir` 三处改 `storagePath`（OCR 原本必崩）
- `ChatService` 的 `recentTopics` 空值保护（原：纯图片消息 + 模型回复 >50 字符 → 崩溃 → 触发 `autoCleanOnError` **连带清空用户历史**）
- `RenderService.getBrowser` 用 `browserLaunchPromise` 做 in-flight 去重（原并发泄漏 Chromium 进程）

**渠道 timeout 死配置接通**（链路四段，缺一不可）

写入端 `ChatService.js:575` → 中间透传 `LlmService.js:189` + **`common.js` 的 `BaseClientOptions` 白名单**（该构造函数逐字段复制，未登记字段会在 `AbstractClient.js:1262` 的 `BaseClientOptions.create` 处被丢弃，是链路的隐蔽断点）→ 读取端三个适配器 `resolveRequestTimeout`。

**存在两条独立的 client 创建路径，都要接**：除主链路外，`LlmService.js:369` 的 `getChatClient` 是 Galgame / bym 等绕过 ChatService 的第二条路径，漏接则那条链路的 timeout 仍是死配置。

实测（端到端 17 项，验到真实 SDK 实例而非仅返回对象）：`new OpenAI(opts).timeout === 33000`、`new Anthropic(opts).timeout === 27000`、`buildGeminiRequestOptions.timeout === 21000`；边界 8 项 —— 未配置 / 空对象 / 只有 connect 无 read / read=0 / read 为负 / read 为字符串 / read 为 null → 全部不传给 SDK 走默认值，纯数字 60000 → 传 60000。

注：本项是**让渠道 timeout.read 生效**，修复前是走 SDK 默认 10 分钟，并非"永久挂起"。

**Skills 包化重构**（用户指出「正常 skill 应该是一个包」）

原实现存在架构自相矛盾：已有 `list_skills`/`get_skill_info` 可按需取内容，却仍在 system prompt 全量注入正文，两套机制互相抵消。

- 包结构：`isPackageSkill()` 判定固定名文件所在目录为包根；`collectPackageFiles()` 扫描 `references/` `assets/` `scripts/`（上限 50 文件 / 深度 3）；文档新增 `isPackage`、`files` 字段
- 三层渐进式披露：L1 `buildInstructions` 只注入元数据 + 触发场景 + 附属文件清单并给出取用指引；L2 `get_skill_info` 取完整 SKILL.md；L3 新增 `list_skill_files` / `read_skill_file`。实测示例包 370 vs 762 字符，省 51%（正文越长省越多，L1 是常数级）
- 新增配置 `skills.documents.disclosure`（`progressive` 默认 / `full` 回退）。**特意未复用已有的 `mode` 字段** —— `mode` 是技能选择策略（auto/all/explicit），与「选中后注入多少」正交，复用会造成语义冲突
- 安全：`readPackageFile` 双重校验（白名单 + realpath 前缀）。实测拒绝路径穿越（两种形式）、绝对路径、未收录文件（含包根 SKILL.md）、空路径
- 顺带修复该文件两个真问题：`get_skill_info` 正文截断在 2000 字符（正是 L2 入口，截断会让整个方案失效，已提至 20000 并加 `truncated` 标记）；全部 handler 返回 `JSON.stringify` 字符串导致 `isToolResultError` 把失败误判为成功（已改返回对象）
- 示例包 `data/skills/group-summary-style/`（SKILL.md + references/ + assets/）兼作规范文档与验证用例

**前端**

P0 `memory` 页 `viewMode` setter 零引用致查询结果永远显示「暂无记忆」；数字 `&&` 渲染裸 0（4 处）；`router.push` 缺尾斜杠（9 处 + 2 处清单外）；加载失败与空态混淆（6 页，其中 `scope` 页根因更严重：6 个请求各自 `.catch` 降级使外层 catch 永不触发，改 `Promise.allSettled`）；防抖定时器卸载清理；裸文本错误态改 Alert+重试；暗色适配优先复用 `globals.css` 语义 token；`aria-label` 17+ 处；非交互元素挂 onClick 5 处；index 作 key 4 处；`knowledge` 死弹窗清理（763→594 行）。

采纳的 2 处有理由偏离：9 个快捷入口用 `text-X-600 dark:text-X-400` 而非语义 token（语义层仅 5 色，9 入口靠色相区分）；`group-admin` amber 文本不动（`--warning-foreground` 亮暗两态均为深色，套 `/10` 淡背景会使暗色文字不可见）。

**工程**

- `version.js` 的 `2>/dev/null || 2>nul` 串联在 Linux 上会创建 `nul` 垃圾文件（根因：仓库无 tag → `git describe` 失败 → 触发第二条）。改按 `process.platform` 选择，实测不再生成
- `frontend/package.json` 的 `export` 从 Windows 专用 PowerShell 改为跨平台 `node fs.rmSync + fs.cpSync`

**交付验证**

后端 147 文件语法通过、import 链完整、关键模块可 import；前端 `tsc --noEmit` 与 `eslint` 均 exit 0；`npm run export` exit 0；残留 buildId 目录已清理（2 个 → 1 个）；`out` 与 `resources/web` 文件数 365:365、零内容差异；69 个静态资源引用零缺失。

### 追加修复（迟到审计报告 + 主控动态 import 检查）

三份迟到的审计报告（extra/bot/basic/user 等、admin/utils/groupStats/qzone、MCP 管理层）暴露出**原任务分派未覆盖的文件**，逐条核实后修复了 7 个确定性错误：

**两处可让整个 Yunzai 进程卡死**（原报告已实测复现，退出码 124）
- `utils.js` 的 `random_number`：`min`/`max` 无有限数校验 → `max: 1e999` 使 `range = Infinity`，`used.has(Infinity)` 恒真，`while` 永不退出。这是同步循环，外层 try/catch 与工具超时都救不了。已加 `Number.isFinite` 守卫 + 尝试次数熔断。实测从"永久卡死"变为 0ms 拒绝。
- `utils.js` 的 `generate_password`：`length` 无 clamp → `1e8` 阻塞数十秒，`1e999`（JSON 中的 Infinity）永不终止。已夹取到 `[4, 128]`。实测 `1e8` 从数十秒变 2ms。

**四个 100% 失效的工具/链路**
- `bltools.js` 的 `ai_mindmap`：`const browser` 声明在 try 内却在 `:1230` 被赋值（TypeError），catch 块又引用它（catch 是独立作用域，ReferenceError）→ 该工具从未成功过，且**每次失败泄漏整套 Chromium 进程**。已改 `let` 提到 try 外 + `finally` 统一回收。
- `BuiltinMcpServer.js:979/986`：`(await import('./McpManager.js')).default` —— 该模块**没有 default 导出**（实测确认 `default === undefined`），自定义工具的 `mcp.callTool`/`listTools` 必定 TypeError。已改具名导入。
- `context.js:366`：导入 `../../services/MemoryManager.js`，实际路径是 `services/storage/MemoryManager.js` → `get_group_context` 必抛 `ERR_MODULE_NOT_FOUND`。
- `McpClient.js:656`：`request()` 只判 `type === 'http'`，而 `connect()` 的 `:144` 同时接受 `streamable-http` → 后者落到 stdio 分支抛 `Client not connected`。触发面很大：`inferServerType` 会把 `/mcp`、`/sse` 结尾的 URL 判为 `streamable-http`，这正是最常见的 MCP HTTP 端点形态。

**一处可崩掉整个 Bot 进程**
- `McpClient.js` 两处 spawn 均未注册 `stdin.on('error')`。子进程存活但已关闭 stdin 时（MCP server 内部崩溃却未退出的典型形态），`write` 会**异步** emit EPIPE；EventEmitter 对无监听器的 error 直接 throw，且异步事件无法被 write 外层的 try/catch 捕获 → 一个外部 MCP server 异常就能崩掉整个 Yunzai。已在两处补监听。

**主控动态 import 检查发现的两处真实断链**（此前只校验静态 import，遗漏了这一类）
- `ChannelManager.js:1249/1349/1410` 用 `../core/adapters/index.js`（少一层 `..`），而同文件 `:1018/:1036` 是正确的 `../../` → `testConnection` 调用即 `ERR_MODULE_NOT_FOUND`。
- `logsRoutes.js:43/52` 指向 `../tools/RequestTemplateService.js`，实际在 `../proxy/` → 占位符列表与模板预览两个接口运行时必然失败。

校验脚本已升级为同时扫描静态与动态 import 并跳过 JSDoc 注释行（`@typedef {import('./models')...}` 这类会误报），复查结果：全部可解析。

### 遗留待办

> **本节写于限额中断当时，此后第 1–3 条均已完成。2026-07-26 复核结果标注如下，勿再照此清单排期。**

1. ~~**`toolsRoutes.js:714` 设计矛盾**~~ —— **已完成**。已引入用户豁免清单，`config/config.js:348` 新增 `dangerousToolsExcluded`，`BuiltinMcpServer.mergeDangerousTools()` 实现 `(内置默认 ∪ dangerousTools) - dangerousToolsExcluded`，正是当时设想的解法。
2. ~~**硬编码收敛**（任务 #2）~~ —— **已完成**。复核：`common.js` 的 CWD 依赖 0 处、`bltools.js` 写死他插件名 0 处、`images.storagePath` 有 16 处引用（并非死配置）。`includes('gemini')` 仍在，但已不是猜测式硬编码——渠道现可通过 `experimental.supportsReasoningParams` 显式声明，字符串推断降为兜底，`OpenAIClient.js:374-392` 有完整注释说明原实现为何会让非 Gemini 模型收到 400。
3. ~~**Prompt 优化去重**（任务 #5）~~ —— **已完成**。`【用户记忆】` 的两处不同实现（`parts.join` 与 `${memoryText}`）已合并为 `MemoryService.js:25` 一处；`EXTRACTION_PROMPT`、`SUMMARY_PROMPT` 措辞收紧；兜底人设 `'你是一个有帮助的AI助手。'` 已移除。
4. **限流**：全站除群管登录外无速率限制，`express-rate-limit` 已装未用（用户明确本轮不做）——**仍未做，等用户决定**。
5. `PLUGIN_DEVELOPERS` 硬编码 master 权限按用户要求保持现状——**维持原样**。
6. `systemRoutes.js:112` 的 `upstream.startsWith('gpt/')` 判断尚未复核过，是本节唯一未确认状态的条目。

---

## 2026-07-15 温度传递修复与禁用温度传递功能

### 问题背景

报错日志显示 kimi 系列模型（kimi-k2.7-code-highspeed、kimi-for-coding、kimi-2.7、kimi-k2.6）批量测试时连续报 400：
```
invalid temperature: only 0.6 is allowed for this model
```
用户反馈两点：
1. 部分渠道模型温度传递有问题，需支持禁用温度传递
2. 温度保存有问题——前端设置 temperature=1，实际传递不是 1

### 根因分析（均经代码证据确认）

**报错根因**：kimi 模型服务端只允许 temperature=0.6，但实际传了非 0.6 值。来源：
- 渠道 `openai-2b3d34da`（127.0.0.1:13000）`advanced.llm.temperature=1`（config.yaml:1340）
- 渠道 `openai-833fa687`（api.kimi.com）`advanced.llm.temperature=0.7`
- 批量测试面板硬编码 `temperature: 0.7`（testPanelRoutes.js:120）
- 4 个模型 6ms 内连续报错 → 批量测试并发触发，非单次聊天 fallback

**"设置1但传递的不是1"根因**：请求链路温度优先级为 `预设 > 渠道 > 默认`（ChatService.js:948 `presetParams.temperature ?? channelLlm.temperature ?? 0.7`），默认聊天预设"可爱猫娘"的 `modelParams.temperature=0.9`，覆盖了渠道设的 1。

**附带发现**：`overrides.temperature`（ChannelManager.js:662，注释"温度 0-2"）被归一化保存，但请求链路与前端都从未读取——是死字段。

### 解决方案（经用户确认）

温度优先级调整为：**模型级覆盖 > 渠道 overrides（禁用/固定值）> 调用方覆盖 > 渠道默认 > 预设 > 0.7**，并支持「禁用温度传递」（禁用则不传 temperature）。

配置结构（方案A，开关在 overrides 节点）：
```yaml
overrides:
  disableTemperature: false     # true → 该渠道不传 temperature（覆盖一切）
  temperature: 0.6              # 强制传该值
  modelTemperatures:            # 单模型覆盖（优先于渠道级）
    kimi-k2.7-code-highspeed:
      disableTemperature: true
      temperature: 0.6
```

### 改动清单

**后端（新增 + 修改）**
- 新增 `src/services/llm/TemperatureResolver.js`：统一温度解析模块，返回 `{ temperature, source }`
- `src/services/llm/ChannelManager.js`：新增 `normalizeTemperatureOverrideLayer`/`normalizeModelTemperatures`，接入 5 个 overrides 归一化点
- `src/services/llm/ChatService.js`：核心聊天链路接入 `resolveTemperature`，移除旧的 `baseTemperature`/`tempSource`
- `src/services/agent/ChatAgent.js`：ChatAgent 链路接入 `resolveTemperature`
- `src/services/llm/LlmService.js`：`getChatClient` 的 `_channelInfo` 注入 `llm`/`overrides`，供绕过链路解析温度
- `src/services/galgame/GalgameService.js`：game 模式接入 `resolveTemperature`（渠道禁用/固定覆盖 gameTemperature）
- `src/services/routes/testPanelRoutes.js`：批量测试改用 `resolveTemperature`（原硬编码 0.7）
- `src/services/routes/channelRoutes.js`：3 个测试接口（/test、/batch-test、/test-model）改用 `resolveTemperature`
- `src/core/adapters/gemini/GeminiClient.js`：禁用温度时不写入 generationConfig（2 处）
- `src/core/adapters/claude/ClaudeClient.js`：禁用温度时不写入 requestPayload（2 处）
- `config/config.js`：更新渠道 overrides 字段 JSDoc 注释

**前端（源码未入 git，通过构建产物生效）**
- 新增 `frontend/components/TemperatureOverrideEditor.tsx`：温度覆盖编辑器组件
- `frontend/app/(dashboard)/channels/page.tsx`：导入组件、扩展表单默认值/回显、插入 UI 区块
- 构建产物同步到 `resources/web/`

### 验证结果

- 后端语法校验：10 个文件全部通过 `node --check`
- 前端类型检查：`tsc --noEmit` 无错误
- 单元验证 `resolveTemperature`：8 个优先级场景全部通过
- 端到端集成验证：归一化 + 温度解析全链路 4/4 通过
- 修复前后对比：4 个 kimi 模型从"传 1 报错"变为"禁用/传 0.6"

### 遗留说明

- `overrides.temperature` 原为死字段，现已启用为"渠道级固定温度"（最高优先级覆盖之一），符合用户"渠道自定义配置优先级最高"的要求
- `overrides.modelTemperatures` 为本次新增的模型级覆盖
- GalgameService 等绕过 ChatService 的链路通过 `_channelInfo` 持有 overrides，已接入温度解析

## 2026-07-26 前端功能补全与扩展（进行中）

### 浏览器实测发现的问题

起了静态服务器托管构建产物（`/api/state` 放行、其余 API 返回 503，模拟后端不可用），用 Playwright 逐页实测：

**修正一处我自己的误判**：tools 页快照显示 `main` 为空，我一度判为"页面空白"，实际是快照拍在数据加载完成前的时序问题——`browser_evaluate` 取实时 DOM 确认内容完整。

**真实问题：加载失败与空数据无法区分**。后端 503 时 knowledge 页照常显示"暂无知识库文档 / 创建第一个文档"，用户无从判断是没数据还是后端挂了。扫描后确认共 8 个页面遗漏（knowledge / stats / conversations / conversations·detail / history / users / settings·links / settings·proxy），已由 Agent 统一补齐 `loadError` 状态与错误态渲染。

主控另修 4 处静默失败：`tools`（含 `useToolsPage`）、`memory` 的用户列表与图谱作用域、`presets` 的降级失败、`conversations/detail` 的会话元信息。

**已验证正常**：channels / skills / 仪表盘首页错误态渲染正确；375px 视口零横向溢出；暗色模式无残留浅色背景元素。

### 功能缺口扫描

对比前后端能力发现：

- **知识图谱**：后端 17 个端点，前端只接 5 个——只能看和删，不能增删改、导出导入、看历史。`graphApi` 的方法其实已齐全，纯粹缺 UI。
- **Skills 文档**：SKILL.md 只能看不能改，要改必须登服务器。
- **批量测试**：前端自己做客户端并发，后端的 `/batch-test`(SSE) / `/active-tests` / `/batch-test-stop` 全是死代码 → 刷新页面进度全丢、无法真正停止后端任务。

### 已落地

**批量测试可中止**（主控）：`BatchTestPanel` 原本没有任何中断手段，测 50 个模型只能干等。加了 `abortedRef`（用 ref 而非 state：并发池循环体持有闭包快照，读 state 会一直看到旧值）、停止按钮、以及关闭弹窗即中止（否则弹窗关了循环仍在后台派发请求）。已在飞行中的请求让其自然结束，避免结果与计数错乱。

**新增依赖** `adm-zip@0.6.0`：用于 skill 压缩包导入。

### 三路扩展交付结果

**Skills 文档编辑**：`SkillDocumentLoader` 新增 `writeSkillSource` / `writePackageFile`。实测四类写入：

| 场景 | 结果 |
|---|---|
| 白名单内真实文件 | `{ok:true, size:979}`，内容确已更新 |
| 路径穿越 `../../../etc/pwn.md` | 404 不在收录清单中 |
| 绝对路径 `/tmp/pwn.md` | 404 |
| 非白名单扩展名 `scripts/a.sh` | 404 |
| SKILL.md 无 frontmatter | 拒绝 |
| SKILL.md YAML 语法错 | 拒绝并附具体错误 |

frontmatter 校验是必需的：`parseSkillMarkdown` 遇到 YAML 错误只打一条 warn 就返回空元数据，用户在面板存下语法错误的 frontmatter 后技能会**静默失效**且无任何提示。

写入函数返回 `{ok, error, status}` 对象而非抛异常——我第一次用 try/catch 测，把 `{ok:false}` 全读成了"允许通过"，得到"防护完全失效"的错误结论。教训：验证前先确认被测函数的错误传达方式。

**压缩包导入**：`SkillPackageImporter` 四类防护（Zip Slip / 符号链接 / 解压炸弹 / 扩展名白名单），全部拒绝整包而非跳过条目——静默跳过会让用户以为导入完整、实际缺文件。两阶段落盘（先解到 temp/ 校验通过再整体 rename），中途失败不留半个包。UI 已验证：`accept=".zip,application/zip"`、上限与后端 `MAX_UPLOAD_BYTES` 一致、覆盖开关及其行为说明齐备。路由挂在 `auth` 之后，无鉴权缺口。

安全拒绝路径此前已验；本轮补测**合法包的正向链路**：

```
导入   name=导入验证技能（取自 frontmatter）  directory=import-verify-pkg  198 B
落盘   SKILL.md, assets/template.md, references/detail.md  与预期完全一致
重扫   isPackage=true  files 正确识别两个子目录  triggers=导入验证
重名   409「技能目录 import-verify-pkg 已存在」
```

**已知限制**：`writePackageFile` 采用收录清单白名单，只能改写扫描时已存在的文件，**无法通过面板新建附属文件**。编辑对话框也确实只列出已有文件、没有新建入口，前后端一致，不会出现"点了没反应"。新增附属文件需走压缩包导入。

**知识图谱**：实体增删改、关系增删、导出导入、历史查看全部落地并浏览器实测通过。实体表格五列渲染正常，三个纯图标操作按钮均带 `aria-label`，`properties: null` 的实体正确降级为 `-`。

### 补齐：实体回滚（本轮新增）

`KnowledgeGraphService.rollbackEntity` 早已实现，但 `graphRoutes.js` **从未为它注册路由**，面板只能看历史不能回滚——用户要求的是"历史与回滚"，此前只完成一半。

新增 `POST /entities/:entityId/rollback`，挂载真实 router 到 express 走真实 sqlite 实测：

```
回滚 v1        200   name/properties 还原为初版，版本号 3→4 递增而非倒退，回滚动作已入历史
版本不存在      404   实体不存在  404
targetVersion 缺失/非数字/0/小数/负数   均 400
```

状态码语义上踩了一个坑：最初把 `catch` 一律当 404，但 `rollbackEntity` 内部会调 `updateEntity`，**数据库故障也会被误报成"版本不存在"**。改为新增 `hasEntityVersion()` 做精确判定，两项 404 条件都在路由层显式查过再执行，`catch` 只留给真正的意外。

### 顺带修掉的既有缺陷：历史版本重复

实测发现历史列表出现两条一模一样的 v1。根因：`createEntity` 写一条 `changeType='created'` 的 v1，随后首次 `updateEntity` 又把当前 v1 存了一遍。`kg_entity_history` 的 `(entity_id, version)` 只有普通索引、无唯一约束，重复插入静默通过。

已在 `updateEntity` 中跳过已入库的版本。取舍：保留 create 那条（标记实体诞生，信息价值更高），代价是首次更新传入的 `changeReason` 不落库，后续每次更新的 reason 照常记录。修复后实测 `v2(二版名称) v1(初版名称)`，每版恰好一条。

### 未处理的发现（供决策）

**删除后重建同名实体会继承前世历史**。`deleteEntity` 有意保留历史做审计留档（还额外写一条 `deleted` 记录），而 `_generateEntityId` 是 `scopeId+name` 的确定性哈希——删除实体 A 再新建同名 A 会拿到同一个 `entityId`，于是新实体的历史里带着前世的全部记录，甚至能回滚到前世版本。两边各自都是有意设计，组合起来才有问题，修复涉及产品语义决策（是否在 create 时清理同 ID 旧历史、或给实体加 incarnation 标记），未擅自改动。

这一条也牵连到回滚按钮：`changeType='deleted'` 的历史条目同样带回滚入口。正常情况下实体已删除、用户根本打不开它的历史，够不着这个按钮；只有在上述同名重建的场景下才可能回滚到「前世删除前的快照」。等上面的语义定了再一并处理。

**`kg_entity_history` 没有 `(entity_id, version)` 唯一约束**。本轮从写入侧堵住了重复，但存量数据里修复前产生的重复仍在。补唯一约束需要先清洗存量数据，否则迁移会直接失败——前端因此仍用自增主键 `id` 而非 `version` 做列表 key。

### 一次被推翻的判断

用 mock 后端跑 memory 页时遇到 `TypeError: w.map is not a function`，整页崩到 ErrorBoundary。我据此判断"后端返回非数组会导致整页崩溃"，并按 43 处 `res?.data || []` 派了修复任务。

随后的后端核查**推翻了这个前提**：三道防线闭合——列表 handler 的 catch 走 500 + `data:null`；`errorHandler` 所有分支都是 4xx/5xx + `data:null`，无任何 2xx 分支；`api.ts` 拦截器对非 2xx 和 `code!==0` 都抛异常。那个崩溃是**我自己的 mock 返回了 `{code:0, data:{}}`**——真实后端不会产生的形状。已纠正任务方向，`asArray` 保留但重新定位为"前后端版本不一致时的形状漂移防御"，注释如实写明它不是在修已知崩溃。

同一轮核查挖出一个**真 bug**：`game/page.tsx:127/140/145` 写成 `res.data.data || []`，拦截器已剥过一层，导致预设/会话/角色三个列表**永远空白且不报错**。

另一处教训：给 mock 造数据时我凭印象拼了 `fromId`/`toId`/`type`，而后端实际是 `fromEntityId`/`toEntityId`/`relationType`，导致关系方向显示成"指向 张三"，我一度当成 UI bug。改用从 `_parseEntityRow`/`_parseRelationshipRow` 提取的真实字段名后，显示正确为"倾向于 指向 方案A"。字段名不能猜。

### SSE 解析器分块边界实测

批量测试改走服务端 SSE 后，最脆弱的环节是 `ssePostStream` 的手工拆包。直接跑 `lib/api.ts` 的真实实现（Node 24 `--experimental-strip-types` + mock fetch），按刁钻边界切分响应体：

```
OK  单块含三条完整事件        OK  分隔符 \n\n 被劈开（两个换行分属不同块）
OK  每条一块                OK  多字节中文被劈开（切在「你好世界」中间字节）
OK  事件被劈成两半           OK  末条事件无空行结尾
OK  逐字节投喂（314 个分块）→ response=你好世界，中文未损坏
```

三个最易漏的点都正确：半条事件留回 buffer 等下一片、`decode(value, {stream:true})` 处理跨块的多字节字符、流结束时冲掉无空行结尾的残留。

`startBatchTest` 的错误分流也审过：`receivedAnyEvent` 作回退判据（只有一条事件都没收到才回退客户端逐个测试，避免重复消耗渠道配额）、`completeSeenRef` 作中止判据（后端 `sendEvent` 在 aborted 时连 complete 一起丢弃，不能等 complete 才收尾）、中途断流保留已得结果并明确告知。

### Skills 触发机制的实测与说明

顺手验了触发链路，`mode` 语义全部正确（`all` 全选、`explicit` 无 `selectedNames` 返回 0、`auto` 无 `contextText` 返回 0）。但摸清了一个此前没写在任何地方的行为特征：

**触发是「整词子串包含」，且只拿用户当前这一条消息比对**。调用链是 `ChatService.js:858` / `ChatAgent.js:440` → `getSkillDocumentInstructions({ message })` → `normalizeDocumentOptions` 取 `options.message` 作 `contextText` → `matchesDocument` 用 `contextText.includes(term)`。

后果是「帮我总结一下今天的群聊」**不会**命中触发词 `群聊总结`——字不连续。这不是 bug，是关键词匹配的固有限制（Anthropic 原版 Agent Skills 由 LLM 读 description 自行判断，这里是简化实现），但写触发词的人必须知道，否则会以为配了关键词就能触发。

已给示例技能 `group-summary-style` 补上按真实说法列的连续片段（`总结群`、`总结一下群`、`聊了些什么`），并在 frontmatter 里写明机制。复测：

```
命中    总结群里今天聊了什么 / 群聊总结一下 / 看看大家聊了些什么 / 生成群日报
未命中  今天天气不错出去玩吧 / 总结一下这篇文章的要点     ← 正确，不误触发
未命中  帮我总结一下今天的群聊                        ← 子串匹配的固有限制
```

顺带确认 frontmatter 里的 `#` 注释被 YAML 正确忽略，没有混进 triggers 数据。

### memory 页加载期误显示空态

扫各页面状态覆盖时发现的：memory 页两处列表的条件链都缺 loading 分支。

- 记忆列表：`!userId → loadError → length === 0 → 数据`
- 图谱实体列表：`!selectedScope → graphLoadError → length === 0 → 表格`

`loading`/`graphLoading` 只用在按钮的 disabled 和 spinner 上，渲染层没用；而 fetch 时并不清空列表，于是首次加载和切换作用域期间列表仍是初始 `[]`，直接落到空态——用户先看到「该用户暂无记忆」「该作用域暂无实体」，再跳出真实数据。

各插入一个骨架分支，条件写成 `loading && length === 0`：只在手上没数据时出骨架，刷新已有列表时保持旧数据，否则整块被骨架顶掉再弹回来反而更闪。

同批扫描确认 `groups/edit`、`groups/[id]`、`knowledge/[id]` 三个页面状态计数为 0 不是问题——它们是包装页，内容委托给 `GroupEditor`/`KnowledgeEditor`，且都有 Suspense fallback。

### 全项目对话框宽度失效（24 处）

验证窄屏时顺手量了一下 skills 编辑对话框，发现 1440px 视口下它只有 512px 宽——而源码写的是 `max-w-5xl`（应为 1024px）。查下去是个全项目性的问题。

根因在 `components/ui/dialog.tsx:52`：`DialogContent` 的默认类里有 **`sm:max-w-lg`**，而调用方普遍传的是**无前缀**的 `max-w-2xl`/`max-w-3xl`/`max-w-5xl`。twMerge 把有无 `sm:` 前缀视为不同 group，**不合并**，两条规则一起留在 className 里；CSS 特异性相同，媒体查询包裹的 `sm:max-w-lg` 后定义而胜出。结果是所有这些对话框在 ≥640px 视口下统统被压成 512px——**开发者以为设了宽度，实际从未生效**。

实测与 twMerge 层面的双重确认：

```
浏览器：className 同时含 max-w-5xl 与 sm:max-w-lg，getComputedStyle().maxWidth = 512px

twMerge：传 max-w-5xl     → 保留 sm:max-w-lg + max-w-5xl              ← 并存，bug
        传 sm:max-w-5xl  → 保留 max-w-[calc(100%-2rem)] + sm:max-w-5xl  ← sm:max-w-lg 被正确移除
```

twMerge 是决定最终 className 的唯一环节，所以这个验证是决定性的，不必等构建。修法是把无前缀的 `max-w-*` 改成 `sm:max-w-*`（shadcn 官方示例本就是 `sm:max-w-[425px]` 这种写法）。全项目唯一写对的是 `components/channels/BatchTestPanel.tsx`（`max-w-[95vw] ... sm:max-w-5xl`）。

`max-w-lg` 的 17 处不动：与默认同宽，改了无收益，且大多带 `w-[95vw]`，窄屏由它兜住。

中途走过一次弯路：想在浏览器里用 `classList.add('sm:max-w-5xl')` 快速验证，结果宽度纹丝不动。原因是 Tailwind 只生成源码中出现过的类，运行时加的类名没有对应 CSS 规则——而且直接操作 classList 也绕过了 twMerge，而 twMerge 恰恰是这个修复的关键环节。验证样式修复不能靠运行时加类。

**已修**：sed 按行号精确替换 24 处，dry-run 确认未误伤 `max-h-`、`w-[95vw]`、`sm:max-h-[80vh]`。改后未加前缀的剩余 0 处，`sm:max-w-*` 共 25 处（24 新改 + BatchTestPanel）。twMerge 复验各典型用例，`sm:max-w-lg` 均已被移除、窄屏兜底 `max-w-[calc(100%-2rem)]` 与 `w-[95vw]` 保留。

`npx prettier --check` 报 14 个文件不合规，逐个 diff 确认全部与本次改动无关（`.map()` 换行、import 换行等既有问题），故未跑 `--write`，避免制造大量无关 diff 掩盖真实改动。

构建后在两个对话框 × 两个视口上实测，4 个数据点全部正确：

| 对话框 | 375px | 1440px |
|---|---|---|
| skills 编辑器 `sm:max-w-5xl` | 343px，`calc(100%-32px)` 兜底 | **1024px**（修复前 512） |
| 实体历史 `sm:max-w-2xl` | 343px，回滚按钮右边界 321 | **672px**（修复前 512） |

两端均无横向溢出，`sm:max-w-lg` 已从 className 消失，窄屏 `defaultMode` 单栏也未受影响。产物 CSS 中 `sm:max-w-2xl/3xl/4xl/5xl` 均已由 Tailwind 生成。

### 暗色模式扫描

代码层面扫描结果比预期干净：`text-black`、`bg-gray-50`、`border-gray-200`、`text-gray-900` 零出现，`bg-gray-100` 的 4 处全部配了 `dark:`。4 处 `bg-white` 中三处正常（`ToolDialogs.tsx:494` 有 `dark:` 配对，`Sidebar.tsx:142` 与 `command-palette.tsx:666` 是叠在主色背景上的 `bg-white/20` 半透明覆盖，暗色下同样成立）。

只有 `components/ui/slider.tsx:51` 的 thumb 用 `bg-white` 而非 shadcn 标准的 `bg-background`——暗色下滑块是纯白圆点配 `border-primary`。可用性没问题（对比度反而更高），但不跟随自定义主题。属规范偏离而非缺陷，改动会变更既有视觉，未擅自处理。

浏览器实测补充确认（判据：取 `lab()` 的 L 分量，挑出暗色下背景亮度 > 70 且不透明的元素）：

| 位置 | 背景 / 文字亮度 | 非 primary 的浅色元素 |
|---|---|---|
| 实体历史对话框 | 3 / 98，Alert 条 8 / 98 | **0** |
| Skills 编辑对话框 | 3 / 98，textarea 0 / 98 | **0** |

页面主区扫出 2 个亮度 91 的元素，查证均为 `bg-primary` 按钮（新建实体、查询）——暗色主题下 primary 本就是浅色，文字亮度 8、对比充足，属正确设计而非残留浅色。

### 极端数据：属性列静默截断

mock 里放了一个 18 属性、33 字符名称的实体。渲染本身没问题（名称换行、行高 73px、页面无横向溢出、表格有 `overflow-x-auto`），但发现属性列的写法是 `.slice(0, 2)` 且**没有任何省略提示**——18 个属性只显示 2 个，用户不点开详情就无从知道剩下 16 个存在，会误判为"这个实体只有两个属性"。

属性列宽固定 200px，截断本身是必要的，问题在于截断不可见。已抽出 `summarizeProperties()`，超出部分以 `+N` 标注（`属性字段1: xxx, 属性字段2: xxx +16`）。这与本轮其它几处的判断标准一致：截断可以做，但必须让用户看得见，否则界面在撒谎。

### 协作会话的实际产出（从留痕反推）

协作会话（skillsio）全程只发 idle 通知、没有一次实质回报，多次追问「窄屏/暗色/极端数据各自是查了没问题还是没查」也没有答复。但从工作区留下的痕迹可以确认它实际做过的事：

- 工作区里遗留了一张 `skills-editor-375-split.png`（21:07:20），是 375px 下切到分栏模式的截图。时间早于 `markdown-editor.tsx`(21:14) 与 `skill-editor-dialog.tsx`(21:15) 的改动，说明它先截图记录问题、再动手修——与我修复后实测到的「窄屏默认单栏」并不矛盾。
- 截图还显示它扩展过 mock 数据做极端测试：超长技能名（标题换行占 3 行）、超长附属文件名、以及带锁图标的 `scripts/build.sh`（验证不可编辑文件的只读标识）。这些都比我要求的更细。

所以它的技术产出是有效的（`asArray`、`normalizeGraphStats`、`defaultMode` 窄屏单栏，均已验证生效），问题出在协作环节：不回报导致我无法判断覆盖范围，只能自己重做一遍窄屏与暗色验证；那 24 处对话框宽度也因等不到回应而由我自己完成。截图已移出工作区（放到 scratchpad 留档），避免污染 git 状态。

### 多会话协作中的一次冲突

验证窄屏时读回的数据是：URL `127.0.0.1:38081`、视口 1440、maxWidth `none`——全不是我设的。查端口发现两个 `serve.mjs` 并存（38080 我的、38081 协作会话的），双方共用同一个 Playwright 浏览器实例，对方的导航与 resize 覆盖了我的操作。桌面端那次测在冲突之前、结果可信，窄屏验证重做了一遍。多会话并行操作浏览器时，读回的每个数值都要先确认 `location.port` 与 `window.innerWidth` 是不是自己设的。

### 新增 UI 的窄屏与回归验证

375px 下逐个量过，均无横向溢出（`document.documentElement.scrollWidth === window.innerWidth`）：

- **实体历史对话框**：那一行（`v{version}` 徽章 + changeType 徽章 + 时间戳 + `ml-auto` 回滚按钮）在 375px 下按钮换行到第二行，行高 58px，按钮右边界 328 < 375。容器本就有 `flex-wrap`、按钮有 `shrink-0`，我预判的"很可能挤爆"没有发生——写任务时没注意到已有 `flex-wrap`。
- **实体表格**：包在 `overflow-x-auto` 容器里，页面不溢出。
- **Skills 编辑对话框**：分栏模式在 375px 下确实不可用，已改为按 `useIsMobile()` 选择初始模式（`markdown-editor` 新增 `defaultMode` prop，缺省仍为 `split` 以免影响其它调用方）。实测窄屏 `data-state="active"` 落在「编辑」、textarea 占 86%（单栏）；桌面端 1440px 仍默认「分栏」、占 45%，无回归。

### 构建与交付

`npm run export` 完整跑通（lint 63 warnings / 0 errors，均为既有 unused-vars），`frontend/out` 与 `resources/web` 各 365 个文件、内容逐字节一致，buildId `PS-R3S3REW1PJhointywL` 唯一，`index.html` 引用的 chunk 全部存在。本轮全部新增文案（回滚到此版本 / 确认回滚 / 导入压缩包 / 新建实体 / 新建关系 / 停止测试）均已进入产物。

同步校验中差点误判一次：第一次核对时「回滚到此版本」在 `resources/web` 里 0 命中，看着像同步丢文件。实际是我的等待条件写成了「文件数 > 300」，而总数 365，于是在 `cpSync` 复制途中就返回并开始 grep。改为等待完成后复核，两侧一致。

game 页修复已用最终产物端到端确认：预设列表渲染出「林晚 / 现代都市·咖啡店主 / 性格 / 场景」，会话列表渲染出「p1 / 用户 10001 / ❤️42 🤝30 💰100 / 关系: 熟人」——修复前这两处恒为空。

## 2026-08-31 QQBot、MCP、工具、Skills 与知识图谱全链路收口（未提交）

### 标准工具边界与 QQBot

- 新增 `src/core/platform/*`，把消息、目录、群成员、文件、原始协议包和结果校验统一到 `StandardBotApi` / `StandardFileApi` / `StandardRawApi`；旧 `helpers`、`platformAdapter`、`eventAdapter`、`group` 仅保留兼容薄代理。AST 门禁覆盖 `src/mcp/tools`，禁止业务工具重新调用 `pickGroup`、`pickFriend`、`sendApi` 等协议实现。
- 依据 `temp/Yunzai-QQBot-Plugin/index.js` 的实际实现，QQBot `group.getChatHistory(seq)` 是以 `message_id` 查本地缓存，不是数字分页。历史、引用、表情回应、群上下文、群总结、Reaction 和 MessageInspector 均保留字符串 `message_id`/OpenID；后台任务没有消息锚点时明确走缓冲区或返回不支持，不再传 `0` 或 `Number(OpenID)`。
- 内置 281 个模块化工具与 1 个 JS 工具均有对象型 `inputSchema`、有效说明和 handler；名称总数 282，重复名称为 0。
- 当前系统 `inotify` 实例额度已被其他进程耗尽，`fs.watch` 返回 `ENOSPC`。已新增 2 秒目录轮询兜底并 `unref`，模型/面板显式保存仍立即热重载，外部手工改文件也不会因监听额度耗尽永久失效。

### MCP 与模型自建工具

- `McpClient` 覆盖 2026-07-28 modern、2025-11-25/2025-06-18/2025-03-26 session、2024-11-05 HTTP+SSE 及 stdio/npm/npx；含时代协商、独立探测进程、UTF-8 分块、请求取消、会话 404 重建、严格 JSON-RPC id/version/result 校验和增量 SSE。
- `McpProtocol` 统一 `Mcp-Name`、`Mcp-Param-*`、Base64 头、`x-mcp-header` 与工具/资源/模板/提示词元数据白名单；内置、JS、外部工具和聚合路由均复用同一实现。
- 资源、资源模板、提示词支持分页、来源身份、面板 API 和聚合 MCP 路由；`resources/read` 与 `prompts/get` 均透传 `input_required`、`inputRequests`、`requestState`。自引用服务器登记为 `skipped` 并清理旧连接；远程同路径 `/chatai/mcp` 不再被误判为自引用。
- `CustomToolService` 统一旧配置型工具与完整 ESM 源码工具；模型可通过 `create_custom_tool` / `update_custom_tool` 创建、原子热加载并在同一轮立即调用，失败恢复旧文件。名称、schema、源码路径、符号链接、权限和来源冲突均有稳定拒绝语义。

### 下载、历史与记忆

- 下载链逐跳 DNS/IP 校验并固定已验证地址，限制重定向、响应大小和超时；跨源剥离认证头，文件以 `0600` 原子写入。受管下载发送成功/失败后立即清理，未发送残留按 TTL 扫描清理，清理计时器 `unref`。
- assistant 的 `toolCalls` 和对应 role=`tool` 结果均进入持久历史；未知、歧义、审批拒绝、参数错误和执行失败也保留同一 `tool_call_id` 供模型自纠并进入统计。数据库同毫秒消息按 `timestamp,id` 稳定排序与裁剪。
- 共享群会话持久化 `sender`，按目标用户轮次读取；记忆合并、LLM 总结、低质量清理和分类替换区分未传 `groupId`、显式 `null` 与具体群，跨群不会互相合并，替换写入失败整批回滚。

### 知识图谱与 Skills 前端

- 图谱后端已覆盖实体/关系 CRUD、历史/回滚、分页计数、子图、路径、上下文、完整流式导出、原子导入、作用域和统计；修复路径深度按边数、悬空边、节点/边截断、特殊路径 ID、LIKE 转义、原型键和重复版本膨胀。
- 图谱工作台已可实际管理作用域、实体、关系、属性、历史、回滚、导入导出、SVG 可视化、子图/路径/上下文查询；请求竞态、Blob 错误包、URL 编码、移动端横向溢出和可访问性均已处理。列表查询改用重复查询键，含逗号的作用域不会再被拆坏。
- Skills 页面已覆盖新建、ZIP 导入、结构化 frontmatter、源码编辑、附属文本新建/编辑/删除、二进制只读/下载、加载/卸载和兼容警告。MCP 页面新增资源、资源模板和提示词清单。

### 最终验证

- `node --test test/*.test.js`：218/218 通过；`qqbot-tooling-regression` 与 `tool-core-regression` 通过。
- `find apps src -name '*.js' ... node --check`、Prettier、`git diff --check`、frontend typecheck、ESLint 均通过。
- Next 16.1.5 静态导出 33/33 页面通过；`frontend/out` 与 `resources/web` 各 366 文件、33 个 HTML，合并 SHA-256 均为 `7e9425781d6b55e4ef05f372e9a20956306a496118922d56cb36d6ac98a0128d`，文件差异 0、HTML 静态引用缺失 0。
- 浏览器实测图谱与 Skills 工作台；补测 MCP「资源与提示」Tab 在 390×844 下正确渲染资源、模板、提示词参数，页面横向溢出为 0，控制台错误为 0。

### 尚待精确定义的业务契约

- `kg_scope_sharing.share_type` 与 `entity_types` 目前只有存储字段，仓库中没有允许值、继承方向或过滤规则；服务不会擅自把未定义字符串解释为权限。需要明确契约后才能安全接入上下文和管理 UI。
- 聚合多个 MCP 服务器时，重复 resource URI 的读取身份没有协议内命名空间；当前保留全部来源清单但无来源的标准 `resources/read` 只能按 URI 索引。需要明确是拒绝重复 URI，还是定义项目级别的别名规则。
- 本轮没有重启真实 Yunzai，也没有在在线 QQBot/ICQQ/OneBot 与第三方 MCP 服务上执行消息、文件和管理动作；当前证据为参考插件精确契约、隔离路由/进程测试与浏览器 mock 回归。

## 2026-08-31 图谱写入入口复核与静态包交付修复

### 根因与修复

- 复核发现旧版 `memory` 静态页面在空图谱且 `/scopes` 返回空数组时，`selectedScope` 保持空字符串，`新建实体`按钮一直被禁用；关系编辑入口也未完整进入旧页面。
- 当前 `frontend` 嵌套工作树已使用完整 `GraphWorkspace`，默认 `global` 作用域并提供实体/关系新建、编辑、删除、历史与回滚。真正由 Yunzai 托管的是根目录 `resources/web`，本轮重新导出 33 个 HTML 与全部 Next 静态资源，并将新增 chunk、manifest 和删除/重命名资源纳入根仓库索引，避免部署时只带旧空壳页面。
- `useGraphWorkspace` 将实体列表与 `/entities/count` 解耦：旧后端缺少计数接口或计数响应异常时，列表仍显示，保留既有数据并给出可重试/降级提示；标准响应、Axios 双层响应和单字段 `data` 响应统一解包。记忆页顶部统计也复用同一规则。
- 根据启动日志修正 `src/services/ErrorNotifier.js` 的相对导入路径（`../core/platform/index.js`），并增加动态导入门禁，避免插件加载阶段跳过 `chat.js`。
- `webServer` 对 HTML/RSC 文本载荷下发 `Cache-Control: no-store`，避免浏览器或反向代理继续拼接旧页面清单与新 chunk。

### 验证

- `node --test test/*.test.js`：228/228 通过；新增 `errorNotifierImport`、`graphFrontendResilience`、`frontendStaticBundle` 与图谱写入契约测试。
- stdio 协议回归夹具的正常握手窗口调整为 3 秒（取消场景仍使用显式短超时），消除多测试 worker 并发调度造成的时代误判。
- `npm run typecheck --prefix frontend`、`npm run lint --prefix frontend`、根目录 `npm run format:check` 均通过。
- 静态包核对：`frontend/out` 与 `resources/web` 各 366 个文件、33 个 HTML；HTML 引用的 70 个 Next 资源全部存在；图谱工作台所在 chunk 包含新建实体和创建关系处理代码。
- 浏览器在实际 Yunzai 端口完成实体新建（POST 201）与实体编辑（PUT 200）；同一运行包完成关系新建（POST 201）和关系属性编辑（PUT 200），成功提示、刷新后的列表/统计均可见，测试数据随后删除。
