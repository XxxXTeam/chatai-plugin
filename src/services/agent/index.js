/**
 * Agent 模块 - 统一代理系统
 * 
 * SkillsAgent 使用 McpManager 加载工具，不重复实现
 * 工具辅助函数统一从 mcp/tools/helpers.js 导出
 */

export { ChatAgent, chatAgent, createChatAgent, quickChat } from './ChatAgent.js'
export { 
    SkillsAgent, createSkillsAgent,
    getAllTools, executeTool, setToolContext, getToolContext, refreshBuiltinTools, 
    getBuiltinToolsList, isDangerousTool, checkToolAvailable, getToolCallLimits, convertMcpTools
} from './SkillsAgent.js'

// 工具辅助函数统一从 mcp/tools/helpers.js 导出（不再使用 ToolHelpers.js）
export {
    icqqGroup, icqqFriend, callOneBotApi,
    getGroupMemberList, filterMembers, randomSelectMembers, findMemberByName, formatMemberInfo,
    batchSendMessages, validateParams, paramError, checkParams,
    sendMessage, sendForwardMessage, parseRichContent, buildForwardNodes,
    detectProtocol, getBotInfo, normalizeSegment, normalizeSegments, getMasterList
} from '../../mcp/tools/helpers.js'

// 兼容性别名（映射到 helpers.js 函数）
export { 
    icqqGroup as GroupAdapter,
    icqqFriend as UserAdapter,
    filterMembers as MemberHelper,
    validateParams as ParamHelper
} from '../../mcp/tools/helpers.js'
