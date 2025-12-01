/**
 * AI 群聊监听器
 * 优先级设为 -Infinity 确保最后执行（成功监听所有消息）
 */
import { chatService } from '../src/services/ChatService.js'
import { parseUserMessage } from '../src/utils/messageParser.js'
import { setToolContext } from '../src/core/utils/toolAdapter.js'
import { mcpManager } from '../src/mcp/McpManager.js'
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
    async onMessage(e) {
        const listenerConfig = config.get('listener') || {}
        
        // 检查是否启用
        if (!listenerConfig.enabled) {
            return false
        }

        // 检查黑白名单
        if (!this.checkAccess(e, listenerConfig)) {
            return false
        }

        // 检查触发条件
        if (!this.checkTrigger(e, listenerConfig)) {
            return false
        }

        // 处理消息
        try {
            await this.handleChat(e, listenerConfig)
            return true
        } catch (error) {
            logger.error('[ChatListener] 处理消息失败:', error)
            return false
        }
    }

    /**
     * 检查访问权限（黑白名单）
     */
    checkAccess(e, config) {
        const userId = e.user_id?.toString()
        const groupId = e.group_id?.toString()

        // 检查用户黑名单
        if (config.blacklistUsers?.includes(userId)) {
            return false
        }

        // 检查用户白名单（如果设置了白名单，必须在白名单内）
        if (config.whitelistUsers?.length > 0 && !config.whitelistUsers.includes(userId)) {
            return false
        }

        // 检查群组黑名单
        if (e.isGroup && config.blacklistGroups?.includes(groupId)) {
            return false
        }

        // 检查群组白名单
        if (e.isGroup && config.whitelistGroups?.length > 0 && !config.whitelistGroups.includes(groupId)) {
            return false
        }

        return true
    }

    /**
     * 检查触发条件
     */
    checkTrigger(e, config) {
        const triggerMode = config.triggerMode || 'at'
        const triggerPrefix = config.triggerPrefix || ''

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
    async handleChat(e, listenerConfig) {
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
                await e.reply(replyContent, true)
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
}
