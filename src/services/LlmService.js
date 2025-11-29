import config from '../../config/config.js'
import { OpenAIClient, GeminiClient, ClaudeClient } from '../core/adapters/index.js'
import { mcpManager } from '../mcp/McpManager.js'
import { getAllTools, setToolContext } from '../core/utils/toolAdapter.js'
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
     * @param {boolean} [options.enableTools=true] - Whether to enable tools
     * @param {Object} [options.event] - Yunzai event for tool context
     * @param {string} [options.presetId] - Preset ID for tools config
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

        // Set tool context if event is provided
        if (options.event) {
            setToolContext({ event: options.event, bot: options.event.bot || Bot })
        }

        // Get tools if enabled (including builtin tools)
        let tools = []
        if (enableTools) {
            // Get preset tools config if available
            let toolsConfig = null
            if (options.presetId) {
                await presetManager.init()
                toolsConfig = presetManager.getToolsConfig(options.presetId)
            }
            
            // Get all tools (MCP + builtin)
            tools = await getAllTools({
                toolsConfig,
                event: options.event
            })
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
     * 模型类型枚举
     */
    static ModelType = {
        CHAT: 'chat',           // 对话模型 - 普通聊天
        ROLEPLAY: 'roleplay',   // 伪人模型 - 模拟真人回复
        TOOL_CALL: 'toolCall',  // 工具调用模型 - function calling
        SEARCH: 'search',       // 搜索模型 - 联网搜索
        REASONING: 'reasoning'  // 思考模型 - 深度推理
    }

    /**
     * Get model for specific mode
     * @param {string} mode - 'chat', 'roleplay', 'toolCall', 'search', 'reasoning', 'code', 'translation', etc.
     */
    static getModel(mode = 'chat') {
        // 先检查新的 models 配置
        const newModelConfig = config.get(`llm.models.${mode}`)
        if (newModelConfig) {
            return newModelConfig
        }
        
        // 兼容旧配置
        const modeModel = config.get(`llm.${mode}Model`)
        return modeModel || config.get('llm.defaultModel')
    }

    /**
     * 获取对话模型
     */
    static getChatModel() {
        return this.getModel(this.ModelType.CHAT)
    }

    /**
     * 获取伪人模型
     */
    static getRoleplayModel() {
        return this.getModel(this.ModelType.ROLEPLAY)
    }

    /**
     * 获取工具调用模型
     */
    static getToolCallModel() {
        return this.getModel(this.ModelType.TOOL_CALL)
    }

    /**
     * 获取搜索模型
     */
    static getSearchModel() {
        return this.getModel(this.ModelType.SEARCH)
    }

    /**
     * 获取思考/推理模型
     */
    static getReasoningModel() {
        return this.getModel(this.ModelType.REASONING)
    }

    /**
     * 根据场景自动选择最佳模型
     * @param {Object} options
     * @param {boolean} options.needsTools - 是否需要工具调用
     * @param {boolean} options.needsReasoning - 是否需要深度推理
     * @param {boolean} options.isRoleplay - 是否是伪人模式
     * @param {boolean} options.needsSearch - 是否需要搜索
     */
    static selectModel(options = {}) {
        if (options.isRoleplay) {
            const model = this.getRoleplayModel()
            if (model) return model
        }
        
        if (options.needsReasoning) {
            const model = this.getReasoningModel()
            if (model) return model
        }
        
        if (options.needsTools) {
            const model = this.getToolCallModel()
            if (model) return model
        }
        
        if (options.needsSearch) {
            const model = this.getSearchModel()
            if (model) return model
        }
        
        return this.getChatModel() || this.getDefaultModel()
    }

    /**
     * Get system prompt for a preset (basic version)
     * @param {string} [presetId] 
     */
    static getSystemPrompt(presetId) {
        const id = presetId || config.get('llm.defaultChatPresetId') || 'default'

        const preset = presetManager.get(id)
        if (preset) {
            return preset.systemPrompt
        }

        return '你是一个有帮助的AI助手。'
    }

    /**
     * Get full system prompt with persona (async version)
     * @param {string} [presetId]
     * @returns {Promise<string>}
     */
    static async getFullSystemPrompt(presetId) {
        await presetManager.init()
        const id = presetId || config.get('llm.defaultChatPresetId') || 'default'
        return presetManager.buildSystemPrompt(id)
    }

    /**
     * Get preset configuration
     * @param {string} [presetId]
     * @returns {Promise<Object|null>}
     */
    static async getPreset(presetId) {
        await presetManager.init()
        const id = presetId || config.get('llm.defaultChatPresetId') || 'default'
        return presetManager.get(id)
    }
}
