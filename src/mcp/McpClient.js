import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { EventSource } from 'eventsource'
import { chatLogger } from '../core/utils/logger.js'

const logger = chatLogger

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
     * @param {string} [config.type='stdio'] - 传输类型: stdio | npm | npx | sse | http
     * @param {string} [config.command] - stdio 模式的命令
     * @param {string[]} [config.args] - 命令参数
     * @param {string} [config.package] - npm/npx 模式的包名（如 @anthropic/mcp-server-filesystem）
     * @param {string} [config.url] - SSE/HTTP 模式的 URL
     * @param {Object} [config.env] - 环境变量
     * @param {Object} [config.headers] - HTTP 请求头
     * @param {number} [config.timeout=30000] - 连接超时时间（毫秒）
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
        /** @type {number} 重连尝试次数 */
        this.reconnectAttempts = 0
        /** @type {number} 最大重连次数 */
        this.maxReconnectAttempts = config.maxReconnectAttempts || 5
        /** @type {number} 连接超时时间 */
        this.timeout = config.timeout || 30000
        /** @type {boolean} 是否自动重连 */
        this.autoReconnect = config.autoReconnect !== false
        /** @type {Object|null} 服务器信息 */
        this.serverInfo = null
        /** @type {string|null} 服务器名称 */
        this.serverName = config.name || null
    }

    /**
     * 连接到 MCP 服务器
     * @returns {Promise<void>}
     * @throws {Error} 连接失败时抛出错误
     */
    async connect() {
        if (this.initialized) return
        await this.ensureDisconnected()

        try {
            if (this.type === 'stdio') {
                await this.connectStdio()
            } else if (this.type === 'npm' || this.type === 'npx') {
                await this.connectNpm()
            } else if (this.type === 'sse') {
                await this.connectSSE()
            } else if (this.type === 'http') {
                await this.connectHTTP()
            } else {
                throw new Error(`Unsupported transport type: ${this.type}`)
            }
            await this.initialize()
            if (this.type !== 'http') {
                this.startHeartbeat()
            }
            this.reconnectAttempts = 0

            logger.info(`[MCP] Connected successfully via ${this.type}`)
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
            }, this.timeout)

            this.process.stdout.on('data', data => {
                clearTimeout(startupTimeout)
                this.handleData(data)
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
                }, 5000)
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

        this.process.on('close', code => {
            logger.debug(`[MCP] Server exited with code ${code}`)
            this.handleDisconnect()
        })

        this.process.on('error', error => {
            logger.error(`[MCP] Process error:`, error)
            this.handleDisconnect()
        })
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
            }, 15000)
            this.eventSource.addEventListener('endpoint', event => {
                this.sseMessageEndpoint = event.data
                if (this.sseMessageEndpoint && !this.sseMessageEndpoint.startsWith('http')) {
                    this.sseMessageEndpoint = this.sseBaseUrl + this.sseMessageEndpoint
                }
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
                }, 2000)
            }
        })
    }

    async connectHTTP() {
        const { url, headers } = this.config
        this.httpUrl = url
        this.httpHeaders = headers || {}
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
            logger.warn(
                `[MCP] Received response for unknown request id: ${message.id}, pendingIds=[${pendingIds.join(', ')}]`
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

        // 只有之前已初始化且允许自动重连时才尝试重连
        if (wasInitialized && this.autoReconnect) {
            this.attemptReconnect()
        }
    }

    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('[MCP] Max reconnection attempts reached')
            return
        }

        this.reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)

        logger.debug(
            `[MCP] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        )

        setTimeout(async () => {
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
        }, 30000) // 30 seconds
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval)
            this.heartbeatInterval = null
        }
    }

    async ping() {
        try {
            await this.request('ping', {}, 5000)
            return true
        } catch (error) {
            // Ping not supported, ignore
            return false
        }
    }

    async request(method, params, timeout = 30000) {
        if (this.type === 'http') {
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
    async sendSSERequest(request, timeout = 30000) {
        const { headers: configHeaders = {} } = this.config

        // 构建完整的消息端点 URL
        let messageUrl
        if (this.sseMessageEndpoint) {
            messageUrl = this.sseMessageEndpoint.startsWith('http')
                ? this.sseMessageEndpoint
                : `${this.sseBaseUrl}${this.sseMessageEndpoint}`
        } else {
            messageUrl = this.sseUrl || this.config.url
        }

        // 对 ping 方法不输出 debug 日志（心跳每30秒调用一次，避免日志过多）
        if (request.method !== 'ping') {
            logger.debug(`[MCP] SSE POST to: ${messageUrl}, id: ${request.id}, method: ${request.method}`)
        }

        // 先注册 pending request，再发送 POST（避免时序问题：SSE 响应可能在 POST 返回前到达）
        const responsePromise = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pendingRequests.has(request.id)) {
                    this.pendingRequests.delete(request.id)
                    reject(new Error(`SSE response timeout for ${request.method}`))
                }
            }, timeout)

            this.pendingRequests.set(request.id, {
                method: request.method,
                resolve: result => {
                    clearTimeout(timer)
                    resolve(result)
                },
                reject: err => {
                    clearTimeout(timer)
                    reject(err)
                }
            })
        })

        // 发送 POST 请求
        let response
        try {
            response = await fetch(messageUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    ...configHeaders
                },
                body: JSON.stringify(request)
            })
        } catch (fetchError) {
            this.pendingRequests.delete(request.id)
            throw new Error(`SSE POST failed: ${fetchError.message}`)
        }

        if (!response.ok) {
            this.pendingRequests.delete(request.id)
            const text = await response.text().catch(() => '')
            throw new Error(`SSE request failed: ${response.status} ${response.statusText} ${text}`)
        }

        // 检查响应
        const responseText = await response.text()
        if (request.method !== 'ping') {
            logger.debug(`[MCP] SSE POST response status: ${response.status}, body: ${responseText.substring(0, 100)}`)
        }

        // 如果是 202 Accepted 或 "Accepted"，等待 SSE 流响应
        if (response.status === 202 || responseText === 'Accepted' || responseText.trim() === '') {
            if (request.method !== 'ping') {
                logger.debug(`[MCP] Waiting for SSE stream response for id: ${request.id}`)
            }
            return await responsePromise
        }

        // 尝试解析 JSON 响应（某些服务器可能直接返回结果）
        try {
            this.pendingRequests.delete(request.id)
            const jsonResponse = JSON.parse(responseText)
            if (jsonResponse.error) {
                throw new Error(jsonResponse.error.message || JSON.stringify(jsonResponse.error))
            }
            return jsonResponse.result !== undefined ? jsonResponse.result : jsonResponse
        } catch (e) {
            // 如果不是 JSON，等待 SSE 响应
            logger.debug(`[MCP] Response not JSON, waiting for SSE stream...`)
            return await responsePromise
        }
    }

    async httpRequest(method, params, timeout = 30000) {
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

            const response = await fetch(this.httpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/event-stream',
                    ...this.httpHeaders
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            })

            clearTimeout(timer)

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

    async initialize() {
        try {
            const result = await this.request('initialize', {
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

            this.initialized = true
            this.serverCapabilities = result?.capabilities || {}
            this.serverInfo = result?.serverInfo || null

            // 记录服务器信息
            if (this.serverInfo) {
                logger.info(
                    `[MCP] Connected to server: ${this.serverInfo.name || 'unknown'} v${this.serverInfo.version || '?'}`
                )
            }

            // Send initialized notification (only for stdio/npm/npx types with process)
            if ((this.type === 'stdio' || this.type === 'npm' || this.type === 'npx') && this.process) {
                this.process.stdin.write(
                    JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'notifications/initialized'
                    }) + '\n'
                )
            }

            const capabilities = Object.keys(this.serverCapabilities || {})
            logger.debug(`[MCP] Server capabilities: ${capabilities.join(', ') || 'none'}`)
            return result
        } catch (error) {
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
            const result = await this.request('tools/list', {})
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
            return []
        }
    }

    /**
     * 调用工具
     * @param {string} name - 工具名称
     * @param {Object} args - 工具参数
     * @returns {Promise<Object>} 工具执行结果
     */
    async callTool(name, args) {
        const result = await this.request('tools/call', {
            name,
            arguments: args
        })
        return result
    }

    async listResources() {
        if (!this.serverCapabilities?.resources) {
            return []
        }

        const result = await this.request('resources/list', {})
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

        const result = await this.request('prompts/list', {})
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
            }, 3000)

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

        this.autoReconnect = this.config.autoReconnect !== false // 恢复自动重连设置
    }

    /**
     * 断开与 MCP 服务器的连接
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.stopHeartbeat()
        this.autoReconnect = false // 禁用自动重连

        if (this.process) {
            await this.terminateProcess()
        }

        if (this.eventSource) {
            this.eventSource.close()
            this.eventSource = null
        }

        this.initialized = false
        this.pendingRequests.clear()

        logger.debug('[MCP] Disconnected')
    }
}
