/**
 * @fileoverview 请求侧提示词缓存键服务
 * @module services/llm/PromptCacheService
 * @description 管理各渠道当前活跃的 prompt cache key，供 OpenAI Responses 的
 * prompt_cache_key / prompt_cache_retention 参数使用。
 *
 * 状态为纯内存、模块级单例（Map）。缓存键随进程生命周期，重启后重新开始：
 * 不影响正确性，只影响命中率连续性（重启后第一次请求视为新写）。
 *
 * 消费方接线位置（本轮不接线，预留说明）：
 * - ChatService 的 currentRequestOptions 构建：promptCacheKey: getPromptCacheKey(channelId)
 * - ChatService 的响应 usage 处理：noteUsage(channelId, usage)
 * - ChatAgent 的请求 option 构造：同上
 *
 * 正确接线伪代码：
 * ```js
 * options.promptCacheKey = getPromptCacheKey(channelId)     // 请求前取/建键
 * const verdict = noteUsage(channelId, usage)               // 响应后感知 hit/miss
 * ```
 */

import crypto from 'node:crypto'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

/** @constant {string} 键前缀：标识插件与格式版本，防多渠道之间的服务商缓存串扰 */
const KEY_PREFIX = 'chatgpt-plugin-v1'

/**
 * 活跃键表：channelId（已 String 化）→ 当前活跃的缓存键。
 * 自研 Map 实现，项目无 lru-cache 依赖。
 * @type {Map<string, string>}
 */
const activeCacheKeys = new Map()

/**
 * 键轮换用递增计数，避免同一毫秒内多次轮换产生相同键。
 * @type {number}
 */
let keySequence = 0

/**
 * 构建稳定的 prompt cache key。
 * 格式：`chatgpt-plugin-v1-{hash8}-{timestamp}-{seq}`，其中：
 * - `chatgpt-plugin-v1` 为固定前缀（含格式版本，改动键结构时递增）
 * - `hash8` 为渠道标识的 SHA-256 前 8 位小写十六进制（channelId 先 String 化再取哈希，
 *   避免原始 id 中的特殊字符进入服务商参数）
 * - `timestamp` 为构建时刻的毫秒时间戳，`seq` 为进程内递增计数，二者共同保证唯一性
 * 示例：`chatgpt-plugin-v1-9f2a3b1c-1758351600000-3`
 *
 * 注意：键不是幂等的（含时间戳与计数），确定性指同 channelId 的哈希段稳定、整体格式稳定；
 * 键的唯一标识应在创建后通过 getPromptCacheKey 复用，而不是重复调用本函数。
 * @param {string} channelId - 渠道标识（任意值均可，内部统一 String 化）
 * @returns {string} 缓存键
 */
export function buildPromptCacheKey(channelId) {
    const id = String(channelId)
    const hash = crypto.createHash('sha256').update(id).digest('hex').slice(0, 8)
    return `${KEY_PREFIX}-${hash}-${Date.now()}-${keySequence++}`
}

/**
 * 读取当前渠道活跃的缓存键，不存在则创建并激活。
 * @param {string} channelId - 渠道标识（内部统一 String 化）
 * @returns {string} 该渠道当前活跃的缓存键
 */
export function getPromptCacheKey(channelId) {
    const id = String(channelId)
    let key = activeCacheKeys.get(id)
    if (!key) {
        key = buildPromptCacheKey(id)
        activeCacheKeys.set(id, key)
        logger.debug(`[PromptCacheService] 激活渠道 ${id} 的缓存键: ${key}`)
    }
    return key
}

/**
 * 清除渠道的活跃缓存键（返回 null）。
 * 渠道重启、切换 API Key / baseUrl、响应提示缓存被淘汰时调用。
 * @param {string} channelId - 渠道标识（内部统一 String 化）
 * @returns {void}
 */
export function clearChannel(channelId) {
    const id = String(channelId)
    activeCacheKeys.delete(id)
    logger.debug(`[PromptCacheService] 已清除渠道 ${id} 的缓存键`)
}

/**
 * 轮换渠道的缓存键（生成新键并记录）。
 * @param {string} channelId - 渠道标识（内部统一 String 化）
 * @returns {string} 新生成并已激活的缓存键
 */
function rotate(channelId) {
    const id = String(channelId)
    const key = buildPromptCacheKey(id)
    activeCacheKeys.set(id, key)
    logger.debug(`[PromptCacheService] 轮换渠道 ${id} 的缓存键: ${key}`)
    return key
}

/**
 * 根据响应 usage 感知缓存命中语义并维护活跃键。
 * usage 字段名以 OpenAIClient.normalizeOpenAIUsage 的真实导出为准：
 * cacheReadTokens / cache_read_input_tokens / cachedTokens（读）、
 * cacheCreationTokens / cache_creation_input_tokens / cacheWriteTokens（写）。
 *
 * 语义：
 * - 读 > 0 且写 === 0 → 'hit'（命中既有缓存，无操作）
 * - 读 > 0 且写 > 0 → 'miss'（旧键已被服务商淘汰、本次为新写，轮换新键）
 * - 读 === 0 且写 > 0 → 'miss'（首次写或旧键失效，同样轮换）
 * - 读写均为 0 或 usage 为 null/undefined → 'none'（无操作）
 * @param {string} channelId - 渠道标识（内部统一 String 化）
 * @param {Object|null|undefined} usage - 上游归一化后的 usage 对象
 * @returns {'hit'|'miss'|'evicted'|'none'} 感知结论
 */
export function noteUsage(channelId, usage) {
    if (usage == null) return 'none'
    const cacheReadTokens = usage?.cacheReadTokens ?? usage?.cache_read_input_tokens ?? usage?.cachedTokens ?? 0
    const cacheCreationTokens =
        usage?.cacheCreationTokens ?? usage?.cache_creation_input_tokens ?? usage?.cacheWriteTokens ?? 0
    if (cacheReadTokens > 0 && cacheCreationTokens === 0) {
        return 'hit'
    }
    if (cacheReadTokens > 0 && cacheCreationTokens > 0) {
        rotate(channelId)
        return 'miss'
    }
    if (cacheReadTokens === 0 && cacheCreationTokens > 0) {
        rotate(channelId)
        return 'miss'
    }
    return 'none'
}
