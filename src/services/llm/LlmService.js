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

        let apiKey, baseUrl, ClientClass, adapterType, chatPath, modelsPath

        // 优先使用传入的选项
        if (options.apiKey && options.baseUrl) {
            apiKey = options.apiKey
            baseUrl = options.baseUrl
            adapterType = options.adapterType || 'openai'
            chatPath = options.chatPath || ''
            modelsPath = options.modelsPath || ''
        } else {
            const model = options.model || config.get('llm.defaultModel')
            const channel =
                channelManager.getBestChannel(model) || channelManager.getAll().find(c => c.enabled && c.apiKey)

            if (!channel) {
                throw new Error('未找到可用的 API 渠道配置，请先配置渠道')
            }

            apiKey = channelManager.getChannelKey(channel)
            baseUrl = channel.baseUrl
            adapterType = channel.adapterType || 'openai'
            chatPath = channel.chatPath || ''
            modelsPath = channel.modelsPath || ''
            // 自动选择渠道时，从渠道获取 imageConfig（调用方未显式传入的场景）
            if (!options.imageConfig && channel.imageConfig) {
                options.imageConfig = channel.imageConfig
            }
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
                const firstTool = options.preSelectedTools[0]
                if (firstTool?.function?.name) {
                    // 已是 Chaite 格式（来自 getExecutableSkills 或 convertMcpTools），直接使用
                    tools = options.preSelectedTools
                } else {
                    // 原始 MCP 格式 {name, description, inputSchema}，需要转换
                    const { convertMcpTools } = await import('../../core/utils/toolAdapter.js')
                    const requestContext = options.event
                        ? { event: options.event, bot: options.event.bot || Bot }
                        : null
                    tools = convertMcpTools(options.preSelectedTools, requestContext)
                }
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
            chatPath, // 自定义对话路径
            modelsPath, // 自定义模型列表路径
            features: ['chat'],
            tools,
            enableReasoning,
            reasoningEffort
        }

        // 传递图片处理配置
        if (options.imageConfig) {
            clientConfig.imageConfig = options.imageConfig
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
        const ClientClass =
            adapterType === 'gemini' ? GeminiClient : adapterType === 'claude' ? ClaudeClient : OpenAIClient

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
     * @param {string} [options.groupId] - 群组ID，传入时优先使用群独立渠道
     * @param {boolean} [options.enableTools] - 是否启用工具（默认false）
     * @returns {Promise<OpenAIClient|GeminiClient|ClaudeClient>}
     */
    static async getChatClient(options = {}) {
        const { channelManager } = await import('./ChannelManager.js')
        await channelManager.init()

        const targetModel = options.model || config.get('llm.defaultModel')
        let channel = null

        /* ====== 群独立渠道优先 ====== */
        if (options.groupId) {
            try {
                const { ensureScopeManager } = await import('../../core/utils/scopeInit.js')
                const sm = await ensureScopeManager()
                const groupCfg = await sm.getGroupChannelConfig(String(options.groupId))

                /* 多独立渠道 */
                const indChannels = (groupCfg?.independentChannels || []).filter(
                    ch => ch.enabled !== false && ch.baseUrl && ch.apiKey
                )
                if (indChannels.length > 0) {
                    const modelsList = ch =>
                        (ch.models || '')
                            .split(',')
                            .map(m => m.trim())
                            .filter(Boolean)
                    let matched = indChannels
                        .filter(ch => {
                            const m = modelsList(ch)
                            return m.length === 0 || m.includes(targetModel) || m.includes('*')
                        })
                        .sort((a, b) => (a.priority || 100) - (b.priority || 100))
                    if (matched.length === 0)
                        matched = indChannels.sort((a, b) => (a.priority || 100) - (b.priority || 100))
                    const best = matched[0]
                    channel = {
                        id: best.id,
                        name: best.name || `群${options.groupId}独立渠道`,
                        adapterType: best.adapterType || 'openai',
                        baseUrl: best.baseUrl,
                        apiKey: best.apiKey,
                        enabled: true,
                        models: modelsList(best),
                        chatPath: best.chatPath,
                        imageConfig: best.imageConfig || {},
                        advanced: {}
                    }
                    logger.debug(`[LlmService] getChatClient 使用群${options.groupId}独立渠道: ${channel.name}`)
                }

                /* 遗留单渠道 */
                if (!channel && groupCfg?.baseUrl && groupCfg?.apiKey) {
                    channel = {
                        id: `group-${options.groupId}-independent`,
                        name: `群${options.groupId}独立渠道`,
                        adapterType: groupCfg.adapterType || 'openai',
                        baseUrl: groupCfg.baseUrl,
                        apiKey: groupCfg.apiKey,
                        enabled: true,
                        models: groupCfg.modelId ? [groupCfg.modelId] : [],
                        imageConfig: {},
                        advanced: {}
                    }
                    logger.debug(`[LlmService] getChatClient 使用群${options.groupId}遗留独立渠道`)
                }
            } catch (e) {
                logger.warn(`[LlmService] 获取群${options.groupId}独立渠道失败: ${e.message}`)
            }
        }

        /* ====== 回退到全局渠道 ====== */
        if (!channel) {
            const channels = channelManager.getAll()
            channel = channels.find(c => c.enabled && c.models?.includes(targetModel))
            if (!channel) {
                channel = channels.find(c => c.enabled && c.apiKey)
            }
        }

        if (!channel) {
            throw new Error('未找到可用的 API 渠道配置')
        }

        const adapterType = channel.adapterType || 'openai'
        const ClientClass =
            adapterType === 'gemini' ? GeminiClient : adapterType === 'claude' ? ClaudeClient : OpenAIClient

        const keyInfo = channelManager.getChannelKey(channel)
        logger.debug(
            `[LlmService] getChatClient 选择渠道: ${channel.name}, 模型: ${targetModel}, 适配器: ${adapterType}`
        )

        const clientOptions = {
            apiKey: keyInfo.key,
            baseUrl: channel.baseUrl,
            features: ['chat'],
            tools: [],
            imageConfig: channel.imageConfig || {}
        }
        if (channel.chatPath) clientOptions.chatPath = channel.chatPath

        const client = new ClientClass(clientOptions)
        client._channelInfo = {
            id: channel.id,
            name: channel.name,
            model: targetModel,
            maxCharacters: channel.advanced?.llm?.maxCharacters || 0
        }

        return client
    }

    /**
     * 获取对话模型（统一入口）
     * 对话模型同时处理上下文和工具调用
     * @returns {string} 模型名称
     */
    static getModel() {
        // 优先使用 defaultModel 配置
        const defaultModel = config.get('llm.defaultModel')
        if (typeof defaultModel === 'string' && defaultModel.trim()) {
            return defaultModel.trim()
        }

        // 兼容旧配置 chatModel
        const chatModel = config.get('llm.chatModel')
        if (chatModel) {
            if (Array.isArray(chatModel) && chatModel.length > 0) {
                const first = chatModel.find(m => m && typeof m === 'string' && m.trim())
                if (first) return first.trim()
            } else if (typeof chatModel === 'string' && chatModel.trim()) {
                return chatModel.trim()
            }
        }

        logger.warn('[LlmService] 未配置任何模型')
        return ''
    }

    /**
     * 获取默认模型（getModel 的别名）
     * @returns {string} 模型名称
     */
    static getDefaultModel() {
        return this.getModel()
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
