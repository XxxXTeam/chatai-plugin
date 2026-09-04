/**
 * @fileoverview Yunzai 标准 Bot/事件接口边界。
 * @module core/platform/StandardBotApi
 *
 * 业务工具只能依赖本模块。QQBot、ICQQ 与 OneBot 的能力差异、目标 ID 类型、
 * 低层 API 回退和发送结果校验均在这里处理。
 */

import {
    detectStandardAdapter,
    getGlobalBotContainer,
    hasStandardTarget,
    matchesCurrentStandardTarget,
    preserveTargetId
} from './StandardBotIdentity.js'
import { getStandardResultError, UnsupportedBotApiError } from './StandardBotResult.js'
import { StandardDirectoryMethods } from './StandardDirectoryMethods.js'
import { StandardMessagingMethods } from './StandardMessagingMethods.js'
import { serializeOneBotMessage } from './StandardMessage.js'

const getGlobalBot = getGlobalBotContainer
const isProvided = hasStandardTarget

/**
 * Yunzai 标准 Bot API。
 */
export class StandardBotApi {
    /**
     * @param {Object} options - 构造参数
     * @param {Object} [options.bot] - Bot 实例
     * @param {Object} [options.event] - Yunzai 事件
     * @param {Object} [options.adapter] - 上下文适配器元数据
     */
    constructor({ bot, event, adapter } = {}) {
        this.event = event || null
        this.bot = bot || event?.bot || getGlobalBot()
        this.adapter = adapter || null
        this.prepareEvent()
        if (!this.bot && this.event?.bot) this.bot = this.event.bot
    }

    /**
     * 从 MCP 工具上下文构造标准接口。
     * @param {Object} ctx - 工具上下文
     * @returns {StandardBotApi} 标准接口
     */
    static fromContext(ctx) {
        const event = ctx?.getEvent?.() || ctx?.event || null
        return new StandardBotApi({
            bot: ctx?.getBot?.() || ctx?.bot || event?.bot,
            event,
            adapter: ctx?.getAdapter?.() || ctx?.adapter
        })
    }

    /**
     * 让 Yunzai 补齐 event.group/friend/member/reply 等标准能力。
     * @returns {Object|null} 当前事件
     */
    prepareEvent() {
        if (!this.event) return null
        const container = getGlobalBot()
        if (typeof container?.prepareEvent === 'function') container.prepareEvent(this.event)
        return this.event
    }

    /**
     * 返回原始适配器标识，不做模糊匹配。
     * @returns {string} 适配器标识
     */
    get adapterId() {
        return (
            this.bot?.adapter?.name ||
            this.bot?.adapter?.id ||
            this.bot?.version?.name ||
            this.bot?.version?.id ||
            this.adapter?.adapter ||
            'unknown'
        )
    }

    /**
     * 当前 Bot 是否为 QQBot。
     * @returns {boolean} 是否为 QQBot
     */
    get isQQBot() {
        return this.adapterType === 'qqbot'
    }

    /** @returns {string} 规范化适配器类别 */
    get adapterType() {
        const declared = typeof this.adapter === 'string' ? this.adapter : this.adapter?.adapter
        if (['qqbot', 'icqq', 'napcat', 'onebot', 'go-cqhttp', 'lagrange', 'standard'].includes(declared)) {
            return declared
        }
        return detectStandardAdapter(this.bot)
    }

    /**
     * 标准化目标 ID。
     * @param {string|number} id - 原始 ID
     * @returns {string|number|null|undefined} 标准 ID
     */
    targetId(id) {
        if (this.isQQBot && id !== null && id !== undefined && id !== '') return String(id)
        return preserveTargetId(this.bot, id)
    }

    /**
     * 归一化历史查询序号。
     * QQBot 没有可分页的数字 seq，适配器以 message_id 作为本地缓存键，必须保留
     * 原始字符串；其它协议沿用数字 message_seq/seq 约定。
     * @param {string|number|null|undefined} value - 原始序号
     * @param {string|number|null|undefined} fallback - 缺省序号
     * @returns {string|number|null|undefined} 适配器可接受的序号
     */
    historySequence(value, fallback = 0) {
        const raw = value === undefined || value === null || value === '' ? fallback : value
        if (this.isQQBot) {
            // 保留缺省哨兵（通常为 0），让调用方可以明确拒绝没有 message_id 的查询；
            // 只有真实传入的 QQBot 消息标识才转换为字符串。
            if (value === undefined || value === null || value === '') return raw
            return String(raw)
        }
        if (typeof raw === 'number') return Number.isFinite(raw) ? raw : fallback
        const numeric = Number(raw)
        return Number.isFinite(numeric) ? numeric : fallback
    }

    /**
     * 比较两个历史序号。
     * @param {string|number|null|undefined} left - 左侧序号
     * @param {string|number|null|undefined} right - 右侧序号
     * @returns {boolean} 是否指向同一条消息
     */
    sameHistorySequence(left, right) {
        if (
            left === undefined ||
            left === null ||
            left === '' ||
            right === undefined ||
            right === null ||
            right === ''
        ) {
            return false
        }
        if (this.isQQBot) return String(left) === String(right)
        const leftNumber = Number(left)
        const rightNumber = Number(right)
        return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
            ? leftNumber === rightNumber
            : String(left) === String(right)
    }

    /**
     * 获取标准群对象。
     * @param {string|number} groupId - 群 ID
     * @returns {Object} 群对象
     */
    group(groupId) {
        const id = this.targetId(groupId)
        if (matchesCurrentStandardTarget(this.event, { groupId: id }) && this.event?.group) return this.event.group
        if (typeof this.bot?.pickGroup !== 'function') throw new UnsupportedBotApiError('pickGroup')
        const group = this.bot.pickGroup(id)
        if (!group) throw new UnsupportedBotApiError('pickGroup', `无法取得群 ${id}`)
        return group
    }

    /**
     * 获取标准好友对象。
     * @param {string|number} userId - 用户 ID
     * @returns {Object} 好友对象
     */
    friend(userId) {
        const id = this.targetId(userId)
        if (matchesCurrentStandardTarget(this.event, { userId: id }) && this.event?.friend) return this.event.friend
        const picker = this.bot?.pickFriend || this.bot?.pickUser
        if (typeof picker !== 'function') throw new UnsupportedBotApiError('pickFriend')
        const friend = picker.call(this.bot, id)
        if (!friend) throw new UnsupportedBotApiError('pickFriend', `无法取得用户 ${id}`)
        return friend
    }

    /**
     * 获取标准群成员对象。
     * @param {string|number} groupId - 群 ID
     * @param {string|number} userId - 用户 ID
     * @returns {Object} 成员对象
     */
    member(groupId, userId) {
        const gid = this.targetId(groupId)
        const uid = this.targetId(userId)
        if (
            matchesCurrentStandardTarget(this.event, { groupId: gid }) &&
            String(this.event?.user_id) === String(uid) &&
            this.event?.member
        ) {
            return this.event.member
        }
        const group = this.group(gid)
        if (typeof group.pickMember !== 'function') throw new UnsupportedBotApiError('pickMember')
        const member = group.pickMember(uid)
        if (!member) throw new UnsupportedBotApiError('pickMember', `无法取得成员 ${uid}`)
        return member
    }

    /**
     * 校验协议端业务结果。
     * @param {*} result - 协议端结果
     * @param {string} action - 动作名
     * @returns {*} 原始结果
     */
    assertResult(result, action) {
        const businessError = getStandardResultError(result)
        if (businessError) throw new Error(`${action}失败: ${businessError}`)
        return result
    }

    /**
     * 校验读取结果；false/null/undefined 表示未命中，空数组是合法空列表。
     * @param {*} result - 读取结果
     * @param {string} action - 动作名
     * @returns {*} 原始结果或 null
     */
    assertReadResult(result, action) {
        if (result === false || result === null || result === undefined) return null
        this.assertResult(result, action)
        return result
    }

    /**
     * 调用标准群对象方法，不在业务工具中重复协议分支。
     * @param {string|number} groupId - 群 ID
     * @param {string} method - 精确方法名
     * @param {Array} [args] - 参数
     * @returns {Promise<*>} 调用结果
     */
    async callGroup(groupId, method, args = []) {
        const group = this.group(groupId)
        const variants = [{ name: method, args }]
        if (method === 'setAdmin') {
            variants.push({ name: 'setGroupAdmin', args })
        } else if (method === 'setTitle') {
            variants.push({ name: 'setGroupSpecialTitle', args })
        } else if (method === 'announce') {
            variants.push({ name: 'sendNotice', args: [args[0], args[1]?.image] })
        }

        for (const variant of variants) {
            if (typeof group?.[variant.name] !== 'function') continue
            const result = await group[variant.name](...variant.args)
            this.assertResult(result, `group.${variant.name}`)
            return result
        }
        if (method === 'pokeMember' && typeof group?.pickMember === 'function') {
            const member = group.pickMember(args[0])
            if (typeof member?.poke === 'function') {
                const result = await member.poke()
                this.assertResult(result, 'member.poke')
                return result
            }
        }
        throw new UnsupportedBotApiError(`group.${method}`)
    }

    /**
     * 按已验证的 Yunzai 适配器签名踢出群成员。
     * @param {string|number} groupId - 群 ID
     * @param {string|number} userId - 用户 ID
     * @param {boolean} rejectAdd - 是否拒绝再次申请
     * @param {string} [message] - ICQQ 踢出提示
     * @returns {Promise<*>} 操作结果
     */
    async kickMember(groupId, userId, rejectAdd = false, message = '') {
        const uid = this.targetId(userId)
        try {
            const group = this.group(groupId)
            if (typeof group?.kickMember === 'function') {
                const result =
                    this.adapterType === 'icqq'
                        ? await group.kickMember(uid, message, rejectAdd)
                        : await group.kickMember(uid, rejectAdd)
                this.assertResult(result, 'group.kickMember')
                return result
            }
            for (const name of ['setGroupKick', 'setGroupKickBan']) {
                if (typeof group?.[name] !== 'function') continue
                const result = await group[name](uid, rejectAdd)
                this.assertResult(result, `group.${name}`)
                return result
            }
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        return await this.callAction(
            'set_group_kick',
            {
                group_id: this.targetId(groupId),
                user_id: uid,
                reject_add_request: rejectAdd,
                message
            },
            { strict: true }
        )
    }

    /**
     * 优先调用 Yunzai 标准群对象方法，不支持时回退到集中式协议动作。
     * @param {Object} options - 调用参数
     * @param {string|number} options.groupId - 群 ID
     * @param {string} options.method - 标准群对象方法
     * @param {Array} [options.args] - 标准方法参数
     * @param {string} options.action - 低层动作名
     * @param {Object} [options.params] - 低层动作参数
     * @returns {Promise<*>} 调用结果
     */
    async callGroupOrAction({ groupId, method, args = [], action, params = {} }) {
        try {
            return await this.callGroup(groupId, method, args)
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        return await this.callAction(action, { ...params, group_id: this.targetId(groupId) }, { strict: true })
    }

    /**
     * 调用标准好友对象方法。
     * @param {string|number} userId - 用户 ID
     * @param {string} method - 精确方法名
     * @param {Array} [args] - 参数
     * @returns {Promise<*>} 调用结果
     */
    async callFriend(userId, method, args = []) {
        const friend = this.friend(userId)
        if (typeof friend?.[method] !== 'function') throw new UnsupportedBotApiError(`friend.${method}`)
        const result = await friend[method](...args)
        this.assertResult(result, `friend.${method}`)
        return result
    }

    /**
     * 优先调用 Yunzai 标准好友对象方法，不支持时回退到集中式协议动作。
     * @param {Object} options - 调用参数
     * @param {string|number} options.userId - 用户 ID
     * @param {string} options.method - 标准好友对象方法
     * @param {Array} [options.args] - 标准方法参数
     * @param {string} options.action - 低层动作名
     * @param {Object} [options.params] - 低层动作参数
     * @returns {Promise<*>} 调用结果
     */
    async callFriendOrAction({ userId, method, args = [], action, params = {} }) {
        try {
            return await this.callFriend(userId, method, args)
        } catch (error) {
            if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
        }
        return await this.callAction(action, { ...params, user_id: this.targetId(userId) }, { strict: true })
    }

    /**
     * 断言低层能力存在。仅明确标记为协议专属的工具可调用。
     * @param {string} capability - 能力名
     * @returns {StandardBotApi} 当前实例
     */
    supportsCapability(capability) {
        const checks = {
            onebot_action: () => typeof this.bot?.sendApi === 'function',
            raw_packet: () =>
                typeof this.bot?.sendOidbSvcTrpcTcp === 'function' ||
                typeof this.bot?.sendPacket === 'function' ||
                typeof this.bot?.sendUni === 'function' ||
                typeof this.bot?.sendOidb === 'function' ||
                typeof this.bot?.writeUni === 'function' ||
                typeof this.bot?.sendMergeUni === 'function',
            protobuf: () => typeof this.bot?.sendOidb === 'function' || typeof this.bot?.sendUni === 'function',
            group_file_system: () => !this.isQQBot && Boolean(this.event?.group?.fs),
            qq_web: () => Boolean(this.bot?.cookies || this.bot?.getCookies || this.bot?.sendApi),
            ai_voice: () =>
                this.adapterType === 'napcat' ||
                typeof this.bot?.sendOidbSvcTrpcTcp === 'function' ||
                typeof this.bot?.sendGroupAiRecord === 'function'
        }
        const check = checks[capability]
        if (!check) throw new Error(`未注册的协议能力: ${capability}`)
        return check()
    }

    /**
     * 断言低层能力存在。
     * @param {string} capability - 能力名
     * @returns {StandardBotApi} 当前实例
     */
    requireCapability(capability) {
        if (!this.supportsCapability(capability)) throw new UnsupportedBotApiError(capability)
        return this
    }

    /**
     * 按显式顺序调用一组等价动作。
     * @param {Array<string>} actions - 精确动作名列表
     * @param {Object} params - 动作参数
     * @returns {Promise<*>} 首个成功结果
     */
    async callFirstAction(actions, params = {}) {
        for (const action of actions) {
            try {
                return await this.callAction(action, params, { strict: true })
            } catch (error) {
                if (error?.code !== 'UNSUPPORTED_BOT_API') throw error
            }
        }
        throw new UnsupportedBotApiError(actions.join(' / '))
    }

    /**
     * 调用精确的 OneBot/icqq 动作；所有低层回退只允许存在于此处。
     * @param {string} action - 精确动作名
     * @param {Object} [params] - 动作参数
     * @param {Object} [options] - 调用选项
     * @param {boolean} [options.strict] - 不支持或失败时是否抛错
     * @param {boolean} [options.skipDirect] - 调用方已尝试同一标准方法时跳过重复 direct 阶段
     * @returns {Promise<*>} 协议端结果
     */
    async callAction(action, params = {}, { strict = false, skipDirect = false } = {}) {
        if (!this.bot) {
            if (strict) throw new UnsupportedBotApiError(action, 'Bot 实例不可用')
            return null
        }

        const gid = this.targetId(params.group_id)
        const uid = this.targetId(params.user_id)
        const directActions = {
            send_private_msg: ['sendPrivateMsg', [uid, params.message, params.source]],
            send_group_msg: ['sendGroupMsg', [gid, params.message, params.source]],
            get_stranger_info: ['getStrangerInfo', [uid, params.no_cache]],
            get_group_info: ['getGroupInfo', [gid, params.no_cache]],
            get_group_member_info: ['getGroupMemberInfo', [gid, uid, params.no_cache]],
            get_group_member_list: ['getGroupMemberList', [gid, params.no_cache]],
            get_group_honor_info: ['getGroupHonorInfo', [gid, params.type]],
            get_msg: ['getMsg', [params.message_id]],
            get_forward_msg: ['getForwardMsg', [params.id]],
            get_record: ['getRecord', [params.file, params.out_format]],
            get_image: ['getImage', [params.file_id || params.file]],
            ocr_image: ['imageOcr', [params.image]],
            delete_msg: ['deleteMsg', [params.message_id]],
            mark_msg_as_read: ['markMsgAsRead', [params.message_id]],
            set_essence_msg: ['setEssenceMsg', [params.message_id]],
            delete_essence_msg: ['deleteEssenceMsg', [params.message_id]],
            send_like: ['sendLike', [uid, params.times]],
            set_qq_avatar: ['setAvatar', [params.file]],
            set_group_ban: ['setGroupBan', [gid, uid, params.duration]],
            set_group_kick: ['setGroupKick', [gid, uid, params.reject_add_request, params.message]],
            set_group_card: ['setGroupCard', [gid, uid, params.card]],
            set_group_whole_ban: ['setGroupWholeBan', [gid, params.enable]],
            set_group_admin: ['setGroupAdmin', [gid, uid, params.enable]],
            set_group_name: ['setGroupName', [gid, params.group_name]],
            set_group_special_title: ['setGroupSpecialTitle', [gid, uid, params.special_title, params.duration]],
            send_group_poke: ['sendGroupPoke', [gid, uid]],
            group_poke: ['sendGroupPoke', [gid, uid]],
            get_cookies: ['getCookies', [params.domain]],
            set_self_longnick: ['setSignature', [params.long_nick]],
            set_group_add_request: ['setGroupAddRequest', [params.flag, params.approve, params.reason]],
            set_friend_add_request: ['setFriendAddRequest', [params.flag, params.approve, params.remark]],
            set_group_ai_record: ['setGroupAiRecord', [gid, params.enable, params.character]],
            get_ai_characters: ['getAiCharacters', [gid]],
            send_group_ai_record: ['sendGroupAiRecord', [gid, params.text, params.character]]
        }
        const directAliases = {
            set_essence_msg: [
                ['setEssenceMessage', [params.message_id]],
                ['setEssenceMsg', [params.message_id]]
            ],
            delete_essence_msg: [
                ['removeEssenceMessage', [params.message_id]],
                ['deleteEssenceMsg', [params.message_id]]
            ]
        }
        const settleMatched = value => {
            const businessError = getStandardResultError(value)
            if (!businessError) return value
            if (strict) throw new Error(`${action}失败: ${businessError}`)
            return null
        }

        const direct =
            directAliases[action]?.find(([method]) => typeof this.bot[method] === 'function') || directActions[action]
        if (!skipDirect && direct && typeof this.bot[direct[0]] === 'function') {
            try {
                return settleMatched(await this.bot[direct[0]](...direct[1]))
            } catch (error) {
                if (strict && error?.code === 'UNSUPPORTED_BOT_API') throw error
                if (strict) throw new Error(`${action} 调用失败 (${direct[0]}): ${error.message}`)
                return null
            }
        }

        const actionParams = {
            ...params,
            ...(isProvided(params.group_id) ? { group_id: gid } : {}),
            ...(isProvided(params.user_id) ? { user_id: uid } : {}),
            ...((action === 'send_group_msg' || action === 'send_private_msg') && params.message !== undefined
                ? { message: serializeOneBotMessage(params.message) }
                : {})
        }

        if (typeof this.bot.sendApi === 'function') {
            try {
                return settleMatched(await this.bot.sendApi(action, actionParams))
            } catch (error) {
                if (strict && error?.code === 'UNSUPPORTED_BOT_API') throw error
                if (strict) throw new Error(`${action} 调用失败 (sendApi): ${error.message}`)
                return null
            }
        }

        if (typeof this.bot[action] === 'function') {
            try {
                return settleMatched(await this.bot[action](actionParams))
            } catch (error) {
                if (strict && error?.code === 'UNSUPPORTED_BOT_API') throw error
                if (strict) throw new Error(`${action} 调用失败 (${action}): ${error.message}`)
                return null
            }
        }

        if (!strict) return null
        throw new UnsupportedBotApiError(action)
    }
}

Object.assign(StandardBotApi.prototype, StandardDirectoryMethods, StandardMessagingMethods)

/**
 * 从工具上下文创建标准接口。
 * @param {Object} ctx - MCP 工具上下文
 * @returns {StandardBotApi} 标准接口
 */
export function standardBotApi(ctx) {
    return StandardBotApi.fromContext(ctx)
}
