/**
 * 定时任务调度服务 - 处理用户创建的定时任务
 * 独立于工具文件，提供统一的任务管理接口
 */
import { chatLogger } from '../../core/utils/logger.js'
import crypto from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const logger = chatLogger
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 持久化文件路径
const TASKS_FILE = path.join(__dirname, '../../../data/scheduled_tasks.json')

class TaskSchedulerService {
    constructor() {
        this.initialized = false
        // 任务存储 Map: taskId -> TaskInfo
        this.tasks = new Map()
        // 定时器存储
        this.taskTimers = new Map()
        // 扫描定时器
        this.scanInterval = null
    }

    /**
     * 初始化服务
     */
    async init() {
        if (this.initialized) return

        // 加载持久化的任务
        await this.loadTasks()

        // 每分钟扫描一次待执行的任务
        this.scanInterval = setInterval(() => {
            this.scanAndExecute().catch(err => {
                logger.warn('[TaskSchedulerService] 扫描任务失败:', err.message)
            })
        }, 60 * 1000)

        // 首次扫描延迟5秒
        setTimeout(() => {
            this.scanAndExecute().catch(err => {
                logger.warn('[TaskSchedulerService] 首次扫描失败:', err.message)
            })
        }, 5000)

        this.initialized = true
        logger.info('[TaskSchedulerService] 定时任务调度器已启动')
    }

    /**
     * 停止服务
     */
    stop() {
        if (this.scanInterval) {
            clearInterval(this.scanInterval)
            this.scanInterval = null
        }
        for (const timer of this.taskTimers.values()) {
            clearTimeout(timer)
        }
        this.taskTimers.clear()
        this.initialized = false
        logger.info('[TaskSchedulerService] 定时任务调度器已停止')
    }

    /**
     * 保存任务到文件
     */
    async saveTasks() {
        try {
            const tasksData = Array.from(this.tasks.values()).map(task => ({
                ...task,
                // 不保存回调函数
                action: {
                    ...task.action,
                    callback: undefined
                }
            }))
            const dir = path.dirname(TASKS_FILE)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            fs.writeFileSync(TASKS_FILE, JSON.stringify(tasksData, null, 2), 'utf-8')
            logger.debug(`[TaskSchedulerService] 已保存 ${tasksData.length} 个任务`)
        } catch (err) {
            logger.warn('[TaskSchedulerService] 保存任务失败:', err.message)
        }
    }

    /**
     * 从文件加载任务
     */
    async loadTasks() {
        try {
            if (!fs.existsSync(TASKS_FILE)) {
                logger.debug('[TaskSchedulerService] 任务文件不存在，跳过加载')
                return
            }
            const data = fs.readFileSync(TASKS_FILE, 'utf-8')
            const tasksData = JSON.parse(data)
            const now = Date.now()
            let loadedCount = 0
            let expiredCount = 0

            for (const task of tasksData) {
                // 跳过已过期的任务
                if (task.expireAt > 0 && now >= task.expireAt) {
                    expiredCount++
                    continue
                }
                // 跳过已达到最大执行次数的任务
                if (task.maxExecutions > 0 && task.executedCount >= task.maxExecutions) {
                    expiredCount++
                    continue
                }
                this.tasks.set(task.id, task)
                loadedCount++
            }

            logger.info(`[TaskSchedulerService] 已加载 ${loadedCount} 个任务，跳过 ${expiredCount} 个过期任务`)
        } catch (err) {
            logger.warn('[TaskSchedulerService] 加载任务失败:', err.message)
        }
    }

    /**
     * 生成任务ID
     */
    generateTaskId() {
        return crypto.randomUUID().slice(0, 8)
    }

    /**
     * 解析时间间隔字符串
     * @param {string} intervalStr - 如 '10m', '1h', '30s', '1d'
     * @returns {number} 毫秒数
     */
    parseInterval(intervalStr) {
        if (typeof intervalStr === 'number') return intervalStr

        const match = String(intervalStr).match(/^(\d+)\s*(s|m|h|d|秒|分|分钟|小时|天)?$/i)
        if (!match) return 0

        const value = parseInt(match[1])
        const unit = (match[2] || 'm').toLowerCase()

        const multipliers = {
            s: 1000,
            秒: 1000,
            m: 60 * 1000,
            分: 60 * 1000,
            分钟: 60 * 1000,
            h: 60 * 60 * 1000,
            小时: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            天: 24 * 60 * 60 * 1000
        }

        return value * (multipliers[unit] || 60 * 1000)
    }

    /**
     * 格式化时间间隔为人类可读
     */
    formatInterval(ms) {
        if (ms < 60 * 1000) return `${Math.round(ms / 1000)}秒`
        if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60000)}分钟`
        if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / 3600000)}小时`
        return `${Math.round(ms / 86400000)}天`
    }

    /**
     * 格式化时间戳
     */
    formatTime(timestamp) {
        if (!timestamp) return '未知'
        return new Date(timestamp).toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    /**
     * 创建任务
     * @param {Object} options - 任务配置
     * @returns {Object} 创建结果
     */
    async createTask(options) {
        const {
            name,
            interval,
            actionType,
            targetQQ,
            content,
            toolName,
            toolArgs,
            steps,
            thenAction,
            maxExecutions = 0,
            duration,
            enabled = true,
            groupId,
            creatorId
        } = options

        // 验证参数
        if (!name?.trim()) return { error: '任务名称不能为空' }

        const intervalMs = this.parseInterval(interval)
        if (intervalMs < 30 * 1000) {
            return { error: '执行间隔不能小于30秒' }
        }
        if (intervalMs > 30 * 24 * 60 * 60 * 1000) {
            return { error: '执行间隔不能超过30天' }
        }

        if (!creatorId) {
            return { error: '无法获取创建者ID' }
        }
        if (!groupId) {
            return { error: '定时任务仅支持在群内创建' }
        }

        // tool_call类型必须指定工具名
        if (actionType === 'tool_call' && !toolName) {
            return { error: 'tool_call类型必须指定tool_name' }
        }

        // chain类型必须有steps
        if (actionType === 'chain' && (!steps || steps.length === 0)) {
            return { error: 'chain类型必须指定steps数组' }
        }

        // 检查重复任务
        for (const task of this.tasks.values()) {
            if (task.name === name && task.creatorId === creatorId && task.groupId === groupId) {
                return { error: `已存在同名任务 "${name}"，请先删除或使用其他名称` }
            }
        }

        const taskId = this.generateTaskId()
        const now = Date.now()

        // 构建action对象
        const action = {
            type: actionType,
            targetQQ: targetQQ || creatorId,
            content: content || ''
        }

        // tool_call类型添加工具信息
        if (actionType === 'tool_call') {
            action.toolName = toolName
            action.toolArgs = toolArgs || {}
        }

        // chain类型添加步骤数组
        if (actionType === 'chain' || actionType === 'mixed') {
            action.steps = steps || []
            // 兼容mixed旧格式
            if (actionType === 'mixed' && toolName) {
                action.toolName = toolName
                action.toolArgs = toolArgs || {}
                if (thenAction) {
                    action.thenAction = {
                        type: thenAction.type || 'message',
                        targetQQ: thenAction.target_qq || creatorId,
                        content: thenAction.content || ''
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
            maxExecutions: maxExecutions || 0,
            executedCount: 0,
            expireAt: duration ? now + this.parseInterval(duration) : 0,
            nextRunAt: now + intervalMs,
            lastRunAt: null,
            createdAt: now,
            enabled,
            metadata: {}
        }

        this.tasks.set(taskId, task)
        await this.saveTasks()

        logger.info(`[TaskSchedulerService] 创建任务: ${taskId} (${name}) by ${creatorId} in group ${groupId}`)

        return {
            success: true,
            taskId,
            task
        }
    }

    /**
     * 删除任务
     * @param {string} taskId - 任务ID
     * @param {string} userId - 操作用户ID（权限验证）
     * @returns {Object} 删除结果
     */
    async deleteTask(taskId, userId) {
        const task = this.tasks.get(taskId)
        if (!task) {
            return { error: `未找到任务 ${taskId}` }
        }

        if (task.creatorId !== userId) {
            return { error: '只能删除自己创建的任务' }
        }

        this.tasks.delete(taskId)
        await this.saveTasks()
        logger.info(`[TaskSchedulerService] 删除任务: ${taskId} (${task.name}) by ${userId}`)

        return {
            success: true,
            deletedTask: task
        }
    }

    /**
     * 按名称删除任务
     * @param {string} taskName - 任务名称
     * @param {string} userId - 操作用户ID
     * @returns {Object} 删除结果
     */
    async deleteTaskByName(taskName, userId) {
        let taskToDelete = null
        for (const task of this.tasks.values()) {
            if (task.name === taskName) {
                if (task.creatorId === userId) {
                    taskToDelete = task
                    break
                }
                if (!taskToDelete) taskToDelete = task
            }
        }

        if (!taskToDelete) {
            return { error: `未找到任务 ${taskName}` }
        }

        return this.deleteTask(taskToDelete.id, userId)
    }

    /**
     * 修改任务
     * @param {string} taskId - 任务ID
     * @param {Object} updates - 要更新的字段
     * @param {string} userId - 操作用户ID
     * @returns {Object} 修改结果
     */
    async modifyTask(taskId, updates, userId) {
        const task = this.tasks.get(taskId)
        if (!task) {
            return { error: `未找到任务 ${taskId}` }
        }

        if (task.creatorId !== userId) {
            return { error: '只能修改自己创建的任务' }
        }

        const changes = []

        if (updates.name && updates.name !== task.name) {
            task.name = updates.name.trim()
            changes.push(`名称 -> ${updates.name}`)
        }

        if (updates.interval) {
            const newIntervalMs = this.parseInterval(updates.interval)
            if (newIntervalMs >= 30 * 1000 && newIntervalMs <= 30 * 24 * 60 * 60 * 1000) {
                task.intervalMs = newIntervalMs
                task.nextRunAt = Date.now() + newIntervalMs
                changes.push(`间隔 -> ${this.formatInterval(newIntervalMs)}`)
            }
        }

        if (updates.targetQQ) {
            task.action.targetQQ = updates.targetQQ
            changes.push(`目标 -> ${updates.targetQQ}`)
        }

        if (updates.content !== undefined) {
            task.action.content = updates.content
            changes.push(`内容已更新`)
        }

        if (updates.maxExecutions !== undefined) {
            task.maxExecutions = updates.maxExecutions
            changes.push(`最大次数 -> ${updates.maxExecutions || '无限制'}`)
        }

        if (updates.enabled !== undefined) {
            task.enabled = updates.enabled
            changes.push(updates.enabled ? '已启用' : '已禁用')
        }

        if (updates.resetCount) {
            task.executedCount = 0
            changes.push('计数已重置')
        }

        if (changes.length === 0) {
            return { success: true, message: '没有需要修改的内容' }
        }

        await this.saveTasks()
        logger.info(`[TaskSchedulerService] 修改任务: ${task.id} - ${changes.join(', ')}`)

        return {
            success: true,
            changes,
            task
        }
    }

    /**
     * 获取任务
     * @param {string} taskId - 任务ID
     * @returns {Object|null}
     */
    getTask(taskId) {
        return this.tasks.get(taskId) || null
    }

    /**
     * 按名称获取任务
     * @param {string} taskName - 任务名称
     * @param {string} userId - 优先匹配的用户ID
     * @returns {Object|null}
     */
    getTaskByName(taskName, userId = null) {
        let found = null
        for (const task of this.tasks.values()) {
            if (task.name === taskName) {
                if (userId && task.creatorId === userId) {
                    return task
                }
                if (!found) found = task
            }
        }
        return found
    }

    /**
     * 列出任务
     * @param {Object} filter - 过滤条件
     * @returns {Array}
     */
    listTasks(filter = {}) {
        const { userId, groupId, showAll = false } = filter
        const tasks = []

        for (const task of this.tasks.values()) {
            if (showAll) {
                if (groupId && task.groupId !== groupId) continue
                if (!groupId && task.creatorId !== userId) continue
            } else {
                if (task.creatorId !== userId) continue
            }
            tasks.push(task)
        }

        return tasks
    }

    /**
     * 扫描并执行到期任务
     */
    async scanAndExecute() {
        const now = Date.now()
        const tasksToExecute = []

        for (const [taskId, task] of this.tasks) {
            if (!task.enabled) continue

            // 检查是否过期
            if (task.expireAt > 0 && now >= task.expireAt) {
                logger.info(`[TaskSchedulerService] 任务 ${taskId} 已过期，自动删除`)
                this.tasks.delete(taskId)
                continue
            }

            // 检查执行次数
            if (task.maxExecutions > 0 && task.executedCount >= task.maxExecutions) {
                logger.info(`[TaskSchedulerService] 任务 ${taskId} 已达到最大执行次数，自动删除`)
                this.tasks.delete(taskId)
                continue
            }

            // 检查是否到达执行时间
            if (task.nextRunAt && task.nextRunAt <= now) {
                tasksToExecute.push(task)
            }
        }

        if (tasksToExecute.length === 0) return

        logger.debug(`[TaskSchedulerService] 发现 ${tasksToExecute.length} 个待执行任务`)

        // 并发执行任务
        let tasksChanged = false
        await Promise.allSettled(
            tasksToExecute.map(async task => {
                try {
                    await this.executeTask(task)
                    task.executedCount++
                    task.lastRunAt = now
                    tasksChanged = true

                    // 计算下次执行时间
                    if (task.type === 'interval') {
                        task.nextRunAt = now + task.intervalMs
                    } else if (task.type === 'once') {
                        // 单次任务执行后删除
                        this.tasks.delete(task.id)
                        logger.info(`[TaskSchedulerService] 单次任务 ${task.id} 执行完成，已删除`)
                    }

                    logger.debug(`[TaskSchedulerService] 任务 ${task.id} 执行成功`)
                } catch (err) {
                    logger.error(`[TaskSchedulerService] 任务 ${task.id} 执行失败:`, err.message)
                }
            })
        )

        // 保存任务状态
        if (tasksChanged) {
            await this.saveTasks()
        }
    }

    /**
     * 执行任务
     * @param {Object} task
     */
    async executeTask(task) {
        const { action, groupId, creatorId } = task

        logger.info(
            `[TaskSchedulerService] 开始执行任务: ${task.id} (${task.name}), 类型: ${action.type}, 群: ${groupId}`
        )

        // 获取Bot实例
        const bot = this.getBot()
        if (!bot) {
            logger.error('[TaskSchedulerService] Bot实例不可用，无法发送消息')
            throw new Error('Bot实例不可用，请确保机器人已登录')
        }

        // 动态导入执行器
        const { executeTaskAction } = await import('./TaskExecutor.js')
        await executeTaskAction(task, bot, { logger })
    }

    /**
     * 手动触发任务
     * @param {string} taskId - 任务ID
     * @param {string} userId - 操作用户ID
     * @returns {Object} 执行结果
     */
    async triggerTask(taskId, userId = null) {
        const task = this.tasks.get(taskId)
        if (!task) {
            return { error: `未找到任务 ${taskId}` }
        }

        if (userId && task.creatorId !== userId) {
            return { error: '只能触发自己创建的任务' }
        }

        logger.info(`[TaskSchedulerService] 手动触发任务: ${task.id} (${task.name})`)

        try {
            await this.executeTask(task)
            task.lastRunAt = Date.now()

            return {
                success: true,
                message: `任务 "${task.name}" 已手动触发执行`,
                executedAt: this.formatTime(Date.now())
            }
        } catch (err) {
            logger.error(`[TaskSchedulerService] 手动触发任务失败: ${task.id}`, err.message)
            return { error: `执行失败: ${err.message}` }
        }
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
     * 获取任务Map（用于兼容）
     */
    getTasksMap() {
        return this.tasks
    }
}

// 单例导出
export const taskSchedulerService = new TaskSchedulerService()
export default taskSchedulerService
