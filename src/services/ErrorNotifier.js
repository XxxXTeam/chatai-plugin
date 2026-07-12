/**
 * @fileoverview 错误通知服务
 * API 调用报错时将错误信息转发到配置的群聊、用户或主人，而非直接回复触发者
 */

import config from '../../config/config.js'
import { chatLogger } from '../core/utils/logger.js'
import { sendGroupMessage, sendPrivateMessage } from '../utils/platformAdapter.js'

const logger = chatLogger

/**
 * 从错误消息中提取错误类型标识，用于冷却去重
 * @param {string} msg - 错误消息
 * @returns {string} 错误类型 key
 */
function classifyError(msg) {
    if (msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('quota')) return 'rate_limit'
    if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('API key')) return 'auth'
    if (msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')) return 'model_not_found'
    if (msg.includes('insufficient') || msg.includes('balance') || msg.includes('billing')) return 'billing'
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) return 'timeout'
    if (msg.includes('ENOTFOUND') || msg.includes('network') || msg.includes('fetch')) return 'network'
    if (msg.includes('content') && (msg.includes('filter') || msg.includes('block') || msg.includes('safety')))
        return 'content_filter'
    return 'unknown'
}

class ErrorNotifier {
    constructor() {
        /** @type {Map<string, number>} 错误类型 -> 上次通知时间戳 */
        this.cooldownMap = new Map()
    }

    /**
     * 获取错误通知配置
     * @returns {object} errorNotify 配置
     */
    getConfig() {
        return config.get('errorNotify') || {}
    }

    /**
     * 判断错误通知功能是否启用
     * @returns {boolean}
     */
    isEnabled() {
        const cfg = this.getConfig()
        return cfg.enabled === true
    }

    /**
     * 检查冷却是否已过
     * @param {string} errorType - 错误类型 key
     * @param {number} cooldownSeconds - 冷却秒数
     * @returns {boolean} true 表示可以发送（冷却已过）
     */
    _checkCooldown(errorType, cooldownSeconds) {
        if (cooldownSeconds <= 0) return true
        const lastTime = this.cooldownMap.get(errorType) || 0
        const now = Date.now()
        if (now - lastTime < cooldownSeconds * 1000) return false
        this.cooldownMap.set(errorType, now)
        return true
    }

    /**
     * 获取主人 QQ 列表
     * @returns {number[]}
     */
    _getMasterQQList() {
        const result = []
        const pluginMasters = config.get('admin.masterQQ') || []
        result.push(...pluginMasters.map(Number).filter(n => n > 0))

        try {
            const bot = globalThis.Bot
            const botMasters = bot?.config?.masterQQ || bot?.config?.master || []
            for (const id of botMasters) {
                const num = Number(id)
                if (num > 0 && !result.includes(num)) result.push(num)
            }
        } catch {}

        return result
    }

    /**
     * 构建通知消息
     * @param {Error|string} error - 错误对象
     * @param {object} context - 上下文信息
     * @returns {string}
     */
    _buildMessage(error, context = {}) {
        const cfg = this.getConfig()
        const msg = error?.message || String(error)
        const errorType = classifyError(msg)
        const now = new Date().toLocaleString('zh-CN', { hour12: false })

        const lines = [`⚠️ API 错误通知`]
        lines.push(`时间: ${now}`)
        lines.push(`类型: ${errorType}`)

        if (context.userId) lines.push(`用户: ${context.userId}`)
        if (context.groupId) lines.push(`群聊: ${context.groupId}`)
        if (context.model) lines.push(`模型: ${context.model}`)

        if (cfg.includeDetail !== false) {
            const detail = msg.length > 200 ? msg.slice(0, 200) + '...' : msg
            lines.push(`详情: ${detail}`)
        }

        return lines.join('\n')
    }

    /**
     * 发送错误通知到配置的目标
     * @param {Error|string} error - 错误对象
     * @param {object} context - 上下文 { e, userId, groupId, model }
     * @returns {Promise<boolean>} 是否已发送通知（true = 已处理，调用方应静默）
     */
    async notify(error, context = {}) {
        if (!this.isEnabled()) return false

        const cfg = this.getConfig()
        const msg = error?.message || String(error)
        const errorType = classifyError(msg)

        const cooldown = Number(cfg.cooldown) || 60
        if (!this._checkCooldown(errorType, cooldown)) {
            logger.debug(`[ErrorNotifier] 错误类型 ${errorType} 在冷却中，跳过通知`)
            return true
        }

        const message = this._buildMessage(error, context)
        const e = context.e || null
        const targets = cfg.targets || []
        let sent = false

        for (const target of targets) {
            try {
                if (target.type === 'group' && target.id) {
                    await sendGroupMessage(e, parseInt(target.id), message)
                    sent = true
                    logger.debug(`[ErrorNotifier] 已通知群 ${target.id}`)
                } else if (target.type === 'user' && target.id) {
                    await sendPrivateMessage(e, parseInt(target.id), message)
                    sent = true
                    logger.debug(`[ErrorNotifier] 已通知用户 ${target.id}`)
                } else if (target.type === 'master') {
                    const masters = this._getMasterQQList()
                    for (const masterId of masters) {
                        try {
                            await sendPrivateMessage(e, masterId, message)
                            sent = true
                        } catch (err) {
                            logger.debug(`[ErrorNotifier] 通知主人 ${masterId} 失败: ${err.message}`)
                        }
                    }
                    if (masters.length > 0) {
                        logger.debug(`[ErrorNotifier] 已通知 ${masters.length} 位主人`)
                    }
                }
            } catch (err) {
                logger.warn(`[ErrorNotifier] 发送通知失败 (${target.type}:${target.id}): ${err.message}`)
            }
        }

        return sent
    }
}

export const errorNotifier = new ErrorNotifier()
export default ErrorNotifier
