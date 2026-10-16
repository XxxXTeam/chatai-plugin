import { detectStandardAdapter } from '../../core/platform/StandardBotIdentity.js'
import {
    QQ_MEDIA_KIND_GROUP,
    QQ_MEDIA_KIND_PRIVATE,
    normalizeRkeyValue,
    parseQQMediaUrl,
    replaceRkeyInUrl
} from '../../core/utils/qqMediaUrl.js'

/** OneBot 协议族的适配器类别集合（源码实证：`StandardBotIdentity.js:10-19` 的映射表取值）。 */
const ONEBOT_ADAPTERS = new Set(['onebot', 'napcat', 'go-cqhttp', 'lagrange'])

/** ICQQ 适配器类别（源码实证：`StandardBotIdentity.js:11` 映射 `ICQQ` → `icqq`）。 */
const ICQQ_ADAPTER = 'icqq'

/**
 * OneBot 候选链。
 *
 * 顺序依据：`get_rkey` 是 LLOneBot 注册的 action（源码实证 `ActionName.GetRKey = "get_rkey"`）
 * 且 NapCat 同样提供，覆盖面最广，故排在首位；`nc_get_rkey` 是 NapCat 专有扩展且 NapCat 官方文档
 * 明确推荐用其刷新 rkey，作为回落项。
 *
 * 不含 `get_image` / `get_file` / `get_msg`：这三个 action 的入参形态（需要 file_id 等）与 rkey 接口不同，
 * 不属于同一替换语义，故不纳入本候选链。
 * @type {ReadonlyArray<{id:string,label:string,action:string}>}
 */
const ONEBOT_CANDIDATES = Object.freeze([
    { id: 'onebot:get_rkey', label: 'onebot', action: 'get_rkey' },
    { id: 'onebot:nc_get_rkey', label: 'onebot', action: 'nc_get_rkey' }
])

/**
 * ICQQ 候选链。
 *
 * 顺序依据（源码实证签名）：`refreshNTPicRkey(force?)` 返回 `Promise<{ [type: number]: RkeyInfo }>`，
 * 是唯一直接返回 rkey 值、可用于改写 URL 的方法，故优先；`refreshToken(force?)` 返回
 * `Promise<undefined | boolean>`，只给出布尔结果、拿不到 rkey 值，放在末位仅用于表达"能力存在"。
 *
 * `refreshNTPicRkey` 只存在于 `@icqqjs/icqq`（新版分支），旧版 npm `icqq@0.6.10` 的 `lib/client.d.ts`
 * 只有 `refreshToken`；Yunzai ICQQ 适配器把 Bot 做成 Proxy，`bot.<method>` 会被转发到 `bot.sdk`，
 * 但普通对象形态的 bot 不会转发，因此 bot 层与 sdk 层各留一项候选逐项探测。
 * @type {ReadonlyArray<{id:string,label:string,method:string,viaSdk:boolean}>}
 */
const ICQQ_CANDIDATES = Object.freeze([
    { id: 'icqq:refreshNTPicRkey', label: 'icqq', method: 'refreshNTPicRkey', viaSdk: false },
    { id: 'icqq:sdk.refreshNTPicRkey', label: 'icqq', method: 'refreshNTPicRkey', viaSdk: true },
    { id: 'icqq:refreshToken', label: 'icqq', method: 'refreshToken', viaSdk: false },
    { id: 'icqq:sdk.refreshToken', label: 'icqq', method: 'refreshToken', viaSdk: true }
])

/**
 * rkey 过期安全余量（秒）。
 * NapCat 源码以 `time + Number(ttl) < Date.now()/1000` 判定过期，但网络往返、调用方拼装与重发耗时
 * 会让"临界有效"的 rkey 在实际使用时已经过期，故提前 5 分钟视为不可用。
 */
const RKEY_EXPIRY_SAFETY_MARGIN_SECONDS = 300

/**
 * 响应未提供任何过期信息时的缓存时长（秒）。
 * rkey 实测有效期约 2 小时；取 5 分钟作为保守下限，既不超出真实有效期，也避免每次调用都请求平台接口。
 */
const UNKNOWN_EXPIRY_CACHE_SECONDS = 300

/**
 * 缓存方法的连续失败阈值，达到后清空方法缓存并重走探测链。
 * 取 2 的依据：单次失败可能是瞬时网络或平台抖动；连续两次失败说明该方法在当前 bot 上确已不可用
 * （例如适配器热重载更换了实现），此时重走一次探测链的代价低于继续调用失效方法。
 */
const METHOD_FAILURE_THRESHOLD = 2

/** NapCat 数组形态的 rkey 字段名（源码实证：`{ rkeys: [{ rkey, time, type, ttl }] }`）。 */
const RKEY_ARRAY_FIELD = 'rkeys'

/**
 * 扁平形态与远程服务形态的字段名（源码实证）。
 * LLOneBot 的 `get_rkey` 返回 `private_key` / `group_key`；NapCat 远程 rkey 服务返回 `private_rkey` / `group_rkey`。
 * @type {Record<string, ReadonlyArray<string>>}
 */
const RKEY_FLAT_FIELDS = Object.freeze({
    [QQ_MEDIA_KIND_PRIVATE]: Object.freeze(['private_key', 'private_rkey']),
    [QQ_MEDIA_KIND_GROUP]: Object.freeze(['group_key', 'group_rkey'])
})

/**
 * 数组形态的下标定位（源码实证：NapCat 私聊取 `packetRkey[0]`、群聊取 `packetRkey[1]`）。
 * @type {Record<string, number>}
 */
const RKEY_ARRAY_INDEX = Object.freeze({
    [QQ_MEDIA_KIND_PRIVATE]: 0,
    [QQ_MEDIA_KIND_GROUP]: 1
})

/**
 * 数值 type 到 rkey 类别的候选映射。
 * 未经确证：`@icqqjs/icqq` 的 `RkeyInfo` 字段名与 `type` 取值无法在可核实来源中确认
 * （该包未在 npm 公开发布），10/20 与 1/2 是 QQ 图床 rkey 的常见分组取值。
 * 因此仅在数组下标缺失或数字键对象形态下作为兜底探测，不作为首选判据。
 * @type {Record<string, ReadonlyArray<number>>}
 */
const RKEY_TYPE_CANDIDATES = Object.freeze({
    [QQ_MEDIA_KIND_PRIVATE]: Object.freeze([10, 1]),
    [QQ_MEDIA_KIND_GROUP]: Object.freeze([20, 2])
})

/**
 * 单个节点上 rkey 值的候选字段名。
 * 未经确证：`@icqqjs/icqq` 的 `RkeyInfo` 结构未能核实，故按候选清单探测，命中字符串即采用。
 * @type {ReadonlyArray<string>}
 */
const RKEY_VALUE_FIELDS = Object.freeze(['rkey', 'key'])

/**
 * @typedef {Object} BotCacheEntry
 * @property {{id:string}|null} method - 已探测成功的候选方法
 * @property {number} failures - 缓存方法的连续失败次数
 * @property {Map<string, {rkey:string, expiresAt:number|null, fetchedAt:number}>} rkeys - 按 rkey 类别缓存的值
 */

/**
 * 按 bot 自身标识（`self_id` / `uin`）索引的缓存。
 * 多 Bot 环境下每个账号独立，键取适配器公开的账号标识，避免不同账号共用 rkey。
 * @type {Map<string, BotCacheEntry>}
 */
let botEntriesByKey = new Map()

/**
 * 无稳定账号标识时按 bot 对象索引的缓存。
 * WeakMap 不阻止 bot 实例被回收。
 * @type {WeakMap<Object, BotCacheEntry>}
 */
let botEntriesByObject = new WeakMap()

/**
 * 创建空的 Bot 缓存条目。
 * @returns {BotCacheEntry} 缓存条目
 */
function createBotCacheEntry() {
    return { method: null, failures: 0, rkeys: new Map() }
}

/**
 * 解析 bot 的缓存键。
 * @param {Object} bot - Bot 实例
 * @returns {string|null} 字符串键，无稳定标识时返回 null
 */
function resolveBotCacheKey(bot) {
    const id = bot?.self_id ?? bot?.uin
    if (id === undefined || id === null || id === '') return null
    return String(id)
}

/**
 * 查找已存在的 Bot 缓存条目，不创建新条目。
 * @param {Object} bot - Bot 实例
 * @returns {BotCacheEntry|null} 缓存条目
 */
function findBotCacheEntry(bot) {
    const key = resolveBotCacheKey(bot)
    if (key) return botEntriesByKey.get(key) ?? null
    if (bot && typeof bot === 'object') return botEntriesByObject.get(bot) ?? null
    return null
}

/**
 * 获取 Bot 缓存条目，不存在时创建。
 * @param {Object} bot - Bot 实例
 * @returns {BotCacheEntry} 缓存条目
 */
function getBotCacheEntry(bot) {
    const existing = findBotCacheEntry(bot)
    if (existing) return existing

    const entry = createBotCacheEntry()
    const key = resolveBotCacheKey(bot)
    if (key) botEntriesByKey.set(key, entry)
    else if (bot && typeof bot === 'object') botEntriesByObject.set(bot, entry)
    return entry
}

/**
 * 读取节点的绝对过期时间（秒级时间戳）。
 * 两种已实证语义：NapCat packet 形态用 `time + ttl`（源码即如此判定）；LLOneBot 与远程 rkey 服务用 `expired_time`。
 * @param {*} node - 响应节点
 * @returns {number|null} 绝对秒级时间戳，无法判定时返回 null
 */
function readExpiry(node) {
    if (!node || typeof node !== 'object') return null

    const time = Number(node.time)
    const ttl = Number(node.ttl)
    if (Number.isFinite(time) && time > 0 && Number.isFinite(ttl) && ttl > 0) return time + ttl

    const expiredTime = Number(node.expired_time)
    if (Number.isFinite(expiredTime) && expiredTime > 0) return expiredTime
    return null
}

/**
 * 从单个节点读取 rkey 与过期时间。节点可以是字符串（本身就是 rkey）或对象。
 * @param {*} node - 候选节点
 * @param {number|null} fallbackExpiry - 节点未提供过期信息时使用的绝对秒级时间戳
 * @returns {{rkey:string, expiresAt:number|null}|null} 读取结果
 */
function readRkeyNode(node, fallbackExpiry) {
    if (typeof node === 'string') {
        const value = normalizeRkeyValue(node)
        return value ? { rkey: value, expiresAt: fallbackExpiry } : null
    }
    if (!node || typeof node !== 'object') return null

    for (const field of RKEY_VALUE_FIELDS) {
        const value = normalizeRkeyValue(node[field])
        if (value) return { rkey: value, expiresAt: readExpiry(node) ?? fallbackExpiry }
    }
    return null
}

/**
 * 从平台返回中提取指定类别的 rkey 值与过期时间。
 * 兼容三种已实证的返回形态（NapCat 数组 / LLOneBot 扁平 / 远程服务扁平），
 * 并对未确证的字段名与 type 取值做候选探测。
 * @param {*} payload - 平台返回
 * @param {string} kind - rkey 类别（`private` / `group`）
 * @returns {{rkey:string, expiresAt:number|null}|null} 提取结果，无法提取时返回 null
 */
function extractRkeyEntry(payload, kind) {
    if (payload === null || payload === undefined) return null

    const fallbackExpiry = readExpiry(payload)
    const list = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.[RKEY_ARRAY_FIELD])
          ? payload[RKEY_ARRAY_FIELD]
          : null

    if (list) {
        const indexed = readRkeyNode(list[RKEY_ARRAY_INDEX[kind]], fallbackExpiry)
        if (indexed) return indexed

        for (const type of RKEY_TYPE_CANDIDATES[kind]) {
            const matched = list.find(item => Number(item?.type) === type)
            const entry = readRkeyNode(matched, fallbackExpiry)
            if (entry) return entry
        }
    }

    for (const field of RKEY_FLAT_FIELDS[kind] ?? []) {
        const value = normalizeRkeyValue(payload?.[field])
        if (value) return { rkey: value, expiresAt: fallbackExpiry }
    }

    for (const type of RKEY_TYPE_CANDIDATES[kind]) {
        const entry = readRkeyNode(payload?.[type], fallbackExpiry)
        if (entry) return entry
    }

    return null
}

/**
 * 判断 bot 上是否存在 ICQQ client 的刷新方法。
 * @param {Object} bot - Bot 实例
 * @returns {boolean} 是否存在任一 ICQQ 刷新方法
 */
function hasIcqqRefreshMethod(bot) {
    return ICQQ_CANDIDATES.some(candidate => {
        const holder = candidate.viaSdk ? bot?.sdk : bot
        return typeof holder?.[candidate.method] === 'function'
    })
}

/**
 * 依据适配器类别构建候选链。
 * @param {Object} bot - Bot 实例
 * @returns {ReadonlyArray<Object>} 候选链，无可用能力时为空数组
 */
function buildCandidates(bot) {
    const adapter = detectStandardAdapter(bot)
    if (adapter === ICQQ_ADAPTER) return ICQQ_CANDIDATES
    if (ONEBOT_ADAPTERS.has(adapter)) return ONEBOT_CANDIDATES
    if (typeof bot?.sendApi === 'function') return ONEBOT_CANDIDATES
    if (hasIcqqRefreshMethod(bot)) return ICQQ_CANDIDATES
    return []
}

/**
 * 将异常转换为简短可读文本。
 * @param {*} error - 捕获到的异常
 * @returns {string} 简短描述
 */
function describeError(error) {
    const raw = error instanceof Error ? error.message || error.name || 'error' : String(error)
    return raw.replace(/\s+/g, ' ').slice(0, 120) || 'unknown-error'
}

/**
 * 调用 OneBot action 并提取 rkey。
 * @param {Object} bot - Bot 实例
 * @param {{id:string,action:string}} candidate - 候选
 * @param {string} kind - rkey 类别
 * @returns {Promise<{ok:boolean, reason?:string, rkey?:string, expiresAt?:number|null}>} 调用结果
 */
async function invokeOneBotCandidate(bot, candidate, kind) {
    if (typeof bot?.sendApi !== 'function')
        return { ok: false, reason: `onebot-sendApi-unavailable:${candidate.action}` }

    let payload
    try {
        // 已实证的 rkey action 均不接收参数，故只传空对象，不透传 force（该参数在 OneBot 侧无对应语义）
        payload = await bot.sendApi(candidate.action, {})
    } catch (error) {
        return { ok: false, reason: `${candidate.action}-failed:${describeError(error)}` }
    }

    const entry = extractRkeyEntry(payload, kind)
    if (!entry) return { ok: false, reason: `${candidate.action}-returned-no-${kind}-rkey` }
    return { ok: true, rkey: entry.rkey, expiresAt: entry.expiresAt }
}

/**
 * 调用 ICQQ client 方法并提取 rkey。
 * @param {Object} bot - Bot 实例
 * @param {{id:string,method:string,viaSdk:boolean}} candidate - 候选
 * @param {string} kind - rkey 类别
 * @param {boolean} force - 透传给底层方法的 force 参数
 * @returns {Promise<{ok:boolean, reason?:string, rkey?:string, expiresAt?:number|null}>} 调用结果
 */
async function invokeIcqqCandidate(bot, candidate, kind, force) {
    const holder = candidate.viaSdk ? bot?.sdk : bot
    const fn = holder?.[candidate.method]
    if (typeof fn !== 'function') return { ok: false, reason: `${candidate.id}-unavailable` }

    let payload
    try {
        payload = await fn.call(holder, force)
    } catch (error) {
        return { ok: false, reason: `${candidate.method}-failed:${describeError(error)}` }
    }

    const entry = extractRkeyEntry(payload, kind)
    // refreshToken 只返回布尔值，即便成功也拿不到 rkey，此时如实报错而不是伪造成功
    if (!entry) return { ok: false, reason: `${candidate.method}-returned-no-rkey` }
    return { ok: true, rkey: entry.rkey, expiresAt: entry.expiresAt }
}

/**
 * 按候选所属适配器分发调用。
 * @param {Object} bot - Bot 实例
 * @param {Object} candidate - 候选
 * @param {string} kind - rkey 类别
 * @param {boolean} force - 透传给底层方法的 force 参数
 * @returns {Promise<{ok:boolean, reason?:string, rkey?:string, expiresAt?:number|null}>} 调用结果
 */
function invokeCandidate(bot, candidate, kind, force) {
    if (candidate.label === 'onebot') return invokeOneBotCandidate(bot, candidate, kind)
    return invokeIcqqCandidate(bot, candidate, kind, force)
}

/**
 * 执行一次刷新：优先使用已缓存的方法，缓存失效或缺失时逐项探测候选链。
 * @param {Object} bot - Bot 实例
 * @param {string} kind - rkey 类别
 * @param {boolean} force - 透传给底层方法的 force 参数
 * @returns {Promise<{ok:boolean, reason?:string, rkey?:string, expiresAt?:number|null}>} 刷新结果
 */
async function invokeRefresh(bot, kind, force) {
    const entry = getBotCacheEntry(bot)
    const candidates = buildCandidates(bot)

    if (entry.method) {
        const cached = candidates.find(candidate => candidate.id === entry.method.id)
        if (cached) {
            const result = await invokeCandidate(bot, cached, kind, force)
            if (result.ok) {
                entry.failures = 0
                return result
            }

            entry.failures += 1
            if (entry.failures >= METHOD_FAILURE_THRESHOLD) {
                entry.method = null
                entry.failures = 0
            }
            return result
        }

        // 缓存的候选已不在当前候选链中（例如适配器被热重载替换），立即作废并重走探测
        entry.method = null
        entry.failures = 0
    }

    if (candidates.length === 0) return { ok: false, reason: 'no-available-method:none' }

    let lastReason = 'none'
    let invokedReason = null
    for (const candidate of candidates) {
        const result = await invokeCandidate(bot, candidate, kind, force)
        if (result.ok) {
            entry.method = { id: candidate.id }
            entry.failures = 0
            return result
        }

        const reason = result.reason ?? 'unknown'
        // 优先保留"已实际调用但拿不到 rkey"的原因（如 refreshToken-returned-no-rkey），
        // 它比单纯的"-unavailable"更能说明这台 bot 为什么刷不了
        if (!invokedReason && !reason.includes('-unavailable')) invokedReason = reason
        lastReason = reason
    }
    return { ok: false, reason: `no-available-method:${invokedReason ?? lastReason}` }
}

/**
 * 读取未过期的 rkey 缓存值。
 * @param {Object} bot - Bot 实例
 * @param {string} kind - rkey 类别
 * @param {number} nowSeconds - 当前秒级时间戳
 * @returns {string|null} 可用 rkey 值
 */
function readCachedRkey(bot, kind, nowSeconds) {
    const cached = findBotCacheEntry(bot)?.rkeys.get(kind)
    if (!cached?.rkey) return null

    const deadline =
        cached.expiresAt === null
            ? cached.fetchedAt + UNKNOWN_EXPIRY_CACHE_SECONDS
            : cached.expiresAt - RKEY_EXPIRY_SAFETY_MARGIN_SECONDS
    return nowSeconds < deadline ? cached.rkey : null
}

/**
 * 写入 rkey 值缓存。
 * @param {Object} bot - Bot 实例
 * @param {string} kind - rkey 类别
 * @param {{rkey:string, expiresAt:number|null}} result - 刷新结果
 * @param {number} nowSeconds - 当前秒级时间戳
 * @returns {void}
 */
function writeCachedRkey(bot, kind, result, nowSeconds) {
    getBotCacheEntry(bot).rkeys.set(kind, {
        rkey: result.rkey,
        expiresAt: result.expiresAt ?? null,
        fetchedAt: nowSeconds
    })
}

/**
 * 用新 rkey 改写 URL 并组装成功返回。
 * rkey 与原 URL 上一致时也返回 `refreshed: true`：此时 URL 已被确认为当前有效值，
 * 这样调用方不必把"rkey 恰好相同"误判为刷新失败而放弃重发。
 * @param {string} url - 原 URL
 * @param {string} rkey - 新 rkey 值
 * @returns {{url:string, refreshed:boolean, reason?:string}} 结果
 */
function buildRefreshedResult(url, rkey) {
    const next = replaceRkeyInUrl(url, rkey)
    if (!next) return { url, refreshed: false, reason: 'url-rewrite-failed' }
    return { url: next, refreshed: true }
}

/**
 * 判断 Bot 是否具备 rkey 刷新能力，供调用方提前跳过。
 * @param {Object} bot - Bot 实例（`event.bot`）
 * @returns {boolean} 是否具备刷新能力
 */
export function hasRefreshCapability(bot) {
    if (!bot || typeof bot !== 'object') return false
    try {
        if (findBotCacheEntry(bot)?.method) return true

        const adapter = detectStandardAdapter(bot)
        if (adapter === ICQQ_ADAPTER) return hasIcqqRefreshMethod(bot)
        if (ONEBOT_ADAPTERS.has(adapter)) return typeof bot.sendApi === 'function'
        if (typeof bot.sendApi === 'function') return true
        return hasIcqqRefreshMethod(bot)
    } catch {
        return false
    }
}

/**
 * 刷新 QQ 图床 URL 上的 rkey 参数。
 *
 * 任何异常都会被捕获并转换为 `refreshed: false` 的返回值，绝不向调用方抛异常。
 * @param {string} url - 原始图床 URL
 * @param {Object} [options] - 调用选项
 * @param {Object} [options.bot] - Yunzai Bot 实例（`event.bot`）
 * @param {boolean} [options.force=false] - 强制刷新：跳过本地 rkey 值缓存直接向平台索取，并透传给底层刷新方法（仅 ICQQ 链支持该参数）
 * @returns {Promise<{url:string, refreshed:boolean, reason?:string}>} 刷新结果
 */
export async function refreshImageUrl(url, options = {}) {
    try {
        const parsed = parseQQMediaUrl(url)
        if (!parsed) return { url, refreshed: false, reason: 'not-qq-media-url' }
        if (!parsed.hasRkey) return { url, refreshed: false, reason: 'no-rkey-parameter' }
        if (parsed.kind === null) {
            const appid = parsed.appid === null ? 'missing' : parsed.appid
            return { url, refreshed: false, reason: `unsupported-appid:${appid}` }
        }

        const bot = options?.bot
        if (!bot || typeof bot !== 'object') return { url, refreshed: false, reason: 'invalid-bot-instance' }

        const force = options?.force === true
        const nowSeconds = Date.now() / 1000
        if (!force) {
            const cachedRkey = readCachedRkey(bot, parsed.kind, nowSeconds)
            if (cachedRkey) return buildRefreshedResult(url, cachedRkey)
        }

        const result = await invokeRefresh(bot, parsed.kind, force)
        if (!result.ok || !result.rkey) return { url, refreshed: false, reason: result.reason ?? 'refresh-failed' }

        writeCachedRkey(bot, parsed.kind, result, nowSeconds)
        return buildRefreshedResult(url, result.rkey)
    } catch (error) {
        return { url, refreshed: false, reason: `unexpected-error:${describeError(error)}` }
    }
}

/**
 * 清空方法缓存与 rkey 值缓存。用于测试与故障恢复。
 * @returns {void}
 */
export function resetRkeyCache() {
    botEntriesByKey = new Map()
    botEntriesByObject = new WeakMap()
}

export default { refreshImageUrl, hasRefreshCapability, resetRkeyCache }
