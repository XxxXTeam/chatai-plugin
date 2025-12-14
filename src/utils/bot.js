/**
 * 机器人框架工具函数
 * 从 utils/bot.js 迁移
 */

/**
 * 获取机器人框架
 * @returns {'trss'|'miao'}
 */
export function getBotFramework() {
    if (typeof Bot !== 'undefined' && Bot.bots) {
        return 'trss'
    }
    return 'miao'
}

/**
 * 获取当前 Bot 实例
 * @param {Object} [e] - 事件对象
 * @returns {Object} Bot 实例
 */
export function getBot(e) {
    // 优先使用事件中的 bot
    if (e?.bot) return e.bot
    
    // TRSS 框架：从 Bot.bots 中获取
    if (getBotFramework() === 'trss' && Bot.bots) {
        const bots = Array.from(Bot.bots.values())
        return bots[0] || Bot
    }
    
    return Bot
}

/**
 * 获取 Bot 的 self_id（QQ号）
 * @param {Object} [e] - 事件对象
 * @returns {string|number}
 */
export function getBotSelfId(e) {
    const bot = getBot(e)
    return bot?.uin || bot?.self_id || e?.self_id || ''
}

/**
 * 获取所有在线的 Bot 实例
 * @returns {Array<Object>}
 */
export function getAllBots() {
    if (getBotFramework() === 'trss' && Bot.bots) {
        return Array.from(Bot.bots.values())
    }
    return [Bot]
}

/**
 * 检查 Bot 是否在线
 * @param {Object} [bot] - Bot 实例
 * @returns {boolean}
 */
export function isBotOnline(bot) {
    bot = bot || Bot
    // icqq: isOnline()
    if (typeof bot?.isOnline === 'function') {
        return bot.isOnline()
    }
    // TRSS/OneBot: 检查 status
    if (bot?.status !== undefined) {
        return bot.status === 'online' || bot.status === 11
    }
    // 默认假设在线
    return true
}

/**
 * 获取 Bot 的昵称
 * @param {Object} [e] - 事件对象
 * @returns {string}
 */
export function getBotNickname(e) {
    const bot = getBot(e)
    return bot?.nickname || bot?.info?.nickname || 'Bot'
}

/**
 * 检查是否为主人
 * @param {string|number} userId - 用户ID
 * @returns {boolean}
 */
export function isMaster(userId) {
    const masters = Bot?.config?.masterQQ || cfg?.masterQQ || []
    return masters.includes(Number(userId)) || masters.includes(String(userId))
}

/**
 * 检查是否为管理员（群管理或主人）
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isAdmin(e) {
    if (!e) return false
    if (isMaster(e.user_id)) return true
    if (e.sender?.role === 'admin' || e.sender?.role === 'owner') return true
    return false
}

/**
 * 获取消息发送者显示名称
 * @param {Object} e - 事件对象
 * @returns {string}
 */
export function getSenderName(e) {
    if (!e?.sender) return '用户'
    return e.sender.card || e.sender.nickname || String(e.sender.user_id) || '用户'
}

/**
 * 判断是否为群聊消息
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isGroupMessage(e) {
    return e?.message_type === 'group' || !!e?.group_id
}

/**
 * 判断是否为私聊消息
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isPrivateMessage(e) {
    return e?.message_type === 'private' || (!e?.group_id && e?.user_id)
}

/**
 * 安全回复消息
 * @param {Object} e - 事件对象
 * @param {string|Array} msg - 消息内容
 * @param {boolean} [quote=false] - 是否引用
 * @returns {Promise<Object|null>}
 */
export async function safeReply(e, msg, quote = false) {
    if (!e?.reply || !msg) return null
    try {
        return await e.reply(msg, quote)
    } catch (err) {
        logger?.warn?.('[Bot] 回复失败:', err.message)
        return null
    }
}

/**
 * 格式化 @ 消息段
 * @param {string|number} userId - 用户ID
 * @returns {Object}
 */
export function at(userId) {
    return { type: 'at', qq: userId }
}

/**
 * 格式化图片消息段
 * @param {string} file - 图片路径/URL/base64
 * @returns {Object}
 */
export function image(file) {
    return { type: 'image', file }
}

/**
 * 格式化文本消息段
 * @param {string} text - 文本内容
 * @returns {Object}
 */
export function text(text) {
    return { type: 'text', text }
}

/**
 * 格式化语音消息段
 * @param {string} file - 语音文件路径/URL/base64
 * @returns {Object}
 */
export function record(file) {
    return { type: 'record', file }
}
