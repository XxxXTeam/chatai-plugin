/**
 * 机器人框架工具函数
 * 从 utils/bot.js 迁移
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 缓存框架类型
let _frameworkCache = null
let _adapterCache = null

/**
 * 获取Yunzai框架类型
 * @returns {'trss'|'miao'|'unknown'}
 */
export function getBotFramework() {
    if (_frameworkCache) return _frameworkCache
    if (typeof Bot !== 'undefined' && Bot.bots) {
        _frameworkCache = 'trss'
        return 'trss'
    }
    try {
        const possiblePaths = [
            path.join(__dirname, '../../../../package.json'),  // plugins/xxx/src/utils -> root
            path.join(__dirname, '../../../../../package.json'),
            path.join(process.cwd(), 'package.json')
        ]
        
        for (const pkgPath of possiblePaths) {
            if (fs.existsSync(pkgPath)) {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
                if (pkg.name === 'trss-yunzai') {
                    _frameworkCache = 'trss'
                    return 'trss'
                }
                if (pkg.name === 'miao-yunzai') {
                    _frameworkCache = 'miao'
                    return 'miao'
                }
            }
        }
    } catch (err) {
    }
    if (typeof Bot !== 'undefined') {
        if (Bot.adapter) {
            _frameworkCache = 'trss'
            return 'trss'
        }
    }
    
    _frameworkCache = 'miao'
    return 'miao'
}

/**
 * 获取适配器类型（icqq/NapCat/go-cqhttp/Lagrange/OneBot）
 * @param {Object} [e] - 事件对象
 * @returns {string}
 */
export function getAdapter(e) {
    const bot = e?.bot || Bot
    if (bot?.adapter?.name) {
        const name = bot.adapter.name.toLowerCase()
        if (name.includes('icqq')) return 'icqq'
        if (name.includes('napcat') || name.includes('nc')) return 'NapCat'
        if (name.includes('gocq') || name.includes('go-cqhttp')) return 'go-cqhttp'
        if (name.includes('lagrange')) return 'Lagrange'
        if (name.includes('llonebot')) return 'LLOneBot'
        if (name.includes('onebot')) return 'OneBot'
    }
    if (bot?.version?.app_name) {
        const appName = bot.version.app_name.toLowerCase()
        if (appName.includes('napcat')) return 'NapCat'
        if (appName.includes('go-cqhttp')) return 'go-cqhttp'
        if (appName.includes('lagrange')) return 'Lagrange'
        if (appName.includes('llonebot')) return 'LLOneBot'
    }
    if (typeof bot?.pickGroup === 'function' && bot?.gml) {
        return 'icqq'
    }
    
    // 通用 OneBot 特征
    if (typeof bot?.getMsg === 'function' || typeof bot?.sendPrivateMsg === 'function') {
        return 'OneBot'
    }
    
    return 'Unknown'
}

/**
 * 获取完整框架信息
 * @param {Object} [e] - 事件对象
 * @returns {{ framework: string, adapter: string }}
 */
export function getFrameworkInfo(e) {
    return {
        framework: getBotFramework(),
        adapter: getAdapter(e)
    }
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
    if (typeof bot?.isOnline === 'function') {
        return bot.isOnline()
    }
    if (bot?.status !== undefined) {
        return bot.status === 'online' || bot.status === 11
    }
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
