/**
 * KnowledgeGraphService - 知识图谱服务
 *
 * 提供知识图谱的核心操作:
 * - 实体 CRUD
 * - 关系 CRUD
 * - 版本历史管理
 * - 子图查询和路径查询
 * - 作用域共享管理
 */

import { databaseService, safeParse } from './DatabaseService.js'
import { chatLogger } from '../../core/utils/logger.js'
import { isDeepStrictEqual } from 'node:util'
import crypto from 'crypto'

const logger = chatLogger

/**
 * 带 HTTP 语义的知识图谱领域错误。
 *
 * 服务层仍可脱离 Express 使用；路由只读取 statusCode 决定响应状态。
 */
export class KnowledgeGraphError extends Error {
    /**
     * @param {string} message - 可直接展示给调用方的错误信息
     * @param {number} [statusCode=400] - 对应的 HTTP 状态码
     */
    constructor(message, statusCode = 400) {
        super(message)
        this.name = 'KnowledgeGraphError'
        this.statusCode = statusCode
    }
}

/**
 * 判断值是否为可序列化属性使用的普通对象。
 * @param {*} value - 待判断值
 * @returns {boolean} 是否为普通对象
 */
function isPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * 读取并清理必填字符串。
 * @param {*} value - 原始字段值
 * @param {string} fieldName - 接口字段名
 * @returns {string} 去除首尾空白后的值
 * @throws {KnowledgeGraphError} 字段缺失或为空时抛出
 */
function requiredString(value, fieldName) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new KnowledgeGraphError(`${fieldName} 必须为非空字符串`)
    }
    return value.trim()
}

/**
 * 校验图谱属性对象。
 * @param {*} value - properties 原始值
 * @param {boolean} [allowUndefined=true] - 是否允许字段缺失
 * @returns {Record<string, unknown>|null|undefined} 校验后的原值
 * @throws {KnowledgeGraphError} 值不是对象时抛出
 */
function validateProperties(value, allowUndefined = true) {
    if (value === undefined && allowUndefined) return undefined
    if (value === null) return null
    if (!isPlainObject(value)) {
        throw new KnowledgeGraphError('properties 必须为 JSON 对象或 null')
    }
    return value
}

/**
 * 判断对象是否显式携带某字段。
 * @param {object} value - 待检查对象
 * @param {string} key - 字段名
 * @returns {boolean} 是否拥有该字段
 */
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key)
}

/**
 * 校验整数范围，防止无效分页/遍历参数传入 SQLite 或图遍历循环。
 * @param {*} value - 原始值
 * @param {string} fieldName - 字段名
 * @param {number} fallback - 字段缺失时的默认值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 校验后的整数
 */
function boundedInteger(value, fieldName, fallback, min, max) {
    if (value === undefined || value === null || value === '') return fallback
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new KnowledgeGraphError(`${fieldName} 必须为 ${min} 到 ${max} 之间的整数`)
    }
    return parsed
}

class KnowledgeGraphService {
    constructor() {
        this.initialized = false
    }

    /**
     * 初始化服务
     */
    async init() {
        if (this.initialized) return this

        // 确保数据库已初始化（会自动创建表）
        databaseService.init()

        this.initialized = true
        logger.info('[KnowledgeGraph] 服务初始化完成')
        return this
    }

    /**
     * 获取数据库实例
     */
    _getDb() {
        databaseService.init()
        return databaseService.db
    }

    // ========== 实体操作 ==========

    /**
     * 创建实体
     * @param {Object} entity - 实体数据
     * @param {string} entity.name - 实体名称
     * @param {string} entity.type - 实体类型 (person, thing, place, concept, event)
     * @param {string} entity.scopeId - 作用域 ID
     * @param {Object} [entity.properties] - 属性
     * @returns {Object} 创建的实体
     */
    createEntity(entity) {
        if (!isPlainObject(entity)) {
            throw new KnowledgeGraphError('实体数据必须为 JSON 对象')
        }

        const properties = validateProperties(entity.properties)
        const normalized = {
            name: requiredString(entity.name, 'name'),
            type: requiredString(entity.type, 'type'),
            scopeId: requiredString(entity.scopeId, 'scopeId'),
            changeReason: typeof entity.changeReason === 'string' ? entity.changeReason.trim() : undefined
        }
        if (properties !== undefined) {
            normalized.properties = properties
        }
        const db = this._getDb()
        const entityId = this._generateEntityId(normalized.scopeId, normalized.name)
        const now = Date.now()

        // 同一作用域与名称生成稳定 ID；完全相同的重复创建直接返回，避免制造空版本
        const existing = this.getEntity(entityId)
        if (existing) {
            const updates = {}
            if (normalized.type !== existing.entityType) {
                updates.type = normalized.type
            }
            if (hasOwn(normalized, 'properties') && !isDeepStrictEqual(normalized.properties, existing.properties)) {
                updates.properties = normalized.properties
            }
            if (normalized.changeReason) {
                updates.changeReason = normalized.changeReason
            }
            return hasOwn(updates, 'type') || hasOwn(updates, 'properties')
                ? this.updateEntity(entityId, updates)
                : existing
        }

        const runCreate = db.transaction(() => {
            db.prepare(
                `
            INSERT INTO kg_entities (entity_id, entity_type, name, scope_id, properties, created_at, updated_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `
            ).run(
                entityId,
                normalized.type,
                normalized.name,
                normalized.scopeId,
                normalized.properties === undefined || normalized.properties === null
                    ? null
                    : JSON.stringify(normalized.properties),
                now,
                now
            )

            this._saveEntityHistory(entityId, {
                name: normalized.name,
                entityType: normalized.type,
                properties: normalized.properties,
                scopeId: normalized.scopeId,
                version: 1,
                changeType: 'created',
                changeReason: normalized.changeReason || '新建实体'
            })
        })
        runCreate()

        logger.debug(`[KnowledgeGraph] 创建实体: ${normalized.name} (${normalized.type})`)
        return this.getEntity(entityId)
    }

    /**
     * 获取实体
     */
    getEntity(entityId) {
        const db = this._getDb()
        const stmt = db.prepare('SELECT * FROM kg_entities WHERE entity_id = ?')
        const row = stmt.get(entityId)

        if (!row) return null

        return this._parseEntityRow(row)
    }

    /**
     * 根据名称和作用域查找实体
     */
    findEntity(name, scopeId, type = null) {
        const db = this._getDb()

        let sql = 'SELECT * FROM kg_entities WHERE name = ? AND scope_id = ?'
        const params = [name, scopeId]

        if (type) {
            sql += ' AND entity_type = ?'
            params.push(type)
        }

        const stmt = db.prepare(sql)
        const row = stmt.get(...params)

        return row ? this._parseEntityRow(row) : null
    }

    /**
     * 更新实体
     */
    updateEntity(entityId, updates) {
        const normalizedEntityId = requiredString(entityId, 'entityId')
        if (!isPlainObject(updates)) {
            throw new KnowledgeGraphError('实体更新数据必须为 JSON 对象')
        }

        const existing = this.getEntity(normalizedEntityId)
        if (!existing) {
            throw new KnowledgeGraphError(`实体不存在: ${normalizedEntityId}`, 404)
        }

        const hasName = hasOwn(updates, 'name')
        const hasType = hasOwn(updates, 'type')
        const hasProperties = hasOwn(updates, 'properties')
        if (!hasName && !hasType && !hasProperties) {
            throw new KnowledgeGraphError('至少提供 name、type 或 properties 中的一个字段')
        }

        const nextName = hasName ? requiredString(updates.name, 'name') : existing.name
        const nextType = hasType ? requiredString(updates.type, 'type') : existing.entityType
        const nextProperties = hasProperties ? validateProperties(updates.properties, false) : existing.properties

        if (nextName !== existing.name) {
            const duplicate = this.findEntity(nextName, existing.scopeId)
            if (duplicate && duplicate.entityId !== normalizedEntityId) {
                throw new KnowledgeGraphError(`作用域 ${existing.scopeId} 中已存在同名实体: ${nextName}`, 409)
            }
        }

        const db = this._getDb()
        const newVersion = existing.version + 1
        const now = Date.now()

        const runUpdate = db.transaction(() => {
            // 创建时已经保存 v1；后续只补尚未存在的旧版本，避免重复历史
            if (!this.hasEntityVersion(normalizedEntityId, existing.version)) {
                this._saveEntityHistory(normalizedEntityId, {
                    name: existing.name,
                    entityType: existing.entityType,
                    properties: existing.properties,
                    scopeId: existing.scopeId,
                    version: existing.version,
                    changeType: 'updated',
                    changeReason:
                        typeof updates.changeReason === 'string' && updates.changeReason.trim()
                            ? updates.changeReason.trim()
                            : '更新实体'
                })
            }

            db.prepare(
                `
            UPDATE kg_entities SET
                name = ?,
                entity_type = ?,
                properties = ?,
                updated_at = ?,
                version = ?
            WHERE entity_id = ?
        `
            ).run(
                nextName,
                nextType,
                nextProperties === null ? null : JSON.stringify(nextProperties),
                now,
                newVersion,
                normalizedEntityId
            )
        })
        runUpdate()

        logger.debug(`[KnowledgeGraph] 更新实体: ${normalizedEntityId} -> v${newVersion}`)
        return this.getEntity(normalizedEntityId)
    }

    /**
     * 删除实体（软删除，保留历史）
     */
    deleteEntity(entityId, reason = '手动删除') {
        const db = this._getDb()
        const existing = this.getEntity(entityId)

        if (!existing) return false

        // 历史、关系、实体三步删除必须原子提交，
        // 否则中途失败会留下指向已删实体的悬空关系
        const runDelete = db.transaction(() => {
            // 保存删除历史
            this._saveEntityHistory(entityId, {
                name: existing.name,
                entityType: existing.entityType,
                properties: existing.properties,
                scopeId: existing.scopeId,
                version: existing.version,
                changeType: 'deleted',
                changeReason: reason
            })

            // 关联关系也必须留下删除快照；否则经实体删除和直接删除关系会产生两套历史语义。
            const relatedRelationships = this.getEntityRelationships(entityId)
            for (const relationship of relatedRelationships) {
                this._saveRelationshipHistory(relationship.relationshipId, {
                    fromEntityId: relationship.fromEntityId,
                    toEntityId: relationship.toEntityId,
                    relationType: relationship.relationType,
                    properties: relationship.properties,
                    scopeId: relationship.scopeId,
                    version: relationship.version,
                    changeType: 'deleted',
                    changeReason: reason
                })
            }

            // 删除关联的关系
            db.prepare(
                `
            DELETE FROM kg_relationships 
            WHERE from_entity_id = ? OR to_entity_id = ?
        `
            ).run(entityId, entityId)

            // 删除实体
            db.prepare('DELETE FROM kg_entities WHERE entity_id = ?').run(entityId)
        })
        runDelete()

        logger.debug(`[KnowledgeGraph] 删除实体: ${entityId}`)
        return true
    }

    /**
     * 判断实体的某个历史版本是否存在
     *
     * 回滚接口要把「版本不存在」判成 404、把数据库故障判成 500，而 rollbackEntity
     * 两种情况都是抛 Error，无法从异常上区分。这里提供一次精确查询，让调用方在
     * 执行回滚前先自行判定，不必去匹配异常消息文本。
     * @param {string} entityId - 实体 ID
     * @param {number} version - 目标版本号
     * @returns {boolean} 该版本是否存在于历史表
     */
    hasEntityVersion(entityId, version) {
        const db = this._getDb()
        const row = db
            .prepare('SELECT 1 AS ok FROM kg_entity_history WHERE entity_id = ? AND version = ? LIMIT 1')
            .get(entityId, version)
        return Boolean(row)
    }

    /**
     * 获取实体历史版本
     */
    getEntityHistory(entityId, limit = 10) {
        const normalizedEntityId = requiredString(entityId, 'entityId')
        const normalizedLimit = boundedInteger(limit, 'limit', 10, 1, 500)
        const db = this._getDb()
        const stmt = db.prepare(`
            SELECT * FROM kg_entity_history
            WHERE entity_id = ?
            ORDER BY version DESC, id DESC
            LIMIT ?
        `)

        return stmt.all(normalizedEntityId, normalizedLimit).map(row => ({
            id: row.id,
            entityId: row.entity_id,
            version: row.version,
            name: row.name,
            entityType: row.entity_type,
            properties: row.properties ? safeParse(row.properties, null) : null,
            scopeId: row.scope_id,
            changedAt: row.changed_at,
            changeType: row.change_type,
            changeReason: row.change_reason
        }))
    }

    /**
     * 回滚实体到指定版本
     */
    rollbackEntity(entityId, targetVersion) {
        const normalizedEntityId = requiredString(entityId, 'entityId')
        const version = boundedInteger(targetVersion, 'targetVersion', 1, 1, 2147483647)
        const db = this._getDb()
        const history = db
            .prepare(
                `
                SELECT * FROM kg_entity_history
                WHERE entity_id = ? AND version = ?
                ORDER BY id DESC
                LIMIT 1
            `
            )
            .get(normalizedEntityId, version)

        if (!history) {
            throw new KnowledgeGraphError(`未找到版本 ${version}`, 404)
        }

        return this.updateEntity(normalizedEntityId, {
            name: history.name,
            type: history.entity_type,
            properties: history.properties ? safeParse(history.properties, null) : null,
            changeReason: `回滚到版本 ${version}`
        })
    }

    /**
     * 列出作用域下的所有实体
     */
    listEntities(scopeId, options = {}) {
        const normalizedScopeId = requiredString(scopeId, 'scopeId')
        if (!isPlainObject(options)) {
            throw new KnowledgeGraphError('options 必须为 JSON 对象')
        }

        const type =
            options.type === undefined || options.type === null || options.type === ''
                ? null
                : requiredString(options.type, 'type')
        const limit = boundedInteger(options.limit, 'limit', 100, 1, 10000)
        const offset = boundedInteger(options.offset, 'offset', 0, 0, 1000000)
        const db = this._getDb()

        let sql = 'SELECT * FROM kg_entities WHERE scope_id = ?'
        const params = [normalizedScopeId]

        if (type) {
            sql += ' AND entity_type = ?'
            params.push(type)
        }

        sql += ' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?'
        params.push(limit, offset)

        return db
            .prepare(sql)
            .all(...params)
            .map(row => this._parseEntityRow(row))
    }

    /**
     * 精确统计作用域内符合名称与类型筛选的实体数量。
     * @param {string} scopeId - 作用域 ID
     * @param {{query?: string, type?: string}} [options] - 与列表页一致的筛选条件
     * @returns {number} 匹配实体数量
     */
    countEntities(scopeId, options = {}) {
        const normalizedScopeId = requiredString(scopeId, 'scopeId')
        if (!isPlainObject(options)) {
            throw new KnowledgeGraphError('options 必须为 JSON 对象')
        }
        if (options.query !== undefined && typeof options.query !== 'string') {
            throw new KnowledgeGraphError('query 必须为字符串')
        }

        const query = typeof options.query === 'string' ? options.query.trim() : ''
        const type =
            options.type === undefined || options.type === null || options.type === ''
                ? null
                : requiredString(options.type, 'type')
        const params = [normalizedScopeId]
        let sql = 'SELECT COUNT(*) AS count FROM kg_entities WHERE scope_id = ?'

        if (query) {
            sql += " AND name LIKE ? ESCAPE '\\'"
            params.push(`%${databaseService.escapeLikePattern(query)}%`)
        }
        if (type) {
            sql += ' AND entity_type = ?'
            params.push(type)
        }

        return this._getDb()
            .prepare(sql)
            .get(...params).count
    }

    /**
     * 获取全部或指定作用域的图谱统计。
     * @param {string|null} [scopeId=null] - 作用域；null 表示全部作用域
     * @returns {{entityCount:number, relationshipCount:number, typeStats:Record<string,number>}} 统计结果
     */
    getScopeStats(scopeId = null) {
        const normalizedScopeId =
            scopeId === null || scopeId === undefined || scopeId === '' ? null : requiredString(scopeId, 'scopeId')
        const db = this._getDb()
        const entityCount = normalizedScopeId
            ? db.prepare('SELECT COUNT(*) AS count FROM kg_entities WHERE scope_id = ?').get(normalizedScopeId).count
            : db.prepare('SELECT COUNT(*) AS count FROM kg_entities').get().count
        const relationshipCount = normalizedScopeId
            ? db.prepare('SELECT COUNT(*) AS count FROM kg_relationships WHERE scope_id = ?').get(normalizedScopeId)
                  .count
            : db.prepare('SELECT COUNT(*) AS count FROM kg_relationships').get().count
        const typeRows = normalizedScopeId
            ? db
                  .prepare(
                      'SELECT entity_type, COUNT(*) AS count FROM kg_entities WHERE scope_id = ? GROUP BY entity_type'
                  )
                  .all(normalizedScopeId)
            : db.prepare('SELECT entity_type, COUNT(*) AS count FROM kg_entities GROUP BY entity_type').all()
        return {
            entityCount,
            relationshipCount,
            typeStats: Object.fromEntries(typeRows.map(row => [row.entity_type, row.count]))
        }
    }

    /** @returns {string[]} 全部有数据的作用域，始终包含 global */
    listScopes() {
        const scopes = new Set(['global'])
        for (const row of this._getDb().prepare('SELECT DISTINCT scope_id FROM kg_entities ORDER BY scope_id').all()) {
            if (typeof row.scope_id === 'string' && row.scope_id.trim()) scopes.add(row.scope_id)
        }
        return Array.from(scopes).sort()
    }

    /**
     * 获取有界图谱可视化摘要，按连接度和更新时间选择节点，并仅返回节点内部关系。
     * @param {string} scopeId - 作用域
     * @param {{limit?:number, focusEntityId?:string}} [options] - 摘要选项
     * @returns {Object} 有界图谱及完整计数元数据
     */
    getVisualization(scopeId, options = {}) {
        const normalizedScopeId = requiredString(scopeId, 'scopeId')
        if (!isPlainObject(options)) throw new KnowledgeGraphError('options 必须为 JSON 对象')
        const limit = boundedInteger(options.limit, 'limit', 80, 1, 500)
        const focusEntityId =
            options.focusEntityId === undefined || options.focusEntityId === null || options.focusEntityId === ''
                ? ''
                : requiredString(options.focusEntityId, 'focusEntityId')
        if (focusEntityId) {
            const focus = this.getEntity(focusEntityId)
            if (!focus || focus.scopeId !== normalizedScopeId) {
                throw new KnowledgeGraphError(`作用域 ${normalizedScopeId} 中不存在焦点实体: ${focusEntityId}`, 404)
            }
        }

        const db = this._getDb()
        const rows = db
            .prepare(
                `
                SELECT e.*, COUNT(r.id) AS relation_degree
                FROM kg_entities e
                LEFT JOIN kg_relationships r
                    ON r.scope_id = e.scope_id
                    AND (r.from_entity_id = e.entity_id OR r.to_entity_id = e.entity_id)
                WHERE e.scope_id = ?
                GROUP BY e.id
                ORDER BY
                    CASE WHEN e.entity_id = ? THEN 0 ELSE 1 END ASC,
                    relation_degree DESC,
                    e.updated_at DESC,
                    e.id DESC
                LIMIT ?
            `
            )
            .all(normalizedScopeId, focusEntityId, limit)
        const entities = rows.map(row => this._parseEntityRow(row))
        const entityIds = entities.map(entity => entity.entityId)
        let relationships = []
        if (entityIds.length > 0) {
            const placeholders = entityIds.map(() => '?').join(',')
            relationships = db
                .prepare(
                    `
                    SELECT * FROM kg_relationships
                    WHERE scope_id = ?
                      AND from_entity_id IN (${placeholders})
                      AND to_entity_id IN (${placeholders})
                    ORDER BY updated_at DESC, id DESC
                `
                )
                .all(normalizedScopeId, ...entityIds, ...entityIds)
                .map(row => this._parseRelationshipRow(row))
        }
        const stats = this.getScopeStats(normalizedScopeId)
        return {
            entities,
            relationships,
            totalEntities: stats.entityCount,
            totalRelationships: stats.relationshipCount,
            truncated: stats.entityCount > entities.length,
            limit
        }
    }

    /**
     * 搜索实体（简单文本匹配）
     */
    searchEntities(query, scopeIds = [], options = {}) {
        if (typeof query !== 'string') {
            throw new KnowledgeGraphError('query 必须为字符串')
        }
        if (!Array.isArray(scopeIds)) {
            throw new KnowledgeGraphError('scopeIds 必须为字符串数组')
        }
        if (!isPlainObject(options)) {
            throw new KnowledgeGraphError('options 必须为 JSON 对象')
        }

        const normalizedScopes = scopeIds.map((scopeId, index) => requiredString(scopeId, `scopeIds[${index}]`))
        const type =
            options.type === undefined || options.type === null || options.type === ''
                ? null
                : requiredString(options.type, 'type')
        const limit = boundedInteger(options.limit, 'limit', 20, 1, 1000)
        const offset = boundedInteger(options.offset, 'offset', 0, 0, 1000000)
        const db = this._getDb()
        const escapedQuery = databaseService.escapeLikePattern(query.trim())

        let sql = "SELECT * FROM kg_entities WHERE name LIKE ? ESCAPE '\\'"
        const params = [`%${escapedQuery}%`]

        if (normalizedScopes.length > 0) {
            sql += ` AND scope_id IN (${normalizedScopes.map(() => '?').join(',')})`
            params.push(...normalizedScopes)
        }

        if (type) {
            sql += ' AND entity_type = ?'
            params.push(type)
        }

        sql += ' ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?'
        params.push(limit, offset)

        return db
            .prepare(sql)
            .all(...params)
            .map(row => this._parseEntityRow(row))
    }

    // ========== 关系操作 ==========

    /**
     * 创建关系
     */
    createRelationship(relationship) {
        if (!isPlainObject(relationship)) {
            throw new KnowledgeGraphError('关系数据必须为 JSON 对象')
        }

        const normalized = {
            fromEntityId: requiredString(relationship.fromEntityId, 'fromEntityId'),
            toEntityId: requiredString(relationship.toEntityId, 'toEntityId'),
            relationType: requiredString(relationship.relationType, 'relationType'),
            scopeId: requiredString(relationship.scopeId, 'scopeId'),
            properties: validateProperties(relationship.properties),
            changeReason: typeof relationship.changeReason === 'string' ? relationship.changeReason.trim() : undefined
        }

        const fromEntity = this.getEntity(normalized.fromEntityId)
        if (!fromEntity) {
            throw new KnowledgeGraphError(`起点实体不存在: ${normalized.fromEntityId}`, 404)
        }
        const toEntity = this.getEntity(normalized.toEntityId)
        if (!toEntity) {
            throw new KnowledgeGraphError(`终点实体不存在: ${normalized.toEntityId}`, 404)
        }
        if (fromEntity.scopeId !== normalized.scopeId || toEntity.scopeId !== normalized.scopeId) {
            throw new KnowledgeGraphError('关系作用域必须与两端实体的作用域一致')
        }

        const db = this._getDb()
        const relationshipId = this._generateRelationshipId(
            normalized.fromEntityId,
            normalized.toEntityId,
            normalized.relationType
        )
        const now = Date.now()

        const existing = this.getRelationship(relationshipId)
        if (existing) {
            if (normalized.properties === undefined) return existing
            if (isDeepStrictEqual(normalized.properties, existing.properties)) return existing
            return this.updateRelationship(relationshipId, normalized)
        }

        const runCreate = db.transaction(() => {
            db.prepare(
                `
                INSERT INTO kg_relationships
                (relationship_id, from_entity_id, to_entity_id, relation_type, properties, scope_id, created_at, updated_at, version)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            `
            ).run(
                relationshipId,
                normalized.fromEntityId,
                normalized.toEntityId,
                normalized.relationType,
                normalized.properties === undefined || normalized.properties === null
                    ? null
                    : JSON.stringify(normalized.properties),
                normalized.scopeId,
                now,
                now
            )

            this._saveRelationshipHistory(relationshipId, {
                fromEntityId: normalized.fromEntityId,
                toEntityId: normalized.toEntityId,
                relationType: normalized.relationType,
                properties: normalized.properties,
                scopeId: normalized.scopeId,
                version: 1,
                changeType: 'created',
                changeReason: normalized.changeReason || '新建关系'
            })
        })
        runCreate()

        logger.debug(`[KnowledgeGraph] 创建关系: ${normalized.relationType}`)
        return this.getRelationship(relationshipId)
    }

    /**
     * 获取关系
     */
    getRelationship(relationshipId) {
        const db = this._getDb()
        const stmt = db.prepare('SELECT * FROM kg_relationships WHERE relationship_id = ?')
        const row = stmt.get(relationshipId)

        return row ? this._parseRelationshipRow(row) : null
    }

    /**
     * 更新关系
     */
    updateRelationship(relationshipId, updates) {
        const normalizedRelationshipId = requiredString(relationshipId, 'relationshipId')
        if (!isPlainObject(updates)) {
            throw new KnowledgeGraphError('关系更新数据必须为 JSON 对象')
        }

        const existing = this.getRelationship(normalizedRelationshipId)
        if (!existing) {
            throw new KnowledgeGraphError(`关系不存在: ${normalizedRelationshipId}`, 404)
        }
        if (!hasOwn(updates, 'properties')) {
            throw new KnowledgeGraphError('关系更新必须提供 properties')
        }

        const nextProperties = validateProperties(updates.properties, false)
        const db = this._getDb()
        const newVersion = existing.version + 1
        const now = Date.now()

        const runUpdate = db.transaction(() => {
            // 创建时已写入 v1；后续只补尚未存在的旧版本，避免同一版本重复出现在历史中。
            if (!this.hasRelationshipVersion(normalizedRelationshipId, existing.version)) {
                this._saveRelationshipHistory(normalizedRelationshipId, {
                    fromEntityId: existing.fromEntityId,
                    toEntityId: existing.toEntityId,
                    relationType: existing.relationType,
                    properties: existing.properties,
                    scopeId: existing.scopeId,
                    version: existing.version,
                    changeType: 'updated',
                    changeReason:
                        typeof updates.changeReason === 'string' && updates.changeReason.trim()
                            ? updates.changeReason.trim()
                            : '更新关系'
                })
            }

            db.prepare(
                `
                UPDATE kg_relationships SET
                    properties = ?,
                    updated_at = ?,
                    version = ?
                WHERE relationship_id = ?
            `
            ).run(
                nextProperties === null ? null : JSON.stringify(nextProperties),
                now,
                newVersion,
                normalizedRelationshipId
            )
        })
        runUpdate()

        return this.getRelationship(normalizedRelationshipId)
    }

    /**
     * 判断关系的某个历史版本是否存在。
     * @param {string} relationshipId - 关系 ID
     * @param {number} version - 目标版本号
     * @returns {boolean} 历史版本是否存在
     */
    hasRelationshipVersion(relationshipId, version) {
        const normalizedRelationshipId = requiredString(relationshipId, 'relationshipId')
        const normalizedVersion = boundedInteger(version, 'version', 1, 1, 2147483647)
        const row = this._getDb()
            .prepare('SELECT 1 AS ok FROM kg_relationship_history WHERE relationship_id = ? AND version = ? LIMIT 1')
            .get(normalizedRelationshipId, normalizedVersion)
        return Boolean(row)
    }

    /**
     * 获取关系历史版本。
     * @param {string} relationshipId - 关系 ID
     * @param {number} [limit=10] - 最大返回数量
     * @returns {Array<Object>} 按版本倒序排列的历史快照
     */
    getRelationshipHistory(relationshipId, limit = 10) {
        const normalizedRelationshipId = requiredString(relationshipId, 'relationshipId')
        const normalizedLimit = boundedInteger(limit, 'limit', 10, 1, 500)
        return this._getDb()
            .prepare(
                `
                SELECT * FROM kg_relationship_history
                WHERE relationship_id = ?
                ORDER BY version DESC, id DESC
                LIMIT ?
            `
            )
            .all(normalizedRelationshipId, normalizedLimit)
            .map(row => ({
                id: row.id,
                relationshipId: row.relationship_id,
                version: row.version,
                fromEntityId: row.from_entity_id,
                toEntityId: row.to_entity_id,
                relationType: row.relation_type,
                properties: row.properties ? safeParse(row.properties, null) : null,
                scopeId: row.scope_id,
                changedAt: row.changed_at,
                changeType: row.change_type,
                changeReason: row.change_reason
            }))
    }

    /**
     * 把关系属性恢复为指定历史版本，并以新版本保存。
     * @param {string} relationshipId - 关系 ID
     * @param {number} targetVersion - 目标历史版本号
     * @returns {Object} 回滚后的关系
     */
    rollbackRelationship(relationshipId, targetVersion) {
        const normalizedRelationshipId = requiredString(relationshipId, 'relationshipId')
        const version = boundedInteger(targetVersion, 'targetVersion', 1, 1, 2147483647)
        const history = this._getDb()
            .prepare(
                `
                SELECT * FROM kg_relationship_history
                WHERE relationship_id = ? AND version = ?
                ORDER BY id DESC
                LIMIT 1
            `
            )
            .get(normalizedRelationshipId, version)

        if (!history) {
            throw new KnowledgeGraphError(`未找到版本 ${version}`, 404)
        }

        return this.updateRelationship(normalizedRelationshipId, {
            properties: history.properties ? safeParse(history.properties, null) : null,
            changeReason: `回滚到版本 ${version}`
        })
    }

    /**
     * 删除关系
     */
    deleteRelationship(relationshipId, reason = '手动删除') {
        const normalizedRelationshipId = requiredString(relationshipId, 'relationshipId')
        const db = this._getDb()
        const existing = this.getRelationship(normalizedRelationshipId)

        if (!existing) return false

        const runDelete = db.transaction(() => {
            this._saveRelationshipHistory(normalizedRelationshipId, {
                fromEntityId: existing.fromEntityId,
                toEntityId: existing.toEntityId,
                relationType: existing.relationType,
                properties: existing.properties,
                scopeId: existing.scopeId,
                version: existing.version,
                changeType: 'deleted',
                changeReason: typeof reason === 'string' && reason.trim() ? reason.trim() : '手动删除'
            })

            db.prepare('DELETE FROM kg_relationships WHERE relationship_id = ?').run(normalizedRelationshipId)
        })
        runDelete()

        return true
    }

    /**
     * 获取实体的所有关系
     */
    getEntityRelationships(entityId, direction = 'both') {
        const normalizedEntityId = requiredString(entityId, 'entityId')
        if (!['both', 'incoming', 'outgoing'].includes(direction)) {
            throw new KnowledgeGraphError('direction 只能是 both、incoming 或 outgoing')
        }

        const db = this._getDb()
        let sql = 'SELECT * FROM kg_relationships WHERE '
        if (direction === 'outgoing') {
            sql += 'from_entity_id = ?'
        } else if (direction === 'incoming') {
            sql += 'to_entity_id = ?'
        } else {
            sql += 'from_entity_id = ? OR to_entity_id = ?'
        }

        const stmt = db.prepare(sql)
        const params = direction === 'both' ? [normalizedEntityId, normalizedEntityId] : [normalizedEntityId]
        return stmt.all(...params).map(row => this._parseRelationshipRow(row))
    }

    // ========== 图查询 ==========

    /**
     * 查询子图（N 跳邻居）
     */
    querySubgraph(entityId, depth = 2, scopeIds = [], options = {}) {
        const normalizedEntityId = requiredString(entityId, 'entityId')
        const normalizedDepth = boundedInteger(depth, 'depth', 2, 0, 10)
        if (!Array.isArray(scopeIds)) {
            throw new KnowledgeGraphError('scopeIds 必须为字符串数组')
        }
        const normalizedScopes = scopeIds.map((scopeId, index) => requiredString(scopeId, `scopeIds[${index}]`))
        if (!isPlainObject(options)) throw new KnowledgeGraphError('options 必须为 JSON 对象')
        const maxNodes = boundedInteger(options.maxNodes, 'maxNodes', 200, 1, 1000)
        const maxEdges = boundedInteger(options.maxEdges, 'maxEdges', 400, 0, 5000)
        const rootEntity = this.getEntity(normalizedEntityId)
        if (!rootEntity) {
            throw new KnowledgeGraphError(`实体不存在: ${normalizedEntityId}`, 404)
        }

        const entities = new Map()
        const relationships = []
        const relationshipIds = new Set()
        const visited = new Set()
        const entityCache = new Map()
        // 入口实体已经在上面的存在性校验中确认，立即放入结果，保证 depth=0 或边界截断时
        // 仍然返回一个自洽的节点集合。
        entityCache.set(normalizedEntityId, rootEntity)
        entities.set(normalizedEntityId, rootEntity)
        const queue = [{ id: normalizedEntityId, currentDepth: 0 }]
        const discovered = new Set([normalizedEntityId])
        let cursor = 0
        let truncated = false

        while (cursor < queue.length) {
            const { id, currentDepth } = queue[cursor++]
            if (visited.has(id) || currentDepth > normalizedDepth) continue
            visited.add(id)

            if (currentDepth < normalizedDepth) {
                const rels = this.getEntityRelationships(id)
                for (const rel of rels) {
                    if (normalizedScopes.length > 0 && !normalizedScopes.includes(rel.scopeId)) {
                        continue
                    }

                    // 关系表没有外键约束；遇到历史脏数据时不能把悬空关系暴露给前端。
                    const neighborId = rel.fromEntityId === id ? rel.toEntityId : rel.fromEntityId
                    if (!entityCache.has(neighborId)) entityCache.set(neighborId, this.getEntity(neighborId))
                    const neighbor = entityCache.get(neighborId)
                    if (!neighbor) {
                        truncated = true
                        continue
                    }

                    // 无向遍历会从两端各看到一次同一关系。先按稳定 ID 去重，再计算
                    // maxEdges，避免重复关系提前耗尽边预算。
                    if (relationshipIds.has(rel.relationshipId)) continue

                    // maxEdges=0 时不应继续发现新节点；否则返回的实体会没有对应边，
                    // 也会让调用方误以为遍历仍然有效。
                    if (relationships.length >= maxEdges) {
                        truncated = true
                        continue
                    }

                    if (!discovered.has(neighborId)) {
                        if (discovered.size >= maxNodes) {
                            truncated = true
                            continue
                        }
                        discovered.add(neighborId)
                        entities.set(neighborId, neighbor)
                        queue.push({ id: neighborId, currentDepth: currentDepth + 1 })
                    }
                    relationships.push(rel)
                    relationshipIds.add(rel.relationshipId)
                }
            }
        }

        return {
            entities: Array.from(entities.values()),
            relationships: this._deduplicateRelationships(relationships),
            truncated,
            limit: maxNodes
        }
    }

    /**
     * 路径查询（最短路径）
     */
    pathQuery(fromEntityId, toEntityId, maxDepth = 5, relationTypes = []) {
        const normalizedFromEntityId = requiredString(fromEntityId, 'fromEntityId')
        const normalizedToEntityId = requiredString(toEntityId, 'toEntityId')
        const normalizedMaxDepth = boundedInteger(maxDepth, 'maxDepth', 5, 1, 10)
        if (!Array.isArray(relationTypes)) {
            throw new KnowledgeGraphError('relationTypes 必须为字符串数组')
        }
        const normalizedRelationTypes = relationTypes.map((relationType, index) =>
            requiredString(relationType, `relationTypes[${index}]`)
        )
        const entityCache = new Map()
        const fromEntity = this.getEntity(normalizedFromEntityId)
        if (!fromEntity) {
            throw new KnowledgeGraphError(`实体不存在: ${normalizedFromEntityId}`, 404)
        }
        entityCache.set(normalizedFromEntityId, fromEntity)
        const toEntity = this.getEntity(normalizedToEntityId)
        if (!toEntity) {
            throw new KnowledgeGraphError(`实体不存在: ${normalizedToEntityId}`, 404)
        }
        entityCache.set(normalizedToEntityId, toEntity)

        const getCachedEntity = entityId => {
            if (!entityCache.has(entityId)) entityCache.set(entityId, this.getEntity(entityId))
            return entityCache.get(entityId)
        }

        const visited = new Set()
        const discovered = new Set([normalizedFromEntityId])
        const queue = [[normalizedFromEntityId]]
        let cursor = 0

        while (cursor < queue.length) {
            const path = queue[cursor++]
            const currentId = path[path.length - 1]

            // path.length-1 是已走过的边数；目标检查必须在深度边界之后，避免
            // maxDepth=1 时误放行两条边的路径。
            if (path.length - 1 > normalizedMaxDepth || visited.has(currentId)) continue
            if (currentId === normalizedToEntityId) {
                return this._buildPathResult(path, normalizedRelationTypes)
            }
            if (path.length - 1 === normalizedMaxDepth) continue
            visited.add(currentId)

            const rels = this.getEntityRelationships(currentId, 'outgoing')
            for (const rel of rels) {
                if (normalizedRelationTypes.length > 0 && !normalizedRelationTypes.includes(rel.relationType)) {
                    continue
                }

                // 关系表没有外键约束；跳过指向已删除/损坏实体的边，避免把
                // 不完整的路径交给 _buildPathResult 再静默截断。
                if (!getCachedEntity(rel.toEntityId)) continue

                if (!discovered.has(rel.toEntityId)) {
                    discovered.add(rel.toEntityId)
                    queue.push([...path, rel.toEntityId])
                }
            }
        }

        return null
    }

    /**
     * 构建路径结果
     */
    _buildPathResult(entityIds, relationTypes = []) {
        const entities = []
        const relationships = []

        for (let i = 0; i < entityIds.length; i++) {
            const entity = this.getEntity(entityIds[i])
            if (!entity) return null
            entities.push(entity)

            if (i < entityIds.length - 1) {
                const rels = this.getEntityRelationships(entityIds[i], 'outgoing')
                const rel = rels.find(
                    relationship =>
                        relationship.toEntityId === entityIds[i + 1] &&
                        (relationTypes.length === 0 || relationTypes.includes(relationship.relationType))
                )
                if (!rel) return null
                relationships.push(rel)
            }
        }

        return { entities, relationships, path: entityIds }
    }

    // ========== 作用域共享 ==========

    /**
     * 创建共享配置
     */
    createScopeSharing(config) {
        if (!isPlainObject(config)) {
            throw new KnowledgeGraphError('共享配置必须为 JSON 对象')
        }
        const sourceScopeId = requiredString(config.sourceScopeId, 'sourceScopeId')
        const targetScopeId = requiredString(config.targetScopeId, 'targetScopeId')
        const shareType = requiredString(config.shareType, 'shareType')
        if (sourceScopeId === targetScopeId) {
            throw new KnowledgeGraphError('sourceScopeId 与 targetScopeId 不能相同')
        }
        let entityTypes = null
        if (config.entityTypes !== undefined && config.entityTypes !== null) {
            if (!Array.isArray(config.entityTypes)) {
                throw new KnowledgeGraphError('entityTypes 必须为字符串数组')
            }
            entityTypes = Array.from(
                new Set(config.entityTypes.map((value, index) => requiredString(value, `entityTypes[${index}]`)))
            )
        }
        if (this.getScopeSharing(sourceScopeId, targetScopeId)) {
            throw new KnowledgeGraphError(`作用域共享已存在: ${sourceScopeId} -> ${targetScopeId}`, 409)
        }

        const db = this._getDb()
        const stmt = db.prepare(`
            INSERT INTO kg_scope_sharing (source_scope_id, target_scope_id, share_type, entity_types, created_at)
            VALUES (?, ?, ?, ?, ?)
        `)

        stmt.run(sourceScopeId, targetScopeId, shareType, entityTypes ? JSON.stringify(entityTypes) : null, Date.now())

        return this.getScopeSharing(sourceScopeId, targetScopeId)
    }

    /**
     * 获取共享配置
     */
    getScopeSharing(sourceScopeId, targetScopeId) {
        const normalizedSourceScopeId = requiredString(sourceScopeId, 'sourceScopeId')
        const normalizedTargetScopeId = requiredString(targetScopeId, 'targetScopeId')
        const db = this._getDb()
        const stmt = db.prepare(`
            SELECT * FROM kg_scope_sharing 
            WHERE source_scope_id = ? AND target_scope_id = ?
        `)
        const row = stmt.get(normalizedSourceScopeId, normalizedTargetScopeId)

        if (!row) return null

        return {
            id: row.id,
            sourceScopeId: row.source_scope_id,
            targetScopeId: row.target_scope_id,
            shareType: row.share_type,
            entityTypes: row.entity_types ? safeParse(row.entity_types, null) : null,
            createdAt: row.created_at
        }
    }

    /**
     * 获取作用域可访问的所有共享源
     */
    getAccessibleScopes(scopeId) {
        const normalizedScopeId = requiredString(scopeId, 'scopeId')
        const db = this._getDb()
        const stmt = db.prepare(`
            SELECT * FROM kg_scope_sharing WHERE target_scope_id = ?
        `)

        return stmt.all(normalizedScopeId).map(row => ({
            sourceScopeId: row.source_scope_id,
            shareType: row.share_type,
            entityTypes: row.entity_types ? safeParse(row.entity_types, null) : null
        }))
    }

    /**
     * 删除共享配置
     */
    deleteScopeSharing(sourceScopeId, targetScopeId) {
        const normalizedSourceScopeId = requiredString(sourceScopeId, 'sourceScopeId')
        const normalizedTargetScopeId = requiredString(targetScopeId, 'targetScopeId')
        const db = this._getDb()
        const stmt = db.prepare(`
            DELETE FROM kg_scope_sharing 
            WHERE source_scope_id = ? AND target_scope_id = ?
        `)
        return stmt.run(normalizedSourceScopeId, normalizedTargetScopeId).changes > 0
    }

    // ========== 知识上下文获取 ==========

    /**
     * 获取用户的知识上下文（用于对话）
     */
    getKnowledgeContext(userId, groupId = null, options = {}) {
        const normalizedUserId = requiredString(userId, 'userId')
        const normalizedGroupId =
            groupId === null || groupId === undefined || groupId === '' ? null : requiredString(groupId, 'groupId')
        if (!isPlainObject(options)) {
            throw new KnowledgeGraphError('options 必须为 JSON 对象')
        }
        if (hasOwn(options, 'includeRelations') && typeof options.includeRelations !== 'boolean') {
            throw new KnowledgeGraphError('includeRelations 必须为布尔值')
        }

        const maxEntities = boundedInteger(options.maxEntities, 'maxEntities', 15, 1, 200)
        const includeRelations = options.includeRelations !== false
        const scopeIds = []
        if (normalizedGroupId) {
            scopeIds.push(`group:${normalizedGroupId}:user:${normalizedUserId}`)
        }
        scopeIds.push(`user:${normalizedUserId}`)
        if (normalizedGroupId) {
            scopeIds.push(`group:${normalizedGroupId}`)
        }
        scopeIds.push('global')

        for (const scopeId of [...scopeIds]) {
            const shared = this.getAccessibleScopes(scopeId)
            for (const share of shared) {
                if (!scopeIds.includes(share.sourceScopeId)) {
                    scopeIds.push(share.sourceScopeId)
                }
            }
        }

        const entitiesMap = new Map()
        for (const scopeId of scopeIds) {
            const entities = this.listEntities(scopeId, { limit: maxEntities })
            for (const entity of entities) {
                if (!entitiesMap.has(entity.entityId)) {
                    entitiesMap.set(entity.entityId, entity)
                }
            }
        }

        const entities = Array.from(entitiesMap.values()).slice(0, maxEntities)
        let relationships = []
        if (includeRelations && entities.length > 0) {
            const entityIds = new Set(entities.map(entity => entity.entityId))
            for (const entity of entities) {
                const rels = this.getEntityRelationships(entity.entityId)
                for (const rel of rels) {
                    if (entityIds.has(rel.fromEntityId) && entityIds.has(rel.toEntityId)) {
                        relationships.push(rel)
                    }
                }
            }
            relationships = this._deduplicateRelationships(relationships)
        }

        return this._formatKnowledgeContext(entities, relationships)
    }

    /**
     * 格式化知识上下文为文本
     */
    _formatKnowledgeContext(entities, relationships) {
        if (entities.length === 0) {
            return ''
        }

        const lines = ['【用户知识图谱】']

        // 按类型分组实体
        // 类型来自用户/模型输入，不能用普通对象承载 `__proto__` 等键，
        // 否则原型属性会被误当成数组并在 push 时抛错。
        const byType = Object.create(null)
        for (const entity of entities) {
            if (!byType[entity.entityType]) {
                byType[entity.entityType] = []
            }
            byType[entity.entityType].push(entity)
        }

        const typeNames = Object.freeze({
            person: '人物',
            thing: '物品',
            place: '地点',
            concept: '概念',
            event: '事件'
        })

        for (const [type, typeEntities] of Object.entries(byType)) {
            lines.push(`\n[${Object.hasOwn(typeNames, type) ? typeNames[type] : type}]`)
            for (const entity of typeEntities) {
                let line = `- ${entity.name}`
                if (entity.properties && Object.keys(entity.properties).length > 0) {
                    const props = Object.entries(entity.properties)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ')
                    line += ` (${props})`
                }
                lines.push(line)
            }
        }

        // 添加关系信息
        if (relationships.length > 0) {
            lines.push('\n[关系]')
            const entityNames = new Map(entities.map(e => [e.entityId, e.name]))
            for (const rel of relationships.slice(0, 10)) {
                const fromName = entityNames.get(rel.fromEntityId) || rel.fromEntityId
                const toName = entityNames.get(rel.toEntityId) || rel.toEntityId
                lines.push(`- ${fromName} --[${rel.relationType}]--> ${toName}`)
            }
        }

        return lines.join('\n')
    }

    // ========== 导入导出 ==========

    /**
     * 按稳定顺序迭代作用域实体。
     * @param {string} scopeId - 作用域
     * @returns {IterableIterator<Object>} 实体迭代器
     */
    *iterateScopeEntities(scopeId) {
        const normalizedScopeId = requiredString(scopeId, 'scopeId')
        const iterator = this._getDb()
            .prepare('SELECT * FROM kg_entities WHERE scope_id = ? ORDER BY id ASC')
            .iterate(normalizedScopeId)
        for (const row of iterator) yield this._parseEntityRow(row)
    }

    /**
     * 按稳定顺序迭代作用域关系。
     * @param {string} scopeId - 作用域
     * @returns {IterableIterator<Object>} 关系迭代器
     */
    *iterateScopeRelationships(scopeId) {
        const normalizedScopeId = requiredString(scopeId, 'scopeId')
        const iterator = this._getDb()
            .prepare('SELECT * FROM kg_relationships WHERE scope_id = ? ORDER BY id ASC')
            .iterate(normalizedScopeId)
        for (const row of iterator) yield this._parseRelationshipRow(row)
    }

    /**
     * 完整导出图谱；不再把 10000 个实体静默当作完整结果。
     */
    exportGraph(scopeId) {
        const normalizedScopeId = requiredString(scopeId, 'scopeId')
        const entities = Array.from(this.iterateScopeEntities(normalizedScopeId))
        const relationships = Array.from(this.iterateScopeRelationships(normalizedScopeId))

        return {
            schemaVersion: 1,
            scopeId: normalizedScopeId,
            exportedAt: Date.now(),
            counts: { entities: entities.length, relationships: relationships.length },
            truncated: false,
            entities,
            relationships
        }
    }

    /**
     * 导入图谱
     */
    importGraph(graphData, targetScopeId = null) {
        if (!isPlainObject(graphData)) {
            throw new KnowledgeGraphError('graphData 必须为 JSON 对象')
        }
        if (hasOwn(graphData, 'schemaVersion') && graphData.schemaVersion !== 1) {
            throw new KnowledgeGraphError(`不支持的图谱 schemaVersion: ${graphData.schemaVersion}`)
        }
        if (graphData.truncated === true) {
            throw new KnowledgeGraphError('截断的图谱摘要不能用于导入，请使用完整导出文件')
        }
        if (!Array.isArray(graphData.entities)) {
            throw new KnowledgeGraphError('graphData.entities 必须为数组')
        }
        if (!Array.isArray(graphData.relationships)) {
            throw new KnowledgeGraphError('graphData.relationships 必须为数组')
        }
        if (isPlainObject(graphData.counts)) {
            const expectedEntities = Number(graphData.counts.entities)
            const expectedRelationships = Number(graphData.counts.relationships)
            if (
                !Number.isInteger(expectedEntities) ||
                !Number.isInteger(expectedRelationships) ||
                expectedEntities !== graphData.entities.length ||
                expectedRelationships !== graphData.relationships.length
            ) {
                throw new KnowledgeGraphError('图谱 counts 与实际 entities/relationships 数量不一致')
            }
        }

        const scopeInput =
            targetScopeId === null ||
            targetScopeId === undefined ||
            (typeof targetScopeId === 'string' && !targetScopeId.trim())
                ? graphData.scopeId
                : targetScopeId
        const scopeId = requiredString(scopeInput, 'targetScopeId 或 graphData.scopeId')
        const entities = graphData.entities.map((entity, index) => {
            if (!isPlainObject(entity)) {
                throw new KnowledgeGraphError(`entities[${index}] 必须为 JSON 对象`)
            }
            return {
                sourceEntityId: requiredString(entity.entityId, `entities[${index}].entityId`),
                name: requiredString(entity.name, `entities[${index}].name`),
                type: requiredString(entity.entityType, `entities[${index}].entityType`),
                properties: validateProperties(entity.properties)
            }
        })
        const relationships = graphData.relationships.map((relationship, index) => {
            if (!isPlainObject(relationship)) {
                throw new KnowledgeGraphError(`relationships[${index}] 必须为 JSON 对象`)
            }
            return {
                fromEntityId: requiredString(relationship.fromEntityId, `relationships[${index}].fromEntityId`),
                toEntityId: requiredString(relationship.toEntityId, `relationships[${index}].toEntityId`),
                relationType: requiredString(relationship.relationType, `relationships[${index}].relationType`),
                properties: validateProperties(relationship.properties)
            }
        })

        const sourceEntityIds = new Set()
        for (const entity of entities) {
            if (sourceEntityIds.has(entity.sourceEntityId)) {
                throw new KnowledgeGraphError(`entities 中存在重复 entityId: ${entity.sourceEntityId}`)
            }
            sourceEntityIds.add(entity.sourceEntityId)
        }

        const db = this._getDb()
        const runImport = db.transaction(() => {
            const entityIdMap = new Map()

            for (const entity of entities) {
                const created = this.createEntity({
                    name: entity.name,
                    type: entity.type,
                    scopeId,
                    properties: entity.properties,
                    changeReason: '从导出数据导入'
                })
                entityIdMap.set(entity.sourceEntityId, created.entityId)
            }

            for (let index = 0; index < relationships.length; index++) {
                const relationship = relationships[index]
                const fromId = entityIdMap.get(relationship.fromEntityId) || relationship.fromEntityId
                const toId = entityIdMap.get(relationship.toEntityId) || relationship.toEntityId
                try {
                    this.createRelationship({
                        fromEntityId: fromId,
                        toEntityId: toId,
                        relationType: relationship.relationType,
                        scopeId,
                        properties: relationship.properties,
                        changeReason: '从导出数据导入'
                    })
                } catch (error) {
                    if (error instanceof KnowledgeGraphError) {
                        throw new KnowledgeGraphError(`relationships[${index}] 无效: ${error.message}`)
                    }
                    throw error
                }
            }

            return {
                entitiesImported: entities.length,
                relationshipsImported: relationships.length
            }
        })

        return runImport()
    }

    // ========== 私有方法 ==========

    _generateEntityId(scopeId, name) {
        const hash = crypto.createHash('md5').update(`${scopeId}:${name}`).digest('hex').slice(0, 8)
        return `${scopeId}:entity:${hash}`
    }

    _generateRelationshipId(fromId, toId, relationType) {
        const hash = crypto.createHash('md5').update(`${fromId}:${relationType}:${toId}`).digest('hex').slice(0, 8)
        return `rel:${hash}`
    }

    _parseEntityRow(row) {
        return {
            id: row.id,
            entityId: row.entity_id,
            entityType: row.entity_type,
            name: row.name,
            scopeId: row.scope_id,
            properties: row.properties ? safeParse(row.properties, null) : null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            version: row.version
        }
    }

    _parseRelationshipRow(row) {
        return {
            id: row.id,
            relationshipId: row.relationship_id,
            fromEntityId: row.from_entity_id,
            toEntityId: row.to_entity_id,
            relationType: row.relation_type,
            properties: row.properties ? safeParse(row.properties, null) : null,
            scopeId: row.scope_id,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            version: row.version
        }
    }

    _saveEntityHistory(entityId, data) {
        const db = this._getDb()
        const stmt = db.prepare(`
            INSERT INTO kg_entity_history 
            (entity_id, version, name, entity_type, properties, scope_id, changed_at, change_type, change_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        stmt.run(
            entityId,
            data.version,
            data.name,
            data.entityType,
            data.properties ? JSON.stringify(data.properties) : null,
            data.scopeId,
            Date.now(),
            data.changeType,
            data.changeReason || null
        )
    }

    _saveRelationshipHistory(relationshipId, data) {
        const db = this._getDb()
        const stmt = db.prepare(`
            INSERT INTO kg_relationship_history 
            (relationship_id, version, from_entity_id, to_entity_id, relation_type, properties, scope_id, changed_at, change_type, change_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        stmt.run(
            relationshipId,
            data.version,
            data.fromEntityId,
            data.toEntityId,
            data.relationType,
            data.properties ? JSON.stringify(data.properties) : null,
            data.scopeId,
            Date.now(),
            data.changeType,
            data.changeReason || null
        )
    }

    _deduplicateRelationships(relationships) {
        const seen = new Set()
        return relationships.filter(rel => {
            if (seen.has(rel.relationshipId)) return false
            seen.add(rel.relationshipId)
            return true
        })
    }
}

export const knowledgeGraphService = new KnowledgeGraphService()
export default KnowledgeGraphService
