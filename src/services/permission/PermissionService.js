import config from '../../../config/config.js'

let yunzaiCfg = null
try {
    // 从 src/services/permission/ 到 Yunzai/lib/config/ 需要5层
    const cfgModule = await import('../../../../../lib/config/config.js')
    yunzaiCfg = cfgModule.default || cfgModule
} catch (e) {
    // Yunzai config not available, try alternative path
    try {
        // 如果路径不对，尝试通过全局 Bot 获取
        if (global.Bot?.config?.master) {
            yunzaiCfg = { masterQQ: global.Bot.config.master }
        }
    } catch {
        // ignore
    }
}

/**
 * 权限服务 - 检查用户是否有权限执行指定命令
 */
class PermissionService {
    constructor() {
        this.defaultCommands = this.getDefaultCommands()
    }

    /**
     * 获取默认指令权限配置
     */
    getDefaultCommands() {
        return [
            // 基础指令
            { id: 'chat', command: '@Bot / 触发词', name: '对话', category: 'basic', level: 'all', whitelist: [], blacklist: [], enabled: true },
            { id: 'endConversation', command: '#ai结束对话', name: '结束对话', category: 'basic', level: 'all', whitelist: [], blacklist: [], enabled: true },
            { id: 'setPersonality', command: '#ai设置人格', name: '设置人格', category: 'basic', level: 'all', whitelist: [], blacklist: [], enabled: true },
            { id: 'viewPersonality', command: '#ai查看人格', name: '查看人格', category: 'basic', level: 'all', whitelist: [], blacklist: [], enabled: true },
            { id: 'clearPersonality', command: '#ai清除人格', name: '清除人格', category: 'basic', level: 'all', whitelist: [], blacklist: [], enabled: true },
            { id: 'help', command: '#ai帮助', name: '帮助', category: 'basic', level: 'all', whitelist: [], blacklist: [], enabled: true },
            // 群管理指令
            { id: 'groupSettings', command: '#ai群设置', name: '群设置', category: 'group', level: 'admin', whitelist: [], blacklist: [], enabled: true },
            { id: 'groupBym', command: '#ai群伪人开启/关闭', name: '群伪人开关', category: 'group', level: 'admin', whitelist: [], blacklist: [], enabled: true },
            { id: 'groupBymProb', command: '#ai群伪人概率', name: '群伪人概率', category: 'group', level: 'admin', whitelist: [], blacklist: [], enabled: true },
            { id: 'groupBymModel', command: '#ai群伪人模型', name: '群伪人模型', category: 'group', level: 'admin', whitelist: [], blacklist: [], enabled: true },
            { id: 'groupBymPreset', command: '#ai群伪人预设', name: '群伪人预设', category: 'group', level: 'admin', whitelist: [], blacklist: [], enabled: true },
            { id: 'groupImageGen', command: '#ai群绘图开启/关闭', name: '群绘图开关', category: 'group', level: 'admin', whitelist: [], blacklist: [], enabled: true },
            { id: 'setGroupPersonality', command: '#ai设置群人格', name: '设置群人格', category: 'group', level: 'admin', whitelist: [], blacklist: [], enabled: true },
            { id: 'clearGroupPersonality', command: '#ai清除群人格', name: '清除群人格', category: 'group', level: 'admin', whitelist: [], blacklist: [], enabled: true },
            // 主人指令
            { id: 'adminPanel', command: '#ai管理面板', name: '管理面板', category: 'master', level: 'master', whitelist: [], blacklist: [], enabled: true },
            { id: 'status', command: '#ai状态', name: '状态', category: 'master', level: 'master', whitelist: [], blacklist: [], enabled: true },
            { id: 'toggleDebug', command: '#ai调试开启/关闭', name: '调试开关', category: 'master', level: 'master', whitelist: [], blacklist: [], enabled: true },
            { id: 'toggleBym', command: '#ai伪人开启/关闭', name: '伪人开关(全局)', category: 'master', level: 'master', whitelist: [], blacklist: [], enabled: true },
            { id: 'setModel', command: '#ai设置模型', name: '设置模型', category: 'master', level: 'master', whitelist: [], blacklist: [], enabled: true },
            { id: 'endAllConversations', command: '#ai结束全部对话', name: '结束全部对话', category: 'master', level: 'master', whitelist: [], blacklist: [], enabled: true },
        ]
    }

    /**
     * 获取权限配置
     */
    getPermissionsConfig() {
        const permissions = config.get('permissions')
        if (permissions?.commands?.length > 0) {
            return permissions
        }
        return {
            commands: this.defaultCommands,
            globalWhitelist: [],
            globalBlacklist: []
        }
    }

    /**
     * 获取指令配置
     */
    getCommandConfig(commandId) {
        const permissions = this.getPermissionsConfig()
        return permissions.commands?.find(c => c.id === commandId)
    }

    /**
     * 获取主人列表（使用框架配置）
     */
    getMasterList() {
        // 优先使用 Yunzai 框架配置
        if (yunzaiCfg?.masterQQ?.length > 0) {
            return yunzaiCfg.masterQQ.map(String)
        }
        // 其次使用 global.Bot.config.master
        if (global.Bot?.config?.master?.length > 0) {
            return global.Bot.config.master.map(String)
        }
        // 尝试从 Bot.uin 列表获取每个 Bot 的主人
        if (global.Bot?.uin) {
            for (const uin of Object.keys(global.Bot.uin)) {
                const bot = global.Bot[uin]
                if (bot?.config?.master?.length > 0) {
                    return bot.config.master.map(String)
                }
            }
        }
        return []
    }

    /**
     * 检查是否是主人
     */
    isMaster(userId) {
        const masters = this.getMasterList()
        const result = masters.includes(String(userId))
        // 调试日志
        if (!result && masters.length === 0) {
            console.log('[PermissionService] 警告: 未找到主人配置，yunzaiCfg:', yunzaiCfg ? '已加载' : '未加载')
        }
        return result
    }

    /**
     * 检查用户是否有权限执行指定命令
     * @param {string} commandId - 命令ID
     * @param {string} userId - 用户ID
     * @param {object} options - 额外选项
     * @param {boolean} options.isGroup - 是否在群聊
     * @param {string} options.groupId - 群ID
     * @param {string} options.senderRole - 发送者角色 (owner/admin/member)
     * @param {boolean} options.isMaster - 框架判断的主人状态
     * @returns {{allowed: boolean, reason: string}}
     */
    check(commandId, userId, options = {}) {
        const { isGroup = false, senderRole = 'member', isMaster: frameworkMaster } = options
        const userIdStr = String(userId)
        
        const permissions = this.getPermissionsConfig()
        const command = permissions.commands?.find(c => c.id === commandId)
        
        // 主人无视所有限制（优先使用框架判断结果）
        if (frameworkMaster || this.isMaster(userId)) {
            return { allowed: true, reason: 'master' }
        }

        // 指令不存在或已禁用（level === 'disabled'）
        if (!command || command.level === 'disabled') {
            return { allowed: false, reason: 'command_disabled' }
        }

        // 检查全局黑名单
        if (permissions.globalBlacklist?.includes(userIdStr)) {
            return { allowed: false, reason: 'global_blacklist' }
        }

        // 检查指令黑名单
        if (command.blacklist?.includes(userIdStr)) {
            return { allowed: false, reason: 'command_blacklist' }
        }

        // 检查群组独立黑白名单（如果提供了groupId和groupSettings）
        if (options.groupId && options.groupSettings) {
            const gs = options.groupSettings
            const listMode = gs.listMode || 'none'
            const blacklist = gs.blacklist || []
            const whitelist = gs.whitelist || []
            
            // 黑名单模式：在黑名单中的用户被禁止
            if (listMode === 'blacklist' && blacklist.includes(userIdStr)) {
                return { allowed: false, reason: 'group_blacklist' }
            }
            
            // 白名单模式：只有白名单中的用户允许
            if (listMode === 'whitelist') {
                if (!whitelist.includes(userIdStr)) {
                    return { allowed: false, reason: 'group_whitelist_only' }
                }
            }
        }

        // 检查全局白名单（无视权限限制，除主人功能外）
        if (permissions.globalWhitelist?.includes(userIdStr) && command.level !== 'master') {
            return { allowed: true, reason: 'global_whitelist' }
        }

        // 根据权限级别检查
        switch (command.level) {
            case 'all':
                return { allowed: true, reason: 'level_all' }
            
            case 'whitelist':
                if (command.whitelist?.includes(userIdStr)) {
                    return { allowed: true, reason: 'in_whitelist' }
                }
                return { allowed: false, reason: 'not_in_whitelist' }
            
            case 'admin':
                // 群聊中检查是否是管理员
                if (isGroup) {
                    if (senderRole === 'owner' || senderRole === 'admin') {
                        return { allowed: true, reason: 'is_admin' }
                    }
                    return { allowed: false, reason: 'need_admin' }
                }
                // 私聊中不允许
                return { allowed: false, reason: 'group_only' }
            
            case 'master':
                // 只有主人可用，前面已经检查过了
                return { allowed: false, reason: 'need_master' }
            
            case 'disabled':
                return { allowed: false, reason: 'command_disabled' }
            
            default:
                return { allowed: false, reason: 'unknown_level' }
        }
    }

    /**
     * 检查权限并返回拒绝消息
     * @returns {string|null} 拒绝消息，null 表示允许
     */
    checkWithMessage(commandId, userId, options = {}) {
        const result = this.check(commandId, userId, options)
        
        if (result.allowed) {
            return null
        }

        // 根据原因返回对应消息
        const messages = {
            'command_disabled': '此命令已被禁用',
            'global_blacklist': '您已被加入黑名单，无法使用此功能',
            'command_blacklist': '您已被禁止使用此命令',
            'group_blacklist': '您已被加入本群黑名单，无法使用AI功能',
            'group_whitelist_only': '本群已启用白名单模式，您不在白名单中',
            'not_in_whitelist': '此命令仅限白名单用户使用',
            'need_admin': '此命令需要群管理员或群主权限',
            'need_master': '此命令仅限主人使用',
            'group_only': '此命令仅可在群聊中使用',
            'unknown_level': '权限配置错误'
        }

        return messages[result.reason] || '您没有权限执行此命令'
    }

    /**
     * 从事件对象检查权限
     * @param {string} commandId - 命令ID
     * @param {object} e - Yunzai 事件对象
     * @returns {{allowed: boolean, reason: string}}
     */
    checkFromEvent(commandId, e) {
        return this.check(commandId, String(e.user_id), {
            isGroup: e.isGroup,
            groupId: e.group_id ? String(e.group_id) : null,
            senderRole: e.sender?.role || 'member',
            isMaster: e.isMaster  // 使用框架的主人判断
        })
    }

    /**
     * 从事件对象检查权限并返回拒绝消息
     * @param {string} commandId - 命令ID
     * @param {object} e - Yunzai 事件对象
     * @returns {string|null} 拒绝消息，null 表示允许
     */
    checkFromEventWithMessage(commandId, e) {
        return this.checkWithMessage(commandId, String(e.user_id), {
            isGroup: e.isGroup,
            groupId: e.group_id ? String(e.group_id) : null,
            senderRole: e.sender?.role || 'member',
            isMaster: e.isMaster  // 使用框架的主人判断
        })
    }
}

export const permissionService = new PermissionService()
export default permissionService
