import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LlmService } from './LlmService.js'
import { imageService } from '../media/ImageService.js'
import { contextManager } from './ContextManager.js'
import { channelManager } from './ChannelManager.js'
import historyManager from '../../core/utils/history.js'
import config from '../../../config/config.js'
import { setToolContext } from '../../core/utils/toolAdapter.js'
import { presetManager } from '../preset/PresetManager.js'
import { memoryManager } from '../storage/MemoryManager.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { databaseService } from '../storage/DatabaseService.js'
import { statsService } from '../stats/StatsService.js'
import { usageStats } from '../stats/UsageStats.js'

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
 * Chat Service - 统一的聊天消息处理服务
 * 
 * @description 提供 AI 对话功能，支持多模型、工具调用、上下文管理等
 * 
 * @example
 * ```js
 * const result = await chatService.sendMessage({
 *   userId: '123456',
 *   message: '你好',
 *   event: e
 * })
 * ```
 */
export class ChatService {
    /**
     * 发送聊天消息
     * 
     * @param {Object} options - 消息选项
     * @param {string} options.userId - 用户ID（必填）
     * @param {string} [options.message] - 消息文本
     * @param {Array<Object>} [options.images=[]] - 图片数组（支持URL或base64）
     * @param {string} [options.model] - 指定模型（可选，默认使用配置）
     * @param {boolean} [options.stream=false] - 是否使用流式响应
     * @param {Object} [options.preset] - 预设配置对象
     * @param {string} [options.presetId] - 预设ID
     * @param {string} [options.adapterType] - 适配器类型
     * @param {Object} [options.event] - Yunzai 事件对象（用于工具上下文）
     * @param {string} [options.mode='chat'] - 对话模式
     * @param {boolean} [options.debugMode=false] - 调试模式
     * @param {string} [options.prefixPersona] - 前缀人格（独立于普通人设）
     * @param {boolean} [options.disableTools=false] - 禁用工具调用
     * @returns {Promise<{response: Array, usage: Object, debugInfo?: Object}>} 响应结果
     * @throws {Error} 当 userId 未提供或模型未配置时抛出错误
     */
    async sendMessage(options) {
        try {
            return await this._sendMessageImpl(options)
        } catch (error) {
            const autoCleanConfig = config.get('features.autoCleanOnError')
            const autoCleanEnabled = autoCleanConfig?.enabled === true
            
            if (autoCleanEnabled) {
                try {
                    const fullUserId = String(options.userId)
                    const pureUserId = fullUserId.includes('_') ? fullUserId.split('_').pop() : fullUserId
                    const groupId = options.event?.group_id ? String(options.event.group_id) : null
                    const historyManager = (await import("../../core/utils/history.js")).default
                    const currentConversationId = contextManager.getConversationId(pureUserId, groupId)
                    const legacyConversationId = groupId ? `group:${groupId}:user:${pureUserId}` : `user:${pureUserId}`
                    await historyManager.deleteConversation(currentConversationId)
                    await contextManager.cleanContext(currentConversationId)
                    
                    // 删除旧格式（如果不同）
                    if (legacyConversationId !== currentConversationId) {
                        await historyManager.deleteConversation(legacyConversationId)
                        await contextManager.cleanContext(legacyConversationId)
                    }
                    
                    logger.debug(`[ChatService] 自动结清完成: pureUserId=${pureUserId}, groupId=${groupId}`)
                    
                    // 向用户回复结清提示（检查 notifyUser 配置）
                    if (autoCleanConfig?.notifyUser !== false && options.event && options.event.reply) {
                        try {
                            await options.event.reply(`历史对话已自动清理`, true)
                        } catch (replyErr) {
                            logger.error('[ChatService] 回复结清提示失败:', replyErr.message)
                        }
                    }
                } catch (clearErr) {
                    logger.error('[ChatService] 自动结清失败:', clearErr.message)
                }
            } else {
                logger.warn('[ChatService] 错误时自动结清功能已禁用，错误信息:', error.message)
            }
            throw error
        }
    }

    /**
     * Internal implementation of sendMessage
     */
    async _sendMessageImpl(options) {
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
            debugMode = false,  // 调试模式
            prefixPersona = null,  // 前缀人格（独立于普通人设）
            disableTools = false  // 禁用工具调用（用于防止递归）
        } = options

        // 调试信息收集
        const debugInfo = debugMode ? { 
            request: {}, 
            response: {}, 
            context: {},
            toolCalls: [],
            timing: { start: Date.now() },
            channel: {},
            memory: {},
            knowledge: {},
            preset: {},
            scope: {}
        } : null

        if (!userId) {
            throw new Error('userId is required')
        }

        // Initialize services
        await contextManager.init()
        await mcpManager.init()

        // Get group ID from event for proper isolation
        const groupId = event?.group_id || event?.data?.group_id || null
        
        // 提取纯userId（不带群号前缀）
        const pureUserId = (event?.user_id || event?.sender?.user_id || userId)?.toString()
        const cleanUserId = pureUserId?.includes('_') ? pureUserId.split('_').pop() : pureUserId
        let forceIsolation = false
        if (groupId) {
            const sm = await ensureScopeManager()
            const groupUserSettings = await sm.getGroupUserSettings(String(groupId), cleanUserId)
            const userSettings = await sm.getUserSettings(cleanUserId)
            // 如果用户在群内或全局设置了独立人格，强制使用独立会话
            if (groupUserSettings?.systemPrompt || userSettings?.systemPrompt) {
                forceIsolation = true
            }
        }
        let conversationId
        if (forceIsolation && groupId) {
            // 强制独立会话：使用群+用户的组合ID
            conversationId = `group:${groupId}:user:${cleanUserId}`
        } else {
            conversationId = contextManager.getConversationId(userId, groupId)
        }

        // Build message content
        const messageContent = []
        if (message) {
            messageContent.push({ type: 'text', text: message })
        }
        if (images.length > 0) {
            logger.debug(`[ChatService] 接收到图片: ${images.length} 张`)
        }
        for (const imageRef of images) {
            try {
                // 如果是 image_url 类型对象（来自 messageParser）
                if (imageRef && typeof imageRef === 'object') {
                    if (imageRef.type === 'image_url' && imageRef.image_url?.url) {
                        // 直接使用URL
                        messageContent.push({
                            type: 'image_url',
                            image_url: { url: imageRef.image_url.url }
                        })
                        continue
                    } else if (imageRef.type === 'url' && imageRef.url) {
                        // URL引用格式
                        messageContent.push({
                            type: 'image_url',
                            image_url: { url: imageRef.url }
                        })
                        continue
                    } else if (imageRef.type === 'video_info' && imageRef.url) {
                        // 视频信息 - 作为文本描述添加
                        // 某些API不支持视频，所以转为文本
                        const videoDesc = `[视频${imageRef.name ? ':' + imageRef.name : ''} URL:${imageRef.url}]`
                        // 将视频信息添加到文本内容中
                        const textIdx = messageContent.findIndex(c => c.type === 'text')
                        if (textIdx >= 0) {
                            messageContent[textIdx].text += '\n' + videoDesc
                        } else {
                            messageContent.push({ type: 'text', text: videoDesc })
                        }
                        continue
                    }
                }
                
                // 字符串格式处理
                if (typeof imageRef === 'string') {
                    // 如果是HTTP URL，直接使用
                    if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
                        messageContent.push({
                            type: 'image_url',
                            image_url: { url: imageRef }
                        })
                        continue
                    }
                    
                    // 如果是base64 data URL，直接使用
                    if (imageRef.startsWith('data:')) {
                        messageContent.push({
                            type: 'image_url',
                            image_url: { url: imageRef }
                        })
                        continue
                    }
                    
                    // 如果是图片ID，从服务获取
                    if (imageRef.length === 32 && !/[:/]/.test(imageRef)) {
                        const base64Image = await imageService.getImageBase64(imageRef, 'jpeg')
                        if (base64Image) {
                            messageContent.push({
                                type: 'image_url',
                                image_url: { url: base64Image }
                            })
                        }
                        continue
                    }
                }
                
                logger.warn('[ChatService] 无法处理的图片引用:', typeof imageRef, imageRef)
            } catch (error) {
                logger.error('[ChatService] Failed to process image:', error)
            }
        }
        const userMessage = {
            role: 'user',
            content: messageContent,
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
        let history = await contextManager.getContextHistory(conversationId, 20)
        let llmModel = model || LlmService.getModel(mode)
        if (groupId && !model) {
            try {
                const sm = await ensureScopeManager()
                const groupSettings = await sm.getGroupSettings(String(groupId))
                logger.debug(`[ChatService] 群组配置: groupId=${groupId}, settings=${JSON.stringify(groupSettings)}`)
                const groupModelId = groupSettings?.settings?.modelId
                if (groupModelId && groupModelId.trim()) {
                    llmModel = groupModelId
                    logger.debug(`[ChatService] 使用群组独立模型: ${llmModel}`)
                }
            } catch (e) {
                logger.debug('[ChatService] 获取群组模型配置失败:', e.message)
            }
        }
        if (!llmModel || typeof llmModel !== 'string') {
            throw new Error('未配置模型，请先在管理面板「设置 → 模型配置」中配置默认模型')
        }

        // Set tool context if event is provided
        if (event) {
            setToolContext({ event, bot: event.bot || Bot })
        }
        await channelManager.init()
        const channel = channelManager.getBestChannel(llmModel)
        logger.debug(`[ChatService] Channel: ${channel?.id}, hasAdvanced=${!!channel?.advanced}, streaming=${JSON.stringify(channel?.advanced?.streaming)}`)
        
        // 收集渠道调试信息
        if (debugInfo && channel) {
            debugInfo.channel = {
                id: channel.id,
                name: channel.name,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                enabled: channel.enabled,
                priority: channel.priority,
                models: channel.models?.slice(0, 10),
                modelsCount: channel.models?.length || 0,
                hasAdvanced: !!channel.advanced,
                streaming: channel.advanced?.streaming,
                llmConfig: channel.advanced?.llm,
                thinkingConfig: channel.advanced?.thinking,
                hasCustomHeaders: !!channel.customHeaders && Object.keys(channel.customHeaders).length > 0,
                hasTemplates: !!(channel.headersTemplate || channel.requestBodyTemplate)
            }
        }
        const effectivePresetId = presetId || preset?.id || config.get('llm.defaultChatPresetId') || 'default'
        const isNewSession = presetManager.isContextCleared(conversationId)

        // Channel advanced config
        const channelAdvanced = channel?.advanced || {}
        const channelLlm = channelAdvanced.llm || {}
        const channelThinking = channelAdvanced.thinking || {}
        const channelStreaming = channelAdvanced.streaming || {}
        const clientOptions = {
            enableTools: disableTools ? false : (preset?.tools?.enableBuiltinTools !== false),
            enableReasoning: preset?.enableReasoning ?? channelThinking.enableReasoning,
            reasoningEffort: channelThinking.defaultLevel || 'low',
            adapterType: adapterType,
            event,
            presetId: effectivePresetId,
            userPermission: event?.sender?.role || 'member'
        }

        if (channel) {
            clientOptions.adapterType = channel.adapterType
            clientOptions.baseUrl = channel.baseUrl
            const keyInfo = channelManager.getChannelKey(channel)
            clientOptions.apiKey = keyInfo.key
            clientOptions.keyIndex = keyInfo.keyIndex
            clientOptions.keyObj = keyInfo.keyObj
            clientOptions.channelName = channel.name
            // 传递渠道的自定义请求头
            if (channel.customHeaders && Object.keys(channel.customHeaders).length > 0) {
                clientOptions.customHeaders = channel.customHeaders
            }
            // 传递JSON模板配置
            if (channel.headersTemplate) {
                clientOptions.headersTemplate = channel.headersTemplate
            }
            if (channel.requestBodyTemplate) {
                clientOptions.requestBodyTemplate = channel.requestBodyTemplate
            }
            channelManager.startRequest(channel.id)
        }

        const client = await LlmService.createClient(clientOptions)
        await presetManager.init()
        
        const promptContext = {}
        if (event) {
            promptContext.user_name = event.sender?.card || event.sender?.nickname || '用户'
            promptContext.user_id = event.user_id?.toString() || userId
            promptContext.group_name = event.group_name || ''
            promptContext.group_id = event.group_id?.toString() || ''
            promptContext.bot_name = event.bot?.nickname || 'AI助手'
        }
        const defaultPrompt = preset?.systemPrompt || presetManager.buildSystemPrompt(effectivePresetId, promptContext)
        if (debugInfo) {
            debugInfo.preset = {
                id: effectivePresetId,
                name: preset?.name || effectivePresetId,
                hasSystemPrompt: !!preset?.systemPrompt,
                enableTools: preset?.tools?.enableBuiltinTools !== false,
                enableReasoning: preset?.enableReasoning,
                toolsConfig: preset?.tools ? {
                    enableBuiltinTools: preset.tools.enableBuiltinTools,
                    enableMcpTools: preset.tools.enableMcpTools,
                    allowedTools: preset.tools.allowedTools?.slice(0, 10),
                    blockedTools: preset.tools.blockedTools?.slice(0, 10)
                } : null,
                isNewSession,
                promptContext
            }
        }
        const globalSystemPrompt = config.get('context.globalSystemPrompt')
        const globalPromptMode = config.get('context.globalPromptMode') || 'append' // append | prepend | override
        let globalPromptText = ''
        if (globalSystemPrompt && typeof globalSystemPrompt === 'string' && globalSystemPrompt.trim()) {
            globalPromptText = globalSystemPrompt.trim()
            logger.debug(`[ChatService] 已加载全局系统提示词 (${globalPromptText.length} 字符, 模式: ${globalPromptMode})`)
        }
        const sm = await ensureScopeManager()
        let systemPrompt = defaultPrompt
        
        try {
            const scopeGroupId = event?.group_id?.toString() || null
            const scopeUserId = (event?.user_id || event?.sender?.user_id || userId)?.toString()
            const pureUserId = scopeUserId.includes('_') ? scopeUserId.split('_').pop() : scopeUserId
            const independentResult = await sm.getIndependentPrompt(scopeGroupId, pureUserId, defaultPrompt)
            systemPrompt = independentResult.prompt
            if (independentResult.isIndependent) {
                logger.debug(`[ChatService] 使用独立人设 (来源: ${independentResult.source})`)
            }
            // 收集 scope 调试信息
            if (debugInfo) {
                debugInfo.scope = {
                    groupId: scopeGroupId,
                    userId: pureUserId,
                    isIndependent: independentResult.isIndependent,
                    source: independentResult.source,
                    forceIsolation,
                    conversationId,
                    hasPrefixPersona: !!prefixPersona
                }
            }
        } catch (e) { 
            logger.warn(`[ChatService] 获取独立人设失败:`, e.message) 
        }
        if (prefixPersona) {
            systemPrompt = prefixPersona
            logger.debug(`[ChatService] 使用前缀人格覆盖`)
        }
        if (config.get('memory.enabled') && !isNewSession) {
            try {
                await memoryManager.init()
                const memoryContext = await memoryManager.getMemoryContext(userId, message || '', {
                    event,
                    groupId: groupId ? String(groupId) : null,
                    includeProfile: true 
                })
                if (memoryContext) {
                    systemPrompt += memoryContext
                    logger.debug(`[ChatService] 已添加记忆上下文到系统提示 (${memoryContext.length} 字符)`)
                    if (debugInfo) {
                        debugInfo.memory.userMemory = {
                            hasMemory: true,
                            length: memoryContext.length,
                            preview: memoryContext.substring(0, 500) + (memoryContext.length > 500 ? '...' : '')
                        }
                    }
                } else {
                    logger.debug(`[ChatService] 无用户记忆`)
                    if (debugInfo) {
                        debugInfo.memory.userMemory = { hasMemory: false }
                    }
                }
                // 群聊上下文（话题、关系等群级别信息）
                if (groupId && config.get('memory.groupContext.enabled')) {
                    const nickname = event?.sender?.card || event?.sender?.nickname
                    const groupMemory = await memoryManager.getGroupMemoryContext(String(groupId), cleanUserId, { nickname })
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
                            logger.debug(`[ChatService] 已添加群聊记忆上下文`)
                        }
                        if (debugInfo) {
                            debugInfo.memory.groupMemory = {
                                hasMemory: parts.length > 0,
                                userInfoCount: groupMemory.userInfo?.length || 0,
                                topicsCount: groupMemory.topics?.length || 0,
                                relationsCount: groupMemory.relations?.length || 0,
                                preview: parts.join('\n').substring(0, 300)
                            }
                        }
                    }
                }
            } catch (err) {
                logger.warn('[ChatService] 获取记忆上下文失败:', err.message)
            }
        }
        try {
            const { knowledgeService } = await import('../storage/KnowledgeService.js')
            await knowledgeService.init()
            const knowledgePrompt = knowledgeService.buildKnowledgePrompt(effectivePresetId, {
                maxLength: config.get('knowledge.maxLength') || 15000,
                includeTriples: config.get('knowledge.includeTriples') !== false
            })
            if (knowledgePrompt) {
                systemPrompt += '\n\n' + knowledgePrompt
                logger.debug(`[ChatService] 已添加知识库上下文 (${knowledgePrompt.length} 字符)`)
                // 收集知识库调试信息
                if (debugInfo) {
                    debugInfo.knowledge = {
                        hasKnowledge: true,
                        length: knowledgePrompt.length,
                        presetId: effectivePresetId,
                        preview: knowledgePrompt.substring(0, 500) + (knowledgePrompt.length > 500 ? '...' : '')
                    }
                }
            } else if (debugInfo) {
                debugInfo.knowledge = { hasKnowledge: false }
            }
        } catch (err) {
            logger.debug('[ChatService] 知识库服务未加载或无内容:', err.message)
        }
        if (globalPromptText) {
            if (globalPromptMode === 'prepend') {
                // 放到最前面
                systemPrompt = globalPromptText + '\n\n' + systemPrompt
                logger.debug(`[ChatService] 全局提示词已前置应用`)
            } else if (globalPromptMode === 'override') {
                // 覆盖模式 - 替换整个 systemPrompt
                systemPrompt = globalPromptText
                logger.debug(`[ChatService] 全局提示词已覆盖应用`)
            } else {
                // 默认 append - 追加到末尾
                systemPrompt += '\n\n' + globalPromptText
                logger.debug(`[ChatService] 全局提示词已追加应用`)
            }
        }
        let validHistory = history.filter(msg => {
            if (msg.role === 'assistant') {
                if (!msg.content || msg.content.length === 0) return false
                if (Array.isArray(msg.content) && msg.content.every(c => !c.text?.trim())) return false
                if (typeof msg.content === 'string' && !msg.content.trim()) return false
            }
            return true
        })
        const groupContextSharingEnabled = config.get('context.groupContextSharing') !== false
        const isolation = contextManager.getIsolationMode()
        if (groupId && !isolation.groupUserIsolation && groupContextSharingEnabled) {
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
            
            // 获取群信息
            const groupName = event?.group_name || event?.group?.name || ''
            
            // 在系统提示中说明多用户环境，并包含群基本信息
            systemPrompt += `\n\n[当前对话环境]
群号: ${groupId}${groupName ? `\n群名: ${groupName}` : ''}
当前发送消息的用户: ${currentUserLabel}(QQ:${currentUserUin})
你正在群聊中与多位用户对话。每条用户消息都以 [用户名(QQ号)]: 格式标注发送者。
消息中的 [提及用户 QQ:xxx ...] 表示被@的用户，包含其QQ号、群名片、昵称等信息。
请根据消息前的用户标签区分不同用户，回复时针对当前用户。`
        } else if (groupId && (!groupContextSharingEnabled || isolation.groupUserIsolation)) {
            // 群上下文传递关闭或用户隔离模式：只添加基本群信息，不传递群聊历史
            const groupName = event?.group_name || event?.group?.name || ''
            const currentUserLabel = event?.sender?.card || event?.sender?.nickname || `用户${userId}`
            const currentUserUin = event?.user_id || userId
            systemPrompt += `\n\n[当前对话环境]
群号: ${groupId}${groupName ? `\n群名: ${groupName}` : ''}
当前用户: ${currentUserLabel}(QQ:${currentUserUin})
消息中的 [提及用户 QQ:xxx ...] 表示被@的用户，包含其QQ号、群名片、昵称等信息。`
            
            if (!groupContextSharingEnabled) {
                logger.debug(`[ChatService] 群上下文传递已禁用，不携带群聊历史`)
            }
        }
        
        let messages = [
            { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
            ...validHistory,
            userMessage
        ]

        const hasTools = client.tools && client.tools.length > 0
        const useStreaming = stream || channelStreaming.enabled === true
        logger.debug(`[ChatService] Request: model=${llmModel}, stream=${useStreaming}, tools=${hasTools ? client.tools.length : 0}, channelStreaming=${JSON.stringify(channelStreaming)}`)
        let finalResponse = null
        let finalUsage = null
        let allToolLogs = []
        const requestStartTime = Date.now()
        try {
            if (event && event.reply) {
                client.setOnMessageWithToolCall(async (data) => {
                    if (data?.intermediateText && data.isIntermediate) {
                        let text = data.intermediateText.trim()
                        if (text) {
                            if (this.isPureToolCallJson(text)) {
                                return
                            }
                            await event.reply(text, true)
                        }
                    }
                    else if (data?.type === 'text' && data.text) {
                        await event.reply(data.text, true)
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
                stream: useStreaming,  // 传递流式选项
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
                    userMessageLength: message?.length || 0,
                    imagesCount: images.length,
                    useStreaming,
                    options: {
                        maxToken: requestOptions.maxToken,
                        temperature: requestOptions.temperature,
                        topP: requestOptions.topP
                    },
                    // 完整的请求体结构摘要
                    messagesStructure: messages.map((msg, idx) => ({
                        index: idx,
                        role: msg.role,
                        contentTypes: Array.isArray(msg.content) 
                            ? msg.content.map(c => c.type)
                            : ['text'],
                        contentLength: Array.isArray(msg.content)
                            ? msg.content.reduce((sum, c) => sum + (c.text?.length || 0), 0)
                            : (typeof msg.content === 'string' ? msg.content.length : 0),
                        hasSender: !!msg.sender,
                        hasToolCalls: !!msg.toolCalls?.length
                    })),
                    // 系统提示词完整内容
                    systemPromptFull: systemPrompt
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
            const concurrentCount = contextManager.recordRequest(conversationId)
            if (concurrentCount > 1) {
            }
            {
                const fallbackConfig = config.get('llm.fallback') || {}
                const fallbackEnabled = fallbackConfig.enabled !== false
                const fallbackModels = fallbackConfig.models || []
                const maxRetries = fallbackConfig.maxRetries || 3
                const retryDelay = fallbackConfig.retryDelay || 500
                const notifyOnFallback = fallbackConfig.notifyOnFallback
                const modelsToTry = [llmModel, ...fallbackModels.filter(m => m && m !== llmModel)]
                let response = null
                let lastError = null
                let usedModel = llmModel
                let fallbackUsed = false
                for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
                    const currentModel = modelsToTry[modelIndex]
                    const isMainModel = modelIndex === 0
                    let retryCount = 0
                    while (retryCount <= (isMainModel ? maxRetries : 1)) {
                        try {
                            const currentRequestOptions = { ...requestOptions, model: currentModel }
                            let currentClient = client
                            if (!isMainModel) {
                                const fallbackChannel = channelManager.getBestChannel(currentModel)
                                if (fallbackChannel) {
                                    const fallbackClientOptions = {
                                        ...clientOptions,
                                        adapterType: fallbackChannel.adapterType,
                                        baseUrl: fallbackChannel.baseUrl,
                                        apiKey: channelManager.getChannelKey(fallbackChannel).key
                                    }
                                    currentClient = await LlmService.createClient(fallbackClientOptions)
                                }
                            }
                            
                            response = await currentClient.sendMessage(userMessage, currentRequestOptions)
                            const hasToolCallLogs = response.toolCallLogs && response.toolCallLogs.length > 0
                            const hasContents = response.contents && response.contents.length > 0
                            const hasAnyContent = hasContents || hasToolCallLogs
                            
                            if (response && (hasAnyContent || response.id)) {
                                // 成功响应
                                usedModel = currentModel
                                if (!isMainModel) {
                                    fallbackUsed = true
                                    logger.debug(`[ChatService] 使用备选模型成功: ${currentModel}`)
                                    if (notifyOnFallback && event && event.reply) {
                                        try {
                                            await event.reply(`[已切换至备选模型: ${currentModel}]`, false)
                                        } catch (e) { }
                                    }
                                }
                                break
                            }
                            retryCount++
                            if (retryCount <= (isMainModel ? maxRetries : 1)) {
                                logger.warn(`[ChatService] 模型${currentModel}返回空响应，重试第${retryCount}次...`)
                                await new Promise(r => setTimeout(r, retryDelay * retryCount))
                            }
                        } catch (modelError) {
                            lastError = modelError
                            logger.error(`[ChatService] 模型${currentModel}请求失败: ${modelError.message}`)
                            
                            retryCount++
                            if (retryCount <= (isMainModel ? maxRetries : 1)) {
                                await new Promise(r => setTimeout(r, retryDelay * retryCount))
                            }
                        }
                    }
                    
                    // 如果成功获取响应，退出模型循环
                    if (response && (response.contents?.length > 0 || response.toolCallLogs?.length > 0)) {
                        break
                    }
                    if (!fallbackEnabled || modelIndex >= modelsToTry.length - 1) {
                        break
                    }
                    
                    logger.debug(`[ChatService] 尝试备选模型: ${modelsToTry[modelIndex + 1]}`)
                }
                
                // 如果所有模型都失败，抛出最后一个错误
                if (!response && lastError) {
                    throw lastError
                }
                
                if (!response) {
                    logger.warn('[ChatService] 所有模型尝试后仍无有效响应')
                }
                
                finalResponse = response?.contents || []
                finalUsage = response?.usage || {}
                allToolLogs = response?.toolCallLogs || []
                
                // 记录实际使用的模型
                if (debugInfo) {
                    debugInfo.usedModel = usedModel
                    debugInfo.fallbackUsed = fallbackUsed
                }
            }
            
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
            
            // 记录统计
            try {
                statsService.recordModelCall({
                    model: debugInfo?.usedModel || llmModel,
                    channelId: channel?.id,
                    userId,
                    inputTokens: finalUsage?.promptTokens || 0,
                    outputTokens: finalUsage?.completionTokens || 0,
                    success: !!finalResponse?.length
                })
                
                // 记录详细使用统计（使用插件计算 Token，不依赖 API 返回）
                const keyInfo = channel?.lastUsedKey || {}
                const requestDuration = Date.now() - requestStartTime
                // 使用插件计算 tokens
                const inputTokens = usageStats.estimateMessagesTokens(messages)
                const responseText = finalResponse?.filter(c => c.type === 'text').map(c => c.text).join('') || ''
                const outputTokens = usageStats.estimateTokens(responseText)
                await usageStats.record({
                    channelId: channel?.id || 'unknown',
                    channelName: channel?.name || 'Unknown',
                    model: debugInfo?.usedModel || llmModel,
                    keyIndex: keyInfo.keyIndex ?? -1,
                    keyName: keyInfo.keyName || '',
                    strategy: keyInfo.strategy || '',
                    inputTokens,
                    outputTokens,
                    totalTokens: inputTokens + outputTokens,
                    duration: requestDuration,
                    success: !!finalResponse?.length,
                    channelSwitched: debugInfo?.fallbackUsed || false,
                    previousChannelId: debugInfo?.fallbackFrom || null,
                    source: 'chat',
                    userId,
                    groupId: groupId || null,
                    stream: useStreaming,
                })
                
                // 记录工具调用
                if (allToolLogs?.length > 0) {
                    for (const log of allToolLogs) {
                        statsService.recordToolCall(log.name, !log.isError)
                    }
                }
            } catch (e) {
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

        // 检查定量自动结束对话
        let autoEndInfo = null
        try {
            const autoEndCheck = await contextManager.checkAutoEnd(conversationId)
            if (autoEndCheck.shouldEnd) {
                // 执行自动结束
                await contextManager.executeAutoEnd(conversationId)
                autoEndInfo = autoEndCheck
                
                // 通知用户（如果配置启用且有 event）
                if (autoEndCheck.notifyUser && event && event.reply) {
                    try {
                        await event.reply(autoEndCheck.notifyMessage, true)
                    } catch (e) {
                        logger.warn('[ChatService] 自动结束通知发送失败:', e.message)
                    }
                }
            }
        } catch (e) {
            logger.warn('[ChatService] 检查自动结束失败:', e.message)
        }

        return {
            conversationId,
            response: finalResponse || [],
            usage: finalUsage || {},
            model: llmModel,
            toolCallLogs: allToolLogs,
            debugInfo,  // 调试信息（仅在 debugMode 时有值）
            autoEndInfo // 自动结束信息（如果触发）
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
        const maxLength = voiceConfig.maxTextLength || 500
        const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + '...' : text
        
        try {
            if (provider === 'miao' && global.Bot?.app?.getService) {
                const Miao = global.Bot.app.getService('Miao')
                if (Miao && Miao.tts) {
                    await event.reply(await Miao.tts(truncatedText))
                    return
                }
            }
            logger.warn('[ChatService] No TTS provider available')
        } catch (err) {
            logger.error('[ChatService] TTS error:', err.message)
            throw err
        }
    }
    async *streamMessage(options) {
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
        presetManager.markContextCleared(conversationId)
        logger.debug(`[ChatService] 对话已清除: ${conversationId}`)
    }
    isPureToolCallJson(text) {
        if (!text || typeof text !== 'string') return false
        
        const trimmed = text.trim()
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                const parsed = JSON.parse(trimmed)
                const keys = Object.keys(parsed)
                if (keys.length === 1 && keys[0] === 'tool_calls' && Array.isArray(parsed.tool_calls)) {
                    return parsed.tool_calls.every(tc => 
                        tc && typeof tc === 'object' && 
                        (tc.function?.name || tc.name) 
                    )
                }
            } catch {
                return false
            }
        }
        const codeBlockMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
        if (codeBlockMatch) {
            const inner = codeBlockMatch[1].trim()
            if (inner.startsWith('{') && inner.endsWith('}')) {
                try {
                    const parsed = JSON.parse(inner)
                    const keys = Object.keys(parsed)
                    if (keys.length === 1 && keys[0] === 'tool_calls' && Array.isArray(parsed.tool_calls)) {
                        return parsed.tool_calls.every(tc => 
                            tc && typeof tc === 'object' && 
                            (tc.function?.name || tc.name)
                        )
                    }
                } catch {
                    return false
                }
            }
        }
        return false
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
