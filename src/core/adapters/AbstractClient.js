import crypto from 'node:crypto'
import { BaseClientOptions, ChaiteContext, DefaultLogger, MultipleKeyStrategyChoice, SendMessageOption } from '../types/index.js'
import DefaultHistoryManager from '../utils/history.js'
import { asyncLocalStorage, extractClassName, getKey } from '../utils/index.js'

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
    maxConsecutiveCalls: 10,
    maxConsecutiveIdenticalCalls: 2
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
                // 调试日志：打印解析后的 toolCalls
                this.logger.info('[Tool] 解析后的toolCalls:', JSON.stringify(modelResponse.toolCalls, null, 2))
                
                // 初始化工具调用追踪状态
                this.initToolCallTracking(options)
                
                // 检查工具调用限制
                const limitReason = this.updateToolCallTracking(options, modelResponse.toolCalls)
                if (limitReason) {
                    this.logger.warn(`[Tool] ${limitReason}`)
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

                // 触发工具调用中间消息回调（如果设置）
                if (this.onMessageWithToolCall || options.onMessageWithToolCall) {
                    const callback = options.onMessageWithToolCall || this.onMessageWithToolCall
                    for (const content of (modelResponse.content || [])) {
                        try {
                            await callback(content, modelResponse.toolCalls)
                        } catch (err) {
                            this.logger.warn(`[Tool] 中间消息回调错误: ${err.message}`)
                        }
                    }
                }

                // 执行工具调用
                const { toolCallResults, toolCallLogs } = await this.executeToolCalls(
                    modelResponse.toolCalls,
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

                // 追踪工具调用次数
                if (!options._toolCallCount) options._toolCallCount = 0
                options._toolCallCount++
                
                // 只在连续调用超过3次时才禁用工具
                if (options._toolCallCount >= 3) {
                    this.logger.warn(`[Tool] 已执行${options._toolCallCount}次工具调用，禁用工具强制生成回复`)
                    options.toolChoice = { type: 'none' }
                } else {
                    this.logger.info(`[Tool] 已执行${options._toolCallCount}次工具调用，继续允许调用`)
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
        options._lastToolCallSignature = undefined
        options._toolCallHistory = new Map()
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

        // 检查最大连续调用次数
        if (limitConfig.maxConsecutiveCalls && options._consecutiveToolCallCount > limitConfig.maxConsecutiveCalls) {
            return `工具调用次数超过限制(${limitConfig.maxConsecutiveCalls})，已自动停止`
        }

        // 构建调用签名用于检测重复
        const signature = this.buildToolCallSignature(toolCalls)
        if (options._lastToolCallSignature === signature) {
            options._consecutiveIdenticalToolCallCount = (options._consecutiveIdenticalToolCallCount || 0) + 1
        } else {
            options._lastToolCallSignature = signature
            options._consecutiveIdenticalToolCallCount = 1
        }

        // 检查最大连续相同调用次数
        if (limitConfig.maxConsecutiveIdenticalCalls && 
            options._consecutiveIdenticalToolCallCount > limitConfig.maxConsecutiveIdenticalCalls) {
            return `检测到连续${options._consecutiveIdenticalToolCallCount}次相同工具调用，已自动停止`
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
        options._lastToolCallSignature = undefined
        // 保留 _toolCallHistory 用于返回日志，但清除缓存
        // options._toolCallHistory?.clear()
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
     * 执行工具调用（无签名/缓存，每次都执行）
     * @param {Array} toolCalls - 工具调用列表
     * @param {SendMessageOption} options
     * @returns {Promise<{toolCallResults: Array, toolCallLogs: Array}>}
     */
    async executeToolCalls(toolCalls, options) {
        const toolCallResults = []
        const toolCallLogs = []

        for (const toolCall of toolCalls) {
            const fcName = toolCall.function.name
            let fcArgs = toolCall.function.arguments
            
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
                this.logger.info(`[Tool] 执行: ${fcName}`, JSON.stringify(fcArgs))
                this.logger.info(`[Tool] tool_call_id: ${toolCall.id}`)
                const startTime = Date.now()
                let toolResult
                let isError = false

                try {
                    toolResult = await tool.run(fcArgs, this.context)
                    if (typeof toolResult !== 'string') {
                        toolResult = JSON.stringify(toolResult)
                    }
                    this.logger.info(`[Tool] ${fcName} 返回结果: ${toolResult.substring(0, 200)}${toolResult.length > 200 ? '...' : ''}`)
                } catch (err) {
                    toolResult = `执行失败: ${err.message}`
                    isError = true
                    this.logger.error(`[Tool] ${fcName} 执行错误:`, err.message)
                }

                const duration = Date.now() - startTime
                this.logger.info(`[Tool] ${fcName} 完成，耗时 ${duration}ms`)

                toolCallLogs.push({
                    name: fcName,
                    args: fcArgs,
                    result: toolResult.length > 500 ? toolResult.substring(0, 500) + '...' : toolResult,
                    duration,
                    isError
                })
                
                toolCallResults.push({
                    tool_call_id: toolCall.id,
                    content: toolResult,
                    type: 'tool',
                    name: fcName,
                })
            } else {
                this.logger.warn(`[Tool] 未找到工具: ${fcName}`)
                toolCallResults.push({
                    tool_call_id: toolCall.id,
                    content: `工具 "${fcName}" 不存在或未启用`,
                    type: 'tool',
                    name: fcName,
                })
                toolCallLogs.push({
                    name: fcName,
                    args: fcArgs,
                    result: '工具不存在',
                    duration: 0,
                    isError: true
                })
            }
        }

        return { toolCallResults, toolCallLogs }
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
