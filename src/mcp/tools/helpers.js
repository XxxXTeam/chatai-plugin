/**
 * MCP 工具辅助函数
 */

import _logger from '../../core/utils/logger.js'
import * as cheerio from 'cheerio'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import dns from 'node:dns/promises'
import { fileURLToPath } from 'node:url'
import { PLUGIN_DEVELOPERS } from '../../utils/common.js'
import {
    StandardBotApi,
    StandardMessage,
    detectStandardAdapter,
    getStandardResultError,
    normalizeStandardMessage,
    normalizeStandardSegment,
    preserveTargetId,
    isQQBotInstance
} from '../../core/platform/index.js'

/** @deprecated 新代码请使用 StandardBotApi。 */
export { isQQBotInstance as isQQBot, preserveTargetId as normalizeBotTargetId } from '../../core/platform/index.js'

const logger = _logger.tag('mcp-helper')

/** 允许工具访问的网络协议白名单 */
const ALLOWED_URL_PROTOCOLS = ['http:', 'https:']

/** 无条件拒绝的主机名（本机回环别名） */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback'])

/** 禁止随请求转发的敏感请求头前缀/名称（小写比较） */
const BLOCKED_REQUEST_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'host', 'content-length'])

/** 禁止随请求转发的敏感请求头前缀 */
const BLOCKED_REQUEST_HEADER_PREFIXES = ['proxy-', 'sec-', 'x-forwarded-']

/** QQ Web API 单次请求超时（毫秒），覆盖 qqWebApi 下全部接口 */
const QQ_WEB_API_TIMEOUT_MS = 15000

/** QQ Web API 响应体大小上限（字节），这些接口的正常响应均在百 KB 量级 */
const QQ_WEB_API_MAX_BYTES = 5 * 1024 * 1024

/** 群荣誉页面（HTML）下载超时（毫秒） */
const QQ_HONOR_PAGE_TIMEOUT_MS = 15000

/**
 * 群荣誉页面 HTML 大小上限（字节）
 * 该响应随后交给 cheerio.load 同步解析，超大 HTML 会阻塞事件循环，故在下载阶段就截断
 * @type {number}
 */
const QQ_HONOR_PAGE_MAX_BYTES = 2 * 1024 * 1024

/**
 * 带超时与响应体大小上限的 fetch
 *
 * 裸 `await fetch(url)` 有两个必然故障：对端黑洞时 Promise 永不落定，
 * 调用它的工具 handler 与整次模型调用一起挂起、连接句柄泄漏；
 * 对端返回超大响应时整体读入内存即 OOM。
 * 大小校验不能只信 Content-Length —— 该头可缺失也可与实际不符，
 * 故在流式读取过程中累计字节数，超限立即中止并释放连接。
 *
 * @param {string} url - 请求地址
 * @param {RequestInit} [options] - fetch 选项；其中的 signal 会被本函数的超时信号覆盖
 * @param {{ timeoutMs: number, maxBytes: number, label?: string }} limits - 超时与大小上限
 * @returns {Promise<{ response: Response, buffer: Buffer }>} 响应对象与完整响应体
 * @throws {Error} 超时、网络失败或响应体超限时抛出
 */
/**
 * 将 fetch body 转为 node:http 可写字节，并补齐 FormData content-type。
 * @param {*} body - 请求体
 * @param {Object} headers - 请求头
 * @returns {Promise<Buffer|null>} 请求体
 */
async function normalizePinnedRequestBody(body, headers) {
    if (body === undefined || body === null) return null
    if (Buffer.isBuffer(body)) return body
    if (body instanceof Uint8Array) return Buffer.from(body)
    if (typeof body === 'string') return Buffer.from(body)
    if (body instanceof URLSearchParams) return Buffer.from(body.toString())
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return Buffer.from(await body.arrayBuffer())
    }
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const request = new Request('http://localhost/', { method: 'POST', body })
        const contentType = request.headers.get('content-type')
        if (contentType && !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
            headers['Content-Type'] = contentType
        }
        return Buffer.from(await request.arrayBuffer())
    }
    throw new Error('安全抓取不支持该请求体类型')
}

/**
 * 使用已校验 DNS 地址发起单跳请求，消除校验与连接之间的二次解析窗口。
 * @param {URL} safeUrl - assertSafeUrl 返回的 URL
 * @param {Object} options - 请求选项
 * @param {AbortSignal} signal - 中止信号
 * @param {number} maxBytes - 响应体上限
 * @param {string} label - 日志标签
 * @returns {Promise<{response:Object, buffer:Buffer}>} 响应
 */
async function requestPinnedOnce(safeUrl, options, signal, maxBytes, label) {
    const addresses = Array.isArray(safeUrl.safeAddresses) ? safeUrl.safeAddresses : []
    if (addresses.length === 0) throw new Error(`${label} 没有可用的已校验地址`)
    const selected = addresses[0]
    const headers =
        options.headers instanceof Headers
            ? Object.fromEntries(options.headers.entries())
            : { ...(options.headers || {}) }
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'accept-encoding')) {
        headers['Accept-Encoding'] = 'identity'
    }
    const requestBody = await normalizePinnedRequestBody(options.body, headers)
    if (requestBody && !Object.keys(headers).some(key => key.toLowerCase() === 'content-length')) {
        headers['Content-Length'] = String(requestBody.byteLength)
    }

    const transport = safeUrl.protocol === 'https:' ? https : http
    return await new Promise((resolve, reject) => {
        const request = transport.request(
            safeUrl,
            {
                method: options.method || 'GET',
                headers,
                agent: false,
                signal,
                ...(safeUrl.protocol === 'https:' ? { servername: safeUrl.hostname } : {}),
                lookup(_hostname, lookupOptions, callback) {
                    if (lookupOptions?.all) {
                        callback(null, addresses)
                    } else {
                        callback(null, selected.address, selected.family)
                    }
                }
            },
            incoming => {
                const responseHeaders = new Headers()
                for (const [key, value] of Object.entries(incoming.headers)) {
                    if (Array.isArray(value)) value.forEach(item => responseHeaders.append(key, item))
                    else if (value !== undefined) responseHeaders.set(key, String(value))
                }
                const response = {
                    status: incoming.statusCode || 0,
                    statusText: incoming.statusMessage || '',
                    ok: (incoming.statusCode || 0) >= 200 && (incoming.statusCode || 0) < 300,
                    headers: responseHeaders,
                    body: null
                }

                if (response.status >= 300 && response.status < 400) {
                    incoming.resume()
                    resolve({ response, buffer: Buffer.alloc(0) })
                    return
                }

                const chunks = []
                let total = 0
                incoming.on('data', chunk => {
                    total += chunk.length
                    if (total > maxBytes) {
                        request.destroy(new Error(`${label} 响应体过大: 已读取 ${total} 字节，上限 ${maxBytes} 字节`))
                        return
                    }
                    chunks.push(Buffer.from(chunk))
                })
                incoming.on('end', () => {
                    try {
                        let buffer = Buffer.concat(chunks)
                        const encoding = String(responseHeaders.get('content-encoding') || '').toLowerCase()
                        if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer, { maxOutputLength: maxBytes })
                        else if (encoding === 'deflate')
                            buffer = zlib.inflateSync(buffer, { maxOutputLength: maxBytes })
                        else if (encoding === 'br')
                            buffer = zlib.brotliDecompressSync(buffer, { maxOutputLength: maxBytes })
                        if (buffer.byteLength > maxBytes) {
                            throw new Error(
                                `${label} 解压后响应体过大: ${buffer.byteLength} 字节，上限 ${maxBytes} 字节`
                            )
                        }
                        resolve({ response, buffer })
                    } catch (error) {
                        reject(error)
                    }
                })
                incoming.on('error', reject)
            }
        )
        request.on('error', reject)
        if (requestBody) request.write(requestBody)
        request.end()
    })
}

export async function fetchWithLimit(url, options = {}, limits) {
    const { timeoutMs, maxBytes, label = 'fetch', maxRedirects = 5, lookup = dns.lookup } = limits
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`${label} 请求超时`)), timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    let currentUrl = String(url)
    let requestHeaders =
        options.headers instanceof Headers
            ? Object.fromEntries(options.headers.entries())
            : options.headers
              ? { ...options.headers }
              : undefined

    try {
        for (let redirectCount = 0; ; redirectCount++) {
            const safeUrl = await assertSafeUrl(currentUrl, lookup)
            const { response, buffer } = await requestPinnedOnce(
                safeUrl,
                {
                    ...options,
                    ...(requestHeaders ? { headers: requestHeaders } : {})
                },
                signal,
                maxBytes,
                label
            )

            if (response.status < 300 || response.status >= 400) {
                const declared = Number(response.headers.get('content-length'))
                if (Number.isFinite(declared) && declared > maxBytes) {
                    throw new Error(`${label} 响应体过大: 声明 ${declared} 字节，上限 ${maxBytes} 字节`)
                }
                return { response, buffer, url: currentUrl }
            }

            const location = response.headers.get('location')
            if (!location) return { response, buffer, url: currentUrl }
            if (redirectCount >= maxRedirects) {
                throw new Error(`${label} 重定向次数超过上限 ${maxRedirects}`)
            }

            const nextUrl = new URL(location, safeUrl)
            if (nextUrl.origin !== safeUrl.origin && requestHeaders) {
                requestHeaders = sanitizeCrossOriginRedirectHeaders(requestHeaders)
            }
            currentUrl = nextUrl.toString()
        }
    } finally {
        clearTimeout(timer)
    }
}

/**
 * 插件根目录（本文件位于 <root>/src/mcp/tools/helpers.js，上溯三层）
 * 不使用 process.cwd()，避免 Yunzai 启动目录变化导致沙箱边界漂移
 * @type {string}
 */
export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * 判断 IPv4 地址是否属于内网/保留网段
 * @param {string} ip - 点分十进制 IPv4
 * @returns {boolean} 命中内网或保留段返回 true
 */
function isBlockedIPv4(ip) {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b] = parts
    if (a === 0) return true // 0.0.0.0/8 本网络
    if (a === 10) return true // 10.0.0.0/8 私有
    if (a === 127) return true // 127.0.0.0/8 回环
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 运营商级 NAT
    if (a === 169 && b === 254) return true // 169.254.0.0/16 链路本地（含云元数据 169.254.169.254）
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 私有
    if (a === 192 && b === 168) return true // 192.168.0.0/16 私有
    if (a >= 224) return true // 224.0.0.0/4 组播 + 240.0.0.0/4 保留
    return false
}

/**
 * 判断 IPv6 地址是否属于内网/保留段
 * @param {string} ip - IPv6 字面量（可带方括号或 zone id）
 * @returns {boolean} 命中内网或保留段返回 true
 */
function isBlockedIPv6(ip) {
    const lower = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '').split('%')[0]
    if (lower === '::' || lower === '::1') return true

    // IPv4 映射地址 ::ffff:a.b.c.d 按 IPv4 规则判断
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedIPv4(mapped[1])

    // IPv4-mapped IPv6 的十六进制形式，例如 ::ffff:7f00:1、::ffff:0a00:1。
    const groups = lower.split(':')
    const ffffIndex = groups.lastIndexOf('ffff')
    if (ffffIndex >= 0 && groups.length - ffffIndex === 3) {
        const prefix = groups.slice(0, ffffIndex)
        if (prefix.every(group => group === '' || /^0{1,4}$/.test(group))) {
            const high = Number.parseInt(groups[ffffIndex + 1], 16)
            const low = Number.parseInt(groups[ffffIndex + 2], 16)
            if (
                Number.isInteger(high) &&
                high >= 0 &&
                high <= 0xffff &&
                Number.isInteger(low) &&
                low >= 0 &&
                low <= 0xffff
            ) {
                const ipv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
                return isBlockedIPv4(ipv4)
            }
            return true
        }
    }

    const compatibleDotted = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/)
    if (compatibleDotted) return isBlockedIPv4(compatibleDotted[1])
    const compatibleGroups = lower.startsWith('::') ? lower.slice(2).split(':').filter(Boolean) : []
    if (compatibleGroups.length === 2 && compatibleGroups.every(group => /^[0-9a-f]{1,4}$/.test(group))) {
        const high = Number.parseInt(compatibleGroups[0], 16)
        const low = Number.parseInt(compatibleGroups[1], 16)
        const ipv4 = [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
        return isBlockedIPv4(ipv4)
    }

    const firstGroup = parseInt(lower.split(':')[0] || '0', 16)
    if (!Number.isFinite(firstGroup)) return true
    if ((firstGroup & 0xff00) === 0xff00) return true // ff00::/8 组播
    if ((firstGroup & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地地址
    if ((firstGroup & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
    if ((firstGroup & 0xffc0) === 0xfec0) return true // fec0::/10 废弃站点本地地址
    return false
}

/**
 * 判断 IP 字面量是否禁止访问
 * @param {string} ip - IPv4 或 IPv6 字面量
 * @returns {boolean} 禁止访问返回 true
 */
export function isBlockedIp(ip) {
    const family = net.isIP(ip.replace(/^\[/, '').replace(/\]$/, ''))
    if (family === 4) return isBlockedIPv4(ip)
    if (family === 6) return isBlockedIPv6(ip)
    return false
}

/**
 * 校验 URL 是否允许由工具发起请求（协议白名单 + SSRF 内网阻断）
 * 主机名会经 DNS 解析后逐个校验，防止通过域名指向内网地址
 * @param {string} rawUrl - 待校验的 URL
 * @param {Function} [lookup] - DNS 解析函数；测试可注入以验证连接地址绑定
 * @returns {Promise<URL>} 校验通过且携带 safeAddresses 的 URL 对象
 * @throws {Error} 协议不被允许、指向内网或域名无法解析时抛出
 */
export async function assertSafeUrl(rawUrl, lookup = dns.lookup) {
    let parsed
    try {
        parsed = new URL(String(rawUrl))
    } catch {
        throw new Error(`无效的 URL: ${rawUrl}`)
    }

    if (!ALLOWED_URL_PROTOCOLS.includes(parsed.protocol)) {
        throw new Error(`不允许的协议 ${parsed.protocol}，仅支持 http/https`)
    }

    const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '')
    if (!hostname) throw new Error('URL 缺少主机名')
    if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
        throw new Error(`禁止访问本机地址: ${parsed.hostname}`)
    }

    if (net.isIP(hostname)) {
        if (isBlockedIp(hostname)) {
            throw new Error(`禁止访问内网或保留地址: ${hostname}`)
        }
        parsed.safeAddresses = [{ address: hostname, family: net.isIP(hostname) }]
        return parsed
    }

    let addresses
    try {
        addresses = await lookup(hostname, { all: true })
    } catch (err) {
        throw new Error(`无法解析域名 ${hostname}: ${err.message}`)
    }
    if (!addresses?.length) throw new Error(`无法解析域名 ${hostname}`)
    for (const item of addresses) {
        if (isBlockedIp(item.address)) {
            throw new Error(`域名 ${hostname} 指向内网地址 ${item.address}，已拒绝`)
        }
    }
    parsed.safeAddresses = addresses.map(item => ({ address: item.address, family: item.family }))
    return parsed
}

/**
 * 跨源重定向仅保留明确无凭据的请求头。
 * @param {Object} headers - 原请求头
 * @returns {Object} 安全请求头
 */
export function sanitizeCrossOriginRedirectHeaders(headers) {
    const safeNames = new Set(['accept', 'accept-language', 'user-agent', 'range'])
    const result = {}
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return result
    for (const [key, value] of Object.entries(headers)) {
        if (!safeNames.has(String(key).toLowerCase())) continue
        if (typeof value !== 'string' && typeof value !== 'number') continue
        result[key] = String(value)
    }
    return result
}

/**
 * 过滤调用方传入的请求头，剔除可能导致凭据泄露的敏感项。
 * @param {Object} headers - 原始请求头对象
 * @returns {Object} 过滤后的请求头
 */
export function sanitizeRequestHeaders(headers) {
    const result = {}
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return result
    for (const [key, value] of Object.entries(headers)) {
        if (typeof key !== 'string') continue
        const lower = key.toLowerCase()
        if (BLOCKED_REQUEST_HEADERS.has(lower)) continue
        if (BLOCKED_REQUEST_HEADER_PREFIXES.some(prefix => lower.startsWith(prefix))) continue
        if (typeof value !== 'string' && typeof value !== 'number') continue
        result[key] = String(value)
    }
    return result
}

/**
 * 将路径解析到插件沙箱内，越界即抛错
 * 相对路径以插件根目录为基准；存在的路径会先经 realpath 解析符号链接再比对
 * @param {string} targetPath - 目标路径
 * @param {Object} [options] - 选项
 * @param {string} [options.root] - 沙箱根目录，默认插件根目录
 * @returns {string} 解析后的绝对路径
 * @throws {Error} 路径越出沙箱时抛出
 */
export function resolveSandboxPath(targetPath, options = {}) {
    const root = path.resolve(options.root || PLUGIN_ROOT)
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
        throw new Error('路径不能为空')
    }
    if (targetPath.includes('\0')) {
        throw new Error('路径包含非法字符')
    }

    const resolved = path.resolve(root, targetPath)
    const realRoot = realpathOrSelf(root)

    // 对已存在的路径解析符号链接；不存在时回退到最近的已存在祖先目录
    const probe = nearestExistingPath(resolved)
    const realProbe = realpathOrSelf(probe)
    const suffix = path.relative(probe, resolved)
    const realResolved = suffix ? path.resolve(realProbe, suffix) : realProbe

    if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
        throw new Error(`路径越出允许范围: ${targetPath}`)
    }
    return realResolved
}

/**
 * 解析符号链接，失败时返回原路径
 * @param {string} p - 路径
 * @returns {string} realpath 结果或原路径
 */
function realpathOrSelf(p) {
    try {
        return fs.realpathSync(p)
    } catch {
        return p
    }
}

/**
 * 向上查找最近的已存在祖先路径
 * @param {string} p - 绝对路径
 * @returns {string} 已存在的路径（最坏情况返回根）
 */
function nearestExistingPath(p) {
    let current = p
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current)
        if (parent === current) return current
        current = parent
    }
    return current
}

/**
 * 判断路径是否位于插件沙箱内（不抛错版本）
 * @param {string} targetPath - 目标路径
 * @param {Object} [options] - 传给 resolveSandboxPath 的选项
 * @returns {boolean} 位于沙箱内返回 true
 */
export function isInsideSandbox(targetPath, options = {}) {
    try {
        resolveSandboxPath(targetPath, options)
        return true
    } catch {
        return false
    }
}

/** @deprecated 新代码请使用 StandardBotApi。 */
export const icqqGroup = {
    pick: (bot, groupId) => new StandardBotApi({ bot }).group(groupId),
    sendMsg: (bot, groupId, content, source) =>
        new StandardBotApi({ bot }).callGroup(groupId, 'sendMsg', [content, source]),
    getMemberMap: async (bot, groupId) =>
        new Map((await new StandardBotApi({ bot }).getMemberList(groupId)).map(item => [item.user_id, item])),
    getInfo: (bot, groupId) => new StandardBotApi({ bot }).getGroupInfo(groupId),
    recallMsg: (bot, groupId, messageId) => new StandardBotApi({ bot }).recall({ groupId, messageId }),
    getChatHistory: (bot, groupId, sequence, count = 20) =>
        new StandardBotApi({ bot }).getHistory({ groupId, sequence, count }),
    setName: (bot, groupId, name) => new StandardBotApi({ bot }).callGroup(groupId, 'setName', [name]),
    muteAll: (bot, groupId, enable = true) => new StandardBotApi({ bot }).callGroup(groupId, 'muteAll', [enable]),
    muteMember: (bot, groupId, userId, duration = 600) =>
        new StandardBotApi({ bot }).callGroup(groupId, 'muteMember', [preserveTargetId(bot, userId), duration]),
    kickMember: (bot, groupId, userId, rejectAdd = false) =>
        new StandardBotApi({ bot }).kickMember(groupId, userId, rejectAdd),
    setAdmin: (bot, groupId, userId, enable = true) =>
        new StandardBotApi({ bot }).callGroup(groupId, 'setAdmin', [preserveTargetId(bot, userId), enable]),
    setCard: (bot, groupId, userId, card) =>
        new StandardBotApi({ bot }).callGroup(groupId, 'setCard', [preserveTargetId(bot, userId), card]),
    setTitle: (bot, groupId, userId, title, duration = -1) =>
        new StandardBotApi({ bot }).callGroup(groupId, 'setTitle', [preserveTargetId(bot, userId), title, duration]),
    pokeMember: (bot, groupId, userId) =>
        new StandardBotApi({ bot }).callGroup(groupId, 'pokeMember', [preserveTargetId(bot, userId)]),
    announce: (bot, groupId, content) => new StandardBotApi({ bot }).callGroup(groupId, 'announce', [content]),
    sendFile: (bot, groupId, file, name) => new StandardBotApi({ bot }).sendFile({ groupId, file, name }),
    getFs: (bot, groupId) => new StandardBotApi({ bot }).group(groupId).fs
}

/** @deprecated 新代码请使用 StandardBotApi。 */
export const icqqFriend = {
    pick: (bot, userId) => new StandardBotApi({ bot }).friend(userId),
    pickUser: (bot, userId) => new StandardBotApi({ bot }).friend(userId),
    sendMsg: (bot, userId, content, source) =>
        new StandardBotApi({ bot }).callFriend(userId, 'sendMsg', [content, source]),
    getInfo: (bot, userId) => new StandardBotApi({ bot }).getUserInfo(userId),
    recallMsg: (bot, userId, messageId) => new StandardBotApi({ bot }).recall({ userId, messageId }),
    getChatHistory: (bot, userId, sequence, count = 20) =>
        new StandardBotApi({ bot }).getHistory({ userId, sequence, count }),
    poke: (bot, userId) => new StandardBotApi({ bot }).callFriend(userId, 'poke'),
    thumbUp: (bot, userId, times = 10) => new StandardBotApi({ bot }).callFriend(userId, 'thumbUp', [times]),
    sendFile: (bot, userId, file, name) => new StandardBotApi({ bot }).sendFile({ userId, file, name }),
    getSimpleInfo: (bot, userId) => new StandardBotApi({ bot }).callFriend(userId, 'getSimpleInfo')
}

/** @deprecated 新代码请使用 StandardBotApi.callAction。 */
export async function callOneBotApi(bot, action, params = {}) {
    return await new StandardBotApi({ bot }).callAction(action, params)
}

/**
 * @deprecated 新代码请使用 StandardBotApi 的群公告方法。
 */
export const groupNoticeApi = {
    getNoticeList: (bot, groupId, index = 0) => new StandardBotApi({ bot }).getGroupNotices(groupId, index),
    sendNotice: (bot, groupId, content, options = {}) =>
        new StandardBotApi({ bot }).sendGroupNotice(groupId, content, options),
    deleteNotice: (bot, groupId, noticeId) => new StandardBotApi({ bot }).deleteGroupNotice(groupId, noticeId)
}

/**
 * @deprecated 新代码请使用 StandardBotApi.getMemberList。
 * @param {Object} options - 兼容参数
 * @returns {Promise<Array>} 成员列表
 */
export async function getGroupMemberList({ bot, event, groupId }) {
    const api = new StandardBotApi({ bot, event })
    const targetGroupId = groupId || event?.group_id
    return targetGroupId ? await api.getMemberList(targetGroupId) : []
}

/**
 * 按条件过滤群成员
 * @param {Array} memberList - 成员列表
 * @param {Object} options - 过滤选项
 * @returns {Array} 过滤后的成员列表
 */
export function filterMembers(memberList, options = {}) {
    const {
        role, // 筛选角色: 'admin', 'owner', 'member', 'admin_only' (仅管理员不含群主)
        excludeBot, // 排除机器人
        excludeOwner, // 排除群主
        excludeAdmin, // 排除管理员
        excludeUsers, // 排除指定用户
        botId // 机器人ID
    } = options

    return memberList.filter(m => {
        const uid = String(m.user_id || m.uid)
        const memberRole = m.role || 'member'

        // 排除机器人
        if (excludeBot && botId && uid === String(botId)) return false

        // 排除群主
        if (excludeOwner && memberRole === 'owner') return false

        // 排除管理员
        if (excludeAdmin && memberRole === 'admin') return false

        // 排除指定用户
        if (excludeUsers?.length && excludeUsers.includes(uid)) return false

        // 按角色筛选
        if (role) {
            switch (role) {
                case 'admin':
                    // 管理员（包含群主）
                    return memberRole === 'admin' || memberRole === 'owner'
                case 'admin_only':
                    // 仅管理员（不含群主）
                    return memberRole === 'admin'
                case 'owner':
                    return memberRole === 'owner'
                case 'member':
                    return memberRole === 'member'
                default:
                    return true
            }
        }

        return true
    })
}

/**
 * 随机选择成员
 * @param {Array} memberList - 成员列表
 * @param {number} count - 选择数量
 * @param {boolean} allowDuplicate - 是否允许重复选择
 * @returns {Array} 选中的成员
 */
export function randomSelectMembers(memberList, count = 1, allowDuplicate = false) {
    if (!memberList.length) return []

    const selected = []
    const candidates = [...memberList]
    const actualCount = Math.min(count, allowDuplicate ? count : candidates.length)

    for (let i = 0; i < actualCount; i++) {
        const randomIndex = Math.floor(Math.random() * candidates.length)
        selected.push(candidates[randomIndex])

        if (!allowDuplicate) {
            candidates.splice(randomIndex, 1)
            if (candidates.length === 0) break
        }
    }

    return selected
}

/**
 * 通过昵称/群名片搜索成员
 * @param {Array} memberList - 成员列表
 * @param {string} searchName - 搜索关键词
 * @returns {Object|null} 匹配的成员
 */
export function findMemberByName(memberList, searchName) {
    if (!searchName || !memberList.length) return null

    const keyword = searchName.toLowerCase().trim()
    let bestMatch = null
    let bestScore = 0

    for (const member of memberList) {
        const card = (member.card || '').toLowerCase()
        const nickname = (member.nickname || member.nick || '').toLowerCase()
        const uid = String(member.user_id || member.uid || '')

        // 精确匹配
        if (card === keyword || nickname === keyword || uid === searchName) {
            return { member, score: 100 }
        }

        // 模糊匹配
        let score = 0
        if (card.includes(keyword)) {
            score = Math.max(score, 80 - (card.length - keyword.length))
        }
        if (nickname.includes(keyword)) {
            score = Math.max(score, 70 - (nickname.length - keyword.length))
        }
        if (keyword.includes(card) && card.length > 0) {
            score = Math.max(score, 60)
        }
        if (keyword.includes(nickname) && nickname.length > 0) {
            score = Math.max(score, 50)
        }

        if (score > bestScore) {
            bestScore = score
            bestMatch = member
        }
    }

    return bestScore >= 50 ? { member: bestMatch, score: bestScore } : null
}

/**
 * 格式化成员信息
 * @param {Object} member - 成员对象
 * @returns {Object} 格式化后的信息
 */
export function formatMemberInfo(member) {
    return {
        user_id: String(member.user_id || member.uid),
        nickname: member.nickname || member.nick || '',
        card: member.card || '',
        role: member.role || 'member',
        title: member.title || ''
    }
}

/**
 * 批量发送消息（带间隔）
 * @param {Object} options
 * @returns {Promise<Array>} 发送结果
 */
export async function batchSendMessages({ api, event, messages, count = 1, interval = 500 }) {
    const results = []
    const platformApi = api || new StandardBotApi({ event, bot: event?.bot || globalThis.Bot })
    const actualCount = Math.min(Math.max(count, 1), 10)
    const actualInterval = Math.max(interval, 200)

    for (let i = 0; i < actualCount; i++) {
        try {
            const result = await platformApi.reply(messages)
            results.push({
                index: i + 1,
                success: true,
                message_id: result.message_id
            })

            if (i < actualCount - 1) {
                await new Promise(resolve => setTimeout(resolve, actualInterval))
            }
        } catch (err) {
            results.push({
                index: i + 1,
                success: false,
                error: err.message
            })
        }
    }

    return results
}

/**
 * 验证工具参数
 * @param {Object} args - 传入的参数
 * @param {Object} schema - inputSchema 定义
 * @param {Object} ctx - 上下文
 * @returns {{ valid: boolean, error?: string, missing?: string[] }}
 */
export function validateParams(args, schema, ctx = null) {
    if (!schema || !schema.properties) {
        return { valid: true }
    }

    const required = schema.required || []
    const missing = []
    const invalid = []
    const event = ctx?.getEvent?.() || ctx?.event
    const currentGroupId = event?.group_id
    const currentUserId = event?.user_id

    // 遍历所有必需参数
    for (const param of required) {
        const value = args?.[param]
        const isEmpty = value === undefined || value === null || value === ''

        if (isEmpty) {
            const prop = schema.properties[param]
            const desc = prop?.description || param
            const canAutoFill = (param === 'group_id' && currentGroupId) || (param === 'user_id' && currentUserId)
            if (!canAutoFill) {
                missing.push(`${param} (${desc})`)
            }
        }
    }
    for (const [key, value] of Object.entries(args || {})) {
        if (value === undefined || value === null) continue
        const prop = schema.properties[key]
        if (!prop) continue
        const expectedType = prop.type
        if (!expectedType) continue
        const actualType = typeof value
        if (expectedType === 'string' && actualType !== 'string') {
            if (actualType !== 'number') {
                invalid.push(`${key} 应为字符串类型`)
            }
        } else if (expectedType === 'number' || expectedType === 'integer') {
            // number/integer 统一按数值解析，再做整数与范围校验
            const num = actualType === 'number' ? value : Number(value)
            if (actualType !== 'number' && actualType !== 'string') {
                invalid.push(`${key} 应为${expectedType === 'integer' ? '整数' : '数字'}类型`)
            } else if (!Number.isFinite(num)) {
                invalid.push(`${key} 应为${expectedType === 'integer' ? '整数' : '数字'}类型`)
            } else if (expectedType === 'integer' && !Number.isInteger(num)) {
                invalid.push(`${key} 应为整数类型`)
            } else {
                if (typeof prop.minimum === 'number' && num < prop.minimum) {
                    invalid.push(`${key} 不能小于 ${prop.minimum}`)
                }
                if (typeof prop.maximum === 'number' && num > prop.maximum) {
                    invalid.push(`${key} 不能大于 ${prop.maximum}`)
                }
            }
        } else if (expectedType === 'boolean' && actualType !== 'boolean') {
            // 允许字符串 'true'/'false'
            if (actualType === 'string' && !['true', 'false'].includes(value.toLowerCase())) {
                invalid.push(`${key} 应为布尔类型`)
            }
        } else if (expectedType === 'array' && !Array.isArray(value)) {
            invalid.push(`${key} 应为数组类型`)
        } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(value))) {
            invalid.push(`${key} 应为对象类型`)
        }
    }

    if (missing.length > 0 || invalid.length > 0) {
        const errors = []
        if (missing.length > 0) {
            errors.push(`缺少必需参数: ${missing.join(', ')}`)
        }
        if (invalid.length > 0) {
            errors.push(`参数类型错误: ${invalid.join(', ')}`)
        }
        return {
            valid: false,
            error: errors.join('; '),
            missing: missing.length > 0 ? missing : undefined,
            invalid: invalid.length > 0 ? invalid : undefined
        }
    }

    return { valid: true }
}

/**
 * 创建参数验证错误响应
 * @param {Object} validation - validateParams 返回的结果
 * @returns {Object} 工具返回格式
 */
export function paramError(validation) {
    return {
        success: false,
        error: validation.error,
        missing_params: validation.missing,
        invalid_params: validation.invalid
    }
}

/**
 * @param {Object} args - 传入的参数
 * @param {Object} schema - inputSchema 定义
 * @returns {Object|null} 验证失败返回错误对象，成功返回 null
 */
export function checkParams(args, schema) {
    const validation = validateParams(args, schema)
    if (!validation.valid) {
        return paramError(validation)
    }
    return null
}

let yunzaiCfg = null

/**
 * @returns {Promise<Object|null>}  cfg 对象
 */
export async function loadYunzaiConfig() {
    if (yunzaiCfg) return yunzaiCfg
    try {
        yunzaiCfg = (await import('../../../../../lib/config/config.js')).default
    } catch {}
    return yunzaiCfg
}

/**
 * 获取主人QQ列表
 * @param {string|number} botId - Bot的QQ号（可选）
 * @returns {Promise<Array<string|number>>} 主人标识列表；QQBot 可包含 OpenID
 */
export async function getMasterList(botId) {
    const masters = new Set()
    // QQBot 的主人标识可能是 OpenID，必须保持字符串，不能经过 Number
    // 转换后因 NaN 被丢弃；其它适配器沿用原有数字列表语义。
    const scopedBot =
        botId !== undefined && botId !== null && globalThis.Bot?.[String(botId)]
            ? globalThis.Bot[String(botId)]
            : globalThis.Bot
    const preserveQqOpenId = isQQBotInstance(scopedBot)
    const addMaster = value => {
        if (preserveQqOpenId) {
            if (value !== null && value !== undefined && String(value) !== '') masters.add(String(value))
            return
        }
        const num = Number(value)
        if (num) masters.add(num)
    }
    for (const dev of PLUGIN_DEVELOPERS) {
        addMaster(dev)
    }
    try {
        const config = globalThis.chatgptPluginConfig
        if (config) {
            const pluginMasters = config.get?.('admin.masterQQ') || []
            pluginMasters.forEach(addMaster)
            const authorQQs = config.get?.('admin.pluginAuthorQQ') || []
            authorQQs.forEach(addMaster)
        }
    } catch {}

    try {
        const yzCfg = await loadYunzaiConfig()
        if (yzCfg?.masterQQ?.length > 0) {
            yzCfg.masterQQ.forEach(addMaster)
        }
        if (yzCfg?.master && botId) {
            const botMasters = yzCfg.master[botId] || yzCfg.master[String(botId)] || []
            if (Array.isArray(botMasters)) {
                botMasters.forEach(addMaster)
            }
        }
        if (globalThis.Bot?.config?.master) {
            const m = globalThis.Bot.config.master
            if (Array.isArray(m)) {
                m.forEach(addMaster)
            }
        }
    } catch {}

    return Array.from(masters)
}

/**
 * 发送消息到指定目标
 * @param {Object} options - 发送选项
 * @param {Object} options.bot - Bot实例
 * @param {Object} options.event - 事件对象（可选）
 * @param {string|number} options.groupId - 群号（群聊）
 * @param {string|number} options.userId - 用户QQ（私聊）
 * @param {Array|string} options.message - 消息内容
 * @returns {Promise<Object>} 发送结果
 */
/**
 * @deprecated 新代码请使用 getStandardResultError。
 * @param {*} result - 协议端结果
 * @returns {string|null} 错误信息
 */
export function getSendResultError(result) {
    return getStandardResultError(result)
}

/** @deprecated 新代码请使用 StandardBotApi.send。 */
export async function sendMessage({ bot, event, groupId, userId, message }) {
    return await new StandardBotApi({ bot, event }).send({ groupId, userId, message })
}

/** @deprecated 新代码请使用 StandardMessage.node。 */
export function toQQBotForwardSegment(nodes) {
    return StandardMessage.node(
        (Array.isArray(nodes) ? nodes : []).map(node => {
            const payload = node?.data && !Array.isArray(node.data) ? node.data : node || {}
            return {
                user_id: payload.user_id || payload.uin,
                nickname: payload.nickname || payload.name,
                message: normalizeStandardMessage(payload.content ?? payload.message ?? node?.message ?? '')
            }
        })
    )
}

/** @deprecated 新代码请使用 StandardBotApi.sendForward。 */
export async function sendForwardMessage({ bot, event, groupId, userId, nodes, options = {} }) {
    const normalizedNodes = (Array.isArray(nodes) ? nodes : []).map(node => {
        const payload = node?.data && !Array.isArray(node.data) ? node.data : node || {}
        return {
            user_id: payload.user_id || payload.uin,
            nickname: payload.nickname || payload.name,
            message: payload.message ?? payload.content ?? node?.message ?? '',
            time: payload.time
        }
    })
    return await new StandardBotApi({ bot, event }).sendForward({
        groupId,
        userId,
        nodes: normalizedNodes,
        display: options
    })
}

/**
 * 解析富文本内容为消息段数组
 * 支持特殊标记：[图片:url]、[@qq]、[表情:id]等
 * @param {string|Array} content - 消息内容
 * @returns {Array} 消息段数组
 */
export function parseRichContent(content) {
    if (Array.isArray(content)) {
        return content.flatMap(item =>
            typeof item === 'string' ? parseRichContent(item) : normalizeStandardMessage(item)
        )
    }
    if (typeof content !== 'string') return normalizeStandardMessage(content ?? '')

    const patterns = [
        { regex: /\[(?:图片|image|img):([^\]]+)\]/gi, build: match => StandardMessage.image(match[1].trim()) },
        { regex: /\[(?:表情|face|emoji):(\d+)\]/gi, build: match => StandardMessage.face(match[1]) },
        { regex: /\[@(\d+|all)\]/gi, build: match => StandardMessage.at(match[1]) },
        { regex: /\[at:(\d+|all)\]/gi, build: match => StandardMessage.at(match[1]) },
        { regex: /\[(?:语音|record|audio):([^\]]+)\]/gi, build: match => StandardMessage.record(match[1].trim()) },
        { regex: /\[(?:视频|video):([^\]]+)\]/gi, build: match => StandardMessage.video(match[1].trim()) },
        { regex: /\[(?:回复|reply):(\d+)\]/gi, build: match => StandardMessage.reply(match[1]) },
        { regex: /\[poke:(\d+),(\d+)\]/gi, build: match => StandardMessage.poke(Number(match[1]), Number(match[2])) },
        {
            regex: /\[share:([^,\]]+),([^,\]]+)(?:,([^,\]]+))?(?:,([^\]]+))?\]/gi,
            build: match =>
                StandardMessage.share(match[1].trim(), match[2].trim(), match[3]?.trim() || '', match[4]?.trim() || '')
        },
        { regex: /\[music:(\w+),(\d+)\]/gi, build: match => StandardMessage.music(match[1], match[2]) },
        {
            regex: /\[location:([\d.]+),([\d.]+)(?:,([^\]]+))?\]/gi,
            build: match =>
                StandardMessage.location(
                    Number.parseFloat(match[1]),
                    Number.parseFloat(match[2]),
                    match[3]?.trim() || ''
                )
        }
    ]
    const matches = []
    for (const { regex, build } of patterns) {
        const current = new RegExp(regex.source, regex.flags)
        let match
        while ((match = current.exec(content)) !== null) {
            matches.push({ start: match.index, end: match.index + match[0].length, segment: build(match) })
        }
    }
    matches.sort((left, right) => left.start - right.start)

    const segments = []
    let cursor = 0
    for (const match of matches) {
        if (match.start < cursor) continue
        if (match.start > cursor) segments.push(StandardMessage.text(content.slice(cursor, match.start)))
        segments.push(match.segment)
        cursor = match.end
    }
    if (cursor < content.length) segments.push(StandardMessage.text(content.slice(cursor)))
    return segments.length ? segments : [StandardMessage.text(content)]
}

/**
 * 构建转发节点
 * @param {Array} messages - 消息列表 [{user_id, nickname, content}]
 * @returns {Array} 节点数组
 */
export function buildForwardNodes(messages) {
    return (Array.isArray(messages) ? messages : []).map(message =>
        StandardMessage.nodeItem(
            String(message.user_id || message.uin || '10000'),
            message.nickname || message.name || String(message.user_id || '用户'),
            parseRichContent(message.message || message.content || ''),
            message.time
        )
    )
}

/** @deprecated 新代码请使用 detectStandardAdapter。 */
export function detectProtocol(bot) {
    return detectStandardAdapter(bot)
}

/** @deprecated 新代码请使用 StandardBotApi.getBotInfo。 */
export function getBotInfo(bot) {
    const info = new StandardBotApi({ bot }).getBotInfo()
    return {
        uin: info.user_id || 0,
        nickname: info.nickname || 'Unknown',
        protocol: detectStandardAdapter(bot),
        version: info.version,
        status: info.status
    }
}

/** @deprecated 新代码请使用 normalizeStandardSegment。 */
export function normalizeSegment(segment) {
    return normalizeStandardSegment(segment)
}

/** @deprecated 新代码请使用 normalizeStandardMessage。 */
export function normalizeSegments(segments) {
    return normalizeStandardMessage(segments)
}

/** @deprecated 新代码请使用 StandardMessage。 */
export const compatSegment = StandardMessage

/**
 * @deprecated 新代码请使用 StandardBotApi.sendForward。
 * @param {Object} options - 兼容参数
 * @returns {Promise<Object>} 标准发送结果
 */
export async function sendForwardMsgEnhanced({ bot, event, groupId, userId, messages, display = {} }) {
    const nodes = (Array.isArray(messages) ? messages : []).map(message => ({
        user_id: message.user_id || message.uin,
        nickname: message.nickname || message.name,
        message: normalizeStandardMessage(parseRichContent(message.message ?? message.content ?? '')),
        time: message.time
    }))
    return await new StandardBotApi({ bot, event }).sendForward({
        groupId,
        userId,
        nodes,
        display
    })
}

/**
 * @deprecated 新代码请使用 StandardBotApi.send 和 StandardMessage。
 */
export async function sendCardMessage({ bot, event, groupId, userId, type = 'json', data }) {
    const api = new StandardBotApi({ bot, event })
    try {
        const message = type === 'xml' ? StandardMessage.xml(data) : StandardMessage.json(data)
        return await api.send({ groupId, userId, message })
    } catch (error) {
        return { success: false, error: error.message, protocol: detectStandardAdapter(api.bot) }
    }
}

/**
 * 解析卡片消息
 * @param {Object|string} cardData - JSON/XML数据
 * @returns {Object} 解析结果
 */
export function parseCardData(cardData) {
    try {
        const data = typeof cardData === 'string' ? JSON.parse(cardData) : cardData
        if (!data?.app) return { type: 'unknown', data: {} }

        const result = { app: data.app, raw: data }

        switch (data.app) {
            case 'com.tencent.structmsg':
                result.type = 'link'
                result.title = data.meta?.news?.title || data.prompt || ''
                result.desc = data.meta?.news?.desc || ''
                result.url = data.meta?.news?.jumpUrl || ''
                result.image = data.meta?.news?.preview || ''
                break
            case 'com.tencent.multimsg':
                result.type = 'forward'
                result.resid = data.meta?.detail?.resid || ''
                result.summary = data.meta?.detail?.summary || ''
                result.preview = (data.meta?.detail?.news || []).map(n => n.text)
                break
            case 'com.tencent.miniapp':
            case 'com.tencent.miniapp_01':
                result.type = 'miniapp'
                result.appid = data.meta?.detail_1?.appid || ''
                result.title = data.meta?.detail_1?.title || data.prompt || ''
                result.desc = data.meta?.detail_1?.desc || ''
                result.url = data.meta?.detail_1?.qqdocurl || ''
                result.image = data.meta?.detail_1?.preview || ''
                break
            case 'com.tencent.music':
                result.type = 'music'
                result.title = data.meta?.music?.title || ''
                result.singer = data.meta?.music?.desc || ''
                result.url = data.meta?.music?.jumpUrl || ''
                result.audio = data.meta?.music?.musicUrl || ''
                break
            default:
                result.type = 'custom'
                result.prompt = data.prompt || ''
        }

        return result
    } catch {
        return { type: 'invalid', error: 'JSON解析失败' }
    }
}

/**
 * 构建链接卡片JSON
 */
export function buildLinkCard(title, desc, url, image, source = '') {
    return {
        app: 'com.tencent.structmsg',
        desc: '',
        view: 'news',
        ver: '0.0.0.1',
        prompt: title,
        meta: {
            news: {
                title,
                desc,
                jumpUrl: url,
                preview: image || '',
                tag: source,
                tagIcon: ''
            }
        }
    }
}

/**
 * 构建大图卡片
 */
export function buildBigImageCard(image, title = '', desc = '') {
    return buildLinkCard(title || '[图片]', desc, image, image)
}

/**
 * QQ Web API 封装
 * 参考 yenai-plugin 实现
 */
export const qqWebApi = {
    /**
     * 获取 GTK (g_tk) 值
     */
    getGtk(bot, domain = 'qun.qq.com') {
        const cookies = bot.cookies?.[domain] || ''
        const match = cookies.match(/p_skey=([^;]+)/)
        const pSkey = match ? match[1] : ''

        let hash = 5381
        for (let i = 0; i < pSkey.length; i++) {
            hash += (hash << 5) + pSkey.charCodeAt(i)
        }
        return hash & 2147483647
    },

    /**
     * 获取通用请求头
     */
    getHeaders(bot) {
        return {
            'Content-type': 'application/json;charset=UTF-8',
            Cookie: bot.cookies?.['qun.qq.com'] || '',
            'qname-service': '976321:131072',
            'qname-space': 'Production'
        }
    },

    /**
     * 通用请求方法
     *
     * qun.qq.com 侧网络抖动或被中间设备黑洞时，原实现的裸 fetch 会让调用方永久挂起，
     * 故统一走 fetchWithLimit 施加超时与响应体上限
     * @param {string} name - 接口名，仅用于日志
     * @param {string} url - 请求地址
     * @param {RequestInit} [options] - fetch 选项
     * @returns {Promise<Object>} 解析后的 JSON；非 JSON 响应返回 { _raw, _parseError }
     */
    async _request(name, url, options = {}) {
        try {
            const { buffer } = await fetchWithLimit(url, options, {
                timeoutMs: QQ_WEB_API_TIMEOUT_MS,
                maxBytes: QQ_WEB_API_MAX_BYTES,
                label: `qqWebApi.${name}`
            })
            const text = buffer.toString('utf-8')
            try {
                return JSON.parse(text)
            } catch {
                return { _raw: text, _parseError: true }
            }
        } catch (err) {
            logger.error(`[qqWebApi] ${name} 请求失败:`, err.message)
            throw err
        }
    },

    /**
     * 获取群星级
     * 注意：此 API 必须使用 qqweb.qq.com 的 cookie，不能使用 qun.qq.com
     */
    async getGroupLevel(bot, groupId) {
        // 必须使用 qqweb.qq.com 的 cookie
        if (!bot.cookies?.['qqweb.qq.com']) {
            return { ec: -1, em: '需要 qqweb.qq.com 的 cookie 才能获取群星级' }
        }
        const url = `https://qqweb.qq.com/c/activedata/get_credit_level_info?bkn=${bot.bkn}&uin=${bot.uin}&gc=${groupId}`
        return await this._request('getGroupLevel', url, {
            headers: {
                Cookie: bot.cookies['qqweb.qq.com'],
                Referer: `https://qqweb.qq.com/m/business/qunlevel/index.html?gc=${groupId}&from=0&_wv=1027`,
                'User-agent':
                    'Mozilla/5.0 (Linux; Android 12; M2012K11AC Build/SKQ1.220303.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/89.0.4389.72 MQQBrowser/6.2 TBS/046141 Mobile Safari/537.36 V1_AND_SQ_8.3.9_350_TIM_D QQ/3.5.0.3148 NetType/WIFI WebP/0.3.0 Pixel/1080 StatusBarHeight/81 SimpleUISwitch/0 QQTheme/1015712'
            }
        })
    },

    /**
     * 获取群龙王
     *
     * 响应是 HTML 且随后交给 cheerio 同步解析，超时与体积上限缺一不可：
     * 前者防止请求悬挂，后者防止超大 HTML 在 cheerio.load 处阻塞事件循环
     * @param {Object} bot - Bot 实例
     * @param {number|string} groupId - 群号
     * @returns {Promise<Object|null>} 龙王信息，解析不到时为 null
     */
    async getDragonKing(bot, groupId) {
        const url = `https://qun.qq.com/interactive/honorlist?gc=${groupId}&type=1&_wv=3&_wwv=129`
        const { buffer } = await fetchWithLimit(
            url,
            { headers: { Cookie: bot.cookies?.['qun.qq.com'] || '' } },
            {
                timeoutMs: QQ_HONOR_PAGE_TIMEOUT_MS,
                maxBytes: QQ_HONOR_PAGE_MAX_BYTES,
                label: 'qqWebApi.getDragonKing'
            }
        )
        const html = buffer.toString('utf-8')

        // 使用 cheerio 解析 HTML
        const $ = cheerio.load(html)

        // 遍历所有 script 标签，找到包含 __INITIAL_STATE__ 的
        let data = null
        $('script').each((i, el) => {
            const content = $(el).html() || ''
            if (content.includes('__INITIAL_STATE__')) {
                // 提取 JSON 部分: window.__INITIAL_STATE__={...};
                const match = content.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/)
                if (match) {
                    try {
                        data = JSON.parse(match[1])
                        return false // 停止遍历
                    } catch {}
                }
            }
        })

        return data?.currentTalkative || null
    },

    /**
     * 今日打卡列表
     */
    async getSignInToday(bot, groupId) {
        const url = 'https://qun.qq.com/v2/signin/trpc/GetDaySignedList'
        const gtk = this.getGtk(bot, 'qun.qq.com')
        const today = new Date()
        const dayYmd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

        return await this._request('getSignInToday', `${url}?g_tk=${gtk}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                dayYmd,
                offset: 0,
                limit: 100,
                uid: String(bot.uin),
                groupId: String(groupId)
            })
        })
    },

    /**
     * 群发言榜单
     * @param {boolean} weekly - true为7天，false为昨天
     */
    async getSpeakRank(bot, groupId, weekly = false) {
        const url = 'https://qun.qq.com/m/qun/activedata/proxy/domain/qun.qq.com/cgi-bin/manager/report/list'
        const params = new URLSearchParams({
            bkn: bot.bkn,
            gc: groupId,
            type: 0,
            start: 0,
            time: weekly ? 1 : 0
        })

        return await this._request('getSpeakRank', `${url}?${params}`, {
            headers: this.getHeaders(bot)
        })
    },

    /**
     * 群数据统计
     * @param {boolean} weekly - true为7天，false为昨天
     */
    async getGroupData(bot, groupId, weekly = false) {
        const url = 'https://qun.qq.com/m/qun/activedata/proxy/domain/qun.qq.com/cgi-bin/manager/report/index'
        const params = new URLSearchParams({
            gc: groupId,
            time: weekly ? 1 : 0,
            bkn: bot.bkn
        })

        return await this._request('getGroupData', `${url}?${params}`, {
            headers: this.getHeaders(bot)
        })
    },

    /**
     * 幸运字符列表
     */
    async getLuckyList(bot, groupId, start = 0, limit = 20) {
        const url = 'https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/word_list'
        return await this._request('getLuckyList', `${url}?bkn=${bot.bkn}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                group_code: String(groupId),
                start,
                limit,
                need_equip_info: true
            })
        })
    },

    /**
     * 抽取幸运字符
     */
    async drawLucky(bot, groupId) {
        const url = 'https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/draw_lottery'
        return await this._request('drawLucky', `${url}?bkn=${bot.bkn}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                group_code: String(groupId)
            })
        })
    },

    /**
     * 更换/装备幸运字符
     */
    async equipLucky(bot, groupId, wordId) {
        const url = 'https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/equip'
        return await this._request('equipLucky', `${url}?bkn=${bot.bkn}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                group_code: String(groupId),
                word_id: String(wordId)
            })
        })
    },

    /**
     * 开关幸运字符
     * @param {boolean} enable - true开启，false关闭
     */
    async switchLucky(bot, groupId, enable) {
        const url = 'https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/setting'
        return await this._request('switchLucky', `${url}?bkn=${bot.bkn}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                group_code: String(groupId),
                cmd: enable ? 1 : 2
            })
        })
    }
}

/**
 * 将 OneBot get_group_member_info 返回的 role 规范为 owner/admin/member
 *
 * 无法判定时返回 'unknown' 而非降级为 'member'：后者会让"目标是群主/管理员"的
 * 保护判定静默落空，把踢人/禁言放行到高权限目标上，调用方应按 unknown 拒绝执行。
 * 数字型 role 不做映射 —— 本仓库内没有任何可查证的数值语义定义，
 * 猜错方向就会把群主判成普通成员，正是这里要防的绕过。
 * @param {string|number} role - 协议端返回的原始 role
 * @returns {'owner'|'admin'|'member'|'unknown'} 规范化角色，无法判定时为 unknown
 */
export function normalizeMemberRole(role) {
    if (role === undefined || role === null) return 'unknown'
    if (typeof role === 'string') {
        const r = role.trim().toLowerCase()
        if (r === 'administrator') return 'admin'
        if (r === 'owner' || r === 'admin' || r === 'member') return r
    }
    /*
     * 用 warn 而非 debug：返回 unknown 会让调用方按 fail-closed 拒绝执行，
     * 表现为"禁言/踢人无故失败"。若某协议端确实用数值型 role，需要能从日志立刻看到，
     * 再据实补映射（不能凭猜，猜反方向会把群主判成普通成员）。
     */
    logger.warn(`[helpers] normalizeMemberRole 无法识别的 role: ${typeof role} ${String(role)}`)
    return 'unknown'
}

/**
 * @deprecated 新代码请使用 StandardBotApi.getMemberInfo。
 */
export async function getGroupMemberRoleFromBot(bot, groupId, userId) {
    if (!bot || groupId == null || userId == null) return 'unknown'
    try {
        const info = await new StandardBotApi({ bot }).getMemberInfo(groupId, userId)
        if (info?.is_owner === true) return 'owner'
        if (info?.is_admin === true) return 'admin'
        return normalizeMemberRole(info?.role ?? info?.member_role)
    } catch (error) {
        logger.debug(`[helpers] getGroupMemberRoleFromBot: ${error.message}`)
        return 'unknown'
    }
}

/**
 * @deprecated 新代码请使用 StandardBotApi 获取标准成员资料。
 */
export async function getBotPermission(bot, groupId) {
    const result = {
        role: 'unknown',
        isAdmin: false,
        isOwner: false,
        canKick: false,
        canMute: false,
        canRecall: false,
        canSetCard: false,
        canSetTitle: false,
        inGroup: false
    }
    if (!bot || !groupId) return result

    const api = new StandardBotApi({ bot })
    const botId = api.getBotInfo().user_id
    result.role = await getGroupMemberRoleFromBot(bot, groupId, botId)
    result.inGroup = result.role !== 'unknown'
    result.isOwner = result.role === 'owner'
    result.isAdmin = result.isOwner || result.role === 'admin'
    result.canKick = result.isAdmin
    result.canMute = result.isAdmin
    result.canRecall = result.isAdmin
    result.canSetCard = result.isAdmin
    result.canSetTitle = result.isOwner
    return result
}

/**
 * 检查工具执行结果是否为错误
 * 用于判断工具返回的结果是否表示失败（如权限不足、被禁用等）
 * @param {Object} result - 工具返回结果
 * @returns {boolean} 是否为错误
 */
export function isToolResultError(result) {
    if (!result) return true
    // 显式标记为错误
    if (result.isError === true) return true
    // success 为 false
    if (result.success === false) return true
    // 有 error 字段
    if (result.error) return true
    /*
     * 这里曾按正文内容做中文关键词匹配（失败/错误/无法/拒绝/不存在…）来推断错误，
     * 但工具正文本身就常合法地包含这些词——群聊记录里的"这个方法我试过了，无法解决"、
     * 搜索结果标题"排查登录失败问题"、天气播报"拒绝寒潮来袭"都会被误判。
     * 实测三条典型正常返回全部命中，而该判定会流向 formatResult 的 isError 标记、
     * callTool 的缓存决策与成功率统计：正确结果被标成错误交给模型引发无谓重试、
     * 成功结果不进缓存、统计数据失真。
     *
     * MCP 协议以 isError 标记错误，本项目工具统一返回 { success, error } 对象，
     * 上面的结构化判定已足够覆盖，故不再对正文做启发式猜测。
     */
    return false
}

/**
 * 创建权限不足的错误响应
 * @param {string} action - 操作名称
 * @param {string} requiredRole - 所需权限
 * @param {string} currentRole - 当前权限
 * @returns {Object} 错误响应
 */
export function permissionDeniedError(action, requiredRole, currentRole) {
    return {
        success: false,
        error: `权限不足: 执行"${action}"需要${requiredRole}权限，当前Bot权限为${currentRole}`,
        isError: true,
        permissionDenied: true,
        required: requiredRole,
        current: currentRole
    }
}

/**
 * 创建工具被禁用的错误响应
 * @param {string} toolName - 工具名称
 * @param {string} reason - 禁用原因
 * @returns {Object} 错误响应
 */
export function toolDisabledError(toolName, reason = '已被管理员禁用') {
    return {
        success: false,
        error: `工具"${toolName}"${reason}，无法执行`,
        isError: true,
        toolDisabled: true,
        toolName
    }
}

/**
 * 从参数或上下文中提取并校验群号
 * @param {Object} args - 工具参数
 * @param {Object} ctx - MCP 上下文
 * @returns {string|number} 标准群标识；QQBot OpenID 保持字符串
 * @throws {Error} 缺少群号时抛出
 */
export function requireGroupId(args, ctx) {
    const event = ctx.getEvent?.()
    const gid = args.group_id || event?.group_id || event?.group?.group_id
    if (!gid) throw new Error('缺少群号 group_id')
    return StandardBotApi.fromContext(ctx).targetId(gid)
}
