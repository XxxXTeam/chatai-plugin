/**
 * 通用工具函数
 */
import * as crypto from 'node:crypto'
import path from 'path'
import { fileURLToPath } from 'url'
import config from '../../config/config.js'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 生成 MD5 哈希
 * @param {string} str
 * @returns {string}
 */
export function md5(str) {
    return crypto.createHash('md5').update(str).digest('hex')
}

/**
 * Converts a timestamp to Beijing time (UTC+8)
 * @param {number|string} timestamp - Timestamp in milliseconds or seconds
 * @param {string} [format='YYYY-MM-DD HH:mm:ss'] - Output format
 * @returns {string} Formatted Beijing time
 */
export function formatTimeToBeiJing(timestamp, format = 'YYYY-MM-DD HH:mm:ss') {
    // Handle string timestamp
    if (typeof timestamp === 'string') {
        timestamp = parseInt(timestamp)
    }

    // Automatically determine if timestamp is in seconds or milliseconds
    // If timestamp represents a date before 2000, assume it's in milliseconds
    if (timestamp.toString().length <= 10) {
        // Convert seconds to milliseconds
        timestamp = timestamp * 1000
    }

    // Create date object with the timestamp
    const date = new Date(timestamp)

    // Calculate Beijing time (UTC+8)
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000)

    // Format the date according to the specified format
    return formatDate(beijingTime, format)
}

/**
 * Formats a Date object according to the specified format
 * @param {Date} date - Date object to format
 * @param {string} format - Format string (YYYY-MM-DD HH:mm:ss)
 * @returns {string} Formatted date string
 */
function formatDate(date, format) {
    const year = date.getUTCFullYear()
    const month = padZero(date.getUTCMonth() + 1)
    const day = padZero(date.getUTCDate())
    const hours = padZero(date.getUTCHours())
    const minutes = padZero(date.getUTCMinutes())
    const seconds = padZero(date.getUTCSeconds())

    return format
        .replace('YYYY', year)
        .replace('MM', month)
        .replace('DD', day)
        .replace('HH', hours)
        .replace('mm', minutes)
        .replace('ss', seconds)
}

/**
 * Pads a number with leading zero if needed
 * @param {number} num - Number to pad
 * @returns {string} Padded number string
 */
function padZero(num) {
    return num < 10 ? '0' + num : num.toString()
}

// 数据目录 - 使用正确的配置引用
export const dataDir = path.resolve('./plugins/chatgpt-plugin', config.get('chaite.dataDir') || 'data')
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
}

/**
 * 生成唯一 ID
 * @returns {string}
 */
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 15)
}

/**
 * 生成 UUID v4
 * @returns {string}
 */
export function uuid() {
    return crypto.randomUUID()
}

/**
 * 延迟执行
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 带重试的异步执行
 * @param {Function} fn - 异步函数
 * @param {Object} options - 配置
 * @param {number} [options.retries=3] - 最大重试次数
 * @param {number} [options.delay=1000] - 重试间隔（毫秒）
 * @param {number} [options.backoff=2] - 退避倍数
 * @param {Function} [options.onRetry] - 重试回调
 * @returns {Promise<*>}
 */
export async function retry(fn, options = {}) {
    const { retries = 3, delay = 1000, backoff = 2, onRetry } = options
    let lastError

    for (let i = 0; i <= retries; i++) {
        try {
            return await fn()
        } catch (error) {
            lastError = error
            if (i < retries) {
                const waitTime = delay * Math.pow(backoff, i)
                onRetry?.(error, i + 1, waitTime)
                await sleep(waitTime)
            }
        }
    }
    throw lastError
}

/**
 * 截断字符串
 * @param {string} str - 原始字符串
 * @param {number} maxLength - 最大长度
 * @param {string} [suffix='...'] - 后缀
 * @returns {string}
 */
export function truncate(str, maxLength, suffix = '...') {
    if (!str || str.length <= maxLength) return str
    return str.substring(0, maxLength - suffix.length) + suffix
}

/**
 * 安全的 JSON 解析
 * @param {string} str - JSON 字符串
 * @param {*} [defaultValue=null] - 解析失败时的默认值
 * @returns {*}
 */
export function safeJsonParse(str, defaultValue = null) {
    try {
        return JSON.parse(str)
    } catch {
        return defaultValue
    }
}

/**
 * 安全的 JSON 字符串化
 * @param {*} obj - 对象
 * @param {number} [indent] - 缩进
 * @returns {string}
 */
export function safeJsonStringify(obj, indent) {
    try {
        return JSON.stringify(obj, null, indent)
    } catch {
        return String(obj)
    }
}

/**
 * 深拷贝对象
 * @param {*} obj - 源对象
 * @returns {*}
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj
    if (obj instanceof Date) return new Date(obj)
    if (obj instanceof Array) return obj.map(item => deepClone(item))
    if (obj instanceof Map) return new Map(Array.from(obj.entries()).map(([k, v]) => [k, deepClone(v)]))
    if (obj instanceof Set) return new Set(Array.from(obj).map(v => deepClone(v)))

    const cloned = {}
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key])
        }
    }
    return cloned
}

/**
 * 深度合并对象
 * @param {Object} target - 目标对象
 * @param {...Object} sources - 源对象
 * @returns {Object}
 */
export function deepMerge(target, ...sources) {
    if (!sources.length) return target
    const source = sources.shift()

    if (isPlainObject(target) && isPlainObject(source)) {
        for (const key in source) {
            if (isPlainObject(source[key])) {
                if (!target[key]) Object.assign(target, { [key]: {} })
                deepMerge(target[key], source[key])
            } else {
                Object.assign(target, { [key]: source[key] })
            }
        }
    }
    return deepMerge(target, ...sources)
}

/**
 * 检查是否为纯对象
 * @param {*} obj
 * @returns {boolean}
 */
export function isPlainObject(obj) {
    return obj !== null && typeof obj === 'object' && obj.constructor === Object
}

/**
 * 防抖函数
 * @param {Function} fn - 目标函数
 * @param {number} wait - 等待时间
 * @returns {Function}
 */
export function debounce(fn, wait) {
    let timeout
    return function (...args) {
        clearTimeout(timeout)
        timeout = setTimeout(() => fn.apply(this, args), wait)
    }
}

/**
 * 节流函数
 * @param {Function} fn - 目标函数
 * @param {number} limit - 时间限制
 * @returns {Function}
 */
export function throttle(fn, limit) {
    let inThrottle
    return function (...args) {
        if (!inThrottle) {
            fn.apply(this, args)
            inThrottle = true
            setTimeout(() => (inThrottle = false), limit)
        }
    }
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @param {number} [decimals=2] - 小数位
 * @returns {string}
 */
export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
}

/**
 * 格式化持续时间
 * @param {number} ms - 毫秒数
 * @returns {string}
 */
export function formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
    return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
}

/**
 * 提取错误信息
 * @param {*} error - 错误对象
 * @returns {string}
 */
export function extractErrorMessage(error) {
    if (!error) return 'Unknown error'
    if (typeof error === 'string') return error
    if (error.message) return error.message
    if (error.error?.message) return error.error.message
    return String(error)
}

/**
 * 并行执行，限制并发数
 * @param {Array} items - 待处理项
 * @param {Function} fn - 处理函数
 * @param {number} [concurrency=5] - 并发数
 * @returns {Promise<Array>}
 */
export async function parallelLimit(items, fn, concurrency = 5) {
    const results = []
    const executing = new Set()

    for (const [index, item] of items.entries()) {
        const promise = Promise.resolve().then(() => fn(item, index))
        results.push(promise)
        executing.add(promise)

        promise.finally(() => executing.delete(promise))

        if (executing.size >= concurrency) {
            await Promise.race(executing)
        }
    }

    return Promise.all(results)
}

/**
 * 带超时的 Promise
 * @param {Promise} promise - 原始 Promise
 * @param {number} ms - 超时时间
 * @param {string} [message='Operation timed out'] - 超时消息
 * @returns {Promise}
 */
export function withTimeout(promise, ms, message = 'Operation timed out') {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
    return Promise.race([promise, timeout])
}

/**
 * 首字母大写
 * @param {string} str
 * @returns {string}
 */
export function capitalize(str) {
    if (!str) return ''
    return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * 转换为驼峰命名
 * @param {string} str
 * @returns {string}
 */
export function toCamelCase(str) {
    return str.replace(/[-_](\w)/g, (_, c) => c.toUpperCase())
}

/**
 * 转换为下划线命名
 * @param {string} str
 * @returns {string}
 */
export function toSnakeCase(str) {
    return str
        .replace(/([A-Z])/g, '_$1')
        .toLowerCase()
        .replace(/^_/, '')
}

/**
 * 插件开发者 QQ 号列表（全局唯一定义）
 * @type {readonly number[]}
 */
export const PLUGIN_DEVELOPERS = Object.freeze([1018037233, 2173302144])
