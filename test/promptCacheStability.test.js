/**
 * @fileoverview prompt 缓存键服务与分钟粒度时间变量的稳定性测试
 * 覆盖：缓存键格式/轮换/清除、noteUsage 语义三分支、分钟时间格式化与替换链路
 */

import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'

import { formatMinuteTimestamp } from '../src/services/preset/PresetManager.js'
import {
    buildPromptCacheKey,
    clearChannel,
    getPromptCacheKey,
    noteUsage
} from '../src/services/llm/PromptCacheService.js'

const KEY_PATTERN = /^chatgpt-plugin-v1-[0-9a-f]{8}-\d+-\d+$/

/**
 * 生成定长随机字符串，用作测试渠道 id。
 * @param {number} len - 字符串长度
 * @returns {string} 随机字符串
 */
function randomId(len = 10) {
    return crypto
        .getRandomValues(new Uint8Array(len))
        .reduce((acc, byte) => acc + byte.toString(16).padStart(2, '0'), '')
}

test('buildPromptCacheKey 格式合规且同一渠道哈希段确定', () => {
    const channelId = randomId()
    const key = buildPromptCacheKey(channelId)
    assert.match(key, /^chatgpt-plugin-v1-[0-9a-f]{8}-\d+-\d+$/, '键格式应符合约定')
    assert.ok(key.includes('chatgpt-plugin-v1-'), '应包含前缀')

    const another = buildPromptCacheKey(channelId)
    assert.match(another, /^chatgpt-plugin-v1-[0-9a-f]{8}-\d+-\d+$/, '第二次构建的键格式也应合规')
    const hashPart = key.slice('chatgpt-plugin-v1-'.length, 'chatgpt-plugin-v1-'.length + 8)
    const otherHashPart = another.slice('chatgpt-plugin-v1-'.length, 'chatgpt-plugin-v1-'.length + 8)
    assert.equal(hashPart, otherHashPart, '同一渠道的哈希段应保持确定')
    assert.notEqual(key, another, '时间戳/计数应保证键唯一')
})

test('buildPromptCacheKey 非字符串渠道先 String 化', () => {
    const key = buildPromptCacheKey(123456789)
    assert.match(key, KEY_PATTERN, '数字渠道也应产出合规键')
})

test('getPromptCacheKey 创建并复用活跃键', () => {
    const channelId = `chan-${randomId()}`
    const key = getPromptCacheKey(channelId)
    const again = getPromptCacheKey(channelId)
    assert.match(key, KEY_PATTERN, '创建的键格式合规')
    assert.equal(key, again, '活跃键应被复用以维持服务商缓存前缀')
})

test('noteUsage 命中无效化前持续返回 hit', () => {
    const channelId = `chan-${randomId()}`
    getPromptCacheKey(channelId)
    const result = noteUsage(channelId, { cacheReadTokens: 100, cacheCreationTokens: 0 })
    assert.equal(result, 'hit', '只读无写为命中')
})

test('noteUsage miss 后活跃键轮换', () => {
    const channelId = `chan-${randomId()}`
    const beforeKey = getPromptCacheKey(channelId)
    const result = noteUsage(channelId, { cacheReadTokens: 100, cacheCreationTokens: 50 })
    assert.equal(result, 'miss', '同时读写视为旧键被淘汰的 miss')
    const afterKey = getPromptCacheKey(channelId)
    assert.notEqual(afterKey, beforeKey, '轮换后活跃键应变化')
    assert.match(afterKey, KEY_PATTERN, '新键格式合规')
})

test('noteUsage 首次写同样轮换', () => {
    const channelId = `chan-${randomId()}`
    const beforeKey = getPromptCacheKey(channelId)
    const result = noteUsage(channelId, { cacheReadTokens: 0, cacheCreationTokens: 20 })
    assert.equal(result, 'miss', '首次写或旧键失效为 miss')
    assert.notEqual(getPromptCacheKey(channelId), beforeKey, '轮换后键应变化')
})

test('noteUsage 读写均为零或 usage 为空返回 none 且键不变', () => {
    const channelId = `chan-${randomId()}`
    const beforeKey = getPromptCacheKey(channelId)
    assert.equal(noteUsage(channelId, {}), 'none', '空 usage 为 none')
    assert.equal(noteUsage(channelId, null), 'none', 'null usage 为 none')
    assert.equal(noteUsage(channelId, undefined), 'none', 'undefined usage 为 none')
    assert.equal(getPromptCacheKey(channelId), beforeKey, 'none 情形不应轮换键')

    const normalized = noteUsage(channelId, { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    assert.equal(normalized, 'none', '归一化字段为 0 时同样返回 none')
})

test('noteUsage 兼容归一化字段与 cacheWriteTokens', () => {
    const channelId = `chan-${randomId()}`
    getPromptCacheKey(channelId)
    assert.equal(noteUsage(channelId, { cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }), 'hit')

    const missChannel = `chan-${randomId()}`
    getPromptCacheKey(missChannel)
    assert.equal(noteUsage(missChannel, { cacheWriteTokens: 30 }), 'miss')
})

test('clearChannel 后再次获取得到新键', () => {
    const channelId = `chan-${randomId()}`
    const beforeKey = getPromptCacheKey(channelId)
    clearChannel(channelId)
    const afterKey = getPromptCacheKey(channelId)
    assert.notEqual(afterKey, beforeKey, '清除后应创建全新键')
    assert.match(afterKey, KEY_PATTERN, '新键格式合规')

    clearChannel(channelId)
    assert.ok(true, '重复清除不应报错')
})

test('不同渠道的缓存键互不相同', () => {
    const first = getPromptCacheKey(`chan-${randomId()}`)
    const second = getPromptCacheKey(`chan-${randomId()}`)
    assert.notEqual(first, second, '不同渠道之间不应串扰')
})

test('formatMinuteTimestamp 输出 YYYY/MM/DD HH:mm 且分钟粒度稳定', () => {
    const now = new Date(2026, 8, 20, 14, 32, 45)
    const formatted = formatMinuteTimestamp(now)
    assert.equal(formatted, '2026/09/20 14:32', '固定日期应产出精确字符串')
    assert.match(formatted, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/, '输出形状合规')

    const timeSuffix = formatted.slice(11)
    assert.match(timeSuffix, /^\d{2}:\d{2}$/, '切出的 minutes 部分形状为 HH:mm')

    const laterSecond = new Date(2026, 8, 20, 14, 32, 59)
    assert.equal(formatMinuteTimestamp(laterSecond), formatted, '同一分钟内应产出相同字符串')

    const nextMinute = new Date(2026, 8, 20, 14, 33, 0)
    assert.equal(formatMinuteTimestamp(nextMinute), '2026/09/20 14:33', '跨分钟后应正确进位')

    const zeroPadded = new Date(2026, 0, 2, 3, 5)
    assert.equal(formatMinuteTimestamp(zeroPadded), '2026/01/02 03:05', '月份/日期/小时应补零')
})
