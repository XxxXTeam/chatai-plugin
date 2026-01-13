/**
 * 类型定义导出索引
 */

// MCP 相关类型
export * from './mcp'

// 重新导出常用类型（方便导入）
export type {
    // 基础类型
    McpTransportType,
    McpServerStatus,
    ToolSource,
    // 服务器配置
    StdioServerConfig,
    NpmServerConfig,
    SseServerConfig,
    HttpServerConfig,
    McpServerConfig,
    McpServerConfigWithTransport,
    // 服务器信息
    McpServer,
    McpServerDetail,
    // 工具类型
    JsonSchema,
    McpTool,
    ToolCategory,
    ToolExecuteResult,
    // 资源与提示词
    McpResource,
    McpPrompt,
    // Skills Agent
    SkillDefinition,
    ExecutableSkill,
    SkillsAgentStatus,
    ToolStats,
    ToolsBySource,
    // npm 包
    NpmMcpPackage,
    NpmPackageCategory,
    // SSE 事件
    SseEventType,
    SseEventData,
    // API 响应
    ApiResponse,
    McpServersResponse,
    McpServerDetailResponse,
    McpToolsResponse,
    ToolCategoriesResponse,
    ToolExecuteResponse,
    SkillsStatusResponse,
    // 表单
    AddServerFormData,
    ServerConfigValidation
} from './mcp'
