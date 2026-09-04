/**
 * @fileoverview 标准 Bot 身份、适配器与目标 ID 处理。
 * @module core/platform/StandardBotIdentity
 */

/** QQBot 在 Yunzai-QQBot-Plugin 中公开的精确适配器标识。 */
const QQBOT_ADAPTER_ID = 'QQBot'

/** 已在仓库适配器中出现的精确标识映射。 */
const KNOWN_ADAPTER_TYPES = new Map([
    ['ICQQ', 'icqq'],
    ['icqq', 'icqq'],
    ['NapCat', 'napcat'],
    ['OneBot', 'onebot'],
    ['OneBotv11', 'onebot'],
    ['QQ', 'onebot'],
    ['go-cqhttp', 'go-cqhttp'],
    ['Lagrange', 'lagrange']
])

/**
 * 读取 Yunzai 全局 Bot 容器。
 * @returns {Object|null} Bot 容器
 */
export function getGlobalBotContainer() {
    return typeof globalThis.Bot === 'object' && globalThis.Bot ? globalThis.Bot : null
}

/**
 * 提取事件包装中的 Bot 实例。
 * @param {Object} value - 事件或 Bot
 * @returns {Object|null} Bot 实例
 */
export function getStandardBotInstance(value) {
    return value?.bot || value || null
}

/**
 * 判断目标值是否已提供。
 * @param {*} value - 待判断值
 * @returns {boolean} 是否为非空值
 */
export function hasStandardTarget(value) {
    return value !== null && value !== undefined && value !== ''
}

/**
 * 统一解析显式目标与当前事件目标。
 * 显式私聊目标不会被当前群事件覆盖，所有需要会话目标的标准方法共享同一校验语义。
 * @param {Object|null} event - Yunzai 事件
 * @param {Object} [targets] - 显式目标
 * @param {string|number} [targets.groupId] - 群目标
 * @param {string|number} [targets.userId] - 私聊目标
 * @param {boolean} [required=true] - 是否必须解析出目标
 * @returns {{groupId:string|number|null|undefined,userId:string|number|null|undefined}}
 */
export function resolveStandardTarget(event, { groupId, userId } = {}, required = true) {
    const hasGroup = hasStandardTarget(groupId)
    const hasUser = hasStandardTarget(userId)
    if (hasGroup && hasUser) throw new Error('groupId 与 userId 不能同时提供')

    const resolvedGroupId = hasGroup ? groupId : hasUser ? null : event?.group_id
    const resolvedUserId = hasUser ? userId : hasGroup ? null : event?.user_id
    if (required && !hasStandardTarget(resolvedGroupId) && !hasStandardTarget(resolvedUserId)) {
        throw new Error('需要当前事件或显式 groupId/userId')
    }
    return { groupId: resolvedGroupId, userId: resolvedUserId }
}

/**
 * 判断对象是否为 Yunzai-QQBot-Plugin 的 Bot 实例。
 * @param {Object} value - Bot 或事件
 * @returns {boolean} 是否为 QQBot
 */
export function isQQBotInstance(value) {
    const bot = value?.bot || value
    return (
        bot?.adapter?.id === QQBOT_ADAPTER_ID ||
        bot?.adapter?.name === QQBOT_ADAPTER_ID ||
        bot?.version?.id === QQBOT_ADAPTER_ID ||
        bot?.version?.name === QQBOT_ADAPTER_ID
    )
}

/**
 * 识别已知适配器类别。仅使用仓库中已经存在的精确标识和标准能力。
 * @param {Object} value - Bot 或事件
 * @returns {string} 适配器类别
 */
export function detectStandardAdapter(value) {
    const bot = value?.bot || value || getGlobalBotContainer()
    if (isQQBotInstance(bot)) return 'qqbot'

    const adapterName = bot?.adapter?.name || bot?.version?.name
    if (KNOWN_ADAPTER_TYPES.has(adapterName)) return KNOWN_ADAPTER_TYPES.get(adapterName)

    const adapterId = bot?.adapter?.id || bot?.version?.id
    if (KNOWN_ADAPTER_TYPES.has(adapterId)) return KNOWN_ADAPTER_TYPES.get(adapterId)
    if (typeof bot?.sendApi === 'function') return 'onebot'
    if (typeof bot?.pickGroup === 'function' && typeof bot?.pickFriend === 'function') return 'standard'
    return 'unknown'
}

/**
 * 将目标 ID 转换为适配器要求的类型。
 * QQBot OpenID 永远保留为字符串；其他适配器仅转换安全十进制整数。
 * @param {Object} bot - Bot 实例
 * @param {string|number} targetId - 原始目标 ID
 * @returns {string|number|null|undefined} 标准目标 ID
 */
export function preserveTargetId(bot, targetId) {
    if (!hasStandardTarget(targetId)) return targetId
    if (isQQBotInstance(bot)) return String(targetId)
    if (typeof targetId === 'number') return targetId
    const text = String(targetId).trim()
    if (/^-?\d+$/.test(text)) {
        const numeric = Number(text)
        if (Number.isSafeInteger(numeric)) return numeric
    }
    return targetId
}

/**
 * 判断显式目标是否为当前事件会话。
 * @param {Object} event - Yunzai 事件
 * @param {Object} targets - 显式目标
 * @param {string|number} [targets.groupId] - 群目标
 * @param {string|number} [targets.userId] - 私聊目标
 * @returns {boolean} 是否为当前会话
 */
export function isCurrentStandardTarget(event, { groupId, userId } = {}) {
    if (typeof event?.reply !== 'function') return false
    return matchesCurrentStandardTarget(event, { groupId, userId })
}

/**
 * 判断目标 ID 是否对应当前事件，不要求事件具备 reply。
 * @param {Object} event - Yunzai 事件
 * @param {Object} targets - 显式目标
 * @returns {boolean} 是否为当前目标
 */
export function matchesCurrentStandardTarget(event, { groupId, userId } = {}) {
    if (!event) return false
    if (!hasStandardTarget(groupId) && !hasStandardTarget(userId)) return true
    if (hasStandardTarget(groupId)) {
        const expected = String(groupId)
        return [event.group_id, event._raw_group_id].filter(hasStandardTarget).some(value => String(value) === expected)
    }
    if (!hasStandardTarget(event.group_id) && hasStandardTarget(userId)) {
        const expected = String(userId)
        return [event.user_id, event._raw_user_id].filter(hasStandardTarget).some(value => String(value) === expected)
    }
    return false
}
