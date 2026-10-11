import assert from 'node:assert/strict'
import test from 'node:test'
import statsRouter from '../src/services/routes/statsRoutes.js'
import systemRouter from '../src/services/routes/systemRoutes.js'
import { statsService } from '../src/services/stats/StatsService.js'
import { usageStats } from '../src/services/stats/UsageStats.js'

function routeHandler(router, path) {
    const layer = router.stack.find(item => item.route?.path === path)
    assert.ok(layer, `route not found: ${path}`)
    return layer.route.stack[0].handle
}

async function invoke(handler, query) {
    let body
    const response = {
        statusCode: 200,
        status(code) {
            this.statusCode = code
            return this
        },
        json(value) {
            body = value
            return this
        }
    }
    await handler({ query }, response)
    assert.equal(response.statusCode, 200)
    return body
}

test('statsRoutes and systemRoutes ignore empty or invalid time query values', async () => {
    const originalGetRecentPaged = usageStats.getRecentPaged
    const originalGetApiCalls = statsService.getApiCalls
    const capturedRecent = []
    const capturedApiCalls = []
    usageStats.getRecentPaged = async (...args) => {
        capturedRecent.push(args)
        return { records: [], pagination: { total: 0 } }
    }
    statsService.getApiCalls = async options => {
        capturedApiCalls.push(options)
        return { records: [], pagination: { total: 0 } }
    }

    try {
        await invoke(routeHandler(statsRouter, '/usage/recent'), {
            page: '1',
            limit: '100',
            startTime: '',
            endTime: 'not-a-time'
        })
        await invoke(routeHandler(systemRouter, '/stats/usage/recent'), {
            page: '1',
            limit: '100',
            startTime: '',
            endTime: 'not-a-time'
        })
        await invoke(routeHandler(statsRouter, '/api-calls'), {
            page: '1',
            limit: '20',
            startTime: '',
            endTime: '0'
        })

        assert.deepEqual(capturedRecent, [
            [1, 100, {}],
            [1, 100, {}]
        ])
        assert.equal(capturedApiCalls.length, 1)
        assert.equal(capturedApiCalls[0].startTime, undefined)
        assert.equal(capturedApiCalls[0].endTime, 0)
    } finally {
        usageStats.getRecentPaged = originalGetRecentPaged
        statsService.getApiCalls = originalGetApiCalls
    }
})

test('StatsService.getApiCalls ignores invalid times and preserves zero before delegation', async () => {
    const original = usageStats.getRecentPaged
    const captured = []
    usageStats.getRecentPaged = async (...args) => {
        captured.push(args)
        return { records: [], pagination: { total: 0 } }
    }
    try {
        await statsService.getApiCalls({ startTime: Number.NaN, endTime: '' })
        await statsService.getApiCalls({ startTime: 0, endTime: 2000 })
        assert.deepEqual(captured, [
            [1, 20, {}],
            [1, 20, { startTime: 0, endTime: 2000 }]
        ])
    } finally {
        usageStats.getRecentPaged = original
    }
})
