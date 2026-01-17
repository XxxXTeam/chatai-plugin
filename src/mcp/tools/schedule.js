/**
 * 定时任务工具
 * 工具层 - 仅提供MCP工具接口，具体实现委托给服务层
 */

import { chatLogger } from '../../core/utils/logger.js'
import { proactiveChatService } from '../../services/scheduler/ProactiveChatService.js'
import { taskSchedulerService } from '../../services/scheduler/TaskSchedulerService.js'
import { executeTaskAction } from '../../services/scheduler/TaskExecutor.js'

const logger = chatLogger
let initialized = false
const scheduledTasks = taskSchedulerService.getTasksMap()
const proactiveChatStats = proactiveChatService.stats
function getProactiveChatConfig() {
    return proactiveChatService.getConfig()
}

async function getMergedProactiveChatConfig(groupId) {
    return proactiveChatService.getMergedConfig(groupId)
}

async function getGroupProactiveChatSettings(groupId) {
    return proactiveChatService.getGroupSettings(groupId)
}

async function proactiveChatPoll() {
    return proactiveChatService.poll()
}

async function saveTasks() {
    return taskSchedulerService.saveTasks()
}

async function loadTasks() {
    return taskSchedulerService.loadTasks()
}

async function scanAndExecuteTasks() {
    return taskSchedulerService.scanAndExecute()
}

function parseInterval(intervalStr) {
    return taskSchedulerService.parseInterval(intervalStr)
}

function parseDuration(durationStr) {
    return taskSchedulerService.parseInterval(durationStr)
}

function formatInterval(ms) {
    return taskSchedulerService.formatInterval(ms)
}

function formatTime(timestamp) {
    return taskSchedulerService.formatTime(timestamp)
}

/**
 * 初始化定时任务调度器
 */
async function initScheduler() {
    if (initialized) return
    await taskSchedulerService.init()
    await proactiveChatService.init()
    setTimeout(() => {
        proactiveChatService.startPolling()
    }, 10000)

    initialized = true
    logger.info('[ScheduleTools] 定时任务调度器已启动')
}

/**
 * 执行任务 - 委托给 TaskExecutor
 */
async function executeTask(task) {
    const bot = taskSchedulerService.getBot()
    if (!bot) {
        throw new Error('Bot实例不可用')
    }
    await executeTaskAction(task, bot, { logger })
}

/**
 * 生成任务ID - 委托给服务
 */
function generateTaskId() {
    return taskSchedulerService.generateTaskId()
}

// 确保调度器启动
initScheduler()

/**
 * 定时任务工具集合
 */
export const scheduleTools = [
    {
        name: 'create_scheduled_task',
        description: '创建定时任务。支持链式操作：随机用户->工具调用->AI对话等。',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '任务名称，用于标识任务'
                },
                interval: {
                    type: 'string',
                    description: "执行间隔，如 '10m'(10分钟)、'1h'(1小时)、'30s'(30秒)、'1d'(1天)"
                },
                action_type: {
                    type: 'string',
                    description:
                        "操作类型：'at'|'message'|'ai_chat'|'at_then_ai'(先@用户再AI回复)|'tool_call'|'chain'(链式操作)",
                    enum: ['at', 'message', 'ai_chat', 'at_then_ai', 'tool_call', 'mixed', 'chain']
                },
                target_qq: {
                    type: 'string',
                    description: '目标用户QQ号（at操作时使用，可用{{random_user}}表示随机用户）'
                },
                content: {
                    type: 'string',
                    description: '消息内容或AI提示词。支持模板变量：{{random_user}}随机用户、{{results.last}}上一步结果'
                },
                tool_name: {
                    type: 'string',
                    description: '要调用的工具名称（tool_call类型时必填）'
                },
                tool_args: {
                    type: 'object',
                    description: '工具参数'
                },
                steps: {
                    type: 'array',
                    description:
                        "链式操作步骤数组（chain类型时使用）。每步支持类型：'random_user'(随机选用户)、'tool'(调用工具)、'at'、'message'、'ai_chat'、'delay'(延迟)、'set'(设置变量)。步骤结果可通过{{results.step0}}、{{results.last}}、{{random_user}}等引用",
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', description: '步骤类型' },
                            name: { type: 'string', description: '工具名(tool类型)' },
                            args: { type: 'object', description: '工具参数' },
                            target_qq: { type: 'string', description: '@目标' },
                            content: { type: 'string', description: '内容/提示词' },
                            count: { type: 'integer', description: '随机用户数量' },
                            exclude: { type: 'array', description: '排除的QQ' },
                            ms: { type: 'integer', description: '延迟毫秒' }
                        }
                    }
                },
                then_action: {
                    type: 'object',
                    description: '（兼容旧格式）混合操作后续动作'
                },
                max_executions: {
                    type: 'integer',
                    description: '最大执行次数，0或不填表示无限制'
                },
                duration: {
                    type: 'string',
                    description: "任务持续时间，超过后自动删除，如 '1h'、'1d'、'7d'，不填表示永久"
                },
                enabled: {
                    type: 'boolean',
                    description: '是否立即启用，默认true'
                },
                group_id: {
                    type: 'string',
                    description: '群ID（无上下文时必填）'
                },
                creator_id: {
                    type: 'string',
                    description: '创建者QQ（无上下文时必填）'
                }
            },
            required: ['name', 'interval', 'action_type']
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()

            const {
                name,
                interval,
                action_type,
                target_qq,
                content,
                tool_name,
                tool_args,
                steps,
                then_action,
                max_executions,
                duration,
                enabled = true,
                group_id,
                creator_id
            } = args

            // 验证参数
            if (!name?.trim()) return { error: '任务名称不能为空' }

            const intervalMs = parseInterval(interval)
            if (intervalMs < 30 * 1000) {
                return { error: '执行间隔不能小于30秒' }
            }
            if (intervalMs > 30 * 24 * 60 * 60 * 1000) {
                return { error: '执行间隔不能超过30天' }
            }

            // 支持从参数或上下文获取群ID和创建者ID
            const creatorId = creator_id || String(e?.user_id || e?.sender?.user_id || '')
            const groupId = group_id || (e?.group_id ? String(e.group_id) : null)

            if (!creatorId) {
                return { error: '无法获取创建者ID，请提供creator_id参数' }
            }
            if (!groupId) {
                return { error: '定时任务仅支持在群内创建，请提供group_id参数' }
            }

            // tool_call类型必须指定工具名
            if (action_type === 'tool_call' && !tool_name) {
                return { error: 'tool_call类型必须指定tool_name' }
            }

            // chain类型必须有steps
            if (action_type === 'chain' && (!steps || steps.length === 0)) {
                return { error: 'chain类型必须指定steps数组' }
            }

            // 检查重复任务
            for (const task of scheduledTasks.values()) {
                if (task.name === name && task.creatorId === creatorId && task.groupId === groupId) {
                    return { error: `已存在同名任务 "${name}"，请先删除或使用其他名称` }
                }
            }

            const taskId = generateTaskId()
            const now = Date.now()

            // 构建action对象
            const action = {
                type: action_type,
                targetQQ: target_qq || creatorId,
                content: content || ''
            }

            // tool_call类型添加工具信息
            if (action_type === 'tool_call') {
                action.toolName = tool_name
                action.toolArgs = tool_args || {}
            }

            // chain类型添加步骤数组
            if (action_type === 'chain' || action_type === 'mixed') {
                action.steps = steps || []
                // 兼容mixed旧格式
                if (action_type === 'mixed' && tool_name) {
                    action.toolName = tool_name
                    action.toolArgs = tool_args || {}
                    if (then_action) {
                        action.thenAction = {
                            type: then_action.type || 'message',
                            targetQQ: then_action.target_qq || creatorId,
                            content: then_action.content || ''
                        }
                    }
                }
            }

            const task = {
                id: taskId,
                name: name.trim(),
                creatorId,
                groupId,
                type: 'interval',
                intervalMs,
                action,
                maxExecutions: max_executions || 0,
                executedCount: 0,
                expireAt: duration ? now + parseDuration(duration) : 0,
                nextRunAt: now + intervalMs,
                lastRunAt: null,
                createdAt: now,
                enabled,
                metadata: {}
            }

            scheduledTasks.set(taskId, task)

            // 保存任务到文件
            await saveTasks()

            logger.info(`[ScheduleTools] 创建任务: ${taskId} (${name}) by ${creatorId} in group ${groupId}`)

            // 生成操作描述
            let actionDescText = ''
            if (action_type === 'chain' && steps?.length > 0) {
                const stepTypes = steps.map(s => s.type).join(' -> ')
                actionDescText = `链式操作: ${stepTypes}`
            } else {
                const actionDesc = {
                    at: `@${target_qq || creatorId}${content ? ' 并说: ' + content.slice(0, 20) : ''}`,
                    message: `发送消息: ${(content || '').slice(0, 30)}`,
                    ai_chat: `触发AI对话: ${(content || '').slice(0, 30)}`,
                    at_then_ai: `@${target_qq || creatorId} + AI回复(${(content || '打个招呼').slice(0, 20)})`,
                    tool_call: `调用工具: ${tool_name}`,
                    mixed: `调用${tool_name} -> ${then_action?.type || '无后续操作'}`
                }
                actionDescText = actionDesc[action_type] || action_type
            }

            return {
                success: true,
                task_id: taskId,
                name: task.name,
                group_id: groupId,
                message: `定时任务创建成功`,
                details: {
                    interval: formatInterval(intervalMs),
                    action: actionDescText,
                    steps_count: steps?.length || 0,
                    max_executions: max_executions || '无限制',
                    expire_at: task.expireAt ? formatTime(task.expireAt) : '永不过期',
                    next_run: formatTime(task.nextRunAt),
                    enabled
                }
            }
        }
    },

    {
        name: 'list_scheduled_tasks',
        description: '列出当前用户创建的所有定时任务，或指定群的所有定时任务',
        inputSchema: {
            type: 'object',
            properties: {
                show_all: {
                    type: 'boolean',
                    description: '是否显示当前群/私聊的所有任务（而不仅是自己创建的）'
                },
                group_id: {
                    type: 'string',
                    description: '群ID（无上下文时使用）'
                },
                user_id: {
                    type: 'string',
                    description: '用户QQ（无上下文时使用）'
                }
            }
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()

            const { show_all = false, group_id, user_id } = args
            const userId = user_id || String(e?.user_id || e?.sender?.user_id || '')
            const groupId = group_id || (e?.group_id ? String(e.group_id) : null)

            const tasks = []
            for (const task of scheduledTasks.values()) {
                // 筛选条件
                if (show_all) {
                    // 显示当前群/私聊的所有任务
                    if (groupId && task.groupId !== groupId) continue
                    if (!groupId && task.creatorId !== userId) continue
                } else {
                    // 只显示自己创建的任务
                    if (task.creatorId !== userId) continue
                }

                let actionText = ''
                if (task.action.type === 'chain' && task.action.steps?.length > 0) {
                    actionText = `链:${task.action.steps.map(s => s.type).join('→')}`
                } else {
                    const actionDesc = {
                        at: `@${task.action.targetQQ}`,
                        message: '发消息',
                        ai_chat: 'AI对话',
                        tool_call: `工具:${task.action.toolName || '?'}`,
                        mixed:
                            task.action.steps?.length > 0
                                ? `链:${task.action.steps.map(s => s.type).join('→')}`
                                : `${task.action.toolName || '?'}→${task.action.thenAction?.type || '?'}`
                    }
                    actionText = actionDesc[task.action.type] || task.action.type
                }

                tasks.push({
                    id: task.id,
                    name: task.name,
                    group: task.groupId,
                    action: actionText,
                    interval: formatInterval(task.intervalMs),
                    executed: task.executedCount,
                    max: task.maxExecutions || '∞',
                    next_run: formatTime(task.nextRunAt),
                    enabled: task.enabled ? '✓' : '✗',
                    creator: task.creatorId
                })
            }

            if (tasks.length === 0) {
                return {
                    success: true,
                    message: '暂无定时任务',
                    tasks: []
                }
            }

            return {
                success: true,
                total: tasks.length,
                tasks,
                hint: '使用 delete_scheduled_task 删除任务，使用 modify_scheduled_task 修改任务'
            }
        }
    },

    {
        name: 'delete_scheduled_task',
        description: '删除指定的定时任务',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: {
                    type: 'string',
                    description: '任务ID'
                },
                task_name: {
                    type: 'string',
                    description: '任务名称（如果不知道ID，可以用名称删除）'
                },
                user_id: {
                    type: 'string',
                    description: '用户QQ（无上下文时使用）'
                }
            }
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()

            const { task_id, task_name, user_id } = args
            const userId = user_id || String(e?.user_id || e?.sender?.user_id || '')

            if (!task_id && !task_name) {
                return { error: '请提供任务ID或任务名称' }
            }

            let taskToDelete = null

            if (task_id) {
                taskToDelete = scheduledTasks.get(task_id)
            } else if (task_name) {
                // 按名称查找（优先匹配当前用户创建的）
                for (const task of scheduledTasks.values()) {
                    if (task.name === task_name) {
                        if (task.creatorId === userId) {
                            taskToDelete = task
                            break
                        }
                        if (!taskToDelete) taskToDelete = task
                    }
                }
            }

            if (!taskToDelete) {
                return { error: `未找到任务 ${task_id || task_name}` }
            }

            // 权限检查：只能删除自己创建的任务
            if (taskToDelete.creatorId !== userId) {
                return { error: '只能删除自己创建的任务' }
            }

            scheduledTasks.delete(taskToDelete.id)
            await saveTasks()
            logger.info(`[ScheduleTools] 删除任务: ${taskToDelete.id} (${taskToDelete.name}) by ${userId}`)

            return {
                success: true,
                message: `已删除任务 "${taskToDelete.name}"`,
                deleted_task: {
                    id: taskToDelete.id,
                    name: taskToDelete.name,
                    executed_count: taskToDelete.executedCount
                }
            }
        }
    },

    {
        name: 'modify_scheduled_task',
        description: '修改定时任务的配置',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: {
                    type: 'string',
                    description: '任务ID'
                },
                task_name: {
                    type: 'string',
                    description: '任务名称（如果不知道ID，可以用名称查找）'
                },
                new_name: {
                    type: 'string',
                    description: '新的任务名称'
                },
                interval: {
                    type: 'string',
                    description: "新的执行间隔，如 '10m'、'1h'"
                },
                target_qq: {
                    type: 'string',
                    description: '新的目标QQ'
                },
                content: {
                    type: 'string',
                    description: '新的消息内容或AI提示词'
                },
                max_executions: {
                    type: 'integer',
                    description: '新的最大执行次数'
                },
                enabled: {
                    type: 'boolean',
                    description: '是否启用'
                },
                reset_count: {
                    type: 'boolean',
                    description: '是否重置执行计数'
                },
                user_id: {
                    type: 'string',
                    description: '用户QQ（无上下文时使用）'
                }
            }
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()

            const {
                task_id,
                task_name,
                new_name,
                interval,
                target_qq,
                content,
                max_executions,
                enabled,
                reset_count,
                user_id
            } = args
            const userId = user_id || String(e?.user_id || e?.sender?.user_id || '')

            if (!task_id && !task_name) {
                return { error: '请提供任务ID或任务名称' }
            }

            let task = null
            if (task_id) {
                task = scheduledTasks.get(task_id)
            } else if (task_name) {
                for (const t of scheduledTasks.values()) {
                    if (t.name === task_name && t.creatorId === userId) {
                        task = t
                        break
                    }
                }
            }

            if (!task) {
                return { error: `未找到任务 ${task_id || task_name}` }
            }

            if (task.creatorId !== userId) {
                return { error: '只能修改自己创建的任务' }
            }

            const changes = []

            if (new_name && new_name !== task.name) {
                task.name = new_name.trim()
                changes.push(`名称 -> ${new_name}`)
            }

            if (interval) {
                const newIntervalMs = parseInterval(interval)
                if (newIntervalMs >= 30 * 1000 && newIntervalMs <= 30 * 24 * 60 * 60 * 1000) {
                    task.intervalMs = newIntervalMs
                    task.nextRunAt = Date.now() + newIntervalMs
                    changes.push(`间隔 -> ${formatInterval(newIntervalMs)}`)
                }
            }

            if (target_qq) {
                task.action.targetQQ = target_qq
                changes.push(`目标 -> ${target_qq}`)
            }

            if (content !== undefined) {
                task.action.content = content
                changes.push(`内容已更新`)
            }

            if (max_executions !== undefined) {
                task.maxExecutions = max_executions
                changes.push(`最大次数 -> ${max_executions || '无限制'}`)
            }

            if (enabled !== undefined) {
                task.enabled = enabled
                changes.push(enabled ? '已启用' : '已禁用')
            }

            if (reset_count) {
                task.executedCount = 0
                changes.push('计数已重置')
            }

            if (changes.length === 0) {
                return { success: true, message: '没有需要修改的内容' }
            }

            await saveTasks()
            logger.info(`[ScheduleTools] 修改任务: ${task.id} - ${changes.join(', ')}`)

            return {
                success: true,
                message: `任务 "${task.name}" 已修改`,
                changes,
                task: {
                    id: task.id,
                    name: task.name,
                    interval: formatInterval(task.intervalMs),
                    next_run: formatTime(task.nextRunAt),
                    enabled: task.enabled
                }
            }
        }
    },

    {
        name: 'get_scheduled_task_info',
        description: '获取指定定时任务的详细信息',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: {
                    type: 'string',
                    description: '任务ID'
                },
                task_name: {
                    type: 'string',
                    description: '任务名称'
                }
            }
        },
        handler: async (args, ctx) => {
            const { task_id, task_name } = args

            if (!task_id && !task_name) {
                return { error: '请提供任务ID或任务名称' }
            }

            let task = null
            if (task_id) {
                task = scheduledTasks.get(task_id)
            } else if (task_name) {
                for (const t of scheduledTasks.values()) {
                    if (t.name === task_name) {
                        task = t
                        break
                    }
                }
            }

            if (!task) {
                return { error: `未找到任务 ${task_id || task_name}` }
            }

            const actionDesc = {
                at: `@${task.action.targetQQ}${task.action.content ? ' + ' + task.action.content : ''}`,
                message: task.action.content || '(空消息)',
                ai_chat: `AI提示词: ${task.action.content || '(空)'}`,
                tool_call: `调用工具: ${task.action.toolName}(${JSON.stringify(task.action.toolArgs || {})})`,
                mixed: `调用${task.action.toolName} -> ${task.action.thenAction?.type || '无'}(${task.action.thenAction?.content?.slice(0, 30) || ''})`
            }

            return {
                success: true,
                task: {
                    id: task.id,
                    name: task.name,
                    creator: task.creatorId,
                    group: task.groupId,
                    type: task.type,
                    action: {
                        type: task.action.type,
                        description: actionDesc[task.action.type] || task.action.type,
                        ...(task.action.toolName && {
                            tool_name: task.action.toolName,
                            tool_args: task.action.toolArgs
                        }),
                        ...(task.action.thenAction && { then_action: task.action.thenAction })
                    },
                    interval: formatInterval(task.intervalMs),
                    executed_count: task.executedCount,
                    max_executions: task.maxExecutions || '无限制',
                    expire_at: task.expireAt ? formatTime(task.expireAt) : '永不过期',
                    next_run: formatTime(task.nextRunAt),
                    last_run: task.lastRunAt ? formatTime(task.lastRunAt) : '从未执行',
                    created_at: formatTime(task.createdAt),
                    enabled: task.enabled
                }
            }
        }
    },

    {
        name: 'trigger_scheduled_task',
        description: '立即触发执行一个定时任务（不影响正常调度）',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: {
                    type: 'string',
                    description: '任务ID'
                },
                task_name: {
                    type: 'string',
                    description: '任务名称'
                },
                user_id: {
                    type: 'string',
                    description: '用户QQ（无上下文时使用，用于权限验证）'
                },
                skip_permission: {
                    type: 'boolean',
                    description: '跳过权限检查（测试用）'
                }
            }
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()

            const { task_id, task_name, user_id, skip_permission } = args
            const userId = user_id || String(e?.user_id || e?.sender?.user_id || '')

            if (!task_id && !task_name) {
                return { error: '请提供任务ID或任务名称' }
            }

            let task = null
            if (task_id) {
                task = scheduledTasks.get(task_id)
            } else if (task_name) {
                // 按名称查找
                for (const t of scheduledTasks.values()) {
                    if (t.name === task_name) {
                        if (userId && t.creatorId === userId) {
                            task = t
                            break
                        }
                        if (!task) task = t
                    }
                }
            }

            if (!task) {
                return { error: `未找到任务 ${task_id || task_name}` }
            }

            // 权限检查（可跳过用于测试）
            if (!skip_permission && userId && task.creatorId !== userId) {
                return { error: '只能触发自己创建的任务' }
            }

            logger.info(`[ScheduleTools] 手动触发任务: ${task.id} (${task.name}), action: ${task.action.type}`)

            try {
                await executeTask(task)
                // 手动触发不计入执行次数，但记录时间
                task.lastRunAt = Date.now()

                logger.info(`[ScheduleTools] 手动触发任务完成: ${task.id}`)

                return {
                    success: true,
                    message: `任务 "${task.name}" 已手动触发执行`,
                    task_info: {
                        action_type: task.action.type,
                        group_id: task.groupId,
                        content: task.action.content?.slice(0, 50)
                    },
                    executed_at: formatTime(Date.now())
                }
            } catch (err) {
                logger.error(`[ScheduleTools] 手动触发任务失败: ${task.id}`, err.message)
                return { error: `执行失败: ${err.message}` }
            }
        }
    }
]

export {
    scheduledTasks,
    initScheduler,
    scanAndExecuteTasks,
    parseInterval,
    parseDuration,
    saveTasks,
    loadTasks,
    proactiveChatStats,
    proactiveChatPoll,
    getProactiveChatConfig,
    getMergedProactiveChatConfig,
    getGroupProactiveChatSettings
}
