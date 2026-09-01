import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getGroupHistory,
    GroupContextCollector,
    ICQQGroupContextCollector,
    TRSSGroupContextCollector
} from '../src/utils/group.js'
import { cacheQQBotMessage, messageCache } from '../src/services/storage/MessageCache.js'
import { GroupSummaryCore } from '../src/services/group/GroupSummaryCore.js'

test('旧群历史收集器在 QQBot 下读取本地索引并保留字符串群标识', async () => {
    const calls = []
    messageCache.clear()
    cacheQQBotMessage({
        bot: { adapter: { id: 'QQBot' } },
        message_id: 'collector-message-openid',
        group_id: 'collector_group_openid',
        user_id: 'collector-user-openid',
        sender: { user_id: 'collector-user-openid', nickname: '收集用户' },
        message: [{ type: 'text', text: '收集器正文' }]
    })
    const bot = {
        adapter: { id: 'QQBot' },
        pickGroup(groupId) {
            calls.push(['pickGroup', groupId])
            return {
                async getChatHistory(sequence, count) {
                    calls.push(['getChatHistory', sequence, count])
                    return history
                }
            }
        }
    }

    for (const Collector of [GroupContextCollector, ICQQGroupContextCollector, TRSSGroupContextCollector]) {
        const history = await new Collector().collect(bot, 'collector_group_openid', 'message_openid', 500)
        assert.equal(history.length, 1)
        assert.equal(history[0].message_id, 'collector-message-openid')
        assert.equal(history[0].raw_message, '收集器正文')
    }
    assert.deepEqual(calls, [])
})

test('getGroupHistory 使用当前事件标准群对象且缺少事件时返回空列表', async () => {
    const calls = []
    const event = {
        bot: { adapter: { id: 'ICQQ' } },
        group_id: 'group_openid',
        group: {
            async getChatHistory(sequence, count) {
                calls.push([sequence, count])
                return [{ message_id: 'message_openid' }]
            }
        }
    }
    assert.equal((await getGroupHistory(event, 3))[0].message_id, 'message_openid')
    assert.deepEqual(calls, [[0, 3]])
    assert.deepEqual(await getGroupHistory(null), [])
})

test('getGroupHistory 在 QQBot 下不回退到当前事件 message_id 历史查询', async () => {
    const calls = []
    messageCache.clear()
    const event = {
        bot: { adapter: { id: 'QQBot' } },
        group_id: 'group_openid',
        message_id: 'message-openid',
        group: {
            async getChatHistory(sequence, count) {
                calls.push([sequence, count])
                return [{ message_id: sequence }]
            }
        }
    }
    const history = await getGroupHistory(event, 3)
    assert.deepEqual(history, [])
    assert.deepEqual(calls, [])
})

test('getGroupHistory 在 QQBot 下优先返回公开群号映射缓存的多条消息', async () => {
    messageCache.clear()
    cacheQQBotMessage({
        bot: { adapter: { id: 'QQBot' } },
        message_id: 'public-group-message-1',
        group_id: '1357902468',
        _raw_group_id: 'public-group-openid',
        user_id: 'user-openid',
        sender: { user_id: 'user-openid', nickname: '缓存用户' },
        message: [{ type: 'text', text: '缓存历史消息' }]
    })

    const calls = []
    const history = await getGroupHistory(
        {
            bot: { adapter: { id: 'QQBot' } },
            group_id: '1357902468',
            group: {
                async getChatHistory(...args) {
                    calls.push(args)
                    return []
                }
            }
        },
        20
    )

    assert.equal(history.length, 1)
    assert.equal(history[0].message_id, 'public-group-message-1')
    assert.equal(history[0].raw_message, '缓存历史消息')
    assert.deepEqual(calls, [])
})

test('群聊总结在 QQBot 下优先使用公开群号映射的内置消息缓存', async () => {
    messageCache.clear()
    for (let index = 0; index < 5; index++) {
        cacheQQBotMessage({
            bot: { adapter: { id: 'QQBot' } },
            message_id: `summary-message-${index}`,
            group_id: '987654321',
            _raw_group_id: 'summary-group-openid',
            user_id: `user-${index}`,
            sender: { user_id: `user-${index}`, nickname: `用户${index}` },
            message: [{ type: 'text', text: `第${index}条群聊消息` }]
        })
    }

    let historyCalled = false
    const bot = {
        adapter: { id: 'QQBot' },
        pickGroup() {
            return {
                async getChatHistory() {
                    historyCalled = true
                    return []
                }
            }
        }
    }

    const result = await GroupSummaryCore.collectMessages('summary-group-openid', 20, bot)
    assert.equal(result.dataSource, 'QQBot 本地消息索引')
    assert.equal(result.messages.length, 5)
    assert.equal(result.messages[0].content, '第0条群聊消息')
    assert.equal(historyCalled, false)
})
