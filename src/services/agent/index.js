/**
 * Agent 模块 - 统一代理系统
 */

export { ChatAgent, chatAgent, createChatAgent, quickChat } from './ChatAgent.js'
export {
    SkillsAgent,
    createSkillsAgent,
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
} from './SkillsAgent.js'
export {
    icqqGroup,
    icqqFriend,
    callOneBotApi,
    getGroupMemberList,
    filterMembers,
    randomSelectMembers,
    findMemberByName,
    formatMemberInfo,
    batchSendMessages,
    validateParams,
    paramError,
    checkParams,
    sendMessage,
    sendForwardMessage,
    parseRichContent,
    buildForwardNodes,
    detectProtocol,
    getBotInfo,
    normalizeSegment,
    normalizeSegments,
    getMasterList
} from '../../mcp/tools/helpers.js'
export {
    icqqGroup as GroupAdapter,
    icqqFriend as UserAdapter,
    filterMembers as MemberHelper,
    validateParams as ParamHelper
} from '../../mcp/tools/helpers.js'
