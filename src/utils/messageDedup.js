/**
 * 消息去重与自身消息防护模块
 * @module utils/messageDedup
 */

// ======================= 常量配置 =======================
const MESSAGE_DEDUP_EXPIRE = 10000   // 消息去重过期时间(ms)
const SENT_MSG_EXPIRE = 30000        // 发送消息指纹过期时间(ms)
const MSG_ID_EXPIRE = 60000          // 消息ID过期时间(ms)

// ======================= 存储结构 =======================
const processedMessages = new WeakMap()      // 事件对象 -> boolean
const recentMessageHashes = new Map()        // hash -> timestamp
const processedMessageIds = new Map()        // message_id -> timestamp
const sentMessageFingerprints = new Map()    // fingerprint -> timestamp (机器人发送的消息)
const processingMessages = new Set()         // 正在处理中的消息ID

// ======================= 内部工具函数 =======================

/**
 * 转义正则特殊字符
 * @param {string} str 
 * @returns {string}
 */
export function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 生成消息hash用于去重
 * @param {Object} e - 事件对象
 * @returns {string}
 */
function getMessageHash(e) {
    const userId = e.user_id || ''
    const groupId = e.group_id || ''
    const msg = e.msg || e.raw_message || ''
    const msgId = e.message_id || ''
    const time = e.time || ''
    const seq = e.seq || e.source?.seq || ''
    return `${userId}_${groupId}_${msgId}_${time}_${seq}_${msg.substring(0, 80)}`
}

/**
 * 生成消息内容指纹
 * @param {string|Array} content 
 * @returns {string}
 */
function getContentFingerprint(content) {
    if (!content) return ''
    const text = typeof content === 'string' ? content : 
        (Array.isArray(content) ? content.filter(c => c.type === 'text').map(c => c.text || c.data?.text || '').join('') : '')
    return text.substring(0, 100).trim()
}

/**
 * 清理过期的发送消息指纹
 */
function cleanExpiredSentFingerprints() {
    const now = Date.now()
    for (const [fp, time] of sentMessageFingerprints) {
        if (now - time > SENT_MSG_EXPIRE) {
            sentMessageFingerprints.delete(fp)
        }
    }
}

/**
 * 清理过期的消息hash
 */
function cleanExpiredHashes() {
    const now = Date.now()
    for (const [hash, time] of recentMessageHashes) {
        if (now - time > MESSAGE_DEDUP_EXPIRE) {
            recentMessageHashes.delete(hash)
        }
    }
}

/**
 * 清理过期的消息ID记录
 */
function cleanExpiredMessageIds() {
    const now = Date.now()
    for (const [id, time] of processedMessageIds) {
        if (now - time > MSG_ID_EXPIRE) {
            processedMessageIds.delete(id)
        }
    }
}

/**
 * 检查消息是否可能是机器人发送后被回显的
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
function isSentMessageEcho(e) {
    const msg = e.msg || e.raw_message || ''
    const fingerprint = getContentFingerprint(msg)
    if (!fingerprint) return false
    
    const sentTime = sentMessageFingerprints.get(fingerprint)
    if (sentTime && Date.now() - sentTime < SENT_MSG_EXPIRE) {
        return true
    }
    return false
}

// ======================= 导出函数 =======================

/**
 * 记录机器人发送的消息指纹
 * @param {string|Array} content - 发送的消息内容
 */
export function recordSentMessage(content) {
    const fingerprint = getContentFingerprint(content)
    if (fingerprint) {
        sentMessageFingerprints.set(fingerprint, Date.now())
        if (sentMessageFingerprints.size > 200) {
            cleanExpiredSentFingerprints()
        }
    }
}

/**
 * 标记消息已被处理
 * @param {Object} e - 事件对象
 */
export function markMessageProcessed(e) {
    processedMessages.set(e, true)
    const now = Date.now()
    
    // 记录消息hash
    const hash = getMessageHash(e)
    recentMessageHashes.set(hash, now)
    
    // 记录 message_id
    const msgId = e.message_id
    if (msgId) {
        processedMessageIds.set(String(msgId), now)
        processingMessages.delete(String(msgId))
    }
    
    // 定期清理
    if (recentMessageHashes.size > 100) {
        cleanExpiredHashes()
    }
    if (processedMessageIds.size > 500) {
        cleanExpiredMessageIds()
    }
}

/**
 * 标记消息开始处理（防止并发重复处理）
 * @param {Object} e - 事件对象
 * @returns {boolean} 如果返回 false 表示已有相同消息在处理中
 */
export function startProcessingMessage(e) {
    const msgId = e.message_id
    if (!msgId) return true
    
    const msgIdStr = String(msgId)
    if (processingMessages.has(msgIdStr)) {
        logger.debug(`[Dedup] 消息正在处理中，跳过: ${msgIdStr}`)
        return false
    }
    
    processingMessages.add(msgIdStr)
    setTimeout(() => processingMessages.delete(msgIdStr), 60000)
    return true
}

/**
 * 检查消息是否已被处理
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isMessageProcessed(e) {
    // 1. 检查事件对象是否已处理（WeakMap）
    if (processedMessages.has(e)) {
        logger.debug('[Dedup] 消息已处理(WeakMap)')
        return true
    }
    
    // 2. 检查 message_id 是否已处理
    const msgId = e.message_id
    if (msgId) {
        const msgIdStr = String(msgId)
        if (processedMessageIds.has(msgIdStr)) {
            const lastTime = processedMessageIds.get(msgIdStr)
            if (Date.now() - lastTime < MSG_ID_EXPIRE) {
                logger.debug(`[Dedup] 消息已处理(message_id): ${msgIdStr}`)
                return true
            }
        }
        if (processingMessages.has(msgIdStr)) {
            logger.debug(`[Dedup] 消息正在处理中: ${msgIdStr}`)
            return true
        }
    }
    
    // 3. 检查消息hash是否重复（兜底）
    const hash = getMessageHash(e)
    if (recentMessageHashes.has(hash)) {
        const lastTime = recentMessageHashes.get(hash)
        if (Date.now() - lastTime < MESSAGE_DEDUP_EXPIRE) {
            logger.debug('[Dedup] 消息已处理(hash)')
            return true
        }
    }
    
    return false
}

/**
 * 获取所有机器人ID集合
 * @returns {Set<string>}
 */
export function getBotIds() {
    const selfIds = new Set()
    try {
        if (Bot?.uin) selfIds.add(String(Bot.uin))
        if (Bot?.self_id) selfIds.add(String(Bot.self_id))
        if (Bot?.bots && typeof Bot.bots[Symbol.iterator] === 'function') {
            for (const [id] of Bot.bots) {
                selfIds.add(String(id))
            }
        } else if (Bot?.bots && typeof Bot.bots === 'object') {
            for (const id of Object.keys(Bot.bots)) {
                selfIds.add(String(id))
            }
        }
    } catch (err) {
        // ignore
    }
    return selfIds
}

/**
 * 检查是否是自身消息
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isSelfMessage(e) {
    try {
        // stdin 适配器是测试用
        if (e?.adapter?.name === 'stdin' || e?.adapter?.id === 'stdin' || 
            e?.self_id === 'stdin' || e?.bot?.adapter?.name === 'stdin') {
            return false
        }
        
        const bot = e?.bot || Bot
        const selfIds = new Set()
        
        // 主要ID
        if (bot?.uin) selfIds.add(String(bot.uin))
        if (e?.self_id) selfIds.add(String(e.self_id))
        if (bot?.self_id) selfIds.add(String(bot.self_id))
        
        // TRSS多账号
        if (Bot?.uin) selfIds.add(String(Bot.uin))
        if (Bot?.bots && typeof Bot.bots[Symbol.iterator] === 'function') {
            for (const [id] of Bot.bots) {
                selfIds.add(String(id))
            }
        } else if (Bot?.bots && typeof Bot.bots === 'object') {
            for (const id of Object.keys(Bot.bots)) {
                selfIds.add(String(id))
            }
        }
        
        // 检查发送者ID
        const senderId = String(e?.user_id || e?.sender?.user_id || '')
        if (senderId && selfIds.has(senderId)) {
            logger.debug('[SelfGuard] 检测到自身ID消息:', senderId)
            return true
        }
        
        // 检查消息来源标记
        if (e?.post_type === 'message_sent' || e?.message_type === 'self') {
            logger.debug('[SelfGuard] 检测到message_sent类型')
            return true
        }
        
        // 检查 sub_type
        if (e?.sub_type === 'self' || e?.sub_type === 'send') {
            logger.debug('[SelfGuard] 检测到self/send sub_type')
            return true
        }
        
        // 检查是否是回显消息
        if (isSentMessageEcho(e)) {
            logger.debug('[SelfGuard] 检测到发送消息回显')
            return true
        }
        
        // 检查 sender.user_id 与 self_id 是否相同
        if (e?.sender?.user_id && e?.self_id) {
            if (String(e.sender.user_id) === String(e.self_id)) {
                logger.debug('[SelfGuard] sender.user_id === self_id')
                return true
            }
        }
        
        // 检查 from_self 标记
        if (e?.from_self === true || e?.message?.from_self === true) {
            logger.debug('[SelfGuard] 检测到from_self标记')
            return true
        }
        
        return false
    } catch (err) {
        logger.debug('[SelfGuard] 检测出错:', err.message)
        return false
    }
}

/**
 * 检查是否是引用机器人消息触发
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isReplyToBotMessage(e) {
    try {
        if (!e?.source) return false
        
        const botIds = getBotIds()
        const sourceUserId = String(e.source.user_id || e.source.sender?.user_id || '')
        
        if (sourceUserId && botIds.has(sourceUserId)) {
            const hasRealAt = e.message?.some(seg => 
                seg.type === 'at' && botIds.has(String(seg.qq))
            )
            
            if (e.atBot && !hasRealAt) {
                return true
            }
        }
        
        return false
    } catch (err) {
        return false
    }
}

/**
 * 清理所有过期数据（手动触发）
 */
export function cleanupAll() {
    cleanExpiredHashes()
    cleanExpiredMessageIds()
    cleanExpiredSentFingerprints()
}

/**
 * 获取去重统计信息
 * @returns {Object}
 */
export function getStats() {
    return {
        hashCount: recentMessageHashes.size,
        messageIdCount: processedMessageIds.size,
        fingerprintCount: sentMessageFingerprints.size,
        processingCount: processingMessages.size
    }
}
