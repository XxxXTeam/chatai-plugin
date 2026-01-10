import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import { mcpManager } from '../../mcp/McpManager.js'
import { toolFilterService } from '../tools/ToolFilterService.js'
import { setBuiltinToolContext, getBuiltinToolContext } from '../../mcp/BuiltinMcpServer.js'

/**
 * SkillsAgent - 统一技能代理
 */
export class SkillsAgent {
    constructor(options = {}) {
        this.event = options.event || null
        this.bot = options.bot || options.event?.bot || global.Bot
        this.userId = options.userId || options.event?.user_id
        this.groupId = options.groupId || options.event?.group_id
        this.presetId = options.presetId || 'default'
        this.userPermission = options.userPermission || options.event?.sender?.role || 'member'
        
        this.skills = new Map()
        this.categories = new Map()
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
        
        this.initialized = true
        logger.debug(`[SkillsAgent] 初始化完成，${this.skills.size} 个技能`)
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
            const category = tool.category || tool.serverName || 'general'
            this.skills.set(tool.name, {
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema || { type: 'object', properties: {} },
                category,
                serverName: tool.serverName,
                isBuiltin: tool.isBuiltin,
                isJsTool: tool.isJsTool,
                isCustom: tool.isCustom
            })
            
            if (!this.categories.has(category)) {
                this.categories.set(category, { key: category, tools: [] })
            }
            this.categories.get(category).tools.push(tool.name)
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

    static setToolContext(ctx) { setBuiltinToolContext(ctx) }
    static getToolContext() { return getBuiltinToolContext() }
    static async refreshBuiltinTools() { return await mcpManager.refreshBuiltinTools() }
    static getBuiltinToolsList() { return mcpManager.getTools().filter(t => t.isBuiltin) }
    static isDangerousTool(toolName) { return toolFilterService.getDangerousTools().includes(toolName) }
    static async checkToolAvailable(toolName, presetId = 'default', options = {}) {
        await toolFilterService.init()
        return toolFilterService.checkToolAccess(toolName, presetId, options)
    }
    static getToolCallLimits(presetId = 'default') { return toolFilterService.getToolCallLimits(presetId) }

    // ========== 实例方法 ==========

    getSkillDefinitions() {
        return Array.from(this.skills.values()).map(s => ({
            type: 'function',
            function: { name: s.name, description: s.description, parameters: s.inputSchema }
        }))
    }

    getExecutableSkills() {
        return Array.from(this.skills.values()).map(s => ({
            function: { name: s.name, description: s.description, parameters: s.inputSchema },
            run: async (args) => {
                const result = await this.execute(s.name, args)
                return typeof result === 'string' ? result : JSON.stringify(result)
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
            userPermission: this.userPermission, groupId: this.groupId, userId: this.userId
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
            
            // 直接使用 McpManager 调用（不重复实现）
            const result = await mcpManager.callTool(skillName, filled, {
                useCache: true, cacheTTL: 60000
            })

            this.executionLog.push({
                skill: skillName, args: filled, result,
                duration: Date.now() - startTime, success: true, timestamp: Date.now()
            })
            return result
        } catch (error) {
            logger.error(`[SkillsAgent] 执行失败: ${skillName}`, error)
            this.executionLog.push({
                skill: skillName, args: filled, error: error.message,
                duration: Date.now() - startTime, success: false, timestamp: Date.now()
            })
            return { content: [{ type: 'text', text: `执行失败: ${error.message}` }], isError: true }
        }
    }

    async executeBatch(calls) { return Promise.all(calls.map(c => this.execute(c.name, c.args))) }
    hasSkill(name) { return this.skills.has(name) }
    getSkill(name) { return this.skills.get(name) || null }
    getSkillsByCategory(cat) {
        const c = this.categories.get(cat)
        return c ? c.tools.map(n => this.skills.get(n)).filter(Boolean) : []
    }
    getCategories() { return Array.from(this.categories.keys()) }
    getCategoryStats() {
        const s = {}
        for (const [k, v] of this.categories) s[k] = v.tools.length
        return s
    }
    getExecutionLog() { return this.executionLog }
    clearExecutionLog() { this.executionLog = [] }

    async refresh() {
        this.skills.clear()
        this.categories.clear()
        await mcpManager.refreshBuiltinTools()
        this._loadFromMcpManager()
        logger.info(`[SkillsAgent] 刷新完成，${this.skills.size} 个技能`)
    }
}

// ========== 兼容导出 ==========
export async function getAllTools(options = {}) { return await SkillsAgent.getAllTools(options) }
export async function executeTool(toolName, args, context, options = {}) { return await SkillsAgent.executeTool(toolName, args, context, options) }
export function setToolContext(ctx) { SkillsAgent.setToolContext(ctx) }
export function getToolContext() { return SkillsAgent.getToolContext() }
export async function refreshBuiltinTools() { return await SkillsAgent.refreshBuiltinTools() }
export function getBuiltinToolsList() { return SkillsAgent.getBuiltinToolsList() }
export function isDangerousTool(toolName) { return SkillsAgent.isDangerousTool(toolName) }
export async function checkToolAvailable(toolName, presetId = 'default', options = {}) { return await SkillsAgent.checkToolAvailable(toolName, presetId, options) }
export function getToolCallLimits(presetId = 'default') { return SkillsAgent.getToolCallLimits(presetId) }

export function convertMcpTools(mcpTools, requestContext = null) {
    return mcpTools.map(t => ({
        function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: 'object', properties: {} } },
        async run(args) {
            const result = await mcpManager.callTool(t.name, args, { useCache: true, cacheTTL: 60000, context: requestContext })
            if (result.content && Array.isArray(result.content)) {
                return result.content.map(b => b.type === 'text' ? b.text : JSON.stringify(b)).join('\n')
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
