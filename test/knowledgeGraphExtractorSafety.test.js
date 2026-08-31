import assert from 'node:assert/strict'
import { test } from 'node:test'
import KnowledgeGraphExtractor from '../src/services/storage/KnowledgeGraphExtractor.js'
import { knowledgeGraphService } from '../src/services/storage/KnowledgeGraphService.js'

test('知识图谱去重可处理原型键实体类型', async () => {
    const originalListEntities = knowledgeGraphService.listEntities
    knowledgeGraphService.listEntities = () => [
        { entityId: 'prototype:a', entityType: '__proto__', name: '甲', createdAt: 1, properties: {} },
        { entityId: 'prototype:b', entityType: '__proto__', name: '乙', createdAt: 2, properties: {} }
    ]

    try {
        const extractor = new KnowledgeGraphExtractor()
        assert.equal(await extractor.deduplicateEntities('prototype-safe', 0.99), 0)
    } finally {
        knowledgeGraphService.listEntities = originalListEntities
    }
})
