/**
 * AI 事件处理插件
 * 处理戳一戳、表情回应、撤回、入群等特殊事件
 * 使用AI人设进行响应，默认关闭
 * 兼容 icqq / NapCat / OneBot / go-cqhttp 
 */
import config from '../config/config.js'
import { getBotIds } from '../src/utils/messageDedup.js'
import {
    detectPoke,
    detectReaction,
    detectRecall,
    detectMemberChange,
    detectLuckyKing,
    detectHonor,
    detectEssence,
    getEmojiDescription,
    getHonorDescription
} from '../src/utils/eventDetector.js'

/**
 * 获取用户昵称（多平台兼容）
 */
async function getUserNickname(e, userId) {
    if (!userId) return '未知用户'
    
    try {
        const bot = e.bot || Bot
        
        // 1. 从事件中直接获取
        if (e.sender?.nickname) return e.sender.nickname
        if (e.sender?.card) return e.sender.card
        
        // 2. 从群成员信息获取
        if (e.group_id && bot.pickGroup) {
            try {
                const group = bot.pickGroup(e.group_id)
                // icqq 方式
                if (group?.pickMember) {
                    const member = group.pickMember(userId)
                    const info = await member?.getInfo?.() || member?.info || member
                    if (info?.nickname || info?.card) {
                        return info.card || info.nickname
                    }
                }
                // NapCat/OneBot 方式
                if (bot.getGroupMemberInfo) {
                    const info = await bot.getGroupMemberInfo(e.group_id, userId)
                    if (info?.nickname || info?.card) {
                        return info.card || info.nickname
                    }
                }
            } catch {}
        }
        if (!e.group_id && bot.pickFriend) {
            try {
                const friend = bot.pickFriend(userId)
                const info = await friend?.getInfo?.() || friend?.info || friend
                if (info?.nickname) return info.nickname
            } catch {}
        }
        
        return String(userId)
    } catch {
        return String(userId)
    }
}

/**
 * 调用AI生成响应
 * @param {string} eventDesc - 事件描述
 * @param {Object} options - 选项
 */
async function getAIResponse(eventDesc, options = {}) {
    const { userId, groupId, skipHistory = true, maxLength = 100 } = options
    
    try {
        const { chatService } = await import('../src/services/ChatService.js')
        
        const result = await chatService.sendMessage({
            userId: String(userId),
            groupId: groupId ? String(groupId) : null,
            message: eventDesc,
            mode: 'roleplay',
            skipHistory
        })
        
        let reply = result.response
            ?.filter(c => c.type === 'text')
            ?.map(c => c.text)
            ?.join('') || ''
        
        // 限制回复长度
        if (maxLength && reply.length > maxLength) {
            reply = reply.substring(0, maxLength)
        }
        
        return reply
    } catch (err) {
        logger.debug('[EventHandler] AI响应失败:', err.message)
        return null
    }
}

/**
 * 戳一戳事件处理 - 群聊
 * 默认关闭，需在面板配置开启
 * 兼容：icqq / NapCat / OneBot / go-cqhttp / TRSS-Yunzai
 */
export class PokeHandler extends plugin {
    constructor() {
        super({
            name: 'AI-Poke',
            dsc: 'AI戳一戳响应（使用人设）',
            event: 'notice',  
            priority: 100,
            rule: [{ fnc: 'handlePoke' }]
        })
    }

    async handlePoke() {
        const e = this.e
        const pokeInfo = detectPoke(e)
        if (!pokeInfo.isPoke || !pokeInfo.isGroup) {
            return false
        }
        if (!config.get('features.poke.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const { operator, target } = pokeInfo
        
        // 无法获取操作者和目标
        if (!target && !operator) {
            logger.debug('[AI-Poke] 忽略：无法获取操作者和目标')
            return false
        }
        if (target && !botIds.has(String(target))) {
            logger.debug(`[AI-Poke] 忽略：target=${target} 不是bot`)
            return false
        }
        if (operator && botIds.has(String(operator))) {
            logger.debug('[AI-Poke] 忽略：机器人自己戳人')
            return false
        }
        if (operator && target && String(operator) === String(target)) {
            logger.debug('[AI-Poke] 忽略：自己戳自己')
            return false
        }
        const nickname = await getUserNickname(e, operator)
        logger.info(`[AI-Poke] ${nickname}(${operator}) 戳了机器人`)
        
        // 调用AI响应
        const eventDesc = `[事件通知] ${nickname} 戳了你一下。请根据你的人设性格，给出一个简短自然的回应。`
        const aiReply = await getAIResponse(eventDesc, {
            userId: operator,
            groupId: e.group_id,
            maxLength: 100
        })
        if (aiReply) {
            await this.reply(aiReply)
            if (config.get('features.poke.pokeBack')) {
                await this.pokeBack(e, operator)
            }
            return true
        }
        const defaultMsg = config.get('features.poke.message') || '别戳了~'
        await this.reply(defaultMsg)
        return true
    }
    
    async pokeBack(e, userId) {
        try {
            const bot = e.bot || Bot
            if (e.group_id) {
                const group = bot.pickGroup(e.group_id)
                if (typeof group?.pokeMember === 'function') {
                    await group.pokeMember(userId)
                } else if (group?.pickMember) {
                    await group.pickMember(userId).poke?.()
                } else if (typeof bot?.sendGroupPoke === 'function') {
                    // NapCat API
                    await bot.sendGroupPoke(e.group_id, userId)
                }
            }
        } catch (err) {
            logger.debug('[AI-Poke] 回戳失败:', err.message)
        }
    }
}

/**
 * 私聊戳一戳处理
 * 默认关闭，需在面板配置开启
 * 兼容：icqq / NapCat / OneBot / go-cqhttp / TRSS-Yunzai
 */
export class PrivatePokeHandler extends plugin {
    constructor() {
        super({
            name: 'AI-PrivatePoke',
            dsc: 'AI私聊戳一戳响应',
            event: 'notice',
            priority: 100,
            rule: [{ fnc: 'handlePoke' }]
        })
    }

    async handlePoke() {
        const e = this.e
        
        // 使用统一检测函数
        const pokeInfo = detectPoke(e)
        
        // 只处理私聊戳一戳
        if (!pokeInfo.isPoke || pokeInfo.isGroup) {
            return false
        }
        
        if (!config.get('features.poke.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const { operator, target } = pokeInfo
        
        if (target && !botIds.has(String(target))) {
            logger.debug(`[AI-PrivatePoke] 忽略：target=${target} 不是bot`)
            return false
        }
        if (operator && botIds.has(String(operator))) {
            logger.debug('[AI-PrivatePoke] 忽略：机器人自己触发')
            return false
        }
        if (operator && target && String(operator) === String(target)) {
            logger.debug('[AI-PrivatePoke] 忽略：自己戳自己')
            return false
        }
        
        const nickname = await getUserNickname(e, operator)
        logger.info(`[AI-PrivatePoke] ${nickname}(${operator}) 私聊戳了机器人`)
        
        const eventDesc = `[事件通知] ${nickname} 在私聊中戳了你一下。请根据你的人设性格，给出一个简短自然的回应。`
        const aiReply = await getAIResponse(eventDesc, {
            userId: operator,
            maxLength: 100
        })
        
        if (aiReply) {
            await this.reply(aiReply)
            return true
        }
        
        await this.reply(config.get('features.poke.message') || '别戳了~')
        return true
    }
}

/**
 * 表情回应事件处理
 * 默认关闭，需在面板配置开启
 * 兼容：icqq / NapCat / OneBot / go-cqhttp / Lagrange
 */
export class MessageReactionHandler extends plugin {
    constructor() {
        super({
            name: 'AI-MessageReaction',
            dsc: 'AI表情回应处理',
            event: 'notice',
            priority: 100,
            rule: [{ fnc: 'handleReaction' }]
        })
    }
    
    async handleReaction() {
        const e = this.e
        
        // 使用统一检测函数
        const reactionInfo = detectReaction(e)
        
        if (!reactionInfo.isReaction) {
            return false
        }
        
        // 默认关闭
        if (!config.get('features.reaction.enabled')) {
            return false
        }
        
        const bot = e.bot || Bot
        const botIds = getBotIds()
        
        // 检查被回应的消息是否是机器人发的
        let msgSenderId = reactionInfo.msgSenderId
        
        // 如果没有直接的发送者ID，尝试通过message_id获取原消息
        if (!msgSenderId && reactionInfo.messageId) {
            try {
                if (typeof bot?.getMsg === 'function') {
                    const originalMsg = await bot.getMsg(reactionInfo.messageId)
                    msgSenderId = originalMsg?.sender?.user_id || originalMsg?.user_id
                }
            } catch (err) {
                logger.debug(`[AI-Reaction] 获取原消息失败: ${err.message}`)
            }
        }
        
        // 不是对机器人消息的回应，忽略
        if (msgSenderId && !botIds.has(String(msgSenderId))) {
            logger.debug(`[AI-Reaction] 忽略：回应的消息发送者(${msgSenderId})不是机器人`)
            return false
        }
        
        // 无法确定原消息发送者，默认不响应
        if (!msgSenderId) {
            logger.debug('[AI-Reaction] 忽略：无法确定原消息发送者')
            return false
        }
        
        // 防止机器人自己触发
        if (reactionInfo.userId && botIds.has(String(reactionInfo.userId))) {
            logger.debug('[AI-Reaction] 忽略：机器人自己的表情回应')
            return false
        }
        
        const nickname = await getUserNickname(e, reactionInfo.userId)
        const emojiDesc = getEmojiDescription(reactionInfo.emojiId)
        
        logger.info(`[AI-Reaction] ${nickname}(${reactionInfo.userId}) 对机器人消息做出了 ${emojiDesc} 回应`)
        
        const eventDesc = `[事件通知] ${nickname} 对你之前的消息做出了"${emojiDesc}"的表情回应。这是对你消息的反馈，你可以简短回应表示感谢或互动，也可以选择不回复。`
        const aiReply = await getAIResponse(eventDesc, {
            userId: reactionInfo.userId,
            groupId: e.group_id,
            maxLength: 50  // 限制长度避免刷屏
        })
        
        if (aiReply) {
            await this.reply(aiReply)
            return true
        }
        
        return false
    }
}

/**
 * 消息撤回事件处理
 * 默认关闭，需在面板配置开启
 * 兼容：icqq / NapCat / OneBot / go-cqhttp
 */
export class RecallHandler extends plugin {
    constructor() {
        super({
            name: 'AI-Recall',
            dsc: 'AI消息撤回响应',
            event: 'notice',
            priority: 100,
            rule: [{ fnc: 'handleRecall' }]
        })
    }
    
    async handleRecall() {
        const e = this.e
        
        // 使用统一检测函数
        const recallInfo = detectRecall(e)
        
        if (!recallInfo.isRecall) {
            return false
        }
        
        // 默认关闭
        if (!config.get('features.recall.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        
        // 防止机器人自己触发
        if (recallInfo.operatorId && botIds.has(String(recallInfo.operatorId))) {
            return false
        }
        
        const nickname = await getUserNickname(e, recallInfo.operatorId)
        const isSelfRecall = recallInfo.operatorId === recallInfo.userId
        
        logger.info(`[AI-Recall] ${nickname}(${recallInfo.operatorId}) ${isSelfRecall ? '撤回了自己的消息' : '撤回了别人的消息'}`)
        
        // 只在群聊中响应，且仅响应用户自己撤回的消息
        if (!recallInfo.isGroup || !isSelfRecall) {
            return false
        }
        
        // 配置：是否AI响应撤回
        if (config.get('features.recall.aiResponse')) {
            const eventDesc = `[事件通知] ${nickname} 刚刚撤回了一条消息。你可以调侃一下，也可以忽略。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: recallInfo.operatorId,
                groupId: e.group_id,
                maxLength: 50
            })
            
            if (aiReply) {
                await this.reply(aiReply)
                return true
            }
        }
        
        return false
    }
}

/**
 * 群成员变动事件处理（入群/退群）
 * 默认关闭，需在面板配置开启
 * 兼容：icqq / NapCat / OneBot / go-cqhttp
 */
export class MemberChangeHandler extends plugin {
    constructor() {
        super({
            name: 'AI-MemberChange',
            dsc: 'AI群成员变动响应',
            event: 'notice',
            priority: 100,
            rule: [{ fnc: 'handleMemberChange' }]
        })
    }
    
    async handleMemberChange() {
        const e = this.e
        
        // 使用统一检测函数
        const changeInfo = detectMemberChange(e)
        
        if (!changeInfo.isMemberChange) {
            return false
        }
        
        const botIds = getBotIds()
        
        // 机器人自己被踢出群，不处理
        if (changeInfo.type === 'decrease' && changeInfo.subType === 'kick_me') {
            logger.warn(`[AI-MemberChange] 机器人被踢出群 ${e.group_id}`)
            return false
        }
        
        // 入群欢迎
        if (changeInfo.type === 'increase' && config.get('features.welcome.enabled')) {
            const nickname = await getUserNickname(e, changeInfo.userId)
            
            // 机器人自己入群不响应
            if (botIds.has(String(changeInfo.userId))) {
                return false
            }
            
            logger.info(`[AI-MemberChange] ${nickname}(${changeInfo.userId}) 加入了群 ${e.group_id}`)
            
            const eventDesc = `[事件通知] ${nickname} 刚刚加入了群聊。请用你的人设性格给出一个简短友好的欢迎语。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: changeInfo.userId,
                groupId: e.group_id,
                maxLength: 100
            })
            
            if (aiReply) {
                await this.reply(aiReply)
                return true
            }
            
            // 默认欢迎语
            const defaultWelcome = config.get('features.welcome.message') || `欢迎 ${nickname} 加入群聊！`
            await this.reply(defaultWelcome)
            return true
        }
        
        // 退群通知
        if (changeInfo.type === 'decrease' && config.get('features.goodbye.enabled')) {
            const nickname = await getUserNickname(e, changeInfo.userId)
            
            // 机器人自己退群不响应
            if (botIds.has(String(changeInfo.userId))) {
                return false
            }
            
            const isKicked = changeInfo.subType === 'kick'
            logger.info(`[AI-MemberChange] ${nickname}(${changeInfo.userId}) ${isKicked ? '被踢出' : '退出'}了群 ${e.group_id}`)
            
            // 仅在配置启用时响应
            if (config.get('features.goodbye.aiResponse')) {
                const eventDesc = `[事件通知] ${nickname} ${isKicked ? '被踢出了群聊' : '退出了群聊'}。你可以简短表达一下，也可以忽略。`
                const aiReply = await getAIResponse(eventDesc, {
                    userId: changeInfo.userId,
                    groupId: e.group_id,
                    maxLength: 50
                })
                
                if (aiReply) {
                    await this.reply(aiReply)
                    return true
                }
            }
        }
        
        return false
    }
}

/**
 * 运气王事件处理
 * 默认关闭，需在面板配置开启
 */
export class LuckyKingHandler extends plugin {
    constructor() {
        super({
            name: 'AI-LuckyKing',
            dsc: 'AI运气王响应',
            event: 'notice',
            priority: 100,
            rule: [{ fnc: 'handleLuckyKing' }]
        })
    }
    
    async handleLuckyKing() {
        const e = this.e
        
        // 使用统一检测函数
        const luckyInfo = detectLuckyKing(e)
        
        if (!luckyInfo.isLuckyKing) {
            return false
        }
        
        // 默认关闭
        if (!config.get('features.luckyKing.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        
        // 机器人自己是运气王
        if (botIds.has(String(luckyInfo.targetId))) {
            logger.info('[AI-LuckyKing] 机器人成为运气王！')
            
            const eventDesc = `[事件通知] 你在抢红包中成为了运气王！请表达一下你的喜悦。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: luckyInfo.userId,
                groupId: e.group_id,
                maxLength: 80
            })
            
            if (aiReply) {
                await this.reply(aiReply)
                return true
            }
        }
        
        return false
    }
}

/**
 * 荣誉变更事件处理（龙王、群聊之火等）
 * 默认关闭，需在面板配置开启
 */
export class HonorHandler extends plugin {
    constructor() {
        super({
            name: 'AI-Honor',
            dsc: 'AI荣誉变更响应',
            event: 'notice',
            priority: 100,
            rule: [{ fnc: 'handleHonor' }]
        })
    }
    
    async handleHonor() {
        const e = this.e
        
        // 使用统一检测函数
        const honorInfo = detectHonor(e)
        
        if (!honorInfo.isHonor) {
            return false
        }
        
        // 默认关闭
        if (!config.get('features.honor.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const honorDesc = getHonorDescription(honorInfo.honorType)
        
        // 机器人自己获得荣誉
        if (botIds.has(String(honorInfo.userId))) {
            logger.info(`[AI-Honor] 机器人获得荣誉：${honorDesc}`)
            
            const eventDesc = `[事件通知] 你获得了群荣誉称号：${honorDesc}！请表达一下。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: honorInfo.userId,
                groupId: e.group_id,
                maxLength: 80
            })
            
            if (aiReply) {
                await this.reply(aiReply)
                return true
            }
        }
        
        return false
    }
}

/**
 * 精华消息事件处理
 * 默认关闭，需在面板配置开启
 */
export class EssenceHandler extends plugin {
    constructor() {
        super({
            name: 'AI-Essence',
            dsc: 'AI精华消息响应',
            event: 'notice',
            priority: 100,
            rule: [{ fnc: 'handleEssence' }]
        })
    }
    
    async handleEssence() {
        const e = this.e
        
        // 使用统一检测函数
        const essenceInfo = detectEssence(e)
        
        if (!essenceInfo.isEssence) {
            return false
        }
        
        // 默认关闭
        if (!config.get('features.essence.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        
        // 只响应机器人的消息被设为精华
        if (essenceInfo.type === 'add' && botIds.has(String(essenceInfo.senderId))) {
            logger.info(`[AI-Essence] 机器人的消息被设为精华`)
            
            const operatorNickname = await getUserNickname(e, essenceInfo.operatorId)
            const eventDesc = `[事件通知] ${operatorNickname} 把你之前发的消息设置成了精华消息！请简短表达一下。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: essenceInfo.operatorId,
                groupId: e.group_id,
                maxLength: 50
            })
            
            if (aiReply) {
                await this.reply(aiReply)
                return true
            }
        }
        
        return false
    }
}
