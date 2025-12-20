import config from '../config/config.js'
import { cleanCQCode } from '../src/utils/messageParser.js'
// 从核心模块导入去重函数
import { isMessageProcessed, markMessageProcessed, isSelfMessage, isReplyToBotMessage } from '../src/utils/messageDedup.js'
import { getScopeManager } from '../src/services/scope/ScopeManager.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { usageStats } from '../src/services/stats/UsageStats.js'

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
        if (e.atBot && !isReplyToBotMessage(e)) {
            return false
        }
        const processImage = config.get('bym.processImage') !== false // 默认处理图片
        const hasImage = (e.img && e.img.length > 0) || 
                         (e.message && e.message.some(m => m.type === 'image'))
        if (!processImage && hasImage) {
            logger.debug('[BYM] 跳过: 消息包含图片且未启用图片处理')
            return false
        }
        let probabilityRaw = config.get('bym.probability')
        let probability = probabilityRaw
        logger.debug(`[BYM] probability原始值: ${probabilityRaw}, 类型: ${typeof probabilityRaw}`)
        
        if (probability === undefined || probability === null || isNaN(Number(probability))) {
            probability = 0.02 // 默认2%
        } else {
            probability = Number(probability)
        }
        probability = Math.max(0, Math.min(1, probability)) // 确保在0-1范围内
        
        // 如果概率为0，直接不触发
        if (probability === 0) {
            logger.debug('[BYM] 概率为0，不触发')
            return false
        }
        
        const randomValue = Math.random()
        logger.debug(`[BYM] 触发判定: random=${randomValue.toFixed(4)}, probability=${probability}`)
        
        if (randomValue > probability) {
            return false
        }
        
        logger.info(`[BYM] 触发成功: random=${randomValue.toFixed(4)} <= probability=${probability}`)

        try {
            // 标记消息已处理
            markMessageProcessed(e)
            
            logger.info('[BYM] 伪人模式触发')
            const { LlmService } = await import('../src/services/llm/LlmService.js')
            
            // 获取伪人模型或默认模型（注意：空字符串要视为未配置）
            const configBymModel = config.get('bym.model')
            const bymModel = (configBymModel && typeof configBymModel === 'string' && configBymModel.trim()) 
                ? configBymModel 
                : LlmService.selectModel({ isRoleplay: true })
            
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
                    if (!databaseService.initialized) {
                        await databaseService.init()
                    }
                    const scopeManager = getScopeManager(databaseService)
                    await scopeManager.init()
                    
                    const groupId = e.group_id ? String(e.group_id) : null
                    const userId = String(e.user_id || e.sender?.user_id)
                    const defaultBymPrompt = config.get('bym.systemPrompt') || 
                        '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。'
                    
                    const independentResult = await scopeManager.getIndependentPrompt(groupId, userId, defaultBymPrompt)
                    
                    if (independentResult.isIndependent) {
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
                systemPrompt = config.get('bym.systemPrompt') ||
                    '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。'
            }
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

            // 构建消息内容（支持图片）
            const messageContent = [{ type: 'text', text: messageText || '[图片消息]' }]
            
            // 如果启用图片处理且消息包含图片，添加图片到内容中
            if (processImage && hasImage) {
                const imageUrls = e.img || []
                // 也从 message 中提取图片
                if (e.message) {
                    for (const m of e.message) {
                        if (m.type === 'image') {
                            const url = m.url || m.file || m.data?.url
                            if (url && !imageUrls.includes(url)) {
                                imageUrls.push(url)
                            }
                        }
                    }
                }
                
                // 添加图片到消息内容
                for (const imgUrl of imageUrls.slice(0, 3)) { // 限制最多3张图片
                    messageContent.push({
                        type: 'image_url',
                        image_url: { url: imgUrl }
                    })
                }
                
                if (imageUrls.length > 0) {
                    logger.info(`[BYM] 处理图片消息: ${imageUrls.length} 张图片`)
                }
            }
            
            const userMessage = {
                role: 'user',
                content: messageContent,
            }
            if (e.sender) {
                systemPrompt += `\n当前对话者: ${e.sender.card || e.sender.nickname || '未知用户'}`
            }
            if (e.group_name) {
                systemPrompt += `\n当前群聊: ${e.group_name}`
            }

            const bymStartTime = Date.now()
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
            try {
                await usageStats.record({
                    channelId: 'bym',
                    channelName: '伪人模式',
                    model: bymModel,
                    inputTokens: usageStats.estimateTokens(messageText),
                    outputTokens: usageStats.estimateTokens(replyText),
                    duration: Date.now() - bymStartTime,
                    success: !!replyText,
                    source: 'bym',
                    userId: String(e.user_id),
                    groupId: e.group_id ? String(e.group_id) : null
                })
            } catch (err) { /* 统计失败不影响主流程 */ }

            if (replyText) {
                await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500))
                const autoRecall = config.get('basic.autoRecall')
                const recallDelay = autoRecall?.enabled === true ? (autoRecall.delay || 60) : 0
                await this.reply(replyText, false, { recallMsg: recallDelay })
            }

            return true
        } catch (error) {
            logger.error('[BYM] Error:', error)
            return false
        }
    }
}
