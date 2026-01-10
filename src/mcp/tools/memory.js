/**
 * 记忆管理工具
 * 用户记忆的增删改查
 */

export const memoryTools = [
    {
        name: 'save_user_memory',
        description: '保存关于用户的记忆/信息',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '要保存的记忆内容' },
                user_id: { type: 'string', description: '用户QQ号（不填则使用当前用户）' },
                type: { 
                    type: 'string', 
                    description: '记忆类型', 
                    enum: ['preference', 'fact', 'note', 'relationship']
                },
                importance: { type: 'number', description: '重要程度(1-10)，默认5' }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const { memoryManager } = await import('../../services/storage/MemoryManager.js')
                await memoryManager.init()
                
                const e = ctx.getEvent()
                const userId = args.user_id || e?.user_id?.toString()
                
                if (!userId) {
                    return { success: false, error: '无法确定用户' }
                }
                
                const memory = await memoryManager.addMemory(userId, {
                    content: args.content,
                    type: args.type || 'note',
                    importance: args.importance || 5,
                    source: 'ai_tool'
                })
                
                return { 
                    success: true, 
                    memory_id: memory.id,
                    user_id: userId,
                    content: args.content
                }
            } catch (err) {
                return { success: false, error: `保存记忆失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_user_memories',
        description: '获取用户的记忆列表',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号（不填则使用当前用户）' },
                type: { type: 'string', description: '记忆类型筛选' },
                keyword: { type: 'string', description: '关键词搜索' },
                limit: { type: 'number', description: '返回数量，默认20' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const { memoryManager } = await import('../../services/storage/MemoryManager.js')
                await memoryManager.init()
                
                const e = ctx.getEvent()
                const userId = args.user_id || e?.user_id?.toString()
                
                if (!userId) {
                    return { success: false, error: '无法确定用户' }
                }
                
                let memories = await memoryManager.getMemories(userId, {
                    type: args.type,
                    limit: args.limit || 20
                })
                
                // 关键词筛选
                if (args.keyword) {
                    const keyword = args.keyword.toLowerCase()
                    memories = memories.filter(m => 
                        m.content?.toLowerCase().includes(keyword)
                    )
                }
                
                return { 
                    success: true, 
                    user_id: userId,
                    count: memories.length,
                    memories: memories.map(m => ({
                        id: m.id,
                        content: m.content,
                        type: m.type,
                        importance: m.importance,
                        created_at: m.created_at
                    }))
                }
            } catch (err) {
                return { success: false, error: `获取记忆失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_user_memory',
        description: '搜索用户记忆',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词' },
                user_id: { type: 'string', description: '用户QQ号（不填则使用当前用户）' }
            },
            required: ['query']
        },
        handler: async (args, ctx) => {
            try {
                const { memoryManager } = await import('../../services/storage/MemoryManager.js')
                await memoryManager.init()
                
                const e = ctx.getEvent()
                const userId = args.user_id || e?.user_id?.toString()
                
                if (!userId) {
                    return { success: false, error: '无法确定用户' }
                }
                
                const results = await memoryManager.searchMemories(userId, args.query)
                
                return { 
                    success: true, 
                    user_id: userId,
                    query: args.query,
                    count: results.length,
                    results: results.map(m => ({
                        id: m.id,
                        content: m.content,
                        type: m.type,
                        relevance: m.relevance
                    }))
                }
            } catch (err) {
                return { success: false, error: `搜索记忆失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_user_memory',
        description: '删除用户记忆',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: { type: 'number', description: '记忆ID' },
                user_id: { type: 'string', description: '用户QQ号' }
            },
            required: ['memory_id']
        },
        handler: async (args, ctx) => {
            try {
                const { memoryManager } = await import('../../services/storage/MemoryManager.js')
                await memoryManager.init()
                
                const e = ctx.getEvent()
                const userId = args.user_id || e?.user_id?.toString()
                
                const success = await memoryManager.deleteMemory(userId, args.memory_id)
                
                return { success, memory_id: args.memory_id }
            } catch (err) {
                return { success: false, error: `删除记忆失败: ${err.message}` }
            }
        }
    }
]
