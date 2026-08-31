/**
 * 用户信息工具
 * 获取用户信息、好友列表等
 */

import { StandardBotApi } from '../../core/platform/index.js'

/** 好友列表默认与最大返回数量 */
const DEFAULT_FRIEND_LIST_LIMIT = 50
const MAX_FRIEND_LIST_LIMIT = 500

/** 好友搜索默认与最大返回数量 */
const DEFAULT_FRIEND_SEARCH_LIMIT = 10
const MAX_FRIEND_SEARCH_LIMIT = 100

/** 点赞默认与最大次数 */
const DEFAULT_LIKE_TIMES = 10
const MAX_LIKE_TIMES = 20

/**
 * 夹取列表类工具的 limit
 * @param {*} value - 调用方传入的值
 * @param {number} fallback - 默认值
 * @param {number} max - 上限
 * @returns {number} 位于 [1, max] 的整数
 */
function clampLimit(value, fallback, max) {
    const num = Math.floor(Number(value))
    if (!Number.isFinite(num) || num < 1) return fallback
    return Math.min(num, max)
}

export const userTools = [
    {
        name: 'get_user_info',
        description: '获取QQ用户的基本信息，包括昵称、头像、性别等。当用户问某人信息或需要了解用户身份时调用。',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户的QQ号' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            const api = StandardBotApi.fromContext(ctx)
            const adapter = api.adapterType
            const userId = api.targetId(args.user_id)
            if (userId === null || userId === undefined || userId === '') {
                return { success: false, adapter, error: 'user_id 不能为空' }
            }

            try {
                const [profile, friendState] = await Promise.all([api.getUserInfo(userId), api.getFriendState(userId)])
                if (profile) {
                    return {
                        success: true,
                        adapter,
                        user_id: userId,
                        nickname: profile.nickname || profile.name || '',
                        remark: friendState.friend?.remark || '',
                        sex: profile.sex,
                        age: profile.age,
                        is_friend: friendState.isFriend,
                        avatar_url: api.userAvatarUrl(userId)
                    }
                }
            } catch {}

            return {
                success: false,
                adapter,
                error: '无法获取用户信息，QQ号可能不存在',
                user_id: userId,
                avatar_url: api.userAvatarUrl(userId)
            }
        }
    },

    {
        name: 'get_friend_list',
        description: '获取机器人的好友列表',
        inputSchema: {
            type: 'object',
            properties: {
                limit: {
                    type: 'integer',
                    description: `返回的最大数量，默认${DEFAULT_FRIEND_LIST_LIMIT}，最大${MAX_FRIEND_LIST_LIMIT}`,
                    minimum: 1,
                    maximum: MAX_FRIEND_LIST_LIMIT
                }
            }
        },
        handler: async (args, ctx) => {
            const api = StandardBotApi.fromContext(ctx)
            const limit = clampLimit(args.limit, DEFAULT_FRIEND_LIST_LIMIT, MAX_FRIEND_LIST_LIMIT)
            const allFriends = await api.getFriendList()
            const friends = allFriends.slice(0, limit).map(friend => {
                const userId = friend.user_id ?? friend.uid ?? friend.id
                return {
                    user_id: userId,
                    nickname: friend.nickname,
                    remark: friend.remark || '',
                    avatar_url: api.userAvatarUrl(userId, 100)
                }
            })

            return { success: true, total: allFriends.length, returned: friends.length, friends }
        }
    },

    {
        name: 'send_like',
        description: '给用户点赞（需要是好友）',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' },
                times: {
                    type: 'integer',
                    description: `点赞次数，默认${DEFAULT_LIKE_TIMES}，最大${MAX_LIKE_TIMES}`,
                    minimum: 1,
                    maximum: MAX_LIKE_TIMES
                }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const adapter = api.adapterType
                const userId = api.targetId(args.user_id)
                if (userId === null || userId === undefined || userId === '') {
                    return { success: false, adapter, error: 'user_id 不能为空' }
                }
                const times = clampLimit(args.times, DEFAULT_LIKE_TIMES, MAX_LIKE_TIMES)

                await api.sendLike(userId, times)
                return { success: true, adapter, user_id: userId, times }
            } catch (err) {
                return { success: false, error: `点赞失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_avatar',
        description: '获取用户或群头像URL',
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: '类型: user 或 group', enum: ['user', 'group'] },
                id: { type: 'string', description: 'QQ号或群号' },
                size: { type: 'string', description: '头像尺寸，默认640', enum: ['40', '100', '140', '640'] }
            },
            required: ['type', 'id']
        },
        handler: async (args, ctx) => {
            const api = StandardBotApi.fromContext(ctx)
            const size = args.size || 640
            const id = args.id

            let url
            if (args.type === 'user') {
                url = api.userAvatarUrl(id, size)
            } else if (args.type === 'group') {
                url = api.groupAvatarUrl(id, size)
            } else {
                return { success: false, error: '类型必须是 user 或 group' }
            }

            return { success: true, type: args.type, id, size, url }
        }
    },

    {
        name: 'get_sender_info',
        description: '获取当前消息发送者的详细信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                const userId = e.user_id
                const sender = e.sender || {}

                const friendState = await api.getFriendState(userId)
                const result = {
                    success: true,
                    user_id: userId,
                    nickname: sender.nickname || sender.nick || '',
                    card: sender.card || '', // 群名片
                    role: sender.role || 'member',
                    title: sender.title || '', // 群头衔
                    sex: sender.sex || 'unknown',
                    age: sender.age,
                    level: sender.level,
                    avatar_url: api.userAvatarUrl(userId),
                    is_group: !!e.group_id,
                    is_friend: friendState.isFriend
                }

                // 如果在群内，添加群相关信息
                if (e.group_id) {
                    result.group_id = e.group_id
                    const groupInfo = await api.getGroupInfo(e.group_id)
                    result.group_name = e.group_name || groupInfo?.group_name || ''
                }

                return result
            } catch (err) {
                return { success: false, error: `获取发送者信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_friend',
        description: '在好友列表中搜索用户（按昵称或备注）',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '搜索关键词' },
                limit: {
                    type: 'integer',
                    description: `返回数量限制，默认${DEFAULT_FRIEND_SEARCH_LIMIT}，最大${MAX_FRIEND_SEARCH_LIMIT}`,
                    minimum: 1,
                    maximum: MAX_FRIEND_SEARCH_LIMIT
                }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const keyword = args.keyword.toLowerCase()
                const limit = clampLimit(args.limit, DEFAULT_FRIEND_SEARCH_LIMIT, MAX_FRIEND_SEARCH_LIMIT)
                const friendList = await api.getFriendList()

                const matches = []
                for (const friend of friendList) {
                    const uid = friend.user_id ?? friend.uid ?? friend.id
                    const nickname = (friend.nickname || '').toLowerCase()
                    const remark = (friend.remark || '').toLowerCase()

                    if (nickname.includes(keyword) || remark.includes(keyword)) {
                        matches.push({
                            user_id: uid,
                            nickname: friend.nickname,
                            remark: friend.remark || '',
                            match_type: remark.includes(keyword) ? 'remark' : 'nickname',
                            avatar_url: api.userAvatarUrl(uid, 100)
                        })
                        if (matches.length >= limit) break
                    }
                }

                return {
                    success: true,
                    keyword: args.keyword,
                    count: matches.length,
                    friends: matches
                }
            } catch (err) {
                return { success: false, error: `搜索失败: ${err.message}` }
            }
        }
    },

    {
        name: 'check_is_friend',
        description: '检查指定用户是否是机器人的好友',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const userId = api.targetId(args.user_id)
                if (userId === null || userId === undefined || userId === '') {
                    return { success: false, error: 'user_id 不能为空' }
                }
                const { isFriend, friend } = await api.getFriendState(userId)

                return {
                    success: true,
                    user_id: userId,
                    is_friend: isFriend,
                    nickname: friend?.nickname || null,
                    remark: friend?.remark || null,
                    avatar_url: api.userAvatarUrl(userId)
                }
            } catch (err) {
                return { success: false, error: `检查失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_bot_info',
        description: '获取机器人自身的信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const botInfo = api.getBotInfo()

                return {
                    success: true,
                    ...botInfo,
                    platform: botInfo.adapter
                }
            } catch (err) {
                return { success: false, error: `获取机器人信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_user_profile',
        description: '获取用户的详细资料（包括签名、等级等）',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号，不填则获取当前发送者' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                const userId = api.targetId(args.user_id || e?.user_id)

                if (userId === null || userId === undefined || userId === '') {
                    return { success: false, error: `需要提供有效的 user_id（收到: ${args.user_id ?? '空'}）` }
                }

                const [profile, friendState] = await Promise.all([api.getUserInfo(userId), api.getFriendState(userId)])
                const friend = friendState.friend

                return {
                    success: true,
                    user_id: userId,
                    nickname: profile.nickname || friend?.nickname || '',
                    sex: profile.sex || 'unknown',
                    age: profile.age,
                    level: profile.level,
                    sign: profile.sign || profile.signature || '',
                    qid: profile.qid, // Q号ID
                    is_friend: friendState.isFriend,
                    remark: friend?.remark || '',
                    avatar_url: api.userAvatarUrl(userId)
                }
            } catch (err) {
                return { success: false, error: `获取资料失败: ${err.message}` }
            }
        }
    }
]
