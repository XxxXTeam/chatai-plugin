/**
 * 知识图谱路由模块
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'
import { chatLogger } from '../../core/utils/logger.js'

/**
 * 统一映射知识图谱领域错误，避免把可预期的校验/不存在错误误报为 500。
 * 未知异常不把数据库或绝对路径细节回传给前端。
 * @param {import('express').Response} res - Express 响应对象
 * @param {*} error - 捕获到的异常
 * @returns {import('express').Response} 已发送的响应
 */
function sendGraphError(res, error) {
    const statusCode =
        Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600
            ? error.statusCode
            : 500
    if (statusCode === 500) {
        chatLogger.error('[KnowledgeGraph API] 请求处理失败', error)
    }
    const message = statusCode === 500 ? '知识图谱操作失败' : error.message
    return res.status(statusCode).json(ChaiteResponse.fail(null, message))
}

/**
 * 创建可由 sendGraphError 映射为 400 的路由参数错误。
 * @param {string} message - 错误信息
 * @returns {Error & {statusCode: number}} 参数错误
 */
function badRequest(message) {
    const error = new Error(message)
    error.statusCode = 400
    return error
}

/**
 * 读取可选的单值查询参数；拒绝 Express 的数组/对象形态。
 * @param {*} value - req.query 中的原始值
 * @param {string} fieldName - 查询参数名
 * @returns {string|undefined} 清理后的值
 */
function optionalQueryString(value, fieldName) {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') {
        throw badRequest(`${fieldName} 必须为单个字符串`)
    }
    const normalized = value.trim()
    return normalized || undefined
}

/**
 * 解析逗号分隔的查询参数。
 * @param {*} value - req.query 中的原始值
 * @param {string} fieldName - 查询参数名
 * @returns {string[]} 去空并清理后的列表
 */
function commaSeparatedQuery(value, fieldName) {
    // 新客户端使用重复查询键传递列表，避免合法的作用域/关系类型中包含逗号时被拆坏；
    // 单字符串仍保留旧版逗号分隔兼容行为。
    if (Array.isArray(value)) {
        return value
            .map((item, index) => {
                if (typeof item !== 'string') throw badRequest(`${fieldName}[${index}] 必须为字符串`)
                return item.trim()
            })
            .filter(Boolean)
    }
    const normalized = optionalQueryString(value, fieldName)
    return normalized
        ? normalized
              .split(',')
              .map(item => item.trim())
              .filter(Boolean)
        : []
}

/**
 * 把查询参数安全地转换为区间内的整数。
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

/**
 * 解析 JSON 请求体中的正整数；兼容十进制字符串，但拒绝布尔值、数组和隐式对象转换。
 * @param {*} value - 请求体字段原值
 * @returns {number|null} 合法正整数，非法时返回 null
 */
function positiveIntegerBody(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value) && value >= 1 ? value : null
    }
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value.trim())) {
        const parsed = Number(value.trim())
        return Number.isSafeInteger(parsed) ? parsed : null
    }
    return null
}

const router = express.Router()

// GET /entities - 获取实体列表
router.get('/entities', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { limit = 100, offset = 0 } = req.query
        const scopeId = optionalQueryString(req.query.scopeId, 'scopeId')
        const type = optionalQueryString(req.query.type, 'type')
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
        sendGraphError(res, error)
    }
})

// GET /entities/count - 获取与实体列表筛选完全一致的总数
router.get('/entities/count', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const scopeId = optionalQueryString(req.query.scopeId, 'scopeId')
        const query = optionalQueryString(req.query.query, 'query') || ''
        const type = optionalQueryString(req.query.type, 'type')
        if (!scopeId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'scopeId is required'))
        }
        const count = knowledgeGraphService.countEntities(scopeId, { query, type })
        res.json(ChaiteResponse.ok({ count }))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// GET /entities/search - 搜索实体
router.get('/entities/search', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { limit = 20, offset = 0 } = req.query
        const query = optionalQueryString(req.query.query, 'query') || ''
        const scopes = commaSeparatedQuery(req.query.scopeIds ?? req.query['scopeIds[]'], 'scopeIds')
        const type = optionalQueryString(req.query.type, 'type')
        const entities = knowledgeGraphService.searchEntities(query, scopes, {
            type,
            limit: toBoundedInt(limit, 20, 1000),
            offset: toBoundedInt(offset, 0, 1000000, 0)
        })
        res.json(ChaiteResponse.ok(entities))
    } catch (error) {
        sendGraphError(res, error)
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
        sendGraphError(res, error)
    }
})

// POST /entities - 创建实体
router.post('/entities', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { name, type, scopeId, properties } = req.body || {}
        if (!name || !type || !scopeId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'name, type and scopeId are required'))
        }
        const entity = knowledgeGraphService.createEntity({ name, type, scopeId, properties })
        res.status(201).json(ChaiteResponse.ok(entity))
    } catch (error) {
        sendGraphError(res, error)
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
        sendGraphError(res, error)
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
        sendGraphError(res, error)
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
        sendGraphError(res, error)
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
        const version = positiveIntegerBody(req.body?.targetVersion)
        if (version === null) {
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
        sendGraphError(res, error)
    }
})

// GET /entities/:entityId/relationships - 获取实体关系
router.get('/entities/:entityId/relationships', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const direction = optionalQueryString(req.query.direction, 'direction') || 'both'
        const relationships = knowledgeGraphService.getEntityRelationships(req.params.entityId, direction)
        res.json(ChaiteResponse.ok(relationships))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// POST /relationships - 创建关系
router.post('/relationships', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { fromEntityId, toEntityId, relationType, scopeId, properties } = req.body || {}
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
        sendGraphError(res, error)
    }
})

// PUT /relationships/:relationshipId - 更新关系
router.put('/relationships/:relationshipId', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const relationship = knowledgeGraphService.updateRelationship(req.params.relationshipId, req.body)
        if (!relationship) {
            return res.status(404).json(ChaiteResponse.fail(null, '关系不存在'))
        }
        res.json(ChaiteResponse.ok(relationship))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// GET /relationships/:relationshipId/history - 获取关系历史版本
router.get('/relationships/:relationshipId/history', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { relationshipId } = req.params
        const history = knowledgeGraphService.getRelationshipHistory(
            relationshipId,
            toBoundedInt(req.query.limit, 10, 500)
        )
        res.json(ChaiteResponse.ok(history))
    } catch (error) {
        sendGraphError(res, error)
    }
})

/**
 * POST /relationships/:relationshipId/rollback - 回滚关系到指定历史版本。
 *
 * 与实体回滚一致：目标快照作为一次新变更写回，版本号继续递增。
 */
router.post('/relationships/:relationshipId/rollback', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { relationshipId } = req.params
        const version = positiveIntegerBody(req.body?.targetVersion)
        if (version === null) {
            return res.status(400).json(ChaiteResponse.fail(null, 'targetVersion 必须为不小于 1 的整数'))
        }
        if (!knowledgeGraphService.getRelationship(relationshipId)) {
            return res.status(404).json(ChaiteResponse.fail(null, `关系不存在: ${relationshipId}`))
        }
        if (!knowledgeGraphService.hasRelationshipVersion(relationshipId, version)) {
            return res.status(404).json(ChaiteResponse.fail(null, `未找到版本 ${version}`))
        }
        const relationship = knowledgeGraphService.rollbackRelationship(relationshipId, version)
        res.json(ChaiteResponse.ok(relationship))
    } catch (error) {
        sendGraphError(res, error)
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
        sendGraphError(res, error)
    }
})

// GET /subgraph - 查询子图
router.get('/subgraph', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { depth = 2 } = req.query
        const entityId = optionalQueryString(req.query.entityId, 'entityId')
        if (!entityId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'entityId is required'))
        }
        const scopes = commaSeparatedQuery(req.query.scopeIds ?? req.query['scopeIds[]'], 'scopeIds')
        const subgraph = knowledgeGraphService.querySubgraph(entityId, toBoundedInt(depth, 2, 10), scopes, {
            maxNodes: toBoundedInt(req.query.maxNodes, 200, 1000),
            maxEdges: toBoundedInt(req.query.maxEdges, 400, 5000, 0)
        })
        res.json(ChaiteResponse.ok(subgraph))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// GET /path - 路径查询
router.get('/path', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { maxDepth = 5 } = req.query
        const fromEntityId = optionalQueryString(req.query.fromEntityId, 'fromEntityId')
        const toEntityId = optionalQueryString(req.query.toEntityId, 'toEntityId')
        if (!fromEntityId || !toEntityId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'fromEntityId and toEntityId are required'))
        }
        const relTypes = commaSeparatedQuery(req.query.relationTypes ?? req.query['relationTypes[]'], 'relationTypes')
        const path = knowledgeGraphService.pathQuery(fromEntityId, toEntityId, toBoundedInt(maxDepth, 5, 10), relTypes)
        res.json(ChaiteResponse.ok(path))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// GET /context - 获取用户知识上下文
router.get('/context', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { maxEntities = 15 } = req.query
        const userId = optionalQueryString(req.query.userId, 'userId')
        const groupId = optionalQueryString(req.query.groupId, 'groupId')
        if (!userId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'userId is required'))
        }
        const context = knowledgeGraphService.getKnowledgeContext(userId, groupId, {
            maxEntities: toBoundedInt(maxEntities, 15, 200)
        })
        res.json(ChaiteResponse.ok({ context }))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// POST /export - 导出图谱
router.post('/export', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { scopeId } = req.body || {}
        if (!scopeId) {
            return res.status(400).json(ChaiteResponse.fail(null, 'scopeId is required'))
        }
        const graphData = knowledgeGraphService.exportGraph(scopeId)
        res.json(ChaiteResponse.ok(graphData))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// GET /export - 以流式 JSON 下载完整图谱，避免服务端构造巨型响应字符串
router.get('/export', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const scopeId = optionalQueryString(req.query.scopeId, 'scopeId')
        if (!scopeId) return res.status(400).json(ChaiteResponse.fail(null, 'scopeId is required'))

        const stats = knowledgeGraphService.getScopeStats(scopeId)
        const exportedAt = Date.now()
        const safeScope = scopeId.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'graph'
        res.status(200)
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="graph-${safeScope}-${exportedAt}.json"`)
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.flushHeaders()

        const write = async chunk => {
            if (res.destroyed) return false
            if (!res.write(chunk)) {
                await new Promise(resolve => {
                    const finishWait = () => {
                        res.off('drain', finishWait)
                        res.off('close', finishWait)
                        resolve()
                    }
                    res.once('drain', finishWait)
                    res.once('close', finishWait)
                })
            }
            return !res.destroyed
        }
        await write(
            `{"schemaVersion":1,"scopeId":${JSON.stringify(scopeId)},"exportedAt":${exportedAt},"counts":${JSON.stringify({ entities: stats.entityCount, relationships: stats.relationshipCount })},"truncated":false,"entities":[`
        )
        let first = true
        for (const entity of knowledgeGraphService.iterateScopeEntities(scopeId)) {
            if (!(await write(`${first ? '' : ','}${JSON.stringify(entity)}`))) return
            first = false
        }
        await write('],"relationships":[')
        first = true
        for (const relationship of knowledgeGraphService.iterateScopeRelationships(scopeId)) {
            if (!(await write(`${first ? '' : ','}${JSON.stringify(relationship)}`))) return
            first = false
        }
        if (!res.destroyed) res.end(']}')
    } catch (error) {
        if (res.headersSent) {
            res.destroy(error)
            return
        }
        sendGraphError(res, error)
    }
})

// GET /visualization - 有界图谱摘要，避免可视化页面下载完整备份
router.get('/visualization', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const scopeId = optionalQueryString(req.query.scopeId, 'scopeId')
        if (!scopeId) return res.status(400).json(ChaiteResponse.fail(null, 'scopeId is required'))
        const visualization = knowledgeGraphService.getVisualization(scopeId, {
            limit: toBoundedInt(req.query.limit, 80, 500),
            focusEntityId: optionalQueryString(req.query.focusEntityId, 'focusEntityId')
        })
        res.json(ChaiteResponse.ok(visualization))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// POST /import - 导入图谱
router.post('/import', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const { graphData, targetScopeId } = req.body || {}
        if (!graphData) {
            return res.status(400).json(ChaiteResponse.fail(null, 'graphData is required'))
        }
        const result = knowledgeGraphService.importGraph(graphData, targetScopeId)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// GET /scopes - 获取所有有数据的作用域
router.get('/scopes', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        res.json(ChaiteResponse.ok(knowledgeGraphService.listScopes()))
    } catch (error) {
        sendGraphError(res, error)
    }
})

// GET /stats - 获取图谱统计
router.get('/stats', async (req, res) => {
    try {
        const { knowledgeGraphService } = await import('../storage/KnowledgeGraphService.js')
        await knowledgeGraphService.init()
        const scopeId = optionalQueryString(req.query.scopeId, 'scopeId')
        res.json(ChaiteResponse.ok(knowledgeGraphService.getScopeStats(scopeId)))
    } catch (error) {
        sendGraphError(res, error)
    }
})

export default router
