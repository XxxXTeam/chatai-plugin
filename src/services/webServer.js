import express from 'express'
import { rateLimit } from 'express-rate-limit'
import multer from 'multer'
import cookieParser from 'cookie-parser'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import config from '../../config/config.js'
import { mcpManager } from '../mcp/McpManager.js'
import { builtinMcpServer } from '../mcp/BuiltinMcpServer.js'
import { presetManager } from './PresetManager.js'
import { channelManager } from './ChannelManager.js'
import { imageService } from './ImageService.js'
import { databaseService } from './DatabaseService.js'
import { getScopeManager } from './ScopeManager.js'

// 获取 scopeManager 实例
let scopeManager = null
const ensureScopeManager = async () => {
    if (!scopeManager) {
        const db = getDatabase()
        scopeManager = getScopeManager(db)
        await scopeManager.init()
    }
    return scopeManager
}

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
        this.tokens = new Map() // token -> expiry
    }

    /**
     * 生成登录Token
     * @param {number} timeout - 超时时间（秒）
     * @param {boolean} permanent - 是否永久有效
     * @returns {string} - 生成的token
     */
    generateToken(timeout = 5 * 60, permanent = false) {
        // 永久Token存储到配置文件
        if (permanent) {
            let permanentToken = config.get('web.permanentAuthToken')
            if (!permanentToken) {
                permanentToken = crypto.randomUUID()
                config.set('web.permanentAuthToken', permanentToken)
            }
            return permanentToken
        }
        
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

    /**
     * 验证Token
     * @param {string} token
     * @returns {boolean}
     */
    validateToken(token) {
        if (!token) return false

        // 检查永久Token
        const permanentToken = config.get('web.permanentAuthToken')
        if (permanentToken && token === permanentToken) {
            return true // 永久token可重复使用
        }

        // 检查临时Token
        const expiry = this.tokens.get(token)
        if (expiry && Date.now() < expiry) {
            // 验证成功后删除（一次性使用）
            this.tokens.delete(token)
            return true
        }

        return false
    }

    /**
     * 撤销永久Token
     */
    revokePermanentToken() {
        config.set('web.permanentAuthToken', null)
    }

    /**
     * 获取永久Token状态
     */
    hasPermanentToken() {
        return !!config.get('web.permanentAuthToken')
    }
    
    /**
     * 验证永久Token
     * @param {string} token 
     * @returns {boolean}
     */
    validatePermanentToken(token) {
        if (!token) return false
        const permanentToken = config.get('web.permanentAuthToken')
        return permanentToken && token === permanentToken
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
        this.app.use(cookieParser())
        this.app.use(express.static(path.join(__dirname, '../../resources/web')))



        // 公开API限流（未认证请求）
        const publicLimiter = rateLimit({
            windowMs: 15 * 60 * 100000, // 15 minutes
            max: 50000, // 未认证请求限制更严格
            standardHeaders: true,
            legacyHeaders: false,
            message: ChaiteResponse.fail(null, 'Too many requests, please try again later.'),
            skip: (req) => {
                // 跳过已认证用户的限流
                const authHeader = req.headers.authorization
                if (authHeader?.startsWith('Bearer ')) {
                    try {
                        jwt.verify(authHeader.substring(7), authKey)
                        return true // 已认证，跳过限流
                    } catch {
                        return false
                    }
                }
                return false
            }
        })

        // 已认证API限流（更宽松）
        const authLimiter = rateLimit({
            windowMs: 1 * 60 * 1000, // 1 minute
            max: 300000, // 已认证用户每分钟300次请求
            standardHeaders: true,
            legacyHeaders: false,
            message: ChaiteResponse.fail(null, 'Too many requests, please slow down.'),
            skip: (req) => {
                // 仅对已认证请求生效
                const authHeader = req.headers.authorization
                if (!authHeader?.startsWith('Bearer ')) return true
                try {
                    jwt.verify(authHeader.substring(7), authKey)
                    return false // 已认证，应用此限流
                } catch {
                    return true
                }
            }
        })

        // Apply rate limiters
        this.app.use('/api/', publicLimiter)
        this.app.use('/api/', authLimiter)

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

            // 1. 首先检查请求中是否已有有效JWT（用户可能已登录）
            const authHeader = req.headers.authorization
            const cookieToken = req.cookies?.auth_token
            const existingToken = authHeader?.startsWith('Bearer ') 
                ? authHeader.substring(7) 
                : cookieToken

            if (existingToken) {
                try {
                    jwt.verify(existingToken, authKey)
                    // JWT有效，直接重定向到主页
                    logger.debug('[Auth] User already authenticated, redirecting to home...')
                    return res.redirect('/')
                } catch {
                    // JWT无效，继续正常登录流程
                }
            }

            if (!token) {
                return res.status(400).send('Token is required')
            }

            try {
                // 2. 验证临时token
                const success = authHandler.validateToken(token)
                
                if (success) {
                    // 生成新JWT
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now()
                    }, authKey, { expiresIn: '30d' })
                    
                    logger.debug('[Auth] Login successful via URL token')
                    
                    // 设置cookie用于后续检测已登录状态
                    res.cookie('auth_token', jwtToken, {
                        maxAge: 30 * 24 * 60 * 60 * 1000, // 30天
                        httpOnly: false, // 允许前端JS访问
                        sameSite: 'lax'
                    })
                    
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

        // POST /api/auth/login - Token authentication (临时token或永久token)
        this.app.post('/api/auth/login', async (req, res) => {
            const { token, password } = req.body

            try {
                let success = false
                let loginType = ''
                
                // 优先使用 token 参数，兼容 password 参数作为 token
                const authToken = token || password
                
                if (authToken) {
                    // 1. 先判断是否为临时 token
                    if (authHandler.validateToken(authToken)) {
                        success = true
                        loginType = 'temp_token'
                    }
                    // 2. 再判断是否为永久 token
                    else if (authHandler.validatePermanentToken(authToken)) {
                        success = true
                        loginType = 'permanent_token'
                    }
                }
                
                if (success) {
                    // Generate JWT for session
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now()
                    }, authKey, { expiresIn: '30d' })

                    logger.debug(`[Auth] Login successful via ${loginType}`)
                    res.json(ChaiteResponse.ok({
                        token: jwtToken,
                        expiresIn: 30 * 24 * 60 * 60
                    }))
                } else {
                    res.status(401).json(ChaiteResponse.fail(null, 'Token 无效或已过期'))
                }
            } catch (error) {
                logger.error('[Auth] Login error:', error)
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        
        // GET /api/auth/verify-token - URL token verification
        this.app.get('/api/auth/verify-token', async (req, res) => {
            const { token } = req.query

            try {
                if (!token) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'Token is required'))
                }
                
                const success = authHandler.validateToken(token)
                if (success) {
                    // Generate JWT for session
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now()
                    }, authKey, { expiresIn: '30d' })

                    logger.debug('[Auth] Login successful via URL token')
                    res.json(ChaiteResponse.ok({
                        token: jwtToken,
                        expiresIn: 30 * 24 * 60 * 60
                    }))
                } else {
                    res.status(401).json(ChaiteResponse.fail(null, 'Invalid or expired token'))
                }
            } catch (error) {
                logger.error('[Auth] Token verification error:', error)
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
            try {
                const { basic, llm, bym, thinking, streaming, admin, tools, features, memory, trigger } = req.body

                if (basic) config.set('basic', { ...config.get('basic'), ...basic })
                if (llm) {
                    const currentLlm = config.get('llm') || {}
                    config.set('llm', { 
                        ...currentLlm, 
                        ...llm,
                        models: { ...(currentLlm.models || {}), ...(llm.models || {}) }
                    })
                }
                if (bym) config.set('bym', { ...config.get('bym'), ...bym })
                if (thinking) config.set('thinking', { ...config.get('thinking'), ...thinking })
                if (streaming) config.set('streaming', { ...config.get('streaming'), ...streaming })
                if (admin) config.set('admin', { ...config.get('admin'), ...admin })
                if (tools) config.set('tools', { ...config.get('tools'), ...tools })
                
                // features深度合并
                if (features) {
                    const currentFeatures = config.get('features') || {}
                    const mergedFeatures = { ...currentFeatures }
                    for (const [key, value] of Object.entries(features)) {
                        if (typeof value === 'object' && value !== null) {
                            mergedFeatures[key] = { ...(currentFeatures[key] || {}), ...value }
                        } else {
                            mergedFeatures[key] = value
                        }
                    }
                    config.set('features', mergedFeatures)
                }
                
                if (memory) config.set('memory', { ...config.get('memory'), ...memory })
                
                // trigger深度合并（新配置结构）
                if (trigger) {
                    const currentTrigger = config.get('trigger') || {}
                    // 过滤无效的 prefixes 和 keywords 值
                    const cleanPrefixes = (trigger.prefixes || currentTrigger.prefixes || [])
                        .filter(p => p && typeof p === 'string' && p.trim())
                    const cleanKeywords = (trigger.keywords || currentTrigger.keywords || [])
                        .filter(k => k && typeof k === 'string' && k.trim())
                    
                    config.set('trigger', {
                        ...currentTrigger,
                        ...trigger,
                        prefixes: cleanPrefixes,
                        keywords: cleanKeywords,
                        private: { ...(currentTrigger.private || {}), ...(trigger.private || {}) },
                        group: { ...(currentTrigger.group || {}), ...(trigger.group || {}) }
                    })
                }

                // personality配置（人格上下文）
                const { personality } = req.body
                if (personality) {
                    const currentPersonality = config.get('personality') || {}
                    config.set('personality', {
                        ...currentPersonality,
                        ...personality,
                        isolateContext: { ...(currentPersonality.isolateContext || {}), ...(personality.isolateContext || {}) }
                    })
                }

                logger.debug('[WebServer] 配置已保存')
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                logger.error('[WebServer] 保存配置失败:', error)
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/config/advanced - Get advanced configuration (protected)
        this.app.get('/api/config/advanced', this.authMiddleware.bind(this), (req, res) => {
            const advancedConfig = {
                thinking: config.get('thinking') || {
                    enableReasoning: false,
                    defaultLevel: 'low',
                    showThinkingContent: true,
                    useForwardMsg: true
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
                    cleaningStrategy: config.get('context.cleaningStrategy') || 'truncate',
                    isolation: config.get('context.isolation') || {
                        groupUserIsolation: false,
                        privateIsolation: true
                    },
                    autoContext: config.get('context.autoContext') || {
                        enabled: true,
                        maxHistoryMessages: 20,
                        includeToolCalls: false
                    }
                },
                memory: config.get('memory') || {
                    enabled: false,
                    autoExtract: true,
                    pollInterval: 5,
                    maxMemories: 50,
                    groupContext: {
                        enabled: true,
                        collectInterval: 10,
                        maxMessagesPerCollect: 50,
                        analyzeThreshold: 20,
                        extractUserInfo: true,
                        extractTopics: true,
                        extractRelations: true
                    }
                },
                tools: config.get('tools') || {
                    showCallLogs: true,
                    useForwardMsg: true
                },
                builtinTools: config.get('builtinTools') || {
                    enabled: true,
                    allowedTools: [],
                    disabledTools: [],
                    allowDangerous: false
                }
            }
            res.json(ChaiteResponse.ok(advancedConfig))
        })

        // PUT /api/config/advanced - Update advanced configuration (protected)
        this.app.put('/api/config/advanced', this.authMiddleware.bind(this), (req, res) => {
            const { thinking, streaming, llm, context, memory, tools, builtinTools } = req.body

            if (thinking) {
                if (thinking.enableReasoning !== undefined) {
                    config.set('thinking.enableReasoning', thinking.enableReasoning)
                }
                if (thinking.defaultLevel) {
                    config.set('thinking.defaultLevel', thinking.defaultLevel)
                }
                if (thinking.showThinkingContent !== undefined) {
                    config.set('thinking.showThinkingContent', thinking.showThinkingContent)
                }
                if (thinking.useForwardMsg !== undefined) {
                    config.set('thinking.useForwardMsg', thinking.useForwardMsg)
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
                // 上下文隔离配置
                if (context.isolation) {
                    config.set('context.isolation', {
                        ...config.get('context.isolation'),
                        ...context.isolation
                    })
                }
                // 自动上下文配置
                if (context.autoContext) {
                    config.set('context.autoContext', {
                        ...config.get('context.autoContext'),
                        ...context.autoContext
                    })
                }
            }

            // 记忆配置
            if (memory) {
                if (memory.enabled !== undefined) {
                    config.set('memory.enabled', memory.enabled)
                }
                if (memory.autoExtract !== undefined) {
                    config.set('memory.autoExtract', memory.autoExtract)
                }
                if (memory.pollInterval) {
                    config.set('memory.pollInterval', memory.pollInterval)
                }
                if (memory.maxMemories) {
                    config.set('memory.maxMemories', memory.maxMemories)
                }
                // 群聊上下文采集配置
                if (memory.groupContext) {
                    config.set('memory.groupContext', {
                        ...config.get('memory.groupContext'),
                        ...memory.groupContext
                    })
                }
            }

            // 工具配置
            if (tools) {
                config.set('tools', { ...config.get('tools'), ...tools })
            }

            // 内置工具配置
            if (builtinTools) {
                config.set('builtinTools', { ...config.get('builtinTools'), ...builtinTools })
            }

            res.json(ChaiteResponse.ok({ success: true }))
        })

        // PATCH /api/config/:section - Update specific config section (protected)
        this.app.patch('/api/config/:section', this.authMiddleware.bind(this), (req, res) => {
            const { section } = req.params
            const data = req.body
            
            // 验证 section 是否合法
            const allowedSections = [
                'basic', 'admin', 'llm', 'bym', 'tools', 'builtinTools', 
                'mcp', 'redis', 'images', 'web', 'context', 'memory', 
                'presets', 'loadBalancing', 'thinking', 'features', 'streaming', 'listener',
                'personality'
            ]
            
            if (!allowedSections.includes(section)) {
                return res.status(400).json(ChaiteResponse.fail(null, `Invalid config section: ${section}`))
            }
            
            try {
                const current = config.get(section) || {}
                config.set(section, { ...current, ...data })
                res.json(ChaiteResponse.ok({ success: true, section }))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // GET /api/config/:section - Get specific config section (protected)
        this.app.get('/api/config/:section', this.authMiddleware.bind(this), (req, res) => {
            const { section } = req.params
            const data = config.get(section)
            if (data !== undefined) {
                res.json(ChaiteResponse.ok(data))
            } else {
                res.status(404).json(ChaiteResponse.fail(null, `Config section not found: ${section}`))
            }
        })

        // ==================== Preset Routes ====================
        // GET /api/preset/list - List all presets (protected)
        this.app.get('/api/preset/list', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await presetManager.init()
                res.json(ChaiteResponse.ok(presetManager.getAll()))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // GET /api/preset/:id - Get single preset (protected)
        this.app.get('/api/preset/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await presetManager.init()
                const { id } = req.params
                const preset = presetManager.get(id)
                if (preset) {
                    res.json(ChaiteResponse.ok(preset))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
                }
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
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

        // POST /api/preset/:id/default - Set preset as default (protected)
        this.app.post('/api/preset/:id/default', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await presetManager.init()
                const preset = presetManager.get(req.params.id)
                if (!preset) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
                }
                
                // 更新所有预设的 isDefault 状态
                const allPresets = presetManager.getAll()
                for (const p of allPresets) {
                    if (p.id === req.params.id) {
                        await presetManager.update(p.id, { isDefault: true })
                    } else if (p.isDefault) {
                        await presetManager.update(p.id, { isDefault: false })
                    }
                }
                
                // 同时更新配置
                config.set('presets.defaultId', req.params.id)
                config.set('llm.defaultChatPresetId', req.params.id)
                
                res.json(ChaiteResponse.ok({ success: true }))
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
            let { id, adapterType, baseUrl, apiKey, models, advanced } = req.body
            const startTime = Date.now()

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

                        // 提取文本内容（优先 text，其次 reasoning）
                        replyText = response.contents
                            .filter(c => c && c.type === 'text')
                            .map(c => c.text)
                            .join('')
                        
                        // 如果没有 text 内容，检查是否有 reasoning 内容（说明连接成功）
                        const hasReasoning = response.contents.some(c => c && c.type === 'reasoning')
                        
                        logger.info(`[测试渠道] 测试成功，AI回复: ${replyText || (hasReasoning ? '(思考内容)' : '(无)')}`)
                    }

                    const elapsed = Date.now() - startTime
                    const successMsg = replyText 
                        ? `连接成功！耗时 ${elapsed}ms，AI回复：${replyText.substring(0, 50)}${replyText.length > 50 ? '...' : ''}`
                        : `连接成功！耗时 ${elapsed}ms`
                    
                    // 如果有渠道 ID，更新渠道状态
                    if (id) {
                        const channel = channelManager.get(id)
                        if (channel) {
                            channel.status = 'active'
                            channel.lastHealthCheck = Date.now()
                            channel.testedAt = Date.now()
                            await channelManager.saveToConfig()
                        }
                    }
                    
                    res.json(ChaiteResponse.ok({
                        success: true,
                        message: successMsg,
                        testResponse: replyText,
                        elapsed
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

                // 如果有渠道 ID，更新渠道状态为错误
                if (id) {
                    const channel = channelManager.get(id)
                    if (channel) {
                        channel.status = 'error'
                        channel.lastHealthCheck = Date.now()
                        await channelManager.saveToConfig()
                    }
                }

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
        this.app.get('/api/tools/custom', this.authMiddleware.bind(this), async (req, res) => {
            const yamlTools = config.get('customTools') || []
            
            // 获取 JS 文件工具
            await mcpManager.init()
            const allTools = mcpManager.getTools()
            const jsTools = allTools
                .filter(t => t.isJsTool)
                .map(t => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema,
                    isJsTool: true,
                    readonly: true  // JS 工具只读，不能在面板编辑
                }))
            
            res.json(ChaiteResponse.ok([...yamlTools, ...jsTools]))
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

                // 刷新工具列表
                await mcpManager.refreshBuiltinTools()

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

                // 刷新工具列表
                await mcpManager.refreshBuiltinTools()

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

                // 刷新工具列表
                await mcpManager.refreshBuiltinTools()

                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== JS 工具文件 API ====================
        const jsToolsDir = path.join(__dirname, '../../data/tools')
        
        // GET /api/tools/js - 列出 JS 工具文件
        this.app.get('/api/tools/js', this.authMiddleware.bind(this), async (req, res) => {
            try {
                if (!fs.existsSync(jsToolsDir)) {
                    fs.mkdirSync(jsToolsDir, { recursive: true })
                }
                
                // 从已加载的 jsTools 中获取工具信息（包含实际工具名）
                await mcpManager.init()
                const jsTools = []
                
                for (const [toolName, tool] of builtinMcpServer.jsTools || new Map()) {
                    const filename = tool.__filename || `${toolName}.js`
                    const filePath = tool.__filepath || path.join(jsToolsDir, filename)
                    let stat = { size: 0, mtime: new Date() }
                    try {
                        stat = fs.statSync(filePath)
                    } catch {}
                    
                    jsTools.push({
                        name: toolName,  // 使用实际工具名
                        filename,
                        description: tool.description || tool.function?.description || '',
                        size: stat.size,
                        modifiedAt: stat.mtime.getTime()
                    })
                }
                
                res.json(ChaiteResponse.ok(jsTools))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        
        // GET /api/tools/js/:name - 读取 JS 工具源码
        this.app.get('/api/tools/js/:name', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const filename = req.params.name.endsWith('.js') ? req.params.name : `${req.params.name}.js`
                const filePath = path.join(jsToolsDir, filename)
                
                if (!fs.existsSync(filePath)) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Tool file not found'))
                }
                
                const source = fs.readFileSync(filePath, 'utf-8')
                const stat = fs.statSync(filePath)
                
                res.json(ChaiteResponse.ok({
                    name: req.params.name,
                    filename,
                    source,
                    size: stat.size,
                    modifiedAt: stat.mtime.getTime()
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        
        // PUT /api/tools/js/:name - 更新 JS 工具源码
        this.app.put('/api/tools/js/:name', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { source } = req.body
                if (!source) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'source is required'))
                }
                
                const filename = req.params.name.endsWith('.js') ? req.params.name : `${req.params.name}.js`
                const filePath = path.join(jsToolsDir, filename)
                
                // 写入文件
                fs.writeFileSync(filePath, source, 'utf-8')
                
                // 热重载
                await mcpManager.reloadJsTools()
                
                res.json(ChaiteResponse.ok({ 
                    success: true, 
                    message: '工具已保存并热重载'
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        
        // POST /api/tools/js - 创建新 JS 工具
        this.app.post('/api/tools/js', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { name, source } = req.body
                if (!name) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'name is required'))
                }
                
                const filename = name.endsWith('.js') ? name : `${name}.js`
                const filePath = path.join(jsToolsDir, filename)
                
                if (fs.existsSync(filePath)) {
                    return res.status(409).json(ChaiteResponse.fail(null, 'Tool file already exists'))
                }
                
                // 创建默认模板
                const defaultSource = source || `/**
 * ${name} - 自定义工具
 * 工具会自动注入以下全局变量:
 * - Bot: 机器人实例
 * - logger: 日志器
 * - redis: Redis 客户端
 * - segment: 消息构造器
 * - common: 常用工具函数
 */
export default {
    name: '${name}',
    description: '自定义工具描述',
    inputSchema: {
        type: 'object',
        properties: {
            message: {
                type: 'string',
                description: '参数描述'
            }
        },
        required: []
    },
    
    /**
     * 工具执行函数
     * @param {Object} args - 用户传入的参数
     * @param {Object} ctx - 上下文对象
     * @returns {Object} 返回结果
     */
    async run(args, ctx) {
        // 在这里编写工具逻辑
        return {
            text: '工具执行成功',
            data: args
        }
    }
}
`
                
                fs.writeFileSync(filePath, defaultSource, 'utf-8')
                
                // 热重载
                await mcpManager.reloadJsTools()
                
                res.status(201).json(ChaiteResponse.ok({ 
                    success: true,
                    filename,
                    message: '工具已创建'
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        
        // DELETE /api/tools/js/:name - 删除 JS 工具
        this.app.delete('/api/tools/js/:name', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const filename = req.params.name.endsWith('.js') ? req.params.name : `${req.params.name}.js`
                const filePath = path.join(jsToolsDir, filename)
                
                if (!fs.existsSync(filePath)) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Tool file not found'))
                }
                
                fs.unlinkSync(filePath)
                
                // 热重载
                await mcpManager.reloadJsTools()
                
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        
        // POST /api/tools/js/reload - 热重载所有 JS 工具
        this.app.post('/api/tools/js/reload', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.reloadJsTools()
                const count = mcpManager.builtinServer?.jsTools?.size || 0
                res.json(ChaiteResponse.ok({ 
                    success: true, 
                    count,
                    message: `已重载 ${count} 个 JS 工具`
                }))
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

                // 统一通过 mcpManager 调用（包括内置工具和自定义工具）
                await mcpManager.init()
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
        // 支持两种格式：
        // 1. { name, config } - 单个服务器
        // 2. { servers: { name1: config1, name2: config2 } } - 批量导入
        this.app.post('/api/mcp/servers', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.init()
                
                // 批量导入格式（兼容 MCP 标准配置格式）
                if (req.body.servers && typeof req.body.servers === 'object') {
                    const results = []
                    for (const [name, serverConfig] of Object.entries(req.body.servers)) {
                        try {
                            const server = await mcpManager.addServer(name, serverConfig)
                            results.push({ name, success: true, tools: server?.tools?.length || 0 })
                        } catch (err) {
                            results.push({ name, success: false, error: err.message })
                        }
                    }
                    return res.status(201).json(ChaiteResponse.ok({ imported: results }))
                }
                
                // 单个服务器格式
                const { name, config: serverConfig, ...directConfig } = req.body
                // 支持直接传配置对象（不带 config 包装）
                const finalConfig = serverConfig || (directConfig.type ? directConfig : null)
                
                if (!name || !finalConfig) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'Missing name or config'))
                }
                
                const server = await mcpManager.addServer(name, finalConfig)
                res.status(201).json(ChaiteResponse.ok(server))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/mcp/import - Import MCP config (支持完整配置粘贴)
        // 格式: { "mcp": { "servers": { ... } } } 或 { "servers": { ... } }
        this.app.post('/api/mcp/import', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.init()
                
                // 支持 { mcp: { servers: {} } } 或 { servers: {} } 格式
                const servers = req.body.mcp?.servers || req.body.servers
                
                if (!servers || typeof servers !== 'object') {
                    return res.status(400).json(ChaiteResponse.fail(null, 
                        '无效格式，请使用: { "servers": { "name": { "type": "stdio", ... } } }'))
                }
                
                const results = []
                for (const [name, serverConfig] of Object.entries(servers)) {
                    try {
                        const server = await mcpManager.addServer(name, serverConfig)
                        results.push({ 
                            name, 
                            success: true, 
                            type: serverConfig.type,
                            tools: server?.tools?.length || 0 
                        })
                        logger.info(`[MCP] Imported server: ${name} (${serverConfig.type})`)
                    } catch (err) {
                        results.push({ name, success: false, error: err.message })
                        logger.error(`[MCP] Failed to import server ${name}:`, err.message)
                    }
                }
                
                const successCount = results.filter(r => r.success).length
                res.json(ChaiteResponse.ok({ 
                    total: results.length,
                    success: successCount,
                    failed: results.length - successCount,
                    results 
                }))
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

        // DELETE /api/memory/clear-all - 清空所有用户记忆 (必须在 :userId 之前注册)
        this.app.delete('/api/memory/clear-all', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                
                // 使用批量清除方法
                const deletedCount = db.clearAllMemories()
                
                // 停止并重启MemoryManager的轮询
                const { memoryManager } = await import('./MemoryManager.js')
                memoryManager.stopPolling()
                memoryManager.lastPollTime.clear()
                if (memoryManager.groupMessageBuffer) {
                    memoryManager.groupMessageBuffer.clear()
                }
                memoryManager.startPolling()
                
                logger.info(`[WebServer] 清空所有记忆完成, 删除: ${deletedCount}条记忆`)
                res.json(ChaiteResponse.ok({ success: true, deletedCount }))
            } catch (error) {
                logger.error('[WebServer] 清空记忆失败:', error)
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

        // DELETE /api/conversations/clear-all - 清空所有对话 (必须在 :id 路由之前定义!)
        this.app.delete('/api/conversations/clear-all', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const db = getDatabase()
                
                // 使用批量清除方法
                const deletedCount = db.clearAllConversations()
                
                // 同时清除上下文缓存
                const { contextManager } = await import('./ContextManager.js')
                await contextManager.init()
                // 清除所有锁和处理标记
                contextManager.locks.clear()
                contextManager.lockQueues.clear()
                contextManager.processingFlags.clear()
                contextManager.messageQueues.clear()
                contextManager.requestCounters.clear()
                
                logger.info(`[WebServer] 清空所有对话完成, 删除: ${deletedCount}条消息`)
                res.json(ChaiteResponse.ok({ success: true, deletedCount }))
            } catch (error) {
                logger.error('[WebServer] 清空对话失败:', error)
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

        // ==================== Scope API (作用域管理) ====================
        // GET /api/scope/users - 列出所有用户作用域配置
        this.app.get('/api/scope/users', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const users = await sm.listUserSettings()
                res.json(ChaiteResponse.ok(users))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/user/:userId - 获取用户作用域配置
        this.app.get('/api/scope/user/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const settings = await sm.getUserSettings(req.params.userId)
                res.json(ChaiteResponse.ok(settings))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/scope/user/:userId - 设置用户作用域配置
        this.app.put('/api/scope/user/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.setUserSettings(req.params.userId, req.body)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/scope/user/:userId - 删除用户作用域配置
        this.app.delete('/api/scope/user/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.deleteUserSettings(req.params.userId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/groups - 列出所有群组作用域配置
        this.app.get('/api/scope/groups', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const groups = await sm.listGroupSettings()
                res.json(ChaiteResponse.ok(groups))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/group/:groupId - 获取群组作用域配置
        this.app.get('/api/scope/group/:groupId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const settings = await sm.getGroupSettings(req.params.groupId)
                res.json(ChaiteResponse.ok(settings))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/scope/group/:groupId - 设置群组作用域配置
        this.app.put('/api/scope/group/:groupId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.setGroupSettings(req.params.groupId, req.body)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/scope/group/:groupId - 删除群组作用域配置
        this.app.delete('/api/scope/group/:groupId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.deleteGroupSettings(req.params.groupId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/group-users - 列出所有群用户组合作用域配置
        this.app.get('/api/scope/group-users', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const groupUsers = await sm.listAllGroupUserSettings()
                res.json(ChaiteResponse.ok(groupUsers))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/group/:groupId/users - 列出群组内所有用户配置
        this.app.get('/api/scope/group/:groupId/users', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const users = await sm.listGroupUserSettings(req.params.groupId)
                res.json(ChaiteResponse.ok(users))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/group/:groupId/user/:userId - 获取群用户组合配置
        this.app.get('/api/scope/group/:groupId/user/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const settings = await sm.getGroupUserSettings(req.params.groupId, req.params.userId)
                res.json(ChaiteResponse.ok(settings))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/scope/group/:groupId/user/:userId - 设置群用户组合配置
        this.app.put('/api/scope/group/:groupId/user/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.setGroupUserSettings(req.params.groupId, req.params.userId, req.body)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/scope/group/:groupId/user/:userId - 删除群用户组合配置
        this.app.delete('/api/scope/group/:groupId/user/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.deleteGroupUserSettings(req.params.groupId, req.params.userId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/effective/:userId - 获取有效配置（按优先级）
        this.app.get('/api/scope/effective/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const groupId = req.query.groupId || null
                const effective = await sm.getEffectiveSettings(groupId, req.params.userId)
                res.json(ChaiteResponse.ok(effective))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/config/personality - 获取人设配置
        this.app.get('/api/config/personality', this.authMiddleware.bind(this), (req, res) => {
            try {
                const personality = config.get('personality') || {}
                res.json(ChaiteResponse.ok(personality))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PATCH /api/config/personality - 更新人设配置
        this.app.patch('/api/config/personality', this.authMiddleware.bind(this), (req, res) => {
            try {
                const currentPersonality = config.get('personality') || {}
                const updated = { ...currentPersonality, ...req.body }
                config.set('personality', updated)
                res.json(ChaiteResponse.ok(updated))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Auth Token Management API ====================
        // POST /api/auth/token/permanent - 生成永久Token
        this.app.post('/api/auth/token/permanent', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const token = authHandler.generateToken(0, true)
                res.json(ChaiteResponse.ok({ token, permanent: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/auth/token/permanent - 撤销永久Token
        this.app.delete('/api/auth/token/permanent', this.authMiddleware.bind(this), async (req, res) => {
            try {
                authHandler.revokePermanentToken()
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/auth/token/status - 获取Token状态
        this.app.get('/api/auth/token/status', this.authMiddleware.bind(this), async (req, res) => {
            try {
                res.json(ChaiteResponse.ok({
                    hasPermanentToken: authHandler.hasPermanentToken(),
                    tempTokenCount: authHandler.tokens.size
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/auth/token/generate - 生成临时登录Token并输出到控制台（与管理面板命令相同）
        this.app.get('/api/auth/token/generate', async (req, res) => {
            try {
                const token = authHandler.generateToken(5 * 60) // 5分钟有效，与管理面板命令一致
                logger.info('========================================')
                logger.info('[Chaite] 管理面板登录 Token (5分钟有效):')
                logger.info(token)
                logger.info('========================================')
                res.json(ChaiteResponse.ok({ 
                    success: true, 
                    message: 'Token 已输出到 Yunzai 控制台',
                    expiresIn: '5分钟'
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Features Configuration API ====================
        // GET /api/features - 获取所有功能配置
        this.app.get('/api/features', this.authMiddleware.bind(this), (req, res) => {
            const features = {
                voiceReply: config.get('features.voiceReply') || {
                    enabled: false,
                    triggerOnTool: true,
                    triggerAlways: false,
                    ttsProvider: 'miao',
                    maxTextLength: 500
                },
                groupContext: config.get('features.groupContext') || {
                    enabled: true,
                    maxMessages: 20
                },
                autoMemory: config.get('features.autoMemory') || {
                    enabled: true,
                    extractOnChat: true
                },
                replyQuote: config.get('features.replyQuote') || {
                    enabled: true,
                    handleText: true,
                    handleImage: true,
                    handleFile: true,
                    handleForward: true
                },
                atTrigger: config.get('features.atTrigger') || {
                    enabled: true,
                    requireAt: true,
                    prefix: ''
                }
            }
            res.json(ChaiteResponse.ok(features))
        })

        // PUT /api/features - 更新功能配置
        this.app.put('/api/features', this.authMiddleware.bind(this), (req, res) => {
            try {
                const { voiceReply, groupContext, autoMemory, replyQuote, atTrigger } = req.body
                
                if (voiceReply !== undefined) config.set('features.voiceReply', voiceReply)
                if (groupContext !== undefined) config.set('features.groupContext', groupContext)
                if (autoMemory !== undefined) config.set('features.autoMemory', autoMemory)
                if (replyQuote !== undefined) config.set('features.replyQuote', replyQuote)
                if (atTrigger !== undefined) config.set('features.atTrigger', atTrigger)
                
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/features/voiceReply - 获取语音回复配置
        this.app.get('/api/features/voiceReply', this.authMiddleware.bind(this), (req, res) => {
            const voiceConfig = config.get('features.voiceReply') || {
                enabled: false,
                triggerOnTool: true,
                triggerAlways: false,
                ttsProvider: 'miao',
                maxTextLength: 500
            }
            res.json(ChaiteResponse.ok(voiceConfig))
        })

        // PUT /api/features/voiceReply - 更新语音回复配置
        this.app.put('/api/features/voiceReply', this.authMiddleware.bind(this), (req, res) => {
            try {
                config.set('features.voiceReply', req.body)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== AI触发配置 API ====================
        // GET /api/trigger/config - 获取触发配置
        this.app.get('/api/trigger/config', this.authMiddleware.bind(this), (req, res) => {
            const defaultConfig = {
                private: { enabled: true, mode: 'always' },
                group: { 
                    enabled: true, 
                    at: true,           // @机器人触发
                    reply: false,       // 引用消息触发
                    replyBot: false,    // 引用机器人消息触发（防止重复响应）
                    prefix: true, 
                    keyword: false, 
                    random: false, 
                    randomRate: 0.05 
                },
                prefixes: ['#chat'],
                keywords: [],
                collectGroupMsg: true,
                blacklistUsers: [],
                whitelistUsers: [],
                blacklistGroups: [],
                whitelistGroups: []
            }
            // 优先返回新配置，兼容旧配置
            let triggerConfig = config.get('trigger')
            if (!triggerConfig?.private) {
                // 转换旧配置
                const oldCfg = config.get('listener') || {}
                const triggerMode = oldCfg.triggerMode || 'at'
                triggerConfig = {
                    private: {
                        enabled: oldCfg.privateChat?.enabled ?? true,
                        mode: oldCfg.privateChat?.alwaysReply ? 'always' : 'prefix'
                    },
                    group: {
                        enabled: oldCfg.groupChat?.enabled ?? true,
                        at: ['at', 'both'].includes(triggerMode),
                        prefix: ['prefix', 'both'].includes(triggerMode),
                        keyword: triggerMode === 'both',
                        random: triggerMode === 'random',
                        randomRate: oldCfg.randomReplyRate || 0.1
                    },
                    prefixes: oldCfg.triggerPrefix || ['#chat'],
                    keywords: oldCfg.triggerKeywords || [],
                    collectGroupMsg: oldCfg.groupChat?.collectMessages ?? true,
                    blacklistUsers: oldCfg.blacklistUsers || [],
                    whitelistUsers: oldCfg.whitelistUsers || [],
                    blacklistGroups: oldCfg.blacklistGroups || [],
                    whitelistGroups: oldCfg.whitelistGroups || []
                }
            }
            res.json(ChaiteResponse.ok({ ...defaultConfig, ...triggerConfig }))
        })

        // PUT /api/trigger/config - 更新触发配置
        this.app.put('/api/trigger/config', this.authMiddleware.bind(this), (req, res) => {
            try {
                const currentConfig = config.get('trigger') || {}
                const body = req.body
                
                const newConfig = {
                    private: { ...(currentConfig.private || {}), ...(body.private || {}) },
                    group: { ...(currentConfig.group || {}), ...(body.group || {}) },
                    prefixes: body.prefixes ?? currentConfig.prefixes ?? ['#chat'],
                    keywords: body.keywords ?? currentConfig.keywords ?? [],
                    collectGroupMsg: body.collectGroupMsg ?? currentConfig.collectGroupMsg ?? true,
                    blacklistUsers: body.blacklistUsers ?? currentConfig.blacklistUsers ?? [],
                    whitelistUsers: body.whitelistUsers ?? currentConfig.whitelistUsers ?? [],
                    blacklistGroups: body.blacklistGroups ?? currentConfig.blacklistGroups ?? [],
                    whitelistGroups: body.whitelistGroups ?? currentConfig.whitelistGroups ?? []
                }
                
                config.set('trigger', newConfig)
                logger.info('[WebServer] 触发配置已更新')
                res.json(ChaiteResponse.ok({ success: true, config: newConfig }))
            } catch (error) {
                logger.error('[WebServer] 保存触发配置失败:', error)
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        
        // 兼容旧API
        this.app.get('/api/listener/config', this.authMiddleware.bind(this), (req, res) => {
            res.redirect('/api/trigger/config')
        })
        this.app.put('/api/listener/config', this.authMiddleware.bind(this), (req, res) => {
            res.redirect(307, '/api/trigger/config')
        })

        // ==================== Platform & Message API ====================
        // GET /api/platform/info - 获取平台信息
        this.app.get('/api/platform/info', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { detectPlatform, getBotInfo } = await import('../utils/platformAdapter.js')
                const bot = global.Bot || {}
                const platform = detectPlatform({ bot })
                const botInfo = getBotInfo({ bot })
                
                const features = []
                if (bot.pickGroup) features.push('pickGroup')
                if (bot.pickFriend) features.push('pickFriend')
                if (bot.getMsg) features.push('getMsg')
                if (bot.getGroupMemberInfo) features.push('getGroupMemberInfo')
                
                res.json(ChaiteResponse.ok({
                    platform,
                    version: bot.version?.version || bot.version?.app_name || '',
                    uin: botInfo.uin,
                    nickname: botInfo.nickname,
                    features
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/message/query - 查询消息
        this.app.post('/api/message/query', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { type, value, group_id, user_id } = req.body
                const { getMessage, detectPlatform } = await import('../utils/platformAdapter.js')
                const bot = global.Bot || {}
                const platform = detectPlatform({ bot })
                
                const result = {
                    platform,
                    seq: type === 'seq' ? value : null,
                    message_id: type === 'message_id' ? value : null,
                    raw: null,
                    pb: null,
                    parsed: null,
                    methods_tried: []
                }
                
                let rawMsg = null
                
                // 尝试获取消息
                if (group_id && bot.pickGroup) {
                    const group = bot.pickGroup(parseInt(group_id))
                    
                    if (group.getMsg) {
                        try {
                            rawMsg = await group.getMsg(value)
                            result.methods_tried.push('group.getMsg')
                            if (rawMsg) {
                                result.raw = rawMsg
                                if (rawMsg.raw) {
                                    result.pb = {
                                        has_raw: true,
                                        raw_type: typeof rawMsg.raw,
                                        raw_length: rawMsg.raw?.length || 0
                                    }
                                    if (Buffer.isBuffer(rawMsg.raw)) {
                                        result.pb.hex_preview = rawMsg.raw.slice(0, 100).toString('hex')
                                    }
                                }
                            }
                        } catch (err) {
                            result.methods_tried.push(`group.getMsg failed: ${err.message}`)
                        }
                    }
                    
                    if (!rawMsg && group.getChatHistory) {
                        try {
                            const history = await group.getChatHistory(parseInt(value), 1)
                            if (history?.length > 0) {
                                rawMsg = history[0]
                                result.methods_tried.push('group.getChatHistory')
                                result.raw = rawMsg
                            }
                        } catch (err) {
                            result.methods_tried.push(`group.getChatHistory failed: ${err.message}`)
                        }
                    }
                }
                
                if (!rawMsg && bot.getMsg) {
                    try {
                        rawMsg = await bot.getMsg(value)
                        result.methods_tried.push('bot.getMsg')
                        result.raw = rawMsg
                    } catch (err) {
                        result.methods_tried.push(`bot.getMsg failed: ${err.message}`)
                    }
                }
                
                if (!rawMsg) {
                    return res.status(404).json(ChaiteResponse.fail(result, '获取消息失败'))
                }
                
                result.parsed = {
                    message_id: rawMsg.message_id || rawMsg.id,
                    seq: rawMsg.seq,
                    time: rawMsg.time,
                    sender: rawMsg.sender,
                    message: rawMsg.message,
                    raw_message: rawMsg.raw_message,
                    rand: rawMsg.rand,
                    font: rawMsg.font,
                    pktnum: rawMsg.pktnum,
                    real_id: rawMsg.real_id,
                    message_type: rawMsg.message_type
                }
                
                res.json(ChaiteResponse.ok(result))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/test/poke - 测试戳一戳
        this.app.post('/api/test/poke', this.authMiddleware.bind(this), async (req, res) => {
            try {
                res.json(ChaiteResponse.ok({ success: true, message: '戳一戳测试发送成功' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== Catch-all Route ====================
        // 支持 Next.js 静态导出的多 HTML 文件结构
        this.app.get('*', (req, res) => {
            const webDir = path.join(__dirname, '../../resources/web')
            let reqPath = req.path
            
            // 移除尾部斜杠（除了根路径）
            if (reqPath !== '/' && reqPath.endsWith('/')) {
                reqPath = reqPath.slice(0, -1)
            }
            
            // 尝试查找对应的 HTML 文件
            const candidates = [
                path.join(webDir, reqPath, 'index.html'),  // /channels/ -> /channels/index.html
                path.join(webDir, reqPath + '.html'),       // /channels -> /channels.html
                path.join(webDir, reqPath),                 // 直接匹配
            ]
            
            for (const candidate of candidates) {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                    return res.sendFile(candidate)
                }
            }
            
            // 回退到 index.html (SPA fallback)
            const indexPath = path.join(webDir, 'index.html')
            if (fs.existsSync(indexPath)) {
                return res.sendFile(indexPath)
            }
            
            res.status(404).send('Not Found')
        })
    }

    /**
     * Generate temporary login token (delegates to authHandler)
     * @param {number} expiresIn - Expiration time in seconds
     * @param {boolean} permanent - 是否永久有效
     * @returns {string} - Generated token
     */
    generateToken(expiresIn = 300, permanent = false) {
        return authHandler.generateToken(expiresIn, permanent)
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
     * @param {boolean} permanent - 是否永久有效
     * @returns {string}
     */
    generateLoginUrl(usePublic = false, permanent = false) {
        const token = authHandler.generateToken(permanent ? 0 : 5 * 60, permanent)
        const baseUrl = usePublic && this.addresses.public 
            ? this.addresses.public 
            : (this.addresses.local[0] || `http://127.0.0.1:${this.port}`)
        return `${baseUrl}/login/token?token=${token}`
    }

    /**
     * 检查前端是否已构建
     */
    checkFrontendBuild() {
        const webDir = path.join(__dirname, '../../resources/web')
        const indexFile = path.join(webDir, 'index.html')
        
        if (!fs.existsSync(webDir) || !fs.existsSync(indexFile)) {
            logger.warn('═══════════════════════════════════════════════════════════════')
            logger.warn('[WebServer] ⚠️  前端文件未构建！')
            logger.warn('[WebServer] 请执行以下命令构建前端:')
            logger.warn('[WebServer]   cd plugins/new-plugin/next-frontend && pnpm install && pnpm run export')
            logger.warn('═══════════════════════════════════════════════════════════════')
            return false
        }
        return true
    }

    /**
     * Start web server
     */
    async start() {
        // 检查前端是否已构建
        this.checkFrontendBuild()
        
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
