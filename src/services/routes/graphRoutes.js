/**
 * 知识图谱路由模块
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'

const router = express.Router()

// GET /entities - 获取实体列表
router.get('/entities', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { scopeId, type, limit = 100, offset = 0 } = req.query
        if (!scopeId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'scopeId is required'))
        }
        const entities = knowledgeGraphService.listEntities(scopeId, {
            type,
            limit: parseInt(limit),
            offset: parseInt(offset)
        })
        res.json(ChaiteResponse.ok(entities))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /entities/search - 搜索实体
router.get('/entities/search', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { query, scopeIds, type, limit = 20 } = req.query
        const scopes = scopeIds ? scopeIds.split(',') : []
        const entities = knowledgeGraphService.searchEntities(query || '', scopes, {
            type,
            limit: parseInt(limit)
        })
        res.json(ChaiteResponse.ok(entities))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /entities/:entityId - 获取单个实体
router.get('/entities/:entityId', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const entity = knowledgeGraphService.getEntity(req.params.entityId)
        if (!entity) {
            return res.status(404).json(ChaiteResponse.fail(null, '实体不存在'))
        }
        res.json(ChaiteResponse.ok(entity))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /entities - 创建实体
router.post('/entities', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { name, type, scopeId, properties } = req.body
        if (!name || !type || !scopeId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'name, type and scopeId are required'))
        }
        const entity = knowledgeGraphService.createEntity({ name, type, scopeId, properties })
        res.status(201).json(ChaiteResponse.ok(entity))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /entities/:entityId - 更新实体
router.put('/entities/:entityId', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const entity = knowledgeGraphService.updateEntity(req.params.entityId, req.body)
        res.json(ChaiteResponse.ok(entity))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /entities/:entityId - 删除实体
router.delete('/entities/:entityId', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const success = knowledgeGraphService.deleteEntity(req.params.entityId)
        if (!success) {
            return res.status(404).json(ChaiteResponse.fail(null, '实体不存在'))
        }
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /entities/:entityId/history - 获取实体历史
router.get('/entities/:entityId/history', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { limit = 10 } = req.query
        const history = knowledgeGraphService.getEntityHistory(req.params.entityId, parseInt(limit))
        res.json(ChaiteResponse.ok(history))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /entities/:entityId/relationships - 获取实体关系
router.get('/entities/:entityId/relationships', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { direction = 'both' } = req.query
        const relationships = knowledgeGraphService.getEntityRelationships(req.params.entityId, direction)
        res.json(ChaiteResponse.ok(relationships))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /relationships - 创建关系
router.post('/relationships', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { fromEntityId, toEntityId, relationType, scopeId, properties } = req.body
        if (!fromEntityId || !toEntityId || !relationType || !scopeId) {
            return res
                .status(400)
                .json(ChaiteResponse.fail(null, 'fromEntityId, toEntityId, relationType and scopeId are required'))
        }
        const relationship = knowledgeGraphService.createRelationship({
            fromEntityId,
            toEntityId,
            relationType,
            scopeId,
            properties
        })
        res.status(201).json(ChaiteResponse.ok(relationship))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /relationships/:relationshipId - 删除关系
router.delete('/relationships/:relationshipId', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const success = knowledgeGraphService.deleteRelationship(req.params.relationshipId)
        if (!success) {
            return res.status(404).json(ChaiteResponse.fail(null, '关系不存在'))
        }
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /subgraph - 查询子图
router.get('/subgraph', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { entityId, depth = 2, scopeIds } = req.query
        if (!entityId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'entityId is required'))
        }
        const scopes = scopeIds ? scopeIds.split(',') : []
        const subgraph = knowledgeGraphService.querySubgraph(entityId, parseInt(depth), scopes)
        res.json(ChaiteResponse.ok(subgraph))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /path - 路径查询
router.get('/path', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { fromEntityId, toEntityId, maxDepth = 5, relationTypes } = req.query
        if (!fromEntityId || !toEntityId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'fromEntityId and toEntityId are required'))
        }
        const relTypes = relationTypes ? relationTypes.split(',') : []
        const path = knowledgeGraphService.pathQuery(fromEntityId, toEntityId, parseInt(maxDepth), relTypes)
        res.json(ChaiteResponse.ok(path))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /context - 获取用户知识上下文
router.get('/context', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { userId, groupId, maxEntities = 15 } = req.query
        if (!userId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'userId is required'))
        }
        const context = knowledgeGraphService.getKnowledgeContext(userId, groupId, {
            maxEntities: parseInt(maxEntities)
        })
        res.json(ChaiteResponse.ok({ context }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /export - 导出图谱
router.post('/export', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { scopeId } = req.body
        if (!scopeId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'scopeId is required'))
        }
        const graphData = knowledgeGraphService.exportGraph(scopeId)
        res.json(ChaiteResponse.ok(graphData))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /import - 导入图谱
router.post('/import', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { graphData, targetScopeId } = req.body
        if (!graphData) {
            return res.status(400).json(ChaiteResponse.fail(null, 'graphData is required'))
        }
        const result = knowledgeGraphService.importGraph(graphData, targetScopeId)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /scopes - 获取所有有数据的作用域
router.get('/scopes', async (req, res) => {
    try {
        const { databaseService } = await import('../storage/DatabaseService.js')
        databaseService.init()
        const stmt = databaseService.db.prepare('SELECT DISTINCT scope_id FROM kg_entities ORDER BY scope_id')
        const scopes = stmt.all().map(row => row.scope_id)
        res.json(ChaiteResponse.ok(scopes))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats - 获取图谱统计
router.get('/stats', async (req, res) => {
    try {
        const { databaseService } = await import('../storage/DatabaseService.js')
        databaseService.init()
        const db = databaseService.db
        const { scopeId } = req.query

        let entityCount, relationshipCount, typeStats

        if (scopeId) {
            entityCount = db.prepare('SELECT COUNT(*) as count FROM kg_entities WHERE scope_id = ?').get(scopeId).count
            relationshipCount = db
                .prepare('SELECT COUNT(*) as count FROM kg_relationships WHERE scope_id = ?')
                .get(scopeId).count
            typeStats = db
                .prepare(
                    'SELECT entity_type, COUNT(*) as count FROM kg_entities WHERE scope_id = ? GROUP BY entity_type'
                )
                .all(scopeId)
        } else {
            entityCount = db.prepare('SELECT COUNT(*) as count FROM kg_entities').get().count
            relationshipCount = db.prepare('SELECT COUNT(*) as count FROM kg_relationships').get().count
            typeStats = db.prepare('SELECT entity_type, COUNT(*) as count FROM kg_entities GROUP BY entity_type').all()
        }

        res.json(
            ChaiteResponse.ok({
                entityCount,
                relationshipCount,
                typeStats: typeStats.reduce((acc, row) => {
                    acc[row.entity_type] = row.count
                    return acc
                }, {})
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
