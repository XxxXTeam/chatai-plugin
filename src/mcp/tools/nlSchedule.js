import { nlSchedulerService } from '../../services/scheduler/NLSchedulerService.js'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

// 确保服务初始化
nlSchedulerService.init().catch(err => {
    logger.warn('[NLScheduleTools] 初始化失败:', err.message)
})

export const nlScheduleTools = [
    {
        name: 'schedule_task',
        description: `创建定时任务。当用户说"X分钟/小时后做某事"时使用此工具。
支持的时间格式：
- 相对时间：5分钟后、1小时后、30秒后、2天后
- 绝对时间：明天早上8点、今天下午3点、后天晚上9点30分
示例：
- "5分钟后提醒我开会" -> time="5分钟后", task="提醒开会"
- "明天早上8点叫我起床" -> time="明天早上8点", task="叫起床"
- "@某人 1小时后发一首歌" -> time="1小时后", task="发一首歌", target_qq="某人的QQ"`,
        inputSchema: {
            type: 'object',
            properties: {
                time: {
                    type: 'string',
                    description: '时间表达式，如"5分钟后"、"明天早上8点"、"1小时后"'
                },
                task: {
                    type: 'string',
                    description: '要执行的任务内容，如"发一首周杰伦的歌"、"提醒开会"'
                },
                target_qq: {
                    type: 'string',
                    description: '可选，目标用户QQ号（当任务是针对特定用户时）'
                },
                target_name: {
                    type: 'string',
                    description: '可选，目标用户昵称'
                }
            },
            required: ['time', 'task']
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()
            const { time, task, target_qq, target_name } = args

            const groupId = e?.group_id ? String(e.group_id) : null
            const creatorId = String(e?.user_id || e?.sender?.user_id || '')
            const creatorName = e?.sender?.card || e?.sender?.nickname || ''

            if (!groupId) {
                return { error: '定时任务仅支持在群内使用' }
            }

            if (!creatorId) {
                return { error: '无法获取用户信息' }
            }

            const result = nlSchedulerService.createTask({
                timeText: time,
                taskContent: task,
                groupId,
                creatorId,
                creatorName,
                targetId: target_qq,
                targetName: target_name
            })

            if (!result.success) {
                return { error: result.error }
            }

            const executeTime = new Date(result.executeAt).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            })

            return {
                success: true,
                message: `好的，${result.remaining}后（${executeTime}）我会${task}`,
                task_id: result.taskId,
                execute_at: executeTime,
                remaining: result.remaining
            }
        }
    },

    {
        name: 'cancel_scheduled_task',
        description: '取消定时任务',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: {
                    type: 'string',
                    description: '任务ID'
                }
            },
            required: ['task_id']
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()
            const { task_id } = args
            const userId = String(e?.user_id || e?.sender?.user_id || '')

            const result = nlSchedulerService.cancelTask(task_id, userId)

            if (!result.success) {
                return { error: result.error }
            }

            return {
                success: true,
                message: `已取消任务：${result.task.content}`
            }
        }
    },

    {
        name: 'list_my_scheduled_tasks',
        description: '列出我的定时任务',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()
            const userId = String(e?.user_id || e?.sender?.user_id || '')
            const groupId = e?.group_id ? String(e.group_id) : null

            const tasks = nlSchedulerService.listTasks(userId, groupId)

            if (tasks.length === 0) {
                return {
                    success: true,
                    message: '你目前没有待执行的定时任务',
                    tasks: []
                }
            }

            const taskList = tasks.map(t => ({
                id: t.id,
                content: t.content,
                time: t.timeDescription,
                remaining: t.remaining,
                target: t.targetName || null
            }))

            return {
                success: true,
                total: tasks.length,
                tasks: taskList
            }
        }
    }
]

export default nlScheduleTools
