import { chatLogger } from '../core/utils/logger.js'
const logger = chatLogger
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

/**
 * @description 管理内置工具、自定义JS工具、外部MCP服务器
 * 支持工具调用、资源读取、提示词管理等功能
 *
 * @example
 * ```js
 * await mcpManager.init()
 * const tools = mcpManager.getTools()
 * const result = await mcpManager.callTool('get_time', {})
 * ```
 */
export class McpManager {
    constructor() {
        /** @type {Map<string, Object>} 工具名称 -> 工具定义 */
        this.tools = new Map()
        /** @type {Map<string, Object>} 服务器名称 -> 服务器信息 */
        this.servers = new Map()
        /** @type {Map<string, Object>} 资源URI -> 资源信息 */
        this.resources = new Map()
        /** @type {Map<string, Object>} 提示词名称 -> 提示词信息 */
        this.prompts = new Map()
        /** @type {Map<string, Object>} 工具结果缓存 */
        this.toolResultCache = new Map()
        /** @type {Array<Object>} 工具调用日志 */
        this.toolLogs = []
        /** @type {number} 最大日志数量 */
        this.maxLogs = 1000
        /** @type {boolean} 是否已初始化 */
        this.initialized = false
        /** @type {Promise|null} 初始化 Promise（用于防止并发初始化） */
        this.initPromise = null
        /** @type {Object} 服务器配置 */
        this.serversConfig = { servers: {} }
    }

    /**
     * 获取内置 MCP 服务器实例
     */
    get builtinServer() {
        return builtinMcpServer
    }

    /**
     * 加载 MCP 服务器配置
     * 如果配置文件不存在，自动创建默认配置
     */
    loadServersConfig() {
        try {
            // 确保目录存在
            const dir = path.dirname(MCP_SERVERS_FILE)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
                logger.info('[MCP] 创建配置目录:', dir)
            }

            // 如果文件不存在，创建默认配置
            if (!fs.existsSync(MCP_SERVERS_FILE)) {
                this.serversConfig = { servers: {} }
                this.saveServersConfig()
                logger.info('[MCP] 创建默认配置文件:', MCP_SERVERS_FILE)
                return this.serversConfig
            }

            const content = fs.readFileSync(MCP_SERVERS_FILE, 'utf-8')
            this.serversConfig = JSON.parse(content)
            if (!this.serversConfig.servers) {
                this.serversConfig.servers = {}
            }
        } catch (error) {
            logger.error('[MCP] 加载服务器配置失败:', error.message)
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
            logger.info('[MCP] 服务器配置已保存')
        } catch (error) {
            logger.error('[MCP] 保存服务器配置失败:', error.message)
        }
    }
    async init() {
        // 如果已初始化，直接返回
        if (this.initialized) return

        // 如果正在初始化，等待完成
        if (this.initPromise) {
            return await this.initPromise
        }

        // 开始初始化，设置 Promise 锁
        this.initPromise = this._doInit()
        try {
            await this.initPromise
        } finally {
            this.initPromise = null
        }
    }

    async _doInit() {
        if (this.initialized) return

        await this.initBuiltinServer()
        await this.initCustomToolsServer()

        const mcpConfig = config.get('mcp')
        if (!mcpConfig?.enabled) {
            logger.info('[MCP] 外部MCP已禁用，仅使用内置工具')
            this.initialized = true
            return
        }

        await this.loadServers()
        this.initialized = true
    }

    /**
     * 完全重新初始化 MCP 模块
     * 清除所有状态并重新加载所有工具
     * @returns {Promise<{success: boolean, tools: number, servers: number}>}
     */
    async reinit() {
        logger.info('[MCP] 开始完全重新初始化...')

        // 停止文件监听器
        builtinMcpServer.stopFileWatcher()

        // 断开所有外部服务器连接
        for (const [name, server] of this.servers) {
            if (!server.isBuiltin && !server.isCustomTools && server.client) {
                try {
                    await server.client.disconnect()
                } catch (e) {
                    logger.debug(`[MCP] 断开服务器 ${name} 失败:`, e.message)
                }
            }
        }

        // 清除所有状态
        this.tools.clear()
        this.servers.clear()
        this.resources.clear()
        this.prompts.clear()
        this.toolResultCache.clear()
        this.initialized = false
        this.initPromise = null

        // 重置 BuiltinMcpServer 状态
        builtinMcpServer.initialized = false
        builtinMcpServer.tools = []
        builtinMcpServer.modularTools = []
        builtinMcpServer.jsTools.clear()
        builtinMcpServer.toolCategories = {}

        // 重新初始化
        await this.init()

        const toolCount = this.tools.size
        const serverCount = this.servers.size

        logger.info(`[MCP] 重新初始化完成: ${toolCount} 个工具, ${serverCount} 个服务器`)

        return {
            success: true,
            tools: toolCount,
            servers: serverCount
        }
    }
    async initBuiltinServer() {
        try {
            await builtinMcpServer.init()
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
        } catch (error) {
            logger.error('[MCP] 初始化内置服务器失败:', error)
        }
    }
    async initCustomToolsServer() {
        try {
            const allTools = builtinMcpServer.listTools()
            const jsTools = allTools.filter(t => t.isJsTool)

            if (jsTools.length === 0) {
                logger.info('[MCP] 在data/tools中未找到自定义JS工具')
                return
            }
            for (const tool of jsTools) {
                this.tools.set(tool.name, {
                    ...tool,
                    serverName: 'custom-tools',
                    isBuiltin: false,
                    isJsTool: true
                })
            }
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
            logger.error('[MCP] 初始化自定义工具服务器失败:', error)
        }
    }

    /**
     * 设置工具上下文（用于内置工具）
     */
    setToolContext(ctx) {
        setBuiltinToolContext(ctx)
    }
    async loadServers() {
        // 从 JSON 文件加载配置
        this.loadServersConfig()
        const servers = this.serversConfig.servers || {}

        const serverNames = Object.keys(servers)
        if (serverNames.length === 0) {
            logger.info('[MCP] 未配置外部MCP服务器')
            return
        }

        logger.info(`[MCP] Loading ${serverNames.length} external server(s): ${serverNames.join(', ')}`)
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

    /**
     * 规范化服务器配置
     * 支持两种格式:
     * 1. 扁平格式: { type: 'http', url: '...' }
     * 2. transport嵌套格式: { transport: { type: 'http', url: '...' } }
     */
    normalizeServerConfig(serverConfig) {
        if (!serverConfig) return serverConfig

        // 如果有 transport 嵌套，提取出来
        if (serverConfig.transport && typeof serverConfig.transport === 'object') {
            const { transport, ...rest } = serverConfig
            return {
                ...transport,
                ...rest // 保留其他顶层字段如 env, headers 等
            }
        }

        return serverConfig
    }

    async connectServer(name, serverConfig) {
        try {
            // 规范化配置格式
            const normalizedConfig = this.normalizeServerConfig(serverConfig)
            logger.debug(`[MCP] Connecting to ${name} with config:`, JSON.stringify(normalizedConfig))

            if (name === 'builtin') {
                await this.initBuiltinServer()
                return { success: true, tools: this.servers.get('builtin')?.tools?.length || 0 }
            }

            if (name === 'custom-tools' || normalizedConfig?.type === 'custom') {
                await builtinMcpServer.loadJsTools()
                await this.initCustomToolsServer()
                return { success: true, tools: this.servers.get('custom-tools')?.tools?.length || 0 }
            }

            // Disconnect existing server if any
            if (this.servers.has(name)) {
                await this.disconnectServer(name)
            }

            const client = new McpClient(normalizedConfig)
            await client.connect()
            logger.debug(`[MCP] Client connected for ${name}, fetching tools...`)

            // Fetch tools
            const tools = await client.listTools()
            logger.debug(`[MCP] Fetched ${tools.length} tools from ${name}`)

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
                config: normalizedConfig,
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

            logger.info(
                `[MCP] Connected to server: ${name}, loaded ${tools.length} tools, ${resources.length} resources, ${prompts.length} prompts`
            )
            return { success: true, tools: tools.length, resources: resources.length, prompts: prompts.length }
        } catch (err) {
            logger.error(`[MCP] Failed to connect to server ${name}: ${err.message}`, err.stack)
            this.servers.set(name, {
                status: 'error',
                config: this.normalizeServerConfig(serverConfig),
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
     * @param {Object} options - 过滤选项
     * @param {boolean} options.applyConfig - 是否应用配置过滤，默认true
     * @returns {Array} List of tools
     */
    getTools(options = {}) {
        const { applyConfig = true } = options
        const builtinConfig = config.get('builtinTools') || { enabled: true }

        let tools = []
        for (const [name, tool] of this.tools) {
            tools.push({
                name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                serverName: tool.serverName,
                isBuiltin: tool.isBuiltin,
                isJsTool: tool.isJsTool,
                isCustom: tool.isCustom
            })
        }

        // 应用配置过滤
        if (applyConfig) {
            // 过滤禁用的工具
            if (builtinConfig.disabledTools?.length > 0) {
                tools = tools.filter(t => !builtinConfig.disabledTools.includes(t.name))
            }

            // 过滤危险工具（如果不允许）
            if (!builtinConfig.allowDangerous) {
                const dangerous = builtinConfig.dangerousTools || []
                tools = tools.filter(t => !dangerous.includes(t.name))
            }

            // 过滤允许的工具（白名单模式）
            if (builtinConfig.allowedTools?.length > 0) {
                tools = tools.filter(
                    t => builtinConfig.allowedTools.includes(t.name) || t.isJsTool || t.isCustom // JS工具和自定义工具不受白名单限制
                )
            }
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
        if (!tool) {
            await this.init()
            tool = this.tools.get(name)
        }
        if (!tool) {
            const builtinTools = builtinMcpServer.listTools()
            const builtinTool = builtinTools.find(t => t.name === name)
            if (builtinTool) {
                tool = { ...builtinTool, isBuiltin: true, serverName: 'builtin' }
            }
        }
        if (!tool && builtinMcpServer.jsTools?.has(name)) {
            tool = { name, isJsTool: true, serverName: 'custom-tools' }
        }
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

        // 危险工具拦截检查
        const builtinConfig = config.get('builtinTools') || {}
        const dangerousTools = builtinConfig.dangerousTools || []
        if (dangerousTools.includes(name) && !builtinConfig.allowDangerous) {
            logger.warn(`[MCP] 危险工具被拦截: ${name}`)
            return {
                content: [
                    {
                        type: 'text',
                        text: `工具 "${name}" 被标记为危险工具，已被拦截。如需使用，请在配置中启用 allowDangerous。`
                    }
                ],
                isError: true,
                isDangerousBlocked: true
            }
        }

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
            const argsPreview = this.truncateArgs(args)
            logger.debug(`[MCP] Calling: ${name} ${argsPreview}`)
            let result
            const useBuiltin =
                tool.isBuiltin ||
                tool.isJsTool ||
                tool.isCustom ||
                tool.serverName === 'builtin' ||
                tool.serverName === 'custom-tools'

            if (useBuiltin) {
                result = await builtinMcpServer.callTool(name, args, options.context)
            } else {
                const server = this.servers.get(tool.serverName)
                if (!server || !server.client) {
                    throw new Error(`Server not available for tool: ${name}`)
                }
                result = await server.client.callTool(name, args)
                const duration = Date.now() - startTime
                const isError = result?.isError === true || result?.success === false
                try {
                    const { statsService } = await import('../services/stats/StatsService.js')
                    if (statsService) {
                        await statsService.recordToolCallFull({
                            toolName: name,
                            request: args,
                            response: result,
                            success: !isError,
                            error: isError ? result?.errorMessage || result?.error || 'Tool error' : null,
                            duration,
                            userId: options.userId || options.context?.userId,
                            groupId: options.context?.groupId,
                            source: `mcp:${tool.serverName}`
                        })
                    }
                } catch (statsErr) {
                    logger.debug(`[MCP] Failed to record tool call stats: ${statsErr.message}`)
                }
            }

            // 检查结果是否为错误（包括权限不足、工具禁用等情况）
            const isResultError =
                result?.isError === true ||
                result?.success === false ||
                result?.permissionDenied === true ||
                result?.toolDisabled === true

            if (options.useCache && !isResultError) {
                // 只缓存成功的结果
                const cacheKey = `${name}:${JSON.stringify(args)}`
                this.toolResultCache.set(cacheKey, {
                    result,
                    timestamp: Date.now()
                })
            }

            // 根据结果内容判断是否成功
            logEntry.success = !isResultError
            logEntry.duration = Date.now() - startTime
            logEntry.result = result
            if (isResultError) {
                logEntry.error = result?.errorMessage || result?.error || 'Tool returned error result'
            }
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
        const toolNames = toolCalls.map(t => t.name).join(', ')
        logger.debug(`[MCP] 并行执行: ${toolNames}`)
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
            toolCalls.map(async call => {
                const callStart = Date.now()
                try {
                    const result = await this.callTool(call.name, call.args, options)
                    // 检查结果是否为错误
                    const isResultError =
                        result?.isError === true ||
                        result?.success === false ||
                        result?.permissionDenied === true ||
                        result?.toolDisabled === true
                    return {
                        name: call.name,
                        result,
                        duration: Date.now() - callStart,
                        success: !isResultError,
                        isError: isResultError,
                        errorMessage: isResultError ? result?.errorMessage || result?.error : undefined
                    }
                } catch (error) {
                    return {
                        name: call.name,
                        error: error.message,
                        duration: Date.now() - callStart,
                        success: false,
                        isError: true
                    }
                }
            })
        )

        const totalDuration = Date.now() - startTime
        const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length

        logger.debug(`[MCP] 并行完成: ${successCount}/${toolCalls.length}, ${totalDuration}ms`)

        return results.map(r =>
            r.status === 'fulfilled'
                ? r.value
                : {
                      name: 'unknown',
                      error: r.reason?.message || 'Unknown error',
                      duration: 0,
                      success: false
                  }
        )
    }

    /**
     * 批量执行工具调用
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
                logger.warn('[MCP] 检测到可能的循环依赖，强制执行剩余工具')
                ready.push(pending[0])
            }
            for (const call of ready) {
                const idx = pending.indexOf(call)
                if (idx !== -1) pending.splice(idx, 1)
            }
            const batchResults = await this.callToolsParallel(ready, options)
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
            logs = logs.filter(
                l =>
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
    }

    /**
     * 刷新内置工具列表
     */
    async refreshBuiltinTools() {
        for (const [name, tool] of this.tools) {
            if (tool.isBuiltin) {
                this.tools.delete(name)
            }
        }

        // 重新加载模块化工具（根据最新配置）
        await builtinMcpServer.loadModularTools()
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
            return builtinMcpServer.jsTools.size
        } catch (error) {
            logger.error('[MCP] JS 工具热重载失败:', error)
            throw error
        }
    }

    /**
     * 热重载所有工具
     * 通过完全重新初始化 MCP 模块来实现真正的热重载
     * @returns {Promise<{success: boolean, modularCount: number, jsCount: number, totalCount: number}>}
     */
    async reloadAllTools() {
        try {
            // 使用完全重新初始化来确保所有工具正确加载
            const result = await this.reinit()

            // 统计工具数量
            let modularCount = 0
            let jsCount = 0
            for (const [, tool] of this.tools) {
                if (tool.isJsTool) {
                    jsCount++
                } else if (tool.isBuiltin) {
                    modularCount++
                }
            }

            logger.info(`[MCP] 热重载完成: ${modularCount} 模块化工具, ${jsCount} JS工具`)
            return {
                success: true,
                modularCount,
                jsCount,
                totalCount: result.tools
            }
        } catch (error) {
            logger.error('[MCP] 热重载所有工具失败:', error)
            throw error
        }
    }

    /**
     * 一键启用所有内部工具
     * @returns {Promise<{success: boolean, enabledCount: number}>}
     */
    async enableAllTools() {
        try {
            const result = await builtinMcpServer.enableAllTools()
            await this.refreshBuiltinTools()
            return result
        } catch (error) {
            logger.error('[MCP] 一键启用工具失败:', error)
            throw error
        }
    }

    /**
     * 一键禁用所有内部工具
     * @returns {Promise<{success: boolean, disabledCount: number}>}
     */
    async disableAllTools() {
        try {
            const result = await builtinMcpServer.disableAllTools()
            await this.refreshBuiltinTools()
            return result
        } catch (error) {
            logger.error('[MCP] 一键禁用工具失败:', error)
            throw error
        }
    }

    /**
     * 切换工具类别启用状态
     * @param {string} category - 类别名称
     * @param {boolean} enabled - 是否启用
     */
    async toggleCategory(category, enabled) {
        try {
            const result = await builtinMcpServer.toggleCategory(category, enabled)
            await this.refreshBuiltinTools()
            return result
        } catch (error) {
            logger.error('[MCP] 切换工具类别失败:', error)
            throw error
        }
    }

    /**
     * 切换单个工具启用状态
     * @param {string} toolName - 工具名称
     * @param {boolean} enabled - 是否启用
     */
    async toggleTool(toolName, enabled) {
        try {
            const result = await builtinMcpServer.toggleTool(toolName, enabled)
            await this.refreshBuiltinTools()
            return result
        } catch (error) {
            logger.error('[MCP] 切换工具状态失败:', error)
            throw error
        }
    }

    /**
     * 获取工具启用状态统计
     * @returns {{total: number, enabled: number, disabled: number, categories: Object, jsTools: Object}}
     */
    getToolStats() {
        return builtinMcpServer.getToolStats()
    }

    /**
     * 截断参数用于日志显示
     * @param {Object} args - 工具参数
     * @param {number} maxLen - 最大长度
     * @returns {string} 截断后的参数预览
     */
    truncateArgs(args, maxLen = 100) {
        if (!args || Object.keys(args).length === 0) return ''
        try {
            let str = JSON.stringify(args)
            // 移除 base64 内容
            str = str.replace(/data:[^;]+;base64,[^"]+/g, '[base64]')
            // 截断长字符串
            if (str.length > maxLen) {
                str = str.substring(0, maxLen) + '...'
            }
            return str
        } catch {
            return '[args]'
        }
    }

    /**
     * Clear tool result cache
     */
    clearCache() {
        this.toolResultCache.clear()
        logger.debug('[MCP] Tool result cache cleared')
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

    /**
     * 判断是否启用调度优先模式
     * @returns {boolean}
     */
    isDispatchFirstEnabled() {
        return config.get('tools.dispatchFirst') !== false
    }

    /**
     * 获取工具分类摘要（用于展示）
     * @returns {Array<{name: string, description: string, toolCount: number}>}
     */
    getToolCategorySummary() {
        const categories = new Map()

        for (const [name, tool] of this.tools) {
            const category = tool.category || tool.serverName || 'builtin'
            if (!categories.has(category)) {
                categories.set(category, { name: category, tools: [] })
            }
            categories.get(category).tools.push(name)
        }

        return Array.from(categories.values()).map(cat => ({
            name: cat.name,
            toolCount: cat.tools.length
        }))
    }
}

export const mcpManager = new McpManager()
