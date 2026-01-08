/**
 * Tool Adapter - 统一工具接口
 * 
 * 所有工具相关功能已整合到 SkillsAgent，此模块仅作为兼容层重导出
 * @deprecated 请直接使用 SkillsAgent
 */

// 重导出 SkillsAgent 的所有工具相关函数（避免重复实现）
export {
    getAllTools,
    executeTool,
    setToolContext,
    getToolContext,
    refreshBuiltinTools,
    getBuiltinToolsList,
    isDangerousTool,
    checkToolAvailable,
    getToolCallLimits,
    convertMcpTools
} from '../../services/agent/SkillsAgent.js'

// 重导出 McpManager 的 setToolContext（兼容性）
import { mcpManager } from '../../mcp/McpManager.js'
export { mcpManager }
