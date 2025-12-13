import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getBotFramework } from '../utils/bot.js'
import config from '../../config/config.js'
import { cleanCQCode } from '../utils/messageParser.js'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import TurndownService from 'turndown'
import common from '../../../../lib/common/common.js'
import fetch from 'node-fetch'
import { proxyService } from '../services/ProxyService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

puppeteer.use(StealthPlugin())

/**
 * 清理HTML，移除不需要的标签和属性
 * @param html
 * @returns {string}
 */
function cleanHTML(html) {
    // 保留原有的清理逻辑
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<link[^>]*>/gi, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '')

    // 其余清理逻辑保持不变
    const allowedTags = ['title', 'meta', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'img', 'video', 'audio', 'source', 'a']
    
    html = html.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (match, tagName, attrs) => {
        tagName = tagName.toLowerCase()
        if (allowedTags.includes(tagName)) {
            if (tagName === 'meta') {
                return match.replace(/<(meta)([^>]*)>/gi, (_, tag, attributes) => {
                    let allowedAttrs = attributes.match(/(charset|name|content)=["'][^"']+["']/gi)
                    return `<${tag} ${allowedAttrs ? allowedAttrs.join(' ') : ''}>`
                })
            } else if (tagName === 'img' || tagName === 'video' || tagName === 'audio' || tagName === 'source') {
                return match.replace(/<(img|video|audio|source)([^>]*)>/gi, (_, tag, attributes) => {
                    let srcMatch = attributes.match(/\bsrc=["'](?!data:)[^"']+["']/i)
                    return srcMatch ? `<${tag} ${srcMatch[0]}>` : ''
                })
            } else if (tagName === 'a') {
                return match.replace(/<a([^>]*)>/gi, (_, attributes) => {
                    let hrefMatch = attributes.match(/\bhref=["'](?!data:)[^"']+["']/i)
                    return hrefMatch ? `<a ${hrefMatch[0]}>` : ''
                })
            }
            return match
        }
        return ''
    })

    return html.replace(/\s+/g, ' ').trim()
}

/**
 * 将HTML转换为Markdown
 * @param html 清理后的HTML内容
 * @returns {string} Markdown文本
 */
function convertToMarkdown(html) {
    // 配置Turndown
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '_'
    })
    
    // 自定义规则，保留图片和链接
    turndownService.addRule('images', {
        filter: ['img'],
        replacement: function (content, node) {
            const alt = node.alt || ''
            const src = node.getAttribute('src') || ''
            return src ? `![${alt}](${src})` : ''
        }
    })
    
    // 转换HTML为Markdown
    return turndownService.turndown(html)
}

/**
 * 工具执行上下文
 */
class ToolContext {
    constructor() {
        this.bot = null
        this.event = null
        this.callbacks = new Map()
    }

    setContext(ctx) {
        if (ctx.bot) this.bot = ctx.bot
        if (ctx.event) this.event = ctx.event
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
        this.tools = this.defineTools()
        this.jsTools = new Map()  // 存储 JS 文件加载的工具
        this.initialized = false
    }

    /**
     * 初始化服务器
     */
    async init() {
        if (this.initialized) return
        await this.loadJsTools()
        this.initialized = true
        logger.debug('[BuiltinMCP] 初始化完成:', this.tools.length, '内置工具,', this.jsTools.size, 'JS工具')
    }

    /**
     * 加载 data/tools 目录下的 JS 工具文件
     * 支持热重载，通过添加时间戳避免模块缓存
     */
    async loadJsTools() {
        const toolsDir = path.join(__dirname, '../../data/tools')
        logger.debug(`[BuiltinMCP] 加载JS工具: ${toolsDir}`)
        
        // 清除旧工具
        this.jsTools.clear()
        
        if (!fs.existsSync(toolsDir)) {
            logger.debug(`[BuiltinMCP] 创建工具目录: ${toolsDir}`)
            fs.mkdirSync(toolsDir, { recursive: true })
            return
        }
        
        const allFiles = fs.readdirSync(toolsDir)
        // 排除 CustomTool.js 基类文件
        const files = allFiles.filter(f => f.endsWith('.js') && f !== 'CustomTool.js')
        logger.debug(`[BuiltinMCP] 发现 ${files.length} 个JS工具`)
        
        for (const file of files) {
            try {
                const filePath = path.join(toolsDir, file)
                logger.debug(`[BuiltinMCP] 加载: ${file}`)
                
                // 使用时间戳避免模块缓存，实现热重载
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
                    // 直接保存原始工具对象（保留原型方法），添加文件信息
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
        
        // 添加内置工具
        if (builtinConfig.enabled) {
            let builtinTools = [...this.tools]

            // 过滤允许的工具
            if (builtinConfig.allowedTools?.length > 0) {
                builtinTools = builtinTools.filter(t => builtinConfig.allowedTools.includes(t.name))
            }

            // 过滤禁用的工具
            if (builtinConfig.disabledTools?.length > 0) {
                builtinTools = builtinTools.filter(t => !builtinConfig.disabledTools.includes(t.name))
            }

            // 过滤危险工具
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

        // 添加自定义工具（YAML 配置）
        const customTools = this.getCustomTools()
        for (const ct of customTools) {
            tools.push({
                name: ct.name,
                description: ct.description,
                inputSchema: ct.inputSchema,
                isCustom: true
            })
        }
        
        // 添加 JS 文件工具
        for (const [name, tool] of this.jsTools) {
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
            // 构建丰富的执行环境
            const runtime = await this.buildToolRuntime(ctx)
            
            // 构建执行函数，提供完整的 API 访问
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
        // 动态导入服务
        const { redisClient } = await import('../core/cache/RedisClient.js')
        const { chatService } = await import('../services/ChatService.js')
        const { databaseService } = await import('../services/DatabaseService.js')
        const { memoryManager } = await import('../services/MemoryManager.js')
        const { channelManager } = await import('../services/ChannelManager.js')
        
        return {
            // 核心服务
            Redis: redisClient,
            config: config,
            logger: logger,
            Bot: ctx?.getBot?.() || global.Bot,
            
            // 服务访问
            services: {
                chat: chatService,
                database: databaseService,
                memory: memoryManager,
                channel: channelManager
            },
            
            // 工具函数
            utils: {
                // 发送群消息
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
                // 调用其他工具（传递当前请求上下文实现并发隔离）
                callTool: async (name, toolArgs) => {
                    const mcpManager = (await import('./McpManager.js')).default
                    // 从当前上下文提取 event 和 bot 构建请求级上下文
                    const event = ctx?.getEvent?.()
                    const bot = ctx?.getBot?.()
                    const requestContext = event ? { event, bot } : null
                    return mcpManager.callTool(name, toolArgs, { context: requestContext })
                },
                // 获取所有工具
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
     * @param {Object} requestContext - 请求级上下文（用于并发隔离）
     */
    async callTool(name, args, requestContext = null) {
        // 创建请求级上下文包装器，优先使用传入的上下文
        const ctx = this.createRequestContext(requestContext)
        
        // 先检查是否是 JS 文件工具
        const jsTool = this.jsTools.get(name)
        if (jsTool) {
            logger.debug(`[BuiltinMCP] 调用JS工具: ${name}`)
            try {
                // 设置上下文供工具使用
                const { asyncLocalStorage } = await import('../core/utils/helpers.js')
                const chaiteContext = {
                    getEvent: () => ctx.getEvent?.(),
                    getBot: () => ctx.getBot?.(),
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

        // 内置工具
        const tool = this.tools.find(t => t.name === name)
        if (!tool) {
            throw new Error(`Tool not found: ${name}`)
        }

        logger.debug(`[BuiltinMCP] 调用内置工具: ${name}`)

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
            return {
                getBot: (botId) => {
                    if (requestContext.bot) return requestContext.bot
                    if (requestContext.event?.bot) return requestContext.event.bot
                    const framework = getBotFramework()
                    if (framework === 'trss' && botId && Bot.bots?.get) {
                        return Bot.bots.get(botId) || Bot
                    }
                    return Bot
                },
                getEvent: () => requestContext.event,
                registerCallback: (id, cb) => toolContext.registerCallback(id, cb),
                executeCallback: (id, data) => toolContext.executeCallback(id, data)
            }
        }
        // 回退到全局上下文（兼容旧代码）
        return toolContext
    }

    /**
     * 格式化工具结果为 MCP 标准格式
     */
    formatResult(result) {
        if (!result) {
            return { content: [{ type: 'text', text: 'No result' }] }
        }

        // 已经是标准格式
        if (result.content && Array.isArray(result.content)) {
            return result
        }

        // 包含多媒体内容
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

        // 普通对象结果
        if (content.length === 0) {
            content.push({
                type: 'text',
                text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            })
        }

        return { content, isError: result.error ? true : false }
    }

    /**
     * 定义所有工具
     */
    defineTools() {
        return [
            // ==================== 基础工具 ====================
            {
                name: 'get_current_time',
                description: '获取当前时间和日期信息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        format: { 
                            type: 'string', 
                            description: '时间格式：full(完整)、date(仅日期)、time(仅时间)、timestamp(时间戳)',
                            enum: ['full', 'date', 'time', 'timestamp']
                        },
                        timezone: {
                            type: 'string',
                            description: '时区，默认 Asia/Shanghai'
                        }
                    }
                },
                handler: async (args) => {
                    const now = new Date()
                    const tz = args.timezone || 'Asia/Shanghai'
                    const format = args.format || 'full'
                    
                    const options = { timeZone: tz }
                    const dateStr = now.toLocaleDateString('zh-CN', { ...options, year: 'numeric', month: '2-digit', day: '2-digit' })
                    const timeStr = now.toLocaleTimeString('zh-CN', { ...options, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                    const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
                    
                    let result
                    switch (format) {
                        case 'date':
                            result = dateStr
                            break
                        case 'time':
                            result = timeStr
                            break
                        case 'timestamp':
                            result = now.getTime().toString()
                            break
                        default:
                            result = `${dateStr} ${timeStr} 星期${weekday}`
                    }
                    
                    return {
                        text: `当前时间: ${result}`,
                        datetime: now.toISOString(),
                        timestamp: now.getTime(),
                        formatted: result,
                        timezone: tz,
                        weekday: `星期${weekday}`
                    }
                }
            },

            // ==================== 工具列表工具 ====================
            {
                name: 'list_available_tools',
                description: '列出所有可用的工具及其描述',
                inputSchema: {
                    type: 'object',
                    properties: {
                        category: { type: 'string', description: '按类别筛选：user, group, message, file, image, admin, context' }
                    }
                },
                handler: async (args, ctx) => {
                    const allTools = this.listTools()
                    
                    // 工具分类
                    const categories = {
                        basic: ['get_current_time', 'list_available_tools'],
                        user: ['get_user_info', 'get_friend_list', 'send_like'],
                        group: ['get_group_info', 'get_group_list', 'get_group_member_list', 'get_group_member_info', 'get_group_files', 'get_file_url'],
                        message: ['send_private_message', 'send_group_message', 'reply_current_message', 'at_user', 'get_chat_history', 'get_current_context', 'get_reply_message', 'get_at_members', 'get_message_by_id', 'get_forward_message', 'make_forward_message', 'recall_message'],
                        file: ['parse_file', 'upload_group_file', 'delete_group_file', 'create_group_folder'],
                        image: ['parse_image', 'send_image', 'parse_video', 'send_video', 'get_avatar'],
                        admin: ['set_group_card', 'mute_member', 'kick_member', 'set_group_whole_ban', 'set_group_admin', 'set_group_name', 'set_group_special_title', 'send_group_notice', 'set_essence_message', 'remove_essence_message', 'handle_friend_request', 'handle_group_request'],
                        context: ['get_current_context', 'get_reply_message', 'get_at_members'],
                        bot: ['get_bot_status', 'set_online_status', 'send_poke'],
                        web: ['website']
                    }
                    
                    let tools = allTools
                    if (args.category && categories[args.category]) {
                        const categoryTools = categories[args.category]
                        tools = allTools.filter(t => categoryTools.includes(t.name))
                    }
                    
                    return {
                        success: true,
                        total: allTools.length,
                        filtered: tools.length,
                        categories: Object.keys(categories),
                        tools: tools.map(t => ({
                            name: t.name,
                            description: t.description
                        }))
                    }
                }
            },

            // ==================== 用户信息工具 ====================
            {
                name: 'get_user_info',
                description: '获取QQ用户的基本信息，包括昵称、头像、性别等',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', description: '用户的QQ号' }
                    },
                    required: ['user_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const userId = parseInt(args.user_id)

                    // 尝试获取好友信息
                    const friend = bot.fl?.get(userId)
                    if (friend) {
                        return {
                            success: true,
                            user_id: userId,
                            nickname: friend.nickname,
                            remark: friend.remark || '',
                            sex: friend.sex,
                            is_friend: true,
                            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                        }
                    }

                    // 尝试获取陌生人信息
                    try {
                        const stranger = await bot.getStrangerInfo(userId)
                        if (stranger) {
                            return {
                                success: true,
                                user_id: userId,
                                nickname: stranger.nickname,
                                sex: stranger.sex,
                                age: stranger.age,
                                is_friend: false,
                                avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                            }
                        }
                    } catch (e) {
                        // ignore
                    }

                    return { 
                        success: false, 
                        error: '无法获取用户信息，QQ号可能不存在', 
                        user_id: userId,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                    }
                }
            },

            {
                name: 'get_friend_list',
                description: '获取机器人的好友列表',
                inputSchema: {
                    type: 'object',
                    properties: {
                        limit: { type: 'number', description: '返回的最大数量，默认50' }
                    }
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const limit = args.limit || 50
                    const fl = bot.fl || new Map()

                    const friends = []
                    let count = 0
                    for (const [uid, friend] of fl) {
                        if (count >= limit) break
                        friends.push({
                            user_id: uid,
                            nickname: friend.nickname,
                            remark: friend.remark || ''
                        })
                        count++
                    }

                    return { success: true, total: fl.size, returned: friends.length, friends }
                }
            },

            // ==================== 群组信息工具 ====================
            {
                name: 'get_group_info',
                description: '获取群组的基本信息，包括群名、成员数量等。如果机器人不在该群，将返回有限信息。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' }
                    },
                    required: ['group_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const groupId = parseInt(args.group_id)
                    
                    // 从群列表获取信息（机器人已加入的群）
                    const groupInfo = bot.gl?.get(groupId)
                    if (groupInfo) {
                        return {
                            success: true,
                            group_id: groupId,
                            group_name: groupInfo.group_name,
                            member_count: groupInfo.member_count,
                            max_member_count: groupInfo.max_member_count,
                            owner_id: groupInfo.owner_id,
                            admin_flag: groupInfo.admin_flag,
                            create_time: groupInfo.create_time,
                            avatar_url: `https://p.qlogo.cn/gh/${groupId}/${groupId}/640`,
                            bot_in_group: true
                        }
                    }
                    
                    // 机器人不在该群，尝试获取有限信息
                    try {
                        const group = bot.pickGroup(groupId)
                        const info = group.info || {}
                        if (info.group_name || info.member_count) {
                            return {
                                success: true,
                                group_id: groupId,
                                group_name: info.group_name || '未知',
                                member_count: info.member_count || null,
                                max_member_count: info.max_member_count || null,
                                owner_id: info.owner_id || null,
                                avatar_url: `https://p.qlogo.cn/gh/${groupId}/${groupId}/640`,
                                bot_in_group: false,
                                note: '机器人不在此群内，信息可能不完整'
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                    
                    // 无法获取群信息
                    return {
                        success: false,
                        group_id: groupId,
                        error: '无法获取群信息，机器人可能不在此群内或群号不存在',
                        avatar_url: `https://p.qlogo.cn/gh/${groupId}/${groupId}/640`
                    }
                }
            },

            {
                name: 'get_group_list',
                description: '获取机器人加入的群列表',
                inputSchema: {
                    type: 'object',
                    properties: {
                        limit: { type: 'number', description: '返回的最大数量，默认50' }
                    }
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const limit = args.limit || 50
                    const gl = bot.gl || new Map()

                    const groups = []
                    let count = 0
                    for (const [gid, group] of gl) {
                        if (count >= limit) break
                        groups.push({
                            group_id: gid,
                            group_name: group.group_name,
                            member_count: group.member_count
                        })
                        count++
                    }

                    return { success: true, total: gl.size, returned: groups.length, groups }
                }
            },

            {
                name: 'get_group_member_list',
                description: '获取群成员列表。注意：只有机器人已加入的群才能获取成员列表。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        limit: { type: 'number', description: '返回的最大数量，默认100' }
                    },
                    required: ['group_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const groupId = parseInt(args.group_id)
                    const limit = args.limit || 100
                    
                    // 首先检查机器人是否在该群内
                    const groupInfo = bot.gl?.get(groupId)
                    if (!groupInfo) {
                        return {
                            success: false,
                            group_id: groupId,
                            total: 0,
                            returned: 0,
                            members: [],
                            error: '机器人不在此群内，无法获取成员列表。请确认群号正确且机器人已加入该群。'
                        }
                    }
                    
                    // 兼容多种 API
                    let memberList = []
                    try {
                        // 尝试 getGroupMemberList API
                        if (bot.getGroupMemberList) {
                            memberList = await bot.getGroupMemberList(groupId) || []
                        } else {
                            // 尝试 pickGroup + getMemberMap
                            const group = bot.pickGroup?.(groupId)
                            if (group?.getMemberMap) {
                                const memberMap = await group.getMemberMap()
                                for (const [uid, member] of memberMap) {
                                    memberList.push({ user_id: uid, ...member })
                                }
                            } else if (group?.getMemberList) {
                                memberList = await group.getMemberList() || []
                            }
                        }
                    } catch (e) {
                        return { 
                            success: false, 
                            error: `获取群成员列表失败: ${e.message}`, 
                            group_id: groupId,
                            total: 0,
                            returned: 0,
                            members: []
                        }
                    }

                    const members = memberList.slice(0, limit).map(m => ({
                        user_id: m.user_id || m.uid,
                        nickname: m.nickname || m.nick || '',
                        card: m.card || '',
                        role: m.role || 'member',
                        title: m.title || '',
                    }))

                    return { 
                        success: true,
                        group_id: groupId, 
                        group_name: groupInfo.group_name,
                        total: memberList.length, 
                        returned: members.length, 
                        members 
                    }
                }
            },

            {
                name: 'get_group_member_info',
                description: '获取群成员的详细信息。需要机器人在该群内才能获取。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        user_id: { type: 'string', description: '用户QQ号' }
                    },
                    required: ['group_id', 'user_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const groupId = parseInt(args.group_id)
                    const userId = parseInt(args.user_id)
                    
                    // 检查机器人是否在群内
                    const groupInfo = bot.gl?.get(groupId)
                    if (!groupInfo) {
                        return {
                            success: false,
                            group_id: groupId,
                            user_id: userId,
                            error: '机器人不在此群内，无法获取成员信息',
                            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                        }
                    }
                    
                    const group = bot.pickGroup(groupId)
                    
                    // 使用 pickMember 获取成员信息
                    const memberObj = group.pickMember(userId)
                    const member = memberObj.info || {}
                    
                    // 如果 info 为空，尝试从 getMemberMap 获取
                    if (!member.user_id) {
                        try {
                            const memberMap = await group.getMemberMap()
                            const memberData = memberMap.get(userId)
                            if (memberData) {
                                Object.assign(member, memberData)
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                    
                    // 检查是否获取到有效信息
                    if (!member.nickname && !member.card) {
                        return {
                            success: false,
                            group_id: groupId,
                            user_id: userId,
                            error: '该用户可能不在此群内',
                            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                        }
                    }

                    return {
                        success: true,
                        group_id: groupId,
                        user_id: userId,
                        nickname: member.nickname || '未知',
                        card: member.card || '',
                        role: member.role || 'member',
                        title: member.title || '',
                        level: member.level,
                        join_time: member.join_time,
                        last_sent_time: member.last_sent_time,
                        shutup_time: member.shutup_time,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                    }
                }
            },

            // ==================== 消息发送工具 ====================
            {
                name: 'send_private_message',
                description: '发送私聊消息给指定用户，支持文本、图片、视频',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', description: '目标用户的QQ号' },
                        message: { type: 'string', description: '文本消息内容' },
                        image_url: { type: 'string', description: '图片URL或base64（可选）' },
                        video_url: { type: 'string', description: '视频URL（可选）' }
                    },
                    required: ['user_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const userId = parseInt(args.user_id)
                        const friend = bot.pickFriend(userId)

                        const msgParts = []

                        if (args.message) {
                            msgParts.push(args.message)
                        }

                        if (args.image_url) {
                            msgParts.push(segment.image(args.image_url))
                        }

                        if (args.video_url) {
                            msgParts.push(segment.video(args.video_url))
                        }

                        if (msgParts.length === 0) {
                            return { success: false, error: '消息内容不能为空' }
                        }

                        const result = await friend.sendMsg(msgParts.length === 1 ? msgParts[0] : msgParts)
                        return { success: true, message_id: result.message_id, user_id: userId }
                    } catch (err) {
                        return { success: false, error: `发送私聊消息失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_group_message',
                description: '发送群消息，支持文本、图片、视频、@用户',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '目标群号' },
                        message: { type: 'string', description: '文本消息内容' },
                        at_user: { type: 'string', description: '要@的用户QQ号，"all"表示@全体' },
                        image_url: { type: 'string', description: '图片URL或base64（可选）' },
                        video_url: { type: 'string', description: '视频URL（可选）' }
                    },
                    required: ['group_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        // 检查机器人是否在群内
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内，无法发送消息' }
                        }
                        
                        const group = bot.pickGroup(groupId)

                        const msgParts = []

                        if (args.at_user) {
                            if (args.at_user === 'all') {
                                msgParts.push(segment.at('all'))
                            } else {
                                msgParts.push(segment.at(parseInt(args.at_user)))
                            }
                            msgParts.push(' ')
                        }

                        if (args.message) {
                            msgParts.push(args.message)
                        }

                        if (args.image_url) {
                            msgParts.push(segment.image(args.image_url))
                        }

                        if (args.video_url) {
                            msgParts.push(segment.video(args.video_url))
                        }

                        if (msgParts.length === 0) {
                            return { success: false, error: '消息内容不能为空' }
                        }

                        const result = await group.sendMsg(msgParts)
                        return { success: true, message_id: result.message_id, group_id: groupId, group_name: groupInfo.group_name }
                    } catch (err) {
                        return { success: false, error: `发送群消息失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'reply_current_message',
                description: '回复当前会话中的消息，支持文本、图片、视频、@用户',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: { type: 'string', description: '文本消息内容' },
                        quote: { type: 'boolean', description: '是否引用原消息' },
                        at_user: { type: 'string', description: '@指定用户的QQ号，设为 "sender" 表示@发送者' },
                        at_all: { type: 'boolean', description: '是否@全体成员（仅群聊有效）' },
                        image_url: { type: 'string', description: '图片URL或base64（可选）' },
                        video_url: { type: 'string', description: '视频URL（可选）' }
                    }
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '没有可用的会话上下文' }
                        }

                        const msgParts = []

                        // 处理 @全体
                        if (args.at_all && e.group_id) {
                            msgParts.push(segment.at('all'))
                        }

                        // 处理 @用户
                        if (args.at_user) {
                            const targetId = args.at_user === 'sender' ? e.user_id : args.at_user
                            msgParts.push(segment.at(targetId))
                        }

                        if (args.message) {
                            msgParts.push(args.message)
                        }

                        if (args.image_url) {
                            msgParts.push(segment.image(args.image_url))
                        }

                        if (args.video_url) {
                            msgParts.push(segment.video(args.video_url))
                        }

                        if (msgParts.length === 0) {
                            return { success: false, error: '消息内容不能为空' }
                        }

                        const result = await e.reply(msgParts, args.quote || false)
                        return { success: true, message_id: result?.message_id }
                    } catch (err) {
                        return { success: false, error: `回复消息失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_music',
                description: '发送音乐卡片分享。支持QQ音乐、网易云音乐、酷狗等平台，也支持自定义音乐。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: { 
                            type: 'string', 
                            enum: ['qq', '163', 'kugou', 'kuwo', 'migu', 'custom'],
                            description: '音乐平台类型：qq(QQ音乐)、163(网易云)、kugou(酷狗)、kuwo(酷我)、migu(咪咕)、custom(自定义)'
                        },
                        id: { type: 'string', description: '歌曲ID（非custom类型必填）' },
                        // custom类型的参数
                        url: { type: 'string', description: '自定义音乐：跳转链接' },
                        audio: { type: 'string', description: '自定义音乐：音频URL' },
                        title: { type: 'string', description: '自定义音乐：标题' },
                        singer: { type: 'string', description: '自定义音乐：歌手/描述' },
                        image: { type: 'string', description: '自定义音乐：封面图URL' }
                    },
                    required: ['type']
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '没有可用的会话上下文' }
                        }

                        let musicSeg
                        if (args.type === 'custom') {
                            if (!args.url || !args.audio || !args.title) {
                                return { success: false, error: '自定义音乐需要提供url、audio、title参数' }
                            }
                            musicSeg = segment.music('custom', {
                                url: args.url,
                                audio: args.audio,
                                title: args.title,
                                content: args.singer || '',
                                image: args.image || ''
                            })
                        } else {
                            if (!args.id) {
                                return { success: false, error: '平台音乐需要提供歌曲ID' }
                            }
                            musicSeg = segment.music(args.type, args.id)
                        }

                        const result = await e.reply(musicSeg)
                        return { success: true, message_id: result?.message_id, type: args.type }
                    } catch (err) {
                        return { success: false, error: `发送音乐卡片失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_voice',
                description: '发送语音消息。支持URL或本地文件路径。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', description: '语音文件URL、本地路径或base64' },
                        magic: { type: 'boolean', description: '是否变声（部分平台支持）' }
                    },
                    required: ['file']
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '没有可用的会话上下文' }
                        }

                        const recordSeg = {
                            type: 'record',
                            data: { 
                                file: args.file,
                                ...(args.magic ? { magic: true } : {})
                            }
                        }

                        const result = await e.reply(recordSeg)
                        return { success: true, message_id: result?.message_id }
                    } catch (err) {
                        return { success: false, error: `发送语音失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_file',
                description: '发送文件消息。支持URL或本地文件路径。仅群聊支持。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', description: '文件URL或本地路径' },
                        name: { type: 'string', description: '显示的文件名（可选）' }
                    },
                    required: ['file']
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        const bot = ctx.getBot()
                        if (!e) {
                            return { success: false, error: '没有可用的会话上下文' }
                        }

                        // 尝试多种方式发送文件
                        if (e.group_id) {
                            // 群文件
                            const group = bot?.pickGroup?.(e.group_id) || e.group
                            if (group?.sendFile) {
                                await group.sendFile(args.file, args.name)
                                return { success: true, file: args.file }
                            }
                            // NapCat/OneBot API
                            if (bot?.sendApi) {
                                await bot.sendApi('upload_group_file', {
                                    group_id: e.group_id,
                                    file: args.file,
                                    name: args.name || args.file.split('/').pop()
                                })
                                return { success: true, file: args.file }
                            }
                        } else {
                            // 私聊文件
                            const friend = bot?.pickFriend?.(e.user_id) || e.friend
                            if (friend?.sendFile) {
                                await friend.sendFile(args.file, args.name)
                                return { success: true, file: args.file }
                            }
                            // NapCat/OneBot API
                            if (bot?.sendApi) {
                                await bot.sendApi('upload_private_file', {
                                    user_id: e.user_id,
                                    file: args.file,
                                    name: args.name || args.file.split('/').pop()
                                })
                                return { success: true, file: args.file }
                            }
                        }

                        return { success: false, error: '当前平台不支持发送文件' }
                    } catch (err) {
                        return { success: false, error: `发送文件失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_video',
                description: '发送视频消息。支持URL或本地文件路径。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        file: { type: 'string', description: '视频文件URL或本地路径' },
                        thumb: { type: 'string', description: '视频缩略图URL（可选）' }
                    },
                    required: ['file']
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '没有可用的会话上下文' }
                        }

                        const videoSeg = segment.video(args.file, args.thumb)
                        const result = await e.reply(videoSeg)
                        return { success: true, message_id: result?.message_id }
                    } catch (err) {
                        return { success: false, error: `发送视频失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_link_card',
                description: '发送链接卡片消息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: '卡片标题' },
                        desc: { type: 'string', description: '卡片描述' },
                        url: { type: 'string', description: '跳转链接' },
                        image: { type: 'string', description: '预览图片URL（可选）' }
                    },
                    required: ['title', 'url']
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '没有可用的会话上下文' }
                        }

                        // 构建链接卡片JSON
                        const cardJson = {
                            app: 'com.tencent.structmsg',
                            desc: '',
                            view: 'news',
                            ver: '0.0.0.1',
                            prompt: args.title,
                            meta: {
                                news: {
                                    title: args.title,
                                    desc: args.desc || '',
                                    jumpUrl: args.url,
                                    preview: args.image || '',
                                    tag: '',
                                    tagIcon: ''
                                }
                            }
                        }

                        const cardSeg = segment.json(cardJson)
                        const result = await e.reply(cardSeg)
                        return { success: true, message_id: result?.message_id }
                    } catch (err) {
                        return { success: false, error: `发送链接卡片失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'at_user',
                description: '发送@用户的消息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', description: '要@的用户QQ号，设为 "sender" 表示@当前发送者，设为 "all" 表示@全体' },
                        message: { type: 'string', description: '附带的消息内容' }
                    },
                    required: ['user_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '没有可用的会话上下文' }
                        }

                        const msgParts = []
                        
                        // 确定要@的用户
                        let targetId = args.user_id
                        if (targetId === 'sender') {
                            targetId = e.user_id
                        }
                        
                        if (targetId === 'all') {
                            if (!e.group_id) {
                                return { success: false, error: '@全体仅在群聊中有效' }
                            }
                            msgParts.push(segment.at('all'))
                        } else {
                            msgParts.push(segment.at(targetId))
                        }

                        if (args.message) {
                            msgParts.push(' ' + args.message)
                        }

                        const result = await e.reply(msgParts)
                        return { success: true, message_id: result?.message_id, at_target: targetId }
                    } catch (err) {
                        return { success: false, error: `@用户失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'random_at_members',
                description: '随机@群成员并发送消息。可以指定数量、排除特定角色（如管理员、群主）。仅在群聊中有效。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        count: { type: 'number', description: '要随机选择的成员数量，默认1' },
                        message: { type: 'string', description: '附带的消息内容' },
                        exclude_admin: { type: 'boolean', description: '是否排除管理员，默认false' },
                        exclude_owner: { type: 'boolean', description: '是否排除群主，默认false' },
                        exclude_bot: { type: 'boolean', description: '是否排除机器人自己，默认true' },
                        exclude_users: { 
                            type: 'array', 
                            items: { type: 'string' },
                            description: '要排除的用户QQ号列表' 
                        }
                    }
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        const bot = ctx.getBot()
                        if (!e || !e.group_id) {
                            return { success: false, error: '此功能仅在群聊中有效' }
                        }

                        const count = args.count || 1
                        const excludeAdmin = args.exclude_admin || false
                        const excludeOwner = args.exclude_owner || false
                        const excludeBot = args.exclude_bot !== false  // 默认排除机器人
                        const excludeUsers = args.exclude_users || []
                        const botId = bot.uin || bot.self_id

                        // 获取群成员列表 - 优先使用 e.group (icqq 标准方式)
                        let memberList = []
                        try {
                            // 方式1: 使用 e.group.getMemberMap() (icqq 标准)
                            if (e.group?.getMemberMap) {
                                const memberMap = await e.group.getMemberMap()
                                if (memberMap instanceof Map) {
                                    for (const [uid, member] of memberMap) {
                                        memberList.push({ user_id: uid, ...member })
                                    }
                                } else if (memberMap && typeof memberMap === 'object') {
                                    for (const [uid, member] of Object.entries(memberMap)) {
                                        memberList.push({ user_id: Number(uid) || uid, ...member })
                                    }
                                }
                            }
                            // 方式2: 使用 bot.pickGroup
                            if (memberList.length === 0) {
                                const group = bot.pickGroup?.(e.group_id)
                                if (group?.getMemberMap) {
                                    const memberMap = await group.getMemberMap()
                                    if (memberMap instanceof Map) {
                                        for (const [uid, member] of memberMap) {
                                            memberList.push({ user_id: uid, ...member })
                                        }
                                    } else if (memberMap && typeof memberMap === 'object') {
                                        for (const [uid, member] of Object.entries(memberMap)) {
                                            memberList.push({ user_id: Number(uid) || uid, ...member })
                                        }
                                    }
                                }
                            }
                            // 方式3: bot.getGroupMemberList
                            if (memberList.length === 0 && bot.getGroupMemberList) {
                                const result = await bot.getGroupMemberList(e.group_id)
                                memberList = Array.isArray(result) ? result : []
                            }
                        } catch (err) {
                            return { success: false, error: `获取群成员列表失败: ${err.message}` }
                        }
                        
                        // 确保 memberList 是数组
                        if (!Array.isArray(memberList)) {
                            return { success: false, error: '获取群成员列表格式错误' }
                        }

                        // 过滤成员
                        let candidates = memberList.filter(m => {
                            const uid = String(m.user_id || m.uid)
                            const role = m.role || 'member'
                            
                            // 排除机器人自己
                            if (excludeBot && uid === String(botId)) return false
                            // 排除管理员
                            if (excludeAdmin && role === 'admin') return false
                            // 排除群主
                            if (excludeOwner && role === 'owner') return false
                            // 排除指定用户
                            if (excludeUsers.includes(uid)) return false
                            
                            return true
                        })

                        if (candidates.length === 0) {
                            return { success: false, error: '没有符合条件的群成员可供选择' }
                        }

                        // 随机选择
                        const selected = []
                        const actualCount = Math.min(count, candidates.length)
                        for (let i = 0; i < actualCount; i++) {
                            const randomIndex = Math.floor(Math.random() * candidates.length)
                            selected.push(candidates[randomIndex])
                            candidates.splice(randomIndex, 1)  // 避免重复选择
                        }

                        // 构建消息
                        const msgParts = []
                        for (const member of selected) {
                            msgParts.push(segment.at(member.user_id || member.uid))
                            msgParts.push(' ')
                        }
                        if (args.message) {
                            msgParts.push(args.message)
                        }

                        const result = await e.reply(msgParts)
                        return { 
                            success: true, 
                            message_id: result?.message_id,
                            selected_count: selected.length,
                            selected_members: selected.map(m => ({
                                user_id: String(m.user_id || m.uid),
                                nickname: m.nickname || m.nick || '',
                                card: m.card || ''
                            }))
                        }
                    } catch (err) {
                        return { success: false, error: `随机@成员失败: ${err.message}` }
                    }
                }
            },

            // ==================== 图片处理工具 ====================
            {
                name: 'parse_image',
                description: '解析图片内容，获取图片的base64数据和元信息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        image_url: { type: 'string', description: '图片URL' },
                        message_id: { type: 'string', description: '消息ID（从消息中提取图片）' }
                    }
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()

                    // 从当前消息中获取图片
                    if (!args.image_url && e?.img?.length > 0) {
                        const images = []
                        for (const img of e.img) {
                            try {
                                const url = img.url || img.file || img
                                const response = await fetch(url)
                                const buffer = await response.arrayBuffer()
                                const base64 = Buffer.from(buffer).toString('base64')
                                const contentType = response.headers.get('content-type') || 'image/png'

                                images.push({
                                    url,
                                    base64: `data:${contentType};base64,${base64}`,
                                    mimeType: contentType,
                                    size: buffer.byteLength
                                })
                            } catch (err) {
                                images.push({ url: img, error: err.message })
                            }
                        }
                        return {
                            success: true,
                            text: `解析到 ${images.length} 张图片`,
                            count: images.length,
                            images
                        }
                    }

                    // 从URL获取图片
                    if (args.image_url) {
                        try {
                            const response = await fetch(args.image_url)
                            const buffer = await response.arrayBuffer()
                            const base64 = Buffer.from(buffer).toString('base64')
                            const contentType = response.headers.get('content-type') || 'image/png'

                            return {
                                success: true,
                                text: '图片解析成功',
                                image: {
                                    url: args.image_url,
                                    base64: `data:${contentType};base64,${base64}`,
                                    mimeType: contentType,
                                    size: buffer.byteLength
                                }
                            }
                        } catch (err) {
                            return { success: false, error: `图片解析失败: ${err.message}` }
                        }
                    }

                    return { success: false, error: '没有可解析的图片' }
                }
            },

            {
                name: 'send_image',
                description: '发送图片到指定目标',
                inputSchema: {
                    type: 'object',
                    properties: {
                        target_type: { type: 'string', enum: ['private', 'group', 'current'], description: '目标类型' },
                        target_id: { type: 'string', description: '目标ID（私聊为QQ号，群聊为群号）' },
                        image_url: { type: 'string', description: '图片URL' },
                        image_base64: { type: 'string', description: '图片base64数据' },
                        image_path: { type: 'string', description: '本地图片路径' }
                    },
                    required: ['target_type']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const e = ctx.getEvent()

                        let imageSource = args.image_url || args.image_base64 || args.image_path
                        if (!imageSource) {
                            return { success: false, error: '需要提供图片来源（image_url/image_base64/image_path）' }
                        }

                        const imgSegment = segment.image(imageSource)

                        if (args.target_type === 'current' && e) {
                            const result = await e.reply(imgSegment)
                            return { success: true, message_id: result?.message_id }
                        }

                        if (args.target_type === 'private') {
                            if (!args.target_id) return { success: false, error: '私聊需要提供 target_id' }
                            const friend = bot.pickFriend(parseInt(args.target_id))
                            const result = await friend.sendMsg(imgSegment)
                            return { success: true, message_id: result.message_id, user_id: args.target_id }
                        }

                        if (args.target_type === 'group') {
                            if (!args.target_id) return { success: false, error: '群聊需要提供 target_id' }
                            const group = bot.pickGroup(parseInt(args.target_id))
                            const result = await group.sendMsg(imgSegment)
                            return { success: true, message_id: result.message_id, group_id: args.target_id }
                        }

                        return { success: false, error: '无效的目标类型，应为 private/group/current' }
                    } catch (err) {
                        return { success: false, error: `发送图片失败: ${err.message}` }
                    }
                }
            },

            // ==================== 视频处理工具 ====================
            {
                name: 'parse_video',
                description: '解析视频内容，获取视频信息和下载链接',
                inputSchema: {
                    type: 'object',
                    properties: {
                        video_url: { type: 'string', description: '视频URL' }
                    }
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()

                    // 从当前消息中获取视频
                    if (!args.video_url && e?.message) {
                        for (const msg of e.message) {
                            if (msg.type === 'video') {
                                return {
                                    success: true,
                                    text: '解析到视频',
                                    video: {
                                        url: msg.url || msg.file,
                                        file_id: msg.fid,
                                        mimeType: 'video/mp4'
                                    }
                                }
                            }
                        }
                    }

                    if (args.video_url) {
                        return {
                            success: true,
                            text: '视频信息',
                            video: {
                                url: args.video_url,
                                mimeType: 'video/mp4'
                            }
                        }
                    }

                    return { success: false, error: '没有可解析的视频' }
                }
            },

            {
                name: 'send_video',
                description: '发送视频到指定目标',
                inputSchema: {
                    type: 'object',
                    properties: {
                        target_type: { type: 'string', enum: ['private', 'group', 'current'], description: '目标类型' },
                        target_id: { type: 'string', description: '目标ID' },
                        video_url: { type: 'string', description: '视频URL' },
                        video_path: { type: 'string', description: '本地视频路径' }
                    },
                    required: ['target_type']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const e = ctx.getEvent()

                        let videoSource = args.video_url || args.video_path
                        if (!videoSource) {
                            return { success: false, error: '需要提供视频来源（video_url/video_path）' }
                        }

                        const videoSegment = segment.video(videoSource)

                        if (args.target_type === 'current' && e) {
                            const result = await e.reply(videoSegment)
                            return { success: true, message_id: result?.message_id }
                        }

                        if (args.target_type === 'private') {
                            if (!args.target_id) return { success: false, error: '私聊需要提供 target_id' }
                            const friend = bot.pickFriend(parseInt(args.target_id))
                            const result = await friend.sendMsg(videoSegment)
                            return { success: true, message_id: result.message_id, user_id: args.target_id }
                        }

                        if (args.target_type === 'group') {
                            if (!args.target_id) return { success: false, error: '群聊需要提供 target_id' }
                            const group = bot.pickGroup(parseInt(args.target_id))
                            const result = await group.sendMsg(videoSegment)
                            return { success: true, message_id: result.message_id, group_id: args.target_id }
                        }

                        return { success: false, error: '无效的目标类型，应为 private/group/current' }
                    } catch (err) {
                        return { success: false, error: `发送视频失败: ${err.message}` }
                    }
                }
            },

            // ==================== 文件处理工具 ====================
            {
                name: 'parse_file',
                description: '解析消息中的文件',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()
                    if (!e?.message) {
                        return { success: false, error: '没有可解析的消息' }
                    }

                    const files = []
                    for (const msg of e.message) {
                        if (msg.type === 'file') {
                            files.push({
                                name: msg.name,
                                size: msg.size,
                                url: msg.url,
                                file_id: msg.fid
                            })
                        }
                    }

                    if (files.length === 0) {
                        return { success: false, error: '消息中没有文件' }
                    }

                    return { success: true, text: `解析到 ${files.length} 个文件`, count: files.length, files }
                }
            },

            {
                name: 'get_group_files',
                description: '获取群文件列表',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        folder_id: { type: 'string', description: '文件夹ID，默认根目录' }
                    },
                    required: ['group_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        // 检查机器人是否在群内
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内，无法获取群文件' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        const gfs = group.fs

                        const folderId = args.folder_id || '/'
                        const files = await gfs.dir(folderId)

                        return {
                            success: true,
                            group_id: groupId,
                            group_name: groupInfo.group_name,
                            folder_id: folderId,
                            count: files.length,
                            files: files.map(f => ({
                                id: f.fid,
                                name: f.name,
                                size: f.size,
                                upload_time: f.upload_time,
                                uploader: f.uploader,
                                is_folder: f.is_dir
                            }))
                        }
                    } catch (err) {
                        return { success: false, error: `获取群文件列表失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'get_file_url',
                description: '获取群文件的下载链接',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        file_id: { type: 'string', description: '文件ID' }
                    },
                    required: ['group_id', 'file_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        const url = await group.fs.download(args.file_id)

                        return { success: true, group_id: groupId, file_id: args.file_id, url }
                    } catch (err) {
                        return { success: false, error: `获取文件下载链接失败: ${err.message}` }
                    }
                }
            },

            // ==================== 群聊历史记录工具 ====================
            {
                name: 'get_chat_history',
                description: '获取聊天历史记录',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['group', 'private', 'current'], description: '聊天类型' },
                        target_id: { type: 'string', description: '目标ID（群号或QQ号）' },
                        count: { type: 'number', description: '获取的消息数量，默认20' }
                    }
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const e = ctx.getEvent()
                        const count = args.count || 20

                        let target
                        let targetId
                        let chatType

                        if (args.type === 'current' && e) {
                            if (e.group_id) {
                                target = bot.pickGroup(e.group_id)
                                targetId = e.group_id
                                chatType = 'group'
                            } else {
                                target = bot.pickFriend(e.user_id)
                                targetId = e.user_id
                                chatType = 'private'
                            }
                        } else if (args.type === 'group') {
                            if (!args.target_id) return { success: false, error: '群聊需要提供 target_id' }
                            targetId = parseInt(args.target_id)
                            target = bot.pickGroup(targetId)
                            chatType = 'group'
                        } else if (args.type === 'private') {
                            if (!args.target_id) return { success: false, error: '私聊需要提供 target_id' }
                            targetId = parseInt(args.target_id)
                            target = bot.pickFriend(targetId)
                            chatType = 'private'
                        } else {
                            return { success: false, error: '无效的聊天类型，应为 group/private/current' }
                        }

                        const history = await target.getChatHistory(0, count)

                        const messages = history.map(msg => ({
                            message_id: msg.message_id,
                            user_id: msg.sender?.user_id,
                            nickname: msg.sender?.nickname,
                            card: msg.sender?.card || '',
                            time: msg.time,
                            raw_message: cleanCQCode(msg.raw_message || ''),
                            has_image: msg.message?.some(m => m.type === 'image'),
                            has_video: msg.message?.some(m => m.type === 'video')
                        }))

                        return { success: true, chat_type: chatType, target_id: targetId, count: messages.length, messages }
                    } catch (err) {
                        return { success: false, error: `获取聊天记录失败: ${err.message}` }
                    }
                }
            },

            // ==================== 群管理工具 ====================
            {
                name: 'set_group_card',
                description: '设置群成员的群名片',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        user_id: { type: 'string', description: '用户QQ号' },
                        card: { type: 'string', description: '新的群名片' }
                    },
                    required: ['group_id', 'user_id', 'card']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        const userId = parseInt(args.user_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        await group.setCard(userId, args.card)

                        return { success: true, group_id: groupId, user_id: userId, card: args.card }
                    } catch (err) {
                        return { success: false, error: `设置群名片失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'mute_member',
                description: '禁言群成员',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        user_id: { type: 'string', description: '用户QQ号' },
                        duration: { type: 'number', description: '禁言时长（秒），0表示解除禁言' }
                    },
                    required: ['group_id', 'user_id', 'duration']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        const userId = parseInt(args.user_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        
                        // icqq: group.muteMember(user_id, duration) 或 pickMember(uid).mute(duration)
                        if (typeof group.muteMember === 'function') {
                            await group.muteMember(userId, args.duration)
                        } else {
                            await group.pickMember(userId).mute(args.duration)
                        }

                        const action = args.duration > 0 ? `禁言 ${args.duration} 秒` : '解除禁言'
                        return { success: true, group_id: groupId, user_id: userId, duration: args.duration, action }
                    } catch (err) {
                        return { success: false, error: `禁言操作失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'kick_member',
                description: '踢出群成员',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        user_id: { type: 'string', description: '用户QQ号' },
                        reject_add: { type: 'boolean', description: '是否拒绝再次加群' }
                    },
                    required: ['group_id', 'user_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        const userId = parseInt(args.user_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        
                        // icqq: group.kickMember(user_id, block) 或 pickMember(uid).kick(block)
                        if (typeof group.kickMember === 'function') {
                            await group.kickMember(userId, args.reject_add || false)
                        } else {
                            await group.pickMember(userId).kick(args.reject_add || false)
                        }

                        return { success: true, group_id: groupId, user_id: userId, reject_add: args.reject_add || false }
                    } catch (err) {
                        return { success: false, error: `踢出成员失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'recall_message',
                description: '撤回消息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message_id: { type: 'string', description: '要撤回的消息ID' }
                    },
                    required: ['message_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        
                        // icqq: bot.deleteMsg 或 bot.recallMsg
                        if (typeof bot.deleteMsg === 'function') {
                            await bot.deleteMsg(args.message_id)
                        } else if (typeof bot.recallMsg === 'function') {
                            await bot.recallMsg(args.message_id)
                        } else {
                            return { success: false, error: '当前协议不支持撤回消息' }
                        }

                        return { success: true, message_id: args.message_id }
                    } catch (err) {
                        return { success: false, error: `撤回消息失败: ${err.message}` }
                    }
                }
            },

            // ==================== 互动工具 ====================
            {
                name: 'poke_user',
                description: '戳一戳用户（双击头像效果）。可在群聊或私聊中使用。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', description: '要戳的用户QQ号，不填则戳当前对话用户' },
                        group_id: { type: 'string', description: '群号（群聊戳一戳需要）' }
                    }
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const e = ctx.getEvent()
                        
                        const userId = args.user_id ? parseInt(args.user_id) : e?.user_id
                        const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                        
                        if (!userId) {
                            return { success: false, error: '无法确定要戳的用户' }
                        }
                        
                        if (groupId) {
                            // 群聊戳一戳
                            const group = bot.pickGroup(groupId)
                            if (typeof group?.pokeMember === 'function') {
                                await group.pokeMember(userId)
                            } else if (group?.pickMember) {
                                const member = group.pickMember(userId)
                                if (typeof member?.poke === 'function') {
                                    await member.poke()
                                } else {
                                    return { success: false, error: '当前协议不支持群聊戳一戳' }
                                }
                            } else {
                                return { success: false, error: '当前协议不支持群聊戳一戳' }
                            }
                            return { success: true, user_id: userId, group_id: groupId, message: `已戳了用户 ${userId}` }
                        } else {
                            // 私聊戳一戳
                            const friend = bot.pickFriend(userId)
                            if (typeof friend?.poke === 'function') {
                                await friend.poke()
                                return { success: true, user_id: userId, message: `已私聊戳了用户 ${userId}` }
                            } else {
                                return { success: false, error: '当前协议不支持私聊戳一戳' }
                            }
                        }
                    } catch (err) {
                        return { success: false, error: `戳一戳失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_like',
                description: '给用户点赞（发送名片赞）',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', description: '要点赞的用户QQ号，不填则给当前对话用户点赞' },
                        times: { type: 'number', description: '点赞次数（1-20），默认为10次' }
                    }
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const e = ctx.getEvent()
                        
                        const userId = args.user_id ? parseInt(args.user_id) : e?.user_id
                        const times = Math.min(Math.max(args.times || 10, 1), 20) // 限制1-20次
                        
                        if (!userId) {
                            return { success: false, error: '无法确定要点赞的用户' }
                        }
                        
                        // icqq: bot.sendLike(user_id, times)
                        // NapCat/OneBot: bot.send_like({ user_id, times })
                        if (typeof bot?.sendLike === 'function') {
                            await bot.sendLike(userId, times)
                        } else if (typeof bot?.send_like === 'function') {
                            await bot.send_like({ user_id: userId, times })
                        } else if (typeof bot?.pickFriend === 'function') {
                            const friend = bot.pickFriend(userId)
                            if (typeof friend?.thumbUp === 'function') {
                                await friend.thumbUp(times)
                            } else if (typeof friend?.sendLike === 'function') {
                                await friend.sendLike(times)
                            } else {
                                return { success: false, error: '当前协议不支持点赞' }
                            }
                        } else {
                            return { success: false, error: '当前协议不支持点赞' }
                        }
                        
                        return { success: true, user_id: userId, times, message: `已给用户 ${userId} 点赞 ${times} 次` }
                    } catch (err) {
                        return { success: false, error: `点赞失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'set_message_reaction',
                description: '给消息添加表情回应（贴表情）',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message_id: { type: 'string', description: '消息ID，不填则回应当前消息' },
                        emoji_id: { type: 'string', description: '表情ID，常用：76=赞、181=抱抱、307=恭喜、305=加油、312=鼓掌、124=酷、325=笑哭、310=666' },
                        is_add: { type: 'boolean', description: '是否添加表情（true添加，false取消），默认true' }
                    },
                    required: ['emoji_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const e = ctx.getEvent()
                        
                        const messageId = args.message_id || e?.message_id
                        const emojiId = parseInt(args.emoji_id)
                        const isAdd = args.is_add !== false
                        
                        if (!messageId) {
                            return { success: false, error: '无法确定要回应的消息' }
                        }
                        
                        // NapCat/go-cqhttp: bot.set_msg_emoji_like
                        if (typeof bot?.set_msg_emoji_like === 'function') {
                            await bot.set_msg_emoji_like({
                                message_id: messageId,
                                emoji_id: String(emojiId)
                            })
                            return { success: true, message_id: messageId, emoji_id: emojiId, action: isAdd ? 'add' : 'remove' }
                        }
                        
                        // icqq: group.setReaction
                        if (e?.group_id && bot?.pickGroup) {
                            const group = bot.pickGroup(e.group_id)
                            if (typeof group?.setReaction === 'function') {
                                await group.setReaction(e.seq || messageId, emojiId, isAdd ? 1 : 0)
                                return { success: true, message_id: messageId, emoji_id: emojiId, action: isAdd ? 'add' : 'remove' }
                            }
                        }
                        
                        return { success: false, error: '当前协议不支持表情回应' }
                    } catch (err) {
                        return { success: false, error: `表情回应失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'get_user_avatar',
                description: '获取用户头像URL',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', description: '用户QQ号，不填则获取当前对话用户头像' },
                        size: { type: 'number', description: '头像尺寸：40/100/140/640，默认640' }
                    }
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()
                    const userId = args.user_id || e?.user_id
                    const size = args.size || 640
                    
                    if (!userId) {
                        return { success: false, error: '无法确定用户' }
                    }
                    
                    const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=${size}`
                    return { 
                        success: true, 
                        user_id: userId, 
                        avatar_url: avatarUrl,
                        message: `用户 ${userId} 的头像地址: ${avatarUrl}`
                    }
                }
            },

            {
                name: 'get_group_avatar',
                description: '获取群头像URL',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号，不填则获取当前群头像' },
                        size: { type: 'number', description: '头像尺寸：40/100/140/640，默认640' }
                    }
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()
                    const groupId = args.group_id || e?.group_id
                    const size = args.size || 640
                    
                    if (!groupId) {
                        return { success: false, error: '无法确定群号' }
                    }
                    
                    const avatarUrl = `https://p.qlogo.cn/gh/${groupId}/${groupId}/${size}`
                    return { 
                        success: true, 
                        group_id: groupId, 
                        avatar_url: avatarUrl,
                        message: `群 ${groupId} 的头像地址: ${avatarUrl}`
                    }
                }
            },

            {
                name: 'send_music',
                description: '发送音乐卡片分享',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', description: '音乐平台：qq/163/kugou/migu/kuwo，默认qq' },
                        id: { type: 'string', description: '音乐ID（从平台URL获取）' },
                        title: { type: 'string', description: '歌曲标题（自定义音乐时使用）' },
                        singer: { type: 'string', description: '歌手名（自定义音乐时使用）' },
                        url: { type: 'string', description: '跳转链接（自定义音乐时使用）' },
                        audio: { type: 'string', description: '音频链接（自定义音乐时使用）' },
                        image: { type: 'string', description: '封面图片（自定义音乐时使用）' }
                    }
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '无法获取会话上下文' }
                        }
                        
                        let musicMsg
                        
                        if (args.id) {
                            // 平台音乐
                            const platform = args.type || 'qq'
                            musicMsg = { type: 'music', data: { type: platform, id: args.id } }
                        } else if (args.url && args.audio) {
                            // 自定义音乐
                            musicMsg = {
                                type: 'music',
                                data: {
                                    type: 'custom',
                                    url: args.url,
                                    audio: args.audio,
                                    title: args.title || '未知歌曲',
                                    singer: args.singer || '未知歌手',
                                    image: args.image || ''
                                }
                            }
                        } else {
                            return { success: false, error: '请提供音乐ID或自定义音乐信息（url和audio必填）' }
                        }
                        
                        await e.reply(musicMsg)
                        return { success: true, message: '音乐卡片已发送' }
                    } catch (err) {
                        return { success: false, error: `发送音乐失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_poke_message',
                description: '发送戳一戳消息（在聊天中发送戳一戳动作）',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', description: '要戳的用户QQ号' }
                    },
                    required: ['user_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '无法获取会话上下文' }
                        }
                        
                        const userId = parseInt(args.user_id)
                        
                        // 发送戳一戳消息段
                        const pokeMsg = { type: 'poke', data: { qq: userId } }
                        await e.reply(pokeMsg)
                        
                        return { success: true, user_id: userId, message: `已发送戳一戳给 ${userId}` }
                    } catch (err) {
                        return { success: false, error: `发送戳一戳消息失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_face',
                description: '发送QQ表情',
                inputSchema: {
                    type: 'object',
                    properties: {
                        face_id: { type: 'number', description: '表情ID，常用：0=惊讶、1=撇嘴、2=色、4=酷、5=流泪、6=害羞、7=闭嘴、8=睡、14=微笑、21=可爱、66=爱心、277=汪汪' },
                        text: { type: 'string', description: '附加的文字消息（可选）' }
                    },
                    required: ['face_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const e = ctx.getEvent()
                        if (!e) {
                            return { success: false, error: '无法获取会话上下文' }
                        }
                        
                        const msgs = []
                        if (args.text) {
                            msgs.push({ type: 'text', text: args.text })
                        }
                        msgs.push({ type: 'face', id: args.face_id })
                        
                        await e.reply(msgs)
                        return { success: true, face_id: args.face_id, message: '表情已发送' }
                    } catch (err) {
                        return { success: false, error: `发送表情失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'get_weather',
                description: '获取天气信息（需要联网）',
                inputSchema: {
                    type: 'object',
                    properties: {
                        city: { type: 'string', description: '城市名称，如"北京"、"上海"' }
                    },
                    required: ['city']
                },
                handler: async (args, ctx) => {
                    try {
                        // 使用 wttr.in 免费天气API
                        const city = encodeURIComponent(args.city)
                        const response = await fetch(`https://wttr.in/${city}?format=j1&lang=zh`)
                        if (!response.ok) {
                            return { success: false, error: `获取天气失败: ${response.status}` }
                        }
                        const data = await response.json()
                        const current = data.current_condition?.[0]
                        const location = data.nearest_area?.[0]
                        
                        if (!current) {
                            return { success: false, error: '无法解析天气数据' }
                        }
                        
                        return {
                            success: true,
                            city: location?.areaName?.[0]?.value || args.city,
                            temperature: `${current.temp_C}°C`,
                            feels_like: `${current.FeelsLikeC}°C`,
                            humidity: `${current.humidity}%`,
                            weather: current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value,
                            wind: `${current.winddir16Point} ${current.windspeedKmph}km/h`,
                            visibility: `${current.visibility}km`,
                            uv_index: current.uvIndex
                        }
                    } catch (err) {
                        return { success: false, error: `获取天气失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'search_music',
                description: '搜索音乐并返回结果',
                inputSchema: {
                    type: 'object',
                    properties: {
                        keyword: { type: 'string', description: '搜索关键词' },
                        platform: { type: 'string', description: '平台：qq/163/kugou，默认qq' }
                    },
                    required: ['keyword']
                },
                handler: async (args, ctx) => {
                    try {
                        const keyword = encodeURIComponent(args.keyword)
                        const platform = args.platform || 'qq'
                        
                        // 使用公共API搜索音乐
                        let apiUrl
                        if (platform === '163' || platform === 'netease') {
                            apiUrl = `https://music.163.com/api/search/get/web?s=${keyword}&type=1&limit=5`
                        } else {
                            // QQ音乐搜索
                            apiUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${keyword}&format=json&n=5`
                        }
                        
                        const response = await fetch(apiUrl, {
                            headers: { 'User-Agent': 'Mozilla/5.0' }
                        })
                        
                        if (!response.ok) {
                            return { success: false, error: '搜索失败' }
                        }
                        
                        const data = await response.json()
                        let songs = []
                        
                        if (platform === '163' || platform === 'netease') {
                            songs = (data.result?.songs || []).slice(0, 5).map(s => ({
                                id: s.id,
                                name: s.name,
                                artist: s.artists?.map(a => a.name).join('/') || '未知',
                                platform: '163'
                            }))
                        } else {
                            songs = (data.data?.song?.list || []).slice(0, 5).map(s => ({
                                id: s.songmid,
                                name: s.songname,
                                artist: s.singer?.map(a => a.name).join('/') || '未知',
                                platform: 'qq'
                            }))
                        }
                        
                        return {
                            success: true,
                            keyword: args.keyword,
                            platform,
                            count: songs.length,
                            songs,
                            tip: '使用 send_music 工具发送音乐，传入对应的 id 和 platform'
                        }
                    } catch (err) {
                        return { success: false, error: `搜索音乐失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'get_hitokoto',
                description: '获取一言（随机句子/名言）',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', description: '类型：a=动画、b=漫画、c=游戏、d=文学、e=原创、f=网络、g=其他、h=影视、i=诗词、j=网易云、k=哲学、l=抖机灵' }
                    }
                },
                handler: async (args, ctx) => {
                    try {
                        let url = 'https://v1.hitokoto.cn/?encode=json'
                        if (args.type) {
                            url += `&c=${args.type}`
                        }
                        
                        const response = await fetch(url)
                        if (!response.ok) {
                            return { success: false, error: '获取失败' }
                        }
                        
                        const data = await response.json()
                        return {
                            success: true,
                            hitokoto: data.hitokoto,
                            from: data.from || '未知',
                            from_who: data.from_who || '',
                            type: data.type
                        }
                    } catch (err) {
                        return { success: false, error: `获取一言失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'dice_roll',
                description: '掷骰子',
                inputSchema: {
                    type: 'object',
                    properties: {
                        dice: { type: 'string', description: '骰子表达式，如 "1d6"、"2d20"、"3d6+5"' },
                        times: { type: 'number', description: '投掷次数，默认1' }
                    },
                    required: ['dice']
                },
                handler: async (args, ctx) => {
                    try {
                        const diceExpr = args.dice.toLowerCase()
                        const times = Math.min(args.times || 1, 10)
                        
                        // 解析骰子表达式
                        const match = diceExpr.match(/^(\d*)d(\d+)([+-]\d+)?$/)
                        if (!match) {
                            return { success: false, error: '无效的骰子表达式，格式如: 1d6, 2d20+5' }
                        }
                        
                        const count = parseInt(match[1]) || 1
                        const sides = parseInt(match[2])
                        const modifier = parseInt(match[3]) || 0
                        
                        if (count > 100 || sides > 1000) {
                            return { success: false, error: '骰子数量或面数过大' }
                        }
                        
                        const results = []
                        for (let t = 0; t < times; t++) {
                            const rolls = []
                            for (let i = 0; i < count; i++) {
                                rolls.push(Math.floor(Math.random() * sides) + 1)
                            }
                            const sum = rolls.reduce((a, b) => a + b, 0) + modifier
                            results.push({
                                rolls,
                                modifier,
                                total: sum
                            })
                        }
                        
                        return {
                            success: true,
                            expression: args.dice,
                            times,
                            results,
                            summary: times === 1 
                                ? `${args.dice} = ${results[0].total}`
                                : results.map((r, i) => `#${i+1}: ${r.total}`).join(', ')
                        }
                    } catch (err) {
                        return { success: false, error: `掷骰子失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'random_choice',
                description: '从多个选项中随机选择',
                inputSchema: {
                    type: 'object',
                    properties: {
                        options: { 
                            type: 'array', 
                            items: { type: 'string' },
                            description: '选项列表' 
                        },
                        count: { type: 'number', description: '选择数量，默认1' }
                    },
                    required: ['options']
                },
                handler: async (args, ctx) => {
                    try {
                        const options = args.options
                        if (!options || options.length === 0) {
                            return { success: false, error: '请提供选项列表' }
                        }
                        
                        const count = Math.min(args.count || 1, options.length)
                        const shuffled = [...options].sort(() => Math.random() - 0.5)
                        const selected = shuffled.slice(0, count)
                        
                        return {
                            success: true,
                            total_options: options.length,
                            selected_count: count,
                            result: count === 1 ? selected[0] : selected
                        }
                    } catch (err) {
                        return { success: false, error: `随机选择失败: ${err.message}` }
                    }
                }
            },

            // ==================== 当前上下文工具 ====================
            {
                name: 'get_current_context',
                description: '获取当前会话的完整上下文信息',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()
                    if (!e) {
                        return { success: false, error: '没有可用的会话上下文' }
                    }

                    const context = {
                        success: true,
                        // 基本信息
                        user_id: e.user_id,
                        nickname: e.sender?.nickname,
                        card: e.sender?.card || '',
                        title: e.sender?.title || '',
                        role: e.sender?.role || '',  // owner, admin, member
                        level: e.sender?.level,
                        
                        // 群组信息
                        group_id: e.group_id || null,
                        group_name: e.group_name || null,
                        is_group: !!e.group_id,
                        is_private: !e.group_id,
                        
                        // 消息信息
                        message_id: e.message_id,
                        seq: e.seq,
                        rand: e.rand,
                        raw_message: cleanCQCode(e.raw_message || ''),
                        self_id: e.self_id,
                        time: e.time,
                        
                        // 特殊标记
                        atme: e.atme || false,
                        atall: e.atall || false,
                        
                        // 图片信息
                        has_image: e.img?.length > 0,
                        image_count: e.img?.length || 0,
                        image_urls: e.img || []
                    }

                    // 解析消息中的各种元素
                    if (e.message) {
                        context.elements = {
                            // 文本
                            text: e.message.filter(m => m.type === 'text').map(m => m.text).join(''),
                            // 图片
                            images: e.message.filter(m => m.type === 'image').map(m => ({
                                url: m.url,
                                file: m.file,
                                asface: m.asface  // 是否为表情
                            })),
                            // 视频
                            videos: e.message.filter(m => m.type === 'video').map(m => ({
                                url: m.url,
                                file: m.file,
                                name: m.name
                            })),
                            // 文件
                            files: e.message.filter(m => m.type === 'file').map(m => ({
                                name: m.name,
                                url: m.url,
                                size: m.size,
                                fid: m.fid
                            })),
                            // @列表
                            at_list: e.message.filter(m => m.type === 'at').map(m => ({
                                qq: m.qq,
                                text: m.text,
                                id: m.id
                            })),
                            // 表情
                            faces: e.message.filter(m => m.type === 'face').map(m => ({
                                id: m.id,
                                text: m.text
                            })),
                            // JSON卡片
                            json: e.message.filter(m => m.type === 'json').map(m => m.data),
                            // XML卡片
                            xml: e.message.filter(m => m.type === 'xml').map(m => m.data),
                            // 语音
                            record: e.message.filter(m => m.type === 'record').map(m => ({
                                url: m.url,
                                file: m.file
                            })),
                            // 戳一戳
                            poke: e.message.find(m => m.type === 'poke'),
                            // 红包
                            redbag: e.message.find(m => m.type === 'redbag')
                        }
                    }

                    // 引用消息
                    if (e.source) {
                        context.reply_to = {
                            message_id: e.source.message_id || e.source.seq,
                            user_id: e.source.user_id,
                            nickname: e.source.nickname,
                            message: e.source.message,
                            raw_message: cleanCQCode(e.source.raw_message || ''),
                            time: e.source.time,
                            seq: e.source.seq
                        }
                    }

                    return context
                }
            },

            {
                name: 'get_reply_message',
                description: '获取当前消息引用/回复的原消息详情，支持多平台(icqq/NC/TRSS)',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()
                    const parseLog = [] // 解析日志
                    
                    if (!e) {
                        return { success: false, error: '没有可用的会话上下文' }
                    }

                    // NC/NapCat 兼容: 检查多种引用消息来源
                    // icqq: e.source
                    // NC: e.reply 或 message 中的 reply 段
                    let source = e.source
                    let replyMsgId = null
                    
                    parseLog.push(`[GetReply] 开始解析, hasSource=${!!source}, hasReply=${!!e.reply}, reply_id=${e.reply_id || 'none'}`)
                    
                    // 尝试从 message 中获取 reply 段 (NC 格式)
                    if (!source && e.message) {
                        const replySegment = e.message.find(m => m.type === 'reply')
                        if (replySegment) {
                            // NC 格式: { type: 'reply', data: { id: 'xxx' } }
                            replyMsgId = replySegment.data?.id || replySegment.id
                            parseLog.push(`[GetReply] 从 message 中找到 reply 段, id=${replyMsgId}`)
                        }
                    }
                    
                    // 使用 e.reply_id (部分平台)
                    if (!source && !replyMsgId && e.reply_id) {
                        replyMsgId = e.reply_id
                        parseLog.push(`[GetReply] 使用 e.reply_id=${replyMsgId}`)
                    }

                    if (!source && !replyMsgId) {
                        logger.debug('[GetReply] 当前消息没有引用')
                        return { success: true, has_reply: false, message: '当前消息没有引用其他消息' }
                    }

                    const bot = ctx.getBot()

                    // 尝试获取完整的引用消息 - 多种方式回退
                    let fullMessage = null
                    const tryMethods = []
                    
                    // 方式1: 使用 e.getReply() (TRSS/部分平台)
                    if (!fullMessage && typeof e.getReply === 'function') {
                        try {
                            parseLog.push(`[GetReply] 尝试 e.getReply()`)
                            fullMessage = await e.getReply()
                            if (fullMessage) {
                                tryMethods.push('e.getReply()')
                                parseLog.push(`[GetReply] e.getReply() 成功`)
                            }
                        } catch (err) {
                            parseLog.push(`[GetReply] e.getReply() 失败: ${err.message}`)
                        }
                    }
                    
                    // 方式2: 使用 group.getMsg() 通过 source.seq
                    if (!fullMessage && source?.seq && e.group_id) {
                        try {
                            parseLog.push(`[GetReply] 尝试 group.getMsg(seq=${source.seq})`)
                            const group = bot.pickGroup(e.group_id)
                            fullMessage = await group.getMsg(source.seq)
                            if (fullMessage) {
                                tryMethods.push('group.getMsg(seq)')
                                parseLog.push(`[GetReply] group.getMsg(seq) 成功`)
                            }
                        } catch (err) {
                            parseLog.push(`[GetReply] group.getMsg(seq) 失败: ${err.message}`)
                        }
                    }
                    
                    // 方式3: 使用 group.getMsg() 通过 message_id
                    if (!fullMessage && (source?.message_id || replyMsgId) && e.group_id) {
                        const msgId = source?.message_id || replyMsgId
                        try {
                            parseLog.push(`[GetReply] 尝试 group.getMsg(id=${msgId})`)
                            const group = bot.pickGroup(e.group_id)
                            fullMessage = await group.getMsg(msgId)
                            if (fullMessage) {
                                tryMethods.push('group.getMsg(id)')
                                parseLog.push(`[GetReply] group.getMsg(id) 成功`)
                            }
                        } catch (err) {
                            parseLog.push(`[GetReply] group.getMsg(id) 失败: ${err.message}`)
                        }
                    }
                    
                    // 方式4: 使用 group.getChatHistory 通过 seq
                    if (!fullMessage && source?.seq && e.group_id && bot.pickGroup) {
                        try {
                            parseLog.push(`[GetReply] 尝试 group.getChatHistory(seq=${source.seq})`)
                            const group = bot.pickGroup(e.group_id)
                            if (group.getChatHistory) {
                                const history = await group.getChatHistory(source.seq, 1)
                                fullMessage = history?.pop?.() || history?.[0]
                                if (fullMessage) {
                                    tryMethods.push('group.getChatHistory')
                                    parseLog.push(`[GetReply] group.getChatHistory 成功`)
                                }
                            }
                        } catch (err) {
                            parseLog.push(`[GetReply] group.getChatHistory 失败: ${err.message}`)
                        }
                    }
                    
                    // 方式5: 使用 bot.getMsg() (NC 全局方法)
                    if (!fullMessage && replyMsgId && bot.getMsg) {
                        try {
                            parseLog.push(`[GetReply] 尝试 bot.getMsg(id=${replyMsgId})`)
                            fullMessage = await bot.getMsg(replyMsgId)
                            if (fullMessage) {
                                tryMethods.push('bot.getMsg')
                                parseLog.push(`[GetReply] bot.getMsg 成功`)
                            }
                        } catch (err) {
                            parseLog.push(`[GetReply] bot.getMsg 失败: ${err.message}`)
                        }
                    }
                    
                    // 方式6: 私聊消息
                    if (!fullMessage && !e.group_id && e.user_id) {
                        const msgId = source?.seq || source?.message_id || source?.time || replyMsgId
                        if (msgId) {
                            try {
                                parseLog.push(`[GetReply] 尝试 friend.getMsg(id=${msgId})`)
                                const friend = bot.pickFriend(e.user_id)
                                fullMessage = await friend.getMsg(msgId)
                                if (fullMessage) {
                                    tryMethods.push('friend.getMsg')
                                    parseLog.push(`[GetReply] friend.getMsg 成功`)
                                }
                            } catch (err) {
                                parseLog.push(`[GetReply] friend.getMsg 失败: ${err.message}`)
                            }
                        }
                    }
                    
                    // 输出解析日志
                    logger.debug('[GetReply]', parseLog.join(' | '))
                    
                    // 合并 source 和 fullMessage 的信息
                    const finalSource = source || {}
                    const finalMsg = fullMessage || {}
                    
                    // 兼容 NC 格式: message 可能在 data 字段中
                    const msgData = finalMsg.data || finalMsg
                    
                    // 提取用户信息 - 兼容多种格式
                    const userId = finalSource.user_id || msgData.user_id || msgData.sender?.user_id || finalMsg.user_id
                    const nickname = finalSource.nickname || msgData.sender?.nickname || msgData.sender?.card || 
                                     msgData.nickname || finalMsg.nickname || '未知'
                    
                    // 提取消息内容 - 兼容多种格式
                    let msgArray = finalSource.message || msgData.message || finalMsg.message || []
                    
                    // NC 格式可能是 content
                    if (!Array.isArray(msgArray) || msgArray.length === 0) {
                        msgArray = msgData.content || finalMsg.content || []
                    }
                    
                    // 确保是数组
                    if (!Array.isArray(msgArray)) {
                        msgArray = []
                    }
                    
                    // 解析消息内容 - 兼容 NC 格式
                    const parseMessageContent = (msgArray) => {
                        const result = {
                            text: '',
                            has_image: false,
                            images: [],
                            has_file: false,
                            files: [],
                            has_video: false,
                            videos: [],
                            has_json: false,
                            json_cards: [],
                            has_forward: false,
                            forward_id: null
                        }
                        
                        for (const m of msgArray) {
                            // NC 格式: { type: 'xxx', data: {...} }
                            const mData = m.data || m
                            const mType = m.type || ''
                            
                            if (mType === 'text') {
                                result.text += mData.text || mData || ''
                            } else if (mType === 'image') {
                                result.has_image = true
                                result.images.push(mData.url || mData.file || m.url || m.file || '')
                            } else if (mType === 'file') {
                                result.has_file = true
                                result.files.push({ 
                                    name: mData.name || m.name, 
                                    fid: mData.fid || m.fid, 
                                    size: mData.size || m.size 
                                })
                            } else if (mType === 'video') {
                                result.has_video = true
                                result.videos.push({ 
                                    url: mData.url || m.url, 
                                    file: mData.file || m.file, 
                                    name: mData.name || m.name 
                                })
                            } else if (mType === 'json') {
                                result.has_json = true
                                try {
                                    const jsonStr = mData.data || m.data || '{}'
                                    const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
                                    result.json_cards.push({ app: data.app, desc: data.desc, prompt: data.prompt })
                                    // 检查是否是转发消息
                                    if (data.app === 'com.tencent.multimsg') {
                                        result.has_forward = true
                                        result.forward_id = data.meta?.detail?.resid
                                    }
                                } catch { 
                                    result.json_cards.push({ raw: String(mData.data || m.data || '').substring(0, 200) }) 
                                }
                            } else if (mType === 'forward') {
                                result.has_forward = true
                                result.forward_id = mData.id || m.id || mData.resid || m.resid
                            }
                        }
                        
                        return result
                    }
                    
                    const content = parseMessageContent(msgArray)
                    
                    return {
                        success: true,
                        has_reply: true,
                        message_id: finalSource.message_id || msgData.message_id || finalMsg.message_id || replyMsgId,
                        user_id: userId,
                        nickname: nickname,
                        time: finalSource.time || msgData.time || finalMsg.time,
                        seq: finalSource.seq || msgData.seq || finalMsg.seq,
                        raw_message: cleanCQCode(finalSource.raw_message || msgData.raw_message || finalMsg.raw_message || ''),
                        message: msgArray,
                        content: content,
                        // 调试信息
                        _debug: {
                            methods_tried: tryMethods,
                            has_source: !!source,
                            has_full_message: !!fullMessage,
                            reply_msg_id: replyMsgId
                        }
                    }
                }
            },

            {
                name: 'get_at_members',
                description: '获取当前消息中@的所有成员信息',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()
                    const bot = ctx.getBot()
                    
                    if (!e?.message) {
                        return { success: false, error: '没有可用的消息' }
                    }

                    const atList = e.message.filter(m => m.type === 'at')
                    if (atList.length === 0) {
                        return { success: true, at_count: 0, members: [], atme: e.atme || false, atall: e.atall || false }
                    }

                    const members = []
                    for (const at of atList) {
                        const userId = at.qq
                        let memberInfo = { user_id: userId, text: at.text }

                        // 尝试获取更多信息
                        if (e.group_id && userId !== 'all') {
                            try {
                                const group = bot.pickGroup(e.group_id)
                                const member = await group.getMemberInfo(parseInt(userId))
                                if (member) {
                                    memberInfo.nickname = member.nickname
                                    memberInfo.card = member.card
                                    memberInfo.role = member.role
                                    memberInfo.title = member.title
                                }
                            } catch (err) {
                                // ignore
                            }
                        }

                        members.push(memberInfo)
                    }

                    return {
                        success: true,
                        at_count: members.length,
                        atme: e.atme || false,
                        atall: e.atall || false,
                        members
                    }
                }
            },

            {
                name: 'get_message_by_id',
                description: '根据消息ID获取消息详情',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message_id: { type: 'string', description: '消息ID或seq' },
                        group_id: { type: 'string', description: '群号（群消息必填）' },
                        user_id: { type: 'string', description: '用户QQ号（私聊消息必填）' }
                    },
                    required: ['message_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const e = ctx.getEvent()

                    try {
                        let msg
                        const msgId = args.message_id

                        if (args.group_id) {
                            const group = bot.pickGroup(parseInt(args.group_id))
                            msg = await group.getMsg(msgId)
                        } else if (args.user_id) {
                            const friend = bot.pickFriend(parseInt(args.user_id))
                            msg = await friend.getMsg(msgId)
                        } else if (e?.group_id) {
                            const group = bot.pickGroup(e.group_id)
                            msg = await group.getMsg(msgId)
                        } else if (e?.user_id) {
                            const friend = bot.pickFriend(e.user_id)
                            msg = await friend.getMsg(msgId)
                        } else {
                            return { error: '需要提供 group_id 或 user_id' }
                        }

                        if (!msg) {
                            return { success: false, error: '消息不存在或已过期' }
                        }

                        return {
                            success: true,
                            message_id: msg.message_id,
                            user_id: msg.sender?.user_id,
                            nickname: msg.sender?.nickname,
                            card: msg.sender?.card,
                            time: msg.time,
                            seq: msg.seq,
                            raw_message: cleanCQCode(msg.raw_message || ''),
                            message: msg.message
                        }
                    } catch (err) {
                        return { success: false, error: '获取消息失败: ' + err.message }
                    }
                }
            },

            {
                name: 'get_forward_message',
                description: '获取合并转发消息的内容，支持多平台(icqq/NC/TRSS)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        res_id: { type: 'string', description: '转发消息的res_id或message_id' },
                        group_id: { type: 'string', description: '群号（可选，用于回退获取）' }
                    },
                    required: ['res_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const e = ctx.getEvent()
                    const parseLog = []
                    
                    let msgs = null
                    const resId = args.res_id
                    const groupId = args.group_id || e?.group_id
                    
                    parseLog.push(`[GetForward] 开始获取转发消息, res_id=${resId}, group_id=${groupId || 'none'}`)
                    
                    // 方式1: bot.getForwardMsg (标准方式)
                    if (!msgs && bot.getForwardMsg) {
                        try {
                            parseLog.push(`[GetForward] 尝试 bot.getForwardMsg`)
                            msgs = await bot.getForwardMsg(resId)
                            if (msgs) parseLog.push(`[GetForward] bot.getForwardMsg 成功, 消息数: ${msgs?.length || 0}`)
                        } catch (err) {
                            parseLog.push(`[GetForward] bot.getForwardMsg 失败: ${err.message}`)
                        }
                    }
                    
                    // 方式2: group.getForwardMsg (群组方法)
                    if (!msgs && groupId && bot.pickGroup) {
                        try {
                            parseLog.push(`[GetForward] 尝试 group.getForwardMsg`)
                            const group = bot.pickGroup(parseInt(groupId))
                            if (group.getForwardMsg) {
                                msgs = await group.getForwardMsg(resId)
                                if (msgs) parseLog.push(`[GetForward] group.getForwardMsg 成功, 消息数: ${msgs?.length || 0}`)
                            }
                        } catch (err) {
                            parseLog.push(`[GetForward] group.getForwardMsg 失败: ${err.message}`)
                        }
                    }
                    
                    // 方式3: 尝试作为 message_id 获取 (NC 可能返回的格式)
                    if (!msgs && bot.getMsg) {
                        try {
                            parseLog.push(`[GetForward] 尝试 bot.getMsg 作为消息ID`)
                            const msgResult = await bot.getMsg(resId)
                            // 检查是否是转发消息并提取内容
                            if (msgResult?.message) {
                                const fwdSegment = msgResult.message.find(m => m.type === 'forward')
                                if (fwdSegment?.data?.content) {
                                    msgs = fwdSegment.data.content
                                    parseLog.push(`[GetForward] 从消息中提取转发内容成功, 消息数: ${msgs?.length || 0}`)
                                }
                            }
                        } catch (err) {
                            parseLog.push(`[GetForward] bot.getMsg 失败: ${err.message}`)
                        }
                    }
                    
                    // 输出解析日志
                    logger.debug('[GetForward]', parseLog.join(' | '))
                    
                    if (!msgs || !Array.isArray(msgs)) {
                        return { 
                            success: false, 
                            error: '获取转发消息失败，所有方法均失败',
                            _debug: { parseLog }
                        }
                    }
                    
                    // 解析消息 - 兼容 NC 格式
                    const parsedMessages = msgs.map((m, idx) => {
                        // NC 格式: m.data 或直接 m
                        const msgData = m.data || m
                        
                        // 提取用户信息
                        const userId = msgData.user_id || msgData.uin || msgData.sender?.user_id || m.user_id || ''
                        const nickname = msgData.nickname || msgData.nick || msgData.sender?.nickname || 
                                         msgData.sender?.card || m.nickname || m.nick || `用户${idx}`
                        const time = msgData.time || m.time || 0
                        
                        // 提取消息内容
                        let messageContent = msgData.content || msgData.message || m.message || m.content || []
                        if (!Array.isArray(messageContent)) {
                            if (typeof messageContent === 'string') {
                                messageContent = [{ type: 'text', data: { text: messageContent } }]
                            } else {
                                messageContent = []
                            }
                        }
                        
                        // 解析消息内容为文本
                        const textParts = []
                        for (const val of messageContent) {
                            const valData = val.data || val
                            const valType = val.type || ''
                            
                            if (valType === 'text') {
                                textParts.push(valData.text || valData || '')
                            } else if (valType === 'image') {
                                textParts.push('[图片]')
                            } else if (valType === 'face') {
                                textParts.push(`[表情]`)
                            } else if (valType === 'at') {
                                textParts.push(`@${valData.qq || val.qq || ''}`)
                            } else if (valType) {
                                textParts.push(`[${valType}]`)
                            }
                        }
                        
                        return {
                            user_id: userId,
                            nickname: nickname,
                            time: time,
                            message: messageContent,
                            raw_message: cleanCQCode(msgData.raw_message || m.raw_message || textParts.join('') || '')
                        }
                    })
                    
                    return {
                        success: true,
                        count: parsedMessages.length,
                        messages: parsedMessages,
                        _debug: { parseLog }
                    }
                }
            },

            {
                name: 'get_avatar',
                description: '获取用户或群组的头像',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['user', 'group'], description: '类型' },
                        id: { type: 'string', description: 'QQ号或群号' },
                        size: { type: 'number', description: '头像尺寸：40, 100, 140, 640' },
                        as_base64: { type: 'boolean', description: '是否返回base64数据' }
                    },
                    required: ['type', 'id']
                },
                handler: async (args, ctx) => {
                    const id = args.id
                    const size = args.size || 640

                    let url
                    if (args.type === 'user') {
                        url = `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=${size}`
                    } else if (args.type === 'group') {
                        url = `https://p.qlogo.cn/gh/${id}/${id}/${size}`
                    } else {
                        return { success: false, error: '无效的类型，应为 user/group' }
                    }

                    if (args.as_base64) {
                        try {
                            const response = await fetch(url)
                            const buffer = await response.arrayBuffer()
                            const base64 = Buffer.from(buffer).toString('base64')
                            const contentType = response.headers.get('content-type') || 'image/png'

                            return {
                                success: true,
                                url,
                                image: {
                                    base64: `data:${contentType};base64,${base64}`,
                                    mimeType: contentType
                                }
                            }
                        } catch (err) {
                            return { success: false, url, error: `获取头像失败: ${err.message}` }
                        }
                    }

                    return { success: true, url }
                }
            },

            // ==================== 扩展群管理工具 ====================
            {
                name: 'set_group_whole_ban',
                description: '开启或关闭全群禁言',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        enable: { type: 'boolean', description: 'true开启禁言，false关闭禁言' }
                    },
                    required: ['group_id', 'enable']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        
                        // icqq: group.muteAll(enable) 或 group.muteAnonymous(enable)
                        if (typeof group.muteAll === 'function') {
                            await group.muteAll(args.enable)
                        } else if (typeof group.setMuteAll === 'function') {
                            await group.setMuteAll(args.enable)
                        } else {
                            return { success: false, error: '当前协议不支持全群禁言' }
                        }
                        
                        return { success: true, group_id: groupId, whole_ban: args.enable, action: args.enable ? '开启全群禁言' : '关闭全群禁言' }
                    } catch (err) {
                        return { success: false, error: `全群禁言操作失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'set_group_admin',
                description: '设置或取消群管理员',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        user_id: { type: 'string', description: '用户QQ号' },
                        enable: { type: 'boolean', description: 'true设置管理员，false取消管理员' }
                    },
                    required: ['group_id', 'user_id', 'enable']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        const userId = parseInt(args.user_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        await group.setAdmin(userId, args.enable)
                        return { success: true, group_id: groupId, user_id: userId, is_admin: args.enable, action: args.enable ? '设置为管理员' : '取消管理员' }
                    } catch (err) {
                        return { success: false, error: `设置管理员失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'set_group_name',
                description: '修改群名称',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        name: { type: 'string', description: '新的群名称' }
                    },
                    required: ['group_id', 'name']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        await group.setName(args.name)
                        return { success: true, group_id: groupId, new_name: args.name }
                    } catch (err) {
                        return { success: false, error: `修改群名称失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'set_group_special_title',
                description: '设置群成员专属头衔',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        user_id: { type: 'string', description: '用户QQ号' },
                        title: { type: 'string', description: '专属头衔，空字符串表示取消' },
                        duration: { type: 'number', description: '有效期（秒），-1表示永久' }
                    },
                    required: ['group_id', 'user_id', 'title']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        const userId = parseInt(args.user_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        await group.setTitle(userId, args.title, args.duration || -1)
                        return { success: true, group_id: groupId, user_id: userId, title: args.title }
                    } catch (err) {
                        return { success: false, error: `设置专属头衔失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_group_notice',
                description: '发送群公告',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        content: { type: 'string', description: '公告内容' }
                    },
                    required: ['group_id', 'content']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        
                        // icqq: group.announce(content) 或 bot.sendGroupNotice
                        if (typeof group.announce === 'function') {
                            await group.announce(args.content)
                        } else if (typeof bot.sendGroupNotice === 'function') {
                            await bot.sendGroupNotice(groupId, args.content)
                        } else {
                            return { success: false, error: '当前协议不支持发送群公告' }
                        }
                        
                        return { success: true, group_id: groupId, content: args.content }
                    } catch (err) {
                        return { success: false, error: `发送群公告失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'send_poke',
                description: '发送戳一戳',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号（群聊戳一戳）' },
                        user_id: { type: 'string', description: '目标用户QQ号' }
                    },
                    required: ['user_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const userId = parseInt(args.user_id)
                    
                    try {
                        if (args.group_id) {
                            const groupId = parseInt(args.group_id)
                            const group = bot.pickGroup(groupId)
                            
                            // icqq: group.pokeMember(userId) 或 pickMember(uid).poke()
                            if (typeof group.pokeMember === 'function') {
                                await group.pokeMember(userId)
                            } else {
                                await group.pickMember(userId).poke()
                            }
                            return { success: true, group_id: groupId, user_id: userId }
                        } else {
                            const friend = bot.pickFriend(userId)
                            await friend.poke()
                            return { success: true, user_id: userId }
                        }
                    } catch (err) {
                        return { error: '戳一戳失败: ' + err.message }
                    }
                }
            },

            {
                name: 'send_like',
                description: '给好友点赞',
                inputSchema: {
                    type: 'object',
                    properties: {
                        user_id: { type: 'string', description: '用户QQ号' },
                        times: { type: 'number', description: '点赞次数（1-10）' }
                    },
                    required: ['user_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const userId = parseInt(args.user_id)
                    const times = Math.min(10, Math.max(1, args.times || 1))
                    
                    try {
                        // icqq: bot.sendLike(userId, times) 或 pickFriend(uid).thumbUp(times)
                        if (typeof bot.sendLike === 'function') {
                            await bot.sendLike(userId, times)
                        } else {
                            const friend = bot.pickFriend(userId)
                            if (typeof friend.thumbUp === 'function') {
                                await friend.thumbUp(times)
                            } else {
                                return { error: '不支持点赞' }
                            }
                        }
                        return { success: true, user_id: userId, times }
                    } catch (err) {
                        return { error: '点赞失败: ' + err.message }
                    }
                }
            },

            // ==================== 精华消息工具 ====================
            {
                name: 'set_essence_message',
                description: '设置群精华消息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        message_id: { type: 'string', description: '消息ID' }
                    },
                    required: ['group_id', 'message_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const groupId = parseInt(args.group_id)
                    const group = bot.pickGroup(groupId)
                    
                    try {
                        // icqq: group.setEssenceMessage(seq) 或 bot.setEssenceMessage
                        if (typeof group.setEssenceMessage === 'function') {
                            await group.setEssenceMessage(args.message_id)
                        } else if (typeof bot.setEssenceMessage === 'function') {
                            await bot.setEssenceMessage(args.message_id)
                        } else {
                            return { error: '不支持设置精华消息' }
                        }
                        return { success: true, message_id: args.message_id }
                    } catch (err) {
                        return { error: '设置精华失败: ' + err.message }
                    }
                }
            },

            {
                name: 'remove_essence_message',
                description: '移除群精华消息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        message_id: { type: 'string', description: '消息ID' }
                    },
                    required: ['group_id', 'message_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    const groupId = parseInt(args.group_id)
                    const group = bot.pickGroup(groupId)
                    
                    try {
                        if (typeof group.removeEssenceMessage === 'function') {
                            await group.removeEssenceMessage(args.message_id)
                        } else if (typeof bot.removeEssenceMessage === 'function') {
                            await bot.removeEssenceMessage(args.message_id)
                        } else {
                            return { error: '不支持移除精华消息' }
                        }
                        return { success: true, message_id: args.message_id }
                    } catch (err) {
                        return { error: '移除精华失败: ' + err.message }
                    }
                }
            },

            // ==================== 好友请求处理 ====================
            {
                name: 'handle_friend_request',
                description: '处理好友添加请求',
                inputSchema: {
                    type: 'object',
                    properties: {
                        flag: { type: 'string', description: '请求标识' },
                        approve: { type: 'boolean', description: '是否同意' },
                        remark: { type: 'string', description: '好友备注（同意时可用）' }
                    },
                    required: ['flag', 'approve']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        await bot.setFriendAddRequest(args.flag, args.approve, args.remark || '')
                        return { success: true, approved: args.approve, action: args.approve ? '已同意' : '已拒绝' }
                    } catch (err) {
                        return { success: false, error: `处理好友请求失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'handle_group_request',
                description: '处理加群请求或邀请',
                inputSchema: {
                    type: 'object',
                    properties: {
                        flag: { type: 'string', description: '请求标识' },
                        approve: { type: 'boolean', description: '是否同意' },
                        reason: { type: 'string', description: '拒绝理由（拒绝时可用）' }
                    },
                    required: ['flag', 'approve']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        await bot.setGroupAddRequest(args.flag, args.approve, args.reason || '')
                        return { success: true, approved: args.approve, action: args.approve ? '已同意' : '已拒绝' }
                    } catch (err) {
                        return { success: false, error: `处理加群请求失败: ${err.message}` }
                    }
                }
            },

            // ==================== 消息转发工具 ====================
            {
                name: 'make_forward_message',
                description: '制作并发送合并转发消息',
                inputSchema: {
                    type: 'object',
                    properties: {
                        target_type: { type: 'string', enum: ['group', 'private', 'current'], description: '发送目标类型' },
                        target_id: { type: 'string', description: '目标ID' },
                        messages: { 
                            type: 'array', 
                            description: '消息列表，每项包含 user_id, nickname, content',
                            items: {
                                type: 'object',
                                properties: {
                                    user_id: { type: 'string' },
                                    nickname: { type: 'string' },
                                    content: { type: 'string' }
                                }
                            }
                        }
                    },
                    required: ['target_type', 'messages']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const e = ctx.getEvent()

                        if (!args.messages || args.messages.length === 0) {
                            return { success: false, error: '消息列表不能为空' }
                        }

                        const nodes = args.messages.map(msg => ({
                            user_id: parseInt(msg.user_id) || bot.uin,
                            nickname: msg.nickname || '消息',
                            message: msg.content
                        }))

                        const forwardMsg = await bot.makeForwardMsg(nodes)

                        if (args.target_type === 'current' && e) {
                            await e.reply(forwardMsg)
                            return { success: true, message_count: nodes.length }
                        }

                        if (args.target_type === 'group') {
                            if (!args.target_id) return { success: false, error: '群聊需要提供 target_id' }
                            const group = bot.pickGroup(parseInt(args.target_id))
                            await group.sendMsg(forwardMsg)
                            return { success: true, group_id: args.target_id, message_count: nodes.length }
                        }

                        if (args.target_type === 'private') {
                            if (!args.target_id) return { success: false, error: '私聊需要提供 target_id' }
                            const friend = bot.pickFriend(parseInt(args.target_id))
                            await friend.sendMsg(forwardMsg)
                            return { success: true, user_id: args.target_id, message_count: nodes.length }
                        }

                        return { success: false, error: '无效的目标类型，应为 group/private/current' }
                    } catch (err) {
                        return { success: false, error: `发送转发消息失败: ${err.message}` }
                    }
                }
            },

            // ==================== 机器人状态工具 ====================
            {
                name: 'get_bot_status',
                description: '获取机器人当前状态信息',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    return {
                        success: true,
                        uin: bot.uin,
                        nickname: bot.nickname,
                        status: bot.status,
                        online: bot.isOnline?.() ?? true,
                        friend_count: bot.fl?.size || 0,
                        group_count: bot.gl?.size || 0,
                        stat: bot.stat
                    }
                }
            },

            {
                name: 'set_online_status',
                description: '设置机器人在线状态',
                inputSchema: {
                    type: 'object',
                    properties: {
                        status: { 
                            type: 'number', 
                            description: '状态码：11在线, 31离开, 41隐身, 50忙碌, 60Q我吧, 70请勿打扰' 
                        }
                    },
                    required: ['status']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    try {
                        if (typeof bot.setOnlineStatus === 'function') {
                            await bot.setOnlineStatus(args.status)
                        } else {
                            return { error: '不支持设置在线状态' }
                        }
                        return { success: true, status: args.status }
                    } catch (err) {
                        return { error: '设置状态失败: ' + err.message }
                    }
                }
            },

            // ==================== 文件操作工具 ====================
            {
                name: 'upload_group_file',
                description: '上传文件到群文件',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        file_path: { type: 'string', description: '本地文件路径' },
                        file_name: { type: 'string', description: '文件名（可选）' },
                        folder_id: { type: 'string', description: '目标文件夹ID（可选）' }
                    },
                    required: ['group_id', 'file_path']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        // 检查文件是否存在
                        if (!fs.existsSync(args.file_path)) {
                            return { success: false, error: `文件不存在: ${args.file_path}` }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        const fileName = args.file_name || path.basename(args.file_path)
                        await group.fs.upload(args.file_path, args.folder_id || '/', fileName)
                        
                        return { success: true, group_id: groupId, file_name: fileName }
                    } catch (err) {
                        return { success: false, error: `上传群文件失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'delete_group_file',
                description: '删除群文件',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        file_id: { type: 'string', description: '文件ID' }
                    },
                    required: ['group_id', 'file_id']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        await group.fs.rm(args.file_id)
                        
                        return { success: true, group_id: groupId, file_id: args.file_id }
                    } catch (err) {
                        return { success: false, error: `删除群文件失败: ${err.message}` }
                    }
                }
            },

            {
                name: 'create_group_folder',
                description: '创建群文件夹',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group_id: { type: 'string', description: '群号' },
                        folder_name: { type: 'string', description: '文件夹名称' },
                        parent_id: { type: 'string', description: '父文件夹ID（可选）' }
                    },
                    required: ['group_id', 'folder_name']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        const groupId = parseInt(args.group_id)
                        
                        const groupInfo = bot.gl?.get(groupId)
                        if (!groupInfo) {
                            return { success: false, error: '机器人不在此群内' }
                        }
                        
                        const group = bot.pickGroup(groupId)
                        await group.fs.mkdir(args.folder_name, args.parent_id || '/')
                        
                        return { success: true, group_id: groupId, folder_name: args.folder_name }
                    } catch (err) {
                        return { success: false, error: `创建群文件夹失败: ${err.message}` }
                    }
                }
            },

            // ==================== 网页浏览工具 ====================
            {
                name: 'website',
                description: '访问网页并获取内容，支持HTML页面和API接口。使用Puppeteer模拟浏览器访问，可绕过反爬虫机制。返回Markdown格式的页面内容。',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: { type: 'string', description: '要访问的网站网址' }
                    },
                    required: ['url']
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()
                    const { url } = args

                    let browser
                    try {
                        // 访问前的提示
                        if (e) {
                            const visitMessage = [`正在访问网站: ${url}...`]
                            let visitForward = await common.makeForwardMsg(e, visitMessage)
                            e.reply(visitForward)
                        }
                        
                        // 启动浏览器
                        const browserArgs = [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-accelerated-2d-canvas',
                            '--disable-gpu',
                            '--window-size=1920x1080'
                        ]
                        
                        // 获取浏览器代理配置
                        const browserProxy = proxyService.getBrowserProxyArgs()
                        if (browserProxy) {
                            browserArgs.push(`--proxy-server=${browserProxy}`)
                            logger.debug('[BuiltinMCP] 浏览器使用代理:', browserProxy)
                        }
                        
                        browser = await puppeteer.launch({
                            headless: true,
                            args: browserArgs
                        })
                        
                        // 创建新页面
                        const page = await browser.newPage()
                        
                        // 设置用户代理
                        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36')
                        
                        // 访问URL
                        await page.goto(url, {
                            waitUntil: 'networkidle2',
                            timeout: 30000
                        })
                        
                        // 获取页面标题
                        const title = await page.title()
                        
                        // 获取页面内容
                        let html = await page.content()
                        
                        // 关闭页面
                        await page.close()
                        
                        // 清理HTML
                        const cleanedHtml = cleanHTML(html)
                        
                        // 将HTML转换为Markdown
                        const markdown = convertToMarkdown(cleanedHtml)
                        
                        // 将内容分段，以便于在消息中展示
                        const parts = []
                        
                        // 先添加页面标题信息
                        parts.push(`${title || '未知标题'}`)
                        parts.push(`网站地址: ${url}`)
                        parts.push(`---`) // 分隔线
                        parts.push(markdown)
                        
                        // 制作转发消息并发送
                        if (e) {
                            const forwardMsg = await common.makeForwardMsg(e, parts)
                            e.reply(forwardMsg)
                        }
                        
                        return {
                            text: `The title of the website is: "${title}". The content has been converted to Markdown for better readability:\n\n${markdown}`
                        }
                    } catch (err) {
                        // 出错时也制作转发消息
                        if (e) {
                            const errorMsg = [`访问网站 ${url} 失败，错误: ${err.toString()}`]
                            const errorForward = await common.makeForwardMsg(e, errorMsg)
                            e.reply(errorForward)
                        }
                        
                        return { error: `Failed to visit the website: ${err.toString()}` }
                    } finally {
                        if (browser) {
                            try {
                                await browser.close()
                            } catch (err) {}
                        }
                    }
                }
            }
        ]
    }
}

// 单例
export const builtinMcpServer = new BuiltinMcpServer()
