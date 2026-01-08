import express from 'express'
import cookieParser from 'cookie-parser'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import config from '../../config/config.js'
import { chatLogger, c as colors } from '../core/utils/logger.js'
import { redisClient } from '../core/cache/RedisClient.js'

/**
 * 检测是否为TRSS环境
 */
function isTRSSEnvironment() {
    return !!(global.Bot?.express && global.Bot?.server)
}

const isIPv4Address = (ip) => net.isIP(ip) === 4
const isIPv6Address = (ip) => net.isIP(ip) === 6

async function fetchPublicIp(endpoint, validator) {
    try {
        const https = await import('node:https')
        return await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 5000)
            const request = https.get(endpoint, { timeout: 3000 }, (res) => {
                let data = ''
                res.on('data', (chunk) => data += chunk)
                res.on('end', () => {
                    clearTimeout(timeout)
                    const ip = data.trim()
                    resolve(validator(ip) ? ip : null)
                })
            })
            request.on('error', () => { clearTimeout(timeout); resolve(null) })
            request.on('timeout', () => { clearTimeout(timeout); request.destroy(); resolve(null) })
        })
    } catch {
        return null
    }
}

// 获取本地和公网地址
async function getServerAddresses(port) {
    const addresses = { local: [], localIPv6: [], public: null, publicIPv6: null }
    
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
    
    // 获取公网IP（包含 IPv4 与 IPv6）
    try {
        const publicIPv4 = await fetchPublicIp('https://api.ipify.org', isIPv4Address)
        if (publicIPv4) addresses.public = `http://${publicIPv4}:${port}`
        const publicIPv6 = await fetchPublicIp('https://api64.ipify.org', isIPv6Address)
        if (publicIPv6) addresses.publicIPv6 = `http://[${publicIPv6}]:${port}`
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
    groupAdminRoutes,
    createConversationRoutes,
    createContextRoutes,
    createPresetRoutes,
    createPresetsConfigRoutes,
    ChaiteResponse
} from './routes/index.js'
import { schedulerService } from './scheduler/SchedulerService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SIGNATURE_SECRET = 'chatai-signature-key-2026'
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
            chatLogger.warn(`[Auth] 签名不匹配:`)
            chatLogger.warn(`  收到: ${signature}`)
            chatLogger.warn(`  期望: ${expectedSignature}`)
            chatLogger.warn(`  路径: ${fullPath}, 方法: ${req.method}`)
            chatLogger.warn(`  bodyHash: ${bodyHash}, nonce: ${nonce}`)
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
            chatLogger.warn(`[Auth] 无token: ${req.method} ${req.originalUrl}`)
            return res.status(401).json(ChaiteResponse.fail(null, 'No token provided'))
        }

        try {
            jwt.verify(token, authKey, { algorithms: ['HS256'], issuer: 'chatai-panel', audience: 'chatai-client' })
            next()
        } catch (error) {
            chatLogger.warn(`[Auth] JWT验证失败: ${error.name} - ${error.message} - ${req.method} ${req.originalUrl}`)
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
                const token = authHandler.generateToken() // 5分钟有效
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

        this.app.get('/api/health', systemRoutes)
        this.app.use('/api/channels', auth, channelRoutes)
        this.app.use('/api/config', auth, configRoutes)
        this.app.use('/api/test-panel', auth, testPanelRoutes)
        this.app.use('/api/scope', auth, scopeRoutes)
        this.app.use('/api/tools', auth, toolsRoutes)
        this.app.use('/api/proxy', auth, proxyRoutes)
        this.app.use('/api/mcp', auth, mcpRoutes)
        this.app.use('/api/knowledge', auth, knowledgeRoutes)
        this.app.use('/api/imagegen', auth, imageRoutes)
        this.app.use('/api/logs', auth, logsRoutes)
        this.app.use('/api/placeholders', auth, logsRoutes)
        this.app.use('/api/memory', auth, memoryRoutes)
        this.app.use('/api/group-admin', groupAdminRoutes)  
        this.app.use('/api', auth, systemRoutes)
        this.app.use('/api/conversations', createConversationRoutes(auth))
        this.app.use('/api/context', createContextRoutes(auth))
        this.app.use('/api/preset', createPresetRoutes(auth))
        this.app.use('/api/presets', createPresetsConfigRoutes(auth))
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
        const mountPath = ''
        const baseLocalAddrs = this.addresses?.local || [`http://127.0.0.1:${this.port}`]
        const localUrls = baseLocalAddrs.map(addr => `${addr}${mountPath}/login/token?token=${token}`)
        const localIPv6Urls = (this.addresses?.localIPv6 || []).map(addr => `${addr}${mountPath}/login/token?token=${token}`)
        const loginLinks = config.get('web.loginLinks') || []
        const customUrls = loginLinks.map(link => ({
            label: link.label,
            url: `${link.baseUrl.replace(/\/$/, '')}${mountPath}/login/token?token=${token}`
        }))
        
        const configPublicUrl = config.get('web.publicUrl')
        const publicIPv6Base = this.addresses?.publicIPv6 || null
        let publicUrl = null
        if (configPublicUrl) {
            publicUrl = `${configPublicUrl.replace(/\/$/, '')}${mountPath}/login/token?token=${token}`
        } else if (this.addresses?.public) {
            publicUrl = `${this.addresses.public}${mountPath}/login/token?token=${token}`
        } else if (publicIPv6Base) {
            publicUrl = `${publicIPv6Base}${mountPath}/login/token?token=${token}`
        }

        const publicIPv6Url = publicIPv6Base ? `${publicIPv6Base}${mountPath}/login/token?token=${token}` : null
        const primaryLocalUrl = localUrls[0] || localIPv6Urls[0] || `http://127.0.0.1:${this.port}${mountPath}/login/token?token=${token}`

        return {
            localUrl: primaryLocalUrl,
            localUrls,
            localIPv6Urls,
            publicUrl,
            publicIPv6Url,
            customUrls: customUrls.length > 0 ? customUrls : null,
            validity: permanent ? '永久有效' : '5分钟内有效',
            isPermanent: permanent,
            token,
            mountPath  // 返回挂载路径供前端使用
        }
    }

    async start() {
        this.startTime = Date.now()
        this.isTRSS = isTRSSEnvironment()
        const sharePort = config.get('web.sharePort') !== false
        if (this.isTRSS && sharePort) {
            await this.startWithSharedPort()
        } else {
            await this.startWithOwnPort()
        }
        
        this.addresses = await getServerAddresses(this.port)
        this.printStartupBanner()
        
        // 启动周期任务调度服务
        schedulerService.init().catch(err => {
            chatLogger.warn('[WebServer] 调度服务启动失败:', err.message)
        })
        
        return { port: this.port }
    }
    
    /**
     * TRSS环境下共享端口启动
     */
    async startWithSharedPort() {
        const botExpress = global.Bot.express
        const botServer = global.Bot.server
        
        // 获取TRSS服务器端口
        const address = botServer.address()
        this.port = address?.port || config.get('web.port') || 3000
        this.server = botServer
        this.sharedPort = true
        
        // 挂载路径配置
        const mountPath = config.get('web.mountPath') || '/chatai'
        this.mountPath = mountPath
        
        const rootPaths = [
            '/_next',      
            '/assets',     
            '/api',        
            '/login',      
        ]
        botExpress.use(this.app)
        const quietPaths = [...rootPaths, mountPath]
        if (Array.isArray(botExpress.quiet)) {
            botExpress.quiet.push(...quietPaths)
        }
        if (Array.isArray(botExpress.skip_auth)) {
            botExpress.skip_auth.push(...quietPaths)
        }
        
        chatLogger.info(`[WebServer] TRSS环境已共享端口 ${this.port}`)
    }
    
    /**
     * 独立端口启动
     */
    async startWithOwnPort() {
        const tryListen = (port, retries = 3) => {
            return new Promise((resolve, reject) => {
                const server = this.app.listen(port, () => {
                    this.port = port
                    this.server = server
                    resolve()
                })
                server.on('error', async (error) => {
                    if (error.code === 'EADDRINUSE') {
                        if (retries > 0) {
                            chatLogger.warn(`[WebServer] 端口 ${port} 已被占用，尝试释放端口...`)
                            // 尝试请求旧服务释放端口
                            try {
                                const fetch = (await import('node-fetch')).default
                                await Promise.race([
                                    fetch(`http://localhost:${port}/api/system/release_port`, { method: 'DELETE' }).catch(() => {}),
                                    new Promise(r => setTimeout(r, 3000))
                                ])
                                await new Promise(r => setTimeout(r, 1000))
                            } catch {}
                            resolve(tryListen(port, retries - 1))
                        } else {
                            chatLogger.warn(`[WebServer] 端口 ${port} 已被占用，尝试端口 ${port + 1}...`)
                            resolve(tryListen(port + 1, 3))
                        }
                    } else {
                        reject(error)
                    }
                })
            })
        }

        await tryListen(this.port)
    }

    printStartupBanner() {
        const startTime = Date.now() - (this.startTime || Date.now())
        const items = []
        
        if (this.sharedPort) {
            items.push({ label: '模式', value: 'TRSS共享端口', color: colors.magenta })
        }
        
        if (this.addresses.local?.length > 0) {
            items.push({ label: '本地地址', value: '', color: colors.yellow })
            for (const addr of this.addresses.local) {
                items.push({ label: '  ➜', value: addr, color: colors.cyan })
            }
        }
        if (this.addresses.localIPv6?.length > 0) {
            items.push({ label: '本地地址（IPv6）', value: '', color: colors.yellow })
            for (const addr of this.addresses.localIPv6) {
                items.push({ label: '  ➜', value: addr, color: colors.cyan })
            }
        }
        if (this.addresses.public) {
            items.push({ label: '公网地址', value: '', color: colors.green })
            items.push({ label: '  ➜', value: this.addresses.public, color: colors.green })
        }
        if (this.addresses.publicIPv6) {
            items.push({ label: '公网地址（IPv6）', value: '', color: colors.green })
            items.push({ label: '  ➜', value: this.addresses.publicIPv6, color: colors.green })
        }
        
        chatLogger.successBanner(`ChatAI Panel v1.0.0 启动成功 ${startTime}ms`, items)
    }

    getAddresses() {
        return this.addresses || { local: [], localIPv6: [], public: null, publicIPv6: null }
    }

    stop() {
        if (this.server && !this.sharedPort) {
            this.server.close()
            chatLogger.info('[WebServer] 管理面板已停止')
        }
    }
    
    /**
     * 重载服务（用于热更新）
     */
    async reload() {
        chatLogger.info('[WebServer] 正在重载服务...')
        
        // 如果是共享端口模式，不需要重启服务器
        if (this.sharedPort) {
            chatLogger.info('[WebServer] 共享端口模式，路由已自动更新')
            return true
        }
        
        // 关闭现有服务器
        await new Promise((resolve) => {
            if (this.server) {
                this.server.close((err) => {
                    if (err) chatLogger.warn('[WebServer] 关闭服务时出现警告:', err.message)
                    resolve()
                })
            } else {
                resolve()
            }
        })
        
        // 等待端口释放
        await new Promise(r => setTimeout(r, 500))
        
        // 重新初始化
        this.app = express()
        this.setupMiddleware()
        this.setupRoutes()
        
        // 重新启动
        await this.startWithOwnPort()
        this.addresses = await getServerAddresses(this.port)
        
        chatLogger.info('[WebServer] 服务重载完成')
        return true
    }
}

let webServerInstance = null

/**
 * 获取本地IP地址列表
 */
function getLocalIps(port) {
    const ips = []
    const portStr = port ? `:${port}` : ''
    try {
        const networks = os.networkInterfaces()
        for (const [name, wlans] of Object.entries(networks)) {
            for (const wlan of wlans) {
                if (name === 'lo' || name === 'docker0') continue
                if (wlan.address.startsWith('fe') || wlan.address.startsWith('fc')) continue
                if (['127.0.0.1', '::1'].includes(wlan.address)) continue
                if (wlan.family === 'IPv6') {
                    ips.push(`[${wlan.address}]${portStr}`)
                } else {
                    ips.push(`${wlan.address}${portStr}`)
                }
            }
        }
    } catch (e) {
        chatLogger.warn('[WebServer] 无法获取IP地址:', e.message)
    }
    if (ips.length === 0) {
        ips.push(`localhost${portStr}`)
    }
    return ips
}

export function getWebServer() {
    if (!webServerInstance) {
        webServerInstance = new WebServer()
    }
    return webServerInstance
}

/**
 * 重载WebServer（用于热更新）
 */
export async function reloadWebServer() {
    if (webServerInstance) {
        await webServerInstance.reload()
    }
}

export { authHandler, authKey, ChaiteResponse, isTRSSEnvironment, getLocalIps }
