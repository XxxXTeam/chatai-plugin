/**
 * 知识图谱工具
 * 统一使用 KnowledgeGraphService（kg_entities / kg_relationships 表）
 */

const DEFAULT_ENTITY_LIMIT = 20
const MAX_ENTITY_LIMIT = 100

/** 允许的实体类型（与 KnowledgeGraphExtractor 白名单保持一致） */
const ENTITY_TYPE_ENUM = ['person', 'thing', 'place', 'concept', 'event']

async function getKnowledgeGraphService() {
    const { knowledgeGraphService } = await import('../../services/storage/KnowledgeGraphService.js')
    await knowledgeGraphService.init()
    return knowledgeGraphService
}

/**
 * 夹取 limit，防止调用方传入超大值直通 SQL LIMIT
 * @param {*} value - 调用方传入的 limit
 * @param {number} fallback - 默认值
 * @returns {number} 位于 [1, MAX_ENTITY_LIMIT] 的整数
 */
function clampLimit(value, fallback) {
    const num = Math.floor(Number(value))
    if (!Number.isFinite(num) || num < 1) return fallback
    return Math.min(num, MAX_ENTITY_LIMIT)
}

/**
 * 解析作用域 ID：优先显式传入，其次从当前事件推导，最后退回全局。
 * 支持的取值：
 * - 'global'：全局共享；
 * - 'user:<ID>'：用户个人信息；
 * - 'group:<ID>'：群内共享；
 * - 'group:<ID>:user:<ID>'：某人在某群内的记忆。
 * @param {Object} args - 工具参数
 * @param {Object} ctx - MCP 上下文
 * @returns {{scopeId: string, mode: string}} 作用域与推导方式
 */
function resolveScopeId(args, ctx) {
    if (args.scope_id) return { scopeId: String(args.scope_id), mode: 'explicit' }

    const e = ctx.getEvent()
    if (!e) return { scopeId: 'global', mode: 'global' }

    const groupId = e.group_id?.toString()
    const userId = e.user_id?.toString()
    if (groupId && userId) {
        return { scopeId: `group:${groupId}:user:${userId}`, mode: 'group_user' }
    }
    if (groupId) return { scopeId: `group:${groupId}`, mode: 'group' }
    if (userId) return { scopeId: `user:${userId}`, mode: 'user' }
    return { scopeId: 'global', mode: 'global' }
}

/** 允许查询的实体会话作用域名（当用户未传 scope_id 时使用） */
async function resolveSearchScopes(args, ctx) {
    if (args.scope_id) return [String(args.scope_id)]
    const e = ctx.getEvent()
    if (!e) return []
    const scopes = []
    const groupId = e.group_id?.toString()
    const userId = e.user_id?.toString()
    if (groupId && userId) scopes.push(`group:${groupId}:user:${userId}`)
    if (userId) scopes.push(`user:${userId}`)
    if (groupId) scopes.push(`group:${groupId}`)
    scopes.push('global')
    return scopes
}

/**
 * 实体行 → 精简输出（属性对象可能很大，仅保留可读字段）
 * @param {Object} entity - KnowledgeGraphService _parseEntityRow 输出
 * @returns {Object} 精简实体
 */
function toEntityBrief(entity) {
    if (!entity) return null
    return {
        entity_id: entity.entityId,
        name: entity.name,
        type: entity.entityType,
        scope_id: entity.scopeId,
        properties: entity.properties || null,
        version: entity.version,
        updated_at: entity.updatedAt
    }
}

export const knowledgeGraphTools = [
    {
        name: 'kg_get_knowledge',
        description:
            '获取当前用户/群的知识图谱上下文。系统在用户记忆相关的知识（人物、物品、地点、事件及其关系）可用于回答问题时，应优先调用本工具获取结构化知识。',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户ID（不填则使用当前用户，仅限查询）' },
                group_id: { type: 'string', description: '群号（不填则使用当前群）' },
                max_entities: {
                    type: 'integer',
                    description: '最大返回实体数，默认15',
                    minimum: 1,
                    maximum: 100
                },
                include_relations: {
                    type: 'boolean',
                    description: '是否包含实体间关系，默认true'
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const e = ctx.getEvent()
                const userId = args.user_id || e?.user_id?.toString()
                if (!userId) {
                    return { success: false, error: '需要 user_id 参数或在会话中使用' }
                }
                const groupId = args.group_id || e?.group_id?.toString() || null
                const context = service.getKnowledgeContext(String(userId), groupId ? String(groupId) : null, {
                    maxEntities: clampLimit(args.max_entities, 15),
                    includeRelations: args.include_relations !== false
                })
                return { success: !!context, context: context || '' }
            } catch (err) {
                return { success: false, error: `获取知识图谱上下文失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_list_entities',
        description: '列出知识图谱中指定作用域的实体。需要查看当前用户或群积累了哪些实体时调用。',
        inputSchema: {
            type: 'object',
            properties: {
                scope_id: {
                    type: 'string',
                    description:
                        '作用域ID（global / user:<ID> / group:<ID> / group:<ID>:user:<ID>，不填则按当前会话推导）'
                },
                type: { type: 'string', description: '按实体类型筛选', enum: ENTITY_TYPE_ENUM },
                limit: {
                    type: 'integer',
                    description: `返回数量，默认${DEFAULT_ENTITY_LIMIT}，最大${MAX_ENTITY_LIMIT}`,
                    minimum: 1,
                    maximum: MAX_ENTITY_LIMIT
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const { scopeId, mode } = resolveScopeId(args, ctx)
                const entities = service.listEntities(scopeId, {
                    limit: clampLimit(args.limit, DEFAULT_ENTITY_LIMIT),
                    ...(args.type ? { type: args.type } : {})
                })
                return {
                    success: true,
                    scope_id: scopeId,
                    mode,
                    count: entities.length,
                    entities: entities.map(toEntityBrief)
                }
            } catch (err) {
                return { success: false, error: `列出实体失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_search_entities',
        description: '按名称模糊搜索知识图谱实体。用户提到某个人、物品或概念时，可用本工具查找已有实体。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '实体名称关键词' },
                type: { type: 'string', description: '按实体类型筛选', enum: ENTITY_TYPE_ENUM },
                limit: {
                    type: 'integer',
                    description: `返回数量，默认10，最大${MAX_ENTITY_LIMIT}`,
                    minimum: 1,
                    maximum: MAX_ENTITY_LIMIT
                }
            },
            required: ['query']
        },
        handler: async (args, ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const scopes = await resolveSearchScopes(args, ctx)
                const entities = service.searchEntities(String(args.query), scopes, {
                    limit: clampLimit(args.limit, 10),
                    ...(args.type ? { type: args.type } : {})
                })
                return {
                    success: true,
                    query: args.query,
                    count: entities.length,
                    entities: entities.map(toEntityBrief)
                }
            } catch (err) {
                return { success: false, error: `搜索实体失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_save_entity',
        description:
            '在知识图谱中保存或更新一个实体（人物、物品、地点、概念、事件）。当用户透露的新信息值得长期记住时，应主动调用保存；同一作用域内同名实体自动合并并更新。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '实体名称' },
                type: { type: 'string', description: '实体类型', enum: ENTITY_TYPE_ENUM },
                scope_id: {
                    type: 'string',
                    description: '作用域ID（不填则按当前会话推导，如 group:123:user:456）'
                },
                properties: {
                    type: 'object',
                    description: '实体属性（如 {age: 20, job: "学生"}），保存为 JSON 对象'
                }
            },
            required: ['name', 'type']
        },
        handler: async (args, ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const { scopeId, mode } = resolveScopeId(args, ctx)
                const properties = args.properties && typeof args.properties === 'object' ? args.properties : {}
                const entity = service.createEntity({
                    name: String(args.name),
                    type: args.type,
                    scopeId,
                    properties,
                    changeReason: '工具调用保存'
                })
                return { success: true, entity: toEntityBrief(entity), scope_id: scopeId, mode }
            } catch (err) {
                return { success: false, error: `保存实体失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_update_entity',
        description: '更新知识图谱中已有实体的属性或类型。用户纠正/补充之前的信息时调用（如改名、更新年龄）。',
        inputSchema: {
            type: 'object',
            properties: {
                entity_id: { type: 'string', description: '实体ID（可通过 kg_search_entities 查询）' },
                name: { type: 'string', description: '新的实体名称' },
                type: { type: 'string', description: '新的实体类型', enum: ENTITY_TYPE_ENUM },
                properties: { type: 'object', description: '新的实体属性，整体替换原属性' }
            },
            required: ['entity_id']
        },
        handler: async (args, _ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const updates = {}
                if (args.name) updates.name = String(args.name)
                if (args.type) updates.type = args.type
                if (args.properties && typeof args.properties === 'object') updates.properties = args.properties
                if (Object.keys(updates).length === 0) {
                    return { success: false, error: '没有要更新的字段' }
                }
                const entity = service.updateEntity(String(args.entity_id), {
                    ...updates,
                    changeReason: '工具调用更新'
                })
                return { success: true, entity: toEntityBrief(entity) }
            } catch (err) {
                return { success: false, error: `更新实体失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_delete_entity',
        description: '删除知识图谱中的实体（保留历史可回滚）。当用户明确表示某信息作废时调用。',
        inputSchema: {
            type: 'object',
            properties: { entity_id: { type: 'string', description: '实体ID' } },
            required: ['entity_id']
        },
        handler: async (args, _ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const deleted = service.deleteEntity(String(args.entity_id), '工具调用删除')
                return { success: deleted, entity_id: args.entity_id }
            } catch (err) {
                return { success: false, error: `删除实体失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_entity_history',
        description: '获取知识图谱实体的历史版本记录。需要了解某实体曾如何演变时调用。',
        inputSchema: {
            type: 'object',
            properties: {
                entity_id: { type: 'string', description: '实体ID' },
                limit: { type: 'integer', description: '返回数量，默认10，最大100', minimum: 1, maximum: 100 }
            },
            required: ['entity_id']
        },
        handler: async (args, _ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const history = service.getEntityHistory(String(args.entity_id), clampLimit(args.limit, 10))
                return { success: true, entity_id: args.entity_id, count: history.length, history }
            } catch (err) {
                return { success: false, error: `获取实体历史失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_entity_relations',
        description: '获取知识图谱中与某实体直接关联的其他实体（关系列表）。',
        inputSchema: {
            type: 'object',
            properties: { entity_id: { type: 'string', description: '实体ID' } },
            required: ['entity_id']
        },
        handler: async (args, _ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const relationships = service.getEntityRelationships(String(args.entity_id))
                return {
                    success: true,
                    entity_id: args.entity_id,
                    count: relationships.length,
                    relationships: relationships.map(r => ({
                        relationship_id: r.relationshipId,
                        relation_type: r.relationType,
                        from_entity_id: r.fromEntityId,
                        to_entity_id: r.toEntityId,
                        properties: r.properties || null
                    }))
                }
            } catch (err) {
                return { success: false, error: `获取实体关系失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_save_relation',
        description:
            '在知识图谱中保存两个实体之间的关系（如"张三 认识 李四"）。已知实体 ID 或名称时调用，用于构建实体间的关系网络。',
        inputSchema: {
            type: 'object',
            properties: {
                from_entity: { type: 'string', description: '起点实体ID或精确名称（优先当作ID）' },
                to_entity: { type: 'string', description: '终点实体ID或精确名称（优先当作ID）' },
                relation_type: { type: 'string', description: '关系类型（如 knows/likes/works_at）' },
                scope_id: { type: 'string', description: '作用域ID（不填则按当前会话推导）' },
                properties: { type: 'object', description: '关系属性' }
            },
            required: ['from_entity', 'to_entity', 'relation_type']
        },
        handler: async (args, ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const { scopeId, mode } = resolveScopeId(args, ctx)
                const resolveEntityId = nameOrId => {
                    const direct = service.getEntity(String(nameOrId))
                    if (direct) return direct.entityId
                    const found = service.findEntity(String(nameOrId), scopeId)
                    if (found) return found.entityId
                    throw new Error(`作用域 ${scopeId} 中未找到实体: ${nameOrId}`)
                }
                const fromEntityId = resolveEntityId(args.from_entity)
                const toEntityId = resolveEntityId(args.to_entity)
                const relationship = service.createRelationship({
                    fromEntityId,
                    toEntityId,
                    relationType: String(args.relation_type),
                    scopeId,
                    properties: args.properties || {},
                    changeReason: '工具调用保存'
                })
                return {
                    success: true,
                    relationship: {
                        relationship_id: relationship.relationshipId,
                        relation_type: relationship.relationType,
                        from_entity_id: relationship.fromEntityId,
                        to_entity_id: relationship.toEntityId
                    },
                    scope_id: scopeId,
                    mode
                }
            } catch (err) {
                return { success: false, error: `保存关系失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_delete_relation',
        description: '删除知识图谱中的关系（保留历史可回滚）。',
        inputSchema: {
            type: 'object',
            properties: { relationship_id: { type: 'string', description: '关系ID' } },
            required: ['relationship_id']
        },
        handler: async (args, _ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const deleted = service.deleteRelationship(String(args.relationship_id), '工具调用删除')
                return { success: deleted, relationship_id: args.relationship_id }
            } catch (err) {
                return { success: false, error: `删除关系失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_query_subgraph',
        description:
            '以某实体为中心探索知识图谱子图（返回指定深度内的实体与关系）。需要了解"和X相关的所有信息"时调用。',
        inputSchema: {
            type: 'object',
            properties: {
                entity_id: { type: 'string', description: '中心实体ID' },
                depth: { type: 'integer', description: '探索深度，默认1，最大3', minimum: 1, maximum: 3 }
            },
            required: ['entity_id']
        },
        handler: async (args, _ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const depth = clampLimit(args.depth, 1)
                const subgraph = service.querySubgraph(String(args.entity_id), depth)
                return { success: true, entity_id: args.entity_id, depth, subgraph }
            } catch (err) {
                return { success: false, error: `查询子图失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kg_stats',
        description: '获取知识图谱的作用域统计（实体数、关系数、类型分布）。',
        inputSchema: {
            type: 'object',
            properties: {
                scope_id: { type: 'string', description: '作用域ID（不填则为当前会话作用域；传 null 查全局合计）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const service = await getKnowledgeGraphService()
                const scopeId = args.scope_id === 'null' ? null : args.scope_id || resolveScopeId(args, ctx).scopeId
                const stats = service.getScopeStats(scopeId)
                return { success: true, scope_id: scopeId, stats }
            } catch (err) {
                return { success: false, error: `获取图谱统计失败: ${err.message}` }
            }
        }
    }
]
