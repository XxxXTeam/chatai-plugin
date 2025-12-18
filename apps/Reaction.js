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
        const { chatService } = await import('../src/services/llm/ChatService.js')
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
                bot.on?.('notice.group.reaction', async (e) => {
                    await handleReactionEvent(e, bot)
                })
                bot.on?.('notice.group.emoji_like', async (e) => {
                    await handleReactionEvent(e, bot)
                })
            }
        } catch (err) {
            logger.error('[AI-Reaction] 注册事件监听器失败:', err)
        }
    }, 3000)
}

// 防重复响应：记录最近处理的事件
const recentReactions = new Map()  // key: `${groupId}-${userId}-${messageId}`, value: timestamp
const REACTION_COOLDOWN = 10000  // 10秒内同一用户对同一消息的回应不重复处理

/**
 * 检查是否为添加回应事件（而非取消）
 * 兼容多种适配器格式
 */
function isAddReaction(e) {
    // NapCat: set 字段
    if (e.set === false || e.set === 'remove' || e.set === 0) return false
    // LLOneBot/部分适配器: sub_type 字段
    if (e.sub_type === 'remove' || e.sub_type === 'cancel' || e.sub_type === 'delete') return false
    // 某些适配器: is_set 字段
    if (e.is_set === false || e.is_set === 0) return false
    // 某些适配器: action/operate 字段
    if (e.action === 'remove' || e.operate === 'remove') return false
    if (e.action === 'cancel' || e.operate === 'cancel') return false
    // 某些适配器: type 字段区分
    if (e.type === 'remove' || e.type === 'cancel') return false
    // 默认认为是添加
    return true
}

/**
 * 获取被回应的原消息内容
 */
async function getOriginalMessageContent(e, bot) {
    try {
        const messageId = e.message_id || e.seq || e.msg_id
        if (!messageId || !e.group_id) return null
        
        // 方法1: 使用 MessageApi
        try {
            const msgInfo = await MessageApi.getMsg(bot, messageId)
            if (msgInfo?.message) {
                // 解析消息内容
                const content = Array.isArray(msgInfo.message) 
                    ? msgInfo.message.map(seg => {
                        if (seg.type === 'text') return seg.text || seg.data?.text || ''
                        if (seg.type === 'image') return '[图片]'
                        if (seg.type === 'face') return '[表情]'
                        if (seg.type === 'at') return `@${seg.data?.name || seg.data?.qq || ''}`
                        return ''
                    }).join('').trim()
                    : (typeof msgInfo.message === 'string' ? msgInfo.message : '')
                if (content) return content.substring(0, 100) // 限制长度
            }
            // 兼容 raw_message
            if (msgInfo?.raw_message) {
                return String(msgInfo.raw_message).substring(0, 100)
            }
        } catch {}
        
        // 方法2: 使用 pickGroup.getChatHistory
        if (bot.pickGroup) {
            try {
                const group = bot.pickGroup(e.group_id)
                if (group?.getChatHistory) {
                    const history = await group.getChatHistory(messageId, 1)
                    if (history?.length > 0) {
                        const msg = history[0]
                        const content = msg.raw_message || msg.message
                        if (typeof content === 'string') {
                            return content.substring(0, 100)
                        }
                        if (Array.isArray(content)) {
                            return content.map(seg => seg.text || '').join('').substring(0, 100)
                        }
                    }
                }
            } catch {}
        }
        
        return null
    } catch (err) {
        logger.debug('[AI-Reaction] 获取原消息失败:', err.message)
        return null
    }
}

// 默认提示词模板
const DEFAULT_ADD_PROMPT = `[事件通知] {nickname} 对你之前的消息做出了"{emoji}"的表情回应。{context}这是对你消息的反馈，你可以简短回应表示感谢或互动，也可以选择不回复。`
const DEFAULT_REMOVE_PROMPT = `[事件通知] {nickname} 取消了对你之前消息的"{emoji}"表情回应。{context}你可以忽略这个事件，也可以简短回应。`

async function handleReactionEvent(e, bot) {
    try {
        if (!config.get('features.reaction.enabled')) {
            return
        }
        
        // 检查是否为添加或取消回应事件
        const isAdd = isAddReaction(e)
        
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
        
        // 防重复响应检查
        const messageId = e.message_id || e.seq || e.msg_id || ''
        const actionType = isAdd ? 'add' : 'remove'
        const reactionKey = `${e.group_id}-${userId}-${messageId}-${actionType}`
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
        
        const emojiId = e.id || e.emoji_id
        const nickname = await getUserNickname(e, userId)
        const emojiDesc = getEmojiDescription(emojiId)
        const actionText = isAdd ? '添加' : '取消'
        
        // 获取被回应的原消息内容
        const originalMessage = await getOriginalMessageContent(e, bot)
        
        logger.info(`[AI-Reaction] ${nickname}(${userId}) 对机器人消息做出了 ${emojiDesc} 回应 (${actionText})${originalMessage ? ` 原消息: ${originalMessage.substring(0, 30)}...` : ''}`)
        
        // 获取自定义提示词模板，为空则使用默认值
        // 支持占位符: {nickname}, {emoji}, {message}, {context}, {action}, {action_text}, {user_id}, {group_id}
        const configAddPrompt = config.get('features.reaction.prompt')
        const configRemovePrompt = config.get('features.reaction.removePrompt')
        
        const promptTemplate = isAdd 
            ? (configAddPrompt && configAddPrompt.trim() ? configAddPrompt : DEFAULT_ADD_PROMPT)
            : (configRemovePrompt && configRemovePrompt.trim() ? configRemovePrompt : DEFAULT_REMOVE_PROMPT)
        
        // 构建上下文信息
        const contextInfo = originalMessage 
            ? `被回应的消息内容是: "${originalMessage}"。` 
            : ''
        
        const eventDesc = promptTemplate
            .replace(/\{nickname\}/g, nickname)
            .replace(/\{emoji\}/g, emojiDesc)
            .replace(/\{message\}/g, originalMessage || '(无法获取)')
            .replace(/\{context\}/g, contextInfo)
            .replace(/\{action\}/g, actionType)
            .replace(/\{action_text\}/g, actionText)
            .replace(/\{user_id\}/g, String(userId))
            .replace(/\{group_id\}/g, String(e.group_id || ''))
        
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
