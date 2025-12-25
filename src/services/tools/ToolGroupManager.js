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
        if (summary.length === 0) {
            return ''
        }
        
        let prompt = `你可以使用以下工具组来完成任务。请分析用户的请求，选择需要使用的工具组索引。

可用工具组：
`
        for (const group of summary) {
            const displayName = group.displayName || group.name
            prompt += `- [${group.index}] ${displayName}: ${group.description} (${group.toolCount}个工具)\n`
        }
        
        prompt += `
判断规则：
1. 如果用户需要执行某个操作（如查时间、发消息、搜索等），返回对应工具组
2. 如果用户询问"有什么工具/能做什么/有什么功能"等，返回所有工具组索引
3. 只有当请求完全是闲聊且不涉及任何工具时，才返回空数组

请只返回工具组索引列表（JSON数组格式），例如：[0, 2] 或全部：[${summary.map(g => g.index).join(', ')}]
`
        return prompt
    }

    /**
     * @param {number[]} indexes - 工具组索引数组
     * @param {Object} options - 选项
     * @returns {Promise<Array>} 工具列表
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
