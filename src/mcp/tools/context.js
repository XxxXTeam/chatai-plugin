/**
 * 上下文管理工具
 * 对话上下文、群聊上下文等
 */

export const contextTools = [
    {
        name: 'get_current_context',
        description: '获取当前会话的上下文信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                const bot = ctx.getBot()

                return {
                    success: true,
                    is_group: !!e.group_id,
                    group_id: e.group_id || null,
                    user_id: e.user_id,
                    sender: {
                        nickname: e.sender?.nickname || '',
                        card: e.sender?.card || '',
                        role: e.sender?.role || 'member'
                    },
                    bot_id: bot?.uin || e.self_id,
                    message_id: e.message_id,
                    time: e.time
                }
            } catch (err) {
                return { success: false, error: `获取上下文失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_conversation_context',
        description: '获取当前对话的详细上下文信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const { contextManager } = await import('../../services/llm/ContextManager.js')
                await contextManager.init()

                const e = ctx.getEvent()
                const userId = e?.user_id?.toString()
                const groupId = e?.group_id?.toString()

                if (!userId) {
                    return { success: false, error: '无法确定用户' }
                }

                const conversationId = contextManager.getConversationId(userId, groupId)
                const stats = await contextManager.getContextStats(conversationId)
                const isolation = contextManager.getIsolationMode()

                return {
                    success: true,
                    conversation_id: conversationId,
                    user_id: userId,
                    group_id: groupId,
                    is_group: !!groupId,
                    stats,
                    isolation_mode: isolation.description
                }
            } catch (err) {
                return { success: false, error: `获取上下文失败: ${err.message}` }
            }
        }
    },

    {
        name: 'clear_conversation',
        description: '清除当前对话历史，开始新会话',
        inputSchema: {
            type: 'object',
            properties: {
                confirm: { type: 'boolean', description: '确认清除，必须为true' }
            },
            required: ['confirm']
        },
        handler: async (args, ctx) => {
            try {
                if (args.confirm !== true) {
                    return { success: false, error: '需要确认清除操作' }
                }

                const { contextManager } = await import('../../services/llm/ContextManager.js')
                const historyManager = (await import('../../core/utils/history.js')).default
                const { presetManager } = await import('../../services/preset/PresetManager.js')
                await contextManager.init()

                const e = ctx.getEvent()
                const userId = e?.user_id?.toString()
                const groupId = e?.group_id?.toString()

                if (!userId) {
                    return { success: false, error: '无法确定用户' }
                }

                const conversationId = contextManager.getConversationId(userId, groupId)

                // 清除历史记录
                await historyManager.deleteConversation(conversationId)

                // 清除上下文状态
                await contextManager.cleanContext(conversationId)
                contextManager.clearSessionState(conversationId)
                contextManager.clearQueue(conversationId)

                // 清除群组缓存
                if (groupId) {
                    contextManager.clearGroupContextCache(groupId)
                }

                // 标记上下文已清除（防止后续请求仍携带旧上下文）
                presetManager.markContextCleared(conversationId)

                return {
                    success: true,
                    message: '对话历史已清除，新会话将开始',
                    conversation_id: conversationId
                }
            } catch (err) {
                return { success: false, error: `清除对话失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_reply_message',
        description: '获取被引用/回复的消息内容。支持获取引用链（如果被引用的消息也引用了其他消息）',
        inputSchema: {
            type: 'object',
            properties: {
                include_chain: { type: 'boolean', description: '是否获取引用链（被引用消息的引用），默认true' },
                max_depth: { type: 'number', description: '引用链最大深度，默认3' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                if (!e.source && !e.reply_id) {
                    return {
                        success: true,
                        has_reply: false,
                        message: '当前消息没有引用其他消息'
                    }
                }

                const bot = e.bot || global.Bot
                const includeChain = args.include_chain !== false
                const maxDepth = args.max_depth || 3

                /**
                 * 获取单条消息
                 */
                const getMessage = async (messageId, seq) => {
                    try {
                        // 方法1: bot.getMsg
                        if (bot?.getMsg && messageId) {
                            return await bot.getMsg(messageId)
                        }
                        // 方法2: bot.sendApi
                        if (bot?.sendApi && messageId) {
                            const result = await bot.sendApi('get_msg', { message_id: messageId })
                            return result?.data || result
                        }
                        // 方法3: group.getChatHistory
                        if (e.group?.getChatHistory && seq) {
                            const history = await e.group.getChatHistory(seq, 1)
                            return history?.[0]
                        }
                        // 方法4: e.getReply
                        if (e.getReply && typeof e.getReply === 'function') {
                            return await e.getReply()
                        }
                    } catch {}
                    return null
                }

                /**
                 * 提取消息文本内容
                 */
                const extractContent = msg => {
                    if (!msg) return ''
                    const data = msg.data || msg
                    if (data.raw_message) return data.raw_message
                    if (Array.isArray(data.message)) {
                        return data.message
                            .map(m => {
                                if (m.type === 'text') return m.text || m.data?.text || ''
                                if (m.type === 'at') return `@${m.data?.name || m.data?.qq || ''}`
                                if (m.type === 'image') return '[图片]'
                                if (m.type === 'face') return '[表情]'
                                if (m.type === 'record') return '[语音]'
                                if (m.type === 'reply') return '' // 忽略引用标记
                                return `[${m.type}]`
                            })
                            .join('')
                            .trim()
                    }
                    return ''
                }

                /**
                 * 检查消息是否也引用了其他消息
                 */
                const getReplyInfo = msg => {
                    if (!msg) return null
                    const data = msg.data || msg
                    // 检查 source
                    if (data.source) {
                        return { seq: data.source.seq, message_id: data.source.message_id }
                    }
                    // 检查消息段中的 reply
                    if (Array.isArray(data.message)) {
                        const replySeg = data.message.find(m => m.type === 'reply')
                        if (replySeg) {
                            return { message_id: replySeg.id || replySeg.data?.id }
                        }
                    }
                    return null
                }

                // 获取直接引用的消息
                const messageId = e.source?.message_id || e.reply_id
                const seq = e.source?.seq
                const replyMsg = await getMessage(messageId, seq)

                if (!replyMsg) {
                    return {
                        success: true,
                        has_reply: true,
                        error: '无法获取引用消息内容',
                        source_info: { message_id: messageId, seq }
                    }
                }

                const replyInfo = replyMsg.data || replyMsg
                const result = {
                    success: true,
                    has_reply: true,
                    reply: {
                        user_id: String(replyInfo.user_id || replyInfo.sender?.user_id || ''),
                        nickname: replyInfo.sender?.nickname || replyInfo.sender?.card || '',
                        content: extractContent(replyMsg),
                        time: replyInfo.time,
                        message_id: replyInfo.message_id || messageId
                    }
                }

                // 获取引用链
                if (includeChain) {
                    const chain = []
                    let currentMsg = replyMsg
                    let depth = 0

                    while (depth < maxDepth) {
                        const nestedReply = getReplyInfo(currentMsg)
                        if (!nestedReply) break

                        const nestedMsg = await getMessage(nestedReply.message_id, nestedReply.seq)
                        if (!nestedMsg) break

                        const nestedInfo = nestedMsg.data || nestedMsg
                        chain.push({
                            depth: depth + 1,
                            user_id: String(nestedInfo.user_id || nestedInfo.sender?.user_id || ''),
                            nickname: nestedInfo.sender?.nickname || nestedInfo.sender?.card || '',
                            content: extractContent(nestedMsg),
                            time: nestedInfo.time,
                            message_id: nestedInfo.message_id
                        })

                        currentMsg = nestedMsg
                        depth++
                    }

                    if (chain.length > 0) {
                        result.reply_chain = chain
                        result.chain_depth = chain.length
                    }
                }

                return result
            } catch (err) {
                return { success: false, error: `获取引用消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_at_members',
        description: '获取当前消息中@的成员列表',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                const botUin = e.bot?.uin || e.self_id
                const atList = []
                for (const seg of e.message || []) {
                    if (seg.type === 'at') {
                        const qq = seg.qq || seg.data?.qq
                        const isBotSelf = String(qq) === String(botUin)
                        atList.push({
                            user_id: String(qq),
                            is_all: qq === 'all',
                            is_bot: isBotSelf,
                            text: seg.text || seg.data?.text || '',
                            ...(isBotSelf ? { tip: '此QQ为Bot本身' } : {})
                        })
                    }
                }

                return {
                    success: true,
                    count: atList.length,
                    at_list: atList
                }
            } catch (err) {
                return { success: false, error: `获取@列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_context',
        description: '获取群聊上下文信息（仅群聊有效）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const { memoryManager } = await import('../../services/MemoryManager.js')
                await memoryManager.init()

                const e = ctx.getEvent()
                const groupId = args.group_id || e?.group_id?.toString()

                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }

                const context = await memoryManager.getGroupContext(groupId)

                return {
                    success: true,
                    group_id: groupId,
                    topics: context.topics?.slice(0, 10).map(t => t.content) || [],
                    relations: context.relations?.slice(0, 10).map(r => r.content) || [],
                    user_count: context.userInfos?.length || 0
                }
            } catch (err) {
                return { success: false, error: `获取群上下文失败: ${err.message}` }
            }
        }
    }
]
