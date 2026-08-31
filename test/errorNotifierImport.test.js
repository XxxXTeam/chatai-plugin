import assert from 'node:assert/strict'
import { test } from 'node:test'

test('错误通知服务从 services 目录正确解析标准机器人接口', async () => {
    const module = await import('../src/services/ErrorNotifier.js')

    assert.equal(typeof module.errorNotifier?.notify, 'function')
})
