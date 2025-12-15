/**
 * 群管理工具
 * 禁言、踢人、设置群名片等管理功能
 */

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
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                const duration = Math.min(Math.max(args.duration, 0), 30 * 24 * 3600)
                
                const group = bot.pickGroup(groupId)
                await group.muteMember(userId, duration)
                
                return { 
                    success: true, 
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
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                
                const group = bot.pickGroup(groupId)
                await group.kickMember(userId, args.reject_add || false)
                
                return { success: true, group_id: groupId, user_id: userId }
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
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                
                const group = bot.pickGroup(groupId)
                const member = group.pickMember(userId)
                await member.setCard(args.card)
                
                return { success: true, group_id: groupId, user_id: userId, card: args.card }
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
                const groupId = parseInt(args.group_id)
                
                const group = bot.pickGroup(groupId)
                await group.muteAll(args.enable)
                
                return { 
                    success: true, 
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
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                
                const group = bot.pickGroup(groupId)
                await group.setAdmin(userId, args.enable)
                
                return { 
                    success: true, 
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
                const groupId = parseInt(args.group_id)
                
                const group = bot.pickGroup(groupId)
                await group.setName(args.name)
                
                return { success: true, group_id: groupId, name: args.name }
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
                const groupId = parseInt(args.group_id)
                const userId = parseInt(args.user_id)
                
                const group = bot.pickGroup(groupId)
                const member = group.pickMember(userId)
                await member.setTitle(args.title, args.duration || -1)
                
                return { success: true, group_id: groupId, user_id: userId, title: args.title }
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
    }
]
