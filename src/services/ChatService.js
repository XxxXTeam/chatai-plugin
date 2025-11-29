import { LlmService } from './LlmService.js'
import { imageService } from './ImageService.js'
import { contextManager } from './ContextManager.js'
import { channelManager } from './ChannelManager.js'
import historyManager from '../core/utils/history.js'
import config from '../../config/config.js'
import { setToolContext } from '../core/utils/toolAdapter.js'
import { presetManager } from './PresetManager.js'

/**
 * Chat Service - Unified chat message handling
 */
export class ChatService {
    /**
     * Send a chat message with optional images
     * @param {Object} options
     * @param {string} options.userId - User ID
     * @param {string} options.message - Text message
     * @param {Array} [options.images] - Array of image IDs or URLs
     * @param {string} [options.model] - Model to use
     * @param {boolean} [options.stream] - Enable streaming
     * @param {Object} [options.preset] - Preset configuration
     * @returns {Promise<Object>} - Response
     */
    async sendMessage(options) {
        const {
            userId,
            message,
            images = [],
            model,
            stream = false,
            preset,
            presetId,
            adapterType,
            event  // Yunzai event for tool context
        } = options

        if (!userId || !message) {
            throw new Error('userId and message are required')
        }

        // Initialize context manager
        await contextManager.init()

        // Get conversation ID for user
        const conversationId = contextManager.getConversationId(userId)

        // Build message content
        const messageContent = []

        // Add text content
        messageContent.push({
            type: 'text',
            text: message
        })

        // Process images
        for (const imageRef of images) {
            try {
                let base64Image

                // If it's an image ID
                if (imageRef.length === 32 && !/[:/]/.test(imageRef)) {
                    base64Image = await imageService.getImageBase64(imageRef, 'jpeg')
                }
                // If it's a URL
                else if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
                    base64Image = await imageService.urlToBase64(imageRef)
                }
                // If it's already base64
                else if (imageRef.startsWith('data:')) {
                    base64Image = imageRef
                }

                if (base64Image) {
                    messageContent.push({
                        type: 'image_url',
                        image_url: { url: base64Image }
                    })
                }
            } catch (error) {
                logger.error('[ChatService] Failed to process image:', error)
                // Continue without this image
            }
        }

        // Create user message
        const userMessage = {
            role: 'user',
            content: messageContent
        }

        // Get context and history
        const context = await contextManager.getContext(conversationId)
        const history = await historyManager.getHistory(undefined, conversationId) // Get all history for this conversation

        // Determine model
        const llmModel = model || LlmService.getModel(options.mode || 'chat')

        // Set tool context if event is provided
        if (event) {
            setToolContext({ event, bot: event.bot || Bot })
        }

        // Get best channel
        const channel = channelManager.getBestChannel(llmModel)

        // Get preset ID
        const effectivePresetId = presetId || preset?.id || config.get('llm.defaultChatPresetId') || 'default'

        // Create LLM client with tool context
        const clientOptions = {
            enableTools: true,
            enableReasoning: preset?.enableReasoning,
            adapterType: adapterType,
            event,
            presetId: effectivePresetId
        }

        if (channel) {
            clientOptions.adapterType = channel.adapterType
            clientOptions.baseUrl = channel.baseUrl
            clientOptions.apiKey = channelManager.getChannelKey(channel)
            channelManager.startRequest(channel.id)
        }

        const client = await LlmService.createClient(clientOptions)

        // Get full system prompt with persona and variables
        await presetManager.init()
        
        // 构建变量上下文
        const promptContext = {}
        if (event) {
            promptContext.user_name = event.sender?.card || event.sender?.nickname || '用户'
            promptContext.user_id = event.user_id?.toString() || userId
            promptContext.group_name = event.group_name || ''
            promptContext.group_id = event.group_id?.toString() || ''
            promptContext.bot_name = event.bot?.nickname || 'AI助手'
        }
        
        const systemPrompt = preset?.systemPrompt || presetManager.buildSystemPrompt(effectivePresetId, promptContext)

        // Build messages array
        const messages = [
            { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
            ...history,
            userMessage
        ]

        let response
        try {
            // Send to LLM
            response = await client.sendMessage(userMessage, {
                model: llmModel,
                maxToken: config.get('llm.maxTokens') || 4000,
                temperature: config.get('llm.temperature') || 0.7,
                conversationId,
                history: messages.slice(0, -1) // All messages except the current one
            })
        } finally {
            if (channel) {
                channelManager.endRequest(channel.id)
                // Report usage if available (approximate)
                if (response && response.usage) {
                    channelManager.reportUsage(channel.id, response.usage.totalTokens)
                }
            }
        }

        // Note: History is already saved by AbstractClient, no need to save again here
        // The AbstractClient saves both user message and assistant response automatically

        // Update context with key information
        if (response.contents) {
            const textContent = response.contents
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n')

            if (textContent.length > 50) {
                await contextManager.updateContext(conversationId, {
                    lastInteraction: Date.now(),
                    recentTopics: [message.substring(0, 100)]
                })
            }
        }

        return {
            conversationId,
            response: response.contents,
            usage: response.usage,
            model: llmModel
        }
    }



    /**
    * Stream chat message
    * @param {Object} options
    * @returns {AsyncGenerator<string>}
    */
    async *streamMessage(options) {
        const {
            userId,
            message,
            images = [],
            model,
            preset,
            adapterType // Add adapter type support
        } = options

        if (!userId || !message) {
            throw new Error('userId and message are required')
        }

        await contextManager.init()
        const conversationId = contextManager.getConversationId(userId)

        // Build message content (same as sendMessage)
        const messageContent = []
        messageContent.push({ type: 'text', text: message })

        for (const imageRef of images) {
            try {
                let base64Image
                if (imageRef.length === 32 && !/[:/]/.test(imageRef)) {
                    base64Image = await imageService.getImageBase64(imageRef, 'jpeg')
                } else if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
                    base64Image = await imageService.urlToBase64(imageRef)
                } else if (imageRef.startsWith('data:')) {
                    base64Image = imageRef
                }

                if (base64Image) {
                    messageContent.push({
                        type: 'image_url',
                        image_url: { url: base64Image }
                    })
                }
            } catch (error) {
                logger.error('[ChatService] Failed to process image:', error)
            }
        }

        const userMessage = { role: 'user', content: messageContent }
        const context = await contextManager.getContext(conversationId)
        const history = await historyManager.getHistory(conversationId, 10) // Last 10 messages

        // Determine model
        const llmModel = model || LlmService.getModel(options.mode || 'chat')

        // Get best channel
        const channel = channelManager.getBestChannel(llmModel)

        const clientOptions = {
            enableTools: true,
            enableReasoning: preset?.enableReasoning,
            adapterType: adapterType // Default/Fallback
        }

        if (channel) {
            clientOptions.adapterType = channel.adapterType
            clientOptions.baseUrl = channel.baseUrl
            clientOptions.apiKey = channelManager.getChannelKey(channel)
            channelManager.startRequest(channel.id)
        }

        const client = await LlmService.createClient(clientOptions)

        const systemPrompt = preset?.systemPrompt || LlmService.getSystemPrompt()
        const messages = [
            { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
            ...history,
            userMessage
        ]

        // Save user message first
        await historyManager.saveHistory(userMessage, conversationId)

        let stream
        try {
            // Call stream
            stream = await client.streamMessage(messages.slice(0, -1), {
                model: llmModel,
                maxToken: config.get('llm.maxTokens') || 4000,
                temperature: config.get('llm.temperature') || 0.7,
                conversationId
            })
        } catch (error) {
            if (channel) channelManager.endRequest(channel.id)
            throw error
        }

        let fullResponse = ''

        try {
            for await (const chunk of stream) {
                fullResponse += chunk
                yield chunk
            }
        } finally {
            if (channel) {
                channelManager.endRequest(channel.id)
                // Streaming usage is harder to track without full response object, 
                // but we can estimate or just track count.
                // channelManager.reportUsage(channel.id, ...)
            }
        }

        // Save assistant message
        const assistantMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: fullResponse }]
        }
        await historyManager.saveHistory(assistantMessage, conversationId)

        // Update context
        if (fullResponse.length > 50) {
            await contextManager.updateContext(conversationId, {
                lastInteraction: Date.now(),
                recentTopics: [message.substring(0, 100)]
            })
        }
    }
    async getHistory(userId, limit = 20) {
        await contextManager.init()
        const conversationId = contextManager.getConversationId(userId)
        return await historyManager.getHistory(conversationId, limit)
    }

    /**
     * Clear chat history for a user
     * @param {string} userId
     * @returns {Promise<void>}
     */
    async clearHistory(userId) {
        await contextManager.init()
        const conversationId = contextManager.getConversationId(userId)
        await historyManager.deleteConversation(conversationId)
        await contextManager.cleanContext(conversationId)
    }

    /**
     * Export conversation history
     * @param {string} userId
     * @param {string} format - 'json' or 'text'
     * @returns {Promise<string>}
     */
    async exportHistory(userId, format = 'json') {
        const history = await this.getHistory(userId, 1000)

        if (format === 'json') {
            return JSON.stringify(history, null, 2)
        } else {
            // Text format
            return history.map(msg => {
                const role = msg.role === 'user' ? '👤 用户' : '🤖 助手'
                const content = Array.isArray(msg.content)
                    ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                    : msg.content
                return `${role}:\n${content}\n`
            }).join('\n---\n\n')
        }
    }
}

// Export singleton
export const chatService = new ChatService()
