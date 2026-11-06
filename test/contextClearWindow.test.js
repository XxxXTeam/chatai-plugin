/**
 * @fileoverview 结束对话清空标记的作用窗口测试
 * 覆盖：只保护清空后的首条消息、只读检查不消耗额度、不同会话隔离与过期清理
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PresetManager } from '../src/services/preset/PresetManager.js'

test('结束对话标记只清空首条消息，第二条消息恢复历史', () => {
    const manager = new PresetManager()
    const conversationId = 'test:context-clear-window'
    manager.markContextCleared(conversationId)

    // 构建提示词等只读检查不消耗额度
    assert.equal(manager.isContextCleared(conversationId, { consume: false }), true)
    // 首条消息消费标记，历史被清空
    assert.equal(manager.isContextCleared(conversationId), true)
    // 第二条消息必须能读到首条消息产生的新上下文，不能再被当成新会话
    assert.equal(manager.isContextCleared(conversationId), false)
})

test('重复的只读检查不会消耗清空额度', () => {
    const manager = new PresetManager()
    const conversationId = 'test:context-clear-debug-read'
    manager.markContextCleared(conversationId)

    // 构建提示词、debugInfo 等只读检查可以多次调用，不能把额度吃掉
    assert.equal(manager.isContextCleared(conversationId, { consume: false }), true)
    assert.equal(manager.isContextCleared(conversationId, { consume: false }), true)
    assert.equal(manager.isContextCleared(conversationId, { consume: false }), true)
    // 首条消息仍然消费到标记
    assert.equal(manager.isContextCleared(conversationId), true)
    // 第二条消息不再被当成新会话
    assert.equal(manager.isContextCleared(conversationId), false)
})

test('不同会话的结束对话标记互不影响', () => {
    const manager = new PresetManager()
    manager.markContextCleared('test:context-clear-a')

    assert.equal(manager.isContextCleared('test:context-clear-a'), true)
    assert.equal(manager.isContextCleared('test:context-clear-b'), false)
})

test('过期的结束对话标记不再生效并被清理', () => {
    const manager = new PresetManager()
    const conversationId = 'test:context-clear-expired'
    manager.markContextCleared(conversationId)

    manager.clearedContexts.get(conversationId).clearedAt = Date.now() - 6 * 60 * 1000

    assert.equal(manager.isContextCleared(conversationId), false)
    assert.equal(manager.clearedContexts.has(conversationId), false)
})
