import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
import crypto from 'node:crypto'
import { AbstractClient, preprocessImageUrls, parseXmlToolCalls } from '../AbstractClient.js'
import { getFromChaiteConverter, getFromChaiteToolConverter, getIntoChaiteConverter } from '../../utils/converter.js'
import './converter.js'
import { statsService } from '../../../services/stats/StatsService.js'

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
        // 支持自定义 baseUrl（用于代理服务）
        const requestOptions = this.baseUrl ? { baseUrl: this.baseUrl } : undefined
        const genAI = new GoogleGenerativeAI(apiKey, requestOptions)
        const model = options.model || 'gemini-2.5-flash'
        const preprocessedHistories = await preprocessImageUrls(histories)

        // Separate system prompt from history
        let systemInstruction = options.systemOverride || ''
        const converter = getFromChaiteConverter('gemini')

        // Convert history to Gemini format
        const contents = []
        for (const history of preprocessedHistories) {
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

        let responseContents = chaiteMessage.content || []
        let toolCalls = chaiteMessage.toolCalls || []
        const textContents = responseContents.filter(c => c.type === 'text')
        for (const textItem of textContents) {
            if (textItem.text && (
                textItem.text.includes('<tools>') || 
                textItem.text.includes('<tool_call>') ||
                textItem.text.includes('```') ||
                textItem.text.includes('"name"')
            )) {
                const { cleanText, toolCalls: parsedToolCalls } = parseXmlToolCalls(textItem.text)
                if (parsedToolCalls.length > 0) {
                    textItem.text = cleanText
                    toolCalls = [...toolCalls, ...parsedToolCalls]
                    logger.info(`[Gemini适配器] 从文本中解析到 ${parsedToolCalls.length} 个工具调用`)
                }
            }
        }
        
        // 过滤空文本
        responseContents = responseContents.filter(c => c.type !== 'text' || (c.text && c.text.trim()))

        const usage = {
            promptTokens: response.usageMetadata?.promptTokenCount,
            completionTokens: response.usageMetadata?.candidatesTokenCount,
            totalTokens: response.usageMetadata?.totalTokenCount,
        }

        return {
            id,
            parentId: options.parentMessageId,
            role: 'assistant',
            content: responseContents,
            toolCalls,
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
        // 支持自定义 baseUrl
        const requestOptions = this.baseUrl ? { baseUrl: this.baseUrl } : undefined
        const genAI = new GoogleGenerativeAI(apiKey, requestOptions)
        const model = options.model || 'gemini-1.5-flash'

        // 预处理图片URL为base64（Gemini不支持直接使用URL）
        const preprocessedHistories = await preprocessImageUrls(histories)

        let systemInstruction = options.systemOverride || ''
        const converter = getFromChaiteConverter('gemini')

        const contents = []
        for (const history of preprocessedHistories) {
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
        // 支持自定义 baseUrl
        const requestOptions = this.baseUrl ? { baseUrl: this.baseUrl } : undefined
        const genAI = new GoogleGenerativeAI(apiKey, requestOptions)
        const model = options.model || 'text-embedding-004'

        const embeddingModel = genAI.getGenerativeModel({ model })

        const texts = Array.isArray(text) ? text : [text]
        const embeddings = []

        const embeddingStartTime = Date.now()
        for (const t of texts) {
            const result = await embeddingModel.embedContent(t)
            embeddings.push(result.embedding.values)
        }

        // 记录Embedding统计
        try {
            const inputTokens = texts.reduce((sum, t) => sum + statsService.estimateTokens(t), 0)
            await statsService.recordApiCall({
                channelId: this.options?.channelId || 'gemini-embedding',
                channelName: this.options?.channelName || 'Gemini Embedding',
                model,
                inputTokens,
                outputTokens: 0,
                duration: Date.now() - embeddingStartTime,
                success: true,
                source: 'embedding',
                request: { inputCount: texts.length, model },
            })
        } catch (e) { /* 统计失败不影响主流程 */ }

        return {
            embeddings,
        }
    }

    /**
     * List available models from the API
     * 使用 Gemini /v1beta/models 接口获取模型列表
     * @returns {Promise<string[]>}
     */
    async listModels() {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const baseUrl = this.baseUrl || 'https://generativelanguage.googleapis.com'
        
        try {
            const response = await fetch(`${baseUrl}/v1beta/models?key=${apiKey}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            })
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }
            
            const data = await response.json()
            const models = data.models || []
            
            // 提取模型名称，过滤掉非生成模型
            return models
                .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
                .map(m => m.name.replace('models/', ''))
                .sort()
        } catch (error) {
            logger.error('[Gemini适配器] 获取模型列表失败:', error.message)
            // 失败时返回已知模型列表作为后备
            return [
                'gemini-2.0-flash-exp',
                'gemini-2.0-flash-thinking-exp',
                'gemini-1.5-pro',
                'gemini-1.5-pro-latest',
                'gemini-1.5-flash',
                'gemini-1.5-flash-latest',
                'gemini-1.5-flash-8b',
                'gemini-1.0-pro',
            ]
        }
    }

    /**
     * Get model information
     * 使用 Gemini /v1beta/models/{model} 接口获取模型信息
     * @param {string} modelId - Model ID
     * @returns {Promise<Object>}
     */
    async getModelInfo(modelId) {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const baseUrl = this.baseUrl || 'https://generativelanguage.googleapis.com'
        
        try {
            const modelName = modelId.startsWith('models/') ? modelId : `models/${modelId}`
            const response = await fetch(`${baseUrl}/v1beta/${modelName}?key=${apiKey}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            })
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`)
            }
            
            const model = await response.json()
            return {
                id: model.name?.replace('models/', '') || modelId,
                name: model.displayName || modelId,
                description: model.description || '',
                version: model.version || '',
                inputTokenLimit: model.inputTokenLimit,
                outputTokenLimit: model.outputTokenLimit,
                supportedGenerationMethods: model.supportedGenerationMethods || [],
                temperature: model.temperature,
                topP: model.topP,
                topK: model.topK,
            }
        } catch (error) {
            logger.error('[Gemini适配器] 获取模型信息失败:', error.message)
            throw error
        }
    }
}
