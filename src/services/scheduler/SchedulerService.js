/**
 * 周期任务调度服务 - 处理定时总结推送等周期性任务
 */
import { chatLogger } from '../../core/utils/logger.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { databaseService } from '../storage/DatabaseService.js'
import { chatService } from '../llm/ChatService.js'
import { renderService } from '../media/RenderService.js'
import { getGroupChatHistory, getUserInfo } from '../../utils/platformAdapter.js'
import config from '../../../config/config.js'
import { segment } from '../../utils/messageParser.js'

class SchedulerService {
    constructor() {
        this.initialized = false
        this.tasks = new Map()  // taskId -> { interval, lastRun, config }
        this.checkInterval = null
        this.scopeManager = null
        this.lastMessageSeq = new Map()  // groupId -> lastProcessedSeq (避免重复总结)
    }

    /**
     * 初始化调度服务
     */
    async init() {
        if (this.initialized) return
        
        try {
            await databaseService.init()
            this.scopeManager = getScopeManager(databaseService)
            await this.scopeManager.init()
            
            // 每分钟检查一次任务
            this.checkInterval = setInterval(() => this.checkTasks(), 60 * 1000)
            
            // 启动时立即检查一次
            await this.loadScheduledTasks()
            
            this.initialized = true
            chatLogger.info('[SchedulerService] 调度服务已启动')
        } catch (error) {
            chatLogger.error('[SchedulerService] 初始化失败:', error)
        }
    }

    /**
     * 加载所有定时任务配置
     */
    async loadScheduledTasks() {
        try {
            const groups = await this.scopeManager.listGroupSettings()
            
            for (const group of groups) {
                const settings = group.settings || {}
                
                // 检查定时总结推送配置
                if (settings.summaryPushEnabled) {
                    this.registerSummaryPushTask(group.groupId, {
                        intervalType: settings.summaryPushIntervalType || 'day',
                        intervalValue: settings.summaryPushIntervalValue || 1,
                        pushHour: settings.summaryPushHour ?? 20,
                        summaryModel: settings.summaryModel,
                        messageCount: settings.summaryPushMessageCount || 100
                    })
                }
            }
        } catch (error) {
            chatLogger.error('[SchedulerService] 加载任务失败:', error)
        }
    }

    /**
     * 注册总结推送任务
     */
    registerSummaryPushTask(groupId, taskConfig) {
        const taskId = `summary_push_${groupId}`
        const nextRun = this.calculateNextRun(taskConfig)
        
        this.tasks.set(taskId, {
            type: 'summary_push',
            groupId,
            config: taskConfig,
            nextRun,
            lastRun: null
        })
        
        chatLogger.debug(`[SchedulerService] 注册任务: ${taskId}, 下次执行: ${new Date(nextRun).toLocaleString()}`)
    }

    /**
     * 计算下次执行时间
     */
    calculateNextRun(taskConfig) {
        const now = new Date()
        
        if (taskConfig.intervalType === 'hour') {
            // 按小时：下一个整点 + 间隔
            const nextHour = new Date(now)
            nextHour.setMinutes(0, 0, 0)
            nextHour.setHours(nextHour.getHours() + taskConfig.intervalValue)
            return nextHour.getTime()
        } else {
            // 按天：下一个指定时间点
            const nextDay = new Date(now)
            nextDay.setHours(taskConfig.pushHour || 20, 0, 0, 0)
            
            // 如果今天已过该时间，推到明天
            if (nextDay.getTime() <= now.getTime()) {
                nextDay.setDate(nextDay.getDate() + (taskConfig.intervalValue || 1))
            }
            
            return nextDay.getTime()
        }
    }

    /**
     * 检查并执行到期任务
     */
    async checkTasks() {
        const now = Date.now()
        
        for (const [taskId, task] of this.tasks) {
            if (task.nextRun && task.nextRun <= now) {
                try {
                    await this.executeTask(taskId, task)
                    
                    // 更新下次执行时间
                    task.lastRun = now
                    task.nextRun = this.calculateNextRun(task.config)
                    
                    chatLogger.info(`[SchedulerService] 任务完成: ${taskId}, 下次执行: ${new Date(task.nextRun).toLocaleString()}`)
                } catch (error) {
                    chatLogger.error(`[SchedulerService] 任务执行失败: ${taskId}`, error)
                }
            }
        }
    }

    /**
     * 执行任务
     */
    async executeTask(taskId, task) {
        switch (task.type) {
            case 'summary_push':
                await this.executeSummaryPush(task.groupId, task.config)
                break
            default:
                chatLogger.warn(`[SchedulerService] 未知任务类型: ${task.type}`)
        }
    }

    /**
     * 执行群聊总结推送 - 使用Bot API获取消息，按序列号跟踪避免重复
     */
    async executeSummaryPush(groupId, taskConfig) {
        chatLogger.info(`[SchedulerService] 开始生成群 ${groupId} 的定时总结`)
        
        try {
            const messageCount = taskConfig.messageCount || 100
            const maxChars = config.get('features.groupSummary.maxChars') || 6000
            
            // 获取上次处理的消息序号
            const lastSeq = this.lastMessageSeq.get(groupId) || 0
            
            // 从Bot API获取群聊历史（从上次序号之后开始）
            let history = []
            try {
                // 构造一个虚拟的e对象用于调用API
                const e = { group_id: Number(groupId), bot: global.Bot }
                history = await getGroupChatHistory(e, groupId, messageCount, lastSeq)
            } catch (err) {
                chatLogger.warn(`[SchedulerService] Bot API获取群 ${groupId} 历史失败:`, err.message)
                return
            }
            
            if (!history || history.length === 0) {
                chatLogger.info(`[SchedulerService] 群 ${groupId} 没有新消息，跳过总结`)
                return
            }
            
            // 解析消息并记录最新序号
            let newLastSeq = lastSeq
            const messages = await Promise.all(history.map(async msg => {
                // 更新最新序号
                if (msg.message_seq && msg.message_seq > newLastSeq) {
                    newLastSeq = msg.message_seq
                } else if (msg.seq && msg.seq > newLastSeq) {
                    newLastSeq = msg.seq
                }
                
                const nickname = msg.sender?.card || msg.sender?.nickname || '用户'
                const contentParts = await Promise.all(
                    (msg.message || []).map(async part => {
                        if (part.type === 'text') return part.text
                        if (part.type === 'at') {
                            if (part.qq === 'all' || part.qq === 0) return '@全体成员'
                            try {
                                const info = await getUserInfo({ group_id: groupId }, part.qq, groupId)
                                return `@${info?.card || info?.nickname || part.qq}`
                            } catch {
                                return `@${part.qq}`
                            }
                        }
                        return ''
                    })
                )
                return {
                    userId: msg.sender?.user_id,
                    nickname,
                    content: contentParts.join(''),
                    timestamp: msg.time ? msg.time * 1000 : Date.now()
                }
            }))
            
            // 过滤空消息
            const validMessages = messages.filter(m => m.content && m.content.trim())
            
            if (validMessages.length < 5) {
                chatLogger.info(`[SchedulerService] 群 ${groupId} 有效消息不足5条，跳过总结`)
                return
            }
            
            // 更新已处理的消息序号
            this.lastMessageSeq.set(groupId, newLastSeq)
            chatLogger.debug(`[SchedulerService] 群 ${groupId} 消息序号更新: ${lastSeq} -> ${newLastSeq}`)
            
            // 构建对话文本
            let dialogText = validMessages.map(m => {
                return `[${m.nickname || '用户'}]: ${m.content}`
            }).join('\n')
            
            let truncatedNote = ''
            if (dialogText.length > maxChars) {
                dialogText = dialogText.slice(-maxChars)
                truncatedNote = '\n\n⚠️ 消息过长，已截断到最近部分。'
            }
            
            // 统计参与者
            const participants = new Set(validMessages.map(m => m.nickname || m.userId || '用户'))
            
            // 预先统计用户活跃度数据
            const userStats = {}
            const hourlyActivity = Array(24).fill(0)
            
            for (const msg of validMessages) {
                const name = msg.nickname || msg.userId || '用户'
                const odId = msg.userId || null
                if (!userStats[name]) {
                    userStats[name] = { name, odId, count: 0, lastMsg: '' }
                }
                userStats[name].count++
                if (msg.content) {
                    userStats[name].lastMsg = String(msg.content).substring(0, 30)
                }
                if (msg.timestamp) {
                    const hour = new Date(msg.timestamp).getHours()
                    hourlyActivity[hour]++
                }
            }
            
            // 获取活跃用户TOP5
            const topUsers = Object.values(userStats)
                .sort((a, b) => b.count - a.count)
                .slice(0, 5)
                .map(u => ({ 
                    name: u.name, 
                    count: u.count,
                    odId: u.odId,
                    avatar: u.odId ? `https://q1.qlogo.cn/g?b=qq&nk=${u.odId}&s=0` : null
                }))
            
            // 使用与群聊总结相同的提示词
            const summaryPrompt = `请根据以下群聊记录，对群聊内容进行全面的总结分析。请从以下几个维度进行分析，并以清晰、有条理的Markdown格式呈现你的结论：

## 分析维度

1. **🔥 热门话题**：群友们最近在讨论什么话题？有哪些热点事件或共同关注的内容？按热度排序列出主要话题。

2. **👥 活跃成员**：哪些成员发言最多？简要描述他们的发言特点和主要讨论内容。

3. **💬 群聊氛围**：群聊的整体氛围如何？（例如：轻松愉快、严肃认真、热烈讨论等）

4. **📌 关键信息**：有没有重要的通知、决定或值得关注的信息？包括但不限于：活动安排、重要公告、问题讨论结论等。

5. **🎯 话题趋势**：群聊话题有什么变化趋势？哪些话题正在升温，哪些已经结束？

6. **💡 精彩瞬间**：有哪些有趣的对话、金句或值得记录的互动？

## 注意事项
- 请保持客观中立，如实反映群聊内容
- 对于敏感话题请谨慎处理
- 总结要简洁明了，突出重点

---

以下是最近的群聊记录（共 ${validMessages.length} 条消息，${participants.size} 位参与者）：

${dialogText}${truncatedNote}`

            // 生成总结
            const result = await chatService.sendMessage({
                userId: `scheduled_summary_${groupId}`,
                groupId: null,
                message: summaryPrompt,
                model: taskConfig.summaryModel || undefined,
                mode: 'chat',
                skipHistory: true,
                disableTools: true,
                skipPersona: true
            })

            let summaryText = ''
            if (result.response && Array.isArray(result.response)) {
                summaryText = result.response
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            }

            if (summaryText) {
                const actualModel = result?.model || taskConfig.summaryModel || config.get('llm.defaultModel') || '默认模型'
                const shortModel = actualModel.split('/').pop()
                try {
                    const imageBuffer = await renderService.renderGroupSummary(summaryText, {
                        title: '群聊内容总结',
                        subtitle: `${shortModel} · Bot API`,
                        messageCount: validMessages.length,
                        participantCount: participants.size,
                        topUsers,
                        hourlyActivity
                    })
                    await this.sendToGroup(groupId, segment.image(imageBuffer))
                } catch (renderErr) {
                    chatLogger.warn(`[SchedulerService] 渲染图片失败:`, renderErr.message)
                    await this.sendToGroup(groupId, `📊 群聊总结 (${validMessages.length}条消息 · ${shortModel})\n\n${summaryText}`)
                }
                
                chatLogger.info(`[SchedulerService] 群 ${groupId} 总结推送成功 (seq: ${lastSeq} -> ${newLastSeq})`)
            }
        } catch (error) {
            chatLogger.error(`[SchedulerService] 群 ${groupId} 总结推送失败:`, error)
            throw error
        }
    }

    /**
     * 发送消息到群
     */
    async sendToGroup(groupId, message) {
        try {
            // 尝试通过 Bot 发送消息
            if (global.Bot) {
                // ICQQ/OICQ 方式
                for (const uin of Object.keys(global.Bot.uin || {})) {
                    const bot = global.Bot[uin]
                    if (bot?.pickGroup) {
                        const group = bot.pickGroup(Number(groupId))
                        if (group) {
                            await group.sendMsg(message)
                            return true
                        }
                    }
                }
                
                // Yunzai 通用方式
                if (global.Bot.sendGroupMsg) {
                    await global.Bot.sendGroupMsg(Number(groupId), message)
                    return true
                }
            }
            
            chatLogger.warn(`[SchedulerService] 无法发送消息到群 ${groupId}，Bot实例不可用`)
            return false
        } catch (error) {
            chatLogger.error(`[SchedulerService] 发送群消息失败:`, error)
            return false
        }
    }

    /**
     * 更新群组的定时任务
     */
    updateGroupTask(groupId, settings) {
        const taskId = `summary_push_${groupId}`
        
        if (settings.summaryPushEnabled) {
            this.registerSummaryPushTask(groupId, {
                intervalType: settings.summaryPushIntervalType || 'day',
                intervalValue: settings.summaryPushIntervalValue || 1,
                pushHour: settings.summaryPushHour ?? 20,
                summaryModel: settings.summaryModel,
                messageCount: settings.summaryPushMessageCount || 100
            })
        } else {
            // 移除任务
            this.tasks.delete(taskId)
            chatLogger.debug(`[SchedulerService] 移除任务: ${taskId}`)
        }
    }

    /**
     * 手动触发群总结
     */
    async triggerSummaryNow(groupId) {
        const taskId = `summary_push_${groupId}`
        const task = this.tasks.get(taskId)
        
        if (task) {
            await this.executeSummaryPush(groupId, task.config)
        } else {
            // 使用默认配置执行
            await this.executeSummaryPush(groupId, {})
        }
    }

    /**
     * 获取任务状态
     */
    getTaskStatus(groupId) {
        const taskId = `summary_push_${groupId}`
        const task = this.tasks.get(taskId)
        
        if (!task) return null
        
        return {
            taskId,
            type: task.type,
            config: task.config,
            nextRun: task.nextRun ? new Date(task.nextRun).toISOString() : null,
            lastRun: task.lastRun ? new Date(task.lastRun).toISOString() : null
        }
    }

    /**
     * 获取所有任务状态
     */
    getAllTaskStatus() {
        const result = []
        for (const [taskId, task] of this.tasks) {
            result.push({
                taskId,
                groupId: task.groupId,
                type: task.type,
                nextRun: task.nextRun ? new Date(task.nextRun).toISOString() : null,
                lastRun: task.lastRun ? new Date(task.lastRun).toISOString() : null
            })
        }
        return result
    }

    /**
     * 停止调度服务
     */
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval)
            this.checkInterval = null
        }
        this.tasks.clear()
        this.initialized = false
        chatLogger.info('[SchedulerService] 调度服务已停止')
    }
}

export const schedulerService = new SchedulerService()
export default schedulerService
