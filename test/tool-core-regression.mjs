import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

global.Bot = {}
global.logger = { debug() {}, info() {}, warn() {}, error() {} }

const pluginRoot = path.resolve('.')
const config = (await import('../config/config.js')).default
const { mcpManager } = await import('../src/mcp/McpManager.js')
const { builtinMcpServer } = await import('../src/mcp/BuiltinMcpServer.js')
const { skillsConfig } = await import('../src/services/skills/SkillsConfig.js')
const { skillDocumentLoader } = await import('../src/services/skills/SkillDocumentLoader.js')
const SkillsLoader = (await import('../src/services/skills/SkillsLoader.js')).default
const { SkillsAgent } = await import('../src/services/agent/SkillsAgent.js')
const { skillsTools } = await import('../src/mcp/tools/skills.js')
const { customToolService, CustomToolService } = await import('../src/services/tools/CustomToolService.js')
const { OpenAIClient } = await import('../src/core/adapters/openai/OpenAIClient.js')
const { AbstractClient } = await import('../src/core/adapters/AbstractClient.js')
const { statsService } = await import('../src/services/stats/StatsService.js')
const { fetchWithLimit, isBlockedIp, sanitizeCrossOriginRedirectHeaders } = await import('../src/mcp/tools/helpers.js')

const tool = name => skillsTools.find(item => item.name === name)
const masterContext = { isMaster: () => true, getEvent: () => null, getBot: () => global.Bot }
const userContext = { isMaster: () => false, getEvent: () => null, getBot: () => global.Bot }

await mcpManager.init()
await skillsConfig.init(pluginRoot)
await skillDocumentLoader.init(pluginRoot, skillsConfig)
const loader = new SkillsLoader()
loader.pluginRoot = pluginRoot
loader._syncExposedSkills()
loader.initialized = true
global.chatAiSkillsLoader = loader

// Skills：标准 allowed-tools tokenizer、当前链加载、主人全局持久化与卸载对称。
const groupSummary = skillDocumentLoader.getDocumentByName('群聊总结风格')
assert.deepEqual(groupSummary.allowedTools, ['get_chat_history', 'search_group_history', 'get_group_info'])
assert.equal(groupSummary.standardCompliant, false)

const transientLoad = await tool('load_skill').handler({ name: '群聊总结风格' }, userContext)
assert.equal(transientLoad.success, true)
assert.equal(transientLoad.persisted, false)
assert.match(transientLoad.skill.instructions, /只写发生过的事/)
assert.equal(loader.loadedSkills.has('群聊总结风格'), false)

const forbiddenPersist = await tool('load_skill').handler({ name: '群聊总结风格', persist_global: true }, userContext)
assert.equal(forbiddenPersist.success, false)

const persisted = await tool('load_skill').handler({ name: '群聊总结风格', persist_global: true }, masterContext)
assert.equal(persisted.success, true)
assert.equal(persisted.persisted, true)
assert.match(loader.getSkillDocumentInstructions({ message: '普通消息' }), /只写发生过的事/)
assert.equal((await tool('unload_skill').handler({ name: '群聊总结风格' }, userContext)).success, false)
assert.equal((await tool('unload_skill').handler({ name: '群聊总结风格' }, masterContext)).success, true)

// 动态工具：创建→原子加载→同轮立即调用→刷新 SkillsAgent→新 client.tools。
const dynamicName = `runtime_probe_${Date.now()}`
const oldDangerous = config.get('builtinTools.allowDangerous')
config.config.builtinTools ||= {}
config.config.builtinTools.enabled = true
config.config.builtinTools.allowDangerous = true
let created = false
try {
    const agent = new SkillsAgent({ userPermission: 'master' })
    await agent.init()
    assert.equal(
        agent.getExecutableSkills().some(item => item.name === dynamicName),
        false
    )

    const result = await tool('create_custom_tool').handler(
        {
            name: dynamicName,
            description: '动态工具回归探针',
            input_schema: {
                type: 'object',
                properties: { value: { type: 'string' } },
                required: ['value']
            },
            handler_code:
                "return { content: [{ type: 'text', text: `dynamic:${args.value}` }], structuredContent: { value: args.value } }",
            invoke_arguments: { value: 'same-round' }
        },
        masterContext
    )
    created = true
    assert.equal(result.success, true)
    assert.equal(result.callableThisRound, true)
    assert.match(JSON.stringify(result.immediateInvocation), /dynamic:same-round/)

    const registered = mcpManager.getTool(dynamicName, { serverName: 'custom-tools' })
    assert.equal(registered?.isJsTool, true)
    assert.equal(registered?.requireMaster, true)
    const listed = builtinMcpServer.listTools().find(item => item.name === dynamicName)
    assert.deepEqual(listed?.inputSchema?.properties, { value: { type: 'string' } })

    const proxyResult = await tool('invoke_custom_tool').handler(
        { name: dynamicName, arguments: { value: 'proxy-round' } },
        masterContext
    )
    assert.match(JSON.stringify(proxyResult), /dynamic:proxy-round/)

    await agent.refresh()
    const nextTools = agent.getExecutableSkills()
    assert.equal(
        nextTools.some(item => item.name === dynamicName),
        true
    )
    const client = new OpenAIClient({ apiKey: 'test', baseUrl: 'https://example.invalid', tools: nextTools })
    assert.equal(
        client.tools.some(item => item.name === dynamicName),
        true
    )
} finally {
    if (created) await tool('delete_custom_tool').handler({ name: dynamicName }, masterContext)
    config.config.builtinTools.allowDangerous = oldDangerous === true
}
assert.equal(fs.existsSync(path.join(pluginRoot, 'data', 'tools', `${dynamicName}.js`)), false)

// 热加载未注册必须回滚，且同名内置工具冲突必须拒绝。
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-tool-regression-'))
try {
    const failedService = new CustomToolService({
        pluginRoot: sandbox,
        reloadHandler: async () => {},
        registryInspector: async () => []
    })
    await assert.rejects(
        failedService.saveTool({
            name: 'not_registered',
            description: '不会进入注册表',
            inputSchema: { type: 'object', properties: {} },
            handlerCode: "return { content: [{ type: 'text', text: 'x' }] }"
        }),
        /未注册/
    )
    assert.equal(fs.existsSync(path.join(sandbox, 'data', 'tools', 'not_registered.js')), false)

    const conflictService = new CustomToolService({
        pluginRoot: sandbox,
        reloadHandler: async () => {},
        registryInspector: async name => [{ name, serverName: 'builtin', isBuiltin: true }]
    })
    await assert.rejects(
        conflictService.saveTool({
            name: 'echo',
            description: '冲突工具',
            inputSchema: { type: 'object', properties: {} },
            handlerCode: "return { content: [{ type: 'text', text: 'x' }] }"
        }),
        /其他来源占用/
    )
} finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
}

// 每次工具尝试：详细记录与聚合均严格 +1。
async function assertOneRecord(label, run) {
    const beforeRecords = (await statsService.getToolCallRecords({}, 1000)).length
    const beforeSummary = (await statsService.getToolCallSummary()).total
    await run()
    const afterRecords = (await statsService.getToolCallRecords({}, 1000)).length
    const afterSummary = (await statsService.getToolCallSummary()).total
    assert.equal(afterRecords - beforeRecords, 1, `${label}: detailed delta`)
    assert.equal(afterSummary - beforeSummary, 1, `${label}: summary delta`)
}

await assertOneRecord('normal', async () => {
    await mcpManager.callTool('get_current_time', {})
})
await assertOneRecord('cache-prime', async () => {
    await mcpManager.callTool('get_current_time', {}, { useCache: true, cacheTTL: 60000 })
})
await assertOneRecord('cache-hit', async () => {
    await mcpManager.callTool('get_current_time', {}, { useCache: true, cacheTTL: 60000 })
})
await assertOneRecord('unknown-manager', async () => {
    await assert.rejects(mcpManager.callTool(`missing_${Date.now()}`, {}), /Tool not found/)
})

class TestClient extends AbstractClient {
    async _sendMessage() {
        throw new Error('not used')
    }
}
const testClient = new TestClient({
    tools: [
        {
            name: 'allowed_probe',
            type: 'function',
            function: { name: 'allowed_probe', description: '', parameters: { type: 'object', properties: {} } },
            run: async () => ({ content: [{ type: 'text', text: 'ok' }] })
        }
    ]
})
await assertOneRecord('unknown-client', async () => {
    const result = await testClient.executeToolCalls(
        [{ id: 'unknown-call-id', type: 'function', function: { name: 'unknown_probe', arguments: '{}' } }],
        { userPermission: 'master' }
    )
    assert.equal(result.toolCallResults[0].isError, true)
})
await assertOneRecord('invalid-json', async () => {
    const result = await testClient.executeToolCalls(
        [{ id: 'invalid-json-id', type: 'function', function: { name: 'allowed_probe', arguments: '{bad' } }],
        { userPermission: 'master' }
    )
    assert.match(result.toolCallLogs[0].result, /arguments 不是合法 JSON/)
})

await assertOneRecord('dangerous-block', async () => {
    const previous = config.config.builtinTools.allowDangerous
    config.config.builtinTools.allowDangerous = false
    try {
        const result = await mcpManager.callTool('write_file', { path: 'blocked', content: 'blocked' })
        assert.equal(result.isError, true)
    } finally {
        config.config.builtinTools.allowDangerous = previous
    }
})

const restrictedClient = new TestClient({
    tools: [
        {
            name: 'master_probe',
            type: 'function',
            requireMaster: true,
            function: { name: 'master_probe', description: '', parameters: { type: 'object', properties: {} } },
            run: async () => {
                throw new Error('权限拦截失败，不应执行 handler')
            }
        }
    ]
})
await assertOneRecord('permission-preflight', async () => {
    const result = await restrictedClient.executeToolCalls(
        [{ id: 'permission-call-id', type: 'function', function: { name: 'master_probe', arguments: '{}' } }],
        { userPermission: 'user', toolApprovalMode: 'auto' }
    )
    assert.equal(result.toolCallResults[0].isError, true)
})

const repeatedAttemptId = 'reused-provider-call-id'
const repeatedBefore = (await statsService.getToolCallRecords({}, 1000)).length
await mcpManager.callTool('get_current_time', {}, { attemptId: repeatedAttemptId })
await mcpManager.callTool('get_current_time', {}, { attemptId: repeatedAttemptId })
const repeatedRecords = (await statsService.getToolCallRecords({}, 1000)).filter(
    record => record.attemptId === repeatedAttemptId
)
assert.equal((await statsService.getToolCallRecords({}, 1000)).length - repeatedBefore, 2)
assert.equal(repeatedRecords.length, 2)
assert.notEqual(repeatedRecords[0].id, repeatedRecords[1].id)

const parallelStart = Date.now()
await Promise.all([
    mcpManager.callTool('sleep', { seconds: 0.2 }, { attemptId: 'parallel-slow' }),
    mcpManager.callTool('sleep', { seconds: 0.1 }, { attemptId: 'parallel-fast' })
])
const parallelRecords = await statsService.getToolCallRecords({ toolName: 'sleep', startTime: parallelStart }, 10)
assert.equal(parallelRecords.length, 2)
assert.equal(parallelRecords[0].attemptId, 'parallel-fast')
assert.equal(parallelRecords[1].attemptId, 'parallel-slow')

const savedHistory = []
const memoryHistory = {
    async getHistory() {
        return savedHistory.map(item => ({ ...item }))
    },
    async saveHistory(message) {
        savedHistory.push({ ...message })
    },
    async deleteConversation() {
        savedHistory.length = 0
    }
}
class UnknownFlowClient extends AbstractClient {
    constructor(options) {
        super(options)
        this.round = 0
    }

    async _sendMessage() {
        this.round += 1
        if (this.round === 1) {
            return {
                id: 'assistant-unknown',
                role: 'assistant',
                content: [],
                toolCalls: [
                    {
                        id: 'unknown-flow-call',
                        type: 'function',
                        function: { name: 'unknown_flow_tool', arguments: '{}' }
                    }
                ]
            }
        }
        return {
            id: 'assistant-recovered',
            role: 'assistant',
            content: [{ type: 'text', text: '已根据工具错误自纠' }]
        }
    }
}
await assertOneRecord('unknown-sendMessage-flow', async () => {
    const client = new UnknownFlowClient({
        historyManager: memoryHistory,
        tools: testClient.tools
    })
    const response = await client.sendMessage(
        { role: 'user', content: [{ type: 'text', text: '调用未知工具' }] },
        { conversationId: 'unknown-flow', userPermission: 'master' }
    )
    assert.match(response.contents[0].text, /自纠/)
    const assistantCall = savedHistory.find(item => item.role === 'assistant' && item.toolCalls?.length)
    const toolResult = savedHistory.find(item => item.role === 'tool')
    assert.equal(assistantCall.toolCalls[0].id, 'unknown-flow-call')
    assert.equal(toolResult.content[0].tool_call_id, 'unknown-flow-call')
    assert.equal(toolResult.content[0].isError, true)
})

assert.equal(isBlockedIp('::ffff:7f00:1'), true)
assert.equal(isBlockedIp('::ffff:0a00:1'), true)
assert.equal(isBlockedIp('::7f00:1'), true)
assert.equal(isBlockedIp('::127.0.0.1'), true)
assert.equal(isBlockedIp('ff00::1'), true)
assert.equal(isBlockedIp('fec0::1'), true)
assert.equal(isBlockedIp('::ffff:0808:0808'), false)

assert.deepEqual(
    sanitizeCrossOriginRedirectHeaders({
        Accept: 'text/html',
        'User-Agent': 'test',
        'X-API-Key': 'secret',
        Authorization: 'Bearer secret',
        Cookie: 'sid=secret',
        'X-Token': 'secret'
    }),
    { Accept: 'text/html', 'User-Agent': 'test' }
)

let lookupCalls = 0
await assert.rejects(
    fetchWithLimit(
        'http://rebind.test/',
        {},
        {
            timeoutMs: 50,
            maxBytes: 1024,
            label: 'dns-rebinding-test',
            lookup: async () => {
                lookupCalls += 1
                return lookupCalls === 1
                    ? [{ address: '93.184.216.34', family: 4 }]
                    : [{ address: '127.0.0.1', family: 4 }]
            }
        }
    )
)
assert.equal(lookupCalls, 1)

console.log('tool-core-regression: PASS')
process.exit(0)
