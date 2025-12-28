import config from '../../../config/config.js'
import { OpenAIClient, GeminiClient, ClaudeClient } from '../../core/adapters/index.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { getAllTools, setToolContext } from '../../core/utils/toolAdapter.js'
import { presetManager } from '../preset/PresetManager.js'
import { channelManager } from './ChannelManager.js'

/**
 * LLM客户端和配置管理服务
 */
export class LlmService {
    /**
     * 根据配置创建LLM客户端
     * @param {Object} options - 覆盖选项
     * @param {string} [options.adapterType] - 适配器类型 (默认: 'openai')
     * @param {boolean} [options.enableTools=true] - 是否启用工具
     * @param {Object} [options.event] - Yunzai事件对象，用于工具上下文
     * @param {string} [options.presetId] - 预设id，用于工具配置
     * @returns {Promise<OpenAIClient>} 配置好的客户端
     */
    static async createClient(options = {}) {
        const enableTools = options.enableTools !== false

        // 使用传入的选项，不再读取全局thinking配置
        const enableReasoning = options.enableReasoning || false
        const reasoningEffort = options.reasoningEffort || 'low'

        // 从渠道管理器加载配置
        await channelManager.init()
        
        let apiKey, baseUrl, ClientClass, adapterType

        // 优先使用传入的选项
        if (options.apiKey && options.baseUrl) {
            apiKey = options.apiKey
            baseUrl = options.baseUrl
            adapterType = options.adapterType || 'openai'
        } else {
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

        // 如果提供了事件，设置工具上下文
        if (options.event) {
            setToolContext({ event: options.event, bot: options.event.bot || Bot })
        }

        // 如果启用工具，获取工具（包括内置工具）
        let tools = []
        if (enableTools) {
            // 优先使用预选的工具列表（来自工具组调度）
            if (options.preSelectedTools && options.preSelectedTools.length > 0) {
                // 将预选工具转换为客户端格式
                const { convertMcpTools } = await import('../../core/utils/toolAdapter.js')
                const requestContext = options.event ? { event: options.event, bot: options.event.bot || Bot } : null
                tools = convertMcpTools(options.preSelectedTools, requestContext)
                logger.debug(`[LlmService] 使用预选工具: ${tools.length} 个`)
            } else {
                // 如果可用，获取预设工具配置
                let toolsConfig = null
                if (options.presetId) {
                    await presetManager.init()
                    toolsConfig = presetManager.getToolsConfig(options.presetId)
                }
                
                // 获取所有工具 (MCP + 内置)
                tools = await getAllTools({
                    toolsConfig,
                    event: options.event,
                    presetId: options.presetId,
                    userPermission: options.event?.sender?.role || 'member'
                })
            }
        }

        // 创建客户端
        const clientConfig = {
            apiKey,
            baseUrl,
            features: ['chat'],
            tools,
            enableReasoning,
            reasoningEffort
        }
        
        // 传递自定义请求头（支持 XFF/Auth/UA 等复写）
        if (options.customHeaders && Object.keys(options.customHeaders).length > 0) {
            clientConfig.customHeaders = options.customHeaders
        }
        
        // 传递JSON模板配置（支持占位符）
        if (options.headersTemplate) {
            clientConfig.headersTemplate = options.headersTemplate
        }
        if (options.requestBodyTemplate) {
            clientConfig.requestBodyTemplate = options.requestBodyTemplate
        }
        if (options.channelName) {
            clientConfig.channelName = options.channelName
        }
        
        const client = new ClientClass(clientConfig)

        return client
    }

    /**
     * 创建嵌入向量客户端 (使用配置的 embedding 模型渠道)
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
        
        const keyInfo = channelManager.getChannelKey(channel)
        logger.debug(`[LlmService] getChatClient 选择渠道: ${channel.name}, 模型: ${targetModel}, 适配器: ${adapterType}`)
        
        const client = new ClientClass({
            apiKey: keyInfo.key,
            baseUrl: channel.baseUrl,
            features: ['chat'],
            tools: [] // 无工具
        })
        client._channelInfo = {
            id: channel.id,
            name: channel.name,
            model: targetModel
        }
        
        return client
    }

    /**
     * 模型类型枚举
     * 
     * 模型使用场景分离原则：
     * - 对话模型(chat)：普通聊天，不带工具
     * - 工具模型(tool)：执行工具调用
     * - 调度模型(dispatch)：分析需要哪些工具组（轻量快速）
     * - 图像模型(image)：图像理解和生成
     * - 伪人模型(roleplay)：模拟真人回复
     * - 搜索模型(search)：联网搜索
     * 
     * 默认模型(default)在对应模型未配置时使用
     */
    static ModelType = {
        DEFAULT: 'default',     // 默认模型 - 未配置时的回退
        CHAT: 'chat',           // 对话模型 - 普通聊天（无工具）
        TOOL: 'tool',           // 工具模型 - 执行工具调用
        DISPATCH: 'dispatch',   // 调度模型 - 分析意图、控制流程、生成提示词
        IMAGE: 'image',         // 图像理解模型 - 仅负责理解/分析图片
        DRAW: 'draw',           // 绘图模型 - 负责生成图片
        ROLEPLAY: 'roleplay',   // 伪人模型 - 模拟真人回复
        SEARCH: 'search'        // 搜索模型 - 联网搜索
    }

    /**
     * Get model for specific mode
     * @param {string} mode - 'chat', 'roleplay', 'toolCall', 'search', 'reasoning', 'code', 'translation', etc.
     * @param {boolean} [fallbackToDefault=true] - 是否回退到默认模型
     * @returns {string} 模型名称
     */
    static getModel(mode = 'chat', fallbackToDefault = true) {
        // 先检查新的 models 配置
        const newModelConfig = config.get(`llm.models.${mode}`)
        if (newModelConfig && (!Array.isArray(newModelConfig) || newModelConfig.length > 0)) {
            // 如果是数组且非空，取第一个有效模型
            if (Array.isArray(newModelConfig)) {
                const firstModel = newModelConfig.find(m => m && typeof m === 'string' && m.trim())
                if (firstModel) {
                    logger.debug(`[LlmService] getModel(${mode}): 使用 models.${mode} 配置: ${firstModel.trim()}`)
                    return firstModel.trim()
                }
            } 
            // 如果是字符串且非空，直接返回
            else if (typeof newModelConfig === 'string' && newModelConfig.trim()) {
                logger.debug(`[LlmService] getModel(${mode}): 使用 models.${mode} 配置: ${newModelConfig.trim()}`)
                return newModelConfig.trim()
            }
        }
        
        // 兼容旧配置
        const modeModel = config.get(`llm.${mode}Model`)
        if (modeModel) {
            if (Array.isArray(modeModel) && modeModel.length > 0) {
                const first = modeModel.find(m => m && typeof m === 'string' && m.trim())
                if (first) {
                    logger.debug(`[LlmService] getModel(${mode}): 使用旧配置 ${mode}Model: ${first.trim()}`)
                    return first.trim()
                }
            } else if (typeof modeModel === 'string' && modeModel.trim()) {
                logger.debug(`[LlmService] getModel(${mode}): 使用旧配置 ${mode}Model: ${modeModel.trim()}`)
                return modeModel.trim()
            }
        }
        if (fallbackToDefault) {
            const defaultModel = this.getDefaultModel()
            if (defaultModel) {
                logger.debug(`[LlmService] getModel(${mode}): 回退到默认模型: ${defaultModel}`)
                return defaultModel
            }
            logger.warn(`[LlmService] getModel(${mode}): 未找到任何可用模型`)
        }
        return ''
    }
    
    /**
     * 获取默认模型
     * @returns {string} 默认模型名称
     */
    static getDefaultModel() {
        const defaultModel = config.get('llm.defaultModel')
        if (typeof defaultModel === 'string' && defaultModel.trim()) {
            return defaultModel.trim()
        }
        return ''
    }

    /**
     * 获取对话模型（无工具）
     */
    static getChatModel() {
        return this.getModel(this.ModelType.CHAT)
    }

    /**
     * 获取工具模型（执行工具调用）
     */
    static getToolModel() {
        return this.getModel(this.ModelType.TOOL)
    }

    /**
     * 获取调度模型（选择工具组，轻量快速）
     * 未配置时回退到默认模型
     */
    static getDispatchModel() {
        return this.getModel(this.ModelType.DISPATCH)  // 回退到默认
    }

    /**
     * 获取图像理解模型（仅负责理解/分析图片）
     */
    static getImageModel() {
        return this.getModel(this.ModelType.IMAGE)
    }

    /**
     * 获取绘图模型（负责生成图片）
     */
    static getDrawModel() {
        return this.getModel(this.ModelType.DRAW)
    }

    /**
     * 获取伪人模型
     */
    static getRoleplayModel() {
        return this.getModel(this.ModelType.ROLEPLAY)
    }

    /**
     * 获取搜索模型
     */
    static getSearchModel() {
        return this.getModel(this.ModelType.SEARCH)
    }

    /**
     * @param {Object} options
     * @param {boolean} options.needsTools - 是否需要工具调用
     * @param {boolean} options.isDispatch - 是否是调度阶段
     * @param {boolean} options.hasImages - 是否包含图像
     * @param {boolean} options.needsDraw - 是否需要生成图片
     * @param {boolean} options.isRoleplay - 是否是伪人模式
     * @param {boolean} options.needsSearch - 是否需要搜索
     * @returns {string} 模型名称
     */
    static selectModel(options = {}) {
        const { needsTools, isDispatch, hasImages, needsDraw, isRoleplay, needsSearch } = options
        if (isDispatch) {
            const model = this.getDispatchModel()
            if (model) {
                logger.debug(`[LlmService] selectModel: 使用调度模型 ${model}`)
                return model
            }
            // 调度模型未配置，返回空表示跳过调度
            logger.debug(`[LlmService] selectModel: 调度模型未配置，跳过调度阶段`)
            return ''
        }
        
        // 2. 绘图需求 - 使用绘图模型（优先级高于工具）
        if (needsDraw) {
            const model = this.getDrawModel()
            if (model) {
                logger.debug(`[LlmService] selectModel: 使用绘图模型 ${model}`)
                return model
            }
        }
        
        // 3. 工具调用 - 使用工具模型
        if (needsTools) {
            const model = this.getToolModel()
            if (model) {
                logger.debug(`[LlmService] selectModel: 使用工具模型 ${model}`)
                return model
            }
        }
        
        // 4. 图像处理 - 使用图像模型
        if (hasImages) {
            const model = this.getImageModel()
            if (model) {
                logger.debug(`[LlmService] selectModel: 使用图像模型 ${model}`)
                return model
            }
        }
        
        // 5. 伪人模式 - 使用伪人模型
        if (isRoleplay) {
            const model = this.getRoleplayModel()
            if (model) {
                logger.debug(`[LlmService] selectModel: 使用伪人模型 ${model}`)
                return model
            }
        }
        
        // 6. 搜索需求 - 使用搜索模型
        if (needsSearch) {
            const model = this.getSearchModel()
            if (model) {
                logger.debug(`[LlmService] selectModel: 使用搜索模型 ${model}`)
                return model
            }
        }
        
        // 7. 普通对话 - 使用对话模型
        const chatModel = this.getChatModel()
        if (chatModel) {
            logger.debug(`[LlmService] selectModel: 使用对话模型 ${chatModel}`)
            return chatModel
        }
        
        // 8. 回退到默认模型
        const defaultModel = this.getDefaultModel()
        logger.debug(`[LlmService] selectModel: 回退到默认模型 ${defaultModel}`)
        return defaultModel
    }

    /**
     * 获取模型配置信息（用于调试和日志）
     * @returns {Object} 模型配置
     */
    static getModelConfig() {
        return {
            default: this.getDefaultModel(),
            chat: this.getModel(this.ModelType.CHAT, false) || '(使用默认)',
            tool: this.getModel(this.ModelType.TOOL, false) || '(使用默认)',
            dispatch: this.getModel(this.ModelType.DISPATCH, false) || '(使用默认)',
            image: this.getModel(this.ModelType.IMAGE, false) || '(使用默认)',
            draw: this.getModel(this.ModelType.DRAW, false) || '(使用默认)',
            roleplay: this.getModel(this.ModelType.ROLEPLAY, false) || '(使用默认)',
            search: this.getModel(this.ModelType.SEARCH, false) || '(使用默认)'
        }
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
