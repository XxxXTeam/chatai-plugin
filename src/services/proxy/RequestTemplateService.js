import crypto from 'node:crypto'
import os from 'node:os'

/**
 * 请求模板服务 - 支持占位符替换和自定义请求体/请求头
 * 
 * 占位符列表：
 * - {{API_KEY}} - API密钥
 * - {{MODEL}} - 模型名称
 * - {{USER_AGENT}} - 浏览器UA
 * - {{XFF}} / {{X_FORWARDED_FOR}} - X-Forwarded-For头
 * - {{RANDOM_IP}} - 随机IP地址
 * - {{TIMESTAMP}} - 当前时间戳
 * - {{DATE}} - 当前日期 YYYY-MM-DD
 * - {{DATETIME}} - 当前日期时间
 * - {{UUID}} - 随机UUID
 * - {{NONCE}} - 随机数字串
 * - {{HOSTNAME}} - 主机名
 * - {{BASE_URL}} - API基础URL
 * - {{CHANNEL_NAME}} - 渠道名称
 */

class RequestTemplateService {
    constructor() {
        // 预定义的User-Agent列表
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
        ]
        
        // 默认请求头模板
        this.defaultHeadersTemplate = {
            'User-Agent': '{{USER_AGENT}}',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Content-Type': 'application/json'
        }
    }

    /**
     * 生成随机IP地址
     * @returns {string}
     */
    generateRandomIP() {
        const segments = []
        for (let i = 0; i < 4; i++) {
            // 避免生成私有地址段
            let seg = Math.floor(Math.random() * 223) + 1
            if (i === 0 && (seg === 10 || seg === 127 || seg === 192 || seg === 172)) {
                seg = Math.floor(Math.random() * 100) + 50
            }
            segments.push(seg)
        }
        return segments.join('.')
    }

    /**
     * 获取随机User-Agent
     * @returns {string}
     */
    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)]
    }

    /**
     * 生成随机Nonce
     * @param {number} length 
     * @returns {string}
     */
    generateNonce(length = 16) {
        return crypto.randomBytes(length).toString('hex').substring(0, length)
    }

    /**
     * 获取占位符值
     * @param {string} placeholder - 占位符名称（不含花括号）
     * @param {Object} context - 上下文（包含apiKey, model, baseUrl等）
     * @returns {string}
     */
    getPlaceholderValue(placeholder, context = {}) {
        const now = new Date()
        
        switch (placeholder.toUpperCase()) {
            case 'API_KEY':
            case 'APIKEY':
                return context.apiKey || ''
            
            case 'MODEL':
            case 'MODEL_NAME':
                return context.model || ''
            
            case 'USER_AGENT':
            case 'UA':
                return context.userAgent || this.getRandomUserAgent()
            
            case 'XFF':
            case 'X_FORWARDED_FOR':
            case 'X-FORWARDED-FOR':
                return context.xff || this.generateRandomIP()
            
            case 'RANDOM_IP':
            case 'RANDOMIP':
                return this.generateRandomIP()
            
            case 'TIMESTAMP':
            case 'TS':
                return Math.floor(now.getTime() / 1000).toString()
            
            case 'TIMESTAMP_MS':
                return now.getTime().toString()
            
            case 'DATE':
                return now.toISOString().split('T')[0]
            
            case 'DATETIME':
                return now.toISOString()
            
            case 'UUID':
                return crypto.randomUUID()
            
            case 'NONCE':
                return this.generateNonce()
            
            case 'NONCE32':
                return this.generateNonce(32)
            
            case 'HOSTNAME':
                return os.hostname()
            
            case 'BASE_URL':
            case 'BASEURL':
                return context.baseUrl || ''
            
            case 'CHANNEL_NAME':
            case 'CHANNELNAME':
                return context.channelName || ''
            
            case 'AUTHORIZATION':
            case 'AUTH':
                return context.apiKey ? `Bearer ${context.apiKey}` : ''
            
            default:
                // 支持自定义占位符
                if (context.custom && context.custom[placeholder]) {
                    return context.custom[placeholder]
                }
                return `{{${placeholder}}}`
        }
    }

    /**
     * 替换字符串中的所有占位符
     * @param {string} template - 模板字符串
     * @param {Object} context - 上下文
     * @returns {string}
     */
    replaceplaceholders(template, context = {}) {
        if (!template || typeof template !== 'string') return template
        
        return template.replace(/\{\{([^}]+)\}\}/g, (match, placeholder) => {
            return this.getPlaceholderValue(placeholder.trim(), context)
        })
    }

    /**
     * 处理对象中的所有占位符
     * @param {Object} obj - 包含占位符的对象
     * @param {Object} context - 上下文
     * @returns {Object}
     */
    processObject(obj, context = {}) {
        if (!obj || typeof obj !== 'object') return obj
        
        const result = Array.isArray(obj) ? [] : {}
        
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                result[key] = this.replaceplaceholders(value, context)
            } else if (typeof value === 'object' && value !== null) {
                result[key] = this.processObject(value, context)
            } else {
                result[key] = value
            }
        }
        
        return result
    }

    /**
     * 构建请求头
     * @param {Object} customHeaders - 自定义请求头（JSON格式或对象）
     * @param {Object} context - 上下文
     * @returns {Object}
     */
    buildHeaders(customHeaders, context = {}) {
        // 合并默认头和自定义头
        let headers = { ...this.defaultHeadersTemplate }
        
        // 处理自定义头
        if (customHeaders) {
            if (typeof customHeaders === 'string') {
                try {
                    customHeaders = JSON.parse(customHeaders)
                } catch (e) {
                    logger.warn('[RequestTemplate] 解析自定义请求头失败:', e.message)
                    customHeaders = {}
                }
            }
            headers = { ...headers, ...customHeaders }
        }
        
        // 替换占位符
        return this.processObject(headers, context)
    }

    /**
     * 构建请求体
     * @param {Object} bodyTemplate - 请求体模板
     * @param {Object} context - 上下文
     * @returns {Object}
     */
    buildRequestBody(bodyTemplate, context = {}) {
        if (!bodyTemplate) return null
        
        let template = bodyTemplate
        if (typeof template === 'string') {
            try {
                template = JSON.parse(template)
            } catch (e) {
                logger.warn('[RequestTemplate] 解析请求体模板失败:', e.message)
                return null
            }
        }
        
        return this.processObject(template, context)
    }

    /**
     * 验证JSON模板格式
     * @param {string} jsonString 
     * @returns {{ valid: boolean, error?: string, parsed?: Object }}
     */
    validateJsonTemplate(jsonString) {
        if (!jsonString || typeof jsonString !== 'string') {
            return { valid: true, parsed: {} }
        }
        
        try {
            const parsed = JSON.parse(jsonString)
            return { valid: true, parsed }
        } catch (e) {
            return { valid: false, error: e.message }
        }
    }

    /**
     * 获取可用占位符列表
     * @returns {Array}
     */
    getAvailablePlaceholders() {
        return [
            { key: 'API_KEY', description: 'API密钥', example: 'sk-xxx...' },
            { key: 'MODEL', description: '模型名称', example: 'gpt-4' },
            { key: 'USER_AGENT', description: '随机浏览器UA', example: 'Mozilla/5.0...' },
            { key: 'XFF', description: 'X-Forwarded-For (随机IP)', example: '123.45.67.89' },
            { key: 'RANDOM_IP', description: '随机IP地址', example: '203.45.67.89' },
            { key: 'TIMESTAMP', description: '当前时间戳(秒)', example: '1703145600' },
            { key: 'TIMESTAMP_MS', description: '当前时间戳(毫秒)', example: '1703145600000' },
            { key: 'DATE', description: '当前日期', example: '2024-12-21' },
            { key: 'DATETIME', description: '当前日期时间(ISO)', example: '2024-12-21T12:00:00Z' },
            { key: 'UUID', description: '随机UUID', example: 'a1b2c3d4-...' },
            { key: 'NONCE', description: '随机数字串(16位)', example: 'a1b2c3d4e5f6g7h8' },
            { key: 'NONCE32', description: '随机数字串(32位)', example: 'a1b2c3d4...' },
            { key: 'HOSTNAME', description: '主机名', example: 'server-01' },
            { key: 'BASE_URL', description: 'API基础URL', example: 'https://api.openai.com/v1' },
            { key: 'CHANNEL_NAME', description: '渠道名称', example: 'OpenAI官方' },
            { key: 'AUTHORIZATION', description: 'Bearer认证头', example: 'Bearer sk-xxx...' },
        ]
    }

    /**
     * 预览占位符替换结果
     * @param {string} template 
     * @param {Object} sampleContext 
     * @returns {string}
     */
    previewTemplate(template, sampleContext = {}) {
        const defaultContext = {
            apiKey: 'sk-sample-key-xxx',
            model: 'gpt-4o',
            baseUrl: 'https://api.openai.com/v1',
            channelName: '示例渠道'
        }
        return this.replaceplaceholders(template, { ...defaultContext, ...sampleContext })
    }
}

export const requestTemplateService = new RequestTemplateService()
