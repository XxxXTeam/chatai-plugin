/**
 * @module utils/eventAdapter
 */
import { detectAdapter, getBot, getBotSelfId, getUserInfo } from './platformAdapter.js'
import { StandardBotApi } from '../core/platform/index.js'
export { getBot, getBotSelfId, detectAdapter }

/**
 * @deprecated 新代码请使用 StandardBotApi.callAction。
 * @param {Object} bot - Bot 实例
 * @param {string} action - API 名称
 * @param {Object} params - 参数
 * @returns {Promise<any>} 协议端结果
 */
export async function callOneBotApi(bot, action, params = {}) {
    return await new StandardBotApi({ bot }).callAction(action, params)
}

/**
 * @deprecated 新代码请使用 StandardBotApi.callAction(action, params, { strict: true })。
 * @param {Object} bot - Bot 实例
 * @param {string} action - API 名称
 * @param {Object} [params] - 参数
 * @returns {Promise<any>} 成功级别的返回值
 * @throws {Error} Bot 实例不可用、全部回退级别失败，或协议端返回业务错误
 */
export async function callOneBotApiStrict(bot, action, params = {}) {
    return await new StandardBotApi({ bot }).callAction(action, params, { strict: true })
}

/**
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 目标用户ID
 * @param {string|number} [groupId] - 群ID (群聊戳一戳)
 * @returns {Promise<boolean>} 是否成功
 */
/** @deprecated 请使用 StandardBotApi.pokeMember/pokeUser。 */
export async function sendPoke(e, userId, groupId = null) {
    const api = new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot })
    try {
        if (groupId || e?.group_id) await api.pokeMember(groupId || e.group_id, userId)
        else await api.pokeUser(userId)
        return true
    } catch (error) {
        logger.debug(`[EventAdapter] 发送戳一戳失败: ${error.message}`)
        return false
    }
}

/**
 * @param {Object} e - 事件对象
 * @param {string|number} messageId - 消息ID
 * @param {string|number} emojiId - 表情ID
 * @param {boolean} [isSet=true] - true为添加，false为取消
 * @param {number} [emojiType=1] - 表情类型: 1=QQ表情, 2=Unicode表情
 * @returns {Promise<boolean>}
 */
/** @deprecated 请使用 StandardBotApi.setReaction。 */
export async function sendReaction(e, messageId, emojiId, isSet = true, emojiType = 1) {
    try {
        await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).setReaction({
            messageId,
            emojiId,
            isSet,
            groupId: e?.group_id,
            sequence: e?.seq || e?.source?.seq,
            emojiType
        })
        return true
    } catch (error) {
        logger.debug(`[EventAdapter] 发送表情回应失败: ${error.message}`)
        return false
    }
}

/**
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @param {Object} [_bot] - 兼容保留的 Bot 实例参数
 * @returns {Promise<string>}
 */
export async function getUserNickname(e, userId, _bot = null) {
    void _bot
    if (!userId) return '未知用户'

    try {
        if (e?.nickname && e?.user_id == userId) {
            return e.nickname
        }
        if (e?.member && e?.user_id == userId) {
            const memberInfo = e.member
            if (memberInfo?.card || memberInfo?.nickname) {
                return memberInfo.card || memberInfo.nickname
            }
        }
        if (e?.sender?.user_id == userId) {
            if (e.sender.card) return e.sender.card
            if (e.sender.nickname) return e.sender.nickname
        }

        // 尝试从API获取
        const userInfo = await getUserInfo(e, userId, e?.group_id)
        if (userInfo?.card || userInfo?.nickname) {
            return userInfo.card || userInfo.nickname
        }

        return String(userId)
    } catch {
        return String(userId)
    }
}

/**
 * @param {Object} e - 事件对象
 * @param {Object} [bot] - Bot 实例
 * @returns {string}
 */
export function getGroupName(e, bot = null) {
    try {
        bot = bot || getBot(e)
        const groupId = e?.group_id
        if (!groupId) return '未知群'

        // 从缓存获取
        const groupInfo = bot?.gl?.get(groupId) || bot?.group_map?.get?.(groupId)
        if (groupInfo?.group_name) return groupInfo.group_name

        // 从事件获取
        if (e?.group_name) return e.group_name

        return String(groupId)
    } catch {
        return String(e?.group_id || '未知群')
    }
}

/**
 * 解析事件中的戳一戳信息 - 全适配器兼容
 * @param {Object} e - 事件对象
 * @returns {Object} { targetId, operatorId, isGroup }
 */
export function parsePokeEvent(e) {
    const selfId = getBotSelfId(e)

    // 被戳者 - 兼容多种属性名
    const targetId = e.target_id || e.poke_uid || e.target_uid || e.poked_uid || e.to_id

    // 操作者 - 兼容多种属性名
    const operatorId = e.operator_id || e.user_id || e.sender_id || e.from_id || e.action_uid

    // 是否群聊
    const isGroup = !!(e.group_id || e.discuss_id)

    return {
        targetId,
        operatorId,
        selfId,
        isGroup,
        groupId: e.group_id || e.discuss_id
    }
}

/**
 * 解析表情回应事件
 * @param {Object} e - 事件对象
 * @returns {Object}
 */
export function parseReactionEvent(e) {
    // TRSS-Yunzai reaction event fields
    let emojiId = e.id || e.emoji_id || e.face_id || e.code || e.emoji?.id || e.detail?.id
    if (!emojiId && Array.isArray(e.likes) && e.likes.length > 0) {
        emojiId = e.likes[0].emoji_id || e.likes[0].face_id || e.likes[0].id
    }
    if (!emojiId && e.detail) {
        emojiId = e.detail.emoji_id || e.detail.face_id || e.detail.id
    }
    if (!emojiId && e.data) {
        emojiId = e.data.emoji_id || e.data.face_id || e.data.id
    }

    const messageId = e.message_id || e.seq || e.msg_id || e.message_seq
    const userId = e.user_id || e.operator_id || e.sender_id
    const targetId = e.target_id || e.sender_id || e.target_user_id

    // isReaction字段: true=添加, false=移除
    const isAdd =
        e.isReaction !== false &&
        !(
            e.set === false ||
            e.set === 'remove' ||
            e.set === 0 ||
            e.sub_type === 'remove' ||
            e.sub_type === 'cancel' ||
            e.sub_type === 'delete' ||
            e.is_set === false ||
            e.is_set === 0 ||
            e.action === 'remove' ||
            e.action === 'cancel' ||
            e.operate === 'remove' ||
            e.operate === 'cancel' ||
            e.type === 'remove' ||
            e.type === 'cancel' ||
            e.count === 0
        )

    return {
        emojiId,
        messageId,
        userId,
        targetId,
        isAdd,
        groupId: e.group_id,
        likes: e.likes || [],
        raw: e // 保留原始事件用于调试
    }
}

/**
 * 解析撤回事件
 * @param {Object} e - 事件对象
 * @returns {Object}
 */
export function parseRecallEvent(e) {
    // 消息ID
    const messageId = e.message_id || e.msg_id || e.recall?.message_id

    // 消息序号
    const seq = e.seq || e.message_seq || e.recall?.seq || e.rand

    // 操作者 (撤回者)
    const operatorId = e.operator_id || e.recall?.operator_id

    // 原消息发送者
    const senderId = e.user_id || e.recall?.user_id || e.sender_id

    // 是否自己撤回自己的消息
    const isSelfRecall = operatorId === senderId

    return {
        messageId,
        seq,
        operatorId,
        senderId,
        isSelfRecall,
        groupId: e.group_id,
        time: e.time
    }
}

/**
 * 解析禁言事件 - 全适配器兼容
 * @param {Object} e - 事件对象
 * @returns {Object}
 */
export function parseBanEvent(e) {
    // 被禁言者
    const userId = e.user_id || e.target_id

    // 操作者
    const operatorId = e.operator_id || e.admin_id

    // 禁言时长(秒)，0 表示解禁
    const duration = e.duration || e.time || 0

    // 是否解禁
    const isLift = duration === 0 || e.sub_type === 'lift_ban' || e.sub_type === 'unban'

    return {
        userId,
        operatorId,
        duration,
        isLift,
        groupId: e.group_id,
        // 格式化时长文本
        durationText: isLift ? '解除禁言' : formatDuration(duration)
    }
}

/**
 * 解析入群/退群事件 - 全适配器兼容
 * @param {Object} e - 事件对象
 * @returns {Object}
 */
export function parseMemberChangeEvent(e) {
    // 变动的用户
    const userId = e.user_id || e.target_id

    // 操作者 (踢人时有)
    const operatorId = e.operator_id || e.admin_id

    // 事件类型
    let changeType = 'unknown'
    if (e.sub_type === 'approve' || e.sub_type === 'invite' || e.notice_type === 'group_increase') {
        changeType = 'increase'
    } else if (
        e.sub_type === 'leave' ||
        e.sub_type === 'kick' ||
        e.sub_type === 'kick_me' ||
        e.notice_type === 'group_decrease'
    ) {
        changeType = 'decrease'
    }

    // 细分类型
    let subType = e.sub_type || 'unknown'
    if (changeType === 'increase') {
        subType = e.sub_type === 'invite' ? 'invite' : 'approve'
    } else if (changeType === 'decrease') {
        subType = e.sub_type === 'kick' ? 'kick' : e.sub_type === 'kick_me' ? 'kick_me' : 'leave'
    }
    let nickname = null
    if (changeType === 'increase' && e.nickname) {
        nickname = e.nickname
    } else if (changeType === 'decrease' && e.member) {
        nickname = e.member.card || e.member.nickname
    }

    return {
        userId,
        operatorId,
        changeType,
        subType,
        groupId: e.group_id,
        nickname, // icqq 提供的用户昵称
        member: e.member // icqq 退群事件的完整成员信息
    }
}

/**
 * 解析精华消息事件 - 全适配器兼容
 * @param {Object} e - 事件对象
 * @returns {Object}
 */
export function parseEssenceEvent(e) {
    return {
        messageId: e.message_id || e.msg_id,
        senderId: e.sender_id || e.user_id,
        operatorId: e.operator_id,
        isAdd: e.sub_type === 'add' || e.action === 'add',
        groupId: e.group_id
    }
}

/**
 * 解析管理员变更事件 - 全适配器兼容
 * @param {Object} e - 事件对象
 * @returns {Object}
 */
export function parseAdminChangeEvent(e) {
    return {
        userId: e.user_id || e.target_id,
        isSet: e.sub_type === 'set' || e.action === 'set',
        groupId: e.group_id
    }
}

/**
 * 解析运气王/群荣誉事件 - 全适配器兼容
 * @param {Object} e - 事件对象
 * @returns {Object}
 */
export function parseHonorEvent(e) {
    // 荣誉类型
    const honorType = e.honor_type || e.sub_type

    // 获得者
    const userId = e.user_id || e.target_id

    // 荣誉名称映射
    const honorNames = {
        talkative: '龙王',
        performer: '群聊之火',
        legend: '群聊炽焰',
        strong_newbie: '冒尖小春笋',
        emotion: '快乐源泉',
        lucky_king: '运气王'
    }

    return {
        userId,
        honorType,
        honorName: honorNames[honorType] || honorType || '群荣誉',
        groupId: e.group_id,
        // 运气王特有字段
        targetId: e.target_id // 发红包的人
    }
}

/**
 * 获取被撤回/回应的原消息内容 - 全适配器兼容
 * @param {Object} e - 事件对象
 * @param {Object} [bot] - Bot 实例
 * @param {Map} [messageCache] - 消息缓存
 * @returns {Promise<{content: string, type: string}>}
 */
export async function getOriginalMessage(e, bot = null, messageCache = null) {
    const messageId = e.message_id || e.seq || e.msg_id
    try {
        const cached = messageCache?.get?.(messageId)
        if (cached) {
            const parsed = parseMessageContent(cached.message || cached.raw_message)
            if (parsed.content) return parsed
        }
        for (const field of ['message', 'recall', 'content', 'raw_message', 'recalled_message']) {
            if (!e[field]) continue
            const value = typeof e[field] === 'object' ? e[field].message || e[field].content || e[field] : e[field]
            const parsed = parseMessageContent(value)
            if (parsed.content) return parsed
        }
        const api = new StandardBotApi({ event: e, bot: bot || e?.bot || globalThis.Bot })
        const message = await api.getMessage(messageId, { groupId: e.group_id, userId: e.user_id })
        const parsed = parseMessageContent(message?.message || message?.raw_message)
        if (parsed.content) return parsed
    } catch (error) {
        logger.debug(`[EventAdapter] 获取原消息失败: ${error.message}`)
    }
    return { content: '', type: 'unknown' }
}

/**
 * 解析消息内容为文本
 * @param {any} message - 消息
 * @returns {{content: string, type: string}}
 */
export function parseMessageContent(message) {
    if (!message) return { content: '', type: 'unknown' }
    if (typeof message === 'function') {
        try {
            message = message()
        } catch {
            return { content: '', type: 'unknown' }
        }
    }
    if (typeof message === 'string') return { content: message, type: 'text' }

    if (!Array.isArray(message)) {
        if (message.text) return { content: message.text, type: 'text' }
        if (message.raw_message) return { content: message.raw_message, type: 'text' }
        if (message.content) return parseMessageContent(message.content)
        if (typeof message === 'object' && message !== null) {
            return { content: '', type: 'unknown' }
        }
        return { content: '', type: 'unknown' }
    }

    const parts = []
    let msgType = 'text'

    for (const seg of message) {
        if (!seg) continue
        const type = seg.type || seg.Type
        const data = seg.data || seg

        switch (type) {
            case 'text':
                if (data.text) parts.push(data.text)
                break
            case 'image':
                parts.push('[图片]')
                msgType = 'image'
                break
            case 'face':
                parts.push(`[表情${data.id || ''}]`)
                break
            case 'at':
                parts.push(`@${data.name || data.qq || '用户'}`)
                break
            case 'reply':
                parts.push('[回复]')
                break
            case 'forward':
            case 'xml':
            case 'json':
                parts.push('[合并转发/卡片消息]')
                msgType = 'forward'
                break
            case 'video':
                parts.push('[视频]')
                msgType = 'video'
                break
            case 'record':
            case 'audio':
                parts.push('[语音]')
                msgType = 'audio'
                break
            case 'file':
                parts.push(`[文件${data.name ? ': ' + data.name : ''}]`)
                msgType = 'file'
                break
            case 'mface':
            case 'marketface':
                parts.push('[商城表情]')
                break
            case 'poke':
                parts.push('[戳一戳]')
                break
            case 'flash':
                parts.push('[闪照]')
                msgType = 'image'
                break
            case 'sface':
                parts.push(`[小表情${data.text || data.id || ''}]`)
                break
            case 'bface':
                parts.push('[原创表情]')
                break
            case 'long_msg':
                parts.push('[长消息]')
                break
            case 'location':
                parts.push(`[位置${data.name || data.address || ''}]`)
                break
            case 'share':
                parts.push(`[链接${data.title ? ': ' + data.title : ''}]`)
                break
            case 'music':
                parts.push(`[音乐${data.title ? ': ' + data.title : ''}]`)
                break
            default:
                if (data.text) parts.push(data.text)
                else if (type) parts.push(`[${type}]`)
        }
    }

    return { content: parts.join('') || '', type: msgType }
}

/**
 * 格式化时长
 * @param {number} seconds - 秒数
 * @returns {string}
 */
export function formatDuration(seconds) {
    if (seconds <= 0) return '0秒'

    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = seconds % 60

    const parts = []
    if (days > 0) parts.push(`${days}天`)
    if (hours > 0) parts.push(`${hours}小时`)
    if (minutes > 0) parts.push(`${minutes}分钟`)
    if (secs > 0 && days === 0) parts.push(`${secs}秒`)

    return parts.join('') || '0秒'
}

/**
 * 发送群消息 - 全适配器兼容
 * 委托给 platformAdapter.sendGroupMessage 统一实现
 * @param {Object} bot - Bot 实例
 * @param {string|number} groupId - 群ID
 * @param {string|Array} message - 消息内容
 * @returns {Promise<Object|null>} 发送结果对象（包含 message_id 等），失败返回 null
 */
/** @deprecated 请使用 StandardBotApi.sendGroup。 */
export async function sendGroupMessage(bot, groupId, message) {
    if (!message || !groupId) return null
    try {
        return (await new StandardBotApi({ bot }).sendGroup(groupId, message)).result
    } catch (error) {
        logger.warn(`[EventAdapter] 发送群消息失败: ${error.message}`)
        return null
    }
}

/**
 * 检查事件处理概率
 * 根据配置的概率决定是否触发事件处理
 * 支持群组独立概率配置，开启后默认100%
 * @param {string} eventType - 事件类型 (welcome, goodbye, poke, recall, ban, luckyKing, honor, essence, admin 等)
 * @param {string} [groupId] - 群组ID，用于检查群组特定配置
 * @returns {Promise<{shouldTrigger: boolean, probability: number, randomValue: number, reason: string}>}
 */
export async function checkEventProbability(eventType, groupId = null) {
    try {
        const config = (await import('../../config/config.js')).default
        const eventConfig = config.get('events') || {}
        const featuresConfig = config.get('features') || {}

        // 检查事件处理是否启用
        if (eventConfig.enabled === false) {
            return { shouldTrigger: false, probability: 0, randomValue: 0, reason: 'events disabled' }
        }

        // 检查该事件类型是否启用
        const enabledEvents = eventConfig.enabledEvents || [
            'poke',
            'reaction',
            'welcome',
            'goodbye',
            'ban',
            'admin',
            'luckyKing',
            'honor',
            'recall'
        ]
        if (!enabledEvents.includes(eventType)) {
            return { shouldTrigger: false, probability: 0, randomValue: 0, reason: 'event type disabled' }
        }

        // 获取全局概率配置（从 features.{eventType}.probability 或 events.eventProbabilities）
        const getGlobalProbability = () => {
            // 优先从 features 配置中读取
            const featureConfig = featuresConfig[eventType]
            if (featureConfig?.probability !== undefined) {
                return featureConfig.probability
            }
            // 回退到 events.eventProbabilities
            const eventProbabilities = eventConfig.eventProbabilities || {}
            return eventProbabilities[eventType] ?? eventConfig.probability ?? 1.0
        }

        let probability = 1.0 // 默认100%

        // 尝试获取群组特定的概率配置
        if (groupId) {
            try {
                const { getScopeManager } = await import('../services/scope/ScopeManager.js')
                const { databaseService } = await import('../services/storage/DatabaseService.js')
                if (!databaseService.initialized) {
                    await databaseService.init()
                }
                const scopeManager = getScopeManager(databaseService)
                await scopeManager.init()

                const groupSettings = await scopeManager.getGroupSettings(String(groupId))
                const settings = groupSettings?.settings || {}

                // 根据事件类型获取群组概率配置
                const probabilityKey = `${eventType}Probability`
                const groupProbability = settings[probabilityKey]

                if (groupProbability !== undefined && groupProbability !== 'inherit') {
                    probability = typeof groupProbability === 'number' ? groupProbability : 1.0
                    if (global.logger) {
                        global.logger.debug(`[EventProbability] 使用群组 ${groupId} 配置: ${eventType}=${probability}`)
                    }
                } else {
                    // 使用全局概率配置
                    probability = getGlobalProbability()
                }
            } catch (err) {
                if (global.logger) {
                    global.logger.debug(`[EventProbability] 获取群组配置失败: ${err.message}，使用全局配置`)
                }
                // 回退到全局配置
                probability = getGlobalProbability()
            }
        } else {
            // 无群组ID，使用全局配置
            probability = getGlobalProbability()
        }

        // 处理百分比格式
        if (probability > 1) {
            probability = probability / 100
        }
        probability = Math.max(0, Math.min(1, probability))

        // 概率为0直接返回不触发
        if (probability === 0) {
            return { shouldTrigger: false, probability: 0, randomValue: 0, reason: 'probability is 0' }
        }

        // 概率为1直接返回触发
        if (probability >= 1) {
            return { shouldTrigger: true, probability: 1, randomValue: 0, reason: 'probability is 100%' }
        }

        // 进行概率判定
        const randomValue = Math.random()
        const shouldTrigger = randomValue <= probability

        if (global.logger) {
            global.logger.debug(
                `[EventProbability] ${eventType}${groupId ? `(群${groupId})` : ''}: random=${randomValue.toFixed(4)}, probability=${probability}, trigger=${shouldTrigger}`
            )
        }

        return {
            shouldTrigger,
            probability,
            randomValue,
            reason: shouldTrigger ? 'probability check passed' : 'probability check failed'
        }
    } catch (err) {
        // 出错时默认触发
        if (global.logger) {
            global.logger.debug(`[EventProbability] 检查失败: ${err.message}, 默认触发`)
        }
        return { shouldTrigger: true, probability: 1, randomValue: 0, reason: 'error fallback' }
    }
}

export default {
    // API 调用
    callOneBotApi,
    sendPoke,
    sendReaction,
    sendGroupMessage,

    // 信息获取
    getUserNickname,
    getGroupName,
    getOriginalMessage,
    parseMessageContent,

    // 事件解析
    parsePokeEvent,
    parseReactionEvent,
    parseRecallEvent,
    parseBanEvent,
    parseMemberChangeEvent,
    parseEssenceEvent,
    parseAdminChangeEvent,
    parseHonorEvent,

    // 工具函数
    formatDuration,
    checkEventProbability
}
