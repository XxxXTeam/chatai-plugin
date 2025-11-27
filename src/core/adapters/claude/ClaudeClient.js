import Anthropic from '@anthropic-ai/sdk'
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
 */

/**
 * Claude client implementation
 */
export class ClaudeClient extends AbstractClient {
    /**
     * @param {BaseClientOptions | Partial<BaseClientOptions>} options
     * @param {ChaiteContext} [context]
     */
    constructor(options, context) {
        super(options, context)
        this.name = 'claude'
    }

    /**
     * Send message to Claude
     * @param {IMessage[]} histories
     * @param {string} apiKey
     * @param {SendMessageOption} options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    async _sendMessage(histories, apiKey, options) {
        const client = new Anthropic({
            apiKey,
            baseURL: this.baseUrl,
        })

        const model = options.model || 'claude-3-5-sonnet-20241022'

        // Separate system prompt from history
        let systemPrompt = options.systemOverride || ''
        const converter = getFromChaiteConverter('claude')

        // Convert history to Claude format
        const messages = []
        for (const history of histories) {
            if (history.role === 'system') {
                // System messages become system parameter
                systemPrompt = history.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            } else {
                const claudeMsg = converter(history)
                if (Array.isArray(claudeMsg)) {
                    messages.push(...claudeMsg)
                } else {
                    messages.push(claudeMsg)
                }
            }
        }

        // Convert tools
        const toolConvert = getFromChaiteToolConverter('claude')
        const tools = this.tools.length > 0 ? this.tools.map(toolConvert) : undefined

        // Make API call
        const response = await client.messages.create({
            model,
            max_tokens: options.maxToken || 4096,
            temperature: options.temperature,
            system: systemPrompt || undefined,
            messages,
            tools,
        })

        logger.info('[Claude适配器] API响应:', JSON.stringify(response).substring(0, 300))

        if (!response) {
            throw new Error('API返回空响应')
        }

        const id = crypto.randomUUID()
        const toChaiteConverter = getIntoChaiteConverter('claude')

        // Convert response to Chaite format
        const chaiteMessage = toChaiteConverter(response)

        const usage = {
            promptTokens: response.usage?.input_tokens,
            completionTokens: response.usage?.output_tokens,
            totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
        }

        return {
            id,
            parentId: options.parentMessageId,
            role: 'assistant',
            content: chaiteMessage.content || [],
            toolCalls: chaiteMessage.toolCalls || [],
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
        const client = new Anthropic({
            apiKey,
            baseURL: this.baseUrl,
        })

        const model = options.model || 'claude-3-5-sonnet-20241022'

        let systemPrompt = options.systemOverride || ''
        const converter = getFromChaiteConverter('claude')

        const messages = []
        for (const history of histories) {
            if (history.role === 'system') {
                systemPrompt = history.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            } else {
                const claudeMsg = converter(history)
                if (Array.isArray(claudeMsg)) {
                    messages.push(...claudeMsg)
                } else {
                    messages.push(claudeMsg)
                }
            }
        }

        const toolConvert = getFromChaiteToolConverter('claude')
        const tools = this.tools.length > 0 ? this.tools.map(toolConvert) : undefined

        const stream = await client.messages.create({
            model,
            max_tokens: options.maxToken || 4096,
            temperature: options.temperature,
            system: systemPrompt || undefined,
            messages,
            tools,
            stream: true,
        })

        async function* generator() {
            for await (const event of stream) {
                if (event.type === 'content_block_delta') {
                    if (event.delta.type === 'text_delta') {
                        yield event.delta.text
                    }
                }
            }
        }

        return generator()
    }

    /**
     * Claude doesn't have a native embedding API
     * This will throw an error
     */
    async getEmbedding(_text, _options) {
        throw new Error('Claude does not support embeddings. Please use OpenAI or other providers.')
    }
}
