import OpenAI from 'openai'
import crypto from 'node:crypto'
import { AbstractClient, preprocessImageUrls, needsImageBase64Preprocess, parseXmlToolCalls } from '../AbstractClient.js'
import { getFromChaiteConverter, getFromChaiteToolConverter, getIntoChaiteConverter } from '../../utils/converter.js'
import './converter.js'
import { proxyService } from '../../../services/proxy/ProxyService.js'
import { logService } from '../../../services/stats/LogService.js'
import { requestTemplateService } from '../../../services/proxy/RequestTemplateService.js'

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
 * 递归清理工具定义中的 enum 值，确保都是字符串类型（Gemini API 要求）
 * @param {object} obj - 工具定义对象
 * @returns {object} - 清理后的对象
 */
function sanitizeToolEnums(obj) {
    if (!obj || typeof obj !== 'object') return obj
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeToolEnums(item))
    }
    
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
        if (key === 'enum' && Array.isArray(value)) {
            // 将所有 enum 值转换为字符串
            result[key] = value.map(v => String(v))
        } else if (typeof value === 'object' && value !== null) {
            result[key] = sanitizeToolEnums(value)
        } else {
            result[key] = value
        }
    }
    return result
}

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
        // 获取渠道代理配置
        const channelProxy = proxyService.getChannelProxyAgent(this.baseUrl)
        
        // 构建请求头 - 支持JSON模板和占位符
        const model = options.model || 'gpt-4o-mini'
        const templateContext = {
            apiKey,
            model,
            baseUrl: this.baseUrl,
            channelName: this.options?.channelName || '',
            userAgent: this.options?.userAgent,
            xff: this.options?.xff
        }
        
        const defaultHeaders = {
            'User-Agent': '{{USER_AGENT}}',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        }
        
        // 处理JSON模板（如果有）
        const headersTemplate = this.options?.headersTemplate || options.headersTemplate
        let mergedHeaders
        if (headersTemplate) {
            // 使用JSON模板（支持占位符）
            mergedHeaders = requestTemplateService.buildHeaders(headersTemplate, templateContext)
        } else {
            // 应用自定义请求头（支持复写）
            const customHeaders = this.options?.customHeaders || options.customHeaders || {}
            mergedHeaders = requestTemplateService.buildHeaders(
                { ...defaultHeaders, ...customHeaders },
                templateContext
            )
        }
        
        // 处理特殊头复写
        const customHeaders = this.options?.customHeaders || options.customHeaders || {}
        if (customHeaders['X-Forwarded-For']) {
            mergedHeaders['X-Forwarded-For'] = requestTemplateService.replaceplaceholders(
                customHeaders['X-Forwarded-For'], templateContext
            )
        }
        if (customHeaders['Authorization']) {
            mergedHeaders['Authorization'] = requestTemplateService.replaceplaceholders(
                customHeaders['Authorization'], templateContext
            )
        }
        
        const clientOptions = {
            apiKey,
            baseURL: this.baseUrl,
            defaultHeaders: mergedHeaders,
        }
        
        // 如果有代理配置，添加到客户端选项
        if (channelProxy) {
            clientOptions.httpAgent = channelProxy
            logger.debug('[OpenAI适配器] 使用代理:', proxyService.getProfileForScope('channel')?.name)
        }
        
        const client = new OpenAI(clientOptions)

        const messages = []

        // Gemini模型需要将图片URL转为base64
        const isGeminiModel = model.toLowerCase().includes('gemini')
        if (needsImageBase64Preprocess(model)) {
            histories = await preprocessImageUrls(histories)
        }
        // Gemini模型不支持thinking model的特殊参数（developer角色、max_completion_tokens等）
        const isThinkingModel = !isGeminiModel && (options.enableReasoning || options.isThinkingModel)

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
        let tools = shouldDisableTools ? [] : this.tools.map(toolConvert)
        
        // Gemini API 要求 enum 值必须是字符串类型，清理所有工具定义
        if (isGeminiModel && tools.length > 0) {
            tools = tools.map(tool => sanitizeToolEnums(tool))
        }

        // 根据 options.stream 决定是否使用流式
        const useStream = options.stream === true
        
        const requestPayload = {
            temperature: options.temperature,
            messages,
            model,
            stream: useStream,
            stream_options: useStream ? { include_usage: true } : undefined,
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
        logger.debug('[OpenAI适配器] 请求:', JSON.stringify({
            model: requestPayload.model,
            stream: requestPayload.stream,
            messages: requestPayload.messages?.length,
            tools: requestPayload.tools?.length || 0
        }))
        if (requestPayload.tools?.length > 0) {
            const toolNames = requestPayload.tools.map(t => t.function?.name).filter(Boolean)
           
        }
        if (logger.level === 'debug') {
            const sanitizedMessages = this.sanitizeMessagesForLog(requestPayload.messages)
            logger.debug('[OpenAI适配器] 实际Messages内容:', JSON.stringify(sanitizedMessages, null, 2))
        }

        let chatCompletion
        try {
            const response = await client.chat.completions.create(requestPayload)
            
            // 如果是流式响应，需要收集所有 chunk
            if (useStream) {
                logger.debug(`[OpenAI适配器] 流式响应处理开始`)
                let allContent = ''
                let allReasoningContent = ''
                const toolCallsMap = new Map()
                let finishReason = null
                let usage = null
                let chunkCount = 0
                
                for await (const chunk of response) {
                    chunkCount++
                    const delta = chunk.choices[0]?.delta || {}
                    const content = delta.content || ''
                    const reasoningContent = delta.reasoning_content || ''
                    
                    allContent += content
                    allReasoningContent += reasoningContent
                    
                    // 处理工具调用
                    if (delta.tool_calls) {
                        logger.debug(`[OpenAI适配器] Stream chunk ${chunkCount}: 检测到tool_calls`)
                        for (const tc of delta.tool_calls) {
                            const idx = tc.index
                            if (!toolCallsMap.has(idx)) {
                                toolCallsMap.set(idx, {
                                    id: tc.id || '',
                                    type: tc.type || 'function',
                                    function: { name: tc.function?.name || '', arguments: '' }
                                })
                            }
                            const existing = toolCallsMap.get(idx)
                            if (tc.id) existing.id = tc.id
                            if (tc.function?.name) existing.function.name = tc.function.name
                            if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
                        }
                    }
                    
                    finishReason = chunk.choices[0]?.finish_reason || finishReason
                    if (chunk.usage) usage = chunk.usage
                    
                    // 每50个chunk输出一次进度
                    if (chunkCount % 50 === 0) {
                        logger.debug(`[OpenAI适配器] Stream进度: ${chunkCount} chunks, ${allContent.length}字符`)
                    }
                }
                
                logger.debug(`[OpenAI适配器] Stream完成: ${chunkCount} chunks`)
                
                // 构建完整的响应对象
                const toolCalls = Array.from(toolCallsMap.values()).filter(tc => tc.id && tc.function.name)
                chatCompletion = {
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: allContent || null,
                            reasoning_content: allReasoningContent || null,
                            tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                        },
                        finish_reason: finishReason
                    }],
                    usage: usage || {}
                }
                
                logger.debug(`[OpenAI适配器] Stream响应: finish=${finishReason}, tools=${toolCalls.length}, content=${allContent.length}字符`)
            } else {
                chatCompletion = response
                
                // 简化响应日志
                const firstChoice = chatCompletion.choices?.[0]
                const toolCallCount = firstChoice?.message?.tool_calls?.length || 0
                const hasContent = !!firstChoice?.message?.content
                logger.debug(`[OpenAI适配器] 响应: finish=${firstChoice?.finish_reason}, tools=${toolCallCount}, hasContent=${hasContent}`)
                
                // debug级别打印完整tool_calls
                if (toolCallCount > 0) {
                    const toolNames = firstChoice.message.tool_calls.map(t => t.function?.name).join(', ')
                    logger.debug(`[OpenAI适配器] tool_calls: ${toolNames}`)
                }
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
            
            // 保存错误日志到文件
            logService.apiError('OpenAI', model, error, {
                baseUrl: this.baseUrl,
                messages: messages,
                tools: requestPayload.tools,
                stream: useStream,
                temperature: requestPayload.temperature,
                maxTokens: requestPayload.max_tokens || requestPayload.max_completion_tokens
            })
            
            // 检查是否启用错误时自动结清功能
            try {
                const config = (await import('../../../../config/config.js')).default
                const autoCleanConfig = config.get('features.autoCleanOnError')
                const autoCleanEnabled = autoCleanConfig?.enabled === true
                
                // 如果启用了自动结清，尝试回复用户
                if (autoCleanEnabled && options.event && options.event.reply) {
                    try {
                        const errorMsg = error.message || '未知错误'
                        await options.event.reply(`⚠️ API错误: ${errorMsg}\n已自动结清历史，请重新开始对话。`, true)
                        logger.debug('[OpenAI适配器] 已向用户回复错误信息')
                    } catch (replyErr) {
                        logger.error('[OpenAI适配器] 回复用户失败:', replyErr.message)
                    }
                }
            } catch (configErr) {
                logger.debug('[OpenAI适配器] 获取配置失败:', configErr.message)
            }
            
            // Re-throw to be handled by caller
            throw error
        }

        // 检查是否返回了错误
        if (chatCompletion?.error) {
            const errMsg = chatCompletion.error.message || chatCompletion.error.type || JSON.stringify(chatCompletion.error)
            logger.error('[OpenAI适配器] API返回错误:', errMsg)
            throw new Error(errMsg)
        }

        // Defensive check
        if (!chatCompletion || !chatCompletion.choices || !Array.isArray(chatCompletion.choices)) {
            logger.error('[OpenAI适配器] 响应格式错误，完整响应:', JSON.stringify(chatCompletion))
            throw new Error('API返回格式不符合OpenAI标准: choices字段缺失或格式错误')
        }

        const id = crypto.randomUUID()
        const toChaiteConverter = getIntoChaiteConverter('openai')

        let contents = chatCompletion.choices
            .map(ch => ch.message)
            .map(toChaiteConverter)
            .filter(ch => ch.content && ch.content.length > 0)
            .map(ch => ch.content)
            .reduce((a, b) => [...a, ...b], [])

        let toolCalls = chatCompletion.choices
            .map(ch => ch.message)
            .map(toChaiteConverter)
            .filter(ch => ch.toolCalls)
            .map(ch => ch.toolCalls)
            .reduce((a, b) => [...a, ...b], [])
        const textContents = contents.filter(c => c.type === 'text')
        for (let i = 0; i < textContents.length; i++) {
            const textItem = textContents[i]
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
                    logger.debug(`[OpenAI适配器] 从文本中解析到 ${parsedToolCalls.length} 个工具调用`)
                }
            }
        }
        
        // 过滤空文本
        contents = contents.filter(c => c.type !== 'text' || (c.text && c.text.trim()))

        const result = {
            id,
            parentId: options.parentMessageId,
            role: 'assistant',
            content: contents,
            toolCalls,
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
            // 添加浏览器请求头避免 CF 拦截
            defaultHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            },
        })

        const messages = []
        const model = options.model || 'gpt-4o-mini'

        // Gemini模型需要将图片URL转为base64
        const isGeminiModel = model.toLowerCase().includes('gemini')
        if (needsImageBase64Preprocess(model)) {
            histories = await preprocessImageUrls(histories)
        }
        // Gemini模型不支持thinking model的特殊参数（developer角色、max_completion_tokens等）
        const isThinkingModel = !isGeminiModel && (options.enableReasoning || options.isThinkingModel)

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
            stream_options: { include_usage: true },
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
        logger.debug('[OpenAI适配器] Streaming请求:', JSON.stringify({
            model: requestPayload.model,
            messages: requestPayload.messages?.length,
            tools: requestPayload.tools?.length || 0
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
            let finalUsage = null  // 流式模式下的usage信息

            for await (const chunk of stream) {
                // 捕获usage信息（在最后一个chunk中）
                if (chunk.usage) {
                    finalUsage = {
                        promptTokens: chunk.usage.prompt_tokens,
                        completionTokens: chunk.usage.completion_tokens,
                        totalTokens: chunk.usage.total_tokens
                    }
                }
                
                const delta = chunk.choices?.[0]?.delta || {}
                const content = delta.content || ''
                const reasoningContent = delta.reasoning_content || ''
                const toolCallsDelta = delta.tool_calls || []
                const finishReason = chunk.choices?.[0]?.finish_reason

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
                logger.debug(`[OpenAI适配器] 流式检测到 ${toolCalls.length} 个工具调用:`, 
                    toolCalls.map(t => t.function.name).join(', '))
                yield { type: 'tool_calls', toolCalls }
            }
            
            if (hasReasoningField) {
                // 有 reasoning_content 字段，最后输出思考内容
                if (allReasoning.trim()) {
                    logger.debug('[OpenAI适配器] 输出reasoning_content，长度:', allReasoning.length)
                    yield { type: 'reasoning', text: allReasoning.trim() }
                }
            } else if (allContent) {
                // 检查 <think> 标签（支持多种格式，包括不完整的标签）
                // 匹配完整的 <think>...</think> 或只有开头的 <think>...
                const fullThinkMatch = allContent.match(/^\s*<think>([\s\S]*?)<\/think>\s*/i)
                const partialThinkMatch = !fullThinkMatch && allContent.match(/^\s*<think>([\s\S]*)/i)
                
                if (fullThinkMatch) {
                    const thinkContent = fullThinkMatch[1].trim()
                    // 移除整个 <think>...</think> 标签，获取剩余内容
                    const restContent = allContent.substring(fullThinkMatch[0].length).trim()

                    if (thinkContent) {
                        logger.debug('[OpenAI适配器] 检测到<think>标签，长度:', thinkContent.length)
                        yield { type: 'reasoning', text: thinkContent }
                    }
                    if (restContent) {
                        // 检查剩余内容是否有 XML 工具调用
                        const { cleanText, toolCalls: xmlToolCalls } = parseXmlToolCalls(restContent)
                        if (xmlToolCalls.length > 0) {
                            logger.debug(`[OpenAI适配器] 解析到 ${xmlToolCalls.length} 个XML工具调用`)
                            yield { type: 'tool_calls', toolCalls: xmlToolCalls }
                        }
                        if (cleanText) {
                            yield { type: 'text', text: cleanText }
                        }
                    }
                } else if (partialThinkMatch) {
                    // 只有 <think> 开头但没有 </think> 结束，尝试分离
                    let content = partialThinkMatch[1]
                    // 查找 </think> 位置
                    const endTagIndex = content.toLowerCase().indexOf('</think>')
                    if (endTagIndex !== -1) {
                        const thinkContent = content.substring(0, endTagIndex).trim()
                        const restContent = content.substring(endTagIndex + 8).trim()  // 8 = '</think>'.length
                        
                        if (thinkContent) {
                            logger.debug('[OpenAI适配器] <think>标签分离模式，长度:', thinkContent.length)
                            yield { type: 'reasoning', text: thinkContent }
                        }
                        if (restContent) {
                            const { cleanText, toolCalls: xmlToolCalls } = parseXmlToolCalls(restContent)
                            if (xmlToolCalls.length > 0) {
                                yield { type: 'tool_calls', toolCalls: xmlToolCalls }
                            }
                            if (cleanText) {
                                yield { type: 'text', text: cleanText }
                            }
                        }
                    } else {
                        // 没有结束标签，整个内容作为思考内容
                        logger.debug('[OpenAI适配器] <think>无结束标签')
                        yield { type: 'reasoning', text: content.trim() }
                    }
                } else {
                    // 没有<think>标签，检查 XML 工具调用后输出
                    const { cleanText, toolCalls: xmlToolCalls } = parseXmlToolCalls(allContent)
                    if (xmlToolCalls.length > 0) {
                        logger.debug(`[OpenAI适配器] 解析到 ${xmlToolCalls.length} 个XML工具调用`)
                        yield { type: 'tool_calls', toolCalls: xmlToolCalls }
                    }
                    if (cleanText) {
                        yield { type: 'text', text: cleanText }
                    }
                }
            }
            
            // 输出usage信息
            if (finalUsage) {
                yield { type: 'usage', usage: finalUsage }
            }
            
            // 日志：流式结束
            logger.debug(`[OpenAI适配器] Stream完成: content=${allContent.length}字符, toolCalls=${hasToolCalls}, usage=${JSON.stringify(finalUsage)}`)
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
            defaultHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
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

    /**
     * List available models from the API
     * @returns {Promise<string[]>}
     */
    async listModels() {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const client = new OpenAI({
            apiKey,
            baseURL: this.baseUrl,
            defaultHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        })

        try {
            const modelsList = await client.models.list()
            return modelsList.data.map(m => m.id).sort()
        } catch (error) {
            logger.error('[OpenAI适配器] 获取模型列表失败:', error.message)
            throw error
        }
    }

    /**
     * Get model information
     * @param {string} modelId - Model ID
     * @returns {Promise<Object>}
     */
    async getModelInfo(modelId) {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const client = new OpenAI({
            apiKey,
            baseURL: this.baseUrl,
            defaultHeaders: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        })

        try {
            const model = await client.models.retrieve(modelId)
            return {
                id: model.id,
                object: model.object,
                created: model.created,
                owned_by: model.owned_by,
            }
        } catch (error) {
            logger.error('[OpenAI适配器] 获取模型信息失败:', error.message)
            throw error
        }
    }
}
