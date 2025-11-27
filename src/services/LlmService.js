import config from '../../config/config.js'
import { OpenAIClient, GeminiClient, ClaudeClient } from '../core/adapters/index.js'
import { mcpManager } from '../mcp/McpManager.js'
import { convertMcpTools } from '../core/utils/toolAdapter.js'
import { presetManager } from './PresetManager.js'
import { keyManager } from './KeyManager.js'

/**
 * Service for managing LLM clients and configurations
 */
export class LlmService {
    /**
     * Create an LLM client based on configuration
     * @param {Object} options - Override options
     * @param {string} [options.adapterType] - Adapter type (default: 'openai')
     * @param {boolean} [options.enableTools=true] - Whether to enable MCP tools
     * @returns {Promise<OpenAIClient>} Configured client
     */
    static async createClient(options = {}) {
        const adapterType = options.adapterType || config.get('llm.defaultAdapter') || 'openai'
        const enableTools = options.enableTools !== false

        // Get thinking config
        const thinkingConfig = config.get('thinking') || {}
        const enableReasoning = options.enableReasoning ?? thinkingConfig.enableReasoning
        const reasoningEffort = options.reasoningEffort || thinkingConfig.defaultLevel || 'low'

        // Load configuration based on adapter type
        let apiKey, baseUrl, ClientClass

        // Get API Key using KeyManager (or override)
        apiKey = options.apiKey || keyManager.getNextKey(adapterType)

        if (adapterType === 'openai') {
            baseUrl = options.baseUrl || config.get('openai.baseUrl')
            ClientClass = OpenAIClient
        } else if (adapterType === 'gemini') {
            baseUrl = options.baseUrl || config.get('gemini.baseUrl')
            ClientClass = GeminiClient
        } else if (adapterType === 'claude') {
            baseUrl = options.baseUrl || config.get('claude.baseUrl')
            ClientClass = ClaudeClient
        } else {
            throw new Error(`Unsupported adapter type: ${adapterType}`)
        }

        if (!apiKey) {
            throw new Error(`${adapterType} API Key not configured`)
        }

        // Get tools if enabled
        let tools = []
        if (enableTools) {
            // Ensure McpManager is initialized (it handles its own init check)
            await mcpManager.init()
            const mcpTools = mcpManager.getTools()
            tools = convertMcpTools(mcpTools)
        }

        // Create client
        const client = new ClientClass({
            apiKey,
            baseUrl,
            features: ['chat'],
            tools,
            enableReasoning,
            reasoningEffort
        })

        return client
    }

    /**
     * Create a client for embeddings
     */
    static async getEmbeddingClient() {
        // Use OpenAI config for embeddings for now
        const apiKey = config.get('openai.apiKey')
        const baseUrl = config.get('openai.baseUrl')

        if (!apiKey) {
            throw new Error('OpenAI API Key not configured for embeddings')
        }

        return new OpenAIClient({
            apiKey,
            baseUrl,
            features: ['embedding']
        })
    }

    /**
     * Get default model configuration
     */
    static getDefaultModel() {
        return config.get('llm.defaultModel')
    }

    /**
     * Get model for specific mode
     * @param {string} mode - 'chat', 'code', 'translation', etc.
     */
    static getModel(mode = 'chat') {
        const modeModel = config.get(`llm.${mode}Model`)
        return modeModel || config.get('llm.defaultModel')
    }

    /**
     * Get system prompt for a preset
     * @param {string} [presetId] 
     */
    static getSystemPrompt(presetId) {
        const id = presetId || config.get('llm.defaultChatPresetId') || 'default'

        // Ensure PresetManager is initialized (it's async, but we need sync return here or change signature)
        // Ideally LlmService should be async or initialized.
        // For now, we assume PresetManager is initialized by WebServer or we force a check if possible.
        // But `get` is sync.

        const preset = presetManager.get(id)
        if (preset) {
            return preset.systemPrompt
        }

        return '你是一个有帮助的AI助手。'
    }
}
