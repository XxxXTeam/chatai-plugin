/**
 * AI 表情回应事件处理
 * 使用AI人设响应表情回应
 * 
 * 兼容平台:
 * - icqq 1.5.8+: notice.group.reaction (e.id, e.seq, e.user_id)
 * - NapCat: notice_type='group_msg_emoji_like'
 * - LLOneBot/Lagrange: sub_type='emoji_like' 或 'reaction'
 * 
 * 事件属性:
 * - e.id / e.emoji_id  表情ID
 * - e.seq / e.message_id  消息标识
 * - e.user_id  操作者
 * - e.target_id / e.sender_id  被回应消息的发送者 (部分适配器)
 * 
 * 表情ID参考: https://bot.q.qq.com/wiki/develop/api-v2/openapi/emoji/model.html
 */
import config from '../config/config.js'
import { getBotIds } from '../src/utils/messageDedup.js'
import { MessageApi } from '../src/utils/messageParser.js'

// 表情ID映射表（QQ官方表情）
// 参考: https://bot.q.qq.com/wiki/develop/api-v2/openapi/emoji/model.html
const EMOJI_MAP = {
    // 经典QQ表情 (0-200)
    '0': '惊讶', '1': '撇嘴', '2': '色', '3': '发呆', '4': '得意', '5': '流泪',
    '6': '害羞', '7': '闭嘴', '8': '睡', '9': '大哭', '10': '尴尬',
    '11': '发怒', '12': '调皮', '13': '呲牙', '14': '微笑', '15': '难过',
    '16': '酷', '17': '冷汗', '18': '抓狂', '19': '吐', '20': '偷笑',
    '21': '可爱', '22': '白眼', '23': '傲慢', '24': '饥饿', '25': '困',
    '26': '惊恐', '27': '流汗', '28': '憨笑', '29': '悠闲', '30': '奋斗',
    '31': '咒骂', '32': '疑问', '33': '嘘', '34': '晕', '35': '折磨',
    '36': '衰', '37': '骷髅', '38': '敲打', '39': '再见', '40': '发抖',
    '41': '爱情', '42': '跳跳', '43': '猪头', '49': '拥抱', '53': '蛋糕',
    '54': '闪电', '55': '炸弹', '56': '刀', '57': '足球', '59': '便便',
    '60': '咖啡', '61': '饭', '63': '玫瑰', '64': '凋谢', '66': '爱心',
    '67': '心碎', '69': '礼物', '74': '太阳', '75': '月亮',
    '76': '赞', '77': '踩', '78': '握手', '79': '胜利', '85': '飞吻',
    '86': '怄火', '89': '西瓜', '96': '冷汗', '97': '擦汗', '98': '抠鼻',
    '99': '鼓掌', '100': '糗大了', '101': '坏笑', '102': '左哼哼', '103': '右哼哼',
    '104': '哈欠', '105': '鄙视', '106': '委屈', '107': '快哭了', '108': '阴险',
    '109': '亲亲', '110': '吓', '111': '可怜', '112': '菜刀', '113': '啤酒',
    '114': '篮球', '115': '乒乓', '116': '示爱', '117': '瓢虫', '118': '抱拳',
    '119': '勾引', '120': '拳头', '121': '差劲', '122': '爱你', '123': 'NO',
    '124': 'OK', '125': '转圈', '126': '磕头', '127': '回头', '128': '跳绑',
    '129': '挥手', '130': '激动', '131': '街舞', '132': '献吻', '133': '左太极',
    '134': '右太极', '136': '双喜', '137': '鞭炮', '138': '灯笼', '140': 'K歌',
    '144': '喝彩', '145': '祈祷', '146': '爆筋', '147': '棒棒糖', '148': '喝奶',
    '151': '飞机', '158': '钞票', '168': '药', '169': '手枪', '171': '茶',
    '172': '眨眼', '173': '泪奔', '174': '无奈', '175': '卖萌', '176': '小纠结',
    '177': '喷血', '178': '斜眼笑', '179': 'doge', '180': '惊喜', '181': '骚扰',
    '182': '笑哭', '183': '我最美', '184': '河蟹', '185': '羊驼', '187': '幽灵',
    '188': '蛋', '189': '菊花', '190': '红包', '191': '大笑', '192': '不开心',
    '193': '冷漠', '194': '呃', '197': '冷', '198': '呵呵', '200': '加油抱抱',
    // 新版Unicode表情（6位ID）
    '128076': '👌', '10060': '❌', '128077': '👍', '128078': '👎',
    '128079': '👏', '128147': '❤️', '128293': '🔥', '128514': '😂',
    '128516': '😄', '128525': '😍', '128536': '😘', '128546': '😢',
    '128557': '😭', '128563': '😳', '129315': '🤣', '129303': '🤗'
}

function getEmojiDescription(emojiId) {
    return EMOJI_MAP[String(emojiId)] || `表情[${emojiId}]`
}

async function getUserNickname(e, userId) {
    if (!userId) return '未知用户'
    try {
        const bot = e.bot || Bot
        if (e.sender?.nickname) return e.sender.nickname
        if (e.sender?.card) return e.sender.card
        if (e.group_id && bot.pickGroup) {
            try {
                const group = bot.pickGroup(e.group_id)
                if (group?.pickMember) {
                    const member = group.pickMember(userId)
                    const info = await member?.getInfo?.() || member?.info || member
                    if (info?.nickname || info?.card) return info.card || info.nickname
                }
            } catch {}
        }
        return String(userId)
    } catch {
        return String(userId)
    }
}

async function getAIResponse(eventDesc, options = {}) {
    const { userId, groupId, maxLength = 50 } = options
    try {
        const { chatService } = await import('../src/services/ChatService.js')
        const result = await chatService.sendMessage({
            userId: String(userId),
            groupId: groupId ? String(groupId) : null,
            message: eventDesc,
            mode: 'roleplay',
            skipHistory: true
        })
        let reply = result.response
            ?.filter(c => c.type === 'text')
            ?.map(c => c.text)
            ?.join('') || ''
        if (maxLength && reply.length > maxLength) {
            reply = reply.substring(0, maxLength)
        }
        return reply
    } catch (err) {
        logger.debug('[AI-Reaction] AI响应失败:', err.message)
        return null
    }
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
            const bots = Bot?.uin ? [Bot] : (Bot?.bots ? Object.values(Bot.bots) : [])
            if (bots.length === 0 && global.Bot) {
                bots.push(global.Bot)
            }
            
            for (const bot of bots) {
                if (!bot || bot._reactionListenerAdded) continue
                bot._reactionListenerAdded = true
                
                // 监听 notice.group.reaction 事件
                bot.on?.('notice.group.reaction', async (e) => {
                    await handleReactionEvent(e, bot)
                })
                
                // 兼容其他可能的事件名
                bot.on?.('notice.group.emoji_like', async (e) => {
                    await handleReactionEvent(e, bot)
                })
                
                logger.debug(`[AI-Reaction] 已为Bot ${bot.uin || 'unknown'} 注册事件监听器`)
            }
        } catch (err) {
            logger.error('[AI-Reaction] 注册事件监听器失败:', err)
        }
    }, 3000)
}

async function handleReactionEvent(e, bot) {
    try {
        if (!config.get('features.reaction.enabled')) {
            return
        }
        
        const botIds = getBotIds()
        const selfId = e.self_id || bot?.uin || Bot?.uin
        const userId = e.user_id
        if (userId === selfId || botIds.has(String(userId))) {
            return
        }
        const isTargetBot = await checkIfTargetBotStatic(e, selfId, botIds, bot)
        if (!isTargetBot) {
            return
        }
        
        const emojiId = e.id || e.emoji_id
        const nickname = await getUserNickname(e, userId)
        const emojiDesc = getEmojiDescription(emojiId)
        
        logger.info(`[AI-Reaction] ${nickname}(${userId}) 对机器人消息做出了 ${emojiDesc} 回应`)
        
        // 获取自定义提示词模板，支持 {nickname} 和 {emoji} 占位符
        const defaultPrompt = `[事件通知] {nickname} 对你之前的消息做出了"{emoji}"的表情回应。这是对你消息的反馈，你可以简短回应表示感谢或互动，也可以选择不回复。`
        const promptTemplate = config.get('features.reaction.prompt') || defaultPrompt
        const eventDesc = promptTemplate
            .replace(/\{nickname\}/g, nickname)
            .replace(/\{emoji\}/g, emojiDesc)
        
        const aiReply = await getAIResponse(eventDesc, {
            userId,
            groupId: e.group_id,
            maxLength: 50
        })
        
        if (aiReply && e.group_id) {
            const group = bot.pickGroup?.(e.group_id)
            if (group?.sendMsg) {
                await group.sendMsg(aiReply)
            }
        }
    } catch (err) {
        logger.error('[AI-Reaction] 处理reaction事件失败:', err)
    }
}
async function checkIfTargetBotStatic(e, selfId, botIds, bot) {
    try {
        const targetId = e.target_id || e.sender_id || e.target_user_id
        if (targetId) {
            return targetId === selfId || botIds.has(String(targetId))
        }
        
        const messageId = e.message_id || e.seq || e.msg_id
        if (messageId && e.group_id) {
            if (bot.pickGroup) {
                try {
                    const group = bot.pickGroup(e.group_id)
                    if (group?.getChatHistory) {
                        const history = await group.getChatHistory(messageId, 1)
                        if (history?.length > 0) {
                            const msg = history[0]
                            const senderId = msg.sender?.user_id || msg.user_id
                            return senderId === selfId || botIds.has(String(senderId))
                        }
                    }
                } catch {}
            }
            
            try {
                const msgInfo = await MessageApi.getMsg(bot, messageId)
                if (msgInfo?.sender?.user_id) {
                    const senderId = msgInfo.sender.user_id
                    return senderId === selfId || botIds.has(String(senderId))
                }
            } catch {}
        }
        
        if (e.set === true || e.set === 'add') {
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
