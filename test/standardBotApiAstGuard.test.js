import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { analyzeStandardBotBusinessSource, listStandardBotApiBusinessFiles } from './support/standardBotApiAstGuard.js'

const root = path.resolve('.')

function violationCodes(source) {
    return new Set(analyzeStandardBotBusinessSource(source).map(violation => violation.code))
}

test('AST 门禁覆盖 bind、可选链、computed 字面量与别名调用', () => {
    const cases = [
        {
            source: 'const fn = ctx.getEvent().bot.sendApi.bind(ctx.getEvent().bot); await fn("x")',
            code: 'DIRECT_PROTOCOL_MEMBER'
        },
        {
            source: 'await ctx?.getEvent?.()?.bot?.["sendApi"]?.("send_group_msg", {})',
            code: 'DIRECT_PROTOCOL_MEMBER'
        },
        {
            source: 'const key = `send${"Api"}`; const fn = ctx.getEvent().bot[key]; await fn("x")',
            code: 'DIRECT_PROTOCOL_MEMBER'
        },
        {
            source: 'const event = ctx.getEvent(); const bot = event.bot; const fn = bot.sendApi; await fn("x")',
            code: 'DIRECT_PROTOCOL_MEMBER'
        },
        {
            source: 'const fn = transport.sendApi; await fn("x")',
            code: 'ALIASED_PROTOCOL_CALL'
        }
    ]

    for (const item of cases) {
        assert.ok(violationCodes(item.source).has(item.code), item.source)
    }
})

test('AST 门禁覆盖解构、Reflect.get 与原始 Bot 协议属性', () => {
    const cases = [
        {
            source: 'const event = ctx.getEvent(); const { bot } = event; const { sendApi: send } = bot; await send()',
            code: 'DIRECT_PROTOCOL_DESTRUCTURE'
        },
        {
            source: 'const fn = Reflect.get(ctx.getEvent().bot, "sendApi"); await fn()',
            code: 'REFLECT_PROTOCOL_LOOKUP'
        },
        {
            source: 'const event = ctx.getEvent(); const id = event.bot.uin',
            code: 'RAW_BOT_PROTOCOL_PROPERTY'
        },
        {
            source: 'const event = ctx.getEvent(); const { bot } = event',
            code: 'RAW_EVENT_BOT_ACCESS'
        }
    ]

    for (const item of cases) {
        assert.ok(violationCodes(item.source).has(item.code), item.source)
    }
})

test('AST 门禁允许标准接口、事件元数据和能力声明', () => {
    const source = `
        const api = StandardBotApi.fromContext(ctx)
        const event = ctx.getEvent()
        const rawApi = new StandardRawApi(api)
        const capabilities = rawApi.capabilities()
        if (capabilities.sendOidbSvcTrpcTcp) await api.sendGroup(event.group_id, 'ok')
        const description = 'sendApi 仅允许由标准边界内部调用'
    `
    assert.deepEqual(analyzeStandardBotBusinessSource(source), [])
})

test('AST 门禁扫描范围只包含业务目录并排除兼容基础设施', () => {
    const files = listStandardBotApiBusinessFiles(root).map(file => path.relative(root, file).split(path.sep).join('/'))
    assert.ok(files.includes('src/mcp/tools/admin.js'))
    assert.ok(files.includes('src/services/tools/ToolApprovalService.js'))
    assert.ok(!files.includes('src/mcp/tools/helpers.js'))
    assert.ok(!files.includes('src/mcp/BuiltinMcpServer.js'))
    assert.ok(!files.includes('src/services/tools/CustomToolService.js'))
    assert.ok(files.every(file => !file.startsWith('src/core/platform/')))
})
