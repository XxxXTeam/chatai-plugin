/**
 * 通用工具函数
 * 从 utils/common.js 迁移
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
