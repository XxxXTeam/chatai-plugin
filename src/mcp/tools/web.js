/**
 * 网页访问工具
 * 访问网页、获取内容等
 */

import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import TurndownService from 'turndown'
import { proxyService } from '../../services/proxy/ProxyService.js'
import { assertSafeUrl, sanitizeRequestHeaders } from './helpers.js'

puppeteer.use(StealthPlugin())

/** 返回内容默认最大长度 */
const DEFAULT_MAX_LENGTH = 8000

/** 返回内容长度硬上限，防止调用方传入超大值撑爆上下文 */
const MAX_RESULT_LENGTH = 100000

/** 页面渲染后默认等待时长（毫秒） */
const DEFAULT_PAGE_WAIT_MS = 3000

/** 页面渲染后等待时长上限（毫秒），防止工具调用被长时间挂起 */
const MAX_PAGE_WAIT_MS = 15000

/** page.goto 超时（毫秒） */
const PAGE_GOTO_TIMEOUT_MS = 30000

/** 等待选择器超时（毫秒） */
const WAIT_SELECTOR_TIMEOUT_MS = 10000

/** fetch_url 请求超时（毫秒） */
const FETCH_TIMEOUT_MS = 15000

/** fetch_url 响应体读取上限（字节） */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

/** fetch_url 允许跟随的最大重定向次数 */
const MAX_REDIRECTS = 5

/** fetch_url 允许的 HTTP 方法（只读语义，避免被用作任意写入代理） */
const ALLOWED_FETCH_METHODS = ['GET', 'HEAD']

/**
 * 读取响应体并施加字节上限
 * @param {Response} response - fetch 响应
 * @returns {Promise<{text: string, bytes: number, truncated: boolean}>} 文本内容与读取字节数
 */
async function readBodyWithLimit(response) {
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
        throw new Error(`响应体过大 (${declared} bytes)，超过上限 ${MAX_RESPONSE_BYTES} bytes`)
    }

    if (!response.body) {
        return { text: '', bytes: 0, truncated: false }
    }

    const chunks = []
    let bytes = 0
    let truncated = false
    for await (const chunk of response.body) {
        const buf = Buffer.from(chunk)
        if (bytes + buf.length > MAX_RESPONSE_BYTES) {
            chunks.push(buf.subarray(0, MAX_RESPONSE_BYTES - bytes))
            bytes = MAX_RESPONSE_BYTES
            truncated = true
            break
        }
        chunks.push(buf)
        bytes += buf.length
    }
    return { text: Buffer.concat(chunks).toString('utf8'), bytes, truncated }
}

/**
 * 清理HTML
 */
function cleanHTML(html) {
    html = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<link[^>]*>/gi, '')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, '')

    const allowedTags = [
        'title',
        'meta',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'p',
        'img',
        'video',
        'audio',
        'source',
        'a'
    ]

    html = html.replace(/<\/?([a-zA-Z0-9]+)(\s[^>]*)?>/g, (match, tagName) => {
        tagName = tagName.toLowerCase()
        if (allowedTags.includes(tagName)) {
            if (tagName === 'img' || tagName === 'video' || tagName === 'audio' || tagName === 'source') {
                return match.replace(/<(img|video|audio|source)([^>]*)>/gi, (_, tag, attributes) => {
                    let srcMatch = attributes.match(/\bsrc=["'](?!data:)[^"']+["']/i)
                    return srcMatch ? `<${tag} ${srcMatch[0]}>` : ''
                })
            } else if (tagName === 'a') {
                return match.replace(/<a([^>]*)>/gi, (_, attributes) => {
                    let hrefMatch = attributes.match(/\bhref=["'](?!data:)[^"']+["']/i)
                    return hrefMatch ? `<a ${hrefMatch[0]}>` : ''
                })
            }
            return match
        }
        return ''
    })

    return html.replace(/\s+/g, ' ').trim()
}

/**
 * HTML转Markdown
 */
function convertToMarkdown(html) {
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced'
    })

    turndownService.addRule('images', {
        filter: ['img'],
        replacement: (content, node) => {
            const alt = node.alt || ''
            const src = node.getAttribute('src') || ''
            return src ? `![${alt}](${src})` : ''
        }
    })

    return turndownService.turndown(html)
}

export const webTools = [
    {
        name: 'website',
        description: '访问网页并获取内容（支持动态渲染）',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '要访问的网页URL' },
                mode: {
                    type: 'string',
                    description: '获取模式：text(纯文本)、markdown(Markdown格式)、html(原始HTML)',
                    enum: ['text', 'markdown', 'html']
                },
                wait: { type: 'number', description: '等待页面加载的时间(毫秒)，默认3000' },
                selector: { type: 'string', description: '等待特定元素出现（CSS选择器）' },
                max_length: { type: 'number', description: '返回内容的最大长度，默认8000' }
            },
            required: ['url']
        },
        handler: async args => {
            const url = args.url
            const mode = args.mode || 'markdown'
            const waitTime = Math.min(Math.max(Number(args.wait) || DEFAULT_PAGE_WAIT_MS, 0), MAX_PAGE_WAIT_MS)
            const maxLength = Math.min(Math.max(Number(args.max_length) || DEFAULT_MAX_LENGTH, 1), MAX_RESULT_LENGTH)

            let browser = null
            try {
                // 协议白名单 + 内网阻断：阻止 file:// 读本地文件与内网探测
                await assertSafeUrl(url)

                // 获取代理配置
                const proxyUrl = proxyService.getBrowserProxyArgs()
                const launchOptions = {
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
                }

                if (proxyUrl) {
                    launchOptions.args.push(`--proxy-server=${proxyUrl}`)
                }

                browser = await puppeteer.launch(launchOptions)
                const page = await browser.newPage()

                await page.setUserAgent(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                )
                await page.setViewport({ width: 1920, height: 1080 })

                await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_GOTO_TIMEOUT_MS })

                if (args.selector) {
                    await page.waitForSelector(args.selector, { timeout: WAIT_SELECTOR_TIMEOUT_MS }).catch(() => {})
                }

                await new Promise(r => setTimeout(r, waitTime))

                const title = await page.title()
                let content = await page.content()

                await browser.close()
                browser = null

                // 处理内容
                let result
                if (mode === 'html') {
                    result = content.substring(0, maxLength)
                } else {
                    const cleanedHtml = cleanHTML(content)
                    if (mode === 'markdown') {
                        result = convertToMarkdown(cleanedHtml)
                    } else {
                        result = cleanedHtml
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim()
                    }
                    result = result.substring(0, maxLength)
                }

                return {
                    success: true,
                    url,
                    title,
                    content: result,
                    length: result.length,
                    truncated: result.length >= maxLength
                }
            } catch (err) {
                if (browser) await browser.close().catch(() => {})
                return { success: false, error: `访问网页失败: ${err.message}`, url }
            }
        }
    },

    {
        name: 'fetch_url',
        description: '简单HTTP请求获取URL内容（不渲染JavaScript）。仅支持 http/https 的只读请求，禁止访问内网地址。',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL地址（仅支持 http/https）' },
                method: { type: 'string', description: 'HTTP方法，仅支持只读方法', enum: ALLOWED_FETCH_METHODS },
                headers: {
                    type: 'object',
                    description: '附加请求头（Authorization/Cookie/Proxy-* 等凭据类请求头会被忽略）'
                },
                max_length: { type: 'number', description: '最大返回长度，默认8000' }
            },
            required: ['url']
        },
        handler: async args => {
            try {
                const maxLength = Math.min(
                    Math.max(Number(args.max_length) || DEFAULT_MAX_LENGTH, 1),
                    MAX_RESULT_LENGTH
                )
                const method = String(args.method || 'GET').toUpperCase()
                if (!ALLOWED_FETCH_METHODS.includes(method)) {
                    return {
                        success: false,
                        error: `不支持的 HTTP 方法 ${method}，仅允许 ${ALLOWED_FETCH_METHODS.join('/')}`,
                        url: args.url
                    }
                }

                const headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    ...sanitizeRequestHeaders(args.headers)
                }

                // 逐跳校验重定向目标，防止通过 3xx 跳转绕过内网阻断
                let currentUrl = String(args.url)
                let response = null
                let redirects = 0
                while (true) {
                    const safeUrl = await assertSafeUrl(currentUrl)
                    const options = {
                        method,
                        headers,
                        redirect: 'manual',
                        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
                    }
                    const agent = proxyService.getApiProxyAgent(safeUrl.href)
                    if (agent) options.agent = agent

                    response = await fetch(safeUrl.href, options)
                    const location = response.headers.get('location')
                    if (response.status >= 300 && response.status < 400 && location) {
                        if (++redirects > MAX_REDIRECTS) {
                            return { success: false, error: `重定向次数超过上限 ${MAX_REDIRECTS}`, url: args.url }
                        }
                        currentUrl = new URL(location, safeUrl).href
                        continue
                    }
                    break
                }

                const contentType = response.headers.get('content-type') || ''
                const body = await readBodyWithLimit(response)

                let content = body.text
                if (contentType.includes('application/json')) {
                    try {
                        content = JSON.stringify(JSON.parse(content), null, 2)
                    } catch {
                        // JSON 解析失败时保留原始文本
                    }
                }

                const output = content.substring(0, maxLength)

                return {
                    success: true,
                    url: currentUrl,
                    status: response.status,
                    content_type: contentType,
                    content: output,
                    length: output.length,
                    truncated: output.length < content.length || body.truncated
                }
            } catch (err) {
                return { success: false, error: `请求失败: ${err.message}`, url: args.url }
            }
        }
    }
]
