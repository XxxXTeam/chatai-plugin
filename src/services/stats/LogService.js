import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 日志服务 - 保存错误日志到文件
 * 支持多种日志类型：error, warn, api, tool, channel, debug
 */
class LogService {
    constructor() {
        this.logDir = path.join(__dirname, '../../../logs')
        this.maxLogFiles = 30 // 最多保留30天的日志
        this.maxFileSize = 10 * 1024 * 1024 // 单个文件最大10MB
        this.initialized = false
        this.buffer = new Map()
        this.bufferFlushInterval = 5000 // 5秒刷新一次
        this.bufferMaxSize = 50 // 每种类型最多缓存50条
        this.flushTimer = null
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
            // 启动缓冲区定时刷新
            this.startFlushTimer()
        } catch (err) {
            console.error('[LogService] 初始化日志目录失败:', err.message)
        }
    }

    /**
     * 启动缓冲区刷新定时器
     */
    startFlushTimer() {
        if (this.flushTimer) return
        this.flushTimer = setInterval(() => {
            this.flushBuffer()
        }, this.bufferFlushInterval)
        // 允许进程正常退出
        if (this.flushTimer.unref) {
            this.flushTimer.unref()
        }
    }

    /**
     * 刷新缓冲区到文件
     */
    flushBuffer() {
        for (const [type, entries] of this.buffer) {
            if (entries.length === 0) continue
            
            const filePath = this.getLogFilePath(type)
            const content = entries.map(e => JSON.stringify(e) + '\n').join('')
            
            try {
                fs.appendFileSync(filePath, content, 'utf8')
            } catch (err) {
                console.error(`[LogService] 刷新 ${type} 日志失败:`, err.message)
            }
        }
        this.buffer.clear()
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
     * 记录警告日志
     * @param {string} message - 警告消息
     * @param {Error|Object} error - 错误对象
     * @param {Object} context - 上下文信息
     */
    warn(message, error = null, context = null) {
        const data = {
            ...(context && { context }),
            ...(error && {
                error: {
                    message: error.message || String(error),
                    stack: error.stack,
                    code: error.code
                }
            })
        }
        
        this.write('warn', message, data)
        
        // 同时输出到控制台
        if (typeof logger !== 'undefined') {
            logger.warn(`[LogService] ${message}`, error?.message || '')
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
        // 4xx 客户端错误（URL过期等）静默处理，只记录 debug
        const is4xxError = error?.status >= 400 && error?.status < 500
        if (is4xxError) {
            // 静默处理，避免刷屏
            return
        }
        
        const context = {
            mediaType: type,
            url: this.truncateUrl(url),
            urlLength: url?.length
        }
        
        this.warn(`[Media] ${type}处理失败`, error, context)
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

    /**
     * 记录工具调用日志
     * @param {string} toolName - 工具名称
     * @param {Object} args - 调用参数
     * @param {Object} result - 执行结果
     * @param {Object} context - 上下文信息
     */
    toolCall(toolName, args, result, context = {}) {
        const data = {
            tool: toolName,
            args: this.sanitizeArgs(args),
            result: typeof result === 'string' 
                ? result.substring(0, 500) 
                : JSON.stringify(result).substring(0, 500),
            duration: context.duration || 0,
            success: context.success !== false,
            userId: context.userId,
            groupId: context.groupId
        }
        
        this.write('tool', `[${toolName}] ${context.success !== false ? '成功' : '失败'}`, data)
    }

    /**
     * 记录渠道操作日志
     * @param {string} action - 操作类型 (select, switch, error, success)
     * @param {Object} details - 详情
     */
    channel(action, details = {}) {
        const data = {
            action,
            channelId: details.channelId,
            channelName: details.channelName,
            model: details.model,
            keyIndex: details.keyIndex,
            duration: details.duration,
            success: details.success,
            error: details.error,
            previousChannel: details.previousChannel
        }
        
        this.write('channel', `[${action}] ${details.channelName || details.channelId || ''}`, data)
    }

    /**
     * 记录调度日志
     * @param {string} phase - 阶段 (dispatch, parse, execute)
     * @param {Object} details - 详情
     */
    dispatch(phase, details = {}) {
        const data = {
            phase,
            model: details.model,
            tasks: details.tasks,
            toolGroups: details.toolGroups,
            analysis: details.analysis,
            executionMode: details.executionMode,
            duration: details.duration,
            error: details.error
        }
        
        this.write('dispatch', `[${phase}] ${details.analysis || ''}`, data)
    }

    /**
     * 记录对话日志
     * @param {string} conversationId - 对话ID
     * @param {Object} details - 详情
     */
    conversation(conversationId, details = {}) {
        const data = {
            conversationId,
            userId: details.userId,
            groupId: details.groupId,
            model: details.model,
            inputTokens: details.inputTokens,
            outputTokens: details.outputTokens,
            duration: details.duration,
            toolCalls: details.toolCalls,
            success: details.success !== false
        }
        
        this.write('conversation', `[${conversationId}]`, data)
    }

    /**
     * 清理参数中的敏感信息
     * @param {Object} args 
     * @returns {Object}
     */
    sanitizeArgs(args) {
        if (!args || typeof args !== 'object') return args
        const sanitized = { ...args }
        const sensitiveKeys = ['password', 'token', 'secret', 'key', 'apiKey', 'api_key']
        for (const key of Object.keys(sanitized)) {
            if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
                sanitized[key] = '[REDACTED]'
            }
        }
        return sanitized
    }

    /**
     * 获取日志统计摘要
     * @returns {Object}
     */
    getLogSummary() {
        this.init()
        
        const summary = {
            totalFiles: 0,
            totalSize: 0,
            recentErrors: 0,
            byType: {}
        }
        
        try {
            const files = fs.readdirSync(this.logDir)
            const today = new Date().toISOString().split('T')[0]
            
            for (const file of files) {
                if (!file.endsWith('.log')) continue
                
                const filePath = path.join(this.logDir, file)
                const stats = fs.statSync(filePath)
                
                summary.totalFiles++
                summary.totalSize += stats.size
                
                // 提取日志类型
                const typeMatch = file.match(/^([^-]+)-/)
                if (typeMatch) {
                    const type = typeMatch[1]
                    if (!summary.byType[type]) {
                        summary.byType[type] = { files: 0, size: 0 }
                    }
                    summary.byType[type].files++
                    summary.byType[type].size += stats.size
                }
                
                // 统计今日错误
                if (file.includes('error') && file.includes(today)) {
                    const content = fs.readFileSync(filePath, 'utf8')
                    summary.recentErrors = content.split('\n').filter(Boolean).length
                }
            }
            
            // 格式化大小
            summary.totalSizeFormatted = this.formatSize(summary.totalSize)
            for (const type of Object.keys(summary.byType)) {
                summary.byType[type].sizeFormatted = this.formatSize(summary.byType[type].size)
            }
        } catch (err) {
            console.error('[LogService] 获取日志摘要失败:', err.message)
        }
        
        return summary
    }

    /**
     * 格式化文件大小
     * @param {number} bytes 
     * @returns {string}
     */
    formatSize(bytes) {
        if (bytes < 1024) return `${bytes}B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`
    }

    /**
     * 关闭日志服务（刷新缓冲区）
     */
    close() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer)
            this.flushTimer = null
        }
        this.flushBuffer()
    }
}

export const logService = new LogService()
