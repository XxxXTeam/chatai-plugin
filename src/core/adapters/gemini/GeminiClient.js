import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
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
 * Gemini client implementation
 */
export class GeminiClient extends AbstractClient {
    /**
     * @param {BaseClientOptions | Partial<BaseClientOptions>} options
     * @param {ChaiteContext} [context]
     */
    constructor(options, context) {
        super(options, context)
        this.name = 'gemini'
    }

    /**
     * Send message to Gemini
     * @param {IMessage[]} histories
     * @param {string} apiKey
     * @param {SendMessageOption} options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    async _sendMessage(histories, apiKey, options) {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = options.model || 'gemini-1.5-flash'

        // Separate system prompt from history
        let systemInstruction = options.systemOverride || ''
        const converter = getFromChaiteConverter('gemini')

        // Convert history to Gemini format
        const contents = []
        for (const history of histories) {
            if (history.role === 'system') {
                // System messages become system instruction
                systemInstruction = history.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            } else {
                const geminiContent = converter(history)
                if (Array.isArray(geminiContent)) {
                    contents.push(...geminiContent)
                } else {
                    contents.push(geminiContent)
                }
            }
        }

        // Configure safety settings
        const safetySettings = [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
        ]

        // Convert tools
        const toolConvert = getFromChaiteToolConverter('gemini')
        const tools = this.tools.length > 0 ? this.tools.map(toolConvert) : undefined

        // Create generative model
        const generativeModel = genAI.getGenerativeModel({
            model,
            systemInstruction: systemInstruction || undefined,
            safetySettings,
            tools: tools ? [{ functionDeclarations: tools }] : undefined,
            generationConfig: {
                temperature: options.temperature,
                maxOutputTokens: options.maxToken,
            },
        })

        // Generate content
        const result = await generativeModel.generateContent({
            contents,
        })

        const response = result.response

        logger.info('[Gemini适配器] API响应:', JSON.stringify(response).substring(0, 300))

        if (!response) {
            throw new Error('API返回空响应')
        }

        const id = crypto.randomUUID()
        const toChaiteConverter = getIntoChaiteConverter('gemini')

        // Convert response to Chaite format
        const chaiteMessage = toChaiteConverter(response)

        const usage = {
            promptTokens: response.usageMetadata?.promptTokenCount,
            completionTokens: response.usageMetadata?.candidatesTokenCount,
            totalTokens: response.usageMetadata?.totalTokenCount,
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
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = options.model || 'gemini-1.5-flash'

        let systemInstruction = options.systemOverride || ''
        const converter = getFromChaiteConverter('gemini')

        const contents = []
        for (const history of histories) {
            if (history.role === 'system') {
                systemInstruction = history.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            } else {
                const geminiContent = converter(history)
                if (Array.isArray(geminiContent)) {
                    contents.push(...geminiContent)
                } else {
                    contents.push(geminiContent)
                }
            }
        }

        const safetySettings = [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE,
            },
        ]

        const toolConvert = getFromChaiteToolConverter('gemini')
        const tools = this.tools.length > 0 ? this.tools.map(toolConvert) : undefined

        const generativeModel = genAI.getGenerativeModel({
            model,
            systemInstruction: systemInstruction || undefined,
            safetySettings,
            tools: tools ? [{ functionDeclarations: tools }] : undefined,
            generationConfig: {
                temperature: options.temperature,
                maxOutputTokens: options.maxToken,
            },
        })

        const result = await generativeModel.generateContentStream({
            contents,
        })

        async function* generator() {
            for await (const chunk of result.stream) {
                const text = chunk.text()
                if (text) {
                    yield text
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
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = options.model || 'text-embedding-004'

        const embeddingModel = genAI.getGenerativeModel({ model })

        const texts = Array.isArray(text) ? text : [text]
        const embeddings = []

        for (const t of texts) {
            const result = await embeddingModel.embedContent(t)
            embeddings.push(result.embedding.values)
        }

        return {
            embeddings,
        }
    }
}
