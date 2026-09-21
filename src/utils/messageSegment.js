/**
 * @fileoverview 拟人化消息分段发送工具（统一版）。
 * @module utils/messageSegment
 * @description
 */

/**
 * 标点断点级。数字越小优先级越高，越优先作为分段点。
 * 级别 0 为段落边界（连续空行）与发言头行边界（动态探测）。
 * @type {Array<{level: number, chars: Set<string>}>}
 */
const BREAK_LEVELS = [
    { level: 1, chars: new Set(['\n']) },
    { level: 2, chars: new Set(['。', '！', '？', '!', '?', '…']) },
    { level: 3, chars: new Set(['；', ';', '：', ':']) },
    { level: 4, chars: new Set(['，', ',', '、']) },
    { level: 5, chars: new Set([' ']) }
]

/** @type {Map<string, number>} 字符 -> 断点级别 */
const CHAR_LEVEL = new Map()
for (const group of BREAK_LEVELS) {
    for (const char of group.chars) CHAR_LEVEL.set(char, group.level)
}

/**
 * 发言头行：QQ 聊天记录复制体中常见的「昵称: 日期 时间」
 * （如 `我是残花: 09-20 22:19:45`），兼容四位年份与斜杠分隔。
 * @type {RegExp}
 */
const UTTERANCE_HEAD_RE = /^[^\n:：]{0,16}[:：]\s*(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{2}-\d{2})\s+\d{1,2}:\d{2}:\d{2}/

/**
 * 提取 CQ 码并替换为占位符，避免分段时切开 `[CQ:...]`。
 * @param {string} text - 原始文本
 * @param {string[]} cqStore - 用于回收 CQ 码的数组
 * @returns {string} 占位后的文本
 */
function shieldCqCodes(text, cqStore) {
    return text.replace(/\[CQ:[^\]]+\]/g, match => {
        cqStore.push(match)
        return `{{CQ${cqStore.length - 1}}}`
    })
}

/**
 * 还原被占位的 CQ 码。
 * @param {string} text - 含占位符的文本
 * @param {string[]} cqStore - CQ 码回收数组
 * @returns {string} 还原后的文本
 */
function restoreCqCodes(text, cqStore) {
    return text.replace(/\{\{CQ(\d+)\}\}/g, (_, index) => cqStore[parseInt(index, 10)] || '')
}

/**
 * 按发言头行把文本切成发言单元。
 * 每个单元以「昵称: 日期时间」头行开头（首个块可能没有头行），
 * 头行与其正文、后续同发言的行永不分离。
 * @param {string} text - 原文（CQ 码已占位）
 * @returns {string[]} 发言单元数组（已 trim）
 */
function splitByUtteranceHeads(text) {
    const units = []
    const lines = text.split('\n')
    let current = null

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (UTTERANCE_HEAD_RE.test(line.trim())) {
            // 头行：结束上一个单元，开始新单元
            if (current !== null && current.trim()) units.push(current)
            current = line
            continue
        }
        if (current === null) {
            current = line
            continue
        }
        /*
         * 非头行一律追加。QQ 复制体里没有任何「段落空隙」语义：
         * 空白行也是上一条发言的一部分，绝不能当作丢弃的噪声。
         * 头行自带的时间戳才是发言边界。
         */
        current += '\n' + line
    }
    if (current !== null && current.trim()) units.push(current)
    return units
}

/**
 * 扫描全文的保护区间（代码围栏、行内代码、URL），区间内禁止分段。
 * @param {string} text - 原文（CQ 码已占位）
 * @returns {Array<{start: number, end: number}>} 保护区间（左闭右开）
 */
function buildProtectedRanges(text) {
    const ranges = []
    const push = (start, end) => {
        if (end - start > 0) ranges.push({ start, end })
    }
    // 反引号围栏与行内代码
    for (let i = 0; i < text.length;) {
        const fence = text.indexOf('```', i)
        if (fence === -1) {
            const inline = text.indexOf('`', i)
            if (inline === -1) break
            const close = text.indexOf('`', inline + 1)
            push(inline, close === -1 ? text.length : close + 1)
            if (close === -1) break
            i = close + 1
            continue
        }
        const close = text.indexOf('```', fence + 3)
        push(fence, close === -1 ? text.length : close + 3)
        if (close === -1) break
        i = close + 3
    }
    // URL（含 http/https/www 前缀，容忍后随的右括号与句末标点）
    const urlRe = /(?:https?:\/\/|www\.)[^\s，。！？；、""''<>]+/g
    let match
    while ((match = urlRe.exec(text)) !== null) {
        let end = match.index + match[0].length
        if (text[end] === ')' || text[end] === '。' || text[end] === '，') end += 1
        push(match.index, end)
    }
    return ranges
}

/** @type {Map<string, Array<{start: number, end: number}>>} 保护区间缓存 */
const protectedRangesCache = new Map()
const MAX_PROTECTED_RANGES_CACHE = 64

/**
 * 取文本保护区间（带小缓存，长文本常被重复拆分）。
 * @param {string} text - 原文（CQ 码已占位）
 * @returns {Array<{start: number, end: number}>} 保护区间
 */
function getProtectedRanges(text) {
    const cached = protectedRangesCache.get(text)
    if (cached) return cached
    const ranges = buildProtectedRanges(text)
    protectedRangesCache.set(text, ranges)
    if (protectedRangesCache.size > MAX_PROTECTED_RANGES_CACHE) {
        protectedRangesCache.delete(protectedRangesCache.keys().next().value)
    }
    return ranges
}

/**
 * 收集全文的可分段位置（已剔除保护区间与 emoji 代理对），
 * 返回按位置升序排列的断点列表。
 * @param {string} text - 原文（CQ 码已占位）
 * @param {Array<{start: number, end: number}>} ranges - 保护区间
 * @returns {Array<{pos: number, level: number}>} 断点列表
 */
function collectBreakPoints(text, ranges) {
    const points = []
    let rangeIndex = 0
    const len = text.length
    for (let i = 0; i < len; i++) {
        while (rangeIndex < ranges.length && ranges[rangeIndex].end <= i) rangeIndex += 1
        if (rangeIndex < ranges.length && i >= ranges[rangeIndex].start && i < ranges[rangeIndex].end) continue
        // 跳过 emoji 代理对的后半部分，避免切片截断字符
        const code = text.charCodeAt(i)
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < len) {
            i += 1
            continue
        }
        const level = CHAR_LEVEL.get(text[i])
        if (level === undefined) continue
        // 连续空行视为最高优先级断点（段落边界）
        const isParaGap = text[i] === '\n' && (text[i + 1] === '\n' || (i > 0 && text[i - 1] === '\n'))
        if (isParaGap) {
            points.push({ pos: i, level: 0 })
            continue
        }
        // 发言头行的行首：优先级高于一切普通断点，保证前一条发言完整收尾
        if (text[i] === '\n' && i + 1 < len) {
            const headMatch = UTTERANCE_HEAD_RE.exec(text.slice(i + 1, i + 41))
            if (headMatch) {
                points.push({ pos: i, level: 0 })
                i += headMatch[0].length
                continue
            }
        }
        points.push({ pos: i, level })
    }
    return points
}

/**
 * 在 [start + 半程目标, start + maxLen] 窗口内选择最优断点：
 * 先比级别（数字小者优先），同级比距目标片长更近者。
 * @param {Array<{pos: number, level: number}>} points - 全量断点
 * @param {number} start - 片段起点
 * @param {number} target - 目标片长
 * @param {number} maxLen - 片长硬上限
 * @returns {number|null} 断点位置（片段结束下标，含断点字符）或 null
 */
function pickBestBreak(points, start, target, maxLen) {
    const lowBound = start + Math.max(1, Math.floor(target * 0.5))
    const highBound = start + maxLen
    let best = null
    let bestDistance = Infinity
    for (const p of points) {
        if (p.pos < lowBound) continue
        if (p.pos >= highBound) break
        const distance = Math.abs(p.pos - (start + target))
        if (!best || p.level < best.level || (p.level === best.level && distance < bestDistance)) {
            best = p
            bestDistance = distance
        }
    }
    return best ? best.pos + 1 : null
}

/**
 * 兜底硬切：在 maxLen 窗口内回退到最近的半角空格，否则按位置直切。
 * 只在没有任何可用断点时触发，不会切断 URL 或代码。
 * @param {string} text - 待切全文
 * @param {number} start - 片段起点
 * @param {number} maxLen - 硬上限
 * @returns {number} 切分位置
 */
function hardCut(text, start, maxLen) {
    const window = text.slice(start, start + maxLen)
    const lastSpace = window.lastIndexOf(' ')
    return lastSpace > maxLen * 0.5 ? start + lastSpace + 1 : start + maxLen
}

/**
 * 单块文本的标点分段（发言单元已剥离头行语义，此处仅处理超长块）。
 * @param {string} block - 单个发言单元或普通文本块（CQ 码已占位）
 * @param {number} chunkSize - 目标片长
 * @param {number} maxChunk - 片长硬上限
 * @param {number} mergeThreshold - 短片段合并阈值
 * @returns {string[]} 分段结果
 */
function splitBlockByPunctuation(block, chunkSize, maxChunk, mergeThreshold) {
    if (block.length <= maxChunk) return block.trim() ? [block.trim()] : []
    const ranges = getProtectedRanges(block)
    const points = collectBreakPoints(block, ranges)
    const rawSegments = []
    let start = 0
    while (start < block.length) {
        const remaining = block.length - start
        if (remaining <= maxChunk) {
            rawSegments.push(block.slice(start))
            break
        }
        const cut = pickBestBreak(points, start, chunkSize, maxChunk) ?? hardCut(block, start, maxChunk)
        const safeCut = Math.max(cut, start + 1)
        // 断点字符（含换行）归前段；每段只做发送前的两端裁剪。
        rawSegments.push(block.slice(start, safeCut))
        start = safeCut
    }
    const merged = []
    for (const piece of rawSegments.map(s => s.trim()).filter(s => s)) {
        if (merged.length === 0) {
            merged.push(piece)
        } else if (
            piece.length <= mergeThreshold &&
            merged[merged.length - 1].length + piece.length <= maxChunk * 1.4
        ) {
            merged[merged.length - 1] += piece
        } else {
            merged.push(piece)
        }
    }
    return merged
}

/**
 * 将文本按语义分段，模拟真人逐条发消息的节奏：
 * - 短于 maxChunk 的文本原样返回单段；
 * - 文本若含 QQ 聊天记录式「昵称: 日期 时间」发言头，按发言单元分段：
 *   一条发言整体直发（协议上限内，超出才在句末标点处切），
 *   头行与正文、以及相邻两条发言永不粘连；
 * - 普通长文本在目标片长附近找最优断点（句末优先级最高）；
 * - 过短片段（≤ mergeThreshold）并入上一段（永不跨发言单元合并）；
 * - 无可用断点时才硬切（仅回退半角空格）。
 *
 * @param {string} text - 待分段文本（可为空）
 * @param {Object} options - 分段选项
 * @param {number} [options.chunkSize=60] - 目标片长（字符）
 * @param {number} [options.maxChunk=140] - 片长硬上限（真人观感档位）
 * @param {number} [options.mergeThreshold=12] - 短于该长度的片段并入上一条
 * @param {number} [options.utteranceLimit=3500] - 发言单元直发长度上限
 * @returns {string[]} 语义片段数组（已 trim，空段被剔除，CQ 码完整还原）
 */
export function splitMessage(text, options = {}) {
    const { chunkSize = 60, maxChunk = 140, mergeThreshold = 12, utteranceLimit = 3500 } = options
    if (typeof text !== 'string' || !text.trim()) return []

    const cqStore = []
    const shielded = shieldCqCodes(text, cqStore)
    const trimmed = shielded.trim()
    if (trimmed.length <= maxChunk) return [restoreCqCodes(trimmed, cqStore)]

    const utteranceUnits = splitByUtteranceHeads(trimmed)
    if (utteranceUnits.length > 1) {
        /*
         * 发言单元优先：单元内整体直发；超长单元回退标点分段。
         * 每条消息统一裁剪首尾空白（发送观感），单元边界由
         * 「昵称: 时间」头行天然标识，段间空白压掉可接受。
         */
        const blocks = []
        utteranceUnits.forEach((rawUnit, index) => {
            if (rawUnit.length > utteranceLimit) {
                for (const piece of splitBlockByPunctuation(rawUnit, chunkSize, maxChunk, mergeThreshold)) {
                    blocks.push(piece)
                }
            } else {
                blocks.push(index === 0 ? rawUnit.trimStart() : rawUnit)
            }
        })
        const lastIndex = blocks.length - 1
        if (lastIndex >= 0) blocks[lastIndex] = blocks[lastIndex].trimEnd()
        return blocks.filter(s => s && s.trim()).map(s => restoreCqCodes(s, cqStore))
    }

    const blocks = splitBlockByPunctuation(trimmed, chunkSize, maxChunk, mergeThreshold)
    return blocks.map(s => restoreCqCodes(s, cqStore))
}

/**
 * 按句拆分的兼容入口：同样以「发言单元」优先，普通文本按句末标点分段。
 * @param {string} text - 待拆分文本
 * @param {Object} options - 分段选项（同 splitMessage）
 * @returns {string[]} 句子数组
 */
export function splitIntoSentences(text, options = {}) {
    return splitMessage(text, { chunkSize: 36, maxChunk: 90, mergeThreshold: 8, utteranceLimit: 3500, ...options })
}

/**
 * 计算段间延迟（模拟真人回复节奏）。
 * 延迟 = 基础延迟 + 长度分量（随片段变长而增大，上限 1500ms）+ 随机抖动。
 *
 * @param {string} text - 刚发送的片段（用于估算"打字耗时"）
 * @param {Object} options - 延迟选项
 * @param {number} [options.baseDelay=400] - 基础延迟（毫秒）
 * @param {number} [options.charDelay=30] - 每字符附加延迟（毫秒）
 * @param {number} [options.maxDelay=4000] - 最大延迟（毫秒）
 * @returns {number} 延迟毫秒数
 */
export function calculateDelay(text, options = {}) {
    const { baseDelay = 400, charDelay = 30, maxDelay = 4000 } = options
    const lengthComponent = Math.min((typeof text === 'string' ? text.length : 0) * charDelay, 1500)
    const jitter = baseDelay * (0.5 + Math.random())
    return Math.min(baseDelay + lengthComponent + jitter, maxDelay)
}

/**
 * @param {string[]} segments - 分段结果
 * @returns {string[]} 剥离编号后的分段
 */
export function stripListNumbering(segments) {
    if (!Array.isArray(segments) || segments.length < 2) return segments
    const consumed = []
    let lastNumber = -1
    for (let i = 0; i < segments.length; i++) {
        const match = segments[i].match(/^\s*(\d+)\s*[.、)]\s*/)
        if (!match) return segments
        const number = Number(match[1])
        if (i > 0 && number !== lastNumber + 1) return segments
        lastNumber = number
        consumed.push(match[0].length)
    }
    return segments.map((segment, index) => segment.slice(consumed[index]))
}

/**
 * @param {Object} e - Yunzai 事件对象（需含 reply 方法）
 * @param {string} text - 待发送文本
 * @param {Object} options - 发送选项
 * @param {boolean} [options.quote=false] - 是否引用（仅第一条）
 * @param {number} [options.shortLimit=140] - 单条直发的长度上限
 * @param {number} [options.foldLimit=500] - 折叠阈值
 * @param {Function} [options.foldHandler] - 折叠回调，签名 (text) => Promise<boolean>
 * @param {number} [options.chunkSize=60] - 分段目标片长
 * @param {number} [options.maxChunk=140] - 分段硬上限
 * @param {Function} [options.onSegmentSent] - 每段发送后的回调 (index, total, messageId)
 * @param {Object} [options.replyOptions] - 透传给 e.reply 的第三参数
 * @returns {Promise<{messageIds: string[], lastMessageId: string|null, folded: boolean}>} 发送结果
 */
export async function sendSegmentedMessage(e, text, options = {}) {
    const {
        quote = false,
        shortLimit = 140,
        foldLimit = 500,
        foldHandler,
        chunkSize = 60,
        maxChunk = 140,
        onSegmentSent,
        replyOptions
    } = options

    const emptyResult = { messageIds: [], lastMessageId: null, folded: false }
    if (!e?.reply) return emptyResult
    if (typeof text !== 'string' || !text.trim()) return emptyResult
    const trimmed = text.trim()

    // 短回复：单条直发，不做任何切割
    if (trimmed.length <= shortLimit) {
        const result = await e.reply(trimmed, quote, replyOptions)
        const messageId = result?.message_id
        return {
            messageIds: messageId ? [messageId] : [],
            lastMessageId: messageId || null,
            folded: false
        }
    }

    // 超长回复：先尝试折叠（合并转发），失败回退逐条
    if (trimmed.length > foldLimit && typeof foldHandler === 'function') {
        try {
            const folded = await foldHandler(trimmed)
            if (folded) {
                return { messageIds: [], lastMessageId: null, folded: true }
            }
        } catch {
            /* 折叠失败，回退为逐条发送 */
        }
    }

    const segments = splitMessage(trimmed, { chunkSize, maxChunk })
    if (segments.length === 1) {
        const result = await e.reply(segments[0], quote, replyOptions)
        const messageId = result?.message_id
        return {
            messageIds: messageId ? [messageId] : [],
            lastMessageId: messageId || null,
            folded: false
        }
    }
    const polishedSegments = stripListNumbering(segments)

    const messageIds = []
    let lastMessageId = null
    for (let i = 0; i < polishedSegments.length; i++) {
        const result = await e.reply(polishedSegments[i], quote && i === 0, replyOptions)
        const messageId = result?.message_id
        if (messageId) {
            messageIds.push(messageId)
            lastMessageId = messageId
        }
        if (onSegmentSent) {
            onSegmentSent(i, polishedSegments.length, messageId)
        }
        if (i < polishedSegments.length - 1) {
            const delay = calculateDelay(polishedSegments[i])
            await new Promise(r => setTimeout(r, delay))
        }
    }
    return { messageIds, lastMessageId, folded: false }
}

export default {
    splitMessage,
    splitIntoSentences,
    calculateDelay,
    stripListNumbering,
    sendSegmentedMessage
}
