/**
 * Bot 自身信息工具
 * 支持 NapCat 和 icqq 的 Bot 信息 API
 * 参考: https://napcat.apifox.cn/226656952e0
 */

/**
 * 调用 OneBot API (支持 NapCat/go-cqhttp)
 */
async function callOneBotApi(bot, action, params = {}) {
    if (bot.sendApi) {
        return await bot.sendApi(action, params)
    }
    if (bot[action]) {
        return await bot[action](params)
    }
    if (bot.config?.baseUrl || bot.adapter?.config?.baseUrl) {
        const baseUrl = bot.config?.baseUrl || bot.adapter?.config?.baseUrl
        const res = await fetch(`${baseUrl}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        })
        return await res.json()
    }
    throw new Error('不支持的协议类型')
}

export const botTools = [
    {
        name: 'get_login_info',
        description: '获取机器人登录账号的信息（QQ号、昵称等）',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                // 优先从 Bot 对象直接获取
                if (bot.uin || bot.self_id) {
                    const uin = bot.uin || bot.self_id
                    const nickname = bot.nickname || bot.info?.nickname || ''
                    return {
                        success: true,
                        user_id: uin,
                        nickname: nickname,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`
                    }
                }

                // 尝试 NapCat/go-cqhttp API
                try {
                    const result = await callOneBotApi(bot, 'get_login_info', {})
                    const data = result?.data || result
                    return {
                        success: true,
                        user_id: data?.user_id || data?.uin,
                        nickname: data?.nickname,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${data?.user_id || data?.uin}&s=640`
                    }
                } catch (e) {
                    return { success: false, error: '无法获取登录信息' }
                }
            } catch (err) {
                return { success: false, error: `获取登录信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_bot_status',
        description: '获取机器人运行状态',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                // 基本状态
                const status = {
                    success: true,
                    online: bot.isOnline?.() ?? bot.status === 11 ?? true,
                    self_id: bot.uin || bot.self_id,
                    nickname: bot.nickname || '',
                    friend_count: bot.fl?.size || 0,
                    group_count: bot.gl?.size || 0,
                    stat: bot.stat || {}
                }

                // 尝试获取更多状态信息
                try {
                    const result = await callOneBotApi(bot, 'get_status', {})
                    const data = result?.data || result
                    status.good = data?.good ?? status.online
                    status.app_initialized = data?.app_initialized ?? true
                    status.app_enabled = data?.app_enabled ?? true
                    status.app_good = data?.app_good ?? true
                    if (data?.stat) {
                        status.stat = { ...status.stat, ...data.stat }
                    }
                } catch (e) {}

                return status
            } catch (err) {
                return { success: false, error: `获取状态失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_friend_list',
        description: '获取机器人好友列表',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: '返回数量限制，默认50' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const limit = args.limit || 50

                // 从 Bot 对象获取好友列表
                const fl = bot.fl || new Map()
                const friends = []
                let count = 0

                for (const [uid, friend] of fl) {
                    if (count >= limit) break
                    friends.push({
                        user_id: uid,
                        nickname: friend.nickname || '',
                        remark: friend.remark || '',
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${uid}&s=100`
                    })
                    count++
                }

                return {
                    success: true,
                    total: fl.size,
                    returned: friends.length,
                    friends
                }
            } catch (err) {
                return { success: false, error: `获取好友列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_stranger_info',
        description: '获取陌生人信息',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' },
                no_cache: { type: 'boolean', description: '是否不使用缓存' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id)

                // 尝试从好友列表获取
                const friend = bot.fl?.get(userId)
                if (friend) {
                    return {
                        success: true,
                        user_id: userId,
                        nickname: friend.nickname,
                        sex: friend.sex,
                        age: friend.age,
                        remark: friend.remark,
                        is_friend: true,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                    }
                }

                // 尝试 API 调用
                try {
                    const result = await callOneBotApi(bot, 'get_stranger_info', {
                        user_id: userId,
                        no_cache: args.no_cache || false
                    })
                    const data = result?.data || result
                    return {
                        success: true,
                        user_id: userId,
                        nickname: data?.nickname,
                        sex: data?.sex,
                        age: data?.age,
                        level: data?.level,
                        is_friend: false,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                    }
                } catch (e) {
                    return {
                        success: true,
                        user_id: userId,
                        is_friend: false,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`,
                        note: '仅获取到基本信息'
                    }
                }
            } catch (err) {
                return { success: false, error: `获取陌生人信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_version_info',
        description: '获取机器人版本信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                // 基础版本信息
                const info = {
                    success: true,
                    app_name: 'Yunzai-Bot',
                    app_version: bot.version?.version || 'unknown',
                    protocol_version: bot.version?.protocol || 'unknown'
                }

                // 尝试获取更多版本信息
                try {
                    const result = await callOneBotApi(bot, 'get_version_info', {})
                    const data = result?.data || result
                    info.app_name = data?.app_name || info.app_name
                    info.app_version = data?.app_version || info.app_version
                    info.protocol_version = data?.protocol_version || info.protocol_version
                    info.protocol_name = data?.protocol_name || 'unknown'
                    if (data?.runtime_os) info.runtime_os = data.runtime_os
                    if (data?.runtime_arch) info.runtime_arch = data.runtime_arch
                } catch (e) {}

                return info
            } catch (err) {
                return { success: false, error: `获取版本信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_online_clients',
        description: '获取当前账号在线客户端列表',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                try {
                    const result = await callOneBotApi(bot, 'get_online_clients', { no_cache: true })
                    const data = result?.data || result
                    return {
                        success: true,
                        clients: data?.clients || []
                    }
                } catch (e) {
                    return { success: false, error: '当前协议不支持获取在线客户端' }
                }
            } catch (err) {
                return { success: false, error: `获取在线客户端失败: ${err.message}` }
            }
        }
    },

    {
        name: 'can_send_image',
        description: '检查是否可以发送图片',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                try {
                    const result = await callOneBotApi(bot, 'can_send_image', {})
                    return {
                        success: true,
                        can_send: result?.data?.yes ?? result?.yes ?? true
                    }
                } catch (e) {
                    // 默认支持
                    return { success: true, can_send: true }
                }
            } catch (err) {
                return { success: false, error: `检查失败: ${err.message}` }
            }
        }
    },

    {
        name: 'can_send_record',
        description: '检查是否可以发送语音',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                try {
                    const result = await callOneBotApi(bot, 'can_send_record', {})
                    return {
                        success: true,
                        can_send: result?.data?.yes ?? result?.yes ?? true
                    }
                } catch (e) {
                    return { success: true, can_send: true }
                }
            } catch (err) {
                return { success: false, error: `检查失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_qq_avatar',
        description: '设置机器人头像（危险操作）',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: '图片文件路径或URL' }
            },
            required: ['file']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                // 尝试 icqq API
                if (bot.setAvatar) {
                    await bot.setAvatar(args.file)
                    return { success: true }
                }

                // 尝试 NapCat API
                try {
                    await callOneBotApi(bot, 'set_qq_avatar', { file: args.file })
                    return { success: true }
                } catch (e) {
                    return { success: false, error: '当前协议不支持设置头像' }
                }
            } catch (err) {
                return { success: false, error: `设置头像失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_model_show',
        description: '获取机型显示信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                try {
                    const result = await callOneBotApi(bot, '_get_model_show', {})
                    const data = result?.data || result
                    return {
                        success: true,
                        variants: data?.variants || []
                    }
                } catch (e) {
                    return { success: false, error: '当前协议不支持获取机型信息' }
                }
            } catch (err) {
                return { success: false, error: `获取机型信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_like',
        description: '给好友点赞（超级会员可多次）',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '目标用户QQ号' },
                times: { type: 'number', description: '点赞次数，默认1（超级会员最多10）' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id)
                const times = Math.min(args.times || 1, 10)

                // 尝试 icqq API
                if (bot.sendLike) {
                    await bot.sendLike(userId, times)
                    return { success: true, user_id: userId, times }
                }

                // 尝试 NapCat API
                try {
                    await callOneBotApi(bot, 'send_like', {
                        user_id: userId,
                        times
                    })
                    return { success: true, user_id: userId, times }
                } catch (e) {
                    return { success: false, error: '当前协议不支持点赞' }
                }
            } catch (err) {
                return { success: false, error: `点赞失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_self_info',
        description: '获取机器人自身的完整信息（综合）',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                const selfInfo = {
                    success: true,
                    // 基本信息
                    user_id: bot.uin || bot.self_id,
                    nickname: bot.nickname || '',
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${bot.uin || bot.self_id}&s=640`,
                    // 状态
                    online: bot.isOnline?.() ?? true,
                    // 统计
                    friend_count: bot.fl?.size || 0,
                    group_count: bot.gl?.size || 0,
                    // 能力
                    capabilities: {
                        can_send_image: true,
                        can_send_record: true
                    }
                }

                // 尝试获取更多信息
                try {
                    const loginInfo = await callOneBotApi(bot, 'get_login_info', {})
                    const data = loginInfo?.data || loginInfo
                    if (data?.nickname) selfInfo.nickname = data.nickname
                    if (data?.user_id) selfInfo.user_id = data.user_id
                } catch (e) {}

                try {
                    const statusInfo = await callOneBotApi(bot, 'get_status', {})
                    const data = statusInfo?.data || statusInfo
                    selfInfo.good = data?.good ?? selfInfo.online
                    if (data?.stat) selfInfo.stat = data.stat
                } catch (e) {}

                return selfInfo
            } catch (err) {
                return { success: false, error: `获取自身信息失败: ${err.message}` }
            }
        }
    }
]
