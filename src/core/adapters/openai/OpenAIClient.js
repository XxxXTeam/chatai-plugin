import { chatLogger } from '../../utils/logger.js'
const logger = chatLogger
import OpenAI from 'openai'
import crypto from 'node:crypto'
import {
    AbstractClient,
    preprocessImageUrls,
    needsImageBase64Preprocess,
    parseXmlToolCalls,
    resolveModelName
} from '../AbstractClient.js'
import { getFromChaiteConverter, getFromChaiteToolConverter, getIntoChaiteConverter } from '../../utils/converter.js'
import './converter.js'
import { proxyService } from '../../../services/proxy/ProxyService.js'
import { logService } from '../../../services/stats/LogService.js'
import { requestTemplateService } from '../../../services/proxy/RequestTemplateService.js'
import { statsService } from '../../../services/stats/StatsService.js'
import { attachToolMetadata, mergeToolDefinitions, resolveToolChoice } from '../tooling.js'

/**
 * 未指定模型且全局默认模型也为空时的兜底模型
 * @type {string}
 */
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

let ResponsesWSClassPromise = null
const RESPONSES_EXTRA_PARAM_KEYS = [
    'background',
    'context_management',
    'conversation',
    'include',
    'instructions',
    'max_output_tokens',
    'max_tool_calls',
    'metadata',
    'moderation',
    'parallel_tool_calls',
    'previous_response_id',
    'prompt',
    'prompt_cache_key',
    'prompt_cache_retention',
    'reasoning',
    'safety_identifier',
    'service_tier',
    'store',
    'stream_options',
    'temperature',
    'text',
    'top_logprobs',
    'top_p',
    'truncation',
    'user'
]
const OPENAI_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const RESPONSES_EXECUTABLE_ITEM_TYPES = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'shell_call'])

function mergeResponseTools(functionTools = [], openaiResponses = {}) {
    const extraTools = Array.isArray(openaiResponses.tools) ? openaiResponses.tools : []
    return mergeToolDefinitions(functionTools, extraTools)
}

function resolveOpenAIResponsesOptions(options = {}, clientOptions = {}) {
    return {
        ...(clientOptions.openaiResponses || {}),
        ...(options.openaiResponses || {}),
        ...(options.responsesOptions || {})
    }
}

function normalizeOpenAIUsage(usage = {}) {
    const promptDetails = usage.prompt_tokens_details || usage.input_tokens_details || {}
    const completionDetails = usage.completion_tokens_details || usage.output_tokens_details || {}
    const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokens
    const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? usage.completionTokens
    const totalTokens =
        usage.total_tokens ?? usage.totalTokens ?? ((promptTokens || 0) + (completionTokens || 0) || undefined)
    const cacheReadTokens =
        promptDetails.cached_tokens ||
        usage.cache_read_input_tokens ||
        usage.cacheReadTokens ||
        usage.cachedTokens ||
        usage.cached_tokens ||
        0
    const cacheWriteTokens =
        promptDetails.cache_creation_tokens ||
        usage.cache_creation_input_tokens ||
        usage.cacheWriteTokens ||
        usage.cacheCreationTokens ||
        usage.cache_creation_tokens ||
        0
    const reasoningTokens = completionDetails.reasoning_tokens || usage.reasoning_tokens || usage.reasoningTokens || 0
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        promptTokens,
        completionTokens,
        totalTokens,
        cachedTokens: cacheReadTokens,
        cached_tokens: cacheReadTokens,
        cache_read_input_tokens: cacheReadTokens,
        cacheReadTokens,
        cache_creation_input_tokens: cacheWriteTokens,
        cacheWriteTokens,
        cacheCreationTokens: cacheWriteTokens,
        cacheReadCount: usage.cacheReadCount || (cacheReadTokens > 0 ? 1 : 0),
        cacheWriteCount: usage.cacheWriteCount || (cacheWriteTokens > 0 ? 1 : 0),
        reasoningTokens
    }
}

function attachUsageModel(usage = {}, model) {
    const normalized = normalizeOpenAIUsage(usage || {})
    const responseModel = model || usage.responseModel || usage.model
    if (responseModel) {
        normalized.model = responseModel
        normalized.responseModel = responseModel
    }
    return normalized
}

function resolveOpenAIWsOptions(options = {}, clientOptions = {}) {
    return {
        ...(clientOptions.openaiWs || {}),
        ...(clientOptions.experimental?.ws || {}),
        ...(options.openaiWs || {}),
        ...(options.experimental?.ws || {})
    }
}

async function loadResponsesWSClass() {
    if (!ResponsesWSClassPromise) {
        ResponsesWSClassPromise = import('openai/resources/responses/ws').then(mod => mod.ResponsesWS)
    }
    return await ResponsesWSClassPromise
}

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
 * 验证并清理消息数组
 * @param {Array} messages - OpenAI 格式的消息数组
 * @returns {Array} 清理后的消息数组
 */
function validateAndCleanMessages(messages) {
    if (!messages || !Array.isArray(messages)) return messages

    const normalizedMessages = messages.map(message => {
        if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) return message

        const seenIds = new Set()
        const toolCalls = message.tool_calls.filter(toolCall => {
            if (!toolCall?.id || seenIds.has(toolCall.id)) return false
            seenIds.add(toolCall.id)
            return true
        })
        return toolCalls.length === message.tool_calls.length ? message : { ...message, tool_calls: toolCalls }
    })

    const cleaned = []
    let lastAssistantIndex = -1
    let pendingToolMessages = []
    const validToolCallIds = new Set()
    const matchedToolCallIds = new Set()
    const fixIncompleteToolCalls = () => {
        if (lastAssistantIndex >= 0 && validToolCallIds.size > 0) {
            const assistantMsg = cleaned[lastAssistantIndex]
            if (assistantMsg && assistantMsg.tool_calls) {
                const originalCount = assistantMsg.tool_calls.length
                assistantMsg.tool_calls = assistantMsg.tool_calls.filter(tc => tc.id && matchedToolCallIds.has(tc.id))
                if (assistantMsg.tool_calls.length === 0) {
                    delete assistantMsg.tool_calls
                }
                if (originalCount !== (assistantMsg.tool_calls?.length || 0)) {
                    const removedIds = assistantMsg.tool_calls ? [] : Array.from(validToolCallIds)
                    logger.debug(
                        `[消息验证] 修复不完整的 tool_calls: ${originalCount} -> ${assistantMsg.tool_calls?.length || 0}, 未匹配ID: [${Array.from(validToolCallIds).join(', ')}], 已匹配ID: [${Array.from(matchedToolCallIds).join(', ')}]`
                    )
                }
            }
        }
        lastAssistantIndex = -1
        validToolCallIds.clear()
        matchedToolCallIds.clear()
    }

    for (let i = 0; i < normalizedMessages.length; i++) {
        const msg = normalizedMessages[i]

        if (msg.role === 'assistant') {
            fixIncompleteToolCalls()

            if (pendingToolMessages.length > 0) {
                logger.debug(`[消息验证] 丢弃 ${pendingToolMessages.length} 个孤立的 tool 消息`)
                pendingToolMessages = []
            }

            cleaned.push(msg)

            // 检查 tool_calls (OpenAI格式) 和 toolCalls (内部格式)
            const toolCallsArr = msg.tool_calls || msg.toolCalls
            if (toolCallsArr && toolCallsArr.length > 0) {
                lastAssistantIndex = cleaned.length - 1
                for (const tc of toolCallsArr) {
                    if (tc.id) validToolCallIds.add(tc.id)
                }
                logger.debug(
                    `[消息验证] assistant消息有tool_calls: ${toolCallsArr.length}个, IDs: [${toolCallsArr.map(tc => tc.id).join(', ')}]`
                )
            }
        } else if (msg.role === 'tool') {
            if (lastAssistantIndex >= 0 && validToolCallIds.has(msg.tool_call_id)) {
                cleaned.push(msg)
                matchedToolCallIds.add(msg.tool_call_id)
                validToolCallIds.delete(msg.tool_call_id)
                if (validToolCallIds.size === 0) {
                    lastAssistantIndex = -1
                    matchedToolCallIds.clear()
                }
            } else {
                logger.debug(
                    `[消息验证] tool消息未匹配: tool_call_id=${msg.tool_call_id}, lastAssistantIndex=${lastAssistantIndex}, validIds=[${Array.from(validToolCallIds).join(', ')}]`
                )
                pendingToolMessages.push(msg)
            }
        } else {
            fixIncompleteToolCalls()

            if (pendingToolMessages.length > 0) {
                logger.debug(`[消息验证] 丢弃 ${pendingToolMessages.length} 个孤立的 tool 消息`)
                pendingToolMessages = []
            }

            cleaned.push(msg)
        }
    }

    // 处理末尾未完成的 tool_calls
    fixIncompleteToolCalls()

    // 处理末尾残留的孤立 tool 消息
    if (pendingToolMessages.length > 0) {
        const orphanedIds = pendingToolMessages.map(m => m.tool_call_id || 'no_id').join(', ')
        logger.debug(
            `[消息验证] 丢弃末尾 ${pendingToolMessages.length} 个孤立的 tool 消息, IDs: [${orphanedIds}], lastAssistantIndex: ${lastAssistantIndex}`
        )
    }

    return cleaned
}

function normalizeChatCompletionMessages(messages) {
    if (!Array.isArray(messages)) return messages

    let normalizedCount = 0
    const normalized = messages.map(message => {
        if (!message || message.role !== 'developer') return message
        normalizedCount += 1
        return { ...message, role: 'system' }
    })

    if (normalizedCount > 0) {
        logger.debug(`[OpenAI适配器] 不支持 developer 角色，已将 ${normalizedCount} 条消息降级为 system`)
    }

    return normalized
}

function resolveSystemPromptConfig(options = {}, clientOptions = {}) {
    const raw = options.systemPromptConfig ?? clientOptions.systemPromptConfig
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

    return {
        mode: raw.mode || 'inherit',
        target: raw.target || 'messages',
        fieldName: typeof raw.fieldName === 'string' ? raw.fieldName : '',
        role: typeof raw.role === 'string' && raw.role.trim() ? raw.role.trim() : 'auto',
        override: typeof raw.override === 'string' ? raw.override : '',
        prefix: typeof raw.prefix === 'string' ? raw.prefix : '',
        suffix: typeof raw.suffix === 'string' ? raw.suffix : ''
    }
}

function resolveSystemPromptRole(systemPromptConfig, isThinkingModel) {
    if (!systemPromptConfig || systemPromptConfig.role === 'auto') {
        return isThinkingModel ? 'developer' : 'system'
    }
    return systemPromptConfig.role
}

function applySystemPromptRouting({ messages, requestPayload, systemPromptConfig, systemPrompt, isThinkingModel }) {
    if (!systemPromptConfig || !systemPrompt) return

    const target = systemPromptConfig.target || 'messages'
    const role = resolveSystemPromptRole(systemPromptConfig, isThinkingModel)

    if (target === 'instructions') {
        requestPayload.instructions = systemPrompt
        return
    }

    if (target === 'top_level_text' && systemPromptConfig.fieldName) {
        requestPayload[systemPromptConfig.fieldName] = systemPrompt
        return
    }

    if (target === 'top_level_object' && systemPromptConfig.fieldName) {
        requestPayload[systemPromptConfig.fieldName] = {
            role,
            content: systemPrompt
        }
        return
    }

    messages.push({ role, content: systemPrompt })
}

/**
 * 递归清理工具定义中的 enum 值，确保都是字符串类型（Gemini API 要求）
 * @param {object} obj - 工具定义对象
 * @returns {object} 清理后的对象
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

function sanitizeToolWithMetadata(tool) {
    return attachToolMetadata(sanitizeToolEnums(tool), tool)
}

/**
 * 合并单次请求与客户端上的推理相关选项（单次请求优先）
 * @param {object} options
 * @param {object} [clientOpts]
 * @returns {{ enableReasoning: boolean, reasoningEffort: string|undefined, thinkingVendorControl: string,
 *   isThinkingModelFlag: boolean|undefined, supportsReasoningParams: boolean|undefined }}
 */
function mergeOpenAIReasoningOptions(options, clientOpts) {
    const enableReasoning = options.enableReasoning ?? clientOpts?.enableReasoning ?? false
    const requestedReasoningEffort = options.reasoningEffort ?? clientOpts?.reasoningEffort ?? 'low'
    const reasoningEffort =
        requestedReasoningEffort !== 'auto' && OPENAI_REASONING_EFFORTS.has(requestedReasoningEffort)
            ? requestedReasoningEffort
            : undefined
    const thinkingVendorControl = options.thinkingVendorControl ?? clientOpts?.thinkingVendorControl ?? 'auto'
    const isThinkingModelFlag = options.isThinkingModel
    /*
     * 端点是否接受 OpenAI 推理模型专有参数（developer 角色 / max_completion_tokens / reasoning_effort）。
     * 由渠道 experimental.supportsReasoningParams 显式声明；未声明时留空，交由调用方按模型名兜底推断。
     */
    const supportsReasoningParams =
        typeof options.supportsReasoningParams === 'boolean'
            ? options.supportsReasoningParams
            : typeof clientOpts?.experimental?.supportsReasoningParams === 'boolean'
              ? clientOpts.experimental.supportsReasoningParams
              : undefined
    return { enableReasoning, reasoningEffort, thinkingVendorControl, isThinkingModelFlag, supportsReasoningParams }
}

/**
 * 判断端点是否接受 OpenAI 推理模型专有参数
 *
 * 该结论决定系统提示走 developer 还是 system 角色、以及发 max_completion_tokens 还是 max_tokens。
 * 原实现仅用 `model.includes('gemini')` 推断，会让"非 Gemini 的非推理模型 + 打开思考开关"
 * 被强行发送 developer role 与 max_completion_tokens，许多 OpenAI 兼容网关会直接返回 400。
 * 现在渠道可通过 experimental.supportsReasoningParams 直接声明，推断仅作兜底。
 *
 * @param {boolean|undefined} declared - 渠道显式声明值
 * @param {string} model - 模型名称
 * @returns {boolean} 是否接受推理模型专有参数
 */
function acceptsReasoningParams(declared, model) {
    if (typeof declared === 'boolean') return declared
    // 兜底推断：Gemini 兼容端点不接受这些参数
    return !String(model || '')
        .toLowerCase()
        .includes('gemini')
}

/**
 * @param {'auto' | 'off' | 'glm'} control
 * @param {string} [baseUrl]
 */
function shouldAttachVendorThinkingType(control, baseUrl) {
    if (control === 'off') return false
    if (control === 'glm') return true
    const u = (baseUrl || '').toLowerCase()
    return (
        u.includes('bigmodel') ||
        u.includes('open.bigmodel') ||
        u.includes('zhipu') ||
        u.includes('glm') ||
        u.includes('maas')
    )
}

/**
 * BigModel / 智谱等：请求体需显式传 thinking.type（enabled/disabled），否则关闭 UI 后仍可能触发自适应思考
 */
function applyVendorThinkingPayload(requestPayload, enableReasoning, baseUrl, thinkingVendorControl) {
    if (!shouldAttachVendorThinkingType(thinkingVendorControl, baseUrl)) return
    requestPayload.thinking = { type: enableReasoning ? 'enabled' : 'disabled' }
}

/**
 * OpenAI客户端实现
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
     * 发送消息到OpenAI
     * @param {IMessage[]} histories
     * @param {string} apiKey
     * @param {SendMessageOption} options
     * @returns {Promise<HistoryMessage & { usage: ModelUsage }>}
     */
    getOpenAIInterfaceMode(options = {}) {
        return (
            options.apiInterface ||
            this.options?.apiInterface ||
            this.options?.openaiApiInterface ||
            'chat'
        ).toLowerCase()
    }

    getOpenAIResponsePath() {
        return this.endpoints?.responses || this.responsePath || '/responses'
    }

    shouldUseOpenAIResponses(options = {}) {
        return (
            this.getOpenAIInterfaceMode(options) === 'responses' || this.getOpenAIInterfaceMode(options) === 'response'
        )
    }

    shouldUseExperimentalOpenAIWs(options = {}) {
        const wsConfig = resolveOpenAIWsOptions(options, this.options)
        return this.shouldUseOpenAIResponses(options) && (options.experimentalWs === true || wsConfig.enabled === true)
    }

    async resolveResponsesWSClass(wsConfig = {}) {
        return wsConfig.ResponsesWSClass || (await loadResponsesWSClass())
    }

    buildOpenAIClientOptions(apiKey, mergedHeaders, channelProxy, responsePath) {
        const clientOptions = {
            apiKey,
            defaultHeaders: mergedHeaders
        }
        if (this.baseUrl) {
            clientOptions.baseURL = this.baseUrl
        }
        // 接通渠道 timeout.read，未配置时沿用 SDK 默认值
        const requestTimeout = this.resolveRequestTimeout()
        if (requestTimeout) {
            clientOptions.timeout = requestTimeout
        }
        if (channelProxy) {
            clientOptions.httpAgent = channelProxy
            logger.debug('[OpenAI适配器] 使用代理:', proxyService.getProfileForScope('channel')?.name)
        }

        const originalBaseUrl = (this.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
        const buildEndpointUrl = endpointPath =>
            originalBaseUrl + (endpointPath.startsWith('/') ? endpointPath : '/' + endpointPath)
        const customChatPath = this.endpoints?.chat || this.chatPath
        const customModelsPath = this.endpoints?.models || this.modelsPath
        const customResponsePath = responsePath || this.endpoints?.responses || this.responsePath
        if (
            customChatPath ||
            customModelsPath ||
            this.endpoints?.embeddings ||
            this.endpoints?.images ||
            customResponsePath
        ) {
            clientOptions.fetch = async (url, init) => {
                let newUrl = url.toString()
                if (customChatPath && newUrl.includes('/chat/completions')) {
                    newUrl = buildEndpointUrl(customChatPath)
                    logger.debug(`[OpenAI适配器] 使用自定义对话端点: ${newUrl}`)
                }
                if (customResponsePath && newUrl.includes('/responses')) {
                    newUrl = buildEndpointUrl(customResponsePath)
                    logger.debug(`[OpenAI适配器] 使用Responses端点: ${newUrl}`)
                }
                if (customModelsPath && newUrl.includes('/models')) {
                    newUrl = buildEndpointUrl(customModelsPath)
                    logger.debug(`[OpenAI适配器] 使用自定义模型列表端点: ${newUrl}`)
                }
                if (this.endpoints?.embeddings && newUrl.includes('/embeddings')) {
                    newUrl = buildEndpointUrl(this.endpoints.embeddings)
                    logger.debug(`[OpenAI适配器] 使用自定义嵌入端点: ${newUrl}`)
                }
                if (this.endpoints?.images && newUrl.includes('/images/generations')) {
                    newUrl = buildEndpointUrl(this.endpoints.images)
                    logger.debug(`[OpenAI适配器] 使用自定义图像生成端点: ${newUrl}`)
                }
                return fetch(newUrl, init)
            }
        }

        return clientOptions
    }

    buildResponsesWSClientOptions(apiKey, mergedHeaders, channelProxy) {
        return this.buildOpenAIClientOptions(apiKey, mergedHeaders, channelProxy, this.getOpenAIResponsePath())
    }

    openAIMessageContentToResponseInputContent(content) {
        if (typeof content === 'string') {
            return [{ type: 'input_text', text: content }]
        }
        if (!Array.isArray(content)) {
            return [{ type: 'input_text', text: content ? String(content) : '' }]
        }
        return content
            .map(item => {
                if (!item || typeof item !== 'object') return null
                if (item.type === 'text') return { type: 'input_text', text: item.text || '' }
                if (item.type === 'image_url')
                    return { type: 'input_image', image_url: item.image_url?.url || item.url || '' }
                if (item.type === 'input_audio') return { type: 'input_audio', input_audio: item.input_audio }
                return item
            })
            .filter(Boolean)
    }

    openAIMessagesToResponsesInput(messages) {
        return messages.flatMap(message => {
            if (message.role === 'tool') {
                return [
                    {
                        type: 'function_call_output',
                        call_id: message.tool_call_id,
                        output:
                            typeof message.content === 'string'
                                ? message.content
                                : JSON.stringify(message.content ?? '')
                    }
                ]
            }

            const items = []
            const hasContent =
                typeof message.content === 'string'
                    ? message.content.length > 0
                    : Array.isArray(message.content) && message.content.length > 0
            if (hasContent || !message.tool_calls?.length) {
                items.push({
                    type: 'message',
                    role: message.role === 'developer' ? 'system' : message.role,
                    content: this.openAIMessageContentToResponseInputContent(message.content)
                })
            }

            for (const toolCall of message.tool_calls || []) {
                items.push({
                    type: 'function_call',
                    call_id: toolCall.id,
                    name: toolCall.function?.name || '',
                    arguments: toolCall.function?.arguments || '{}'
                })
            }

            return items
        })
    }

    openAIToolsToResponsesTools(tools) {
        return tools.map(tool => {
            if (tool?.type === 'function' && tool.function) {
                return {
                    type: 'function',
                    name: tool.function.name,
                    description: tool.function.description || '',
                    parameters: tool.function.parameters || { type: 'object', properties: {} }
                }
            }
            if (tool?.type === 'custom' && tool.custom?.name) {
                return {
                    type: 'custom',
                    name: tool.custom.name,
                    description: tool.custom.description,
                    format: tool.custom.format
                }
            }
            return tool
        })
    }

    copyResponsesExtraParams(payload, requestPayload, options = {}, openaiResponses = {}) {
        for (const key of RESPONSES_EXTRA_PARAM_KEYS) {
            const directValue = requestPayload[key] ?? options[key]
            if (directValue !== undefined && directValue !== null) {
                payload[key] = directValue
                continue
            }
            const configuredValue = openaiResponses[key]
            if (
                (payload[key] === undefined || payload[key] === null) &&
                configuredValue !== undefined &&
                configuredValue !== null
            ) {
                payload[key] = configuredValue
            }
        }
    }

    buildResponsesPayload(requestPayload, options = {}) {
        const openaiResponses = resolveOpenAIResponsesOptions(options, this.options)
        const payload = {
            model: requestPayload.model,
            input: this.openAIMessagesToResponsesInput(requestPayload.messages || []),
            temperature: requestPayload.temperature,
            stream: requestPayload.stream,
            tools: requestPayload.tools?.length ? this.openAIToolsToResponsesTools(requestPayload.tools) : undefined,
            tool_choice: requestPayload.tool_choice,
            reasoning:
                requestPayload.reasoning ||
                (requestPayload.reasoning_effort ? { effort: requestPayload.reasoning_effort } : undefined),
            previous_response_id: options.previous_response_id || options.previousResponseId,
            store: options.storeResponse === true || options.store === true ? true : undefined
        }
        if (openaiResponses.tool_choice !== undefined && payload.tool_choice === undefined) {
            payload.tool_choice = openaiResponses.tool_choice
        }
        this.copyResponsesExtraParams(payload, requestPayload, options, openaiResponses)

        if (requestPayload.max_completion_tokens || requestPayload.max_tokens) {
            payload.max_output_tokens = requestPayload.max_completion_tokens || requestPayload.max_tokens
        }
        const systemPromptConfig = resolveSystemPromptConfig(options, this.options)
        if (
            systemPromptConfig?.fieldName &&
            (systemPromptConfig.target === 'top_level_text' || systemPromptConfig.target === 'top_level_object') &&
            requestPayload[systemPromptConfig.fieldName] !== undefined
        ) {
            payload[systemPromptConfig.fieldName] = requestPayload[systemPromptConfig.fieldName]
        }
        Object.keys(payload).forEach(key => {
            if (payload[key] === undefined || payload[key] === null) delete payload[key]
        })
        return payload
    }

    normalizeResponsesToolCall(item) {
        if (item.type === 'local_shell_call') {
            const action = item.action || {}
            const command = Array.isArray(action.command) ? action.command.join(' ') : action.command || ''
            return {
                id: item.call_id || item.id || crypto.randomUUID(),
                type: 'function',
                function: {
                    name: 'execute_command',
                    arguments: JSON.stringify({
                        command,
                        cwd: action.working_directory || undefined,
                        timeout: action.timeout_ms || undefined
                    })
                }
            }
        }
        if (item.type === 'shell_call') {
            const action = item.action || {}
            const commands = Array.isArray(action.commands) ? action.commands : []
            return {
                id: item.call_id || item.id || crypto.randomUUID(),
                type: 'function',
                function: {
                    name: 'execute_command',
                    arguments: JSON.stringify({
                        command: commands.join('\n'),
                        timeout: action.timeout_ms || undefined
                    })
                }
            }
        }
        const args = item.arguments ?? item.action?.arguments ?? item.input ?? item.custom?.input ?? '{}'
        const normalizedArgs =
            item.type === 'custom_tool_call' && typeof args === 'string'
                ? JSON.stringify({ input: args })
                : typeof args === 'string'
                  ? args
                  : JSON.stringify(args || {})
        return {
            id: item.call_id || item.id || crypto.randomUUID(),
            type: 'function',
            function: {
                name: item.name || item.action?.name || item.function?.name || item.custom?.name || '',
                arguments: normalizedArgs
            }
        }
    }

    upsertChatToolCall(toolCallsMap, deltaToolCall) {
        const idx = deltaToolCall.index ?? toolCallsMap.size
        if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, {
                id: deltaToolCall.id || '',
                type: 'function',
                function: { name: '', arguments: '' }
            })
        }

        const existing = toolCallsMap.get(idx)
        if (deltaToolCall.id) existing.id = deltaToolCall.id
        if (deltaToolCall.function?.name) existing.function.name += deltaToolCall.function.name
        if (deltaToolCall.function?.arguments) existing.function.arguments += deltaToolCall.function.arguments
        if (deltaToolCall.custom?.name) existing.function.name += deltaToolCall.custom.name
        if (deltaToolCall.custom?.input) existing.function.arguments += deltaToolCall.custom.input
        return existing
    }

    normalizeExecutableToolCalls(toolCalls = []) {
        return toolCalls.map(toolCall => {
            const args = toolCall.function?.arguments
            if (typeof args !== 'string' || !args) return toolCall
            try {
                JSON.parse(args)
                return toolCall
            } catch {
                return {
                    ...toolCall,
                    function: {
                        ...toolCall.function,
                        arguments: JSON.stringify({ input: args })
                    }
                }
            }
        })
    }

    responsesOutputItemToText(item) {
        if (!item || typeof item !== 'object') return ''
        if (item.type === 'additional_tools') {
            const role = item.role || 'unknown'
            const toolCount = Array.isArray(item.tools) ? item.tools.length : 0
            return `[additional_tools ${role}: ${toolCount} tools]`
        }
        if (item.type === 'image_generation_call') {
            return item.result ? '[image_generation_call completed]' : ''
        }
        if (item.type === 'code_interpreter_call') {
            const outputs = Array.isArray(item.outputs) ? item.outputs : []
            const outputText = outputs
                .map(output => {
                    if (output.type === 'logs') return output.logs || ''
                    if (output.type === 'image') return output.url ? `[code_interpreter_image] ${output.url}` : ''
                    return ''
                })
                .filter(Boolean)
                .join('\n')
            if (outputText) return outputText
            if (item.code) return `[code_interpreter_call ${item.status || 'completed'}]\n${item.code}`
            return item.status ? `[code_interpreter_call ${item.status}]` : ''
        }
        if (item.type === 'tool_search_call') {
            return item.status ? `[tool_search_call ${item.status}]` : ''
        }
        if (item.type === 'tool_search_output') {
            const toolCount = Array.isArray(item.tools) ? item.tools.length : 0
            return `[tool_search_output ${item.status || 'completed'}: ${toolCount} tools]`
        }
        if (item.type === 'file_search_call') {
            const status = item.status || 'completed'
            const resultCount = Array.isArray(item.results) ? item.results.length : 0
            return `[file_search_call ${status}: ${resultCount} results]`
        }
        if (item.type === 'web_search_call') {
            const status = item.status || 'completed'
            const action = item.action?.type ? ` ${item.action.type}` : ''
            return `[web_search_call${action} ${status}]`
        }
        if (item.type === 'computer_call') {
            const status = item.status || 'completed'
            const action = item.action?.type || (Array.isArray(item.actions) && item.actions.length ? 'actions' : '')
            return `[computer_call${action ? ` ${action}` : ''} ${status}]`
        }
        if (item.type === 'computer_call_output') {
            const callId = item.call_id || item.id || 'computer_call'
            const output = item.output?.type ? ` ${item.output.type}` : ''
            return `[computer_call_output ${callId}${output}]`
        }
        if (item.type === 'mcp_list_tools') {
            const server = item.server_label || 'mcp'
            const toolCount = Array.isArray(item.tools) ? item.tools.length : 0
            const error = item.error ? `: ${item.error}` : ''
            return `[${server} list_tools ${error ? 'failed' : 'completed'}: ${toolCount} tools]${error}`
        }
        if (item.type === 'mcp_call') {
            const name = item.name || 'mcp_call'
            const status = item.status || 'completed'
            const output = typeof item.output === 'string' ? `: ${item.output}` : item.error ? `: ${item.error}` : ''
            return `[${name} ${status}]${output}`
        }
        if (item.type === 'mcp_approval_request') {
            const name = item.name || 'mcp_approval_request'
            return `[${name} approval_required]`
        }
        if (item.type === 'mcp_approval_response') {
            return `[mcp_approval_response ${item.approve ? 'approved' : 'rejected'}]`
        }
        if (item.type === 'apply_patch_call') {
            const operation = item.operation?.type ? ` ${item.operation.type}` : ''
            const path = item.operation?.path ? ` ${item.operation.path}` : ''
            const status = item.status || 'completed'
            return `[apply_patch_call${operation}${path} ${status}]`
        }
        if (item.type === 'compaction') {
            const creator = item.created_by ? ` by ${item.created_by}` : ''
            return `[compaction${creator}]`
        }
        if (item.type?.endsWith?.('_output')) {
            const output = item.output
            if (typeof output === 'string') return output
            if (Array.isArray(output)) {
                return output
                    .map(part => {
                        if (typeof part === 'string') return part
                        if (part?.stdout || part?.stderr) return [part.stdout, part.stderr].filter(Boolean).join('\n')
                        return ''
                    })
                    .filter(Boolean)
                    .join('\n')
            }
        }
        return ''
    }

    upsertResponsesToolCall(state, event) {
        const toolCallsMap = state.toolCallsMap || state
        const toolCallAliases = state.toolCallAliases || new Map()
        const aliases = new Set([event.item_id, event.item?.id, event.item?.call_id].filter(Boolean))
        const existingKey = [...aliases]
            .map(alias => toolCallAliases.get(alias) || alias)
            .find(alias => toolCallsMap.has(alias))

        if (RESPONSES_EXECUTABLE_ITEM_TYPES.has(event.item?.type)) {
            const normalized = this.normalizeResponsesToolCall(event.item)
            aliases.add(normalized.id)
            const key = existingKey || normalized.id
            const existing = toolCallsMap.get(key) || {
                id: normalized.id,
                type: 'function',
                function: { name: '', arguments: '' }
            }
            existing.id = normalized.id
            existing.function.name = normalized.function.name || existing.function.name
            existing.function.arguments = normalized.function.arguments || existing.function.arguments
            toolCallsMap.set(existing.id, existing)
            if (existing.id !== key) toolCallsMap.delete(key)
            for (const alias of aliases) toolCallAliases.set(alias, existing.id)
            return existing
        }

        const id =
            existingKey ||
            event.item_id ||
            event.item?.id ||
            event.item?.call_id ||
            String(event.output_index ?? toolCallsMap.size)
        const existing = toolCallsMap.get(id) || {
            id,
            type: 'function',
            function: {
                name: event.name || event.item?.name || event.item?.function?.name || '',
                arguments: ''
            }
        }

        if (event.name) existing.function.name = event.name
        if (event.input) existing.function.arguments = event.input
        if (typeof event.delta === 'string') existing.function.arguments += event.delta
        if (typeof event.arguments === 'string') existing.function.arguments = event.arguments
        if (state.outputItems && typeof state.outputItems.get === 'function') {
            const outputKey = this.resolveResponsesOutputItemKey(state, event)
            const outputItem = outputKey ? state.outputItems.get(outputKey) : null
            if (outputItem) {
                if (event.name) outputItem.name = event.name
                if (event.type?.startsWith?.('response.custom_tool_call_input.')) {
                    if (event.input) outputItem.input = event.input
                    if (typeof event.delta === 'string') outputItem.input = (outputItem.input || '') + event.delta
                } else {
                    if (event.input) outputItem.arguments = event.input
                    if (typeof event.delta === 'string')
                        outputItem.arguments = (outputItem.arguments || '') + event.delta
                    if (typeof event.arguments === 'string') outputItem.arguments = event.arguments
                }
                state.outputItems.set(outputKey, outputItem)
            }
        }
        toolCallsMap.set(existing.id || id, existing)
        if ((existing.id || id) !== id) toolCallsMap.delete(id)
        for (const alias of aliases) toolCallAliases.set(alias, existing.id || id)
        return existing
    }

    applyResponsesResponseMetadata(state, response, fallbackStatus) {
        if (!response || typeof response !== 'object') return
        state.usage = response.usage || state.usage
        state.status = response.status || fallbackStatus || state.status
        state.responseId = response.id || state.responseId
        state.responseModel = response.model || state.responseModel
        if (response.object === 'response.compaction') {
            state.status = fallbackStatus || 'completed'
        }
        if (Array.isArray(response.output)) {
            for (const item of response.output) this.upsertResponsesOutputItem(state, item)
        }
    }

    getResponsesOutputItemKey(item, event = {}) {
        return (
            item?.id ||
            item?.call_id ||
            event.item_id ||
            event.item?.id ||
            event.item?.call_id ||
            String(event.output_index ?? '')
        )
    }

    resolveResponsesOutputItemKey(state, event = {}, item = null) {
        const aliases = [item?.id, item?.call_id, event.item_id, event.item?.id, event.item?.call_id].filter(Boolean)
        for (const alias of aliases) {
            const key = state.outputItemAliases.get(alias) || alias
            if (state.outputItems.has(key)) return key
        }
        if (event.output_index !== undefined && event.output_index !== null) {
            const key = state.outputIndexKeys.get(event.output_index)
            if (key && state.outputItems.has(key)) return key
        }
        return this.getResponsesOutputItemKey(item, event)
    }

    upsertResponsesOutputItem(state, item, event = {}) {
        if (!item || typeof item !== 'object') return null
        const key = this.resolveResponsesOutputItemKey(state, event, item)
        if (!key) return null
        const aliases = new Set(
            [key, item.id, item.call_id, event.item_id, event.item?.id, event.item?.call_id].filter(Boolean)
        )
        const existingKey =
            [...aliases]
                .map(alias => state.outputItemAliases.get(alias) || alias)
                .find(alias => state.outputItems.has(alias)) || key
        const existing = state.outputItems.get(existingKey) || {}
        const merged = { ...existing, ...item }
        state.outputItems.set(existingKey, merged)
        for (const alias of aliases) {
            if (alias !== existingKey) state.outputItems.delete(alias)
            state.outputItemAliases.set(alias, existingKey)
        }
        if (event.output_index !== undefined && event.output_index !== null) {
            state.outputIndexKeys.set(event.output_index, existingKey)
        }
        return merged
    }

    applyResponsesOutputItemsToState(state) {
        const response = {
            id: state.responseId,
            model: state.responseModel,
            status: state.status,
            usage: state.usage,
            output: Array.from(state.outputItems.values())
        }
        const converted = this.responsesOutputToChatCompletion(response)
        const msg = converted.choices?.[0]?.message || {}
        state.content = state.content || msg.content || ''
        state.reasoningContent = state.reasoningContent || msg.reasoning_content || ''
        for (const tc of this.normalizeExecutableToolCalls(msg.tool_calls || [])) {
            state.toolCallsMap.set(tc.id, tc)
        }
    }

    updateResponsesHostedToolItem(state, event, type, status) {
        const key = this.resolveResponsesOutputItemKey(state, event)
        if (!key) return
        const existing = state.outputItems.get(key) || {
            id: event.item_id || key,
            type,
            status
        }
        existing.type = existing.type || type
        existing.status = status || existing.status
        if (typeof event.delta === 'string') {
            existing.arguments = (existing.arguments || '') + event.delta
        }
        if (typeof event.arguments === 'string') existing.arguments = event.arguments
        if (event.type === 'response.mcp_call.failed') existing.status = 'failed'
        if (event.type === 'response.mcp_call.completed') existing.status = 'completed'
        if (event.type === 'response.mcp_list_tools.failed') existing.error = existing.error || 'mcp_list_tools failed'
        state.outputItems.set(key, existing)
        if (event.item_id) state.outputItemAliases.set(event.item_id, key)
        if (event.output_index !== undefined && event.output_index !== null)
            state.outputIndexKeys.set(event.output_index, key)
    }

    getResponsesPartText(part) {
        if (!part || typeof part !== 'object') return ''
        if (part.type === 'output_text' || part.type === 'text') return part.text || ''
        if (part.type === 'refusal') return part.refusal || ''
        if (part.type === 'reasoning_text' || part.type === 'summary_text') return part.text || ''
        return ''
    }

    applyResponsesContentPart(state, event) {
        const part = event.part
        if (!part || typeof part !== 'object') return []
        if (event.item_id) {
            const key = state.outputItemAliases.get(event.item_id) || event.item_id
            const existing = state.outputItems.get(key) || {
                id: event.item_id,
                type: 'message',
                role: 'assistant',
                content: []
            }
            existing.type = existing.type || 'message'
            existing.role = existing.role || 'assistant'
            existing.content = Array.isArray(existing.content) ? existing.content : []
            existing.content[event.content_index || 0] = part
            state.outputItems.set(key, existing)
            state.outputItemAliases.set(event.item_id, key)
            if (event.output_index !== undefined && event.output_index !== null)
                state.outputIndexKeys.set(event.output_index, key)
        }

        const text = this.getResponsesPartText(part)
        if (!text) return []
        if (part.type === 'reasoning_text' || part.type === 'summary_text') {
            if (!state.reasoningContent) {
                state.reasoningContent = text
                return [{ type: 'reasoning_delta', text }]
            }
            return []
        }
        if (!state.content) {
            state.content = text
            return [{ type: 'text', text }]
        }
        return []
    }

    applyResponsesTextAnnotation(state, event) {
        if (!event.item_id) return
        const existing = state.outputItems.get(this.resolveResponsesOutputItemKey(state, event))
        if (!existing || !Array.isArray(existing.content)) return
        const contentIndex = event.content_index || 0
        const part = existing.content[contentIndex]
        if (!part || typeof part !== 'object') return
        const annotations = Array.isArray(part.annotations) ? [...part.annotations] : []
        annotations[event.annotation_index || annotations.length] = event.annotation
        part.annotations = annotations.filter(item => item !== undefined)
    }

    responsesOutputToChatCompletion(response) {
        let content = ''
        let reasoningContent = ''
        const toolCalls = []

        for (const item of response.output || []) {
            if (item.type === 'message') {
                for (const part of item.content || []) {
                    if (part.type === 'output_text' || part.type === 'text') content += part.text || ''
                    if (part.type === 'reasoning_text' || part.type === 'summary_text')
                        reasoningContent += part.text || ''
                }
            } else if (RESPONSES_EXECUTABLE_ITEM_TYPES.has(item.type)) {
                toolCalls.push(this.normalizeResponsesToolCall(item))
            } else if (item.type === 'reasoning') {
                for (const part of item.summary || item.content || []) {
                    if (part.text) reasoningContent += part.text
                }
            } else {
                const itemText = this.responsesOutputItemToText(item)
                if (itemText) content += (content ? '\n' : '') + itemText
            }
        }

        if (!content && response.output_text) {
            content = response.output_text
        }

        const finishReasonMap = {
            completed: 'stop',
            failed: 'error',
            incomplete: 'length'
        }
        const finishReason =
            response.object === 'response.compaction' && !response.status
                ? 'stop'
                : finishReasonMap[response.status] || response.status

        return {
            id: response.id,
            model: response.model,
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: content || null,
                        reasoning_content: reasoningContent || null,
                        tool_calls: toolCalls.length ? toolCalls : undefined
                    },
                    finish_reason: finishReason
                }
            ],
            usage: attachUsageModel(response.usage || {}, response.model)
        }
    }

    createResponsesStreamState() {
        return {
            content: '',
            reasoningContent: '',
            toolCallsMap: new Map(),
            outputItems: new Map(),
            outputItemAliases: new Map(),
            outputIndexKeys: new Map(),
            toolCallAliases: new Map(),
            usage: null,
            status: null,
            responseId: null,
            responseModel: null
        }
    }

    applyResponsesStreamEvent(state, event) {
        if (!event?.type) return []
        const updates = []

        if (event.type === 'response.audio.transcript.delta') {
            const text = event.delta || ''
            state.content += text
            if (text) updates.push({ type: 'text', text })
        } else if (event.type === 'response.audio.transcript.done') {
            // Transcript text is accumulated from response.audio.transcript.delta.
        } else if (event.type === 'response.audio.delta' || event.type === 'response.audio.done') {
            // Audio bytes are not surfaced as chat text; transcript events carry readable content.
        } else if (event.type === 'response.output_text.delta' || event.type === 'response.text.delta') {
            const text = event.delta || ''
            state.content += text
            if (text) updates.push({ type: 'text', text })
        } else if (event.type === 'response.output_text.done' || event.type === 'response.text.done') {
            if (!state.content && event.text) {
                state.content = event.text
                updates.push({ type: 'text', text: event.text })
            }
        } else if (event.type === 'response.content_part.added' || event.type === 'response.content_part.done') {
            updates.push(...this.applyResponsesContentPart(state, event))
        } else if (event.type === 'response.refusal.delta') {
            const text = event.delta || ''
            state.content += text
            if (text) updates.push({ type: 'text', text })
        } else if (event.type === 'response.refusal.done') {
            if (!state.content && event.refusal) {
                state.content = event.refusal
                updates.push({ type: 'text', text: event.refusal })
            }
        } else if (event.type === 'response.reasoning_text.delta') {
            const text = event.delta || ''
            state.reasoningContent += text
            if (text) updates.push({ type: 'reasoning_delta', text })
        } else if (event.type === 'response.reasoning_text.done') {
            if (!state.reasoningContent && event.text) {
                state.reasoningContent = event.text
                updates.push({ type: 'reasoning_delta', text: event.text })
            }
        } else if (
            event.type === 'response.output_item.added' ||
            event.type === 'response.output_item.done' ||
            event.type === 'response.function_call_arguments.delta' ||
            event.type === 'response.function_call_arguments.done' ||
            event.type === 'response.custom_tool_call_input.delta' ||
            event.type === 'response.custom_tool_call_input.done'
        ) {
            if (event.item) this.upsertResponsesOutputItem(state, event.item, event)
            if (
                RESPONSES_EXECUTABLE_ITEM_TYPES.has(event.item?.type) ||
                event.type.startsWith('response.function_call_arguments.') ||
                event.type.startsWith('response.custom_tool_call_input.')
            ) {
                this.upsertResponsesToolCall(state, event)
                updates.push({ type: 'tool_calls_delta' })
            }
        } else if (event.type === 'response.created') {
            this.applyResponsesResponseMetadata(state, event.response, 'queued')
        } else if (event.type === 'response.queued') {
            this.applyResponsesResponseMetadata(state, event.response, 'queued')
        } else if (event.type === 'response.in_progress') {
            this.applyResponsesResponseMetadata(state, event.response, 'in_progress')
        } else if (event.type === 'response.reasoning_summary_text.delta') {
            const text = event.delta || ''
            state.reasoningContent += text
            if (text) updates.push({ type: 'reasoning_delta', text })
        } else if (event.type === 'response.reasoning_summary_text.done') {
            if (!state.reasoningContent && event.text) {
                state.reasoningContent = event.text
                updates.push({ type: 'reasoning_delta', text: event.text })
            }
        } else if (
            event.type === 'response.reasoning_summary_part.added' ||
            event.type === 'response.reasoning_summary_part.done'
        ) {
            const text = this.getResponsesPartText(event.part)
            if (text && !state.reasoningContent) {
                state.reasoningContent = text
                updates.push({ type: 'reasoning_delta', text })
            }
        } else if (event.type === 'response.output_text.annotation.added') {
            this.applyResponsesTextAnnotation(state, event)
        } else if (event.type === 'response.code_interpreter_call_code.delta') {
            this.updateResponsesHostedToolItem(state, event, 'code_interpreter_call', 'in_progress')
        } else if (event.type === 'response.code_interpreter_call_code.done') {
            this.updateResponsesHostedToolItem(state, event, 'code_interpreter_call', 'interpreting')
            const item = state.outputItems.get(this.resolveResponsesOutputItemKey(state, event))
            if (item && event.code) item.code = event.code
        } else if (event.type === 'response.code_interpreter_call.in_progress') {
            this.updateResponsesHostedToolItem(state, event, 'code_interpreter_call', 'in_progress')
        } else if (event.type === 'response.code_interpreter_call.interpreting') {
            this.updateResponsesHostedToolItem(state, event, 'code_interpreter_call', 'interpreting')
        } else if (event.type === 'response.code_interpreter_call.completed') {
            this.updateResponsesHostedToolItem(state, event, 'code_interpreter_call', 'completed')
        } else if (event.type === 'response.image_generation_call.in_progress') {
            this.updateResponsesHostedToolItem(state, event, 'image_generation_call', 'in_progress')
        } else if (event.type === 'response.image_generation_call.generating') {
            this.updateResponsesHostedToolItem(state, event, 'image_generation_call', 'generating')
        } else if (event.type === 'response.image_generation_call.completed') {
            this.updateResponsesHostedToolItem(state, event, 'image_generation_call', 'completed')
        } else if (event.type === 'response.image_generation_call.partial_image') {
            this.updateResponsesHostedToolItem(state, event, 'image_generation_call', 'generating')
        } else if (event.type === 'response.file_search_call.in_progress') {
            this.updateResponsesHostedToolItem(state, event, 'file_search_call', 'in_progress')
        } else if (event.type === 'response.file_search_call.searching') {
            this.updateResponsesHostedToolItem(state, event, 'file_search_call', 'searching')
        } else if (event.type === 'response.file_search_call.completed') {
            this.updateResponsesHostedToolItem(state, event, 'file_search_call', 'completed')
        } else if (event.type === 'response.web_search_call.in_progress') {
            this.updateResponsesHostedToolItem(state, event, 'web_search_call', 'in_progress')
        } else if (event.type === 'response.web_search_call.searching') {
            this.updateResponsesHostedToolItem(state, event, 'web_search_call', 'searching')
        } else if (event.type === 'response.web_search_call.completed') {
            this.updateResponsesHostedToolItem(state, event, 'web_search_call', 'completed')
        } else if (event.type === 'response.mcp_call_arguments.delta') {
            this.updateResponsesHostedToolItem(state, event, 'mcp_call', 'calling')
        } else if (event.type === 'response.mcp_call_arguments.done') {
            this.updateResponsesHostedToolItem(state, event, 'mcp_call', 'calling')
        } else if (event.type === 'response.mcp_call.in_progress') {
            this.updateResponsesHostedToolItem(state, event, 'mcp_call', 'in_progress')
        } else if (event.type === 'response.mcp_call.completed') {
            this.updateResponsesHostedToolItem(state, event, 'mcp_call', 'completed')
        } else if (event.type === 'response.mcp_call.failed') {
            this.updateResponsesHostedToolItem(state, event, 'mcp_call', 'failed')
        } else if (event.type === 'response.mcp_list_tools.in_progress') {
            this.updateResponsesHostedToolItem(state, event, 'mcp_list_tools', 'in_progress')
        } else if (event.type === 'response.mcp_list_tools.completed') {
            this.updateResponsesHostedToolItem(state, event, 'mcp_list_tools', 'completed')
        } else if (event.type === 'response.mcp_list_tools.failed') {
            this.updateResponsesHostedToolItem(state, event, 'mcp_list_tools', 'failed')
        } else if (event.type === 'response.completed' || event.type === 'response.done') {
            this.applyResponsesResponseMetadata(state, event.response, 'completed')
            this.applyResponsesOutputItemsToState(state)
            if (state.usage) updates.push({ type: 'usage', usage: attachUsageModel(state.usage, state.responseModel) })
        } else if (event.type === 'response.incomplete') {
            this.applyResponsesResponseMetadata(state, event.response, 'incomplete')
            this.applyResponsesOutputItemsToState(state)
            if (state.usage) updates.push({ type: 'usage', usage: attachUsageModel(state.usage, state.responseModel) })
        } else if (event.type === 'response.failed') {
            throw new Error(event.response?.error?.message || event.error?.message || 'OpenAI Responses API failed')
        } else if (event.type === 'response.error' || event.type === 'error') {
            throw new Error(event.error?.message || event.message || 'OpenAI Responses API stream error')
        }

        return updates
    }

    responsesStreamStateToChatCompletion(state) {
        return {
            id: state.responseId,
            model: state.responseModel,
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: state.content || null,
                        reasoning_content: state.reasoningContent || null,
                        tool_calls: state.toolCallsMap.size
                            ? this.normalizeExecutableToolCalls(Array.from(state.toolCallsMap.values()))
                            : undefined
                    },
                    finish_reason:
                        state.status === 'completed' ? 'stop' : state.status === 'incomplete' ? 'length' : state.status
                }
            ],
            usage: state.usage ? attachUsageModel(state.usage, state.responseModel) : {}
        }
    }

    async collectResponsesStream(stream) {
        const state = this.createResponsesStreamState()

        for await (const event of stream) {
            this.applyResponsesStreamEvent(state, event)
        }

        return this.responsesStreamStateToChatCompletion(state)
    }

    async createResponsesViaSdkWebSocket(client, responsesPayload, options = {}) {
        const wsConfig = resolveOpenAIWsOptions(options, this.options)
        const ResponsesWS = await this.resolveResponsesWSClass(wsConfig)
        if (!ResponsesWS) {
            throw new Error('openai/resources/responses/ws did not export ResponsesWS')
        }

        const timeoutMs = wsConfig.timeout || 60000
        const { enabled, timeout, url, headers, ResponsesWSClass, ...sdkWsOptions } = wsConfig
        const wsOptions = { ...sdkWsOptions }
        const wsHeaders = headers
        if (wsHeaders && typeof wsHeaders === 'object') {
            wsOptions.headers = wsHeaders
        }

        const sdkClient = this.createResponsesWSClient(client, url)
        const ws = new ResponsesWS(sdkClient, wsOptions)
        const responsePayload = { ...responsesPayload }
        delete responsePayload.stream
        const responseCreateEvent = { type: 'response.create', ...responsePayload }
        const state = this.createResponsesStreamState()
        const terminalEvents = new Set(['response.completed', 'response.done', 'response.incomplete'])
        let completed = false
        let timeoutHandle

        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                try {
                    ws.close({ code: 1000, reason: 'timeout' })
                } catch {}
                reject(new Error('OpenAI Responses websocket timeout'))
            }, timeoutMs)
        })

        try {
            const iterator = ws.stream()
            ws.send(responseCreateEvent)

            while (!completed) {
                const next = await Promise.race([iterator.next(), timeoutPromise])
                if (next.done) break

                const frame = next.value
                if (!frame) continue

                if (frame.type === 'message') {
                    this.applyResponsesStreamEvent(state, frame.message)
                    if (terminalEvents.has(frame.message?.type)) completed = true
                } else if (frame.type === 'error') {
                    throw frame.error || new Error('OpenAI Responses websocket error')
                } else if (frame.type === 'close') {
                    if (!completed) {
                        throw new Error(
                            `OpenAI Responses websocket closed before completion: ${frame.code} ${frame.reason || ''}`.trim()
                        )
                    }
                }
            }

            if (!completed && !state.status) {
                throw new Error('OpenAI Responses websocket closed before completion')
            }

            return this.responsesStreamStateToChatCompletion(state)
        } finally {
            clearTimeout(timeoutHandle)
            try {
                ws.close({ code: 1000, reason: 'OK' })
            } catch {}
        }
    }

    createResponsesWSClient(client, explicitWsUrl) {
        const responsePath = this.getOpenAIResponsePath()
        if (!explicitWsUrl && (!responsePath || responsePath === '/responses')) return client

        const sdkClient = Object.create(client)
        sdkClient.apiKey = client.apiKey
        sdkClient.buildURL = (path, query, defaultBaseURL) => {
            if (path === '/responses' && explicitWsUrl) {
                const baseUrl = `${this.baseUrl || 'https://api.openai.com/v1'}`.replace(/\/?$/, '/')
                const url = new URL(String(explicitWsUrl).trim(), baseUrl)
                if (query && typeof query === 'object') {
                    for (const [key, value] of Object.entries(query)) {
                        if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
                    }
                }
                return url.toString()
            }
            const mappedPath = path === '/responses' ? responsePath : path
            return client.buildURL(mappedPath, query, defaultBaseURL)
        }
        return sdkClient
    }

    async _sendMessage(histories, apiKey, options) {
        // 获取渠道代理配置
        const channelProxy = proxyService.getChannelProxyAgent(this.baseUrl)

        // 构建请求头 - 支持JSON模板和占位符
        const model = resolveModelName(options.model, DEFAULT_OPENAI_MODEL)
        const {
            enableReasoning,
            reasoningEffort,
            thinkingVendorControl,
            isThinkingModelFlag,
            supportsReasoningParams
        } = mergeOpenAIReasoningOptions(options, this.options)
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
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
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
                customHeaders['X-Forwarded-For'],
                templateContext
            )
        }
        if (customHeaders['Authorization']) {
            mergedHeaders['Authorization'] = requestTemplateService.replaceplaceholders(
                customHeaders['Authorization'],
                templateContext
            )
        }

        const clientOptions = this.buildOpenAIClientOptions(apiKey, mergedHeaders, channelProxy)
        const client = new OpenAI(clientOptions)

        const messages = []
        const systemPromptConfig = resolveSystemPromptConfig(options, this.options)

        /*
         * 图片预处理：根据渠道 imageConfig.transferMode 决定处理方式
         * - 'base64': 强制将所有图片URL转为base64
         * - 'url': 保持URL不转换
         * - 'auto'(默认): 按模型类型自动判断（Gemini需要base64）
         */
        const imageConfig = this.options?.imageConfig || {}
        const transferMode = imageConfig.transferMode || 'auto'
        const isGeminiModel = model.toLowerCase().includes('gemini')
        const shouldPreprocessToBase64 =
            transferMode === 'base64' || (transferMode === 'auto' && needsImageBase64Preprocess(model, imageConfig))

        if (shouldPreprocessToBase64) {
            logger.debug(`[OpenAI适配器] 图片转换模式: ${transferMode}, 执行base64预处理`)
            histories = await preprocessImageUrls(histories)
        } else {
            logger.debug(`[OpenAI适配器] 图片转换模式: ${transferMode}, 保持原始格式`)
        }
        // 是否可用推理模型专有参数（developer 角色、max_completion_tokens 等）：渠道显式声明优先
        const isThinkingModel =
            acceptsReasoningParams(supportsReasoningParams, model) && (enableReasoning || isThinkingModelFlag)

        if (options.systemOverride && (!systemPromptConfig || systemPromptConfig.target === 'messages')) {
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

        // 验证消息历史，移除孤立的 tool 消息（修复 400 错误）
        const validatedMessages = validateAndCleanMessages(messages)
        if (validatedMessages.length !== messages.length) {
            logger.debug(`[OpenAI适配器] 消息验证: ${messages.length} -> ${validatedMessages.length}`)
        }
        messages.length = 0
        messages.push(...validatedMessages)

        const useResponsesApi = this.shouldUseOpenAIResponses(options)
        const toolConvert = getFromChaiteToolConverter('openai')
        const convertedTools = this.tools.map(toolConvert).filter(Boolean)
        const openaiResponses = resolveOpenAIResponsesOptions(options, this.options)
        const choiceResolution = resolveToolChoice(
            useResponsesApi ? { ...options, openaiResponses } : options,
            convertedTools,
            useResponsesApi ? 'openai-responses' : 'openai-chat'
        )
        let tools = choiceResolution.disabled
            ? []
            : useResponsesApi
              ? mergeResponseTools(choiceResolution.tools, openaiResponses)
              : choiceResolution.tools
        let toolChoice = choiceResolution.toolChoice

        // Gemini API 要求 enum 值必须是字符串类型，清理所有工具定义
        if (isGeminiModel && tools.length > 0) {
            tools = tools.map(tool => sanitizeToolWithMetadata(tool))
        }
        options._exposedTools = tools

        // 根据 options.stream 决定是否使用流式
        const useStream = options.stream === true

        const requestPayload = {
            temperature: options.temperature,
            top_p: options.topP ?? options.top_p,
            messages,
            model,
            stream: useStream,
            stream_options: useStream ? { include_usage: true } : undefined,
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: tools.length > 0 || useResponsesApi ? toolChoice : undefined,
            instructions: options.instructions,
            metadata: options.metadata,
            parallel_tool_calls: options.parallelToolCalls ?? options.parallel_tool_calls,
            prompt_cache_key: options.promptCacheKey ?? options.prompt_cache_key,
            prompt_cache_retention: options.promptCacheRetention ?? options.prompt_cache_retention,
            service_tier: options.serviceTier ?? options.service_tier,
            text: options.text,
            truncation: options.truncation
        }

        if (systemPromptConfig?.target && systemPromptConfig.target !== 'messages') {
            applySystemPromptRouting({
                messages: requestPayload.messages,
                requestPayload,
                systemPromptConfig,
                systemPrompt: options.systemOverride,
                isThinkingModel
            })
        }

        if (isThinkingModel) {
            requestPayload.max_completion_tokens = options.maxToken
            // Only add reasoning_effort if explicitly set, as not all APIs support it
            if (reasoningEffort) {
                requestPayload.reasoning_effort = reasoningEffort
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

        /* 应用自定义请求体模板（支持占位符），合并/覆盖已构建的请求体字段 */
        const requestBodyTemplate = this.options?.requestBodyTemplate || options.requestBodyTemplate
        if (requestBodyTemplate) {
            const bodyOverrides = requestTemplateService.buildRequestBody(requestBodyTemplate, templateContext)
            if (bodyOverrides && typeof bodyOverrides === 'object') {
                Object.assign(requestPayload, bodyOverrides)
                logger.debug('[OpenAI适配器] 已应用自定义请求体模板:', Object.keys(bodyOverrides).join(', '))
            }
        }

        applyVendorThinkingPayload(requestPayload, enableReasoning, this.baseUrl, thinkingVendorControl)

        if (useResponsesApi) {
            requestPayload.stream = this.shouldUseExperimentalOpenAIWs(options) ? false : useStream
            delete requestPayload.stream_options
        }

        logger.debug(
            '[OpenAI适配器] 请求:',
            JSON.stringify({
                model: requestPayload.model,
                stream: requestPayload.stream,
                interface: useResponsesApi ? 'responses' : 'chat',
                messages: requestPayload.messages?.length,
                tools: requestPayload.tools?.length || 0
            })
        )
        if (requestPayload.tools?.length > 0) {
            const toolNames = requestPayload.tools.map(t => t.function?.name).filter(Boolean)
        }
        if (logger.level === 'debug') {
            const sanitizedMessages = this.sanitizeMessagesForLog(requestPayload.messages)
            logger.debug('[OpenAI适配器] 实际Messages内容:', JSON.stringify(sanitizedMessages, null, 2))
        }

        let chatCompletion
        try {
            let response
            if (useResponsesApi) {
                const responsesPayload = this.buildResponsesPayload(requestPayload, options)
                if (this.shouldUseExperimentalOpenAIWs(options)) {
                    try {
                        response = await this.createResponsesViaSdkWebSocket(client, responsesPayload, options)
                        chatCompletion = response
                    } catch (wsError) {
                        logger.warn(
                            `[OpenAI适配器] Responses WebSocket 调用失败，回退到 HTTP Responses API: ${wsError.message}`
                        )
                    }
                }
                if (!chatCompletion) {
                    response = await client.responses.create(responsesPayload)
                    chatCompletion = responsesPayload.stream
                        ? await this.collectResponsesStream(response)
                        : this.responsesOutputToChatCompletion(response)
                }
            } else {
                requestPayload.messages = normalizeChatCompletionMessages(requestPayload.messages)
                response = await client.chat.completions.create(requestPayload)
            }

            // 如果是流式响应，需要收集所有 chunk
            if (!useResponsesApi && useStream) {
                logger.debug(`[OpenAI适配器] 流式响应处理开始`)
                let allContent = ''
                let allReasoningContent = ''
                const toolCallsMap = new Map()
                let finishReason = null
                let usage = null
                let responseModel = null
                let chunkCount = 0

                for await (const chunk of response) {
                    chunkCount++
                    responseModel = chunk.model || responseModel
                    // 中转站可能插入不含 choices 的帧，须对 choices 本身使用可选链
                    const delta = chunk.choices?.[0]?.delta || {}
                    const content = delta.content || ''
                    const reasoningContent = delta.reasoning_content || ''

                    allContent += content
                    allReasoningContent += reasoningContent

                    // 处理工具调用
                    if (delta.tool_calls) {
                        logger.debug(`[OpenAI适配器] Stream chunk ${chunkCount}: 检测到tool_calls`)
                        for (const tc of delta.tool_calls) {
                            this.upsertChatToolCall(toolCallsMap, tc)
                        }
                    }

                    finishReason = chunk.choices?.[0]?.finish_reason || finishReason
                    if (chunk.usage) usage = chunk.usage

                    // 每50个chunk输出一次进度
                    if (chunkCount % 50 === 0) {
                        logger.debug(`[OpenAI适配器] Stream进度: ${chunkCount} chunks, ${allContent.length}字符`)
                    }
                }

                logger.debug(`[OpenAI适配器] Stream完成: ${chunkCount} chunks`)
                let finalContent = allContent || ''
                let extractedReasoning = allReasoningContent || ''
                if (finalContent) {
                    const endTagIdx = finalContent.toLowerCase().lastIndexOf('</think>')
                    if (endTagIdx !== -1) {
                        const beforeEnd = finalContent.substring(0, endTagIdx)
                        const startTagIdx = beforeEnd.toLowerCase().lastIndexOf('<think>')

                        if (startTagIdx !== -1) {
                            const thinkContent = finalContent.substring(startTagIdx + 7, endTagIdx).trim()
                            const beforeThink = finalContent.substring(0, startTagIdx).trim()
                            const afterThink = finalContent.substring(endTagIdx + 8).trim()

                            if (thinkContent) {
                                extractedReasoning = extractedReasoning
                                    ? extractedReasoning + '\n' + thinkContent
                                    : thinkContent
                            }
                            finalContent = (beforeThink + ' ' + afterThink).trim()
                            logger.debug(
                                `[OpenAI适配器] 剥离<think>(反向): 思考=${thinkContent.length}字符, 剩余=${finalContent.length}字符`
                            )
                        } else {
                            const thinkContent = beforeEnd.trim()
                            const afterThink = finalContent.substring(endTagIdx + 8).trim()

                            if (thinkContent) {
                                extractedReasoning = extractedReasoning
                                    ? extractedReasoning + '\n' + thinkContent
                                    : thinkContent
                            }
                            finalContent = afterThink
                            logger.debug(
                                `[OpenAI适配器] 剥离<think>(无开始): 思考=${thinkContent.length}字符, 剩余=${finalContent.length}字符`
                            )
                        }
                    } else {
                        const startTagIdx = finalContent.toLowerCase().indexOf('<think>')
                        if (startTagIdx !== -1) {
                            const beforeThink = finalContent.substring(0, startTagIdx).trim()
                            const thinkContent = finalContent.substring(startTagIdx + 7).trim()

                            if (thinkContent) {
                                extractedReasoning = extractedReasoning
                                    ? extractedReasoning + '\n' + thinkContent
                                    : thinkContent
                            }
                            finalContent = beforeThink
                            logger.debug(
                                `[OpenAI适配器] 剥离<think>(截断): 思考=${thinkContent.length}字符, 剩余=${finalContent.length}字符`
                            )
                        }
                    }
                }

                // 构建完整的响应对象
                const toolCalls = this.normalizeExecutableToolCalls(
                    Array.from(toolCallsMap.values()).filter(tc => tc.id && tc.function.name)
                )
                chatCompletion = {
                    choices: [
                        {
                            message: {
                                role: 'assistant',
                                content: finalContent || null,
                                reasoning_content: extractedReasoning || null,
                                tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                            },
                            finish_reason: finishReason
                        }
                    ],
                    usage: usage || {}
                }
                if (responseModel) {
                    chatCompletion.model = responseModel
                    chatCompletion.usage = attachUsageModel(chatCompletion.usage, responseModel)
                }

                logger.debug(
                    `[OpenAI适配器] Stream响应: finish=${finishReason}, tools=${toolCalls.length}, content=${finalContent.length}字符`
                )
            } else if (!useResponsesApi) {
                chatCompletion = response

                // 简化响应日志
                const firstChoice = chatCompletion.choices?.[0]
                const toolCallCount = firstChoice?.message?.tool_calls?.length || 0
                const hasContent = !!firstChoice?.message?.content
                logger.debug(
                    `[OpenAI适配器] 响应: finish=${firstChoice?.finish_reason}, tools=${toolCallCount}, hasContent=${hasContent}`
                )

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
            const errMsg =
                chatCompletion.error.message || chatCompletion.error.type || JSON.stringify(chatCompletion.error)
            logger.error('[OpenAI适配器] API返回错误:', errMsg)
            throw new Error(errMsg)
        }

        // Defensive check
        if (!chatCompletion || !chatCompletion.choices || !Array.isArray(chatCompletion.choices)) {
            logger.error('[OpenAI适配器] 响应格式错误，完整响应:', JSON.stringify(chatCompletion))

            // 分析可能的原因并提供更有用的错误信息
            const usage = chatCompletion?.usage
            if (usage) {
                const promptTokens = usage.prompt_tokens || usage.input_tokens || 0
                const completionTokens = usage.completion_tokens || usage.output_tokens || 0

                // 检测Token超限情况
                if (promptTokens > 100000 && completionTokens === 0) {
                    throw new Error(
                        `请求Token过大(${Math.round(promptTokens / 1000)}K)，超出模型上下文限制，请清理对话历史或减少工具数量`
                    )
                }
                if (promptTokens > 0 && completionTokens === 0) {
                    throw new Error(
                        `API未能生成回复(输入${Math.round(promptTokens / 1000)}K tokens)，可能是模型繁忙或Token超限`
                    )
                }
            }

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
            if (
                textItem.text &&
                (textItem.text.includes('<tools>') ||
                    textItem.text.includes('<tool_call>') ||
                    textItem.text.includes('```') ||
                    textItem.text.includes('"name"') ||
                    textItem.text.includes('"tool_calls"'))
            ) {
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
            toolCalls
        }

        const usage = attachUsageModel(chatCompletion.usage || {}, chatCompletion.model || model)

        return {
            ...result,
            model: chatCompletion.model || model,
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
        const channelProxy = proxyService.getChannelProxyAgent(this.baseUrl)
        const clientOptions = this.buildOpenAIClientOptions(
            apiKey,
            {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Accept: 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            },
            channelProxy,
            this.getOpenAIResponsePath()
        )
        const client = new OpenAI(clientOptions)

        const messages = []
        const systemPromptConfig = resolveSystemPromptConfig(options, this.options)
        const model = resolveModelName(options.model, DEFAULT_OPENAI_MODEL)
        const {
            enableReasoning,
            reasoningEffort,
            thinkingVendorControl,
            isThinkingModelFlag,
            supportsReasoningParams
        } = mergeOpenAIReasoningOptions(options, this.options)

        /*
         * 图片预处理：根据渠道 imageConfig.transferMode 决定处理方式
         * - 'base64': 强制将所有图片URL转为base64
         * - 'url': 保持URL不转换
         * - 'auto'(默认): 按模型类型自动判断（Gemini需要base64）
         */
        const streamImageConfig = this.options?.imageConfig || {}
        const streamTransferMode = streamImageConfig.transferMode || 'auto'
        const shouldPreprocessStream =
            streamTransferMode === 'base64' ||
            (streamTransferMode === 'auto' && needsImageBase64Preprocess(model, streamImageConfig))

        if (shouldPreprocessStream) {
            logger.debug(`[OpenAI适配器][Stream] 图片转换模式: ${streamTransferMode}, 执行base64预处理`)
            histories = await preprocessImageUrls(histories)
        } else {
            logger.debug(`[OpenAI适配器][Stream] 图片转换模式: ${streamTransferMode}, 保持原始格式`)
        }
        // 是否可用推理模型专有参数（developer 角色、max_completion_tokens 等）：渠道显式声明优先
        const isThinkingModel =
            acceptsReasoningParams(supportsReasoningParams, model) && (enableReasoning || isThinkingModelFlag)

        if (options.systemOverride && (!systemPromptConfig || systemPromptConfig.target === 'messages')) {
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

        // 验证消息历史，移除孤立的 tool 消息（修复 400 错误）
        const validatedMessages = validateAndCleanMessages(messages)
        if (validatedMessages.length !== messages.length) {
            logger.debug(`[OpenAI适配器] 消息验证: ${messages.length} -> ${validatedMessages.length}`)
        }
        messages.length = 0
        messages.push(...validatedMessages)

        const useResponsesApi = this.shouldUseOpenAIResponses(options)
        const toolConvert = getFromChaiteToolConverter('openai')
        const convertedTools = this.tools.map(toolConvert).filter(Boolean)
        const openaiResponses = resolveOpenAIResponsesOptions(options, this.options)
        const choiceResolution = resolveToolChoice(
            useResponsesApi ? { ...options, openaiResponses } : options,
            convertedTools,
            useResponsesApi ? 'openai-responses' : 'openai-chat'
        )
        const tools = choiceResolution.disabled
            ? []
            : useResponsesApi
              ? mergeResponseTools(choiceResolution.tools, openaiResponses)
              : choiceResolution.tools
        let toolChoice = choiceResolution.toolChoice
        options._exposedTools = tools

        const requestPayload = {
            temperature: options.temperature,
            top_p: options.topP ?? options.top_p,
            messages,
            model,
            tools: tools.length > 0 ? tools : undefined,
            tool_choice: tools.length > 0 || useResponsesApi ? toolChoice : undefined,
            stream: true,
            stream_options: { include_usage: true },
            instructions: options.instructions,
            metadata: options.metadata,
            parallel_tool_calls: options.parallelToolCalls ?? options.parallel_tool_calls,
            prompt_cache_key: options.promptCacheKey ?? options.prompt_cache_key,
            prompt_cache_retention: options.promptCacheRetention ?? options.prompt_cache_retention,
            service_tier: options.serviceTier ?? options.service_tier,
            text: options.text,
            truncation: options.truncation
        }

        if (systemPromptConfig?.target && systemPromptConfig.target !== 'messages') {
            applySystemPromptRouting({
                messages: requestPayload.messages,
                requestPayload,
                systemPromptConfig,
                systemPrompt: options.systemOverride,
                isThinkingModel
            })
        }

        if (isThinkingModel) {
            requestPayload.max_completion_tokens = options.maxToken
            // Only add reasoning_effort if explicitly set, as not all APIs support it
            if (reasoningEffort) {
                requestPayload.reasoning_effort = reasoningEffort
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

        const requestBodyTemplate = this.options?.requestBodyTemplate || options.requestBodyTemplate
        if (requestBodyTemplate) {
            const bodyOverrides = requestTemplateService.buildRequestBody(requestBodyTemplate, {
                apiKey,
                model,
                baseUrl: this.baseUrl,
                channelName: this.options?.channelName || '',
                userAgent: this.options?.userAgent,
                xff: this.options?.xff
            })
            if (bodyOverrides && typeof bodyOverrides === 'object') {
                Object.assign(requestPayload, bodyOverrides)
                logger.debug('[OpenAI适配器] 已应用流式请求体模板:', Object.keys(bodyOverrides).join(', '))
            }
        }

        applyVendorThinkingPayload(requestPayload, enableReasoning, this.baseUrl, thinkingVendorControl)

        logger.debug(
            '[OpenAI适配器] Streaming请求:',
            JSON.stringify({
                model: requestPayload.model,
                messages: requestPayload.messages?.length,
                tools: requestPayload.tools?.length || 0
            })
        )

        let stream
        try {
            if (useResponsesApi) {
                delete requestPayload.stream_options
                const responsesPayload = this.buildResponsesPayload(requestPayload, { ...options, stream: true })
                responsesPayload.stream = true
                stream = await client.responses.create(responsesPayload)
            } else {
                requestPayload.messages = normalizeChatCompletionMessages(requestPayload.messages)
                stream = await client.chat.completions.create(requestPayload)
            }
        } catch (error) {
            logger.error('[OpenAI适配器] Streaming API错误:', error.message)
            throw error
        }

        const self = this
        async function* generator() {
            let allReasoning = '' // 累积所有reasoning_content
            let allContent = '' // 累积content用于<think>标签解析
            let hasReasoningField = false // 是否检测到reasoning_content字段
            let checkedThinkTag = false // 是否已检查<think>标签
            let hasThinkTag = false // 是否有<think>标签

            // Tool calls 累积
            const toolCallsMap = new Map() // id -> {id, type, function: {name, arguments}}
            let hasToolCalls = false
            let finalUsage = null // 流式模式下的usage信息
            let streamResponseModel = null
            const responsesState = useResponsesApi ? self.createResponsesStreamState() : null
            let responsesTextEmitted = 0

            for await (const chunk of stream) {
                if (useResponsesApi) {
                    const updates = self.applyResponsesStreamEvent(responsesState, chunk)
                    for (const update of updates) {
                        if (update.type === 'text' && update.text) {
                            responsesTextEmitted += update.text.length
                            yield { type: 'text', text: update.text }
                        } else if (update.type === 'usage') {
                            finalUsage = attachUsageModel(update.usage, responsesState.responseModel)
                        }
                    }
                    continue
                }

                // 捕获usage信息（在最后一个chunk中）
                if (chunk.usage) {
                    finalUsage = attachUsageModel(chunk.usage, chunk.model || streamResponseModel)
                }
                streamResponseModel = chunk.model || streamResponseModel

                const delta = chunk.choices?.[0]?.delta || {}
                const content = delta.content || ''
                const reasoningContent = delta.reasoning_content || ''
                const toolCallsDelta = delta.tool_calls || []
                const finishReason = chunk.choices?.[0]?.finish_reason

                // 处理 tool_calls（流式累积）
                for (const tc of toolCallsDelta) {
                    hasToolCalls = true
                    self.upsertChatToolCall(toolCallsMap, tc)
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

            if (useResponsesApi) {
                const chatCompletion = self.responsesStreamStateToChatCompletion(responsesState)
                const responseMessage = chatCompletion.choices?.[0]?.message || {}
                if (responseMessage.content && responsesTextEmitted === 0) {
                    yield { type: 'text', text: responseMessage.content }
                }
                const responseToolCalls = responseMessage.tool_calls || []
                if (responseToolCalls.length > 0) {
                    logger.debug(
                        `[OpenAI适配器] Responses流式检测到 ${responseToolCalls.length} 个工具调用:`,
                        responseToolCalls
                            .map(t => t.function?.name)
                            .filter(Boolean)
                            .join(', ')
                    )
                    yield { type: 'tool_calls', toolCalls: responseToolCalls }
                }
                if (responseMessage.reasoning_content) {
                    yield { type: 'reasoning', text: responseMessage.reasoning_content }
                }
                if (chatCompletion.usage && Object.keys(chatCompletion.usage).length > 0) {
                    yield { type: 'usage', usage: attachUsageModel(chatCompletion.usage, chatCompletion.model) }
                }
                logger.debug(
                    `[OpenAI适配器] Responses Stream完成: content=${responsesState.content.length}字符, toolCalls=${responseToolCalls.length}, usage=${JSON.stringify(chatCompletion.usage)}`
                )
                return
            }

            // 输出 tool_calls
            if (hasToolCalls) {
                const toolCalls = self.normalizeExecutableToolCalls(
                    Array.from(toolCallsMap.values()).filter(tc => tc.id && tc.function.name)
                )
                if (toolCalls.length > 0) {
                    logger.debug(
                        `[OpenAI适配器] 流式检测到 ${toolCalls.length} 个工具调用:`,
                        toolCalls.map(t => t.function.name).join(', ')
                    )
                    yield { type: 'tool_calls', toolCalls }
                } else {
                    logger.warn('[OpenAI适配器] 流式响应包含不完整工具调用，已忽略')
                }
            }

            // 无论是否有 reasoning_content 字段，始终检测并剥离 <think> 标签
            if (hasReasoningField && allReasoning.trim()) {
                logger.debug('[OpenAI适配器] 输出reasoning_content，长度:', allReasoning.length)
                yield { type: 'reasoning', text: allReasoning.trim() }
            }

            // 检查 allContent 中是否有 <think> 标签需要剥离
            if (allContent) {
                logger.debug(
                    `[OpenAI适配器] 检查<think>标签, allContent长度: ${allContent.length}, 前100字符: ${allContent.substring(0, 100)}`
                )

                // 检查 <think> 标签（支持多种格式）
                // 使用更宽松的正则：匹配 <think>...</think>
                const fullThinkMatch = allContent.match(/<think>([\s\S]*?)<\/think>/i)

                // 备用：尝试匹配不完整的标签
                const partialThinkMatch = !fullThinkMatch && allContent.match(/<think>([\s\S]*)/i)

                logger.debug(
                    `[OpenAI适配器] fullThinkMatch: ${!!fullThinkMatch}, partialThinkMatch: ${!!partialThinkMatch}`
                )

                if (fullThinkMatch) {
                    const thinkContent = fullThinkMatch[1].trim()
                    // 移除整个 <think>...</think> 标签，获取剩余内容
                    const restContent = allContent.replace(/<think>[\s\S]*?<\/think>/i, '').trim()

                    logger.debug(
                        `[OpenAI适配器] 检测到完整<think>标签, 思考长度: ${thinkContent.length}, 剩余长度: ${restContent.length}`
                    )

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
                        const restContent = content.substring(endTagIndex + 8).trim() // 8 = '</think>'.length

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
                yield { type: 'usage', usage: attachUsageModel(finalUsage, streamResponseModel) }
            }

            // 日志：流式结束
            logger.debug(
                `[OpenAI适配器] Stream完成: content=${allContent.length}字符, toolCalls=${hasToolCalls}, usage=${JSON.stringify(finalUsage)}`
            )
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
                            return {
                                type: 'image_url',
                                image_url: { url: url.substring(0, 50) + '...[base64 truncated]' }
                            }
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
        const channelProxy = proxyService.getChannelProxyAgent(this.baseUrl)
        const clientOptions = this.buildOpenAIClientOptions(
            apiKey,
            {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            channelProxy
        )
        const client = new OpenAI(clientOptions)

        const embeddingStartTime = Date.now()
        const embeddings = await client.embeddings.create({
            input: text,
            dimensions: options.dimensions,
            model: options.model
        })

        // 记录Embedding统计
        try {
            const inputTexts = Array.isArray(text) ? text : [text]
            const inputTokens = inputTexts.reduce((sum, t) => sum + statsService.estimateTokens(t), 0)
            await statsService.recordApiCall({
                channelId: this.options?.channelId || 'embedding',
                channelName: this.options?.channelName || 'Embedding服务',
                model: options.model || 'text-embedding-3-small',
                inputTokens,
                outputTokens: 0,
                duration: Date.now() - embeddingStartTime,
                success: true,
                source: 'embedding',
                request: { inputCount: inputTexts.length, model: options.model }
            })
        } catch (e) {
            /* 统计失败不影响主流程 */
        }

        return {
            embeddings: embeddings.data.map(e => e.embedding)
        }
    }

    /**
     * List available models from the API
     * @returns {Promise<string[]>}
     */
    async listModels() {
        const apiKey = await import('../../utils/helpers.js').then(m => m.getKey(this.apiKey, this.multipleKeyStrategy))
        const channelProxy = proxyService.getChannelProxyAgent(this.baseUrl)
        const clientOptions = this.buildOpenAIClientOptions(
            apiKey,
            {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            channelProxy
        )
        const client = new OpenAI(clientOptions)

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
        const channelProxy = proxyService.getChannelProxyAgent(this.baseUrl)
        const clientOptions = this.buildOpenAIClientOptions(
            apiKey,
            {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            channelProxy
        )
        const client = new OpenAI(clientOptions)

        try {
            const model = await client.models.retrieve(modelId)
            return {
                id: model.id,
                object: model.object,
                created: model.created,
                owned_by: model.owned_by
            }
        } catch (error) {
            logger.error('[OpenAI适配器] 获取模型信息失败:', error.message)
            throw error
        }
    }
}
