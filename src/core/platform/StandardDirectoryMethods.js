/**
 * @fileoverview Yunzai 标准资料、群成员、公告与互动能力。
 * @module core/platform/StandardDirectoryMethods
 */

import { hasStandardTarget as isProvided } from './StandardBotIdentity.js'
import { UnsupportedBotApiError } from './StandardBotResult.js'

function valuesOf(value) {
    if (value instanceof Map) return Array.from(value.values())
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') return Object.values(value)
    return []
}

function collectionSize(value) {
    if (value instanceof Map || value instanceof Set || Array.isArray(value)) return value.size ?? value.length
    if (value && typeof value === 'object') return Object.keys(value).length
    return 0
}

function readTargetEntry(value, id) {
    if (!value || !isProvided(id)) return undefined
    if (value instanceof Map) {
        if (value.has(id)) return value.get(id)
        const text = String(id)
        if (value.has(text)) return value.get(text)
        if (/^-?\d+$/.test(text)) {
            const numeric = Number(text)
            if (Number.isSafeInteger(numeric) && value.has(numeric)) return value.get(numeric)
        }
        return undefined
    }
    return value[id] ?? value[String(id)]
}

function hasProfileData(value) {
    return Boolean(
        value &&
        (value.nickname ||
            value.name ||
            value.card ||
            value.remark ||
            value.sex ||
            value.age !== undefined ||
            value.role ||
            value.member_role ||
            value.avatar)
    )
}

function hasGroupProfileData(value) {
    return Boolean(
        value &&
        (value.group_name ||
            value.name ||
            value.member_count !== undefined ||
            value.max_member_count !== undefined ||
            value.owner_id !== undefined ||
            value.avatar)
    )
}

export const StandardDirectoryMethods = {
    /**
     * 获取用户头像地址。QQBot OpenID 优先使用标准好友对象提供的地址。
     * @param {string|number} userId - 用户 ID
     * @param {number} [size] - 头像尺寸
     * @returns {string} 头像地址；协议端无法提供时为空字符串
     */
    userAvatarUrl(userId, size = 640) {
        const uid = this.targetId(userId)
        try {
            const friend = this.friend(uid)
            if (typeof friend.getAvatarUrl === 'function') return friend.getAvatarUrl(size) || ''
            if (friend.avatar) return friend.avatar
        } catch {}
        return /^\d+$/.test(String(uid)) ? `https://q1.qlogo.cn/g?b=qq&nk=${uid}&s=${size}` : ''
    },

    /**
     * 获取群头像地址。
     * @param {string|number} groupId - 群 ID
     * @param {number} [size] - 头像尺寸
     * @returns {string} 头像地址；OpenID 无公开头像地址时为空字符串
     */
    groupAvatarUrl(groupId, size = 640) {
        const gid = this.targetId(groupId)
        return /^\d+$/.test(String(gid)) ? `https://p.qlogo.cn/gh/${gid}/${gid}/${size}` : ''
    },

    /**
     * 获取 Bot 自身标准信息。
     * @returns {Object} Bot 信息
     */
    getBotInfo() {
        const selfId = this.bot?.uin || this.bot?.self_id || this.event?.self_id || ''
        return {
            user_id: selfId,
            nickname: this.bot?.nickname || this.bot?.info?.nickname || this.bot?.info?.username || '',
            sex: this.bot?.sex || this.bot?.info?.sex || 'unknown',
            age: this.bot?.age || this.bot?.info?.age,
            friend_count: collectionSize(this.bot?.fl),
            group_count: collectionSize(this.bot?.gl),
            avatar_url: this.userAvatarUrl(selfId),
            status: this.bot?.status ?? 'online',
            adapter: this.adapterType,
            adapter_id: this.adapterId,
            version: this.bot?.version || {}
        }
    },

    /**
     * 获取 Bot 运行状态；QQBot receiver 健康检查封装在协议边界内。
     * @returns {Promise<Object>} 标准状态
     */
    async getBotStatus() {
        const info = this.getBotInfo()
        if (this.isQQBot) {
            const health = await this.bot?.sdk?.receiver?.healthCheck?.()
            if (!health) throw new UnsupportedBotApiError('receiver.healthCheck')
            const online = health.status === 'healthy'
            return { ...info, online, good: online, health }
        }
        const online =
            typeof this.bot?.isOnline === 'function'
                ? this.bot.isOnline()
                : this.bot?.status !== undefined
                  ? this.bot.status === 11 || this.bot.status === 'online'
                  : true
        const status = { ...info, online, good: online, stat: this.bot?.stat || {} }
        const result = await this.callAction('get_status', {})
        const data = result?.data || result
        if (data) {
            status.good = data.good ?? status.good
            status.app_initialized = data.app_initialized ?? true
            status.app_enabled = data.app_enabled ?? true
            status.app_good = data.app_good ?? true
            if (data.stat) status.stat = { ...status.stat, ...data.stat }
        }
        return status
    },

    /**
     * 判断用户是否在标准好友列表中。
     * @param {string|number} userId - 用户 ID
     * @returns {Promise<Object>} 好友状态和资料
     */
    async getFriendState(userId) {
        const uid = this.targetId(userId)
        const friends = await this.getFriendList()
        const friend = friends.find(item => String(item.user_id ?? item.uid ?? item.id) === String(uid)) || null
        return { isFriend: Boolean(friend), friend }
    },

    /**
     * 给好友点赞，优先使用标准好友对象。
     * @param {string|number} userId - 用户 ID
     * @param {number} times - 次数
     * @returns {Promise<*>} 操作结果
     */
    async sendLike(userId, times) {
        try {
            return await this.callFriend(userId, 'thumbUp', [times])
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        return await this.callAction('send_like', { user_id: this.targetId(userId), times }, { strict: true })
    },

    /**
     * 获取账号域名凭据。
     * @param {string} domain - 精确域名
     * @returns {Promise<Object>} cookies、csrfToken 与账号 ID
     */
    async getCredentials(domain) {
        let cookies = ''
        if (this.bot?.cookies && typeof this.bot.cookies === 'object') cookies = this.bot.cookies[domain] || ''
        const attemptedGetCookies = !cookies && typeof this.bot?.getCookies === 'function'
        if (attemptedGetCookies) {
            const result = this.assertReadResult(await this.bot.getCookies(domain), 'bot.getCookies')
            const data = result?.data ?? result
            cookies = typeof data === 'string' ? data : data?.cookies || ''
        }
        if (!cookies) {
            const result = await this.callAction('get_cookies', { domain }, { skipDirect: attemptedGetCookies })
            cookies = result?.data?.cookies || result?.cookies || result?.data || result || ''
        }
        let directCsrfToken = this.bot?.bkn
        if (!directCsrfToken && typeof this.bot?.getCsrfToken === 'function') {
            const result = this.assertReadResult(await this.bot.getCsrfToken(), 'bot.getCsrfToken')
            const data = result?.data ?? result
            directCsrfToken = typeof data === 'object' ? (data?.csrf_token ?? data?.bkn) : data
        }
        const credentialResult = directCsrfToken ? null : await this.callAction('get_credentials', { domain })
        const credentialData = credentialResult?.data || credentialResult
        const csrfToken = directCsrfToken || credentialData?.csrf_token || credentialData?.bkn
        return {
            cookies,
            csrfToken,
            userId: String(this.bot?.uin || this.bot?.self_id || '')
        }
    },

    /**
     * 戳一戳用户。
     * @param {string|number} userId - 用户 ID
     * @returns {Promise<*>} 协议端结果
     */
    async pokeUser(userId) {
        try {
            return await this.callFriend(userId, 'poke')
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        return await this.callFirstAction(['friend_poke', 'send_friend_poke', 'send_poke'], {
            user_id: this.targetId(userId)
        })
    },

    /**
     * 戳一戳群成员。
     * @param {string|number} groupId - 群 ID
     * @param {string|number} userId - 用户 ID
     * @returns {Promise<*>} 协议端结果
     */
    async pokeMember(groupId, userId) {
        const uid = this.targetId(userId)
        try {
            return await this.callGroup(groupId, 'pokeMember', [uid])
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        return await this.callFirstAction(['group_poke', 'send_group_poke', 'send_poke'], {
            group_id: this.targetId(groupId),
            user_id: uid
        })
    },

    /**
     * 设置消息表情回应。
     * @param {Object} options - 回应参数
     * @returns {Promise<*>} 协议端结果
     */
    async setReaction({ messageId, emojiId, isSet = true, groupId, sequence, emojiType }) {
        const numericEmojiId = Number(emojiId)
        if (isProvided(groupId)) {
            try {
                const group = this.group(groupId)
                const resolvedEmojiType = emojiType || (numericEmojiId > 200 ? 2 : 1)
                const reactionSequence = this.historySequence(sequence ?? messageId, 0)
                if (isSet && typeof group.setReaction === 'function') {
                    const result = await group.setReaction(reactionSequence, numericEmojiId, resolvedEmojiType)
                    this.assertResult(result, 'group.setReaction')
                    return result
                }
                if (!isSet && typeof group.delReaction === 'function') {
                    const result = await group.delReaction(reactionSequence, numericEmojiId, resolvedEmojiType)
                    this.assertResult(result, 'group.delReaction')
                    return result
                }
                if (typeof group.sendReaction === 'function' && isSet) {
                    const result = await group.sendReaction(messageId, numericEmojiId)
                    this.assertResult(result, 'group.sendReaction')
                    return result
                }
            } catch (error) {
                if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
            }
        }
        return await this.callFirstAction(
            isSet
                ? ['set_msg_emoji_like', 'send_msg_emoji_like', 'set_message_emoji_like']
                : ['set_msg_emoji_like', 'set_message_emoji_like'],
            { message_id: messageId, emoji_id: emojiId, set: isSet }
        )
    },

    /**
     * 获取群信息。
     * @param {string|number} groupId - 群 ID
     * @param {boolean} [noCache] - 是否跳过缓存
     * @returns {Promise<Object>} 群信息
     */
    async getGroupInfo(groupId, noCache = false) {
        const gid = this.targetId(groupId)
        if (!noCache) {
            const cached = readTargetEntry(this.bot?.gl, gid)
            if (cached) return cached
        }
        try {
            const group = this.group(gid)
            if (typeof group.getInfo === 'function') {
                const result = this.assertReadResult(await group.getInfo(noCache, true), 'group.getInfo')
                if (result !== null) return result
            }
            if (group.info) {
                const result = this.assertReadResult(group.info, 'group.info')
                if (result !== null) return result
            }
            if (hasGroupProfileData(group)) return group
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        const result = await this.callAction('get_group_info', { group_id: gid, no_cache: noCache }, { strict: true })
        return result?.data || result
    },

    /** 获取群荣誉信息。 */
    async getGroupHonorInfo(groupId, type = 'all') {
        const result = await this.callGroupOrAction({
            groupId,
            method: 'getHonorInfo',
            args: [type],
            action: 'get_group_honor_info',
            params: { type }
        })
        return result?.data || result
    },

    /**
     * 获取群列表。
     * @returns {Promise<Array>} 群列表
     */
    async getGroupList() {
        const cached =
            this.bot?.gl instanceof Map
                ? Array.from(this.bot.gl, ([groupId, info]) => ({ group_id: groupId, ...(info || {}) }))
                : valuesOf(this.bot?.gl)
        if (cached.length) return cached
        if (typeof this.bot?.getGroupMap === 'function') {
            const result = this.assertReadResult(await this.bot.getGroupMap(), 'bot.getGroupMap')
            if (result !== null) return valuesOf(result)
        }
        const result = await this.callAction('get_group_list', {}, { strict: true })
        return Array.isArray(result) ? result : result?.data || []
    },

    /**
     * 获取好友列表。
     * @returns {Promise<Array>} 好友列表
     */
    async getFriendList() {
        const cached =
            this.bot?.fl instanceof Map
                ? Array.from(this.bot.fl, ([userId, info]) => ({ user_id: userId, ...(info || {}) }))
                : valuesOf(this.bot?.fl)
        if (cached.length) return cached
        if (typeof this.bot?.getFriendMap === 'function') {
            const result = this.assertReadResult(await this.bot.getFriendMap(), 'bot.getFriendMap')
            if (result !== null) return valuesOf(result)
        }
        const result = await this.callAction('get_friend_list', {}, { strict: true })
        return Array.isArray(result) ? result : result?.data || []
    },

    /**
     * 获取群成员列表。
     * @param {string|number} groupId - 群 ID
     * @returns {Promise<Array>} 成员列表
     */
    async getMemberList(groupId) {
        const gid = this.targetId(groupId)
        try {
            const group = this.group(gid)
            if (typeof group.getMemberMap === 'function') {
                const result = this.assertReadResult(await group.getMemberMap(), 'group.getMemberMap')
                if (result !== null) return valuesOf(result)
            }
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        const cached = readTargetEntry(this.bot?.gml, gid)
        const members = valuesOf(cached)
        if (members.length) return members
        const result = await this.callAction(
            'get_group_member_list',
            { group_id: gid, no_cache: false },
            { strict: true }
        )
        return Array.isArray(result) ? result : result?.data || []
    },

    /**
     * 获取群成员信息。
     * @param {string|number} groupId - 群 ID
     * @param {string|number} userId - 用户 ID
     * @returns {Promise<Object>} 成员信息
     */
    async getMemberInfo(groupId, userId) {
        const gid = this.targetId(groupId)
        const uid = this.targetId(userId)
        const cached = readTargetEntry(readTargetEntry(this.bot?.gml, gid), uid)
        if (cached) return cached
        try {
            const member = this.member(gid, uid)
            let info = member.info
            if (typeof member.getInfo === 'function') {
                const result = this.assertReadResult(await member.getInfo(), 'member.getInfo')
                if (result !== null) info = result
            }
            if (info !== undefined) info = this.assertReadResult(info, 'member.info')
            if (!info && hasProfileData(member)) info = member
            if (hasProfileData(info)) return info
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        const result = await this.callAction(
            'get_group_member_info',
            { group_id: gid, user_id: uid, no_cache: false },
            { strict: true }
        )
        return result?.data || result
    },

    /**
     * 获取群公告。
     * @param {string|number} groupId - 群 ID
     * @param {number} [index] - 公告序号
     * @returns {Promise<Array|Object>} 公告列表或指定公告
     */
    async getGroupNotices(groupId, index) {
        const gid = this.targetId(groupId)
        try {
            const group = this.group(gid)
            if (typeof group.getNoticeList === 'function') {
                const result = this.assertReadResult(await group.getNoticeList(index), 'group.getNoticeList')
                if (result !== null) return result
            }
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        const params = { group_id: gid, ...(index ? { index } : {}) }
        const internalResult = await this.callAction('_get_group_notice', params)
        const result = internalResult ?? (await this.callAction('get_group_notice', params))
        if (result === null || result === undefined) throw new UnsupportedBotApiError('getGroupNotices')
        const data = result?.data ?? result
        if (index && Array.isArray(data)) {
            const notice = data[index - 1]
            if (!notice) throw new Error(`未找到序号 ${index} 的公告`)
            return {
                text: notice.message?.text || notice.content || notice.text || '',
                fid: notice.notice_id || notice.fid
            }
        }
        return data
    },

    /**
     * 发送群公告。
     * @param {string|number} groupId - 群 ID
     * @param {string} content - 公告正文
     * @param {Object} [options] - 公告选项
     * @returns {Promise<*>} 协议端结果
     */
    async sendGroupNotice(groupId, content, options = {}) {
        try {
            return await this.callGroup(groupId, 'announce', [content, options])
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        return await this.callFirstAction(['_send_group_notice', 'send_group_notice'], {
            group_id: this.targetId(groupId),
            content,
            ...options
        })
    },

    /**
     * 删除群公告。
     * @param {string|number} groupId - 群 ID
     * @param {string|number} noticeId - 公告 ID 或序号
     * @returns {Promise<*>} 协议端结果
     */
    async deleteGroupNotice(groupId, noticeId) {
        let fid = noticeId
        let text = ''
        if (typeof noticeId === 'number' || /^\d+$/.test(String(noticeId))) {
            const index = Number(noticeId)
            if (index > 0 && index <= 100) {
                const notice = await this.getGroupNotices(groupId, index)
                fid = notice.fid
                text = notice.text || ''
            }
        }
        try {
            const result = await this.callGroup(groupId, 'deleteNotice', [fid])
            return result && typeof result === 'object' ? { ...result, text } : result
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        const result = await this.callFirstAction(['_del_group_notice', 'del_group_notice'], {
            group_id: this.targetId(groupId),
            notice_id: fid,
            fid
        })
        return result && typeof result === 'object' ? { ...result, text } : result
    },

    /**
     * 获取用户信息。
     * @param {string|number} userId - 用户 ID
     * @param {string|number} [groupId] - 群 ID
     * @returns {Promise<Object>} 用户信息
     */
    async getUserInfo(userId, groupId) {
        const uid = this.targetId(userId)
        if (isProvided(groupId)) return await this.getMemberInfo(groupId, uid)
        const cached = readTargetEntry(this.bot?.fl, uid)
        if (cached) return cached
        try {
            const friend = this.friend(uid)
            let info = friend.info
            if (typeof friend.getInfo === 'function') {
                const result = this.assertReadResult(await friend.getInfo(), 'friend.getInfo')
                if (result !== null) info = result
            }
            if (info !== undefined) info = this.assertReadResult(info, 'friend.info')
            if (!info && hasProfileData(friend)) info = friend
            if (hasProfileData(info)) return info
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        const result = await this.callAction('get_stranger_info', { user_id: uid, no_cache: false }, { strict: true })
        return result?.data || result
    }
}
