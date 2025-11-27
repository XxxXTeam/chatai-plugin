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
 * @property {boolean} [disableHistoryRead]
 * @property {boolean} [disableHistorySave]
 * @property {string} [conversationId]
 * @property {string} [parentMessageId]
 * @property {boolean} [stream]
 * @property {boolean} [isThinkingModel]
 * @property {boolean} [enableReasoning]
 * @property {'high' | 'medium' | 'low' | 'minimal'} [reasoningEffort]
 * @property {number} [reasoningBudgetTokens]
 * @property {ToolChoice} [toolChoice]
 * @property {string[]} [postProcessorIds]
 * @property {string[]} [preProcessorIds]
 * @property {string[]} [toolGroupId]
 * @property {string[]} [responseModalities]
 * @property {any[]} [safetySettings]
 * @property {ToolCallLimitConfig} [toolCallLimit]
 * @property {number} [_consecutiveToolCallCount]
 * @property {number} [_consecutiveIdenticalToolCallCount]
 * @property {string} [_lastToolCallSignature]
 * @property {(chunk: import('./models').ModelResponseChunk) => Promise<void>} [onChunk]
 * @property {(message: import('./models').MessageContent) => Promise<void>} [onMessageWithToolCall]
 */

/**
 * @typedef {Object} ToolChoice
 * @property {'none' | 'any' | 'auto' | 'specified'} type
 * @property {string[]} [tools]
 */

/**
 * @typedef {Object} ToolCallLimitConfig
 * @property {number} [maxConsecutiveCalls]
 * @property {number} [maxConsecutiveIdenticalCalls]
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
            reasoningBudgetTokens: this.reasoningBudgetTokens,
            toolChoice: this.toolChoice,
            preProcessorIds: this.preProcessorIds,
            postProcessorIds: this.postProcessorIds,
            toolGroupId: this.toolGroupId,
            responseModalities: this.responseModalities,
            safetySettings: this.safetySettings,
            toolCallLimit: this.toolCallLimit,
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

export { }
