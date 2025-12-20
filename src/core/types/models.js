/**
 * @typedef {import('./models').MessageContent} MessageContent
 * @typedef {'text' | 'image' | 'audio' | 'video' | 'tool' | 'reasoning'} MessageContentType
 * @typedef {'system' | 'user' | 'assistant' | 'tool' | 'developer'} Role
 * @typedef {'chat' | 'visual' | 'tool' | 'embedding'} Feature
 */

/**
 * @typedef {Object} TextContent
 * @property {'text'} type
 * @property {string} text
 */

/**
 * @typedef {Object} ReasoningContent
 * @property {'reasoning'} type
 * @property {string} text
 */

/**
 * @typedef {Object} ImageContent
 * @property {'image'} type
 * @property {string} image
 * @property {string} [mimeType]
 */

/**
 * @typedef {Object} AudioContent
 * @property {'audio'} type
 * @property {string} data
 * @property {'mp3' | 'wav'} format
 */

/**
 * @typedef {Object} History
 * @property {string} id
 * @property {string | null} parentId
 */

/**
 * @typedef {Object} IMessage
 * @property {Role} role
 * @property {MessageContent[]} content
 * @property {ToolCall[]} [toolCalls]
 */

/**
 * @typedef {Object} ToolCall
 * @property {string} id
 * @property {'function'} type
 * @property {FunctionCall} function
 */

/**
 * @typedef {Object} FunctionCall
 * @property {string} name
 * @property {Record<string, any>} arguments
 */

/**
 * @typedef {IMessage & {role: 'user', content: Array<TextContent | ImageContent | AudioContent>}} UserMessage
 */

/**
 * @typedef {IMessage & {role: 'system', content: TextContent[]}} SystemMessage
 */

/**
 * @typedef {IMessage & {role: 'developer', content: TextContent[]}} DeveloperMessage
 */

/**
 * @typedef {IMessage & {role: 'assistant', content: MessageContent[], toolCalls?: ToolCall[]}} AssistantMessage
 */

/**
 * @typedef {Object} ToolCallResult
 * @property {'tool'} type
 * @property {string} [tool_call_id]
 * @property {string} content
 * @property {string} [name]
 */

/**
 * @typedef {IMessage & {role: 'tool', content: ToolCallResult[]}} ToolCallResultMessage
 */

/**
 * @typedef {History & IMessage} HistoryMessage
 */

/**
 * @typedef {Object} ModelResponse
 * @property {string} [id]
 * @property {string} [model]
 * @property {MessageContent[]} contents
 * @property {ModelUsage} [usage]
 */

/**
 * @typedef {Object} ModelUsage
 * @property {number} [promptTokens]
 * @property {number} [completionTokens]
 * @property {number} [totalTokens]
 * @property {number} [cachedTokens]
 * @property {number} [reasoningTokens]
 */

/**
 * @typedef {Object} ModelResponseChunk
 * @property {string} [id]
 * @property {string} [model]
 * @property {MessageContent[]} delta
 * @property {ToolCall[]} [toolCall]
 */

/**
 * @typedef {Object} EmbeddingResult
 * @property {number[][]} embeddings
 */

export { }
