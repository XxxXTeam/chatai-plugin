/**
 * AI 群聊监听器
 * 优先级设为 -Infinity 确保最后执行（成功监听所有消息）
 */
import { chatService } from '../src/services/ChatService.js'
import { parseUserMessage } from '../src/utils/messageParser.js'
import { setToolContext } from '../src/core/utils/toolAdapter.js'
import { mcpManager } from '../src/mcp/McpManager.js'
import { memoryManager } from '../src/services/MemoryManager.js'
import config from '../config/config.js'
import { isMessageProcessed, markMessageProcessed, isSelfMessage } from './chat.js'

export class ChatListener extends plugin {
    constructor() {
        const listenerConfig = config.get('listener') || {}
        
        super({
            name: 'AI群聊监听',
            dsc: 'AI聊天监听器，支持@触发和前缀触发',
            event: 'message',
            priority: listenerConfig.priority ?? -Infinity, // 确保最后执行
            rule: [
                {
                    reg: '^[\\s\\S]*$',
                    fnc: 'onMessage',
                    log: false
                }
            ]
        })
    }

    /**
     * 消息处理入口
     */
    async onMessage() {
        const e = this.e
        
        // 防护：忽略自身消息
        if (isSelfMessage(e)) {
            return false
        }
        
        // 获取配置（优先使用新trigger配置，兼容旧listener配置）
        let triggerCfg = config.get('trigger')
        if (!triggerCfg || !triggerCfg.private) {
            // 使用旧配置并转换
            const listenerConfig = config.get('listener') || {}
            triggerCfg = this.convertLegacyConfig(listenerConfig)
        }
        
        // 群聊消息采集
        if (e.isGroup && e.group_id && triggerCfg.collectGroupMsg !== false) {
            try {
                memoryManager.collectGroupMessage(String(e.group_id), {
                    user_id: e.user_id,
                    sender: e.sender,
                    msg: e.msg,
                    raw_message: e.raw_message
                })
            } catch (err) {
                // 静默失败
            }
        }
        
        // 检查消息是否已被其他插件处理
        if (isMessageProcessed(e)) {
            return false
        }

        // 检查黑白名单
        if (!this.checkAccess(triggerCfg)) {
            return false
        }

        // 检查触发条件
        const triggerResult = this.checkTrigger(triggerCfg)
        if (!triggerResult.triggered) {
            return false
        }
        
        logger.debug(`[ChatListener] 触发: ${triggerResult.reason}`)

        // 标记消息已处理
        markMessageProcessed(e)

        // 处理消息
        try {
            await this.handleChat(triggerCfg, triggerResult.msg)
            return true
        } catch (error) {
            logger.error('[ChatListener] 处理消息失败:', error)
            return false
        }
    }
    /**
     * 检查访问权限（黑白名单）
     */
    checkAccess(cfg) {
        const e = this.e
        const userId = e.user_id?.toString()
        const groupId = e.group_id?.toString()

        // 检查用户黑名单
        if (cfg.blacklistUsers?.includes(userId)) {
            return false
        }

        // 检查用户白名单（如果设置了白名单，必须在白名单内）
        if (cfg.whitelistUsers?.length > 0 && !cfg.whitelistUsers.includes(userId)) {
            return false
        }

        // 检查群组黑名单
        if (e.isGroup && cfg.blacklistGroups?.includes(groupId)) {
            return false
        }

        // 检查群组白名单
        if (e.isGroup && cfg.whitelistGroups?.length > 0 && !cfg.whitelistGroups.includes(groupId)) {
            return false
        }

        return true
    }

    /**
     * 检查触发条件（重构版）
     * @returns {{ triggered: boolean, msg: string, reason: string }}
     */
    checkTrigger(cfg) {
        const e = this.e
        const rawMsg = e.msg || ''
        
        // 兼容旧配置：如果是listener配置，转换为新trigger配置
        const triggerCfg = cfg.private ? cfg : this.convertLegacyConfig(cfg)
        
        // === 私聊判断 ===
        if (!e.isGroup) {
            const privateCfg = triggerCfg.private || {}
            if (!privateCfg.enabled) {
                return { triggered: false, msg: '', reason: '私聊已禁用' }
            }
            
            const mode = privateCfg.mode || 'always'
            if (mode === 'always') {
                return { triggered: true, msg: rawMsg, reason: '私聊总是响应' }
            }
            if (mode === 'prefix') {
                const result = this.checkPrefix(rawMsg, triggerCfg.prefixes)
                if (result.matched) {
                    return { triggered: true, msg: result.content, reason: `私聊前缀[${result.prefix}]` }
                }
                return { triggered: false, msg: '', reason: '私聊需要前缀' }
            }
            return { triggered: false, msg: '', reason: '私聊模式关闭' }
        }
        
        // === 群聊判断 ===
        const groupCfg = triggerCfg.group || {}
        if (!groupCfg.enabled) {
            return { triggered: false, msg: '', reason: '群聊已禁用' }
        }
        
        // 1. @触发（优先级最高）
        if (groupCfg.at && e.atBot) {
            return { triggered: true, msg: rawMsg, reason: '@机器人' }
        }
        
        // 2. 前缀触发
        if (groupCfg.prefix) {
            const result = this.checkPrefix(rawMsg, triggerCfg.prefixes)
            if (result.matched) {
                return { triggered: true, msg: result.content, reason: `前缀[${result.prefix}]` }
            }
        }
        
        // 3. 关键词触发
        if (groupCfg.keyword) {
            const result = this.checkKeyword(rawMsg, triggerCfg.keywords)
            if (result.matched) {
                return { triggered: true, msg: rawMsg, reason: `关键词[${result.keyword}]` }
            }
        }
        
        // 4. 随机触发
        if (groupCfg.random) {
            const rate = groupCfg.randomRate || 0.05
            if (Math.random() < rate) {
                return { triggered: true, msg: rawMsg, reason: `随机(${(rate*100).toFixed(0)}%)` }
            }
        }
        
        return { triggered: false, msg: '', reason: '未满足触发条件' }
    }
    
    /**
     * 检查前缀
     */
    checkPrefix(msg, prefixes = []) {
        if (!Array.isArray(prefixes)) prefixes = [prefixes]
        for (const prefix of prefixes) {
            if (prefix && msg.startsWith(prefix)) {
                return { matched: true, prefix, content: msg.slice(prefix.length).trim() }
            }
        }
        return { matched: false }
    }
    
    /**
     * 检查关键词
     */
    checkKeyword(msg, keywords = []) {
        if (!Array.isArray(keywords)) keywords = [keywords]
        for (const keyword of keywords) {
            if (keyword && msg.includes(keyword)) {
                return { matched: true, keyword }
            }
        }
        return { matched: false }
    }
    
    /**
     * 兼容旧配置
     */
    convertLegacyConfig(oldCfg) {
        // 如果是旧的listener配置，转换为新格式
        const triggerMode = oldCfg.triggerMode || 'at'
        return {
            private: {
                enabled: oldCfg.privateChat?.enabled ?? true,
                mode: oldCfg.privateChat?.alwaysReply ? 'always' : 'prefix'
            },
            group: {
                enabled: oldCfg.groupChat?.enabled ?? true,
                at: ['at', 'both'].includes(triggerMode),
                prefix: ['prefix', 'both'].includes(triggerMode),
                keyword: triggerMode === 'both',
                random: triggerMode === 'random',
                randomRate: oldCfg.randomReplyRate || 0.1
            },
            prefixes: oldCfg.triggerPrefix || ['#chat'],
            keywords: oldCfg.triggerKeywords || [],
            collectGroupMsg: oldCfg.groupChat?.collectMessages ?? true,
            blacklistUsers: oldCfg.blacklistUsers || [],
            whitelistUsers: oldCfg.whitelistUsers || [],
            blacklistGroups: oldCfg.blacklistGroups || [],
            whitelistGroups: oldCfg.whitelistGroups || []
        }
    }

    /**
     * 处理聊天
     * @param {Object} triggerCfg - 触发配置
     * @param {string} processedMsg - 已处理的消息（去除前缀后）
     */
    async handleChat(triggerCfg, processedMsg = null) {
        const e = this.e
        const userId = e.user_id?.toString()
        const groupId = e.group_id?.toString() || null
        const featuresConfig = config.get('features') || {}
        
        // 解析用户消息
        const userMessage = await parseUserMessage(e, {
            handleReplyText: featuresConfig.replyQuote?.handleText ?? true,
            handleReplyImage: featuresConfig.replyQuote?.handleImage ?? true,
            handleReplyFile: featuresConfig.replyQuote?.handleFile ?? true,
            handleForward: featuresConfig.replyQuote?.handleForward ?? true,
            handleAtMsg: true,
            excludeAtBot: true,
            includeSenderInfo: true,
            includeDebugInfo: false
        })

        // 检查消息是否有效
        const textContent = userMessage.content?.find(c => c.type === 'text')?.text?.trim()
        if (!textContent && userMessage.content?.length === 0) {
            return false
        }

        // 设置工具上下文
        setToolContext({ event: e, bot: e.bot || Bot })
        mcpManager.setToolContext({ event: e, bot: e.bot || Bot })

        // 调用聊天服务 - 传递完整的用户消息信息
        const result = await chatService.sendMessage({
            userId,
            message: textContent,
            images: userMessage.content?.filter(c => c.type === 'image').map(c => c.image) || [],
            event: e,
            mode: 'chat',
            // 传递解析后的消息信息
            parsedMessage: userMessage
        })

        // 发送回复
        if (result.response && result.response.length > 0) {
            const replyContent = this.formatReply(result.response)
            if (replyContent) {
                await this.reply(replyContent, true)
            }
        }

        return true
    }

    /**
     * 格式化回复内容
     */
    formatReply(contents) {
        const messages = []
        
        for (const content of contents) {
            switch (content.type) {
                case 'text':
                    if (content.text?.trim()) {
                        messages.push(content.text.trim())
                    }
                    break
                
                case 'image':
                    if (content.image) {
                        if (content.image.startsWith('http')) {
                            messages.push(segment.image(content.image))
                        } else if (content.image.startsWith('base64://')) {
                            messages.push(segment.image(content.image))
                        } else {
                            messages.push(segment.image(`base64://${content.image}`))
                        }
                    }
                    break
                
                case 'audio':
                    if (content.data) {
                        messages.push(segment.record(content.data))
                    }
                    break
            }
        }

        return messages.length > 0 ? messages : null
    }

    /**
     * 发送合并转发消息
     * @param {string} title 标题
     * @param {Array} messages 消息数组
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendForwardMsg(title, messages) {
        const e = this.e
        if (!e) return false
        
        try {
            const bot = e.bot || Bot
            const botId = bot?.uin || e.self_id || 10000
            
            const forwardNodes = messages.map(msg => ({
                user_id: botId,
                nickname: title || 'Bot',
                message: Array.isArray(msg) ? msg : [msg]
            }))
            
            if (e.isGroup && e.group?.makeForwardMsg) {
                const forwardMsg = await e.group.makeForwardMsg(forwardNodes)
                if (forwardMsg) {
                    await e.group.sendMsg(forwardMsg)
                    return true
                }
            } else if (!e.isGroup && e.friend?.makeForwardMsg) {
                const forwardMsg = await e.friend.makeForwardMsg(forwardNodes)
                if (forwardMsg) {
                    await e.friend.sendMsg(forwardMsg)
                    return true
                }
            }
            
            return false
        } catch (err) {
            logger.debug('[ChatListener] sendForwardMsg failed:', err.message)
            return false
        }
    }

    /**
     * 获取引用消息
     * @returns {Promise<Object|null>} 引用的消息对象
     */
    async getQuoteMessage() {
        const e = this.e
        if (!e?.source) return null
        
        try {
            const bot = e.bot || Bot
            const messageId = e.source.message_id || e.source.seq
            
            if (typeof bot?.getMsg === 'function') {
                return await bot.getMsg(messageId)
            }
            if (e.group && typeof e.group?.getChatHistory === 'function') {
                const history = await e.group.getChatHistory(e.source.seq, 1)
                return history?.[0] || null
            }
            
            return null
        } catch (err) {
            logger.debug('[ChatListener] getQuoteMessage failed:', err.message)
            return null
        }
    }
}
