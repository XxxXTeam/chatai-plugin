import test from 'node:test'
import assert from 'node:assert/strict'
import { contextManager } from '../src/services/llm/ContextManager.js'
import { cacheQQBotMessage, messageCache } from '../src/services/storage/MessageCache.js'

test('ContextManager 群历史在 QQBot 下只读本地索引且索引为空不调用历史接口', async () => {
    messageCache.clear()
    const calls = []
    const bot = { adapter: { id: 'QQBot' } }
    const group = {
        bot,
        group_id: 'empty-group-openid',
        async getChatHistory(sequence, count) {
            calls.push([sequence, count])
            return []
        }
    }

    const history = await contextManager.getChatHistoryGroup(group, 2)

    assert.deepEqual(history, [])
    assert.deepEqual(calls, [])
})

test('ContextManager 群历史优先使用公开群号映射缓存', async () => {
    messageCache.clear()
    cacheQQBotMessage({
        bot: { adapter: { id: 'QQBot' } },
        message_id: 'cached-context-message',
        group_id: '246813579',
        _raw_group_id: 'cached-context-openid',
        user_id: 'context-user-openid',
        sender: { user_id: 'context-user-openid', nickname: '上下文用户' },
        message: [{ type: 'text', text: '缓存上下文正文' }]
    })

    let historyCalled = false
    const history = await contextManager.getChatHistoryGroup(
        {
            bot: { adapter: { id: 'QQBot' } },
            group_id: '246813579',
            async getChatHistory() {
                historyCalled = true
                return []
            }
        },
        20
    )

    assert.equal(history.length, 1)
    assert.equal(history[0].message_id, 'cached-context-message')
    assert.equal(history[0].message[0].text, '缓存上下文正文')
    assert.equal(historyCalled, false)
})
