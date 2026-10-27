import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { afterEach, describe, test } from 'node:test'

import { redisClient } from '../src/core/cache/RedisClient.js'

class FakeClient extends EventEmitter {
    constructor(status = 'connecting') {
        super()
        this.status = status
    }
}

const originalClient = redisClient.client
const originalConnected = redisClient.isConnected

afterEach(() => {
    redisClient.client = originalClient
    redisClient.isConnected = originalConnected
})

describe('RedisClient.waitForReady（启动阶段等待连接就绪）', () => {
    test('未初始化时立即返回 false，不阻塞启动', async () => {
        redisClient.client = null
        assert.equal(await redisClient.waitForReady(50), false)
    })

    test('已 ready 时立即返回 true 并同步 isConnected', async () => {
        redisClient.client = new FakeClient('ready')
        redisClient.isConnected = false

        assert.equal(await redisClient.waitForReady(50), true)
        assert.equal(redisClient.isConnected, true)
    })

    test('连接中的客户端在 ready 事件后返回 true', async () => {
        const client = new FakeClient('connecting')
        redisClient.client = client

        const pending = redisClient.waitForReady(1000)
        setTimeout(() => client.emit('ready'), 10)

        assert.equal(await pending, true)
    })

    test('连接结束（end）时返回 false', async () => {
        const client = new FakeClient('connecting')
        redisClient.client = client

        const pending = redisClient.waitForReady(1000)
        setTimeout(() => client.emit('end'), 10)

        assert.equal(await pending, false)
    })

    test('超时返回 false，避免启动无限等待', async () => {
        redisClient.client = new FakeClient('connecting')

        const start = Date.now()
        assert.equal(await redisClient.waitForReady(30), false)
        assert.ok(Date.now() - start >= 25)
    })
})
