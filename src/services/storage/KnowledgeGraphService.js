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

import { databaseService } from './DatabaseService.js'
import { chatLogger } from '../../core/utils/logger.js'
import crypto from 'crypto'

const logger = chatLogger

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
        const db = this._getDb()
        const entityId = this._generateEntityId(entity.scopeId, entity.name)
        const now = Date.now()

        // 检查实体是否已存在
        const existing = this.getEntity(entityId)
        if (existing) {
            // 更新现有实体
            return this.updateEntity(entityId, entity)
        }

        const stmt = db.prepare(`
            INSERT INTO kg_entities (entity_id, entity_type, name, scope_id, properties, created_at, updated_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `)

        stmt.run(
            entityId,
            entity.type,
            entity.name,
            entity.scopeId,
            entity.properties ? JSON.stringify(entity.properties) : null,
            now,
            now
        )

        // 记录历史
        this._saveEntityHistory(entityId, {
            name: entity.name,
            entityType: entity.type,
            properties: entity.properties,
            scopeId: entity.scopeId,
            version: 1,
            changeType: 'created',
            changeReason: entity.changeReason || '新建实体'
        })

        logger.debug(`[KnowledgeGraph] 创建实体: ${entity.name} (${entity.type})`)
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
        const db = this._getDb()
        const existing = this.getEntity(entityId)

        if (!existing) {
            throw new Error(`实体不存在: ${entityId}`)
        }

        const newVersion = existing.version + 1
        const now = Date.now()

        // 保存旧版本到历史
        this._saveEntityHistory(entityId, {
            name: existing.name,
            entityType: existing.entityType,
            properties: existing.properties,
            scopeId: existing.scopeId,
            version: existing.version,
            changeType: 'updated',
            changeReason: updates.changeReason || '更新实体'
        })

        // 更新实体
        const stmt = db.prepare(`
            UPDATE kg_entities SET
                name = COALESCE(?, name),
                entity_type = COALESCE(?, entity_type),
                properties = COALESCE(?, properties),
                updated_at = ?,
                version = ?
            WHERE entity_id = ?
        `)

        stmt.run(
            updates.name || null,
            updates.type || null,
            updates.properties ? JSON.stringify(updates.properties) : null,
            now,
            newVersion,
            entityId
        )

        logger.debug(`[KnowledgeGraph] 更新实体: ${entityId} -> v${newVersion}`)
        return this.getEntity(entityId)
    }

    /**
     * 删除实体（软删除，保留历史）
     */
    deleteEntity(entityId, reason = '手动删除') {
        const db = this._getDb()
        const existing = this.getEntity(entityId)

        if (!existing) return false

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

        // 删除关联的关系
        const relStmt = db.prepare(`
            DELETE FROM kg_relationships 
            WHERE from_entity_id = ? OR to_entity_id = ?
        `)
        relStmt.run(entityId, entityId)

        // 删除实体
        const stmt = db.prepare('DELETE FROM kg_entities WHERE entity_id = ?')
        stmt.run(entityId)

        logger.debug(`[KnowledgeGraph] 删除实体: ${entityId}`)
        return true
    }

    /**
     * 获取实体历史版本
     */
    getEntityHistory(entityId, limit = 10) {
        const db = this._getDb()
        const stmt = db.prepare(`
            SELECT * FROM kg_entity_history 
            WHERE entity_id = ? 
            ORDER BY version DESC 
            LIMIT ?
        `)

        return stmt.all(entityId, limit).map(row => ({
            id: row.id,
            entityId: row.entity_id,
            version: row.version,
            name: row.name,
            entityType: row.entity_type,
            properties: row.properties ? JSON.parse(row.properties) : null,
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
        const db = this._getDb()
        const historyStmt = db.prepare(`
            SELECT * FROM kg_entity_history 
            WHERE entity_id = ? AND version = ?
        `)
        const history = historyStmt.get(entityId, targetVersion)

        if (!history) {
            throw new Error(`未找到版本 ${targetVersion}`)
        }

        return this.updateEntity(entityId, {
            name: history.name,
            type: history.entity_type,
            properties: history.properties ? JSON.parse(history.properties) : null,
            changeReason: `回滚到版本 ${targetVersion}`
        })
    }

    /**
     * 列出作用域下的所有实体
     */
    listEntities(scopeId, options = {}) {
        const db = this._getDb()
        const { type, limit = 100, offset = 0 } = options

        let sql = 'SELECT * FROM kg_entities WHERE scope_id = ?'
        const params = [scopeId]

        if (type) {
            sql += ' AND entity_type = ?'
            params.push(type)
        }

        sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?'
        params.push(limit, offset)

        const stmt = db.prepare(sql)
        return stmt.all(...params).map(row => this._parseEntityRow(row))
    }

    /**
     * 搜索实体（简单文本匹配）
     */
    searchEntities(query, scopeIds = [], options = {}) {
        const db = this._getDb()
        const { type, limit = 20 } = options

        let sql = 'SELECT * FROM kg_entities WHERE name LIKE ?'
        const params = [`%${query}%`]

        if (scopeIds.length > 0) {
            sql += ` AND scope_id IN (${scopeIds.map(() => '?').join(',')})`
            params.push(...scopeIds)
        }

        if (type) {
            sql += ' AND entity_type = ?'
            params.push(type)
        }

        sql += ' ORDER BY updated_at DESC LIMIT ?'
        params.push(limit)

        const stmt = db.prepare(sql)
        return stmt.all(...params).map(row => this._parseEntityRow(row))
    }

    // ========== 关系操作 ==========

    /**
     * 创建关系
     */
    createRelationship(relationship) {
        const db = this._getDb()
        const relationshipId = this._generateRelationshipId(
            relationship.fromEntityId,
            relationship.toEntityId,
            relationship.relationType
        )
        const now = Date.now()

        // 检查关系是否已存在
        const existing = this.getRelationship(relationshipId)
        if (existing) {
            return this.updateRelationship(relationshipId, relationship)
        }

        const stmt = db.prepare(`
            INSERT INTO kg_relationships 
            (relationship_id, from_entity_id, to_entity_id, relation_type, properties, scope_id, created_at, updated_at, version)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `)

        stmt.run(
            relationshipId,
            relationship.fromEntityId,
            relationship.toEntityId,
            relationship.relationType,
            relationship.properties ? JSON.stringify(relationship.properties) : null,
            relationship.scopeId,
            now,
            now
        )

        // 记录历史
        this._saveRelationshipHistory(relationshipId, {
            fromEntityId: relationship.fromEntityId,
            toEntityId: relationship.toEntityId,
            relationType: relationship.relationType,
            properties: relationship.properties,
            scopeId: relationship.scopeId,
            version: 1,
            changeType: 'created',
            changeReason: relationship.changeReason || '新建关系'
        })

        logger.debug(`[KnowledgeGraph] 创建关系: ${relationship.relationType}`)
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
        const db = this._getDb()
        const existing = this.getRelationship(relationshipId)

        if (!existing) {
            throw new Error(`关系不存在: ${relationshipId}`)
        }

        const newVersion = existing.version + 1
        const now = Date.now()

        // 保存历史
        this._saveRelationshipHistory(relationshipId, {
            fromEntityId: existing.fromEntityId,
            toEntityId: existing.toEntityId,
            relationType: existing.relationType,
            properties: existing.properties,
            scopeId: existing.scopeId,
            version: existing.version,
            changeType: 'updated',
            changeReason: updates.changeReason || '更新关系'
        })

        const stmt = db.prepare(`
            UPDATE kg_relationships SET
                properties = COALESCE(?, properties),
                updated_at = ?,
                version = ?
            WHERE relationship_id = ?
        `)

        stmt.run(updates.properties ? JSON.stringify(updates.properties) : null, now, newVersion, relationshipId)

        return this.getRelationship(relationshipId)
    }

    /**
     * 删除关系
     */
    deleteRelationship(relationshipId, reason = '手动删除') {
        const db = this._getDb()
        const existing = this.getRelationship(relationshipId)

        if (!existing) return false

        // 保存历史
        this._saveRelationshipHistory(relationshipId, {
            fromEntityId: existing.fromEntityId,
            toEntityId: existing.toEntityId,
            relationType: existing.relationType,
            properties: existing.properties,
            scopeId: existing.scopeId,
            version: existing.version,
            changeType: 'deleted',
            changeReason: reason
        })

        const stmt = db.prepare('DELETE FROM kg_relationships WHERE relationship_id = ?')
        stmt.run(relationshipId)

        return true
    }

    /**
     * 获取实体的所有关系
     */
    getEntityRelationships(entityId, direction = 'both') {
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
        const params = direction === 'both' ? [entityId, entityId] : [entityId]

        return stmt.all(...params).map(row => this._parseRelationshipRow(row))
    }

    // ========== 图查询 ==========

    /**
     * 查询子图（N 跳邻居）
     */
    querySubgraph(entityId, depth = 2, scopeIds = []) {
        const db = this._getDb()
        const entities = new Map()
        const relationships = []
        const visited = new Set()

        // BFS 遍历
        const queue = [{ id: entityId, currentDepth: 0 }]

        while (queue.length > 0) {
            const { id, currentDepth } = queue.shift()

            if (visited.has(id) || currentDepth > depth) continue
            visited.add(id)

            // 获取实体
            const entity = this.getEntity(id)
            if (entity) {
                entities.set(id, entity)
            }

            if (currentDepth < depth) {
                // 获取关系
                const rels = this.getEntityRelationships(id)
                for (const rel of rels) {
                    // 检查作用域过滤
                    if (scopeIds.length > 0 && !scopeIds.includes(rel.scopeId)) {
                        continue
                    }

                    relationships.push(rel)

                    // 添加邻居到队列
                    const neighborId = rel.fromEntityId === id ? rel.toEntityId : rel.fromEntityId
                    if (!visited.has(neighborId)) {
                        queue.push({ id: neighborId, currentDepth: currentDepth + 1 })
                    }
                }
            }
        }

        return {
            entities: Array.from(entities.values()),
            relationships: this._deduplicateRelationships(relationships)
        }
    }

    /**
     * 路径查询（最短路径）
     */
    pathQuery(fromEntityId, toEntityId, maxDepth = 5, relationTypes = []) {
        const visited = new Set()
        const queue = [[fromEntityId]]

        while (queue.length > 0) {
            const path = queue.shift()
            const currentId = path[path.length - 1]

            if (currentId === toEntityId) {
                // 找到路径，构建结果
                return this._buildPathResult(path)
            }

            if (path.length > maxDepth || visited.has(currentId)) continue
            visited.add(currentId)

            // 获取邻居
            const rels = this.getEntityRelationships(currentId, 'outgoing')
            for (const rel of rels) {
                if (relationTypes.length > 0 && !relationTypes.includes(rel.relationType)) {
                    continue
                }

                if (!visited.has(rel.toEntityId)) {
                    queue.push([...path, rel.toEntityId])
                }
            }
        }

        return null // 未找到路径
    }

    /**
     * 构建路径结果
     */
    _buildPathResult(entityIds) {
        const entities = []
        const relationships = []

        for (let i = 0; i < entityIds.length; i++) {
            const entity = this.getEntity(entityIds[i])
            if (entity) entities.push(entity)

            if (i < entityIds.length - 1) {
                const rels = this.getEntityRelationships(entityIds[i], 'outgoing')
                const rel = rels.find(r => r.toEntityId === entityIds[i + 1])
                if (rel) relationships.push(rel)
            }
        }

        return { entities, relationships, path: entityIds }
    }

    // ========== 作用域共享 ==========

    /**
     * 创建共享配置
     */
    createScopeSharing(config) {
        const db = this._getDb()
        const stmt = db.prepare(`
            INSERT INTO kg_scope_sharing (source_scope_id, target_scope_id, share_type, entity_types, created_at)
            VALUES (?, ?, ?, ?, ?)
        `)

        stmt.run(
            config.sourceScopeId,
            config.targetScopeId,
            config.shareType,
            config.entityTypes ? JSON.stringify(config.entityTypes) : null,
            Date.now()
        )

        return this.getScopeSharing(config.sourceScopeId, config.targetScopeId)
    }

    /**
     * 获取共享配置
     */
    getScopeSharing(sourceScopeId, targetScopeId) {
        const db = this._getDb()
        const stmt = db.prepare(`
            SELECT * FROM kg_scope_sharing 
            WHERE source_scope_id = ? AND target_scope_id = ?
        `)
        const row = stmt.get(sourceScopeId, targetScopeId)

        if (!row) return null

        return {
            id: row.id,
            sourceScopeId: row.source_scope_id,
            targetScopeId: row.target_scope_id,
            shareType: row.share_type,
            entityTypes: row.entity_types ? JSON.parse(row.entity_types) : null,
            createdAt: row.created_at
        }
    }

    /**
     * 获取作用域可访问的所有共享源
     */
    getAccessibleScopes(scopeId) {
        const db = this._getDb()
        const stmt = db.prepare(`
            SELECT * FROM kg_scope_sharing WHERE target_scope_id = ?
        `)

        return stmt.all(scopeId).map(row => ({
            sourceScopeId: row.source_scope_id,
            shareType: row.share_type,
            entityTypes: row.entity_types ? JSON.parse(row.entity_types) : null
        }))
    }

    /**
     * 删除共享配置
     */
    deleteScopeSharing(sourceScopeId, targetScopeId) {
        const db = this._getDb()
        const stmt = db.prepare(`
            DELETE FROM kg_scope_sharing 
            WHERE source_scope_id = ? AND target_scope_id = ?
        `)
        return stmt.run(sourceScopeId, targetScopeId).changes > 0
    }

    // ========== 知识上下文获取 ==========

    /**
     * 获取用户的知识上下文（用于对话）
     */
    getKnowledgeContext(userId, groupId = null, options = {}) {
        const { maxEntities = 15, includeRelations = true } = options

        // 构建作用域优先级列表
        const scopeIds = []
        if (groupId && userId) {
            scopeIds.push(`group:${groupId}:user:${userId}`)
        }
        if (userId) {
            scopeIds.push(`user:${userId}`)
        }
        if (groupId) {
            scopeIds.push(`group:${groupId}`)
        }
        scopeIds.push('global')

        // 添加共享作用域
        for (const scopeId of [...scopeIds]) {
            const shared = this.getAccessibleScopes(scopeId)
            for (const share of shared) {
                if (!scopeIds.includes(share.sourceScopeId)) {
                    scopeIds.push(share.sourceScopeId)
                }
            }
        }

        // 收集实体
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

        // 收集关系
        let relationships = []
        if (includeRelations && entities.length > 0) {
            const entityIds = new Set(entities.map(e => e.entityId))
            for (const entity of entities) {
                const rels = this.getEntityRelationships(entity.entityId)
                for (const rel of rels) {
                    // 只保留两端都在实体集合中的关系
                    if (entityIds.has(rel.fromEntityId) && entityIds.has(rel.toEntityId)) {
                        relationships.push(rel)
                    }
                }
            }
            relationships = this._deduplicateRelationships(relationships)
        }

        // 格式化为文本
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
        const byType = {}
        for (const entity of entities) {
            if (!byType[entity.entityType]) {
                byType[entity.entityType] = []
            }
            byType[entity.entityType].push(entity)
        }

        const typeNames = {
            person: '人物',
            thing: '物品',
            place: '地点',
            concept: '概念',
            event: '事件'
        }

        for (const [type, typeEntities] of Object.entries(byType)) {
            lines.push(`\n[${typeNames[type] || type}]`)
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
     * 导出图谱
     */
    exportGraph(scopeId) {
        const entities = this.listEntities(scopeId, { limit: 10000 })
        const relationships = []

        for (const entity of entities) {
            const rels = this.getEntityRelationships(entity.entityId, 'outgoing')
            relationships.push(...rels)
        }

        return {
            scopeId,
            exportedAt: Date.now(),
            entities,
            relationships: this._deduplicateRelationships(relationships)
        }
    }

    /**
     * 导入图谱
     */
    importGraph(graphData, targetScopeId = null) {
        const scopeId = targetScopeId || graphData.scopeId

        // 导入实体
        const entityIdMap = new Map() // 旧ID -> 新ID

        for (const entity of graphData.entities) {
            const newEntity = this.createEntity({
                name: entity.name,
                type: entity.entityType,
                scopeId,
                properties: entity.properties,
                changeReason: '从导出数据导入'
            })
            entityIdMap.set(entity.entityId, newEntity.entityId)
        }

        // 导入关系
        for (const rel of graphData.relationships) {
            const fromId = entityIdMap.get(rel.fromEntityId) || rel.fromEntityId
            const toId = entityIdMap.get(rel.toEntityId) || rel.toEntityId

            this.createRelationship({
                fromEntityId: fromId,
                toEntityId: toId,
                relationType: rel.relationType,
                scopeId,
                properties: rel.properties,
                changeReason: '从导出数据导入'
            })
        }

        return {
            entitiesImported: entityIdMap.size,
            relationshipsImported: graphData.relationships.length
        }
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
            properties: row.properties ? JSON.parse(row.properties) : null,
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
            properties: row.properties ? JSON.parse(row.properties) : null,
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
