/**
 * 消息操作工具
 * 发送消息、@用户、获取聊天记录等
 */

import { 
    getGroupMemberList, 
    filterMembers, 
    randomSelectMembers, 
    findMemberByName,
    formatMemberInfo,
    batchSendMessages,
    getMasterList,
    detectProtocol,
    normalizeSegment,
    normalizeSegments,
    compatSegment,
    sendForwardMsgEnhanced,
    sendCardMessage,
    parseCardData,
    buildLinkCard,
    buildBigImageCard
} from './helpers.js'
import { recordSentMessage } from '../../utils/messageDedup.js'

const SEND_DEDUP_EXPIRE = 5000 
const recentSentMessages = new Map()  
/**
 * 生成消息发送的去重键
 * @param {Object} ctx - 上下文
 * @param {string} content - 消息内容
 * @returns {string}
 */
function getSendDedupKey(ctx, content) {
    const e = ctx?.getEvent?.() || {}
    const groupId = e.group_id || ''
    const userId = e.user_id || ''
    // 取消息前100字符作为指纹
    const contentFp = (content || '').substring(0, 100).trim()
    return `${groupId}_${userId}_${contentFp}`
}

/**
 * 检查是否是重复发送（短时间内发送相同内容）
 * @param {Object} ctx - 上下文
 * @param {string} content - 消息内容
 * @returns {{ isDuplicate: boolean, count: number }}
 */
function checkSendDuplicate(ctx, content) {
    const key = getSendDedupKey(ctx, content)
    const now = Date.now()
    
    // 清理过期记录
    for (const [k, v] of recentSentMessages) {
        if (now - v.timestamp > SEND_DEDUP_EXPIRE) {
            recentSentMessages.delete(k)
        }
    }
    
    const existing = recentSentMessages.get(key)
    if (existing && now - existing.timestamp < SEND_DEDUP_EXPIRE) {
        existing.count++
        existing.timestamp = now
        return { isDuplicate: true, count: existing.count }
    }
    
    // 记录本次发送
    recentSentMessages.set(key, { content, timestamp: now, count: 1 })
    return { isDuplicate: false, count: 1 }
}

/**
 * 标记消息已发送（用于跨工具去重）
 * @param {Object} ctx - 上下文
 * @param {string} content - 消息内容
 */
function markMessageSent(ctx, content) {
    const key = getSendDedupKey(ctx, content)
    recentSentMessages.set(key, { content, timestamp: Date.now(), count: 1 })
}

export const messageTools = [
    {
        name: 'send_to_master',
        description: '发送私聊消息给主人。可以主动向主人报告信息、发送通知等。',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '文本消息内容' },
                image_url: { type: 'string', description: '图片URL（可选）' },
                master_index: { type: 'number', description: '主人索引（0=第一个主人，默认0）' },
                all_masters: { type: 'boolean', description: '是否发送给所有主人（默认false）' }
            },
            required: ['message']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                const botId = bot.uin || bot.self_id
                const masters = await getMasterList(botId)
                if (masters.length === 0) {
                    return { success: false, error: '未配置主人QQ，请在Yunzai配置中设置masterQQ' }
                }
                const msgParts = []
                if (args.message) msgParts.push(args.message)
                if (args.image_url) msgParts.push(segment.image(args.image_url))
                
                if (msgParts.length === 0) {
                    return { success: false, error: '消息内容不能为空' }
                }
                
                const results = []
                
                if (args.all_masters) {
                    for (let i = 0; i < masters.length; i++) {
                        const masterId = parseInt(masters[i])
                        try {
                            const friend = bot.pickFriend(masterId)
                            const result = await friend.sendMsg(msgParts.length === 1 ? msgParts[0] : msgParts)
                            const msgId = result?.message_id
                            const sendFailed = !msgId || (Array.isArray(msgId) && msgId.length === 0)
                            if (sendFailed) {
                                results.push({ master_id: masterId, success: false, error: '发送失败，可能需要添加好友或被风控' })
                            } else {
                                results.push({ master_id: masterId, success: true, message_id: msgId })
                            }
                        } catch (err) {
                            results.push({ master_id: masterId, success: false, error: err.message })
                        }
                    }
                    const successCount = results.filter(r => r.success).length
                    return {
                        success: successCount > 0,
                        total: masters.length,
                        success_count: successCount,
                        results
                    }
                } else {
                    // 发送给指定主人
                    const idx = args.master_index || 0
                    if (idx >= masters.length) {
                        return { success: false, error: `主人索引超出范围，当前共有 ${masters.length} 个主人` }
                    }
                    const masterId = parseInt(masters[idx])
                    const friend = bot.pickFriend(masterId)
                    const result = await friend.sendMsg(msgParts.length === 1 ? msgParts[0] : msgParts)
                    
                    // 检查发送结果
                    const msgId = result?.message_id
                    const sendFailed = !msgId || (Array.isArray(msgId) && msgId.length === 0)
                    
                    if (sendFailed) {
                        return { 
                            success: false, 
                            master_id: masterId, 
                            error: '消息发送失败，可能需要先添加主人为好友，或账号被风控'
                        }
                    }
                    
                    if (args.message) recordSentMessage(args.message)
                    return { success: true, master_id: masterId, message_id: msgId }
                }
            } catch (err) {
                return { success: false, error: `发送给主人失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_master_info',
        description: '获取主人信息列表',
        inputSchema: {
            type: 'object',
            properties: {
                debug: { type: 'boolean', description: '是否返回调试信息' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                const botId = bot.uin || bot.self_id
                
                // 调试模式：返回所有可能的配置源
                if (args.debug) {
                    const debugInfo = {
                        botId,
                        'global.cfg exists': !!global.cfg,
                        'global.cfg.master': global.cfg?.master,
                        'global.cfg.masterQQ': global.cfg?.masterQQ,
                        'global.Bot.config': global.Bot?.config,
                        'global.Bot.master': global.Bot?.master,
                    }
                    return { success: true, debug: debugInfo }
                }
                
                const masters = await getMasterList(botId)
                if (masters.length === 0) {
                    return { success: true, count: 0, masters: [], note: '未配置主人QQ' }
                }
                
                // 获取主人详细信息
                const masterInfos = []
                for (let i = 0; i < masters.length; i++) {
                    const masterId = parseInt(masters[i])
                    let info = { index: i, user_id: masterId }
                    
                    try {
                        // 尝试获取好友信息
                        if (bot.fl?.get) {
                            const friendInfo = bot.fl.get(masterId)
                            if (friendInfo) {
                                info.nickname = friendInfo.nickname || friendInfo.nick
                                info.remark = friendInfo.remark
                                info.is_friend = true
                            }
                        }
                        // 尝试通过 pickFriend 获取
                        if (!info.nickname && bot.pickFriend) {
                            const friend = bot.pickFriend(masterId)
                            if (friend?.info) {
                                const fInfo = await friend.getInfo?.() || friend.info
                                info.nickname = fInfo?.nickname || fInfo?.nick
                                info.is_friend = true
                            }
                        }
                    } catch {}
                    
                    masterInfos.push(info)
                }
                
                return {
                    success: true,
                    count: masters.length,
                    masters: masterInfos
                }
            } catch (err) {
                return { success: false, error: `获取主人信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_private_message',
        description: '发送私聊消息给指定用户',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '目标用户的QQ号' },
                message: { type: 'string', description: '文本消息内容' },
                image_url: { type: 'string', description: '图片URL（可选）' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const dedupResult = checkSendDuplicate(ctx, args.message)
                if (dedupResult.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${dedupResult.count}次)，已跳过`, skipped: true }
                }
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id)
                const friend = bot.pickFriend(userId)

                const msgParts = []
                if (args.message) msgParts.push(args.message)
                if (args.image_url) msgParts.push(segment.image(args.image_url))

                if (msgParts.length === 0) {
                    return { success: false, error: '消息内容不能为空' }
                }
                const result = await friend.sendMsg(msgParts.length === 1 ? msgParts[0] : msgParts)
                if (args.message) recordSentMessage(args.message)
                return { success: true, message_id: result.message_id, user_id: userId }
            } catch (err) {
                return { success: false, error: `发送私聊消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_group_message',
        description: '发送群消息',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '目标群号' },
                message: { type: 'string', description: '文本消息内容' },
                at_user: { type: 'string', description: '要@的用户QQ号，"all"表示@全体' },
                image_url: { type: 'string', description: '图片URL（可选）' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                // 去重检查
                const dedupResult = checkSendDuplicate(ctx, args.message)
                if (dedupResult.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${dedupResult.count}次)，已跳过`, skipped: true }
                }
                
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                const group = bot.pickGroup(groupId)

                const msgParts = []
                if (args.at_user) {
                    msgParts.push(args.at_user === 'all' ? segment.at('all') : segment.at(args.at_user))
                }
                if (args.message) msgParts.push(args.message)
                if (args.image_url) msgParts.push(segment.image(args.image_url))

                if (msgParts.length === 0) {
                    return { success: false, error: '消息内容不能为空' }
                }

                const result = await group.sendMsg(msgParts.length === 1 ? msgParts[0] : msgParts)
                // 记录发送消息指纹，防止回显被重复处理
                if (args.message) recordSentMessage(args.message)
                return { success: true, message_id: result.message_id, group_id: groupId }
            } catch (err) {
                return { success: false, error: `发送群消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'reply_current_message',
        description: '回复当前会话消息（自动判断群聊/私聊）',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '回复内容' },
                at_sender: { type: 'boolean', description: '是否@发送者（仅群聊有效）' },
                quote: { type: 'boolean', description: '是否引用原消息' }
            },
            required: ['message']
        },
        handler: async (args, ctx) => {
            try {
                // 去重检查
                const dedupResult = checkSendDuplicate(ctx, args.message)
                if (dedupResult.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${dedupResult.count}次)，已跳过`, skipped: true }
                }
                
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                const msgParts = []
                if (args.at_sender && e.group_id) {
                    msgParts.push(segment.at(e.user_id))
                    msgParts.push(' ')
                }
                msgParts.push(args.message)

                const result = await e.reply(msgParts, args.quote || false)
                // 记录发送消息指纹，防止回显被重复处理
                if (args.message) recordSentMessage(args.message)
                return { 
                    success: true, 
                    message_id: result?.message_id,
                    is_group: !!e.group_id
                }
            } catch (err) {
                return { success: false, error: `回复消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'at_user',
        description: '发送@用户的消息。支持通过QQ号、昵称查找，支持多次发送。',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '要@的用户QQ号，"sender"表示@发送者，"all"表示@全体' },
                nickname: { type: 'string', description: '通过昵称/群名片查找用户（仅群聊）' },
                message: { type: 'string', description: '附带的消息内容' },
                count: { type: 'number', description: '发送次数，默认1次，最多10次', minimum: 1, maximum: 10 },
                interval: { type: 'number', description: '多次发送间隔(ms)，默认500', minimum: 200 }
            }
        },
        handler: async (args, ctx) => {
            try {
                // 去重检查
                const dedupResult = checkSendDuplicate(ctx, args.message)
                if (dedupResult.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${dedupResult.count}次)，已跳过`, skipped: true }
                }
                
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                let targetId = args.user_id
                let matchedName = null
                
                // 通过昵称查找
                if (args.nickname && e.group_id) {
                    const memberList = await getGroupMemberList({ bot, event: e })
                    const result = findMemberByName(memberList, args.nickname)
                    
                    if (result) {
                        targetId = String(result.member.user_id || result.member.uid)
                        matchedName = result.member.card || result.member.nickname || result.member.nick
                    } else {
                        return { success: false, error: `未找到昵称"${args.nickname}"的群成员` }
                    }
                } else if (!targetId) {
                    return { success: false, error: '必须提供 user_id 或 nickname 参数' }
                }
                
                if (targetId === 'sender') targetId = e.user_id
                
                const msgParts = []
                if (targetId === 'all') {
                    if (!e.group_id) return { success: false, error: '@全体仅在群聊中有效' }
                    msgParts.push(segment.at('all'))
                } else {
                    msgParts.push(segment.at(targetId))
                }
                if (args.message) msgParts.push(' ' + args.message)

                const results = await batchSendMessages({
                    event: e,
                    messages: msgParts,
                    count: args.count || 1,
                    interval: args.interval || 500
                })
                
                // 记录发送消息指纹
                if (args.message) recordSentMessage(args.message)
                
                const successCount = results.filter(r => r.success).length
                return { 
                    success: successCount > 0, 
                    total_count: results.length,
                    success_count: successCount,
                    at_target: targetId,
                    matched_name: matchedName,
                    results: results.length > 1 ? results : undefined,
                    message_id: results[0]?.message_id
                }
            } catch (err) {
                return { success: false, error: `@用户失败: ${err.message}` }
            }
        }
    },

    {
        name: 'at_role',
        description: '按角色随机@群成员。支持@管理员、普通成员等，可指定数量和是否排除群主。解决"帮我at一个随机管理员"的需求。',
        inputSchema: {
            type: 'object',
            properties: {
                role: { 
                    type: 'string', 
                    description: '目标角色：admin(管理员含群主)、admin_only(仅管理员不含群主)、owner(群主)、member(普通成员)、any(任意成员)',
                    enum: ['admin', 'admin_only', 'owner', 'member', 'any']
                },
                count: { type: 'number', description: '要选择的人数，默认1', minimum: 1, maximum: 10 },
                message: { type: 'string', description: '附带的消息内容' },
                exclude_self: { type: 'boolean', description: '是否排除自己（触发者），默认false' },
                exclude_bot: { type: 'boolean', description: '是否排除机器人，默认true' },
                send_count: { type: 'number', description: '发送次数（每次随机选择），默认1', minimum: 1, maximum: 5 },
                interval: { type: 'number', description: '多次发送间隔(ms)，默认500', minimum: 200 }
            },
            required: ['role']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                if (!e || !e.group_id) {
                    return { success: false, error: '此功能仅在群聊中有效' }
                }

                const botId = bot.uin || bot.self_id
                const memberList = await getGroupMemberList({ bot, event: e })
                
                if (memberList.length === 0) {
                    return { success: false, error: '获取群成员列表失败' }
                }

                // 按角色筛选
                const role = args.role === 'any' ? null : args.role
                const excludeUsers = []
                if (args.exclude_self) excludeUsers.push(String(e.user_id))
                
                const candidates = filterMembers(memberList, {
                    role,
                    excludeBot: args.exclude_bot !== false,
                    excludeUsers,
                    botId
                })

                if (candidates.length === 0) {
                    const roleNames = {
                        admin: '管理员',
                        admin_only: '管理员（不含群主）',
                        owner: '群主',
                        member: '普通成员',
                        any: '成员'
                    }
                    return { success: false, error: `没有符合条件的${roleNames[args.role] || '成员'}可供选择` }
                }

                const selectCount = Math.min(args.count || 1, candidates.length)
                const sendCount = Math.min(args.send_count || 1, 5)
                const interval = Math.max(args.interval || 500, 200)
                const allResults = []

                for (let s = 0; s < sendCount; s++) {
                    // 每次发送重新随机选择
                    const selected = randomSelectMembers(candidates, selectCount)
                    
                    const msgParts = []
                    for (const member of selected) {
                        msgParts.push(segment.at(member.user_id || member.uid))
                        msgParts.push(' ')
                    }
                    if (args.message) msgParts.push(args.message)

                    try {
                        const result = await e.reply(msgParts)
                        // 记录发送消息指纹
                        if (args.message) recordSentMessage(args.message)
                        allResults.push({
                            index: s + 1,
                            success: true,
                            message_id: result?.message_id,
                            selected: selected.map(formatMemberInfo)
                        })
                    } catch (err) {
                        allResults.push({
                            index: s + 1,
                            success: false,
                            error: err.message
                        })
                    }

                    if (s < sendCount - 1) {
                        await new Promise(r => setTimeout(r, interval))
                    }
                }

                const successCount = allResults.filter(r => r.success).length
                return {
                    success: successCount > 0,
                    role: args.role,
                    candidates_count: candidates.length,
                    select_count: selectCount,
                    send_count: sendCount,
                    success_count: successCount,
                    results: allResults
                }
            } catch (err) {
                return { success: false, error: `按角色@成员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'random_at',
        description: '随机@群成员。可排除管理员、群主等，支持批量@多人。',
        inputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number', description: '要@的人数，默认1', minimum: 1, maximum: 10 },
                message: { type: 'string', description: '附带的消息内容' },
                exclude_admin: { type: 'boolean', description: '是否排除管理员，默认false' },
                exclude_owner: { type: 'boolean', description: '是否排除群主，默认false' },
                exclude_bot: { type: 'boolean', description: '是否排除机器人，默认true' },
                exclude_self: { type: 'boolean', description: '是否排除触发者，默认false' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                if (!e || !e.group_id) {
                    return { success: false, error: '此功能仅在群聊中有效' }
                }

                const botId = bot.uin || bot.self_id
                const memberList = await getGroupMemberList({ bot, event: e })
                
                if (memberList.length === 0) {
                    return { success: false, error: '获取群成员列表失败' }
                }

                const excludeUsers = []
                if (args.exclude_self) excludeUsers.push(String(e.user_id))

                const candidates = filterMembers(memberList, {
                    excludeBot: args.exclude_bot !== false,
                    excludeOwner: args.exclude_owner,
                    excludeAdmin: args.exclude_admin,
                    excludeUsers,
                    botId
                })

                if (candidates.length === 0) {
                    return { success: false, error: '没有符合条件的群成员可供选择' }
                }

                const count = Math.min(args.count || 1, candidates.length)
                const selected = randomSelectMembers(candidates, count)

                const msgParts = []
                for (const member of selected) {
                    msgParts.push(segment.at(member.user_id || member.uid))
                    msgParts.push(' ')
                }
                if (args.message) msgParts.push(args.message)

                const result = await e.reply(msgParts)
                // 记录发送消息指纹
                if (args.message) recordSentMessage(args.message)
                return {
                    success: true,
                    message_id: result?.message_id,
                    selected_count: selected.length,
                    selected_members: selected.map(formatMemberInfo)
                }
            } catch (err) {
                return { success: false, error: `随机@成员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_chat_history',
        description: '获取聊天历史记录',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号（群聊时）' },
                user_id: { type: 'string', description: '用户QQ号（私聊时）' },
                count: { type: 'number', description: '获取数量，默认20' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const e = ctx.getEvent()
                const count = args.count || 20
                
                let target
                let isGroup = false
                
                if (args.group_id) {
                    target = bot.pickGroup(parseInt(args.group_id))
                    isGroup = true
                } else if (args.user_id) {
                    target = bot.pickFriend(parseInt(args.user_id))
                } else if (e?.group_id) {
                    target = bot.pickGroup(e.group_id)
                    isGroup = true
                } else if (e?.user_id) {
                    target = bot.pickFriend(e.user_id)
                } else {
                    return { success: false, error: '需要指定 group_id 或 user_id' }
                }
                
                if (!target?.getChatHistory) {
                    return { success: false, error: '无法获取聊天记录' }
                }
                
                const history = await target.getChatHistory(0, count)
                const messages = (history || []).slice(-count).map(msg => ({
                    time: msg.time,
                    user_id: msg.sender?.user_id || msg.user_id,
                    nickname: msg.sender?.nickname || msg.sender?.card || '',
                    content: msg.raw_message || msg.message?.map(m => m.text || `[${m.type}]`).join('') || ''
                }))
                
                return { 
                    success: true, 
                    is_group: isGroup,
                    count: messages.length, 
                    messages 
                }
            } catch (err) {
                return { success: false, error: `获取聊天记录失败: ${err.message}` }
            }
        }
    },

    {
        name: 'recall_message',
        description: '撤回消息（仅限2分钟内的消息）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const e = ctx.getEvent()
                
                if (bot.deleteMsg) {
                    await bot.deleteMsg(args.message_id)
                } else if (e?.group_id) {
                    const group = bot.pickGroup(e.group_id)
                    await group.recallMsg(args.message_id)
                } else {
                    return { success: false, error: '无法撤回消息' }
                }
                
                return { success: true, message_id: args.message_id }
            } catch (err) {
                return { success: false, error: `撤回失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_forward_msg',
        description: '获取合并转发消息的内容',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '转发消息ID（res_id）' }
            },
            required: ['id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                let forwardContent = null
                
                // NapCat/go-cqhttp API
                if (bot.getForwardMsg) {
                    forwardContent = await bot.getForwardMsg(args.id)
                } else if (bot.get_forward_msg) {
                    forwardContent = await bot.get_forward_msg(args.id)
                }
                
                if (!forwardContent) {
                    return { success: false, error: '获取转发内容失败' }
                }
                
                // 解析转发消息列表
                const messages = forwardContent.messages || forwardContent.message || []
                const parsed = messages.map((msg, idx) => ({
                    index: idx,
                    sender: {
                        user_id: msg.sender?.user_id || msg.user_id,
                        nickname: msg.sender?.nickname || msg.nickname || '未知'
                    },
                    time: msg.time,
                    content: parseForwardContent(msg.content || msg.message || [])
                }))
                
                return {
                    success: true,
                    count: parsed.length,
                    messages: parsed
                }
            } catch (err) {
                return { success: false, error: `获取转发消息失败: ${err.message}` }
            }
        }
    },
    
    {
        name: 'send_forward_msg',
        description: '【统一】发送合并转发消息。支持伪造多人对话、富文本内容（图片、@、表情等）。消息内容支持特殊标记：[图片:url]、[@qq]、[表情:id]等。可自定义外显标题、摘要。',
        inputSchema: {
            type: 'object',
            properties: {
                messages: {
                    type: 'array',
                    description: '消息列表，每条消息包含发送者信息和内容',
                    items: {
                        type: 'object',
                        properties: {
                            user_id: { type: 'string', description: '发送者QQ号（可以是任意数字）' },
                            nickname: { type: 'string', description: '发送者显示名称（可选，默认使用QQ号）' },
                            message: { type: 'string', description: '消息内容（支持文本、[图片:url]、[@qq]等标记）' },
                            time: { type: 'number', description: '时间戳（可选）' }
                        },
                        required: ['user_id', 'message']
                    }
                },
                group_id: { type: 'string', description: '目标群号（发送到指定群，优先级最高）' },
                user_id: { type: 'string', description: '目标用户QQ号（发送私聊，优先级次于group_id）' },
                to_master: { type: 'boolean', description: '是否发送给主人（私聊第一个主人，优先级最低）' },
                prompt: { type: 'string', description: '转发卡片外显标题（可选，如"群聊的聊天记录"）' },
                summary: { type: 'string', description: '底部摘要文本（可选，如"查看3条转发消息"）' },
                source: { type: 'string', description: '来源显示（可选，如"聊天记录"）' }
            },
            required: ['messages']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                if (!args.messages || args.messages.length === 0) {
                    return { success: false, error: '消息列表不能为空' }
                }
                
                // 确定发送目标
                let targetGroupId = null
                let targetUserId = null
                
                if (args.group_id) {
                    targetGroupId = parseInt(args.group_id)
                } else if (args.user_id) {
                    targetUserId = parseInt(args.user_id)
                } else if (args.to_master) {
                    const botId = bot.uin || bot.self_id
                    const masters = await getMasterList(botId)
                    if (masters.length === 0) {
                        return { success: false, error: '未配置主人QQ，无法发送给主人' }
                    }
                    targetUserId = parseInt(masters[0])
                } else if (e) {
                    if (e.group_id) {
                        targetGroupId = e.group_id
                    } else {
                        targetUserId = e.user_id || e.sender?.user_id
                    }
                } else {
                    return { success: false, error: '没有指定发送目标，请提供 group_id、user_id 或设置 to_master' }
                }
                
                if (!targetGroupId && !targetUserId) {
                    return { success: false, error: '无法确定发送目标' }
                }
                
                // 使用增强版发送函数
                const result = await sendForwardMsgEnhanced({
                    bot,
                    event: e,
                    groupId: targetGroupId,
                    userId: targetUserId,
                    messages: args.messages.map(msg => ({
                        user_id: msg.user_id || msg.uin,
                        nickname: msg.nickname || msg.name,
                        content: msg.message || msg.content,
                        time: msg.time
                    })),
                    display: {
                        prompt: args.prompt,
                        summary: args.summary,
                        source: args.source
                    }
                })
                
                return result
            } catch (err) {
                return { success: false, error: `发送伪造转发失败: ${err.message}` }
            }
        }
    },

    {
        name: 'resend_quoted_card',
        description: '【推荐】重新发送引用消息中的卡片。当用户回复/引用了一条卡片消息（如哔哩哔哩分享、小程序、链接卡片等）并要求"发一个一样的"、"转发"、"复制"时，必须使用此工具。此工具会自动提取原始卡片数据并重新发送，无需任何参数。【重要】如果用户说"伪造消息"、"假转发"、"合并转发"，则设置 as_forward=true。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '目标群号（可选，不填则发送到当前会话）' },
                user_id: { type: 'string', description: '目标用户QQ号（可选，私聊）' },
                as_forward: { type: 'boolean', description: '是否作为合并转发消息发送。用户说"伪造消息"、"假转发"、"合并转发"时设置为true' },
                forward_nickname: { type: 'string', description: '转发时显示的昵称（可选）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || ctx.getBot?.() || global.Bot
                
                if (!bot && !e) {
                    return { success: false, error: '没有可用的会话上下文或Bot实例' }
                }
                
                // 从引用消息中提取卡片数据
                let jsonData = null
                let cardSource = null
                
                // 尝试从 e.source 或 e.reply 获取引用消息
                let replyMsg = null
                if (e?.getReply) {
                    try {
                        replyMsg = await e.getReply()
                    } catch {}
                }
                if (!replyMsg && e?.source) {
                    replyMsg = e.source
                }
                
                if (!replyMsg) {
                    return { success: false, error: '没有找到引用消息，请确保回复了一条包含卡片的消息' }
                }
                
                // 从引用消息中查找 json 类型的消息段
                const message = replyMsg.message || replyMsg.content || []
                const msgArray = Array.isArray(message) ? message : [message]
                
                for (const seg of msgArray) {
                    const segType = seg.type || ''
                    const segData = seg.data || seg
                    
                    if (segType === 'json') {
                        jsonData = typeof segData === 'string' ? segData : (segData.data || segData)
                        
                        // 如果还是对象，序列化它
                        if (typeof jsonData === 'object') {
                            jsonData = JSON.stringify(jsonData)
                        }
                        
                        if (typeof jsonData === 'string') {
                            try {
                                const parsed = JSON.parse(jsonData)
                                if (parsed.app) {
                                    cardSource = 'json_segment'
                                    break
                                }
                            } catch {}
                        }
                    }
                }
                
                // 方式2: 尝试从 seg 本身获取（icqq 可能直接在 seg 上存储）
                if (!jsonData) {
                    for (const seg of msgArray) {
                        if (seg.type === 'json' && seg.data) {
                            // icqq 有时候 data 就是完整的 JSON 字符串
                            const d = seg.data
                            if (typeof d === 'string' && d.includes('"app"')) {
                                jsonData = d
                                cardSource = 'icqq_direct'
                                break
                            }
                        }
                    }
                }
                
                // 方式3: 尝试从 raw_message 解析 CQ 码
                if (!jsonData && replyMsg.raw_message) {
                    const rawMsg = replyMsg.raw_message
                    const jsonMatch = rawMsg.match(/\[CQ:json,data=([^\]]+)\]/)
                    if (jsonMatch) {
                        try {
                            let data = jsonMatch[1]
                                .replace(/&#91;/g, '[')
                                .replace(/&#93;/g, ']')
                                .replace(/&#44;/g, ',')
                                .replace(/&amp;/g, '&')
                            jsonData = data
                            cardSource = 'cq_code'
                        } catch {}
                    }
                }
                
                // 方式4: 尝试从 replyMsg 的其他字段获取
                if (!jsonData) {
                    // 有些框架可能在 json_card 或 card 字段
                    const candidates = [replyMsg.json_card, replyMsg.card, replyMsg.json]
                    for (const c of candidates) {
                        if (c) {
                            jsonData = typeof c === 'string' ? c : JSON.stringify(c)
                            cardSource = 'reply_field'
                            break
                        }
                    }
                }
                
                if (!jsonData) {
                    // 返回调试信息帮助诊断
                    return { 
                        success: false, 
                        error: '引用消息中没有找到卡片内容',
                        note: '请确保回复的是一条包含JSON卡片的消息（如分享链接、小程序等）',
                        debug: {
                            hasReplyMsg: !!replyMsg,
                            segmentCount: msgArray.length,
                            segmentTypes: msgArray.map(s => s.type || 'unknown'),
                            hasRawMessage: !!replyMsg.raw_message
                        }
                    }
                }
                
                // 确保是字符串
                if (typeof jsonData !== 'string') {
                    jsonData = JSON.stringify(jsonData)
                }
                const isIcqq = !!(bot?.pickGroup || bot?.pickFriend || bot?.gl || bot?.fl)
                const isNapCat = bot?.version?.app_name?.toLowerCase?.()?.includes?.('napcat')
                const jsonSeg = isIcqq && !isNapCat
                    ? { type: 'json', data: jsonData }
                    : { type: 'json', data: { data: jsonData } }
                
                let result = null
                let lastError = null
                
                const targetGroupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                const targetUserId = args.user_id ? parseInt(args.user_id) : (!targetGroupId ? e?.user_id : null)
                
                // 如果需要作为转发消息发送
                if (args.as_forward) {
                    const senderInfo = replyMsg.sender || {}
                    const nickname = args.forward_nickname || senderInfo.nickname || senderInfo.card || String(senderInfo.user_id || '10000')
                    const userId = String(senderInfo.user_id || '10000')
                    
                    const node = {
                        type: 'node',
                        data: {
                            user_id: userId,
                            nickname: nickname,
                            content: [jsonSeg]
                        }
                    }
                    
                    if (bot.sendApi) {
                        try {
                            const apiName = targetGroupId ? 'send_group_forward_msg' : 'send_private_forward_msg'
                            const params = targetGroupId 
                                ? { group_id: targetGroupId, messages: [node] }
                                : { user_id: targetUserId, messages: [node] }
                            result = await bot.sendApi(apiName, params)
                        } catch (err) {
                            lastError = err.message
                        }
                    }
                } else {
                    // 直接发送卡片
                    if (bot?.sendApi) {
                        try {
                            if (targetGroupId) {
                                result = await bot.sendApi('send_group_msg', { 
                                    group_id: targetGroupId, 
                                    message: [jsonSeg] 
                                })
                            } else if (targetUserId) {
                                result = await bot.sendApi('send_private_msg', { 
                                    user_id: targetUserId, 
                                    message: [jsonSeg] 
                                })
                            }
                        } catch (err) {
                            lastError = err.message
                        }
                    }
                    
                    // icqq 方式
                    if (!result && (bot?.pickGroup || bot?.pickFriend)) {
                        try {
                            if (targetGroupId && bot.pickGroup) {
                                result = await bot.pickGroup(targetGroupId)?.sendMsg(jsonSeg)
                            } else if (targetUserId && bot.pickFriend) {
                                result = await bot.pickFriend(targetUserId)?.sendMsg(jsonSeg)
                            }
                        } catch (err) {
                            lastError = err.message
                        }
                    }
                    
                    // e.reply
                    if (!result && e?.reply) {
                        try {
                            result = await e.reply(jsonSeg)
                        } catch (err) {
                            lastError = err.message
                        }
                    }
                }
                
                if (result) {
                    return {
                        success: true,
                        message_id: result?.message_id || result?.data?.message_id,
                        card_source: cardSource,
                        as_forward: !!args.as_forward
                    }
                }
                
                return { 
                    success: false, 
                    error: `发送卡片失败: ${lastError || '未知错误'}`,
                    note: '可能是协议端不支持发送此类型的卡片'
                }
            } catch (err) {
                return { success: false, error: `重发引用卡片失败: ${err.message}` }
            }
        }
    },
    
    {
        name: 'mark_msg_as_read',
        description: '标记消息为已读（NapCat扩展）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                if (bot.markMsgAsRead) {
                    await bot.markMsgAsRead(args.message_id)
                    return { success: true }
                }
                
                if (bot.mark_msg_as_read) {
                    await bot.mark_msg_as_read(args.message_id)
                    return { success: true }
                }
                
                if (bot.sendApi) {
                    await bot.sendApi('mark_msg_as_read', { message_id: args.message_id })
                    return { success: true }
                }
                
                return { success: false, error: '当前环境不支持标记已读' }
            } catch (err) {
                return { success: false, error: `标记已读失败: ${err.message}` }
            }
        }
    },
    
    {
        name: 'get_essence_msg_list',
        description: '获取群精华消息列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                const groupId = parseInt(args.group_id)
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                // 尝试 NapCat API
                if (bot.sendApi) {
                    const result = await bot.sendApi('get_essence_msg_list', { group_id: groupId })
                    const messages = result?.data || result || []
                    
                    return {
                        success: true,
                        group_id: groupId,
                        count: messages.length,
                        messages: messages.map(msg => ({
                            sender_id: msg.sender_id,
                            sender_nick: msg.sender_nick,
                            sender_time: msg.sender_time,
                            operator_id: msg.operator_id,
                            operator_nick: msg.operator_nick,
                            operator_time: msg.operator_time,
                            message_id: msg.message_id,
                            content: msg.content
                        }))
                    }
                }
                
                // icqq 方式
                const group = bot.pickGroup?.(groupId)
                if (group?.getEssence) {
                    const messages = await group.getEssence()
                    return {
                        success: true,
                        group_id: groupId,
                        count: messages?.length || 0,
                        messages: messages || []
                    }
                }
                
                return { success: false, error: '当前协议不支持获取精华消息' }
            } catch (err) {
                return { success: false, error: `获取精华消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_essence_msg',
        description: '设置群精华消息',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                if (bot.sendApi) {
                    await bot.sendApi('set_essence_msg', { message_id: args.message_id })
                    return { success: true, message_id: args.message_id }
                }
                
                if (bot.setEssenceMsg) {
                    await bot.setEssenceMsg(args.message_id)
                    return { success: true, message_id: args.message_id }
                }
                
                return { success: false, error: '当前协议不支持设置精华消息' }
            } catch (err) {
                return { success: false, error: `设置精华消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_essence_msg',
        description: '移除群精华消息',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                if (bot.sendApi) {
                    await bot.sendApi('delete_essence_msg', { message_id: args.message_id })
                    return { success: true, message_id: args.message_id }
                }
                
                if (bot.deleteEssenceMsg) {
                    await bot.deleteEssenceMsg(args.message_id)
                    return { success: true, message_id: args.message_id }
                }
                
                return { success: false, error: '当前协议不支持移除精华消息' }
            } catch (err) {
                return { success: false, error: `移除精华消息失败: ${err.message}` }
            }
        }
    },
    
    {
        name: 'poke_user',
        description: '戳一戳用户',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '目标用户QQ号，"sender"表示戳发送者，"random"表示随机戳一个群成员' },
                group_id: { type: 'string', description: '群号（群聊戳一戳时需要）' },
                exclude_bot: { type: 'boolean', description: '随机戳时是否排除机器人，默认true' },
                exclude_self: { type: 'boolean', description: '随机戳时是否排除触发者，默认true' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                let userId = args.user_id
                const groupId = args.group_id ? parseInt(args.group_id) : (e?.group_id || null)
                
                // 处理特殊值: sender
                if (userId === 'sender') {
                    userId = e?.user_id || e?.sender?.user_id
                    if (!userId) {
                        return { success: false, error: '无法获取发送者ID' }
                    }
                }
                // 处理特殊值: random - 随机选择群成员
                else if (userId === 'random') {
                    if (!groupId) {
                        return { success: false, error: '随机戳一戳仅在群聊中有效' }
                    }
                    
                    const botId = bot.uin || bot.self_id
                    const memberList = await getGroupMemberList({ bot, event: e })
                    
                    if (memberList.length === 0) {
                        return { success: false, error: '获取群成员列表失败' }
                    }
                    
                    const excludeUsers = []
                    if (args.exclude_self !== false) excludeUsers.push(String(e?.user_id))
                    
                    const candidates = filterMembers(memberList, {
                        excludeBot: args.exclude_bot !== false,
                        excludeUsers,
                        botId
                    })
                    
                    if (candidates.length === 0) {
                        return { success: false, error: '没有符合条件的群成员可供选择' }
                    }
                    
                    const selected = randomSelectMembers(candidates, 1)[0]
                    userId = selected.user_id || selected.uid
                }
                
                userId = parseInt(userId)
                
                // 群聊戳一戳
                if (groupId) {
                    // 方式1: icqq - group.pokeMember (优先)
                    if (bot.pickGroup) {
                        const group = bot.pickGroup(groupId)
                        if (typeof group?.pokeMember === 'function') {
                            await group.pokeMember(userId)
                            return { success: true, user_id: userId, group_id: groupId, type: 'group' }
                        }
                        // 方式2: icqq - pickMember().poke()
                        if (group?.pickMember) {
                            const member = group.pickMember(userId)
                            if (typeof member?.poke === 'function') {
                                await member.poke()
                                return { success: true, user_id: userId, group_id: groupId, type: 'group' }
                            }
                        }
                    }
                    
                    // 方式3: NapCat - send_group_poke (推荐)
                    if (bot.sendApi) {
                        try {
                            const result = await bot.sendApi('send_group_poke', { group_id: groupId, user_id: userId })
                            if (result?.status === 'ok' || result?.retcode === 0 || !result?.error) {
                                return { success: true, user_id: userId, group_id: groupId, type: 'group' }
                            }
                        } catch {}
                        // 方式4: NapCat/go-cqhttp - group_poke
                        try {
                            const result = await bot.sendApi('group_poke', { group_id: groupId, user_id: userId })
                            if (result?.status === 'ok' || result?.retcode === 0 || !result?.error) {
                                return { success: true, user_id: userId, group_id: groupId, type: 'group' }
                            }
                        } catch {}
                    }
                    
                    // 方式5: go-cqhttp / OneBot 直接方法
                    if (typeof bot.sendGroupPoke === 'function') {
                        await bot.sendGroupPoke(groupId, userId)
                        return { success: true, user_id: userId, group_id: groupId, type: 'group' }
                    }
                    if (typeof bot.send_group_poke === 'function') {
                        await bot.send_group_poke(groupId, userId)
                        return { success: true, user_id: userId, group_id: groupId, type: 'group' }
                    }
                    
                    return { success: false, error: '当前协议不支持群聊戳一戳' }
                }
                
                // 私聊戳一戳
                // 方式1: icqq - friend.poke()
                if (bot.pickFriend) {
                    const friend = bot.pickFriend(userId)
                    if (typeof friend?.poke === 'function') {
                        await friend.poke()
                        return { success: true, user_id: userId, type: 'private' }
                    }
                }
                
                // 方式2: NapCat - send_friend_poke / friend_poke
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('send_friend_poke', { user_id: userId })
                        if (result?.status === 'ok' || result?.retcode === 0 || !result?.error) {
                            return { success: true, user_id: userId, type: 'private' }
                        }
                    } catch {}
                    try {
                        const result = await bot.sendApi('friend_poke', { user_id: userId })
                        if (result?.status === 'ok' || result?.retcode === 0 || !result?.error) {
                            return { success: true, user_id: userId, type: 'private' }
                        }
                    } catch {}
                }
                
                // 方式3: go-cqhttp 直接方法
                if (typeof bot.sendFriendPoke === 'function') {
                    await bot.sendFriendPoke(userId)
                    return { success: true, user_id: userId, type: 'private' }
                }
                if (typeof bot.send_friend_poke === 'function') {
                    await bot.send_friend_poke(userId)
                    return { success: true, user_id: userId, type: 'private' }
                }
                
                return { success: false, error: '当前协议不支持私聊戳一戳' }
            } catch (err) {
                return { success: false, error: `戳一戳失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_msg_emoji_like',
        description: '对消息发送表情回应（表情贴）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '目标消息ID，不填则使用当前消息' },
                emoji_id: { type: 'string', description: '表情ID。经典: 76(赞) 77(踩) 66(爱心) 63(玫瑰) 179(doge)。Unicode: 128077(👍) 128078(👎) 128514(😂) 128525(😍)' },
                set: { type: 'boolean', description: '是否设置（true=添加回应，false=取消回应），默认true' }
            },
            required: ['emoji_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                const messageId = args.message_id || e?.message_id
                if (!messageId) {
                    return { success: false, error: '需要指定消息ID' }
                }
                
                const emojiId = String(args.emoji_id)
                const isSet = args.set !== false
                
                // 方式1: NapCat - set_msg_emoji_like (推荐)
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('set_msg_emoji_like', {
                            message_id: messageId,
                            emoji_id: emojiId,
                            set: isSet
                        })
                        if (result?.status === 'ok' || result?.retcode === 0 || !result?.error) {
                            return { 
                                success: true, 
                                message_id: messageId, 
                                emoji_id: emojiId,
                                action: isSet ? 'add' : 'remove'
                            }
                        }
                    } catch {}
                    
                    // 方式2: NapCat 变体 - send_msg_emoji_like
                    try {
                        const result = await bot.sendApi('send_msg_emoji_like', {
                            message_id: messageId,
                            emoji_id: emojiId
                        })
                        if (result?.status === 'ok' || result?.retcode === 0 || !result?.error) {
                            return { 
                                success: true, 
                                message_id: messageId, 
                                emoji_id: emojiId,
                                action: 'add'
                            }
                        }
                    } catch {}
                    
                    // 方式3: LLOneBot/Lagrange 变体
                    try {
                        const result = await bot.sendApi('set_message_emoji_like', {
                            message_id: messageId,
                            emoji_id: parseInt(emojiId)
                        })
                        if (result?.status === 'ok' || result?.retcode === 0 || !result?.error) {
                            return { 
                                success: true, 
                                message_id: messageId, 
                                emoji_id: emojiId,
                                action: isSet ? 'add' : 'remove'
                            }
                        }
                    } catch {}
                }
                
                // 方式4: OneBot 直接方法
                if (typeof bot.setMsgEmojiLike === 'function') {
                    await bot.setMsgEmojiLike(messageId, emojiId, isSet)
                    return { 
                        success: true, 
                        message_id: messageId, 
                        emoji_id: emojiId,
                        action: isSet ? 'add' : 'remove'
                    }
                }
                
                if (typeof bot.set_msg_emoji_like === 'function') {
                    await bot.set_msg_emoji_like(messageId, emojiId, isSet)
                    return { 
                        success: true, 
                        message_id: messageId, 
                        emoji_id: emojiId,
                        action: isSet ? 'add' : 'remove'
                    }
                }
                
                // 方式5: icqq - group.setReaction(seq, emoji_id, emoji_type)
                // icqq 1.5.8+ 支持
                // emoji_type: 1=QQ经典表情, 2=emoji表情, 3=超级表情
                if (e?.group_id && bot.pickGroup) {
                    try {
                        const group = bot.pickGroup(e.group_id)
                        if (typeof group?.setReaction === 'function') {
                            // icqq 使用 seq 而非 message_id
                            const seq = e?.seq || e?.source?.seq || parseInt(messageId) || 0
                            const emojiIdNum = parseInt(emojiId)
                            // 判断表情类型：大于200的是Unicode emoji，否则是QQ经典表情
                            const emojiType = emojiIdNum > 200 ? 2 : 1
                            
                            if (isSet) {
                                await group.setReaction(seq, emojiIdNum, emojiType)
                            } else {
                                // 取消回应可能需要不同的API或参数
                                await group.setReaction(seq, emojiIdNum, emojiType)
                            }
                            return { 
                                success: true, 
                                message_id: messageId, 
                                emoji_id: emojiId,
                                emoji_type: emojiType,
                                action: isSet ? 'add' : 'remove',
                                method: 'icqq'
                            }
                        }
                    } catch (icqqErr) {
                        // icqq 可能不支持或版本过低
                        logger.debug(`[set_msg_emoji_like] icqq setReaction 失败: ${icqqErr.message}`)
                    }
                }
                
                // 方式6: 尝试通过 pickGroup 获取 group 并直接调用
                if (e?.group_id && bot.gl?.get?.(e.group_id)) {
                    try {
                        const group = bot.pickGroup(e.group_id)
                        // 某些 icqq 变体使用 sendReaction
                        if (typeof group?.sendReaction === 'function') {
                            await group.sendReaction(messageId, parseInt(emojiId))
                            return { 
                                success: true, 
                                message_id: messageId, 
                                emoji_id: emojiId,
                                action: 'add',
                                method: 'icqq-sendReaction'
                            }
                        }
                    } catch {}
                }
                
                return { 
                    success: false, 
                    error: '当前协议不支持表情回应',
                    note: '表情回应功能需要 NapCat / LLOneBot / Lagrange / icqq 1.5.8+ 等支持该API的协议端'
                }
            } catch (err) {
                return { success: false, error: `表情回应失败: ${err.message}` }
            }
        }
    },
    
    {
        name: 'get_msg',
        description: '获取消息详情（通过消息ID）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                let msg = null
                
                // NapCat / OneBot API
                if (bot.getMsg) {
                    msg = await bot.getMsg(args.message_id)
                } else if (bot.get_msg) {
                    msg = await bot.get_msg(args.message_id)
                } else if (bot.sendApi) {
                    const result = await bot.sendApi('get_msg', { message_id: args.message_id })
                    msg = result?.data || result
                }
                
                if (!msg) {
                    return { success: false, error: '获取消息失败或消息不存在' }
                }
                
                return {
                    success: true,
                    message_id: msg.message_id,
                    sender: {
                        user_id: msg.sender?.user_id || msg.user_id,
                        nickname: msg.sender?.nickname || msg.sender?.card || ''
                    },
                    time: msg.time,
                    message_type: msg.message_type,
                    content: parseForwardContent(msg.message || msg.content || []),
                    raw_message: msg.raw_message
                }
            } catch (err) {
                return { success: false, error: `获取消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_raw_message',
        description: '发送原始消息段数组。支持直接构造消息段发送，适合发送复杂的混合消息（文本+图片+@等）。',
        inputSchema: {
            type: 'object',
            properties: {
                segments: {
                    type: 'array',
                    description: '消息段数组，每个元素为 {type, data} 格式。支持的类型: text, image, at, face, record, video, json, xml, markdown, mface, poke, reply 等',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', description: '消息类型' },
                            data: { type: 'object', description: '消息数据' }
                        },
                        required: ['type']
                    }
                },
                group_id: { type: 'string', description: '群号（发送到指定群）' },
                user_id: { type: 'string', description: '用户QQ号（发送私聊）' }
            },
            required: ['segments']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                if (!args.segments || args.segments.length === 0) {
                    return { success: false, error: '消息段数组不能为空' }
                }
                
                // 规范化消息段格式
                const segments = args.segments.map(seg => {
                    if (!seg.data) {
                        const { type, ...rest } = seg
                        return { type, data: rest }
                    }
                    return seg
                })
                
                let result
                if (args.group_id) {
                    // 发送到指定群
                    const groupId = parseInt(args.group_id)
                    if (bot.sendApi) {
                        result = await bot.sendApi('send_group_msg', { group_id: groupId, message: segments })
                    } else if (bot.pickGroup) {
                        const group = bot.pickGroup(groupId)
                        result = await group?.sendMsg(segments)
                    }
                } else if (args.user_id) {
                    // 发送私聊
                    const userId = parseInt(args.user_id)
                    if (bot.sendApi) {
                        result = await bot.sendApi('send_private_msg', { user_id: userId, message: segments })
                    } else if (bot.pickFriend) {
                        const friend = bot.pickFriend(userId)
                        result = await friend?.sendMsg(segments)
                    }
                } else if (e) {
                    // 发送到当前会话
                    result = await e.reply(segments)
                } else {
                    return { success: false, error: '需要指定 group_id 或 user_id，或在会话上下文中使用' }
                }
                
                return {
                    success: true,
                    message_id: result?.message_id || result?.data?.message_id,
                    segment_count: segments.length
                }
            } catch (err) {
                return { success: false, error: `发送原始消息失败: ${err.message}` }
            }
        }
    },
    
    {
        name: 'send_card',
        description: '【统一】发送卡片消息。支持链接卡片、大图卡片、新闻卡片、自定义JSON/XML卡片。合并了 send_json_card/send_xml_card/send_link_card/send_ark_card 功能。',
        inputSchema: {
            type: 'object',
            properties: {
                template: {
                    type: 'string',
                    description: '模板类型: link(链接卡片), image(大图卡片), news(新闻卡片), json(自定义JSON), xml(XML卡片)',
                    enum: ['link', 'image', 'news', 'json', 'xml']
                },
                title: { type: 'string', description: '标题（link/image/news模板）' },
                desc: { type: 'string', description: '描述（link/news模板）' },
                url: { type: 'string', description: '跳转链接（link/news模板）' },
                image: { type: 'string', description: '图片URL（link/image/news模板）' },
                source: { type: 'string', description: '来源名称（link/news模板）' },
                data: { type: 'string', description: '自定义数据（json/xml模板时使用）' },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['template']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                let cardData = null
                let cardType = 'json'
                
                switch (args.template) {
                    case 'link':
                        cardData = buildLinkCard(args.title || '', args.desc || '', args.url || '', args.image || '', args.source || '')
                        break
                    case 'image':
                        cardData = buildBigImageCard(args.image || '', args.title || '', args.desc || '')
                        break
                    case 'news':
                        cardData = {
                            app: 'com.tencent.structmsg',
                            desc: args.source || '',
                            view: 'news',
                            ver: '0.0.0.1',
                            prompt: `[${args.source || '资讯'}] ${args.title || ''}`,
                            meta: {
                                news: {
                                    action: '',
                                    app_type: 1,
                                    appid: 100951776,
                                    desc: args.desc || '',
                                    jumpUrl: args.url || '',
                                    preview: args.image || '',
                                    tag: args.source || '',
                                    title: args.title || ''
                                }
                            }
                        }
                        break
                    case 'json':
                        if (!args.data) {
                            return { success: false, error: 'json模板需要提供data参数' }
                        }
                        try {
                            cardData = typeof args.data === 'string' ? JSON.parse(args.data) : args.data
                        } catch {
                            return { success: false, error: 'data格式错误，需要有效的JSON' }
                        }
                        break
                    case 'xml':
                        if (!args.data) {
                            return { success: false, error: 'xml模板需要提供data参数' }
                        }
                        cardType = 'xml'
                        cardData = args.data
                        break
                    default:
                        return { success: false, error: '不支持的模板类型' }
                }
                
                // 使用统一的卡片发送函数
                const result = await sendCardMessage({
                    bot,
                    event: e,
                    groupId: args.group_id ? parseInt(args.group_id) : null,
                    userId: args.user_id ? parseInt(args.user_id) : null,
                    type: cardType,
                    data: cardData
                })
                
                // 解析卡片信息
                const cardInfo = cardType === 'json' ? parseCardData(cardData) : { type: 'xml' }
                
                return {
                    ...result,
                    template: args.template,
                    card_type: cardInfo.type
                }
            } catch (err) {
                return { success: false, error: `发送Ark卡片失败: ${err.message}` }
            }
        }
    },
    
    {
        name: 'send_markdown',
        description: '发送Markdown消息（NapCat/TRSS支持）',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Markdown内容' },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                const mdSeg = { type: 'markdown', data: { content: args.content } }
                
                let result
                if (args.group_id) {
                    const groupId = parseInt(args.group_id)
                    if (bot.sendApi) {
                        result = await bot.sendApi('send_group_msg', { group_id: groupId, message: [mdSeg] })
                    } else if (bot.pickGroup) {
                        result = await bot.pickGroup(groupId)?.sendMsg(mdSeg)
                    }
                } else if (args.user_id) {
                    const userId = parseInt(args.user_id)
                    if (bot.sendApi) {
                        result = await bot.sendApi('send_private_msg', { user_id: userId, message: [mdSeg] })
                    } else if (bot.pickFriend) {
                        result = await bot.pickFriend(userId)?.sendMsg(mdSeg)
                    }
                } else if (e) {
                    result = await e.reply(mdSeg)
                } else {
                    return { success: false, error: '需要指定 group_id 或 user_id' }
                }
                
                return {
                    success: true,
                    message_id: result?.message_id || result?.data?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送Markdown失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_button',
        description: '发送按钮消息（NapCat扩展）',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '消息文本内容' },
                buttons: {
                    type: 'array',
                    description: '按钮列表',
                    items: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '按钮文字' },
                            data: { type: 'string', description: '按钮数据/回调' },
                            type: { type: 'string', description: '按钮类型: input(输入回调), link(链接), callback(回调)' }
                        },
                        required: ['text']
                    }
                },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['buttons']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                const message = []
                if (args.content) {
                    message.push({ type: 'text', data: { text: args.content } })
                }
                message.push({ 
                    type: 'keyboard', 
                    data: { 
                        content: { 
                            rows: [{ buttons: args.buttons.map((btn, i) => ({
                                id: String(i),
                                render_data: { label: btn.text, visited_label: btn.text },
                                action: {
                                    type: btn.type === 'link' ? 0 : (btn.type === 'callback' ? 1 : 2),
                                    data: btn.data || btn.text,
                                    permission: { type: 2 }
                                }
                            }))}]
                        }
                    }
                })
                
                let result
                if (args.group_id) {
                    if (bot.sendApi) {
                        result = await bot.sendApi('send_group_msg', { group_id: parseInt(args.group_id), message })
                    }
                } else if (args.user_id) {
                    if (bot.sendApi) {
                        result = await bot.sendApi('send_private_msg', { user_id: parseInt(args.user_id), message })
                    }
                } else if (e) {
                    result = await e.reply(message)
                } else {
                    return { success: false, error: '需要指定 group_id 或 user_id' }
                }
                
                return {
                    success: true,
                    message_id: result?.message_id || result?.data?.message_id,
                    button_count: args.buttons.length
                }
            } catch (err) {
                return { success: false, error: `发送按钮消息失败: ${err.message}` }
            }
        }
    },
    
    {
        name: 'call_api',
        description: '直接调用Bot API（NapCat/OneBot扩展）。可以调用任意API，适合使用未封装的高级功能。',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', description: 'API名称，如 send_group_msg, get_group_info, set_group_card 等' },
                params: { type: 'object', description: 'API参数对象' }
            },
            required: ['action']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                if (!bot.sendApi) {
                    return { success: false, error: '当前协议不支持 sendApi，此功能需要 NapCat/OneBot 协议端' }
                }
                
                const result = await bot.sendApi(args.action, args.params || {})
                
                return {
                    success: true,
                    action: args.action,
                    result: result?.data || result
                }
            } catch (err) {
                return { success: false, error: `调用API失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_long_msg',
        description: '发送长消息（NapCat扩展）。将多条消息合并为长消息发送。',
        inputSchema: {
            type: 'object',
            properties: {
                messages: {
                    type: 'array',
                    description: '消息列表，每条消息为字符串或消息段数组',
                    items: {
                        oneOf: [
                            { type: 'string' },
                            { type: 'array' }
                        ]
                    }
                },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['messages']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || ctx.getBot?.() || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                if (!bot.sendApi) {
                    return { success: false, error: '当前协议不支持长消息发送' }
                }
                
                // 构建消息节点
                const botInfo = bot.info || {}
                const botId = bot.uin || bot.self_id || '10000'
                const botName = botInfo.nickname || 'Bot'
                
                const nodes = args.messages.map(msg => ({
                    type: 'node',
                    data: {
                        user_id: String(botId),
                        nickname: botName,
                        content: typeof msg === 'string' 
                            ? [{ type: 'text', data: { text: msg } }]
                            : msg
                    }
                }))
                
                let result
                if (args.group_id) {
                    result = await bot.sendApi('send_group_forward_msg', {
                        group_id: parseInt(args.group_id),
                        messages: nodes
                    })
                } else if (args.user_id) {
                    result = await bot.sendApi('send_private_forward_msg', {
                        user_id: parseInt(args.user_id),
                        messages: nodes
                    })
                } else if (e) {
                    const isGroup = !!e.group_id
                    const apiName = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg'
                    const targetId = isGroup ? e.group_id : e.user_id
                    result = await bot.sendApi(apiName, {
                        [isGroup ? 'group_id' : 'user_id']: targetId,
                        messages: nodes
                    })
                } else {
                    return { success: false, error: '需要指定 group_id 或 user_id' }
                }
                
                return {
                    success: true,
                    message_id: result?.message_id || result?.data?.message_id,
                    res_id: result?.res_id || result?.data?.res_id,
                    message_count: args.messages.length
                }
            } catch (err) {
                return { success: false, error: `发送长消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_msg_reactions',
        description: '获取消息的表情回应列表（NapCat扩展）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' },
                group_id: { type: 'string', description: '群号' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                const groupId = args.group_id || e?.group_id
                
                if (!bot || !bot.sendApi) {
                    return { success: false, error: '当前协议不支持获取表情回应' }
                }
                
                const result = await bot.sendApi('get_group_msg_history', {
                    group_id: parseInt(groupId),
                    message_id: args.message_id
                })
                
                return {
                    success: true,
                    message_id: args.message_id,
                    reactions: result?.data?.reactions || result?.reactions || []
                }
            } catch (err) {
                return { success: false, error: `获取表情回应失败: ${err.message}` }
            }
        }
    }
]

/**
 * 解析转发消息内容
 * @param {Array} content - 消息段数组
 * @returns {string} 解析后的文本
 */
function parseForwardContent(content) {
    if (!Array.isArray(content)) {
        return String(content || '')
    }
    
    return content.map(seg => {
        const type = seg.type
        const data = seg.data || seg
        
        switch (type) {
            case 'text':
                return data.text || ''
            case 'image':
                return '[图片]'
            case 'face':
                return `[表情:${data.id}]`
            case 'at':
                return `@${data.name || data.qq}`
            case 'record':
            case 'audio':
                return '[语音]'
            case 'video':
                return '[视频]'
            case 'file':
                return `[文件:${data.name || ''}]`
            case 'forward':
                return '[转发消息]'
            case 'markdown':
                return data.content || '[Markdown]'
            case 'mface':
                return `[商城表情:${data.summary || ''}]`
            case 'json':
                return '[卡片消息]'
            case 'xml':
                return '[XML消息]'
            case 'poke':
                return '[戳一戳]'
            default:
                return `[${type}]`
        }
    }).join('')
}

/**
 * 解析富文本消息内容为消息段数组
 * 支持混合格式：文本、[图片:url]、[表情:id]、[@qq]、[语音:url]等
 * @param {string|Array|Object} content - 消息内容
 * @returns {Array} 消息段数组
 */
function parseRichContent(content) {
    // 如果已经是数组，直接返回
    if (Array.isArray(content)) {
        return content.map(seg => {
            // 确保格式正确
            if (typeof seg === 'string') {
                return { type: 'text', data: { text: seg } }
            }
            // 统一为 NC/OneBot 格式
            if (seg.type && !seg.data) {
                const { type, ...rest } = seg
                return { type, data: rest }
            }
            return seg
        })
    }
    
    // 如果是对象（单个消息段）
    if (typeof content === 'object' && content !== null) {
        if (content.type) {
            if (!content.data) {
                const { type, ...rest } = content
                return [{ type, data: rest }]
            }
            return [content]
        }
        return [{ type: 'text', data: { text: JSON.stringify(content) } }]
    }
    
    // 字符串：解析特殊标记
    if (typeof content !== 'string') {
        return [{ type: 'text', data: { text: String(content || '') } }]
    }
    
    const segments = []
    let remaining = content
    
    // 解析 [类型:参数] 格式的标记
    const patterns = [
        // [图片:url] 或 [image:url]
        { regex: /\[(?:图片|image):([^\]]+)\]/gi, handler: (m) => ({ type: 'image', data: { file: m[1], url: m[1] } }) },
        // [表情:id] 或 [face:id]
        { regex: /\[(?:表情|face):(\d+)\]/gi, handler: (m) => ({ type: 'face', data: { id: parseInt(m[1]) } }) },
        // [@qq] 或 [at:qq]
        { regex: /\[@(\d+|all)\]/gi, handler: (m) => ({ type: 'at', data: { qq: m[1] } }) },
        { regex: /\[at:(\d+|all)\]/gi, handler: (m) => ({ type: 'at', data: { qq: m[1] } }) },
        // [语音:url] 或 [record:url]
        { regex: /\[(?:语音|record):([^\]]+)\]/gi, handler: (m) => ({ type: 'record', data: { file: m[1] } }) },
        // [视频:url] 或 [video:url]
        { regex: /\[(?:视频|video):([^\]]+)\]/gi, handler: (m) => ({ type: 'video', data: { file: m[1] } }) },
        // [商城表情:id,key] 或 [mface:pkg_id,emoji_id]
        { regex: /\[(?:商城表情|mface):([^,\]]+),([^\]]+)\]/gi, handler: (m) => ({ type: 'mface', data: { emoji_package_id: m[1], emoji_id: m[2] } }) },
        // [markdown:content]
        { regex: /\[markdown:([^\]]+)\]/gi, handler: (m) => ({ type: 'markdown', data: { content: m[1] } }) },
    ]
    
    // 收集所有匹配
    const matches = []
    for (const { regex, handler } of patterns) {
        let match
        const re = new RegExp(regex.source, regex.flags)
        while ((match = re.exec(content)) !== null) {
            matches.push({
                start: match.index,
                end: match.index + match[0].length,
                segment: handler(match)
            })
        }
    }
    
    // 按位置排序
    matches.sort((a, b) => a.start - b.start)
    
    // 如果没有匹配，返回纯文本
    if (matches.length === 0) {
        return [{ type: 'text', data: { text: content } }]
    }
    
    // 构建消息段数组
    let lastEnd = 0
    for (const m of matches) {
        // 添加之前的文本
        if (m.start > lastEnd) {
            const text = content.substring(lastEnd, m.start)
            if (text) segments.push({ type: 'text', data: { text } })
        }
        // 添加特殊消息段
        segments.push(m.segment)
        lastEnd = m.end
    }
    // 添加剩余文本
    if (lastEnd < content.length) {
        const text = content.substring(lastEnd)
        if (text) segments.push({ type: 'text', data: { text } })
    }
    
    return segments
}

/**
 * 构建合并转发节点（支持富文本）
 * @param {Array} messages - 消息列表
 * @returns {Array} 节点数组
 */
function buildForwardNodes(messages) {
    return messages.map(msg => {
        const userId = String(msg.user_id || msg.uin || '10000')
        const nickname = msg.nickname || msg.name || userId
        const content = msg.message || msg.content || ''
        
        // 解析富文本内容
        const parsedContent = parseRichContent(content)
        
        return {
            type: 'node',
            data: {
                user_id: userId,
                nickname: nickname,
                content: parsedContent
            }
        }
    })
}
