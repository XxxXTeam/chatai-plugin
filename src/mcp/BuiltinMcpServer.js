import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getBotFramework } from '../../utils/bot.js'
import config from '../../config/config.js'
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import TurndownService from 'turndown'
import common from '../../../../lib/common/common.js'
import fetch from 'node-fetch'

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
        this.initialized = false
    }

    /**
     * 初始化服务器
     */
    async init() {
        if (this.initialized) return
        this.initialized = true
        logger.info('[BuiltinMCP] Server initialized with', this.tools.length, 'tools')
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

        // 添加自定义工具
        const customTools = this.getCustomTools()
        for (const ct of customTools) {
            tools.push({
                name: ct.name,
                description: ct.description,
                inputSchema: ct.inputSchema,
                isCustom: true
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
                // 调用其他工具
                callTool: async (name, toolArgs) => {
                    const mcpManager = (await import('./McpManager.js')).default
                    return mcpManager.callTool(name, toolArgs)
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
     */
    async callTool(name, args) {
        // 先检查是否是自定义工具
        const customTools = this.getCustomTools()
        const customTool = customTools.find(t => t.name === name)
        
        if (customTool) {
            logger.info(`[BuiltinMCP] Calling custom tool: ${name}`, args)
            try {
                const result = await this.executeCustomHandler(customTool.handler, args, toolContext)
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

        logger.info(`[BuiltinMCP] Calling tool: ${name}`, args)

        try {
            const result = await tool.handler(args, toolContext)
            
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
                        user: ['get_user_info', 'get_friend_list', 'send_like'],
                        group: ['get_group_info', 'get_group_list', 'get_group_member_list', 'get_group_member_info', 'get_group_files', 'get_file_url'],
                        message: ['send_private_message', 'send_group_message', 'reply_current_message', 'at_user', 'get_chat_history', 'get_current_context', 'get_reply_message', 'get_at_members', 'get_message_by_id', 'get_forward_message', 'make_forward_message', 'recall_message'],
                        file: ['parse_file', 'upload_group_file', 'delete_group_file', 'create_group_folder'],
                        image: ['parse_image', 'send_image', 'parse_video', 'send_video', 'get_avatar', 'image_ocr'],
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
                            raw_message: msg.raw_message,
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
                        raw_message: e.raw_message,
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
                            raw_message: e.source.raw_message,
                            time: e.source.time,
                            seq: e.source.seq
                        }
                    }

                    return context
                }
            },

            {
                name: 'get_reply_message',
                description: '获取当前消息引用/回复的原消息详情',
                inputSchema: {
                    type: 'object',
                    properties: {}
                },
                handler: async (args, ctx) => {
                    const e = ctx.getEvent()
                    if (!e) {
                        return { success: false, error: '没有可用的会话上下文' }
                    }

                    if (!e.source) {
                        return { success: true, has_reply: false, message: '当前消息没有引用其他消息' }
                    }

                    const bot = ctx.getBot()
                    const source = e.source

                    // 尝试获取完整的引用消息
                    let fullMessage = null
                    try {
                        if (e.group_id) {
                            const group = bot.pickGroup(e.group_id)
                            fullMessage = await group.getMsg(source.seq || source.message_id)
                        } else {
                            const friend = bot.pickFriend(e.user_id)
                            fullMessage = await friend.getMsg(source.seq || source.message_id)
                        }
                    } catch (err) {
                        // 获取完整消息失败，使用 source 中的信息
                    }

                    return {
                        success: true,
                        has_reply: true,
                        message_id: source.message_id || source.seq,
                        user_id: source.user_id,
                        nickname: source.nickname,
                        time: source.time,
                        seq: source.seq,
                        raw_message: source.raw_message || fullMessage?.raw_message,
                        message: source.message || fullMessage?.message,
                        // 解析引用消息中的内容
                        content: {
                            text: (source.message || fullMessage?.message || [])
                                .filter(m => m.type === 'text')
                                .map(m => m.text)
                                .join(''),
                            has_image: (source.message || fullMessage?.message || [])
                                .some(m => m.type === 'image'),
                            images: (source.message || fullMessage?.message || [])
                                .filter(m => m.type === 'image')
                                .map(m => m.url || m.file)
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
                            raw_message: msg.raw_message,
                            message: msg.message
                        }
                    } catch (err) {
                        return { success: false, error: '获取消息失败: ' + err.message }
                    }
                }
            },

            {
                name: 'get_forward_message',
                description: '获取合并转发消息的内容',
                inputSchema: {
                    type: 'object',
                    properties: {
                        res_id: { type: 'string', description: '转发消息的res_id' }
                    },
                    required: ['res_id']
                },
                handler: async (args, ctx) => {
                    const bot = ctx.getBot()
                    
                    try {
                        const msgs = await bot.getForwardMsg(args.res_id)
                        
                        return {
                            success: true,
                            count: msgs.length,
                            messages: msgs.map(m => ({
                                user_id: m.user_id,
                                nickname: m.nickname,
                                time: m.time,
                                message: m.message,
                                raw_message: m.raw_message
                            }))
                        }
                    } catch (err) {
                        return { success: false, error: '获取转发消息失败: ' + err.message }
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

            // ==================== 图片OCR ====================
            {
                name: 'image_ocr',
                description: '识别图片中的文字',
                inputSchema: {
                    type: 'object',
                    properties: {
                        image_url: { type: 'string', description: '图片URL' }
                    },
                    required: ['image_url']
                },
                handler: async (args, ctx) => {
                    try {
                        const bot = ctx.getBot()
                        // icqq: bot.imageOcr(image) 或不支持
                        if (typeof bot.imageOcr === 'function') {
                            const result = await bot.imageOcr(args.image_url)
                            const texts = result?.texts || result?.wordslist?.map(w => w.words) || []
                            return {
                                success: true,
                                texts,
                                text: texts.join('\n'),
                                language: result?.language
                            }
                        } else {
                            return { success: false, error: '当前协议不支持OCR功能' }
                        }
                    } catch (err) {
                        return { success: false, error: 'OCR识别失败: ' + err.message }
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
                        browser = await puppeteer.launch({
                            headless: true,
                            args: [
                                '--no-sandbox',
                                '--disable-setuid-sandbox',
                                '--disable-dev-shm-usage',
                                '--disable-accelerated-2d-canvas',
                                '--disable-gpu',
                                '--window-size=1920x1080',
                                '--proxy-server=http://127.0.0.1:10808'
                            ]
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
