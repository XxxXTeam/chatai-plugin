import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import graphRoutes from '../src/services/routes/graphRoutes.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { knowledgeGraphService } from '../src/services/storage/KnowledgeGraphService.js'

let server
let baseUrl
let testDataDir
let originalDataDir

/**
 * 向隔离启动的图谱路由发请求，并解析统一响应体。
 * @param {string} pathname - 相对图谱根路由的路径
 * @param {RequestInit} [init] - fetch 请求配置
 * @returns {Promise<{status: number, body: {code: number, data: any, message: string}}>} 状态码与响应体
 */
async function request(pathname, init = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers
        }
    })
    return { status: response.status, body: await response.json() }
}

before(async () => {
    originalDataDir = databaseService.dataDir
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-plugin-graph-'))
    databaseService.close()
    databaseService.dataDir = testDataDir
    knowledgeGraphService.initialized = false

    const app = express()
    app.use(express.json({ limit: '2mb' }))
    app.use('/api/graph', graphRoutes)

    await new Promise((resolve, reject) => {
        server = app.listen(0, '127.0.0.1', resolve)
        server.once('error', reject)
    })
    const address = server.address()
    assert.equal(typeof address, 'object')
    baseUrl = `http://127.0.0.1:${address.port}/api/graph`
})

after(async () => {
    if (server) {
        await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    }
    databaseService.close()
    databaseService.dataDir = originalDataDir
    knowledgeGraphService.initialized = false
    fs.rmSync(testDataDir, { recursive: true, force: true })
})

test('知识图谱 API 支持从空库完成 CRUD、回滚与原子导入', async () => {
    const emptyScopes = await request('/scopes')
    assert.equal(emptyScopes.status, 200)
    assert.deepEqual(emptyScopes.body.data, ['global'])
    if (process.platform !== 'win32') {
        assert.equal(fs.statSync(path.join(testDataDir, 'chaite.db')).mode & 0o777, 0o600)
    }

    const invalidEntity = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '   ', type: 'person', scopeId: 'global' })
    })
    assert.equal(invalidEntity.status, 400)

    const first = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '张三', type: 'person', scopeId: 'global', properties: { age: 20 } })
    })
    assert.equal(first.status, 201)
    assert.equal(first.body.code, 0)
    assert.equal(first.body.data.entityType, 'person')

    const repeatedFirst = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '张三', type: 'person', scopeId: 'global' })
    })
    assert.equal(repeatedFirst.status, 201)
    assert.equal(repeatedFirst.body.data.version, 1)

    const repeatedWithSameProperties = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '张三', type: 'person', scopeId: 'global', properties: { age: 20 } })
    })
    assert.equal(repeatedWithSameProperties.status, 201)
    assert.equal(repeatedWithSameProperties.body.data.version, 1)

    const second = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '公司', type: 'thing', scopeId: 'global' })
    })
    assert.equal(second.status, 201)

    const literalWildcardSearch = await request('/entities/search?query=%25&scopeIds=global')
    assert.equal(literalWildcardSearch.status, 200)
    assert.deepEqual(literalWildcardSearch.body.data, [])

    const danglingRelationship = await request('/relationships', {
        method: 'POST',
        body: JSON.stringify({
            fromEntityId: first.body.data.entityId,
            toEntityId: 'global:entity:not-found',
            relationType: 'works_at',
            scopeId: 'global'
        })
    })
    assert.equal(danglingRelationship.status, 404)

    const relationship = await request('/relationships', {
        method: 'POST',
        body: JSON.stringify({
            fromEntityId: first.body.data.entityId,
            toEntityId: second.body.data.entityId,
            relationType: 'works_at',
            scopeId: 'global',
            properties: {
                since: 2020,
                active: true,
                note: null,
                tags: ['employee', 2],
                metadata: { remote: false }
            }
        })
    })
    assert.equal(relationship.status, 201)

    const repeatedRelationship = await request('/relationships', {
        method: 'POST',
        body: JSON.stringify({
            fromEntityId: first.body.data.entityId,
            toEntityId: second.body.data.entityId,
            relationType: 'works_at',
            scopeId: 'global',
            properties: {
                metadata: { remote: false },
                tags: ['employee', 2],
                note: null,
                active: true,
                since: 2020
            }
        })
    })
    assert.equal(repeatedRelationship.status, 201)
    assert.equal(repeatedRelationship.body.data.version, 1)

    const updatedRelationship = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}`,
        {
            method: 'PUT',
            body: JSON.stringify({
                properties: {
                    since: 2021,
                    active: false,
                    note: '调岗',
                    tags: ['manager', 3],
                    metadata: { remote: true }
                },
                changeReason: '更新入职年份'
            })
        }
    )
    assert.equal(updatedRelationship.status, 200)
    assert.equal(updatedRelationship.body.data.version, 2)

    const relationshipHistory = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/history`
    )
    assert.equal(relationshipHistory.status, 200)
    assert.deepEqual(
        relationshipHistory.body.data.map(item => item.version),
        [1]
    )

    const missingRelationshipVersion = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/rollback`,
        { method: 'POST', body: JSON.stringify({ targetVersion: 99 }) }
    )
    assert.equal(missingRelationshipVersion.status, 404)

    for (const targetVersion of [true, [1], { value: 1 }]) {
        const invalidRelationshipVersion = await request(
            `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/rollback`,
            { method: 'POST', body: JSON.stringify({ targetVersion }) }
        )
        assert.equal(invalidRelationshipVersion.status, 400)
    }

    const rolledBackRelationship = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/rollback`,
        { method: 'POST', body: JSON.stringify({ targetVersion: 1 }) }
    )
    assert.equal(rolledBackRelationship.status, 200)
    assert.equal(rolledBackRelationship.body.data.version, 3)
    assert.deepEqual(rolledBackRelationship.body.data.properties, {
        since: 2020,
        active: true,
        note: null,
        tags: ['employee', 2],
        metadata: { remote: false }
    })

    const invalidRelationshipVersion = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/rollback`,
        { method: 'POST', body: JSON.stringify({ targetVersion: 0 }) }
    )
    assert.equal(invalidRelationshipVersion.status, 400)

    const relationshipHistoryAfterRollback = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/history`
    )
    assert.deepEqual(
        relationshipHistoryAfterRollback.body.data.map(item => item.version),
        [2, 1]
    )

    const pathResult = await request(
        `/path?fromEntityId=${encodeURIComponent(first.body.data.entityId)}&toEntityId=${encodeURIComponent(second.body.data.entityId)}`
    )
    assert.equal(pathResult.status, 200)
    assert.deepEqual(pathResult.body.data.path, [first.body.data.entityId, second.body.data.entityId])

    const subgraph = await request(`/subgraph?entityId=${encodeURIComponent(first.body.data.entityId)}&depth=1`)
    assert.equal(subgraph.status, 200)
    assert.equal(subgraph.body.data.entities.length, 2)
    assert.equal(subgraph.body.data.relationships.length, 1)

    const updated = await request(`/entities/${encodeURIComponent(first.body.data.entityId)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: '张三（更新）', properties: {} })
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.body.data.version, 2)
    assert.deepEqual(updated.body.data.properties, {})

    const history = await request(`/entities/${encodeURIComponent(first.body.data.entityId)}/history`)
    assert.equal(history.status, 200)
    assert.deepEqual(
        history.body.data.map(item => item.version),
        [1]
    )

    const rolledBack = await request(`/entities/${encodeURIComponent(first.body.data.entityId)}/rollback`, {
        method: 'POST',
        body: JSON.stringify({ targetVersion: 1 })
    })
    assert.equal(rolledBack.status, 200)
    assert.equal(rolledBack.body.data.name, '张三')
    assert.equal(rolledBack.body.data.version, 3)

    const invalidDirection = await request(
        `/entities/${encodeURIComponent(first.body.data.entityId)}/relationships?direction=sideways`
    )
    assert.equal(invalidDirection.status, 400)

    const exported = await request('/export', {
        method: 'POST',
        body: JSON.stringify({ scopeId: 'global' })
    })
    assert.equal(exported.status, 200)
    assert.equal(exported.body.data.entities.length, 2)
    assert.equal(exported.body.data.relationships.length, 1)

    const imported = await request('/import', {
        method: 'POST',
        body: JSON.stringify({ graphData: exported.body.data, targetScopeId: 'group:1000' })
    })
    assert.equal(imported.status, 200)
    assert.deepEqual(imported.body.data, { entitiesImported: 2, relationshipsImported: 1 })

    const copiedEntities = await request('/entities?scopeId=group%3A1000')
    assert.equal(copiedEntities.status, 200)
    assert.equal(copiedEntities.body.data.length, 2)

    const crossScopeRelationship = await request('/relationships', {
        method: 'POST',
        body: JSON.stringify({
            fromEntityId: first.body.data.entityId,
            toEntityId: copiedEntities.body.data[0].entityId,
            relationType: 'knows',
            scopeId: 'global'
        })
    })
    assert.equal(crossScopeRelationship.status, 400)

    const beforeAtomicImport = await request('/entities?scopeId=group%3Aatomic')
    assert.equal(beforeAtomicImport.body.data.length, 0)

    const failedAtomicImport = await request('/import', {
        method: 'POST',
        body: JSON.stringify({
            targetScopeId: 'group:atomic',
            graphData: {
                scopeId: 'global',
                entities: [
                    {
                        entityId: 'global:entity:source',
                        entityType: 'thing',
                        name: '不应落库',
                        properties: {}
                    }
                ],
                relationships: [
                    {
                        relationshipId: 'rel:source',
                        fromEntityId: 'global:entity:source',
                        toEntityId: 'global:entity:missing',
                        relationType: 'knows',
                        properties: {}
                    }
                ]
            }
        })
    })
    assert.equal(failedAtomicImport.status, 400)

    const afterAtomicImport = await request('/entities?scopeId=group%3Aatomic')
    assert.equal(afterAtomicImport.body.data.length, 0)

    const missingUpdate = await request('/entities/not-found', {
        method: 'PUT',
        body: JSON.stringify({ name: '不存在' })
    })
    assert.equal(missingUpdate.status, 404)

    const repeatedScopeQuery = await request('/stats?scopeId=global&scopeId=group%3A1000')
    assert.equal(repeatedScopeQuery.status, 400)

    const stats = await request('/stats?scopeId=global')
    assert.equal(stats.status, 200)
    assert.deepEqual(stats.body.data, {
        entityCount: 2,
        relationshipCount: 1,
        typeStats: { person: 1, thing: 1 }
    })

    const deletedRelationship = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}`,
        { method: 'DELETE' }
    )
    assert.equal(deletedRelationship.status, 200)

    const deletedRelationshipHistory = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/history`
    )
    assert.equal(deletedRelationshipHistory.status, 200)
    assert.deepEqual(
        deletedRelationshipHistory.body.data.map(item => item.version),
        [3, 2, 1]
    )
    assert.equal(deletedRelationshipHistory.body.data[0].changeType, 'deleted')
    assert.deepEqual(deletedRelationshipHistory.body.data[0].properties, {
        since: 2020,
        active: true,
        note: null,
        tags: ['employee', 2],
        metadata: { remote: false }
    })

    const deletedRelationshipRollback = await request(
        `/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/rollback`,
        { method: 'POST', body: JSON.stringify({ targetVersion: 1 }) }
    )
    assert.equal(deletedRelationshipRollback.status, 404)

    const missingRelationshipHistory = await request('/relationships/not-found/history')
    assert.equal(missingRelationshipHistory.status, 200)
    assert.deepEqual(missingRelationshipHistory.body.data, [])
})

test('删除实体会为关联关系保留可读取的删除快照', async () => {
    const scopeId = 'group:cascade-history'
    const source = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '关系起点', type: 'person', scopeId })
    })
    const target = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '关系终点', type: 'thing', scopeId })
    })
    const relationship = await request('/relationships', {
        method: 'POST',
        body: JSON.stringify({
            fromEntityId: source.body.data.entityId,
            toEntityId: target.body.data.entityId,
            relationType: 'knows',
            scopeId,
            properties: { weight: 0.75, enabled: true, detail: { source: 'manual' } }
        })
    })
    assert.equal(relationship.status, 201)

    const deletedEntity = await request(`/entities/${encodeURIComponent(source.body.data.entityId)}`, {
        method: 'DELETE'
    })
    assert.equal(deletedEntity.status, 200)

    const history = await request(`/relationships/${encodeURIComponent(relationship.body.data.relationshipId)}/history`)
    assert.equal(history.status, 200)
    const deletedSnapshot = history.body.data.find(item => item.changeType === 'deleted')
    assert.equal(deletedSnapshot.version, 1)
    assert.deepEqual(deletedSnapshot.properties, {
        weight: 0.75,
        enabled: true,
        detail: { source: 'manual' }
    })
})

test('知识图谱实体列表按服务端偏移分页，并返回精确的筛选总数', async () => {
    const scopeId = 'group:pagination'
    const first = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({
            name: '带类型属性的实体',
            type: 'person',
            scopeId,
            properties: {
                numberValue: 42.5,
                booleanValue: true,
                nullValue: null,
                arrayValue: ['a', 2],
                objectValue: { nested: false }
            }
        })
    })
    assert.equal(first.status, 201)
    assert.deepEqual(first.body.data.properties, {
        numberValue: 42.5,
        booleanValue: true,
        nullValue: null,
        arrayValue: ['a', 2],
        objectValue: { nested: false }
    })

    const second = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '第二个实体', type: 'thing', scopeId, properties: {} })
    })
    assert.equal(second.status, 201)

    const third = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '第三个实体', type: 'person', scopeId, properties: {} })
    })
    assert.equal(third.status, 201)

    const typedCount = await request(`/entities/count?scopeId=${encodeURIComponent(scopeId)}&type=person`)
    assert.equal(typedCount.status, 200)
    assert.deepEqual(typedCount.body.data, { count: 2 })

    const searchedCount = await request(
        `/entities/count?scopeId=${encodeURIComponent(scopeId)}&query=${encodeURIComponent('带类型')}&type=person`
    )
    assert.equal(searchedCount.status, 200)
    assert.deepEqual(searchedCount.body.data, { count: 1 })

    const firstPage = await request(`/entities?scopeId=${encodeURIComponent(scopeId)}&limit=1&offset=0`)
    const secondPage = await request(`/entities?scopeId=${encodeURIComponent(scopeId)}&limit=1&offset=1`)
    assert.equal(firstPage.status, 200)
    assert.equal(secondPage.status, 200)
    assert.equal(firstPage.body.data.length, 1)
    assert.equal(secondPage.body.data.length, 1)
    assert.notEqual(firstPage.body.data[0].entityId, secondPage.body.data[0].entityId)

    const searchPage = await request(
        `/entities/search?query=${encodeURIComponent('实体')}&scopeIds=${encodeURIComponent(scopeId)}&limit=1&offset=1`
    )
    assert.equal(searchPage.status, 200)
    assert.equal(searchPage.body.data.length, 1)
})

test('图谱名称搜索把反斜杠及其后的通配符按字面值处理', async () => {
    const scopeId = 'group:escaped-search'
    const created = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: String.raw`路径\%实体_[]`, type: 'thing', scopeId, properties: {} })
    })
    assert.equal(created.status, 201)

    const literalBackslashPercent = await request(
        `/entities/search?query=${encodeURIComponent(String.raw`\%`)}&scopeIds=${encodeURIComponent(scopeId)}`
    )
    assert.equal(literalBackslashPercent.status, 200)
    assert.deepEqual(
        literalBackslashPercent.body.data.map(item => item.name),
        [String.raw`路径\%实体_[]`]
    )

    const wildcardOnly = await request(
        `/entities/search?query=${encodeURIComponent('%')}&scopeIds=${encodeURIComponent(scopeId)}`
    )
    assert.equal(wildcardOnly.status, 200)
    assert.deepEqual(
        wildcardOnly.body.data.map(item => item.name),
        [String.raw`路径\%实体_[]`]
    )
})

test('图谱列表查询支持重复 scopeIds 并保留其中的逗号', async () => {
    const scopeId = 'group:comma,scope'
    const created = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '逗号作用域实体', type: 'thing', scopeId, properties: {} })
    })
    assert.equal(created.status, 201)

    const response = await request(
        `/entities/search?query=${encodeURIComponent('逗号作用域实体')}&scopeIds=${encodeURIComponent(scopeId)}&scopeIds=global`
    )
    assert.equal(response.status, 200)
    assert.deepEqual(
        response.body.data.map(item => item.scopeId),
        [scopeId]
    )
})

test('路径结果只返回本次查询允许的关系类型', async () => {
    const scopeId = 'group:path-filter'
    const from = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '路径起点', type: 'person', scopeId, properties: {} })
    })
    const to = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '路径终点', type: 'thing', scopeId, properties: {} })
    })
    for (const relationType of ['knows', 'works_at']) {
        const relationship = await request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
                fromEntityId: from.body.data.entityId,
                toEntityId: to.body.data.entityId,
                relationType,
                scopeId,
                properties: {}
            })
        })
        assert.equal(relationship.status, 201)
    }

    const filteredPath = await request(
        `/path?fromEntityId=${encodeURIComponent(from.body.data.entityId)}&toEntityId=${encodeURIComponent(to.body.data.entityId)}&relationTypes=works_at`
    )
    assert.equal(filteredPath.status, 200)
    assert.deepEqual(
        filteredPath.body.data.relationships.map(item => item.relationType),
        ['works_at']
    )
})

test('路径最大深度按关系边数限制，子图截断后不返回悬空关系', async () => {
    const scopeId = 'group:graph-boundary-contract'
    const entities = []
    for (const name of ['边界起点', '边界中继', '边界终点']) {
        const created = await request('/entities', {
            method: 'POST',
            body: JSON.stringify({ name, type: 'concept', scopeId, properties: {} })
        })
        assert.equal(created.status, 201)
        entities.push(created.body.data)
    }
    for (let index = 0; index < entities.length - 1; index++) {
        const relationship = await request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
                fromEntityId: entities[index].entityId,
                toEntityId: entities[index + 1].entityId,
                relationType: 'next',
                scopeId,
                properties: {}
            })
        })
        assert.equal(relationship.status, 201)
    }

    const tooShallow = await request(
        `/path?fromEntityId=${encodeURIComponent(entities[0].entityId)}&toEntityId=${encodeURIComponent(entities[2].entityId)}&maxDepth=1`
    )
    assert.equal(tooShallow.status, 200)
    assert.equal(tooShallow.body.data, null)

    const exactDepth = await request(
        `/path?fromEntityId=${encodeURIComponent(entities[0].entityId)}&toEntityId=${encodeURIComponent(entities[2].entityId)}&maxDepth=2`
    )
    assert.equal(exactDepth.status, 200)
    assert.deepEqual(
        exactDepth.body.data.path,
        entities.map(entity => entity.entityId)
    )

    const nodeBounded = await request(
        `/subgraph?entityId=${encodeURIComponent(entities[0].entityId)}&depth=2&scopeIds=${encodeURIComponent(scopeId)}&maxNodes=1&maxEdges=10`
    )
    assert.equal(nodeBounded.status, 200)
    assert.equal(nodeBounded.body.data.entities.length, 1)
    assert.equal(nodeBounded.body.data.relationships.length, 0)

    const edgeBounded = await request(
        `/subgraph?entityId=${encodeURIComponent(entities[0].entityId)}&depth=2&scopeIds=${encodeURIComponent(scopeId)}&maxNodes=10&maxEdges=0`
    )
    assert.equal(edgeBounded.status, 200)
    assert.equal(edgeBounded.body.data.entities.length, 1)
    assert.equal(edgeBounded.body.data.relationships.length, 0)
})

test('实体标识包含斜杠时，按 URL 路径段编码后仍可访问', async () => {
    const scopeId = 'group/encoded scope'
    const created = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '含特殊作用域实体', type: 'thing', scopeId, properties: {} })
    })
    assert.equal(created.status, 201)
    const entityId = created.body.data.entityId
    const fetched = await request(`/entities/${encodeURIComponent(entityId)}`)
    assert.equal(fetched.status, 200)
    assert.equal(fetched.body.data.entityId, entityId)
})

test('知识上下文可安全格式化原型属性名实体类型', async () => {
    const created = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '原型键实体', type: '__proto__', scopeId: 'user:prototype-safe', properties: {} })
    })
    assert.equal(created.status, 201)
    const context = await request('/context?userId=prototype-safe')
    assert.equal(context.status, 200)
    assert.match(context.body.data.context, /原型键实体/)
})

test('路径查询跳过悬空关系并只返回完整可达路径', async () => {
    const scopeId = 'group:path-dangling'
    const source = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '悬空路径起点', type: 'thing', scopeId, properties: {} })
    })
    const target = await request('/entities', {
        method: 'POST',
        body: JSON.stringify({ name: '悬空路径终点', type: 'thing', scopeId, properties: {} })
    })
    assert.equal(source.status, 201)
    assert.equal(target.status, 201)

    const now = Date.now()
    databaseService.db
        .prepare(
            `
            INSERT INTO kg_relationships
            (relationship_id, from_entity_id, to_entity_id, relation_type, properties, scope_id, created_at, updated_at, version)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1)
        `
        )
        .run('rel:dangling-path', source.body.data.entityId, `${scopeId}:entity:missing`, 'next', scopeId, now, now)

    const noPath = knowledgeGraphService.pathQuery(source.body.data.entityId, target.body.data.entityId, 3)
    assert.equal(noPath, null)
    assert.equal(knowledgeGraphService._buildPathResult([source.body.data.entityId, `${scopeId}:entity:missing`]), null)

    const valid = await request('/relationships', {
        method: 'POST',
        body: JSON.stringify({
            fromEntityId: source.body.data.entityId,
            toEntityId: target.body.data.entityId,
            relationType: 'next',
            scopeId,
            properties: {}
        })
    })
    assert.equal(valid.status, 201)
    const completePath = knowledgeGraphService.pathQuery(source.body.data.entityId, target.body.data.entityId, 1)
    assert.deepEqual(completePath.path, [source.body.data.entityId, target.body.data.entityId])
    assert.equal(completePath.entities.length, 2)
    assert.equal(completePath.relationships.length, 1)
})

test('作用域共享存储拒绝自共享、重复配置与非法实体类型列表', () => {
    const created = knowledgeGraphService.createScopeSharing({
        sourceScopeId: 'group:source',
        targetScopeId: 'user:target',
        shareType: 'unresolved-contract',
        entityTypes: ['person', 'person', 'concept']
    })
    assert.deepEqual(created.entityTypes, ['person', 'concept'])
    assert.deepEqual(knowledgeGraphService.getAccessibleScopes('user:target'), [
        {
            sourceScopeId: 'group:source',
            shareType: 'unresolved-contract',
            entityTypes: ['person', 'concept']
        }
    ])

    assert.throws(
        () =>
            knowledgeGraphService.createScopeSharing({
                sourceScopeId: 'group:source',
                targetScopeId: 'user:target',
                shareType: 'unresolved-contract'
            }),
        error => error.statusCode === 409
    )
    assert.throws(
        () =>
            knowledgeGraphService.createScopeSharing({
                sourceScopeId: 'global',
                targetScopeId: 'global',
                shareType: 'unresolved-contract'
            }),
        /不能相同/
    )
    assert.throws(
        () =>
            knowledgeGraphService.createScopeSharing({
                sourceScopeId: 'group:other',
                targetScopeId: 'user:target',
                shareType: 'unresolved-contract',
                entityTypes: 'person'
            }),
        /字符串数组/
    )
})

test('可视化端点只返回有界高连接度节点并携带完整计数', async () => {
    const scopeId = 'group:visualization-limit'
    const entities = []
    for (const name of ['中心', '叶子一', '叶子二', '焦点']) {
        const created = await request('/entities', {
            method: 'POST',
            body: JSON.stringify({ name, type: 'concept', scopeId, properties: {} })
        })
        entities.push(created.body.data)
    }
    for (const target of entities.slice(1)) {
        const relationship = await request('/relationships', {
            method: 'POST',
            body: JSON.stringify({
                fromEntityId: entities[0].entityId,
                toEntityId: target.entityId,
                relationType: 'knows',
                scopeId,
                properties: {}
            })
        })
        assert.equal(relationship.status, 201)
    }

    const visualization = await request(
        `/visualization?scopeId=${encodeURIComponent(scopeId)}&limit=2&focusEntityId=${encodeURIComponent(entities[3].entityId)}`
    )
    assert.equal(visualization.status, 200)
    assert.equal(visualization.body.data.entities.length, 2)
    assert.equal(visualization.body.data.entities[0].entityId, entities[3].entityId)
    assert.equal(visualization.body.data.relationships.length, 1)
    assert.equal(visualization.body.data.totalEntities, 4)
    assert.equal(visualization.body.data.totalRelationships, 3)
    assert.equal(visualization.body.data.truncated, true)

    const boundedSubgraph = await request(
        `/subgraph?entityId=${encodeURIComponent(entities[0].entityId)}&depth=2&scopeIds=${encodeURIComponent(scopeId)}&maxNodes=2&maxEdges=1`
    )
    assert.equal(boundedSubgraph.status, 200)
    assert.equal(boundedSubgraph.body.data.entities.length, 2)
    assert.equal(boundedSubgraph.body.data.relationships.length, 1)
    assert.equal(boundedSubgraph.body.data.truncated, true)
})

test('完整导出超过一万实体时不截断且下载响应可直接重新导入', async () => {
    const scopeId = 'group:complete-export'
    const now = Date.now()
    const insert = databaseService.db.prepare(`
        INSERT INTO kg_entities
        (entity_id, entity_type, name, scope_id, properties, created_at, updated_at, version)
        VALUES (?, 'thing', ?, ?, '{}', ?, ?, 1)
    `)
    databaseService.db.transaction(() => {
        for (let index = 0; index < 10001; index++) {
            insert.run(`${scopeId}:entity:${index}`, `批量实体${index}`, scopeId, now, now)
        }
    })()

    const legacyExport = knowledgeGraphService.exportGraph(scopeId)
    assert.equal(legacyExport.entities.length, 10001)
    assert.deepEqual(legacyExport.counts, { entities: 10001, relationships: 0 })
    assert.equal(legacyExport.schemaVersion, 1)
    assert.equal(legacyExport.truncated, false)

    const response = await fetch(`${baseUrl}/export?scopeId=${encodeURIComponent(scopeId)}`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="graph-/)
    const downloaded = await response.json()
    assert.equal(downloaded.entities.length, 10001)
    assert.deepEqual(downloaded.counts, { entities: 10001, relationships: 0 })
    assert.equal(downloaded.truncated, false)

    const rejectedSummary = await request('/import', {
        method: 'POST',
        body: JSON.stringify({
            targetScopeId: 'group:reject-summary',
            graphData: { schemaVersion: 1, scopeId, truncated: true, entities: [], relationships: [] }
        })
    })
    assert.equal(rejectedSummary.status, 400)
    assert.match(rejectedSummary.body.message, /截断/)
})
