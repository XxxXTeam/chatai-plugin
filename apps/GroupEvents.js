/**
 * AI 群组事件处理
 * 处理入群欢迎、退群通知、撤回、禁言、管理员变更、运气王、荣誉、精华等事件
 * 
 * 兼容平台: icqq / NapCat / OneBot v11 / go-cqhttp / TRSS-Yunzai
 * 
 * 事件格式参考:
 * - notice.group.increase  入群
 * - notice.group.decrease  退群
 * - notice.group.recall    撤回
 * - notice.group.ban       禁言
 * - notice.group.admin     管理员变更
 * - notice.group.essence   精华消息
 * - notice.notify (sub_type: lucky_king/honor)  运气王/荣誉
 */
import config from '../config/config.js'
import { getBotIds } from '../src/utils/messageDedup.js'

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
    const { userId, groupId, maxLength = 100 } = options
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
        logger.debug('[GroupEvents] AI响应失败:', err.message)
        return null
    }
}

/**
 * 入群欢迎
 */
export class AI_Welcome extends plugin {
    constructor() {
        super({
            name: 'AI-Welcome',
            dsc: 'AI入群欢迎',
            event: 'notice.group.increase',
            priority: 100,
            rule: [{ fnc: 'handleWelcome', log: false }]
        })
    }
    
    async handleWelcome() {
        const e = this.e
        
        if (!config.get('features.welcome.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const userId = e.user_id
        
        // 机器人自己入群不响应
        if (botIds.has(String(userId))) {
            return false
        }
        
        const nickname = await getUserNickname(e, userId)
        logger.info(`[AI-Welcome] ${nickname}(${userId}) 加入了群 ${e.group_id}`)
        
        const eventDesc = `[事件通知] ${nickname} 刚刚加入了群聊。请用你的人设性格给出一个简短友好的欢迎语。`
        const aiReply = await getAIResponse(eventDesc, {
            userId,
            groupId: e.group_id,
            maxLength: 100
        })
        
        if (aiReply) {
            await this.reply(aiReply)
            return true
        }
        
        const defaultWelcome = config.get('features.welcome.message') || `欢迎 ${nickname} 加入群聊！`
        await this.reply(defaultWelcome)
        return true
    }
}

/**
 * 退群通知
 */
export class AI_Goodbye extends plugin {
    constructor() {
        super({
            name: 'AI-Goodbye',
            dsc: 'AI退群通知',
            event: 'notice.group.decrease',
            priority: 100,
            rule: [{ fnc: 'handleGoodbye', log: false }]
        })
    }
    
    async handleGoodbye() {
        const e = this.e
        
        if (!config.get('features.goodbye.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const userId = e.user_id
        
        // 机器人自己退群不响应
        if (botIds.has(String(userId))) {
            return false
        }
        
        // 机器人被踢
        if (e.sub_type === 'kick_me') {
            logger.warn(`[AI-Goodbye] 机器人被踢出群 ${e.group_id}`)
            return false
        }
        
        const nickname = await getUserNickname(e, userId)
        const isKicked = e.sub_type === 'kick'
        logger.info(`[AI-Goodbye] ${nickname}(${userId}) ${isKicked ? '被踢出' : '退出'}了群 ${e.group_id}`)
        
        if (config.get('features.goodbye.aiResponse')) {
            const eventDesc = `[事件通知] ${nickname} ${isKicked ? '被踢出了群聊' : '退出了群聊'}。你可以简短表达一下，也可以忽略。`
            const aiReply = await getAIResponse(eventDesc, {
                userId,
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
 * 撤回响应
 */
export class AI_Recall extends plugin {
    constructor() {
        super({
            name: 'AI-Recall',
            dsc: 'AI撤回响应',
            event: 'notice.group.recall',
            priority: 100,
            rule: [{ fnc: 'handleRecall', log: false }]
        })
    }
    
    async handleRecall() {
        const e = this.e
        
        if (!config.get('features.recall.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const operatorId = e.operator_id || e.user_id
        
        // 机器人自己触发
        if (botIds.has(String(operatorId))) {
            return false
        }
        
        // 只响应用户自己撤回的消息
        const isSelfRecall = e.operator_id === e.user_id
        if (!isSelfRecall) {
            return false
        }
        
        const nickname = await getUserNickname(e, operatorId)
        logger.info(`[AI-Recall] ${nickname}(${operatorId}) 撤回了消息`)
        
        if (config.get('features.recall.aiResponse')) {
            const eventDesc = `[事件通知] ${nickname} 刚刚撤回了一条消息。你可以调侃一下，也可以忽略。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: operatorId,
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
 * 精华消息响应
 */
export class AI_Essence extends plugin {
    constructor() {
        super({
            name: 'AI-Essence',
            dsc: 'AI精华消息响应',
            event: 'notice.group.essence',
            priority: 100,
            rule: [{ fnc: 'handleEssence', log: false }]
        })
    }
    
    async handleEssence() {
        const e = this.e
        
        if (!config.get('features.essence.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        
        // 只响应机器人的消息被设为精华
        if (e.sub_type === 'add' && botIds.has(String(e.sender_id))) {
            logger.info(`[AI-Essence] 机器人的消息被设为精华`)
            
            const operatorNickname = await getUserNickname(e, e.operator_id)
            const eventDesc = `[事件通知] ${operatorNickname} 把你之前发的消息设置成了精华消息！请简短表达一下。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: e.operator_id,
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
 * 禁言事件响应
 */
export class AI_Ban extends plugin {
    constructor() {
        super({
            name: 'AI-Ban',
            dsc: 'AI禁言事件响应',
            event: 'notice.group.ban',
            priority: 100,
            rule: [{ fnc: 'handleBan', log: false }]
        })
    }
    
    async handleBan() {
        const e = this.e
        
        if (!config.get('features.ban.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const userId = e.user_id
        const operatorId = e.operator_id
        const duration = e.duration || 0
        
        // 机器人被禁言
        if (botIds.has(String(userId))) {
            if (duration > 0) {
                logger.warn(`[AI-Ban] 机器人被禁言 ${duration} 秒`)
            } else {
                logger.info(`[AI-Ban] 机器人被解除禁言`)
            }
            return false
        }
        
        // 其他用户被禁言/解禁，可选响应
        if (config.get('features.ban.aiResponse')) {
            const nickname = await getUserNickname(e, userId)
            const operatorNickname = await getUserNickname(e, operatorId)
            const isBan = duration > 0
            const durationText = isBan ? `${Math.floor(duration / 60)} 分钟` : ''
            
            logger.info(`[AI-Ban] ${nickname}(${userId}) 被 ${operatorNickname} ${isBan ? `禁言 ${durationText}` : '解除禁言'}`)
            
            const eventDesc = `[事件通知] ${nickname} 被 ${operatorNickname} ${isBan ? `禁言了 ${durationText}` : '解除了禁言'}。你可以简短评论一下，也可以忽略。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: operatorId,
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
 * 管理员变更响应
 */
export class AI_Admin extends plugin {
    constructor() {
        super({
            name: 'AI-Admin',
            dsc: 'AI管理员变更响应',
            event: 'notice.group.admin',
            priority: 100,
            rule: [{ fnc: 'handleAdmin', log: false }]
        })
    }
    
    async handleAdmin() {
        const e = this.e
        
        if (!config.get('features.admin.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const userId = e.user_id
        const isSet = e.sub_type === 'set'
        
        // 机器人成为/取消管理员
        if (botIds.has(String(userId))) {
            logger.info(`[AI-Admin] 机器人${isSet ? '成为' : '取消'}管理员`)
            
            if (config.get('features.admin.aiResponse')) {
                const eventDesc = `[事件通知] 你${isSet ? '被设置成了群管理员' : '的管理员身份被取消了'}！请简短表达一下。`
                const aiReply = await getAIResponse(eventDesc, {
                    userId: e.self_id,
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
 * 运气王响应 (红包)
 */
export class AI_LuckyKing extends plugin {
    constructor() {
        super({
            name: 'AI-LuckyKing',
            dsc: 'AI运气王响应',
            event: 'notice.notify',
            priority: 100,
            rule: [{ fnc: 'handleLuckyKing', log: false }]
        })
    }
    
    async handleLuckyKing() {
        const e = this.e
        
        // 只处理运气王事件
        if (e.sub_type !== 'lucky_king') {
            return false
        }
        
        if (!config.get('features.luckyKing.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const userId = e.target_id || e.user_id
        
        // 机器人是运气王
        if (botIds.has(String(userId))) {
            logger.info(`[AI-LuckyKing] 机器人成为运气王`)
            
            const eventDesc = `[事件通知] 你成为了红包运气王！请简短表达一下开心或得意。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: e.self_id,
                groupId: e.group_id,
                maxLength: 50
            })
            
            if (aiReply) {
                await this.reply(aiReply)
                return true
            }
        } else if (config.get('features.luckyKing.congratulate')) {
            const nickname = await getUserNickname(e, userId)
            logger.info(`[AI-LuckyKing] ${nickname}(${userId}) 成为运气王`)
            
            const eventDesc = `[事件通知] ${nickname} 成为了红包运气王！你可以简短祝贺一下。`
            const aiReply = await getAIResponse(eventDesc, {
                userId,
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
 * 群荣誉响应 (龙王/群聊之火等)
 */
export class AI_Honor extends plugin {
    constructor() {
        super({
            name: 'AI-Honor',
            dsc: 'AI群荣誉响应',
            event: 'notice.notify',
            priority: 100,
            rule: [{ fnc: 'handleHonor', log: false }]
        })
    }
    
    async handleHonor() {
        const e = this.e
        
        // 只处理荣誉事件
        if (e.sub_type !== 'honor') {
            return false
        }
        
        if (!config.get('features.honor.enabled')) {
            return false
        }
        
        const botIds = getBotIds()
        const userId = e.user_id
        const honorType = e.honor_type || '群荣誉'
        
        // 荣誉类型映射
        const honorNames = {
            'talkative': '龙王',
            'performer': '群聊之火',
            'legend': '群聊炽焰',
            'strong_newbie': '冒尖小春笋',
            'emotion': '快乐源泉'
        }
        const honorName = honorNames[honorType] || honorType
        
        // 机器人获得荣誉
        if (botIds.has(String(userId))) {
            logger.info(`[AI-Honor] 机器人获得荣誉: ${honorName}`)
            
            const eventDesc = `[事件通知] 你获得了群荣誉"${honorName}"！请简短表达一下。`
            const aiReply = await getAIResponse(eventDesc, {
                userId: e.self_id,
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
