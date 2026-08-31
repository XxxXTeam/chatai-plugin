import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, test } from 'node:test'
import express from 'express'
import config from '../config/config.js'
import { builtinMcpServer } from '../src/mcp/BuiltinMcpServer.js'
import { mcpManager } from '../src/mcp/McpManager.js'
import { encodeMcpHeaderValue } from '../src/mcp/McpProtocol.js'
import mcpServerRoutes from '../src/services/routes/mcpServerRoutes.js'
import { statsService } from '../src/services/stats/StatsService.js'

const API_KEY = 'mcp-route-test-key'
const EXAMPLE_JS_TOOL = 'example_hello'
const EXTERNAL_SERVER = 'mcp-route-test-external'
const EXTERNAL_TOOL = 'mcp_route_external_echo'
const SAFE_TOOL = 'mcp_route_safe_tool'
const DISABLED_TOOL = 'mcp_route_disabled_tool'
const DANGEROUS_TOOL = 'mcp_route_dangerous_tool'
const MASTER_TOOL = 'mcp_route_master_tool'
const MODERN_PROTOCOL_VERSION = '2026-07-28'
const SESSION_PROTOCOL_VERSION = '2025-11-25'

let server
let baseUrl
let originalConfig
let originalGlobalBot
let originalStatsRecorder
let recordedStats = []
const runtimeToolNames = new Set()

/**
 * 发起已鉴权的 MCP HTTP 请求。
 * @param {string} pathname - MCP 根路由下的路径
 * @param {RequestInit} [init] - fetch 参数
 * @returns {Promise<Response>} 原始 HTTP 响应
 */
async function request(pathname, init = {}) {
    return await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${API_KEY}`,
            Accept: 'application/json, text/event-stream',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers
        }
    })
}

/**
 * 通过 Streamable HTTP 调用 JSON-RPC。
 * @param {string} method - JSON-RPC 方法
 * @param {Object} [params] - JSON-RPC 参数
 * @param {number} [id] - 请求标识
 * @returns {Promise<{status: number, headers: Headers, body: Object|null}>} HTTP 与 JSON-RPC 响应
 */
async function rpc(method, params, id = 1) {
    const modernParams = {
        ...(params || {}),
        _meta: {
            ...(params?._meta || {}),
            'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientInfo': { name: 'route-test', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {}
        }
    }
    const response = await request('/', {
        method: 'POST',
        headers: {
            'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
            'Mcp-Method': method,
            ...(method === 'tools/call' || method === 'prompts/get' ? { 'Mcp-Name': params?.name } : {}),
            ...(method === 'resources/read' ? { 'Mcp-Name': params?.uri } : {})
        },
        body: JSON.stringify({ jsonrpc: '2.0', method, params: modernParams, id })
    })
    return {
        status: response.status,
        headers: response.headers,
        body: response.status === 204 ? null : await response.json()
    }
}

/**
 * 注册一个仅用于路由契约测试的 JS 工具。
 * @param {string} name - 工具名称
 * @param {Object} options - 工具定义
 * @param {Object} options.inputSchema - JSON Schema
 * @param {boolean} [options.dangerous] - 是否为危险工具
 * @param {boolean} [options.requireMaster] - 是否仅主人可用
 * @param {(args: Object, context: Object) => Promise<*>} options.run - 执行函数
 * @param {Object} [options.metadata] - MCP 定义可选元数据
 */
function registerRuntimeTool(name, { inputSchema, dangerous = false, requireMaster = false, run, metadata = {} }) {
    const runtimeTool = {
        name,
        description: `${name} route contract test`,
        inputSchema,
        parameters: inputSchema,
        ...metadata,
        dangerous,
        requireMaster,
        run
    }
    builtinMcpServer.jsTools.set(name, runtimeTool)
    mcpManager.registerTool(
        mcpManager.withToolSourceMeta({
            name,
            description: runtimeTool.description,
            inputSchema,
            serverName: 'custom-tools',
            isJsTool: true,
            isCustom: true,
            ...metadata,
            dangerous,
            requireMaster
        })
    )
    runtimeToolNames.add(name)
}

/**
 * 设置单个内置工具配置字段，不触发配置文件写入。
 * @param {string} key - builtinTools 下的字段
 * @param {*} value - 字段值
 */
function setBuiltinConfig(key, value) {
    config.config.builtinTools[key] = value
}

before(async () => {
    originalConfig = config.config
    originalGlobalBot = global.Bot
    originalStatsRecorder = statsService.recordToolCallFull

    config.config = {
        mcp: {
            enabled: false,
            server: { enabled: true, apiKey: API_KEY }
        },
        builtinTools: {
            enabled: true,
            allowDangerous: false,
            dangerousTools: [],
            dangerousToolsExcluded: [],
            disabledTools: [],
            allowedTools: []
        },
        customTools: []
    }
    global.Bot = null
    statsService.recordToolCallFull = async entry => {
        recordedStats.push(entry)
    }

    const app = express()
    app.use('/mcp', mcpServerRoutes)
    await new Promise((resolve, reject) => {
        server = app.listen(0, '127.0.0.1', resolve)
        server.once('error', reject)
    })
    const address = server.address()
    assert.equal(typeof address, 'object')
    baseUrl = `http://127.0.0.1:${address.port}/mcp`

    await mcpManager.init()
})

after(async () => {
    for (const name of runtimeToolNames) {
        const registered = mcpManager.getTool(name)
        if (registered) mcpManager.unregisterTool(name, registered)
        builtinMcpServer.jsTools.delete(name)
    }

    const externalTool = mcpManager.getTool(EXTERNAL_TOOL, { serverName: EXTERNAL_SERVER })
    if (externalTool) mcpManager.unregisterTool(EXTERNAL_TOOL, externalTool)
    mcpManager.servers.delete(EXTERNAL_SERVER)
    builtinMcpServer.stopFileWatcher()

    statsService.recordToolCallFull = originalStatsRecorder
    config.config = originalConfig
    if (originalGlobalBot === undefined) {
        delete global.Bot
    } else {
        global.Bot = originalGlobalBot
    }

    if (server) {
        await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    }
})

test('2026-07-28 Streamable HTTP 使用逐请求元数据且不创建会话', async () => {
    const unauthorized = await fetch(`${baseUrl}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 })
    })
    assert.equal(unauthorized.status, 401)

    const discovered = await rpc('server/discover', {}, 2)
    assert.equal(discovered.status, 200)
    assert.ok(discovered.body.result.supportedVersions.includes(MODERN_PROTOCOL_VERSION))
    assert.ok(discovered.body.result.supportedVersions.includes(SESSION_PROTOCOL_VERSION))
    assert.equal(discovered.body.result.resultType, 'complete')
    assert.equal(discovered.headers.get('mcp-session-id'), null)

    const listed = await rpc('tools/list', {}, 3)
    assert.equal(listed.status, 200)
    assert.equal(listed.body.result.resultType, 'complete')
    assert.equal(listed.body.result._meta['io.modelcontextprotocol/serverInfo'].name, 'chatai-plugin')

    const getResponse = await request('/', {
        headers: { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, Accept: 'text/event-stream' }
    })
    assert.equal(getResponse.status, 405)
    const deleteResponse = await request('/', {
        method: 'DELETE',
        headers: { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION }
    })
    assert.equal(deleteResponse.status, 405)
})

test('MCP 鉴权方案大小写不敏感且拒绝 Host userinfo/异常端口', async () => {
    const modernBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 'auth-case',
        method: 'ping',
        params: {
            _meta: {
                'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
                'io.modelcontextprotocol/clientCapabilities': {}
            }
        }
    })
    const lowerCaseBearer = await request('/', {
        method: 'POST',
        headers: {
            Authorization: `bearer ${API_KEY}`,
            'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
            'Mcp-Method': 'ping'
        },
        body: modernBody
    })
    assert.equal(lowerCaseBearer.status, 200)

    for (const host of ['attacker@localhost', 'localhost:0', 'localhost:65536', 'localhost?redirect=1']) {
        const response = await request('/', {
            method: 'POST',
            headers: { Host: host },
            body: modernBody
        })
        assert.equal(response.status, 400, host)
    }
})

test('2026-07-28 tools/call 校验 x-mcp-header 与请求体一致', async () => {
    const toolName = 'mcp_route_header_echo'
    let executions = 0
    registerRuntimeTool(toolName, {
        inputSchema: {
            type: 'object',
            properties: { region: { type: 'string', 'x-mcp-header': 'Region' } },
            required: ['region']
        },
        run: async args => {
            executions += 1
            return { content: [{ type: 'text', text: args.region }] }
        }
    })

    const params = {
        name: toolName,
        arguments: { region: '北京' },
        _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientCapabilities': {}
        }
    }
    const makeBody = () => JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params, id: 410 })
    const commonHeaders = {
        'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': toolName
    }

    const valid = await request('/', {
        method: 'POST',
        headers: { ...commonHeaders, 'Mcp-Param-Region': encodeMcpHeaderValue('北京') },
        body: makeBody()
    })
    assert.equal(valid.status, 200)
    assert.equal((await valid.json()).result.content[0].text, '北京')
    assert.equal(executions, 1)

    const mismatch = await request('/', {
        method: 'POST',
        headers: { ...commonHeaders, 'Mcp-Param-Region': encodeMcpHeaderValue('上海') },
        body: makeBody()
    })
    assert.equal(mismatch.status, 400)
    assert.equal((await mismatch.json()).error.code, -32020)
    assert.equal(executions, 1)

    const missing = await request('/', { method: 'POST', headers: commonHeaders, body: makeBody() })
    assert.equal(missing.status, 400)
    assert.equal((await missing.json()).error.code, -32020)
    assert.equal(executions, 1)
})

test('MCP 聚合端暴露 resources 与 prompts 标准接口', async () => {
    const resourceUri = 'memory://route-test/resource'
    const resource = {
        uri: resourceUri,
        name: 'route resource',
        title: 'Route Resource Title',
        description: 'resource contract',
        mimeType: 'text/plain',
        icons: [{ src: 'https://example.invalid/resource.svg' }],
        annotations: { audience: ['assistant'], priority: 0.8 },
        size: 123,
        _meta: { source: 'route-test' },
        serverName: 'resource-route-test'
    }
    const prompt = {
        name: 'route_prompt',
        title: 'Route Prompt Title',
        description: 'prompt contract',
        arguments: [{ name: 'topic', required: true }],
        icons: [{ src: 'https://example.invalid/prompt.svg' }],
        annotations: { audience: ['user'] },
        _meta: { source: 'route-test' },
        serverName: 'resource-route-test'
    }
    const resourceTemplate = {
        uriTemplate: 'memory://route-test/{id}',
        name: 'route template',
        title: 'Route Template Title',
        description: 'template contract',
        mimeType: 'application/json',
        icons: [{ src: 'https://example.invalid/template.svg' }],
        annotations: { audience: ['assistant'] },
        _meta: { source: 'route-test' },
        serverName: 'resource-route-test'
    }
    mcpManager.resources.set(resourceUri, resource)
    mcpManager.prompts.set(prompt.name, prompt)
    mcpManager.resourceTemplates.set(resourceTemplate.uriTemplate, resourceTemplate)
    mcpManager.servers.set('resource-route-test', {
        status: 'connected',
        config: { type: 'test' },
        resources: [resource],
        resourceTemplates: [resourceTemplate],
        prompts: [prompt],
        tools: [],
        client: {
            async readResource(uri) {
                assert.equal(uri, resourceUri)
                return [{ uri, mimeType: 'text/plain', text: 'resource-ok' }]
            },
            async getPrompt(name, args) {
                assert.equal(name, prompt.name)
                assert.deepEqual(args, { topic: 'graph' })
                return { messages: [{ role: 'user', content: { type: 'text', text: 'prompt-ok' } }] }
            }
        }
    })

    try {
        const listedResources = await rpc('resources/list', {}, 300)
        assert.equal(listedResources.status, 200)
        assert.deepEqual(listedResources.body.result.resources, [
            {
                uri: resourceUri,
                name: resource.name,
                description: resource.description,
                mimeType: resource.mimeType,
                title: resource.title,
                icons: resource.icons,
                annotations: resource.annotations,
                size: resource.size,
                _meta: resource._meta
            }
        ])

        const readResource = await rpc('resources/read', { uri: resourceUri }, 301)
        assert.equal(readResource.status, 200)
        assert.deepEqual(readResource.body.result.contents, [
            { uri: resourceUri, mimeType: 'text/plain', text: 'resource-ok' }
        ])

        const listedPrompts = await rpc('prompts/list', {}, 302)
        assert.equal(listedPrompts.status, 200)
        assert.deepEqual(listedPrompts.body.result.prompts, [
            {
                name: prompt.name,
                description: prompt.description,
                arguments: prompt.arguments,
                title: prompt.title,
                icons: prompt.icons,
                annotations: prompt.annotations,
                _meta: prompt._meta
            }
        ])

        const promptResult = await rpc('prompts/get', { name: prompt.name, arguments: { topic: 'graph' } }, 303)
        assert.equal(promptResult.status, 200)
        assert.deepEqual(promptResult.body.result.messages[0].content, {
            type: 'text',
            text: 'prompt-ok'
        })

        const listedTemplates = await rpc('resources/templates/list', {}, 304)
        assert.equal(listedTemplates.status, 200)
        assert.deepEqual(listedTemplates.body.result.resourceTemplates, [
            {
                uriTemplate: resourceTemplate.uriTemplate,
                name: resourceTemplate.name,
                description: resourceTemplate.description,
                mimeType: resourceTemplate.mimeType,
                title: resourceTemplate.title,
                icons: resourceTemplate.icons,
                annotations: resourceTemplate.annotations,
                _meta: resourceTemplate._meta
            }
        ])
    } finally {
        mcpManager.resources.delete(resourceUri)
        mcpManager.prompts.delete(prompt.name)
        mcpManager.resourceTemplates.delete(resourceTemplate.uriTemplate)
        mcpManager.servers.delete('resource-route-test')
    }
})

test('MCP tools/list 保留标准可选元数据且不泄露运行时字段', async () => {
    const name = 'mcp_route_metadata_tool'
    registerRuntimeTool(name, {
        inputSchema: { type: 'object', properties: {} },
        metadata: {
            title: 'Metadata Tool',
            icons: [{ src: 'https://example.invalid/tool.svg' }],
            outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
            annotations: { readOnlyHint: true },
            _meta: { source: 'route-test' }
        },
        run: async () => ({ content: [{ type: 'text', text: 'ok' }] })
    })

    const listed = await rpc('tools/list', {}, 304)
    const tool = listed.body.result.tools.find(item => item.name === name)
    assert.deepEqual(tool, {
        name,
        description: `${name} route contract test`,
        inputSchema: { type: 'object', properties: {} },
        title: 'Metadata Tool',
        icons: [{ src: 'https://example.invalid/tool.svg' }],
        outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        annotations: { readOnlyHint: true },
        _meta: { source: 'route-test' }
    })
    assert.equal(Object.hasOwn(tool, 'handler'), false)
    assert.equal(Object.hasOwn(tool, 'run'), false)
})

test('现代通知可不携带未定义的元数据头，资源未命中使用标准错误码', async () => {
    const notification = await request('/', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })
    assert.equal(notification.status, 202)
    assert.equal(await notification.text(), '')

    const uri = 'memory://route-test/missing-resource'
    const missing = await rpc('resources/read', { uri }, 304)
    assert.equal(missing.status, 200)
    assert.equal(missing.body.error.code, -32602)
    assert.deepEqual(missing.body.error.data, { uri })
})

test('现代 resources/read 透传 input_required 结果', async () => {
    const resourceUri = 'memory://route-test/input-required'
    const serverName = 'resource-input-route-test'
    const resource = { uri: resourceUri, name: 'input resource', serverName }
    mcpManager.resources.set(resourceUri, resource)
    mcpManager.resourceIdentities.set(`${serverName}:${resourceUri}`, resource)
    mcpManager.servers.set(serverName, {
        status: 'connected',
        config: { type: 'test' },
        resources: [resource],
        prompts: [],
        tools: [],
        client: {
            async readResource() {
                return {
                    resultType: 'input_required',
                    inputRequests: {
                        confirm: { method: 'elicitation/create', params: { message: '继续读取？' } }
                    },
                    requestState: 'resource-state'
                }
            }
        }
    })

    try {
        const response = await rpc('resources/read', { uri: resourceUri }, 305)
        assert.equal(response.status, 200)
        assert.equal(response.body.result.resultType, 'input_required')
        assert.equal(response.body.result.requestState, 'resource-state')
        assert.equal(response.body.result.inputRequests.confirm.method, 'elicitation/create')
    } finally {
        mcpManager.resources.delete(resourceUri)
        mcpManager.resourceIdentities.delete(`${serverName}:${resourceUri}`)
        mcpManager.servers.delete(serverName)
    }
})

test('现代 prompts/get 透传 input_required 并拒绝非对象 arguments', async () => {
    const promptName = 'route_prompt_input_required'
    const serverName = 'prompt-input-route-test'
    const prompt = { name: promptName, description: '需要补充输入', serverName }
    mcpManager.prompts.set(promptName, prompt)
    mcpManager.promptIdentities.set(`${serverName}:${promptName}`, prompt)
    mcpManager.servers.set(serverName, {
        status: 'connected',
        config: { type: 'test' },
        resources: [],
        prompts: [prompt],
        tools: [],
        client: {
            async getPrompt() {
                return {
                    resultType: 'input_required',
                    inputRequests: {
                        topic: { method: 'elicitation/create', params: { message: '请输入主题' } }
                    },
                    requestState: 'prompt-state'
                }
            }
        }
    })

    try {
        const response = await rpc('prompts/get', { name: promptName, arguments: {} }, 306)
        assert.equal(response.status, 200)
        assert.equal(response.body.result.resultType, 'input_required')
        assert.equal(response.body.result.requestState, 'prompt-state')
        assert.equal(response.body.result.inputRequests.topic.method, 'elicitation/create')
        assert.equal(response.body.result.description, prompt.description)

        const invalid = await rpc('prompts/get', { name: promptName, arguments: [] }, 307)
        assert.equal(invalid.status, 200)
        assert.equal(invalid.body.error.code, -32602)
    } finally {
        mcpManager.prompts.delete(promptName)
        mcpManager.promptIdentities.delete(`${serverName}:${promptName}`)
        mcpManager.servers.delete(serverName)
    }
})

test('2026-07-28 拒绝 Origin、版本、方法与名称镜像不一致', async () => {
    const params = {
        name: 'not-called',
        arguments: {},
        _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientCapabilities': {}
        }
    }
    const body = JSON.stringify({ jsonrpc: '2.0', id: 30, method: 'tools/call', params })

    const badOrigin = await request('/', {
        method: 'POST',
        headers: {
            Origin: 'https://untrusted.invalid',
            'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
            'Mcp-Method': 'tools/call',
            'Mcp-Name': 'not-called'
        },
        body
    })
    assert.equal(badOrigin.status, 403)

    const rebindingOrigin = await request('/', {
        method: 'POST',
        headers: {
            Host: 'untrusted.invalid',
            Origin: 'http://untrusted.invalid',
            'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
            'Mcp-Method': 'tools/call',
            'Mcp-Name': 'not-called'
        },
        body
    })
    assert.equal(rebindingOrigin.status, 403)

    const trustedOrigin = await request('/', {
        method: 'POST',
        headers: {
            Origin: new URL(baseUrl).origin,
            'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
            'Mcp-Method': 'tools/list'
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 302,
            method: 'tools/list',
            params: {
                _meta: {
                    'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
                    'io.modelcontextprotocol/clientCapabilities': {}
                }
            }
        })
    })
    assert.equal(trustedOrigin.status, 200)

    const missingMethod = await request('/', {
        method: 'POST',
        headers: { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Name': 'not-called' },
        body
    })
    assert.equal(missingMethod.status, 400)
    assert.equal((await missingMethod.json()).error.code, -32020)

    const wrongName = await request('/', {
        method: 'POST',
        headers: {
            'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
            'Mcp-Method': 'tools/call',
            'Mcp-Name': 'different-name'
        },
        body
    })
    assert.equal(wrongName.status, 400)
    assert.equal((await wrongName.json()).error.code, -32020)

    for (const [method, params, nameHeader] of [
        ['resources/read', { uri: 'file:///expected.json' }, 'file:///different.json'],
        ['prompts/get', { name: 'expected_prompt' }, 'different_prompt']
    ]) {
        const mismatchedName = await request('/', {
            method: 'POST',
            headers: {
                'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
                'Mcp-Method': method,
                'Mcp-Name': nameHeader
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 303,
                method,
                params: {
                    ...params,
                    _meta: {
                        'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
                        'io.modelcontextprotocol/clientCapabilities': {}
                    }
                }
            })
        })
        assert.equal(mismatchedName.status, 400)
        assert.equal((await mismatchedName.json()).error.code, -32020)
    }

    const unsupportedBody = JSON.stringify({
        jsonrpc: '2.0',
        id: 31,
        method: 'tools/list',
        params: {
            _meta: {
                'io.modelcontextprotocol/protocolVersion': '1900-01-01',
                'io.modelcontextprotocol/clientCapabilities': {}
            }
        }
    })
    const unsupported = await request('/', {
        method: 'POST',
        headers: { 'MCP-Protocol-Version': '1900-01-01', 'Mcp-Method': 'tools/list' },
        body: unsupportedBody
    })
    assert.equal(unsupported.status, 400)
    const unsupportedError = (await unsupported.json()).error
    assert.equal(unsupportedError.code, -32022)
    assert.ok(unsupportedError.data.supported.includes(MODERN_PROTOCOL_VERSION))
})

test('2025-11-25 Streamable HTTP 完成 initialize、notification、GET 与 DELETE 生命周期', async () => {
    const initialized = await request('/', {
        method: 'POST',
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 20,
            method: 'initialize',
            params: {
                protocolVersion: SESSION_PROTOCOL_VERSION,
                capabilities: {},
                clientInfo: { name: 'route-test', version: '1.0.0' }
            }
        })
    })
    assert.equal(initialized.status, 200)
    const initializeBody = await initialized.json()
    assert.equal(initializeBody.result.protocolVersion, SESSION_PROTOCOL_VERSION)
    const sessionId = initialized.headers.get('mcp-session-id')
    assert.ok(sessionId)

    const sessionHeaders = {
        'Mcp-Session-Id': sessionId,
        'MCP-Protocol-Version': SESSION_PROTOCOL_VERSION
    }
    const missingVersion = await request('/', {
        method: 'POST',
        headers: { 'Mcp-Session-Id': sessionId },
        body: JSON.stringify({ jsonrpc: '2.0', id: 201, method: 'tools/list', params: {} })
    })
    assert.equal(missingVersion.status, 400)
    const wrongVersion = await request('/', {
        method: 'POST',
        headers: { 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 202, method: 'tools/list', params: {} })
    })
    assert.equal(wrongVersion.status, 400)

    const notification = await request('/', {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })
    assert.equal(notification.status, 202)
    assert.equal(await notification.text(), '')

    const genericNotification = await request('/', {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progress: 1 } })
    })
    assert.equal(genericNotification.status, 202)
    assert.equal(await genericNotification.text(), '')

    const listed = await request('/', {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} })
    })
    assert.equal(listed.status, 200)
    assert.ok(Array.isArray((await listed.json()).result.tools))

    const missingSession = await request('/', {
        method: 'POST',
        headers: { 'MCP-Protocol-Version': SESSION_PROTOCOL_VERSION },
        body: JSON.stringify({ jsonrpc: '2.0', id: 22, method: 'tools/list', params: {} })
    })
    assert.equal(missingSession.status, 400)

    const streamAbort = new AbortController()
    const stream = await request('/', {
        headers: { ...sessionHeaders, Accept: 'text/event-stream' },
        signal: streamAbort.signal
    })
    assert.equal(stream.status, 200)
    const streamReader = stream.body.getReader()
    assert.match(new TextDecoder().decode((await streamReader.read()).value), /: connected/)
    streamAbort.abort()
    await streamReader.cancel().catch(() => {})

    const deleted = await request('/', { method: 'DELETE', headers: sessionHeaders })
    assert.equal(deleted.status, 204)
    const afterDelete = await request('/', {
        method: 'POST',
        headers: sessionHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 23, method: 'tools/list', params: {} })
    })
    assert.equal(afterDelete.status, 404)
})

test('会话注册表达到容量后淘汰最旧会话且保持上限', async () => {
    const sessionIds = []
    for (let index = 0; index < 260; index += 1) {
        const response = await request('/', {
            method: 'POST',
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1000 + index,
                method: 'initialize',
                params: {
                    protocolVersion: SESSION_PROTOCOL_VERSION,
                    capabilities: {},
                    clientInfo: { name: 'capacity-test', version: '1.0.0' }
                }
            })
        })
        assert.equal(response.status, 200)
        sessionIds.push(response.headers.get('mcp-session-id'))
        await response.arrayBuffer()
    }

    const statusResponse = await request('/status')
    assert.equal(statusResponse.status, 200)
    const status = await statusResponse.json()
    assert.equal(status.activeSessions, status.maxSessions)
    assert.equal(status.maxSessions, 256)

    for (const sessionId of sessionIds) {
        const response = await request('/', {
            method: 'DELETE',
            headers: {
                'Mcp-Session-Id': sessionId,
                'MCP-Protocol-Version': SESSION_PROTOCOL_VERSION
            }
        })
        assert.ok([204, 404].includes(response.status))
    }
})

test('SSE 端点和消息回传保持标准事件契约', async () => {
    const abortController = new AbortController()
    const response = await request('/sse', { signal: abortController.signal })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /^text\/event-stream/)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const endpointChunk = decoder.decode((await reader.read()).value)
    assert.match(endpointChunk, /event: endpoint/)
    const endpoint = endpointChunk.match(/data: (\/mcp\/message\?sessionId=[^\n]+)/)?.[1]
    assert.ok(endpoint)

    const postLegacyMessage = async body =>
        await fetch(`http://127.0.0.1:${new URL(baseUrl).port}${endpoint}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        })

    const initialized = await postLegacyMessage({
        jsonrpc: '2.0',
        id: 40,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'legacy-test', version: '1.0.0' }
        }
    })
    assert.equal(initialized.status, 202)
    assert.equal(await initialized.text(), '')
    const initializeChunk = decoder.decode((await reader.read()).value)
    assert.match(initializeChunk, /"protocolVersion":"2024-11-05"/)

    const notification = await postLegacyMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
    })
    assert.equal(notification.status, 202)
    assert.equal(await notification.text(), '')

    const accepted = await postLegacyMessage({ jsonrpc: '2.0', method: 'ping', id: 4 })
    assert.equal(accepted.status, 202)

    const messageChunk = decoder.decode((await reader.read()).value)
    assert.match(messageChunk, /event: message/)
    assert.match(messageChunk, /"jsonrpc":"2.0"/)
    assert.match(messageChunk, /"id":4/)

    abortController.abort()
    await reader.cancel().catch(() => {})
})

test('路由只读取全局注册表并实时反映 JS 工具重载', async () => {
    const registeredExample = mcpManager.getTool(EXAMPLE_JS_TOOL)
    assert.ok(registeredExample)
    mcpManager.unregisterTool(EXAMPLE_JS_TOOL, registeredExample)

    const beforeReload = await rpc('tools/list', {}, 5)
    assert.equal(beforeReload.status, 200)
    assert.equal(
        beforeReload.body.result.tools.some(tool => tool.name === EXAMPLE_JS_TOOL),
        false
    )

    const previousVersion = mcpManager.toolRegistryVersion
    await mcpManager.reloadJsTools()
    assert.ok(mcpManager.toolRegistryVersion > previousVersion)

    const afterReload = await rpc('tools/list', {}, 6)
    assert.equal(
        afterReload.body.result.tools.some(tool => tool.name === EXAMPLE_JS_TOOL),
        true
    )

    const routeSource = fs.readFileSync(new URL('../src/services/routes/mcpServerRoutes.js', import.meta.url), 'utf8')
    assert.doesNotMatch(routeSource, /new\s+BuiltinMcpServer\s*\(/)
})

test('外部 MCP 工具从全局注册表动态可见并由统一调用链执行', async () => {
    let calls = 0
    let lastCallOptions
    mcpManager.servers.set(EXTERNAL_SERVER, {
        status: 'connected',
        config: { type: 'test' },
        client: {
            callTool: async (name, args, options) => {
                calls += 1
                lastCallOptions = options
                assert.equal(name, EXTERNAL_TOOL)
                return {
                    content: [{ type: 'text', text: `external:${args.value}` }],
                    isError: false
                }
            }
        },
        tools: [],
        resources: [],
        prompts: []
    })
    mcpManager.registerTool(
        mcpManager.withToolSourceMeta({
            name: EXTERNAL_TOOL,
            description: 'external route contract test',
            inputSchema: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value']
            },
            serverName: EXTERNAL_SERVER,
            isMcpTool: true,
            requireMaster: true
        })
    )

    const listed = await rpc('tools/list', {}, 7)
    assert.equal(
        listed.body.result.tools.some(tool => tool.name === EXTERNAL_TOOL),
        true
    )

    const called = await rpc('tools/call', { name: EXTERNAL_TOOL, arguments: { value: 'ok' } }, 8)
    assert.deepEqual(called.body.result.content, [{ type: 'text', text: 'external:ok' }])
    assert.equal(called.body.result.isError, false)
    assert.equal(called.body.result.resultType, 'complete')
    assert.equal(calls, 1)

    const retried = await rpc(
        'tools/call',
        {
            name: EXTERNAL_TOOL,
            arguments: { value: 'ok' },
            inputResponses: { confirm: { action: 'accept', content: { ok: true } } },
            requestState: 'opaque-state'
        },
        80
    )
    assert.equal(retried.status, 200)
    assert.deepEqual(lastCallOptions.inputResponses, {
        confirm: { action: 'accept', content: { ok: true } }
    })
    assert.equal(lastCallOptions.requestState, 'opaque-state')
    assert.equal(calls, 2)

    const nonMaster = await mcpManager.callTool(
        EXTERNAL_TOOL,
        { value: 'blocked' },
        {
            serverName: EXTERNAL_SERVER,
            context: { event: null, isMaster: false }
        }
    )
    assert.equal(nonMaster.isError, true)
    assert.equal(nonMaster.permissionDenied, true)
    assert.equal(calls, 2)

    setBuiltinConfig('disabledTools', [EXTERNAL_TOOL])
    const hidden = await rpc('tools/list', {}, 81)
    assert.equal(
        hidden.body.result.tools.some(tool => tool.name === EXTERNAL_TOOL),
        false
    )

    const disabled = await rpc('tools/call', { name: EXTERNAL_TOOL, arguments: { value: 'blocked' } }, 82)
    assert.equal(disabled.body.result.isError, true)
    assert.equal(disabled.body.result.toolDisabled, true)
    assert.equal(calls, 2)
    setBuiltinConfig('disabledTools', [])
})

test('MRTR 字段可透传到内置 JS 工具标准上下文', async () => {
    let receivedContext
    const name = 'mcp_route_mrtr_context'
    registerRuntimeTool(name, {
        inputSchema: { type: 'object', properties: {} },
        run: async (_args, context) => {
            receivedContext = context
            return { content: [{ type: 'text', text: 'context-ok' }], isError: false }
        }
    })

    const response = await rpc(
        'tools/call',
        {
            name,
            arguments: {},
            inputResponses: { confirm: { action: 'accept', content: { ok: true } } },
            requestState: 'opaque-state'
        },
        83
    )
    assert.equal(response.status, 200)
    assert.deepEqual(receivedContext.inputResponses, {
        confirm: { action: 'accept', content: { ok: true } }
    })
    assert.equal(receivedContext.requestState, 'opaque-state')
})

test('禁用和危险配置同时控制工具可见性与直接调用', async () => {
    let disabledRuns = 0
    let dangerousRuns = 0
    const emptySchema = { type: 'object', properties: {} }
    registerRuntimeTool(DISABLED_TOOL, {
        inputSchema: emptySchema,
        run: async () => {
            disabledRuns += 1
            return 'disabled handler must not run'
        }
    })
    registerRuntimeTool(DANGEROUS_TOOL, {
        inputSchema: emptySchema,
        dangerous: true,
        run: async () => {
            dangerousRuns += 1
            return 'dangerous handler must not run'
        }
    })

    setBuiltinConfig('disabledTools', [DISABLED_TOOL])
    setBuiltinConfig('allowDangerous', false)
    const listed = await rpc('tools/list', {}, 9)
    const listedNames = listed.body.result.tools.map(tool => tool.name)
    assert.equal(listedNames.includes(DISABLED_TOOL), false)
    assert.equal(listedNames.includes(DANGEROUS_TOOL), false)

    const disabled = await rpc('tools/call', { name: DISABLED_TOOL, arguments: {} }, 10)
    assert.equal(disabled.body.result.isError, true)
    assert.equal(disabled.body.result.toolDisabled, true)
    assert.equal(disabledRuns, 0)

    const dangerous = await rpc('tools/call', { name: DANGEROUS_TOOL, arguments: {} }, 11)
    assert.equal(dangerous.body.result.isError, true)
    assert.equal(dangerous.body.result.isDangerousBlocked, true)
    assert.equal(dangerousRuns, 0)

    setBuiltinConfig('disabledTools', [])
    setBuiltinConfig('allowDangerous', true)
    const enabledList = await rpc('tools/list', {}, 12)
    assert.equal(
        enabledList.body.result.tools.some(tool => tool.name === DANGEROUS_TOOL),
        true
    )
})

test('API Key 提供主人权限，但上下文不伪造聊天事件、用户或群聊', async () => {
    let observedContext
    registerRuntimeTool(MASTER_TOOL, {
        inputSchema: { type: 'object', properties: {} },
        requireMaster: true,
        run: async (_args, context) => {
            observedContext = {
                event: context.getEvent(),
                isMaster: context.isMaster(),
                userId: context.userId,
                groupId: context.groupId
            }
            return 'master-ok'
        }
    })

    const called = await rpc('tools/call', { name: MASTER_TOOL, arguments: {} }, 13)
    assert.equal(called.body.result.isError, false)
    assert.equal(called.body.result.content[0].text, 'master-ok')
    assert.deepEqual(observedContext, {
        event: null,
        isMaster: true,
        userId: undefined,
        groupId: undefined
    })
})

test('参数失败、成功和未知工具保持 MCP 标准错误格式并记录统计', async () => {
    let successfulRuns = 0
    registerRuntimeTool(SAFE_TOOL, {
        inputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value']
        },
        run: async args => {
            successfulRuns += 1
            return { success: true, value: args.value }
        }
    })
    recordedStats = []

    const invalid = await rpc('tools/call', { name: SAFE_TOOL, arguments: {} }, 14)
    assert.equal(invalid.body.error, undefined)
    assert.equal(invalid.body.result.isError, true)
    assert.match(invalid.body.result.content[0].text, /缺少必需参数/)
    assert.equal(successfulRuns, 0)

    const malformed = await rpc('tools/call', { name: SAFE_TOOL, arguments: [] }, 140)
    assert.equal(malformed.body.error.code, -32602)
    assert.match(malformed.body.error.message, /arguments must be an object/)
    assert.equal(successfulRuns, 0)

    const success = await rpc('tools/call', { name: SAFE_TOOL, arguments: { value: 'hello' } }, 15)
    assert.equal(success.body.result.isError, false)
    assert.equal(success.body.result.content.length, 1)
    assert.match(success.body.result.content[0].text, /"value": "hello"/)
    assert.equal(successfulRuns, 1)

    const unknown = await rpc('tools/call', { name: 'mcp_route_missing_tool', arguments: {} }, 16)
    assert.equal(unknown.body.error.code, -32602)
    assert.match(unknown.body.error.message, /Tool not found/)

    const safeStats = recordedStats.filter(entry => entry.toolName === SAFE_TOOL)
    assert.equal(safeStats.length, 2)
    assert.deepEqual(
        safeStats.map(entry => entry.success),
        [false, true]
    )
    assert.equal(
        safeStats.every(entry => entry.userId == null && entry.groupId == null),
        true
    )

    const safeLogs = mcpManager.getToolLogs(SAFE_TOOL)
    assert.equal(safeLogs.length, 2)
    assert.equal(
        safeLogs.every(entry => entry.userId == null && entry.groupId == null),
        true
    )
})
