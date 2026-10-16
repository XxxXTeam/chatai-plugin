/** appid=1406 对应私聊图片，使用 private rkey。 */
export const QQ_MEDIA_APPID_PRIVATE = '1406'

/** appid=1407 对应群聊图片，使用 group rkey。 */
export const QQ_MEDIA_APPID_GROUP = '1407'

/** rkey 类别：私聊。 */
export const QQ_MEDIA_KIND_PRIVATE = 'private'

/** rkey 类别：群聊。 */
export const QQ_MEDIA_KIND_GROUP = 'group'

/**
 * QQ 图床域名集合。
 * 既有判定中 multimedia 图床存在带 `.cn` 与不带 `.cn` 两种写法，此处全部收录；
 * gchat.qpic.cn / c2cpicdw.qpic.cn / p.qpic.cn 为历史图床域名。
 * @type {Set<string>}
 */
export const QQ_MEDIA_HOSTS = new Set([
    'multimedia.nt.qq.com.cn',
    'multimedia.nt.qq.com',
    'gchat.qpic.cn',
    'c2cpicdw.qpic.cn',
    'p.qpic.cn'
])

/**
 * URL query 中 rkey 参数的匹配模式。
 * 改写采用纯字符串替换而非 URLSearchParams 重建，保持 URL 其余字符（含 fileid 的原始编码）逐字不变。
 */
const RKEY_QUERY_PATTERN = /([?&]rkey=)([^&#\s]*)/

/**
 * 判断主机名是否为 QQ 图床域名。
 * @param {string} host - 主机名或 URL
 * @returns {boolean} 是否为 QQ 图床域名
 */
export function isQQMediaHost(host) {
    return typeof host === 'string' && QQ_MEDIA_HOSTS.has(host.toLowerCase())
}

/**
 * 剥掉 rkey 值上可能携带的 `&rkey=` / `rkey=` 前缀。
 * NapCat 远程 rkey 服务返回的值常带该前缀，直接拼进 URL 会产生 `rkey=&rkey=xxx`。
 * @param {*} value - 原始 rkey 值
 * @returns {string} 去除前缀并 trim 后的值，非字符串返回空串
 */
export function normalizeRkeyValue(value) {
    if (typeof value !== 'string') return ''
    return value.trim().replace(/^&?rkey=/, '')
}

/**
 * 由 appid 解析 rkey 类别。
 * @param {string|null} appid - URL 上的 appid 参数
 * @returns {string|null} `private` / `group`，未知 appid 返回 null
 */
export function resolveQQMediaKind(appid) {
    if (appid === QQ_MEDIA_APPID_PRIVATE) return QQ_MEDIA_KIND_PRIVATE
    if (appid === QQ_MEDIA_APPID_GROUP) return QQ_MEDIA_KIND_GROUP
    return null
}

/**
 * 解析 QQ 图床 URL。非图床域名或非法 URL 返回 null。
 * @param {string} url - 待解析 URL
 * @returns {{url:string,host:string,appid:string|null,kind:string|null,rkey:string|null,hasRkey:boolean}|null} 解析结果
 */
export function parseQQMediaUrl(url) {
    if (typeof url !== 'string' || url === '') return null
    let parsed
    try {
        parsed = new URL(url)
    } catch {
        return null
    }

    const host = parsed.hostname.toLowerCase()
    if (!QQ_MEDIA_HOSTS.has(host)) return null

    const appid = parsed.searchParams.get('appid')
    const rawRkey = parsed.searchParams.get('rkey')
    return {
        url,
        host,
        appid,
        kind: resolveQQMediaKind(appid),
        rkey: normalizeRkeyValue(rawRkey ?? '') || null,
        hasRkey: parsed.searchParams.has('rkey')
    }
}

/**
 * 判断 URL 是否为 QQ 图床 URL。
 * @param {string} url - 待判断 URL
 * @returns {boolean} 是否为 QQ 图床 URL
 */
export function isQQMediaUrl(url) {
    return parseQQMediaUrl(url) !== null
}

/**
 * 对 rkey 值做最小转义，仅处理会破坏 query 结构的字符。
 * `+` / `/` / `=` 保持字面量，与原始 URL 上的书写形态一致，避免服务端按表单规则把 `+` 解成空格。
 * @param {string} value - 已剥前缀的 rkey 值
 * @returns {string} 可直接拼入 query 的值
 */
function escapeRkeyQueryValue(value) {
    return value.replace(/[&#\s]/g, char => encodeURIComponent(char))
}

/**
 * 替换 URL 上的 rkey 查询参数，URL 其余部分逐字保留。
 * @param {string} url - 原 URL
 * @param {string} newRkey - 新 rkey 值，允许携带 `&rkey=` 前缀
 * @returns {string|null} 改写后的 URL；URL 不含 rkey 参数或新值为空时返回 null
 */
export function replaceRkeyInUrl(url, newRkey) {
    if (typeof url !== 'string' || !RKEY_QUERY_PATTERN.test(url)) return null
    const value = normalizeRkeyValue(newRkey)
    if (value === '') return null
    return url.replace(RKEY_QUERY_PATTERN, (match, prefix) => prefix + escapeRkeyQueryValue(value))
}
