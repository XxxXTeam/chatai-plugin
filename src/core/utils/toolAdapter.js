import { mcpManager } from '../../mcp/McpManager.js'
import config from '../../../config/config.js'
import { toolFilterService } from '../../services/ToolFilterService.js'

/**
 * Convert MCP tools to Chaite tool format
 * @param {Array} mcpTools - MCP tools from McpManager
 * @param {Object} requestContext - Request-level context for concurrent isolation {event, bot}
 * @returns {Array} - Chaite format tools with run method
 */
export function convertMcpTools(mcpTools, requestContext = null) {
    return mcpTools.map(mcpTool => ({
        function: {
            name: mcpTool.name,
            description: mcpTool.description,
            parameters: mcpTool.inputSchema || {
                type: 'object',
                properties: {},
                required: []
            }
        },
        /**
         * Run the MCP tool
         * @param {Object} args - Tool arguments
         * @param {Object} context - Chaite context
         * @returns {Promise<string>} - Tool result as string
         */
        async run(args, context) {
            try {
                logger.debug(`[Tool] ${mcpTool.name}`)

                // 使用闭包捕获的请求级上下文，实现并发隔离
                const result = await mcpManager.callTool(mcpTool.name, args, {
                    useCache: true,
                    cacheTTL: 60000, // 1 minute cache
                    context: requestContext // 传递请求级上下文
                })

                // Format result
                if (result.content) {
                    // Handle array of content blocks
                    if (Array.isArray(result.content)) {
                        return result.content
                            .map(block => {
                                if (block.type === 'text') {
                                    return block.text
                                } else if (block.type === 'image') {
                                    return `[Image: ${block.url || block.data?.substring(0, 50)}...]`
                                } else if (block.type === 'resource') {
                                    return `[Resource: ${block.uri}]`
                                }
                                return JSON.stringify(block)
                            })
                            .join('\n')
                    }
                    return typeof result.content === 'string'
                        ? result.content
                        : JSON.stringify(result.content)
                }

                // Fallback: stringify the whole result
                return JSON.stringify(result)
            } catch (error) {
                logger.error(`[MCP Tool] Error running ${mcpTool.name}:`, error)
                return `Error executing tool: ${error.message}`
            }
        }
    }))
}

/**
 * Get all tools from MCP Manager (including builtin tools)
 * @param {Object} [options] - Options
 * @param {Object} [options.event] - Yunzai event for context
 * @param {Object} [options.toolsConfig] - Preset tools config for filtering
 * @param {string} [options.presetId] - Preset ID for filtering
 * @param {string} [options.userPermission] - User permission level
 * @returns {Promise<Array>} - All tools in Chaite format
 */
export async function getAllTools(options = {}) {
    const { event, toolsConfig, presetId, userPermission } = options

    // 创建请求级上下文（用于并发隔离）
    const requestContext = event ? { event, bot: event.bot || Bot } : null

    // 仍然设置全局上下文以兼容旧代码
    if (requestContext) {
        mcpManager.setToolContext(requestContext)
    }

    // Initialize and get all tools (builtin + external MCP)
    try {
        await mcpManager.init()
        let mcpTools = mcpManager.getTools()
        
        // 应用预设级别的工具过滤
        if (presetId || toolsConfig) {
            await toolFilterService.init()
            const filterOptions = {
                userPermission: userPermission || event?.sender?.role || 'member',
                groupId: event?.group_id,
                userId: event?.user_id
            }
            mcpTools = toolFilterService.filterTools(mcpTools, presetId || 'default', filterOptions)
        }
        
        // 传递请求级上下文到工具，通过闭包捕获实现并发隔离
        return convertMcpTools(mcpTools, requestContext)
    } catch (error) {
        logger.error('[ToolAdapter] Failed to load tools:', error)
        return []
    }
}

/**
 * Execute a tool by name (directly through MCP Manager)
 * @param {string} toolName - Name of the tool
 * @param {Object} args - Tool arguments
 * @param {Object} context - Execution context
 * @param {Object} [options] - Options including event for context
 * @returns {Promise<Object>} - Tool result in MCP format
 */
export async function executeTool(toolName, args, context, options = {}) {
    const { event, presetId } = options

    // 创建请求级上下文
    const requestContext = event ? { event, bot: event.bot || Bot } : null

    // 仍然设置全局上下文以兼容旧代码
    if (requestContext) {
        mcpManager.setToolContext(requestContext)
    }
    
    // 工具调用前验证
    await toolFilterService.init()
    
    // 检查工具访问权限
    const accessCheck = toolFilterService.checkToolAccess(
        toolName, 
        presetId || 'default',
        {
            userPermission: event?.sender?.role || 'member',
            groupId: event?.group_id,
            userId: event?.user_id
        }
    )
    
    if (!accessCheck.allowed) {
        logger.warn(`[ToolAdapter] 工具访问被拒绝: ${toolName}, 原因: ${accessCheck.reason}`)
        return {
            content: [{ type: 'text', text: accessCheck.reason }],
            isError: true
        }
    }
    
    // 验证工具调用参数
    const validateResult = toolFilterService.validateToolCall(toolName, args, {
        groupId: event?.group_id,
        userId: event?.user_id
    })
    
    if (!validateResult.valid) {
        logger.warn(`[ToolAdapter] 工具参数验证失败: ${toolName}, 原因: ${validateResult.reason}`)
        return {
            content: [{ type: 'text', text: validateResult.reason }],
            isError: true
        }
    }

    await mcpManager.init()
    // 传递请求级上下文实现并发隔离
    return await mcpManager.callTool(toolName, args, {
        ...options,
        context: requestContext
    })
}

/**
 * Get builtin tools only (for display/documentation)
 * @returns {Array}
 */
export function getBuiltinToolsList() {
    const tools = mcpManager.getTools()
    return tools.filter(t => t.isBuiltin)
}

/**
 * Check if a tool is dangerous
 * @param {string} toolName 
 * @returns {boolean}
 */
export function isDangerousTool(toolName) {
    const dangerousTools = toolFilterService.getDangerousTools()
    return dangerousTools.includes(toolName)
}

/**
 * 检查工具是否可用（综合检查权限、禁用状态等）
 * @param {string} toolName - 工具名称
 * @param {string} presetId - 预设ID
 * @param {Object} options - 额外选项
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkToolAvailable(toolName, presetId = 'default', options = {}) {
    await toolFilterService.init()
    return toolFilterService.checkToolAccess(toolName, presetId, options)
}

/**
 * 获取预设的工具调用限制
 * @param {string} presetId - 预设ID
 * @returns {Object}
 */
export function getToolCallLimits(presetId = 'default') {
    return toolFilterService.getToolCallLimits(presetId)
}

/**
 * Set tool context for builtin tools
 * @param {Object} ctx - Context with event and bot
 */
export function setToolContext(ctx) {
    mcpManager.setToolContext(ctx)
}

/**
 * Refresh builtin tools
 */
export async function refreshBuiltinTools() {
    return await mcpManager.refreshBuiltinTools()
}
