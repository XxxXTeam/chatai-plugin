/**
 * 记忆模块 LLM 调度器。
 *
 * 记忆 LLM 请求来自互不协调的多条路径（每条回复的同步提取、周期轮询、手动命令、
 * HTTP 接口）。没有闸门时，突发流量会同时打到同一渠道，表现为「并发过高、
 * 调用间隔过短」。
 *
 * 本调度器提供两块能力：
 * 1. 并发闸门：跨入口共享并发额度，超限任务进入 FIFO 队列；单请求可配置超时，
 *    避免一条卡死的请求长期占住额度。所有记忆 LLM 调用统一走 run()。
 * 2. 频率控制：按作用域（`user:<uid>` 或 `group:<gid>:user:<uid>`）记录冷却时间
 *    与新增消息水位，抑制同一用户被反复总结。状态仅存进程内存，重启后归零，
 *    由轮询路径的 minPollInterval 兜底。
 *
 * 配置（memory 段）：
 * - llmConcurrency            并发上限，默认 2，范围 1-8
 * - llmTimeoutMs              单次请求超时，默认 60000，范围 5000-300000
 * - summarizeCooldownMinutes  同一作用域两次总结的最小间隔，默认 120
 * - minNewMessages            冷却期满后还需累计多少条新消息才真正总结，默认 6
 */

import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

/** 数值取整数并夹在 [min, max]，非法输入返回 fallback */
function clampInt(raw, min, max, fallback) {
    const value = Number(raw)
    if (!Number.isFinite(value)) return fallback
    return Math.min(Math.max(Math.trunc(value), min), max)
}

class MemoryLlmScheduler {
    constructor() {
        /** @type {number} 当前并发执行中的任务数 */
        this.active = 0
        /** @type {Array<() => void>} FIFO 等待队列 */
        this.queue = []
        /** @type {Map<string, {lastAt: number, messageCount: number}>} 作用域频率状态 */
        this.scopes = new Map()
    }

    /* ---------- 配置读取 ---------- */

    getConcurrency() {
        return clampInt(config.get('memory.llmConcurrency'), 1, 8, 2)
    }

    getTimeoutMs() {
        return clampInt(config.get('memory.llmTimeoutMs'), 5000, 300000, 60000)
    }

    getCooldownMs() {
        return clampInt(config.get('memory.summarizeCooldownMinutes'), 0, 24 * 60, 120) * 60 * 1000
    }

    getMinNewMessages() {
        return clampInt(config.get('memory.minNewMessages'), 0, 1000, 6)
    }

    /* ---------- 并发闸门 ---------- */

    /**
     * 在闸门内执行记忆 LLM 任务。
     * @param {() => Promise<any>} task - 实际 LLM 调用
     * @param {{scopeKey?: string, caller?: string, timeoutMs?: number}} [options]
     * @returns {Promise<any>} task 的结果
     */
    async run(task, options = {}) {
        const { caller = 'MemoryLLM', timeoutMs = null } = options
        const maxConcurrent = this.getConcurrency()

        if (this.active >= maxConcurrent) {
            await new Promise(resolve => this.queue.push(resolve))
        }
        this.active++

        const timeout = timeoutMs || this.getTimeoutMs()
        const startedAt = Date.now()
        try {
            return await this._runWithTimeout(task, timeout, caller)
        } finally {
            this.active--
            // 释放一个等待中的任务；队列为空时才真正让出额度
            if (this.queue.length > 0) this.queue.shift()()
        }
    }

    /**
     * 带超时执行任务。超时抛错但不中断底层任务，由调用方决定是否丢弃结果；
     * 底层任务的 rejection 会被吞掉，避免 unhandled rejection。
     * @param {() => Promise<any>} task
     * @param {number} timeoutMs
     * @param {string} caller
     * @returns {Promise<any>}
     */
    async _runWithTimeout(task, timeoutMs, caller) {
        const wrapped = Promise.resolve().then(task)
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return wrapped

        let timer = null
        const race = Promise.race([
            wrapped,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`记忆 LLM 调用超时(${timeoutMs}ms): ${caller}`)), timeoutMs)
            })
        ])
        try {
            return await race
        } catch (error) {
            wrapped.catch(() => {})
            if (timer) clearTimeout(timer)
            logger.debug(`[MemoryLlmScheduler] ${caller} 调用超时:`, error.message)
            throw error
        }
    }

    /* ---------- 频率控制 ---------- */

    /**
     * 获取作用域状态；不存在时初始化。
     * @param {string} scopeKey
     * @returns {{lastAt: number, messageCount: number}}
     * @private
     */
    _state(scopeKey) {
        let state = this.scopes.get(scopeKey)
        if (!state) {
            state = { lastAt: 0, messageCount: 0 }
            this.scopes.set(scopeKey, state)
        }
        return state
    }

    /**
     * 记录作用域新增消息（每条回复调用一次，作为总结水位）。
     * @param {string|null|undefined} scopeKey
     * @param {number} [count] 本次新增条数，默认 1
     */
    noteMessage(scopeKey, count = 1) {
        if (!scopeKey) return
        const added = Number(count)
        if (!Number.isFinite(added) || added <= 0) return
        this._state(scopeKey).messageCount += Math.trunc(added)
    }

    /**
     * 检查作用域是否允许执行总结。
     * 冷却未到或新消息不足任一条件都拒绝。
     * @param {string|null|undefined} scopeKey
     * @param {{requireMessages?: boolean}} [options] requireMessages=false 时忽略新消息水位（手动总结）
     * @returns {{allowed: boolean, reason?: string, retryAfterSeconds?: number, messageCount?: number, minMessages?: number}}
     */
    checkGate(scopeKey, options = {}) {
        if (!scopeKey) return { allowed: true }
        const state = this._state(scopeKey)
        const now = Date.now()
        const cooldownMs = this.getCooldownMs()
        const sinceLast = now - state.lastAt
        const cooldownOk = state.lastAt === 0 || sinceLast >= cooldownMs

        const messageCount = state.messageCount
        const minMessages = this.getMinNewMessages()
        const messageOk = options.requireMessages === false || messageCount >= minMessages

        if (cooldownOk && messageOk) {
            return { allowed: true, messageCount }
        }
        return {
            allowed: false,
            reason: cooldownOk ? 'not_enough_messages' : 'cooldown',
            retryAfterSeconds: cooldownOk ? 0 : Math.max(0, Math.ceil((cooldownMs - sinceLast) / 1000)),
            messageCount,
            minMessages
        }
    }

    /**
     * 标记作用域已总结：重置冷却计时并清空消息水位。
     * @param {string|null|undefined} scopeKey
     */
    markProcessed(scopeKey) {
        if (!scopeKey) return
        const state = this._state(scopeKey)
        state.lastAt = Date.now()
        state.messageCount = 0
    }

    /**
     * 重置全部状态（测试用 / 配置热重载）。
     */
    reset() {
        this.active = 0
        this.queue.length = 0
        this.scopes.clear()
    }
}

/** 全局单例：所有入口共享同一并发额度与频率状态 */
export const memoryLlmScheduler = new MemoryLlmScheduler()

export default MemoryLlmScheduler
