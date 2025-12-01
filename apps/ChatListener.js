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
        const listenerConfig = config.get('listener') || {}
        
        // 群聊消息采集（无论是否触发AI都收集）
        if (e.isGroup && e.group_id) {
            try {
                memoryManager.collectGroupMessage(String(e.group_id), {
                    user_id: e.user_id,
                    sender: e.sender,
                    msg: e.msg,
                    raw_message: e.raw_message
                })
            } catch (err) {
                // 静默失败，不影响主流程
            }
        }
        
        // 检查是否启用
        if (!listenerConfig.enabled) {
            return false
        }

        // 检查黑白名单
        if (!this.checkAccess(listenerConfig)) {
            return false
        }

        // 检查触发条件
        if (!this.checkTrigger(listenerConfig)) {
            return false
        }

        // 处理消息
        try {
            await this.handleChat(listenerConfig)
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
     * 检查触发条件
     */
    checkTrigger(cfg) {
        const e = this.e
        const triggerMode = cfg.triggerMode || 'at'
        const triggerPrefix = cfg.triggerPrefix || ''

        switch (triggerMode) {
            case 'at':
                // @机器人或私聊触发
                return e.atBot || !e.isGroup
            
            case 'prefix':
                // 前缀触发
                if (!triggerPrefix) return false
                return e.msg?.startsWith(triggerPrefix)
            
            case 'always':
                // 始终触发（群聊也会响应）
                return true
            
            case 'at_or_prefix':
                // @或前缀都可以
                return e.atBot || !e.isGroup || (triggerPrefix && e.msg?.startsWith(triggerPrefix))
            
            default:
                return e.atBot || !e.isGroup
        }
    }

    /**
     * 处理聊天
     */
    async handleChat(listenerConfig) {
        const e = this.e
        const userId = e.user_id?.toString()
        const featuresConfig = config.get('features') || {}
        
        // 解析用户消息（包括引用消息）
        const userMessage = await parseUserMessage(e, {
            handleReplyText: featuresConfig.replyQuote?.handleText ?? true,
            handleReplyImage: featuresConfig.replyQuote?.handleImage ?? true,
            handleReplyFile: featuresConfig.replyQuote?.handleFile ?? true,
            handleForward: featuresConfig.replyQuote?.handleForward ?? true,
            handleAtMsg: true,
            excludeAtBot: true,
            triggerMode: listenerConfig.triggerMode || 'at',
            triggerPrefix: listenerConfig.triggerPrefix || ''
        })

        // 检查消息是否有效
        const textContent = userMessage.content?.find(c => c.type === 'text')?.text?.trim()
        if (!textContent && userMessage.content?.length === 0) {
            return false
        }

        // 设置工具上下文
        setToolContext({ event: e, bot: e.bot || Bot })
        mcpManager.setToolContext({ event: e, bot: e.bot || Bot })

        // 调用聊天服务
        const result = await chatService.sendMessage({
            userId,
            message: textContent,
            images: userMessage.content?.filter(c => c.type === 'image').map(c => c.image) || [],
            event: e,
            mode: 'chat'
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
