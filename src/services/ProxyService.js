import config from '../../config/config.js'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { HttpProxyAgent } from 'http-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'

/**
 * 代理服务 - 管理不同环境的代理配置
 * 支持的环境:
 * - browser: 浏览器/Puppeteer (website工具)
 * - api: 通用API请求 (fetch/axios)
 * - channel: 渠道API请求 (OpenAI等LLM API)
 */
class ProxyService {m
    constructor() {
        this.agentCache = new Map()
    }

    /**
     * 获取代理配置
     */
    getConfig() {
        return config.get('proxy') || {
            enabled: false,
            profiles: []
        }
    }

    /**
     * 获取所有代理配置
     */
    getProfiles() {
        const proxyConfig = this.getConfig()
        return proxyConfig.profiles || []
    }

    /**
     * 根据ID获取代理配置
     * @param {string} id 
     */
    getProfileById(id) {
        const profiles = this.getProfiles()
        return profiles.find(p => p.id === id)
    }

    /**
     * 获取指定环境的代理配置
     * @param {'browser' | 'api' | 'channel'} scope 
     */
    getProfileForScope(scope) {
        const proxyConfig = this.getConfig()
        if (!proxyConfig.enabled) return null

        const scopeConfig = proxyConfig.scopes?.[scope]
        if (!scopeConfig?.enabled || !scopeConfig?.profileId) return null

        return this.getProfileById(scopeConfig.profileId)
    }

    /**
     * 构建代理URL
     * @param {Object} profile 代理配置
     */
    buildProxyUrl(profile) {
        if (!profile) return null

        const { type, host, port, username, password } = profile
        
        let auth = ''
        if (username && password) {
            auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`
        }

        switch (type) {
            case 'http':
                return `http://${auth}${host}:${port}`
            case 'https':
                return `https://${auth}${host}:${port}`
            case 'socks5':
                return `socks5://${auth}${host}:${port}`
            case 'socks4':
                return `socks4://${auth}${host}:${port}`
            default:
                return `http://${auth}${host}:${port}`
        }
    }

    /**
     * 获取浏览器代理参数 (用于Puppeteer)
     * @returns {string | null} 代理服务器参数
     */
    getBrowserProxyArgs() {
        const profile = this.getProfileForScope('browser')
        if (!profile) return null

        const proxyUrl = this.buildProxyUrl(profile)
        return proxyUrl
    }

    /**
     * 获取API代理Agent (用于node-fetch/axios)
     * @param {string} targetUrl 目标URL
     * @returns {Object | null} HTTP Agent
     */
    getApiProxyAgent(targetUrl) {
        const profile = this.getProfileForScope('api')
        if (!profile) return null

        return this.createProxyAgent(profile, targetUrl)
    }

    /**
     * 获取渠道代理Agent (用于OpenAI SDK)
     * @param {string} targetUrl 目标URL
     * @returns {Object | null} HTTP Agent
     */
    getChannelProxyAgent(targetUrl) {
        const profile = this.getProfileForScope('channel')
        if (!profile) return null

        return this.createProxyAgent(profile, targetUrl)
    }

    /**
     * 创建代理Agent
     * @param {Object} profile 代理配置
     * @param {string} targetUrl 目标URL
     */
    createProxyAgent(profile, targetUrl) {
        if (!profile) return null

        const proxyUrl = this.buildProxyUrl(profile)
        const cacheKey = `${proxyUrl}_${targetUrl?.startsWith('https') ? 'https' : 'http'}`

        // 检查缓存
        if (this.agentCache.has(cacheKey)) {
            return this.agentCache.get(cacheKey)
        }

        let agent
        const isHttps = targetUrl?.startsWith('https')

        try {
            if (profile.type === 'socks5' || profile.type === 'socks4') {
                agent = new SocksProxyAgent(proxyUrl)
            } else if (isHttps) {
                agent = new HttpsProxyAgent(proxyUrl)
            } else {
                agent = new HttpProxyAgent(proxyUrl)
            }

            // 缓存agent
            this.agentCache.set(cacheKey, agent)
            return agent
        } catch (error) {
            logger.error('[ProxyService] 创建代理Agent失败:', error)
            return null
        }
    }

    /**
     * 获取fetch选项中的代理配置
     * @param {string} url 目标URL
     * @param {'api' | 'channel'} scope 作用域
     */
    getFetchOptions(url, scope = 'api') {
        const profile = scope === 'channel' 
            ? this.getProfileForScope('channel')
            : this.getProfileForScope('api')
        
        if (!profile) return {}

        const agent = this.createProxyAgent(profile, url)
        return agent ? { agent } : {}
    }

    /**
     * 清除Agent缓存
     */
    clearCache() {
        this.agentCache.clear()
    }

    /**
     * 添加代理配置
     * @param {Object} profile 
     */
    addProfile(profile) {
        const profiles = this.getProfiles()
        const newProfile = {
            id: crypto.randomUUID(),
            name: profile.name || '未命名代理',
            type: profile.type || 'http',
            host: profile.host,
            port: profile.port,
            username: profile.username || '',
            password: profile.password || '',
            enabled: profile.enabled !== false,
            createdAt: Date.now()
        }
        profiles.push(newProfile)
        config.set('proxy.profiles', profiles)
        this.clearCache()
        return newProfile
    }

    /**
     * 更新代理配置
     * @param {string} id 
     * @param {Object} updates 
     */
    updateProfile(id, updates) {
        const profiles = this.getProfiles()
        const index = profiles.findIndex(p => p.id === id)
        if (index === -1) return null

        profiles[index] = { ...profiles[index], ...updates, updatedAt: Date.now() }
        config.set('proxy.profiles', profiles)
        this.clearCache()
        return profiles[index]
    }

    /**
     * 删除代理配置
     * @param {string} id 
     */
    deleteProfile(id) {
        const profiles = this.getProfiles()
        const index = profiles.findIndex(p => p.id === id)
        if (index === -1) return false

        profiles.splice(index, 1)
        config.set('proxy.profiles', profiles)

        // 检查是否有scope使用了这个profile，如果有则清除
        const scopes = config.get('proxy.scopes') || {}
        for (const [scope, scopeConfig] of Object.entries(scopes)) {
            if (scopeConfig.profileId === id) {
                config.set(`proxy.scopes.${scope}.profileId`, null)
                config.set(`proxy.scopes.${scope}.enabled`, false)
            }
        }

        this.clearCache()
        return true
    }

    /**
     * 设置作用域代理
     * @param {'browser' | 'api' | 'channel'} scope 
     * @param {string | null} profileId 
     * @param {boolean} enabled 
     */
    setScopeProxy(scope, profileId, enabled = true) {
        const validScopes = ['browser', 'api', 'channel']
        if (!validScopes.includes(scope)) {
            throw new Error(`Invalid scope: ${scope}`)
        }

        config.set(`proxy.scopes.${scope}`, {
            enabled: enabled && !!profileId,
            profileId: profileId || null
        })
        this.clearCache()
    }

    /**
     * 设置全局启用状态
     * @param {boolean} enabled 
     */
    setEnabled(enabled) {
        config.set('proxy.enabled', enabled)
        this.clearCache()
    }

    /**
     * 测试代理连接
     * @param {Object} profile 代理配置
     * @param {string} testUrl 测试URL
     */
    async testProxy(profile, testUrl = 'https://www.google.com') {
        try {
            const agent = this.createProxyAgent(profile, testUrl)
            if (!agent) {
                return { success: false, error: '无法创建代理Agent' }
            }

            const fetch = (await import('node-fetch')).default
            const startTime = Date.now()
            
            const response = await fetch(testUrl, {
                agent,
                timeout: 10000,
                method: 'HEAD'
            })

            const latency = Date.now() - startTime

            return {
                success: response.ok,
                status: response.status,
                latency,
                message: response.ok ? '连接成功' : `HTTP ${response.status}`
            }
        } catch (error) {
            return {
                success: false,
                error: error.message || '连接失败'
            }
        }
    }
}

// 导出单例
export const proxyService = new ProxyService()
export default proxyService
