import express from 'express'
import { rateLimit } from 'express-rate-limit'
import multer from 'multer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import config from '../../config/config.js'
import { mcpManager } from '../mcp/McpManager.js'
import { presetManager } from './PresetManager.js'
import { channelManager } from './ChannelManager.js'
import { imageService } from './ImageService.js'
import { databaseService } from './DatabaseService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 获取已初始化的数据库服务
 */
function getDatabase() {
    if (!databaseService.initialized) {
        databaseService.init()
    }
    return databaseService
}

// ChaiteResponse helper class
class ChaiteResponse {
    constructor(code, data, message) {
        this.code = code
        this.data = data
        this.message = message
    }

    static ok(data) {
        return new ChaiteResponse(0, data, 'ok')
    }

    static fail(data, msg) {
        return new ChaiteResponse(-1, data, msg)
    }
}

// JWT signing key
let authKey = crypto.randomUUID()

// Frontend Authentication Handler for temporary token-based auth
class FrontendAuthHandler {
    constructor() {
        this.tokens = new Map() // 支持多个 token
    }

    generateToken(timeout = 5 * 60) {
        const timestamp = Math.floor(Date.now() / 1000)
        const randomString = Math.random().toString(36).substring(2, 15)
        const token = `${timestamp}-${randomString}`
        const expiry = Date.now() + timeout * 1000

        this.tokens.set(token, expiry)

        // 自动清理过期 token
        setTimeout(() => {
            this.tokens.delete(token)
        }, timeout * 1000)

        return token
    }

    validateToken(token) {
        if (!token) return false

        const expiry = this.tokens.get(token)
        if (expiry && Date.now() < expiry) {
            // 验证成功后删除（一次性使用）
            this.tokens.delete(token)
            return true
        }

        return false
    }
}

const authHandler = new FrontendAuthHandler()

// 获取本地和公网地址
async function getServerAddresses(port) {
    const addresses = {
        local: [],
        public: null
    }
    
    // 获取本地地址
    try {
        const os = await import('node:os')
        const interfaces = os.networkInterfaces()
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    addresses.local.push(`http://${iface.address}:${port}`)
                }
            }
        }
        // 添加 localhost
        addresses.local.unshift(`http://127.0.0.1:${port}`)
    } catch (e) {
        addresses.local = [`http://127.0.0.1:${port}`]
    }
    
    // 获取公网地址
    try {
        const https = await import('node:https')
        const http = await import('node:http')
        
        const getPublicIP = () => new Promise((resolve) => {
            const services = [
                { url: 'https://api.ipify.org', https: true },
                { url: 'https://icanhazip.com', https: true },
                { url: 'http://ip-api.com/line/?fields=query', https: false }
            ]
            
            let resolved = false
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true
                    resolve(null)
                }
            }, 5000)
            
            for (const service of services) {
                const client = service.https ? https : http
                client.get(service.url, { timeout: 3000 }, (res) => {
                    let data = ''
                    res.on('data', chunk => data += chunk)
                    res.on('end', () => {
                        if (!resolved && data.trim()) {
                            resolved = true
                            clearTimeout(timeout)
                            resolve(data.trim())
                        }
                    })
                }).on('error', () => {})
            }
        })
        
        const publicIP = await getPublicIP()
        if (publicIP && /^\d+\.\d+\.\d+\.\d+$/.test(publicIP)) {
            addresses.public = `http://${publicIP}:${port}`
        }
    } catch (e) {
        // 忽略公网获取失败
    }
    
    return addresses
}

// Web server for management panel
export class WebServer {
    constructor() {
        this.app = express()
        this.port = config.get('web.port') || 3000
        this.server = null
        this.addresses = { local: [], public: null }

        this.setupMiddleware()
        this.setupRoutes()
    }

    setupMiddleware() {
        this.app.use(express.json({ limit: '50mb' }))
        this.app.use(express.urlencoded({ extended: true, limit: '50mb' }))
        this.app.use(express.static(path.join(__dirname, '../../resources/web')))



        // MCP Routes Limiting
        const limiter = rateLimit({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // Limit each IP to 100 requests per windowMs
            standardHeaders: true,
            legacyHeaders: false,
            message: ChaiteResponse.fail(null, 'Too many requests, please try again later.')
        })

        // Apply to all API routes
        this.app.use('/api/', limiter)

        // Request logging middleware (audit trail) - DISABLED for less noise
        // this.app.use('/api/', (req, res, next) => {
        //     const startTime = Date.now()

        //     // Log request
        //     logger.info(`[API] ${req.method} ${req.path}`, {
        //         ip: req.ip,
        //         userAgent: req.get('user-agent'),
        //         body: req.method === 'POST' || req.method === 'PUT' ? '[REDACTED]' : undefined
        //     })

        //     // Log response
        //     res.on('finish', () => {
        //         const duration = Date.now() - startTime
        //         logger.info(`[API] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`)
        //     })

        //     next()
        // })




        // Global error handler
        this.app.use((err, req, res, next) => {
            logger.error('[WebServer] Error:', err)

            if (res.headersSent) {
                return next(err)
            }

            res.status(err.status || 500).json(ChaiteResponse.fail(null,
                config.get('basic.debug') ? err.message : 'Internal server error'
            ))
        })
    }

    // JWT authentication middleware
    authMiddleware(req, res, next) {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json(ChaiteResponse.fail(null, 'Unauthorized'))
        }

        const token = authHeader.substring(7)
        try {
            const decoded = jwt.verify(token, authKey)
            req.user = decoded
            next()
        } catch (error) {
            return res.status(401).json(ChaiteResponse.fail(null, 'Invalid token'))
        }
    }

    setupRoutes() {
        // ==================== Auth Routes ====================
        // GET /login/token - Token-based login via URL (兼容方式)
        this.app.get('/login/token', async (req, res) => {
            const { token } = req.query

            if (!token) {
                return res.status(400).send('Token is required')
            }

            try {
                const success = authHandler.validateToken(token)
                if (success) {
                    // Generate JWT for session
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now()
                    }, authKey, { expiresIn: '30d' })

                    logger.info('[Auth] Login successful via URL token')
                    
                    // 重定向到前端，带上 token
                    res.redirect(`/?auth_token=${jwtToken}`)
                } else {
                    res.status(401).send('Invalid or expired token. Please request a new login link.')
                }
            } catch (error) {
                logger.error('[Auth] URL token login error:', error)
                res.status(500).send('Login failed: ' + error.message)
            }
        })

        // POST /api/auth/login - Temporary token authentication
        this.app.post('/api/auth/login', async (req, res) => {
            const { token } = req.body

            try {
                const success = authHandler.validateToken(token)
                if (success) {
                    // Generate JWT for session
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now()
                    }, authKey, { expiresIn: '30d' })

                    logger.info('[Auth] Login successful with temporary token')
                    res.json(ChaiteResponse.ok({
                        token: jwtToken,
                        expiresIn: 30 * 24 * 60 * 60
                    }))
                } else {
                    res.status(401).json(ChaiteResponse.fail(null, 'Invalid or expired token'))
                }
            } catch (error) {
                logger.error('[Auth] Login error:', error)
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Health & Monitoring ====================
        // GET /api/health - Health check endpoint (public)
        this.app.get('/api/health', (req, res) => {
            const health = {
                status: 'healthy',
                timestamp: Date.now(),
                uptime: process.uptime(),
                memoryUsage: {
                    heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                    heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                    rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
                },
                services: {
                    web: 'ok',
                    redis: redisClient.isConnected() ? 'ok' : 'unavailable'
                }
            }
            res.json(health)
        })

        // GET /api/metrics - Performance metrics (protected)
        this.app.get('/api/metrics', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const metrics = {
                    timestamp: Date.now(),
                    uptime: process.uptime(),
                    process: {
                        pid: process.pid,
                        cpu: process.cpuUsage(),
                        memory: process.memoryUsage()
                    },
                    system: {
                        platform: process.platform,
                        arch: process.arch,
                        nodeVersion: process.version
                    }
                }
                res.json(ChaiteResponse.ok(metrics))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== System Routes ====================
        // GET /api/system/info - System information
        this.app.get('/api/system/info', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok({
                version: '1.0.0',
                systemInfo: {
                    nodejs: process.version,
                    platform: process.platform,
                    arch: process.arch,
                    memory: {
                        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
                        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
                    }
                },
                stats: {
                    totalConversations: 0,
                    activeUsers: 0,
                    apiCalls: 0,
                    presets: presetManager.getAll().length
                }
            }))
        })

        // ==================== Config Routes ====================
        // GET /api/config - Get configuration
        this.app.get('/api/config', this.authMiddleware.bind(this), (req, res) => {
            // Return full config for settings page (protected)
            res.json(ChaiteResponse.ok(config.get()))
        })

        // POST /api/config - Update configuration (protected)
        this.app.post('/api/config', this.authMiddleware.bind(this), (req, res) => {
            const { basic, llm, bym, thinking, streaming } = req.body

            if (basic) config.set('basic', { ...config.get('basic'), ...basic })
            if (llm) config.set('llm', { ...config.get('llm'), ...llm })
            if (bym) config.set('bym', { ...config.get('bym'), ...bym })
            if (thinking) config.set('thinking', { ...config.get('thinking'), ...thinking })
            if (streaming) config.set('streaming', { ...config.get('streaming'), ...streaming })

            res.json(ChaiteResponse.ok({ success: true }))
        })

        // GET /api/config/advanced - Get advanced configuration (protected)
        this.app.get('/api/config/advanced', this.authMiddleware.bind(this), (req, res) => {
            const advancedConfig = {
                thinking: config.get('thinking') || {
                    enableReasoning: false,
                    defaultLevel: 'low',
                    adaptThinking: false,
                    sendThinkingAsMessage: false
                },
                streaming: {
                    enabled: config.get('streaming.enabled') !== false,
                    chunkSize: config.get('streaming.chunkSize') || 1024
                },
                llm: {
                    temperature: config.get('llm.temperature') || 0.7,
                    maxTokens: config.get('llm.maxTokens') || 4000,
                    topP: config.get('llm.topP') || 1,
                    frequencyPenalty: config.get('llm.frequencyPenalty') || 0,
                    presencePenalty: config.get('llm.presencePenalty') || 0
                },
                context: {
                    maxMessages: config.get('context.maxMessages') || 20,
                    cleaningStrategy: config.get('context.cleaningStrategy') || 'truncate'
                }
            }
            res.json(ChaiteResponse.ok(advancedConfig))
        })

        // PUT /api/config/advanced - Update advanced configuration (protected)
        this.app.put('/api/config/advanced', this.authMiddleware.bind(this), (req, res) => {
            const { thinking, streaming, llm, context } = req.body

            if (thinking) {
                if (thinking.enableReasoning !== undefined) {
                    config.set('thinking.enableReasoning', thinking.enableReasoning)
                }
                if (thinking.defaultLevel) {
                    config.set('thinking.defaultLevel', thinking.defaultLevel)
                }
                if (thinking.adaptThinking !== undefined) {
                    config.set('thinking.adaptThinking', thinking.adaptThinking)
                }
                if (thinking.sendThinkingAsMessage !== undefined) {
                    config.set('thinking.sendThinkingAsMessage', thinking.sendThinkingAsMessage)
                }
            }

            if (streaming) {
                if (streaming.enabled !== undefined) {
                    config.set('streaming.enabled', streaming.enabled)
                }
                if (streaming.chunkSize) {
                    config.set('streaming.chunkSize', streaming.chunkSize)
                }
            }

            if (llm) {
                if (llm.temperature !== undefined) {
                    config.set('llm.temperature', llm.temperature)
                }
                if (llm.maxTokens) {
                    config.set('llm.maxTokens', llm.maxTokens)
                }
                if (llm.topP !== undefined) {
                    config.set('llm.topP', llm.topP)
                }
                if (llm.frequencyPenalty !== undefined) {
                    config.set('llm.frequencyPenalty', llm.frequencyPenalty)
                }
                if (llm.presencePenalty !== undefined) {
                    config.set('llm.presencePenalty', llm.presencePenalty)
                }
            }

            if (context) {
                if (context.maxMessages) {
                    config.set('context.maxMessages', context.maxMessages)
                }
                if (context.cleaningStrategy) {
                    config.set('context.cleaningStrategy', context.cleaningStrategy)
                }
            }

            res.json(ChaiteResponse.ok({ success: true }))
        })

        // ==================== Preset Routes ====================
        // GET /api/preset/list - List all presets (protected)
        this.app.get('/api/preset/list', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok(presetManager.getAll()))
        })

        // GET /api/preset/:id - Get single preset (protected)
        this.app.get('/api/preset/:id', this.authMiddleware.bind(this), (req, res) => {
            const { id } = req.params
            const preset = presetManager.get(id)
            if (preset) {
                res.json(ChaiteResponse.ok(preset))
            } else {
                res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
            }
        })

        // POST /api/preset/ - Create preset (protected)
        this.app.post('/api/preset/', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const preset = await presetManager.create(req.body)
                res.status(201).json(ChaiteResponse.ok(preset))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // PUT /api/preset/:id - Update preset (protected)
        this.app.put('/api/preset/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const preset = await presetManager.update(req.params.id, req.body)
                if (preset) {
                    res.json(ChaiteResponse.ok(preset))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
                }
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // DELETE /api/preset/:id - Delete preset (protected)
        this.app.delete('/api/preset/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const deleted = await presetManager.delete(req.params.id)
                if (deleted) {
                    res.json(ChaiteResponse.ok(null))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
                }
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // DELETE /api/preset/:id - Delete preset
        this.app.delete('/api/preset/:id', async (req, res) => {
            try {
                const success = await presetManager.delete(req.params.id)
                if (success) {
                    res.json(ChaiteResponse.ok(null))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Preset not found or cannot delete'))
                }
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // GET /api/preset/:id/prompt - Get built system prompt for preset
        this.app.get('/api/preset/:id/prompt', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await presetManager.init()
                const prompt = presetManager.buildSystemPrompt(req.params.id)
                res.json(ChaiteResponse.ok({ prompt }))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // GET /api/presets/config - Get presets configuration
        this.app.get('/api/presets/config', this.authMiddleware.bind(this), (req, res) => {
            const presetsConfig = config.get('presets') || {
                defaultId: 'default',
                allowUserSwitch: true,
                perUserPreset: false,
                perGroupPreset: false
            }
            res.json(ChaiteResponse.ok(presetsConfig))
        })

        // PUT /api/presets/config - Update presets configuration
        this.app.put('/api/presets/config', this.authMiddleware.bind(this), (req, res) => {
            try {
                const { defaultId, allowUserSwitch, perUserPreset, perGroupPreset } = req.body
                
                if (defaultId !== undefined) config.set('presets.defaultId', defaultId)
                if (allowUserSwitch !== undefined) config.set('presets.allowUserSwitch', allowUserSwitch)
                if (perUserPreset !== undefined) config.set('presets.perUserPreset', perUserPreset)
                if (perGroupPreset !== undefined) config.set('presets.perGroupPreset', perGroupPreset)

                // Also update llm.defaultChatPresetId for compatibility
                if (defaultId !== undefined) config.set('llm.defaultChatPresetId', defaultId)

                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Channels API (Enhanced) ====================
        // GET /api/channels/list - List all channels
        this.app.get('/api/channels/list', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await channelManager.init()
                const channels = req.query.withStats ? channelManager.getAllWithStats() : channelManager.getAll()
                res.json(ChaiteResponse.ok(channels))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/channels/stats - Get channel statistics
        this.app.get('/api/channels/stats', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await channelManager.init()
                const stats = channelManager.getStats(req.query.id)
                res.json(ChaiteResponse.ok(stats))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/channels - Create new channel (protected)
        this.app.post('/api/channels', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await channelManager.init()
                const channel = await channelManager.create(req.body)
                res.status(201).json(ChaiteResponse.ok(channel))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/channels/:id - Update channel (protected)
        this.app.put('/api/channels/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await channelManager.init()
                const channel = await channelManager.update(req.params.id, req.body)
                if (channel) {
                    res.json(ChaiteResponse.ok(channel))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Channel not found'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/channels/:id - Delete channel (protected)
        this.app.delete('/api/channels/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await channelManager.init()
                const deleted = await channelManager.delete(req.params.id)
                if (deleted) {
                    res.json(ChaiteResponse.ok(null))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Channel not found'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // Get single channel
        this.app.get('/api/channels/:id', this.authMiddleware.bind(this), async (req, res) => {
            const { id } = req.params

            try {
                await channelManager.init()
                const channel = channelManager.get(id)

                if (channel) {
                    res.json(ChaiteResponse.ok(channel))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Channel not found'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // Test channel connection
        this.app.post('/api/channels/test', this.authMiddleware.bind(this), async (req, res) => {
            let { adapterType, baseUrl, apiKey, models, advanced } = req.body

            // Auto-append /v1 if missing for OpenAI-compatible APIs
            if (adapterType === 'openai' && baseUrl && !baseUrl.endsWith('/v1')) {
                if (!baseUrl.includes('/chat/') && !baseUrl.includes('/models')) {
                    baseUrl = baseUrl.replace(/\/$/, '') + '/v1'
                }
            }

            logger.info(`[测试渠道] 类型: ${adapterType}, BaseURL: ${baseUrl}`)

            try {
                // Real connection test with chat completion
                if (adapterType === 'openai') {
                    const { OpenAIClient } = await import('../core/adapters/index.js')
                    const client = new OpenAIClient({
                        apiKey: apiKey || config.get('openai.apiKey'),
                        baseUrl: baseUrl || config.get('openai.baseUrl'),
                        features: ['chat'],
                        tools: []
                    })

                    // Use first configured model or fallback to gpt-3.5-turbo
                    const testModel = (models && models.length > 0) ? models[0] : 'gpt-3.5-turbo'

                    // Apply advanced settings
                    const useStreaming = advanced?.streaming?.enabled || false
                    const options = {
                        model: testModel,
                        maxToken: advanced?.llm?.maxTokens || 100,
                        temperature: advanced?.llm?.temperature || 0.7,
                    }

                    logger.info(`[测试渠道] 使用模型: ${testModel}, 流式输出: ${useStreaming}`)

                    // Try a real chat completion request
                    logger.info('[测试渠道] 发送测试消息...')

                    let replyText = ''

                    if (useStreaming) {
                        // Test with streaming mode
                        const stream = await client.streamMessage(
                            [{ role: 'user', content: [{ type: 'text', text: '说一声你好' }] }],
                            options
                        )

                        let reasoningText = ''
                        // Collect the stream
                        for await (const chunk of stream) {
                            if (typeof chunk === 'string') {
                                // 兼容旧格式
                                replyText += chunk
                            } else if (chunk.type === 'reasoning') {
                                // 思考内容
                                reasoningText += chunk.text
                            } else if (chunk.type === 'text') {
                                // 正常内容
                                replyText += chunk.text
                            }
                        }

                        if (reasoningText) {
                            logger.info(`[测试渠道] AI思考过程: ${reasoningText.substring(0, 200)}...`)
                        }
                        logger.info(`[测试渠道] 测试成功，AI回复: ${replyText}`)
                    } else {
                        // Test with non-streaming mode
                        const response = await client.sendMessage(
                            { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                            options
                        )

                        logger.info('[测试渠道] 收到响应:', JSON.stringify(response).substring(0, 200))

                        // Defensive check for response structure
                        if (!response || !response.contents || !Array.isArray(response.contents)) {
                            logger.error('[测试渠道] 响应格式错误:', response)
                            return res.status(500).json(ChaiteResponse.fail(null,
                                '连接失败: API响应格式不正确'))
                        }

                        replyText = response.contents
                            .filter(c => c && c.type === 'text')
                            .map(c => c.text)
                            .join('')

                        logger.info(`[测试渠道] 测试成功，AI回复: ${replyText}`)
                    }

                    res.json(ChaiteResponse.ok({
                        success: true,
                        message: '连接成功！AI回复：' + replyText,
                        testResponse: replyText
                    }))
                } else {
                    res.json(ChaiteResponse.ok({ success: true, message: '该适配器暂不支持测试' }))
                }
            } catch (error) {
                logger.error('[测试渠道] 错误:', error)
                logger.error('[测试渠道] 错误详情:', {
                    message: error.message,
                    status: error.status,
                    code: error.code,
                    type: error.type,
                    error: error.error
                })

                // Extract meaningful error message
                let errorMessage = error.message
                if (error.error?.message) {
                    errorMessage = error.error.message
                }

                res.status(500).json(ChaiteResponse.fail(null, `连接失败: ${errorMessage}`))
            }
        })


        // Fetch models from provider API (protected)
        this.app.post('/api/channels/fetch-models', this.authMiddleware.bind(this), async (req, res) => {
            let { adapterType, baseUrl, apiKey } = req.body

            // Auto-append /v1 if missing for OpenAI-compatible APIs
            if (adapterType === 'openai' && baseUrl && !baseUrl.endsWith('/v1')) {
                // Check if it's not already a complete API path
                if (!baseUrl.includes('/chat/') && !baseUrl.includes('/models')) {
                    baseUrl = baseUrl.replace(/\/$/, '') + '/v1'
                }
            }

            try {
                if (adapterType === 'openai') {
                    // Use OpenAI SDK to fetch models
                    const OpenAI = (await import('openai')).default
                    const openai = new OpenAI({
                        apiKey: apiKey || config.get('openai.apiKey'),
                        baseURL: baseUrl || config.get('openai.baseUrl')
                    })

                    logger.info('[获取模型] 正在请求模型列表...')
                    const modelsList = await openai.models.list()

                    // 打印原始响应结构
                    logger.info('[获取模型] 原始响应:', JSON.stringify(modelsList).substring(0, 500))

                    if (!modelsList || !modelsList.data || !Array.isArray(modelsList.data)) {
                        logger.error('[获取模型] API返回格式错误，完整响应:', JSON.stringify(modelsList))

                        return res.status(500).json(ChaiteResponse.fail(null, 'API返回格式不正确'))
                    }

                    logger.info(`[获取模型] API返回 ${modelsList.data.length} 个模型`)

                    // Check if this is official OpenAI API
                    const isOfficialOpenAI = !baseUrl ||
                        baseUrl.includes('api.openai.com') ||
                        baseUrl.includes('openai.azure.com')

                    let models = modelsList.data.map(m => m.id)

                    // Only filter for official OpenAI API
                    // Custom APIs may have different model naming schemes (claude, gemini, deepseek, etc.)
                    if (isOfficialOpenAI) {
                        const beforeFilter = models.length
                        models = models.filter(id => {
                            // Filter for chat and embedding models on official API
                            return id.includes('gpt') ||
                                id.includes('text-embedding') ||
                                id.includes('o1') ||
                                id.includes('o3') ||
                                id.includes('davinci') ||
                                id.includes('babbage') ||
                                id.includes('curie')
                        })
                        logger.info(`[获取模型] 官方API过滤: ${beforeFilter} -> ${models.length}`)
                    } else {
                        logger.info(`[获取模型] 自定义API，不过滤模型`)
                    }

                    models = models.sort()

                    logger.info(`[获取模型] 最终返回 ${models.length} 个模型`)

                    res.json(ChaiteResponse.ok({
                        models,
                        count: models.length,
                        message: `成功获取 ${models.length} 个模型`
                    }))
                } else if (adapterType === 'gemini') {
                    // Gemini default models
                    const models = [
                        'gemini-pro',
                        'gemini-pro-vision',
                        'gemini-1.5-pro',
                        'gemini-1.5-flash',
                        'gemini-1.5-flash-8b',
                        'text-embedding-004'
                    ]
                    res.json(ChaiteResponse.ok({
                        models,
                        count: models.length,
                        message: `Gemini 默认模型列表`
                    }))
                } else if (adapterType === 'claude') {
                    // Claude default models
                    const models = [
                        'claude-3-5-sonnet-20241022',
                        'claude-3-5-haiku-20241022',
                        'claude-3-opus-20240229',
                        'claude-3-sonnet-20240229',
                        'claude-3-haiku-20240307'
                    ]
                    res.json(ChaiteResponse.ok({
                        models,
                        count: models.length,
                        message: `Claude 默认模型列表`
                    }))
                } else {
                    res.status(400).json(ChaiteResponse.fail(null, '不支持的适配器类型'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, `获取模型列表失败: ${error.message} `))
            }
        })

        // ==================== Tools Routes ====================
        // GET /api/tools/list - List all tools (protected)
        this.app.get('/api/tools/list', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.init()
                const tools = mcpManager.getTools()

                // Also get custom tools from config
                const customTools = config.get('customTools') || []

                res.json(ChaiteResponse.ok([...tools, ...customTools]))
            } catch (error) {
                res.json(ChaiteResponse.ok([]))
            }
        })

        // GET /api/tools/builtin/config - Get builtin tools configuration
        this.app.get('/api/tools/builtin/config', this.authMiddleware.bind(this), (req, res) => {
            const builtinConfig = config.get('builtinTools') || {
                enabled: true,
                allowedTools: [],
                disabledTools: [],
                dangerousTools: ['kick_member', 'mute_member', 'recall_message'],
                allowDangerous: false
            }
            res.json(ChaiteResponse.ok(builtinConfig))
        })

        // PUT /api/tools/builtin/config - Update builtin tools configuration
        this.app.put('/api/tools/builtin/config', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { enabled, allowedTools, disabledTools, dangerousTools, allowDangerous } = req.body
                
                if (enabled !== undefined) config.set('builtinTools.enabled', enabled)
                if (allowedTools !== undefined) config.set('builtinTools.allowedTools', allowedTools)
                if (disabledTools !== undefined) config.set('builtinTools.disabledTools', disabledTools)
                if (dangerousTools !== undefined) config.set('builtinTools.dangerousTools', dangerousTools)
                if (allowDangerous !== undefined) config.set('builtinTools.allowDangerous', allowDangerous)

                // Refresh builtin tools
                await mcpManager.refreshBuiltinTools()

                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/tools/builtin/list - List only builtin tools
        this.app.get('/api/tools/builtin/list', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.init()
                const tools = mcpManager.getTools().filter(t => t.isBuiltin)
                res.json(ChaiteResponse.ok(tools))
            } catch (error) {
                res.json(ChaiteResponse.ok([]))
            }
        })

        // POST /api/tools/builtin/refresh - Refresh builtin tools
        this.app.post('/api/tools/builtin/refresh', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const tools = await mcpManager.refreshBuiltinTools()
                res.json(ChaiteResponse.ok({ count: tools.length, tools }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/tools/custom - List custom tools (protected)
        this.app.get('/api/tools/custom', this.authMiddleware.bind(this), (req, res) => {
            const customTools = config.get('customTools') || []
            res.json(ChaiteResponse.ok(customTools))
        })

        // POST /api/tools/custom - Add custom tool (protected)
        this.app.post('/api/tools/custom', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { name, description, parameters, handler } = req.body

                if (!name || !description) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'name and description are required'))
                }

                const customTools = config.get('customTools') || []

                // Check if tool already exists
                if (customTools.find(t => t.name === name)) {
                    return res.status(409).json(ChaiteResponse.fail(null, 'Tool with this name already exists'))
                }

                const newTool = {
                    name,
                    description,
                    parameters: parameters || { type: 'object', properties: {}, required: [] },
                    handler: handler || 'function',
                    custom: true,
                    createdAt: Date.now()
                }

                customTools.push(newTool)
                config.set('customTools', customTools)

                res.status(201).json(ChaiteResponse.ok(newTool))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/tools/custom/:name - Update custom tool (protected)
        this.app.put('/api/tools/custom/:name', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const customTools = config.get('customTools') || []
                const toolIndex = customTools.findIndex(t => t.name === req.params.name)

                if (toolIndex === -1) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Tool not found'))
                }

                const { description, parameters, handler } = req.body

                if (description) customTools[toolIndex].description = description
                if (parameters) customTools[toolIndex].parameters = parameters
                if (handler) customTools[toolIndex].handler = handler
                customTools[toolIndex].updatedAt = Date.now()

                config.set('customTools', customTools)

                res.json(ChaiteResponse.ok(customTools[toolIndex]))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/tools/custom/:name - Delete custom tool (protected)
        this.app.delete('/api/tools/custom/:name', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const customTools = config.get('customTools') || []
                const filteredTools = customTools.filter(t => t.name !== req.params.name)

                if (filteredTools.length === customTools.length) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Tool not found'))
                }

                config.set('customTools', filteredTools)

                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/tools/test - Test a tool (protected)
        this.app.post('/api/tools/test', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { toolName, arguments: args } = req.body

                if (!toolName) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'toolName is required'))
                }

                await mcpManager.init()

                // Try to call the tool
                const result = await mcpManager.callTool(toolName, args || {})

                res.json(ChaiteResponse.ok({
                    success: true,
                    result,
                    executedAt: Date.now()
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/tools/logs - Get tool call logs
        this.app.get('/api/tools/logs', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const logs = mcpManager.getToolLogs(req.query.tool, req.query.search)
                res.json(ChaiteResponse.ok(logs))
            } catch (error) {
                res.json(ChaiteResponse.ok([]))
            }
        })

        // DELETE /api/tools/logs - Clear tool logs
        this.app.delete('/api/tools/logs', this.authMiddleware.bind(this), async (req, res) => {
            try {
                mcpManager.clearToolLogs()
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })


        // ==================== MCP API (Enhanced) ====================
        // GET /api/mcp/servers - List all MCP servers (protected)
        this.app.get('/api/mcp/servers', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok(mcpManager.getServers()))
        })

        // GET /api/mcp/servers/:name - Get single MCP server (protected)
        this.app.get('/api/mcp/servers/:name', this.authMiddleware.bind(this), (req, res) => {
            const server = mcpManager.getServer(req.params.name)
            if (server) {
                res.json(ChaiteResponse.ok(server))
            } else {
                res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
            }
        })

        // POST /api/mcp/servers - Add MCP server (protected)
        this.app.post('/api/mcp/servers', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { name, config: serverConfig } = req.body
                await mcpManager.init()
                const server = await mcpManager.addServer(name, serverConfig)
                res.status(201).json(ChaiteResponse.ok(server))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/mcp/servers/:name - Update MCP server (protected)
        this.app.put('/api/mcp/servers/:name', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.init()
                const server = await mcpManager.updateServer(req.params.name, req.body.config)
                res.json(ChaiteResponse.ok(server))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/mcp/servers/:name - Delete MCP server (protected)
        this.app.delete('/api/mcp/servers/:name', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.init()
                await mcpManager.removeServer(req.params.name)
                res.json(ChaiteResponse.ok(null))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/mcp/servers/:name/reconnect - Reconnect to MCP server (protected)
        this.app.post('/api/mcp/servers/:name/reconnect', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.init()
                await mcpManager.reloadServer(req.params.name)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/mcp/resources - Get available resources (protected)
        this.app.get('/api/mcp/resources', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const resources = mcpManager.getResources()
                res.json(ChaiteResponse.ok(resources))
            } catch (error) {
                res.json(ChaiteResponse.error(error))
            }
        })

        // Read resource (protected)
        this.app.post('/api/mcp/resources/read', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { uri } = req.body
                if (!uri) {
                    throw new Error('URI is required')
                }
                const content = await mcpManager.readResource(uri)
                res.json(ChaiteResponse.ok(content))
            } catch (error) {
                res.json(ChaiteResponse.error(error))
            }
        })

        // Get available prompts (protected)
        this.app.get('/api/mcp/prompts', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const prompts = mcpManager.getPrompts()
                res.json(ChaiteResponse.ok(prompts))
            } catch (error) {
                res.json(ChaiteResponse.error(error))
            }
        })

        // Get prompt (protected)
        this.app.post('/api/mcp/prompts/get', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { name, arguments: args } = req.body
                if (!name) {
                    throw new Error('Prompt name is required')
                }
                const result = await mcpManager.getPrompt(name, args || {})
                res.json(ChaiteResponse.ok(result))
            } catch (error) {
                res.json(ChaiteResponse.error(error))
            }
        })

        // ==================== Memory API ====================
        // GET /api/memory/users - Get all users with memories
        this.app.get('/api/memory/users', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./MemoryManager.js')
                const users = await memoryManager.listUsers()
                res.json(ChaiteResponse.ok(users))
            } catch (error) {
                res.json(ChaiteResponse.ok([]))
            }
        })

        // GET /api/memory/:userId - Get memories for a user
        this.app.get('/api/memory/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./MemoryManager.js')
                const memories = await memoryManager.getAllMemories(req.params.userId)
                res.json(ChaiteResponse.ok(memories))
            } catch (error) {
                res.json(ChaiteResponse.ok([]))
            }
        })

        // POST /api/memory - Add a memory
        this.app.post('/api/memory', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { userId, content, metadata } = req.body
                if (!userId || !content) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'userId and content are required'))
                }
                const { memoryManager } = await import('./MemoryManager.js')
                const id = await memoryManager.addMemory(userId, content, metadata)
                res.json(ChaiteResponse.ok({ id }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/memory/:userId/:memoryId - Delete a specific memory
        this.app.delete('/api/memory/:userId/:memoryId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./MemoryManager.js')
                await memoryManager.deleteMemory(req.params.userId, req.params.memoryId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/memory/:userId - Clear all memories for a user
        this.app.delete('/api/memory/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./MemoryManager.js')
                await memoryManager.clearMemory(req.params.userId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== State Routes ====================
        // GET /api/state - Get state information (protected)
        this.app.get('/api/state', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok({
                isRunning: true,
                uptime: process.uptime()
            }))
        })

        // ==================== Processors Routes ====================
        // GET /api/processors/list - List all processors (protected)
        this.app.get('/api/processors/list', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok([]))
        })

        // ==================== Triggers Routes ====================
        // GET /api/triggers/list - List all triggers (protected)
        this.app.get('/api/triggers/list', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok([]))
        })

        // ==================== Tool Groups Routes ====================
        // GET /api/toolGroups/list - List all tool groups (protected)
        this.app.get('/api/toolGroups/list', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok([]))
        })

        // ==================== Image API ====================
        // Configure multer for memory storage
        const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } })

        // POST /api/upload/image - Upload image (protected)
        this.app.post('/api/upload/image', this.authMiddleware.bind(this), upload.single('image'), async (req, res) => {
            try {
                if (!req.file) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'No image provided'))
                }

                const imageData = await imageService.uploadImage(req.file.buffer, req.file.originalname)
                res.status(201).json(ChaiteResponse.ok(imageData))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/images/:id - Get image
        this.app.get('/api/images/:id', (req, res) => {
            try {
                const buffer = imageService.getImageBuffer(req.params.id)
                if (!buffer) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Image not found'))
                }

                res.set('Content-Type', 'image/jpeg')
                res.send(buffer)
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/images/:id/base64 - Get image as base64
        this.app.get('/api/images/:id/base64', async (req, res) => {
            try {
                const format = req.query.format || 'jpeg'
                const base64 = await imageService.getImageBase64(req.params.id, format)
                if (!base64) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Image not found'))
                }

                res.json(ChaiteResponse.ok({ base64 }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/images/ocr - OCR (protected)
        this.app.post('/api/images/ocr', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { id, lang } = req.body
                if (!id) {
                    throw new Error('Image ID is required')
                }
                const text = await imageService.extractText(id, lang)
                res.json(ChaiteResponse.ok({ text }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/images/:id - Delete image (protected)
        this.app.delete('/api/images/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const deleted = await imageService.deleteImage(req.params.id)
                if (deleted) {
                    res.json(ChaiteResponse.ok(null))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Image not found'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/images/compress - Compress image (protected)
        this.app.post('/api/images/compress', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { id, quality, maxWidth, maxHeight, format } = req.body
                if (!id) {
                    throw new Error('Image ID is required')
                }
                const result = await imageService.compressImage(id, { quality, maxWidth, maxHeight, format })
                res.json(ChaiteResponse.ok(result))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/images/convert - Convert image format (protected)
        this.app.post('/api/images/convert', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { id, format } = req.body
                if (!id || !format) {
                    throw new Error('Image ID and format are required')
                }
                const result = await imageService.convertFormat(id, format)
                res.json(ChaiteResponse.ok(result))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/images/resize - Resize image (protected)
        this.app.post('/api/images/resize', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { id, width, height, fit } = req.body
                if (!id || !width || !height) {
                    throw new Error('Image ID, width, and height are required')
                }
                const result = await imageService.resizeImage(id, parseInt(width), parseInt(height), fit)
                res.json(ChaiteResponse.ok(result))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Context Management API ====================
        // GET /api/context/list - List active contexts
        this.app.get('/api/context/list', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { contextManager } = await import('./ContextManager.js')
                await contextManager.init()
                const contexts = await contextManager.getActiveContexts()
                res.json(ChaiteResponse.ok(contexts))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        // Let's assume we want to support clearing context for a specific user.
        this.app.post('/api/context/clear', this.authMiddleware.bind(this), async (req, res) => {
            const { userId, conversationId } = req.body
            try {
                const { contextManager } = await import('./ContextManager.js')
                await contextManager.init()

                const targetConvId = conversationId || contextManager.getConversationId(userId)
                await contextManager.cleanContext(targetConvId)

                // Also clear history completely?
                const { default: historyManager } = await import('../core/utils/history.js')
                await historyManager.deleteConversation(targetConvId)

                res.json(ChaiteResponse.ok({ success: true, message: 'Context cleared' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Memory Management API ====================
        // GET /api/memory/:userId - Get memories for user
        this.app.get('/api/memory/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./MemoryManager.js')
                await memoryManager.init()
                const memories = await memoryManager.getAllMemories(req.params.userId)
                res.json(ChaiteResponse.ok(memories))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/memory - Add memory
        this.app.post('/api/memory', this.authMiddleware.bind(this), async (req, res) => {
            const { userId, content, metadata } = req.body
            try {
                const { memoryManager } = await import('./MemoryManager.js')
                await memoryManager.init()
                const memory = await memoryManager.saveMemory(userId, content, metadata)
                res.status(201).json(ChaiteResponse.ok(memory))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/memory/:userId/:memoryId - Delete memory
        this.app.delete('/api/memory/:userId/:memoryId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./MemoryManager.js')
                await memoryManager.init()
                const success = await memoryManager.deleteMemory(req.params.userId, req.params.memoryId)
                if (success) {
                    res.json(ChaiteResponse.ok(null))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Memory not found'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/memory/search - Search memories
        this.app.post('/api/memory/search', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { userId, query, limit } = req.body

                if (!userId || !query) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'userId and query are required'))
                }

                const { memoryManager } = await import('./MemoryManager.js')
                await memoryManager.init()
                const memories = await memoryManager.searchMemory(userId, query, limit || 5)
                res.json(ChaiteResponse.ok(memories))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })


        // ==================== Load Balancing Stats API ====================
        // GET /api/stats/load-balancing - Get load balancing stats
        this.app.get('/api/stats/load-balancing', this.authMiddleware.bind(this), async (req, res) => {
            try {
                // This would ideally return real stats. For now return channel statuses.
                await channelManager.init()
                const channels = channelManager.getAll()
                const stats = channels.map(ch => ({
                    id: ch.id,
                    name: ch.name,
                    status: ch.status,
                    priority: ch.priority,
                    lastHealthCheck: ch.lastHealthCheck,
                    usage: ch.usage,
                    quota: ch.quota
                }))
                res.json(ChaiteResponse.ok(stats))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== OpenAI Compatible Routes ====================
        // GET /api/openai/models - OpenAI compatible models list (protected)
        this.app.get('/api/openai/models', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await channelManager.init()
                const allChannels = channelManager.getAll()

                // Defensive check
                if (!allChannels || !Array.isArray(allChannels)) {
                    logger.warn('[WebServer] channelManager.getAll() returned invalid data')
                    return res.json({
                        object: 'list',
                        data: []
                    })
                }

                const channels = allChannels.filter(ch => ch && ch.enabled)

                // Collect all models from all active channels
                const models = Array.from(new Set(
                    channels.flatMap(ch => (ch && ch.models) ? ch.models : [])
                ))

                // Format as OpenAI models list
                const modelsList = models.map(modelId => ({
                    id: modelId,
                    object: 'model',
                    created: Date.now(),
                    owned_by: 'chaite'
                }))

                res.json({
                    object: 'list',
                    data: modelsList
                })
            } catch (error) {
                logger.error('[WebServer] Error fetching models:', error)
                res.status(500).json({
                    object: 'list',
                    data: []
                })
            }
        })

        // ==================== Users API ====================
        // GET /api/users/list - List all users with stats
        this.app.get('/api/users/list', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                const users = db.getUsers()
                res.json(ChaiteResponse.ok(users))
            } catch (error) {
                res.json(ChaiteResponse.ok([]))
            }
        })

        // GET /api/users/:userId - Get user details
        this.app.get('/api/users/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                const user = db.getUser(req.params.userId)
                if (user) {
                    res.json(ChaiteResponse.ok(user))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'User not found'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/users/:userId/settings - Update user settings
        this.app.put('/api/users/:userId/settings', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                db.updateUserSettings(req.params.userId, req.body)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/users/:userId/data - Clear user data
        this.app.delete('/api/users/:userId/data', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                db.clearUserData(req.params.userId)
                
                // 也清除记忆
                try {
                    const { memoryManager } = await import('./MemoryManager.js')
                    await memoryManager.clearMemory(req.params.userId)
                } catch (e) {}
                
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Conversations API ====================
        // GET /api/conversations/list - List all conversations
        this.app.get('/api/conversations/list', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                const conversations = db.getConversations()
                res.json(ChaiteResponse.ok(conversations))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/conversations/:id/messages - Get messages for a conversation
        this.app.get('/api/conversations/:id/messages', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                const messages = db.getMessages(req.params.id, 100)
                res.json(ChaiteResponse.ok(messages))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/conversations/:id - Delete a conversation
        this.app.delete('/api/conversations/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                db.deleteConversation(req.params.id)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Catch-all Route ====================
        // Serve index.html for all other routes
        this.app.get('*', (req, res) => {
            res.sendFile(path.join(__dirname, '../../resources/web/index.html'))
        })
    }

    /**
     * Generate temporary login token (delegates to authHandler)
     * @param {number} expiresIn - Expiration time in seconds
     * @returns {string} - Generated token
     */
    generateToken(expiresIn = 300) {
        return authHandler.generateToken(expiresIn)
    }

    /**
     * Get auth handler instance (for external use)
     * @returns {FrontendAuthHandler}
     */
    getAuthHandler() {
        return authHandler
    }

    /**
     * Get server addresses
     * @returns {{ local: string[], public: string | null }}
     */
    getAddresses() {
        return this.addresses
    }

    /**
     * Generate login URL with token
     * @param {boolean} usePublic - 是否使用公网地址
     * @returns {string}
     */
    generateLoginUrl(usePublic = false) {
        const token = authHandler.generateToken(5 * 60, false)
        const baseUrl = usePublic && this.addresses.public 
            ? this.addresses.public 
            : (this.addresses.local[0] || `http://127.0.0.1:${this.port}`)
        return `${baseUrl}/login/token?token=${token}`
    }

    /**
     * Start web server
     */
    async start() {
        const tryListen = (port) => {
            return new Promise((resolve, reject) => {
                const server = this.app.listen(port, () => {
                    this.port = port
                    this.server = server
                    resolve()
                })

                server.on('error', (error) => {
                    if (error.code === 'EADDRINUSE') {
                        logger.warn(`[WebServer] 端口 ${port} 已被占用，尝试端口 ${port + 1}...`)
                        resolve(tryListen(port + 1))
                    } else {
                        logger.error('[WebServer] 启动失败:', error)
                        reject(error)
                    }
                })
            })
        }

        await tryListen(this.port)
        
        // 获取服务器地址
        this.addresses = await getServerAddresses(this.port)
        
        logger.info('[WebServer] 管理面板已启动')
        logger.info(`[WebServer] 本地地址: ${this.addresses.local.join(', ')}`)
        if (this.addresses.public) {
            logger.info(`[WebServer] 公网地址: ${this.addresses.public}`)
        }
    }

    /**
     * Stop web server
     */
    stop() {
        if (this.server) {
            this.server.close()
            logger.info('[WebServer] 管理面板已停止')
        }
    }
}

// Export singleton instance
let webServerInstance = null

export function getWebServer() {
    if (!webServerInstance) {
        webServerInstance = new WebServer()
    }
    return webServerInstance
}
