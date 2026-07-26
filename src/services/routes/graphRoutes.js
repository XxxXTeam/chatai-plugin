/**
 * 知识图谱路由模块
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'

/**
 * 把查询参数安全地转换为区间内的整数
 *
 * 解构默认值只在参数缺失时生效，`?limit=abc` 仍会让 parseInt 返回 NaN；
 * NaN 一路传到 better-sqlite3 的参数绑定会抛 "datatype mismatch"，
 * 表现为接口 500 而非参数校验失败。
 *
 * @param {*} value - 原始查询参数
 * @param {number} fallback - 无法解析为有限数时使用的默认值
 * @param {number} max - 允许的最大值
 * @param {number} [min=1] - 允许的最小值
 * @returns {number} 落在 [min, max] 内的整数
 */
function toBoundedInt(value, fallback, max, min = 1) {
    // 空串要走默认值：Number('') 为 0，否则 ?limit= 会被钳成 min 而非 fallback
    if (value === undefined || value === null || value === '') return fallback
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

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
            limit: toBoundedInt(limit, 100, 1000),
            offset: toBoundedInt(offset, 0, 1000000, 0)
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
            limit: toBoundedInt(limit, 20, 1000)
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
        const history = knowledgeGraphService.getEntityHistory(req.params.entityId, toBoundedInt(limit, 10, 500))
        res.json(ChaiteResponse.ok(history))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/*
 * POST /entities/:entityId/rollback - 回滚实体到指定历史版本
 *
 * KnowledgeGraphService.rollbackEntity 早就实现了，但一直没有路由暴露它，
 * 面板侧只能看历史不能回滚。这里补上。
 *
 * 状态码语义：实体不存在、版本不存在都是 404，其余失败是 500。rollbackEntity 内部
 * 还会调 updateEntity，数据库故障同样以 Error 抛出，若把 catch 一律当 404 会把故障
 * 误报成「版本不存在」。因此两项 404 条件都在路由层显式查过再执行回滚，
 * catch 只留给真正的意外。
 */
router.post('/entities/:entityId/rollback', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()

        const { entityId } = req.params
        const { targetVersion } = req.body || {}
        const version = Number(targetVersion)
        if (!Number.isInteger(version) || version < 1) {
            return res.status(400).json(ChaiteResponse.fail(null, 'targetVersion 必须为不小于 1 的整数'))
        }

        if (!knowledgeGraphService.getEntity(entityId)) {
            return res.status(404).json(ChaiteResponse.fail(null, `实体不存在: ${entityId}`))
        }
        if (!knowledgeGraphService.hasEntityVersion(entityId, version)) {
            return res.status(404).json(ChaiteResponse.fail(null, `未找到版本 ${version}`))
        }

        const entity = knowledgeGraphService.rollbackEntity(entityId, version)
        res.json(ChaiteResponse.ok(entity))
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
        const subgraph = knowledgeGraphService.querySubgraph(entityId, toBoundedInt(depth, 2, 10), scopes)
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
        const path = knowledgeGraphService.pathQuery(fromEntityId, toEntityId, toBoundedInt(maxDepth, 5, 10), relTypes)
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
            maxEntities: toBoundedInt(maxEntities, 15, 200)
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
