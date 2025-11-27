import OpenAI from 'openai'
import crypto from 'node:crypto'
import { AbstractClient } from '../AbstractClient.js'
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

        const tools = this.tools.map(toolConvert)

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
        }))

        // Log actual messages for debugging
        logger.info('[OpenAI适配器] 实际Messages内容:', JSON.stringify(requestPayload.messages, null, 2))

        let chatCompletion
        try {
            chatCompletion = await client.chat.completions.create(requestPayload)
            // Debug logging
            logger.info('[OpenAI适配器] API响应:', JSON.stringify(chatCompletion).substring(0, 300))
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
        const tools = this.tools.map(toolConvert)

        const requestPayload = {
            temperature: options.temperature,
            messages,
            model,
            tools: tools.length > 0 ? tools : undefined,
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

        // Debug logging - log the request payload
        logger.info('[OpenAI适配器] Streaming请求参数:', JSON.stringify({
            model: requestPayload.model,
            stream: requestPayload.stream,
            temperature: requestPayload.temperature,
            max_tokens: requestPayload.max_tokens,
            max_completion_tokens: requestPayload.max_completion_tokens,
            reasoning_effort: requestPayload.reasoning_effort,
            messages_count: requestPayload.messages?.length,
        }))

        // Log actual messages for debugging
        logger.info('[OpenAI适配器] 实际Messages内容:', JSON.stringify(requestPayload.messages, null, 2))

        let stream
        try {
            stream = await client.chat.completions.create(requestPayload)
        } catch (error) {
            // Log detailed error information from the API
            logger.error('[OpenAI适配器] Streaming API错误详情:', {
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


        async function* generator() {
            let buffer = ''
            let allContent = '' // 累积所有内容，直到遇到</think>
            let foundThinkEnd = false

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || ''
                if (!content) continue

                buffer += content

                // 检查是否包含</think>结束标签
                const thinkEndMatch = buffer.match(/<\/think>/i)

                if (thinkEndMatch && !foundThinkEnd) {
                    // 找到了</think>标签
                    foundThinkEnd = true

                    // 将之前累积的所有内容加上</think>之前的部分，作为thinking内容
                    const thinkContent = allContent + buffer.substring(0, thinkEndMatch.index)

                    if (thinkContent.trim()) {
                        logger.info('[OpenAI适配器] 检测到</think>，输出思考内容，长度:', thinkContent.length)
                        yield { type: 'reasoning', text: thinkContent.trim() }
                    }

                    // 剩余部分继续作为普通文本
                    buffer = buffer.substring(thinkEndMatch.index + thinkEndMatch[0].length)
                    allContent = ''

                    // 如果剩余buffer有内容，输出
                    if (buffer.trim()) {
                        yield { type: 'text', text: buffer }
                        buffer = ''
                    }
                } else if (!foundThinkEnd) {
                    // 还没找到</think>，继续累积
                    // 保留最后10个字符防止</think>被分割
                    const safeLength = Math.max(0, buffer.length - 10)
                    if (safeLength > 0) {
                        allContent += buffer.substring(0, safeLength)
                        buffer = buffer.substring(safeLength)
                    }
                } else {
                    // 已经过了</think>，之后的都是正常内容
                    yield { type: 'text', text: content }
                }
            }

            // 处理剩余内容
            if (buffer || allContent) {
                logger.info('[OpenAI适配器] 处理剩余缓冲区, foundThinkEnd:', foundThinkEnd, 'allContent长度:', allContent.length, 'buffer长度:', buffer.length)

                if (!foundThinkEnd && (allContent || buffer)) {
                    // 没有找到</think>，说明整段都是思考内容
                    const finalContent = allContent + buffer
                    if (finalContent.trim()) {
                        yield { type: 'reasoning', text: finalContent.trim() }
                    }
                } else if (buffer) {
                    // 有剩余的正常内容
                    yield { type: 'text', text: buffer }
                }
            }
        }

        return generator()
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
