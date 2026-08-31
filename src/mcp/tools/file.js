/**
 * 文件操作工具
 */

import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import {
    resolveSandboxPath,
    PLUGIN_ROOT,
    assertSafeUrl,
    sanitizeCrossOriginRedirectHeaders,
    sanitizeRequestHeaders
} from './helpers.js'
import { StandardBotApi, StandardFileApi } from '../../core/platform/index.js'

/** read_file 默认读取上限（字节） */
const DEFAULT_READ_MAX_SIZE = 1024 * 1024

/** read_file 读取硬上限（字节），调用方无法突破 */
const READ_MAX_SIZE_CAP = 32 * 1024 * 1024

/** 下载到本地的文件大小硬上限（字节） */
const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024

/** 下载请求超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 60000

/** 受管临时下载文件的默认保留时间（毫秒） */
export const MANAGED_DOWNLOAD_TTL_MS = 10 * 60 * 1000

/** 受管临时下载目录的清理周期（毫秒） */
const MANAGED_DOWNLOAD_SWEEP_INTERVAL_MS = 60 * 1000

/** 单次下载允许的最大重定向次数 */
const DOWNLOAD_MAX_REDIRECTS = 5

/** 仅用于模型工具临时下载、发送后可安全清理的受管目录 */
export const MANAGED_DOWNLOAD_DIR = path.join(PLUGIN_ROOT, 'data', 'temp', 'tool-downloads')

/** @type {Map<string, number>} 绝对路径 -> 到期时间 */
const temporaryDownloads = new Map()

/** @type {NodeJS.Timeout | undefined} */
let managedDownloadCleanupTimer

/** list_directory 默认返回条目上限 */
const DEFAULT_LIST_LIMIT = 200

/** list_directory 返回条目硬上限 */
const LIST_LIMIT_CAP = 2000

const DANGEROUS_PATHS_WINDOWS = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\Users\\Default',
    'C:\\Users\\Public',
    'C:\\System Volume Information',
    'C:\\$Recycle.Bin',
    'C:\\Recovery',
    'C:\\Boot'
]

const DANGEROUS_PATHS_LINUX = [
    '/bin',
    '/sbin',
    '/usr/bin',
    '/usr/sbin',
    '/usr/lib',
    '/usr/lib64',
    '/lib',
    '/lib64',
    '/boot',
    '/etc',
    '/root',
    '/sys',
    '/proc',
    '/dev',
    '/run',
    '/var/run',
    '/var/lib',
    '/snap'
]

const isWindows = process.platform === 'win32'
const DANGEROUS_PATHS = isWindows ? DANGEROUS_PATHS_WINDOWS : DANGEROUS_PATHS_LINUX

function isPathDangerous(targetPath) {
    const resolved = path.resolve(targetPath).toLowerCase()
    const normalizedDangerous = DANGEROUS_PATHS.map(p => path.resolve(p).toLowerCase())

    for (const dangerous of normalizedDangerous) {
        if (resolved === dangerous || resolved.startsWith(dangerous + path.sep)) {
            return true
        }
    }
    return false
}

/**
 * 将路径解析到插件沙箱内并做危险目录二次检查
 * 沙箱根为插件根目录；相对路径以插件根目录为基准，绝对路径必须落在沙箱内
 * @param {string} targetPath - 目标路径
 * @returns {string} 解析后的绝对路径
 * @throws {Error} 越出沙箱或命中系统关键目录时抛出
 */
function getSafePath(targetPath) {
    // 沙箱根校验（含符号链接解析），越界直接抛错
    const resolved = resolveSandboxPath(targetPath, { root: PLUGIN_ROOT })
    // 保留原有系统目录黑名单作为额外一层防护
    if (isPathDangerous(resolved)) {
        throw new Error(`禁止操作系统关键目录: ${targetPath}`)
    }
    return resolved
}

/**
 * 校验用于发送/上传的文件引用
 * http(s) 链接直接放行；本地路径与 file:// 路径必须位于插件沙箱内
 * @param {string} fileRef - 文件引用（URL、file:// 路径或本地路径）
 * @returns {string} 规范化后的文件引用（本地路径会被替换为沙箱内绝对路径）
 * @throws {Error} 本地路径越出沙箱时抛出
 */
function resolveOutboundFileRef(fileRef) {
    if (typeof fileRef !== 'string' || fileRef.trim() === '') {
        throw new Error('文件路径不能为空')
    }
    const ref = fileRef.trim()

    if (/^https?:\/\//i.test(ref)) return ref
    if (/^base64:\/\//i.test(ref) || ref.startsWith('data:')) return ref

    if (/^file:\/\//i.test(ref)) {
        // file://C:/x 与 file:///path/x 两种写法都需要还原成本地路径
        let localPath = ref.slice('file://'.length)
        if (/^\/[a-zA-Z]:/.test(localPath)) localPath = localPath.slice(1)
        return `file://${getSafePath(decodeURIComponent(localPath))}`
    }

    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(ref)) {
        throw new Error(`不支持的文件协议: ${ref.split('://')[0]}`)
    }

    return getSafePath(ref)
}

/**
 * 规范化下载文件名：强制取基名并剔除非法字符
 * 用于处理模型给出的 filename 与协议端返回的群文件名（二者均不可信）
 * @param {string} rawName - 原始文件名
 * @returns {string} 安全的纯文件名
 */
function sanitizeDownloadFilename(rawName) {
    const base = path
        // Windows 风格分隔符也要剥掉，避免 Linux 下 basename 不识别
        .basename(String(rawName || '').replace(/\\/g, '/'))
        // 控制字符与 Windows 非法文件名字符
        .replace(/[\x00-\x1f<>:"|?*]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 180)
    if (!base || base === '.' || base === '..') return 'downloaded_file'
    return base
}

/**
 * 解析下载工具的 headers 参数。
 * @param {string|Object|undefined} rawHeaders - JSON 字符串或普通对象
 * @returns {Record<string, string>} 可传给 fetch 的请求头
 */
export function parseDownloadHeaders(rawHeaders) {
    if (rawHeaders === undefined || rawHeaders === null || rawHeaders === '') return {}

    let parsed = rawHeaders
    if (typeof rawHeaders === 'string') {
        try {
            parsed = JSON.parse(rawHeaders)
        } catch {
            throw new Error('headers 必须是有效的 JSON 对象')
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('headers 必须是对象')
    }

    return sanitizeRequestHeaders(parsed)
}

/**
 * 跨源重定向时剥离认证类请求头，避免把源站凭据发送给另一站点。
 * @param {Record<string, string>} headers - 已经过基础黑名单过滤的请求头
 * @returns {Record<string, string>} 可安全跨源携带的请求头
 */
export function stripCrossOriginSensitiveHeaders(headers) {
    return sanitizeCrossOriginRedirectHeaders(headers)
}

/**
 * 将本地文件引用解析为插件沙箱内的绝对路径；远程引用返回 null。
 * @param {string} fileRef - 本地路径或 file:// 引用
 * @returns {string|null} 绝对路径
 */
function resolveLocalFilePath(fileRef) {
    if (typeof fileRef !== 'string' || !fileRef.trim()) return null
    const ref = fileRef.trim()
    if (/^(?:https?:|data:|base64:)/i.test(ref)) return null

    if (/^file:\/\//i.test(ref)) {
        let localPath = ref.slice('file://'.length)
        if (/^\/[a-zA-Z]:/.test(localPath)) localPath = localPath.slice(1)
        return getSafePath(decodeURIComponent(localPath))
    }
    return getSafePath(ref)
}

/**
 * 判断路径是否位于受管下载目录内。
 * @param {string} filePath - 绝对路径
 * @returns {boolean} 是否属于受管目录
 */
function isManagedDownloadPath(filePath) {
    const relative = path.relative(MANAGED_DOWNLOAD_DIR, filePath)
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

/**
 * 注册一个需要自动清理的临时下载。
 * 显式 save_path 只有调用方传入 cleanup=true 时才会进入此表。
 * @param {string} filePath - 插件沙箱内的文件路径
 * @param {number} [ttlMs=MANAGED_DOWNLOAD_TTL_MS] - 保留时间
 * @returns {{filePath: string, expiresAt: number}} 注册结果
 */
export function registerTemporaryDownload(filePath, ttlMs = MANAGED_DOWNLOAD_TTL_MS) {
    const resolved = getSafePath(filePath)
    const normalizedTtl = Number(ttlMs)
    const expiresAt =
        Date.now() + (Number.isFinite(normalizedTtl) && normalizedTtl > 0 ? normalizedTtl : MANAGED_DOWNLOAD_TTL_MS)
    temporaryDownloads.set(resolved, expiresAt)
    return { filePath: resolved, expiresAt }
}

/**
 * 查询文件是否已登记为临时下载。
 * @param {string} fileRef - 本地文件引用
 * @returns {boolean} 是否已登记
 */
export function isTemporaryDownload(fileRef) {
    try {
        const resolved = resolveLocalFilePath(fileRef)
        return !!resolved && temporaryDownloads.has(resolved)
    } catch {
        return false
    }
}

/**
 * 清理一个受管或已登记的临时下载。
 * @param {string} fileRef - 本地文件引用
 * @param {Object} [options] - 清理选项
 * @param {boolean} [options.allowManagedDirectory=true] - 是否允许清理受管目录中的启动残留
 * @returns {Promise<boolean>} 是否完成清理
 */
export async function cleanupTemporaryDownload(fileRef, options = {}) {
    const cleanupOptions = { allowManagedDirectory: true, ...options }
    const { allowManagedDirectory } = cleanupOptions
    let resolved
    try {
        resolved = resolveLocalFilePath(fileRef)
    } catch {
        return false
    }
    if (!resolved) return false
    if (!temporaryDownloads.has(resolved) && !(allowManagedDirectory && isManagedDownloadPath(resolved))) {
        return false
    }

    try {
        await fs.promises.rm(resolved, { force: true })
        temporaryDownloads.delete(resolved)
        return true
    } catch {
        return false
    }
}

/**
 * 清理到期登记项和受管目录中的启动残留。
 * @param {number} [now=Date.now()] - 当前时间，测试可注入
 * @returns {Promise<number>} 成功清理的文件数
 */
export async function sweepManagedDownloads(now = Date.now()) {
    await fs.promises.mkdir(MANAGED_DOWNLOAD_DIR, { recursive: true })
    let cleaned = 0

    for (const [filePath, expiresAt] of temporaryDownloads.entries()) {
        if (expiresAt > now) continue
        if (await cleanupTemporaryDownload(filePath)) cleaned++
    }

    const entries = await fs.promises.readdir(MANAGED_DOWNLOAD_DIR, { withFileTypes: true })
    for (const entry of entries) {
        if (!entry.isFile()) continue
        const filePath = path.join(MANAGED_DOWNLOAD_DIR, entry.name)
        let expiresAt = temporaryDownloads.get(filePath)
        if (!expiresAt) {
            try {
                const stat = await fs.promises.stat(filePath)
                expiresAt = stat.mtimeMs + MANAGED_DOWNLOAD_TTL_MS
                temporaryDownloads.set(filePath, expiresAt)
            } catch {
                continue
            }
        }
        if (expiresAt <= now && (await cleanupTemporaryDownload(filePath))) cleaned++
    }

    return cleaned
}

/**
 * 启动受管下载清理器。计时器会 unref，不阻止 Node.js 退出。
 * @returns {NodeJS.Timeout} 清理计时器
 */
export function startManagedDownloadCleanup() {
    if (managedDownloadCleanupTimer) return managedDownloadCleanupTimer

    fs.mkdirSync(MANAGED_DOWNLOAD_DIR, { recursive: true })
    void sweepManagedDownloads().catch(() => {})
    const timer = setInterval(() => {
        void sweepManagedDownloads().catch(() => {})
    }, MANAGED_DOWNLOAD_SWEEP_INTERVAL_MS)
    timer.unref?.()
    managedDownloadCleanupTimer = timer
    return timer
}

/**
 * 停止受管下载清理器，供测试和显式关闭流程调用。
 */
export function stopManagedDownloadCleanup() {
    if (!managedDownloadCleanupTimer) return
    clearInterval(managedDownloadCleanupTimer)
    managedDownloadCleanupTimer = undefined
}

/**
 * 连接一个已经完成 DNS 安全校验的 URL。
 * 请求仍使用原始 URL 生成 Host 和 HTTPS SNI，但 lookup 只能返回 safeAddresses，
 * 同时禁用全局 Agent，避免复用未经过本次地址校验的旧连接。
 * @param {URL & {safeAddresses?: Array<{address: string, family: number}>}} safeUrl - 已校验 URL
 * @param {Object} options - 请求选项
 * @param {Record<string, string>} options.headers - 请求头
 * @param {string} options.method - HTTP 方法
 * @param {AbortSignal} options.signal - 整条下载链共享的超时信号
 * @returns {Promise<{status: number, statusText: string, ok: boolean, headers: Headers, body: ReadableStream}>} 流式响应
 */
function requestPinnedDownloadOnce(safeUrl, options) {
    const addresses = Array.isArray(safeUrl.safeAddresses)
        ? safeUrl.safeAddresses.filter(item => item && typeof item.address === 'string' && [4, 6].includes(item.family))
        : []
    if (addresses.length === 0) throw new Error('下载地址没有可用的已校验 IP')

    const headers = { ...(options.headers || {}) }
    if (!Object.keys(headers).some(key => key.toLowerCase() === 'accept-encoding')) {
        headers['Accept-Encoding'] = 'identity'
    }

    const transport = safeUrl.protocol === 'https:' ? https : http
    const tlsHostname = safeUrl.hostname.replace(/^\[/, '').replace(/\]$/, '')
    return new Promise((resolve, reject) => {
        let responseStarted = false
        const request = transport.request(
            safeUrl,
            {
                method: options.method || 'GET',
                headers,
                signal: options.signal,
                agent: false,
                ...(safeUrl.protocol === 'https:' && !net.isIP(tlsHostname) ? { servername: tlsHostname } : {}),
                lookup(_hostname, lookupOptions, callback) {
                    if (lookupOptions?.all) {
                        callback(null, addresses)
                        return
                    }
                    const requestedFamily =
                        typeof lookupOptions === 'number' ? lookupOptions : Number(lookupOptions?.family) || 0
                    const selected =
                        addresses.find(item => !requestedFamily || item.family === requestedFamily) || addresses[0]
                    callback(null, selected.address, selected.family)
                }
            },
            incoming => {
                responseStarted = true
                const responseHeaders = new Headers()
                for (const [key, value] of Object.entries(incoming.headers)) {
                    if (Array.isArray(value)) value.forEach(item => responseHeaders.append(key, item))
                    else if (value !== undefined) responseHeaders.set(key, String(value))
                }

                const status = incoming.statusCode || 0
                resolve({
                    status,
                    statusText: incoming.statusMessage || '',
                    ok: status >= 200 && status < 300,
                    headers: responseHeaders,
                    body: Readable.toWeb(incoming)
                })
            }
        )
        request.once('error', error => {
            if (!responseStarted) reject(error)
        })
        request.end()
    })
}

/**
 * 逐跳校验重定向目标后下载，避免安全 URL 经重定向落到内网。
 * @param {string|URL} rawUrl - 初始 URL
 * @param {Object} [options] - 下载选项
 * @param {Record<string, string>} [options.headers] - 请求头
 * @param {string} [options.method='GET'] - HTTP 方法
 * @param {number} [options.timeoutMs=DOWNLOAD_TIMEOUT_MS] - 整条重定向链和响应流超时
 * @param {Function} [options.lookup] - DNS 查询函数，仅供受控测试或运行时注入
 * @returns {Promise<{response: {status: number, statusText: string, ok: boolean, headers: Headers, body: ReadableStream}, finalUrl: URL}>} 最终响应和 URL
 */
export async function fetchDownloadResponse(rawUrl, options = {}) {
    const fetchOptions = {
        headers: {},
        method: 'GET',
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
        lookup: undefined,
        ...options
    }
    const requestedTimeout = Number(fetchOptions.timeoutMs)
    const timeoutMs = Number.isFinite(requestedTimeout) && requestedTimeout > 0 ? requestedTimeout : DOWNLOAD_TIMEOUT_MS
    const signal = AbortSignal.timeout(timeoutMs)
    let requestHeaders = sanitizeRequestHeaders(fetchOptions.headers)
    let currentUrl = await assertSafeUrl(String(rawUrl), fetchOptions.lookup)

    for (let redirectCount = 0; redirectCount <= DOWNLOAD_MAX_REDIRECTS; redirectCount++) {
        const response = await requestPinnedDownloadOnce(currentUrl, {
            headers: requestHeaders,
            method: fetchOptions.method,
            signal
        })
        if (![301, 302, 303, 307, 308].includes(response.status)) {
            return { response, finalUrl: currentUrl }
        }

        const location = response.headers.get('location')
        try {
            await response.body?.cancel?.()
        } catch {}
        if (!location) throw new Error(`下载重定向缺少 Location（HTTP ${response.status}）`)
        if (redirectCount >= DOWNLOAD_MAX_REDIRECTS) {
            throw new Error(`下载重定向次数超过上限 ${DOWNLOAD_MAX_REDIRECTS}`)
        }
        const nextUrl = await assertSafeUrl(new URL(location, currentUrl).href, fetchOptions.lookup)
        if (nextUrl.origin !== currentUrl.origin) {
            requestHeaders = stripCrossOriginSensitiveHeaders(requestHeaders)
        }
        currentUrl = nextUrl
    }

    throw new Error(`下载重定向次数超过上限 ${DOWNLOAD_MAX_REDIRECTS}`)
}

/**
 * 从 Content-Disposition 或最终 URL 提取文件名。
 * @param {Response} response - 下载响应
 * @param {URL} finalUrl - 最终 URL
 * @param {string} [preferredName] - 调用方指定名称
 * @returns {string} 安全文件名
 */
function resolveDownloadFilename(response, finalUrl, preferredName) {
    if (preferredName) return sanitizeDownloadFilename(preferredName)

    const disposition = response.headers.get('content-disposition') || ''
    const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
    if (encoded) {
        try {
            return sanitizeDownloadFilename(decodeURIComponent(encoded.replace(/^"|"$/g, '')))
        } catch {}
    }
    const plain = disposition.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i)
    if (plain?.[1] || plain?.[2]) return sanitizeDownloadFilename(plain[1] || plain[2])

    try {
        return sanitizeDownloadFilename(decodeURIComponent(path.basename(finalUrl.pathname)))
    } catch {
        return 'downloaded_file'
    }
}

/**
 * 将远程响应流式写入本地文件，并施加大小上限
 * @param {Response} response - fetch 响应
 * @param {string} fullPath - 目标文件绝对路径
 * @returns {Promise<number>} 已写入字节数
 * @throws {Error} 超过大小上限时抛出（并清理半成品文件）
 */
export async function saveResponseToFile(response, fullPath, options = {}) {
    const saveOptions = { overwrite: false, maxBytes: undefined, ...options }
    const { overwrite } = saveOptions
    const requestedMaxBytes = Number(saveOptions.maxBytes)
    const maxBytes =
        Number.isFinite(requestedMaxBytes) && requestedMaxBytes > 0
            ? Math.min(requestedMaxBytes, DOWNLOAD_MAX_BYTES)
            : DOWNLOAD_MAX_BYTES
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new Error(`文件过大 (${declared} bytes)，超过上限 ${maxBytes} bytes`)
    }
    if (!response.body) {
        throw new Error('响应体为空')
    }

    let written = 0
    const limited = async function* () {
        for await (const chunk of response.body) {
            written += chunk.length
            if (written > maxBytes) {
                throw new Error(`文件过大，超过上限 ${maxBytes} bytes`)
            }
            yield chunk
        }
    }

    if (!overwrite && fs.existsSync(fullPath)) throw new Error(`文件已存在: ${fullPath}`)

    const partPath = `${fullPath}.${randomUUID()}.part`
    let backupPath = ''
    try {
        // 下载内容可能包含用户文件或凭据，临时文件与最终文件均仅允许当前进程用户读取。
        await pipeline(Readable.from(limited()), fs.createWriteStream(partPath, { flags: 'wx', mode: 0o600 }))
        if (!overwrite && fs.existsSync(fullPath)) throw new Error(`文件已存在: ${fullPath}`)

        // Windows 无法用 rename 直接覆盖已存在目标。先在同目录备份旧文件，
        // part 提升成功后再删除备份；任一步失败都把旧文件恢复到原路径。
        if (overwrite && fs.existsSync(fullPath)) {
            backupPath = `${fullPath}.${randomUUID()}.backup`
            await fs.promises.rename(fullPath, backupPath)
        }
        await fs.promises.rename(partPath, fullPath)
        if (backupPath) {
            await fs.promises.rm(backupPath, { force: true })
            backupPath = ''
        }
    } catch (err) {
        await fs.promises.rm(partPath, { force: true }).catch(() => {})
        if (backupPath) {
            try {
                await fs.promises.rm(fullPath, { force: true })
                await fs.promises.rename(backupPath, fullPath)
                backupPath = ''
            } catch (restoreError) {
                err.message = `${err.message}；旧文件恢复失败，备份保留在 ${backupPath}: ${restoreError.message}`
            }
        }
        throw err
    }
    return written
}

/**
 * 把远程文件下载到受管临时目录，并登记发送后/TTL 清理。
 * @param {string} url - 远程 URL
 * @param {Object} [options] - 下载选项
 * @param {string} [options.filename] - 首选文件名
 * @param {string|Object} [options.headers] - 请求头
 * @param {number} [options.ttlMs] - 保留时间
 * @param {number} [options.maxBytes] - 文件大小上限，不得超过全局硬上限
 * @param {number} [options.timeoutMs] - 整条重定向链和响应流超时
 * @param {Function} [options.lookup] - DNS 查询函数，仅供受控测试或运行时注入
 * @returns {Promise<{filePath: string, fileName: string, size: number, url: string, contentType: string, expiresAt: number}>} 下载结果
 */
export async function downloadToManagedCache(url, options = {}) {
    const downloadOptions = {
        filename: undefined,
        headers: undefined,
        ttlMs: undefined,
        maxBytes: undefined,
        timeoutMs: undefined,
        lookup: undefined,
        ...options
    }
    startManagedDownloadCleanup()
    const headers = parseDownloadHeaders(downloadOptions.headers)
    const { response, finalUrl } = await fetchDownloadResponse(url, {
        headers,
        timeoutMs: downloadOptions.timeoutMs,
        lookup: downloadOptions.lookup
    })
    if (!response.ok) {
        try {
            await response.body?.cancel?.()
        } catch {}
        throw new Error(`下载失败: HTTP ${response.status}`)
    }

    const fileName = resolveDownloadFilename(response, finalUrl, downloadOptions.filename)
    const filePath = path.join(MANAGED_DOWNLOAD_DIR, `${randomUUID()}-${fileName}`)
    try {
        const size = await saveResponseToFile(response, filePath, { maxBytes: downloadOptions.maxBytes })
        const registered = registerTemporaryDownload(filePath, downloadOptions.ttlMs)
        return {
            filePath,
            fileName,
            size,
            url: finalUrl.href,
            contentType: response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream',
            expiresAt: registered.expiresAt
        }
    } catch (error) {
        await fs.promises.rm(filePath, { force: true }).catch(() => {})
        throw error
    }
}

startManagedDownloadCleanup()

export const fileTools = [
    {
        name: 'get_group_files',
        description: '获取群文件列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                folder_id: { type: 'string', description: '文件夹ID，不填表示根目录' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                const files = await filesApi.listGroupFiles(groupId, args.folder_id || '/')

                const result = (files || []).map(f => ({
                    name: f.name || f.file_name,
                    id: f.id || f.fid || f.file_id,
                    size: f.size || f.file_size,
                    type: f.type || (f.is_dir ? 'folder' : 'file'),
                    upload_time: f.upload_time || f.create_time,
                    uploader: f.uploader || f.uploader_uin || f.user_id
                }))

                return {
                    success: true,
                    adapter: filesApi.adapterType,
                    group_id: groupId,
                    count: result.length,
                    files: result
                }
            } catch (err) {
                return { success: false, error: `获取群文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_file_url',
        description: '获取群文件下载链接',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' }
            },
            required: ['group_id', 'file_id']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                const url = await filesApi.getGroupFileUrl(groupId, args.file_id)

                return { success: true, adapter: filesApi.adapterType, group_id: groupId, file_id: args.file_id, url }
            } catch (err) {
                return {
                    success: false,
                    adapter: StandardFileApi.fromContext(ctx).adapterType,
                    group_id: StandardFileApi.fromContext(ctx).api.targetId(args.group_id),
                    error: `获取文件链接失败: ${err.message}`
                }
            }
        }
    },

    {
        name: 'upload_group_file',
        description: '上传文件到群（需要文件URL或本地路径）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_url: { type: 'string', description: '文件URL、本地路径或file://协议路径' },
                name: { type: 'string', description: '文件名' },
                folder_id: { type: 'string', description: '目标文件夹ID（可选）' }
            },
            required: ['group_id', 'file_url', 'name']
        },
        handler: async (args, ctx) => {
            let temporaryFilePath = ''
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                if (groupId === null || groupId === undefined || groupId === '') {
                    return { success: false, error: 'group_id 不能为空' }
                }
                const fileName = sanitizeDownloadFilename(args.name)
                // 本地路径必须位于插件沙箱内，防止把任意系统文件上传外发
                let fileRef = resolveOutboundFileRef(args.file_url)

                if (/^https?:\/\//i.test(fileRef)) {
                    const downloaded = await downloadToManagedCache(fileRef, { filename: fileName })
                    fileRef = downloaded.filePath
                    temporaryFilePath = downloaded.filePath
                } else {
                    const localPath = resolveLocalFilePath(fileRef)
                    if (localPath && temporaryDownloads.has(localPath)) temporaryFilePath = localPath
                }

                const sent = await filesApi.uploadGroupFile({
                    groupId,
                    file: fileRef,
                    name: fileName,
                    folderId: args.folder_id || '/'
                })

                return {
                    success: true,
                    adapter: filesApi.adapterType,
                    group_id: groupId,
                    name: fileName,
                    message_id: sent.message_id ?? null
                }
            } catch (err) {
                return { success: false, error: `上传文件失败: ${err.message}` }
            } finally {
                if (temporaryFilePath) await cleanupTemporaryDownload(temporaryFilePath)
            }
        }
    },

    {
        name: 'delete_group_file',
        description: '删除群文件',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' }
            },
            required: ['group_id', 'file_id']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                await filesApi.deleteGroupFile(groupId, args.file_id)

                return { success: true, group_id: groupId, file_id: args.file_id }
            } catch (err) {
                return { success: false, error: `删除文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'create_group_folder',
        description: '创建群文件夹',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                name: { type: 'string', description: '文件夹名称' },
                parent_id: { type: 'string', description: '父文件夹ID（可选）' }
            },
            required: ['group_id', 'name']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                await filesApi.createGroupFolder(groupId, args.name, args.parent_id || '/')

                return { success: true, group_id: groupId, name: args.name }
            } catch (err) {
                const filesApi = StandardFileApi.fromContext(ctx)
                return {
                    success: false,
                    adapter: filesApi.adapterType,
                    group_id: filesApi.api.targetId(args.group_id),
                    error: `创建文件夹失败: ${err.message}`
                }
            }
        }
    },

    {
        name: 'get_group_file_system_info',
        description: '获取群文件系统信息（用量、数量等）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                const data = await filesApi.getGroupFileSystemInfo(groupId)
                if (!data || typeof data !== 'object') throw new Error('协议端未返回有效的群文件系统信息')
                return { success: true, group_id: groupId, ...data }
            } catch (err) {
                const filesApi = StandardFileApi.fromContext(ctx)
                return {
                    success: false,
                    adapter: filesApi.adapterType,
                    group_id: filesApi.api.targetId(args.group_id),
                    error: `获取文件系统信息失败: ${err.message}`
                }
            }
        }
    },

    {
        name: 'get_group_root_files',
        description: '获取群根目录文件列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' }
            },
            required: ['group_id']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                const data = await filesApi.getGroupRootFiles(groupId)
                if (!data || (!Array.isArray(data.files) && !Array.isArray(data.folders))) {
                    throw new Error('协议端未返回有效的群文件根目录')
                }
                return {
                    success: true,
                    group_id: groupId,
                    files: Array.isArray(data.files) ? data.files : [],
                    folders: Array.isArray(data.folders) ? data.folders : []
                }
            } catch (err) {
                const filesApi = StandardFileApi.fromContext(ctx)
                return {
                    success: false,
                    adapter: filesApi.adapterType,
                    group_id: filesApi.api.targetId(args.group_id),
                    error: `获取根目录文件失败: ${err.message}`
                }
            }
        }
    },

    {
        name: 'get_group_files_by_folder',
        description: '获取群子目录文件列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                folder_id: { type: 'string', description: '文件夹ID' }
            },
            required: ['group_id', 'folder_id']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                const data = await filesApi.getGroupFolderFiles(groupId, args.folder_id)
                if (!data || (!Array.isArray(data.files) && !Array.isArray(data.folders))) {
                    throw new Error('协议端未返回有效的群文件子目录')
                }
                return {
                    success: true,
                    group_id: groupId,
                    folder_id: args.folder_id,
                    files: Array.isArray(data.files) ? data.files : [],
                    folders: Array.isArray(data.folders) ? data.folders : []
                }
            } catch (err) {
                const filesApi = StandardFileApi.fromContext(ctx)
                return {
                    success: false,
                    adapter: filesApi.adapterType,
                    group_id: filesApi.api.targetId(args.group_id),
                    error: `获取子目录文件失败: ${err.message}`
                }
            }
        }
    },

    {
        name: 'move_group_file',
        description: '移动群文件到其他文件夹',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' },
                parent_directory: { type: 'string', description: '源文件夹ID' },
                target_directory: { type: 'string', description: '目标文件夹ID' }
            },
            required: ['group_id', 'file_id', 'parent_directory', 'target_directory']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                await filesApi.moveGroupFile(groupId, args.file_id, args.parent_directory, args.target_directory)
                return { success: true, group_id: groupId, file_id: args.file_id }
            } catch (err) {
                const filesApi = StandardFileApi.fromContext(ctx)
                return {
                    success: false,
                    adapter: filesApi.adapterType,
                    group_id: filesApi.api.targetId(args.group_id),
                    error: `移动文件失败: ${err.message}`
                }
            }
        }
    },

    {
        name: 'rename_group_file',
        description: '重命名群文件',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' },
                new_name: { type: 'string', description: '新文件名' }
            },
            required: ['group_id', 'file_id', 'new_name']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                await filesApi.renameGroupFile(groupId, args.file_id, args.new_name)
                return { success: true, group_id: groupId, file_id: args.file_id, new_name: args.new_name }
            } catch (err) {
                const filesApi = StandardFileApi.fromContext(ctx)
                return {
                    success: false,
                    adapter: filesApi.adapterType,
                    group_id: filesApi.api.targetId(args.group_id),
                    error: `重命名文件失败: ${err.message}`
                }
            }
        }
    },

    {
        name: 'delete_group_folder',
        description: '删除群文件夹',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                folder_id: { type: 'string', description: '文件夹ID' }
            },
            required: ['group_id', 'folder_id']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                await filesApi.deleteGroupFolder(groupId, args.folder_id)
                return { success: true, group_id: groupId, folder_id: args.folder_id }
            } catch (err) {
                const filesApi = StandardFileApi.fromContext(ctx)
                return {
                    success: false,
                    adapter: filesApi.adapterType,
                    group_id: filesApi.api.targetId(args.group_id),
                    error: `删除文件夹失败: ${err.message}`
                }
            }
        }
    },

    {
        name: 'upload_private_file',
        description: '上传私聊文件',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '用户QQ号' },
                file_url: {
                    type: 'string',
                    description: '文件URL、本地路径或file://协议路径（如 file:///path/to/file）'
                },
                name: { type: 'string', description: '文件名' }
            },
            required: ['user_id', 'file_url', 'name']
        },
        handler: async (args, ctx) => {
            let temporaryFilePath = ''
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const userId = filesApi.api.targetId(args.user_id)
                if (userId === null || userId === undefined || userId === '') {
                    return { success: false, error: 'user_id 不能为空' }
                }
                const fileName = sanitizeDownloadFilename(args.name)
                // 本地路径必须位于插件沙箱内，防止把任意系统文件上传外发
                let fileRef = resolveOutboundFileRef(args.file_url)

                if (/^https?:\/\//i.test(fileRef)) {
                    const downloaded = await downloadToManagedCache(fileRef, { filename: fileName })
                    fileRef = downloaded.filePath
                    temporaryFilePath = downloaded.filePath
                } else {
                    const localPath = resolveLocalFilePath(fileRef)
                    if (localPath && temporaryDownloads.has(localPath)) temporaryFilePath = localPath
                }

                const sent = await filesApi.uploadPrivateFile({ userId, file: fileRef, name: fileName })
                return {
                    success: true,
                    adapter: filesApi.adapterType,
                    user_id: userId,
                    name: fileName,
                    message_id: sent.message_id ?? null
                }
            } catch (err) {
                return { success: false, error: `上传私聊文件失败: ${err.message}` }
            } finally {
                if (temporaryFilePath) await cleanupTemporaryDownload(temporaryFilePath)
            }
        }
    },

    {
        name: 'get_private_file_url',
        description: '获取私聊文件下载链接',
        inputSchema: {
            type: 'object',
            properties: {
                file_id: { type: 'string', description: '文件ID' }
            },
            required: ['file_id']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const url = await filesApi.getPrivateFileUrl(args.file_id)
                return { success: true, file_id: args.file_id, url }
            } catch (err) {
                return { success: false, error: `获取私聊文件链接失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_file',
        description: '下载文件到插件受管临时目录。文件发送成功或失败后会立即清理，未发送时按TTL自动清理。',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '文件URL' },
                filename: { type: 'string', description: '文件名（可选，默认从响应或URL提取）' },
                thread_count: { type: 'number', description: '线程数（可选）' },
                headers: {
                    oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' } }],
                    description: '自定义请求头JSON字符串或对象（可选）'
                },
                cleanup_after_seconds: {
                    type: 'number',
                    description: `未发送时自动清理的秒数，默认${MANAGED_DOWNLOAD_TTL_MS / 1000}秒`
                }
            },
            required: ['url']
        },
        handler: async args => {
            try {
                const ttlSeconds = Number(args.cleanup_after_seconds)
                const ttlMs =
                    Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds * 1000 : MANAGED_DOWNLOAD_TTL_MS
                const downloaded = await downloadToManagedCache(args.url, {
                    filename: args.filename,
                    headers: args.headers,
                    ttlMs
                })
                return {
                    success: true,
                    file: downloaded.filePath,
                    file_path: downloaded.filePath,
                    filename: downloaded.fileName,
                    url: downloaded.url,
                    size: downloaded.size,
                    mime_type: downloaded.contentType,
                    expires_at: downloaded.expiresAt,
                    cleanup: 'after_send_or_ttl'
                }
            } catch (err) {
                return { success: false, error: `下载文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_file_message',
        description: '发送文件消息（群聊或私聊）',
        inputSchema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    description:
                        '文件URL、本地路径或file://协议路径（如 file:///path/to/file 或 file://C:/path/to/file）'
                },
                name: { type: 'string', description: '显示的文件名' },
                target_type: { type: 'string', description: '目标类型: group/private', enum: ['group', 'private'] },
                target_id: { type: 'string', description: '目标群号或用户QQ' }
            },
            required: ['file', 'target_type', 'target_id']
        },
        handler: async (args, ctx) => {
            let temporaryFilePath = ''
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const targetId = filesApi.api.targetId(args.target_id)
                if (targetId === null || targetId === undefined || targetId === '') {
                    return { success: false, error: 'target_id 不能为空' }
                }
                const fileName = sanitizeDownloadFilename(args.name || args.file.split('/').pop() || 'file')
                // 本地路径必须位于插件沙箱内，防止把任意系统文件发到群/私聊
                let fileRef = resolveOutboundFileRef(args.file)

                // 远程 URL 统一缓存到插件受管目录，并在发送完成后清理。
                if (/^https?:\/\//i.test(fileRef)) {
                    const downloaded = await downloadToManagedCache(fileRef, { filename: fileName })
                    fileRef = downloaded.filePath
                    temporaryFilePath = downloaded.filePath
                } else {
                    const localPath = resolveLocalFilePath(fileRef)
                    if (localPath && temporaryDownloads.has(localPath)) temporaryFilePath = localPath
                }

                const sent =
                    args.target_type === 'group'
                        ? await filesApi.uploadGroupFile({ groupId: targetId, file: fileRef, name: fileName })
                        : await filesApi.uploadPrivateFile({ userId: targetId, file: fileRef, name: fileName })
                return {
                    success: true,
                    target: args.target_type,
                    target_id: targetId,
                    name: fileName,
                    method: sent.method,
                    message_id: sent.message_id ?? null
                }
            } catch (err) {
                return { success: false, error: `发送文件消息失败: ${err.message}` }
            } finally {
                if (temporaryFilePath) {
                    await cleanupTemporaryDownload(temporaryFilePath)
                }
            }
        }
    },

    {
        name: 'get_file',
        description: '获取文件信息（支持私聊和群聊文件）',
        inputSchema: {
            type: 'object',
            properties: {
                file_id: { type: 'string', description: '文件ID' }
            },
            required: ['file_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const result = await api.callFirstAction(['get_file', 'get_image'], {
                    file_id: args.file_id,
                    file: args.file_id
                })
                const data = result?.data || result
                if (!data?.file && !data?.url) return { success: false, error: '无法获取文件信息' }
                return {
                    success: true,
                    file_id: args.file_id,
                    file: data.file,
                    file_name: data.file_name,
                    file_size: data.file_size || data.size,
                    url: data.url
                }
            } catch (err) {
                return { success: false, error: `获取文件信息失败: ${err.message}` }
            }
        }
    },

    // get_record 已由 voice.js 统一实现（含 retcode 与空返回校验），此处不再重复注册

    {
        name: 'ocr_image',
        description: '图片OCR文字识别',
        inputSchema: {
            type: 'object',
            properties: {
                image: { type: 'string', description: '图片文件名、URL或base64' }
            },
            required: ['image']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const result = await api.callFirstAction(['ocr_image', '.ocr_image'], { image: args.image })
                const data = result?.data || result
                const texts = data?.wordslist || data?.texts || []
                if (!Array.isArray(texts) || texts.length === 0) return { success: false, error: 'OCR 未返回文字' }
                const normalized = texts.map(item => ({
                    text: item.words || item.text,
                    confidence: item.confidence,
                    coordinates: item.polygon || item.coordinates
                }))
                return {
                    success: true,
                    adapter: api.adapterType,
                    language: data.language || '',
                    texts: normalized,
                    full_text: normalized.map(item => item.text).join('\n')
                }
            } catch (err) {
                return { success: false, error: `OCR识别失败: ${err.message}` }
            }
        }
    },

    {
        name: 'can_send_record',
        description: '检查是否可以发送语音',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const result = await api.callAction('can_send_record', {})
                if (result === null) {
                    return { success: false, can_send: false, error: '协议端未确认语音发送能力' }
                }
                return { success: true, can_send: result?.data?.yes ?? result?.yes ?? false }
            } catch (err) {
                return { success: false, can_send: false, error: err.message }
            }
        }
    },

    {
        name: 'can_send_image',
        description: '检查是否可以发送图片',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const result = await api.callAction('can_send_image', {})
                if (result === null) {
                    return { success: false, can_send: false, error: '协议端未确认图片发送能力' }
                }
                return { success: true, can_send: result?.data?.yes ?? result?.yes ?? false }
            } catch (err) {
                return { success: false, can_send: false, error: err.message }
            }
        }
    },

    {
        name: 'read_file',
        description: '读取本地文件内容。支持文本文件读取，返回文件内容。路径限制在插件目录内，越界会被拒绝。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径（相对于插件根目录，或插件目录内的绝对路径）' },
                encoding: { type: 'string', description: '编码格式，默认utf8', default: 'utf8' },
                max_size: {
                    type: 'number',
                    description: `最大读取字节数，默认1MB，上限${READ_MAX_SIZE_CAP}`,
                    default: DEFAULT_READ_MAX_SIZE
                }
            },
            required: ['file_path']
        },
        handler: async args => {
            try {
                const filePath = getSafePath(args.file_path)
                const encoding = args.encoding || 'utf8'
                // max_size 由调用方指定，必须叠加硬上限，避免一次读入超大文件
                const maxSize = Math.min(Number(args.max_size) || DEFAULT_READ_MAX_SIZE, READ_MAX_SIZE_CAP)

                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `文件不存在: ${args.file_path}` }
                }

                const stats = fs.statSync(filePath)
                if (stats.isDirectory()) {
                    return { success: false, error: '目标是目录，请使用 list_directory' }
                }

                if (stats.size > maxSize) {
                    return { success: false, error: `文件过大 (${stats.size} bytes)，超过限制 ${maxSize} bytes` }
                }

                const content = fs.readFileSync(filePath, encoding)
                return {
                    success: true,
                    file_path: filePath,
                    size: stats.size,
                    content,
                    encoding
                }
            } catch (err) {
                return { success: false, error: `读取文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'write_file',
        description: '写入内容到本地文件。可以创建新文件或覆盖/追加到现有文件。路径限制在插件目录内，越界会被拒绝。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径（相对于插件根目录，或插件目录内的绝对路径）' },
                content: { type: 'string', description: '要写入的内容' },
                encoding: { type: 'string', description: '编码格式，默认utf8', default: 'utf8' },
                append: { type: 'boolean', description: '是否追加模式，默认false覆盖写入', default: false },
                create_dirs: { type: 'boolean', description: '是否自动创建目录，默认true', default: true }
            },
            required: ['file_path', 'content']
        },
        handler: async args => {
            try {
                const filePath = getSafePath(args.file_path)
                const encoding = args.encoding || 'utf8'
                const append = args.append || false
                const createDirs = args.create_dirs !== false

                if (createDirs) {
                    const dir = path.dirname(filePath)
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true })
                    }
                }

                if (append) {
                    fs.appendFileSync(filePath, args.content, encoding)
                } else {
                    fs.writeFileSync(filePath, args.content, encoding)
                }

                const stats = fs.statSync(filePath)
                return {
                    success: true,
                    file_path: filePath,
                    size: stats.size,
                    mode: append ? 'append' : 'write'
                }
            } catch (err) {
                return { success: false, error: `写入文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'list_directory',
        description: '列出目录中的文件和子目录。返回文件名、大小、类型等信息。路径限制在插件目录内。',
        inputSchema: {
            type: 'object',
            properties: {
                dir_path: { type: 'string', description: '目录路径，默认插件根目录', default: '.' },
                recursive: { type: 'boolean', description: '是否递归列出子目录', default: false },
                pattern: { type: 'string', description: '文件名过滤模式（如 *.txt）' },
                show_hidden: { type: 'boolean', description: '是否显示以 . 开头的隐藏文件，默认true', default: true },
                limit: {
                    type: 'integer',
                    description: `每层最多返回的条目数，默认${DEFAULT_LIST_LIMIT}`,
                    minimum: 1,
                    maximum: LIST_LIMIT_CAP
                }
            }
        },
        handler: async args => {
            try {
                const dirPath = getSafePath(args.dir_path || '.')
                const recursive = args.recursive || false
                const pattern = args.pattern
                const showHidden = args.show_hidden !== false
                const limit = Math.min(Math.max(Number(args.limit) || DEFAULT_LIST_LIMIT, 1), LIST_LIMIT_CAP)

                if (!fs.existsSync(dirPath)) {
                    return { success: false, error: `目录不存在: ${args.dir_path}` }
                }

                const stats = fs.statSync(dirPath)
                if (!stats.isDirectory()) {
                    return { success: false, error: '目标不是目录' }
                }

                const listDir = (dir, depth = 0) => {
                    const items = []
                    const entries = fs.readdirSync(dir, { withFileTypes: true })

                    for (const entry of entries) {
                        if (items.length >= limit) break
                        if (!showHidden && entry.name.startsWith('.')) continue

                        const fullPath = path.join(dir, entry.name)
                        const itemStats = fs.statSync(fullPath)

                        if (pattern) {
                            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
                            if (!regex.test(entry.name)) continue
                        }

                        const item = {
                            name: entry.name,
                            path: path.relative(dirPath, fullPath),
                            type: entry.isDirectory() ? 'directory' : 'file',
                            size: itemStats.size,
                            modified: itemStats.mtime.toISOString()
                        }
                        items.push(item)

                        if (recursive && entry.isDirectory() && depth < 5) {
                            item.children = listDir(fullPath, depth + 1)
                        }
                    }
                    return items
                }

                const items = listDir(dirPath)
                return {
                    success: true,
                    dir_path: dirPath,
                    count: items.length,
                    items
                }
            } catch (err) {
                return { success: false, error: `列出目录失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_to_file',
        description: '从URL下载文件到本地指定路径。支持HTTP/HTTPS链接。',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '文件下载URL' },
                save_path: { type: 'string', description: '保存路径' },
                filename: { type: 'string', description: '文件名（可选，默认从URL提取）' },
                overwrite: { type: 'boolean', description: '是否覆盖已存在文件', default: false },
                headers: {
                    oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: { type: 'string' } }],
                    description: '自定义请求头JSON字符串或对象（可选）'
                },
                cleanup: {
                    type: 'boolean',
                    description: '是否把显式保存文件登记为临时文件；默认false，文件会持久保留',
                    default: false
                },
                cleanup_after_seconds: {
                    type: 'number',
                    description: `cleanup=true 时的自动清理秒数，默认${MANAGED_DOWNLOAD_TTL_MS / 1000}秒`
                }
            },
            required: ['url', 'save_path']
        },
        handler: async args => {
            try {
                const savePath = getSafePath(args.save_path)
                if (!fs.existsSync(savePath)) {
                    fs.mkdirSync(savePath, { recursive: true })
                }

                const { response, finalUrl } = await fetchDownloadResponse(args.url, {
                    headers: parseDownloadHeaders(args.headers)
                })
                if (!response.ok) {
                    try {
                        await response.body?.cancel?.()
                    } catch {}
                    return { success: false, error: `下载失败: HTTP ${response.status}` }
                }

                // filename 由模型、响应头或最终URL控制，强制取基名并做二次沙箱校验
                const filename = resolveDownloadFilename(response, finalUrl, args.filename)
                const fullPath = getSafePath(path.join(savePath, filename))
                const size = await saveResponseToFile(response, fullPath, { overwrite: args.overwrite === true })
                let expiresAt = null
                if (args.cleanup === true) {
                    const ttlSeconds = Number(args.cleanup_after_seconds)
                    const ttlMs =
                        Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds * 1000 : MANAGED_DOWNLOAD_TTL_MS
                    expiresAt = registerTemporaryDownload(fullPath, ttlMs).expiresAt
                }

                return {
                    success: true,
                    url: finalUrl.href,
                    saved_path: fullPath,
                    filename,
                    size,
                    cleanup: args.cleanup === true,
                    expires_at: expiresAt
                }
            } catch (err) {
                return { success: false, error: `下载文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_group_file_to_file',
        description: '下载群文件到本地指定目录。先获取群文件URL，然后下载到本地。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号' },
                file_id: { type: 'string', description: '文件ID' },
                save_path: { type: 'string', description: '保存目录路径' },
                filename: { type: 'string', description: '保存的文件名（可选）' },
                overwrite: { type: 'boolean', description: '是否覆盖已存在文件', default: false },
                cleanup: {
                    type: 'boolean',
                    description: '是否把显式保存文件登记为临时文件；默认false，文件会持久保留',
                    default: false
                },
                cleanup_after_seconds: {
                    type: 'number',
                    description: `cleanup=true 时的自动清理秒数，默认${MANAGED_DOWNLOAD_TTL_MS / 1000}秒`
                }
            },
            required: ['group_id', 'file_id', 'save_path']
        },
        handler: async (args, ctx) => {
            try {
                const filesApi = StandardFileApi.fromContext(ctx)
                const groupId = filesApi.api.targetId(args.group_id)
                const savePath = getSafePath(args.save_path)

                let url = await filesApi.getGroupFileUrl(groupId, args.file_id)
                let originalName = args.filename || 'group_file'

                if (!url) {
                    return { success: false, error: '无法获取文件下载链接' }
                }

                if (!fs.existsSync(savePath)) {
                    fs.mkdirSync(savePath, { recursive: true })
                }

                const { response, finalUrl } = await fetchDownloadResponse(url)
                if (!response.ok) {
                    try {
                        await response.body?.cancel?.()
                    } catch {}
                    return { success: false, error: `下载失败: HTTP ${response.status}` }
                }

                // originalName 可能来自协议端返回的群文件名（外部可控），与 args.filename 同样按不可信处理
                const filename = resolveDownloadFilename(response, finalUrl, args.filename || originalName)
                const fullPath = getSafePath(path.join(savePath, filename))
                const size = await saveResponseToFile(response, fullPath, { overwrite: args.overwrite === true })
                let expiresAt = null
                if (args.cleanup === true) {
                    const ttlSeconds = Number(args.cleanup_after_seconds)
                    const ttlMs =
                        Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds * 1000 : MANAGED_DOWNLOAD_TTL_MS
                    expiresAt = registerTemporaryDownload(fullPath, ttlMs).expiresAt
                }

                return {
                    success: true,
                    group_id: groupId,
                    file_id: args.file_id,
                    saved_path: fullPath,
                    filename,
                    size,
                    cleanup: args.cleanup === true,
                    expires_at: expiresAt
                }
            } catch (err) {
                return { success: false, error: `下载群文件失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_file',
        description: '删除本地文件或空目录。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件或目录路径' },
                recursive: { type: 'boolean', description: '是否递归删除目录内容', default: false }
            },
            required: ['file_path']
        },
        handler: async args => {
            try {
                const filePath = getSafePath(args.file_path)

                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `路径不存在: ${args.file_path}` }
                }

                const stats = fs.statSync(filePath)
                if (stats.isDirectory()) {
                    if (args.recursive) {
                        fs.rmSync(filePath, { recursive: true })
                    } else {
                        fs.rmdirSync(filePath)
                    }
                } else {
                    fs.unlinkSync(filePath)
                }

                return {
                    success: true,
                    deleted_path: filePath,
                    type: stats.isDirectory() ? 'directory' : 'file'
                }
            } catch (err) {
                return { success: false, error: `删除失败: ${err.message}` }
            }
        }
    },

    {
        name: 'copy_file',
        description: '复制本地文件到另一个位置。',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: '源文件路径' },
                destination: { type: 'string', description: '目标路径' },
                overwrite: { type: 'boolean', description: '是否覆盖已存在文件', default: false }
            },
            required: ['source', 'destination']
        },
        handler: async args => {
            try {
                const sourcePath = getSafePath(args.source)
                const destPath = getSafePath(args.destination)

                if (!fs.existsSync(sourcePath)) {
                    return { success: false, error: `源文件不存在: ${args.source}` }
                }

                if (!args.overwrite && fs.existsSync(destPath)) {
                    return { success: false, error: `目标文件已存在: ${args.destination}` }
                }

                const destDir = path.dirname(destPath)
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true })
                }

                fs.copyFileSync(sourcePath, destPath)
                const stats = fs.statSync(destPath)

                return {
                    success: true,
                    source: sourcePath,
                    destination: destPath,
                    size: stats.size
                }
            } catch (err) {
                return { success: false, error: `复制失败: ${err.message}` }
            }
        }
    },

    {
        name: 'move_file',
        description: '移动或重命名本地文件。',
        inputSchema: {
            type: 'object',
            properties: {
                source: { type: 'string', description: '源文件路径' },
                destination: { type: 'string', description: '目标路径' },
                overwrite: { type: 'boolean', description: '是否覆盖已存在文件', default: false }
            },
            required: ['source', 'destination']
        },
        handler: async args => {
            try {
                const sourcePath = getSafePath(args.source)
                const destPath = getSafePath(args.destination)

                if (!fs.existsSync(sourcePath)) {
                    return { success: false, error: `源文件不存在: ${args.source}` }
                }

                if (!args.overwrite && fs.existsSync(destPath)) {
                    return { success: false, error: `目标文件已存在: ${args.destination}` }
                }

                const destDir = path.dirname(destPath)
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true })
                }

                fs.renameSync(sourcePath, destPath)

                return {
                    success: true,
                    source: sourcePath,
                    destination: destPath
                }
            } catch (err) {
                return { success: false, error: `移动失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_file_info',
        description: '获取本地文件的详细信息，包括大小、创建时间、修改时间等。',
        inputSchema: {
            type: 'object',
            properties: {
                file_path: { type: 'string', description: '文件路径' }
            },
            required: ['file_path']
        },
        handler: async args => {
            try {
                const filePath = getSafePath(args.file_path)

                if (!fs.existsSync(filePath)) {
                    return { success: false, error: `路径不存在: ${args.file_path}` }
                }

                const stats = fs.statSync(filePath)
                return {
                    success: true,
                    file_path: filePath,
                    type: stats.isDirectory() ? 'directory' : 'file',
                    size: stats.size,
                    created: stats.birthtime.toISOString(),
                    modified: stats.mtime.toISOString(),
                    accessed: stats.atime.toISOString(),
                    permissions: stats.mode.toString(8)
                }
            } catch (err) {
                return { success: false, error: `获取文件信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'create_directory',
        description: '创建本地目录，支持递归创建多级目录。',
        inputSchema: {
            type: 'object',
            properties: {
                dir_path: { type: 'string', description: '目录路径' },
                recursive: { type: 'boolean', description: '是否递归创建父目录', default: true }
            },
            required: ['dir_path']
        },
        handler: async args => {
            try {
                const dirPath = getSafePath(args.dir_path)

                if (fs.existsSync(dirPath)) {
                    return { success: true, dir_path: dirPath, message: '目录已存在' }
                }

                fs.mkdirSync(dirPath, { recursive: args.recursive !== false })

                return {
                    success: true,
                    dir_path: dirPath,
                    message: '目录创建成功'
                }
            } catch (err) {
                return { success: false, error: `创建目录失败: ${err.message}` }
            }
        }
    }
]
