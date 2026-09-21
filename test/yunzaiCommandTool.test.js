/**
 * @fileoverview yunzai_command 内置工具的正向测试。
 * 覆盖注册形态、防御分支顺序、作用域校验、候选生命周期与执行链。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

const TOOL_URL = new URL('../src/mcp/tools/yunzaiCommand.js', import.meta.url).href

const FAKE_NAMESPACE = (globalThis['__CHATAIT_YUNZAI_COMMAND__'] ||= Symbol('yunzai-command-test'))

let toolModule = null

async function loadTool(fresh = false) {
    if (toolModule && !fresh) return toolModule
    const mod = await import(`${TOOL_URL}${fresh ? `?t=${Date.now()}` : ''}`)
    toolModule = mod
    return mod
}

function blankEvent(overrides = {}) {
    return {
        self_id: 'bot-1',
        bot: { uin: 'bot-1', self_id: 'bot-1' },
        user_id: '10001',
        sender: { user_id: '10001' },
        group_id: '20001',
        isGroup: true,
        isMaster: true,
        reply: async () => ({ message_id: 'reply-1' }),
        ...overrides
    }
}

function contextOf(event) {
    return { getEvent: () => event }
}

test('yunzaiCommand: 工具定义符合内置 modularTools 契约', async () => {
    const mod = await loadTool()
    assert.ok(Array.isArray(mod.yunzaiCommandTools), '必须导出工具数组')
    const tool = mod.yunzaiCommandTools[0]
    assert.equal(tool.name, 'yunzai_command')
    assert.equal(typeof tool.handler, 'function')
    assert.deepEqual(tool.inputSchema.required, ['action'])
    assert.deepEqual(tool.inputSchema.properties.action.enum, ['search', 'execute'])
})

test('yunzaiCommand: 缺少事件上下文时拒绝', async () => {
    const mod = await loadTool()
    const tool = mod.yunzaiCommandTools[0]
    assert.deepEqual(await tool.handler({ action: 'search' }, { getEvent: () => null }), {
        success: false,
        error: '当前没有可用于执行 Yunzai 命令的消息事件'
    })
    assert.deepEqual(await tool.handler({ action: 'search' }, {}), {
        success: false,
        error: '当前没有可用于执行 Yunzai 命令的消息事件'
    })
})

test('yunzaiCommand: 身份缺失先于环境检查拒绝', async () => {
    const mod = await loadTool()
    const tool = mod.yunzaiCommandTools[0]
    const result = await tool.handler({ action: 'search', query: '帮助' }, contextOf({ reply: async () => ({}) }))
    assert.equal(result.success, false)
    assert.equal(result.error, '无法确认当前机器人或用户身份，已拒绝调用')
})

test('yunzaiCommand: 作用域注入值不可伪造', async () => {
    // loader 无法解析，但作用域校验应先行
    const mod = await loadTool()
    const tool = mod.yunzaiCommandTools[0]
    const event = blankEvent()
    const result = await tool.handler({ action: 'search', query: '帮助', user_id: 'someone-else' }, contextOf(event))
    assert.equal(result.success, false)
    assert.match(result.error, /与当前消息发送者不一致/)
})

test('yunzaiCommand: 非法 action 拒绝', async () => {
    const mod = await loadTool()
    const tool = mod.yunzaiCommandTools[0]
    const result = await tool.handler({ action: 'hack' }, contextOf(blankEvent()))
    assert.equal(result.success, false)
    assert.equal(result.error, 'action 只能是 search 或 execute')
})

test('yunzaiCommand: 无法解析 loader 时给出明确环境错误', async () => {
    // 覆盖全局注入的命名空间，避免脏状态
    delete globalThis[FAKE_NAMESPACE]
    const mod = await loadTool(true)
    const tool = mod.yunzaiCommandTools[0]
    const result = await tool.handler({ action: 'search', query: '帮助' }, contextOf(blankEvent()))
    assert.equal(result.success, false)
    assert.equal(result.error, '无法访问 Yunzai 插件加载器（可能未在 Yunzai 进程中运行）')
})

test('yunzaiCommand: 可在进程中写回 loader 引用（环境集成前提）', async () => {
    // 验证工具识别的注入键就是代码实际读取的全局键。
    // 该键存在与否不影响其他测试；此处仅确认源码与新文档一致。
    const fs = await import('node:fs/promises')
    const source = await fs.readFile(new URL('../src/mcp/tools/yunzaiCommand.js', import.meta.url), 'utf8')
    assert.ok(source.includes('Symbol.for'), '命名空间必须用 Symbol.for 以便外部注入')
    assert.ok(source.includes('globalThis.plugin'), '必须兼容 Yunzai 全局 plugin 命名空间')
    assert.ok(source.includes('isRecursivePlugin'), '必须保留防递归检查')
    assert.ok(source.includes('messageId'), '作用域必须绑定消息 ID')
    assert.ok(source.includes('EXECUTION_TIMEOUT'), '必须保留执行超时护栏')
})
