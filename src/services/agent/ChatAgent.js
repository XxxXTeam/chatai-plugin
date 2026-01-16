import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import { LlmService } from '../llm/LlmService.js'
import { channelManager } from '../llm/ChannelManager.js'
import { contextManager } from '../llm/ContextManager.js'
import { presetManager } from '../preset/PresetManager.js'
import { memoryManager } from '../storage/MemoryManager.js'
import { statsService } from '../stats/StatsService.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { databaseService } from '../storage/DatabaseService.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { imageService } from '../media/ImageService.js'
import { setToolContext } from '../../core/utils/toolAdapter.js'
import historyManager from '../../core/utils/history.js'
import config from '../../../config/config.js'
import { SkillsAgent } from './SkillsAgent.js'
let _scopeManager = null
async function ensureScopeManager() {
    if (!_scopeManager) {
        if (!databaseService.initialized) {
            await databaseService.init()
        }
        _scopeManager = getScopeManager(databaseService)
        await _scopeManager.init()
    }
    return _scopeManager
}

/**
 * @example
 * ```js
 * const agent = await createChatAgent({ event: e })
 * const result = await agent.chat('你好')
 *
 * const result = await chatAgent.sendMessage({
 *   userId: '123456',
 *   message: '你好',
 *   event: e
 * })
 * ```
 */
export class ChatAgent {
    constructor(options = {}) {
        this.event = options.event || null
        this.bot = options.bot || options.event?.bot || global.Bot
        this.userId = options.userId || options.event?.user_id?.toString()
        this.groupId = options.groupId || options.event?.group_id?.toString()
        this.presetId = options.presetId || null
        this.model = options.model || null
        this.enableSkills = options.enableSkills !== false
        this.stream = options.stream || false
        this.debugMode = options.debugMode || false

        this.skillsAgent = null
        this.conversationId = null
        this.initialized = false
    }

    /**
     * 初始化代理
     */
    async init() {
        if (this.initialized) return this

        await contextManager.init()
        await presetManager.init()
        await channelManager.init()
        await mcpManager.init()

        // 确定会话ID
        const cleanUserId = this.userId?.includes('_') ? this.userId.split('_').pop() : this.userId

        this.conversationId = this.groupId
            ? `group:${this.groupId}`
            : contextManager.getConversationId(cleanUserId, null)

        // 初始化技能代理
        if (this.enableSkills) {
            this.skillsAgent = new SkillsAgent({
                event: this.event,
                bot: this.bot,
                userId: this.userId,
                groupId: this.groupId
            })
            await this.skillsAgent.init()
        }

        this.initialized = true
        return this
    }

    /**
     * 发送消息
     *
     * @param {Object} options - 消息选项
     * @returns {Promise<Object>} 响应结果
     */
    async sendMessage(options) {
        try {
            return await this._sendMessageImpl(options)
        } catch (error) {
            // 错误时自动清理
            const autoCleanConfig = config.get('features.autoCleanOnError')
            if (autoCleanConfig?.enabled === true) {
                await this._handleAutoClean(options, error)
            }
            throw error
        }
    }

    /**
     * 简化的对话方法
     */
    async chat(input, options = {}) {
        if (!this.initialized) await this.init()

        const message = typeof input === 'string' ? input : input.text || ''
        const images = input.images || options.images || []

        return await this.sendMessage({
            userId: this.userId,
            groupId: this.groupId,
            message,
            images,
            event: this.event,
            model: options.model || this.model,
            presetId: options.presetId || this.presetId,
            debugMode: options.debugMode || this.debugMode,
            stream: options.stream || this.stream,
            disableTools: !this.enableSkills,
            ...options
        })
    }

    /**
     * sendMessage 核心实现
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
            event,
            mode = 'chat',
            debugMode = false,
            prefixPersona = null,
            disableTools = false,
            skipHistory = false,
            skipPersona = false,
            temperature: overrideTemperature,
            maxTokens: overrideMaxTokens
        } = options

        // 调试信息
        const debugInfo = debugMode
            ? {
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
              }
            : null

        if (!userId) {
            throw new Error('userId is required')
        }

        // 初始化服务
        await contextManager.init()
        await mcpManager.init()

        const groupId = options.groupId || event?.group_id || null
        const pureUserId = (event?.user_id || userId)?.toString()
        const cleanUserId = pureUserId?.includes('_') ? pureUserId.split('_').pop() : pureUserId

        // 确定会话ID
        let conversationId
        if (groupId) {
            conversationId = `group:${groupId}`
        } else {
            conversationId = contextManager.getConversationId(cleanUserId, null)
        }

        // 构建消息内容
        const messageContent = await this._buildMessageContent(message, images)

        const userMessage = {
            role: 'user',
            content: messageContent,
            sender: event?.sender
                ? {
                      user_id: event.user_id || event.sender.user_id,
                      nickname: event.sender.nickname || '用户',
                      card: event.sender.card || '',
                      role: event.sender.role || 'member'
                  }
                : { user_id: userId, nickname: '用户', card: '', role: 'member' },
            timestamp: Date.now(),
            source_type: groupId ? 'group' : 'private',
            ...(groupId && { group_id: groupId })
        }

        // 获取历史记录
        const historyLimit = config.get('context.autoContext.maxHistoryMessages') || 30
        let history = skipHistory ? [] : await contextManager.getContextHistory(conversationId, historyLimit)

        // 检查是否是结束对话后的新会话，如果是则清空历史（防止旧上下文传递）
        if (presetManager.isContextCleared(conversationId)) {
            history = []
            logger.debug(`[ChatAgent] 检测到结束对话标记，清空历史上下文: ${conversationId}`)
        }

        // 获取作用域配置
        const scopeConfig = await this._getScopeConfig(groupId, cleanUserId, event)
        const { scopePresetId, scopeModelId, scopeFeatures } = scopeConfig

        // 确定预设
        await presetManager.init()
        const effectivePresetId =
            presetId || preset?.id || scopePresetId || config.get('llm.defaultChatPresetId') || 'default'
        const currentPreset = preset || presetManager.get(effectivePresetId)

        // 确定是否启用工具
        const presetEnableTools = currentPreset?.tools?.enableBuiltinTools !== false
        const scopeToolsEnabled = scopeFeatures.toolsEnabled !== false
        const toolsAllowed = !disableTools && presetEnableTools && scopeToolsEnabled

        // 加载工具
        let allTools = []
        if (toolsAllowed && this.skillsAgent) {
            allTools = this.skillsAgent.getExecutableSkills()
            logger.debug(`[ChatAgent] 加载技能: ${allTools.length}个`)
        }

        // 确定模型
        let llmModel = model || scopeFeatures.chatModel || scopeModelId || LlmService.getModel()
        if (!model && currentPreset?.model?.trim()) {
            llmModel = currentPreset.model.trim()
        }

        if (!llmModel) {
            throw new Error('未配置模型')
        }

        // 设置工具上下文
        if (event) {
            setToolContext({ event, bot: event.bot || Bot })
        }

        // 获取渠道
        await channelManager.init()
        const channel = channelManager.getBestChannel(llmModel)

        // 收集渠道调试信息
        if (debugInfo && channel) {
            debugInfo.channel = {
                id: channel.id,
                name: channel.name,
                adapterType: channel.adapterType,
                baseUrl: channel.baseUrl
            }
        }

        // 构建系统提示
        let systemPrompt = await this._buildSystemPrompt({
            event,
            userId,
            groupId,
            cleanUserId,
            preset: currentPreset,
            presetId: effectivePresetId,
            prefixPersona,
            skipPersona,
            debugInfo
        })

        // 添加记忆上下文
        if (config.get('memory.enabled') && !skipPersona) {
            systemPrompt = await this._addMemoryContext(
                systemPrompt,
                userId,
                message,
                event,
                groupId,
                cleanUserId,
                debugInfo
            )
        }

        // 添加知识库上下文
        systemPrompt = await this._addKnowledgeContext(
            systemPrompt,
            prefixPersona ? prefixPersona : effectivePresetId,
            debugInfo
        )

        // 添加群聊环境信息
        if (groupId) {
            systemPrompt = this._addGroupContext(systemPrompt, groupId, event, userId)
        }

        // 过滤历史
        let validHistory = history.filter(msg => {
            if (msg.role === 'assistant') {
                if (!msg.content || msg.content.length === 0) return false
                if (Array.isArray(msg.content) && msg.content.every(c => !c.text?.trim())) return false
            }
            return true
        })

        // 构建消息列表
        let messages = []
        if (systemPrompt?.trim()) {
            messages.push({ role: 'system', content: [{ type: 'text', text: systemPrompt }] })
        }
        messages.push(...validHistory, userMessage)

        // 创建客户端
        const clientOptions = await this._buildClientOptions({
            model: llmModel,
            channel,
            adapterType,
            event,
            presetId: effectivePresetId,
            tools: allTools,
            preset: currentPreset
        })

        const client = await LlmService.createClient(clientOptions)

        // 请求参数
        const channelAdvanced = channel?.advanced || {}
        const channelLlm = channelAdvanced.llm || {}
        const channelStreaming = channelAdvanced.streaming || {}
        const presetParams = currentPreset?.modelParams || {}

        // 应用模型映射/重定向
        const modelMapping = channel
            ? channelManager.getActualModel(channel.id, llmModel)
            : { actualModel: llmModel, mapped: false }
        const actualModel = modelMapping.actualModel
        if (modelMapping.mapped) {
            logger.info(`[ChatAgent] 模型重定向: ${llmModel} -> ${actualModel} (渠道: ${channel?.name})`)
        }

        const requestOptions = {
            model: actualModel,
            maxToken: overrideMaxTokens ?? presetParams.max_tokens ?? channelLlm.maxTokens ?? 4000,
            temperature: overrideTemperature ?? presetParams.temperature ?? channelLlm.temperature ?? 0.7,
            topP: presetParams.top_p ?? channelLlm.topP,
            conversationId,
            systemOverride: systemPrompt,
            stream: stream || channelStreaming.enabled === true,
            disableHistoryRead: skipHistory
        }

        logger.info(`[ChatAgent] 模型: ${llmModel}, 工具: ${allTools.length}个`)

        // 发送请求（带回退）
        const requestStartTime = Date.now()
        let response, finalUsage, allToolLogs, lastError

        try {
            const result = await this._sendWithFallback(client, userMessage, requestOptions, {
                channel,
                clientOptions,
                llmModel,
                debugInfo
            })

            response = result.response
            finalUsage = result.usage
            allToolLogs = result.toolLogs || []
        } catch (error) {
            lastError = error
            throw error
        } finally {
            // 记录统计
            await this._recordStats({
                channel,
                llmModel,
                requestStartTime,
                response,
                finalUsage,
                lastError,
                userId,
                groupId,
                stream: requestOptions.stream,
                debugInfo,
                messages,
                systemPrompt,
                client
            })
        }

        // 更新上下文
        if (response?.length > 0) {
            const textContent = response
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n')
            if (textContent.length > 50) {
                await contextManager.updateContext(conversationId, {
                    lastInteraction: Date.now(),
                    recentTopics: [message?.substring(0, 100)]
                })
            }

            // 自动记忆提取
            if (config.get('memory.enabled') && config.get('memory.autoExtract') !== false) {
                memoryManager
                    .extractMemoryFromConversation(userId, message, textContent)
                    .catch(err => logger.warn('[ChatAgent] 自动记忆提取失败:', err.message))
            }
        }

        // 收集调试信息
        if (debugInfo) {
            debugInfo.timing.end = Date.now()
            debugInfo.timing.duration = debugInfo.timing.end - debugInfo.timing.start
            debugInfo.response = {
                contentsCount: response?.length || 0,
                toolCallLogsCount: allToolLogs?.length || 0
            }
        }

        return {
            conversationId,
            response: response || [],
            usage: finalUsage || {},
            model: llmModel,
            toolCallLogs: allToolLogs || [],
            debugInfo
        }
    }

    /**
     * 构建消息内容
     */
    async _buildMessageContent(message, images) {
        const content = []

        if (message) {
            content.push({ type: 'text', text: message })
        }

        for (const imageRef of images) {
            try {
                if (imageRef && typeof imageRef === 'object') {
                    if (imageRef.type === 'image_url' && imageRef.image_url?.url) {
                        content.push({ type: 'image_url', image_url: { url: imageRef.image_url.url } })
                        continue
                    } else if (imageRef.type === 'url' && imageRef.url) {
                        content.push({ type: 'image_url', image_url: { url: imageRef.url } })
                        continue
                    }
                }

                if (typeof imageRef === 'string') {
                    if (
                        imageRef.startsWith('http://') ||
                        imageRef.startsWith('https://') ||
                        imageRef.startsWith('data:')
                    ) {
                        content.push({ type: 'image_url', image_url: { url: imageRef } })
                        continue
                    }

                    if (imageRef.length === 32 && !/[:/]/.test(imageRef)) {
                        const base64Image = await imageService.getImageBase64(imageRef, 'jpeg')
                        if (base64Image) {
                            content.push({ type: 'image_url', image_url: { url: base64Image } })
                        }
                        continue
                    }
                }
            } catch (error) {
                logger.warn('[ChatAgent] 处理图片失败:', error.message)
            }
        }

        return content
    }

    /**
     * 获取作用域配置
     */
    async _getScopeConfig(groupId, cleanUserId, event) {
        let scopePresetId = null
        let scopeModelId = null
        let scopeFeatures = {}

        try {
            const sm = await ensureScopeManager()
            const isPrivate = !groupId
            const effectiveSettings = await sm.getEffectiveSettings(groupId ? String(groupId) : null, cleanUserId, {
                isPrivate
            })

            if (effectiveSettings?.presetId) {
                scopePresetId = effectiveSettings.presetId
            }
            if (effectiveSettings?.modelId) {
                scopeModelId = effectiveSettings.modelId
            }
            if (effectiveSettings?.features) {
                scopeFeatures = effectiveSettings.features
            }
        } catch (e) {
            logger.debug('[ChatAgent] 获取作用域配置失败:', e.message)
        }

        return { scopePresetId, scopeModelId, scopeFeatures }
    }

    /**
     * 构建系统提示
     */
    async _buildSystemPrompt(options) {
        const { event, userId, groupId, cleanUserId, preset, presetId, prefixPersona, skipPersona, debugInfo } = options

        const promptContext = {}
        if (event) {
            promptContext.user_name = event.sender?.card || event.sender?.nickname || '用户'
            promptContext.user_id = event.user_id?.toString() || userId
            promptContext.group_name = event.group_name || ''
            promptContext.group_id = event.group_id?.toString() || ''
            promptContext.bot_name = event.bot?.nickname || 'AI助手'
        }

        let systemPrompt = preset?.systemPrompt
            ? presetManager.replaceVariables(preset.systemPrompt, promptContext)
            : presetManager.buildSystemPrompt(presetId, promptContext)

        if (skipPersona) {
            return ''
        }

        // 获取独立人设
        try {
            const sm = await ensureScopeManager()
            const independentResult = await sm.getIndependentPrompt(
                groupId ? String(groupId) : null,
                cleanUserId,
                systemPrompt
            )
            systemPrompt = independentResult.prompt

            if (debugInfo) {
                debugInfo.scope = {
                    isIndependent: independentResult.isIndependent,
                    promptSource: independentResult.source
                }
            }
        } catch (e) {
            logger.debug('[ChatAgent] 获取独立人设失败:', e.message)
        }

        // 处理前缀人格
        if (prefixPersona) {
            const prefixPreset = presetManager.get(prefixPersona)
            if (prefixPreset?.systemPrompt) {
                systemPrompt = prefixPreset.systemPrompt
            } else {
                systemPrompt = prefixPersona + (systemPrompt ? '\n\n' + systemPrompt : '')
            }
        }

        return systemPrompt
    }

    /**
     * 添加记忆上下文
     */
    async _addMemoryContext(systemPrompt, userId, message, event, groupId, cleanUserId, debugInfo) {
        try {
            await memoryManager.init()
            const memoryContext = await memoryManager.getMemoryContext(userId, message || '', {
                event,
                groupId: groupId ? String(groupId) : null,
                includeProfile: true
            })

            if (memoryContext) {
                systemPrompt += memoryContext
                if (debugInfo) {
                    debugInfo.memory.userMemory = { hasMemory: true, length: memoryContext.length }
                }
            }

            // 群聊记忆
            if (groupId && config.get('memory.groupContext.enabled')) {
                const nickname = event?.sender?.card || event?.sender?.nickname
                const groupMemory = await memoryManager.getGroupMemoryContext(String(groupId), cleanUserId, {
                    nickname
                })
                if (groupMemory) {
                    const parts = []
                    if (groupMemory.userInfo?.length > 0) parts.push(`群成员信息：${groupMemory.userInfo.join('；')}`)
                    if (groupMemory.topics?.length > 0) parts.push(`最近话题：${groupMemory.topics.join('；')}`)
                    if (parts.length > 0) {
                        systemPrompt += `\n【群聊记忆】\n${parts.join('\n')}\n`
                    }
                }
            }
        } catch (err) {
            logger.debug('[ChatAgent] 获取记忆上下文失败:', err.message)
        }

        return systemPrompt
    }

    /**
     * 添加知识库上下文
     */
    async _addKnowledgeContext(systemPrompt, presetId, debugInfo) {
        try {
            const { knowledgeService } = await import('../storage/KnowledgeService.js')
            await knowledgeService.init()

            const knowledgePrompt = knowledgeService.buildKnowledgePrompt(presetId, {
                maxLength: config.get('knowledge.maxLength') || 15000
            })

            if (knowledgePrompt) {
                systemPrompt += '\n\n' + knowledgePrompt
                if (debugInfo) {
                    debugInfo.knowledge = { hasKnowledge: true, length: knowledgePrompt.length }
                }
            }
        } catch (err) {
            logger.debug('[ChatAgent] 知识库服务未加载:', err.message)
        }

        return systemPrompt
    }

    /**
     * 添加群聊上下文
     */
    _addGroupContext(systemPrompt, groupId, event, userId) {
        const userLabel = event?.sender?.card || event?.sender?.nickname || `用户${userId}`
        const userUin = event?.user_id || userId
        const groupName = event?.group_name || ''

        systemPrompt += `\n\n[当前对话环境]
群号: ${groupId}${groupName ? `\n群名: ${groupName}` : ''}
当前用户: ${userLabel}(QQ:${userUin})`

        return systemPrompt
    }

    /**
     * 构建客户端选项
     */
    async _buildClientOptions(options) {
        const { model, channel, adapterType, event, presetId, tools, preset } = options

        const clientOptions = {
            enableTools: tools?.length > 0,
            preSelectedTools: tools?.length > 0 ? tools : null,
            event,
            presetId,
            userPermission: event?.sender?.role || 'member'
        }

        if (channel) {
            clientOptions.adapterType = channel.adapterType
            clientOptions.baseUrl = channel.baseUrl
            const keyInfo = channelManager.getChannelKey(channel)
            clientOptions.apiKey = keyInfo.key
            clientOptions.keyIndex = keyInfo.keyIndex
            clientOptions.channelName = channel.name

            // 传递自定义路径配置
            if (channel.chatPath) {
                clientOptions.chatPath = channel.chatPath
            }
            if (channel.modelsPath) {
                clientOptions.modelsPath = channel.modelsPath
            }
            if (channel.customHeaders) {
                clientOptions.customHeaders = channel.customHeaders
            }
        }

        const channelAdvanced = channel?.advanced || {}
        if (channelAdvanced.thinking) {
            clientOptions.enableReasoning = preset?.enableReasoning ?? channelAdvanced.thinking.enableReasoning
            clientOptions.reasoningEffort = channelAdvanced.thinking.defaultLevel || 'low'
        }

        return clientOptions
    }

    /**
     * 发送请求（带回退）
     */
    async _sendWithFallback(client, userMessage, requestOptions, context) {
        const { channel, clientOptions, llmModel, debugInfo } = context

        const fallbackConfig = config.get('llm.fallback') || {}
        const fallbackEnabled = fallbackConfig.enabled !== false
        const fallbackModels = fallbackConfig.models || []
        const maxRetries = fallbackConfig.maxRetries || 3

        const modelsToTry = [llmModel, ...fallbackModels.filter(m => m && m !== llmModel)]

        let response = null
        let lastError = null

        for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
            const currentModel = modelsToTry[modelIndex]
            let retryCount = 0
            let currentClient = client

            // 备选模型时获取新渠道
            if (modelIndex > 0) {
                const newChannel = channelManager.getBestChannel(currentModel)
                if (newChannel) {
                    const keyInfo = channelManager.getChannelKey(newChannel)
                    const newClientOptions = {
                        ...clientOptions,
                        adapterType: newChannel.adapterType,
                        baseUrl: newChannel.baseUrl,
                        apiKey: keyInfo.key
                    }
                    currentClient = await LlmService.createClient(newClientOptions)
                }
            }

            while (retryCount <= maxRetries) {
                try {
                    // 应用模型映射
                    const currentChannel = modelIndex > 0 ? channelManager.getBestChannel(currentModel) : channel
                    const mapping = currentChannel
                        ? channelManager.getActualModel(currentChannel.id, currentModel)
                        : { actualModel: currentModel }
                    const currentRequestOptions = { ...requestOptions, model: mapping.actualModel }
                    response = await currentClient.sendMessage(userMessage, currentRequestOptions)

                    if (response?.contents?.length > 0 || response?.toolCallLogs?.length > 0) {
                        if (modelIndex > 0) {
                            logger.info(`[ChatAgent] 使用备选模型成功: ${currentModel}`)
                        }

                        return {
                            response: response.contents || [],
                            usage: response.usage || {},
                            toolLogs: response.toolCallLogs || []
                        }
                    }

                    retryCount++
                } catch (error) {
                    lastError = error
                    logger.error(`[ChatAgent] 模型 ${currentModel} 请求失败:`, error.message)
                    retryCount++

                    if (retryCount <= maxRetries) {
                        await new Promise(r => setTimeout(r, 500 * retryCount))
                    }
                }
            }

            if (!fallbackEnabled) break
        }

        if (lastError) throw lastError

        return { response: [], usage: {}, toolLogs: [] }
    }

    /**
     * 记录统计
     */
    async _recordStats(options) {
        const {
            channel,
            llmModel,
            requestStartTime,
            response,
            finalUsage,
            lastError,
            userId,
            groupId,
            stream,
            debugInfo,
            messages,
            systemPrompt,
            client
        } = options

        try {
            if (channel) {
                channelManager.endRequest(channel.id)
                if (finalUsage) {
                    channelManager.reportUsage(channel.id, finalUsage.totalTokens || 0)
                }
                if (response?.length > 0) {
                    channelManager.reportSuccess(channel.id)
                }
            }

            const requestDuration = Date.now() - requestStartTime
            const responseText =
                response
                    ?.filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('') || ''

            await statsService.recordApiCall({
                channelId: channel?.id || `no-channel-${llmModel}`,
                channelName: channel?.name || `无渠道(${llmModel})`,
                model: llmModel,
                duration: requestDuration,
                success: !!response?.length,
                error: !response?.length ? lastError?.message : null,
                source: 'chat',
                userId,
                groupId: groupId || null,
                stream,
                apiUsage: finalUsage,
                responseText
            })
        } catch (e) {
            logger.debug('[ChatAgent] 记录统计失败:', e.message)
        }
    }

    /**
     * 自动清理处理
     */
    async _handleAutoClean(options, error) {
        try {
            const fullUserId = String(options.userId)
            const pureUserId = fullUserId.includes('_') ? fullUserId.split('_').pop() : fullUserId
            const groupId = options.event?.group_id ? String(options.event.group_id) : null

            const currentConversationId = contextManager.getConversationId(pureUserId, groupId)
            await historyManager.deleteConversation(currentConversationId)
            await contextManager.cleanContext(currentConversationId)

            logger.debug(`[ChatAgent] 自动清理完成: ${currentConversationId}`)

            const autoCleanConfig = config.get('features.autoCleanOnError')
            if (autoCleanConfig?.notifyUser !== false && options.event?.reply) {
                await options.event.reply('历史对话已自动清理', true)
            }
        } catch (clearErr) {
            logger.error('[ChatAgent] 自动清理失败:', clearErr.message)
        }
    }

    /**
     * 清除对话历史
     */
    async clearHistory() {
        if (!this.initialized) await this.init()
        await historyManager.deleteConversation(this.conversationId)
        await contextManager.cleanContext(this.conversationId)
        presetManager.markContextCleared(this.conversationId)
        logger.info(`[ChatAgent] 已清除对话历史: ${this.conversationId}`)
    }

    /**
     * 获取对话历史
     */
    async getHistory(limit = 50) {
        if (!this.initialized) await this.init()
        return await contextManager.getContextHistory(this.conversationId, limit)
    }

    /**
     * 执行技能
     */
    async executeSkill(skillName, args = {}) {
        if (!this.skillsAgent) {
            throw new Error('技能代理未启用')
        }
        return await this.skillsAgent.execute(skillName, args)
    }

    /**
     * 获取可用技能列表
     */
    getAvailableSkills() {
        if (!this.skillsAgent) return []
        return Array.from(this.skillsAgent.skills.keys())
    }
}

// 单例实例
export const chatAgent = new ChatAgent()

/**
 * 创建 ChatAgent 实例
 */
export async function createChatAgent(options = {}) {
    const agent = new ChatAgent(options)
    await agent.init()
    return agent
}

/**
 * 快捷对话方法
 */
export async function quickChat(message, options = {}) {
    const agent = await createChatAgent(options)
    return await agent.chat(message, options)
}

export default ChatAgent
