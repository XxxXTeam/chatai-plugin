/**
 * 配置路由模块
 */
import express from 'express'
import config from '../../../config/config.js'
import { ChaiteResponse } from './shared.js'
import { chatLogger } from '../../core/utils/logger.js'

const router = express.Router()

// GET /config - 获取配置
router.get('/', (req, res) => {
    try {
        const safeConfig = {
            llm: config.get('llm'),
            presets: config.get('presets'),
            triggers: config.get('triggers'),
            features: config.get('features'),
            web: {
                enabled: config.get('web.enabled'),
                port: config.get('web.port'),
                loginLinks: config.get('web.loginLinks') || [],
                publicUrl: config.get('web.publicUrl') || '',
                permanentAuthToken: config.get('web.permanentAuthToken') || null
            }
        }
        res.json(ChaiteResponse.ok(safeConfig))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// 深度合并对象的辅助函数
function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            if (!target[key]) target[key] = {}
            deepMerge(target[key], source[key])
        } else {
            target[key] = source[key]
        }
    }
    return target
}

// POST /config - 更新配置（支持深度合并）
router.post('/', async (req, res) => {
    try {
        const updates = req.body
        for (const [key, value] of Object.entries(updates)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                // 深度合并对象
                const existing = config.get(key) || {}
                const merged = deepMerge({ ...existing }, value)
                config.set(key, merged)
            } else {
                config.set(key, value)
            }
        }
        chatLogger.debug('[WebServer] 配置已保存')
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /config/advanced - 获取高级配置
router.get('/advanced', (req, res) => {
    try {
        res.json(ChaiteResponse.ok({
            llm: config.get('llm'),
            context: config.get('context'),
            tools: config.get('tools'),
            proxy: config.get('proxy'),
            qqBotProxy: config.get('qqBotProxy'),
            web: config.get('web'),
            redis: config.get('redis')
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /config/advanced - 更新高级配置
router.put('/advanced', async (req, res) => {
    try {
        const { llm, context, tools, proxy, qqBotProxy, web, redis } = req.body
        if (llm) config.set('llm', { ...config.get('llm'), ...llm })
        if (context) config.set('context', { ...config.get('context'), ...context })
        if (tools) config.set('tools', { ...config.get('tools'), ...tools })
        if (proxy) config.set('proxy', { ...config.get('proxy'), ...proxy })
        if (qqBotProxy) config.set('qqBotProxy', { ...config.get('qqBotProxy'), ...qqBotProxy })
        // 系统设置: web 和 redis
        if (web) config.set('web', { ...config.get('web'), ...web })
        if (redis) config.set('redis', { ...config.get('redis'), ...redis })
        chatLogger.debug('[ConfigRoutes] 高级配置已保存')
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /config/triggers - 获取触发器配置
router.get('/triggers', (req, res) => {
    try {
        res.json(ChaiteResponse.ok(config.get('triggers') || {}))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /config/triggers - 更新触发器配置
router.put('/triggers', async (req, res) => {
    try {
        config.set('triggers', req.body)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /config/context - 获取上下文配置
router.get('/context', (req, res) => {
    try {
        res.json(ChaiteResponse.ok(config.get('context') || {}))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /config/context - 更新上下文配置
router.put('/context', async (req, res) => {
    try {
        config.set('context', { ...config.get('context'), ...req.body })
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /config/personality - 获取人格配置
router.get('/personality', (req, res) => {
    try {
        res.json(ChaiteResponse.ok(config.get('personality') || {}))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PATCH /config/personality - 更新人格配置
router.patch('/personality', async (req, res) => {
    try {
        config.set('personality', { ...config.get('personality'), ...req.body })
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /config/links - 获取登录链接配置
router.get('/links', (req, res) => {
    try {
        res.json(ChaiteResponse.ok({
            loginLinks: config.get('web.loginLinks') || [],
            publicUrl: config.get('web.publicUrl') || ''
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /config/links - 更新登录链接配置
router.put('/links', async (req, res) => {
    try {
        const { loginLinks, publicUrl } = req.body
        if (loginLinks !== undefined) config.set('web.loginLinks', loginLinks)
        if (publicUrl !== undefined) config.set('web.publicUrl', publicUrl)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
