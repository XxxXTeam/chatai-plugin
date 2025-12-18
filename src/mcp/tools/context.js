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
                const { contextManager } = await import('../../services/ContextManager.js')
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
                
                const { contextManager } = await import('../../services/ContextManager.js')
                const historyManager = (await import('../../core/utils/history.js')).default
                await contextManager.init()
                
                const e = ctx.getEvent()
                const userId = e?.user_id?.toString()
                const groupId = e?.group_id?.toString()
                
                if (!userId) {
                    return { success: false, error: '无法确定用户' }
                }
                
                const conversationId = contextManager.getConversationId(userId, groupId)
                await historyManager.deleteConversation(conversationId)
                contextManager.clearSessionState(conversationId)
                
                return {
                    success: true,
                    message: '对话历史已清除',
                    conversation_id: conversationId
                }
            } catch (err) {
                return { success: false, error: `清除对话失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_reply_message',
        description: '获取被引用/回复的消息内容',
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
                
                if (!e.source && !e.reply_id) {
                    return { 
                        success: true, 
                        has_reply: false,
                        message: '当前消息没有引用其他消息'
                    }
                }
                
                // 尝试获取引用消息
                let replyMsg = null
                
                if (e.getReply && typeof e.getReply === 'function') {
                    replyMsg = await e.getReply()
                } else if (e.source && e.group?.getChatHistory) {
                    const seq = e.source.seq || e.source.message_id
                    const history = await e.group.getChatHistory(seq, 1)
                    replyMsg = history?.[0]
                }
                
                if (!replyMsg) {
                    return { 
                        success: true, 
                        has_reply: true,
                        error: '无法获取引用消息内容'
                    }
                }
                
                const replyInfo = replyMsg.data || replyMsg
                return {
                    success: true,
                    has_reply: true,
                    reply: {
                        user_id: replyInfo.user_id || replyInfo.sender?.user_id,
                        nickname: replyInfo.sender?.nickname || replyInfo.sender?.card || '',
                        content: replyInfo.raw_message || replyInfo.message?.map(m => m.text || `[${m.type}]`).join('') || '',
                        time: replyInfo.time,
                        message_id: replyInfo.message_id
                    }
                }
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
                
                const atList = []
                for (const seg of e.message || []) {
                    if (seg.type === 'at') {
                        const qq = seg.qq || seg.data?.qq
                        atList.push({
                            user_id: String(qq),
                            is_all: qq === 'all',
                            text: seg.text || seg.data?.text || ''
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
