import config from '../config/config.js'
import { cleanCQCode } from '../src/utils/messageParser.js'
import {
    isMessageProcessed,
    markMessageProcessed,
    isSelfMessage,
    isReplyToBotMessage
} from '../src/utils/messageDedup.js'
import { getScopeManager } from '../src/services/scope/ScopeManager.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { statsService } from '../src/services/stats/StatsService.js'
import { emojiThiefService } from './EmojiThief.js'

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
            event: 'message.group', // 仅群聊消息，避免私聊和其他事件触发
            priority: 6000,
            rule: [
                {
                    reg: '', // 匹配所有群聊消息，由内部逻辑判断
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
        if (isSelfMessage(e)) {
            return false
        }
        if (
            e.post_type === 'notice' ||
            e.notice_type ||
            e.sub_type === 'reaction' ||
            e.sub_type === 'emoji_like' ||
            e.sub_type === 'msg_emoji_like'
        ) {
            return false
        }
        if (!e.msg && (!e.message || e.message.length === 0)) {
            return false
        }
        if (isMessageProcessed(e)) {
            return false
        }
        const globalEnabled = config.get('bym.enable')
        let enabled = globalEnabled
        let groupBymConfig = null

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

                // 保存群组配置供后续使用
                groupBymConfig = groupFeatures

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
        const triggerCfg = config.get('trigger') || {}
        const blacklistUsers = triggerCfg.blacklistUsers || []
        const whitelistUsers = triggerCfg.whitelistUsers || []
        const blacklistGroups = triggerCfg.blacklistGroups || []
        const whitelistGroups = triggerCfg.whitelistGroups || []

        const userId = String(e.user_id || e.sender?.user_id || '')
        const groupId = e.group_id ? String(e.group_id) : ''
        if (blacklistUsers.length > 0 && blacklistUsers.map(String).includes(userId)) {
            logger.debug(`[BYM] 用户在黑名单中: ${userId}`)
            return false
        }
        // 检查用户白名单（如果配置了白名单，则只允许白名单用户）
        if (whitelistUsers.length > 0 && !whitelistUsers.map(String).includes(userId)) {
            logger.debug(`[BYM] 用户不在白名单中: ${userId}`)
            return false
        }
        // 检查群组黑名单
        if (groupId && blacklistGroups.length > 0 && blacklistGroups.map(String).includes(groupId)) {
            logger.debug(`[BYM] 群组在黑名单中: ${groupId}`)
            return false
        }
        // 检查群组白名单（如果配置了白名单，则只允许白名单群组）
        if (groupId && whitelistGroups.length > 0 && !whitelistGroups.map(String).includes(groupId)) {
            logger.debug(`[BYM] 群组不在白名单中: ${groupId}`)
            return false
        }

        if (e.atBot) {
            return false
        }
        const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
        const triggerPrefixes = triggerCfg.prefixes || []
        const allPrefixes = [cmdPrefix, '#', ...triggerPrefixes].filter(Boolean)
        const rawMsg = (e.msg || '').trim()
        if (allPrefixes.some(p => rawMsg.startsWith(p))) {
            return false
        }
        const processImage = config.get('bym.processImage') !== false // 默认处理图片
        const hasImage = (e.img && e.img.length > 0) || (e.message && e.message.some(m => m.type === 'image'))
        if (!processImage && hasImage) {
            logger.debug('[BYM] 跳过: 消息包含图片且未启用图片处理')
            return false
        }
        e.toICQQ = true
        // 继承群组的关键词配置（不使用独立的bym.nicknames）
        const globalKeywords = triggerCfg.keywords || []
        const allKeywords = [...new Set(globalKeywords)].filter(n => n && n.trim())

        let forceTriggered = false
        let matchedKeyword = ''
        if (allKeywords.length > 0 && rawMsg) {
            for (const keyword of allKeywords) {
                // 支持关键词在消息任意位置（如 "xx小喵xx" 匹配 "小喵"）
                if (rawMsg.includes(keyword)) {
                    forceTriggered = true
                    matchedKeyword = keyword
                    logger.info(`[BYM] 关键词触发: 匹配到 "${keyword}" 在消息 "${rawMsg.substring(0, 30)}..."`)
                    break
                }
            }
        }
        if (!forceTriggered) {
            let probabilityRaw =
                groupBymConfig?.bymProbability !== undefined
                    ? groupBymConfig.bymProbability
                    : config.get('bym.probability')
            let probability = probabilityRaw
            logger.debug(
                `[BYM] probability原始值: ${probabilityRaw}, 类型: ${typeof probabilityRaw}, 来源: ${groupBymConfig?.bymProbability !== undefined ? '群组配置' : '全局配置'}`
            )

            if (probability === undefined || probability === null || isNaN(Number(probability))) {
                probability = 0.02
            } else {
                probability = Number(probability)
                if (probability > 1) {
                    probability = probability / 100
                    logger.debug(`[BYM] 检测到百分比格式，已转换: ${probabilityRaw} -> ${probability}`)
                }
            }
            probability = Math.max(0, Math.min(1, probability))
            if (probability === 0) {
                logger.debug('[BYM] 概率为0，不触发')
                return false
            }

            const randomValue = Math.random()
            logger.debug(`[BYM] 触发判定: random=${randomValue.toFixed(4)}, probability=${probability}`)

            if (randomValue > probability) {
                return false
            }
            logger.info(`[BYM] 概率触发成功: random=${randomValue.toFixed(4)} <= probability=${probability}`)
        } else {
            logger.info(`[BYM] 关键词触发: "${matchedKeyword}"`)
        }

        try {
            markMessageProcessed(e)
            logger.info('[BYM] 伪人模式触发')
            const { LlmService } = await import('../src/services/llm/LlmService.js')
            const groupBymModel = groupBymConfig?.bymModel
            const configBymModel = config.get('bym.model')
            const bymModel =
                groupBymModel && typeof groupBymModel === 'string' && groupBymModel.trim()
                    ? groupBymModel
                    : configBymModel && typeof configBymModel === 'string' && configBymModel.trim()
                      ? configBymModel
                      : LlmService.getModel()

            if (groupBymModel && groupBymModel.trim()) {
                logger.debug(`[BYM] 使用群组独立模型: ${bymModel}`)
            }
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
            const inheritPersonality = config.get('bym.inheritPersonality') !== false
            if (inheritPersonality) {
                try {
                    if (!databaseService.initialized) {
                        await databaseService.init()
                    }
                    const scopeManager = getScopeManager(databaseService)
                    await scopeManager.init()

                    const groupId = e.group_id ? String(e.group_id) : null
                    const userId = String(e.user_id || e.sender?.user_id)
                    const defaultBymPrompt =
                        config.get('bym.systemPrompt') ||
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
                                        logger.info(
                                            `[BYM] 使用群组伪人预设: ${bymPresetId} (${preset.name || bymPresetId})`
                                        )
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
                            logger.info(
                                `[BYM] 已添加群组知识库 (${bymConfig.knowledgeIds.length} 个, ${bymConfig.knowledgePrompt.length} 字符)`
                            )
                        }
                    } else {
                        // 私聊场景：使用原有逻辑
                        const effectiveSettings = await scopeManager.getEffectiveSettings(null, userId, {
                            isPrivate: true
                        })

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
                            const independentResult = await scopeManager.getIndependentPrompt(
                                null,
                                userId,
                                defaultBymPrompt
                            )
                            systemPrompt = independentResult.prompt
                            if (independentResult.isIndependent) {
                                logger.info(`[BYM] 使用独立人格 (来源: ${independentResult.source})`)
                            }
                        }
                    }

                    // 添加伪人模式行为指导
                    systemPrompt +=
                        '\n\n【伪人模式行为指导】\n请用简短、自然、口语化的方式回复，就像真人聊天一样。回复要简洁（通常1-2句话），可以使用语气词和网络用语。'

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
                    systemPrompt =
                        config.get('bym.systemPrompt') ||
                        '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。'
                }
            } else {
                // 检查全局伪人预设配置
                const globalBymPresetId = config.get('bym.presetId')
                if (globalBymPresetId) {
                    try {
                        const { presetManager } = await import('../src/services/preset/PresetManager.js')
                        await presetManager.init()
                        const preset = presetManager.get(globalBymPresetId)
                        if (preset?.systemPrompt) {
                            systemPrompt = preset.systemPrompt
                            logger.info(
                                `[BYM] 使用全局伪人预设: ${globalBymPresetId} (${preset.name || globalBymPresetId})`
                            )
                        }
                    } catch (err) {
                        logger.warn(`[BYM] 加载全局伪人预设 ${globalBymPresetId} 失败:`, err.message)
                    }
                }
                // 如果没有预设或预设加载失败，使用系统提示词
                if (!systemPrompt) {
                    systemPrompt =
                        config.get('bym.systemPrompt') ||
                        '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。'
                }
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

            // 提取图片URL（移到外部以便后续使用）
            let imageUrls = []
            if (processImage && hasImage) {
                imageUrls = [...(e.img || [])]
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

                if (imageUrls.length > 0) {
                    logger.info(`[BYM] 处理图片消息: ${imageUrls.length} 张图片`)
                }
            }

            // 构建消息内容（支持图片）- 仅用于日志
            const messageContent = [{ type: 'text', text: messageText || '[图片消息]' }]

            const userMessage = {
                role: 'user',
                content: messageContent
            }
            if (e.sender) {
                systemPrompt += `\n当前对话者: ${e.sender.card || e.sender.nickname || '未知用户'}`
            }
            if (e.group_name) {
                systemPrompt += `\n当前群聊: ${e.group_name}`
            }

            // 获取温度和maxTokens：优先群组配置 > 全局配置
            const bymTemperature =
                groupBymConfig?.bymTemperature !== undefined
                    ? groupBymConfig.bymTemperature
                    : config.get('bym.temperature') || 0.9
            const bymMaxTokens =
                groupBymConfig?.bymMaxTokens !== undefined
                    ? groupBymConfig.bymMaxTokens
                    : config.get('bym.maxTokens') || 100

            if (groupBymConfig?.bymTemperature !== undefined || groupBymConfig?.bymMaxTokens !== undefined) {
                logger.debug(`[BYM] 使用群组独立参数: temperature=${bymTemperature}, maxTokens=${bymMaxTokens}`)
            }

            const bymStartTime = Date.now()
            const groupId = e.group_id ? String(e.group_id) : null
            const userId = String(e.user_id || e.sender?.user_id)
            const fullUserId = groupId ? `bym_group_${groupId}` : userId
            if (groupId) {
                try {
                    const { memoryManager } = await import('../src/services/storage/MemoryManager.js')
                    await memoryManager.init()
                    const recentMessages = memoryManager.getGroupMessageBuffer(groupId) || []

                    if (recentMessages.length > 0) {
                        const contextMessages = recentMessages.slice(-15)
                        const contextText = contextMessages
                            .map(m => {
                                const name = m.nickname || m.userId || '用户'
                                const content =
                                    typeof m.content === 'string'
                                        ? m.content
                                        : Array.isArray(m.content)
                                          ? m.content
                                                .filter(c => c.type === 'text')
                                                .map(c => c.text)
                                                .join('')
                                          : ''
                                return `[${name}]: ${content}`
                            })
                            .join('\n')

                        if (contextText.trim()) {
                            systemPrompt += `\n\n【最近群聊记录】\n${contextText}\n\n请基于以上聊天记录的话题和氛围，自然地参与对话。`
                            logger.info(`[BYM] 已添加群聊上下文: ${contextMessages.length} 条消息`)
                        }
                    }
                } catch (err) {
                    logger.debug('[BYM] 获取群聊上下文失败:', err.message)
                }
            }

            // 使用 chatService.sendMessage 来正确处理上下文
            const { chatService } = await import('../src/services/llm/ChatService.js')

            const chatResult = await chatService.sendMessage({
                userId: fullUserId,
                groupId: groupId,
                message: messageText,
                images:
                    processImage && imageUrls.length > 0
                        ? imageUrls.slice(0, 3).map(url => ({ type: 'image_url', image_url: { url } }))
                        : [],
                mode: 'bym', // 标记为伪人模式
                model: bymModel,
                prefixPersona: systemPrompt, // 使用伪人系统提示
                event: e,
                disableTools: true, // 伪人模式不使用工具（ChatService参数名）
                temperature: bymTemperature,
                maxTokens: bymMaxTokens
            })

            const response = {
                contents: chatResult.response || [],
                usage: chatResult.usage
            }

            const replyText = response.contents
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n')
            // 记录统计（使用 statsService.recordApiCall 确保正确记录）
            try {
                await statsService.recordApiCall({
                    channelId: 'bym',
                    channelName: '伪人模式',
                    model: bymModel,
                    duration: Date.now() - bymStartTime,
                    success: !!replyText,
                    source: 'bym',
                    userId: String(e.user_id),
                    groupId: e.group_id ? String(e.group_id) : null,
                    messages: [{ role: 'user', content: messageText }],
                    responseText: replyText,
                    apiUsage: response.usage || null,
                    request: {
                        model: bymModel,
                        temperature: bymTemperature,
                        maxToken: bymMaxTokens,
                        systemPrompt: systemPrompt?.substring(0, 200) + '...'
                    }
                })
            } catch (err) {
                logger.debug('[BYM] 统计记录失败:', err.message)
            }

            if (replyText) {
                await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 500))
                const autoRecall = config.get('basic.autoRecall')
                const recallDelay = autoRecall?.enabled === true ? autoRecall.delay || 60 : 0
                await this.reply(replyText, false, { recallMsg: recallDelay })

                // 表情包小偷 - 伪人触发模式
                try {
                    const emojiMsg = await emojiThiefService.tryTrigger(e, 'bym')
                    if (emojiMsg) {
                        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 300))
                        await this.reply(emojiMsg)
                    }
                } catch (err) {
                    logger.debug('[BYM] 表情包触发失败:', err.message)
                }
            }

            return true
        } catch (error) {
            logger.error('[BYM] Error:', error)
            return false
        }
    }
}
