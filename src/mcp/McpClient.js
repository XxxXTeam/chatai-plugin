import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { EventSource } from 'eventsource'
import { chatLogger } from '../core/utils/logger.js'
import config from '../../config/config.js'

const logger = chatLogger

/** 从全局配置读取 MCP 超时配置 */
function getConfigTimeouts() {
    const mcpConfig = config.get('mcp') || {}
    const timeouts = mcpConfig.timeouts || {}
    return {
        connect: timeouts.connect || 30000,
        request: timeouts.request || 30000,
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
     * @param {string} [config.package] - npm/npx 模式的包名（如 @anthropic/mcp-server-filesystem）
     * @param {string} [config.url] - SSE/HTTP 模式的 URL
     * @param {Object} [config.env] - 环境变量
     * @param {Object} [config.headers] - HTTP 请求头
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
        /** @type {string|null} 服务器名称 */
        this.serverName = config.name || null

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
        this.clearReconnectTimer()
        await this.ensureDisconnected()

        try {
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
            await this.initialize()
            if (this.type !== 'http' && this.type !== 'streamable-http') {
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

        const { package: pkg, args = [], env = {}, cwd } = this.config

        if (!pkg) {
            throw new Error('npm/npx type requires "package" field, e.g. "@anthropic/mcp-server-filesystem"')
        }

        // 验证包名格式
        const validPackagePattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i
        if (!validPackagePattern.test(pkg)) {
            throw new Error(`Invalid npm package name: ${pkg}`)
        }

        // 构建 npx 参数
        // -y: 自动确认安装
        // --prefer-offline: 优先使用本地缓存
        const npxArgs = ['-y', '--prefer-offline', pkg, ...args]
        const displayCmd = `npx ${npxArgs.join(' ')}`
        logger.debug(`[MCP] Starting npm server: ${displayCmd}`)

        // 合并环境变量，支持 NODE_OPTIONS 等
        const mergedEnv = {
            ...process.env,
            ...env,
            // 确保 npm 包可以正确输出
            FORCE_COLOR: '0',
            NO_COLOR: '1'
        }

        try {
            this.process = spawn('npx', npxArgs, {
                env: mergedEnv,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
                cwd: cwd || process.cwd(),
                windowsHide: true
            })

            // 启动超时检测
            const startupTimeout = setTimeout(() => {
                if (!this.initialized) {
                    logger.warn(`[MCP] npm server startup timeout: ${pkg}`)
                }
            }, this.timeouts.startup)

            this.process.stdout.on('data', data => {
                clearTimeout(startupTimeout)
                this.handleData(data)
            })

            // 同 connectStdio：无 error 监听时 stdin 的异步 EPIPE 会崩掉整个进程
            this.process.stdin.on('error', error => {
                logger.warn(`[MCP] npm server stdin error: ${error.message}`)
            })

            // stderr 可能包含启动日志，区分错误和信息
            let stderrBuffer = ''
            this.process.stderr.on('data', data => {
                const text = data.toString()
                stderrBuffer += text

                // 过滤常见的 npm 信息日志
                if (text.includes('npm warn') || text.includes('npm notice')) {
                    logger.debug(`[MCP] npm info: ${text.trim()}`)
                } else if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
                    logger.error(`[MCP] Server stderr: ${text.trim()}`)
                } else {
                    logger.debug(`[MCP] Server output: ${text.trim()}`)
                }
            })

            this.process.on('close', code => {
                clearTimeout(startupTimeout)
                if (code !== 0 && code !== null) {
                    logger.warn(`[MCP] npm server exited with code ${code}`)
                    if (stderrBuffer) {
                        logger.debug(`[MCP] Last stderr: ${stderrBuffer.slice(-500)}`)
                    }
                }
                this.handleDisconnect()
            })

            this.process.on('error', error => {
                clearTimeout(startupTimeout)
                logger.error(`[MCP] npm server error:`, error.message)
                this.handleDisconnect()
            })

            // 等待进程启动
            await new Promise((resolve, reject) => {
                const checkInterval = setInterval(() => {
                    if (this.process && this.process.pid) {
                        clearInterval(checkInterval)
                        logger.debug(`[MCP] npm server started with PID: ${this.process.pid}`)
                        resolve()
                    }
                }, 50)

                setTimeout(() => {
                    clearInterval(checkInterval)
                    if (!this.process || !this.process.pid) {
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

        const { command, args, env } = this.config

        logger.debug(`[MCP] Spawning server: ${command} ${args ? args.join(' ') : ''}`)

        this.process = spawn(command, args || [], {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe']
        })

        this.process.stdout.on('data', data => this.handleData(data))
        this.process.stderr.on('data', data => {
            logger.warn(`[MCP] Server stderr: ${data.toString()}`)
        })
        /*
         * stdin 必须注册 error 监听：子进程存活但已关闭 stdin 时（MCP server 内部崩溃
         * 却未退出的典型形态），write 会异步 emit EPIPE。EventEmitter 对无监听器的
         * error 事件直接 throw，且它是异步事件，write 外层的 try/catch 捕获不到，
         * 结果是一个外部 MCP server 异常就能崩掉整个 Yunzai 进程。
         */
        this.process.stdin.on('error', error => {
            logger.warn(`[MCP] Server stdin error: ${error.message}`)
        })

        this.process.on('close', code => {
            logger.debug(`[MCP] Server exited with code ${code}`)
            this.handleDisconnect()
        })

        this.process.on('error', error => {
            logger.error(`[MCP] Process error:`, error)
            this.handleDisconnect()
        })
    }

    resolveSSEEndpoint(endpoint) {
        if (!endpoint) return endpoint
        if (/^https?:\/\//i.test(endpoint)) return endpoint

        try {
            return new URL(endpoint, this.config.url).toString()
        } catch (error) {
            return `${this.sseBaseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
        }
    }

    async connectSSE() {
        const { url, headers = {} } = this.config
        this.sseHeaders = headers

        // 解析 base URL
        this.sseBaseUrl = url.replace(/\/(sse|mcp|message)\/?$/, '')
        logger.debug(`[MCP] Connecting to SSE endpoint: ${url}`)

        // 使用自定义 fetch 传递 headers
        const eventSourceOptions =
            Object.keys(headers).length > 0
                ? {
                      fetch: (input, init) =>
                          fetch(input, {
                              ...init,
                              headers: { ...init?.headers, ...headers }
                          })
                  }
                : {}

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
                } catch (error) {
                    // 可能不是 JSON
                }
            }

            this.eventSource.onerror = error => {
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
        // Streamable HTTP 模式下初始化会话
        if (this.config.useStreamableHttp !== false) {
            await this.initStreamableHttpSession()
        }
    }

    /**
     * 初始化 Streamable HTTP 会话
     * 根据 MCP 2025-03-26 规范，发送 initialize 请求并获取 Mcp-Session-Id
     */
    async initStreamableHttpSession() {
        try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), this.timeouts.connect)

            const initBody = {
                jsonrpc: '2.0',
                id: crypto.randomUUID(),
                method: 'initialize',
                params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        roots: { listChanged: false },
                        sampling: {},
                        tools: { listChanged: true }
                    },
                    clientInfo: {
                        name: 'chatgpt-plugin',
                        version: '1.0.0'
                    }
                }
            }

            logger.debug(`[MCP] Streamable HTTP initializing session to ${this.httpUrl}`)
            const response = await fetch(this.httpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    ...this.httpHeaders
                },
                body: JSON.stringify(initBody),
                signal: controller.signal
            })

            clearTimeout(timer)

            // 提取会话 ID
            const sessionId = response.headers.get('Mcp-Session-Id')
            if (sessionId) {
                this.httpSessionId = sessionId
                logger.debug(`[MCP] Streamable HTTP session established: ${sessionId}`)
            }

            if (!response.ok) {
                const text = await response.text().catch(() => '')
                logger.warn(`[MCP] Streamable HTTP init returned ${response.status}: ${text}`)
                return
            }

            // 处理 SSE 流式响应或 JSON 响应
            const contentType = response.headers.get('content-type') || ''
            if (contentType.includes('text/event-stream')) {
                await this.parseSSEResponse(response)
            } else {
                const result = await response.json()
                if (result?.result?.capabilities) {
                    this.serverCapabilities = result.result.capabilities
                }
                if (result?.result?.serverInfo) {
                    this.serverInfo = result.result.serverInfo
                }
            }
        } catch (error) {
            logger.warn(`[MCP] Streamable HTTP session init failed: ${error.message}`)
            // 非致命错误，继续尝试无状态模式
        }
    }

    handleData(data) {
        this.messageBuffer += data.toString()
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

    handleMessage(message) {
        const pending = this.pendingRequests.get(message.id)
        const isPing = pending?.method === 'ping'
        if (!isPing) {
            const pendingIds = Array.from(this.pendingRequests.keys())
            logger.debug(
                `[MCP] handleMessage: id=${message.id}, method=${message.method}, hasResult=${message.result !== undefined}, pendingIds=[${pendingIds.join(', ')}]`
            )
        }

        if (message.id && pending) {
            const { resolve, reject } = pending
            this.pendingRequests.delete(message.id)
            if (!isPing) {
                logger.debug(`[MCP] Resolving request ${message.id}, hasError=${!!message.error}`)
            }

            if (message.error) {
                reject(new Error(message.error.message || JSON.stringify(message.error)))
            } else {
                // 返回 result 字段
                resolve(message.result)
            }
        } else if (message.method) {
            // Handle notifications or server requests
            this.handleNotification(message)
        } else if (message.id) {
            const unknownPendingIds = Array.from(this.pendingRequests.keys())
            logger.warn(
                `[MCP] Received response for unknown request id: ${message.id}, pendingIds=[${unknownPendingIds.join(', ')}]`
            )
        }
    }

    handleNotification(message) {
        logger.debug(`[MCP] Received notification: ${message.method}`)

        // Handle specific notifications
        if (message.method === 'tools/list_changed') {
            logger.debug('[MCP] Tools list changed, refreshing...')
            // Emit event for manager to handle
        }
    }

    handleDisconnect() {
        const wasInitialized = this.initialized
        const shouldReconnect = !this.disposed && wasInitialized && this.autoReconnect
        this.initialized = false
        this.stopHeartbeat()

        if (this.process) {
            // 尝试优雅关闭
            try {
                this.process.kill('SIGTERM')
            } catch (e) {
                // 忽略
            }
            this.process = null
        }
        if (this.eventSource) {
            this.eventSource.close()
            this.eventSource = null
        }

        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests) {
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
        } catch (error) {
            // Ping not supported, ignore
            return false
        }
    }

    async request(method, params, timeout = this.timeouts.request) {
        // streamable-http 与 http 在 connect() 中走同一分支（均不创建子进程），
        // 此处若漏判会落到下方的 stdio 分支并抛 'Client not connected'，
        // 而 inferServerType 会把 /mcp、/sse 结尾的 URL 判为 streamable-http，触发面很大
        if (this.type === 'http' || this.type === 'streamable-http') {
            return await this.httpRequest(method, params, timeout)
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
        if (!this.process) {
            throw new Error('Client not connected')
        }

        const id = crypto.randomUUID()
        const request = {
            jsonrpc: '2.0',
            id,
            method,
            params
        }

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id)
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
                this.process.stdin.write(message)
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
        } catch (error) {
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
                response = await fetch(url, {
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

        for (const [index, url] of messageUrls.entries()) {
            try {
                if (index > 0 && request.method !== 'ping') {
                    logger.debug(`[MCP] Retrying SSE POST to: ${url}, id: ${request.id}, method: ${request.method}`)
                }
                response = await fetch(url, {
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

    async httpRequest(method, params, timeout = this.timeouts.request) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)

        try {
            logger.debug(`[MCP] HTTP request: ${method} to ${this.httpUrl}`)
            const requestBody = {
                jsonrpc: '2.0',
                id: crypto.randomUUID(),
                method,
                params
            }

            // 构建请求头，支持 Streamable HTTP 会话 ID
            const headers = {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                ...this.httpHeaders
            }
            if (this.httpSessionId) {
                headers['Mcp-Session-Id'] = this.httpSessionId
            }

            const response = await fetch(this.httpUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal
            })

            clearTimeout(timer)

            // 更新会话 ID（服务器可能返回新的）
            const newSessionId = response.headers.get('Mcp-Session-Id')
            if (newSessionId && newSessionId !== this.httpSessionId) {
                this.httpSessionId = newSessionId
                logger.debug(`[MCP] Streamable HTTP session ID updated: ${newSessionId}`)
            }

            if (!response.ok) {
                const text = await response.text().catch(() => '')
                throw new Error(`HTTP request failed: ${response.status} ${response.statusText} ${text}`)
            }

            const contentType = response.headers.get('content-type') || ''

            // 处理 SSE 流式响应 (Streamable HTTP)
            if (contentType.includes('text/event-stream')) {
                return await this.parseSSEResponse(response)
            }

            // 处理普通 JSON 响应
            const result = await response.json()
            logger.debug(`[MCP] HTTP response for ${method}:`, JSON.stringify(result).substring(0, 200))

            if (result.error) {
                throw new Error(result.error.message || JSON.stringify(result.error))
            }

            return result.result
        } catch (error) {
            clearTimeout(timer)
            logger.error(`[MCP] HTTP request failed for ${method}: ${error.message}`, error.stack)
            throw error
        }
    }

    /**
     * 解析 SSE 流式响应 (Streamable HTTP MCP)
     */
    async parseSSEResponse(response) {
        const text = await response.text()
        logger.debug(`[MCP] SSE response text:`, text.substring(0, 500))

        // 解析 SSE 格式: "event: message\ndata: {...}\n\n"
        const lines = text.split('\n')
        let jsonData = null

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim()
            if (line.startsWith('data:')) {
                const dataStr = line.substring(5).trim()
                if (dataStr) {
                    try {
                        jsonData = JSON.parse(dataStr)
                        // 如果找到有效的 JSON-RPC 响应，返回结果
                        if (jsonData && (jsonData.result !== undefined || jsonData.error)) {
                            break
                        }
                    } catch (e) {
                        // 继续尝试下一行
                    }
                }
            }
        }

        if (!jsonData) {
            throw new Error('No valid JSON-RPC response found in SSE stream')
        }

        if (jsonData.error) {
            throw new Error(jsonData.error.message || JSON.stringify(jsonData.error))
        }

        return jsonData.result
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

    async initialize() {
        try {
            // Streamable HTTP 模式下，initialize 已在会话初始化时发送
            let result = null
            if (this.type === 'streamable-http' && this.serverCapabilities && this.serverInfo) {
                result = {
                    capabilities: this.serverCapabilities,
                    serverInfo: this.serverInfo
                }
            } else {
                result = await this.request('initialize', {
                    protocolVersion: '2024-11-05',
                    capabilities: {
                        roots: { listChanged: false },
                        sampling: {},
                        tools: { listChanged: true }
                    },
                    clientInfo: {
                        name: 'chatgpt-plugin',
                        version: '1.0.0'
                    }
                })
            }

            this.initialized = true
            this.serverCapabilities = result?.capabilities || {}
            this.serverInfo = result?.serverInfo || null

            // 记录服务器信息
            if (this.serverInfo) {
                logger.info(
                    `[MCP] Connected to server: ${this.serverInfo.name || 'unknown'} v${this.serverInfo.version || '?'}`
                )
            }

            const initializedNotification = {
                jsonrpc: '2.0',
                method: 'notifications/initialized'
            }

            if ((this.type === 'stdio' || this.type === 'npm' || this.type === 'npx') && this.process) {
                this.process.stdin.write(JSON.stringify(initializedNotification) + '\n')
            } else if (this.type === 'sse') {
                await this.sendSSENotification(initializedNotification)
            } else if (this.type === 'streamable-http') {
                // Streamable HTTP 模式下发送 initialized 通知
                await this.httpRequest('notifications/initialized', {}).catch(err =>
                    logger.debug(`[MCP] Streamable HTTP initialized notification: ${err.message}`)
                )
            }

            const capabilities = Object.keys(this.serverCapabilities || {})
            logger.debug(`[MCP] Server capabilities: ${capabilities.join(', ') || 'none'}`)
            return result
        } catch (error) {
            if (this.isConnectionError(error)) {
                this.initialized = false
                this.serverCapabilities = {}
                throw error
            }

            // 某些 MCP 服务器可能不支持 initialize，尝试继续
            logger.warn(`[MCP] Initialize failed (may be unsupported): ${error.message}`)
            this.initialized = true
            this.serverCapabilities = {}
            return {}
        }
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
    async listTools() {
        try {
            const result = await this.request('tools/list')
            logger.debug(`[MCP] listTools raw result:`, JSON.stringify(result).substring(0, 500))

            // 处理不同的响应格式
            if (Array.isArray(result)) {
                return result
            }
            if (result?.tools && Array.isArray(result.tools)) {
                return result.tools
            }
            if (result === undefined || result === null) {
                logger.warn(`[MCP] listTools returned empty result`)
                return []
            }

            logger.warn(`[MCP] Unexpected listTools response format:`, typeof result, result)
            return []
        } catch (error) {
            logger.error(`[MCP] listTools failed: ${error.message}`)
            if (this.isConnectionError(error)) {
                throw error
            }
            return []
        }
    }

    /**
     * 调用工具
     * @param {string} name - 工具名称
     * @param {Object} args - 工具参数
     * @returns {Promise<Object>} 工具执行结果
     */
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
            } catch (error) {}
        }
        return { value: args }
    }

    async callTool(name, args) {
        const result = await this.request('tools/call', {
            name,
            arguments: this.normalizeToolArgs(args)
        })
        return result
    }

    async listResources() {
        if (!this.serverCapabilities?.resources) {
            return []
        }

        const result = await this.request('resources/list')
        return result.resources || []
    }

    async readResource(uri) {
        if (!this.serverCapabilities?.resources) {
            throw new Error('Server does not support resources')
        }

        const result = await this.request('resources/read', { uri })
        return result.contents || []
    }

    async listPrompts() {
        if (!this.serverCapabilities?.prompts) {
            return []
        }

        const result = await this.request('prompts/list')
        return result.prompts || []
    }

    async getPrompt(name, args = {}) {
        if (!this.serverCapabilities?.prompts) {
            throw new Error('Server does not support prompts')
        }

        const result = await this.request('prompts/get', { name, arguments: args })
        return result
    }

    /**
     * 终止当前进程（用于重连前清理）
     * @returns {Promise<void>}
     */
    async terminateProcess() {
        if (!this.process) return

        const pid = this.process.pid
        logger.debug(`[MCP] Terminating process PID: ${pid}`)

        return new Promise(resolve => {
            const forceKillTimeout = setTimeout(() => {
                if (this.process) {
                    try {
                        this.process.kill('SIGKILL')
                        logger.warn(`[MCP] Force killed process PID: ${pid}`)
                    } catch (e) {
                        // 忽略
                    }
                }
                this.process = null
                resolve()
            }, this.timeouts.terminate)

            try {
                this.process.once('exit', () => {
                    clearTimeout(forceKillTimeout)
                    this.process = null
                    logger.debug(`[MCP] Process ${pid} terminated gracefully`)
                    resolve()
                })
                this.process.kill('SIGTERM')
            } catch (e) {
                clearTimeout(forceKillTimeout)
                this.process = null
                resolve()
            }
        })
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

        // 拒绝所有待处理请求
        for (const [id, { reject }] of this.pendingRequests) {
            reject(new Error('Connection reset for reconnect'))
        }
        this.pendingRequests.clear()
        this.messageBuffer = ''

        this.autoReconnect = shouldRestoreReconnect // 恢复自动重连设置
    }

    /**
     * 断开与 MCP 服务器的连接
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.disposed = true
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

        this.initialized = false
        for (const [id, { reject }] of this.pendingRequests) {
            reject(new Error('Client disconnected'))
        }
        this.pendingRequests.clear()

        logger.debug('[MCP] Disconnected')
    }
}
