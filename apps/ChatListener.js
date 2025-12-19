import { chatService } from '../src/services/llm/ChatService.js'
import { parseUserMessage, segment, CardParser, MessageApi, MessageUtils } from '../src/utils/messageParser.js'
import { setToolContext } from '../src/core/utils/toolAdapter.js'
import { mcpManager } from '../src/mcp/McpManager.js'
import { memoryManager } from '../src/services/storage/MemoryManager.js'
import { statsService } from '../src/services/stats/StatsService.js'
import config from '../config/config.js'
import { isMessageProcessed, markMessageProcessed, isSelfMessage, isReplyToBotMessage, recordSentMessage } from '../src/utils/messageDedup.js'
import { isDebugEnabled } from './Commands.js'
import { cacheGroupMessage } from './GroupEvents.js'

export class ChatListener extends plugin {
    constructor() {
        const listenerConfig = config.get('listener') || {}
        
        super({
            name: 'AI群聊监听',
            dsc: 'AI聊天监听器，支持@触发和前缀触发',
            event: 'message',
            priority: listenerConfig.priority ?? 500, 
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
        if (isSelfMessage(e)) {
            return false
        }
        
        // 缓存群消息用于撤回检测
        if (e.isGroup && e.message_id) {
            try {
                cacheGroupMessage(e)
            } catch {}
        }
        const listenerEnabled = config.get('listener.enabled')
        if (listenerEnabled === false) {
            if (e.isGroup && e.group_id && config.get('trigger.collectGroupMsg') !== false) {
                try {
                    memoryManager.collectGroupMessage(String(e.group_id), {
                        user_id: e.user_id,
                        sender: e.sender,
                        msg: e.msg,
                        raw_message: e.raw_message
                    })
                } catch {
                }
            }
            return false
        }
        let triggerCfg = config.get('trigger')
        if (!triggerCfg || !triggerCfg.private) {
            const listenerConfig = config.get('listener') || {}
            triggerCfg = this.convertLegacyConfig(listenerConfig)
        }
        if (e.isGroup && e.group_id && triggerCfg.collectGroupMsg !== false) {
            try {
                memoryManager.collectGroupMessage(String(e.group_id), {
                    user_id: e.user_id,
                    sender: e.sender,
                    msg: e.msg,
                    raw_message: e.raw_message
                })
            } catch {
            }
        }
        if (isMessageProcessed(e)) {
            return false
        }
        const rawMsg = e.msg || ''
        const systemCmdPatterns = [
            /^#(结束对话|清除记忆|我的记忆|删除记忆|群聊总结|总结群聊|群消息总结|画像总结)/,
            /^#chatdebug/i,
            /^#ai/i
        ]
        for (const pattern of systemCmdPatterns) {
            if (pattern.test(rawMsg)) {
                logger.debug(`[ChatListener] 跳过系统命令: ${rawMsg.substring(0, 20)}`)
                return false
            }
        }
        const allowHashCmds = triggerCfg.allowHashCommands === true
        if (!allowHashCmds && /^#\S/.test(rawMsg)) {
            const cleanedForCheck = this.cleanAtBot ? this.cleanAtBot(rawMsg, e) : rawMsg
            if (/^#\S/.test(cleanedForCheck.trim())) {
                logger.debug(`[ChatListener] 跳过#命令(交给其他插件): ${rawMsg.substring(0, 30)}`)
                return false
            }
        }
        if (!this.checkAccess(triggerCfg)) {
            return false
        }
        const triggerResult = this.checkTrigger(triggerCfg)
        if (!triggerResult.triggered) {
            return false
        }
        markMessageProcessed(e)
        try {
            await this.handleChat(triggerCfg, triggerResult.msg, {
                persona: triggerResult.persona,
                isPersonaPrefix: triggerResult.isPersonaPrefix
            })
            return listenerConfig.blockOther ?? false
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
        const triggerCfg = cfg.private ? cfg : this.convertLegacyConfig(cfg)
        if (!e.isGroup) {
            const privateCfg = triggerCfg.private || {}
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
            if (mode === 'off') {
                return { triggered: false, msg: '', reason: '私聊模式关闭' }
            }
            return { triggered: true, msg: rawMsg, reason: '私聊默认响应' }
        }

        const groupCfg = triggerCfg.group || {}
        if (!groupCfg.enabled) {
            return { triggered: false, msg: '', reason: '群聊已禁用' }
        }
        
        // 1. @触发（优先级最高）
        if (groupCfg.at && e.atBot) {
            const isReplyToBot = isReplyToBotMessage(e)
            const hasReply = !!e.source
            const cleanedMsg = this.cleanAtBot(rawMsg, e)
            if (!cleanedMsg.trim()) {
                logger.debug(`[ChatListener] 仅@无内容，跳过让其他插件处理`)
                return { triggered: false, msg: '', reason: '仅@无内容' }
            }
            
            if (isReplyToBot) {
                if (groupCfg.replyBot) {
                    return { triggered: true, msg: cleanedMsg, reason: '引用机器人消息' }
                }
            } else if (hasReply) {
                return { triggered: true, msg: cleanedMsg, reason: '@机器人(含引用)' }
            } else {
                return { triggered: true, msg: cleanedMsg, reason: '@机器人' }
            }
        }
        if (groupCfg.replyBot && e.source && !e.atBot) {
            const isReplyToBot = isReplyToBotMessage(e)
            if (isReplyToBot) {
                return { triggered: true, msg: rawMsg, reason: '引用机器人消息' }
            }
        }
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
        if (groupCfg.keyword) {
            const result = this.checkKeyword(rawMsg, triggerCfg.keywords)
            if (result.matched) {
                return { triggered: true, msg: rawMsg, reason: `关键词[${result.keyword}]` }
            }
        }
        if (groupCfg.random) {
            const rate = groupCfg.randomRate || 0.05
            if (Math.random() < rate) {
                return { triggered: true, msg: rawMsg, reason: `随机(${(rate*100).toFixed(0)}%)` }
            }
        }
        
        return { triggered: false, msg: '', reason: '未满足触发条件' }
    }
    
    /**
     * @param {string} msg - 消息内容
     * @param {string[]} prefixes - 普通前缀列表
     * @param {Array} prefixPersonas - 前缀人格配置
     */
    checkPrefix(msg, prefixes = [], prefixPersonas = []) {
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
     * 从消息中去除 @机器人 部分
     * @param {string} text - 原始消息
     * @param {Object} e - 事件对象
     * @returns {string} 清理后的消息
     */
    cleanAtBot(text, e) {
        if (!text) return ''
        // 获取机器人QQ号
        const botId = e.self_id || e.bot?.uin || Bot?.uin
        if (!botId) return text
        
        // 去除 @机器人 的各种格式
        let cleaned = text
            // 去除 @QQ号 格式（带空格）
            .replace(new RegExp(`\\s*@${botId}\\s*`, 'g'), ' ')
            // 去除 @昵称 格式（如果有机器人昵称）
            .replace(new RegExp(`\\s*@${e.bot?.nickname || ''}\\s*`, 'gi'), ' ')
            // 清理多余空格
            .replace(/\s+/g, ' ')
            .trim()
        return cleaned
    }
    
    /**
     * 兼容旧配置
     */
    convertLegacyConfig(oldCfg) {
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
        const { persona, isPersonaPrefix } = personaOptions
        let debugMode = isDebugEnabled(e)
        let msgForChat = processedMsg
        if (msgForChat && /\s+debug\s*$/i.test(msgForChat)) {
            debugMode = true
            msgForChat = msgForChat.replace(/\s+debug\s*$/i, '').trim()
            logger.info('[ChatListener] Debug模式已启用(单次)')
        }
        
        // debug 日志收集
        const debugLogs = []
        const addDebugLog = (title, content) => {
            if (debugMode) {
                debugLogs.push({ title, content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) })
            }
        }
        
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

        // 使用已处理的消息（去除触发词后），如果没有则从解析结果获取
        const rawTextContent = userMessage.content?.find(c => c.type === 'text')?.text?.trim()
        const textContent = msgForChat?.trim() || rawTextContent
        
        // 检查消息是否有效
        if (!textContent && userMessage.content?.length === 0) {
            return false
        }
        
        // 记录消息统计
        try {
            const msgTypes = userMessage.content?.map(c => c.type) || ['text']
            for (const type of msgTypes) {
                statsService.recordMessage({
                    type,
                    groupId,
                    userId,
                    source: e.adapter || 'unknown'
                })
            }
        } catch (e) {
            // 统计失败不影响主流程
        }
        if (processedMsg && userMessage.content) {
            const textItem = userMessage.content.find(c => c.type === 'text')
            if (textItem) {
                textItem.text = textContent
            }
        }
        setToolContext({ event: e, bot: e.bot || Bot })
        mcpManager.setToolContext({ event: e, bot: e.bot || Bot })
        const images = userMessage.content?.filter(c => 
            c.type === 'image' || c.type === 'image_url'
        ) || []
        let finalMessage = textContent
        if (userMessage.quote) {
            const quoteSender = userMessage.quote.sender?.card || 
                               userMessage.quote.sender?.nickname || 
                               userMessage.quote.sender?.user_id || '某人'
            const quoteText = typeof userMessage.quote.content === 'string' 
                ? userMessage.quote.content 
                : (userMessage.quote.raw_message || '')
            if (quoteText) {
                finalMessage = `[引用 ${quoteSender} 的消息: "${quoteText}"]\n${textContent}`
                logger.debug(`[ChatListener] 添加引用消息到上下文: ${quoteText.substring(0, 50)}...`)
            }
        }
        
        // 构建请求选项
        const chatOptions = {
            userId,
            message: finalMessage,
            images,
            event: e,
            mode: 'chat',
            parsedMessage: userMessage,
            debugMode
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
                    const replyTextContent = result.response
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                    if (replyTextContent) {
                        recordSentMessage(replyTextContent)
                    }
                    
                    const quoteReply = config.get('basic.quoteReply') === true
                    await this.reply(replyContent, quoteReply)
                }
            }
            
            // 处理 debug 信息
            if (debugMode && result.debugInfo) {
                const di = result.debugInfo
                
                // 收集调试信息
                if (di.channel) {
                    addDebugLog('📡 渠道信息', {
                        id: di.channel.id,
                        name: di.channel.name,
                        adapter: di.channel.adapterType,
                        baseUrl: di.channel.baseUrl,
                        modelsCount: di.channel.modelsCount
                    })
                }
                
                if (di.preset) {
                    addDebugLog('🎭 预设信息', {
                        id: di.preset.id,
                        name: di.preset.name,
                        enableTools: di.preset.enableTools
                    })
                }
                
                if (di.scope) {
                    addDebugLog('🎯 Scope信息', di.scope)
                }
                
                if (di.memory) {
                    addDebugLog('🧠 记忆信息', di.memory)
                }
                
                if (di.knowledge) {
                    addDebugLog('📚 知识库', {
                        hasKnowledge: di.knowledge.hasKnowledge,
                        length: di.knowledge.length
                    })
                }
                
                addDebugLog('📤 请求信息', {
                    model: di.request?.model,
                    usedModel: di.usedModel,
                    messagesCount: di.request?.messagesCount,
                    toolsCount: di.request?.toolsCount,
                    systemPromptLength: di.request?.systemPromptLength
                })
                
                if (di.request?.systemPromptFull) {
                    // 限制系统提示词长度，避免转发消息过长
                    const maxLen = 2000
                    let prompt = di.request.systemPromptFull
                    if (prompt.length > maxLen) {
                        prompt = prompt.substring(0, maxLen) + `\n\n... (已截断，共 ${di.request.systemPromptFull.length} 字符)`
                    }
                    addDebugLog('📋 系统提示词', prompt)
                }
                
                if (di.availableTools?.length > 0) {
                    addDebugLog('🛠️ 可用工具', `共 ${di.availableTools.length} 个: ${di.availableTools.join(', ')}`)
                }
                
                if (di.toolCalls?.length > 0) {
                    addDebugLog('🔧 工具调用', di.toolCalls)
                }
                
                addDebugLog('📥 响应信息', di.response || '无')
                addDebugLog('📊 Token用量', result.usage || '无')
                
                if (di.timing) {
                    addDebugLog('⏱️ 耗时', `${di.timing.duration}ms`)
                }
                
                // 发送调试信息
                if (debugLogs.length > 0) {
                    try {
                        const debugMessages = debugLogs.map(log => {
                            let content = log.content
                            if (typeof content === 'object') {
                                content = JSON.stringify(content, null, 2)
                            }
                            return `【${log.title}】\n${content}`
                        })
                        await this.sendForwardMsg('🔍 Debug调试信息', debugMessages)
                    } catch (err) {
                        logger.warn('[ChatListener] 调试信息发送失败:', err.message)
                    }
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
