import crypto from 'node:crypto'
import { BaseClientOptions, ChaiteContext, DefaultLogger, MultipleKeyStrategyChoice, SendMessageOption } from '../types/index.js'
import DefaultHistoryManager from '../utils/history.js'
import { asyncLocalStorage, extractClassName, getKey } from '../utils/index.js'

/**
 * 将URL资源转换为base64
 * @param {string} url - 资源URL
 * @param {string} [defaultMimeType] - 默认MIME类型
 * @returns {Promise<{mimeType: string, data: string}>}
 */
async function urlToBase64(url, defaultMimeType = 'application/octet-stream') {
    try {
        // 处理本地文件路径
        if (url.startsWith('file://') || url.startsWith('/')) {
            const fs = await import('node:fs')
            const path = await import('node:path')
            const filePath = url.replace('file://', '')
            const buffer = fs.readFileSync(filePath)
            const ext = path.extname(filePath).toLowerCase().slice(1)
            const mimeType = getMimeType(ext) || defaultMimeType
            return { mimeType, data: buffer.toString('base64') }
        }
        
        // 处理已经是 base64 的情况
        if (url.startsWith('base64://')) {
            return { mimeType: defaultMimeType, data: url.replace('base64://', '') }
        }
        if (url.startsWith('data:')) {
            const [header, data] = url.split(',')
            const mimeType = header.match(/data:([^;]+)/)?.[1] || defaultMimeType
            return { mimeType, data }
        }
        
        // HTTP/HTTPS URL
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`)
        }
        const contentType = response.headers.get('content-type') || defaultMimeType
        const buffer = Buffer.from(await response.arrayBuffer())
        return {
            mimeType: contentType.split(';')[0],
            data: buffer.toString('base64')
        }
    } catch (error) {
        throw error
    }
}

/**
 * 根据文件扩展名获取MIME类型
 */
function getMimeType(ext) {
    const mimeTypes = {
        // 图片
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
        'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
        'svg': 'image/svg+xml', 'ico': 'image/x-icon',
        // 视频
        'mp4': 'video/mp4', 'webm': 'video/webm', 'avi': 'video/x-msvideo',
        'mov': 'video/quicktime', 'mkv': 'video/x-matroska', 'flv': 'video/x-flv',
        'm4v': 'video/x-m4v', '3gp': 'video/3gpp',
        // 音频
        'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
        'm4a': 'audio/mp4', 'flac': 'audio/flac', 'aac': 'audio/aac',
        // 文档
        'pdf': 'application/pdf', 'txt': 'text/plain',
    }
    return mimeTypes[ext?.toLowerCase()]
}

/**
 * 预处理消息中的媒体URL，转换为base64（用于Gemini等需要base64的模型）
 * 支持：图片、视频、音频
 * @param {Array} histories - 消息历史
 * @param {Object} options - 选项
 * @param {boolean} [options.processVideo=true] - 是否处理视频
 * @param {boolean} [options.processAudio=true] - 是否处理音频
 * @param {number} [options.maxVideoSize=20*1024*1024] - 最大视频大小(bytes)
 * @returns {Promise<Array>}
 */
export async function preprocessMediaToBase64(histories, options = {}) {
    const { processVideo = true, processAudio = true, maxVideoSize = 20 * 1024 * 1024 } = options
    const processed = []
    
    for (const msg of histories) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
            const newContent = []
            for (const item of msg.content) {
                try {
                    // 处理 image 类型
                    if (item.type === 'image' && item.image && !item.image.startsWith('data:')) {
                        const { mimeType, data } = await urlToBase64(item.image, 'image/jpeg')
                        newContent.push({
                            type: 'image',
                            image: `data:${mimeType};base64,${data}`
                        })
                        logger.debug('[MediaPreprocess] 图片转base64:', item.image?.substring(0, 50))
                    }
                    // 处理 image_url 类型
                    else if (item.type === 'image_url' && item.image_url?.url && !item.image_url.url.startsWith('data:')) {
                        const { mimeType, data } = await urlToBase64(item.image_url.url, 'image/jpeg')
                        newContent.push({
                            type: 'image',
                            image: `data:${mimeType};base64,${data}`
                        })
                        logger.debug('[MediaPreprocess] image_url转base64:', item.image_url.url?.substring(0, 50))
                    }
                    // 处理视频类型
                    else if (processVideo && (item.type === 'video' || item.type === 'video_info')) {
                        const videoUrl = item.url || item.video || item.file
                        if (videoUrl && !videoUrl.startsWith('data:')) {
                            try {
                                const { mimeType, data } = await urlToBase64(videoUrl, 'video/mp4')
                                // 检查大小限制
                                const sizeBytes = (data.length * 3) / 4
                                if (sizeBytes <= maxVideoSize) {
                                    newContent.push({
                                        type: 'video',
                                        video: `data:${mimeType};base64,${data}`,
                                        mimeType
                                    })
                                    logger.debug('[MediaPreprocess] 视频转base64:', videoUrl?.substring(0, 50))
                                } else {
                                    logger.warn(`[MediaPreprocess] 视频过大(${(sizeBytes/1024/1024).toFixed(1)}MB)，跳过:`, videoUrl?.substring(0, 50))
                                    newContent.push(item) // 保留原始
                                }
                            } catch (err) {
                                logger.warn('[MediaPreprocess] 视频转换失败:', err.message)
                                newContent.push(item)
                            }
                        } else {
                            newContent.push(item)
                        }
                    }
                    // 处理音频类型
                    else if (processAudio && (item.type === 'audio' || item.type === 'record')) {
                        const audioUrl = item.url || item.data || item.file
                        if (audioUrl && typeof audioUrl === 'string' && !audioUrl.startsWith('data:')) {
                            try {
                                const { mimeType, data } = await urlToBase64(audioUrl, 'audio/mpeg')
                                newContent.push({
                                    type: 'audio',
                                    data,
                                    format: mimeType.split('/')[1] || 'mp3'
                                })
                                logger.debug('[MediaPreprocess] 音频转base64:', audioUrl?.substring(0, 50))
                            } catch (err) {
                                logger.warn('[MediaPreprocess] 音频转换失败:', err.message)
                                newContent.push(item)
                            }
                        } else {
                            newContent.push(item)
                        }
                    }
                    else {
                        newContent.push(item)
                    }
                } catch (err) {
                    logger.warn('[MediaPreprocess] 处理失败:', err.message)
                    newContent.push(item)
                }
            }
            processed.push({ ...msg, content: newContent })
        } else {
            processed.push(msg)
        }
    }
    return processed
}

/**
 * 兼容旧函数名
 */
export async function preprocessImageUrls(histories) {
    return preprocessMediaToBase64(histories, { processVideo: true, processAudio: true })
}

/**
 * 检查模型是否需要base64预处理（如Gemini系列）
 * @param {string} model - 模型名称
 * @returns {boolean}
 */
export function needsBase64Preprocess(model) {
    if (!model || typeof model !== 'string') return false
    const lowerModel = model.toLowerCase()
    // Gemini 系列模型都需要 base64
    return lowerModel.includes('gemini')
}

/**
 * 兼容旧函数名
 */
export function needsImageBase64Preprocess(model) {
    return needsBase64Preprocess(model)
}

/**
 * 工具调用限制配置
 * @typedef {Object} ToolCallLimitConfig
 * @property {number} [maxConsecutiveCalls] - 最大连续调用次数
 * @property {number} [maxConsecutiveIdenticalCalls] - 最大连续相同调用次数
 */

/**
 * 工具调用上下文
 * @typedef {Object} ToolCallContext
 * @property {Object} event - Yunzai 事件对象
 * @property {Object} bot - Bot 实例
 * @property {string} userId - 用户ID
 * @property {string} [groupId] - 群组ID
 */

/** 默认工具调用限制 */
const DEFAULT_TOOL_CALL_LIMIT = {
    maxConsecutiveCalls: 5,           // 最大连续调用次数（降低）
    maxConsecutiveIdenticalCalls: 3,  // 最大连续相同调用次数（降为1，不允许重复）
    maxTotalToolCalls: 12,            // 单次对话最大工具调用总数
    maxSimilarCalls: 2                // 最大相似调用次数（用于检测功能相同但参数略不同的调用）
}

/**
 * @typedef {import('../types').Feature} Feature
 * @typedef {import('../types').Tool} Tool
 * @typedef {import('../types').ILogger} ILogger
 * @typedef {import('../types').HistoryManager} HistoryManager
 * @typedef {import('../types').ClientType} ClientType
 * @typedef {import('../types').MultipleKeyStrategy} MultipleKeyStrategy
 * @typedef {import('../types').UserMessage} UserMessage
 * @typedef {import('../types').AssistantMessage} AssistantMessage
 * @typedef {import('../types').HistoryMessage} HistoryMessage
 * @typedef {import('../types').IMessage} IMessage
 * @typedef {import('../types').ModelResponse} ModelResponse
 * @typedef {import('../types').ModelUsage} ModelUsage
 * @typedef {import('../types').EmbeddingOption} EmbeddingOption
 * @typedef {import('../types').EmbeddingResult} EmbeddingResult
 * @typedef {import('../types').TextContent} TextContent
 * @typedef {import('../types').ToolCallResult} ToolCallResult
 * @typedef {import('../types').ToolCallResultMessage} ToolCallResultMessage
 */

/**
 * Abstract base client for all LLM adapters
 */
export class AbstractClient {
    /**
     * @param {BaseClientOptions | Partial<BaseClientOptions>} options
     * @param {ChaiteContext} [context]
     */
    constructor(options, context) {
        options = BaseClientOptions.create(options)
        this.features = options.features || []
        this.tools = options.tools || []
        this.baseUrl = options.baseUrl || ''
        this.apiKey = options.apiKey || ''
        this.multipleKeyStrategy = options.multipleKeyStrategy || MultipleKeyStrategyChoice.RANDOM
        this.logger = options.logger || DefaultLogger
        this.historyManager = options.historyManager || DefaultHistoryManager
        this.context = new ChaiteContext(this.logger)
        this.options = options
        /** @type {ToolCallLimitConfig} */
        this.toolCallLimitConfig = options.toolCallLimitConfig || DEFAULT_TOOL_CALL_LIMIT
        /** @type {Function|null} 工具调用中间消息回调 */
        this.onMessageWithToolCall = options.onMessageWithToolCall || null
        if (context) {
            this.context = context
            this.context.setClient(this)
        }
    }

    /**
     * Main send message method
     * @param {UserMessage | undefined} message
     * @param {SendMessageOption | Partial<SendMessageOption>} options
     * @returns {Promise<ModelResponse>}
     */
    async sendMessage(message, options) {
        const debug = this.context.chaite?.getGlobalConfig?.()?.getDebug()
        options = SendMessageOption.create(options)

        const logicFn = async () => {
            this.context.setOptions(options)
            await this.options.ready()

            const apiKey = await getKey(this.apiKey, this.multipleKeyStrategy)
            const histories = options.disableHistoryRead ? [] : await this.historyManager.getHistory(options.parentMessageId, options.conversationId)
            this.context.setHistoryMessages(histories)

            if (!options.conversationId) {
                options.conversationId = crypto.randomUUID()
            }

            let thisRequestMsg

            if (message) {
                const userMsgId = crypto.randomUUID()
                thisRequestMsg = {
                    id: userMsgId,
                    parentId: options.parentMessageId,
                    ...message,
                }

                if (!this.isEffectivelyEmptyMessage(thisRequestMsg)) {
                    histories.push(thisRequestMsg)
                } else if (debug) {
                    this.logger.debug('skip sending empty user message to model')
                }
            }

            const modelResponse = await this._sendMessage(histories, apiKey, options)

            // Save user request
            if (thisRequestMsg && this.shouldPersistHistory(thisRequestMsg)) {
                await this.historyManager.saveHistory(thisRequestMsg, options.conversationId)
                options.parentMessageId = thisRequestMsg.id
                modelResponse.parentId = thisRequestMsg.id
            }

            // Save model response
            if (this.shouldPersistHistory(modelResponse)) {
                await this.historyManager.saveHistory(modelResponse, options.conversationId)
            }

            options.parentMessageId = modelResponse.id

            // Handle tool calls with improved logic
            if (modelResponse.toolCalls && modelResponse.toolCalls.length > 0) {
                // 初始化工具调用追踪状态
                this.initToolCallTracking(options)
                const deduplicatedToolCalls = this.deduplicateToolCalls(modelResponse.toolCalls)
                if (deduplicatedToolCalls.length < modelResponse.toolCalls.length) {
                    this.logger.info(`[Tool] 去重后工具调用数: ${modelResponse.toolCalls.length} -> ${deduplicatedToolCalls.length}`)
                }
                
                // 检查工具调用限制（使用去重后的列表）
                const limitReason = this.updateToolCallTracking(options, deduplicatedToolCalls)
                if (limitReason) {
                    this.resetToolCallTracking(options)
                    
                    // 如果已有文本内容，返回它；否则返回限制提示
                    const textContent = modelResponse.content?.filter(c => c.type === 'text').map(c => c.text).join('') || ''
                    return {
                        id: modelResponse.id,
                        model: options.model,
                        contents: textContent ? modelResponse.content : [{ type: 'text', text: limitReason }],
                        usage: modelResponse.usage,
                        toolCallLogs: options._toolCallLogs || [],
                    }
                }
                
                const intermediateTextContent = modelResponse.content?.filter(c => c.type === 'text') || []
                const intermediateText = intermediateTextContent.map(c => c.text).join('').trim()
                
                // 触发工具调用中间消息回调（如果设置）
                // 这会在工具调用之前先发送模型的文本回复
                if (this.onMessageWithToolCall || options.onMessageWithToolCall) {
                    const callback = options.onMessageWithToolCall || this.onMessageWithToolCall
                    try {
                        await callback({
                            intermediateText,           // 中间文本回复
                            contents: modelResponse.content,  // 完整内容
                            toolCalls: deduplicatedToolCalls,  // 去重后的工具调用信息
                            isIntermediate: true       // 标记为中间消息
                        })
                    } catch (err) {
                        this.logger.warn('[Tool] 中间消息回调错误:', err.message)
                    }
                }

                // 执行工具调用
                const { toolCallResults, toolCallLogs } = await this.executeToolCalls(
                    deduplicatedToolCalls,
                    options
                )

                // 记录日志
                if (!options._toolCallLogs) options._toolCallLogs = []
                options._toolCallLogs.push(...toolCallLogs)

                // 保存工具调用结果到历史
                const tcMsgId = crypto.randomUUID()
                const toolCallResultMessage = {
                    role: 'tool',
                    content: toolCallResults,
                    id: tcMsgId,
                    parentId: options.parentMessageId,
                }
                options.parentMessageId = tcMsgId
                await this.historyManager.saveHistory(toolCallResultMessage, options.conversationId)

                // 追踪工具调用轮次（用于决定是否禁用工具）
                if (!options._toolCallCount) options._toolCallCount = 0
                options._toolCallCount++
                
                // 检测模型类型，Gemini 模型更容易陷入循环
                const modelStr = typeof options.model === 'string' ? options.model : ''
                const isGeminiModel = modelStr.toLowerCase().includes('gemini')
                const maxBeforeDisable = isGeminiModel ? 2 : 3
                
                // 连续调用超过阈值时禁用工具
                if (options._toolCallCount >= maxBeforeDisable) {
                    options.toolChoice = { type: 'none' }
                } else {
                    options.toolChoice = { type: 'auto' }
                }
                
                // 递归继续对话
                return await this.sendMessage(undefined, options)
            }
            
            // 无工具调用，重置追踪状态
            this.resetToolCallTracking(options)

            if (options.disableHistorySave) {
                await this.historyManager.deleteConversation(options.conversationId)
            }

            return {
                id: modelResponse.id,
                model: options.model,
                contents: modelResponse.content,
                usage: modelResponse.usage,
                toolCallLogs: options.toolCallLogs || [], // 返回工具调用日志
            }
        }

        if (!asyncLocalStorage.getStore()) {
            return asyncLocalStorage.run(this.context, async () => {
                return logicFn()
            })
        } else {
            return logicFn()
        }
    }

    /**
     * Check if message should be persisted
     * @param {HistoryMessage} [message]
     * @returns {boolean}
     */
    shouldPersistHistory(message) {
        if (!message) {
            return false
        }
        if (message.role === 'tool') {
            return this.hasMeaningfulContent(message)
        }
        if (message.role === 'assistant' || message.role === 'user') {
            return this.hasMeaningfulContent(message) || (message.toolCalls?.length ?? 0) > 0
        }
        return true
    }

    /**
     * Check if message is effectively empty
     * @param {IMessage} [message]
     * @returns {boolean}
     */
    isEffectivelyEmptyMessage(message) {
        if (!message) {
            return true
        }
        const hasContent = this.hasMeaningfulContent(message)
        const hasToolCall = (message.toolCalls?.length ?? 0) > 0
        return !hasContent && !hasToolCall
    }

    /**
     * Check if message has meaningful content
     * @param {IMessage} [message]
     * @returns {boolean}
     */
    hasMeaningfulContent(message) {
        if (!message || !message.content) {
            return false
        }
        // 处理字符串格式的 content
        if (typeof message.content === 'string') {
            return message.content.trim().length > 0
        }
        // 处理数组格式的 content
        if (!Array.isArray(message.content) || message.content.length === 0) {
            return false
        }
        return message.content.some(part => this.isMessagePartMeaningful(part))
    }

    /**
     * Check if message part is meaningful
     * @param {import('../types').MessageContent} [part]
     * @returns {boolean}
     */
    isMessagePartMeaningful(part) {
        if (!part) {
            return false
        }
        switch (part.type) {
            case 'text':
            case 'reasoning': {
                const text = part.text
                return typeof text === 'string' && text.trim().length > 0
            }
            case 'image':
                return Boolean(part.image)
            case 'audio':
                return Boolean(part.data)
            case 'tool':
                return Boolean(part.content)
            default:
                return true
        }
    }

    /**
     * Abstract method to be implemented by subclasses
     * @param {IMessage[]} _histories
     * @param {string} _apiKey
     * @param {SendMessageOption} _options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    async _sendMessage(_histories, _apiKey, _options) {
        throw new Error('Abstract class not implemented')
    }

    /**
     * Send message with history
     * @param {IMessage[]} history
     * @param {SendMessageOption | Partial<SendMessageOption>} [options]
     * @returns {Promise<IMessage & { usage: ModelUsage }>}
     */
    async sendMessageWithHistory(history, options) {
        const apiKey = await getKey(this.apiKey, this.multipleKeyStrategy || MultipleKeyStrategyChoice.RANDOM)
        return this._sendMessage(history, apiKey, SendMessageOption.create(options))
    }

    /**
     * Send message with streaming
     * @param {IMessage[]} history
     * @param {SendMessageOption | Partial<SendMessageOption>} [options]
     * @returns {Promise<AsyncGenerator<string, void, unknown>>}
     */
    async streamMessage(history, options) {
        throw new Error('Method not implemented.')
    }

    /**
     * Get embeddings (to be implemented by subclasses that support it)
     * @param {string | string[]} _text
     * @param {EmbeddingOption} _options
     * @returns {Promise<EmbeddingResult>}
     */
    async getEmbedding(_text, _options) {
        throw new Error('Method not implemented.')
    }

    // ==================== 工具调用辅助方法 ====================

    /**
     * 初始化工具调用追踪状态
     * @param {SendMessageOption} options
     */
    initToolCallTracking(options) {
        if (options._toolCallInitialized) return
        options._toolCallInitialized = true
        options._consecutiveToolCallCount = 0
        options._consecutiveIdenticalToolCallCount = 0
        options._consecutiveSimilarToolCallCount = 0
        options._totalToolCallCount = 0
        options._lastToolCallSignature = undefined
        options._lastSimplifiedSignature = undefined
        options._toolCallSignatureHistory = new Map()
        options._simplifiedSignatureHistory = new Map()  // 用于检测功能相似的调用
        options._successfulToolCalls = new Set()  // 追踪已成功执行的工具调用
        options._toolCallLogs = []
    }

    /**
     * 更新工具调用追踪并检查限制
     * @param {SendMessageOption} options
     * @param {Array} toolCalls
     * @returns {string|undefined} 如果超过限制返回原因
     */
    updateToolCallTracking(options, toolCalls) {
        const limitConfig = this.toolCallLimitConfig
        if (!limitConfig) return undefined

        // 递增连续调用计数
        options._consecutiveToolCallCount = (options._consecutiveToolCallCount || 0) + 1
        
        // 递增总调用计数
        options._totalToolCallCount = (options._totalToolCallCount || 0) + toolCalls.length

        // 检查最大连续调用次数
        if (limitConfig.maxConsecutiveCalls && options._consecutiveToolCallCount > limitConfig.maxConsecutiveCalls) {
            return `工具调用轮次超过限制(${limitConfig.maxConsecutiveCalls})，已自动停止`
        }
        
        // 检查总调用次数
        if (limitConfig.maxTotalToolCalls && options._totalToolCallCount > limitConfig.maxTotalToolCalls) {
            return `工具调用总次数超过限制(${limitConfig.maxTotalToolCalls})，已自动停止`
        }

        // ===== 精确签名检测（完全相同的调用）=====
        const signature = this.buildToolCallSignature(toolCalls)
        
        // 检查是否与上次调用完全相同
        if (options._lastToolCallSignature === signature) {
            options._consecutiveIdenticalToolCallCount = (options._consecutiveIdenticalToolCallCount || 0) + 1
            this.logger.warn(`[Tool] 检测到完全相同的重复调用 #${options._consecutiveIdenticalToolCallCount}`)
        } else {
            options._lastToolCallSignature = signature
            options._consecutiveIdenticalToolCallCount = 1
        }

        // 检查最大连续相同调用次数
        if (limitConfig.maxConsecutiveIdenticalCalls && 
            options._consecutiveIdenticalToolCallCount > limitConfig.maxConsecutiveIdenticalCalls) {
            return `检测到连续${options._consecutiveIdenticalToolCallCount}次完全相同的工具调用，已自动停止`
        }
        
        // ===== 简化签名检测（功能相似的调用，如 rmdir 和 rd）=====
        const simplifiedSig = this.buildSimplifiedSignature(toolCalls)
        
        // 检查是否与上次调用功能相似
        if (options._lastSimplifiedSignature === simplifiedSig) {
            options._consecutiveSimilarToolCallCount = (options._consecutiveSimilarToolCallCount || 0) + 1
            this.logger.warn(`[Tool] 检测到功能相似的重复调用 #${options._consecutiveSimilarToolCallCount}: ${simplifiedSig.substring(0, 80)}`)
        } else {
            options._lastSimplifiedSignature = simplifiedSig
            options._consecutiveSimilarToolCallCount = 1
        }
        
        // 检查最大连续相似调用次数
        if (limitConfig.maxSimilarCalls && 
            options._consecutiveSimilarToolCallCount > limitConfig.maxSimilarCalls) {
            return `检测到连续${options._consecutiveSimilarToolCallCount}次功能相似的工具调用`
        }
        
        // ===== 历史签名检测（防止循环调用）=====
        if (!options._toolCallSignatureHistory) {
            options._toolCallSignatureHistory = new Map()
        }
        const prevCount = options._toolCallSignatureHistory.get(signature) || 0
        options._toolCallSignatureHistory.set(signature, prevCount + 1)
        
        // 如果同一个调用出现超过2次，认为是循环
        if (prevCount >= 2) {
            return `工具调用"${toolCalls[0]?.function?.name}"已重复${prevCount + 1}次，检测到循环调用`
        }
        
        // ===== 简化签名历史检测 =====
        if (!options._simplifiedSignatureHistory) {
            options._simplifiedSignatureHistory = new Map()
        }
        const prevSimCount = options._simplifiedSignatureHistory.get(simplifiedSig) || 0
        options._simplifiedSignatureHistory.set(simplifiedSig, prevSimCount + 1)
        
        // 如果功能相似的调用出现超过3次，认为是循环
        if (prevSimCount >= 3) {
            return `功能相似的工具调用已重复${prevSimCount + 1}次，检测到循环调用`
        }
        
        // ===== 检测同一请求中的重复工具调用 =====
        if (toolCalls.length > 1) {
            const callSignatures = toolCalls.map(tc => `${tc.function?.name}:${tc.function?.arguments}`)
            const uniqueSignatures = new Set(callSignatures)
            if (uniqueSignatures.size < toolCalls.length) {
                this.logger.warn(`[Tool] 检测到同一响应中的重复工具调用，去重处理`)
                // 返回去重建议（但不阻止，由调用方决定是否去重）
            }
        }

        return undefined
    }

    /**
     * 重置工具调用追踪状态
     * @param {SendMessageOption} options
     */
    resetToolCallTracking(options) {
        options._consecutiveToolCallCount = 0
        options._consecutiveIdenticalToolCallCount = 0
        options._consecutiveSimilarToolCallCount = 0
        options._totalToolCallCount = 0
        options._lastToolCallSignature = undefined
        options._lastSimplifiedSignature = undefined
        options._toolCallSignatureHistory?.clear()
        options._simplifiedSignatureHistory?.clear()
        options._successfulToolCalls?.clear()
    }

    /**
     * 去重工具调用（移除同一响应中的重复调用）
     * @param {Array} toolCalls - 原始工具调用列表
     * @returns {Array} 去重后的工具调用列表
     */
    deduplicateToolCalls(toolCalls) {
        if (!toolCalls || toolCalls.length <= 1) return toolCalls
        
        const seen = new Map()
        const deduplicated = []
        
        for (const tc of toolCalls) {
            // 使用简化签名来检测功能相同的调用
            const sig = this.buildSimplifiedSignature([tc])
            if (!seen.has(sig)) {
                seen.set(sig, true)
                deduplicated.push(tc)
            } else {
                this.logger.warn(`[Tool] 去重: 移除重复调用 ${tc.function?.name}`)
            }
        }
        
        return deduplicated
    }

    /**
     * 构建工具调用签名
     * @param {Array} toolCalls
     * @returns {string}
     */
    buildToolCallSignature(toolCalls) {
        return JSON.stringify(toolCalls.map(tc => ({
            name: tc.function?.name,
            arguments: tc.function?.arguments,
        })))
    }

    /**
     * 构建工具调用的简化签名（用于检测功能相似的调用）
     * @param {Array} toolCalls
     * @returns {string}
     */
    buildSimplifiedSignature(toolCalls) {
        return toolCalls.map(tc => {
            const name = tc.function?.name || ''
            let args = tc.function?.arguments
            if (typeof args === 'string') {
                try { args = JSON.parse(args) } catch { args = {} }
            }
            args = args || {}
            
            // 对于 execute_command，提取命令的核心部分
            if (name === 'execute_command' && args.command) {
                // 规范化命令：统一删除命令别名
                let cmd = args.command.trim().toLowerCase()
                // rmdir /s /q 和 rd /s /q 是等价的
                cmd = cmd.replace(/^(rmdir|rd)\s+/i, 'DELETE_DIR ')
                // dir 和 ls 是等价的
                cmd = cmd.replace(/^(dir|ls)\s*/i, 'LIST ')
                return `${name}:${cmd}`
            }
            
            // 其他工具使用名称+关键参数
            return `${name}:${JSON.stringify(args)}`
        }).join('|')
    }

    /**
     * 执行工具调用（支持并行执行无依赖的工具）
     * @param {Array} toolCalls - 工具调用列表
     * @param {SendMessageOption} options
     * @returns {Promise<{toolCallResults: Array, toolCallLogs: Array}>}
     */
    async executeToolCalls(toolCalls, options) {
        const toolCallResults = []
        const toolCallLogs = []

        // 检测是否可以并行执行（多个工具调用且启用并行）
        const enableParallel = options.enableParallelToolCalls !== false && toolCalls.length > 1
        
        if (enableParallel) {
            // 并行执行所有工具调用
            const startTime = Date.now()
            const toolNames = toolCalls.map(t => t.function?.name || 'unknown').join(', ')
            this.logger.debug(`[Tool] 并行: ${toolNames}`)
            
            const results = await Promise.allSettled(
                toolCalls.map(toolCall => this.executeSingleToolCall(toolCall))
            )
            
            const totalDuration = Date.now() - startTime
            this.logger.debug(`[Tool] 并行完成: ${totalDuration}ms`)
            
            // 收集结果
            for (let i = 0; i < results.length; i++) {
                const result = results[i]
                const toolCall = toolCalls[i]
                
                if (result.status === 'fulfilled') {
                    toolCallResults.push(result.value.toolResult)
                    toolCallLogs.push(result.value.log)
                } else {
                    // Promise rejected
                    const fcName = toolCall.function?.name || 'unknown'
                    toolCallResults.push({
                        tool_call_id: toolCall.id,
                        content: `执行失败: ${result.reason?.message || 'Unknown error'}`,
                        type: 'tool',
                        name: fcName,
                    })
                    toolCallLogs.push({
                        name: fcName,
                        args: {},
                        result: `执行失败: ${result.reason?.message || 'Unknown error'}`,
                        duration: 0,
                        isError: true
                    })
                }
            }
        } else {
            // 串行执行
            for (const toolCall of toolCalls) {
                const { toolResult, log } = await this.executeSingleToolCall(toolCall)
                toolCallResults.push(toolResult)
                toolCallLogs.push(log)
            }
        }

        return { toolCallResults, toolCallLogs }
    }

    /**
     * 执行单个工具调用
     * @param {Object} toolCall - 工具调用对象
     * @returns {Promise<{toolResult: Object, log: Object}>}
     */
    async executeSingleToolCall(toolCall) {
        const fcName = toolCall.function?.name || toolCall.name
        let fcArgs = toolCall.function?.arguments || toolCall.arguments
        
        // 解析参数
        if (typeof fcArgs === 'string') {
            try {
                fcArgs = JSON.parse(fcArgs)
            } catch (e) {
                fcArgs = {}
            }
        }

        const tool = this.tools.find(t => t.function?.name === fcName || t.name === fcName)

        if (tool) {
            const startTime = Date.now()
            let toolResult
            let isError = false

            try {
                toolResult = await tool.run(fcArgs, this.context)
                if (typeof toolResult !== 'string') {
                    toolResult = JSON.stringify(toolResult)
                }
            } catch (err) {
                toolResult = `执行失败: ${err.message}`
                isError = true
            }

            const duration = Date.now() - startTime

            return {
                toolResult: {
                    tool_call_id: toolCall.id,
                    content: toolResult,
                    type: 'tool',
                    name: fcName,
                },
                log: {
                    name: fcName,
                    args: fcArgs,
                    result: toolResult.length > 500 ? toolResult.substring(0, 500) + '...' : toolResult,
                    duration,
                    isError
                }
            }
        } else {
            return {
                toolResult: {
                    tool_call_id: toolCall.id,
                    content: `工具 "${fcName}" 不存在或未启用`,
                    type: 'tool',
                    name: fcName,
                },
                log: {
                    name: fcName,
                    args: fcArgs,
                    result: '工具不存在',
                    duration: 0,
                    isError: true
                }
            }
        }
    }

    /**
     * 设置工具调用限制配置
     * @param {ToolCallLimitConfig} config
     */
    setToolCallLimitConfig(config) {
        this.toolCallLimitConfig = { ...DEFAULT_TOOL_CALL_LIMIT, ...config }
    }

    /**
     * 设置工具调用中间消息回调
     * @param {Function} callback - (content, toolCalls) => Promise<void>
     */
    setOnMessageWithToolCall(callback) {
        this.onMessageWithToolCall = callback
    }
}
