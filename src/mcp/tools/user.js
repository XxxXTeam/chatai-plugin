/**
 * 用户信息工具
 * 获取用户信息、好友列表等
 */

import { icqqFriend, callOneBotApi } from './helpers.js'

export const userTools = [
    {
        name: 'get_user_info',
        description: '获取QQ用户的基本信息，包括昵称、头像、性别等',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户的QQ号' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            const bot = ctx.getBot()
            const { adapter } = ctx.getAdapter()
            const userId = parseInt(args.user_id)

            // 尝试获取好友信息
            const friend = bot.fl?.get(userId)
            if (friend) {
                return {
                    success: true,
                    adapter,
                    user_id: userId,
                    nickname: friend.nickname,
                    remark: friend.remark || '',
                    sex: friend.sex,
                    is_friend: true,
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                }
            }

            // 尝试获取陌生人信息
            try {
                let stranger
                if (adapter === 'icqq') {
                    stranger = await icqqFriend.getSimpleInfo(bot, userId)
                } else {
                    stranger =
                        (await bot.getStrangerInfo?.(userId)) ||
                        (await callOneBotApi(bot, 'get_stranger_info', { user_id: userId }))
                }
                if (stranger) {
                    return {
                        success: true,
                        adapter,
                        user_id: userId,
                        nickname: stranger.nickname,
                        sex: stranger.sex,
                        age: stranger.age,
                        is_friend: false,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                    }
                }
            } catch (e) {
                // ignore
            }

            return {
                success: false,
                adapter,
                error: '无法获取用户信息，QQ号可能不存在',
                user_id: userId,
                avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
            }
        }
    },

    {
        name: 'get_friend_list',
        description: '获取机器人的好友列表',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: '返回的最大数量，默认50' }
            }
        },
        handler: async (args, ctx) => {
            const bot = ctx.getBot()
            const limit = args.limit || 50
            const fl = bot.fl || new Map()

            const friends = []
            let count = 0
            for (const [uid, friend] of fl) {
                if (count >= limit) break
                friends.push({
                    user_id: uid,
                    nickname: friend.nickname,
                    remark: friend.remark || ''
                })
                count++
            }

            return { success: true, total: fl.size, returned: friends.length, friends }
        }
    },

    {
        name: 'send_like',
        description: '给用户点赞（需要是好友）',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' },
                times: { type: 'number', description: '点赞次数，默认10', minimum: 1, maximum: 20 }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const userId = parseInt(args.user_id)
                const times = Math.min(Math.max(args.times || 10, 1), 20)

                if (adapter === 'icqq') {
                    await icqqFriend.thumbUp(bot, userId, times)
                    return { success: true, adapter, user_id: userId, times }
                } else {
                    await callOneBotApi(bot, 'send_like', { user_id: userId, times })
                    return { success: true, adapter, user_id: userId, times }
                }
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
        handler: async args => {
            const size = args.size || 640
            const id = args.id

            let url
            if (args.type === 'user') {
                url = `https://q1.qlogo.cn/g?b=qq&nk=${id}&s=${size}`
            } else if (args.type === 'group') {
                url = `https://p.qlogo.cn/gh/${id}/${id}/${size}`
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
                const bot = ctx.getBot()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                const userId = e.user_id
                const sender = e.sender || {}

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
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`,
                    is_group: !!e.group_id,
                    is_friend: bot.fl?.has(userId) || false
                }

                // 如果在群内，添加群相关信息
                if (e.group_id) {
                    result.group_id = e.group_id
                    result.group_name = e.group_name || bot.gl?.get(e.group_id)?.group_name || ''
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
                limit: { type: 'number', description: '返回数量限制，默认10' }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const keyword = args.keyword.toLowerCase()
                const limit = args.limit || 10
                const fl = bot.fl || new Map()

                const matches = []
                for (const [uid, friend] of fl) {
                    const nickname = (friend.nickname || '').toLowerCase()
                    const remark = (friend.remark || '').toLowerCase()

                    if (nickname.includes(keyword) || remark.includes(keyword)) {
                        matches.push({
                            user_id: uid,
                            nickname: friend.nickname,
                            remark: friend.remark || '',
                            match_type: remark.includes(keyword) ? 'remark' : 'nickname',
                            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${uid}&s=100`
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
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id)
                const fl = bot.fl || new Map()

                const isFriend = fl.has(userId)
                const friend = fl.get(userId)

                return {
                    success: true,
                    user_id: userId,
                    is_friend: isFriend,
                    nickname: friend?.nickname || null,
                    remark: friend?.remark || null,
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
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
                const bot = ctx.getBot()

                return {
                    success: true,
                    user_id: bot.uin || bot.self_id,
                    nickname: bot.nickname || bot.info?.nickname || '',
                    sex: bot.sex || bot.info?.sex || 'unknown',
                    age: bot.age || bot.info?.age,
                    friend_count: bot.fl?.size || 0,
                    group_count: bot.gl?.size || 0,
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${bot.uin || bot.self_id}&s=640`,
                    status: bot.status || 'online',
                    platform: bot.platform || 'unknown'
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
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id || e?.user_id)

                if (!userId) {
                    return { success: false, error: '需要提供 user_id' }
                }

                // 尝试获取详细资料
                let profile = {}
                try {
                    if (bot.getStrangerInfo) {
                        profile = (await bot.getStrangerInfo(userId, true)) || {}
                    }
                } catch (e) {}

                // 检查是否是好友
                const friend = bot.fl?.get(userId)

                return {
                    success: true,
                    user_id: userId,
                    nickname: profile.nickname || friend?.nickname || '',
                    sex: profile.sex || 'unknown',
                    age: profile.age,
                    level: profile.level,
                    sign: profile.sign || profile.signature || '',
                    qid: profile.qid, // Q号ID
                    is_friend: !!friend,
                    remark: friend?.remark || '',
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                }
            } catch (err) {
                return { success: false, error: `获取资料失败: ${err.message}` }
            }
        }
    }
]
