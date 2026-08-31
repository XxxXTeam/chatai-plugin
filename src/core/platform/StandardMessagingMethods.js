/**
 * @fileoverview Yunzai 标准消息发送、转发、撤回与历史能力。
 * @module core/platform/StandardMessagingMethods
 */

import {
    getGlobalBotContainer as getGlobalBot,
    hasStandardTarget as isProvided,
    isCurrentStandardTarget,
    resolveStandardTarget
} from './StandardBotIdentity.js'
import { extractStandardMessageId, UnsupportedBotApiError } from './StandardBotResult.js'
import {
    normalizeStandardMessage,
    serializeOneBotForwardNode,
    serializeOneBotMessage,
    StandardMessage
} from './StandardMessage.js'

export const StandardMessagingMethods = {
    /**
     * 发送消息到当前或显式目标。
     * @param {Object} options - 发送参数
     * @param {string|number} [options.groupId] - 群 ID
     * @param {string|number} [options.userId] - 用户 ID
     * @param {*} options.message - 消息内容
     * @param {boolean} [options.quote] - 是否引用当前消息
     * @returns {Promise<Object>} 标准发送结果
     */
    async send({ groupId, userId, message, quote = false, replyOptions }) {
        if (!this.bot && !this.event) throw new UnsupportedBotApiError('Bot')
        const { groupId: targetGroupId, userId: targetUserId } = resolveStandardTarget(
            this.event,
            { groupId, userId },
            false
        )
        const outboundMessage = ['onebot', 'napcat', 'go-cqhttp', 'lagrange'].includes(this.adapterType)
            ? serializeOneBotMessage(message)
            : message
        let result
        let method

        if (isCurrentStandardTarget(this.event, { groupId, userId })) {
            result = await this.event.reply(outboundMessage, quote, replyOptions)
            method = 'event.reply'
        } else if (isProvided(targetGroupId)) {
            try {
                const group = this.group(targetGroupId)
                if (typeof group.sendMsg !== 'function') throw new UnsupportedBotApiError('group.sendMsg')
                result = await group.sendMsg(outboundMessage)
                method = 'pickGroup.sendMsg'
            } catch (error) {
                if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
                result = await this.callAction(
                    'send_group_msg',
                    { group_id: this.targetId(targetGroupId), message: outboundMessage },
                    { strict: true }
                )
                method = 'send_group_msg'
            }
        } else if (isProvided(targetUserId)) {
            try {
                const friend = this.friend(targetUserId)
                if (typeof friend.sendMsg !== 'function') throw new UnsupportedBotApiError('friend.sendMsg')
                result = await friend.sendMsg(outboundMessage)
                method = 'pickFriend.sendMsg'
            } catch (error) {
                if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
                result = await this.callAction(
                    'send_private_msg',
                    { user_id: this.targetId(targetUserId), message: outboundMessage },
                    { strict: true }
                )
                method = 'send_private_msg'
            }
        } else {
            throw new Error('需要当前事件或显式 groupId/userId')
        }

        this.assertResult(result, method)
        return {
            success: true,
            message_id: extractStandardMessageId(result),
            method,
            result
        }
    },

    /**
     * 发送群消息。
     * @param {string|number} groupId - 群 ID
     * @param {*} message - 消息内容
     * @returns {Promise<Object>} 标准发送结果
     */
    sendGroup(groupId, message) {
        return this.send({ groupId, message })
    },

    /**
     * 发送私聊消息。
     * @param {string|number} userId - 用户 ID
     * @param {*} message - 消息内容
     * @returns {Promise<Object>} 标准发送结果
     */
    sendPrivate(userId, message) {
        return this.send({ userId, message })
    },

    /**
     * 通过群成员标准对象发送临时会话消息。
     * @param {string|number} groupId - 群 ID
     * @param {string|number} userId - 用户 ID
     * @param {*} message - 消息内容
     * @returns {Promise<Object>} 标准发送结果
     */
    async sendTemporary(groupId, userId, message) {
        const member = this.member(groupId, userId)
        if (typeof member.sendMsg !== 'function') throw new UnsupportedBotApiError('member.sendMsg')
        const outboundMessage = ['onebot', 'napcat', 'go-cqhttp', 'lagrange'].includes(this.adapterType)
            ? serializeOneBotMessage(message)
            : message
        const result = await member.sendMsg(outboundMessage)
        this.assertResult(result, 'member.sendMsg')
        return {
            success: true,
            message_id: extractStandardMessageId(result),
            method: 'member.sendMsg',
            result,
            group_id: this.targetId(groupId)
        }
    },

    /**
     * 发送私聊，标准私聊不可用时通过指定或自动发现的共同群发送临时会话。
     * @param {string|number} userId - 用户 ID
     * @param {*} message - 消息内容
     * @param {string|number} [groupId] - 共同群 ID
     * @returns {Promise<Object>} 标准发送结果
     */
    async sendPrivateWithGroupFallback(userId, message, groupId) {
        try {
            return await this.sendPrivate(userId, message)
        } catch (privateError) {
            if (privateError?.code !== 'UNSUPPORTED_BOT_API') throw privateError
            let targetGroupId = groupId
            if (!isProvided(targetGroupId)) {
                const groups = await this.getGroupList()
                for (const group of groups) {
                    const gid = group.group_id ?? group.id
                    try {
                        const members = await this.getMemberList(gid)
                        if (members.some(member => String(member.user_id ?? member.uid) === String(userId))) {
                            targetGroupId = gid
                            break
                        }
                    } catch {}
                }
            }
            if (!isProvided(targetGroupId)) throw privateError
            return await this.sendTemporary(targetGroupId, userId, message)
        }
    },

    /**
     * 回复当前事件。
     * @param {*} message - 消息内容
     * @param {boolean} [quote] - 是否引用
     * @returns {Promise<Object>} 标准发送结果
     */
    reply(message, quote = false, replyOptions) {
        return this.send({ message, quote, replyOptions })
    },

    /**
     * 发送文件。
     * @param {Object} options - 文件发送参数
     * @param {string|number} [options.groupId] - 群 ID
     * @param {string|number} [options.userId] - 用户 ID
     * @param {*} options.file - 文件引用
     * @param {string} [options.name] - 文件名
     * @returns {Promise<Object>} 标准发送结果
     */
    async sendFile({ groupId, userId, file, name }) {
        const { groupId: targetGroupId, userId: targetUserId } = resolveStandardTarget(this.event, {
            groupId,
            userId
        })

        if (this.isQQBot && isCurrentStandardTarget(this.event, { groupId, userId })) {
            return this.send({ groupId, userId, message: StandardMessage.file(file, name) })
        }

        let target = null
        try {
            target = isProvided(targetGroupId) ? this.group(targetGroupId) : this.friend(targetUserId)
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        if (typeof target?.sendFile === 'function') {
            const result =
                isProvided(targetGroupId) && this.adapterType === 'icqq'
                    ? await target.sendFile(file, '/', name)
                    : await target.sendFile(file, name)
            this.assertResult(result, 'sendFile')
            return {
                success: true,
                message_id: extractStandardMessageId(result),
                method: isProvided(targetGroupId) ? 'group.sendFile' : 'friend.sendFile',
                result
            }
        }
        if (typeof target?.sendMsg === 'function') {
            return this.send({ groupId, userId, message: StandardMessage.file(file, name) })
        }
        const action = isProvided(targetGroupId) ? 'upload_group_file' : 'upload_private_file'
        const result = await this.callAction(
            action,
            isProvided(targetGroupId)
                ? { group_id: this.targetId(targetGroupId), file, name, folder: '/' }
                : { user_id: this.targetId(targetUserId), file, name },
            { strict: true }
        )
        return {
            success: true,
            message_id: extractStandardMessageId(result),
            method: action,
            result
        }
    },

    /**
     * 发送合并转发。
     * @param {Object} options - 转发参数
     * @param {string|number} [options.groupId] - 群 ID
     * @param {string|number} [options.userId] - 用户 ID
     * @param {Array} options.nodes - 标准转发节点
     * @param {Object} [options.display] - 外显字段
     * @returns {Promise<Object>} 标准发送结果
     */
    async sendForward({ groupId, userId, nodes, display = {} }) {
        if (!Array.isArray(nodes) || nodes.length === 0) throw new Error('转发节点不能为空')
        const normalizedNodes = nodes.map(node => ({
            ...node,
            message: normalizeStandardMessage(node.message ?? node.content ?? '')
        }))
        const targetNodes = ['onebot', 'napcat', 'go-cqhttp', 'lagrange'].includes(this.adapterType)
            ? normalizedNodes.map(node => ({ ...node, message: serializeOneBotMessage(node.message) }))
            : normalizedNodes
        const hasDisplay = Object.values(display).some(value => value !== undefined && value !== null && value !== '')

        const { groupId: targetGroupId, userId: targetUserId } = resolveStandardTarget(this.event, {
            groupId,
            userId
        })
        let target = null
        try {
            target = isProvided(targetGroupId)
                ? this.group(targetGroupId)
                : isProvided(targetUserId)
                  ? this.friend(targetUserId)
                  : null
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }

        if (typeof target?.sendForwardMsg === 'function' && !hasDisplay) {
            const result = await target.sendForwardMsg(targetNodes)
            if (Array.isArray(result) && result.length === 0) {
                throw new Error('sendForwardMsg失败: 协议端未返回任何发送结果')
            }
            this.assertResult(result, 'sendForwardMsg')
            return {
                success: true,
                message_id: extractStandardMessageId(result),
                method: 'target.sendForwardMsg',
                result
            }
        }

        if (
            !target ||
            (this.supportsCapability('onebot_action') && (hasDisplay || typeof target.sendForwardMsg !== 'function'))
        ) {
            const action = isProvided(targetGroupId) ? 'send_group_forward_msg' : 'send_private_forward_msg'
            const oneBotNodes = normalizedNodes.map(serializeOneBotForwardNode)
            const result = await this.callAction(
                action,
                isProvided(targetGroupId)
                    ? { group_id: this.targetId(targetGroupId), messages: oneBotNodes, ...display }
                    : { user_id: this.targetId(targetUserId), messages: oneBotNodes, ...display },
                { strict: true }
            )
            return {
                success: true,
                message_id: extractStandardMessageId(result),
                method: action,
                result
            }
        }

        const makeForwardMsg = target?.makeForwardMsg || getGlobalBot()?.makeForwardMsg
        const forward =
            typeof makeForwardMsg === 'function'
                ? await makeForwardMsg.call(target || getGlobalBot(), targetNodes)
                : StandardMessage.node(targetNodes)
        if (forward && typeof forward === 'object') Object.assign(forward, display)
        return this.send({ groupId, userId, message: forward })
    },

    /**
     * 撤回消息。
     * @param {Object} options - 撤回参数
     * @param {string|number} options.messageId - 消息 ID
     * @param {string|number} [options.groupId] - 群 ID
     * @param {string|number} [options.userId] - 用户 ID
     * @returns {Promise<*>} 协议端结果
     */
    async recall({ messageId, groupId, userId }) {
        const { groupId: targetGroupId, userId: targetUserId } = resolveStandardTarget(
            this.event,
            { groupId, userId },
            false
        )
        let target = null
        try {
            target = isProvided(targetGroupId)
                ? this.group(targetGroupId)
                : isProvided(targetUserId)
                  ? this.friend(targetUserId)
                  : null
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        if (typeof target?.recallMsg === 'function') {
            const result = await target.recallMsg(messageId)
            this.assertResult(result, 'recallMsg')
            return result
        }
        return await this.callAction('delete_msg', { message_id: messageId }, { strict: true })
    },

    /**
     * 获取消息。
     * @param {string|number} messageId - 消息 ID
     * @param {Object} [options] - 目标参数
     * @returns {Promise<*>} 消息记录
     */
    async getMessage(messageId, options = {}) {
        const { groupId: targetGroupId, userId: targetUserId } = resolveStandardTarget(this.event, options, false)
        const attemptedBotGetMsg = typeof this.bot?.getMsg === 'function'
        if (attemptedBotGetMsg) {
            const result = await this.bot.getMsg(messageId)
            const checked = this.assertReadResult(result, 'bot.getMsg')
            if (checked !== null) return checked
        }
        let target = null
        try {
            target = isProvided(targetGroupId)
                ? this.group(targetGroupId)
                : isProvided(targetUserId)
                  ? this.friend(targetUserId)
                  : null
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        if (typeof target?.getMsg === 'function') {
            const result = this.assertReadResult(await target.getMsg(messageId), 'target.getMsg')
            if (result !== null) return result
        }
        const result = await this.callAction(
            'get_msg',
            { message_id: messageId },
            { strict: true, skipDirect: attemptedBotGetMsg }
        )
        return result?.data ?? result
    },

    /**
     * 获取合并转发内容并统一为消息数组。
     * @param {string} id - 转发资源 ID
     * @param {Object} [options] - 查询目标
     * @returns {Promise<Array>} 转发消息数组
     */
    async getForwardMessage(id, options = {}) {
        const { groupId: targetGroupId, userId: targetUserId } = resolveStandardTarget(this.event, options, false)
        if (isProvided(targetGroupId) || isProvided(targetUserId)) {
            try {
                const target = isProvided(targetGroupId) ? this.group(targetGroupId) : this.friend(targetUserId)
                if (typeof target?.getForwardMsg === 'function') {
                    const result = this.assertReadResult(await target.getForwardMsg(id), 'target.getForwardMsg')
                    if (result === null) throw new UnsupportedBotApiError('target.getForwardMsg')
                    const data = result?.data || result
                    return Array.isArray(data) ? data : data?.messages || data?.message || []
                }
            } catch (error) {
                if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
            }
        }
        const result = await this.callAction('get_forward_msg', { id }, { strict: true })
        const data = result?.data || result
        return Array.isArray(data) ? data : data?.messages || data?.message || []
    },

    /**
     * 获取图片文件信息。
     * @param {Object} options - file_id 或 file
     * @returns {Promise<Object>} 图片信息
     */
    async getImage(options = {}) {
        const result = await this.callAction(
            'get_image',
            { file_id: options.fileId ?? options.file_id, file: options.file },
            { strict: true }
        )
        return result?.data || result
    },

    /**
     * 获取当前事件引用的消息。
     * @returns {Promise<Object|null>} 引用消息
     */
    async getReplyMessage() {
        if (!this.event) return null
        if (typeof this.event.getReply === 'function') {
            const result = this.assertReadResult(await this.event.getReply(), 'event.getReply')
            if (result !== null) return result
        }
        const source = this.event.source
        const messageId = source?.message_id || source?.id || this.event.reply_id
        if (messageId) {
            return await this.getMessage(messageId, {
                ...(isProvided(this.event.group_id) ? { groupId: this.event.group_id } : { userId: this.event.user_id })
            })
        }
        if (source?.seq && this.event.group_id) {
            const history = await this.getHistory({
                groupId: this.event.group_id,
                sequence: source.seq,
                count: 1
            })
            return history.find(item => this.sameHistorySequence(item.seq, source.seq)) || history[0] || null
        }
        return null
    },

    /**
     * 获取群聊或私聊文件 URL。
     * @param {Object} options - 文件目标
     * @param {'private'} [options.scope] - 无事件目标时显式指定私聊文件动作
     * @returns {Promise<string>} 文件 URL
     */
    async getFileUrl({ fileId, groupId, userId, scope }) {
        if (scope !== undefined && scope !== 'private') throw new Error(`不支持的文件目标范围: ${scope}`)
        if (scope === 'private' && isProvided(groupId)) throw new Error('private 文件范围不能提供 groupId')
        const { groupId: targetGroupId, userId: targetUserId } = resolveStandardTarget(
            this.event,
            { groupId, userId },
            scope !== 'private'
        )
        let target = null
        try {
            target = isProvided(targetGroupId)
                ? this.group(targetGroupId)
                : isProvided(targetUserId)
                  ? this.friend(targetUserId)
                  : null
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        if (typeof target?.getFileUrl === 'function') {
            const result = await target.getFileUrl(fileId)
            this.assertResult(result, 'target.getFileUrl')
            const url = result?.url || result
            if (typeof url === 'string' && url.trim()) return url
        }
        if (isProvided(targetGroupId) && typeof target?.fs?.download === 'function') {
            const result = await target.fs.download(fileId)
            this.assertResult(result, 'group.fs.download')
            const url = result?.url || result
            if (typeof url === 'string' && url.trim()) return url
        }
        const action = isProvided(targetGroupId) ? 'get_group_file_url' : 'get_private_file_url'
        const result = await this.callAction(
            action,
            isProvided(targetGroupId)
                ? { group_id: this.targetId(targetGroupId), file_id: fileId }
                : {
                      ...(isProvided(targetUserId) ? { user_id: this.targetId(targetUserId) } : {}),
                      file_id: fileId
                  },
            { strict: true }
        )
        const url = result?.data?.url || result?.url
        if (typeof url !== 'string' || !url.trim()) throw new Error(`${action} 未返回有效文件 URL`)
        return url
    },

    /**
     * 获取聊天记录。
     * @param {Object} options - 查询参数
     * @param {string|number} [options.groupId] - 群 ID
     * @param {string|number} [options.userId] - 用户 ID
     * @param {string|number} [options.sequence] - 起始序号/消息 ID
     * @param {number} [options.count] - 数量
     * @returns {Promise<Array>} 消息列表
     */
    async getHistory({ groupId, userId, sequence, count = 20 } = {}) {
        const { groupId: targetGroupId, userId: targetUserId } = resolveStandardTarget(this.event, {
            groupId,
            userId
        })
        // QQBot 群对象只按当前事件的 message_id 查询本地缓存；0 不是有效的缓存键。
        const eventSequence = this.event?.seq ?? this.event?.message_seq ?? this.event?.message_id
        const rawSequence =
            this.isQQBot &&
            isProvided(targetGroupId) &&
            (sequence === undefined || sequence === null || sequence === '' || sequence === 0 || sequence === '0')
                ? eventSequence
                : sequence
        const normalizedSequence = this.historySequence(rawSequence, 0)
        const missingQQBotSequence =
            normalizedSequence === undefined ||
            normalizedSequence === null ||
            normalizedSequence === '' ||
            normalizedSequence === 0 ||
            normalizedSequence === '0'
        if (this.isQQBot && isProvided(targetGroupId) && missingQQBotSequence) {
            throw new UnsupportedBotApiError('getChatHistory', 'QQBot 需要明确的 message_id')
        }
        let target = null
        try {
            target = isProvided(targetGroupId)
                ? this.group(targetGroupId)
                : isProvided(targetUserId)
                  ? this.friend(targetUserId)
                  : null
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        if (typeof target?.getChatHistory === 'function') {
            const result = this.assertReadResult(
                await target.getChatHistory(normalizedSequence, count),
                'target.getChatHistory'
            )
            if (result === null) return []
            return Array.isArray(result) ? result : result?.messages || []
        }
        const action = isProvided(targetGroupId) ? 'get_group_msg_history' : 'get_private_msg_history'
        const params = isProvided(targetGroupId)
            ? { group_id: this.targetId(targetGroupId), message_seq: normalizedSequence, count }
            : { user_id: this.targetId(targetUserId), message_seq: normalizedSequence, count }
        const result = await this.callAction(action, params, { strict: true })
        return Array.isArray(result) ? result : result?.messages || result?.data?.messages || []
    }
}
