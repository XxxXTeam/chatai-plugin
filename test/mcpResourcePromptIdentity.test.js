import assert from 'node:assert/strict'
import test from 'node:test'

const { McpManager } = await import('../src/mcp/McpManager.js')

test('MCP 聚合注册保留不同服务器的同名提示词与资源身份', async () => {
    const manager = new McpManager()
    const calls = []
    for (const serverName of ['alpha', 'beta']) {
        const prompt = { name: 'shared', description: serverName, serverName }
        const resource = { uri: 'memory://shared', name: serverName, serverName }
        manager.prompts.set(prompt.name, prompt)
        manager.promptIdentities.set(`${serverName}:${prompt.name}`, prompt)
        manager.resources.set(resource.uri, resource)
        manager.resourceIdentities.set(`${serverName}:${resource.uri}`, resource)
        manager.servers.set(serverName, {
            client: {
                async getPrompt(name, args) {
                    calls.push(['prompt', serverName, name, args])
                    return { messages: [] }
                },
                async readResource(uri) {
                    calls.push(['resource', serverName, uri])
                    return [{ uri, text: serverName }]
                }
            }
        })
    }

    assert.deepEqual(
        manager.getPrompts().map(item => `${item.serverName}:${item.name}`),
        ['alpha:shared', 'beta:shared']
    )
    await manager.getPrompt('mcp:beta:shared', { topic: 'x' })
    const content = await manager.readResource('memory://shared', 'alpha')
    assert.deepEqual(content, [{ uri: 'memory://shared', text: 'alpha' }])
    assert.deepEqual(calls, [
        ['prompt', 'beta', 'shared', { topic: 'x' }],
        ['resource', 'alpha', 'memory://shared']
    ])
})

test('MCP 定义列表保留可选元数据但不暴露 handler/client 实现字段', () => {
    const manager = new McpManager()
    manager.registerTool({
        name: 'metadata-tool',
        description: 'tool',
        inputSchema: { type: 'object', properties: {} },
        title: '工具标题',
        icons: [{ src: 'https://example.invalid/tool.svg' }],
        outputSchema: { type: 'object' },
        annotations: { readOnlyHint: true },
        _meta: { source: 'test' },
        handler: () => {},
        function: { name: 'metadata-tool' },
        serverName: 'server-a',
        isMcpTool: true
    })
    manager.resources.set('memory://metadata', {
        uri: 'memory://metadata',
        name: 'resource',
        title: '资源标题',
        icons: [{ src: 'https://example.invalid/resource.svg' }],
        annotations: { audience: ['assistant'] },
        size: 42,
        uriTemplate: 'memory://metadata/{id}',
        _meta: { source: 'test' },
        serverName: 'server-a',
        client: { secret: true }
    })
    manager.prompts.set('metadata-prompt', {
        name: 'metadata-prompt',
        title: '提示标题',
        icons: [{ src: 'https://example.invalid/prompt.svg' }],
        annotations: { audience: ['user'] },
        _meta: { source: 'test' },
        serverName: 'server-a',
        client: { secret: true }
    })

    const tool = manager.getTools({ applyConfig: false })[0]
    assert.equal(tool.title, '工具标题')
    assert.deepEqual(tool.icons, [{ src: 'https://example.invalid/tool.svg' }])
    assert.equal(Object.hasOwn(tool, 'handler'), false)
    assert.equal(Object.hasOwn(tool, 'function'), false)

    const resource = manager.getResources()[0]
    assert.equal(resource.title, '资源标题')
    assert.equal(resource.size, 42)
    assert.equal(resource.uriTemplate, 'memory://metadata/{id}')
    assert.equal(Object.hasOwn(resource, 'client'), false)

    const prompt = manager.getPrompts()[0]
    assert.equal(prompt.title, '提示标题')
    assert.deepEqual(prompt.icons, [{ src: 'https://example.invalid/prompt.svg' }])
    assert.equal(Object.hasOwn(prompt, 'client'), false)
})

test('MCP 管理器保留资源模板来源与可选元数据', () => {
    const manager = new McpManager()
    const template = {
        uriTemplate: 'memory://users/{id}',
        name: '用户资源',
        title: '用户模板',
        description: '按 ID 读取用户',
        mimeType: 'application/json',
        icons: [{ src: 'https://example.invalid/user.svg' }],
        annotations: { audience: ['assistant'] },
        _meta: { source: 'template-test' },
        serverName: 'template-server',
        handler: () => {}
    }
    manager.resourceTemplates.set(template.uriTemplate, template)
    manager.resourceTemplateIdentities.set(`${template.serverName}:${template.uriTemplate}`, template)

    assert.deepEqual(manager.getResourceTemplates(), [
        {
            uriTemplate: template.uriTemplate,
            name: template.name,
            description: template.description,
            mimeType: template.mimeType,
            serverName: template.serverName,
            title: template.title,
            icons: template.icons,
            annotations: template.annotations,
            _meta: template._meta
        }
    ])
    assert.equal(Object.hasOwn(manager.getResourceTemplates()[0], 'handler'), false)
})

test('MCP 连接加载资源模板并在断开时清理全局索引', async () => {
    const manager = new McpManager({
        clientFactory: () => ({
            async connect() {},
            async listTools() {
                return []
            },
            async listResources() {
                return []
            },
            async listPrompts() {
                return []
            },
            async listResourceTemplates() {
                return [{ uriTemplate: 'memory://connected/{id}', name: 'connected template' }]
            },
            async disconnect() {}
        })
    })
    await manager.connectServer('template-server', { type: 'stdio', command: 'mock-server' })
    assert.equal(manager.getResourceTemplates()[0].serverName, 'template-server')
    assert.equal(manager.getServer('template-server').resourceTemplates.length, 1)
    await manager.disconnectServer('template-server')
    assert.deepEqual(manager.getResourceTemplates(), [])
})
