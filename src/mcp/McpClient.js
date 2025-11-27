import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { EventSource } from 'eventsource'

/**
 * MCP Client implementation
 * Supports multiple transport types: stdio, SSE, HTTP
 */
export class McpClient {
    constructor(config) {
        this.config = config
        this.type = config.type || 'stdio'
        this.process = null
        this.eventSource = null
        this.pendingRequests = new Map()
        this.messageBuffer = ''
        this.initialized = false
        this.heartbeatInterval = null
        this.reconnectAttempts = 0
        this.maxReconnectAttempts = 5
    }

    async connect() {
        if (this.initialized) return

        try {
            if (this.type === 'stdio') {
                await this.connectStdio()
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

    async connectStdio() {
        if (this.process) return

        const { command, args, env } = this.config

        logger.info(`[MCP] Spawning server: ${command} ${args ? args.join(' ') : ''}`)

        this.process = spawn(command, args || [], {
            env: { ...process.env, ...env },
            stdio: ['pipe', 'pipe', 'pipe']
        })

        this.process.stdout.on('data', (data) => this.handleData(data))
        this.process.stderr.on('data', (data) => {
            logger.warn(`[MCP] Server stderr: ${data.toString()}`)
        })

        this.process.on('close', (code) => {
            logger.info(`[MCP] Server exited with code ${code}`)
            this.handleDisconnect()
        })

        this.process.on('error', (error) => {
            logger.error(`[MCP] Process error:`, error)
            this.handleDisconnect()
        })
    }

    async connectSSE() {
        const { url } = this.config

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
            logger.error(`[MCP] SSE error:`, error)
            this.handleDisconnect()
        }

        // Wait for connection
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('SSE connection timeout')), 10000)
            this.eventSource.onopen = () => {
                clearTimeout(timeout)
                resolve()
            }
        })
    }

    async connectHTTP() {
        const { url } = this.config
        this.httpUrl = url

        // Test connection
        const response = await fetch(url, { method: 'HEAD' })
        if (!response.ok) {
            throw new Error(`HTTP connection failed: ${response.statusText}`)
        }
    }

    handleData(data) {
        this.messageBuffer += data.toString()

        // Process buffer for newline-delimited JSON messages
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

                if (this.type === 'stdio' && this.process) {
                    this.process.stdin.write(message)
                } else if (this.type === 'sse' && this.eventSource) {
                    // For SSE, we need a separate HTTP endpoint for requests
                    // This is implementation-specific
                    throw new Error('SSE request not implemented')
                }
            } catch (err) {
                this.pendingRequests.delete(id)
                clearTimeout(timer)
                reject(err)
            }
        })
    }

    async httpRequest(method, params, timeout = 30000) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeout)

        try {
            const response = await fetch(this.httpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
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
                throw new Error(`HTTP request failed: ${response.statusText}`)
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

        logger.info('[MCP] Initialized with capabilities:', this.serverCapabilities)
        return result
    }

    async listTools() {
        const result = await this.request('tools/list', {})
        return result.tools || []
    }

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

        logger.info('[MCP] Disconnected')
    }
}
