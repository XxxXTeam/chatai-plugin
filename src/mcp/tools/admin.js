/**
 * 群管理工具
 * 禁言、踢人、设置群名片等管理功能
 */

import { StandardBotApi } from '../../core/platform/index.js'

/** 批量操作单次允许处理的最大条目数，超出直接拒绝，避免长时间阻塞与请求超时 */
const MAX_BATCH_ENTRIES = 50

/** 禁言时长上限（秒），QQ 侧最长 30 天 */
const MAX_MUTE_DURATION = 30 * 24 * 3600

/** 批量设置群名片时每条之间的间隔（毫秒），规避协议端频率限制 */
const CARD_BATCH_INTERVAL_MS = 700

/**
 * 延时
 * @param {number} ms - 毫秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 解析并校验用户/群目标 ID。
 * @param {string|number} value - 原始值
 * @param {StandardBotApi} api - 标准 Bot API
 * @returns {string|number|null} 合法目标 ID；非法时为 null
 */
function parseTargetId(value, api) {
    if (value === null || value === undefined || value === '') return null
    return api.targetId(value)
}

/**
 * 解析并校验禁言时长
 * @param {number|string} [value] - 原始值，未提供时按 0（解除禁言）处理
 * @returns {number|null} 归一化到 [0, MAX_MUTE_DURATION] 的秒数；非法时为 null
 */
function parseMuteDuration(value) {
    if (value === undefined || value === null || value === '') return 0
    const duration = Number(value)
    if (!Number.isFinite(duration)) return null
    return Math.min(Math.max(duration, 0), MAX_MUTE_DURATION)
}

/**
 * 取得并校验群号
 * @description 从显式参数或当前事件获取群目标，并由标准接口保留协议端要求的 ID 类型。
 * @param {Object} args - 工具入参
 * @param {Object} ctx - 工具上下文
 * @returns {string|number} 合法群目标
 * @throws {Error} 缺少群号或群号格式错误
 */
function resolveGroupId(args, ctx) {
    const api = StandardBotApi.fromContext(ctx)
    const groupId = parseTargetId(args.group_id ?? ctx.getEvent?.()?.group_id, api)
    if (groupId === null) throw new Error('缺少群号 group_id')
    return groupId
}

/**
 * 校验批量条目数量是否超出上限
 * @param {number} count - 条目数
 * @param {string} field - 参数名，用于错误提示
 * @returns {{success: boolean, error: string}|null} 超限时返回错误结果，未超限时为 null
 */
function checkBatchLimit(count, field) {
    if (count > MAX_BATCH_ENTRIES) {
        return {
            success: false,
            error: `批量操作的 ${field} 条目数 ${count} 超过上限 ${MAX_BATCH_ENTRIES}，请分批执行`
        }
    }
    return null
}

/**
 * 判定群公告 Web/OneBot 接口返回体是否表示成功
 * @description 白名单式判定：只有出现明确的成功标识才算成功。
 *              Web API 返回体带 ec 字段（见 helpers._getNoticeListWeb 的 res.ec !== 0 判定），
 *              OneBot 返回体带 retcode/status。返回值为 undefined 或不含任何可识别标识时一律判失败，
 *              避免“没抛异常”被当成公告已发出
 * @param {any} result - 接口返回值
 * @returns {{ok: boolean, error?: string}} 判定结果
 */
function judgeNoticeResult(result) {
    if (result === true) return { ok: true }
    if (!result || typeof result !== 'object') {
        return { ok: false, error: '协议端未返回可识别的结果' }
    }

    if (result.ec === 0 || result.retcode === 0 || result.status === 'ok') return { ok: true }

    const reason = result.em || result.message || result.msg
    if (reason) return { ok: false, error: reason }

    if (typeof result.ec === 'number') return { ok: false, error: `ec=${result.ec}` }
    if (typeof result.retcode === 'number') return { ok: false, error: `retcode=${result.retcode}` }

    return { ok: false, error: '协议端返回中没有可识别的成功标识' }
}

export const adminTools = [
    {
        name: 'mute_member',
        description: '禁言群成员，支持单个或批量禁言（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号（单个禁言时使用）' },
                duration: {
                    type: 'number',
                    description: '禁言时长(秒)，0表示解除禁言，最大30天（单个禁言时使用）'
                },
                mutes: {
                    type: 'object',
                    description: '批量禁言，JSON格式 {"QQ号": 秒数, ...}，例如 {"123456": 600, "789012": 0}，0表示解禁',
                    additionalProperties: { type: 'number' }
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const adapter = api.adapterType
                const groupId = resolveGroupId(args, ctx)

                // 批量禁言模式
                if (args.mutes && typeof args.mutes === 'object') {
                    const results = []
                    const entries = Object.entries(args.mutes)

                    if (entries.length === 0) {
                        return { success: false, error: '批量禁言的 mutes 对象为空' }
                    }
                    const limitError = checkBatchLimit(entries.length, 'mutes')
                    if (limitError) return limitError

                    for (const [userId, duration] of entries) {
                        try {
                            const uid = parseTargetId(userId, api)
                            if (uid === null) {
                                results.push({ user_id: userId, success: false, error: 'QQ号格式错误' })
                                continue
                            }
                            /* 非法时长必须报错而不是静默降级为 0（0 表示解禁，语义完全相反） */
                            const dur = parseMuteDuration(duration)
                            if (dur === null) {
                                results.push({
                                    user_id: userId,
                                    success: false,
                                    error: `禁言时长格式错误: ${duration}`
                                })
                                continue
                            }

                            await api.callGroupOrAction({
                                groupId,
                                method: 'muteMember',
                                args: [uid, dur],
                                action: 'set_group_ban',
                                params: { user_id: uid, duration: dur }
                            })
                            results.push({
                                user_id: userId,
                                duration: dur,
                                action: dur === 0 ? '解禁' : `禁言${dur}秒`,
                                success: true
                            })
                        } catch (err) {
                            results.push({ user_id: userId, success: false, error: err.message })
                        }
                    }

                    const successCount = results.filter(r => r.success).length
                    return {
                        success: successCount > 0,
                        adapter,
                        group_id: groupId,
                        total: entries.length,
                        success_count: successCount,
                        results
                    }
                }

                // 单个禁言模式
                if (!args.user_id) {
                    return { success: false, error: '请提供 user_id（单个禁言）或 mutes（批量禁言）' }
                }

                const userId = parseTargetId(args.user_id, api)
                if (userId === null) {
                    return { success: false, error: `user_id 格式错误: ${args.user_id}` }
                }

                const duration = parseMuteDuration(args.duration)
                if (duration === null) {
                    return { success: false, error: `duration 格式错误: ${args.duration}` }
                }

                await api.callGroupOrAction({
                    groupId,
                    method: 'muteMember',
                    args: [userId, duration],
                    action: 'set_group_ban',
                    params: { user_id: userId, duration }
                })

                return {
                    success: true,
                    adapter,
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
        description: '踢出群成员，支持单个或批量踢人（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号（单个踢人时使用）' },
                user_ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '批量踢人，QQ号数组，例如 ["123456", "789012"]'
                },
                reject_add: { type: 'boolean', description: '是否拒绝再次加群，默认false' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const adapter = api.adapterType
                const groupId = resolveGroupId(args, ctx)
                const rejectAdd = args.reject_add || false

                // 批量踢人模式
                if (args.user_ids && Array.isArray(args.user_ids)) {
                    const results = []

                    if (args.user_ids.length === 0) {
                        return { success: false, error: '批量踢人的 user_ids 数组为空' }
                    }
                    const limitError = checkBatchLimit(args.user_ids.length, 'user_ids')
                    if (limitError) return limitError

                    for (const userId of args.user_ids) {
                        try {
                            const uid = parseTargetId(userId, api)
                            if (uid === null) {
                                results.push({ user_id: userId, success: false, error: 'QQ号格式错误' })
                                continue
                            }

                            await api.kickMember(groupId, uid, rejectAdd)
                            results.push({ user_id: userId, success: true })
                        } catch (err) {
                            results.push({ user_id: userId, success: false, error: err.message })
                        }
                    }

                    const successCount = results.filter(r => r.success).length
                    return {
                        success: successCount > 0,
                        adapter,
                        group_id: groupId,
                        reject_add: rejectAdd,
                        total: args.user_ids.length,
                        success_count: successCount,
                        results
                    }
                }

                // 单个踢人模式
                if (!args.user_id) {
                    return { success: false, error: '请提供 user_id（单个踢人）或 user_ids（批量踢人）' }
                }

                const userId = parseTargetId(args.user_id, api)
                if (userId === null) {
                    return { success: false, error: `user_id 格式错误: ${args.user_id}` }
                }

                await api.kickMember(groupId, userId, rejectAdd)

                return { success: true, adapter, group_id: groupId, user_id: userId }
            } catch (err) {
                return { success: false, error: `踢人失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_card',
        description: '设置群成员名片，支持单个或批量设置',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号（单个设置时使用）' },
                card: { type: 'string', description: '新群名片（单个设置时使用），空字符串表示删除' },
                cards: {
                    type: 'object',
                    description:
                        '批量设置群名片，JSON格式 {"QQ号": "名片", ...}，例如 {"123456": "小明", "789012": "小红"}',
                    additionalProperties: { type: 'string' }
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const adapter = api.adapterType
                const groupId = resolveGroupId(args, ctx)

                // 批量设置模式
                if (args.cards && typeof args.cards === 'object') {
                    const results = []
                    const entries = Object.entries(args.cards)

                    if (entries.length === 0) {
                        return { success: false, error: '批量设置的 cards 对象为空' }
                    }
                    const limitError = checkBatchLimit(entries.length, 'cards')
                    if (limitError) return limitError

                    for (const [userId, card] of entries) {
                        const normalizedCard = card || ''
                        try {
                            const uid = parseTargetId(userId, api)
                            if (uid === null) {
                                results.push({ user_id: userId, success: false, error: 'QQ号格式错误' })
                                continue
                            }

                            await api.callGroupOrAction({
                                groupId,
                                method: 'setCard',
                                args: [uid, normalizedCard],
                                action: 'set_group_card',
                                params: { user_id: uid, card: normalizedCard }
                            })
                            results.push({ user_id: userId, card: normalizedCard, success: true })
                        } catch (err) {
                            results.push({ user_id: userId, success: false, error: err.message })
                        }
                        await sleep(CARD_BATCH_INTERVAL_MS)
                    }

                    const successCount = results.filter(r => r.success).length
                    return {
                        success: successCount > 0,
                        adapter,
                        group_id: groupId,
                        total: entries.length,
                        success_count: successCount,
                        results
                    }
                }

                // 单个设置模式
                if (!args.user_id) {
                    return { success: false, error: '请提供 user_id（单个设置）或 cards（批量设置）' }
                }

                const userId = parseTargetId(args.user_id, api)
                if (userId === null) {
                    return { success: false, error: `user_id 格式错误: ${args.user_id}` }
                }

                /* 归一化后的 card 必须贯穿 icqq 分支、OneBot 分支与返回值，否则不传 card 时两端行为不一致 */
                const card = args.card ?? ''

                await api.callGroupOrAction({
                    groupId,
                    method: 'setCard',
                    args: [userId, card],
                    action: 'set_group_card',
                    params: { user_id: userId, card }
                })

                return { success: true, adapter, group_id: groupId, user_id: userId, card }
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
                const api = StandardBotApi.fromContext(ctx)
                const adapter = api.adapterType
                const groupId = resolveGroupId(args, ctx)

                await api.callGroupOrAction({
                    groupId,
                    method: 'muteAll',
                    args: [args.enable],
                    action: 'set_group_whole_ban',
                    params: { enable: args.enable }
                })

                return {
                    success: true,
                    adapter,
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
        description: '设置/取消群管理员，支持单个或批量设置（需要群主权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号（单个设置时使用）' },
                user_ids: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '批量设置管理员，QQ号数组，例如 ["123456", "789012"]'
                },
                enable: { type: 'boolean', description: 'true设置管理员，false取消管理员' }
            },
            required: ['enable']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const adapter = api.adapterType
                const groupId = resolveGroupId(args, ctx)
                const enable = args.enable

                // 批量设置模式
                if (args.user_ids && Array.isArray(args.user_ids)) {
                    const results = []

                    if (args.user_ids.length === 0) {
                        return { success: false, error: '批量设置的 user_ids 数组为空' }
                    }
                    const limitError = checkBatchLimit(args.user_ids.length, 'user_ids')
                    if (limitError) return limitError

                    for (const userId of args.user_ids) {
                        try {
                            const uid = parseTargetId(userId, api)
                            if (uid === null) {
                                results.push({ user_id: userId, success: false, error: 'QQ号格式错误' })
                                continue
                            }

                            await api.callGroupOrAction({
                                groupId,
                                method: 'setAdmin',
                                args: [uid, enable],
                                action: 'set_group_admin',
                                params: { user_id: uid, enable }
                            })
                            results.push({
                                user_id: userId,
                                action: enable ? '设为管理员' : '取消管理员',
                                success: true
                            })
                        } catch (err) {
                            results.push({ user_id: userId, success: false, error: err.message })
                        }
                    }

                    const successCount = results.filter(r => r.success).length
                    return {
                        success: successCount > 0,
                        adapter,
                        group_id: groupId,
                        action: enable ? '设为管理员' : '取消管理员',
                        total: args.user_ids.length,
                        success_count: successCount,
                        results
                    }
                }

                // 单个设置模式
                if (!args.user_id) {
                    return { success: false, error: '请提供 user_id（单个设置）或 user_ids（批量设置）' }
                }

                const userId = parseTargetId(args.user_id, api)
                if (userId === null) {
                    return { success: false, error: `user_id 格式错误: ${args.user_id}` }
                }

                await api.callGroupOrAction({
                    groupId,
                    method: 'setAdmin',
                    args: [userId, enable],
                    action: 'set_group_admin',
                    params: { user_id: userId, enable }
                })

                return {
                    success: true,
                    adapter,
                    group_id: groupId,
                    user_id: userId,
                    action: enable ? '设为管理员' : '取消管理员'
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
                const api = StandardBotApi.fromContext(ctx)
                const adapter = api.adapterType
                const groupId = resolveGroupId(args, ctx)

                await api.callGroupOrAction({
                    groupId,
                    method: 'setName',
                    args: [args.name],
                    action: 'set_group_name',
                    params: { group_name: args.name }
                })

                return { success: true, adapter, group_id: groupId, name: args.name }
            } catch (err) {
                return { success: false, error: `修改群名称失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_special_title',
        description: '设置群成员专属头衔，支持单个或批量设置（需要群主权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                user_id: { type: 'string', description: '用户QQ号（单个设置时使用）' },
                title: { type: 'string', description: '专属头衔（单个设置时使用），空字符串表示删除' },
                titles: {
                    type: 'object',
                    description:
                        '批量设置头衔，JSON格式 {"QQ号": "头衔", ...}，例如 {"123456": "大佬", "789012": "萌新"}',
                    additionalProperties: { type: 'string' }
                },
                duration: { type: 'number', description: '有效期(秒)，-1表示永久' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const adapter = api.adapterType
                const groupId = resolveGroupId(args, ctx)

                /* -1 表示永久；非法值必须报错，不能静默透传到协议端 */
                const duration =
                    args.duration === undefined || args.duration === null || args.duration === ''
                        ? -1
                        : Number(args.duration)
                if (!Number.isFinite(duration)) {
                    return { success: false, error: `duration 格式错误: ${args.duration}` }
                }

                // 批量设置模式
                if (args.titles && typeof args.titles === 'object') {
                    const results = []
                    const entries = Object.entries(args.titles)

                    if (entries.length === 0) {
                        return { success: false, error: '批量设置的 titles 对象为空' }
                    }
                    const limitError = checkBatchLimit(entries.length, 'titles')
                    if (limitError) return limitError

                    for (const [userId, title] of entries) {
                        try {
                            const uid = parseTargetId(userId, api)
                            if (uid === null) {
                                results.push({ user_id: userId, success: false, error: 'QQ号格式错误' })
                                continue
                            }

                            await api.callGroupOrAction({
                                groupId,
                                method: 'setTitle',
                                args: [uid, title || '', duration],
                                action: 'set_group_special_title',
                                params: { user_id: uid, special_title: title || '', duration }
                            })
                            results.push({ user_id: userId, title: title || '', success: true })
                        } catch (err) {
                            results.push({ user_id: userId, success: false, error: err.message })
                        }
                    }

                    const successCount = results.filter(r => r.success).length
                    return {
                        success: successCount > 0,
                        adapter,
                        group_id: groupId,
                        total: entries.length,
                        success_count: successCount,
                        results
                    }
                }

                // 单个设置模式
                if (!args.user_id) {
                    return { success: false, error: '请提供 user_id（单个设置）或 titles（批量设置）' }
                }

                const userId = parseTargetId(args.user_id, api)
                if (userId === null) {
                    return { success: false, error: `user_id 格式错误: ${args.user_id}` }
                }

                await api.callGroupOrAction({
                    groupId,
                    method: 'setTitle',
                    args: [userId, args.title || '', duration],
                    action: 'set_group_special_title',
                    params: { user_id: userId, special_title: args.title || '', duration }
                })

                return {
                    success: true,
                    adapter,
                    group_id: groupId,
                    user_id: userId,
                    title: args.title || ''
                }
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
                image: { type: 'string', description: '公告图片URL（可选）' },
                pinned: { type: 'boolean', description: '是否置顶，默认false' },
                confirm_required: { type: 'boolean', description: '是否需要群成员确认，默认true' }
            },
            required: ['group_id', 'content']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const groupId = parseTargetId(args.group_id, api)
                if (groupId === null) {
                    return { success: false, error: `group_id 格式错误: ${args.group_id}` }
                }

                const result = await api.sendGroupNotice(groupId, args.content, {
                    image: args.image,
                    pinned: args.pinned || false,
                    confirmRequired: args.confirm_required !== false
                })

                /* 白名单式判定：原先的 !result?.ec 会把 undefined 与任意无 ec 字段的失败返回都当成功 */
                const judged = judgeNoticeResult(result)
                if (judged.ok) {
                    return { success: true, group_id: groupId, content: args.content }
                }

                return { success: false, error: `发送公告失败: ${judged.error}` }
            } catch (err) {
                return { success: false, error: `发送公告失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_group_notice',
        description: '删除群公告（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                notice_id: { type: 'string', description: '公告ID（从获取公告列表获得）' },
                index: { type: 'number', description: '公告序号（1-N），与notice_id二选一' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const groupId = parseTargetId(args.group_id, api)
                if (groupId === null) {
                    return { success: false, error: `group_id 格式错误: ${args.group_id}` }
                }

                if (!args.notice_id && !args.index) {
                    return { success: false, error: '请提供 notice_id 或 index 参数' }
                }

                const fidOrIndex = args.notice_id || args.index
                const result = await api.deleteGroupNotice(groupId, fidOrIndex)

                /* 同 send_group_notice：白名单式判定；取 text 一并改为可选链，避免非对象返回时抛 TypeError */
                const judged = judgeNoticeResult(result)
                if (judged.ok) {
                    return {
                        success: true,
                        group_id: groupId,
                        deleted_notice: result?.text || args.notice_id || `序号${args.index}`
                    }
                }

                return { success: false, error: `删除公告失败: ${judged.error}` }
            } catch (err) {
                return { success: false, error: `删除公告失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_add_request',
        description: '处理加群申请',
        inputSchema: {
            type: 'object',
            properties: {
                flag: { type: 'string', description: '申请标识（从事件获取）' },
                approve: { type: 'boolean', description: '是否同意，默认true' },
                reason: { type: 'string', description: '拒绝理由（仅拒绝时需要）' }
            },
            required: ['flag']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const approve = args.approve !== false
                await api.callAction(
                    'set_group_add_request',
                    { flag: args.flag, approve, reason: args.reason || '' },
                    { strict: true }
                )
                return { success: true, flag: args.flag, approved: approve }
            } catch (err) {
                return { success: false, error: `处理加群申请失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_friend_add_request',
        description: '处理好友申请',
        inputSchema: {
            type: 'object',
            properties: {
                flag: { type: 'string', description: '申请标识（从事件获取）' },
                approve: { type: 'boolean', description: '是否同意，默认true' },
                remark: { type: 'string', description: '好友备注（同意时可设置）' }
            },
            required: ['flag']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const approve = args.approve !== false
                await api.callAction(
                    'set_friend_add_request',
                    { flag: args.flag, approve, remark: args.remark || '' },
                    { strict: true }
                )
                return { success: true, flag: args.flag, approved: approve }
            } catch (err) {
                return { success: false, error: `处理好友申请失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_muted_list',
        description: '获取群禁言列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                const groupId = parseTargetId(args.group_id || e?.group_id, api)

                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }

                const actionResult = await api.callAction('get_group_shut_list', { group_id: groupId })
                const list = actionResult?.data || actionResult
                const now = Math.floor(Date.now() / 1000)
                const source = Array.isArray(list) ? list : await api.getMemberList(groupId)
                const mutedMembers = source
                    .filter(member => (member.shut_up_timestamp || member.shutup_time || member.mute_time || 0) > now)
                    .map(member => {
                        const muteTime = member.shut_up_timestamp || member.shutup_time || member.mute_time
                        return {
                            user_id: member.user_id || member.uin || member.uid,
                            nickname: member.nickname || member.nick || '',
                            card: member.card || '',
                            mute_time: muteTime,
                            remaining: member.remaining_time ?? muteTime - now
                        }
                    })
                return { success: true, group_id: groupId, count: mutedMembers.length, muted_members: mutedMembers }
            } catch (err) {
                return { success: false, error: `获取禁言列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_leave',
        description: '退出群聊（需谨慎使用）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                is_dismiss: { type: 'boolean', description: '是否解散群（仅群主）' },
                confirm: { type: 'boolean', description: '确认退群，必须为true' }
            },
            required: ['group_id', 'confirm']
        },
        handler: async (args, ctx) => {
            try {
                if (args.confirm !== true) {
                    return { success: false, error: '需要确认退群操作' }
                }

                const api = StandardBotApi.fromContext(ctx)
                const groupId = parseTargetId(args.group_id, api)
                if (groupId === null) {
                    return { success: false, error: `group_id 格式错误: ${args.group_id}` }
                }

                await api.callGroupOrAction({
                    groupId,
                    method: 'quit',
                    args: [args.is_dismiss || false],
                    action: 'set_group_leave',
                    params: { is_dismiss: args.is_dismiss || false }
                })
                return { success: true, group_id: groupId, action: args.is_dismiss ? 'dismiss' : 'leave' }
            } catch (err) {
                return { success: false, error: `退群失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_friend',
        description: '删除好友（需谨慎使用）',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' },
                confirm: { type: 'boolean', description: '确认删除，必须为true' }
            },
            required: ['user_id', 'confirm']
        },
        handler: async (args, ctx) => {
            try {
                if (args.confirm !== true) {
                    return { success: false, error: '需要确认删除好友操作' }
                }

                const api = StandardBotApi.fromContext(ctx)
                const userId = parseTargetId(args.user_id, api)
                if (userId === null) {
                    return { success: false, error: `user_id 格式错误: ${args.user_id}` }
                }

                await api.callFriendOrAction({
                    userId,
                    method: 'delete',
                    action: 'delete_friend'
                })
                return { success: true, user_id: userId }
            } catch (err) {
                return { success: false, error: `删除好友失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_portrait',
        description: '设置群头像（需要管理员权限）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file: { type: 'string', description: '图片文件路径或URL' }
            },
            required: ['group_id', 'file']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const groupId = parseTargetId(args.group_id, api)
                if (groupId === null) {
                    return { success: false, error: `group_id 格式错误: ${args.group_id}` }
                }

                await api.callGroupOrAction({
                    groupId,
                    method: 'setAvatar',
                    args: [args.file],
                    action: 'set_group_portrait',
                    params: { file: args.file }
                })
                return { success: true, group_id: groupId }
            } catch (err) {
                return { success: false, error: `设置群头像失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_at_all_remain',
        description: '获取群@全体成员剩余次数',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                const groupId = parseTargetId(args.group_id || e?.group_id, api)

                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }

                const result = await api.callAction('get_group_at_all_remain', { group_id: groupId }, { strict: true })
                const data = result?.data || result
                return {
                    success: true,
                    group_id: groupId,
                    can_at_all: data?.can_at_all ?? true,
                    remain_at_all_count_for_group: data?.remain_at_all_count_for_group,
                    remain_at_all_count_for_uin: data?.remain_at_all_count_for_uin
                }
            } catch (err) {
                return { success: false, error: `获取@全体剩余次数失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_anonymous_ban',
        description: '禁言群匿名成员',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                anonymous_flag: { type: 'string', description: '匿名用户标识（从消息获取）' },
                duration: { type: 'number', description: '禁言时长(秒)，0表示解禁' }
            },
            required: ['group_id', 'anonymous_flag', 'duration']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const groupId = parseTargetId(args.group_id, api)
                if (groupId === null) {
                    return { success: false, error: `group_id 格式错误: ${args.group_id}` }
                }

                const duration = parseMuteDuration(args.duration)
                if (duration === null) {
                    return { success: false, error: `duration 格式错误: ${args.duration}` }
                }

                await api.callAction(
                    'set_group_anonymous_ban',
                    { group_id: groupId, anonymous_flag: args.anonymous_flag, duration },
                    { strict: true }
                )
                return { success: true, group_id: groupId, duration }
            } catch (err) {
                return { success: false, error: `禁言匿名成员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_group_anonymous',
        description: '设置群匿名功能开关',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                enable: { type: 'boolean', description: '是否开启匿名' }
            },
            required: ['group_id', 'enable']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const groupId = parseTargetId(args.group_id, api)
                if (groupId === null) {
                    return { success: false, error: `group_id 格式错误: ${args.group_id}` }
                }

                await api.callGroupOrAction({
                    groupId,
                    method: 'setAnonymous',
                    args: [args.enable],
                    action: 'set_group_anonymous',
                    params: { enable: args.enable }
                })
                return { success: true, group_id: groupId, enabled: args.enable }
            } catch (err) {
                return { success: false, error: `设置匿名功能失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_system_msg',
        description: '获取群系统消息（加群请求、邀请等）',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const result = await api.callAction('get_group_system_msg', {}, { strict: true })
                const data = result?.data || result
                return {
                    success: true,
                    invited_requests: data?.invited_requests || [],
                    join_requests: data?.join_requests || []
                }
            } catch (err) {
                return { success: false, error: `获取群系统消息失败: ${err.message}` }
            }
        }
    }
]
