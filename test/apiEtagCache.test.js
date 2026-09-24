import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import { clearApiEtagCache, createApiEtagCacheMiddleware } from '../src/services/middleware/apiEtagCache.js'

/**
 * 启动测试应用并返回取址信息
 * @param {import('express').Express} app - 已装配路由的 Express 应用
 * @returns {Promise<{ baseUrl: string, close: () => Promise<void> }>}
 */
async function startTestApp(app) {
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address()
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise(resolve => server.close(() => resolve()))
    }
}

function createIdentityResolver(req) {
    return req.headers['x-test-user'] || ''
}

test('首次 200 带 ETag 与 Cache-Control，二次携带 if-none-match 得到 304 且路由不再执行', async () => {
    const counter = { value: 0 }
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    const app = express()
    app.use(middleware)
    app.get('/api/data', (req, res) => {
        counter.value += 1
        res.json({ v: 1, counter: counter.value })
    })
    const { baseUrl, close } = await startTestApp(app)
    try {
        const first = await fetch(`${baseUrl}/api/data`)
        assert.equal(first.status, 200)
        assert.match(first.headers.get('etag') || '', /^W\/"[0-9a-f]{16}"$/)
        assert.equal(first.headers.get('cache-control'), 'private, max-age=0, must-revalidate')
        assert.equal((await first.json()).counter, 1)

        const second = await fetch(`${baseUrl}/api/data`, {
            headers: { 'if-none-match': first.headers.get('etag') }
        })
        assert.equal(second.status, 304)
        assert.equal(await second.text(), '')
        assert.equal(second.headers.get('set-cookie'), null, '304 命中响应不得携带 Set-Cookie')
        assert.equal(counter.value, 1, '304 命中时路由 handler 不得再次执行')
    } finally {
        await close()
    }
})

test('响应体变化后 ETag 变化，旧 ETag 请求回落到 200', async () => {
    const counter = { value: 0 }
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    const app = express()
    app.use(middleware)
    app.get('/api/mutable', (req, res) => {
        counter.value += 1
        res.json({ n: counter.value })
    })
    const { baseUrl, close } = await startTestApp(app)
    try {
        const first = await fetch(`${baseUrl}/api/mutable`)
        const etag1 = first.headers.get('etag')
        assert.equal(first.status, 200)

        const stale = await fetch(`${baseUrl}/api/mutable`, { headers: { 'if-none-match': etag1 } })
        assert.equal(stale.status, 304)

        // 第三次请求不带 if-none-match：路由执行，counter 增长，body 变化，ETag 必须变化
        const changed = await fetch(`${baseUrl}/api/mutable`)
        assert.equal(changed.status, 200)
        assert.equal((await changed.json()).n, 2)
        assert.notEqual(changed.headers.get('etag'), etag1)

        const afterChange = await fetch(`${baseUrl}/api/mutable`, {
            headers: { 'if-none-match': changed.headers.get('etag') }
        })
        assert.equal(afterChange.status, 304)
    } finally {
        await close()
    }
})

test('POST 请求不生成 ETag 也不被拦截', async () => {
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    const app = express()
    app.use(middleware)
    app.post('/api/action', (req, res) => res.json({ ok: true }))
    const { baseUrl, close } = await startTestApp(app)
    try {
        const response = await fetch(`${baseUrl}/api/action`, {
            method: 'POST',
            headers: { 'if-none-match': 'W/"whatever"' },
            body: '{}'
        })
        // POST 不参与本模块协商缓存：不拦截、不写 Cache-Control（Etags 为 Express 原生行为，与被测契约无关）
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('cache-control'), null)
    } finally {
        await close()
    }
})

test('非 /api 路径不被中间件拦截也不产生缓存头', async () => {
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    const app = express()
    app.use(middleware)
    app.get('/chatai/robots.txt', (req, res) => res.json({ no: 'etag' }))
    const { baseUrl, close } = await startTestApp(app)
    try {
        const response = await fetch(`${baseUrl}/chatai/robots.txt`, {
            headers: { 'if-none-match': 'W/"whatever"' }
        })
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('cache-control'), null)
    } finally {
        await close()
    }
})

test('同一 URL 不同身份产生不同 ETag，304 不跨身份命中', async () => {
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    const app = express()
    app.use(middleware)
    app.get('/api/scoped', (req, res) => {
        res.json({ owner: req.headers['x-test-user'] })
    })
    const { baseUrl, close } = await startTestApp(app)
    try {
        const userA = await fetch(`${baseUrl}/api/scoped`, { headers: { 'x-test-user': 'user-a' } })
        const userB = await fetch(`${baseUrl}/api/scoped`, { headers: { 'x-test-user': 'user-b' } })
        assert.equal(userA.status, 200)
        assert.equal(userB.status, 200)
        assert.notEqual(userA.headers.get('etag'), userB.headers.get('etag'))

        // 身份 B 携带身份 A 的 ETag 不应命中 304
        const cross = await fetch(`${baseUrl}/api/scoped`, {
            headers: { 'x-test-user': 'user-b', 'if-none-match': userA.headers.get('etag') }
        })
        assert.equal(cross.status, 200, '跨身份不得命中 304')

        // 同身份协商可命中
        const same = await fetch(`${baseUrl}/api/scoped`, {
            headers: { 'x-test-user': 'user-b', 'if-none-match': userB.headers.get('etag') }
        })
        assert.equal(same.status, 304)
    } finally {
        await close()
    }
})

test('limit 逐出：第 4 个 key 写入后最旧 key 不再命中 304', async () => {
    const middleware = createApiEtagCacheMiddleware({
        identityResolver: createIdentityResolver,
        limit: 3
    })
    const app = express()
    app.use(middleware)
    for (const i of [1, 2, 3]) {
        app.get(`/api/evict-${i}`, (req, res) => res.json({ key: req.path }))
    }
    app.get('/api/evict-4', (req, res) => res.json({ key: '/api/evict-4' }))
    const { baseUrl, close } = await startTestApp(app)
    try {
        const firstEtag = (await fetch(`${baseUrl}/api/evict-1`)).headers.get('etag')
        for (const i of [2, 3]) {
            const response = await fetch(`${baseUrl}/api/evict-${i}`)
            assert.equal(response.status, 200)
        }
        const fourth = await fetch(`${baseUrl}/api/evict-4`)
        assert.equal(fourth.status, 200)

        const evicted = await fetch(`${baseUrl}/api/evict-1`, { headers: { 'if-none-match': firstEtag } })
        assert.equal(evicted.status, 200, '已逐出的 key 不再命中 304，应回落为 200 全量响应')
    } finally {
        await close()
    }
})

test('重复挂载中间件幂等：res.json 只包装一次，写入缓存后仍能协商命中', async () => {
    const counter = { value: 0 }
    const app = express()
    app.use(createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver }))
    app.use(createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver }))
    app.get('/api/idempotent', (req, res) => {
        counter.value += 1
        res.json({ n: counter.value })
    })
    const { baseUrl, close } = await startTestApp(app)
    try {
        const first = await fetch(`${baseUrl}/api/idempotent`)
        assert.equal(first.status, 200)
        const second = await fetch(`${baseUrl}/api/idempotent`, {
            headers: { 'if-none-match': first.headers.get('etag') }
        })
        assert.equal(second.status, 304)
        assert.equal(counter.value, 1)
    } finally {
        await close()
    }
})

test('带 Set-Cookie 的响应不参与缓存，第二次请求仍执行路由', async () => {
    const counter = { value: 0 }
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    const app = express()
    app.use(middleware)
    app.get('/api/session', (req, res) => {
        counter.value += 1
        res.cookie('sid', 'abc').json({ n: counter.value })
    })
    const { baseUrl, close } = await startTestApp(app)
    try {
        const first = await fetch(`${baseUrl}/api/session`)
        assert.equal(first.status, 200)
        const second = await fetch(`${baseUrl}/api/session`, {
            headers: { 'if-none-match': first.headers.get('etag') }
        })
        // 未缓存则不命中 304，且 Set-Cookie 响应每次都会执行路由
        assert.equal(second.status, 200)
        assert.equal(counter.value, 2)
    } finally {
        await close()
    }
})

test('错误响应不写缓存：>=400 时第二次请求不命中 304 且保留 ETag 头', async () => {
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    const app = express()
    app.use(middleware)
    app.get('/api/error', (req, res) => res.status(418).json({ err: 'teapot' }))
    const { baseUrl, close } = await startTestApp(app)
    try {
        const first = await fetch(`${baseUrl}/api/error`)
        assert.equal(first.status, 418)
        assert.match(first.headers.get('etag') || '', /^W\/"/)
        const second = await fetch(`${baseUrl}/api/error`, {
            headers: { 'if-none-match': first.headers.get('etag') }
        })
        assert.equal(second.status, 418, '错误响应不缓存，携带 ETag 的重试仍应走完整路由')
    } finally {
        await close()
    }
})

test('未提供身份解析器时回落匿名桶，仍可协商命中', async () => {
    const middleware = createApiEtagCacheMiddleware()
    const app = express()
    app.use(middleware)
    app.get('/api/anon', (req, res) => res.json({ anonymous: true }))
    const { baseUrl, close } = await startTestApp(app)
    try {
        const first = await fetch(`${baseUrl}/api/anon`)
        assert.equal(first.status, 200)
        const second = await fetch(`${baseUrl}/api/anon`, {
            headers: { 'if-none-match': first.headers.get('etag') }
        })
        assert.equal(second.status, 304)
    } finally {
        await close()
    }
})

test('clearApiEtagCache 清空后不命中历史条目', async () => {
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    const app = express()
    app.use(middleware)
    app.get('/api/clear-me', (req, res) => res.json({ v: 1 }))
    const { baseUrl, close } = await startTestApp(app)
    try {
        const first = await fetch(`${baseUrl}/api/clear-me`)
        const etag = first.headers.get('etag')
        assert.equal(first.status, 200)
        clearApiEtagCache()
        const again = await fetch(`${baseUrl}/api/clear-me`, { headers: { 'if-none-match': etag } })
        assert.equal(again.status, 200)
    } finally {
        await close()
    }
})

test('写操作通过后按身份前缀自动失效对应 GET 缓存', async () => {
    const stores = new Map()
    // vite 环境不跨进程：用内存快照模拟 data store，PUT 修改再 GET
    const app = express()
    const middleware = createApiEtagCacheMiddleware({ identityResolver: createIdentityResolver })
    app.use(middleware)
    app.get('/api/channels/list', (req, res) => res.json({ channels: stores.get('channels') || [] }))
    app.get('/api/channels/stats', (req, res) => res.json({ total: stores.get('total') || 0 }))
    app.put('/api/channels/123', (req, res) => {
        stores.set('channels', [{ id: '123', name: '新渠道' }])
        stores.set('total', 1)
        res.json({ ok: true })
    })
    const { baseUrl, close } = await startTestApp(app)
    try {
        const firstList = await fetch(`${baseUrl}/api/channels/list`, { headers: { 'x-test-user': 'user-a' } })
        const firstStats = await fetch(`${baseUrl}/api/channels/stats`, { headers: { 'x-test-user': 'user-a' } })
        assert.equal(firstList.status, 200)

        // 写后再带旧 ETag 请求：必须回落 200 拿到新数据
        await fetch(`${baseUrl}/api/channels/123`, {
            method: 'PUT',
            headers: { 'x-test-user': 'user-a', 'content-type': 'application/json' },
            body: JSON.stringify({ name: '新渠道' })
        })
        const staleList = await fetch(`${baseUrl}/api/channels/list`, {
            headers: { 'x-test-user': 'user-a', 'if-none-match': firstList.headers.get('etag') }
        })
        assert.equal(staleList.status, 200, '写操作后旧 ETag 不得命中 304')
        assert.deepEqual((await staleList.json()).channels, [{ id: '123', name: '新渠道' }])
        const staleStats = await fetch(`${baseUrl}/api/channels/stats`, {
            headers: { 'x-test-user': 'user-a', 'if-none-match': firstStats.headers.get('etag') }
        })
        assert.equal(staleStats.status, 200, '同资源前缀的其它端点同样失效')

        // 其它身份不受影响
        const otherView = await fetch(`${baseUrl}/api/channels/list`, {
            headers: { 'x-test-user': 'user-b', 'if-none-match': firstList.headers.get('etag') }
        })
        assert.equal(otherView.status, 200, '身份隔离的缓存不受他身份写操作影响')
    } finally {
        await close()
    }
})
