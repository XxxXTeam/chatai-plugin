/**
 * @fileoverview 技能代理模块
 * @module services/agent/SkillsAgent
 * @description 统一的工具/技能管理接口，整合内置工具、自定义工具和MCP服务器
 */

import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import { mcpManager } from '../../mcp/McpManager.js'
import { toolFilterService } from '../tools/ToolFilterService.js'
import { setBuiltinToolContext, getBuiltinToolContext, builtinMcpServer } from '../../mcp/BuiltinMcpServer.js'
import { getToolIdentity } from '../../core/adapters/tooling.js'
import { resolveToolPermission } from '../tools/ToolPermission.js'
import { DEFAULT_CONFIG as SKILLS_DEFAULT_CONFIG } from '../skills/SkillsConfig.js'

/**
 * @class SkillsAgent
 * @classdesc 技能代理 - 统一管理和执行各类工具调用
 *
 * @description
 * 核心功能：
 * - **统一接口**: 整合内置工具、自定义JS工具、外部MCP服务器
 * - **权限控制**: 基于用户权限和预设配置过滤可用工具
 * - **上下文注入**: 自动注入事件上下文到工具执行环境
 * - **执行日志**: 记录工具调用历史，便于调试和审计
 * - **分类管理**: 按类别组织和管理工具
 *
 * @example
 * // 创建代理实例
 * const agent = await createSkillsAgent({ event, presetId: 'default' })
 *
 * // 获取可用工具列表
 * const tools = agent.getTools()
 *
 * // 执行工具调用
 * const result = await agent.execute('get_time', { timezone: 'Asia/Shanghai' })
 */
export class SkillsAgent {
    constructor(options = {}) {
        this.event = options.event || null
        this.bot = options.bot || options.event?.bot || global.Bot
        this.userId = options.userId || options.event?.user_id
        this.groupId = options.groupId || options.event?.group_id
        this.presetId = options.presetId || 'default'
        this.userPermission = resolveToolPermission(options)

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
        const loadedTools = global.chatAiSkillsLoader?.initialized
            ? global.chatAiSkillsLoader.getTools({ includeDuplicateNames: this.mcpServers.length > 0 })
            : mcpManager.getTools({
                  applyConfig: false,
                  includeDuplicateNames: this.mcpServers.length > 0
              })
        const allTools = Array.isArray(loadedTools) ? loadedTools : []
        const filterOptions = {
            userPermission: this.userPermission,
            event: this.event,
            groupId: this.groupId,
            userId: this.userId
        }
        const filteredTools = toolFilterService.filterTools(allTools, this.presetId, filterOptions)

        for (const tool of filteredTools) {
            const source = this._getSource(tool)
            // 根据配置过滤工具来源
            if (!this.includeBuiltinTools && source === 'builtin') {
                continue
            }
            if (!this.includeMcpTools && source === 'mcp') {
                continue
            }
            // 如果指定了特定MCP服务器，只加载这些服务器的工具
            if (this.mcpServers.length > 0 && source === 'mcp' && tool.serverName) {
                if (!this.mcpServers.includes(tool.serverName)) {
                    continue
                }
            }

            const category = tool.category || tool.serverName || 'general'
            const identity = getToolIdentity(tool)
            const key = identity || tool.name

            this.skills.set(key, {
                name: tool.name,
                identity,
                description: tool.description,
                inputSchema: tool.inputSchema || { type: 'object', properties: {} },
                category,
                serverName: tool.serverName,
                source,
                isBuiltin: source === 'builtin',
                isJsTool: tool.isJsTool,
                isCustom: source === 'custom',
                isMcpTool: source === 'mcp',
                dangerous: tool.dangerous,
                requireMaster: tool.requireMaster,
                requiredPermission: tool.requiredPermission,
                requirePermission: tool.requirePermission,
                permissionRequired: tool.permissionRequired
            })

            if (!this.categories.has(category)) {
                this.categories.set(category, { key: category, tools: [], serverName: tool.serverName })
            }
            this.categories.get(category).tools.push(key)
        }
    }

    /**
     * 加载外部MCP服务器工具（按服务器分组）
     */
    _loadMcpServerTools() {
        const servers = mcpManager.getServers()
        const allowedServerNames = new Set(
            Array.from(this.skills.values())
                .filter(skill => skill.isMcpTool && skill.serverName)
                .map(skill => skill.serverName)
        )
        for (const server of servers) {
            if (server.status !== 'connected') continue
            if (server.name === 'builtin' || server.name === 'custom-tools') continue
            if (!allowedServerNames.has(server.name)) continue

            // 如果指定了特定MCP服务器，只加载这些服务器
            if (this.mcpServers.length > 0 && !this.mcpServers.includes(server.name)) {
                continue
            }

            const serverInfo = mcpManager.getServer(server.name)
            if (serverInfo && serverInfo.tools) {
                const visibleTools = serverInfo.tools.filter(
                    t => this.getSkill(`mcp:${server.name}:${t.name}`) || this.getSkill(t.name)
                )
                this.mcpServerTools.set(server.name, {
                    name: server.name,
                    status: server.status,
                    type: server.type,
                    tools: visibleTools.map(t => `mcp:${server.name}:${t.name}`),
                    toolCount: visibleTools.length
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
        const agent = new SkillsAgent({
            event: options.event,
            presetId: options.presetId,
            userPermission: options.userPermission,
            groupId: options.groupId,
            userId: options.userId
        })
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
        const dangerousTools = toolFilterService.getDangerousTools()
        if (typeof toolName === 'object') {
            return dangerousTools.includes(toolName.name) || dangerousTools.includes(toolName.identity)
        }
        return dangerousTools.includes(toolName)
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

    getVisibleSkills(options = {}) {
        const { includeDuplicateNames = false } = options
        const skills = Array.from(this.skills.values())
        if (includeDuplicateNames) return skills

        const byName = new Map()
        for (const skill of skills) {
            if (!byName.has(skill.name)) byName.set(skill.name, skill)
        }
        return Array.from(byName.values())
    }

    getSkillDefinitions(options = {}) {
        return this.getVisibleSkills(options).map(s => ({
            type: 'function',
            name: s.name,
            identity: s.identity,
            serverName: s.serverName,
            source: s.source,
            isBuiltin: s.isBuiltin,
            isJsTool: s.isJsTool,
            isCustom: s.isCustom,
            isMcpTool: s.isMcpTool,
            dangerous: s.dangerous,
            requireMaster: s.requireMaster,
            requiredPermission: s.requiredPermission,
            requirePermission: s.requirePermission,
            permissionRequired: s.permissionRequired,
            function: { name: s.name, description: s.description, parameters: s.inputSchema }
        }))
    }

    getExecutableSkills(options = {}) {
        return this.getVisibleSkills(options).map(s => ({
            name: s.name,
            type: 'function',
            identity: s.identity,
            serverName: s.serverName,
            source: s.source,
            isBuiltin: s.isBuiltin,
            isJsTool: s.isJsTool,
            isCustom: s.isCustom,
            isMcpTool: s.isMcpTool,
            dangerous: s.dangerous,
            requireMaster: s.requireMaster,
            requiredPermission: s.requiredPermission,
            requirePermission: s.requirePermission,
            permissionRequired: s.permissionRequired,
            function: { name: s.name, description: s.description, parameters: s.inputSchema },
            run: async args => {
                const startTime = Date.now()
                try {
                    const result = await this.execute(s.identity || s.name, args)
                    const duration = Date.now() - startTime

                    // 提取实际内容
                    let content
                    const isError = result?.isError === true

                    if (result && typeof result === 'object') {
                        // 如果已经是格式化的对象且包含 status，提取 content
                        if (result.status) {
                            content = result.content
                        }
                        // MCP 格式：{ content: [{type: 'text', text: '...'}] }
                        else if (Array.isArray(result.content)) {
                            content = result.content
                                .map(item => (item.type === 'text' ? item.text : JSON.stringify(item)))
                                .join('\n')
                        }
                        // 其他对象格式
                        else {
                            content = JSON.stringify(result)
                        }
                    } else {
                        content = result
                    }

                    // 包装为标准格式
                    const formattedResult = {
                        status: isError ? 'error' : 'success',
                        tool: s.name,
                        content: content,
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

    // ========== 执行 (Execution) ==========

    /**
     * 获取执行配置（从 skills.yaml）
     *
     * Skills 模块未初始化时回退到 SkillsConfig 的 DEFAULT_CONFIG，
     * 避免在此处重复维护一份易漂移的默认值
     * @returns {{ timeout: number, maxParallel: number, retryOnError: boolean, maxRetries: number, cacheResults: boolean, cacheTTL: number }}
     */
    _getExecutionConfig() {
        try {
            const cfg = global.chatAiSkillsConfig
            if (cfg?.getExecutionConfig) {
                return cfg.getExecutionConfig()
            }
        } catch {}
        return { ...SKILLS_DEFAULT_CONFIG.skills.execution }
    }

    /**
     * 带超时的 Promise 包装
     */
    _withTimeout(promise, ms, skillName) {
        if (!ms || ms <= 0) return promise
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`技能 ${skillName} 执行超时 (${ms}ms)`)), ms)
            promise.then(
                val => {
                    clearTimeout(timer)
                    resolve(val)
                },
                err => {
                    clearTimeout(timer)
                    reject(err)
                }
            )
        })
    }

    async execute(skillName, args = {}) {
        if (!this.initialized) await this.init()

        const skill = this.getSkill(skillName)
        if (!skill) {
            return { content: [{ type: 'text', text: `技能 ${skillName} 不存在` }], isError: true }
        }

        // 权限检查
        const accessCheck = toolFilterService.checkToolAccess(skill.name, this.presetId, {
            userPermission: this.userPermission,
            groupId: this.groupId,
            userId: this.userId,
            tool: skill
        })
        if (!accessCheck.allowed) {
            return { content: [{ type: 'text', text: accessCheck.reason }], isError: true }
        }

        // 自动填充参数
        const filled = { ...args }
        const props = skill.inputSchema?.properties || {}
        if (props.group_id && !filled.group_id && this.groupId) filled.group_id = this.groupId
        if (props.user_id && !filled.user_id && this.userId) filled.user_id = this.userId

        // 从 skills.yaml 读取执行配置
        const execConfig = this._getExecutionConfig()
        const { timeout, retryOnError, maxRetries, cacheResults, cacheTTL } = execConfig

        const startTime = Date.now()
        let lastError = null

        // 带重试的执行循环
        const attempts = retryOnError ? maxRetries + 1 : 1
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                if (attempt > 1) {
                    logger.debug(`[SkillsAgent] 重试 ${skillName} (第${attempt}次, 共${attempts}次)`)
                } else {
                    logger.debug(`[SkillsAgent] 执行: ${skillName}`)
                }

                // 带超时包装
                const callPromise = mcpManager.callTool(skill.name, filled, {
                    useCache: cacheResults,
                    cacheTTL: cacheTTL,
                    serverName: skill.serverName
                })
                const result = await this._withTimeout(callPromise, timeout, skillName)

                this.executionLog.push({
                    skill: skillName,
                    args: filled,
                    result,
                    duration: Date.now() - startTime,
                    success: true,
                    attempts: attempt,
                    timestamp: Date.now()
                })
                return result
            } catch (error) {
                lastError = error
                logger.error(`[SkillsAgent] 执行失败 (第${attempt}次): ${skillName}`, error.message)

                // 最后一次失败，不再重试
                if (attempt >= attempts) break

                // 重试前短暂等待（指数退避）
                await new Promise(r => setTimeout(r, Math.min(1000 * attempt, 3000)))
            }
        }

        // 所有尝试都失败
        this.executionLog.push({
            skill: skillName,
            args: filled,
            error: lastError?.message,
            duration: Date.now() - startTime,
            success: false,
            attempts,
            timestamp: Date.now()
        })
        return { content: [{ type: 'text', text: `执行失败: ${lastError?.message}` }], isError: true }
    }

    /**
     * 批量执行技能，受 maxParallel 限制
     * @param {Array<{name: string, args: Object}>} calls - 调用列表
     * @returns {Promise<Array>} 结果数组
     */
    async executeBatch(calls) {
        if (!calls || calls.length === 0) return []

        const execConfig = this._getExecutionConfig()
        const maxParallel = execConfig.maxParallel || 5

        // 分批并行执行
        const results = []
        for (let i = 0; i < calls.length; i += maxParallel) {
            const batch = calls.slice(i, i + maxParallel)
            const batchResults = await Promise.all(batch.map(c => this.execute(c.name, c.args)))
            results.push(...batchResults)
        }
        return results
    }

    // ========== 发现 (Discovery) ==========

    hasSkill(name) {
        return Boolean(this.getSkill(name))
    }

    getSkill(name) {
        if (this.skills.has(name)) return this.skills.get(name)
        for (const skill of this.getVisibleSkills()) {
            if (skill.name === name) return skill
        }
        return null
    }

    /**
     * 获取技能的详细信息（含参数定义和示例）
     * @param {string} name - 技能名称
     * @returns {Object|null} 技能详情
     */
    getSkillDetail(name) {
        const skill = this.getSkill(name)
        if (!skill) return null

        const params = skill.inputSchema?.properties || {}
        const required = skill.inputSchema?.required || []

        return {
            name: skill.name,
            description: skill.description,
            category: skill.category,
            source: skill.isBuiltin ? 'builtin' : skill.isCustom || skill.isJsTool ? 'custom' : 'mcp',
            serverName: skill.serverName,
            parameters: Object.entries(params).map(([key, schema]) => ({
                name: key,
                type: schema.type || 'string',
                description: schema.description || '',
                required: required.includes(key),
                default: schema.default,
                enum: schema.enum
            })),
            isDangerous:
                toolFilterService.getDangerousTools().includes(skill.name) ||
                toolFilterService.getDangerousTools().includes(skill.identity)
        }
    }

    /**
     * 模糊搜索技能（按名称和描述匹配）
     * @param {string} query - 搜索关键词
     * @param {Object} options - 搜索选项
     * @param {number} options.limit - 最大结果数（默认20）
     * @param {string} options.category - 限定类别
     * @param {string} options.source - 限定来源 'builtin'|'custom'|'mcp'
     * @returns {Array} 匹配的技能列表（按相关度排序）
     */
    searchSkills(query, options = {}) {
        const { limit = 20, category, source } = options
        const q = (query || '').toLowerCase()

        if (!q) {
            // 无关键词时返回全部（分页）
            let all = Array.from(this.skills.values())
            if (category) all = all.filter(s => s.category === category)
            if (source) all = all.filter(s => this._matchSource(s, source))
            return all.slice(0, limit).map(s => ({
                name: s.name,
                identity: s.identity,
                description: s.description,
                category: s.category,
                source: this._getSource(s)
            }))
        }

        const scored = []
        for (const [key, skill] of this.skills) {
            if (category && skill.category !== category) continue
            if (source && !this._matchSource(skill, source)) continue

            let score = 0
            const lName = skill.name.toLowerCase()
            const lKey = key.toLowerCase()
            const lDesc = (skill.description || '').toLowerCase()

            // 精确名称匹配
            if (lName === q || lKey === q) score += 100
            // 名称前缀匹配
            else if (lName.startsWith(q) || lKey.startsWith(q)) score += 80
            // 名称包含匹配
            else if (lName.includes(q) || lKey.includes(q)) score += 60
            // 描述包含匹配
            if (lDesc.includes(q)) score += 40
            // 拆分关键词匹配
            const words = q.split(/[\s_-]+/)
            for (const w of words) {
                if (w && (lName.includes(w) || lKey.includes(w))) score += 20
                if (w && lDesc.includes(w)) score += 10
            }

            if (score > 0) {
                scored.push({
                    name: skill.name,
                    identity: skill.identity,
                    description: skill.description,
                    category: skill.category,
                    source: this._getSource(skill),
                    score
                })
            }
        }

        return scored.sort((a, b) => b.score - a.score).slice(0, limit)
    }

    /**
     * 根据上下文推荐技能（基于关键词和类别启发）
     * @param {string} context - 用户消息或上下文描述
     * @param {Object} options - 选项
     * @param {number} options.limit - 最大推荐数（默认5）
     * @returns {Array} 推荐的技能列表
     */
    getRecommendations(context, options = {}) {
        const { limit = 5 } = options
        if (!context || typeof context !== 'string') return []

        const msg = context.toLowerCase()

        // 关键词到类别的映射表
        const hintMap = [
            { keywords: ['时间', '几点', '日期', '星期', '今天', 'time', 'date'], categories: ['basic', 'time'] },
            { keywords: ['天气', '温度', '下雨', 'weather'], categories: ['search', 'extra', 'web'] },
            { keywords: ['群', '成员', '管理', '禁言', '踢'], categories: ['group', 'group-stats', 'admin'] },
            { keywords: ['发消息', '私聊', '艾特', '@', '转发'], categories: ['message'] },
            { keywords: ['搜索', '查找', '百科', '翻译'], categories: ['search', 'web'] },
            {
                keywords: ['图片', '视频', '语音', '音乐', '表情'],
                categories: ['media', 'voice', 'bltools-emoji', 'bltools-image']
            },
            { keywords: ['文件', '上传', '下载', '读取'], categories: ['file'] },
            { keywords: ['记忆', '记住', '忘记'], categories: ['memory'] },
            { keywords: ['定时', '提醒', '闹钟'], categories: ['schedule', 'reminder'] },
            { keywords: ['用户', '好友', '头像', '资料'], categories: ['user', 'bot'] },
            { keywords: ['计算', '随机', '编码', '哈希'], categories: ['utils'] },
            { keywords: ['b站', 'bilibili', '视频'], categories: ['bltools-bilibili', 'bltools-video'] },
            { keywords: ['github', '仓库'], categories: ['bltools-github'] },
            { keywords: ['思维导图', 'mindmap'], categories: ['bltools-mindmap'] },
            { keywords: ['音乐', 'qq音乐'], categories: ['bltools-music'] }
        ]

        // 匹配相关类别
        const matchedCategories = new Set()
        for (const hint of hintMap) {
            for (const kw of hint.keywords) {
                if (msg.includes(kw)) {
                    hint.categories.forEach(c => matchedCategories.add(c))
                }
            }
        }

        if (matchedCategories.size === 0) return []

        // 从匹配的类别中选取技能
        const recommended = []
        const seen = new Set()
        for (const cat of matchedCategories) {
            const catInfo = this.categories.get(cat)
            if (!catInfo) continue
            for (const toolName of catInfo.tools) {
                if (seen.has(toolName)) continue
                seen.add(toolName)
                const skill = this.getSkill(toolName)
                if (skill) {
                    recommended.push({
                        name: skill.name,
                        identity: skill.identity,
                        description: skill.description,
                        category: skill.category,
                        source: this._getSource(skill)
                    })
                }
                if (recommended.length >= limit) break
            }
            if (recommended.length >= limit) break
        }

        return recommended
    }

    /**
     * 获取分类统计摘要（适合展示给用户）
     * @returns {Array<{category: string, count: number, source: string, skills: string[]}>}
     */
    getDiscoverySummary() {
        const summary = []
        for (const [key, cat] of this.categories) {
            summary.push({
                category: key,
                count: cat.tools.length,
                serverName: cat.serverName || null,
                skills: cat.tools.slice(0, 5).map(name => this.getSkill(name)?.name || name)
            })
        }
        return summary.sort((a, b) => b.count - a.count)
    }

    _matchSource(skill, source) {
        const skillSource = this._getSource(skill)
        if (source === 'builtin') return skillSource === 'builtin'
        if (source === 'custom') return skillSource === 'custom'
        if (source === 'mcp') return skillSource === 'mcp'
        return true
    }

    _getSource(skill) {
        if (skill.source === 'builtin' || skill.source === 'custom' || skill.source === 'mcp') return skill.source
        if (skill.isMcpTool) return 'mcp'
        if (skill.isCustom || skill.isJsTool || skill.serverName === 'custom-tools') return 'custom'
        if (skill.isBuiltin || skill.serverName === 'builtin') return 'builtin'
        if (skill.serverName) return 'mcp'
        return 'unknown'
    }

    getSkillsByCategory(cat) {
        const c = this.categories.get(cat)
        return c ? c.tools.map(n => this.getSkill(n)).filter(Boolean) : []
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
        return serverInfo.tools.map(name => this.getSkill(name)).filter(Boolean)
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
                        const skill = this.getSkill(name)
                        return skill
                            ? { name: skill.name, identity: skill.identity, description: skill.description }
                            : null
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

function getToolSource(tool) {
    if (tool.source === 'builtin' || tool.source === 'custom' || tool.source === 'mcp') return tool.source
    if (tool.isMcpTool) return 'mcp'
    if (tool.isCustom || tool.isJsTool || tool.serverName === 'custom-tools') return 'custom'
    if (tool.isBuiltin || tool.serverName === 'builtin') return 'builtin'
    if (tool.serverName) return 'mcp'
    return 'unknown'
}

export function convertMcpTools(mcpTools, requestContext = null) {
    return mcpTools.map(t => {
        const source = getToolSource(t)
        const identity = getToolIdentity({
            name: t.name,
            serverName: t.serverName,
            source,
            isMcpTool: source === 'mcp'
        })
        return {
            name: t.name,
            type: 'function',
            identity,
            serverName: t.serverName,
            source,
            isBuiltin: source === 'builtin',
            isJsTool: t.isJsTool,
            isCustom: source === 'custom',
            isMcpTool: source === 'mcp',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema || { type: 'object', properties: {} }
            },
            async run(args) {
                const startTime = Date.now()
                try {
                    const result = await mcpManager.callTool(t.name, args, {
                        useCache: true,
                        cacheTTL: 60000,
                        context: requestContext,
                        serverName: t.serverName
                    })
                    const duration = Date.now() - startTime

                    // 提取实际内容
                    let content
                    const isError = result?.isError === true

                    if (result && typeof result === 'object') {
                        // MCP 格式：{ content: [{type: 'text', text: '...'}] }
                        if (Array.isArray(result.content)) {
                            content = result.content
                                .map(item => (item.type === 'text' ? item.text : JSON.stringify(item)))
                                .join('\n')
                        }
                        // 已格式化的对象
                        else if (result.status) {
                            content = result.content
                        }
                        // 其他对象
                        else {
                            content = typeof result.content === 'string' ? result.content : JSON.stringify(result)
                        }
                    } else {
                        content = typeof result === 'string' ? result : JSON.stringify(result)
                    }

                    // 包装为标准格式
                    const formattedResult = {
                        status: isError ? 'error' : 'success',
                        tool: t.name,
                        content: content,
                        metadata: { duration }
                    }
                    return JSON.stringify(formattedResult)
                } catch (error) {
                    return JSON.stringify({
                        status: 'error',
                        tool: t.name,
                        content: error.message,
                        metadata: { duration: Date.now() - startTime }
                    })
                }
            }
        }
    })
}

export async function createSkillsAgent(options = {}) {
    const agent = new SkillsAgent(options)
    await agent.init()
    return agent
}

export default SkillsAgent
