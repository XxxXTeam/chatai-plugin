/**
 * AI 群组事件处理 - 统一事件监听系统
 * 支持自定义提示词模板和占位符
 * 
 * 占位符说明:
 * - {nickname}     触发用户昵称
 * - {user_id}      触发用户QQ号
 * - {operator}     操作者昵称
 * - {operator_id}  操作者QQ号
 * - {group_id}     群号
 * - {group_name}   群名
 * - {duration}     禁言时长（秒）
 * - {duration_text} 禁言时长文本
 * - {honor}        荣誉名称
 * - {action}       动作描述（如：加入/退出/被踪）
 */
import config from '../config/config.js'
import { getBotIds } from '../src/utils/messageDedup.js'

// 懒加载服务
let _scopeManager = null
let _databaseService = null

async function getScopeManagerLazy() {
    if (!_scopeManager) {
        const { getScopeManager } = await import('../src/services/scope/ScopeManager.js')
        const { databaseService } = await import('../src/services/storage/DatabaseService.js')
        _databaseService = databaseService
        if (!_databaseService.initialized) {
            await _databaseService.init()
        }
        _scopeManager = getScopeManager(_databaseService)
        await _scopeManager.init()
    }
    return _scopeManager
}

/**
 * 检查群组事件处理是否启用
 * @param {string} groupId
 * @param {boolean} globalDefault
 * @returns {Promise<boolean>}
 */
async function isGroupEventEnabled(groupId, globalDefault) {
    if (!groupId) return globalDefault
    
    try {
        const scopeManager = await getScopeManagerLazy()
        const groupSettings = await scopeManager.getGroupSettings(String(groupId))
        const settings = groupSettings?.settings || {}
        
        if (settings.eventEnabled !== undefined) {
            return settings.eventEnabled
        }
    } catch (err) {
        logger.debug('[GroupEvents] 获取群组eventEnabled设置失败:', err.message)
    }
    
    return globalDefault
}
import {
    parseRecallEvent,
    parseBanEvent,
    parseMemberChangeEvent,
    parseEssenceEvent,
    parseAdminChangeEvent,
    parseHonorEvent,
    getUserNickname as getAdapterUserNickname,
    getGroupName as getAdapterGroupName,
    getOriginalMessage,
    sendGroupMessage,
    formatDuration,
    getBot
} from '../src/utils/eventAdapter.js'
const messageCache = new Map()
const MESSAGE_CACHE_TTL = 5 * 60 * 1000
const MESSAGE_CACHE_MAX = 1000 
export function cacheGroupMessage(e) {
    if (!e?.message_id || !e?.group_id) return
    
    const cacheData = {
        message: e.message,
        raw_message: e.raw_message || e.msg,
        time: Date.now(),
        user_id: e.user_id,
        group_id: e.group_id,
        sender: e.sender
    }
    
    messageCache.set(e.message_id, cacheData)
    
    // 清理过期和超量缓存
    if (messageCache.size > MESSAGE_CACHE_MAX) {
        const now = Date.now()
        for (const [key, val] of messageCache) {
            if (now - val.time > MESSAGE_CACHE_TTL || messageCache.size > MESSAGE_CACHE_MAX) {
                messageCache.delete(key)
            }
        }
    }
}

/**
 * 从缓存获取消息
 */
function getCachedMessage(messageId) {
    const cached = messageCache.get(messageId)
    if (cached && Date.now() - cached.time < MESSAGE_CACHE_TTL) {
        return cached
    }
    return null
}

async function getUserNickname(e, userId, bot) {
    return await getAdapterUserNickname(e, userId, bot)
}

function getGroupName(e, bot) {
    return getAdapterGroupName(e, bot)
}

async function getAIResponse(prompt, options = {}) {
    const { userId, groupId, maxLength = 100 } = options
    try {
        const { chatService } = await import('../src/services/llm/ChatService.js')
        const result = await chatService.sendMessage({
            userId: String(userId),
            groupId: groupId ? String(groupId) : null,
            message: prompt,
            mode: 'roleplay',
            skipHistory: true
        })
        let reply = result.response
            ?.filter(c => c.type === 'text')
            ?.map(c => c.text)
            ?.join('') || ''
        if (maxLength && reply.length > maxLength) {
            reply = reply.substring(0, maxLength)
        }
        return reply
    } catch (err) {
        logger.debug('[GroupEvents] AI响应失败:', err.message)
        return null
    }
}

async function sendMessage(bot, groupId, message) {
    return await sendGroupMessage(bot, groupId, message)
}

/**
 * 替换提示词中的占位符
 */
function replacePlaceholders(template, data) {
    if (!template) return template
    return template
        .replace(/\{nickname\}/g, data.nickname || '用户')
        .replace(/\{user_id\}/g, data.user_id || '')
        .replace(/\{operator\}/g, data.operator || '操作者')
        .replace(/\{operator_id\}/g, data.operator_id || '')
        .replace(/\{group_id\}/g, data.group_id || '')
        .replace(/\{group_name\}/g, data.group_name || '群聊')
        .replace(/\{duration\}/g, data.duration || '0')
        .replace(/\{duration_text\}/g, data.duration_text || '')
        .replace(/\{honor\}/g, data.honor || '')
        .replace(/\{action\}/g, data.action || '')
        .replace(/\{target\}/g, data.target || '')
        .replace(/\{target_id\}/g, data.target_id || '')
        .replace(/\{message\}/g, data.message || '')
        .replace(/\{message_type\}/g, data.message_type || '')
        .replace(/\{message_id\}/g, data.message_id || '')
        .replace(/\{time\}/g, data.time || '')
        .replace(/\{seq\}/g, data.seq || '')
        .replace(/\{sub_type\}/g, data.sub_type || '')
}

/**
 * 解析消息段为可读文本
 */
function parseMessageSegments(message) {
    if (!message) return { text: '', type: 'unknown' }
    if (typeof message === 'string') return { text: message, type: 'text' }
    if (!Array.isArray(message)) return { text: String(message), type: 'text' }
    
    const parts = []
    let msgType = 'text'
    
    for (const seg of message) {
        if (!seg) continue
        const type = seg.type || seg.Type
        const data = seg.data || seg
        
        switch (type) {
            case 'text':
                if (data.text) parts.push(data.text)
                break
            case 'image':
                parts.push('[图片]')
                msgType = 'image'
                break
            case 'face':
                parts.push(`[表情${data.id || ''}]`)
                break
            case 'at':
                parts.push(`@${data.name || data.qq || '用户'}`)
                break
            case 'reply':
                parts.push('[回复]')
                break
            case 'forward':
            case 'xml':
            case 'json':
                parts.push('[合并转发/卡片消息]')
                msgType = 'forward'
                break
            case 'video':
                parts.push('[视频]')
                msgType = 'video'
                break
            case 'record':
            case 'audio':
                parts.push('[语音]')
                msgType = 'audio'
                break
            case 'file':
                parts.push(`[文件${data.name ? ': ' + data.name : ''}]`)
                msgType = 'file'
                break
            case 'mface':
            case 'marketface':
                parts.push('[商城表情]')
                break
            case 'poke':
                parts.push('[戳一戳]')
                break
            default:
                if (data.text) parts.push(data.text)
                else if (type) parts.push(`[${type}]`)
        }
    }
    
    return { text: parts.join('') || '', type: msgType }
}

/**
 * 尝试获取被撤回的消息内容 - 使用统一适配器
 */
async function getRecalledMessage(e, bot) {
    try {
        const msgId = e.message_id || e.msg_id
        
        // 1. 优先从本地缓存获取
        const cached = getCachedMessage(msgId)
        if (cached) {
            logger.debug(`[AI-recall] 从本地缓存获取到消息`)
            const parsed = parseMessageSegments(cached.message || cached.raw_message)
            if (parsed.text && !['[已删除]', ''].includes(parsed.text)) {
                return { content: parsed.text, type: parsed.type }
            }
        }
        
        // 2. 使用统一适配器获取原消息
        const originalMsg = await getOriginalMessage(e, bot, messageCache)
        if (originalMsg.content) {
            return originalMsg
        }
        
        // 3. 从事件字段获取 (撤回事件特有字段)
        if (e.recall) {
            const recallData = e.recall
            const message = recallData.message || recallData.content || recallData.text
            if (message) {
                const parsed = parseMessageSegments(message)
                if (parsed.text) return { content: parsed.text, type: parsed.type }
            }
            if (recallData.raw_message) {
                return { content: recallData.raw_message, type: 'text' }
            }
        }
        
        return { content: '', type: 'unknown' }
    } catch (err) {
        logger.debug('[GroupEvents] 获取撤回消息失败:', err.message)
        return { content: '', type: 'unknown' }
    }
}

export class AI_Welcome extends plugin {
    constructor() {
        super({
            name: 'AI-Welcome',
            dsc: 'AI入群欢迎',
            event: 'notice.group.increase',
            priority: 9999,
            rule: [{ fnc: 'skip', log: false }]
        })
    }
    async skip() { return false }
}

export class AI_Goodbye extends plugin {
    constructor() {
        super({
            name: 'AI-Goodbye',
            dsc: 'AI退群通知',
            event: 'notice.group.decrease',
            priority: 9999,
            rule: [{ fnc: 'skip', log: false }]
        })
    }
    async skip() { return false }
}
const processedEvents = new Map()
const EVENT_DEDUP_TTL = 5000 

function getEventKey(e) {
    return `${e.group_id}-${e.user_id}-${e.sub_type}-${e.time || Date.now()}`
}

function shouldProcessEvent(e) {
    const key = getEventKey(e)
    const now = Date.now()
    if (processedEvents.has(key)) {
        return false
    }
    processedEvents.set(key, now)
    // 清理过期记录
    for (const [k, t] of processedEvents) {
        if (now - t > EVENT_DEDUP_TTL) processedEvents.delete(k)
    }
    return true
}

// 默认提示词模板
const DEFAULT_PROMPTS = {
    recall: '[事件通知] {nickname} 刚刚撤回了一条消息{message_hint}。你可以调侃一下，也可以忽略。',
    welcome: '[事件通知] {nickname} 刚刚加入了{group_name}。请用你的人设性格给出一个简短友好的欢迎语。',
    goodbye: '[事件通知] {nickname} {action}了{group_name}。你可以简短表达一下，也可以忽略。',
    ban: '[事件通知] {nickname} 被 {operator} {action}。你可以简短评论一下，也可以忽略。',
    essence: '[事件通知] {operator} 把你之前发的消息设置成了精华消息！请简短表达一下。',
    admin: '[事件通知] 你{action}！请简短表达一下。',
    luckyKing: '[事件通知] {nickname} 成为了红包运气王！{action}',
    honor: '[事件通知] {nickname} 获得了群荣誉"{honor}"！{action}'
}
function getEventPrompt(eventType, data) {
    const customPrompt = config.get(`features.${eventType}.prompt`)
    let template = customPrompt || DEFAULT_PROMPTS[eventType] || ''
    if (eventType === 'recall') {
        let messageHint = ''
        if (data.message) {
            const typeDesc = data.message_type && data.message_type !== 'text' ? `(${data.message_type})` : ''
            const content = data.message.substring(0, 100) + (data.message.length > 100 ? '...' : '')
            messageHint = `，内容${typeDesc}是："${content}"`
        }
        template = template.replace(/\{message_hint\}/g, messageHint)
    }
    if (eventType === 'ban') {
        const banAction = data.sub_type === 'lift_ban' ? '解除了禁言' : `禁言了 ${data.duration_text}`
        template = template.replace(/\{ban_action\}/g, banAction)
    }
    if (eventType === 'goodbye') {
        const leaveReason = data.action === '被踢出' ? `被 ${data.operator} 踢出` : '主动退出'
        template = template.replace(/\{leave_reason\}/g, leaveReason)
    }
    
    return replacePlaceholders(template, data)
}

let eventListenersRegistered = false

/**
 * 统一事件处理器
 */
async function handleGroupEvent(eventType, e, bot) {
    if (!shouldProcessEvent(e)) return
    
    const configKey = `features.${eventType}.enabled`
    const globalEnabled = config.get(configKey)
    
    // 检查群组级别的事件处理开关
    const isEnabled = await isGroupEventEnabled(e.group_id, globalEnabled)
    if (!isEnabled) return
    
    const botIds = getBotIds()
    const userId = e.user_id || e.operator_id
    const operatorId = e.operator_id || e.user_id
    const groupId = e.group_id
    const data = {
        nickname: await getUserNickname(e, userId, bot),
        user_id: userId,
        operator: await getUserNickname(e, operatorId, bot),
        operator_id: operatorId,
        group_id: groupId,
        group_name: getGroupName(e, bot),
        duration: e.duration || 0,
        duration_text: e.duration ? `${Math.floor(e.duration / 60)} 分钟` : '',
        honor: '',
        action: '',
        target: '',
        target_id: '',
        message: '',
        message_type: '',
        message_id: e.message_id || e.msg_id || '',
        time: e.time ? new Date(e.time * 1000).toLocaleTimeString() : '',
        seq: e.seq || e.message_seq || '',
        sub_type: e.sub_type || ''
    }

    switch (eventType) {
        case 'recall':
            // 机器人自己撤回不响应
            if (botIds.has(String(operatorId))) return
            // 只响应用户自己撤回
            if (e.operator_id !== e.user_id) return
            // 调试：打印事件对象的所有字段
            logger.debug(`[AI-recall] 事件对象字段: ${JSON.stringify(Object.keys(e))}`)
            logger.debug(`[AI-recall] 事件详情: message_id=${e.message_id}, seq=${e.seq}`)
            logger.debug(`[AI-recall] recall字段: ${JSON.stringify(e.recall)?.substring(0, 500)}`)
            logger.debug(`[AI-recall] sender字段: ${JSON.stringify(e.sender)?.substring(0, 300)}`)
            // 尝试获取被撤回的消息内容
            const recalledMsg = await getRecalledMessage(e, bot)
            data.message = recalledMsg.content
            data.message_type = recalledMsg.type
            if (data.message) {
                const preview = data.message.substring(0, 50) + (data.message.length > 50 ? '...' : '')
                logger.info(`[AI-${eventType}] ${data.nickname}(${userId}) 撤回了${data.message_type !== 'text' ? `(${data.message_type})` : ''}消息: "${preview}"`)
            } else {
                logger.info(`[AI-${eventType}] ${data.nickname}(${userId}) 撤回了一条消息(内容未知)`)
            }
            break
            
        case 'welcome':
            if (botIds.has(String(userId))) return
            data.action = '加入'
            logger.info(`[AI-${eventType}] ${data.nickname}(${userId}) 加入了群 ${groupId}`)
            break
            
        case 'goodbye':
            if (botIds.has(String(userId))) return
            if (e.sub_type === 'kick_me') return
            data.action = e.sub_type === 'kick' ? '被踢出' : '退出'
            // 如果是被踢，operator是操作者
            if (e.sub_type === 'kick' && e.operator_id && e.operator_id !== e.user_id) {
                data.operator = await getUserNickname(e, e.operator_id, bot)
            }
            logger.info(`[AI-${eventType}] ${data.nickname}(${userId}) ${data.action}了群 ${groupId}${e.sub_type === 'kick' ? ` (由 ${data.operator} 操作)` : ''}`)
            break
            
        case 'ban':
            // 使用统一解析
            const banInfo = parseBanEvent(e)
            data.target = await getUserNickname(e, banInfo.userId, bot)
            data.target_id = banInfo.userId
            data.operator = await getUserNickname(e, banInfo.operatorId, bot)
            data.nickname = data.target
            data.duration = banInfo.duration
            data.duration_text = banInfo.durationText
            
            if (botIds.has(String(banInfo.userId))) {
                logger.warn(`[AI-${eventType}] 机器人被 ${data.operator} 禁言 ${banInfo.duration} 秒`)
                return
            }
            
            if (!banInfo.isLift) {
                data.action = `被禁言 ${data.duration_text}`
                data.sub_type = 'ban'
            } else {
                data.action = '被解除禁言'
                data.sub_type = 'lift_ban'
            }
            logger.info(`[AI-${eventType}] ${data.nickname} 被 ${data.operator} ${data.action}`)
            break
            
        case 'essence':
            const essenceOperatorId = e.operator_id
            data.operator = await getUserNickname(e, essenceOperatorId, bot)
            if (e.sub_type === 'add') {
                if (!botIds.has(String(e.sender_id))) return
                data.action = '设置为精华'
                logger.info(`[AI-${eventType}] 机器人的消息被 ${data.operator} 设为精华`)
            } else {
                // 取消精华也可以通知
                data.action = '取消精华'
                return // 暂不处理取消精华
            }
            break
            
        case 'admin':
            if (!botIds.has(String(userId))) return
            if (e.sub_type === 'set') {
                data.action = '被设置成了群管理员'
                data.sub_type = 'set'
            } else {
                data.action = '的管理员身份被取消了'
                data.sub_type = 'unset'
            }
            logger.info(`[AI-${eventType}] 机器人${e.sub_type === 'set' ? '成为' : '取消'}管理员`)
            break
            
        case 'luckyKing':
            const luckyUserId = e.target_id || e.user_id
            data.target_id = luckyUserId
            if (botIds.has(String(luckyUserId))) {
                data.action = '请简短表达一下开心或得意。'
                data.nickname = '你'
                data.sub_type = 'self'
            } else if (config.get('features.luckyKing.congratulate')) {
                data.nickname = await getUserNickname(e, luckyUserId, bot)
                data.target = data.nickname
                data.action = '你可以简短祝贺一下。'
                data.sub_type = 'other'
            } else {
                return
            }
            logger.info(`[AI-${eventType}] ${data.nickname} 成为运气王`)
            break
            
        case 'honor':
            // 使用统一解析
            const honorInfo = parseHonorEvent(e)
            if (!botIds.has(String(honorInfo.userId))) return
            data.honor = honorInfo.honorName
            data.nickname = '你'
            data.action = '请简短表达一下。'
            logger.info(`[AI-${eventType}] 机器人获得荣誉: ${data.honor}`)
            break
    }
    if (config.get(`features.${eventType}.aiResponse`) !== false) {
        const prompt = getEventPrompt(eventType, data)
        const aiReply = await getAIResponse(prompt, {
            userId: userId,
            groupId: groupId,
            maxLength: config.get(`features.${eventType}.maxLength`) || 100
        })
        
        if (aiReply) {
            await sendMessage(bot, groupId, aiReply)
        }
    }
}

/**
 * 支持: icqq / NapCat / go-cqhttp / LLOneBot / Lagrange / TRSS
 */
function registerEventListeners() {
    if (eventListenersRegistered) return
    eventListenersRegistered = true
    
    setTimeout(() => {
        try {
            const bots = Bot?.uin ? [Bot] : (Bot?.bots ? Object.values(Bot.bots) : [])
            if (bots.length === 0 && global.Bot) bots.push(global.Bot)
            
            for (const bot of bots) {
                if (!bot || bot._groupEventListenersAdded) continue
                bot._groupEventListenersAdded = true
                // icqq: notice.group.recall
                bot.on?.('notice.group.recall', (e) => handleGroupEvent('recall', e, bot))
                // OneBot 通用
                bot.on?.('notice.group', (e) => {
                    if (e.sub_type === 'recall' || e.notice_type === 'group_recall') {
                        handleGroupEvent('recall', e, bot)
                    }
                })
                // NapCat/部分适配器
                bot.on?.('notice', (e) => {
                    if (e.notice_type === 'group_recall' || 
                        (e.post_type === 'notice' && e.notice_type === 'group_recall')) {
                        handleGroupEvent('recall', e, bot)
                    }
                })
                bot.on?.('notice.group.increase', (e) => handleGroupEvent('welcome', e, bot))
                bot.on?.('notice.group', (e) => {
                    if (e.sub_type === 'increase' || e.sub_type === 'approve' || e.sub_type === 'invite') {
                        handleGroupEvent('welcome', e, bot)
                    }
                })
                bot.on?.('notice', (e) => {
                    if (e.notice_type === 'group_increase') {
                        handleGroupEvent('welcome', e, bot)
                    }
                })
                bot.on?.('notice.group.decrease', (e) => handleGroupEvent('goodbye', e, bot))
                bot.on?.('notice.group', (e) => {
                    if (e.sub_type === 'decrease' || e.sub_type === 'kick' || e.sub_type === 'leave') {
                        handleGroupEvent('goodbye', e, bot)
                    }
                })
                bot.on?.('notice', (e) => {
                    if (e.notice_type === 'group_decrease') {
                        handleGroupEvent('goodbye', e, bot)
                    }
                })
                bot.on?.('notice.group.ban', (e) => handleGroupEvent('ban', e, bot))
                bot.on?.('notice.group', (e) => {
                    if (e.sub_type === 'ban' || e.sub_type === 'lift_ban') {
                        handleGroupEvent('ban', e, bot)
                    }
                })
                bot.on?.('notice', (e) => {
                    if (e.notice_type === 'group_ban') {
                        handleGroupEvent('ban', e, bot)
                    }
                })
                bot.on?.('notice.group.essence', (e) => handleGroupEvent('essence', e, bot))
                bot.on?.('notice', (e) => {
                    if (e.notice_type === 'essence' || e.notice_type === 'group_essence') {
                        handleGroupEvent('essence', e, bot)
                    }
                })
                bot.on?.('notice.group.admin', (e) => handleGroupEvent('admin', e, bot))
                bot.on?.('notice', (e) => {
                    if (e.notice_type === 'group_admin') {
                        handleGroupEvent('admin', e, bot)
                    }
                })
                bot.on?.('notice.notify', (e) => {
                    if (e.sub_type === 'lucky_king') handleGroupEvent('luckyKing', e, bot)
                    if (e.sub_type === 'honor') handleGroupEvent('honor', e, bot)
                })
                bot.on?.('notice', (e) => {
                    if (e.notice_type === 'notify') {
                        if (e.sub_type === 'lucky_king') handleGroupEvent('luckyKing', e, bot)
                        if (e.sub_type === 'honor') handleGroupEvent('honor', e, bot)
                    }
                })
            }
            
        } catch (err) {
            logger.error('[GroupEvents] 注册事件监听器失败:', err)
        }
    }, 3000)
}
registerEventListeners()
export class AI_Recall extends plugin {
    constructor() {
        super({
            name: 'AI-Recall',
            dsc: 'AI撤回响应',
            event: 'notice.group.recall',
            priority: 9999,
            rule: [{ fnc: 'skip', log: false }]
        })
    }
    async skip() { return false }
}

export class AI_Essence extends plugin {
    constructor() {
        super({
            name: 'AI-Essence',
            dsc: 'AI精华消息响应',
            event: 'notice.group.essence',
            priority: 9999,
            rule: [{ fnc: 'skip', log: false }]
        })
    }
    async skip() { return false }
}

export class AI_Ban extends plugin {
    constructor() {
        super({
            name: 'AI-Ban',
            dsc: 'AI禁言响应',
            event: 'notice.group.ban',
            priority: 9999,
            rule: [{ fnc: 'skip', log: false }]
        })
    }
    async skip() { return false }
}

export class AI_Admin extends plugin {
    constructor() {
        super({
            name: 'AI-Admin',
            dsc: 'AI管理员变更响应',
            event: 'notice.group.admin',
            priority: 9999,
            rule: [{ fnc: 'skip', log: false }]
        })
    }
    async skip() { return false }
}

export class AI_LuckyKing extends plugin {
    constructor() {
        super({
            name: 'AI-LuckyKing',
            dsc: 'AI运气王响应',
            event: 'notice.notify',
            priority: 9999,
            rule: [{ fnc: 'skip', log: false }]
        })
    }
    async skip() { return false }
}

export class AI_Honor extends plugin {
    constructor() {
        super({
            name: 'AI-Honor',
            dsc: 'AI群荣誉响应',
            event: 'notice.notify',
            priority: 9999,
            rule: [{ fnc: 'skip', log: false }]
        })
    }
    async skip() { return false }
}
