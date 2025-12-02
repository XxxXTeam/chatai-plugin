import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LlmService } from './LlmService.js'
import { imageService } from './ImageService.js'
import { contextManager } from './ContextManager.js'
import { channelManager } from './ChannelManager.js'
import historyManager from '../core/utils/history.js'
import config from '../../config/config.js'
import { setToolContext } from '../core/utils/toolAdapter.js'
import { presetManager } from './PresetManager.js'
import { memoryManager } from './MemoryManager.js'
import { mcpManager } from '../mcp/McpManager.js'
import { getScopeManager } from './ScopeManager.js'
import { databaseService } from './DatabaseService.js'

// 获取 scopeManager 实例
let scopeManager = null
const ensureScopeManager = async () => {
    if (!scopeManager) {
        if (!databaseService.initialized) {
            await databaseService.init()
        }
        scopeManager = getScopeManager(databaseService)
        await scopeManager.init()
    }
    return scopeManager
}

/**
 * Chat Service - Unified chat message handling
 */
export class ChatService {
    /**
     * Send a chat message with optional images
     */
    async sendMessage(options) {
        const {
            userId,
            message,
            images = [],
            model,
            stream = false,
            preset,
            presetId,
            adapterType,
            event, // Yunzai event for tool context
            mode = 'chat',
            debugMode = false  // 调试模式
        } = options

        // 调试信息收集
        const debugInfo = debugMode ? { 
            request: {}, 
            response: {}, 
            context: {},
            toolCalls: [],
            timing: { start: Date.now() }
        } : null

        if (!userId) {
            throw new Error('userId is required')
        }

        // Initialize services
        await contextManager.init()
        await mcpManager.init()

        // Get group ID from event for proper isolation
        const groupId = event?.group_id || event?.data?.group_id || null
        
        // Get conversation ID with proper isolation:
        // - Group chat: isolated by group (group:xxx)
        // - Private chat: isolated by user (user:xxx)
        const conversationId = contextManager.getConversationId(userId, groupId)

        // Build message content
        const messageContent = []
        if (message) {
            messageContent.push({ type: 'text', text: message })
        }

        // Process images
        for (const imageRef of images) {
            try {
                let base64Image
                // If it's an image ID
                if (imageRef.length === 32 && !/[:/]/.test(imageRef)) {
                    base64Image = await imageService.getImageBase64(imageRef, 'jpeg')
                }
                // If it's a URL
                else if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
                    base64Image = await imageService.urlToBase64(imageRef)
                }
                // If it's already base64
                else if (imageRef.startsWith('data:')) {
                    base64Image = imageRef
                }

                if (base64Image) {
                    messageContent.push({
                        type: 'image_url',
                        image_url: { url: base64Image }
                    })
                }
            } catch (error) {
                logger.error('[ChatService] Failed to process image:', error)
            }
        }

        // Create user message - 包含发送者信息用于多用户上下文区分
        const userMessage = {
            role: 'user',
            content: messageContent,
            // 添加发送者信息 (icqq/TRSS 兼容)
            sender: event?.sender ? {
                user_id: event.user_id || event.sender.user_id,
                nickname: event.sender.nickname || '用户',
                card: event.sender.card || '',
                role: event.sender.role || 'member'
            } : { user_id: userId, nickname: '用户', card: '', role: 'member' },
            timestamp: Date.now(),
            source_type: groupId ? 'group' : 'private',
            ...(groupId && { group_id: groupId })
        }

        // Get context and history - 限制最多20条
        let history = await contextManager.getContextHistory(conversationId, 20)
        
        // Determine model
        const llmModel = model || LlmService.getModel(mode)

        // Set tool context if event is provided
        if (event) {
            setToolContext({ event, bot: event.bot || Bot })
        }

        // Get best channel
        const channel = channelManager.getBestChannel(llmModel)

        // Get preset ID
        const effectivePresetId = presetId || preset?.id || config.get('llm.defaultChatPresetId') || 'default'

        // Channel advanced config
        const channelAdvanced = channel?.advanced || {}
        const channelLlm = channelAdvanced.llm || {}
        const channelThinking = channelAdvanced.thinking || {}
        const channelStreaming = channelAdvanced.streaming || {}

        // Create LLM client options
        const clientOptions = {
            enableTools: true,
            enableReasoning: preset?.enableReasoning ?? channelThinking.enableReasoning,
            reasoningEffort: channelThinking.defaultLevel || 'low',
            adapterType: adapterType,
            event,
            presetId: effectivePresetId
        }

        if (channel) {
            clientOptions.adapterType = channel.adapterType
            clientOptions.baseUrl = channel.baseUrl
            clientOptions.apiKey = channelManager.getChannelKey(channel)
            channelManager.startRequest(channel.id)
        }

        const client = await LlmService.createClient(clientOptions)

        // --- 1. System Prompt Construction (Including Scope Settings) ---
        await presetManager.init()
        
        const promptContext = {}
        if (event) {
            promptContext.user_name = event.sender?.card || event.sender?.nickname || '用户'
            promptContext.user_id = event.user_id?.toString() || userId
            promptContext.group_name = event.group_name || ''
            promptContext.group_id = event.group_id?.toString() || ''
            promptContext.bot_name = event.bot?.nickname || 'AI助手'
        }
        
        // 获取默认预设的Prompt
        const defaultPrompt = preset?.systemPrompt || presetManager.buildSystemPrompt(effectivePresetId, promptContext)
        
        // 1.1 Scope-based Prompts (独立人设逻辑)
        // 如果用户/群组设置了独立人设，则直接使用，不拼接默认人设
        const sm = await ensureScopeManager()
        let systemPrompt = defaultPrompt
        
        try {
            const scopeGroupId = event?.group_id?.toString() || null
            // 从 event 获取原始 userId，而不是使用组合的 fullUserId
            // 因为数据库中存储的是纯 userId，不带群号前缀
            const scopeUserId = (event?.user_id || event?.sender?.user_id || userId)?.toString()
            // 如果 userId 包含下划线（fullUserId 格式），提取纯 userId
            const pureUserId = scopeUserId.includes('_') ? scopeUserId.split('_').pop() : scopeUserId
            
            logger.info(`[ChatService] 查询独立人设: groupId=${scopeGroupId}, userId=${pureUserId} (原始: ${userId})`)
            
            const independentResult = await sm.getIndependentPrompt(scopeGroupId, pureUserId, defaultPrompt)
            
            // 使用独立人设或默认人设
            systemPrompt = independentResult.prompt
            
            if (independentResult.isIndependent) {
                logger.info(`[ChatService] 使用独立人设 (来源: ${independentResult.source}, 优先级: ${independentResult.priorityOrder?.join(' > ') || 'default'})`)
                logger.info(`[ChatService] 独立人设内容前100字: ${systemPrompt.substring(0, 100)}...`)
            } else {
                logger.info(`[ChatService] 未找到独立人设，使用默认人设`)
            }
        } catch (e) { 
            logger.warn(`[ChatService] 获取独立人设失败:`, e.message) 
        }

        // 1.2 Memory Context
        if (config.get('memory.enabled')) {
            try {
                await memoryManager.init()
                // 获取用户个人记忆
                const memoryContext = await memoryManager.getMemoryContext(userId, message || '')
                if (memoryContext) {
                    systemPrompt += memoryContext
                }
                
                // 获取群聊记忆上下文
                if (groupId && config.get('memory.groupContext.enabled')) {
                    const groupMemory = await memoryManager.getGroupMemoryContext(String(groupId), userId)
                    if (groupMemory) {
                        const parts = []
                        if (groupMemory.userInfo?.length > 0) {
                            parts.push(`群成员信息：${groupMemory.userInfo.join('；')}`)
                        }
                        if (groupMemory.topics?.length > 0) {
                            parts.push(`最近话题：${groupMemory.topics.join('；')}`)
                        }
                        if (groupMemory.relations?.length > 0) {
                            parts.push(`群友关系：${groupMemory.relations.join('；')}`)
                        }
                        if (parts.length > 0) {
                            systemPrompt += `\n【群聊记忆】\n${parts.join('\n')}\n`
                        }
                    }
                }
            } catch (err) {
                logger.warn('[ChatService] 获取记忆上下文失败:', err.message)
            }
        }

        // Construct Messages
        // Filter invalid assistant messages
        let validHistory = history.filter(msg => {
            if (msg.role === 'assistant') {
                if (!msg.content || msg.content.length === 0) return false
                if (Array.isArray(msg.content) && msg.content.every(c => !c.text?.trim())) return false
                if (typeof msg.content === 'string' && !msg.content.trim()) return false
            }
            return true
        })
        
        // 群聊共享模式下，添加用户标签以区分不同用户
        const isolation = contextManager.getIsolationMode()
        if (groupId && !isolation.groupUserIsolation) {
            // 群聊共享模式 - 添加用户标签到历史消息
            validHistory = contextManager.buildLabeledContext(validHistory)
            
            // 当前用户信息
            const currentUserLabel = event?.sender?.card || event?.sender?.nickname || `用户${userId}`
            const currentUserUin = event?.user_id || userId
            
            // 给当前消息也添加用户标签
            userMessage.content = contextManager.addUserLabelToContent(
                userMessage.content, 
                currentUserLabel, 
                currentUserUin
            )
            
            // 在系统提示中说明多用户环境
            systemPrompt += `\n\n[多用户群聊环境]\n你正在群聊中与多位用户对话。每条用户消息都以 [用户名(QQ号)]: 格式标注发送者。\n当前发送消息的用户: [${currentUserLabel}(${currentUserUin})]\n请根据消息前的用户标签区分不同用户，回复时针对当前用户。`
        }
        
        let messages = [
            { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
            ...validHistory,
            userMessage
        ]

        const hasTools = client.tools && client.tools.length > 0
        const useStreaming = (stream || channelStreaming.enabled === true) && !hasTools // Force non-stream if tools are present for easier loop? No, we can handle stream->tool->loop.
        // Actually, robust tool handling is easier with non-stream loop, or carefully managed stream loop.
        // Strategy: If tools enabled, try stream. If stream returns tool_calls, break and enter multi-turn loop.

        logger.info(`[ChatService] Request: model=${llmModel}, stream=${useStreaming}, tools=${hasTools ? client.tools.length : 0}`)

        let finalResponse = null
        let finalUsage = null
        let allToolLogs = []
        
        try {
            // 设置工具调用中间消息回调（用于发送工具调用过程中的消息）
            if (event && event.reply) {
                client.setOnMessageWithToolCall(async (content, toolCalls) => {
                    if (content && content.type === 'text' && content.text) {
                        await event.reply(content.text, true)
                    }
                })
            }
            
            const requestOptions = {
                model: llmModel,
                maxToken: channelLlm.maxTokens || 4000,
                temperature: channelLlm.temperature ?? 0.7,
                topP: channelLlm.topP,
                conversationId,
                systemOverride: systemPrompt,
            }

            // 收集调试信息
            if (debugInfo) {
                debugInfo.request = {
                    model: llmModel,
                    conversationId,
                    messagesCount: messages.length,
                    historyCount: validHistory.length,
                    toolsCount: hasTools ? client.tools.length : 0,
                    systemPromptLength: systemPrompt.length,
                    options: {
                        maxToken: requestOptions.maxToken,
                        temperature: requestOptions.temperature,
                        topP: requestOptions.topP
                    }
                }
                // 上下文历史摘要
                debugInfo.context = {
                    historyMessages: validHistory.slice(-5).map(msg => ({
                        role: msg.role,
                        contentPreview: Array.isArray(msg.content) 
                            ? msg.content.filter(c => c.type === 'text').map(c => c.text?.substring(0, 100)).join('').substring(0, 150)
                            : (typeof msg.content === 'string' ? msg.content.substring(0, 150) : ''),
                        hasToolCalls: !!msg.toolCalls?.length,
                        // 添加发送者信息
                        sender: msg.sender ? {
                            user_id: msg.sender.user_id,
                            nickname: msg.sender.nickname || msg.sender.card
                        } : null
                    })),
                    systemPromptPreview: systemPrompt.substring(0, 300) + (systemPrompt.length > 300 ? '...' : ''),
                    totalHistoryLength: validHistory.length,
                    // 隔离模式信息
                    isolationMode: isolation,
                    hasUserLabels: groupId && !isolation.groupUserIsolation,
                    maxContextMessages: 20
                }
                // 工具列表
                debugInfo.availableTools = hasTools ? client.tools.map(t => t.function?.name || t.name).slice(0, 20) : []
            }

            // --- 2. 统一使用 Client 发送消息，工具调用由 AbstractClient 内部处理 ---
            const response = await client.sendMessage(userMessage, requestOptions)
            
            finalResponse = response.contents
            finalUsage = response.usage
            allToolLogs = response.toolCallLogs || []
            
            // 收集响应调试信息
            if (debugInfo) {
                debugInfo.timing.end = Date.now()
                debugInfo.timing.duration = debugInfo.timing.end - debugInfo.timing.start
                
                debugInfo.response = {
                    contentsCount: finalResponse?.length || 0,
                    toolCallLogsCount: allToolLogs.length,
                    hasText: finalResponse?.some(c => c.type === 'text'),
                    hasReasoning: finalResponse?.some(c => c.type === 'reasoning'),
                    durationMs: debugInfo.timing.duration
                }
                
                // 工具调用详情
                debugInfo.toolCalls = allToolLogs.map((log, idx) => ({
                    index: idx + 1,
                    name: log.name,
                    args: log.args,
                    resultPreview: typeof log.result === 'string' 
                        ? log.result.substring(0, 300) + (log.result.length > 300 ? '...' : '')
                        : JSON.stringify(log.result).substring(0, 300),
                    duration: log.duration,
                    success: !log.isError
                }))
            }
            
        } finally {
            if (channel) {
                channelManager.endRequest(channel.id)
                if (finalUsage) channelManager.reportUsage(channel.id, finalUsage?.totalTokens || 0)
            }
        }

        // Update Context
        if (finalResponse) {
            const textContent = finalResponse.filter(c => c.type === 'text').map(c => c.text).join('\n')
            if (textContent.length > 50) {
                await contextManager.updateContext(conversationId, {
                    lastInteraction: Date.now(),
                    recentTopics: [message.substring(0, 100)]
                })
            }
            // Auto Memory
            if (config.get('memory.enabled') && config.get('memory.autoExtract') !== false) {
                memoryManager.extractMemoryFromConversation(userId, message, textContent)
                    .catch(err => logger.warn('[ChatService] Automatic memory extraction failed:', err.message))
            }
            
            // Voice Reply Logic - 工具调用后语音回复
            const voiceConfig = config.get('features.voiceReply')
            if (voiceConfig?.enabled && event && event.reply) {
                const shouldVoice = voiceConfig.triggerAlways || 
                    (voiceConfig.triggerOnTool && allToolLogs.length > 0)
                
                if (shouldVoice && textContent) {
                    try {
                        await this.sendVoiceReply(event, textContent, voiceConfig)
                    } catch (e) {
                        logger.warn('[ChatService] Voice reply failed:', e.message)
                    }
                }
            }
        }

        return {
            conversationId,
            response: finalResponse || [],
            usage: finalUsage || {},
            model: llmModel,
            toolCallLogs: allToolLogs,
            debugInfo  // 调试信息（仅在 debugMode 时有值）
        }
    }

    /**
     * 发送语音回复
     * @param {Object} event - Yunzai事件
     * @param {string} text - 要转语音的文本
     * @param {Object} voiceConfig - 语音配置
     */
    async sendVoiceReply(event, text, voiceConfig) {
        const provider = voiceConfig.ttsProvider || 'system'
        
        // 截取文本长度
        const maxLength = voiceConfig.maxTextLength || 500
        const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text
        
        try {
            // 尝试使用 Miao-Yunzai 的 TTS
            if (provider === 'miao' && global.Bot?.app?.getService) {
                const Miao = global.Bot.app.getService('Miao')
                if (Miao && Miao.tts) {
                    await event.reply(await Miao.tts(truncatedText))
                    return
                }
            }
            
            // TODO: 支持其他 TTS 提供者 (vits, edge-tts, openai)
            // 需要在 Phase 4 实现 TTSService
            
            logger.warn('[ChatService] No TTS provider available')
        } catch (err) {
            logger.error('[ChatService] TTS error:', err.message)
            throw err
        }
    }

    /**
     * Stream chat message - 流式输出（简化版）
     */
    async *streamMessage(options) {
        // 简化实现：将流式输出委托给 LlmService
        // 工具调用在流式模式下更复杂，建议使用 sendMessage
        const response = await this.sendMessage(options)
        yield* response.response
    }

    async getHistory(userId, limit = 20, groupId = null) {
        await contextManager.init()
        const conversationId = contextManager.getConversationId(userId, groupId)
        return await historyManager.getHistory(conversationId, limit)
    }

    async clearHistory(userId, groupId = null) {
        await contextManager.init()
        const conversationId = contextManager.getConversationId(userId, groupId)
        await historyManager.deleteConversation(conversationId)
        await contextManager.cleanContext(conversationId)
    }
    
    async exportHistory(userId, format = 'json', groupId = null) {
       // ... [Original exportHistory code] ...
       const history = await this.getHistory(userId, 1000, groupId)
        if (format === 'json') {
            return JSON.stringify(history, null, 2)
        } else {
            return history.map(msg => {
                const role = msg.role === 'user' ? '👤 用户' : '🤖 助手'
                const content = Array.isArray(msg.content)
                    ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                    : msg.content
                return `${role}:\n${content}\n`
            }).join('\n---\n\n')
        }
    }
}

export const chatService = new ChatService()
