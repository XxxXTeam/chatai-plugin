/**
 * @module utils/eventAdapter
 */
import { detectAdapter, getBot, getBotSelfId, getUserInfo, getMessage } from './platformAdapter.js'
export { getBot, getBotSelfId, detectAdapter }

/**
 * @param {Object} bot - Bot 实例
 * @param {string} action - API 名称
 * @param {Object} params - 参数
 * @returns {Promise<any>}
 */
export async function callOneBotApi(bot, action, params = {}) {
    if (typeof bot?.sendApi === 'function') {
        try {
            return await bot.sendApi(action, params)
        } catch {}
    }
    const camelAction = action.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    if (typeof bot?.[camelAction] === 'function') {
        try {
            return await bot[camelAction](params)
        } catch {}
    }
    if (typeof bot?.[action] === 'function') {
        try {
            return await bot[action](params)
        } catch {}
    }
    const baseUrl = bot?.config?.baseUrl || bot?.adapter?.config?.baseUrl
    if (baseUrl) {
        try {
            const res = await fetch(`${baseUrl}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            })
            return await res.json()
        } catch {}
    }
    
    return null
}

/**
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 目标用户ID
 * @param {string|number} [groupId] - 群ID (群聊戳一戳)
 * @returns {Promise<boolean>} 是否成功
 */
export async function sendPoke(e, userId, groupId = null) {
    const bot = getBot(e)
    const platform = detectAdapter(e)
    userId = parseInt(userId)
    groupId = groupId ? parseInt(groupId) : null
    
    try {
        if (platform === 'icqq' && bot.pickGroup) {
            if (groupId) {
                const group = bot.pickGroup(groupId)
                // 方式1: group.pokeMember
                if (typeof group?.pokeMember === 'function') {
                    await group.pokeMember(userId)
                    return true
                }
                // 方式2: pickMember().poke()
                if (group?.pickMember) {
                    const member = group.pickMember(userId)
                    if (typeof member?.poke === 'function') {
                        await member.poke()
                        return true
                    }
                }
            } else {
                const friend = bot.pickFriend?.(userId)
                if (typeof friend?.poke === 'function') {
                    await friend.poke()
                    return true
                }
            }
        }

        if (groupId) {
            // 尝试多种 API
            const apis = ['send_group_poke', 'group_poke', 'send_poke']
            for (const api of apis) {
                try {
                    const result = await callOneBotApi(bot, api, {
                        group_id: groupId,
                        user_id: userId
                    })
                    if (result !== null) return true
                } catch {}
            }
            
            // 尝试直接方法调用
            if (typeof bot?.sendGroupPoke === 'function') {
                await bot.sendGroupPoke(groupId, userId)
                return true
            }
            
            // 尝试发送戳一戳消息段
            try {
                const pokeMsg = { type: 'poke', data: { qq: String(userId) } }
                await bot.sendGroupMsg?.(groupId, [pokeMsg])
                return true
            } catch {}
        } else {
            // 私聊戳一戳
            const apis = ['send_friend_poke', 'friend_poke', 'send_poke']
            for (const api of apis) {
                try {
                    const result = await callOneBotApi(bot, api, { user_id: userId })
                    if (result !== null) return true
                } catch {}
            }
            
            if (typeof bot?.sendFriendPoke === 'function') {
                await bot.sendFriendPoke(userId)
                return true
            }
        }
    } catch (err) {
        logger.debug(`[EventAdapter] 发送戳一戳失败: ${err.message}`)
    }
    
    return false
}

/**
 * @param {Object} e - 事件对象
 * @param {string|number} messageId - 消息ID
 * @param {string|number} emojiId - 表情ID
 * @param {boolean} [isSet=true] - true为添加，false为取消
 * @returns {Promise<boolean>}
 */
export async function sendReaction(e, messageId, emojiId, isSet = true) {
    const bot = getBot(e)
    const platform = detectAdapter(e)
    
    try {
        if (platform === 'icqq') {
            if (e.group_id && bot.pickGroup) {
                const group = bot.pickGroup(parseInt(e.group_id))
                if (typeof group?.setReaction === 'function') {
                    await group.setReaction(messageId, String(emojiId), isSet)
                    return true
                }
                if (typeof group?.setEssence === 'function' && typeof group?.setMsgReaction === 'function') {
                    await group.setMsgReaction(messageId, String(emojiId), isSet)
                    return true
                }
            }
        }
        const apis = [
            'set_msg_emoji_like',
            'set_group_reaction', 
            'send_group_reaction',
            'set_message_reaction'
        ]
        
        for (const api of apis) {
            try {
                const result = await callOneBotApi(bot, api, {
                    message_id: messageId,
                    emoji_id: String(emojiId),
                    set: isSet
                })
                if (result !== null) return true
            } catch {}
        }
        try {
            const result = await callOneBotApi(bot, 'set_msg_emoji_like', {
                message_id: messageId,
                emoji_id: String(emojiId)
            })
            if (result !== null) return true
        } catch {}
        
    } catch (err) {
        logger.debug(`[EventAdapter] 发送表情回应失败: ${err.message}`)
    }
    
    return false
}

/**
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @param {Object} [bot] - Bot 实例
 * @returns {Promise<string>}
 */
export async function getUserNickname(e, userId, bot = null) {
    if (!userId) return '未知用户'
    bot = bot || getBot(e)
    
    try {
        // 优先从事件中获取
        if (e?.sender?.user_id == userId) {
            if (e.sender.card) return e.sender.card
            if (e.sender.nickname) return e.sender.nickname
        }
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
    let emojiId = e.id || e.emoji_id || e.face_id || e.code
    if (!emojiId && Array.isArray(e.likes) && e.likes.length > 0) {
        emojiId = e.likes[0].emoji_id || e.likes[0].face_id || e.likes[0].id
    }
    const messageId = e.message_id || e.seq || e.msg_id || e.message_seq
    const userId = e.user_id || e.operator_id || e.sender_id
    const targetId = e.target_id || e.sender_id || e.target_user_id
    const isAdd = !(
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
        e.type === 'cancel'
    )
    
    return {
        emojiId,
        messageId,
        userId,
        targetId,
        isAdd,
        groupId: e.group_id,
        likes: e.likes || []
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
    } else if (e.sub_type === 'leave' || e.sub_type === 'kick' || e.sub_type === 'kick_me' || e.notice_type === 'group_decrease') {
        changeType = 'decrease'
    }
    
    // 细分类型
    let subType = e.sub_type || 'unknown'
    if (changeType === 'increase') {
        subType = e.sub_type === 'invite' ? 'invite' : 'approve'
    } else if (changeType === 'decrease') {
        subType = e.sub_type === 'kick' ? 'kick' : (e.sub_type === 'kick_me' ? 'kick_me' : 'leave')
    }
    
    return {
        userId,
        operatorId,
        changeType,
        subType,
        groupId: e.group_id
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
        'talkative': '龙王',
        'performer': '群聊之火',
        'legend': '群聊炽焰',
        'strong_newbie': '冒尖小春笋',
        'emotion': '快乐源泉',
        'lucky_king': '运气王'
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
    bot = bot || getBot(e)
    const messageId = e.message_id || e.seq || e.msg_id
    const groupId = e.group_id
    
    try {
        // 1. 从缓存获取
        if (messageCache && messageId) {
            const cached = messageCache.get(messageId)
            if (cached) {
                const parsed = parseMessageContent(cached.message || cached.raw_message)
                if (parsed.content) return parsed
            }
        }
        
        // 2. 从事件自带字段获取
        const eventFields = ['message', 'recall', 'content', 'raw_message', 'recalled_message']
        for (const field of eventFields) {
            if (e[field]) {
                const data = typeof e[field] === 'object' ? e[field].message || e[field].content || e[field] : e[field]
                const parsed = parseMessageContent(data)
                if (parsed.content) return parsed
            }
        }
        
        // 3. 通过 API 获取
        const msg = await getMessage(e, messageId, groupId)
        if (msg) {
            const parsed = parseMessageContent(msg.message || msg.raw_message)
            if (parsed.content) return parsed
        }
        
        // 4. icqq: 通过历史记录获取
        if (bot?.pickGroup && groupId) {
            const group = bot.pickGroup(parseInt(groupId))
            if (group?.getChatHistory) {
                const seq = e.seq || e.message_seq || messageId
                const history = await group.getChatHistory(parseInt(seq), 1)
                if (history?.[0]) {
                    const parsed = parseMessageContent(history[0].message || history[0].raw_message)
                    if (parsed.content) return parsed
                }
            }
        }
    } catch (err) {
        logger.debug(`[EventAdapter] 获取原消息失败: ${err.message}`)
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
 * @param {Object} bot - Bot 实例
 * @param {string|number} groupId - 群ID
 * @param {string|Array} message - 消息内容
 * @returns {Promise<boolean>}
 */
export async function sendGroupMessage(bot, groupId, message) {
    if (!message || !groupId) return false
    
    try {
        // icqq
        const group = bot?.pickGroup?.(parseInt(groupId))
        if (group?.sendMsg) {
            await group.sendMsg(message)
            return true
        }
        
        // OneBot
        if (bot?.sendGroupMsg) {
            await bot.sendGroupMsg(parseInt(groupId), message)
            return true
        }
        
        // OneBot 下划线命名
        if (bot?.send_group_msg) {
            await bot.send_group_msg({ group_id: parseInt(groupId), message })
            return true
        }
    } catch (err) {
        logger.warn(`[EventAdapter] 发送群消息失败: ${err.message}`)
    }
    
    return false
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
    formatDuration
}
