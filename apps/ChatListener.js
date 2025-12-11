import { chatService } from '../src/services/ChatService.js'
import { parseUserMessage, segment, CardParser, MessageApi, MessageUtils } from '../src/utils/messageParser.js'
import { setToolContext } from '../src/core/utils/toolAdapter.js'
import { mcpManager } from '../src/mcp/McpManager.js'
import { memoryManager } from '../src/services/MemoryManager.js'
import config from '../config/config.js'
import { isMessageProcessed, markMessageProcessed, isSelfMessage, isReplyToBotMessage, recordSentMessage } from './chat.js'

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
        
        // === 检查监听器总开关 ===
        const listenerEnabled = config.get('listener.enabled')
        if (listenerEnabled === false) {
            // 监听器关闭时，只采集群消息（如果启用），不处理触发
            if (e.isGroup && e.group_id && config.get('trigger.collectGroupMsg') !== false) {
                try {
                    memoryManager.collectGroupMessage(String(e.group_id), {
                        user_id: e.user_id,
                        sender: e.sender,
                        msg: e.msg,
                        raw_message: e.raw_message
                    })
                } catch {
                    // 静默失败
                }
            }
            return false
        }
        
        // 获取配置（优先使用新trigger配置，兼容旧listener配置）
        let triggerCfg = config.get('trigger')
        if (!triggerCfg || !triggerCfg.private) {
            // 使用旧配置并转换
            const listenerConfig = config.get('listener') || {}
            triggerCfg = this.convertLegacyConfig(listenerConfig)
        }
        
        // 群聊消息采集（仅在群聊时）
        if (e.isGroup && e.group_id && triggerCfg.collectGroupMsg !== false) {
            try {
                memoryManager.collectGroupMessage(String(e.group_id), {
                    user_id: e.user_id,
                    sender: e.sender,
                    msg: e.msg,
                    raw_message: e.raw_message
                })
            } catch {
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

        // 检查触发条件（私聊和群聊独立判断）
        const triggerResult = this.checkTrigger(triggerCfg)
        if (!triggerResult.triggered) {
            return false
        }
        

        // 标记消息已处理
        markMessageProcessed(e)

        // 处理消息
        try {
            await this.handleChat(triggerCfg, triggerResult.msg, {
                persona: triggerResult.persona,
                isPersonaPrefix: triggerResult.isPersonaPrefix
            })
            return true
        } catch {
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
            // 私聊默认启用（enabled 不存在或为 true 时启用）
            if (privateCfg.enabled === false) {
                return { triggered: false, msg: '', reason: '私聊已禁用' }
            }
            
            const mode = privateCfg.mode || 'always'
            if (mode === 'always') {
                return { triggered: true, msg: rawMsg, reason: '私聊总是响应' }
            }
            if (mode === 'prefix') {
                const result = this.checkPrefix(rawMsg, triggerCfg.prefixes, triggerCfg.prefixPersonas)
                if (result.matched) {
                    return { 
                        triggered: true, 
                        msg: result.content, 
                        reason: result.isPersonaPrefix ? `私聊前缀人格[${result.prefix}]` : `私聊前缀[${result.prefix}]`,
                        persona: result.persona,
                        isPersonaPrefix: result.isPersonaPrefix
                    }
                }
                return { triggered: false, msg: '', reason: '私聊需要前缀' }
            }
            // mode === 'off' 时不触发
            if (mode === 'off') {
                return { triggered: false, msg: '', reason: '私聊模式关闭' }
            }
            // 未知模式默认响应
            return { triggered: true, msg: rawMsg, reason: '私聊默认响应' }
        }
        
        // === 群聊判断 ===
        const groupCfg = triggerCfg.group || {}
        if (!groupCfg.enabled) {
            return { triggered: false, msg: '', reason: '群聊已禁用' }
        }
        
        // 1. @触发（优先级最高）
        if (groupCfg.at && e.atBot) {
            const isReplyToBot = isReplyToBotMessage(e)
            const hasReply = !!e.source
            
            if (isReplyToBot) {
                // 引用机器人消息：检查 replyBot 配置
                if (groupCfg.replyBot) {
                    return { triggered: true, msg: rawMsg, reason: '引用机器人消息' }
                }
                // 不触发（防止重复响应）
            } else if (hasReply) {
                // 引用其他消息：@ 仍然有效
                return { triggered: true, msg: rawMsg, reason: '@机器人(含引用)' }
            } else {
                // 正常 @ 触发
                return { triggered: true, msg: rawMsg, reason: '@机器人' }
            }
        }
        
        // 2. 引用机器人消息触发（独立于@，需要 replyBot=true）
        if (groupCfg.replyBot && e.source && !e.atBot) {
            const isReplyToBot = isReplyToBotMessage(e)
            if (isReplyToBot) {
                return { triggered: true, msg: rawMsg, reason: '引用机器人消息' }
            }
        }
        
        // 3. 前缀触发（包括前缀人格）
        if (groupCfg.prefix) {
            const result = this.checkPrefix(rawMsg, triggerCfg.prefixes, triggerCfg.prefixPersonas)
            if (result.matched) {
                return { 
                    triggered: true, 
                    msg: result.content, 
                    reason: result.isPersonaPrefix ? `前缀人格[${result.prefix}]` : `前缀[${result.prefix}]`,
                    persona: result.persona,
                    isPersonaPrefix: result.isPersonaPrefix
                }
            }
        }
        
        // 4. 关键词触发
        if (groupCfg.keyword) {
            const result = this.checkKeyword(rawMsg, triggerCfg.keywords)
            if (result.matched) {
                return { triggered: true, msg: rawMsg, reason: `关键词[${result.keyword}]` }
            }
        }
        
        // 5. 随机触发
        if (groupCfg.random) {
            const rate = groupCfg.randomRate || 0.05
            if (Math.random() < rate) {
                return { triggered: true, msg: rawMsg, reason: `随机(${(rate*100).toFixed(0)}%)` }
            }
        }
        
        return { triggered: false, msg: '', reason: '未满足触发条件' }
    }
    
    /**
     * 检查前缀（前缀视为@，如"残花你好"或"残花 你好"都能触发）
     * @param {string} msg - 消息内容
     * @param {string[]} prefixes - 普通前缀列表
     * @param {Array} prefixPersonas - 前缀人格配置
     */
    checkPrefix(msg, prefixes = [], prefixPersonas = []) {
        // 1. 检查前缀人格（优先级更高）
        if (Array.isArray(prefixPersonas) && prefixPersonas.length > 0) {
            for (const persona of prefixPersonas) {
                if (!persona?.prefix) continue
                const prefix = persona.prefix.trim()
                if (msg.startsWith(prefix)) {
                    const content = msg.slice(prefix.length).trimStart()
                    return { 
                        matched: true, 
                        prefix, 
                        content,
                        persona: persona.preset || persona.systemPrompt,
                        isPersonaPrefix: true
                    }
                }
            }
        }
        
        // 2. 检查普通前缀
        if (!Array.isArray(prefixes)) prefixes = [prefixes]
        prefixes = prefixes.filter(p => p && typeof p === 'string' && p.trim()).map(p => p.trim())
        
        for (const prefix of prefixes) {
            if (msg.startsWith(prefix)) {
                const content = msg.slice(prefix.length).trimStart()
                return { matched: true, prefix, content, isPersonaPrefix: false }
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
     * @param {Object} personaOptions - 前缀人格选项
     */
    async handleChat(triggerCfg, processedMsg = null, personaOptions = {}) {
        const e = this.e
        const userId = e.user_id?.toString()
        const groupId = e.group_id?.toString() || null
        const featuresConfig = config.get('features') || {}
        
        // 前缀人格配置
        const { persona, isPersonaPrefix } = personaOptions
        
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
        // 提取图片：支持 image 和 image_url 两种类型
        const images = userMessage.content?.filter(c => 
            c.type === 'image' || c.type === 'image_url'
        ) || []
        
        
        // 构建请求选项
        const chatOptions = {
            userId,
            message: textContent,
            images,
            event: e,
            mode: 'chat',
            parsedMessage: userMessage
        }
        
        // 如果使用前缀人格，传递人格配置
        if (isPersonaPrefix && persona) {
            chatOptions.prefixPersona = persona
        }
        
        try {
            const result = await chatService.sendMessage(chatOptions)

            // 发送回复
            if (result.response && result.response.length > 0) {
                const replyContent = this.formatReply(result.response)
                if (replyContent) {
                    // 记录发送的消息（用于防止自身消息循环）
                    const textContent = result.response
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                    if (textContent) {
                        recordSentMessage(textContent)
                    }
                    
                    await this.reply(replyContent, true)
                }
            }

            return true
        } catch (error) {
            logger.error('[ChatListener] 对话出错:', error.message)
            return false
        }
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
        } catch {
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
        } catch {
            return null
        }
    }
}
