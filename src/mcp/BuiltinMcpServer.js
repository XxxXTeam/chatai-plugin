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
    getGroupMemberRoleFromBot,
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

/** 单个回调在注册表中的存活时长（毫秒），到期未被触发即视为失效 */
const CALLBACK_TTL_MS = 10 * 60 * 1000

/** 回调注册表容量上限，超出时淘汰最早写入的条目 */
const MAX_CALLBACK_ENTRIES = 500

/**
 * 自定义工具单次执行的等待上限（毫秒）
 *
 * 只能约束**异步等待**：handler 里的同步死循环会独占事件循环，
 * 定时器回调根本得不到调度，Promise.race 也就无从生效——那种情况无法从外部打断，
 * 只能靠自定义工具的代码审查拦住。这里能保证的是：卡在网络、Redis、数据库等
 * 异步等待上的调用不会无限期占住 MCP 会话。
 * @type {number}
 */
const CUSTOM_TOOL_TIMEOUT_MS = 60000

/** 自定义工具运行时 http 助手的请求超时（毫秒） */
const RUNTIME_HTTP_TIMEOUT_MS = 30000

/**
 * 内置默认危险工具黑名单
 * 这些工具在 allowDangerous 关闭时始终被拦截，用户配置只能在此基础上追加，不能移除。
 * 之所以不允许移除：配置中 dangerousTools 常被写成空数组，若空数组直接覆盖默认值，
 * write_file / delete_file / execute_command 等将完全不受 allowDangerous 约束。
 * @type {string[]}
 */
export const DEFAULT_DANGEROUS_TOOLS = [
    'kick_member',
    'mute_member',
    'recall_message',
    'mute_all',
    'set_group_admin',
    'set_group_card',
    'set_group_title',
    'set_group_name',
    'send_group_notice',
    'delete_group_notice',
    'write_file',
    'delete_file',
    'move_file',
    'copy_file',
    'create_directory',
    'execute_command'
]

/**
 * 计算最终生效的危险工具名单：(内置默认 ∪ 用户新增) - 用户豁免
 *
 * 为什么需要豁免清单：用户配置的 dangerousTools 常态是空数组，若直接用它覆盖默认黑名单，
 * execute_command / write_file 等会全部失去保护（这正是本轮修复的缺陷）；但只取并集又会
 * 让面板上的「取消危险标记」永远不生效——默认项在下次读取时被并集加回来。
 * 因此把「用户想移除默认项」这个意图放进独立的 excluded 清单，语义清晰且两边都不失效。
 * @param {*} configured - 用户配置的 dangerousTools（用户额外标记为危险的工具），非数组时忽略
 * @param {*} excluded - 用户配置的 dangerousToolsExcluded（用户显式豁免的工具），非数组时忽略
 * @returns {string[]} 去重后的危险工具名单
 */
export function mergeDangerousTools(configured, excluded) {
    const toNameList = value => (Array.isArray(value) ? value.filter(name => typeof name === 'string') : [])
    const merged = new Set([...DEFAULT_DANGEROUS_TOOLS, ...toNameList(configured)])
    for (const name of toNameList(excluded)) merged.delete(name)
    return Array.from(merged)
}

/**
 * 从配置对象中解析出最终生效的危险工具名单
 * @param {Object} [builtinConfig] - builtinTools 配置节点
 * @returns {string[]} 去重后的危险工具名单
 */
export function resolveDangerousTools(builtinConfig = {}) {
    return mergeDangerousTools(builtinConfig?.dangerousTools, builtinConfig?.dangerousToolsExcluded)
}

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
     *
     * 回调闭包通常捕获整个 event / bot 对象，而原实现既无容量上限也无过期路径：
     * 只要回调没被触发就永久驻留，把它捕获的对象一起留在内存里
     * @param {string} id - 回调标识
     * @param {Function} callback - 回调函数
     * @returns {void}
     */
    registerCallback(id, callback) {
        this.callbacks.set(id, { callback, registeredAt: Date.now() })
        // 先写入再驱逐，稳态条目数严格不超过 MAX_CALLBACK_ENTRIES
        this.evictExpiredCallbacks()
    }

    /**
     * 清理过期回调，并在超出容量上限时淘汰最早写入的条目
     * @returns {void}
     */
    evictExpiredCallbacks() {
        const now = Date.now()
        for (const [key, entry] of this.callbacks) {
            if (now - entry.registeredAt > CALLBACK_TTL_MS) this.callbacks.delete(key)
        }
        // Map 保持插入顺序，超出上限时淘汰最早写入的条目
        while (this.callbacks.size > MAX_CALLBACK_ENTRIES) {
            const oldest = this.callbacks.keys().next().value
            if (oldest === undefined) break
            this.callbacks.delete(oldest)
        }
    }

    /**
     * 执行回调
     *
     * delete 放进 finally：原实现把它写在 await 之后，回调抛错时删除被整个跳过，
     * 失败的回调连同它捕获的上下文会永久留在注册表里
     * @param {string} id - 回调标识
     * @param {*} data - 传给回调的数据
     * @returns {Promise<*>} 回调返回值；无对应回调或已过期时为 null
     */
    async executeCallback(id, data) {
        const entry = this.callbacks.get(id)
        if (!entry) return null
        if (Date.now() - entry.registeredAt > CALLBACK_TTL_MS) {
            this.callbacks.delete(id)
            logger.debug(`[BuiltinMCP] 回调已过期，不再执行: ${id}`)
            return null
        }
        try {
            return await entry.callback(data)
        } finally {
            this.callbacks.delete(id)
        }
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
        /**
         * 保留字段：工具来源已全部迁移到 modularTools / jsTools / customTools，
         * 此处不再有任何读取点。仍保留声明是因为 McpManager.reinit() 会显式重置它，
         * 删除字段会让那行赋值变成凭空创建属性
         * @type {Array}
         */
        this.tools = []
        this.jsTools = new Map() // 存储 JS 文件加载的工具
        this.modularTools = [] // 分割后的模块化工具
        this.toolCategories = {} // 工具类别信息
        this.initialized = false
        /** @type {Promise<void>|null} 初始化在途 Promise，用于并发去重 */
        this.initPromise = null
        this.fileWatchers = [] // 文件监听器列表
        this.watcherEnabled = false
        this.reloadDebounceTimer = null
    }

    /**
     * 初始化服务器
     *
     * loadJsTools() 开头会 jsTools.clear()，而 initialized 只在全部加载完成后才置位：
     * 并发进入时（McpManager._connectServer、refreshBuiltinTools、文件监听触发的 reinit、面板操作）
     * 后一个调用的 clear() 会清空前一个正在填充的 Map，工具随机丢失。
     * 这里用 initPromise 做在途去重，并在结束后立即置空，
     * 这样 McpManager.reinit() 把 initialized 复位后仍能重新走一遍加载。
     * @returns {Promise<void>}
     */
    async init() {
        if (this.initialized) return
        if (this.initPromise) return this.initPromise
        this.initPromise = this._doInit().finally(() => {
            this.initPromise = null
        })
        return this.initPromise
    }

    /**
     * 实际的初始化流程，仅由 init() 调用
     * @returns {Promise<void>}
     */
    async _doInit() {
        await this.loadModularTools()
        await this.loadJsTools()
        this.initialized = true
        logger.debug('[BuiltinMCP] 初始化完成:', this.modularTools.length, '模块化工具,', this.jsTools.size, 'JS工具')

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
            let enabledCategories = builtinConfig.enabledCategories // 未设置则启用所有
            const disabledTools = builtinConfig.disabledTools || []

            // 先加载类别信息，用于检测新增分类
            const categories = await loadToolModules(forceReload)
            this.toolCategories = categories

            /*
             * 自动启用新增分类：当 enabledCategories 已持久化时，
             * 检测代码中新增的分类并自动加入启用列表，避免更新后需要手动启用
             */
            if (enabledCategories && Array.isArray(enabledCategories)) {
                const allCategoryKeys = Object.keys(categories)
                const newCategories = allCategoryKeys.filter(k => !enabledCategories.includes(k))
                if (newCategories.length > 0) {
                    enabledCategories = [...enabledCategories, ...newCategories]
                    await config.set('builtinTools.enabledCategories', enabledCategories)
                    logger.info(`[BuiltinMCP] 自动启用新增工具分类: ${newCategories.join(', ')}`)
                }
            }

            // 加载工具（强制重载时传递 forceReload 参数）
            this.modularTools = await getAllTools({ enabledCategories, disabledTools, forceReload })

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
        const mcpMatch = typeof toolName === 'string' ? toolName.match(/^mcp:([^:]+):(.+)$/) : null
        const directMatch = !mcpMatch && typeof toolName === 'string' ? toolName.match(/^([^:]+):([^:]+)$/) : null
        const plainName = mcpMatch?.[2] || directMatch?.[2] || toolName
        const serverName = mcpMatch?.[1] || directMatch?.[1]
        const equivalentNames = new Set([toolName, plainName])
        if (serverName && plainName) {
            equivalentNames.add(`${serverName}:${plainName}`)
            equivalentNames.add(`mcp:${serverName}:${plainName}`)
        }

        if (enabled) {
            disabledTools = disabledTools.filter(t => !equivalentNames.has(t))
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

                /*
                 * FSWatcher 在没有 'error' 监听者时会把错误当作未捕获异常抛出并终止整个进程。
                 * 目录被删除、被移动、inotify 句柄耗尽都会触发。
                 * 出错的监听器已经不可用，直接关闭并从列表移除，其余目录的监听不受影响。
                 */
                watcher.on('error', err => {
                    logger.error(`[BuiltinMCP] 文件监听器错误 (${dir.name}): ${err.message}`)
                    try {
                        watcher.close()
                    } catch (closeErr) {
                        logger.debug(`[BuiltinMCP] 关闭出错的监听器失败: ${closeErr.message}`)
                    }
                    this.fileWatchers = this.fileWatchers.filter(item => item.watcher !== watcher)
                    this.watcherEnabled = this.fileWatchers.length > 0
                })

                this.fileWatchers.push({ watcher, path: dir.path, name: dir.name })
                logger.debug(`[BuiltinMCP] 文件监听器已启动: ${dir.name} (${dir.path})`)
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
            logger.debug('[BuiltinMCP] 所有文件监听器已停止')
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
            /*
             * 这里原本还有一个 else 分支，在 modularTools 为空时从 this.tools 兜底取工具。
             * 但 this.tools 恒为空数组（defineTools() 只返回 [] 且全项目无调用点），
             * 该分支即使执行也只能返回空列表，并不构成"模块化工具加载失败时的降级能力"，
             * 只会让加载失败被静默掩盖。加载失败是需要暴露的故障，
             * 由 loadModularTools 的错误日志体现，不在这里伪装成正常空结果。
             */
            tools = this.modularTools.map(t => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
                isBuiltin: true,
                source: 'builtin',
                ...(t.dangerous !== undefined ? { dangerous: t.dangerous } : {}),
                ...(t.requireMaster !== undefined ? { requireMaster: t.requireMaster } : {}),
                ...(t.requiredPermission !== undefined ? { requiredPermission: t.requiredPermission } : {})
            }))
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
     *
     * 超时保护只覆盖异步等待：见 CUSTOM_TOOL_TIMEOUT_MS 的说明，
     * handler 内的同步死循环无法被 Promise.race 打断，这里不做该承诺
     * @param {string} handlerCode - 用户配置的 handler 函数体
     * @param {Object} args - 工具参数
     * @param {Object} ctx - 工具上下文
     * @returns {Promise<*>} handler 返回值
     * @throws {Error} handler 抛错或超出等待上限时抛出
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

            const execution = fn(
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
            /*
             * 超时后原 Promise 仍在后台跑（无法取消），它稍后 reject 会变成 unhandledRejection。
             * 这个静默订阅只用于兜底，不影响下面 race 对同一个 Promise 的正常订阅。
             */
            execution.catch(() => {})

            let timer = null
            const timeout = new Promise((_resolve, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`自定义工具执行超时（${CUSTOM_TOOL_TIMEOUT_MS}ms）`)),
                    CUSTOM_TOOL_TIMEOUT_MS
                )
            })

            try {
                return await Promise.race([execution, timeout])
            } finally {
                clearTimeout(timer)
            }
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
                // HTTP 请求（默认带超时，自定义工具可通过 options.signal 自行接管）
                http: {
                    get: async (url, options = {}) => {
                        const res = await fetch(url, {
                            method: 'GET',
                            ...options,
                            signal: options.signal ?? AbortSignal.timeout(RUNTIME_HTTP_TIMEOUT_MS)
                        })
                        return res.json()
                    },
                    post: async (url, data, options = {}) => {
                        const res = await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...options.headers },
                            body: JSON.stringify(data),
                            ...options,
                            signal: options.signal ?? AbortSignal.timeout(RUNTIME_HTTP_TIMEOUT_MS)
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
                    const { mcpManager } = await import('./McpManager.js')
                    const event = ctx?.getEvent?.()
                    const bot = ctx?.getBot?.()
                    const requestContext = event ? { event, bot } : null
                    return mcpManager.callTool(name, toolArgs, { context: requestContext })
                },
                listTools: async () => {
                    const { mcpManager } = await import('./McpManager.js')
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
        // 危险工具名单取"内置默认黑名单 ∪ 用户配置"。
        // 不能沿用 firstDefined：配置里的 dangerousTools 通常是空数组（而非 undefined），
        // 会立即短路掉默认黑名单，末尾的 `|| []` 也救不回来，导致拦截彻底失效。
        // 豁免清单与 dangerousTools 走同一套多路回退，保证两者取自同一层配置
        const dangerousTools = mergeDangerousTools(
            firstDefined(
                config.get('builtinTools.dangerousTools'),
                config.get('bots.default.builtinTools.dangerousTools'),
                config.get('tools.builtin.dangerousTools')
            ),
            firstDefined(
                config.get('builtinTools.dangerousToolsExcluded'),
                config.get('bots.default.builtinTools.dangerousToolsExcluded'),
                config.get('tools.builtin.dangerousToolsExcluded')
            )
        )
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
                        if (targetPerm === 'unknown') {
                            // 查不到目标身份时不能按"普通成员"处理，否则群主/管理员保护会被直接绕过
                            logger.warn(`[BuiltinMCP] 无法确认目标(${targetId})在群${groupId}的身份，已拒绝 ${name}`)
                            return this.formatResult({
                                success: false,
                                error: `无法确认目标用户(${targetId})的群内身份，出于安全考虑拒绝执行此操作（该用户可能不在群内，或协议端未返回成员信息）`,
                                isError: true,
                                permissionDenied: true
                            })
                        }
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
                /*
                 * 权限查询失败必须拒绝而不是放行。
                 * 能走到这个分支的全是踢人 / 禁言 / 全员禁言 / 改群名 / 设管理 一类危险操作，
                 * 原实现只记一条 debug 就继续往下执行，等于在"查不到权限"时无条件放行。
                 */
                logger.warn(`[BuiltinMCP] 工具 ${name} 的Bot权限检查失败，已拒绝执行: ${e.message}`)
                return this.formatResult({
                    success: false,
                    error: `无法确认Bot在群${groupId}的权限（${e.message}），出于安全考虑拒绝执行"${name}"`,
                    isError: true,
                    permissionDenied: true
                })
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
                    logger.debug(`[BuiltinMCP] 参数验证失败: ${name} - ${validation.error}`)
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
        /*
         * 走到这里说明 JS 工具 / 自定义工具 / 模块化工具三张表都没有这个名字。
         * 原本这之后还有一段从 this.tools 查找并执行的分支，但 this.tools 恒为空，
         * 那段代码永远不可达（见 listTools 中的同源说明），已随之删除。
         */
        await recordStats(null, new Error(`Tool not found: ${name}`))
        throw new Error(`Tool not found: ${name}`)
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
        try {
            return await getGroupMemberRoleFromBot(bot, groupId, userId)
        } catch (e) {
            logger.debug(`[BuiltinMCP] getGroupMemberRole error: ${e.message}`)
            // 查询失败返回 unknown 由调用方 fail-closed；返回 'member' 会让群主/管理员保护判定静默通过
            return 'unknown'
        }
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
}
export const builtinMcpServer = new BuiltinMcpServer()
