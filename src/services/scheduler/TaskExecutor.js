/**
 * 任务执行器 - 处理各种类型的任务动作
 */
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

/**
 * 发送群消息
 */
async function sendToGroup(bot, groupId, message, retries = 2) {
    if (!bot) {
        logger.error('[TaskExecutor] sendToGroup: bot为空')
        return false
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // ICQQ方式
            if (bot.pickGroup) {
                const group = bot.pickGroup(Number(groupId))
                if (group?.sendMsg) {
                    await group.sendMsg(message)
                    logger.debug(`[TaskExecutor] pickGroup.sendMsg 发送成功`)
                    return true
                }
            }
            // 通用方式
            if (bot.sendGroupMsg) {
                await bot.sendGroupMsg(Number(groupId), message)
                logger.debug(`[TaskExecutor] sendGroupMsg 发送成功`)
                return true
            }
        } catch (err) {
            const isTimeout = err.message?.includes('timeout')
            if (isTimeout && attempt < retries) {
                logger.warn(`[TaskExecutor] 发送超时，重试 ${attempt + 1}/${retries}...`)
                await new Promise(r => setTimeout(r, 1000))
                continue
            }
            logger.error(`[TaskExecutor] 发送群消息失败:`, err.message)
        }
    }
    return false
}

/**
 * 发送私聊消息
 */
async function sendToPrivate(bot, userId, message) {
    try {
        // ICQQ方式
        if (bot.pickFriend) {
            const friend = bot.pickFriend(Number(userId))
            if (friend?.sendMsg) {
                await friend.sendMsg(message)
                logger.debug(`[TaskExecutor] pickFriend.sendMsg 发送成功`)
                return true
            }
        }
        // 通用方式
        if (bot.sendPrivateMsg) {
            await bot.sendPrivateMsg(Number(userId), message)
            logger.debug(`[TaskExecutor] sendPrivateMsg 发送成功`)
            return true
        }
    } catch (err) {
        logger.error(`[TaskExecutor] 发送私聊消息失败:`, err.message)
    }
    return false
}

/**
 * 解析模板字符串，替换变量
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
        logger.warn(`[TaskExecutor] 获取群成员失败:`, err.message)
        return []
    }
}

/**
 * 执行工具调用
 */
async function executeToolCall(toolName, toolArgs, task) {
    if (!toolName) {
        logger.warn('[TaskExecutor] 工具名称为空')
        return null
    }

    try {
        const { builtinMcpServer } = await import('../../mcp/BuiltinMcpServer.js')

        // 构造模拟的上下文
        const mockEvent = {
            user_id: task.creatorId,
            group_id: task.groupId ? Number(task.groupId) : null,
            sender: { user_id: task.creatorId }
        }

        const tool = builtinMcpServer.tools.get(toolName)
        if (!tool) {
            logger.warn(`[TaskExecutor] 未找到工具: ${toolName}`)
            return { error: `工具 ${toolName} 不存在` }
        }

        const ctx = builtinMcpServer.toolContext
        ctx.setContext(null, mockEvent)

        const result = await tool.handler(toolArgs || {}, ctx)
        logger.debug(`[TaskExecutor] 工具 ${toolName} 执行完成`)
        return result
    } catch (err) {
        logger.error(`[TaskExecutor] 执行工具 ${toolName} 失败:`, err.message)
        return { error: err.message }
    }
}

/**
 * 执行链式步骤
 */
async function executeChainStep(step, context, task) {
    const { bot, groupId, creatorId } = context
    const stepType = step.type || 'message'

    const resolveValue = val => resolveTemplate(val, context)

    switch (stepType) {
        case 'random_user': {
            const count = step.count || 1
            const exclude = step.exclude || []
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
            let targetQQ = resolveValue(step.target_qq || step.targetQQ)
            if (!targetQQ || targetQQ === '{{random_user}}') {
                targetQQ = context.random_user || creatorId
            }
            const content = resolveValue(step.content || '')
            const msg = [{ type: 'at', qq: Number(targetQQ) }]
            if (content) msg.push(content)
            if (groupId) await sendToGroup(bot, groupId, msg)
            return { target: targetQQ, content }
        }

        case 'message': {
            const content = resolveValue(step.content || '')
            if (content && groupId) {
                await sendToGroup(bot, groupId, content)
            }
            return { content }
        }

        case 'ai_chat': {
            const prompt = resolveValue(step.content || step.prompt || '')
            if (!prompt) return { error: 'empty prompt' }

            let targetQQ = resolveValue(step.target_qq || step.targetQQ)
            if (!targetQQ || targetQQ === '{{random_user}}') {
                targetQQ = context.random_user
            }

            try {
                const { chatService } = await import('../llm/ChatService.js')
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
                    const msg = targetQQ ? [{ type: 'at', qq: Number(targetQQ) }, responseText] : responseText
                    await sendToGroup(bot, groupId, msg)
                }
                return { response: responseText, target: targetQQ }
            } catch (err) {
                logger.error(`[TaskExecutor] AI对话步骤失败:`, err.message)
                return { error: err.message }
            }
        }

        case 'delay': {
            const ms = step.ms || step.seconds * 1000 || 1000
            await new Promise(resolve => setTimeout(resolve, Math.min(ms, 30000)))
            return { delayed: ms }
        }

        case 'set': {
            const varName = step.name || step.var
            const value = resolveValue(step.value)
            if (varName) {
                context[varName] = value
            }
            return { [varName]: value }
        }

        default:
            logger.warn(`[TaskExecutor] 未知的链式步骤类型: ${stepType}`)
            return null
    }
}

/**
 * 执行任务动作
 * @param {Object} task - 任务对象
 * @param {Object} bot - Bot实例
 * @param {Object} options - 选项
 */
export async function executeTaskAction(task, bot, options = {}) {
    const { action, groupId, creatorId } = task

    logger.debug(
        `[TaskExecutor] Bot实例获取成功, uin: ${bot.uin || bot.self_id || 'unknown'}, pickGroup: ${!!bot.pickGroup}, sendGroupMsg: ${!!bot.sendGroupMsg}`
    )

    switch (action.type) {
        case 'at': {
            const targetQQ = action.targetQQ || creatorId
            const content = action.content || ''
            logger.debug(`[TaskExecutor] 执行at操作: target=${targetQQ}, group=${groupId}`)

            if (!groupId) {
                logger.warn('[TaskExecutor] at操作缺少groupId')
                break
            }

            const msg = [{ type: 'at', qq: Number(targetQQ) }]
            if (content) msg.push(content)

            const sent = await sendToGroup(bot, groupId, msg)
            logger.info(`[TaskExecutor] at消息发送${sent ? '成功' : '失败'}: group=${groupId}`)
            break
        }

        case 'message': {
            const content = action.content || ''
            logger.debug(`[TaskExecutor] 执行message操作: content=${content?.slice(0, 30)}, group=${groupId}`)
            if (!content) {
                logger.warn('[TaskExecutor] message操作content为空')
                break
            }

            if (groupId) {
                const sent = await sendToGroup(bot, groupId, content)
                logger.info(`[TaskExecutor] 消息发送${sent ? '成功' : '失败'}: group=${groupId}`)
            } else if (creatorId) {
                const sent = await sendToPrivate(bot, creatorId, content)
                logger.info(`[TaskExecutor] 私聊消息发送${sent ? '成功' : '失败'}: user=${creatorId}`)
            }
            break
        }

        case 'ai_chat': {
            const prompt = action.content || ''
            logger.debug(`[TaskExecutor] 执行ai_chat操作: prompt=${prompt?.slice(0, 30)}, group=${groupId}`)
            if (!prompt) {
                logger.warn('[TaskExecutor] ai_chat操作prompt为空')
                break
            }

            try {
                const { chatService } = await import('../llm/ChatService.js')
                logger.debug('[TaskExecutor] 正在调用chatService.sendMessage...')
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
                logger.debug(`[TaskExecutor] AI回复: ${responseText?.slice(0, 50)}...`)

                if (responseText) {
                    const msg = action.targetQQ
                        ? [{ type: 'at', qq: Number(action.targetQQ) }, responseText]
                        : responseText
                    if (groupId) {
                        const sent = await sendToGroup(bot, groupId, msg)
                        logger.info(`[TaskExecutor] AI回复发送${sent ? '成功' : '失败'}: group=${groupId}`)
                    } else if (creatorId) {
                        const sent = await sendToPrivate(bot, creatorId, responseText)
                        logger.info(`[TaskExecutor] AI回复发送${sent ? '成功' : '失败'}: user=${creatorId}`)
                    }
                } else {
                    logger.warn('[TaskExecutor] AI回复为空')
                }
            } catch (err) {
                logger.error(`[TaskExecutor] AI对话任务执行失败:`, err.message)
            }
            break
        }

        case 'at_then_ai': {
            const targetQQ = action.targetQQ || creatorId
            const prompt = action.content || '打个招呼'
            logger.debug(`[TaskExecutor] 执行at_then_ai: target=${targetQQ}, prompt=${prompt?.slice(0, 30)}`)

            if (!groupId) {
                logger.warn('[TaskExecutor] at_then_ai操作缺少groupId')
                break
            }

            try {
                const { chatService } = await import('../llm/ChatService.js')
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
                    const msg = [{ type: 'at', qq: Number(targetQQ) }, ' ', responseText]
                    const sent = await sendToGroup(bot, groupId, msg)
                    logger.info(`[TaskExecutor] at_then_ai发送${sent ? '成功' : '失败'}: group=${groupId}`)
                } else {
                    const msg = [{ type: 'at', qq: Number(targetQQ) }]
                    await sendToGroup(bot, groupId, msg)
                    logger.warn('[TaskExecutor] AI回复为空，仅发送@')
                }
            } catch (err) {
                logger.error(`[TaskExecutor] at_then_ai执行失败:`, err.message)
            }
            break
        }

        case 'tool_call': {
            const toolResult = await executeToolCall(action.toolName, action.toolArgs, task)
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

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i]
                try {
                    const stepResult = await executeChainStep(step, context, task)
                    context.results[`step${i}`] = stepResult
                    context.results.last = stepResult
                    logger.debug(`[TaskExecutor] 链式步骤${i}执行完成`)
                } catch (err) {
                    logger.error(`[TaskExecutor] 链式步骤${i}执行失败:`, err.message)
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
            logger.warn(`[TaskExecutor] 未知的任务操作类型: ${action.type}`)
    }
}

export { sendToGroup, sendToPrivate, resolveTemplate, getRandomGroupMembers, executeToolCall, executeChainStep }
