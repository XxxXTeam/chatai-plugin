# Copilot Usage Notes for ChatAI Plugin

- 本仓库是 Yunzai-Bot 插件（ESM，Node ≥18）。入口 `index.js` 在插件加载时注册应用层 `apps/` 模块（`chat.js`, `Commands.js`, `Management.js`, `GroupEvents.js`, `ImageGen.js`, `bym.js` 等），它们基于事件/命令驱动并调用服务层。
- 服务层位于 `src/services/`: `llm/ChatService` + `ChannelManager` + `ContextManager` 负责消息编排、上下文和模型选择；`storage/DatabaseService` + `MemoryManager`/`KnowledgeService` 提供 SQLite 持久化与向量检索；`media/`、`preset/`、`scope/`、`stats/` 等提供周边能力；`webServer.js` 暴露管理面板 API（前端产物位于 `resources/web`）。
- 核心抽象在 `src/core/`: `adapters/` 适配不同 LLM（OpenAI/Gemini/Claude...），遵循 `BaseAdapter.chat/chatStream/listModels/testConnection`；`cache/RedisClient` 可选缓存；`utils/`、`types/` 为通用工具。新增模型→实现适配器后在 `adapters/index.js` 注册。
- MCP/工具体系：`src/mcp/BuiltinMcpServer` + `McpManager` + `McpClient` 装配内置工具集合 `src/mcp/tools`（basic/user/group/message/admin/media/search/...）。用户自定义工具放 `data/tools/*.js`，热重载，参照 `data/tools/README.md` & `docs/TOOLS.md`。危险工具开关在 `config.yaml` 的 `builtinTools.dangerousTools/allowDangerous`。
- 数据与配置：运行数据写入 `data/`（SQLite、presets、knowledge、images、font 等）。配置由 `config/config.js` 读取 `config.yaml`；关键段包括 `basic` 触发方式/命令前缀、`channels`（多路 LLM、流式、代理）、`context`、`memory`、`mcp`、`bym`（伪人模式）。默认命令如 `#ai管理面板` 返回 Web 面板临时链接。
- 前端：Next.js 代码在 `frontend/`（pnpm dev/build），构建产物落 `resources/web` 供后端静态托管；管理页路由位于 `frontend/app/(dashboard)` 等。
- 安装/构建常见流程（需在 Yunzai 根目录）：`pnpm install` → `pnpm approve-builds`（或 `pnpm rebuild better-sqlite3`）编译 SQLite 原生模块 → `pnpm start` 或 `node app` 启动 Yunzai。更新可用机器人命令 `#ai更新` 或 git pull + reinstall。
- 测试：采用 Vitest；用例位于 `tests/`（如 `tests/services/ChatService.test.js`、`tests/tools/basic.test.js`）。运行 `pnpm test`，可用 `pnpm test -- --grep "ChatService"`、`--coverage`。
- 代码风格：命名 PascalCase 类、camelCase 函数/变量、UPPER_SNAKE_CASE 常量；统一 async/await，错误返回 `{ success, error }` 并用 `logger.<level>` 记录（格式 `[Module] ...`）。
- 对话/上下文模式：通过 `ContextManager.getConversationId` 构造会话键，`context.maxMessages/maxTokens/cleaningStrategy` 控制截断；记忆由 `MemoryManager` 自动提取/合并，用户画像/群记忆依赖长期记忆搜索。
- 工具调用/消息流：Yunzai 事件 → `apps` 消息解析 → `services/llm` 生成回复并可触发 MCP 工具 → 结果经平台适配器（`src/utils/platformAdapter.js`）回复；群管理/伪人/图片生成等均在各 app 子模块实现。
- 常见坑：未跑 `pnpm approve-builds` 会导致 better-sqlite3 无法加载；若使用 Redis，检查 `config.yaml` 对应连接；自定义工具命名不得与内置冲突且需符合 JSON Schema；调试模式在 `config.yaml basic.debug`，如需 VSCode attach 使用 `node --inspect app`（配置见 `docs/DEVELOPMENT.md`）。
