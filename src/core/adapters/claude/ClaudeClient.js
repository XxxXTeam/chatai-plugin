import Anthropic from '@anthropic-ai/sdk'
import crypto from 'node:crypto'
import { chatLogger } from '../../utils/logger.js'
import {
    AbstractClient,
    parseXmlToolCalls,
    preprocessImageUrls,
    extractText,
    resolveModelName
} from '../AbstractClient.js'
import { getFromChaiteConverter, getFromChaiteToolConverter, getIntoChaiteConverter } from '../../utils/converter.js'
import './converter.js'
import { resolveToolChoice } from '../tooling.js'

const logger = chatLogger

/**
 * 未指定模型且全局默认模型也为空时的兜底模型
 * @type {string}
 */
const DEFAULT_CLAUDE_MODEL = 'claude-3-5-sonnet-20241022'

/**
 * @typedef {import('../../types').BaseClientOptions} BaseClientOptions
 * @typedef {import('../../types').ChaiteContext} ChaiteContext
 * @typedef {import('../../types').SendMessageOption} SendMessageOption
 * @typedef {import('../../types').IMessage} IMessage
 * @typedef {import('../../types').HistoryMessage} HistoryMessage
 * @typedef {import('../../types').ModelUsage} ModelUsage
 */

/**
 * Claude客户端实现
 */
function getClaudeThinkingConfig(options = {}, clientOptions = {}) {
    const enableReasoning = options.enableReasoning ?? clientOptions.enableReasoning ?? false
    if (!enableReasoning) return undefined
    const effort = options.reasoningEffort ?? clientOptions.reasoningEffort
    if (effort === 'none' || effort === 'auto') return undefined
    const maxTokens = options.maxToken || 4096
    if (maxTokens <= 1024) return undefined
    const fallbackBudget = Math.max(1024, Math.min(Math.floor(maxTokens / 2), maxTokens - 1))
    const budgetTokens = options.reasoningBudgetTokens ?? clientOptions.reasoningBudgetTokens ?? fallbackBudget
    return { type: 'enabled', budget_tokens: Math.max(1024, Math.min(budgetTokens, maxTokens - 1)) }
}

export class ClaudeClient extends AbstractClient {
    /**
     * @param {BaseClientOptions | Partial<BaseClientOptions>} options
     * @param {ChaiteContext} [context]
     */
    constructor(options, context) {
        super(options, context)
        this.name = 'claude'
    }

    normalizeClaudeEndpointPath(endpointPath) {
        const path = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`
        if (
            path === '/messages' ||
            path.startsWith('/messages/') ||
            path === '/models' ||
            path.startsWith('/models/')
        ) {
            return `/v1${path}`
        }
        return path
    }

    buildClaudeClientOptions(apiKey, endpointMap = {}) {
        const baseURL = this.baseUrl ? this.baseUrl.replace(/\/v1\/?$/i, '') : undefined
        const baseUrlClean = baseURL?.replace(/\/+$/, '') || ''
        const clientOptions = { apiKey, baseURL }
        // 接通渠道 timeout.read，未配置时沿用 SDK 默认值
        const requestTimeout = this.resolveRequestTimeout()
        if (requestTimeout) {
            clientOptions.timeout = requestTimeout
        }
        const entries = Object.entries(endpointMap).filter(([, endpointPath]) => endpointPath)

        if (baseUrlClean && entries.length > 0) {
            clientOptions.fetch = async (url, init) => {
                const originalUrl = url.toString()
                const parsed = new URL(originalUrl)
                const match = entries.find(
                    ([apiPath]) => parsed.pathname === apiPath || parsed.pathname.startsWith(`${apiPath}/`)
                )
                if (!match) return fetch(url, init)

                const [apiPath, endpointPath] = match
                const normalizedEndpointPath = this.normalizeClaudeEndpointPath(endpointPath)
                const suffix = parsed.pathname.slice(apiPath.length)
                const targetUrl = `${baseUrlClean}${normalizedEndpointPath}${suffix}${parsed.search}`
                logger.debug(`[Claude适配器] 使用自定义端点: ${targetUrl}`)
                return fetch(targetUrl, init)
            }
        }

        return clientOptions
    }

    getClaudeEndpointMap() {
        const endpointMap = {}
        const chatPath = this.endpoints?.chat || this.chatPath
        const modelsPath = this.endpoints?.models || this.modelsPath
        if (chatPath) endpointMap['/v1/messages'] = chatPath
        if (modelsPath) endpointMap['/v1/models'] = modelsPath
        return endpointMap
    }

    /**
     * 发送消息到Claude
     * @param {IMessage[]} histories
     * @param {string} apiKey
     * @param {SendMessageOption} options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    async _sendMessage(histories, apiKey, options) {
        const client = new Anthropic(this.buildClaudeClientOptions(apiKey, this.getClaudeEndpointMap()))

        const model = resolveModelName(options.model, DEFAULT_CLAUDE_MODEL)

        /*
         * 图片预处理：根据渠道 imageConfig.transferMode 决定处理方式
         * Claude 原生不支持 URL 图片，因此 'auto' 模式默认转 base64
         * - 'base64': 强制转换
         * - 'url': 保持URL不转换（可能导致图片无法识别）
         * - 'auto'(默认): 转base64（Claude需要）
         */
        const imageConfig = this.options?.imageConfig || {}
        const transferMode = imageConfig.transferMode || 'auto'
        if (transferMode !== 'url') {
            histories = await preprocessImageUrls(histories)
        }

        // 从历史记录中分离系统提示词
        let systemPrompt = options.systemOverride || ''
        const converter = getFromChaiteConverter('claude')

        // 将历史记录转换为Claude格式
        const messages = []
        for (const history of histories) {
            if (history.role === 'system') {
                // 系统消息变为系统参数
                systemPrompt = extractText(history.content)
            } else {
                const claudeMsg = converter(history)
                if (Array.isArray(claudeMsg)) {
                    messages.push(...claudeMsg)
                } else {
                    messages.push(claudeMsg)
                }
            }
        }

        // 转换工具
        const toolConvert = getFromChaiteToolConverter('claude')
        const convertedTools = this.tools.map(toolConvert).filter(Boolean)
        const choiceResolution = resolveToolChoice(options, convertedTools, 'claude')
        const tools = choiceResolution.tools.length > 0 ? choiceResolution.tools : undefined
        options._exposedTools = tools || []

        const requestPayload = {
            model,
            max_tokens: options.maxToken || 4096,
            system: systemPrompt || undefined,
            messages,
            tools,
            tool_choice: tools ? choiceResolution.toolChoice : undefined
        }
        /* 禁用温度传递时 temperature 为 undefined，不写入以避免携带 */
        if (Number.isFinite(options.temperature)) {
            requestPayload.temperature = options.temperature
        }
        const thinking = getClaudeThinkingConfig(options, this.options)
        if (thinking) requestPayload.thinking = thinking

        // 调用API
        const response = await client.messages.create(requestPayload)

        logger.info('[Claude适配器] API响应:', JSON.stringify(response).substring(0, 300))

        if (!response) {
            throw new Error('API返回空响应')
        }

        const id = crypto.randomUUID()
        const toChaiteConverter = getIntoChaiteConverter('claude')

        // 将响应转换为Chaite格式
        const chaiteMessage = toChaiteConverter(response)

        let contents = chaiteMessage.content || []
        let toolCalls = chaiteMessage.toolCalls || []

        // 检查文本内容中是否有非原生格式的工具调用
        // 支持: <tools>, <tool_call>, ```json, JSON数组
        const textContents = contents.filter(c => c.type === 'text')
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
                    logger.info(`[Claude适配器] 从文本中解析到 ${parsedToolCalls.length} 个工具调用`)
                }
            }
        }

        // 过滤空文本
        contents = contents.filter(c => c.type !== 'text' || (c.text && c.text.trim()))

        const usage = {
            promptTokens: response.usage?.input_tokens,
            completionTokens: response.usage?.output_tokens,
            totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
            cachedTokens: response.usage?.cache_read_input_tokens || 0,
            cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
            cacheCreationTokens: response.usage?.cache_creation_input_tokens || 0,
            cacheWriteTokens: response.usage?.cache_creation_input_tokens || 0,
            cacheReadCount: response.usage?.cache_read_input_tokens > 0 ? 1 : 0,
            cacheWriteCount: response.usage?.cache_creation_input_tokens > 0 ? 1 : 0,
            reasoningTokens: 0
        }

        return {
            id,
            parentId: options.parentMessageId,
            model: response.model || model,
            role: 'assistant',
            content: contents,
            toolCalls,
            usage
        }
    }

    /**
     * 流式发送消息
     * @param {IMessage[]} histories
     * @param {SendMessageOption | Partial<SendMessageOption>} options
     * @returns {Promise<AsyncGenerator<string | object, void, unknown>>}
     */
    async streamMessage(histories, options) {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const client = new Anthropic(this.buildClaudeClientOptions(apiKey, this.getClaudeEndpointMap()))

        const model = resolveModelName(options.model, DEFAULT_CLAUDE_MODEL)

        /*
         * 图片预处理：根据渠道 imageConfig.transferMode 决定处理方式
         * Claude 原生不支持 URL 图片，'auto' 模式默认转 base64
         */
        const streamImageConfig = this.options?.imageConfig || {}
        const streamTransferMode = streamImageConfig.transferMode || 'auto'
        if (streamTransferMode !== 'url') {
            histories = await preprocessImageUrls(histories)
        }

        let systemPrompt = options.systemOverride || ''
        const converter = getFromChaiteConverter('claude')

        const messages = []
        for (const history of histories) {
            if (history.role === 'system') {
                systemPrompt = extractText(history.content)
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
        const convertedTools = this.tools.map(toolConvert).filter(Boolean)
        const choiceResolution = resolveToolChoice(options, convertedTools, 'claude')
        const tools = choiceResolution.tools.length > 0 ? choiceResolution.tools : undefined
        options._exposedTools = tools || []

        const requestPayload = {
            model,
            max_tokens: options.maxToken || 4096,
            system: systemPrompt || undefined,
            messages,
            tools,
            tool_choice: tools ? choiceResolution.toolChoice : undefined,
            stream: true
        }
        /* 禁用温度传递时 temperature 为 undefined，不写入以避免携带 */
        if (Number.isFinite(options.temperature)) {
            requestPayload.temperature = options.temperature
        }
        const thinking = getClaudeThinkingConfig(options, this.options)
        if (thinking) requestPayload.thinking = thinking

        const stream = await client.messages.create(requestPayload)

        async function* generator() {
            const toolBlocks = new Map()
            for await (const event of stream) {
                if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                    toolBlocks.set(event.index, {
                        id: event.content_block.id,
                        type: 'function',
                        function: {
                            name: event.content_block.name,
                            arguments:
                                typeof event.content_block.input === 'string'
                                    ? event.content_block.input
                                    : JSON.stringify(event.content_block.input || {})
                        }
                    })
                    continue
                }
                if (event.type === 'content_block_delta') {
                    if (event.delta.type === 'text_delta') {
                        yield { type: 'text', text: event.delta.text }
                    } else if (event.delta.type === 'input_json_delta') {
                        const existing = toolBlocks.get(event.index)
                        if (existing) {
                            existing.function.arguments =
                                existing.function.arguments === '{}'
                                    ? event.delta.partial_json || ''
                                    : existing.function.arguments + (event.delta.partial_json || '')
                        }
                    }
                }
            }
            const toolCalls = Array.from(toolBlocks.values()).filter(tc => tc.id && tc.function.name)
            if (toolCalls.length > 0) {
                yield { type: 'tool_calls', toolCalls }
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

    /**
     * List available models from the API
     * Claude API 没有直接的模型列表接口，返回已知模型
     * @returns {Promise<string[]>}
     */
    async listModels() {
        const fallbackModels = [
            'claude-opus-4-7',
            'claude-opus-4-6',
            'claude-sonnet-4-6',
            'claude-haiku-4-5',
            'claude-haiku-4-5-20251001',
            'claude-opus-4-5',
            'claude-opus-4-5-20251101',
            'claude-sonnet-4-5',
            'claude-sonnet-4-5-20250929',
            'claude-opus-4-1',
            'claude-opus-4-1-20250805',
            'claude-opus-4-0',
            'claude-opus-4-20250514',
            'claude-sonnet-4-0',
            'claude-sonnet-4-20250514',
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307'
        ]

        try {
            const apiKey = await import('../../utils/helpers.js').then(m =>
                m.getKey(this.apiKey, this.multipleKeyStrategy)
            )
            const client = new Anthropic(this.buildClaudeClientOptions(apiKey, this.getClaudeEndpointMap()))
            const models = await client.models.list()
            const data = Array.isArray(models?.data) ? models.data : []
            if (data.length > 0)
                return data
                    .map(model => model.id)
                    .filter(Boolean)
                    .sort()
        } catch (error) {
            logger.warn(`[Claude适配器] 获取模型列表失败，使用内置列表: ${error.message}`)
        }

        return fallbackModels
    }

    /**
     * Get model information
     * @param {string} modelId - Model ID
     * @returns {Promise<Object>}
     */
    async getModelInfo(modelId) {
        try {
            const apiKey = await import('../../utils/helpers.js').then(m =>
                m.getKey(this.apiKey, this.multipleKeyStrategy)
            )
            const client = new Anthropic(this.buildClaudeClientOptions(apiKey, this.getClaudeEndpointMap()))
            const model = await client.models.retrieve(modelId)
            return {
                id: model.id || modelId,
                name: model.display_name || model.displayName || modelId,
                createdAt: model.created_at || model.createdAt,
                contextWindow: model.context_window,
                maxOutput: model.max_output_tokens,
                capabilities: model.capabilities,
                supported: true
            }
        } catch (error) {
            logger.warn(`[Claude适配器] 获取模型信息失败，使用内置信息: ${error.message}`)
        }

        const knownModels = {
            'claude-opus-4-7': { contextWindow: 200000, maxOutput: 32000 },
            'claude-opus-4-6': { contextWindow: 200000, maxOutput: 32000 },
            'claude-sonnet-4-6': { contextWindow: 200000, maxOutput: 64000 },
            'claude-haiku-4-5': { contextWindow: 200000, maxOutput: 8192 },
            'claude-haiku-4-5-20251001': { contextWindow: 200000, maxOutput: 8192 },
            'claude-opus-4-5': { contextWindow: 200000, maxOutput: 32000 },
            'claude-opus-4-5-20251101': { contextWindow: 200000, maxOutput: 32000 },
            'claude-sonnet-4-5': { contextWindow: 200000, maxOutput: 64000 },
            'claude-sonnet-4-5-20250929': { contextWindow: 200000, maxOutput: 64000 },
            'claude-opus-4-1': { contextWindow: 200000, maxOutput: 32000 },
            'claude-opus-4-1-20250805': { contextWindow: 200000, maxOutput: 32000 },
            'claude-opus-4-0': { contextWindow: 200000, maxOutput: 32000 },
            'claude-opus-4-20250514': { contextWindow: 200000, maxOutput: 32000 },
            'claude-sonnet-4-0': { contextWindow: 200000, maxOutput: 64000 },
            'claude-sonnet-4-20250514': { contextWindow: 200000, maxOutput: 64000 },
            'claude-3-5-sonnet-20241022': { contextWindow: 200000, maxOutput: 8192 },
            'claude-3-5-haiku-20241022': { contextWindow: 200000, maxOutput: 8192 },
            'claude-3-opus-20240229': { contextWindow: 200000, maxOutput: 4096 },
            'claude-3-sonnet-20240229': { contextWindow: 200000, maxOutput: 4096 },
            'claude-3-haiku-20240307': { contextWindow: 200000, maxOutput: 4096 }
        }

        const info = knownModels[modelId]
        return {
            id: modelId,
            name: modelId,
            contextWindow: info?.contextWindow || 200000,
            maxOutput: info?.maxOutput || 4096,
            supported: !!info
        }
    }
}
