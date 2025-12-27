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
import { chatLogger, c as colors } from '../core/utils/logger.js'
import { mcpManager } from '../mcp/McpManager.js'
import { builtinMcpServer } from '../mcp/BuiltinMcpServer.js'
import { presetManager } from './preset/PresetManager.js'
import { channelManager, normalizeBaseUrl } from './llm/ChannelManager.js'
import { imageService } from './media/ImageService.js'
import { databaseService } from './storage/DatabaseService.js'
import { getScopeManager } from './scope/ScopeManager.js'
import { statsService } from './stats/StatsService.js'
import { usageStats } from './stats/UsageStats.js'

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
let authKey = crypto.randomUUID()

const SIGNATURE_SECRET = 'chatai-signature-key-2024'
class RequestSignatureValidator {
    /**
     * 生成签名
     * @param {string} method - 请求方法
     * @param {string} path - 请求路径
     * @param {string} timestamp - 时间戳
     * @param {string} bodyHash - 请求体hash（可选）
     * @param {string} nonce - 随机数
     * @returns {string} 签名
     */
    static generateSignature(method, path, timestamp, bodyHash = '', nonce = '') {
        const signatureString = `${SIGNATURE_SECRET}|${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}|${nonce}`
        const hash = crypto.createHash('sha256')
        hash.update(signatureString)
        return hash.digest('hex')
    }

    /**
     * 验证签名
     * @param {object} req - Express请求对象
     * @returns {{valid: boolean, error?: string}}
     */
    static validate(req) {
        const signature = req.headers['x-signature']
        const timestamp = req.headers['x-timestamp']
        const nonce = req.headers['x-nonce']
        const bodyHash = req.headers['x-body-hash'] || ''

        // 检查必要的头
        if (!signature || !timestamp || !nonce) {
            return { valid: false, error: 'Missing signature headers' }
        }

        // 验证时间戳（5分钟有效期）
        const now = Date.now()
        const requestTime = parseInt(timestamp, 10)
        if (isNaN(requestTime) || Math.abs(now - requestTime) > 5 * 60 * 1000) {
            return { valid: false, error: 'Request timestamp expired' }
        }

        // 生成预期签名
        const expectedSignature = this.generateSignature(
            req.method,
            req.path,
            timestamp,
            bodyHash,
            nonce
        )
        try {
            const sigBuffer = Buffer.from(signature, 'hex')
            const expectedBuffer = Buffer.from(expectedSignature, 'hex')
            if (sigBuffer.length !== expectedBuffer.length || 
                !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
                return { valid: false, error: 'Invalid signature' }
            }
        } catch {
            return { valid: false, error: 'Invalid signature format' }
        }

        return { valid: true }
    }
}
class RequestIdValidator {
    constructor(maxSize = 10000, expireMs = 5 * 60 * 1000) {
        this.usedIds = new Map() // requestId -> timestamp
        this.maxSize = maxSize
        this.expireMs = expireMs
        setInterval(() => this.cleanup(), 60 * 1000)
    }

    /**
     * @param {string} requestId 
     * @returns {boolean}
     */
    validate(requestId) {
        if (!requestId) return true 
        
        const now = Date.now()
        // 检查是否已使用
        if (this.usedIds.has(requestId)) {
            const usedTime = this.usedIds.get(requestId)
            if (now - usedTime < this.expireMs) {
                return false // 重放攻击
            }
        }
        
        // 记录使用
        this.usedIds.set(requestId, now)
        return true
    }

    cleanup() {
        const now = Date.now()
        for (const [id, time] of this.usedIds.entries()) {
            if (now - time > this.expireMs) {
                this.usedIds.delete(id)
            }
        }
        // 防止内存溢出
        if (this.usedIds.size > this.maxSize) {
            const entries = [...this.usedIds.entries()]
            entries.sort((a, b) => a[1] - b[1])
            const toDelete = entries.slice(0, entries.length - this.maxSize / 2)
            for (const [id] of toDelete) {
                this.usedIds.delete(id)
            }
        }
    }
}

const requestIdValidator = new RequestIdValidator()
class ClientFingerprintValidator {
    constructor() {
        this.tokenFingerprints = new Map()
    }

    /**
     * 绑定token与指纹
     */
    bind(jwtToken, fingerprint) {
        if (fingerprint) {
            this.tokenFingerprints.set(jwtToken, fingerprint)
        }
    }

    /**
     * 验证token的指纹是否匹配
     */
    validate(jwtToken, fingerprint) {
        const storedFingerprint = this.tokenFingerprints.get(jwtToken)
        if (!storedFingerprint) return true
        if (!fingerprint) return true
        return storedFingerprint === fingerprint
    }

    /**
     * 移除token指纹
     */
    remove(jwtToken) {
        this.tokenFingerprints.delete(jwtToken)
    }
}

const fingerprintValidator = new ClientFingerprintValidator()
class FrontendAuthHandler {
    constructor() {
        this.tokens = new Map() // token -> expiry
    }

    /**
     * 生成登录Token
     * @param {number} timeout - 超时时间（秒）
     * @param {boolean} permanent - 是否永久有效
     * @param {boolean} forceNew - 是否强制生成新token（永久token也会重新生成）
     * @returns {string} - 生成的token
     */
    generateToken(timeout = 5 * 60, permanent = false, forceNew = false) {
        // 永久Token存储到配置文件
        if (permanent) {
            let permanentToken = config.get('web.permanentAuthToken')
            // 如果不存在或者强制生成新token，则生成新的
            if (!permanentToken || forceNew) {
                permanentToken = crypto.randomUUID()
                config.set('web.permanentAuthToken', permanentToken)
                chatLogger.info('[Auth] 已生成新的永久登录Token')
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
     * 验证Token（临时token或永久token）
     * @param {string} token
     * @param {boolean} consumeTemp - 是否消耗临时token（用于登录时）
     * @returns {boolean}
     */
    validateToken(token, consumeTemp = true) {
        if (!token) return false

        // 优先检查永久Token（不消耗）
        const permanentToken = config.get('web.permanentAuthToken')
        if (permanentToken && token === permanentToken) {
            chatLogger.debug('[Auth] 永久Token验证成功')
            return true // 永久token可重复使用
        }

        // 检查临时Token
        const expiry = this.tokens.get(token)
        if (expiry && Date.now() < expiry) {
            // 验证成功后删除（一次性使用）
            if (consumeTemp) {
                this.tokens.delete(token)
                chatLogger.debug('[Auth] 临时Token验证成功并已消耗')
            }
            return true
        }

        chatLogger.debug('[Auth] Token验证失败:', token?.substring(0, 8) + '...')
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
        local: [],      // IPv4 地址
        localIPv6: [],  // IPv6 地址
        public: null,
        publicIPv6: null
    }
    
    // 获取本地地址（IPv4 和 IPv6）
    try {
        const os = await import('node:os')
        const interfaces = os.networkInterfaces()
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.internal) continue 
                
                if (iface.family === 'IPv4') {
                    addresses.local.push(`http://${iface.address}:${port}`)
                } else if (iface.family === 'IPv6') {
                    if (!iface.address.startsWith('fe80:')) {
                        addresses.localIPv6.push(`http://[${iface.address}]:${port}`)
                    }
                }
            }
        }
        addresses.local.unshift(`http://127.0.0.1:${port}`)
        addresses.localIPv6.unshift(`http://[::1]:${port}`)
    } catch (e) {
        addresses.local = [`http://127.0.0.1:${port}`]
        addresses.localIPv6 = [`http://[::1]:${port}`]
    }
    
    // 获取公网地址
    try {
        const https = await import('node:https')
        const http = await import('node:http')
        
        const getPublicIP = () => new Promise((resolve) => {
            const services = [
                // 国内 API 源（优先）
                { url: 'https://myip.ipip.net/ip', https: true },
                { url: 'https://ip.3322.net', https: true , parser: (data) => {
                    const match = data.match(/(\d+\.\d+\.\d+\.\d+)/)
                    return match ? match[1] : null
                }},
                { url: 'http://ip.chinaz.com/getip.aspx', https: false, parser: (data) => {
                    const match = data.match(/(\d+\.\d+\.\d+\.\d+)/)
                    return match ? match[1] : null
                }},
                // 国际 API 源
                { url: 'https://api.ipify.org', https: true },
                { url: 'https://icanhazip.com', https: true },
                { url: 'https://ifconfig.me/ip', https: true },
                { url: 'https://ipinfo.io/ip', https: true },
                { url: 'http://ip-api.com/line/?fields=query', https: false }
            ]
            
            let resolved = false
            let failedCount = 0
            const totalServices = services.length
            
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true
                    chatLogger.debug('[WebServer] 公网IP获取超时，尝试使用网卡外网IP')
                    // 尝试从本地地址中找一个非内网IP
                    const externalIP = findExternalIP(addresses.local)
                    resolve(externalIP)
                }
            }, 8000)
            
            // 尝试从本地地址找外网IP的函数
            function findExternalIP(localAddresses) {
                for (const addr of localAddresses) {
                    const match = addr.match(/(\d+\.\d+\.\d+\.\d+)/)
                    if (match) {
                        const ip = match[1]
                        // 排除内网IP段
                        if (!ip.startsWith('10.') && 
                            !ip.startsWith('192.168.') && 
                            !ip.startsWith('172.16.') && !ip.startsWith('172.17.') && 
                            !ip.startsWith('172.18.') && !ip.startsWith('172.19.') &&
                            !ip.startsWith('172.2') && !ip.startsWith('172.30.') && !ip.startsWith('172.31.') &&
                            !ip.startsWith('127.') &&
                            ip !== '0.0.0.0') {
                            return ip
                        }
                    }
                }
                return null
            }
            
            for (const service of services) {
                const client = service.https ? https : http
                const req = client.get(service.url, { timeout: 3000 }, (res) => {
                    let data = ''
                    res.on('data', chunk => data += chunk)
                    res.on('end', () => {
                        if (resolved) return
                        let ip = data.trim()
                        // 使用自定义解析器
                        if (service.parser) {
                            ip = service.parser(data)
                        }
                        if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
                            resolved = true
                            clearTimeout(timeout)
                            chatLogger.debug(`[WebServer] 公网IP获取成功: ${ip} (from ${service.url})`)
                            resolve(ip)
                        } else {
                            failedCount++
                            checkAllFailed()
                        }
                    })
                })
                req.on('error', (err) => {
                    chatLogger.debug(`[WebServer] 公网IP服务 ${service.url} 失败: ${err.message}`)
                    failedCount++
                    checkAllFailed()
                })
                req.on('timeout', () => {
                    req.destroy()
                    failedCount++
                    checkAllFailed()
                })
            }
            
            function checkAllFailed() {
                if (!resolved && failedCount >= totalServices) {
                    resolved = true
                    clearTimeout(timeout)
                    chatLogger.debug('[WebServer] 所有公网IP API失败，尝试使用网卡外网IP')
                    const externalIP = findExternalIP(addresses.local)
                    resolve(externalIP)
                }
            }
        })
        
        const publicIP = await getPublicIP()
        if (publicIP) {
            addresses.public = `http://${publicIP}:${port}`
        }
    } catch (e) {
        chatLogger.debug('[WebServer] 公网地址获取失败:', e.message)
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
        const staticPath = path.join(__dirname, '../../resources/web')
        this.app.use((req, res, next) => {
            if (req.path === '/login/token' || req.path === '/login/token/') {
                return next()
            }
            express.static(staticPath)(req, res, next)
        })
        
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
        const authLimiter = rateLimit({
            windowMs: 1 * 60 * 1000, // 1 minute
            max: 300000, 
            standardHeaders: true,
            legacyHeaders: false,
            message: ChaiteResponse.fail(null, 'Too many requests, please slow down.'),
            skip: (req) => {
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
        this.app.use('/api/', publicLimiter)
        this.app.use('/api/', authLimiter)
        this.app.use((err, req, res, next) => {
            chatLogger.error('[WebServer] Error:', err)

            if (res.headersSent) {
                return next(err)
            }

            res.status(err.status || 500).json(ChaiteResponse.fail(null,
                config.get('basic.debug') ? err.message : 'Internal server error'
            ))
        })
    }
    authMiddleware(req, res, next) {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json(ChaiteResponse.fail(null, 'Unauthorized'))
        }

        const token = authHeader.substring(7)
        const clientFingerprint = req.headers['x-client-fingerprint']
        const nonce = req.headers['x-nonce']
        const isSensitiveOperation = req.method !== 'GET'
        if (isSensitiveOperation) {
            const signatureResult = RequestSignatureValidator.validate(req)
            if (!signatureResult.valid) {
                chatLogger.warn(`[Auth] 签名验证失败: ${signatureResult.error} - ${req.method} ${req.path}`)
                return res.status(401).json(ChaiteResponse.fail(null, signatureResult.error))
            }
            if (nonce && !requestIdValidator.validate(nonce)) {
                return res.status(401).json(ChaiteResponse.fail(null, 'Request replay detected'))
            }
        }
        
        try {
            const decoded = jwt.verify(token, authKey, {
                algorithms: ['HS256'],
                complete: true
            })
            
            const payload = decoded.payload
            if (!payload.authenticated || !payload.loginTime) {
                return res.status(401).json(ChaiteResponse.fail(null, 'Invalid token payload'))
            }
            if (!fingerprintValidator.validate(token, clientFingerprint)) {
                chatLogger.warn(`[Auth] 客户端指纹不匹配: token来自不同设备`)
                return res.status(401).json(ChaiteResponse.fail(null, 'Client fingerprint mismatch'))
            }
            
            req.user = payload
            req.authToken = token
            next()
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json(ChaiteResponse.fail(null, 'Token expired'))
            }
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json(ChaiteResponse.fail(null, 'Invalid token'))
            }
            chatLogger.error('[Auth] Token验证错误:', error)
            return res.status(401).json(ChaiteResponse.fail(null, 'Authentication failed'))
        }
    }

    setupRoutes() {
        this.app.get('/login/token', async (req, res) => {
            const { token } = req.query
            const authHeader = req.headers.authorization
            const cookieToken = req.cookies?.auth_token
            const existingToken = authHeader?.startsWith('Bearer ') 
                ? authHeader.substring(7) 
                : cookieToken

            if (existingToken) {
                try {
                    jwt.verify(existingToken, authKey)
                    chatLogger.debug('[Auth] User already authenticated, redirecting to home...')
                    return res.redirect('/')
                } catch {
                }
            }

            if (!token) {
                return res.status(400).send('Token is required')
            }

            try {
                // 2. 验证临时token
                const success = authHandler.validateToken(token)
                
                if (success) {
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now(),
                        jti: crypto.randomUUID(),
                        iss: 'chatai-panel',
                        aud: 'chatai-client'
                    }, authKey, { 
                        expiresIn: '30d',
                        algorithm: 'HS256'
                    })
                    
                    chatLogger.debug('[Auth] Login successful via URL token')
                    res.cookie('auth_token', jwtToken, {
                        maxAge: 30 * 24 * 60 * 60 * 1000, // 30天
                        httpOnly: false, 
                        sameSite: 'lax',
                        path: '/'  
                    })
                    res.redirect(`/?auth_token=${jwtToken}`)
                } else {
                    res.status(401).send('Invalid or expired token. Please request a new login link.')
                }
            } catch (error) {
                chatLogger.error('[Auth] URL token login error:', error)
                res.status(500).send('Login failed: ' + error.message)
            }
        })
        this.app.post('/api/auth/login', async (req, res) => {
            const { token, password, fingerprint } = req.body
            const clientFingerprint = fingerprint || req.headers['x-client-fingerprint']

            try {
                let success = false
                let loginType = ''
                const authToken = token || password
                
                if (authToken) {
                    if (authHandler.validateToken(authToken)) {
                        success = true
                        loginType = 'temp_token'
                    }
                    else if (authHandler.validatePermanentToken(authToken)) {
                        success = true
                        loginType = 'permanent_token'
                    }
                }
                
                if (success) {
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now(),
                        jti: crypto.randomUUID(), // JWT ID 防止token碰撞
                        iss: 'chatai-panel',      // 签发者
                        aud: 'chatai-client'      // 受众
                    }, authKey, { 
                        expiresIn: '30d',
                        algorithm: 'HS256'
                    })

                    // 绑定客户端指纹（如果提供）
                    if (clientFingerprint) {
                        fingerprintValidator.bind(jwtToken, clientFingerprint)
                    }

                    chatLogger.debug(`[Auth] Login successful via ${loginType}`)
                    res.json(ChaiteResponse.ok({
                        token: jwtToken,
                        expiresIn: 30 * 24 * 60 * 60
                    }))
                } else {
                    res.status(401).json(ChaiteResponse.fail(null, 'Token 无效或已过期'))
                }
            } catch (error) {
                chatLogger.error('[Auth] Login error:', error)
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        
        // GET /api/auth/verify-token - URL token verification
        this.app.get('/api/auth/verify-token', async (req, res) => {
            const { token } = req.query
            const clientFingerprint = req.headers['x-client-fingerprint']

            try {
                if (!token) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'Token is required'))
                }
                
                const success = authHandler.validateToken(token)
                if (success) {
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now(),
                        jti: crypto.randomUUID(),
                        iss: 'chatai-panel',
                        aud: 'chatai-client'
                    }, authKey, { 
                        expiresIn: '30d',
                        algorithm: 'HS256'
                    })
                    if (clientFingerprint) {
                        fingerprintValidator.bind(jwtToken, clientFingerprint)
                    }

                    chatLogger.debug('[Auth] Login successful via URL token')
                    res.json(ChaiteResponse.ok({
                        token: jwtToken,
                        expiresIn: 30 * 24 * 60 * 60
                    }))
                } else {
                    res.status(401).json(ChaiteResponse.fail(null, 'Invalid or expired token'))
                }
            } catch (error) {
                chatLogger.error('[Auth] Token verification error:', error)
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
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
        this.app.get('/api/stats', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { statsService } = await import('./stats/StatsService.js')
                const stats = statsService.getOverview()
                res.json(ChaiteResponse.ok(stats))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/stats/full - 获取完整统计
        this.app.get('/api/stats/full', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { statsService } = await import('./stats/StatsService.js')
                const stats = statsService.getStats()
                res.json(ChaiteResponse.ok(stats))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/stats/reset - 重置统计
        this.app.post('/api/stats/reset', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { statsService } = await import('./stats/StatsService.js')
                statsService.reset()
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        // GET /api/stats/usage - 获取API使用统计
        this.app.get('/api/stats/usage', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const today = await usageStats.getTodayStats()
                const recent = await usageStats.getRecent(50)
                const modelRanking = await usageStats.getModelRanking(10)
                const channelRanking = await usageStats.getChannelRanking(10)
                res.json(ChaiteResponse.ok({ today, recent, modelRanking, channelRanking }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/stats/usage/recent - 获取最近使用记录
        this.app.get('/api/stats/usage/recent', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { limit = 100, channelId, model, success, source } = req.query
                const filter = {}
                if (channelId) filter.channelId = channelId
                if (model) filter.model = model
                if (success !== undefined) filter.success = success === 'true'
                if (source) filter.source = source
                const records = await usageStats.getRecent(parseInt(limit), filter)
                res.json(ChaiteResponse.ok(records))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/stats/usage/channel/:id - 获取渠道统计
        this.app.get('/api/stats/usage/channel/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const stats = await usageStats.getChannelStats(req.params.id)
                res.json(ChaiteResponse.ok(stats))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/stats/usage/clear - 清除使用统计
        this.app.post('/api/stats/usage/clear', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await usageStats.clear()
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        // GET /api/stats/tool-calls - 获取工具调用统计汇总
        this.app.get('/api/stats/tool-calls', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { statsService } = await import('./stats/StatsService.js')
                const summary = await statsService.getToolCallSummary()
                res.json(ChaiteResponse.ok(summary))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/stats/tool-calls/records - 获取工具调用详细记录
        this.app.get('/api/stats/tool-calls/records', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { statsService } = await import('./stats/StatsService.js')
                const { limit = 100, toolName, success, userId, groupId, keyword, startTime, endTime } = req.query
                const filter = {}
                if (toolName) filter.toolName = toolName
                if (success !== undefined) filter.success = success === 'true'
                if (userId) filter.userId = userId
                if (groupId) filter.groupId = groupId
                if (keyword) filter.keyword = keyword
                if (startTime) filter.startTime = parseInt(startTime)
                if (endTime) filter.endTime = parseInt(endTime)
                
                const records = await statsService.getToolCallRecords(filter, parseInt(limit))
                res.json(ChaiteResponse.ok(records))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/stats/tool-calls/record/:id - 获取单条工具调用记录详情
        this.app.get('/api/stats/tool-calls/record/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { statsService } = await import('./stats/StatsService.js')
                const record = await statsService.getToolCallRecord(req.params.id)
                if (!record) {
                    return res.status(404).json(ChaiteResponse.fail(null, '记录不存在'))
                }
                res.json(ChaiteResponse.ok(record))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/stats/tool-calls/errors - 获取工具调用错误记录
        this.app.get('/api/stats/tool-calls/errors', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { statsService } = await import('./stats/StatsService.js')
                const { limit = 50 } = req.query
                const errors = await statsService.getToolErrors(parseInt(limit))
                res.json(ChaiteResponse.ok(errors))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/stats/unified - 获取统一的完整统计（合并所有来源）
        this.app.get('/api/stats/unified', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { statsService } = await import('./stats/StatsService.js')
                const stats = await statsService.getUnifiedStats()
                res.json(ChaiteResponse.ok(stats))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/stats/tool-calls/clear - 清除工具调用统计
        this.app.post('/api/stats/tool-calls/clear', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { toolCallStats } = await import('./stats/ToolCallStats.js')
                await toolCallStats.clear()
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/config - Get configuration
        this.app.get('/api/config', this.authMiddleware.bind(this), (req, res) => {
            // Return full config for settings page (protected)
            res.json(ChaiteResponse.ok(config.get()))
        })

        // POST /api/config - Update configuration (protected)
        this.app.post('/api/config', this.authMiddleware.bind(this), (req, res) => {
            try {
                const { basic, llm, bym, thinking, streaming, admin, tools, features, memory, trigger, web } = req.body

                if (basic) config.set('basic', { ...config.get('basic'), ...basic })
                
                // web配置（登录链接等）
                if (web) {
                    const currentWeb = config.get('web') || {}
                    // loginLinks 是数组，直接覆盖而非合并
                    const mergedWeb = { ...currentWeb }
                    for (const [key, value] of Object.entries(web)) {
                        if (Array.isArray(value)) {
                            mergedWeb[key] = value  // 数组直接覆盖
                        } else if (typeof value === 'object' && value !== null) {
                            mergedWeb[key] = { ...(currentWeb[key] || {}), ...value }
                        } else {
                            mergedWeb[key] = value
                        }
                    }
                    config.set('web', mergedWeb)
                }
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
                
                // features深度合并（注意数组需要直接覆盖而非展开）
                if (features) {
                    const currentFeatures = config.get('features') || {}
                    const mergedFeatures = { ...currentFeatures }
                    for (const [key, value] of Object.entries(features)) {
                        if (Array.isArray(value)) {
                            // 数组直接覆盖
                            mergedFeatures[key] = value
                        } else if (typeof value === 'object' && value !== null) {
                            // 对象需要深度合并，但内部数组要直接覆盖
                            const currentObj = currentFeatures[key] || {}
                            const mergedObj = { ...currentObj }
                            for (const [subKey, subValue] of Object.entries(value)) {
                                if (Array.isArray(subValue)) {
                                    mergedObj[subKey] = subValue  // 数组直接覆盖
                                } else if (typeof subValue === 'object' && subValue !== null) {
                                    mergedObj[subKey] = { ...(currentObj[subKey] || {}), ...subValue }
                                } else {
                                    mergedObj[subKey] = subValue
                                }
                            }
                            mergedFeatures[key] = mergedObj
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

                chatLogger.debug('[WebServer] 配置已保存')
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                chatLogger.error('[WebServer] 保存配置失败:', error)
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/config/advanced - Get advanced configuration (protected)
        this.app.get('/api/config/advanced', this.authMiddleware.bind(this), (req, res) => {
            const advancedConfig = {
                thinking: config.get('thinking') || {
                    enabled: true,
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
                    maxTokens: config.get('context.maxTokens') || 4000,
                    cleaningStrategy: config.get('context.cleaningStrategy') || 'truncate',
                    isolation: config.get('context.isolation') || {
                        groupUserIsolation: false,
                        privateIsolation: true
                    },
                    autoContext: config.get('context.autoContext') || {
                        enabled: true,
                        maxHistoryMessages: 20,
                        includeToolCalls: false
                    },
                    autoEnd: config.get('context.autoEnd') || {
                        enabled: false,
                        maxRounds: 50,
                        notifyUser: true,
                        notifyMessage: '对话已达到最大轮数限制，已自动开始新会话。'
                    },
                    groupContextSharing: config.get('context.groupContextSharing'),
                    globalSystemPrompt: config.get('context.globalSystemPrompt') || '',
                    globalPromptMode: config.get('context.globalPromptMode') || 'append'
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
                },
                web: {
                    port: config.get('web.port') || 3000
                },
                redis: {
                    enabled: config.get('redis.enabled') !== false,
                    host: config.get('redis.host') || '127.0.0.1',
                    port: config.get('redis.port') || 6379,
                    password: config.get('redis.password') || '',
                    db: config.get('redis.db') || 0
                }
            }
            res.json(ChaiteResponse.ok(advancedConfig))
        })

        // PUT /api/config/advanced - Update advanced configuration (protected)
        this.app.put('/api/config/advanced', this.authMiddleware.bind(this), (req, res) => {
            const { thinking, streaming, llm, context, memory, tools, builtinTools, web, redis } = req.body

            if (thinking) {
                if (thinking.enabled !== undefined) {
                    config.set('thinking.enabled', thinking.enabled)
                }
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
                if (context.maxTokens) {
                    config.set('context.maxTokens', context.maxTokens)
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
                // 自动结束配置
                if (context.autoEnd) {
                    config.set('context.autoEnd', {
                        ...config.get('context.autoEnd'),
                        ...context.autoEnd
                    })
                }
                // 群上下文传递开关
                if (context.groupContextSharing !== undefined) {
                    config.set('context.groupContextSharing', context.groupContextSharing)
                }
                // 全局系统提示词
                if (context.globalSystemPrompt !== undefined) {
                    config.set('context.globalSystemPrompt', context.globalSystemPrompt)
                }
                // 全局提示词模式
                if (context.globalPromptMode !== undefined) {
                    config.set('context.globalPromptMode', context.globalPromptMode)
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

            // Web服务配置
            if (web) {
                if (web.port !== undefined) {
                    config.set('web.port', web.port)
                }
            }

            // Redis配置
            if (redis) {
                if (redis.enabled !== undefined) {
                    config.set('redis.enabled', redis.enabled)
                }
                if (redis.host !== undefined) {
                    config.set('redis.host', redis.host)
                }
                if (redis.port !== undefined) {
                    config.set('redis.port', redis.port)
                }
                if (redis.password !== undefined) {
                    config.set('redis.password', redis.password)
                }
                if (redis.db !== undefined) {
                    config.set('redis.db', redis.db)
                }
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
        // POST /api/auth/token/permanent - Generate permanent token
        // 支持 forceNew 参数强制生成新token
        this.app.post('/api/auth/token/permanent', this.authMiddleware.bind(this), (req, res) => {
            try {
                const forceNew = req.body?.forceNew === true
                // 在生成之前检查是否已有token
                const hadToken = authHandler.hasPermanentToken()
                const token = authHandler.generateToken(0, true, forceNew)
                // isNew: 如果强制重新生成，或者之前没有token
                res.json(ChaiteResponse.ok({ token, isNew: forceNew || !hadToken }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/auth/token/permanent - Revoke permanent token
        this.app.delete('/api/auth/token/permanent', this.authMiddleware.bind(this), (req, res) => {
            try {
                authHandler.revokePermanentToken()
                chatLogger.info('[Auth] 永久Token已撤销')
                res.json(ChaiteResponse.ok({ success: true, message: 'Token已撤销' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/auth/token/status - Get token status
        this.app.get('/api/auth/token/status', this.authMiddleware.bind(this), (req, res) => {
            try {
                const hasPermanent = authHandler.hasPermanentToken()
                const token = hasPermanent ? config.get('web.permanentAuthToken') : null
                res.json(ChaiteResponse.ok({ 
                    hasPermanentToken: hasPermanent,
                    token 
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        // GET /api/proxy - 获取代理配置
        this.app.get('/api/proxy', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { proxyService } = await import('./proxy/ProxyService.js')
                const proxyConfig = config.get('proxy') || {
                    enabled: false,
                    profiles: [],
                    scopes: {
                        browser: { enabled: false, profileId: null },
                        api: { enabled: false, profileId: null },
                        channel: { enabled: false, profileId: null }
                    }
                }
                res.json(ChaiteResponse.ok(proxyConfig))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/proxy - 更新代理全局设置
        this.app.put('/api/proxy', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { proxyService } = await import('./proxy/ProxyService.js')
                const { enabled } = req.body
                if (enabled !== undefined) {
                    proxyService.setEnabled(enabled)
                }
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/proxy/profiles - 获取代理配置列表
        this.app.get('/api/proxy/profiles', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { proxyService } = await import('./proxy/ProxyService.js')
                const profiles = proxyService.getProfiles()
                res.json(ChaiteResponse.ok(profiles))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/proxy/profiles - 添加代理配置
        this.app.post('/api/proxy/profiles', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { proxyService } = await import('./proxy/ProxyService.js')
                const { name, type, host, port, username, password } = req.body
                if (!host || !port) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'host and port are required'))
                }
                const profile = proxyService.addProfile({
                    name, type, host, port: parseInt(port), username, password
                })
                res.status(201).json(ChaiteResponse.ok(profile))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/proxy/profiles/:id - 更新代理配置
        this.app.put('/api/proxy/profiles/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { proxyService } = await import('./proxy/ProxyService.js')
                const { id } = req.params
                const updates = req.body
                if (updates.port) updates.port = parseInt(updates.port)
                const profile = proxyService.updateProfile(id, updates)
                if (!profile) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Profile not found'))
                }
                res.json(ChaiteResponse.ok(profile))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/proxy/profiles/:id - 删除代理配置
        this.app.delete('/api/proxy/profiles/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { proxyService } = await import('./proxy/ProxyService.js')
                const { id } = req.params
                const success = proxyService.deleteProfile(id)
                if (!success) {
                    return res.status(404).json(ChaiteResponse.fail(null, 'Profile not found'))
                }
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/proxy/scopes/:scope - 设置作用域代理
        this.app.put('/api/proxy/scopes/:scope', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { proxyService } = await import('./proxy/ProxyService.js')
                const { scope } = req.params
                const { profileId, enabled } = req.body
                
                const validScopes = ['browser', 'api', 'channel']
                if (!validScopes.includes(scope)) {
                    return res.status(400).json(ChaiteResponse.fail(null, `Invalid scope: ${scope}`))
                }
                
                proxyService.setScopeProxy(scope, profileId, enabled)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/proxy/test - 测试代理连接
        this.app.post('/api/proxy/test', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { proxyService } = await import('./proxy/ProxyService.js')
                const { profileId, testUrl } = req.body
                
                let profile
                if (profileId) {
                    profile = proxyService.getProfileById(profileId)
                    if (!profile) {
                        return res.status(404).json(ChaiteResponse.fail(null, 'Profile not found'))
                    }
                } else {
                    // 使用请求体中的临时配置进行测试
                    const { type, host, port, username, password } = req.body
                    if (!host || !port) {
                        return res.status(400).json(ChaiteResponse.fail(null, 'host and port are required'))
                    }
                    profile = { type, host, port: parseInt(port), username, password }
                }
                
                const result = await proxyService.testProxy(profile, testUrl || 'https://www.google.com')
                res.json(ChaiteResponse.ok(result))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        // GET /api/placeholders - 获取可用占位符列表
        this.app.get('/api/placeholders', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { requestTemplateService } = await import('./tools/RequestTemplateService.js')
                const placeholders = requestTemplateService.getAvailablePlaceholders()
                res.json(ChaiteResponse.ok(placeholders))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/placeholders/preview - 预览占位符替换结果
        this.app.post('/api/placeholders/preview', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { requestTemplateService } = await import('./tools/RequestTemplateService.js')
                const { template, context } = req.body
                const result = requestTemplateService.previewTemplate(template, context || {})
                res.json(ChaiteResponse.ok({ result }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        // GET /api/logs - 获取日志文件列表
        this.app.get('/api/logs', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { logService } = await import('./stats/LogService.js')
                const files = logService.getLogFiles()
                res.json(ChaiteResponse.ok(files))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/logs/recent - 获取最近的错误日志
        this.app.get('/api/logs/recent', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { logService } = await import('./stats/LogService.js')
                const lines = parseInt(req.query.lines) || 100
                const errors = logService.getRecentErrors(lines)
                res.json(ChaiteResponse.ok(errors))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
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
                // 如果设置 isDefault=true，需要先取消其他预设的 isDefault 状态
                if (req.body.isDefault === true) {
                    const allPresets = presetManager.getAll()
                    for (const p of allPresets) {
                        if (p.id !== req.params.id && p.isDefault) {
                            await presetManager.update(p.id, { isDefault: false })
                        }
                    }
                    // 同时更新配置
                    config.set('presets.defaultId', req.params.id)
                    config.set('llm.defaultChatPresetId', req.params.id)
                }
                
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
        // GET /api/presets/builtin - 获取所有内置预设
        this.app.get('/api/presets/builtin', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await presetManager.init()
                const builtinPresets = presetManager.getAllBuiltin()
                res.json(ChaiteResponse.ok(builtinPresets))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // GET /api/presets/categories - 获取预设分类
        this.app.get('/api/presets/categories', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await presetManager.init()
                const categories = presetManager.getCategories()
                res.json(ChaiteResponse.ok(categories))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // POST /api/preset/from-builtin/:builtinId - 从内置预设创建副本
        this.app.post('/api/preset/from-builtin/:builtinId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await presetManager.init()
                const preset = await presetManager.createFromBuiltin(req.params.builtinId, req.body)
                res.status(201).json(ChaiteResponse.ok(preset))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })
        // GET /api/knowledge - 获取所有知识库文档（列表模式返回摘要）
        this.app.get('/api/knowledge', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                const docs = knowledgeService.getAll()
                
                // 列表模式只返回摘要，避免传输大量数据
                const summaryDocs = docs.map(doc => ({
                    ...doc,
                    content: doc.content?.substring(0, 500) || '',
                    contentLength: doc.content?.length || 0,
                    truncated: (doc.content?.length || 0) > 500
                }))
                
                res.json(ChaiteResponse.ok(summaryDocs))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // GET /api/knowledge/:id - 获取单个知识库文档
        this.app.get('/api/knowledge/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                const doc = knowledgeService.get(req.params.id)
                if (doc) {
                    res.json(ChaiteResponse.ok(doc))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Document not found'))
                }
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // POST /api/knowledge - 创建知识库文档
        this.app.post('/api/knowledge', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                const doc = await knowledgeService.create(req.body)
                res.status(201).json(ChaiteResponse.ok(doc))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // PUT /api/knowledge/:id - 更新知识库文档
        this.app.put('/api/knowledge/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                const doc = await knowledgeService.update(req.params.id, req.body)
                res.json(ChaiteResponse.ok(doc))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // DELETE /api/knowledge/:id - 删除知识库文档
        this.app.delete('/api/knowledge/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                const deleted = await knowledgeService.delete(req.params.id)
                if (deleted) {
                    res.json(ChaiteResponse.ok(null))
                } else {
                    res.status(404).json(ChaiteResponse.fail(null, 'Document not found'))
                }
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // POST /api/knowledge/:id/link/:presetId - 关联知识库到预设
        this.app.post('/api/knowledge/:id/link/:presetId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                await knowledgeService.linkToPreset(req.params.id, req.params.presetId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // DELETE /api/knowledge/:id/link/:presetId - 取消关联
        this.app.delete('/api/knowledge/:id/link/:presetId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                await knowledgeService.unlinkFromPreset(req.params.id, req.params.presetId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // GET /api/preset/:id/knowledge - 获取预设关联的知识库
        this.app.get('/api/preset/:id/knowledge', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await presetManager.init()
                const docs = presetManager.getPresetKnowledge(req.params.id)
                res.json(ChaiteResponse.ok(docs))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // GET /api/knowledge/search - 搜索知识库
        this.app.get('/api/knowledge/search', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                const { q, presetId, limit } = req.query
                const results = knowledgeService.search(q || '', { presetId, limit: parseInt(limit) || 10 })
                res.json(ChaiteResponse.ok(results))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })

        // POST /api/knowledge/import - 导入知识库（支持 OpenIE 等格式）
        this.app.post('/api/knowledge/import', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { knowledgeService } = await import('./storage/KnowledgeService.js')
                await knowledgeService.init()
                
                const { data, format = 'openie', name, tags, presetIds, mergeMode } = req.body
                
                if (!data) {
                    return res.status(400).json(ChaiteResponse.fail(null, '缺少导入数据'))
                }

                let result
                if (format === 'openie') {
                    result = await knowledgeService.importOpenIE(data, { name, tags, presetIds, mergeMode })
                } else if (format === 'raw') {
                    // 直接导入原始文本
                    const doc = await knowledgeService.create({
                        name: name || '导入的文档',
                        content: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
                        type: typeof data === 'string' ? 'text' : 'json',
                        tags: tags || ['imported'],
                        presetIds: presetIds || []
                    })
                    result = { success: true, document: doc }
                } else {
                    return res.status(400).json(ChaiteResponse.fail(null, `不支持的格式: ${format}`))
                }

                res.json(ChaiteResponse.ok(result))
            } catch (err) {
                res.status(500).json(ChaiteResponse.fail(null, err.message))
            }
        })
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
            let { id, adapterType, baseUrl, apiKey, apiKeys, models, advanced, strategy } = req.body
            const startTime = Date.now()

            // 处理多Key和渠道配置 - 优先使用已保存渠道的完整配置
            let usedKeyIndex = -1
            let usedKeyName = ''
            let usedStrategy = ''
            let channelName = id || '临时测试'
            let channelConfig = null

            if (id) {
                const channel = channelManager.get(id)
                if (channel) {
                    channelConfig = channel
                    channelName = channel.name || id
                    // 使用渠道保存的配置（而非前端传入的）
                    adapterType = channel.adapterType
                    baseUrl = channel.baseUrl
                    models = channel.models
                    advanced = channel.advanced || advanced
                    
                    // 如果渠道有多个key，使用轮询获取
                    if (channel.apiKeys && channel.apiKeys.length > 0) {
                        const keyInfo = channelManager.getChannelKey(channel, { recordUsage: false })
                        apiKey = keyInfo.key
                        usedKeyIndex = keyInfo.keyIndex
                        usedKeyName = keyInfo.keyName
                        usedStrategy = keyInfo.strategy
                        chatLogger.info(`[测试渠道] 使用 ${channelName} 的 ${usedKeyName}, 策略: ${usedStrategy}`)
                    } else {
                        apiKey = channel.apiKey
                    }
                }
            } else if (apiKeys && apiKeys.length > 0) {
                // 前端传入的多key，根据策略选择
                usedStrategy = strategy || 'round-robin'
                let idx = 0
                if (usedStrategy === 'random') {
                    idx = Math.floor(Math.random() * apiKeys.length)
                }
                const keyObj = apiKeys[idx]
                apiKey = typeof keyObj === 'string' ? keyObj : keyObj.key
                usedKeyIndex = idx
                usedKeyName = typeof keyObj === 'object' ? keyObj.name : `Key#${idx + 1}`
                chatLogger.info(`[测试渠道] 使用临时Key: ${usedKeyName}`)
            }

            // 对于前端直接传入的URL（非已保存渠道），需要进行规范化处理
            // 使用统一的normalizeBaseUrl函数，避免重复拼接问题（如 /v2/v1）
            if (!id && baseUrl) {
                baseUrl = normalizeBaseUrl(baseUrl, adapterType)
            }

            chatLogger.info(`[测试渠道] 类型: ${adapterType}, BaseURL: ${baseUrl}`)

            const testMessage = '说一声你好'
            
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

                    // Apply advanced settings from channel config
                    const useStreaming = advanced?.streaming?.enabled || false
                    const temperature = advanced?.llm?.temperature ?? 0.7
                    const maxTokens = advanced?.llm?.maxTokens || 100
                    const topP = advanced?.llm?.topP ?? 1
                    const frequencyPenalty = advanced?.llm?.frequencyPenalty ?? 0
                    const presencePenalty = advanced?.llm?.presencePenalty ?? 0
                    
                    const options = {
                        model: testModel,
                        maxToken: maxTokens,
                        temperature,
                        topP,
                        frequencyPenalty,
                        presencePenalty,
                    }

                    // 显示完整配置信息
                    const keyInfo = usedKeyIndex >= 0 ? `, Key: ${usedKeyName}(#${usedKeyIndex + 1})` : ''
                    chatLogger.info(`[测试渠道] 使用模型: ${testModel}, 流式: ${useStreaming}, 温度: ${temperature}${keyInfo}`)

                    // Try a real chat completion request
                    chatLogger.info('[测试渠道] 发送测试消息...')

                    let replyText = ''
                    let apiUsage = null

                    if (useStreaming) {
                        // Test with streaming mode
                        const stream = await client.streamMessage(
                            [{ role: 'user', content: [{ type: 'text', text: testMessage }] }],
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
                            } else if (chunk.type === 'usage' || chunk.usage) {
                                // 获取流式模式的usage信息
                                apiUsage = chunk.usage || chunk
                            }
                        }

                        if (reasoningText) {
                            chatLogger.debug(`[测试渠道] AI思考过程: ${reasoningText.substring(0, 200)}...`)
                        }
                        chatLogger.info(`[测试渠道] 测试成功，AI回复: ${replyText}`)
                    } else {
                        // Test with non-streaming mode
                        const response = await client.sendMessage(
                            { role: 'user', content: [{ type: 'text', text: testMessage }] },
                            options
                        )

                        chatLogger.debug('[测试渠道] 收到响应:', JSON.stringify(response).substring(0, 200))

                        // Defensive check for response structure
                        if (!response || !response.contents || !Array.isArray(response.contents)) {
                            chatLogger.error('[测试渠道] 响应格式错误:', response)
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
                        
                        // 获取API返回的usage信息
                        apiUsage = response.usage
                        
                        chatLogger.info(`[测试渠道] 测试成功，AI回复: ${replyText || (hasReasoning ? '(思考内容)' : '(无)')}`)
                    }

                    const elapsed = Date.now() - startTime
                    const successMsg = replyText 
                        ? `连接成功！耗时 ${elapsed}ms，AI回复：${replyText.substring(0, 50)}${replyText.length > 50 ? '...' : ''}`
                        : `连接成功！耗时 ${elapsed}ms`
                    
                    // 记录使用统计
                    await statsService.recordApiCall({
                        channelId: id || 'test',
                        channelName,
                        model: testModel,
                        keyIndex: usedKeyIndex,
                        keyName: usedKeyName,
                        strategy: usedStrategy,
                        duration: elapsed,
                        success: true,
                        source: 'test',
                        responseText: replyText || '',
                        apiUsage,
                        request: { messages: [{ role: 'user', content: testMessage }], model: testModel },
                    })

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
                        elapsed,
                        keyInfo: usedKeyIndex >= 0 ? { index: usedKeyIndex, name: usedKeyName, strategy: usedStrategy } : null
                    }))
                } else {
                    res.json(ChaiteResponse.ok({ success: true, message: '该适配器暂不支持测试' }))
                }
            } catch (error) {
                const elapsed = Date.now() - startTime
                chatLogger.error('[测试渠道] 错误:', error)
                chatLogger.error('[测试渠道] 错误详情:', {
                    message: error.message,
                    status: error.status,
                    code: error.code,
                    type: error.type,
                    error: error.error
                })

                // 记录失败统计
                await statsService.recordApiCall({
                    channelId: id || 'test',
                    channelName,
                    model: models?.[0] || 'unknown',
                    keyIndex: usedKeyIndex,
                    keyName: usedKeyName,
                    strategy: usedStrategy,
                    duration: elapsed,
                    success: false,
                    error: error.message,
                    source: 'test',
                    request: { messages: [{ role: 'user', content: testMessage }], model: models?.[0] },
                    response: { error: error.message, status: error.status, code: error.code, type: error.type },
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

            // 对于前端直接传入的URL，需要进行规范化处理
            // 使用统一的normalizeBaseUrl函数，避免重复拼接问题（如 /v2/v1）
            if (baseUrl) {
                baseUrl = normalizeBaseUrl(baseUrl, adapterType)
            }

            try {
                if (adapterType === 'openai') {
                    // Use OpenAI SDK to fetch models
                    const OpenAI = (await import('openai')).default
                    const openai = new OpenAI({
                        apiKey: apiKey || config.get('openai.apiKey'),
                        baseURL: baseUrl || config.get('openai.baseUrl'),
                        // 添加浏览器请求头避免 CF 拦截
                        defaultHeaders: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'application/json, text/plain, */*',
                            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        },
                    })

                    chatLogger.debug('[获取模型] 正在请求模型列表...')
                    const modelsList = await openai.models.list()

                    // 打印原始响应结构
                    chatLogger.debug('[获取模型] 原始响应:', JSON.stringify(modelsList).substring(0, 500))

                    if (!modelsList || !modelsList.data || !Array.isArray(modelsList.data)) {
                        chatLogger.error('[获取模型] API返回格式错误，完整响应:', JSON.stringify(modelsList))

                        return res.status(500).json(ChaiteResponse.fail(null, 'API返回格式不正确'))
                    }

                    chatLogger.debug(`[获取模型] API返回 ${modelsList.data.length} 个模型`)

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
                        chatLogger.info(`[获取模型] 官方API过滤: ${beforeFilter} -> ${models.length}`)
                    } else {
                        chatLogger.debug(`[获取模型] 自定义API，不过滤模型`)
                    }

                    models = models.sort()

                    chatLogger.info(`[获取模型] 最终返回 ${models.length} 个模型`)

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

        // GET /api/tools/builtin/categories - Get tool categories
        this.app.get('/api/tools/builtin/categories', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await mcpManager.init()
                const categories = mcpManager.builtinServer?.getToolCategories?.() || []
                // 直接返回类别数组，前端期望的格式
                res.json(ChaiteResponse.ok(categories))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/tools/builtin/category/toggle - Toggle tool category
        this.app.post('/api/tools/builtin/category/toggle', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { category, enabled } = req.body
                if (!category) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'category is required'))
                }
                
                await mcpManager.init()
                const result = await mcpManager.builtinServer?.toggleCategory?.(category, enabled)
                res.json(ChaiteResponse.ok(result))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/tools/builtin/tool/toggle - Toggle single tool
        this.app.post('/api/tools/builtin/tool/toggle', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { toolName, enabled } = req.body
                if (!toolName) {
                    return res.status(400).json(ChaiteResponse.fail(null, 'toolName is required'))
                }
                
                await mcpManager.init()
                const result = await mcpManager.builtinServer?.toggleTool?.(toolName, enabled)
                res.json(ChaiteResponse.ok(result))
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
                // 管理面板测试工具时，设置 isMaster: true（已通过认证）
                await mcpManager.init()
                const result = await mcpManager.callTool(toolName, args || {}, {
                    context: { isMaster: true, isAdminTest: true }
                })

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
                        chatLogger.info(`[MCP] Imported server: ${name} (${serverConfig.type})`)
                    } catch (err) {
                        results.push({ name, success: false, error: err.message })
                        chatLogger.error(`[MCP] Failed to import server ${name}:`, err.message)
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
        // GET /api/memory/users - Get all users with memories
        this.app.get('/api/memory/users', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./storage/MemoryManager.js')
                const users = await memoryManager.listUsers()
                res.json(ChaiteResponse.ok(users))
            } catch (error) {
                res.json(ChaiteResponse.ok([]))
            }
        })

        // GET /api/memory/:userId - Get memories for a user
        this.app.get('/api/memory/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./storage/MemoryManager.js')
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
                const { memoryManager } = await import('./storage/MemoryManager.js')
                const id = await memoryManager.addMemory(userId, content, metadata)
                res.json(ChaiteResponse.ok({ id }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/memory/:userId/:memoryId - Delete a specific memory
        this.app.delete('/api/memory/:userId/:memoryId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./storage/MemoryManager.js')
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
                const { memoryManager } = await import('./storage/MemoryManager.js')
                memoryManager.stopPolling()
                memoryManager.lastPollTime.clear()
                if (memoryManager.groupMessageBuffer) {
                    memoryManager.groupMessageBuffer.clear()
                }
                memoryManager.startPolling()
                
                chatLogger.info(`[WebServer] 清空所有记忆完成, 删除: ${deletedCount}条记忆`)
                res.json(ChaiteResponse.ok({ success: true, deletedCount }))
            } catch (error) {
                chatLogger.error('[WebServer] 清空记忆失败:', error)
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/memory/:userId - Clear all memories for a user
        this.app.delete('/api/memory/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./storage/MemoryManager.js')
                await memoryManager.clearMemory(req.params.userId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/memory/:userId/summarize - 手动触发用户记忆总结（覆盖式）
        this.app.post('/api/memory/:userId/summarize', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./storage/MemoryManager.js')
                const result = await memoryManager.summarizeUserMemory(req.params.userId)
                if (result.success) {
                    res.json(ChaiteResponse.ok(result))
                } else {
                    res.status(400).json(ChaiteResponse.fail(null, result.error))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/memory/group/:groupId/summarize - 手动触发群记忆总结（覆盖式）
        this.app.post('/api/memory/group/:groupId/summarize', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./storage/MemoryManager.js')
                const result = await memoryManager.summarizeGroupMemory(req.params.groupId)
                if (result.success) {
                    res.json(ChaiteResponse.ok(result))
                } else {
                    res.status(400).json(ChaiteResponse.fail(null, result.error))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/state - Get state information (protected)
        this.app.get('/api/state', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok({
                isRunning: true,
                uptime: process.uptime()
            }))
        })
        // GET /api/processors/list - List all processors (protected)
        this.app.get('/api/processors/list', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok([]))
        })
        // GET /api/triggers/list - List all triggers (protected)
        this.app.get('/api/triggers/list', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok([]))
        })
        // GET /api/toolGroups/list - List all tool groups (protected)
        this.app.get('/api/toolGroups/list', this.authMiddleware.bind(this), (req, res) => {
            res.json(ChaiteResponse.ok([]))
        })

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
        // GET /api/context/list - List active contexts
        this.app.get('/api/context/list', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { contextManager } = await import('./llm/ContextManager.js')
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
                const { contextManager } = await import('./llm/ContextManager.js')
                await contextManager.init()

                const targetConvId = conversationId || contextManager.getConversationId(userId)
                await contextManager.cleanContext(targetConvId)

                // Also clear history completely?
                const { default: historyManager } = await import('../../core/utils/history.js')
                await historyManager.deleteConversation(targetConvId)

                res.json(ChaiteResponse.ok({ success: true, message: 'Context cleared' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        // GET /api/memory/:userId - Get memories for user
        this.app.get('/api/memory/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { memoryManager } = await import('./storage/MemoryManager.js')
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
                const { memoryManager } = await import('./storage/MemoryManager.js')
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
                const { memoryManager } = await import('./storage/MemoryManager.js')
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

                const { memoryManager } = await import('./storage/MemoryManager.js')
                await memoryManager.init()
                const memories = await memoryManager.searchMemory(userId, query, limit || 5)
                res.json(ChaiteResponse.ok(memories))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

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

        // GET /api/openai/models - OpenAI compatible models list (protected)
        this.app.get('/api/openai/models', this.authMiddleware.bind(this), async (req, res) => {
            try {
                await channelManager.init()
                const allChannels = channelManager.getAll()

                // Defensive check
                if (!allChannels || !Array.isArray(allChannels)) {
                    chatLogger.warn('[WebServer] channelManager.getAll() returned invalid data')
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
                chatLogger.error('[WebServer] Error fetching models:', error)
                res.status(500).json({
                    object: 'list',
                    data: []
                })
            }
        })
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
                    const { memoryManager } = await import('./storage/MemoryManager.js')
                    await memoryManager.clearMemory(req.params.userId)
                } catch (e) {}
                
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
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
                const { contextManager } = await import('./llm/ContextManager.js')
                await contextManager.init()
                // 清除所有锁和处理标记
                contextManager.locks?.clear()
                contextManager.processingFlags?.clear()
                contextManager.messageQueues?.clear()
                contextManager.requestCounters?.clear()
                contextManager.groupContextCache?.clear()
                contextManager.sessionStates?.clear()
                
                // 同时清空统计数据
                try {
                    const { statsService } = await import('./stats/StatsService.js')
                    await statsService.reset()
                    chatLogger.info('[WebServer] 统计数据已同步清空')
                } catch (e) {
                    chatLogger.warn('[WebServer] 清空统计数据失败:', e.message)
                }
                
                chatLogger.info(`[WebServer] 清空所有对话完成, 删除: ${deletedCount}条消息`)
                res.json(ChaiteResponse.ok({ success: true, deletedCount }))
            } catch (error) {
                chatLogger.error('[WebServer] 清空对话失败:', error)
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

        // ==================== 群组知识库与继承 API ====================
        
        // GET /api/scope/group/:groupId/knowledge - 获取群组知识库配置
        this.app.get('/api/scope/group/:groupId/knowledge', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const settings = await sm.getGroupSettings(req.params.groupId)
                res.json(ChaiteResponse.ok({
                    knowledgeIds: settings?.knowledgeIds || [],
                    inheritFrom: settings?.inheritFrom || []
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/scope/group/:groupId/knowledge - 设置群组知识库
        this.app.put('/api/scope/group/:groupId/knowledge', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const { knowledgeIds } = req.body
                await sm.setGroupKnowledge(req.params.groupId, knowledgeIds || [])
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/scope/group/:groupId/knowledge/:knowledgeId - 添加群组知识库
        this.app.post('/api/scope/group/:groupId/knowledge/:knowledgeId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.addGroupKnowledge(req.params.groupId, req.params.knowledgeId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/scope/group/:groupId/knowledge/:knowledgeId - 移除群组知识库
        this.app.delete('/api/scope/group/:groupId/knowledge/:knowledgeId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.removeGroupKnowledge(req.params.groupId, req.params.knowledgeId)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/scope/group/:groupId/inheritance - 设置群组继承来源
        this.app.put('/api/scope/group/:groupId/inheritance', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const { inheritFrom } = req.body
                await sm.setGroupInheritance(req.params.groupId, inheritFrom || [])
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/scope/group/:groupId/inheritance - 添加群组继承来源
        this.app.post('/api/scope/group/:groupId/inheritance', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const { source } = req.body
                if (!source) {
                    return res.status(400).json(ChaiteResponse.fail(null, '缺少继承来源'))
                }
                await sm.addGroupInheritance(req.params.groupId, source)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/scope/group/:groupId/inheritance - 移除群组继承来源
        this.app.delete('/api/scope/group/:groupId/inheritance', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const { source } = req.body
                if (!source) {
                    return res.status(400).json(ChaiteResponse.fail(null, '缺少继承来源'))
                }
                await sm.removeGroupInheritance(req.params.groupId, source)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/group/:groupId/resolved - 获取群组解析后的完整配置（含继承）
        this.app.get('/api/scope/group/:groupId/resolved', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const resolved = await sm.resolveGroupConfig(req.params.groupId)
                res.json(ChaiteResponse.ok(resolved))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/group/:groupId/bym-config - 获取群组伪人模式有效配置
        this.app.get('/api/scope/group/:groupId/bym-config', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const userId = req.query.userId || null
                const bymConfig = await sm.getEffectiveBymConfig(req.params.groupId, userId, {
                    includeKnowledge: req.query.includeKnowledge !== 'false'
                })
                res.json(ChaiteResponse.ok(bymConfig))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== 私聊作用域 API ====================
        // GET /api/scope/privates - 列出所有私聊作用域配置
        this.app.get('/api/scope/privates', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const privates = await sm.listPrivateSettings()
                res.json(ChaiteResponse.ok(privates))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/scope/private/:userId - 获取私聊作用域配置
        this.app.get('/api/scope/private/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                const settings = await sm.getPrivateSettings(req.params.userId)
                res.json(ChaiteResponse.ok(settings))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/scope/private/:userId - 设置私聊作用域配置
        this.app.put('/api/scope/private/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.setPrivateSettings(req.params.userId, req.body)
                res.json(ChaiteResponse.ok({ success: true }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/scope/private/:userId - 删除私聊作用域配置
        this.app.delete('/api/scope/private/:userId', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const sm = await ensureScopeManager()
                await sm.deletePrivateSettings(req.params.userId)
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

        // GET /api/auth/token/generate - 生成临时登录Token并输出到控制台（与管理面板命令相同）
        this.app.get('/api/auth/token/generate', async (req, res) => {
            try {
                const token = authHandler.generateToken(5 * 60) // 5分钟有效，与管理面板命令一致
                chatLogger.info('========================================')
                chatLogger.info('[Chaite] 管理面板登录 Token (5分钟有效):')
                chatLogger.info(token)
                chatLogger.info('========================================')
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
                chatLogger.info('[WebServer] 触发配置已更新')
                res.json(ChaiteResponse.ok({ success: true, config: newConfig }))
            } catch (error) {
                chatLogger.error('[WebServer] 保存触发配置失败:', error)
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

        // ==================== 绘图预设管理 API ====================
        // GET /api/imagegen/presets - 获取所有预设
        this.app.get('/api/imagegen/presets', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.init()
                res.json(ChaiteResponse.ok({
                    presets: imageGenPresetManager.getAllPresets(),
                    stats: imageGenPresetManager.getStats()
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/imagegen/presets/reload - 热重载预设
        this.app.post('/api/imagegen/presets/reload', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.loadAllPresets()
                res.json(ChaiteResponse.ok({
                    message: '预设重载成功',
                    stats: imageGenPresetManager.getStats()
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/imagegen/presets/update - 从远程更新预设
        this.app.post('/api/imagegen/presets/update', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { sourceName } = req.body || {}
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                const results = await imageGenPresetManager.updateFromRemote(sourceName)
                res.json(ChaiteResponse.ok({
                    results,
                    stats: imageGenPresetManager.getStats()
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/imagegen/config - 获取绘图配置
        this.app.get('/api/imagegen/config', this.authMiddleware.bind(this), async (req, res) => {
            const imageGenConfig = config.get('features.imageGen') || {}
            const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
            await imageGenPresetManager.init()
            const customPresetsWithUid = imageGenPresetManager.customPresets.map(p => {
                const { source, ...rest } = p
                return rest
            })
            res.json(ChaiteResponse.ok({ ...imageGenConfig, customPresets: customPresetsWithUid }))
        })
        this.app.put('/api/imagegen/config', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const updates = req.body
                const current = config.get('features.imageGen') || {}
                const merged = { ...current, ...updates }
                config.set('features.imageGen', merged)
                
                // 如果更新了预设相关配置，触发热重载
                if (updates.presetSources || updates.customPresets) {
                    const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                    await imageGenPresetManager.loadAllPresets()
                }
                
                res.json(ChaiteResponse.ok({ message: '配置已更新', config: merged }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/imagegen/sources - 添加预设来源
        this.app.post('/api/imagegen/sources', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { name, url, enabled = true } = req.body
                if (!name || !url) {
                    return res.status(400).json(ChaiteResponse.fail(null, '缺少 name 或 url'))
                }
                
                const sources = config.get('features.imageGen.presetSources') || []
                if (sources.some(s => s.url === url)) {
                    return res.status(400).json(ChaiteResponse.fail(null, '来源已存在'))
                }
                
                sources.push({ name, url, enabled })
                config.set('features.imageGen.presetSources', sources)
                
                res.json(ChaiteResponse.ok({ message: '来源已添加', sources }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/imagegen/sources/:index - 删除预设来源
        this.app.delete('/api/imagegen/sources/:index', this.authMiddleware.bind(this), (req, res) => {
            try {
                const index = parseInt(req.params.index)
                const sources = config.get('features.imageGen.presetSources') || []
                
                if (index < 0 || index >= sources.length) {
                    return res.status(400).json(ChaiteResponse.fail(null, '索引无效'))
                }
                
                sources.splice(index, 1)
                config.set('features.imageGen.presetSources', sources)
                
                res.json(ChaiteResponse.ok({ message: '来源已删除', sources }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // POST /api/imagegen/custom-presets - 添加自定义预设
        this.app.post('/api/imagegen/custom-presets', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { keywords, prompt, needImage = true, splitGrid } = req.body
                if (!keywords || !prompt) {
                    return res.status(400).json(ChaiteResponse.fail(null, '缺少 keywords 或 prompt'))
                }
                
                const keywordArr = Array.isArray(keywords) ? keywords : [keywords]
                const presets = config.get('features.imageGen.customPresets') || []
                const newPreset = { keywords: keywordArr, prompt, needImage }
                if (splitGrid && splitGrid.cols && splitGrid.rows) {
                    newPreset.splitGrid = { cols: splitGrid.cols, rows: splitGrid.rows }
                }
                presets.push(newPreset)
                config.set('features.imageGen.customPresets', presets)
                
                // 热重载
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.loadAllPresets()
                
                res.json(ChaiteResponse.ok({ message: '预设已添加', presets }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/imagegen/custom-presets/:index - 删除自定义预设
        this.app.delete('/api/imagegen/custom-presets/:index', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const index = parseInt(req.params.index)
                const presets = config.get('features.imageGen.customPresets') || []
                
                if (index < 0 || index >= presets.length) {
                    return res.status(400).json(ChaiteResponse.fail(null, '索引无效'))
                }
                
                presets.splice(index, 1)
                config.set('features.imageGen.customPresets', presets)
                
                // 热重载
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.loadAllPresets()
                
                res.json(ChaiteResponse.ok({ message: '预设已删除', presets }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/imagegen/remote-presets/:source/:uid - 编辑云端预设（通过UID）
        this.app.put('/api/imagegen/remote-presets/:source/:uid', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { source, uid } = req.params
                const { keywords, prompt, needImage, splitGrid } = req.body
                
                if (!keywords || !prompt) {
                    return res.status(400).json(ChaiteResponse.fail(null, '缺少 keywords 或 prompt'))
                }
                
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.init()
                
                // 获取该来源的预设
                const sourcePresets = imageGenPresetManager.remotePresets[source]
                if (!sourcePresets) {
                    return res.status(400).json(ChaiteResponse.fail(null, '来源不存在'))
                }
                
                // 通过UID查找预设
                const index = sourcePresets.findIndex(p => p.uid === uid)
                if (index === -1) {
                    return res.status(400).json(ChaiteResponse.fail(null, '预设不存在'))
                }
                
                // 更新预设
                const keywordArr = Array.isArray(keywords) ? keywords : keywords.split(/[,，\s]+/).filter(k => k.trim())
                const updatedPreset = {
                    ...sourcePresets[index],
                    keywords: keywordArr,
                    prompt,
                    needImage: needImage !== false
                }
                // 处理splitGrid配置
                if (splitGrid && splitGrid.cols && splitGrid.rows) {
                    updatedPreset.splitGrid = { cols: splitGrid.cols, rows: splitGrid.rows }
                } else {
                    delete updatedPreset.splitGrid
                }
                sourcePresets[index] = updatedPreset
                
                // 保存到缓存文件
                const fs = await import('fs')
                const path = await import('path')
                const { fileURLToPath } = await import('url')
                const __dirname = path.dirname(fileURLToPath(import.meta.url))
                const PRESET_CACHE_DIR = path.join(__dirname, '../../data/presets')
                if (!fs.existsSync(PRESET_CACHE_DIR)) {
                    fs.mkdirSync(PRESET_CACHE_DIR, { recursive: true })
                }
                const sources = config.get('features.imageGen.presetSources') || []
                const sourceConfig = sources.find(s => s.name === source)
                if (sourceConfig) {
                    const urlToFilename = (url) => url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)
                    const cacheFile = path.join(PRESET_CACHE_DIR, `${urlToFilename(sourceConfig.url)}.json`)
                    
                    // 保存更新后的预设（不带source字段）
                    const rawPresets = sourcePresets.map(p => {
                        const { source: _, ...rest } = p
                        return rest
                    })
                    fs.writeFileSync(cacheFile, JSON.stringify(rawPresets, null, 2), 'utf-8')
                }
                
                // 热重载
                await imageGenPresetManager.loadAllPresets()
                
                res.json(ChaiteResponse.ok({ 
                    message: '预设已更新',
                    preset: sourcePresets[index]
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.delete('/api/imagegen/remote-presets/:source/:uid', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { source, uid } = req.params
                
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.init()
                
                const sourcePresets = imageGenPresetManager.remotePresets[source]
                if (!sourcePresets) {
                    return res.status(400).json(ChaiteResponse.fail(null, '来源不存在'))
                }
                
                const index = sourcePresets.findIndex(p => p.uid === uid)
                if (index === -1) {
                    return res.status(400).json(ChaiteResponse.fail(null, '预设不存在'))
                }
                sourcePresets.splice(index, 1)
                const fs = await import('fs')
                const path = await import('path')
                const { fileURLToPath } = await import('url')
                const __dirname = path.dirname(fileURLToPath(import.meta.url))
                const PRESET_CACHE_DIR = path.join(__dirname, '../../data/presets')
                const sources = config.get('features.imageGen.presetSources') || []
                const sourceConfig = sources.find(s => s.name === source)
                if (sourceConfig) {
                    const urlToFilename = (url) => url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)
                    const cacheFile = path.join(PRESET_CACHE_DIR, `${urlToFilename(sourceConfig.url)}.json`)
                    const rawPresets = sourcePresets.map(p => {
                        const { source: _, ...rest } = p
                        return rest
                    })
                    fs.writeFileSync(cacheFile, JSON.stringify(rawPresets, null, 2), 'utf-8')
                }
                
                // 热重载
                await imageGenPresetManager.loadAllPresets()
                
                res.json(ChaiteResponse.ok({ message: '预设已删除' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // PUT /api/imagegen/custom-presets/:uid - 编辑自定义预设（通过UID）
        this.app.put('/api/imagegen/custom-presets/:uid', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { uid } = req.params
                const { keywords, prompt, needImage, splitGrid } = req.body
                
                if (!keywords || !prompt) {
                    return res.status(400).json(ChaiteResponse.fail(null, '缺少 keywords 或 prompt'))
                }
                
                const presets = config.get('features.imageGen.customPresets') || []
                
                // 通过UID查找预设
                const index = presets.findIndex(p => p.uid === uid)
                if (index === -1) {
                    return res.status(400).json(ChaiteResponse.fail(null, '预设不存在'))
                }
                
                const keywordArr = Array.isArray(keywords) ? keywords : keywords.split(/[,，\s]+/).filter(k => k.trim())
                const updatedPreset = {
                    ...presets[index],
                    keywords: keywordArr,
                    prompt,
                    needImage: needImage !== false
                }
                // 处理splitGrid配置
                if (splitGrid && splitGrid.cols && splitGrid.rows) {
                    updatedPreset.splitGrid = { cols: splitGrid.cols, rows: splitGrid.rows }
                } else {
                    delete updatedPreset.splitGrid
                }
                presets[index] = updatedPreset
                config.set('features.imageGen.customPresets', presets)
                
                // 热重载
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.loadAllPresets()
                
                res.json(ChaiteResponse.ok({ message: '预设已更新', presets }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.put('/api/imagegen/builtin-presets/:uid', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { uid } = req.params
                const { keywords, prompt, needImage, splitGrid } = req.body
                if (!keywords || !prompt) {
                    return res.status(400).json(ChaiteResponse.fail(null, '缺少 keywords 或 prompt'))
                }
                const presets = config.get('features.imageGen.builtinPresets') || []
                const index = presets.findIndex(p => p.uid === uid)
                if (index === -1) {
                    return res.status(400).json(ChaiteResponse.fail(null, '预设不存在'))
                }
                
                const keywordArr = Array.isArray(keywords) ? keywords : keywords.split(/[,，\s]+/).filter(k => k.trim())
                const updatedPreset = {
                    ...presets[index],
                    keywords: keywordArr,
                    prompt,
                    needImage: needImage !== false
                }
                // 处理splitGrid配置
                if (splitGrid && splitGrid.cols && splitGrid.rows) {
                    updatedPreset.splitGrid = { cols: splitGrid.cols, rows: splitGrid.rows }
                } else {
                    delete updatedPreset.splitGrid
                }
                presets[index] = updatedPreset
                config.set('features.imageGen.builtinPresets', presets)
                
                // 热重载
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.loadAllPresets()
                
                res.json(ChaiteResponse.ok({ message: '预设已更新', presets }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/imagegen/builtin-presets/:uid - 删除内置预设（通过UID）
        this.app.delete('/api/imagegen/builtin-presets/:uid', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { uid } = req.params
                const presets = config.get('features.imageGen.builtinPresets') || []
                const index = presets.findIndex(p => p.uid === uid)
                
                if (index === -1) {
                    return res.status(400).json(ChaiteResponse.fail(null, '预设不存在'))
                }
                
                presets.splice(index, 1)
                config.set('features.imageGen.builtinPresets', presets)
                
                // 热重载
                const { imageGenPresetManager } = await import('../../apps/ImageGen.js')
                await imageGenPresetManager.loadAllPresets()
                
                res.json(ChaiteResponse.ok({ message: '预设已删除', presets }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
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
        this.app.post('/api/test/poke', this.authMiddleware.bind(this), async (req, res) => {
            try {
                res.json(ChaiteResponse.ok({ success: true, message: '戳一戳测试发送成功' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.get('/api/workflows', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { workflowService } = await import('./workflow/WorkflowService.js')
                await workflowService.init()
                const workflows = workflowService.listWorkflows()
                res.json(ChaiteResponse.ok(workflows))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.get('/api/workflows/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { workflowService } = await import('./workflow/WorkflowService.js')
                await workflowService.init()
                const workflow = workflowService.getWorkflow(req.params.id)
                if (!workflow) {
                    return res.status(404).json(ChaiteResponse.fail(null, '工作流不存在'))
                }
                res.json(ChaiteResponse.ok(workflow))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.post('/api/workflows', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { workflowService } = await import('./workflow/WorkflowService.js')
                await workflowService.init()
                const workflow = req.body
                if (!workflow.id) {
                    workflow.id = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
                }
                workflowService.saveWorkflow(workflow)
                res.json(ChaiteResponse.ok(workflow))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.put('/api/workflows/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { workflowService } = await import('./workflow/WorkflowService.js')
                await workflowService.init()
                const workflow = { ...req.body, id: req.params.id }
                workflowService.saveWorkflow(workflow)
                res.json(ChaiteResponse.ok(workflow))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.delete('/api/workflows/:id', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { workflowService } = await import('./workflow/WorkflowService.js')
                await workflowService.init()
                workflowService.deleteWorkflow(req.params.id)
                res.json(ChaiteResponse.ok({ message: '工作流已删除' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.post('/api/workflows/:id/execute', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { workflowService } = await import('./workflow/WorkflowService.js')
                await workflowService.init()
                const { inputs = {}, options = {} } = req.body
                const result = await workflowService.execute(req.params.id, inputs, options)
                res.json(ChaiteResponse.ok(result))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.get('/api/workflows/running', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { workflowService } = await import('./workflow/WorkflowService.js')
                const instances = workflowService.getRunningInstances()
                res.json(ChaiteResponse.ok(instances))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.post('/api/workflows/example', this.authMiddleware.bind(this), async (req, res) => {
            try {
                const { workflowService } = await import('./workflow/WorkflowService.js')
                await workflowService.init()
                const example = workflowService.createExampleWorkflow()
                res.json(ChaiteResponse.ok(example))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })
        this.app.get('*', (req, res) => {
            const webDir = path.join(__dirname, '../../resources/web')
            let reqPath = req.path
            if (reqPath !== '/' && reqPath.endsWith('/')) {
                reqPath = reqPath.slice(0, -1)
            }
            const candidates = [
                path.join(webDir, reqPath, 'index.html'),  
                path.join(webDir, reqPath + '.html'),      
                path.join(webDir, reqPath),                 
            ]
            
            for (const candidate of candidates) {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                    return res.sendFile(candidate)
                }
            }
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
     * @param {boolean} forceNew - 是否强制生成新token
     * @returns {string}
     */
    generateLoginUrl(usePublic = false, permanent = false, forceNew = false) {
        const token = authHandler.generateToken(permanent ? 0 : 5 * 60, permanent, forceNew)
        let baseUrl
        if (usePublic) {
            const configPublicUrl = config.get('web.publicUrl')
            if (configPublicUrl) {
                baseUrl = configPublicUrl.replace(/\/$/, '') // 移除末尾斜杠
            } else if (this.addresses?.public) {
                baseUrl = this.addresses.public
            }
        }
        if (!baseUrl) {
            baseUrl = this.addresses?.local?.[0] || `http://127.0.0.1:${this.port}`
        }
        
        return `${baseUrl}/login/token?token=${token}`
    }

    /**
     * @param {boolean} permanent - 是否永久token
     * @param {boolean} forceNew - 是否强制生成新token
     * @returns {Object}
     */
    getLoginInfo(permanent = false, forceNew = false) {
        const token = authHandler.generateToken(permanent ? 0 : 5 * 60, permanent, forceNew)
        const localUrls = (this.addresses?.local || [`http://127.0.0.1:${this.port}`]).map(addr => 
            `${addr}/login/token?token=${token}`
        )
        const localIPv6Urls = (this.addresses?.localIPv6 || []).map(addr => 
            `${addr}/login/token?token=${token}`
        )
        const loginLinks = config.get('web.loginLinks') || []
        chatLogger.debug(`[WebServer] getLoginInfo: loginLinks =`, JSON.stringify(loginLinks))
        const customUrls = loginLinks.map(link => ({
            label: link.label,
            url: `${link.baseUrl.replace(/\/$/, '')}/login/token?token=${token}`
        }))
        let publicUrl = null
        const configPublicUrl = config.get('web.publicUrl')
        chatLogger.debug(`[WebServer] getLoginInfo: configPublicUrl=${configPublicUrl}, addresses.public=${this.addresses?.public}`)
        if (configPublicUrl) {
            publicUrl = `${configPublicUrl.replace(/\/$/, '')}/login/token?token=${token}`
        } else if (this.addresses?.public) {
            publicUrl = `${this.addresses.public}/login/token?token=${token}`
        }
        
        return {
            localUrl: localUrls[0], 
            localUrls,             
            localIPv6Urls,         
            publicUrl,
            customUrls: customUrls.length > 0 ? customUrls : null,
            validity: permanent ? '永久有效' : '5分钟内有效',
            isPermanent: permanent,
            token
        }
    }
    checkFrontendBuild() {
        const webDir = path.join(__dirname, '../../resources/web')
        const indexFile = path.join(webDir, 'index.html')
        
        if (!fs.existsSync(webDir) || !fs.existsSync(indexFile)) {
            chatLogger.warn('═══════════════════════════════════════════════════════════════')
            chatLogger.warn('[WebServer] ⚠️  前端文件未构建！')
            chatLogger.warn('[WebServer] 请执行以下命令构建前端:')
            chatLogger.warn('[WebServer]   cd plugins/chatai-plugin/next-frontend && pnpm install && pnpm run export')
            chatLogger.warn('═══════════════════════════════════════════════════════════════')
            return false
        }
        return true
    }
    async start() {
        this.startTime = Date.now()
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
                        chatLogger.warn(`[WebServer] 端口 ${port} 已被占用，尝试端口 ${port + 1}...`)
                        resolve(tryListen(port + 1))
                    } else {
                        chatLogger.error('[WebServer] 启动失败:', error)
                        reject(error)
                    }
                })
            })
        }

        await tryListen(this.port)
        this.addresses = await getServerAddresses(this.port)
        this.printStartupBanner()
    }
    printStartupBanner() {
        const startTime = Date.now() - (this.startTime || Date.now())
        const version = '1.0.0'
        const c = colors
        
        // 构建地址列表
        const items = []
        
        if (this.addresses.local?.length > 0) {
            items.push({ label: '本地地址', value: '', color: c.yellow })
            for (const addr of this.addresses.local) {
                items.push({ label: '  ➜', value: addr, color: c.cyan })
            }
        }
        
        if (this.addresses.localIPv6?.length > 0) {
            items.push({ label: 'IPv6地址', value: '', color: c.magenta })
            for (const addr of this.addresses.localIPv6) {
                items.push({ label: '  ➜', value: addr, color: c.magenta })
            }
        }
        
        if (this.addresses.public) {
            items.push({ label: '公网地址', value: '', color: c.green })
            items.push({ label: '  ➜', value: this.addresses.public, color: c.green })
        }
        
        chatLogger.successBanner(`ChatAI Panel v${version} 启动成功 ${startTime}ms`, items)
    }
    stop() {
        if (this.server) {
            this.server.close()
            chatLogger.info('[WebServer] 管理面板已停止')
        }
    }
}
let webServerInstance = null

export function getWebServer() {
    if (!webServerInstance) {
        webServerInstance = new WebServer()
    }
    return webServerInstance
}