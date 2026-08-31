/**
 * @fileoverview 定时提醒工具
 * @module mcp/tools/reminder
 * @description 支持设置定时提醒，到时间后自动发送消息
 */

import schedule from 'node-schedule'
import { chatLogger as logger } from '../../core/utils/logger.js'
import { StandardBotApi, StandardMessage } from '../../core/platform/index.js'

/** @type {Map<string, {job: schedule.Job, info: Object}>} */
const reminders = new Map()

/** @type {number} */
let reminderIdCounter = 1

/**
 * 解析时间表达式
 * @param {string} timeStr - 时间字符串，支持多种格式
 * @returns {{date: Date|null, cronExpr: string|null, type: string}}
 */
function parseTimeExpression(timeStr) {
    const now = new Date()

    // 相对时间: "5分钟后", "1小时后", "30秒后"
    const relativeMatch = timeStr.match(/^(\d+)(秒|分钟?|小时|天)后?$/i)
    if (relativeMatch) {
        const amount = parseInt(relativeMatch[1])
        const unit = relativeMatch[2]
        const date = new Date(now)

        switch (unit) {
            case '秒':
                date.setSeconds(date.getSeconds() + amount)
                break
            case '分':
            case '分钟':
                date.setMinutes(date.getMinutes() + amount)
                break
            case '小时':
                date.setHours(date.getHours() + amount)
                break
            case '天':
                date.setDate(date.getDate() + amount)
                break
        }
        return { date, cronExpr: null, type: 'once' }
    }

    // 绝对时间: "14:30", "2024-01-15 14:30"
    const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/)
    if (timeMatch) {
        const date = new Date(now)
        date.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0)
        if (date <= now) {
            date.setDate(date.getDate() + 1) // 如果今天已过，设为明天
        }
        return { date, cronExpr: null, type: 'once' }
    }

    // 完整日期时间: "2024-01-15 14:30"
    const dateTimeMatch = timeStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})$/)
    if (dateTimeMatch) {
        const date = new Date(
            parseInt(dateTimeMatch[1]),
            parseInt(dateTimeMatch[2]) - 1,
            parseInt(dateTimeMatch[3]),
            parseInt(dateTimeMatch[4]),
            parseInt(dateTimeMatch[5])
        )
        return { date, cronExpr: null, type: 'once' }
    }

    // 每天: "每天14:30"
    const dailyMatch = timeStr.match(/^每天\s*(\d{1,2}):(\d{2})$/)
    if (dailyMatch) {
        const cronExpr = `${parseInt(dailyMatch[2])} ${parseInt(dailyMatch[1])} * * *`
        return { date: null, cronExpr, type: 'daily' }
    }

    // 每周: "每周一14:30"
    const weeklyMatch = timeStr.match(/^每周([一二三四五六日天])\s*(\d{1,2}):(\d{2})$/)
    if (weeklyMatch) {
        const dayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
        const dayNum = dayMap[weeklyMatch[1]]
        const cronExpr = `${parseInt(weeklyMatch[3])} ${parseInt(weeklyMatch[2])} * * ${dayNum}`
        return { date: null, cronExpr, type: 'weekly' }
    }

    return { date: null, cronExpr: null, type: 'invalid' }
}

/**
 * 格式化剩余时间
 * @param {Date} targetDate - 目标时间
 * @returns {string}
 */
function formatTimeRemaining(targetDate) {
    const now = new Date()
    const diff = targetDate.getTime() - now.getTime()

    if (diff <= 0) return '即将触发'

    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)

    if (days > 0) return `${days}天${hours % 24}小时后`
    if (hours > 0) return `${hours}小时${minutes % 60}分钟后`
    if (minutes > 0) return `${minutes}分钟后`
    return `${seconds}秒后`
}

export const reminderTools = [
    {
        name: 'set_reminder',
        description:
            '设置定时提醒。支持相对时间（如"5分钟后"）、绝对时间（如"14:30"）、每天重复（如"每天14:30"）、每周重复（如"每周一14:30"）',
        inputSchema: {
            type: 'object',
            properties: {
                time: {
                    type: 'string',
                    description:
                        '提醒时间。支持格式：相对时间（5分钟后、1小时后、30秒后）、绝对时间（14:30、2024-01-15 14:30）、重复（每天14:30、每周一14:30）'
                },
                message: {
                    type: 'string',
                    description: '提醒消息内容'
                },
                target: {
                    type: 'string',
                    description: '提醒目标：user（仅提醒发起者）或 group（群内提醒）',
                    enum: ['user', 'group'],
                    default: 'user'
                }
            },
            required: ['time', 'message']
        },
        handler: async (params, context) => {
            const { time, message, target = 'user' } = params
            const e = context?.event

            if (!e) {
                return { success: false, message: '无法获取事件上下文' }
            }

            const parsed = parseTimeExpression(time)
            if (parsed.type === 'invalid') {
                return {
                    success: false,
                    message: `无法解析时间格式"${time}"。支持格式：5分钟后、14:30、2024-01-15 14:30、每天14:30、每周一14:30`
                }
            }

            const reminderId = `reminder_${reminderIdCounter++}`
            const userId = e.user_id?.toString()
            const groupId = e.group_id?.toString()
            const nickname = e.sender?.card || e.sender?.nickname || '用户'

            const reminderInfo = {
                id: reminderId,
                time: time,
                message: message,
                target: target,
                userId: userId,
                groupId: groupId,
                nickname: nickname,
                type: parsed.type,
                status: 'scheduled',
                createdAt: new Date().toISOString()
            }

            const sendReminder = async () => {
                try {
                    const api = new StandardBotApi({ event: e })
                    const targetUserId = api.targetId(userId)
                    const targetGroupId = api.targetId(groupId)
                    const atUser = StandardMessage.at(targetUserId)
                    const reminderText = `⏰ 提醒：${message}`

                    if (target === 'group' && targetGroupId) {
                        await api.sendGroup(targetGroupId, [atUser, ' ', reminderText])
                    } else if (targetUserId) {
                        try {
                            await api.sendPrivate(targetUserId, reminderText)
                        } catch (error) {
                            if (!targetGroupId || error?.code !== 'UNSUPPORTED_BOT_API') throw error
                            await api.sendGroup(targetGroupId, [atUser, ' ', reminderText])
                        }
                    } else {
                        throw new Error('提醒缺少有效目标')
                    }

                    // 只有确认发送成功后才删除一次性提醒。
                    if (parsed.type === 'once') reminders.delete(reminderId)
                } catch (error) {
                    const entry = reminders.get(reminderId)
                    if (entry) {
                        entry.info.status = 'failed'
                        entry.info.failedAt = new Date().toISOString()
                        entry.info.lastError = error.message
                    }
                    logger.error(`[Reminder] 发送提醒失败，已标记为 failed: ${error.message}`)
                }
            }

            let job
            if (parsed.date) {
                // 一次性提醒
                job = schedule.scheduleJob(parsed.date, sendReminder)
            } else if (parsed.cronExpr) {
                // 重复提醒
                job = schedule.scheduleJob(parsed.cronExpr, sendReminder)
            }

            if (!job) {
                return { success: false, message: '创建提醒任务失败' }
            }

            reminders.set(reminderId, { job, info: reminderInfo })

            let responseText = `✅ 提醒已设置！\n`
            responseText += `📝 内容：${message}\n`
            if (parsed.date) {
                responseText += `⏰ 时间：${parsed.date.toLocaleString('zh-CN')}（${formatTimeRemaining(parsed.date)}）`
            } else {
                responseText += `🔄 重复：${parsed.type === 'daily' ? '每天' : '每周'} ${time.replace(/^每[天周][一二三四五六日天]?\s*/, '')}`
            }

            return { success: true, message: responseText, reminderId }
        }
    },
    {
        name: 'list_reminders',
        description: '查看当前用户的所有提醒',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (params, context) => {
            const e = context?.event
            const userId = e?.user_id?.toString()
            const groupId = e?.group_id?.toString()

            const userReminders = []
            for (const { info } of reminders.values()) {
                if (info.userId === userId || (info.groupId === groupId && info.target === 'group')) {
                    userReminders.push(info)
                }
            }

            if (userReminders.length === 0) {
                return { success: true, message: '📭 当前没有设置任何提醒', reminders: [] }
            }

            let responseText = `📋 你的提醒列表（共${userReminders.length}个）：\n\n`
            for (const info of userReminders) {
                responseText += `🔔 ${info.id}\n`
                responseText += `   内容：${info.message}\n`
                responseText += `   时间：${info.time}\n`
                responseText += `   类型：${info.type === 'once' ? '一次性' : info.type === 'daily' ? '每天' : '每周'}\n`
                responseText += `   状态：${info.status || 'scheduled'}${info.lastError ? `（${info.lastError}）` : ''}\n\n`
            }

            return {
                success: true,
                message: responseText.trim(),
                reminders: userReminders,
                active: userReminders.filter(info => info.status !== 'failed'),
                failed: userReminders.filter(info => info.status === 'failed')
            }
        }
    },
    {
        name: 'cancel_reminder',
        description: '取消指定的提醒',
        inputSchema: {
            type: 'object',
            properties: {
                reminderId: {
                    type: 'string',
                    description: '要取消的提醒ID（如 reminder_1）'
                }
            },
            required: ['reminderId']
        },
        handler: async (params, context) => {
            const { reminderId } = params
            const e = context?.event
            const userId = e?.user_id?.toString()

            const reminder = reminders.get(reminderId)
            if (!reminder) {
                return { success: false, message: `❌ 未找到提醒 ${reminderId}` }
            }

            // 检查权限
            if (reminder.info.userId !== userId && !e?.isMaster) {
                return { success: false, message: '❌ 你只能取消自己设置的提醒' }
            }

            reminder.job.cancel()
            reminders.delete(reminderId)

            return { success: true, message: `✅ 已取消提醒：${reminder.info.message}` }
        }
    }
]

export default reminderTools
