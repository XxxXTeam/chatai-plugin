import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LlmService } from './LlmService.js'
import { imageService } from '../media/ImageService.js'
import { contextManager } from './ContextManager.js'
import { channelManager } from './ChannelManager.js'
import historyManager from '../../core/utils/history.js'
import config from '../../../config/config.js'
import { setToolContext, getAllTools } from '../../core/utils/toolAdapter.js'
import { presetManager } from '../preset/PresetManager.js'
import { memoryManager } from '../storage/MemoryManager.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { databaseService } from '../storage/DatabaseService.js'
import { statsService } from '../stats/StatsService.js'
import { toolGroupManager } from '../tools/ToolGroupManager.js'

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
     * @param {boolean} [options.skipPersona=false] - 跳过人设获取（用于总结等场景）
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
     * sendMessage的内部实现
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
            event, // Yunzai事件对象，用于工具上下文
            mode = 'chat',
            debugMode = false,  // 调试模式
            prefixPersona = null,  // 前缀人格（独立于普通人设）
            disableTools = false,  // 禁用工具调用（用于防止递归）
            skipHistory = false,  // 跳过历史记录（用于事件响应等场景）
            skipPersona = false,  // 跳过人设获取（用于总结等场景）
            temperature: overrideTemperature,  // 覆盖温度参数
            maxTokens: overrideMaxTokens       // 覆盖最大token参数
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

        // 初始化服务
        await contextManager.init()
        await mcpManager.init()

        // 从选项或事件中获取群组ID以实现正确隔离
        const groupId = options.groupId || event?.group_id || event?.data?.group_id || null
        
        // 提取纯userId（不带群号前缀）
        const pureUserId = (event?.user_id || event?.sender?.user_id || userId)?.toString()
        const cleanUserId = pureUserId?.includes('_') ? pureUserId.split('_').pop() : pureUserId
        
        // 群聊始终使用共享上下文，确保所有用户能看到彼此的对话
        // 用户独立人设通过 systemPrompt 实现，而非隔离历史记录
        let conversationId
        if (groupId) {
            // 群聊：始终使用共享的群组上下文 group:${groupId}
            // 这样所有用户的消息都在同一历史中，AI可以看到完整对话
            conversationId = `group:${groupId}`
            logger.debug(`[ChatService] 群聊共享上下文: ${conversationId}`)
        } else {
            // 私聊：使用用户独立上下文
            conversationId = contextManager.getConversationId(cleanUserId, null)
        }
        
        // 检查用户是否有独立人设（用于后续 systemPrompt 构建，不影响历史共享）
        let hasIndependentPersona = false
        if (groupId) {
            try {
                const sm = await ensureScopeManager()
                const groupUserSettings = await sm.getGroupUserSettings(String(groupId), cleanUserId)
                const userSettings = await sm.getUserSettings(cleanUserId)
                if (groupUserSettings?.systemPrompt || userSettings?.systemPrompt) {
                    hasIndependentPersona = true
                    logger.debug(`[ChatService] 用户 ${cleanUserId} 有独立人设，但历史仍共享`)
                }
            } catch (e) {
                logger.debug(`[ChatService] 检查独立人设失败: ${e.message}`)
            }
        }

        // 构建消息内容
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
                logger.error('[ChatService] 处理图片失败:', error)
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
        // 如果 skipHistory 为 true，跳过历史记录（用于事件响应等不需要上下文的场景）
        // 增加历史记录数量以改善上下文理解，从20条增加到30条
        const historyLimit = config.get('context.autoContext.maxHistoryMessages') || 30
        let history = skipHistory ? [] : await contextManager.getContextHistory(conversationId, historyLimit)
        
        // 获取默认预设配置
        await presetManager.init()
        
        // 从ScopeManager获取群组/用户的预设配置（支持群聊和私聊）
        let scopePresetId = null
        let scopePresetSource = null
        let scopeModelId = null
        let scopeModelSource = null
        let scopeFeatures = {}
        try {
            const sm = await ensureScopeManager()
            const pureUserId = cleanUserId
            const isPrivate = !groupId
            const effectiveSettings = await sm.getEffectiveSettings(
                groupId ? String(groupId) : null, 
                pureUserId,
                { isPrivate }
            )
            
            // 获取作用域配置的预设ID
            if (effectiveSettings?.presetId) {
                scopePresetId = effectiveSettings.presetId
                scopePresetSource = effectiveSettings.source
            }
            
            // 获取作用域配置的模型ID
            if (effectiveSettings?.modelId) {
                scopeModelId = effectiveSettings.modelId
                scopeModelSource = effectiveSettings.modelSource
            }
            
            // 获取功能配置
            if (effectiveSettings?.features) {
                scopeFeatures = effectiveSettings.features
            }
            
            // 输出配置摘要日志
            const scene = isPrivate ? '私聊' : `群聊(${groupId})`
            const modelInfo = []
            if (scopeFeatures.chatModel) modelInfo.push(`对话=${scopeFeatures.chatModel}`)
            if (scopeFeatures.toolModel) modelInfo.push(`工具=${scopeFeatures.toolModel}`)
            if (scopeFeatures.dispatchModel) modelInfo.push(`调度=${scopeFeatures.dispatchModel}`)
            if (scopeFeatures.imageModel) modelInfo.push(`图像=${scopeFeatures.imageModel}`)
            if (scopeFeatures.searchModel) modelInfo.push(`搜索=${scopeFeatures.searchModel}`)
            const modelStr = modelInfo.length > 0 ? modelInfo.join(', ') : '默认'
            logger.info(`[ChatService] 作用域配置 [${scene}]: 预设=${scopePresetId || '默认'}, 模型分类=[${modelStr}]`)
        } catch (e) {
            logger.warn('[ChatService] 获取作用域配置失败:', e.message)
        }
        
        // 预设优先级：传入presetId > 传入preset > 作用域配置 > 全局默认
        const effectivePresetIdForModel = presetId || preset?.id || scopePresetId || config.get('llm.defaultChatPresetId') || 'default'
        const currentPreset = preset || presetManager.get(effectivePresetIdForModel)
        
        if (scopePresetId && !presetId && !preset) {
            logger.debug(`[ChatService] 使用群组/用户配置的预设: ${effectivePresetIdForModel}`)
        }
        const presetEnableTools = currentPreset?.tools?.enableBuiltinTools !== false && currentPreset?.enableTools !== false
        // 检查群组工具配置（scopeFeatures.toolsEnabled: true/false/undefined）
        let scopeToolsEnabled = true
        if (scopeFeatures.toolsEnabled !== undefined) {
            scopeToolsEnabled = scopeFeatures.toolsEnabled
            if (!scopeToolsEnabled) {
                logger.info(`[ChatService] 群组禁用了工具调用`)
            }
        }
        const toolsAllowed = !disableTools && presetEnableTools && scopeToolsEnabled
        const hasImages = images.length > 0
        let selectedToolGroupIndexes = []
        let toolsFromGroups = []
        let dispatchInfo = null
        const dispatchModelConfigured = !!LlmService.getDispatchModel()
        const shouldDispatch = toolsAllowed && !hasImages && this.shouldUseToolGroupDispatch({ preset: currentPreset, disableTools }) && dispatchModelConfigured
        
        // 获取群组调度模型配置（提前获取用于判断）
        const groupDispatchModelForDispatch = scopeFeatures.dispatchModel || null
        
        if (shouldDispatch) {
            try { 
                dispatchInfo = await this.dispatchToolGroups(message, { event, debugMode, groupDispatchModel: groupDispatchModelForDispatch, conversationId })
                selectedToolGroupIndexes = dispatchInfo.indexes
                
                // 检查是否有特殊任务需要处理（非纯chat任务）
                const specialTasks = dispatchInfo.tasks?.filter(t => t.type !== 'chat') || []
                
                if (specialTasks.length > 0) {
                    return await this.executeMultiTasks({
                        tasks: dispatchInfo.tasks,
                        executionMode: dispatchInfo.executionMode,
                        originalMessage: message,
                        event,
                        images,
                        conversationId,
                        scopeFeatures,
                        toolsAllowed
                    })
                }
                
                if (selectedToolGroupIndexes.length > 0) {
                    // 根据选中的索引获取完整工具列表
                    toolsFromGroups = await this.getToolsForGroups(selectedToolGroupIndexes, { applyConfig: true })
                    logger.debug(`[ChatService] 工具组调度完成: 选中索引=${JSON.stringify(selectedToolGroupIndexes)}, 工具数=${toolsFromGroups.length}`)
                } else {
                    logger.debug(`[ChatService] 工具组调度: 无需工具`)
                }
            } catch (err) {
                logger.warn(`[ChatService] 工具组调度失败: ${err.message}，回退到普通模式`)
            }
        } else if (toolsAllowed && this.shouldUseToolGroupDispatch({ preset: currentPreset, disableTools })) {
            // 启用了工具组调度但调度模型未配置，跳过调度，使用全量工具
            logger.debug(`[ChatService] 调度模型未配置，跳过调度阶段，使用全量工具模式`)
        }
        
        let llmModel = model
        let actualEnableTools = false
        let actualTools = []  // 实际传递给模型的工具
        let modelScenario = 'chat'
        
        // 获取群组的模型分类配置
        const groupChatModel = scopeFeatures.chatModel || null
        const groupToolModel = scopeFeatures.toolModel || null
        const groupDispatchModel = scopeFeatures.dispatchModel || null
        const groupImageModel = scopeFeatures.imageModel || null
        const groupDrawModel = scopeFeatures.drawModel || null
        const groupSearchModel = scopeFeatures.searchModel || null
        const groupRoleplayModel = scopeFeatures.roleplayModel || null
        
        // 检查工具模型是否已配置（优先群组配置，其次全局配置）
        const toolModelConfigured = !!groupToolModel || !!LlmService.getModel(LlmService.ModelType.TOOL, false)
        
        if (!llmModel) {
            if (hasImages) {
                llmModel = groupImageModel || groupChatModel || LlmService.selectModel({ hasImages: true })
                actualEnableTools = toolsAllowed
                modelScenario = 'image'
                // 如果有工具组选中，仍然可以传递工具
                if (selectedToolGroupIndexes.length > 0 && toolsFromGroups.length > 0) {
                    actualTools = toolsFromGroups
                    logger.info(`[ChatService] 场景=图像处理+工具，模型: ${llmModel}${groupImageModel ? ' (群组图像模型)' : ''}，工具数: ${toolsFromGroups.length}`)
                } else {
                    logger.info(`[ChatService] 场景=图像处理，模型: ${llmModel}${groupImageModel ? ' (群组图像模型)' : groupChatModel ? ' (群组对话模型)' : ''}`)
                }
            } else if (selectedToolGroupIndexes.length > 0 && toolsFromGroups.length > 0) {
                // 调度选中了工具组
                if (toolModelConfigured) {
                    // 工具模型已配置 -> 优先使用群组工具模型，其次全局工具模型
                    llmModel = groupToolModel || LlmService.selectModel({ needsTools: true })
                    modelScenario = 'tool'
                    logger.info(`[ChatService] 场景=工具调用，模型: ${llmModel}${groupToolModel ? ' (群组配置)' : ''}，工具数: ${toolsFromGroups.length}`)
                } else {
                    // 工具模型未配置 -> 使用对话模型 + 选中的工具
                    llmModel = groupChatModel || LlmService.selectModel({})
                    modelScenario = 'chat'
                    logger.info(`[ChatService] 场景=工具调用（无工具模型），模型: ${llmModel}${groupChatModel ? ' (群组配置)' : ''}，工具数: ${toolsFromGroups.length}`)
                }
                actualEnableTools = true
                actualTools = toolsFromGroups
            } else if (shouldDispatch && selectedToolGroupIndexes.length === 0) {
                llmModel = groupChatModel || LlmService.selectModel({})
                actualEnableTools = false  
                modelScenario = 'chat'
                logger.debug(`[ChatService] 场景=调度无需执行工具，模型: ${llmModel}${groupChatModel ? ' (群组配置)' : ''}，不传工具`)
            } else {
                llmModel = groupChatModel || LlmService.selectModel({})
                const toolModelConfigured = !!groupToolModel || !!LlmService.getModel('tool', false)
                if (toolModelConfigured) {
                    // 工具模型已配置，对话模型不需要工具
                    actualEnableTools = false
                    modelScenario = 'chat'
                    logger.debug(`[ChatService] 场景=普通对话，模型: ${llmModel}`)
                } else {
                    // 工具模型未配置，对话模型需要处理工具
                    actualEnableTools = toolsAllowed
                    modelScenario = 'chat'
                    logger.debug(`[ChatService] 场景=普通对话，模型: ${llmModel}，传工具=${actualEnableTools}`)
                }
            }
        } else {
            if (toolsAllowed) {
                actualEnableTools = true
                if (toolsFromGroups.length > 0) {
                    actualTools = toolsFromGroups
                }
                modelScenario = 'tool'
            } else {
                modelScenario = 'chat'
            }
        }
        if (!model && currentPreset?.model && currentPreset.model.trim()) {
            llmModel = currentPreset.model.trim()
            logger.debug(`[ChatService] 使用预设模型覆盖: ${llmModel} (预设: ${currentPreset.name || effectivePresetIdForModel})`)
        }
        
        // 作用域模型覆盖（群组/用户独立模型配置）
        if (!model && scopeModelId) {
            llmModel = scopeModelId
            logger.info(`[ChatService] 使用作用域模型: ${llmModel} (来源: ${scopeModelSource})`)
        }
        
        if (!llmModel || typeof llmModel !== 'string') {
            throw new Error('未配置模型，请先在管理面板「设置 → 模型配置」中配置默认模型')
        }

        // 如果提供了事件，设置工具上下文
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
        // 使用已解析的预设ID（包含作用域配置）
        const effectivePresetId = effectivePresetIdForModel
        const isNewSession = presetManager.isContextCleared(conversationId)

        // 渠道高级配置
        const channelAdvanced = channel?.advanced || {}
        const channelLlm = channelAdvanced.llm || {}
        const channelThinking = channelAdvanced.thinking || {}
        const channelStreaming = channelAdvanced.streaming || {}
        const clientOptions = {
            // 使用模型分离后的工具开关
            enableTools: actualEnableTools,
            // 如果有预选的工具列表（来自工具组调度），传递给客户端
            preSelectedTools: actualTools.length > 0 ? actualTools : null,
            enableReasoning: preset?.enableReasoning ?? channelThinking.enableReasoning,
            reasoningEffort: channelThinking.defaultLevel || 'low',
            adapterType: adapterType,
            event,
            presetId: effectivePresetId,
            userPermission: event?.sender?.role || 'member',
            modelScenario,  // 记录模型使用场景
            dispatchInfo    // 调度信息（用于调试）
        }
        
        // 输出模型选择摘要
        const modelSource = groupChatModel || groupToolModel ? '群组配置' : (scopeModelId ? '作用域' : '全局')
        logger.info(`[ChatService] 模型选择: ${llmModel} (场景: ${modelScenario}, 来源: ${modelSource}, 工具: ${actualEnableTools ? actualTools.length + '个' : '禁用'})`)

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
            promptContext.bot_id = event.self_id?.toString() || ''
        }
        // 预设的systemPrompt也需要经过占位符替换
        let defaultPrompt = preset?.systemPrompt 
            ? presetManager.replaceVariables(preset.systemPrompt, promptContext)
            : presetManager.buildSystemPrompt(effectivePresetId, promptContext)
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
        
        // skipPersona 模式：跳过人设获取，使用空的 systemPrompt（用于总结等场景）
        if (skipPersona) {
            systemPrompt = ''
            logger.debug(`[ChatService] skipPersona=true，跳过人设获取，使用空 systemPrompt`)
            if (debugInfo) {
                debugInfo.scope = {
                    skipPersona: true,
                    promptSource: 'none',
                    presetSource: 'skipped',
                    presetId: null
                }
            }
        } else {
            try {
                const scopeGroupId = groupId?.toString() || null
                const scopeUserId = (event?.user_id || event?.sender?.user_id || userId)?.toString()
                const pureUserId = scopeUserId.includes('_') ? scopeUserId.split('_').pop() : scopeUserId
                const independentResult = await sm.getIndependentPrompt(scopeGroupId, pureUserId, defaultPrompt)
                systemPrompt = independentResult.prompt
                if (independentResult.isIndependent) {
                    // 支持空人设：当用户设置为空字符串时，使用空系统提示词
                    if (systemPrompt === '') {
                        logger.debug(`[ChatService] 使用空人设 (来源: ${independentResult.source})`)
                    } else {
                        logger.debug(`[ChatService] 使用独立人设 (来源: ${independentResult.source})`)
                    }
                }
                // 收集 scope 调试信息
                if (debugInfo) {
                    debugInfo.scope = {
                        groupId: scopeGroupId,
                        userId: pureUserId,
                        isIndependent: independentResult.isIndependent,
                        promptSource: independentResult.source,
                        presetSource: scopePresetSource || 'default',
                        presetId: scopePresetId || effectivePresetId,
                        forceIsolation,
                        conversationId,
                        hasPrefixPersona: !!prefixPersona
                    }
                }
            } catch (e) { 
                logger.warn(`[ChatService] 获取独立人设失败:`, e.message) 
            }
        }
        let prefixPresetId = null
        // skipPersona 模式下也跳过 prefixPersona 处理
        if (prefixPersona && !skipPersona) {
            logger.debug(`[ChatService] 收到前缀人格参数: "${prefixPersona}" (长度: ${prefixPersona?.length || 0})`)
            const prefixPreset = presetManager.get(prefixPersona)
            
            // 保存原有的基础人设用于合并
            const basePrompt = systemPrompt
            
            if (prefixPreset) {
                prefixPresetId = prefixPersona
                const prefixPromptText = prefixPreset.systemPrompt || ''
                // 合并模式：前缀人格 + 基础人设（如果前缀人格不为空）
                if (prefixPromptText) {
                    // 前缀人格覆盖基础人设，但保留基础人设作为补充
                    systemPrompt = prefixPromptText
                    if (basePrompt && basePrompt !== prefixPromptText) {
                        // 可选：将基础人设作为额外上下文附加（如果需要保留）
                        logger.debug(`[ChatService] 前缀人格已覆盖基础人设 (基础人设长度: ${basePrompt.length})`)
                    }
                }
                logger.debug(`[ChatService] 使用前缀人格预设: ${prefixPresetId} (${prefixPreset.name || prefixPresetId})`)
            } else {
                // 纯文本前缀人格 - 作为附加内容而不是完全覆盖
                if (prefixPersona.startsWith('覆盖:') || prefixPersona.startsWith('override:')) {
                    // 显式覆盖模式
                    systemPrompt = prefixPersona.replace(/^(覆盖:|override:)/, '').trim()
                    logger.debug(`[ChatService] 前缀人格显式覆盖模式 (内容长度: ${systemPrompt.length})`)
                } else {
                    // 默认合并模式：将前缀人格放在基础人设之前
                    systemPrompt = prefixPersona + (basePrompt ? '\n\n' + basePrompt : '')
                    logger.debug(`[ChatService] 前缀人格合并模式 (前缀: ${prefixPersona.length}, 基础: ${basePrompt?.length || 0})`)
                }
            }
            logger.debug(`[ChatService] 前缀人格应用后systemPrompt长度: ${systemPrompt.length}`)
        }
        if (config.get('memory.enabled') && !skipPersona) {
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
            // 优先使用前缀人格预设的知识库，否则使用作用域预设的知识库
            const knowledgePresetId = prefixPresetId || effectivePresetId
            const knowledgePrompt = knowledgeService.buildKnowledgePrompt(knowledgePresetId, {
                maxLength: config.get('knowledge.maxLength') || 15000,
                includeTriples: config.get('knowledge.includeTriples') !== false
            })
            if (knowledgePrompt) {
                systemPrompt += '\n\n' + knowledgePrompt
                logger.debug(`[ChatService] 已添加知识库上下文 (${knowledgePrompt.length} 字符, 预设: ${knowledgePresetId})`)
                // 收集知识库调试信息
                if (debugInfo) {
                    debugInfo.knowledge = {
                        hasKnowledge: true,
                        length: knowledgePrompt.length,
                        presetId: knowledgePresetId,
                        preview: knowledgePrompt.substring(0, 500) + (knowledgePrompt.length > 500 ? '...' : '')
                    }
                }
            } else if (debugInfo) {
                debugInfo.knowledge = { hasKnowledge: false, presetId: knowledgePresetId }
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
        
        // 支持禁用系统提示词：当预设设置 disableSystemPrompt 为 true 时，完全不发送 system 消息
        // 支持空人设：当 systemPrompt 为空时，也不添加系统消息
        let messages = []
        const shouldDisableSystemPrompt = currentPreset?.disableSystemPrompt === true
        if (!shouldDisableSystemPrompt && systemPrompt && systemPrompt.trim()) {
            messages.push({ role: 'system', content: [{ type: 'text', text: systemPrompt }] })
        } else if (shouldDisableSystemPrompt) {
            logger.debug(`[ChatService] 预设已禁用系统提示词，不发送 system 消息`)
        }
        messages.push(...validHistory, userMessage)

        const hasTools = client.tools && client.tools.length > 0
        const useStreaming = stream || channelStreaming.enabled === true
        logger.debug(`[ChatService] Request: model=${llmModel}, stream=${useStreaming}, tools=${hasTools ? client.tools.length : 0}, channelStreaming=${JSON.stringify(channelStreaming)}`)
        let finalResponse = null
        let finalUsage = null
        let allToolLogs = []
        let lastError = null
        const requestStartTime = Date.now()
        
        // 参数优先级：调用方覆盖 > 预设 > 渠道 > 默认值（移到外层，确保 finally 可访问）
        const presetParams = currentPreset?.modelParams || {}
        const baseMaxToken = presetParams.max_tokens || presetParams.maxTokens || channelLlm.maxTokens || 4000
        const baseTemperature = presetParams.temperature ?? channelLlm.temperature ?? 0.7
        const requestOptions = {
            model: llmModel,
            maxToken: overrideMaxTokens ?? baseMaxToken,
            temperature: overrideTemperature ?? baseTemperature,
            topP: presetParams.top_p ?? presetParams.topP ?? channelLlm.topP,
            conversationId,
            systemOverride: systemPrompt,
            stream: useStreaming,
            // 跳过历史时，同时禁用客户端的历史读取
            disableHistoryRead: skipHistory,
        }
        const tempSource = overrideTemperature !== undefined ? '调用方' : (presetParams.temperature !== undefined ? '预设' : (channelLlm.temperature !== undefined ? '渠道' : '默认'))
        logger.debug(`[ChatService] 请求参数: temperature=${requestOptions.temperature}, maxToken=${requestOptions.maxToken}, 来源: ${tempSource}`)
        
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
                const enableChannelSwitch = fallbackConfig.enableChannelSwitch !== false // 默认启用渠道切换
                const enableKeyRotation = fallbackConfig.enableKeyRotation !== false // 默认启用Key轮换
                const emptyRetries = fallbackConfig.emptyRetries || 2 // 空响应重试次数
                
                const modelsToTry = [llmModel, ...fallbackModels.filter(m => m && m !== llmModel)]
                let response = null
                let usedModel = llmModel
                let usedChannel = channel
                let fallbackUsed = false
                let channelSwitched = false
                let totalRetryCount = 0
                let currentKeyIndex = clientOptions.keyIndex ?? -1
                const switchChain = [channel?.name || channel?.id || 'unknown'] // 记录渠道切换链
                
                for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
                    const currentModel = modelsToTry[modelIndex]
                    const isMainModel = modelIndex === 0
                    let retryCount = 0
                    let emptyRetryCount = 0
                    let currentClient = client
                    let currentChannel = isMainModel ? channel : null
                    
                    // 备选模型时获取新渠道
                    if (!isMainModel) {
                        currentChannel = channelManager.getBestChannel(currentModel)
                        if (currentChannel) {
                            const keyInfo = channelManager.getChannelKey(currentChannel)
                            currentKeyIndex = keyInfo.keyIndex
                            const fallbackClientOptions = {
                                ...clientOptions,
                                adapterType: currentChannel.adapterType,
                                baseUrl: currentChannel.baseUrl,
                                apiKey: keyInfo.key,
                                keyIndex: keyInfo.keyIndex
                            }
                            currentClient = await LlmService.createClient(fallbackClientOptions)
                        }
                    }
                    
                    while (retryCount <= (isMainModel ? maxRetries : 1)) {
                        try {
                            const currentRequestOptions = { ...requestOptions, model: currentModel }
                            response = await currentClient.sendMessage(userMessage, currentRequestOptions)
                            
                            const hasToolCallLogs = response?.toolCallLogs?.length > 0
                            const hasContents = response?.contents?.length > 0
                            const hasTextContent = response?.contents?.some(c => c.type === 'text' && c.text?.trim())
                            const hasAnyContent = hasContents || hasToolCallLogs
                            
                            // 成功响应：有内容或有工具调用
                            if (response && hasAnyContent) {
                                // 检查是否为空文本响应（无工具调用且无文本）
                                if (!hasToolCallLogs && !hasTextContent && emptyRetryCount < emptyRetries) {
                                    emptyRetryCount++
                                    logger.warn(`[ChatService] 模型 ${currentModel} 返回空文本，重试第${emptyRetryCount}次...`)
                                    await new Promise(r => setTimeout(r, retryDelay * emptyRetryCount))
                                    continue
                                }
                                
                                // 成功
                                usedModel = currentModel
                                usedChannel = currentChannel
                                if (!isMainModel) {
                                    fallbackUsed = true
                                    logger.info(`[ChatService] 使用备选模型成功: ${currentModel}`)
                                    if (notifyOnFallback && event?.reply) {
                                        try { await event.reply(`[已切换至备选模型: ${currentModel}]`, false) } catch {}
                                    }
                                }
                                // 成功后重置渠道错误计数
                                if (currentChannel) {
                                    channelManager.resetChannelError(currentChannel.id)
                                }
                                break
                            }
                            
                            // 空响应处理
                            emptyRetryCount++
                            if (emptyRetryCount <= emptyRetries) {
                                logger.warn(`[ChatService] 模型 ${currentModel} 返回空响应，重试第${emptyRetryCount}次...`)
                                await new Promise(r => setTimeout(r, retryDelay * emptyRetryCount))
                                continue
                            }
                            
                            // 空响应重试耗尽，尝试切换Key
                            if (enableKeyRotation && currentChannel && currentKeyIndex >= 0) {
                                const nextKey = channelManager.getNextAvailableKey(currentChannel.id, currentKeyIndex)
                                if (nextKey) {
                                    logger.info(`[ChatService] 空响应后切换Key: ${currentChannel.name} Key#${nextKey.keyIndex + 1}`)
                                    currentKeyIndex = nextKey.keyIndex
                                    const newClientOptions = { ...clientOptions, apiKey: nextKey.key, keyIndex: nextKey.keyIndex }
                                    currentClient = await LlmService.createClient(newClientOptions)
                                    emptyRetryCount = 0 // 重置空响应计数
                                    continue
                                }
                            }
                            
                            // 尝试切换渠道
                            if (enableChannelSwitch && isMainModel) {
                                const altChannels = channelManager.getAvailableChannels(currentModel, { 
                                    excludeChannelId: currentChannel?.id 
                                })
                                if (altChannels.length > 0) {
                                    const altChannel = altChannels[0]
                                    const altKeyInfo = channelManager.getChannelKey(altChannel)
                                    logger.info(`[ChatService] 空响应后切换渠道: ${currentChannel?.name} -> ${altChannel.name}`)
                                    currentChannel = altChannel
                                    currentKeyIndex = altKeyInfo.keyIndex
                                    channelSwitched = true
                                    switchChain.push(altChannel.name || altChannel.id)
                                    const altClientOptions = {
                                        ...clientOptions,
                                        adapterType: altChannel.adapterType,
                                        baseUrl: altChannel.baseUrl,
                                        apiKey: altKeyInfo.key,
                                        keyIndex: altKeyInfo.keyIndex
                                    }
                                    currentClient = await LlmService.createClient(altClientOptions)
                                    emptyRetryCount = 0
                                    continue
                                }
                            }
                            
                            // 无法处理空响应，进入下一个模型
                            break
                            
                        } catch (modelError) {
                            lastError = modelError
                            const errorMsg = modelError.message || ''
                            
                            // 分析错误类型
                            let errorType = 'unknown'
                            if (errorMsg.includes('401') || errorMsg.includes('Unauthorized') || errorMsg.includes('invalid_api_key')) {
                                errorType = 'auth'
                            } else if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate_limit')) {
                                errorType = 'quota'
                            } else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) {
                                errorType = 'timeout'
                            } else if (errorMsg.includes('ECONNREFUSED') || errorMsg.includes('network')) {
                                errorType = 'network'
                            }
                            
                            logger.error(`[ChatService] 模型 ${currentModel} 请求失败 (${errorType}): ${errorMsg}`)
                            
                            // 报告渠道错误
                            if (currentChannel) {
                                await channelManager.reportError(currentChannel.id, {
                                    keyIndex: currentKeyIndex,
                                    errorType,
                                    errorMessage: errorMsg
                                })
                            }
                            
                            // 认证错误: 尝试切换Key
                            if (errorType === 'auth' && enableKeyRotation && currentChannel && currentKeyIndex >= 0) {
                                const nextKey = channelManager.getNextAvailableKey(currentChannel.id, currentKeyIndex)
                                if (nextKey) {
                                    logger.info(`[ChatService] 认证失败后切换Key: ${currentChannel.name} Key#${nextKey.keyIndex + 1}`)
                                    currentKeyIndex = nextKey.keyIndex
                                    const newClientOptions = { ...clientOptions, apiKey: nextKey.key, keyIndex: nextKey.keyIndex }
                                    currentClient = await LlmService.createClient(newClientOptions)
                                    continue // 不增加retryCount，直接重试
                                }
                            }
                            
                            // 配额/限流错误: 尝试切换渠道
                            if ((errorType === 'quota' || errorType === 'auth') && enableChannelSwitch && isMainModel) {
                                const altChannels = channelManager.getAvailableChannels(currentModel, {
                                    excludeChannelId: currentChannel?.id
                                })
                                if (altChannels.length > 0) {
                                    const altChannel = altChannels[0]
                                    const altKeyInfo = channelManager.getChannelKey(altChannel)
                                    logger.info(`[ChatService] ${errorType}错误后切换渠道: ${currentChannel?.name} -> ${altChannel.name}`)
                                    currentChannel = altChannel
                                    currentKeyIndex = altKeyInfo.keyIndex
                                    channelSwitched = true
                                    switchChain.push(altChannel.name || altChannel.id)
                                    const altClientOptions = {
                                        ...clientOptions,
                                        adapterType: altChannel.adapterType,
                                        baseUrl: altChannel.baseUrl,
                                        apiKey: altKeyInfo.key,
                                        keyIndex: altKeyInfo.keyIndex
                                    }
                                    currentClient = await LlmService.createClient(altClientOptions)
                                    continue
                                }
                            }
                            
                            retryCount++
                            totalRetryCount++
                            
                            if (retryCount <= (isMainModel ? maxRetries : 1)) {
                                // 指数退避延迟
                                const delay = Math.min(retryDelay * Math.pow(2, retryCount - 1), 10000)
                                logger.debug(`[ChatService] ${delay}ms后重试...`)
                                await new Promise(r => setTimeout(r, delay))
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
                    
                    logger.info(`[ChatService] 尝试备选模型: ${modelsToTry[modelIndex + 1]}`)
                }
                if (!response && lastError) {
                    if (debugInfo) {
                        debugInfo.totalRetryCount = totalRetryCount
                        debugInfo.switchChain = switchChain.length > 1 ? switchChain : null
                        debugInfo.channelSwitched = channelSwitched
                    }
                    throw lastError
                }
                
                if (!response) {
                    logger.warn('[ChatService] 所有模型和渠道尝试后仍无有效响应')
                }
                
                finalResponse = response?.contents || []
                finalUsage = response?.usage || {}
                allToolLogs = response?.toolCallLogs || []
                if (finalResponse.length > 0) {
                    finalResponse = finalResponse.filter(c => {
                        if (c.type === 'text' && c.text) {
                            return !this.isPureToolCallJson(c.text)
                        }
                        return true
                    })
                }
                
                // 记录实际使用的模型和渠道切换信息
                if (debugInfo) {
                    debugInfo.usedModel = usedModel
                    debugInfo.fallbackUsed = fallbackUsed
                    debugInfo.channelSwitched = channelSwitched
                    debugInfo.usedChannel = usedChannel ? {
                        id: usedChannel.id,
                        name: usedChannel.name
                    } : null
                    debugInfo.totalRetryCount = totalRetryCount
                    debugInfo.switchChain = switchChain.length > 1 ? switchChain : null 
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
                // 成功时重置渠道错误计数
                if (finalResponse?.length > 0) {
                    channelManager.reportSuccess(channel.id)
                }
            }
            
            // 记录统计（使用统一入口）
            try {
                const keyInfo = channel?.lastUsedKey || {}
                const requestDuration = Date.now() - requestStartTime
                const responseText = finalResponse?.filter(c => c.type === 'text').map(c => c.text).join('') || ''
                const requestSuccess = !!finalResponse?.length
                
                await statsService.recordApiCall({
                    channelId: debugInfo?.usedChannel?.id || channel?.id || `no-channel-${llmModel}`,
                    channelName: debugInfo?.usedChannel?.name || channel?.name || `无渠道(${llmModel})`,
                    model: debugInfo?.usedModel || llmModel,
                    keyIndex: keyInfo.keyIndex ?? -1,
                    keyName: keyInfo.keyName || '',
                    strategy: keyInfo.strategy || '',
                    duration: requestDuration,
                    success: requestSuccess,
                    error: !requestSuccess ? (lastError?.message || lastError?.toString() || '未知错误') : null,
                    source: 'chat',
                    userId,
                    groupId: groupId || null,
                    stream: useStreaming,
                    retryCount: debugInfo?.totalRetryCount || 0,
                    channelSwitched: debugInfo?.channelSwitched || false,
                    previousChannelId: debugInfo?.channelSwitched ? channel?.id : null,
                    switchChain: debugInfo?.switchChain || null,
                    apiUsage: finalUsage,
                    messages,
                    responseText,
                    // 请求详情
                    request: { 
                        messages, 
                        model: debugInfo?.usedModel || llmModel,
                        tools: hasTools ? client.tools.map(t => ({ name: t.name, description: t.description?.substring(0, 100) })) : null,
                        temperature: requestOptions.temperature,
                        maxToken: requestOptions.maxToken,
                        topP: requestOptions.topP,
                        systemPrompt: systemPrompt?.substring(0, 500) + (systemPrompt?.length > 500 ? '...' : ''),
                    },
                    response: !requestSuccess ? { 
                        error: lastError?.message || lastError?.toString() || '未知错误',
                        code: lastError?.code || lastError?.status || null,
                        type: lastError?.type || lastError?.name || null,
                        contents: finalResponse 
                    } : null,
                })
                
                // 记录工具调用
                if (allToolLogs?.length > 0) {
                    for (const log of allToolLogs) {
                        statsService.recordToolCall(log.name, !log.isError)
                    }
                }
            } catch (e) {
                logger.warn(`[ChatService] 记录统计失败:`, e.message)
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
        
        // 检测被截断或不完整的工具调用JSON（如 {"tool_calls": [{"id":... ）
        // 这种情况下JSON.parse会失败，但仍然应该被过滤
        if (trimmed.startsWith('{"tool_calls"') || trimmed.startsWith('{ "tool_calls"')) {
            // 检查是否只包含工具调用相关内容，没有其他有意义的文本
            const toolCallPattern = /^\{\s*"tool_calls"\s*:\s*\[/
            if (toolCallPattern.test(trimmed)) {
                // 检查是否有非JSON的正常文本内容
                // 如果整个文本都是JSON格式（即使不完整），则过滤
                const hasNormalText = /[^\s\{\}\[\]"':,\d\w_-]/.test(trimmed.replace(/"[^"]*"/g, ''))
                if (!hasNormalText) {
                    return true
                }
            }
        }
        const toolArgsPatterns = [
            /^\s*,?\s*\[\s*\{.*"user_id".*"nickname".*"message".*\}\s*\]/s,  
            /^\s*,?\s*\{.*"user_id".*"nickname".*"message".*\}/s,            
            /^\s*\{.*"function".*"name".*"arguments".*\}/s,                  
            /^\s*\{.*"name".*"arguments".*\}/s,                            
            /\]\s*\}"\s*\}\s*\]\s*\}$/,                                      
        ]
        for (const pattern of toolArgsPatterns) {
            if (pattern.test(trimmed)) {
                const stripped = trimmed.replace(/"[^"]*"/g, '""')
                const isOnlyJson = /^[\s\[\]\{\},:"'\d\w_-]*$/.test(stripped)
                if (isOnlyJson) {
                    return true
                }
            }
        }
        
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                const parsed = JSON.parse(trimmed)
                const keys = Object.keys(parsed)
                if (keys.length === 1 && keys[0] === 'tool_calls' && Array.isArray(parsed.tool_calls)) {
                    return parsed.tool_calls.length === 0 || parsed.tool_calls.every(tc => 
                        tc && typeof tc === 'object' && 
                        (tc.function?.name || tc.name) 
                    )
                }
            } catch {
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
                        // 空数组或有效的工具调用数组都视为纯工具调用JSON
                        return parsed.tool_calls.length === 0 || parsed.tool_calls.every(tc => 
                            tc && typeof tc === 'object' && 
                            (tc.function?.name || tc.name)
                        )
                    }
                } catch {
                    // JSON解析失败
                }
            }
            // 检测代码块中被截断的工具调用JSON
            if (inner.startsWith('{"tool_calls"') || inner.startsWith('{ "tool_calls"')) {
                return true
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

    /**
     * @param {string} message - 用户消息
     * @param {Object} options - 选项
     * @returns {Promise<{indexes: number[], dispatchResponse: string, tasks: Array, executionMode: string, analysis: string}>}
     */
    async dispatchToolGroups(message, options = {}) {
        const { event, debugMode, groupDispatchModel, conversationId } = options
        const defaultReturn = { indexes: [], dispatchResponse: '', tasks: [{ type: 'chat', priority: 1, params: {} }], executionMode: 'sequential', analysis: '' }
        
        // 初始化工具组管理器
        await toolGroupManager.init()
        
        // 获取调度模型（优先群组配置）
        const dispatchModel = groupDispatchModel || LlmService.selectModel({ isDispatch: true })
        
        if (!dispatchModel) {
            logger.warn('[ChatService] 未配置调度模型，跳过工具组调度')
            return defaultReturn
        }
        
        // 构建调度提示词
        const dispatchPrompt = toolGroupManager.buildDispatchPrompt()
        
        if (!dispatchPrompt) {
            return defaultReturn
        }
        
        // 获取上下文历史，帮助调度模型理解用户意图
        let contextSummary = ''
        if (conversationId) {
            try {
                const history = await contextManager.getContextHistory(conversationId, 10)
                if (history.length > 0) {
                    // 提取最近几条消息作为上下文摘要
                    const recentMessages = history.slice(-5).map(msg => {
                        const role = msg.role === 'user' ? '用户' : 'AI'
                        const text = Array.isArray(msg.content) 
                            ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('').substring(0, 100)
                            : String(msg.content).substring(0, 100)
                        return `${role}: ${text}`
                    }).join('\n')
                    contextSummary = `\n\n【最近对话上下文】\n${recentMessages}\n`
                    logger.debug(`[ChatService] 调度携带上下文: ${history.length} 条历史`)
                }
            } catch (e) {
                logger.debug(`[ChatService] 获取调度上下文失败: ${e.message}`)
            }
        }
        
        try {
            // 创建调度客户端（无工具，快速响应）
            await channelManager.init()
            const channel = channelManager.getBestChannel(dispatchModel)
            
            if (!channel) {
                logger.warn('[ChatService] 未找到支持调度模型的渠道')
                return defaultReturn
            }
            
            const clientOptions = {
                enableTools: false,  // 调度阶段不启用工具
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key
            }
            
            const client = await LlmService.createClient(clientOptions)
            
            // 发送调度请求（带重试）- 包含上下文
            const dispatchMessage = {
                role: 'user',
                content: [
                    { type: 'text', text: `${dispatchPrompt}${contextSummary}\n\n用户当前请求：${message}` }
                ]
            }
            
            let response = null
            let lastError = null
            const maxRetries = 2
            
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
                try {
                    response = await client.sendMessage(dispatchMessage, {
                        model: dispatchModel,
                        maxToken: 512,
                        temperature: 0.3 + (attempt * 0.2)  // 重试时稍微提高温度
                    })
                    
                    // 检查响应是否有效
                    if (response?.contents?.length > 0) {
                        break
                    }
                    
                    logger.warn(`[ChatService] 调度响应为空，尝试重试 (${attempt + 1}/${maxRetries + 1})`)
                    lastError = new Error('调度模型返回空响应')
                } catch (err) {
                    lastError = err
                    if (attempt < maxRetries) {
                        logger.warn(`[ChatService] 调度请求失败，重试中: ${err.message}`)
                        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
                    }
                }
            }
            
            if (!response?.contents?.length) {
                throw lastError || new Error('调度模型未返回有效响应')
            }
            
            // 解析响应
            const responseText = response.contents
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            // 使用增强版解析（支持多任务）
            const parsed = toolGroupManager.parseDispatchResponseV2(responseText)
            
            const taskTypes = parsed.tasks.map(t => t.type).join(',')
            logger.info(`[ChatService] 调度结果: 模型=${dispatchModel}, 分析="${parsed.analysis}", 任务=[${taskTypes}], 执行模式=${parsed.executionMode}`)
            
            return { 
                indexes: parsed.toolGroups, 
                dispatchResponse: responseText,
                tasks: parsed.tasks,
                executionMode: parsed.executionMode,
                analysis: parsed.analysis
            }
            
        } catch (error) {
            logger.error('[ChatService] 工具组调度失败:', error.message)
            return defaultReturn
        }
    }

    /**
     * 根据场景选择合适的模型
     * 
     * 模型分离原则：
     * - 对话模型(chat)：普通聊天，不传递工具
     * - 工具模型(tool)：执行工具调用
     * - 调度模型(dispatch)：分析需要哪些工具组
     * - 图像模型(image)：图像理解和生成
     * 
     * @param {Object} options - 选择参数
     * @returns {Object} { model, enableTools, isDispatchPhase }
     */
    selectModelForScenario(options = {}) {
        const {
            hasImages = false,
            needsTools = false,
            isRoleplay = false,
            isDispatch = false,
            preset = null
        } = options
        
        // 1. 调度阶段 - 使用调度模型，不带工具
        if (isDispatch) {
            return {
                model: LlmService.selectModel({ isDispatch: true }),
                enableTools: false,
                isDispatchPhase: true,
                scenario: 'dispatch'
            }
        }
        
        // 2. 工具调用阶段 - 使用工具模型
        if (needsTools) {
            return {
                model: LlmService.selectModel({ needsTools: true }),
                enableTools: true,
                isDispatchPhase: false,
                scenario: 'tool'
            }
        }
        
        // 3. 图像处理 - 使用图像模型
        if (hasImages) {
            return {
                model: LlmService.selectModel({ hasImages: true }),
                enableTools: preset?.tools?.enableBuiltinTools !== false,
                isDispatchPhase: false,
                scenario: 'image'
            }
        }
        
        // 4. 伪人模式 - 使用伪人模型，不带工具
        if (isRoleplay) {
            return {
                model: LlmService.selectModel({ isRoleplay: true }),
                enableTools: false,
                isDispatchPhase: false,
                scenario: 'roleplay'
            }
        }
        
        // 5. 普通对话 - 使用对话模型
        // 根据预设配置决定是否启用工具
        const enableTools = preset?.tools?.enableBuiltinTools !== false
        
        return {
            model: LlmService.selectModel({}),
            enableTools,
            isDispatchPhase: false,
            scenario: 'chat'
        }
    }

    /**
     * 根据工具组索引获取工具并创建客户端
     * 
     * @param {number[]} groupIndexes - 工具组索引
     * @param {Object} options - 选项
     * @returns {Promise<Array>} 工具列表
     */
    async getToolsForGroups(groupIndexes, options = {}) {
        if (!groupIndexes || groupIndexes.length === 0) {
            return []
        }
        
        await toolGroupManager.init()
        const tools = await toolGroupManager.getToolsByGroupIndexes(groupIndexes, options)
        
        logger.debug(`[ChatService] 获取工具组 [${groupIndexes.join(',')}] 的工具，共 ${tools.length} 个`)
        
        return tools
    }

    /**
     * 检查是否应该使用工具组调度模式
     * 
     * @param {Object} options - 选项
     * @returns {boolean}
     */
    shouldUseToolGroupDispatch(options = {}) {
        const { preset, disableTools } = options
        
        // 如果禁用工具，不使用调度
        if (disableTools) return false
        
        // 如果预设禁用工具，不使用调度
        if (preset?.tools?.enableBuiltinTools === false) return false
        
        // 检查配置
        const useToolGroups = config.get('tools.useToolGroups')
        const dispatchFirst = config.get('tools.dispatchFirst')
        
        return useToolGroups === true && dispatchFirst === true
    }

    /**
     * 处理绘图任务
     * 调用 ImageGen 的绘图 API 生成图片
     * 
     * @param {Object} options - 选项
     * @returns {Promise<Object>} 返回与 chat 方法相同格式的结果
     */
    async handleDrawTask(options = {}) {
        const { drawPrompt, originalMessage, event, images = [], conversationId, scopeFeatures = {} } = options
        const startTime = Date.now()
        
        try {
            // 动态导入 ImageGen 避免循环依赖
            const { ImageGen } = await import('../../../apps/ImageGen.js')
            const imageGen = new ImageGen()
            
            // 设置事件上下文（ImageGen 需要 this.e）
            imageGen.e = event
            
            // 获取群组独立的绘图模型配置
            const groupDrawModel = scopeFeatures.drawModel || null
            let overrideModel = groupDrawModel
            
            // 如果没有群组配置，检查全局绘图模型
            if (!overrideModel) {
                overrideModel = LlmService.getDrawModel()
            }
            
            // 准备图片URL（如果是图生图）
            const imageUrls = images.map(img => {
                if (typeof img === 'string') return img
                return img.url || img.file || img
            }).filter(Boolean)
            
            logger.info(`[ChatService] 绘图任务: prompt="${drawPrompt.substring(0, 100)}...", 参考图=${imageUrls.length}张, 模型=${overrideModel || '默认'}`)
            
            // 调用绘图 API
            const result = await imageGen.generateImage({
                prompt: drawPrompt,
                imageUrls
            })
            
            const duration = Date.now() - startTime
            
            if (result.success && result.images?.length > 0) {
                // 发送生成的图片
                const { segment } = await import('../../utils/messageParser.js')
                
                if (event?.reply) {
                    // 先发送图片
                    await event.reply(result.images.map(url => segment.image(url)), true)
                }
                
                // 调用对话模型生成符合人设的自然回复
                let naturalReply = ''
                try {
                    const chatModel = scopeFeatures.chatModel || LlmService.getChatModel() || LlmService.getDefaultModel()
                    await channelManager.init()
                    const channel = channelManager.getBestChannel(chatModel)
                    
                    if (channel) {
                        const client = await LlmService.createClient({
                            enableTools: false,
                            adapterType: channel.adapterType,
                            baseUrl: channel.baseUrl,
                            apiKey: channelManager.getChannelKey(channel).key,
                            presetId: scopeFeatures.presetId || 'default'
                        })
                        
                        // 获取历史上下文以保持人设一致性
                        let contextMessages = []
                        if (conversationId) {
                            try {
                                const context = await contextManager.getContext(conversationId)
                                contextMessages = context?.messages?.slice(-4) || []
                            } catch {}
                        }
                        
                        // 构建让对话模型生成自然回复的提示
                        const systemPrompt = `你刚刚成功帮用户生成了一张图片。请用简短、自然、符合你人设的方式回复。要有趣味性，不要太正式，不需要描述图片内容。`
                        
                        const messages = [
                            ...contextMessages,
                            { role: 'user', content: [{ type: 'text', text: originalMessage }] },
                            { role: 'assistant', content: [{ type: 'text', text: `[已生成图片: ${drawPrompt.substring(0, 50)}...]` }] },
                            { role: 'user', content: [{ type: 'text', text: systemPrompt }] }
                        ]
                        
                        const response = await client.sendMessage(messages[messages.length - 1], {
                            model: chatModel,
                            maxToken: 256,
                            temperature: 0.9,
                            messages: messages.slice(0, -1)
                        })
                        
                        naturalReply = response.contents
                            ?.filter(c => c.type === 'text')
                            ?.map(c => c.text)
                            ?.join('') || ''
                    }
                } catch (replyErr) {
                    logger.debug(`[ChatService] 生成自然回复失败: ${replyErr.message}`)
                }
                
                // 发送自然回复
                if (event?.reply && naturalReply) {
                    await event.reply(naturalReply, true)
                } else if (event?.reply) {
                    await event.reply(`✅ 图片生成完成 (${this.formatDuration(duration)})`, true)
                }
                
                // 返回成功结果
                return {
                    success: true,
                    contents: [{ 
                        type: 'text', 
                        text: naturalReply || `已根据提示词生成图片: ${drawPrompt}` 
                    }],
                    images: result.images,
                    usage: { inputTokens: 0, outputTokens: 0 },
                    duration,
                    taskType: 'draw',
                    drawPrompt
                }
            } else {
                // 生成失败
                const errorMsg = result.error || '图片生成失败'
                logger.warn(`[ChatService] 绘图失败: ${errorMsg}`)
                
                if (event?.reply) {
                    await event.reply(`❌ ${errorMsg}`, true)
                }
                
                return {
                    success: false,
                    contents: [{ type: 'text', text: errorMsg }],
                    error: errorMsg,
                    duration,
                    taskType: 'draw'
                }
            }
        } catch (error) {
            const duration = Date.now() - startTime
            logger.error(`[ChatService] 绘图任务异常:`, error)
            
            const errorMsg = `绘图失败: ${error.message}`
            if (event?.reply) {
                await event.reply(`❌ ${errorMsg}`, true)
            }
            
            return {
                success: false,
                contents: [{ type: 'text', text: errorMsg }],
                error: errorMsg,
                duration,
                taskType: 'draw'
            }
        }
    }

    /**
     * 执行多步任务
     * 支持串行/并行执行，任务间可以传递结果
     * 
     * @param {Object} options - 选项
     * @returns {Promise<Object>} 执行结果
     */
    async executeMultiTasks(options = {}) {
        const { tasks, executionMode, originalMessage, event, images = [], conversationId, scopeFeatures = {}, toolsAllowed } = options
        const startTime = Date.now()
        const results = []
        let systemPrompt = ''
        try {
            const groupId = event?.group_id ? String(event.group_id) : null
            const userId = event?.user_id ? String(event.user_id) : null
            const cleanUserId = userId?.includes('_') ? userId.split('_').pop() : userId
            
            // 构建占位符上下文
            const promptContext = {
                user_name: event?.sender?.card || event?.sender?.nickname || '用户',
                user_id: event?.user_id?.toString() || userId || '',
                group_name: event?.group_name || '',
                group_id: groupId || '',
                bot_name: event?.bot?.nickname || 'AI助手',
                bot_id: event?.self_id?.toString() || ''
            }
            
            // 初始化预设管理器
            await presetManager.init()
            
            if (groupId || userId) {
                const sm = await ensureScopeManager()
                const effectiveSettings = await sm.getEffectiveSettings(groupId, userId, { isPrivate: !groupId })
                
                // 优先级：独立人设 > 作用域预设 > 全局默认预设
                if (effectiveSettings?.hasIndependentPrompt) {
                    systemPrompt = effectiveSettings.systemPrompt || ''
                    logger.debug(`[ChatService] 多任务: 使用独立人设`)
                } else {
                    // 获取预设ID：作用域配置 > 全局默认
                    const presetId = effectiveSettings?.presetId || config.get('llm.defaultChatPresetId') || 'default'
                    const preset = presetManager.get(presetId)
                    if (preset?.systemPrompt) {
                        systemPrompt = preset.systemPrompt
                        logger.debug(`[ChatService] 多任务: 使用预设 ${presetId}`)
                    } else {
                        // 使用预设管理器构建默认提示词
                        systemPrompt = presetManager.buildSystemPrompt(presetId, promptContext)
                        logger.debug(`[ChatService] 多任务: 使用默认预设构建`)
                    }
                }
            } else {
                // 无用户/群组信息时，使用默认预设
                const defaultPresetId = config.get('llm.defaultChatPresetId') || 'default'
                systemPrompt = presetManager.buildSystemPrompt(defaultPresetId, promptContext)
            }
            
            // 对人设进行占位符替换
            if (systemPrompt) {
                systemPrompt = presetManager.replaceVariables(systemPrompt, promptContext)
            }
            
            // 添加记忆上下文
            if (config.get('memory.enabled')) {
                try {
                    await memoryManager.init()
                    // 用户记忆
                    const memoryContext = await memoryManager.getMemoryContext(userId, originalMessage || '', {
                        event,
                        groupId,
                        includeProfile: true
                    })
                    if (memoryContext) {
                        systemPrompt += memoryContext
                        logger.debug(`[ChatService] 多任务: 已添加用户记忆 (${memoryContext.length} 字符)`)
                    }
                    // 群聊记忆
                    if (groupId && config.get('memory.groupContext.enabled')) {
                        const nickname = event?.sender?.card || event?.sender?.nickname
                        const groupMemory = await memoryManager.getGroupMemoryContext(groupId, cleanUserId, { nickname })
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
                                logger.debug(`[ChatService] 多任务: 已添加群聊记忆`)
                            }
                        }
                    }
                } catch (memErr) {
                    logger.warn(`[ChatService] 多任务: 获取记忆失败:`, memErr.message)
                }
            }
            
            // 添加知识库上下文
            try {
                const { knowledgeService } = await import('../storage/KnowledgeService.js')
                await knowledgeService.init()
                const sm = await ensureScopeManager()
                const effectiveSettings = await sm.getEffectiveSettings(groupId, userId, { isPrivate: !groupId })
                const knowledgePresetId = effectiveSettings?.presetId || config.get('llm.defaultChatPresetId') || 'default'
                const knowledgePrompt = knowledgeService.buildKnowledgePrompt(knowledgePresetId, {
                    maxLength: config.get('knowledge.maxLength') || 15000,
                    includeTriples: config.get('knowledge.includeTriples') !== false
                })
                if (knowledgePrompt) {
                    systemPrompt += '\n\n' + knowledgePrompt
                    logger.debug(`[ChatService] 多任务: 已添加知识库 (${knowledgePrompt.length} 字符)`)
                }
            } catch (knErr) {
                logger.debug('[ChatService] 多任务: 知识库未加载:', knErr.message)
            }
            
            // 添加全局系统提示词
            const globalSystemPrompt = config.get('context.globalSystemPrompt')
            const globalPromptMode = config.get('context.globalPromptMode') || 'append'
            if (globalSystemPrompt && typeof globalSystemPrompt === 'string' && globalSystemPrompt.trim()) {
                const globalPromptText = globalSystemPrompt.trim()
                if (globalPromptMode === 'prepend') {
                    systemPrompt = globalPromptText + '\n\n' + systemPrompt
                } else if (globalPromptMode === 'override') {
                    systemPrompt = globalPromptText
                } else {
                    systemPrompt += '\n\n' + globalPromptText
                }
                logger.debug(`[ChatService] 多任务: 已添加全局提示词 (模式: ${globalPromptMode})`)
            }
            
            logger.debug(`[ChatService] 多任务执行: 完整人设已构建 (${systemPrompt.length} 字符)`)
            
        } catch (err) {
            logger.warn(`[ChatService] 获取人设失败:`, err.message)
        }
        let previousResult = null
        
        // 按优先级排序任务
        const sortedTasks = [...tasks].sort((a, b) => (a.priority || 1) - (b.priority || 1))
        
        logger.info(`[ChatService] 开始执行 ${sortedTasks.length} 个任务，模式: ${executionMode}`)
        
        try {
            if (executionMode === 'parallel') {
                // 并行执行（仅对无依赖的任务）
                const independentTasks = sortedTasks.filter(t => !t.dependsOn)
                const dependentTasks = sortedTasks.filter(t => t.dependsOn)
                
                // 先并行执行无依赖任务
                if (independentTasks.length > 0) {
                    const parallelResults = await Promise.all(
                        independentTasks.map((task, idx) => 
                            this.executeSingleTask(task, { 
                                taskIndex: idx + 1,
                                originalMessage, event, images, conversationId, scopeFeatures, toolsAllowed,
                                previousResult: null,
                                systemPrompt
                            })
                        )
                    )
                    results.push(...parallelResults)
                }
                
                // 再串行执行有依赖的任务
                for (const task of dependentTasks) {
                    const depResult = results.find((r, idx) => idx + 1 === task.dependsOn)
                    const result = await this.executeSingleTask(task, {
                        taskIndex: results.length + 1,
                        originalMessage, event, images, conversationId, scopeFeatures, toolsAllowed,
                        previousResult: depResult,
                        systemPrompt
                    })
                    results.push(result)
                }
            } else {
                // 串行执行
                for (let i = 0; i < sortedTasks.length; i++) {
                    const task = sortedTasks[i]
                    const result = await this.executeSingleTask(task, {
                        taskIndex: i + 1,
                        originalMessage, event, images, conversationId, scopeFeatures, toolsAllowed,
                        previousResult,
                        systemPrompt
                    })
                    results.push(result)
                    previousResult = result
                }
            }
            
            const duration = Date.now() - startTime
            const successCount = results.filter(r => r.success).length
            
            logger.info(`[ChatService] 多任务执行完成: ${successCount}/${results.length} 成功, 耗时 ${this.formatDuration(duration)}`)

            // 合并结果
            return {
                success: successCount > 0,
                contents: results.flatMap(r => r.contents || []),
                results,
                usage: {
                    inputTokens: results.reduce((sum, r) => sum + (r.usage?.inputTokens || 0), 0),
                    outputTokens: results.reduce((sum, r) => sum + (r.usage?.outputTokens || 0), 0)
                },
                duration,
                taskCount: results.length
            }
        } catch (error) {
            logger.error(`[ChatService] 多任务执行异常:`, error)
            return {
                success: false,
                contents: [{ type: 'text', text: `任务执行失败: ${error.message}` }],
                error: error.message,
                duration: Date.now() - startTime
            }
        }
    }

    /**
     * 执行单个任务
     * 
     * @param {Object} task - 任务定义
     * @param {Object} context - 执行上下文
     * @returns {Promise<Object>} 任务结果
     */
    async executeSingleTask(task, context = {}) {
        const { taskIndex, originalMessage, event, images, conversationId, scopeFeatures, toolsAllowed, previousResult, systemPrompt } = context
        const { type, params = {} } = task
        const startTime = Date.now()
        
        logger.debug(`[ChatService] 执行任务 #${taskIndex}: type=${type}`)
        
        try {
            switch (type) {
                case 'draw': {
                    // 绘图任务 - 使用绘图模型
                    let drawPrompt = params.drawPrompt || params.prompt || ''
                    
                    // 如果依赖上一步结果，拼接描述
                    if (previousResult?.contents?.[0]?.text && drawPrompt.includes('上一步')) {
                        drawPrompt = previousResult.contents[0].text
                    }
                    
                    return await this.handleDrawTask({
                        drawPrompt,
                        originalMessage,
                        event,
                        images,
                        conversationId,
                        scopeFeatures
                    })
                }
                
                case 'image_understand': {
                    // 图像理解任务 - 使用图像理解模型
                    return await this.handleImageUnderstandTask({
                        prompt: params.prompt || '请描述这张图片的内容',
                        event,
                        images,
                        conversationId,
                        scopeFeatures,
                        systemPrompt
                    })
                }
                
                case 'tool': {
                    // 工具调用任务 - 使用工具模型
                    const toolGroups = params.toolGroups || []
                    return await this.handleToolTask({
                        toolGroups,
                        originalMessage,
                        event,
                        images,
                        conversationId,
                        scopeFeatures,
                        toolsAllowed,
                        systemPrompt
                    })
                }
                
                case 'search': {
                    // 搜索任务 - 使用搜索模型
                    return await this.handleSearchTask({
                        query: params.query || originalMessage,
                        event,
                        conversationId,
                        scopeFeatures,
                        systemPrompt
                    })
                }
                
                case 'chat':
                default: {
                    // 普通对话 - 使用对话模型
                    return await this.handleChatTask({
                        message: originalMessage,
                        event,
                        images,
                        conversationId,
                        scopeFeatures,
                        previousResult,
                        systemPrompt
                    })
                }
            }
        } catch (error) {
            logger.error(`[ChatService] 任务 #${taskIndex} 执行失败:`, error)
            return {
                success: false,
                taskType: type,
                contents: [{ type: 'text', text: `任务执行失败: ${error.message}` }],
                error: error.message,
                duration: Date.now() - startTime
            }
        }
    }

    /**
     * 处理图像理解任务
     */
    async handleImageUnderstandTask(options = {}) {
        const { prompt, event, images = [], conversationId, scopeFeatures = {}, systemPrompt } = options
        const startTime = Date.now()
        
        try {
            // 获取图像理解模型
            const imageModel = scopeFeatures.imageModel || LlmService.getImageModel() || LlmService.getDefaultModel()
            
            logger.info(`[ChatService] 图像理解任务: model=${imageModel}, 图片数=${images.length}`)
            
            // 获取对话历史以保持上下文连贯和人设一致
            let history = []
            if (conversationId) {
                try {
                    history = await contextManager.getContextHistory(conversationId, 20)
                    if (history.length > 0) {
                        logger.debug(`[ChatService] 图像任务加载历史: ${history.length} 条`)
                    }
                } catch (e) {
                    logger.debug(`[ChatService] 图像任务获取历史失败: ${e.message}`)
                }
            }
            
            // 准备图片
            const imageUrls = images.map(img => typeof img === 'string' ? img : (img.url || img.file || img)).filter(Boolean)
            
            if (imageUrls.length === 0) {
                return {
                    success: false,
                    taskType: 'image_understand',
                    contents: [{ type: 'text', text: '没有找到可分析的图片' }],
                    duration: Date.now() - startTime
                }
            }
            
            // 调用图像理解模型
            await channelManager.init()
            const channel = channelManager.getBestChannel(imageModel)
            
            if (!channel) {
                throw new Error('未找到支持图像理解模型的渠道')
            }
            
            const client = await LlmService.createClient({
                enableTools: false,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key
            })
            
            // 构建消息内容
            const content = [
                { type: 'text', text: prompt },
                ...imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
            ]
            
            const response = await client.sendMessage({
                role: 'user',
                content
            }, {
                model: imageModel,
                maxToken: 2048,
                temperature: 0.7,
                systemOverride: systemPrompt || undefined,
                messages: history,  // 传递历史上下文
                conversationId
            })
            
            const responseText = response.contents
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            const duration = Date.now() - startTime
            
            // 回复用户
            if (event?.reply && responseText) {
                await event.reply(responseText, true)
            }
            
            return {
                success: true,
                taskType: 'image_understand',
                contents: [{ type: 'text', text: responseText }],
                usage: response.usage || { inputTokens: 0, outputTokens: 0 },
                duration
            }
        } catch (error) {
            logger.error(`[ChatService] 图像理解任务失败:`, error)
            return {
                success: false,
                taskType: 'image_understand',
                contents: [{ type: 'text', text: `图像理解失败: ${error.message}` }],
                error: error.message,
                duration: Date.now() - startTime
            }
        }
    }

    /**
     * 处理工具调用任务
     */
    async handleToolTask(options = {}) {
        const { toolGroups, originalMessage, event, images = [], conversationId, scopeFeatures = {}, toolsAllowed, systemPrompt } = options
        const startTime = Date.now()
        
        try {
            // 获取工具
            const tools = await this.getToolsForGroups(toolGroups, { applyConfig: true })
            
            if (tools.length === 0) {
                return {
                    success: false,
                    taskType: 'tool',
                    contents: [{ type: 'text', text: '没有找到可用的工具' }],
                    duration: Date.now() - startTime
                }
            }
            
            // 获取工具模型：优先作用域配置 > 全局工具模型（未配置则使用默认模型）
            const toolModel = scopeFeatures.toolModel || LlmService.getToolModel()
            
            logger.info(`[ChatService] 工具调用任务: model=${toolModel}, 工具数=${tools.length}`)
            
            // 获取对话历史以保持上下文连贯
            let history = []
            if (conversationId) {
                try {
                    history = await contextManager.getContextHistory(conversationId, 20)
                    if (history.length > 0) {
                        logger.debug(`[ChatService] 工具任务加载历史: ${history.length} 条`)
                    }
                } catch (e) {
                    logger.debug(`[ChatService] 工具任务获取历史失败: ${e.message}`)
                }
            }
            
            // 调用工具模型
            await channelManager.init()
            const channel = channelManager.getBestChannel(toolModel)
            
            if (!channel) {
                throw new Error('未找到支持工具模型的渠道')
            }
            
            // 设置工具上下文
            if (event) {
                setToolContext({ event, bot: event.bot || Bot })
            }
            
            const client = await LlmService.createClient({
                enableTools: true,
                preSelectedTools: tools,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key,
                event
            })
            
            // 准备消息内容
            const content = [{ type: 'text', text: originalMessage }]
            const imageUrls = images.map(img => typeof img === 'string' ? img : (img.url || img.file || img)).filter(Boolean)
            if (imageUrls.length > 0) {
                content.push(...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })))
            }
            
            const response = await client.sendMessage({
                role: 'user',
                content
            }, {
                model: toolModel,
                maxToken: 2048,
                temperature: 0.7,
                systemOverride: systemPrompt || undefined,
                messages: history,  // 传递历史上下文
                conversationId
            })
            
            const responseText = response.contents
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            const duration = Date.now() - startTime
            
            // 回复用户
            if (event?.reply && responseText) {
                await event.reply(responseText, true)
            }
            
            return {
                success: true,
                taskType: 'tool',
                contents: response.contents || [{ type: 'text', text: responseText }],
                usage: response.usage || { inputTokens: 0, outputTokens: 0 },
                duration
            }
        } catch (error) {
            logger.error(`[ChatService] 工具调用任务失败:`, error)
            return {
                success: false,
                taskType: 'tool',
                contents: [{ type: 'text', text: `工具调用失败: ${error.message}` }],
                error: error.message,
                duration: Date.now() - startTime
            }
        }
    }

    /**
     * 处理搜索任务
     */
    async handleSearchTask(options = {}) {
        const { query, event, conversationId, scopeFeatures = {}, systemPrompt } = options
        const startTime = Date.now()
        
        try {
            // 获取搜索模型：优先作用域配置 > 全局搜索模型（未配置则使用默认模型）
            const searchModel = scopeFeatures.searchModel || LlmService.getSearchModel()
            
            logger.info(`[ChatService] 搜索任务: model=${searchModel}, query="${query.substring(0, 50)}..."`)
            
            // 获取对话历史以保持上下文连贯
            let history = []
            if (conversationId) {
                try {
                    history = await contextManager.getContextHistory(conversationId, 15)
                    if (history.length > 0) {
                        logger.debug(`[ChatService] 搜索任务加载历史: ${history.length} 条`)
                    }
                } catch (e) {
                    logger.debug(`[ChatService] 搜索任务获取历史失败: ${e.message}`)
                }
            }
            
            // 使用搜索工具组
            const searchTools = await this.getToolsForGroups([10], { applyConfig: true }) // 假设搜索工具组索引为10
            
            await channelManager.init()
            const channel = channelManager.getBestChannel(searchModel)
            
            if (!channel) {
                throw new Error('未找到支持搜索模型的渠道')
            }
            
            if (event) {
                setToolContext({ event, bot: event.bot || Bot })
            }
            
            const client = await LlmService.createClient({
                enableTools: searchTools.length > 0,
                preSelectedTools: searchTools.length > 0 ? searchTools : null,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key,
                event
            })
            
            const response = await client.sendMessage({
                role: 'user',
                content: [{ type: 'text', text: `请搜索: ${query}` }]
            }, {
                model: searchModel,
                maxToken: 2048,
                temperature: 0.7,
                systemOverride: systemPrompt || undefined,
                messages: history,  // 传递历史上下文
                conversationId
            })
            
            const responseText = response.contents
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            const duration = Date.now() - startTime
            
            if (event?.reply && responseText) {
                await event.reply(responseText, true)
            }
            
            return {
                success: true,
                taskType: 'search',
                contents: [{ type: 'text', text: responseText }],
                usage: response.usage || { inputTokens: 0, outputTokens: 0 },
                duration
            }
        } catch (error) {
            logger.error(`[ChatService] 搜索任务失败:`, error)
            return {
                success: false,
                taskType: 'search',
                contents: [{ type: 'text', text: `搜索失败: ${error.message}` }],
                error: error.message,
                duration: Date.now() - startTime
            }
        }
    }

    /**
     * 处理普通对话任务
     */
    async handleChatTask(options = {}) {
        const { message, event, images = [], conversationId, scopeFeatures = {}, previousResult, systemPrompt } = options
        const startTime = Date.now()
        
        try {
            // 获取对话模型
            const chatModel = scopeFeatures.chatModel || LlmService.getChatModel() || LlmService.getDefaultModel()
            
            logger.info(`[ChatService] 对话任务: model=${chatModel}`)
            
            // 获取对话历史以保持上下文连贯和人设一致
            let history = []
            if (conversationId) {
                try {
                    history = await contextManager.getContextHistory(conversationId, 25)
                    if (history.length > 0) {
                        logger.debug(`[ChatService] 对话任务加载历史: ${history.length} 条`)
                    }
                } catch (e) {
                    logger.debug(`[ChatService] 对话任务获取历史失败: ${e.message}`)
                }
            }
            
            await channelManager.init()
            const channel = channelManager.getBestChannel(chatModel)
            
            if (!channel) {
                throw new Error('未找到支持对话模型的渠道')
            }
            
            const client = await LlmService.createClient({
                enableTools: false,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl,
                apiKey: channelManager.getChannelKey(channel).key
            })
            
            // 如果有上一步结果，添加到消息中
            let fullMessage = message
            if (previousResult?.contents?.[0]?.text) {
                fullMessage = `${message}\n\n[上一步结果]: ${previousResult.contents[0].text}`
            }
            
            const content = [{ type: 'text', text: fullMessage }]
            const imageUrls = images.map(img => typeof img === 'string' ? img : (img.url || img.file || img)).filter(Boolean)
            if (imageUrls.length > 0) {
                content.push(...imageUrls.map(url => ({ type: 'image_url', image_url: { url } })))
            }
            
            const response = await client.sendMessage({
                role: 'user',
                content
            }, {
                model: chatModel,
                maxToken: 2048,
                temperature: 0.9,
                systemOverride: systemPrompt || undefined,
                messages: history,  // 传递历史上下文
                conversationId
            })
            
            const responseText = response.contents
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''
            
            const duration = Date.now() - startTime
            
            if (event?.reply && responseText) {
                await event.reply(responseText, true)
            }
            
            return {
                success: true,
                taskType: 'chat',
                contents: [{ type: 'text', text: responseText }],
                usage: response.usage || { inputTokens: 0, outputTokens: 0 },
                duration
            }
        } catch (error) {
            logger.error(`[ChatService] 对话任务失败:`, error)
            return {
                success: false,
                taskType: 'chat',
                contents: [{ type: 'text', text: `对话失败: ${error.message}` }],
                error: error.message,
                duration: Date.now() - startTime
            }
        }
    }

    /**
     * 格式化时长
     */
    formatDuration(ms) {
        if (ms < 1000) return `${ms}ms`
        return `${(ms / 1000).toFixed(1)}s`
    }
}

export const chatService = new ChatService()
