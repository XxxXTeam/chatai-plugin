/**
 * 服务模块统一导出
 * 按功能分类组织
 */

// ==================== LLM & 对话 ====================
export { LlmService } from './llm/LlmService.js'
export { ChatService, chatService } from './llm/ChatService.js'
export { channelManager } from './llm/ChannelManager.js'
export { contextManager } from './llm/ContextManager.js'

// ==================== 预设管理 ====================
export { presetManager } from './preset/PresetManager.js'
export { BUILTIN_PRESETS, getPresetCategories, getBuiltinPreset } from './preset/BuiltinPresets.js'

// ==================== 存储 & 知识库 ====================
export { databaseService } from './storage/DatabaseService.js'
export { knowledgeService } from './storage/KnowledgeService.js'
export { memoryManager } from './storage/MemoryManager.js'

// ==================== 统计 & 日志 ====================
export { statsService } from './stats/StatsService.js'
export { usageStats } from './stats/UsageStats.js'
export { logService } from './stats/LogService.js'

// ==================== 作用域 & 权限 ====================
export { getScopeManager } from './scope/ScopeManager.js'
export { keyManager } from './scope/KeyManager.js'

// ==================== 媒体处理 ====================
export { imageService } from './media/ImageService.js'
export { renderService } from './media/RenderService.js'

// ==================== 代理 & 请求 ====================
export { proxyService } from './proxy/ProxyService.js'
export { requestTemplateService } from './proxy/RequestTemplateService.js'

// ==================== 工具 ====================
export { toolFilterService } from './tools/ToolFilterService.js'

// ==================== 中间件 ====================
export * from './middleware/index.js'

// ==================== 路由 ====================
export * from './routes/index.js'
