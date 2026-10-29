import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
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

beforeEach(() => {
    // usageStats 是单例：每个用例前清掉筛选索引，并关闭后台预热避免干扰 lrange 调用断言
    usageStats._filterIndex = null
    usageStats._filterIndexBuilding = null
    usageStats._filterIndexBuiltAt = 0
    usageStats.filterIndexWarmEnabled = false
})

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
        assert.deepEqual(fake.calls, [[0, 499]], '带筛选必须扫描完整列表（分批）后再分页')
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

// ---- 筛选索引 ----

function stubRedisWritable(rawRecords) {
    const methods = ['llen', 'lrange', 'lpush', 'ltrim', 'hincrby', 'expire', 'hset']
    const original = Object.fromEntries(methods.map(name => [name, redisClient[name]]))
    original.isConnected = redisClient.isConnected
    const calls = []
    redisClient.isConnected = true
    redisClient.llen = async () => rawRecords.length
    redisClient.lrange = async (_key, start, stop) => {
        calls.push([start, stop])
        return rawRecords.slice(start, stop + 1)
    }
    redisClient.lpush = async (_key, value) => {
        rawRecords.unshift(value)
        return rawRecords.length
    }
    redisClient.ltrim = async (_key, start, stop) => {
        rawRecords.splice(stop + 1)
    }
    redisClient.hincrby = async () => 0
    redisClient.expire = async () => 0
    redisClient.hset = async () => 0
    return { calls, restore: () => Object.assign(redisClient, original) }
}

// 重建索引按 500 条一批读取；当前页读取不会出现整批窗口
const isScan = (start, stop) => stop - start + 1 === 500

function makeList(count, pick = index => ({})) {
    return Array.from({ length: count }, (_, index) =>
        JSON.stringify(makeRecord(count - index, { timestamp: 10000 + count - index, ...pick(count - index) }))
    )
}

test('筛选索引：首次全量扫描，之后筛选与翻页只读取当前页', async () => {
    const rawRecords = makeList(300, id => ({ source: id % 3 === 0 ? 'bym' : 'chat', success: id % 10 !== 0 }))
    const fake = stubRedisWritable(rawRecords)
    try {
        const first = await usageStats.getRecentPaged(1, 20, { source: 'bym' })
        assert.equal(first.pagination.total, 100)
        assert.deepEqual(fake.calls, [[0, 499]], '第一次筛选需全量扫描建立索引')

        fake.calls.length = 0
        const second = await usageStats.getRecentPaged(2, 20, { source: 'bym' })
        assert.equal(second.pagination.total, 100)
        assert.deepEqual(
            second.records.map(r => r.id),
            Array.from({ length: 20 }, (_, i) => 240 - i * 3)
        )
        assert.ok(
            fake.calls.every(([start, stop]) => stop - start < 20),
            `命中索引后不应再全量读取: ${JSON.stringify(fake.calls)}`
        )

        fake.calls.length = 0
        const failed = await usageStats.getRecentPaged(1, 5, { success: false, source: 'chat' })
        assert.deepEqual(
            failed.records.map(r => r.id),
            [290, 280, 260, 250, 230]
        )
        assert.equal(failed.pagination.total, 20)
        assert.ok(!fake.calls.some(([s, e]) => isScan(s, e)))
    } finally {
        fake.restore()
    }
})

test('筛选索引：record() 增量更新，新记录立即可被筛选到且无需重扫', async () => {
    const rawRecords = makeList(50)
    const fake = stubRedisWritable(rawRecords)
    try {
        await usageStats.getRecentPaged(1, 10, { source: 'bym' })
        assert.equal(usageStats._filterIndex.length, 50)

        await usageStats.record({ source: 'bym', model: 'm-new', channelId: 'c-new', success: false })
        assert.equal(usageStats._filterIndex.length, 51)

        fake.calls.length = 0
        const result = await usageStats.getRecentPaged(1, 10, { source: 'bym' })
        assert.equal(result.pagination.total, 1)
        assert.equal(result.records[0].model, 'm-new')
        assert.ok(!fake.calls.some(([s, e]) => isScan(s, e)), '增量更新后不应重扫')
    } finally {
        fake.restore()
        usageStats.recentStats = []
    }
})

test('筛选索引：满 MAX_RECORDS 时随 LTRIM 截断，长度保持一致', async () => {
    const rawRecords = makeList(10000)
    const fake = stubRedisWritable(rawRecords)
    try {
        await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        assert.equal(fake.calls.filter(([s, e]) => isScan(s, e)).length, 20, '1 万条应分 20 批读取')
        assert.deepEqual(fake.calls.at(-1), [9500, 9999])
        await usageStats.record({ source: 'bym' })
        assert.equal(rawRecords.length, 10000)
        assert.equal(usageStats._filterIndex.length, 10000)
        fake.calls.length = 0
        const result = await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        assert.equal(result.pagination.total, 9999)
        assert.ok(!fake.calls.some(([s, e]) => isScan(s, e)))
    } finally {
        fake.restore()
        usageStats.recentStats = []
    }
})

test('筛选索引：Redis 被外部改写（长度相同、内容不同）时自动重建，结果正确', async () => {
    const rawRecords = makeList(30)
    const fake = stubRedisWritable(rawRecords)
    try {
        await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        // 绕过 record() 直接写入：另一进程 LPUSH 一条并 LTRIM 掉最旧一条，长度不变
        rawRecords.unshift(JSON.stringify(makeRecord(999, { source: 'bym' })))
        rawRecords.pop()
        const result = await usageStats.getRecentPaged(1, 10, { source: 'bym' })
        assert.equal(result.pagination.total, 1)
        assert.equal(result.records[0].id, 999)
    } finally {
        fake.restore()
    }
})

test('筛选索引：列表超过 MAX_RECORDS（LTRIM 前）时仍命中索引、不反复重建', async () => {
    const rawRecords = makeList(10000)
    const fake = stubRedisWritable(rawRecords)
    try {
        await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        rawRecords.push(JSON.stringify(makeRecord(-1)))
        fake.calls.length = 0
        const result = await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        assert.equal(result.pagination.total, 10000)
        assert.ok(!fake.calls.some(([s, e]) => isScan(s, e)), '尾部多出的记录不应触发重建')
    } finally {
        fake.restore()
    }
})

test('筛选索引：中间记录被替换（头部不变）时按 id 校验发现并重建', async () => {
    const rawRecords = makeList(30)
    const fake = stubRedisWritable(rawRecords)
    try {
        await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        rawRecords[5] = JSON.stringify(makeRecord(777, { source: 'chat' }))
        const result = await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        assert.equal(result.records[5].id, 777)
        assert.equal(result.pagination.total, 30)
    } finally {
        fake.restore()
    }
})

test('筛选索引：超过最长存活时间后重建；clear() 立即失效', async () => {
    const rawRecords = makeList(20)
    const fake = stubRedisWritable(rawRecords)
    const originalClear = { keys: redisClient.keys, exists: redisClient.exists, del: redisClient.del }
    try {
        await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        usageStats._filterIndexBuiltAt = Date.now() - usageStats.filterIndexMaxAgeMs - 1
        fake.calls.length = 0
        await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        assert.deepEqual(fake.calls, [[0, 499]], '过期索引应重建')

        redisClient.keys = async () => []
        redisClient.exists = async () => 0
        redisClient.del = async () => 0
        await usageStats.clear()
        assert.equal(usageStats._filterIndex, null)
    } finally {
        Object.assign(redisClient, originalClear)
        fake.restore()
    }
})

test('筛选索引：并发首次筛选只扫描一次 Redis', async () => {
    const rawRecords = makeList(100)
    const fake = stubRedisWritable(rawRecords)
    try {
        const results = await Promise.all([
            usageStats.getRecentPaged(1, 10, { source: 'chat' }),
            usageStats.getRecentPaged(1, 10, { success: true }),
            usageStats.getRecentPaged(2, 10, { model: 'model-a' })
        ])
        assert.equal(fake.calls.filter(([s, e]) => isScan(s, e)).length, 1, '并发请求共享一次扫描')
        assert.deepEqual(
            results.map(r => r.pagination.total),
            [100, 100, 100]
        )
        assert.equal(results[2].records[0].id, 90)
    } finally {
        fake.restore()
    }
})

test('筛选索引：无筛选请求会在后台预热索引', async () => {
    const rawRecords = makeList(40)
    const fake = stubRedisWritable(rawRecords)
    usageStats.filterIndexWarmEnabled = true
    try {
        await usageStats.getRecentPaged(1, 10)
        await new Promise(resolve => setTimeout(resolve, 20))
        assert.equal(usageStats._filterIndex?.length, 40)
        fake.calls.length = 0
        const result = await usageStats.getRecentPaged(1, 10, { source: 'chat' })
        assert.equal(result.pagination.total, 40)
        assert.ok(!fake.calls.some(([s, e]) => isScan(s, e)), '预热后首次筛选不应全量读取')
    } finally {
        fake.restore()
    }
})
