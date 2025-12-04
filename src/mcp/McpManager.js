import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../config/config.js'
import { McpClient } from './McpClient.js'
import { builtinMcpServer, setBuiltinToolContext } from './BuiltinMcpServer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// MCP 服务器配置文件路径
const MCP_SERVERS_FILE = path.join(__dirname, '../../data/mcp-servers.json')

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
        this.serversConfig = { servers: {} }
    }

    /**
     * 加载 MCP 服务器配置
     */
    loadServersConfig() {
        try {
            if (fs.existsSync(MCP_SERVERS_FILE)) {
                const content = fs.readFileSync(MCP_SERVERS_FILE, 'utf-8')
                this.serversConfig = JSON.parse(content)
                if (!this.serversConfig.servers) {
                    this.serversConfig.servers = {}
                }
            }
        } catch (error) {
            logger.error('[MCP] Failed to load servers config:', error.message)
            this.serversConfig = { servers: {} }
        }
        return this.serversConfig
    }

    /**
     * 保存 MCP 服务器配置
     */
    saveServersConfig() {
        try {
            const dir = path.dirname(MCP_SERVERS_FILE)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            fs.writeFileSync(MCP_SERVERS_FILE, JSON.stringify(this.serversConfig, null, 2), 'utf-8')
            logger.info('[MCP] Servers config saved')
        } catch (error) {
            logger.error('[MCP] Failed to save servers config:', error.message)
        }
    }

    /**
     * Initialize MCP Manager
     */
    async init() {
        if (this.initialized) return

        // 初始化内置 MCP 服务器
        await this.initBuiltinServer()
        
        // 初始化自定义工具服务器 (data/tools)
        await this.initCustomToolsServer()

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
     * 初始化内置 MCP 服务器（不包含 JS 工具）
     */
    async initBuiltinServer() {
        try {
            await builtinMcpServer.init()
            
            // 只注册内置工具（排除 JS 工具）
            const allTools = builtinMcpServer.listTools()
            const builtinTools = allTools.filter(t => !t.isJsTool)
            
            for (const tool of builtinTools) {
                this.tools.set(tool.name, {
                    ...tool,
                    serverName: 'builtin',
                    isBuiltin: !tool.isCustom,
                    isCustom: tool.isCustom || false
                })
            }

            // 注册内置服务器
            this.servers.set('builtin', {
                status: 'connected',
                config: { type: 'builtin' },
                client: null,
                tools: builtinTools,
                resources: [],
                prompts: [],
                connectedAt: Date.now(),
                isBuiltin: true
            })

            logger.info(`[MCP] Builtin server initialized with ${builtinTools.length} tools`)
        } catch (error) {
            logger.error('[MCP] Failed to initialize builtin server:', error)
        }
    }

    /**
     * 初始化自定义工具服务器 (data/tools 目录)
     */
    async initCustomToolsServer() {
        try {
            const allTools = builtinMcpServer.listTools()
            const jsTools = allTools.filter(t => t.isJsTool)
            
            if (jsTools.length === 0) {
                logger.info('[MCP] No custom JS tools found in data/tools')
                return
            }
            
            // 注册 JS 工具
            for (const tool of jsTools) {
                this.tools.set(tool.name, {
                    ...tool,
                    serverName: 'custom-tools',
                    isBuiltin: false,
                    isJsTool: true
                })
            }

            // 注册自定义工具服务器
            this.servers.set('custom-tools', {
                status: 'connected',
                config: { type: 'custom', path: 'data/tools' },
                client: null,
                tools: jsTools,
                resources: [],
                prompts: [],
                connectedAt: Date.now(),
                isBuiltin: false,
                isCustomTools: true
            })

            logger.info(`[MCP] Custom tools server initialized with ${jsTools.length} tools`)
        } catch (error) {
            logger.error('[MCP] Failed to initialize custom tools server:', error)
        }
    }

    /**
     * 设置工具上下文（用于内置工具）
     */
    setToolContext(ctx) {
        setBuiltinToolContext(ctx)
    }

    /**
     * Load servers from configuration (JSON file)
     */
    async loadServers() {
        // 从 JSON 文件加载配置
        this.loadServersConfig()
        const servers = this.serversConfig.servers || {}

        const serverNames = Object.keys(servers)
        if (serverNames.length === 0) {
            logger.info('[MCP] No external MCP servers configured')
            return
        }

        logger.info(`[MCP] Loading ${serverNames.length} external server(s): ${serverNames.join(', ')}`)

        // 异步并行加载所有服务器
        const results = await Promise.allSettled(
            serverNames.map(async name => {
                try {
                    await this.connectServer(name, servers[name])
                    return { name, success: true }
                } catch (error) {
                    logger.error(`[MCP] Failed to load server ${name}:`, error.message)
                    return { name, success: false, error: error.message }
                }
            })
        )

        const success = results.filter(r => r.status === 'fulfilled' && r.value.success).length
        logger.info(`[MCP] Loaded ${success}/${serverNames.length} external servers`)
    }

    async connectServer(name, serverConfig) {
        try {
            // 处理特殊服务器类型
            if (name === 'builtin') {
                await this.initBuiltinServer()
                return { success: true, tools: this.servers.get('builtin')?.tools?.length || 0 }
            }
            
            if (name === 'custom-tools' || serverConfig?.type === 'custom') {
                // 重新加载 data/tools 目录的 JS 工具
                await builtinMcpServer.loadJsTools()
                await this.initCustomToolsServer()
                return { success: true, tools: this.servers.get('custom-tools')?.tools?.length || 0 }
            }
            
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
     * Add a new server (or update if exists)
     */
    async addServer(name, serverConfig) {
        // 如果已存在，先断开
        if (this.servers.has(name)) {
            await this.disconnectServer(name)
        }

        // 保存到 JSON 文件
        this.loadServersConfig()
        this.serversConfig.servers[name] = serverConfig
        this.saveServersConfig()

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

        // 更新 JSON 文件
        this.loadServersConfig()
        this.serversConfig.servers[name] = serverConfig
        this.saveServersConfig()

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

        // 从 JSON 文件删除
        this.loadServersConfig()
        delete this.serversConfig.servers[name]
        this.saveServersConfig()

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
        let tool = this.tools.get(name)
        
        // 如果在 tools Map 中找不到，尝试初始化后再查找
        if (!tool) {
            await this.init()
            tool = this.tools.get(name)
        }
        
        // 仍然找不到，检查是否是内置工具（直接调用内置服务器）
        if (!tool) {
            const builtinTools = builtinMcpServer.listTools()
            const builtinTool = builtinTools.find(t => t.name === name)
            if (builtinTool) {
                tool = { ...builtinTool, isBuiltin: true, serverName: 'builtin' }
            }
        }
        
        // 检查是否是 JS 工具
        if (!tool && builtinMcpServer.jsTools?.has(name)) {
            tool = { name, isJsTool: true, serverName: 'custom-tools' }
        }
        
        // 检查是否是 YAML 配置的自定义工具
        if (!tool) {
            const customTools = builtinMcpServer.getCustomTools()
            const customTool = customTools.find(t => t.name === name)
            if (customTool) {
                tool = { ...customTool, isCustom: true, serverName: 'builtin' }
            }
        }
        
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

            // 内置工具、JS工具、自定义工具都使用内置服务器处理
            const useBuiltin = tool.isBuiltin || tool.isJsTool || tool.isCustom || 
                               tool.serverName === 'builtin' || tool.serverName === 'custom-tools'
            
            if (useBuiltin) {
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
     * 并行执行多个工具调用
     * @param {Array<{name: string, args: Object}>} toolCalls - 工具调用列表
     * @param {Object} options - 执行选项
     * @returns {Promise<Array<{name: string, result: any, error?: string, duration: number}>>}
     */
    async callToolsParallel(toolCalls, options = {}) {
        if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
            return []
        }

        const startTime = Date.now()
        logger.info(`[MCP] 并行执行 ${toolCalls.length} 个工具调用`)

        // 按服务器分组，同一服务器的调用可能需要串行
        const serverGroups = new Map()
        for (const call of toolCalls) {
            const tool = this.tools.get(call.name)
            const serverName = tool?.serverName || 'builtin'
            if (!serverGroups.has(serverName)) {
                serverGroups.set(serverName, [])
            }
            serverGroups.get(serverName).push(call)
        }

        // 并行执行所有调用
        const results = await Promise.allSettled(
            toolCalls.map(async (call) => {
                const callStart = Date.now()
                try {
                    const result = await this.callTool(call.name, call.args, options)
                    return {
                        name: call.name,
                        result,
                        duration: Date.now() - callStart,
                        success: true
                    }
                } catch (error) {
                    return {
                        name: call.name,
                        error: error.message,
                        duration: Date.now() - callStart,
                        success: false
                    }
                }
            })
        )

        const totalDuration = Date.now() - startTime
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length

        logger.info(`[MCP] 并行执行完成: ${successCount}/${toolCalls.length} 成功, 耗时 ${totalDuration}ms`)

        return results.map(r => r.status === 'fulfilled' ? r.value : {
            name: 'unknown',
            error: r.reason?.message || 'Unknown error',
            duration: 0,
            success: false
        })
    }

    /**
     * 批量执行工具调用（智能调度：无依赖的并行，有依赖的串行）
     * @param {Array<{name: string, args: Object, dependsOn?: string[]}>} toolCalls
     * @param {Object} options
     * @returns {Promise<Map<string, any>>} 工具名 -> 结果 的映射
     */
    async callToolsBatch(toolCalls, options = {}) {
        const results = new Map()
        const pending = [...toolCalls]
        const completed = new Set()

        while (pending.length > 0) {
            // 找出所有无依赖或依赖已完成的调用
            const ready = pending.filter(call => {
                if (!call.dependsOn || call.dependsOn.length === 0) return true
                return call.dependsOn.every(dep => completed.has(dep))
            })

            if (ready.length === 0 && pending.length > 0) {
                // 存在循环依赖，强制执行剩余的
                logger.warn('[MCP] 检测到可能的循环依赖，强制执行剩余工具')
                ready.push(pending[0])
            }

            // 从 pending 中移除 ready 的调用
            for (const call of ready) {
                const idx = pending.indexOf(call)
                if (idx !== -1) pending.splice(idx, 1)
            }

            // 并行执行 ready 的调用
            const batchResults = await this.callToolsParallel(ready, options)

            // 收集结果
            for (const result of batchResults) {
                results.set(result.name, result)
                completed.add(result.name)
            }
        }

        return results
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
     * 热重载 JS 工具
     * 用于在前端修改 JS 工具源码后重新加载
     */
    async reloadJsTools() {
        try {
            // 移除旧的 JS 工具
            for (const [name, tool] of this.tools) {
                if (tool.isJsTool) {
                    this.tools.delete(name)
                }
            }

            // 重新加载 JS 工具
            await builtinMcpServer.loadJsTools()

            // 将新的 JS 工具添加到工具列表
            for (const [name, tool] of builtinMcpServer.jsTools) {
                this.tools.set(name, {
                    name: tool.name || name,
                    description: tool.description || '自定义 JS 工具',
                    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
                    serverName: 'custom-tools',
                    isJsTool: true
                })
            }

            // 更新自定义工具服务器
            const customServer = this.servers.get('custom-tools')
            if (customServer) {
                customServer.tools = Array.from(builtinMcpServer.jsTools.values()).map(t => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema
                }))
            }

            logger.info(`[MCP] 热重载完成: ${builtinMcpServer.jsTools.size} 个 JS 工具`)
            return builtinMcpServer.jsTools.size
        } catch (error) {
            logger.error('[MCP] JS 工具热重载失败:', error)
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
