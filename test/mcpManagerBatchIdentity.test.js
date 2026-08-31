import assert from 'node:assert/strict'
import test from 'node:test'

import { McpManager } from '../src/mcp/McpManager.js'

test('批量工具调用把 MCP identity 解析为外部服务器的裸工具名', async () => {
    let receivedName = null
    const manager = new McpManager()
    const tool = {
        name: 'echo',
        serverName: 'server-a',
        source: 'mcp',
        isMcpTool: true,
        inputSchema: { type: 'object', properties: {} }
    }
    manager.tools.set('echo', tool)
    manager.toolIdentities.set('server-a:echo', tool)
    manager.servers.set('server-a', {
        status: 'connected',
        config: { type: 'test' },
        tools: [tool],
        resources: [],
        prompts: [],
        client: {
            async callTool(name, args, options) {
                receivedName = name
                assert.deepEqual(args, { value: 'ok' })
                assert.equal(options.requestState, 'opaque')
                return { content: [{ type: 'text', text: 'ok' }], isError: false }
            }
        }
    })

    const results = await manager.callToolsParallel(
        [
            {
                name: 'mcp:server-a:echo',
                args: { value: 'ok' },
                requestState: 'opaque'
            }
        ],
        { skipStats: true }
    )

    assert.equal(receivedName, 'echo')
    assert.equal(results[0].success, true)
})

test('卸载过期工具对象不会删除同身份的新实现', () => {
    const manager = new McpManager()
    const oldTool = { name: 'echo', serverName: 'server-a', source: 'mcp' }
    const newTool = { name: 'echo', serverName: 'server-a', source: 'mcp', version: 2 }

    manager.registerTool(oldTool)
    manager.registerTool(newTool)
    manager.unregisterTool('echo', oldTool)

    assert.equal(manager.getTool('echo', { serverName: 'server-a' }), newTool)
    assert.equal(manager.getTool('echo'), newTool)
})
