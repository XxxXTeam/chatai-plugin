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

// ======================= 消息发送去重机制 =======================
const SEND_DEDUP_EXPIRE = 5000  // 发送去重过期时间(ms)
const recentSentMessages = new Map()  // key -> { content, timestamp, count }

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
                // 去重检查
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
        description: '发送合并转发消息',
        inputSchema: {
            type: 'object',
            properties: {
                nodes: {
                    type: 'array',
                    description: '转发节点列表',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: '发送者名称' },
                            uin: { type: 'string', description: '发送者QQ号' },
                            content: { type: 'string', description: '消息内容' },
                            time: { type: 'number', description: '时间戳（可选）' }
                        },
                        required: ['name', 'uin', 'content']
                    }
                },
                news: { 
                    type: 'array', 
                    description: '外显文本列表（可选，默认自动生成）',
                    items: { type: 'string' }
                },
                prompt: { type: 'string', description: '外显标题（可选）' },
                summary: { type: 'string', description: '底部摘要（可选）' }
            },
            required: ['nodes']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                const bot = e.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                // 构建转发节点
                const forwardNodes = args.nodes.map(node => ({
                    type: 'node',
                    data: {
                        name: node.name,
                        uin: node.uin,
                        content: node.content,
                        time: node.time || Math.floor(Date.now() / 1000)
                    }
                }))
                
                // 尝试发送
                let result
                if (e.group_id) {
                    // 群聊转发
                    if (bot.sendGroupForwardMsg) {
                        result = await bot.sendGroupForwardMsg(e.group_id, forwardNodes)
                    } else if (bot.send_group_forward_msg) {
                        result = await bot.send_group_forward_msg(e.group_id, forwardNodes)
                    } else if (bot.pickGroup) {
                        const group = bot.pickGroup(e.group_id)
                        if (group?.makeForwardMsg && group?.sendMsg) {
                            const forwardMsg = await group.makeForwardMsg(forwardNodes.map(n => ({
                                user_id: parseInt(n.data.uin),
                                nickname: n.data.name,
                                message: n.data.content
                            })))
                            result = await group.sendMsg(forwardMsg)
                        }
                    }
                } else {
                    // 私聊转发
                    const userId = e.user_id || e.sender?.user_id
                    if (bot.sendPrivateForwardMsg) {
                        result = await bot.sendPrivateForwardMsg(userId, forwardNodes)
                    } else if (bot.send_private_forward_msg) {
                        result = await bot.send_private_forward_msg(userId, forwardNodes)
                    } else if (bot.pickFriend) {
                        const friend = bot.pickFriend(userId)
                        if (friend?.makeForwardMsg && friend?.sendMsg) {
                            const forwardMsg = await friend.makeForwardMsg(forwardNodes.map(n => ({
                                user_id: parseInt(n.data.uin),
                                nickname: n.data.name,
                                message: n.data.content
                            })))
                            result = await friend.sendMsg(forwardMsg)
                        }
                    }
                }
                
                if (!result) {
                    return { success: false, error: '当前环境不支持发送合并转发' }
                }
                
                return {
                    success: true,
                    message_id: result?.message_id,
                    res_id: result?.res_id
                }
            } catch (err) {
                return { success: false, error: `发送合并转发失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_json_card',
        description: '发送JSON卡片消息',
        inputSchema: {
            type: 'object',
            properties: {
                data: { type: 'string', description: 'JSON字符串或对象' }
            },
            required: ['data']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                let jsonData = args.data
                if (typeof jsonData === 'object') {
                    jsonData = JSON.stringify(jsonData)
                }
                
                const jsonSeg = {
                    type: 'json',
                    data: jsonData
                }
                
                const result = await e.reply(jsonSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送JSON卡片失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_xml_card',
        description: '发送XML卡片消息',
        inputSchema: {
            type: 'object',
            properties: {
                data: { type: 'string', description: 'XML字符串' }
            },
            required: ['data']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                const xmlSeg = {
                    type: 'xml',
                    data: args.data
                }
                
                const result = await e.reply(xmlSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送XML卡片失败: ${err.message}` }
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
                
                return { success: false, error: '当前环境不支持标记已读' }
            } catch (err) {
                return { success: false, error: `标记已读失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_history_msg',
        description: '获取历史消息（群聊或私聊）',
        inputSchema: {
            type: 'object',
            properties: {
                target_type: { type: 'string', description: '目标类型: group/private', enum: ['group', 'private'] },
                target_id: { type: 'string', description: '群号或用户QQ' },
                count: { type: 'number', description: '获取数量（默认20）' },
                message_seq: { type: 'number', description: '起始消息序号（可选，从此消息往前获取）' }
            },
            required: ['target_type', 'target_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                const targetId = parseInt(args.target_id)
                const count = args.count || 20
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                let messages = []
                
                if (args.target_type === 'group') {
                    // icqq 方式
                    const group = bot.pickGroup?.(targetId)
                    if (group?.getChatHistory) {
                        messages = await group.getChatHistory(args.message_seq || 0, count)
                    }
                    // NapCat 方式
                    else if (bot.sendApi) {
                        const result = await bot.sendApi('get_group_msg_history', {
                            group_id: targetId,
                            count,
                            message_seq: args.message_seq
                        })
                        messages = result?.data?.messages || result?.messages || []
                    }
                } else {
                    // 私聊历史
                    const friend = bot.pickFriend?.(targetId)
                    if (friend?.getChatHistory) {
                        messages = await friend.getChatHistory(args.message_seq || 0, count)
                    }
                    // NapCat 方式
                    else if (bot.sendApi) {
                        const result = await bot.sendApi('get_friend_msg_history', {
                            user_id: targetId,
                            count,
                            message_seq: args.message_seq
                        })
                        messages = result?.data?.messages || result?.messages || []
                    }
                }
                
                // 格式化消息
                const formatted = (messages || []).slice(0, count).map(msg => ({
                    message_id: msg.message_id || msg.id,
                    sender_id: msg.user_id || msg.sender?.user_id,
                    sender_name: msg.sender?.nickname || msg.sender?.card || '',
                    time: msg.time,
                    content: parseForwardContent(msg.message || msg.content || [])
                }))
                
                return { 
                    success: true, 
                    target_type: args.target_type,
                    target_id: targetId,
                    count: formatted.length,
                    messages: formatted 
                }
            } catch (err) {
                return { success: false, error: `获取历史消息失败: ${err.message}` }
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
                user_id: { type: 'string', description: '目标用户QQ号，"sender"表示戳发送者' },
                group_id: { type: 'string', description: '群号（群聊戳一戳时需要）' }
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
                if (userId === 'sender') {
                    userId = e?.user_id || e?.sender?.user_id
                    if (!userId) {
                        return { success: false, error: '无法获取发送者ID' }
                    }
                }
                userId = parseInt(userId)
                
                const groupId = args.group_id ? parseInt(args.group_id) : (e?.group_id || null)
                
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
                
                return { 
                    success: false, 
                    error: '当前协议不支持表情回应',
                    note: '表情回应功能需要 NapCat / LLOneBot / Lagrange 等支持该API的协议端'
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
            default:
                return `[${type}]`
        }
    }).join('')
}
