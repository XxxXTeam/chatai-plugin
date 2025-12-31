import express from 'express'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'

const router = express.Router()

// Response helper
class ApiResponse {
    static ok(data) {
        return { code: 0, data, message: 'ok' }
    }
    static fail(data, msg) {
        return { code: -1, data, message: msg }
    }
}

// Auth handler singleton
class FrontendAuthHandler {
    constructor() {
        this.tokens = new Map()
    }

    generateToken(timeout = 5 * 60, permanent = false, forceNew = false) {
        if (permanent) {
            let permanentToken = config.get('web.permanentAuthToken')
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

        setTimeout(() => {
            this.tokens.delete(token)
        }, timeout * 1000)

        return token
    }

    validateToken(token, consumeTemp = true) {
        if (!token) return false

        const permanentToken = config.get('web.permanentAuthToken')
        if (permanentToken && token === permanentToken) {
            return true
        }

        const expiry = this.tokens.get(token)
        if (expiry && Date.now() < expiry) {
            if (consumeTemp) {
                this.tokens.delete(token)
            }
            return true
        }

        return false
    }

    validatePermanentToken(token) {
        if (!token) return false
        const permanentToken = config.get('web.permanentAuthToken')
        return permanentToken && token === permanentToken
    }

    revokePermanentToken() {
        config.set('web.permanentAuthToken', null)
    }

    hasPermanentToken() {
        return !!config.get('web.permanentAuthToken')
    }
}

// Fingerprint validator
class ClientFingerprintValidator {
    constructor() {
        this.tokenFingerprints = new Map()
    }

    bind(jwtToken, fingerprint) {
        if (fingerprint) {
            this.tokenFingerprints.set(jwtToken, fingerprint)
        }
    }

    validate(jwtToken, fingerprint) {
        const storedFingerprint = this.tokenFingerprints.get(jwtToken)
        if (!storedFingerprint) return true
        if (!fingerprint) return true
        return storedFingerprint === fingerprint
    }

    remove(jwtToken) {
        this.tokenFingerprints.delete(jwtToken)
    }
}

export const authHandler = new FrontendAuthHandler()
export const fingerprintValidator = new ClientFingerprintValidator()

// Auth key for JWT
export let authKey = crypto.randomUUID()

// Create auth middleware factory
export function createAuthMiddleware() {
    return async (req, res, next) => {
        const authHeader = req.headers.authorization
        const cookieToken = req.cookies?.auth_token
        
        const token = authHeader?.startsWith('Bearer ') 
            ? authHeader.substring(7) 
            : cookieToken

        if (!token) {
            return res.status(401).json(ApiResponse.fail(null, 'Authentication required'))
        }

        try {
            const decoded = jwt.verify(token, authKey)
            
            const fingerprint = req.headers['x-client-fingerprint']
            if (!fingerprintValidator.validate(token, fingerprint)) {
                chatLogger.warn('[Auth] 客户端指纹不匹配')
                return res.status(401).json(ApiResponse.fail(null, 'Invalid client fingerprint'))
            }

            req.user = decoded
            next()
        } catch (error) {
            chatLogger.debug('[Auth] JWT验证失败:', error.message)
            return res.status(401).json(ApiResponse.fail(null, 'Authentication failed'))
        }
    }
}

// Setup auth routes
export function setupAuthRoutes(app) {
    // Token login via URL
    app.get('/login/token', async (req, res) => {
        const { token } = req.query
        const authHeader = req.headers.authorization
        const cookieToken = req.cookies?.auth_token
        const existingToken = authHeader?.startsWith('Bearer ') 
            ? authHeader.substring(7) 
            : cookieToken

        if (existingToken) {
            try {
                jwt.verify(existingToken, authKey)
                return res.redirect('/')
            } catch {}
        }

        if (!token) {
            return res.status(400).send('Token is required')
        }

        try {
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
                
                res.cookie('auth_token', jwtToken, {
                    maxAge: 30 * 24 * 60 * 60 * 1000,
                    httpOnly: false, 
                    sameSite: 'lax',
                    path: '/'  
                })
                res.redirect(`/?auth_token=${jwtToken}`)
            } else {
                res.status(401).send('Invalid or expired token.')
            }
        } catch (error) {
            res.status(500).send('Login failed: ' + error.message)
        }
    })

    // POST /api/auth/login
    router.post('/login', async (req, res) => {
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
                } else if (authHandler.validatePermanentToken(authToken)) {
                    success = true
                    loginType = 'permanent_token'
                }
            }
            
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

                res.json(ApiResponse.ok({
                    token: jwtToken,
                    expiresIn: 30 * 24 * 60 * 60
                }))
            } else {
                res.status(401).json(ApiResponse.fail(null, 'Invalid token'))
            }
        } catch (error) {
            res.status(500).json(ApiResponse.fail(null, error.message))
        }
    })

    // POST /api/auth/logout
    router.post('/logout', async (req, res) => {
        const authHeader = req.headers.authorization
        if (authHeader?.startsWith('Bearer ')) {
            fingerprintValidator.remove(authHeader.substring(7))
        }
        res.clearCookie('auth_token')
        res.json(ApiResponse.ok(null))
    })

    // GET /api/auth/status
    router.get('/status', async (req, res) => {
        const authHeader = req.headers.authorization
        const cookieToken = req.cookies?.auth_token
        const token = authHeader?.startsWith('Bearer ') 
            ? authHeader.substring(7) 
            : cookieToken

        if (!token) {
            return res.json(ApiResponse.ok({ authenticated: false }))
        }

        try {
            const decoded = jwt.verify(token, authKey)
            res.json(ApiResponse.ok({ 
                authenticated: true, 
                loginTime: decoded.loginTime 
            }))
        } catch {
            res.json(ApiResponse.ok({ authenticated: false }))
        }
    })

    // POST /api/auth/generate-token
    router.post('/generate-token', createAuthMiddleware(), async (req, res) => {
        const { timeout, permanent, forceNew } = req.body
        const token = authHandler.generateToken(timeout || 300, permanent, forceNew)
        res.json(ApiResponse.ok({ token }))
    })

    app.use('/api/auth', router)
}

export default router
