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
            },
            llm: {
                defaultModel: 'gpt-4o-mini',
                defaultChatPresetId: 'default',
                embeddingModel: 'text-embedding-3-small',
                dimensions: 1536,
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
            },
            channels: [],
            mcp: {
                enabled: true,
                servers: {
                    filesystem: {
                        type: 'stdio',
                        command: 'npx',
                        args: ['-y', '@modelcontextprotocol/server-filesystem', '/home/chen/Desktop']
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
            },
            loadBalancing: {
                strategy: 'priority', // 'priority', 'round-robin', 'random'
            },
            thinking: {
                defaultLevel: 'low', // 'low', 'medium', 'high'
                enableReasoning: false,
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
