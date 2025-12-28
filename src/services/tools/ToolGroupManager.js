import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import config from '../../../config/config.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { toolCategories } from '../../mcp/tools/index.js'
export class ToolGroupManager {
    constructor() {
        this.groups = new Map()
        this.initialized = false
    }
    /**
     * 初始化工具组
     * 直接使用内置工具的 toolCategories 分类
     */
    async init() {
        if (this.initialized) return
        
        await mcpManager.init()
        this.loadFromBuiltinCategories()
        this.initialized = true
        
        logger.info(`[ToolGroupManager] 初始化完成，共 ${this.groups.size} 个工具组`)
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
                    enabled: true
                })
                index++
            }
        }
        
        logger.debug(`[ToolGroupManager] 从内置分类加载 ${this.groups.size} 个工具组`)
    }

    /**
     * @returns {Array<{index: number, name: string, description: string}>}
     */
    getGroupSummary() {
        const summary = []
        for (const [index, group] of this.groups) {
            if (group.enabled) {
                summary.push({
                    index: group.index,
                    name: group.name,
                    displayName: group.displayName || group.name,
                    description: group.description,
                    toolCount: group.tools.length
                })
            }
        }
        return summary.sort((a, b) => a.index - b.index)
    }

    /** 
     * @returns {string} 调度提示词
     */
    buildDispatchPrompt() {
        const summary = this.getGroupSummary()
        
        let prompt = `请分析用户的请求，生成任务执行计划。支持多步骤任务，任务可以串行或并行执行。

## 任务类型：

1. **draw（绘图生成）** - 生成/绘制/画图片
   示例："帮我画一只猫"、"生成一张风景图"
   需要: drawPrompt（优化后的英文绘图提示词）

2. **image_understand（图像理解）** - 分析/理解/描述图片内容
   示例："这张图片里有什么"、"描述一下这个图"
   需要: prompt（分析指令）

3. **tool（工具调用）** - 执行具体操作
   示例："查天气"、"发消息"、"查时间"
   需要: toolGroups（工具组索引）

4. **search（联网搜索）** - 查询最新信息
   示例："搜索最新新闻"、"查一下xxx"
   需要: query（搜索关键词）

5. **chat（普通对话）** - 闲聊、问答、创作文字
   示例："你好"、"写一首诗"

`
        if (summary.length > 0) {
            prompt += `## 可用工具组：
`
            for (const group of summary) {
                const displayName = group.displayName || group.name
                prompt += `- [${group.index}] ${displayName}: ${group.description} (${group.toolCount}个工具)\n`
            }
        }
        
        prompt += `
## 返回格式（JSON）：
{
    "analysis": "简要分析用户意图",
    "tasks": [
        {
            "type": "任务类型",
            "priority": 1,
            "params": {
                "prompt": "任务提示词",
                "drawPrompt": "绘图提示词(type=draw时)",
                "toolGroups": [工具组索引(type=tool时)],
                "query": "搜索关键词(type=search时)"
            },
            "dependsOn": null
        }
    ],
    "executionMode": "sequential|parallel"
}

## 示例：

用户说"帮我画一只可爱的小猫"
{"analysis":"用户需要生成猫的图片","tasks":[{"type":"draw","priority":1,"params":{"drawPrompt":"a cute little cat, adorable, fluffy fur, big eyes, high quality, detailed"}}],"executionMode":"sequential"}

用户说"这张图片里有什么？然后帮我画一张类似的"
{"analysis":"先理解图片内容，再根据内容生成类似图片","tasks":[{"type":"image_understand","priority":1,"params":{"prompt":"详细描述这张图片的内容、风格、主题"}},{"type":"draw","priority":2,"params":{"drawPrompt":"根据上一步的描述生成"},"dependsOn":1}],"executionMode":"sequential"}

用户说"现在几点了，顺便查下北京天气"
{"analysis":"用户需要查时间和天气，可以并行执行","tasks":[{"type":"tool","priority":1,"params":{"toolGroups":[0]}},{"type":"tool","priority":1,"params":{"toolGroups":[14]}}],"executionMode":"parallel"}

用户说"你好"
{"analysis":"简单问候","tasks":[{"type":"chat","priority":1,"params":{}}],"executionMode":"sequential"}

只返回JSON，不要其他内容。`
        return prompt
    }

    /**
     * 解析调度响应（增强版V2，支持多任务）
     * @param {string} response - 调度模型响应
     * @returns {{analysis: string, tasks: Array, executionMode: string, toolGroups: number[]}}
     */
    parseDispatchResponseV2(response) {
        const defaultResult = { 
            analysis: '', 
            tasks: [{ type: 'chat', priority: 1, params: {} }], 
            executionMode: 'sequential',
            toolGroups: []
        }
        
        if (!response || typeof response !== 'string') {
            return defaultResult
        }
        
        try {
            // 提取 JSON 对象
            const jsonMatch = response.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                
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
                        return {
                            type,
                            priority: t.priority || idx + 1,
                            params: t.params || {},
                            dependsOn: t.dependsOn || null
                        }
                    })
                } else {
                    tasks = [{ type: 'chat', priority: 1, params: {} }]
                }
                
                // 提取所有工具组索引（用于兼容）
                const toolGroups = tasks
                    .filter(t => t.type === 'tool' && Array.isArray(t.params?.toolGroups))
                    .flatMap(t => t.params.toolGroups)
                    .filter(i => typeof i === 'number' && this.groups.has(i))
                
                return { analysis, tasks, executionMode, toolGroups }
            }
        } catch {
            // JSON解析失败，尝试旧格式兼容
        }
        
        // 兼容旧格式：纯数组
        const indexes = this.parseDispatchResponse(response)
        if (indexes.length > 0) {
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
            return numbers
                .map(n => parseInt(n, 10))
                .filter(i => !isNaN(i) && this.groups.has(i))
        }
        
        return []
    }
}

export const toolGroupManager = new ToolGroupManager()
