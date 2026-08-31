import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }

const { builtinMcpServer, getBuiltinToolContext, setBuiltinToolContext } =
    await import('../src/mcp/BuiltinMcpServer.js')
const { McpManager } = await import('../src/mcp/McpManager.js')

test('McpManager 无请求上下文时向内置工具传入隔离上下文，不复用上一事件', async () => {
    const globalContext = getBuiltinToolContext()
    const previousEvent = globalContext.getEvent()
    const previousBot = globalContext.bot
    const staleEvent = { user_id: 'stale-user', group_id: 'stale-group', bot: { uin: 'stale-bot' } }
    setBuiltinToolContext({ event: staleEvent, bot: staleEvent.bot })
    const replacementBot = { uin: 'replacement-bot' }
    setBuiltinToolContext({ bot: replacementBot })
    assert.equal(getBuiltinToolContext().getEvent(), null)
    assert.equal(getBuiltinToolContext().getBot(), replacementBot)
    setBuiltinToolContext()
    assert.equal(getBuiltinToolContext().getEvent(), null)
    assert.equal(getBuiltinToolContext().getBot(), null)
    setBuiltinToolContext({ event: staleEvent, bot: staleEvent.bot })
    setBuiltinToolContext(null)
    assert.equal(getBuiltinToolContext().getEvent(), null)
    setBuiltinToolContext({ event: staleEvent, bot: staleEvent.bot })

    const manager = new McpManager()
    manager.tools.set('context_probe', {
        name: 'context_probe',
        serverName: 'builtin',
        isBuiltin: true,
        inputSchema: { type: 'object', properties: {} }
    })

    const originalCallTool = builtinMcpServer.callTool
    let receivedContext
    builtinMcpServer.callTool = async (_name, _args, context) => {
        receivedContext = context
        return { content: [{ type: 'text', text: 'ok' }] }
    }

    try {
        await manager.callTool('context_probe', {}, { skipStats: true })
        assert.equal(receivedContext, null)
        const isolatedContext = builtinMcpServer.createRequestContext(receivedContext)
        assert.equal(isolatedContext.getEvent(), null)
        assert.equal(isolatedContext.isMaster, false)
        assert.notEqual(isolatedContext.getEvent(), staleEvent)

        await manager.callTool('context_probe', {}, { skipStats: true, userPermission: 'master' })
        assert.equal(receivedContext.isMaster, true)
        assert.equal(receivedContext.event, null)
    } finally {
        builtinMcpServer.callTool = originalCallTool
        setBuiltinToolContext({ event: previousEvent, bot: previousBot })
    }
})
