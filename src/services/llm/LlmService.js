import config from '../../../config/config.js'
import { OpenAIClient, GeminiClient, ClaudeClient } from '../../core/adapters/index.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { getAllTools, setToolContext } from '../../core/utils/toolAdapter.js'
import { presetManager } from '../preset/PresetManager.js'
import { channelManager } from './ChannelManager.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { databaseService } from '../storage/DatabaseService.js'
import { resolveThinkingOptions } from './ThinkingOptions.js'
import { normalizeSystemPromptConfig } from './SystemPromptConfig.js'
import { resolveToolPermission } from '../tools/ToolPermission.js'

let _scopeManager = null
const ensureScopeManager = async () => {
    if (!_scopeManager) {
        if (!databaseService.initialized) {
            await databaseService.init()
        }
        _scopeManager = getScopeManager(databaseService)
        await _scopeManager.init()
    }
    return _scopeManager
}

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
        const enableTools = options.enableTools !== false && options.toolApprovalMode !== 'ask'

        let preset = null
        if (options.presetId || options.preset) {
            await presetManager.init()
            preset = options.preset || presetManager.get(options.presetId)
        }

        let thinkingOptions = resolveThinkingOptions({ requestOptions: options, preset })

        // 从渠道管理器加载配置
        await channelManager.init()

        let apiKey,
            baseUrl,
            ClientClass,
            adapterType,
            chatPath,
            modelsPath,
            responsePath,
            endpoints,
            apiInterface,
            experimental,
            openaiResponses

        // 优先使用传入的选项
        if (options.apiKey && options.baseUrl) {
            apiKey = options.apiKey
            baseUrl = options.baseUrl
            adapterType = options.adapterType || 'openai'
            chatPath = options.chatPath || ''
            modelsPath = options.modelsPath || ''
            responsePath = options.responsePath || ''
            endpoints = options.endpoints || {}
            apiInterface = options.apiInterface || options.openaiApiInterface || 'chat'
            experimental = options.experimental || {}
            openaiResponses = options.openaiResponses || {}
        } else {
            const model = options.model || config.get('llm.defaultModel')
            const channel =
                channelManager.getBestChannel(model) ||
                channelManager.getAll().find(c => c.enabled !== false && c.apiKey)

            if (!channel) {
                throw new Error('未找到可用的 API 渠道配置，请先配置渠道')
            }

            const keyInfo = channelManager.getChannelKey(channel)
            apiKey = keyInfo.key
            // 使用getCurrentBaseUrl确保获取最优的baseUrl
            baseUrl = channelManager.getCurrentBaseUrl(channel.id) || channel.baseUrl
            adapterType = channel.adapterType || 'openai'
            chatPath = channel.chatPath || '' // 兼容旧格式
            modelsPath = channel.modelsPath || '' // 兼容旧格式
            endpoints = channel.endpoints || {} // 自定义端点配置
            responsePath = channel.responsePath || endpoints.responses || ''
            apiInterface = channel.apiInterface || channel.openaiApiInterface || 'chat'
            experimental = channel.experimental || {}
            openaiResponses = channel.openaiResponses || {}
            // 自动选择渠道时，从渠道获取 imageConfig（调用方未显式传入的场景）
            if (!options.imageConfig && channel.imageConfig) {
                options.imageConfig = channel.imageConfig
            }
            thinkingOptions = resolveThinkingOptions({ requestOptions: options, channel })
        }

        /*
         * 根据适配器类型选择客户端类
         * 未识别的类型（如 deepseek / groq 等 OpenAI 兼容提供商）自动回退到 OpenAI 适配器
         */
        if (adapterType === 'gemini') {
            ClientClass = GeminiClient
        } else if (adapterType === 'claude') {
            ClientClass = ClaudeClient
        } else {
            ClientClass = OpenAIClient
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
                    toolsConfig = presetManager.getToolsConfig(options.presetId)
                }

                // 获取所有工具 (MCP + 内置)
                tools = await getAllTools({
                    toolsConfig,
                    event: options.event,
                    presetId: options.presetId,
                    userPermission: resolveToolPermission(options),
                    groupId: options.groupId,
                    userId: options.userId
                })
            }
        }

        // 创建客户端
        const clientConfig = {
            apiKey,
            baseUrl,
            chatPath, // 自定义对话路径（兼容旧格式）
            modelsPath, // 自定义模型列表路径（兼容旧格式）
            responsePath, // Responses API 路径（兼容自定义 /responses）
            endpoints: endpoints || {}, // 自定义端点配置 { chat, models, responses, embeddings, images }
            apiInterface,
            openaiApiInterface: apiInterface,
            experimental,
            openaiResponses,
            features: ['chat'],
            tools,
            enableReasoning: thinkingOptions.enableReasoning,
            reasoningEffort: thinkingOptions.reasoningEffort,
            thinkingVendorControl: thinkingOptions.thinkingVendorControl,
            ...(thinkingOptions.reasoningBudgetTokens !== undefined
                ? { reasoningBudgetTokens: thinkingOptions.reasoningBudgetTokens }
                : {})
        }
        if (options.toolChoice !== undefined && options.toolChoice !== null) {
            clientConfig.toolChoice = options.toolChoice
        }

        if (options.apiInterface || options.openaiApiInterface) {
            clientConfig.apiInterface = options.apiInterface || options.openaiApiInterface
            clientConfig.openaiApiInterface = clientConfig.apiInterface
        }
        if (options.responsePath) {
            clientConfig.responsePath = options.responsePath
        }
        if (options.endpoints) {
            clientConfig.endpoints = { ...clientConfig.endpoints, ...options.endpoints }
        }
        if (options.experimental) {
            clientConfig.experimental = options.experimental
        }
        if (options.openaiResponses) {
            clientConfig.openaiResponses = options.openaiResponses
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
        if (options.systemPromptConfig) {
            clientConfig.systemPromptConfig = normalizeSystemPromptConfig(options.systemPromptConfig)
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
        let channel = channels.find(c => c.enabled !== false && c.models?.includes(embeddingModel))

        if (!channel) {
            channel = channels.find(c => c.enabled !== false && c.models?.includes(defaultModel))
        }

        // 回退：使用第一个可用的启用渠道
        if (!channel) {
            channel = channels.find(c => c.enabled !== false && c.apiKey)
        }

        if (!channel) {
            throw new Error('未找到可用的 API 渠道配置，请先配置渠道')
        }

        // 根据渠道适配器类型返回正确的客户端
        const adapterType = channel.adapterType || 'openai'
        const ClientClass =
            adapterType === 'gemini' ? GeminiClient : adapterType === 'claude' ? ClaudeClient : OpenAIClient

        const keyInfo = channelManager.getChannelKey(channel)

        return new ClientClass({
            apiKey: keyInfo.key,
            baseUrl: channelManager.getCurrentBaseUrl(channel.id) || channel.baseUrl,
            chatPath: channel.chatPath || '',
            modelsPath: channel.modelsPath || '',
            responsePath: channel.responsePath || channel.endpoints?.responses || '',
            endpoints: channel.endpoints || {},
            apiInterface: channel.apiInterface || channel.openaiApiInterface || 'chat',
            openaiApiInterface: channel.apiInterface || channel.openaiApiInterface || 'chat',
            openaiResponses: channel.openaiResponses || {},
            customHeaders: channel.customHeaders || {},
            headersTemplate: channel.headersTemplate || '',
            requestBodyTemplate: channel.requestBodyTemplate || '',
            systemPromptConfig: normalizeSystemPromptConfig(channel.systemPromptConfig, channel.overrides),
            imageConfig: channel.imageConfig || {},
            channelId: channel.id,
            channelName: channel.name,
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

        let targetModel = options.model || config.get('llm.models.chat') || config.get('llm.defaultModel')
        let channel = null
        if (options.groupId) {
            try {
                const sm = await ensureScopeManager()
                const groupCfg = await sm.getGroupChannelConfig(String(options.groupId))
                const resolved = channelManager.resolveGroupChannel(groupCfg, targetModel, options.groupId)
                if (resolved.channel) {
                    channel = resolved.channel
                    targetModel = resolved.model
                }
            } catch (e) {
                logger.warn(`[LlmService] 获取群${options.groupId}独立渠道失败: ${e.message}`)
            }
        }

        /* 回退到全局渠道 */
        if (!channel) {
            const channels = channelManager.getAll()
            channel = channels.find(c => c.enabled !== false && c.models?.includes(targetModel))
            if (!channel) {
                channel = channels.find(c => c.enabled !== false && c.apiKey)
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
            baseUrl: channelManager.getCurrentBaseUrl(channel.id) || channel.baseUrl,
            chatPath: channel.chatPath || '',
            modelsPath: channel.modelsPath || '',
            responsePath: channel.responsePath || channel.endpoints?.responses || '',
            endpoints: channel.endpoints || {},
            apiInterface: channel.apiInterface || channel.openaiApiInterface || 'chat',
            openaiApiInterface: channel.apiInterface || channel.openaiApiInterface || 'chat',
            experimental: channel.experimental || {},
            openaiResponses: channel.openaiResponses || {},
            customHeaders: channel.customHeaders || {},
            headersTemplate: channel.headersTemplate || '',
            requestBodyTemplate: channel.requestBodyTemplate || '',
            systemPromptConfig: normalizeSystemPromptConfig(channel.systemPromptConfig, channel.overrides),
            channelId: channel.id,
            channelName: channel.name,
            features: ['chat'],
            tools: [],
            imageConfig: channel.imageConfig || {}
        }

        const client = new ClientClass(clientOptions)
        client._channelInfo = {
            id: channel.id,
            name: channel.name,
            model: targetModel,
            maxCharacters: channel.advanced?.llm?.maxCharacters || 0,
            /* 暴露温度覆盖配置，供绕过 ChatService 的调用方（Galgame/bym 等）解析温度 */
            llm: channel.advanced?.llm || {},
            overrides: channel.overrides || {}
        }

        return client
    }

    /**
     * 获取对话模型（统一入口）
     * 对话模型同时处理上下文和工具调用
     * @returns {string} 模型名称
     */
    static getModel() {
        // 优先使用对话分类模型，再回退默认模型
        const categoryModel = config.get('llm.models.chat')
        if (typeof categoryModel === 'string' && categoryModel.trim()) {
            return categoryModel.trim()
        }

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
