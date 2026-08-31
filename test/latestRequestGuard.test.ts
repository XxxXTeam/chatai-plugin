import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLatestRequestGate } from '../frontend/lib/latest-request.ts'

function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(next => {
        resolve = next
    })
    return { promise, resolve }
}

test('乱序完成时仅最后一次请求可以写回', async () => {
    const gate = createLatestRequestGate()
    const first = deferred<string>()
    const second = deferred<string>()
    const applied: string[] = []

    const run = async (request: Promise<string>) => {
        const requestId = gate.begin()
        const value = await request
        if (gate.isCurrent(requestId)) applied.push(value)
    }

    const firstRun = run(first.promise)
    const secondRun = run(second.promise)
    second.resolve('第二个文件')
    await secondRun
    first.resolve('第一个文件')
    await firstRun

    assert.deepEqual(applied, ['第二个文件'])
})

test('失效后的在途请求不能写回', async () => {
    const gate = createLatestRequestGate()
    const requestId = gate.begin()
    gate.invalidate()
    assert.equal(gate.isCurrent(requestId), false)
})
