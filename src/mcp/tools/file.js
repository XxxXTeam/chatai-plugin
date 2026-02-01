/**
 * 文件操作工具
 */

import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { icqqGroup, callOneBotApi } from './helpers.js'

const DANGEROUS_PATHS_WINDOWS = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\Users\\Default',
    'C:\\Users\\Public',
    'C:\\System Volume Information',
    'C:\\$Recycle.Bin',
    'C:\\Recovery',
    'C:\\Boot'
]

const DANGEROUS_PATHS_LINUX = [
    '/bin',
    '/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/usr/lib',
    '/usr/lib64',
    '/lib',
    '/lib64',
    '/boot',
    '/etc',
    '/root',
    '/sys',
    '/proc',
    '/dev',
    '/run',
    '/var/run',
    '/var/lib',
    '/snap'
]

const isWindows = process.platform === 'win32'
const DANGEROUS_PATHS = isWindows ? DANGEROUS_PATHS_WINDOWS : DANGEROUS_PATHS_LINUX

function isPathDangerous(targetPath) {
    const resolved = path.resolve(targetPath).toLowerCase()
    const normalizedDangerous = DANGEROUS_PATHS.map(p => path.resolve(p).toLowerCase())

    for (const dangerous of normalizedDangerous) {
        if (resolved === dangerous || resolved.startsWith(dangerous + path.sep)) {
            return true
        }
    }
    return false
}

function getSafePath(targetPath) {
    const resolved = path.resolve(targetPath)
    if (isPathDangerous(resolved)) {
        throw new Error(`禁止操作系统关键目录: ${targetPath}`)
    }
    return resolved
}

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
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)

                let files = []
                if (adapter === 'icqq') {
                    const fs = icqqGroup.getFs(bot, groupId)
                    if (fs?.ls) {
                        files = await fs.ls(args.folder_id || '/')
                    }
                } else {
                    const result = await callOneBotApi(bot, 'get_group_file_list', {
                        group_id: groupId,
                        folder_id: args.folder_id || '/'
                    })
                    files = result?.data?.files || result?.files || []
                }

                const result = (files || []).map(f => ({
                    name: f.name || f.file_name,
                    id: f.id || f.fid || f.file_id,
                    size: f.size || f.file_size,
                    type: f.type || (f.is_dir ? 'folder' : 'file'),
                    upload_time: f.upload_time || f.create_time,
                    uploader: f.uploader || f.uploader_uin || f.user_id
                }))

                return { success: true, adapter, group_id: groupId, count: result.length, files: result }
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
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)

                let url = ''
                if (adapter === 'icqq') {
                    const fs = icqqGroup.getFs(bot, groupId)
                    if (fs?.download) {
                        const result = await fs.download(args.file_id)
                        url = result?.url || result
                    }
                } else {
                    const result = await callOneBotApi(bot, 'get_group_file_url', {
                        group_id: groupId,
                        file_id: args.file_id
                    })
                    url = result?.data?.url || result?.url
                }

                if (!url) {
                    return { success: false, error: '无法获取文件链接' }
                }

                return { success: true, adapter, group_id: groupId, file_id: args.file_id, url }
            } catch (err) {
                return { success: false, error: `获取文件链接失败: ${err.message}` }
            }
        }
    },

    {
        name: 'upload_group_file',
        description: '上传文件到群（需要文件URL或本地路径）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_url: { type: 'string', description: '文件URL、本地路径或file://协议路径' },
                name: { type: 'string', description: '文件名' },
                folder_id: { type: 'string', description: '目标文件夹ID（可选）' }
            },
            required: ['group_id', 'file_url', 'name']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)

                if (adapter === 'icqq') {
                    await icqqGroup.sendFile(bot, groupId, args.file_url, args.name)
                } else {
                    await callOneBotApi(bot, 'upload_group_file', {
                        group_id: groupId,
                        file: args.file_url,
                        name: args.name,
                        folder: args.folder_id || '/'
                    })
                }

                return { success: true, adapter, group_id: groupId, name: args.name }
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
                    // 尝试 NapCat API
                    try {
                        await callOneBotApi(bot, 'create_group_file_folder', {
                            group_id: groupId,
                            name: args.name,
                            parent_id: args.parent_id || '/'
                        })
                    } catch (e) {
                        return { success: false, error: '当前协议不支持创建文件夹' }
                    }
                }

                return { success: true, group_id: groupId, name: args.name }
            } catch (err) {
                return { success: false, error: `创建文件夹失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_file_system_info',
        description: '获取群文件系统信息（用量、数量等）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)

                // 尝试 icqq API
                const group = bot.pickGroup?.(groupId)
                if (group?.fs?.stat) {
                    const stat = await group.fs.stat()
                    return { success: true, group_id: groupId, ...stat }
                }

                // 尝试 NapCat API
                try {
                    const result = await callOneBotApi(bot, 'get_group_file_system_info', { group_id: groupId })
                    return {
                        success: true,
                        group_id: groupId,
                        file_count: result?.data?.file_count || result?.file_count,
                        limit_count: result?.data?.limit_count || result?.limit_count,
                        used_space: result?.data?.used_space || result?.used_space,
                        total_space: result?.data?.total_space || result?.total_space
                    }
                } catch (e) {
                    return { success: false, error: '当前协议不支持获取文件系统信息' }
                }
            } catch (err) {
                return { success: false, error: `获取文件系统信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_root_files',
        description: '获取群根目录文件列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)

                // 尝试 icqq API
                const group = bot.pickGroup?.(groupId)
                if (group?.getFileList || group?.fs?.ls) {
                    const files = group.getFileList ? await group.getFileList('/') : await group.fs.ls('/')
                    const result = (files || []).map(f => ({
                        name: f.name || f.file_name,
                        id: f.id || f.fid || f.file_id,
                        size: f.size || f.file_size,
                        type: f.type || (f.is_dir ? 'folder' : 'file'),
                        upload_time: f.upload_time || f.create_time,
                        uploader: f.uploader || f.uploader_uin
                    }))
                    return { success: true, group_id: groupId, files: result }
                }

                // 尝试 NapCat API
                try {
                    const result = await callOneBotApi(bot, 'get_group_root_files', { group_id: groupId })
                    return {
                        success: true,
                        group_id: groupId,
                        files: result?.data?.files || result?.files || [],
                        folders: result?.data?.folders || result?.folders || []
                    }
                } catch (e) {
                    return { success: false, error: '当前协议不支持获取根目录文件' }
                }
            } catch (err) {
                return { success: false, error: `获取根目录文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_files_by_folder',
        description: '获取群子目录文件列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                folder_id: { type: 'string', description: '文件夹ID' }
            },
            required: ['group_id', 'folder_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)

                // 尝试 icqq API
                const group = bot.pickGroup?.(groupId)
                if (group?.getFileList || group?.fs?.ls) {
                    const files = group.getFileList
                        ? await group.getFileList(args.folder_id)
                        : await group.fs.ls(args.folder_id)
                    const result = (files || []).map(f => ({
                        name: f.name || f.file_name,
                        id: f.id || f.fid || f.file_id,
                        size: f.size || f.file_size,
                        type: f.type || (f.is_dir ? 'folder' : 'file'),
                        upload_time: f.upload_time || f.create_time
                    }))
                    return { success: true, group_id: groupId, folder_id: args.folder_id, files: result }
                }

                // 尝试 NapCat API
                try {
                    const result = await callOneBotApi(bot, 'get_group_files_by_folder', {
                        group_id: groupId,
                        folder_id: args.folder_id
                    })
                    return {
                        success: true,
                        group_id: groupId,
                        folder_id: args.folder_id,
                        files: result?.data?.files || result?.files || [],
                        folders: result?.data?.folders || result?.folders || []
                    }
                } catch (e) {
                    return { success: false, error: '当前协议不支持获取子目录文件' }
                }
            } catch (err) {
                return { success: false, error: `获取子目录文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'move_group_file',
        description: '移动群文件到其他文件夹',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' },
                parent_directory: { type: 'string', description: '源文件夹ID' },
                target_directory: { type: 'string', description: '目标文件夹ID' }
            },
            required: ['group_id', 'file_id', 'parent_directory', 'target_directory']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)

                // 尝试 icqq API
                const group = bot.pickGroup?.(groupId)
                if (group?.fs?.mv) {
                    await group.fs.mv(args.file_id, args.parent_directory, args.target_directory)
                    return { success: true, group_id: groupId, file_id: args.file_id }
                }

                // 尝试 NapCat API
                try {
                    await callOneBotApi(bot, 'move_group_file', {
                        group_id: groupId,
                        file_id: args.file_id,
                        parent_directory: args.parent_directory,
                        target_directory: args.target_directory
                    })
                    return { success: true, group_id: groupId, file_id: args.file_id }
                } catch (e) {
                    return { success: false, error: '当前协议不支持移动文件' }
                }
            } catch (err) {
                return { success: false, error: `移动文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'rename_group_file',
        description: '重命名群文件',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' },
                new_name: { type: 'string', description: '新文件名' }
            },
            required: ['group_id', 'file_id', 'new_name']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)

                // 尝试 icqq API
                const group = bot.pickGroup?.(groupId)
                if (group?.fs?.rename) {
                    await group.fs.rename(args.file_id, args.new_name)
                    return { success: true, group_id: groupId, file_id: args.file_id, new_name: args.new_name }
                }

                // 尝试 NapCat API
                try {
                    await callOneBotApi(bot, 'rename_group_file', {
                        group_id: groupId,
                        file_id: args.file_id,
                        new_name: args.new_name
                    })
                    return { success: true, group_id: groupId, file_id: args.file_id, new_name: args.new_name }
                } catch (e) {
                    return { success: false, error: '当前协议不支持重命名文件' }
                }
            } catch (err) {
                return { success: false, error: `重命名文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_group_folder',
        description: '删除群文件夹',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                folder_id: { type: 'string', description: '文件夹ID' }
            },
            required: ['group_id', 'folder_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = parseInt(args.group_id)

                // 尝试 icqq API
                const group = bot.pickGroup?.(groupId)
                if (group?.fs?.rmdir) {
                    await group.fs.rmdir(args.folder_id)
                    return { success: true, group_id: groupId, folder_id: args.folder_id }
                }

                // 尝试 NapCat API
                try {
                    await callOneBotApi(bot, 'delete_group_folder', {
                        group_id: groupId,
                        folder_id: args.folder_id
                    })
                    return { success: true, group_id: groupId, folder_id: args.folder_id }
                } catch (e) {
                    return { success: false, error: '当前协议不支持删除文件夹' }
                }
            } catch (err) {
                return { success: false, error: `删除文件夹失败: ${err.message}` }
            }
        }
    },

    {
        name: 'upload_private_file',
        description: '上传私聊文件',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' },
                file_url: {
                    type: 'string',
                    description: '文件URL、本地路径或file://协议路径（如 file:///path/to/file）'
                },
                name: { type: 'string', description: '文件名' }
            },
            required: ['user_id', 'file_url', 'name']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id)

                // 尝试 icqq API
                const friend = bot.pickFriend?.(userId)
                if (friend?.sendFile) {
                    await friend.sendFile(args.file_url, args.name)
                    return { success: true, user_id: userId, name: args.name }
                }

                // 尝试 NapCat API
                try {
                    await callOneBotApi(bot, 'upload_private_file', {
                        user_id: userId,
                        file: args.file_url,
                        name: args.name
                    })
                    return { success: true, user_id: userId, name: args.name }
                } catch (e) {
                    return { success: false, error: '当前协议不支持上传私聊文件' }
                }
            } catch (err) {
                return { success: false, error: `上传私聊文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_private_file_url',
        description: '获取私聊文件下载链接',
        inputSchema: {
            type: 'object',
            properties: {
                file_id: { type: 'string', description: '文件ID' }
            },
            required: ['file_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                // 尝试 NapCat API
                try {
                    const result = await callOneBotApi(bot, 'get_private_file_url', {
                        file_id: args.file_id
                    })
                    return {
                        success: true,
                        file_id: args.file_id,
                        url: result?.data?.url || result?.url
                    }
                } catch (e) {
                    return { success: false, error: '当前协议不支持获取私聊文件链接' }
                }
            } catch (err) {
                return { success: false, error: `获取私聊文件链接失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_file',
        description: '下载文件到缓存目录',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '文件URL' },
                thread_count: { type: 'number', description: '线程数（可选）' },
                headers: { type: 'string', description: '自定义请求头JSON（可选）' }
            },
            required: ['url']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                // 尝试 NapCat API
                try {
                    const params = { url: args.url }
                    if (args.thread_count) params.thread_count = args.thread_count
                    if (args.headers) {
                        try {
                            params.headers = JSON.parse(args.headers)
                        } catch (e) {}
                    }

                    const result = await callOneBotApi(bot, 'download_file', params)
                    return {
                        success: true,
                        file: result?.data?.file || result?.file
                    }
                } catch (e) {
                    return { success: false, error: '当前协议不支持下载文件到缓存' }
                }
            } catch (err) {
                return { success: false, error: `下载文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_file_message',
        description: '发送文件消息（群聊或私聊）',
        inputSchema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    description:
                        '文件URL、本地路径或file://协议路径（如 file:///path/to/file 或 file://C:/path/to/file）'
                },
                name: { type: 'string', description: '显示的文件名' },
                target_type: { type: 'string', description: '目标类型: group/private', enum: ['group', 'private'] },
                target_id: { type: 'string', description: '目标群号或用户QQ' }
            },
            required: ['file', 'target_type', 'target_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const targetId = parseInt(args.target_id)
                const fileName = args.name || args.file.split('/').pop() || 'file'

                if (args.target_type === 'group') {
                    const group = bot.pickGroup?.(targetId)
                    if (group?.sendFile) {
                        await group.sendFile(args.file, '/', fileName)
                        return { success: true, target: 'group', target_id: targetId, name: fileName }
                    }
                    // 尝试 NapCat 方式：发送文件消息段
                    if (bot.sendGroupMsg) {
                        await bot.sendGroupMsg(targetId, [{ type: 'file', data: { file: args.file, name: fileName } }])
                        return { success: true, target: 'group', target_id: targetId, name: fileName }
                    }
                } else {
                    const friend = bot.pickFriend?.(targetId)
                    if (friend?.sendFile) {
                        await friend.sendFile(args.file, fileName)
                        return { success: true, target: 'private', target_id: targetId, name: fileName }
                    }
                    // 尝试 NapCat 方式
                    if (bot.sendPrivateMsg) {
                        await bot.sendPrivateMsg(targetId, [
                            { type: 'file', data: { file: args.file, name: fileName } }
                        ])
                        return { success: true, target: 'private', target_id: targetId, name: fileName }
                    }
                }

                return { success: false, error: '当前协议不支持发送文件消息' }
            } catch (err) {
                return { success: false, error: `发送文件消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_file',
        description: '获取文件信息（支持私聊和群聊文件）',
        inputSchema: {
            type: 'object',
            properties: {
                file_id: { type: 'string', description: '文件ID' }
            },
            required: ['file_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                // 尝试 NapCat API: get_file
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('get_file', { file_id: args.file_id })
                        if (result?.data || result?.file) {
                            return {
                                success: true,
                                file_id: args.file_id,
                                file: result.data?.file || result.file,
                                file_name: result.data?.file_name || result.file_name,
                                file_size: result.data?.file_size || result.file_size,
                                url: result.data?.url || result.url
                            }
                        }
                    } catch (e) {
                        // 继续尝试其他方法
                    }
                }

                // 尝试 get_image (如果是图片)
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('get_image', { file: args.file_id })
                        if (result?.data?.url || result?.url) {
                            return {
                                success: true,
                                file_id: args.file_id,
                                url: result.data?.url || result.url,
                                file_size: result.data?.size || result.size
                            }
                        }
                    } catch (e) {
                        // 继续
                    }
                }

                return { success: false, error: '无法获取文件信息' }
            } catch (err) {
                return { success: false, error: `获取文件信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_record',
        description: '获取语音文件信息',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: '语音文件名或ID' },
                out_format: {
                    type: 'string',
                    description: '输出格式: mp3/amr/wma/m4a/spx/ogg/wav/flac',
                    default: 'mp3'
                }
            },
            required: ['file']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()

                if (bot.sendApi) {
                    const result = await bot.sendApi('get_record', {
                        file: args.file,
                        out_format: args.out_format || 'mp3'
                    })

                    return {
                        success: true,
                        file: result?.data?.file || result?.file,
                        url: result?.data?.url || result?.url,
                        format: args.out_format || 'mp3'
                    }
                }

                return { success: false, error: '当前协议不支持获取语音信息' }
            } catch (err) {
                return { success: false, error: `获取语音信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'ocr_image',
        description: '图片OCR文字识别',
        inputSchema: {
            type: 'object',
            properties: {
                image: { type: 'string', description: '图片文件名、URL或base64' }
            },
            required: ['image']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const adapter = ctx.getAdapter?.()
                const isIcqq = adapter?.adapter === 'icqq' || (bot.pickGroup && bot.pickFriend && !bot.sendApi)
                if (isIcqq) {
                    const ocrFn = bot.imageOcr || Bot?.imageOcr
                    if (ocrFn) {
                        const result = await ocrFn.call(bot, args.image)
                        if (result?.wordslist || result?.texts) {
                            const texts = result.wordslist || result.texts || []
                            return {
                                success: true,
                                adapter: 'icqq',
                                language: result.language || '',
                                texts: texts.map(t => ({
                                    text: t.words || t.text,
                                    confidence: t.confidence,
                                    coordinates: t.polygon || t.coordinates
                                })),
                                full_text: texts.map(t => t.words || t.text).join('\n')
                            }
                        }
                    }
                    return { success: false, error: 'icqq OCR调用失败，可能需要图片URL或已发送的图片' }
                }
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('ocr_image', { image: args.image })
                        if (result?.data || result?.texts) {
                            const texts = result.data?.texts || result.texts || []
                            return {
                                success: true,
                                adapter: 'onebot',
                                language: result.data?.language || result.language || '',
                                texts: texts.map(t => ({
                                    text: t.text,
                                    confidence: t.confidence,
                                    coordinates: t.coordinates
                                })),
                                full_text: texts.map(t => t.text).join('\n')
                            }
                        }
                    } catch (apiErr) {
                        try {
                            const result = await bot.sendApi('.ocr_image', { image: args.image })
                            if (result?.data || result?.texts) {
                                const texts = result.data?.texts || result.texts || []
                                return {
                                    success: true,
                                    adapter: 'onebot',
                                    language: result.data?.language || result.language || '',
                                    texts: texts.map(t => ({
                                        text: t.text,
                                        confidence: t.confidence,
                                        coordinates: t.coordinates
                                    })),
                                    full_text: texts.map(t => t.text).join('\n')
                                }
                            }
                        } catch (e) {
                            return { success: false, error: `OCR API不支持或调用失败: ${apiErr.message}` }
                        }
                    }
                }

                return { success: false, error: '当前协议不支持OCR，支持的协议: icqq, OneBot' }
            } catch (err) {
                return { success: false, error: `OCR识别失败: ${err.message}` }
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

                if (bot.sendApi) {
                    const result = await bot.sendApi('can_send_record', {})
                    return {
                        success: true,
                        can_send: result?.data?.yes ?? result?.yes ?? true
                    }
                }

                // 默认认为可以
                return { success: true, can_send: true }
            } catch (err) {
                return { success: true, can_send: true }
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

                if (bot.sendApi) {
                    const result = await bot.sendApi('can_send_image', {})
                    return {
                        success: true,
                        can_send: result?.data?.yes ?? result?.yes ?? true
                    }
                }

                return { success: true, can_send: true }
            } catch (err) {
                return { success: true, can_send: true }
            }
        }
    },

    {
        name: 'read_file',
        description: '读取本地文件内容。支持文本文件读取，返回文件内容。路径限制在工作目录内。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径（相对于工作目录或绝对路径）' },
                encoding: { type: 'string', description: '编码格式，默认utf8', default: 'utf8' },
                max_size: { type: 'number', description: '最大读取字节数，默认1MB', default: 1048576 }
            },
            required: ['file_path']
        },
        handler: async (args, ctx) => {
            try {
                const filePath = getSafePath(args.file_path)
                const encoding = args.encoding || 'utf8'
                const maxSize = args.max_size || 1048576

                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `文件不存在: ${args.file_path}` }
                }

                const stats = fs.statSync(filePath)
                if (stats.isDirectory()) {
                    return { success: false, error: '目标是目录，请使用 list_directory' }
                }

                if (stats.size > maxSize) {
                    return { success: false, error: `文件过大 (${stats.size} bytes)，超过限制 ${maxSize} bytes` }
                }

                const content = fs.readFileSync(filePath, encoding)
                return {
                    success: true,
                    file_path: filePath,
                    size: stats.size,
                    content,
                    encoding
                }
            } catch (err) {
                return { success: false, error: `读取文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'write_file',
        description: '写入内容到本地文件。可以创建新文件或覆盖/追加到现有文件。路径限制在工作目录内。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径' },
                content: { type: 'string', description: '要写入的内容' },
                encoding: { type: 'string', description: '编码格式，默认utf8', default: 'utf8' },
                append: { type: 'boolean', description: '是否追加模式，默认false覆盖写入', default: false },
                create_dirs: { type: 'boolean', description: '是否自动创建目录，默认true', default: true }
            },
            required: ['file_path', 'content']
        },
        handler: async (args, ctx) => {
            try {
                const filePath = getSafePath(args.file_path)
                const encoding = args.encoding || 'utf8'
                const append = args.append || false
                const createDirs = args.create_dirs !== false

                if (createDirs) {
                    const dir = path.dirname(filePath)
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true })
                    }
                }

                if (append) {
                    fs.appendFileSync(filePath, args.content, encoding)
                } else {
                    fs.writeFileSync(filePath, args.content, encoding)
                }

                const stats = fs.statSync(filePath)
                return {
                    success: true,
                    file_path: filePath,
                    size: stats.size,
                    mode: append ? 'append' : 'write'
                }
            } catch (err) {
                return { success: false, error: `写入文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'list_directory',
        description: '列出目录中的文件和子目录。返回文件名、大小、类型等信息。',
        inputSchema: {
            type: 'object',
            properties: {
                dir_path: { type: 'string', description: '目录路径，默认当前工作目录', default: '.' },
                recursive: { type: 'boolean', description: '是否递归列出子目录', default: false },
                pattern: { type: 'string', description: '文件名过滤模式（如 *.txt）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const dirPath = getSafePath(args.dir_path || '.')
                const recursive = args.recursive || false
                const pattern = args.pattern

                if (!fs.existsSync(dirPath)) {
                    return { success: false, error: `目录不存在: ${args.dir_path}` }
                }

                const stats = fs.statSync(dirPath)
                if (!stats.isDirectory()) {
                    return { success: false, error: '目标不是目录' }
                }

                const listDir = (dir, depth = 0) => {
                    const items = []
                    const entries = fs.readdirSync(dir, { withFileTypes: true })

                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name)
                        const itemStats = fs.statSync(fullPath)

                        if (pattern) {
                            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
                            if (!regex.test(entry.name)) continue
                        }

                        const item = {
                            name: entry.name,
                            path: path.relative(dirPath, fullPath),
                            type: entry.isDirectory() ? 'directory' : 'file',
                            size: itemStats.size,
                            modified: itemStats.mtime.toISOString()
                        }
                        items.push(item)

                        if (recursive && entry.isDirectory() && depth < 5) {
                            item.children = listDir(fullPath, depth + 1)
                        }
                    }
                    return items
                }

                const items = listDir(dirPath)
                return {
                    success: true,
                    dir_path: dirPath,
                    count: items.length,
                    items
                }
            } catch (err) {
                return { success: false, error: `列出目录失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_to_file',
        description: '从URL下载文件到本地指定路径。支持HTTP/HTTPS链接。',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '文件下载URL' },
                save_path: { type: 'string', description: '保存路径' },
                filename: { type: 'string', description: '文件名（可选，默认从URL提取）' },
                overwrite: { type: 'boolean', description: '是否覆盖已存在文件', default: false }
            },
            required: ['url', 'save_path']
        },
        handler: async (args, ctx) => {
            try {
                const savePath = getSafePath(args.save_path)
                let filename = args.filename || path.basename(new URL(args.url).pathname) || 'downloaded_file'
                const fullPath = path.join(savePath, filename)

                if (!args.overwrite && fs.existsSync(fullPath)) {
                    return { success: false, error: `文件已存在: ${fullPath}` }
                }

                if (!fs.existsSync(savePath)) {
                    fs.mkdirSync(savePath, { recursive: true })
                }

                const response = await fetch(args.url)
                if (!response.ok) {
                    return { success: false, error: `下载失败: HTTP ${response.status}` }
                }

                const arrayBuffer = await response.arrayBuffer()
                fs.writeFileSync(fullPath, Buffer.from(arrayBuffer))

                const stats = fs.statSync(fullPath)
                return {
                    success: true,
                    url: args.url,
                    saved_path: fullPath,
                    filename,
                    size: stats.size
                }
            } catch (err) {
                return { success: false, error: `下载文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_group_file_to_file',
        description: '下载群文件到本地指定目录。先获取群文件URL，然后下载到本地。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' },
                save_path: { type: 'string', description: '保存目录路径' },
                filename: { type: 'string', description: '保存的文件名（可选）' }
            },
            required: ['group_id', 'file_id', 'save_path']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const { adapter } = ctx.getAdapter()
                const groupId = parseInt(args.group_id)
                const savePath = getSafePath(args.save_path)

                let url = ''
                let originalName = args.filename || 'group_file'

                if (adapter === 'icqq') {
                    const gfs = icqqGroup.getFs(bot, groupId)
                    if (gfs?.download) {
                        const result = await gfs.download(args.file_id)
                        url = result?.url || result
                        originalName = result?.name || originalName
                    }
                } else {
                    const result = await callOneBotApi(bot, 'get_group_file_url', {
                        group_id: groupId,
                        file_id: args.file_id
                    })
                    url = result?.data?.url || result?.url
                }

                if (!url) {
                    return { success: false, error: '无法获取文件下载链接' }
                }

                if (!fs.existsSync(savePath)) {
                    fs.mkdirSync(savePath, { recursive: true })
                }

                const fullPath = path.join(savePath, args.filename || originalName)
                const response = await fetch(url)
                if (!response.ok) {
                    return { success: false, error: `下载失败: HTTP ${response.status}` }
                }

                const arrayBuffer = await response.arrayBuffer()
                fs.writeFileSync(fullPath, Buffer.from(arrayBuffer))

                const stats = fs.statSync(fullPath)
                return {
                    success: true,
                    group_id: groupId,
                    file_id: args.file_id,
                    saved_path: fullPath,
                    size: stats.size
                }
            } catch (err) {
                return { success: false, error: `下载群文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_file',
        description: '删除本地文件或空目录。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件或目录路径' },
                recursive: { type: 'boolean', description: '是否递归删除目录内容', default: false }
            },
            required: ['file_path']
        },
        handler: async (args, ctx) => {
            try {
                const filePath = getSafePath(args.file_path)

                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `路径不存在: ${args.file_path}` }
                }

                const stats = fs.statSync(filePath)
                if (stats.isDirectory()) {
                    if (args.recursive) {
                        fs.rmSync(filePath, { recursive: true })
                    } else {
                        fs.rmdirSync(filePath)
                    }
                } else {
                    fs.unlinkSync(filePath)
                }

                return {
                    success: true,
                    deleted_path: filePath,
                    type: stats.isDirectory() ? 'directory' : 'file'
                }
            } catch (err) {
                return { success: false, error: `删除失败: ${err.message}` }
            }
        }
    },

    {
        name: 'copy_file',
        description: '复制本地文件到另一个位置。',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: '源文件路径' },
                destination: { type: 'string', description: '目标路径' },
                overwrite: { type: 'boolean', description: '是否覆盖已存在文件', default: false }
            },
            required: ['source', 'destination']
        },
        handler: async (args, ctx) => {
            try {
                const sourcePath = getSafePath(args.source)
                const destPath = getSafePath(args.destination)

                if (!fs.existsSync(sourcePath)) {
                    return { success: false, error: `源文件不存在: ${args.source}` }
                }

                if (!args.overwrite && fs.existsSync(destPath)) {
                    return { success: false, error: `目标文件已存在: ${args.destination}` }
                }

                const destDir = path.dirname(destPath)
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true })
                }

                fs.copyFileSync(sourcePath, destPath)
                const stats = fs.statSync(destPath)

                return {
                    success: true,
                    source: sourcePath,
                    destination: destPath,
                    size: stats.size
                }
            } catch (err) {
                return { success: false, error: `复制失败: ${err.message}` }
            }
        }
    },

    {
        name: 'move_file',
        description: '移动或重命名本地文件。',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: '源文件路径' },
                destination: { type: 'string', description: '目标路径' },
                overwrite: { type: 'boolean', description: '是否覆盖已存在文件', default: false }
            },
            required: ['source', 'destination']
        },
        handler: async (args, ctx) => {
            try {
                const sourcePath = getSafePath(args.source)
                const destPath = getSafePath(args.destination)

                if (!fs.existsSync(sourcePath)) {
                    return { success: false, error: `源文件不存在: ${args.source}` }
                }

                if (!args.overwrite && fs.existsSync(destPath)) {
                    return { success: false, error: `目标文件已存在: ${args.destination}` }
                }

                const destDir = path.dirname(destPath)
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true })
                }

                fs.renameSync(sourcePath, destPath)

                return {
                    success: true,
                    source: sourcePath,
                    destination: destPath
                }
            } catch (err) {
                return { success: false, error: `移动失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_file_info',
        description: '获取本地文件的详细信息，包括大小、创建时间、修改时间等。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径' }
            },
            required: ['file_path']
        },
        handler: async (args, ctx) => {
            try {
                const filePath = getSafePath(args.file_path)

                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `路径不存在: ${args.file_path}` }
                }

                const stats = fs.statSync(filePath)
                return {
                    success: true,
                    file_path: filePath,
                    type: stats.isDirectory() ? 'directory' : 'file',
                    size: stats.size,
                    created: stats.birthtime.toISOString(),
                    modified: stats.mtime.toISOString(),
                    accessed: stats.atime.toISOString(),
                    permissions: stats.mode.toString(8)
                }
            } catch (err) {
                return { success: false, error: `获取文件信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'create_directory',
        description: '创建本地目录，支持递归创建多级目录。',
        inputSchema: {
            type: 'object',
            properties: {
                dir_path: { type: 'string', description: '目录路径' },
                recursive: { type: 'boolean', description: '是否递归创建父目录', default: true }
            },
            required: ['dir_path']
        },
        handler: async (args, ctx) => {
            try {
                const dirPath = getSafePath(args.dir_path)

                if (fs.existsSync(dirPath)) {
                    return { success: true, dir_path: dirPath, message: '目录已存在' }
                }

                fs.mkdirSync(dirPath, { recursive: args.recursive !== false })

                return {
                    success: true,
                    dir_path: dirPath,
                    message: '目录创建成功'
                }
            } catch (err) {
                return { success: false, error: `创建目录失败: ${err.message}` }
            }
        }
    }
]
