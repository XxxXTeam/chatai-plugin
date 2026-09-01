import { PLUGIN_DEVELOPERS } from './common.js'
import { chatLogger as logger } from '../core/utils/logger.js'
import {
    detectStandardAdapter,
    normalizeStandardSegment,
    StandardBotApi,
    StandardMessage
} from '../core/platform/index.js'

/**
 * 检测框架类型
 * @returns {'trss'|'miao'}
 */
export function detectFramework() {
    if (globalThis.Bot?.bots) {
        return 'trss'
    }
    return 'miao'
}

/**
 * 检测适配器类型
 * @param {Object} e - 事件对象或bot对象
 * @returns {string} 适配器类型: 'icqq' | 'napcat' | 'go-cqhttp' | 'lagrange' | 'onebot' | 'unknown'
 */
/** @deprecated 请使用 detectStandardAdapter。 */
export function detectAdapter(e) {
    return detectStandardAdapter(e?.bot || e || globalThis.Bot)
}
/**
 * 获取Bot信息
 * @param {Object} e - 事件对象
 * @returns {Object} Bot信息
 */
/** @deprecated 请使用 StandardBotApi.getBotInfo。 */
export function getBotInfo(e) {
    const api = new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot })
    const info = api.getBotInfo()
    return {
        platform: detectStandardAdapter(api.bot),
        uin: info.user_id,
        nickname: info.nickname || 'Bot',
        version: info.version || {},
        adapter: info.adapter
    }
}

/**
 * 获取用户信息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @param {string|number} [groupId] - 群ID (可选)
 * @returns {Promise<Object>} 用户信息
 */
/** @deprecated 请使用 StandardBotApi.getUserInfo。 */
export async function getUserInfo(e, userId, groupId = null) {
    return await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).getUserInfo(userId, groupId)
}

/**
 * 获取群信息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @returns {Promise<Object>} 群信息
 */
/** @deprecated 请使用 StandardBotApi.getGroupInfo。 */
export async function getGroupInfo(e, groupId) {
    return await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).getGroupInfo(groupId)
}

/**
 * 获取群成员列表 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @returns {Promise<Array>} 成员列表
 */
/** @deprecated 请使用 StandardBotApi.getMemberList。 */
export async function getGroupMemberList(e, groupId) {
    return await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).getMemberList(groupId)
}

/**
 * 获取消息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} messageId - 消息ID或seq
 * @param {string|number} [groupId] - 群ID (可选)
 * @returns {Promise<Object|null>} 消息对象
 */
/** @deprecated 请使用 StandardBotApi.getMessage。 */
export async function getMessage(e, messageId, groupId = null) {
    return await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).getMessage(messageId, {
        groupId: groupId || e?.group_id,
        userId: groupId || e?.group_id ? null : e?.user_id
    })
}

/**
 * 发送戳一戳 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 目标用户ID
 * @param {string|number} [groupId] - 群ID (可选)
 * @returns {Promise<boolean>} 是否成功
 */
/** @deprecated 请使用 StandardBotApi.pokeMember/pokeUser。 */
export async function sendPoke(e, userId, groupId = null) {
    const api = new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot })
    if (groupId || e?.group_id) await api.pokeMember(groupId || e.group_id, userId)
    else await api.pokeUser(userId)
    return true
}

/**
 * 获取头像URL - 统一接口
 * @param {Object|string|number} eOrUserId - 事件对象或用户ID
 * @param {string|number} [userIdOrSize] - 用户ID或尺寸
 * @param {number} [size=640] - 头像尺寸
 * @returns {string} 头像URL
 */
/** @deprecated 请使用 StandardBotApi.userAvatarUrl。 */
export function getAvatarUrl(eOrUserId, userIdOrSize = 640, size = 640) {
    const event = typeof eOrUserId === 'object' ? eOrUserId : null
    const userId = event ? userIdOrSize : eOrUserId
    const avatarSize = event ? size : userIdOrSize
    return new StandardBotApi({ event, bot: event?.bot || globalThis.Bot }).userAvatarUrl(userId, avatarSize)
}

/**
 * 获取群头像URL
 * @param {string|number} groupId - 群ID
 * @param {number} [size=640] - 头像尺寸
 * @returns {string} 群头像URL
 */
/** @deprecated 请使用 StandardBotApi.groupAvatarUrl。 */
export function getGroupAvatarUrl(groupId, size = 640) {
    return new StandardBotApi({ bot: globalThis.Bot }).groupAvatarUrl(groupId, size)
}

/**
 * 解析消息段 - 统一接口
 * 将不同格式的消息段转换为统一格式
 * @param {Object} segment - 消息段
 * @returns {Object} 统一格式的消息段
 */
/** @deprecated 请使用 normalizeStandardSegment。 */
export function normalizeSegment(segment) {
    return normalizeStandardSegment(segment)
}

/**
 * 构建消息段 - 统一接口
 * @param {string} type - 消息类型
 * @param {Object} data - 消息数据
 * @param {string} [targetPlatform] - 目标平台
 * @returns {Object} 消息段
 */
/** @deprecated 请使用 StandardMessage.custom。 */
export function buildSegment(type, data) {
    return StandardMessage.custom(type, data)
}

/**
 * 撤回消息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} messageId - 消息ID
 * @returns {Promise<boolean>} 是否成功
 */
/** @deprecated 请使用 StandardBotApi.recall。 */
export async function deleteMessage(e, messageId) {
    await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).recall({
        messageId,
        groupId: e?.group_id,
        userId: e?.group_id ? null : e?.user_id
    })
    return true
}

/**
 * 获取群聊历史记录 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @param {number} [count=20] - 获取数量
 * @param {string|number} [messageSeq=0] - 起始消息序号或 QQBot message_id
 * @returns {Promise<Array>} 消息列表
 */
/** @deprecated 请使用 StandardBotApi.getHistory。 */
export async function getGroupChatHistory(e, groupId, count = 20, messageSeq = 0) {
    const api = new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot })
    if (api.isQQBot) {
        return await api.getHistory({
            groupId,
            count
        })
    }
    return await api.getHistory({
        groupId,
        count,
        sequence: messageSeq
    })
}

/**
 * 发送群消息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @param {string|Array} message - 消息内容
 * @returns {Promise<Object|null>} 发送结果
 */
/** @deprecated 请使用 StandardBotApi.sendGroup。 */
export async function sendGroupMessage(e, groupId, message) {
    return (await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).sendGroup(groupId, message)).result
}

/**
 * 发送私聊消息 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @param {string|Array} message - 消息内容
 * @returns {Promise<Object|null>} 发送结果
 */
/** @deprecated 请使用 StandardBotApi.sendPrivate。 */
export async function sendPrivateMessage(e, userId, message) {
    return (await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).sendPrivate(userId, message)).result
}

/**
 * 设置群禁言 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @param {string|number} userId - 用户ID
 * @param {number} duration - 禁言时长（秒），0为解除
 * @returns {Promise<boolean>}
 */
/** @deprecated 请使用 StandardBotApi.callGroupOrAction。 */
export async function setGroupBan(e, groupId, userId, duration = 60) {
    const api = new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot })
    await api.callGroupOrAction({
        groupId,
        method: 'muteMember',
        args: [api.targetId(userId), duration],
        action: 'set_group_ban',
        params: { user_id: api.targetId(userId), duration }
    })
    return true
}

/**
 * 设置群名片 - 统一接口
 * @param {Object} e - 事件对象
 * @param {string|number} groupId - 群ID
 * @param {string|number} userId - 用户ID
 * @param {string} card - 群名片
 * @returns {Promise<boolean>}
 */
/** @deprecated 请使用 StandardBotApi.callGroupOrAction。 */
export async function setGroupCard(e, groupId, userId, card) {
    const api = new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot })
    await api.callGroupOrAction({
        groupId,
        method: 'setCard',
        args: [api.targetId(userId), card],
        action: 'set_group_card',
        params: { user_id: api.targetId(userId), card }
    })
    return true
}

/**
 * 获取好友列表 - 统一接口
 * @param {Object} e - 事件对象
 * @returns {Promise<Array>}
 */
/** @deprecated 请使用 StandardBotApi.getFriendList。 */
export async function getFriendList(e) {
    return await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).getFriendList()
}

/**
 * 获取群列表 - 统一接口
 * @param {Object} e - 事件对象
 * @returns {Promise<Array>}
 */
/** @deprecated 请使用 StandardBotApi.getGroupList。 */
export async function getGroupList(e) {
    return await new StandardBotApi({ event: e, bot: e?.bot || globalThis.Bot }).getGroupList()
}

/**
 * 获取当前 Bot 实例
 * @param {Object} [e] - 事件对象
 * @returns {Object} Bot 实例
 */
export function getBot(e) {
    if (e?.bot) return e.bot
    if (detectFramework() === 'trss' && globalThis.Bot?.bots) {
        const bots = Array.from(globalThis.Bot.bots.values())
        return bots[0] || globalThis.Bot
    }
    return globalThis.Bot || null
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
    if (detectFramework() === 'trss' && globalThis.Bot?.bots) {
        return Array.from(globalThis.Bot.bots.values())
    }
    return globalThis.Bot ? [globalThis.Bot] : []
}

/**
 * 检查 Bot 是否在线
 * @param {Object} [bot] - Bot 实例
 * @returns {boolean}
 */
export function isBotOnline(bot) {
    bot = bot || globalThis.Bot
    if (typeof bot?.isOnline === 'function') return bot.isOnline()
    if (bot?.status !== undefined) return bot.status === 'online' || bot.status === 11
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
    const uid = Number(userId)
    const uidStr = String(userId)
    const bot = globalThis.Bot

    // 插件开发者固定权限
    if (PLUGIN_DEVELOPERS.includes(uid)) {
        return true
    }

    // Yunzai主人配置（兼容 masterQQ 和 master 两种键名）
    const masterQQ = bot?.config?.masterQQ || []
    const masterList = bot?.config?.master || []
    for (const arr of [masterQQ, masterList]) {
        if (arr.includes(uid) || arr.includes(uidStr)) return true
    }

    // 插件配置的主人
    try {
        const config = global.chatgptPluginConfig
        if (config) {
            const pluginMasters = config.get?.('admin.masterQQ') || []
            if (pluginMasters.includes(uid) || pluginMasters.includes(uidStr)) {
                return true
            }
            const authorQQs = config.get?.('admin.pluginAuthorQQ') || []
            if (authorQQs.includes(uid) || authorQQs.includes(uidStr)) {
                return true
            }
        }
    } catch {
        // 配置未加载时忽略
    }

    // Yunzai lib 配置（兼容传统框架）
    try {
        const yunzaiCfg = global._yunzaiCfgCache
        if (yunzaiCfg?.masterQQ?.length > 0) {
            if (yunzaiCfg.masterQQ.includes(uid) || yunzaiCfg.masterQQ.includes(uidStr)) {
                return true
            }
        }
    } catch {}

    return false
}

/**
 * 检查是否为插件作者
 * @param {string|number} userId - 用户ID
 * @returns {boolean}
 */
export function isPluginAuthor(userId) {
    try {
        const config = global.chatgptPluginConfig
        if (config) {
            const authorQQs = config.get?.('admin.pluginAuthorQQ') || []
            return authorQQs.includes(Number(userId)) || authorQQs.includes(String(userId))
        }
    } catch {
        // 配置未加载时忽略
    }
    return false
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
 * @function checkAccessList
 * @description 统一黑白名单权限检查
 * @param {string|number} userId - 用户ID
 * @param {string|number} groupId - 群组ID（可选）
 * @param {Object} cfg - 包含 blacklistUsers/whitelistUsers/blacklistGroups/whitelistGroups 的配置
 * @returns {boolean} true=允许, false=拒绝
 */
export function checkAccessList(userId, groupId, cfg) {
    if (!cfg) return true
    const uid = String(userId || '')
    const gid = String(groupId || '')
    const includes = (arr, val) => Array.isArray(arr) && val && arr.some(item => String(item) === val)

    if (includes(cfg.blacklistUsers, uid)) return false
    if (cfg.whitelistUsers?.length > 0 && !includes(cfg.whitelistUsers, uid)) return false
    if (gid && includes(cfg.blacklistGroups, gid)) return false
    if (gid && cfg.whitelistGroups?.length > 0 && !includes(cfg.whitelistGroups, gid)) return false
    return true
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
        logger?.warn?.('[PlatformAdapter] 回复失败:', err.message)
        return null
    }
}

/**
 * @function sendForwardMsg
 * @description 统一合并转发消息发送（兼容 NapCat/OneBot sendApi 和 icqq makeForwardMsg）
 * @param {Object} e - 事件对象
 * @param {string} title - 转发标题/昵称
 * @param {Array<string|Array>} messages - 消息列表
 * @returns {Promise<boolean>} 是否发送成功
 */
/** @deprecated 请使用 StandardBotApi.sendForward。 */
export async function sendForwardMsg(e, title, messages) {
    if (!e || !messages?.length) return false
    const api = new StandardBotApi({ event: e, bot: e.bot || globalThis.Bot })
    const info = api.getBotInfo()
    const result = await api.sendForward({
        groupId: e.group_id,
        userId: e.group_id ? null : e.user_id,
        nodes: messages.map(message => ({
            user_id: info.user_id || '10000',
            nickname: title || info.nickname || 'Bot',
            message
        }))
    })
    return result.success === true
}

/**
 * 将URL转换为二维码图片（base64格式）
 * @param {string} url - 要转换的URL
 * @returns {Promise<string|null>} base64图片字符串，失败返回null
 */
export async function urlToQRCode(url) {
    try {
        const QRCode = (await import('qrcode')).default
        const dataUrl = await QRCode.toDataURL(url, {
            margin: 2,
            width: 256,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        })
        return dataUrl.replace('data:image/png;base64,', 'base64://')
    } catch (err) {
        logger?.debug?.(`[PlatformAdapter] 生成二维码失败: ${err.message}`)
        return null
    }
}

export default {
    detectFramework,
    detectAdapter,
    getBotInfo,
    getBot,
    getBotSelfId,
    getAllBots,
    isBotOnline,
    getBotNickname,
    isMaster,
    isPluginAuthor,
    isAdmin,
    checkAccessList,
    getSenderName,
    isGroupMessage,
    isPrivateMessage,
    safeReply,
    sendForwardMsg,
    urlToQRCode,
    getUserInfo,
    getGroupInfo,
    getGroupMemberList,
    getMessage,
    deleteMessage,
    sendPoke,
    sendGroupMessage,
    sendPrivateMessage,
    setGroupBan,
    setGroupCard,
    getFriendList,
    getGroupList,
    getGroupChatHistory,
    getAvatarUrl,
    getGroupAvatarUrl,
    normalizeSegment,
    buildSegment
}
