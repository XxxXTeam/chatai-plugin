/**
 * AI 戳一戳事件处理
 * 使用AI人设响应戳一戳
 */
import config from '../config/config.js'
import { getBotIds } from '../src/utils/messageDedup.js'
import { parsePokeEvent, sendPoke, getUserNickname, getBot } from '../src/utils/eventAdapter.js'

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
        let reply =
            result.response
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

        // 使用统一事件解析
        const pokeInfo = parsePokeEvent(e)
        const { targetId, operatorId, selfId, isGroup, groupId } = pokeInfo
        const botIds = getBotIds()

        // 检查是否戳的是机器人
        if (targetId !== selfId && !botIds.has(String(targetId))) {
            return false
        }

        // 防止机器人自己触发 (回戳导致的循环)
        if (operatorId === selfId || botIds.has(String(operatorId))) {
            return false
        }

        const nickname = await getUserNickname(e, operatorId)

        logger.info(`[AI-Poke] ${nickname}(${operatorId}) ${isGroup ? '群聊' : '私聊'}戳了机器人`)

        // 获取自定义提示词模板，支持占位符
        const defaultPrompt = `[事件通知] {nickname} 戳了你一下。请根据你的人设性格，给出一个简短自然的回应。`
        const promptTemplate = config.get('features.poke.prompt') || defaultPrompt
        const eventDesc = promptTemplate
            .replace(/\{nickname\}/g, nickname)
            .replace(/\{user_id\}/g, String(operatorId))
            .replace(/\{group_id\}/g, String(groupId || ''))

        const aiReply = await getAIResponse(eventDesc, {
            userId: operatorId,
            groupId: groupId,
            maxLength: 100
        })

        if (aiReply) {
            await this.reply(aiReply)
            // 回戳
            if (config.get('features.poke.pokeBack') && isGroup) {
                await this.pokeBack(e, operatorId)
            }
            return true
        }

        // 默认回复
        const defaultMsg = config.get('features.poke.message') || '别戳了~'
        await this.reply(defaultMsg)
        return true
    }

    /**
     * 回戳用户 - 使用统一适配器接口
     */
    async pokeBack(e, userId) {
        try {
            const groupId = e.group_id
            if (!groupId) return

            const success = await sendPoke(e, userId, groupId)
            if (!success) {
                logger.debug('[AI-Poke] 回戳失败: 不支持的适配器或API')
            }
        } catch (err) {
            logger.debug('[AI-Poke] 回戳失败:', err.message)
        }
    }
}
