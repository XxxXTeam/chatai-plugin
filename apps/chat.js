import config from '../config/config.js'
import { cleanCQCode, parseUserMessage, segment } from '../src/utils/messageParser.js'
import { isDebugEnabled } from './Commands.js'
import {
    escapeRegExp,
    recordSentMessage,
    markMessageProcessed,
    startProcessingMessage,
    isMessageProcessed,
    isSelfMessage,
    isReplyToBotMessage,
    getBotIds
} from '../src/utils/messageDedup.js'
import { renderService } from '../src/services/media/RenderService.js'
import { cacheGroupMessage } from './GroupEvents.js'
import { emojiThiefService } from './EmojiThief.js'
import { chatService } from '../src/services/llm/ChatService.js'
import { memoryManager } from '../src/services/storage/MemoryManager.js'
import { statsService } from '../src/services/stats/StatsService.js'
import { ensureScopeManager } from '../src/services/scope/ScopeManager.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { checkAccessList, sendForwardMsg as platformSendForwardMsg } from '../src/utils/platformAdapter.js'
import { mcpManager } from '../src/mcp/McpManager.js'
import { setToolContext } from '../src/core/utils/toolAdapter.js'
import { conversationTracker } from '../src/services/llm/ConversationTracker.js'

export {
    recordSentMessage,
    markMessageProcessed,
    startProcessingMessage,
    isMessageProcessed,
    isSelfMessage,
    isReplyToBotMessage,
    getBotIds
}

// 群组触发配置缓存
const groupTriggerCache = new Map()
const CACHE_TTL = 60000

async function getGroupTriggerConfig(groupId) {
    if (!groupId) return {}
    const cacheKey = String(groupId)
    const cached = groupTriggerCache.get(cacheKey)
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.config
    }
    try {
        const scopeManager = await ensureScopeManager()
        const groupSettings = await scopeManager.getGroupSettings(cacheKey)
        const settings = groupSettings?.settings || {}
        const cfg = {
            triggerMode: settings.triggerMode,
            customPrefix: settings.customPrefix,
            prefixPersonas: settings.prefixPersonas
        }
        groupTriggerCache.set(cacheKey, { config: cfg, time: Date.now() })
        return cfg
    } catch {
        return {}
    }
}

export class Chat extends plugin {
    constructor() {
        super({
            name: 'AI-Chat',
            dsc: 'AI对话功能',
            event: 'message',
            priority: 500,
            rule: [
                {
                    reg: '',
                    fnc: 'handleMessage',
                    log: false
                }
            ]
        })
    }

    /**
     * 统一消息处理入口
     */
    async handleMessage() {
        const e = this.e

        if (isSelfMessage(e)) return false
        if (isMessageProcessed(e)) return false

        // 缓存群消息
        if (e.isGroup && e.message_id) {
            try {
                cacheGroupMessage(e)
            } catch {}
        }

        // 检查监听器是否启用
        const listenerEnabled = config.get('listener.enabled')
        if (listenerEnabled === false) {
            this.collectGroupMessage(e)
            return false
        }

        // 获取触发配置
        let triggerCfg = this.getTriggerConfig()

        // 群消息收集
        if (e.isGroup && e.group_id && triggerCfg.collectGroupMsg !== false) {
            this.collectGroupMessage(e)
        }

        // 检查系统命令
        const rawMsg = e.msg || ''
        const systemCmdPatterns = [
            /^#(结束对话|清除记忆|我的记忆|删除记忆|群聊总结|总结群聊|群消息总结|画像总结)/,
            /^#chatdebug/i,
            /^#ai/i
        ]
        for (const pattern of systemCmdPatterns) {
            if (pattern.test(rawMsg)) return false
        }

        // 检查#命令
        const allowHashCmds = triggerCfg.allowHashCommands === true
        if (!allowHashCmds && /^#\S/.test(rawMsg)) {
            const cleanedForCheck = this.cleanAtBot(rawMsg)
            if (/^#\S/.test(cleanedForCheck.trim())) return false
        }

        // 检查访问权限
        if (!this.checkAccess(triggerCfg)) return false

        // 检查群组独立黑白名单
        if (e.isGroup && e.group_id) {
            const groupAccess = await this.checkGroupAccess(e.group_id, e.user_id)
            if (!groupAccess.allowed) {
                logger.debug(`[Chat] 群组黑白名单拒绝: ${groupAccess.reason}`)
                return false
            }
        }

        // 获取群组独立配置
        if (e.isGroup && e.group_id) {
            const groupConfig = await getGroupTriggerConfig(e.group_id)
            if (groupConfig.triggerMode && groupConfig.triggerMode !== 'default') {
                const mode = groupConfig.triggerMode
                if (!triggerCfg.group) triggerCfg.group = {}
                triggerCfg.group.at = mode === 'at' || mode === 'all'
                triggerCfg.group.prefix = mode === 'prefix' || mode === 'all'
                triggerCfg.group.keyword = mode === 'all'
                triggerCfg.group.random = false
            }
            if (groupConfig.customPrefix) {
                if (!triggerCfg.prefixes) triggerCfg.prefixes = []
                if (!triggerCfg.prefixes.includes(groupConfig.customPrefix)) {
                    triggerCfg.prefixes = [groupConfig.customPrefix, ...triggerCfg.prefixes]
                }
            }
            if (Array.isArray(groupConfig.prefixPersonas) && groupConfig.prefixPersonas.length > 0) {
                const globalPrefixPersonas = triggerCfg.prefixPersonas || []
                triggerCfg.prefixPersonas = [...groupConfig.prefixPersonas, ...globalPrefixPersonas]
            }
        }

        // 检查触发条件
        const triggerResult = await this.checkTriggerWithTracking(triggerCfg)
        if (!triggerResult.triggered) return false

        // 标记消息正在处理
        if (!startProcessingMessage(e)) return false
        markMessageProcessed(e)
        e.toICQQ = true
        // 处理聊天
        return this.processChat(triggerResult.msg, {
            persona: triggerResult.persona,
            isPersonaPrefix: triggerResult.isPersonaPrefix
        })
    }

    /**
     * 获取触发配置
     */
    getTriggerConfig() {
        let triggerCfg = config.get('trigger')
        if (!triggerCfg?.private) {
            const listenerConfig = config.get('listener') || {}
            let prefixes = listenerConfig.triggerPrefix || ['#chat']
            if (typeof prefixes === 'string') prefixes = [prefixes]
            const triggerMode = listenerConfig.triggerMode || 'at'
            triggerCfg = {
                private: {
                    enabled: listenerConfig.privateChat?.enabled ?? true,
                    mode: listenerConfig.privateChat?.alwaysReply ? 'always' : 'prefix'
                },
                group: {
                    enabled: listenerConfig.groupChat?.enabled ?? true,
                    at: ['at', 'both'].includes(triggerMode),
                    prefix: ['prefix', 'both'].includes(triggerMode),
                    keyword: triggerMode === 'both',
                    random: triggerMode === 'random',
                    randomRate: listenerConfig.randomReplyRate || 0.1,
                    replyBot: listenerConfig.groupChat?.replyBot ?? true
                },
                prefixes,
                keywords: listenerConfig.triggerKeywords || [],
                prefixPersonas: listenerConfig.prefixPersonas || [],
                blacklistUsers: listenerConfig.blacklistUsers || [],
                whitelistUsers: listenerConfig.whitelistUsers || [],
                blacklistGroups: listenerConfig.blacklistGroups || [],
                whitelistGroups: listenerConfig.whitelistGroups || [],
                collectGroupMsg: listenerConfig.groupChat?.collectMessages ?? true
            }
        }
        return JSON.parse(JSON.stringify(triggerCfg))
    }

    /**
     * 检查访问权限
     */
    checkAccess(cfg) {
        const e = this.e
        return checkAccessList(e.user_id, e.isGroup ? e.group_id : null, cfg)
    }

    /**
     * 检查群组独立黑白名单
     * @param {string} groupId - 群组ID
     * @param {string} userId - 用户ID
     * @returns {Promise<{allowed: boolean, reason?: string}>}
     */
    async checkGroupAccess(groupId, userId) {
        if (!groupId) return { allowed: true }

        try {
            const scopeManager = await ensureScopeManager()
            const groupSettings = await scopeManager.getGroupSettings(String(groupId))
            const settings = groupSettings?.settings || {}

            const listMode = settings.listMode || 'none'
            const blacklist = settings.blacklist || []
            const whitelist = settings.whitelist || []

            // 黑名单模式
            if (listMode === 'blacklist' && blacklist.includes(String(userId))) {
                return { allowed: false, reason: '您已被加入本群黑名单，无法使用AI功能' }
            }

            // 白名单模式
            if (listMode === 'whitelist' && !whitelist.includes(String(userId))) {
                return { allowed: false, reason: '本群已启用白名单模式，您不在白名单中' }
            }
        } catch (err) {
            logger.debug('[Chat] 检查群组黑白名单失败:', err.message)
        }

        return { allowed: true }
    }

    /**
     * 检查触发条件
     */
    checkTrigger(cfg) {
        const e = this.e
        const rawMsg = e.msg || ''

        // 私聊
        if (!e.isGroup) {
            const privateCfg = cfg.private || {}
            if (privateCfg.enabled === false) return { triggered: false }

            // 先检查前缀
            const prefixResult = this.checkPrefix(rawMsg, cfg.prefixes, cfg.prefixPersonas)
            if (prefixResult.matched) {
                return {
                    triggered: true,
                    msg: prefixResult.content,
                    persona: prefixResult.persona,
                    isPersonaPrefix: prefixResult.isPersonaPrefix
                }
            }

            const mode = privateCfg.mode || 'always'
            if (mode === 'always') {
                return { triggered: true, msg: rawMsg }
            }
            return { triggered: false }
        }

        // 群聊
        const groupCfg = cfg.group || {}
        if (!groupCfg.enabled) return { triggered: false }

        // @触发（兼容不设置 e.atBot 的适配器：额外检查消息中的 at 段）
        const botId = e.self_id || e.bot?.uin || Bot?.uin
        const isAtBot =
            e.atBot ||
            (botId &&
                e.message?.some?.(
                    seg =>
                        (seg.type === 'at' && String(seg.qq) === String(botId)) ||
                        (seg.type === 'at' && String(seg.data?.qq) === String(botId))
                ))
        if (groupCfg.at && isAtBot) {
            const isReplyToBot = isReplyToBotMessage(e)
            const hasReply = !!e.source
            const cleanedMsg = this.cleanAtBot(rawMsg)

            if (!cleanedMsg.trim()) return { triggered: false }

            if (isReplyToBot && groupCfg.replyBot) {
                return { triggered: true, msg: cleanedMsg }
            } else if (!isReplyToBot) {
                return { triggered: true, msg: cleanedMsg }
            }
        }

        // 引用机器人
        if (groupCfg.replyBot && e.source && !e.atBot && isReplyToBotMessage(e)) {
            return { triggered: true, msg: rawMsg }
        }

        // 前缀触发
        if (groupCfg.prefix) {
            const cleanedForPrefix = this.cleanAtBot(rawMsg)
            const result = this.checkPrefix(cleanedForPrefix, cfg.prefixes, cfg.prefixPersonas)
            if (result.matched) {
                return {
                    triggered: true,
                    msg: result.content,
                    persona: result.persona,
                    isPersonaPrefix: result.isPersonaPrefix
                }
            }
        }

        // 关键词触发
        if (groupCfg.keyword && cfg.keywords?.length > 0) {
            for (const kw of cfg.keywords) {
                if (kw && rawMsg.includes(kw)) {
                    return { triggered: true, msg: rawMsg }
                }
            }
        }

        // 随机触发
        if (groupCfg.random) {
            const rate = groupCfg.randomRate || 0.05
            if (Math.random() < rate) {
                return { triggered: true, msg: rawMsg }
            }
        }

        return { triggered: false }
    }

    /**
     * 带会话追踪的触发检查
     * 在显式触发后开始追踪，追踪期内通过AI判断是否继续对话
     */
    async checkTriggerWithTracking(cfg) {
        const e = this.e

        // 初始化会话追踪
        conversationTracker.init()

        // 先检查常规触发条件
        const baseResult = this.checkTrigger(cfg)

        // 如果常规触发成功
        if (baseResult.triggered) {
            // 群聊时开始会话追踪
            if (e.isGroup && e.group_id && e.user_id) {
                const groupId = String(e.group_id)
                const userId = String(e.user_id)

                if (conversationTracker.isEnabled()) {
                    conversationTracker.startTracking(groupId, userId)
                    logger.debug(`[Chat] 开始会话追踪: ${groupId}_${userId}`)
                }
            }
            return baseResult
        }

        // 常规触发失败，检查会话追踪
        if (!e.isGroup || !e.group_id || !e.user_id) {
            return { triggered: false }
        }

        if (!conversationTracker.isEnabled()) {
            return { triggered: false }
        }

        const groupId = String(e.group_id)
        const userId = String(e.user_id)

        // 检查是否在追踪期内
        if (!conversationTracker.isTracking(groupId, userId)) {
            return { triggered: false }
        }

        // 节流检查
        if (conversationTracker.isThrottled(groupId, userId)) {
            return { triggered: false }
        }

        // 更新节流时间
        conversationTracker.updateThrottle(groupId, userId)

        // 获取对话历史
        const activeConv = conversationTracker.getActiveConversation(groupId, userId)
        const chatHistory = activeConv?.chatHistory || []

        // 构建用户消息
        const senderName = e.sender?.card || e.sender?.nickname || '未知用户'
        const userMessage = `${senderName}: ${e.msg || ''}`

        // 使用批量判断队列（减少API调用）
        const isTalking = await conversationTracker.addToBatchJudgment(groupId, userId, userMessage, chatHistory, e)

        if (isTalking) {
            // 重置追踪定时器
            conversationTracker.startTracking(groupId, userId)
            logger.debug(`[Chat] 会话追踪判断为继续对话: ${groupId}_${userId}`)
            return { triggered: true, msg: e.msg || '' }
        }

        return { triggered: false }
    }

    /**
     * 检查前缀
     */
    checkPrefix(msg, prefixes = [], prefixPersonas = []) {
        // 前缀人格
        if (Array.isArray(prefixPersonas) && prefixPersonas.length > 0) {
            for (const persona of prefixPersonas) {
                if (!persona?.prefix) continue
                const prefix = persona.prefix.trim()
                if (msg.startsWith(prefix)) {
                    return {
                        matched: true,
                        prefix,
                        content: msg.slice(prefix.length).trimStart(),
                        persona: persona.preset || persona.systemPrompt,
                        isPersonaPrefix: true
                    }
                }
            }
        }
        // 普通前缀
        if (!Array.isArray(prefixes)) prefixes = [prefixes]
        prefixes = prefixes.filter(p => p && typeof p === 'string' && p.trim()).map(p => p.trim())
        for (const prefix of prefixes) {
            if (msg.startsWith(prefix)) {
                return { matched: true, prefix, content: msg.slice(prefix.length).trimStart(), isPersonaPrefix: false }
            }
        }
        return { matched: false }
    }

    /**
     * 清理@机器人（保留其他@）
     * 支持多种格式：CQ码、纯文本@botId、@机器人昵称
     */
    cleanAtBot(text) {
        if (!text) return ''
        const e = this.e
        const botId = e.self_id || e.bot?.uin || Bot?.uin
        if (!botId) return text

        let result = text

        // 1. 清理CQ码格式: [CQ:at,qq=botId] 或 [CQ:at,qq=botId,text=xxx]
        result = result.replace(new RegExp(`\\[CQ:at,qq=${botId}[^\\]]*\\]`, 'gi'), '')

        // 2. 清理纯文本@botId格式（注意保留后续内容）
        // 使用前瞻确保不会误删其他@：只删除@botId后面跟着空白或结尾的情况
        result = result.replace(new RegExp(`@${botId}(?=\\s|$|@)`, 'g'), '')

        // 3. 清理@机器人昵称（如果有）
        const botNickname = e.bot?.nickname
        if (botNickname) {
            const escapedNickname = botNickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            result = result.replace(new RegExp(`@${escapedNickname}(?=\\s|$|@)`, 'gi'), '')
        }

        // 4. 清理多余空格，保留单个空格分隔
        result = result.replace(/\s+/g, ' ').trim()

        return result
    }

    /**
     * 收集群消息
     */
    collectGroupMessage(e) {
        if (!e.isGroup || !e.group_id) return
        try {
            memoryManager.collectGroupMessage(String(e.group_id), {
                user_id: e.user_id,
                sender: e.sender,
                msg: e.msg,
                raw_message: e.raw_message
            })
        } catch {}
    }

    /**
     * 处理聊天
     */
    async processChat(msg, options = {}) {
        const e = this.e
        const { persona, isPersonaPrefix } = options

        // 检测 debug 模式
        let debugMode = isDebugEnabled(e)
        let msgForChat = msg
        if (msgForChat && /\s+debug\s*$/i.test(msgForChat)) {
            debugMode = true
            msgForChat = msgForChat.replace(/\s+debug\s*$/i, '').trim()
        }

        const debugLogs = []
        const addDebugLog = (title, content) => {
            if (debugMode) {
                debugLogs.push({
                    title,
                    content: typeof content === 'string' ? content : JSON.stringify(content, null, 2)
                })
            }
        }

        // 解析消息
        const featuresConfig = config.get('features') || {}
        const parsedMessage = await parseUserMessage(e, {
            handleReplyText: featuresConfig.replyQuote?.handleText ?? true,
            handleReplyImage: featuresConfig.replyQuote?.handleImage ?? true,
            handleReplyFile: featuresConfig.replyQuote?.handleFile ?? true,
            handleForward: featuresConfig.replyQuote?.handleForward ?? true,
            handleAtMsg: true,
            excludeAtBot: true,
            includeSenderInfo: true,
            includeDebugInfo: debugMode
        })

        const rawTextContent = parsedMessage.content?.find(c => c.type === 'text')?.text?.trim()
        const textContent = msgForChat?.trim() || rawTextContent

        if (!textContent && (!parsedMessage.content || parsedMessage.content.length === 0)) {
            return false
        }

        // 记录统计
        try {
            const msgTypes = parsedMessage.content?.map(c => c.type) || ['text']
            for (const type of msgTypes) {
                statsService.recordMessage({
                    type,
                    groupId: e.group_id?.toString() || null,
                    userId: e.user_id?.toString(),
                    source: e.adapter || 'unknown'
                })
            }
        } catch {}

        // 设置工具上下文
        setToolContext({ event: e, bot: e.bot || Bot })
        mcpManager.setToolContext({ event: e, bot: e.bot || Bot })

        // 处理图片
        const images = parsedMessage.content?.filter(c => c.type === 'image' || c.type === 'image_url') || []

        // 处理引用消息
        let finalMessage = textContent
        if (parsedMessage.quote) {
            const quoteSender = parsedMessage.quote.sender?.card || parsedMessage.quote.sender?.nickname || '某人'
            const quoteText =
                typeof parsedMessage.quote.content === 'string'
                    ? parsedMessage.quote.content
                    : parsedMessage.quote.raw_message || ''
            if (quoteText) {
                finalMessage = `[引用 ${quoteSender} 的消息: "${quoteText}"]\n${textContent}`
            }
        }

        const userId = e.user_id?.toString()
        const groupId = e.group_id?.toString() || null

        // 构建请求
        const chatOptions = {
            userId,
            groupId,
            message: finalMessage,
            images,
            event: e,
            mode: 'chat',
            parsedMessage,
            debugMode
        }

        if (isPersonaPrefix && persona) {
            chatOptions.prefixPersona = persona
        }

        try {
            // 显示思考提示
            if (config.get('basic.showThinkingMessage') !== false) {
                await this.reply('思考中...', true)
            }

            const result = await chatService.sendMessage(chatOptions)

            // 处理回复
            if (result.response && result.response.length > 0) {
                const replyContent = this.formatReply(result.response)
                if (replyContent) {
                    const replyTextContent = result.response
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                    if (replyTextContent) {
                        recordSentMessage(replyTextContent)

                        // 更新会话追踪历史
                        if (e.isGroup && e.group_id && e.user_id && conversationTracker.isEnabled()) {
                            const gid = String(e.group_id)
                            const uid = String(e.user_id)
                            if (conversationTracker.isTracking(gid, uid)) {
                                // 记录用户消息和机器人回复
                                conversationTracker.addToHistory(gid, uid, 'user', finalMessage)
                                conversationTracker.addToHistory(gid, uid, 'bot', replyTextContent)
                            }
                        }
                    }

                    const quoteReply = config.get('basic.quoteReply') === true
                    const longTextCfg = config.get('output.longText') || {}
                    const mathRenderEnabled = config.get('render.mathFormula') !== false

                    let handled = false

                    // 检测数学公式并渲染
                    if (mathRenderEnabled && replyTextContent) {
                        const mathDetection = renderService.detectMathFormulas(replyTextContent)
                        if (mathDetection.hasMath && mathDetection.confidence !== 'low') {
                            try {
                                const imageBuffer = await renderService.renderMathContent(replyTextContent, {
                                    theme: config.get('render.theme') || 'light',
                                    width: config.get('render.width') || 800
                                })
                                const replyResult = await this.reply(segment.image(imageBuffer), quoteReply)
                                this.handleAutoRecall(replyResult, false)
                                handled = true
                            } catch {}
                        }
                    }

                    // 长文本合并转发处理
                    if (
                        !handled &&
                        longTextCfg.enabled !== false &&
                        replyTextContent.length > (longTextCfg.threshold || 500)
                    ) {
                        const mode = longTextCfg.mode || 'forward'
                        if (mode === 'image') {
                            try {
                                const { renderService } = await import('../src/services/media/RenderService.js')
                                const imageBuffer = await renderService.renderMarkdownToImage({
                                    markdown: replyTextContent,
                                    title: 'AI 回复',
                                    icon: '💬',
                                    theme: config.get('render.theme') || 'light',
                                    width: config.get('render.width') || 800
                                })
                                const replyResult = await this.reply(segment.image(imageBuffer), quoteReply)
                                this.handleAutoRecall(replyResult, false)
                                handled = true
                            } catch {
                                // 渲染失败，回退到普通发送
                            }
                        } else if (mode === 'forward' || mode === 'auto') {
                            try {
                                const paragraphs = replyTextContent.split(/\n{2,}/).filter(p => p.trim())
                                if (paragraphs.length > 0) {
                                    await this.sendForwardMsg(longTextCfg.forwardTitle || 'AI 回复', paragraphs)
                                    handled = true
                                }
                            } catch {
                                // 合并转发失败，回退到普通发送
                            }
                        }
                    }

                    // 默认直接输出
                    if (!handled) {
                        const replyResult = await this.reply(replyContent, quoteReply)
                        this.handleAutoRecall(replyResult, false)
                    }

                    // 表情包小偷
                    if (e.isGroup && e.group_id) {
                        try {
                            const emojiMsg = await emojiThiefService.tryTrigger(e, 'chat')
                            if (emojiMsg) {
                                await new Promise(r => setTimeout(r, Math.random() * 1000 + 300))
                                await this.reply(emojiMsg)
                            }
                        } catch {}
                    }
                }
            }

            // 发送调试信息
            if (debugMode && result.debugInfo) {
                this.sendDebugInfo(result.debugInfo, debugLogs)
            }
        } catch (error) {
            const userFriendlyError = this.formatErrorForUser(error)
            const errorResult = await this.reply(userFriendlyError, true)
            this.handleAutoRecall(errorResult, true)
        }

        return true
    }

    /**
     * 格式化回复
     */
    formatReply(response) {
        if (!response || !Array.isArray(response)) return null
        const messages = []
        for (const item of response) {
            switch (item.type) {
                case 'text':
                    if (item.text?.trim()) {
                        // 处理 @+数字 模式，转换为真实at
                        const processedParts = this.processAtMentions(item.text)
                        messages.push(...processedParts)
                    }
                    break
                case 'image':
                case 'image_url':
                    const url = item.url || item.image_url?.url
                    if (url) messages.push(segment.image(url))
                    break
                case 'audio':
                case 'record':
                    let audioData = item.url || item.data || item.file
                    if (audioData) {
                        if (
                            !audioData.startsWith('base64://') &&
                            !audioData.startsWith('http') &&
                            !audioData.startsWith('file://')
                        ) {
                            audioData = audioData.replace(/^data:audio\/[^;]+;base64,/, '')
                            audioData = `base64://${audioData}`
                        }
                        messages.push(segment.record(audioData))
                    }
                    break
            }
        }
        return messages.length > 0 ? messages : null
    }

    /**
     * 处理文本中的 @+数字 或 @+名字 模式，转换为真实at
     * @param {string} text - 原始文本
     * @returns {Array} 处理后的消息片段数组
     */
    processAtMentions(text) {
        const e = this.e
        if (!e?.isGroup || !e?.group_id) {
            // 非群聊环境，直接返回原文本
            return [text]
        }

        // 匹配 @数字 或 @名字 的模式（非真实at段）
        // 格式: @123456789 或 @昵称
        const atPattern = /@(\d{5,12}|[^\s@]{1,20})(?=\s|$|[，。！？,\.!?])/g

        const parts = []
        let lastIndex = 0
        let match

        while ((match = atPattern.exec(text)) !== null) {
            const fullMatch = match[0]
            const target = match[1]
            const matchStart = match.index

            // 添加匹配前的文本
            if (matchStart > lastIndex) {
                parts.push(text.slice(lastIndex, matchStart))
            }

            // 判断是数字还是名字
            const isNumeric = /^\d+$/.test(target)
            let atSegment = null

            if (isNumeric) {
                // 数字：直接作为QQ号尝试at
                const userId = parseInt(target)
                // 尝试验证用户是否在群内
                const memberInGroup = this.findMemberInGroup(userId)
                if (memberInGroup) {
                    atSegment = segment.at(userId)
                }
            } else {
                // 名字：尝试在群内查找
                const foundMember = this.findMemberByName(target)
                if (foundMember) {
                    atSegment = segment.at(foundMember.user_id || foundMember.uid)
                }
            }

            if (atSegment) {
                parts.push(atSegment)
            } else {
                // 找不到用户，保留原文本
                parts.push(fullMatch)
            }

            lastIndex = matchStart + fullMatch.length
        }

        // 添加剩余文本
        if (lastIndex < text.length) {
            parts.push(text.slice(lastIndex))
        }

        return parts.length > 0 ? parts : [text]
    }

    /**
     * 在群内查找成员（通过QQ号）
     * @param {number} userId - 用户QQ号
     * @returns {Object|null} 成员信息
     */
    findMemberInGroup(userId) {
        const e = this.e
        if (!e?.group?.getMemberMap) {
            // 尝试通过bot获取
            const bot = e?.bot || Bot
            const group = bot?.pickGroup?.(e.group_id)
            if (group?.getMemberMap) {
                try {
                    // 同步方式获取（如果有缓存）
                    const memberMap = group.gml || group._memberMap
                    if (memberMap instanceof Map) {
                        return memberMap.get(userId) || null
                    }
                } catch {}
            }
            return null
        }
        try {
            const memberMap = e.group.gml || e.group._memberMap
            if (memberMap instanceof Map) {
                return memberMap.get(userId) || null
            }
        } catch {}
        return null
    }

    /**
     * 通过名字在群内查找成员
     * @param {string} name - 昵称或群名片
     * @returns {Object|null} 成员信息
     */
    findMemberByName(name) {
        const e = this.e
        if (!name) return null

        const searchName = name.toLowerCase().trim()
        let memberMap = null

        // 获取成员Map
        if (e?.group?.gml instanceof Map) {
            memberMap = e.group.gml
        } else if (e?.group?._memberMap instanceof Map) {
            memberMap = e.group._memberMap
        } else {
            const bot = e?.bot || Bot
            const group = bot?.pickGroup?.(e.group_id)
            if (group?.gml instanceof Map) {
                memberMap = group.gml
            } else if (group?._memberMap instanceof Map) {
                memberMap = group._memberMap
            }
        }

        if (!memberMap) return null

        // 遍历查找
        for (const [uid, member] of memberMap) {
            const card = (member.card || '').toLowerCase()
            const nickname = (member.nickname || member.nick || '').toLowerCase()

            // 精确匹配
            if (card === searchName || nickname === searchName) {
                return { ...member, user_id: uid }
            }
        }

        // 模糊匹配
        for (const [uid, member] of memberMap) {
            const card = (member.card || '').toLowerCase()
            const nickname = (member.nickname || member.nick || '').toLowerCase()

            if (card.includes(searchName) || nickname.includes(searchName)) {
                return { ...member, user_id: uid }
            }
        }

        return null
    }

    /**
     * 发送调试信息
     */
    async sendDebugInfo(debugInfo, debugLogs) {
        const di = debugInfo
        if (di.channel) debugLogs.push({ title: '📡 渠道信息', content: JSON.stringify(di.channel, null, 2) })
        if (di.preset) debugLogs.push({ title: '🎭 预设信息', content: JSON.stringify(di.preset, null, 2) })
        if (di.scope) debugLogs.push({ title: '🎯 Scope信息', content: JSON.stringify(di.scope, null, 2) })
        if (di.memory) debugLogs.push({ title: '🧠 记忆信息', content: JSON.stringify(di.memory, null, 2) })
        if (di.request)
            debugLogs.push({
                title: '📤 请求信息',
                content: JSON.stringify({ model: di.request?.model, messagesCount: di.request?.messagesCount }, null, 2)
            })
        if (di.response) debugLogs.push({ title: '📥 响应信息', content: JSON.stringify(di.response, null, 2) })
        if (di.timing) debugLogs.push({ title: '⏱️ 耗时', content: `${di.timing.duration}ms` })

        if (debugLogs.length > 0) {
            try {
                const debugMessages = debugLogs.map(log => `【${log.title}】\n${log.content}`)
                await this.sendForwardMsg('🔍 Debug调试信息', debugMessages)
            } catch {}
        }
    }

    /**
     * 处理自动撤回
     */
    handleAutoRecall(replyResult, isError = false) {
        const autoRecall = config.get('basic.autoRecall')
        if (!autoRecall || autoRecall.enabled !== true) return
        if (isError && autoRecall.recallError !== true) return

        const delay = (autoRecall.delay || 60) * 1000
        const messageId = replyResult?.message_id || replyResult?.data?.message_id
        if (!messageId) return

        const e = this.e
        setTimeout(async () => {
            try {
                const currentConfig = config.get('basic.autoRecall')
                if (!currentConfig || currentConfig.enabled !== true) return
                const bot = e?.bot || Bot
                if (typeof bot?.deleteMsg === 'function') {
                    await bot.deleteMsg(messageId)
                } else if (typeof bot?.recallMsg === 'function') {
                    await bot.recallMsg(messageId)
                }
            } catch {}
        }, delay)
    }

    /**
     * 格式化错误信息
     */
    formatErrorForUser(error) {
        const msg = error.message || String(error)
        if (msg.includes('429') || msg.includes('Too Many Requests') || msg.includes('quota')) {
            const retryMatch = msg.match(/retry in ([\d.]+)s/i)
            const retryTime = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60
            return `⚠️ API 请求过于频繁，请 ${retryTime} 秒后重试`
        }
        if (msg.includes('401') || msg.includes('Unauthorized') || msg.includes('API key')) {
            return '⚠️ API 认证失败，请检查 API Key 配置'
        }
        if (msg.includes('404') || msg.includes('not found') || msg.includes('does not exist')) {
            return '⚠️ 模型不存在或不可用，请检查模型配置'
        }
        if (msg.includes('insufficient') || msg.includes('balance') || msg.includes('billing')) {
            return '⚠️ API 余额不足，请检查账户'
        }
        if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
            return '⚠️ 请求超时，请稍后重试'
        }
        if (msg.includes('ENOTFOUND') || msg.includes('network') || msg.includes('fetch')) {
            return '⚠️ 网络连接失败，请检查网络'
        }
        if (msg.includes('content') && (msg.includes('filter') || msg.includes('block') || msg.includes('safety'))) {
            return '⚠️ 内容被安全过滤，请换个话题'
        }
        const shortMsg = msg.split('\n')[0].substring(0, 100)
        return `出错了: ${shortMsg}${msg.length > 100 ? '...' : ''}`
    }

    /**
     * 发送合并转发消息
     */
    async sendForwardMsg(title, messages) {
        return platformSendForwardMsg(this.e, title, messages)
    }
}
