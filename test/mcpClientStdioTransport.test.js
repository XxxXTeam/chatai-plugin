import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { McpClient } from '../src/mcp/McpClient.js'

const MODERN_PROTOCOL_VERSION = '2026-07-28'
const LEGACY_PROTOCOL_VERSION = '2025-11-25'

const SERVER_SOURCE = String.raw`
const fs = require('node:fs')
const readline = require('node:readline')

const mode = process.env.MCP_TEST_MODE || 'legacy'
const logPath = process.env.MCP_TEST_LOG
let discoverCount = 0

function record(request) {
    fs.appendFileSync(logPath, JSON.stringify({ pid: process.pid, id: request.id, method: request.method, params: request.params }) + '\n')
}

function respond(request, payload) {
    const output = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...payload }) + '\n')
    if ((mode === 'utf8-split' || mode === 'modern-utf8-split') && output.includes(Buffer.from('中文'))) {
        const splitAt = output.indexOf(Buffer.from('中')) + 1
        process.stdout.write(output.subarray(0, splitAt))
        setTimeout(() => process.stdout.write(output.subarray(splitAt)), 25)
        return
    }
    process.stdout.write(output)
}

const input = readline.createInterface({ input: process.stdin })
input.on('line', line => {
    let request
    try {
        request = JSON.parse(line)
    } catch {
        return
    }
    record(request)
    if (request.method === 'server/discover') {
        if (mode === 'modern' || mode === 'modern-utf8-split') {
            respond(request, {
                result: {
                    resultType: 'complete',
                    supportedVersions: ['2026-07-28'],
                    capabilities: { tools: {} },
                    instructions: mode === 'modern-utf8-split' ? '中文探测结果' : undefined
                }
            })
        } else if (mode === 'modern-corrective') {
            discoverCount += 1
            if (discoverCount === 1) {
                respond(request, { error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'], requested: '2026-07-28' } } })
            } else {
                respond(request, { result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} } } })
            }
        } else if (mode === 'modern-error') {
            respond(request, { error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2099-01-01'] } } })
        } else if (mode === 'legacy-version-error') {
            respond(request, { error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2025-11-25'] } } })
        } else if (mode !== 'silent') {
            respond(request, { error: { code: -32601, message: 'Method not found' } })
        }
        return
    }
    if (request.method === 'initialize') {
        if (mode === 'modern' || mode === 'modern-error') {
            respond(request, { error: { code: -32601, message: 'initialize not supported' } })
        } else {
            const serverName = mode === 'utf8-split' ? '中文服务器' : 'stdio-test'
            respond(request, { result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: serverName, version: '1' } } })
        }
        return
    }
    if (request.method === 'tools/list') {
        if (mode === 'cancel') return
        respond(request, { result: { tools: [{ name: 'stdio_echo', inputSchema: { type: 'object', properties: {} } }] } })
    }
})
`

function createFixture(mode) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-stdio-era-'))
    const script = path.join(root, 'server.cjs')
    const log = path.join(root, 'requests.ndjson')
    fs.writeFileSync(script, SERVER_SOURCE, { mode: 0o600 })
    fs.writeFileSync(log, '', { mode: 0o600 })
    return {
        root,
        script,
        log,
        env: { MCP_TEST_MODE: mode, MCP_TEST_LOG: log },
        readRequests() {
            const text = fs.readFileSync(log, 'utf8').trim()
            return text ? text.split('\n').map(line => JSON.parse(line)) : []
        }
    }
}

function createClient(fixture, extra = {}) {
    return new McpClient({
        type: 'stdio',
        command: process.execPath,
        args: [fixture.script],
        env: fixture.env,
        autoReconnect: false,
        // 测试文件会与其它测试 worker 并发启动多个 Node 子进程；250/500ms
        // 在 CPU 或 I/O 抢占时会把现代探测误判为 legacy。保留取消测试的
        // 显式短 request 超时，并把正常握手窗口设为可承受并发调度抖动的值。
        timeouts: { connect: 3000, startup: 3000, request: 3000, terminate: 100, heartbeat: 1000 },
        ...extra
    })
}

test('stdio 自动协商现代时代并为每个请求携带 body _meta', async () => {
    const fixture = createFixture('modern')
    const client = createClient(fixture)
    try {
        await client.connect()
        assert.equal(client.stdioEra, 'modern')
        const tools = await client.listTools()
        assert.equal(tools[0].name, 'stdio_echo')
        const requests = fixture.readRequests()
        assert.ok(requests.some(request => request.method === 'server/discover'))
        assert.ok(requests.some(request => request.method === 'tools/list'))
        for (const request of requests) {
            assert.equal(request.params?._meta?.['io.modelcontextprotocol/protocolVersion'], MODERN_PROTOCOL_VERSION)
        }
        assert.equal(
            requests.some(request => request.method === 'initialize'),
            false
        )
        assert.ok(new Set(requests.map(request => request.pid)).size >= 2)
    } finally {
        await client.disconnect()
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test('stdio 现代探测跨 UTF-8 字节分块仍可解析 DiscoverResult', async () => {
    const fixture = createFixture('modern-utf8-split')
    const client = createClient(fixture)
    try {
        await client.connect()
        assert.equal(client.stdioEra, 'modern')
        assert.equal(client.initializationResult.instructions, '中文探测结果')
    } finally {
        await client.disconnect()
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test('stdio 自动协商遇到非现代错误时使用独立进程回退 legacy initialize', async () => {
    const fixture = createFixture('legacy')
    const client = createClient(fixture)
    try {
        await client.connect()
        assert.equal(client.stdioEra, 'legacy')
        assert.equal((await client.listTools())[0].name, 'stdio_echo')
        const requests = fixture.readRequests()
        assert.ok(requests.some(request => request.method === 'server/discover'))
        assert.ok(requests.some(request => request.method === 'initialize'))
        assert.equal(
            requests.some(request => request.method === 'initialize' && request.params?._meta),
            false
        )
        assert.ok(new Set(requests.map(request => request.pid)).size >= 2)
    } finally {
        await client.disconnect()
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test('stdio -32022 现代协议错误不会错误回退 legacy', async () => {
    const fixture = createFixture('modern-error')
    const client = createClient(fixture)
    try {
        await assert.rejects(client.connect(), error => error.code === -32022)
        const requests = fixture.readRequests()
        assert.equal(requests.filter(request => request.method === 'server/discover').length, 1)
        assert.equal(
            requests.some(request => request.method === 'initialize'),
            false
        )
    } finally {
        await client.disconnect()
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test('stdio -32022 且存在现代交集时执行一次纠偏重试', async () => {
    const fixture = createFixture('modern-corrective')
    const client = createClient(fixture)
    try {
        await client.connect()
        assert.equal(client.stdioEra, 'modern')
        const discoverRequests = fixture.readRequests().filter(request => request.method === 'server/discover')
        assert.equal(discoverRequests.length, 3)
        assert.equal(
            fixture.readRequests().some(request => request.method === 'initialize'),
            false
        )
    } finally {
        await client.disconnect()
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test('stdio -32022 仅声明 legacy 版本时允许自动回退 initialize', async () => {
    const fixture = createFixture('legacy-version-error')
    const client = createClient(fixture)
    try {
        await client.connect()
        assert.equal(client.stdioEra, 'legacy')
        const requests = fixture.readRequests()
        assert.ok(requests.some(request => request.method === 'initialize'))
    } finally {
        await client.disconnect()
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test('stdio 显式 protocolVersion 保留 pin 语义，不启动探测进程', async () => {
    const modernFixture = createFixture('modern')
    const modernClient = createClient(modernFixture, { protocolVersion: MODERN_PROTOCOL_VERSION })
    const legacyFixture = createFixture('legacy')
    const legacyClient = createClient(legacyFixture, { protocolVersion: LEGACY_PROTOCOL_VERSION })
    try {
        await modernClient.connect()
        await legacyClient.connect()
        assert.equal(new Set(modernFixture.readRequests().map(request => request.pid)).size, 1)
        assert.equal(
            modernFixture.readRequests().some(request => request.method === 'initialize'),
            false
        )
        assert.equal(new Set(legacyFixture.readRequests().map(request => request.pid)).size, 1)
        assert.ok(legacyFixture.readRequests().some(request => request.method === 'initialize'))
    } finally {
        await modernClient.disconnect()
        await legacyClient.disconnect()
        fs.rmSync(modernFixture.root, { recursive: true, force: true })
        fs.rmSync(legacyFixture.root, { recursive: true, force: true })
    }
})

test('stdio 正式输出跨 UTF-8 字节分块时保持中文内容', async () => {
    const fixture = createFixture('utf8-split')
    const client = createClient(fixture, { protocolVersion: LEGACY_PROTOCOL_VERSION })
    try {
        await client.connect()
        assert.equal(client.serverInfo.name, '中文服务器')
    } finally {
        await client.disconnect()
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test('stdio 请求超时发送带原 requestId 的取消通知', async () => {
    const fixture = createFixture('cancel')
    const client = createClient(fixture, { protocolVersion: LEGACY_PROTOCOL_VERSION })
    try {
        await client.connect()
        await assert.rejects(client.request('tools/list', {}, 50), /Request timed out: tools\/list/)
        await new Promise(resolve => setTimeout(resolve, 30))
        const requests = fixture.readRequests()
        const original = requests.find(request => request.method === 'tools/list')
        const cancellation = requests.find(request => request.method === 'notifications/cancelled')
        assert.ok(original?.id)
        assert.equal(cancellation?.params?.requestId, original.id)
    } finally {
        await client.disconnect()
        fs.rmSync(fixture.root, { recursive: true, force: true })
    }
})

test('stdio 响应允许 JSON-RPC 数字 0 与空字符串 request id', async () => {
    const client = new McpClient({ type: 'stdio', autoReconnect: false })
    const resolved = []
    client.pendingRequests.set(0, {
        method: 'ping',
        resolve: value => resolved.push(['zero', value]),
        reject: assert.fail
    })
    client.pendingRequests.set('', {
        method: 'ping',
        resolve: value => resolved.push(['empty', value]),
        reject: assert.fail
    })

    client.handleMessage({ jsonrpc: '2.0', id: 0, result: { ok: true } })
    client.handleMessage({ jsonrpc: '2.0', id: '', result: { ok: true } })

    assert.deepEqual(resolved, [
        ['zero', { ok: true }],
        ['empty', { ok: true }]
    ])
    assert.equal(client.pendingRequests.size, 0)
})

test('stdio 响应必须使用 JSON-RPC 2.0', async () => {
    const client = new McpClient({ type: 'stdio', autoReconnect: false })
    let rejected
    client.pendingRequests.set('invalid-version', {
        method: 'tools/list',
        resolve() {},
        reject(error) {
            rejected = error
        }
    })

    client.handleMessage({ jsonrpc: '1.0', id: 'invalid-version', result: { tools: [] } })
    assert.match(rejected?.message || '', /Invalid stdio JSON-RPC response version/)
    assert.equal(client.pendingRequests.has('invalid-version'), false)
})

test('stdio 探测期间 disconnect 不会在断开后复活正式进程', async () => {
    const fixture = createFixture('silent')
    const client = createClient(fixture, { timeouts: { connect: 1000, startup: 250, request: 500, terminate: 50 } })
    const connecting = client.connect()
    await new Promise(resolve => setTimeout(resolve, 20))
    await client.disconnect()
    await assert.rejects(connecting, error => error.code === 'MCP_CLIENT_CANCELLED')
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(client.process, null)
    assert.equal(client.initialized, false)
    assert.equal(fixture.readRequests().filter(request => request.method === 'initialize').length, 0)
    fs.rmSync(fixture.root, { recursive: true, force: true })
})
