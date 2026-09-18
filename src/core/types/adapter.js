/**
 * @typedef {import('./models').HistoryMessage} HistoryMessage
 * @typedef {import('./common').ChaiteContext} ChaiteContext
 */

/**
 * @typedef {Object} SendMessageOption
 * @property {string} [model]
 * @property {number} [temperature]
 * @property {number} [maxToken]
 * @property {string} [systemOverride]
 * @property {Object} [systemPromptConfig]
 * @property {boolean} [disableHistoryRead]
 * @property {boolean} [disableHistorySave]
 * @property {string} [conversationId]
 * @property {string} [parentMessageId]
 * @property {boolean} [stream]
 * @property {boolean} [isThinkingModel]
 * @property {boolean} [enableReasoning]
 * @property {'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto'} [reasoningEffort]
 * @property {'auto' | 'off' | 'glm'} [thinkingVendorControl] - BigModel/智谱等需在 body 中传 thinking.type 时的策略
 * @property {number} [reasoningBudgetTokens]
 * @property {ToolChoice} [toolChoice]
 * @property {any} [tool_choice]
 * @property {any} [responsesToolChoice]
 * @property {any} [responseToolChoice]
 * @property {Object} [openaiResponses]
 * @property {'ask' | 'auto' | 'confirm_all' | 'yolo'} [toolApprovalMode]
 * @property {string[]} [postProcessorIds]
 * @property {string[]} [preProcessorIds]
 * @property {string[]} [toolGroupId]
 * @property {string[]} [responseModalities]
 * @property {any[]} [safetySettings]
 * @property {ToolCallLimitConfig} [toolCallLimit]
 * @property {number} [_consecutiveIdenticalToolCallCount]
 * @property {string} [_lastToolCallSignature]
 * @property {(chunk: import('./models').ModelResponseChunk) => Promise<void>} [onChunk]
 * @property {(message: import('./models').MessageContent) => Promise<void>} [onMessageWithToolCall]
 */

/**
 * @typedef {Object} ToolChoice
 * @property {'none' | 'any' | 'auto' | 'specified' | 'allowed' | 'allowed_tools' | 'required' | 'function' | 'custom' | 'mcp' | 'tool'} type
 * @property {(string | Object)[]} [tools]
 * @property {{mode?: 'auto' | 'required', tools?: (string | Object)[]}} [allowed_tools]
 * @property {'auto' | 'required'} [mode]
 */

/**
 * @typedef {Object} ToolCallLimitConfig
 * @property {number} [maxConsecutiveCalls]
 * @property {number} [maxConsecutiveIdenticalCalls] - 连续完全一致（工具名+参数相同）调用达到该次数后判定重复循环并挂起工具
 * @property {number} [maxTotalToolCalls] - 保留字段：目前不参与任何轮次/总次数上限判定（仅重复循环拦截生效）
 */

/**
 * @typedef {Object} EmbeddingOption
 * @property {string} model
 * @property {number} [dimensions]
 */

/**
 * @typedef {'openai' | 'gemini' | 'claude'} ClientType
 */

/**
 * @typedef {Object} HistoryManager
 * @property {string} name
 * @property {(message: HistoryMessage, conversationId: string) => Promise<void>} saveHistory
 * @property {(messageId?: string, conversationId?: string) => Promise<HistoryMessage[]>} getHistory
 * @property {(conversationId: string) => Promise<void>} deleteConversation
 * @property {(messageId: string, conversationId: string) => Promise<HistoryMessage | undefined>} getOneHistory
 */

export class SendMessageOption {
    /**
     * @param {Partial<SendMessageOption>} [option]
     */
    constructor(option = {}) {
        Object.assign(this, option)
    }

    /**
     * @param {SendMessageOption | Partial<SendMessageOption>} [options]
     * @returns {SendMessageOption}
     */
    static create(options) {
        return options instanceof SendMessageOption ? options : new SendMessageOption(options)
    }

    toString() {
        const json = {
            model: this.model,
            temperature: this.temperature,
            maxToken: this.maxToken,
            systemOverride: this.systemOverride,
            disableHistoryRead: this.disableHistoryRead,
            disableHistorySave: this.disableHistorySave,
            conversationId: this.conversationId,
            parentMessageId: this.parentMessageId,
            stream: this.stream,
            isThinkingModel: this.isThinkingModel,
            enableReasoning: this.enableReasoning,
            reasoningEffort: this.reasoningEffort,
            thinkingVendorControl: this.thinkingVendorControl,
            reasoningBudgetTokens: this.reasoningBudgetTokens,
            toolChoice: this.toolChoice,
            preProcessorIds: this.preProcessorIds,
            postProcessorIds: this.postProcessorIds,
            toolGroupId: this.toolGroupId,
            responseModalities: this.responseModalities,
            safetySettings: this.safetySettings,
            toolCallLimit: this.toolCallLimit
        }
        return JSON.stringify(json)
    }

    /**
     * @param {string} str
     * @returns {SendMessageOption}
     */
    fromString(str) {
        return new SendMessageOption(JSON.parse(str))
    }
}

export {}
