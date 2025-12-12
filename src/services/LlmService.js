import config from '../../config/config.js'
import { OpenAIClient, GeminiClient, ClaudeClient } from '../core/adapters/index.js'
import { mcpManager } from '../mcp/McpManager.js'
import { getAllTools, setToolContext } from '../core/utils/toolAdapter.js'
import { presetManager } from './PresetManager.js'
import { channelManager } from './ChannelManager.js'

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
        const enableTools = options.enableTools !== false

        // 使用传入的选项，不再读取全局thinking配置
        const enableReasoning = options.enableReasoning || false
        const reasoningEffort = options.reasoningEffort || 'low'

        // Load configuration from channelManager
        await channelManager.init()
        
        let apiKey, baseUrl, ClientClass, adapterType

        // 优先使用传入的选项
        if (options.apiKey && options.baseUrl) {
            apiKey = options.apiKey
            baseUrl = options.baseUrl
            adapterType = options.adapterType || 'openai'
        } else {
            // 从渠道管理器获取可用渠道
            const model = options.model || config.get('llm.defaultModel')
            const channel = channelManager.getBestChannel(model) ||
                            channelManager.getAll().find(c => c.enabled && c.apiKey)
            
            if (!channel) {
                throw new Error('未找到可用的 API 渠道配置，请先配置渠道')
            }
            
            apiKey = channelManager.getChannelKey(channel)
            baseUrl = channel.baseUrl
            adapterType = channel.adapterType || 'openai'
        }

        // 根据适配器类型选择客户端类
        if (adapterType === 'openai') {
            ClientClass = OpenAIClient
        } else if (adapterType === 'gemini') {
            ClientClass = GeminiClient
        } else if (adapterType === 'claude') {
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
     * Create a client for embeddings (使用配置的 embedding 模型渠道)
     */
    static async getEmbeddingClient() {
        // 从 channelManager 获取可用的 API 配置
        const { channelManager } = await import('./ChannelManager.js')
        await channelManager.init() // 确保已初始化
        
        const embeddingModel = config.get('llm.embeddingModel')
        const defaultModel = config.get('llm.defaultModel')
        
        // 优先查找包含 embedding 模型的渠道，然后是默认模型
        const channels = channelManager.getAll()
        let channel = channels.find(c => c.enabled && c.models?.includes(embeddingModel))
        
        if (!channel) {
            channel = channels.find(c => c.enabled && c.models?.includes(defaultModel))
        }
        
        // 回退：使用第一个可用的启用渠道
        if (!channel) {
            channel = channels.find(c => c.enabled && c.apiKey)
        }
        
        if (!channel) {
            throw new Error('未找到可用的 API 渠道配置，请先配置渠道')
        }
        
        // 根据渠道适配器类型返回正确的客户端
        const adapterType = channel.adapterType || 'openai'
        const ClientClass = adapterType === 'gemini' ? GeminiClient :
                           adapterType === 'claude' ? ClaudeClient : OpenAIClient
        
        return new ClientClass({
            apiKey: channel.apiKey,
            baseUrl: channel.baseUrl,
            features: ['embedding']
        })
    }

    /**
     * Create a simple chat client (无工具，用于内部任务如记忆提取、伪人模式等)
     * @param {Object} options - 可选配置
     * @param {string} [options.model] - 指定模型，用于选择对应的渠道
     * @param {boolean} [options.enableTools] - 是否启用工具（默认false）
     * @returns {Promise<OpenAIClient|GeminiClient|ClaudeClient>}
     */
    static async getChatClient(options = {}) {
        const { channelManager } = await import('./ChannelManager.js')
        await channelManager.init()
        
        // 优先使用传入的 model 参数，否则使用默认模型
        const targetModel = options.model || config.get('llm.defaultModel')
        const channels = channelManager.getAll()
        
        // 优先查找支持指定模型的渠道
        let channel = channels.find(c => c.enabled && c.models?.includes(targetModel))
        
        // 回退：查找任何可用的启用渠道
        if (!channel) {
            channel = channels.find(c => c.enabled && c.apiKey)
        }
        
        if (!channel) {
            throw new Error('未找到可用的 API 渠道配置')
        }
        
        const adapterType = channel.adapterType || 'openai'
        const ClientClass = adapterType === 'gemini' ? GeminiClient :
                           adapterType === 'claude' ? ClaudeClient : OpenAIClient
        
        logger.debug(`[LlmService] getChatClient 选择渠道: ${channel.name}, 模型: ${targetModel}, 适配器: ${adapterType}`)
        
        return new ClientClass({
            apiKey: channelManager.getChannelKey(channel),
            baseUrl: channel.baseUrl,
            features: ['chat'],
            tools: [] // 无工具
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
     * @returns {string} 模型名称
     */
    static getModel(mode = 'chat') {
        // 先检查新的 models 配置
        const newModelConfig = config.get(`llm.models.${mode}`)
        if (newModelConfig) {
            // 如果是数组，取第一个有效模型；如果是字符串，直接返回
            if (Array.isArray(newModelConfig)) {
                const firstModel = newModelConfig.find(m => m && typeof m === 'string')
                if (firstModel) return firstModel
            } else if (typeof newModelConfig === 'string' && newModelConfig) {
                return newModelConfig
            }
        }
        
        // 兼容旧配置
        const modeModel = config.get(`llm.${mode}Model`)
        if (modeModel) {
            if (Array.isArray(modeModel)) {
                const first = modeModel.find(m => m && typeof m === 'string')
                if (first) return first
            } else if (typeof modeModel === 'string') {
                return modeModel
            }
        }
        
        // 返回默认模型
        const defaultModel = config.get('llm.defaultModel')
        return typeof defaultModel === 'string' ? defaultModel : ''
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
