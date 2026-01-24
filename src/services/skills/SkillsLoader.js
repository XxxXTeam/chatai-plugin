/**
 * SkillsLoader - Skills 模块工具加载器
 *
 * 根据 skills.yaml 配置独立加载工具，统一处理:
 * - 内置工具 (builtin)
 * - 自定义 JS 工具 (custom)
 * - 外部 MCP 服务器工具 (mcp)
 */

import { chatLogger } from '../../core/utils/logger.js'
import { skillsConfig } from './SkillsConfig.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { builtinMcpServer } from '../../mcp/BuiltinMcpServer.js'

const logger = chatLogger

class SkillsLoader {
    constructor() {
        this.tools = new Map()
        this.categories = new Map()
        this.mcpServerTools = new Map()
        this.initialized = false
        this.pluginRoot = null
    }

    /**
     * 初始化加载器
     * @param {string} pluginRoot - 插件根目录
     */
    async init(pluginRoot) {
        if (this.initialized) return this

        this.pluginRoot = pluginRoot

        // 确保 skillsConfig 已初始化
        await skillsConfig.init(pluginRoot)

        // 确保 mcpManager 已初始化
        await mcpManager.init()

        // 加载工具
        await this.loadAll()

        this.initialized = true
        logger.info(`[SkillsLoader] 初始化完成: ${this.tools.size} 个工具, mode=${skillsConfig.getMode()}`)

        return this
    }

    /**
     * 加载所有工具
     */
    async loadAll() {
        this.tools.clear()
        this.categories.clear()
        this.mcpServerTools.clear()

        const mode = skillsConfig.getMode()

        // 根据模式加载工具
        if (mode === 'hybrid' || mode === 'skills-only') {
            // 加载内置工具
            if (skillsConfig.isBuiltinEnabled()) {
                await this._loadBuiltinTools()
            }

            // 加载自定义工具
            if (skillsConfig.isCustomEnabled()) {
                await this._loadCustomTools()
            }
        }

        if (mode === 'hybrid' || mode === 'mcp-only') {
            // 加载 MCP 工具
            if (skillsConfig.isMcpEnabled()) {
                await this._loadMcpTools()
            }
        }

        // 应用工具组过滤
        this._applyGroupFilters()

        logger.debug(
            `[SkillsLoader] 加载完成: builtin=${skillsConfig.isBuiltinEnabled()}, ` +
                `custom=${skillsConfig.isCustomEnabled()}, mcp=${skillsConfig.isMcpEnabled()}`
        )
    }

    /**
     * 加载内置工具
     */
    async _loadBuiltinTools() {
        try {
            const builtinTools = mcpManager.getTools({ applyConfig: true }).filter(t => t.isBuiltin)

            const enabledCategories = skillsConfig.getEnabledCategories()
            const disabledTools = skillsConfig.getDisabledTools()

            for (const tool of builtinTools) {
                // 检查工具是否被禁用
                if (disabledTools.includes(tool.name)) {
                    continue
                }

                // 检查类别过滤（空数组表示全部启用）
                if (enabledCategories.length > 0 && tool.category) {
                    if (!enabledCategories.includes(tool.category)) {
                        continue
                    }
                }

                this._addTool(tool, 'builtin')
            }

            logger.debug(`[SkillsLoader] 加载内置工具: ${builtinTools.length} 个`)
        } catch (error) {
            logger.error('[SkillsLoader] 加载内置工具失败:', error)
        }
    }

    /**
     * 加载自定义 JS 工具
     */
    async _loadCustomTools() {
        try {
            const customTools = mcpManager
                .getTools({ applyConfig: true })
                .filter(t => t.isJsTool || t.isCustom || t.serverName === 'custom-tools')

            const disabledTools = skillsConfig.getDisabledTools()

            for (const tool of customTools) {
                if (disabledTools.includes(tool.name)) {
                    continue
                }

                this._addTool(tool, 'custom')
            }

            logger.debug(`[SkillsLoader] 加载自定义工具: ${customTools.length} 个`)
        } catch (error) {
            logger.error('[SkillsLoader] 加载自定义工具失败:', error)
        }
    }

    /**
     * 加载 MCP 服务器工具
     */
    async _loadMcpTools() {
        try {
            const enabledServers = skillsConfig.getEnabledMcpServers()
            const disabledServers = skillsConfig.getDisabledMcpServers()
            const disabledTools = skillsConfig.getDisabledTools()

            const servers = mcpManager.getServers()

            for (const server of servers) {
                // 跳过内置和自定义工具服务器
                if (server.name === 'builtin' || server.name === 'custom-tools') {
                    continue
                }

                // 检查服务器状态
                if (server.status !== 'connected') {
                    continue
                }

                // 检查服务器过滤
                if (disabledServers.includes(server.name)) {
                    continue
                }
                if (enabledServers.length > 0 && !enabledServers.includes(server.name)) {
                    continue
                }

                // 获取服务器工具
                const serverInfo = mcpManager.getServer(server.name)
                if (serverInfo && serverInfo.tools) {
                    const serverTools = []

                    for (const tool of serverInfo.tools) {
                        if (disabledTools.includes(tool.name)) {
                            continue
                        }

                        const toolData = {
                            ...tool,
                            serverName: server.name,
                            isMcpTool: true
                        }
                        this._addTool(toolData, 'mcp')
                        serverTools.push(tool.name)
                    }

                    // 记录 MCP 服务器工具信息
                    this.mcpServerTools.set(server.name, {
                        name: server.name,
                        status: server.status,
                        type: server.type,
                        tools: serverTools,
                        toolCount: serverTools.length
                    })
                }
            }

            logger.debug(`[SkillsLoader] 加载 MCP 服务器: ${this.mcpServerTools.size} 个`)
        } catch (error) {
            logger.error('[SkillsLoader] 加载 MCP 工具失败:', error)
        }
    }

    /**
     * 添加工具到集合
     */
    _addTool(tool, source) {
        const category = tool.category || tool.serverName || 'general'

        this.tools.set(tool.name, {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema || { type: 'object', properties: {} },
            category,
            serverName: tool.serverName,
            source, // 'builtin' | 'custom' | 'mcp'
            isBuiltin: tool.isBuiltin || source === 'builtin',
            isJsTool: tool.isJsTool,
            isCustom: tool.isCustom || source === 'custom',
            isMcpTool: tool.isMcpTool || source === 'mcp'
        })

        // 更新类别索引
        if (!this.categories.has(category)) {
            this.categories.set(category, {
                key: category,
                tools: [],
                serverName: tool.serverName
            })
        }
        this.categories.get(category).tools.push(tool.name)
    }

    /**
     * 应用工具组过滤
     */
    _applyGroupFilters() {
        const groups = skillsConfig.getGroups()

        // 如果没有配置工具组，不做过滤
        if (!groups || groups.length === 0) {
            return
        }

        // 工具组配置存在，但不强制过滤工具
        // 工具组主要用于智能调度，不影响工具的可用性
    }

    /**
     * 重新加载所有工具
     */
    async reload() {
        await skillsConfig.reload()
        await mcpManager.refreshBuiltinTools()
        await this.loadAll()
        logger.info(`[SkillsLoader] 重新加载完成: ${this.tools.size} 个工具`)
    }

    // ========== 工具获取方法 ==========

    /**
     * 获取所有工具
     */
    getTools() {
        return Array.from(this.tools.values())
    }

    /**
     * 获取工具 Map
     */
    getToolsMap() {
        return this.tools
    }

    /**
     * 根据名称获取工具
     */
    getTool(name) {
        return this.tools.get(name)
    }

    /**
     * 判断工具是否存在
     */
    hasTool(name) {
        return this.tools.has(name)
    }

    /**
     * 按来源分类获取工具
     */
    getToolsBySource() {
        const result = {
            builtin: [],
            custom: [],
            mcp: {}
        }

        for (const tool of this.tools.values()) {
            if (tool.source === 'builtin') {
                result.builtin.push(tool)
            } else if (tool.source === 'custom') {
                result.custom.push(tool)
            } else if (tool.source === 'mcp') {
                const serverName = tool.serverName || 'unknown'
                if (!result.mcp[serverName]) {
                    result.mcp[serverName] = []
                }
                result.mcp[serverName].push(tool)
            }
        }

        return result
    }

    /**
     * 按类别获取工具
     */
    getToolsByCategory(category) {
        const cat = this.categories.get(category)
        return cat ? cat.tools.map(name => this.tools.get(name)).filter(Boolean) : []
    }

    /**
     * 获取所有类别
     */
    getCategories() {
        return Array.from(this.categories.keys())
    }

    /**
     * 获取类别统计
     */
    getCategoryStats() {
        const stats = {}
        for (const [key, value] of this.categories) {
            stats[key] = value.tools.length
        }
        return stats
    }

    /**
     * 获取 MCP 服务器工具分组
     */
    getMcpServerTools() {
        return Object.fromEntries(this.mcpServerTools)
    }

    /**
     * 获取工具组的工具列表
     */
    getToolsByGroup(groupName) {
        const group = skillsConfig.getGroupByName(groupName)
        if (!group || !group.tools) return []

        return group.tools.map(name => this.tools.get(name)).filter(Boolean)
    }

    /**
     * 获取启用的工具组及其工具
     */
    getEnabledGroupsWithTools() {
        const groups = skillsConfig.getEnabledGroups()
        return groups.map(group => ({
            ...group,
            tools: (group.tools || []).map(name => this.tools.get(name)).filter(Boolean)
        }))
    }

    /**
     * 获取工具组摘要（用于调度）
     */
    getGroupSummary() {
        const groups = skillsConfig.getEnabledGroups()
        return groups.map(group => ({
            index: group.index,
            name: group.name,
            description: group.description,
            toolCount: (group.tools || []).filter(name => this.tools.has(name)).length,
            requiredPermission: group.requiredPermission
        }))
    }

    /**
     * 根据工具组索引获取工具
     */
    getToolsByGroupIndexes(indexes) {
        const tools = []
        const seen = new Set()

        for (const index of indexes) {
            const group = skillsConfig.getGroupByIndex(index)
            if (!group || !group.tools) continue

            for (const toolName of group.tools) {
                if (seen.has(toolName)) continue
                seen.add(toolName)

                const tool = this.tools.get(toolName)
                if (tool) {
                    tools.push(tool)
                }
            }
        }

        return tools
    }

    // ========== 安全检查方法 ==========

    /**
     * 检查工具是否为危险工具
     */
    isDangerousTool(toolName) {
        return skillsConfig.isDangerousTool(toolName)
    }

    /**
     * 检查是否允许执行危险工具
     */
    canExecuteDangerous(userPermission) {
        if (!skillsConfig.allowDangerous()) {
            return false
        }

        const requiredPermission = skillsConfig.getDangerousRequiredPermission()
        return this._hasPermission(userPermission, requiredPermission)
    }

    /**
     * 检查权限
     */
    _hasPermission(userPermission, requiredPermission) {
        const permissionLevels = {
            member: 0,
            admin: 1,
            owner: 2
        }

        const userLevel = permissionLevels[userPermission] || 0
        const requiredLevel = permissionLevels[requiredPermission] || 0

        return userLevel >= requiredLevel
    }

    /**
     * 检查工具组权限
     */
    checkGroupPermission(groupName, userPermission) {
        const group = skillsConfig.getGroupByName(groupName)
        if (!group) return true

        if (group.requiredPermission) {
            return this._hasPermission(userPermission, group.requiredPermission)
        }

        return true
    }

    // ========== 工具过滤方法 ==========

    /**
     * 根据权限过滤工具
     */
    filterByPermission(tools, userPermission) {
        return tools.filter(tool => {
            // 检查危险工具权限
            if (this.isDangerousTool(tool.name)) {
                return this.canExecuteDangerous(userPermission)
            }
            return true
        })
    }

    /**
     * 根据工具组过滤工具
     */
    filterByGroups(tools, groupIndexes) {
        if (!groupIndexes || groupIndexes.length === 0) {
            return tools
        }

        const allowedTools = new Set()
        for (const index of groupIndexes) {
            const group = skillsConfig.getGroupByIndex(index)
            if (group && group.tools) {
                group.tools.forEach(name => allowedTools.add(name))
            }
        }

        return tools.filter(tool => allowedTools.has(tool.name))
    }
}

// 单例实例
export const skillsLoader = new SkillsLoader()

export default SkillsLoader
