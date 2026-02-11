import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import { LlmService } from '../llm/LlmService.js'
import { channelManager } from '../llm/ChannelManager.js'
import { contextManager } from '../llm/ContextManager.js'
import { presetManager } from '../preset/PresetManager.js'
import { memoryManager } from '../storage/MemoryManager.js'
import { memoryService } from '../memory/MemoryService.js'
import { statsService } from '../stats/StatsService.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { databaseService } from '../storage/DatabaseService.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { imageService } from '../media/ImageService.js'
import { setToolContext } from '../../core/utils/toolAdapter.js'
import historyManager from '../../core/utils/history.js'
import config from '../../../config/config.js'
import { SkillsAgent, convertMcpTools } from './SkillsAgent.js'
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

        // 加载工具（支持 ToolGroupManager 分组调度）
        let allTools = []
        if (toolsAllowed && this.skillsAgent) {
            // 从 SkillsConfig 获取 dispatch 配置（优先），回退到 config.get
            const dispatchConfig = this._getDispatchConfig()
            const dispatchEnabled = dispatchConfig.enabled === true

            if (dispatchEnabled && typeof message === 'string') {
                // 使用 ToolGroupManager 分组调度
                allTools = await this._dispatchTools(message, event, dispatchConfig)
            }

            // 回退：调度未启用或调度返回空 -> 使用全量工具
            if (allTools.length === 0 && !dispatchEnabled) {
                allTools = this.skillsAgent.getExecutableSkills()
            }
            logger.debug(`[ChatAgent] 加载技能: ${allTools.length}个${dispatchEnabled ? ' (调度模式)' : ''}`)
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

        // 添加工具能力提示词（当有工具可用时）
        if (allTools.length > 0) {
            systemPrompt = this._addToolPrompt(systemPrompt, allTools)
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

        // 给工具注入 skills 分组标签，让模型从 description 识别工具类别
        const taggedTools = this._tagToolsWithSkillGroup(allTools)

        // 创建客户端
        const clientOptions = await this._buildClientOptions({
            model: llmModel,
            channel,
            adapterType,
            event,
            presetId: effectivePresetId,
            tools: taggedTools,
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
                    }
                    if (imageRef.type === 'url' && imageRef.url) {
                        content.push({ type: 'image_url', image_url: { url: imageRef.url } })
                        continue
                    }
                    if (imageRef.type === 'image' && imageRef.image) {
                        const mimeType = imageRef.mimeType || 'image/jpeg'
                        const base64Data = imageRef.image.startsWith('data:')
                            ? imageRef.image
                            : `data:${mimeType};base64,${imageRef.image}`
                        content.push({ type: 'image_url', image_url: { url: base64Data } })
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
     * 获取 dispatch 配置（从 SkillsConfig 优先，回退到 config.get）
     * @returns {{ enabled: boolean, useSummary: boolean, maxGroups: number }}
     */
    _getDispatchConfig() {
        try {
            const skillsConfig = global.chatAiSkillsConfig
            if (skillsConfig?.getDispatchConfig) {
                return skillsConfig.getDispatchConfig()
            }
        } catch {}
        // 回退：从旧的 config.get 路径读取
        return {
            enabled: config.get('skills.dispatch.enabled') === true,
            useSummary: config.get('skills.dispatch.useSummary') !== false,
            maxGroups: config.get('skills.dispatch.maxGroups') || 3
        }
    }

    /**
     * 使用 ToolGroupManager 进行工具分组调度
     * 先用轻量模型判断需要哪些工具组，再只加载相关工具
     * @param {string} message - 用户消息
     * @param {Object} event - 事件对象
     * @param {Object} dispatchConfig - 调度配置
     * @returns {Array} 调度后的工具列表
     */
    async _dispatchTools(message, event, dispatchConfig = {}) {
        try {
            const { toolGroupManager } = await import('../tools/ToolGroupManager.js')
            await toolGroupManager.init()

            const { useSummary = true, maxGroups = 3 } = dispatchConfig

            // 快速意图检测 - 纯闲聊不需要工具
            if (!toolGroupManager.detectToolIntent(message)) {
                logger.debug('[ChatAgent] 调度: 无工具意图，跳过工具加载')
                return []
            }

            // 构建调度提示词（根据 useSummary 决定是否使用摘要模式）
            const dispatchPrompt = useSummary
                ? toolGroupManager.buildDispatchPrompt()
                : this._buildFullDispatchPrompt(toolGroupManager)

            // 用轻量模型做调度判断
            const dispatchModel =
                config.get('llm.models.dispatch') || config.get('llm.defaultModel') || LlmService.getModel()
            const client = await LlmService.getChatClient({
                model: dispatchModel,
                enableTools: false
            })

            const dispatchMessages = [
                { role: 'system', content: dispatchPrompt },
                { role: 'user', content: message }
            ]

            const response = await client.sendMessageWithHistory(dispatchMessages, {
                model: dispatchModel,
                temperature: 0.1,
                maxTokens: 500
            })

            // 解析响应
            const contentArray = Array.isArray(response?.content) ? response.content : []
            const responseText =
                contentArray
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('') || ''

            const dispatchResult = toolGroupManager.parseDispatchResponseV2(responseText, message)
            logger.debug(
                `[ChatAgent] 调度结果: 分析="${dispatchResult.analysis}", 工具组=[${dispatchResult.toolGroups.join(',')}]`
            )

            if (dispatchResult.toolGroups.length > 0) {
                // 应用 maxGroups 限制
                let selectedGroups = dispatchResult.toolGroups
                if (maxGroups > 0 && selectedGroups.length > maxGroups) {
                    logger.debug(`[ChatAgent] 工具组数 ${selectedGroups.length} 超过限制 ${maxGroups}，截断`)
                    selectedGroups = selectedGroups.slice(0, maxGroups)
                }

                // 按组获取工具，传入用户权限做组级权限检查
                const userPermission = event?.sender?.role || 'member'
                const groupTools = await toolGroupManager.getToolsByGroupIndexes(selectedGroups, { userPermission })
                if (groupTools.length > 0) {
                    // 包装为可执行格式（与 getExecutableSkills 一致）
                    const executableTools = convertMcpTools(groupTools, {
                        event: this.event,
                        bot: this.bot
                    })
                    logger.info(
                        `[ChatAgent] 调度成功: ${executableTools.length} 个工具（组: ${selectedGroups.join(',')}，限制: ${maxGroups}）`
                    )
                    return executableTools
                }
            }

            // 调度判断为chat类型 或 工具组为空 -> 不传工具
            const hasChatTask = dispatchResult.tasks.some(t => t.type === 'chat')
            if (hasChatTask && dispatchResult.toolGroups.length === 0) {
                return []
            }

            // 回退：加载全量工具
            logger.debug('[ChatAgent] 调度回退: 使用全量工具')
            return this.skillsAgent ? this.skillsAgent.getExecutableSkills() : []
        } catch (err) {
            logger.warn(`[ChatAgent] 工具调度失败，回退到全量: ${err.message}`)
            return this.skillsAgent ? this.skillsAgent.getExecutableSkills() : []
        }
    }

    /**
     * 构建完整模式的调度提示词（useSummary=false 时使用，列出每个工具的详细信息）
     */
    _buildFullDispatchPrompt(toolGroupManager) {
        const summary = toolGroupManager.getGroupSummary()
        let prompt = `你是智能任务调度器。分析用户请求，选择需要的工具组。

## 可用工具组（含详细工具列表）：
`
        for (const group of summary) {
            const displayName = group.displayName || group.name
            prompt += `\n[${group.index}] ${displayName} (${group.toolCount}个工具): ${group.description}\n`
        }

        prompt += `
## 返回格式（JSON）：
{"analysis": "意图分析", "tasks": [{"type": "tool", "priority": 1, "params": {"toolGroups": [索引]}}], "executionMode": "sequential"}

用户纯闲聊返回: {"analysis": "闲聊", "tasks": [{"type": "chat", "priority": 1, "params": {}}], "executionMode": "sequential"}
只返回JSON。`
        return prompt
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
            // 优先使用新的结构化记忆服务
            const structuredMemoryContext = await memoryService.buildMemoryContext(cleanUserId, {
                groupId: groupId ? String(groupId) : null,
                maxItems: 15
            })

            if (structuredMemoryContext) {
                systemPrompt += structuredMemoryContext
                if (debugInfo) {
                    debugInfo.memory = debugInfo.memory || {}
                    debugInfo.memory.structuredMemory = { hasMemory: true, length: structuredMemoryContext.length }
                }
            } else {
                // 回退到旧的记忆管理器
                await memoryManager.init()
                const memoryContext = await memoryManager.getMemoryContext(userId, message || '', {
                    event,
                    groupId: groupId ? String(groupId) : null,
                    includeProfile: true
                })

                if (memoryContext) {
                    systemPrompt += memoryContext
                    if (debugInfo) {
                        debugInfo.memory = debugInfo.memory || {}
                        debugInfo.memory.userMemory = { hasMemory: true, length: memoryContext.length }
                    }
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
                        systemPrompt += '\n【群聊记忆】\n' + parts.join('\n') + '\n'
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
     * 添加工具能力提示词到 system prompt
     * 从 skills.yaml 分组读取，让模型按技能组发现和选择工具
     */
    _addToolPrompt(systemPrompt, tools) {
        if (!tools || tools.length === 0) return systemPrompt

        // 收集当前可用工具名集合（用于过滤）
        const availableNames = new Set()
        for (const tool of tools) {
            const name = tool.name || tool.function?.name || ''
            if (name) availableNames.add(name)
        }

        // 尝试从 skills.yaml 分组构建结构化提示
        const groupPrompt = this._buildSkillsGroupPrompt(availableNames)

        if (groupPrompt) {
            systemPrompt += `\n\n【可用技能】\n你拥有 ${tools.length} 个工具，按功能分组如下：\n${groupPrompt}\n需要时调用对应工具。优先直接回答，仅在必要时调用工具。`
        } else {
            // 回退：无分组信息时用简洁汇总
            systemPrompt += `\n\n【可用工具能力】\n你拥有 ${tools.length} 个工具可调用。需要时调用工具获取信息或执行操作。优先直接回答，仅在必要时调用工具。`
        }

        return systemPrompt
    }

    /**
     * 从 skills.yaml 分组构建结构化技能提示词
     * 让模型看到按组织好的技能目录，便于发现和选用
     * @param {Set<string>} availableNames - 当前可用的工具名集合
     * @returns {string|null} 分组提示词，或 null
     */
    _buildSkillsGroupPrompt(availableNames) {
        try {
            const skillsConfig = global.chatAiSkillsConfig
            if (!skillsConfig?.getEnabledGroups) return null

            const groups = skillsConfig.getEnabledGroups()
            if (!groups || groups.length === 0) return null

            const lines = []
            for (const group of groups) {
                if (!group.tools || group.tools.length === 0) continue

                // 只展示当前实际可用的工具
                const activeTools = group.tools.filter(t => availableNames.has(t))
                if (activeTools.length === 0) continue

                // 取分组描述的简短形式（冒号前部分）
                const label = group.description ? group.description.split('：')[0].split(':')[0] : group.name

                // 列出组内工具名（最多8个，超出用省略号）
                let toolList
                if (activeTools.length <= 8) {
                    toolList = activeTools.join(', ')
                } else {
                    toolList = activeTools.slice(0, 8).join(', ') + ` 等${activeTools.length}个`
                }

                lines.push(`• ${label} (${activeTools.length}): ${toolList}`)
            }

            return lines.length > 0 ? lines.join('\n') : null
        } catch (err) {
            logger.debug(`[ChatAgent] 构建技能分组提示失败: ${err.message}`)
            return null
        }
    }

    /**
     * 给工具的 description 注入 skills 分组标签
     * 模型会看到 "[消息操作] 发送私聊消息" 而非仅 "发送私聊消息"
     * @param {Array} tools - 工具列表 [{function: {name, description, parameters}, run}]
     * @returns {Array} 标签注入后的工具列表（浅拷贝，不修改原始对象）
     */
    _tagToolsWithSkillGroup(tools) {
        if (!tools || tools.length === 0) return tools

        try {
            const skillsConfig = global.chatAiSkillsConfig
            if (!skillsConfig?.getEnabledGroups) return tools

            const groups = skillsConfig.getEnabledGroups()
            if (!groups || groups.length === 0) return tools

            // 构建 toolName → groupLabel 映射
            const toolGroupMap = new Map()
            for (const group of groups) {
                if (!group.tools || group.tools.length === 0) continue
                const label = group.description ? group.description.split('：')[0].split(':')[0] : group.name
                for (const toolName of group.tools) {
                    if (!toolGroupMap.has(toolName)) {
                        toolGroupMap.set(toolName, label)
                    }
                }
            }

            if (toolGroupMap.size === 0) return tools

            // 浅拷贝工具，给 description 加分组前缀
            return tools.map(tool => {
                const name = tool.name || tool.function?.name
                if (!name) return tool

                const groupLabel = toolGroupMap.get(name)
                if (!groupLabel) return tool

                const origDesc = tool.function?.description || ''
                // 避免重复标签
                if (origDesc.startsWith(`[${groupLabel}]`)) return tool

                return {
                    ...tool,
                    function: {
                        ...tool.function,
                        description: `[${groupLabel}] ${origDesc}`
                    }
                }
            })
        } catch (err) {
            logger.debug(`[ChatAgent] 工具分组标签注入失败: ${err.message}`)
            return tools
        }
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
            // 传递图片处理配置
            if (channel.imageConfig) {
                clientOptions.imageConfig = channel.imageConfig
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
                        apiKey: keyInfo.key,
                        imageConfig: newChannel.imageConfig || clientOptions.imageConfig
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
