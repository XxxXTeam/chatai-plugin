import test from 'node:test'
import assert from 'node:assert/strict'
import { contextManager } from '../src/services/llm/ContextManager.js'

test('ContextManager 群历史在 QQBot 下使用 message_id 字符串锚点而不是 0 或 Number()', async () => {
    const calls = []
    const record = {
        message_id: 'msg-openid-2',
        sender: { user_id: 'user-openid' },
        message: [{ type: 'text', text: '最近一条' }]
    }
    const bot = { adapter: { id: 'QQBot' } }
    const group = {
        bot,
        message_id: record.message_id,
        async getChatHistory(sequence, count) {
            calls.push([sequence, count])
            return sequence === record.message_id ? [record] : []
        }
    }

    const history = await contextManager.getChatHistoryGroup(group, 2)

    assert.equal(history.length, 1)
    assert.equal(history[0].message_id, record.message_id)
    assert.deepEqual(calls, [
        [record.message_id, 20],
        [record.message_id, 20]
    ])
})
