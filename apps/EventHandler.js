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
        
        // 获取机器人ID（多平台兼容）
        const bot = e.bot || Bot
        
        // 收集所有可能的机器人ID
        const botIds = new Set()
        if (bot?.uin) botIds.add(String(bot.uin))
        if (e.self_id) botIds.add(String(e.self_id))
        if (bot?.self_id) botIds.add(String(bot.self_id))
        if (Bot?.uin) botIds.add(String(Bot.uin))
        // NapCat/Lagrange 可能使用这些字段
        if (bot?.config?.qq) botIds.add(String(bot.config.qq))
        if (bot?.qq) botIds.add(String(bot.qq))
        
        // 获取操作者和目标（多平台兼容）
        // NapCat: operator_id=戳人者, target_id=被戳者
        // icqq: user_id=戳人者, target=被戳者
        // OneBot: user_id=戳人者, target_id=被戳者
        const operator = e.operator_id || e.user_id || e.sender_id
        const target = e.target_id || e.poked_uid || e.target
        
        // 如果没有 target，可能是不支持的事件格式
        if (!target && !operator) {
            logger.debug('[AI-Poke] 忽略：无法获取操作者和目标')
            return false
        }
        
        // 严格检查：只响应戳机器人自己
        const targetStr = String(target)
        if (target && !botIds.has(targetStr)) {
            // 别人戳别人，忽略
            logger.debug(`[AI-Poke] 忽略：target=${target} 不是bot (botIds=${[...botIds].join(',')})`)
            return false
        }
        
        // 防止机器人自己触发
        if (operator && botIds.has(String(operator))) {
            logger.debug('[AI-Poke] 忽略：机器人自己戳人')
            return false
        }
        
        // 双重验证：确保 operator 和 target 不相同（排除自己戳自己）
        if (operator && target && String(operator) === String(target)) {
            logger.debug('[AI-Poke] 忽略：自己戳自己')
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
        
        // 获取机器人ID（多平台兼容）
        const bot = e.bot || Bot
        const botIds = new Set()
        if (bot?.uin) botIds.add(String(bot.uin))
        if (e.self_id) botIds.add(String(e.self_id))
        if (bot?.self_id) botIds.add(String(bot.self_id))
        if (Bot?.uin) botIds.add(String(Bot.uin))
        if (bot?.config?.qq) botIds.add(String(bot.config.qq))
        if (bot?.qq) botIds.add(String(bot.qq))
        
        // 获取操作者和目标
        const operator = e.operator_id || e.user_id || e.sender_id
        const target = e.target_id || e.poked_uid || e.target
        
        // 私聊戳一戳也要检查目标是否是机器人
        if (target && !botIds.has(String(target))) {
            logger.debug(`[AI-PrivatePoke] 忽略：target=${target} 不是bot`)
            return false
        }
        
        // 防止机器人自己触发
        if (operator && botIds.has(String(operator))) {
            logger.debug('[AI-PrivatePoke] 忽略：机器人自己触发')
            return false
        }
        
        // 排除自己戳自己
        if (operator && target && String(operator) === String(target)) {
            logger.debug('[AI-PrivatePoke] 忽略：自己戳自己')
            return false
        }
        
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
        
        // 获取机器人ID（多平台兼容）
        const bot = e.bot || Bot
        const botIds = new Set()
        if (bot?.uin) botIds.add(String(bot.uin))
        if (e.self_id) botIds.add(String(e.self_id))
        if (bot?.self_id) botIds.add(String(bot.self_id))
        if (Bot?.uin) botIds.add(String(Bot.uin))
        
        // 检查被回应的消息是否是机器人发的
        // NapCat: e.message_sender_id 表示原消息发送者
        // 其他适配器可能需要通过 message_id 获取
        let msgSenderId = e.message_sender_id || e.target_id
        
        // 如果没有直接的发送者ID，尝试通过message_id获取原消息
        if (!msgSenderId && e.message_id) {
            try {
                if (typeof bot?.getMsg === 'function') {
                    const originalMsg = await bot.getMsg(e.message_id)
                    msgSenderId = originalMsg?.sender?.user_id || originalMsg?.user_id
                }
            } catch (err) {
                logger.debug(`[AI-Reaction] 获取原消息失败: ${err.message}`)
            }
        }
        
        // 如果仍然无法确定原消息发送者，跳过检查（兼容旧版本）
        if (msgSenderId && !botIds.has(String(msgSenderId))) {
            // 不是对机器人消息的回应，忽略
            logger.debug(`[AI-Reaction] 忽略：回应的消息发送者(${msgSenderId})不是机器人`)
            return false
        }
        
        // 如果无法确定原消息发送者，默认不响应（安全策略）
        if (!msgSenderId) {
            logger.debug('[AI-Reaction] 忽略：无法确定原消息发送者')
            return false
        }
        
        // 防止机器人自己触发
        if (e.user_id && botIds.has(String(e.user_id))) {
            logger.debug('[AI-Reaction] 忽略：机器人自己的表情回应')
            return false
        }
        
        const nickname = await getUserNickname(e, e.user_id)
        
        // 获取表情ID（多平台兼容）
        // NapCat: e.likes 是数组 [{emoji_id, count}]
        // 其他: e.emoji_id 直接是ID
        let emojiId = e.emoji_id
        if (!emojiId && e.likes && Array.isArray(e.likes) && e.likes.length > 0) {
            emojiId = e.likes[0].emoji_id || e.likes[0].id
        }
        if (!emojiId && e.face_id) {
            emojiId = e.face_id
        }
        
        // 表情名称映射
        const emojiMap = {
            '76': '赞👍',
            '124': '爱心❤️', 
            '66': '笑脸😊',
            '277': '火焰🔥',
            '179': '疑问❓',
            '42': '鼓掌👏',
            '32': '厉害👍',
            '1': '撇嘴',
            '2': '色',
            '4': '得意',
            '5': '流泪',
            '8': '睡',
            '9': '大哭',
            '10': '尴尬',
            '12': '调皮',
            '14': '微笑',
            '21': '可爱'
        }
        
        const emojiDesc = emojiId ? (emojiMap[String(emojiId)] || `表情[${emojiId}]`) : '未知表情'
        
        logger.info(`[AI-Reaction] ${nickname}(${e.user_id}) 对机器人消息做出了 ${emojiDesc} 回应`)
        
        try {
            const { chatService } = await import('../src/services/ChatService.js')
            
            const eventDesc = `[事件通知] ${nickname} 对你之前的消息做出了"${emojiDesc}"的表情回应。这是对你消息的正面反馈，你可以简短回应表示感谢或互动，也可以选择不回复。`
            
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
