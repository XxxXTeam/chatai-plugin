import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'

const logger = chatLogger

/**
 * @fileoverview 本文件是 LlmDelegator 全量接管后的兼容出口：
 * LLM 请求已统一由 ./LlmDelegator.js 的 delegateRequest 调度，
 * 此处仅保留「委托回退配置读取」纯函数，供配置读取链路与测试复用。
 */

/**
 * 读几何配置：重试次数、退避基础延迟、退避策略、抖动、是否允许渠道切换。
 * 默认与 ChatService 的 llm.fallback 保持一致（maxRetries 3 / retryDelay 500 / backoff exponential / retryJitter 0.3）。
 * @returns {{maxRetries: number, retryDelay: number, backoff: string, retryJitter: number, enableChannelSwitch: boolean}}
 */
export function getDelegateFallbackConfig() {
    const fallback = configGetFallback()
    return {
        maxRetries: Math.max(1, fallback.maxRetries || 3),
        retryDelay: Math.max(50, fallback.retryDelay || 500),
        backoff: fallback.backoff || 'exponential',
        retryJitter: Math.max(0, Math.min(0.8, Number(fallback.retryJitter ?? 0.3))),
        enableChannelSwitch: fallback.enableChannelSwitch !== false
    }
}

function configGetFallback() {
    return config.get('llm.fallback') || {}
}

export default {
    getDelegateFallbackConfig
}
