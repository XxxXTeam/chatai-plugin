/**
 * Bot 自身信息工具
 * 支持 NapCat 和 icqq 的 Bot 信息 API
 * 参考: https://napcat.apifox.cn/226656952e0
 */
import { callOneBotApi } from '../../utils/eventAdapter.js'

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

    // get_friend_list 已由 user.js 统一实现（加载顺序更靠前，实际执行的一直是该实现），移除重复定义

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
                if (!Number.isFinite(userId)) {
                    return { success: false, error: `无效的QQ号: ${args.user_id}` }
                }

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
                    if (!data?.nickname) {
                        // 协议端返回空内容时不能算成功，否则模型会把"查不到"当成"查到了"
                        return {
                            success: false,
                            user_id: userId,
                            is_friend: false,
                            error: '协议端未返回该用户的信息，QQ号可能不存在',
                            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                        }
                    }
                    return {
                        success: true,
                        user_id: userId,
                        nickname: data.nickname,
                        sex: data?.sex,
                        age: data?.age,
                        level: data?.level,
                        is_friend: false,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                    }
                } catch (e) {
                    return {
                        success: false,
                        user_id: userId,
                        is_friend: false,
                        error: `当前协议不支持获取陌生人信息: ${e.message}`,
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
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

    // can_send_image / can_send_record 已由 file.js 统一实现（加载顺序更靠前，实际执行的一直是该实现），移除重复定义

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

    // send_like 已由 user.js 统一实现（加载顺序更靠前，实际执行的一直是该实现），
    // 其 bot.sendLike 回退分支已并入 user.js，移除重复定义

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
