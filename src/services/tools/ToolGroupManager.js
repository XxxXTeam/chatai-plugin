import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import config from '../../../config/config.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { toolCategories } from '../../mcp/tools/index.js'

/**
 * 工具组管理器
 *
 * 管理工具的分组和调度，支持:
 * - 内置工具类别
 * - 自定义JS工具
 * - 外部MCP服务器工具
 *
 * @example
 * ```js
 * await toolGroupManager.init()
 * const groups = toolGroupManager.getGroupSummary()
 * const tools = await toolGroupManager.getToolsByGroupIndexes([0, 1])
 * ```
 */
export class ToolGroupManager {
    constructor() {
        this.groups = new Map()
        this.mcpServerGroups = new Map() // MCP服务器工具组
        this.initialized = false
    }

    /**
     * 初始化工具组
     * 加载内置工具类别和外部MCP服务器工具
     */
    async init() {
        if (this.initialized) return

        await mcpManager.init()
        this.loadFromBuiltinCategories()
        this.loadFromMcpServers()
        this.initialized = true

        const mcpCount = this.mcpServerGroups.size
        logger.info(`[ToolGroupManager] 初始化完成，${this.groups.size} 个内置工具组，${mcpCount} 个MCP服务器组`)
    }
    loadFromBuiltinCategories() {
        this.groups.clear()

        let index = 0
        for (const [key, category] of Object.entries(toolCategories)) {
            if (category.tools && category.tools.length > 0) {
                this.groups.set(index, {
                    index,
                    name: key,
                    displayName: category.name,
                    description: category.description,
                    tools: category.tools.map(t => t.name),
                    enabled: true,
                    source: 'builtin'
                })
                index++
            }
        }

        logger.debug(`[ToolGroupManager] 从内置分类加载 ${this.groups.size} 个工具组`)
    }

    /**
     * 从MCP服务器加载工具组
     */
    loadFromMcpServers() {
        this.mcpServerGroups.clear()

        const servers = mcpManager.getServers()
        let index = this.groups.size // 继续从内置组之后编号

        for (const server of servers) {
            // 跳过内置和自定义工具服务器
            if (server.name === 'builtin' || server.name === 'custom-tools') continue
            if (server.status !== 'connected') continue

            const serverInfo = mcpManager.getServer(server.name)
            if (!serverInfo || !serverInfo.tools || serverInfo.tools.length === 0) continue

            const group = {
                index,
                name: `mcp_${server.name}`,
                displayName: `MCP: ${server.name}`,
                description: `外部MCP服务器 ${server.name} 提供的工具`,
                tools: serverInfo.tools.map(t => t.name),
                enabled: true,
                source: 'mcp',
                serverName: server.name,
                serverType: server.type
            }

            this.groups.set(index, group)
            this.mcpServerGroups.set(server.name, group)
            index++
        }

        logger.debug(`[ToolGroupManager] 从MCP服务器加载 ${this.mcpServerGroups.size} 个工具组`)
    }

    /**
     * 获取工具组摘要
     * @param {Object} options - 选项
     * @param {boolean} options.includeDisabled - 是否包含禁用的组
     * @param {boolean} options.includeMcp - 是否包含MCP服务器组
     * @returns {Array<{index: number, name: string, description: string, source: string}>}
     */
    getGroupSummary(options = {}) {
        const { includeDisabled = false, includeMcp = true } = options
        const summary = []

        for (const [index, group] of this.groups) {
            if (!includeDisabled && !group.enabled) continue
            if (!includeMcp && group.source === 'mcp') continue

            summary.push({
                index: group.index,
                name: group.name,
                displayName: group.displayName || group.name,
                description: group.description,
                toolCount: group.tools.length,
                source: group.source || 'builtin',
                serverName: group.serverName,
                enabled: group.enabled
            })
        }
        return summary.sort((a, b) => a.index - b.index)
    }

    /**
     * 获取MCP服务器工具组
     */
    getMcpServerGroups() {
        return Array.from(this.mcpServerGroups.values())
    }

    /**
     * 根据MCP服务器名获取工具组
     */
    getGroupByMcpServer(serverName) {
        return this.mcpServerGroups.get(serverName) || null
    }

    /**
     * @returns {string} 调度提示词
     */
    buildDispatchPrompt() {
        const summary = this.getGroupSummary()

        let prompt = `你是智能任务调度器。分析用户请求，拆分为一个或多个任务。

## 核心原则：
1. **多任务拆分**：复杂请求拆分为多个独立任务，按执行顺序排列
2. **依赖关系**：后续任务依赖前置任务结果时，设置dependsOn
3. **默认用工具**：涉及查询/操作的请求用tool，纯闲聊用chat

## 任务类型：
- **tool** - 查询/操作（关键词：查、找、获取、发送、时间、天气、群、成员...）
- **draw** - 绘图（关键词：画、绘制、生成图片...）
- **image_understand** - 理解图片内容
- **search** - 联网搜索（关键词：搜索、最新、新闻...）
- **chat** - 纯闲聊/问候/创作

`
        if (summary.length > 0) {
            prompt += `## 可用工具组：\n`
            for (const group of summary) {
                const displayName = group.displayName || group.name
                prompt += `[${group.index}] ${displayName}: ${group.description}\n`
            }
        }

        prompt += `
## 返回格式（JSON）：
{
  "analysis": "意图分析",
  "tasks": [
    {"type": "tool", "priority": 1, "params": {"toolGroups": [索引]}},
    {"type": "draw", "priority": 2, "params": {"drawPrompt": "英文提示词"}, "dependsOn": 1}
  ],
  "executionMode": "sequential"
}

## 多任务示例：

用户："帮我查群成员，然后画一张他们的合照"
{"analysis":"先查群成员，再绘图","tasks":[{"type":"tool","priority":1,"params":{"toolGroups":[群管理工具组索引]}},{"type":"draw","priority":2,"params":{"drawPrompt":"group photo of people"},"dependsOn":1}],"executionMode":"sequential"}

用户："查天气和时间"
{"analysis":"并行查询","tasks":[{"type":"tool","priority":1,"params":{"toolGroups":[天气工具组]}},{"type":"tool","priority":1,"params":{"toolGroups":[时间工具组]}}],"executionMode":"parallel"}

用户："你好"
{"analysis":"问候","tasks":[{"type":"chat","priority":1,"params":{}}],"executionMode":"sequential"}

只返回JSON。`
        return prompt
    }

    /**
     * 检测消息是否可能需要工具（用于调度失败时的智能回退）
     * @param {string} message - 用户消息
     * @returns {boolean}
     */
    detectToolIntent(message) {
        if (!message || typeof message !== 'string') return false
        const msg = message.toLowerCase()

        // 明确需要工具的关键词
        const toolKeywords = [
            // 时间相关
            '几点',
            '时间',
            '日期',
            '今天',
            '明天',
            '昨天',
            '星期',
            '周几',
            // 天气相关
            '天气',
            '温度',
            '气温',
            '下雨',
            '下雪',
            '晴天',
            '阴天',
            // 消息相关
            '发消息',
            '发送',
            '艾特',
            '@',
            '私聊',
            '群发',
            // 群管理
            '群成员',
            '群信息',
            '群列表',
            '踢人',
            '禁言',
            '解禁',
            // 查询操作
            '查',
            '搜',
            '获取',
            '看看',
            '帮我',
            '告诉我',
            // 文件操作
            '文件',
            '图片',
            '下载',
            '上传',
            // 系统操作
            '执行',
            '运行',
            '设置',
            '配置'
        ]

        for (const kw of toolKeywords) {
            if (msg.includes(kw)) return true
        }

        return false
    }

    /**
     * 解析调度响应（增强版V2，支持多任务）
     * @param {string} response - 调度模型响应
     * @param {string} [originalMessage] - 原始用户消息（用于智能回退）
     * @returns {{analysis: string, tasks: Array, executionMode: string, toolGroups: number[]}}
     */
    parseDispatchResponseV2(response, originalMessage = '') {
        // 智能默认：如果检测到工具意图，默认使用全量工具而非chat
        const hasToolIntent = this.detectToolIntent(originalMessage)
        const defaultResult = {
            analysis: '',
            tasks: [
                {
                    type: hasToolIntent ? 'tool' : 'chat',
                    priority: 1,
                    params: hasToolIntent ? { toolGroups: this.getAllGroupIndexes() } : {}
                }
            ],
            executionMode: 'sequential',
            toolGroups: hasToolIntent ? this.getAllGroupIndexes() : []
        }

        if (!response || typeof response !== 'string') {
            return defaultResult
        }

        // 清理响应文本
        let cleanResponse = response.trim()
        // 移除可能的 markdown 代码块标记
        cleanResponse = cleanResponse.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

        try {
            // 提取 JSON 对象（贪婪匹配最外层的大括号）
            const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                let jsonStr = jsonMatch[0]

                // 尝试修复常见JSON格式问题
                jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1') // 移除尾随逗号

                const parsed = JSON.parse(jsonStr)

                const analysis = parsed.analysis || ''
                const executionMode = ['sequential', 'parallel'].includes(parsed.executionMode)
                    ? parsed.executionMode
                    : 'sequential'

                // 解析任务列表
                let tasks = []
                if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) {
                    tasks = parsed.tasks.map((t, idx) => {
                        const type = ['draw', 'image_understand', 'tool', 'search', 'chat'].includes(t.type)
                            ? t.type
                            : 'chat'

                        // 验证并修正工具组索引
                        let params = t.params || {}
                        if (type === 'tool' && Array.isArray(params.toolGroups)) {
                            params.toolGroups = params.toolGroups.filter(
                                i => typeof i === 'number' && this.groups.has(i)
                            )
                            // 如果工具组为空，降级为chat
                            if (params.toolGroups.length === 0) {
                                return {
                                    type: 'chat',
                                    priority: t.priority || idx + 1,
                                    params: {},
                                    dependsOn: t.dependsOn || null
                                }
                            }
                        }

                        return {
                            type,
                            priority: t.priority || idx + 1,
                            params,
                            dependsOn: t.dependsOn || null
                        }
                    })
                } else {
                    tasks = [{ type: 'chat', priority: 1, params: {} }]
                }

                // 过滤无效任务
                tasks = tasks.filter(t => {
                    if (t.type === 'tool') {
                        return Array.isArray(t.params?.toolGroups) && t.params.toolGroups.length > 0
                    }
                    return true
                })

                if (tasks.length === 0) {
                    tasks = [{ type: 'chat', priority: 1, params: {} }]
                }

                // 提取所有工具组索引（用于兼容）
                const toolGroups = tasks
                    .filter(t => t.type === 'tool' && Array.isArray(t.params?.toolGroups))
                    .flatMap(t => t.params.toolGroups)

                logger.debug(
                    `[ToolGroupManager] 解析调度结果: 分析="${analysis}", 任务数=${tasks.length}, 工具组=[${toolGroups.join(',')}]`
                )

                return { analysis, tasks, executionMode, toolGroups }
            }
        } catch (parseErr) {
            logger.debug(
                `[ToolGroupManager] JSON解析失败: ${parseErr.message}, 响应: ${cleanResponse.substring(0, 200)}`
            )
        }

        // 兼容旧格式：纯数组
        const indexes = this.parseDispatchResponse(response)
        if (indexes.length > 0) {
            logger.debug(`[ToolGroupManager] 使用旧格式解析，工具组=[${indexes.join(',')}]`)
            return {
                analysis: '',
                tasks: [{ type: 'tool', priority: 1, params: { toolGroups: indexes } }],
                executionMode: 'sequential',
                toolGroups: indexes
            }
        }

        return defaultResult
    }

    /**
     * @param {number[]} indexes - 工具组索引数组
     * @param {Object} options - 选项
     */
    async getToolsByGroupIndexes(indexes, options = {}) {
        if (!Array.isArray(indexes) || indexes.length === 0) {
            return []
        }

        const toolNames = new Set()

        for (const index of indexes) {
            const group = this.groups.get(index)
            if (group && group.enabled) {
                group.tools.forEach(name => toolNames.add(name))
            }
        }

        if (toolNames.size === 0) {
            return []
        }

        // 从 MCP 获取完整工具定义
        const allTools = mcpManager.getTools(options)
        const selectedTools = allTools.filter(t => toolNames.has(t.name))

        logger.debug(`[ToolGroupManager] 选中工具组 [${indexes.join(',')}]，返回 ${selectedTools.length} 个工具`)

        return selectedTools
    }

    /**
     * 获取指定工具组
     *
     * @param {number} index - 工具组索引
     * @returns {Object|null} 工具组定义
     */
    getGroup(index) {
        return this.groups.get(index) || null
    }

    /**
     * 获取所有工具组
     *
     * @returns {Array} 工具组列表
     */
    getAllGroups() {
        return Array.from(this.groups.values())
    }

    /**
     * 获取所有启用的工具组索引
     * @param {Object} options - 选项
     * @param {boolean} options.includeMcp - 是否包含MCP服务器组
     * @returns {number[]}
     */
    getAllGroupIndexes(options = {}) {
        const { includeMcp = true } = options
        return Array.from(this.groups.entries())
            .filter(([_, g]) => {
                if (!g.enabled) return false
                if (!includeMcp && g.source === 'mcp') return false
                return true
            })
            .map(([idx, _]) => idx)
    }

    /**
     * 刷新工具组（重新加载MCP服务器）
     */
    async refresh() {
        this.loadFromBuiltinCategories()
        this.loadFromMcpServers()
        logger.info(`[ToolGroupManager] 刷新完成，${this.groups.size} 个工具组`)
    }

    /**
     * 添加工具组
     *
     * @param {Object} group - 工具组定义
     */
    addGroup(group) {
        if (group.index === undefined) {
            group.index = Math.max(...Array.from(this.groups.keys()), -1) + 1
        }
        this.groups.set(group.index, {
            index: group.index,
            name: group.name,
            description: group.description || '',
            tools: group.tools || [],
            enabled: group.enabled !== false
        })
        this.saveGroups()
    }

    /**
     * 更新工具组
     *
     * @param {number} index - 工具组索引
     * @param {Object} updates - 更新内容
     */
    updateGroup(index, updates) {
        const group = this.groups.get(index)
        if (!group) return false

        Object.assign(group, updates)
        this.groups.set(index, group)
        this.saveGroups()
        return true
    }

    /**
     * 删除工具组
     *
     * @param {number} index - 工具组索引
     */
    deleteGroup(index) {
        const deleted = this.groups.delete(index)
        if (deleted) {
            this.saveGroups()
        }
        return deleted
    }

    /**
     * 保存工具组到配置
     */
    saveGroups() {
        const groups = Array.from(this.groups.values())
        config.set('toolGroups', groups)
    }

    /**
     * 查找工具所属的组
     *
     * @param {string} toolName - 工具名称
     * @returns {Object|null} 工具组
     */
    findGroupByTool(toolName) {
        for (const group of this.groups.values()) {
            if (group.tools.includes(toolName)) {
                return group
            }
        }
        return null
    }

    /**
     * 解析调度模型的响应，提取选中的工具组索引
     *
     * @param {string} response - 调度模型的响应
     * @returns {number[]} 工具组索引数组
     */
    parseDispatchResponse(response) {
        if (!response || typeof response !== 'string') {
            return []
        }

        // 尝试直接解析 JSON 数组
        try {
            // 提取 JSON 数组
            const match = response.match(/\[[\d,\s]*\]/)
            if (match) {
                const indexes = JSON.parse(match[0])
                if (Array.isArray(indexes)) {
                    return indexes.filter(i => typeof i === 'number' && this.groups.has(i))
                }
            }
        } catch {
            // 解析失败，尝试其他格式
        }

        // 尝试提取数字
        const numbers = response.match(/\d+/g)
        if (numbers) {
            return numbers.map(n => parseInt(n, 10)).filter(i => !isNaN(i) && this.groups.has(i))
        }

        return []
    }
}

export const toolGroupManager = new ToolGroupManager()
