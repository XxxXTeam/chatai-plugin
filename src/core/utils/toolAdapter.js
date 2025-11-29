import { mcpManager } from '../../mcp/McpManager.js'
import config from '../../../config/config.js'

/**
 * Convert MCP tools to Chaite tool format
 * @param {Array} mcpTools - MCP tools from McpManager
 * @returns {Array} - Chaite format tools with run method
 */
export function convertMcpTools(mcpTools) {
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
                logger.info(`[MCP Tool] Running ${mcpTool.name}`, args)

                const result = await mcpManager.callTool(mcpTool.name, args, {
                    useCache: true,
                    cacheTTL: 60000 // 1 minute cache
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
 * @returns {Promise<Array>} - All tools in Chaite format
 */
export async function getAllTools(options = {}) {
    const { event } = options

    // Set tool context if event is provided
    if (event) {
        mcpManager.setToolContext({ event, bot: event.bot || Bot })
    }

    // Initialize and get all tools (builtin + external MCP)
    try {
        await mcpManager.init()
        const mcpTools = mcpManager.getTools()
        return convertMcpTools(mcpTools)
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
    const { event } = options

    // Set tool context if event is provided
    if (event) {
        mcpManager.setToolContext({ event, bot: event.bot || Bot })
    }

    await mcpManager.init()
    return await mcpManager.callTool(toolName, args, options)
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
    const builtinConfig = config.get('builtinTools') || {}
    const dangerousTools = builtinConfig.dangerousTools || []
    return dangerousTools.includes(toolName)
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
