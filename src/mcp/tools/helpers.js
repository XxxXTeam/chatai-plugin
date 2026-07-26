/**
 * MCP 工具辅助函数
 */

import _logger from '../../core/utils/logger.js'
import * as cheerio from 'cheerio'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import dns from 'node:dns/promises'
import { fileURLToPath } from 'node:url'
import { PLUGIN_DEVELOPERS } from '../../utils/common.js'

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

/** 群公告文本类接口超时（毫秒） */
const NOTICE_API_TIMEOUT_MS = 15000

/** 群公告文本类接口响应体大小上限（字节） */
const NOTICE_API_MAX_BYTES = 5 * 1024 * 1024

/** 群公告图片下载超时（毫秒） */
const NOTICE_IMAGE_TIMEOUT_MS = 20000

/**
 * 群公告图片大小上限（字节）
 * imageUrl 由模型参数提供，不设硬上限时单张超大图即可打满内存
 * @type {number}
 */
const NOTICE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

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
export async function fetchWithLimit(url, options = {}, limits) {
    const { timeoutMs, maxBytes, label = 'fetch' } = limits
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
        response.body?.cancel().catch(() => {})
        throw new Error(`${label} 响应体过大: 声明 ${declared} 字节，上限 ${maxBytes} 字节`)
    }

    // 个别实现可能不提供可读流，退化为整体读取后再校验
    if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.byteLength > maxBytes) {
            throw new Error(`${label} 响应体过大: ${buffer.byteLength} 字节，上限 ${maxBytes} 字节`)
        }
        return { response, buffer }
    }

    const reader = response.body.getReader()
    const chunks = []
    let total = 0
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > maxBytes) {
                throw new Error(`${label} 响应体过大: 已读取 ${total} 字节，上限 ${maxBytes} 字节`)
            }
            chunks.push(Buffer.from(value))
        }
    } finally {
        // 超限抛出时主动取消以释放连接；正常读完后 cancel 为空操作
        reader.cancel().catch(() => {})
    }
    return { response, buffer: Buffer.concat(chunks) }
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

    const firstGroup = parseInt(lower.split(':')[0] || '0', 16)
    if (!Number.isFinite(firstGroup)) return true
    if ((firstGroup & 0xfe00) === 0xfc00) return true // fc00::/7 唯一本地地址
    if ((firstGroup & 0xffc0) === 0xfe80) return true // fe80::/10 链路本地
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
 * @returns {Promise<URL>} 校验通过的 URL 对象
 * @throws {Error} 协议不被允许、指向内网或域名无法解析时抛出
 */
export async function assertSafeUrl(rawUrl) {
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
        return parsed
    }

    let addresses
    try {
        addresses = await dns.lookup(hostname, { all: true })
    } catch (err) {
        throw new Error(`无法解析域名 ${hostname}: ${err.message}`)
    }
    if (!addresses?.length) throw new Error(`无法解析域名 ${hostname}`)
    for (const item of addresses) {
        if (isBlockedIp(item.address)) {
            throw new Error(`域名 ${hostname} 指向内网地址 ${item.address}，已拒绝`)
        }
    }
    return parsed
}

/**
 * 过滤调用方传入的请求头，剔除可能导致凭据泄露的敏感项
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

/**
 * icqq 群操作封装
 */
export const icqqGroup = {
    pick: (bot, groupId) => bot.pickGroup?.(parseInt(groupId)),

    async sendMsg(bot, groupId, content, source) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.sendMsg) throw new Error('icqq: 无法获取群对象')
        return await group.sendMsg(content, source)
    },

    async getMemberMap(bot, groupId) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.getMemberMap) throw new Error('icqq: 无法获取群成员')
        return await group.getMemberMap()
    },

    getInfo: (bot, groupId) => bot.gl?.get(parseInt(groupId)) || bot.pickGroup?.(parseInt(groupId))?.info,

    async recallMsg(bot, groupId, messageId) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.recallMsg) throw new Error('icqq: 无法撤回消息')
        return await group.recallMsg(messageId)
    },

    async getChatHistory(bot, groupId, seq, count = 20) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.getChatHistory) throw new Error('icqq: 无法获取聊天记录')
        return await group.getChatHistory(seq, count)
    },

    async setName(bot, groupId, name) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.setName) throw new Error('icqq: 无法设置群名')
        return await group.setName(name)
    },

    async muteAll(bot, groupId, enable = true) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.muteAll) throw new Error('icqq: 无法全员禁言')
        return await group.muteAll(enable)
    },

    async muteMember(bot, groupId, userId, duration = 600) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.muteMember) throw new Error('icqq: 无法禁言成员')
        return await group.muteMember(parseInt(userId), duration)
    },

    async kickMember(bot, groupId, userId, rejectAdd = false) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (group?.kickMember) {
            return await group.kickMember(parseInt(userId), '', rejectAdd)
        }
        // 兼容 newer API setGroupKick / setGroupKickBan
        if (typeof group?.setGroupKick === 'function') {
            return await group.setGroupKick(parseInt(userId), rejectAdd)
        }
        if (typeof group?.setGroupKickBan === 'function') {
            return await group.setGroupKickBan(parseInt(userId), rejectAdd)
        }
        throw new Error('icqq: 无法踢出成员')
    },

    async setAdmin(bot, groupId, userId, enable = true) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (group?.setAdmin) {
            return await group.setAdmin(parseInt(userId), enable)
        }
        if (typeof group?.setGroupAdmin === 'function') {
            return await group.setGroupAdmin(parseInt(userId), enable)
        }
        throw new Error('icqq: 无法设置管理员')
    },

    async setCard(bot, groupId, userId, card) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.setCard) throw new Error('icqq: 无法设置群名片')
        return await group.setCard(parseInt(userId), card)
    },

    async setTitle(bot, groupId, userId, title, duration = -1) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (group?.setTitle) {
            return await group.setTitle(parseInt(userId), title, duration)
        }
        if (typeof group?.setGroupSpecialTitle === 'function') {
            return await group.setGroupSpecialTitle(parseInt(userId), title, duration)
        }
        throw new Error('icqq: 无法设置头衔')
    },

    async pokeMember(bot, groupId, userId) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.pokeMember) throw new Error('icqq: 无法戳一戳')
        return await group.pokeMember(parseInt(userId))
    },

    async announce(bot, groupId, content) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.announce) throw new Error('icqq: 无法发送公告')
        return await group.announce(content)
    },

    async sendFile(bot, groupId, file, name) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.sendFile) throw new Error('icqq: 无法发送文件')
        return await group.sendFile(file, '/', name)
    },

    getFs: (bot, groupId) => bot.pickGroup?.(parseInt(groupId))?.fs
}

/**
 * icqq 好友/用户操作封装
 */
export const icqqFriend = {
    pick: (bot, userId) => bot.pickFriend?.(parseInt(userId)),
    pickUser: (bot, userId) => bot.pickUser?.(parseInt(userId)),

    async sendMsg(bot, userId, content, source) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.sendMsg) throw new Error('icqq: 无法获取好友对象')
        return await friend.sendMsg(content, source)
    },

    getInfo: (bot, userId) => bot.fl?.get(parseInt(userId)),

    async recallMsg(bot, userId, messageId) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.recallMsg) throw new Error('icqq: 无法撤回消息')
        return await friend.recallMsg(messageId)
    },

    async getChatHistory(bot, userId, time, count = 20) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.getChatHistory) throw new Error('icqq: 无法获取聊天记录')
        return await friend.getChatHistory(time, count)
    },

    async poke(bot, userId) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.poke) throw new Error('icqq: 无法戳一戳')
        return await friend.poke()
    },

    async thumbUp(bot, userId, times = 10) {
        const user = bot.pickUser?.(parseInt(userId))
        if (!user?.thumbUp) throw new Error('icqq: 无法点赞')
        return await user.thumbUp(times)
    },

    async sendFile(bot, userId, file, name) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.sendFile) throw new Error('icqq: 无法发送文件')
        return await friend.sendFile(file, name)
    },

    async getSimpleInfo(bot, userId) {
        const user = bot.pickUser?.(parseInt(userId))
        if (!user?.getSimpleInfo) throw new Error('icqq: 无法获取用户信息')
        return await user.getSimpleInfo()
    }
}

// callOneBotApi 统一使用 eventAdapter 中更完善的实现（支持 camelCase 转换和 HTTP fallback）
export { callOneBotApi } from '../../utils/eventAdapter.js'

/**
 * 群公告 API 封装
 * 参考 yenai-plugin 实现，主要使用 QQ Web API
 */
export const groupNoticeApi = {
    /**
     * 获取群公告列表
     * @param {Object} bot - Bot 实例
     * @param {number} groupId - 群号
     * @param {number} index - 获取指定序号的公告（0表示获取列表）
     * @returns {Promise<Array|Object>}
     */
    async getNoticeList(bot, groupId, index = 0) {
        // 方式1: 使用 QQ Web API (主要方式)
        if (bot.cookies?.['qun.qq.com'] && bot.bkn) {
            return await this._getNoticeListWeb(bot, groupId, index)
        }

        // 方式2: NapCat/go-cqhttp API
        if (bot.sendApi) {
            try {
                const result = await bot.sendApi('_get_group_notice', { group_id: groupId })
                const list = result?.data || result || []
                if (index > 0 && list?.[index - 1]) {
                    return {
                        text: list[index - 1].message?.text || list[index - 1].content || '',
                        fid: list[index - 1].notice_id || list[index - 1].fid
                    }
                }
                return list
            } catch (e) {
                // 尝试另一个 API 名称
                try {
                    const result = await bot.sendApi('get_group_notice', { group_id: groupId })
                    return result?.data || result || []
                } catch (e2) {}
            }
        }

        throw new Error('当前协议不支持获取群公告，需要 cookies 或 NapCat/go-cqhttp')
    },

    /**
     * 通过 Web API 获取群公告
     */
    async _getNoticeListWeb(bot, groupId, index = 0) {
        const n = index ? 1 : 20
        const s = index ? index - 1 : 0
        const url = `https://web.qun.qq.com/cgi-bin/announce/get_t_list?bkn=${bot.bkn}&qid=${groupId}&ft=23&s=${s}&n=${n}`

        const { buffer } = await fetchWithLimit(
            url,
            { headers: { Cookie: bot.cookies['qun.qq.com'] } },
            { timeoutMs: NOTICE_API_TIMEOUT_MS, maxBytes: NOTICE_API_MAX_BYTES, label: '获取群公告列表' }
        )
        const res = JSON.parse(buffer.toString('utf-8'))

        if (res.ec !== 0) {
            throw new Error(res.em || '获取群公告失败')
        }

        if (index && res.feeds?.[0]) {
            return {
                text: res.feeds[0].msg?.text || '',
                fid: res.feeds[0].fid
            }
        }

        return res.feeds || []
    },

    /**
     * 发送群公告
     * @param {Object} bot - Bot 实例
     * @param {number} groupId - 群号
     * @param {string} content - 公告内容
     * @param {Object} options - 选项
     * @param {string} options.image - 图片URL
     * @param {boolean} options.pinned - 是否置顶
     * @param {boolean} options.confirmRequired - 是否需要确认
     * @param {boolean} options.showEditCard - 是否显示编辑卡片
     * @returns {Promise<Object>}
     */
    async sendNotice(bot, groupId, content, options = {}) {
        const { image, pinned = false, confirmRequired = true, showEditCard = true } = options

        // 方式1: 使用 QQ Web API (主要方式)
        if (bot.cookies?.['qun.qq.com'] && bot.bkn) {
            return await this._sendNoticeWeb(bot, groupId, content, { image, pinned, confirmRequired, showEditCard })
        }

        // 方式2: NapCat/go-cqhttp API
        if (bot.sendApi) {
            try {
                return await bot.sendApi('_send_group_notice', {
                    group_id: groupId,
                    content,
                    image
                })
            } catch (e) {
                // 尝试另一个 API
                try {
                    return await bot.sendApi('send_group_notice', {
                        group_id: groupId,
                        content,
                        image
                    })
                } catch (e2) {}
            }
        }

        // 方式3: icqq group.sendNotice (备用)
        const group = bot.pickGroup?.(parseInt(groupId))
        if (group?.sendNotice) {
            return await group.sendNotice(content, image)
        }
        if (group?.announce) {
            return await group.announce(content)
        }

        throw new Error('当前协议不支持发送群公告，需要 cookies 或 NapCat/go-cqhttp')
    },

    /**
     * 通过 Web API 发送群公告
     */
    async _sendNoticeWeb(bot, groupId, content, options = {}) {
        const { image, pinned = false, confirmRequired = true, showEditCard = true } = options

        const data = new URLSearchParams({
            qid: groupId,
            bkn: bot.bkn,
            text: content,
            pinned: pinned ? 1 : 0,
            type: 1,
            settings: JSON.stringify({
                is_show_edit_card: showEditCard ? 1 : 0,
                tip_window_type: 1,
                confirm_required: confirmRequired ? 1 : 0
            })
        })

        // 如果有图片，先上传
        if (image) {
            try {
                const imgResult = await this._uploadNoticeImage(bot, image)
                if (imgResult?.ec === 0 && imgResult?.id) {
                    const p = JSON.parse(imgResult.id.replace(/&quot;/g, '"'))
                    data.append('pic', p.id)
                    data.append('imgWidth', p.w)
                    data.append('imgHeight', p.h)
                }
            } catch (e) {
                // 图片上传失败，继续发送文字公告
            }
        }

        const url = `https://web.qun.qq.com/cgi-bin/announce/add_qun_notice?bkn=${bot.bkn}`
        const { buffer } = await fetchWithLimit(
            url,
            {
                method: 'POST',
                headers: {
                    Cookie: bot.cookies['qun.qq.com'],
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: data.toString()
            },
            { timeoutMs: NOTICE_API_TIMEOUT_MS, maxBytes: NOTICE_API_MAX_BYTES, label: '发送群公告' }
        )

        return JSON.parse(buffer.toString('utf-8'))
    },

    /**
     * 上传公告图片
     *
     * imageUrl 来自模型给出的工具参数，下载阶段必须同时限制耗时与体积：
     * 原实现直接 arrayBuffer() 读入整张图，一个超大文件即可耗尽内存
     * @param {Object} bot - Bot 实例
     * @param {string} imageUrl - 图片地址
     * @returns {Promise<Object>} 上传接口返回的 JSON
     */
    async _uploadNoticeImage(bot, imageUrl) {
        // 下载图片
        const { buffer: imageBuffer } = await fetchWithLimit(
            imageUrl,
            {},
            { timeoutMs: NOTICE_IMAGE_TIMEOUT_MS, maxBytes: NOTICE_IMAGE_MAX_BYTES, label: '群公告图片下载' }
        )

        const formData = new FormData()
        formData.append('bkn', bot.bkn)
        formData.append('source', 'troopNotice')
        formData.append('m', '0')
        formData.append('pic_up', new Blob([imageBuffer], { type: 'image/png' }), 'image.png')

        const { buffer } = await fetchWithLimit(
            'https://web.qun.qq.com/cgi-bin/announce/upload_img',
            {
                method: 'POST',
                headers: {
                    Cookie: bot.cookies['qun.qq.com']
                },
                body: formData
            },
            { timeoutMs: NOTICE_API_TIMEOUT_MS, maxBytes: NOTICE_API_MAX_BYTES, label: '群公告图片上传' }
        )

        return JSON.parse(buffer.toString('utf-8'))
    },

    /**
     * 删除群公告
     * @param {Object} bot - Bot 实例
     * @param {number} groupId - 群号
     * @param {string|number} fidOrIndex - 公告ID 或 序号
     * @returns {Promise<Object>}
     */
    async deleteNotice(bot, groupId, fidOrIndex) {
        let fid = fidOrIndex
        let text = ''

        // 如果是数字序号，先获取对应的 fid
        if (typeof fidOrIndex === 'number' || /^\d+$/.test(fidOrIndex)) {
            const index = parseInt(fidOrIndex)
            if (index > 0 && index <= 100) {
                const notice = await this.getNoticeList(bot, groupId, index)
                if (notice?.fid) {
                    fid = notice.fid
                    text = notice.text
                } else {
                    throw new Error(`未找到序号 ${index} 的公告`)
                }
            }
        }

        // 方式1: 使用 QQ Web API (主要方式)
        if (bot.cookies?.['qun.qq.com'] && bot.bkn) {
            return await this._deleteNoticeWeb(bot, groupId, fid, text)
        }

        // 方式2: NapCat/go-cqhttp API
        if (bot.sendApi) {
            try {
                const result = await bot.sendApi('_del_group_notice', {
                    group_id: groupId,
                    notice_id: fid
                })
                return { ...result, text }
            } catch (e) {
                try {
                    const result = await bot.sendApi('del_group_notice', {
                        group_id: groupId,
                        notice_id: fid
                    })
                    return { ...result, text }
                } catch (e2) {}
            }
        }

        throw new Error('当前协议不支持删除群公告，需要 cookies 或 NapCat/go-cqhttp')
    },

    /**
     * 通过 Web API 删除群公告
     */
    async _deleteNoticeWeb(bot, groupId, fid, text = '') {
        const url = `https://web.qun.qq.com/cgi-bin/announce/del_feed?bkn=${bot.bkn}`

        const { buffer } = await fetchWithLimit(
            url,
            {
                method: 'POST',
                headers: {
                    Cookie: bot.cookies['qun.qq.com'],
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    bkn: bot.bkn,
                    fid: fid,
                    qid: groupId
                }).toString()
            },
            { timeoutMs: NOTICE_API_TIMEOUT_MS, maxBytes: NOTICE_API_MAX_BYTES, label: '删除群公告' }
        )

        const result = JSON.parse(buffer.toString('utf-8'))
        return { ...result, text }
    }
}

/**
 * 获取群成员列表
 * @param {Object} options
 * @param {Object} options.bot - Bot 实例
 * @param {Object} options.event - 事件对象
 * @param {number|string} options.groupId - 群号
 * @returns {Promise<Array>} 成员列表
 */
export async function getGroupMemberList({ bot, event, groupId }) {
    const gid = groupId || event?.group_id
    if (!gid) return []

    let memberList = []

    try {
        // 方式1: 使用 event.group.getMemberMap() (icqq 标准)
        if (event?.group?.getMemberMap) {
            const memberMap = await event.group.getMemberMap()
            memberList = mapToMemberList(memberMap)
        }

        // 方式2: 使用 bot.pickGroup
        if (memberList.length === 0 && bot?.pickGroup) {
            const group = bot.pickGroup(parseInt(gid))
            if (group?.getMemberMap) {
                const memberMap = await group.getMemberMap()
                memberList = mapToMemberList(memberMap)
            } else if (group?.getMemberList) {
                memberList = (await group.getMemberList()) || []
            }
        }

        // 方式3: bot.getGroupMemberList
        if (memberList.length === 0 && bot?.getGroupMemberList) {
            const result = await bot.getGroupMemberList(parseInt(gid))
            memberList = result instanceof Map ? mapToMemberList(result) : Array.isArray(result) ? result : []
        }
    } catch (err) {
        logger.error('[helpers] 获取群成员列表失败:', err.message)
    }

    return memberList
}

/**
 * Map 转成员列表数组
 */
function mapToMemberList(memberMap) {
    const list = []
    if (memberMap instanceof Map) {
        for (const [uid, member] of memberMap) {
            list.push({ user_id: uid, ...member })
        }
    } else if (memberMap && typeof memberMap === 'object') {
        for (const [uid, member] of Object.entries(memberMap)) {
            list.push({ user_id: Number(uid) || uid, ...member })
        }
    }
    return list
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
export async function batchSendMessages({ event, messages, count = 1, interval = 500 }) {
    const results = []
    const actualCount = Math.min(Math.max(count, 1), 10)
    const actualInterval = Math.max(interval, 200)

    for (let i = 0; i < actualCount; i++) {
        try {
            const result = await event.reply(messages)
            results.push({
                index: i + 1,
                success: true,
                message_id: result?.message_id
            })

            if (i < actualCount - 1) {
                await new Promise(r => setTimeout(r, actualInterval))
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
    } catch (e) {}
    return yunzaiCfg
}

/**
 * 获取主人QQ列表
 * @param {string|number} botId - Bot的QQ号（可选）
 * @returns {Promise<Array<number>>} 主人QQ列表
 */
export async function getMasterList(botId) {
    const masters = new Set()
    for (const dev of PLUGIN_DEVELOPERS) {
        masters.add(dev)
    }
    try {
        const config = global.chatgptPluginConfig
        if (config) {
            const pluginMasters = config.get?.('admin.masterQQ') || []
            pluginMasters.forEach(m => {
                const num = Number(m)
                if (num) masters.add(num)
            })
            const authorQQs = config.get?.('admin.pluginAuthorQQ') || []
            authorQQs.forEach(a => {
                const num = Number(a)
                if (num) masters.add(num)
            })
        }
    } catch {}

    try {
        const yzCfg = await loadYunzaiConfig()
        if (yzCfg?.masterQQ?.length > 0) {
            yzCfg.masterQQ.forEach(m => {
                const num = Number(m)
                if (num) masters.add(num)
            })
        }
        if (yzCfg?.master && botId) {
            const botMasters = yzCfg.master[botId] || yzCfg.master[String(botId)] || []
            if (Array.isArray(botMasters)) {
                botMasters.forEach(m => {
                    const num = Number(m)
                    if (num) masters.add(num)
                })
            }
        }
        if (global.Bot?.config?.master) {
            const m = global.Bot.config.master
            if (Array.isArray(m)) {
                m.forEach(x => {
                    const num = Number(x)
                    if (num) masters.add(num)
                })
            }
        }
    } catch (err) {}

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
export async function sendMessage({ bot, event, groupId, userId, message }) {
    if (!bot && !event) {
        throw new Error('需要提供 bot 或 event')
    }

    const _bot = bot || event?.bot || global.Bot
    if (!_bot) {
        throw new Error('无法获取Bot实例')
    }

    // 确定目标
    const targetGroupId = groupId || event?.group_id
    const targetUserId = userId || event?.user_id

    let result

    if (targetGroupId) {
        // 群消息
        if (_bot.sendApi) {
            result = await _bot.sendApi('send_group_msg', {
                group_id: parseInt(targetGroupId),
                message
            })
        } else if (_bot.pickGroup) {
            const group = _bot.pickGroup(parseInt(targetGroupId))
            result = await group?.sendMsg(message)
        }
    } else if (targetUserId) {
        // 私聊消息
        if (_bot.sendApi) {
            result = await _bot.sendApi('send_private_msg', {
                user_id: parseInt(targetUserId),
                message
            })
        } else if (_bot.pickFriend) {
            const friend = _bot.pickFriend(parseInt(targetUserId))
            result = await friend?.sendMsg(message)
        }
    } else if (event?.reply) {
        // 使用事件的reply方法
        result = await event.reply(message)
    } else {
        throw new Error('需要指定 groupId 或 userId')
    }

    return {
        success: !!result,
        message_id: result?.message_id || result?.data?.message_id,
        result
    }
}

/**
 * 发送合并转发消息
 * @param {Object} options - 发送选项
 * @param {Object} options.bot - Bot实例
 * @param {Object} options.event - 事件对象（可选）
 * @param {string|number} options.groupId - 群号
 * @param {string|number} options.userId - 用户QQ（私聊转发）
 * @param {Array} options.nodes - 转发节点数组
 * @param {Object} options.options - 额外选项 { prompt, summary, source }
 * @returns {Promise<Object>} 发送结果
 */
export async function sendForwardMessage({ bot, event, groupId, userId, nodes, options = {} }) {
    if (!bot && !event) {
        throw new Error('需要提供 bot 或 event')
    }

    const _bot = bot || event?.bot || global.Bot
    if (!_bot) {
        throw new Error('无法获取Bot实例')
    }

    const targetGroupId = groupId || event?.group_id
    const targetUserId = userId || event?.user_id
    const isGroup = !!targetGroupId

    let result

    // NapCat/OneBot API
    if (_bot.sendApi) {
        const apiName = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg'
        const params = isGroup
            ? { group_id: parseInt(targetGroupId), messages: nodes }
            : { user_id: parseInt(targetUserId), messages: nodes }

        if (options.prompt) params.prompt = options.prompt
        if (options.summary) params.summary = options.summary
        if (options.source) params.source = options.source

        result = await _bot.sendApi(apiName, params)
    }
    // icqq
    else if (_bot.pickGroup || _bot.pickFriend) {
        const target = isGroup ? _bot.pickGroup(parseInt(targetGroupId)) : _bot.pickFriend(parseInt(targetUserId))

        if (target?.makeForwardMsg && target?.sendMsg) {
            // 转换节点格式为 icqq 格式
            const forwardData = nodes.map(n => ({
                user_id: parseInt(n.data?.user_id || n.data?.uin) || 10000,
                nickname: n.data?.nickname || n.data?.name || '用户',
                message: n.data?.content || n.data?.message || ''
            }))

            const forwardMsg = await target.makeForwardMsg(forwardData)
            if (forwardMsg?.data && options) {
                if (options.prompt) forwardMsg.data.prompt = options.prompt
                if (options.summary) forwardMsg.data.summary = options.summary
            }
            result = await target.sendMsg(forwardMsg)
        }
    }

    return {
        success: !!result,
        message_id: result?.message_id || result?.data?.message_id,
        res_id: result?.res_id || result?.data?.res_id,
        result
    }
}

/**
 * 解析富文本内容为消息段数组
 * 支持特殊标记：[图片:url]、[@qq]、[表情:id]等
 * @param {string|Array} content - 消息内容
 * @returns {Array} 消息段数组
 */
export function parseRichContent(content) {
    if (Array.isArray(content)) {
        return content.flatMap(seg => {
            if (typeof seg === 'string') {
                return parseRichContent(seg)
            }
            if (seg.type && !seg.data) {
                const { type, ...rest } = seg
                return [{ type, data: rest }]
            }
            return [seg]
        })
    }

    if (typeof content !== 'string') {
        return [{ type: 'text', data: { text: String(content || '') } }]
    }

    // 解析特殊标记 - 支持中英文标记
    const segments = []
    const patterns = [
        // 图片: [图片:url] 或 [image:url] 或 [img:url]
        { regex: /\[(?:图片|image|img):([^\]]+)\]/gi, handler: m => ({ type: 'image', data: { file: m[1].trim() } }) },
        // 表情: [表情:id] 或 [face:id] 或 [emoji:id]
        { regex: /\[(?:表情|face|emoji):(\d+)\]/gi, handler: m => ({ type: 'face', data: { id: parseInt(m[1]) } }) },
        // @用户: [@qq] 或 [at:qq] 或 [@all]
        { regex: /\[@(\d+|all)\]/gi, handler: m => ({ type: 'at', data: { qq: m[1] } }) },
        { regex: /\[at:(\d+|all)\]/gi, handler: m => ({ type: 'at', data: { qq: m[1] } }) },
        // 语音: [语音:url] 或 [record:url]
        {
            regex: /\[(?:语音|record|audio):([^\]]+)\]/gi,
            handler: m => ({ type: 'record', data: { file: m[1].trim() } })
        },
        // 视频: [视频:url] 或 [video:url]
        { regex: /\[(?:视频|video):([^\]]+)\]/gi, handler: m => ({ type: 'video', data: { file: m[1].trim() } }) },
        // 回复: [reply:id] 或 [回复:id]
        { regex: /\[(?:回复|reply):(\d+)\]/gi, handler: m => ({ type: 'reply', data: { id: m[1] } }) },
        // 戳一戳: [poke:type,id]
        {
            regex: /\[poke:(\d+),(\d+)\]/gi,
            handler: m => ({ type: 'poke', data: { type: parseInt(m[1]), id: parseInt(m[2]) } })
        },
        // 分享链接: [share:url,title] 或 [share:url,title,content,image]
        {
            regex: /\[share:([^,\]]+),([^,\]]+)(?:,([^,\]]+))?(?:,([^\]]+))?\]/gi,
            handler: m => ({
                type: 'share',
                data: { url: m[1].trim(), title: m[2].trim(), content: m[3]?.trim() || '', image: m[4]?.trim() || '' }
            })
        },
        // 音乐: [music:type,id] 如 [music:qq,123456]
        { regex: /\[music:(\w+),(\d+)\]/gi, handler: m => ({ type: 'music', data: { type: m[1], id: m[2] } }) },
        // 位置: [location:lat,lon,title]
        {
            regex: /\[location:([\d.]+),([\d.]+)(?:,([^\]]+))?\]/gi,
            handler: m => ({
                type: 'location',
                data: { lat: parseFloat(m[1]), lon: parseFloat(m[2]), title: m[3]?.trim() || '' }
            })
        }
    ]

    const matches = []
    for (const { regex, handler } of patterns) {
        let match
        const re = new RegExp(regex.source, regex.flags)
        while ((match = re.exec(content)) !== null) {
            matches.push({ start: match.index, end: match.index + match[0].length, segment: handler(match) })
        }
    }

    // 按位置排序，去除重叠
    matches.sort((a, b) => a.start - b.start)
    const filteredMatches = []
    let lastEnd = -1
    for (const m of matches) {
        if (m.start >= lastEnd) {
            filteredMatches.push(m)
            lastEnd = m.end
        }
    }

    if (filteredMatches.length === 0) {
        return [{ type: 'text', data: { text: content } }]
    }

    lastEnd = 0
    for (const m of filteredMatches) {
        if (m.start > lastEnd) {
            const text = content.substring(lastEnd, m.start)
            if (text) segments.push({ type: 'text', data: { text } })
        }
        segments.push(m.segment)
        lastEnd = m.end
    }
    if (lastEnd < content.length) {
        const text = content.substring(lastEnd)
        if (text) segments.push({ type: 'text', data: { text } })
    }

    return segments
}

/**
 * 构建转发节点
 * @param {Array} messages - 消息列表 [{user_id, nickname, content}]
 * @returns {Array} 节点数组
 */
export function buildForwardNodes(messages) {
    return messages.map(msg => ({
        type: 'node',
        data: {
            user_id: String(msg.user_id || msg.uin || '10000'),
            nickname: msg.nickname || msg.name || String(msg.user_id || '用户'),
            content: parseRichContent(msg.message || msg.content || '')
        }
    }))
}

/**
 * 检测协议端类型
 * @param {Object} bot - Bot实例
 * @returns {string} 协议端类型: 'napcat', 'icqq', 'onebot', 'unknown'
 */
export function detectProtocol(bot) {
    if (!bot) return 'unknown'

    // NapCat 特征
    if (bot.sendApi && bot.version?.app_name?.toLowerCase().includes('napcat')) {
        return 'napcat'
    }

    // icqq 特征
    if (bot.pickGroup && bot.pickFriend && bot.gl && bot.fl) {
        return 'icqq'
    }

    // OneBot 特征
    if (bot.sendApi || bot.send_group_msg || bot.send_private_msg) {
        return 'onebot'
    }

    return 'unknown'
}

/**
 * 获取Bot信息
 * @param {Object} bot - Bot实例
 * @returns {Object} Bot信息
 */
export function getBotInfo(bot) {
    if (!bot) return { uin: 0, nickname: 'Unknown' }

    return {
        uin: bot.uin || bot.self_id || 0,
        nickname: bot.nickname || bot.info?.nickname || 'Bot',
        protocol: detectProtocol(bot),
        version: bot.version || {},
        status: bot.status || 'unknown'
    }
}

/**
 * 统一消息段格式
 * @param {Object} seg - 消息段
 * @param {string} targetFormat - 目标格式: 'icqq' | 'onebot' | 'auto'
 * @param {Object} bot - Bot实例（用于自动检测）
 * @returns {Object} 格式化后的消息段
 */
export function normalizeSegment(seg, targetFormat = 'auto', bot = null) {
    if (!seg || !seg.type) return seg

    const format = targetFormat === 'auto' ? detectProtocol(bot) : targetFormat
    const isIcqq = format === 'icqq'

    // 提取数据
    const data = seg.data || {}
    const directData = { ...seg }
    delete directData.type
    delete directData.data

    const mergedData = { ...directData, ...data }

    if (isIcqq) {
        // icqq 格式: { type, ...data }
        return { type: seg.type, ...mergedData }
    } else {
        // OneBot/NapCat 格式: { type, data: {...} }
        return { type: seg.type, data: mergedData }
    }
}

/**
 * 批量格式化消息段数组
 * @param {Array} segments - 消息段数组
 * @param {string} targetFormat - 目标格式
 * @param {Object} bot - Bot实例
 * @returns {Array}
 */
export function normalizeSegments(segments, targetFormat = 'auto', bot = null) {
    if (!Array.isArray(segments)) {
        if (typeof segments === 'string') {
            return [{ type: 'text', data: { text: segments } }]
        }
        return segments ? [normalizeSegment(segments, targetFormat, bot)] : []
    }
    return segments.map(seg => {
        if (typeof seg === 'string') {
            return targetFormat === 'icqq' ? { type: 'text', text: seg } : { type: 'text', data: { text: seg } }
        }
        return normalizeSegment(seg, targetFormat, bot)
    })
}

/**
 * 创建兼容的消息段（同时包含icqq和OneBot格式字段）
 */
export const compatSegment = {
    text: text => ({ type: 'text', text, data: { text } }),

    image: (file, opts = {}) => ({
        type: 'image',
        file,
        ...opts,
        data: { file, ...opts }
    }),

    at: (qq, name) => ({
        type: 'at',
        qq: String(qq),
        ...(name ? { name } : {}),
        data: { qq: String(qq), ...(name ? { name } : {}) }
    }),

    reply: id => ({
        type: 'reply',
        id: String(id),
        data: { id: String(id) }
    }),

    face: id => ({
        type: 'face',
        id: Number(id),
        data: { id: Number(id) }
    }),

    record: (file, magic = false) => ({
        type: 'record',
        file,
        magic: magic ? 1 : 0,
        data: { file, magic: magic ? 1 : 0 }
    }),

    video: (file, thumb) => ({
        type: 'video',
        file,
        ...(thumb ? { thumb } : {}),
        data: { file, ...(thumb ? { thumb } : {}) }
    }),

    json: data => {
        const jsonStr = typeof data === 'string' ? data : JSON.stringify(data)
        // icqq 格式: { type: 'json', data: jsonStr }
        // onebot 格式: { type: 'json', data: { data: jsonStr } }
        // 使用 onebot 格式，normalizeSegment 会处理转换
        return { type: 'json', data: { data: jsonStr } }
    },

    xml: data => ({
        type: 'xml',
        // 使用 onebot 格式，normalizeSegment 会处理转换
        data: { data }
    }),

    node: (userId, nickname, content, time) => ({
        type: 'node',
        data: {
            user_id: String(userId),
            nickname: nickname || String(userId),
            content: Array.isArray(content) ? content : [{ type: 'text', data: { text: String(content) } }],
            ...(time ? { time } : {})
        }
    }),

    forward: id => ({
        type: 'forward',
        id,
        data: { id }
    }),

    mface: (emojiPackageId, emojiId, key, summary) => ({
        type: 'mface',
        emoji_package_id: emojiPackageId,
        emoji_id: emojiId,
        ...(key ? { key } : {}),
        ...(summary ? { summary } : {}),
        data: {
            emoji_package_id: emojiPackageId,
            emoji_id: emojiId,
            ...(key ? { key } : {}),
            ...(summary ? { summary } : {})
        }
    }),

    poke: (type, id) => ({
        type: 'poke',
        poke_type: type,
        id,
        data: { type, id }
    }),

    share: (url, title, content, image) => ({
        type: 'share',
        url,
        title,
        ...(content ? { content } : {}),
        ...(image ? { image } : {}),
        data: { url, title, ...(content ? { content } : {}), ...(image ? { image } : {}) }
    }),

    music: (type, id) => ({
        type: 'music',
        music_type: type,
        id: String(id),
        data: { type, id: String(id) }
    }),

    musicCustom: (url, audio, title, content, image) => ({
        type: 'music',
        music_type: 'custom',
        url,
        audio,
        title,
        content,
        image,
        data: { type: 'custom', url, audio, title, content, image }
    }),

    location: (lat, lon, title, content) => ({
        type: 'location',
        lat,
        lon,
        ...(title ? { title } : {}),
        ...(content ? { content } : {}),
        data: { lat, lon, ...(title ? { title } : {}), ...(content ? { content } : {}) }
    }),

    markdown: content => ({
        type: 'markdown',
        content,
        data: { content }
    }),

    keyboard: rows => ({
        type: 'keyboard',
        data: { content: { rows } }
    }),

    dice: () => ({ type: 'dice', data: {} }),
    rps: () => ({ type: 'rps', data: {} }),
    shake: () => ({ type: 'shake', data: {} })
}

/**
 * 发送合并转发消息
 * 自动适配 icqq/OneBot/NapCat，支持外显自定义
 * @param {Object} options
 * @param {Object} options.bot - Bot实例
 * @param {Object} options.event - 事件对象
 * @param {number|string} options.groupId - 群号
 * @param {number|string} options.userId - 用户QQ（私聊）
 * @param {Array} options.messages - 消息列表 [{user_id, nickname, content}]
 * @param {Object} options.display - 外显选项 {prompt, summary, source}
 * @returns {Promise<Object>}
 */
export async function sendForwardMsgEnhanced({ bot, event, groupId, userId, messages, display = {} }) {
    const _bot = bot || event?.bot || global.Bot
    if (!_bot) throw new Error('无法获取Bot实例')

    const targetGroupId = groupId || event?.group_id
    const targetUserId = userId || event?.user_id
    const isGroup = !!targetGroupId
    const protocol = detectProtocol(_bot)
    const isIcqq = protocol === 'icqq'

    /**
     * 解析消息内容为消息段数组
     * 支持字符串、数组、富文本标记
     */
    const parseContent = content => {
        if (!content) return [{ type: 'text', data: { text: '' } }]

        // 已经是数组
        if (Array.isArray(content)) {
            return content.flatMap(item => {
                if (typeof item === 'string') {
                    return parseRichContent(item)
                }
                // 已经是消息段对象
                if (item.type) {
                    return [normalizeSegment(item, isIcqq ? 'icqq' : 'onebot', _bot)]
                }
                return [{ type: 'text', data: { text: String(item) } }]
            })
        }

        // 字符串：解析富文本标记
        if (typeof content === 'string') {
            return parseRichContent(content)
        }

        // 对象：单个消息段
        if (content.type) {
            return [normalizeSegment(content, isIcqq ? 'icqq' : 'onebot', _bot)]
        }

        return [{ type: 'text', data: { text: String(content) } }]
    }

    // 构建节点 - OneBot 格式
    const buildOneBotNodes = () =>
        messages.map(msg => {
            const uid = String(msg.user_id || msg.uin || '10000')
            const nick = msg.nickname || msg.name || uid
            const content = parseContent(msg.message || msg.content)
            const normalizedContent = normalizeSegments(content, 'onebot', _bot)

            return {
                type: 'node',
                data: {
                    user_id: uid,
                    nickname: nick,
                    content: normalizedContent,
                    ...(msg.time ? { time: msg.time } : {})
                }
            }
        })

    // 构建节点 - icqq 格式
    const buildIcqqNodes = () =>
        messages.map(msg => {
            const uid = parseInt(msg.user_id || msg.uin) || 10000
            const nick = msg.nickname || msg.name || String(uid)
            const content = parseContent(msg.message || msg.content)
            const normalizedContent = normalizeSegments(content, 'icqq', _bot)

            return {
                user_id: uid,
                nickname: nick,
                message: normalizedContent,
                ...(msg.time ? { time: msg.time } : {})
            }
        })

    const nodes = buildOneBotNodes()

    // 检测消息中是否包含 ark/json 类型（需要特殊处理）
    const hasComplexContent = messages.some(msg => {
        const content = msg.message || msg.content
        if (!content) return false

        // 检查数组中的消息段
        if (Array.isArray(content)) {
            return content.some(
                seg => seg.type === 'json' || seg.type === 'xml' || seg.type === 'ark' || seg.type === 'markdown'
            )
        }

        // 检查单个对象
        if (typeof content === 'object' && content.type) {
            return ['json', 'xml', 'ark', 'markdown'].includes(content.type)
        }

        return false
    })

    let result = null
    let method = ''
    let lastError = null

    // 方式1: NapCat/OneBot sendApi
    if (_bot.sendApi) {
        try {
            // 如果包含ark/json等复杂内容，尝试使用不同的发送方式
            if (hasComplexContent) {
                // 方式A: 尝试 send_forward_msg (NapCat 统一接口)
                try {
                    const forwardParams = {
                        messages: nodes,
                        ...(isGroup ? { group_id: parseInt(targetGroupId) } : { user_id: parseInt(targetUserId) })
                    }
                    if (display.prompt) forwardParams.prompt = display.prompt
                    if (display.summary) forwardParams.summary = display.summary
                    if (display.source) forwardParams.source = display.source

                    result = await _bot.sendApi('send_forward_msg', forwardParams)
                    method = 'sendApi_unified'

                    if (
                        result?.status === 'ok' ||
                        result?.retcode === 0 ||
                        result?.message_id ||
                        result?.data?.message_id
                    ) {
                        return {
                            success: true,
                            message_id: result.message_id || result.data?.message_id,
                            res_id: result.res_id || result.data?.res_id,
                            method,
                            node_count: nodes.length,
                            has_complex_content: true,
                            target: isGroup
                                ? { type: 'group', id: targetGroupId }
                                : { type: 'private', id: targetUserId }
                        }
                    }
                } catch (unifiedErr) {
                    // 继续尝试其他方式
                }

                // 方式B: 尝试分步发送 - 先上传节点再发送
                try {
                    // 使用 upload_forward_msg 上传节点
                    const uploadResult = await _bot.sendApi('upload_forward_msg', {
                        messages: nodes
                    })

                    const resId = uploadResult?.res_id || uploadResult?.data?.res_id
                    if (resId) {
                        // 使用 res_id 发送
                        const sendParams = isGroup
                            ? { group_id: parseInt(targetGroupId), res_id: resId }
                            : { user_id: parseInt(targetUserId), res_id: resId }

                        const apiName = isGroup ? 'send_group_msg' : 'send_private_msg'
                        result = await _bot.sendApi(apiName, {
                            ...sendParams,
                            message: [{ type: 'forward', data: { id: resId } }]
                        })
                        method = 'upload_forward'

                        if (
                            result?.status === 'ok' ||
                            result?.retcode === 0 ||
                            result?.message_id ||
                            result?.data?.message_id
                        ) {
                            return {
                                success: true,
                                message_id: result.message_id || result.data?.message_id,
                                res_id: resId,
                                method,
                                node_count: nodes.length,
                                has_complex_content: true,
                                target: isGroup
                                    ? { type: 'group', id: targetGroupId }
                                    : { type: 'private', id: targetUserId }
                            }
                        }
                    }
                } catch (uploadErr) {
                    // 继续尝试标准方式
                }
            }

            // 标准方式: send_group_forward_msg / send_private_forward_msg
            const apiName = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg'
            const params = isGroup
                ? { group_id: parseInt(targetGroupId), messages: nodes }
                : { user_id: parseInt(targetUserId), messages: nodes }

            // 添加外显参数
            if (display.prompt) params.prompt = display.prompt
            if (display.summary) params.summary = display.summary
            if (display.source) params.source = display.source

            result = await _bot.sendApi(apiName, params)
            method = 'sendApi'

            if (result?.status === 'ok' || result?.retcode === 0 || result?.message_id || result?.data?.message_id) {
                return {
                    success: true,
                    message_id: result.message_id || result.data?.message_id,
                    res_id: result.res_id || result.data?.res_id,
                    method,
                    node_count: nodes.length,
                    target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
                }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    // 方式2: icqq makeForwardMsg
    if (_bot.pickGroup || _bot.pickFriend) {
        try {
            let target = null
            const icqqNodes = buildIcqqNodes()

            // 自定义外显的辅助函数
            const applyDisplay = forwardMsg => {
                if (forwardMsg?.data) {
                    if (display.prompt) forwardMsg.data.prompt = display.prompt
                    if (display.summary) forwardMsg.data.summary = display.summary
                    if (display.source) forwardMsg.data.source = display.source
                }
                // 如果 forwardMsg 是数组（某些 icqq 版本）
                if (Array.isArray(forwardMsg)) {
                    for (const item of forwardMsg) {
                        if (item?.data) {
                            if (display.prompt) item.data.prompt = display.prompt
                            if (display.summary) item.data.summary = display.summary
                            if (display.source) item.data.source = display.source
                        }
                    }
                }
                return forwardMsg
            }

            if (isGroup) {
                target = _bot.pickGroup(parseInt(targetGroupId))
            } else {
                // 私聊发送合并转发
                target = _bot.pickFriend(parseInt(targetUserId))

                // icqq 私聊可能没有 makeForwardMsg，尝试借用群来生成
                if (!target?.makeForwardMsg && _bot.pickGroup) {
                    const groups = _bot.gl || new Map()
                    const firstGroupId = groups.keys().next().value
                    if (firstGroupId) {
                        const tempGroup = _bot.pickGroup(firstGroupId)
                        if (tempGroup?.makeForwardMsg) {
                            const forwardMsg = applyDisplay(await tempGroup.makeForwardMsg(icqqNodes))

                            if (target?.sendMsg) {
                                result = await target.sendMsg(forwardMsg)
                                method = 'icqq_private_via_group'

                                if (result) {
                                    return {
                                        success: true,
                                        message_id: result.message_id,
                                        res_id: result.res_id,
                                        method,
                                        node_count: messages.length,
                                        target: { type: 'private', id: targetUserId }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (target?.makeForwardMsg && target?.sendMsg) {
                const forwardMsg = applyDisplay(await target.makeForwardMsg(icqqNodes))
                result = await target.sendMsg(forwardMsg)
                method = 'icqq'

                if (result) {
                    return {
                        success: true,
                        message_id: result.message_id,
                        res_id: result.res_id,
                        method,
                        node_count: messages.length,
                        target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
                    }
                }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    // 方式3: 直接Bot方法
    const legacyMethod = isGroup
        ? _bot.sendGroupForwardMsg || _bot.send_group_forward_msg
        : _bot.sendPrivateForwardMsg || _bot.send_private_forward_msg

    if (typeof legacyMethod === 'function') {
        try {
            const targetId = isGroup ? parseInt(targetGroupId) : parseInt(targetUserId)
            result = await legacyMethod.call(_bot, targetId, nodes)
            method = 'legacy'

            if (result) {
                return {
                    success: true,
                    message_id: result.message_id,
                    res_id: result.res_id,
                    method,
                    node_count: nodes.length,
                    target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
                }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    return {
        success: false,
        error: lastError || '当前环境不支持发送合并转发消息',
        tried_methods: ['sendApi', 'icqq', 'legacy'],
        target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
    }
}

/**
 * 发送卡片消息
 * @param {Object} options
 * @param {Object} options.bot - Bot实例
 * @param {Object} options.event - 事件对象
 * @param {number|string} options.groupId - 群号
 * @param {number|string} options.userId - 用户QQ
 * @param {string} options.type - 卡片类型: 'json' | 'xml'
 * @param {string|Object} options.data - 卡片数据
 * @returns {Promise<Object>}
 */
export async function sendCardMessage({ bot, event, groupId, userId, type = 'json', data }) {
    const _bot = bot || event?.bot || global.Bot
    if (!_bot) throw new Error('无法获取Bot实例')

    const targetGroupId = groupId || event?.group_id
    const targetUserId = userId || event?.user_id
    const protocol = detectProtocol(_bot)
    const isIcqq = protocol === 'icqq'

    // 构建卡片消息段
    let cardData = data
    if (type === 'json' && typeof data === 'object') {
        cardData = JSON.stringify(data)
    }

    const cardSeg = isIcqq ? { type, data: cardData } : { type, data: { data: cardData } }

    let result = null
    let lastError = null

    // 优先 icqq
    if (isIcqq && (_bot.pickGroup || _bot.pickFriend)) {
        try {
            if (targetGroupId && _bot.pickGroup) {
                result = await _bot.pickGroup(parseInt(targetGroupId))?.sendMsg(cardSeg)
            } else if (targetUserId && _bot.pickFriend) {
                result = await _bot.pickFriend(parseInt(targetUserId))?.sendMsg(cardSeg)
            }
            if (result?.message_id) {
                return { success: true, message_id: result.message_id, protocol: 'icqq' }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    // sendApi
    if (_bot.sendApi) {
        try {
            if (targetGroupId) {
                result = await _bot.sendApi('send_group_msg', {
                    group_id: parseInt(targetGroupId),
                    message: [cardSeg]
                })
            } else if (targetUserId) {
                result = await _bot.sendApi('send_private_msg', {
                    user_id: parseInt(targetUserId),
                    message: [cardSeg]
                })
            }
            if (result?.message_id || result?.data?.message_id) {
                return {
                    success: true,
                    message_id: result.message_id || result.data?.message_id,
                    protocol: 'onebot'
                }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    // event.reply
    if (event?.reply) {
        try {
            result = await event.reply(cardSeg)
            if (result?.message_id) {
                return { success: true, message_id: result.message_id, protocol: 'reply' }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    return { success: false, error: lastError || '发送失败' }
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
 * 解析 OneBot get_group_member_info 响应
 * @param {Object} info - sendApi 返回值
 * @returns {{ role: 'owner'|'admin'|'member'|'unknown' }|null} 解析失败返回 null；role 不可判定时为 unknown
 */
function parseOneBotGetGroupMemberInfo(info) {
    if (!info || info.status === 'failed') return null
    const retcode = info.retcode ?? info.retCode
    if (retcode !== undefined && retcode !== 0) return null
    const roleRaw = info.data?.role ?? info.role
    if (roleRaw === undefined || roleRaw === null) return null
    return { role: normalizeMemberRole(roleRaw) }
}

/**
 * 从 icqq Map 中按 QQ 号取成员（兼容 number / string key）
 * @param {Map|undefined} memberMap
 * @param {number} uid
 * @returns {object|undefined}
 */
function getMemberFromIcqqMap(memberMap, uid) {
    if (!memberMap || typeof memberMap.get !== 'function') return undefined
    return memberMap.get(uid) ?? memberMap.get(String(uid)) ?? memberMap.get(Number(uid))
}

/**
 * icqq：通过 getMemberMap 拉取成员身份（优先于 gl / 同步 pickMember.info）
 * @returns {Promise<'owner'|'admin'|'member'|null>}
 */
async function getIcqqMemberRoleFromMemberMap(bot, groupId, userId) {
    if (!bot?.pickGroup) return null
    const gid = parseInt(groupId, 10)
    const uid = parseInt(userId, 10)
    if (Number.isNaN(gid) || Number.isNaN(uid)) return null
    try {
        const group = bot.pickGroup(gid)
        if (!group?.getMemberMap) return null
        const memberMap = await group.getMemberMap()
        const memberData = getMemberFromIcqqMap(memberMap, uid)
        if (!memberData) return null
        const roleRaw = memberData.role
        if (roleRaw === undefined || roleRaw === null) return null
        return normalizeMemberRole(roleRaw)
    } catch (e) {
        logger.debug(`[helpers] getIcqqMemberRoleFromMemberMap: ${e.message}`)
        return null
    }
}

/**
 * 将 icqq 解析出的角色写入 getBotPermission 结果对象
 * @param {object} result - getBotPermission 的结果对象，就地修改
 * @param {'owner'|'admin'|'member'|'unknown'} role - 规范化角色；unknown 会保留在 result 上，由调用方继续兜底
 * @returns {void}
 */
function applyRoleToBotPermissionResult(result, role) {
    result.inGroup = true
    result.role = role
    result.isOwner = role === 'owner'
    result.isAdmin = role === 'owner' || role === 'admin'
}

/**
 * 获取群成员角色（优先 OneBot API，避免 gl 缓存不准）
 * @param {Object} bot
 * @param {number|string} groupId
 * @param {number|string} userId
 * @returns {Promise<'owner'|'admin'|'member'|'unknown'>}
 */
export async function getGroupMemberRoleFromBot(bot, groupId, userId) {
    if (!bot || groupId == null || userId == null) return 'unknown'
    const gid = parseInt(groupId, 10)
    const uid = parseInt(userId, 10)
    if (Number.isNaN(gid) || Number.isNaN(uid)) return 'unknown'

    try {
        if (bot.sendApi) {
            try {
                const info = await bot.sendApi('get_group_member_info', {
                    group_id: gid,
                    user_id: uid
                })
                const parsed = parseOneBotGetGroupMemberInfo(info)
                // role 无法判定时不能直接返回，继续走后面的兜底来源
                if (parsed && parsed.role !== 'unknown') return parsed.role
            } catch (e) {
                logger.debug(`[helpers] getGroupMemberRoleFromBot API: ${e.message}`)
            }
        }

        const icqqRole = await getIcqqMemberRoleFromMemberMap(bot, gid, uid)
        if (icqqRole && icqqRole !== 'unknown') return icqqRole

        const groupInfo = bot.gl?.get(gid)
        if (groupInfo?.owner_id != null && String(groupInfo.owner_id) === String(uid)) {
            return 'owner'
        }

        if (bot.pickGroup) {
            try {
                const group = bot.pickGroup(gid)
                const memberInfo = group?.pickMember?.(uid)?.info
                if (memberInfo?.role) {
                    const picked = normalizeMemberRole(memberInfo.role)
                    if (picked !== 'unknown') return picked
                }
                const admins = group?.admin_list || []
                if (admins.some(a => String(a) === String(uid))) return 'admin'
            } catch (e) {
                // 忽略
            }
        }

        /*
         * 所有来源都没能定位到该成员时返回 unknown 而非 'member'。
         * 返回 'member' 意味着"已确认目标是普通成员"，会让上层的群主/管理员保护判定
         * 直接通过——查询失败与"确认是普通成员"必须区分开，由调用方 fail-closed。
         */
        return 'unknown'
    } catch (e) {
        logger.debug(`[helpers] getGroupMemberRoleFromBot: ${e.message}`)
    }
    return 'unknown'
}

/**
 * 获取 Bot 在指定群内的权限信息
 * @param {Object} bot - Bot实例
 * @param {number|string} groupId - 群号
 * @returns {Promise<{role: 'owner'|'admin'|'member'|'unknown', isAdmin: boolean, isOwner: boolean, canKick: boolean, canMute: boolean, canRecall: boolean}>}
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

    const gid = parseInt(groupId)
    const botId = bot.uin || bot.self_id
    const botUid = Number.isNaN(Number(botId)) ? botId : Number(botId)

    try {
        // 优先 OneBot API（与 QQ 侧一致，避免 gl 中 admin_flag 等缓存错误导致误判）
        if (bot.sendApi) {
            try {
                const info = await bot.sendApi('get_group_member_info', {
                    group_id: gid,
                    user_id: botUid
                })
                const parsed = parseOneBotGetGroupMemberInfo(info)
                if (parsed) {
                    result.inGroup = true
                    result.role = parsed.role
                    result.isOwner = parsed.role === 'owner'
                    result.isAdmin = parsed.role === 'owner' || parsed.role === 'admin'
                }
            } catch (e) {
                logger.debug(`[helpers] getBotPermission API: ${e.message}`)
            }
        }

        // icqq：getMemberMap 拉取 Bot 自身身份（优先于同步 pickMember.info / gl）
        if (result.role === 'unknown') {
            const icqqRole = await getIcqqMemberRoleFromMemberMap(bot, gid, botUid)
            if (icqqRole) applyRoleToBotPermissionResult(result, icqqRole)
        }

        // 再尝试同步 pickMember.info
        if (result.role === 'unknown' && bot.pickGroup) {
            try {
                const group = bot.pickGroup(gid)
                const memberInfo = group?.pickMember?.(botId)?.info ?? group?.pickMember?.(botUid)?.info
                if (memberInfo) {
                    const mr = normalizeMemberRole(memberInfo.role)
                    applyRoleToBotPermissionResult(result, mr)
                }
            } catch (e) {
                // 忽略错误
            }
        }

        // 最后使用 gl 缓存
        if (result.role === 'unknown') {
            const groupInfo = bot.gl?.get(gid)
            if (groupInfo) {
                result.inGroup = true
                if (groupInfo.owner_id != null && String(groupInfo.owner_id) === String(botId)) {
                    result.role = 'owner'
                    result.isOwner = true
                    result.isAdmin = true
                } else if (groupInfo.admin_flag) {
                    result.role = 'admin'
                    result.isAdmin = true
                } else {
                    result.role = 'member'
                }
            }
        }

        // 设置权限能力
        if (result.isOwner) {
            result.canKick = true
            result.canMute = true
            result.canRecall = true
            result.canSetCard = true
            result.canSetTitle = true
        } else if (result.isAdmin) {
            result.canKick = true
            result.canMute = true
            result.canRecall = true
            result.canSetCard = true
            result.canSetTitle = false // 只有群主能设置头衔
        }
    } catch (e) {
        logger.debug(`[helpers] getBotPermission error: ${e.message}`)
    }

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
 * @returns {number} 群号
 * @throws {Error} 缺少群号时抛出
 */
export function requireGroupId(args, ctx) {
    const gid = args.group_id || ctx.getEvent?.()?.group_id || ctx.getEvent?.()?.group?.group_id
    if (!gid) throw new Error('缺少群号 group_id')
    return parseInt(gid)
}
