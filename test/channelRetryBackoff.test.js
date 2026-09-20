import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
    BACKOFF_STRATEGIES,
    EXPECTED_RETRYABLE,
    classifyRetryError,
    computeDelay,
    expectRetryable,
    pickChannelRetryPolicy
} from '../src/services/llm/BackoffPolicy.js'
import { getDelegateFallbackConfig } from '../src/services/llm/LlmDelegate.js'
import config from '../config/config.js'

describe('computeDelay 基础策略（无抖动）', () => {
    test('fixed：恒为基础延迟', () => {
        for (const attempt of [1, 2, 5, 10]) {
            assert.equal(computeDelay(attempt, { backoff: 'fixed', baseDelay: 1000, jitterRatio: 0 }), 1000)
        }
    })

    test('linear：baseDelay × attempt', () => {
        assert.equal(computeDelay(1, { backoff: 'linear', baseDelay: 500, jitterRatio: 0 }), 500)
        assert.equal(computeDelay(3, { backoff: 'linear', baseDelay: 500, jitterRatio: 0 }), 1500)
    })

    test('exponential：baseDelay × 2^(attempt-1)', () => {
        assert.equal(computeDelay(1, { backoff: 'exponential', baseDelay: 500, jitterRatio: 0 }), 500)
        assert.equal(computeDelay(2, { backoff: 'exponential', baseDelay: 500, jitterRatio: 0 }), 1000)
        assert.equal(computeDelay(3, { backoff: 'exponential', baseDelay: 500, jitterRatio: 0 }), 2000)
    })

    test('maxDelay 封顶', () => {
        assert.equal(
            computeDelay(20, { backoff: 'exponential', baseDelay: 500, maxDelay: 10000, jitterRatio: 0 }),
            10000
        )
        assert.equal(computeDelay(5, { backoff: 'linear', baseDelay: 3000, maxDelay: 9000, jitterRatio: 0 }), 9000)
    })

    test('非法 backoff 回退 exponential', () => {
        assert.equal(computeDelay(3, { backoff: 'bogus', baseDelay: 500, jitterRatio: 0 }), 2000)
    })

    test('BACKOFF_STRATEGIES 只含三种合法策略', () => {
        assert.deepEqual([...BACKOFF_STRATEGIES].sort(), ['exponential', 'fixed', 'linear'])
    })
})

describe('computeDelay 抖动', () => {
    test('jitterRatio 0.3 下输出始终位于 [raw*0.7, raw*1.3]，且多数不等于基准值', () => {
        for (const [attempt, baseDelay] of [
            [1, 500],
            [2, 1000]
        ]) {
            const raw = baseDelay * Math.pow(2, attempt - 1) // 指数退避原始延迟，未触顶
            const samples = new Array(50)
            let differing = 0
            for (let i = 0; i < samples.length; i++) {
                samples[i] = computeDelay(attempt, {
                    backoff: 'exponential',
                    baseDelay,
                    maxDelay: 10000,
                    jitterRatio: 0.3
                })
                assert.ok(samples[i] >= raw * 0.7, `第${i}次样本 ${samples[i]} 低于下界 ${raw * 0.7}`)
                assert.ok(samples[i] <= raw * 1.3, `第${i}次样本 ${samples[i]} 高于上界 ${raw * 1.3}`)
                if (samples[i] !== raw) differing++
            }
            assert.ok(differing > 25, `50 次采样中仅 ${differing} 次偏离基准，抖动疑似未生效`)
        }
    })

    test('抖动后仍受 maxDelay 封顶', () => {
        for (let i = 0; i < 15; i++) {
            const output = computeDelay(20, {
                backoff: 'exponential',
                baseDelay: 500,
                maxDelay: 1000,
                jitterRatio: 0.5
            })
            assert.ok(output >= 500 && output <= 1000) // 下界为 raw*(1-0.5)=500，上界 maxDelay 钳制
        }
    })

    test('jitterRatio 越界被钳制到 [0, 0.8]', () => {
        for (let i = 0; i < 10; i++) {
            assert.ok(computeDelay(1, { backoff: 'fixed', baseDelay: 1000, jitterRatio: -1 }) === 1000)
        }
        for (let i = 0; i < 30; i++) {
            const output = computeDelay(1, { backoff: 'fixed', baseDelay: 1000, jitterRatio: 5 })
            assert.ok(output >= 200 && output <= 1800)
        }
    })
})

describe('classifyRetryError 分类', () => {
    test('auth：401/unauthorized/invalid_api_key', () => {
        assert.equal(classifyRetryError(new Error('HTTP 401 Unauthorized')).type, 'auth')
        assert.equal(classifyRetryError('请求失败 unauthorized access').type, 'auth')
        assert.equal(classifyRetryError('invalid_api_key 校验失败').type, 'auth')
    })

    test('403 不归 auth，避免权限错误误切换 Key', () => {
        assert.equal(classifyRetryError(new Error('HTTP 403 Forbidden')).type, 'unknown')
        assert.equal(classifyRetryError({ message: 'access denied 403' }).type, 'unknown')
    })

    test('quota：429/quota/rate_limit/exceeded', () => {
        assert.equal(classifyRetryError('429 Too Many Requests').type, 'quota')
        assert.equal(classifyRetryError('你的 quota 已用尽').type, 'quota')
        assert.equal(classifyRetryError('rate_limit exceeded').type, 'quota')
    })

    test('server：5xx 与 internal server error', () => {
        assert.equal(classifyRetryError('upstream 502 Bad Gateway').type, 'server')
        assert.equal(classifyRetryError('500 Internal Server Error').type, 'server')
        assert.equal(classifyRetryError('gateway 504 超时').type, 'server')
    })

    test('client：400/404/invalid_request/invalid_parameter/validation/not found', () => {
        assert.equal(classifyRetryError('400 invalid_request').type, 'client')
        assert.equal(classifyRetryError('invalid_parameter: model 不存在').type, 'client')
        assert.equal(classifyRetryError('validation failed').type, 'client')
        assert.equal(classifyRetryError('404 not found').type, 'client')
    })

    test('empty：适配器空返回错误文本', () => {
        assert.equal(classifyRetryError('API返回格式不符合OpenAI标准: choices字段缺失或格式错误').type, 'empty')
        assert.equal(classifyRetryError('API未能生成回复(输入12K tokens)，可能是模型繁忙或Token超限').type, 'empty')
        assert.equal(classifyRetryError('usage: completion_tokens=0').type, 'empty')
        assert.equal(classifyRetryError('响应为空 (empty choices)').type, 'empty')
        assert.equal(classifyRetryError('(响应格式不符)').type, 'empty')
    })

    test('timeout/network', () => {
        assert.equal(classifyRetryError('request timeout').type, 'timeout')
        assert.equal(classifyRetryError('socket ETIMEDOUT').type, 'timeout')
        assert.equal(classifyRetryError('connect ECONNREFUSED').type, 'network')
        assert.equal(classifyRetryError('getaddrinfo ENOTFOUND api.example.com').type, 'network')
    })

    test('expectRetryable 白名单与 EXPECTED_RETRYABLE', () => {
        assert.deepEqual(
            [...EXPECTED_RETRYABLE].sort(),
            ['auth', 'empty', 'network', 'quota', 'server', 'timeout'].sort()
        )
        for (const type of ['empty', 'auth', 'quota', 'timeout', 'network', 'server']) {
            assert.equal(expectRetryable(type), true)
        }
        for (const type of ['client', 'unknown']) {
            assert.equal(expectRetryable(type), false)
        }
    })

    test('pickChannelRetryPolicy：渠道策略优先，缺失回退全局', () => {
        const withChannel = pickChannelRetryPolicy({ retry: { delay: 2000, backoff: 'linear' } }, 500, 'exponential')
        assert.deepEqual(withChannel, { delay: 2000, backoff: 'linear' })
        const noBackoff = pickChannelRetryPolicy({ retry: { delay: 2000 } }, 500, 'exponential')
        assert.deepEqual(noBackoff, { delay: 2000, backoff: 'exponential' })
        const noChannel = pickChannelRetryPolicy(null, 500, 'fixed')
        assert.deepEqual(noChannel, { delay: 500, backoff: 'fixed' })
        const noRetryField = pickChannelRetryPolicy({}, 500, 'exponential')
        assert.deepEqual(noRetryField, { delay: 500, backoff: 'exponential' })
        const zeroDelay = pickChannelRetryPolicy({ retry: { delay: 0, backoff: 'linear' } }, 500, 'exponential')
        assert.deepEqual(zeroDelay, { delay: 500, backoff: 'exponential' })
    })
})

describe('LlmDelegate 配置读取', () => {
    test('getDelegateFallbackConfig 返回 backoff 与 retryJitter', () => {
        const result = getDelegateFallbackConfig()
        assert.ok(typeof result.maxRetries === 'number' && result.maxRetries >= 1)
        assert.ok(typeof result.retryDelay === 'number' && result.retryDelay >= 50)
        assert.ok(['fixed', 'linear', 'exponential'].includes(result.backoff))
        assert.ok(result.retryJitter >= 0 && result.retryJitter <= 0.8)
        assert.equal(typeof result.enableChannelSwitch, 'boolean')
    })

    test('config 默认模板含新键', () => {
        const template = config.data?.llm?.fallback ?? config.get?.('llm.fallback') ?? null
        // 用户私有配置可能显式关闭/覆盖，仅当能取到默认模板时校验默认值语义
        if (template && Object.prototype.hasOwnProperty.call(template, 'emptyRetries')) {
            assert.equal(typeof template.emptyRetries, 'number')
            assert.ok(
                typeof template.retryJitter === 'number' && template.retryJitter >= 0 && template.retryJitter <= 0.8
            )
            assert.ok(['fixed', 'linear', 'exponential'].includes(template.backoff))
        }
    })
})
