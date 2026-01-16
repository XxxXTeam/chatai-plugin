import express from 'express'
import { channelManager, normalizeBaseUrl } from '../llm/ChannelManager.js'
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

// GET /api/channels/list
router.get('/list', async (req, res) => {
    try {
        await channelManager.init()
        const channels = req.query.withStats ? channelManager.getAllWithStats() : channelManager.getAll()
        res.json(ApiResponse.ok(channels))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/channels/stats
router.get('/stats', async (req, res) => {
    try {
        await channelManager.init()
        const stats = channelManager.getStats(req.query.id)
        res.json(ApiResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// POST /api/channels
router.post('/', async (req, res) => {
    try {
        await channelManager.init()
        const channel = await channelManager.create(req.body)
        res.status(201).json(ApiResponse.ok(channel))
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// PUT /api/channels/:id
router.put('/:id', async (req, res) => {
    try {
        await channelManager.init()
        const channel = await channelManager.update(req.params.id, req.body)
        if (channel) {
            res.json(ApiResponse.ok(channel))
        } else {
            res.status(404).json(ApiResponse.fail(null, 'Channel not found'))
        }
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// DELETE /api/channels/:id
router.delete('/:id', async (req, res) => {
    try {
        await channelManager.init()
        const deleted = await channelManager.delete(req.params.id)
        if (deleted) {
            res.json(ApiResponse.ok(null))
        } else {
            res.status(404).json(ApiResponse.fail(null, 'Channel not found'))
        }
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// GET /api/channels/:id
router.get('/:id', async (req, res) => {
    try {
        await channelManager.init()
        const channel = channelManager.get(req.params.id)
        if (channel) {
            res.json(ApiResponse.ok(channel))
        } else {
            res.status(404).json(ApiResponse.fail(null, 'Channel not found'))
        }
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// POST /api/channels/test - Test single channel
router.post('/test', async (req, res) => {
    let { id, adapterType, baseUrl, apiKey, apiKeys, models, advanced, strategy, chatPath } = req.body
    const startTime = Date.now()

    let usedKeyIndex = -1
    let usedKeyName = ''
    let usedStrategy = ''
    let channelName = id || '临时测试'

    if (id) {
        const channel = channelManager.get(id)
        if (channel) {
            channelName = channel.name || id
            adapterType = channel.adapterType
            baseUrl = channel.baseUrl
            chatPath = channel.chatPath // 获取渠道的自定义对话路径
            models = channel.models
            advanced = channel.advanced || advanced

            if (channel.apiKeys && channel.apiKeys.length > 0) {
                const keyInfo = channelManager.getChannelKey(channel, { recordUsage: false })
                apiKey = keyInfo.key
                usedKeyIndex = keyInfo.keyIndex
                usedKeyName = keyInfo.keyName
                usedStrategy = keyInfo.strategy
            } else {
                apiKey = channel.apiKey
            }
        }
    } else if (apiKeys && apiKeys.length > 0) {
        usedStrategy = strategy || 'round-robin'
        let idx = usedStrategy === 'random' ? Math.floor(Math.random() * apiKeys.length) : 0
        const keyObj = apiKeys[idx]
        apiKey = typeof keyObj === 'string' ? keyObj : keyObj.key
        usedKeyIndex = idx
        usedKeyName = typeof keyObj === 'object' ? keyObj.name : `Key#${idx + 1}`
    }

    if (!id && baseUrl) {
        baseUrl = normalizeBaseUrl(baseUrl, adapterType)
    }

    const testMessage = '说一声你好'

    // 获取渠道的完整配置（与实际对话一致）
    let customHeaders = {}
    let headersTemplate = ''
    let requestBodyTemplate = ''
    if (id) {
        const channel = channelManager.get(id)
        if (channel) {
            customHeaders = channel.customHeaders || {}
            headersTemplate = channel.headersTemplate || ''
            requestBodyTemplate = channel.requestBodyTemplate || ''
        }
    }

    try {
        if (adapterType === 'openai') {
            const { OpenAIClient } = await import('../../core/adapters/index.js')
            const client = new OpenAIClient({
                apiKey: apiKey || config.get('openai.apiKey'),
                baseUrl: baseUrl || config.get('openai.baseUrl'),
                chatPath: chatPath, // 自定义对话路径
                customHeaders, // 自定义请求头
                headersTemplate, // 请求头模板
                requestBodyTemplate, // 请求体模板
                features: ['chat'],
                tools: []
            })

            const testModel = models && models.length > 0 ? models[0] : 'gpt-3.5-turbo'
            // 应用模型映射/重定向
            let actualTestModel = testModel
            if (id) {
                const mapping = channelManager.getActualModel(id, testModel)
                if (mapping.mapped) {
                    actualTestModel = mapping.actualModel
                    chatLogger.info(`[渠道测试] 模型重定向: ${testModel} -> ${actualTestModel}`)
                }
            }
            const useStreaming = advanced?.streaming?.enabled || false
            const temperature = advanced?.llm?.temperature ?? 0.7
            const maxTokens = advanced?.llm?.maxTokens || 100

            const options = {
                model: actualTestModel,
                maxToken: maxTokens,
                temperature
            }

            let replyText = ''
            let apiUsage = null

            if (useStreaming) {
                const stream = await client.streamMessage(
                    [{ role: 'user', content: [{ type: 'text', text: testMessage }] }],
                    options
                )
                for await (const chunk of stream) {
                    if (typeof chunk === 'string') {
                        replyText += chunk
                    } else if (chunk.type === 'text') {
                        replyText += chunk.text
                    } else if (chunk.type === 'usage' || chunk.usage) {
                        apiUsage = chunk.usage || chunk
                    }
                }
            } else {
                const response = await client.sendMessage(
                    { role: 'user', content: [{ type: 'text', text: testMessage }] },
                    options
                )
                if (!response || !response.contents || !Array.isArray(response.contents)) {
                    return res.status(500).json(ApiResponse.fail(null, '连接失败: API响应格式不正确'))
                }
                replyText = response.contents
                    .filter(c => c && c.type === 'text')
                    .map(c => c.text)
                    .join('')
                apiUsage = response.usage
            }

            const elapsed = Date.now() - startTime

            await statsService.recordApiCall({
                channelId: id || 'test',
                channelName,
                model: testModel,
                keyIndex: usedKeyIndex,
                keyName: usedKeyName,
                strategy: usedStrategy,
                duration: elapsed,
                success: true,
                source: 'test',
                responseText: replyText || '',
                apiUsage
            })

            if (id) {
                const channel = channelManager.get(id)
                if (channel) {
                    channel.status = 'active'
                    channel.lastHealthCheck = Date.now()
                    channel.testedAt = Date.now()
                    await channelManager.saveToConfig()
                }
            }

            res.json(
                ApiResponse.ok({
                    success: true,
                    message: `连接成功！耗时 ${elapsed}ms`,
                    testResponse: replyText,
                    elapsed,
                    model: testModel,
                    keyInfo:
                        usedKeyIndex >= 0 ? { index: usedKeyIndex, name: usedKeyName, strategy: usedStrategy } : null
                })
            )
        } else {
            res.json(ApiResponse.ok({ success: true, message: '该适配器暂不支持测试' }))
        }
    } catch (error) {
        const elapsed = Date.now() - startTime
        chatLogger.error('[测试渠道] 错误:', error.message)

        await statsService.recordApiCall({
            channelId: id || 'test',
            channelName,
            model: models?.[0] || 'unknown',
            keyIndex: usedKeyIndex,
            keyName: usedKeyName,
            duration: elapsed,
            success: false,
            error: error.message,
            source: 'test'
        })

        if (id) {
            const channel = channelManager.get(id)
            if (channel) {
                channel.status = 'error'
                channel.lastHealthCheck = Date.now()
                await channelManager.saveToConfig()
            }
        }

        res.status(500).json(ApiResponse.fail(null, `连接失败: ${error.message}`))
    }
})

// POST /api/channels/fetch-models
router.post('/fetch-models', async (req, res) => {
    let { adapterType, baseUrl, apiKey, modelsPath } = req.body

    if (baseUrl) {
        baseUrl = normalizeBaseUrl(baseUrl, adapterType)
    }

    try {
        if (adapterType === 'openai') {
            // 如果有自定义 modelsPath，使用自定义路径获取模型
            if (modelsPath) {
                const finalUrl = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + modelsPath
                chatLogger.debug(`[获取模型] 使用自定义路径: ${finalUrl}`)

                const response = await fetch(finalUrl, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                })

                if (!response.ok) {
                    const text = await response.text()
                    throw new Error(`API请求失败: ${response.status} ${text}`)
                }

                const data = await response.json()
                let models = []

                // 支持不同的响应格式
                if (Array.isArray(data)) {
                    models = data.map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
                } else if (data.data && Array.isArray(data.data)) {
                    models = data.data.map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
                } else if (data.models && Array.isArray(data.models)) {
                    models = data.models.map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
                }

                return res.json(ApiResponse.ok({ models: models.sort() }))
            }

            // 默认使用 OpenAI SDK
            const OpenAI = (await import('openai')).default
            const openai = new OpenAI({
                apiKey: apiKey || config.get('openai.apiKey'),
                baseURL: baseUrl || config.get('openai.baseUrl'),
                defaultHeaders: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            const modelsList = await openai.models.list()

            if (!modelsList || !modelsList.data || !Array.isArray(modelsList.data)) {
                return res.status(500).json(ApiResponse.fail(null, 'API返回格式不正确'))
            }

            const isOfficialOpenAI = !baseUrl || baseUrl.includes('api.openai.com')
            let models = modelsList.data.map(m => m.id)

            if (isOfficialOpenAI) {
                models = models.filter(
                    id => id.includes('gpt') || id.includes('text-embedding') || id.includes('o1') || id.includes('o3')
                )
            }

            res.json(ApiResponse.ok({ models: models.sort() }))
        } else {
            res.status(400).json(ApiResponse.fail(null, '不支持的适配器类型'))
        }
    } catch (error) {
        chatLogger.error('[获取模型] 错误:', error.message)
        res.status(500).json(ApiResponse.fail(null, `获取模型失败: ${error.message}`))
    }
})

// POST /api/channels/batch-test - Batch test multiple models (JSON response)
router.post('/batch-test', async (req, res) => {
    const { channelId, models, concurrency = 3 } = req.body

    await channelManager.init()
    const channel = channelManager.get(channelId)

    if (!channel) {
        return res.status(404).json(ApiResponse.fail(null, 'Channel not found'))
    }

    const testModels = models || channel.models || []
    if (testModels.length === 0) {
        return res.status(400).json(ApiResponse.fail(null, '没有可测试的模型'))
    }

    const results = []

    const testSingleModel = async model => {
        const startTime = Date.now()
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
                chatPath: channel.chatPath,
                features: ['chat'],
                tools: []
            })

            // 应用模型映射/重定向
            const mapping = channelManager.getActualModel(channelId, model)
            const actualModel = mapping.actualModel

            const response = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                { model: actualModel, maxToken: 50, temperature: 0.7 }
            )

            const elapsed = Date.now() - startTime
            const replyText =
                response.contents
                    ?.filter(c => c?.type === 'text')
                    .map(c => c.text)
                    .join('') || ''

            return {
                model,
                success: true,
                elapsed,
                response: replyText.substring(0, 100),
                keyInfo: keyInfo ? { name: keyInfo.keyName, index: keyInfo.keyIndex } : null
            }
        } catch (error) {
            return {
                model,
                success: false,
                elapsed: Date.now() - startTime,
                error: error.message
            }
        }
    }

    // 并发执行测试
    for (let i = 0; i < testModels.length; i += concurrency) {
        const batch = testModels.slice(i, i + concurrency)
        const batchResults = await Promise.all(batch.map(testSingleModel))
        results.push(...batchResults)
    }

    const successCount = results.filter(r => r.success).length
    res.json(
        ApiResponse.ok({
            total: testModels.length,
            success: successCount,
            failed: testModels.length - successCount,
            channelId,
            channelName: channel.name,
            results
        })
    )
})

// POST /api/channels/test-model - Test a single specific model
router.post('/test-model', async (req, res) => {
    const { channelId, model } = req.body

    if (!channelId || !model) {
        return res.status(400).json(ApiResponse.fail(null, 'channelId and model are required'))
    }

    await channelManager.init()
    const channel = channelManager.get(channelId)

    if (!channel) {
        return res.status(404).json(ApiResponse.fail(null, 'Channel not found'))
    }

    const startTime = Date.now()
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

        // 应用模型映射/重定向
        const mapping = channelManager.getActualModel(channelId, model)
        const actualModel = mapping.actualModel
        if (mapping.mapped) {
            chatLogger.info(`[单模型测试] 模型重定向: ${model} -> ${actualModel}`)
        }

        const response = await client.sendMessage(
            { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
            { model: actualModel, maxToken: 50, temperature: 0.7 }
        )

        const elapsed = Date.now() - startTime
        const replyText =
            response.contents
                ?.filter(c => c?.type === 'text')
                .map(c => c.text)
                .join('') || ''

        res.json(
            ApiResponse.ok({
                model,
                success: true,
                elapsed,
                response: replyText.substring(0, 100),
                keyInfo: keyInfo ? { name: keyInfo.keyName, index: keyInfo.keyIndex } : null
            })
        )
    } catch (error) {
        res.json(
            ApiResponse.ok({
                model,
                success: false,
                elapsed: Date.now() - startTime,
                error: error.message
            })
        )
    }
})

export default router
