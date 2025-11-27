import fs from 'node:fs'
import path from 'node:path'
import config from '../../config/config.js'
import { McpClient } from './McpClient.js'

export class McpManager {
    constructor() {
        this.tools = new Map()
        this.servers = new Map()
        this.resources = new Map()
        this.prompts = new Map()
        this.toolResultCache = new Map()
        this.initialized = false
    }

    /**
     * Initialize MCP Manager
     */
    async init() {
        if (this.initialized) return

        const mcpConfig = config.get('mcp')
        if (!mcpConfig?.enabled) {
            logger.info('[MCP] MCP is disabled')
            this.initialized = true
            return
        }

        await this.loadServers()
        this.initialized = true
        logger.info('[MCP] Manager initialized')
    }

    /**
     * Load servers from configuration
     */
    async loadServers() {
        const mcpConfig = config.get('mcp')
        const servers = mcpConfig?.servers || {}

        for (const [name, serverConfig] of Object.entries(servers)) {
            try {
                await this.connectServer(name, serverConfig)
            } catch (error) {
                logger.error(`[MCP] Failed to load server ${name}:`, error.message)
            }
        }
    }

    async connectServer(name, serverConfig) {
        try {
            // Disconnect existing server if any
            if (this.servers.has(name)) {
                await this.disconnectServer(name)
            }

            const client = new McpClient(serverConfig)
            await client.connect()

            // Fetch tools
            const tools = await client.listTools()

            // Fetch resources if supported
            let resources = []
            try {
                resources = await client.listResources()
            } catch (error) {
                // Resources not supported, ignore
            }

            // Fetch prompts if supported
            let prompts = []
            try {
                prompts = await client.listPrompts()
            } catch (error) {
                // Prompts not supported, ignore
            }

            this.servers.set(name, {
                status: 'connected',
                config: serverConfig,
                client,
                tools,
                resources,
                prompts,
                connectedAt: Date.now()
            })

            // Register tools
            for (const tool of tools) {
                this.tools.set(tool.name, {
                    ...tool,
                    serverName: name
                })
            }

            // Register resources
            for (const resource of resources) {
                this.resources.set(resource.uri, {
                    ...resource,
                    serverName: name
                })
            }

            // Register prompts
            for (const prompt of prompts) {
                this.prompts.set(prompt.name, {
                    ...prompt,
                    serverName: name
                })
            }

            logger.info(`[MCP] Connected to server: ${name}, loaded ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`)
            return { success: true, tools: tools.length, resources: resources.length, prompts: prompts.length }
        } catch (err) {
            logger.error(`[MCP] Failed to connect to server ${name}:`, err)
            this.servers.set(name, {
                status: 'error',
                config: serverConfig,
                error: err.message,
                lastAttempt: Date.now()
            })
            throw err
        }
    }

    async disconnectServer(name) {
        const server = this.servers.get(name)
        if (!server || !server.client) return

        try {
            // Remove tools from this server
            for (const [toolName, tool] of this.tools) {
                if (tool.serverName === name) {
                    this.tools.delete(toolName)
                }
            }

            // Remove resources from this server
            for (const [uri, resource] of this.resources) {
                if (resource.serverName === name) {
                    this.resources.delete(uri)
                }
            }

            // Remove prompts from this server
            for (const [promptName, prompt] of this.prompts) {
                if (prompt.serverName === name) {
                    this.prompts.delete(promptName)
                }
            }

            // Disconnect client
            await server.client.disconnect()

            this.servers.delete(name)
            logger.info(`[MCP] Disconnected from server: ${name}`)
            return true
        } catch (error) {
            logger.error(`[MCP] Error disconnecting from server ${name}:`, error)
            return false
        }
    }

    // ... (reload, add, update, remove servers remain same)

    /**
     * Get all available tools
     * @returns {Array} List of tools
     */
    getTools() {
        const tools = []
        for (const [name, tool] of this.tools) {
            tools.push({
                name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                serverName: tool.serverName
            })
        }
        return tools
    }

    /**
     * Get all available prompts
     * @returns {Array} List of prompts
     */
    getPrompts() {
        const prompts = []
        for (const [name, prompt] of this.prompts) {
            prompts.push({
                name,
                description: prompt.description,
                arguments: prompt.arguments,
                serverName: prompt.serverName
            })
        }
        return prompts
    }

    /**
     * Get prompt content
     */
    async getPrompt(name, args = {}) {
        const prompt = this.prompts.get(name)
        if (!prompt) {
            throw new Error(`Prompt not found: ${name}`)
        }

        const server = this.servers.get(prompt.serverName)
        if (!server || !server.client) {
            throw new Error(`Server not available for prompt: ${name}`)
        }

        return await server.client.getPrompt(name, args)
    }

    /**
     * Get tool by name
     */
    getTool(name) {
        return this.tools.get(name) || null
    }

    /**
     * Get server status
     */
    getServers() {
        const servers = []
        for (const [name, info] of this.servers) {
            servers.push({
                name,
                status: info.status,
                type: info.config?.type || 'stdio',
                toolsCount: info.tools?.length || 0,
                resourcesCount: info.resources?.length || 0,
                promptsCount: info.prompts?.length || 0,
                connectedAt: info.connectedAt,
                error: info.error
            })
        }
        return servers
    }

    /**
     * Get server info
     */
    getServer(name) {
        const server = this.servers.get(name)
        if (!server) return null

        return {
            name,
            status: server.status,
            type: server.config?.type || 'stdio',
            config: server.config,
            tools: server.tools || [],
            resources: server.resources || [],
            prompts: server.prompts || [],
            connectedAt: server.connectedAt,
            error: server.error
        }
    }

    /**
     * Get all resources
     */
    getResources() {
        const resources = []
        for (const [uri, resource] of this.resources) {
            resources.push({
                uri,
                name: resource.name,
                description: resource.description,
                mimeType: resource.mimeType,
                serverName: resource.serverName
            })
        }
        return resources
    }

    /**
     * Read resource content
     */
    async readResource(uri) {
        const resource = this.resources.get(uri)
        if (!resource) {
            throw new Error(`Resource not found: ${uri}`)
        }

        const server = this.servers.get(resource.serverName)
        if (!server || !server.client) {
            throw new Error(`Server not available for resource: ${uri}`)
        }

        return await server.client.readResource(uri)
    }

    /**
     * Execute a tool
     * @param {string} name Tool name
     * @param {Object} args Tool arguments
     * @param {Object} options Execution options
     * @returns {Promise} Tool result
     */
    async callTool(name, args, options = {}) {
        const tool = this.tools.get(name)
        if (!tool) {
            throw new Error(`Tool not found: ${name}`)
        }

        const server = this.servers.get(tool.serverName)
        if (!server || !server.client) {
            throw new Error(`Server not available for tool: ${name}`)
        }

        // Check cache if enabled
        if (options.useCache) {
            const cacheKey = `${name}:${JSON.stringify(args)}`
            const cached = this.toolResultCache.get(cacheKey)
            if (cached && Date.now() - cached.timestamp < (options.cacheTTL || 60000)) {
                logger.debug(`[MCP] Using cached result for tool: ${name}`)
                return cached.result
            }
        }

        try {
            logger.info(`[MCP] Calling tool: ${name}`)
            const result = await server.client.callTool(name, args)

            // Cache result if enabled
            if (options.useCache) {
                const cacheKey = `${name}:${JSON.stringify(args)}`
                this.toolResultCache.set(cacheKey, {
                    result,
                    timestamp: Date.now()
                })
            }

            return result
        } catch (error) {
            logger.error(`[MCP] Tool call failed: ${name}`, error)
            throw error
        }
    }

    /**
     * Clear tool result cache
     */
    clearCache() {
        this.toolResultCache.clear()
        logger.info('[MCP] Tool result cache cleared')
    }

    /**
     * Get cache stats
     */
    getCacheStats() {
        return {
            size: this.toolResultCache.size,
            entries: Array.from(this.toolResultCache.keys())
        }
    }
}

export const mcpManager = new McpManager()
