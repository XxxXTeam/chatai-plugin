/**
 * AI 戳一戳事件处理
 * 使用AI人设响应戳一戳
 * 
 * 兼容平台: icqq / NapCat / OneBot v11 / go-cqhttp / TRSS-Yunzai
 * 
 * 事件格式:
 * - notice.group.poke  群聊戳一戳
 * - notice.friend.poke 私聊戳一戳
 * - notice.*.poke      通配匹配
 * 
 * 事件属性:
 * - e.target_id    被戳者
 * - e.operator_id  操作者 (或 e.user_id)
 * - e.group_id     群号 (群聊时)
 */
import config from '../config/config.js'
import { getBotIds } from '../src/utils/messageDedup.js'

/**
 * 获取用户昵称
 */
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

/**
 * 调用AI生成响应
 */
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
        logger.debug('[AI-Poke] AI响应失败:', err.message)
        return null
    }
}

export class AI_Poke extends plugin {
    constructor() {
        super({
            name: 'AI-Poke',
            dsc: 'AI戳一戳响应',
            event: 'notice.*.poke',
            priority: -200,
            rule: [{ fnc: 'handlePoke', log: false }]
        })
    }

    async handlePoke() {
        const e = this.e
        
        // 功能开关
        if (!config.get('features.poke.enabled')) {
            return false
        }
        
        // 检查是否戳的是机器人
        if (e.target_id !== e.self_id) {
            return false
        }
        
        // 群聊检查
        const isGroup = !!e.group_id
        
        const operator = e.operator_id || e.user_id
        const nickname = await getUserNickname(e, operator)
        
        logger.info(`[AI-Poke] ${nickname}(${operator}) ${isGroup ? '群聊' : '私聊'}戳了机器人`)
        
        // 调用AI响应
        const eventDesc = `[事件通知] ${nickname} 戳了你一下。请根据你的人设性格，给出一个简短自然的回应。`
        const aiReply = await getAIResponse(eventDesc, {
            userId: operator,
            groupId: e.group_id,
            maxLength: 100
        })
        
        if (aiReply) {
            await this.reply(aiReply)
            // 回戳
            if (config.get('features.poke.pokeBack') && isGroup) {
                await this.pokeBack(e, operator)
            }
            return true
        }
        
        // 默认回复
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
                    await bot.sendGroupPoke(e.group_id, userId)
                }
            }
        } catch (err) {
            logger.debug('[AI-Poke] 回戳失败:', err.message)
        }
    }
}
