/**
 * @fileoverview 引用回复群聊/私聊分流测试
 * 覆盖：群聊/私聊独立开关、旧配置回退、group_id 识别与非法值回退
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isGroupChatEvent, resolveQuoteReply } from '../src/utils/replySettings.js'

test('群聊使用 quoteReplyGroup，私聊使用 quoteReplyPrivate', () => {
    const basic = { quoteReply: true, quoteReplyGroup: false, quoteReplyPrivate: true }

    assert.equal(resolveQuoteReply({ isGroup: true }, basic), false)
    assert.equal(resolveQuoteReply({ isGroup: false }, basic), true)
})

test('群聊和私聊可以分别关闭', () => {
    const basic = { quoteReply: true, quoteReplyGroup: true, quoteReplyPrivate: false }

    assert.equal(resolveQuoteReply({ isGroup: true }, basic), true)
    assert.equal(resolveQuoteReply({ isGroup: false }, basic), false)
})

test('缺少新键时回退旧 quoteReply', () => {
    assert.equal(resolveQuoteReply({ isGroup: true }, { quoteReply: false }), false)
    assert.equal(resolveQuoteReply({ isGroup: false }, { quoteReply: false }), false)
    assert.equal(resolveQuoteReply({ isGroup: true }, { quoteReply: true }), true)
    assert.equal(resolveQuoteReply({ isGroup: false }, { quoteReply: true }), true)
})

test('新键不是布尔值时回退旧 quoteReply', () => {
    const basic = { quoteReply: true, quoteReplyGroup: 'false', quoteReplyPrivate: null }

    assert.equal(resolveQuoteReply({ isGroup: true }, basic), true)
    assert.equal(resolveQuoteReply({ isGroup: false }, basic), true)
})

test('group_id 与 data.group_id 也识别为群聊', () => {
    const basic = { quoteReply: true, quoteReplyGroup: false, quoteReplyPrivate: true }

    assert.equal(isGroupChatEvent({ group_id: '123' }), true)
    assert.equal(isGroupChatEvent({ data: { group_id: '123' } }), true)
    assert.equal(isGroupChatEvent({ user_id: '123' }), false)
    assert.equal(resolveQuoteReply({ group_id: '123' }, basic), false)
    assert.equal(resolveQuoteReply({ data: { group_id: '123' } }, basic), false)
})
