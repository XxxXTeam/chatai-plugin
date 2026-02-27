/**
 * 通用工具函数
 */
import path from 'path'
import { fileURLToPath } from 'url'
import config from '../../config/config.js'
import fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

const safeLog = {
    info: (...args) => (global.logger ? global.logger.info(...args) : console.log(...args)),
    warn: (...args) => (global.logger ? global.logger.warn(...args) : console.warn(...args))
}

/**
 * 计算 messages 数组的总文本字符数
 * @param {Array<{role: string, content: string|Array}>} msgs
 * @returns {number}
 */
function calcMessageChars(msgs) {
    return msgs.reduce((sum, msg) => {
        if (Array.isArray(msg.content)) {
            return sum + msg.content.reduce((s, c) => s + (c.text?.length || 0), 0)
        }
        return sum + (typeof msg.content === 'string' ? msg.content.length : 0)
    }, 0)
}

/**
 * 计算单条消息的文本字符数
 * @param {{content: string|Array}} msg
 * @returns {number}
 */
function calcSingleMsgChars(msg) {
    if (Array.isArray(msg.content)) {
        return msg.content.reduce((s, c) => s + (c.text?.length || 0), 0)
    }
    return typeof msg.content === 'string' ? msg.content.length : 0
}

/**
 * @function enforceMaxCharacters
 * @description 对 LLM messages 数组执行字符上限裁剪
 * @param {Array<{role: string, content: string|Array}>} messages - 消息数组
 * @param {number} maxCharacters - 字符上限，<=0 则不做任何处理
 * @param {string} [tag=''] - 日志标签
 * @returns {Array} 处理后的 messages（同一引用）
 */
export function enforceMaxCharacters(messages, maxCharacters, tag = '') {
    if (!maxCharacters || maxCharacters <= 0 || !messages || messages.length === 0) {
        return messages
    }

    const prefix = tag ? `[${tag}] ` : ''
    let totalChars = calcMessageChars(messages)
    if (totalChars <= maxCharacters) return messages

    const beforeCount = messages.length

    /* 第一步：移除历史消息 */
    while (totalChars > maxCharacters && messages.length > 2) {
        const firstHistoryIdx = messages[0]?.role === 'system' ? 1 : 0
        if (firstHistoryIdx >= messages.length - 1) break
        messages.splice(firstHistoryIdx, 1)
        totalChars = calcMessageChars(messages)
    }
    if (beforeCount !== messages.length) {
        safeLog.info(
            `${prefix}字符上限裁剪: ${beforeCount} -> ${messages.length} 条消息, 当前字符数: ${totalChars}/${maxCharacters}`
        )
    }

    /* 第二步：截断 system 提示词 */
    if (totalChars > maxCharacters) {
        const userMsgIdx = messages.length - 1
        const systemIdx = messages[0]?.role === 'system' ? 0 : -1
        const minUserChars = Math.min(500, maxCharacters)

        if (systemIdx >= 0) {
            const systemMsg = messages[systemIdx]
            const userMsgChars = calcSingleMsgChars(messages[userMsgIdx])
            const systemBudget = Math.max(0, maxCharacters - userMsgChars)

            if (Array.isArray(systemMsg.content)) {
                let systemChars = systemMsg.content.reduce((s, c) => s + (c.text?.length || 0), 0)
                if (systemChars > systemBudget) {
                    for (let i = systemMsg.content.length - 1; i >= 0 && systemChars > systemBudget; i--) {
                        const part = systemMsg.content[i]
                        if (part.type === 'text' && part.text) {
                            const excess = systemChars - systemBudget
                            if (excess >= part.text.length) {
                                systemChars -= part.text.length
                                part.text = ''
                            } else {
                                part.text =
                                    part.text.substring(0, part.text.length - excess) + '\n...(内容因字符上限被截断)'
                                systemChars = systemBudget
                            }
                        }
                    }
                    systemMsg.content = systemMsg.content.filter(c => c.text?.length > 0)
                    safeLog.info(`${prefix}system 提示词已截断至 ${systemBudget} 字符以满足上限`)
                }
            } else if (typeof systemMsg.content === 'string' && systemMsg.content.length > systemBudget) {
                systemMsg.content = systemMsg.content.substring(0, systemBudget) + '\n...(内容因字符上限被截断)'
                safeLog.info(`${prefix}system 提示词已截断至 ${systemBudget} 字符以满足上限`)
            }
            totalChars = calcMessageChars(messages)
        }

        /* 第三步：截断用户消息（最后手段） */
        if (totalChars > maxCharacters) {
            const userMsg = messages[userMsgIdx]
            const userChars = calcSingleMsgChars(userMsg)
            const userBudget = Math.max(minUserChars, maxCharacters - (totalChars - userChars))

            if (Array.isArray(userMsg.content)) {
                for (const part of userMsg.content) {
                    if (part.type === 'text' && part.text && part.text.length > userBudget) {
                        part.text = part.text.substring(0, userBudget) + '\n...(内容因字符上限被截断)'
                        break
                    }
                }
            } else if (typeof userMsg.content === 'string' && userMsg.content.length > userBudget) {
                userMsg.content = userMsg.content.substring(0, userBudget) + '\n...(内容因字符上限被截断)'
            }
            totalChars = calcMessageChars(messages)
            safeLog.info(`${prefix}用户消息已截断, 当前字符数: ${totalChars}/${maxCharacters}`)
        }
    }

    return messages
}

/**
 * 插件开发者 QQ 号列表（全局唯一定义）
 * @type {readonly number[]}
 */
export const PLUGIN_DEVELOPERS = Object.freeze([1018037233, 2173302144])
