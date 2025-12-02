/**
 * 多平台适配器
 * 统一不同框架和适配器的 API 调用
 * 
 * 框架 (Framework):
 * - TRSS-Yunzai (trss)
 * - Miao-Yunzai (miao)
 * 
 * 适配器 (Adapter):
 * - icqq: https://icqq.pages.dev
 * - NapCat: https://napneko.github.io/develop/msg
 * - go-cqhttp / Lagrange / OneBot 等
 */

/**
 * 检测框架类型
 * @returns {'trss'|'miao'}
 */
export function detectFramework() {
    // 直接检测，避免循环依赖
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
    
    // icqq 特征: 有 pickGroup 且有 gml
    if (typeof bot?.pickGroup === 'function' && bot?.gml) {
        return 'icqq'
    }
    
    // 通用 OneBot
    if (typeof bot?.getMsg === 'function') {
        return 'onebot'
    }
    
    return 'unknown'
}

/**
 * 兼容旧版API: detectPlatform
 * @deprecated 使用 detectAdapter 代替
 */
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
 * 获取用户信息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @param {string|number} [groupId] - 群ID (可选)
 * @returns {Promise<Object>} 用户信息
 */
export async function getUserInfo(e, userId, groupId = null) {
    const bot = e?.bot || Bot
    const platform = detectPlatform(e)
    userId = parseInt(userId)
    
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
        avatar: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
    }
    
    try {
        switch (platform) {
            case 'icqq': {
                if (groupId) {
                    // 获取群成员信息
                    const group = bot.pickGroup(parseInt(groupId))
                    const member = group.pickMember(userId)
                    const info = await member.getInfo?.() || member.info || member
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
                        info = await friend.getInfo?.() || friend.info || friend
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
                    const info = await bot.getGroupMemberInfo?.(parseInt(groupId), userId, true) ||
                                await bot.get_group_member_info?.({ group_id: parseInt(groupId), user_id: userId, no_cache: true })
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
                    const info = await bot.getStrangerInfo?.(userId, true) ||
                                await bot.get_stranger_info?.({ user_id: userId, no_cache: true })
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
                const info = await group.getInfo?.() || group.info || group
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
                const info = await bot.getGroupInfo?.(groupId, true) ||
                            await bot.get_group_info?.({ group_id: groupId, no_cache: true })
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
                const memberMap = await group.getMemberMap?.() || group.member_map || new Map()
                return Array.from(memberMap.values())
            }
            
            case 'napcat':
            case 'onebot':
            case 'go-cqhttp':
            case 'lagrange': {
                const list = await bot.getGroupMemberList?.(groupId, true) ||
                            await bot.get_group_member_list?.({ group_id: groupId, no_cache: true })
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
                const msg = await bot.getMsg?.(messageId) ||
                           await bot.get_msg?.({ message_id: messageId })
                return msg || null
            }
            
            case 'trss': {
                return await bot.getMsg?.(messageId) || null
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
                    await bot.sendGroupPoke?.(parseInt(groupId), userId) ||
                          await bot.send_group_poke?.({ group_id: parseInt(groupId), user_id: userId }) ||
                          await bot.group_poke?.({ group_id: parseInt(groupId), user_id: userId })
                } else {
                    await bot.sendFriendPoke?.(userId) ||
                          await bot.send_friend_poke?.({ user_id: userId }) ||
                          await bot.friend_poke?.({ user_id: userId })
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
 * 获取头像URL - 统一接口
 * @param {string|number} userId - 用户ID
 * @param {number} [size=640] - 头像尺寸
 * @returns {string} 头像URL
 */
export function getAvatarUrl(userId, size = 640) {
    userId = parseInt(userId)
    // QQ头像接口
    return `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=${size}`
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

export default {
    detectPlatform,
    getBotInfo,
    getUserInfo,
    getGroupInfo,
    getGroupMemberList,
    getMessage,
    sendPoke,
    getAvatarUrl,
    getGroupAvatarUrl,
    normalizeSegment,
    buildSegment
}
