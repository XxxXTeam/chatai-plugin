import { chatLogger } from '../core/utils/logger.js'
const logger = chatLogger
/**
 * 内置 MCP 服务器
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectFramework as getBotFramework, isMaster as checkIsMaster } from '../utils/platformAdapter.js'
import config from '../../config/config.js'
import {
    validateParams,
    paramError,
    getBotPermission,
    isToolResultError,
    permissionDeniedError,
    toolDisabledError
} from './tools/helpers.js'

// 懒加载统计服务
let _statsService = null
async function getStatsService() {
    if (!_statsService) {
        try {
            const mod = await import('../services/stats/StatsService.js')
            _statsService = mod.statsService
        } catch (e) {
            logger.debug('[BuiltinMCP] 统计服务加载失败:', e.message)
        }
    }
    return _statsService
}

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
        this._isMaster = false
    }

    setContext(ctx) {
        if (ctx.bot) this.bot = ctx.bot
        if (ctx.event) this.event = ctx.event
        if (ctx.adapterInfo) {
            this._adapterInfo = ctx.adapterInfo
        } else if (ctx.adapter) {
            this._adapterInfo = {
                adapter: ctx.adapter,
                isNT: ctx.isNT ?? false,
                canAiVoice: ctx.canAiVoice ?? false
            }
        } else {
            this._adapterInfo = null
        }
        const userId = this.event?.user_id
        this._isMaster = userId ? checkIsMaster(userId) : false
    }

    get isMaster() {
        return this._isMaster
    }

    getBot(botId) {
        // 优先从 event.bot 获取（确保多Bot环境下获取正确的Bot实例）
        if (this.event?.bot) return this.event.bot
        if (this.bot) return this.bot

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

        // 优先从 event.bot 获取 Bot 对象（确保多Bot环境下检测正确的适配器）
        const bot = this.event?.bot || this.bot || this.getBot()
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
     * 获取 Bot 在指定群内的权限信息
     * @param {number|string} groupId - 群号，不传则使用当前事件的群号
     * @returns {Promise<{role: string, isAdmin: boolean, isOwner: boolean, inGroup: boolean}>}
     */
    async getBotPermission(groupId) {
        const gid = groupId || this.event?.group_id
        if (!gid) {
            return { role: 'unknown', isAdmin: false, isOwner: false, inGroup: false }
        }
        const bot = this.getBot()
        return await getBotPermission(bot, gid)
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
        this.jsTools = new Map() // 存储 JS 文件加载的工具
        this.modularTools = [] // 分割后的模块化工具
        this.toolCategories = {} // 工具类别信息
        this.initialized = false
        this.fileWatchers = [] // 文件监听器列表
        this.watcherEnabled = false
        this.reloadDebounceTimer = null
    }

    /**
     * 初始化服务器
     */
    async init() {
        if (this.initialized) return
        await this.loadModularTools()
        await this.loadJsTools()
        this.initialized = true
        logger.debug(
            '[BuiltinMCP] 初始化完成:',
            this.tools.length,
            '内置工具,',
            this.modularTools.length,
            '模块化工具,',
            this.jsTools.size,
            'JS工具'
        )

        // 自动启动文件监听器
        this.startFileWatcher().catch(err => {
            logger.debug('[BuiltinMCP] 自动启动文件监听器失败:', err.message)
        })
    }

    /**
     * 加载分割后的模块化工具
     * @param {boolean} forceReload - 强制重新加载（热重载时使用）
     */
    async loadModularTools(forceReload = false) {
        try {
            // 动态导入，添加时间戳避免缓存
            const timestamp = forceReload ? Date.now() : ''
            const indexModule = await import(`./tools/index.js${timestamp ? `?t=${timestamp}` : ''}`)
            const { getAllTools, loadToolModules } = indexModule

            // 获取工具配置
            const builtinConfig = config.get('builtinTools') || {}
            const enabledCategories = builtinConfig.enabledCategories // 未设置则启用所有
            const disabledTools = builtinConfig.disabledTools || []

            // 加载工具（强制重载时传递 forceReload 参数）
            this.modularTools = await getAllTools({ enabledCategories, disabledTools, forceReload })

            // 获取类别信息
            const categories = await loadToolModules(forceReload)
            this.toolCategories = categories

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

        if (!this.toolCategories) {
            return categories
        }

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

    /**
     * 一键启用所有内部工具
     * @returns {Promise<{success: boolean, enabledCount: number}>}
     */
    async enableAllTools() {
        await config.set('builtinTools.enabled', true)
        await config.set('builtinTools.enabledCategories', Object.keys(this.toolCategories))
        await config.set('builtinTools.disabledTools', [])
        await this.loadModularTools()
        const enabledCount = this.modularTools.length + this.jsTools.size
        logger.info(`[BuiltinMCP] 一键启用所有工具: ${enabledCount} 个`)
        return { success: true, enabledCount }
    }

    /**
     * 一键禁用所有内部工具
     * @returns {Promise<{success: boolean, disabledCount: number}>}
     */
    async disableAllTools() {
        const allToolNames = this.modularTools.map(t => t.name)
        for (const [name] of this.jsTools) {
            allToolNames.push(name)
        }
        await config.set('builtinTools.disabledTools', allToolNames)
        await this.loadModularTools()
        logger.info(`[BuiltinMCP] 一键禁用所有工具: ${allToolNames.length} 个`)
        return { success: true, disabledCount: allToolNames.length }
    }

    /**
     * 热重载所有工具（模块化工具和JS工具）
     * @returns {Promise<{success: boolean, modularCount: number, jsCount: number}>}
     */
    async reloadAllTools() {
        logger.info('[BuiltinMCP] 开始热重载所有工具...')

        // 重新加载模块化工具（强制重载）
        this.modularTools = []
        await this.loadModularTools(true)

        // 重新加载JS工具
        await this.loadJsTools()

        const result = {
            success: true,
            modularCount: this.modularTools.length,
            jsCount: this.jsTools.size,
            totalCount: this.modularTools.length + this.jsTools.size
        }

        logger.info(`[BuiltinMCP] 热重载完成: ${result.modularCount} 模块化工具, ${result.jsCount} JS工具`)
        return result
    }

    /**
     * 获取工具启用状态统计
     * @returns {{total: number, enabled: number, disabled: number, categories: Object}}
     */
    getToolStats() {
        const builtinConfig = config.get('builtinTools') || {}
        const disabledTools = builtinConfig.disabledTools || []
        const enabledCategories = builtinConfig.enabledCategories || Object.keys(this.toolCategories)

        let total = 0
        let enabled = 0
        let disabled = 0
        const categoryStats = {}

        for (const [key, categoryConfig] of Object.entries(this.toolCategories)) {
            const isCategoryEnabled = enabledCategories.includes(key)
            const tools = categoryConfig.tools || []
            const categoryEnabled = tools.filter(t => isCategoryEnabled && !disabledTools.includes(t.name)).length
            const categoryDisabled = tools.length - categoryEnabled

            categoryStats[key] = {
                name: categoryConfig.name,
                total: tools.length,
                enabled: categoryEnabled,
                disabled: categoryDisabled,
                isCategoryEnabled
            }

            total += tools.length
            enabled += categoryEnabled
            disabled += categoryDisabled
        }

        // 统计JS工具
        const jsToolsEnabled = Array.from(this.jsTools.keys()).filter(name => !disabledTools.includes(name)).length
        const jsToolsDisabled = this.jsTools.size - jsToolsEnabled

        return {
            total: total + this.jsTools.size,
            enabled: enabled + jsToolsEnabled,
            disabled: disabled + jsToolsDisabled,
            categories: categoryStats,
            jsTools: {
                total: this.jsTools.size,
                enabled: jsToolsEnabled,
                disabled: jsToolsDisabled
            }
        }
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
     * 启动文件监听器，自动检测工具文件变化并热重载
     * 同时监听内置工具目录和自定义JS工具目录
     */
    async startFileWatcher() {
        if (this.fileWatchers.length > 0) {
            logger.debug('[BuiltinMCP] 文件监听器已在运行')
            return
        }

        // 需要监听的目录列表
        const watchDirs = [
            { path: path.join(__dirname, '../../data/tools'), name: 'JS工具目录' },
            { path: path.join(__dirname, './tools'), name: '内置工具目录' }
        ]

        // 处理文件变化的回调
        const handleFileChange = async (dirName, filename) => {
            if (!filename || !filename.endsWith('.js')) return

            // 防抖：避免短时间内多次触发重载
            if (this.reloadDebounceTimer) {
                clearTimeout(this.reloadDebounceTimer)
            }

            this.reloadDebounceTimer = setTimeout(async () => {
                logger.info(`[BuiltinMCP] 检测到${dirName}文件变化: ${filename}, 触发完全重载...`)
                try {
                    // 动态导入 mcpManager 避免循环依赖
                    const { mcpManager } = await import('./McpManager.js')
                    await mcpManager.reinit()
                    logger.info(`[BuiltinMCP] 完全重载完成`)
                } catch (err) {
                    logger.error('[BuiltinMCP] 完全重载失败:', err.message)
                }
            }, 500)
        }

        try {
            for (const dir of watchDirs) {
                // 确保目录存在
                if (!fs.existsSync(dir.path)) {
                    if (dir.path.includes('data/tools')) {
                        fs.mkdirSync(dir.path, { recursive: true })
                    } else {
                        logger.debug(`[BuiltinMCP] 目录不存在，跳过监听: ${dir.path}`)
                        continue
                    }
                }

                const watcher = fs.watch(dir.path, { persistent: false }, (eventType, filename) => {
                    handleFileChange(dir.name, filename)
                })

                this.fileWatchers.push({ watcher, path: dir.path, name: dir.name })
                logger.info(`[BuiltinMCP] 文件监听器已启动: ${dir.name} (${dir.path})`)
            }

            this.watcherEnabled = this.fileWatchers.length > 0
        } catch (err) {
            logger.error('[BuiltinMCP] 启动文件监听器失败:', err.message)
        }
    }

    /**
     * 停止文件监听器
     */
    stopFileWatcher() {
        if (this.fileWatchers.length > 0) {
            for (const { watcher, name } of this.fileWatchers) {
                try {
                    watcher.close()
                    logger.debug(`[BuiltinMCP] 已停止监听: ${name}`)
                } catch (e) {
                    logger.debug(`[BuiltinMCP] 停止监听失败: ${name}`, e.message)
                }
            }
            this.fileWatchers = []
            this.watcherEnabled = false
            logger.info('[BuiltinMCP] 所有文件监听器已停止')
        }
        if (this.reloadDebounceTimer) {
            clearTimeout(this.reloadDebounceTimer)
            this.reloadDebounceTimer = null
        }
    }

    /**
     * 获取文件监听器状态
     * @returns {{enabled: boolean, watchPaths: Array, jsToolsCount: number}}
     */
    getWatcherStatus() {
        return {
            enabled: this.watcherEnabled,
            watchPaths: this.fileWatchers.map(w => ({ path: w.path, name: w.name })),
            watchCount: this.fileWatchers.length,
            jsToolsCount: this.jsTools.size,
            modularToolsCount: this.modularTools.length
        }
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
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

        try {
            const runtime = await this.buildToolRuntime(ctx)
            const fn = new AsyncFunction(
                'args',
                'ctx',
                'fetch',
                'runtime',
                'Redis',
                'config',
                'logger',
                'Bot',
                'fs',
                'path',
                'crypto',
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
                get: id => knowledgeService.get(id),
                // 获取预设关联的知识库
                getForPreset: presetId => knowledgeService.getPresetKnowledge(presetId),
                // 构建知识库提示词
                buildPrompt: (presetId, options) => knowledgeService.buildKnowledgePrompt(presetId, options)
            },

            // 记忆快捷访问
            memory: {
                // 获取用户记忆
                get: async targetUserId => {
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
                delete: async memoryId => memoryManager.deleteMemory(memoryId)
            },

            // 上下文快捷访问
            conversation: {
                // 获取历史
                getHistory: async convId => {
                    const id = convId || conversationId
                    if (!id) return []
                    return contextManager.getContextHistory(id)
                },
                // 清除历史
                clear: async convId => {
                    const id = convId || conversationId
                    if (!id) return false
                    const historyManager = (await import('../core/utils/history.js')).default
                    await historyManager.deleteConversation(id)
                    return true
                },
                // 获取统计
                getStats: async convId => {
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
                sleep: ms => new Promise(r => setTimeout(r, ms)),
                // 生成 UUID
                uuid: () => crypto.randomUUID(),
                // 读取文件
                readFile: filePath => fs.readFileSync(filePath, 'utf-8'),
                // 写入文件
                writeFile: (filePath, content) => fs.writeFileSync(filePath, content),
                // 执行 shell 命令
                exec: async cmd => {
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
                        /wipefs/ // 擦除文件系统
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

        // 检查危险工具拦截
        // 兼容多种配置路径（面板/手动配置），并提供默认值
        const firstDefined = (...vals) => vals.find(v => v !== undefined)
        const allowDangerous = firstDefined(
            config.get('builtinTools.allowDangerous'),
            config.get('bots.default.builtinTools.allowDangerous'),
            config.get('tools.builtin.allowDangerous'),
            false
        )
        const dangerousTools =
            firstDefined(
                config.get('builtinTools.dangerousTools'),
                config.get('bots.default.builtinTools.dangerousTools'),
                config.get('tools.builtin.dangerousTools'),
                ['kick_member', 'mute_member', 'recall_message']
            ) || []
        const disabledTools =
            firstDefined(
                config.get('builtinTools.disabledTools'),
                config.get('bots.default.builtinTools.disabledTools'),
                config.get('tools.builtin.disabledTools'),
                []
            ) || []

        // 检查是否是被禁用的工具
        if (disabledTools.includes(name)) {
            logger.warn(`[BuiltinMCP] 工具 ${name} 已被禁用，拒绝执行`)
            return {
                content: [{ type: 'text', text: `工具 "${name}" 已被管理员禁用，无法执行` }],
                isError: true
            }
        }

        // 检查是否是危险工具且未允许危险操作
        if (dangerousTools.includes(name) && !allowDangerous) {
            logger.warn(`[BuiltinMCP] 危险工具 ${name} 被拦截，需要在设置中开启"允许危险操作"`)
            return {
                content: [
                    {
                        type: 'text',
                        text: `危险工具 "${name}" 已被拦截。此工具可能执行踢人、禁言、撤回等危险操作。如需使用，请在管理面板的"工具管理-高级设置"中开启"允许危险操作"选项。`
                    }
                ],
                isError: true,
                toolDisabled: true
            }
        }

        // 记录开始时间用于统计
        const startTime = Date.now()

        // 获取用户信息用于统计
        const event = ctx.getEvent?.()
        const userId = event?.user_id?.toString()
        const groupId = event?.group_id?.toString() || args?.group_id?.toString()
        const adminRequiredTools = [
            'kick_member',
            'mute_member',
            'mute_all',
            'set_group_admin',
            'set_group_card',
            'set_group_title',
            'set_group_name',
            'recall_message',
            'send_group_notice',
            'delete_group_notice'
        ]
        const ownerRequiredTools = ['set_group_admin', 'set_group_title']
        const targetPermCheckTools = ['kick_member', 'mute_member']
        if (groupId && (adminRequiredTools.includes(name) || ownerRequiredTools.includes(name))) {
            try {
                const bot = ctx.getBot?.() || ctx.bot || global.Bot
                const botPerm = await getBotPermission(bot, groupId)

                logger.debug(`[BuiltinMCP] Bot权限检查: 群${groupId}, role=${botPerm.role}, isAdmin=${botPerm.isAdmin}`)
                if (!botPerm.inGroup && botPerm.role === 'unknown') {
                    logger.warn(`[BuiltinMCP] 工具 ${name} 需要Bot在群内，但Bot可能不在该群`)
                }
                if (ownerRequiredTools.includes(name) && !botPerm.isOwner) {
                    logger.warn(`[BuiltinMCP] 工具 ${name} 需要群主权限，当前Bot权限: ${botPerm.role}`)
                    return this.formatResult(permissionDeniedError(name, '群主', botPerm.role || 'member'))
                }

                // 检查是否需要管理员权限
                if (adminRequiredTools.includes(name) && !botPerm.isAdmin) {
                    logger.warn(`[BuiltinMCP] 工具 ${name} 需要管理员权限，当前Bot权限: ${botPerm.role}`)
                    return this.formatResult(permissionDeniedError(name, '管理员', botPerm.role || 'member'))
                }

                // 检查目标用户权限（踢人/禁言不能对权限相同或更高的人操作）
                if (targetPermCheckTools.includes(name) && botPerm.isAdmin) {
                    const targetUserIds = []
                    // 收集所有目标用户ID
                    if (args?.user_id) targetUserIds.push(String(args.user_id))
                    if (args?.mutes && typeof args.mutes === 'object') {
                        targetUserIds.push(...Object.keys(args.mutes))
                    }
                    if (args?.user_ids && Array.isArray(args.user_ids)) {
                        targetUserIds.push(...args.user_ids.map(String))
                    }

                    // 检查每个目标用户的权限
                    for (const targetId of targetUserIds) {
                        const targetPerm = await this.getGroupMemberRole(bot, groupId, targetId)
                        if (targetPerm === 'owner') {
                            logger.warn(`[BuiltinMCP] 不能对群主(${targetId})执行 ${name}`)
                            return this.formatResult({
                                success: false,
                                error: `无法对群主(${targetId})执行此操作，群主权限最高`,
                                isError: true,
                                permissionDenied: true
                            })
                        }
                        if (targetPerm === 'admin' && !botPerm.isOwner) {
                            logger.warn(`[BuiltinMCP] 管理员不能对其他管理员(${targetId})执行 ${name}`)
                            return this.formatResult({
                                success: false,
                                error: `管理员无法对其他管理员(${targetId})执行此操作，只有群主可以`,
                                isError: true,
                                permissionDenied: true
                            })
                        }
                    }
                }
            } catch (e) {
                logger.debug(`[BuiltinMCP] 检查Bot权限失败: ${e.message}`)
            }
        }

        // 统计记录辅助函数
        const recordStats = async (result, error = null) => {
            try {
                const statsService = await getStatsService()
                if (statsService) {
                    await statsService.recordToolCallFull({
                        toolName: name,
                        request: args,
                        response: error ? { error: error.message } : result,
                        success: !error && !result?.isError,
                        error: error,
                        duration: Date.now() - startTime,
                        userId,
                        groupId,
                        source: 'builtin_mcp'
                    })
                }
            } catch (e) {
                logger.debug('[BuiltinMCP] 记录统计失败:', e.message)
            }
        }

        // 先检查是否是 JS 文件工具
        const jsTool = this.jsTools.get(name)
        if (jsTool) {
            logger.debug(`[BuiltinMCP] 调用JS工具: ${name}`)

            // 参数验证
            if (jsTool.inputSchema) {
                const validation = validateParams(args, jsTool.inputSchema, ctx)
                if (!validation.valid) {
                    logger.debug(`[BuiltinMCP] 参数验证失败: ${name} - ${validation.error}`)
                    const errorResult = paramError(validation)
                    await recordStats(errorResult, new Error(validation.error))
                    return this.formatResult(errorResult)
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
                await recordStats(result)
                return this.formatResult(result)
            } catch (error) {
                logger.error(`[BuiltinMCP] JS tool error: ${name}`, error)
                await recordStats(null, error)
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
                    const errorResult = paramError(validation)
                    await recordStats(errorResult, new Error(validation.error))
                    return this.formatResult(errorResult)
                }
            }

            try {
                const result = await this.executeCustomHandler(customTool.handler, args, ctx)
                await recordStats(result)
                return this.formatResult(result)
            } catch (error) {
                logger.error(`[BuiltinMCP] Custom tool error: ${name}`, error)
                await recordStats(null, error)
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
                    const errorResult = paramError(validation)
                    await recordStats(errorResult, new Error(validation.error))
                    return this.formatResult(errorResult)
                }
            }

            try {
                const result = await modularTool.handler(args, ctx)
                await recordStats(result)
                return this.formatResult(result)
            } catch (error) {
                logger.error(`[BuiltinMCP] Modular tool error: ${name}`, error)
                await recordStats(null, error)
                return {
                    content: [{ type: 'text', text: `Error: ${error.message}` }],
                    isError: true
                }
            }
        }
        const tool = this.tools.find(t => t.name === name)
        if (!tool) {
            await recordStats(null, new Error(`Tool not found: ${name}`))
            throw new Error(`Tool not found: ${name}`)
        }

        logger.debug(`[BuiltinMCP] 调用内置工具: ${name}`)

        // 参数验证
        if (tool.inputSchema) {
            const validation = validateParams(args, tool.inputSchema, ctx)
            if (!validation.valid) {
                logger.debug(`[BuiltinMCP] 参数验证失败: ${name} - ${validation.error}`)
                const errorResult = paramError(validation)
                await recordStats(errorResult, new Error(validation.error))
                return this.formatResult(errorResult)
            }
        }

        try {
            const result = await tool.handler(args, ctx)
            await recordStats(result)
            // 格式化为 MCP 标准响应
            return this.formatResult(result)
        } catch (error) {
            logger.error(`[BuiltinMCP] Tool error: ${name}`, error)
            await recordStats(null, error)
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
        // Bot权限缓存（避免重复查询）
        let _botPermissionCache = null

        // 如果直接传入了 isMaster（如管理面板测试），创建简化上下文
        if (requestContext && requestContext.isMaster !== undefined && !requestContext.event) {
            const adapterInfo =
                requestContext.adapterInfo ||
                (requestContext.adapter
                    ? {
                          adapter: requestContext.adapter,
                          isNT: requestContext.isNT ?? false,
                          canAiVoice: requestContext.canAiVoice ?? false
                      }
                    : null)
            return {
                getBot: () => global.Bot,
                getEvent: () => null,
                getAdapter: () => adapterInfo || { adapter: 'unknown', isNT: false, canAiVoice: false },
                isIcqq: () => adapterInfo?.adapter === 'icqq',
                isNapCat: () => adapterInfo?.adapter === 'napcat',
                isNT: () => adapterInfo?.isNT || false,
                bot: global.Bot,
                event: null,
                isMaster: requestContext.isMaster,
                isAdminTest: requestContext.isAdminTest || false,
                getBotPermission: async groupId => {
                    if (!groupId) return { role: 'unknown', isAdmin: false, isOwner: false, inGroup: false }
                    return await getBotPermission(global.Bot, groupId)
                },
                registerCallback: (id, cb) => toolContext.registerCallback(id, cb),
                executeCallback: (id, data) => toolContext.executeCallback(id, data)
            }
        }
        if (requestContext && requestContext.event) {
            const getBot = botId => {
                if (requestContext.bot) return requestContext.bot
                if (requestContext.event?.bot) return requestContext.event.bot
                const framework = getBotFramework()
                if (framework === 'trss' && botId && Bot.bots?.get) {
                    return Bot.bots.get(botId) || Bot
                }
                return Bot
            }
            let _adapterInfo =
                requestContext.adapterInfo ||
                (requestContext.adapter
                    ? {
                          adapter: requestContext.adapter,
                          isNT: requestContext.isNT ?? false,
                          canAiVoice: requestContext.canAiVoice ?? false
                      }
                    : null)
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
            const userId = requestContext.event?.user_id
            const groupId = requestContext.event?.group_id
            const isMasterUser = userId ? checkIsMaster(userId) : false

            // 获取Bot在当前群的权限（带缓存）
            const getBotPerm = async gid => {
                const targetGid = gid || groupId
                if (!targetGid) return { role: 'unknown', isAdmin: false, isOwner: false, inGroup: false }
                if (_botPermissionCache && _botPermissionCache.groupId === targetGid) {
                    return _botPermissionCache.permission
                }
                const permission = await getBotPermission(getBot(), targetGid)
                _botPermissionCache = { groupId: targetGid, permission }
                return permission
            }

            return {
                getBot,
                getEvent: () => requestContext.event,
                getAdapter,
                isIcqq: () => getAdapter().adapter === 'icqq',
                isNapCat: () => getAdapter().adapter === 'napcat',
                isNT: () => getAdapter().isNT,
                bot: getBot(),
                event: requestContext.event,
                isMaster: isMasterUser,
                groupId,
                userId,
                getBotPermission: getBotPerm,
                registerCallback: (id, cb) => toolContext.registerCallback(id, cb),
                executeCallback: (id, data) => toolContext.executeCallback(id, data)
            }
        }
        return toolContext
    }

    /**
     * 获取群成员的角色
     * @param {Object} bot - Bot实例
     * @param {number|string} groupId - 群号
     * @param {number|string} userId - 用户QQ
     * @returns {Promise<'owner'|'admin'|'member'|'unknown'>}
     */
    async getGroupMemberRole(bot, groupId, userId) {
        if (!bot || !groupId || !userId) return 'unknown'

        const gid = parseInt(groupId)
        const uid = parseInt(userId)

        try {
            // 方式1: 从群列表缓存获取群主信息
            const groupInfo = bot.gl?.get(gid)
            if (groupInfo?.owner_id === uid) {
                return 'owner'
            }

            // 方式2: 通过 pickGroup 获取成员信息
            if (bot.pickGroup) {
                try {
                    const group = bot.pickGroup(gid)
                    const memberInfo = group?.pickMember?.(uid)?.info
                    if (memberInfo?.role) {
                        return memberInfo.role
                    }
                    // 检查管理员列表
                    const admins = group?.admin_list || []
                    if (admins.includes(uid)) {
                        return 'admin'
                    }
                } catch (e) {
                    // 忽略
                }
            }

            // 方式3: OneBot API
            if (bot.sendApi) {
                try {
                    const info = await bot.sendApi('get_group_member_info', {
                        group_id: gid,
                        user_id: uid
                    })
                    const role = info?.data?.role || info?.role
                    if (role) return role
                } catch (e) {
                    // 忽略
                }
            }
        } catch (e) {
            logger.debug(`[BuiltinMCP] getGroupMemberRole error: ${e.message}`)
        }

        return 'member' // 默认返回普通成员
    }

    /**
     * 格式化工具结果为 MCP 标准格式
     * 增强错误检测：确保失败/禁用等情况正确标记为 isError
     */
    formatResult(result) {
        if (!result) {
            return { content: [{ type: 'text', text: 'No result' }], isError: true }
        }

        // 检查是否为错误结果
        const hasError = isToolResultError(result)

        if (result.content && Array.isArray(result.content)) {
            // 确保 isError 正确传递
            return {
                ...result,
                isError: result.isError === true || hasError
            }
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

        return {
            content,
            isError: hasError,
            // 保留原始错误信息供上层使用
            ...(result.error && { errorMessage: result.error }),
            ...(result.permissionDenied && { permissionDenied: true }),
            ...(result.toolDisabled && { toolDisabled: true })
        }
    }
    defineTools() {
        return []
    }
}
export const builtinMcpServer = new BuiltinMcpServer()
