/**
 * 群组信息工具
 * 获取群信息、成员列表等
 */

import { groupNoticeApi } from './helpers.js'

export const groupTools = [
    {
        name: 'get_group_info',
        description: '获取群组的基本信息，包括群名、成员数量等',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            const bot = ctx.getBot()
            const groupId = parseInt(args.group_id)

            const groupInfo = bot.gl?.get(groupId)
            if (groupInfo) {
                return {
                    success: true,
                    group_id: groupId,
                    group_name: groupInfo.group_name,
                    member_count: groupInfo.member_count,
                    max_member_count: groupInfo.max_member_count,
                    owner_id: groupInfo.owner_id,
                    admin_flag: groupInfo.admin_flag,
                    avatar_url: `https://p.qlogo.cn/gh/${groupId}/${groupId}/640`,
                    bot_in_group: true
                }
            }

            try {
                const group = bot.pickGroup(groupId)
                const info = group.info || {}
                if (info.group_name || info.member_count) {
                    return {
                        success: true,
                        group_id: groupId,
                        group_name: info.group_name || '未知',
                        member_count: info.member_count || null,
                        avatar_url: `https://p.qlogo.cn/gh/${groupId}/${groupId}/640`,
                        bot_in_group: false,
                        note: '机器人不在此群内，信息可能不完整'
                    }
                }
            } catch (e) {}

            return {
                success: false,
                group_id: groupId,
                error: '无法获取群信息',
                avatar_url: `https://p.qlogo.cn/gh/${groupId}/${groupId}/640`
            }
        }
    },

    {
        name: 'get_group_list',
        description: '获取机器人加入的群列表',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: '返回的最大数量，默认50' }
            }
        },
        handler: async (args, ctx) => {
            const bot = ctx.getBot()
            const limit = args.limit || 50
            const gl = bot.gl || new Map()

            const groups = []
            let count = 0
            for (const [gid, group] of gl) {
                if (count >= limit) break
                groups.push({
                    group_id: gid,
                    group_name: group.group_name,
                    member_count: group.member_count
                })
                count++
            }

            return { success: true, total: gl.size, returned: groups.length, groups }
        }
    },

    {
        name: 'get_group_member_list',
        description: '获取群成员列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                limit: { type: 'number', description: '返回的最大数量，默认100' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            const bot = ctx.getBot()
            const groupId = parseInt(args.group_id)
            const limit = args.limit || 100

            const groupInfo = bot.gl?.get(groupId)
            if (!groupInfo) {
                return {
                    success: false,
                    group_id: groupId,
                    error: '机器人不在此群内',
                    members: []
                }
            }

            let memberList = []
            try {
                if (bot.getGroupMemberList) {
                    const result = await bot.getGroupMemberList(groupId)
                    // 处理返回值可能是 Map 的情况
                    if (result instanceof Map) {
                        memberList = Array.from(result.values())
                    } else if (Array.isArray(result)) {
                        memberList = result
                    } else {
                        memberList = []
                    }
                } else {
                    const group = bot.pickGroup?.(groupId)
                    if (group?.getMemberMap) {
                        const memberMap = await group.getMemberMap()
                        for (const [uid, member] of memberMap) {
                            memberList.push({ user_id: uid, ...member })
                        }
                    }
                }
            } catch (e) {
                return { success: false, error: `获取成员列表失败: ${e.message}`, members: [] }
            }

            const members = memberList.slice(0, limit).map(m => ({
                user_id: m.user_id || m.uid,
                nickname: m.nickname || m.nick || '',
                card: m.card || '',
                role: m.role || 'member',
                title: m.title || ''
            }))

            return {
                success: true,
                group_id: groupId,
                group_name: groupInfo.group_name,
                total: memberList.length,
                returned: members.length,
                members
            }
        }
    },

    {
        name: 'get_group_member_info',
        description: '获取群成员的详细信息',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号' }
            },
            required: ['group_id', 'user_id']
        },
        handler: async (args, ctx) => {
            const bot = ctx.getBot()
            const groupId = parseInt(args.group_id)
            const userId = parseInt(args.user_id)

            const groupInfo = bot.gl?.get(groupId)
            if (!groupInfo) {
                return {
                    success: false,
                    error: '机器人不在此群内',
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                }
            }

            const group = bot.pickGroup(groupId)
            const memberObj = group.pickMember(userId)
            const member = memberObj.info || {}

            if (!member.user_id) {
                try {
                    const memberMap = await group.getMemberMap()
                    const memberData = memberMap.get(userId)
                    if (memberData) Object.assign(member, memberData)
                } catch (e) {}
            }

            if (!member.nickname && !member.card) {
                return {
                    success: false,
                    error: '该用户可能不在此群内',
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                }
            }

            return {
                success: true,
                group_id: groupId,
                user_id: userId,
                nickname: member.nickname || '未知',
                card: member.card || '',
                role: member.role || 'member',
                title: member.title || '',
                level: member.level,
                join_time: member.join_time,
                avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
            }
        }
    },

    {
        name: 'get_current_group',
        description: '获取当前会话所在群的详细信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()

                if (!e?.group_id) {
                    return { success: false, error: '当前不在群聊中' }
                }

                const groupId = e.group_id
                const groupInfo = bot.gl?.get(groupId) || {}

                return {
                    success: true,
                    group_id: groupId,
                    group_name: groupInfo.group_name || e.group_name || '',
                    member_count: groupInfo.member_count,
                    max_member_count: groupInfo.max_member_count,
                    owner_id: groupInfo.owner_id,
                    is_admin: groupInfo.admin_flag,
                    avatar_url: `https://p.qlogo.cn/gh/${groupId}/${groupId}/640`
                }
            } catch (err) {
                return { success: false, error: `获取群信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_admins',
        description: '获取群管理员列表（包括群主）',
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

                const groupInfo = bot.gl?.get(groupId)
                if (!groupInfo) {
                    return { success: false, error: '机器人不在此群内' }
                }

                // 获取成员列表
                let memberList = []
                try {
                    if (bot.getGroupMemberList) {
                        const result = await bot.getGroupMemberList(groupId)
                        if (result instanceof Map) {
                            memberList = Array.from(result.values())
                        } else if (Array.isArray(result)) {
                            memberList = result
                        } else {
                            memberList = []
                        }
                    } else {
                        const group = bot.pickGroup?.(groupId)
                        if (group?.getMemberMap) {
                            const memberMap = await group.getMemberMap()
                            for (const [uid, member] of memberMap) {
                                memberList.push({ user_id: uid, ...member })
                            }
                        }
                    }
                } catch (e) {}

                // 筛选管理员
                const admins = memberList
                    .filter(m => m.role === 'owner' || m.role === 'admin')
                    .map(m => ({
                        user_id: m.user_id || m.uid,
                        nickname: m.nickname || m.nick || '',
                        card: m.card || '',
                        role: m.role,
                        title: m.title || '',
                        avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${m.user_id || m.uid}&s=100`
                    }))
                    .sort((a, b) => (a.role === 'owner' ? -1 : 1)) // 群主排前面

                return {
                    success: true,
                    group_id: groupId,
                    group_name: groupInfo.group_name,
                    owner: admins.find(a => a.role === 'owner') || null,
                    admin_count: admins.length,
                    admins
                }
            } catch (err) {
                return { success: false, error: `获取管理员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_group_member',
        description: '在群成员中搜索用户（按昵称或群名片）',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '搜索关键词' },
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                limit: { type: 'number', description: '返回数量限制，默认10' }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id || e?.group_id)
                const keyword = args.keyword.toLowerCase()
                const limit = args.limit || 10

                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }

                const groupInfo = bot.gl?.get(groupId)
                if (!groupInfo) {
                    return { success: false, error: '机器人不在此群内' }
                }

                // 获取成员列表
                let memberList = []
                try {
                    if (bot.getGroupMemberList) {
                        const result = await bot.getGroupMemberList(groupId)
                        if (result instanceof Map) {
                            memberList = Array.from(result.values())
                        } else if (Array.isArray(result)) {
                            memberList = result
                        } else {
                            memberList = []
                        }
                    } else {
                        const group = bot.pickGroup?.(groupId)
                        if (group?.getMemberMap) {
                            const memberMap = await group.getMemberMap()
                            for (const [uid, member] of memberMap) {
                                memberList.push({ user_id: uid, ...member })
                            }
                        }
                    }
                } catch (e) {
                    return { success: false, error: '获取成员列表失败' }
                }

                // 搜索匹配
                const matches = []
                for (const m of memberList) {
                    const nickname = (m.nickname || m.nick || '').toLowerCase()
                    const card = (m.card || '').toLowerCase()
                    const uid = String(m.user_id || m.uid)

                    if (nickname.includes(keyword) || card.includes(keyword) || uid.includes(args.keyword)) {
                        let matchType = 'nickname'
                        if (card.includes(keyword)) matchType = 'card'
                        else if (uid.includes(args.keyword)) matchType = 'user_id'

                        matches.push({
                            user_id: m.user_id || m.uid,
                            nickname: m.nickname || m.nick || '',
                            card: m.card || '',
                            role: m.role || 'member',
                            match_type: matchType,
                            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${m.user_id || m.uid}&s=100`
                        })
                        if (matches.length >= limit) break
                    }
                }

                return {
                    success: true,
                    group_id: groupId,
                    keyword: args.keyword,
                    count: matches.length,
                    members: matches
                }
            } catch (err) {
                return { success: false, error: `搜索失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_notice',
        description: '获取群公告列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                index: { type: 'number', description: '获取指定序号的公告详情（1-N），不填则获取列表' },
                limit: { type: 'number', description: '返回数量限制，默认10' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id || e?.group_id)
                const limit = args.limit || 10

                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }

                // 获取指定序号的公告
                if (args.index) {
                    try {
                        const notice = await groupNoticeApi.getNoticeList(bot, groupId, args.index)
                        if (notice?.fid) {
                            return {
                                success: true,
                                group_id: groupId,
                                index: args.index,
                                notice: {
                                    id: notice.fid,
                                    content: notice.text
                                }
                            }
                        }
                        return { success: false, error: `未找到序号 ${args.index} 的公告` }
                    } catch (err) {
                        return { success: false, error: err.message }
                    }
                }

                // 获取公告列表
                try {
                    const notices = await groupNoticeApi.getNoticeList(bot, groupId)

                    const formattedNotices = (Array.isArray(notices) ? notices : []).slice(0, limit).map((n, idx) => ({
                        index: idx + 1,
                        id: n.notice_id || n.fid,
                        content: n.message?.text || n.msg?.text || n.content || '',
                        sender_id: n.sender_id || n.u,
                        time: n.publish_time || n.pubt,
                        confirm_required: n.need_confirm || n.type === 1,
                        read_count: n.read_num,
                        is_pinned: n.is_top || n.pinned
                    }))

                    return {
                        success: true,
                        group_id: groupId,
                        count: formattedNotices.length,
                        notices: formattedNotices
                    }
                } catch (err) {
                    return { success: false, error: err.message }
                }
            } catch (err) {
                return { success: false, error: `获取群公告失败: ${err.message}` }
            }
        }
    },

    {
        name: 'check_in_group',
        description: '检查用户是否在指定群内',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' },
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id)
                const groupId = parseInt(args.group_id || e?.group_id)

                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }

                const groupInfo = bot.gl?.get(groupId)
                if (!groupInfo) {
                    return { success: false, error: '机器人不在此群内' }
                }

                // 获取成员信息
                const group = bot.pickGroup(groupId)
                let memberInfo = null
                try {
                    const memberMap = await group.getMemberMap()
                    memberInfo = memberMap.get(userId)
                } catch (e) {}

                const isInGroup = !!memberInfo

                return {
                    success: true,
                    user_id: userId,
                    group_id: groupId,
                    group_name: groupInfo.group_name,
                    is_in_group: isInGroup,
                    member_info: isInGroup
                        ? {
                              nickname: memberInfo.nickname || memberInfo.nick || '',
                              card: memberInfo.card || '',
                              role: memberInfo.role || 'member',
                              title: memberInfo.title || ''
                          }
                        : null,
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                }
            } catch (err) {
                return { success: false, error: `检查失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_group',
        description: '在已加入的群列表中搜索群组',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '搜索关键词（群名或群号）' },
                limit: { type: 'number', description: '返回数量限制，默认10' }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const keyword = args.keyword.toLowerCase()
                const limit = args.limit || 10
                const gl = bot.gl || new Map()

                const matches = []
                for (const [gid, group] of gl) {
                    const groupName = (group.group_name || '').toLowerCase()
                    const groupIdStr = String(gid)

                    if (groupName.includes(keyword) || groupIdStr.includes(args.keyword)) {
                        matches.push({
                            group_id: gid,
                            group_name: group.group_name,
                            member_count: group.member_count,
                            match_type: groupIdStr.includes(args.keyword) ? 'group_id' : 'group_name',
                            avatar_url: `https://p.qlogo.cn/gh/${gid}/${gid}/100`
                        })
                        if (matches.length >= limit) break
                    }
                }

                return {
                    success: true,
                    keyword: args.keyword,
                    count: matches.length,
                    groups: matches
                }
            } catch (err) {
                return { success: false, error: `搜索失败: ${err.message}` }
            }
        }
    }
]
