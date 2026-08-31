/**
 * Bot 自身信息工具
 * 支持 NapCat 和 icqq 的 Bot 信息 API
 * 参考: https://napcat.apifox.cn/226656952e0
 */
import { StandardBotApi } from '../../core/platform/index.js'

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
                const api = StandardBotApi.fromContext(ctx)
                const info = api.getBotInfo()
                if (!info.user_id) return { success: false, error: '无法获取登录信息' }
                return { success: true, ...info }
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
                const api = StandardBotApi.fromContext(ctx)
                return { success: true, ...(await api.getBotStatus()) }
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
                const api = StandardBotApi.fromContext(ctx)
                const userId = api.targetId(args.user_id)
                if (userId === null || userId === undefined || userId === '') {
                    return { success: false, error: 'user_id 不能为空' }
                }

                try {
                    const [data, friendState] = await Promise.all([api.getUserInfo(userId), api.getFriendState(userId)])
                    if (!data?.nickname) {
                        // 协议端返回空内容时不能算成功，否则模型会把"查不到"当成"查到了"
                        return {
                            success: false,
                            user_id: userId,
                            is_friend: false,
                            error: '协议端未返回该用户的信息，QQ号可能不存在',
                            avatar_url: api.userAvatarUrl(userId)
                        }
                    }
                    return {
                        success: true,
                        user_id: userId,
                        nickname: data.nickname,
                        sex: data?.sex,
                        age: data?.age,
                        level: data?.level,
                        is_friend: friendState.isFriend,
                        remark: friendState.friend?.remark,
                        avatar_url: api.userAvatarUrl(userId)
                    }
                } catch (e) {
                    return {
                        success: false,
                        user_id: userId,
                        is_friend: false,
                        error: `当前协议不支持获取陌生人信息: ${e.message}`,
                        avatar_url: api.userAvatarUrl(userId)
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
                const api = StandardBotApi.fromContext(ctx)
                const botInfo = api.getBotInfo()

                // 基础版本信息
                const info = {
                    success: true,
                    app_name: 'Yunzai-Bot',
                    app_version: botInfo.version?.version || 'unknown',
                    protocol_version: botInfo.version?.protocol || 'unknown'
                }

                // 尝试获取更多版本信息
                try {
                    const result = await api.callAction('get_version_info', {})
                    const data = result?.data || result
                    info.app_name = data?.app_name || info.app_name
                    info.app_version = data?.app_version || info.app_version
                    info.protocol_version = data?.protocol_version || info.protocol_version
                    info.protocol_name = data?.protocol_name || 'unknown'
                    if (data?.runtime_os) info.runtime_os = data.runtime_os
                    if (data?.runtime_arch) info.runtime_arch = data.runtime_arch
                } catch {}

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
                const api = StandardBotApi.fromContext(ctx)
                try {
                    const result = await api.callAction('get_online_clients', { no_cache: true }, { strict: true })
                    if (result === null) return { success: false, error: '当前协议不支持获取在线客户端' }
                    const data = result?.data || result
                    return {
                        success: true,
                        clients: data?.clients || []
                    }
                } catch {
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
                const api = StandardBotApi.fromContext(ctx)
                try {
                    await api.callAction('set_qq_avatar', { file: args.file }, { strict: true })
                    return { success: true }
                } catch {
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
                const api = StandardBotApi.fromContext(ctx)
                try {
                    const result = await api.callAction('_get_model_show', {}, { strict: true })
                    if (result === null) return { success: false, error: '当前协议不支持获取机型信息' }
                    const data = result?.data || result
                    return {
                        success: true,
                        variants: data?.variants || []
                    }
                } catch {
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
                const api = StandardBotApi.fromContext(ctx)
                const status = await api.getBotStatus()
                const selfInfo = {
                    success: status.online === true,
                    ...status,
                    capabilities: {
                        can_send_image: true,
                        can_send_record: true
                    }
                }
                return selfInfo
            } catch (err) {
                return { success: false, error: `获取自身信息失败: ${err.message}` }
            }
        }
    }
]
