/**
 * 代理路由模块
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'

const router = express.Router()

// GET / - 获取代理配置
router.get('/', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const config = proxyService.getConfig()
        res.json(ChaiteResponse.ok(config))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT / - 更新代理全局配置
router.put('/', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const { enabled } = req.body
        if (enabled !== undefined) {
            proxyService.setEnabled(enabled)
        }
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /scopes/:scope - 设置作用域代理
router.put('/scopes/:scope', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const { scope } = req.params
        const { profileId, enabled } = req.body
        proxyService.setScopeProxy(scope, profileId, enabled)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /profiles - 获取代理配置列表
router.get('/profiles', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const profiles = proxyService.getProfiles()
        res.json(ChaiteResponse.ok(profiles))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /profile/:id - 获取单个代理配置
router.get('/profile/:id', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const profile = proxyService.getProfileById(req.params.id)
        if (!profile) return res.status(404).json(ChaiteResponse.fail(null, 'Profile not found'))
        res.json(ChaiteResponse.ok(profile))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /profiles - 创建代理配置
router.post('/profiles', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const profile = proxyService.addProfile(req.body)
        res.status(201).json(ChaiteResponse.ok(profile))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /profiles/:id - 更新代理配置
router.put('/profiles/:id', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const profile = proxyService.updateProfile(req.params.id, req.body)
        if (!profile) return res.status(404).json(ChaiteResponse.fail(null, 'Profile not found'))
        res.json(ChaiteResponse.ok(profile))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /profiles/:id - 删除代理配置
router.delete('/profiles/:id', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const deleted = proxyService.deleteProfile(req.params.id)
        if (!deleted) return res.status(404).json(ChaiteResponse.fail(null, 'Profile not found'))
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /test - 测试代理连接
router.post('/test', async (req, res) => {
    try {
        const { proxyService } = await import('../proxy/ProxyService.js')
        const { profileId, testUrl, type, host, port, username, password } = req.body
        
        let profile
        if (profileId) {
            profile = proxyService.getProfileById(profileId)
            if (!profile) return res.status(404).json(ChaiteResponse.fail(null, 'Profile not found'))
        } else {
            if (!host || !port) return res.status(400).json(ChaiteResponse.fail(null, 'host and port are required'))
            profile = { type, host, port: parseInt(port), username, password }
        }
        
        const result = await proxyService.testProxy(profile, testUrl || 'https://www.google.com')
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
