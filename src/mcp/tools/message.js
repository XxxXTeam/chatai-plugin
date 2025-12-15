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
    batchSendMessages 
} from './helpers.js'

export const messageTools = [
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
    }
]
