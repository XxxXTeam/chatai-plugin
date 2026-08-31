import assert from 'node:assert/strict'
import test from 'node:test'
import {
    getGroupHistory,
    GroupContextCollector,
    ICQQGroupContextCollector,
    TRSSGroupContextCollector
} from '../src/utils/group.js'

test('旧群历史收集器统一委托标准对象并保留字符串群标识', async () => {
    const calls = []
    const history = [{ message_id: 'message-openid', raw_message: '正文' }]
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
        assert.equal((await new Collector().collect(bot, 'group_openid', 'message_openid', 500))[0], history[0])
    }
    assert.deepEqual(calls[0], ['pickGroup', 'group_openid'])
    assert.deepEqual(calls[1], ['getChatHistory', 'message_openid', 200])
    assert.equal(
        calls.every(call => !call.includes(500)),
        true
    )
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

test('getGroupHistory 在 QQBot 下使用事件 message_id 作为缓存锚点', async () => {
    const calls = []
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
    assert.equal(history[0].message_id, 'message-openid')
    assert.deepEqual(calls, [['message-openid', 3]])
})
