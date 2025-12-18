/**
 * 群管理工具
 * 禁言、踢人、设置群名片等管理功能
 */

import { icqqGroup, callOneBotApi } from './helpers.js'

export const adminTools = [
    {
        name: 'mute_member',
        description: '禁言群成员（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号' },
                duration: { type: 'number', description: '禁言时长(秒)，0表示解除禁言，最大30天' }
            },
            required: ['group_id', 'user_id', 'duration']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                const duration = Math.min(Math.max(args.duration, 0), 30 * 24 * 3600)
                
                if (adapter === 'icqq') {
                    await icqqGroup.muteMember(bot, groupId, userId, duration)
                } else {
                    await callOneBotApi(bot, 'set_group_ban', { group_id: groupId, user_id: userId, duration })
                }
                
                return { 
                    success: true, 
                    adapter,
                    group_id: groupId,
                    user_id: userId,
                    duration,
                    action: duration === 0 ? '解除禁言' : `禁言${duration}秒`
                }
            } catch (err) {
                return { success: false, error: `禁言失败: ${err.message}` }
            }
        }
    },

    {
        name: 'kick_member',
        description: '踢出群成员（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号' },
                reject_add: { type: 'boolean', description: '是否拒绝再次加群，默认false' }
            },
            required: ['group_id', 'user_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                
                if (adapter === 'icqq') {
                    await icqqGroup.kickMember(bot, groupId, userId, args.reject_add || false)
                } else {
                    await callOneBotApi(bot, 'set_group_kick', { group_id: groupId, user_id: userId, reject_add_request: args.reject_add || false })
                }
                
                return { success: true, adapter, group_id: groupId, user_id: userId }
            } catch (err) {
                return { success: false, error: `踢人失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_card',
        description: '设置群成员名片',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号' },
                card: { type: 'string', description: '新群名片，空字符串表示删除' }
            },
            required: ['group_id', 'user_id', 'card']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                
                if (adapter === 'icqq') {
                    await icqqGroup.setCard(bot, groupId, userId, args.card)
                } else {
                    await callOneBotApi(bot, 'set_group_card', { group_id: groupId, user_id: userId, card: args.card })
                }
                
                return { success: true, adapter, group_id: groupId, user_id: userId, card: args.card }
            } catch (err) {
                return { success: false, error: `设置群名片失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_whole_ban',
        description: '设置全群禁言（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                enable: { type: 'boolean', description: 'true开启禁言，false关闭禁言' }
            },
            required: ['group_id', 'enable']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)
                
                if (adapter === 'icqq') {
                    await icqqGroup.muteAll(bot, groupId, args.enable)
                } else {
                    await callOneBotApi(bot, 'set_group_whole_ban', { group_id: groupId, enable: args.enable })
                }
                
                return { 
                    success: true, 
                    adapter,
                    group_id: groupId, 
                    action: args.enable ? '开启全群禁言' : '关闭全群禁言'
                }
            } catch (err) {
                return { success: false, error: `设置全群禁言失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_admin',
        description: '设置/取消群管理员（需要群主权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号' },
                enable: { type: 'boolean', description: 'true设置管理员，false取消管理员' }
            },
            required: ['group_id', 'user_id', 'enable']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                
                if (adapter === 'icqq') {
                    await icqqGroup.setAdmin(bot, groupId, userId, args.enable)
                } else {
                    await callOneBotApi(bot, 'set_group_admin', { group_id: groupId, user_id: userId, enable: args.enable })
                }
                
                return { 
                    success: true, 
                    adapter,
                    group_id: groupId, 
                    user_id: userId,
                    action: args.enable ? '设为管理员' : '取消管理员'
                }
            } catch (err) {
                return { success: false, error: `设置管理员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_name',
        description: '修改群名称（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                name: { type: 'string', description: '新群名称' }
            },
            required: ['group_id', 'name']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)
                
                if (adapter === 'icqq') {
                    await icqqGroup.setName(bot, groupId, args.name)
                } else {
                    await callOneBotApi(bot, 'set_group_name', { group_id: groupId, group_name: args.name })
                }
                
                return { success: true, adapter, group_id: groupId, name: args.name }
            } catch (err) {
                return { success: false, error: `修改群名称失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_special_title',
        description: '设置群成员专属头衔（需要群主权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号' },
                title: { type: 'string', description: '专属头衔，空字符串表示删除' },
                duration: { type: 'number', description: '有效期(秒)，-1表示永久' }
            },
            required: ['group_id', 'user_id', 'title']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                
                if (adapter === 'icqq') {
                    await icqqGroup.setTitle(bot, groupId, userId, args.title, args.duration || -1)
                } else {
                    await callOneBotApi(bot, 'set_group_special_title', { group_id: groupId, user_id: userId, special_title: args.title, duration: args.duration || -1 })
                }
                
                return { success: true, adapter, group_id: groupId, user_id: userId, title: args.title }
            } catch (err) {
                return { success: false, error: `设置头衔失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_group_notice',
        description: '发送群公告（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                content: { type: 'string', description: '公告内容' },
                image: { type: 'string', description: '公告图片URL（可选）' }
            },
            required: ['group_id', 'content']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                const group = bot.pickGroup(groupId)
                await group.sendNotice?.(args.content, args.image)
                
                return { success: true, group_id: groupId }
            } catch (err) {
                return { success: false, error: `发送公告失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_add_request',
        description: '处理加群申请',
        inputSchema: {
            type: 'object',
            properties: {
                flag: { type: 'string', description: '申请标识（从事件获取）' },
                approve: { type: 'boolean', description: '是否同意，默认true' },
                reason: { type: 'string', description: '拒绝理由（仅拒绝时需要）' }
            },
            required: ['flag']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const approve = args.approve !== false
                
                // icqq 方式
                if (bot.setGroupAddRequest) {
                    await bot.setGroupAddRequest(args.flag, approve, args.reason || '')
                    return { success: true, flag: args.flag, approved: approve }
                }
                
                // NapCat/go-cqhttp 方式
                if (bot.sendApi) {
                    await bot.sendApi('set_group_add_request', {
                        flag: args.flag,
                        approve,
                        reason: args.reason || ''
                    })
                    return { success: true, flag: args.flag, approved: approve }
                }
                
                return { success: false, error: '当前协议不支持处理加群申请' }
            } catch (err) {
                return { success: false, error: `处理加群申请失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_friend_add_request',
        description: '处理好友申请',
        inputSchema: {
            type: 'object',
            properties: {
                flag: { type: 'string', description: '申请标识（从事件获取）' },
                approve: { type: 'boolean', description: '是否同意，默认true' },
                remark: { type: 'string', description: '好友备注（同意时可设置）' }
            },
            required: ['flag']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const approve = args.approve !== false
                
                // icqq 方式
                if (bot.setFriendAddRequest) {
                    await bot.setFriendAddRequest(args.flag, approve, args.remark || '')
                    return { success: true, flag: args.flag, approved: approve }
                }
                
                // NapCat/go-cqhttp 方式
                if (bot.sendApi) {
                    await bot.sendApi('set_friend_add_request', {
                        flag: args.flag,
                        approve,
                        remark: args.remark || ''
                    })
                    return { success: true, flag: args.flag, approved: approve }
                }
                
                return { success: false, error: '当前协议不支持处理好友申请' }
            } catch (err) {
                return { success: false, error: `处理好友申请失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_muted_list',
        description: '获取群禁言列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id || e?.group_id)
                
                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }
                
                // NapCat API
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('get_group_shut_list', { group_id: groupId })
                        const list = result?.data || result || []
                        return {
                            success: true,
                            group_id: groupId,
                            count: list.length,
                            muted_members: list.map(m => ({
                                user_id: m.user_id || m.uin,
                                nickname: m.nickname || m.nick || '',
                                mute_time: m.shut_up_timestamp || m.mute_time,
                                remaining: m.remaining_time
                            }))
                        }
                    } catch (e) {}
                }
                
                // icqq 方式 - 通过成员列表筛选
                const group = bot.pickGroup?.(groupId)
                if (group?.getMemberMap) {
                    const memberMap = await group.getMemberMap()
                    const mutedMembers = []
                    const now = Math.floor(Date.now() / 1000)
                    
                    for (const [uid, member] of memberMap) {
                        if (member.shutup_time && member.shutup_time > now) {
                            mutedMembers.push({
                                user_id: uid,
                                nickname: member.nickname || member.nick || '',
                                card: member.card || '',
                                mute_time: member.shutup_time,
                                remaining: member.shutup_time - now
                            })
                        }
                    }
                    
                    return {
                        success: true,
                        group_id: groupId,
                        count: mutedMembers.length,
                        muted_members: mutedMembers
                    }
                }
                
                return { success: false, error: '当前协议不支持获取禁言列表' }
            } catch (err) {
                return { success: false, error: `获取禁言列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_leave',
        description: '退出群聊（需谨慎使用）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                is_dismiss: { type: 'boolean', description: '是否解散群（仅群主）' },
                confirm: { type: 'boolean', description: '确认退群，必须为true' }
            },
            required: ['group_id', 'confirm']
        },
        handler: async (args, ctx) => {
            try {
                if (args.confirm !== true) {
                    return { success: false, error: '需要确认退群操作' }
                }
                
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                // icqq 方式
                const group = bot.pickGroup?.(groupId)
                if (group?.quit) {
                    await group.quit(args.is_dismiss || false)
                    return { success: true, group_id: groupId, action: args.is_dismiss ? 'dismiss' : 'leave' }
                }
                
                // NapCat/go-cqhttp 方式
                if (bot.sendApi) {
                    await bot.sendApi('set_group_leave', {
                        group_id: groupId,
                        is_dismiss: args.is_dismiss || false
                    })
                    return { success: true, group_id: groupId, action: args.is_dismiss ? 'dismiss' : 'leave' }
                }
                
                return { success: false, error: '当前协议不支持退群操作' }
            } catch (err) {
                return { success: false, error: `退群失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_friend',
        description: '删除好友（需谨慎使用）',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' },
                confirm: { type: 'boolean', description: '确认删除，必须为true' }
            },
            required: ['user_id', 'confirm']
        },
        handler: async (args, ctx) => {
            try {
                if (args.confirm !== true) {
                    return { success: false, error: '需要确认删除好友操作' }
                }
                
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id)
                
                // icqq 方式
                const friend = bot.pickFriend?.(userId)
                if (friend?.delete) {
                    await friend.delete()
                    return { success: true, user_id: userId }
                }
                
                // NapCat/go-cqhttp 方式
                if (bot.sendApi) {
                    await bot.sendApi('delete_friend', { user_id: userId })
                    return { success: true, user_id: userId }
                }
                
                return { success: false, error: '当前协议不支持删除好友' }
            } catch (err) {
                return { success: false, error: `删除好友失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_portrait',
        description: '设置群头像（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file: { type: 'string', description: '图片文件路径或URL' }
            },
            required: ['group_id', 'file']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                // icqq 方式
                const group = bot.pickGroup?.(groupId)
                if (group?.setAvatar) {
                    await group.setAvatar(args.file)
                    return { success: true, group_id: groupId }
                }
                
                // NapCat/go-cqhttp 方式
                if (bot.sendApi) {
                    await bot.sendApi('set_group_portrait', {
                        group_id: groupId,
                        file: args.file
                    })
                    return { success: true, group_id: groupId }
                }
                
                return { success: false, error: '当前协议不支持设置群头像' }
            } catch (err) {
                return { success: false, error: `设置群头像失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_at_all_remain',
        description: '获取群@全体成员剩余次数',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id || e?.group_id)
                
                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }
                
                // NapCat/go-cqhttp API
                if (bot.sendApi) {
                    const result = await bot.sendApi('get_group_at_all_remain', { group_id: groupId })
                    const data = result?.data || result
                    return {
                        success: true,
                        group_id: groupId,
                        can_at_all: data?.can_at_all ?? true,
                        remain_at_all_count_for_group: data?.remain_at_all_count_for_group,
                        remain_at_all_count_for_uin: data?.remain_at_all_count_for_uin
                    }
                }
                
                return { success: false, error: '当前协议不支持获取@全体剩余次数' }
            } catch (err) {
                return { success: false, error: `获取@全体剩余次数失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_anonymous_ban',
        description: '禁言群匿名成员',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                anonymous_flag: { type: 'string', description: '匿名用户标识（从消息获取）' },
                duration: { type: 'number', description: '禁言时长(秒)，0表示解禁' }
            },
            required: ['group_id', 'anonymous_flag', 'duration']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                const duration = Math.min(Math.max(args.duration, 0), 30 * 24 * 3600)
                
                // NapCat/go-cqhttp API
                if (bot.sendApi) {
                    await bot.sendApi('set_group_anonymous_ban', {
                        group_id: groupId,
                        anonymous_flag: args.anonymous_flag,
                        duration
                    })
                    return { success: true, group_id: groupId, duration }
                }
                
                return { success: false, error: '当前协议不支持禁言匿名成员' }
            } catch (err) {
                return { success: false, error: `禁言匿名成员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_anonymous',
        description: '设置群匿名功能开关',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                enable: { type: 'boolean', description: '是否开启匿名' }
            },
            required: ['group_id', 'enable']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                // icqq 方式
                const group = bot.pickGroup?.(groupId)
                if (group?.setAnonymous) {
                    await group.setAnonymous(args.enable)
                    return { success: true, group_id: groupId, enabled: args.enable }
                }
                
                // NapCat/go-cqhttp API
                if (bot.sendApi) {
                    await bot.sendApi('set_group_anonymous', {
                        group_id: groupId,
                        enable: args.enable
                    })
                    return { success: true, group_id: groupId, enabled: args.enable }
                }
                
                return { success: false, error: '当前协议不支持设置匿名功能' }
            } catch (err) {
                return { success: false, error: `设置匿名功能失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_system_msg',
        description: '获取群系统消息（加群请求、邀请等）',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                
                // NapCat/go-cqhttp API
                if (bot.sendApi) {
                    const result = await bot.sendApi('get_group_system_msg', {})
                    const data = result?.data || result
                    return {
                        success: true,
                        invited_requests: data?.invited_requests || [],
                        join_requests: data?.join_requests || []
                    }
                }
                
                return { success: false, error: '当前协议不支持获取群系统消息' }
            } catch (err) {
                return { success: false, error: `获取群系统消息失败: ${err.message}` }
            }
        }
    }
]
