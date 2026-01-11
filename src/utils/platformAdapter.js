/**
 * 检测框架类型
 * @returns {'trss'|'miao'}
 */
export function detectFramework() {
    if (typeof Bot !== 'undefined' && Bot.bots) {
        return 'trss'
    }
    return 'miao'
}

/**
 * 检测适配器类型
 * @param {Object} e - 事件对象或bot对象
 * @returns {string} 适配器类型: 'icqq' | 'napcat' | 'go-cqhttp' | 'lagrange' | 'onebot' | 'unknown'
 */
export function detectAdapter(e) {
    const bot = e?.bot || e || Bot

    // 检查适配器名称
    if (bot?.adapter?.name) {
        const name = bot.adapter.name.toLowerCase()
        if (name.includes('icqq')) return 'icqq'
        if (name.includes('napcat') || name.includes('nc')) return 'napcat'
        if (name.includes('gocq') || name.includes('go-cqhttp')) return 'go-cqhttp'
        if (name.includes('lagrange')) return 'lagrange'
        if (name.includes('onebot')) return 'onebot'
    }

    // 通过版本信息检测
    if (bot?.version?.app_name) {
        const appName = bot.version.app_name.toLowerCase()
        if (appName.includes('napcat')) return 'napcat'
        if (appName.includes('go-cqhttp') || appName.includes('gocq')) return 'go-cqhttp'
        if (appName.includes('lagrange')) return 'lagrange'
    }
    if (typeof bot?.pickGroup === 'function' && bot?.gml) {
        return 'icqq'
    }
    if (typeof bot?.getMsg === 'function') {
        return 'onebot'
    }
    return 'unknown'
}
export function detectPlatform(e) {
    return detectAdapter(e)
}
/**
 * 获取Bot信息
 * @param {Object} e - 事件对象
 * @returns {Object} Bot信息
 */
export function getBotInfo(e) {
    const bot = e?.bot || Bot
    const platform = detectPlatform(e)

    return {
        platform,
        uin: bot?.uin || bot?.self_id || e?.self_id,
        nickname: bot?.nickname || bot?.info?.nickname || 'Bot',
        version: bot?.version || {},
        adapter: bot?.adapter?.name || platform
    }
}

/**
 * 获取用户信息 - 统一接口（支持QQBot）
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @param {string|number} [groupId] - 群ID (可选)
 * @returns {Promise<Object>} 用户信息
 */
export async function getUserInfo(e, userId, groupId = null) {
    const bot = e?.bot || Bot
    const platform = detectPlatform(e)
    const userIdStr = String(userId)

    // 检测是否为QQBot平台用户
    const isQQBot = isQQBotPlatform(e) || userIdStr.includes(':') || userIdStr.startsWith('qg_')

    // 为QQBot用户生成头像URL
    const avatarUrl = isQQBot ? getQQBotAvatarUrl(e, userId) : `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`

    const defaultInfo = {
        user_id: userId,
        nickname: String(userId),
        card: '',
        sex: 'unknown',
        age: 0,
        area: '',
        level: 0,
        role: 'member',
        title: '',
        avatar: avatarUrl,
        isQQBot: isQQBot
    }

    // QQBot平台特殊处理
    if (isQQBot) {
        // 尝试从事件中获取用户信息
        if (e?.sender && String(e.sender.user_id) === userIdStr) {
            return {
                ...defaultInfo,
                nickname: e.sender.nickname || e.sender.card || defaultInfo.nickname,
                card: e.sender.card || '',
                role: e.sender.role || 'member',
                avatar: e.sender.avatar || avatarUrl
            }
        }

        // 尝试从Bot缓存获取
        try {
            const userInfo = bot?.fl?.get?.(userId) || bot?.gl?.get?.(groupId)?.get?.(userId)
            if (userInfo) {
                return {
                    ...defaultInfo,
                    nickname: userInfo.nickname || userInfo.card || defaultInfo.nickname,
                    card: userInfo.card || '',
                    avatar: userInfo.avatar || avatarUrl
                }
            }
        } catch {}

        return defaultInfo
    }

    // 普通QQ用户，转为数字ID
    const numericUserId = parseInt(userId)

    try {
        switch (platform) {
            case 'icqq': {
                if (groupId) {
                    // 获取群成员信息
                    const group = bot.pickGroup(parseInt(groupId))
                    const member = group.pickMember(numericUserId)
                    const info = (await member.getInfo?.()) || member.info || member
                    return {
                        ...defaultInfo,
                        nickname: info.nickname || info.card || defaultInfo.nickname,
                        card: info.card || '',
                        sex: info.sex || 'unknown',
                        age: info.age || 0,
                        area: info.area || '',
                        level: info.level || 0,
                        role: info.role || 'member',
                        title: info.title || '',
                        join_time: info.join_time,
                        last_sent_time: info.last_sent_time,
                        shutup_time: info.shutup_time
                    }
                } else {
                    // 获取好友/陌生人信息
                    let info = null
                    try {
                        const friend = bot.pickFriend(userId)
                        info = (await friend.getInfo?.()) || friend.info || friend
                    } catch {
                        // 尝试获取陌生人信息
                        try {
                            info = await bot.getStrangerInfo?.(userId)
                        } catch {}
                    }
                    if (info) {
                        return {
                            ...defaultInfo,
                            nickname: info.nickname || defaultInfo.nickname,
                            sex: info.sex || 'unknown',
                            age: info.age || 0
                        }
                    }
                }
                break
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                if (groupId) {
                    // OneBot: get_group_member_info
                    const info =
                        (await bot.getGroupMemberInfo?.(parseInt(groupId), userId, true)) ||
                        (await bot.get_group_member_info?.({
                            group_id: parseInt(groupId),
                            user_id: userId,
                            no_cache: true
                        }))
                    if (info) {
                        return {
                            ...defaultInfo,
                            nickname: info.nickname || defaultInfo.nickname,
                            card: info.card || '',
                            sex: info.sex || 'unknown',
                            age: info.age || 0,
                            area: info.area || '',
                            level: String(info.level || 0),
                            role: info.role || 'member',
                            title: info.title || '',
                            join_time: info.join_time,
                            last_sent_time: info.last_sent_time,
                            shutup_timestamp: info.shut_up_timestamp
                        }
                    }
                } else {
                    // OneBot: get_stranger_info
                    const info =
                        (await bot.getStrangerInfo?.(userId, true)) ||
                        (await bot.get_stranger_info?.({ user_id: userId, no_cache: true }))
                    if (info) {
                        return {
                            ...defaultInfo,
                            nickname: info.nickname || defaultInfo.nickname,
                            sex: info.sex || 'unknown',
                            age: info.age || 0
                        }
                    }
                }
                break
            }

            case 'trss': {
                // TRSS 适配
                if (groupId) {
                    const info = await bot.getGroupMemberInfo?.(parseInt(groupId), userId)
                    if (info) {
                        return { ...defaultInfo, ...info }
                    }
                } else {
                    const info = await bot.getStrangerInfo?.(userId)
                    if (info) {
                        return { ...defaultInfo, ...info }
                    }
                }
                break
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 获取用户信息失败: ${err.message}`)
    }

    // 尝试从事件中获取
    if (e?.sender && String(e.sender.user_id) === String(userId)) {
        return {
            ...defaultInfo,
            nickname: e.sender.nickname || e.sender.card || defaultInfo.nickname,
            card: e.sender.card || '',
            sex: e.sender.sex || 'unknown',
            age: e.sender.age || 0,
            role: e.sender.role || 'member'
        }
    }

    return defaultInfo
}

/**
 * 获取群信息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @returns {Promise<Object>} 群信息
 */
export async function getGroupInfo(e, groupId) {
    const bot = e?.bot || Bot
    const platform = detectPlatform(e)
    groupId = parseInt(groupId)

    const defaultInfo = {
        group_id: groupId,
        group_name: String(groupId),
        member_count: 0,
        max_member_count: 0
    }

    try {
        switch (platform) {
            case 'icqq': {
                const group = bot.pickGroup(groupId)
                const info = (await group.getInfo?.()) || group.info || group
                return {
                    ...defaultInfo,
                    group_name: info.group_name || info.name || defaultInfo.group_name,
                    member_count: info.member_count || 0,
                    max_member_count: info.max_member_count || 0,
                    owner_id: info.owner_id,
                    admin_flag: info.admin_flag,
                    create_time: info.create_time,
                    level: info.level,
                    grade: info.grade
                }
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                const info =
                    (await bot.getGroupInfo?.(groupId, true)) ||
                    (await bot.get_group_info?.({ group_id: groupId, no_cache: true }))
                if (info) {
                    return {
                        ...defaultInfo,
                        group_name: info.group_name || defaultInfo.group_name,
                        member_count: info.member_count || 0,
                        max_member_count: info.max_member_count || 0
                    }
                }
                break
            }

            case 'trss': {
                const info = await bot.getGroupInfo?.(groupId)
                if (info) {
                    return { ...defaultInfo, ...info }
                }
                break
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 获取群信息失败: ${err.message}`)
    }

    return defaultInfo
}

/**
 * 获取群成员列表 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @returns {Promise<Array>} 成员列表
 */
export async function getGroupMemberList(e, groupId) {
    const bot = e?.bot || Bot
    const platform = detectPlatform(e)
    groupId = parseInt(groupId)

    try {
        switch (platform) {
            case 'icqq': {
                const group = bot.pickGroup(groupId)
                // icqq 返回 Map
                const memberMap = (await group.getMemberMap?.()) || group.member_map || new Map()
                return Array.from(memberMap.values())
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                const list =
                    (await bot.getGroupMemberList?.(groupId, true)) ||
                    (await bot.get_group_member_list?.({ group_id: groupId, no_cache: true }))
                return list || []
            }

            case 'trss': {
                const list = await bot.getGroupMemberList?.(groupId)
                return list || []
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 获取群成员列表失败: ${err.message}`)
    }

    return []
}

/**
 * 获取消息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} messageId - 消息ID或seq
 * @param {string|number} [groupId] - 群ID (可选)
 * @returns {Promise<Object|null>} 消息对象
 */
export async function getMessage(e, messageId, groupId = null) {
    const bot = e?.bot || Bot
    const platform = detectPlatform(e)

    try {
        switch (platform) {
            case 'icqq': {
                if (groupId) {
                    const group = bot.pickGroup(parseInt(groupId))
                    // 尝试 getMsg
                    if (group.getMsg) {
                        return await group.getMsg(messageId)
                    }
                    // 尝试 getChatHistory
                    if (group.getChatHistory) {
                        const history = await group.getChatHistory(parseInt(messageId), 1)
                        return history?.[0] || null
                    }
                } else if (e?.user_id) {
                    const friend = bot.pickFriend(e.user_id)
                    if (friend.getMsg) {
                        return await friend.getMsg(messageId)
                    }
                }
                break
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                // OneBot: get_msg
                const msg = (await bot.getMsg?.(messageId)) || (await bot.get_msg?.({ message_id: messageId }))
                return msg || null
            }

            case 'trss': {
                return (await bot.getMsg?.(messageId)) || null
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 获取消息失败: ${err.message}`)
    }

    return null
}

/**
 * 发送戳一戳 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 目标用户ID
 * @param {string|number} [groupId] - 群ID (可选)
 * @returns {Promise<boolean>} 是否成功
 */
export async function sendPoke(e, userId, groupId = null) {
    const bot = e?.bot || Bot
    const platform = detectPlatform(e)
    userId = parseInt(userId)

    try {
        switch (platform) {
            case 'icqq': {
                if (groupId) {
                    const group = bot.pickGroup(parseInt(groupId))
                    // icqq: pokeMember 或 pickMember().poke()
                    if (typeof group.pokeMember === 'function') {
                        await group.pokeMember(userId)
                        return true
                    } else if (group.pickMember) {
                        await group.pickMember(userId).poke?.()
                        return true
                    }
                } else {
                    const friend = bot.pickFriend(userId)
                    await friend.poke?.()
                    return true
                }
                break
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp': {
                // OneBot 扩展 API
                if (groupId) {
                    ;(await bot.sendGroupPoke?.(parseInt(groupId), userId)) ||
                        (await bot.send_group_poke?.({ group_id: parseInt(groupId), user_id: userId })) ||
                        (await bot.group_poke?.({ group_id: parseInt(groupId), user_id: userId }))
                } else {
                    ;(await bot.sendFriendPoke?.(userId)) ||
                        (await bot.send_friend_poke?.({ user_id: userId })) ||
                        (await bot.friend_poke?.({ user_id: userId }))
                }
                return true
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 发送戳一戳失败: ${err.message}`)
    }

    return false
}

/**
 * 获取头像URL - 统一接口（支持QQBot）
 * @param {Object|string|number} eOrUserId - 事件对象或用户ID
 * @param {string|number} [userIdOrSize] - 用户ID或尺寸
 * @param {number} [size=640] - 头像尺寸
 * @returns {string} 头像URL
 */
export function getAvatarUrl(eOrUserId, userIdOrSize = 640, size = 640) {
    // 兼容两种调用方式：getAvatarUrl(userId, size) 和 getAvatarUrl(e, userId, size)
    let e = null
    let userId
    let avatarSize = size

    if (typeof eOrUserId === 'object' && eOrUserId !== null && !Array.isArray(eOrUserId)) {
        // 新方式：getAvatarUrl(e, userId, size)
        e = eOrUserId
        userId = userIdOrSize
        avatarSize = size
    } else {
        // 旧方式：getAvatarUrl(userId, size)
        userId = eOrUserId
        avatarSize = typeof userIdOrSize === 'number' ? userIdOrSize : 640
    }

    const userIdStr = String(userId)

    // 检测QQBot用户
    if (userIdStr.includes(':') || userIdStr.startsWith('qg_')) {
        return getQQBotAvatarUrl(e, userId)
    }

    // 普通QQ头像接口
    const numericId = parseInt(userId)
    if (!isNaN(numericId)) {
        return `https://q1.qlogo.cn/g?b=qq&nk=${numericId}&s=${avatarSize}`
    }

    return ''
}

/**
 * 获取QQBot平台用户头像URL
 * @param {Object} e - 事件对象
 * @param {string} userId - 用户ID (可能是 appid:openid 或 qg_xxx 格式)
 * @returns {string} 头像URL
 */
export function getQQBotAvatarUrl(e, userId = null) {
    const bot = e?.bot || (typeof Bot !== 'undefined' ? Bot : null)

    // 获取真正的appid
    const realAppid = bot?.info?.appid || bot?.sdk?.config?.appid

    // 如果没有传userId，尝试获取发送者的openid
    if (!userId) {
        // 优先从 raw.author 获取发送者openid（最可靠）
        const senderOpenid = e?.raw?.author?.member_openid || e?.raw?.author?.id
        if (senderOpenid && realAppid) {
            return `https://q.qlogo.cn/qqapp/${realAppid}/${senderOpenid}/0`
        }

        // 其次尝试从 user_id 解析
        userId = e?.user_id || e?.sender?.user_id
    }

    if (!userId) return ''

    const userIdStr = String(userId)

    // 优先从sender获取已有头像
    if (e?.sender?.avatar) {
        return e.sender.avatar
    }

    // 频道用户 (qg_xxx)
    if (userIdStr.startsWith('qg_')) {
        // 尝试从缓存获取头像
        const userInfo = bot?.fl?.get?.(userId)
        if (userInfo?.avatar) return userInfo.avatar

        // 频道用户没有标准头像URL，返回空
        return ''
    }

    // QQ群用户 (uin:openid 格式，如 3889048706:0EBFE6A6EE3727677897DBEB2F4E2F92)
    // 格式: https://q.qlogo.cn/qqapp/${realAppid}/${openid}/0
    if (userIdStr.includes(':')) {
        const openid = userIdStr.split(':')[1] // openid部分

        if (realAppid && openid) {
            return `https://q.qlogo.cn/qqapp/${realAppid}/${openid}/0`
        }
    }

    // 纯openid格式（没有冒号）
    if (realAppid && userIdStr && !userIdStr.includes(':')) {
        return `https://q.qlogo.cn/qqapp/${realAppid}/${userIdStr}/0`
    }

    return ''
}

/**
 * 获取群头像URL
 * @param {string|number} groupId - 群ID
 * @param {number} [size=640] - 头像尺寸
 * @returns {string} 群头像URL
 */
export function getGroupAvatarUrl(groupId, size = 640) {
    groupId = parseInt(groupId)
    return `https://p.qlogo.cn/gh/${groupId}/${groupId}/${size}`
}

/**
 * 解析消息段 - 统一接口
 * 将不同格式的消息段转换为统一格式
 * @param {Object} segment - 消息段
 * @returns {Object} 统一格式的消息段
 */
export function normalizeSegment(segment) {
    if (!segment) return null

    // NC/OneBot 格式: { type: 'xxx', data: { ... } }
    if (segment.data && typeof segment.data === 'object') {
        return {
            type: segment.type,
            ...segment.data
        }
    }

    // icqq 格式: { type: 'xxx', ... }
    return segment
}

/**
 * 构建消息段 - 统一接口
 * @param {string} type - 消息类型
 * @param {Object} data - 消息数据
 * @param {string} [targetPlatform] - 目标平台
 * @returns {Object} 消息段
 */
export function buildSegment(type, data, targetPlatform = 'icqq') {
    switch (targetPlatform) {
        case 'napcat':
        case 'onebot':
        case 'go-cqhttp':
            // OneBot 格式
            return { type, data }

        case 'icqq':
        default:
            // icqq 格式
            return { type, ...data }
    }
}

/**
 * 撤回消息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} messageId - 消息ID
 * @returns {Promise<boolean>} 是否成功
 */
export async function deleteMessage(e, messageId) {
    const bot = e?.bot || Bot
    const platform = detectAdapter(e)

    try {
        switch (platform) {
            case 'icqq': {
                // icqq: recallMsg
                if (e?.group_id) {
                    const group = bot.pickGroup(parseInt(e.group_id))
                    await group.recallMsg?.(messageId)
                } else if (e?.user_id) {
                    const friend = bot.pickFriend(e.user_id)
                    await friend.recallMsg?.(messageId)
                }
                return true
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                // OneBot: delete_msg
                ;(await bot.deleteMsg?.(messageId)) || (await bot.delete_msg?.({ message_id: messageId }))
                return true
            }

            case 'trss': {
                await bot.deleteMsg?.(messageId)
                return true
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 撤回消息失败: ${err.message}`)
    }

    return false
}

/**
 * 获取群聊历史记录 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @param {number} [count=20] - 获取数量
 * @param {number} [messageSeq=0] - 起始消息序号
 * @returns {Promise<Array>} 消息列表
 */
export async function getGroupChatHistory(e, groupId, count = 20, messageSeq = 0) {
    const bot = e?.bot || Bot
    const platform = detectAdapter(e)
    groupId = parseInt(groupId)

    try {
        switch (platform) {
            case 'icqq': {
                const group = bot.pickGroup(groupId)
                if (group.getChatHistory) {
                    return await group.getChatHistory(messageSeq, count)
                }
                break
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                // OneBot 扩展 API
                const history =
                    (await bot.getGroupMsgHistory?.(groupId, count, messageSeq)) ||
                    (await bot.get_group_msg_history?.({ group_id: groupId, count, message_seq: messageSeq }))
                return history?.messages || history || []
            }

            case 'trss': {
                const group = bot.pickGroup?.(groupId)
                if (group?.getChatHistory) {
                    return await group.getChatHistory(messageSeq, count)
                }
                break
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 获取群聊历史失败: ${err.message}`)
    }

    return []
}

/**
 * 发送群消息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @param {string|Array} message - 消息内容
 * @returns {Promise<Object|null>} 发送结果
 */
export async function sendGroupMessage(e, groupId, message) {
    const bot = e?.bot || Bot
    const platform = detectAdapter(e)
    groupId = parseInt(groupId)

    try {
        switch (platform) {
            case 'icqq': {
                const group = bot.pickGroup(groupId)
                return await group.sendMsg(message)
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                return (
                    (await bot.sendGroupMsg?.(groupId, message)) ||
                    (await bot.send_group_msg?.({ group_id: groupId, message }))
                )
            }

            case 'trss': {
                const group = bot.pickGroup?.(groupId)
                return await group?.sendMsg?.(message)
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 发送群消息失败: ${err.message}`)
    }

    return null
}

/**
 * 发送私聊消息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @param {string|Array} message - 消息内容
 * @returns {Promise<Object|null>} 发送结果
 */
export async function sendPrivateMessage(e, userId, message) {
    const bot = e?.bot || Bot
    const platform = detectAdapter(e)
    userId = parseInt(userId)

    try {
        switch (platform) {
            case 'icqq': {
                const friend = bot.pickFriend(userId)
                return await friend.sendMsg(message)
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                return (
                    (await bot.sendPrivateMsg?.(userId, message)) ||
                    (await bot.send_private_msg?.({ user_id: userId, message }))
                )
            }

            case 'trss': {
                const friend = bot.pickFriend?.(userId)
                return await friend?.sendMsg?.(message)
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 发送私聊消息失败: ${err.message}`)
    }

    return null
}

/**
 * 设置群禁言 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @param {string|number} userId - 用户ID
 * @param {number} duration - 禁言时长（秒），0为解除
 * @returns {Promise<boolean>}
 */
export async function setGroupBan(e, groupId, userId, duration = 60) {
    const bot = e?.bot || Bot
    const platform = detectAdapter(e)
    groupId = parseInt(groupId)
    userId = parseInt(userId)

    try {
        switch (platform) {
            case 'icqq': {
                const group = bot.pickGroup(groupId)
                ;(await group.muteMember?.(userId, duration)) || group.pickMember?.(userId).mute?.(duration)
                return true
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                ;(await bot.setGroupBan?.(groupId, userId, duration)) ||
                    bot.set_group_ban?.({ group_id: groupId, user_id: userId, duration })
                return true
            }

            case 'trss': {
                const group = bot.pickGroup?.(groupId)
                await group?.muteMember?.(userId, duration)
                return true
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 设置禁言失败: ${err.message}`)
    }

    return false
}

/**
 * 设置群名片 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @param {string|number} userId - 用户ID
 * @param {string} card - 群名片
 * @returns {Promise<boolean>}
 */
export async function setGroupCard(e, groupId, userId, card) {
    const bot = e?.bot || Bot
    const platform = detectAdapter(e)
    groupId = parseInt(groupId)
    userId = parseInt(userId)

    try {
        switch (platform) {
            case 'icqq': {
                const group = bot.pickGroup(groupId)
                ;(await group.setCard?.(userId, card)) || group.pickMember?.(userId).setCard?.(card)
                return true
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                ;(await bot.setGroupCard?.(groupId, userId, card)) ||
                    bot.set_group_card?.({ group_id: groupId, user_id: userId, card })
                return true
            }

            case 'trss': {
                const group = bot.pickGroup?.(groupId)
                await group?.setCard?.(userId, card)
                return true
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 设置群名片失败: ${err.message}`)
    }

    return false
}

/**
 * 获取好友列表 - 统一接口
 * @param {Object} e - 事件对象
 * @returns {Promise<Array>}
 */
export async function getFriendList(e) {
    const bot = e?.bot || Bot
    const platform = detectAdapter(e)

    try {
        switch (platform) {
            case 'icqq': {
                const friendMap = bot.fl || bot.friend_map || new Map()
                return Array.from(friendMap.values())
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                const list = (await bot.getFriendList?.()) || (await bot.get_friend_list?.())
                return list || []
            }

            case 'trss': {
                const list = await bot.getFriendList?.()
                return list || []
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 获取好友列表失败: ${err.message}`)
    }

    return []
}

/**
 * 获取群列表 - 统一接口
 * @param {Object} e - 事件对象
 * @returns {Promise<Array>}
 */
export async function getGroupList(e) {
    const bot = e?.bot || Bot
    const platform = detectAdapter(e)

    try {
        switch (platform) {
            case 'icqq': {
                const groupMap = bot.gl || bot.group_map || new Map()
                return Array.from(groupMap.values())
            }

            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                const list = (await bot.getGroupList?.()) || (await bot.get_group_list?.())
                return list || []
            }

            case 'trss': {
                const list = await bot.getGroupList?.()
                return list || []
            }
        }
    } catch (err) {
        logger.debug(`[PlatformAdapter] 获取群列表失败: ${err.message}`)
    }

    return []
}

/**
 * 获取当前 Bot 实例
 * @param {Object} [e] - 事件对象
 * @returns {Object} Bot 实例
 */
export function getBot(e) {
    if (e?.bot) return e.bot
    if (detectFramework() === 'trss' && Bot?.bots) {
        const bots = Array.from(Bot.bots.values())
        return bots[0] || Bot
    }
    return Bot
}

/**
 * 获取 Bot 的 self_id（QQ号）
 * @param {Object} [e] - 事件对象
 * @returns {string|number}
 */
export function getBotSelfId(e) {
    const bot = getBot(e)
    return bot?.uin || bot?.self_id || e?.self_id || ''
}

/**
 * 获取所有在线的 Bot 实例
 * @returns {Array<Object>}
 */
export function getAllBots() {
    if (detectFramework() === 'trss' && Bot?.bots) {
        return Array.from(Bot.bots.values())
    }
    return [Bot]
}

/**
 * 检查 Bot 是否在线
 * @param {Object} [bot] - Bot 实例
 * @returns {boolean}
 */
export function isBotOnline(bot) {
    bot = bot || Bot
    if (typeof bot?.isOnline === 'function') return bot.isOnline()
    if (bot?.status !== undefined) return bot.status === 'online' || bot.status === 11
    return true
}

/**
 * 获取 Bot 的昵称
 * @param {Object} [e] - 事件对象
 * @returns {string}
 */
export function getBotNickname(e) {
    const bot = getBot(e)
    return bot?.nickname || bot?.info?.nickname || 'Bot'
}

/**
 * 检查是否为主人
 * @param {string|number} userId - 用户ID
 * @returns {boolean}
 */
export function isMaster(userId) {
    const masters = Bot?.config?.masterQQ || []
    return masters.includes(Number(userId)) || masters.includes(String(userId))
}

/**
 * 检查是否为管理员（群管理或主人）
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isAdmin(e) {
    if (!e) return false
    if (isMaster(e.user_id)) return true
    if (e.sender?.role === 'admin' || e.sender?.role === 'owner') return true
    return false
}

/**
 * 获取消息发送者显示名称
 * @param {Object} e - 事件对象
 * @returns {string}
 */
export function getSenderName(e) {
    if (!e?.sender) return '用户'
    return e.sender.card || e.sender.nickname || String(e.sender.user_id) || '用户'
}

/**
 * 判断是否为群聊消息
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isGroupMessage(e) {
    return e?.message_type === 'group' || !!e?.group_id
}

/**
 * 判断是否为私聊消息
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isPrivateMessage(e) {
    return e?.message_type === 'private' || (!e?.group_id && e?.user_id)
}

/**
 * 安全回复消息
 * @param {Object} e - 事件对象
 * @param {string|Array} msg - 消息内容
 * @param {boolean} [quote=false] - 是否引用
 * @returns {Promise<Object|null>}
 */
export async function safeReply(e, msg, quote = false) {
    if (!e?.reply || !msg) return null
    try {
        return await e.reply(msg, quote)
    } catch (err) {
        logger?.warn?.('[PlatformAdapter] 回复失败:', err.message)
        return null
    }
}

/**
 * 检测是否为QQBot平台用户
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isQQBotPlatform(e) {
    if (!e) return false
    const bot = e.bot || Bot

    // 检查adapter id/name
    if (bot?.adapter?.id === 'QQBot' || bot?.adapter?.name === 'QQBot') {
        return true
    }

    // 检查version信息
    if (bot?.version?.id === 'QQBot' || bot?.version?.name === 'QQBot') {
        return true
    }

    // 检查self_id格式（QQBot的self_id通常是纯数字appid）
    const selfId = String(e.self_id || bot?.uin || '')

    // 检查user_id格式（QQBot用户ID带有特殊前缀或分隔符）
    const userId = String(e.user_id || e.sender?.user_id || '')
    if (userId.includes(':') || userId.startsWith('qg_')) {
        return true
    }

    // 检查group_id格式
    const groupId = String(e.group_id || '')
    if (groupId.includes(':') || groupId.startsWith('qg_')) {
        return true
    }

    return false
}

/**
 * 将URL转换为二维码图片（base64格式）
 * @param {string} url - 要转换的URL
 * @returns {Promise<string|null>} base64图片字符串，失败返回null
 */
export async function urlToQRCode(url) {
    try {
        const QRCode = (await import('qrcode')).default
        const dataUrl = await QRCode.toDataURL(url, {
            margin: 2,
            width: 256,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        })
        return dataUrl.replace('data:image/png;base64,', 'base64://')
    } catch (err) {
        logger?.debug?.(`[PlatformAdapter] 生成二维码失败: ${err.message}`)
        return null
    }
}

/**
 * 为QQBot平台处理消息中的URL，将其转换为二维码
 * @param {Object} e - 事件对象
 * @param {string|Array} message - 消息内容
 * @param {Object} options - 选项
 * @param {boolean} options.includeButton - 是否添加URL按钮（默认true）
 * @returns {Promise<Array>} 处理后的消息段数组
 */
export async function processUrlForQQBot(e, message, options = {}) {
    const { includeButton = true } = options

    if (!isQQBotPlatform(e)) {
        // 非QQBot平台，直接返回原消息
        return Array.isArray(message) ? message : [message]
    }

    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi
    const segments = []

    // 如果是字符串消息
    if (typeof message === 'string') {
        const urls = message.match(urlRegex) || []
        let text = message

        for (const url of urls) {
            // 生成二维码
            const qrcode = await urlToQRCode(url)
            if (qrcode) {
                // 替换URL为提示文本
                text = text.replace(url, '[链接请扫描下方二维码]')
                // 添加二维码图片
                segments.push({ type: 'image', file: qrcode })
                // 添加URL按钮（如果segment可用）
                if (includeButton && typeof segment !== 'undefined') {
                    try {
                        segments.push(segment.button([{ text: '打开链接', link: url }]))
                    } catch {}
                }
            }
        }

        if (text.trim()) {
            segments.unshift(text)
        }

        return segments.length > 0 ? segments : [message]
    }

    // 如果是消息段数组
    if (Array.isArray(message)) {
        for (const seg of message) {
            if (typeof seg === 'string') {
                const processed = await processUrlForQQBot(e, seg, options)
                segments.push(...processed)
            } else if (seg.type === 'text' && seg.text) {
                const processed = await processUrlForQQBot(e, seg.text, options)
                segments.push(...processed)
            } else {
                segments.push(seg)
            }
        }
        return segments
    }

    return [message]
}

/**
 * 智能发送消息 - 自动处理QQBot平台的URL转二维码
 * @param {Object} e - 事件对象
 * @param {string|Array} message - 消息内容
 * @param {boolean} quote - 是否引用回复
 * @returns {Promise<Object|null>}
 */
export async function smartReply(e, message, quote = false) {
    if (!e?.reply) return null

    try {
        // 对QQBot平台自动处理URL
        if (isQQBotPlatform(e)) {
            const processedMsg = await processUrlForQQBot(e, message)
            return await e.reply(processedMsg, quote)
        }

        return await e.reply(message, quote)
    } catch (err) {
        logger?.warn?.('[PlatformAdapter] 智能回复失败:', err.message)
        // 回退到普通回复
        return await safeReply(e, message, quote)
    }
}

/**
 * @deprecated 使用 detectFramework 代替
 */
export function getBotFramework() {
    return detectFramework()
}

/**
 * @deprecated 使用 detectAdapter 代替
 */
export function getAdapter(e) {
    return detectAdapter(e)
}

/**
 * @deprecated 使用 getBotInfo 代替
 */
export function getFrameworkInfo(e) {
    return {
        framework: detectFramework(),
        adapter: detectAdapter(e)
    }
}

export default {
    // 平台检测
    detectFramework,
    detectAdapter,
    detectPlatform,
    getBotInfo,
    isQQBotPlatform,
    // Bot 实例管理
    getBot,
    getBotSelfId,
    getAllBots,
    isBotOnline,
    getBotNickname,
    // 权限检查
    isMaster,
    isAdmin,
    // 消息辅助
    getSenderName,
    isGroupMessage,
    isPrivateMessage,
    safeReply,
    smartReply,
    // QQBot URL处理
    urlToQRCode,
    processUrlForQQBot,
    // 用户/群信息
    getUserInfo,
    getGroupInfo,
    getGroupMemberList,
    // 消息操作
    getMessage,
    deleteMessage,
    sendPoke,
    sendGroupMessage,
    sendPrivateMessage,
    // 群管理
    setGroupBan,
    setGroupCard,
    // 列表获取
    getFriendList,
    getGroupList,
    getGroupChatHistory,
    // 头像
    getAvatarUrl,
    getQQBotAvatarUrl,
    getGroupAvatarUrl,
    // 消息段处理
    normalizeSegment,
    buildSegment,
    // 兼容旧版
    getBotFramework,
    getAdapter,
    getFrameworkInfo
}
