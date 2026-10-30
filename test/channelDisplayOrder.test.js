import assert from 'node:assert/strict'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import express from 'express'
import { createChannelDisplayOrderRoutes } from '../src/services/routes/channelDisplayOrderRoutes.js'
import { createApiEtagCacheMiddleware } from '../src/services/middleware/apiEtagCache.js'

const scratchRoot = process.env.CHATAI_TEST_SCRATCH || '/root/.hermes/cache/scratch'

function fixture(t, ids = ['a', 'b', 'c']) {
    assert.ok(path.isAbsolute(scratchRoot), 'test scratch must be absolute')
    fs.mkdirSync(scratchRoot, { recursive: true })
    const dir = fs.mkdtempSync(path.join(scratchRoot, 'chatai-channel-order-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const state = { ids }
    const filePath = path.join(dir, 'channel-display-order.json')
    const options = {
        getFilePath: () => filePath,
        getChannelIds: async () => state.ids
    }
    return { dir, filePath, state, options }
}

async function serve(t, options, { cache = false, auth = false, router = null } = {}) {
    const app = express()
    app.use(express.json({ limit: '10mb', strict: false }))
    if (cache) app.use(createApiEtagCacheMiddleware())
    const channels = express.Router()
    channels.use('/display-order', router || createChannelDisplayOrderRoutes(options))
    channels.get('/:id', (req, res) => res.status(418).json({ wrongRoute: req.params.id }))
    channels.put('/:id', (req, res) => res.status(418).json({ wrongRoute: req.params.id }))
    const requireAuth = (req, res, next) => {
        if (req.headers['x-test-auth'] !== 'yes') return res.status(401).json({ code: 1002 })
        next()
    }
    app.use('/api/channels', ...(auth ? [requireAuth] : []), channels)
    const server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
    t.after(() => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))))
    return async (method = 'GET', body, headers = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/channels/display-order`, {
            method,
            headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        })
        const text = await response.text()
        return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null }
    }
}

function assertOk(response) {
    assert.equal(response.status, 200)
    assert.equal(response.body.code, 0)
    assert.equal(response.body.message, 'ok')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return response.body.data
}

function assertFailure(response, status) {
    assert.equal(response.status, status)
    assert.notEqual(response.body.code, 0)
    assert.equal(response.headers.get('cache-control'), 'no-store')
}

test('missing preference returns null state without writing a file', async t => {
    const f = fixture(t)
    const request = await serve(t, f.options)
    assert.deepEqual(assertOk(await request()), { order: null, revision: null })
    assert.deepEqual(fs.readdirSync(f.dir), [])
})

test('uninitialized or relative storage path fails closed without writing', async t => {
    const f = fixture(t)
    for (const getFilePath of [
        () => {
            throw new Error('Channel display order data directory is not initialized')
        },
        () => undefined,
        () => 'relative/channel-display-order.json'
    ]) {
        const request = await serve(t, { ...f.options, getFilePath })
        assertFailure(await request(), 500)
        assertFailure(await request('PUT', { order: ['a'], revision: null }), 500)
    }
    assert.deepEqual(fs.readdirSync(f.dir), [])
})

test('PUT persists reconciled IDs and a UUID revision across fresh routers', async t => {
    const f = fixture(t)
    const first = await serve(t, f.options)
    const saved = assertOk(await first('PUT', { order: ['c', 'a', 'c', 'deleted'], revision: null }))
    assert.deepEqual(saved.order, ['c', 'a', 'b'])
    assert.match(saved.revision, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath, 'utf8')), saved)
    const second = await serve(t, f.options)
    assert.deepEqual(assertOk(await second()), saved)
    assert.deepEqual(fs.readdirSync(f.dir), ['channel-display-order.json'])
})

test('matching revision updates; stale revision and null cannot overwrite a saved file', async t => {
    const f = fixture(t)
    const request = await serve(t, f.options)
    assertFailure(await request('PUT', { order: ['a'], revision: 'stale-before-first-write' }), 409)
    assert.equal(fs.existsSync(f.filePath), false)
    const initial = assertOk(await request('PUT', { order: ['b', 'a'], revision: null }))
    const before = fs.readFileSync(f.filePath, 'utf8')
    for (const revision of [null, '', 'stale']) {
        assertFailure(await request('PUT', { order: ['c'], revision }), 409)
        assert.equal(fs.readFileSync(f.filePath, 'utf8'), before)
    }
    const updated = assertOk(await request('PUT', { order: ['c'], revision: initial.revision }))
    assert.notEqual(updated.revision, initial.revision)
    assert.deepEqual(updated.order, ['c', 'a', 'b'])
    assert.deepEqual(assertOk(await request()), updated)
})

test('concurrent writes through separate routers have exactly one CAS winner', async t => {
    const f = fixture(t)
    for (const initialRevision of [null, 'existing-revision']) {
        if (initialRevision) fs.writeFileSync(f.filePath, JSON.stringify({ order: ['a'], revision: initialRevision }))
        const releases = []
        let ready
        const bothReady = new Promise(resolve => {
            ready = resolve
        })
        const options = {
            ...f.options,
            getChannelIds: () =>
                new Promise(resolve => {
                    releases.push(() => resolve(f.state.ids))
                    if (releases.length === 2) ready()
                })
        }
        const first = await serve(t, options)
        const second = await serve(t, options)
        const pending = [
            first('PUT', { order: ['b'], revision: initialRevision }),
            second('PUT', { order: ['c'], revision: initialRevision })
        ]
        await Promise.race([
            bothReady,
            Promise.all(pending).then(results => {
                assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
            })
        ])
        releases.forEach(release => release())
        const results = await Promise.all(pending)
        assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
        const saved = assertOk(results.find(result => result.status === 200))
        assertFailure(
            results.find(result => result.status === 409),
            409
        )
        assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath, 'utf8')), saved)
    }
})

test('PUT rejects invalid bodies before channel lookup or disk changes', async t => {
    const f = fixture(t)
    let lookups = 0
    const request = await serve(t, {
        ...f.options,
        getChannelIds: async () => {
            lookups++
            return f.state.ids
        }
    })
    const bodies = [
        undefined,
        null,
        [],
        'string',
        1,
        {},
        { revision: null },
        { order: [] },
        { order: 'a', revision: null },
        { order: [1], revision: null },
        { order: [null], revision: null },
        { order: [''], revision: null },
        { order: [' \t'], revision: null },
        { order: ['a'.repeat(257)], revision: null },
        { order: Array(10001).fill('a'), revision: null },
        { order: ['a'], revision: 1 },
        { order: ['a'], revision: {} },
        { order: ['a'], revision: false },
        { order: ['a'], revision: [], filePath: '/elsewhere' },
        { order: ['a'], revision: null, filePath: '/elsewhere' },
        { order: ['a'] }
    ]
    for (const body of bodies) assertFailure(await request('PUT', body), 400)
    assert.equal(lookups, 0)
    assert.deepEqual(fs.readdirSync(f.dir), [])
})

test('PUT accepts boundary lengths, duplicate IDs and literal IDs without normalization', async t => {
    const longId = 'x'.repeat(256)
    const f = fixture(t, [longId, ' a ', '__proto__', '../outside'])
    const request = await serve(t, f.options)
    const saved = assertOk(await request('PUT', { order: Array(10000).fill(longId), revision: null }))
    assert.deepEqual(saved.order, [longId, ' a ', '__proto__', '../outside'])
    assert.deepEqual(fs.readdirSync(f.dir), ['channel-display-order.json'])
})

test('GET reconciles deleted, duplicate and new IDs without changing stored content or revision', async t => {
    const f = fixture(t, ['a', 'b', 'new', 'new'])
    const stored = JSON.stringify({ order: ['b', 'deleted', 'b', 'a'], revision: 'saved-revision' })
    fs.writeFileSync(f.filePath, stored)
    const request = await serve(t, f.options)
    assert.deepEqual(assertOk(await request()), { order: ['b', 'a', 'new'], revision: 'saved-revision' })
    f.state.ids = []
    assert.deepEqual(assertOk(await request()), { order: [], revision: 'saved-revision' })
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), stored)
})

test('empty channel set can be persisted and later gains newly created IDs on read only', async t => {
    const f = fixture(t, [])
    const request = await serve(t, f.options)
    const saved = assertOk(await request('PUT', { order: [], revision: null }))
    assert.deepEqual(saved.order, [])
    f.state.ids = ['new']
    assert.deepEqual(assertOk(await request()), { order: ['new'], revision: saved.revision })
    assert.deepEqual(JSON.parse(fs.readFileSync(f.filePath, 'utf8')), saved)
})

test('malformed or schema-invalid existing files return 500 and are never replaced', async t => {
    const f = fixture(t)
    const request = await serve(t, f.options)
    const corrupt = [
        '{broken',
        'null',
        '[]',
        '{}',
        JSON.stringify({ order: null, revision: 'r' }),
        JSON.stringify({ order: ['a'], revision: null }),
        JSON.stringify({ order: ['a'], revision: 1 }),
        JSON.stringify({ order: ['a'] }),
        JSON.stringify({ order: [''], revision: 'r' }),
        JSON.stringify({ order: ['x'.repeat(257)], revision: 'r' }),
        JSON.stringify({ order: Array(10001).fill('a'), revision: 'r' })
    ]
    for (const stored of corrupt) {
        fs.writeFileSync(f.filePath, stored)
        assertFailure(await request(), 500)
        assertFailure(await request('PUT', { order: ['a'], revision: null }), 500)
        assert.equal(fs.readFileSync(f.filePath, 'utf8'), stored)
        assert.deepEqual(fs.readdirSync(f.dir), ['channel-display-order.json'])
    }
})

test('read errors are not mistaken for a missing file', async t => {
    const f = fixture(t)
    fs.mkdirSync(f.filePath)
    const request = await serve(t, f.options)
    assertFailure(await request(), 500)
    assertFailure(await request('PUT', { order: ['a'], revision: null }), 500)
    assert.ok(fs.statSync(f.filePath).isDirectory())
})

test('channel lookup errors fail without creating or overwriting the file', async t => {
    const f = fixture(t)
    const request = await serve(t, {
        ...f.options,
        getChannelIds: async () => {
            throw new Error('lookup failed')
        }
    })
    assertFailure(await request(), 500)
    assertFailure(await request('PUT', { order: ['a'], revision: null }), 500)
    assert.equal(fs.existsSync(f.filePath), false)
})

test('missing parent directory is a write failure, not a false success', async t => {
    const f = fixture(t)
    const request = await serve(t, { ...f.options, getFilePath: () => path.join(f.dir, 'missing', 'order.json') })
    assertFailure(await request('PUT', { order: ['a'], revision: null }), 500)
    assert.deepEqual(fs.readdirSync(f.dir), [])
})

test('atomic rename failure preserves old content and cleans the temporary file', async t => {
    const f = fixture(t)
    const request = await serve(t, f.options)
    const saved = assertOk(await request('PUT', { order: ['a'], revision: null }))
    const original = fs.readFileSync(f.filePath, 'utf8')
    const rename = fs.renameSync
    fs.renameSync = () => {
        throw Object.assign(new Error('test rename denied'), { code: 'EACCES' })
    }
    try {
        assertFailure(await request('PUT', { order: ['b'], revision: saved.revision }), 500)
    } finally {
        fs.renameSync = rename
    }
    assert.equal(fs.readFileSync(f.filePath, 'utf8'), original)
    assert.deepEqual(fs.readdirSync(f.dir), ['channel-display-order.json'])
})

test('partial temporary write failure cleans up and never reports success', async t => {
    const f = fixture(t)
    const request = await serve(t, f.options)
    const write = fs.writeFileSync
    fs.writeFileSync = (target, content, options) => {
        write(target, 'partial', options)
        throw Object.assign(new Error('test disk full'), { code: 'ENOSPC' })
    }
    try {
        assertFailure(await request('PUT', { order: ['b'], revision: null }), 500)
    } finally {
        fs.writeFileSync = write
    }
    assert.deepEqual(fs.readdirSync(f.dir), [])
})

test('display order writes cannot alter channel objects, priority or configuration files', async t => {
    const channels = Object.freeze([
        Object.freeze({ id: 'a', priority: 9, name: 'A' }),
        Object.freeze({ id: 'b', priority: 1, name: 'B' })
    ])
    const f = fixture(t)
    const configPath = path.join(f.dir, 'config.yaml')
    const configText = 'channels:\n  - id: a\n    priority: 9\n  - id: b\n    priority: 1\n'
    fs.writeFileSync(configPath, configText)
    const request = await serve(t, { ...f.options, getChannelIds: async () => channels.map(channel => channel.id) })
    assert.deepEqual(assertOk(await request('PUT', { order: ['b', 'a'], revision: null })).order, ['b', 'a'])
    assert.deepEqual(
        channels.map(channel => channel.priority),
        [9, 1]
    )
    assert.equal(fs.readFileSync(configPath, 'utf8'), configText)
    assert.deepEqual(fs.readdirSync(f.dir).sort(), ['channel-display-order.json', 'config.yaml'])
})

test('global ETag middleware never short-circuits no-store reads or outer authentication', async t => {
    const f = fixture(t)
    let lookups = 0
    const request = await serve(
        t,
        {
            ...f.options,
            getChannelIds: async () => {
                lookups++
                return f.state.ids
            }
        },
        { cache: true, auth: true }
    )
    assert.equal((await request()).status, 401)
    assert.equal((await request('PUT', { order: ['a'], revision: null })).status, 401)
    assert.equal(lookups, 0)
    const first = await request('GET', undefined, { 'x-test-auth': 'yes' })
    assertOk(first)
    const headers = { 'x-test-auth': 'yes', 'if-none-match': first.headers.get('etag') || 'W/"unused"' }
    assert.deepEqual(assertOk(await request('GET', undefined, headers)), { order: null, revision: null })
    assert.equal(lookups, 2, 'no-store must reach the handler even for an unchanged body')
    fs.writeFileSync(f.filePath, JSON.stringify({ order: ['b'], revision: 'other-session' }))
    assert.deepEqual(assertOk(await request('GET', undefined, headers)), {
        order: ['b', 'a', 'c'],
        revision: 'other-session'
    })
    assert.equal(
        (await request('GET', undefined, { 'if-none-match': first.headers.get('etag') || 'W/"unused"' })).status,
        401
    )
})
