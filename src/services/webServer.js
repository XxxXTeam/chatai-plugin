import express from 'express'
import cookieParser from 'cookie-parser'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import config from '../../config/config.js'
import { chatLogger, c as colors } from '../core/utils/logger.js'
import { redisClient } from '../core/cache/RedisClient.js'

// 获取本地和公网地址
async function getServerAddresses(port) {
    const addresses = { local: [], localIPv6: [], public: null }
    
    try {
        const os = await import('node:os')
        const interfaces = os.networkInterfaces()
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.internal) continue
                if (iface.family === 'IPv4') {
                    addresses.local.push(`http://${iface.address}:${port}`)
                } else if (iface.family === 'IPv6' && !iface.address.startsWith('fe80:')) {
                    addresses.localIPv6.push(`http://[${iface.address}]:${port}`)
                }
            }
        }
        addresses.local.unshift(`http://127.0.0.1:${port}`)
    } catch {
        addresses.local = [`http://127.0.0.1:${port}`]
    }
    
    // 获取公网IP
    try {
        const https = await import('node:https')
        const publicIP = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 5000)
            https.get('https://api.ipify.org', { timeout: 3000 }, (res) => {
                let data = ''
                res.on('data', chunk => data += chunk)
                res.on('end', () => {
                    clearTimeout(timeout)
                    const ip = data.trim()
                    resolve(/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null)
                })
            }).on('error', () => { clearTimeout(timeout); resolve(null) })
        })
        if (publicIP) addresses.public = `http://${publicIP}:${port}`
    } catch {}
    
    return addresses
}
import {
    systemRoutes,
    configRoutes,
    scopeRoutes,
    toolsRoutes,
    proxyRoutes,
    mcpRoutes,
    knowledgeRoutes,
    imageRoutes,
    logsRoutes,
    memoryRoutes,
    channelRoutes,
    testPanelRoutes,
    createConversationRoutes,
    createContextRoutes,
    createPresetRoutes,
    createPresetsConfigRoutes,
    ChaiteResponse
} from './routes/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SIGNATURE_SECRET = 'chatai-signature-key-2024'
let authKey = config.get('web.jwtSecret')
if (!authKey) {
    authKey = crypto.randomUUID()
    config.set('web.jwtSecret', authKey)
}

class RequestSignatureValidator {
    static generateSignature(method, path, timestamp, bodyHash = '', nonce = '') {
        const signatureString = `${SIGNATURE_SECRET}|${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}|${nonce}`
        const hash = crypto.createHash('sha256')
        hash.update(signatureString)
        return hash.digest('hex')
    }

    static validate(req) {
        const signature = req.headers['x-signature']
        const timestamp = req.headers['x-timestamp']
        const nonce = req.headers['x-nonce']
        const bodyHash = req.headers['x-body-hash'] || ''

        if (!signature || !timestamp || !nonce) {
            chatLogger.warn(`[Auth] 缺少签名头: sig=${!!signature}, ts=${!!timestamp}, nonce=${!!nonce}`)
            return { valid: false, error: 'Missing signature headers' }
        }

        const now = Date.now()
        const requestTime = parseInt(timestamp, 10)
        if (isNaN(requestTime) || Math.abs(now - requestTime) > 5 * 60 * 1000) {
            chatLogger.warn(`[Auth] 时间戳过期: now=${now}, request=${requestTime}, diff=${Math.abs(now - requestTime)}ms`)
            return { valid: false, error: 'Request timestamp expired' }
        }

        const fullPath = (req.originalUrl || req.path).split('?')[0]
        const expectedSignature = this.generateSignature(req.method, fullPath, timestamp, bodyHash, nonce)
        
        // 签名验证 - 使用简单字符串比较
        if (signature !== expectedSignature) {
            return { valid: false, error: 'Invalid signature' }
        }
        
        return { valid: true }
    }
}

class FingerprintValidator {
    constructor() { this.bindings = new Map() }
    bind(token, fingerprint) { this.bindings.set(token, fingerprint) }
    validate(token, fingerprint) {
        const bound = this.bindings.get(token)
        return !bound || bound === fingerprint
    }
}

class RequestIdValidator {
    constructor(maxSize = 10000) {
        this.usedIds = new Set()
        this.maxSize = maxSize
    }
    validate(id) {
        if (this.usedIds.has(id)) return false
        this.usedIds.add(id)
        if (this.usedIds.size > this.maxSize) {
            const arr = Array.from(this.usedIds)
            this.usedIds = new Set(arr.slice(-this.maxSize / 2))
        }
        return true
    }
}

class AuthHandler {
    constructor() { this.tokens = new Map() }
    
    generateToken(timeout = 5 * 60, permanent = false) {
        if (permanent) {
            let permanentToken = config.get('web.permanentAuthToken')
            if (!permanentToken) {
                permanentToken = crypto.randomBytes(32).toString('hex')
                config.set('web.permanentAuthToken', permanentToken)
                chatLogger.info('[Auth] 已生成新的永久登录Token')
            }
            return permanentToken
        }
        
        const token = crypto.randomBytes(32).toString('hex')
        const expiry = Date.now() + timeout * 1000
        this.tokens.set(token, expiry)
        setTimeout(() => this.tokens.delete(token), timeout * 1000)
        return token
    }
    
    validateToken(token, consume = true) {
        if (!token) return false
        
        // 检查永久Token
        const permanentToken = config.get('web.permanentAuthToken')
        if (permanentToken && token === permanentToken) {
            chatLogger.debug('[Auth] 永久Token验证成功')
            return true
        }
        
        // 检查临时Token
        const expiry = this.tokens.get(token)
        if (expiry && Date.now() < expiry) {
            if (consume) this.tokens.delete(token)
            chatLogger.debug('[Auth] 临时Token验证成功')
            return true
        }
        
        chatLogger.debug('[Auth] Token验证失败')
        return false
    }
}

const fingerprintValidator = new FingerprintValidator()
const requestIdValidator = new RequestIdValidator()
const authHandler = new AuthHandler()
class WebServer {
    constructor() {
        this.app = express()
        this.port = config.get('web.port') || 3000
        this.server = null
        this.setupMiddleware()
        this.setupRoutes()
    }

    setupMiddleware() {
        this.app.use(express.json({ limit: '50mb' }))
        this.app.use(express.urlencoded({ extended: true }))
        this.app.use(cookieParser())
        
        // CORS
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', req.headers.origin || '*')
            res.header('Access-Control-Allow-Credentials', 'true')
            res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS')
            res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Client-Fingerprint, X-Timestamp, X-Nonce, X-Body-Hash, X-Signature')
            if (req.method === 'OPTIONS') return res.sendStatus(204)
            next()
        })

        // Static files
        const webDir = path.join(__dirname, '../../resources/web')
        if (fs.existsSync(webDir)) {
            this.app.use(express.static(webDir))
        }
    }

    authMiddleware(req, res, next) {
        const authHeader = req.headers.authorization
        const cookieToken = req.cookies?.auth_token
        const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : cookieToken

        if (!token) {
            return res.status(401).json(ChaiteResponse.fail(null, 'No token provided'))
        }

        try {
            jwt.verify(token, authKey, { algorithms: ['HS256'], issuer: 'chatai-panel', audience: 'chatai-client' })
            
            const clientFingerprint = req.headers['x-client-fingerprint']
            if (clientFingerprint && !fingerprintValidator.validate(token, clientFingerprint)) {
                return res.status(401).json(ChaiteResponse.fail(null, 'Invalid client fingerprint'))
            }

            const nonce = req.headers['x-nonce']
            const isSensitiveOperation = req.method !== 'GET'
            if (isSensitiveOperation) {
                const signatureResult = RequestSignatureValidator.validate(req)
                if (!signatureResult.valid) {
                    chatLogger.warn(`[Auth] 签名验证失败: ${signatureResult.error} - ${req.method} ${req.originalUrl}`)
                    return res.status(401).json(ChaiteResponse.fail(null, signatureResult.error))
                }
                if (nonce && !requestIdValidator.validate(nonce)) {
                    return res.status(401).json(ChaiteResponse.fail(null, 'Request ID already used'))
                }
            }
            next()
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json(ChaiteResponse.fail(null, 'Token expired'))
            }
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json(ChaiteResponse.fail(null, 'Invalid token'))
            }
            return res.status(401).json(ChaiteResponse.fail(null, 'Authentication failed'))
        }
    }

    setupRoutes() {
        const auth = this.authMiddleware.bind(this)
        this.app.get('/login/token', async (req, res) => {
            const { token } = req.query
            if (!token) return res.redirect('/login/')
            
            // 验证但不立即消耗token，允许重试（token会在5分钟后自动过期）
            const success = authHandler.validateToken(token, false)
            if (success) {
                const jwtToken = jwt.sign({
                    authenticated: true,
                    loginTime: Date.now(),
                    jti: crypto.randomUUID(),
                    iss: 'chatai-panel',
                    aud: 'chatai-client'
                }, authKey, { expiresIn: '30d', algorithm: 'HS256' })
                
                res.cookie('auth_token', jwtToken, {
                    httpOnly: true,
                    secure: req.secure,
                    sameSite: 'lax',
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    path: '/'
                })
                
                // 返回一个中间页面，确保cookie被正确设置后再跳转
                return res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>登录中...</title>
<script>
localStorage.setItem('chatai_token', '${jwtToken}');
window.location.href = '/';
</script></head><body>正在登录...</body></html>`)
            }
            res.redirect('/login/?error=invalid_token')
        })

        this.app.post('/api/auth/login', async (req, res) => {
            try {
                const { token, password, fingerprint } = req.body
                const clientFingerprint = fingerprint || req.headers['x-client-fingerprint']
                const authToken = token || password
                
                // 验证Token（临时或永久）
                if (!authToken || !authHandler.validateToken(authToken)) {
                    return res.status(401).json(ChaiteResponse.fail(null, 'Token 无效或已过期'))
                }
                
                const jwtToken = jwt.sign({
                    authenticated: true,
                    loginTime: Date.now(),
                    jti: crypto.randomUUID(),
                    iss: 'chatai-panel',
                    aud: 'chatai-client'
                }, authKey, { expiresIn: '30d', algorithm: 'HS256' })
                
                if (clientFingerprint) fingerprintValidator.bind(jwtToken, clientFingerprint)
                
                res.cookie('auth_token', jwtToken, {
                    httpOnly: true,
                    secure: req.secure,
                    sameSite: 'lax',
                    maxAge: 30 * 24 * 60 * 60 * 1000
                })
                
                chatLogger.debug('[Auth] 登录成功')
                res.json(ChaiteResponse.ok({ token: jwtToken, expiresIn: 30 * 24 * 60 * 60 }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        this.app.get('/api/auth/verify-token', async (req, res) => {
            const { token } = req.query
            const clientFingerprint = req.headers['x-client-fingerprint']
            
            try {
                if (!token) return res.status(400).json(ChaiteResponse.fail(null, 'Token is required'))
                
                const success = authHandler.validateToken(token)
                if (success) {
                    const jwtToken = jwt.sign({
                        authenticated: true,
                        loginTime: Date.now(),
                        jti: crypto.randomUUID(),
                        iss: 'chatai-panel',
                        aud: 'chatai-client'
                    }, authKey, { expiresIn: '30d', algorithm: 'HS256' })
                    
                    if (clientFingerprint) fingerprintValidator.bind(jwtToken, clientFingerprint)
                    res.json(ChaiteResponse.ok({ token: jwtToken, expiresIn: 30 * 24 * 60 * 60 }))
                } else {
                    res.status(401).json(ChaiteResponse.fail(null, 'Invalid or expired token'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        this.app.get('/api/auth/status', auth, (req, res) => {
            res.json(ChaiteResponse.ok({ authenticated: true }))
        })

        // 生成临时登录Token - 公开接口，Token输出到控制台
        this.app.get('/api/auth/token/generate', async (req, res) => {
            try {
                const token = authHandler.generateToken(false) // 5分钟有效
                chatLogger.info('========================================')
                chatLogger.info('[ChatAI] 管理面板登录 Token (5分钟有效):')
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

        // POST /api/auth/token/permanent - 生成永久Token
        this.app.post('/api/auth/token/permanent', auth, (req, res) => {
            try {
                const forceNew = req.body?.forceNew === true
                const hadToken = !!config.get('web.permanentAuthToken')
                const token = authHandler.generateToken(0, true)
                res.json(ChaiteResponse.ok({ token, isNew: forceNew || !hadToken }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/auth/token/permanent - 撤销永久Token
        this.app.delete('/api/auth/token/permanent', auth, (req, res) => {
            try {
                config.set('web.permanentAuthToken', null)
                chatLogger.info('[Auth] 永久Token已撤销')
                res.json(ChaiteResponse.ok({ success: true, message: 'Token已撤销' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/auth/token/status - 获取Token状态
        this.app.get('/api/auth/token/status', auth, (req, res) => {
            try {
                const permanentToken = config.get('web.permanentAuthToken')
                res.json(ChaiteResponse.ok({ 
                    hasPermanentToken: !!permanentToken,
                    token: permanentToken || null
                }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // ==================== 挂载模块化路由 ====================
        // 健康检查（公开）
        this.app.get('/api/health', systemRoutes)
        
        // 渠道路由（优先匹配具体路径）
        this.app.use('/api/channels', auth, channelRoutes)
        
        // 配置路由
        this.app.use('/api/config', auth, configRoutes)
        
        // 测试面板路由
        this.app.use('/api/test-panel', auth, testPanelRoutes)
        
        // 作用域路由
        this.app.use('/api/scope', auth, scopeRoutes)
        
        // 工具路由
        this.app.use('/api/tools', auth, toolsRoutes)
        
        // 代理路由
        this.app.use('/api/proxy', auth, proxyRoutes)
        
        // MCP路由
        this.app.use('/api/mcp', auth, mcpRoutes)
        
        // 知识库路由
        this.app.use('/api/knowledge', auth, knowledgeRoutes)
        
        // 图像生成路由
        this.app.use('/api/imagegen', auth, imageRoutes)
        
        // 日志路由
        this.app.use('/api/logs', auth, logsRoutes)
        this.app.use('/api/placeholders', auth, logsRoutes)
        
        // 记忆路由
        this.app.use('/api/memory', auth, memoryRoutes)
        
        // 系统路由（stats, metrics, system/info）
        this.app.use('/api', auth, systemRoutes)
        
        // 对话路由
        this.app.use('/api/conversations', createConversationRoutes(auth))
        this.app.use('/api/context', createContextRoutes(auth))
        
        // 预设路由
        this.app.use('/api/preset', createPresetRoutes(auth))
        this.app.use('/api/presets', createPresetsConfigRoutes(auth))

        // SPA fallback
        this.app.get('*', (req, res) => {
            const indexFile = path.join(__dirname, '../../resources/web/index.html')
            if (fs.existsSync(indexFile)) {
                res.sendFile(indexFile)
            } else {
                res.status(404).send('Not Found')
            }
        })
    }

    getLoginInfo(permanent = false) {
        const token = authHandler.generateToken(5 * 60, permanent)
        const localUrls = (this.addresses?.local || [`http://127.0.0.1:${this.port}`]).map(addr => 
            `${addr}/login/token?token=${token}`
        )
        const loginLinks = config.get('web.loginLinks') || []
        const customUrls = loginLinks.map(link => ({
            label: link.label,
            url: `${link.baseUrl.replace(/\/$/, '')}/login/token?token=${token}`
        }))
        
        let publicUrl = null
        const configPublicUrl = config.get('web.publicUrl')
        if (configPublicUrl) {
            publicUrl = `${configPublicUrl.replace(/\/$/, '')}/login/token?token=${token}`
        } else if (this.addresses?.public) {
            publicUrl = `${this.addresses.public}/login/token?token=${token}`
        }
        
        return {
            localUrl: localUrls[0],
            localUrls,
            publicUrl,
            customUrls: customUrls.length > 0 ? customUrls : null,
            validity: permanent ? '永久有效' : '5分钟内有效',
            isPermanent: permanent,
            token
        }
    }

    async start() {
        this.startTime = Date.now()
        
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
        const items = []
        
        if (this.addresses.local?.length > 0) {
            items.push({ label: '本地地址', value: '', color: colors.yellow })
            for (const addr of this.addresses.local) {
                items.push({ label: '  ➜', value: addr, color: colors.cyan })
            }
        }
        if (this.addresses.public) {
            items.push({ label: '公网地址', value: '', color: colors.green })
            items.push({ label: '  ➜', value: this.addresses.public, color: colors.green })
        }
        
        chatLogger.successBanner(`ChatAI Panel v1.0.0 启动成功 ${startTime}ms`, items)
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

export { authHandler, authKey, ChaiteResponse }
