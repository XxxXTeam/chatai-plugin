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
import { getToolIdentity } from '../../core/adapters/tooling.js'
import { hasToolPermission, resolveToolPermission } from './ToolPermission.js'
import { skillsConfig } from '../skills/SkillsConfig.js'

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
            'mute_member',
            'recall_message',
            'mute_all',
            'set_group_admin',
            'set_group_card',
            'set_group_title',
            'set_group_name',
            'send_group_notice',
            'delete_group_notice',
            'write_file',
            'delete_file',
            'move_file',
            'copy_file',
            'create_directory',
            'execute_command',
            'set_group_whole_ban',
            'delete_group_file'
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

    getToolName(tool) {
        if (typeof tool === 'string') return tool
        return tool?.function?.name || tool?.name || ''
    }

    getToolIdentity(tool) {
        if (typeof tool === 'string') return tool
        return getToolIdentity(tool)
    }

    toolMatches(list, tool, fallbackName) {
        const values = this.toList(list)
        if (values.length === 0) return false
        const name = fallbackName || this.getToolName(tool)
        const identity = this.getToolIdentity(tool)
        return values.includes(name) || Boolean(identity && values.includes(identity))
    }

    toList(value) {
        return Array.isArray(value) ? value.filter(Boolean) : []
    }

    uniqueList(...lists) {
        return Array.from(new Set(lists.flatMap(list => this.toList(list))))
    }

    getToolSource(tool) {
        if (!tool) return 'unknown'
        if (tool.source === 'builtin' || tool.source === 'custom' || tool.source === 'mcp') return tool.source
        if (tool.isMcpTool === true) return 'mcp'
        if (tool.isJsTool === true || tool.isCustom === true || tool.serverName === 'custom-tools') return 'custom'
        if (tool.isBuiltin === true || tool.serverName === 'builtin') return 'builtin'
        if (tool.serverName) return 'mcp'
        return 'unknown'
    }

    isBuiltinTool(tool) {
        return this.getToolSource(tool) === 'builtin'
    }

    isCustomTool(tool) {
        return this.getToolSource(tool) === 'custom'
    }

    isMcpTool(tool) {
        return this.getToolSource(tool) === 'mcp'
    }

    getToolRequiredPermission(tool) {
        if (!tool || typeof tool !== 'object') return null
        if (tool.requireMaster === true || tool.function?.requireMaster === true) return 'master'
        const value =
            tool.requiredPermission ||
            tool.requirePermission ||
            tool.permissionRequired ||
            tool.function?.requiredPermission ||
            tool.function?.requirePermission ||
            tool.function?.permissionRequired
        return typeof value === 'string' && value.trim() ? value.trim() : null
    }

    getAdminOnlyTools() {
        return [
            'kick_member',
            'set_group_admin',
            'set_group_whole_ban',
            'set_group_name',
            'send_group_notice',
            'set_essence_message',
            'remove_essence_message'
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
        const globalAllowedTools = this.toList(globalConfig.allowedTools)
        const presetAllowedTools = this.toList(presetTools.allowedTools)
        const globalDisabledTools = this.toList(globalConfig.disabledTools)
        const presetDisabledTools = this.uniqueList(
            presetTools.disabledTools,
            presetTools.blockedTools,
            presetTools.excludedTools
        )
        const globalAllowedMcpServers = this.toList(mcpConfig.allowedServers)
        const presetAllowedMcpServers = this.toList(presetTools.allowedMcpServers)
        const globalDisabledMcpServers = this.toList(mcpConfig.disabledServers)
        const presetDisabledMcpServers = this.toList(presetTools.disabledMcpServers)

        return {
            enableBuiltinTools: presetTools.enableBuiltinTools ?? globalConfig.enabled ?? true,
            enableMcpTools: presetTools.enableMcpTools ?? mcpConfig.enabled ?? true,
            globalAllowedTools,
            presetAllowedTools,
            allowedTools:
                globalAllowedTools.length > 0 && presetAllowedTools.length > 0
                    ? globalAllowedTools.filter(name => presetAllowedTools.includes(name))
                    : presetAllowedTools.length > 0
                      ? presetAllowedTools
                      : globalAllowedTools,
            globalDisabledTools,
            presetDisabledTools,
            disabledTools: this.uniqueList(globalDisabledTools, presetDisabledTools),
            // MCP服务器过滤
            globalAllowedMcpServers,
            presetAllowedMcpServers,
            allowedMcpServers:
                globalAllowedMcpServers.length > 0 && presetAllowedMcpServers.length > 0
                    ? globalAllowedMcpServers.filter(name => presetAllowedMcpServers.includes(name))
                    : presetAllowedMcpServers.length > 0
                      ? presetAllowedMcpServers
                      : globalAllowedMcpServers,
            disabledMcpServers: this.uniqueList(globalDisabledMcpServers, presetDisabledMcpServers),
            dangerousTools: globalConfig.dangerousTools || this.defaultDangerousTools,
            allowDangerous: globalConfig.allowDangerous ?? false,
            dangerousRequiredPermission: skillsConfig.getDangerousRequiredPermission()
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
        const userPermission = resolveToolPermission(options)

        let filteredTools = [...tools]

        // 1. 检查是否启用内置工具
        if (!toolConfig.enableBuiltinTools) {
            filteredTools = filteredTools.filter(t => !this.isBuiltinTool(t))
        }

        // 2. 检查是否启用MCP工具
        if (!toolConfig.enableMcpTools) {
            filteredTools = filteredTools.filter(t => !this.isMcpTool(t))
        }

        // 3. MCP服务器过滤
        if (toolConfig.allowedMcpServers && toolConfig.allowedMcpServers.length > 0) {
            filteredTools = filteredTools.filter(t => {
                if (!this.isMcpTool(t)) return true
                return toolConfig.allowedMcpServers.includes(t.serverName)
            })
        }

        if (toolConfig.disabledMcpServers && toolConfig.disabledMcpServers.length > 0) {
            filteredTools = filteredTools.filter(t => {
                if (!this.isMcpTool(t)) return true
                return !toolConfig.disabledMcpServers.includes(t.serverName)
            })
        }

        // 4. 全局白名单模式。保持旧行为：自定义 JS 工具不受 builtinTools.allowedTools 限制。
        if (toolConfig.globalAllowedTools.length > 0) {
            filteredTools = filteredTools.filter(
                t => this.isCustomTool(t) || this.toolMatches(toolConfig.globalAllowedTools, t)
            )
        }

        // 5. 预设白名单模式
        if (toolConfig.presetAllowedTools.length > 0) {
            filteredTools = filteredTools.filter(t => this.toolMatches(toolConfig.presetAllowedTools, t))
        }

        // 6. 黑名单模式：禁用指定的工具
        if (toolConfig.disabledTools.length > 0) {
            filteredTools = filteredTools.filter(t => {
                return !this.toolMatches(toolConfig.disabledTools, t)
            })
        }

        // 7. 工具自身声明的权限过滤
        filteredTools = filteredTools.filter(t => {
            const requiredPermission = this.getToolRequiredPermission(t)
            return !requiredPermission || hasToolPermission(userPermission, requiredPermission)
        })

        // 8. 危险工具过滤
        if (!toolConfig.allowDangerous) {
            filteredTools = filteredTools.filter(t => {
                return !this.toolMatches(toolConfig.dangerousTools, t)
            })
        } else if (toolConfig.dangerousTools.length > 0) {
            filteredTools = filteredTools.filter(t => {
                return (
                    !this.toolMatches(toolConfig.dangerousTools, t) ||
                    hasToolPermission(userPermission, toolConfig.dangerousRequiredPermission)
                )
            })
        }

        // 9. 权限过滤（非管理员不能使用管理工具）
        if (!hasToolPermission(userPermission, 'admin')) {
            const adminOnlyTools = this.getAdminOnlyTools()
            filteredTools = filteredTools.filter(t => {
                return !this.toolMatches(adminOnlyTools, t)
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
        const userPermission = resolveToolPermission(options)
        const tool =
            options.tool ||
            options.availableTools?.find?.(
                t => this.getToolName(t) === toolName || this.getToolIdentity(t) === toolName
            ) ||
            null
        const name = toolName || this.getToolName(tool)
        const displayName = this.getToolName(tool) || name
        const isBuiltinTool = tool ? this.isBuiltinTool(tool) : false
        const isMcpTool = tool ? this.isMcpTool(tool) : false
        const isCustomTool = tool ? this.isCustomTool(tool) : false

        if (tool && !toolConfig.enableBuiltinTools && isBuiltinTool) {
            return { allowed: false, reason: `工具 "${name}" 所属内置工具来源已禁用` }
        }

        if (tool && !toolConfig.enableMcpTools && isMcpTool) {
            return { allowed: false, reason: `工具 "${name}" 所属MCP工具来源已禁用` }
        }

        if (tool && isMcpTool && toolConfig.allowedMcpServers?.length > 0) {
            if (!toolConfig.allowedMcpServers.includes(tool.serverName)) {
                return { allowed: false, reason: `工具 "${name}" 所属MCP服务器 "${tool.serverName}" 不在允许列表中` }
            }
        }

        if (tool && isMcpTool && toolConfig.disabledMcpServers?.length > 0) {
            if (toolConfig.disabledMcpServers.includes(tool.serverName)) {
                return { allowed: false, reason: `工具 "${name}" 所属MCP服务器 "${tool.serverName}" 已被禁用` }
            }
        }

        // 检查黑名单
        if (this.toolMatches(toolConfig.disabledTools, tool, name)) {
            return { allowed: false, reason: `工具 "${displayName}" 已被禁用` }
        }

        // 检查全局白名单（如果启用）。保持旧行为：自定义 JS 工具不受 builtinTools.allowedTools 限制。
        if (
            toolConfig.globalAllowedTools.length > 0 &&
            !isCustomTool &&
            !this.toolMatches(toolConfig.globalAllowedTools, tool, name)
        ) {
            return { allowed: false, reason: `工具 "${displayName}" 不在全局允许列表中` }
        }

        // 检查预设白名单（如果启用）
        if (toolConfig.presetAllowedTools.length > 0 && !this.toolMatches(toolConfig.presetAllowedTools, tool, name)) {
            return { allowed: false, reason: `工具 "${displayName}" 不在允许列表中` }
        }

        const requiredPermission = this.getToolRequiredPermission(tool)
        if (requiredPermission && !hasToolPermission(userPermission, requiredPermission)) {
            return { allowed: false, reason: `工具 "${displayName}" 需要 ${requiredPermission} 权限` }
        }

        // 检查危险工具
        if (this.toolMatches(toolConfig.dangerousTools, tool, name)) {
            if (!toolConfig.allowDangerous) {
                return { allowed: false, reason: `工具 "${displayName}" 是危险工具，已被禁用` }
            }
            if (!hasToolPermission(userPermission, toolConfig.dangerousRequiredPermission)) {
                return {
                    allowed: false,
                    reason: `工具 "${displayName}" 需要 ${toolConfig.dangerousRequiredPermission} 权限`
                }
            }
        }

        // 检查管理员权限
        const adminOnlyTools = this.getAdminOnlyTools()
        if (this.toolMatches(adminOnlyTools, tool, name) && !hasToolPermission(userPermission, 'admin')) {
            return { allowed: false, reason: `工具 "${displayName}" 需要管理员权限` }
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
        const { userId } = context

        // 特殊工具参数验证
        switch (toolName) {
            case 'kick_member':
                // 不能对自己操作
                if (args.user_id && String(args.user_id) === String(userId)) {
                    return { valid: false, reason: '不能对自己执行此操作' }
                }
                break

            case 'mute_member':
                // 不能对自己操作
                if (args.user_id && String(args.user_id) === String(userId)) {
                    return { valid: false, reason: '不能对自己执行此操作' }
                }
                // 禁言时间限制
                const duration = parseInt(args.duration) || 0
                if (duration < 0 || duration > 2592000) {
                    return { valid: false, reason: '禁言时间必须在0-30天之间' }
                }
                break

            case 'send_private_message':
            case 'send_group_message':
                // 检查消息内容
                if (!args.message || (typeof args.message === 'string' && !args.message.trim())) {
                    return { valid: false, reason: '消息内容不能为空' }
                }
                break

            case 'execute_command': {
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
            }
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
