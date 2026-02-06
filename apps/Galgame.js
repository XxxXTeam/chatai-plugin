import fs from 'fs'
import path from 'path'
import os from 'os'
import config from '../config/config.js'
// 从 galgame 内部模块导入
import {
    galgameService,
    gameRenderer,
    CHOICE_EMOJIS,
    OPTION_EMOJIS,
    MESSAGE_CACHE_TTL,
    getAffectionLevel,
    processEventChoice,
    processEventWithCustomInput,
    generateRandomRewards,
    EVENT_TYPES,
    DAILY_EVENTS,
    EXPLORE_EVENTS,
    ITEM_TYPE_LABELS,
    ITEM_TYPE_ICONS
} from '../src/services/galgame/index.js'
import { getBotIds, isMessageProcessed, markMessageProcessed, isSelfMessage } from '../src/utils/messageDedup.js'
import { parseReactionEvent, sendGroupMessage, getBot, sendReaction } from '../src/utils/eventAdapter.js'
import { parseUserMessage } from '../src/utils/messageParser.js'
import chatLogger from '../src/core/utils/logger.js'
import {
    editSessions,
    generateUUID,
    SESSION_EXPIRE_MS,
    EDITABLE_ENV_FIELDS,
    EDITABLE_SESSION_FIELDS,
    PROTECTED_FIELDS
} from '../src/services/routes/gameRoutes.js'
import { getWebServer } from '../src/services/webServer.js'

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

        gameLogger.debug(
            `[Reaction] 收到表情事件: emojiId=${emojiId}, messageId=${messageId}, userId=${userId}, isAdd=${isAdd}, groupId=${groupId}`
        )
        gameLogger.debug(`[Reaction] 原始事件: face_id=${e.face_id}, seq=${e.seq}, isReaction=${e.isReaction}`)

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

        // 环境确认/重随（表情回应）
        if (pendingChoice.type === 'env_confirm') {
            const isConfirm = emojiNum === 123 // 👍 = 确认 (QQ emoji ID 123)
            const charId = pendingChoice.eventInfo?.characterId
            const envSettings = pendingChoice.eventInfo?.envSettings

            // 同时清除用户级别的pending
            galgameService.removePendingChoice(groupId, `env_${userId}`)

            if (isConfirm && charId) {
                gameLogger.info(`[Reaction] 环境确认: 用户 ${userId} 通过表情确认开始`)
                try {
                    await sendGroupMessage(bot, groupId, '✅ 正在生成开场剧情...')
                    const openingResult = await galgameService.generateOpeningContext(
                        String(userId),
                        charId,
                        e,
                        groupId
                    )
                    const session = await galgameService.getOrCreateSession(String(userId), charId, groupId)
                    const level = getAffectionLevel(session.affection)
                    await galgameService.addHistory(session.id, 'assistant', openingResult.response)

                    let openingMsg = ''
                    if (envSettings?.summary) {
                        openingMsg += `${envSettings.summary}\n━━━━━━━━━━━━━━━━\n`
                    }
                    if (openingResult.scene) {
                        openingMsg += `📍 ${openingResult.scene.name}`
                        if (openingResult.scene.description) openingMsg += ` - ${openingResult.scene.description}`
                        openingMsg += '\n━━━━━━━━━━━━━━━━\n'
                    }
                    openingMsg += openingResult.response
                    openingMsg += `\n${level.emoji} ${level.name} (${session.affection})`
                    await sendGroupMessage(bot, groupId, openingMsg)
                } catch (err) {
                    gameLogger.error('确认开始游戏失败:', err)
                    await sendGroupMessage(bot, groupId, `❌ 生成开场失败: ${err.message}`)
                }
            } else if (charId) {
                // 重随
                gameLogger.info(`[Reaction] 环境重随: 用户 ${userId} 通过表情重随`)
                try {
                    await sendGroupMessage(bot, groupId, '🔄 正在重新随机...')
                    await galgameService.saveSessionSettings(String(userId), charId, null, groupId)
                    const newEnv = await galgameService.initializeEnvironment(String(userId), charId, e, groupId)

                    const fieldMap = [
                        { key: 'name', emoji: '👤', label: '角色名' },
                        { key: 'world', emoji: '🌍', label: '世界观' },
                        { key: 'identity', emoji: '💼', label: '身份' },
                        { key: 'personality', emoji: '💭', label: '性格' },
                        { key: 'likes', emoji: '❤️', label: '喜好' },
                        { key: 'dislikes', emoji: '❌', label: '厌恶' },
                        { key: 'background', emoji: '📖', label: '背景' },
                        { key: 'secret', emoji: '🔒', label: '秘密' },
                        { key: 'scene', emoji: '📍', label: '场景' },
                        { key: 'meetingReason', emoji: '🤝', label: '相遇' }
                    ]
                    let previewMsg = '🎲 重新随机的角色设定：\n━━━━━━━━━━━━━━━━\n'
                    for (const f of fieldMap) {
                        const v = newEnv?.[f.key]
                        previewMsg += `${f.emoji} ${f.label}: ${!v || v === '???' ? '???（对话中揭示）' : v}\n`
                    }
                    previewMsg += '━━━━━━━━━━━━━━━━\n回复「确认」开始游戏 | 回复「重随」重新生成'

                    const res = await sendGroupMessage(bot, groupId, previewMsg)
                    const newMsgId = res?.message_id || res?.data?.message_id
                    if (newMsgId) {
                        galgameService.savePendingChoice(
                            groupId,
                            newMsgId,
                            String(userId),
                            'env_confirm',
                            [
                                { text: '确认', emoji: '👍' },
                                { text: '重随', emoji: '🔄' }
                            ],
                            { characterId: charId, envSettings: newEnv }
                        )
                    }
                    galgameService.savePendingChoice(
                        groupId,
                        `env_${userId}`,
                        String(userId),
                        'env_confirm',
                        [
                            { text: '确认', emoji: '👍' },
                            { text: '重随', emoji: '🔄' }
                        ],
                        { characterId: charId, envSettings: newEnv, previewMessageId: newMsgId }
                    )
                } catch (err) {
                    gameLogger.error('重新随机失败:', err)
                    await sendGroupMessage(bot, groupId, `❌ 重新随机失败: ${err.message}`)
                }
            }
            return
        }

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
            // 事件选项 - 随机生成概率和奖惩
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
            // 更新信任度
            if (eventResult.trustChange !== 0) {
                await galgameService.updateTrust(
                    String(userId),
                    gameSession.characterId,
                    eventResult.trustChange,
                    groupId
                )
            }
            // 更新金币
            if (eventResult.goldChange !== 0) {
                await galgameService.updateGold(
                    String(userId),
                    gameSession.characterId,
                    eventResult.goldChange,
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

            // 发送结果给模型让其继续剧情
            const systemMsg = `[系统:玩家选择了选项${optionIndex}|${eventResult.success ? '成功' : '失败'}|好感${eventResult.affectionChange > 0 ? '+' : ''}${eventResult.affectionChange},信任${eventResult.trustChange > 0 ? '+' : ''}${eventResult.trustChange},金币${eventResult.goldChange > 0 ? '+' : ''}${eventResult.goldChange}]`
            const result = await galgameService.sendMessage({
                userId: String(userId),
                groupId,
                message: `${systemMsg}\n玩家选择: ${eventResult.optionText}`,
                characterId: gameSession.characterId
            })

            await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)
        }
    } catch (err) {
        gameLogger.error(' 处理表情回应失败:', err)
    }
}

async function sendGalgameResponse(bot, groupId, userId, characterId, result) {
    const hasOptions = result.options && result.options.length > 0
    const hasEvent = result.event && result.eventOptions && result.eventOptions.length > 0
    const botId = bot?.uin || Bot?.uin || 10000
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

    // 构建基础回复
    let replyText = result.response

    // 构建属性变化提示
    let changeTexts = []
    if (result.affectionChange !== 0) {
        const emoji = result.affectionChange > 0 ? '💕' : '💔'
        changeTexts.push(`${emoji}好感${result.affectionChange > 0 ? '+' : ''}${result.affectionChange}`)
    }
    if (result.trustChange !== 0) {
        const emoji = result.trustChange > 0 ? '🤝' : '⚔️'
        changeTexts.push(`${emoji}信任${result.trustChange > 0 ? '+' : ''}${result.trustChange}`)
    }
    if (result.goldChange !== 0) {
        const emoji = result.goldChange > 0 ? '💰' : '💸'
        changeTexts.push(`${emoji}金币${result.goldChange > 0 ? '+' : ''}${result.goldChange}`)
    }
    if (result.obtainedItems?.length > 0) {
        changeTexts.push(`📦获得: ${result.obtainedItems.map(i => i.name).join('、')}`)
    }
    if (result.usedItems?.length > 0) {
        changeTexts.push(`🔧使用: ${result.usedItems.join('、')}`)
    }
    if (result.requiredItems?.length > 0) {
        changeTexts.push(`🔒需要: ${result.requiredItems.join('、')}`)
    }
    if (changeTexts.length > 0) {
        replyText += `\n\n${changeTexts.join(' | ')}`
    }

    // 状态行
    const trustLevel = result.session.trustLevel || { emoji: '🤔', name: '观望' }
    const statusLine = `${result.session.level.emoji}${result.session.level.name}(${result.session.affection}) ${trustLevel.emoji}${trustLevel.name}(${result.session.trust || 10}) 💰${result.session.gold || 100}`
    const forwardMsgs = []

    // 场景信息（如果有）
    if (headerInfo.trim()) {
        forwardMsgs.push({
            message: headerInfo.trim(),
            nickname: '📍 场景',
            user_id: botId
        })
    }

    // 主要对话内容
    forwardMsgs.push({
        message: replyText,
        nickname: result.session?.characterName || '角色',
        user_id: botId
    })

    // 状态信息
    forwardMsgs.push({
        message: statusLine,
        nickname: '💫 状态',
        user_id: botId
    })

    // 如果有对话选项
    if (hasOptions) {
        let optionsText = '━━━ 请选择 ━━━\n发数字1-4或贴对应表情选择\n\n'
        for (let i = 0; i < Math.min(result.options.length, 4); i++) {
            const emoji = OPTION_EMOJIS[i]?.name || `${i + 1}`
            optionsText += `${emoji} ${result.options[i].text}\n`
        }
        forwardMsgs.push({
            message: optionsText.trim(),
            nickname: '🎯 选项',
            user_id: botId
        })
    }

    // 如果触发了事件
    if (hasEvent) {
        let eventText = `━━━ 触发事件 ━━━\n`
        eventText += `📌 ${result.event.name}\n`
        eventText += `${result.event.description}\n\n`
        eventText += `发数字1-4或贴对应表情选择:\n`
        for (let i = 0; i < Math.min(result.eventOptions.length, 4); i++) {
            const emoji = OPTION_EMOJIS[i]?.name || `${i + 1}`
            eventText += `${emoji} ${result.eventOptions[i].text}\n`
        }
        forwardMsgs.push({
            message: eventText.trim(),
            nickname: '⚡ 事件',
            user_id: botId
        })
    }

    // 尝试发送合并转发
    let sent = false
    let sentMsgInfo = null
    try {
        if (groupId && bot?.pickGroup && bot?.makeForwardMsg) {
            const group = bot.pickGroup(parseInt(groupId))
            const forwardMsg = await bot.makeForwardMsg(forwardMsgs)
            if (forwardMsg) {
                sentMsgInfo = await group.sendMsg(forwardMsg)
                sent = true
            }
        }
    } catch (err) {
        gameLogger.debug(`合并转发失败，使用普通发送: ${err.message}`)
    }

    // 合并转发失败，使用普通发送（但合并为一条）
    if (!sent) {
        let fullText = ''
        if (headerInfo.trim()) {
            fullText += headerInfo.trim() + '\n━━━━━━━━━━━━━━━━\n'
        }
        fullText += replyText + '\n\n' + statusLine

        if (hasOptions) {
            fullText += '\n\n━━━ 请选择 ━━━\n发数字1-4或贴对应表情选择\n'
            for (let i = 0; i < Math.min(result.options.length, 4); i++) {
                const emoji = OPTION_EMOJIS[i]?.name || `${i + 1}`
                fullText += `${emoji} ${result.options[i].text}\n`
            }
        }

        if (hasEvent) {
            fullText += `\n\n━━━ 触发事件: ${result.event.name} ━━━\n`
            fullText += `${result.event.description}\n发数字1-4或贴对应表情选择:\n`
            for (let i = 0; i < Math.min(result.eventOptions.length, 4); i++) {
                const emoji = OPTION_EMOJIS[i]?.name || `${i + 1}`
                fullText += `${emoji} ${result.eventOptions[i].text}\n`
            }
        }

        sentMsgInfo = await sendGroupMessage(bot, groupId, fullText.trim())
    }

    // 提取发送消息的seq
    const msgSeq = sentMsgInfo?.seq || sentMsgInfo?.message_id || sentMsgInfo?.rand
    gameLogger.debug(`[sendGalgameResponse] 发送消息seq: ${msgSeq}, info: ${JSON.stringify(sentMsgInfo)}`)

    return {
        hasOptions,
        hasEvent,
        options: result.options,
        event: result.event,
        eventOptions: result.eventOptions,
        msgSeq
    }
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
${level.emoji} 好感: ${level.name} (${status.affection})
${progressBar}
${status.trustLevel?.emoji || '🤔'} 信任: ${status.trustLevel?.name || '观望'} (${status.trust || 10})
${createProgressBar(status.trust || 10, -100, 150)}
💰 金币: ${status.gold || 100}
📦 物品: ${status.items?.length || 0}个`

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
                    reg: /^#(背包|物品|道具)$/i,
                    fnc: 'showInventory'
                },
                {
                    reg: /^#(日常|日常事件)$/i,
                    fnc: 'triggerDailyEvent'
                },
                {
                    reg: /^#(探索|探索事件)$/i,
                    fnc: 'triggerExploreEvent'
                },
                {
                    reg: /^#任务$/i,
                    fnc: 'showCurrentTask'
                },
                {
                    reg: /^#(商店|购买)$/i,
                    fnc: 'triggerShopEvent'
                },
                {
                    reg: /^#(打工|赚钱|工作)$/i,
                    fnc: 'triggerWorkEvent'
                },
                {
                    reg: /^#(物品|背包)$/i,
                    fnc: 'showItems'
                },
                {
                    reg: /^#游戏(在线)?编辑$/i,
                    fnc: 'onlineEdit'
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

        // 检查是否是环境确认/重随回复
        const envPending = galgameService.getPendingChoice(groupId, `env_${userId}`)
        if (envPending && envPending.type === 'env_confirm') {
            const lowerText = textContent.toLowerCase()
            if (/^(确认|开始|ok|yes|好|可以)$/i.test(lowerText)) {
                markMessageProcessed(e)
                gameLogger.info(`环境确认: 用户 ${userId} 确认开始游戏`)
                galgameService.removePendingChoice(groupId, `env_${userId}`)
                if (envPending.eventInfo?.previewMessageId) {
                    galgameService.removePendingChoice(groupId, envPending.eventInfo.previewMessageId)
                }
                await this.confirmGameStart(envPending.eventInfo.characterId, envPending.eventInfo.envSettings)
                return true
            }
            if (/^(重随|重新随机|换一个|重来|reroll)$/i.test(lowerText)) {
                markMessageProcessed(e)
                gameLogger.info(`环境重随: 用户 ${userId} 要求重新随机`)
                galgameService.removePendingChoice(groupId, `env_${userId}`)
                if (envPending.eventInfo?.previewMessageId) {
                    galgameService.removePendingChoice(groupId, envPending.eventInfo.previewMessageId)
                }
                // 清除已保存的环境设定，重新生成
                const charId = envPending.eventInfo.characterId
                await galgameService.saveSessionSettings(userId, charId, null, groupId)
                // 重新触发游戏开始
                await this.rerollEnvironment(charId)
                return true
            }
        }

        // 检查是否是数字选择（1-4）
        const numberMatch = textContent.match(/^([1-4])$/)
        if (numberMatch) {
            const optionIndex = parseInt(numberMatch[1])
            const pendingChoice = galgameService.findUserPendingChoice(groupId, userId)
            if (pendingChoice) {
                markMessageProcessed(e)
                gameLogger.debug(`游戏模式选项选择: 用户选择了选项 ${optionIndex}`)
                await this.handleNumberSelection(optionIndex, pendingChoice)
                return true
            }
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

            // 如果有选项或事件，保存待选择项（用回复消息的seq匹配回调）
            const msgSeq = responseInfo.msgSeq
            if (responseInfo.hasOptions && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'option', result.options)

                for (let i = 0; i < Math.min(result.options.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
                        await new Promise(r => setTimeout(r, 300))
                    } catch (err) {
                        gameLogger.debug(` 添加选项表情失败: ${err.message}`)
                    }
                }
            }

            if (responseInfo.hasEvent && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'event', result.eventOptions, result.event)

                for (let i = 0; i < Math.min(result.eventOptions.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
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
                // 随机生成环境设定
                const envSettings = await galgameService.initializeEnvironment(userId, characterId, e, groupId)

                // 构建预览卡片 - 展示角色信息，??? 字段标注为悬念
                const fieldMap = [
                    { key: 'name', emoji: '👤', label: '角色名' },
                    { key: 'world', emoji: '🌍', label: '世界观' },
                    { key: 'identity', emoji: '💼', label: '身份' },
                    { key: 'personality', emoji: '💭', label: '性格' },
                    { key: 'likes', emoji: '❤️', label: '喜好' },
                    { key: 'dislikes', emoji: '❌', label: '厌恶' },
                    { key: 'background', emoji: '📖', label: '背景' },
                    { key: 'secret', emoji: '🔒', label: '秘密' },
                    { key: 'scene', emoji: '📍', label: '场景' },
                    { key: 'meetingReason', emoji: '🤝', label: '相遇' }
                ]

                let previewMsg = '🎲 随机到的角色设定：\n━━━━━━━━━━━━━━━━\n'
                for (const field of fieldMap) {
                    const value = envSettings?.[field.key]
                    if (value === '???' || !value) {
                        previewMsg += `${field.emoji} ${field.label}: ???（对话中揭示）\n`
                    } else {
                        previewMsg += `${field.emoji} ${field.label}: ${value}\n`
                    }
                }
                previewMsg += '━━━━━━━━━━━━━━━━\n'
                previewMsg += '回复「确认」开始游戏 | 回复「重随」重新生成'

                // 发送预览消息
                const previewResult = await sendGroupMessage(bot, groupId, previewMsg)
                const messageId = previewResult?.message_id || previewResult?.data?.message_id

                // 存储待确认状态（等待用户确认或重随）
                if (messageId) {
                    galgameService.savePendingChoice(
                        groupId,
                        messageId,
                        userId,
                        'env_confirm',
                        [
                            { text: '确认开始', emoji: '👍' },
                            { text: '重新随机', emoji: '🔄' }
                        ],
                        { characterId, envSettings }
                    )
                }

                // 同时也保存到用户级别的待确认（支持文字回复触发）
                galgameService.savePendingChoice(
                    groupId,
                    `env_${userId}`,
                    userId,
                    'env_confirm',
                    [
                        { text: '确认开始', emoji: '👍' },
                        { text: '重新随机', emoji: '🔄' }
                    ],
                    { characterId, envSettings, previewMessageId: messageId }
                )
            }
        } catch (err) {
            gameLogger.error(' 开始游戏失败:', err)
            await this.reply(`❌ 开始游戏失败: ${err.message}`)
        }

        return true
    }

    /**
     * 确认游戏开始 - 用户确认后生成开场白
     */
    async confirmGameStart(characterId, envSettings) {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null
        const bot = e.bot || Bot

        try {
            await this.reply('✅ 正在生成开场剧情...')
            const openingResult = await galgameService.generateOpeningContext(userId, characterId, e, groupId)
            const session = await galgameService.getOrCreateSession(userId, characterId, groupId)
            const level = getAffectionLevel(session.affection)

            await galgameService.addHistory(session.id, 'assistant', openingResult.response)

            let openingMsg = ''
            if (envSettings?.summary) {
                openingMsg += `${envSettings.summary}\n━━━━━━━━━━━━━━━━\n`
            }
            if (openingResult.scene) {
                openingMsg += `📍 ${openingResult.scene.name}`
                if (openingResult.scene.description) {
                    openingMsg += ` - ${openingResult.scene.description}`
                }
                openingMsg += '\n━━━━━━━━━━━━━━━━\n'
            }
            openingMsg += openingResult.response
            openingMsg += `\n${level.emoji} ${level.name} (${session.affection})`

            const paragraphs = openingMsg.split(/\n\n+/).filter(p => p.trim())
            if (paragraphs.length > 1) {
                for (const paragraph of paragraphs) {
                    await sendGroupMessage(bot, groupId, paragraph.trim())
                    await new Promise(r => setTimeout(r, 800))
                }
            } else {
                await sendGroupMessage(bot, groupId, openingMsg)
            }
        } catch (err) {
            gameLogger.error('确认开始游戏失败:', err)
            await this.reply(`❌ 生成开场失败: ${err.message}`)
        }
    }

    /**
     * 重新随机环境设定
     */
    async rerollEnvironment(characterId) {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null
        const bot = e.bot || Bot

        try {
            await this.reply('🔄 正在重新随机...')
            const envSettings = await galgameService.initializeEnvironment(userId, characterId, e, groupId)

            // 重新展示预览卡片
            const fieldMap = [
                { key: 'name', emoji: '👤', label: '角色名' },
                { key: 'world', emoji: '🌍', label: '世界观' },
                { key: 'identity', emoji: '💼', label: '身份' },
                { key: 'personality', emoji: '💭', label: '性格' },
                { key: 'likes', emoji: '❤️', label: '喜好' },
                { key: 'dislikes', emoji: '❌', label: '厌恶' },
                { key: 'background', emoji: '📖', label: '背景' },
                { key: 'secret', emoji: '🔒', label: '秘密' },
                { key: 'scene', emoji: '📍', label: '场景' },
                { key: 'meetingReason', emoji: '🤝', label: '相遇' }
            ]

            let previewMsg = '🎲 重新随机的角色设定：\n━━━━━━━━━━━━━━━━\n'
            for (const field of fieldMap) {
                const value = envSettings?.[field.key]
                if (value === '???' || !value) {
                    previewMsg += `${field.emoji} ${field.label}: ???（对话中揭示）\n`
                } else {
                    previewMsg += `${field.emoji} ${field.label}: ${value}\n`
                }
            }
            previewMsg += '━━━━━━━━━━━━━━━━\n'
            previewMsg += '回复「确认」开始游戏 | 回复「重随」重新生成'

            const previewResult = await sendGroupMessage(bot, groupId, previewMsg)
            const messageId = previewResult?.message_id || previewResult?.data?.message_id

            // 重新保存待确认状态
            if (messageId) {
                galgameService.savePendingChoice(
                    groupId,
                    messageId,
                    userId,
                    'env_confirm',
                    [
                        { text: '确认开始', emoji: '👍' },
                        { text: '重新随机', emoji: '🔄' }
                    ],
                    { characterId, envSettings }
                )
            }
            galgameService.savePendingChoice(
                groupId,
                `env_${userId}`,
                userId,
                'env_confirm',
                [
                    { text: '确认开始', emoji: '👍' },
                    { text: '重新随机', emoji: '🔄' }
                ],
                { characterId, envSettings, previewMessageId: messageId }
            )
        } catch (err) {
            gameLogger.error('重新随机失败:', err)
            await this.reply(`❌ 重新随机失败: ${err.message}`)
        }
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
            const exportData = await galgameService.exportSession(userId, characterId, false, groupId)

            if (!exportData) {
                await this.reply('❌ 没有找到游戏数据')
                return true
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
            const filename = `galgame_${characterId}_${timestamp}.json`
            const jsonContent = JSON.stringify(exportData, null, 2)
            const tempDir = os.tmpdir()
            const tempFilePath = path.join(tempDir, filename)
            fs.writeFileSync(tempFilePath, jsonContent, 'utf8')
            const bot = e.bot || Bot
            let fileSent = false

            if (groupId && bot?.pickGroup) {
                try {
                    const group = bot.pickGroup(parseInt(groupId))
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
            // 处理事件的自定义输入 - 随机生成概率和奖惩
            const eventResult = processEventWithCustomInput(pendingEvent.eventInfo, customInput, pendingEvent.options)

            // 更新好感度
            if (eventResult.affectionChange !== 0) {
                await galgameService.updateAffection(
                    String(userId),
                    gameSession.characterId,
                    eventResult.affectionChange,
                    groupId
                )
            }
            // 更新信任度
            if (eventResult.trustChange !== 0) {
                await galgameService.updateTrust(
                    String(userId),
                    gameSession.characterId,
                    eventResult.trustChange,
                    groupId
                )
            }
            // 更新金币
            if (eventResult.goldChange !== 0) {
                await galgameService.updateGold(
                    String(userId),
                    gameSession.characterId,
                    eventResult.goldChange,
                    groupId
                )
            }

            // 记录事件已触发
            await galgameService.addTriggeredEvent(
                String(userId),
                gameSession.characterId,
                pendingEvent.eventInfo.name,
                groupId
            )

            // 移除待处理的事件
            galgameService.removePendingChoiceByKey(pendingEvent.key)

            // 发送结果给模型让其继续剧情
            const systemMsg = `[系统:玩家选择了自定义行动|${eventResult.success ? '成功' : '失败'}|好感${eventResult.affectionChange > 0 ? '+' : ''}${eventResult.affectionChange},信任${eventResult.trustChange > 0 ? '+' : ''}${eventResult.trustChange},金币${eventResult.goldChange > 0 ? '+' : ''}${eventResult.goldChange}]`
            const result = await galgameService.sendMessage({
                userId: String(userId),
                groupId,
                message: `${systemMsg}\n玩家的行动: ${customInput}`,
                characterId: gameSession.characterId,
                event: pendingEvent.e
            })

            await sendGalgameResponse(bot, groupId, String(userId), gameSession.characterId, result)
        } catch (err) {
            gameLogger.error(' 处理事件自定义输入失败:', err)
            await this.reply(`❌ 处理失败: ${err.message}`)
        }
    }

    /**
     * 处理数字选择（1-4）
     */
    async handleNumberSelection(optionIndex, pendingChoice) {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null
        const bot = e.bot || Bot

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            if (!gameSession) {
                await this.reply('❌ 游戏会话已过期')
                return
            }

            if (pendingChoice.type === 'option') {
                // 对话选项
                const selectedOption = pendingChoice.options.find(o => o.index === optionIndex)
                if (!selectedOption) {
                    await this.reply('❌ 无效的选项')
                    return
                }

                galgameService.removePendingChoiceByKey(pendingChoice.key)

                const result = await galgameService.sendMessage({
                    userId,
                    groupId,
                    message: `[系统:玩家选择了选项${optionIndex}]\n${selectedOption.text}`,
                    characterId: gameSession.characterId,
                    event: e
                })

                await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)

                // 处理新选项的表情
                const msgSeq = e.seq || e.message_id
                if (result.options?.length > 0 && msgSeq) {
                    galgameService.savePendingChoice(groupId, msgSeq, userId, 'option', result.options)
                }
            } else if (pendingChoice.type === 'event') {
                // 事件选项
                const eventResult = processEventChoice(pendingChoice.eventInfo, optionIndex, pendingChoice.options)

                if (eventResult.affectionChange !== 0) {
                    await galgameService.updateAffection(
                        userId,
                        gameSession.characterId,
                        eventResult.affectionChange,
                        groupId
                    )
                }
                if (eventResult.trustChange !== 0) {
                    await galgameService.updateTrust(userId, gameSession.characterId, eventResult.trustChange, groupId)
                }
                if (eventResult.goldChange !== 0) {
                    await galgameService.updateGold(userId, gameSession.characterId, eventResult.goldChange, groupId)
                }

                await galgameService.addTriggeredEvent(
                    userId,
                    gameSession.characterId,
                    pendingChoice.eventInfo.name,
                    groupId
                )
                galgameService.removePendingChoiceByKey(pendingChoice.key)

                const systemMsg = `[系统:玩家选择了选项${optionIndex}|${eventResult.success ? '成功' : '失败'}|好感${eventResult.affectionChange > 0 ? '+' : ''}${eventResult.affectionChange},信任${eventResult.trustChange > 0 ? '+' : ''}${eventResult.trustChange},金币${eventResult.goldChange > 0 ? '+' : ''}${eventResult.goldChange}]`
                const result = await galgameService.sendMessage({
                    userId,
                    groupId,
                    message: systemMsg,
                    characterId: gameSession.characterId,
                    event: e
                })

                await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)
            }
        } catch (err) {
            gameLogger.error('处理数字选择失败:', err)
            await this.reply(`❌ 选择失败: ${err.message}`)
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

            const status = await galgameService.getStatus(userId, characterId, groupId)

            // 尝试使用图片渲染
            if (gameRenderer.isAvailable()) {
                try {
                    const imageBuffer = await gameRenderer.renderStatus(status)
                    if (imageBuffer) {
                        await this.reply(segment.image(imageBuffer))
                        return true
                    }
                } catch (renderErr) {
                    gameLogger.debug(`图片渲染失败，回退文本: ${renderErr.message}`)
                }
            }

            // 回退到文本显示
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
     * 在线编辑游戏信息
     */
    async onlineEdit() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        try {
            // 检查是否在游戏中
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            if (!gameSession || !gameSession.inGame) {
                await this.reply('❌ 你当前没有进行中的游戏，请先使用 #游戏开始')
                return true
            }

            const characterId = gameSession.characterId || 'default'

            // 获取当前游戏数据
            const settings = await galgameService.getSessionSettings(userId, characterId, groupId)
            const session = await galgameService.getOrCreateSession(userId, characterId, groupId)

            gameLogger.debug(`[Galgame] 在线编辑 - settings: ${JSON.stringify(settings)}`)
            gameLogger.debug(`[Galgame] 在线编辑 - environment: ${JSON.stringify(settings?.environment)}`)

            const gameData = {
                environment: settings?.environment || {},
                session: {
                    affection: session?.affection ?? 10,
                    trust: session?.trust ?? 10,
                    gold: session?.gold ?? 100,
                    relationship: session?.relationship ?? 'stranger'
                }
            }

            gameLogger.info(`[Galgame] 创建编辑会话 gameData: ${JSON.stringify(gameData)}`)

            // 直接创建编辑会话
            const editId = generateUUID()
            const editSession = {
                editId,
                userId: String(userId),
                groupId: String(groupId),
                characterId,
                gameData,
                createdAt: Date.now(),
                expiresAt: Date.now() + SESSION_EXPIRE_MS
            }
            editSessions.set(editId, editSession)
            gameLogger.info(`创建编辑会话: ${editId} for user ${userId}`)

            // 使用 webServer 获取正确的 URL
            const webServer = getWebServer()
            const mountPath = webServer.mountPath || '/chatai'

            // 构建编辑链接列表（类似登录链接）
            const editUrls = []

            // 本地地址
            if (webServer.addresses?.local) {
                for (const addr of webServer.addresses.local) {
                    editUrls.push(`${addr}${mountPath}/game-edit?code=${editId}`)
                }
            } else {
                editUrls.push(`http://127.0.0.1:${webServer.port}${mountPath}/game-edit?code=${editId}`)
            }

            // 公网地址
            const configPublicUrl = config.get('web.publicUrl')
            let publicEditUrl = null
            if (configPublicUrl) {
                publicEditUrl = `${configPublicUrl.replace(/\/$/, '')}${mountPath}/game-edit?code=${editId}`
            } else if (webServer.addresses?.public) {
                publicEditUrl = `${webServer.addresses.public}${mountPath}/game-edit?code=${editId}`
            }

            // 构建消息
            let urlText = editUrls[0]
            if (publicEditUrl) {
                urlText = `公网: ${publicEditUrl}\n本地: ${editUrls[0]}`
            }

            const editMsg = `📝 游戏在线编辑

请在30分钟内访问以下链接编辑游戏信息：
${urlText}

⚠️ 注意事项：
• 链接有效期30分钟
• 好感度/信任度/金币等核心数据不可修改
• 秘密信息不会显示
• 提交后返回游戏即可生效`

            // 尝试通过私聊/临时私聊发送编辑链接
            let sendSuccess = false
            try {
                // 优先尝试临时私聊（群临时会话）
                if (groupId && e.member?.sendMsg) {
                    await e.member.sendMsg(editMsg)
                    sendSuccess = true
                    await this.reply('📝 编辑链接已私聊发送，请查看私聊消息')
                }
            } catch (tempErr) {
                gameLogger.debug(`临时私聊发送失败: ${tempErr.message}`)
            }

            // 临时私聊失败，尝试普通私聊
            if (!sendSuccess) {
                try {
                    if (Bot.pickFriend) {
                        const friend = Bot.pickFriend(userId)
                        if (friend?.sendMsg) {
                            await friend.sendMsg(editMsg)
                            sendSuccess = true
                            await this.reply('📝 编辑链接已私聊发送，请查看私聊消息')
                        }
                    } else if (Bot.pickUser) {
                        const user = Bot.pickUser(userId)
                        if (user?.sendMsg) {
                            await user.sendMsg(editMsg)
                            sendSuccess = true
                            await this.reply('📝 编辑链接已私聊发送，请查看私聊消息')
                        }
                    }
                } catch (friendErr) {
                    gameLogger.debug(`私聊发送失败: ${friendErr.message}`)
                }
            }

            // 私聊都失败，回退到群内发送（不显示完整链接）
            if (!sendSuccess) {
                await this.reply(`📝 游戏在线编辑

⚠️ 无法发送私聊，请添加机器人好友后重试
或联系管理员获取编辑链接

编辑ID: ${editId.slice(0, 8)}...`)
                gameLogger.warn(`[Galgame] 用户 ${userId} 编辑链接发送失败，无法私聊`)
            }

            // 编辑提交时会直接应用更新到数据库，无需轮询
        } catch (err) {
            gameLogger.error('创建在线编辑失败:', err)
            await this.reply(`❌ 创建编辑会话失败: ${err.message}`)
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
    /**
     * 查看背包
     */
    async showInventory() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            if (!gameSession || !gameSession.inGame) {
                await this.reply('❌ 你当前没有进行中的游戏')
                return true
            }

            const characterId = gameSession.characterId || 'default'
            const session = await galgameService.getOrCreateSession(userId, characterId, groupId)
            const items = await galgameService.getItems(userId, characterId, groupId)
            const gold = session.gold || 100

            let msg = '🎒 你的背包：\n━━━━━━━━━━━━━━━━\n'

            if (items.length === 0) {
                msg += '里面空空如也。\n'
            } else {
                // 按类型分组
                const grouped = {}
                for (const item of items) {
                    const type = item.type || 'consumable'
                    if (!grouped[type]) grouped[type] = []
                    grouped[type].push(item)
                }

                // 按类型优先级展示: key > clue > gift > consumable
                const typeOrder = ['key', 'clue', 'gift', 'consumable']
                for (const type of typeOrder) {
                    const typeItems = grouped[type]
                    if (!typeItems || typeItems.length === 0) continue

                    const icon = ITEM_TYPE_ICONS[type] || '📦'
                    const label = ITEM_TYPE_LABELS[type] || type
                    msg += `${icon} ${label}:\n`
                    for (const item of typeItems) {
                        msg += `  • ${item.name}`
                        if (item.description) msg += ` - ${item.description}`
                        msg += '\n'
                    }
                    msg += '\n'
                }

                // 处理未知类型
                for (const type of Object.keys(grouped)) {
                    if (!typeOrder.includes(type)) {
                        const typeItems = grouped[type]
                        msg += `📦 其他:\n`
                        for (const item of typeItems) {
                            msg += `  • ${item.name}`
                            if (item.description) msg += ` - ${item.description}`
                            msg += '\n'
                        }
                        msg += '\n'
                    }
                }
            }

            msg += `💰 金币: ${gold}\n━━━━━━━━━━━━━━━━`
            await this.reply(msg)
        } catch (err) {
            gameLogger.error('查看背包失败:', err)
            await this.reply(`❌ 查看背包失败: ${err.message}`)
        }

        return true
    }

    async showHelp() {
        const help = `🎮 游戏模式帮助
━━━━━━━━━━━━━━━━

📌 基础命令：
• #游戏开始 [角色ID] - 进入游戏
• #游戏状态 - 查看全部状态
• #游戏退出 - 暂时退出
• #游戏结束 - 结束游戏

📌 事件命令：
• #日常 - 日常互动事件
• #探索 - 探索冒险事件
• #商店 - 购买物品
• #打工 - 赚取金币

📌 查看命令：
• #任务 - 查看任务进度
• #物品 - 查看背包物品

📌 角色管理：
• #游戏角色列表
• #游戏创建角色
• #游戏删除角色 <ID>

📌 数据管理：
• #游戏导出 / #游戏导入

📌 游玩方式：
• 直接发消息对话
• 选项用表情1-4贴

📌 好感度: 😠厌恶→�好感→�挚爱
� 信任度: ⚔️敌视→�信赖→⭐生死之交`

        await this.reply(help)
        return true
    }

    /**
     * 触发日常事件
     */
    async triggerDailyEvent() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        // 检查是否在游戏中
        if (!galgameService.isUserInGame(groupId, userId)) {
            await this.reply('❌ 请先使用 #游戏开始 进入游戏')
            return true
        }

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            if (!gameSession) {
                await this.reply('❌ 游戏会话不存在')
                return true
            }

            const bot = e.bot || Bot

            // 根据好感度选择日常事件类型
            const status = await galgameService.getStatus(userId, gameSession.characterId, groupId)
            const affection = status.affection

            let eventCategory = 'stranger'
            if (affection > 60) eventCategory = 'intimate'
            else if (affection > 40) eventCategory = 'friendly'
            else if (affection > 20) eventCategory = 'familiar'

            const events = DAILY_EVENTS[eventCategory] || DAILY_EVENTS.stranger
            const randomEvent = events[Math.floor(Math.random() * events.length)]

            // 发送日常事件请求给AI
            const result = await galgameService.sendMessage({
                userId,
                groupId,
                message: `[玩家想要进行日常互动：${randomEvent}]`,
                characterId: gameSession.characterId,
                event: e
            })

            // 发送回复
            const responseInfo = await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)

            // 处理选项表情
            const msgSeq = responseInfo.msgSeq
            if (result.options?.length > 0 && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'option', result.options)
                for (let i = 0; i < Math.min(result.options.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
                        await new Promise(r => setTimeout(r, 200))
                    } catch (err) {
                        gameLogger.debug(`添加选项表情失败: ${err.message}`)
                    }
                }
            }

            if (result.event && result.eventOptions?.length > 0 && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'event', result.eventOptions, result.event)
                for (let i = 0; i < Math.min(result.eventOptions.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
                        await new Promise(r => setTimeout(r, 200))
                    } catch (err) {
                        gameLogger.debug(`添加事件表情失败: ${err.message}`)
                    }
                }
            }
        } catch (err) {
            gameLogger.error('触发日常事件失败:', err)
            await this.reply(`❌ 触发失败: ${err.message}`)
        }

        return true
    }

    /**
     * 触发探索事件
     */
    async triggerExploreEvent() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        // 检查是否在游戏中
        if (!galgameService.isUserInGame(groupId, userId)) {
            await this.reply('❌ 请先使用 #游戏开始 进入游戏')
            return true
        }

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            if (!gameSession) {
                await this.reply('❌ 游戏会话不存在')
                return true
            }

            const bot = e.bot || Bot

            // 随机选择探索地点和活动
            const location = EXPLORE_EVENTS.locations[Math.floor(Math.random() * EXPLORE_EVENTS.locations.length)]
            const activity = EXPLORE_EVENTS.activities[Math.floor(Math.random() * EXPLORE_EVENTS.activities.length)]

            // 发送探索事件请求给AI
            const result = await galgameService.sendMessage({
                userId,
                groupId,
                message: `[玩家想要去${location}进行探索，尝试${activity}]`,
                characterId: gameSession.characterId,
                event: e
            })

            // 发送回复
            const responseInfo = await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)

            // 处理选项表情
            const msgSeq = responseInfo.msgSeq
            if (result.options?.length > 0 && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'option', result.options)
                for (let i = 0; i < Math.min(result.options.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
                        await new Promise(r => setTimeout(r, 200))
                    } catch (err) {
                        gameLogger.debug(`添加选项表情失败: ${err.message}`)
                    }
                }
            }

            if (result.event && result.eventOptions?.length > 0 && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'event', result.eventOptions, result.event)
                for (let i = 0; i < Math.min(result.eventOptions.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
                        await new Promise(r => setTimeout(r, 200))
                    } catch (err) {
                        gameLogger.debug(`添加事件表情失败: ${err.message}`)
                    }
                }
            }
        } catch (err) {
            gameLogger.error('触发探索事件失败:', err)
            await this.reply(`❌ 触发失败: ${err.message}`)
        }

        return true
    }

    /**
     * 显示当前任务
     */
    async showCurrentTask() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        // 检查是否在游戏中
        if (!galgameService.isUserInGame(groupId, userId)) {
            await this.reply('❌ 请先使用 #游戏开始 进入游戏')
            return true
        }

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            const characterId = gameSession?.characterId || 'default'
            const status = await galgameService.getStatus(userId, characterId, groupId)

            let taskText = `📋 任务进度\n━━━━━━━━━━━━━━━━\n`

            // 当前任务
            if (status.currentTask) {
                taskText += `\n📌 当前任务:\n${status.currentTask}\n`
            } else {
                taskText += `\n📌 当前无进行中的任务\n`
            }

            // 当前场景
            if (status.currentScene) {
                taskText += `\n📍 当前位置: ${status.currentScene.name}`
                if (status.currentScene.description) {
                    taskText += `\n   ${status.currentScene.description}`
                }
            }

            // 已发现线索
            if (status.clues && status.clues.length > 0) {
                taskText += `\n\n🔍 已发现线索 (${status.clues.length}):`
                for (const clue of status.clues.slice(-5)) {
                    taskText += `\n   • ${clue}`
                }
                if (status.clues.length > 5) {
                    taskText += `\n   ...还有${status.clues.length - 5}条`
                }
            }

            // 剧情进展
            if (status.plotHistory && status.plotHistory.length > 0) {
                taskText += `\n\n📖 近期剧情:`
                for (const plot of status.plotHistory.slice(-3)) {
                    taskText += `\n   • ${plot}`
                }
            }

            // 已触发事件
            if (status.triggeredEvents && status.triggeredEvents.length > 0) {
                taskText += `\n\n⭐ 经历事件 (${status.triggeredEvents.length}):`
                taskText += `\n   ${status.triggeredEvents.slice(-5).join('、')}`
            }

            taskText += `\n\n💡 使用 #日常 #探索 #商店 #打工 触发事件`

            await this.reply(taskText)
        } catch (err) {
            gameLogger.error('获取任务失败:', err)
            await this.reply(`❌ 获取失败: ${err.message}`)
        }

        return true
    }

    /**
     * 触发商店事件
     */
    async triggerShopEvent() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        if (!galgameService.isUserInGame(groupId, userId)) {
            await this.reply('❌ 请先使用 #游戏开始 进入游戏')
            return true
        }

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            if (!gameSession) {
                await this.reply('❌ 游戏会话不存在')
                return true
            }

            const bot = e.bot || Bot
            const status = await galgameService.getStatus(userId, gameSession.characterId, groupId)

            const result = await galgameService.sendMessage({
                userId,
                groupId,
                message: `[玩家想要去商店购物，当前金币: ${status.gold}]`,
                characterId: gameSession.characterId,
                event: e
            })

            const responseInfo = await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)

            const msgSeq = responseInfo.msgSeq
            if (result.options?.length > 0 && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'option', result.options)
                for (let i = 0; i < Math.min(result.options.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
                        await new Promise(r => setTimeout(r, 200))
                    } catch (err) {}
                }
            }
        } catch (err) {
            gameLogger.error('触发商店事件失败:', err)
            await this.reply(`❌ 触发失败: ${err.message}`)
        }

        return true
    }

    /**
     * 触发打工事件
     */
    async triggerWorkEvent() {
        const e = this.e
        const userId = String(e.user_id)
        const groupId = e.group_id ? String(e.group_id) : null

        if (!galgameService.isUserInGame(groupId, userId)) {
            await this.reply('❌ 请先使用 #游戏开始 进入游戏')
            return true
        }

        try {
            const gameSession = galgameService.getUserGameSession(groupId, userId)
            if (!gameSession) {
                await this.reply('❌ 游戏会话不存在')
                return true
            }

            const bot = e.bot || Bot
            const jobs = ['咖啡店帮工', '图书馆整理', '便利店收银', '家教', '发传单', '跑腿送货']
            const randomJob = jobs[Math.floor(Math.random() * jobs.length)]

            const result = await galgameService.sendMessage({
                userId,
                groupId,
                message: `[玩家想要去打工赚钱，尝试: ${randomJob}]`,
                characterId: gameSession.characterId,
                event: e
            })

            const responseInfo = await sendGalgameResponse(bot, groupId, userId, gameSession.characterId, result)

            const msgSeq = responseInfo.msgSeq
            if (result.options?.length > 0 && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'option', result.options)
                for (let i = 0; i < Math.min(result.options.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
                        await new Promise(r => setTimeout(r, 200))
                    } catch (err) {}
                }
            }

            if (result.event && result.eventOptions?.length > 0 && msgSeq) {
                galgameService.savePendingChoice(groupId, msgSeq, userId, 'event', result.eventOptions, result.event)
                for (let i = 0; i < Math.min(result.eventOptions.length, 4); i++) {
                    try {
                        await sendReaction(e, msgSeq, OPTION_EMOJIS[i].id, true, 1)
                        await new Promise(r => setTimeout(r, 200))
                    } catch (err) {}
                }
            }
        } catch (err) {
            gameLogger.error('触发打工事件失败:', err)
            await this.reply(`❌ 触发失败: ${err.message}`)
        }

        return true
    }

    /**
     * 显示物品列表
     */
    async showItems() {
        // 委托给 showInventory 统一处理
        return await this.showInventory()
    }
}
