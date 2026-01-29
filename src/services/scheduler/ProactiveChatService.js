import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'

const logger = chatLogger

class ProactiveChatService {
    constructor() {
        this.initialized = false
        // 主动聊天统计: groupId -> { lastTrigger, dailyCount, date, hourlyTriggers, lastActivity }
        this.stats = new Map()
        // 群组设置缓存: groupId -> { settings, timestamp }
        this.groupSettingsCache = new Map()
        this.GROUP_SETTINGS_CACHE_TTL = 60 * 1000 // 缓存1分钟
        // 群活跃度缓存: groupId -> { messageRate, lastUpdate, activityLevel }
        this.activityCache = new Map()
        this.ACTIVITY_CACHE_TTL = 30 * 1000 // 活跃度缓存30秒
        // 轮询定时器
        this.pollInterval = null
        // 懒加载的依赖
        this._scopeManager = null
        this._getRecentGroupMessages = null
        this._getGroupMessageCount = null
        this._getGroupRecentActivity = null
    }

    /**
     * 时段类型枚举
     */
    static TimePeriod = {
        LATE_NIGHT: 'late_night', // 深夜 (0:00-5:00)
        EARLY_MORNING: 'early_morning', // 清晨 (5:00-7:00)
        MORNING: 'morning', // 上午 (7:00-12:00)
        AFTERNOON: 'afternoon', // 下午 (12:00-18:00)
        EVENING: 'evening', // 傍晚 (18:00-21:00)
        NIGHT: 'night' // 晚上 (21:00-24:00)
    }

    /**
     * 活跃度级别枚举
     */
    static ActivityLevel = {
        DEAD: 'dead', // 死群 (无活跃)
        LOW: 'low', // 低活跃
        NORMAL: 'normal', // 正常
        ACTIVE: 'active', // 活跃
        HIGH_FREQ: 'high_freq' // 高频对话中
    }

    /**
     * 初始化服务
     */
    async init() {
        if (this.initialized) return

        this.initialized = true
        logger.debug('[ProactiveChatService] 主动聊天服务已初始化')
    }

    /**
     * 启动轮询
     */
    startPolling() {
        const config = this.getConfig()
        const intervalMs = (config.pollInterval ?? 5) * 60 * 1000

        if (this.pollInterval) {
            clearInterval(this.pollInterval)
        }

        this.pollInterval = setInterval(() => {
            this.poll().catch(err => {
                logger.warn('[ProactiveChatService] 轮询失败:', err.message)
            })
        }, intervalMs)

        logger.info(`[ProactiveChatService] 主动聊天轮询已启动，间隔: ${config.pollInterval ?? 5}分钟`)
    }

    /**
     * 停止轮询
     */
    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval)
            this.pollInterval = null
        }
        logger.info('[ProactiveChatService] 主动聊天轮询已停止')
    }

    /**
     * 获取全局配置
     */
    getConfig() {
        try {
            const cfg = global.chatgptPluginConfig
            if (cfg) {
                return cfg.get?.('proactiveChat') || {}
            }
        } catch (e) {}
        return {}
    }

    /**
     * 获取ScopeManager
     */
    async getScopeManager() {
        if (!this._scopeManager) {
            try {
                const { databaseService } = await import('../storage/DatabaseService.js')
                const { getScopeManager } = await import('../scope/ScopeManager.js')
                await databaseService.init()
                this._scopeManager = getScopeManager(databaseService)
                await this._scopeManager.init()
            } catch (e) {
                logger.debug('[ProactiveChatService] 加载ScopeManager失败:', e.message)
            }
        }
        return this._scopeManager
    }

    /**
     * 加载群消息相关函数（懒加载）
     */
    async loadGroupMessageFunctions() {
        if (!this._getRecentGroupMessages || !this._getGroupMessageCount || !this._getGroupRecentActivity) {
            try {
                const { getRecentGroupMessages, getGroupMessageCount, getGroupRecentActivity } =
                    await import('../../../apps/GroupEvents.js')
                this._getRecentGroupMessages = getRecentGroupMessages
                this._getGroupMessageCount = getGroupMessageCount
                this._getGroupRecentActivity = getGroupRecentActivity
            } catch (e) {
                logger.debug('[ProactiveChatService] 加载GroupEvents失败:', e.message)
            }
        }
        return {
            getRecentGroupMessages: this._getRecentGroupMessages,
            getGroupMessageCount: this._getGroupMessageCount,
            getGroupRecentActivity: this._getGroupRecentActivity
        }
    }

    /**
     * 获取群组主动聊天设置
     * @param {string} groupId
     * @returns {Promise<Object>} 群组设置
     */
    async getGroupSettings(groupId) {
        const now = Date.now()
        const cached = this.groupSettingsCache.get(groupId)
        if (cached && now - cached.timestamp < this.GROUP_SETTINGS_CACHE_TTL) {
            return cached.settings
        }

        try {
            const scopeManager = await this.getScopeManager()
            if (!scopeManager) return {}

            const groupSettings = await scopeManager.getGroupSettings(groupId)
            const settings = groupSettings?.settings || {}
            this.groupSettingsCache.set(groupId, { settings, timestamp: now })
            return settings
        } catch (e) {
            logger.debug(`[ProactiveChatService] 获取群${groupId}设置失败:`, e.message)
            return {}
        }
    }

    /**
     * 获取群组的合并配置
     * @param {string} groupId
     * @returns {Promise<Object>} 合并后的配置
     */
    async getMergedConfig(groupId) {
        const globalConfig = this.getConfig()
        const groupSettings = await this.getGroupSettings(groupId)

        return {
            // 全局配置作为默认值
            ...globalConfig,
            // 群组设置覆盖（仅当群组明确设置时）
            enabled:
                groupSettings.proactiveChatEnabled !== undefined
                    ? groupSettings.proactiveChatEnabled
                    : globalConfig.enabled,
            baseProbability:
                groupSettings.proactiveChatProbability !== undefined
                    ? groupSettings.proactiveChatProbability
                    : globalConfig.baseProbability,
            cooldownMinutes:
                groupSettings.proactiveChatCooldown !== undefined
                    ? groupSettings.proactiveChatCooldown
                    : globalConfig.cooldownMinutes,
            maxDailyMessages:
                groupSettings.proactiveChatMaxDaily !== undefined
                    ? groupSettings.proactiveChatMaxDaily
                    : globalConfig.maxDailyMessages
        }
    }

    /**
     * 获取当前时段
     * @returns {string} 时段类型
     */
    getCurrentTimePeriod() {
        const hour = new Date().getHours()
        if (hour >= 0 && hour < 5) return ProactiveChatService.TimePeriod.LATE_NIGHT
        if (hour >= 5 && hour < 7) return ProactiveChatService.TimePeriod.EARLY_MORNING
        if (hour >= 7 && hour < 12) return ProactiveChatService.TimePeriod.MORNING
        if (hour >= 12 && hour < 18) return ProactiveChatService.TimePeriod.AFTERNOON
        if (hour >= 18 && hour < 21) return ProactiveChatService.TimePeriod.EVENING
        return ProactiveChatService.TimePeriod.NIGHT
    }

    /**
     * 检查是否在静默时段（不应主动发言）
     * @returns {boolean}
     */
    isQuietHours() {
        const config = this.getConfig()
        const hour = new Date().getHours()

        // 自定义静默时段
        const quietStart = config.quietHoursStart ?? 0
        const quietEnd = config.quietHoursEnd ?? 6

        // 支持跨天的时段（如 23:00 - 6:00）
        if (quietStart > quietEnd) {
            return hour >= quietStart || hour < quietEnd
        }
        return hour >= quietStart && hour < quietEnd
    }

    /**
     * 检查是否在凌晨时段（兼容旧接口）
     * @returns {boolean}
     */
    isNightTime() {
        const period = this.getCurrentTimePeriod()
        return (
            period === ProactiveChatService.TimePeriod.LATE_NIGHT ||
            period === ProactiveChatService.TimePeriod.EARLY_MORNING
        )
    }

    /**
     * 获取当前时段的概率乘数
     * @returns {number}
     */
    getTimePeriodMultiplier() {
        const config = this.getConfig()
        const period = this.getCurrentTimePeriod()

        // 从配置获取各时段乘数，或使用默认值
        const multipliers = config.timePeriodMultipliers || {}
        const defaults = {
            [ProactiveChatService.TimePeriod.LATE_NIGHT]: 0.1, // 深夜大幅降低
            [ProactiveChatService.TimePeriod.EARLY_MORNING]: 0.3, // 清晨降低
            [ProactiveChatService.TimePeriod.MORNING]: 1.0, // 上午正常
            [ProactiveChatService.TimePeriod.AFTERNOON]: 1.2, // 下午略高
            [ProactiveChatService.TimePeriod.EVENING]: 1.5, // 傍晚最活跃
            [ProactiveChatService.TimePeriod.NIGHT]: 0.8 // 晚上略低
        }

        return multipliers[period] ?? defaults[period] ?? 1.0
    }

    /**
     * 分析群活跃度级别
     * @param {string} groupId
     * @returns {Promise<{level: string, messageRate: number, recentCount: number, lastActiveMinutes: number}>}
     */
    async analyzeActivityLevel(groupId) {
        const now = Date.now()
        const cached = this.activityCache.get(groupId)
        if (cached && now - cached.lastUpdate < this.ACTIVITY_CACHE_TTL) {
            return cached
        }

        const config = this.getConfig()
        let level = ProactiveChatService.ActivityLevel.NORMAL
        let messageRate = 0
        let recentCount = 0
        let lastActiveMinutes = 999

        try {
            const { getGroupRecentActivity, getGroupMessageCount } = await this.loadGroupMessageFunctions()

            if (getGroupRecentActivity) {
                // 短窗口检测高频对话（5分钟）
                const shortWindow = getGroupRecentActivity(groupId, {
                    windowMs: 5 * 60 * 1000,
                    maxMessages: 100
                })

                // 中窗口检测正常活跃（30分钟）
                const mediumWindow = getGroupRecentActivity(groupId, {
                    windowMs: 30 * 60 * 1000,
                    maxMessages: 200
                })

                // 长窗口检测整体活跃度（2小时）
                const longWindow = getGroupRecentActivity(groupId, {
                    windowMs: 2 * 60 * 60 * 1000,
                    maxMessages: 500
                })

                recentCount = mediumWindow.recentCount || 0
                lastActiveMinutes = mediumWindow.lastActiveAt
                    ? Math.floor((now - mediumWindow.lastActiveAt) / 60000)
                    : 999

                // 计算消息速率（条/分钟）
                if (mediumWindow.recentCount > 0) {
                    messageRate = mediumWindow.recentCount / 30
                }

                // 判断活跃度级别
                const highFreqThreshold = config.highFreqMessagesPerMinute ?? 2
                const activeThreshold = config.activeMessagesIn30Min ?? 15
                const lowThreshold = config.lowMessagesIn30Min ?? 3
                const deadThreshold = config.deadMinutesWithoutMessage ?? 120

                if (shortWindow.recentCount >= highFreqThreshold * 5) {
                    // 5分钟内消息数 >= 10条，高频对话中
                    level = ProactiveChatService.ActivityLevel.HIGH_FREQ
                } else if (lastActiveMinutes >= deadThreshold) {
                    // 超过2小时无活跃
                    level = ProactiveChatService.ActivityLevel.DEAD
                } else if (mediumWindow.recentCount >= activeThreshold) {
                    level = ProactiveChatService.ActivityLevel.ACTIVE
                } else if (mediumWindow.recentCount < lowThreshold) {
                    level = ProactiveChatService.ActivityLevel.LOW
                }
            }
        } catch (e) {
            logger.debug(`[ProactiveChatService] 分析群${groupId}活跃度失败:`, e.message)
        }

        const result = { level, messageRate, recentCount, lastActiveMinutes, lastUpdate: now }
        this.activityCache.set(groupId, result)
        return result
    }

    /**
     * 获取活跃度级别的概率乘数
     * @param {string} level
     * @returns {number}
     */
    getActivityMultiplier(level) {
        const config = this.getConfig()
        const multipliers = config.activityMultipliers || {}
        const defaults = {
            [ProactiveChatService.ActivityLevel.DEAD]: 0, // 死群不触发
            [ProactiveChatService.ActivityLevel.LOW]: 0.3, // 低活跃降低
            [ProactiveChatService.ActivityLevel.NORMAL]: 1.0, // 正常
            [ProactiveChatService.ActivityLevel.ACTIVE]: 1.5, // 活跃提高
            [ProactiveChatService.ActivityLevel.HIGH_FREQ]: 0.1 // 高频对话中大幅降低（避免打扰）
        }
        return multipliers[level] ?? defaults[level] ?? 1.0
    }

    /**
     * 检查是否为工作日
     * @returns {boolean}
     */
    isWeekday() {
        const day = new Date().getDay()
        return day >= 1 && day <= 5
    }

    /**
     * 获取星期几的概率乘数
     * @returns {number}
     */
    getWeekdayMultiplier() {
        const config = this.getConfig()
        if (!config.useWeekdayMultiplier) return 1.0

        const day = new Date().getDay()
        const multipliers = config.weekdayMultipliers || {}
        const defaults = {
            0: 1.3, // 周日
            1: 0.8, // 周一
            2: 0.9, // 周二
            3: 1.0, // 周三
            4: 1.0, // 周四
            5: 1.2, // 周五
            6: 1.4 // 周六
        }
        return multipliers[day] ?? defaults[day] ?? 1.0
    }

    /**
     * 计算主动聊天触发概率
     * @param {string} groupId
     * @returns {Promise<{probability: number, factors: Object}>} 概率值和影响因素
     */
    async calculateProbability(groupId) {
        const config = await this.getMergedConfig(groupId)
        let baseProbability = config.baseProbability ?? 0.05
        const factors = {
            base: baseProbability,
            timePeriod: 1,
            activity: 1,
            weekday: 1,
            consecutive: 1,
            final: 0
        }

        // 1. 时段乘数
        factors.timePeriod = this.getTimePeriodMultiplier()

        // 2. 活跃度乘数
        const activity = await this.analyzeActivityLevel(groupId)
        factors.activity = this.getActivityMultiplier(activity.level)
        factors.activityLevel = activity.level
        factors.messageRate = activity.messageRate

        // 3. 星期乘数
        factors.weekday = this.getWeekdayMultiplier()

        // 4. 连续触发惩罚（避免短时间内对同一群多次触发）
        const stats = this.stats.get(groupId)
        if (stats) {
            const hourlyTriggers = stats.hourlyTriggers || 0
            if (hourlyTriggers > 0) {
                // 每小时触发次数越多，概率越低
                factors.consecutive = Math.max(0.2, 1 - hourlyTriggers * 0.3)
            }
        }

        // 5. 根据场景调整
        let scenarioMultiplier = 1.0
        const scenario = this.detectScenario(activity, this.getCurrentTimePeriod())
        factors.scenario = scenario

        switch (scenario) {
            case 'active_discussion':
                // 活跃讨论中，降低介入概率
                scenarioMultiplier = 0.3
                break
            case 'quiet_period':
                // 安静时段，适当提高（活跃群）
                scenarioMultiplier = activity.level === ProactiveChatService.ActivityLevel.ACTIVE ? 1.2 : 0.5
                break
            case 'waking_up':
                // 刚醒来时段（清晨），友好问候
                scenarioMultiplier = 1.3
                break
            case 'peak_hours':
                // 高峰时段，正常概率
                scenarioMultiplier = 1.0
                break
            case 'dead_group':
                // 死群，不触发
                scenarioMultiplier = 0
                break
        }
        factors.scenarioMultiplier = scenarioMultiplier

        // 计算最终概率
        let probability =
            baseProbability *
            factors.timePeriod *
            factors.activity *
            factors.weekday *
            factors.consecutive *
            scenarioMultiplier

        // 限制最大概率
        const maxProbability = config.maxProbability ?? 0.5
        probability = Math.min(probability, maxProbability)
        probability = Math.max(probability, 0)

        factors.final = probability

        logger.debug(
            `[ProactiveChatService] 群${groupId} 概率计算: base=${(baseProbability * 100).toFixed(1)}%, ` +
                `time=${factors.timePeriod.toFixed(2)}, activity=${factors.activity.toFixed(2)}(${activity.level}), ` +
                `weekday=${factors.weekday.toFixed(2)}, scenario=${scenario}(${scenarioMultiplier.toFixed(2)}), ` +
                `final=${(probability * 100).toFixed(1)}%`
        )

        return { probability, factors }
    }

    /**
     * 检测当前场景
     * @param {Object} activity 活跃度信息
     * @param {string} timePeriod 时段
     * @returns {string} 场景类型
     */
    detectScenario(activity, timePeriod) {
        // 死群场景
        if (activity.level === ProactiveChatService.ActivityLevel.DEAD) {
            return 'dead_group'
        }

        // 高频讨论场景
        if (activity.level === ProactiveChatService.ActivityLevel.HIGH_FREQ) {
            return 'active_discussion'
        }

        // 清晨唤醒场景
        if (
            timePeriod === ProactiveChatService.TimePeriod.EARLY_MORNING &&
            activity.level !== ProactiveChatService.ActivityLevel.LOW
        ) {
            return 'waking_up'
        }

        // 深夜安静场景
        if (timePeriod === ProactiveChatService.TimePeriod.LATE_NIGHT) {
            return 'quiet_period'
        }

        // 高峰时段（傍晚活跃时间）
        if (
            timePeriod === ProactiveChatService.TimePeriod.EVENING &&
            activity.level === ProactiveChatService.ActivityLevel.ACTIVE
        ) {
            return 'peak_hours'
        }

        // 正常场景
        return 'normal'
    }

    /**
     * 检查群是否可以触发主动聊天
     * @param {string} groupId
     * @returns {Promise<{canTrigger: boolean, reason?: string}>}
     */
    async canTrigger(groupId) {
        const config = await this.getMergedConfig(groupId)
        const globalConfig = this.getConfig()

        // 检查是否启用
        if (!config.enabled) {
            logger.debug(
                `[ProactiveChatService] 群${groupId} 跳过: 未启用 (全局=${globalConfig.enabled}, 群组覆盖=${config.enabled})`
            )
            return { canTrigger: false, reason: 'disabled' }
        }

        // 检查静默时段
        if (this.isQuietHours() && !globalConfig.allowQuietHoursOverride) {
            logger.debug(`[ProactiveChatService] 群${groupId} 跳过: 静默时段`)
            return { canTrigger: false, reason: 'quiet_hours' }
        }

        // 检查白名单/黑名单
        const enabledGroups = globalConfig.enabledGroups || []
        const blacklistGroups = globalConfig.blacklistGroups || []

        if (blacklistGroups.includes(groupId) || blacklistGroups.includes(Number(groupId))) {
            logger.debug(`[ProactiveChatService] 群${groupId} 跳过: 在黑名单中`)
            return { canTrigger: false, reason: 'blacklisted' }
        }
        const groupSettings = await this.getGroupSettings(groupId)
        const hasGroupOverride = groupSettings.proactiveChatEnabled !== undefined
        if (
            !hasGroupOverride &&
            enabledGroups.length > 0 &&
            !enabledGroups.includes(groupId) &&
            !enabledGroups.includes(Number(groupId))
        ) {
            logger.debug(`[ProactiveChatService] 群${groupId} 跳过: 不在白名单中且无群组覆盖`)
            return { canTrigger: false, reason: 'not_in_whitelist' }
        }

        // 检查冷却时间
        const stats = this.stats.get(groupId)
        if (stats) {
            const cooldownMs = (config.cooldownMinutes ?? 30) * 60 * 1000
            const elapsed = Date.now() - stats.lastTrigger
            if (elapsed < cooldownMs) {
                const remaining = Math.ceil((cooldownMs - elapsed) / 60000)
                logger.debug(`[ProactiveChatService] 群${groupId} 跳过: 冷却中 (剩余${remaining}分钟)`)
                return { canTrigger: false, reason: 'cooldown', remaining }
            }

            // 检查每日限制
            const today = new Date().toISOString().split('T')[0]
            const maxDaily = config.maxDailyMessages ?? 20
            if (stats.date === today && stats.dailyCount >= maxDaily) {
                logger.debug(`[ProactiveChatService] 群${groupId} 跳过: 已达每日上限 (${stats.dailyCount}/${maxDaily})`)
                return { canTrigger: false, reason: 'daily_limit', count: stats.dailyCount, max: maxDaily }
            }

            // 检查每小时限制
            const maxHourly = config.maxHourlyMessages ?? 5
            const currentHour = new Date().getHours()
            if (stats.lastHour === currentHour && (stats.hourlyTriggers || 0) >= maxHourly) {
                logger.debug(
                    `[ProactiveChatService] 群${groupId} 跳过: 已达每小时上限 (${stats.hourlyTriggers}/${maxHourly})`
                )
                return { canTrigger: false, reason: 'hourly_limit', count: stats.hourlyTriggers, max: maxHourly }
            }
        }

        // 检查近期活跃度
        try {
            const { getGroupRecentActivity } = await this.loadGroupMessageFunctions()
            if (getGroupRecentActivity) {
                const inactiveLimitMs = (config.inactiveMinutesLimit ?? 180) * 60 * 1000
                const { lastActiveAt } = getGroupRecentActivity(groupId, {
                    windowMs: inactiveLimitMs,
                    maxMessages: 500
                })
                const inactiveDuration = Date.now() - (lastActiveAt || 0)
                if (!lastActiveAt || inactiveDuration >= inactiveLimitMs) {
                    logger.debug(
                        `[ProactiveChatService] 群${groupId} 跳过: 长时间无活跃 (last=${lastActiveAt || '无'}, limit=${
                            config.inactiveMinutesLimit ?? 180
                        }min)`
                    )
                    return {
                        canTrigger: false,
                        reason: 'inactive',
                        lastActiveAt,
                        limit: config.inactiveMinutesLimit ?? 180
                    }
                }
            }
        } catch (e) {
            logger.debug('[ProactiveChatService] 活跃度检查失败:', e.message)
        }

        logger.debug(
            `[ProactiveChatService] 群${groupId} 通过检查: 启用=${config.enabled}, 概率=${config.baseProbability}, 有群组覆盖=${hasGroupOverride}`
        )
        return { canTrigger: true }
    }

    /**
     * 检查群消息数量是否足够触发
     * @param {string} groupId
     * @returns {Promise<boolean>}
     */
    async hasEnoughMessages(groupId) {
        const config = this.getConfig()
        const { getGroupMessageCount } = await this.loadGroupMessageFunctions()
        if (!getGroupMessageCount) return false

        const count = getGroupMessageCount(groupId)
        return count >= (config.minMessagesBeforeTrigger ?? 10)
    }

    /**
     * 执行主动聊天
     * @param {string} groupId
     */
    async execute(groupId) {
        const config = this.getConfig()

        // 尝试获取最近消息作为上下文
        let recentMessages = []
        try {
            const { getRecentGroupMessages } = await this.loadGroupMessageFunctions()
            if (getRecentGroupMessages) {
                const contextCount = config.contextMessageCount ?? 20
                recentMessages = getRecentGroupMessages(groupId, contextCount) || []
            }
        } catch (e) {
            logger.debug(`[ProactiveChatService] 获取群${groupId}消息失败:`, e.message)
        }

        try {
            const { chatService } = await import('../llm/ChatService.js')
            const systemPrompt = config.systemPrompt || '你是群里的一员，自然地参与讨论或发起有趣的话题。'

            let prompt
            if (recentMessages.length > 0) {
                const contextText = recentMessages.map(m => `${m.nickname || m.userId}: ${m.content}`).join('\n')
                prompt = `最近的群聊记录:\n${contextText}\n\n请根据上述聊天内容，自然地发言或发起一个有趣的话题。`
            } else {
                prompt = '群里好像有点安静，请主动发起一个有趣的话题或打个招呼，让群里热闹起来。'
            }

            const result = await chatService.sendMessage({
                userId: 'proactive_chat',
                groupId: groupId,
                message: prompt,
                mode: 'chat',
                options: {
                    systemPrompt,
                    model: config.model || undefined,
                    maxTokens: config.maxTokens ?? 150,
                    temperature: config.temperature ?? 0.9
                }
            })

            // 提取回复文本
            let responseText = ''
            if (result.response && Array.isArray(result.response)) {
                responseText = result.response
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            }

            if (!responseText || responseText.trim() === '') {
                logger.debug(`[ProactiveChatService] 群${groupId} AI回复为空，跳过`)
                return
            }

            // 发送消息
            const bot = this.getBot()
            if (bot) {
                await this.sendToGroup(bot, groupId, responseText)
                logger.info(`[ProactiveChatService] 群${groupId} 主动发言成功`)

                // 更新统计
                this.updateStats(groupId)
            }
        } catch (err) {
            logger.error(`[ProactiveChatService] 群${groupId} 执行失败:`, err.message)
        }
    }

    /**
     * 更新统计信息
     * @param {string} groupId
     */
    updateStats(groupId) {
        const now = new Date()
        const today = now.toISOString().split('T')[0]
        const currentHour = now.getHours()

        const stats = this.stats.get(groupId) || {
            lastTrigger: 0,
            dailyCount: 0,
            date: today,
            hourlyTriggers: 0,
            lastHour: currentHour
        }

        // 重置日统计
        if (stats.date !== today) {
            stats.dailyCount = 0
            stats.date = today
        }

        // 重置小时统计
        if (stats.lastHour !== currentHour) {
            stats.hourlyTriggers = 0
            stats.lastHour = currentHour
        }

        stats.lastTrigger = Date.now()
        stats.dailyCount++
        stats.hourlyTriggers = (stats.hourlyTriggers || 0) + 1

        this.stats.set(groupId, stats)
    }

    /**
     * 获取Bot实例
     */
    getBot() {
        if (!global.Bot) return null
        for (const uin of Object.keys(global.Bot.uin || {})) {
            const bot = global.Bot[uin]
            if (bot?.pickGroup || bot?.sendGroupMsg) {
                return bot
            }
        }
        if (global.Bot.pickGroup || global.Bot.sendGroupMsg) {
            return global.Bot
        }
        return null
    }

    /**
     * 获取活跃群列表
     * @returns {Promise<string[]>}
     */
    async getActiveGroups() {
        const groups = []
        try {
            const bot = this.getBot()
            if (!bot) return groups

            if (bot.gl && bot.gl instanceof Map) {
                for (const [groupId] of bot.gl) {
                    groups.push(String(groupId))
                }
            } else if (bot.getGroupList) {
                const list = await bot.getGroupList()
                if (Array.isArray(list)) {
                    for (const g of list) {
                        groups.push(String(g.group_id || g.id))
                    }
                }
            }
        } catch (e) {
            logger.debug('[ProactiveChatService] 获取群列表失败:', e.message)
        }
        return groups
    }

    /**
     * 发送群消息
     * @param {Object} bot
     * @param {string} groupId
     * @param {*} message
     */
    async sendToGroup(bot, groupId, message) {
        try {
            // ICQQ方式
            if (bot.pickGroup) {
                const group = bot.pickGroup(Number(groupId))
                if (group?.sendMsg) {
                    await group.sendMsg(message)
                    return true
                }
            }
            // 通用方式
            if (bot.sendGroupMsg) {
                await bot.sendGroupMsg(Number(groupId), message)
                return true
            }
        } catch (err) {
            logger.error(`[ProactiveChatService] 发送群消息失败:`, err.message)
        }
        return false
    }

    /**
     * 主动聊天轮询
     */
    async poll() {
        const globalConfig = this.getConfig()
        const timePeriod = this.getCurrentTimePeriod()
        const isQuiet = this.isQuietHours()

        logger.info(
            `[ProactiveChatService] === 开始轮询 === 全局开关=${globalConfig.enabled}, ` +
                `时段=${timePeriod}, 静默=${isQuiet}, 轮询间隔=${globalConfig.pollInterval ?? 5}分钟`
        )

        // 静默时段跳过整个轮询
        if (isQuiet && !globalConfig.allowQuietHoursOverride) {
            logger.info('[ProactiveChatService] 轮询跳过: 当前为静默时段')
            return
        }

        // 获取所有Bot群列表
        const allGroups = await this.getActiveGroups()

        if (allGroups.length === 0) {
            logger.info('[ProactiveChatService] 轮询结束: 无可用群列表')
            return
        }

        logger.info(`[ProactiveChatService] 扫描 ${allGroups.length} 个群...`)

        let passedCount = 0
        let triggeredCount = 0
        const skipReasons = {}

        for (const groupId of allGroups) {
            // 检查是否可以触发
            const checkResult = await this.canTrigger(groupId)
            if (!checkResult.canTrigger) {
                skipReasons[checkResult.reason] = (skipReasons[checkResult.reason] || 0) + 1
                continue
            }
            passedCount++

            // 计算概率并随机触发
            const { probability, factors } = await this.calculateProbability(groupId)
            const roll = Math.random()
            const triggered = roll < probability

            logger.debug(
                `[ProactiveChatService] 群${groupId} 概率判断: ` +
                    `概率=${(probability * 100).toFixed(1)}%, 随机=${(roll * 100).toFixed(1)}%, ` +
                    `场景=${factors.scenario}, 触发=${triggered}`
            )

            if (triggered) {
                triggeredCount++
                logger.info(`[ProactiveChatService] 群${groupId} 触发主动聊天! (场景: ${factors.scenario})`)
                await this.execute(groupId)

                // 避免同时触发太多群
                const maxConcurrent = globalConfig.maxConcurrentTriggers ?? 3
                if (triggeredCount >= maxConcurrent) {
                    logger.info(`[ProactiveChatService] 已达本次轮询最大触发数 ${maxConcurrent}，停止继续触发`)
                    break
                }
            }
        }

        // 输出跳过原因统计
        const skipSummary = Object.entries(skipReasons)
            .map(([reason, count]) => `${reason}=${count}`)
            .join(', ')

        logger.info(
            `[ProactiveChatService] === 轮询结束 === 总群数=${allGroups.length}, ` +
                `通过检查=${passedCount}, 触发=${triggeredCount}` +
                (skipSummary ? `, 跳过原因: ${skipSummary}` : '')
        )
    }

    /**
     * 获取统计信息
     * @param {string} groupId
     * @returns {Object|null}
     */
    getStats(groupId) {
        return this.stats.get(groupId) || null
    }

    /**
     * 获取所有统计信息
     * @returns {Object}
     */
    getAllStats() {
        const result = {}
        for (const [groupId, stats] of this.stats) {
            result[groupId] = stats
        }
        return result
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this.groupSettingsCache.clear()
    }
}

// 单例导出
export const proactiveChatService = new ProactiveChatService()
export default proactiveChatService
