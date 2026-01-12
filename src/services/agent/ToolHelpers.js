/**
 * ToolHelpers - 工具辅助函数
 *
 * @deprecated 此文件已弃用，请直接使用 mcp/tools/helpers.js
 * 保留此文件仅为兼容性，所有功能已迁移到 mcp/tools/helpers.js
 */

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
    getBotInfo as BotAdapter,
    sendMessage as MessageHelper,
    filterMembers as MemberHelper,
    validateParams as ParamHelper
} from '../../mcp/tools/helpers.js'
import {
    icqqGroup,
    icqqFriend,
    getBotInfo,
    sendMessage,
    filterMembers,
    validateParams
} from '../../mcp/tools/helpers.js'

export default {
    BotAdapter: getBotInfo,
    GroupAdapter: icqqGroup,
    UserAdapter: icqqFriend,
    MessageHelper: sendMessage,
    MemberHelper: filterMembers,
    ParamHelper: validateParams
}
