/**
 * @fileoverview 上下文管理模块
 * @module services/llm/ContextManager
 * @description 管理AI对话的上下文历史、会话隔离和消息队列
 */

import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import { redisClient } from '../../core/cache/RedisClient.js'
import config from '../../../config/config.js'
import historyManager from '../../core/utils/history.js'
import { databaseService } from '../storage/DatabaseService.js'
import { MessageApi } from '../../utils/messageParser.js'
import { resolveClientTemperature } from './TemperatureResolver.js'

/** 请求计数器条目上限，超出后清理已归零的残留键 */
const REQUEST_COUNTER_MAX_SIZE = 5000
/** 请求计数器自动递减间隔(ms) */
const REQUEST_COUNTER_TTL = 5000

/**
 * 出错自动结清历史后回复给用户的提示文案。
 * ChatService 与 ChatAgent 两条链路共用，保证用户在任一链路看到的措辞一致。
 * @constant {string}
 */
export const AUTO_CLEAN_NOTICE = '历史对话已自动清理'

/**
 * 构建群聊环境说明片段，追加到 system prompt 尾部。
 *
 * 各调用链路对历史的加工方式不同，因此说明项由参数控制而非写死：
 * 只有真正对历史做过发送者标注的链路才会声明标注格式，
 * 避免向模型描述其输入中并不存在的结构。
 *
 * @param {Object} options - 构建选项
 * @param {string|number} options.groupId - 群号
 * @param {string} [options.groupName] - 群名称，为空则不输出该行
 * @param {string} options.userLabel - 当前发送者的群名片或昵称
 * @param {string|number} options.userUin - 当前发送者的QQ号
 * @param {boolean} [options.labeledHistory=false] - 历史消息是否已带 `[用户名(QQ号)]:` 发送者标注
 * @param {boolean} [options.mentionHint=true] - 是否说明 `[提及用户 ...]` 标记的含义
 * @returns {string} 以两个换行开头、可直接拼接到 system prompt 的环境说明
 */
/**
 * 构建对话总结提示词。
 *
 * 会话总结（summarizeConversation）与上下文压缩（_compressBySummarize）原本各写一份，
 * 措辞与约束不一致，导致同一份历史在两条路径下被总结成不同风格。此处统一为一份。
 *
 * 总结结果会被原样写回历史当作 assistant 消息，因此提示词必须明确禁止任何开场白，
 * 否则“好的，以下是总结：”一类前言会永久留在上下文里。
 *
 * @param {string} dialogText - 已格式化的对话文本，每行形如 `用户: xxx` / `助手: xxx`
 * @param {number} maxChars - 总结正文的字数上限
 * @returns {string} 完整提示词
 */
export function buildSummaryPrompt(dialogText, maxChars) {
    return `你是对话总结助手。请用简洁的中文总结下面这段对话的要点，并单独标出尚未解决的事项。

【对话记录】
每行开头的“用户:”“助手:”“系统:”表示该条发言者。
${dialogText}

【输出要求】
1. 用短条目列出要点，保留人名、时间、数字等关键信息。
2. 末尾单独列出“未解决：”部分；确实没有待办时写“未解决：无”。
3. 总结正文控制在 ${maxChars} 字以内。
4. 只输出总结正文，不要写开场白、结束语或任何解释。`
}

export function buildGroupEnvironmentPrompt(options = {}) {
    const { groupId, groupName = '', userLabel, userUin, labeledHistory = false, mentionHint = true } = options

    const lines = ['[当前对话环境]', `群号: ${groupId}`]
    if (groupName) lines.push(`群名: ${groupName}`)
    lines.push(`${labeledHistory ? '当前发送消息的用户' : '当前用户'}: ${userLabel}(QQ:${userUin})`)

    if (labeledHistory) {
        lines.push('你正在群聊中与多位用户对话，历史消息可能来自不同的人。')
        lines.push('每条用户消息都以 `[用户名(QQ号)]: ` 开头标注发送者，该前缀是系统附加的标记，不是用户说的话。')
        lines.push('请依据该标记区分不同用户，本轮只回复上面标注的当前发送者，不要代替其他人发言。')
    }
    if (mentionHint) {
        lines.push('消息中的 `[提及用户 QQ:xxx ...]` 是系统对 @ 的展开，附带被@者的QQ号、群名片、昵称等信息。')
    }

    return `\n\n${lines.join('\n')}`
}

/**
 * @class ContextManager
 * @classdesc 上下文管理器
 * @description
 * @example
 * // 获取会话ID
 * const convId = contextManager.getConversationId(userId, groupId)
 *
 * // 获取上下文历史
 * const history = await contextManager.getContextHistory(convId)
 *
 * // 构建带用户标签的上下文
 * const labeled = contextManager.buildLabeledContext(history, sender)
 */
export class ContextManager {
    constructor() {
        this.locks = new Map() // 异步锁: key -> { promise, resolve, acquiredAt }
        this.initialized = false
        this.maxContextMessages = 20 // 最多20条上文
        this.requestCounters = new Map() // 请求计数器（用于检测并发）
        this.messageQueues = new Map() // 消息队列（确保消息不丢失）
        this.processingFlags = new Map() // 处理中标记
        this.groupContextCache = new Map() // 群聊上下文缓存 (groupId -> context)
        this.sessionStates = new Map() // 会话状态 (conversationId -> state)
        this.autoSummarizeTimer = null
    }

    /**
     * 初始化上下文管理器
     */
    async init() {
        if (this.initialized) return
        await redisClient.init()
        this.initialized = true
        logger.debug('[ContextManager] Initialized')
        this.startAutoSummarize()
    }

    /**
     * 获取异步锁 - 简洁的 Promise-based 互斥锁
     * @param {string} key - 锁的key（conversationId）
     * @param {number} timeout - 超时时间(ms)，默认60秒
     * @returns {Promise<Function>} 释放锁的函数
     */
    async acquireLock(key, timeout = 60000) {
        const maxLockDuration = Math.max(90000, timeout + 60000)
        const startTime = Date.now()

        // 等待现有锁释放
        while (this.locks.has(key)) {
            const existingLock = this.locks.get(key)

            // 检查现有锁是否过期
            if (existingLock && Date.now() - existingLock.acquiredAt > maxLockDuration) {
                // 强制释放过期锁
                this._forceRelease(key)
                break
            }

            // 检查等待超时
            if (Date.now() - startTime > timeout) {
                throw new Error(`获取锁超时: ${key}`)
            }

            // 等待锁释放
            if (existingLock?.promise) {
                await Promise.race([
                    existingLock.promise,
                    new Promise(r => setTimeout(r, 1000)) // 每秒检查一次
                ])
            } else {
                await new Promise(r => setTimeout(r, 100))
            }
        }

        // 创建新锁
        let lockResolve
        const lockPromise = new Promise(resolve => {
            lockResolve = resolve
        })

        this.locks.set(key, {
            acquiredAt: Date.now(),
            promise: lockPromise,
            resolve: lockResolve
        })

        // 返回释放函数
        let released = false
        return () => {
            if (!released) {
                released = true
                this._forceRelease(key)
            }
        }
    }

    /**
     * 内部方法：强制释放锁
     * @private
     */
    _forceRelease(key) {
        const lock = this.locks.get(key)
        if (lock?.resolve) {
            lock.resolve()
        }
        this.locks.delete(key)
    }

    /**
     * 释放锁（外部调用）
     * @param {string} key
     */
    releaseLock(key) {
        this._forceRelease(key)
    }

    /**
     * 启动自动总结定时任务
     */
    startAutoSummarize() {
        const cfg = config.get('context.autoSummarize') || {}
        if (!cfg.enabled) return

        const intervalMs = (cfg.intervalMinutes || 10) * 60 * 1000
        if (this.autoSummarizeTimer) {
            clearInterval(this.autoSummarizeTimer)
        }

        this.autoSummarizeTimer = setInterval(() => {
            this.runAutoSummarize().catch(err => {
                logger.debug('[ContextManager] 自动总结失败:', err.message)
            })
        }, intervalMs)
        // 不阻止进程退出
        this.autoSummarizeTimer.unref?.()

        logger.debug(`[ContextManager] 自动总结已启动, 间隔 ${cfg.intervalMinutes || 10} 分钟`)
    }

    /**
     * 停止自动总结定时任务
     * @returns {void}
     */
    stopAutoSummarize() {
        if (this.autoSummarizeTimer) {
            clearInterval(this.autoSummarizeTimer)
            this.autoSummarizeTimer = null
            logger.debug('[ContextManager] 自动总结已停止')
        }
    }

    /**
     * 销毁上下文管理器：停止定时任务并清空内存态
     * 热重载时必须调用，否则旧实例的定时器会与新实例并发执行总结（删除+写入）
     * @returns {void}
     */
    destroy() {
        this.stopAutoSummarize()
        this.requestCounters.clear()
        this.messageQueues.clear()
        this.processingFlags.clear()
        this.groupContextCache.clear()
        this.sessionStates.clear()
        this.initialized = false
    }

    /**
     * 扫描并总结长时间未活跃的长对话
     */
    async runAutoSummarize() {
        const cfg = config.get('context.autoSummarize') || {}
        if (!cfg.enabled) return

        try {
            if (!databaseService.initialized) {
                databaseService.init()
            }
        } catch (e) {
            logger.debug('[ContextManager] 初始化数据库失败，跳过自动总结:', e.message)
            return
        }

        const maxMessagesBefore = cfg.maxMessagesBefore ?? 60
        const minInactiveMs = (cfg.minInactiveMinutes ?? 30) * 60 * 1000
        const windowMessages = cfg.windowMessages ?? 80
        const now = Date.now()

        const conversations = databaseService.getConversations()
        let processed = 0
        for (const conv of conversations) {
            if (processed >= 20) break // 单次最多处理20个，避免阻塞
            if ((conv.messageCount || 0) < maxMessagesBefore) continue

            const updatedAt = conv.updatedAt || conv.lastMessage || 0
            if (!updatedAt || now - updatedAt < minInactiveMs) continue

            // 避免频繁总结同一会话
            const state = this.sessionStates.get(conv.id)
            if (state?.lastSummarizedAt && now - state.lastSummarizedAt < minInactiveMs / 2) continue

            const success = await this.summarizeConversation(conv.id, {
                windowMessages,
                maxTokens: cfg.maxTokens ?? 400,
                model: cfg.model || null
            })

            if (success) {
                processed++
                this.sessionStates.set(conv.id, {
                    ...(state || {}),
                    lastSummarizedAt: Date.now()
                })
            }
        }

        if (processed > 0) {
            logger.debug(`[ContextManager] 自动总结完成: ${processed} 个会话`)
        }
    }

    /**
     * 总结指定会话并重置为短上下文
     * @param {string} conversationId
     * @param {Object} options
     * @returns {Promise<boolean>}
     */
    async summarizeConversation(conversationId, options = {}) {
        try {
            const history = await historyManager.getHistory(undefined, conversationId)
            if (!history || history.length === 0) return false

            const windowMessages = options.windowMessages ?? 80
            const slice = history.slice(-windowMessages)

            const dialogText = slice
                .map(msg => {
                    const roleLabel = msg.role === 'assistant' ? '助手' : msg.role === 'system' ? '系统' : '用户'
                    const text = Array.isArray(msg.content)
                        ? msg.content
                              .filter(c => c.type === 'text')
                              .map(c => c.text || '')
                              .join('')
                        : typeof msg.content === 'string'
                          ? msg.content
                          : ''
                    return `${roleLabel}: ${text}`.trim()
                })
                .filter(Boolean)
                .join('\n')

            if (!dialogText || dialogText.length < 50) return false

            const model = options.model || config.get('llm.defaultModel')
            const prompt = buildSummaryPrompt(dialogText, options.maxTokens || 400)

            const { LlmService } = await import('./LlmService.js')
            /* 从 conversationId 提取群ID（格式: group:${groupId}），使总结也能使用群独立渠道 */
            const groupIdMatch = conversationId?.match?.(/^group:(\d+)/)
            const client = await LlmService.getChatClient({ model, groupId: groupIdMatch?.[1] || undefined })
            const _temp = resolveClientTemperature(client, 0.2)
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                {
                    model,
                    maxToken: options.maxTokens || 400,
                    ...(_temp !== undefined ? { temperature: _temp } : {}),
                    disableHistorySave: true
                }
            )
            const summaryText = result.contents?.[0]?.text?.trim()
            if (!summaryText) return false

            // 先写入总结、确认落库后再裁剪旧消息
            // 反过来（先删后写）一旦写入失败，整段历史将永久不可恢复
            const summaryMessage = {
                role: 'assistant',
                content: [{ type: 'text', text: `【对话已总结】\n${summaryText}` }],
                timestamp: Date.now(),
                metadata: { summarized: true }
            }
            await historyManager.saveHistory(summaryMessage, conversationId)

            // saveMessage 内含去重逻辑可能静默跳过写入，必须回读确认后才允许删除旧消息
            const afterSave = await historyManager.getHistory(undefined, conversationId)
            const summarySaved = afterSave?.some(
                msg => msg.metadata?.summarized === true && msg.timestamp === summaryMessage.timestamp
            )
            if (!summarySaved) {
                logger.error(`[ContextManager] 总结未确认落库，已跳过历史裁剪以保护数据: ${conversationId}`)
                return false
            }

            // 只保留最新一条，即刚写入的总结
            await historyManager.trimHistory(conversationId, 1)

            logger.debug(`[ContextManager] 会话已总结并重置: ${conversationId}`)
            return true
        } catch (err) {
            logger.error(`[ContextManager] 总结会话失败 (${conversationId}):`, err.message)
            return false
        }
    }

    /**
     * 记录请求（用于并发检测）
     * @param {string} conversationId
     * @returns {number} 当前并发数
     */
    recordRequest(conversationId) {
        const count = (this.requestCounters.get(conversationId) || 0) + 1
        this.requestCounters.set(conversationId, count)

        // 容量保护：清掉已归零的残留键，避免 Map 随会话数无限增长
        if (this.requestCounters.size > REQUEST_COUNTER_MAX_SIZE) {
            for (const [key, value] of this.requestCounters) {
                if (value <= 0) this.requestCounters.delete(key)
            }
        }

        // 5秒后自动减少计数，归零时直接删除键
        const timer = setTimeout(() => {
            const current = this.requestCounters.get(conversationId) || 0
            if (current > 1) {
                this.requestCounters.set(conversationId, current - 1)
            } else {
                this.requestCounters.delete(conversationId)
            }
        }, REQUEST_COUNTER_TTL)
        timer.unref?.()

        return count
    }

    /**
     * 检查是否有并发请求
     * @param {string} conversationId
     * @returns {boolean}
     */
    hasConcurrentRequests(conversationId) {
        return (this.requestCounters.get(conversationId) || 0) > 1
    }

    /**
     * 添加消息到队列
     * @param {string} conversationId
     * @param {Object} message - 消息对象
     * @returns {number} 队列长度
     */
    enqueueMessage(conversationId, message) {
        if (!this.messageQueues.has(conversationId)) {
            this.messageQueues.set(conversationId, [])
        }
        const queue = this.messageQueues.get(conversationId)
        queue.push({
            ...message,
            enqueuedAt: Date.now()
        })

        // 防止队列无限增长，最多保留100条
        if (queue.length > 100) {
            queue.shift()
            logger.warn(`[ContextManager] 消息队列过长，丢弃旧消息: ${conversationId}`)
        }

        return queue.length
    }

    /**
     * 从队列获取消息
     * @param {string} conversationId
     * @returns {Object|null}
     */
    dequeueMessage(conversationId) {
        const queue = this.messageQueues.get(conversationId)
        if (!queue || queue.length === 0) return null
        return queue.shift()
    }

    /**
     * 获取队列长度
     * @param {string} conversationId
     * @returns {number}
     */
    getQueueLength(conversationId) {
        const queue = this.messageQueues.get(conversationId)
        return queue?.length || 0
    }

    /**
     * 清空队列
     * @param {string} conversationId
     */
    clearQueue(conversationId) {
        this.messageQueues.delete(conversationId)
    }

    /**
     * 标记正在处理
     * @param {string} conversationId
     * @param {boolean} processing
     */
    setProcessing(conversationId, processing) {
        if (processing) {
            this.processingFlags.set(conversationId, Date.now())
        } else {
            this.processingFlags.delete(conversationId)
        }
    }

    /**
     * 检查是否正在处理
     * @param {string} conversationId
     * @returns {boolean}
     */
    isProcessing(conversationId) {
        const startTime = this.processingFlags.get(conversationId)
        if (!startTime) return false

        // 超过60秒认为处理已超时，自动重置
        if (Date.now() - startTime > 60000) {
            this.processingFlags.delete(conversationId)
            return false
        }
        return true
    }

    /**
     * 获取会话ID - 用于上下文隔离
     * @param {string} userId - 用户 uin
     * @param {string} [groupId] - 群号
     * @returns {string} 会话ID
     *
     * 隔离策略 (configurable):
     * - 群聊:
     *   - groupUserIsolation=false: 群共享上下文（默认）
     *   - groupUserIsolation=true: 每用户独立上下文
     * - 私聊:
     *   - privateIsolation=true: 每用户独立上下文（默认）
     */
    getConversationId(userId, groupId = null) {
        const isolation = config.get('context.isolation') || {}
        const groupUserIsolation = isolation.groupUserIsolation ?? false
        const privateIsolation = isolation.privateIsolation ?? true

        if (groupId) {
            if (groupUserIsolation) {
                // 群聊用户隔离：每个用户独立上下文
                return `group:${groupId}:user:${userId}`
            }
            // 群聊共享：同一群的所有用户共享上下文
            return `group:${groupId}`
        }

        if (privateIsolation) {
            // 私聊隔离：每用户独立
            return `user:${userId}`
        }
        // 私聊共享（罕见场景）
        return `private:shared`
    }

    /**
     * 获取上下文历史 - 限制最多20条
     * @param {string} conversationId
     * @param {number} [limit] - 限制数量，默认20
     * @param {Object} [options] - 选项
     * @param {boolean} [options.includeToolCalls] - 是否包含工具调用记录
     * @returns {Promise<Array>} 历史消息
     */
    async getContextHistory(conversationId, limit = null, options = {}) {
        // 读取 autoContext 配置
        const autoContextConfig = config.get('context.autoContext') || {}
        const autoContextEnabled = autoContextConfig.enabled !== false

        // 如果自动上下文禁用，返回空历史
        if (!autoContextEnabled) {
            logger.debug('[ContextManager] 自动上下文已禁用，不携带历史消息')
            return []
        }

        // 优先使用 autoContext 配置的 maxHistoryMessages
        const maxMessages =
            limit ||
            autoContextConfig.maxHistoryMessages ||
            config.get('context.maxMessages') ||
            this.maxContextMessages
        const includeToolCalls = options.includeToolCalls ?? autoContextConfig.includeToolCalls ?? false

        let history = await historyManager.getHistory(undefined, conversationId)

        // 如果不包含工具调用，过滤掉 tool 角色的消息和包含 toolCalls 的消息
        if (!includeToolCalls) {
            history = history.filter(msg => {
                // 过滤掉 tool 角色的消息
                if (msg.role === 'tool') return false
                // 过滤掉包含 toolCalls 的 assistant 消息（但保留有文本内容的）
                if (msg.role === 'assistant' && msg.toolCalls?.length > 0) {
                    // 检查是否有有意义的文本内容
                    const hasText = Array.isArray(msg.content)
                        ? msg.content.some(c => c.type === 'text' && c.text?.trim())
                        : typeof msg.content === 'string' && msg.content.trim()
                    // 如果没有文本内容，过滤掉
                    if (!hasText) return false
                }
                return true
            })
        }

        // 限制最多返回数量
        if (history.length > maxMessages) {
            return history.slice(-maxMessages)
        }
        return history
    }

    /**
     * 构建带用户标签的上下文消息
     * 用于多用户群聊场景，AI可以区分不同用户的发言
     *
     * @param {Array} history - 历史消息
     * @param {Object} currentSender - 当前发送者信息
     * @param {Object} options - 额外选项
     * @returns {Array} 带用户标签的消息
     */
    buildLabeledContext(history, currentSender = null, options = {}) {
        const { includeTimestamp = false, maxAge = 0 } = options
        const now = Date.now()
        // 过滤过期消息
        let filtered = history
        if (maxAge > 0) {
            filtered = history.filter(msg => {
                if (!msg.timestamp) return true
                return now - msg.timestamp < maxAge
            })
        }

        return filtered.map((msg, index) => {
            // 只处理用户消息
            if (msg.role === 'user') {
                // 有 sender 信息
                if (msg.sender && msg.sender.user_id) {
                    const label = msg.sender.card || msg.sender.nickname || `用户`
                    let labeledContent = this.addUserLabelToContent(msg.content, label, msg.sender.user_id)

                    // 添加时间戳（可选）
                    if (includeTimestamp && msg.timestamp) {
                        const timeStr = new Date(msg.timestamp).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit'
                        })
                        labeledContent = this.prependTimeToContent(labeledContent, timeStr)
                    }

                    return {
                        ...msg,
                        content: labeledContent
                    }
                } else {
                    // 没有 sender 信息的历史消息，添加默认标签
                    const labeledContent = this.addUserLabelToContent(msg.content, '用户', `历史#${index}`)
                    return {
                        ...msg,
                        content: labeledContent
                    }
                }
            }
            return msg
        })
    }

    /**
     * 在内容前添加时间戳
     * @param {Array|string} content
     * @param {string} timeStr
     * @returns {Array}
     */
    prependTimeToContent(content, timeStr) {
        if (!content) return content

        if (typeof content === 'string') {
            return [{ type: 'text', text: `[${timeStr}] ${content}` }]
        }

        if (Array.isArray(content)) {
            const labeled = [...content]
            const textIndex = labeled.findIndex(c => c.type === 'text')
            if (textIndex >= 0) {
                const existingText = labeled[textIndex].text || ''
                // 在用户标签后插入时间
                const updated = existingText.replace(/^(\[[^\]]+\])/, `$1[${timeStr}]`)
                labeled[textIndex] = { ...labeled[textIndex], text: updated }
            }
            return labeled
        }

        return content
    }

    /**
     * 给消息内容添加用户标签
     * @param {Array|string} content - 消息内容
     * @param {string} label - 用户标签
     * @param {number|string} userId - 用户ID
     * @returns {Array} 带标签的内容
     */
    addUserLabelToContent(content, label, userId) {
        if (!content) return content

        // 如果是字符串，转换为数组格式
        if (typeof content === 'string') {
            return [{ type: 'text', text: `[${label}(${userId})]: ${content}` }]
        }

        // 如果是数组，给第一个文本内容添加标签
        if (Array.isArray(content)) {
            const labeled = [...content]
            const textIndex = labeled.findIndex(c => c.type === 'text')
            if (textIndex >= 0) {
                labeled[textIndex] = {
                    ...labeled[textIndex],
                    text: `[${label}(${userId})]: ${labeled[textIndex].text || ''}`
                }
            }
            return labeled
        }

        return content
    }

    /**
     * 获取隔离模式描述
     * @returns {Object} 隔离模式信息
     */
    getIsolationMode() {
        const isolation = config.get('context.isolation') || {}
        return {
            groupUserIsolation: isolation.groupUserIsolation ?? false,
            privateIsolation: isolation.privateIsolation ?? true,
            description: {
                group: (isolation.groupUserIsolation ?? false) ? '群聊用户独立上下文' : '群聊共享上下文',
                private: (isolation.privateIsolation ?? true) ? '私聊用户独立上下文' : '私聊共享上下文'
            }
        }
    }

    /**
     * Get context (history) for a user
     * @param {string} userId
     * @param {string} conversationId
     * @returns {Promise<Array>} History messages
     */
    async getContext(conversationId) {
        return await historyManager.getHistory(undefined, conversationId)
    }

    /**
     * Update context metadata
     * @param {string} conversationId
     * @param {Object} metadata
     */
    async updateContext(conversationId, metadata) {
        const key = `context:${conversationId}`
        const existing = await redisClient.get(key)
        let data = {}
        if (existing) {
            try {
                data = JSON.parse(existing)
            } catch (e) {}
        }

        data = { ...data, ...metadata, lastUpdated: Date.now() }

        // Save metadata (7 days TTL)
        await redisClient.set(key, JSON.stringify(data), 7 * 24 * 60 * 60)

        // Add to active contexts set
        if (redisClient.isConnected) {
            await redisClient.client.sadd('active_contexts', conversationId)
        }
    }

    /**
     * Get all active contexts
     * @returns {Promise<Array>}
     */
    async getActiveContexts() {
        if (!redisClient.isConnected) return []

        const ids = await redisClient.client.smembers('active_contexts')
        const contexts = []

        for (const id of ids) {
            const data = await redisClient.get(`context:${id}`)
            if (data) {
                try {
                    contexts.push({
                        id,
                        ...JSON.parse(data)
                    })
                } catch (e) {}
            } else {
                // Cleanup if metadata missing
                await redisClient.client.srem('active_contexts', id)
            }
        }

        return contexts.sort((a, b) => (b.lastUpdated || 0) - (a.lastUpdated || 0))
    }

    /**
     * Clean context based on strategy
     * 优化的上下文清理机制，保留最近的重要对话
     * @param {string} conversationId
     */
    async cleanContext(conversationId) {
        const maxMessages = config.get('context.maxMessages') || 20
        const strategy = config.get('context.cleaningStrategy') || 'truncate'

        const history = await historyManager.getHistory(undefined, conversationId)

        if (history.length <= maxMessages) {
            return // 不需要清理
        }

        logger.debug(`[ContextManager] 清理上下文: ${conversationId}, ${history.length} -> ${maxMessages}`)

        if (strategy === 'smart') {
            // 智能清理：保留最近对话和重要消息
            try {
                const keepCount = maxMessages

                // 标记重要消息（包含关键信息的消息）
                const importantIndicators = ['记住', '我是', '我叫', '我的', '重要', '记得', '别忘']
                const importantMessages = []
                const recentMessages = history.slice(-keepCount)

                // 从早期消息中提取重要内容
                const earlyMessages = history.slice(0, -keepCount)
                for (const msg of earlyMessages) {
                    const content = Array.isArray(msg.content)
                        ? msg.content
                              .filter(c => c.type === 'text')
                              .map(c => c.text)
                              .join('')
                        : msg.content

                    if (importantIndicators.some(ind => content?.includes(ind))) {
                        importantMessages.push(msg)
                        if (importantMessages.length >= 3) break // 最多保留3条重要消息
                    }
                }

                // 保留最近 keepCount 条，并额外豁免早期的重要消息
                // 这里只做「删除时排除」，不重写任何消息，因此不存在数据丢失风险
                const keepTimestamps = importantMessages.map(msg => msg.timestamp).filter(t => Number.isFinite(t))

                if (typeof databaseService.trimMessagesKeeping === 'function') {
                    databaseService.trimMessagesKeeping(conversationId, keepCount, keepTimestamps)
                    logger.debug(
                        `[ContextManager] 智能清理: 保留${keepTimestamps.length}条重要+最近${recentMessages.length}条`
                    )
                } else {
                    // 存储层不支持豁免裁剪时降级为普通截断，日志如实反映行为
                    await historyManager.trimHistory(conversationId, maxMessages)
                    logger.debug(`[ContextManager] 智能清理降级为截断: 保留最近${maxMessages}条`)
                }
                return
            } catch (error) {
                logger.error('[ContextManager] 智能清理失败，回退到截断模式', error)
            }
        }

        // 默认/回退: 简单截断，保留最近的消息
        await historyManager.trimHistory(conversationId, maxMessages)
    }

    /**
     * 缓存群聊上下文
     * @param {string} groupId
     * @param {Object} context
     */
    cacheGroupContext(groupId, context) {
        this.groupContextCache.set(groupId, {
            context,
            timestamp: Date.now()
        })

        // 清理过期缓存
        if (this.groupContextCache.size > 100) {
            const expireTime = 30 * 60 * 1000 // 30分钟
            const now = Date.now()
            for (const [id, cached] of this.groupContextCache) {
                if (now - cached.timestamp > expireTime) {
                    this.groupContextCache.delete(id)
                }
            }
        }
    }

    /**
     * 获取缓存的群聊上下文
     * @param {string} groupId
     * @returns {Object|null}
     */
    getCachedGroupContext(groupId) {
        const cached = this.groupContextCache.get(groupId)
        if (!cached) return null

        // 检查是否过期（5分钟）
        if (Date.now() - cached.timestamp > 5 * 60 * 1000) {
            this.groupContextCache.delete(groupId)
            return null
        }

        return cached.context
    }

    /**
     * 清除群聊上下文缓存
     * @param {string} groupId
     */
    clearGroupContextCache(groupId) {
        this.groupContextCache.delete(groupId)
    }

    /**
     * 设置会话状态
     * @param {string} conversationId
     * @param {Object} state
     */
    setSessionState(conversationId, state) {
        const existing = this.sessionStates.get(conversationId) || {}
        this.sessionStates.set(conversationId, {
            ...existing,
            ...state,
            updatedAt: Date.now()
        })
    }

    /**
     * 获取会话状态
     * @param {string} conversationId
     * @returns {Object|null}
     */
    getSessionState(conversationId) {
        return this.sessionStates.get(conversationId) || null
    }

    /**
     * 清除会话状态
     * @param {string} conversationId
     */
    clearSessionState(conversationId) {
        this.sessionStates.delete(conversationId)
    }

    /**
     * 获取上下文统计信息
     * @param {string} conversationId
     * @returns {Object}
     */
    async getContextStats(conversationId) {
        const history = await historyManager.getHistory(undefined, conversationId)
        const maxMessages = config.get('context.maxMessages') || 20

        return {
            messageCount: history.length,
            maxMessages,
            needsCleaning: history.length > maxMessages,
            userMessages: history.filter(m => m.role === 'user').length,
            assistantMessages: history.filter(m => m.role === 'assistant').length
        }
    }

    /**
     * 检查对话轮数并自动结束
     * @param {string} conversationId
     * @returns {Promise<{shouldEnd: boolean, currentRounds: number, maxRounds: number}>}
     */
    async checkAutoEnd(conversationId) {
        const autoEndConfig = config.get('context.autoEnd') || {}

        if (!autoEndConfig.enabled) {
            return { shouldEnd: false, currentRounds: 0, maxRounds: 0 }
        }

        const maxRounds = autoEndConfig.maxRounds || 50
        const history = await historyManager.getHistory(undefined, conversationId)

        // 计算对话轮数（每次用户消息+AI回复算一轮）
        const userMessages = history.filter(m => m.role === 'user').length
        const currentRounds = userMessages

        const shouldEnd = currentRounds >= maxRounds

        if (shouldEnd) {
            logger.debug(`[ContextManager] 对话达到轮数限制: ${conversationId}, ${currentRounds}/${maxRounds}`)
        }

        return {
            shouldEnd,
            currentRounds,
            maxRounds,
            notifyUser: autoEndConfig.notifyUser !== false,
            notifyMessage: autoEndConfig.notifyMessage || '对话已达到最大轮数限制，已自动开始新会话。'
        }
    }

    /**
     * 执行自动结束对话
     * @param {string} conversationId
     * @returns {Promise<boolean>}
     */
    async executeAutoEnd(conversationId) {
        try {
            await historyManager.deleteConversation(conversationId)
            await this.cleanContext(conversationId)
            this.clearSessionState(conversationId)
            logger.debug(`[ContextManager] 自动结束对话: ${conversationId}`)
            return true
        } catch (error) {
            logger.error(`[ContextManager] 自动结束对话失败: ${error.message}`)
            return false
        }
    }

    /**
     * 构建群聊上下文摘要
     * 用于在系统提示词中提供群聊背景信息
     * @param {string} groupId
     * @param {Object} options
     * @returns {Promise<string>}
     */
    async buildGroupContextSummary(groupId, options = {}) {
        const { includeMembers = true, includeTopics = true, maxLength = 500 } = options

        const cached = this.getCachedGroupContext(groupId)
        if (cached?.summary) {
            return cached.summary
        }

        const parts = []

        // 获取群信息
        try {
            const bot = global.Bot
            if (bot?.pickGroup) {
                const group = bot.pickGroup(parseInt(groupId))
                const info = await group.getInfo?.()
                if (info) {
                    parts.push(`群名: ${info.group_name || groupId}`)
                    if (info.member_count) {
                        parts.push(`成员数: ${info.member_count}`)
                    }
                }
            }
        } catch (e) {
            // ignore
        }

        const summary = parts.join('\n').substring(0, maxLength)

        // 缓存摘要
        this.cacheGroupContext(groupId, { summary })

        return summary
    }

    /**
     * 获取群聊天历史记录
     * 兼容 miao-adapter/icqq 和 OneBot/NapCat
     * @param {Object} group - 群对象 (Bot.pickGroup(groupId))
     * @param {number} num - 获取数量
     * @param {Object} options - 选项
     * @returns {Promise<Array>} 聊天记录数组
     */
    async getChatHistoryGroup(group, num = 20, options = {}) {
        if (!group || typeof group.getChatHistory !== 'function') {
            return []
        }

        const { formatMessages = false } = options
        const allowedMessageTypes = ['text', 'at', 'image', 'video', 'bface', 'forward', 'json', 'reply']
        const seenMessageIds = new Set()

        try {
            // 处理和过滤消息
            const processChats = rawChats => {
                return rawChats.filter(chat => {
                    const messageId = chat.seq || chat.message_seq || chat.message_id
                    if (seenMessageIds.has(messageId)) {
                        return false
                    }
                    if (!chat.sender?.user_id || !chat.message?.length) {
                        return false
                    }
                    if (!chat.message.some(msgPart => allowedMessageTypes.includes(msgPart.type))) {
                        return false
                    }
                    seenMessageIds.add(messageId)
                    return true
                })
            }

            // 获取初始消息
            let initialChats = await group.getChatHistory(0, 20)
            if (!initialChats || initialChats.length === 0) {
                return []
            }

            let chats = processChats(initialChats)
            let seq = Number(initialChats[0]?.seq || initialChats[0]?.message_seq || 0)

            // 继续获取更多消息直到达到数量
            while (chats.length < num && seq) {
                try {
                    const chatHistory = await group.getChatHistory(seq, 20)
                    const newSeq = Number(chatHistory[0]?.seq || chatHistory[0]?.message_seq || 0)

                    if (!chatHistory || chatHistory.length === 0 || seq === newSeq) {
                        break
                    }

                    seq = newSeq
                    const newChats = processChats(chatHistory)

                    if (newChats.length === 0) {
                        break
                    }

                    chats.unshift(...newChats)
                } catch (err) {
                    logger.debug(`[ContextManager] 获取更多聊天记录失败: ${err.message}`)
                    break
                }
            }

            // 只保留最近的 num 条
            chats = chats.slice(Math.max(0, chats.length - num))

            return chats
        } catch (err) {
            logger.error('[ContextManager] 获取群聊天记录失败:', err.message)
            return []
        }
    }

    /**
     * 格式化聊天消息内容
     * @param {Object} group - 群对象
     * @param {Object} chat - 聊天消息
     * @returns {Promise<string>} 格式化后的消息文本
     */
    async formatChatMessage(group, chat) {
        const roleMap = { owner: '群主', admin: '管理员', member: '普通成员' }
        const sender = chat.sender || {}
        const chatTime = chat.time || Math.floor(Date.now() / 1000)
        const senderId = sender.user_id

        // 获取成员信息
        let senderName = sender.card || sender.nickname || senderId || '未知用户'
        let memberInfo = null
        try {
            const member = group.pickMember?.(senderId)
            memberInfo = member?.info || (await member?.getInfo?.(true))
            if (memberInfo) {
                senderName = memberInfo.card || memberInfo.nickname || senderName
            }
        } catch {
            try {
                memberInfo = (await group.pickMember(Number(senderId)))?.info
                if (memberInfo) {
                    senderName = memberInfo.card || memberInfo.nickname || senderName
                }
            } catch {}
        }

        const senderRole = roleMap[sender.role] || '普通成员'
        const timeStr = new Date(chatTime * 1000).toLocaleTimeString('zh-CN', { hour12: false })

        // 构建消息头
        let messageHeader = `【${senderName}】(QQ:${senderId}, 角色:${senderRole}`
        if (sender.title) {
            messageHeader += `, 头衔:${sender.title}`
        }
        messageHeader += `, 时间:${timeStr}`
        const seq = chat.seq || chat.message_seq
        if (seq) {
            messageHeader += `, seq:${seq}`
        }

        // 处理引用消息
        const replyPart = chat.message?.find(msg => msg.type === 'reply')
        if (replyPart) {
            const replySeq = replyPart.seq || replyPart.data?.seq
            if (replySeq) {
                try {
                    const originalMsgArray = await group.getChatHistory(Number(replySeq), 1)
                    const originalMsg =
                        originalMsgArray?.find?.(msg => Number(msg.seq) === Number(replySeq)) || originalMsgArray?.[0]
                    if (originalMsg?.sender) {
                        const originalSenderId = originalMsg.sender.user_id
                        let originalSenderName =
                            originalMsg.sender.card || originalMsg.sender.nickname || originalSenderId
                        const originalContent = this._extractMessageText(originalMsg.message)
                        messageHeader += `, 引用了${originalSenderName}(QQ:${originalSenderId})的消息"${originalContent.substring(0, 50)}"`
                    }
                } catch {}
            }
        }

        messageHeader += `) 说：`

        // 提取消息内容
        const messageContent = this._extractMessageText(chat.message?.filter(m => m.type !== 'reply'))

        return `${messageHeader}${messageContent}`
    }

    /**
     * @private
     * @param {Array} messageParts - 消息段数组
     * @param {boolean} deepParse - 是否深度解析
     */
    _extractMessageText(messageParts, deepParse = false) {
        if (!messageParts) return ''
        if (typeof messageParts === 'string') return messageParts
        if (!Array.isArray(messageParts)) {
            if (messageParts.raw_message) return messageParts.raw_message
            if (messageParts.message) return this._extractMessageText(messageParts.message, deepParse)
            return String(messageParts)
        }

        const contentParts = []
        for (const msgPart of messageParts) {
            if (!msgPart) continue

            const data = msgPart.data || msgPart
            const type = msgPart.type || data.type

            switch (type) {
                case 'text':
                    contentParts.push(data.text || msgPart.text || '')
                    break
                case 'at':
                    const atName = data.name || msgPart.name || ''
                    const atQQ = data.qq || msgPart.qq || ''
                    contentParts.push(atName ? `@${atName}` : `@${atQQ}`)
                    break
                case 'image': {
                    const isAnimated = data.asface === true || data.sub_type === 1
                    const summary = data.summary || data.file_unique || ''
                    if (summary && deepParse) {
                        contentParts.push(`[图片:${summary}]`)
                    } else {
                        contentParts.push(isAnimated ? '[动画表情]' : '[图片]')
                    }
                    break
                }
                case 'video':
                    contentParts.push('[视频]')
                    break
                case 'bface':
                case 'mface':
                    contentParts.push(data.text || msgPart.text || data.summary || '[表情]')
                    break
                case 'forward':
                    contentParts.push('[聊天记录]')
                    break
                case 'json':
                    try {
                        const jsonStr = data.data || msgPart.data
                        const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
                        if (jsonData?.meta?.detail?.resid) {
                            contentParts.push('[聊天记录]')
                        } else if (jsonData?.meta?.news?.title) {
                            contentParts.push(`[分享:${jsonData.meta.news.title}]`)
                        } else if (jsonData?.prompt) {
                            contentParts.push(`[卡片:${jsonData.prompt}]`)
                        } else {
                            contentParts.push('[卡片消息]')
                        }
                    } catch {
                        contentParts.push('[卡片消息]')
                    }
                    break
                case 'xml':
                    try {
                        const xmlStr = data.data || msgPart.data || ''
                        const briefMatch = xmlStr.match(/brief="([^"]*)"/)
                        if (briefMatch) {
                            contentParts.push(`[XML:${briefMatch[1]}]`)
                        } else {
                            contentParts.push('[XML消息]')
                        }
                    } catch {
                        contentParts.push('[XML消息]')
                    }
                    break
                case 'face':
                    contentParts.push(`[表情:${data.id || msgPart.id}]`)
                    break
                case 'record':
                    contentParts.push('[语音]')
                    break
                case 'file':
                    contentParts.push(`[文件:${data.name || data.file || '未知'}]`)
                    break
                case 'share':
                    contentParts.push(`[分享:${data.title || '链接'}]`)
                    break
                case 'location':
                    contentParts.push(`[位置:${data.title || data.address || '未知'}]`)
                    break
                case 'poke':
                    contentParts.push('[戳一戳]')
                    break
                case 'reply':
                    // 忽略引用标记本身
                    break
                case 'markdown':
                    contentParts.push(data.content || data.text || '[Markdown]')
                    break
                default:
                    // 深度解析：尝试从未知类型提取内容
                    if (deepParse) {
                        if (data.text) contentParts.push(data.text)
                        else if (data.content) contentParts.push(data.content)
                        else if (data.summary) contentParts.push(`[${type}:${data.summary}]`)
                        else if (type) contentParts.push(`[${type}]`)
                    }
                    break
            }
        }
        return contentParts.join('').replace(/\n/g, ' ').trim()
    }

    /**
     * 构建完整的群聊上下文提示
     * 包含群信息、当前用户、聊天历史
     * @param {string|number} groupId - 群号
     * @param {Object} options - 选项
     * @returns {Promise<string>} 群聊上下文提示
     */
    async buildGroupPrompt(groupId, options = {}) {
        const { sender, contextLength = 20, promptHeader = null } = options
        let systemPromptWithContext = ''

        const bot = global.Bot
        const group = bot?.pickGroup?.(parseInt(groupId))
        if (!group) return ''

        // 构建头部信息
        if (promptHeader) {
            systemPromptWithContext += promptHeader
        } else {
            // 获取机器人在群内的信息
            let botName = bot.nickname || bot.uin
            try {
                const botMember = group.pickMember?.(bot.uin)
                const botInfo = botMember?.info || (await botMember?.getInfo?.(true))
                if (botInfo) {
                    botName = botInfo.card || botInfo.nickname || botName
                }
            } catch {}

            // 获取群信息
            let groupName = groupId
            try {
                const groupInfo = await group.getInfo?.()
                groupName = groupInfo?.group_name || groupInfo?.name || groupId
            } catch {}

            systemPromptWithContext += `你目前正在一个QQ群聊中。`
            systemPromptWithContext += `\n群名称: ${groupName}, 群号: ${groupId}。`
            systemPromptWithContext += `你现在是这个QQ群的成员，你的昵称是"${botName}"(QQ:${bot.uin})。`

            // 当前用户信息
            if (sender) {
                const latestSenderName = sender.card || sender.nickname || sender.user_id
                const roleMap = { owner: '群主', admin: '管理员', member: '普通成员' }
                systemPromptWithContext += `\n当前向你提问的用户是: ${latestSenderName}(QQ:${sender.user_id})。`
                systemPromptWithContext += ` (角色: ${roleMap[sender.role] || '普通成员'}`
                if (sender.title) systemPromptWithContext += `, 群头衔: ${sender.title}`
                systemPromptWithContext += `)。\n`
            }
        }

        // 获取聊天历史
        let chats = []
        try {
            chats = await this.getChatHistoryGroup(group, contextLength)
        } catch (err) {
            logger.debug(`[ContextManager] 获取群聊历史失败: ${err.message}`)
        }

        // 格式化聊天历史
        if (chats && chats.length > 0) {
            /* 原为 175 字一整句，三件事（@语法/阅读要求/回复风格）挤在一起，模型容易只抓住其中一条，故拆为分行条目 */
            systemPromptWithContext +=
                '\n需要@某人时，在回复中直接写 @对方QQ号，例如 @123456。' +
                '\n你的回复要自然融入当前对话，像一个真正的群成员那样说话；不要复述或总结聊天记录，只说你这一条要发的内容。' +
                '\n以下是最近的群内聊天记录，请仔细阅读，理解群成员在聊什么、话题往哪走，并据此组织你的回复：\n'

            // formatChatMessage 内含网络调用，用 allSettled 避免单条失败丢弃全部已格式化记录
            const settled = await Promise.allSettled(chats.map(chat => this.formatChatMessage(group, chat)))
            const failedCount = settled.filter(r => r.status === 'rejected').length
            if (failedCount > 0) {
                logger.debug(`[ContextManager] 群聊记录格式化失败 ${failedCount}/${settled.length} 条，已跳过`)
            }
            const formattedChats = settled.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
            systemPromptWithContext += formattedChats.join('\n')
        }

        // 缓存结果
        this.cacheGroupContext(groupId, { prompt: systemPromptWithContext })

        return systemPromptWithContext
    }

    /**
     * @param {Object} e - 事件对象
     * @param {Object} options - 选项
     * @param {boolean} options.includeChain - 是否获取引用链
     * @param {number} options.maxDepth - 引用链最大深度
     * @returns {Promise<{text: string, chain: Array}>} 引用消息文本和引用链
     */
    async getQuoteContent(e, options = {}) {
        const { includeChain = true, maxDepth = 3 } = options
        let quoteText = ''
        const chain = []

        if (!e.source && !e.reply_id) {
            const replyPart = e.message?.find(msg => msg.type === 'reply')
            if (!replyPart) {
                return { text: quoteText, chain }
            }
        }

        const bot = e.bot || global.Bot
        const getMessage = async (messageId, seq) => {
            const apiMsg = await MessageApi.getMsg(e, messageId || seq, { useSeq: !messageId, seq })
            if (apiMsg) return apiMsg.data || apiMsg
            if (bot?.getMsg && messageId) {
                try {
                    const msg = await bot.getMsg(messageId)
                    if (msg) return msg.data || msg
                } catch (err) {
                    logger.debug(`[ContextManager] bot.getMsg失败: ${err.message}`)
                }
            }
            if (bot?.sendApi && messageId) {
                try {
                    const result = await bot.sendApi('get_msg', { message_id: messageId })
                    if (result) return result.data || result
                } catch (err) {
                    logger.debug(`[ContextManager] sendApi.get_msg失败: ${err.message}`)
                }
            }
            if (e.group?.getChatHistory && seq) {
                try {
                    const history = await e.group.getChatHistory(Number(seq), 20)
                    const found = history?.find?.(m => Number(m.seq) === Number(seq))
                    if (found || history?.length) return found || history[history.length - 1]
                } catch (err) {
                    logger.debug(`[ContextManager] group.getChatHistory失败: ${err.message}`)
                }
            }
            if (e.getReply && typeof e.getReply === 'function') {
                try {
                    return await e.getReply()
                } catch (err) {
                    logger.debug(`[ContextManager] e.getReply失败: ${err.message}`)
                }
            }
            return null
        }

        /**
         * 检查消息是否包含引用
         */
        const getNestedReply = msg => {
            if (!msg) return null
            // 检查 source
            if (msg.source) {
                return { seq: msg.source.seq, message_id: msg.source.message_id }
            }
            // 检查消息段中的 reply
            const message = msg.message || msg
            if (Array.isArray(message)) {
                const replySeg = message.find(m => m.type === 'reply')
                if (replySeg) {
                    return { message_id: replySeg.id || replySeg.data?.id }
                }
            }
            return null
        }

        // 获取第一层引用消息
        const messageId = e.source?.message_id || e.reply_id
        const seq = e.source?.seq
        const replyPart = e.message?.find(msg => msg.type === 'reply')
        const replyMsgId = messageId || replyPart?.id || replyPart?.data?.id

        let originalMsg = await getMessage(replyMsgId, seq)
        if (!originalMsg && e.source) {
            if (e.source.message || e.source.raw_message) {
                originalMsg = e.source
            }
        }

        // 格式化引用内容
        if (originalMsg) {
            const originalSenderId = originalMsg.user_id || originalMsg.sender?.user_id
            let originalSenderName =
                originalMsg.sender?.card || originalMsg.sender?.nickname || originalSenderId || '未知用户'

            // 尝试获取更准确的昵称
            if (e.group?.pickMember && originalSenderId) {
                try {
                    const member = e.group.pickMember(originalSenderId)
                    const memberInfo = member?.info || (await member?.getInfo?.(true))
                    if (memberInfo) {
                        originalSenderName = memberInfo.card || memberInfo.nickname || originalSenderName
                    }
                } catch {}
            }

            // 深度解析消息内容
            let originalContent = ''
            if (originalMsg.raw_message) {
                originalContent = originalMsg.raw_message
            } else if (originalMsg.message) {
                originalContent = this._extractMessageText(originalMsg.message, true)
            } else {
                // 尝试深度解析整个消息体
                originalContent = this._extractMessageText(originalMsg, true)
            }

            // 截断过长内容
            if (originalContent.length > 500) {
                originalContent = originalContent.substring(0, 500) + '...'
            }

            quoteText = ` 引用了${originalSenderName}(QQ:${originalSenderId})的消息"${originalContent}"`

            const originalSeq = originalMsg.seq || originalMsg.message_seq || originalMsg.message_id
            if (originalSeq) {
                quoteText += `(seq:${originalSeq})`
            }

            // 添加到引用链
            chain.push({
                depth: 0,
                user_id: String(originalSenderId || ''),
                nickname: originalSenderName,
                content: originalContent,
                message_id: originalMsg.message_id || replyMsgId
            })

            // 获取引用链（如果被引用的消息也引用了其他消息）
            if (includeChain) {
                let currentMsg = originalMsg
                let depth = 0

                while (depth < maxDepth) {
                    const nestedReply = getNestedReply(currentMsg)
                    if (!nestedReply) break

                    const nestedMsg = await getMessage(nestedReply.message_id, nestedReply.seq)
                    if (!nestedMsg) break

                    const nestedSenderId = nestedMsg.user_id || nestedMsg.sender?.user_id
                    const nestedSenderName =
                        nestedMsg.sender?.card || nestedMsg.sender?.nickname || nestedSenderId || '未知'
                    let nestedContent =
                        nestedMsg.raw_message || this._extractMessageText(nestedMsg.message || nestedMsg, true)

                    if (nestedContent.length > 300) {
                        nestedContent = nestedContent.substring(0, 300) + '...'
                    }

                    chain.push({
                        depth: depth + 1,
                        user_id: String(nestedSenderId || ''),
                        nickname: nestedSenderName,
                        content: nestedContent,
                        message_id: nestedMsg.message_id
                    })

                    // 在引用文本中添加嵌套引用信息
                    if (depth === 0) {
                        quoteText += `\n  └ 该消息引用了${nestedSenderName}的消息"${nestedContent.substring(0, 100)}${nestedContent.length > 100 ? '...' : ''}"`
                    }

                    currentMsg = nestedMsg
                    depth++
                }
            }
        }

        return { text: quoteText, chain }
    }

    // ========== 上下文压缩与 Skills 重注入 ==========

    /**
     * 获取上下文压缩配置
     * @param {Object} options - 运行时覆盖选项
     * @returns {Object}
     */
    getContextConfig(options = {}) {
        const base = config.get('context') || {}
        return {
            maxTokens: options.maxTokens ?? base.maxTokens ?? 0,
            maxMessages: options.maxMessages ?? base.maxMessages ?? this.maxContextMessages,
            compressionThreshold: base.compressionThreshold ?? 0.8,
            compressionStrategy: base.compressionStrategy ?? 'summarize',
            preserveSystemPrompt: base.preserveSystemPrompt !== false,
            preserveRecentMessages: base.preserveRecentMessages ?? 4,
            autoReloadSkills: base.autoReloadSkills !== false
        }
    }

    /**
     * 估算消息列表的 token 数
     * @param {Array} messages
     * @returns {number}
     */
    estimateTokens(messages) {
        let total = 0
        for (const msg of messages) {
            const content = Array.isArray(msg.content)
                ? msg.content
                      .filter(c => c.type === 'text')
                      .map(c => c.text || '')
                      .join('')
                : typeof msg.content === 'string'
                  ? msg.content
                  : ''
            total += Math.ceil(content.length / 3)
        }
        return total
    }

    /**
     * 检查上下文长度并在必要时压缩
     * @param {string} conversationId
     * @param {Array} messages - 当前消息列表
     * @param {Object} options - 包含 model, maxTokens, loadedSkills 等
     * @returns {Promise<{messages: Array, compressed: boolean, skillsReinjected: boolean}>}
     */
    async checkAndCompress(conversationId, messages, options = {}) {
        const ctxConfig = this.getContextConfig(options)
        let compressed = false
        let skillsReinjected = false

        if (!messages || messages.length === 0) {
            return { messages, compressed, skillsReinjected }
        }

        let needsCompression = false

        if (ctxConfig.maxTokens > 0) {
            const estimatedTokens = this.estimateTokens(messages)
            const threshold = Math.floor(ctxConfig.maxTokens * ctxConfig.compressionThreshold)
            if (estimatedTokens > threshold) {
                needsCompression = true
                logger.debug(
                    `[ContextManager] Token 阈值触发压缩: ${estimatedTokens}/${ctxConfig.maxTokens} (阈值 ${ctxConfig.compressionThreshold})`
                )
            }
        }

        if (!needsCompression && ctxConfig.maxMessages > 0) {
            const nonSystemMessages = messages.filter(m => m.role !== 'system')
            if (nonSystemMessages.length > ctxConfig.maxMessages) {
                needsCompression = true
                logger.debug(
                    `[ContextManager] 消息数阈值触发压缩: ${nonSystemMessages.length}/${ctxConfig.maxMessages}`
                )
            }
        }

        if (!needsCompression) {
            return { messages, compressed, skillsReinjected }
        }

        const compressedMessages = await this.compressMessages(conversationId, messages, options)
        compressed = true

        const finalMessages = this.reinjectSkills(compressedMessages, options)
        skillsReinjected = finalMessages !== compressedMessages

        return { messages: finalMessages, compressed, skillsReinjected }
    }

    /**
     * 执行对话压缩
     * @param {string} conversationId
     * @param {Array} messages
     * @param {Object} options
     * @returns {Promise<Array>}
     */
    async compressMessages(conversationId, messages, options = {}) {
        const ctxConfig = this.getContextConfig(options)
        const strategy = ctxConfig.compressionStrategy

        switch (strategy) {
            case 'summarize':
                return this._compressBySummarize(messages, ctxConfig, options)
            case 'truncate':
                return this._compressByTruncate(messages, ctxConfig)
            case 'sliding-window':
                return this._compressBySlidingWindow(messages, ctxConfig)
            default:
                return this._compressBySummarize(messages, ctxConfig, options)
        }
    }

    /**
     * 总结策略压缩
     * @private
     */
    async _compressBySummarize(messages, ctxConfig, options = {}) {
        const preserveCount = ctxConfig.preserveRecentMessages
        const systemMessages = messages.filter(m => m.role === 'system')
        const nonSystemMessages = messages.filter(m => m.role !== 'system')

        if (nonSystemMessages.length <= preserveCount + 2) {
            return messages
        }

        const toSummarize = nonSystemMessages.slice(0, -preserveCount)
        const toKeep = nonSystemMessages.slice(-preserveCount)

        const dialogText = toSummarize
            .map(msg => {
                const roleLabel = msg.role === 'assistant' ? '助手' : '用户'
                const text = Array.isArray(msg.content)
                    ? msg.content
                          .filter(c => c.type === 'text')
                          .map(c => c.text || '')
                          .join('')
                    : typeof msg.content === 'string'
                      ? msg.content
                      : ''
                return `${roleLabel}: ${text}`.trim()
            })
            .filter(Boolean)
            .join('\n')

        if (!dialogText || dialogText.length < 50) {
            return this._compressByTruncate(messages, ctxConfig)
        }

        try {
            const model = options.model || config.get('llm.defaultModel')
            const prompt = buildSummaryPrompt(dialogText.slice(0, 8000), 200)

            const { LlmService } = await import('./LlmService.js')
            const groupIdMatch = options.conversationId?.match?.(/^group:(\d+)/)
            const client = await LlmService.getChatClient({
                model,
                groupId: groupIdMatch?.[1] || undefined
            })
            const _temp2 = resolveClientTemperature(client, 0.2)
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                {
                    model,
                    maxToken: 300,
                    ...(_temp2 !== undefined ? { temperature: _temp2 } : {}),
                    disableHistorySave: true
                }
            )
            const summaryText = result.contents?.[0]?.text?.trim()

            if (summaryText) {
                const summaryMsg = {
                    role: 'assistant',
                    content: [{ type: 'text', text: `【对话摘要】\n${summaryText}` }],
                    timestamp: Date.now(),
                    metadata: { compressed: true }
                }
                const result = [...systemMessages, summaryMsg, ...toKeep]
                logger.debug(`[ContextManager] 总结压缩完成: ${messages.length} -> ${result.length} 条`)
                return result
            }
        } catch (err) {
            logger.debug('[ContextManager] 总结压缩失败，回退到截断策略:', err.message)
        }

        return this._compressByTruncate(messages, ctxConfig)
    }

    /**
     * 截断策略压缩
     * @private
     */
    _compressByTruncate(messages, ctxConfig) {
        const preserveCount = ctxConfig.preserveRecentMessages
        const systemMessages = ctxConfig.preserveSystemPrompt ? messages.filter(m => m.role === 'system') : []
        const nonSystemMessages = messages.filter(m => m.role !== 'system')
        const kept = nonSystemMessages.slice(-preserveCount)
        const result = [...systemMessages, ...kept]
        logger.debug(`[ContextManager] 截断压缩完成: ${messages.length} -> ${result.length} 条`)
        return result
    }

    /**
     * 滑动窗口策略压缩
     * @private
     */
    _compressBySlidingWindow(messages, ctxConfig) {
        const maxMessages = ctxConfig.maxMessages || this.maxContextMessages
        const systemMessages = ctxConfig.preserveSystemPrompt ? messages.filter(m => m.role === 'system') : []
        const nonSystemMessages = messages.filter(m => m.role !== 'system')
        const windowSize = Math.max(maxMessages - systemMessages.length, 4)
        const kept = nonSystemMessages.slice(-windowSize)
        const result = [...systemMessages, ...kept]
        logger.debug(`[ContextManager] 滑动窗口压缩完成: ${messages.length} -> ${result.length} 条`)
        return result
    }

    /**
     * 压缩后重新注入 skills 到上下文
     * @param {Array} messages - 压缩后的消息列表
     * @param {Object} options - 包含 loadedSkills, contextText 等
     * @returns {Array}
     */
    reinjectSkills(messages, options = {}) {
        const ctxConfig = this.getContextConfig(options)
        if (!ctxConfig.autoReloadSkills) return messages

        const skillsLoader = global.chatAiSkillsLoader
        if (!skillsLoader?.initialized) return messages

        const instructions = skillsLoader.getSkillDocumentInstructions({
            contextText: options.contextText || '',
            selectedNames: options.loadedSkills || null,
            mode: options.loadedSkills ? undefined : 'all'
        })

        if (!instructions) return messages

        const systemIndex = messages.findIndex(m => m.role === 'system')
        if (systemIndex >= 0) {
            const systemMsg = messages[systemIndex]
            const content =
                typeof systemMsg.content === 'string'
                    ? systemMsg.content
                    : Array.isArray(systemMsg.content)
                      ? systemMsg.content
                            .filter(c => c.type === 'text')
                            .map(c => c.text || '')
                            .join('')
                      : ''

            if (!content.includes('【Agent Skills】')) {
                const updatedMessages = [...messages]
                updatedMessages[systemIndex] = {
                    ...systemMsg,
                    content:
                        typeof systemMsg.content === 'string'
                            ? systemMsg.content + '\n\n' + instructions
                            : [
                                  ...(Array.isArray(systemMsg.content) ? systemMsg.content : []),
                                  { type: 'text', text: '\n\n' + instructions }
                              ]
                }
                logger.debug('[ContextManager] Skills 已重新注入到压缩后的上下文')
                return updatedMessages
            }
        }

        return messages
    }
}

export const contextManager = new ContextManager()
