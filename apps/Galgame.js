import fs from 'fs'
import path from 'path'
import os from 'os'
import config from '../config/config.js'
// 从 galgame 内部模块导入
import {
    galgameService,
    CHOICE_EMOJIS,
    MESSAGE_CACHE_TTL,
    getAffectionLevel,
    processEventChoice,
    processEventWithCustomInput
} from '../src/services/galgame/index.js'
import { getBotIds, isMessageProcessed, markMessageProcessed, isSelfMessage } from '../src/utils/messageDedup.js'
import { parseReactionEvent, sendGroupMessage, getBot, sendReaction } from '../src/utils/eventAdapter.js'
import { parseUserMessage } from '../src/utils/messageParser.js'
import chatLogger from '../src/core/utils/logger.js'

// 创建Game标签的logger
const gameLogger = chatLogger.tag('Game')

// 用户消息缓存（用于表情回应选择）
const userMessageCache = new Map() // `${groupId}_${messageId}` -> { userId, timestamp }

/**
 * 缓存用户消息（用于选项选择）
 */
function cacheUserMessage(groupId, messageId, userId) {
    const key = `${groupId || 'private'}_${messageId}`
    userMessageCache.set(key, {
        userId,
        timestamp: Date.now()
    })

    // 清理过期缓存
    const now = Date.now()
    for (const [k, v] of userMessageCache) {
        if (now - v.timestamp > MESSAGE_CACHE_TTL) {
            userMessageCache.delete(k)
        }
    }
}

/**
 * 获取缓存的用户消息
 */
function getCachedUserMessage(groupId, messageId) {
    const key = `${groupId || 'private'}_${messageId}`
    return userMessageCache.get(key)
}

/**
 * 注册Galgame表情回应监听器
 */
let galgameReactionListenerRegistered = false

function registerGalgameReactionListener() {
    if (galgameReactionListenerRegistered) return
    galgameReactionListenerRegistered = true

    setTimeout(() => {
        try {
            const bots = Bot?.uin ? [Bot] : Bot?.bots ? Object.values(Bot.bots) : []
            if (bots.length === 0 && global.Bot) {
                bots.push(global.Bot)
            }

            for (const bot of bots) {
                if (!bot || bot._galgameReactionListenerAdded) continue
                bot._galgameReactionListenerAdded = true

                const handleReaction = async e => {
                    await handleGalgameReaction(e, bot)
                }

                bot.on?.('notice.group.reaction', handleReaction)
                bot.on?.('notice.group_msg_emoji_like', handleReaction)
                bot.on?.('notice.group.emoji_like', handleReaction)
                bot.on?.('notice.group.msg_emoji_like', handleReaction)

                gameLogger.debug(` 已为 Bot ${bot.uin || bot.self_id} 注册表情回应监听`)
            }
        } catch (err) {
            gameLogger.error(' 注册表情监听失败:', err)
        }
    }, 3000)
}

/**
 * 处理Galgame表情回应（用于选项选择）
 */
async function handleGalgameReaction(e, bot) {
    try {
        if (!config.get('features.galgame.reactionEnabled')) {
            return
        }

        const reactionInfo = parseReactionEvent(e)
        let { emojiId, messageId, userId, isAdd, groupId } = reactionInfo

        if (!isAdd) return

        // 处理NapCat格式
        if (!emojiId && e.likes?.length > 0) {
            emojiId = e.likes[0].emoji_id || e.likes[0].face_id
        }

        const botIds = getBotIds()
        const selfId = e.self_id || bot?.uin || Bot?.uin

        // 忽略机器人自己的表情
        if (userId === selfId || botIds.has(String(userId))) {
            return
        }

        // 检查是否有待选择项
        const pendingChoice = galgameService.getPendingChoice(groupId, messageId)
        if (!pendingChoice) {
            return
        }

        // 验证是否是该用户的选择
        if (pendingChoice.userId !== String(userId)) {
            gameLogger.debug(` 非本人选择，忽略: expected=${pendingChoice.userId}, got=${userId}`)
            return
        }

        // 查找对应的选项索引
        const emojiNum = parseInt(emojiId)
        const choiceIndex = CHOICE_EMOJIS.findIndex(c => c.id === emojiNum)
        if (choiceIndex === -1) {
            return // 不是选项表情
        }

        const optionIndex = choiceIndex + 1 // 选项从1开始

        gameLogger.info(` 用户 ${userId} 选择了选项 ${optionIndex}`)

        // 获取游戏会话
        const gameSession = galgameService.getUserGameSession(groupId, userId)
        if (!gameSession) {
            return
        }

        // 移除待选择项
        galgameService.removePendingChoice(groupId, messageId)

        // 根据选择类型处理
        if (pendingChoice.type === 'option') {
            // 对话选项
            const selectedOption = pendingChoice.options.find(o => o.index === optionIndex)
            if (!selectedOption) {
                await sendGroupMessage(bot, groupId, '❌ 无效的选项')
                return
            }

            // 发送选择结果作为新对话
            const result = await galgameService.sendMessage({
                userId: String(userId),
                groupId,
                message: selectedOption.text,
                characterId: gameSession.characterId,
                isOptionChoice: true,
                optionIndex
            })

            // 发送回复
            await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)
        } else if (pendingChoice.type === 'event') {
            // 事件选项
            const eventResult = processEventChoice(pendingChoice.eventInfo, optionIndex, pendingChoice.options)

            // 更新好感度
            if (eventResult.affectionChange !== 0) {
                await galgameService.updateAffection(
                    String(userId),
                    gameSession.characterId,
                    eventResult.affectionChange,
                    groupId
                )
            }

            // 记录事件已触发
            await galgameService.addTriggeredEvent(
                String(userId),
                gameSession.characterId,
                pendingChoice.eventInfo.name,
                groupId
            )

            // 获取更新后的状态
            const status = await galgameService.getStatus(String(userId), gameSession.characterId, groupId)

            // 发送事件结果
            const resultEmoji = eventResult.success ? '✨' : '💫'
            const affectionEmoji = eventResult.affectionChange > 0 ? '💕' : eventResult.affectionChange < 0 ? '💔' : ''

            let resultMsg = `━━━ 事件结果 ━━━\n`
            resultMsg += `${resultEmoji} ${eventResult.eventName}: ${eventResult.message}\n`
            resultMsg += `📝 你的选择: ${eventResult.optionText}\n`
            resultMsg += `🎲 判定: ${eventResult.roll}% / ${eventResult.rate}%\n`
            if (eventResult.affectionChange !== 0) {
                resultMsg += `${affectionEmoji} 好感度 ${eventResult.affectionChange > 0 ? '+' : ''}${eventResult.affectionChange}\n`
            }
            resultMsg += `\n${status.level.emoji} 当前好感度: ${status.affection} (${status.level.name})`

            await sendGroupMessage(bot, groupId, resultMsg)
        }
    } catch (err) {
        gameLogger.error(' 处理表情回应失败:', err)
    }
}

/**
 * 发送Galgame回复（包含选项处理）
 * - 文本正常发送
 * - 选项1234分开发送后合并转发
 */
async function sendGalgameResponse(bot, groupId, userId, characterId, result) {
    const hasOptions = result.options && result.options.length > 0
    const hasEvent = result.event && result.eventOptions && result.eventOptions.length > 0

    // 构建场景/任务/线索头部信息
    let headerInfo = ''
    if (result.scene) {
        headerInfo += `📍 ${result.scene.name}`
        if (result.scene.description) headerInfo += ` - ${result.scene.description}`
        headerInfo += '\n'
    }
    if (result.task) {
        headerInfo += `📋 任务: ${result.task}\n`
    }
    if (result.clue) {
        headerInfo += `🔍 发现线索: ${result.clue}\n`
    }
    if (result.plot) {
        headerInfo += `📖 ${result.plot}\n`
    }
    // 显示新发现的信息
    if (result.discoveries && result.discoveries.length > 0) {
        for (const d of result.discoveries) {
            headerInfo += `✨ 发现[${d.type}]: ${d.content}\n`
        }
    }
    if (headerInfo) {
        headerInfo += '━━━━━━━━━━━━━━━━\n'
    }

    // 构建基础回复
    let replyText = headerInfo + result.response

    // 添加好感度变化提示
    if (result.affectionChange !== 0) {
        const changeEmoji = result.affectionChange > 0 ? '💕' : '💔'
        replyText += `\n\n${changeEmoji} 好感度 ${result.affectionChange > 0 ? '+' : ''}${result.affectionChange}`
    }

    // 添加当前状态
    replyText += `\n${result.session.level.emoji} ${result.session.level.name} (${result.session.affection})`

    // 如果回复包含空行，分段发送
    const paragraphs = replyText.split(/\n\n+/).filter(p => p.trim())
    if (paragraphs.length > 1) {
        for (const paragraph of paragraphs) {
            await sendGroupMessage(bot, groupId, paragraph.trim())
            await new Promise(r => setTimeout(r, 500))
        }
    } else {
        await sendGroupMessage(bot, groupId, replyText)
    }

    // 如果有对话选项，选项单独合并转发
    if (hasOptions) {
        const forwardMsgs = []

        // 添加选项说明
        forwardMsgs.push({
            message: '━━━ 请选择 ━━━\n在你的消息上添加对应表情，或直接发送文字选择',
            nickname: '系统',
            user_id: bot.uin || Bot.uin
        })

        // 每个选项单独一条消息
        for (let i = 0; i < result.options.length; i++) {
            const opt = result.options[i]
            forwardMsgs.push({
                message: `${CHOICE_EMOJIS[i].name} ${opt.text}`,
                nickname: `选项${i + 1}`,
                user_id: bot.uin || Bot.uin
            })
        }

        // 发送选项合并转发
        try {
            if (groupId && bot?.pickGroup) {
                const group = bot.pickGroup(parseInt(groupId))
                await group.sendMsg(await bot.makeForwardMsg(forwardMsgs))
            } else {
                // 合并转发失败，普通发送选项
                let optionsText = '━━━ 请选择 ━━━\n'
                for (let i = 0; i < result.options.length; i++) {
                    optionsText += `${CHOICE_EMOJIS[i].name} ${result.options[i].text}\n`
                }
                await sendGroupMessage(bot, groupId, optionsText)
            }
        } catch (err) {
            let optionsText = '━━━ 请选择 ━━━\n'
            for (let i = 0; i < result.options.length; i++) {
                optionsText += `${CHOICE_EMOJIS[i].name} ${result.options[i].text}\n`
            }
            await sendGroupMessage(bot, groupId, optionsText)
        }

        return { hasOptions: true, options: result.options }
    }

    // 如果触发了事件，事件选项单独合并转发
    if (hasEvent) {
        const forwardMsgs = []

        // 添加事件说明
        forwardMsgs.push({
            message: `━━━ 触发事件: ${result.event.name} ━━━\n${result.event.description}\n成功率: ${result.event.successRate}%\n\n在你的消息上添加表情选择，或直接发送文字行动`,
            nickname: '系统',
            user_id: bot.uin || Bot.uin
        })

        // 每个事件选项单独一条消息
        for (let i = 0; i < result.eventOptions.length; i++) {
            const opt = result.eventOptions[i]
            const successText = opt.successAffection > 0 ? `+${opt.successAffection}` : opt.successAffection
            const failText = opt.failAffection > 0 ? `+${opt.failAffection}` : opt.failAffection
            forwardMsgs.push({
                message: `${CHOICE_EMOJIS[i].name} ${opt.text}\n   成功: ${successText} / 失败: ${failText}`,
                nickname: `选项${i + 1}`,
                user_id: bot.uin || Bot.uin
            })
        }

        try {
            if (groupId && bot?.pickGroup) {
                const group = bot.pickGroup(parseInt(groupId))
                await group.sendMsg(await bot.makeForwardMsg(forwardMsgs))
            } else {
                let eventText = `━━━ 触发事件: ${result.event.name} ━━━\n`
                for (let i = 0; i < result.eventOptions.length; i++) {
                    const opt = result.eventOptions[i]
                    eventText += `${CHOICE_EMOJIS[i].name} ${opt.text}\n`
                }
                await sendGroupMessage(bot, groupId, eventText)
            }
        } catch (err) {
            let eventText = `━━━ 触发事件: ${result.event.name} ━━━\n`
            for (let i = 0; i < result.eventOptions.length; i++) {
                eventText += `${CHOICE_EMOJIS[i].name} ${result.eventOptions[i].text}\n`
            }
            await sendGroupMessage(bot, groupId, eventText)
        }

        return { hasEvent: true, event: result.event, eventOptions: result.eventOptions }
    }

    return { hasOptions: false, hasEvent: false }
}

/**
 * 格式化状态显示
 */
function formatStatus(status) {
    const level = status.level
    const progressBar = createProgressBar(status.affection, -100, 150)

    let text = `🎮 Galgame 状态
━━━━━━━━━━━━━━━━
👤 角色: ${status.characterName}
🌍 世界观: ${status.world || '未知'}
📋 身份: ${status.identity || '未知'}
💫 性格: ${status.personality || '???'}
❤️ 喜好: ${status.likes || '???'}
💔 厌恶: ${status.dislikes || '???'}
📖 背景: ${status.background || '???'}
🤝 相遇: ${status.meetingReason || '???'}
🔐 秘密: ${status.secret || '???'}
━━━━━━━━━━━━━━━━
${level.emoji} 关系: ${level.name}
💖 好感度: ${status.affection} 点
${progressBar}`

    // 当前场景
    if (status.currentScene) {
        text += `\n\n📍 当前场景: ${status.currentScene.name}`
        if (status.currentScene.description) {
            text += ` - ${status.currentScene.description}`
        }
    }

    // 当前任务
    if (status.currentTask) {
        text += `\n📋 进行中任务: ${status.currentTask}`
    }

    // 已发现线索
    if (status.clues && status.clues.length > 0) {
        text += `\n🔍 线索: ${status.clues.slice(-3).join('、')}`
        if (status.clues.length > 3) text += ` (+${status.clues.length - 3})`
    }

    // 去过的地方
    if (status.visitedPlaces && status.visitedPlaces.length > 0) {
        text += `\n📍 去过: ${status.visitedPlaces.join('、')}`
    }

    // 已触发事件
    if (status.triggeredEvents && status.triggeredEvents.length > 0) {
        text += `\n⭐ 事件: ${status.triggeredEvents.join('、')}`
    }

    text += `\n━━━━━━━━━━━━━━━━
🕐 开始时间: ${new Date(status.createdAt).toLocaleDateString()}`

    return text
}

/**
 * 创建进度条
 */
function createProgressBar(value, min, max, length = 10) {
    const normalized = (value - min) / (max - min)
    const filled = Math.round(normalized * length)
    const empty = length - filled

    let bar = ''
    for (let i = 0; i < length; i++) {
        if (i < filled) {
            bar += '█'
        } else {
            bar += '░'
        }
    }

    return `[${bar}]`
}

/**
 * 格式化事件结果
 */
function formatEventResult(event) {
    if (!event || !event.result) return ''

    const result = event.result
    const successEmoji = result.success ? '✨' : '💫'
    const affectionEmoji = result.affectionChange > 0 ? '💕' : result.affectionChange < 0 ? '💔' : '➖'

    return `
━━━━━ 事件触发 ━━━━━
${successEmoji} ${result.eventName}: ${result.success ? '成功！' : '失败...'}
🎲 判定: ${result.roll}% / ${result.rate}%
${affectionEmoji} 好感度变化: ${result.affectionChange > 0 ? '+' : ''}${result.affectionChange}`
}

export class Galgame extends plugin {
    constructor() {
        super({
            name: 'AI-Galgame',
            dsc: 'Galgame对话游戏',
            event: 'message',
            priority: 5, // 最高优先级，拦截游戏模式中的所有消息
            rule: [
                {
                    reg: /^#游戏开始(\s+\S+)?$/i,
                    fnc: 'startGame'
                },
                {
                    reg: /^#游戏状态$/i,
                    fnc: 'showStatus'
                },
                {
                    reg: /^#游戏退出$/i,
                    fnc: 'exitGame'
                },
                {
                    reg: /^#游戏结束$/i,
                    fnc: 'endGame'
                },
                {
                    reg: /^#游戏导出(对话)?$/i,
                    fnc: 'exportGame'
                },
                {
                    reg: /^#游戏导入$/i,
                    fnc: 'importGame'
                },
                {
                    reg: /^#游戏角色列表$/i,
                    fnc: 'listCharacters'
                },
                {
                    reg: /^#游戏创建角色$/i,
                    fnc: 'createCharacter'
                },
                {
                    reg: /^#游戏删除角色\s+\S+$/i,
                    fnc: 'deleteCharacter'
                },
                {
                    reg: /^#游戏帮助$/i,
                    fnc: 'showHelp'
                },
                {
                    reg: '',
                    fnc: 'interceptGameMode',
                    log: false
                }
            ]
        })

        registerGalgameReactionListener()
    }
    async interceptGameMode() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        // 基础检查
        if (isSelfMessage(e)) return false
        if (isMessageProcessed(e)) return false

        // 检查用户是否在游戏模式
        const inGame = galgameService.isUserInGame(groupId, userId)
        gameLogger.debug(`用户游戏状态检查: groupId=${groupId}, userId=${userId}, inGame=${inGame}`)
        if (!inGame) {
            return false
        }

        // 解析消息
        const parsedMessage = await parseUserMessage(e, {
            handleReplyText: true,
            handleReplyImage: true,
            handleForward: true,
            handleAtMsg: true,
            excludeAtBot: true,
            includeSenderInfo: false
        })

        // 提取文本和图片
        const textParts = []
        const imageUrls = []

        for (const content of parsedMessage.content || []) {
            switch (content.type) {
                case 'text':
                    if (content.text?.trim()) {
                        textParts.push(content.text.trim())
                    }
                    break
                case 'image':
                    if (content.url) {
                        imageUrls.push(content.url)
                    }
                    textParts.push('[图片]')
                    break
                case 'at_info':
                    textParts.push(`[@${content.at?.display || content.at?.name || '某人'}]`)
                    break
                case 'face':
                    textParts.push(`[表情:${content.id || ''}]`)
                    break
                case 'file':
                    textParts.push(`[文件:${content.name || '未知'}]`)
                    break
                case 'video':
                    textParts.push('[视频]')
                    break
                case 'record':
                    textParts.push('[语音]')
                    break
                case 'forward':
                    textParts.push('[转发消息]')
                    break
            }
        }

        const textContent = textParts.join(' ').trim()
        if (/^#/.test(textContent)) {
            return false
        }
        if (!textContent) {
            return false
        }

        // 如果是@机器人，直接触发
        if (e.atBot) {
            markMessageProcessed(e)
            gameLogger.info(`游戏模式对话(@触发): ${textContent}`)
            await this.processGameDialogue(textContent, imageUrls)
            return true
        }

        // 非@触发时，使用随机概率（类似伪人模式）
        let probability = config.get('game.probability')
        if (probability === undefined || probability === null || isNaN(Number(probability))) {
            probability = 0.3 // 游戏模式默认30%概率
        } else {
            probability = Number(probability)
            if (probability > 1) {
                probability = probability / 100
            }
        }
        probability = Math.max(0, Math.min(1, probability))

        // 概率为0时不触发
        if (probability === 0) {
            return false
        }

        const randomValue = Math.random()
        if (randomValue > probability) {
            gameLogger.debug(`游戏模式跳过: random=${randomValue.toFixed(4)} > probability=${probability}`)
            return false
        }

        markMessageProcessed(e)
        gameLogger.debug(`游戏模式对话(概率触发): ${textContent}`)
        await this.processGameDialogue(textContent, imageUrls)
        return true
    }

    /**
     * 处理游戏模式中的对话
     * @param {string} message - 消息文本
     * @param {string[]} imageUrls - 图片URL列表
     */
    async processGameDialogue(message, imageUrls = []) {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            if (!gameSession) {
                return
            }

            const bot = e.bot || Bot
            const pendingEvent = galgameService.findUserPendingEvent(groupId, userId)
            if (pendingEvent && pendingEvent.type === 'event') {
                await this.handleEventWithCustomInput(bot, groupId, userId, gameSession, pendingEvent, message)
                return
            }
            if (e.message_id) {
                cacheUserMessage(groupId, e.message_id, userId)
            }

            // 发送对话（支持图片）
            const result = await galgameService.sendMessage({
                userId,
                groupId,
                message,
                characterId: gameSession.characterId,
                event: e,
                imageUrls
            })

            // 处理回复
            const responseInfo = await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)

            // 如果有选项或事件，保存待选择项
            if (responseInfo.hasOptions && e.message_id) {
                galgameService.savePendingChoice(groupId, e.message_id, userId, 'option', result.options)

                for (let i = 0; i < Math.min(result.options.length, 4); i++) {
                    try {
                        await sendReaction(e, e.message_id, CHOICE_EMOJIS[i].id, true)
                        await new Promise(r => setTimeout(r, 300))
                    } catch (err) {
                        gameLogger.debug(` 添加选项表情失败: ${err.message}`)
                    }
                }
            }

            if (responseInfo.hasEvent && e.message_id) {
                galgameService.savePendingChoice(
                    groupId,
                    e.message_id,
                    userId,
                    'event',
                    result.eventOptions,
                    result.event
                )

                for (let i = 0; i < Math.min(result.eventOptions.length, 4); i++) {
                    try {
                        await sendReaction(e, e.message_id, CHOICE_EMOJIS[i].id, true)
                        await new Promise(r => setTimeout(r, 300))
                    } catch (err) {
                        gameLogger.debug(` 添加事件表情失败: ${err.message}`)
                    }
                }
            }
        } catch (err) {
            gameLogger.error(' 游戏对话失败:', err)
            await this.reply(`❌ 对话失败: ${err.message}`)
        }
    }

    /**
     * 开始游戏
     */
    async startGame() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null
        const match = e.msg.match(/^#游戏开始(?:\s+(\S+))?$/i)
        const characterId = match?.[1] || 'default'

        try {
            await galgameService.init()

            // 设置游戏状态
            await galgameService.setUserGameState(groupId, userId, characterId, true)

            // 获取角色和会话信息
            const character = await galgameService.getCharacter(characterId)
            const hasHistory = await galgameService.hasHistory(userId, characterId, groupId)

            // 有历史记录 - 静默开启游戏模式，不发送任何消息
            if (hasHistory) {
                gameLogger.info(` 用户 ${userId} 继续游戏，角色: ${characterId}`)
                return true
            }

            // 无历史记录 - 检查是否有自定义提示词
            const hasCustomPrompt = character?.system_prompt
            const bot = e.bot || Bot

            if (hasCustomPrompt) {
                // 有自定义提示词 - 请求AI生成欢迎词
                const result = await galgameService.sendMessage({
                    userId,
                    groupId,
                    message: '[游戏开始，请向玩家打招呼]',
                    characterId,
                    event: e
                })
                await sendGalgameResponse(bot, groupId, userId, characterId, result)
            } else {
                const envSettings = await galgameService.initializeEnvironment(userId, characterId, e, groupId)
                const openingResult = await galgameService.generateOpeningContext(userId, characterId, e, groupId)

                const session = await galgameService.getOrCreateSession(userId, characterId, groupId)
                const level = getAffectionLevel(session.affection)

                // 记录到历史
                await galgameService.addHistory(session.id, 'assistant', openingResult.response)

                // 构建完整开场消息
                let openingMsg = ''
                if (openingResult.scene) {
                    openingMsg += `📍 ${openingResult.scene.name}`
                    if (openingResult.scene.description) {
                        openingMsg += ` - ${openingResult.scene.description}`
                    }
                    openingMsg += '\n━━━━━━━━━━━━━━━━\n'
                }
                openingMsg += openingResult.response
                openingMsg += `\n${level.emoji} ${level.name} (${session.affection})`

                // 分段发送长消息
                const paragraphs = openingMsg.split(/\n\n+/).filter(p => p.trim())
                if (paragraphs.length > 1) {
                    for (const paragraph of paragraphs) {
                        await sendGroupMessage(bot, groupId, paragraph.trim())
                        await new Promise(r => setTimeout(r, 800))
                    }
                } else {
                    await sendGroupMessage(bot, groupId, openingMsg)
                }
            }
        } catch (err) {
            gameLogger.error(' 开始游戏失败:', err)
            await this.reply(`❌ 开始游戏失败: ${err.message}`)
        }

        return true
    }

    /**
     * 退出游戏模式（保留数据，下次继续）
     */
    async exitGame() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        const wasInGame = galgameService.isUserInGame(groupId, userId)
        await galgameService.exitGame(groupId, userId)

        if (wasInGame) {
            await this.reply('✅ 已退出游戏模式\n💾 对话数据已保存\n📝 下次使用 #游戏开始 可继续')
        } else {
            await this.reply('ℹ️ 你当前不在游戏模式中')
        }

        return true
    }

    /**
     * 结束游戏（清空所有数据，重新开始）
     */
    async endGame() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            const characterId = gameSession?.characterId || 'default'

            // 重置会话数据并退出游戏模式
            await galgameService.resetSession(userId, characterId, groupId)

            await this.reply('✅ 游戏已结束\n🗑️ 所有数据已清空\n📝 下次使用 #游戏开始 将开始全新游戏')
        } catch (err) {
            gameLogger.error(' 结束游戏失败:', err)
            await this.reply(`❌ 结束游戏失败: ${err.message}`)
        }

        return true
    }

    /**
     * 导出游戏对话为JSON文件
     */
    async exportGame() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            const characterId = gameSession?.characterId || 'default'

            // 获取导出数据（不含环境提示词）
            const exportData = await galgameService.exportSession(userId, characterId, false, groupId)

            if (!exportData) {
                await this.reply('❌ 没有找到游戏数据')
                return true
            }

            // 生成文件名和内容
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            const filename = `galgame_${characterId}_${timestamp}.json`
            const jsonContent = JSON.stringify(exportData, null, 2)

            // 写入临时文件
            const tempDir = os.tmpdir()
            const tempFilePath = path.join(tempDir, filename)
            fs.writeFileSync(tempFilePath, jsonContent, 'utf8')

            // 尝试使用icqq发送文件
            const bot = e.bot || Bot
            let fileSent = false

            if (groupId && bot?.pickGroup) {
                try {
                    const group = bot.pickGroup(parseInt(groupId))
                    // 尝试多种方式发送文件
                    if (group?.fs?.upload) {
                        await group.fs.upload(tempFilePath)
                        fileSent = true
                        await this.reply(`✅ 对话已导出\n📁 文件: ${filename}\n💡 使用 #游戏导入 恢复`)
                    } else if (group?.sendFile) {
                        await group.sendFile(tempFilePath)
                        fileSent = true
                        await this.reply(`✅ 对话已导出\n📁 文件: ${filename}\n💡 使用 #游戏导入 恢复`)
                    } else {
                        gameLogger.warn(' 群文件API不可用')
                    }
                } catch (fileErr) {
                    gameLogger.warn(' 文件发送失败，使用文本方式:', fileErr.message)
                }
            }

            // 文件发送失败时使用文本方式
            if (!fileSent) {
                if (jsonContent.length < 4000) {
                    await this.reply(
                        `📋 游戏数据导出\n━━━━━━━━━━━━━━━━\n\`\`\`json\n${jsonContent}\n\`\`\`\n━━━━━━━━━━━━━━━━\n💡 复制上方JSON，使用 #游戏导入 恢复`
                    )
                } else {
                    await this.reply(
                        `⚠️ 数据过长(${jsonContent.length}字符)\n📁 文件已保存: ${tempFilePath}\n💡 请手动获取文件`
                    )
                }
            }

            // 清理临时文件（延迟删除，确保发送完成）
            setTimeout(() => {
                try {
                    fs.unlinkSync(tempFilePath)
                } catch {}
            }, 60000)
        } catch (err) {
            gameLogger.error(' 导出失败:', err)
            await this.reply(`❌ 导出失败: ${err.message}`)
        }

        return true
    }

    /**
     * 导入游戏数据
     */
    async importGame() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        // 提示用户发送JSON数据
        await this.reply('📥 请发送导出的JSON数据（60秒内有效）')

        // 设置等待上下文
        this.setContext('awaitImportData')
        return true
    }

    /**
     * 处理导入数据
     */
    async awaitImportData() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null
        let msg = e.msg?.trim()

        if (msg === '取消') {
            this.finish('awaitImportData')
            await this.reply('❌ 已取消导入')
            return true
        }

        try {
            // 检查是否是文件消息
            if (e.file || (e.message && e.message.some(m => m.type === 'file'))) {
                const fileInfo = e.file || e.message.find(m => m.type === 'file')
                if (fileInfo) {
                    // 尝试下载文件内容
                    const bot = e.bot || Bot
                    let fileUrl = fileInfo.url

                    // 如果没有直接URL，尝试获取
                    if (!fileUrl && fileInfo.fid && groupId && bot?.pickGroup) {
                        try {
                            const group = bot.pickGroup(parseInt(groupId))
                            fileUrl = await group.getFileUrl(fileInfo.fid)
                        } catch {}
                    }

                    if (fileUrl) {
                        const response = await fetch(fileUrl)
                        msg = await response.text()
                    } else {
                        throw new Error('无法获取文件内容，请直接发送JSON文本')
                    }
                }
            }

            if (!msg) {
                throw new Error('未收到有效数据')
            }

            // 解析JSON数据
            const importData = JSON.parse(msg)

            // 验证数据格式
            if (!importData.version || !importData.character || !importData.session) {
                throw new Error('无效的数据格式')
            }

            // 导入数据（传入 groupId 清除旧会话）
            const result = await galgameService.importSession(userId, importData, groupId)

            this.finish('awaitImportData')

            // 设置游戏状态（importSession 已设置 in_game=1，这里更新内存状态）
            await galgameService.setUserGameState(groupId, userId, result.characterId, true)

            // 开始新对话
            const bot = e.bot || Bot
            const aiResult = await galgameService.sendMessage({
                userId,
                groupId,
                message: '[数据已导入，请继续之前的对话]',
                characterId: result.characterId,
                event: e
            })

            await this.reply(`✅ 导入成功！\n角色: ${result.characterName}\n好感度: ${result.affection}`)
            await sendGalgameResponse(bot, groupId, userId, result.characterId, aiResult)
        } catch (err) {
            gameLogger.error(' 导入失败:', err)
            await this.reply(`❌ 导入失败: ${err.message}\n请发送正确的JSON数据或"取消"`)
        }

        return true
    }

    /**
     * 使用自定义文本输入处理事件
     */
    async handleEventWithCustomInput(bot, groupId, userId, gameSession, pendingEvent, customInput) {
        try {
            // 处理事件的自定义输入
            const eventResult = processEventWithCustomInput(pendingEvent.eventInfo, customInput, pendingEvent.options)

            // 更新好感度
            if (eventResult.affectionChange !== 0) {
                await galgameService.updateAffection(
                    String(userId),
                    gameSession.characterId,
                    eventResult.affectionChange
                )
            }

            // 记录事件已触发
            await galgameService.addTriggeredEvent(String(userId), gameSession.characterId, pendingEvent.eventInfo.name)

            // 移除待处理的事件
            galgameService.removePendingChoiceByKey(pendingEvent.key)

            // 获取更新后的状态
            const status = await galgameService.getStatus(String(userId), gameSession.characterId)

            // 发送事件结果
            const resultEmoji = eventResult.success ? '✨' : '💫'
            const affectionEmoji = eventResult.affectionChange > 0 ? '💕' : eventResult.affectionChange < 0 ? '💔' : ''

            let resultMsg = `━━━ 事件结果 ━━━\n`
            resultMsg += `${resultEmoji} ${eventResult.eventName}: ${eventResult.message}\n`
            resultMsg += `📝 你的行动: ${eventResult.optionText}\n`
            resultMsg += `🎲 判定: ${eventResult.roll}% / ${eventResult.rate}%\n`
            if (eventResult.affectionChange !== 0) {
                resultMsg += `${affectionEmoji} 好感度 ${eventResult.affectionChange > 0 ? '+' : ''}${eventResult.affectionChange}\n`
            }
            resultMsg += `\n${status.level.emoji} 当前好感度: ${status.affection} (${status.level.name})`

            await this.reply(resultMsg)
        } catch (err) {
            gameLogger.error(' 处理事件自定义输入失败:', err)
            await this.reply(`❌ 处理失败: ${err.message}`)
        }
    }

    /**
     * 显示状态
     */
    async showStatus() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            const characterId = gameSession?.characterId || 'default'
            const inGame = galgameService.isUserInGame(groupId, userId)

            const status = await galgameService.getStatus(userId, characterId)

            let statusText = formatStatus(status)
            statusText += `\n🎮 游戏模式: ${inGame ? '开启' : '关闭'}`

            await this.reply(statusText)
        } catch (err) {
            gameLogger.error(' 获取状态失败:', err)
            await this.reply(`❌ 获取状态失败: ${err.message}`)
        }

        return true
    }

    /**
     * 列出角色
     */
    async listCharacters() {
        try {
            const characters = await galgameService.listPublicCharacters()

            if (characters.length === 0) {
                await this.reply(`📋 角色列表
━━━━━━━━━━━━━━━━
暂无公开角色

💡 使用 #游戏创建角色 来创建自定义角色
💡 或直接使用 #游戏开始 使用默认角色`)
                return true
            }

            let reply = `📋 公开角色列表\n━━━━━━━━━━━━━━━━`
            for (const char of characters) {
                reply += `\n\n🎭 ${char.name}`
                reply += `\n   ID: ${char.character_id}`
                if (char.description) {
                    reply += `\n   ${char.description.substring(0, 50)}...`
                }
            }
            reply += `\n\n💡 使用 #游戏开始 <角色ID> 选择角色`

            await this.reply(reply)
        } catch (err) {
            gameLogger.error(' 获取角色列表失败:', err)
            await this.reply(`❌ 获取角色列表失败: ${err.message}`)
        }

        return true
    }

    /**
     * 创建角色
     */
    async createCharacter() {
        const e = this.e

        await this.reply(`🎭 创建自定义角色

请按以下格式发送角色信息：
━━━━━━━━━━━━━━━━
角色ID: (唯一标识，英文)
角色名: (显示名称)
描述: (角色性格、背景等设定)
初始台词: (开始游戏时的台词)
公开: (是/否，是否允许他人使用)
━━━━━━━━━━━━━━━━

示例：
角色ID: tsundere_girl
角色名: 傲娇少女
描述: 一个表面高冷但内心温柔的傲娇少女，嘴上说着讨厌但身体很诚实
初始台词: 哼，你就是新来的吗？别以为我会对你特别好什么的！
公开: 是`)

        this.setContext('awaitCharacterData')
        return true
    }

    /**
     * 处理角色创建数据
     */
    async awaitCharacterData() {
        const e = this.e
        const userId = String(e.user_id)
        const msg = e.msg

        // 取消创建
        if (msg === '取消' || msg === '#取消') {
            this.finish('awaitCharacterData')
            await this.reply('❌ 已取消创建角色')
            return true
        }

        try {
            // 解析角色数据
            const lines = msg.split('\n')
            const data = {}

            for (const line of lines) {
                const match = line.match(/^(.+?)[:：]\s*(.+)$/)
                if (match) {
                    const key = match[1].trim()
                    const value = match[2].trim()

                    if (key.includes('ID') || key.includes('id')) {
                        data.character_id = value.replace(/\s+/g, '_').toLowerCase()
                    } else if (key.includes('名')) {
                        data.name = value
                    } else if (key.includes('描述') || key.includes('设定')) {
                        data.description = value
                    } else if (key.includes('台词') || key.includes('初始')) {
                        data.initial_message = value
                    } else if (key.includes('公开')) {
                        data.is_public = value === '是' || value === 'yes' || value === '1'
                    }
                }
            }

            if (!data.character_id || !data.name) {
                await this.reply('❌ 格式错误，请至少提供角色ID和角色名\n发送"取消"取消创建')
                return true
            }

            data.created_by = userId

            // 保存角色
            const character = await galgameService.saveCharacter(data)

            this.finish('awaitCharacterData')
            await this.reply(`✅ 角色创建成功！

🎭 ${character.name}
📝 ID: ${character.character_id}
🌐 公开: ${character.is_public ? '是' : '否'}

使用 #游戏开始 ${character.character_id} 开始游戏`)
        } catch (err) {
            gameLogger.error(' 创建角色失败:', err)
            await this.reply(`❌ 创建失败: ${err.message}\n发送"取消"取消创建`)
        }

        return true
    }

    /**
     * 删除角色
     */
    async deleteCharacter() {
        const e = this.e
        const userId = String(e.user_id)
        const match = e.msg.match(/^#游戏删除角色\s+(\S+)$/i)
        const characterId = match?.[1]

        if (!characterId) {
            await this.reply('❌ 请指定要删除的角色ID')
            return true
        }

        try {
            const result = await galgameService.deleteCharacter(characterId, userId)

            if (result.success) {
                await this.reply(`✅ 角色 ${characterId} 已删除`)
            } else {
                await this.reply(`❌ ${result.message}`)
            }
        } catch (err) {
            gameLogger.error(' 删除角色失败:', err)
            await this.reply(`❌ 删除失败: ${err.message}`)
        }

        return true
    }

    /**
     * 显示帮助
     */
    async showHelp() {
        const help = `🎮 游戏模式帮助
━━━━━━━━━━━━━━━━

📌 基础命令：
• #游戏开始 [角色ID] - 进入游戏
• #游戏状态 - 查看好感度
• #游戏退出 - 暂时退出（保留数据）
• #游戏结束 - 结束游戏（清空数据）
• #游戏导出 - 导出对话JSON
• #游戏导入 - 导入对话数据

📌 角色管理：
• #游戏角色列表 - 查看角色
• #游戏创建角色 - 创建角色
• #游戏删除角色 <ID> - 删除

📌 游戏模式：
• 直接发消息即可对话
• #开头的命令正常使用
• 选项用表情回应或文字

📌 特性：
• 事件由AI动态生成
• 每个事件只触发一次
• 群聊用户独立

📌 好感度等级：
😠厌恶 → 😒反感 → 😐冷淡 → 🙂陌生
😊熟悉 → 😄好感 → 🥰喜欢 → 💕爱慕 → 💖挚爱`

        await this.reply(help)
        return true
    }
}
