/**
 * 消息操作工具
 * 发送消息、@用户、获取聊天记录等
 */

import {
    filterMembers,
    randomSelectMembers,
    findMemberByName,
    formatMemberInfo,
    batchSendMessages,
    getMasterList,
    parseCardData,
    buildLinkCard,
    buildBigImageCard
} from './helpers.js'
import { recordSentMessage, checkDuplicateToolSend, markToolSendCommitted } from '../../utils/messageDedup.js'
import {
    normalizeStandardMessage,
    StandardBotApi,
    StandardMessage as segment,
    StandardRawApi
} from '../../core/platform/index.js'
import { ForwardMessageParser, IcqqMessageUtils, ProtobufUtils, MsgRecordExtractor } from '../../utils/messageParser.js'

const MAX_DEEP_PARSE_DEPTH = 10

function clampDeepParseDepth(value, fallback = 5) {
    const depth = Math.floor(Number(value))
    return Number.isFinite(depth) ? Math.min(Math.max(depth, 1), MAX_DEEP_PARSE_DEPTH) : fallback
}

function parseProtocolBody(data, encoding = 'auto') {
    if (Buffer.isBuffer(data)) return data
    if (data && typeof data === 'object') return data
    if (typeof data !== 'string') return data

    const text = data.trim()
    if (!text) return Buffer.alloc(0)

    if (encoding === 'json' || (encoding === 'auto' && /^[{[]/.test(text))) {
        return JSON.parse(text)
    }
    if (encoding === 'hex') return Buffer.from(text.replace(/\s+/g, ''), 'hex')
    if (encoding === 'text' || encoding === 'utf8') return Buffer.from(text)
    return Buffer.from(text, 'base64')
}

function encodeProtocolBody(body, shouldEncode) {
    if (!shouldEncode || Buffer.isBuffer(body) || body instanceof Uint8Array) return body
    if (!body || typeof body !== 'object') return body
    return ProtobufUtils.encode(body) || body
}

function toPacketBuffer(body) {
    if (Buffer.isBuffer(body)) return body
    if (body instanceof Uint8Array) return Buffer.from(body)
    if (body && typeof body === 'object') {
        const encoded = ProtobufUtils.encode(body)
        if (encoded) return Buffer.from(encoded)
        return Buffer.from(JSON.stringify(body))
    }
    if (typeof body === 'string') return Buffer.from(body)
    return Buffer.alloc(0)
}

function formatProtocolResponse(response, decodeResponse = false) {
    if (Buffer.isBuffer(response) || response instanceof Uint8Array) {
        const buffer = Buffer.from(response)
        const result = { base64: buffer.toString('base64'), hex: buffer.toString('hex') }
        if (decodeResponse) {
            const decoded = ProtobufUtils.decode(buffer)
            if (decoded) result.decoded = decoded?.toJSON?.() || decoded
        }
        return result
    }
    return response?.toJSON?.() || response || null
}

function getPacketBuildOptions(args) {
    const build = args.build && typeof args.build === 'object' ? { ...args.build } : {}
    build.cmd = build.cmd || args.cmd || args.pb_type
    build.type = Number(build.type ?? args.packet_type ?? 0xb)
    build.encrypt = Number(build.encrypt ?? args.encrypt ?? 0x1)
    if (args.extra) build.extra = args.extra
    return build
}

async function handleProtocolPacket(args, ctx) {
    const cmd = args.cmd || args.pb_type || args.action
    const method = args.method || (Array.isArray(args.packets) ? 'send_merge_uni' : 'auto')
    let body = parseProtocolBody(args.body ?? args.pb_data ?? args.data ?? '', args.body_encoding || 'auto')
    body = encodeProtocolBody(body, args.encode_json !== false)
    const packets = (
        Array.isArray(args.packets) ? args.packets : [{ cmd, body, needResp: args.need_response !== false }]
    ).map(packet => ({
        cmd: packet.cmd || cmd,
        body: toPacketBuffer(
            parseProtocolBody(
                packet.body ?? packet.pb_data ?? body,
                packet.body_encoding || args.body_encoding || 'auto'
            )
        ),
        seq: packet.seq,
        needResp: packet.needResp ?? packet.need_response ?? true
    }))
    const rawApi = StandardRawApi.fromContext(ctx)
    const result = await rawApi.send({
        method,
        cmd,
        body: toPacketBuffer(body),
        timeout: args.timeout,
        extra: args.extra && typeof args.extra === 'object' ? args.extra : undefined,
        seq: args.seq,
        build: getPacketBuildOptions(args),
        packets,
        action: args.action,
        params: args.params || { cmd, pb_type: cmd, pb_data: args.pb_data }
    })
    return {
        success: true,
        method: result.method,
        cmd,
        response: formatProtocolResponse(result.response, args.decode_response !== false),
        ...(result.note ? { note: result.note } : {}),
        available_methods: rawApi.capabilities()
    }
}

export const messageTools = [
    {
        name: 'send_to_master',
        description: '发送私聊消息给主人。可以主动向主人报告信息、发送通知等。',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '文本消息内容' },
                image_url: { type: 'string', description: '图片URL（可选）' },
                master_index: { type: 'number', description: '主人索引（0=第一个主人，默认0）' },
                all_masters: { type: 'boolean', description: '是否发送给所有主人（默认false）' }
            },
            required: ['message']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                const botId = api.getBotInfo().user_id
                const masters = await getMasterList(botId)
                if (masters.length === 0) {
                    return { success: false, error: '未配置主人QQ，请在Yunzai配置中设置masterQQ' }
                }
                const masterDedupSig = `${!!args.all_masters}|${args.master_index ?? 0}|${args.message || ''}|${args.image_url || ''}`
                const masterDedup = checkDuplicateToolSend(ctx, 'send_to_master', masterDedupSig)
                if (masterDedup.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${masterDedup.count}次)，已跳过`, skipped: true }
                }
                const msgParts = []
                if (args.message) msgParts.push(args.message)
                if (args.image_url) msgParts.push(segment.image(args.image_url))

                if (msgParts.length === 0) {
                    return { success: false, error: '消息内容不能为空' }
                }

                const results = []

                if (args.all_masters) {
                    for (let i = 0; i < masters.length; i++) {
                        const masterId = api.targetId(masters[i])
                        try {
                            const sent = await api.sendPrivate(masterId, msgParts.length === 1 ? msgParts[0] : msgParts)
                            results.push({ master_id: masterId, success: true, message_id: sent.message_id })
                        } catch (err) {
                            results.push({ master_id: masterId, success: false, error: err.message })
                        }
                    }
                    const successCount = results.filter(r => r.success).length
                    return {
                        success: successCount > 0,
                        total: masters.length,
                        success_count: successCount,
                        results
                    }
                } else {
                    // 发送给指定主人
                    const idx = args.master_index || 0
                    if (idx >= masters.length) {
                        return { success: false, error: `主人索引超出范围，当前共有 ${masters.length} 个主人` }
                    }
                    const masterId = api.targetId(masters[idx])
                    const sent = await api.sendPrivate(masterId, msgParts.length === 1 ? msgParts[0] : msgParts)

                    if (args.message) recordSentMessage(args.message)
                    return { success: true, master_id: masterId, message_id: sent.message_id }
                }
            } catch (err) {
                return { success: false, error: `发送给主人失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_master_info',
        description: '获取主人信息列表',
        inputSchema: {
            type: 'object',
            properties: {
                debug: { type: 'boolean', description: '是否返回调试信息' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const botId = api.getBotInfo().user_id

                // 调试模式：返回所有可能的配置源
                if (args.debug) {
                    const isMaster = typeof ctx.isMaster === 'function' ? ctx.isMaster() : ctx.isMaster === true
                    if (!isMaster) return { success: false, permissionDenied: true, error: '仅主人可查看调试信息' }
                    const debugInfo = {
                        bot_id: botId,
                        adapter: api.adapterType,
                        has_global_cfg: Boolean(global.cfg),
                        has_master_settings: Boolean(global.cfg?.master || global.cfg?.masterQQ || global.Bot?.master)
                    }
                    return { success: true, debug: debugInfo }
                }

                const masters = await getMasterList(botId)
                if (masters.length === 0) {
                    return { success: true, count: 0, masters: [], note: '未配置主人QQ' }
                }

                // 获取主人详细信息
                const masterInfos = []
                for (let i = 0; i < masters.length; i++) {
                    const masterId = api.targetId(masters[i])
                    let info = { index: i, user_id: masterId }

                    try {
                        const [profile, friendState] = await Promise.all([
                            api.getUserInfo(masterId),
                            api.getFriendState(masterId)
                        ])
                        info.nickname = profile?.nickname || profile?.nick
                        info.remark = friendState.friend?.remark
                        info.is_friend = friendState.isFriend
                    } catch {}

                    masterInfos.push(info)
                }

                return {
                    success: true,
                    count: masters.length,
                    masters: masterInfos
                }
            } catch (err) {
                return { success: false, error: `获取主人信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_private_message',
        description: '发送私聊消息给指定用户。如果不是好友，会尝试通过群临时会话发送（需要提供group_id或在群聊中使用）',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '目标用户的QQ号' },
                message: { type: 'string', description: '文本消息内容' },
                image_url: { type: 'string', description: '图片URL（可选）' },
                group_id: { type: 'string', description: '群号（非好友时用于发送临时消息，不填则使用当前群）' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const pmSig = `${args.user_id}|${args.group_id || ''}|${args.message || ''}|${args.image_url || ''}`
                const dedupResult = checkDuplicateToolSend(ctx, 'send_private_message', pmSig)
                if (dedupResult.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${dedupResult.count}次)，已跳过`, skipped: true }
                }
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取有效的Bot实例，请确保有账号在线' }
                }
                const userId = api.targetId(args.user_id)

                const msgParts = []
                if (args.message) msgParts.push(args.message)
                if (args.image_url) msgParts.push(segment.image(args.image_url))

                if (msgParts.length === 0) {
                    return { success: false, error: '消息内容不能为空' }
                }

                const msgContent = msgParts.length === 1 ? msgParts[0] : msgParts

                const sent = await api.sendPrivateWithGroupFallback(userId, msgContent, args.group_id)
                if (args.message) recordSentMessage(args.message)
                return {
                    success: true,
                    message_id: sent.message_id,
                    user_id: userId,
                    group_id: sent.group_id,
                    method: sent.method
                }
            } catch (err) {
                return { success: false, error: `发送私聊消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_group_message',
        description: '发送群消息',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '目标群号' },
                message: { type: 'string', description: '文本消息内容' },
                at_user: { type: 'string', description: '要@的用户QQ号，"all"表示@全体' },
                image_url: { type: 'string', description: '图片URL（可选）' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const gmSig = `${args.group_id}|${args.at_user || ''}|${args.message || ''}|${args.image_url || ''}`
                const dedupResult = checkDuplicateToolSend(ctx, 'send_group_message', gmSig)
                if (dedupResult.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${dedupResult.count}次)，已跳过`, skipped: true }
                }

                const api = StandardBotApi.fromContext(ctx)
                const groupId = api.targetId(args.group_id)

                const msgParts = []
                if (args.at_user) {
                    msgParts.push(args.at_user === 'all' ? segment.at('all') : segment.at(args.at_user))
                }
                if (args.message) msgParts.push(args.message)
                if (args.image_url) msgParts.push(segment.image(args.image_url))

                if (msgParts.length === 0) {
                    return { success: false, error: '消息内容不能为空' }
                }

                const sent = await api.sendGroup(groupId, msgParts.length === 1 ? msgParts[0] : msgParts)
                if (args.message) recordSentMessage(args.message)
                return { success: true, message_id: sent.message_id, group_id: groupId }
            } catch (err) {
                return { success: false, error: `发送群消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'reply_current_message',
        description: '回复当前会话消息（自动判断群聊/私聊）',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '回复内容' },
                at_sender: { type: 'boolean', description: '是否@发送者（仅群聊有效）' },
                quote: { type: 'boolean', description: '是否引用原消息' }
            },
            required: ['message']
        },
        handler: async (args, ctx) => {
            try {
                const replySig = `${args.message}|at:${!!args.at_sender}|q:${!!args.quote}`
                const dedupResult = checkDuplicateToolSend(ctx, 'reply_current_message', replySig)
                if (dedupResult.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${dedupResult.count}次)，已跳过`, skipped: true }
                }

                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                const msgParts = []
                if (args.at_sender && e.group_id) {
                    msgParts.push(segment.at(e.user_id))
                    msgParts.push(' ')
                }
                msgParts.push(args.message)

                const sent = await new StandardBotApi({ event: e }).reply(msgParts, args.quote || false)
                if (args.message) recordSentMessage(args.message)
                return {
                    success: true,
                    message_id: sent.message_id,
                    is_group: !!e.group_id
                }
            } catch (err) {
                return { success: false, error: `回复消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'at_user',
        description:
            '发送@用户消息。支持 targets 数组（多人）、次数 count、模式 at_mode：together=同一条消息里一起@，separate=分多条逐个@（默认）。也兼容单参数 user_id / nickname。特殊值：sender、all、owner（群主）。',
        inputSchema: {
            type: 'object',
            properties: {
                targets: {
                    type: 'array',
                    items: { type: 'string' },
                    description:
                        '要@的对象列表，每项可为QQ号、群昵称/名片，或 sender/@发送者、all/@全体、owner/群主。与 user_id、nickname 二选一，优先 targets'
                },
                user_id: {
                    type: 'string',
                    description: '单个目标QQ号；兼容旧参数。"sender"=发送者，"all"=全体，"owner"=群主'
                },
                nickname: { type: 'string', description: '通过昵称/群名片查找单个用户（仅群聊），兼容旧参数' },
                message: { type: 'string', description: '附带文本（可选）' },
                count: {
                    type: 'number',
                    description:
                        '发送条数：together=含全部@的相同消息发送 count 次；separate=单目标时发 count 条，多目标时为重复轮数（每轮对每个目标各发一条），默认1，最多10',
                    minimum: 1,
                    maximum: 10
                },
                at_mode: {
                    type: 'string',
                    enum: ['together', 'separate'],
                    description: 'together=一起@在同一条消息；separate=一个个分多条发（默认 separate）'
                },
                interval: { type: 'number', description: '多条发送间隔(ms)，默认500', minimum: 200 }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                let targetList = []
                if (Array.isArray(args.targets) && args.targets.length > 0) {
                    targetList = args.targets.map(t => String(t).trim()).filter(Boolean)
                } else if (args.user_id) {
                    targetList = [String(args.user_id).trim()]
                } else if (args.nickname) {
                    targetList = [String(args.nickname).trim()]
                }

                if (targetList.length === 0) {
                    return { success: false, error: '必须提供 targets 数组，或 user_id，或 nickname' }
                }
                if (targetList.length > 10) {
                    return { success: false, error: '最多同时指定 10 个 @ 目标' }
                }

                const atMode = args.at_mode === 'together' ? 'together' : 'separate'
                const sendCount = Math.min(Math.max(Number(args.count) || 1, 1), 10)
                const interval = Math.max(Number(args.interval) || 500, 200)

                const resolveEntries = async () => {
                    let memberList = null
                    const ensureMembers = async () => {
                        if (!memberList) {
                            memberList = await api.getMemberList(e.group_id)
                        }
                        return memberList
                    }
                    const out = []
                    for (const raw of targetList) {
                        const s = String(raw).trim()
                        const lower = s.toLowerCase()
                        if (lower === 'sender') {
                            out.push({ id: String(e.user_id), matchedName: null })
                            continue
                        }
                        if (lower === 'all') {
                            if (!e.group_id) return { error: '@全体仅在群聊中有效' }
                            out.push({ id: 'all', matchedName: null })
                            continue
                        }
                        if (lower === 'owner') {
                            if (!e.group_id) return { error: '查找群主仅在群聊中有效' }
                            const ml = await ensureMembers()
                            const owners = filterMembers(ml, { role: 'owner' })
                            if (owners.length === 0) return { error: '未找到群主' }
                            const o = owners[0]
                            out.push({
                                id: String(o.user_id || o.uid),
                                matchedName: o.card || o.nickname || o.nick || ''
                            })
                            continue
                        }
                        if (/^\d+$/.test(s)) {
                            out.push({ id: s, matchedName: null })
                            continue
                        }
                        if (!e.group_id) return { error: `通过昵称「${s}」查找需要群聊上下文` }
                        const ml = await ensureMembers()
                        const result = findMemberByName(ml, s)
                        if (!result) return { error: `未找到昵称「${s}」的群成员` }
                        const m = result.member
                        out.push({
                            id: String(m.user_id || m.uid),
                            matchedName: m.card || m.nickname || m.nick || ''
                        })
                    }
                    return { resolved: out }
                }

                const resolvedPack = await resolveEntries()
                if (resolvedPack.error) {
                    return { success: false, error: resolvedPack.error }
                }
                const resolved = resolvedPack.resolved
                const ids = resolved.map(r => r.id)

                let totalPlanned = 0
                if (atMode === 'together') {
                    totalPlanned = sendCount
                } else if (resolved.length === 1) {
                    totalPlanned = sendCount
                } else {
                    totalPlanned = sendCount * resolved.length
                }
                if (totalPlanned > 30) {
                    return {
                        success: false,
                        error: `计划发送 ${totalPlanned} 条消息，超过上限 30，请减少 count 或目标数量`
                    }
                }

                // 去重：必须包含目标、模式、次数，避免仅依赖 message 导致空文案碰撞或误拦
                const dedupContent = `${atMode}|${sendCount}|${ids.join(',')}|${args.message || ''}`
                const dedupResult = checkDuplicateToolSend(ctx, 'at_user', dedupContent)
                if (dedupResult.isDuplicate) {
                    return { success: false, error: `检测到重复调用(${dedupResult.count}次)，已跳过`, skipped: true }
                }

                const buildSingleAtParts = id => {
                    const parts = []
                    if (id === 'all') {
                        parts.push(segment.at('all'))
                    } else {
                        parts.push(segment.at(id))
                    }
                    if (args.message) parts.push(' ' + args.message)
                    return parts
                }

                const buildTogetherParts = () => {
                    const parts = []
                    for (let idx = 0; idx < ids.length; idx++) {
                        const id = ids[idx]
                        if (id === 'all') parts.push(segment.at('all'))
                        else parts.push(segment.at(id))
                        if (idx < ids.length - 1) parts.push(' ')
                    }
                    if (args.message) {
                        if (parts.length) parts.push(' ')
                        parts.push(args.message.trim())
                    }
                    return parts
                }

                let results = []

                if (atMode === 'together') {
                    const msgParts = buildTogetherParts()
                    results = await batchSendMessages({
                        api,
                        event: e,
                        messages: msgParts,
                        count: sendCount,
                        interval
                    })
                } else if (resolved.length === 1) {
                    const msgParts = buildSingleAtParts(ids[0])
                    results = await batchSendMessages({
                        api,
                        event: e,
                        messages: msgParts,
                        count: sendCount,
                        interval
                    })
                } else {
                    for (let round = 0; round < sendCount; round++) {
                        for (let i = 0; i < resolved.length; i++) {
                            const msgParts = buildSingleAtParts(ids[i])
                            try {
                                const result = await api.reply(msgParts)
                                results.push({
                                    index: results.length + 1,
                                    success: true,
                                    message_id: result.message_id,
                                    round: round + 1,
                                    at_target: ids[i]
                                })
                            } catch (err) {
                                results.push({
                                    index: results.length + 1,
                                    success: false,
                                    error: err.message,
                                    round: round + 1,
                                    at_target: ids[i]
                                })
                            }
                            const isLast = round === sendCount - 1 && i === resolved.length - 1
                            if (!isLast) await new Promise(r => setTimeout(r, interval))
                        }
                    }
                }

                if (args.message) recordSentMessage(args.message)
                markToolSendCommitted(ctx, 'at_user', dedupContent)

                const successCount = results.filter(r => r.success).length
                return {
                    success: successCount > 0,
                    at_mode: atMode,
                    total_count: results.length,
                    success_count: successCount,
                    planned_sends: totalPlanned,
                    at_targets: ids,
                    matched_names: resolved.map(r => r.matchedName).filter(Boolean),
                    results: results.length > 1 ? results : undefined,
                    message_id: results[0]?.message_id
                }
            } catch (err) {
                return { success: false, error: `@用户失败: ${err.message}` }
            }
        }
    },

    {
        name: 'at_role',
        description:
            '按角色随机@群成员。支持@管理员、普通成员等，可指定数量和是否排除群主。解决"帮我at一个随机管理员"的需求。',
        inputSchema: {
            type: 'object',
            properties: {
                role: {
                    type: 'string',
                    description:
                        '目标角色：admin(管理员含群主)、admin_only(仅管理员不含群主)、owner(群主)、member(普通成员)、any(任意成员)',
                    enum: ['admin', 'admin_only', 'owner', 'member', 'any']
                },
                count: { type: 'number', description: '要选择的人数，默认1', minimum: 1, maximum: 10 },
                message: { type: 'string', description: '附带的消息内容' },
                exclude_self: { type: 'boolean', description: '是否排除自己（触发者），默认false' },
                exclude_bot: { type: 'boolean', description: '是否排除机器人，默认true' },
                send_count: { type: 'number', description: '发送次数（每次随机选择），默认1', minimum: 1, maximum: 5 },
                interval: { type: 'number', description: '多次发送间隔(ms)，默认500', minimum: 200 }
            },
            required: ['role']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!e || !e.group_id) {
                    return { success: false, error: '此功能仅在群聊中有效' }
                }

                const roleDedupSig = `${args.role}|n:${args.count ?? 1}|sc:${args.send_count ?? 1}|${args.message || ''}|es:${!!args.exclude_self}|eb:${args.exclude_bot !== false}|iv:${args.interval ?? 500}`
                const roleDedup = checkDuplicateToolSend(ctx, 'at_role', roleDedupSig)
                if (roleDedup.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${roleDedup.count}次)，已跳过`, skipped: true }
                }

                const botId = api.getBotInfo().user_id
                const memberList = await api.getMemberList(e.group_id)

                if (memberList.length === 0) {
                    return { success: false, error: '获取群成员列表失败' }
                }

                // 按角色筛选
                const role = args.role === 'any' ? null : args.role
                const excludeUsers = []
                if (args.exclude_self) excludeUsers.push(String(e.user_id))

                const candidates = filterMembers(memberList, {
                    role,
                    excludeBot: args.exclude_bot !== false,
                    excludeUsers,
                    botId
                })

                if (candidates.length === 0) {
                    const roleNames = {
                        admin: '管理员',
                        admin_only: '管理员（不含群主）',
                        owner: '群主',
                        member: '普通成员',
                        any: '成员'
                    }
                    return { success: false, error: `没有符合条件的${roleNames[args.role] || '成员'}可供选择` }
                }

                const selectCount = Math.min(args.count || 1, candidates.length)
                const sendCount = Math.min(args.send_count || 1, 5)
                const interval = Math.max(args.interval || 500, 200)
                const allResults = []

                for (let s = 0; s < sendCount; s++) {
                    // 每次发送重新随机选择
                    const selected = randomSelectMembers(candidates, selectCount)

                    const msgParts = []
                    for (const member of selected) {
                        msgParts.push(segment.at(member.user_id || member.uid))
                        msgParts.push(' ')
                    }
                    if (args.message) msgParts.push(args.message)

                    try {
                        const result = await api.reply(msgParts)
                        if (args.message) recordSentMessage(args.message)
                        allResults.push({
                            index: s + 1,
                            success: true,
                            message_id: result.message_id,
                            selected: selected.map(formatMemberInfo)
                        })
                    } catch (err) {
                        allResults.push({
                            index: s + 1,
                            success: false,
                            error: err.message
                        })
                    }

                    if (s < sendCount - 1) {
                        await new Promise(r => setTimeout(r, interval))
                    }
                }

                const successCount = allResults.filter(r => r.success).length
                return {
                    success: successCount > 0,
                    role: args.role,
                    candidates_count: candidates.length,
                    select_count: selectCount,
                    send_count: sendCount,
                    success_count: successCount,
                    results: allResults
                }
            } catch (err) {
                return { success: false, error: `按角色@成员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'random_at',
        description: '随机@群成员。可排除管理员、群主等，支持批量@多人。',
        inputSchema: {
            type: 'object',
            properties: {
                count: { type: 'number', description: '要@的人数，默认1', minimum: 1, maximum: 10 },
                message: { type: 'string', description: '附带的消息内容' },
                exclude_admin: { type: 'boolean', description: '是否排除管理员，默认false' },
                exclude_owner: { type: 'boolean', description: '是否排除群主，默认false' },
                exclude_bot: { type: 'boolean', description: '是否排除机器人，默认true' },
                exclude_self: { type: 'boolean', description: '是否排除触发者，默认false' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!e || !e.group_id) {
                    return { success: false, error: '此功能仅在群聊中有效' }
                }

                const raSig = `n:${args.count ?? 1}|${args.message || ''}|ea:${!!args.exclude_admin}|eo:${!!args.exclude_owner}|eb:${args.exclude_bot !== false}|es:${!!args.exclude_self}`
                const raDedup = checkDuplicateToolSend(ctx, 'random_at', raSig)
                if (raDedup.isDuplicate) {
                    return { success: false, error: `检测到重复发送(${raDedup.count}次)，已跳过`, skipped: true }
                }

                const botId = api.getBotInfo().user_id
                const memberList = await api.getMemberList(e.group_id)

                if (memberList.length === 0) {
                    return { success: false, error: '获取群成员列表失败' }
                }

                const excludeUsers = []
                if (args.exclude_self) excludeUsers.push(String(e.user_id))

                const candidates = filterMembers(memberList, {
                    excludeBot: args.exclude_bot !== false,
                    excludeOwner: args.exclude_owner,
                    excludeAdmin: args.exclude_admin,
                    excludeUsers,
                    botId
                })

                if (candidates.length === 0) {
                    return { success: false, error: '没有符合条件的群成员可供选择' }
                }

                const count = Math.min(args.count || 1, candidates.length)
                const selected = randomSelectMembers(candidates, count)

                const msgParts = []
                for (const member of selected) {
                    msgParts.push(segment.at(member.user_id || member.uid))
                    msgParts.push(' ')
                }
                if (args.message) msgParts.push(args.message)

                const result = await api.reply(msgParts)
                if (args.message) recordSentMessage(args.message)
                return {
                    success: true,
                    message_id: result.message_id,
                    selected_count: selected.length,
                    selected_members: selected.map(formatMemberInfo)
                }
            } catch (err) {
                return { success: false, error: `随机@成员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_chat_history',
        description: '获取聊天历史记录。当用户问"刚才说了什么""之前聊了什么"或需要了解对话上下文时调用。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号（群聊时）' },
                user_id: { type: 'string', description: '用户QQ号（私聊时）' },
                message_id: { type: 'string', description: '从指定 message_id 往前获取，icqq 会自动解析群/私聊目标' },
                seq: {
                    type: 'string',
                    description: '群消息 seq；QQBot 传事件 message_id（其余协议可传数字字符串）'
                },
                time: { type: 'number', description: '私聊时间戳，默认0表示最新消息往前' },
                count: { type: 'number', description: '获取数量，默认20，icqq 非 NT 通常最多20' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const e = ctx.getEvent?.()
                if (!api.bot) return { success: false, error: '无法获取Bot实例' }
                const count = Math.min(Math.max(Number(args.count || 20), 1), 50)
                let history = []
                const isGroup = Boolean(args.group_id || (!args.user_id && e?.group_id))
                let source = 'standard.history'
                let targetId = null

                if (args.message_id) {
                    const msg = await api.getMessage(args.message_id, {
                        groupId: args.group_id || e?.group_id,
                        userId: args.user_id || e?.user_id
                    })
                    history = msg ? [msg.data || msg] : []
                } else if (args.group_id || e?.group_id) {
                    targetId = api.targetId(args.group_id || e.group_id)
                    const sequence = api.historySequence(args.seq ?? e?.seq ?? e?.message_seq ?? e?.message_id, 0)
                    history = await api.getHistory({ groupId: targetId, sequence, count })
                } else if (args.user_id || e?.user_id) {
                    targetId = api.targetId(args.user_id || e.user_id)
                    const sequence = api.historySequence(args.time, 0)
                    history = await api.getHistory({ userId: targetId, sequence, count })
                } else {
                    return { success: false, error: '需要指定 group_id、user_id 或提供会话上下文' }
                }

                const messages = (Array.isArray(history) ? history : []).slice(-count).map(msg => {
                    const data = msg.data || msg
                    return {
                        message_id: data.message_id || '',
                        seq: data.seq || data.message_seq || 0,
                        rand: data.rand || 0,
                        time: data.time,
                        user_id: data.sender?.user_id || data.user_id,
                        nickname: data.sender?.nickname || data.sender?.card || data.nickname || '',
                        content: data.raw_message || parseForwardContent(data.message || data.content || [])
                    }
                })

                return {
                    success: true,
                    source,
                    is_group: isGroup,
                    target_id: targetId,
                    count: messages.length,
                    messages
                }
            } catch (err) {
                return { success: false, error: `获取聊天记录失败: ${err.message}` }
            }
        }
    },

    {
        name: 'recall_message',
        description: '撤回消息（仅限2分钟内的消息）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const e = ctx.getEvent()
                const result = await api.recall({
                    messageId: args.message_id,
                    groupId: e?.group_id,
                    userId: e?.group_id ? null : e?.user_id
                })

                const recalled = Array.isArray(result)
                    ? result.length > 0 && result.every(item => item !== false)
                    : result !== false
                if (!recalled) return { success: false, error: '协议端返回撤回失败' }
                return { success: true, message_id: args.message_id }
            } catch (err) {
                return { success: false, error: `撤回失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_forward_msg',
        description: '获取合并转发消息的完整内容。支持提取 pb/pbelem/msgrecord 等底层数据。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '转发消息ID（res_id）' },
                extract_proto: { type: 'boolean', description: '是否提取 protobuf 数据（icqq专用，默认false）' },
                extract_serialized: { type: 'boolean', description: '是否提取序列化数据（默认false）' },
                include_raw: { type: 'boolean', description: '是否包含原始数据（默认false）' },
                max_depth: { type: 'number', description: '嵌套转发最大解析深度（默认5）' }
            },
            required: ['id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent?.()
                const api = StandardBotApi.fromContext(ctx)

                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                const parseResult = await ForwardMessageParser.parse(e, args.id, {
                    extractProto: args.extract_proto || false,
                    extractSerialized: args.extract_serialized || false,
                    maxDepth: clampDeepParseDepth(args.max_depth, 5)
                })

                if (!parseResult.success) {
                    // 回退到传统方式
                    const messages = await api.getForwardMessage(args.id, {
                        ...(e?.group_id ? { groupId: e.group_id } : e?.user_id ? { userId: e.user_id } : {})
                    })

                    if (!messages.length) {
                        return {
                            success: false,
                            error: '获取转发内容失败',
                            parse_errors: parseResult.errors
                        }
                    }
                    const parsed = messages.map((msg, idx) => ({
                        index: idx,
                        sender: {
                            user_id: msg.sender?.user_id || msg.user_id,
                            nickname: msg.sender?.nickname || msg.nickname || '未知'
                        },
                        time: msg.time,
                        content: parseForwardContent(msg.content || msg.message || [])
                    }))

                    return {
                        success: true,
                        count: parsed.length,
                        messages: parsed,
                        method: 'fallback'
                    }
                }

                // 构建返回结果
                const result = {
                    success: true,
                    count: parseResult.totalCount,
                    method: parseResult.method,
                    messages: parseResult.messages.map((msg, idx) => {
                        const msgResult = {
                            index: idx,
                            user_id: msg.user_id,
                            nickname: msg.nickname,
                            time: msg.time,
                            group_id: msg.group_id,
                            seq: msg.seq,
                            content: parseForwardContent(msg.message || []),
                            raw_message: msg.raw_message
                        }

                        // 可选：添加 proto 数据
                        if (args.extract_proto && msg.proto) {
                            msgResult.proto = msg.proto
                        }

                        // 可选：添加序列化数据
                        if (args.extract_serialized && msg.serialized) {
                            msgResult.serialized = msg.serialized
                        }

                        // 嵌套转发
                        if (msg.nested_forward?.success) {
                            msgResult.nested_forward = {
                                count: msg.nested_forward.totalCount,
                                method: msg.nested_forward.method
                            }
                        }

                        return msgResult
                    }),
                    // 图片URL列表
                    image_urls: ForwardMessageParser.extractImageUrls(parseResult)
                }

                // 可选：添加原始数据
                if (args.include_raw) {
                    result.raw = parseResult.raw
                }

                // 添加解析错误（如果有）
                if (parseResult.errors?.length > 0) {
                    result.parse_errors = parseResult.errors
                }

                return result
            } catch (err) {
                return { success: false, error: `获取转发消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'deep_parse_message',
        description:
            '深度解析消息内容。递归解析合并转发、引用消息，直到获取最内层的所有数据。适用于需要获取转发消息中的完整内容、引用链等场景。',
        inputSchema: {
            type: 'object',
            properties: {
                forward_id: { type: 'string', description: '合并转发消息的ID（res_id）' },
                message_id: { type: 'string', description: '消息ID，用于获取引用消息' },
                max_depth: { type: 'number', description: '最大递归深度，默认5' },
                include_images: { type: 'boolean', description: '是否包含图片URL，默认true' },
                flatten: { type: 'boolean', description: '是否展平为一维数组，默认false' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent?.()
                const api = StandardBotApi.fromContext(ctx)

                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const maxDepth = clampDeepParseDepth(args.max_depth, 5)
                const includeImages = args.include_images !== false
                const flatten = args.flatten || false

                // 递归解析函数
                async function parseDeep(content, depth = 0) {
                    if (depth >= maxDepth) {
                        return { type: 'max_depth_reached', depth }
                    }

                    const results = []
                    const segments = Array.isArray(content) ? content : [content]

                    for (const seg of segments) {
                        if (!seg) continue

                        const segType = seg.type || (typeof seg === 'string' ? 'text' : 'unknown')
                        const segData = seg.data || seg

                        // 处理合并转发
                        if (segType === 'forward') {
                            const forwardId = segData.id || segData.res_id
                            if (forwardId) {
                                try {
                                    const messages = await api.getForwardMessage(forwardId, {
                                        ...(e?.group_id
                                            ? { groupId: e.group_id }
                                            : e?.user_id
                                              ? { userId: e.user_id }
                                              : {})
                                    })

                                    if (messages.length) {
                                        const innerResults = []

                                        for (const msg of messages) {
                                            const msgContent = msg.content || msg.message || []
                                            const parsed = await parseDeep(msgContent, depth + 1)
                                            innerResults.push({
                                                sender: {
                                                    user_id: msg.sender?.user_id || msg.user_id,
                                                    nickname: msg.sender?.nickname || msg.nickname || '未知'
                                                },
                                                time: msg.time,
                                                content: parsed
                                            })
                                        }

                                        results.push({
                                            type: 'forward',
                                            depth,
                                            count: innerResults.length,
                                            messages: innerResults
                                        })
                                    }
                                } catch (err) {
                                    results.push({ type: 'forward_error', id: forwardId, error: err.message })
                                }
                            }
                        }
                        // 处理引用消息
                        else if (segType === 'reply') {
                            const replyId = segData.id || segData.message_id
                            if (replyId) {
                                try {
                                    const replyMsg = await api.getMessage(replyId, {
                                        ...(e?.group_id
                                            ? { groupId: e.group_id }
                                            : e?.user_id
                                              ? { userId: e.user_id }
                                              : {})
                                    })

                                    if (replyMsg) {
                                        const msgContent = replyMsg.message || replyMsg.content || []
                                        const parsed = await parseDeep(msgContent, depth + 1)
                                        results.push({
                                            type: 'reply',
                                            depth,
                                            original_id: replyId,
                                            sender: replyMsg.sender,
                                            content: parsed
                                        })
                                    }
                                } catch (err) {
                                    results.push({ type: 'reply_error', id: replyId, error: err.message })
                                }
                            }
                        }
                        // 处理图片
                        else if (segType === 'image' && includeImages) {
                            results.push({
                                type: 'image',
                                url: segData.url || segData.file,
                                file: segData.file
                            })
                        }
                        // 处理文本
                        else if (segType === 'text') {
                            const text = segData.text || (typeof segData === 'string' ? segData : '')
                            if (text.trim()) {
                                results.push(segment.text(text.trim()))
                            }
                        }
                        // 处理@
                        else if (segType === 'at') {
                            results.push({
                                type: 'at',
                                qq: segData.qq || segData.user_id,
                                name: segData.name
                            })
                        }
                        // 其他类型
                        else if (segType !== 'unknown') {
                            results.push({ type: segType, data: segData })
                        }
                    }

                    return results
                }

                // 开始解析
                let result
                if (args.forward_id) {
                    result = await parseDeep([{ type: 'forward', data: { id: args.forward_id } }])
                } else if (args.message_id) {
                    result = await parseDeep([{ type: 'reply', data: { id: args.message_id } }])
                } else if (e?.source) {
                    // 自动解析当前消息的引用
                    result = await parseDeep([{ type: 'reply', data: { id: e.source.message_id || e.source.seq } }])
                } else {
                    return { success: false, error: '请提供 forward_id 或 message_id' }
                }

                // 展平结果
                if (flatten) {
                    const flattened = []
                    function flattenResults(items) {
                        for (const item of items) {
                            if (item.type === 'forward' && item.messages) {
                                for (const msg of item.messages) {
                                    if (Array.isArray(msg.content)) {
                                        flattenResults(msg.content)
                                    }
                                }
                            } else if (item.type === 'reply' && Array.isArray(item.content)) {
                                flattenResults(item.content)
                            } else if (item.type === 'text' || item.type === 'image') {
                                flattened.push(item)
                            }
                        }
                    }
                    flattenResults(result)
                    result = flattened
                }

                return {
                    success: true,
                    max_depth: maxDepth,
                    result
                }
            } catch (err) {
                return { success: false, error: `深度解析失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_forward_msg',
        description:
            '【统一】发送合并转发消息。支持伪造多人对话、富文本内容（图片、@、表情等）。消息内容支持特殊标记：[图片:url]、[@qq]、[表情:id]等。可自定义外显标题、摘要。',
        inputSchema: {
            type: 'object',
            properties: {
                messages: {
                    type: 'array',
                    description: '消息列表，每条消息包含发送者信息和内容',
                    items: {
                        type: 'object',
                        properties: {
                            user_id: { type: 'string', description: '发送者QQ号（可以是任意数字）' },
                            nickname: { type: 'string', description: '发送者显示名称（可选，默认使用QQ号）' },
                            message: { type: 'string', description: '消息内容（支持文本、[图片:url]、[@qq]等标记）' },
                            time: { type: 'number', description: '时间戳（可选）' }
                        },
                        required: ['user_id', 'message']
                    }
                },
                group_id: { type: 'string', description: '目标群号（发送到指定群，优先级最高）' },
                user_id: { type: 'string', description: '目标用户QQ号（发送私聊，优先级次于group_id）' },
                to_master: { type: 'boolean', description: '是否发送给主人（私聊第一个主人，优先级最低）' },
                prompt: { type: 'string', description: '转发卡片外显标题（可选，如"群聊的聊天记录"）' },
                summary: { type: 'string', description: '底部摘要文本（可选，如"查看3条转发消息"）' },
                source: { type: 'string', description: '来源显示（可选，如"聊天记录"）' }
            },
            required: ['messages']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                if (!args.messages || args.messages.length === 0) {
                    return { success: false, error: '消息列表不能为空' }
                }

                // 确定发送目标
                let targetGroupId = null
                let targetUserId = null

                if (args.group_id) {
                    targetGroupId = api.targetId(args.group_id)
                } else if (args.user_id) {
                    targetUserId = api.targetId(args.user_id)
                } else if (args.to_master) {
                    const botId = api.getBotInfo().user_id
                    const masters = await getMasterList(botId)
                    if (masters.length === 0) {
                        return { success: false, error: '未配置主人QQ，无法发送给主人' }
                    }
                    targetUserId = api.targetId(masters[0])
                } else if (e) {
                    if (e.group_id) {
                        targetGroupId = e.group_id
                    } else {
                        targetUserId = e.user_id || e.sender?.user_id
                    }
                } else {
                    return { success: false, error: '没有指定发送目标，请提供 group_id、user_id 或设置 to_master' }
                }

                if (!targetGroupId && !targetUserId) {
                    return { success: false, error: '无法确定发送目标' }
                }

                const result = await api.sendForward({
                    groupId: targetGroupId,
                    userId: targetUserId,
                    nodes: args.messages.map(msg => ({
                        user_id: msg.user_id || msg.uin,
                        nickname: msg.nickname || msg.name,
                        message: msg.message || msg.content,
                        time: msg.time
                    })),
                    display: {
                        prompt: args.prompt,
                        summary: args.summary,
                        source: args.source
                    }
                })

                return result
            } catch (err) {
                return { success: false, error: `发送伪造转发失败: ${err.message}` }
            }
        }
    },

    {
        name: 'resend_quoted_card',
        description:
            '【推荐】重新发送引用消息中的卡片。当用户回复/引用了一条卡片消息（如哔哩哔哩分享、小程序、链接卡片等）并要求"发一个一样的"、"转发"、"复制"时，必须使用此工具。此工具会自动提取原始卡片数据并重新发送，无需任何参数。【重要】如果用户说"伪造消息"、"假转发"、"合并转发"，则设置 as_forward=true。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '目标群号（可选，不填则发送到当前会话）' },
                user_id: { type: 'string', description: '目标用户QQ号（可选，私聊）' },
                as_forward: {
                    type: 'boolean',
                    description: '是否作为合并转发消息发送。用户说"伪造消息"、"假转发"、"合并转发"时设置为true'
                },
                forward_nickname: { type: 'string', description: '转发时显示的昵称（可选）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)

                if (!api.bot && !e) {
                    return { success: false, error: '没有可用的会话上下文或Bot实例' }
                }

                // 从引用消息中提取卡片数据
                let jsonData = null
                let cardSource = null

                // 尝试从 e.source 或 e.reply 获取引用消息
                let replyMsg = null
                if (e?.getReply) {
                    try {
                        replyMsg = await e.getReply()
                    } catch {}
                }
                if (!replyMsg && e?.source) {
                    replyMsg = e.source
                }

                if (!replyMsg) {
                    return { success: false, error: '没有找到引用消息，请确保回复了一条包含卡片的消息' }
                }

                // 从引用消息中查找 json 类型的消息段
                const message = replyMsg.message || replyMsg.content || []
                const msgArray = Array.isArray(message) ? message : [message]

                for (const seg of msgArray) {
                    const segType = seg.type || ''
                    const segData = seg.data || seg

                    if (segType === 'json') {
                        jsonData = typeof segData === 'string' ? segData : segData.data || segData

                        // 如果还是对象，序列化它
                        if (typeof jsonData === 'object') {
                            jsonData = JSON.stringify(jsonData)
                        }

                        if (typeof jsonData === 'string') {
                            try {
                                const parsed = JSON.parse(jsonData)
                                if (parsed.app) {
                                    cardSource = 'json_segment'
                                    break
                                }
                            } catch {}
                        }
                    }
                }

                // 方式2: 尝试从 seg 本身获取（icqq 可能直接在 seg 上存储）
                if (!jsonData) {
                    for (const seg of msgArray) {
                        if (seg.type === 'json' && seg.data) {
                            // icqq 有时候 data 就是完整的 JSON 字符串
                            const d = seg.data
                            if (typeof d === 'string' && d.includes('"app"')) {
                                jsonData = d
                                cardSource = 'icqq_direct'
                                break
                            }
                        }
                    }
                }

                // 方式3: 尝试从 raw_message 解析 CQ 码
                if (!jsonData && replyMsg.raw_message) {
                    const rawMsg = replyMsg.raw_message
                    const jsonMatch = rawMsg.match(/\[CQ:json,data=([^\]]+)\]/)
                    if (jsonMatch) {
                        try {
                            let data = jsonMatch[1]
                                .replace(/&#91;/g, '[')
                                .replace(/&#93;/g, ']')
                                .replace(/&#44;/g, ',')
                                .replace(/&amp;/g, '&')
                            jsonData = data
                            cardSource = 'cq_code'
                        } catch {}
                    }
                }

                // 方式4: 尝试从 replyMsg 的其他字段获取
                if (!jsonData) {
                    // 有些框架可能在 json_card 或 card 字段
                    const candidates = [replyMsg.json_card, replyMsg.card, replyMsg.json]
                    for (const c of candidates) {
                        if (c) {
                            jsonData = typeof c === 'string' ? c : JSON.stringify(c)
                            cardSource = 'reply_field'
                            break
                        }
                    }
                }

                if (!jsonData) {
                    // 返回调试信息帮助诊断
                    return {
                        success: false,
                        error: '引用消息中没有找到卡片内容',
                        note: '请确保回复的是一条包含JSON卡片的消息（如分享链接、小程序等）',
                        debug: {
                            hasReplyMsg: !!replyMsg,
                            segmentCount: msgArray.length,
                            segmentTypes: msgArray.map(s => s.type || 'unknown'),
                            hasRawMessage: !!replyMsg.raw_message
                        }
                    }
                }

                // 确保是字符串
                if (typeof jsonData !== 'string') {
                    jsonData = JSON.stringify(jsonData)
                }
                const jsonSeg = segment.json(jsonData)

                if (args.as_forward) {
                    const senderInfo = replyMsg.sender || {}
                    const nickname =
                        args.forward_nickname ||
                        senderInfo.nickname ||
                        senderInfo.card ||
                        String(senderInfo.user_id || '10000')
                    const forwardResult = await api.sendForward({
                        groupId: args.group_id,
                        userId: args.user_id,
                        nodes: [
                            {
                                user_id: String(senderInfo.user_id || '10000'),
                                nickname,
                                message: [jsonSeg]
                            }
                        ]
                    })
                    return {
                        ...forwardResult,
                        card_source: cardSource,
                        as_forward: true
                    }
                }

                const directResult = await api.send({ groupId: args.group_id, userId: args.user_id, message: jsonSeg })
                return {
                    ...directResult,
                    card_source: cardSource,
                    as_forward: false
                }
            } catch (err) {
                return { success: false, error: `重发引用卡片失败: ${err.message}` }
            }
        }
    },

    {
        name: 'mark_msg_as_read',
        description: '标记消息为已读（NapCat扩展）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                await api.callAction('mark_msg_as_read', { message_id: args.message_id }, { strict: true })
                return { success: true }
            } catch (err) {
                return { success: false, error: `标记已读失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_essence_msg_list',
        description: '获取群精华消息列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const groupId = api.targetId(args.group_id)
                const result = await api.callGroupOrAction({
                    groupId,
                    method: 'getEssence',
                    action: 'get_essence_msg_list'
                })
                const messages = result?.data || result || []
                return { success: true, group_id: groupId, count: messages.length, messages }
            } catch (err) {
                return { success: false, error: `获取精华消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_essence_msg',
        description: '设置群精华消息',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent?.()
                const api = StandardBotApi.fromContext(ctx)
                const groupId = args.group_id || e?.group_id || e?.group?.group_id
                if (groupId) {
                    await api.callGroupOrAction({
                        groupId,
                        method: 'setEssence',
                        args: [args.message_id],
                        action: 'set_essence_msg',
                        params: { message_id: args.message_id }
                    })
                } else {
                    await api.callAction('set_essence_msg', { message_id: args.message_id }, { strict: true })
                }
                return { success: true, message_id: args.message_id, group_id: groupId || null }
            } catch (err) {
                return { success: false, error: `设置精华消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_essence_msg',
        description: '移除群精华消息',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                await api.callAction('delete_essence_msg', { message_id: args.message_id }, { strict: true })
                return { success: true, message_id: args.message_id }
            } catch (err) {
                return { success: false, error: `移除精华消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'poke_user',
        description: '戳一戳用户',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: {
                    type: 'string',
                    description: '目标用户QQ号，"sender"表示戳发送者，"random"表示随机戳一个群成员'
                },
                group_id: { type: 'string', description: '群号（群聊戳一戳时需要）' },
                exclude_bot: { type: 'boolean', description: '随机戳时是否排除机器人，默认true' },
                exclude_self: { type: 'boolean', description: '随机戳时是否排除触发者，默认true' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)

                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                let userId = args.user_id
                const groupId = args.group_id ? api.targetId(args.group_id) : e?.group_id || null

                // 处理特殊值: sender
                if (userId === 'sender') {
                    userId = e?.user_id || e?.sender?.user_id
                    if (!userId) {
                        return { success: false, error: '无法获取发送者ID' }
                    }
                }
                // 处理特殊值: random - 随机选择群成员
                else if (userId === 'random') {
                    if (!groupId) {
                        return { success: false, error: '随机戳一戳仅在群聊中有效' }
                    }

                    const botId = api.getBotInfo().user_id
                    const memberList = await api.getMemberList(groupId)

                    if (memberList.length === 0) {
                        return { success: false, error: '获取群成员列表失败' }
                    }

                    const excludeUsers = []
                    if (args.exclude_self !== false) excludeUsers.push(String(e?.user_id))

                    const candidates = filterMembers(memberList, {
                        excludeBot: args.exclude_bot !== false,
                        excludeUsers,
                        botId
                    })

                    if (candidates.length === 0) {
                        return { success: false, error: '没有符合条件的群成员可供选择' }
                    }

                    const selected = randomSelectMembers(candidates, 1)[0]
                    userId = selected.user_id || selected.uid
                }

                userId = api.targetId(userId)
                if (groupId) {
                    await api.pokeMember(groupId, userId)
                    return { success: true, user_id: userId, group_id: groupId, type: 'group' }
                }
                await api.pokeUser(userId)
                return { success: true, user_id: userId, type: 'private' }
            } catch (err) {
                return { success: false, error: `戳一戳失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_msg_emoji_like',
        description: '对消息发送表情回应（表情贴）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '目标消息ID，不填则使用当前消息' },
                emoji_id: {
                    type: 'string',
                    description:
                        '表情ID。经典: 76(赞) 77(踩) 66(爱心) 63(玫瑰) 179(doge)。Unicode: 128077(👍) 128078(👎) 128514(😂) 128525(😍)'
                },
                set: { type: 'boolean', description: '是否设置（true=添加回应，false=取消回应），默认true' }
            },
            required: ['emoji_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)

                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const messageId = args.message_id || e?.message_id
                if (!messageId) {
                    return { success: false, error: '需要指定消息ID' }
                }

                const emojiId = String(args.emoji_id)
                const isSet = args.set !== false
                await api.setReaction({
                    messageId,
                    emojiId,
                    isSet,
                    groupId: e?.group_id,
                    sequence: e?.seq || e?.source?.seq
                })
                return {
                    success: true,
                    message_id: messageId,
                    emoji_id: emojiId,
                    action: isSet ? 'add' : 'remove'
                }
            } catch (err) {
                return { success: false, error: `表情回应失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_msg',
        description: '获取消息详情。支持 OneBot/NapCat message_id、icqq 群 seq、私聊时间戳，以及当前会话上下文回退。',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID；icqq 可传完整 message_id 或 seq/time' },
                group_id: { type: 'string', description: '群号；配合 seq 获取群消息' },
                user_id: { type: 'string', description: '用户QQ号；配合 time 获取私聊消息' },
                seq: { type: 'string', description: '群消息 seq；QQBot 传 message_id' },
                time: { type: 'number', description: 'icqq 私聊消息时间戳' },
                count: { type: 'number', description: '历史记录回退查找条数，默认20' },
                include_raw: { type: 'boolean', description: '是否返回原始消息对象' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent?.()
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) return { success: false, error: '无法获取Bot实例' }

                const messageId = args.message_id || e?.message_id
                const groupId = args.group_id ? api.targetId(args.group_id) : e?.group_id
                const userId = args.user_id ? api.targetId(args.user_id) : e?.user_id
                const seq =
                    args.seq ??
                    (messageId && /^\d+$/.test(String(messageId))
                        ? api.isQQBot
                            ? String(messageId)
                            : Number(messageId)
                        : undefined)
                const time = args.time ?? undefined
                const count = Math.min(Math.max(Number(args.count || 20), 1), 50)
                let msg = null
                let source = 'standard.getMessage'

                if (messageId) {
                    msg = await api.getMessage(messageId, { groupId, userId })
                } else if (groupId) {
                    const sequence = api.historySequence(seq ?? e?.seq ?? e?.message_seq ?? e?.message_id, 0)
                    const history = await api.getHistory({ groupId, sequence, count })
                    msg = seq
                        ? history.find(item => {
                              const messageSequence = item.seq || item.message_seq || item.message_id
                              return api.sameHistorySequence(messageSequence, sequence)
                          }) || history.at(-1)
                        : history.at(-1)
                    source = 'standard.groupHistory'
                } else if (userId) {
                    const sequence = api.historySequence(time, 0)
                    const history = await api.getHistory({ userId, sequence, count })
                    msg = time
                        ? history.find(item => api.sameHistorySequence(item.time, sequence)) || history[0]
                        : history[0]
                    source = 'standard.privateHistory'
                }

                if (!msg) return { success: false, error: '获取消息失败或消息不存在' }

                const data = msg.data || msg
                const result = {
                    success: true,
                    source,
                    message_id: data.message_id || messageId || '',
                    seq: data.seq || data.message_seq || 0,
                    rand: data.rand || 0,
                    group_id: data.group_id || groupId || '',
                    sender: {
                        user_id: data.sender?.user_id || data.user_id || 0,
                        nickname: data.sender?.nickname || data.sender?.card || data.nickname || ''
                    },
                    time: data.time || 0,
                    message_type: data.message_type || (data.group_id || groupId ? 'group' : 'private'),
                    content: parseForwardContent(data.message || data.content || []),
                    raw_message: data.raw_message || ''
                }
                if (args.include_raw) result.raw = data
                return result
            } catch (err) {
                return { success: false, error: `获取消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_raw_message',
        description: '发送原始消息段数组。支持直接构造消息段发送，适合发送复杂的混合消息（文本+图片+@等）。',
        inputSchema: {
            type: 'object',
            properties: {
                segments: {
                    type: 'array',
                    description:
                        '消息段数组，每个元素为 {type, data} 格式。支持的类型: text, image, at, face, record, video, json, xml, markdown, mface, poke, reply 等',
                    items: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', description: '消息类型' },
                            data: { type: 'object', description: '消息数据' }
                        },
                        required: ['type']
                    }
                },
                group_id: { type: 'string', description: '群号（发送到指定群）' },
                user_id: { type: 'string', description: '用户QQ号（发送私聊）' }
            },
            required: ['segments']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                if (!args.segments || args.segments.length === 0) {
                    return { success: false, error: '消息段数组不能为空' }
                }

                const segments = normalizeStandardMessage(args.segments)

                const result = await api.send({
                    groupId: args.group_id,
                    userId: args.user_id,
                    message: segments
                })

                return {
                    success: true,
                    message_id: result.message_id,
                    segment_count: segments.length
                }
            } catch (err) {
                return { success: false, error: `发送原始消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_card',
        description:
            '【统一】发送卡片消息。支持链接卡片、大图卡片、新闻卡片、自定义JSON/XML卡片。合并了 send_json_card/send_xml_card/send_link_card/send_ark_card 功能。',
        inputSchema: {
            type: 'object',
            properties: {
                template: {
                    type: 'string',
                    description:
                        '模板类型: link(链接卡片), image(大图卡片), news(新闻卡片), json(自定义JSON), xml(XML卡片)',
                    enum: ['link', 'image', 'news', 'json', 'xml']
                },
                title: { type: 'string', description: '标题（link/image/news模板）' },
                desc: { type: 'string', description: '描述（link/news模板）' },
                url: { type: 'string', description: '跳转链接（link/news模板）' },
                image: { type: 'string', description: '图片URL（link/image/news模板）' },
                source: { type: 'string', description: '来源名称（link/news模板）' },
                data: { type: 'string', description: '自定义数据（json/xml模板时使用）' },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['template']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                let cardData = null
                let cardType = 'json'

                switch (args.template) {
                    case 'link':
                        cardData = buildLinkCard(
                            args.title || '',
                            args.desc || '',
                            args.url || '',
                            args.image || '',
                            args.source || ''
                        )
                        break
                    case 'image':
                        cardData = buildBigImageCard(args.image || '', args.title || '', args.desc || '')
                        break
                    case 'news':
                        cardData = {
                            app: 'com.tencent.structmsg',
                            desc: args.source || '',
                            view: 'news',
                            ver: '0.0.0.1',
                            prompt: `[${args.source || '资讯'}] ${args.title || ''}`,
                            meta: {
                                news: {
                                    action: '',
                                    app_type: 1,
                                    appid: 100951776,
                                    desc: args.desc || '',
                                    jumpUrl: args.url || '',
                                    preview: args.image || '',
                                    tag: args.source || '',
                                    title: args.title || ''
                                }
                            }
                        }
                        break
                    case 'json':
                        if (!args.data) {
                            return { success: false, error: 'json模板需要提供data参数' }
                        }
                        try {
                            cardData = typeof args.data === 'string' ? JSON.parse(args.data) : args.data
                        } catch {
                            return { success: false, error: 'data格式错误，需要有效的JSON' }
                        }
                        break
                    case 'xml':
                        if (!args.data) {
                            return { success: false, error: 'xml模板需要提供data参数' }
                        }
                        cardType = 'xml'
                        cardData = args.data
                        break
                    default:
                        return { success: false, error: '不支持的模板类型' }
                }

                const result = await api.send({
                    groupId: args.group_id ? api.targetId(args.group_id) : null,
                    userId: args.user_id ? api.targetId(args.user_id) : null,
                    message: cardType === 'json' ? segment.json(cardData) : segment.xml(cardData)
                })

                // 解析卡片信息
                const cardInfo = cardType === 'json' ? parseCardData(cardData) : { type: 'xml' }

                return {
                    ...result,
                    template: args.template,
                    card_type: cardInfo.type
                }
            } catch (err) {
                return { success: false, error: `发送Ark卡片失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_markdown',
        description: '发送Markdown消息（NapCat/TRSS支持）',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Markdown内容' },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const mdSeg = segment.markdown(args.content)
                const result = await api.send({ groupId: args.group_id, userId: args.user_id, message: mdSeg })

                return {
                    success: true,
                    message_id: result.message_id
                }
            } catch (err) {
                return { success: false, error: `发送Markdown失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_button',
        description: '发送按钮消息（NapCat扩展）',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '消息文本内容' },
                buttons: {
                    type: 'array',
                    description: '按钮列表',
                    items: {
                        type: 'object',
                        properties: {
                            text: { type: 'string', description: '按钮文字' },
                            data: { type: 'string', description: '按钮数据/回调' },
                            type: {
                                type: 'string',
                                description: '按钮类型: input(输入回调), link(链接), callback(回调)'
                            }
                        },
                        required: ['text']
                    }
                },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['buttons']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const message = []
                if (args.content) message.push(segment.text(args.content))

                const buttonRow = args.buttons.map(button => ({
                    text: button.text,
                    ...(button.type === 'link'
                        ? { link: button.data || button.text }
                        : button.type === 'callback'
                          ? { callback: button.data || button.text }
                          : { input: button.data || button.text, send: true })
                }))
                message.push(segment.button(buttonRow))

                const result = await api.send({ groupId: args.group_id, userId: args.user_id, message })

                return {
                    success: true,
                    message_id: result.message_id,
                    button_count: args.buttons.length
                }
            } catch (err) {
                return { success: false, error: `发送按钮消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'call_api',
        description: '直接调用Bot API（NapCat/OneBot扩展）。可以调用任意API，适合使用未封装的高级功能。',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'API名称，如 send_group_msg, get_group_info, set_group_card 等'
                },
                params: { type: 'object', description: 'API参数对象' }
            },
            required: ['action']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                api.requireCapability('onebot_action')
                const result = await api.callAction(args.action, args.params || {}, { strict: true })

                return {
                    success: true,
                    action: args.action,
                    result: result?.data || result
                }
            } catch (err) {
                return { success: false, error: `调用API失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_long_msg',
        description: '发送长消息（NapCat扩展）。将多条消息合并为长消息发送。',
        inputSchema: {
            type: 'object',
            properties: {
                messages: {
                    type: 'array',
                    description: '消息列表，每条消息为字符串或消息段数组',
                    items: {
                        oneOf: [
                            { type: 'string' },
                            {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        type: { type: 'string', description: '消息段类型，如 text, image, at 等' },
                                        data: { type: 'object', description: '消息段数据' }
                                    },
                                    required: ['type', 'data']
                                }
                            }
                        ]
                    }
                },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['messages']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const botInfo = api.getBotInfo()
                const nodes = args.messages.map(message => ({
                    user_id: String(botInfo.user_id || '10000'),
                    nickname: botInfo.nickname || 'Bot',
                    message
                }))
                const result = await api.sendForward({
                    groupId: args.group_id || (!args.user_id ? e?.group_id : null),
                    userId: args.user_id || (!args.group_id ? e?.user_id : null),
                    nodes
                })

                return {
                    success: true,
                    message_id: result.message_id,
                    res_id: result.result?.res_id || result.result?.data?.res_id,
                    message_count: args.messages.length
                }
            } catch (err) {
                return { success: false, error: `发送长消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_msg_reactions',
        description: '获取消息的表情回应列表（NapCat扩展）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' },
                group_id: { type: 'string', description: '群号' }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                const groupId = args.group_id || e?.group_id

                const result = await api.callAction(
                    'get_group_msg_history',
                    {
                        group_id: api.targetId(groupId),
                        message_id: args.message_id
                    },
                    { strict: true }
                )

                return {
                    success: true,
                    message_id: args.message_id,
                    reactions: result?.data?.reactions || result?.reactions || []
                }
            } catch (err) {
                return { success: false, error: `获取表情回应失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_long_message',
        description: '直接发送长消息。支持多种模式：forward、direct、auto',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '长消息内容（可超过单条消息长度限制）' },
                mode: {
                    type: 'string',
                    description: '发送模式: forward, direct, auto',
                    enum: ['forward', 'direct', 'auto']
                },
                chunk_size: { type: 'number', description: '分段大小(字符数)，默认2000' },
                sender_name: { type: 'string', description: '转发消息中显示的发送者名称' },
                prompt: { type: 'string', description: '转发卡片标题（forward模式）' },
                summary: { type: 'string', description: '转发卡片摘要（forward模式）' },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const content = args.content || ''
                const mode = args.mode || 'forward'
                const chunkSize = args.chunk_size || 2000
                const botInfo = api.getBotInfo()
                const botId = botInfo.user_id || '10000'
                const senderName = args.sender_name || botInfo.nickname || 'Bot'

                // 分割长消息
                const chunks = []
                for (let i = 0; i < content.length; i += chunkSize) {
                    chunks.push(content.slice(i, i + chunkSize))
                }

                const hasExplicitGroup = Boolean(args.group_id)
                const hasExplicitUser = Boolean(args.user_id)
                const targetGroupId = hasExplicitGroup
                    ? api.targetId(args.group_id)
                    : hasExplicitUser
                      ? null
                      : e?.group_id
                const targetUserId = hasExplicitUser
                    ? api.targetId(args.user_id)
                    : hasExplicitGroup || targetGroupId
                      ? null
                      : e?.user_id
                // 根据模式选择发送方式
                const actualMode = mode === 'auto' ? (content.length > 3000 ? 'forward' : 'direct') : mode

                if (actualMode === 'direct') {
                    const results = []
                    for (let i = 0; i < chunks.length; i++) {
                        try {
                            const sent = await api.send({
                                groupId: targetGroupId,
                                userId: targetUserId,
                                message: chunks.length > 1 ? `[${i + 1}/${chunks.length}]\n${chunks[i]}` : chunks[i]
                            })
                            results.push({
                                index: i + 1,
                                success: true,
                                message_id: sent.message_id
                            })

                            // 分段发送间隔
                            if (i < chunks.length - 1) {
                                await new Promise(r => setTimeout(r, 500))
                            }
                        } catch (err) {
                            results.push({ index: i + 1, success: false, error: err.message })
                        }
                    }

                    return {
                        success: results.some(r => r.success),
                        mode: 'direct',
                        chunk_count: chunks.length,
                        results
                    }
                }
                const result = await api.sendForward({
                    groupId: targetGroupId,
                    userId: targetUserId,
                    nodes: chunks.map((chunk, index) => ({
                        user_id: String(botId),
                        nickname: senderName,
                        message: chunks.length > 1 ? `[${index + 1}/${chunks.length}]\n${chunk}` : chunk
                    })),
                    display: { prompt: args.prompt, summary: args.summary }
                })
                return {
                    ...result,
                    mode: 'forward',
                    chunk_count: chunks.length,
                    total_length: content.length
                }
            } catch (err) {
                return { success: false, error: `发送长消息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_protocol_packet',
        description:
            '发送底层协议包。支持 icqq 的 sendOidb、sendUni、sendOidbSvcTrpcTcp、writeUni、sendPacket、sendMergeUni 和 OneBot 扩展 API。',
        inputSchema: {
            type: 'object',
            properties: {
                pb_data: { type: 'string', description: '包体数据，默认按 base64 解析；也可传 JSON 字符串' },
                pb_type: {
                    type: 'string',
                    description: '命令名，如 OidbSvc.0x568_22、OidbSvcTrpcTcp.0xf5b_1、MsgProxy.SendMsg'
                },
                cmd: { type: 'string', description: '协议命令名，优先级高于 pb_type' },
                method: {
                    type: 'string',
                    enum: [
                        'auto',
                        'send_oidb',
                        'send_oidb_svc_trpc_tcp',
                        'send_uni',
                        'write_uni',
                        'send_packet',
                        'send_merge_uni',
                        'send_api',
                        'onebot'
                    ],
                    description: '发送方法，默认 auto'
                },
                body_encoding: {
                    type: 'string',
                    enum: ['auto', 'base64', 'hex', 'json', 'text', 'utf8'],
                    description: '包体编码，默认 auto'
                },
                encode_json: { type: 'boolean', description: 'JSON 包体是否用 icqq pb.encode 编码，默认 true' },
                decode_response: { type: 'boolean', description: '是否尝试解码 Buffer 响应，默认 true' },
                timeout: { type: 'number', description: '等待响应超时秒数，默认 6；write_uni 不等待' },
                seq: { type: 'number', description: 'sendPacket/writeUni 自定义 seq，默认自动生成' },
                packet_type: { type: 'number', description: 'sendPacket build.type，默认 0xb' },
                encrypt: { type: 'number', description: 'sendPacket build.encrypt，默认 0x1' },
                extra: { type: 'object', description: 'icqq 发包 extra 参数' },
                packets: {
                    type: 'array',
                    description: 'send_merge_uni 使用的包列表 [{cmd, body, body_encoding, need_response}]',
                    items: {
                        type: 'object',
                        properties: {
                            cmd: { type: 'string', description: '单个包使用的协议命令名' },
                            body: {
                                oneOf: [{ type: 'string' }, { type: 'object' }],
                                description:
                                    '单个包的包体数据，支持 base64/JSON 字符串或对象，默认按 body_encoding 解析'
                            },
                            pb_data: { type: 'string', description: 'body 的别名，可传 base64 或 JSON 字符串' },
                            body_encoding: {
                                type: 'string',
                                enum: ['auto', 'base64', 'hex', 'json', 'text', 'utf8'],
                                description: '单个包的包体编码，默认继承外层 body_encoding'
                            },
                            seq: { type: 'number', description: '单个包自定义 seq' },
                            need_response: { type: 'boolean', description: '是否等待该包响应，默认 true' },
                            needResp: { type: 'boolean', description: 'need_response 的兼容写法' }
                        }
                    }
                },
                params: { type: 'object', description: 'send_api/onebot 模式下透传给标准低层动作边界的参数' },
                action: { type: 'string', description: 'send_api/onebot 模式下调用的 API 名称，默认 send_pb_msg' },
                group_id: { type: 'string', description: 'OneBot 扩展 API 的目标群号' },
                user_id: { type: 'string', description: 'OneBot 扩展 API 的目标用户 QQ 号' }
            }
        },
        handler: async (args, ctx) => {
            try {
                return await handleProtocolPacket(args, ctx)
            } catch (err) {
                return { success: false, error: `发送协议包失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_pb_message',
        description: '发送 Protobuf/OIDB/Uni/SSO 协议包，等同于 send_protocol_packet。',
        inputSchema: {
            type: 'object',
            properties: {
                pb_data: { type: 'string', description: '包体数据，默认按 base64 解析；也可传 JSON 字符串' },
                pb_type: {
                    type: 'string',
                    description: '命令名，如 OidbSvc.0x568_22、OidbSvcTrpcTcp.0xf5b_1、MsgProxy.SendMsg'
                },
                cmd: { type: 'string', description: '协议命令名，优先级高于 pb_type' },
                method: { type: 'string', description: '发送方法，默认 auto' },
                body_encoding: { type: 'string', description: '包体编码，默认 auto' },
                encode_json: { type: 'boolean', description: 'JSON 包体是否用 icqq pb.encode 编码，默认 true' },
                decode_response: { type: 'boolean', description: '是否尝试解码 Buffer 响应，默认 true' },
                timeout: { type: 'number', description: '等待响应超时秒数，默认 6' },
                seq: { type: 'number', description: 'sendPacket/writeUni 自定义 seq' },
                extra: { type: 'object', description: 'icqq 发包 extra 参数' },
                packets: {
                    type: 'array',
                    description: 'send_merge_uni 使用的包列表',
                    items: {
                        type: 'object',
                        properties: {
                            cmd: { type: 'string', description: '单个包使用的协议命令名' },
                            body: {
                                oneOf: [{ type: 'string' }, { type: 'object' }],
                                description:
                                    '单个包的包体数据，支持 base64/JSON 字符串或对象，默认按 body_encoding 解析'
                            },
                            pb_data: { type: 'string', description: 'body 的别名，可传 base64 或 JSON 字符串' },
                            body_encoding: {
                                type: 'string',
                                description: '单个包的包体编码，默认继承外层 body_encoding'
                            },
                            seq: { type: 'number', description: '单个包自定义 seq' },
                            need_response: { type: 'boolean', description: '是否等待该包响应，默认 true' },
                            needResp: { type: 'boolean', description: 'need_response 的兼容写法' }
                        }
                    }
                },
                params: { type: 'object', description: 'send_api/onebot 模式下透传参数' },
                action: { type: 'string', description: 'send_api/onebot 模式下调用的 API 名称' }
            }
        },
        handler: async (args, ctx) => {
            try {
                return await handleProtocolPacket(args, ctx)
            } catch (err) {
                return { success: false, error: `发送协议包失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_forward_direct',
        description: '直接发送转发消息',
        inputSchema: {
            type: 'object',
            properties: {
                messages: {
                    type: 'array',
                    description: '消息列表',
                    items: {
                        oneOf: [{ type: 'string' }, { type: 'object' }]
                    }
                },
                interval: { type: 'number', description: '消息间隔(ms)，默认300' },
                group_id: { type: 'string', description: '目标群号' },
                user_id: { type: 'string', description: '目标用户QQ号' }
            },
            required: ['messages']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const hasExplicitGroup = Boolean(args.group_id)
                const hasExplicitUser = Boolean(args.user_id)
                const targetGroupId = hasExplicitGroup
                    ? api.targetId(args.group_id)
                    : hasExplicitUser
                      ? null
                      : e?.group_id
                const targetUserId = hasExplicitUser
                    ? api.targetId(args.user_id)
                    : hasExplicitGroup || targetGroupId
                      ? null
                      : e?.user_id
                const interval = args.interval || 300
                const results = []
                for (let i = 0; i < args.messages.length; i++) {
                    const msg = args.messages[i]
                    try {
                        // 处理消息格式
                        let message = msg
                        if (typeof msg === 'string') {
                            message = [segment.text(msg)]
                        } else if (msg.message) {
                            message = typeof msg.message === 'string' ? [segment.text(msg.message)] : msg.message
                        } else if (!Array.isArray(msg)) {
                            message = [msg]
                        }

                        const sent = await api.send({ groupId: targetGroupId, userId: targetUserId, message })
                        results.push({
                            index: i,
                            success: true,
                            message_id: sent.message_id
                        })

                        // 发送间隔
                        if (i < args.messages.length - 1 && interval > 0) {
                            await new Promise(r => setTimeout(r, interval))
                        }
                    } catch (err) {
                        results.push({
                            index: i,
                            success: false,
                            error: err.message
                        })
                    }
                }

                const successCount = results.filter(r => r.success).length
                return {
                    success: successCount > 0,
                    total: args.messages.length,
                    success_count: successCount,
                    results
                }
            } catch (err) {
                return { success: false, error: `直接发送转发失败: ${err.message}` }
            }
        }
    },

    {
        name: 'make_forward_msg',
        description: '构造转发消息节点。返回构造好的节点数据，可用于后续发送或嵌套。',
        inputSchema: {
            type: 'object',
            properties: {
                messages: {
                    type: 'array',
                    description: '消息列表 [{user_id, nickname, message}]',
                    items: {
                        type: 'object',
                        properties: {
                            user_id: { type: 'string', description: '发送者QQ号' },
                            nickname: { type: 'string', description: '发送者昵称' },
                            message: { type: 'string', description: '消息内容' },
                            time: { type: 'number', description: '时间戳（可选）' }
                        }
                    }
                },
                format: { type: 'string', description: '兼容旧参数；输出始终为 standard' }
            },
            required: ['messages']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const botInfo = api.getBotInfo()
                const nodes = args.messages.map(msg =>
                    segment.nodeItem(
                        msg.user_id || botInfo.user_id || '10000',
                        msg.nickname || botInfo.nickname || 'Bot',
                        msg.message || '',
                        msg.time
                    )
                )
                return {
                    success: true,
                    format: 'standard',
                    nodes,
                    forward_msg: segment.node(nodes),
                    node_count: nodes.length
                }
            } catch (err) {
                return { success: false, error: `构造转发节点失败: ${err.message}` }
            }
        }
    }
]

/**
 * 解析转发消息内容
 * @param {Array} content - 消息段数组
 * @returns {string} 解析后的文本
 */
function parseForwardContent(content) {
    if (!Array.isArray(content)) {
        return String(content || '')
    }

    return content
        .map(seg => {
            const type = seg.type
            const data = seg.data || seg

            switch (type) {
                case 'text':
                    return data.text || ''
                case 'image':
                    return '[图片]'
                case 'face':
                    return `[表情:${data.id}]`
                case 'at':
                    return `@${data.name || data.qq}`
                case 'record':
                case 'audio':
                    return '[语音]'
                case 'video':
                    return '[视频]'
                case 'file':
                    return `[文件:${data.name || ''}]`
                case 'forward':
                    return '[转发消息]'
                case 'markdown':
                    return data.content || '[Markdown]'
                case 'mface':
                    return `[商城表情:${data.summary || ''}]`
                case 'json':
                    return '[卡片消息]'
                case 'xml':
                    return '[XML消息]'
                case 'poke':
                    return '[戳一戳]'
                default:
                    return `[${type}]`
            }
        })
        .join('')
}

/**
 * 转发消息完整数据提取工具
 * 用于从转发消息中提取 pb/pbelem/msgrecord 等底层数据
 */
export const forwardDataTools = [
    {
        name: 'extract_forward_data',
        description:
            '提取合并转发消息的完整底层数据。支持提取 pb(protobuf)、pbelem、msgrecord 等数据，可用于消息重发、数据分析等场景。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: '转发消息ID（res_id）' },
                include_proto: { type: 'boolean', description: '是否包含 protobuf 原始数据（icqq）' },
                include_serialized: { type: 'boolean', description: '是否包含序列化后的 base64 数据' },
                include_msgrecord: { type: 'boolean', description: '是否包含完整消息记录' },
                max_depth: { type: 'number', description: '嵌套转发最大解析深度（默认10）' },
                flatten_nested: { type: 'boolean', description: '是否展平嵌套转发为一维数组' }
            },
            required: ['id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)

                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                // 使用增强型解析器
                const parseResult = await ForwardMessageParser.parse(e, args.id, {
                    extractProto: args.include_proto !== false,
                    extractSerialized: args.include_serialized !== false,
                    maxDepth: clampDeepParseDepth(args.max_depth, 10)
                })

                if (!parseResult.success) {
                    return {
                        success: false,
                        error: '解析转发消息失败',
                        errors: parseResult.errors,
                        method_tried: parseResult.method
                    }
                }

                // 构建完整数据
                const result = {
                    success: true,
                    total_count: parseResult.totalCount,
                    parse_method: parseResult.method,
                    messages: []
                }

                // 展平嵌套的辅助函数
                const flattenMessages = (messages, depth = 0) => {
                    const flat = []
                    for (const msg of messages) {
                        flat.push({
                            ...msg,
                            _depth: depth
                        })
                        if (msg.nested_forward?.messages) {
                            flat.push(...flattenMessages(msg.nested_forward.messages, depth + 1))
                        }
                    }
                    return flat
                }

                // 处理每条消息
                for (const msg of parseResult.messages) {
                    const msgData = {
                        // 基础信息
                        user_id: msg.user_id,
                        nickname: msg.nickname,
                        time: msg.time,
                        group_id: msg.group_id,
                        seq: msg.seq,
                        // 消息内容
                        message: msg.message,
                        raw_message: msg.raw_message
                    }

                    // msgrecord 完整记录
                    if (args.include_msgrecord !== false) {
                        msgData.msgrecord = MsgRecordExtractor.fromForwardNode(msg._raw)
                    }

                    // protobuf 数据
                    if (args.include_proto && msg.proto) {
                        msgData.proto = msg.proto
                        msgData.pb = msg.proto // 别名
                    }

                    // 序列化数据
                    if (args.include_serialized && msg.serialized) {
                        msgData.serialized = msg.serialized
                        msgData.pbelem = msg.serialized // 别名
                    }

                    // 嵌套转发信息
                    if (msg.nested_forward?.success) {
                        msgData.has_nested_forward = true
                        msgData.nested_count = msg.nested_forward.totalCount
                        if (!args.flatten_nested) {
                            msgData.nested_forward = {
                                count: msg.nested_forward.totalCount,
                                method: msg.nested_forward.method,
                                messages: msg.nested_forward.messages?.map(nm => ({
                                    user_id: nm.user_id,
                                    nickname: nm.nickname,
                                    message: nm.message,
                                    proto: args.include_proto ? nm.proto : undefined,
                                    serialized: args.include_serialized ? nm.serialized : undefined
                                }))
                            }
                        }
                    }

                    result.messages.push(msgData)
                }

                // 展平嵌套
                if (args.flatten_nested) {
                    result.messages = flattenMessages(result.messages)
                    result.flattened = true
                }

                // 提取所有图片URL
                result.all_image_urls = ForwardMessageParser.extractImageUrls(parseResult)

                // 整体 proto 数据（如果有）
                if (args.include_proto && parseResult.proto) {
                    result.proto = parseResult.proto
                }

                // 原始数据（调试用）
                if (parseResult.raw) {
                    result._raw_type = typeof parseResult.raw
                    result._raw_keys = Object.keys(parseResult.raw || {})
                }

                return result
            } catch (err) {
                return { success: false, error: `提取转发数据失败: ${err.message}` }
            }
        }
    },

    {
        name: 'deserialize_message',
        description: '反序列化消息数据。将 base64 编码的序列化消息数据还原为完整消息对象（icqq专用）。',
        inputSchema: {
            type: 'object',
            properties: {
                serialized: { type: 'string', description: 'base64 编码的序列化消息数据' },
                type: {
                    type: 'string',
                    enum: ['message', 'forward'],
                    description: '消息类型：message(普通消息) 或 forward(转发消息)'
                },
                uin: { type: 'number', description: '接收者QQ号（私聊消息反序列化需要）' }
            },
            required: ['serialized']
        },
        handler: async args => {
            try {
                const buffer = Buffer.from(args.serialized, 'base64')

                if (args.type === 'forward') {
                    const result = IcqqMessageUtils.deserializeForwardMessage(buffer)
                    if (result) {
                        return {
                            success: true,
                            type: 'forward',
                            data: {
                                user_id: result.user_id,
                                nickname: result.nickname,
                                group_id: result.group_id,
                                time: result.time,
                                seq: result.seq,
                                message: result.message,
                                raw_message: result.raw_message
                            }
                        }
                    }
                } else {
                    const result = IcqqMessageUtils.deserializeMessage(buffer, args.uin)
                    if (result) {
                        return {
                            success: true,
                            type: 'message',
                            data: {
                                message_id: result.message_id,
                                user_id: result.user_id,
                                group_id: result.group_id,
                                time: result.time,
                                seq: result.seq,
                                rand: result.rand,
                                message: result.message,
                                raw_message: result.raw_message,
                                sender: result.sender
                            }
                        }
                    }
                }

                return {
                    success: false,
                    error: '反序列化失败，可能不是有效的 icqq 序列化数据或 icqq 模块不可用'
                }
            } catch (err) {
                return { success: false, error: `反序列化失败: ${err.message}` }
            }
        }
    },

    {
        name: 'decode_protobuf',
        description: '解码 Protobuf 数据。将 base64 编码的 protobuf 数据解码为可读对象（icqq专用）。',
        inputSchema: {
            type: 'object',
            properties: {
                data: { type: 'string', description: 'base64 编码的 protobuf 数据' }
            },
            required: ['data']
        },
        handler: async args => {
            try {
                const result = ProtobufUtils.safeDecode(args.data)
                if (result) {
                    return {
                        success: true,
                        decoded: result
                    }
                }
                return {
                    success: false,
                    error: '解码失败，可能不是有效的 protobuf 数据或 icqq.core.pb 不可用'
                }
            } catch (err) {
                return { success: false, error: `解码失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_message_record',
        description: '获取消息的完整记录数据（msgrecord）。支持从消息ID或当前事件获取。',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID（可选，不填则获取当前消息）' },
                include_proto: { type: 'boolean', description: '是否尝试提取 proto 数据' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)

                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                let msgData = null
                let source = 'unknown'

                if (args.message_id) {
                    msgData = await api.getMessage(args.message_id, {
                        groupId: e?.group_id,
                        userId: e?.user_id
                    })
                    source = 'standard.getMessage'
                } else if (e) {
                    // 从当前事件提取
                    msgData = e
                    source = 'current_event'
                }

                if (!msgData) {
                    return { success: false, error: '无法获取消息数据' }
                }

                // 提取消息记录
                const record =
                    source === 'current_event'
                        ? MsgRecordExtractor.fromEvent(msgData)
                        : MsgRecordExtractor.fromApiResponse(msgData)

                if (!record) {
                    return { success: false, error: '无法提取消息记录' }
                }

                const result = {
                    success: true,
                    source,
                    msgrecord: record
                }

                // 尝试提取 proto
                if (args.include_proto) {
                    const proto = IcqqMessageUtils.extractProto(msgData)
                    if (proto) {
                        result.proto = proto
                    }
                }

                return result
            } catch (err) {
                return { success: false, error: `获取消息记录失败: ${err.message}` }
            }
        }
    }
]
