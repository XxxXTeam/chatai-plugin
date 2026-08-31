import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { EventSource } from 'eventsource'
import { chatLogger } from '../core/utils/logger.js'
import config from '../../config/config.js'
import { proxyService } from '../services/proxy/ProxyService.js'
import { encodeMcpHeaderValue, extractMcpParameterHeaders, inspectMcpHeaderSchema } from './McpProtocol.js'

const logger = chatLogger
const MODERN_PROTOCOL_VERSION = '2026-07-28'
const LATEST_SESSION_PROTOCOL_VERSION = '2025-11-25'
const LEGACY_SSE_PROTOCOL_VERSION = '2024-11-05'
const SESSION_PROTOCOL_VERSIONS = new Set([
    '2025-11-25',
    '2025-06-18',
    '2025-03-26',
    LEGACY_SSE_PROTOCOL_VERSION,
    '2024-10-07'
])
const MODERN_RESULT_TYPES = new Set(['complete', 'input_required'])
const MAX_LIST_PAGES = 100
const MODERN_UNSUPPORTED_VERSION_CODE = -32022

/** stdio/npm/npx 可直接协商的 legacy 协议版本集合。 */
const STDIO_LEGACY_PROTOCOL_VERSIONS = SESSION_PROTOCOL_VERSIONS

/** 判断是否为使用同一 JSON-RPC 标准输入输出绑定的本地传输。 */
function isStdioTransportType(type) {
    return type === 'stdio' || type === 'npm' || type === 'npx'
}

class McpHttpError extends Error {
    constructor(message, { status, code, data } = {}) {
        super(message)
        this.name = 'McpHttpError'
        this.status = status
        this.code = code
        this.data = data
    }
}

/**
 * 将 JSON-RPC 错误转换为保留 code/data 的 Error，供协议时代协商使用。
 * @param {Object} payload - JSON-RPC error 对象
 * @returns {Error} 带有 code/data 属性的错误
 */
function createMcpRpcError(payload) {
    const error = new Error(payload?.message || JSON.stringify(payload || {}))
    error.code = payload?.code
    error.data = payload?.data
    return error
}

/**
 * 读取现代协议错误中服务端声明的支持版本。
 * @param {Error} error - JSON-RPC 错误
 * @returns {string[]} 服务端支持的协议版本
 */
function getSupportedVersions(error) {
    const supported = error?.data?.supported
    return Array.isArray(supported) && supported.length > 0 && supported.every(version => typeof version === 'string')
        ? supported
        : []
}

/**
 * 读取服务端声明的现代协议版本。
 * @param {Error} error - JSON-RPC 错误
 * @returns {string[]} 现代协议版本
 */
function getModernSupportedVersions(error) {
    return getSupportedVersions(error).filter(isModernProtocolVersion)
}

/**
 * 判断协议版本是否属于 2026-07-28 及之后的现代时代。
 * @param {*} version - 协议版本
 * @returns {boolean} 是否为现代协议版本
 */
function isModernProtocolVersion(version) {
    return typeof version === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(version) && version >= MODERN_PROTOCOL_VERSION
}

/**
 * 判断 DiscoverResult 是否声明了结构合法且可用的现代版本。
 * @param {*} result - 服务端发现结果
 * @returns {boolean} 是否包含当前客户端支持的现代版本
 */
function hasCompatibleModernVersion(result) {
    return (
        Array.isArray(result?.supportedVersions) &&
        result.supportedVersions.length > 0 &&
        result.supportedVersions.every(version => typeof version === 'string') &&
        result.supportedVersions.includes(MODERN_PROTOCOL_VERSION)
    )
}

/**
 * 判断错误是否明确表示服务端已经进入现代协议协商。
 * @param {Error} error - JSON-RPC 错误
 * @returns {boolean} 是否为现代协议版本错误
 */
function isModernProtocolError(error) {
    return error?.code === MODERN_UNSUPPORTED_VERSION_CODE && getSupportedVersions(error).length > 0
}

/**
 * 获取 MCP 使用的代理 URL。
 * @returns {string|null} 代理地址
 */
function getMcpProxyUrl() {
    const profile = proxyService.getProfileForScope('api')
    return profile ? proxyService.buildProxyUrl(profile) : null
}

/**
 * 为本地 MCP 子进程构建代理环境变量。
 * @param {NodeJS.ProcessEnv} env - 原始环境变量
 * @returns {NodeJS.ProcessEnv} 合并后的环境变量
 */
function withMcpProxyEnv(env) {
    const proxyUrl = getMcpProxyUrl()
    if (!proxyUrl) return env
    return {
        ...env,
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        ALL_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        all_proxy: proxyUrl
    }
}

/** 从全局配置读取 MCP 超时配置 */
function getConfigTimeouts() {
    const mcpConfig = config.get('mcp') || {}
    const timeouts = mcpConfig.timeouts || {}
    return {
        connect: timeouts.connect || 30000,
        request: timeouts.request || 1800000,
        sseConnect: timeouts.sseConnect || 15000,
        sseEndpoint: timeouts.sseEndpoint || 2000,
        startup: timeouts.startup || 5000,
        ping: timeouts.ping || 5000,
        heartbeat: timeouts.heartbeat || 30000,
        terminate: timeouts.terminate || 3000
    }
}

/**
 * MCP Client - Model Context Protocol 客户端实现
 *
 * @description 支持多种传输类型连接 MCP 服务器
 * - stdio: 标准输入输出（本地进程）
 * - npm/npx: npm 包形式的 MCP 服务器（如 @anthropic/mcp-server-filesystem）
 * - sse: Server-Sent Events
 * - http: HTTP 请求
 *
 * @example
 * ```js
 * // stdio 模式
 * const client = new McpClient({ type: 'stdio', command: 'node', args: ['server.js'] })
 *
 * // npm 包模式
 * const client = new McpClient({
 *   type: 'npm',
 *   package: '@anthropic/mcp-server-filesystem',
 *   args: ['/path/to/allowed/dir'],
 *   env: { DEBUG: 'true' }
 * })
 *
 * // SSE 模式
 * const client = new McpClient({ type: 'sse', url: 'http://localhost:3000/sse' })
 *
 * await client.connect()
 * const tools = await client.listTools()
 * ```
 */
export class McpClient {
    /**
     * @param {Object} config - 客户端配置
     * @param {string} [config.type='stdio'] - 传输类型: stdio | npm | npx | sse | http | streamable-http
     * @param {string} [config.command] - stdio 模式的命令
     * @param {string[]} [config.args] - 命令参数
     * @param {string} [config.cwd] - 本地子进程工作目录
     * @param {boolean} [config.shell=false] - 是否经由 shell 启动 stdio 命令
     * @param {boolean} [config.windowsHide=false] - Windows 是否隐藏子进程窗口
     * @param {string} [config.package] - npm/npx 模式的包名（如 @anthropic/mcp-server-filesystem）
     * @param {string} [config.url] - SSE/HTTP 模式的 URL
     * @param {Object} [config.env] - 环境变量
     * @param {Object} [config.headers] - HTTP 请求头
     * @param {string} [config.protocolVersion] - 固定协议版本；未指定时本地传输自动探测现代/legacy
     * @param {Object} [config.clientInfo] - MCP 客户端实现信息
     * @param {Object} [config.clientCapabilities] - MCP 客户端能力
     * @param {number} [config.timeout=30000] - 连接超时时间（毫秒，兼容旧版）
     * @param {Object} [config.timeouts] - 细分超时配置
     * @param {number} [config.timeouts.connect=30000] - 连接超时
     * @param {number} [config.timeouts.request=30000] - 请求超时
     * @param {number} [config.timeouts.sseConnect=15000] - SSE 连接超时
     * @param {number} [config.timeouts.sseEndpoint=2000] - SSE endpoint 等待超时
     * @param {number} [config.timeouts.startup=5000] - 进程启动超时
     * @param {number} [config.timeouts.ping=5000] - ping 超时
     * @param {number} [config.timeouts.heartbeat=30000] - 心跳间隔
     * @param {number} [config.timeouts.terminate=3000] - 进程强制终止超时
     * @param {boolean} [config.autoReconnect=true] - 是否自动重连
     */
    constructor(config) {
        /** @type {Object} 客户端配置 */
        this.config = config
        /** @type {string} 传输类型 */
        this.type = (config.type || 'stdio').toLowerCase()
        /** @type {import('child_process').ChildProcess|null} 子进程 */
        this.process = null
        /** @type {EventSource|null} SSE 事件源 */
        this.eventSource = null
        /** @type {Map<string, {resolve: Function, reject: Function}>} 待处理请求 */
        this.pendingRequests = new Map()
        /** @type {string} 消息缓冲区 */
        this.messageBuffer = ''
        /** @type {StringDecoder} UTF-8 流式解码器，避免多字节字符跨 chunk 损坏 */
        this.messageDecoder = new StringDecoder('utf8')
        /** @type {boolean} 是否已初始化 */
        this.initialized = false
        /** @type {NodeJS.Timeout|null} 心跳定时器 */
        this.heartbeatInterval = null
        /** @type {NodeJS.Timeout|null} 重连定时器 */
        this.reconnectTimer = null
        /** @type {boolean} 客户端是否已被主动销毁 */
        this.disposed = false
        /** @type {number} 重连尝试次数 */
        this.reconnectAttempts = 0
        /** @type {number} 最大重连次数 */
        this.maxReconnectAttempts = config.maxReconnectAttempts || 5
        /** @type {boolean} 是否自动重连 */
        this.autoReconnect = config.autoReconnect !== false
        /** @type {Object|null} 服务器信息 */
        this.serverInfo = null
        /** @type {Object|null} 已完成的初始化或发现结果 */
        this.initializationResult = null
        /** @type {Map<string, Object>} 最近工具清单中的输入 schema */
        this.toolSchemas = new Map()
        /** @type {string|null} 服务器名称 */
        this.serverName = config.name || null
        /** @type {Promise<void>|null} 并发连接单飞 */
        this.connectPromise = null
        /** @type {number} 连接生命周期代数；断开后令旧异步连接失效 */
        this.connectionGeneration = 0
        /** @type {'modern'|'session'|'legacy-sse'|null} HTTP 协议时代 */
        this.httpEra = null
        /** @type {string|null} 已协商 HTTP 协议版本 */
        this.httpProtocolVersion = null
        /** @type {'modern'|'legacy'|null} stdio/npm/npx 协议时代 */
        this.stdioEra = null
        /** @type {string|null} 已选择的 stdio/npm/npx 协议版本 */
        this.stdioProtocolVersion = null
        /** @type {boolean} 初始时代探测未得到现代证据时是否允许正式初始化回退 legacy */
        this.stdioAutoFallback = false
        /** @type {AbortController|null} 当前 stdio 协议探测取消控制器 */
        this.stdioProbeAbortController = null
        /** @type {Set<AbortController>} 活跃 HTTP/SSE 请求 */
        this.httpAbortControllers = new Set()
        /** @type {Object} 当前客户端能力 */
        this.clientCapabilities = config.clientCapabilities || {}
        /** @type {{name: string, version: string}} 当前客户端信息 */
        this.clientInfo = config.clientInfo || { name: 'chatgpt-plugin', version: '1.0.0' }

        // 从全局配置读取超时时间，允许单个配置覆盖
        const cfgTimeouts = getConfigTimeouts()
        this.timeouts = {
            connect: config.timeout ?? config.timeouts?.connect ?? cfgTimeouts.connect,
            request: config.timeouts?.request ?? cfgTimeouts.request,
            sseConnect: config.timeouts?.sseConnect ?? cfgTimeouts.sseConnect,
            sseEndpoint: config.timeouts?.sseEndpoint ?? cfgTimeouts.sseEndpoint,
            startup: config.timeouts?.startup ?? cfgTimeouts.startup,
            ping: config.timeouts?.ping ?? cfgTimeouts.ping,
            heartbeat: config.timeouts?.heartbeat ?? cfgTimeouts.heartbeat,
            terminate: config.timeouts?.terminate ?? cfgTimeouts.terminate
        }
        // 兼容旧版单字段 timeout
        this.timeout = this.timeouts.connect
    }

    /**
     * 连接到 MCP 服务器
     * @returns {Promise<void>}
     * @throws {Error} 连接失败时抛出错误
     */
    async connect() {
        if (this.disposed) {
            throw new Error('MCP client has been disconnected')
        }
        if (this.initialized) return
        if (this.connectPromise) return await this.connectPromise
        const generation = this.connectionGeneration
        this.connectPromise = this.performConnect(generation)
        try {
            return await this.connectPromise
        } finally {
            this.connectPromise = null
        }
    }

    /**
     * 执行一次实际连接，connect() 负责并发单飞。
     * @param {number} generation - 启动连接时的生命周期代数
     * @returns {Promise<void>}
     */
    async performConnect(generation = this.connectionGeneration) {
        this.assertConnectionActive(generation)
        this.clearReconnectTimer()
        await this.ensureDisconnected()
        this.assertConnectionActive(generation)

        try {
            if (isStdioTransportType(this.type)) {
                await this.prepareStdioEra(generation)
            }
            this.assertConnectionActive(generation)
            if (this.type === 'stdio') {
                await this.connectStdio()
            } else if (this.type === 'npm' || this.type === 'npx') {
                await this.connectNpm()
            } else if (this.type === 'sse') {
                await this.connectSSE()
            } else if (this.type === 'http' || this.type === 'streamable-http') {
                await this.connectHTTP()
            } else {
                throw new Error(`Unsupported transport type: ${this.type}`)
            }
            this.assertConnectionActive(generation)
            await this.initialize(generation)
            this.assertConnectionActive(generation)
            if (this.type !== 'http' && this.type !== 'streamable-http' && this.stdioEra !== 'modern') {
                this.startHeartbeat()
            }
            this.reconnectAttempts = 0

            logger.debug(`[MCP] Connected successfully via ${this.type}`)
        } catch (error) {
            logger.error(`[MCP] Connection failed: ${error.message}`, error.stack)
            throw error
        }
    }

    /**
     * 确认异步连接仍属于当前客户端生命周期。
     * @param {number} generation - 连接开始时记录的代数
     * @returns {void}
     * @throws {Error} 客户端已断开或连接已过期
     */
    assertConnectionActive(generation) {
        if (this.disposed || generation !== this.connectionGeneration) {
            const error = new Error('MCP connection was cancelled')
            error.code = 'MCP_CLIENT_CANCELLED'
            throw error
        }
    }

    /**
     * 返回 stdio/npm/npx 的子进程启动参数。
     *
     * 探测进程与正式进程必须使用完全相同的命令、参数、环境和工作目录，
     * 否则探测到的协议时代不能代表实际连接。
     *
     * @returns {{command:string,args:string[],options:Object,display:string}} 启动参数
     * @throws {Error} 配置缺失或包名非法
     */
    getStdioSpawnSpec() {
        if (this.type === 'stdio') {
            const command = typeof this.config.command === 'string' ? this.config.command : ''
            if (!command.trim()) throw new Error('stdio type requires "command" field')
            const args = Array.isArray(this.config.args) ? this.config.args.map(String) : []
            return {
                command,
                args,
                options: {
                    env: withMcpProxyEnv({ ...process.env, ...(this.config.env || {}) }),
                    stdio: ['pipe', 'pipe', 'pipe'],
                    cwd: this.config.cwd || process.cwd(),
                    shell: this.config.shell === true,
                    windowsHide: this.config.windowsHide === true
                },
                display: `${command} ${args.join(' ')}`.trim()
            }
        }

        const pkg = this.config.package
        if (typeof pkg !== 'string' || !pkg) {
            throw new Error('npm/npx type requires "package" field, e.g. "@anthropic/mcp-server-filesystem"')
        }
        const validPackagePattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i
        if (!validPackagePattern.test(pkg)) throw new Error(`Invalid npm package name: ${pkg}`)

        const args = Array.isArray(this.config.args) ? this.config.args.map(String) : []
        const npxArgs = ['-y', '--prefer-offline', pkg, ...args]
        return {
            command: 'npx',
            args: npxArgs,
            options: {
                env: withMcpProxyEnv({
                    ...process.env,
                    ...(this.config.env || {}),
                    FORCE_COLOR: '0',
                    NO_COLOR: '1'
                }),
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
                cwd: this.config.cwd || process.cwd(),
                windowsHide: true
            },
            display: `npx ${npxArgs.join(' ')}`
        }
    }

    /**
     * 探测本地 MCP 子进程是否支持现代协议时代。
     *
     * 探测使用一次独立子进程。legacy 服务器可能会把未知的
     * `server/discover` 当作状态变更或写入连接状态，不能在同一进程中
     * 探测后再执行 legacy initialize。带现代版本交集的 DiscoverResult 或有效
     * -32022 表示服务端已经识别现代时代；仅 legacy 版本的 -32022 仍可回退。
     *
     * @param {AbortSignal} [signal] 连接取消信号
     * @returns {Promise<{modern:boolean,compatible?:boolean,cancelled?:boolean,result?:Object,error?:Error}>} 探测结果
     */
    async probeStdioEra(signal) {
        const spec = this.getStdioSpawnSpec()
        const probeId = crypto.randomUUID()
        const request = {
            jsonrpc: '2.0',
            id: probeId,
            method: 'server/discover',
            params: this.buildModernParams({})
        }
        if (signal?.aborted) {
            const error = new Error('MCP connection was cancelled')
            error.code = 'MCP_CLIENT_CANCELLED'
            return { modern: false, cancelled: true, error }
        }

        let child
        try {
            child = spawn(spec.command, spec.args, spec.options)
        } catch (error) {
            return { modern: false, error }
        }

        return await new Promise(resolve => {
            let buffer = ''
            // DiscoverResult 可能包含非 ASCII 的 instructions/serverInfo；子进程
            // 输出按任意字节分块，必须在探测阶段也使用增量 UTF-8 解码器。
            const decoder = new StringDecoder('utf8')
            let settled = false
            let timer = null
            let termTimer = null
            let forceTimer = null
            let stopping = false
            let stopPromise = null

            const stopProbe = () => {
                if (stopping) return stopPromise || Promise.resolve()
                stopping = true
                if (timer) clearTimeout(timer)
                stopPromise = new Promise(resolveStop => {
                    let stopped = false
                    const complete = () => {
                        if (stopped) return
                        stopped = true
                        if (termTimer) clearTimeout(termTimer)
                        if (forceTimer) clearTimeout(forceTimer)
                        child.stdin?.destroy?.()
                        child.stdout?.destroy?.()
                        child.stderr?.destroy?.()
                        resolveStop()
                    }
                    child.once('exit', complete)
                    child.once('close', complete)
                    if (child.exitCode !== null || child.signalCode !== null) {
                        complete()
                        return
                    }
                    try {
                        child.stdin?.end()
                    } catch {}
                    termTimer = setTimeout(
                        () => {
                            if (child.exitCode !== null || child.signalCode !== null) return
                            try {
                                child.kill('SIGTERM')
                            } catch {
                                complete()
                            }
                        },
                        Math.min(100, Math.max(1, Math.floor(this.timeouts.terminate / 3)))
                    )
                    termTimer.unref?.()
                    forceTimer = setTimeout(() => {
                        if (child.exitCode === null && child.signalCode === null) {
                            try {
                                child.kill('SIGKILL')
                            } catch {}
                        }
                        complete()
                    }, this.timeouts.terminate)
                    forceTimer.unref?.()
                })
                return stopPromise
            }

            const finish = async result => {
                if (settled) return
                settled = true
                // flush 可能残留的多字节前缀，避免解码器状态泄漏到后续连接。
                buffer += decoder.end()
                if (timer) clearTimeout(timer)
                if (signal) signal.removeEventListener('abort', onAbort)
                await stopProbe()
                resolve(result)
            }

            const onAbort = () => {
                const error = new Error('MCP connection was cancelled')
                error.code = 'MCP_CLIENT_CANCELLED'
                finish({ modern: false, cancelled: true, error })
            }

            const consume = chunk => {
                if (settled) return
                buffer += decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
                if (buffer.length > 1024 * 1024) {
                    finish({ modern: false, error: new Error('stdio 协议探测响应超过 1 MiB') })
                    return
                }
                let newlineIndex
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIndex).trim()
                    buffer = buffer.slice(newlineIndex + 1)
                    if (!line) continue
                    let message
                    try {
                        message = JSON.parse(line)
                    } catch {
                        // 探测失败规则将由超时/进程退出决定；允许启动日志污染前几行。
                        continue
                    }
                    if (
                        !message ||
                        typeof message !== 'object' ||
                        Array.isArray(message) ||
                        message.jsonrpc !== '2.0'
                    ) {
                        continue
                    }
                    if (message.id !== probeId) continue
                    if (message.error) {
                        const error = createMcpRpcError(message.error)
                        if (isModernProtocolError(error)) {
                            const supported = getSupportedVersions(error)
                            const modernSupported = getModernSupportedVersions(error)
                            if (modernSupported.length > 0) {
                                finish({
                                    modern: true,
                                    compatible: supported.includes(MODERN_PROTOCOL_VERSION),
                                    error
                                })
                            } else {
                                // 仅列出 legacy 版本时，按官方分类规则允许 legacy fallback。
                                finish({ modern: false, error })
                            }
                        } else {
                            finish({ modern: false, error })
                        }
                        return
                    }
                    const result = message.result
                    if (
                        Array.isArray(result?.supportedVersions) &&
                        result.supportedVersions.length > 0 &&
                        result.supportedVersions.every(version => typeof version === 'string')
                    ) {
                        const supported = result.supportedVersions
                        const modernSupported = supported.filter(isModernProtocolVersion)
                        const compatible = supported.includes(MODERN_PROTOCOL_VERSION)
                        const error =
                            compatible || modernSupported.length === 0
                                ? undefined
                                : Object.assign(new Error('服务端未声明客户端支持的现代 stdio 协议版本'), {
                                      code: MODERN_UNSUPPORTED_VERSION_CODE,
                                      data: { supported }
                                  })
                        if (modernSupported.length > 0) {
                            finish({ modern: true, compatible, result, ...(error ? { error } : {}) })
                        } else {
                            finish({ modern: false, result })
                        }
                    } else {
                        finish({ modern: false, error: new Error('服务端未返回现代 stdio DiscoverResult') })
                    }
                    return
                }
            }

            child.stdout?.on('data', consume)
            // 探测必须持续消费 stderr，避免子进程因日志缓冲区写满而假性超时。
            child.stderr?.on('data', () => {})
            child.stdin?.on('error', error => finish({ modern: false, error }))
            child.once('error', error => finish({ modern: false, error }))
            child.once('close', code => {
                if (forceTimer) clearTimeout(forceTimer)
                if (!settled) finish({ modern: false, error: new Error(`stdio 探测进程已退出 (${code ?? 'unknown'})`) })
            })
            if (signal) signal.addEventListener('abort', onAbort, { once: true })
            timer = setTimeout(
                () => finish({ modern: false, error: new Error(`stdio 协议探测超时 (${this.timeouts.connect}ms)`) }),
                this.timeouts.connect
            )
            timer.unref?.()

            try {
                child.stdin.write(`${JSON.stringify(request)}\n`)
            } catch (error) {
                finish({ modern: false, error })
            }
        })
    }

    /**
     * 选择 stdio/npm/npx 协议时代。显式版本优先于自动探测。
     * @param {number} [generation=this.connectionGeneration] - 生命周期代数
     * @returns {Promise<void>} 选择结果
     */
    async prepareStdioEra(generation = this.connectionGeneration) {
        this.assertConnectionActive(generation)
        const configuredVersion = this.config.protocolVersion
        this.stdioAutoFallback = false
        if (configuredVersion !== undefined && configuredVersion !== null && configuredVersion !== '') {
            if (configuredVersion === MODERN_PROTOCOL_VERSION) {
                this.stdioEra = 'modern'
                this.stdioProtocolVersion = MODERN_PROTOCOL_VERSION
                return
            }
            if (!STDIO_LEGACY_PROTOCOL_VERSIONS.has(configuredVersion)) {
                throw new Error(`Unsupported configured MCP protocol version: ${configuredVersion}`)
            }
            this.stdioEra = 'legacy'
            this.stdioProtocolVersion = configuredVersion
            return
        }

        const controller = new AbortController()
        this.stdioProbeAbortController = controller
        let probe
        try {
            probe = await this.probeStdioEra(controller.signal)
        } finally {
            if (this.stdioProbeAbortController === controller) this.stdioProbeAbortController = null
        }
        this.assertConnectionActive(generation)
        if (probe.cancelled) {
            throw probe.error || new Error('MCP connection was cancelled')
        }
        if (probe.modern) {
            if (probe.compatible === false) {
                throw probe.error || new Error('服务端不支持客户端的现代 stdio 协议版本')
            }
            this.stdioEra = 'modern'
            this.stdioProtocolVersion = MODERN_PROTOCOL_VERSION
            // 现代证据一旦成立，后续正式连接故障不得再降级成 legacy。
            this.stdioAutoFallback = false
            return
        }
        this.stdioEra = 'legacy'
        this.stdioProtocolVersion = LATEST_SESSION_PROTOCOL_VERSION
        this.stdioAutoFallback = true
        if (probe.error) logger.debug(`[MCP] stdio 现代协议探测失败，回退 legacy: ${probe.error.message}`)
    }

    /**
     * 重启正式 stdio/npm/npx 子进程并切换到 legacy 初始化。
     * @returns {Promise<void>} 重启结果
     */
    async restartStdioForLegacy(generation = this.connectionGeneration) {
        this.assertConnectionActive(generation)
        this.stdioEra = 'legacy'
        this.stdioProtocolVersion = LATEST_SESSION_PROTOCOL_VERSION
        this.stdioAutoFallback = false
        if (this.process) await this.terminateProcess()
        this.assertConnectionActive(generation)
        for (const [, pending] of this.pendingRequests) pending.reject(new Error('stdio 协议时代切换'))
        this.pendingRequests.clear()
        this.resetMessageBuffer()
        if (this.type === 'stdio') await this.connectStdio()
        else await this.connectNpm()
        this.assertConnectionActive(generation)
    }

    /**
     * 连接 npm 包形式的 MCP 服务器
     *
     * 支持的配置格式:
     * 1. 简单格式: { type: 'npm', package: '@anthropic/mcp-server-filesystem', args: ['/path'] }
     * 2. 完整格式: { type: 'npm', package: '@modelcontextprotocol/server-memory', env: { ... } }
     * 3. 带作用域: { type: 'npm', package: '@anthropic/mcp-server-filesystem' }
     *
     * @example
     * // 文件系统服务器
     * { type: 'npm', package: '@anthropic/mcp-server-filesystem', args: ['/home/user/docs'] }
     * // 记忆服务器
     * { type: 'npm', package: '@modelcontextprotocol/server-memory' }
     * // 自定义包
     * { type: 'npm', package: 'my-mcp-server', env: { API_KEY: 'xxx' } }
     */
    async connectNpm() {
        // 如果存在旧进程，先终止
        if (this.process) {
            await this.terminateProcess()
        }

        const spec = this.getStdioSpawnSpec()
        const pkg = this.config.package
        logger.debug(`[MCP] Starting npm server: ${spec.display}`)

        try {
            const child = spawn(spec.command, spec.args, spec.options)
            this.process = child

            // 启动超时检测
            const startupTimeout = setTimeout(() => {
                if (this.process === child && !this.initialized) {
                    logger.warn(`[MCP] npm server startup timeout: ${pkg}`)
                }
            }, this.timeouts.startup)

            child.stdout.on('data', data => {
                if (this.process !== child) return
                clearTimeout(startupTimeout)
                this.handleData(data)
            })

            // 同 connectStdio：无 error 监听时 stdin 的异步 EPIPE 会崩掉整个进程
            child.stdin.on('error', error => {
                logger.warn(`[MCP] npm server stdin error: ${error.message}`)
            })

            // stderr 可能包含启动日志，区分错误和信息
            let stderrBuffer = ''
            child.stderr.on('data', data => {
                const text = data.toString()
                stderrBuffer = (stderrBuffer + text).slice(-8192)

                // 过滤常见的 npm 信息日志
                if (text.includes('npm warn') || text.includes('npm notice')) {
                    logger.debug(`[MCP] npm info: ${text.trim()}`)
                } else if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
                    logger.error(`[MCP] Server stderr: ${text.trim()}`)
                } else {
                    logger.debug(`[MCP] Server output: ${text.trim()}`)
                }
            })
            child.stdout.on('error', error => {
                if (this.process !== child) return
                logger.warn(`[MCP] npm server stdout error: ${error.message}`)
                this.handleDisconnect(child)
            })
            child.stderr.on('error', error => {
                if (this.process !== child) return
                logger.warn(`[MCP] npm server stderr error: ${error.message}`)
            })

            child.on('close', code => {
                if (this.process !== child) return
                clearTimeout(startupTimeout)
                if (code !== 0 && code !== null) {
                    logger.warn(`[MCP] npm server exited with code ${code}`)
                    if (stderrBuffer) {
                        logger.debug(`[MCP] Last stderr: ${stderrBuffer.slice(-500)}`)
                    }
                }
                this.handleDisconnect(child)
            })

            child.on('error', error => {
                if (this.process !== child) return
                clearTimeout(startupTimeout)
                logger.error(`[MCP] npm server error:`, error.message)
                this.handleDisconnect(child)
            })

            // 等待进程启动
            await new Promise((resolve, reject) => {
                const checkInterval = setInterval(() => {
                    if (this.process === child && child.pid) {
                        clearInterval(checkInterval)
                        logger.debug(`[MCP] npm server started with PID: ${child.pid}`)
                        resolve()
                    }
                }, 50)

                setTimeout(() => {
                    clearInterval(checkInterval)
                    if (this.process !== child || !child.pid) {
                        reject(new Error(`npm server failed to start: ${pkg}`))
                    } else {
                        resolve()
                    }
                }, this.timeouts.startup)
            })
        } catch (error) {
            logger.error(`[MCP] Failed to spawn npm server: ${error.message}`)
            throw new Error(`Failed to start npm MCP server "${pkg}": ${error.message}`)
        }
    }

    async connectStdio() {
        // 如果存在旧进程，先终止
        if (this.process) {
            await this.terminateProcess()
        }

        const spec = this.getStdioSpawnSpec()
        logger.debug(`[MCP] Spawning server: ${spec.display}`)

        const child = spawn(spec.command, spec.args, spec.options)
        this.process = child

        child.stdout.on('data', data => {
            if (this.process !== child) return
            this.handleData(data)
        })
        child.stderr.on('data', data => {
            logger.warn(`[MCP] Server stderr: ${data.toString()}`)
        })
        child.stdout.on('error', error => {
            if (this.process !== child) return
            logger.warn(`[MCP] Server stdout error: ${error.message}`)
            this.handleDisconnect(child)
        })
        child.stderr.on('error', error => {
            if (this.process !== child) return
            logger.warn(`[MCP] Server stderr error: ${error.message}`)
        })
        /*
         * stdin 必须注册 error 监听：子进程存活但已关闭 stdin 时（MCP server 内部崩溃
         * 却未退出的典型形态），write 会异步 emit EPIPE。EventEmitter 对无监听器的
         * error 事件直接 throw，且它是异步事件，write 外层的 try/catch 捕获不到，
         * 结果是一个外部 MCP server 异常就能崩掉整个 Yunzai 进程。
         */
        child.stdin.on('error', error => {
            logger.warn(`[MCP] Server stdin error: ${error.message}`)
        })

        child.on('close', code => {
            if (this.process !== child) return
            logger.debug(`[MCP] Server exited with code ${code}`)
            this.handleDisconnect(child)
        })

        child.on('error', error => {
            if (this.process !== child) return
            logger.error(`[MCP] Process error:`, error)
            this.handleDisconnect(child)
        })
    }

    resolveSSEEndpoint(endpoint) {
        if (!endpoint) return endpoint
        if (/^https?:\/\//i.test(endpoint)) return endpoint

        try {
            return new URL(endpoint, this.config.url).toString()
        } catch {
            return `${this.sseBaseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
        }
    }

    async connectSSE() {
        const { url, headers = {} } = this.config
        this.sseHeaders = headers

        // 解析基地址时丢弃查询串和片段；查询串只属于 SSE 连接本身，
        // 不能拼到默认 /message 路径之后形成无效 URL。
        const parsedUrl = new URL(String(url))
        const basePath = parsedUrl.pathname.replace(/\/(sse|mcp|message)\/?$/i, '') || '/'
        parsedUrl.pathname = basePath
        parsedUrl.search = ''
        parsedUrl.hash = ''
        this.sseBaseUrl = parsedUrl.toString().replace(/\/$/, '')
        logger.debug(`[MCP] Connecting to SSE endpoint: ${url}`)

        // 使用 node-fetch 以支持现有 ProxyService 的 HTTP Agent。
        const eventSourceOptions = {
            fetch: async (input, init) => {
                const targetUrl = String(input)
                const nodeFetch = (await import('node-fetch')).default
                return nodeFetch(targetUrl, {
                    ...init,
                    ...proxyService.getFetchOptions(targetUrl, 'api'),
                    headers: { ...init?.headers, ...headers }
                })
            }
        }

        this.eventSource = new EventSource(url, eventSourceOptions)

        // 等待连接并获取消息端点
        await new Promise((resolve, reject) => {
            let resolved = false
            const timeout = setTimeout(() => {
                if (!resolved) {
                    this.eventSource?.close()
                    reject(new Error('SSE connection timeout'))
                }
            }, this.timeouts.sseConnect)
            this.eventSource.addEventListener('endpoint', event => {
                this.sseMessageEndpoint = this.resolveSSEEndpoint(event.data)
                logger.debug(`[MCP] SSE endpoint received: ${this.sseMessageEndpoint}`)
                if (!resolved) {
                    resolved = true
                    clearTimeout(timeout)
                    resolve()
                }
            })
            this.eventSource.onmessage = event => {
                try {
                    const message = JSON.parse(event.data)
                    logger.debug(`[MCP] SSE message:`, event.data.substring(0, 200))
                    this.handleMessage(message)
                } catch {
                    // 可能不是 JSON
                }
            }

            this.eventSource.onerror = () => {
                const readyState = this.eventSource?.readyState
                const stateNames = { 0: 'CONNECTING', 1: 'OPEN', 2: 'CLOSED' }
                logger.warn(`[MCP] SSE error, readyState=${stateNames[readyState] || readyState}`)
                if (readyState === EventSource.CLOSED && !resolved) {
                    clearTimeout(timeout)
                    reject(new Error('SSE connection closed'))
                }
            }

            this.eventSource.onopen = () => {
                logger.debug(`[MCP] SSE connection opened, waiting for endpoint event...`)
                setTimeout(() => {
                    if (!resolved) {
                        this.sseMessageEndpoint = this.sseBaseUrl + '/message'
                        logger.debug(`[MCP] No endpoint event, using default: ${this.sseMessageEndpoint}`)
                        resolved = true
                        clearTimeout(timeout)
                        resolve()
                    }
                }, this.timeouts.sseEndpoint)
            }
        })
    }

    async connectHTTP() {
        const { url, headers } = this.config
        this.httpUrl = url
        this.httpHeaders = headers || {}
        this.httpSessionId = null
        this.httpEra = null
        this.httpProtocolVersion = null
        this.stdioEra = null
        this.stdioProtocolVersion = null
        this.stdioAutoFallback = false
        this.toolSchemas.clear()
    }

    handleData(data) {
        this.messageBuffer += this.messageDecoder.write(data)
        let newlineIndex
        while ((newlineIndex = this.messageBuffer.indexOf('\n')) !== -1) {
            const line = this.messageBuffer.slice(0, newlineIndex)
            this.messageBuffer = this.messageBuffer.slice(newlineIndex + 1)

            if (line.trim()) {
                try {
                    const message = JSON.parse(line)
                    this.handleMessage(message)
                } catch (err) {
                    logger.error(`[MCP] Failed to parse message: ${line}`, err)
                }
            }
        }
    }

    /**
     * 清空 stdio 消息缓冲区并丢弃上一个进程残留的半个 UTF-8 字符。
     * @returns {void}
     */
    resetMessageBuffer() {
        this.messageBuffer = ''
        this.messageDecoder = new StringDecoder('utf8')
    }

    handleMessage(message) {
        // JSON-RPC 允许数字 0 和空字符串作为请求 ID；不能使用 truthiness
        // 判断，否则对应响应会被误当成通知并让请求一直等待到超时。
        const hasId = Boolean(message && Object.prototype.hasOwnProperty.call(message, 'id'))
        const pending = hasId ? this.pendingRequests.get(message.id) : null
        if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
            if (pending) {
                this.pendingRequests.delete(message.id)
                pending.reject(new Error('Invalid stdio JSON-RPC response version'))
            } else {
                logger.warn('[MCP] Ignored invalid stdio JSON-RPC message')
            }
            return
        }
        const isPing = pending?.method === 'ping'
        if (!isPing) {
            const pendingIds = Array.from(this.pendingRequests.keys())
            logger.debug(
                `[MCP] handleMessage: id=${message.id}, method=${message.method}, hasResult=${message.result !== undefined}, pendingIds=[${pendingIds.join(', ')}]`
            )
        }

        if (hasId && pending) {
            const { resolve, reject } = pending
            this.pendingRequests.delete(message.id)
            if (!isPing) {
                logger.debug(`[MCP] Resolving request ${message.id}, hasError=${!!message.error}`)
            }

            if (message.error) {
                reject(createMcpRpcError(message.error))
            } else {
                // 返回 result 字段
                resolve(message.result)
            }
        } else if (message.method) {
            // Handle notifications or server requests
            this.handleNotification(message)
        } else if (hasId) {
            const unknownPendingIds = Array.from(this.pendingRequests.keys())
            logger.warn(
                `[MCP] Received response for unknown request id: ${message.id}, pendingIds=[${unknownPendingIds.join(', ')}]`
            )
        }
    }

    handleNotification(message) {
        logger.debug(`[MCP] Received notification: ${message.method}`)

        // Handle specific notifications
        if (message.method === 'notifications/tools/list_changed' || message.method === 'tools/list_changed') {
            this.toolSchemas.clear()
            logger.debug('[MCP] Tools list changed, schema cache invalidated')
        }
    }

    handleDisconnect(processRef = null) {
        if (processRef && this.process !== processRef) return
        const wasInitialized = this.initialized
        const shouldReconnect = !this.disposed && wasInitialized && this.autoReconnect
        this.initialized = false
        this.initializationResult = null
        this.serverCapabilities = {}
        this.serverInfo = null
        this.stopHeartbeat()

        const child = this.process
        if (child) {
            // 尝试优雅关闭
            try {
                child.kill('SIGTERM')
            } catch {
                // 忽略
            }
            if (this.process === child) this.process = null
        }
        if (this.eventSource) {
            this.eventSource.close()
            this.eventSource = null
        }
        this.abortHttpRequests()
        this.resetMessageBuffer()

        // Reject all pending requests
        for (const [, { reject }] of this.pendingRequests) {
            reject(new Error('Connection lost'))
        }
        this.pendingRequests.clear()

        // 只有活动客户端才允许自动重连；删除/断开后的旧实例不能再重连
        if (shouldReconnect) {
            this.attemptReconnect()
        }
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
    }

    async attemptReconnect() {
        if (this.disposed || !this.autoReconnect) {
            return
        }
        if (this.reconnectTimer) {
            return
        }
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('[MCP] Max reconnection attempts reached')
            return
        }

        this.reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)

        logger.debug(
            `[MCP] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        )

        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null
            if (this.disposed || !this.autoReconnect) {
                return
            }
            try {
                await this.connect()
            } catch (error) {
                logger.error('[MCP] Reconnection failed:', error)
            }
        }, delay)
    }

    startHeartbeat() {
        this.stopHeartbeat()

        this.heartbeatInterval = setInterval(async () => {
            try {
                await this.ping()
            } catch (error) {
                logger.warn('[MCP] Heartbeat failed:', error)
                this.handleDisconnect()
            }
        }, this.timeouts.heartbeat)
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval)
            this.heartbeatInterval = null
        }
    }

    async ping() {
        try {
            await this.request('ping', undefined, this.timeouts.ping)
            return true
        } catch {
            // Ping not supported, ignore
            return false
        }
    }

    /**
     * 尽力发送 stdio 取消通知；通知不进入 pendingRequests。
     * @param {string} requestId - 被取消的 JSON-RPC 请求 id
     * @param {string} reason - 取消原因
     * @param {import('child_process').ChildProcess} child - 创建请求时的子进程
     * @returns {void}
     */
    sendStdioCancellation(requestId, reason, child) {
        if (this.process !== child || this.disposed || child.stdin?.destroyed) return
        const params = { requestId, reason }
        const notification = {
            jsonrpc: '2.0',
            method: 'notifications/cancelled',
            params: this.stdioEra === 'modern' ? this.buildModernParams(params) : params
        }
        try {
            child.stdin.write(JSON.stringify(notification) + '\n')
        } catch (error) {
            logger.debug('[MCP] Failed to send stdio cancellation: ' + error.message)
        }
    }

    async request(method, params, timeout = this.timeouts.request, options = {}) {
        // streamable-http 与 http 在 connect() 中走同一分支（均不创建子进程），
        // 此处若漏判会落到下方的 stdio 分支并抛 'Client not connected'，
        // 而 inferServerType 会把 /mcp、/sse 结尾的 URL 判为 streamable-http，触发面很大
        if (this.type === 'http' || this.type === 'streamable-http') {
            try {
                return await this.httpRequest(method, params, timeout, options)
            } catch (error) {
                if (
                    this.httpEra === 'session' &&
                    error instanceof McpHttpError &&
                    error.status === 404 &&
                    method !== 'initialize'
                ) {
                    const protocolVersion = this.httpProtocolVersion || LATEST_SESSION_PROTOCOL_VERSION
                    this.initializationResult = await this.initializeHttpSession(protocolVersion)
                    this.initialized = true
                    return await this.httpRequest(method, params, timeout, options)
                }
                throw error
            }
        }

        // SSE 类型直接调用 sendSSERequest，它内部管理 pendingRequests
        if (this.type === 'sse') {
            if (!this.eventSource) {
                throw new Error('SSE client not connected')
            }
            const id = crypto.randomUUID()
            const request = {
                jsonrpc: '2.0',
                id,
                method,
                params
            }
            return await this.sendSSERequest(request, timeout)
        }

        // stdio/npm/npx 类型
        const child = this.process
        if (!child || this.disposed) {
            throw new Error('Client not connected')
        }

        const id = crypto.randomUUID()
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params: this.stdioEra === 'modern' ? this.buildModernParams(params) : params
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id)
                    this.sendStdioCancellation(id, 'Request timed out: ' + method, child)
                    reject(new Error(`Request timed out: ${method}`))
                }
            }, timeout)

            this.pendingRequests.set(id, {
                method,
                resolve: res => {
                    clearTimeout(timer)
                    resolve(res)
                },
                reject: err => {
                    clearTimeout(timer)
                    reject(err)
                }
            })

            try {
                const message = JSON.stringify(request) + '\n'
                if (this.process !== child || child.stdin.destroyed) {
                    throw new Error('Client not connected')
                }
                child.stdin.write(message)
            } catch (err) {
                this.pendingRequests.delete(id)
                clearTimeout(timer)
                reject(err)
            }
        })
    }

    /**
     * 发送 SSE 类型的请求（通过 HTTP POST 到 message endpoint）
     * MCP SSE 协议：POST 返回 202 Accepted，实际响应通过 SSE 流返回
     * @param {Object} request - JSON-RPC 请求对象
     * @param {number} timeout - 超时时间（毫秒）
     * @returns {Promise<any>} 响应结果
     */
    getSSEMessageUrlCandidates() {
        let messageUrl
        if (this.sseMessageEndpoint) {
            messageUrl = /^https?:\/\//i.test(this.sseMessageEndpoint)
                ? this.sseMessageEndpoint
                : `${this.sseBaseUrl}${this.sseMessageEndpoint}`
        } else {
            messageUrl = this.sseUrl || this.config.url
        }

        const candidates = [messageUrl]
        try {
            const parsed = new URL(messageUrl)
            if (parsed.pathname.endsWith('/')) {
                parsed.pathname = parsed.pathname.slice(0, -1)
                candidates.push(parsed.toString())
            }
        } catch {
            if (messageUrl.includes('/messages/?')) {
                candidates.push(messageUrl.replace('/messages/?', '/messages?'))
            } else if (messageUrl.includes('/message/?')) {
                candidates.push(messageUrl.replace('/message/?', '/message?'))
            }
        }

        return [...new Set(candidates)]
    }

    async sendSSENotification(notification) {
        const { headers: configHeaders = {} } = this.config
        const messageUrls = this.getSSEMessageUrlCandidates()
        let response = null
        let responseText = ''
        let lastError = null

        const nodeFetch = (await import('node-fetch')).default
        for (const [index, url] of messageUrls.entries()) {
            try {
                if (notification.method !== 'ping') {
                    const prefix = index > 0 ? 'Retrying SSE notification to' : 'SSE notification to'
                    logger.debug(`[MCP] ${prefix}: ${url}, method: ${notification.method}`)
                }
                /*
                 * 必须带超时：initialize() 会 await 本方法发送 initialized 通知，
                 * 服务端不响应时整条链路（connect → _connectServer → loadServers →
                 * mcpManager.init）都会永久挂起，而 init() 又被 callTool 兜底调用，
                 * 会连带拖住工具调用。同文件 sendSSERequest 与 httpRequest 都已用
                 * AbortController，此处是遗漏。
                 */
                response = await nodeFetch(url, {
                    ...proxyService.getFetchOptions(url, 'api'),
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        ...configHeaders
                    },
                    body: JSON.stringify(notification),
                    // `??` 只挡 null/undefined，配置写成 0 会让 AbortSignal 立即 abort，故用 ||
                    signal: AbortSignal.timeout(this.timeouts.request || 30000)
                })
            } catch (fetchError) {
                lastError = new Error(`SSE POST failed: ${fetchError.message}`)
                continue
            }

            responseText = await response.text().catch(() => '')
            if (response.ok) {
                if (index > 0) {
                    this.sseMessageEndpoint = url
                }
                return
            }

            lastError = new Error(`SSE request failed: ${response.status} ${response.statusText} ${responseText}`)
            if (response.status !== 404 || index === messageUrls.length - 1) {
                break
            }
        }

        throw lastError || new Error('SSE notification failed')
    }

    async sendSSERequest(request, timeout = this.timeouts.request) {
        const { headers: configHeaders = {} } = this.config
        const messageUrls = this.getSSEMessageUrlCandidates()
        const messageUrl = messageUrls[0]

        if (request.method !== 'ping') {
            logger.debug(`[MCP] SSE POST to: ${messageUrl}, id: ${request.id}, method: ${request.method}`)
        }

        // 使用 AbortController 确保 fetch 在超时时能被中断
        const controller = new AbortController()
        let cleanupPending = () => {}
        const responsePromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(request.id)) {
                    this.pendingRequests.delete(request.id)
                    controller.abort()
                    reject(new Error(`SSE response timeout for ${request.method}`))
                }
            }, timeout)

            cleanupPending = err => {
                clearTimeout(timer)
                controller.abort()
                this.pendingRequests.delete(request.id)
                if (err) reject(err)
            }

            this.pendingRequests.set(request.id, {
                method: request.method,
                resolve: result => {
                    clearTimeout(timer)
                    this.pendingRequests.delete(request.id)
                    resolve(result)
                },
                reject: err => {
                    clearTimeout(timer)
                    this.pendingRequests.delete(request.id)
                    reject(err)
                }
            })
        })

        responsePromise.catch(() => {})

        let response
        let responseText = ''
        let lastError = null

        const nodeFetch = (await import('node-fetch')).default
        for (const [index, url] of messageUrls.entries()) {
            try {
                if (index > 0 && request.method !== 'ping') {
                    logger.debug(`[MCP] Retrying SSE POST to: ${url}, id: ${request.id}, method: ${request.method}`)
                }
                response = await nodeFetch(url, {
                    ...proxyService.getFetchOptions(url, 'api'),
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, text/event-stream',
                        ...configHeaders
                    },
                    body: JSON.stringify(request),
                    signal: controller.signal
                })
            } catch (fetchError) {
                if (fetchError.name === 'AbortError' || fetchError.message?.includes('aborted')) {
                    lastError = new Error(`SSE request aborted: ${fetchError.message}`)
                } else {
                    lastError = new Error(`SSE POST failed: ${fetchError.message}`)
                }
                continue
            }

            if (response.ok) {
                if (index > 0) {
                    this.sseMessageEndpoint = url
                }
                break
            }

            responseText = (await response.text().catch(() => '')).slice(0, 2000)
            lastError = new Error(`SSE request failed: ${response.status} ${response.statusText} ${responseText}`)
            if (response.status !== 404 || index === messageUrls.length - 1) {
                break
            }
        }

        if (!response?.ok) {
            const error = lastError || new Error('SSE request failed')
            cleanupPending(error)
            throw error
        }

        if (request.method !== 'ping') {
            logger.debug(`[MCP] SSE POST response status: ${response.status}`)
        }

        if (response.status === 202 || response.status === 204) {
            if (request.method !== 'ping') {
                logger.debug(`[MCP] Waiting for SSE stream response for id: ${request.id}`)
            }
            return await responsePromise
        }

        responseText = await response.text().catch(() => '')
        if (responseText.trim() === '' || responseText === 'Accepted') {
            if (request.method !== 'ping') {
                logger.debug(`[MCP] Waiting for SSE stream response for id: ${request.id}`)
            }
            return await responsePromise
        }

        /*
         * 解析与业务错误判定必须分开：
         * 原实现把 `throw new Error(jsonResponse.error...)` 写在 try 内，会被自己的 catch
         * 捕获并误判为"响应不是 JSON"，转而 await responsePromise；而此前的 cleanupPending()
         * 已经 clearTimeout 并从 pendingRequests 删除了 resolve/reject —— 那个 Promise
         * 再也没有任何路径能 settle，超时兜底也没了，调用方永久挂起。
         */
        let jsonResponse
        try {
            jsonResponse = JSON.parse(responseText)
        } catch {
            logger.debug(`[MCP] Response not JSON, waiting for SSE stream...`)
            return await responsePromise
        }

        cleanupPending()
        if (jsonResponse.error) {
            throw new Error(jsonResponse.error.message || JSON.stringify(jsonResponse.error))
        }
        return jsonResponse.result !== undefined ? jsonResponse.result : jsonResponse
    }

    encodeMcpHeaderValue(value) {
        return encodeMcpHeaderValue(value)
    }

    buildModernParams(params) {
        const normalized = params && typeof params === 'object' && !Array.isArray(params) ? params : {}
        return {
            ...normalized,
            _meta: {
                ...(normalized._meta || {}),
                'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
                'io.modelcontextprotocol/clientInfo': this.clientInfo,
                'io.modelcontextprotocol/clientCapabilities': this.clientCapabilities
            }
        }
    }

    buildHttpHeaders(requestBody, { initialize = false, parameterHeaders = {} } = {}) {
        const headers = {
            ...this.httpHeaders,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream'
        }
        if (this.httpEra === 'modern') {
            headers['MCP-Protocol-Version'] = MODERN_PROTOCOL_VERSION
            headers['Mcp-Method'] = requestBody.method
            const name = requestBody.params?.name ?? requestBody.params?.uri
            if (name !== undefined) headers['Mcp-Name'] = this.encodeMcpHeaderValue(name)
        } else if (!initialize) {
            if (!this.httpSessionId || !this.httpProtocolVersion) {
                throw new Error('Streamable HTTP session is not initialized')
            }
            headers['Mcp-Session-Id'] = this.httpSessionId
            headers['MCP-Protocol-Version'] = this.httpProtocolVersion
        }
        return { ...headers, ...parameterHeaders }
    }

    async executeHttpMessage(
        requestBody,
        timeout,
        { initialize = false, notification = false, parameterHeaders = {} } = {}
    ) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)
        this.httpAbortControllers.add(controller)

        try {
            const nodeFetch = (await import('node-fetch')).default
            const response = await nodeFetch(this.httpUrl, {
                ...proxyService.getFetchOptions(this.httpUrl, 'api'),
                method: 'POST',
                headers: this.buildHttpHeaders(requestBody, { initialize, parameterHeaders }),
                body: JSON.stringify(requestBody),
                signal: controller.signal
            })

            if (!response.ok) {
                const text = await response.text().catch(() => '')
                let errorBody = null
                try {
                    errorBody = JSON.parse(text)
                } catch {}
                throw new McpHttpError(
                    errorBody?.error?.message || `HTTP request failed: ${response.status} ${response.statusText}`,
                    { status: response.status, code: errorBody?.error?.code, data: errorBody?.error?.data }
                )
            }

            if (initialize && this.httpEra === 'session') {
                const sessionId = response.headers.get('Mcp-Session-Id')
                if (!sessionId) throw new Error('Streamable HTTP initialize response is missing Mcp-Session-Id')
                this.httpSessionId = sessionId
            }
            if (notification) {
                if (response.status !== 202) {
                    throw new Error(`MCP notification expected HTTP 202, received ${response.status}`)
                }
                return undefined
            }
            const contentType = response.headers.get('content-type') || ''
            if (contentType.includes('text/event-stream')) {
                return await this.parseSSEResponse(response, requestBody.id)
            }
            if (!contentType.includes('application/json')) {
                throw new Error(`Unsupported MCP response Content-Type: ${contentType || 'missing'}`)
            }
            const message = await response.json()
            // 非通知 JSON-RPC 响应必须带 2.0 版本和与请求对应的 id。若直接
            // 接受错 id（或缺少 id）的响应，多个并发请求经过代理时可能把一个
            // 工具结果交给另一个调用方。
            if (
                !message ||
                typeof message !== 'object' ||
                Array.isArray(message) ||
                message.jsonrpc !== '2.0' ||
                !Object.prototype.hasOwnProperty.call(message, 'id') ||
                !Object.is(message.id, requestBody.id)
            ) {
                throw new McpHttpError('Invalid JSON-RPC response id or version', {
                    status: response.status,
                    code: -32603
                })
            }
            if (!Object.prototype.hasOwnProperty.call(message, 'result') && !message.error) {
                throw new McpHttpError('Invalid JSON-RPC response: result or error is required', {
                    status: response.status,
                    code: -32603
                })
            }
            if (message.error) {
                throw new McpHttpError(message.error.message || JSON.stringify(message.error), {
                    status: response.status,
                    code: message.error.code,
                    data: message.error.data
                })
            }
            return this.validateHttpResult(message.result)
        } catch (error) {
            throw error
        } finally {
            clearTimeout(timer)
            this.httpAbortControllers.delete(controller)
        }
    }

    async httpRequest(method, params, timeout = this.timeouts.request, options = {}) {
        const requestBody = {
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method,
            params: this.httpEra === 'modern' ? this.buildModernParams(params) : params
        }
        return await this.executeHttpMessage(requestBody, timeout, {
            initialize: method === 'initialize',
            parameterHeaders: options.parameterHeaders
        })
    }

    async httpNotification(method, params = {}, timeout = this.timeouts.request) {
        const requestBody = {
            jsonrpc: '2.0',
            method,
            params: this.httpEra === 'modern' ? this.buildModernParams(params) : params
        }
        return await this.executeHttpMessage(requestBody, timeout, { notification: true })
    }

    validateHttpResult(result) {
        if (this.httpEra === 'modern') {
            if (!result || typeof result !== 'object' || Array.isArray(result)) {
                throw new Error('Modern MCP response must be an object')
            }
            // 2026-07-28 MRTR 允许 input_required；未提供 resultType 时按规范的
            // 向后兼容规则视为 complete，不阻断较早的现代实现。
            const resultType = result.resultType || 'complete'
            if (!MODERN_RESULT_TYPES.has(resultType)) {
                throw new Error(`Modern MCP response has unsupported resultType: ${resultType}`)
            }
            if (
                result.inputRequests !== undefined &&
                (!result.inputRequests ||
                    typeof result.inputRequests !== 'object' ||
                    Array.isArray(result.inputRequests))
            ) {
                throw new Error('Modern MCP inputRequests must be an object')
            }
            if (result.requestState !== undefined && typeof result.requestState !== 'string') {
                throw new Error('Modern MCP requestState must be a string')
            }
            const serverInfo = result._meta?.['io.modelcontextprotocol/serverInfo']
            if (serverInfo && typeof serverInfo.name === 'string' && typeof serverInfo.version === 'string') {
                this.serverInfo = serverInfo
            }
        }
        return result
    }

    /**
     * 增量解析可能永久保持的 SSE 响应；收到目标 JSON-RPC 响应后立即返回。
     * @param {Response} response - fetch 响应
     * @param {string|number} expectedId - 目标请求 ID
     * @returns {Promise<*>} JSON-RPC result
     */
    async parseSSEResponse(response, expectedId) {
        if (!response.body) throw new Error('MCP SSE response has no body')
        const decoder = new TextDecoder()
        let buffer = ''
        let dataLines = []

        const dispatchEvent = () => {
            if (dataLines.length === 0) return null
            const payload = dataLines.join('\n')
            dataLines = []
            if (!payload) return null
            let message
            try {
                message = JSON.parse(payload)
            } catch {
                return null
            }
            if (!message || typeof message !== 'object' || Array.isArray(message)) return null
            if (message.method) {
                if (message.jsonrpc !== '2.0') return null
                this.handleNotification(message)
                return null
            }
            if (message.id !== expectedId) return null
            if (message.jsonrpc !== '2.0') {
                throw new McpHttpError('Invalid SSE JSON-RPC response version', { code: -32603 })
            }
            if (message.error) {
                throw new McpHttpError(message.error.message || JSON.stringify(message.error), {
                    code: message.error.code,
                    data: message.error.data
                })
            }
            if (Object.prototype.hasOwnProperty.call(message, 'result')) {
                return { found: true, result: message.result }
            }
            throw new McpHttpError('Invalid SSE JSON-RPC response: result or error is required', { code: -32603 })
        }

        try {
            for await (const chunk of response.body) {
                buffer += decoder.decode(chunk, { stream: true })
                let newlineIndex
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    let line = buffer.slice(0, newlineIndex)
                    buffer = buffer.slice(newlineIndex + 1)
                    if (line.endsWith('\r')) line = line.slice(0, -1)
                    if (line === '') {
                        const dispatched = dispatchEvent()
                        if (dispatched?.found) return this.validateHttpResult(dispatched.result)
                    } else if (line.startsWith('data:')) {
                        dataLines.push(line.slice(5).replace(/^ /, ''))
                    }
                }
            }
            buffer += decoder.decode()
            if (buffer) {
                const lines = buffer.split(/\r?\n/)
                for (const line of lines) {
                    if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
                }
            }
            const dispatched = dispatchEvent()
            if (dispatched?.found) return this.validateHttpResult(dispatched.result)
            throw new Error('MCP SSE stream ended before the JSON-RPC response')
        } finally {
            response.body.destroy?.()
        }
    }

    isConnectionError(error) {
        const message = error?.message || ''
        return [
            'Client not connected',
            'Connection lost',
            'SSE client not connected',
            'SSE POST failed',
            'SSE request failed',
            'SSE response timeout',
            'SSE connection timeout',
            'SSE connection closed',
            'fetch failed',
            'ECONNREFUSED',
            'ECONNRESET',
            'EPIPE'
        ].some(text => message.includes(text))
    }

    async initialize(generation = this.connectionGeneration) {
        this.assertConnectionActive(generation)
        if (this.initialized) return this.initializationResult || {}
        let result
        if (this.type === 'http' || this.type === 'streamable-http') {
            result = await this.initializeHttpTransport()
        } else if (isStdioTransportType(this.type)) {
            result = await this.initializeStdioTransport(generation)
        } else {
            const protocolVersion =
                this.config.protocolVersion ||
                (this.type === 'sse' ? LEGACY_SSE_PROTOCOL_VERSION : LATEST_SESSION_PROTOCOL_VERSION)
            result = await this.request('initialize', {
                protocolVersion,
                capabilities: this.clientCapabilities,
                clientInfo: this.clientInfo
            })
            const notification = { jsonrpc: '2.0', method: 'notifications/initialized' }
            if (this.type === 'sse') {
                await this.sendSSENotification(notification)
            }
        }

        this.assertConnectionActive(generation)
        this.initialized = true
        this.initializationResult = result
        this.serverCapabilities = result?.capabilities || {}
        this.serverInfo =
            result?.serverInfo || result?._meta?.['io.modelcontextprotocol/serverInfo'] || this.serverInfo || null
        return result
    }

    /**
     * 按已选择的协议时代初始化 stdio/npm/npx 连接。
     * @returns {Promise<Object>} 初始化或发现结果
     */
    async initializeStdioTransport(generation = this.connectionGeneration) {
        this.assertConnectionActive(generation)
        if (this.stdioEra === 'modern') {
            try {
                const result = await this.request('server/discover', {})
                this.assertConnectionActive(generation)
                if (!hasCompatibleModernVersion(result)) {
                    throw Object.assign(new Error('服务端未声明客户端支持的现代 stdio 协议版本'), {
                        code: MODERN_UNSUPPORTED_VERSION_CODE,
                        data: { supported: result?.supportedVersions }
                    })
                }
                this.stdioProtocolVersion = MODERN_PROTOCOL_VERSION
                return result
            } catch (error) {
                // -32022 已明确证明服务端理解现代时代；选择交集后最多纠偏重试一次，
                // 不能把现代错误误判为 legacy initialize。
                if (isModernProtocolError(error)) {
                    const supported = getSupportedVersions(error)
                    if (supported.includes(MODERN_PROTOCOL_VERSION)) {
                        const retry = await this.request('server/discover', {})
                        this.assertConnectionActive(generation)
                        if (!hasCompatibleModernVersion(retry)) {
                            throw Object.assign(new Error('服务端重试后未声明客户端支持的现代 stdio 协议版本'), {
                                code: MODERN_UNSUPPORTED_VERSION_CODE,
                                data: { supported: retry?.supportedVersions }
                            })
                        }
                        return retry
                    }
                    if (!this.stdioAutoFallback || getModernSupportedVersions(error).length > 0) throw error
                }
                if (!this.stdioAutoFallback) throw error
                logger.debug(`[MCP] 正式 stdio 现代探测失败，重启并回退 legacy: ${error.message}`)
                await this.restartStdioForLegacy(generation)
                return await this.initializeLegacyStdioTransport(generation)
            }
        }
        return await this.initializeLegacyStdioTransport(generation)
    }

    /**
     * 使用 legacy initialize 握手初始化本地传输。
     * @returns {Promise<Object>} initialize 结果
     */
    async initializeLegacyStdioTransport(generation = this.connectionGeneration) {
        this.assertConnectionActive(generation)
        const protocolVersion = this.stdioProtocolVersion || LATEST_SESSION_PROTOCOL_VERSION
        const result = await this.request('initialize', {
            protocolVersion,
            capabilities: this.clientCapabilities,
            clientInfo: this.clientInfo
        })
        this.assertConnectionActive(generation)
        const child = this.process
        if (!child || child.stdin.destroyed) throw new Error('stdio client process is unavailable')
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
        return result
    }

    async initializeHttpTransport() {
        const configuredVersion = this.config.protocolVersion
        if (configuredVersion && configuredVersion !== MODERN_PROTOCOL_VERSION) {
            if (!SESSION_PROTOCOL_VERSIONS.has(configuredVersion)) {
                throw new Error(`Unsupported configured MCP protocol version: ${configuredVersion}`)
            }
            try {
                return await this.initializeHttpSession(configuredVersion)
            } catch (error) {
                if (!this.shouldFallbackToLegacySSE(error)) throw error
                return await this.initializeLegacySSETransport()
            }
        }

        this.httpEra = 'modern'
        this.httpProtocolVersion = MODERN_PROTOCOL_VERSION
        try {
            const result = await this.httpRequest('server/discover', {}, this.timeouts.connect)
            if (!result.supportedVersions?.includes(MODERN_PROTOCOL_VERSION)) {
                throw new Error(`MCP server does not advertise ${MODERN_PROTOCOL_VERSION}`)
            }
            this.serverCapabilities = result.capabilities || {}
            return result
        } catch (error) {
            if (configuredVersion === MODERN_PROTOCOL_VERSION || !this.shouldFallbackToSessionProtocol(error)) {
                throw error
            }
            this.httpEra = null
            this.httpProtocolVersion = null
            try {
                return await this.initializeHttpSession(LATEST_SESSION_PROTOCOL_VERSION)
            } catch (sessionError) {
                if (!this.shouldFallbackToLegacySSE(sessionError)) throw sessionError
                return await this.initializeLegacySSETransport()
            }
        }
    }

    /**
     * 判断一次 HTTP 响应是否更像旧版 HTTP+SSE 端点，而不是已经识别出的现代错误。
     *
     * 旧端点通常对 POST 返回 404/405 空响应或 HTML；现代端点会返回带协议错误码的
     * JSON-RPC 错误。只有前者才允许切换到 GET endpoint 事件的兼容流程。
     * @param {*} error - HTTP 请求错误
     * @returns {boolean} 是否应尝试旧版 SSE
     */
    shouldFallbackToLegacySSE(error) {
        if (!(error instanceof McpHttpError)) return false
        if (![400, 404, 405].includes(error.status)) return false
        // 这些错误码表示服务端已经理解现代协议，不能把请求错误误判成旧端点。
        return ![-32020, -32021, -32022, -32601, -32602].includes(error.code)
    }

    /**
     * 从自动探测失败的 HTTP URL 切换到 2024-11-05 HTTP+SSE。
     * @returns {Promise<Object>} 旧协议 initialize 结果
     */
    async initializeLegacySSETransport() {
        const previousType = this.type
        this.type = 'sse'
        this.httpEra = 'legacy-sse'
        this.httpSessionId = null
        this.httpProtocolVersion = null
        try {
            await this.connectSSE()
            const result = await this.request('initialize', {
                protocolVersion: LEGACY_SSE_PROTOCOL_VERSION,
                capabilities: this.clientCapabilities,
                clientInfo: this.clientInfo
            })
            await this.sendSSENotification({ jsonrpc: '2.0', method: 'notifications/initialized' })
            this.serverCapabilities = result?.capabilities || {}
            this.serverInfo = result?.serverInfo || this.serverInfo || null
            return result
        } catch (error) {
            this.type = previousType
            this.httpEra = null
            this.httpSessionId = null
            this.httpProtocolVersion = null
            if (this.eventSource) {
                this.eventSource.close()
                this.eventSource = null
            }
            throw error
        }
    }

    shouldFallbackToSessionProtocol(error) {
        if (!(error instanceof McpHttpError)) return false
        if (error.status === 200 && error.code === -32601) return true
        if (![400, 404, 405].includes(error.status)) return false
        return ![-32020, -32021, -32022].includes(error.code)
    }

    async initializeHttpSession(protocolVersion) {
        this.httpEra = 'session'
        this.httpProtocolVersion = protocolVersion
        this.httpSessionId = null
        const result = await this.httpRequest(
            'initialize',
            {
                protocolVersion,
                capabilities: this.clientCapabilities,
                clientInfo: this.clientInfo
            },
            this.timeouts.connect
        )
        if (!SESSION_PROTOCOL_VERSIONS.has(result?.protocolVersion)) {
            throw new Error(`MCP server negotiated unsupported protocol version: ${result?.protocolVersion}`)
        }
        this.httpProtocolVersion = result.protocolVersion
        await this.httpNotification('notifications/initialized', {})
        this.serverCapabilities = result.capabilities || {}
        this.serverInfo = result.serverInfo || null
        return result
    }

    /**
     * 获取服务器信息
     * @returns {Object|null}
     */
    getServerInfo() {
        return this.serverInfo
    }

    /**
     * 获取服务器能力
     * @returns {Object}
     */
    getCapabilities() {
        return this.serverCapabilities || {}
    }

    /**
     * 检查是否支持某个能力
     * @param {string} capability - 能力名称
     * @returns {boolean}
     */
    hasCapability(capability) {
        return !!(this.serverCapabilities && this.serverCapabilities[capability])
    }

    /**
     * 获取服务器支持的工具列表
     * @returns {Promise<Array<Object>>} 工具列表
     */
    normalizeHttpTool(tool) {
        const schema = tool?.inputSchema ||
            tool?.function?.parameters ||
            tool?.parameters || {
                type: 'object',
                properties: {}
            }
        return { tool, schema }
    }

    /**
     * 过滤现代 HTTP 工具清单中的非法 x-mcp-header 声明，并缓存合法 schema。
     * @param {Array<Object>} tools - 服务端返回的工具
     * @returns {Array<Object>} 可安全调用的工具
     */
    filterModernHttpTools(tools) {
        if (this.httpEra !== 'modern') return tools
        return tools.filter(tool => {
            const { schema } = this.normalizeHttpTool(tool)
            const inspected = inspectMcpHeaderSchema(schema)
            if (inspected.error) {
                logger.warn(`[MCP] 忽略工具 ${tool?.name || '<unknown>'} 的非法 x-mcp-header 声明: ${inspected.error}`)
                return false
            }
            if (typeof tool?.name === 'string' && tool.name) this.toolSchemas.set(tool.name, schema)
            return true
        })
    }

    async listTools() {
        try {
            const tools = []
            const seenCursors = new Set()
            let cursor
            this.toolSchemas.clear()
            for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
                const result = await this.request('tools/list', cursor ? { cursor } : {})
                logger.debug(`[MCP] listTools raw result:`, JSON.stringify(result).substring(0, 500))

                // 兼容旧客户端直接返回工具数组的非标准形态。
                if (Array.isArray(result)) {
                    tools.push(...this.filterModernHttpTools(result))
                    return tools
                }
                if (!result || typeof result !== 'object' || !Array.isArray(result.tools)) {
                    if (result === undefined || result === null) logger.warn(`[MCP] listTools returned empty result`)
                    else logger.warn(`[MCP] Unexpected listTools response format:`, typeof result, result)
                    return tools
                }
                tools.push(...this.filterModernHttpTools(result.tools))

                const nextCursor = result.nextCursor
                if (nextCursor === undefined || nextCursor === null || nextCursor === '') return tools
                if (typeof nextCursor !== 'string' || seenCursors.has(nextCursor)) {
                    logger.warn('[MCP] listTools returned an invalid or repeated nextCursor; stopping pagination')
                    return tools
                }
                seenCursors.add(nextCursor)
                cursor = nextCursor
            }
            logger.warn(`[MCP] listTools pagination exceeded ${MAX_LIST_PAGES} pages; stopping`)
            return tools
        } catch (error) {
            logger.error(`[MCP] listTools failed: ${error.message}`)
            if (this.isConnectionError(error)) {
                throw error
            }
            return []
        }
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
     * 调用工具
     * @param {string} name - 工具名称
     * @param {Object} args - 工具参数
     * @param {Object} [options] - MRTR 重试字段
     * @param {Object} [options.inputResponses] - 对应 inputRequests 的响应映射
     * @param {string} [options.requestState] - 服务端返回的不透明请求状态
     * @returns {Promise<Object>} 工具执行结果
     */
    async callTool(name, args, options = {}) {
        const params = {
            name,
            arguments: this.normalizeToolArgs(args)
        }
        // MRTR 重试时由上层把服务端返回的 inputResponses/requestState 原样带回。
        // 不在这里猜测 elicitation/sampling 的业务内容，保证 requestState 作为不透明值传输。
        if (options.inputResponses !== undefined) params.inputResponses = options.inputResponses
        if (options.requestState !== undefined) params.requestState = options.requestState
        if ((this.type === 'http' || this.type === 'streamable-http') && this.httpEra === 'modern') {
            const schema = this.toolSchemas.get(name)
            const parameterHeaders = schema ? extractMcpParameterHeaders(schema, params.arguments) : {}
            return await this.request('tools/call', params, this.timeouts.request, { parameterHeaders })
        }
        return await this.request('tools/call', params)
    }

    async listResources() {
        if (!this.serverCapabilities?.resources) {
            return []
        }
        const resources = []
        const seenCursors = new Set()
        let cursor
        for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
            const result = await this.request('resources/list', cursor ? { cursor } : {})
            if (!result || typeof result !== 'object' || !Array.isArray(result.resources)) return resources
            resources.push(...result.resources)
            const nextCursor = result.nextCursor
            if (nextCursor === undefined || nextCursor === null || nextCursor === '') return resources
            if (typeof nextCursor !== 'string' || seenCursors.has(nextCursor)) return resources
            seenCursors.add(nextCursor)
            cursor = nextCursor
        }
        return resources
    }

    async readResource(uri) {
        if (!this.serverCapabilities?.resources) {
            throw new Error('Server does not support resources')
        }

        const result = await this.request('resources/read', { uri })
        // 资源读取除了正常的 contents 外，也允许返回 input_required。
        // 不能把后者静默折叠为空数组，否则上层无法携带 inputResponses 重试。
        return Array.isArray(result?.contents) ? result.contents : result
    }

    /**
     * 获取资源模板清单。
     * @returns {Promise<Array<Object>>} 资源模板列表
     */
    async listResourceTemplates() {
        if (!this.serverCapabilities?.resources) {
            return []
        }
        const templates = []
        const seenCursors = new Set()
        let cursor
        for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
            const result = await this.request('resources/templates/list', cursor ? { cursor } : {})
            if (!result || typeof result !== 'object' || !Array.isArray(result.resourceTemplates)) return templates
            templates.push(...result.resourceTemplates)
            const nextCursor = result.nextCursor
            if (nextCursor === undefined || nextCursor === null || nextCursor === '') return templates
            if (typeof nextCursor !== 'string' || seenCursors.has(nextCursor)) return templates
            seenCursors.add(nextCursor)
            cursor = nextCursor
        }
        return templates
    }

    async listPrompts() {
        if (!this.serverCapabilities?.prompts) {
            return []
        }
        const prompts = []
        const seenCursors = new Set()
        let cursor
        for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
            const result = await this.request('prompts/list', cursor ? { cursor } : {})
            if (!result || typeof result !== 'object' || !Array.isArray(result.prompts)) return prompts
            prompts.push(...result.prompts)
            const nextCursor = result.nextCursor
            if (nextCursor === undefined || nextCursor === null || nextCursor === '') return prompts
            if (typeof nextCursor !== 'string' || seenCursors.has(nextCursor)) return prompts
            seenCursors.add(nextCursor)
            cursor = nextCursor
        }
        return prompts
    }

    async getPrompt(name, args = {}) {
        if (!this.serverCapabilities?.prompts) {
            throw new Error('Server does not support prompts')
        }

        const normalizedArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {}
        const result = await this.request('prompts/get', { name, arguments: normalizedArgs })
        return result
    }

    /**
     * 终止当前进程（用于重连前清理）
     * @returns {Promise<void>}
     */
    async terminateProcess() {
        const child = this.process
        if (!child) return

        const pid = child.pid
        logger.debug(`[MCP] Terminating process PID: ${pid}`)
        // 先从当前连接解绑，旧进程稍后到达的 close/error 事件不能影响新连接。
        if (this.process === child) this.process = null

        return new Promise(resolve => {
            let settled = false
            let termTimer = null
            let forceKillTimeout = null
            const isAlive = () => child.exitCode === null && child.signalCode === null
            const finish = () => {
                if (settled) return
                settled = true
                if (termTimer) clearTimeout(termTimer)
                if (forceKillTimeout) clearTimeout(forceKillTimeout)
                logger.debug(`[MCP] Process ${pid} terminated gracefully`)
                resolve()
            }
            try {
                child.once('exit', finish)
                child.once('close', finish)
                child.once('error', error => {
                    logger.debug(`[MCP] Process ${pid} termination error: ${error.message}`)
                })
                // MCP stdio 规范要求先关闭 stdin，再等待服务端自行退出。
                child.stdin?.end()
                termTimer = setTimeout(
                    () => {
                        if (!isAlive()) return
                        try {
                            child.kill('SIGTERM')
                        } catch {
                            finish()
                        }
                    },
                    Math.min(100, Math.max(1, Math.floor(this.timeouts.terminate / 3)))
                )
                termTimer.unref?.()
                forceKillTimeout = setTimeout(() => {
                    if (isAlive()) {
                        try {
                            child.kill('SIGKILL')
                            logger.warn(`[MCP] Force killed process PID: ${pid}`)
                        } catch {
                            // 忽略
                        }
                    }
                    finish()
                }, this.timeouts.terminate)
                forceKillTimeout.unref?.()
                if (!isAlive()) finish()
            } catch {
                finish()
            }
        })
    }

    abortHttpRequests() {
        for (const controller of this.httpAbortControllers) controller.abort()
        this.httpAbortControllers.clear()
    }

    async deleteHttpSession() {
        if (this.httpEra !== 'session' || !this.httpSessionId || !this.httpUrl || !this.httpProtocolVersion) return
        const sessionId = this.httpSessionId
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeouts.terminate)
        try {
            const nodeFetch = (await import('node-fetch')).default
            const response = await nodeFetch(this.httpUrl, {
                ...proxyService.getFetchOptions(this.httpUrl, 'api'),
                method: 'DELETE',
                headers: {
                    ...this.httpHeaders,
                    Accept: 'application/json, text/event-stream',
                    'Mcp-Session-Id': sessionId,
                    'MCP-Protocol-Version': this.httpProtocolVersion
                },
                signal: controller.signal
            })
            if (![204, 404, 405].includes(response.status)) {
                logger.debug(`[MCP] Session DELETE returned HTTP ${response.status}`)
            }
            await response.arrayBuffer().catch(() => {})
        } catch (error) {
            logger.debug(`[MCP] Session DELETE failed: ${error.message}`)
        } finally {
            clearTimeout(timer)
            if (this.httpSessionId === sessionId) this.httpSessionId = null
        }
    }

    /**
     * 确保在重连前断开现有连接
     * @returns {Promise<void>}
     */
    async ensureDisconnected() {
        this.stopHeartbeat()
        this.clearReconnectTimer()
        const shouldRestoreReconnect = !this.disposed && this.config.autoReconnect !== false
        this.autoReconnect = false // 临时禁用自动重连

        if (this.process) {
            await this.terminateProcess()
        }

        if (this.eventSource) {
            this.eventSource.close()
            this.eventSource = null
        }
        this.abortHttpRequests()
        await this.deleteHttpSession()

        // 拒绝所有待处理请求
        for (const [, { reject }] of this.pendingRequests) {
            reject(new Error('Connection reset for reconnect'))
        }
        this.pendingRequests.clear()
        this.resetMessageBuffer()
        this.initialized = false
        this.initializationResult = null
        this.serverCapabilities = {}
        this.serverInfo = null
        this.httpEra = null
        this.httpProtocolVersion = null
        this.stdioEra = null
        this.stdioProtocolVersion = null
        this.stdioAutoFallback = false
        this.toolSchemas.clear()

        this.autoReconnect = this.disposed ? false : shouldRestoreReconnect // 恢复自动重连设置
    }

    /**
     * 断开与 MCP 服务器的连接
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.disposed = true
        this.connectionGeneration += 1
        this.stdioProbeAbortController?.abort()
        this.stdioProbeAbortController = null
        this.autoReconnect = false // 禁用自动重连
        this.clearReconnectTimer()
        this.stopHeartbeat()

        if (this.process) {
            await this.terminateProcess()
        }

        if (this.eventSource) {
            this.eventSource.close()
            this.eventSource = null
        }
        this.abortHttpRequests()
        await this.deleteHttpSession()

        this.initialized = false
        this.initializationResult = null
        this.serverCapabilities = {}
        this.serverInfo = null
        this.httpEra = null
        this.httpProtocolVersion = null
        this.stdioEra = null
        this.stdioProtocolVersion = null
        this.stdioAutoFallback = false
        this.toolSchemas.clear()
        this.resetMessageBuffer()
        for (const [, { reject }] of this.pendingRequests) {
            reject(new Error('Client disconnected'))
        }
        this.pendingRequests.clear()

        logger.debug('[MCP] Disconnected')
    }
}
