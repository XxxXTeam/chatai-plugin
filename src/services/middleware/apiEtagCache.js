import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { chatLogger } from '../../core/utils/logger.js'

/**
 * ETag 内容哈希长度（十六进制字符数）。
 * 取 SHA-256 摘要前 16 位，足以在单实例缓存空间内区分响应体差异。
 * @constant {number}
 */
const ETAG_HASH_LENGTH = 16

/**
 * 参与缓存的默认路径前缀：仅前缀匹配的 GET 请求纳入协商缓存。
 * @constant {string}
 */
const DEFAULT_PATH_PREFIX = '/api'

/**
 * 条目默认存活上限（毫秒）。
 * 机器人/后台等非 HTTP 写路径（聊天统计、日志、记忆、知识图谱等）无法触发按前缀失效，
 * 条目达到存活上限后一律按未命中处理，保证面板数据最多滞后该时长；304 命中不续期。
 * @constant {number}
 */
const DEFAULT_MAX_AGE_MS = 5000

/**
 * 默认跳过的路径前缀（不参与协商缓存）。
 * 统计类接口由机器人聊天/后台任务持续写入、且写入不经过 HTTP 写操作，
 * 每次读取都直接放行到路由以拿到最新数据。
 * @constant {string[]}
 */
const DEFAULT_SKIP_PREFIXES = ['/api/stats']

/**
 * 标记 res.json 是否已被本模块包装的内部符号。
 * 同一响应对象只会被包装一次，避免中间件重复挂载时出现多层包装。
 * @type {symbol}
 */
const JSON_WRAPPED = Symbol('apiEtagCache.jsonWrapped')

/**
 * 当前进程内的缓存实例引用（单例）。
 * 用于 clearApiEtagCache 清理最近一次创建的缓存；约定单进程只创建一个缓存实例。
 * @type {ApiEtagCache|null}
 */
let activeCache = null

/**
 * 类型定义：ApiEtagCacheOptions
 * @typedef {object} ApiEtagCacheOptions
 * @property {number} [limit]
 * @property {number} [maxBytes]
 * @property {string} [pathPrefix]
 * @property {number} [maxAgeMs]
 * @property {string[]} [skipPrefixes]
 * @property {() => number} [now]
 * @property {(req: import('express').Request) => string | null | undefined} [identityResolver]
 */

/**
 * 类型定义：JwtIdentityResolverOptions
 * @typedef {object} JwtIdentityResolverOptions
 * @property {string} secretKey - 与 authMiddleware 一致的 HMAC 密钥
 * @property {string} [algorithm='HS256']
 * @property {string} [issuer='chatai-panel']
 * @property {string} [audience='chatai-client']
 * @property {string} [cookieName='auth_token']
 */

/**
 * 进程内 LRU 缓存实现。
 *
 * 使用 Map 的插入顺序模拟 LRU：命中时先 delete 再 set 把条目移到队尾，
 * 队首即最久未使用。条数上限与字节上限按 body 序列化后的 UTF-8 字节数估算，
 * 超出任一上限时从最久未使用条目开始逐出。
 *
 * 存活期与跳过：条目自写入起最多保留 maxAgeMs（默认 5000ms），到期按未命中处理；
 * 路径命中 skipPrefixes（默认 /api/stats）的请求完全不走本缓存。
 * 两者共同兜底机器人/后台等不经过 HTTP 写操作的更新来源。
 *
 * 生命周期：纯内存 Map，服务重启或热更新后自然失效，
 * 不影响正确性，仅丢失协商缓存命中率。
 */
class ApiEtagCache {
    /**
     * @param {ApiEtagCacheOptions} options - 缓存参数
     */
    constructor(options) {
        this.options = options
        this.map = new Map()
        this.totalBytes = 0
        this.pathPrefix = options.pathPrefix ?? DEFAULT_PATH_PREFIX
        this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS
        // 时间源可注入（测试用假时钟）；生产环境使用 Date.now
        this.now = typeof options.now === 'function' ? options.now : Date.now
    }

    /**
     * 判断条目是否达到存活上限（达到 maxAgeMs 即视为过期）
     * @param {{ storedAt: number }} entry - 缓存条目
     * @returns {boolean}
     */
    _isExpired(entry) {
        return this.now() - entry.storedAt >= this.maxAgeMs
    }

    /**
     * 读取条目并把该条目移到 LRU 队尾（视作最近使用）。
     * 达到存活上限的条目会被移除并按未命中处理。
     * @param {string} key - 缓存键
     * @returns {{ etag: string, size: number, storedAt: number }|undefined} 命中的条目；未命中或已过期返回 undefined
     */
    get(key) {
        const entry = this.map.get(key)
        if (!entry) return undefined
        if (this._isExpired(entry)) {
            this.delete(key)
            return undefined
        }
        this.map.delete(key)
        this.map.set(key, entry)
        return entry
    }

    /**
     * 判断键是否存在且未过期（不改动 LRU 顺序）
     * @param {string} key - 缓存键
     * @returns {boolean}
     */
    has(key) {
        const entry = this.map.get(key)
        if (!entry) return false
        if (this._isExpired(entry)) {
            this.delete(key)
            return false
        }
        return true
    }

    /**
     * 写入条目并执行容量逐出。
     * 超出条目数或字节上限时按 LRU 顺序（最旧优先）逐出，逐出事件记 info 日志。
     * 写入时间参与存活期判断（见 _isExpired）。
     * @param {string} key - 缓存键
     * @param {string} etag - 弱 ETag 值
     * @param {number} size - body 序列化后的 UTF-8 字节数
     * @returns {void}
     */
    set(key, etag, size) {
        const previous = this.map.get(key)
        if (previous) {
            this.totalBytes -= previous.size
            this.map.delete(key)
        }
        this.map.set(key, { etag, size, storedAt: this.now() })
        this.totalBytes += size

        const removed = []
        while (this.map.size > this.options.limit) {
            const oldestKey = this.map.keys().next().value
            const oldest = this.map.get(oldestKey)
            this.map.delete(oldestKey)
            this.totalBytes -= oldest.size
            removed.push(oldestKey)
        }
        while (this.totalBytes > this.options.maxBytes && this.map.size > 0) {
            const oldestKey = this.map.keys().next().value
            const oldest = this.map.get(oldestKey)
            this.map.delete(oldestKey)
            this.totalBytes -= oldest.size
            removed.push(oldestKey)
        }
        if (removed.length > 0) {
            chatLogger.info(
                'ApiETag',
                `[ETag缓存] 容量逐出 ${removed.length} 条（current=${this.map.size}, bytes=${this.totalBytes}）`
            )
        }
    }

    /**
     * 删除指定键
     * @param {string} key - 缓存键
     * @returns {void}
     */
    delete(key) {
        const entry = this.map.get(key)
        if (!entry) return
        this.map.delete(key)
        this.totalBytes -= entry.size
    }

    /**
     * 按前缀删除条目（写操作失效用）。
     * 键形如 `${identity}\u0000${originalUrl}`；prefix 传 `${identity}\u0000` 即可
     * 删除该身份的全部分桶，传更完整的 `${identity}\u0000/api/channels` 可细化到子资源。
     * @param {string} prefix - 键前缀
     * @returns {number} 删除的条目数
     */
    deletePrefix(prefix) {
        let removed = 0
        for (const key of Array.from(this.map.keys())) {
            if (key.startsWith(prefix)) {
                const entry = this.map.get(key)
                this.map.delete(key)
                this.totalBytes -= entry?.size || 0
                removed += 1
            }
        }
        return removed
    }

    /**
     * 清空全部缓存
     * @returns {void}
     */
    clear() {
        this.map.clear()
        this.totalBytes = 0
    }
}

/**
 * 计算响应体的弱 ETag。
 * @param {string} bodyText - JSON 序列化后的响应体文本
 * @returns {string} 形如 W/"<前16位sha256>" 的弱 ETag
 */
function computeEtag(bodyText) {
    const hash = crypto.createHash('sha256').update(bodyText).digest('hex').slice(0, ETAG_HASH_LENGTH)
    return `W/"${hash}"`
}

/**
 * 从 Authorization: Bearer <token> 头或按名称的 Cookie 中取出原始 JWT 字符串。
 * 取不到任何 token 时返回空字符串。
 * @param {import('express').Request} req - Express 请求对象
 * @param {string} cookieName - 保存登录 JWT 的 Cookie 名
 * @returns {string} 原始 JWT 字符串，无 token 时为空字符串
 */
function extractBearerToken(req, cookieName) {
    const authHeader = req.headers.authorization
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        const bearer = authHeader.substring(7)
        if (bearer) return bearer
    }
    const cookieToken = typeof req.cookies === 'object' ? req.cookies[cookieName] : undefined
    if (typeof cookieToken === 'string' && cookieToken) return cookieToken
    return ''
}

/**
 * 创建基于登录 JWT 的会话身份解析器。
 *
 * 背景：ETag 中间件挂在 router 最前，先于每条 API 路由的 auth 中间件执行，
 * 因此执行时 req.user 恒为 undefined。该解析器自行从请求的
 * Authorization: Bearer / auth_token Cookie 中取原始 JWT，用与 authMiddleware
 * 相同的密钥与校验参数解码后取 payload.jti 作会话分桶键，保证：
 * - 写操作失效时的 identity 与 GET 写回时的 identity 取自同一 jti；
 * - 签名无效 / 过期 / 参数不符的 token 一律回落匿名桶，不回应野 jti；
 * - 无 token 或 decode 失败的请求落入匿名桶，行为与旧版一致。
 *
 * @param {JwtIdentityResolverOptions} options - 密钥与校验参数
 * @returns {(req: import('express').Request) => string} 解析出的 jti；取不到时为空字符串
 */
export function createJwtIdentityResolver({
    secretKey,
    cookieName = 'auth_token',
    algorithm = 'HS256',
    issuer = 'chatai-panel',
    audience = 'chatai-client'
}) {
    return function jwtIdentityResolver(req) {
        const token = extractBearerToken(req, cookieName)
        if (!token) return ''
        try {
            const decoded = jwt.verify(token, secretKey, { algorithms: [algorithm], issuer, audience })
            return typeof decoded === 'object' && typeof decoded.jti === 'string' ? decoded.jti : ''
        } catch {
            return ''
        }
    }
}

/**
 * 判断 if-none-match 请求头是否命中所托管的弱 ETag。
 *
 * 按 RFC 7232：值可以是空格分隔的标签列表（如 `W/"a", W/"b"`），
 * 存在性比较本身不区分强弱前缀，因此把每一项的 `W/` 前缀去掉后
 * 与缓存条目做全等比较，任一项相等即命中。
 * @param {string|undefined} headerValue - if-none-match 头的原始值
 * @param {string} entryEtag - 缓存条目托管的弱 ETag（形如 W/"<hash>"）
 * @returns {boolean} 是否命中
 */
function ifNoneMatchHits(headerValue, entryEtag) {
    if (typeof headerValue !== 'string' || headerValue.length === 0) return false
    for (const rawPart of headerValue.split(',')) {
        const normalized = rawPart.trim().replace(/^W\//, '')
        if (normalized === entryEtag.replace(/^W\//, '')) return true
    }
    return false
}

/**
 * 生成缓存键的日志摘要，避免日志中出现完整 URL 与 query（可能含临时 Token）。
 * @param {string} identity - 身份标识
 * @param {string} originalUrl - 原始请求路径
 * @returns {string}
 */
function briefKey(identity, originalUrl) {
    const urlHash = crypto.createHash('sha256').update(originalUrl).digest('hex').slice(0, 8)
    const idBrief = identity ? identity.slice(0, 8) : 'anon'
    return `${idBrief}|${urlHash}`
}

/**
 * 创建 API ETag 协商缓存中间件。
 *
 * 行为契约：
 * - 仅处理 GET 且路径以 /api 开头的请求；其它方法与路径直接放行、不参与写回。
 * - 身份分桶：缓存键为 `${identity}\u0000${req.originalUrl}`。identity 由 options.identityResolver
 *   从请求中解析（生产接法解析 authMiddleware 填到 req.user 的 JWT payload 的 jti 字段），
 *   不同登录会话完全隔离，304 不会跨身份命中；解析结果为 undefined/null 时回落匿名桶。
 * - 命中：请求头 if-none-match 与缓存弱 ETag 匹配（含列表形式与弱/强前缀）时直接 res.status(304).end() 结束，
 *   不执行路由、不产生响应体与 Set-Cookie，并补写 ETag 与 Cache-Control 头。
 * - 跳过：路径命中 options.skipPrefixes（默认 ['/api/stats']）的请求不参与本模块缓存，
 *   直接放行到路由，保证持续写入型接口每次读取都是最新数据。
 * - 过期：条目自写入起达到 options.maxAgeMs（默认 5000ms）即按未命中处理，
 *   回落完整路由并重写缓存，兜底机器人/后台等不经过 HTTP 写操作的数据更新；304 命中不延长存活期。
 * - 写回：包装 res.json，在调用前把序列化 body 计算弱 ETag 并写入缓存，
 *   同时设置 ETag 与 `Cache-Control: private, max-age=0, must-revalidate`（协商复用语义）。
 *   res.send / res.sendFile / res.end 等其它结束方式一律不参与缓存。
 * - 排除：响应已含 Set-Cookie 的一律不缓存；路由已声明 Cache-Control 的一律不缓存
 *   （尊重 no-store / public,max-age 等既有语义）；HTTP 状态码 >= 400 的一律不缓存。
 * - 幂等：res.json 只包装一次（Symbol 标记），多次挂载中间件不会产生嵌套包装。
 * - 日志：命中与写入记 debug（仅摘要键），容量逐出记 info（仅发生逐出时）。
 *
 * 生命周期：缓存位于进程内存，重启即失效；热更新后由新实例重建，正确性不受影响。
 *
 * @param {ApiEtagCacheOptions} [options] - 可选参数
 * @param {number} [options.limit=512] - 最大条目数
 * @param {number} [options.maxBytes=16777216] - body 估算总字节上限（默认 16MB）
 * @param {string} [options.pathPrefix='/api'] - 参与缓存的路径前缀
 * @param {number} [options.maxAgeMs=5000] - 条目存活上限（毫秒），到期按未命中处理
 * @param {string[]} [options.skipPrefixes=['/api/stats']] - 直接跳过的路径前缀（不参与协商缓存）
 * @param {() => number} [options.now] - 时间源，供测试注入；缺省使用 Date.now
 * @param {(req: import('express').Request) => string | null | undefined} [options.identityResolver]
 *   身份解析器。缺省时从 req.user.jti 提取（见 webServer.js 的 authMiddleware），
 *   取不到则回落为空字符串（匿名桶）
 * @returns {import('express').RequestHandler} Express 中间件
 */
export function createApiEtagCacheMiddleware(options = {}) {
    const mergedOptions = {
        limit: 512,
        maxBytes: 16 * 1024 * 1024,
        ...options
    }
    const cache = new ApiEtagCache(mergedOptions)
    // 记录最近创建的实例供清理函数使用；约定单进程保留一个实例
    activeCache = cache
    const identityResolver =
        typeof mergedOptions.identityResolver === 'function'
            ? mergedOptions.identityResolver
            : req => req.user?.jti ?? ''
    const skipPrefixes = (
        Array.isArray(mergedOptions.skipPrefixes) ? mergedOptions.skipPrefixes : DEFAULT_SKIP_PREFIXES
    )
        .map(prefix => String(prefix).replace(/\/+$/, ''))
        .filter(Boolean)

    return function apiEtagCacheMiddleware(req, res, next) {
        // 跳过前缀（默认 /api/stats）：等于该前缀或其子路径的请求直接放行，不走任何缓存逻辑
        if (skipPrefixes.some(prefix => req.path === prefix || req.path.startsWith(prefix + '/'))) return next()

        /*
         * 非 GET 且路径带 /api 的写操作（POST/PUT/PATCH/DELETE）通过时，
         * 按「身份 + 站点资源前缀」失效对应 GET 缓存条目。
         * 前缀取到 originalUrl 的 /api 段结束（含下一路径段边界，
         * 如 /api/channels），保证同资源的列表/详情/统计一并刷新。
         *
         * 注意前缀必须与缓存键同坐标：键是含挂载前缀的 originalUrl（如 /chatai/api/...），
         * 而 req.path 已被 Express 剥掉挂载前缀（/api/...）。直接用 req.path 会导致
         * deletePrefix 永远匹配不到键——写操作后旧 ETag 继续命中 304，前端表现为「访问过即冻结」。
         */
        if (req.method !== 'GET' && req.path.startsWith(cache.pathPrefix)) {
            const identity = identityResolver(req) ?? ''
            const urlPath = String(req.originalUrl).split('?')[0]
            const sitePrefix = urlPath.match(/^(.*?\/api(?:\/[^/]+)?)/)?.[1] || cache.pathPrefix
            const fullPrefix = `${identity}\u0000${sitePrefix}`
            cache.deletePrefix(fullPrefix)
        }
        if (req.method !== 'GET') return next()
        if (!req.path.startsWith(cache.pathPrefix)) return next()

        const identity = identityResolver(req) ?? ''
        const key = `${identity}\u0000${req.originalUrl}`

        // get() 会顺带清理过期条目并返回 undefined，此时按未命中处理，回落完整路由并重写缓存
        const entry = cache.get(key)
        if (entry && ifNoneMatchHits(req.headers['if-none-match'], entry.etag)) {
            res.setHeader('ETag', entry.etag)
            res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
            chatLogger.debug('ApiETag', `[ETag缓存] 命中 304 - ${briefKey(identity, req.originalUrl)}`)
            res.status(304).end()
            return
        }

        // 响应体随 Accept-Encoding 变化，按规矩宣告协商维度（追加语义，不覆盖既有 Vary）
        res.vary('Accept-Encoding')
        const originalJson = res.json
        if (res[JSON_WRAPPED]) return next()

        res[JSON_WRAPPED] = true
        res.json = function apiEtagCachedJson(body) {
            // body 为 undefined 时与 Express 默认行为一致，仅结束响应
            if (body === undefined) return originalJson.call(this, body)

            const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
            if (bodyText === undefined) return originalJson.call(this, body)

            if (this.getHeader('Set-Cookie') !== undefined) {
                // 带 Set-Cookie 的响应不缓存，避免登录态响应被协商复用
                return originalJson.call(this, body)
            }
            if (this.getHeader('Cache-Control') !== undefined) {
                // 路由已声明自身缓存策略（如 no-store / public,max-age），尊重既有语义，不参与本模块缓存
                return originalJson.call(this, body)
            }
            const etag = computeEtag(bodyText)
            this.setHeader('ETag', etag)
            this.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
            if (this.statusCode >= 400) {
                // 错误响应不写缓存，仅保留 ETag 头供弱协商
                return originalJson.call(this, body)
            }

            cache.set(key, etag, Buffer.byteLength(bodyText, 'utf8'))
            chatLogger.debug('ApiETag', `[ETag缓存] 写入 - ${briefKey(identity, req.originalUrl)} etag=${etag}`)
            return originalJson.call(this, body)
        }
        next()
    }
}

/**
 * 使指定身份的指定资源前缀缓存失效。
 * 写操作（POST/PUT/PATCH/DELETE）后由中间件自动按前缀调用；
 * 也供测试与运维显式刷新。
 * @param {string} identity - 身份标识（同缓存键第一段）
 * @param {string} sitePrefix - 资源前缀（如 /api/channels）
 * @returns {number} 删除的条目数
 */
export function invalidateApiEtagCache(identity, sitePrefix) {
    if (!activeCache) return 0
    return activeCache.deletePrefix(`${identity}\u0000${sitePrefix}`)
}

/**
 * 清空当前进程内的 API ETag 缓存（测试或运维维护使用）。
 * @returns {void}
 */
export function clearApiEtagCache() {
    if (activeCache) {
        activeCache.clear()
    }
}
