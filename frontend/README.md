# Chaite 管理面板

基于 Next.js 15 + shadcn/ui 构建的现代化 Yunzai-Bot AI 插件管理面板。

## 特性

- **现代化UI** - 基于 shadcn/ui 组件库，深色主题支持
- **响应式设计** - 完美适配移动端和桌面端
- **完整功能** - 涵盖所有配置管理功能

## 功能页面

| 页面 | 功能 |
|------|------|
| 仪表盘 | 系统状态概览、渠道状态、统计数据 |
| 系统设置 | 基础配置、触发设置、上下文配置 |
| 渠道管理 | API渠道配置、连接测试、模型管理 |
| 预设管理 | 对话预设、系统提示词配置 |
| 工具配置 | 内置工具开关、参数配置 |
| MCP服务 | MCP服务器状态、工具列表 |
| 对话历史 | 查看和管理对话记录 |
| 调用记录 | 工具调用日志和统计 |
| 用户管理 | 用户个性化配置 |

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建生产版本
npm run build

# 启动生产服务
npm start
```

## 环境配置

编辑 `.env.local` 配置后端API地址：

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## 技术栈

- **框架**: Next.js 15 (App Router)
- **UI**: shadcn/ui + Tailwind CSS
- **状态管理**: Zustand
- **HTTP**: Axios + SWR
- **图标**: Lucide React
- **通知**: Sonner

## 开发

```bash
# 添加 shadcn 组件
npx shadcn@latest add [component-name]

# 类型检查
npm run lint
```

## 目录结构

```
next-frontend/
├── app/                    # 页面路由
│   ├── layout.tsx         # 根布局
│   ├── login/             # 登录页
│   └── (dashboard)/       # Dashboard路由组
│       ├── layout.tsx     # Dashboard布局
│       ├── page.tsx       # 仪表盘
│       ├── settings/      # 设置页面
│       ├── channels/      # 渠道管理
│       ├── presets/       # 预设管理
│       ├── tools/         # 工具配置
│       ├── mcp/           # MCP服务
│       ├── conversations/ # 对话历史
│       ├── history/       # 调用记录
│       └── users/         # 用户管理
├── components/
│   ├── layout/            # 布局组件
│   └── ui/                # shadcn组件
├── lib/
│   ├── api.ts             # API封装
│   ├── store.ts           # Zustand存储
│   └── utils.ts           # 工具函数
└── public/                # 静态资源
```
