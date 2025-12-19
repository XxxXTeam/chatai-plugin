/**
 * 群组信息工具
 * 获取群信息、成员列表等
 */

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
                    memberList = await bot.getGroupMemberList(groupId) || []
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
                        memberList = await bot.getGroupMemberList(groupId) || []
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
                    .sort((a, b) => a.role === 'owner' ? -1 : 1)  // 群主排前面
                
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
                        memberList = await bot.getGroupMemberList(groupId) || []
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
        name: 'get_group_honor',
        description: '获取群荣誉信息（龙王、群聊之火等）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                type: { 
                    type: 'string', 
                    description: '荣誉类型：talkative(龙王)、performer(群聊之火)、legend(群聊炽焰)、strong_newbie(冒尖小春笋)、emotion(快乐源泉)、all(全部)',
                    enum: ['talkative', 'performer', 'legend', 'strong_newbie', 'emotion', 'all']
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id || e?.group_id)
                const honorType = args.type || 'all'
                
                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }
                
                // 尝试获取群荣誉
                if (!bot.getGroupHonorInfo) {
                    return { success: false, error: '当前协议不支持获取群荣誉' }
                }
                
                const honor = await bot.getGroupHonorInfo(groupId, honorType)
                
                return {
                    success: true,
                    group_id: groupId,
                    type: honorType,
                    honor: honor
                }
            } catch (err) {
                return { success: false, error: `获取群荣誉失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_notice',
        description: '获取群公告列表',
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
                
                const group = bot.pickGroup?.(groupId)
                if (!group?.getAnnouncementList && !bot.getGroupNotice) {
                    return { success: false, error: '当前协议不支持获取群公告' }
                }
                
                let notices = []
                try {
                    if (group?.getAnnouncementList) {
                        notices = await group.getAnnouncementList() || []
                    } else if (bot.getGroupNotice) {
                        notices = await bot.getGroupNotice(groupId) || []
                    }
                } catch (e) {
                    return { success: false, error: '获取群公告失败' }
                }
                
                const formattedNotices = notices.slice(0, 10).map(n => ({
                    id: n.notice_id || n.fid,
                    content: n.message?.text || n.content || '',
                    sender_id: n.sender_id || n.u,
                    time: n.publish_time || n.pubt,
                    confirm_required: n.need_confirm || n.type === 1
                }))
                
                return {
                    success: true,
                    group_id: groupId,
                    count: formattedNotices.length,
                    notices: formattedNotices
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
                    member_info: isInGroup ? {
                        nickname: memberInfo.nickname || memberInfo.nick || '',
                        card: memberInfo.card || '',
                        role: memberInfo.role || 'member',
                        title: memberInfo.title || ''
                    } : null,
                    avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=640`
                }
            } catch (err) {
                return { success: false, error: `检查失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_stat',
        description: '获取群统计信息（成员角色分布等）',
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
                        memberList = await bot.getGroupMemberList(groupId) || []
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
                
                // 统计信息
                const stats = {
                    total: memberList.length,
                    owner: 0,
                    admin: 0,
                    member: 0,
                    male: 0,
                    female: 0,
                    unknown_sex: 0
                }
                
                for (const m of memberList) {
                    // 角色统计
                    if (m.role === 'owner') stats.owner++
                    else if (m.role === 'admin') stats.admin++
                    else stats.member++
                    
                    // 性别统计
                    if (m.sex === 'male') stats.male++
                    else if (m.sex === 'female') stats.female++
                    else stats.unknown_sex++
                }
                
                return {
                    success: true,
                    group_id: groupId,
                    group_name: groupInfo.group_name,
                    max_member_count: groupInfo.max_member_count,
                    stats
                }
            } catch (err) {
                return { success: false, error: `获取统计失败: ${err.message}` }
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
    },

    {
        name: 'get_random_group_member',
        description: '随机抽取群成员，可用于随机点名、抽奖等场景',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                count: { type: 'number', description: '抽取数量，默认1，最多50' },
                exclude_bot: { type: 'boolean', description: '是否排除机器人，默认true' },
                exclude_admin: { type: 'boolean', description: '是否排除管理员和群主，默认false' },
                role_filter: { 
                    type: 'string', 
                    description: '角色过滤：all(所有)、member(仅普通成员)、admin(仅管理员)、owner(仅群主)',
                    enum: ['all', 'member', 'admin', 'owner']
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id || e?.group_id)
                const count = Math.min(Math.max(args.count || 1, 1), 50)
                const excludeBot = args.exclude_bot !== false
                const excludeAdmin = args.exclude_admin === true
                const roleFilter = args.role_filter || 'all'
                
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
                        memberList = await bot.getGroupMemberList(groupId) || []
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
                    return { success: false, error: `获取成员列表失败: ${e.message}` }
                }
                
                if (memberList.length === 0) {
                    return { success: false, error: '群成员列表为空' }
                }
                
                // 过滤成员
                let filteredList = memberList.filter(m => {
                    const userId = m.user_id || m.uid
                    const role = m.role || 'member'
                    if (excludeBot && userId === bot.uin) return false
                    
                    // 排除管理员
                    if (excludeAdmin && (role === 'admin' || role === 'owner')) return false
                    
                    // 角色过滤
                    if (roleFilter === 'member' && role !== 'member') return false
                    if (roleFilter === 'admin' && role !== 'admin') return false
                    if (roleFilter === 'owner' && role !== 'owner') return false
                    
                    return true
                })
                
                if (filteredList.length === 0) {
                    return { success: false, error: '没有符合条件的群成员' }
                }
                
                // 随机抽取
                const selected = []
                const usedIndices = new Set()
                const actualCount = Math.min(count, filteredList.length)
                
                while (selected.length < actualCount) {
                    const randomIndex = Math.floor(Math.random() * filteredList.length)
                    if (!usedIndices.has(randomIndex)) {
                        usedIndices.add(randomIndex)
                        const m = filteredList[randomIndex]
                        selected.push({
                            user_id: m.user_id || m.uid,
                            nickname: m.nickname || m.nick || '',
                            card: m.card || '',
                            role: m.role || 'member',
                            title: m.title || '',
                            display_name: m.card || m.nickname || m.nick || `用户${m.user_id || m.uid}`,
                            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${m.user_id || m.uid}&s=100`
                        })
                    }
                }
                
                return {
                    success: true,
                    group_id: groupId,
                    group_name: groupInfo.group_name,
                    total_members: memberList.length,
                    filtered_count: filteredList.length,
                    selected_count: selected.length,
                    members: selected
                }
            } catch (err) {
                return { success: false, error: `随机抽取失败: ${err.message}` }
            }
        }
    }
]
