import Anthropic from '@anthropic-ai/sdk'
import crypto from 'node:crypto'
import { AbstractClient, parseXmlToolCalls, preprocessImageUrls } from '../AbstractClient.js'
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
 * Claude客户端实现
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
     * 发送消息到Claude
     * @param {IMessage[]} histories
     * @param {string} apiKey
     * @param {SendMessageOption} options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    async _sendMessage(histories, apiKey, options) {
        const client = new Anthropic({
            apiKey,
            baseURL: this.baseUrl
        })

        const model = options.model || 'claude-3-5-sonnet-20241022'

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

        // 转换工具
        const toolConvert = getFromChaiteToolConverter('claude')
        const tools = this.tools.length > 0 ? this.tools.map(toolConvert) : undefined

        // 调用API
        const response = await client.messages.create({
            model,
            max_tokens: options.maxToken || 4096,
            temperature: options.temperature,
            system: systemPrompt || undefined,
            messages,
            tools
        })

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
            totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }

        return {
            id,
            parentId: options.parentMessageId,
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
     * @returns {Promise<AsyncGenerator<string, void, unknown>>}
     */
    async streamMessage(histories, options) {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const client = new Anthropic({
            apiKey,
            baseURL: this.baseUrl
        })

        const model = options.model || 'claude-3-5-sonnet-20241022'

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
            stream: true
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

    /**
     * List available models from the API
     * Claude API 没有直接的模型列表接口，返回已知模型
     * @returns {Promise<string[]>}
     */
    async listModels() {
        return [
            'claude-3-5-sonnet-20241022',
            'claude-3-5-haiku-20241022',
            'claude-3-opus-20240229',
            'claude-3-sonnet-20240229',
            'claude-3-haiku-20240307',
            'claude-2.1',
            'claude-2.0',
            'claude-instant-1.2'
        ]
    }

    /**
     * Get model information
     * @param {string} modelId - Model ID
     * @returns {Promise<Object>}
     */
    async getModelInfo(modelId) {
        const knownModels = {
            'claude-3-5-sonnet-20241022': { contextWindow: 200000, maxOutput: 8192 },
            'claude-3-5-haiku-20241022': { contextWindow: 200000, maxOutput: 8192 },
            'claude-3-opus-20240229': { contextWindow: 200000, maxOutput: 4096 },
            'claude-3-sonnet-20240229': { contextWindow: 200000, maxOutput: 4096 },
            'claude-3-haiku-20240307': { contextWindow: 200000, maxOutput: 4096 },
            'claude-2.1': { contextWindow: 200000, maxOutput: 4096 },
            'claude-2.0': { contextWindow: 100000, maxOutput: 4096 }
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
