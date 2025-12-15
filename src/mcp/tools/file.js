/**
 * 文件操作工具
 * 文件上传、下载、解析等
 */

export const fileTools = [
    {
        name: 'get_group_files',
        description: '获取群文件列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                folder_id: { type: 'string', description: '文件夹ID，不填表示根目录' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                const group = bot.pickGroup(groupId)
                let files = []
                
                if (group.getFileList) {
                    files = await group.getFileList(args.folder_id || '/')
                } else if (group.fs?.ls) {
                    files = await group.fs.ls(args.folder_id || '/')
                }
                
                const result = (files || []).map(f => ({
                    name: f.name || f.file_name,
                    id: f.id || f.fid || f.file_id,
                    size: f.size || f.file_size,
                    type: f.type || (f.is_dir ? 'folder' : 'file'),
                    upload_time: f.upload_time || f.create_time,
                    uploader: f.uploader || f.uploader_uin
                }))
                
                return { success: true, group_id: groupId, count: result.length, files: result }
            } catch (err) {
                return { success: false, error: `获取群文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_file_url',
        description: '获取群文件下载链接',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' }
            },
            required: ['group_id', 'file_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                const group = bot.pickGroup(groupId)
                let url = ''
                
                if (group.getFileUrl) {
                    url = await group.getFileUrl(args.file_id)
                } else if (group.fs?.download) {
                    url = await group.fs.download(args.file_id)
                }
                
                if (!url) {
                    return { success: false, error: '无法获取文件链接' }
                }
                
                return { success: true, group_id: groupId, file_id: args.file_id, url }
            } catch (err) {
                return { success: false, error: `获取文件链接失败: ${err.message}` }
            }
        }
    },

    {
        name: 'upload_group_file',
        description: '上传文件到群（需要文件URL）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_url: { type: 'string', description: '文件URL' },
                name: { type: 'string', description: '文件名' },
                folder_id: { type: 'string', description: '目标文件夹ID（可选）' }
            },
            required: ['group_id', 'file_url', 'name']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                const group = bot.pickGroup(groupId)
                
                if (group.sendFile) {
                    await group.sendFile(args.file_url, args.folder_id, args.name)
                } else if (group.fs?.upload) {
                    await group.fs.upload(args.file_url, args.folder_id || '/', args.name)
                } else {
                    return { success: false, error: '当前协议不支持上传文件' }
                }
                
                return { success: true, group_id: groupId, name: args.name }
            } catch (err) {
                return { success: false, error: `上传文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_group_file',
        description: '删除群文件',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' }
            },
            required: ['group_id', 'file_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                const group = bot.pickGroup(groupId)
                
                if (group.deleteFile) {
                    await group.deleteFile(args.file_id)
                } else if (group.fs?.rm) {
                    await group.fs.rm(args.file_id)
                } else {
                    return { success: false, error: '当前协议不支持删除文件' }
                }
                
                return { success: true, group_id: groupId, file_id: args.file_id }
            } catch (err) {
                return { success: false, error: `删除文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'create_group_folder',
        description: '创建群文件夹',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                name: { type: 'string', description: '文件夹名称' },
                parent_id: { type: 'string', description: '父文件夹ID（可选）' }
            },
            required: ['group_id', 'name']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)
                
                const group = bot.pickGroup(groupId)
                
                if (group.createFolder) {
                    await group.createFolder(args.name, args.parent_id || '/')
                } else if (group.fs?.mkdir) {
                    await group.fs.mkdir(args.name)
                } else {
                    return { success: false, error: '当前协议不支持创建文件夹' }
                }
                
                return { success: true, group_id: groupId, name: args.name }
            } catch (err) {
                return { success: false, error: `创建文件夹失败: ${err.message}` }
            }
        }
    }
]
