/**
 * MCP (Model Context Protocol) 相关类型定义
 * 包含服务器、工具、连接等所有相关类型
 */

// ============ 基础类型 ============

/**
 * MCP 传输类型
 */
export type McpTransportType = 'stdio' | 'npm' | 'npx' | 'sse' | 'http'

/**
 * 服务器连接状态
 */
export type McpServerStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/**
 * 工具来源类型
 */
export type ToolSource = 'builtin' | 'custom-tools' | 'external'

// ============ 服务器配置 ============

/**
 * stdio 类型配置
 */
export interface StdioServerConfig {
    type: 'stdio'
    /** 执行命令 */
    command: string
    /** 命令参数 */
    args?: string[]
    /** 环境变量 */
    env?: Record<string, string>
    /** 工作目录 */
    cwd?: string
}

/**
 * npm/npx 类型配置
 */
export interface NpmServerConfig {
    type: 'npm' | 'npx'
    /** npm 包名（如 @anthropic/mcp-server-filesystem） */
    package: string
    /** 包参数 */
    args?: string[]
    /** 环境变量 */
    env?: Record<string, string>
    /** 工作目录 */
    cwd?: string
}

/**
 * SSE 类型配置
 */
export interface SseServerConfig {
    type: 'sse'
    /** SSE 端点 URL */
    url: string
    /** 请求头 */
    headers?: Record<string, string>
}

/**
 * HTTP 类型配置
 */
export interface HttpServerConfig {
    type: 'http'
    /** HTTP 端点 URL */
    url: string
    /** 请求头 */
    headers?: Record<string, string>
    /** 超时时间（毫秒） */
    timeout?: number
}

/**
 * 服务器配置联合类型
 */
export type McpServerConfig = StdioServerConfig | NpmServerConfig | SseServerConfig | HttpServerConfig

/**
 * 带 transport 嵌套的配置格式（兼容 Claude Desktop 格式）
 */
export interface McpServerConfigWithTransport {
    transport: McpServerConfig
    /** 额外的顶层配置 */
    env?: Record<string, string>
    headers?: Record<string, string>
}

// ============ 服务器信息 ============

/**
 * MCP 服务器信息
 */
export interface McpServer {
    /** 服务器名称（唯一标识） */
    name: string
    /** 连接状态 */
    status: McpServerStatus
    /** 传输类型 */
    type: McpTransportType
    /** 服务器配置 */
    config: McpServerConfig | McpServerConfigWithTransport
    /** 工具数量 */
    toolsCount: number
    /** 资源数量 */
    resourcesCount?: number
    /** 提示词数量 */
    promptsCount?: number
    /** 连接时间戳 */
    connectedAt?: number
    /** 错误信息 */
    error?: string
    /** 是否为内置服务器 */
    isBuiltin?: boolean
    /** 是否为自定义工具服务器 */
    isCustomTools?: boolean
}

/**
 * 服务器详情（包含工具列表）
 */
export interface McpServerDetail extends McpServer {
    /** 工具列表 */
    tools: McpTool[]
    /** 资源列表 */
    resources: McpResource[]
    /** 提示词列表 */
    prompts: McpPrompt[]
    /** 服务器信息 */
    serverInfo?: {
        name: string
        version: string
    }
    /** 服务器能力 */
    capabilities?: Record<string, unknown>
}

// ============ 工具类型 ============

/**
 * JSON Schema 类型
 */
export interface JsonSchema {
    type: 'object' | 'string' | 'number' | 'boolean' | 'array' | 'null'
    properties?: Record<
        string,
        JsonSchema & {
            description?: string
            default?: unknown
            enum?: unknown[]
        }
    >
    required?: string[]
    items?: JsonSchema
    description?: string
    additionalProperties?: boolean | JsonSchema
}

/**
 * MCP 工具定义
 */
export interface McpTool {
    /** 工具名称 */
    name: string
    /** 工具描述 */
    description: string
    /** 参数 Schema */
    inputSchema: JsonSchema
    /** 所属服务器 */
    serverName: string
    /** 是否为内置工具 */
    isBuiltin?: boolean
    /** 是否为 JS 工具 */
    isJsTool?: boolean
    /** 是否为自定义工具 */
    isCustom?: boolean
    /** 是否为 MCP 外部工具 */
    isMcpTool?: boolean
    /** 工具类别 */
    category?: string
    /** 是否启用 */
    enabled?: boolean
    /** 是否为危险工具 */
    isDangerous?: boolean
}

/**
 * 工具类别
 */
export interface ToolCategory {
    /** 类别键名 */
    key: string
    /** 类别显示名称 */
    name: string
    /** 类别描述 */
    description?: string
    /** 类别图标 */
    icon?: string
    /** 工具数量 */
    toolCount: number
    /** 包含的工具 */
    tools: Array<{
        name: string
        description: string
    }>
    /** 是否启用 */
    enabled: boolean
}

/**
 * 工具执行结果
 */
export interface ToolExecuteResult {
    /** 结果内容 */
    content: Array<{
        type: 'text' | 'image' | 'resource'
        text?: string
        data?: string
        mimeType?: string
        resource?: {
            uri: string
            mimeType: string
            text: string
        }
    }>
    /** 是否错误 */
    isError?: boolean
    /** 错误信息 */
    errorMessage?: string
    /** 权限被拒绝 */
    permissionDenied?: boolean
    /** 工具被禁用 */
    toolDisabled?: boolean
}

// ============ 资源与提示词 ============

/**
 * MCP 资源
 */
export interface McpResource {
    /** 资源 URI */
    uri: string
    /** 资源名称 */
    name: string
    /** 资源描述 */
    description?: string
    /** MIME 类型 */
    mimeType?: string
    /** 所属服务器 */
    serverName: string
}

/**
 * MCP 提示词
 */
export interface McpPrompt {
    /** 提示词名称 */
    name: string
    /** 提示词描述 */
    description?: string
    /** 参数定义 */
    arguments?: Array<{
        name: string
        description?: string
        required?: boolean
    }>
    /** 所属服务器 */
    serverName: string
}

// ============ Skills Agent 类型 ============

/**
 * 技能定义（用于 AI 调用）
 */
export interface SkillDefinition {
    type: 'function'
    function: {
        name: string
        description: string
        parameters: JsonSchema
    }
}

/**
 * 可执行技能（包含 run 方法）
 */
export interface ExecutableSkill {
    function: {
        name: string
        description: string
        parameters: JsonSchema
    }
    run: (args: Record<string, unknown>) => Promise<string>
}

/**
 * Skills Agent 状态
 */
export interface SkillsAgentStatus {
    /** MCP 服务器列表 */
    servers: Array<{
        name: string
        status: McpServerStatus
        type: McpTransportType
        toolsCount: number
        connectedAt?: number
    }>
    /** 工具统计 */
    stats: ToolStats
    /** 类别列表 */
    categories: Array<{
        key: string
        name: string
        toolCount: number
        enabled: boolean
    }>
    /** 时间戳 */
    timestamp: number
}

/**
 * 工具统计
 */
export interface ToolStats {
    /** 总数 */
    total: number
    /** 已启用 */
    enabled: number
    /** 已禁用 */
    disabled: number
    /** 按类别统计 */
    categories: Record<
        string,
        {
            name: string
            total: number
            enabled: number
            disabled: number
            isCategoryEnabled: boolean
        }
    >
    /** JS 工具统计 */
    jsTools: {
        total: number
        enabled: number
        disabled: number
    }
}

/**
 * 按来源分组的工具
 */
export interface ToolsBySource {
    /** 内置工具 */
    builtin: McpTool[]
    /** 自定义 JS 工具 */
    custom: McpTool[]
    /** MCP 外部工具（按服务器分组） */
    mcp: Record<string, McpTool[]>
}

// ============ npm 包相关 ============

/**
 * 预配置的 npm MCP 包
 */
export interface NpmMcpPackage {
    /** 包名 */
    package: string
    /** 显示名称 */
    name: string
    /** 包描述 */
    description: string
    /** 图标 */
    icon?: string
    /** 分类 */
    category: string
    /** 默认参数 */
    defaultArgs?: string[]
    /** 需要的环境变量 */
    requiredEnv?: string[]
    /** 可选环境变量 */
    optionalEnv?: string[]
    /** 使用说明 */
    usage?: string
    /** npm 链接 */
    npmUrl?: string
    /** 文档链接 */
    docsUrl?: string
}

/**
 * npm 包分类
 */
export type NpmPackageCategory =
    | 'filesystem'
    | 'database'
    | 'search'
    | 'development'
    | 'communication'
    | 'productivity'
    | 'ai'
    | 'other'

// ============ SSE 事件类型 ============

/**
 * SSE 事件类型
 */
export type SseEventType =
    | 'connected'
    | 'heartbeat'
    | 'server-connecting'
    | 'server-connected'
    | 'server-reconnecting'
    | 'server-reconnected'
    | 'server-removed'
    | 'server-error'
    | 'tool-executed'
    | 'tool-toggled'
    | 'category-toggled'
    | 'tools-reloaded'
    | 'tools-enabled-all'
    | 'tools-disabled-all'

/**
 * SSE 事件数据
 */
export interface SseEventData {
    connected: { time: number }
    heartbeat: { time: number }
    'server-connecting': { name: string; timestamp: number }
    'server-connected': { name: string; toolsCount: number; timestamp: number }
    'server-reconnecting': { name: string; attempt: number; timestamp: number }
    'server-reconnected': { name: string; timestamp: number }
    'server-removed': { name: string; timestamp: number }
    'server-error': { name: string; error: string; timestamp: number }
    'tool-executed': { toolName: string; success: boolean; duration?: number; timestamp: number }
    'tool-toggled': { toolName: string; enabled: boolean; timestamp: number }
    'category-toggled': { category: string; enabled: boolean; timestamp: number }
    'tools-reloaded': { count: number; timestamp: number }
    'tools-enabled-all': { count: number; timestamp: number }
    'tools-disabled-all': { count: number; timestamp: number }
}

// ============ API 响应类型 ============

/**
 * 通用 API 响应
 */
export interface ApiResponse<T = unknown> {
    code: number
    success: boolean
    data?: T
    message?: string
    error?: string
}

/**
 * 服务器列表响应
 */
export type McpServersResponse = ApiResponse<McpServer[]>

/**
 * 服务器详情响应
 */
export type McpServerDetailResponse = ApiResponse<McpServerDetail>

/**
 * 工具列表响应
 */
export type McpToolsResponse = ApiResponse<{
    count: number
    tools: McpTool[]
}>

/**
 * 工具类别响应
 */
export type ToolCategoriesResponse = ApiResponse<ToolCategory[]>

/**
 * 工具执行响应
 */
export type ToolExecuteResponse = ApiResponse<ToolExecuteResult>

/**
 * Skills 状态响应
 */
export type SkillsStatusResponse = ApiResponse<SkillsAgentStatus>

// ============ 表单类型 ============

/**
 * 添加服务器表单数据
 */
export interface AddServerFormData {
    name: string
    type: McpTransportType
    // stdio
    command?: string
    args?: string
    // npm
    package?: string
    // sse/http
    url?: string
    headers?: string
    // 通用
    env?: string
}

/**
 * 服务器配置验证结果
 */
export interface ServerConfigValidation {
    valid: boolean
    errors: string[]
    warnings?: string[]
}

// 所有类型已通过命名导出 (export type/interface) 导出
// 无需默认导出，TypeScript 类型不能作为运行时值导出
