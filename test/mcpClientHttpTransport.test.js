import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { test } from 'node:test'
import { McpClient } from '../src/mcp/McpClient.js'
import { encodeMcpHeaderValue } from '../src/mcp/McpProtocol.js'

const MODERN_PROTOCOL_VERSION = '2026-07-28'
const SESSION_PROTOCOL_VERSION = '2025-11-25'
const SERVER_INFO_META_KEY = 'io.modelcontextprotocol/serverInfo'

async function readJsonBody(request) {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function listen(handler) {
    const server = http.createServer((request, response) => {
        Promise.resolve(handler(request, response)).catch(error => {
            response.statusCode = 500
            response.end(error.stack)
        })
    })
    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', resolve)
        server.once('error', reject)
    })
    const address = server.address()
    assert.equal(typeof address, 'object')
    return {
        server,
        url: `http://127.0.0.1:${address.port}/mcp`,
        close: () => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    }
}

function modernResult(value) {
    return {
        ...value,
        resultType: value.resultType || 'complete',
        _meta: { [SERVER_INFO_META_KEY]: { name: 'mock-modern', version: '1.0.0' } }
    }
}

test('HTTP 客户端首选 2026-07-28、只发现一次并增量读取分块 SSE', async () => {
    const requests = []
    const mock = await listen(async (request, response) => {
        assert.equal(request.method, 'POST')
        const body = await readJsonBody(request)
        requests.push({ headers: request.headers, body })
        assert.equal(request.headers.accept, 'application/json, text/event-stream')
        assert.equal(request.headers['mcp-protocol-version'], MODERN_PROTOCOL_VERSION)
        assert.equal(request.headers['mcp-method'], body.method)
        assert.equal(body.params._meta['io.modelcontextprotocol/protocolVersion'], MODERN_PROTOCOL_VERSION)
        assert.deepEqual(body.params._meta['io.modelcontextprotocol/clientCapabilities'], {})
        assert.equal(request.headers['mcp-session-id'], undefined)

        if (body.method === 'server/discover') {
            response.setHeader('Content-Type', 'application/json')
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: modernResult({
                        supportedVersions: [MODERN_PROTOCOL_VERSION],
                        capabilities: { tools: {} },
                        ttlMs: 0,
                        cacheScope: 'private'
                    })
                })
            )
            return
        }
        assert.equal(body.method, 'tools/call')
        assert.equal(request.headers['mcp-name'], 'split_echo')
        response.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache'
        })
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: modernResult({ content: [{ type: 'text', text: 'split-ok' }], isError: false })
        })
        const splitAt = Math.floor(payload.length / 2)
        response.write(`event: message\r\ndata: ${payload.slice(0, splitAt)}`)
        setImmediate(() => response.write(`${payload.slice(splitAt)}\r\n\r\n`))
        const keepOpen = setTimeout(() => response.end(), 5000)
        keepOpen.unref?.()
        response.on('close', () => clearTimeout(keepOpen))
    })

    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    await Promise.all([client.connect(), client.connect()])
    assert.equal(requests.filter(item => item.body.method === 'server/discover').length, 1)
    assert.equal(client.httpEra, 'modern')

    const startedAt = Date.now()
    const result = await client.callTool('split_echo', { value: 'ok' })
    assert.equal(result.content[0].text, 'split-ok')
    assert.ok(Date.now() - startedAt < 1000)

    await client.disconnect()
    assert.equal(
        requests.some(item => item.body.method === 'initialize'),
        false
    )
    await mock.close()
})

test('现代 HTTP tools/list 过滤非法 x-mcp-header，并在 tools/call 镜像参数头', async () => {
    const requests = []
    const mock = await listen(async (request, response) => {
        const body = await readJsonBody(request)
        requests.push({ headers: request.headers, body })
        response.setHeader('Content-Type', 'application/json')
        if (body.method === 'server/discover') {
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: modernResult({ supportedVersions: [MODERN_PROTOCOL_VERSION], capabilities: { tools: {} } })
                })
            )
            return
        }
        if (body.method === 'tools/list') {
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: modernResult({
                        tools: [
                            {
                                name: 'header_echo',
                                description: 'valid',
                                inputSchema: {
                                    type: 'object',
                                    properties: { region: { type: 'string', 'x-mcp-header': 'Region' } }
                                }
                            },
                            {
                                name: 'invalid_header_tool',
                                description: 'invalid',
                                inputSchema: {
                                    type: 'object',
                                    properties: { value: { type: 'number', 'x-mcp-header': 'Value' } }
                                }
                            }
                        ]
                    })
                })
            )
            return
        }
        assert.equal(body.method, 'tools/call')
        assert.equal(request.headers['mcp-param-region'], encodeMcpHeaderValue('北京'))
        assert.equal(body.params.arguments.region, '北京')
        response.end(
            JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: modernResult({ content: [{ type: 'text', text: 'header-ok' }] })
            })
        )
    })

    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    try {
        await client.connect()
        const tools = await client.listTools()
        assert.deepEqual(
            tools.map(tool => tool.name),
            ['header_echo']
        )
        const result = await client.callTool('header_echo', { region: '北京' })
        assert.equal(result.content[0].text, 'header-ok')
        assert.equal(requests.filter(item => item.body.method === 'tools/call').length, 1)
    } finally {
        await client.disconnect()
        await mock.close()
    }
})

test('HTTP 客户端完整读取带 nextCursor 的多页工具列表', async () => {
    let listPage = 0
    const mock = await listen(async (request, response) => {
        const body = await readJsonBody(request)
        response.setHeader('Content-Type', 'application/json')
        if (body.method === 'server/discover') {
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: modernResult({
                        supportedVersions: [MODERN_PROTOCOL_VERSION],
                        capabilities: { tools: {} }
                    })
                })
            )
            return
        }
        assert.equal(body.method, 'tools/list')
        listPage += 1
        if (listPage === 1) {
            assert.equal(body.params.cursor, undefined)
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: modernResult({ tools: [{ name: 'page_one' }], nextCursor: 'page-two' })
                })
            )
            return
        }
        assert.equal(body.params.cursor, 'page-two')
        response.end(
            JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: modernResult({ tools: [{ name: 'page_two' }] })
            })
        )
    })

    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    await client.connect()
    const tools = await client.listTools()
    assert.deepEqual(
        tools.map(tool => tool.name),
        ['page_one', 'page_two']
    )
    assert.equal(listPage, 2)
    await client.disconnect()
    await mock.close()
})

test('HTTP 客户端在现代与会话探测均失败时回退旧版 HTTP+SSE', async () => {
    const requests = []
    const sessionId = 'legacy-fallback-session'
    let sseResponse
    const mock = await listen(async (request, response) => {
        if (request.method === 'GET') {
            assert.equal(request.url, '/mcp')
            sseResponse = response
            response.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache'
            })
            response.write(`event: endpoint\ndata: /message?sessionId=${sessionId}\n\n`)
            request.on('close', () => {
                if (!response.writableEnded) response.end()
            })
            return
        }

        const body = await readJsonBody(request)
        requests.push({ method: request.method, url: request.url, body })
        // 旧 HTTP+SSE 端点不接受直接 POST /sse。
        if (request.url === '/mcp') {
            response.statusCode = 405
            response.end()
            return
        }

        assert.equal(request.url, `/message?sessionId=${sessionId}`)
        response.statusCode = 202
        response.end()
        if (body.method === 'notifications/initialized') return

        const result =
            body.method === 'initialize'
                ? {
                      protocolVersion: '2024-11-05',
                      capabilities: { tools: {} },
                      serverInfo: { name: 'legacy-fallback', version: '1.0.0' }
                  }
                : { tools: [] }
        sseResponse.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`)
    })

    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000, sseConnect: 1000, sseEndpoint: 100 }
    })
    await client.connect()
    assert.equal(client.type, 'sse')
    assert.equal(client.httpEra, 'legacy-sse')
    assert.deepEqual(await client.listTools(), [])
    assert.deepEqual(
        requests.map(item => item.body.method),
        ['server/discover', 'initialize', 'initialize', 'notifications/initialized', 'tools/list']
    )

    await client.disconnect()
    assert.ok(sseResponse)
    await mock.close()
})

test('现代 HTTP 客户端透传 input_required 与不透明 requestState', async () => {
    let callCount = 0
    const mock = await listen(async (request, response) => {
        const body = await readJsonBody(request)
        response.setHeader('Content-Type', 'application/json')
        const result =
            body.method === 'server/discover'
                ? modernResult({ supportedVersions: [MODERN_PROTOCOL_VERSION], capabilities: { tools: {} } })
                : callCount++ === 0
                  ? modernResult({
                        resultType: 'input_required',
                        inputRequests: {
                            confirm: {
                                method: 'elicitation/create',
                                params: { message: 'confirm?' }
                            }
                        },
                        requestState: 'opaque-state'
                    })
                  : modernResult({ content: [{ type: 'text', text: 'completed' }], isError: false })
        if (body.method === 'tools/call' && callCount > 1) {
            assert.deepEqual(body.params.inputResponses, {
                confirm: { action: 'accept', content: { ok: true } }
            })
            assert.equal(body.params.requestState, 'opaque-state')
        }
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
    })

    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    await client.connect()
    const result = await client.callTool('needs_input', {})
    assert.equal(result.resultType, 'input_required')
    assert.equal(result.inputRequests.confirm.method, 'elicitation/create')
    assert.equal(result.requestState, 'opaque-state')
    const completed = await client.callTool(
        'needs_input',
        {},
        {
            inputResponses: { confirm: { action: 'accept', content: { ok: true } } },
            requestState: result.requestState
        }
    )
    assert.equal(completed.resultType, 'complete')
    await client.disconnect()
    await mock.close()
})

test('现代 HTTP 客户端保留资源 input_required，并归一化提示词参数', async () => {
    const mock = await listen(async (request, response) => {
        const body = await readJsonBody(request)
        response.setHeader('Content-Type', 'application/json')
        let result
        if (body.method === 'server/discover') {
            result = modernResult({
                supportedVersions: [MODERN_PROTOCOL_VERSION],
                capabilities: { resources: {}, prompts: {} }
            })
        } else if (body.method === 'resources/read') {
            result = modernResult({
                resultType: 'input_required',
                inputRequests: {
                    confirm: { method: 'elicitation/create', params: { message: '继续读取？' } }
                },
                requestState: 'resource-state'
            })
        } else {
            assert.equal(body.method, 'prompts/get')
            assert.deepEqual(body.params.arguments, {})
            result = modernResult({ messages: [] })
        }
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
    })

    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    try {
        await client.connect()
        const resource = await client.readResource('memory://needs-input')
        assert.equal(resource.resultType, 'input_required')
        assert.equal(resource.requestState, 'resource-state')
        assert.equal(resource.inputRequests.confirm.method, 'elicitation/create')
        const prompt = await client.getPrompt('empty-arguments', ['invalid-shape'])
        assert.equal(prompt.resultType, 'complete')
        assert.deepEqual(prompt.messages, [])
    } finally {
        await client.disconnect()
        await mock.close()
    }
})

test('HTTP 客户端分页读取 resources/templates/list', async () => {
    let page = 0
    const mock = await listen(async (request, response) => {
        const body = await readJsonBody(request)
        response.setHeader('Content-Type', 'application/json')
        if (body.method === 'server/discover') {
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: modernResult({
                        supportedVersions: [MODERN_PROTOCOL_VERSION],
                        capabilities: { resources: {} }
                    })
                })
            )
            return
        }
        assert.equal(body.method, 'resources/templates/list')
        page += 1
        const result =
            page === 1
                ? modernResult({
                      resourceTemplates: [
                          {
                              uriTemplate: 'memory://one/{id}',
                              name: 'one',
                              title: 'One'
                          }
                      ],
                      nextCursor: 'next'
                  })
                : modernResult({
                      resourceTemplates: [
                          {
                              uriTemplate: 'memory://two/{id}',
                              name: 'two'
                          }
                      ]
                  })
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
    })
    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    try {
        await client.connect()
        assert.deepEqual(await client.listResourceTemplates(), [
            { uriTemplate: 'memory://one/{id}', name: 'one', title: 'One' },
            { uriTemplate: 'memory://two/{id}', name: 'two' }
        ])
        assert.equal(page, 2)
    } finally {
        await client.disconnect()
        await mock.close()
    }
})

test('HTTP 客户端回退 2025-11-25，会话通知无 id 且断开时 DELETE', async () => {
    const messages = []
    let deleteCount = 0
    const sessionId = 'mock-session-id'
    const mock = await listen(async (request, response) => {
        if (request.method === 'DELETE') {
            deleteCount += 1
            assert.equal(request.headers['mcp-session-id'], sessionId)
            assert.equal(request.headers['mcp-protocol-version'], SESSION_PROTOCOL_VERSION)
            response.statusCode = 204
            response.end()
            return
        }

        const body = await readJsonBody(request)
        messages.push({ headers: request.headers, body })
        if (body.method === 'server/discover') {
            response.statusCode = 400
            response.setHeader('Content-Type', 'text/plain')
            response.end('legacy server')
            return
        }
        if (body.method === 'initialize') {
            assert.equal(request.headers['mcp-session-id'], undefined)
            assert.equal(request.headers['mcp-protocol-version'], undefined)
            response.setHeader('Mcp-Session-Id', sessionId)
            response.setHeader('Content-Type', 'application/json')
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        protocolVersion: SESSION_PROTOCOL_VERSION,
                        capabilities: { tools: { listChanged: false } },
                        serverInfo: { name: 'mock-session', version: '1.0.0' }
                    }
                })
            )
            return
        }

        assert.equal(request.headers['mcp-session-id'], sessionId)
        assert.equal(request.headers['mcp-protocol-version'], SESSION_PROTOCOL_VERSION)
        if (body.method === 'notifications/initialized') {
            assert.equal(Object.hasOwn(body, 'id'), false)
            response.statusCode = 202
            response.end()
            return
        }
        assert.equal(body.method, 'tools/list')
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }))
    })

    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    await Promise.all([client.connect(), client.connect()])
    assert.equal(messages.filter(item => item.body.method === 'server/discover').length, 1)
    assert.equal(messages.filter(item => item.body.method === 'initialize').length, 1)
    assert.equal(messages.filter(item => item.body.method === 'notifications/initialized').length, 1)
    assert.equal(client.httpEra, 'session')
    assert.deepEqual(await client.listTools(), [])

    await client.disconnect()
    assert.equal(deleteCount, 1)
    await mock.close()
})

test('2025 会话收到 404 后重新初始化并只重试原请求一次', async () => {
    let initializeCount = 0
    let listCount = 0
    let currentSessionId = ''
    const mock = await listen(async (request, response) => {
        if (request.method === 'DELETE') {
            response.statusCode = 204
            response.end()
            return
        }
        const body = await readJsonBody(request)
        if (body.method === 'initialize') {
            initializeCount += 1
            currentSessionId = `session-${initializeCount}`
            response.setHeader('Mcp-Session-Id', currentSessionId)
            response.setHeader('Content-Type', 'application/json')
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        protocolVersion: SESSION_PROTOCOL_VERSION,
                        capabilities: { tools: {} },
                        serverInfo: { name: 'retry-server', version: '1.0.0' }
                    }
                })
            )
            return
        }
        assert.equal(request.headers['mcp-session-id'], currentSessionId)
        if (body.method === 'notifications/initialized') {
            response.statusCode = 202
            response.end()
            return
        }
        listCount += 1
        if (listCount === 1) {
            response.statusCode = 404
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'expired' } }))
            return
        }
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools: [] } }))
    })

    const client = new McpClient({
        type: 'streamable-http',
        protocolVersion: SESSION_PROTOCOL_VERSION,
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000, terminate: 500 }
    })
    await client.connect()
    assert.deepEqual(await client.listTools(), [])
    assert.equal(initializeCount, 2)
    assert.equal(listCount, 2)
    await client.disconnect()
    await mock.close()
})

test('MCP 服务路由的会话清理 timer 不阻止 Node 自然退出', async () => {
    const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', "await import('./src/services/routes/mcpServerRoutes.js')"],
        {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe']
        }
    )
    const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error('导入 MCP 路由后进程未自然退出'))
        }, 3000)
        child.once('error', reject)
        child.once('exit', (code, signal) => {
            clearTimeout(timer)
            resolve({ code, signal })
        })
    })
    assert.deepEqual(result, { code: 0, signal: null })
})

test('HTTP JSON 响应必须回显请求 id 与 JSON-RPC 版本', async () => {
    const mock = await listen(async (request, response) => {
        const body = await readJsonBody(request)
        response.setHeader('Content-Type', 'application/json')
        if (body.method === 'server/discover') {
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: {
                        resultType: 'complete',
                        supportedVersions: [MODERN_PROTOCOL_VERSION],
                        capabilities: { tools: {} }
                    }
                })
            )
            return
        }
        response.end(JSON.stringify({ jsonrpc: '2.0', id: 'wrong-id', result: { tools: [] } }))
    })
    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    try {
        await client.connect()
        await assert.rejects(client.request('tools/list', {}), /Invalid JSON-RPC response id or version/)
    } finally {
        await client.disconnect()
        await mock.close()
    }
})

test('HTTP SSE 响应必须使用 JSON-RPC 2.0 并包含 result 或 error', async () => {
    let invalidMode = 'version'
    const mock = await listen(async (request, response) => {
        const body = await readJsonBody(request)
        if (body.method === 'server/discover') {
            response.setHeader('Content-Type', 'application/json')
            response.end(
                JSON.stringify({
                    jsonrpc: '2.0',
                    id: body.id,
                    result: modernResult({
                        supportedVersions: [MODERN_PROTOCOL_VERSION],
                        capabilities: { tools: {} }
                    })
                })
            )
            return
        }
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const payload =
            invalidMode === 'version'
                ? { jsonrpc: '1.0', id: body.id, result: { tools: [] } }
                : { jsonrpc: '2.0', id: body.id }
        response.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
    })
    const client = new McpClient({
        type: 'streamable-http',
        url: mock.url,
        autoReconnect: false,
        timeouts: { connect: 2000, request: 2000 }
    })
    try {
        await client.connect()
        await assert.rejects(client.request('tools/list', {}), /Invalid SSE JSON-RPC response version/)
        invalidMode = 'missing-result'
        await assert.rejects(client.request('tools/list', {}), /result or error is required/)
    } finally {
        await client.disconnect()
        await mock.close()
    }
})
