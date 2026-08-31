import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }

const { McpManager, inferMcpServerType, isSelfReferentialMcpUrl, redactMcpConfigForLog } =
    await import('../src/mcp/McpManager.js')

function createSandbox() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-manager-persistence-'))
    return { root, file: path.join(root, 'mcp-servers.json') }
}

function createFakeClientFactory(state) {
    return clientConfig => ({
        async connect() {
            state.connects.push(clientConfig.marker)
            if (clientConfig.failConnect) throw new Error(`connect failed: ${clientConfig.marker}`)
        },
        async listTools() {
            return [
                {
                    name: `tool_${clientConfig.marker}`,
                    description: clientConfig.marker,
                    inputSchema: { type: 'object', properties: {} }
                }
            ]
        },
        async listResources() {
            return []
        },
        async listPrompts() {
            return []
        },
        async disconnect() {
            state.disconnects.push(clientConfig.marker)
        }
    })
}

function createFaultFileSystem(control) {
    return new Proxy(fs, {
        get(target, property) {
            if (property === 'renameSync') {
                return (...args) => {
                    if (control.failRename) throw new Error('injected rename failure')
                    return target.renameSync(...args)
                }
            }
            return target[property]
        }
    })
}

test('MCP 配置日志深度脱敏并保留非敏感结构', () => {
    const redacted = redactMcpConfigForLog({
        type: 'http',
        url: 'https://example.invalid/mcp',
        headers: {
            Authorization: 'Bearer hidden',
            'x-api-key': 'hidden-key',
            Accept: 'application/json'
        },
        env: {
            OPENAI_API_KEY: 'hidden-env',
            NORMAL_FLAG: 'visible'
        },
        nested: { clientSecret: 'hidden-client', retries: 3 }
    })

    assert.equal(redacted.type, 'http')
    assert.equal(redacted.url, 'https://example.invalid/mcp')
    assert.equal(redacted.headers.Accept, 'application/json')
    assert.equal(redacted.env.NORMAL_FLAG, 'visible')
    assert.equal(redacted.nested.retries, 3)
    const text = JSON.stringify(redacted)
    assert.doesNotMatch(text, /Bearer hidden|hidden-key|hidden-env|hidden-client/)
    assert.match(text, /\[REDACTED\]/)
})

test('MCP URL 推断区分旧版 SSE 与 Streamable HTTP 端点', () => {
    const manager = new McpManager()
    assert.equal(manager.inferServerType({ url: 'https://example.invalid/sse' }), 'sse')
    assert.equal(manager.inferServerType({ url: 'https://example.invalid/message?sessionId=x' }), 'sse')
    assert.equal(manager.inferServerType({ url: 'https://example.invalid/mcp' }), 'streamable-http')
    assert.equal(manager.inferServerType({ type: 'http', url: 'https://example.invalid/sse' }), 'http')
    assert.equal(inferMcpServerType({ url: 'https://example.invalid/mcp' }), 'streamable-http')
    assert.equal(isSelfReferentialMcpUrl('http://127.0.0.1:3000/chatai/mcp'), true)
    assert.equal(isSelfReferentialMcpUrl('https://remote.invalid/chatai/mcp'), false)
})

test('显式 npx 类型兼容旧 command/args 配置并保留传输类型', () => {
    const manager = new McpManager()
    assert.deepEqual(
        manager.normalizeServerConfig({
            type: 'npx',
            command: 'npx',
            args: ['-y', '--prefer-offline', '@scope/server', '--root', '/tmp']
        }),
        {
            type: 'npx',
            package: '@scope/server',
            args: ['--root', '/tmp']
        }
    )
    assert.deepEqual(manager.normalizeServerConfig({ command: 'npx.cmd', args: ['--yes', 'plain-server'] }), {
        type: 'npm',
        package: 'plain-server',
        args: []
    })
})

test('自引用 MCP 配置登记为 skipped，更新时清理旧连接和工具', async t => {
    const sandbox = createSandbox()
    t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }))
    const state = { connects: [], disconnects: [] }
    const manager = new McpManager({
        serversFile: sandbox.file,
        clientFactory: createFakeClientFactory(state)
    })

    const created = await manager.addServer('self-server', {
        type: 'streamable-http',
        url: 'http://127.0.0.1:3000/chatai/mcp'
    })
    assert.equal(created.status, 'skipped')
    assert.equal(created.skipped, true)
    assert.deepEqual(state.connects, [])
    assert.equal(
        JSON.parse(fs.readFileSync(sandbox.file, 'utf8')).servers['self-server'].url,
        'http://127.0.0.1:3000/chatai/mcp'
    )

    const remote = await manager.addServer('remote-server', {
        type: 'streamable-http',
        url: 'https://remote.invalid/chatai/mcp',
        marker: 'remote'
    })
    assert.equal(remote.status, 'connected')
    assert.deepEqual(state.connects, ['remote'])

    await manager.addServer('service', { type: 'stdio', command: 'old', marker: 'old' })
    assert.equal(manager.getTool('tool_old', { serverName: 'service' })?.serverName, 'service')
    const updated = await manager.updateServer('service', {
        type: 'streamable-http',
        url: 'http://127.0.0.1:3000/chatai/mcp'
    })
    assert.equal(updated.status, 'skipped')
    assert.equal(updated.skipped, true)
    assert.equal(manager.getTool('tool_old', { serverName: 'service' }), null)
    assert.ok(state.disconnects.includes('old'))
})

test('MCP 服务器信息保留内置、自定义与跳过状态标记', () => {
    const manager = new McpManager()
    manager.servers.set('builtin', {
        status: 'connected',
        config: { type: 'builtin' },
        isBuiltin: true,
        tools: [],
        resources: [],
        resourceTemplates: [],
        prompts: []
    })
    manager.servers.set('custom-tools', {
        status: 'connected',
        config: { type: 'custom' },
        isCustomTools: true,
        tools: [],
        resources: [],
        resourceTemplates: [],
        prompts: []
    })
    manager.servers.set('skipped', {
        status: 'skipped',
        config: { type: 'streamable-http' },
        skipped: true,
        tools: [],
        resources: [],
        resourceTemplates: [],
        prompts: []
    })

    assert.equal(manager.getServer('builtin').isBuiltin, true)
    assert.equal(manager.getServer('custom-tools').isCustomTools, true)
    assert.equal(manager.getServer('skipped').skipped, true)
    assert.equal(manager.getServers().find(server => server.name === 'builtin').isBuiltin, true)
})

test('显式 MCP 工具身份找不到时不回退到另一服务器的同名工具', () => {
    const manager = new McpManager()
    manager.registerTool(manager.withToolSourceMeta({ name: 'same_name', serverName: 'server-a', isMcpTool: true }))
    manager.registerTool(manager.withToolSourceMeta({ name: 'same_name', serverName: 'server-b', isMcpTool: true }))

    assert.equal(manager.getTool('mcp:server-a:same_name').serverName, 'server-a')
    assert.equal(manager.getTool('mcp:unknown:same_name'), null)
    assert.equal(manager.getTool('same_name', { serverName: 'unknown' }), null)
})

test('命名空间工具名与显式服务器冲突时统一抛 MCP_TOOL_IDENTITY_MISMATCH', async () => {
    const manager = new McpManager()
    const tool = manager.withToolSourceMeta({ name: 'same_name', serverName: 'server-a', isMcpTool: true })
    manager.registerTool(tool)
    manager.servers.set('server-a', {
        client: {
            async callTool() {
                return { content: [] }
            }
        },
        tools: [tool],
        resources: [],
        prompts: []
    })

    for (const run of [
        () => manager.getTool('mcp:server-a:same_name', { serverName: 'server-b' }),
        () => manager.getPrompt('mcp:server-a:prompt', {}, 'server-b'),
        () => manager.callTool('mcp:server-a:same_name', {}, { serverName: 'server-b' })
    ]) {
        await assert.rejects(Promise.resolve().then(run), error => {
            assert.equal(error.code, 'MCP_TOOL_IDENTITY_MISMATCH')
            return true
        })
    }
})

test('MCP 配置以 0600 原子写入，替换失败不破坏旧文件', t => {
    const sandbox = createSandbox()
    t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }))

    const manager = new McpManager({ serversFile: sandbox.file })
    manager.saveServersConfig({ servers: { stable: { type: 'http', url: 'https://stable.invalid/mcp' } } })
    assert.equal(fs.statSync(sandbox.file).mode & 0o777, 0o600)
    const before = fs.readFileSync(sandbox.file, 'utf8')

    const control = { failRename: true }
    const failingManager = new McpManager({
        serversFile: sandbox.file,
        fileSystem: createFaultFileSystem(control)
    })
    assert.throws(
        () => failingManager.saveServersConfig({ servers: { broken: { type: 'stdio', command: 'broken' } } }),
        /injected rename failure/
    )
    assert.equal(fs.readFileSync(sandbox.file, 'utf8'), before)
    assert.equal(fs.readdirSync(sandbox.root).filter(name => name.endsWith('.tmp')).length, 0)
})

test('MCP 配置解析失败会显式中止且不覆盖原文件或内存快照', t => {
    const sandbox = createSandbox()
    t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }))
    fs.writeFileSync(sandbox.file, '{invalid-json', { mode: 0o600 })
    const manager = new McpManager({ serversFile: sandbox.file })
    manager.serversConfig = { servers: { inMemory: { marker: 'keep' } } }

    assert.throws(() => manager.loadServersConfig(), /加载 MCP 服务器配置失败/)
    assert.deepEqual(manager.serversConfig, { servers: { inMemory: { marker: 'keep' } } })
    assert.equal(fs.readFileSync(sandbox.file, 'utf8'), '{invalid-json')
})

test('addServer 连接失败不落盘、不保留 error server，并且连接日志不泄露凭据', async t => {
    const sandbox = createSandbox()
    t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }))
    const state = { connects: [], disconnects: [], debug: [] }
    const manager = new McpManager({
        serversFile: sandbox.file,
        clientFactory: createFakeClientFactory(state),
        logger: {
            debug: (...args) => state.debug.push(args),
            info() {},
            warn() {},
            error() {}
        }
    })

    await assert.rejects(
        manager.addServer('broken', {
            type: 'http',
            url: 'https://broken.invalid/mcp',
            marker: 'broken',
            failConnect: true,
            headers: { Authorization: 'Bearer should-not-leak' },
            env: { SERVICE_TOKEN: 'should-not-leak-env' }
        }),
        /connect failed/
    )

    assert.equal(manager.servers.has('broken'), false)
    assert.deepEqual(JSON.parse(fs.readFileSync(sandbox.file, 'utf8')), { servers: {} })
    const logs = JSON.stringify(state.debug)
    assert.doesNotMatch(logs, /should-not-leak/)
    assert.match(logs, /REDACTED/)
})

test('updateServer 连接失败恢复旧连接和旧配置', async t => {
    const sandbox = createSandbox()
    t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }))
    const state = { connects: [], disconnects: [] }
    const manager = new McpManager({
        serversFile: sandbox.file,
        clientFactory: createFakeClientFactory(state)
    })
    await manager.addServer('service', { type: 'stdio', command: 'old', marker: 'old' })

    await assert.rejects(
        manager.updateServer('service', {
            type: 'stdio',
            command: 'new',
            marker: 'new',
            failConnect: true
        }),
        /connect failed/
    )

    assert.equal(manager.getServer('service').config.marker, 'old')
    assert.equal(JSON.parse(fs.readFileSync(sandbox.file, 'utf8')).servers.service.marker, 'old')
    assert.deepEqual(state.connects, ['old', 'new', 'old'])
    assert.ok(state.disconnects.includes('old'))
})

test('add/remove 持久化失败分别清理新连接和恢复旧连接', async t => {
    const sandbox = createSandbox()
    t.after(() => fs.rmSync(sandbox.root, { recursive: true, force: true }))
    const control = { failRename: false }
    const state = { connects: [], disconnects: [] }
    const manager = new McpManager({
        serversFile: sandbox.file,
        fileSystem: createFaultFileSystem(control),
        clientFactory: createFakeClientFactory(state)
    })
    manager.saveServersConfig({ servers: {} })

    control.failRename = true
    await assert.rejects(
        manager.addServer('new-service', { type: 'stdio', command: 'new', marker: 'new' }),
        /injected rename failure/
    )
    assert.equal(manager.servers.has('new-service'), false)
    assert.deepEqual(JSON.parse(fs.readFileSync(sandbox.file, 'utf8')), { servers: {} })

    control.failRename = false
    await manager.addServer('old-service', { type: 'stdio', command: 'old', marker: 'old' })
    control.failRename = true
    await assert.rejects(manager.removeServer('old-service'), /injected rename failure/)
    assert.equal(manager.getServer('old-service').config.marker, 'old')
    assert.equal(JSON.parse(fs.readFileSync(sandbox.file, 'utf8')).servers['old-service'].marker, 'old')
})
