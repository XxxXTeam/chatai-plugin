/**
 * 工具过滤服务
 * 提供预设级别的工具禁用和调用防护
 *
 * 支持:
 * - 内置工具过滤
 * - 自定义JS工具过滤
 * - 外部MCP服务器工具过滤
 * - 按服务器名称过滤
 * - 权限控制
 */
import config from '../../../config/config.js'
import { presetManager } from '../preset/PresetManager.js'

/**
 * 工具过滤配置
 * @typedef {Object} ToolFilterConfig
 * @property {string[]} allowedTools - 允许的工具列表（白名单模式）
 * @property {string[]} disabledTools - 禁用的工具列表（黑名单模式）
 * @property {boolean} enableBuiltinTools - 是否启用内置工具
 * @property {boolean} enableMcpTools - 是否启用MCP工具
 * @property {string[]} allowedMcpServers - 允许的MCP服务器列表
 * @property {string[]} disabledMcpServers - 禁用的MCP服务器列表
 * @property {string[]} dangerousTools - 危险工具列表
 * @property {boolean} allowDangerous - 是否允许危险工具
 */

class ToolFilterService {
    constructor() {
        this.initialized = false
        // 危险工具列表（需要特殊权限）
        this.defaultDangerousTools = [
            'kick_member',
            'recall_message',
            'set_group_whole_ban',
            'delete_group_file',
            'execute_command',
            'send_group_notice'
        ]
        // 敏感工具列表（可能泄露信息）
        this.sensitiveTools = [
            'get_friend_list',
            'get_group_list',
            'get_group_member_list',
            'get_chat_history',
            'get_file_url'
        ]
    }

    async init() {
        if (this.initialized) return
        await presetManager.init()
        this.initialized = true
    }

    /**
     * 获取预设的工具配置
     * @param {string} presetId - 预设ID
     * @returns {ToolFilterConfig}
     */
    getPresetToolConfig(presetId) {
        const preset = presetManager.get(presetId)
        const globalConfig = config.get('builtinTools') || {}
        const mcpConfig = config.get('mcp') || {}

        // 合并全局配置和预设配置
        const presetTools = preset?.tools || {}

        return {
            enableBuiltinTools: presetTools.enableBuiltinTools ?? globalConfig.enabled ?? true,
            enableMcpTools: presetTools.enableMcpTools ?? mcpConfig.enabled ?? true,
            allowedTools: presetTools.allowedTools || globalConfig.allowedTools || [],
            disabledTools: presetTools.disabledTools || globalConfig.disabledTools || [],
            // MCP服务器过滤
            allowedMcpServers: presetTools.allowedMcpServers || mcpConfig.allowedServers || [],
            disabledMcpServers: presetTools.disabledMcpServers || mcpConfig.disabledServers || [],
            dangerousTools: globalConfig.dangerousTools || this.defaultDangerousTools,
            allowDangerous: globalConfig.allowDangerous ?? false
        }
    }

    /**
     * 过滤工具列表
     * @param {Array} tools - 原始工具列表
     * @param {string} presetId - 预设ID
     * @param {Object} options - 额外选项
     * @returns {Array} 过滤后的工具列表
     */
    filterTools(tools, presetId = 'default', options = {}) {
        if (!tools || tools.length === 0) return []

        const toolConfig = this.getPresetToolConfig(presetId)
        const { userPermission = 'member', groupId, userId } = options

        let filteredTools = [...tools]

        // 1. 检查是否启用内置工具
        if (!toolConfig.enableBuiltinTools) {
            filteredTools = filteredTools.filter(t => !t.isBuiltin)
        }

        // 2. 检查是否启用MCP工具
        if (!toolConfig.enableMcpTools) {
            filteredTools = filteredTools.filter(
                t => t.serverName === 'builtin' || t.serverName === 'custom-tools' || t.isBuiltin
            )
        }

        // 3. MCP服务器过滤
        if (toolConfig.allowedMcpServers && toolConfig.allowedMcpServers.length > 0) {
            filteredTools = filteredTools.filter(t => {
                // 内置工具和自定义工具不受此限制
                if (t.serverName === 'builtin' || t.serverName === 'custom-tools' || t.isBuiltin) {
                    return true
                }
                // 检查服务器是否在允许列表中
                return toolConfig.allowedMcpServers.includes(t.serverName)
            })
        }

        if (toolConfig.disabledMcpServers && toolConfig.disabledMcpServers.length > 0) {
            filteredTools = filteredTools.filter(t => {
                // 内置工具和自定义工具不受此限制
                if (t.serverName === 'builtin' || t.serverName === 'custom-tools' || t.isBuiltin) {
                    return true
                }
                // 检查服务器是否在禁用列表中
                return !toolConfig.disabledMcpServers.includes(t.serverName)
            })
        }

        // 4. 白名单模式
        if (toolConfig.allowedTools.length > 0) {
            filteredTools = filteredTools.filter(
                t => toolConfig.allowedTools.includes(t.name) || toolConfig.allowedTools.includes(t.function?.name)
            )
        }

        // 5. 黑名单模式：禁用指定的工具
        if (toolConfig.disabledTools.length > 0) {
            filteredTools = filteredTools.filter(t => {
                const name = t.name || t.function?.name
                return !toolConfig.disabledTools.includes(name)
            })
        }

        // 6. 危险工具过滤
        if (!toolConfig.allowDangerous) {
            filteredTools = filteredTools.filter(t => {
                const name = t.name || t.function?.name
                return !toolConfig.dangerousTools.includes(name)
            })
        }

        // 7. 权限过滤（非管理员不能使用管理工具）
        if (userPermission !== 'owner' && userPermission !== 'admin') {
            const adminOnlyTools = [
                'kick_member',
                'set_group_admin',
                'set_group_whole_ban',
                'set_group_name',
                'send_group_notice',
                'set_essence_message',
                'remove_essence_message'
            ]
            filteredTools = filteredTools.filter(t => {
                const name = t.name || t.function?.name
                return !adminOnlyTools.includes(name)
            })
        }

        return filteredTools
    }

    /**
     * 检查单个工具是否可用
     * @param {string} toolName - 工具名称
     * @param {string} presetId - 预设ID
     * @param {Object} options - 额外选项
     * @returns {{allowed: boolean, reason?: string}}
     */
    checkToolAccess(toolName, presetId = 'default', options = {}) {
        const toolConfig = this.getPresetToolConfig(presetId)
        const { userPermission = 'member' } = options

        // 检查黑名单
        if (toolConfig.disabledTools.includes(toolName)) {
            return { allowed: false, reason: `工具 "${toolName}" 已被禁用` }
        }

        // 检查白名单（如果启用）
        if (toolConfig.allowedTools.length > 0 && !toolConfig.allowedTools.includes(toolName)) {
            return { allowed: false, reason: `工具 "${toolName}" 不在允许列表中` }
        }

        // 检查危险工具
        if (!toolConfig.allowDangerous && toolConfig.dangerousTools.includes(toolName)) {
            return { allowed: false, reason: `工具 "${toolName}" 是危险工具，已被禁用` }
        }

        // 检查管理员权限
        const adminOnlyTools = [
            'kick_member',
            'set_group_admin',
            'set_group_whole_ban',
            'set_group_name',
            'send_group_notice'
        ]
        if (adminOnlyTools.includes(toolName) && userPermission !== 'owner' && userPermission !== 'admin') {
            return { allowed: false, reason: `工具 "${toolName}" 需要管理员权限` }
        }

        return { allowed: true }
    }

    /**
     * 验证工具调用参数
     * @param {string} toolName - 工具名称
     * @param {Object} args - 工具参数
     * @param {Object} context - 调用上下文
     * @returns {{valid: boolean, reason?: string}}
     */
    validateToolCall(toolName, args, context = {}) {
        const { groupId, userId } = context

        // 特殊工具参数验证
        switch (toolName) {
            case 'kick_member':
            case 'mute_member':
                // 不能对自己操作
                if (args.user_id && String(args.user_id) === String(userId)) {
                    return { valid: false, reason: '不能对自己执行此操作' }
                }
                break

            case 'send_private_message':
            case 'send_group_message':
                // 检查消息内容
                if (!args.message || (typeof args.message === 'string' && !args.message.trim())) {
                    return { valid: false, reason: '消息内容不能为空' }
                }
                break

            case 'execute_command':
                // 检查危险命令
                const cmd = (args.command || '').toLowerCase()
                const dangerousPatterns = [
                    /rm\s+(-[rf]+\s+)*[\/~]/,
                    /mkfs/,
                    /dd\s+if=/,
                    /:\(\)\s*\{/,
                    /shutdown/,
                    /reboot/,
                    /sudo\s/,
                    /su\s+-/
                ]
                for (const pattern of dangerousPatterns) {
                    if (pattern.test(cmd)) {
                        return { valid: false, reason: '检测到危险命令，已拒绝执行' }
                    }
                }
                break

            case 'mute_member':
                // 禁言时间限制
                const duration = parseInt(args.duration) || 0
                if (duration < 0 || duration > 2592000) {
                    // 30天
                    return { valid: false, reason: '禁言时间必须在0-30天之间' }
                }
                break
        }

        return { valid: true }
    }

    /**
     * 获取工具调用限制信息
     * @param {string} presetId - 预设ID
     * @returns {Object}
     */
    getToolCallLimits(presetId = 'default') {
        const preset = presetManager.get(presetId)
        const globalToolsConfig = config.get('tools') || {}

        return {
            maxConsecutiveCalls: preset?.tools?.maxConsecutiveCalls || 5,
            maxConsecutiveIdenticalCalls: preset?.tools?.maxConsecutiveIdenticalCalls || 2,
            maxTotalToolCalls: preset?.tools?.maxTotalToolCalls || 12,
            parallelExecution: globalToolsConfig.parallelExecution !== false,
            sendIntermediateReply: globalToolsConfig.sendIntermediateReply !== false
        }
    }

    /**
     * 获取敏感工具列表
     * @returns {string[]}
     */
    getSensitiveTools() {
        return [...this.sensitiveTools]
    }

    /**
     * 获取危险工具列表
     * @returns {string[]}
     */
    getDangerousTools() {
        const globalConfig = config.get('builtinTools') || {}
        return globalConfig.dangerousTools || this.defaultDangerousTools
    }
}

export const toolFilterService = new ToolFilterService()
