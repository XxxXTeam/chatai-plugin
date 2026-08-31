/**
 * @fileoverview 会话追踪服务
 * @module services/llm/ConversationTracker
 * @description 智能追踪用户是否在继续与机器人对话，支持AI判断和批量处理
 */

import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'
import { LlmService } from './LlmService.js'
import { channelManager } from './ChannelManager.js'
import { resolveTemperature } from './TemperatureResolver.js'

const logger = chatLogger

/** @type {Map<string, {lastActiveTime: number, chatHistory: Array, timer: NodeJS.Timeout|null}>} */
const activeConversations = new Map()

/** @type {Map<string, number>} 节流控制 */
const trackingThrottle = new Map()

/** @type {Array<{conversationKey: string, userMessage: string, chatHistory: Array, e: Object, resolve: Function}>} */
const pendingJudgments = []

/** @type {NodeJS.Timeout|null} */
let batchTimer = null

/**
 * 会话追踪服务
 * 用于智能判断用户是否在继续与机器人对话
 */
class ConversationTrackerService {
    constructor() {
        this.enabled = false
        this.timeout = 2 * 60000 // 默认2分钟超时
        this.throttleInterval = 3000 // 默认3秒节流
        this.batchDelay = 3000 // 批量判断延迟
    }

    /**
     * 初始化配置
     */
    init() {
        const trackingConfig = config.get('conversationTracking') || {}
        this.enabled = trackingConfig.enabled !== false
        this.timeout = (trackingConfig.timeout || 2) * 60000
        this.throttleInterval = (trackingConfig.throttle || 3) * 1000
        this.batchDelay = (trackingConfig.batchDelay || 3) * 1000
        logger.debug(`[ConversationTracker] 初始化: enabled=${this.enabled}, timeout=${this.timeout}ms`)
    }

    /**
     * 检查是否启用会话追踪
     */
    isEnabled() {
        return this.enabled
    }

    /**
     * 获取活跃会话
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     * @returns {Object|null} 会话信息
     */
    getActiveConversation(groupId, userId) {
        const key = `${groupId}_${userId}`
        return activeConversations.get(key) || null
    }

    /**
     * 检查用户是否在追踪期内
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     * @returns {boolean}
     */
    isTracking(groupId, userId) {
        const key = `${groupId}_${userId}`
        return activeConversations.has(key)
    }

    /**
     * 开始或更新会话追踪
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     * @param {Object} data - 更新数据
     */
    startTracking(groupId, userId, data = {}) {
        const key = `${groupId}_${userId}`
        const existing = activeConversations.get(key)

        // 清除旧定时器
        if (existing?.timer) {
            clearTimeout(existing.timer)
        }

        // 创建新定时器
        const timer = setTimeout(() => {
            const conv = activeConversations.get(key)
            if (conv?.timer === timer) {
                activeConversations.delete(key)
                trackingThrottle.delete(key)
                logger.debug(`[ConversationTracker] ${key} 超时，已清除`)
            }
        }, this.timeout)

        // 更新会话
        activeConversations.set(key, {
            lastActiveTime: Date.now(),
            chatHistory: existing?.chatHistory || [],
            ...data,
            timer
        })

        logger.debug(`[ConversationTracker] 开始追踪: ${key}`)
    }

    /**
     * 停止会话追踪
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     */
    stopTracking(groupId, userId) {
        const key = `${groupId}_${userId}`
        const existing = activeConversations.get(key)
        if (existing?.timer) {
            clearTimeout(existing.timer)
        }
        activeConversations.delete(key)
        trackingThrottle.delete(key)
        logger.debug(`[ConversationTracker] 停止追踪: ${key}`)
    }

    /**
     * 更新对话历史
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     * @param {string} role - 角色 ('user' | 'bot')
     * @param {string} content - 消息内容
     */
    addToHistory(groupId, userId, role, content) {
        const key = `${groupId}_${userId}`
        const conv = activeConversations.get(key)
        if (!conv) return

        const chatHistory = conv.chatHistory || []
        chatHistory.push({ role, content: content.substring(0, 200) })

        // 只保留最近10条
        if (chatHistory.length > 10) {
            chatHistory.splice(0, chatHistory.length - 10)
        }

        conv.chatHistory = chatHistory
    }

    /**
     * 检查节流
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     * @returns {boolean} 是否在节流期内
     */
    isThrottled(groupId, userId) {
        const key = `${groupId}_${userId}`
        const lastCallTime = trackingThrottle.get(key) || 0
        return Date.now() - lastCallTime < this.throttleInterval
    }

    /**
     * 更新节流时间
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     */
    updateThrottle(groupId, userId) {
        const key = `${groupId}_${userId}`
        trackingThrottle.set(key, Date.now())
    }

    /**
     * AI判断用户是否在继续跟机器人对话
     * @param {string} userMessage - 用户消息
     * @param {Array} chatHistory - 对话历史
     * @returns {Promise<boolean>}
     */
    async isUserTalkingToBot(userMessage, chatHistory = []) {
        try {
            const botName = config.get('bot.nickname') || globalThis.Bot?.nickname || '机器人'
            const botId = globalThis.Bot?.uin || ''

            // 构建对话历史文本
            const historyText =
                chatHistory.length > 0
                    ? chatHistory.map(h => `[${h.role === 'bot' ? '机器人' : '用户'}] ${h.content}`).join('\n')
                    : '(无历史记录)'

            // 获取判断用的模型配置
            const trackingModel =
                config.get('conversationTracking.model') || config.get('llm.models.dispatch') || LlmService.getModel()

            await channelManager.init()
            const channel = channelManager.getBestChannel(trackingModel)
            if (!channel) {
                logger.warn('[ConversationTracker] 未找到可用渠道')
                return false
            }

            const client = await LlmService.createClient({
                enableTools: false,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key,
                imageConfig: channel.imageConfig || {}
            })

            const messages = [
                {
                    role: 'system',
                    content: `你是QQ群聊对话判断助手。机器人名字叫"${botName}"，QQ号${botId}。

这条新消息来自一个刚刚和机器人聊过天的用户。判断他这次是不是还在跟机器人说话。
对话记录中，[机器人] 开头的是机器人的发言，[用户] 开头的是这位用户自己的发言。

【true的情况】
- 提到了"${botName}"或 @ 了 ${botId}
- 话题自然延续（机器人说"中午好"→用户问"中午吃什么"）
- 回应机器人刚说的内容，包括只回一个"嗯""好""为什么"
- 一般闲聊、提问，没有指向别人

【false的情况】
- @了其他人，或明确叫了别人的名字在对话
- 话题与机器人刚说的完全无关，且明显是在接别人的话

判断依据不足时按 true 处理。
只回复 true 或 false 这一个单词，不要加标点、解释或任何其他内容。`
                },
                {
                    role: 'user',
                    content: `【近期对话记录】\n${historyText}\n\n【用户新消息】\n${userMessage}\n\n这条新消息是在跟机器人说话吗？`
                }
            ]
            const { temperature: _trackTemp } = resolveTemperature({
                actualModel: trackingModel,
                requestOptions: { temperature: 0.1 },
                preset: null,
                channel: { advanced: { llm: channel.advanced?.llm || {} }, overrides: channel.overrides || {} }
            })
            const response = await client.sendMessageWithHistory(messages, {
                model: trackingModel,
                maxToken: 10,
                ...(_trackTemp !== undefined ? { temperature: _trackTemp } : {})
            })

            const answer = (response?.content?.find(c => c.type === 'text')?.text || '').toLowerCase().trim()
            return answer === 'true' || answer?.includes('true')
        } catch (error) {
            logger.error('[ConversationTracker] AI判断失败:', error.message)
            return false
        }
    }

    /**
     * 加入批量判断队列
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     * @param {string} userMessage - 用户消息
     * @param {Array} chatHistory - 对话历史
     * @param {Object} e - 事件对象
     * @returns {Promise<boolean>}
     */
    addToBatchJudgment(groupId, userId, userMessage, chatHistory, e) {
        const conversationKey = `${groupId}_${userId}`
        return new Promise(resolve => {
            pendingJudgments.push({ conversationKey, userMessage, chatHistory, e, resolve })

            if (!batchTimer) {
                batchTimer = setTimeout(() => this.processBatchJudgments(), this.batchDelay)
            }
        })
    }

    /**
     * 处理批量判断队列
     */
    async processBatchJudgments() {
        batchTimer = null
        if (pendingJudgments.length === 0) return

        const batch = pendingJudgments.splice(0)

        if (batch.length === 1) {
            const result = await this.isUserTalkingToBot(batch[0].userMessage, batch[0].chatHistory)
            batch[0].resolve(result)
            return
        }

        try {
            const results = await this.batchIsUserTalkingToBot(batch)
            batch.forEach((item, i) => item.resolve(results[i] || false))
        } catch (error) {
            logger.error('[ConversationTracker] 批量判断失败:', error.message)
            batch.forEach(item => item.resolve(false))
        }
    }

    /**
     * 批量判断多条消息
     * @param {Array} batch - 待判断消息数组
     * @returns {Promise<boolean[]>}
     */
    async batchIsUserTalkingToBot(batch) {
        try {
            const botName = config.get('bot.nickname') || globalThis.Bot?.nickname || '机器人'

            const batchWithIds = batch.map((item, i) => ({
                ...item,
                id: `MSG_${i + 1}_${item.e?.user_id || 'unknown'}`
            }))

            const messagesText = batchWithIds
                .map(item => {
                    const recentHistory = (item.chatHistory || [])
                        .slice(-3)
                        .map(h => `[${h.role === 'bot' ? '机器人' : '用户'}] ${h.content}`)
                        .join('\n')
                    const userName = item.e?.sender?.card || item.e?.sender?.nickname || '未知用户'
                    return `【${item.id}】用户: ${userName}(QQ:${item.e?.user_id})
对话历史:
${recentHistory || '(无)'}
新消息: ${item.userMessage}
---`
                })
                .join('\n\n')

            const trackingModel =
                config.get('conversationTracking.model') || config.get('llm.models.dispatch') || LlmService.getModel()

            await channelManager.init()
            const channel = channelManager.getBestChannel(trackingModel)
            if (!channel) {
                return this.fallbackToSingleJudgment(batch)
            }

            const client = await LlmService.createClient({
                enableTools: false,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key,
                imageConfig: channel.imageConfig || {}
            })

            const batchMessages = [
                {
                    role: 'system',
                    content: `你是QQ群聊对话判断助手。机器人名字叫"${botName}"。

下面每条待判断消息都来自不同用户，各自带有独立的对话历史，请逐条独立判断，不要让一条的结论影响另一条。
对话历史中，[机器人] 开头的是机器人的发言，[用户] 开头的是该用户自己的发言。
- true: 该用户在跟机器人说话（提到机器人名字、话题延续、回应机器人刚说的内容、没有指向别人的一般闲聊提问）
- false: 该用户在跟其他人说话（@了别人、明确叫了别人的名字、话题与机器人无关且明显是在接别人的话）

判断依据不足时按 true 处理。

返回一个 JSON 对象，key 为每条消息的 ID（形如 MSG_序号_QQ号），value 为 true 或 false。
必须为下面列出的每一个 ID 都给出结果，一个都不能漏，也不要自造列表之外的 ID。
示例: {"MSG_1_12345": true, "MSG_2_67890": false}
只返回这个 JSON 对象，不要用代码块包裹，不要写任何解释。`
                },
                {
                    role: 'user',
                    content: `分别判断以下${batchWithIds.length}条来自不同用户的消息:\n\n${messagesText}\n\n返回JSON对象:`
                }
            ]
            const { temperature: _batchTemp } = resolveTemperature({
                actualModel: trackingModel,
                requestOptions: { temperature: 0.1 },
                preset: null,
                channel: { advanced: { llm: channel.advanced?.llm || {} }, overrides: channel.overrides || {} }
            })
            const response = await client.sendMessageWithHistory(batchMessages, {
                model: trackingModel,
                maxToken: 200,
                ...(_batchTemp !== undefined ? { temperature: _batchTemp } : {})
            })

            let content = (response?.content?.find(c => c.type === 'text')?.text || '').trim() || '{}'
            const jsonMatch = content.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                content = jsonMatch[0]
            }

            const resultsMap = JSON.parse(content)
            logger.info(`[ConversationTracker] 批量判断 ${batch.length}条: ${JSON.stringify(resultsMap)}`)

            const results = batchWithIds.map(item => {
                const result = resultsMap[item.id]
                if (result === undefined) {
                    return null
                }
                return result === true || result === 'true'
            })

            const needsFallback = results.some(r => r === null)
            if (needsFallback) {
                return this.fallbackToSingleJudgment(batch, results)
            }

            return results
        } catch (error) {
            logger.error('[ConversationTracker] 批量解析失败:', error.message)
            return this.fallbackToSingleJudgment(batch)
        }
    }

    /**
     * 回退到单条判断
     * @param {Array} batch - 批量数据
     * @param {Array} partialResults - 部分结果
     * @returns {Promise<boolean[]>}
     */
    async fallbackToSingleJudgment(batch, partialResults = []) {
        const results = []
        for (let i = 0; i < batch.length; i++) {
            if (partialResults[i] !== undefined && partialResults[i] !== null) {
                results.push(partialResults[i])
            } else {
                const result = await this.isUserTalkingToBot(batch[i].userMessage, batch[i].chatHistory)
                results.push(result)
            }
        }
        return results
    }

    /**
     * 清理所有追踪数据
     */
    clearAll() {
        for (const [key, conv] of activeConversations) {
            if (conv.timer) clearTimeout(conv.timer)
        }
        activeConversations.clear()
        trackingThrottle.clear()
        pendingJudgments.length = 0
        if (batchTimer) {
            clearTimeout(batchTimer)
            batchTimer = null
        }
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            activeConversations: activeConversations.size,
            throttledUsers: trackingThrottle.size,
            pendingJudgments: pendingJudgments.length
        }
    }
}

export const conversationTracker = new ConversationTrackerService()
export default conversationTracker
