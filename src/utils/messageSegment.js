/**
 * @fileoverview 消息分段发送工具
 * @module utils/messageSegment
 * @description 智能分割长消息，保留CQ码和emoji完整性
 */

/**
 * 智能分割消息
 * 保留CQ码和emoji的完整性，按标点符号智能分段
 *
 * @param {string} text - 原始文本
 * @param {Object} options - 分割选项
 * @param {number} options.idealLength - 理想段落长度（默认300）
 * @param {number} options.maxSegments - 最大分段数（默认5）
 * @returns {string[]} 分割后的文本数组
 */
export function splitMessage(text, options = {}) {
    const { idealLength = 300, maxSegments = 5 } = options

    if (!text || text.length <= idealLength) {
        return [text]
    }

    const punctuations = ['。', '！', '？', '；', '!', '?', ';', '\n']

    // 保护CQ码和emoji
    const cqCodes = []
    const emojis = []
    let processed = text

    // 提取并替换CQ码
    processed = processed.replace(/\[CQ:[^\]]+\]/g, match => {
        cqCodes.push(match)
        return `{{CQ${cqCodes.length - 1}}}`
    })

    // 提取并替换emoji
    processed = processed.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, match => {
        emojis.push(match)
        return `{{E${emojis.length - 1}}}`
    })

    // 保护省略号
    processed = processed.replace(/\.{3,}|…+/g, '{{...}}')

    // 计算理想分段长度
    const targetLength =
        processed.length <= idealLength * maxSegments ? idealLength : Math.ceil(processed.length / maxSegments)

    // 查找分割点
    const splitPoints = []
    let lastSplit = 0

    for (let i = 0; i < processed.length; i++) {
        if (punctuations.includes(processed[i]) && i - lastSplit >= targetLength * 0.7) {
            splitPoints.push(i + 1)
            lastSplit = i + 1
        }
    }

    // 根据分割点分段
    const segments = []
    let start = 0
    for (const point of splitPoints) {
        if (point > start) {
            segments.push(processed.slice(start, point))
            start = point
        }
    }
    if (start < processed.length) {
        segments.push(processed.slice(start))
    }

    // 还原保护的内容
    return segments
        .map(segment =>
            segment
                .replace(/\{\{\.\.\.\}\}/g, '...')
                .replace(/\{\{CQ(\d+)\}\}/g, (_, i) => cqCodes[parseInt(i)] || '')
                .replace(/\{\{E(\d+)\}\}/g, (_, i) => emojis[parseInt(i)] || '')
                .trim()
        )
        .filter(s => s.length > 0)
}

/**
 * 将文本分割为句子（用于按句输出）
 *
 * @param {string} text - 原始文本
 * @param {Object} options - 分割选项
 * @param {number} options.minLength - 最小句子长度（默认10）
 * @returns {string[]} 句子数组
 */
export function splitIntoSentences(text, options = {}) {
    const { minLength = 10 } = options

    if (!text) return []

    // 按换行分割
    const lines = text.split(/\n+/)
    const sentences = []

    for (const line of lines) {
        if (!line.trim()) continue

        // 按句末标点分割
        const parts = line.split(/(?<=[。！？!?.…])\s*/)

        for (const part of parts) {
            const trimmed = part.trim()
            if (trimmed) sentences.push(trimmed)
        }
    }

    // 合并过短的句子
    const merged = []
    let buffer = ''

    for (const s of sentences) {
        if (buffer.length + s.length < minLength && buffer) {
            buffer += s
        } else {
            if (buffer) merged.push(buffer)
            buffer = s
        }
    }
    if (buffer) merged.push(buffer)

    return merged.length > 0 ? merged : [text]
}

/**
 * 计算发送延迟（模拟人类打字速度）
 *
 * @param {string} text - 文本内容
 * @param {Object} options - 延迟选项
 * @param {number} options.baseDelay - 基础延迟（毫秒，默认300）
 * @param {number} options.charDelay - 每字符延迟（毫秒，默认5）
 * @param {number} options.maxDelay - 最大延迟（毫秒，默认3000）
 * @param {boolean} options.random - 是否添加随机因素（默认true）
 * @returns {number} 延迟毫秒数
 */
export function calculateDelay(text, options = {}) {
    const { baseDelay = 300, charDelay = 5, maxDelay = 3000, random = true } = options

    let delay = baseDelay + text.length * charDelay

    if (random) {
        delay += Math.random() * 500
    }

    return Math.min(delay, maxDelay)
}

/**
 * 分段发送消息
 *
 * @param {Object} e - Yunzai事件对象
 * @param {string} text - 要发送的文本
 * @param {Object} options - 发送选项
 * @param {boolean} options.quote - 是否引用（仅第一条）
 * @param {number} options.recallDelay - 撤回延迟（秒，0表示不撤回）
 * @param {boolean} options.segmented - 是否分段发送
 * @param {Function} options.onSegmentSent - 每段发送后的回调
 * @returns {Promise<{messageIds: string[], lastMessageId: string|null}>}
 */
export async function sendSegmentedMessage(e, text, options = {}) {
    const { quote = false, recallDelay = 0, segmented = true, onSegmentSent } = options

    const messageIds = []
    let lastMessageId = null

    if (!segmented || text.length <= 300) {
        // 不分段，直接发送
        const result = await e.reply(text, quote)
        lastMessageId = result?.message_id
        if (lastMessageId) messageIds.push(lastMessageId)
    } else {
        // 分段发送
        const segments = splitMessage(text)

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i]
            if (!segment.trim()) continue

            const shouldQuote = quote && i === 0
            const result = await e.reply(segment, shouldQuote)

            const msgId = result?.message_id
            if (msgId) {
                messageIds.push(msgId)
                lastMessageId = msgId
            }

            if (onSegmentSent) {
                onSegmentSent(i, segments.length, msgId)
            }

            // 段间延迟
            if (i < segments.length - 1) {
                const delay = calculateDelay(segment)
                await new Promise(r => setTimeout(r, delay))
            }
        }
    }

    return { messageIds, lastMessageId }
}

export default {
    splitMessage,
    splitIntoSentences,
    calculateDelay,
    sendSegmentedMessage
}
