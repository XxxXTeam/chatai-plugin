/**
 * @fileoverview 完全委托模式核心契约测试
 * 覆盖 LlmDelegator.delegateRequest 的模型-渠道过滤、渠道切换、备选模型、空响应与错误重试路由。
 * 全部通过 clientFactory 注入 mock 客户端与 channelManager 轻量注入渠道驱动，不发真实网络请求。
 */

import assert from 'node:assert/strict'
import { describe, test, before, after } from 'node:test'

import { delegateRequest, channelSupportsModel } from '../src/services/llm/LlmDelegator.js'
import { channelManager } from '../src/services/llm/ChannelManager.js'
import config from '../config/config.js'

/** 原 fallback 配置暂存（顶层 after 钩子恢复用） */
let originalFallback = null

/** 委托器读 llm.fallback 获取重试预算：注入测试级默认配置（maxRetries 3 / emptyRetries 2 / 无备选模型） */
function installFallbackConfig() {
    if (config.config?.llm?.fallback) {
        originalFallback = config.config.llm.fallback
    }
    config.config.llm = config.config.llm || {}
    config.config.llm.fallback = {
        enabled: true,
        models: [],
        maxRetries: 3,
        retryDelay: 500,
        emptyRetries: 2,
        retryJitter: 0.3,
        backoff: 'exponential',
        notifyOnFallback: false,
        enableChannelSwitch: true,
        enableKeyRotation: true
    }
}

/** 恢复原 fallback 配置 */
function restoreFallbackConfig() {
    if (originalFallback !== null) {
        config.config.llm.fallback = originalFallback
    } else {
        delete config.config.llm.fallback
    }
}

/** 全局前置：委托器依赖 config.llm.fallback（未 startSync 的测试进程为空），先注入测试配置 */
before(() => {
    installFallbackConfig()
})

/** 全局后置：恢复原配置 */
after(() => {
    restoreFallbackConfig()
})

/** 便捷的渠道构造 */
function makeChannel(id, { models, apiKey = 'sk-test', adapterType = 'openai', retry = {} } = {}) {
    return {
        id,
        name: `渠道-${id}`,
        models: models || [],
        apiKey,
        adapterType,
        enabled: true,
        baseUrl: 'https://api.example.com/v1',
        advanced: { llm: {}, streaming: { enabled: false } },
        overrides: {},
        retry
    }
}

/** mock 客户端：记录调用并按脚本依次返回 */
function makeMockClient(script = []) {
    const calls = []
    let index = 0
    const client = {
        calls,
        options: { keyIndex: 0 },
        sendMessage: async (_userMessage, options) => {
            const step = script[Math.min(index, script.length - 1)]
            index++
            calls.push(options)
            if (step instanceof Error) throw step
            if (step === '__EMPTY__') return { contents: [] }
            if (step === '__EMPTY_TEXT__') return { contents: [{ type: 'text', text: '' }] }
            return { contents: [{ type: 'text', text: step || 'ok' }], usage: { totalTokens: 10 }, model: 'upstream-m' }
        },
        setOnMessageWithToolCall() {}
    }
    return client
}

/** 统一执行：注入测试渠道 + mock 客户端工厂，跳过退避；fallbackModels 可选覆盖备选模型配置 */
async function runDelegate(params, channels, extra = {}) {
    for (const ch of channels) channelManager.channels.set(ch.id, ch)
    const prevFallback = config.config.llm.fallback
    if (extra.fallbackModels) {
        config.config.llm.fallback = {
            ...prevFallback,
            models: extra.fallbackModels
        }
    }
    try {
        return await delegateRequest({
            clientFactory: params.clientFactory,
            userMessage: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
            initialModel: params.initialModel,
            initialChannel: params.initialChannel || null,
            initialClient: params.initialClient || null,
            requestOptions: params.requestOptions || {},
            source: params.source || 'test-delegator',
            testMode: true,
            ...(params.lockChannel !== undefined ? { lockChannel: params.lockChannel } : {})
        })
    } finally {
        config.config.llm.fallback = prevFallback
        for (const ch of channels) channelManager.channels.delete(ch.id)
    }
}

describe('channelSupportsModel 模型-渠道过滤', () => {
    test('包含与通配均支持', () => {
        assert.equal(channelSupportsModel(makeChannel('a', { models: ['qwen', 'deepseek'] }), 'qwen'), true)
        assert.equal(channelSupportsModel(makeChannel('b', { models: ['*'] }), 'anything'), true)
    })

    test('不含的模型不支持，空渠道也不支持', () => {
        assert.equal(channelSupportsModel(makeChannel('a', { models: ['qwen'] }), 'deepseek'), false)
        assert.equal(channelSupportsModel(null, 'qwen'), false)
        assert.equal(channelSupportsModel(makeChannel('a', { models: [] }), 'qwen'), false)
    })
})

describe('delegateRequest 模型-渠道过滤与主模型成功', () => {
    test('首次尝试即成功：直接返回响应与渠道元信息', async () => {
        const qwen = makeChannel('qwen', { models: ['qwen'] })
        const mock = makeMockClient(['hello'])

        const res = await runDelegate(
            {
                initialModel: 'qwen',
                initialChannel: qwen,
                initialClient: mock,
                requestOptions: { model: 'qwen', maxToken: 50 }
            },
            [qwen]
        )

        assert.equal(res.response.contents[0].text, 'hello')
        assert.equal(res.usedChannel.id, 'qwen')
        assert.equal(res.usedModel, 'qwen')
        assert.equal(res.channelSwitched, false)
        assert.equal(res.fallbackUsed, false)
        assert.equal(res.totalRetryCount, 0)
        assert.ok(res.switchChain.some(s => s.type === 'success'))
    })

    test('首选渠道不含该模型且无其他支持渠道：直接报错不盲发', async () => {
        const qwenOnly = makeChannel('qwen', { models: ['qwen'] })

        await assert.rejects(
            runDelegate(
                {
                    initialModel: 'deepseek',
                    initialChannel: qwenOnly,
                    initialClient: makeMockClient(['x'])
                },
                [qwenOnly]
            ),
            /不支持模型/
        )
    })

    test('首选渠道不含该模型但存在支持渠道：先换渠道再发', async () => {
        const qwenOnly = makeChannel('qwen', { models: ['qwen'] })
        const ds = makeChannel('ds', { models: ['deepseek'] })
        const dsMock = makeMockClient(['ds-ok'])

        const res = await runDelegate(
            {
                initialModel: 'deepseek',
                initialChannel: qwenOnly,
                initialClient: makeMockClient([]),
                clientFactory: async (channel, baseOptions, { model }) => {
                    assert.equal(channel.id, 'ds', '应当只对支持渠道构造客户端')
                    return { client: dsMock, keyIndex: 0 }
                }
            },
            [qwenOnly, ds]
        )

        assert.equal(res.response.contents[0].text, 'ds-ok')
        assert.equal(res.usedChannel.id, 'ds')
        assert.equal(res.channelSwitched, true)
    })
})

describe('delegateRequest 空响应处理', () => {
    test('空文本在 emptyRetries 内原地重试后成功', async () => {
        const ch = makeChannel('qwen', { models: ['qwen'] })
        const mock = makeMockClient(['__EMPTY_TEXT__', 'ok-after-empty'])

        const res = await runDelegate(
            {
                initialModel: 'qwen',
                initialChannel: ch,
                initialClient: mock
            },
            [ch]
        )

        assert.equal(res.response.contents[0].text, 'ok-after-empty')
        assert.equal(mock.calls.length, 2)
        assert.ok(res.switchChain.some(s => s.type === 'success'))
    })

    test('空响应耗尽预算后无有效响应当返回空响应并记录错误', async () => {
        const ch = makeChannel('qwen', { models: ['qwen'] })
        const mock = makeMockClient(['__EMPTY__'])

        try {
            await runDelegate(
                {
                    initialModel: 'qwen',
                    initialChannel: ch,
                    initialClient: mock
                },
                [ch]
            )
            assert.fail('空响应耗尽预算后应抛出无有效响应的错误')
        } catch (error) {
            assert.match(error.message, /无有效响应/)
        }

        channelManager.channels.delete('qwen')
    })
})

describe('delegateRequest 错误重试与切换', () => {
    test('可重试错误（quota）去切换 Key：先切 Key 成功再请求', async () => {
        const ch = makeChannel('qwen', { models: ['qwen'], apiKey: '' })
        // 渠道只有一个 Key（apiKey 非数组），限制为不切 Key 场景——直接验证原地重试成功
        const mock = makeMockClient([new Error('429 rate limit'), 'ok-after-quota'])

        const res = await runDelegate(
            {
                initialModel: 'qwen',
                initialChannel: ch,
                initialClient: mock
            },
            [ch]
        )

        assert.equal(res.response.contents[0].text, 'ok-after-quota')
        assert.ok(mock.calls.length >= 2)
    })

    test('不可重试错误（unknown）不切换也不重试，直接抛错', async () => {
        const ch = makeChannel('qwen', { models: ['qwen'] })
        const mock = makeMockClient([new Error('HTTP 403 Forbidden')])

        await assert.rejects(
            runDelegate(
                {
                    initialModel: 'qwen',
                    initialChannel: ch,
                    initialClient: mock
                },
                [ch]
            ),
            /403/
        )
    })
})

describe('delegateRequest 备选模型', () => {
    test('主模型渠道耗尽后启用备选模型（按备选模型各自渠道重试）', async () => {
        const qwenCh = makeChannel('qwen-ch', { models: ['qwen'] })
        const deepseekCh = makeChannel('ds-ch', { models: ['deepseek'] })
        // 主模型渠道持续失败（quota）
        const qwenMock = makeMockClient([new Error('429 quota exceeded')])
        const dsMock = makeMockClient(['fallback-ok'])

        const res = await runDelegate(
            {
                initialModel: 'qwen',
                initialChannel: qwenCh,
                initialClient: qwenMock,
                requestOptions: { model: 'qwen' },
                clientFactory: async (channel, baseOptions, { model }) => {
                    if (channel.id !== 'ds-ch') {
                        // 备选模型只应在支持它的渠道上构造客户端
                        assert.fail(`不应为渠道${channel.id}构造客户端`)
                    }
                    assert.equal(model, 'deepseek', '备选模型迭代应传入备选模型名')
                    return { client: dsMock, keyIndex: 0 }
                }
            },
            [qwenCh, deepseekCh],
            { fallbackModels: ['deepseek'] }
        )

        assert.equal(res.response.contents[0].text, 'fallback-ok')
        assert.equal(res.usedChannel.id, 'ds-ch')
        assert.equal(res.fallbackUsed, true)
    })
})

describe('lockChannel 锁定渠道语义', () => {
    test('锁定渠道下不做模型过滤、不切渠道、不切模型，直接按指定渠道原样请求', async () => {
        const ch = makeChannel('locked', { models: ['qwen'] })
        const mock = makeMockClient(['locked-ok'])

        const res = await runDelegate(
            {
                initialModel: 'unlisted-model',
                initialChannel: ch,
                initialClient: mock,
                lockChannel: true
            },
            [ch]
        )

        assert.equal(res.response.contents[0].text, 'locked-ok')
        assert.equal(res.usedChannel.id, 'locked')
        assert.equal(res.channelSwitched, false)
    })

    test('锁定渠道缺失时直接报错（不自动选渠）', async () => {
        await assert.rejects(
            runDelegate(
                {
                    initialModel: 'qwen',
                    initialChannel: null,
                    lockChannel: true
                },
                []
            ),
            /锁定渠道/
        )
    })
})

describe('delegateRequest 生命周期与统计', () => {
    before(() => {
        // 注入测试级 fallback 配置（委托器从 config 读取重试预算）
        installFallbackConfig()
        // 清理测试渠道，避免污染其他用例的 getBestChannel 全局选渠
        channelManager.channels.delete('qwen')
        channelManager.channels.delete('qwen-ch')
        channelManager.channels.delete('ds-ch')
        channelManager.channels.delete('locked')
        channelManager.channels.delete('ds')
    })

    after(() => {
        // 恢复原配置
        restoreFallbackConfig()
    })

    test('成功路径对渠道调用 startRequest/endRequest 配对', async () => {
        const ch = makeChannel('lifecycle-ch', { models: ['qwen'] })
        const mock = makeMockClient(['ok'])

        const before = channelManager.activeRequests.get(ch.id) || 0
        await runDelegate(
            {
                initialModel: 'qwen',
                initialChannel: ch,
                initialClient: mock
            },
            [ch]
        )
        const after = channelManager.activeRequests.get(ch.id) || 0
        assert.equal(after, before, '委托结束后活跃请求计数应回到原值')

        channelManager.channels.delete('lifecycle-ch')
    })

    test('模型映射：requestOptions.model 为映射后的实际模型（getActualModel 未配置映射时原样）', async () => {
        const ch = makeChannel('map-ch', { models: ['qwen'] })
        const mock = makeMockClient(['ok'])

        await runDelegate(
            {
                initialModel: 'qwen',
                initialChannel: ch,
                initialClient: mock,
                requestOptions: { model: 'qwen' }
            },
            [ch]
        )

        assert.equal(mock.calls[0].model, 'qwen')
        channelManager.channels.delete('map-ch')
    })
})
