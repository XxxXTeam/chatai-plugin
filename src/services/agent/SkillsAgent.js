import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import { mcpManager } from '../../mcp/McpManager.js'
import { toolFilterService } from '../tools/ToolFilterService.js'
import { setBuiltinToolContext, getBuiltinToolContext, builtinMcpServer } from '../../mcp/BuiltinMcpServer.js'

/**
 * SkillsAgent - 统一技能代理
 *
 * 提供统一的工具/技能管理接口，整合:
 * - 内置工具 (builtin)
 * - 自定义JS工具 (custom-tools)
 * - 外部MCP服务器工具 (npm包、stdio、sse、http)
 *
 * @example
 * ```js
 * const agent = await createSkillsAgent({ event, presetId: 'default' })
 * const result = await agent.execute('get_time', {})
 * ```
 */
export class SkillsAgent {
    constructor(options = {}) {
        this.event = options.event || null
        this.bot = options.bot || options.event?.bot || global.Bot
        this.userId = options.userId || options.event?.user_id
        this.groupId = options.groupId || options.event?.group_id
        this.presetId = options.presetId || 'default'
        this.userPermission = options.userPermission || options.event?.sender?.role || 'member'

        /** @type {string[]} 指定要加载的MCP服务器名称，为空则加载全部 */
        this.mcpServers = options.mcpServers || []
        /** @type {boolean} 是否包含外部MCP服务器工具 */
        this.includeMcpTools = options.includeMcpTools !== false
        /** @type {boolean} 是否包含内置工具 */
        this.includeBuiltinTools = options.includeBuiltinTools !== false

        this.skills = new Map()
        this.categories = new Map()
        this.mcpServerTools = new Map() // 按MCP服务器分组的工具
        this.executionLog = []
        this.initialized = false
    }

    async init() {
        if (this.initialized) return this
        await mcpManager.init()
        await toolFilterService.init()
        if (this.event) {
            setBuiltinToolContext({ event: this.event, bot: this.bot })
        }
        this._loadFromMcpManager()
        this._loadMcpServerTools()

        this.initialized = true
        const mcpCount = this.mcpServerTools.size
        logger.debug(`[SkillsAgent] 初始化完成，${this.skills.size} 个技能，${mcpCount} 个MCP服务器`)
        return this
    }

    _loadFromMcpManager() {
        const allTools = mcpManager.getTools({ applyConfig: true })
        const filterOptions = {
            userPermission: this.userPermission,
            groupId: this.groupId,
            userId: this.userId
        }
        const filteredTools = toolFilterService.filterTools(allTools, this.presetId, filterOptions)

        for (const tool of filteredTools) {
            // 根据配置过滤工具来源
            if (!this.includeBuiltinTools && (tool.isBuiltin || tool.serverName === 'builtin')) {
                continue
            }
            if (
                !this.includeMcpTools &&
                tool.serverName &&
                tool.serverName !== 'builtin' &&
                tool.serverName !== 'custom-tools'
            ) {
                continue
            }
            // 如果指定了特定MCP服务器，只加载这些服务器的工具
            if (this.mcpServers.length > 0 && tool.serverName) {
                if (
                    !this.mcpServers.includes(tool.serverName) &&
                    tool.serverName !== 'builtin' &&
                    tool.serverName !== 'custom-tools'
                ) {
                    continue
                }
            }

            const category = tool.category || tool.serverName || 'general'
            this.skills.set(tool.name, {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema || { type: 'object', properties: {} },
                category,
                serverName: tool.serverName,
                isBuiltin: tool.isBuiltin,
                isJsTool: tool.isJsTool,
                isCustom: tool.isCustom,
                isMcpTool: tool.serverName && tool.serverName !== 'builtin' && tool.serverName !== 'custom-tools'
            })

            if (!this.categories.has(category)) {
                this.categories.set(category, { key: category, tools: [], serverName: tool.serverName })
            }
            this.categories.get(category).tools.push(tool.name)
        }
    }

    /**
     * 加载外部MCP服务器工具（按服务器分组）
     */
    _loadMcpServerTools() {
        const servers = mcpManager.getServers()
        for (const server of servers) {
            if (server.status !== 'connected') continue
            if (server.name === 'builtin' || server.name === 'custom-tools') continue

            // 如果指定了特定MCP服务器，只加载这些服务器
            if (this.mcpServers.length > 0 && !this.mcpServers.includes(server.name)) {
                continue
            }

            const serverInfo = mcpManager.getServer(server.name)
            if (serverInfo && serverInfo.tools) {
                this.mcpServerTools.set(server.name, {
                    name: server.name,
                    status: server.status,
                    type: server.type,
                    tools: serverInfo.tools.map(t => t.name),
                    toolCount: serverInfo.tools.length
                })
            }
        }
    }
    static async getAllTools(options = {}) {
        const agent = new SkillsAgent(options)
        await agent.init()
        return agent.getExecutableSkills()
    }

    static async executeTool(toolName, args, context, options = {}) {
        const agent = new SkillsAgent({ event: options.event, presetId: options.presetId })
        await agent.init()
        return await agent.execute(toolName, args)
    }

    static setToolContext(ctx) {
        setBuiltinToolContext(ctx)
    }
    static getToolContext() {
        return getBuiltinToolContext()
    }
    static async refreshBuiltinTools() {
        return await mcpManager.refreshBuiltinTools()
    }
    static getBuiltinToolsList() {
        return mcpManager.getTools().filter(t => t.isBuiltin)
    }
    static isDangerousTool(toolName) {
        return toolFilterService.getDangerousTools().includes(toolName)
    }
    static async checkToolAvailable(toolName, presetId = 'default', options = {}) {
        await toolFilterService.init()
        return toolFilterService.checkToolAccess(toolName, presetId, options)
    }
    static getToolCallLimits(presetId = 'default') {
        return toolFilterService.getToolCallLimits(presetId)
    }

    // ========== MCP服务器管理 ==========

    /**
     * 获取所有MCP服务器状态
     */
    static getMcpServers() {
        return mcpManager.getServers()
    }

    /**
     * 获取指定MCP服务器信息
     */
    static getMcpServer(name) {
        return mcpManager.getServer(name)
    }

    /**
     * 连接新的MCP服务器
     * @param {string} name - 服务器名称
     * @param {Object} config - 服务器配置
     */
    static async connectMcpServer(name, config) {
        return await mcpManager.addServer(name, config)
    }

    /**
     * 断开MCP服务器
     */
    static async disconnectMcpServer(name) {
        return await mcpManager.disconnectServer(name)
    }

    /**
     * 重新加载MCP服务器
     */
    static async reloadMcpServer(name) {
        return await mcpManager.reloadServer(name)
    }

    /**
     * 移除MCP服务器
     */
    static async removeMcpServer(name) {
        return await mcpManager.removeServer(name)
    }

    /**
     * 获取MCP服务器的工具列表
     */
    static getMcpServerTools(serverName) {
        const server = mcpManager.getServer(serverName)
        return server?.tools || []
    }

    /**
     * 完全重新初始化MCP模块
     */
    static async reinitMcp() {
        return await mcpManager.reinit()
    }

    /**
     * 获取工具类别信息（从BuiltinMcpServer）
     */
    static getToolCategories() {
        return builtinMcpServer.getToolCategories()
    }

    /**
     * 切换工具类别启用状态
     */
    static async toggleCategory(category, enabled) {
        return await mcpManager.toggleCategory(category, enabled)
    }

    /**
     * 切换单个工具启用状态
     */
    static async toggleTool(toolName, enabled) {
        return await mcpManager.toggleTool(toolName, enabled)
    }

    /**
     * 获取工具统计信息
     */
    static getToolStats() {
        return mcpManager.getToolStats()
    }

    /**
     * 热重载所有工具
     */
    static async reloadAllTools() {
        return await mcpManager.reloadAllTools()
    }

    /**
     * 一键启用所有工具
     */
    static async enableAllTools() {
        return await mcpManager.enableAllTools()
    }

    /**
     * 一键禁用所有工具
     */
    static async disableAllTools() {
        return await mcpManager.disableAllTools()
    }

    getSkillDefinitions() {
        return Array.from(this.skills.values()).map(s => ({
            type: 'function',
            function: { name: s.name, description: s.description, parameters: s.inputSchema }
        }))
    }

    getExecutableSkills() {
        return Array.from(this.skills.values()).map(s => ({
            function: { name: s.name, description: s.description, parameters: s.inputSchema },
            run: async args => {
                const startTime = Date.now()
                try {
                    const result = await this.execute(s.name, args)
                    const duration = Date.now() - startTime

                    // 如果结果已经是格式化的对象且包含 status，则直接返回
                    if (result && typeof result === 'object' && result.status) {
                        return JSON.stringify(result)
                    }

                    // 包装为标准格式
                    const isError = result?.isError === true
                    const formattedResult = {
                        status: isError ? 'error' : 'success',
                        tool: s.name,
                        content: isError ? result.content?.[0]?.text || '执行失败' : result,
                        metadata: { duration }
                    }
                    return JSON.stringify(formattedResult)
                } catch (error) {
                    return JSON.stringify({
                        status: 'error',
                        tool: s.name,
                        content: error.message,
                        metadata: { duration: Date.now() - startTime }
                    })
                }
            }
        }))
    }

    async execute(skillName, args = {}) {
        if (!this.initialized) await this.init()

        const skill = this.skills.get(skillName)
        if (!skill) {
            return { content: [{ type: 'text', text: `技能 ${skillName} 不存在` }], isError: true }
        }

        // 权限检查
        const accessCheck = toolFilterService.checkToolAccess(skillName, this.presetId, {
            userPermission: this.userPermission,
            groupId: this.groupId,
            userId: this.userId
        })
        if (!accessCheck.allowed) {
            return { content: [{ type: 'text', text: accessCheck.reason }], isError: true }
        }

        // 自动填充参数
        const filled = { ...args }
        const props = skill.inputSchema?.properties || {}
        if (props.group_id && !filled.group_id && this.groupId) filled.group_id = this.groupId
        if (props.user_id && !filled.user_id && this.userId) filled.user_id = this.userId

        const startTime = Date.now()
        try {
            logger.debug(`[SkillsAgent] 执行: ${skillName}`)
            const result = await mcpManager.callTool(skillName, filled, {
                useCache: true,
                cacheTTL: 60000
            })

            this.executionLog.push({
                skill: skillName,
                args: filled,
                result,
                duration: Date.now() - startTime,
                success: true,
                timestamp: Date.now()
            })
            return result
        } catch (error) {
            logger.error(`[SkillsAgent] 执行失败: ${skillName}`, error)
            this.executionLog.push({
                skill: skillName,
                args: filled,
                error: error.message,
                duration: Date.now() - startTime,
                success: false,
                timestamp: Date.now()
            })
            return { content: [{ type: 'text', text: `执行失败: ${error.message}` }], isError: true }
        }
    }

    async executeBatch(calls) {
        return Promise.all(calls.map(c => this.execute(c.name, c.args)))
    }
    hasSkill(name) {
        return this.skills.has(name)
    }
    getSkill(name) {
        return this.skills.get(name) || null
    }
    getSkillsByCategory(cat) {
        const c = this.categories.get(cat)
        return c ? c.tools.map(n => this.skills.get(n)).filter(Boolean) : []
    }
    getCategories() {
        return Array.from(this.categories.keys())
    }
    getCategoryStats() {
        const s = {}
        for (const [k, v] of this.categories) s[k] = v.tools.length
        return s
    }
    getExecutionLog() {
        return this.executionLog
    }
    clearExecutionLog() {
        this.executionLog = []
    }

    /**
     * 获取MCP服务器分组的工具
     */
    getMcpServerTools() {
        return Object.fromEntries(this.mcpServerTools)
    }

    /**
     * 获取指定MCP服务器的工具
     */
    getToolsByServer(serverName) {
        const serverInfo = this.mcpServerTools.get(serverName)
        if (!serverInfo) return []
        return serverInfo.tools.map(name => this.skills.get(name)).filter(Boolean)
    }

    /**
     * 获取工具的详细分类信息
     */
    getCategoryInfo() {
        const info = []
        for (const [key, cat] of this.categories) {
            info.push({
                key,
                name: cat.name || key,
                serverName: cat.serverName,
                toolCount: cat.tools.length,
                tools: cat.tools
                    .map(name => {
                        const skill = this.skills.get(name)
                        return skill ? { name: skill.name, description: skill.description } : null
                    })
                    .filter(Boolean)
            })
        }
        return info
    }

    /**
     * 按来源分类获取技能
     * @returns {{ builtin: Array, custom: Array, mcp: Object }}
     */
    getSkillsBySource() {
        const builtin = []
        const custom = []
        const mcp = {}

        for (const [name, skill] of this.skills) {
            if (skill.isBuiltin) {
                builtin.push(skill)
            } else if (skill.isJsTool || skill.isCustom) {
                custom.push(skill)
            } else if (skill.isMcpTool && skill.serverName) {
                if (!mcp[skill.serverName]) {
                    mcp[skill.serverName] = []
                }
                mcp[skill.serverName].push(skill)
            }
        }

        return { builtin, custom, mcp }
    }

    async refresh() {
        this.skills.clear()
        this.categories.clear()
        this.mcpServerTools.clear()
        await mcpManager.refreshBuiltinTools()
        this._loadFromMcpManager()
        this._loadMcpServerTools()
        logger.info(`[SkillsAgent] 刷新完成，${this.skills.size} 个技能`)
    }
}

export async function getAllTools(options = {}) {
    return await SkillsAgent.getAllTools(options)
}
export async function executeTool(toolName, args, context, options = {}) {
    return await SkillsAgent.executeTool(toolName, args, context, options)
}
export function setToolContext(ctx) {
    SkillsAgent.setToolContext(ctx)
}
export function getToolContext() {
    return SkillsAgent.getToolContext()
}
export async function refreshBuiltinTools() {
    return await SkillsAgent.refreshBuiltinTools()
}
export function getBuiltinToolsList() {
    return SkillsAgent.getBuiltinToolsList()
}
export function isDangerousTool(toolName) {
    return SkillsAgent.isDangerousTool(toolName)
}
export async function checkToolAvailable(toolName, presetId = 'default', options = {}) {
    return await SkillsAgent.checkToolAvailable(toolName, presetId, options)
}
export function getToolCallLimits(presetId = 'default') {
    return SkillsAgent.getToolCallLimits(presetId)
}

// ========== MCP服务器管理导出函数 ==========

export function getMcpServers() {
    return SkillsAgent.getMcpServers()
}

export function getMcpServer(name) {
    return SkillsAgent.getMcpServer(name)
}

export async function connectMcpServer(name, config) {
    return await SkillsAgent.connectMcpServer(name, config)
}

export async function disconnectMcpServer(name) {
    return await SkillsAgent.disconnectMcpServer(name)
}

export async function reloadMcpServer(name) {
    return await SkillsAgent.reloadMcpServer(name)
}

export async function removeMcpServer(name) {
    return await SkillsAgent.removeMcpServer(name)
}

export function getMcpServerTools(serverName) {
    return SkillsAgent.getMcpServerTools(serverName)
}

export async function reinitMcp() {
    return await SkillsAgent.reinitMcp()
}

export function getToolCategories() {
    return SkillsAgent.getToolCategories()
}

export async function toggleCategory(category, enabled) {
    return await SkillsAgent.toggleCategory(category, enabled)
}

export async function toggleTool(toolName, enabled) {
    return await SkillsAgent.toggleTool(toolName, enabled)
}

export function getToolStats() {
    return SkillsAgent.getToolStats()
}

export async function reloadAllTools() {
    return await SkillsAgent.reloadAllTools()
}

export async function enableAllTools() {
    return await SkillsAgent.enableAllTools()
}

export async function disableAllTools() {
    return await SkillsAgent.disableAllTools()
}

export function convertMcpTools(mcpTools, requestContext = null) {
    return mcpTools.map(t => ({
        function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema || { type: 'object', properties: {} }
        },
        async run(args) {
            const result = await mcpManager.callTool(t.name, args, {
                useCache: true,
                cacheTTL: 60000,
                context: requestContext
            })
            if (result.content && Array.isArray(result.content)) {
                return result.content.map(b => (b.type === 'text' ? b.text : JSON.stringify(b))).join('\n')
            }
            return typeof result.content === 'string' ? result.content : JSON.stringify(result)
        }
    }))
}

export async function createSkillsAgent(options = {}) {
    const agent = new SkillsAgent(options)
    await agent.init()
    return agent
}

export default SkillsAgent
