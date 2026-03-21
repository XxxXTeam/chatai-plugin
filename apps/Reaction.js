/**
 * AI 表情回应事件处理
 *
 * 表情ID参考: https://bot.q.qq.com/wiki/develop/api-v2/openapi/emoji/model.html
 */
import config from '../config/config.js'
import { getBotIds } from '../src/utils/messageDedup.js'
import {
    parseReactionEvent,
    getUserNickname,
    getOriginalMessage,
    sendGroupMessage,
    getBot
} from '../src/utils/eventAdapter.js'
import { galgameService } from '../src/services/galgame/GalgameService.js'
import { getAIResponse } from '../src/utils/common.js'

const EMOJI_MAP = {
    // 经典QQ表情 (0-200)
    0: '惊讶',
    1: '撇嘴',
    2: '色',
    3: '发呆',
    4: '得意',
    5: '流泪',
    6: '害羞',
    7: '闭嘴',
    8: '睡',
    9: '大哭',
    10: '尴尬',
    11: '发怒',
    12: '调皮',
    13: '呲牙',
    14: '微笑',
    15: '难过',
    16: '酷',
    17: '冷汗',
    18: '抓狂',
    19: '吐',
    20: '偷笑',
    21: '可爱',
    22: '白眼',
    23: '傲慢',
    24: '饥饿',
    25: '困',
    26: '惊恐',
    27: '流汗',
    28: '憨笑',
    29: '悠闲',
    30: '奋斗',
    31: '咒骂',
    32: '疑问',
    33: '嘘',
    34: '晕',
    35: '折磨',
    36: '衰',
    37: '骷髅',
    38: '敲打',
    39: '再见',
    40: '发抖',
    41: '爱情',
    42: '跳跳',
    43: '猪头',
    49: '拥抱',
    53: '蛋糕',
    54: '闪电',
    55: '炸弹',
    56: '刀',
    57: '足球',
    59: '便便',
    60: '咖啡',
    61: '饭',
    63: '玫瑰',
    64: '凋谢',
    66: '爱心',
    67: '心碎',
    69: '礼物',
    74: '太阳',
    75: '月亮',
    76: '赞',
    77: '踩',
    78: '握手',
    79: '胜利',
    85: '飞吻',
    86: '怄火',
    89: '西瓜',
    96: '冷汗',
    97: '擦汗',
    98: '抠鼻',
    99: '鼓掌',
    100: '糗大了',
    101: '坏笑',
    102: '左哼哼',
    103: '右哼哼',
    104: '哈欠',
    105: '鄙视',
    106: '委屈',
    107: '快哭了',
    108: '阴险',
    109: '亲亲',
    110: '吓',
    111: '可怜',
    112: '菜刀',
    113: '啤酒',
    114: '篮球',
    115: '乒乓',
    116: '示爱',
    117: '瓢虫',
    118: '抱拳',
    119: '勾引',
    120: '拳头',
    121: '差劲',
    122: '爱你',
    123: 'NO',
    124: 'OK',
    125: '转圈',
    126: '磕头',
    127: '回头',
    128: '跳绑',
    129: '挥手',
    130: '激动',
    131: '街舞',
    132: '献吻',
    133: '左太极',
    134: '右太极',
    136: '双喜',
    137: '鞭炮',
    138: '灯笼',
    140: 'K歌',
    144: '喝彩',
    145: '祈祷',
    146: '爆筋',
    147: '棒棒糖',
    148: '喝奶',
    151: '飞机',
    158: '钞票',
    168: '药',
    169: '手枪',
    171: '茶',
    172: '眨眼',
    173: '泪奔',
    174: '无奈',
    175: '卖萌',
    176: '小纠结',
    177: '喷血',
    178: '斜眼笑',
    179: 'doge',
    180: '惊喜',
    181: '骚扰',
    182: '笑哭',
    183: '我最美',
    184: '河蟹',
    185: '羊驼',
    187: '幽灵',
    188: '蛋',
    189: '菊花',
    190: '红包',
    191: '大笑',
    192: '不开心',
    193: '冷漠',
    194: '呃',
    197: '冷',
    198: '呵呵',
    200: '加油抱抱',
    // 新版Unicode表情（6位ID）
    128076: '👌',
    10060: '❌',
    128077: '👍',
    128078: '👎',
    128079: '👏',
    128147: '❤️',
    128293: '🔥',
    128514: '😂',
    128516: '😄',
    128525: '😍',
    128536: '😘',
    128546: '😢',
    128557: '😭',
    128563: '😳',
    129315: '🤣',
    129303: '🤗'
}

function getEmojiDescription(emojiId) {
    return EMOJI_MAP[String(emojiId)] || `表情[${emojiId}]`
}

// 标记是否已注册事件监听器
let reactionListenerRegistered = false

/**
 * 注册 reaction 事件监听器到所有 Bot 实例
 */
function registerReactionListener() {
    if (reactionListenerRegistered) return
    reactionListenerRegistered = true

    // 延迟注册，确保 Bot 已初始化
    setTimeout(() => {
        try {
            // 遍历所有 Bot 实例
            const bots = Bot?.uin ? [Bot] : Bot?.bots ? Object.values(Bot.bots) : []
            if (bots.length === 0 && global.Bot) {
                bots.push(global.Bot)
            }

            for (const bot of bots) {
                if (!bot || bot._reactionListenerAdded) continue
                bot._reactionListenerAdded = true

                // icqq 事件
                bot.on?.('notice.group.reaction', async e => {
                    await handleReactionEvent(e, bot)
                })

                // NapCat 事件: group_msg_emoji_like
                bot.on?.('notice.group_msg_emoji_like', async e => {
                    await handleNapCatReactionEvent(e, bot)
                })

                // 其他兼容事件名
                bot.on?.('notice.group.emoji_like', async e => {
                    await handleReactionEvent(e, bot)
                })

                // LLOneBot/Lagrange 可能使用的事件名
                bot.on?.('notice.group.msg_emoji_like', async e => {
                    await handleNapCatReactionEvent(e, bot)
                })

                logger.debug(`[AI-Reaction] 已为 Bot ${bot.uin || bot.self_id} 注册表情回应事件监听`)
            }
        } catch (err) {
            logger.error('[AI-Reaction] 注册事件监听器失败:', err)
        }
    }, 3000)
}

/**
 * 处理 NapCat 特有的表情回应事件格式
 * NapCat 事件格式:
 * {
 *   post_type: 'notice',
 *   notice_type: 'group_msg_emoji_like',
 *   group_id: number,
 *   user_id: number,
 *   message_id: number,
 *   likes: [{ emoji_id: string, count: number }]
 * }
 */
async function handleNapCatReactionEvent(e, bot) {
    try {
        if (!config.get('features.reaction.enabled')) {
            return
        }

        const groupId = e.group_id
        const userId = e.user_id || e.operator_id
        const messageId = e.message_id || e.msg_id
        const likes = e.likes || []

        if (!groupId || !userId || !messageId) {
            logger.debug('[AI-Reaction] NapCat事件缺少必要字段:', JSON.stringify(e).substring(0, 200))
            return
        }

        const botIds = getBotIds()
        const selfId = e.self_id || bot?.uin || Bot?.uin

        // 机器人自己的回应不处理
        if (userId === selfId || botIds.has(String(userId))) {
            return
        }

        // 处理每个表情回应
        for (const like of likes) {
            const emojiId = like.emoji_id || like.face_id
            if (!emojiId) continue

            // 构造统一格式的事件对象
            const unifiedEvent = {
                ...e,
                id: emojiId,
                emoji_id: emojiId,
                seq: messageId,
                message_id: messageId,
                user_id: userId,
                group_id: groupId,
                set: true, // NapCat 的 likes 事件通常是添加回应
                sub_type: 'add'
            }

            await handleReactionEvent(unifiedEvent, bot)
        }
    } catch (err) {
        logger.error('[AI-Reaction] 处理NapCat表情事件失败:', err)
    }
}

// 防重复响应：记录最近处理的事件
const recentReactions = new Map() // key: `${groupId}-${userId}-${messageId}`, value: timestamp
const REACTION_COOLDOWN = 10000 // 10秒内同一用户对同一消息的回应不重复处理

// 默认提示词模板
const DEFAULT_ADD_PROMPT = `[事件通知] {nickname} 对你之前的消息做出了"{emoji}"的表情回应。{context}这是对你消息的反馈，你可以简短回应表示感谢或互动，也可以选择不回复。`
const DEFAULT_REMOVE_PROMPT = `[事件通知] {nickname} 取消了对你之前消息的"{emoji}"表情回应。{context}你可以忽略这个事件，也可以简短回应。`

async function handleReactionEvent(e, bot) {
    try {
        if (!config.get('features.reaction.enabled')) {
            return
        }

        // 使用统一事件解析
        const reactionInfo = parseReactionEvent(e)
        let { emojiId, messageId, userId, targetId, isAdd, groupId } = reactionInfo

        // NapCat 可能在 likes 数组中传递表情ID
        if (!emojiId && e.likes?.length > 0) {
            emojiId = e.likes[0].emoji_id || e.likes[0].face_id
        }

        const botIds = getBotIds()
        const selfId = e.self_id || bot?.uin || Bot?.uin

        // 机器人自己的回应不处理
        if (userId === selfId || botIds.has(String(userId))) {
            return
        }
        if (galgameService.isUserInGame(groupId ? String(groupId) : null, String(userId))) {
            logger.debug(`[AI-Reaction] 用户 ${userId} 在游戏模式中，跳过表情回应处理`)
            return
        }

        // 检查是否回应的是机器人的消息
        const isTargetBot = await checkIfTargetBot(e, selfId, botIds, bot, targetId, messageId, groupId)
        if (!isTargetBot) {
            return
        }

        // 防重复响应检查
        const actionType = isAdd ? 'add' : 'remove'
        const reactionKey = `${groupId}-${userId}-${messageId}-${actionType}`
        const now = Date.now()
        const lastTime = recentReactions.get(reactionKey)
        if (lastTime && now - lastTime < REACTION_COOLDOWN) {
            logger.debug(`[AI-Reaction] 忽略重复回应: ${reactionKey}, 距离上次 ${now - lastTime}ms`)
            return
        }
        recentReactions.set(reactionKey, now)

        // 清理过期记录
        if (recentReactions.size > 100) {
            for (const [key, time] of recentReactions) {
                if (now - time > REACTION_COOLDOWN * 2) recentReactions.delete(key)
            }
        }

        const nickname = await getUserNickname(e, userId, bot)
        const emojiDesc = getEmojiDescription(emojiId)
        const actionText = isAdd ? '添加' : '取消'

        // 获取被回应的原消息内容
        const originalMsg = await getOriginalMessage(e, bot)
        const originalMessage = originalMsg.content

        logger.info(
            `[AI-Reaction] ${nickname}(${userId}) 对机器人消息做出了 ${emojiDesc} 回应 (${actionText})${originalMessage ? ` 原消息: ${originalMessage.substring(0, 30)}...` : ''}`
        )

        // 获取自定义提示词模板
        const configAddPrompt = config.get('features.reaction.prompt')
        const configRemovePrompt = config.get('features.reaction.removePrompt')

        const promptTemplate = isAdd
            ? configAddPrompt && configAddPrompt.trim()
                ? configAddPrompt
                : DEFAULT_ADD_PROMPT
            : configRemovePrompt && configRemovePrompt.trim()
              ? configRemovePrompt
              : DEFAULT_REMOVE_PROMPT

        // 构建上下文信息
        const contextInfo = originalMessage ? `被回应的消息内容是: "${originalMessage}"。` : ''

        const eventDesc = promptTemplate
            .replace(/\{nickname\}/g, nickname)
            .replace(/\{emoji\}/g, emojiDesc)
            .replace(/\{message\}/g, originalMessage || '(无法获取)')
            .replace(/\{context\}/g, contextInfo)
            .replace(/\{action\}/g, actionType)
            .replace(/\{action_text\}/g, actionText)
            .replace(/\{user_id\}/g, String(userId))
            .replace(/\{group_id\}/g, String(groupId || ''))

        const aiReply = await getAIResponse(eventDesc, {
            userId,
            groupId: groupId,
            maxLength: 50,
            mode: 'chat',
            disableTools: true,
            logTag: 'AI-Reaction'
        })

        if (aiReply && groupId) {
            await sendGroupMessage(bot, groupId, aiReply)
        }
    } catch (err) {
        logger.error('[AI-Reaction] 处理reaction事件失败:', err)
    }
}

/**
 * 检查被回应的消息是否是机器人发送的
 */
async function checkIfTargetBot(e, selfId, botIds, bot, targetId, messageId, groupId) {
    try {
        // 1. 如果事件直接包含目标ID
        if (targetId) {
            return targetId === selfId || botIds.has(String(targetId))
        }

        // 2. 通过消息ID获取原消息发送者
        if (messageId && groupId) {
            // icqq: getChatHistory
            if (bot?.pickGroup) {
                try {
                    const group = bot.pickGroup(parseInt(groupId))
                    if (group?.getChatHistory) {
                        const history = await group.getChatHistory(parseInt(messageId), 1)
                        if (history?.length > 0) {
                            const senderId = history[0].sender?.user_id || history[0].user_id
                            return senderId === selfId || botIds.has(String(senderId))
                        }
                    }
                } catch {}
            }

            // OneBot: getMsg
            if (bot?.getMsg || bot?.get_msg) {
                try {
                    const msg = await (bot.getMsg?.(messageId) || bot.get_msg?.({ message_id: messageId }))
                    if (msg?.sender?.user_id) {
                        return msg.sender.user_id === selfId || botIds.has(String(msg.sender.user_id))
                    }
                } catch {}
            }
        }

        // 3. 默认情况：如果是添加回应事件，假设是对机器人的
        if (e.set === true || e.set === 'add' || e.sub_type === 'add') {
            return true
        }

        return false
    } catch (err) {
        logger.warn('[AI-Reaction] 检查目标消息失败:', err.message)
        return false
    }
}

export class AI_Reaction extends plugin {
    constructor() {
        super({
            name: 'AI-Reaction',
            dsc: 'AI表情回应处理',
            event: 'message',
            priority: 9999,
            rule: []
        })
        registerReactionListener()
    }
    async accept() {
        return false
    }
}
