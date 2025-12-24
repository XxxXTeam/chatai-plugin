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
        
        // 检查是否启用（支持群组独立配置）
        const globalEnabled = config.get('bym.enable')
        let enabled = globalEnabled
        
        // 检查群组独立设置
        if (e.isGroup && e.group_id) {
            try {
                const groupId = String(e.group_id)
                if (!databaseService.initialized) {
                    await databaseService.init()
                }
                const scopeManager = getScopeManager(databaseService)
                await scopeManager.init()
                const groupSettings = await scopeManager.getGroupSettings(groupId)
                const groupFeatures = groupSettings?.settings || {}
                
                // 如果群组有独立设置，使用群组设置
                if (groupFeatures.bymEnabled !== undefined) {
                    enabled = groupFeatures.bymEnabled
                    logger.debug(`[BYM] 使用群组独立设置: ${enabled}`)
                }
            } catch (err) {
                logger.debug('[BYM] 获取群组设置失败:', err.message)
            }
        }
        
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
            let systemPrompt = ''
            let scopePresetId = null
            const inheritPersonality = config.get('bym.inheritPersonality') !== false // 默认启用继承
            
            // 1. 尝试获取群组完整配置（包含继承和知识库）
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
                    
                    // 使用新的群组有效配置方法（包含继承和群组知识库）
                    if (groupId) {
                        // 首先检查群组是否设置了伪人专用预设
                        const groupSettings = await scopeManager.getGroupSettings(groupId)
                        const bymPresetId = groupSettings?.settings?.bymPresetId
                        const bymPrompt = groupSettings?.settings?.bymPrompt
                        
                        if (bymPresetId && bymPresetId !== '__default__') {
                            if (bymPresetId === '__custom__' && bymPrompt) {
                                // 使用自定义伪人提示词
                                systemPrompt = bymPrompt
                                logger.info(`[BYM] 使用群组自定义伪人提示词`)
                            } else {
                                // 使用指定的预设
                                try {
                                    const { presetManager } = await import('../src/services/preset/PresetManager.js')
                                    await presetManager.init()
                                    const preset = presetManager.get(bymPresetId)
                                    if (preset?.systemPrompt) {
                                        systemPrompt = preset.systemPrompt
                                        scopePresetId = bymPresetId
                                        logger.info(`[BYM] 使用群组伪人预设: ${bymPresetId} (${preset.name || bymPresetId})`)
                                    }
                                } catch (err) {
                                    logger.warn(`[BYM] 加载伪人预设 ${bymPresetId} 失败:`, err.message)
                                }
                            }
                        }
                        
                        // 如果没有专用伪人预设，使用群组有效配置
                        if (!systemPrompt) {
                            const bymConfig = await scopeManager.getEffectiveBymConfig(groupId, userId, {
                                defaultPrompt: defaultBymPrompt,
                                includeKnowledge: true
                            })
                            
                            systemPrompt = bymConfig.systemPrompt || defaultBymPrompt
                            scopePresetId = bymConfig.presetId
                            
                            // 记录配置来源
                            if (bymConfig.sources.length > 0) {
                                logger.info(`[BYM] 配置来源: ${bymConfig.sources.join(' -> ')}`)
                            }
                        }
                        
                        // 添加群组知识库（无论使用哪种预设都添加）
                        const bymConfig = await scopeManager.getEffectiveBymConfig(groupId, userId, {
                            defaultPrompt: '',
                            includeKnowledge: true
                        })
                        if (bymConfig.knowledgePrompt) {
                            systemPrompt += '\n\n' + bymConfig.knowledgePrompt
                            logger.info(`[BYM] 已添加群组知识库 (${bymConfig.knowledgeIds.length} 个, ${bymConfig.knowledgePrompt.length} 字符)`)
                        }
                    } else {
                        // 私聊场景：使用原有逻辑
                        const effectiveSettings = await scopeManager.getEffectiveSettings(null, userId, { isPrivate: true })
                        
                        if (effectiveSettings?.presetId) {
                            scopePresetId = effectiveSettings.presetId
                            const { presetManager } = await import('../src/services/preset/PresetManager.js')
                            await presetManager.init()
                            const preset = presetManager.get(scopePresetId)
                            if (preset?.systemPrompt) {
                                systemPrompt = preset.systemPrompt
                                logger.info(`[BYM] 使用作用域预设: ${scopePresetId} (${preset.name || scopePresetId})`)
                            }
                        }
                        
                        if (!systemPrompt) {
                            const independentResult = await scopeManager.getIndependentPrompt(null, userId, defaultBymPrompt)
                            systemPrompt = independentResult.prompt
                            if (independentResult.isIndependent) {
                                logger.info(`[BYM] 使用独立人格 (来源: ${independentResult.source})`)
                            }
                        }
                    }
                    
                    // 添加伪人模式行为指导
                    systemPrompt += '\n\n【伪人模式行为指导】\n请用简短、自然、口语化的方式回复，就像真人聊天一样。回复要简洁（通常1-2句话），可以使用语气词和网络用语。'
                    
                    // 如果有预设且群组没有独立知识库，尝试加载预设知识库
                    if (scopePresetId && !systemPrompt.includes('【群组知识库】')) {
                        try {
                            const { knowledgeService } = await import('../src/services/storage/KnowledgeService.js')
                            await knowledgeService.init()
                            const knowledgePrompt = knowledgeService.buildKnowledgePrompt(scopePresetId, {
                                maxLength: config.get('knowledge.maxLength') || 8000,
                                includeTriples: config.get('knowledge.includeTriples') !== false
                            })
                            if (knowledgePrompt) {
                                systemPrompt += '\n\n' + knowledgePrompt
                                logger.info(`[BYM] 已添加预设知识库 (${knowledgePrompt.length} 字符)`)
                            }
                        } catch (err) {
                            logger.debug('[BYM] 加载预设知识库失败:', err.message)
                        }
                    }
                } catch (err) {
                    logger.debug('[BYM] 获取人格配置失败，使用默认:', err.message)
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
