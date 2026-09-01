import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'

import {
    cacheQQBotMessage,
    getCachedMessage,
    getRecentGroupMessages,
    getRecentQQBotMessages,
    messageCache,
    registerQQBotMessageCache
} from '../src/services/storage/MessageCache.js'

test('QQBot 消息缓存同时支持公开群号与 OpenID', () => {
    messageCache.clear()
    cacheQQBotMessage({
        bot: { adapter: { id: 'QQBot' } },
        message_id: 'qqbot-message-1',
        group_id: '123456789',
        _raw_group_id: 'group-openid-1',
        user_id: 'user-openid-1',
        sender: { user_id: 'user-openid-1', nickname: '用户一' },
        time: 1720000000,
        message: [{ type: 'text', text: '缓存正文' }]
    })

    const byGroupNumber = getRecentGroupMessages('123456789', 10)
    const byOpenId = getRecentGroupMessages('group-openid-1', 10)

    assert.equal(byGroupNumber.length, 1)
    assert.deepEqual(byOpenId, byGroupNumber)
    assert.equal(byGroupNumber[0].message_id, 'qqbot-message-1')
    assert.equal(byGroupNumber[0].content, '缓存正文')
    assert.equal(getCachedMessage('qqbot-message-1')._raw_group_id, 'group-openid-1')
})

test('QQBot 全局消息监听建立本地映射并可按双群标识读取', () => {
    messageCache.clear()
    const bot = new EventEmitter()
    assert.equal(registerQQBotMessageCache(bot), true)
    assert.equal(registerQQBotMessageCache(bot), false)

    let cachedBeforeNextListener = false
    bot.on('message', event => {
        cachedBeforeNextListener = !!getCachedMessage(event.message_id)
    })

    bot.emit('message', {
        bot: { adapter: { id: 'QQBot' } },
        message_id: 'qqbot-received-message',
        group_id: '112233445',
        _raw_group_id: 'received-group-openid',
        user_id: 'received-user-openid',
        sender: { user_id: 'received-user-openid', nickname: '收到用户' },
        message: [{ type: 'text', text: '收到即缓存' }]
    })

    const byGroupNumber = getRecentQQBotMessages('112233445')
    const byOpenId = getRecentQQBotMessages('received-group-openid')
    assert.deepEqual(byOpenId, byGroupNumber)
    assert.equal(byGroupNumber.length, 1)
    assert.equal(byGroupNumber[0].message_id, 'qqbot-received-message')
    assert.equal(byGroupNumber[0].content, '收到即缓存')
    assert.equal(cachedBeforeNextListener, true)

    cacheQQBotMessage({
        bot: { adapter: { id: 'QQBot' } },
        message_id: 'qqbot-private-message',
        user_id: 'private-user-openid'
    })
    assert.equal(getCachedMessage('qqbot-private-message').isQQBot, true)
})
