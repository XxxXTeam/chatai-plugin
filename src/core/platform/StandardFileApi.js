/**
 * @fileoverview Yunzai 标准群/私聊文件能力边界。
 * @module core/platform/StandardFileApi
 */

import { StandardBotApi } from './StandardBotApi.js'
import { UnsupportedBotApiError } from './StandardBotResult.js'

/**
 * 标准文件接口。
 */
export class StandardFileApi {
    /**
     * @param {StandardBotApi} api - 标准 Bot API
     */
    constructor(api) {
        this.api = api
    }

    /**
     * 从工具上下文构造。
     * @param {Object} ctx - 工具上下文
     * @returns {StandardFileApi} 标准文件接口
     */
    static fromContext(ctx) {
        return new StandardFileApi(StandardBotApi.fromContext(ctx))
    }

    /** @returns {string} 适配器标识 */
    get adapterId() {
        return this.api.adapterId
    }

    /** @returns {string} 规范化适配器类别 */
    get adapterType() {
        return this.api.adapterType
    }

    /**
     * 获取群文件系统对象。
     * @param {string|number} groupId - 群 ID
     * @returns {Object} 文件系统对象
     */
    groupFileSystem(groupId) {
        this.assertGroupFileSystemSupported()
        const fs = this.groupOrNull(groupId)?.fs
        if (!fs) throw new UnsupportedBotApiError('group.fileSystem')
        return fs
    }

    /**
     * 获取群对象；sendApi-only OneBot 没有 picker 时返回 null，由调用方走 action。
     * @param {string|number} groupId - 群 ID
     * @returns {Object|null} 群对象
     */
    groupOrNull(groupId) {
        try {
            return this.api.group(groupId)
        } catch (error) {
            if (error?.code === 'UNSUPPORTED_BOT_API') return null
            throw error
        }
    }

    /**
     * 校验文件系统写操作返回。
     * @param {*} result - 文件系统返回
     * @param {string} action - 动作名
     * @returns {*} 原始结果
     */
    assertWriteResult(result, action) {
        this.api.assertResult(result, action)
        return result
    }

    /**
     * 规范化 Yunzai/OneBot 群文件列表返回。
     * @param {*} result - 数组或 `{files,folders}`
     * @param {string} action - 动作名
     * @returns {Array} 扁平文件与目录列表
     */
    normalizeFileList(result, action) {
        const grouped = this.normalizeFileGroups(result, action)
        return [
            ...grouped.folders.map(folder => ({ ...folder, is_dir: true, type: folder.type || 'folder' })),
            ...grouped.files
        ]
    }

    /**
     * 保留文件与目录分组。
     * @param {*} result - 协议端结果
     * @param {string} action - 动作名
     * @returns {{files:Array,folders:Array}} 分组结果
     */
    normalizeFileGroups(result, action) {
        this.api.assertResult(result, action)
        const data = result?.data || result
        if (Array.isArray(data)) {
            return {
                files: data.filter(item => !item?.is_dir && item?.type !== 'folder'),
                folders: data.filter(item => item?.is_dir || item?.type === 'folder')
            }
        }
        if (data && (Array.isArray(data.files) || Array.isArray(data.folders))) {
            return { files: data.files || [], folders: data.folders || [] }
        }
        throw new Error(`${action} 未返回有效文件列表`)
    }

    /**
     * QQBot 仅支持通过标准消息段发送文件，不提供群文件系统管理接口。
     * @returns {void}
     */
    assertGroupFileSystemSupported() {
        if (this.api.isQQBot) throw new UnsupportedBotApiError('group.fileSystem')
    }

    /**
     * 获取群文件列表。
     * @param {string|number} groupId - 群 ID
     * @param {string} [folderId] - 文件夹 ID
     * @returns {Promise<Array>} 文件列表
     */
    async listGroupFiles(groupId, folderId) {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        const isRoot = folderId === undefined || folderId === null || folderId === '' || folderId === '/'
        if (typeof group?.getFileList === 'function') {
            const result = await group.getFileList(isRoot ? '/' : folderId)
            return this.normalizeFileList(result, 'group.getFileList')
        }
        if (typeof group?.fs?.ls === 'function') {
            const result = isRoot ? await group.fs.ls() : await group.fs.ls(folderId)
            return this.normalizeFileList(result, 'group.fs.ls')
        }
        const action = isRoot ? 'get_group_root_files' : 'get_group_files_by_folder'
        const result = await this.api.callAction(
            action,
            {
                group_id: this.api.targetId(groupId),
                ...(!isRoot ? { folder_id: folderId } : {})
            },
            { strict: true }
        )
        return this.normalizeFileList(result, action)
    }

    /**
     * 获取群文件下载地址。
     * @param {string|number} groupId - 群 ID
     * @param {string} fileId - 文件 ID
     * @returns {Promise<string>} 下载地址
     */
    async getGroupFileUrl(groupId, fileId) {
        this.assertGroupFileSystemSupported()
        return await this.api.getFileUrl({ groupId, fileId })
    }

    /**
     * 上传群文件。
     * @param {Object} options - 上传参数
     * @returns {Promise<Object>} 标准发送结果
     */
    async uploadGroupFile({ groupId, file, name, folderId = '/' }) {
        if (!this.api.isQQBot) {
            const group = this.groupOrNull(groupId)
            if (typeof group?.fs?.upload === 'function') {
                const result = await group.fs.upload(file, folderId, name)
                this.api.assertResult(result, 'group.fs.upload')
                return { success: true, method: 'group.fs.upload', result }
            }
            if (folderId !== '/') {
                const result = await this.api.callAction(
                    'upload_group_file',
                    { group_id: this.api.targetId(groupId), file, name, folder: folderId },
                    { strict: true }
                )
                return { success: true, method: 'upload_group_file', result }
            }
        }
        try {
            return await this.api.sendFile({ groupId, file, name })
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        const result = await this.api.callAction(
            'upload_group_file',
            { group_id: this.api.targetId(groupId), file, name, folder: folderId },
            { strict: true }
        )
        return { success: true, method: 'upload_group_file', result }
    }

    /**
     * 上传私聊文件。
     * @param {Object} options - 上传参数
     * @returns {Promise<Object>} 标准发送结果
     */
    async uploadPrivateFile({ userId, file, name }) {
        try {
            return await this.api.sendFile({ userId, file, name })
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        const result = await this.api.callAction(
            'upload_private_file',
            { user_id: this.api.targetId(userId), file, name },
            { strict: true }
        )
        return { success: true, method: 'upload_private_file', result }
    }

    /**
     * 删除群文件。
     * @param {string|number} groupId - 群 ID
     * @param {string} fileId - 文件 ID
     * @returns {Promise<*>} 协议端结果
     */
    async deleteGroupFile(groupId, fileId) {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        if (typeof group?.deleteFile === 'function') return await this.api.callGroup(groupId, 'deleteFile', [fileId])
        if (typeof group?.fs?.rm === 'function') {
            return this.assertWriteResult(await group.fs.rm(fileId), 'group.fs.rm')
        }
        const result = await this.api.callAction(
            'delete_group_file',
            { group_id: this.api.targetId(groupId), file_id: fileId },
            { strict: true }
        )
        if (result === null || result === undefined) throw new Error('协议端未返回删除文件结果')
        return result
    }

    /** 创建群文件夹。 */
    async createGroupFolder(groupId, name, parentId = '/') {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        if (typeof group?.createFolder === 'function')
            return await this.api.callGroup(groupId, 'createFolder', [name, parentId])
        if (typeof group?.fs?.mkdir === 'function') {
            return this.assertWriteResult(await group.fs.mkdir(name), 'group.fs.mkdir')
        }
        const result = await this.api.callAction(
            'create_group_file_folder',
            { group_id: this.api.targetId(groupId), name, parent_id: parentId },
            { strict: true }
        )
        if (result === null || result === undefined) throw new Error('协议端未返回创建文件夹结果')
        return result
    }

    /** 获取群文件系统统计。 */
    async getGroupFileSystemInfo(groupId) {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        if (typeof group?.fs?.df === 'function') {
            const result = await group.fs.df()
            this.api.assertResult(result, 'group.fs.df')
            return result?.data ?? result
        }
        if (typeof group?.fs?.stat === 'function') {
            const result = await group.fs.stat()
            this.api.assertResult(result, 'group.fs.stat')
            return result?.data ?? result
        }
        const result = await this.api.callAction(
            'get_group_file_system_info',
            { group_id: this.api.targetId(groupId) },
            { strict: true }
        )
        return result?.data ?? result
    }

    /** 获取群根目录内容。 */
    async getGroupRootFiles(groupId) {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        if (typeof group?.getFileList === 'function') {
            return this.normalizeFileGroups(await group.getFileList('/'), 'group.getFileList')
        }
        if (typeof group?.fs?.ls === 'function') {
            return this.normalizeFileGroups(await group.fs.ls(), 'group.fs.ls')
        }
        const result = await this.api.callAction(
            'get_group_root_files',
            { group_id: this.api.targetId(groupId) },
            { strict: true }
        )
        return this.normalizeFileGroups(result, 'get_group_root_files')
    }

    /** 获取群子目录内容。 */
    async getGroupFolderFiles(groupId, folderId) {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        if (typeof group?.getFileList === 'function') {
            return this.normalizeFileGroups(await group.getFileList(folderId), 'group.getFileList')
        }
        if (typeof group?.fs?.ls === 'function') {
            return this.normalizeFileGroups(await group.fs.ls(folderId), 'group.fs.ls')
        }
        const result = await this.api.callAction(
            'get_group_files_by_folder',
            { group_id: this.api.targetId(groupId), folder_id: folderId },
            { strict: true }
        )
        return this.normalizeFileGroups(result, 'get_group_files_by_folder')
    }

    /** 移动群文件。 */
    async moveGroupFile(groupId, fileId, parentDirectory, targetDirectory) {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        if (typeof group?.fs?.mv === 'function') {
            return this.assertWriteResult(await group.fs.mv(fileId, parentDirectory, targetDirectory), 'group.fs.mv')
        }
        const result = await this.api.callAction(
            'move_group_file',
            {
                group_id: this.api.targetId(groupId),
                file_id: fileId,
                parent_directory: parentDirectory,
                target_directory: targetDirectory
            },
            { strict: true }
        )
        if (result === null || result === undefined) throw new Error('协议端未返回移动文件结果')
        return result
    }

    /** 重命名群文件。 */
    async renameGroupFile(groupId, fileId, newName) {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        if (typeof group?.fs?.rename === 'function') {
            return this.assertWriteResult(await group.fs.rename(fileId, newName), 'group.fs.rename')
        }
        const result = await this.api.callAction(
            'rename_group_file',
            { group_id: this.api.targetId(groupId), file_id: fileId, new_name: newName },
            { strict: true }
        )
        if (result === null || result === undefined) throw new Error('协议端未返回重命名文件结果')
        return result
    }

    /** 删除群文件夹。 */
    async deleteGroupFolder(groupId, folderId) {
        this.assertGroupFileSystemSupported()
        const group = this.groupOrNull(groupId)
        if (typeof group?.fs?.rmdir === 'function') {
            return this.assertWriteResult(await group.fs.rmdir(folderId), 'group.fs.rmdir')
        }
        const result = await this.api.callAction(
            'delete_group_folder',
            { group_id: this.api.targetId(groupId), folder_id: folderId },
            { strict: true }
        )
        if (result === null || result === undefined) throw new Error('协议端未返回删除文件夹结果')
        return result
    }

    /** 获取私聊文件下载地址。 */
    async getPrivateFileUrl(fileId) {
        return await this.api.getFileUrl({ fileId, userId: this.api.event?.user_id, scope: 'private' })
    }
}
