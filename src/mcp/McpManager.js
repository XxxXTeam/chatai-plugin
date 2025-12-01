import fs from 'node:fs'
import path from 'node:path'
import config from '../../config/config.js'
import { McpClient } from './McpClient.js'
import { builtinMcpServer, setBuiltinToolContext } from './BuiltinMcpServer.js'

export class McpManager {
    constructor() {
        this.tools = new Map()
        this.servers = new Map()
        this.resources = new Map()
        this.prompts = new Map()
        this.toolResultCache = new Map()
        this.toolLogs = []  // 工具调用日志
        this.maxLogs = 1000 // 最大日志数量
        this.initialized = false
    }

    /**
     * Initialize MCP Manager
     */
    async init() {
        if (this.initialized) return

        // 初始化内置 MCP 服务器
        await this.initBuiltinServer()

        const mcpConfig = config.get('mcp')
        if (!mcpConfig?.enabled) {
            logger.info('[MCP] External MCP is disabled, using builtin only')
            this.initialized = true
            return
        }

        await this.loadServers()
        this.initialized = true
        logger.info('[MCP] Manager initialized')
    }

    /**
     * 初始化内置 MCP 服务器
     */
    async initBuiltinServer() {
        try {
            await builtinMcpServer.init()
            
            // 注册内置工具
            const tools = builtinMcpServer.listTools()
            for (const tool of tools) {
                this.tools.set(tool.name, {
                    ...tool,
                    serverName: 'builtin',
                    isBuiltin: true
                })
            }

            // 注册内置服务器
            this.servers.set('builtin', {
                status: 'connected',
                config: { type: 'builtin' },
                client: null,
                tools,
                resources: [],
                prompts: [],
                connectedAt: Date.now(),
                isBuiltin: true
            })

            logger.info(`[MCP] Builtin server initialized with ${tools.length} tools`)
        } catch (error) {
            logger.error('[MCP] Failed to initialize builtin server:', error)
        }
    }

    /**
     * 设置工具上下文（用于内置工具）
     */
    setToolContext(ctx) {
        setBuiltinToolContext(ctx)
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

    /**
     * Reload/reconnect a server
     */
    async reloadServer(name) {
        const server = this.servers.get(name)
        if (!server) {
            throw new Error(`Server not found: ${name}`)
        }

        // 内置服务器不需要重连
        if (server.isBuiltin) {
            await this.refreshBuiltinTools()
            return { success: true, message: 'Builtin server refreshed' }
        }

        const serverConfig = server.config
        await this.disconnectServer(name)
        await this.connectServer(name, serverConfig)
        return { success: true }
    }

    /**
     * Add a new server
     */
    async addServer(name, serverConfig) {
        if (this.servers.has(name)) {
            throw new Error(`Server already exists: ${name}`)
        }

        // Save to config
        const mcpConfig = config.get('mcp') || { enabled: true, servers: {} }
        mcpConfig.servers[name] = serverConfig
        config.set('mcp', mcpConfig)

        // Connect
        await this.connectServer(name, serverConfig)
        return this.getServer(name)
    }

    /**
     * Update server config
     */
    async updateServer(name, serverConfig) {
        const server = this.servers.get(name)
        if (!server) {
            throw new Error(`Server not found: ${name}`)
        }

        if (server.isBuiltin) {
            throw new Error('Cannot update builtin server')
        }

        // Update config
        const mcpConfig = config.get('mcp') || { enabled: true, servers: {} }
        mcpConfig.servers[name] = serverConfig
        config.set('mcp', mcpConfig)

        // Reconnect
        await this.reloadServer(name)
        return this.getServer(name)
    }

    /**
     * Remove a server
     */
    async removeServer(name) {
        const server = this.servers.get(name)
        if (!server) {
            throw new Error(`Server not found: ${name}`)
        }

        if (server.isBuiltin) {
            throw new Error('Cannot remove builtin server')
        }

        await this.disconnectServer(name)

        // Remove from config
        const mcpConfig = config.get('mcp') || { enabled: true, servers: {} }
        delete mcpConfig.servers[name]
        config.set('mcp', mcpConfig)

        return true
    }

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
     * @param {Object} options Execution options (including context for request isolation)
     * @returns {Promise} Tool result
     */
    async callTool(name, args, options = {}) {
        const tool = this.tools.get(name)
        if (!tool) {
            throw new Error(`Tool not found: ${name}`)
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

        const startTime = Date.now()
        const logEntry = {
            toolName: name,
            arguments: args,
            timestamp: startTime,
            userId: options.userId || null,
            success: false,
            duration: 0,
            result: null,
            error: null
        }

        try {
            logger.info(`[MCP] Calling tool: ${name}`, args)
            let result

            // 内置工具使用内置服务器处理，传递请求级上下文
            if (tool.isBuiltin || tool.serverName === 'builtin') {
                result = await builtinMcpServer.callTool(name, args, options.context)
            } else {
                // 外部 MCP 服务器
                const server = this.servers.get(tool.serverName)
                if (!server || !server.client) {
                    throw new Error(`Server not available for tool: ${name}`)
                }
                result = await server.client.callTool(name, args)
            }

            // Cache result if enabled
            if (options.useCache) {
                const cacheKey = `${name}:${JSON.stringify(args)}`
                this.toolResultCache.set(cacheKey, {
                    result,
                    timestamp: Date.now()
                })
            }

            // 记录成功日志
            logEntry.success = true
            logEntry.duration = Date.now() - startTime
            logEntry.result = result
            this.addToolLog(logEntry)

            return result
        } catch (error) {
            // 记录失败日志
            logEntry.success = false
            logEntry.duration = Date.now() - startTime
            logEntry.error = error.message
            this.addToolLog(logEntry)

            logger.error(`[MCP] Tool call failed: ${name}`, error)
            throw error
        }
    }

    /**
     * 添加工具调用日志
     */
    addToolLog(entry) {
        this.toolLogs.unshift(entry)
        // 限制日志数量
        if (this.toolLogs.length > this.maxLogs) {
            this.toolLogs = this.toolLogs.slice(0, this.maxLogs)
        }
    }

    /**
     * 获取工具调用日志
     */
    getToolLogs(toolFilter, searchQuery) {
        let logs = this.toolLogs

        if (toolFilter) {
            logs = logs.filter(l => l.toolName === toolFilter)
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase()
            logs = logs.filter(l => 
                l.toolName.toLowerCase().includes(query) ||
                l.userId?.toLowerCase().includes(query) ||
                JSON.stringify(l.arguments).toLowerCase().includes(query)
            )
        }

        return logs.slice(0, 500) // 最多返回 500 条
    }

    /**
     * 清空工具调用日志
     */
    clearToolLogs() {
        this.toolLogs = []
        logger.info('[MCP] Tool logs cleared')
    }

    /**
     * 刷新内置工具列表
     */
    async refreshBuiltinTools() {
        // 移除旧的内置工具
        for (const [name, tool] of this.tools) {
            if (tool.isBuiltin) {
                this.tools.delete(name)
            }
        }

        // 重新加载
        const tools = builtinMcpServer.listTools()
        for (const tool of tools) {
            this.tools.set(tool.name, {
                ...tool,
                serverName: 'builtin',
                isBuiltin: true
            })
        }

        // 更新服务器信息
        const server = this.servers.get('builtin')
        if (server) {
            server.tools = tools
        }

        logger.info(`[MCP] Refreshed builtin tools: ${tools.length}`)
        return tools
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
