import OpenAI from 'openai'
import crypto from 'node:crypto'
import { AbstractClient, preprocessImageUrls, needsImageBase64Preprocess } from '../AbstractClient.js'
import { getFromChaiteConverter, getFromChaiteToolConverter, getIntoChaiteConverter } from '../../utils/converter.js'
import './converter.js'

/**
 * @typedef {import('../../types').BaseClientOptions} BaseClientOptions
 * @typedef {import('../../types').ChaiteContext} ChaiteContext
 * @typedef {import('../../types').SendMessageOption} SendMessageOption
 * @typedef {import('../../types').IMessage} IMessage
 * @typedef {import('../../types').HistoryMessage} HistoryMessage
 * @typedef {import('../../types').ModelUsage} ModelUsage
 * @typedef {import('../../types').EmbeddingOption} EmbeddingOption
 * @typedef {import('../../types').EmbeddingResult} EmbeddingResult
 */

/**
 * OpenAI client implementation
 */
export class OpenAIClient extends AbstractClient {
    /**
     * @param {BaseClientOptions | Partial<BaseClientOptions>} options
     * @param {ChaiteContext} [context]
     */
    constructor(options, context) {
        super(options, context)
        this.name = 'openai'
    }

    /**
     * Send message to OpenAI
     * @param {IMessage[]} histories
     * @param {string} apiKey
     * @param {SendMessageOption} options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    async _sendMessage(histories, apiKey, options) {
        const client = new OpenAI({
            apiKey,
            baseURL: this.baseUrl,
        })

        const messages = []
        const model = options.model || 'gpt-4o-mini'

        // Gemini模型需要将图片URL转为base64
        if (needsImageBase64Preprocess(model)) {
            histories = await preprocessImageUrls(histories)
        }
        const isThinkingModel = options.enableReasoning || options.isThinkingModel

        if (options.systemOverride) {
            if (isThinkingModel) {
                messages.push({ role: 'developer', content: options.systemOverride })
            } else {
                messages.push({ role: 'system', content: options.systemOverride })
            }
        }

        const converter = getFromChaiteConverter('openai')
        for (const history of histories) {
            let openaiMsg = converter(history)
            if (!Array.isArray(openaiMsg)) {
                openaiMsg = [openaiMsg]
            }
            messages.push(...openaiMsg)
        }

        const toolConvert = getFromChaiteToolConverter('openai')
        let toolChoice = 'auto'

        if (options.toolChoice?.type) {
            switch (options.toolChoice.type) {
                case 'auto':
                    break
                case 'none':
                    toolChoice = 'none'
                    break
                case 'any':
                    toolChoice = 'required'
                    break
                case 'specified': {
                    if (!options.toolChoice.tools || options.toolChoice.tools.length === 0) {
                        throw new Error('`toolChoice.tools` must be set if `toolChoice.type` is set to `specified`')
                    }
                    toolChoice = {
                        type: 'function',
                        function: {
                            name: options.toolChoice.tools[0],
                        },
                    }
                    break
                }
            }
        }

        // 当 toolChoice 为 'none' 时，完全不传递 tools 参数，强制LLM只生成文本
        const shouldDisableTools = toolChoice === 'none'
        const tools = shouldDisableTools ? [] : this.tools.map(toolConvert)

        const requestPayload = {
            temperature: options.temperature,
            messages,
            model,
            stream: false, // Explicitly set stream to false for non-streaming requests
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: tools.length > 0 ? toolChoice : undefined,
        }

        if (isThinkingModel) {
            requestPayload.max_completion_tokens = options.maxToken
            // Only add reasoning_effort if explicitly set, as not all APIs support it
            if (options.reasoningEffort) {
                requestPayload.reasoning_effort = options.reasoningEffort
            }
        } else {
            requestPayload.max_tokens = options.maxToken
        }

        // Remove undefined/null values to prevent API errors
        Object.keys(requestPayload).forEach(key => {
            if (requestPayload[key] === undefined || requestPayload[key] === null) {
                delete requestPayload[key]
            }
        })

        // Debug logging - log the request payload
        logger.info('[OpenAI适配器] 请求参数:', JSON.stringify({
            model: requestPayload.model,
            stream: requestPayload.stream,
            temperature: requestPayload.temperature,
            max_tokens: requestPayload.max_tokens,
            max_completion_tokens: requestPayload.max_completion_tokens,
            reasoning_effort: requestPayload.reasoning_effort,
            messages_count: requestPayload.messages?.length,
            tools_count: requestPayload.tools?.length || 0,
            tool_choice: requestPayload.tool_choice,
        }))

        // 打印工具列表（仅名称）- 仅debug级别
        if (requestPayload.tools?.length > 0) {
            const toolNames = requestPayload.tools.map(t => t.function?.name).filter(Boolean)
            logger.debug('[OpenAI适配器] 可用工具:', toolNames.join(', '))
        }

        // Log actual messages for debugging - 使用简化格式避免base64刷屏
        if (logger.level === 'debug') {
            const sanitizedMessages = this.sanitizeMessagesForLog(requestPayload.messages)
            logger.debug('[OpenAI适配器] 实际Messages内容:', JSON.stringify(sanitizedMessages, null, 2))
        }

        let chatCompletion
        try {
            chatCompletion = await client.chat.completions.create(requestPayload)
            
            // 简化响应日志
            const firstChoice = chatCompletion.choices?.[0]
            const toolCallCount = firstChoice?.message?.tool_calls?.length || 0
            const hasContent = !!firstChoice?.message?.content
            logger.info(`[OpenAI适配器] 响应: finish=${firstChoice?.finish_reason}, tools=${toolCallCount}, hasContent=${hasContent}`)
            
            // debug级别打印完整tool_calls
            if (toolCallCount > 0) {
                const toolNames = firstChoice.message.tool_calls.map(t => t.function?.name).join(', ')
                logger.debug(`[OpenAI适配器] tool_calls: ${toolNames}`)
            }
        } catch (error) {
            // Log detailed error information from the API
            logger.error('[OpenAI适配器] API错误详情:', {
                status: error.status,
                code: error.code,
                type: error.type,
                message: error.message,
                error: error.error,
                headers: error.headers
            })
            // Re-throw to be handled by caller
            throw error
        }

        // Defensive check
        if (!chatCompletion || !chatCompletion.choices || !Array.isArray(chatCompletion.choices)) {
            logger.error('[OpenAI适配器] 响应格式错误，完整响应:', JSON.stringify(chatCompletion))
            throw new Error('API返回格式不符合OpenAI标准: choices字段缺失或格式错误')
        }

        const id = crypto.randomUUID()
        const toChaiteConverter = getIntoChaiteConverter('openai')

        const contents = chatCompletion.choices
            .map(ch => ch.message)
            .map(toChaiteConverter)
            .filter(ch => ch.content && ch.content.length > 0)
            .map(ch => ch.content)
            .reduce((a, b) => [...a, ...b], [])

        const result = {
            id,
            parentId: options.parentMessageId,
            role: 'assistant',
            content: contents,
            toolCalls: chatCompletion.choices
                .map(ch => ch.message)
                .map(toChaiteConverter)
                .filter(ch => ch.toolCalls)
                .map(ch => ch.toolCalls)
                .reduce((a, b) => [...a, ...b], []),
        }

        const usage = {
            promptTokens: chatCompletion.usage?.prompt_tokens,
            completionTokens: chatCompletion.usage?.completion_tokens,
            totalTokens: chatCompletion.usage?.total_tokens,
            cachedTokens: chatCompletion.usage?.prompt_tokens_details?.cached_tokens,
            reasoningTokens: chatCompletion.usage?.completion_tokens_details?.reasoning_tokens,
        }

        return {
            ...result,
            usage,
        }
    }

    /**
     * Send message with streaming
     * @param {IMessage[]} histories
     * @param {SendMessageOption | Partial<SendMessageOption>} options
     * @returns {Promise<AsyncGenerator<string, void, unknown>>}
     */
    async streamMessage(histories, options) {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const client = new OpenAI({
            apiKey,
            baseURL: this.baseUrl,
        })

        const messages = []
        const model = options.model || 'gpt-4o-mini'

        // Gemini模型需要将图片URL转为base64
        if (needsImageBase64Preprocess(model)) {
            histories = await preprocessImageUrls(histories)
        }
        const isThinkingModel = options.enableReasoning || options.isThinkingModel

        if (options.systemOverride) {
            if (isThinkingModel) {
                messages.push({ role: 'developer', content: options.systemOverride })
            } else {
                messages.push({ role: 'system', content: options.systemOverride })
            }
        }

        const converter = getFromChaiteConverter('openai')
        for (const history of histories) {
            let openaiMsg = converter(history)
            if (!Array.isArray(openaiMsg)) {
                openaiMsg = [openaiMsg]
            }
            messages.push(...openaiMsg)
        }

        const toolConvert = getFromChaiteToolConverter('openai')
        let toolChoice = 'auto'

        if (options.toolChoice?.type) {
            switch (options.toolChoice.type) {
                case 'auto':
                    break
                case 'none':
                    toolChoice = 'none'
                    break
                case 'any':
                    toolChoice = 'required'
                    break
                case 'specified': {
                    if (!options.toolChoice.tools || options.toolChoice.tools.length === 0) {
                        throw new Error('`toolChoice.tools` must be set if `toolChoice.type` is set to `specified`')
                    }
                    toolChoice = {
                        type: 'function',
                        function: {
                            name: options.toolChoice.tools[0],
                        },
                    }
                    break
                }
            }
        }

        // 当 toolChoice 为 'none' 时，完全不传递 tools 参数，强制LLM只生成文本
        const shouldDisableTools = toolChoice === 'none'
        const tools = shouldDisableTools ? [] : this.tools.map(toolConvert)

        const requestPayload = {
            temperature: options.temperature,
            messages,
            model,
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: tools.length > 0 ? toolChoice : undefined,
            stream: true,
        }

        if (isThinkingModel) {
            requestPayload.max_completion_tokens = options.maxToken
            // Only add reasoning_effort if explicitly set, as not all APIs support it
            if (options.reasoningEffort) {
                requestPayload.reasoning_effort = options.reasoningEffort
            }
        } else {
            requestPayload.max_tokens = options.maxToken
        }

        // Remove undefined/null values to prevent API errors
        Object.keys(requestPayload).forEach(key => {
            if (requestPayload[key] === undefined || requestPayload[key] === null) {
                delete requestPayload[key]
            }
        })

        // 简化日志
        logger.info('[OpenAI适配器] Streaming请求:', JSON.stringify({
            model: requestPayload.model,
            messages_count: requestPayload.messages?.length,
            tools_count: requestPayload.tools?.length || 0,
        }))

        let stream
        try {
            stream = await client.chat.completions.create(requestPayload)
        } catch (error) {
            logger.error('[OpenAI适配器] Streaming API错误:', error.message)
            throw error
        }

        async function* generator() {
            let allReasoning = ''  // 累积所有reasoning_content
            let allContent = ''    // 累积content用于<think>标签解析
            let hasReasoningField = false  // 是否检测到reasoning_content字段
            let checkedThinkTag = false    // 是否已检查<think>标签
            let hasThinkTag = false        // 是否有<think>标签
            
            // Tool calls 累积
            const toolCallsMap = new Map() // id -> {id, type, function: {name, arguments}}
            let hasToolCalls = false

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta || {}
                const content = delta.content || ''
                const reasoningContent = delta.reasoning_content || ''
                const toolCallsDelta = delta.tool_calls || []
                const finishReason = chunk.choices[0]?.finish_reason

                // 处理 tool_calls（流式累积）
                for (const tc of toolCallsDelta) {
                    hasToolCalls = true
                    const idx = tc.index
                    if (!toolCallsMap.has(idx)) {
                        toolCallsMap.set(idx, {
                            id: tc.id || '',
                            type: tc.type || 'function',
                            function: { name: '', arguments: '' }
                        })
                    }
                    const existing = toolCallsMap.get(idx)
                    if (tc.id) existing.id = tc.id
                    if (tc.function?.name) existing.function.name += tc.function.name
                    if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
                }

                // 处理 reasoning_content 字段（优先）
                if (reasoningContent) {
                    hasReasoningField = true
                    allReasoning += reasoningContent
                }

                // 处理 content 字段
                if (content) {
                    // 如果已经有 reasoning_content 字段，content 就是普通文本，实时输出
                    if (hasReasoningField) {
                        yield { type: 'text', text: content }
                        continue
                    }
                    
                    // 已确认没有<think>标签，实时输出
                    if (checkedThinkTag && !hasThinkTag) {
                        yield { type: 'text', text: content }
                        continue
                    }
                    
                    // 累积内容用于检查<think>标签
                    allContent += content
                    
                    // 首次检查是否有<think>标签
                    if (!checkedThinkTag && allContent.length >= 10) {
                        checkedThinkTag = true
                        hasThinkTag = /^\s*<think>/i.test(allContent)
                        
                        // 没有<think>标签，立即输出已累积的内容
                        if (!hasThinkTag) {
                            yield { type: 'text', text: allContent }
                            allContent = ''
                        }
                    }
                }
                
                // 日志：检测到 finish_reason
                if (finishReason) {
                    logger.debug(`[OpenAI适配器] Stream finish_reason: ${finishReason}`)
                }
            }

            // 处理完所有 chunk 后
            
            // 输出 tool_calls
            if (hasToolCalls) {
                const toolCalls = Array.from(toolCallsMap.values())
                logger.info(`[OpenAI适配器] 流式检测到 ${toolCalls.length} 个工具调用:`, 
                    toolCalls.map(t => t.function.name).join(', '))
                yield { type: 'tool_calls', toolCalls }
            }
            
            if (hasReasoningField) {
                // 有 reasoning_content 字段，最后输出思考内容
                if (allReasoning.trim()) {
                    logger.info('[OpenAI适配器] 输出reasoning_content，长度:', allReasoning.length)
                    yield { type: 'reasoning', text: allReasoning.trim() }
                }
            } else if (allContent) {
                // 检查 <think> 标签
                const thinkMatch = allContent.match(/^\s*<think>([\s\S]*?)<\/think>\s*/i)
                if (thinkMatch) {
                    const thinkContent = thinkMatch[1].trim()
                    const restContent = allContent.substring(thinkMatch[0].length).trim()

                    if (thinkContent) {
                        logger.info('[OpenAI适配器] 检测到<think>标签，输出思考内容，长度:', thinkContent.length)
                        yield { type: 'reasoning', text: thinkContent }
                    }
                    if (restContent) {
                        yield { type: 'text', text: restContent }
                    }
                } else if (!checkedThinkTag) {
                    // 内容太短，没检查过<think>，直接作为text输出
                    yield { type: 'text', text: allContent }
                }
            }
            
            // 日志：流式结束
            logger.debug(`[OpenAI适配器] Stream完成: content=${allContent.length}字符, toolCalls=${hasToolCalls}`)
        }

        return generator()
    }

    /**
     * 简化消息内容用于日志，避免base64刷屏
     * @param {Array} messages - 消息数组
     * @returns {Array} 简化后的消息
     */
    sanitizeMessagesForLog(messages) {
        if (!messages) return []
        return messages.map(msg => {
            const sanitized = { ...msg }
            // 处理 content 数组（多模态消息）
            if (Array.isArray(msg.content)) {
                sanitized.content = msg.content.map(item => {
                    if (item.type === 'image_url' && item.image_url?.url) {
                        const url = item.image_url.url
                        if (url.startsWith('data:')) {
                            // base64 图片，只显示前50字符
                            return { type: 'image_url', image_url: { url: url.substring(0, 50) + '...[base64 truncated]' } }
                        }
                        return item
                    }
                    if (item.type === 'text' && item.text?.length > 500) {
                        return { type: 'text', text: item.text.substring(0, 500) + '...[truncated]' }
                    }
                    return item
                })
            }
            // 处理 content 字符串
            else if (typeof msg.content === 'string' && msg.content.length > 1000) {
                sanitized.content = msg.content.substring(0, 1000) + '...[truncated]'
            }
            return sanitized
        })
    }

    /**
     * Get embeddings
     * @param {string | string[]} text
     * @param {EmbeddingOption} options
     * @returns {Promise<EmbeddingResult>}
     */
    async getEmbedding(text, options) {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const client = new OpenAI({
            apiKey,
            baseURL: this.baseUrl,
        })

        const embeddings = await client.embeddings.create({
            input: text,
            dimensions: options.dimensions,
            model: options.model,
        })

        return {
            embeddings: embeddings.data.map(e => e.embedding),
        }
    }
}
