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
import { skillDocumentLoader } from './SkillDocumentLoader.js'
import { getToolIdentity } from '../../core/adapters/tooling.js'
import { hasToolPermission, resolveToolPermission } from '../tools/ToolPermission.js'

const logger = chatLogger

class SkillsLoader {
    constructor() {
        this.tools = new Map()
        this.categories = new Map()
        this.mcpServerTools = new Map()
        this.initialized = false
        this.pluginRoot = null
        // 懒加载：暴露给模型的技能清单（仅名称+描述），key 为技能名
        this.exposedSkills = new Map()
        // 懒加载：已完整加载到会话上下文的技能，key 为技能名，value 为完整文档
        this.loadedSkills = new Map()
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
        await skillDocumentLoader.init(pluginRoot, skillsConfig)
        this._syncExposedSkills()
        this.autoLoadSkills()

        this.initialized = true
        logger.debug(`[SkillsLoader] 初始化完成: ${this.tools.size} 个工具, mode=${skillsConfig.getMode()}`)

        return this
    }

    /**
     * 将文档技能同步到 exposedSkills 列表
     * @private
     */
    _syncExposedSkills() {
        this.exposedSkills.clear()
        const documents = skillDocumentLoader.getDocuments()
        for (const doc of documents) {
            this.exposedSkills.set(doc.name, {
                name: doc.name,
                description: doc.description || '',
                autoActivate: doc.autoActivate !== false,
                priority: doc.priority || 0
            })
        }
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
            const builtinTools = mcpManager.getTools({ applyConfig: false }).filter(t => t.isBuiltin)

            const enabledCategories = skillsConfig.getEnabledCategories()
            const disabledTools = skillsConfig.getDisabledTools()

            for (const tool of builtinTools) {
                const identity = getToolIdentity({ ...tool, source: 'builtin' })
                // 检查工具是否被禁用
                if (disabledTools.includes(tool.name) || disabledTools.includes(identity)) {
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
                .getTools({ applyConfig: false })
                .filter(t => t.isJsTool || t.isCustom || t.serverName === 'custom-tools')

            const disabledTools = skillsConfig.getDisabledTools()

            for (const tool of customTools) {
                const identity = getToolIdentity({ ...tool, source: 'custom' })
                if (disabledTools.includes(tool.name) || disabledTools.includes(identity)) {
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
                        const toolData = {
                            ...tool,
                            serverName: server.name,
                            isMcpTool: true
                        }
                        const identity = getToolIdentity({ ...toolData, source: 'mcp' })
                        if (disabledTools.includes(tool.name) || disabledTools.includes(identity)) {
                            continue
                        }
                        this._addTool(toolData, 'mcp')
                        serverTools.push(identity || tool.name)
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
        const identity = getToolIdentity({ ...tool, source })
        const key = identity || tool.name

        this.tools.set(key, {
            name: tool.name,
            identity,
            description: tool.description,
            inputSchema: tool.inputSchema || { type: 'object', properties: {} },
            category,
            serverName: tool.serverName,
            source, // 'builtin' | 'custom' | 'mcp'
            isBuiltin: tool.isBuiltin || source === 'builtin',
            isJsTool: tool.isJsTool,
            isCustom: tool.isCustom || source === 'custom',
            isMcpTool: tool.isMcpTool || source === 'mcp',
            dangerous: tool.dangerous,
            requireMaster: tool.requireMaster,
            requiredPermission: tool.requiredPermission,
            requirePermission: tool.requirePermission,
            permissionRequired: tool.permissionRequired
        })

        // 更新类别索引
        if (!this.categories.has(category)) {
            this.categories.set(category, {
                key: category,
                tools: [],
                serverName: tool.serverName
            })
        }
        this.categories.get(category).tools.push(key)
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
        await skillDocumentLoader.load()
        this._syncExposedSkills()
        logger.debug(`[SkillsLoader] 重新加载完成: ${this.tools.size} 个工具`)
    }

    /**
     * 仅重新加载文档技能（SKILL.md 等），不触碰 MCP 与可执行工具
     *
     * 面板改写 SKILL.md 或导入技能包后走这条路径：比 reload() 轻得多，且会把
     * loadedSkills 里的快照一并刷新——那里存的是 { ...doc } 副本，不刷新的话
     * 已激活的技能仍会拿旧正文，改完看不出效果。
     * @returns {{documents: number, loaded: number}} 重载后的文档数与仍处于激活状态的技能数
     */
    async reloadDocuments() {
        await skillDocumentLoader.load()
        this._syncExposedSkills()

        for (const key of Array.from(this.loadedSkills.keys())) {
            const doc = skillDocumentLoader.getDocumentByName(key)
            if (!doc) {
                // 文件被删除或技能被改名，对应的激活状态已无所指
                this.loadedSkills.delete(key)
                continue
            }
            this.loadedSkills.set(key, { ...doc, loadedAt: this.loadedSkills.get(key)?.loadedAt || Date.now() })
        }

        const documents = skillDocumentLoader.getDocuments().length
        logger.debug(`[SkillsLoader] 文档技能重载完成: ${documents} 个`)
        return { documents, loaded: this.loadedSkills.size }
    }

    // ========== 工具获取方法 ==========

    /**
     * 获取所有工具
     */
    getTools(options = {}) {
        const { includeDuplicateNames = false } = options
        const tools = Array.from(this.tools.values())
        if (includeDuplicateNames) return tools

        const byName = new Map()
        for (const tool of tools) {
            if (!byName.has(tool.name)) byName.set(tool.name, tool)
        }
        return Array.from(byName.values())
    }

    /**
     * 获取工具 Map
     */
    getToolsMap() {
        return this.tools
    }

    /**
     * 获取 SKILL.md 文档技能
     */
    getSkillDocuments() {
        return skillDocumentLoader.getDocuments()
    }

    /**
     * 获取当前请求命中的 SKILL.md 文档技能
     */
    getMatchingSkillDocuments(options = {}) {
        const matched = skillDocumentLoader.getMatchingDocuments(options)
        const merged = new Map(matched.map(document => [document.name, document]))
        for (const document of this.loadedSkills.values()) {
            merged.set(document.name, { ...document })
        }
        return Array.from(merged.values())
    }

    /**
     * 获取可注入 system prompt 的 SKILL.md 指令
     */
    getSkillDocumentInstructions(options = {}) {
        const discovery = skillDocumentLoader.buildInstructions({
            ...options,
            disclosure: 'progressive'
        })

        const activeDocuments = this.getMatchingSkillDocuments(options)
        if (activeDocuments.length === 0) return discovery

        const active = skillDocumentLoader.buildInstructions({
            ...options,
            mode: 'explicit',
            selectedNames: activeDocuments.map(document => document.name),
            disclosure: 'full'
        })
        if (!active) return discovery
        return [discovery, '【已激活 Agent Skills 完整指令】', active].filter(Boolean).join('\n\n')
    }

    /**
     * 根据名称获取工具
     */
    getTool(name) {
        if (this.tools.has(name)) return this.tools.get(name)
        for (const tool of this.tools.values()) {
            if (tool.name === name || getToolIdentity(tool) === name) return tool
        }
        return undefined
    }

    /**
     * 判断工具是否存在
     */
    hasTool(name) {
        return Boolean(this.getTool(name))
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
        return cat ? cat.tools.map(name => this.getTool(name)).filter(Boolean) : []
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

        return group.tools.map(name => this.getTool(name)).filter(Boolean)
    }

    /**
     * 获取启用的工具组及其工具
     */
    getEnabledGroupsWithTools() {
        const groups = skillsConfig.getEnabledGroups()
        return groups.map(group => ({
            ...group,
            tools: (group.tools || []).map(name => this.getTool(name)).filter(Boolean)
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
            toolCount: (group.tools || []).filter(name => this.hasTool(name)).length,
            requiredPermission: group.requiredPermission
        }))
    }

    /**
     * 根据工具组索引获取工具
     */
    getToolsByGroupIndexes(indexes, options = {}) {
        const tools = []
        const seen = new Set()
        const userPermission = resolveToolPermission(options)

        for (const index of indexes) {
            const group = skillsConfig.getGroupByIndex(index)
            if (!group || !group.tools) continue
            if (group.requiredPermission && !hasToolPermission(userPermission, group.requiredPermission)) continue

            for (const toolName of group.tools) {
                if (seen.has(toolName)) continue
                seen.add(toolName)

                const tool = this.getTool(toolName)
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
        return hasToolPermission(userPermission, requiredPermission)
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

        return tools.filter(tool => allowedTools.has(tool.name) || allowedTools.has(getToolIdentity(tool)))
    }

    // ========== Skills 懒加载机制 ==========

    /**
     * 获取暴露给模型的技能列表（仅名称和描述）
     * @returns {Array<{name: string, description: string, autoActivate: boolean, priority: number}>}
     */
    getExposedSkillList() {
        const documents = skillDocumentLoader.getDocuments()
        return documents.map(doc => ({
            name: doc.name,
            description: doc.description || '',
            autoActivate: doc.autoActivate !== false,
            priority: doc.priority || 0,
            type: doc.type || 'markdown',
            triggers: doc.triggers || [],
            standardCompliant: doc.standardCompliant === true,
            compatibilityWarnings: doc.compatibilityWarnings || []
        }))
    }

    /**
     * 加载指定的 skill 到当前会话
     * @param {string} name - 技能名称
     * @returns {boolean} 是否成功加载
     */
    loadSkill(name) {
        if (!name) return false
        const key = String(name).trim()

        const doc = skillDocumentLoader.getDocumentByName(key)
        if (!doc) return false

        const existing = this.loadedSkills.get(key)
        this.loadedSkills.set(key, {
            ...doc,
            loadedAt: existing?.loadedAt || Date.now(),
            activationSource: 'manual'
        })
        logger.debug(`[SkillsLoader] 技能已显式加载: ${key}`)
        return true
    }

    /**
     * 卸载指定的 skill
     * @param {string} name - 技能名称
     * @returns {boolean} 是否成功卸载
     */
    unloadSkill(name) {
        if (!name) return false
        const key = String(name).trim()
        const deleted = this.loadedSkills.delete(key)
        if (deleted) {
            logger.debug(`[SkillsLoader] 技能已卸载: ${key}`)
        }
        return deleted
    }

    /**
     * 获取已加载的技能名称列表
     * @returns {string[]}
     */
    getLoadedSkillNames() {
        return Array.from(this.loadedSkills.keys())
    }

    /**
     * 获取已加载的技能完整信息
     * @returns {Array}
     */
    getLoadedSkillDocuments() {
        return Array.from(this.loadedSkills.values())
    }

    /**
     * 初始化时自动加载 autoActivate 的技能
     */
    autoLoadSkills() {
        // autoActivate 控制自动匹配资格，不再把所有技能永久写入 loadedSkills。
        // 显式 load_skill 才进入 loadedSkills；自动技能由当前消息确定匹配。
        const autoCount = skillDocumentLoader.getDocuments().filter(doc => doc.autoActivate !== false).length
        logger.debug(`[SkillsLoader] 可自动匹配技能: ${autoCount} 个，显式加载: ${this.loadedSkills.size} 个`)
    }
}

// 单例实例
export const skillsLoader = new SkillsLoader()

export default SkillsLoader
