import { FunctionCallingMode, GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
import crypto from 'node:crypto'
import { chatLogger } from '../../utils/logger.js'
import {
    AbstractClient,
    preprocessImageUrls,
    parseXmlToolCalls,
    extractText,
    resolveModelName
} from '../AbstractClient.js'
import { getFromChaiteConverter, getFromChaiteToolConverter, getIntoChaiteConverter } from '../../utils/converter.js'
import './converter.js'
import { statsService } from '../../../services/stats/StatsService.js'
import { resolveToolChoice } from '../tooling.js'

const logger = chatLogger

/**
 * 未指定模型且全局默认模型也为空时的兜底模型
 * 原先流式路径写死 gemini-1.5-flash、非流式写死 gemini-2.5-flash，同一适配器给出两种默认值
 * @type {string}
 */
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

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
 * Gemini客户端实现
 */
function getGeminiThinkingConfig(options = {}, clientOptions = {}) {
    const enableReasoning = options.enableReasoning ?? clientOptions.enableReasoning ?? false
    if (!enableReasoning) return undefined
    const effort = options.reasoningEffort ?? clientOptions.reasoningEffort ?? 'low'
    if (effort === 'none' || effort === 'auto') return undefined
    const effortBudgetMap = {
        minimal: 256,
        low: 1024,
        medium: 4096,
        high: 8192,
        xhigh: 16384
    }
    const thinkingBudget =
        options.reasoningBudgetTokens ?? clientOptions.reasoningBudgetTokens ?? effortBudgetMap[effort] ?? 1024
    return { thinkingBudget }
}

function normalizeGeminiToolConfig(toolConfig) {
    if (!toolConfig?.functionCallingConfig) return toolConfig
    const mode = toolConfig.functionCallingConfig.mode
    const modeMap = {
        AUTO: FunctionCallingMode.AUTO,
        ANY: FunctionCallingMode.ANY,
        NONE: FunctionCallingMode.NONE,
        MODE_UNSPECIFIED: FunctionCallingMode.MODE_UNSPECIFIED
    }
    return {
        functionCallingConfig: {
            ...toolConfig.functionCallingConfig,
            mode: modeMap[mode] || mode
        }
    }
}

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
     * 构建 Gemini SDK 的 RequestOptions
     * 合并自定义 baseUrl 与渠道配置的请求超时（SDK 的 RequestOptions.timeout 单位为毫秒）
     * @param {string} [baseUrl] - 自定义 baseUrl
     * @returns {{baseUrl?: string, timeout?: number}|undefined} 请求选项，均未配置时为 undefined
     */
    buildGeminiRequestOptions(baseUrl) {
        const requestTimeout = this.resolveRequestTimeout()
        if (!baseUrl && !requestTimeout) return undefined
        return {
            ...(baseUrl ? { baseUrl } : {}),
            ...(requestTimeout ? { timeout: requestTimeout } : {})
        }
    }

    /**
     * 发送消息到Gemini
     * @param {IMessage[]} histories
     * @param {string} apiKey
     * @param {SendMessageOption} options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    async _sendMessage(histories, apiKey, options) {
        // 支持自定义 baseUrl 和端点（用于代理服务）
        const genAI = new GoogleGenerativeAI(apiKey)

        // 支持自定义端点配置
        const customChatPath = this.endpoints?.chat || this.chatPath
        let baseUrl = this.baseUrl

        // 如果配置了自定义聊天端点，需要构建完整的URL
        if (customChatPath) {
            const baseUrlClean = this.baseUrl?.replace(/\/+$/, '') || ''
            baseUrl = baseUrlClean + (customChatPath.startsWith('/') ? customChatPath : '/' + customChatPath)
            logger.debug(`[Gemini适配器] 使用自定义对话端点: ${baseUrl}`)
        }

        const requestOptions = this.buildGeminiRequestOptions(baseUrl)
        const model = resolveModelName(options.model, DEFAULT_GEMINI_MODEL)

        /*
         * 图片预处理：根据渠道 imageConfig.transferMode 决定处理方式
         * Gemini 原生需要 base64，'auto' 模式默认转换
         */
        const imageConfig = this.options?.imageConfig || {}
        const transferMode = imageConfig.transferMode || 'auto'
        const preprocessedHistories = transferMode !== 'url' ? await preprocessImageUrls(histories) : histories

        // 从历史记录中分离系统提示词
        let systemInstruction = options.systemOverride || ''
        const converter = getFromChaiteConverter('gemini')

        // 将历史记录转换为Gemini格式
        const contents = []
        for (const history of preprocessedHistories) {
            if (history.role === 'system') {
                // 系统消息变为系统指令
                systemInstruction = extractText(history.content)
            } else {
                const geminiContent = converter(history)
                if (Array.isArray(geminiContent)) {
                    contents.push(...geminiContent)
                } else {
                    contents.push(geminiContent)
                }
            }
        }

        // 配置安全设置
        const safetySettings = [
            {
                category: HarmCategory.HARM_CATEGORY_HARASSMENT,
                threshold: HarmBlockThreshold.BLOCK_NONE
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE
            }
        ]

        // 转换工具
        const toolConvert = getFromChaiteToolConverter('gemini')
        const convertedTools = this.tools.map(toolConvert).filter(Boolean)
        const choiceResolution = resolveToolChoice(options, convertedTools, 'gemini')
        const tools = choiceResolution.tools.length > 0 ? choiceResolution.tools : undefined
        const toolConfig = tools ? normalizeGeminiToolConfig(choiceResolution.toolConfig) : undefined
        options._exposedTools = tools || []

        const generationConfig = {
            maxOutputTokens: options.maxToken
        }
        /* 禁用温度传递时 temperature 为 undefined，不写入以避免携带 */
        if (Number.isFinite(options.temperature)) {
            generationConfig.temperature = options.temperature
        }
        const thinkingConfig = getGeminiThinkingConfig(options, this.options)
        if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig

        // 创建生成式模型
        const generativeModel = genAI.getGenerativeModel(
            {
                model,
                systemInstruction: systemInstruction || undefined,
                safetySettings,
                tools: tools ? [{ functionDeclarations: tools }] : undefined,
                toolConfig,
                generationConfig
            },
            requestOptions
        )

        // 生成内容
        const result = await generativeModel.generateContent({
            contents
        })

        const response = result.response

        logger.info('[Gemini适配器] API响应:', JSON.stringify(response).substring(0, 300))

        if (!response) {
            throw new Error('API返回空响应')
        }

        const id = crypto.randomUUID()
        const toChaiteConverter = getIntoChaiteConverter('gemini')

        // 将响应转换为Chaite格式
        const chaiteMessage = toChaiteConverter(response)

        let responseContents = chaiteMessage.content || []
        let toolCalls = chaiteMessage.toolCalls || []
        const textContents = responseContents.filter(c => c.type === 'text')
        for (const textItem of textContents) {
            if (
                textItem.text &&
                (textItem.text.includes('<tools>') ||
                    textItem.text.includes('<tool_call>') ||
                    textItem.text.includes('```') ||
                    textItem.text.includes('"name"'))
            ) {
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
            cachedTokens: response.usageMetadata?.cachedContentTokenCount || 0,
            cacheReadTokens: response.usageMetadata?.cachedContentTokenCount || 0,
            cacheReadCount: response.usageMetadata?.cachedContentTokenCount > 0 ? 1 : 0,
            cacheWriteTokens: 0,
            cacheWriteCount: 0,
            reasoningTokens: response.usageMetadata?.thoughtsTokenCount || 0
        }

        return {
            id,
            parentId: options.parentMessageId,
            model,
            role: 'assistant',
            content: responseContents,
            toolCalls,
            usage
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
        // 支持自定义 baseUrl 和端点
        const customChatPath = this.endpoints?.chat || this.chatPath
        let baseUrl = this.baseUrl

        if (customChatPath) {
            const baseUrlClean = this.baseUrl?.replace(/\/+$/, '') || ''
            baseUrl = baseUrlClean + (customChatPath.startsWith('/') ? customChatPath : '/' + customChatPath)
            logger.debug(`[Gemini适配器] 流式使用自定义对话端点: ${baseUrl}`)
        }

        const requestOptions = this.buildGeminiRequestOptions(baseUrl)
        const genAI = new GoogleGenerativeAI(apiKey, requestOptions)
        const model = resolveModelName(options.model, DEFAULT_GEMINI_MODEL)

        /*
         * 图片预处理：根据渠道 imageConfig.transferMode 决定处理方式
         * Gemini 原生需要 base64，'auto' 模式默认转换
         */
        const streamImageConfig = this.options?.imageConfig || {}
        const streamTransferMode = streamImageConfig.transferMode || 'auto'
        const preprocessedHistories = streamTransferMode !== 'url' ? await preprocessImageUrls(histories) : histories

        let systemInstruction = options.systemOverride || ''
        const converter = getFromChaiteConverter('gemini')

        const contents = []
        for (const history of preprocessedHistories) {
            if (history.role === 'system') {
                systemInstruction = extractText(history.content)
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
                threshold: HarmBlockThreshold.BLOCK_NONE
            },
            {
                category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
                threshold: HarmBlockThreshold.BLOCK_NONE
            },
            {
                category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
                threshold: HarmBlockThreshold.BLOCK_NONE
            },
            {
                category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
                threshold: HarmBlockThreshold.BLOCK_NONE
            }
        ]

        const toolConvert = getFromChaiteToolConverter('gemini')
        const convertedTools = this.tools.map(toolConvert).filter(Boolean)
        const choiceResolution = resolveToolChoice(options, convertedTools, 'gemini')
        const tools = choiceResolution.tools.length > 0 ? choiceResolution.tools : undefined
        const toolConfig = tools ? normalizeGeminiToolConfig(choiceResolution.toolConfig) : undefined
        options._exposedTools = tools || []

        const generationConfig = {
            maxOutputTokens: options.maxToken
        }
        /* 禁用温度传递时 temperature 为 undefined，不写入以避免携带 */
        if (Number.isFinite(options.temperature)) {
            generationConfig.temperature = options.temperature
        }
        const thinkingConfig = getGeminiThinkingConfig(options, this.options)
        if (thinkingConfig) generationConfig.thinkingConfig = thinkingConfig

        const generativeModel = genAI.getGenerativeModel(
            {
                model,
                systemInstruction: systemInstruction || undefined,
                safetySettings,
                tools: tools ? [{ functionDeclarations: tools }] : undefined,
                toolConfig,
                generationConfig
            },
            requestOptions
        )

        const result = await generativeModel.generateContentStream({
            contents
        })

        async function* generator() {
            const toolCalls = []
            try {
                for await (const chunk of result.stream) {
                    // SDK 的 text() 在内容被安全策略阻断时会主动抛错，
                    // 不隔离会连带丢弃本轮已收集的 toolCalls
                    let text = ''
                    try {
                        text = chunk.text()
                    } catch (err) {
                        logger.warn(`[Gemini适配器] 流式分块文本解析失败: ${err.message}`)
                    }
                    if (text) {
                        yield { type: 'text', text }
                    }

                    let functionCalls = []
                    try {
                        functionCalls = chunk.functionCalls?.() || []
                    } catch (err) {
                        logger.warn(`[Gemini适配器] 流式分块工具调用解析失败: ${err.message}`)
                    }
                    for (const functionCall of functionCalls) {
                        toolCalls.push({
                            id: crypto.randomUUID(),
                            type: 'function',
                            function: {
                                name: functionCall.name,
                                arguments:
                                    typeof functionCall.args === 'string'
                                        ? functionCall.args
                                        : JSON.stringify(functionCall.args || {})
                            }
                        })
                    }
                }
            } catch (err) {
                logger.error(`[Gemini适配器] 流式响应中断: ${err.message}`)
            }

            // 无论流是否正常结束，都要吐出已收集到的工具调用
            if (toolCalls.length > 0) {
                yield { type: 'tool_calls', toolCalls }
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
        // 支持自定义 baseUrl 和嵌入端点
        const customEmbeddingsPath = this.endpoints?.embeddings
        let baseUrl = this.baseUrl

        if (customEmbeddingsPath) {
            const baseUrlClean = this.baseUrl?.replace(/\/+$/, '') || ''
            baseUrl =
                baseUrlClean +
                (customEmbeddingsPath.startsWith('/') ? customEmbeddingsPath : '/' + customEmbeddingsPath)
            logger.debug(`[Gemini适配器] 使用自定义嵌入端点: ${baseUrl}`)
        }

        const genAI = new GoogleGenerativeAI(apiKey)
        const requestOptions = this.buildGeminiRequestOptions(baseUrl)
        const model = options.model || 'text-embedding-004'

        const embeddingModel = genAI.getGenerativeModel({ model }, requestOptions)

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
                request: { inputCount: texts.length, model }
            })
        } catch (e) {
            /* 统计失败不影响主流程 */
        }

        return {
            embeddings
        }
    }

    /**
     * List available models from the API
     * 使用 Gemini /v1beta/models 接口获取模型列表
     * @returns {Promise<string[]>}
     */
    async listModels() {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        // 支持自定义模型列表端点
        const customModelsPath = this.endpoints?.models || this.modelsPath
        let baseUrl = this.baseUrl || 'https://generativelanguage.googleapis.com'
        let modelsEndpoint = '/v1beta/models'

        if (customModelsPath) {
            const baseUrlClean = baseUrl.replace(/\/+$/, '')
            modelsEndpoint = customModelsPath.startsWith('/') ? customModelsPath : '/' + customModelsPath
            logger.debug(`[Gemini适配器] 使用自定义模型列表端点: ${baseUrlClean}${modelsEndpoint}`)
        }

        try {
            const response = await fetch(`${baseUrl}${modelsEndpoint}?key=${apiKey}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
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
                'gemini-1.0-pro'
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
        // 支持自定义模型信息端点
        const customModelsPath = this.endpoints?.models || this.modelsPath
        let baseUrl = this.baseUrl || 'https://generativelanguage.googleapis.com'
        let modelInfoEndpoint = '/v1beta'

        if (customModelsPath) {
            const baseUrlClean = baseUrl.replace(/\/+$/, '')
            if (customModelsPath.includes('/models')) {
                const customPath = customModelsPath.replace(/\/+$/, '')
                const modelSuffix = customPath.endsWith('/models') ? '' : '/models'
                modelInfoEndpoint = `${customPath}${modelSuffix}`
                baseUrl = baseUrlClean
            } else if (customModelsPath.includes('/v1beta')) {
                modelInfoEndpoint = `${customModelsPath.replace(/\/+$/, '')}/models`
                baseUrl = baseUrlClean
            } else {
                modelInfoEndpoint = customModelsPath.startsWith('/') ? customModelsPath : '/' + customModelsPath
            }
            logger.debug(`[Gemini适配器] 使用自定义模型信息端点: ${baseUrl}${modelInfoEndpoint}`)
        }

        try {
            const normalizedModelId = modelId.replace(/^models\//, '')
            const modelName = modelInfoEndpoint.endsWith('/models') ? normalizedModelId : `models/${normalizedModelId}`
            const response = await fetch(`${baseUrl}${modelInfoEndpoint}/${modelName}?key=${apiKey}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
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
                topK: model.topK
            }
        } catch (error) {
            logger.error('[Gemini适配器] 获取模型信息失败:', error.message)
            throw error
        }
    }
}
