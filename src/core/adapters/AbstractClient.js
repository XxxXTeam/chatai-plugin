import crypto from 'node:crypto'
import { BaseClientOptions, ChaiteContext, DefaultLogger, MultipleKeyStrategyChoice, SendMessageOption } from '../types/index.js'
import DefaultHistoryManager from '../utils/history.js'
import { asyncLocalStorage, extractClassName, getKey } from '../utils/index.js'

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

            // Handle tool calls
            if (modelResponse.toolCalls && modelResponse.toolCalls.length > 0) {
                // 初始化工具调用追踪
                if (!options.toolCallDepth) options.toolCallDepth = 0
                if (!options.toolCallHistory) options.toolCallHistory = new Map() // 存储调用签名 -> 结果
                if (!options.toolCallLogs) options.toolCallLogs = []
                
                options.toolCallDepth++
                const maxDepth = 10 // 最大递归深度
                
                // 检查是否超过最大深度
                if (options.toolCallDepth > maxDepth) {
                    this.logger.warn(`[Tool] 工具调用深度超过限制(${maxDepth})，停止递归`)
                    return {
                        id: modelResponse.id,
                        model: options.model,
                        contents: [{ type: 'text', text: '工具调用次数过多，已自动停止。' }],
                        usage: modelResponse.usage,
                        toolCallLogs: options.toolCallLogs,
                    }
                }

                const toolCallResults = []
                const toolCallLogs = []
                let hasNewToolCall = false

                for (const toolCall of modelResponse.toolCalls) {
                    const fcName = toolCall.function.name
                    const fcArgs = toolCall.function.arguments
                    const tool = this.tools.find(t => t.function.name === fcName)
                    
                    // 生成工具调用签名用于去重
                    const callSignature = `${fcName}:${JSON.stringify(fcArgs)}`
                    
                    // 检查是否重复调用（相同工具+相同参数）
                    if (options.toolCallHistory.has(callSignature)) {
                        const previousResult = options.toolCallHistory.get(callSignature)
                        this.logger.warn(`[Tool] 检测到重复调用: ${fcName}，返回缓存结果`)
                        toolCallResults.push({
                            tool_call_id: toolCall.id,
                            content: `[此工具已调用过，以下是之前的结果]\n${previousResult}`,
                            type: 'tool',
                            name: fcName,
                        })
                        continue
                    }
                    
                    hasNewToolCall = true

                    if (tool) {
                        this.logger.info(`[Tool] 执行: ${fcName}`)
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
                            this.logger.error(`[Tool] ${fcName} 执行错误:`, err.message)
                        }
                        const duration = Date.now() - startTime
                        this.logger.info(`[Tool] ${fcName} 完成，耗时 ${duration}ms`)
                        
                        toolCallLogs.push({
                            name: fcName,
                            args: fcArgs,
                            result: toolResult.substring(0, 500),
                            duration,
                            isError
                        })
                        
                        // 存储工具调用结果用于重复检测
                        options.toolCallHistory.set(callSignature, toolResult)
                        
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
                            content: `工具 ${fcName} 不存在`,
                            type: 'tool',
                            name: fcName,
                        })
                    }
                }

                options.toolCallLogs.push(...toolCallLogs)

                // 如果没有新的工具调用（全部重复），仍需推送结果给LLM让其生成最终回复
                if (!hasNewToolCall) {
                    this.logger.warn('[Tool] 所有工具调用均为重复，推送跳过结果给LLM并禁用工具')
                }

                const tcMsgId = crypto.randomUUID()
                const toolCallResultMessage = {
                    role: 'tool',
                    content: toolCallResults,
                    id: tcMsgId,
                    parentId: options.parentMessageId,
                }
                options.parentMessageId = tcMsgId
                await this.historyManager.saveHistory(toolCallResultMessage, options.conversationId)

                // 如果全部重复，禁用工具调用强制LLM生成文本回复；否则重置为auto
                if (!hasNewToolCall) {
                    options.toolChoice = { type: 'none' }
                } else {
                    options.toolChoice = { type: 'auto' }
                }
                return await this.sendMessage(undefined, options)
            }

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
}
