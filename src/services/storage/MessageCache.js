import { isQQBotInstance } from '../../core/platform/StandardBotIdentity.js'

const MESSAGE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const MESSAGE_CACHE_MAX = 9999

/** @type {Map<string, Set<string|number>>} */
const groupMessageIndex = new Map()
/** @type {Map<string, Set<string|number>>} */
const qqbotGroupMessageIndex = new Map()
/** @type {WeakSet<Object>} */
const registeredBots = new WeakSet()

class MessageCacheMap extends Map {
    clear() {
        super.clear()
        groupMessageIndex.clear()
        qqbotGroupMessageIndex.clear()
    }

    delete(messageId) {
        const cached = this.get(messageId)
        const deleted = super.delete(messageId)
        if (deleted && cached) removeMessageFromIndexes(messageId, cached)
        return deleted
    }
}

/** @type {Map<string|number, Object>} */
export const messageCache = new MessageCacheMap()

function getGroupIdentityValues(value) {
    if (value === null || value === undefined || value === '') return []
    if (typeof value !== 'object') return [String(value)]

    return [value.group_id, value._raw_group_id, value.group?.group_id, value.group?._raw_group_id]
        .filter(item => item !== undefined && item !== null && item !== '')
        .map(String)
        .filter((item, index, values) => values.indexOf(item) === index)
}

function removeMessageFromIndexes(messageId, cacheData) {
    for (const groupId of getGroupIdentityValues(cacheData)) {
        const messageIds = groupMessageIndex.get(groupId)
        messageIds?.delete(messageId)
        if (messageIds?.size === 0) groupMessageIndex.delete(groupId)

        if (cacheData.isQQBot) {
            const qqbotMessageIds = qqbotGroupMessageIndex.get(groupId)
            qqbotMessageIds?.delete(messageId)
            if (qqbotMessageIds?.size === 0) qqbotGroupMessageIndex.delete(groupId)
        }
    }
}

function pruneMessageCache() {
    if (messageCache.size <= MESSAGE_CACHE_MAX) return

    const now = Date.now()
    for (const [messageId, cacheData] of messageCache) {
        if (now - cacheData.time > MESSAGE_CACHE_TTL || messageCache.size > MESSAGE_CACHE_MAX) {
            messageCache.delete(messageId)
        }
    }
}

function getMessageContent(message, rawMessage) {
    if (rawMessage) return rawMessage
    if (!Array.isArray(message)) return ''

    return message
        .map(segment => {
            const data = segment?.data && typeof segment.data === 'object' ? segment.data : segment
            if (segment?.type === 'text') return data?.text || ''
            if (segment?.type === 'at') return data?.qq === 'all' || data?.qq === 0 ? '@全体成员' : `@${data?.qq || ''}`
            if (segment?.type === 'image') return '[图片]'
            if (segment?.type === 'forward' || segment?.type === 'node') return '[转发消息]'
            if (segment?.type === 'file') return `[文件${data?.name ? `: ${data.name}` : ''}]`
            if (segment?.type === 'record' || segment?.type === 'audio') return '[语音]'
            if (segment?.type === 'video') return '[视频]'
            return ''
        })
        .join('')
}

/**
 * 缓存一条消息，并为群消息的 group_id 与 _raw_group_id 建立同一消息索引。
 * @param {Object} event - Yunzai 群消息事件
 * @returns {void}
 */
export function cacheGroupMessage(event) {
    if (!event?.message_id || getGroupIdentityValues(event).length === 0) return
    cacheMessage(event, isQQBotInstance(event))
}

/**
 * 缓存一条 QQBot 收到的消息。
 *
 * QQBot 的群消息同时写入公开群号与 _raw_group_id 两个索引；私聊消息
 * 至少写入 message_id 索引，供引用消息直接读取。
 * @param {Object} event - QQBot 消息事件
 * @returns {void}
 */
export function cacheQQBotMessage(event) {
    if (!isQQBotInstance(event) || !event?.message_id) return
    cacheMessage(event, true)
}

/**
 * 写入消息缓存和对应索引。
 * @param {Object} event - Yunzai 消息事件
 * @param {boolean} isQQBot - 是否为 QQBot 消息
 * @returns {void}
 */
function cacheMessage(event, isQQBot) {
    const groupIds = getGroupIdentityValues(event)

    const previous = messageCache.get(event.message_id)
    if (previous) removeMessageFromIndexes(event.message_id, previous)

    const cacheData = {
        message: event.message,
        raw_message: event.raw_message || event.msg,
        time: Date.now(),
        timestamp: typeof event.time === 'number' ? event.time * 1000 : Date.now(),
        message_time: typeof event.time === 'number' ? event.time : Math.floor(Date.now() / 1000),
        user_id: event.user_id,
        group_id: event.group_id || event.group?.group_id,
        _raw_group_id: event._raw_group_id || event.group?._raw_group_id,
        sender: event.sender,
        message_type: event.message_type,
        isQQBot
    }

    messageCache.set(event.message_id, cacheData)
    for (const groupId of groupIds) {
        if (!groupMessageIndex.has(groupId)) groupMessageIndex.set(groupId, new Set())
        groupMessageIndex.get(groupId).add(event.message_id)
        if (isQQBot) {
            if (!qqbotGroupMessageIndex.has(groupId)) qqbotGroupMessageIndex.set(groupId, new Set())
            qqbotGroupMessageIndex.get(groupId).add(event.message_id)
        }
    }

    pruneMessageCache()
}

/**
 * 按消息 ID 获取未过期缓存。
 * @param {string|number} messageId - 消息 ID
 * @returns {Object|null} 缓存消息
 */
export function getCachedMessage(messageId) {
    const cached = messageCache.get(messageId)
    if (!cached) return null
    if (Date.now() - cached.time >= MESSAGE_CACHE_TTL) {
        messageCache.delete(messageId)
        removeMessageFromIndexes(messageId, cached)
        return null
    }
    return cached
}

/**
 * 获取指定群标识对应的最近消息。
 * @param {string|number} groupId - 群号或 QQBot OpenID
 * @param {number} limit - 最大数量
 * @returns {Array<Object>} 最近消息
 */
export function getRecentGroupMessages(groupId, limit = 30) {
    return getRecentMessagesFromIndex(groupMessageIndex, [groupId], limit)
}

/**
 * 直接从 QQBot 群消息索引读取上下文。
 * @param {string|number} groupId - 公开群号或 QQBot OpenID
 * @param {number} limit - 最大数量
 * @param {string|number} [rawGroupId] - 另一份已确认的 QQBot 群标识
 * @returns {Array<Object>} 最近消息
 */
export function getRecentQQBotMessages(groupId, limit = 30, rawGroupId) {
    return getRecentMessagesFromIndex(qqbotGroupMessageIndex, [groupId, rawGroupId], limit)
}

/**
 * 从消息索引读取并去重。
 * @param {Map<string, Set<string|number>>} index - 消息索引
 * @param {Array<string|number>} groupIds - 群标识
 * @param {number} limit - 最大数量
 * @returns {Array<Object>} 最近消息
 */
function getRecentMessagesFromIndex(index, groupIds, limit) {
    const messageIds = new Set(
        groupIds
            .filter(value => value !== undefined && value !== null && value !== '')
            .flatMap(value => [...(index.get(String(value)) || [])])
    )
    if (!messageIds || messageIds.size === 0) return []

    const messages = []
    for (const messageId of messageIds) {
        const cached = getCachedMessage(messageId)
        if (!cached) continue
        messages.push({
            messageId,
            message_id: messageId,
            userId: cached.user_id,
            nickname: cached.sender?.nickname || cached.sender?.card || '',
            content: getMessageContent(cached.message, cached.raw_message),
            time: cached.time,
            timestamp: cached.timestamp || cached.time,
            message_time: cached.message_time || Math.floor((cached.timestamp || cached.time) / 1000),
            message: cached.message,
            sender: cached.sender,
            group_id: cached.group_id,
            _raw_group_id: cached._raw_group_id,
            groupId: cached.group_id,
            rawGroupId: cached._raw_group_id
        })
    }

    return messages.sort((left, right) => left.time - right.time).slice(-limit)
}

/**
 * 获取指定群标识的缓存消息数量。
 * @param {string|number} groupId - 群号或 QQBot OpenID
 * @returns {number} 消息数量
 */
export function getGroupMessageCount(groupId) {
    return groupMessageIndex.get(String(groupId))?.size || 0
}

/**
 * 注册 QQBot 的最早消息事件监听。
 *
 * Yunzai 的 message 监听器由插件加载阶段之后才注册；在插件入口调用本函数，
 * 可以在消息进入普通应用处理之前建立本地记录。
 * @param {Object} [bot=globalThis.Bot] - Yunzai Bot 容器
 * @returns {boolean} 是否完成注册
 */
export function registerQQBotMessageCache(bot = globalThis.Bot) {
    if (!bot || typeof bot.on !== 'function' || registeredBots.has(bot)) return false
    bot.on('message', cacheQQBotMessage)
    registeredBots.add(bot)
    return true
}
