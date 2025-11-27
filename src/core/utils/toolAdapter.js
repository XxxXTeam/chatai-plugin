import { mcpManager } from '../../mcp/McpManager.js'

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
 * Get tools from multiple sources
 * @returns {Promise<Array>} - Combined tools from MCP and custom sources
 */
export async function getAllTools() {
    const tools = []

    // Get MCP tools
    try {
        await mcpManager.init()
        const mcpTools = mcpManager.getTools()
        tools.push(...convertMcpTools(mcpTools))
    } catch (error) {
        logger.error('[ToolAdapter] Failed to load MCP tools:', error)
    }

    // Add custom tools here if needed
    // tools.push(...customTools)

    return tools
}

/**
 * Execute a tool by name
 * @param {string} toolName - Name of the tool
 * @param {Object} args - Tool arguments
 * @param {Object} context - Execution context
 * @returns {Promise<string>} - Tool result
 */
export async function executeTool(toolName, args, context) {
    const tools = await getAllTools()
    const tool = tools.find(t => t.function.name === toolName)

    if (!tool) {
        throw new Error(`Tool not found: ${toolName}`)
    }

    return await tool.run(args, context)
}
