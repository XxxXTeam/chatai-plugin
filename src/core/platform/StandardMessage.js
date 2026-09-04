/**
 * @fileoverview Yunzai 标准消息段构造与遗留结构归一化。
 * @module core/platform/StandardMessage
 */

/**
 * 调用 Yunzai 全局消息段工厂；独立运行时使用精确等价的回退值。
 * @param {string} name - 消息段工厂名
 * @param {Array} args - 工厂参数
 * @param {Function} fallback - 回退构造器
 * @returns {Object} 标准消息段
 */
function makeNativeSegment(name, args, fallback) {
    const nativeFactory = globalThis.segment?.[name]
    if (typeof nativeFactory === 'function') return nativeFactory(...args)
    return fallback(...args)
}

/** Yunzai 标准消息段工厂。 */
export const StandardMessage = Object.freeze({
    custom(type, data = {}) {
        return makeNativeSegment('custom', [type, data], (segmentType, segmentData) => ({
            type: segmentType,
            ...segmentData
        }))
    },
    raw(data) {
        return makeNativeSegment('raw', [data], value => ({ type: 'raw', data: value }))
    },
    text(text) {
        return { type: 'text', text: String(text) }
    },
    at(userId, name) {
        return makeNativeSegment('at', [userId, name], (qq, displayName) => ({
            type: 'at',
            qq,
            ...(displayName ? { name: displayName } : {})
        }))
    },
    image(file, name) {
        return makeNativeSegment('image', [file, name], (value, displayName) => ({
            type: 'image',
            file: value,
            ...(displayName ? { name: displayName } : {})
        }))
    },
    record(file, name) {
        return makeNativeSegment('record', [file, name], (value, displayName) => ({
            type: 'record',
            file: value,
            ...(displayName ? { name: displayName } : {})
        }))
    },
    video(file, name) {
        return makeNativeSegment('video', [file, name], (value, displayName) => ({
            type: 'video',
            file: value,
            ...(displayName ? { name: displayName } : {})
        }))
    },
    file(file, name) {
        return makeNativeSegment('file', [file, name], (value, displayName) => ({
            type: 'file',
            file: value,
            ...(displayName ? { name: displayName } : {})
        }))
    },
    reply(id, text, qq, time, seq) {
        return makeNativeSegment(
            'reply',
            [id, text, qq, time, seq],
            (messageId, replyText, userId, timestamp, sequence) => ({
                type: 'reply',
                id: messageId,
                text: replyText,
                qq: userId,
                time: timestamp,
                seq: sequence
            })
        )
    },
    face(id, text) {
        return { type: 'face', id: Number(id), ...(text ? { text } : {}) }
    },
    json(data) {
        return { type: 'json', data: typeof data === 'string' ? data : JSON.stringify(data) }
    },
    xml(data) {
        return { type: 'xml', data: String(data) }
    },
    markdown(data) {
        return makeNativeSegment('markdown', [data], value => ({ type: 'markdown', data: value }))
    },
    button(...data) {
        return makeNativeSegment('button', data, (...buttons) => ({ type: 'button', data: buttons }))
    },
    keyboard(data) {
        return { type: 'keyboard', data }
    },
    node(data, title) {
        return { type: 'node', data, ...(title ? { title } : {}) }
    },
    nodeItem(userId, nickname, message, time) {
        return {
            user_id: userId,
            nickname: nickname || String(userId),
            message: normalizeStandardMessage(message),
            ...(time ? { time } : {})
        }
    },
    forward(id) {
        return { type: 'forward', id }
    },
    music(type, idOrData) {
        return type === 'custom'
            ? { type: 'music', music_type: type, ...(idOrData || {}) }
            : { type: 'music', music_type: type, id: String(idOrData) }
    },
    location(lat, lon, title, content) {
        return { type: 'location', lat, lon, ...(title ? { title } : {}), ...(content ? { content } : {}) }
    },
    share(url, title, content, image) {
        return { type: 'share', url, title, ...(content ? { content } : {}), ...(image ? { image } : {}) }
    },
    mface(emojiPackageId, emojiId, key, summary) {
        return {
            type: 'mface',
            emoji_package_id: emojiPackageId,
            emoji_id: emojiId,
            ...(key ? { key } : {}),
            ...(summary ? { summary } : {})
        }
    },
    poke(type, id) {
        return { type: 'poke', poke_type: type, id }
    },
    dice() {
        return { type: 'dice' }
    },
    rps() {
        return { type: 'rps' }
    },
    shake() {
        return { type: 'shake' }
    }
})

/**
 * 将兼容层遗留的 OneBot `data` 包装转换为 Yunzai 扁平消息段。
 * @param {*} segment - 输入消息段
 * @returns {*} 标准消息段
 */
export function normalizeStandardSegment(segment) {
    if (segment === null || segment === undefined) return segment
    if (typeof segment !== 'object') return StandardMessage.text(segment)
    if (!segment.type) return segment
    if (segment.type === 'text') {
        return StandardMessage.text(segment.text ?? segment.data?.text ?? '')
    }
    if (segment.type === 'node') {
        const nodeData = Array.isArray(segment.data)
            ? segment.data
            : Array.isArray(segment.data?.data)
              ? segment.data.data
              : Array.isArray(segment.data?.messages)
                ? segment.data.messages
                : null
        if (nodeData) {
            return StandardMessage.node(
                nodeData.map(node => ({
                    ...node,
                    message: normalizeStandardMessage(node.message ?? node.content ?? '')
                })),
                segment.title
            )
        }
    }
    if (segment.type === 'raw' || segment.type === 'markdown' || segment.type === 'button') return { ...segment }
    const wrapped = segment.data
    if (wrapped && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
        const direct = { ...segment }
        delete direct.data
        return { ...direct, ...wrapped, type: segment.type }
    }
    return { ...segment }
}

/**
 * 将任意消息内容转换为 Yunzai 标准消息段数组。
 * @param {*} message - 输入消息
 * @returns {Array} 标准消息段数组
 */
export function normalizeStandardMessage(message) {
    const source = Array.isArray(message) ? message : [message]
    return source.filter(item => item !== null && item !== undefined).map(item => normalizeStandardSegment(item))
}

function withoutUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

/**
 * 将标准转发节点或既有 OneBot node 段序列化为精确的 OneBot node 结构。
 * @param {Object} node - 标准节点、OneBot node 段或 node.data
 * @returns {{type:'node',data:Object}} OneBot node 段
 */
export function serializeOneBotForwardNode(node) {
    const source = node?.type === 'node' && node?.data && !Array.isArray(node.data) ? node.data : node || {}
    const rest = { ...source }
    const message = rest.message
    const content = rest.content
    const userId = rest.user_id
    const nickname = rest.nickname
    const uin = rest.uin
    const name = rest.name
    for (const key of ['message', 'content', 'user_id', 'nickname', 'uin', 'name', 'type', 'data']) delete rest[key]
    return {
        type: 'node',
        data: withoutUndefined({
            ...rest,
            uin: uin ?? userId,
            name: name ?? nickname,
            content: serializeOneBotMessage(content ?? message ?? '')
        })
    }
}

/**
 * 在 OneBot 原始 action 边界把 Yunzai 扁平段序列化为 `{type,data}`。
 * @param {*} segment - 标准消息段
 * @returns {Object} OneBot 消息段
 */
export function serializeOneBotSegment(segment) {
    if (segment?.type === 'node' && segment?.data && !Array.isArray(segment.data)) {
        return serializeOneBotForwardNode(segment)
    }
    const normalized = normalizeStandardSegment(segment)
    if (!normalized || typeof normalized !== 'object') return { type: 'text', data: { text: String(normalized ?? '') } }
    if (normalized.type === 'node') {
        return {
            type: 'node',
            data: (normalized.data || []).map(node => serializeOneBotForwardNode(node).data)
        }
    }
    if (normalized.type === 'raw') return { type: 'raw', data: normalized.data }
    if (normalized.type === 'music') {
        const data = { ...normalized }
        delete data.type
        const musicType = data.music_type
        delete data.music_type
        return { type: 'music', data: withoutUndefined({ type: musicType, ...data }) }
    }
    if (normalized.type === 'poke') {
        const data = { ...normalized }
        delete data.type
        const pokeType = data.poke_type
        delete data.poke_type
        return { type: 'poke', data: withoutUndefined({ type: pokeType, ...data }) }
    }
    if (normalized.type === 'markdown' || normalized.type === 'button' || normalized.type === 'keyboard') {
        return { type: normalized.type, data: normalized.data }
    }
    const { type, ...data } = normalized
    return { type, data: withoutUndefined(data) }
}

/**
 * 序列化 OneBot 消息段数组。
 * @param {*} message - 标准消息内容
 * @returns {Array<Object>} OneBot 消息段数组
 */
export function serializeOneBotMessage(message) {
    const source = Array.isArray(message) ? message : [message]
    return source.filter(item => item !== null && item !== undefined).map(serializeOneBotSegment)
}
