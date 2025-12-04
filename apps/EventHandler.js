/**
 * AI 事件处理插件
 * 处理戳一戳、表情回应等事件
 * 使用AI人设进行响应，默认关闭
 * 兼容 icqq / NapCat / OneBot / go-cqhttp
 */
import config from '../config/config.js'

/**
 * 获取用户昵称（多平台兼容）
 */
async function getUserNickname(e, userId) {
    try {
        const bot = e.bot || Bot
        
        // 尝试多种方式获取昵称
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
        
        // 3. 从好友信息获取
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
 * 戳一戳事件处理 - 群聊
 * 默认关闭，需在面板配置开启
 * 兼容：icqq(notice.group.poke) / NapCat/OneBot(notice.notify.poke)
 */
export class PokeHandler extends plugin {
    constructor() {
        super({
            name: 'AI-Poke',
            dsc: 'AI戳一戳响应（使用人设）',
            event: 'notice',  // 监听所有notice事件，内部判断
            priority: 100,
            rule: [{ fnc: 'handlePoke' }]
        })
    }

    async handlePoke() {
        const e = this.e
        
        // 检查是否是戳一戳事件（多平台兼容）
        const isPoke = (
            e.notice_type === 'group_poke' ||           // NapCat 群戳
            e.sub_type === 'poke' ||                    // OneBot poke
            (e.notice_type === 'notify' && e.sub_type === 'poke') ||  // go-cqhttp
            e.action === 'poke' ||                      // 某些适配器
            (e.notice_type === 'group' && e.sub_type === 'poke')    // icqq
        )
        
        // 私聊戳一戳由 PrivatePokeHandler 处理
        if (!isPoke || !e.group_id) {
            return false
        }
        
        // 默认关闭，需配置开启
        if (!config.get('features.poke.enabled')) {
            return false
        }
        
        // 获取操作者和目标（多平台兼容）
        const operator = e.operator_id || e.user_id || e.sender_id
        const target = e.target_id || e.poked_uid || e.target
        
        // 获取机器人ID（多平台兼容）
        const bot = e.bot || Bot
        const botId = bot?.uin || e.self_id || bot?.self_id
        
        // 收集所有可能的机器人ID
        const botIds = new Set()
        if (botId) botIds.add(String(botId))
        if (e.self_id) botIds.add(String(e.self_id))
        if (bot?.self_id) botIds.add(String(bot.self_id))
        if (Bot?.uin) botIds.add(String(Bot.uin))
        
        // 严格检查：只响应戳机器人自己
        const targetStr = String(target)
        if (!botIds.has(targetStr)) {
            logger.debug(`[AI-Poke] 忽略：target=${target} 不是bot (botIds=${[...botIds].join(',')})`)
            return false
        }
        
        // 防止自己戳自己触发
        if (operator && botIds.has(String(operator))) {
            logger.debug('[AI-Poke] 忽略：机器人自己戳自己')
            return false
        }
        
        const nickname = await getUserNickname(e, operator)
        logger.info(`[AI-Poke] ${nickname}(${operator}) 戳了机器人`)
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
 * 兼容多平台
 */
export class PrivatePokeHandler extends plugin {
    constructor() {
        super({
            name: 'AI-PrivatePoke',
            dsc: 'AI私聊戳一戳响应（使用人设）',
            event: 'notice',  // 监听所有notice事件
            priority: 100,
            rule: [{ fnc: 'handlePoke' }]
        })
    }

    async handlePoke() {
        const e = this.e
        
        // 检查是否是私聊戳一戳事件
        const isPrivatePoke = (
            (e.notice_type === 'friend_poke') ||                    // NapCat
            (e.notice_type === 'friend' && e.sub_type === 'poke') || // icqq
            (e.sub_type === 'poke' && !e.group_id) ||               // OneBot 无群号
            (e.notice_type === 'notify' && e.sub_type === 'poke' && !e.group_id)  // go-cqhttp
        )
        
        if (!isPrivatePoke) {
            return false
        }
        
        if (!config.get('features.poke.enabled')) {
            return false
        }
        
        const operator = e.operator_id || e.user_id || e.sender_id
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
 * 兼容多平台
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
        
        // 检查是否是表情回应事件（多平台兼容）
        const isReaction = (
            e.notice_type === 'group_msg_emoji_like' ||  // NapCat
            e.notice_type === 'essence' ||               // 精华消息变动
            e.sub_type === 'emoji_like' ||               // OneBot
            e.sub_type === 'reaction' ||                 // 通用
            (e.emoji_id !== undefined && e.message_id) ||
            (e.likes && e.message_id)                    // 某些适配器的点赞格式
        )
        
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
