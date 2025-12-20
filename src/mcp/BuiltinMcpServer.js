/**
 * 内置 MCP 服务器
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBotFramework } from '../utils/bot.js'
import config from '../../config/config.js'
import { validateParams, paramError } from './tools/helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 检测Bot适配器类型
 * @param {Object} bot - Bot实例
 * @returns {{ adapter: 'icqq'|'napcat'|'onebot'|'unknown', isNT: boolean, canAiVoice: boolean }}
 */
function detectAdapter(bot) {
    if (!bot) return { adapter: 'unknown', isNT: false, canAiVoice: false }
    const hasIcqqFeatures = !!(bot.pickGroup && bot.pickFriend && bot.fl && bot.gl)
    const hasNT = typeof bot.sendOidbSvcTrpcTcp === 'function'
    
    if (hasIcqqFeatures) {
        logger.debug(`[detectAdapter] icqq检测: hasIcqqFeatures=${hasIcqqFeatures}, hasNT=${hasNT}`)
        return { adapter: 'icqq', isNT: hasNT, canAiVoice: hasNT }
    }
    
    // OneBot/NapCat 检测
    if (bot.sendApi) {
        const isNapCat = !!(
            bot.adapter?.name?.toLowerCase?.()?.includes?.('napcat') || 
            bot.config?.protocol === 'napcat' ||
            bot.version?.app_name?.toLowerCase?.()?.includes?.('napcat')
        )
        if (isNapCat) {
            return { adapter: 'napcat', isNT: true, canAiVoice: true }
        }
        // 其他OneBot实现可能也支持AI声聊
        return { adapter: 'onebot', isNT: false, canAiVoice: false }
    }
    
    return { adapter: 'unknown', isNT: false, canAiVoice: false }
}

const adapterCache = new Map()

/**
 * 工具执行上下文
 */
class ToolContext {
    constructor() {
        this.bot = null
        this.event = null
        this.callbacks = new Map()
        this._adapterInfo = null
    }

    setContext(ctx) {
        if (ctx.bot) this.bot = ctx.bot
        if (ctx.event) this.event = ctx.event
        // 每次设置上下文时更新适配器信息
        this._adapterInfo = null
    }

    getBot(botId) {
        if (this.bot) return this.bot
        if (this.event?.bot) return this.event.bot
        
        const framework = getBotFramework()
        if (framework === 'trss' && botId && Bot.bots?.get) {
            return Bot.bots.get(botId) || Bot
        }
        return Bot
    }

    getEvent() {
        return this.event
    }

    /**
     * 获取当前Bot的适配器信息
     * @returns {{ adapter: 'icqq'|'napcat'|'onebot'|'unknown', isNT: boolean, canAiVoice: boolean }}
     */
    getAdapter() {
        if (this._adapterInfo) return this._adapterInfo
        
        const bot = this.getBot()
        const botId = bot?.uin || bot?.self_id || 'default'
        
        // 检查缓存
        if (adapterCache.has(botId)) {
            this._adapterInfo = adapterCache.get(botId)
            return this._adapterInfo
        }
        
        // 检测并缓存
        this._adapterInfo = detectAdapter(bot)
        adapterCache.set(botId, this._adapterInfo)
        return this._adapterInfo
    }
    isIcqq() {
        return this.getAdapter().adapter === 'icqq'
    }
    isNapCat() {
        return this.getAdapter().adapter === 'napcat'
    }
    isNT() {
        return this.getAdapter().isNT
    }

    /**
     * 注册回调
     */
    registerCallback(id, callback) {
        this.callbacks.set(id, callback)
    }

    /**
     * 执行回调
     */
    async executeCallback(id, data) {
        const callback = this.callbacks.get(id)
        if (callback) {
            const result = await callback(data)
            this.callbacks.delete(id)
            return result
        }
        return null
    }
}

/**
 * 清除适配器缓存
 */
export function clearAdapterCache(botId) {
    if (botId) {
        adapterCache.delete(botId)
    } else {
        adapterCache.clear()
    }
}

const toolContext = new ToolContext()

/**
 * 设置工具上下文
 */
export function setBuiltinToolContext(ctx) {
    toolContext.setContext(ctx)
}

/**
 * 获取工具上下文
 */
export function getBuiltinToolContext() {
    return toolContext
}

/**
 * 内置 MCP 服务器
 */
export class BuiltinMcpServer {
    constructor() {
        this.name = 'builtin'
        this.tools = [] 
        this.jsTools = new Map()  // 存储 JS 文件加载的工具
        this.modularTools = []     // 分割后的模块化工具
        this.toolCategories = {}   // 工具类别信息
        this.initialized = false
    }

    /**
     * 初始化服务器
     */
    async init() {
        if (this.initialized) return
        await this.loadModularTools()
        await this.loadJsTools()
        this.initialized = true
        logger.debug('[BuiltinMCP] 初始化完成:', this.tools.length, '内置工具,', this.modularTools.length, '模块化工具,', this.jsTools.size, 'JS工具')
    }

    /**
     * 加载分割后的模块化工具
     */
    async loadModularTools() {
        try {
            const { getAllTools, getCategoryInfo, toolCategories } = await import('./tools/index.js')
            
            // 获取类别信息
            this.toolCategories = toolCategories
            
            // 获取工具配置
            const builtinConfig = config.get('builtinTools') || {}
            const enabledCategories = builtinConfig.enabledCategories // 未设置则启用所有
            const disabledTools = builtinConfig.disabledTools || []
            
            // 加载工具
            this.modularTools = getAllTools({ enabledCategories, disabledTools })
            
            logger.debug(`[BuiltinMCP] 加载模块化工具: ${this.modularTools.length} 个`)
        } catch (err) {
            logger.warn('[BuiltinMCP] 加载模块化工具失败，使用内置定义:', err.message)
            this.modularTools = []
        }
    }
    getToolCategories() {
        const builtinConfig = config.get('builtinTools') || {}
        const enabledCategories = builtinConfig.enabledCategories
        const categories = []
        
        for (const [key, categoryConfig] of Object.entries(this.toolCategories)) {
            const isEnabled = enabledCategories ? enabledCategories.includes(key) : true
            
            categories.push({
                key,
                name: categoryConfig.name,
                description: categoryConfig.description,
                icon: categoryConfig.icon,
                toolCount: categoryConfig.tools?.length || 0,
                tools: categoryConfig.tools?.map(t => ({ name: t.name, description: t.description })) || [],
                enabled: isEnabled
            })
        }
        return categories
    }

    /**
     * 切换工具类别启用状态
     * @param {string} category - 类别名称
     * @param {boolean} enabled - 是否启用
     */
    async toggleCategory(category, enabled) {
        const builtinConfig = config.get('builtinTools') || {}
        let enabledCategories = builtinConfig.enabledCategories || Object.keys(this.toolCategories)
        
        if (enabled) {
            if (!enabledCategories.includes(category)) {
                enabledCategories.push(category)
            }
        } else {
            enabledCategories = enabledCategories.filter(c => c !== category)
        }
        
        await config.set('builtinTools.enabledCategories', enabledCategories)
        await this.loadModularTools()
        return { success: true, enabledCategories }
    }

    /**
     * 切换单个工具启用状态
     * @param {string} toolName - 工具名称
     * @param {boolean} enabled - 是否启用
     */
    async toggleTool(toolName, enabled) {
        const builtinConfig = config.get('builtinTools') || {}
        let disabledTools = builtinConfig.disabledTools || []
        
        if (enabled) {
            disabledTools = disabledTools.filter(t => t !== toolName)
        } else {
            if (!disabledTools.includes(toolName)) {
                disabledTools.push(toolName)
            }
        }
        
        await config.set('builtinTools.disabledTools', disabledTools)
        await this.loadModularTools()
        return { success: true, disabledTools }
    }
    async loadJsTools() {
        const toolsDir = path.join(__dirname, '../../data/tools')
        logger.debug(`[BuiltinMCP] 加载JS工具: ${toolsDir}`)
        this.jsTools.clear()
        
        if (!fs.existsSync(toolsDir)) {
            logger.debug(`[BuiltinMCP] 创建工具目录: ${toolsDir}`)
            fs.mkdirSync(toolsDir, { recursive: true })
            return
        }
        
        const allFiles = fs.readdirSync(toolsDir)
        const files = allFiles.filter(f => f.endsWith('.js') && f !== 'CustomTool.js')
        logger.debug(`[BuiltinMCP] 发现 ${files.length} 个JS工具`)
        
        for (const file of files) {
            try {
                const filePath = path.join(toolsDir, file)
                logger.debug(`[BuiltinMCP] 加载: ${file}`)
                const timestamp = Date.now()
                const module = await import(`file://${filePath}?t=${timestamp}`)
                const tool = module.default
                
                if (!tool) {
                    logger.warn(`[BuiltinMCP] ✗ No default export in ${file}`)
                    continue
                }
                const toolName = tool.name || tool.function?.name
                const hasRun = typeof tool.run === 'function'
                
                logger.debug(`[BuiltinMCP] 模块: ${toolName}, run=${hasRun}`)
                
                if (toolName && hasRun) {
                    tool.__filename = file
                    tool.__filepath = filePath
                    this.jsTools.set(toolName, tool)
                    logger.debug(`[BuiltinMCP] ✓ ${toolName}`)
                } else {
                    logger.warn(`[BuiltinMCP] ✗ Invalid tool format in ${file}, must have name and run()`)
                }
            } catch (error) {
                logger.error(`[BuiltinMCP] ✗ Failed to load tool ${file}:`, error.message)
            }
        }
        
        logger.debug(`[BuiltinMCP] JS工具加载完成: ${this.jsTools.size}`)
    }

    /**
     * 获取自定义工具列表
     */
    getCustomTools() {
        const customTools = config.get('customTools') || []
        return customTools.map(t => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters || { type: 'object', properties: {} },
            isCustom: true,
            handler: t.handler
        }))
    }

    /**
     * 获取所有工具定义
     */
    listTools() {
        const builtinConfig = config.get('builtinTools') || { enabled: true }
        
        let tools = []
        const disabledTools = builtinConfig.disabledTools || []
        if (builtinConfig.enabled) {
            if (this.modularTools.length > 0) {
                tools = this.modularTools.map(t => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema
                }))
            } else {
                let builtinTools = [...this.tools]
                if (builtinConfig.allowedTools?.length > 0) {
                    builtinTools = builtinTools.filter(t => builtinConfig.allowedTools.includes(t.name))
                }
                if (disabledTools.length > 0) {
                    builtinTools = builtinTools.filter(t => !disabledTools.includes(t.name))
                }
                if (!builtinConfig.allowDangerous) {
                    const dangerous = builtinConfig.dangerousTools || []
                    builtinTools = builtinTools.filter(t => !dangerous.includes(t.name))
                }

                tools = builtinTools.map(t => ({
                    name: t.name,
                    description: t.description,
                    inputSchema: t.inputSchema
                }))
            }
        }
        const customTools = this.getCustomTools()
        for (const ct of customTools) {
            tools.push({
                name: ct.name,
                description: ct.description,
                inputSchema: ct.inputSchema,
                isCustom: true
            })
        }
        for (const [name, tool] of this.jsTools) {
            if (disabledTools.includes(name)) continue
            tools.push({
                name: name,
                description: tool.function?.description || tool.description || '',
                inputSchema: tool.function?.parameters || tool.parameters || { type: 'object', properties: {} },
                isCustom: true,
                isJsTool: true
            })
        }

        return tools
    }

    /**
     * 执行自定义工具代码
     * 提供完整的内部 API 访问
     */
    async executeCustomHandler(handlerCode, args, ctx) {
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
        
        try {
            const runtime = await this.buildToolRuntime(ctx)
            const fn = new AsyncFunction(
                'args', 'ctx', 'fetch', 'runtime',
                'Redis', 'config', 'logger', 'Bot', 'fs', 'path', 'crypto',
                handlerCode
            )
            
            const result = await fn(
                args,
                ctx,
                fetch,
                runtime,
                runtime.Redis,
                runtime.config,
                runtime.logger,
                runtime.Bot,
                fs,
                path,
                crypto
            )
            return result
        } catch (error) {
            logger.error('[BuiltinMCP] Custom tool execution error:', error)
            throw error
        }
    }

    /**
     * 构建工具运行时环境
     */
    async buildToolRuntime(ctx) {
        const { redisClient } = await import('../core/cache/RedisClient.js')
        const { chatService } = await import('../services/llm/ChatService.js')
        const { databaseService } = await import('../services/storage/DatabaseService.js')
        const { memoryManager } = await import('../services/storage/MemoryManager.js')
        const { channelManager } = await import('../services/llm/ChannelManager.js')
        const { contextManager } = await import('../services/llm/ContextManager.js')
        const { knowledgeService } = await import('../services/storage/KnowledgeService.js')
        const { presetManager } = await import('../services/preset/PresetManager.js')
        const event = ctx?.getEvent?.()
        const userId = event?.user_id?.toString()
        const groupId = event?.group_id?.toString()
        const conversationId = userId ? contextManager.getConversationId(userId, groupId) : null
        
        return {
            Redis: redisClient,
            config: config,
            logger: logger,
            Bot: ctx?.getBot?.() || global.Bot,
            
            // 当前会话上下文
            context: {
                userId,
                groupId,
                conversationId,
                event,
                isGroup: !!groupId,
                isPrivate: !groupId && !!userId
            },
            
            // 服务访问
            services: {
                chat: chatService,
                database: databaseService,
                memory: memoryManager,
                channel: channelManager,
                context: contextManager,
                knowledge: knowledgeService,
                preset: presetManager
            },
            
            // 知识库快捷访问
            knowledge: {
                // 搜索知识库
                search: (query, options = {}) => knowledgeService.search(query, options),
                // 获取文档
                get: (id) => knowledgeService.get(id),
                // 获取预设关联的知识库
                getForPreset: (presetId) => knowledgeService.getPresetKnowledge(presetId),
                // 构建知识库提示词
                buildPrompt: (presetId, options) => knowledgeService.buildKnowledgePrompt(presetId, options)
            },
            
            // 记忆快捷访问
            memory: {
                // 获取用户记忆
                get: async (targetUserId) => {
                    const uid = targetUserId || userId
                    if (!uid) return []
                    return memoryManager.getMemories(uid)
                },
                // 添加记忆
                add: async (content, targetUserId, metadata = {}) => {
                    const uid = targetUserId || userId
                    if (!uid) throw new Error('无法确定用户ID')
                    return memoryManager.addMemory(uid, content, metadata)
                },
                // 搜索记忆
                search: async (query, targetUserId) => {
                    const uid = targetUserId || userId
                    if (!uid) return []
                    return memoryManager.searchMemories(uid, query)
                },
                // 删除记忆
                delete: async (memoryId) => memoryManager.deleteMemory(memoryId)
            },
            
            // 上下文快捷访问
            conversation: {
                // 获取历史
                getHistory: async (convId) => {
                    const id = convId || conversationId
                    if (!id) return []
                    return contextManager.getContextHistory(id)
                },
                // 清除历史
                clear: async (convId) => {
                    const id = convId || conversationId
                    if (!id) return false
                    const historyManager = (await import('../core/utils/history.js')).default
                    await historyManager.deleteConversation(id)
                    return true
                },
                // 获取统计
                getStats: async (convId) => {
                    const id = convId || conversationId
                    if (!id) return null
                    return contextManager.getContextStats(id)
                }
            },
            utils: {
                sendGroupMsg: async (groupId, msg) => {
                    const bot = ctx?.getBot?.() || global.Bot
                    if (!bot) throw new Error('Bot not available')
                    return bot.pickGroup(parseInt(groupId)).sendMsg(msg)
                },
                // 发送私聊消息
                sendPrivateMsg: async (userId, msg) => {
                    const bot = ctx?.getBot?.() || global.Bot
                    if (!bot) throw new Error('Bot not available')
                    return bot.pickFriend(parseInt(userId)).sendMsg(msg)
                },
                // HTTP 请求
                http: {
                    get: async (url, options = {}) => {
                        const res = await fetch(url, { method: 'GET', ...options })
                        return res.json()
                    },
                    post: async (url, data, options = {}) => {
                        const res = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...options.headers },
                            body: JSON.stringify(data),
                            ...options
                        })
                        return res.json()
                    }
                },
                // 延迟
                sleep: (ms) => new Promise(r => setTimeout(r, ms)),
                // 生成 UUID
                uuid: () => crypto.randomUUID(),
                // 读取文件
                readFile: (filePath) => fs.readFileSync(filePath, 'utf-8'),
                // 写入文件
                writeFile: (filePath, content) => fs.writeFileSync(filePath, content),
                // 执行 shell 命令（受限）
                exec: async (cmd) => {
                    // 危险命令黑名单
                    const dangerousPatterns = [
                        /rm\s+(-[rf]+\s+)*[\/~]/, // rm -rf / 或 rm ~/
                        /rm\s+-rf/, // rm -rf
                        /mkfs/, // 格式化
                        /dd\s+if=/, // dd 磁盘操作
                        /:\(\)\s*\{/, // fork 炸弹
                        /chmod\s+(-R\s+)?[0-7]{3,4}\s+[\/~]/, // chmod 根目录
                        /chown\s+(-R\s+)?.*[\/~]/, // chown 根目录
                        />\s*\/dev\/sd/, // 写入磁盘设备
                        /curl.*\|\s*(ba)?sh/, // curl | sh 管道执行
                        /wget.*\|\s*(ba)?sh/, // wget | sh 管道执行
                        /eval\s/, // eval 执行
                        /sudo\s/, // sudo 提权
                        /su\s+-/, // su 切换用户
                        /shutdown/, // 关机
                        /reboot/, // 重启
                        /init\s+[0-6]/, // init 运行级别
                        /systemctl\s+(stop|disable|mask)/, // systemctl 停止服务
                        /kill\s+-9\s+(-1|1)/, // kill -9 -1 杀死所有进程
                        /pkill\s+-9/, // pkill -9
                        /history\s+-c/, // 清除历史
                        /shred/, // 安全删除
                        /wipefs/, // 擦除文件系统
                    ]
                    
                    for (const pattern of dangerousPatterns) {
                        if (pattern.test(cmd)) {
                            throw new Error('检测到危险命令，已拒绝执行')
                        }
                    }
                    
                    const { exec } = await import('child_process')
                    return new Promise((resolve, reject) => {
                        exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
                            if (err) reject(err)
                            else resolve({ stdout, stderr })
                        })
                    })
                }
            },
            
            // MCP 相关
            mcp: {
                callTool: async (name, toolArgs) => {
                    const mcpManager = (await import('./McpManager.js')).default
                    const event = ctx?.getEvent?.()
                    const bot = ctx?.getBot?.()
                    const requestContext = event ? { event, bot } : null
                    return mcpManager.callTool(name, toolArgs, { context: requestContext })
                },
                listTools: async () => {
                    const mcpManager = (await import('./McpManager.js')).default
                    return mcpManager.getTools()
                }
            }
        }
    }

    /**
     * 调用工具
     * @param {string} name - 工具名称
     * @param {Object} args - 工具参数
     * @param {Object} requestContext - 请求级上下文
     */
    async callTool(name, args, requestContext = null) {
        // 创建请求级上下文包装器，优先使用传入的上下文
        const ctx = this.createRequestContext(requestContext)
        
        // 先检查是否是 JS 文件工具
        const jsTool = this.jsTools.get(name)
        if (jsTool) {
            logger.debug(`[BuiltinMCP] 调用JS工具: ${name}`)
            
            // 参数验证
            if (jsTool.inputSchema) {
                const validation = validateParams(args, jsTool.inputSchema, ctx)
                if (!validation.valid) {
                    logger.debug(`[BuiltinMCP] 参数验证失败: ${name} - ${validation.error}`)
                    return this.formatResult(paramError(validation))
                }
            }
            
            try {
                // 设置上下文供工具使用
                const { asyncLocalStorage } = await import('../core/utils/helpers.js')
                const chaiteContext = {
                    getEvent: () => ctx.getEvent?.(),
                    getBot: () => ctx.getBot?.(),
                    getAdapter: () => ctx.getAdapter?.() || detectAdapter(ctx.getBot?.()),
                    isIcqq: () => ctx.isIcqq?.() || chaiteContext.getAdapter().adapter === 'icqq',
                    isNapCat: () => ctx.isNapCat?.() || chaiteContext.getAdapter().adapter === 'napcat',
                    isNT: () => ctx.isNT?.() || chaiteContext.getAdapter().isNT,
                    event: ctx.getEvent?.(),
                    bot: ctx.getBot?.()
                }
                
                // 在 asyncLocalStorage 中运行，以便工具可以获取上下文
                const result = await asyncLocalStorage.run(chaiteContext, async () => {
                    return await jsTool.run(args, chaiteContext)
                })
                return this.formatResult(result)
            } catch (error) {
                logger.error(`[BuiltinMCP] JS tool error: ${name}`, error)
                return {
                    content: [{ type: 'text', text: `Error: ${error.message}` }],
                    isError: true
                }
            }
        }
        
        // 检查是否是 YAML 配置的自定义工具
        const customTools = this.getCustomTools()
        const customTool = customTools.find(t => t.name === name)
        
        if (customTool) {
            logger.debug(`[BuiltinMCP] 调用自定义工具: ${name}`)
            
            // 参数验证
            if (customTool.inputSchema) {
                const validation = validateParams(args, customTool.inputSchema, ctx)
                if (!validation.valid) {
                    logger.debug(`[BuiltinMCP] 参数验证失败: ${name} - ${validation.error}`)
                    return this.formatResult(paramError(validation))
                }
            }
            
            try {
                const result = await this.executeCustomHandler(customTool.handler, args, ctx)
                return this.formatResult(result)
            } catch (error) {
                logger.error(`[BuiltinMCP] Custom tool error: ${name}`, error)
                return {
                    content: [{ type: 'text', text: `Error: ${error.message}` }],
                    isError: true
                }
            }
        }
        const modularTool = this.modularTools.find(t => t.name === name)
        if (modularTool) {
            logger.debug(`[BuiltinMCP] 调用模块化工具: ${name}, 参数:`, JSON.stringify(args))
            
            // 参数验证
            if (modularTool.inputSchema) {
                const validation = validateParams(args, modularTool.inputSchema, ctx)
                logger.debug(`[BuiltinMCP] 参数验证结果: ${name}`, validation)
                if (!validation.valid) {
                    logger.info(`[BuiltinMCP] 参数验证失败: ${name} - ${validation.error}`)
                    return this.formatResult(paramError(validation))
                }
            }
            
            try {
                const result = await modularTool.handler(args, ctx)
                return this.formatResult(result)
            } catch (error) {
                logger.error(`[BuiltinMCP] Modular tool error: ${name}`, error)
                return {
                    content: [{ type: 'text', text: `Error: ${error.message}` }],
                    isError: true
                }
            }
        }
        const tool = this.tools.find(t => t.name === name)
        if (!tool) {
            throw new Error(`Tool not found: ${name}`)
        }

        logger.debug(`[BuiltinMCP] 调用内置工具: ${name}`)

        // 参数验证
        if (tool.inputSchema) {
            const validation = validateParams(args, tool.inputSchema, ctx)
            if (!validation.valid) {
                logger.debug(`[BuiltinMCP] 参数验证失败: ${name} - ${validation.error}`)
                return this.formatResult(paramError(validation))
            }
        }

        try {
            const result = await tool.handler(args, ctx)
            
            // 格式化为 MCP 标准响应
            return this.formatResult(result)
        } catch (error) {
            logger.error(`[BuiltinMCP] Tool error: ${name}`, error)
            return {
                content: [{ type: 'text', text: `Error: ${error.message}` }],
                isError: true
            }
        }
    }

    /**
     * 创建请求级上下文包装器
     * @param {Object} requestContext - 传入的请求上下文 {event, bot}
     * @returns {Object} 上下文包装器
     */
    createRequestContext(requestContext) {
        // 如果有传入的请求上下文，使用它（用于并发隔离）
        if (requestContext && requestContext.event) {
            const getBot = (botId) => {
                if (requestContext.bot) return requestContext.bot
                if (requestContext.event?.bot) return requestContext.event.bot
                const framework = getBotFramework()
                if (framework === 'trss' && botId && Bot.bots?.get) {
                    return Bot.bots.get(botId) || Bot
                }
                return Bot
            }
            
            // 缓存适配器信息
            let _adapterInfo = null
            const getAdapter = () => {
                if (_adapterInfo) return _adapterInfo
                const bot = getBot()
                const botId = bot?.uin || bot?.self_id || 'default'
                if (adapterCache.has(botId)) {
                    _adapterInfo = adapterCache.get(botId)
                    return _adapterInfo
                }
                _adapterInfo = detectAdapter(bot)
                adapterCache.set(botId, _adapterInfo)
                return _adapterInfo
            }
            
            return {
                getBot,
                getEvent: () => requestContext.event,
                getAdapter,
                isIcqq: () => getAdapter().adapter === 'icqq',
                isNapCat: () => getAdapter().adapter === 'napcat',
                isNT: () => getAdapter().isNT,
                registerCallback: (id, cb) => toolContext.registerCallback(id, cb),
                executeCallback: (id, data) => toolContext.executeCallback(id, data)
            }
        }
        return toolContext
    }

    /**
     * 格式化工具结果为 MCP 标准格式
     */
    formatResult(result) {
        if (!result) {
            return { content: [{ type: 'text', text: 'No result' }] }
        }
        if (result.content && Array.isArray(result.content)) {
            return result
        }
        const content = []

        if (result.text) {
            content.push({ type: 'text', text: result.text })
        }

        if (result.image) {
            content.push({
                type: 'image',
                data: result.image.base64 || result.image.data,
                mimeType: result.image.mimeType || 'image/png'
            })
        }

        if (result.video) {
            content.push({
                type: 'resource',
                resource: {
                    uri: result.video.url || result.video.file,
                    mimeType: result.video.mimeType || 'video/mp4',
                    text: result.video.description || 'Video content'
                }
            })
        }

        if (result.file) {
            content.push({
                type: 'resource',
                resource: {
                    uri: result.file.url || result.file.path,
                    mimeType: result.file.mimeType || 'application/octet-stream',
                    text: result.file.name || 'File'
                }
            })
        }
        if (content.length === 0) {
            content.push({
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            })
        }

        return { content, isError: result.error ? true : false }
    }
    defineTools() {
        return [
        
        ]
    }
}
export const builtinMcpServer = new BuiltinMcpServer()
