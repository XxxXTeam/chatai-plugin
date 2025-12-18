# 贡献指南

感谢你对 ChatAI Plugin 的关注！我们欢迎任何形式的贡献。

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发环境](#开发环境)
- [提交规范](#提交规范)
- [代码规范](#代码规范)
- [Pull Request 流程](#pull-request-流程)

## 行为准则

- 尊重所有贡献者
- 保持友善和建设性的讨论
- 接受建设性的批评

## 如何贡献

### 报告 Bug

1. 搜索 [已有 Issue](https://github.com/XxxXTeam/chatai-plugin/issues) 确认问题未被报告
2. 使用 Bug 报告模板创建新 Issue
3. 提供详细的复现步骤和环境信息

### 提出功能建议

1. 搜索 [已有 Issue](https://github.com/XxxXTeam/chatai-plugin/issues) 确认建议未被提出
2. 使用功能请求模板创建新 Issue
3. 描述使用场景和期望实现

### 提交代码

1. Fork 本仓库
2. 创建特性分支
3. 提交更改
4. 创建 Pull Request

## 开发环境

### 环境要求

- Node.js >= 18
- pnpm >= 8.0
- Git

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/XxxXTeam/chatai-plugin.git
cd chatai-plugin

# 安装依赖
pnpm install

# 构建原生模块
pnpm rebuild better-sqlite3

# 前端开发（可选）
cd frontend
pnpm install
pnpm dev
```

## 提交规范

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范。

### 提交格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type 类型

| Type | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档更新 |
| `style` | 代码格式（不影响代码运行的变动） |
| `refactor` | 重构（既不是新功能也不是修复 Bug） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建过程或辅助工具的变动 |
| `revert` | 回滚提交 |
| `ci` | CI/CD 配置 |

### Scope 范围（可选）

| Scope | 说明 |
|-------|------|
| `core` | 核心模块 |
| `mcp` | MCP 相关 |
| `web` | Web 管理面板 |
| `adapter` | LLM 适配器 |
| `tool` | 内置工具 |
| `config` | 配置相关 |
| `db` | 数据库相关 |
| `memory` | 记忆系统 |
| `preset` | 预设系统 |

### 提交示例

```bash
# 新功能
feat(mcp): 添加并行工具调用支持

# Bug 修复
fix(adapter): 修复 Gemini 流式响应中断问题

# 文档更新
docs: 更新 README 安装说明

# 重构
refactor(core): 重构消息处理流程

# 性能优化
perf(db): 优化数据库查询性能

# 构建相关
chore: 升级依赖版本
```

### Breaking Changes

如果有破坏性变更，需要在 footer 中说明：

```
feat(config): 重构配置文件结构

BREAKING CHANGE: 配置文件格式已更改，需要重新配置
- `channels` 字段结构变更
- 移除 `legacy` 配置项
```

## 代码规范

### JavaScript/Node.js

- 使用 ES Module (`import/export`)
- 使用 `async/await` 处理异步
- 变量命名使用 camelCase
- 常量命名使用 UPPER_SNAKE_CASE
- 类命名使用 PascalCase
- 文件命名使用 camelCase 或 PascalCase

### 代码风格

```javascript
// ✅ 推荐
const getUserInfo = async (userId) => {
  const user = await db.getUser(userId)
  return user
}

// ❌ 避免
function getUserInfo(userId) {
  return new Promise((resolve) => {
    db.getUser(userId).then(user => resolve(user))
  })
}
```

### 注释规范

```javascript
/**
 * 获取用户信息
 * @param {string} userId - 用户 ID
 * @returns {Promise<Object>} 用户信息对象
 */
async function getUserInfo(userId) {
  // ...
}
```

## Pull Request 流程

### 1. Fork 和克隆

```bash
# Fork 仓库后克隆到本地
git clone https://github.com/YOUR_USERNAME/chatai-plugin.git
cd chatai-plugin

# 添加上游仓库
git remote add upstream https://github.com/XxxXTeam/chatai-plugin.git
```

### 2. 创建分支

```bash
# 同步上游代码
git fetch upstream
git checkout main
git merge upstream/main

# 创建特性分支
git checkout -b feat/your-feature
# 或
git checkout -b fix/bug-description
```

### 3. 开发和提交

```bash
# 开发完成后提交
git add .
git commit -m "feat(scope): add new feature"

# 推送到 Fork 仓库
git push origin feat/your-feature
```

### 4. 创建 PR

1. 在 GitHub 上创建 Pull Request
2. 填写 PR 模板
3. 等待 Review

### 5. Review 和合并

- 根据 Review 意见修改代码
- 修改后推送更新
- 等待合并

## 问题？

如有任何问题，欢迎：
- 提交 [Issue](https://github.com/XxxXTeam/chatai-plugin/issues)
- 加入 QQ 交流群讨论

感谢你的贡献！ ❤️
