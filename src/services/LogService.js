import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 日志服务 - 保存错误日志到文件
 */
class LogService {
    constructor() {
        // 插件根目录下的 logs 文件夹
        this.logDir = path.join(__dirname, '../../logs')
        this.maxLogFiles = 30 // 最多保留30天的日志
        this.maxFileSize = 10 * 1024 * 1024 // 单个文件最大10MB
        this.initialized = false
    }

    /**
     * 初始化日志目录
     */
    init() {
        if (this.initialized) return
        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true })
            }
            this.initialized = true
            this.cleanOldLogs()
        } catch (err) {
            console.error('[LogService] 初始化日志目录失败:', err.message)
        }
    }

    /**
     * 获取当前日期的日志文件路径
     * @param {string} type - 日志类型 (error, api, debug)
     * @returns {string}
     */
    getLogFilePath(type = 'error') {
        const date = new Date().toISOString().split('T')[0]
        return path.join(this.logDir, `${type}-${date}.log`)
    }

    /**
     * 写入日志
     * @param {string} type - 日志类型
     * @param {string} message - 日志消息
     * @param {Object} data - 附加数据
     */
    write(type, message, data = null) {
        this.init()
        
        const timestamp = new Date().toISOString()
        const logEntry = {
            timestamp,
            type,
            message,
            ...(data && { data })
        }

        const logLine = JSON.stringify(logEntry) + '\n'
        const filePath = this.getLogFilePath(type)

        try {
            // 检查文件大小，超过限制则轮转
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath)
                if (stats.size >= this.maxFileSize) {
                    const rotatedPath = filePath.replace('.log', `-${Date.now()}.log`)
                    fs.renameSync(filePath, rotatedPath)
                }
            }
            
            fs.appendFileSync(filePath, logLine, 'utf8')
        } catch (err) {
            console.error('[LogService] 写入日志失败:', err.message)
        }
    }

    /**
     * 记录错误日志
     * @param {string} message - 错误消息
     * @param {Error|Object} error - 错误对象
     * @param {Object} context - 上下文信息
     */
    error(message, error = null, context = null) {
        const data = {
            ...(context && { context }),
            ...(error && {
                error: {
                    message: error.message || String(error),
                    stack: error.stack,
                    code: error.code,
                    status: error.status,
                    type: error.type,
                    // API 错误特有字段
                    ...(error.response && {
                        response: {
                            status: error.response.status,
                            statusText: error.response.statusText,
                            data: error.response.data
                        }
                    }),
                    // OpenAI SDK 错误字段
                    ...(error.error && { apiError: error.error }),
                    ...(error.headers && { headers: this.sanitizeHeaders(error.headers) })
                }
            })
        }
        
        this.write('error', message, data)
        
        // 同时输出到控制台
        if (typeof logger !== 'undefined') {
            logger.error(`[LogService] ${message}`, error?.message || '')
        }
    }

    /**
     * 记录 API 错误日志
     * @param {string} adapter - 适配器名称
     * @param {string} model - 模型名称
     * @param {Error} error - 错误对象
     * @param {Object} request - 请求信息
     */
    apiError(adapter, model, error, request = null) {
        const context = {
            adapter,
            model,
            ...(request && {
                request: {
                    baseUrl: request.baseUrl,
                    messagesCount: request.messages?.length,
                    toolsCount: request.tools?.length,
                    stream: request.stream,
                    temperature: request.temperature,
                    maxTokens: request.maxTokens || request.max_tokens
                }
            })
        }
        
        this.error(`[${adapter}] API请求失败 - ${model}`, error, context)
    }

    /**
     * 记录媒体处理错误
     * @param {string} type - 媒体类型 (image, video, audio)
     * @param {string} url - 媒体URL
     * @param {Error} error - 错误对象
     */
    mediaError(type, url, error) {
        const context = {
            mediaType: type,
            url: this.truncateUrl(url),
            urlLength: url?.length
        }
        
        this.error(`[Media] ${type}处理失败`, error, context)
    }

    /**
     * 清理过期日志
     */
    cleanOldLogs() {
        try {
            const files = fs.readdirSync(this.logDir)
            const now = Date.now()
            const maxAge = this.maxLogFiles * 24 * 60 * 60 * 1000

            for (const file of files) {
                if (!file.endsWith('.log')) continue
                
                const filePath = path.join(this.logDir, file)
                const stats = fs.statSync(filePath)
                
                if (now - stats.mtime.getTime() > maxAge) {
                    fs.unlinkSync(filePath)
                    console.log(`[LogService] 清理过期日志: ${file}`)
                }
            }
        } catch (err) {
            console.error('[LogService] 清理日志失败:', err.message)
        }
    }

    /**
     * 获取最近的错误日志
     * @param {number} lines - 行数
     * @returns {Array}
     */
    getRecentErrors(lines = 100) {
        this.init()
        
        const filePath = this.getLogFilePath('error')
        if (!fs.existsSync(filePath)) {
            return []
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8')
            const logLines = content.trim().split('\n').filter(Boolean)
            const recentLines = logLines.slice(-lines)
            
            return recentLines.map(line => {
                try {
                    return JSON.parse(line)
                } catch {
                    return { raw: line }
                }
            })
        } catch (err) {
            console.error('[LogService] 读取日志失败:', err.message)
            return []
        }
    }

    /**
     * 获取日志文件列表
     * @returns {Array}
     */
    getLogFiles() {
        this.init()
        
        try {
            const files = fs.readdirSync(this.logDir)
            return files
                .filter(f => f.endsWith('.log'))
                .map(f => {
                    const filePath = path.join(this.logDir, f)
                    const stats = fs.statSync(filePath)
                    return {
                        name: f,
                        size: stats.size,
                        modified: stats.mtime.toISOString()
                    }
                })
                .sort((a, b) => new Date(b.modified) - new Date(a.modified))
        } catch (err) {
            return []
        }
    }

    /**
     * 截断URL用于日志显示
     * @param {string} url 
     * @param {number} maxLen 
     * @returns {string}
     */
    truncateUrl(url, maxLen = 100) {
        if (!url || typeof url !== 'string') return url
        if (url.length <= maxLen) return url
        return url.substring(0, maxLen) + '...[truncated]'
    }

    /**
     * 清理敏感头信息
     * @param {Object} headers 
     * @returns {Object}
     */
    sanitizeHeaders(headers) {
        if (!headers) return headers
        const sanitized = { ...headers }
        const sensitiveKeys = ['authorization', 'x-api-key', 'api-key', 'cookie']
        for (const key of Object.keys(sanitized)) {
            if (sensitiveKeys.includes(key.toLowerCase())) {
                sanitized[key] = '[REDACTED]'
            }
        }
        return sanitized
    }
}

export const logService = new LogService()
