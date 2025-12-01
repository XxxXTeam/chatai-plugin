import config from '../config/config.js'
import { cleanCQCode } from '../src/utils/messageParser.js'

/**
 * 伪人模式 (BYM - Be Yourself Mode)
 * 让Bot像真人一样随机回复消息
 */
export class bym extends plugin {
    constructor() {
        super({
            name: 'AI-伪人模式',
            dsc: 'AI伪人模式',
            event: 'message',
            priority: 6000,
            rule: [
                {
                    reg: '^[^#].*',  // 匹配非命令消息
                    fnc: 'bym',
                    log: false
                }
            ]
        })
    }

    /**
     * 伪人模式触发logic
     */
    async bym() {
        const e = this.e
        // 检查是否启用
        const enabled = config.get('bym.enable')
        if (!enabled) {
            return false
        }

        // 随机触发概率
        const probability = config.get('bym.probability') || 0.02
        if (Math.random() > probability) {
            return false
        }

        // Check if OpenAI is configured
        const apiKey = config.get('openai.apiKey')
        if (!apiKey) {
            logger.warn('[BYM] OpenAI API Key not configured')
            return false
        }

        try {
            logger.info('[BYM] 伪人模式触发')

            // Use LlmService to create client
            const { LlmService } = await import('../src/services/LlmService.js')
            // BYM usually doesn't need tools, but we can enable them if needed
            const client = await LlmService.createClient({ enableTools: false })

            // Get message text and clean CQ codes
            const messageText = cleanCQCode(e.msg || '')
            if (!messageText.trim()) {
                return false
            }

            // Determine system prompt based on preset map
            let systemPrompt = config.get('bym.systemPrompt') ||
                '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。'

            const presetMap = config.get('bym.presetMap') || {}
            for (const [keyword, presetId] of Object.entries(presetMap)) {
                if (messageText.includes(keyword)) {
                    // Use LlmService to get preset prompt
                    const presetPrompt = LlmService.getSystemPrompt(presetId)
                    if (presetPrompt) {
                        systemPrompt = presetPrompt
                        logger.info(`[BYM] Matched keyword "${keyword}", using preset "${presetId}"`)
                    }
                    break
                }
            }

            const userMessage = {
                role: 'user',
                content: [{ type: 'text', text: messageText }],
            }

            // Context management: include sender info
            if (e.sender) {
                systemPrompt += `\n当前对话者: ${e.sender.card || e.sender.nickname || '未知用户'}`
            }
            if (e.group_name) {
                systemPrompt += `\n当前群聊: ${e.group_name}`
            }

            // 使用伪人模型或配置的模型
            const bymModel = config.get('bym.model') || LlmService.selectModel({ isRoleplay: true })

            const response = await client.sendMessage(userMessage, {
                model: bymModel,
                conversationId: `bym_${e.group_id || e.user_id}_${Date.now()}`, // Use group_id for context if available
                systemOverride: systemPrompt,
                temperature: config.get('bym.temperature') || 0.9,
                maxToken: config.get('bym.maxTokens') || 100,
            })

            const replyText = response.contents
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n')

            if (replyText) {
                // 添加延迟模拟打字
                await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500))

                // 是否撤回
                const recall = config.get('bym.recall')
                await this.reply(replyText, false, { recallMsg: recall ? 10 : 0 })
            }

            return true
        } catch (error) {
            logger.error('[BYM] Error:', error)
            return false
        }
    }

    /**
     * 发送合并转发消息
     * @param {string} title 标题
     * @param {Array} messages 消息数组
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendForwardMsg(title, messages) {
        const e = this.e
        if (!e) return false
        
        try {
            const bot = e.bot || Bot
            const botId = bot?.uin || e.self_id || 10000
            
            const forwardNodes = messages.map(msg => ({
                user_id: botId,
                nickname: title || 'Bot',
                message: Array.isArray(msg) ? msg : [msg]
            }))
            
            if (e.isGroup && e.group?.makeForwardMsg) {
                const forwardMsg = await e.group.makeForwardMsg(forwardNodes)
                if (forwardMsg) {
                    await e.group.sendMsg(forwardMsg)
                    return true
                }
            } else if (!e.isGroup && e.friend?.makeForwardMsg) {
                const forwardMsg = await e.friend.makeForwardMsg(forwardNodes)
                if (forwardMsg) {
                    await e.friend.sendMsg(forwardMsg)
                    return true
                }
            }
            
            return false
        } catch (err) {
            logger.debug('[BYM] sendForwardMsg failed:', err.message)
            return false
        }
    }
}
