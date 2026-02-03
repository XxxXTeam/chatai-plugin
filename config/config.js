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
                commandPrefix: '#ai', // AI命令前缀
                debug: false,
                showThinkingMessage: true, // 是否发送"思考中..."提示
                debugToConsoleOnly: true, // 调试信息仅输出到控制台
                quoteReply: true, // 是否引用触发消息
                autoRecall: {
                    enabled: false, // 是否启用自动撤回
                    delay: 60, // 撤回延迟（秒）
                    recallError: true // 是否撤回错误消息
                }
            },
            admin: {
                masterQQ: [], // 主人QQ列表，留空使用Yunzai配置
                pluginAuthorQQ: [],
                loginNotifyPrivate: true, // 登录链接私聊推送
                sensitiveCommandMasterOnly: true // 敏感命令仅主人可用
            },
            llm: {
                defaultModel: 'qwen/qwen3-next-80b-a3b-instruct',
                defaultChatPresetId: 'default',
                embeddingModel: 'text-embedding-004', // Gemini embedding 模型
                dimensions: 1536,
                // 模型分类配置（每个分类配置一个模型名，空则使用默认模型）
                models: {
                    // 对话模型 - 用于普通聊天
                    chat: '',
                    // 图像模型 - 用于图像理解和生成
                    image: '',
                    // 伪人模型 - 用于模拟真人回复
                    roleplay: '',
                    // 游戏模型 - 用于Galgame等互动游戏
                    game: ''
                },
                // 备选模型配置 - 主模型失败时自动轮询
                fallback: {
                    enabled: true, // 启用备选模型轮询
                    models: [], // 备选模型列表，按优先级排序
                    maxRetries: 3, // 最大重试次数
                    retryDelay: 500, // 重试间隔(ms)
                    notifyOnFallback: false // 切换模型时是否通知用户
                },
                // 旧配置兼容
                chatModel: '',
                codeModel: '',
                translationModel: ''
            },
            bym: {
                enable: false,
                enableTools: false, // 是否允许伪人模式使用工具
                probability: 0.02,
                temperature: 0.9,
                maxTokens: 150,
                recall: false,
                model: '',
                systemPrompt:
                    '你是一个真实的人类用户，正在和朋友们聊天。请用简短、自然、口语化的方式回复，就像真人一样。不要说你是AI。',
                // 继承人格配置：启用后会使用用户/群组的独立人格设置
                inheritPersonality: true,
                // 关键词预设映射：{ "关键词": "预设ID" }
                presetMap: {},
                // 仅伪人模式可用的功能
                exclusiveFeatures: ['groupSummary', 'userPortrait']
            },
            // 游戏模式配置（Galgame等）
            game: {
                probability: 0.3, // 非@触发时的响应概率（30%）
                enableTools: true, // 是否允许游戏模式使用工具
                temperature: 0.8,
                maxTokens: 1000
            },
            // 主动聊天配置
            proactiveChat: {
                enabled: false, // 全局开关
                // 轮询配置
                pollInterval: 5, // 轮询间隔（分钟）
                minMessagesBeforeTrigger: 10, // 触发前最少需要的群消息数
                maxConcurrentTriggers: 3, // 单次轮询最大触发群数

                // 概率配置
                baseProbability: 0.05, // 基础触发概率 (5%)
                maxProbability: 0.5, // 最大触发概率上限 (50%)

                // 时段配置 - 静默时段不主动发言
                quietHoursStart: 0, // 静默开始时间（0-23，支持跨天如23表示23:00开始）
                quietHoursEnd: 6, // 静默结束时间（0-23）
                allowQuietHoursOverride: false, // 是否允许在静默时段触发

                // 时段概率乘数 - 不同时段的触发概率调整
                timePeriodMultipliers: {
                    late_night: 0.1, // 深夜 (0:00-5:00) 大幅降低
                    early_morning: 0.3, // 清晨 (5:00-7:00) 降低
                    morning: 1.0, // 上午 (7:00-12:00) 正常
                    afternoon: 1.2, // 下午 (12:00-18:00) 略高
                    evening: 1.5, // 傍晚 (18:00-21:00) 最活跃
                    night: 0.8 // 晚上 (21:00-24:00) 略低
                },

                // 星期乘数 - 不同日期的触发概率调整
                useWeekdayMultiplier: true, // 是否启用星期乘数
                weekdayMultipliers: {
                    0: 1.3, // 周日
                    1: 0.8, // 周一（工作日开始，较低）
                    2: 0.9, // 周二
                    3: 1.0, // 周三
                    4: 1.0, // 周四
                    5: 1.2, // 周五
                    6: 1.4 // 周六（周末，较高）
                },

                // 活跃度检测配置
                highFreqMessagesPerMinute: 2, // 判定为高频对话的消息速率（条/分钟）
                activeMessagesIn30Min: 15, // 30分钟内达到此消息数判定为活跃
                lowMessagesIn30Min: 3, // 30分钟内低于此消息数判定为低活跃
                deadMinutesWithoutMessage: 120, // 超过此分钟数无消息判定为死群
                inactiveMinutesLimit: 180, // 最近活跃距离现在超过该分钟则不主动触发

                // 活跃度级别乘数
                activityMultipliers: {
                    dead: 0, // 死群不触发
                    low: 0.3, // 低活跃降低概率
                    normal: 1.0, // 正常
                    active: 1.5, // 活跃提高概率
                    high_freq: 0.1 // 高频对话中大幅降低（避免打扰）
                },

                // AI配置
                model: '', // 使用的模型（留空使用默认）
                systemPrompt:
                    '你是群里的一员，正在查看群聊记录。根据最近的聊天内容，自然地参与讨论或发起新话题。保持简短、口语化、有趣。',
                maxTokens: 150,
                temperature: 0.9,

                // 群配置
                enabledGroups: [], // 启用的群列表，空表示所有群
                blacklistGroups: [], // 黑名单群

                // 防刷屏
                cooldownMinutes: 30, // 同一群触发后的冷却时间（分钟）
                maxDailyMessages: 20, // 每日每群最大主动消息数
                maxHourlyMessages: 5, // 每小时每群最大主动消息数

                // 记忆和上下文
                useGroupContext: true, // 使用群聊上下文
                contextMessageCount: 20 // 携带的上下文消息数
            },
            // 会话追踪配置 - 智能识别用户是否在继续与机器人对话
            conversationTracking: {
                enabled: false, // 是否启用会话追踪
                timeout: 2, // 追踪超时时间（分钟）
                throttle: 3, // AI判断节流间隔（秒）
                batchDelay: 3, // 批量判断延迟（秒）
                model: '' // 判断用模型（留空使用调度模型或默认模型）
            },
            // 工具调用配置
            tools: {
                showCallLogs: true, // 显示工具调用日志
                useForwardMsg: true, // 工具日志使用合并转发
                parallelExecution: true, // 启用并行工具执行
                sendIntermediateReply: true, // 工具调用前发送模型的中间回复
                // 工具组配置
                useToolGroups: false // 启用工具组模式
            },
            // 工具组定义（可在面板配置）
            toolGroups: [
                {
                    index: 0,
                    name: 'system',
                    description: '系统工具：获取时间、日期、系统信息等',
                    tools: ['get_time', 'get_date', 'get_system_info']
                },
                {
                    index: 1,
                    name: 'qq',
                    description: 'QQ操作：发消息、获取群信息、管理成员等',
                    tools: ['send_message', 'get_group_info', 'get_member_info', 'kick_member', 'mute_member']
                },
                {
                    index: 2,
                    name: 'web',
                    description: '网络工具：搜索、获取网页内容、访问URL等',
                    tools: ['web_search', 'fetch_url', 'read_webpage']
                },
                {
                    index: 3,
                    name: 'file',
                    description: '文件操作：读写文件、列目录等',
                    tools: ['read_file', 'write_file', 'list_directory']
                },
                {
                    index: 4,
                    name: 'memory',
                    description: '记忆管理：保存和检索用户记忆',
                    tools: ['save_memory', 'get_memory', 'search_memory']
                },
                {
                    index: 5,
                    name: 'image',
                    description: '图像处理：生成、编辑、分析图片',
                    tools: ['generate_image', 'edit_image', 'analyze_image']
                }
            ],
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
                enabled: true
            },
            bilibili: {
                sessdata: '' // B站登录Cookie的SESSDATA，用于获取AI视频总结
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
                sharePort: false, // TRSS环境下共享端口
                mountPath: '/chatai' // TRSS共享端口时的挂载路径
            },
            update: {
                autoCheck: true, // 启用自动检查更新
                checkOnStart: true, // 启动时检查更新
                autoUpdate: false, // 自动更新（不推荐）
                autoRestart: false, // 更新后自动重启
                notifyMaster: true // 有更新时通知主人
            },
            proxy: {
                enabled: false,
                profiles: [],
                scopes: {
                    browser: { enabled: false, profileId: null },
                    api: { enabled: false, profileId: null },
                    channel: { enabled: false, profileId: null }
                }
            },
            context: {
                maxMessages: 20,
                maxTokens: 4000,
                cleaningStrategy: 'auto', // 'auto', 'manual'
                autoSummarize: {
                    enabled: true,
                    intervalMinutes: 10,
                    maxMessagesBefore: 60, // 超过此消息数且长时间未活跃则总结
                    minInactiveMinutes: 30, // 在该时间段无人发言才会总结
                    retainMessagesAfterSummary: 5, // 总结后保留的最近消息数量
                    model: '', // 为空使用默认模型
                    maxTokens: 400, // 总结输出长度
                    windowMessages: 80 // 参与总结的最多消息数
                },
                // 隔离模式配置
                isolation: {
                    groupUserIsolation: false, // 群聊用户隔离（false=群共享上下文, true=每用户独立）
                    privateIsolation: true // 私聊隔离（每用户独立上下文）
                },
                // 自动上下文配置
                autoContext: {
                    enabled: true, // 启用自动上下文
                    maxHistoryMessages: 20, // 携带的历史消息数量
                    includeToolCalls: false // 是否包含工具调用记录
                },
                // 定量自动结束对话
                autoEnd: {
                    enabled: false, // 是否启用自动结束
                    maxRounds: 50, // 最大对话轮数（用户+AI各算1轮）
                    notifyUser: true, // 结束时是否通知用户
                    notifyMessage: '对话已达到最大轮数限制，已自动开始新会话。'
                },
                // 群聊上下文传递
                groupContextSharing: true,
                // 全局系统提示词
                globalSystemPrompt: '',
                // 全局提示词模式: append(追加) | prepend(前置) | override(覆盖)
                globalPromptMode: 'append'
            },
            memory: {
                enabled: false,
                storage: 'database', // 使用数据库存储
                autoExtract: true, // 自动从对话提取记忆
                pollInterval: 5, // 轮询间隔（分钟）
                maxMemories: 50, // 每用户最大记忆数
                model: '', // 记忆提取使用的模型（留空使用默认模型）
                // 群聊上下文采集
                groupContext: {
                    enabled: true, // 启用群聊上下文采集
                    collectInterval: 10, // 采集间隔（分钟）
                    maxMessagesPerCollect: 50, // 每次采集最大消息数
                    analyzeThreshold: 20, // 触发分析的最小消息数
                    extractUserInfo: true, // 提取用户信息作为记忆
                    extractTopics: true, // 提取讨论话题
                    extractRelations: true // 提取用户关系
                }
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
            // 人格优先级配置
            personality: {
                // 优先级顺序，越靠前优先级越高
                // 可选值: group_user(群内用户独立人格), group(群聊人格), user(用户全局人格), default(默认预设)
                priority: ['group', 'group_user', 'user', 'default'],
                // 是否启用独立人格（设置后完全替换默认，不拼接）
                useIndependent: true,
                // 独立人格上下文设置
                isolateContext: {
                    enabled: false, // 启用独立上下文（不与其他预设共享对话历史）
                    clearOnSwitch: false // 切换人格时是否清除上下文
                }
            },
            loadBalancing: {
                strategy: 'priority' // 'priority', 'round-robin', 'random'
            },
            thinking: {
                enabled: true, // 思考适配总开关（关闭后不解析和显示思考内容）
                defaultLevel: 'low', // 思考深度: 'low', 'medium', 'high'
                enableReasoning: false, // 启用推理模式（发送reasoning参数给API）
                showThinkingContent: true, // 显示思考内容
                useForwardMsg: true // 思考内容使用合并转发
            },
            // 渲染配置
            render: {
                mathFormula: true, // 启用数学公式自动渲染为图片
                theme: 'light', // 渲染主题: 'light' | 'dark'
                width: 800 // 渲染宽度
            },
            // 输出优化配置
            output: {
                // 长文本处理
                longText: {
                    enabled: true, // 启用长文本优化
                    threshold: 500, // 长文本阈值（字符数）
                    mode: 'forward', // 处理模式: 'auto' | 'forward' | 'image' | 'none'（默认合并转发）
                    forwardTitle: 'AI 回复' // 合并转发标题
                },
                sentenceOutput: {
                    enabled: false, // 启用按句输出
                    allSentences: false, // 全部按句输出（否则仅伪人模式）
                    minDelay: 300, // 句子间最小延迟（毫秒）
                    maxDelay: 1500, // 句子间最大延迟（毫秒）
                    randomDelay: true // 随机延迟（更自然）
                }
            },
            // 高级功能
            features: {
                groupSummary: {
                    enabled: true, // 群聊总结功能
                    maxMessages: 100, // 总结最近N条消息
                    autoTrigger: false, // 自动触发（伪人模式下）
                    maxChars: 6000, // 总结最大字符数
                    // 全局定时推送配置（群组未单独配置时使用）
                    push: {
                        enabled: false, // 全局启用定时推送
                        intervalType: 'day', // 推送间隔类型: 'hour' | 'day'
                        intervalValue: 1, // 推送间隔值
                        pushHour: 20, // 每日推送时间（小时，0-23）
                        messageCount: 100, // 总结消息数量
                        model: '' // 总结使用的模型（留空使用默认）
                    }
                },
                userPortrait: {
                    enabled: true, // 个人画像分析
                    minMessages: 10 // 最少需要N条消息才能分析
                },
                // 戳一戳响应（默认关闭，需在面板开启）
                poke: {
                    enabled: false, // 启用戳一戳响应
                    pokeBack: false, // 是否回戳
                    message: '别戳了~' // AI失败时的默认回复
                },
                // 表情回应处理（默认关闭，需在面板开启）
                reaction: {
                    enabled: false, // 启用表情回应处理
                    prompt: '', // 添加回应的提示词模板（留空使用默认）
                    removePrompt: '' // 取消回应的提示词模板（留空使用默认）
                },
                // 消息撤回响应（默认关闭）
                recall: {
                    enabled: false, // 启用撤回响应
                    aiResponse: true, // 使用AI响应撤回
                    prompt: '' // 自定义提示词（留空使用默认）
                },
                // 入群欢迎（默认关闭）
                welcome: {
                    enabled: false, // 启用入群欢迎
                    message: '', // 默认欢迎语（空则使用AI生成）
                    prompt: '' // 自定义提示词（留空使用默认）
                },
                // 退群通知（默认关闭）
                goodbye: {
                    enabled: false, // 启用退群通知
                    aiResponse: false, // 使用AI响应退群
                    prompt: '' // 自定义提示词（留空使用默认）
                },
                // 禁言事件响应（默认关闭）
                ban: {
                    enabled: false, // 启用禁言响应
                    aiResponse: true, // 使用AI响应禁言
                    prompt: '' // 自定义提示词（留空使用默认）
                },
                // 管理员变更响应（默认关闭）
                admin: {
                    enabled: false, // 启用管理员变更响应
                    prompt: '' // 自定义提示词（留空使用默认）
                },
                // 运气王响应（默认关闭）
                luckyKing: {
                    enabled: false, // 启用运气王响应
                    congratulate: false, // 祝贺他人成为运气王
                    prompt: '' // 自定义提示词（留空使用默认）
                },
                // 荣誉变更响应（默认关闭）
                honor: {
                    enabled: false, // 启用荣誉响应（龙王、群聊之火等）
                    prompt: '' // 自定义提示词（留空使用默认）
                },
                // 精华消息响应（默认关闭）
                essence: {
                    enabled: false, // 启用精华消息响应
                    prompt: '' // 自定义提示词（留空使用默认）
                },
                // AI绘图
                imageGen: {
                    enabled: true, // 启用绘图功能
                    model: 'gemini-3-pro-image', // 默认模型
                    videoModel: 'veo-2.0-generate-001', // 视频生成模型
                    timeout: 600000, // 超时时间（毫秒）
                    maxImages: 3, // 最大图片数
                    // API列表
                    apis: [{ baseUrl: 'https://business.928100.xyz/v1/chat/completions', apiKey: 'X-Free' }],
                    // 预设来源配置
                    presetSources: [{ name: '云端预设', url: 'https://ht.pippi.top/data.json', enabled: true }],
                    // 自定义预设（面板可编辑）
                    customPresets: []
                },
                // 语音回复（旧配置，兼容）
                voiceReply: {
                    enabled: false, // 启用语音回复
                    ttsProvider: 'system', // TTS提供者
                    triggerOnTool: false, // 工具调用后语音回复
                    triggerAlways: false, // 总是语音回复
                    maxTextLength: 500 // 最大文本长度
                }
            },
            // AI声聊配置（QQ原生功能）
            voice: {
                enabled: false, // 全局开关
                defaultCharacter: '', // 默认AI声聊角色
                maxTextLength: 500 // 最大文本长度
            },
            streaming: {
                enabled: true
            },
            // IP探针配置
            probe: {
                serverUrl: 'http://127.0.0.1:9527', // 探针服务器地址
                secretKey: 'your-secret-key-change-me' // API密钥，需与服务端一致
            },
            // AI触发配置
            trigger: {
                private: {
                    enabled: true, // 是否响应私聊
                    mode: 'prefix' // 私聊触发模式: 'always'(总是), 'prefix'(需前缀), 'off'(关闭)
                },
                group: {
                    enabled: true, // 是否响应群聊
                    at: true, // @机器人触发
                    prefix: true, // 前缀触发
                    keyword: false, // 关键词触发
                    random: false, // 随机触发
                    randomRate: 0.05 // 随机触发概率
                },
                prefixes: ['#chat'], // 前缀列表
                keywords: [], // 关键词列表
                collectGroupMsg: true, // 采集群消息用于记忆
                blacklistUsers: [], // 用户黑名单
                whitelistUsers: [], // 用户白名单（空=不限）
                blacklistGroups: [], // 群黑名单
                whitelistGroups: [] // 群白名单（空=不限）
            }
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
