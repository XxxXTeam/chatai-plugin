/**
 * @fileoverview 聊天服务模块
 * @module services/llm/ChatService
 * @description
 */

import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import { LlmService } from './LlmService.js'
import { imageService } from '../media/ImageService.js'
import { contextManager, buildGroupEnvironmentPrompt, AUTO_CLEAN_NOTICE } from './ContextManager.js'
import { channelManager } from './ChannelManager.js'
import historyManager from '../../core/utils/history.js'
import config from '../../../config/config.js'
import { getAllTools, setToolContext } from '../../core/utils/toolAdapter.js'
import { presetManager } from '../preset/PresetManager.js'
import { memoryManager } from '../storage/MemoryManager.js'
import { buildMemoryBlock, buildKnowledgeGraphBlock, getMemoryToolGuides } from './MemoryContextAssembly.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { databaseService } from '../storage/DatabaseService.js'
import {
    applyPersonalTagChanges,
    buildPersonalTagContext,
    parsePersonalTagChanges,
    parsePersonalTagDefinitions
} from '../storage/PersonalTagService.js'
import { statsService } from '../stats/StatsService.js'
import { enforceMaxCharacters } from '../../utils/common.js'
import { resolveConfiguredToolChoice } from '../tools/ToolChoiceService.js'
import { resolveThinkingOptions as resolveConfiguredThinkingOptions } from './ThinkingOptions.js'
import { resolveChannelSystemPrompt } from './SystemPromptConfig.js'
import { resolveTemperature } from './TemperatureResolver.js'
import { applySkillToolConstraints, getSkillToolConstraints } from '../skills/SkillToolConstraints.js'
import { resolveToolPermission } from '../tools/ToolPermission.js'
import { normalizeInlineImageContent } from './InlineImageDataUrl.js'
import { PromptCacheService } from './PromptCacheService.js'
import { delegateRequest } from './LlmDelegator.js'
import { sendSegmentedMessage } from '../../utils/messageSegment.js'

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
        const fullUserId = String(options.userId || '')
        const pureUserId = fullUserId
        const groupId = options.groupId || options.event?.group_id || options.event?.data?.group_id || null
        const conversationId = groupId ? `group:${groupId}` : contextManager.getConversationId(pureUserId, null)
        const { release: releaseLock } = await contextManager.acquireLock(`chat:${conversationId}`, 1800000)

        try {
            return await this._sendMessageImpl(options)
        } catch (error) {
            const autoCleanConfig = config.get('features.autoCleanOnError')
            const autoCleanEnabled = autoCleanConfig?.enabled === true

            if (autoCleanEnabled) {
                try {
                    const historyManager = (await import('../../core/utils/history.js')).default
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
                            await options.event.reply(AUTO_CLEAN_NOTICE, true)
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
        } finally {
            releaseLock()
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
            debugMode = false, // 调试模式
            prefixPersona = null, // 前缀人格（独立于普通人设）
            disableTools = false, // 禁用工具调用（用于防止递归）
            skipHistory = false, // 跳过历史记录（用于事件响应等场景）
            skipStats = false, // 跳过调用统计（调用方自行记录，避免一次调用产生两条记录）
            skipPersona = false, // 跳过人设获取（用于总结等场景）
            temperature: overrideTemperature, // 覆盖温度参数
            maxTokens: overrideMaxTokens, // 覆盖最大token参数
            source = 'chat' // 统计来源标签（chat/game/bym等）
        } = options

        // 调试信息收集
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

        // 从选项或事件中获取群组ID以实现正确隔离
        const groupId = options.groupId || event?.group_id || event?.data?.group_id || null

        // 保留协议端用户 ID 原值；QQBot OpenID 与频道 ID 可能包含下划线
        const pureUserId = String(event?.user_id ?? event?.sender?.user_id ?? userId).trim()
        const cleanUserId = pureUserId

        // 统一初始化 ScopeManager（整个方法内复用同一实例）
        const sm = await ensureScopeManager()
        if (groupId) {
            // 检查使用次数限制
            const usageCheck = await sm.checkUsageLimit(String(groupId), cleanUserId)
            if (!usageCheck.allowed) {
                logger.info(`[ChatService] 群 ${groupId} 用户 ${cleanUserId} 使用次数已达限制`)
                throw new Error(usageCheck.reason || '使用次数已达上限')
            }

            // 检查是否禁用全局模型
            const forbidGlobal = await sm.isGlobalModelForbidden(String(groupId))
            if (forbidGlobal) {
                const hasIndependentChannel = await sm.hasIndependentChannel(String(groupId))
                if (!hasIndependentChannel) {
                    logger.warn(`[ChatService] 群 ${groupId} 禁用全局模型但未配置独立渠道`)
                    throw new Error('本群已禁用全局模型，请联系管理员配置群独立渠道后使用')
                }
            }
        }

        let groupChannelConfig = null
        if (groupId) {
            groupChannelConfig = await sm.getGroupChannelConfig(String(groupId))
            if (groupChannelConfig?.baseUrl && groupChannelConfig?.apiKey) {
                logger.info(`[ChatService] 群 ${groupId} 使用遗留独立渠道配置`)
            }
            if (
                Array.isArray(groupChannelConfig?.independentChannels) &&
                groupChannelConfig.independentChannels.length > 0
            ) {
                const enabledCount = groupChannelConfig.independentChannels.filter(
                    ch => ch.enabled !== false && ch.baseUrl && ch.apiKey
                ).length
                logger.info(
                    `[ChatService] 群 ${groupId} 配置了 ${groupChannelConfig.independentChannels.length} 个独立渠道 (${enabledCount} 个启用)`
                )
            }
        }

        // 群聊：始终使用共享的群组上下文 group:${groupId}
        // 用户独立上下文通过 personalContext 注入 system prompt，而非隔离历史
        let conversationId
        if (groupId) {
            conversationId = `group:${groupId}`
            logger.debug(`[ChatService] 群聊共享上下文: ${conversationId}`)
        } else {
            // 私聊：使用用户独立上下文
            conversationId = contextManager.getConversationId(cleanUserId, null)
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
                    const inlineImage = normalizeInlineImageContent(imageRef)
                    if (inlineImage) {
                        messageContent.push(inlineImage)
                        continue
                    } else if (
                        imageRef?.type === 'image' &&
                        (imageRef.url || imageRef.image?.startsWith?.('base64:'))
                    ) {
                        // 归一化否决的内联图：带 http/file/绝对路径的原 URL，按 URL 预检走全渠道路径
                        const urlValue = imageRef.url || imageRef.image.slice('base64:'.length)
                        if (
                            /^https?:\/\//i.test(urlValue) ||
                            urlValue.startsWith('file://') ||
                            urlValue.startsWith('/')
                        ) {
                            const prepared = await imageService.prepareImageForApi(urlValue, { timeout: 8000 })
                            if (prepared.url) {
                                messageContent.push({ type: 'image_url', image_url: { url: prepared.url } })
                            }
                            continue
                        }
                    } else if (imageRef.type === 'image_url' && imageRef.image_url?.url) {
                        // 预检可达性；QQ图床/内网等需转 base64，否则远端读不到
                        const prepared = await imageService.prepareImageForApi(imageRef.image_url.url, {
                            timeout: 8000
                        })
                        if (prepared.url) {
                            messageContent.push({ type: 'image_url', image_url: { url: prepared.url } })
                        }
                        continue
                    } else if (imageRef.type === 'url' && imageRef.url) {
                        const prepared = await imageService.prepareImageForApi(imageRef.url, { timeout: 8000 })
                        if (prepared.url) {
                            messageContent.push({ type: 'image_url', image_url: { url: prepared.url } })
                        }
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
                    // 如果是HTTP URL，先预检可达性，QQ图床/内网转 base64
                    if (imageRef.startsWith('base64:')) {
                        // NormalizeURL 层把外链改写成的 base64:<原文> 前缀：剥头还原为 URL 走预检
                        const rawValue = imageRef.slice('base64:'.length)
                        if (
                            /^https?:\/\//i.test(rawValue) ||
                            rawValue.startsWith('file://') ||
                            rawValue.startsWith('/')
                        ) {
                            const prepared = await imageService.prepareImageForApi(rawValue, { timeout: 8000 })
                            if (prepared.url) {
                                messageContent.push({ type: 'image_url', image_url: { url: prepared.url } })
                            }
                            continue
                        }
                    }
                    if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
                        const prepared = await imageService.prepareImageForApi(imageRef, { timeout: 8000 })
                        if (prepared.url) {
                            messageContent.push({ type: 'image_url', image_url: { url: prepared.url } })
                        }
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
        // 如果 skipHistory 为 true，跳过历史记录（用于事件响应等不需要上下文的场景）
        // 增加历史记录数量以改善上下文理解，从20条增加到30条
        const historyLimit = config.get('context.autoContext.maxHistoryMessages') || 30
        let history = skipHistory ? [] : await contextManager.getContextHistory(conversationId, historyLimit)

        // 获取默认预设配置
        await presetManager.init()

        // 检查是否是结束对话后的新会话，如果是则清空历史（防止旧上下文传递）
        if (presetManager.isContextCleared(conversationId)) {
            history = []
            logger.debug(`[ChatService] 检测到结束对话标记，清空历史上下文: ${conversationId}`)
        }

        // 从ScopeManager获取群组/用户的预设配置（支持群聊和私聊）
        let scopePresetId = null
        let scopePresetSource = null
        let scopeModelId = null
        let scopeModelSource = null
        let scopeFeatures = {}
        try {
            const pureUserId = cleanUserId
            const isPrivate = !groupId
            const effectiveSettings = await sm.getEffectiveSettings(groupId ? String(groupId) : null, pureUserId, {
                isPrivate
            })

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
            if (scopeFeatures.profileModel) modelInfo.push(`画像=${scopeFeatures.profileModel}`)
            const modelStr = modelInfo.length > 0 ? modelInfo.join(', ') : '默认'
            logger.info(`[ChatService] 作用域配置 [${scene}]: 预设=${scopePresetId || '默认'}, 模型分类=[${modelStr}]`)
        } catch (e) {
            logger.warn('[ChatService] 获取作用域配置失败:', e.message)
        }

        // 预设优先级：传入presetId > 传入preset > 作用域配置 > 全局默认
        const effectivePresetIdForModel =
            presetId || preset?.id || scopePresetId || config.get('llm.defaultChatPresetId') || 'default'
        const currentPreset = preset || presetManager.get(effectivePresetIdForModel)

        if (scopePresetId && !presetId && !preset) {
            logger.debug(`[ChatService] 使用群组/用户配置的预设: ${effectivePresetIdForModel}`)
        }
        const presetEnableTools =
            currentPreset?.tools?.enableBuiltinTools !== false && currentPreset?.enableTools !== false
        // 检查群组工具配置（scopeFeatures.toolsEnabled: true/false/undefined）
        let scopeToolsEnabled = true
        if (scopeFeatures.toolsEnabled !== undefined) {
            scopeToolsEnabled = scopeFeatures.toolsEnabled
            if (!scopeToolsEnabled) {
                logger.info(`[ChatService] 群组禁用了工具调用`)
            }
        }
        const globalToolApprovalMode = config.get('builtinTools.approvalMode') || 'auto'
        const presetToolApprovalMode = currentPreset?.tools?.toolApprovalMode || currentPreset?.toolApprovalMode
        const toolApprovalMode = scopeFeatures.toolApprovalMode || presetToolApprovalMode || globalToolApprovalMode
        const userPermission = resolveToolPermission({
            event,
            userId: event?.user_id || userId
        })
        const toolsAllowed = !disableTools && presetEnableTools && scopeToolsEnabled && toolApprovalMode !== 'ask'
        let allTools = []
        const skillToolConstraints = getSkillToolConstraints({ message })

        // 简化逻辑：直接根据配置决定是否加载工具
        if (toolsAllowed) {
            allTools = await getAllTools({
                event,
                presetId: effectivePresetIdForModel,
                userPermission,
                groupId,
                userId: event?.user_id || userId
            })
            allTools = applySkillToolConstraints(allTools, skillToolConstraints)
            logger.debug(`[ChatService] 加载工具: ${allTools.length}个`)
        } else if (toolApprovalMode === 'ask') {
            logger.debug('[ChatService] ask 模式：不向模型暴露工具')
        }

        // 统一使用对话模型，同时处理上下文和工具调用
        let llmModel = model || scopeFeatures.chatModel || config.get('llm.models.chat') || LlmService.getModel()
        let actualEnableTools = allTools.length > 0
        let actualTools = allTools
        if (!model && currentPreset?.model && currentPreset.model.trim()) {
            llmModel = currentPreset.model.trim()
            logger.debug(
                `[ChatService] 使用预设模型覆盖: ${llmModel} (预设: ${currentPreset.name || effectivePresetIdForModel})`
            )
        }
        if (!model && scopeModelId) {
            llmModel = scopeModelId
            logger.info(`[ChatService] 使用作用域模型: ${llmModel} (来源: ${scopeModelSource})`)
        }

        if (!llmModel || typeof llmModel !== 'string') {
            throw new Error('未配置模型，请先在管理面板「设置 → 模型配置」中配置默认模型')
        }

        // 如果提供了事件，设置工具上下文
        if (event) {
            setToolContext({ event, bot: event.bot || globalThis.Bot })
        }
        await channelManager.init()
        let channel = null
        let channelSource = 'global'

        /* 使用 ChannelManager 共享方法解析群独立渠道 */
        if (groupChannelConfig) {
            const resolved = channelManager.resolveGroupChannel(groupChannelConfig, llmModel, groupId)
            if (resolved.source === 'forbidden') {
                throw new Error('本群已禁用全局模型但未配置独立渠道，请在管理面板中配置群独立渠道后使用')
            }
            if (resolved.channel) {
                channel = resolved.channel
                channelSource = resolved.source
                llmModel = resolved.model
            }
        }

        if (!channel) {
            channel = channelManager.getBestChannel(llmModel)
            if (!channel) {
                throw new Error(`未找到可用的渠道，请检查模型配置: ${llmModel}`)
            }
        }

        logger.debug(
            `[ChatService] Channel: ${channel?.id}, source=${channelSource}, hasAdvanced=${!!channel?.advanced}, streaming=${JSON.stringify(channel?.advanced?.streaming)}`
        )
        // 调试：输出渠道的模型映射配置
        if (channel?.overrides?.modelMapping && Object.keys(channel.overrides.modelMapping).length > 0) {
            logger.info(
                `[ChatService] 渠道 ${channel.name} 模型映射配置: ${JSON.stringify(channel.overrides.modelMapping)}`
            )
        }

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
        const channelStreaming = channelAdvanced.streaming || {}
        const resolveThinkingOptions = targetChannel =>
            resolveConfiguredThinkingOptions({
                requestOptions: options,
                preset: currentPreset,
                channel: targetChannel
            })
        const thinkingOptions = resolveThinkingOptions(channel)
        const resolveToolChoiceForChannel = targetChannel => {
            if (!toolsAllowed) return { type: 'none' }
            return resolveConfiguredToolChoice({
                requestOptions: options,
                preset: currentPreset,
                channel: targetChannel
            })
        }
        const configuredToolChoice = resolveToolChoiceForChannel(channel)
        const clientOptions = {
            enableTools: actualEnableTools,
            preSelectedTools: actualTools.length > 0 ? actualTools : null,
            ...(configuredToolChoice ? { toolChoice: configuredToolChoice } : {}),
            ...thinkingOptions,
            adapterType: adapterType,
            event,
            presetId: effectivePresetId,
            userPermission,
            groupId,
            userId: event?.user_id || userId,
            conversationId,
            toolApprovalMode
        }

        // 输出模型选择摘要
        const modelSource = scopeFeatures.chatModel ? '群组配置' : scopeModelId ? '作用域' : '全局'
        logger.info(
            `[ChatService] 模型: ${llmModel} (来源: ${modelSource}, 工具: ${actualEnableTools ? actualTools.length + '个' : '禁用'})`
        )

        if (channel) {
            clientOptions.adapterType = channel.adapterType
            clientOptions.baseUrl = channel.baseUrl
            const keyInfo = channelManager.getChannelKey(channel)
            clientOptions.apiKey = keyInfo.key
            clientOptions.keyIndex = keyInfo.keyIndex
            clientOptions.keyObj = keyInfo.keyObj
            clientOptions.channelName = channel.name
            if (channel.timeout) {
                clientOptions.timeout = channel.timeout
            }
            // 传递图片处理配置
            if (channel.imageConfig) {
                clientOptions.imageConfig = channel.imageConfig
            }
            // 传递自定义路径配置
            if (channel.chatPath) {
                clientOptions.chatPath = channel.chatPath
            }
            if (channel.modelsPath) {
                clientOptions.modelsPath = channel.modelsPath
            }
            clientOptions.apiInterface = channel.apiInterface || channel.openaiApiInterface || 'chat'
            clientOptions.openaiApiInterface = clientOptions.apiInterface
            if (channel.responsePath) {
                clientOptions.responsePath = channel.responsePath
            }
            if (channel.endpoints) {
                clientOptions.endpoints = channel.endpoints
            }
            if (channel.experimental) {
                clientOptions.experimental = channel.experimental
            }
            if (channel.openaiResponses) {
                clientOptions.openaiResponses = channel.openaiResponses
            }
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
            if (channel.systemPromptConfig) {
                clientOptions.systemPromptConfig = channel.systemPromptConfig
            }
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
                enableReasoning: currentPreset?.enableReasoning,
                reasoningEffort: currentPreset?.reasoningEffort,
                reasoningBudgetTokens: currentPreset?.reasoningBudgetTokens,
                toolsConfig: preset?.tools
                    ? {
                          enableBuiltinTools: preset.tools.enableBuiltinTools,
                          enableMcpTools: preset.tools.enableMcpTools,
                          allowedTools: preset.tools.allowedTools?.slice(0, 10),
                          disabledTools: preset.tools.disabledTools?.slice(0, 10),
                          allowedMcpServers: preset.tools.allowedMcpServers?.slice(0, 10),
                          disabledMcpServers: preset.tools.disabledMcpServers?.slice(0, 10),
                          toolApprovalMode: preset.tools.toolApprovalMode
                      }
                    : null,
                isNewSession,
                promptContext
            }
        }
        const globalSystemPrompt = config.get('context.globalSystemPrompt')
        const globalPromptMode = config.get('context.globalPromptMode') || 'append' // append | prepend | override
        let globalPromptText = ''
        if (globalSystemPrompt && typeof globalSystemPrompt === 'string' && globalSystemPrompt.trim()) {
            globalPromptText = globalSystemPrompt.trim()
            logger.debug(
                `[ChatService] 已加载全局系统提示词 (${globalPromptText.length} 字符, 模式: ${globalPromptMode})`
            )
        }
        let systemPrompt = defaultPrompt
        let personalTagDefinitions = new Map()
        let isolatedConversationId = null
        let lastPersonaSource = null

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
                const pureUserId = scopeUserId
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

                // 独立人设上下文隔离：仅当配置开启且人设来源非默认时生效
                const isolateCfg = config.get('personality.isolateContext') || {}
                if (isolateCfg.enabled === true && independentResult.isIndependent) {
                    isolatedConversationId = `${conversationId}:persona:${independentResult.source}`
                    if (
                        isolateCfg.clearOnSwitch === true &&
                        lastPersonaSource !== null &&
                        lastPersonaSource !== independentResult.source
                    ) {
                        try {
                            await presetManager.markContextCleared(isolatedConversationId)
                            logger.debug(`[ChatService] 人设切换，已清除独立上下文: ${isolatedConversationId}`)
                        } catch (clearErr) {
                            logger.debug('[ChatService] 清除独立上下文失败:', clearErr.message)
                        }
                    }
                    lastPersonaSource = independentResult.source
                    logger.debug(`[ChatService] 使用独立人设上下文: ${isolatedConversationId}`)
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
                        conversationId: isolatedConversationId || conversationId,
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

            if (prefixPreset?.systemPrompt) {
                prefixPresetId = prefixPersona
                // 前缀预设存在时拼接到 base 之前，除非显式覆盖
                systemPrompt = prefixPreset.systemPrompt + (basePrompt ? '\n\n' + basePrompt : '')
                logger.debug(
                    `[ChatService] 使用前缀人格预设 (拼接模式): ${prefixPresetId} (${prefixPreset.name || prefixPresetId})`
                )
            } else {
                // 纯文本前缀人格 - 作为附加内容而不是完全覆盖
                if (prefixPersona.startsWith('覆盖:') || prefixPersona.startsWith('override:')) {
                    // 显式覆盖模式
                    systemPrompt = prefixPersona.replace(/^(覆盖:|override:)/, '').trim()
                    logger.debug(`[ChatService] 前缀人格显式覆盖模式 (内容长度: ${systemPrompt.length})`)
                } else {
                    // 默认合并模式：将前缀人格放在基础人设之前
                    systemPrompt = prefixPersona + (basePrompt ? '\n\n' + basePrompt : '')
                    logger.debug(
                        `[ChatService] 前缀人格合并模式 (前缀: ${prefixPersona.length}, 基础: ${basePrompt?.length || 0})`
                    )
                }
            }
            logger.debug(`[ChatService] 前缀人格应用后systemPrompt长度: ${systemPrompt.length}`)
        }
        if (config.get('memory.enabled') && !skipPersona) {
            try {
                const memoryContext = await buildMemoryBlock({
                    userId,
                    cleanUserId,
                    groupId: groupId ? String(groupId) : null,
                    message: message || '',
                    event
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
                    const groupMemory = await memoryManager.getGroupMemoryContext(String(groupId), cleanUserId, {
                        nickname
                    })
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
                            systemPrompt += '\n【群聊记忆】\n' + parts.join('\n') + '\n'
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
        if (config.get('memory.enabled') && !skipPersona) {
            try {
                const graphContext = await buildKnowledgeGraphBlock({
                    userId: String(cleanUserId),
                    groupId: groupId ? String(groupId) : null
                })
                if (graphContext) {
                    systemPrompt += graphContext
                    logger.debug(`[ChatService] 已添加知识图谱上下文 (${graphContext.length} 字符)`)
                    if (debugInfo) {
                        debugInfo.memory.knowledgeGraph = {
                            hasKnowledge: true,
                            length: graphContext.length,
                            preview: graphContext.substring(0, 500) + (graphContext.length > 500 ? '...' : '')
                        }
                    }
                } else if (debugInfo) {
                    debugInfo.memory.knowledgeGraph = { hasKnowledge: false }
                }
            } catch (error) {
                logger.warn('[ChatService] 获取知识图谱上下文失败:', error.message)
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
                logger.debug(
                    `[ChatService] 已添加知识库上下文 (${knowledgePrompt.length} 字符, 预设: ${knowledgePresetId})`
                )
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
        const skillDocumentInstructions = global.chatAiSkillsLoader?.getSkillDocumentInstructions?.({
            message
        })
        if (!skipPersona && skillDocumentInstructions) {
            systemPrompt += '\n\n' + skillDocumentInstructions
            logger.debug(`[ChatService] 已添加 SKILL.md 文档技能指令 (${skillDocumentInstructions.length} 字符)`)
        }
        if (config.get('memory.enabled') && !skipPersona && toolsAllowed && allTools.length > 0) {
            const toolGuides = getMemoryToolGuides(allTools)
            if (toolGuides) {
                systemPrompt += '\n' + toolGuides
                logger.debug(`[ChatService] 已注入记忆/知识图谱工具使用指南 (${toolGuides.length} 字符)`)
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
            systemPrompt += buildGroupEnvironmentPrompt({
                groupId,
                groupName,
                userLabel: currentUserLabel,
                userUin: currentUserUin,
                labeledHistory: true,
                mentionHint: true
            })
        } else if (groupId && (!groupContextSharingEnabled || isolation.groupUserIsolation)) {
            // 群上下文传递关闭或用户隔离模式：只添加基本群信息，不传递群聊历史
            systemPrompt += buildGroupEnvironmentPrompt({
                groupId,
                groupName: event?.group_name || event?.group?.name || '',
                userLabel: event?.sender?.card || event?.sender?.nickname || `用户${userId}`,
                userUin: event?.user_id || userId,
                labeledHistory: false,
                mentionHint: true
            })

            if (!groupContextSharingEnabled) {
                validHistory = []
                logger.debug(`[ChatService] 群上下文传递已禁用，不携带群聊历史`)
            }
        }
        let messages = []
        const shouldDisableSystemPrompt = currentPreset?.disableSystemPrompt === true
        const baseSystemPrompt = systemPrompt
        const resolveChannelPrompt = targetChannel => resolveChannelSystemPrompt(baseSystemPrompt, targetChannel)
        const channelPromptState = resolveChannelPrompt(channel)
        systemPrompt = channelPromptState.systemPrompt
        personalTagDefinitions = parsePersonalTagDefinitions(systemPrompt)
        if (!skipPersona && personalTagDefinitions.size > 0) {
            const personalTagContext = buildPersonalTagContext(cleanUserId)
            if (personalTagContext && !systemPrompt.includes(personalTagContext.trim())) {
                systemPrompt += personalTagContext
            }
        }
        if (!shouldDisableSystemPrompt && systemPrompt && systemPrompt.trim()) {
            messages.push({ role: 'system', content: [{ type: 'text', text: systemPrompt }] })
        } else if (shouldDisableSystemPrompt) {
            logger.debug(`[ChatService] 预设已禁用系统提示词，不发送 system 消息`)
        }
        messages.push(...validHistory, userMessage)

        /* 字符上限检查 */
        const maxCharacters = channelLlm.maxCharacters || 0
        enforceMaxCharacters(messages, maxCharacters, 'ChatService')

        const hasTools = client.tools && client.tools.length > 0
        const useStreaming = stream || channelStreaming.enabled === true
        logger.debug(
            `[ChatService] Request: model=${llmModel}, stream=${useStreaming}, tools=${hasTools ? client.tools.length : 0}, channelStreaming=${JSON.stringify(channelStreaming)}`
        )
        let finalResponse = null
        let finalUsage = null
        let allToolLogs = []
        let lastError = null
        const requestStartTime = Date.now()

        // 追踪实际使用的模型和渠道（用于统计记录，即使 debugMode=false 也需要）
        let actualUsedModel = llmModel
        let actualUsedChannel = channel
        let upstreamReportedModel = null
        let actualFallbackUsed = false
        let actualChannelSwitched = false
        let actualTotalRetryCount = 0
        let actualSwitchChain = []
        const presetParams = currentPreset?.modelParams || {}
        const baseMaxToken = channelLlm.maxTokens || presetParams.max_tokens || presetParams.maxTokens || 4000

        // 应用模型映射/复写 - 框架内使用 llmModel，实际API请求使用 actualModel
        logger.debug(
            `[ChatService] 准备模型映射: channelId=${channel?.id}, llmModel=${llmModel}, overrides=${JSON.stringify(channel?.overrides)}`
        )
        const modelMapping = channel
            ? channelManager.getActualModel(channel.id, llmModel)
            : { actualModel: llmModel, originalModel: llmModel, mapped: false }
        const actualModel = modelMapping.actualModel
        logger.info(
            `[ChatService] 模型映射结果: ${llmModel} -> ${actualModel} (mapped=${modelMapping.mapped}, 渠道: ${channel?.name})`
        )

        /* 温度优先级：模型级覆盖 > 渠道覆盖(禁用/固定) > 调用方 > 渠道默认 > 预设 > 0.7 */
        const { temperature: resolvedTemperature, source: resolvedTempSource } = resolveTemperature({
            actualModel,
            requestOptions: { temperature: overrideTemperature },
            preset: currentPreset,
            channel
        })

        const requestOptions = {
            model: actualModel, // 使用映射后的实际模型名称
            maxToken: overrideMaxTokens ?? baseMaxToken,
            temperature: resolvedTemperature,
            topP: channelLlm.topP ?? presetParams.top_p ?? presetParams.topP,
            conversationId,
            systemOverride: systemPrompt,
            systemPromptConfig: channelPromptState.systemPromptConfig,
            stream: useStreaming,
            disableHistoryRead: skipHistory,
            ...thinkingOptions,
            event,
            presetId: effectivePresetId,
            userPermission,
            groupId,
            userId: event?.user_id || userId,
            toolApprovalMode,
            ...(configuredToolChoice ? { toolChoice: configuredToolChoice } : {}),
            ...(options.tool_choice !== undefined ? { tool_choice: options.tool_choice } : {}),
            ...(options.responsesToolChoice !== undefined ? { responsesToolChoice: options.responsesToolChoice } : {}),
            ...(options.responseToolChoice !== undefined ? { responseToolChoice: options.responseToolChoice } : {})
        }
        logger.debug(
            `[ChatService] 请求参数: temperature=${requestOptions.temperature}, maxToken=${requestOptions.maxToken}, 来源: ${resolvedTempSource}`
        )

        try {
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
                        contentTypes: Array.isArray(msg.content) ? msg.content.map(c => c.type) : ['text'],
                        contentLength: Array.isArray(msg.content)
                            ? msg.content.reduce((sum, c) => sum + (c.text?.length || 0), 0)
                            : typeof msg.content === 'string'
                              ? msg.content.length
                              : 0,
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
                            ? msg.content
                                  .filter(c => c.type === 'text')
                                  .map(c => c.text?.substring(0, 100))
                                  .join('')
                                  .substring(0, 150)
                            : typeof msg.content === 'string'
                              ? msg.content.substring(0, 150)
                              : '',
                        hasToolCalls: !!msg.toolCalls?.length,
                        // 添加发送者信息
                        sender: msg.sender
                            ? {
                                  user_id: msg.sender.user_id,
                                  nickname: msg.sender.nickname || msg.sender.card
                              }
                            : null
                    })),
                    systemPromptPreview: systemPrompt.substring(0, 300) + (systemPrompt.length > 300 ? '...' : ''),
                    totalHistoryLength: validHistory.length,
                    // 隔离模式信息
                    isolationMode: isolation,
                    hasUserLabels: groupId && !isolation.groupUserIsolation,
                    maxContextMessages: 20
                }
                // 工具列表
                debugInfo.availableTools = hasTools
                    ? client.tools.map(t => t.function?.name || t.name).slice(0, 20)
                    : []
            }
            const concurrentCount = contextManager.recordRequest(conversationId)
            if (concurrentCount > 1) {
                logger.debug(`[ChatService] 会话 ${conversationId} 检测到并发请求: ${concurrentCount}`)
            }
            {
                /* 中间消息回调（跨客户端的注册函数）：委托器每次重建客户端后重挂 */
                const attachIntermediateCallback = clientInstance => {
                    if (!event || !event.reply) return
                    let intermediateSent = ''
                    clientInstance.setOnMessageWithToolCall(async data => {
                        if (data?.intermediateText && data.isIntermediate) {
                            const text = data.intermediateText.trim()
                            if (!text) return
                            if (this.isPureToolCallJson(text)) {
                                return
                            }
                            // 增量去重：新文本以已发送内容为前缀时只发新增部分
                            let pending = text
                            if (intermediateSent && text.startsWith(intermediateSent)) {
                                pending = text.slice(intermediateSent.length).trim()
                            }
                            intermediateSent = text
                            if (!pending) return
                            // 中间插话统一走语义分段发送，符合真人逐段节发习惯
                            try {
                                await sendSegmentedMessage(event, pending, {
                                    quote: true,
                                    shortLimit: 100,
                                    foldLimit: 800
                                })
                            } catch (err) {
                                logger.debug('[ChatService] 中间消息分段发送失败:', err.message)
                            }
                        } else if (data?.type === 'text' && data.text) {
                            await event.reply(data.text, true)
                        }
                    })
                }

                // 初始客户端的回调也由委托器生命周期统一接管（通过 onClientBuilt）
                attachIntermediateCallback(client)

                const delegateResult = await delegateRequest({
                    userMessage,
                    initialChannel: channel,
                    initialClient: client,
                    initialModel: llmModel,
                    clientBaseOptions: clientOptions,
                    requestOptions,
                    resolveChannelPrompt,
                    resolveThinkingOptions,
                    resolveToolChoiceForChannel,
                    onClientBuilt: attachIntermediateCallback,
                    event,
                    source
                })
                const {
                    response: delegateResponse = null,
                    usage: delegateUsage = null,
                    reportedModel: delegateUpstreamModel = null,
                    toolCallLogs: delegateToolLogs = [],
                    usedModel: delegateUsedModel = llmModel,
                    usedChannel: delegateUsedChannel = channel,
                    fallbackUsed: delegateFallbackUsed = false,
                    channelSwitched: delegateChannelSwitched = false,
                    totalRetryCount: delegateTotalRetryCount = 0,
                    switchChain: delegateSwitchChain = [],
                    retryStats: delegateRetryStats = null,
                    lastError: delegateLastError = null
                } = delegateResult

                // 同步外部追踪变量（统计记录用）
                actualUsedModel = delegateUsedModel
                actualUsedChannel = delegateUsedChannel
                actualFallbackUsed = delegateFallbackUsed
                actualChannelSwitched = delegateChannelSwitched
                actualTotalRetryCount = delegateTotalRetryCount
                actualSwitchChain = delegateSwitchChain

                let response = delegateResponse
                finalUsage = delegateUsage
                allToolLogs = delegateToolLogs
                upstreamReportedModel = delegateUpstreamModel
                lastError = delegateLastError
                const switchChain = delegateSwitchChain
                const retryStats = delegateRetryStats

                if (!response && lastError) {
                    if (debugInfo) {
                        debugInfo.totalRetryCount = actualTotalRetryCount
                        debugInfo.switchChain = switchChain.length > 1 ? switchChain : null
                        debugInfo.channelSwitched = actualChannelSwitched
                    }
                    throw lastError
                }

                if (!response) {
                    logger.warn('[ChatService] 所有模型和渠道尝试后仍无有效响应')
                }

                finalResponse = response?.contents || []
                finalUsage = response?.usage || {}
                allToolLogs = response?.toolCallLogs || []
                // 提示词缓存命中感知：根据上游 usage 判定命中断言并轮换缓存键
                const cacheVerdict = PromptCacheService.noteUsage(actualUsedChannel?.id, finalUsage)
                if (cacheVerdict !== 'none' && cacheVerdict !== 'hit') {
                    logger.debug(`[ChatService] 提示词缓存判定: ${cacheVerdict} (channel=${actualUsedChannel?.id})`)
                }
                if (finalResponse.length > 0) {
                    const personalTagChanges = []
                    finalResponse = finalResponse
                        .filter(c => {
                            if (c.type === 'text' && c.text) {
                                return !this.isPureToolCallJson(c.text)
                            }
                            return true
                        })
                        .map(content => {
                            if (content.type !== 'text' || !content.text || personalTagDefinitions.size === 0) {
                                return content
                            }
                            const parsed = parsePersonalTagChanges(content.text, personalTagDefinitions)
                            personalTagChanges.push(...parsed.changes)
                            return { ...content, text: parsed.text }
                        })
                    if (personalTagChanges.length > 0) {
                        const tagState = await applyPersonalTagChanges(cleanUserId, personalTagChanges)
                        logger.debug(`[ChatService] 已更新用户动态标签: ${JSON.stringify(tagState)}`)
                    }
                }

                // 记录实际使用的模型和渠道切换信息
                if (debugInfo) {
                    debugInfo.usedModel = actualUsedModel
                    debugInfo.fallbackUsed = actualFallbackUsed
                    debugInfo.channelSwitched = actualChannelSwitched
                    debugInfo.usedChannel = actualUsedChannel
                        ? {
                              id: actualUsedChannel.id,
                              name: actualUsedChannel.name
                          }
                        : null
                    debugInfo.totalRetryCount = actualTotalRetryCount
                    // 格式化switchChain为可读字符串数组
                    const formattedChain = switchChain.map(s => {
                        if (s.type === 'init') return `初始: ${s.channel}`
                        if (s.type === 'key') return `Key切换: ${s.channel} #${s.fromKey}->#${s.toKey} (${s.reason})`
                        if (s.type === 'channel') return `渠道切换: ${s.from}->${s.to} (${s.reason})`
                        if (s.type === 'retry') return `重试: ${s.channel} #${s.attempt} (${s.reason})`
                        if (s.type === 'fallback') return `备选模型: ${s.model} @ ${s.channel} (${s.reason})`
                        if (s.type === 'exhausted')
                            return `渠道耗尽: ${s.model} (${s.channelsTried}/${s.totalChannels})`
                        if (s.type === 'success') return `成功: ${s.channel} @ ${s.model}`
                        return JSON.stringify(s)
                    })
                    debugInfo.switchChain = formattedChain.length > 1 ? formattedChain : null
                    debugInfo.switchChainRaw = switchChain.length > 1 ? switchChain : null

                    // 添加详细的重试统计信息
                    debugInfo.retryStats = {
                        totalAttempts: retryStats?.totalAttempts ?? 0,
                        channelsTriedCount: retryStats?.channelsTriedForMainModel.size ?? 0,
                        mainModelExhausted: retryStats?.mainModelExhausted ?? false,
                        errors: retryStats?.errors.slice(-5) ?? [] // 只保留最近5个错误
                    }
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
                    resultPreview:
                        typeof log.result === 'string'
                            ? log.result.substring(0, 300) + (log.result.length > 300 ? '...' : '')
                            : JSON.stringify(log.result).substring(0, 300),
                    duration: log.duration,
                    success: !log.isError
                }))
            }
        } catch (err) {
            // 委托器失败时直接 throw lastError，下方 finally 的统计取不到（会记成"未知错误"）。
            // 这里同步捕获的异常到 lastError 后原样抛出，保证调用统计/响应详情保留真实错误。
            lastError = lastError || err
            throw err
        } finally {
            // 委托器已统一 startRequest/endRequest；此处仅补充渠道使用统计
            if (channel) {
                if (finalUsage) {
                    channelManager.reportUsage(actualUsedChannel?.id || channel.id, finalUsage?.totalTokens || 0)
                }
                // 成功时重置渠道错误计数
                if (finalResponse?.length > 0) {
                    channelManager.reportSuccess(actualUsedChannel?.id || channel.id)
                }
            }

            // 记录统计（使用统一入口）
            try {
                // 使用实际追踪的渠道信息（优先于 debugInfo，因为 debugInfo 仅在 debugMode=true 时有值）
                const usedChannelForStats = actualUsedChannel || channel
                const keyInfo = usedChannelForStats?.lastUsedKey || channel?.lastUsedKey || {}
                const requestDuration = Date.now() - requestStartTime
                const responseText =
                    finalResponse
                        ?.filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('') || ''
                const requestSuccess = !!finalResponse?.length

                // 格式化 switchChain 为可读格式
                const formattedSwitchChain =
                    actualSwitchChain.length > 1
                        ? actualSwitchChain.map(s => {
                              if (s.type === 'init') return `初始: ${s.channel}`
                              if (s.type === 'key')
                                  return `Key切换: ${s.channel} #${s.fromKey}->#${s.toKey} (${s.reason})`
                              if (s.type === 'channel') return `渠道切换: ${s.from}->${s.to} (${s.reason})`
                              if (s.type === 'retry') return `重试: ${s.channel} #${s.attempt} (${s.reason})`
                              if (s.type === 'fallback') return `备选模型: ${s.model} @ ${s.channel} (${s.reason})`
                              if (s.type === 'exhausted')
                                  return `渠道耗尽: ${s.model} (${s.channelsTried}/${s.totalChannels})`
                              return JSON.stringify(s)
                          })
                        : null

                if (!skipStats)
                    await statsService.recordApiCall({
                        channelId: usedChannelForStats?.id || `no-channel-${llmModel}`,
                        channelName: usedChannelForStats?.name || `无渠道(${llmModel})`,
                        model: actualUsedModel || llmModel,
                        reportedModel: upstreamReportedModel,
                        keyIndex: keyInfo.keyIndex ?? -1,
                        keyName: keyInfo.keyName || '',
                        strategy: keyInfo.strategy || '',
                        duration: requestDuration,
                        success: requestSuccess,
                        error: !requestSuccess ? lastError?.message || lastError?.toString() || '未知错误' : null,
                        source,
                        userId,
                        groupId: groupId || null,
                        stream: useStreaming,
                        retryCount: actualTotalRetryCount,
                        channelSwitched: actualChannelSwitched,
                        fallbackUsed: actualFallbackUsed,
                        previousChannelId: actualChannelSwitched ? channel?.id : null,
                        switchChain: formattedSwitchChain,
                        apiUsage: finalUsage,
                        messages,
                        responseText,
                        // 请求详情
                        request: {
                            messages,
                            model: actualUsedModel || llmModel,
                            tools: hasTools
                                ? client.tools.map(t => ({
                                      name: t.name,
                                      description: t.description?.substring(0, 100)
                                  }))
                                : null,
                            temperature: requestOptions.temperature,
                            maxToken: requestOptions.maxToken,
                            topP: requestOptions.topP,
                            systemPrompt: systemPrompt?.substring(0, 500) + (systemPrompt?.length > 500 ? '...' : '')
                        },
                        response: !requestSuccess
                            ? {
                                  error: lastError?.message || lastError?.toString() || '未知错误',
                                  code: lastError?.code || lastError?.status || null,
                                  type: lastError?.type || lastError?.name || null,
                                  contents: finalResponse
                              }
                            : null
                    })
            } catch (e) {
                logger.warn(`[ChatService] 记录统计失败:`, e.message)
            }
        }

        // Update Context
        if (finalResponse) {
            const textContent = finalResponse
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n')
            if (textContent.length > 50) {
                // message 为可选参数（纯图片消息时为空），不做保护会抛 TypeError
                // 并被外层 catch 触发 autoCleanOnError 清空用户历史
                const topicText = typeof message === 'string' ? message.substring(0, 100) : ''
                await contextManager.updateContext(conversationId, {
                    lastInteraction: Date.now(),
                    ...(topicText ? { recentTopics: [topicText] } : {})
                })
            }
            // Auto Memory
            if (config.get('memory.enabled') && config.get('memory.autoExtract') !== false) {
                memoryManager
                    .extractMemoryFromConversation(userId, message, textContent, { groupId })
                    .catch(err => logger.warn('[ChatService] Automatic memory extraction failed:', err.message))
            }
            const voiceConfig = config.get('features.voiceReply')
            if (voiceConfig?.enabled && event && event.reply) {
                const shouldVoice = voiceConfig.triggerAlways || (voiceConfig.triggerOnTool && allToolLogs.length > 0)

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

        if (groupId && finalResponse?.length > 0) {
            try {
                const usageResult = await sm.incrementUsage(String(groupId), cleanUserId)
                if (usageResult.success) {
                    logger.debug(
                        `[ChatService] 群 ${groupId} 使用次数: 群${usageResult.groupCount}, 用户${usageResult.userCount}`
                    )
                }
            } catch (e) {
                logger.warn('[ChatService] 记录使用次数失败:', e.message)
            }
        }

        return {
            conversationId,
            response: finalResponse || [],
            usage: finalUsage || {},
            model: upstreamReportedModel || llmModel,
            requestedModel: llmModel,
            toolCallLogs: allToolLogs,
            debugInfo, // 调试信息（仅在 debugMode 时有值）
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
        // sendMessage 成功但响应体为空时生成器会静默结束，此处留痕避免调用方无感知
        if (!response.response || response.response.length === 0) {
            logger.warn('[ChatService] streamMessage 收到空响应')
        }
    }

    async getHistory(userId, _limit = 20, groupId = null) {
        await contextManager.init()
        const conversationId = contextManager.getConversationId(userId, groupId)
        return await historyManager.getHistory(undefined, conversationId)
    }

    async clearHistory(userId, groupId = null) {
        await contextManager.init()
        let conversationId
        if (groupId) {
            conversationId = `group:${groupId}`
        } else {
            const cleanUserId = String(userId)
            conversationId = contextManager.getConversationId(cleanUserId, null)
        }
        presetManager.markContextCleared(conversationId)
        await historyManager.deleteConversation(conversationId)
        contextManager.clearSessionState(conversationId)
        contextManager.clearQueue(conversationId)
        if (groupId) {
            contextManager.clearGroupContextCache(String(groupId))
        }
        const legacyId = groupId ? `group:${groupId}:user:${userId}` : null
        if (legacyId && legacyId !== conversationId) {
            try {
                await historyManager.deleteConversation(legacyId)
            } catch (e) {
                // 忽略旧格式清理错误
            }
        }
        try {
            const { redisClient } = await import('../../core/cache/RedisClient.js')
            if (redisClient.isConnected) {
                await redisClient.del(`context:${conversationId}`)
                await redisClient.client.srem('active_contexts', conversationId)
            }
        } catch (e) {}

        logger.info(`[ChatService] 对话已清除: ${conversationId}, 群ID: ${groupId || '无'}`)
    }
    isPureToolCallJson(text) {
        if (!text || typeof text !== 'string') return false

        const trimmed = text.trim()
        if (trimmed.startsWith('{"tool_calls"') || trimmed.startsWith('{ "tool_calls"')) {
            const toolCallPattern = /^\{\s*"tool_calls"\s*:\s*\[/
            if (toolCallPattern.test(trimmed)) {
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
            /\]\s*\}"\s*\}\s*\]\s*\}$/
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
                    return (
                        parsed.tool_calls.length === 0 ||
                        parsed.tool_calls.every(tc => tc && typeof tc === 'object' && (tc.function?.name || tc.name))
                    )
                }
            } catch {}
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
                        return (
                            parsed.tool_calls.length === 0 ||
                            parsed.tool_calls.every(
                                tc => tc && typeof tc === 'object' && (tc.function?.name || tc.name)
                            )
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
            return history
                .map(msg => {
                    const role = msg.role === 'user' ? '👤 用户' : '🤖 助手'
                    const content = Array.isArray(msg.content)
                        ? msg.content
                              .filter(c => c.type === 'text')
                              .map(c => c.text)
                              .join('\n')
                        : msg.content
                    return `${role}:\n${content}\n`
                })
                .join('\n---\n\n')
        }
    }
}

export const chatService = new ChatService()
