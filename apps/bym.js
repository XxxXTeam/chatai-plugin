import config from '../config/config.js'
import { cleanCQCode } from '../src/utils/messageParser.js'
import { isMessageProcessed, markMessageProcessed, isSelfMessage } from './chat.js'
import { getScopeManager } from '../src/services/ScopeManager.js'
import { databaseService } from '../src/services/DatabaseService.js'

/**
 * 伪人模式 (BYM - Be Yourself Mode)
 * 让Bot像真人一样随机回复消息
 * 支持继承用户/群组独立人格配置
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
        
        // 防护：忽略自身消息
        if (isSelfMessage(e)) {
            return false
        }
        
        // 防止重复触发
        if (isMessageProcessed(e)) {
            return false
        }
        
        // 检查是否启用
        const enabled = config.get('bym.enable')
        if (!enabled) {
            return false
        }
        
        // 检查是否被@（被@时应由其他插件处理）
        if (e.atBot) {
            return false
        }

        // 随机触发概率 - 确保配置值有效
        let probability = config.get('bym.probability')
        if (probability === undefined || probability === null || isNaN(probability)) {
            probability = 0.02 // 默认2%
        }
        probability = Math.max(0, Math.min(1, Number(probability))) // 确保在0-1范围内
        
        const randomValue = Math.random()
        if (randomValue > probability) {
            return false
        }
        
        logger.info(`[BYM] 触发判定: random=${randomValue.toFixed(4)}, probability=${probability}, 触发成功`)

        try {
            // 标记消息已处理
            markMessageProcessed(e)
            
            logger.info('[BYM] 伪人模式触发')

            // 使用 LlmService 获取聊天客户端（自动处理渠道和模型选择）
            const { LlmService } = await import('../src/services/LlmService.js')
            
            // 获取伪人模型或默认模型
            const bymModel = config.get('bym.model') || config.get('llm.defaultModel') || LlmService.selectModel({ isRoleplay: true })
            
            // 使用getChatClient获取客户端，它会自动处理渠道选择
            const client = await LlmService.getChatClient({ 
                enableTools: false,
                model: bymModel
            })
            
            if (!client) {
                logger.warn('[BYM] 无法获取聊天客户端')
                return false
            }

            // Get message text and clean CQ codes
            const messageText = cleanCQCode(e.msg || '')
            if (!messageText.trim()) {
                return false
            }

            // === 构建系统提示词（支持继承人格配置） ===
            let systemPrompt = ''
            const inheritPersonality = config.get('bym.inheritPersonality') !== false // 默认启用继承
            
            // 1. 尝试获取独立人格配置
            if (inheritPersonality) {
                try {
                    databaseService.init()
                    const scopeManager = getScopeManager(databaseService)
                    await scopeManager.init()
                    
                    const groupId = e.group_id ? String(e.group_id) : null
                    const userId = String(e.user_id || e.sender?.user_id)
                    
                    // 获取独立人格（优先级：群用户 > 群 > 用户全局）
                    const defaultBymPrompt = config.get('bym.systemPrompt') || 
                        '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。'
                    
                    const independentResult = await scopeManager.getIndependentPrompt(groupId, userId, defaultBymPrompt)
                    
                    if (independentResult.isIndependent) {
                        // 使用独立人格，并添加伪人模式的行为指导
                        systemPrompt = independentResult.prompt
                        systemPrompt += '\n\n【伪人模式行为指导】\n请用简短、自然、口语化的方式回复，就像真人聊天一样。回复要简洁（通常1-2句话），可以使用语气词和网络用语。'
                        logger.info(`[BYM] 使用独立人格 (来源: ${independentResult.source})`)
                    } else {
                        systemPrompt = defaultBymPrompt
                    }
                } catch (err) {
                    logger.debug('[BYM] 获取独立人格失败，使用默认:', err.message)
                    systemPrompt = config.get('bym.systemPrompt') ||
                        '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。'
                }
            } else {
                // 不继承，使用BYM固定配置
                systemPrompt = config.get('bym.systemPrompt') ||
                    '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。'
            }

            // 2. 检查关键词预设映射（可覆盖上面的设置）
            const presetMap = config.get('bym.presetMap') || {}
            for (const [keyword, presetId] of Object.entries(presetMap)) {
                if (messageText.includes(keyword)) {
                    const presetPrompt = LlmService.getSystemPrompt(presetId)
                    if (presetPrompt) {
                        systemPrompt = presetPrompt
                        logger.info(`[BYM] 匹配关键词 "${keyword}", 使用预设 "${presetId}"`)
                    }
                    break
                }
            }

            const userMessage = {
                role: 'user',
                content: [{ type: 'text', text: messageText }],
            }

            // 3. 添加上下文信息
            if (e.sender) {
                systemPrompt += `\n当前对话者: ${e.sender.card || e.sender.nickname || '未知用户'}`
            }
            if (e.group_name) {
                systemPrompt += `\n当前群聊: ${e.group_name}`
            }

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
