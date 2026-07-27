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

/**
 * 检测是否为TRSS环境
 */
function isTRSSEnvironment() {
    return !!(global.Bot?.express && global.Bot?.server)
}

const isIPv4Address = ip => net.isIP(ip) === 4
const isIPv6Address = ip => net.isIP(ip) === 6

async function fetchPublicIp(endpoint, validator, timeoutMs = 1500) {
    try {
        const https = await import('node:https')
        return await new Promise(resolve => {
            const timeout = setTimeout(() => resolve(null), timeoutMs)
            const request = https.get(endpoint, { timeout: timeoutMs - 200 }, res => {
                let data = ''
                res.on('data', chunk => (data += chunk))
                res.on('end', () => {
                    clearTimeout(timeout)
                    const ip = data.trim()
                    resolve(validator(ip) ? ip : null)
                })
            })
            request.on('error', () => {
                clearTimeout(timeout)
                resolve(null)
            })
            request.on('timeout', () => {
                clearTimeout(timeout)
                request.destroy()
                resolve(null)
            })
        })
    } catch {
        return null
    }
}
async function getLocalAddresses(port) {
    const addresses = { local: [], localIPv6: [], public: null, publicIPv6: null }

    try {
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

    return addresses
}

async function getPublicAddresses(port) {
    const result = { public: null, publicIPv6: null }
    try {
        const [publicIPv4, publicIPv6] = await Promise.all([
            fetchPublicIp('https://api.ipify.org', isIPv4Address),
            fetchPublicIp('https://api64.ipify.org', isIPv6Address)
        ])
        if (publicIPv4) result.public = `http://${publicIPv4}:${port}`
        if (publicIPv6) result.publicIPv6 = `http://[${publicIPv6}]:${port}`
    } catch {}
    return result
}

// 快速获取所有地址（本地+公网并行，总超时2秒）
async function getServerAddressesFast(port) {
    const addresses = { local: [], localIPv6: [], public: null, publicIPv6: null }

    // 本地地址（同步获取，很快）
    try {
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

    // 公网地址（并行获取，总超时2秒）
    try {
        const publicPromise = Promise.all([
            fetchPublicIp('https://api.ipify.org', isIPv4Address, 1500),
            fetchPublicIp('https://api64.ipify.org', isIPv6Address, 1500)
        ])
        const timeoutPromise = new Promise(r => setTimeout(() => r([null, null]), 2000))
        const [publicIPv4, publicIPv6] = await Promise.race([publicPromise, timeoutPromise])
        if (publicIPv4) addresses.public = `http://${publicIPv4}:${port}`
        if (publicIPv6) addresses.publicIPv6 = `http://[${publicIPv6}]:${port}`
    } catch {}

    return addresses
}
import {
    systemRoutes,
    statsRoutes,
    configRoutes,
    scopeRoutes,
    toolsRoutes,
    proxyRoutes,
    mcpRoutes,
    knowledgeRoutes,
    imageRoutes,
    publicImageRouter,
    logsRoutes,
    placeholdersRouter,
    memoryRoutes,
    graphRoutes,
    channelRoutes,
    testPanelRoutes,
    groupAdminRoutes,
    skillsRoutes,
    createConversationRoutes,
    createContextRoutes,
    createPresetRoutes,
    createPresetsConfigRoutes,
    createGameRoutes,
    createGameEditRoutes,
    mcpServerRoutes,
    ChaiteResponse
} from './routes/index.js'
import { errorHandler } from './middleware/ApiResponse.js'
import { nlSchedulerService } from './scheduler/NLSchedulerService.js'
import { groupSummaryPushService } from './group/GroupSummaryPushService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
let authKey = config.get('web.jwtSecret')
if (!authKey) {
    authKey = crypto.randomUUID()
    config.set('web.jwtSecret', authKey)
}

/**
 * 解析来源字符串的 host 部分（hostname:port）
 * @param {string} value - 完整 URL 或 Origin 头的值
 * @returns {string|null} 小写 host，解析失败返回 null
 */
function parseOriginHost(value) {
    if (!value || typeof value !== 'string') return null
    try {
        return new URL(value).host.toLowerCase()
    } catch {
        return null
    }
}

/**
 * 解析来源字符串的 hostname（不含端口，IPv6 已去掉方括号）
 * @param {string} value - 完整 URL 或 Origin 头的值
 * @returns {string|null} 小写 hostname，解析失败返回 null
 */
function parseOriginHostname(value) {
    if (!value || typeof value !== 'string') return null
    try {
        return new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, '')
    } catch {
        return null
    }
}

/**
 * 判断 hostname 是否指向本机回环地址
 * @param {string} hostname - 已去掉端口与方括号的主机名
 * @returns {boolean}
 */
function isLoopbackHostname(hostname) {
    if (!hostname) return false
    return hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname)
}

class FingerprintValidator {
    /**
     * @param {number} [maxSize=5000] - 绑定表容量上限，超出后按写入顺序淘汰最旧条目
     * @param {number} [ttlMs=2592000000] - 单条绑定的存活时间，默认 30 天，与 JWT 有效期保持一致
     */
    constructor(maxSize = 5000, ttlMs = 30 * 24 * 60 * 60 * 1000) {
        this.bindings = new Map()
        this.maxSize = maxSize
        this.ttlMs = ttlMs
    }

    /**
     * 绑定 JWT 与客户端指纹
     * @param {string} token - JWT
     * @param {string} fingerprint - 客户端指纹
     * @returns {void}
     */
    bind(token, fingerprint) {
        if (!fingerprint) return
        this.bindings.set(token, { fingerprint, expiry: Date.now() + this.ttlMs })
        if (this.bindings.size > this.maxSize) this.evict()
    }

    /**
     * 清理过期绑定；若仍超出容量上限，按写入顺序淘汰最旧条目
     * @returns {void}
     */
    evict() {
        const now = Date.now()
        for (const [token, data] of this.bindings) {
            if (now > data.expiry) this.bindings.delete(token)
        }
        // Map 保持插入顺序，迭代器返回的首个键即最早写入的条目
        while (this.bindings.size > this.maxSize) {
            const oldest = this.bindings.keys().next().value
            if (oldest === undefined) break
            this.bindings.delete(oldest)
        }
    }

    /**
     * 校验 JWT 与客户端指纹是否匹配
     * @param {string} token - JWT
     * @param {string} fingerprint - 客户端指纹
     * @returns {boolean} 无绑定记录时放行（绑定表为纯内存，服务重启后为空）
     */
    validate(token, fingerprint) {
        const bound = this.bindings.get(token)
        if (!bound) return true
        if (Date.now() > bound.expiry) {
            this.bindings.delete(token)
            return true
        }
        if (!fingerprint) return false
        return bound.fingerprint === fingerprint
    }

    /**
     * 移除指定 JWT 的指纹绑定（登出时调用）
     * @param {string} token - JWT
     * @returns {void}
     */
    remove(token) {
        this.bindings.delete(token)
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

/**
 * 创建基于来源 IP 的简易限流中间件
 *
 * 记录表采用惰性清理：仅在条目数超过 maxEntries 时扫描剔除已过期条目，
 * 避免常驻定时器。项目未启用 Express 的 trust proxy，
 * 故 req.ip 取自 socket 真实地址，不受 X-Forwarded-For 伪造影响。
 *
 * @param {Object} [options] - 限流配置
 * @param {number} [options.max=5] - 单个窗口内允许的最大请求数
 * @param {number} [options.windowMs=60000] - 窗口时长（毫秒）
 * @param {number} [options.maxEntries=1000] - 记录表容量上限
 * @param {string} [options.message='请求过于频繁，请稍后再试'] - 触发限流时的提示
 * @returns {Function} Express 中间件
 */
function createRateLimit({
    max = 5,
    windowMs = 60 * 1000,
    maxEntries = 1000,
    message = '请求过于频繁，请稍后再试'
} = {}) {
    const hits = new Map()
    return (req, res, next) => {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown'
        const now = Date.now()
        const entry = hits.get(ip)

        if (entry && now < entry.resetAt) {
            if (entry.count >= max) {
                res.set('Retry-After', Math.ceil((entry.resetAt - now) / 1000))
                return res.status(429).json(ChaiteResponse.fail(null, message))
            }
            entry.count++
        } else {
            hits.set(ip, { count: 1, resetAt: now + windowMs })
        }

        if (hits.size > maxEntries) {
            for (const [key, value] of hits) {
                if (now > value.resetAt) hits.delete(key)
            }
        }
        next()
    }
}

class AuthHandler {
    constructor() {
        this.tokens = new Map()
    }

    /**
     * 生成登录 Token
     * @param {number} [timeout=300] - 临时 Token 有效期（秒），permanent 为 true 时忽略
     * @param {boolean} [permanent=false] - 是否生成永久 Token
     * @param {boolean} [forceNew=false] - 永久 Token 已存在时是否强制重新生成
     * @returns {string} Token
     */
    generateToken(timeout = 5 * 60, permanent = false, forceNew = false) {
        if (permanent) {
            let permanentToken = config.get('web.permanentAuthToken')
            if (!permanentToken || forceNew) {
                permanentToken = crypto.randomBytes(32).toString('base64url')
                config.set('web.permanentAuthToken', permanentToken)
                chatLogger.info('[Auth] 已生成新的永久登录Token')
            }
            return permanentToken
        }

        const token = crypto.randomBytes(32).toString('base64url')
        const expiry = Date.now() + timeout * 1000
        this.tokens.set(token, expiry)
        // unref 使该定时器不阻止进程退出
        setTimeout(() => this.tokens.delete(token), timeout * 1000).unref?.()
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
        this.router = express.Router()
        this.port = config.get('web.port') || 3000
        this.server = null
        this.mountPath = config.get('web.mountPath') || '/chatai'
        this.internalToken = crypto.randomBytes(32).toString('base64url')
        this.setupMiddleware()
        this.setupRoutes()
    }

    /**
     * 判断跨域来源是否可信
     *
     * 放行范围（默认部署无需任何额外配置）：
     * 1. 与请求 Host 相同的来源（浏览器对同源 POST/fetch 同样会带 Origin 头）
     * 2. 本机回环地址 localhost / 127.x / ::1（任意端口，覆盖前端开发服务器）
     * 3. web.publicUrl 与 web.loginLinks[].baseUrl 配置的对外地址
     * 4. web.corsOrigins 中显式声明的来源
     * 5. 启动时探测到的本机网卡地址（this.addresses）
     *
     * @param {import('express').Request} req - 当前请求
     * @param {string} origin - 请求头中的 Origin
     * @returns {boolean} 可信返回 true
     */
    isTrustedOrigin(req, origin) {
        const originHost = parseOriginHost(origin)
        const originHostname = parseOriginHostname(origin)
        if (!originHost || !originHostname) return false

        const requestHost = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : ''
        if (requestHost && originHost === requestHost) return true

        if (isLoopbackHostname(originHostname)) return true

        const allowedHosts = new Set()
        const allowedHostnames = new Set()
        /**
         * 登记一个允许来源
         * @param {string} value - 完整 URL 或裸 host
         * @returns {void}
         */
        const addAllowed = value => {
            const host = parseOriginHost(value)
            if (host) {
                allowedHosts.add(host)
                const hostname = parseOriginHostname(value)
                if (hostname) allowedHostnames.add(hostname)
                return
            }
            // 允许直接填写 example.com 或 example.com:8080 这类裸 host
            if (typeof value === 'string' && value.trim()) {
                const bare = value.trim().toLowerCase()
                allowedHosts.add(bare)
                allowedHostnames.add(bare.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''))
            }
        }

        addAllowed(config.get('web.publicUrl'))
        const loginLinks = config.get('web.loginLinks')
        if (Array.isArray(loginLinks)) {
            for (const link of loginLinks) addAllowed(link?.baseUrl)
        }
        const extraOrigins = config.get('web.corsOrigins')
        if (Array.isArray(extraOrigins)) {
            for (const item of extraOrigins) addAllowed(item)
        }
        if (allowedHosts.has(originHost)) return true

        // 本机网卡地址：端口可能因反向代理而不同，故 host 与 hostname 都比对
        const detected = [
            ...(this.addresses?.local || []),
            ...(this.addresses?.localIPv6 || []),
            this.addresses?.public,
            this.addresses?.publicIPv6
        ]
        for (const addr of detected) {
            const host = parseOriginHost(addr)
            if (host && host === originHost) return true
            const hostname = parseOriginHostname(addr)
            if (hostname && hostname === originHostname) return true
        }

        return allowedHostnames.has(originHostname)
    }

    setupMiddleware() {
        const jsonParser = express.json({ limit: '50mb' })
        const urlencodedParser = express.urlencoded({ extended: true })
        this.app.use((req, res, next) => {
            if (req._body) return next()
            jsonParser(req, res, next)
        })
        this.app.use((req, res, next) => {
            if (req._body) return next()
            urlencodedParser(req, res, next)
        })
        this.app.use(cookieParser())

        // CORS：仅对可信来源下发跨域头。
        // 原实现直接反射 req.headers.origin 且带 Allow-Credentials: true，
        // 等价于允许任意站点携带用户 Cookie 调用本插件全部接口；
        // 且 TRSS 模式下 botExpress.use(this.app) 会把该策略扩散到整个 Yunzai 服务。
        this.app.use((req, res, next) => {
            const origin = req.headers.origin
            // 无 Origin 头 = 同源导航或非浏览器客户端，本就不需要 CORS 头
            if (!origin) {
                if (req.method === 'OPTIONS') return res.sendStatus(204)
                return next()
            }

            if (!this.isTrustedOrigin(req, origin)) {
                // 不下发任何 CORS 头，由浏览器同源策略拦截；预检直接拒绝
                if (req.method === 'OPTIONS') return res.sendStatus(403)
                return next()
            }

            res.header('Access-Control-Allow-Origin', origin)
            res.header('Vary', 'Origin')
            res.header('Access-Control-Allow-Credentials', 'true')
            res.header('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS')
            res.header(
                'Access-Control-Allow-Headers',
                'Content-Type, Authorization, X-Requested-With, X-Client-Fingerprint, X-Timestamp, X-Nonce, X-Body-Hash, X-Signature, X-ChatAI-Internal-Token'
            )
            if (req.method === 'OPTIONS') return res.sendStatus(204)
            next()
        })
        const webDir = path.join(__dirname, '../../resources/web')
        if (fs.existsSync(webDir)) {
            this.router.use(express.static(webDir))
        }
    }

    authMiddleware(req, res, next) {
        const authHeader = req.headers.authorization
        const cookieToken = req.cookies?.auth_token
        const queryToken = req.query?.token
        const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : cookieToken || queryToken

        if (!token) {
            const internalToken = req.headers['x-chatai-internal-token']
            if (
                req.method === 'DELETE' &&
                (req.path === '/api/system/release_port' || req.path === '/system/release_port') &&
                internalToken &&
                internalToken === this.internalToken
            ) {
                return next()
            }
            return res.status(401).json(ChaiteResponse.fail(null, 'No token provided'))
        }

        try {
            const decoded = jwt.verify(token, authKey, {
                algorithms: ['HS256'],
                issuer: 'chatai-panel',
                audience: 'chatai-client'
            })
            req.user = decoded
            const fingerprint = req.headers['x-client-fingerprint']
            if (!fingerprintValidator.validate(token, fingerprint)) {
                chatLogger.warn(`[Auth] 客户端指纹不匹配或缺失 - ${req.method} ${req.originalUrl}`)
                return res.status(401).json(ChaiteResponse.fail(null, 'Invalid client fingerprint'))
            }
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
        const mountPath = this.mountPath

        this.router.get('/login/token', async (req, res) => {
            const { token } = req.query
            if (!token) return res.redirect(`${mountPath}/login/`)
            const success = authHandler.validateToken(token, false)
            if (success) {
                const jwtToken = jwt.sign(
                    {
                        authenticated: true,
                        loginTime: Date.now(),
                        jti: crypto.randomUUID(),
                        iss: 'chatai-panel',
                        aud: 'chatai-client'
                    },
                    authKey,
                    { expiresIn: '30d', algorithm: 'HS256' }
                )

                res.cookie('auth_token', jwtToken, {
                    httpOnly: true,
                    secure:
                        req.secure ||
                        req.headers['x-forwarded-proto'] === 'https' ||
                        process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    path: mountPath
                })

                /* 不在 HTML/URL 中嵌入 JWT，避免 Referer/日志/XSS 扩大泄露面；前端凭 Cookie + withCredentials 访问 API */
                return res.redirect(302, `${mountPath}/`)
            }
            res.redirect(`${mountPath}/login/?error=invalid_token`)
        })

        this.router.post('/api/auth/login', async (req, res) => {
            try {
                const { token, password, fingerprint } = req.body
                const clientFingerprint = fingerprint || req.headers['x-client-fingerprint']
                const authToken = token || password

                // 验证Token（临时或永久）
                if (!authToken || !authHandler.validateToken(authToken)) {
                    return res.status(401).json(ChaiteResponse.fail(null, 'Token 无效或已过期'))
                }

                const jwtToken = jwt.sign(
                    {
                        authenticated: true,
                        loginTime: Date.now(),
                        jti: crypto.randomUUID(),
                        iss: 'chatai-panel',
                        aud: 'chatai-client'
                    },
                    authKey,
                    { expiresIn: '30d', algorithm: 'HS256' }
                )

                if (clientFingerprint) fingerprintValidator.bind(jwtToken, clientFingerprint)

                res.cookie('auth_token', jwtToken, {
                    httpOnly: true,
                    secure:
                        req.secure ||
                        req.headers['x-forwarded-proto'] === 'https' ||
                        process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    path: mountPath
                })

                chatLogger.debug('[Auth] 登录成功')
                res.json(ChaiteResponse.ok({ token: jwtToken, expiresIn: 30 * 24 * 60 * 60 }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        const handleVerifyTempToken = async (req, res) => {
            const token = req.method === 'POST' ? req.body?.token : req.query?.token
            const clientFingerprint = req.headers['x-client-fingerprint']

            try {
                if (!token) return res.status(400).json(ChaiteResponse.fail(null, 'Token is required'))

                const success = authHandler.validateToken(token)
                if (success) {
                    const jwtToken = jwt.sign(
                        {
                            authenticated: true,
                            loginTime: Date.now(),
                            jti: crypto.randomUUID(),
                            iss: 'chatai-panel',
                            aud: 'chatai-client'
                        },
                        authKey,
                        { expiresIn: '30d', algorithm: 'HS256' }
                    )

                    if (clientFingerprint) fingerprintValidator.bind(jwtToken, clientFingerprint)
                    res.json(ChaiteResponse.ok({ token: jwtToken, expiresIn: 30 * 24 * 60 * 60 }))
                } else {
                    res.status(401).json(ChaiteResponse.fail(null, 'Invalid or expired token'))
                }
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        }

        this.router.get('/api/auth/verify-token', handleVerifyTempToken)
        this.router.post('/api/auth/verify-token', handleVerifyTempToken)

        this.router.get('/api/auth/status', auth, (req, res) => {
            res.json(ChaiteResponse.ok({ authenticated: true }))
        })

        this.router.get('/api/state', auth, (req, res) => {
            res.json(ChaiteResponse.ok({ authenticated: true }))
        })

        // 生成临时登录Token - 公开接口，Token输出到控制台
        this.router.get(
            '/api/auth/token/generate',
            createRateLimit({ max: 3, windowMs: 60 * 1000, message: 'Token 生成请求过于频繁，请稍后再试' }),
            async (req, res) => {
                try {
                    const token = authHandler.generateToken() // 5分钟有效
                    chatLogger.info('========================================')
                    chatLogger.info('[ChatAI] 管理面板登录 Token (5分钟有效):')
                    chatLogger.info(token)
                    chatLogger.info('========================================')
                    res.json(
                        ChaiteResponse.ok({
                            success: true,
                            message: 'Token 已输出到 Yunzai 控制台',
                            expiresIn: '5分钟'
                        })
                    )
                } catch (error) {
                    res.status(500).json(ChaiteResponse.fail(null, error.message))
                }
            }
        )

        // POST /api/auth/token/permanent - 生成永久Token
        this.router.post('/api/auth/token/permanent', auth, (req, res) => {
            try {
                const forceNew = req.body?.forceNew === true
                const hadToken = !!config.get('web.permanentAuthToken')
                const token = authHandler.generateToken(0, true, forceNew)
                res.json(ChaiteResponse.ok({ token, isNew: forceNew || !hadToken }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // DELETE /api/auth/token/permanent - 撤销永久Token
        this.router.delete('/api/auth/token/permanent', auth, (req, res) => {
            try {
                config.set('web.permanentAuthToken', null)
                chatLogger.info('[Auth] 永久Token已撤销')
                res.json(ChaiteResponse.ok({ success: true, message: 'Token已撤销' }))
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // GET /api/auth/token/status - 获取Token状态
        this.router.get('/api/auth/token/status', auth, (req, res) => {
            try {
                res.json(
                    ChaiteResponse.ok({
                        hasPermanentToken: !!config.get('web.permanentAuthToken')
                    })
                )
            } catch (error) {
                res.status(500).json(ChaiteResponse.fail(null, error.message))
            }
        })

        // 健康检查：必须内联响应。
        // 原写法 router.get('/api/health', systemRoutes) 把子 Router 当普通 handler，
        // .get() 不会剥离路径前缀，systemRoutes 内注册的是 '/health'，永远匹配不上，
        // 最终 next() 落到下方的 router.use('/api', auth, systemRoutes) 被鉴权拦截返回 401。
        // 响应体与 systemRoutes 的 GET /health 保持一致，避免既有监控探针解析失败
        this.router.get('/api/health', (req, res) => {
            const memory = process.memoryUsage()
            res.json({
                status: 'healthy',
                timestamp: Date.now(),
                uptime: process.uptime(),
                memoryUsage: {
                    heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
                    rss: Math.round(memory.rss / 1024 / 1024)
                }
            })
        })
        this.router.use('/api/channels', auth, channelRoutes)
        this.router.use('/api/config', auth, configRoutes)
        this.router.use('/api/test-panel', auth, testPanelRoutes)
        this.router.use('/api/scope', auth, scopeRoutes)
        this.router.use('/api/tools', auth, toolsRoutes)
        this.router.use('/api/proxy', auth, proxyRoutes)
        this.router.use('/api/mcp', auth, mcpRoutes)
        this.router.use('/api/knowledge', auth, knowledgeRoutes)
        this.router.use('/api/imagegen', auth, imageRoutes)
        this.router.use('/api/logs', auth, logsRoutes)
        this.router.use('/api/placeholders', auth, placeholdersRouter)
        this.router.use('/api/memory', auth, memoryRoutes)
        this.router.use('/api/graph', auth, graphRoutes)
        this.router.use('/api/images', publicImageRouter) // 公开图片访问，无需认证
        this.router.use('/api/stats', auth, statsRoutes)
        this.router.use('/mcp', mcpServerRoutes) // MCP Server 暴露端点，使用独立 apiKey 鉴权
        this.router.use('/api/group-admin', groupAdminRoutes)
        this.router.use('/api/skills', auth, skillsRoutes)
        // 游戏编辑路由必须在通用/api路由之前注册，避免被auth中间件拦截
        this.router.use('/api/game-edit', createGameEditRoutes()) // 无需认证，使用UUID访问
        this.router.use('/api/game', createGameRoutes(auth))
        this.router.use('/api/conversations', createConversationRoutes(auth))
        this.router.use('/api/context', createContextRoutes(auth))
        this.router.use('/api/preset', createPresetRoutes(auth))
        this.router.use('/api/presets', createPresetsConfigRoutes(auth))
        this.router.use('/api', auth, systemRoutes)
        // 未命中的 /api 与 /mcp 请求必须返回 JSON 404，
        // 否则会落进下方的 SPA 兜底，返回 200 + index.html，前端 JSON.parse 直接报错
        this.router.use(['/api', '/mcp'], (req, res) => {
            res.status(404).json(ChaiteResponse.fail(null, `接口不存在: ${req.method} ${req.originalUrl}`))
        })
        this.router.get('*', (req, res) => {
            const webDir = path.join(__dirname, '../../resources/web')
            const reqPath = req.path.replace(/\/$/, '') || ''
            const standalonePages = ['game-edit', 'login', 'group-admin']
            for (const page of standalonePages) {
                if (reqPath === `/${page}` || reqPath.startsWith(`/${page}/`)) {
                    const pageIndex = path.join(webDir, page, 'index.html')
                    if (fs.existsSync(pageIndex)) {
                        return res.sendFile(pageIndex)
                    }
                }
            }
            const indexFile = path.join(webDir, 'index.html')
            if (fs.existsSync(indexFile)) {
                res.sendFile(indexFile)
            } else {
                res.status(404).send('Not Found')
            }
        })
        this.app.use(mountPath, this.router)
        // 全局错误兜底。ApiResponse.js 早已实现 errorHandler 但从未挂载，
        // 导致同步抛错走 Express 默认处理器：返回带绝对路径的 HTML 堆栈（项目未设 NODE_ENV）。
        // 限定在 mountPath 下，避免 TRSS 共享端口时干扰 Yunzai 的其它服务。
        this.app.use(mountPath, errorHandler)
    }

    getLoginInfo(permanent = false) {
        const token = authHandler.generateToken(5 * 60, permanent)
        const mountPath = this.mountPath
        const baseLocalAddrs = this.addresses?.local || [`http://127.0.0.1:${this.port}`]
        const localUrls = baseLocalAddrs.map(addr => `${addr}${mountPath}/login/token?token=${token}`)
        const localIPv6Urls = (this.addresses?.localIPv6 || []).map(
            addr => `${addr}${mountPath}/login/token?token=${token}`
        )
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
        const primaryLocalUrl =
            localUrls[0] || localIPv6Urls[0] || `http://127.0.0.1:${this.port}${mountPath}/login/token?token=${token}`

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
            mountPath, // 返回挂载路径供前端使用
            isPublicUrlConfigured: !!configPublicUrl // 标记公网地址是否来自配置
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

        // 并行获取本地和公网地址（总超时2秒）
        this.addresses = await getServerAddressesFast(this.port)
        this.printStartupBanner()

        // 异步启动自然语言定时任务服务
        nlSchedulerService.init().catch(err => {
            chatLogger.warn('[WebServer] 定时任务服务启动失败:', err.message)
        })

        // 异步启动群聊总结定时推送服务
        groupSummaryPushService.init().catch(err => {
            chatLogger.warn('[WebServer] 群聊总结推送服务启动失败:', err.message)
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

        // 使用固定的挂载路径 /chatai
        const mountPath = this.mountPath

        // 将整个应用挂载到TRSS的express
        botExpress.use(this.app)

        // 添加quiet和skip_auth路径（/chatai下的所有路径）
        const quietPaths = [mountPath]
        if (Array.isArray(botExpress.quiet)) {
            botExpress.quiet.push(...quietPaths)
        }
        if (Array.isArray(botExpress.skip_auth)) {
            botExpress.skip_auth.push(...quietPaths)
        }

        chatLogger.info(`[WebServer] TRSS环境已共享端口 ${this.port}，挂载路径: ${mountPath}`)
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
                server.on('error', async error => {
                    if (error.code === 'EADDRINUSE') {
                        if (retries > 0) {
                            chatLogger.warn(`[WebServer] 端口 ${port} 已被占用，尝试释放端口...`)
                            try {
                                const releaseResult = await Promise.race([
                                    fetch(`http://127.0.0.1:${port}/api/system/release_port`, {
                                        method: 'DELETE',
                                        headers: { 'X-ChatAI-Internal-Token': this.internalToken }
                                    }),
                                    new Promise(resolveTimeout => setTimeout(() => resolveTimeout(null), 3000))
                                ])
                                if (!releaseResult) {
                                    chatLogger.warn(`[WebServer] 释放端口 ${port} 超时`)
                                } else if (!releaseResult.ok) {
                                    const errorText = await releaseResult.text().catch(() => '')
                                    chatLogger.warn(
                                        `[WebServer] 释放端口 ${port} 失败: HTTP ${releaseResult.status} ${errorText.slice(0, 200)}`
                                    )
                                }
                                await new Promise(r => setTimeout(r, 1000))
                            } catch (releaseError) {
                                chatLogger.warn(`[WebServer] 释放端口 ${port} 请求失败: ${releaseError.message}`)
                            }
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
        const mountPath = this.mountPath

        if (this.sharedPort) {
            items.push({ label: '模式', value: 'TRSS共享端口', color: colors.magenta })
        }
        items.push({ label: '访问路径', value: mountPath, color: colors.cyan })

        if (this.addresses.local?.length > 0) {
            items.push({ label: '本地地址', value: '', color: colors.yellow })
            for (const addr of this.addresses.local) {
                items.push({ label: '  ➜', value: `${addr}${mountPath}/`, color: colors.cyan })
            }
        }
        if (this.addresses.localIPv6?.length > 0) {
            items.push({ label: '本地地址（IPv6）', value: '', color: colors.yellow })
            for (const addr of this.addresses.localIPv6) {
                items.push({ label: '  ➜', value: `${addr}${mountPath}/`, color: colors.cyan })
            }
        }
        if (this.addresses.public) {
            items.push({ label: '公网地址', value: '', color: colors.green })
            items.push({ label: '  ➜', value: `${this.addresses.public}${mountPath}/`, color: colors.green })
        }
        if (this.addresses.publicIPv6) {
            items.push({ label: '公网地址（IPv6）', value: '', color: colors.green })
            items.push({ label: '  ➜', value: `${this.addresses.publicIPv6}${mountPath}/`, color: colors.green })
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
        await new Promise(resolve => {
            if (this.server) {
                this.server.close(err => {
                    if (err) chatLogger.warn('[WebServer] 关闭服务时出现警告:', err.message)
                    resolve()
                })
            } else {
                resolve()
            }
        })
        await new Promise(r => setTimeout(r, 500))
        this.app = express()
        this.setupMiddleware()
        this.setupRoutes()
        await this.startWithOwnPort()
        this.addresses = await getServerAddressesFast(this.port)

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
export async function reloadWebServer() {
    if (webServerInstance) {
        await webServerInstance.reload()
    }
}

export { authHandler, authKey, ChaiteResponse, isTRSSEnvironment, getLocalIps }
