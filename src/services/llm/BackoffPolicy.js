import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

/** 支持的重试退避策略名 */
export const BACKOFF_STRATEGIES = new Set(['fixed', 'linear', 'exponential'])

/** 可重试/可触发渠道切换的错误类别（与 ChatService 切换白名单口径一致） */
export const EXPECTED_RETRYABLE = new Set(['empty', 'auth', 'quota', 'timeout', 'network', 'server'])

/** 抖动比例上限（超出按上限处理） */
const MAX_JITTER_RATIO = 0.8

/** 错误样本表：匹配前消息统一转小写；'empty' 额外要求 completion_tokens 与 0 同时出现 */
const ERROR_SAMPLES = {
    empty: ['choices字段缺失', '未能生成回复', '(empty choices)', '(响应格式不符)'],
    auth: ['401', 'unauthorized', 'invalid_api_key'],
    quota: ['429', 'quota', 'rate_limit', 'exceeded'],
    server: ['500', '502', '503', '504', 'internal server error'],
    client: ['400', '404', 'invalid_request', 'invalid_parameter', 'validation', 'not found'],
    timeout: ['timeout', 'etimedout'],
    network: ['econnrefused', 'enotfound', 'network']
}

/**
 * 计算一次重试的延迟（毫秒）
 *
 * @param {number} attempt - 重试序号（从 1 开始）
 * @param {Object} [options] - 退避选项
 * @param {string} [options.backoff='exponential'] - 退避策略：'fixed' | 'linear' | 'exponential'，非法值按 exponential 处理
 * @param {number} [options.baseDelay=500] - 基础延迟（毫秒）
 * @param {number} [options.maxDelay=10000] - 最大延迟封顶（毫秒），抖动后仍生效
 * @param {number} [options.jitterRatio=0.3] - 抖动比例（钳制到 [0, 0.8]，0 表示无抖动）
 * @returns {number} 最终延迟（毫秒）
 */
export function computeDelay(attempt, options = {}) {
    const { backoff = 'exponential', baseDelay = 500, maxDelay = 10000, jitterRatio = 0.3 } = options
    const safeAttempt = Math.max(1, Math.floor(Number(attempt) || 1))
    const safeBaseDelay = Math.max(0, Number(baseDelay) || 0)
    const safeMaxDelay = Math.max(0, Number(maxDelay) || 0)

    let strategy = backoff
    if (!BACKOFF_STRATEGIES.has(backoff)) {
        logger.debug(`[BackoffPolicy] 未知退避策略 '${backoff}'，回退 exponential`)
        strategy = 'exponential'
    }

    let rawDelay
    if (strategy === 'fixed') {
        rawDelay = safeBaseDelay
    } else if (strategy === 'linear') {
        rawDelay = safeBaseDelay * safeAttempt
    } else {
        rawDelay = safeBaseDelay * Math.pow(2, safeAttempt - 1)
    }
    rawDelay = Math.min(safeMaxDelay, rawDelay)

    const jitter = Math.max(0, Math.min(MAX_JITTER_RATIO, Number(jitterRatio) || 0))
    if (jitter === 0) {
        return Math.round(rawDelay)
    }

    // uniform(-jitter, +jitter) 抖动后仍钳制在 [rawDelay*(1-jitter), min(maxDelay, rawDelay*(1+jitter))]
    const factor = 1 + (Math.random() * 2 - 1) * jitter
    const low = rawDelay * (1 - jitter)
    const high = Math.min(safeMaxDelay, rawDelay * (1 + jitter))
    return Math.round(Math.min(high, Math.max(low, rawDelay * factor)))
}

/**
 * 按消息文本分类 LLM 请求错误类别
 *
 * 403 不归 auth：权限错误切换 Key 无意义，保持 unknown 由调用方处理；
 * 未知错误归 unknown，不触发可重试判定。
 *
 * @param {string|Error} error - 错误对象或消息文本
 * @returns {{ type: 'auth'|'quota'|'timeout'|'network'|'server'|'client'|'empty'|'unknown' }} 错误类别
 */
export function classifyRetryError(error) {
    const message = (typeof error === 'string' ? error : error?.message || '').toLowerCase()
    if (
        ERROR_SAMPLES.empty.some(sample => message.includes(sample.toLowerCase())) ||
        (message.includes('completion_tokens') && message.includes('0'))
    ) {
        return { type: 'empty' }
    }
    for (const [type, samples] of Object.entries(ERROR_SAMPLES)) {
        if (type === 'empty') continue
        if (samples.some(sample => message.includes(sample))) {
            return { type }
        }
    }
    return { type: 'unknown' }
}

/**
 * 判断错误类别是否可重试（可触发渠道/Key 切换）
 *
 * @param {string} type - classifyRetryError 返回的类别
 * @returns {boolean} 是否可重试
 */
export function expectRetryable(type) {
    return EXPECTED_RETRYABLE.has(type)
}

/**
 * 解析生效的重试策略：渠道级 retry.delay/backoff 优先，缺失时回退全局 llm.fallback
 *
 * @param {Object|null} channel - 渠道对象（ChannelManager 保证渠道对象存在 retry 字段）
 * @param {number} globalDelay - 全局兜底重试间隔（毫秒）
 * @param {string} globalBackoff - 全局兜底退避策略
 * @returns {{ delay: number, backoff: string }} 生效的重试策略
 */
export function pickChannelRetryPolicy(channel, globalDelay, globalBackoff) {
    const channelRetry = channel?.retry
    if (channelRetry && channelRetry.delay) {
        return { delay: channelRetry.delay, backoff: channelRetry.backoff || globalBackoff }
    }
    return { delay: globalDelay, backoff: globalBackoff }
}
