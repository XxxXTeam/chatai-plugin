import assert from 'node:assert/strict'
import test from 'node:test'
import { redisClient } from '../src/core/cache/RedisClient.js'
import { usageStats } from '../src/services/stats/UsageStats.js'

function makeRecord(id, overrides = {}) {
    return {
        id,
        timestamp: 1000 + id,
        channelId: 'channel-a',
        model: 'model-a',
        source: 'chat',
        success: true,
        ...overrides
    }
}

function stubRedis(rawRecords, { fail = false, connected = true } = {}) {
    const original = {
        llen: redisClient.llen,
        lrange: redisClient.lrange,
        isConnected: redisClient.isConnected
    }
    const calls = []
    redisClient.isConnected = connected
    redisClient.llen = async () => {
        if (fail) throw new Error('redis unavailable')
        return rawRecords.length
    }
    redisClient.lrange = async (_key, start, stop) => {
        calls.push([start, stop])
        if (fail) throw new Error('redis unavailable')
        if (!connected) return []
        return rawRecords.slice(start, stop + 1)
    }
    return { calls, restore: () => Object.assign(redisClient, original) }
}

test('getRecentPaged 先完整筛选再分页，并保留 source alias', async () => {
    const rawRecords = [
        makeRecord(5, { source: 'chat', success: true, timestamp: 5000 }),
        '{bad-json',
        makeRecord(4, { source: '群记忆总结', success: true, timestamp: 4000 }),
        makeRecord(3, { source: 'memory_group', success: false, timestamp: 3000 }),
        makeRecord(2, { source: 'memory_group', success: true, timestamp: 2000 }),
        makeRecord(1, { source: 'memory_group', success: true, timestamp: 1000 })
    ]
    const fake = stubRedis(rawRecords)
    try {
        const result = await usageStats.getRecentPaged(2, 2, {
            source: '群记忆',
            success: true,
            startTime: 1000,
            endTime: 4000
        })
        assert.deepEqual(
            result.records.map(record => record.id),
            [1]
        )
        assert.deepEqual(result.pagination, {
            page: 2,
            limit: 2,
            total: 3,
            totalPages: 2,
            hasMore: false
        })
        assert.deepEqual(fake.calls, [[0, 9999]], '带筛选必须读取 MAX_RECORDS 窗口后再分页')
    } finally {
        fake.restore()
    }
})

test('getRecentPaged 无筛选使用 Redis 原生范围切片并返回准确分页', async () => {
    const rawRecords = Array.from({ length: 250 }, (_, index) => JSON.stringify(makeRecord(250 - index)))
    const fake = stubRedis(rawRecords)
    try {
        const result = await usageStats.getRecentPaged(3, 100)
        assert.equal(result.records.length, 50)
        assert.equal(result.records[0].id, 50)
        assert.equal(result.pagination.total, 250)
        assert.equal(result.pagination.totalPages, 3)
        assert.equal(result.pagination.hasMore, false)
        assert.deepEqual(fake.calls, [[200, 299]])
    } finally {
        fake.restore()
    }
})

test('getRecentPaged 处理 Redis 异常、坏 JSON 与非法分页参数', async () => {
    usageStats.recentStats = [makeRecord(2), makeRecord(1)]
    const fake = stubRedis([], { fail: true })
    try {
        const result = await usageStats.getRecentPaged('not-a-page', 0)
        assert.deepEqual(
            result.records.map(record => record.id),
            [2, 1]
        )
        assert.equal(result.pagination.page, 1)
        assert.equal(result.pagination.limit, 100)
        assert.equal(result.pagination.total, 2)
        assert.equal(result.pagination.totalPages, 1)
        assert.equal(result.pagination.hasMore, false)
    } finally {
        fake.restore()
        usageStats.recentStats = []
    }
})

test('getRecentPaged 无筛选遇到坏 JSON 时按有效记录重新统计并分页', async () => {
    const rawRecords = [
        '{bad-json',
        ...Array.from({ length: 100 }, (_, index) => JSON.stringify(makeRecord(100 - index)))
    ]
    const fake = stubRedis(rawRecords)
    try {
        const firstPage = await usageStats.getRecentPaged(1, 100)
        assert.equal(firstPage.records.length, 100)
        assert.equal(firstPage.records[0].id, 100)
        assert.equal(firstPage.records[99].id, 1)
        assert.equal(firstPage.pagination.total, 100)
        assert.equal(firstPage.pagination.totalPages, 1)
        assert.equal(firstPage.pagination.hasMore, false)
        assert.deepEqual(fake.calls, [
            [0, 99],
            [0, 9999]
        ])
    } finally {
        fake.restore()
    }
})

test('getRecentPaged Redis断连且范围读取为空时回退到内存缓存', async () => {
    usageStats.recentStats = [makeRecord(2), makeRecord(1)]
    const rawRecords = [JSON.stringify(makeRecord(9)), JSON.stringify(makeRecord(8))]
    const fake = stubRedis(rawRecords, { connected: false })
    try {
        const result = await usageStats.getRecentPaged(1, 100)
        assert.deepEqual(
            result.records.map(record => record.id),
            [2, 1]
        )
        assert.equal(result.pagination.total, 2)
        assert.deepEqual(fake.calls, [[0, 99]])
    } finally {
        fake.restore()
        usageStats.recentStats = []
    }
})

test('getRecentPaged 忽略空字符串和非法时间筛选并保留时间戳0', async () => {
    const rawRecords = [
        JSON.stringify(makeRecord(2, { timestamp: 2000 })),
        JSON.stringify(makeRecord(0, { timestamp: 0 }))
    ]
    const fake = stubRedis(rawRecords)
    try {
        const emptyTime = await usageStats.getRecentPaged(1, 100, { startTime: '' })
        assert.deepEqual(
            emptyTime.records.map(record => record.id),
            [2, 0]
        )
        assert.equal(emptyTime.pagination.total, 2)

        const invalidTimes = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'not-a-time', '   ']
        for (const time of invalidTimes) {
            const result = await usageStats.getRecentPaged(1, 100, { startTime: time, endTime: time })
            assert.deepEqual(
                result.records.map(record => record.id),
                [2, 0]
            )
            assert.equal(result.pagination.total, 2)
        }

        const zeroTime = await usageStats.getRecentPaged(1, 100, { endTime: 0 })
        assert.deepEqual(
            zeroTime.records.map(record => record.id),
            [0]
        )
        assert.equal(zeroTime.pagination.total, 1)
    } finally {
        fake.restore()
    }
})
