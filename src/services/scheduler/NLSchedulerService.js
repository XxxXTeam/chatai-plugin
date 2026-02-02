/**
 * 自然语言定时任务服务
 * 支持用户用自然语言创建定时任务，如"5分钟后发一首周杰伦的歌"
 */
import { chatLogger } from '../../core/utils/logger.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const logger = chatLogger
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TASKS_FILE = path.join(__dirname, '../../../data/nl_scheduled_tasks.json')

class NLSchedulerService {
    constructor() {
        this.initialized = false
        this.tasks = new Map()
        this.checkInterval = null
    }

    async init() {
        if (this.initialized) return

        await this.loadTasks()

        // 每30秒检查一次到期任务
        this.checkInterval = setInterval(() => {
            this.checkAndExecuteTasks().catch(err => {
                logger.warn('[NLScheduler] 检查任务失败:', err.message)
            })
        }, 30 * 1000)

        // 首次检查延迟3秒
        setTimeout(() => {
            this.checkAndExecuteTasks().catch(err => {
                logger.warn('[NLScheduler] 首次检查失败:', err.message)
            })
        }, 3000)

        this.initialized = true
    }

    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval)
            this.checkInterval = null
        }
        this.initialized = false
        logger.info('[NLScheduler] 服务已停止')
    }

    /**
     * 解析自然语言时间表达式
     * @param {string} text - 时间表达式，如 "5分钟后"、"1小时后"、"明天早上8点"
     * @returns {{ executeAt: number, description: string } | null}
     */
    parseTime(text) {
        const now = Date.now()
        let executeAt = null
        let description = ''

        // 相对时间：X分钟后、X小时后、X秒后、X天后
        const relativeMatch = text.match(/(\d+)\s*(秒|分钟?|小时|天|周)后?/i)
        if (relativeMatch) {
            const value = parseInt(relativeMatch[1])
            const unit = relativeMatch[2]

            const multipliers = {
                秒: 1000,
                分: 60 * 1000,
                分钟: 60 * 1000,
                小时: 60 * 60 * 1000,
                天: 24 * 60 * 60 * 1000,
                周: 7 * 24 * 60 * 60 * 1000
            }

            const ms = value * (multipliers[unit] || 60 * 1000)
            executeAt = now + ms
            description = `${value}${unit}后`
        }

        // 绝对时间：今天/明天/后天 + 时间
        const absoluteMatch = text.match(
            /(今天|明天|后天|大后天)?\s*(早上|上午|中午|下午|晚上|凌晨)?\s*(\d{1,2})[:：点](\d{0,2})?/i
        )
        if (absoluteMatch) {
            const dayWord = absoluteMatch[1] || '今天'
            const period = absoluteMatch[2] || ''
            let hour = parseInt(absoluteMatch[3])
            const minute = parseInt(absoluteMatch[4]) || 0

            // 处理上下午
            if (period === '下午' || period === '晚上') {
                if (hour < 12) hour += 12
            } else if (period === '凌晨' && hour === 12) {
                hour = 0
            } else if ((period === '早上' || period === '上午') && hour === 12) {
                hour = 0
            }

            const target = new Date()
            target.setHours(hour, minute, 0, 0)

            // 处理日期偏移
            const dayOffsets = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }
            const offset = dayOffsets[dayWord] || 0
            target.setDate(target.getDate() + offset)

            // 如果是今天且时间已过，自动推到明天
            if (offset === 0 && target.getTime() <= now) {
                target.setDate(target.getDate() + 1)
            }

            executeAt = target.getTime()
            description = `${dayWord}${period}${hour}:${minute.toString().padStart(2, '0')}`
        }

        // 简单时间：X点、X:XX
        if (!executeAt) {
            const simpleMatch = text.match(/(\d{1,2})[:：点](\d{0,2})?分?/)
            if (simpleMatch) {
                const hour = parseInt(simpleMatch[1])
                const minute = parseInt(simpleMatch[2]) || 0

                const target = new Date()
                target.setHours(hour, minute, 0, 0)

                if (target.getTime() <= now) {
                    target.setDate(target.getDate() + 1)
                }

                executeAt = target.getTime()
                description = `${hour}:${minute.toString().padStart(2, '0')}`
            }
        }

        if (!executeAt) return null

        // 限制最长30天
        const maxTime = now + 30 * 24 * 60 * 60 * 1000
        if (executeAt > maxTime) {
            return null
        }

        // 最短30秒
        if (executeAt - now < 30 * 1000) {
            executeAt = now + 30 * 1000
        }

        return { executeAt, description }
    }

    /**
     * 格式化剩余时间
     */
    formatRemaining(ms) {
        if (ms < 60 * 1000) return `${Math.ceil(ms / 1000)}秒`
        if (ms < 60 * 60 * 1000) return `${Math.ceil(ms / 60000)}分钟`
        if (ms < 24 * 60 * 60 * 1000) {
            const hours = Math.floor(ms / 3600000)
            const mins = Math.ceil((ms % 3600000) / 60000)
            return mins > 0 ? `${hours}小时${mins}分钟` : `${hours}小时`
        }
        const days = Math.floor(ms / 86400000)
        const hours = Math.ceil((ms % 86400000) / 3600000)
        return hours > 0 ? `${days}天${hours}小时` : `${days}天`
    }

    /**
     * 创建定时任务
     * @param {Object} options
     * @param {string} options.timeText - 时间文本，如 "5分钟后"
     * @param {string} options.taskContent - 任务内容，如 "发一首周杰伦的歌"
     * @param {string} options.groupId - 群ID
     * @param {string} options.creatorId - 创建者QQ
     * @param {string} [options.targetId] - 目标用户QQ（可选，@某人时使用）
     * @param {string} [options.creatorName] - 创建者昵称
     * @param {string} [options.targetName] - 目标用户昵称
     * @returns {{ success: boolean, taskId?: string, executeAt?: number, error?: string }}
     */
    createTask(options) {
        const { timeText, taskContent, groupId, creatorId, targetId, creatorName, targetName } = options

        if (!timeText || !taskContent) {
            return { success: false, error: '请提供时间和任务内容' }
        }

        if (!groupId) {
            return { success: false, error: '定时任务仅支持在群内创建' }
        }

        const timeInfo = this.parseTime(timeText)
        if (!timeInfo) {
            return { success: false, error: '无法解析时间，请使用如"5分钟后"、"明天早上8点"等格式' }
        }

        const taskId = this.generateTaskId()
        const now = Date.now()

        const task = {
            id: taskId,
            groupId: String(groupId),
            creatorId: String(creatorId),
            creatorName: creatorName || '',
            targetId: targetId ? String(targetId) : null,
            targetName: targetName || '',
            content: taskContent,
            timeDescription: timeInfo.description,
            executeAt: timeInfo.executeAt,
            createdAt: now,
            executed: false
        }

        this.tasks.set(taskId, task)
        this.saveTasks()

        logger.info(`[NLScheduler] 创建任务: ${taskId}, ${timeInfo.description}, 内容: ${taskContent.slice(0, 30)}`)

        return {
            success: true,
            taskId,
            executeAt: timeInfo.executeAt,
            timeDescription: timeInfo.description,
            remaining: this.formatRemaining(timeInfo.executeAt - now)
        }
    }

    /**
     * 取消任务
     */
    cancelTask(taskId, userId) {
        const task = this.tasks.get(taskId)
        if (!task) {
            return { success: false, error: '未找到该任务' }
        }

        if (task.creatorId !== String(userId)) {
            return { success: false, error: '只能取消自己创建的任务' }
        }

        this.tasks.delete(taskId)
        this.saveTasks()

        logger.info(`[NLScheduler] 取消任务: ${taskId}`)
        return { success: true, task }
    }

    /**
     * 列出用户的任务
     */
    listTasks(userId, groupId = null) {
        const result = []
        const now = Date.now()

        for (const task of this.tasks.values()) {
            if (task.executed) continue
            if (userId && task.creatorId !== String(userId)) continue
            if (groupId && task.groupId !== String(groupId)) continue

            result.push({
                id: task.id,
                content: task.content,
                timeDescription: task.timeDescription,
                remaining: this.formatRemaining(task.executeAt - now),
                targetName: task.targetName || null
            })
        }

        return result
    }

    /**
     * 检查并执行到期任务
     */
    async checkAndExecuteTasks() {
        const now = Date.now()
        const tasksToExecute = []

        for (const [taskId, task] of this.tasks) {
            if (task.executed) continue
            if (task.executeAt <= now) {
                tasksToExecute.push(task)
            }
        }

        if (tasksToExecute.length === 0) return

        logger.debug(`[NLScheduler] 发现 ${tasksToExecute.length} 个到期任务`)

        for (const task of tasksToExecute) {
            try {
                await this.executeTask(task)
                task.executed = true
                logger.info(`[NLScheduler] 任务执行成功: ${task.id}`)
            } catch (err) {
                logger.error(`[NLScheduler] 任务执行失败: ${task.id}`, err.message)
            }
        }

        // 清理已执行的任务
        for (const task of tasksToExecute) {
            if (task.executed) {
                this.tasks.delete(task.id)
            }
        }

        this.saveTasks()
    }

    /**
     * 执行任务
     */
    async executeTask(task) {
        const bot = this.getBot()
        if (!bot) {
            throw new Error('Bot实例不可用')
        }

        const { groupId, creatorId, targetId, targetName, content } = task

        // 构建消息
        let message = []

        // 如果有目标用户，先@他
        if (targetId) {
            message.push({ type: 'at', qq: Number(targetId) })
            message.push(' ')
        }

        // 判断是否需要AI处理
        const needsAI = this.needsAIProcessing(content)

        if (needsAI) {
            // 需要AI处理的任务（如"发一首周杰伦的歌"）
            try {
                const { chatService } = await import('../llm/ChatService.js')
                const prompt = this.buildAIPrompt(content, targetName)

                const result = await chatService.sendMessage({
                    userId: creatorId,
                    groupId: groupId,
                    message: prompt,
                    mode: 'chat'
                })

                let responseText = ''
                if (result.response && Array.isArray(result.response)) {
                    responseText = result.response
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                }

                if (responseText) {
                    message.push(responseText)
                } else {
                    message.push(`⏰ 定时提醒：${content}`)
                }
            } catch (err) {
                logger.warn('[NLScheduler] AI处理失败，使用简单提醒:', err.message)
                message.push(`⏰ 定时提醒：${content}`)
            }
        } else {
            // 简单的文本提醒
            message.push(`⏰ 时间到！${content}`)
        }

        await this.sendToGroup(bot, groupId, message)
    }

    /**
     * 判断任务是否需要AI处理
     */
    needsAIProcessing(content) {
        const aiKeywords = [
            '发一首',
            '推荐',
            '讲个',
            '说个',
            '写个',
            '生成',
            '创作',
            '找一个',
            '查一下',
            '搜索',
            '帮我',
            '给我'
        ]
        return aiKeywords.some(kw => content.includes(kw))
    }

    /**
     * 构建AI提示词
     */
    buildAIPrompt(content, targetName) {
        let prompt = `用户设置了一个定时任务，现在时间到了。任务内容是：${content}`

        if (targetName) {
            prompt += `\n这个任务是给 ${targetName} 的。`
        }

        prompt += '\n请直接完成这个任务，不要解释你在做什么。'

        return prompt
    }

    /**
     * 发送群消息
     */
    async sendToGroup(bot, groupId, message) {
        try {
            if (bot.pickGroup) {
                const group = bot.pickGroup(Number(groupId))
                if (group?.sendMsg) {
                    await group.sendMsg(message)
                    return true
                }
            }
            if (bot.sendGroupMsg) {
                await bot.sendGroupMsg(Number(groupId), message)
                return true
            }
        } catch (err) {
            logger.error('[NLScheduler] 发送消息失败:', err.message)
        }
        return false
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
     * 生成任务ID
     */
    generateTaskId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    }

    /**
     * 保存任务到文件
     */
    saveTasks() {
        try {
            const tasksData = Array.from(this.tasks.values()).filter(t => !t.executed)
            const dir = path.dirname(TASKS_FILE)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            fs.writeFileSync(TASKS_FILE, JSON.stringify(tasksData, null, 2), 'utf-8')
        } catch (err) {
            logger.warn('[NLScheduler] 保存任务失败:', err.message)
        }
    }

    /**
     * 加载任务
     */
    async loadTasks() {
        try {
            if (!fs.existsSync(TASKS_FILE)) return

            const data = fs.readFileSync(TASKS_FILE, 'utf-8')
            const tasksData = JSON.parse(data)
            const now = Date.now()

            for (const task of tasksData) {
                // 跳过已过期的任务
                if (task.executeAt <= now || task.executed) continue
                this.tasks.set(task.id, task)
            }

            logger.debug(`[NLScheduler] 已加载 ${this.tasks.size} 个待执行任务`)
        } catch (err) {
            logger.warn('[NLScheduler] 加载任务失败:', err.message)
        }
    }
}

export const nlSchedulerService = new NLSchedulerService()
export default nlSchedulerService
