/**
 * @fileoverview MCP (Model Context Protocol) 管理模块
 * @module mcp/McpManager
 * @description 统一管理内置工具、自定义JS工具和外部MCP服务器
 */

import { chatLogger } from '../core/utils/logger.js'
const logger = chatLogger
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import config from '../../config/config.js'
import { McpClient } from './McpClient.js'
import { builtinMcpServer, setBuiltinToolContext, resolveDangerousTools } from './BuiltinMcpServer.js'
import { getToolIdentity as getAdapterToolIdentity } from '../core/adapters/tooling.js'
import { sanitizeToolResultForLog } from '../core/utils/toolResult.js'
import {
    MCP_PROMPT_METADATA_FIELDS,
    MCP_RESOURCE_METADATA_FIELDS,
    MCP_RESOURCE_TEMPLATE_METADATA_FIELDS,
    MCP_TOOL_METADATA_FIELDS,
    copyMcpDefinitionMetadata
} from './McpProtocol.js'

export {
    MCP_PROMPT_METADATA_FIELDS,
    MCP_RESOURCE_METADATA_FIELDS,
    MCP_RESOURCE_TEMPLATE_METADATA_FIELDS,
    MCP_TOOL_METADATA_FIELDS,
    copyMcpDefinitionMetadata
} from './McpProtocol.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @constant {string} MCP服务器配置文件路径 */
const MCP_SERVERS_FILE = path.join(__dirname, '../../data/mcp-servers.json')

/** MCP 配置日志中的脱敏占位符。 */
const REDACTED_MCP_CONFIG_VALUE = '[REDACTED]'

/**
 * 判断配置键是否承载认证凭据。
 * @param {string} key - 原始键名
 * @returns {boolean} 是否需要隐藏对应值
 */
function isSensitiveConfigKey(key) {
    const words = String(key)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
    const compact = words.join('')
    if (
        words.some(word =>
            [
                'auth',
                'authorization',
                'authentication',
                'token',
                'password',
                'passwd',
                'secret',
                'cookie',
                'credential'
            ].includes(word)
        )
    ) {
        return true
    }
    if (words.includes('key')) return true
    return ['apikey', 'accesskey', 'privatekey', 'clientsecret', 'accesstoken', 'refreshtoken', 'bearertoken'].some(
        marker => compact.includes(marker)
    )
}

/**
 * 深度复制 MCP 配置并隐藏 headers/env 等容器内的认证字段。
 * @param {*} value - 待记录的配置值
 * @param {WeakSet<object>} [seen] - 循环引用保护
 * @returns {*} 可安全写入日志的副本
 */
export function redactMcpConfigForLog(value, seen = new WeakSet()) {
    if (value === null || value === undefined || typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    if (Array.isArray(value)) {
        return value.map(item => redactMcpConfigForLog(item, seen))
    }

    const redacted = {}
    for (const [key, item] of Object.entries(value)) {
        redacted[key] = isSensitiveConfigKey(key) ? REDACTED_MCP_CONFIG_VALUE : redactMcpConfigForLog(item, seen)
    }
    return redacted
}

/**
 * 校验并复制 MCP 配置文档，保证保存对象不与调用方共享可变引用。
 * @param {*} value - 配置文档
 * @returns {{servers: Record<string, Object>}} JSON 安全副本
 */
function normalizeServersDocument(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('MCP 服务器配置必须为 JSON 对象')
    }
    const servers = value.servers === undefined ? {} : value.servers
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
        throw new Error('MCP 服务器配置的 servers 必须为 JSON 对象')
    }
    let serialized
    try {
        serialized = JSON.stringify({ ...value, servers })
    } catch (error) {
        throw new Error(`MCP 服务器配置无法序列化: ${error.message}`)
    }
    return JSON.parse(serialized)
}

/**
 * 根据显式配置或 URL 端点推断 MCP 传输类型。
 *
 * `/sse` 与 `/message` 属于 2024-11-05 HTTP+SSE；`/mcp` 属于
 * Streamable HTTP。未知 URL 保持旧版默认 SSE，避免改变既有配置行为。
 * @param {*} serverConfig - MCP 服务器配置
 * @returns {string|undefined} 推断出的传输类型
 */
export function inferMcpServerType(serverConfig) {
    if (!serverConfig || typeof serverConfig !== 'object' || Array.isArray(serverConfig)) return undefined

    const explicitType = typeof serverConfig.type === 'string' ? serverConfig.type.toLowerCase() : ''
    if (['streamable-http', 'http', 'sse', 'stdio', 'npm', 'npx'].includes(explicitType)) return explicitType

    if (serverConfig.url) {
        let urlPath = String(serverConfig.url).toLowerCase()
        try {
            urlPath = new URL(urlPath).pathname.toLowerCase()
        } catch {
            urlPath = urlPath.split(/[?#]/, 1)[0]
        }
        if (urlPath.endsWith('/sse') || urlPath.endsWith('/message')) return 'sse'
        if (urlPath === '/mcp' || urlPath.endsWith('/mcp')) return 'streamable-http'
        return 'sse'
    }
    if (serverConfig.package) return 'npm'
    if (serverConfig.command) return 'stdio'
    return undefined
}

/**
 * 判断 URL 是否明确指向当前插件的 MCP 端点。
 * 仅凭路径包含 /chatai/mcp 会误伤远程服务；必须同时命中本机回环地址，
 * 或命中用户配置的 web.publicUrl / loginLinks 来源。
 * @param {*} value - MCP URL
 * @returns {boolean} 是否为当前插件自引用
 */
export function isSelfReferentialMcpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false
    let target
    try {
        target = new URL(value)
    } catch {
        return false
    }

    const mountSegments = String(config.get('web.mountPath') || '/chatai')
        .split('/')
        .filter(Boolean)
    const mountPath = mountSegments.length > 0 ? `/${mountSegments.join('/')}` : ''
    const targetPath = target.pathname.replace(/\/+$/, '') || '/'
    if (targetPath !== `${mountPath}/mcp`) return false

    const hostname = target.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) return true

    const configuredOrigins = [
        config.get('web.publicUrl'),
        ...(Array.isArray(config.get('web.loginLinks'))
            ? config.get('web.loginLinks').map(link => (typeof link === 'string' ? link : link?.baseUrl))
            : [])
    ]
    return configuredOrigins.some(origin => {
        if (typeof origin !== 'string' || !origin.trim()) return false
        try {
            return new URL(origin).origin.toLowerCase() === target.origin.toLowerCase()
        } catch {
            return false
        }
    })
}

/**
 * @class McpManager
 * @classdesc MCP管理器 - 统一管理工具调用、资源读取和提示词
 *
 * @description
 * 核心功能：
 * - **内置工具**: 50+内置实用工具（时间、天气、搜索、文件操作等）
 * - **自定义JS工具**: 支持用户自定义JavaScript工具
 * - **外部MCP服务器**: 支持连接外部MCP协议服务器
 * - **工具缓存**: 支持工具结果缓存，减少重复调用
 * - **工具日志**: 记录工具调用历史，便于调试
 *
 * @example
 * // 初始化并获取工具列表
 * await mcpManager.init()
 * const tools = mcpManager.getTools()
 *
 * // 调用工具
 * const result = await mcpManager.callTool('get_time', { timezone: 'Asia/Shanghai' })
 *
 * // 连接外部MCP服务器
 * await mcpManager.addServer('my-server', { command: 'npx', args: ['-y', '@my/mcp-server'] })
 */
/** 工具日志中单个字段序列化后保留的最大字符数 */
const TOOL_LOG_MAX_CHARS = 2000

/**
 * 全局工具注册表中不存在指定工具。
 * 路由层使用稳定错误码区分协议参数错误与工具执行错误。
 */
export class McpToolNotFoundError extends Error {
    /**
     * @param {string} toolName - 工具名称
     */
    constructor(toolName) {
        super(`Tool not found: ${toolName}`)
        this.name = 'McpToolNotFoundError'
        this.code = 'MCP_TOOL_NOT_FOUND'
        this.toolName = toolName
    }
}

/**
 * 命名空间工具名与显式服务器身份冲突。
 * 调用方不能通过额外的 serverName 覆盖 `mcp:<server>:<tool>` 中已经编码的来源。
 */
export class McpToolIdentityMismatchError extends Error {
    /**
     * @param {string} value - 原始命名空间名称
     * @param {string} embeddedServerName - 名称中编码的服务器
     * @param {string} explicitServerName - 调用方显式服务器
     */
    constructor(value, embeddedServerName, explicitServerName) {
        super(`MCP 工具身份冲突: ${value} 指向服务器 ${embeddedServerName}，但显式 serverName 为 ${explicitServerName}`)
        this.name = 'McpToolIdentityMismatchError'
        this.code = 'MCP_TOOL_IDENTITY_MISMATCH'
        this.value = value
        this.embeddedServerName = embeddedServerName
        this.explicitServerName = explicitServerName
    }
}

/**
 * MCP 资源不存在。
 * 路由层据此返回 JSON-RPC -32602，而不是把业务未命中误报为内部错误。
 */
export class McpResourceNotFoundError extends Error {
    /** @param {string} uri - 资源 URI */
    constructor(uri) {
        super(`Resource not found: ${uri}`)
        this.name = 'McpResourceNotFoundError'
        this.code = 'MCP_RESOURCE_NOT_FOUND'
        this.uri = uri
    }
}

/**
 * 压缩工具调用日志中的大字段，只保留可读摘要
 *
 * 绘图、语音、文件读取类工具会返回 base64，直接留存会让 1000 条日志占用 GB 级内存。
 * @param {*} value - 原始值（结果或入参）
 * @param {number} [maxChars] - 保留的最大字符数
 * @returns {*} 未超限时原样返回，超限时返回带长度提示的截断字符串
 */
function summarizeToolLogValue(value, maxChars = TOOL_LOG_MAX_CHARS) {
    if (value === null || value === undefined) return value
    if (typeof value === 'string') {
        return value.length > maxChars ? `${value.slice(0, maxChars)}…（共 ${value.length} 字符，已截断）` : value
    }
    if (typeof value !== 'object') return value

    let serialized
    try {
        serialized = JSON.stringify(value)
    } catch {
        return '[无法序列化的结果]'
    }
    if (serialized === undefined) return value
    if (serialized.length <= maxChars) return value
    return `${serialized.slice(0, maxChars)}…（共 ${serialized.length} 字符，已截断）`
}

export class McpManager {
    /**
     * @param {Object} [options] - 可注入依赖，生产环境使用默认实现
     * @param {string} [options.serversFile] - MCP 服务器配置文件
     * @param {typeof fs} [options.fileSystem] - 文件系统实现
     * @param {(config:Object) => McpClient} [options.clientFactory] - MCP 客户端工厂
     * @param {Object} [options.logger] - 日志实现
     */
    constructor(options = {}) {
        /** @type {Map<string, Object>} 工具名称 -> 工具定义 */
        this.tools = new Map()
        /** @type {Map<string, Object>} 工具身份(server:name) -> 工具定义 */
        this.toolIdentities = new Map()
        /** @type {Map<string, Object>} 服务器名称 -> 服务器信息 */
        this.servers = new Map()
        /** @type {Map<string, Object>} 资源URI -> 资源信息 */
        this.resources = new Map()
        /** @type {Map<string, Object>} 资源身份(server:uri) -> 资源信息 */
        this.resourceIdentities = new Map()
        /** @type {Map<string, Object>} 资源模板 URI 模式 -> 模板信息 */
        this.resourceTemplates = new Map()
        /** @type {Map<string, Object>} 资源模板身份(server:uriTemplate) -> 模板信息 */
        this.resourceTemplateIdentities = new Map()
        /** @type {Map<string, Object>} 提示词名称 -> 提示词信息 */
        this.prompts = new Map()
        /** @type {Map<string, Object>} 提示词身份(server:name) -> 提示词信息 */
        this.promptIdentities = new Map()
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
        /** @type {Map<string, Promise>} 服务器连接 Promise（用于防止同名服务器并发连接） */
        this.serverConnectPromises = new Map()
        /** @type {Object} 服务器配置 */
        this.serversConfig = { servers: {} }
        /** @type {string} MCP 服务器配置文件 */
        this.serversFile = path.resolve(options.serversFile || MCP_SERVERS_FILE)
        /** @type {typeof fs} 配置持久化使用的文件系统实现 */
        this.fileSystem = options.fileSystem || fs
        /** @type {(config:Object) => McpClient} MCP 客户端工厂 */
        this.clientFactory = options.clientFactory || (clientConfig => new McpClient(clientConfig))
        /** @type {Object} 可注入日志实现 */
        this.configLogger = options.logger || logger
        /** @type {Promise<number>|null} JS 工具单飞重载 */
        this.jsToolsReloadPromise = null
        /** @type {number} 工具注册表版本 */
        this.toolRegistryVersion = 0
        /** @type {number} 进程内工具尝试开始顺序 */
        this.toolAttemptSequence = 0
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
        const fileSystem = this.fileSystem
        const dir = path.dirname(this.serversFile)
        if (!fileSystem.existsSync(dir)) {
            fileSystem.mkdirSync(dir, { recursive: true, mode: 0o700 })
            this.configLogger.debug('[MCP] 创建配置目录:', dir)
        }

        if (!fileSystem.existsSync(this.serversFile)) {
            const initial = { servers: {} }
            this.saveServersConfig(initial)
            this.configLogger.debug('[MCP] 创建默认配置文件:', this.serversFile)
            return this.serversConfig
        }

        try {
            const content = fileSystem.readFileSync(this.serversFile, 'utf-8')
            const parsed = normalizeServersDocument(JSON.parse(content))
            // 既有文件也收紧权限；失败必须暴露，避免继续把凭据保留为宽权限。
            fileSystem.chmodSync(this.serversFile, 0o600)
            this.serversConfig = parsed
            return this.serversConfig
        } catch (error) {
            this.configLogger.error('[MCP] 加载服务器配置失败:', error.message)
            throw new Error(`加载 MCP 服务器配置失败: ${error.message}`)
        }
    }

    /**
     * 保存 MCP 服务器配置
     */
    saveServersConfig(nextConfig = this.serversConfig) {
        const normalized = normalizeServersDocument(nextConfig)
        const serialized = JSON.stringify(normalized, null, 2)
        const fileSystem = this.fileSystem
        const dir = path.dirname(this.serversFile)
        if (!fileSystem.existsSync(dir)) {
            fileSystem.mkdirSync(dir, { recursive: true, mode: 0o700 })
        }

        const temporaryPath = path.join(
            dir,
            `.${path.basename(this.serversFile)}.${process.pid}-${crypto.randomUUID()}.tmp`
        )
        let descriptor = null
        try {
            descriptor = fileSystem.openSync(temporaryPath, 'wx', 0o600)
            fileSystem.writeFileSync(descriptor, serialized, 'utf8')
            fileSystem.fsyncSync(descriptor)
            fileSystem.closeSync(descriptor)
            descriptor = null
            fileSystem.chmodSync(temporaryPath, 0o600)
            fileSystem.renameSync(temporaryPath, this.serversFile)
        } catch (error) {
            if (descriptor !== null) {
                try {
                    fileSystem.closeSync(descriptor)
                } catch {}
            }
            try {
                fileSystem.rmSync(temporaryPath, { force: true })
            } catch {}
            try {
                this.configLogger.error('[MCP] 保存服务器配置失败:', error.message)
            } catch {}
            throw new Error(`保存 MCP 服务器配置失败: ${error.message}`)
        }
        this.serversConfig = normalized
        try {
            this.configLogger.debug('[MCP] 服务器配置已原子保存')
        } catch {}
        return this.serversConfig
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

        const mcpConfig = config.get('mcp')
        const externalEnabled = mcpConfig?.enabled

        /*
         * initCustomToolsServer 必须等 initBuiltinServer 完成后再执行：
         * 它的第一行 builtinMcpServer.listTools() 是同步调用，若与内置服务器初始化并发，
         * 会在后者首个 await 让出控制权的瞬间读到空的 modularTools，
         * 于是 jsTools.length === 0 直接 return —— data/tools 下的自定义 JS 工具
         * 永远不会注册进 this.tools，模型完全看不到它们（只留一条 debug 日志）。
         */
        await this.initBuiltinServer()

        // 外部 MCP 服务器与自定义 JS 工具之间无依赖，可并行
        const tasks = [this.initCustomToolsServer()]
        if (externalEnabled) {
            tasks.push(this.loadServersWithLog())
        }

        await Promise.all(tasks)

        if (!externalEnabled) {
            logger.debug('[MCP] 外部MCP已禁用，仅使用内置工具')
        }

        this.initialized = true
    }

    /**
     * 加载外部服务器并记录日志
     */
    async loadServersWithLog() {
        try {
            const beforeCount = this.tools.size
            await this.loadServers()
            const afterCount = this.tools.size
            const newTools = afterCount - beforeCount
            if (newTools > 0) {
                logger.info(`[MCP] 外部服务器加载完成: +${newTools} 个工具`)
            }
        } catch (error) {
            logger.error('[MCP] 加载外部服务器失败:', error.message)
        }
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
        this.toolIdentities.clear()
        this.servers.clear()
        this.resources.clear()
        this.resourceIdentities.clear()
        this.resourceTemplates.clear()
        this.resourceTemplateIdentities.clear()
        this.prompts.clear()
        this.promptIdentities.clear()
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
                const normalizedTool = this.withToolSourceMeta({
                    ...tool,
                    serverName: 'builtin',
                    isBuiltin: !tool.isCustom,
                    isCustom: tool.isCustom || false
                })
                this.registerTool(normalizedTool)
            }
            this.servers.set('builtin', {
                status: 'connected',
                config: { type: 'builtin' },
                client: null,
                tools: builtinTools,
                resources: [],
                resourceTemplates: [],
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
                logger.debug('[MCP] 在data/tools中未找到自定义JS工具')
                return
            }
            for (const tool of jsTools) {
                const normalizedTool = this.withToolSourceMeta({
                    ...tool,
                    serverName: 'custom-tools',
                    isBuiltin: false,
                    isJsTool: true,
                    isCustom: true
                })
                this.registerTool(normalizedTool)
            }
            this.servers.set('custom-tools', {
                status: 'connected',
                config: { type: 'custom', path: 'data/tools' },
                client: null,
                tools: jsTools,
                resources: [],
                resourceTemplates: [],
                prompts: [],
                connectedAt: Date.now(),
                isBuiltin: false,
                isCustomTools: true
            })

            logger.debug(`[MCP] Custom tools server initialized with ${jsTools.length} tools`)
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
            logger.debug('[MCP] 未配置外部MCP服务器')
            return
        }

        logger.debug(`[MCP] Loading ${serverNames.length} external server(s): ${serverNames.join(', ')}`)
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
        logger.debug(`[MCP] Loaded ${success}/${serverNames.length} external servers`)
    }

    /**
     * 规范化服务器配置
     * 支持两种格式:
     * 1. 扁平格式: { type: 'http', url: '...' }
     * 2. transport嵌套格式: { transport: { type: 'http', url: '...' } }
     */
    inferServerType(serverConfig) {
        return inferMcpServerType(serverConfig)
    }

    normalizeNpxServerConfig(serverConfig) {
        if (!serverConfig) return serverConfig

        const command = String(serverConfig.command || '').toLowerCase()
        const isNpxCommand = command === 'npx' || command === 'npx.cmd'
        const type = String(serverConfig.type || '').toLowerCase()
        if (!isNpxCommand || (type && type !== 'stdio' && type !== 'npx')) {
            return serverConfig
        }

        const originalArgs = Array.isArray(serverConfig.args) ? serverConfig.args : []
        const args = [...originalArgs]
        while (args[0] === '-y' || args[0] === '--yes' || args[0] === '--prefer-offline') {
            args.shift()
        }

        const pkg = args.shift()
        if (!pkg || String(pkg).startsWith('-')) {
            return serverConfig
        }

        const rest = { ...serverConfig }
        delete rest.command
        return {
            ...rest,
            // 显式 npx 类型保留原类型；两者在 McpClient 中都走同一
            // npx 启动器，但保留值可让面板/配置回显不发生语义漂移。
            type: type === 'npx' ? 'npx' : 'npm',
            package: pkg,
            args
        }
    }

    normalizeServerConfig(serverConfig) {
        if (!serverConfig) return serverConfig

        // 如果有 transport 嵌套，提取出来
        let config = serverConfig
        if (serverConfig.transport && typeof serverConfig.transport === 'object') {
            const { transport, ...rest } = serverConfig
            config = {
                ...transport,
                ...rest // 保留其他顶层字段如 env, headers 等
            }
        }

        const normalized = { ...config }
        const inferredType = this.inferServerType(normalized)
        normalized.type = (normalized.type || inferredType || 'stdio').toLowerCase()

        // 如果显式配置了 streamable-http，保留该类型
        if (config.type === 'streamable-http' || config.type === 'http') {
            normalized.type = config.type
        }

        return this.normalizeNpxServerConfig(normalized)
    }

    async connectServer(name, serverConfig) {
        if (this.serverConnectPromises.has(name)) {
            await this.serverConnectPromises.get(name)
        }

        const connectPromise = this._connectServer(name, serverConfig)
        this.serverConnectPromises.set(name, connectPromise)
        try {
            return await connectPromise
        } finally {
            if (this.serverConnectPromises.get(name) === connectPromise) {
                this.serverConnectPromises.delete(name)
            }
        }
    }

    async _connectServer(name, serverConfig) {
        let client = null
        try {
            // 规范化配置格式
            const normalizedConfig = this.normalizeServerConfig(serverConfig)
            this.configLogger.debug(
                `[MCP] Connecting to ${name} with config:`,
                JSON.stringify(redactMcpConfigForLog(normalizedConfig))
            )

            if (name === 'builtin') {
                await this.initBuiltinServer()
                return { success: true, tools: this.servers.get('builtin')?.tools?.length || 0 }
            }

            if (name === 'custom-tools' || normalizedConfig?.type === 'custom') {
                await builtinMcpServer.loadJsTools()
                await this.initCustomToolsServer()
                return { success: true, tools: this.servers.get('custom-tools')?.tools?.length || 0 }
            }

            // 既有连接必须在自引用判断前断开；否则把在线服务器更新为自引用配置时，
            // 会持久化新配置却继续运行旧客户端和旧工具。
            if (this.servers.has(name)) {
                await this.disconnectServer(name)
            }

            /*
             * 自引用检测：跳过指向本插件自身 MCP Server 端点的配置
             * 工具已通过内置服务器提供，自连接会导致启动时序 fetch failed。
             * 仍登记一个明确的 skipped 状态，使新增/更新接口和配置回显保持一致。
             */
            const serverUrl = normalizedConfig?.url || ''
            if (isSelfReferentialMcpUrl(serverUrl)) {
                logger.info(`[MCP] 跳过自引用服务器 ${name}: ${serverUrl} (工具已通过内置服务器提供)`)
                this.servers.set(name, {
                    status: 'skipped',
                    config: normalizedConfig,
                    client: null,
                    tools: [],
                    resources: [],
                    resourceTemplates: [],
                    prompts: [],
                    skipped: true
                })
                return { success: true, tools: 0, skipped: true }
            }

            client = this.clientFactory(normalizedConfig)
            await client.connect()
            logger.debug(`[MCP] Client connected for ${name}, fetching tools...`)

            // Fetch tools
            const tools = await client.listTools()
            logger.debug(`[MCP] Fetched ${tools.length} tools from ${name}`)

            // Fetch resources if supported
            let resources = []
            try {
                resources = await client.listResources()
            } catch {
                // Resources not supported, ignore
            }

            // Fetch prompts if supported
            let prompts = []
            try {
                prompts = await client.listPrompts()
            } catch {
                // Prompts not supported, ignore
            }

            // 资源模板是 resources 能力下的可选清单；旧版客户端没有该方法时
            // 保持空列表，不能阻断其它工具/资源的连接。
            let resourceTemplates = []
            if (typeof client.listResourceTemplates === 'function') {
                try {
                    const listedTemplates = await client.listResourceTemplates()
                    resourceTemplates = Array.isArray(listedTemplates) ? listedTemplates : []
                } catch {
                    // Resource templates not supported, ignore
                }
            }

            this.servers.set(name, {
                status: 'connected',
                config: normalizedConfig,
                client,
                tools,
                resources,
                resourceTemplates,
                prompts,
                connectedAt: Date.now()
            })

            // Register tools
            for (const tool of tools) {
                const normalizedTool = this.withToolSourceMeta({
                    ...tool,
                    serverName: name,
                    isMcpTool: true
                })
                this.registerTool(normalizedTool)
            }

            // Register resources
            for (const resource of resources) {
                const normalizedResource = {
                    ...resource,
                    serverName: name
                }
                this.resources.set(resource.uri, normalizedResource)
                this.resourceIdentities.set(`${name}:${resource.uri}`, normalizedResource)
            }

            // 注册资源模板身份，供面板和聚合端保留同名/同模式来源。
            for (const resourceTemplate of resourceTemplates) {
                if (typeof resourceTemplate?.uriTemplate !== 'string' || !resourceTemplate.uriTemplate) continue
                const normalizedTemplate = {
                    ...resourceTemplate,
                    serverName: name
                }
                this.resourceTemplates.set(resourceTemplate.uriTemplate, normalizedTemplate)
                this.resourceTemplateIdentities.set(`${name}:${resourceTemplate.uriTemplate}`, normalizedTemplate)
            }

            // Register prompts
            for (const prompt of prompts) {
                const normalizedPrompt = {
                    ...prompt,
                    serverName: name
                }
                this.prompts.set(prompt.name, normalizedPrompt)
                this.promptIdentities.set(`${name}:${prompt.name}`, normalizedPrompt)
            }

            logger.debug(`[MCP] Connected to server: ${name}, loaded ${tools.length} tools`)
            return {
                success: true,
                tools: tools.length,
                resources: resources.length,
                resourceTemplates: resourceTemplates.length,
                prompts: prompts.length
            }
        } catch (err) {
            if (client) {
                try {
                    await client.disconnect()
                } catch (disconnectError) {
                    logger.warn(`[MCP] Error cleaning failed client for ${name}: ${disconnectError.message}`)
                }
            }
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
        if (!server) return

        try {
            for (const [, tool] of this.toolIdentities) {
                if (tool.serverName === name) {
                    this.unregisterTool(tool.name, tool)
                    this.clearToolCache(tool.name, name)
                }
            }
            for (const [uri, resource] of this.resources) {
                if (resource.serverName === name) {
                    this.resources.delete(uri)
                }
            }
            for (const [identity, resource] of this.resourceIdentities) {
                if (resource.serverName === name) this.resourceIdentities.delete(identity)
            }
            this.resources.clear()
            for (const resource of this.resourceIdentities.values()) {
                if (!this.resources.has(resource.uri)) this.resources.set(resource.uri, resource)
            }
            for (const [uriTemplate, resourceTemplate] of this.resourceTemplates) {
                if (resourceTemplate.serverName === name) this.resourceTemplates.delete(uriTemplate)
            }
            for (const [identity, resourceTemplate] of this.resourceTemplateIdentities) {
                if (resourceTemplate.serverName === name) this.resourceTemplateIdentities.delete(identity)
            }
            this.resourceTemplates.clear()
            for (const resourceTemplate of this.resourceTemplateIdentities.values()) {
                if (!this.resourceTemplates.has(resourceTemplate.uriTemplate)) {
                    this.resourceTemplates.set(resourceTemplate.uriTemplate, resourceTemplate)
                }
            }
            for (const [promptName, prompt] of this.prompts) {
                if (prompt.serverName === name) {
                    this.prompts.delete(promptName)
                }
            }
            for (const [identity, prompt] of this.promptIdentities) {
                if (prompt.serverName === name) this.promptIdentities.delete(identity)
            }
            // 同名提示词可能来自多个服务器；删除后重建名称索引，避免留下悬空实现。
            this.prompts.clear()
            for (const prompt of this.promptIdentities.values()) {
                if (!this.prompts.has(prompt.name)) this.prompts.set(prompt.name, prompt)
            }

            // Disconnect client
            if (server.client) {
                await server.client.disconnect()
            }

            this.servers.delete(name)
            logger.debug(`[MCP] Disconnected from server: ${name}`)
            return true
        } catch (error) {
            logger.error(`[MCP] Error disconnecting from server ${name}:`, error)
            this.servers.delete(name)
            return false
        }
    }

    getToolSource(tool) {
        if (!tool) return 'unknown'
        if (tool.source === 'builtin' || tool.source === 'custom' || tool.source === 'mcp') return tool.source
        if (tool.isMcpTool === true) return 'mcp'
        if (tool.isJsTool === true || tool.isCustom === true || tool.serverName === 'custom-tools') return 'custom'
        if (tool.isBuiltin === true || tool.serverName === 'builtin') return 'builtin'
        if (tool.serverName) return 'mcp'
        return 'unknown'
    }

    withToolSourceMeta(tool) {
        const source = this.getToolSource(tool)
        const normalizedTool = {
            ...tool,
            source,
            isBuiltin: source === 'builtin',
            isJsTool: tool.isJsTool === true,
            isCustom: source === 'custom',
            isMcpTool: source === 'mcp'
        }
        return {
            ...normalizedTool,
            identity: getAdapterToolIdentity(normalizedTool)
        }
    }

    getToolIdentity(name, serverName) {
        return serverName ? `${serverName}:${name}` : ''
    }

    parseToolIdentity(value) {
        if (typeof value !== 'string') return null
        const mcpMatch = value.match(/^mcp:([^:]+):(.+)$/)
        if (mcpMatch) {
            return { serverName: mcpMatch[1], name: mcpMatch[2] }
        }
        const directMatch = value.match(/^([^:]+):([^:]+)$/)
        if (directMatch) {
            return { serverName: directMatch[1], name: directMatch[2] }
        }
        return null
    }

    /**
     * 获取调用选项中的显式服务器身份。
     * @param {Object} options - 工具调用选项
     * @returns {string|undefined} 显式服务器名
     */
    getExplicitServerName(options = {}) {
        for (const key of ['serverName', 'server_label', 'server_name']) {
            const value = options?.[key]
            if (value !== undefined && value !== null && value !== '') return String(value)
        }
        return undefined
    }

    /**
     * 校验命名空间名称与显式服务器身份一致。
     * @param {string} value - 原始名称
     * @param {Object} options - 调用选项
     * @param {Object|null} parsedIdentity - 已解析身份
     * @returns {void}
     */
    assertToolIdentityMatch(value, options, parsedIdentity) {
        const explicitServerName = this.getExplicitServerName(options)
        if (parsedIdentity && explicitServerName !== undefined && explicitServerName !== parsedIdentity.serverName) {
            throw new McpToolIdentityMismatchError(value, parsedIdentity.serverName, explicitServerName)
        }
    }

    registerTool(tool) {
        if (!tool?.name) return
        this.tools.set(tool.name, tool)
        const identity = this.getToolIdentity(tool.name, tool.serverName)
        if (identity) this.toolIdentities.set(identity, tool)
    }

    unregisterTool(name, tool = null) {
        const existing = tool || this.tools.get(name)
        const identity = this.getToolIdentity(name, existing?.serverName)
        // 热重载/重连期间可能仍有旧对象晚到调用 unregisterTool。只有注册表中的
        // 对象仍是待删除对象时才移除身份，否则会误删同名的新实现。
        if (identity && this.toolIdentities.get(identity) === existing) this.toolIdentities.delete(identity)
        if (this.tools.get(name) === existing) {
            const replacement = Array.from(this.toolIdentities.values()).find(item => item.name === name)
            if (replacement) {
                this.tools.set(name, replacement)
            } else {
                this.tools.delete(name)
            }
        }
    }

    getRegisteredTool(name, options = {}) {
        const parsedIdentity = this.parseToolIdentity(name)
        this.assertToolIdentityMatch(name, options, parsedIdentity)
        const toolName = parsedIdentity?.name || name
        const serverName = this.getExplicitServerName(options) || parsedIdentity?.serverName
        const identity = this.getToolIdentity(toolName, serverName)
        if (identity && this.toolIdentities.has(identity)) {
            return this.toolIdentities.get(identity)
        }
        // 一旦调用方给出了服务器身份，找不到该精确身份就必须失败，不能
        // 回退到同名工具；否则 mcp:missing:foo 可能误执行另一服务器的 foo。
        if (identity) return null
        return this.tools.get(toolName) || null
    }

    /**
     * 清除指定工具的缓存
     * @param {string} toolName - 工具名称
     */
    clearToolCache(toolName, serverName = '') {
        // 遍历缓存，删除该工具的所有缓存条目
        const exactPrefix = serverName ? `${serverName}:${toolName}:` : null
        const legacyPrefix = `${toolName}:`
        const scopedSuffix = `:${toolName}:`
        for (const [cacheKey] of this.toolResultCache) {
            if (
                (exactPrefix && cacheKey.startsWith(exactPrefix)) ||
                (!exactPrefix && (cacheKey.startsWith(legacyPrefix) || cacheKey.includes(scopedSuffix)))
            ) {
                this.toolResultCache.delete(cacheKey)
            }
        }
    }

    /**
     * 清除指定服务器所有工具的缓存
     * @param {string} serverName - 服务器名称
     */
    clearServerCache(serverName) {
        for (const tool of this.toolIdentities.values()) {
            if (tool.serverName === serverName) {
                this.clearToolCache(tool.name, serverName)
            }
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
     * 清理一次失败连接留下的 error server 与工具注册。
     * @param {string} name - 服务器名称
     * @returns {Promise<void>}
     */
    async cleanupFailedServer(name) {
        if (this.servers.has(name)) {
            await this.disconnectServer(name)
        }
        this.servers.delete(name)
    }

    /**
     * 恢复配置变更前的服务器运行态。
     * @param {string} name - 服务器名称
     * @param {Object} serverSnapshot - 变更前服务器信息
     * @param {Object|null} configSnapshot - 变更前连接配置
     * @returns {Promise<void>}
     */
    async restoreServerSnapshot(name, serverSnapshot, configSnapshot) {
        await this.cleanupFailedServer(name)
        if (serverSnapshot?.isCustomTools) {
            await builtinMcpServer.loadJsTools()
            await this.initCustomToolsServer()
            return
        }
        if (serverSnapshot?.isBuiltin) {
            await this.initBuiltinServer()
            return
        }
        if (serverSnapshot?.status === 'connected' && configSnapshot) {
            await this.connectServer(name, configSnapshot)
            return
        }
        this.servers.set(name, serverSnapshot)
    }

    /**
     * 抛出原操作错误；恢复也失败时同时保留两条证据。
     * @param {string} action - 操作名称
     * @param {Error} operationError - 原操作错误
     * @param {Error|null} restoreError - 恢复错误
     * @throws {Error|AggregateError} 始终抛出
     */
    throwMutationError(action, operationError, restoreError = null) {
        if (!restoreError) throw operationError
        throw new AggregateError(
            [operationError, restoreError],
            `${action}失败，且恢复原 MCP 服务器连接失败: ${restoreError.message}`
        )
    }

    /**
     * Add a new server (or update if exists)
     */
    async addServer(name, serverConfig) {
        if (this.servers.has(name)) {
            return await this.updateServer(name, serverConfig)
        }

        const currentConfig = this.loadServersConfig()
        const normalizedConfig = this.normalizeServerConfig(serverConfig)
        try {
            await this.connectServer(name, normalizedConfig)
        } catch (error) {
            await this.cleanupFailedServer(name)
            throw error
        }

        const nextConfig = normalizeServersDocument(currentConfig)
        nextConfig.servers[name] = normalizedConfig
        try {
            this.saveServersConfig(nextConfig)
        } catch (error) {
            await this.cleanupFailedServer(name)
            throw error
        }
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

        const currentConfig = this.loadServersConfig()
        const oldConfig = currentConfig.servers[name] || server.config || null
        const serverSnapshot = { ...server }
        const normalizedConfig = this.normalizeServerConfig(serverConfig)

        try {
            await this.connectServer(name, normalizedConfig)
        } catch (operationError) {
            let restoreError = null
            try {
                await this.restoreServerSnapshot(name, serverSnapshot, oldConfig)
            } catch (error) {
                restoreError = error
            }
            this.throwMutationError('更新 MCP 服务器', operationError, restoreError)
        }

        const nextConfig = normalizeServersDocument(currentConfig)
        nextConfig.servers[name] = normalizedConfig
        try {
            this.saveServersConfig(nextConfig)
        } catch (operationError) {
            let restoreError = null
            try {
                await this.restoreServerSnapshot(name, serverSnapshot, oldConfig)
            } catch (error) {
                restoreError = error
            }
            this.throwMutationError('保存 MCP 服务器更新', operationError, restoreError)
        }
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

        const currentConfig = this.loadServersConfig()
        const oldConfig = currentConfig.servers[name] || server.config || null
        const serverSnapshot = { ...server }
        await this.disconnectServer(name)

        const nextConfig = normalizeServersDocument(currentConfig)
        delete nextConfig.servers[name]
        try {
            this.saveServersConfig(nextConfig)
        } catch (operationError) {
            let restoreError = null
            try {
                await this.restoreServerSnapshot(name, serverSnapshot, oldConfig)
            } catch (error) {
                restoreError = error
            }
            this.throwMutationError('删除 MCP 服务器配置', operationError, restoreError)
        }

        return true
    }

    /**
     * Get all available tools
     * @param {Object} options - 过滤选项
     * @param {boolean} options.applyConfig - 是否应用配置过滤，默认true
     * @returns {Array} List of tools
     */
    getTools(options = {}) {
        const { applyConfig = true, includeDuplicateNames = false } = options
        const builtinConfig = config.get('builtinTools') || { enabled: true }

        let tools = []
        const sourceTools = includeDuplicateNames
            ? Array.from(this.toolIdentities.values())
            : Array.from(this.tools.values())
        for (const tool of sourceTools) {
            tools.push(
                this.withToolSourceMeta({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    serverName: tool.serverName,
                    isBuiltin: tool.isBuiltin,
                    isJsTool: tool.isJsTool,
                    isCustom: tool.isCustom,
                    isMcpTool: tool.isMcpTool,
                    source: tool.source,
                    dangerous: tool.dangerous,
                    requireMaster: tool.requireMaster,
                    requiredPermission: tool.requiredPermission,
                    requirePermission: tool.requirePermission,
                    permissionRequired: tool.permissionRequired,
                    ...copyMcpDefinitionMetadata(tool, MCP_TOOL_METADATA_FIELDS)
                })
            )
        }

        // 应用配置过滤
        if (applyConfig) {
            // 过滤禁用的工具
            if (builtinConfig.disabledTools?.length > 0) {
                tools = tools.filter(
                    t =>
                        !builtinConfig.disabledTools.includes(t.name) &&
                        !builtinConfig.disabledTools.includes(t.identity)
                )
            }

            // 过滤危险工具（如果不允许）
            // 与调用拦截层同源：配置里的 dangerousTools 通常是空数组而非 undefined，
            // `|| []` 救不回默认黑名单，会让危险工具照常暴露给模型，故同样取并集
            if (!builtinConfig.allowDangerous) {
                const dangerous = resolveDangerousTools(builtinConfig)
                tools = tools.filter(
                    t => t.dangerous !== true && !dangerous.includes(t.name) && !dangerous.includes(t.identity)
                )
            }

            // 过滤允许的工具（白名单模式）
            if (builtinConfig.allowedTools?.length > 0) {
                tools = tools.filter(
                    t =>
                        builtinConfig.allowedTools.includes(t.name) ||
                        builtinConfig.allowedTools.includes(t.identity) ||
                        t.isJsTool ||
                        t.isCustom // JS工具和自定义工具不受白名单限制
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
        const identityValues = Array.from(this.promptIdentities.values())
        const values = identityValues.length
            ? [...identityValues, ...Array.from(this.prompts.values()).filter(item => !identityValues.includes(item))]
            : Array.from(this.prompts.values())
        for (const prompt of values) {
            const name = prompt.name
            prompts.push({
                name,
                ...(prompt.description !== undefined ? { description: prompt.description } : {}),
                ...(prompt.arguments !== undefined ? { arguments: prompt.arguments } : {}),
                serverName: prompt.serverName,
                ...copyMcpDefinitionMetadata(prompt, MCP_PROMPT_METADATA_FIELDS)
            })
        }
        return prompts
    }

    /**
     * 列出全部提示词的标准别名。
     * 面板路由与 MCP 聚合路由都使用 listPrompts，统一走同一份身份索引，
     * 避免调用方各自读取旧的 prompts Map。
     * @returns {Array<Object>} 提示词清单
     */
    listPrompts() {
        return this.getPrompts()
    }

    /**
     * Get prompt content
     */
    async getPrompt(name, args = {}, serverName = undefined) {
        const parsedIdentity = this.parseToolIdentity(name)
        this.assertToolIdentityMatch(name, { serverName }, parsedIdentity)
        if (parsedIdentity) {
            serverName = parsedIdentity.serverName
            name = parsedIdentity.name
        }
        const prompt = serverName
            ? this.promptIdentities.get(`${serverName}:${name}`) ||
              Array.from(this.prompts.values()).find(item => item.name === name && item.serverName === serverName)
            : this.prompts.get(name)
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
    getTool(name, options = {}) {
        return this.getRegisteredTool(name, options)
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
                resourceTemplatesCount: info.resourceTemplates?.length || 0,
                promptsCount: info.prompts?.length || 0,
                connectedAt: info.connectedAt,
                error: info.error,
                isBuiltin: info.isBuiltin === true,
                isCustomTools: info.isCustomTools === true,
                skipped: info.skipped === true
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
            resourceTemplates: server.resourceTemplates || [],
            prompts: server.prompts || [],
            connectedAt: server.connectedAt,
            error: server.error,
            isBuiltin: server.isBuiltin === true,
            isCustomTools: server.isCustomTools === true,
            skipped: server.skipped === true
        }
    }

    /**
     * Get all resources
     */
    getResources() {
        const resources = []
        const identityValues = Array.from(this.resourceIdentities.values())
        const values = identityValues.length
            ? [...identityValues, ...Array.from(this.resources.values()).filter(item => !identityValues.includes(item))]
            : Array.from(this.resources.values())
        for (const resource of values) {
            const uri = resource.uri
            resources.push({
                uri,
                ...(resource.name !== undefined ? { name: resource.name } : {}),
                ...(resource.description !== undefined ? { description: resource.description } : {}),
                ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
                serverName: resource.serverName,
                ...copyMcpDefinitionMetadata(resource, MCP_RESOURCE_METADATA_FIELDS)
            })
        }
        return resources
    }

    /**
     * 获取全部资源模板清单。
     * @returns {Array<Object>} 资源模板定义
     */
    getResourceTemplates() {
        const templates = []
        const identityValues = Array.from(this.resourceTemplateIdentities.values())
        const values = identityValues.length
            ? [
                  ...identityValues,
                  ...Array.from(this.resourceTemplates.values()).filter(item => !identityValues.includes(item))
              ]
            : Array.from(this.resourceTemplates.values())
        for (const template of values) {
            templates.push({
                uriTemplate: template.uriTemplate,
                ...(template.name !== undefined ? { name: template.name } : {}),
                ...(template.description !== undefined ? { description: template.description } : {}),
                ...(template.mimeType !== undefined ? { mimeType: template.mimeType } : {}),
                serverName: template.serverName,
                ...copyMcpDefinitionMetadata(template, MCP_RESOURCE_TEMPLATE_METADATA_FIELDS)
            })
        }
        return templates
    }

    /**
     * Read resource content
     */
    async readResource(uri, serverName = undefined) {
        const resource = serverName
            ? this.resourceIdentities.get(`${serverName}:${uri}`) ||
              Array.from(this.resources.values()).find(item => item.uri === uri && item.serverName === serverName)
            : this.resources.get(uri)
        if (!resource) {
            throw new McpResourceNotFoundError(uri)
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
        const parsedIdentity = this.parseToolIdentity(name)
        this.assertToolIdentityMatch(name, options, parsedIdentity)
        if (parsedIdentity) {
            name = parsedIdentity.name
            options = {
                ...options,
                serverName: parsedIdentity.serverName
            }
        }
        const startTime = Date.now()
        const startOrder = ++this.toolAttemptSequence
        const attemptId = options.attemptId || `${startTime}-${Math.random().toString(36).slice(2, 11)}`
        let normalizedArgs = this.normalizeToolArgs(args)
        let tool = this.getTool(name, options)
        if (!tool) {
            await this.init()
            tool = this.getTool(name, options)
        }
        if (!tool) {
            const builtinTool = builtinMcpServer.listTools().find(item => item.name === name)
            if (builtinTool) tool = { ...builtinTool, isBuiltin: true, serverName: 'builtin' }
        }
        if (!tool && builtinMcpServer.jsTools?.has(name)) {
            const jsTool = builtinMcpServer.jsTools.get(name)
            tool = {
                name,
                isJsTool: true,
                isCustom: true,
                serverName: 'custom-tools',
                dangerous: jsTool?.dangerous === true,
                requireMaster: jsTool?.requireMaster === true
            }
        }
        if (!tool) {
            const customTool = builtinMcpServer.getCustomTools().find(item => item.name === name)
            if (customTool) tool = { ...customTool, isCustom: true, serverName: 'builtin' }
        }

        const event = options.context?.event || options.context?.getEvent?.() || null
        const userId = options.userId || event?.user_id || options.context?.userId || null
        const groupId =
            options.groupId || event?.group_id || options.context?.groupId || normalizedArgs?.group_id || null
        const toolSource = tool
            ? tool.isJsTool
                ? 'custom_js'
                : tool.isBuiltin || tool.isCustom || ['builtin', 'custom-tools'].includes(tool.serverName)
                  ? 'builtin_mcp'
                  : `mcp:${tool.serverName || 'unknown'}`
            : 'mcp_manager'
        let detailRecorded = false

        const recordDetail = async ({ result, success, error, source = toolSource }) => {
            if (detailRecorded || options.skipStats === true) return
            detailRecorded = true
            try {
                const { statsService } = await import('../services/stats/StatsService.js')
                await statsService.recordToolCallFull({
                    toolName: name || 'unknown_tool',
                    request: sanitizeToolResultForLog(normalizedArgs),
                    response: sanitizeToolResultForLog(result),
                    success,
                    error,
                    duration: Date.now() - startTime,
                    timestamp: startTime,
                    attemptId,
                    startOrder,
                    userId,
                    groupId,
                    source
                })
            } catch (statsError) {
                logger.debug(`[MCP] Failed to record tool call stats: ${statsError.message}`)
            }
        }

        const addLog = ({ result, success, error, source = toolSource }) => {
            this.addToolLog({
                toolName: name,
                arguments: sanitizeToolResultForLog(normalizedArgs),
                timestamp: startTime,
                attemptId,
                userId,
                groupId,
                source,
                success,
                duration: Date.now() - startTime,
                result: sanitizeToolResultForLog(result),
                error: error?.message || error || null
            })
        }

        if (!tool) {
            const error = new McpToolNotFoundError(name)
            addLog({ result: null, success: false, error, source: 'mcp_manager' })
            await recordDetail({ result: null, success: false, error, source: 'mcp_manager' })
            throw error
        }

        const builtinConfig = config.get('builtinTools') || {}
        const dangerousTools = resolveDangerousTools(builtinConfig)
        const toolIdentity = getAdapterToolIdentity(this.withToolSourceMeta(tool))
        const disabledTools = Array.isArray(builtinConfig.disabledTools) ? builtinConfig.disabledTools : []
        const recordPolicyFailure = async (result, message) => {
            const error = new Error(message)
            addLog({ result, success: false, error })
            await recordDetail({ result, success: false, error })
            return result
        }

        if (disabledTools.includes(name) || disabledTools.includes(toolIdentity)) {
            return await recordPolicyFailure(
                {
                    content: [{ type: 'text', text: `工具 "${name}" 已被管理员禁用，无法执行` }],
                    isError: true,
                    toolDisabled: true
                },
                '工具已被管理员禁用'
            )
        }

        if (tool.requireMaster === true && !this.hasMasterAuthority(options)) {
            return await recordPolicyFailure(
                {
                    content: [{ type: 'text', text: `工具 "${name}" 仅允许主人调用` }],
                    isError: true,
                    permissionDenied: true
                },
                '工具仅允许主人调用'
            )
        }

        const isDangerous =
            tool.dangerous === true || dangerousTools.includes(name) || dangerousTools.includes(toolIdentity)
        if (isDangerous && !builtinConfig.allowDangerous) {
            const result = {
                content: [
                    {
                        type: 'text',
                        text: `工具 "${name}" 被标记为危险工具，已被拦截。如需使用，请在配置中启用 allowDangerous。`
                    }
                ],
                isError: true,
                isDangerousBlocked: true
            }
            return await recordPolicyFailure(result, '危险工具未启用')
        }

        const cacheScope = options.serverName || options.server_label || options.server_name || tool.serverName || ''
        if (options.useCache) {
            const cacheKey = `${cacheScope}:${name}:${JSON.stringify(normalizedArgs)}`
            const cached = this.toolResultCache.get(cacheKey)
            if (cached && Date.now() - cached.timestamp < (options.cacheTTL || 60000)) {
                const result = cached.result
                addLog({ result, success: true, source: `${toolSource}:cache` })
                await recordDetail({ result, success: true, error: null, source: `${toolSource}:cache` })
                return result
            }
        }

        try {
            const argsPreview = this.truncateArgs(normalizedArgs)
            logger.debug(`[MCP] Calling: ${name} ${argsPreview}`)
            const useBuiltin =
                tool.isBuiltin ||
                tool.isJsTool ||
                tool.isCustom ||
                tool.serverName === 'builtin' ||
                tool.serverName === 'custom-tools'

            let result
            if (useBuiltin) {
                // 没有请求上下文时显式传 null；BuiltinMcpServer 会创建隔离上下文，
                // 避免 undefined 回退到上一条聊天残留的全局 ToolContext。
                const builtinContext =
                    options.context ??
                    (options.userPermission === 'master'
                        ? { event: null, bot: options.bot || global.Bot || null, isMaster: true }
                        : null)
                result = await builtinMcpServer.callTool(name, normalizedArgs, builtinContext, {
                    skipStats: true,
                    attemptId
                })
            } else {
                const server = this.servers.get(tool.serverName)
                if (!server || !server.client) {
                    throw new Error(`Server not available for tool: ${name}`)
                }
                result = await server.client.callTool(name, normalizedArgs, {
                    inputResponses: options.inputResponses,
                    requestState: options.requestState
                })
            }

            const isResultError =
                result?.isError === true ||
                result?.success === false ||
                result?.permissionDenied === true ||
                result?.toolDisabled === true

            if (options.useCache && !isResultError) {
                const cacheKey = `${cacheScope}:${name}:${JSON.stringify(normalizedArgs)}`
                this.toolResultCache.set(cacheKey, {
                    result,
                    timestamp: Date.now()
                })
            }

            const error = isResultError
                ? new Error(result?.errorMessage || result?.error || 'Tool returned error result')
                : null
            addLog({ result, success: !isResultError, error })
            await recordDetail({ result, success: !isResultError, error })
            return result
        } catch (error) {
            addLog({ result: null, success: false, error })
            await recordDetail({ result: null, success: false, error })
            logger.error(`[MCP] Tool call failed: ${name}`, error)
            throw error
        }
    }

    /**
     * 判断一次统一工具调用是否具备主人权限。
     * 显式上下文优先；聊天事件交给内置服务器的标准上下文解析，无上下文时拒绝授权。
     * @param {Object} options - callTool 调用选项
     * @returns {boolean} 具备主人权限时返回 true
     */
    hasMasterAuthority(options = {}) {
        const requestContext = options.context
        const explicitAuthority = requestContext?.isMaster
        if (explicitAuthority !== undefined) {
            return (typeof explicitAuthority === 'function' ? explicitAuthority() : explicitAuthority) === true
        }
        if (options.userPermission === 'master') return true
        if (!requestContext) return false

        try {
            const event = requestContext.event || requestContext.getEvent?.()
            if (!event) return false
            const bot = requestContext.bot || requestContext.getBot?.() || event.bot || null
            const standardContext = builtinMcpServer.createRequestContext({ event, bot })
            const authority = standardContext?.isMaster
            return (typeof authority === 'function' ? authority() : authority) === true
        } catch {
            return false
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
        // 并行执行所有调用
        const results = await Promise.allSettled(
            toolCalls.map(async call => {
                const callStart = Date.now()
                try {
                    const parsedIdentity = this.parseToolIdentity(call.name)
                    const result = await this.callTool(call.name, call.args, {
                        ...options,
                        serverName: call.serverName || parsedIdentity?.serverName,
                        inputResponses: call.inputResponses,
                        requestState: call.requestState
                    })
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
        /*
         * 日志只保留结果摘要：原实现直接持有完整 result，而绘图/语音/文件类工具
         * 会返回 base64，单条可达数 MB，1000 条上限下常驻内存可到 GB 级。
         */
        if (entry && entry.result !== undefined) {
            entry.result = summarizeToolLogValue(entry.result)
        }
        if (entry && entry.arguments !== undefined) {
            entry.arguments = summarizeToolLogValue(entry.arguments)
        }
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
            /*
             * userId 常态是 number（QQ 号），而 `?.` 只挡 null/undefined 不挡 number，
             * 原写法在"按 QQ 号搜索日志"这一正常用法下必抛 TypeError；
             * toolName 与 arguments 也一并做防御，避免个别日志字段缺失时整个查询失败。
             */
            const toText = value => {
                if (value === null || value === undefined) return ''
                if (typeof value === 'string') return value
                try {
                    return JSON.stringify(value) ?? ''
                } catch {
                    return ''
                }
            }
            logs = logs.filter(
                l =>
                    toText(l.toolName).toLowerCase().includes(query) ||
                    toText(l.userId).toLowerCase().includes(query) ||
                    toText(l.arguments).toLowerCase().includes(query)
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
            const source = this.getToolSource(tool)
            if (source === 'builtin' || source === 'custom') {
                this.unregisterTool(name, tool)
            }
        }

        // 重新加载模块化工具（根据最新配置）
        await builtinMcpServer.loadModularTools()
        const tools = builtinMcpServer.listTools()
        for (const tool of tools) {
            const normalizedTool = this.withToolSourceMeta({
                ...tool,
                serverName: tool.isJsTool ? 'custom-tools' : 'builtin',
                isBuiltin: !tool.isCustom && !tool.isJsTool,
                isCustom: tool.isCustom || tool.isJsTool || false
            })
            this.registerTool(normalizedTool)
        }

        // 更新服务器信息
        const server = this.servers.get('builtin')
        if (server) {
            server.tools = tools.filter(tool => !tool.isJsTool)
        }
        const customServer = this.servers.get('custom-tools')
        if (customServer) {
            customServer.tools = tools.filter(tool => tool.isJsTool)
        }

        logger.debug(`[MCP] Refreshed builtin tools: ${tools.length}`)
        return tools
    }

    /**
     * 热重载 JS 工具
     * 用于在前端修改 JS 工具源码后重新加载
     */
    async reloadJsTools() {
        if (this.jsToolsReloadPromise) return await this.jsToolsReloadPromise

        this.jsToolsReloadPromise = (async () => {
            try {
                for (const [name, tool] of this.tools) {
                    if (tool.isJsTool) this.unregisterTool(name, tool)
                }

                await builtinMcpServer.loadJsTools()

                for (const [name, tool] of builtinMcpServer.jsTools) {
                    const normalizedTool = this.withToolSourceMeta({
                        name: tool.name || name,
                        description: tool.description || '自定义 JS 工具',
                        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
                        serverName: 'custom-tools',
                        isJsTool: true,
                        isCustom: true,
                        dangerous: tool.dangerous === true,
                        requireMaster: tool.requireMaster === true,
                        requiredPermission: tool.requiredPermission,
                        requirePermission: tool.requirePermission,
                        permissionRequired: tool.permissionRequired,
                        ...copyMcpDefinitionMetadata(tool, MCP_TOOL_METADATA_FIELDS)
                    })
                    this.registerTool(normalizedTool)
                }

                const jsTools = Array.from(builtinMcpServer.jsTools.values()).map(tool => ({
                    name: tool.name,
                    description: tool.description,
                    inputSchema: tool.inputSchema,
                    dangerous: tool.dangerous === true,
                    requireMaster: tool.requireMaster === true,
                    ...copyMcpDefinitionMetadata(tool, MCP_TOOL_METADATA_FIELDS)
                }))
                if (jsTools.length > 0) {
                    const customServer = this.servers.get('custom-tools') || {
                        status: 'connected',
                        config: { type: 'custom', path: 'data/tools' },
                        client: null,
                        resources: [],
                        resourceTemplates: [],
                        prompts: [],
                        connectedAt: Date.now(),
                        isBuiltin: false,
                        isCustomTools: true
                    }
                    customServer.status = 'connected'
                    customServer.tools = jsTools
                    this.servers.set('custom-tools', customServer)
                } else {
                    this.servers.delete('custom-tools')
                }

                this.toolRegistryVersion += 1
                this.toolResultCache.clear()
                return builtinMcpServer.jsTools.size
            } catch (error) {
                logger.error('[MCP] JS 工具热重载失败:', error)
                throw error
            }
        })()

        try {
            return await this.jsToolsReloadPromise
        } finally {
            this.jsToolsReloadPromise = null
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

            logger.debug(`[MCP] 热重载完成: ${modularCount} 模块化工具, ${jsCount} JS工具`)
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

    normalizeToolArgs(args) {
        if (args && typeof args === 'object' && !Array.isArray(args)) {
            return args
        }
        if (args === undefined || args === null || args === '') {
            return {}
        }
        if (typeof args === 'string') {
            try {
                const parsed = JSON.parse(args)
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed
                }
            } catch {}
        }
        return { value: args }
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
