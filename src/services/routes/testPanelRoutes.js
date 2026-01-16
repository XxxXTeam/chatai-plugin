import express from 'express'
import { channelManager } from '../llm/ChannelManager.js'
import { statsService } from '../stats/StatsService.js'
import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'

const router = express.Router()

// Response helper
class ApiResponse {
    static ok(data) {
        return { code: 0, data, message: 'ok' }
    }
    static fail(data, msg) {
        return { code: -1, data, message: msg }
    }
}

// 活跃的批量测试任务
const activeBatchTests = new Map()

// POST /api/test-panel/batch-test - 批量测试渠道模型（SSE）
router.post('/batch-test', async (req, res) => {
    const { channelId, models, concurrency = 3, clearPrevious = true } = req.body
    const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await channelManager.init()
    const channel = channelManager.get(channelId)

    if (!channel) {
        return res.status(404).json(ApiResponse.fail(null, '渠道不存在'))
    }

    const testModels = models && models.length > 0 ? models : channel.models || []
    if (testModels.length === 0) {
        return res.status(400).json(ApiResponse.fail(null, '没有可测试的模型'))
    }

    // 设置SSE响应
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    // 注册测试任务
    const testState = {
        id: testId,
        aborted: false,
        res,
        completed: 0,
        total: testModels.length,
        results: []
    }
    activeBatchTests.set(testId, testState)

    const sendEvent = (event, data) => {
        if (!testState.aborted && !res.writableEnded) {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        }
    }

    // 清空上次结果通知
    if (clearPrevious) {
        sendEvent('clear', { message: '清空上次结果' })
    }

    sendEvent('start', {
        testId,
        total: testModels.length,
        channelId,
        channelName: channel.name,
        concurrency
    })

    chatLogger.info(`[测试面板] 开始批量测试: ${channel.name}, ${testModels.length}个模型, 并发${concurrency}`)

    const results = []
    let completed = 0
    let running = 0
    let modelIndex = 0

    const testSingleModel = async (model, idx) => {
        if (testState.aborted) return null

        const startTime = Date.now()
        running++

        sendEvent('testing', { model, index: idx, running })

        try {
            const { OpenAIClient } = await import('../../core/adapters/index.js')

            let apiKey = channel.apiKey
            let keyInfo = null
            if (channel.apiKeys && channel.apiKeys.length > 0) {
                keyInfo = channelManager.getChannelKey(channel, { recordUsage: false })
                apiKey = keyInfo.key
            }

            const client = new OpenAIClient({
                apiKey,
                baseUrl: channel.baseUrl,
                chatPath: channel.chatPath, // 自定义对话路径
                customHeaders: channel.customHeaders || {},
                headersTemplate: channel.headersTemplate || '',
                requestBodyTemplate: channel.requestBodyTemplate || '',
                features: ['chat'],
                tools: []
            })

            const response = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: '你好' }] },
                { model, maxToken: 50, temperature: 0.7 }
            )

            const elapsed = Date.now() - startTime
            const replyText =
                response.contents
                    ?.filter(c => c?.type === 'text')
                    .map(c => c.text)
                    .join('') || ''

            const result = {
                model,
                index: idx,
                success: true,
                elapsed,
                response: replyText.substring(0, 100),
                keyInfo: keyInfo ? { name: keyInfo.keyName, index: keyInfo.keyIndex } : null
            }

            results.push(result)
            sendEvent('result', result)

            // 记录统计
            await statsService.recordApiCall({
                channelId,
                channelName: channel.name,
                model,
                keyIndex: keyInfo?.keyIndex ?? -1,
                keyName: keyInfo?.keyName ?? '',
                duration: elapsed,
                success: true,
                source: 'batch-test',
                responseText: replyText
            })

            return result
        } catch (error) {
            const elapsed = Date.now() - startTime
            const result = {
                model,
                index: idx,
                success: false,
                elapsed,
                error: error.message
            }
            results.push(result)
            sendEvent('result', result)

            // 记录失败统计
            await statsService.recordApiCall({
                channelId,
                channelName: channel.name,
                model,
                duration: elapsed,
                success: false,
                error: error.message,
                source: 'batch-test'
            })

            return result
        } finally {
            running--
            completed++
            sendEvent('progress', {
                completed,
                total: testModels.length,
                running,
                successCount: results.filter(r => r.success).length,
                failCount: results.filter(r => !r.success).length
            })
        }
    }

    // 并发执行测试
    const runBatch = async () => {
        const promises = []

        while (modelIndex < testModels.length && !testState.aborted) {
            while (running < concurrency && modelIndex < testModels.length && !testState.aborted) {
                const currentModel = testModels[modelIndex]
                const currentIdx = modelIndex
                modelIndex++
                promises.push(testSingleModel(currentModel, currentIdx))
            }
            await new Promise(r => setTimeout(r, 50))
        }

        // 等待所有完成
        await Promise.all(promises)
    }

    try {
        await runBatch()
    } catch (error) {
        chatLogger.error('[测试面板] 批量测试异常:', error)
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.length - successCount

    sendEvent('complete', {
        testId,
        total: testModels.length,
        success: successCount,
        failed: failCount,
        aborted: testState.aborted,
        results: results.sort((a, b) => a.index - b.index)
    })

    chatLogger.info(
        `[测试面板] 批量测试完成: 成功${successCount}, 失败${failCount}${testState.aborted ? ', 已中止' : ''}`
    )

    activeBatchTests.delete(testId)
    res.end()
})

// POST /api/test-panel/batch-test-stop - 停止批量测试
router.post('/batch-test-stop', async (req, res) => {
    const { testId } = req.body

    if (testId) {
        const testState = activeBatchTests.get(testId)
        if (testState) {
            testState.aborted = true
            chatLogger.info(`[测试面板] 停止测试: ${testId}`)
            res.json(ApiResponse.ok({ stopped: true, testId }))
        } else {
            res.json(ApiResponse.ok({ stopped: false, message: '测试任务不存在或已完成' }))
        }
    } else {
        // 停止所有测试
        let stoppedCount = 0
        for (const [id, state] of activeBatchTests) {
            state.aborted = true
            stoppedCount++
        }
        chatLogger.info(`[测试面板] 停止所有测试: ${stoppedCount}个`)
        res.json(ApiResponse.ok({ stopped: true, count: stoppedCount }))
    }
})

// GET /api/test-panel/active-tests - 获取活跃测试列表
router.get('/active-tests', async (req, res) => {
    const tests = []
    for (const [id, state] of activeBatchTests) {
        tests.push({
            id,
            completed: state.completed,
            total: state.total,
            aborted: state.aborted
        })
    }
    res.json(ApiResponse.ok(tests))
})

// POST /api/test-panel/quick-test - 快速测试单个模型
router.post('/quick-test', async (req, res) => {
    const { channelId, model, message = '说一声你好' } = req.body
    const startTime = Date.now()

    await channelManager.init()
    const channel = channelManager.get(channelId)

    if (!channel) {
        return res.status(404).json(ApiResponse.fail(null, '渠道不存在'))
    }

    try {
        const { OpenAIClient } = await import('../../core/adapters/index.js')

        let apiKey = channel.apiKey
        let keyInfo = null
        if (channel.apiKeys && channel.apiKeys.length > 0) {
            keyInfo = channelManager.getChannelKey(channel, { recordUsage: false })
            apiKey = keyInfo.key
        }

        const client = new OpenAIClient({
            apiKey,
            baseUrl: channel.baseUrl,
            chatPath: channel.chatPath, // 自定义对话路径
            features: ['chat'],
            tools: []
        })

        const response = await client.sendMessage(
            { role: 'user', content: [{ type: 'text', text: message }] },
            {
                model: model || channel.models?.[0],
                maxToken: 100,
                temperature: 0.7
            }
        )

        const elapsed = Date.now() - startTime
        const replyText =
            response.contents
                ?.filter(c => c?.type === 'text')
                .map(c => c.text)
                .join('') || ''

        res.json(
            ApiResponse.ok({
                success: true,
                model: model || channel.models?.[0],
                elapsed,
                response: replyText,
                keyInfo: keyInfo ? { name: keyInfo.keyName, index: keyInfo.keyIndex } : null
            })
        )
    } catch (error) {
        const elapsed = Date.now() - startTime
        res.status(500).json(
            ApiResponse.fail(
                {
                    success: false,
                    model: model || channel.models?.[0],
                    elapsed,
                    error: error.message
                },
                error.message
            )
        )
    }
})

// GET /api/test-panel/channel-models/:id - 获取渠道可测试模型列表
router.get('/channel-models/:id', async (req, res) => {
    await channelManager.init()
    const channel = channelManager.get(req.params.id)

    if (!channel) {
        return res.status(404).json(ApiResponse.fail(null, '渠道不存在'))
    }

    res.json(
        ApiResponse.ok({
            channelId: channel.id,
            channelName: channel.name,
            models: channel.models || [],
            status: channel.status,
            testedAt: channel.testedAt
        })
    )
})

export default router
