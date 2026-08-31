import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'
import { STOP_WORDS } from '../../utils/common.js'
import { renderService } from '../media/RenderService.js'
import { ensureScopeManager } from '../scope/ScopeManager.js'
import { GroupSummaryCore } from './GroupSummaryCore.js'
import { StandardBotApi, StandardMessage } from '../../core/platform/index.js'

const logger = chatLogger

/**
 * 群聊总结定时推送服务
 *
 * 每分钟检查一次，根据全局 features.groupSummary.push 和
 * 各群组 summaryPush* 配置决定是否发送总结。
 *
 * 调度策略：
 *  - intervalType === 'day'  → 每天 pushHour 时触发
 *  - intervalType === 'hour' → 每 intervalValue 小时触发
 */
class GroupSummaryPushService {
    constructor() {
        this._timer = null
        this._running = false
        /** groupId → lastPushTimestamp */
        this._lastPush = new Map()
        this._checkIntervalMs = 60_000
    }

    async init() {
        if (this._timer) return
        logger.info('[GroupSummaryPush] 定时推送服务启动')
        this._timer = setInterval(() => this._tick(), this._checkIntervalMs)
        // 启动后延迟 30 秒做第一次检查，避免阻塞启动流程
        setTimeout(() => this._tick(), 30_000)
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer)
            this._timer = null
        }
        logger.info('[GroupSummaryPush] 定时推送服务已停止')
    }

    reload() {
        this.stop()
        this._lastPush.clear()
        this.init()
    }

    // ─── 内部 ───────────────────────────────────

    async _tick() {
        if (this._running) return
        this._running = true
        try {
            await this._checkAndPush()
        } catch (err) {
            logger.error('[GroupSummaryPush] 检查任务异常:', err.message)
        } finally {
            this._running = false
        }
    }

    async _checkAndPush() {
        const globalPush = config.get('features.groupSummary.push') || {}
        const globalSummaryEnabled = config.get('features.groupSummary.enabled')

        // 收集所有需要推送的群
        const tasks = await this._collectPushTasks(globalPush, globalSummaryEnabled)

        for (const task of tasks) {
            try {
                await this._executePush(task)
            } catch (err) {
                logger.error(`[GroupSummaryPush] 群 ${task.groupId} 推送失败:`, err.message)
            }
            // 群间间隔 3 秒，避免速率限制
            await new Promise(r => setTimeout(r, 3000))
        }
    }

    /**
     * 收集当前时刻需要推送的所有群任务
     */
    async _collectPushTasks(globalPush, globalSummaryEnabled) {
        const tasks = []
        const now = new Date()
        const currentHour = now.getHours()
        const currentMinute = now.getMinutes()

        let sm
        try {
            sm = await ensureScopeManager()
        } catch {
            return tasks
        }

        // 遍历所有有配置的群组
        const allGroups = await sm.listGroupSettings()

        for (const group of allGroups) {
            const settings = group.settings || {}
            const groupId = group.groupId

            // 判断该群的总结功能是否启用
            const summaryEnabled =
                settings.summaryEnabled !== undefined ? settings.summaryEnabled : globalSummaryEnabled
            if (!summaryEnabled) continue

            // 判断该群的推送是否启用（群级 > 全局）
            const pushEnabled =
                settings.summaryPushEnabled !== undefined ? settings.summaryPushEnabled : globalPush.enabled
            if (!pushEnabled) continue

            const intervalType = settings.summaryPushIntervalType || globalPush.intervalType || 'day'
            const intervalValue = settings.summaryPushIntervalValue || globalPush.intervalValue || 1
            const pushHour = settings.summaryPushHour ?? globalPush.pushHour ?? 20
            const messageCount = settings.summaryPushMessageCount || globalPush.messageCount || 100
            const model = settings.summaryModel || globalPush.model || config.get('features.groupSummary.model') || ''

            if (!this._shouldPushNow(groupId, intervalType, intervalValue, pushHour, currentHour, currentMinute)) {
                continue
            }

            tasks.push({ groupId, messageCount, model, intervalType, intervalValue, pushHour })
        }

        // 处理只有全局配置但没有群级配置的情况：
        // 如果全局推送已启用，也需要推送到所有启用了总结功能但没有独立配置的群
        if (globalPush.enabled && globalSummaryEnabled) {
            const configuredGroupIds = new Set(allGroups.map(g => g.groupId))
            const botGroups = this._getAllBotGroups()

            for (const groupId of botGroups) {
                if (configuredGroupIds.has(String(groupId))) continue

                const intervalType = globalPush.intervalType || 'day'
                const intervalValue = globalPush.intervalValue || 1
                const pushHour = globalPush.pushHour ?? 20
                const messageCount = globalPush.messageCount || 100
                const model = globalPush.model || config.get('features.groupSummary.model') || ''

                if (
                    !this._shouldPushNow(
                        String(groupId),
                        intervalType,
                        intervalValue,
                        pushHour,
                        currentHour,
                        currentMinute
                    )
                ) {
                    continue
                }

                tasks.push({
                    groupId: String(groupId),
                    messageCount,
                    model,
                    intervalType,
                    intervalValue,
                    pushHour
                })
            }
        }

        return tasks
    }

    /**
     * 判断当前时刻是否应该对该群推送
     */
    _shouldPushNow(groupId, intervalType, intervalValue, pushHour, currentHour, currentMinute) {
        // 只在每小时的前几分钟触发，避免重复
        if (currentMinute >= 2) return false

        const lastPush = this._lastPush.get(groupId) || 0
        const now = Date.now()

        if (intervalType === 'day') {
            if (currentHour !== pushHour) return false
            // 同一天只推一次
            const lastDate = new Date(lastPush).toDateString()
            const todayDate = new Date(now).toDateString()
            if (lastDate === todayDate) return false
            // 多天间隔
            if (intervalValue > 1 && lastPush > 0) {
                const daysSinceLast = (now - lastPush) / 86400_000
                if (daysSinceLast < intervalValue - 0.5) return false
            }
            return true
        }

        if (intervalType === 'hour') {
            const intervalMs = intervalValue * 3600_000
            if (now - lastPush < intervalMs - 120_000) return false
            return true
        }

        return false
    }

    /**
     * 执行单个群的推送
     */
    async _executePush(task) {
        const { groupId, messageCount, model } = task
        logger.info(`[GroupSummaryPush] 开始推送群 ${groupId} 的总结`)

        const bot = this._getBot()
        if (!bot) {
            logger.warn('[GroupSummaryPush] 未找到可用的 Bot 实例，跳过推送')
            return
        }

        const { messages, dataSource } = await GroupSummaryCore.collectMessages(groupId, messageCount, bot)

        if (messages.length < 5) {
            logger.debug(`[GroupSummaryPush] 群 ${groupId} 消息不足 (${messages.length})，跳过`)
            this._lastPush.set(groupId, Date.now())
            return
        }

        const { summaryText, model: actualModel } = await GroupSummaryCore.generateSummary(
            groupId,
            messages.slice(-messageCount),
            { model: model || undefined }
        )

        if (!summaryText) {
            logger.warn(`[GroupSummaryPush] 群 ${groupId} 总结生成为空`)
            return
        }

        const shortModel = actualModel.split('/').pop()
        const globalPush = config.get('features.groupSummary.push') || {}
        const useModernStyle = globalPush.modernStyle === true
        const recentMessages = messages.slice(-messageCount)

        let renderOptions
        try {
            renderOptions = this._buildSummaryRenderOptions(recentMessages, {
                dataSource,
                shortModel,
                useModernStyle,
                totalMessageCount: messages.length
            })
        } catch (buildErr) {
            logger.warn(`[GroupSummaryPush] 群 ${groupId} 构建渲染参数失败:`, buildErr.message)
            renderOptions = {
                title: useModernStyle ? '今日群聊' : '群聊内容总结',
                subtitle: `${shortModel} · ${dataSource} · 定时推送`,
                messageCount: messages.length,
                participantCount: new Set(recentMessages.map(m => m.nickname || m.userId || '用户')).size,
                topUsers: [],
                hourlyActivity: Array(24).fill(0)
            }
        }

        try {
            const imageBuffer = useModernStyle
                ? await renderService.renderGroupSummaryModern(summaryText, renderOptions)
                : await renderService.renderGroupSummary(summaryText, renderOptions)
            await this._sendImageToGroup(bot, groupId, imageBuffer)
        } catch (renderErr) {
            logger.warn(`[GroupSummaryPush] 群 ${groupId} 渲染/发送图片失败:`, renderErr.message)
            const titleEmoji = useModernStyle ? '✨' : '📊'
            const fullText = `${titleEmoji} 定时${useModernStyle ? '今日群聊' : '群聊总结'} (${messages.length}条消息 · ${shortModel})\n\n${summaryText}`
            await this._sendToGroup(bot, groupId, fullText)
        }

        this._lastPush.set(groupId, Date.now())
        logger.info(`[GroupSummaryPush] 群 ${groupId} 推送完成 (来源: ${dataSource})`)
    }

    /**
     * 构建与 #群聊总结 一致的渲染参数（供 RenderService）
     * @param {Array} recentMessages
     * @param {{ dataSource: string, shortModel: string, useModernStyle: boolean, totalMessageCount: number }} meta
     */
    _buildSummaryRenderOptions(recentMessages, meta) {
        const { dataSource, shortModel, useModernStyle, totalMessageCount } = meta
        const participants = new Set(recentMessages.map(m => m.nickname || m.userId || '用户'))

        const userStats = {}
        const hourlyActivity = Array(24).fill(0)

        for (const msg of recentMessages) {
            const name = msg.nickname || msg.userId || '用户'
            const odId = msg.userId || null
            if (!userStats[name]) {
                userStats[name] = { name, odId, count: 0, lastMsg: '' }
            }
            userStats[name].count++
            const plain =
                typeof msg.content === 'string'
                    ? msg.content
                    : Array.isArray(msg.content)
                      ? msg.content
                            .filter(c => c.type === 'text')
                            .map(c => c.text)
                            .join('')
                      : String(msg.content || '')
            if (plain) {
                userStats[name].lastMsg = plain.substring(0, 30)
            }
            if (msg.timestamp) {
                const hour = new Date(msg.timestamp).getHours()
                hourlyActivity[hour]++
            }
        }

        const topUsers = Object.values(userStats)
            .sort((a, b) => b.count - a.count)
            .slice(0, useModernStyle ? 8 : 5)
            .map(u => ({
                name: u.name,
                count: u.count,
                odId: u.odId,
                avatar: u.odId ? `https://q1.qlogo.cn/g?b=qq&nk=${u.odId}&s=0` : null
            }))

        let keywords = []
        let interactions = []
        let atmosphere = {}
        let quotes = []

        if (useModernStyle) {
            const wordCounts = {}
            for (const msg of recentMessages) {
                const content = typeof msg.content === 'string' ? msg.content : ''
                const words = content.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g) || []
                for (const word of words) {
                    if (!STOP_WORDS.has(word) && word.length >= 2) {
                        wordCounts[word] = (wordCounts[word] || 0) + 1
                    }
                }
            }
            keywords = Object.entries(wordCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 12)
                .map(([word, count]) => ({ word, count }))

            const interactionMap = {}
            for (const msg of recentMessages) {
                const content = typeof msg.content === 'string' ? msg.content : ''
                const from = msg.nickname || '用户'
                const atMatches = content.match(/@([^\s@]+)/g) || []
                for (const at of atMatches) {
                    const to = at.replace('@', '')
                    if (to && to !== from && to !== '全体成员') {
                        const key = `${from}->${to}`
                        if (!interactionMap[key]) {
                            interactionMap[key] = { from, to, count: 0 }
                        }
                        interactionMap[key].count++
                    }
                }
            }
            interactions = Object.values(interactionMap)
                .sort((a, b) => b.count - a.count)
                .slice(0, 3)

            const totalMsgs = recentMessages.length
            const emojiCount = recentMessages.filter(m =>
                /[\u{1F300}-\u{1F9FF}]|[😀-🙏]/u.test(typeof m.content === 'string' ? m.content : '')
            ).length
            atmosphere = {
                positivity: Math.min(
                    95,
                    Math.round(50 + (emojiCount / Math.max(totalMsgs, 1)) * 100 + Math.random() * 20)
                ),
                activity: Math.min(95, Math.round(30 + Math.min(totalMsgs / 3, 50) + Math.random() * 15)),
                interaction: Math.min(
                    95,
                    Math.round(
                        20 + interactions.length * 15 + Object.keys(interactionMap).length * 5 + Math.random() * 10
                    )
                )
            }

            quotes = recentMessages
                .filter(m => {
                    const content = typeof m.content === 'string' ? m.content : ''
                    return (
                        content.length >= 15 && content.length <= 100 && !content.startsWith('[') && !/^@/.test(content)
                    )
                })
                .sort(() => Math.random() - 0.5)
                .slice(0, 3)
                .map(m => ({
                    content: (typeof m.content === 'string' ? m.content : '').substring(0, 80),
                    author: m.nickname || '群友'
                }))
        }

        return {
            title: useModernStyle ? '今日群聊' : '群聊内容总结',
            subtitle: `${shortModel} · ${dataSource} · 定时推送`,
            messageCount: totalMessageCount ?? recentMessages.length,
            participantCount: participants.size,
            topUsers,
            hourlyActivity,
            ...(useModernStyle ? { keywords, interactions, atmosphere, quotes } : {})
        }
    }

    /**
     * 发送消息到群
     */
    async _sendToGroup(bot, groupId, text) {
        try {
            return await new StandardBotApi({ bot }).sendGroup(groupId, text)
        } catch (err) {
            logger.error(`[GroupSummaryPush] 发送消息到群 ${groupId} 失败:`, err.message)
            throw err
        }
    }

    /**
     * 发送图片总结到群（与命令行总结一致，优先 pickGroup.sendMsg）
     */
    async _sendImageToGroup(bot, groupId, imageBuffer) {
        try {
            return await new StandardBotApi({ bot }).sendGroup(groupId, StandardMessage.image(imageBuffer))
        } catch (err) {
            logger.error(`[GroupSummaryPush] 发送图片到群 ${groupId} 失败:`, err.message)
            throw err
        }
    }

    /**
     * 获取 Bot 实例
     */
    _getBot() {
        const botRegistry = globalThis.Bot
        if (botRegistry) {
            // Yunzai v3 多 Bot 支持
            if (botRegistry.uin) return botRegistry
            // TRSS 多 Bot
            if (botRegistry.lain?.bots) {
                const bots = Object.values(botRegistry.lain.bots)
                if (bots.length > 0) return bots[0]
            }
            // Bot.adapter
            if (botRegistry.adapter) {
                for (const [, b] of botRegistry.adapter) {
                    if (b) return b
                }
            }
            return botRegistry
        }
        return null
    }

    /**
     * 获取 Bot 加入的所有群列表
     */
    _getAllBotGroups() {
        const groups = []
        try {
            const bot = this._getBot()
            if (!bot) return groups
            if (bot.gl && typeof bot.gl[Symbol.iterator] === 'function') {
                for (const [gid] of bot.gl) {
                    groups.push(String(gid))
                }
            } else if (typeof bot.getGroupList === 'function') {
                const list = bot.getGroupList()
                if (Array.isArray(list)) {
                    for (const g of list) {
                        groups.push(String(g.group_id || g.id))
                    }
                }
            }
        } catch (err) {
            logger.debug('[GroupSummaryPush] 获取群列表失败:', err.message)
        }
        return groups
    }
}

export const groupSummaryPushService = new GroupSummaryPushService()
