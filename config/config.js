import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'

/**
 * Configuration manager for the plugin
 */
class Config {
    constructor() {
        this.config = {}
        this.configPath = ''
    }

    /**
     * Initialize configuration from file
     * @param {string} dataDir
     */
    startSync(dataDir) {
        this.dataDir = dataDir
        this.configPath = path.join(dataDir, '../config/config.yaml')

        // Create config directory if it doesn't exist
        const configDir = path.dirname(this.configPath)
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true })
        }

        // Load or create default config
        if (fs.existsSync(this.configPath)) {
            const content = fs.readFileSync(this.configPath, 'utf-8')
            const loadedConfig = yaml.parse(content) || {}
            this.config = this.mergeConfig(this.getDefaultConfig(), loadedConfig)
            this.save()
        } else {
            this.config = this.getDefaultConfig()
            this.save()
        }
    }

    /**
     * Deep merge configuration
     */
    mergeConfig(defaultConfig, loadedConfig) {
        const result = { ...defaultConfig }
        for (const key in loadedConfig) {
            if (loadedConfig[key] && typeof loadedConfig[key] === 'object' && !Array.isArray(loadedConfig[key])) {
                if (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
                    result[key] = this.mergeConfig(result[key], loadedConfig[key])
                } else {
                    result[key] = loadedConfig[key]
                }
            } else {
                result[key] = loadedConfig[key]
            }
        }
        return result
    }

    /**
     * Get default configuration
     */
    getDefaultConfig() {
        return {
            basic: {
                toggleMode: 'at', // 'at' or 'prefix'
                togglePrefix: '#chat',
                commandPrefix: '#ai',
                debug: false,
                showThinkingMessage: true, // 是否发送"思考中..."提示
                debugToConsoleOnly: true,  // 调试信息仅输出到控制台
                quoteReply: true,          // 是否引用触发消息
                autoRecall: {
                    enabled: false,        // 是否启用自动撤回
                    delay: 60,             // 撤回延迟（秒）
                    recallError: true,     // 是否撤回错误消息
                },
            },
            llm: {
                defaultModel: 'gpt-4o-mini',
                defaultChatPresetId: 'default',
                embeddingModel: 'text-embedding-3-small',
                dimensions: 1536,
                // 模型分类配置
                models: {
                    // 对话模型 - 用于普通聊天
                    chat: '',
                    // 伪人模型 - 用于模拟真人回复
                    roleplay: '',
                    // 工具调用模型 - 用于 function calling
                    toolCall: '',
                    // 搜索模型 - 用于联网搜索
                    search: '',
                    // 思考模型 - 用于深度推理
                    reasoning: ''
                },
                // 旧配置兼容
                chatModel: '',
                codeModel: '',
                translationModel: '',
            },
            bym: {
                enable: false,
                probability: 0.02,
                temperature: 0.9,
                maxTokens: 100,
                recall: false,
                model: '',
                systemPrompt: '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。',
                // 仅伪人模式可用的功能
                exclusiveFeatures: ['groupSummary', 'userPortrait']
            },
            // 工具调用配置
            tools: {
                showCallLogs: true,    // 显示工具调用日志
                useForwardMsg: true,   // 工具日志使用合并转发
            },
            builtinTools: {
                enabled: true,
                // 允许的工具列表，空数组表示允许所有
                allowedTools: [],
                // 禁用的工具列表
                disabledTools: [],
                // 危险工具需要确认
                dangerousTools: ['kick_member', 'mute_member', 'recall_message'],
                // 是否允许危险操作
                allowDangerous: false
            },
            channels: [],
            mcp: {
                enabled: true,
                servers: {
                    filesystem: {
                        type: 'stdio',
                        command: 'npx',
                        args: ['-y', '@modelcontextprotocol/server-filesystem', '/']
                    }
                }
            },
            redis: {
                enabled: true,
                host: '127.0.0.1',
                port: 6379,
                password: '',
                db: 0
            },
            images: {
                storagePath: './data/images',
                maxSize: 10 * 1024 * 1024,
                allowedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp']
            },
            web: {
                port: 3000,
            },
            context: {
                maxMessages: 20,
                maxTokens: 4000,
                cleaningStrategy: 'auto', // 'auto', 'manual'
            },
            memory: {
                enabled: false,
                storage: 'file', // 'file', 'redis'
                autoExtract: true, // 自动从对话提取记忆
                minScore: 0.7,     // 记忆相关性最低分数
            },
            presets: {
                // 默认预设 ID
                defaultId: 'default',
                // 是否允许用户切换预设
                allowUserSwitch: true,
                // 每个用户/群可以有独立的预设
                perUserPreset: false,
                perGroupPreset: false
            },
            loadBalancing: {
                strategy: 'priority', // 'priority', 'round-robin', 'random'
            },
            thinking: {
                defaultLevel: 'low', // 'low', 'medium', 'high'
                enableReasoning: false,
                showThinkingContent: true,  // 显示思考内容
                useForwardMsg: true,        // 思考内容使用合并转发
            },
            // 高级功能
            features: {
                groupSummary: {
                    enabled: true,           // 群聊总结功能
                    maxMessages: 100,        // 总结最近N条消息
                    autoTrigger: false,      // 自动触发（伪人模式下）
                },
                userPortrait: {
                    enabled: true,           // 个人画像分析
                    minMessages: 10,         // 最少需要N条消息才能分析
                },
            },
            streaming: {
                enabled: true,
            },
        }
    }

    /**
     * Save configuration to file
     */
    save() {
        const content = yaml.stringify(this.config)
        fs.writeFileSync(this.configPath, content, 'utf-8')
    }

    /**
     * Get configuration value
     * @param {string} [key]
     */
    get(key) {
        if (!key) return this.config
        const keys = key.split('.')
        let value = this.config
        for (const k of keys) {
            value = value?.[k]
        }
        return value
    }

    /**
     * Set configuration value
     * @param {string} key
     * @param {any} value
     */
    set(key, value) {
        const keys = key.split('.')
        let obj = this.config
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) {
                obj[keys[i]] = {}
            }
            obj = obj[keys[i]]
        }
        obj[keys[keys.length - 1]] = value
        this.save()
    }
}

const config = new Config()
export default config
