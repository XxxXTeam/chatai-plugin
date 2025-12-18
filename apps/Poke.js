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
 * 调用 OneBot API (支持 NapCat/go-cqhttp/LLOneBot)
 */
async function callOneBotApi(bot, action, params = {}) {
    if (bot.sendApi) {
        return await bot.sendApi(action, params)
    }
    if (bot[action]) {
        return await bot[action](params)
    }
    if (bot.config?.baseUrl || bot.adapter?.config?.baseUrl) {
        const baseUrl = bot.config?.baseUrl || bot.adapter?.config?.baseUrl
        const res = await fetch(`${baseUrl}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        })
        return await res.json()
    }
    throw new Error('不支持的协议类型')
}

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
        
        const botIds = getBotIds()
        const selfId = e.self_id || e.bot?.uin || Bot?.uin
        const targetId = e.target_id || e.poke_uid || e.target_uid
        const operator = e.operator_id || e.user_id || e.sender_id
        
        // 检查是否戳的是机器人 (兼容多种适配器属性名)
        if (targetId !== selfId && !botIds.has(String(targetId))) {
            return false
        }
        
        // 防止机器人自己触发 (回戳导致的循环)
        if (operator === selfId || botIds.has(String(operator))) {
            return false
        }
        
        // 群聊检查
        const isGroup = !!e.group_id
        
        const nickname = await getUserNickname(e, operator)
        
        logger.info(`[AI-Poke] ${nickname}(${operator}) ${isGroup ? '群聊' : '私聊'}戳了机器人`)
        
        // 获取自定义提示词模板，支持 {nickname} 占位符
        const defaultPrompt = `[事件通知] {nickname} 戳了你一下。请根据你的人设性格，给出一个简短自然的回应。`
        const promptTemplate = config.get('features.poke.prompt') || defaultPrompt
        const eventDesc = promptTemplate.replace(/\{nickname\}/g, nickname)
        
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
    
    /**
     * 回戳用户 - 全适配器兼容
     * 支持: icqq / NapCat / go-cqhttp / LLOneBot / Lagrange
     */
    async pokeBack(e, userId) {
        try {
            const bot = e.bot || Bot
            const groupId = e.group_id
            
            if (!groupId) return
            
            // 方式1: icqq - group.pokeMember
            if (bot.pickGroup) {
                const group = bot.pickGroup(groupId)
                if (typeof group?.pokeMember === 'function') {
                    await group.pokeMember(userId)
                    return
                }
                // 方式2: icqq - pickMember().poke()
                if (group?.pickMember) {
                    const member = group.pickMember(userId)
                    if (typeof member?.poke === 'function') {
                        await member.poke()
                        return
                    }
                }
            }
            
            // 方式3: NapCat/go-cqhttp - send_group_poke / group_poke API
            try {
                // NapCat 扩展 API
                await callOneBotApi(bot, 'send_group_poke', {
                    group_id: parseInt(groupId),
                    user_id: parseInt(userId)
                })
                return
            } catch {}
            
            try {
                // go-cqhttp API
                await callOneBotApi(bot, 'group_poke', {
                    group_id: parseInt(groupId),
                    user_id: parseInt(userId)
                })
                return
            } catch {}
            
            // 方式4: bot.sendGroupPoke
            if (typeof bot?.sendGroupPoke === 'function') {
                await bot.sendGroupPoke(groupId, userId)
                return
            }
            
            // 方式5: 发送戳一戳消息段 (部分适配器支持)
            try {
                const pokeMsg = { type: 'poke', data: { qq: String(userId) } }
                await bot.sendGroupMsg?.(groupId, [pokeMsg])
            } catch {}
            
        } catch (err) {
            logger.debug('[AI-Poke] 回戳失败:', err.message)
        }
    }
}
