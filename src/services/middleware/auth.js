/**
 * 认证与鉴权中间件
 */

import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import config from '../../../config/config.js'

// JWT签名密钥（运行时生成，重启后失效）
let jwtSecret = crypto.randomUUID()

// 用户权限级别
export const PermissionLevel = {
    READONLY: 0,   // 只读
    USER: 1,       // 普通用户
    ADMIN: 2,      // 管理员
    SUPER: 3       // 超级管理员
}

/**
 * 临时Token管理器
 */
class TokenManager {
    constructor() {
        this.tokens = new Map() // token -> { expiry, level }
    }

    /**
     * 生成临时Token
     * @param {number} timeout - 超时时间（秒）
     * @param {number} level - 权限级别
     * @returns {string}
     */
    generateTemp(timeout = 5 * 60, level = PermissionLevel.ADMIN) {
        const timestamp = Math.floor(Date.now() / 1000)
        const randomString = crypto.randomBytes(16).toString('hex')
        const token = `${timestamp}-${randomString}`
        const expiry = Date.now() + timeout * 1000

        this.tokens.set(token, { expiry, level })

        // 自动清理过期token
        setTimeout(() => {
            this.tokens.delete(token)
        }, timeout * 1000)

        return token
    }

    /**
     * 生成/获取永久Token
     * @param {boolean} forceNew - 是否强制生成新token
     * @returns {string}
     */
    generatePermanent(forceNew = false) {
        let permanentToken = config.get('web.permanentAuthToken')
        if (!permanentToken || forceNew) {
            permanentToken = crypto.randomUUID()
            config.set('web.permanentAuthToken', permanentToken)
            logger?.info?.('[Auth] 已生成新的永久登录Token')
        }
        return permanentToken
    }

    /**
     * 验证Token
     * @param {string} token 
     * @param {boolean} consume - 是否消耗临时token
     * @returns {{ valid: boolean, level: number }}
     */
    validate(token, consume = true) {
        if (!token) return { valid: false, level: 0 }

        // 优先检查永久Token
        const permanentToken = config.get('web.permanentAuthToken')
        if (permanentToken && token === permanentToken) {
            return { valid: true, level: PermissionLevel.SUPER }
        }

        // 检查临时Token
        const tokenData = this.tokens.get(token)
        if (tokenData && Date.now() < tokenData.expiry) {
            if (consume) {
                this.tokens.delete(token)
            }
            return { valid: true, level: tokenData.level }
        }

        return { valid: false, level: 0 }
    }

    /**
     * 撤销永久Token
     */
    revokePermanent() {
        config.set('web.permanentAuthToken', null)
        logger?.info?.('[Auth] 永久Token已撤销')
    }

    /**
     * 检查是否有永久Token
     */
    hasPermanent() {
        return !!config.get('web.permanentAuthToken')
    }

    /**
     * 获取永久Token（仅用于显示）
     */
    getPermanent() {
        return config.get('web.permanentAuthToken')
    }
}

// 单例
export const tokenManager = new TokenManager()

/**
 * JWT工具类
 */
export const JwtUtils = {
    /**
     * 生成JWT
     * @param {object} payload 
     * @param {string} expiresIn 
     * @returns {string}
     */
    sign(payload, expiresIn = '30d') {
        return jwt.sign({
            ...payload,
            iat: Math.floor(Date.now() / 1000)
        }, jwtSecret, { expiresIn })
    },

    /**
     * 验证JWT
     * @param {string} token 
     * @returns {{ valid: boolean, payload?: object, error?: string }}
     */
    verify(token) {
        try {
            const payload = jwt.verify(token, jwtSecret)
            return { valid: true, payload }
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return { valid: false, error: 'token_expired' }
            }
            return { valid: false, error: 'invalid_token' }
        }
    },

    /**
     * 解码JWT（不验证）
     * @param {string} token 
     * @returns {object|null}
     */
    decode(token) {
        try {
            return jwt.decode(token)
        } catch {
            return null
        }
    },

    /**
     * 重置JWT密钥（使所有已发放的JWT失效）
     */
    resetSecret() {
        jwtSecret = crypto.randomUUID()
        logger?.info?.('[Auth] JWT密钥已重置')
    }
}

/**
 * 认证中间件 - 验证请求是否已认证
 * @param {object} options - 配置选项
 * @param {number} options.requiredLevel - 所需权限级别
 * @param {boolean} options.optional - 是否允许未认证访问
 */
export function authMiddleware(options = {}) {
    const { requiredLevel = PermissionLevel.USER, optional = false } = options

    return (req, res, next) => {
        // 尝试从多个来源获取认证信息
        const authHeader = req.headers.authorization
        const cookieToken = req.cookies?.auth_token
        const queryToken = req.query?.token

        let authenticated = false
        let userLevel = PermissionLevel.READONLY
        let userId = null

        // 1. 优先检查Bearer JWT
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.substring(7)
            const result = JwtUtils.verify(token)
            if (result.valid) {
                authenticated = true
                userLevel = result.payload.level || PermissionLevel.ADMIN
                userId = result.payload.userId
            }
        }

        // 2. 检查Cookie中的JWT
        if (!authenticated && cookieToken) {
            const result = JwtUtils.verify(cookieToken)
            if (result.valid) {
                authenticated = true
                userLevel = result.payload.level || PermissionLevel.ADMIN
                userId = result.payload.userId
            }
        }

        // 3. 检查API Key（用于编程访问）
        const apiKey = req.headers['x-api-key']
        if (!authenticated && apiKey) {
            const configuredApiKey = config.get('web.apiKey')
            if (configuredApiKey && apiKey === configuredApiKey) {
                authenticated = true
                userLevel = PermissionLevel.ADMIN
            }
        }

        // 4. 检查临时Token（用于URL登录）
        if (!authenticated && queryToken) {
            const result = tokenManager.validate(queryToken, false)
            if (result.valid) {
                authenticated = true
                userLevel = result.level
            }
        }

        // 设置请求上下文
        req.auth = {
            authenticated,
            level: userLevel,
            userId
        }

        // 检查认证状态
        if (!authenticated && !optional) {
            return res.unauthorized?.('需要登录认证') 
                || res.status(401).json({ code: 1002, message: '需要登录认证', data: null })
        }

        // 检查权限级别
        if (authenticated && userLevel < requiredLevel) {
            return res.forbidden?.('权限不足') 
                || res.status(403).json({ code: 1005, message: '权限不足', data: null })
        }

        next()
    }
}

/**
 * 简化的认证中间件（向后兼容）
 */
export function requireAuth(req, res, next) {
    return authMiddleware()(req, res, next)
}

/**
 * 要求管理员权限
 */
export function requireAdmin(req, res, next) {
    return authMiddleware({ requiredLevel: PermissionLevel.ADMIN })(req, res, next)
}

/**
 * 可选认证（允许未认证访问，但会注入认证信息）
 */
export function optionalAuth(req, res, next) {
    return authMiddleware({ optional: true })(req, res, next)
}

/**
 * 登录处理
 * @param {string} token - 临时Token或永久Token
 * @returns {{ success: boolean, jwt?: string, expiresIn?: number, error?: string }}
 */
export function processLogin(token) {
    if (!token) {
        return { success: false, error: '缺少认证Token' }
    }

    const result = tokenManager.validate(token, true)
    if (!result.valid) {
        return { success: false, error: 'Token无效或已过期' }
    }

    // 生成JWT
    const jwtToken = JwtUtils.sign({
        authenticated: true,
        level: result.level,
        loginTime: Date.now()
    }, '30d')

    return {
        success: true,
        jwt: jwtToken,
        expiresIn: 30 * 24 * 60 * 60 // 30天
    }
}

/**
 * 生成登录链接
 * @param {string} baseUrl - 基础URL
 * @param {number} timeout - Token有效期（秒）
 * @returns {string}
 */
export function generateLoginUrl(baseUrl, timeout = 5 * 60) {
    const token = tokenManager.generateTemp(timeout)
    return `${baseUrl}/login/token?token=${token}`
}

/**
 * IP限流管理器
 */
class RateLimiter {
    constructor() {
        this.requests = new Map() // ip -> { count, resetTime }
    }

    /**
     * 检查是否超过限流
     * @param {string} ip 
     * @param {number} maxRequests - 最大请求数
     * @param {number} windowMs - 时间窗口（毫秒）
     * @returns {{ allowed: boolean, remaining: number, resetTime: number }}
     */
    check(ip, maxRequests = 100, windowMs = 60000) {
        const now = Date.now()
        let record = this.requests.get(ip)

        // 清理过期记录
        if (record && now > record.resetTime) {
            this.requests.delete(ip)
            record = null
        }

        if (!record) {
            record = { count: 0, resetTime: now + windowMs }
            this.requests.set(ip, record)
        }

        record.count++

        const allowed = record.count <= maxRequests
        const remaining = Math.max(0, maxRequests - record.count)

        return { allowed, remaining, resetTime: record.resetTime }
    }

    /**
     * 清理所有记录
     */
    clear() {
        this.requests.clear()
    }
}

export const rateLimiter = new RateLimiter()

/**
 * 请求限流中间件
 * @param {object} options
 * @param {number} options.maxRequests - 最大请求数
 * @param {number} options.windowMs - 时间窗口（毫秒）
 * @param {boolean} options.byUser - 是否按用户限流（否则按IP）
 */
export function rateLimit(options = {}) {
    const { maxRequests = 100, windowMs = 60000, byUser = false } = options

    return (req, res, next) => {
        const key = byUser && req.auth?.userId 
            ? `user:${req.auth.userId}` 
            : `ip:${req.ip}`

        const result = rateLimiter.check(key, maxRequests, windowMs)

        // 设置限流响应头
        res.set('X-RateLimit-Limit', maxRequests)
        res.set('X-RateLimit-Remaining', result.remaining)
        res.set('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000))

        if (!result.allowed) {
            return res.tooManyRequests?.('请求过于频繁，请稍后再试') 
                || res.status(429).json({ 
                    code: 4001, 
                    message: '请求过于频繁，请稍后再试', 
                    data: null 
                })
        }

        next()
    }
}

/**
 * 安全头中间件
 */
export function securityHeaders(req, res, next) {
    // 防止点击劫持
    res.set('X-Frame-Options', 'SAMEORIGIN')
    // 防止MIME类型嗅探
    res.set('X-Content-Type-Options', 'nosniff')
    // XSS防护
    res.set('X-XSS-Protection', '1; mode=block')
    // 引用策略
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    
    next()
}

/**
 * 请求日志中间件
 * @param {object} options
 * @param {boolean} options.logBody - 是否记录请求体
 * @param {boolean} options.logResponse - 是否记录响应
 */
export function requestLogger(options = {}) {
    const { logBody = false, logResponse = false } = options

    return (req, res, next) => {
        const startTime = Date.now()
        const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        
        req.requestId = requestId

        // 记录请求
        const logData = {
            requestId,
            method: req.method,
            path: req.path,
            ip: req.ip,
            userAgent: req.get('user-agent'),
            userId: req.auth?.userId
        }

        if (logBody && req.body && Object.keys(req.body).length > 0) {
            // 脱敏敏感字段
            const sanitizedBody = { ...req.body }
            const sensitiveFields = ['password', 'apiKey', 'token', 'secret']
            sensitiveFields.forEach(field => {
                if (sanitizedBody[field]) {
                    sanitizedBody[field] = '[REDACTED]'
                }
            })
            logData.body = sanitizedBody
        }

        logger?.debug?.('[API Request]', logData)

        // 记录响应
        if (logResponse) {
            const originalJson = res.json.bind(res)
            res.json = (body) => {
                const duration = Date.now() - startTime
                logger?.debug?.('[API Response]', {
                    requestId,
                    status: res.statusCode,
                    duration: `${duration}ms`
                })
                return originalJson(body)
            }
        }

        next()
    }
}

/**
 * CORS中间件
 * @param {object} options
 * @param {string|string[]} options.origin - 允许的源
 * @param {string[]} options.methods - 允许的方法
 * @param {boolean} options.credentials - 是否允许凭证
 */
export function cors(options = {}) {
    const { 
        origin = '*', 
        methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        credentials = true 
    } = options

    return (req, res, next) => {
        const requestOrigin = req.get('origin')
        
        // 处理origin
        if (origin === '*') {
            res.set('Access-Control-Allow-Origin', '*')
        } else if (Array.isArray(origin)) {
            if (origin.includes(requestOrigin)) {
                res.set('Access-Control-Allow-Origin', requestOrigin)
            }
        } else if (origin === requestOrigin) {
            res.set('Access-Control-Allow-Origin', origin)
        }

        res.set('Access-Control-Allow-Methods', methods.join(', '))
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Request-ID')
        
        if (credentials) {
            res.set('Access-Control-Allow-Credentials', 'true')
        }

        // 处理预检请求
        if (req.method === 'OPTIONS') {
            res.set('Access-Control-Max-Age', '86400')
            return res.status(204).end()
        }

        next()
    }
}

export default {
    tokenManager,
    JwtUtils,
    authMiddleware,
    requireAuth,
    requireAdmin,
    optionalAuth,
    processLogin,
    generateLoginUrl,
    PermissionLevel,
    rateLimiter,
    rateLimit,
    securityHeaders,
    requestLogger,
    cors
}
