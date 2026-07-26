/**
 * 记忆管理工具
 * 统一使用 MemoryService（structured_memories 表）
 */

/** 记忆查询默认返回数量 */
const DEFAULT_MEMORY_LIMIT = 20

/** 搜索类工具的默认返回数量 */
const DEFAULT_SEARCH_LIMIT = 10

/** 记忆查询返回数量硬上限（limit 会直通 SQL LIMIT，必须夹取） */
const MAX_MEMORY_LIMIT = 100

async function getMemoryService() {
    const { memoryService } = await import('../../services/memory/MemoryService.js')
    await memoryService.ensureInit()
    return memoryService
}

/**
 * 夹取 limit，防止调用方传入超大值直通 SQL LIMIT
 * @param {*} value - 调用方传入的 limit
 * @param {number} fallback - 默认值
 * @returns {number} 位于 [1, MAX_MEMORY_LIMIT] 的整数
 */
function clampLimit(value, fallback) {
    const num = Math.floor(Number(value))
    if (!Number.isFinite(num) || num < 1) return fallback
    return Math.min(num, MAX_MEMORY_LIMIT)
}

function resolveUserId(args, ctx) {
    const e = ctx.getEvent()
    return args.user_id || e?.user_id?.toString()
}

/**
 * 校验记忆归属：只允许操作当前会话用户自己的记忆
 * 归属主体取自事件上下文而非 args.user_id，否则调用方传入任意 user_id 即可绕过
 * 无事件上下文（管理面板等可信内部调用）时不作限制
 * @param {Object} memoryService - MemoryService 实例
 * @param {number|string} memoryId - 记忆 ID
 * @param {Object} ctx - MCP 上下文
 * @returns {Promise<{ok: boolean, error?: string, memory?: Object}>} 校验结果
 */
async function assertMemoryOwnership(memoryService, memoryId, ctx) {
    const memory = await memoryService.getMemoryById(memoryId)
    if (!memory) {
        return { ok: false, error: `记忆不存在: ${memoryId}` }
    }

    const eventUserId = ctx.getEvent()?.user_id?.toString()
    if (!eventUserId) return { ok: true, memory }

    if (String(memory.userId) !== eventUserId) {
        return { ok: false, error: '无权操作他人的记忆' }
    }
    return { ok: true, memory }
}

function resolveGroupId(args, ctx) {
    const e = ctx.getEvent()
    return args.group_id || e?.group_id?.toString() || null
}

const TYPE_TO_CATEGORY = {
    preference: 'preference',
    fact: 'profile',
    note: 'custom',
    relationship: 'relation',
    profile: 'profile',
    event: 'event',
    topic: 'topic'
}

export const memoryTools = [
    {
        name: 'save_user_memory',
        description:
            '保存关于用户的重要信息到记忆库。当用户透露个人信息（名字、生日、喜好、位置等）或要求记住某事时，应主动调用此工具保存。',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '要保存的记忆内容' },
                user_id: { type: 'string', description: '用户QQ号（不填则使用当前用户）' },
                group_id: { type: 'string', description: '群号（不填则使用当前群）' },
                category: {
                    type: 'string',
                    description: '记忆分类',
                    enum: ['profile', 'preference', 'event', 'relation', 'topic', 'custom']
                },
                sub_type: { type: 'string', description: '子类型（如 name/age/like/dislike 等）' },
                importance: { type: 'number', description: '重要程度(1-10)，映射为 confidence' }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const memoryService = await getMemoryService()
                const userId = resolveUserId(args, ctx)
                if (!userId) return { success: false, error: '无法确定用户' }

                const groupId = resolveGroupId(args, ctx)
                const category = TYPE_TO_CATEGORY[args.category] || args.category || 'custom'
                const confidence = args.importance ? Math.min(args.importance / 10, 1) : 0.85

                const memory = await memoryService.saveMemory({
                    userId,
                    groupId,
                    category,
                    subType: args.sub_type || null,
                    content: args.content,
                    confidence,
                    source: 'manual'
                })

                return {
                    success: true,
                    memory_id: memory?.id,
                    user_id: userId,
                    category,
                    content: args.content
                }
            } catch (err) {
                return { success: false, error: `保存记忆失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_user_memories',
        description: '获取用户的记忆列表。当需要回忆用户之前说过的信息、偏好或历史时调用。',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号（不填则使用当前用户）' },
                category: {
                    type: 'string',
                    description: '按分类筛选（profile/preference/event/relation/topic/custom）'
                },
                keyword: { type: 'string', description: '关键词搜索' },
                limit: {
                    type: 'integer',
                    description: `返回数量，默认${DEFAULT_MEMORY_LIMIT}，最大${MAX_MEMORY_LIMIT}`,
                    minimum: 1,
                    maximum: MAX_MEMORY_LIMIT
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const memoryService = await getMemoryService()
                const userId = resolveUserId(args, ctx)
                if (!userId) return { success: false, error: '无法确定用户' }

                const groupId = resolveGroupId(args, ctx)
                let memories

                const limit = clampLimit(args.limit, DEFAULT_MEMORY_LIMIT)

                if (args.keyword) {
                    memories = await memoryService.searchMemories(args.keyword, {
                        userId,
                        groupId,
                        category: args.category,
                        limit
                    })
                } else {
                    memories = await memoryService.getMemoriesByUser(userId, {
                        category: args.category,
                        groupId,
                        limit
                    })
                }

                return {
                    success: true,
                    user_id: userId,
                    count: memories.length,
                    memories: memories.map(m => ({
                        id: m.id,
                        content: m.content,
                        category: m.category,
                        sub_type: m.subType,
                        confidence: m.confidence,
                        updated_at: m.updatedAt
                    }))
                }
            } catch (err) {
                return { success: false, error: `获取记忆失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_user_memory',
        description: '搜索用户记忆。当需要查找用户特定信息（如"他叫什么""他喜欢什么"）时调用。支持多关键词搜索。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词，多个关键词用空格分隔' },
                user_id: { type: 'string', description: '用户QQ号（不填则使用当前用户）' },
                category: { type: 'string', description: '限定搜索分类' },
                limit: {
                    type: 'integer',
                    description: `返回数量，默认${DEFAULT_SEARCH_LIMIT}，最大${MAX_MEMORY_LIMIT}`,
                    minimum: 1,
                    maximum: MAX_MEMORY_LIMIT
                }
            },
            required: ['query']
        },
        handler: async (args, ctx) => {
            try {
                const memoryService = await getMemoryService()
                const userId = resolveUserId(args, ctx)
                if (!userId) return { success: false, error: '无法确定用户' }

                const groupId = resolveGroupId(args, ctx)
                let results = await memoryService.searchMemories(args.query, {
                    userId,
                    groupId,
                    category: args.category,
                    limit: clampLimit(args.limit, DEFAULT_SEARCH_LIMIT)
                })

                // 多关键词相关度排序
                const keywords = args.query.toLowerCase().split(/\s+/).filter(Boolean)
                if (keywords.length > 1) {
                    results = results
                        .map(m => {
                            const lower = m.content.toLowerCase()
                            const matchCount = keywords.filter(k => lower.includes(k)).length
                            return { ...m, relevance: matchCount / keywords.length }
                        })
                        .sort((a, b) => b.relevance - a.relevance)
                } else {
                    results = results.map(m => ({ ...m, relevance: 1 }))
                }

                return {
                    success: true,
                    user_id: userId,
                    query: args.query,
                    count: results.length,
                    results: results.map(m => ({
                        id: m.id,
                        content: m.content,
                        category: m.category,
                        sub_type: m.subType,
                        confidence: m.confidence,
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
        description: '删除指定的用户记忆。只能删除当前会话用户自己的记忆。',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: { type: 'integer', description: '记忆ID' }
            },
            required: ['memory_id']
        },
        handler: async (args, ctx) => {
            try {
                const memoryService = await getMemoryService()

                // deleteMemory 只按 ID 删除且恒返回 true，缺少归属校验时任意用户都能删他人记忆
                const ownership = await assertMemoryOwnership(memoryService, args.memory_id, ctx)
                if (!ownership.ok) {
                    return { success: false, error: ownership.error }
                }

                await memoryService.deleteMemory(args.memory_id, false)
                return { success: true, memory_id: args.memory_id, user_id: ownership.memory.userId }
            } catch (err) {
                return { success: false, error: `删除记忆失败: ${err.message}` }
            }
        }
    },

    {
        name: 'update_user_memory',
        description: '更新已有的记忆内容。当用户纠正或补充之前的信息时调用。只能更新当前会话用户自己的记忆。',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: { type: 'integer', description: '要更新的记忆ID' },
                content: { type: 'string', description: '新的记忆内容' },
                category: { type: 'string', description: '新的分类' },
                sub_type: { type: 'string', description: '新的子类型' }
            },
            required: ['memory_id']
        },
        handler: async (args, ctx) => {
            try {
                const memoryService = await getMemoryService()
                const updates = {}
                if (args.content) updates.content = args.content
                if (args.category) updates.category = args.category
                if (args.sub_type) updates.subType = args.sub_type

                if (Object.keys(updates).length === 0) {
                    return { success: false, error: '没有要更新的字段' }
                }

                // updateMemory 只按 ID 更新，缺少归属校验时任意用户都能改他人记忆
                const ownership = await assertMemoryOwnership(memoryService, args.memory_id, ctx)
                if (!ownership.ok) {
                    return { success: false, error: ownership.error }
                }

                // updateMemory 在 ID 不存在或无可用字段时返回 null，必须检查返回值
                const updated = await memoryService.updateMemory(args.memory_id, updates)
                if (!updated) {
                    return { success: false, error: `更新记忆失败: 记忆 ${args.memory_id} 不存在或没有可更新的字段` }
                }
                return { success: true, memory_id: args.memory_id, updated: Object.keys(updates) }
            } catch (err) {
                return { success: false, error: `更新记忆失败: ${err.message}` }
            }
        }
    }
]
