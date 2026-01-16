/**
 * 定时任务工具
 */

import { chatLogger } from '../../core/utils/logger.js'
import { segment } from '../../utils/messageParser.js'
import { icqqGroup, icqqFriend } from './helpers.js'
import crypto from 'crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const logger = chatLogger
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 任务存储 Map: taskId -> TaskInfo
const scheduledTasks = new Map()

// 定时器存储
const taskTimers = new Map()

// 扫描定时器
let scanInterval = null

// 主动聊天定时器
let proactiveChatInterval = null

// 是否已初始化
let initialized = false

// 主动聊天统计: groupId -> { lastTrigger: timestamp, dailyCount: number, date: string }
const proactiveChatStats = new Map()

// 群组设置缓存: groupId -> { settings, timestamp }
const groupSettingsCache = new Map()
const GROUP_SETTINGS_CACHE_TTL = 60 * 1000 // 缓存1分钟

// ScopeManager懒加载
let _scopeManager = null
async function getScopeManager() {
    if (!_scopeManager) {
        try {
            const { databaseService } = await import('../../services/storage/DatabaseService.js')
            const { getScopeManager: getSM } = await import('../../services/scope/ScopeManager.js')
            await databaseService.init()
            _scopeManager = getSM(databaseService)
            await _scopeManager.init()
        } catch (e) {
            logger.debug('[ProactiveChat] 加载ScopeManager失败:', e.message)
        }
    }
    return _scopeManager
}

/**
 * 获取群组主动聊天设置（带缓存）
 * @param {string} groupId
 * @returns {Promise<Object>} 群组设置
 */
async function getGroupProactiveChatSettings(groupId) {
    const now = Date.now()
    const cached = groupSettingsCache.get(groupId)
    if (cached && now - cached.timestamp < GROUP_SETTINGS_CACHE_TTL) {
        return cached.settings
    }

    try {
        const scopeManager = await getScopeManager()
        if (!scopeManager) return {}

        const groupSettings = await scopeManager.getGroupSettings(groupId)
        const settings = groupSettings?.settings || {}
        groupSettingsCache.set(groupId, { settings, timestamp: now })
        return settings
    } catch (e) {
        logger.debug(`[ProactiveChat] 获取群${groupId}设置失败:`, e.message)
        return {}
    }
}

/**
 * 获取群组的合并配置（群组设置覆盖全局配置）
 * @param {string} groupId
 * @returns {Promise<Object>} 合并后的配置
 */
async function getMergedProactiveChatConfig(groupId) {
    const globalConfig = getProactiveChatConfig()
    const groupSettings = await getGroupProactiveChatSettings(groupId)

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

// 获取群消息的函数（懒加载）
let _getRecentGroupMessages = null
let _getGroupMessageCount = null

async function loadGroupMessageFunctions() {
    if (!_getRecentGroupMessages) {
        try {
            const { getRecentGroupMessages, getGroupMessageCount } = await import('../../../apps/GroupEvents.js')
            _getRecentGroupMessages = getRecentGroupMessages
            _getGroupMessageCount = getGroupMessageCount
        } catch (e) {
            logger.debug('[ProactiveChat] 加载GroupEvents失败:', e.message)
        }
    }
    return { getRecentGroupMessages: _getRecentGroupMessages, getGroupMessageCount: _getGroupMessageCount }
}

// 持久化文件路径
const TASKS_FILE = path.join(__dirname, '../../../data/scheduled_tasks.json')

/**
 * 任务数据结构
 * @typedef {Object} ScheduledTask
 * @property {string} id - 任务唯一ID
 * @property {string} name - 任务名称
 * @property {string} creatorId - 创建者QQ
 * @property {string} groupId - 群ID（可选）
 * @property {string} type - 任务类型: 'interval'(间隔执行) | 'cron'(定时执行) | 'once'(单次执行)
 * @property {number} intervalMs - 执行间隔(毫秒)
 * @property {string} cronExpr - Cron表达式（暂不支持复杂cron，使用简化格式）
 * @property {Object} action - 要执行的操作
 * @property {string} action.type - 操作类型: 'tool_call'(调用工具) | 'at'(at用户) | 'message'(发消息) | 'ai_chat'(触发AI对话) | 'mixed'(混合操作)
 * @property {string} action.toolName - 要调用的工具名称（tool_call/mixed类型）
 * @property {Object} action.toolArgs - 工具参数（tool_call/mixed类型）
 * @property {string} action.targetQQ - 目标QQ（at操作时使用）
 * @property {string} action.content - 消息内容或AI提示词
 * @property {Object} action.thenAction - 工具调用后的后续操作（mixed类型）
 * @property {number} maxExecutions - 最大执行次数，0表示无限制
 * @property {number} executedCount - 已执行次数
 * @property {number} expireAt - 过期时间戳，0表示永不过期
 * @property {number} nextRunAt - 下次执行时间戳
 * @property {number} lastRunAt - 上次执行时间戳
 * @property {number} createdAt - 创建时间戳
 * @property {boolean} enabled - 是否启用
 * @property {Object} metadata - 额外元数据
 */

/**
 * 保存任务到文件
 */
async function saveTasks() {
    try {
        const tasksData = Array.from(scheduledTasks.values()).map(task => ({
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
        logger.debug(`[ScheduleTools] 已保存 ${tasksData.length} 个任务`)
    } catch (err) {
        logger.warn('[ScheduleTools] 保存任务失败:', err.message)
    }
}

/**
 * 从文件加载任务
 */
async function loadTasks() {
    try {
        if (!fs.existsSync(TASKS_FILE)) {
            logger.debug('[ScheduleTools] 任务文件不存在，跳过加载')
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
            scheduledTasks.set(task.id, task)
            loadedCount++
        }

        logger.info(`[ScheduleTools] 已加载 ${loadedCount} 个任务，跳过 ${expiredCount} 个过期任务`)
    } catch (err) {
        logger.warn('[ScheduleTools] 加载任务失败:', err.message)
    }
}

/**
 * 获取主动聊天配置
 */
function getProactiveChatConfig() {
    try {
        const config = global.chatgptPluginConfig
        if (config) {
            return config.get?.('proactiveChat') || {}
        }
    } catch (e) {}
    return {}
}

/**
 * 检查是否在凌晨时段
 */
function isNightTime() {
    const config = getProactiveChatConfig()
    const hour = new Date().getHours()
    const start = config.nightHoursStart ?? 0
    const end = config.nightHoursEnd ?? 6
    return hour >= start && hour < end
}

/**
 * 计算主动聊天触发概率（支持群组设置覆盖全局）
 */
async function calculateProactiveChatProbability(groupId) {
    // 获取合并后的配置（群组设置优先）
    const config = await getMergedProactiveChatConfig(groupId)
    let probability = config.baseProbability ?? 0.05

    // 凌晨降低概率
    if (isNightTime()) {
        probability *= config.nightProbabilityMultiplier ?? 0.2
    }

    // 检查群活跃度（通过消息数量判断）
    try {
        const { getGroupMessageCount } = await loadGroupMessageFunctions()
        if (getGroupMessageCount) {
            const count = getGroupMessageCount(groupId)
            if (count > 20) {
                probability *= config.activeProbabilityMultiplier ?? 1.5
            }
        }
    } catch (e) {
        // 获取消息数量失败，忽略活跃度加成
    }

    return Math.min(probability, 0.5) // 最高不超过50%
}

/**
 * 检查群是否可以触发主动聊天（支持群组设置覆盖全局）
 */
async function canTriggerProactiveChat(groupId) {
    // 获取合并后的配置（群组设置优先）
    const config = await getMergedProactiveChatConfig(groupId)
    const globalConfig = getProactiveChatConfig()

    // 检查是否启用（群组设置优先，否则看全局）
    if (!config.enabled) {
        logger.debug(
            `[ProactiveChat] 群${groupId} 跳过: 未启用 (全局=${globalConfig.enabled}, 群组覆盖=${config.enabled})`
        )
        return false
    }

    // 检查白名单/黑名单（使用全局配置）
    const enabledGroups = globalConfig.enabledGroups || []
    const blacklistGroups = globalConfig.blacklistGroups || []

    if (blacklistGroups.includes(groupId) || blacklistGroups.includes(Number(groupId))) {
        logger.debug(`[ProactiveChat] 群${groupId} 跳过: 在黑名单中`)
        return false
    }
    // 如果群组有独立设置，跳过白名单检查
    const groupSettings = await getGroupProactiveChatSettings(groupId)
    const hasGroupOverride = groupSettings.proactiveChatEnabled !== undefined
    if (
        !hasGroupOverride &&
        enabledGroups.length > 0 &&
        !enabledGroups.includes(groupId) &&
        !enabledGroups.includes(Number(groupId))
    ) {
        logger.debug(`[ProactiveChat] 群${groupId} 跳过: 不在白名单中且无群组覆盖`)
        return false
    }

    // 检查冷却时间（使用合并后的配置）
    const stats = proactiveChatStats.get(groupId)
    if (stats) {
        const cooldownMs = (config.cooldownMinutes ?? 30) * 60 * 1000
        const elapsed = Date.now() - stats.lastTrigger
        if (elapsed < cooldownMs) {
            const remaining = Math.ceil((cooldownMs - elapsed) / 60000)
            logger.debug(`[ProactiveChat] 群${groupId} 跳过: 冷却中 (剩余${remaining}分钟)`)
            return false
        }

        // 检查每日限制（使用合并后的配置）
        const today = new Date().toISOString().split('T')[0]
        const maxDaily = config.maxDailyMessages ?? 20
        if (stats.date === today && stats.dailyCount >= maxDaily) {
            logger.debug(`[ProactiveChat] 群${groupId} 跳过: 已达每日上限 (${stats.dailyCount}/${maxDaily})`)
            return false
        }
    }

    logger.debug(
        `[ProactiveChat] 群${groupId} 通过检查: 启用=${config.enabled}, 概率=${config.baseProbability}, 有群组覆盖=${hasGroupOverride}`
    )
    return true
}

/**
 * 检查群消息数量是否足够触发
 */
async function hasEnoughMessages(groupId) {
    const config = getProactiveChatConfig()
    const { getGroupMessageCount } = await loadGroupMessageFunctions()
    if (!getGroupMessageCount) return false

    const count = getGroupMessageCount(groupId)
    return count >= (config.minMessagesBeforeTrigger ?? 10)
}

/**
 * 执行主动聊天、
 */
async function executeProactiveChat(groupId) {
    const config = getProactiveChatConfig()

    // 尝试获取最近消息作为上下文（可选）
    let recentMessages = []
    try {
        const { getRecentGroupMessages } = await loadGroupMessageFunctions()
        if (getRecentGroupMessages) {
            const contextCount = config.contextMessageCount ?? 20
            recentMessages = getRecentGroupMessages(groupId, contextCount) || []
        }
    } catch (e) {
        logger.debug(`[ProactiveChat] 获取群${groupId}消息失败:`, e.message)
    }

    try {
        // 构建提示词（有消息时使用上下文，无消息时发起话题）
        const { chatService } = await import('../../services/llm/ChatService.js')
        const systemPrompt = config.systemPrompt || '你是群里的一员，自然地参与讨论或发起有趣的话题。'

        let prompt
        if (recentMessages.length > 0) {
            const contextText = recentMessages.map(m => `${m.nickname || m.userId}: ${m.content}`).join('\n')
            prompt = `最近的群聊记录:\n${contextText}\n\n请根据上述聊天内容，自然地发言或发起一个有趣的话题。`
        } else {
            // 无消息时，主动发起话题
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
            logger.debug(`[ProactiveChat] 群${groupId} AI回复为空，跳过`)
            return
        }

        // 发送消息
        const bot = getBot()
        if (bot) {
            await sendToGroup(bot, groupId, responseText)
            logger.info(`[ProactiveChat] 群${groupId} 主动发言成功`)

            // 更新统计
            const today = new Date().toISOString().split('T')[0]
            const stats = proactiveChatStats.get(groupId) || { lastTrigger: 0, dailyCount: 0, date: today }
            if (stats.date !== today) {
                stats.dailyCount = 0
                stats.date = today
            }
            stats.lastTrigger = Date.now()
            stats.dailyCount++
            proactiveChatStats.set(groupId, stats)
        }
    } catch (err) {
        logger.error(`[ProactiveChat] 群${groupId} 执行失败:`, err.message)
    }
}

/**
 * 主动聊天轮询（支持群组设置覆盖全局配置）
 * 每隔 pollInterval 分钟扫描所有群，每个群独立判断是否触发
 */
async function proactiveChatPoll() {
    const globalConfig = getProactiveChatConfig()
    logger.info(
        `[ProactiveChat] === 开始轮询 === 全局开关=${globalConfig.enabled}, 轮询间隔=${globalConfig.pollInterval ?? 5}分钟`
    )

    // 获取所有Bot群列表（无论是否活跃）
    const allGroups = await getActiveGroups()

    if (allGroups.length === 0) {
        logger.info('[ProactiveChat] 轮询结束: 无可用群列表')
        return
    }

    logger.info(`[ProactiveChat] 扫描 ${allGroups.length} 个群...`)

    let passedCount = 0
    let triggeredCount = 0

    for (const groupId of allGroups) {
        // 检查是否可以触发（群组设置覆盖全局，包含冷却和每日限制检查）
        if (!(await canTriggerProactiveChat(groupId))) continue
        passedCount++

        // 计算概率并随机触发（群组设置覆盖全局）
        const probability = await calculateProactiveChatProbability(groupId)
        const roll = Math.random()
        const triggered = roll < probability

        logger.debug(
            `[ProactiveChat] 群${groupId} 概率判断: 概率=${(probability * 100).toFixed(1)}%, 随机=${(roll * 100).toFixed(1)}%, 触发=${triggered}`
        )

        if (triggered) {
            triggeredCount++
            logger.info(`[ProactiveChat] 群${groupId} 触发主动聊天!`)
            await executeProactiveChat(groupId)
        }
    }

    logger.info(
        `[ProactiveChat] === 轮询结束 === 总群数=${allGroups.length}, 通过检查=${passedCount}, 触发=${triggeredCount}`
    )
}

/**
 * 获取活跃群列表
 */
async function getActiveGroups() {
    const groups = []
    try {
        const bot = getBot()
        if (!bot) return groups

        // 尝试获取群列表
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
        logger.debug('[ProactiveChat] 获取群列表失败:', e.message)
    }
    return groups
}

/**
 * 初始化定时任务调度器
 */
async function initScheduler() {
    if (initialized) return

    // 加载持久化的任务
    await loadTasks()

    // 每分钟扫描一次待执行的任务
    scanInterval = setInterval(() => {
        scanAndExecuteTasks().catch(err => {
            logger.warn('[ScheduleTools] 扫描任务失败:', err.message)
        })
    }, 60 * 1000)

    // 首次扫描延迟5秒
    setTimeout(() => {
        scanAndExecuteTasks().catch(err => {
            logger.warn('[ScheduleTools] 首次扫描失败:', err.message)
        })
    }, 5000)

    // 主动聊天轮询
    const startProactiveChatPoll = () => {
        const config = getProactiveChatConfig()
        const intervalMs = (config.pollInterval ?? 5) * 60 * 1000

        if (proactiveChatInterval) {
            clearInterval(proactiveChatInterval)
        }

        proactiveChatInterval = setInterval(() => {
            proactiveChatPoll().catch(err => {
                logger.warn('[ProactiveChat] 轮询失败:', err.message)
            })
        }, intervalMs)

        logger.info(`[ProactiveChat] 主动聊天轮询已启动，间隔: ${config.pollInterval ?? 5}分钟`)
    }

    // 延迟启动主动聊天轮询
    setTimeout(startProactiveChatPoll, 10000)

    initialized = true
    logger.info('[ScheduleTools] 定时任务调度器已启动')
}

/**
 * 扫描并执行到期任务
 */
async function scanAndExecuteTasks() {
    const now = Date.now()
    const tasksToExecute = []

    for (const [taskId, task] of scheduledTasks) {
        if (!task.enabled) continue

        // 检查是否过期
        if (task.expireAt > 0 && now >= task.expireAt) {
            logger.info(`[ScheduleTools] 任务 ${taskId} 已过期，自动删除`)
            scheduledTasks.delete(taskId)
            continue
        }

        // 检查执行次数
        if (task.maxExecutions > 0 && task.executedCount >= task.maxExecutions) {
            logger.info(`[ScheduleTools] 任务 ${taskId} 已达到最大执行次数，自动删除`)
            scheduledTasks.delete(taskId)
            continue
        }

        // 检查是否到达执行时间
        if (task.nextRunAt && task.nextRunAt <= now) {
            tasksToExecute.push(task)
        }
    }

    if (tasksToExecute.length === 0) return

    logger.debug(`[ScheduleTools] 发现 ${tasksToExecute.length} 个待执行任务`)

    // 并发执行任务
    let tasksChanged = false
    await Promise.allSettled(
        tasksToExecute.map(async task => {
            try {
                await executeTask(task)
                task.executedCount++
                task.lastRunAt = now
                tasksChanged = true

                // 计算下次执行时间
                if (task.type === 'interval') {
                    task.nextRunAt = now + task.intervalMs
                } else if (task.type === 'once') {
                    // 单次任务执行后删除
                    scheduledTasks.delete(task.id)
                    logger.info(`[ScheduleTools] 单次任务 ${task.id} 执行完成，已删除`)
                }

                logger.debug(`[ScheduleTools] 任务 ${task.id} 执行成功`)
            } catch (err) {
                logger.error(`[ScheduleTools] 任务 ${task.id} 执行失败:`, err.message)
            }
        })
    )

    // 保存任务状态
    if (tasksChanged) {
        await saveTasks()
    }
}

/**
 * 执行任务
 * @param {ScheduledTask} task
 */
async function executeTask(task) {
    const { action, groupId, creatorId } = task

    logger.info(`[ScheduleTools] 开始执行任务: ${task.id} (${task.name}), 类型: ${action.type}, 群: ${groupId}`)

    // 获取Bot实例
    const bot = getBot()
    if (!bot) {
        logger.error('[ScheduleTools] Bot实例不可用，无法发送消息')
        throw new Error('Bot实例不可用，请确保机器人已登录')
    }

    logger.debug(
        `[ScheduleTools] Bot实例获取成功, uin: ${bot.uin || bot.self_id || 'unknown'}, pickGroup: ${!!bot.pickGroup}, sendGroupMsg: ${!!bot.sendGroupMsg}`
    )

    switch (action.type) {
        case 'at': {
            // @用户操作
            const targetQQ = action.targetQQ || creatorId
            const content = action.content || ''
            logger.debug(`[ScheduleTools] 执行at操作: target=${targetQQ}, group=${groupId}`)

            if (!groupId) {
                logger.warn('[ScheduleTools] at操作缺少groupId')
                break
            }

            // 使用ICQQ原生格式构造at消息段，避免用户信息查询
            const msg = [{ type: 'at', qq: Number(targetQQ) }]
            if (content) msg.push(content)

            const sent = await sendToGroup(bot, groupId, msg)
            logger.info(`[ScheduleTools] at消息发送${sent ? '成功' : '失败'}: group=${groupId}`)
            break
        }

        case 'message': {
            // 发送普通消息
            const content = action.content || ''
            logger.debug(`[ScheduleTools] 执行message操作: content=${content?.slice(0, 30)}, group=${groupId}`)
            if (!content) {
                logger.warn('[ScheduleTools] message操作content为空')
                break
            }

            if (groupId) {
                const sent = await sendToGroup(bot, groupId, content)
                logger.info(`[ScheduleTools] 消息发送${sent ? '成功' : '失败'}: group=${groupId}`)
            } else if (creatorId) {
                const sent = await sendToPrivate(bot, creatorId, content)
                logger.info(`[ScheduleTools] 私聊消息发送${sent ? '成功' : '失败'}: user=${creatorId}`)
            }
            break
        }

        case 'ai_chat': {
            // 触发AI对话
            const prompt = action.content || ''
            logger.debug(`[ScheduleTools] 执行ai_chat操作: prompt=${prompt?.slice(0, 30)}, group=${groupId}`)
            if (!prompt) {
                logger.warn('[ScheduleTools] ai_chat操作prompt为空')
                break
            }

            try {
                const { chatService } = await import('../../services/llm/ChatService.js')
                logger.debug('[ScheduleTools] 正在调用chatService.sendMessage...')
                const result = await chatService.sendMessage({
                    userId: creatorId,
                    groupId: groupId || null,
                    message: prompt,
                    mode: 'chat'
                })

                // 提取文本响应
                let responseText = ''
                if (result.response && Array.isArray(result.response)) {
                    responseText = result.response
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                }
                logger.debug(`[ScheduleTools] AI回复: ${responseText?.slice(0, 50)}...`)

                // 发送AI回复
                if (responseText) {
                    // 使用ICQQ原生格式
                    const msg = action.targetQQ
                        ? [{ type: 'at', qq: Number(action.targetQQ) }, responseText]
                        : responseText
                    if (groupId) {
                        const sent = await sendToGroup(bot, groupId, msg)
                        logger.info(`[ScheduleTools] AI回复发送${sent ? '成功' : '失败'}: group=${groupId}`)
                    } else if (creatorId) {
                        const sent = await sendToPrivate(bot, creatorId, responseText)
                        logger.info(`[ScheduleTools] AI回复发送${sent ? '成功' : '失败'}: user=${creatorId}`)
                    }
                } else {
                    logger.warn('[ScheduleTools] AI回复为空')
                }
            } catch (err) {
                logger.error(`[ScheduleTools] AI对话任务执行失败:`, err.message)
            }
            break
        }

        case 'at_then_ai': {
            // 先@用户，再触发AI回复
            const targetQQ = action.targetQQ || creatorId
            const prompt = action.content || '打个招呼'
            logger.debug(`[ScheduleTools] 执行at_then_ai: target=${targetQQ}, prompt=${prompt?.slice(0, 30)}`)

            if (!groupId) {
                logger.warn('[ScheduleTools] at_then_ai操作缺少groupId')
                break
            }

            try {
                // 1. 调用AI生成回复
                const { chatService } = await import('../../services/llm/ChatService.js')
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

                // 2. 发送@用户 + AI回复
                if (responseText) {
                    const msg = [{ type: 'at', qq: Number(targetQQ) }, ' ', responseText]
                    const sent = await sendToGroup(bot, groupId, msg)
                    logger.info(`[ScheduleTools] at_then_ai发送${sent ? '成功' : '失败'}: group=${groupId}`)
                } else {
                    // AI回复为空，只发送@
                    const msg = [{ type: 'at', qq: Number(targetQQ) }]
                    await sendToGroup(bot, groupId, msg)
                    logger.warn('[ScheduleTools] AI回复为空，仅发送@')
                }
            } catch (err) {
                logger.error(`[ScheduleTools] at_then_ai执行失败:`, err.message)
            }
            break
        }

        case 'tool_call': {
            // 调用工具
            const toolResult = await executeToolCall(action.toolName, action.toolArgs, task)
            // 如果有后续操作，发送结果
            if (action.sendResult !== false && toolResult) {
                const resultMsg = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)
                if (groupId) {
                    await sendToGroup(bot, groupId, `定时任务[${task.name}]执行结果:\n${resultMsg.slice(0, 500)}`)
                }
            }
            break
        }

        case 'mixed':
        case 'chain': {
            const steps = action.steps || []
            if (action.toolName && steps.length === 0) {
                steps.push({ type: 'tool', name: action.toolName, args: action.toolArgs })
                if (action.thenAction) {
                    steps.push(action.thenAction)
                }
            }
            const context = {
                results: {},
                random_user: null,
                random_users: [],
                creatorId,
                groupId,
                bot
            }

            // 顺序执行每个步骤
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i]
                try {
                    const stepResult = await executeChainStep(step, context, task)
                    context.results[`step${i}`] = stepResult
                    context.results.last = stepResult
                    logger.debug(`[ScheduleTools] 链式步骤${i}执行完成`)
                } catch (err) {
                    logger.error(`[ScheduleTools] 链式步骤${i}执行失败:`, err.message)
                    if (step.stopOnError !== false) break
                }
            }
            break
        }

        case 'callback': {
            if (typeof action.callback === 'function') {
                await action.callback({ task, bot, groupId, creatorId })
            }
            break
        }

        default:
            logger.warn(`[ScheduleTools] 未知的任务操作类型: ${action.type}`)
    }
}

/**
 * 获取Bot实例
 * @returns {Object|null} Bot实例
 */
function getBot() {
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
 * 发送群消息（使用helpers封装）
 * @param {Object} bot - Bot实例
 * @param {string} groupId - 群ID
 * @param {*} message - 消息内容
 * @param {number} retries - 重试次数
 */
async function sendToGroup(bot, groupId, message, retries = 2) {
    if (!bot) {
        logger.error('[ScheduleTools] sendToGroup: bot为空')
        return false
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // 使用helpers封装的icqqGroup.sendMsg
            await icqqGroup.sendMsg(bot, groupId, message)
            logger.debug(`[ScheduleTools] icqqGroup.sendMsg 发送成功`)
            return true
        } catch (err) {
            const isTimeout = err.message?.includes('timeout')
            if (isTimeout && attempt < retries) {
                logger.warn(`[ScheduleTools] 发送超时，重试 ${attempt + 1}/${retries}...`)
                await new Promise(r => setTimeout(r, 1000))
                continue
            }

            // 如果icqqGroup失败，尝试其他方式
            try {
                if (bot.sendGroupMsg) {
                    await bot.sendGroupMsg(Number(groupId), message)
                    logger.debug(`[ScheduleTools] sendGroupMsg 发送成功`)
                    return true
                }
            } catch (e) {
                // 忽略
            }

            logger.error(`[ScheduleTools] 发送群消息失败:`, err.message)
        }
    }
    return false
}

/**
 * 发送私聊消息（使用helpers封装）
 */
async function sendToPrivate(bot, userId, message) {
    try {
        // 使用helpers封装的icqqFriend.sendMsg
        await icqqFriend.sendMsg(bot, userId, message)
        logger.debug(`[ScheduleTools] icqqFriend.sendMsg 发送成功`)
        return true
    } catch (err) {
        // 尝试其他方式
        try {
            if (bot.sendPrivateMsg) {
                await bot.sendPrivateMsg(Number(userId), message)
                logger.debug(`[ScheduleTools] sendPrivateMsg 发送成功`)
                return true
            }
        } catch (e) {
            // 忽略
        }
        logger.error(`[ScheduleTools] 发送私聊消息失败:`, err.message)
    }
    return false
}

/**
 * 解析模板字符串，替换变量
 * @param {string} template - 模板字符串
 * @param {Object} context - 上下文对象
 */
function resolveTemplate(template, context) {
    if (typeof template !== 'string') return template

    return template.replace(/\{\{(\w+(?:\.\w+)?)\}\}/g, (match, path) => {
        const parts = path.split('.')
        let value = context
        for (const part of parts) {
            if (value == null) return match
            value = value[part]
        }
        if (value == null) return match
        return typeof value === 'object' ? JSON.stringify(value) : String(value)
    })
}

/**
 * 获取群随机成员
 * @param {Object} bot - Bot实例
 * @param {string} groupId - 群ID
 * @param {number} count - 数量
 * @param {Array} excludeIds - 排除的QQ号
 */
async function getRandomGroupMembers(bot, groupId, count = 1, excludeIds = []) {
    try {
        let members = []
        if (bot.pickGroup) {
            const group = bot.pickGroup(Number(groupId))
            if (group?.getMemberMap) {
                const memberMap = await group.getMemberMap()
                members = Array.from(memberMap.keys()).map(String)
            }
        }

        if (members.length === 0) {
            // 尝试其他方式获取
            if (bot.getGroupMemberList) {
                const list = await bot.getGroupMemberList(Number(groupId))
                members = list.map(m => String(m.user_id))
            }
        }

        // 过滤排除的成员
        const excludeSet = new Set(excludeIds.map(String))
        members = members.filter(id => !excludeSet.has(id))

        if (members.length === 0) return []

        // 随机选择
        const selected = []
        const shuffled = members.sort(() => Math.random() - 0.5)
        for (let i = 0; i < Math.min(count, shuffled.length); i++) {
            selected.push(shuffled[i])
        }
        return selected
    } catch (err) {
        logger.warn(`[ScheduleTools] 获取群成员失败:`, err.message)
        return []
    }
}

/**
 * 执行链式步骤
 * @param {Object} step - 步骤配置
 * @param {Object} context - 执行上下文
 * @param {Object} task - 任务信息
 */
async function executeChainStep(step, context, task) {
    const { bot, groupId, creatorId } = context
    const stepType = step.type || 'message'

    // 解析步骤中的模板变量
    const resolveValue = val => resolveTemplate(val, context)

    switch (stepType) {
        case 'random_user': {
            // 随机选择群成员
            const count = step.count || 1
            const exclude = step.exclude || []
            // 默认排除机器人自己
            const botId = bot?.uin ? String(bot.uin) : null
            const excludeIds = [...exclude, botId].filter(Boolean)

            const users = await getRandomGroupMembers(bot, groupId, count, excludeIds)
            if (users.length > 0) {
                context.random_user = users[0]
                context.random_users = users
            }
            return { users, random_user: context.random_user }
        }

        case 'tool': {
            // 调用工具
            const toolName = resolveValue(step.name)
            const toolArgs = {}
            if (step.args) {
                for (const [key, val] of Object.entries(step.args)) {
                    toolArgs[key] = resolveValue(val)
                }
            }
            return await executeToolCall(toolName, toolArgs, task)
        }

        case 'at': {
            // @用户
            let targetQQ = resolveValue(step.target_qq || step.targetQQ)
            // 支持使用 {{random_user}}
            if (!targetQQ || targetQQ === '{{random_user}}') {
                targetQQ = context.random_user || creatorId
            }
            const content = resolveValue(step.content || '')
            // 使用ICQQ原生格式
            const msg = [{ type: 'at', qq: Number(targetQQ) }]
            if (content) msg.push(content)
            if (groupId) await sendToGroup(bot, groupId, msg)
            return { target: targetQQ, content }
        }

        case 'message': {
            // 发送消息
            const content = resolveValue(step.content || '')
            if (content && groupId) {
                await sendToGroup(bot, groupId, content)
            }
            return { content }
        }

        case 'ai_chat': {
            // AI对话
            const prompt = resolveValue(step.content || step.prompt || '')
            if (!prompt) return { error: 'empty prompt' }

            let targetQQ = resolveValue(step.target_qq || step.targetQQ)
            if (!targetQQ || targetQQ === '{{random_user}}') {
                targetQQ = context.random_user
            }

            try {
                const { chatService } = await import('../../services/llm/ChatService.js')
                const result = await chatService.sendMessage({
                    userId: creatorId,
                    groupId: groupId || null,
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
                if (responseText && groupId) {
                    // 使用ICQQ原生格式
                    const msg = targetQQ ? [{ type: 'at', qq: Number(targetQQ) }, responseText] : responseText
                    await sendToGroup(bot, groupId, msg)
                }
                return { response: responseText, target: targetQQ }
            } catch (err) {
                logger.error(`[ScheduleTools] AI对话步骤失败:`, err.message)
                return { error: err.message }
            }
        }

        case 'delay': {
            // 延迟
            const ms = step.ms || step.seconds * 1000 || 1000
            await new Promise(resolve => setTimeout(resolve, Math.min(ms, 30000)))
            return { delayed: ms }
        }

        case 'set': {
            // 设置变量
            const varName = step.name || step.var
            const value = resolveValue(step.value)
            if (varName) {
                context[varName] = value
            }
            return { [varName]: value }
        }

        default:
            logger.warn(`[ScheduleTools] 未知的链式步骤类型: ${stepType}`)
            return null
    }
}

/**
 * 执行工具调用
 * @param {string} toolName - 工具名称
 * @param {Object} toolArgs - 工具参数
 * @param {ScheduledTask} task - 任务信息
 */
async function executeToolCall(toolName, toolArgs, task) {
    if (!toolName) {
        logger.warn('[ScheduleTools] 工具名称为空')
        return null
    }

    try {
        // 动态导入MCP服务
        const { builtinMcpServer } = await import('../BuiltinMcpServer.js')

        // 构造模拟的上下文
        const mockEvent = {
            user_id: task.creatorId,
            group_id: task.groupId ? Number(task.groupId) : null,
            sender: { user_id: task.creatorId }
        }

        // 获取工具并执行
        const tool = builtinMcpServer.tools.get(toolName)
        if (!tool) {
            logger.warn(`[ScheduleTools] 未找到工具: ${toolName}`)
            return { error: `工具 ${toolName} 不存在` }
        }

        // 创建工具上下文
        const ctx = builtinMcpServer.toolContext
        ctx.setContext(null, mockEvent)

        const result = await tool.handler(toolArgs || {}, ctx)
        logger.debug(`[ScheduleTools] 工具 ${toolName} 执行完成`)
        return result
    } catch (err) {
        logger.error(`[ScheduleTools] 执行工具 ${toolName} 失败:`, err.message)
        return { error: err.message }
    }
}

/**
 * 解析时间间隔字符串
 * @param {string} intervalStr - 如 '10m', '1h', '30s', '1d'
 * @returns {number} 毫秒数
 */
function parseInterval(intervalStr) {
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
 * 解析持续时间字符串
 * @param {string} durationStr - 如 '1h', '30m', '1d'
 * @returns {number} 毫秒数
 */
function parseDuration(durationStr) {
    return parseInterval(durationStr)
}

/**
 * 生成任务ID
 */
function generateTaskId() {
    return crypto.randomUUID().slice(0, 8)
}

/**
 * 格式化时间间隔为人类可读
 */
function formatInterval(ms) {
    if (ms < 60 * 1000) return `${Math.round(ms / 1000)}秒`
    if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60000)}分钟`
    if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / 3600000)}小时`
    return `${Math.round(ms / 86400000)}天`
}

/**
 * 格式化时间戳
 */
function formatTime(timestamp) {
    if (!timestamp) return '未知'
    return new Date(timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    })
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
