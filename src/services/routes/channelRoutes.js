import express from 'express'
import { channelManager, normalizeBaseUrl } from '../llm/ChannelManager.js'
import { statsService } from '../stats/StatsService.js'
import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'
import { resolveThinkingOptions } from '../llm/ThinkingOptions.js'
import { resolveTemperature } from '../llm/TemperatureResolver.js'

import { ApiResponse } from './shared.js'

const router = express.Router()

/**
 * 规范化上游返回的模型列表
 *
 * 原实现对 api.openai.com 额外做白名单过滤（仅保留含 gpt / text-embedding / o1 / o3 的条目），
 * 会让 o4-mini、codex-*、dall-e-*、whisper-*、tts-*、sora-* 等模型在面板中不可选，
 * 且 includes('o1') 会误伤任意含该子串的模型名；该接口还被图像生成页面复用来选取绘图模型，
 * 任何按用途划定的白名单都会误伤，故仅做去重与排序，不再过滤。
 *
 * @param {string[]|any} models - 适配器 listModels 的返回值
 * @returns {string[]} 去重并按字典序排序后的模型 ID 列表
 */
export function normalizeModelList(models) {
    if (!Array.isArray(models)) return []
    return [...new Set(models.filter(id => typeof id === 'string' && id.trim()))].sort()
}

function getAdapterClientClass(adapterType = 'openai') {
    switch (adapterType) {
        case 'gemini':
            return import('../../core/adapters/index.js').then(m => m.GeminiClient)
        case 'claude':
            return import('../../core/adapters/index.js').then(m => m.ClaudeClient)
        default:
            return import('../../core/adapters/index.js').then(m => m.OpenAIClient)
    }
}

async function createChannelTestClient({ adapterType, apiKey, baseUrl, channel = {}, overrides = {} }) {
    const ClientClass = await getAdapterClientClass(adapterType)
    const thinkingOptions = resolveThinkingOptions({ channel })
    return new ClientClass({
        apiKey,
        baseUrl,
        chatPath: overrides.chatPath ?? channel.chatPath ?? '',
        modelsPath: overrides.modelsPath ?? channel.modelsPath ?? '',
        responsePath: overrides.responsePath ?? channel.responsePath ?? channel.endpoints?.responses ?? '',
        endpoints: overrides.endpoints ?? channel.endpoints ?? {},
        apiInterface:
            overrides.apiInterface ??
            overrides.openaiApiInterface ??
            channel.apiInterface ??
            channel.openaiApiInterface ??
            'chat',
        openaiApiInterface:
            overrides.apiInterface ??
            overrides.openaiApiInterface ??
            channel.apiInterface ??
            channel.openaiApiInterface ??
            'chat',
        experimental: overrides.experimental ?? channel.experimental ?? {},
        openaiResponses: overrides.openaiResponses ?? channel.openaiResponses ?? {},
        customHeaders: channel.customHeaders || {},
        headersTemplate: channel.headersTemplate || '',
        requestBodyTemplate: channel.requestBodyTemplate || '',
        systemPromptConfig: channel.systemPromptConfig || null,
        imageConfig: channel.imageConfig || {},
        enableReasoning: thinkingOptions.enableReasoning,
        reasoningEffort: thinkingOptions.reasoningEffort,
        thinkingVendorControl: thinkingOptions.thinkingVendorControl,
        ...(thinkingOptions.reasoningBudgetTokens !== undefined
            ? { reasoningBudgetTokens: thinkingOptions.reasoningBudgetTokens }
            : {}),
        channelId: channel.id,
        channelName: channel.name,
        features: ['chat'],
        tools: []
    })
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
    let {
        id,
        adapterType,
        baseUrl,
        apiKey,
        apiKeys,
        models,
        advanced,
        strategy,
        chatPath,
        responsePath,
        endpoints,
        apiInterface,
        openaiApiInterface,
        experimental,
        openaiResponses
    } = req.body || {}
    const startTime = Date.now()

    let usedKeyIndex = -1
    let usedKeyName = ''
    let usedStrategy = ''
    let channelName = id || '临时测试'

    try {
        // 准备阶段同样置于 try 内：handler 是 async 函数，此处的同步抛错会变成 unhandledRejection 而非 500 响应
        if (id) {
            const channel = channelManager.get(id)
            if (channel) {
                channelName = channel.name || id
                adapterType = channel.adapterType
                baseUrl = channel.baseUrl
                chatPath = channel.chatPath // 获取渠道的自定义对话路径
                responsePath = channel.responsePath || channel.endpoints?.responses || ''
                endpoints = channel.endpoints || {}
                apiInterface = channel.apiInterface || channel.openaiApiInterface || 'chat'
                openaiApiInterface = apiInterface
                experimental = channel.experimental || {}
                openaiResponses = channel.openaiResponses || {}
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
        let imageConfig = {}
        let systemPromptConfig = null
        if (id) {
            const channel = channelManager.get(id)
            if (channel) {
                customHeaders = channel.customHeaders || {}
                headersTemplate = channel.headersTemplate || ''
                requestBodyTemplate = channel.requestBodyTemplate || ''
                imageConfig = channel.imageConfig || {}
                systemPromptConfig = channel.systemPromptConfig || null
            }
        }

        const channel = id ? channelManager.get(id) || {} : {}
        const client = await createChannelTestClient({
            adapterType,
            apiKey: apiKey || (adapterType === 'openai' ? config.get('openai.apiKey') : ''),
            baseUrl: baseUrl || (adapterType === 'openai' ? config.get('openai.baseUrl') : ''),
            channel: {
                ...channel,
                customHeaders,
                headersTemplate,
                requestBodyTemplate,
                imageConfig,
                systemPromptConfig
            },
            overrides: {
                chatPath,
                responsePath,
                endpoints: endpoints || {},
                apiInterface: apiInterface || openaiApiInterface || 'chat',
                openaiApiInterface: apiInterface || openaiApiInterface || 'chat',
                experimental: experimental || {},
                openaiResponses: openaiResponses || {}
            }
        })

        /*
         * 渠道未配置 models 时的健康检查兜底模型。
         * 原先 openai 侧硬编码的模型已被上游下线，会让未配 models 的渠道恒返回假失败；
         * 现改为读 llm.healthCheckModels，便于自建/中转网关按实际可用模型覆盖。
         */
        const configuredHealthModels = config.get('llm.healthCheckModels') || {}
        const defaultModels = {
            openai: configuredHealthModels.openai || 'gpt-4o-mini',
            gemini: configuredHealthModels.gemini || 'gemini-2.5-flash',
            claude: configuredHealthModels.claude || 'claude-3-5-haiku-20241022'
        }
        const testModel = models && models.length > 0 ? models[0] : defaultModels[adapterType] || defaultModels.openai
        let actualTestModel = testModel
        if (id) {
            const mapping = channelManager.getActualModel(id, testModel)
            if (mapping.mapped) {
                actualTestModel = mapping.actualModel
                chatLogger.info(`[渠道测试] 模型重定向: ${testModel} -> ${actualTestModel}`)
            }
        }
        const useStreaming = advanced?.streaming?.enabled || false
        const maxTokens = advanced?.llm?.maxTokens || 100
        const thinkingOptions = resolveThinkingOptions({ channel: { advanced } })

        /* 渠道测试尊重温度覆盖/禁用配置：有 id 时用完整渠道，否则用 req.body 的 advanced 构造 */
        const { temperature } = resolveTemperature({
            actualModel: actualTestModel,
            requestOptions: {},
            preset: null,
            channel: id ? channel : { advanced, overrides: {} }
        })

        const options = {
            model: actualTestModel,
            maxToken: maxTokens,
            temperature,
            systemPromptConfig: systemPromptConfig || undefined,
            systemOverride: systemPromptConfig?.mode === 'replace' ? systemPromptConfig.override || '' : undefined,
            enableReasoning: thinkingOptions.enableReasoning,
            reasoningEffort: thinkingOptions.reasoningEffort,
            thinkingVendorControl: thinkingOptions.thinkingVendorControl,
            ...(thinkingOptions.reasoningBudgetTokens !== undefined
                ? { reasoningBudgetTokens: thinkingOptions.reasoningBudgetTokens }
                : {})
        }

        let replyText = ''
        let apiUsage = null
        let reportedModel = null

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
                    reportedModel = chunk.model || reportedModel
                } else if (chunk.model) {
                    reportedModel = chunk.model
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
            reportedModel = response.model || null
        }

        const elapsed = Date.now() - startTime

        await statsService.recordApiCall({
            channelId: id || 'test',
            channelName,
            model: testModel,
            reportedModel,
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
                keyInfo: usedKeyIndex >= 0 ? { index: usedKeyIndex, name: usedKeyName, strategy: usedStrategy } : null
            })
        )
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

// POST /api/channels/:id/test-baseurls - 测试渠道的所有baseUrl延迟
router.post('/:id/test-baseurls', async (req, res) => {
    try {
        await channelManager.init()
        const { id } = req.params
        const { forceRetest = false } = req.body

        const result = await channelManager.testAndSelectBestBaseUrl(id, { forceRetest })

        res.json(
            ApiResponse.ok({
                selectedIndex: result.selectedIndex,
                selectedUrl: result.selectedUrl,
                latencies: result.latencies,
                message: `测试完成，已选择最优baseUrl: ${result.selectedUrl} (延迟: ${result.latencies[result.selectedUrl]}ms)`
            })
        )
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// PUT /api/channels/:id/select-baseurl - 手动选择baseUrl
router.put('/:id/select-baseurl', async (req, res) => {
    try {
        await channelManager.init()
        const { id } = req.params
        const { index } = req.body

        const channel = channelManager.get(id)
        if (!channel) {
            return res.status(404).json(ApiResponse.fail(null, 'Channel not found'))
        }

        const baseUrls = channel.baseUrls || []
        // 必须先判整数：index 为 undefined 时两个比较都是 false，
        // 会让 channel.baseUrl = baseUrls[undefined] = undefined 并 saveToConfig() 落盘
        if (!Number.isInteger(index) || index < 0 || index >= baseUrls.length) {
            return res.status(400).json(ApiResponse.fail(null, 'Invalid baseUrl index'))
        }

        channel.selectedBaseUrlIndex = index
        channel.baseUrl = baseUrls[index]
        await channelManager.saveToConfig()

        res.json(
            ApiResponse.ok({
                selectedIndex: index,
                selectedUrl: baseUrls[index],
                message: `已切换到baseUrl: ${baseUrls[index]}`
            })
        )
    } catch (error) {
        res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// POST /api/channels/fetch-models
router.post('/fetch-models', async (req, res) => {
    let { adapterType = 'openai', baseUrl, apiKey, modelsPath } = req.body || {}

    try {
        if (!baseUrl || !String(baseUrl).trim()) {
            return res.status(400).json(ApiResponse.fail(null, '请提供 Base URL，避免误用默认官方地址'))
        }
        // normalizeBaseUrl 会构造 URL，非法输入时抛错，必须置于 try 内
        baseUrl = normalizeBaseUrl(baseUrl, adapterType)

        chatLogger.debug(`[获取模型] 使用BaseURL: ${baseUrl}, 适配器: ${adapterType}`)
        const ClientClass = await getAdapterClientClass(adapterType)
        const client = new ClientClass({
            apiKey: apiKey || (adapterType === 'openai' ? config.get('openai.apiKey') : ''),
            baseUrl,
            modelsPath: modelsPath || '',
            endpoints: modelsPath ? { models: modelsPath } : {},
            features: ['chat']
        })

        const models = await client.listModels()

        res.json(ApiResponse.ok({ models: normalizeModelList(models) }))
    } catch (error) {
        chatLogger.error('[获取模型] 错误:', error.message)
        res.status(500).json(ApiResponse.fail(null, `获取模型失败: ${error.message}`))
    }
})

/**
 * 批量测试渠道下多个模型的可用性
 *
 * @param {import('express').Request} req - 请求对象，body 需含 channelId，可选 models / concurrency
 * @param {import('express').Response} res - 响应对象
 * @returns {Promise<void>}
 */
async function runBatchTest(req, res) {
    const { channelId, models, concurrency } = req.body || {}

    // 解构默认值只在 undefined 时生效：传 0、负数或 null 会让下方 i += concurrency 永不推进，
    // 造成事件循环饥饿且不触发 OOM（进程假死）。此处统一钳制到 [1, 20]。
    const batchSize = Math.min(20, Math.max(1, Number(concurrency) || 3))

    await channelManager.init()
    const channel = channelManager.get(channelId)

    if (!channel) {
        return res.status(404).json(ApiResponse.fail(null, 'Channel not found'))
    }

    // models 传成字符串（如 "gpt-4"）时，下方 batch.map 会抛 TypeError
    if (models !== undefined && models !== null && !Array.isArray(models)) {
        return res.status(400).json(ApiResponse.fail(null, 'models 必须是数组'))
    }

    const testModels = models || channel.models || []
    if (!Array.isArray(testModels) || testModels.length === 0) {
        return res.status(400).json(ApiResponse.fail(null, '没有可测试的模型'))
    }

    const results = []

    const testSingleModel = async model => {
        const startTime = Date.now()
        try {
            let apiKey = channel.apiKey
            let keyInfo = null
            if (channel.apiKeys && channel.apiKeys.length > 0) {
                keyInfo = channelManager.getChannelKey(channel, { recordUsage: false })
                apiKey = keyInfo.key
            }

            const client = await createChannelTestClient({
                adapterType: channel.adapterType || 'openai',
                apiKey,
                baseUrl: channelManager.getCurrentBaseUrl(channel.id) || channel.baseUrl,
                channel
            })

            // 应用模型映射/重定向
            const mapping = channelManager.getActualModel(channelId, model)
            const actualModel = mapping.actualModel

            const thinkingOptions = resolveThinkingOptions({ channel })
            /* 批量测试尊重温度覆盖/禁用配置 */
            const { temperature: batchTestTemperature } = resolveTemperature({
                actualModel,
                requestOptions: {},
                preset: null,
                channel
            })
            const response = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
                {
                    model: actualModel,
                    maxToken: 50,
                    temperature: batchTestTemperature,
                    systemPromptConfig: channel.systemPromptConfig || undefined,
                    systemOverride:
                        channel.systemPromptConfig?.mode === 'replace'
                            ? channel.systemPromptConfig.override || ''
                            : undefined,
                    enableReasoning: thinkingOptions.enableReasoning,
                    reasoningEffort: thinkingOptions.reasoningEffort,
                    thinkingVendorControl: thinkingOptions.thinkingVendorControl,
                    ...(thinkingOptions.reasoningBudgetTokens !== undefined
                        ? { reasoningBudgetTokens: thinkingOptions.reasoningBudgetTokens }
                        : {})
                }
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
    for (let i = 0; i < testModels.length; i += batchSize) {
        const batch = testModels.slice(i, i + batchSize)
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
}

// POST /api/channels/batch-test - Batch test multiple models (JSON response)
router.post('/batch-test', async (req, res) => {
    try {
        await runBatchTest(req, res)
    } catch (error) {
        chatLogger.error('[批量测试] 错误:', error)
        if (!res.headersSent) res.status(500).json(ApiResponse.fail(null, error.message))
    }
})

// POST /api/channels/test-model - Test a single specific model
router.post('/test-model', async (req, res) => {
    const startTime = Date.now()
    // channelId / model 必须定义在 try 之外：下方 catch 块会引用 model 拼装失败响应
    const { channelId, model } = req.body || {}
    try {
        if (!channelId || !model) {
            return res.status(400).json(ApiResponse.fail(null, 'channelId and model are required'))
        }

        await channelManager.init()
        const channel = channelManager.get(channelId)

        if (!channel) {
            return res.status(404).json(ApiResponse.fail(null, 'Channel not found'))
        }

        let apiKey = channel.apiKey
        let keyInfo = null
        if (channel.apiKeys && channel.apiKeys.length > 0) {
            keyInfo = channelManager.getChannelKey(channel, { recordUsage: false })
            apiKey = keyInfo.key
        }

        const client = await createChannelTestClient({
            adapterType: channel.adapterType || 'openai',
            apiKey,
            baseUrl: channelManager.getCurrentBaseUrl(channel.id) || channel.baseUrl,
            channel
        })

        // 应用模型映射/重定向
        const mapping = channelManager.getActualModel(channelId, model)
        const actualModel = mapping.actualModel
        if (mapping.mapped) {
            chatLogger.info(`[单模型测试] 模型重定向: ${model} -> ${actualModel}`)
        }

        const thinkingOptions = resolveThinkingOptions({ channel })
        /* 单模型测试尊重温度覆盖/禁用配置 */
        const { temperature: singleTestTemperature } = resolveTemperature({
            actualModel,
            requestOptions: {},
            preset: null,
            channel
        })
        const response = await client.sendMessage(
            { role: 'user', content: [{ type: 'text', text: '说一声你好' }] },
            {
                model: actualModel,
                maxToken: 50,
                temperature: singleTestTemperature,
                systemPromptConfig: channel.systemPromptConfig || undefined,
                systemOverride:
                    channel.systemPromptConfig?.mode === 'replace'
                        ? channel.systemPromptConfig.override || ''
                        : undefined,
                enableReasoning: thinkingOptions.enableReasoning,
                reasoningEffort: thinkingOptions.reasoningEffort,
                thinkingVendorControl: thinkingOptions.thinkingVendorControl,
                ...(thinkingOptions.reasoningBudgetTokens !== undefined
                    ? { reasoningBudgetTokens: thinkingOptions.reasoningBudgetTokens }
                    : {})
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
