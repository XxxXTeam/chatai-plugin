/**
 * AI 事件处理插件
 * 处理戳一戳、表情回应等事件
 * 使用AI人设进行响应，默认关闭
 * 兼容 icqq / NapCat / OneBot
 */
import config from '../config/config.js'
import { getBotFramework } from '../utils/bot.js'

/**
 * 获取用户昵称
 */
async function getUserNickname(e, userId) {
    try {
        const bot = e.bot || Bot
        if (e.group_id) {
            const group = bot.pickGroup(e.group_id)
            const member = group?.pickMember?.(userId)
            const info = await member?.getInfo?.() || member?.info || member
            return info?.nickname || info?.card || String(userId)
        } else {
            const friend = bot.pickFriend(userId)
            const info = await friend?.getInfo?.() || friend?.info || friend
            return info?.nickname || String(userId)
        }
    } catch {
        return String(userId)
    }
}

/**
 * 戳一戳事件处理 - 群聊
 * 默认关闭，需在面板配置开启
 */
export class PokeHandler extends plugin {
    constructor() {
        super({
            name: 'AI-Poke',
            dsc: 'AI戳一戳响应（使用人设）',
            event: 'notice.group.poke',
            priority: 100,
            rule: [{ fnc: 'handlePoke' }]
        })
    }

    async handlePoke() {
        const e = this.e
        
        // 默认关闭，需配置开启
        if (!config.get('features.poke.enabled')) {
            return false
        }
        
        const operator = e.operator_id || e.user_id
        const target = e.target_id || e.self_id
        const botId = e.bot?.uin || e.self_id
        
        // 只响应戳机器人
        if (String(target) !== String(botId)) {
            return false
        }
        
        const nickname = await getUserNickname(e, operator)
        logger.info(`[AI-Poke] ${nickname}(${operator}) 戳了机器人`)
        
        // 使用AI人设处理
        try {
            const { chatService } = await import('../src/services/ChatService.js')
            
            // 构建事件描述，让AI根据人设回应
            const eventDesc = `[事件通知] ${nickname} 戳了你一下。请根据你的人设性格，给出一个简短自然的回应。`
            
            const result = await chatService.sendMessage({
                userId: String(operator),
                groupId: e.group_id ? String(e.group_id) : null,
                message: eventDesc,
                mode: 'roleplay',
                skipHistory: true  // 不记录到历史
            })
            
            const aiReply = result.response
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            if (aiReply) {
                await this.reply(aiReply)
                
                // 可选：回戳
                if (config.get('features.poke.pokeBack')) {
                    await this.pokeBack(e, operator)
                }
                return true
            }
        } catch (err) {
            logger.warn('[AI-Poke] AI回复失败:', err.message)
        }
        
        // 回退：使用默认回复
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
 */
export class PrivatePokeHandler extends plugin {
    constructor() {
        super({
            name: 'AI-PrivatePoke',
            dsc: 'AI私聊戳一戳响应（使用人设）',
            event: 'notice.friend.poke',
            priority: 100,
            rule: [{ fnc: 'handlePoke' }]
        })
    }

    async handlePoke() {
        const e = this.e
        
        if (!config.get('features.poke.enabled')) {
            return false
        }
        
        const operator = e.operator_id || e.user_id
        const nickname = await getUserNickname(e, operator)
        logger.info(`[AI-PrivatePoke] ${nickname}(${operator}) 私聊戳了机器人`)
        
        try {
            const { chatService } = await import('../src/services/ChatService.js')
            
            const eventDesc = `[事件通知] ${nickname} 在私聊中戳了你一下。请根据你的人设性格，给出一个简短自然的回应。`
            
            const result = await chatService.sendMessage({
                userId: String(operator),
                message: eventDesc,
                mode: 'roleplay',
                skipHistory: true
            })
            
            const aiReply = result.response
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            if (aiReply) {
                await this.reply(aiReply)
                return true
            }
        } catch (err) {
            logger.warn('[AI-PrivatePoke] AI回复失败:', err.message)
        }
        
        await this.reply(config.get('features.poke.message') || '别戳了~')
        return true
    }
}

/**
 * 表情回应事件处理
 * 默认关闭，需在面板配置开启
 * 支持 NapCat 的 group_msg_emoji_like 事件
 */
export class MessageReactionHandler extends plugin {
    constructor() {
        super({
            name: 'AI-MessageReaction',
            dsc: 'AI表情回应处理（使用人设）',
            event: 'notice',
            priority: 100,
            rule: [{ fnc: 'handleReaction' }]
        })
    }
    
    async handleReaction() {
        const e = this.e
        
        // 检查是否是表情回应事件
        const isReaction = e.notice_type === 'group_msg_emoji_like' || 
                          e.sub_type === 'emoji_like' ||
                          (e.emoji_id && e.message_id)
        
        if (!isReaction) {
            return false
        }
        
        // 默认关闭
        if (!config.get('features.reaction.enabled')) {
            return false
        }
        
        const nickname = await getUserNickname(e, e.user_id)
        
        // 表情名称映射
        const emojiMap = {
            '76': '赞👍',
            '124': '爱心❤️',
            '66': '笑脸😊',
            '277': '火焰🔥',
            '179': '疑问❓',
            '42': '鼓掌👏'
        }
        
        const emojiDesc = emojiMap[String(e.emoji_id)] || `表情(${e.emoji_id})`
        
        logger.info(`[AI-Reaction] ${nickname}(${e.user_id}) 对消息做出了 ${emojiDesc} 回应`)
        
        try {
            const { chatService } = await import('../src/services/ChatService.js')
            
            const eventDesc = `[事件通知] ${nickname} 对你之前的消息做出了"${emojiDesc}"的表情回应。如果你觉得有必要回应可以简短回复，否则可以忽略。`
            
            const result = await chatService.sendMessage({
                userId: String(e.user_id),
                groupId: e.group_id ? String(e.group_id) : null,
                message: eventDesc,
                mode: 'roleplay',
                skipHistory: true
            })
            
            const aiReply = result.response
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            // 只有短回复才发送，避免刷屏
            if (aiReply && aiReply.length <= 50) {
                await this.reply(aiReply)
                return true
            }
        } catch (err) {
            logger.debug('[AI-Reaction] AI处理失败:', err.message)
        }
        
        return false
    }
}
