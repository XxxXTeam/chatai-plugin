import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { EventSource } from 'eventsource'

/**
 * MCP Client - Model Context Protocol 客户端实现
 * 
 * @description 支持多种传输类型连接 MCP 服务器
 * - stdio: 标准输入输出（本地进程）
 * - npm/npx: npm 包形式的 MCP 服务器
 * - sse: Server-Sent Events
 * - http: HTTP 请求
 * 
 * @example
 * ```js
 * const client = new McpClient({ type: 'stdio', command: 'node', args: ['server.js'] })
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
     * @param {string} [config.package] - npm/npx 模式的包名
     * @param {string} [config.url] - SSE/HTTP 模式的 URL
     * @param {Object} [config.env] - 环境变量
     * @param {Object} [config.headers] - HTTP 请求头
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
        this.maxReconnectAttempts = 5
    }

    /**
     * 连接到 MCP 服务器
     * @returns {Promise<void>}
     * @throws {Error} 连接失败时抛出错误
     */
    async connect() {
        if (this.initialized) return

        try {
            if (this.type === 'stdio') {
                await this.connectStdio()
            } else if (this.type === 'npm' || this.type === 'npx') {
                // npm 包形式的 MCP 服务器，如 @upstash/context7-mcp
                await this.connectNpm()
            } else if (this.type === 'sse') {
                await this.connectSSE()
            } else if (this.type === 'http') {
                await this.connectHTTP()
            } else {
                throw new Error(`Unsupported transport type: ${this.type}`)
            }

            await this.initialize()
            this.startHeartbeat()
            this.reconnectAttempts = 0

            logger.info(`[MCP] Connected successfully via ${this.type}`)
        } catch (error) {
            logger.error(`[MCP] Connection failed:`, error)
            throw error
        }
    }

    /**
     * 连接 npm 包形式的 MCP 服务器
     * 配置示例: { type: 'npm', package: '@upstash/context7-mcp', env: { ... } }
     */
    async connectNpm() {
        if (this.process) return

        const { package: pkg, args = [], env } = this.config
        
        if (!pkg) {
            throw new Error('npm/npx type requires "package" field, e.g. "@upstash/context7-mcp"')
        }

        const npxArgs = ['-y', pkg, ...args]
        logger.debug(`[MCP] Spawning npm server: npx ${npxArgs.join(' ')}`)

        this.process = spawn('npx', npxArgs, {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32'
        })

        this.process.stdout.on('data', (data) => this.handleData(data))
        this.process.stderr.on('data', (data) => {
            logger.warn(`[MCP] Server stderr: ${data.toString()}`)
        })

        this.process.on('close', (code) => {
            logger.debug(`[MCP] Server exited with code ${code}`)
            this.handleDisconnect()
        })

        this.process.on('error', (error) => {
            logger.error(`[MCP] Process error:`, error)
            this.handleDisconnect()
        })
    }

    async connectStdio() {
        if (this.process) return

        const { command, args, env } = this.config

        logger.debug(`[MCP] Spawning server: ${command} ${args ? args.join(' ') : ''}`)

        this.process = spawn(command, args || [], {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe']
        })

        this.process.stdout.on('data', (data) => this.handleData(data))
        this.process.stderr.on('data', (data) => {
            logger.warn(`[MCP] Server stderr: ${data.toString()}`)
        })

        this.process.on('close', (code) => {
            logger.debug(`[MCP] Server exited with code ${code}`)
            this.handleDisconnect()
        })

        this.process.on('error', (error) => {
            logger.error(`[MCP] Process error:`, error)
            this.handleDisconnect()
        })
    }

    async connectSSE() {
        const { url } = this.config
        this.sseUrl = url  // 保存 URL 用于发送请求

        this.eventSource = new EventSource(url)

        this.eventSource.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data)
                this.handleMessage(message)
            } catch (error) {
                logger.error(`[MCP] Failed to parse SSE message:`, error)
            }
        }

        this.eventSource.onerror = (error) => {
            // 只在需要时记录详细错误
            if (error.type === 'error') {
                logger.warn(`[MCP] SSE connection error`)
            }
            // 检查连接状态，只有在非正常关闭时才尝试重连
            if (this.eventSource?.readyState === EventSource.CLOSED) {
                this.handleDisconnect()
            }
        }
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('SSE connection timeout')), 10000)
            this.eventSource.onopen = () => {
                clearTimeout(timeout)
                resolve()
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
        if (message.id && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id)
            this.pendingRequests.delete(message.id)

            if (message.error) {
                reject(new Error(message.error.message || JSON.stringify(message.error)))
            } else {
                resolve(message.result)
            }
        } else if (message.method) {
            // Handle notifications or server requests
            this.handleNotification(message)
        }
    }

    handleNotification(message) {
        logger.debug(`[MCP] Received notification: ${message.method}`)

        // Handle specific notifications
        if (message.method === 'tools/list_changed') {
            logger.info('[MCP] Tools list changed, refreshing...')
            // Emit event for manager to handle
        }
    }

    handleDisconnect() {
        this.initialized = false
        this.stopHeartbeat()

        if (this.process) {
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

        // Attempt reconnection
        this.attemptReconnect()
    }

    async attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('[MCP] Max reconnection attempts reached')
            return
        }

        this.reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)

        logger.info(`[MCP] Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

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

        if (!this.process && !this.eventSource) {
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
                resolve: (res) => {
                    clearTimeout(timer)
                    resolve(res)
                },
                reject: (err) => {
                    clearTimeout(timer)
                    reject(err)
                }
            })

            try {
                const message = JSON.stringify(request) + '\n'
                if ((this.type === 'stdio' || this.type === 'npm' || this.type === 'npx') && this.process) {
                    this.process.stdin.write(message)
                } else if (this.type === 'sse') {
                    this.sendSSERequest(request).then(response => {
                        if (response.id === id) {
                            const pending = this.pendingRequests.get(id)
                            if (pending) {
                                this.pendingRequests.delete(id)
                                if (response.error) {
                                    pending.reject(new Error(response.error.message || 'SSE request failed'))
                                } else {
                                    pending.resolve(response.result)
                                }
                            }
                        }
                    }).catch(err => {
                        const pending = this.pendingRequests.get(id)
                        if (pending) {
                            this.pendingRequests.delete(id)
                            pending.reject(err)
                        }
                    })
                    return 
                }
            } catch (err) {
                this.pendingRequests.delete(id)
                clearTimeout(timer)
                reject(err)
            }
        })
    }

    /**
     * 发送 SSE 类型的请求（通过 HTTP POST）
     */
    async sendSSERequest(request) {
        const { headers = {} } = this.config
        const response = await fetch(this.sseUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                ...headers 
            },
            body: JSON.stringify(request)
        })
        
        if (!response.ok) {
            const text = await response.text().catch(() => '')
            throw new Error(`SSE request failed: ${response.status} ${response.statusText} ${text}`)
        }
        
        return await response.json()
    }

    async httpRequest(method, params, timeout = 30000) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)

        try {
            const response = await fetch(this.httpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    ...this.httpHeaders
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: crypto.randomUUID(),
                    method,
                    params
                }),
                signal: controller.signal
            })

            clearTimeout(timer)

            if (!response.ok) {
                const text = await response.text().catch(() => '')
                throw new Error(`HTTP request failed: ${response.status} ${response.statusText} ${text}`)
            }

            const result = await response.json()

            if (result.error) {
                throw new Error(result.error.message || JSON.stringify(result.error))
            }

            return result.result
        } catch (error) {
            clearTimeout(timer)
            throw error
        }
    }

    async initialize() {
        const result = await this.request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {
                roots: { listChanged: false },
                sampling: {}
            },
            clientInfo: {
                name: 'yunzai-new-plugin',
                version: '1.0.0'
            }
        })

        this.initialized = true
        this.serverCapabilities = result.capabilities || {}

        // Send initialized notification
        if (this.type === 'stdio' && this.process) {
            this.process.stdin.write(JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/initialized'
            }) + '\n')
        }

        logger.debug('[MCP] Initialized with capabilities:', Object.keys(this.serverCapabilities || {}))
        return result
    }

    /**
     * 获取服务器支持的工具列表
     * @returns {Promise<Array<Object>>} 工具列表
     */
    async listTools() {
        const result = await this.request('tools/list', {})
        return result.tools || []
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
     * 断开与 MCP 服务器的连接
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.stopHeartbeat()

        if (this.process) {
            this.process.kill()
            this.process = null
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
