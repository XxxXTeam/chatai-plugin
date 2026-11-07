/**
 * 统一联网搜索服务。
 *
 * 职责：
 * 1. 优先使用当前渠道的官方搜索能力（OpenAI / Claude / Gemini / DeepSeek）；
 * 2. 官方能力不可用时回退到免费搜索引擎（Bing / DuckDuckGo）；
 * 3. 统一去重、重排、截断与缓存，给内置工具返回稳定、紧凑的结果。
 */

import { load } from 'cheerio'
import config from '../../../config/config.js'
import { fetchWithLimit } from '../../mcp/tools/helpers.js'
import { asyncLocalStorage } from '../../core/utils/helpers.js'
import { getSearchSettings } from './SearchSettings.js'

/** 单次抓取的最大响应体 */
const PAGE_MAX_BYTES = 5 * 1024 * 1024
/** 搜索结果缓存上限 */
const MAX_CACHE_ENTRIES = 200
/** 搜索请求 UA */
const SEARCH_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/** @type {Map<string, {expiresAt: number, value: any}>} */
const resultCache = new Map()
/** @type {Map<string, Promise<any>>} */
const inFlight = new Map()

/**
 * 读取当前请求的客户端，用于复用渠道的 API Key / baseUrl / 模型。
 * @returns {Record<string, any> | null}
 */
export function getActiveClient() {
    try {
        const store = asyncLocalStorage.getStore()
        return store?.getClient?.() || store?.client || null
    } catch {
        return null
    }
}

/**
 * 归一化 baseUrl，去掉末尾斜杠。
 * @param {string} baseUrl
 * @returns {string}
 */
function trimBaseUrl(baseUrl) {
    return String(baseUrl || '').replace(/\/+$/, '')
}

/**
 * 判断 host 是否属于官方域名（避免把官方搜索请求打到第三方中转站）。
 * @param {string} baseUrl
 * @param {string[]} hosts
 * @returns {boolean}
 */
function matchesHost(baseUrl, hosts) {
    try {
        const host = new URL(baseUrl).hostname.toLowerCase()
        return hosts.some(item => host === item || host.endsWith(`.${item}`))
    } catch {
        return false
    }
}

/**
 * 推断当前渠道的官方搜索提供方。
 *
 * 与 NativeSearchService.resolveSearchProvider 保持同一口径：域名优先，
 * baseUrl 为空时才按适配器类型兜底，避免把第三方中转误判为官方。
 *
 * @param {Record<string, any> | null} client
 * @returns {'openai'|'claude'|'gemini'|'deepseek'|''}
 */
export function detectProvider(client) {
    if (!client) return ''
    const adapterType = String(client.options?.adapterType || client.adapterType || '').toLowerCase()
    const baseUrl = String(client.baseUrl || '').toLowerCase()
    const model = String(client.options?.model || client.model || '').toLowerCase()

    if (matchesHost(baseUrl, ['api.anthropic.com'])) return 'claude'
    if (matchesHost(baseUrl, ['generativelanguage.googleapis.com'])) return 'gemini'
    if (matchesHost(baseUrl, ['api.deepseek.com']) || model.includes('deepseek')) return 'deepseek'
    if (matchesHost(baseUrl, ['api.openai.com'])) return 'openai'

    if (!baseUrl) {
        if (adapterType === 'claude') return 'claude'
        if (adapterType === 'gemini') return 'gemini'
    }
    return ''
}

/**
 * 读取当前请求模型；部分适配器把模型放在 context.options 中。
 * @param {Record<string, any> | null} client
 * @returns {string}
 */
function resolveClientModel(client) {
    return String(client?.options?.model || client?.model || '').trim()
}

/**
 * 读取官方搜索使用的模型。
 * @param {Record<string, any> | null} client
 * @param {string} provider
 * @returns {string}
 */
function resolveNativeSearchModel(client, provider) {
    const configured = String(
        config.get('builtinTools.search.native.model') || config.get('llm.models.search') || ''
    ).trim()
    if (configured) return configured
    const clientModel = resolveClientModel(client)
    if (provider === 'gemini' && clientModel) return clientModel
    if (provider === 'openai' && clientModel) return clientModel
    if (provider === 'claude' && clientModel) return clientModel
    if (provider === 'deepseek') return 'deepseek-v4-pro'
    return clientModel
}

/**
 * 生成缓存 key。
 * @param {Record<string, any>} params
 * @returns {string}
 */
function makeCacheKey(params) {
    return JSON.stringify({
        provider: params.provider,
        engine: params.engine,
        query: params.query,
        count: params.count,
        fetchContent: params.fetchContent
    })
}

/**
 * 读取缓存；过期自动删除。
 * @param {string} key
 * @returns {any|null}
 */
function readCache(key) {
    const entry = resultCache.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
        resultCache.delete(key)
        return null
    }
    // LRU：命中后移到末尾
    resultCache.delete(key)
    resultCache.set(key, entry)
    return entry.value
}

/**
 * 写入缓存并限制条目数。
 * @param {string} key
 * @param {any} value
 * @param {number} ttl
 * @returns {void}
 */
function writeCache(key, value, ttl) {
    if (!(ttl > 0)) return
    resultCache.set(key, { expiresAt: Date.now() + ttl, value })
    while (resultCache.size > MAX_CACHE_ENTRIES) {
        const oldest = resultCache.keys().next().value
        if (oldest === undefined) break
        resultCache.delete(oldest)
    }
}

/**
 * 带缓存与并发合并的执行器。
 * @param {string} key
 * @param {number} ttl
 * @param {() => Promise<any>} task
 * @returns {Promise<any>}
 */
async function cached(key, ttl, task) {
    const cachedValue = readCache(key)
    if (cachedValue !== null) return cachedValue
    const running = inFlight.get(key)
    if (running) return running
    const promise = Promise.resolve()
        .then(task)
        .then(value => {
            writeCache(key, value, ttl)
            return value
        })
        .finally(() => {
            inFlight.delete(key)
        })
    inFlight.set(key, promise)
    return promise
}

/**
 * 使用 fetchWithLimit 获取文本。
 * @param {string} url
 * @param {Object} [options]
 * @returns {Promise<string>}
 */
async function fetchText(url, options = {}) {
    const { response, buffer } = await fetchWithLimit(
        url,
        {
            headers: {
                'User-Agent': SEARCH_USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                ...(options.headers || {})
            },
            method: options.method || 'GET',
            ...(options.body ? { body: options.body } : {})
        },
        {
            timeoutMs: options.timeoutMs,
            maxBytes: options.maxBytes || PAGE_MAX_BYTES,
            label: options.label || '搜索请求'
        }
    )
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return buffer.toString('utf8')
}

/**
 * 使用 fetchWithLimit 发送 JSON 请求。
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<any>}
 */
async function fetchJson(url, options = {}) {
    const text = await fetchText(url, options)
    try {
        return JSON.parse(text)
    } catch {
        throw new Error('上游返回的不是合法 JSON')
    }
}

/**
 * 清除 URL 中的跟踪参数，便于跨引擎去重。
 * @param {string} rawUrl
 * @returns {string}
 */
function canonicalizeUrl(rawUrl) {
    if (!rawUrl) return ''
    try {
        const url = new URL(rawUrl)
        const dropPrefixes = ['utm_', 'spm', 'from', 'ref', 'source', 'fbclid', 'gclid', 'msclkid']
        for (const key of Array.from(url.searchParams.keys())) {
            if (dropPrefixes.some(prefix => key.toLowerCase().startsWith(prefix))) {
                url.searchParams.delete(key)
            }
        }
        url.hash = ''
        return url.toString()
    } catch {
        return rawUrl
    }
}

/**
 * 解析 Bing 的跳转链接。
 * @param {string} href
 * @returns {string}
 */
function unwrapBingUrl(href) {
    if (!href) return ''
    try {
        const url = new URL(href, 'https://www.bing.com')
        if (url.hostname.endsWith('bing.com') && url.pathname === '/ck/a') {
            const encoded = url.searchParams.get('u')
            if (encoded && encoded.startsWith('a1')) {
                return Buffer.from(encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
            }
        }
        return url.toString()
    } catch {
        return href
    }
}

/**
 * 解析 DuckDuckGo 的跳转链接。
 * @param {string} href
 * @returns {string}
 */
function unwrapDuckDuckGoUrl(href) {
    if (!href) return ''
    try {
        const url = new URL(href, 'https://duckduckgo.com')
        const target = url.searchParams.get('uddg')
        return target ? decodeURIComponent(target) : url.toString()
    } catch {
        return href
    }
}

/**
 * 从 HTML 中提取标题/摘要文本。
 * @param {import('cheerio').CheerioAPI} $
 * @param {import('cheerio').Cheerio<import('domhandler').Element>} node
 * @param {string[]} selectors
 * @returns {string}
 */
function pickText($, node, selectors) {
    for (const selector of selectors) {
        const text = node.find(selector).first().text().replace(/\s+/g, ' ').trim()
        if (text) return text
    }
    return ''
}

/**
 * 解析 Bing 的 RSS 结果。
 *
 * Bing 网页端在部分查询/风控场景下会返回需要 JS 渲染的空壳页面（没有 li.b_algo），
 * 此时改用官方 RSS 输出（format=rss）能稳定拿到结构化结果。
 *
 * @param {string} xml
 * @param {number} count
 * @returns {Array<Record<string, any>>}
 */
function parseBingRss(xml, count) {
    const $ = load(xml, { xmlMode: true })
    const results = []
    $('item').each((_, element) => {
        if (results.length >= count) return false
        const node = $(element)
        const url = node.find('link').first().text().trim()
        if (!/^https?:\/\//i.test(url)) return
        const title = node.find('title').first().text().replace(/\s+/g, ' ').trim()
        if (!title) return
        const snippet = node.find('description').first().text().replace(/\s+/g, ' ').trim()
        results.push({ title, url, snippet, engine: 'bing' })
    })
    return results
}

/**
 * 解析 Bing HTML 结果。
 * @param {string} html
 * @param {number} count
 * @returns {Array<Record<string, any>>}
 */
function parseBingHtml(html, count) {
    const $ = load(html)
    const results = []
    $('li.b_algo').each((_, element) => {
        if (results.length >= count) return false
        const node = $(element)
        const link = node.find('h2 a').first()
        const href = unwrapBingUrl(link.attr('href') || '')
        if (!/^https?:\/\//i.test(href)) return
        const title = link.text().replace(/\s+/g, ' ').trim()
        if (!title) return
        const snippet = pickText($, node, [
            '.b_caption p',
            '.b_lineclamp1',
            '.b_lineclamp2',
            '.b_lineclamp3',
            '.b_lineclamp4',
            'p'
        ])
        results.push({ title, url: href, snippet, engine: 'bing' })
    })

    if (results.length === 0) {
        $('h2 a').each((_, element) => {
            if (results.length >= count) return false
            const link = $(element)
            const href = unwrapBingUrl(link.attr('href') || '')
            if (!/^https?:\/\//i.test(href)) return
            const title = link.text().replace(/\s+/g, ' ').trim()
            if (title) results.push({ title, url: href, snippet: '', engine: 'bing' })
        })
    }
    return results
}

/**
 * 解析 DuckDuckGo HTML 结果。
 * @param {string} html
 * @param {number} count
 * @returns {Array<Record<string, any>>}
 */
function parseDuckDuckGoHtml(html, count) {
    const $ = load(html)
    const results = []
    $('.result').each((_, element) => {
        if (results.length >= count) return false
        const node = $(element)
        const link = node.find('.result__a').first()
        const href = unwrapDuckDuckGoUrl(link.attr('href') || '')
        if (!/^https?:\/\//i.test(href)) return
        const title = link.text().replace(/\s+/g, ' ').trim()
        if (!title) return
        const snippet = pickText($, node, ['.result__snippet', '.result__body'])
        results.push({ title, url: href, snippet, engine: 'duckduckgo' })
    })
    return results
}

/**
 * 依据查询词覆盖率与来源质量重排。
 * @param {Array<Record<string, any>>} results
 * @param {string} query
 * @returns {Array<Record<string, any>>}
 */
function rerankResults(results, query) {
    const queryTokens = String(query)
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter(token => token.length > 1)
    const seen = new Set()
    const scored = []

    for (const item of results) {
        const canonical = canonicalizeUrl(item.url)
        if (!canonical || seen.has(canonical)) continue
        seen.add(canonical)

        const haystack = `${item.title || ''} ${item.snippet || ''}`.toLowerCase()
        let score = 0
        for (const token of queryTokens) {
            if (haystack.includes(token)) score += 10
        }
        try {
            const host = new URL(canonical).hostname.toLowerCase()
            if (/(^|\.)(gov|edu)(\.|$)/.test(host)) score += 6
            if (host.includes('wikipedia.org') || host.includes('baike.baidu.com')) score += 5
            if (host.includes('github.com') || host.includes('developer.')) score += 3
        } catch {
            // 非法 URL 保持 0 分，仍可返回
        }
        if (item.engine === 'bing') score += 1
        scored.push({ ...item, url: canonical, score })
    }

    scored.sort((a, b) => b.score - a.score)
    return scored
}

/**
 * 免费搜索引擎搜索。
 * @param {string} query
 * @param {Object} options
 * @param {string} options.engine
 * @param {number} options.count
 * @param {number} options.timeoutMs
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function searchFreeEngine(query, options) {
    const { engine, count, timeoutMs } = options
    if (engine === 'duckduckgo') {
        const body = new URLSearchParams({ q: query }).toString()
        const html = await fetchText('https://html.duckduckgo.com/html/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'text/html,application/xhtml+xml'
            },
            body,
            timeoutMs,
            label: 'DuckDuckGo 搜索'
        })
        return parseDuckDuckGoHtml(html, count)
    }

    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 20)}&setlang=zh-hans`
    const html = await fetchText(url, { timeoutMs, label: 'Bing 搜索' })
    const results = parseBingHtml(html, count)
    if (results.length > 0) return results

    // 网页端返回空壳页时（无 li.b_algo），回退官方 RSS 输出
    const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}&count=${Math.min(count, 20)}`
    const rss = await fetchText(rssUrl, {
        timeoutMs,
        headers: { Accept: 'application/rss+xml,text/xml;q=0.9,*/*;q=0.8' },
        label: 'Bing RSS 搜索'
    })
    return parseBingRss(rss, count)
}

/**
 * 让模型只输出可解析的结果，减少自由文本带来的解析成本。
 * @param {string} query
 * @returns {string}
 */
function buildSearchPrompt(query) {
    return `请联网搜索并回答：${query}\n\n要求：\n1. 先用 2-4 句话给出结论；\n2. 再列出最多 5 条来源，每行格式为：标题 | URL；\n3. 不要编造 URL，找不到就说明找不到。`
}

/**
 * 从文本中提取“标题 | URL”列表。
 * @param {string} text
 * @param {number} count
 * @returns {Array<Record<string, any>>}
 */
function parseSourceLines(text, count) {
    const results = []
    const lines = String(text || '').split(/\r?\n/)
    for (const line of lines) {
        if (results.length >= count) break
        const match = line.match(/^\s*(?:[-*]|\d+[.)])?\s*(.+?)\s*\|\s*(https?:\/\/\S+)\s*$/)
        if (!match) continue
        results.push({
            title: match[1].replace(/\[|\]/g, '').trim(),
            url: match[2].trim(),
            snippet: ''
        })
    }
    return results
}

/**
 * OpenAI 官方 web_search。
 * @param {string} query
 * @param {Record<string, any>} client
 * @param {Object} settings
 * @returns {Promise<Record<string, any>>}
 */
async function searchWithOpenAI(query, client, settings) {
    const baseUrl = trimBaseUrl(client.baseUrl)
    const model = resolveNativeSearchModel(client, 'openai')
    if (!model) throw new Error('未配置 OpenAI 搜索模型')
    const data = await fetchJson(`${baseUrl}/responses`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${client.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            tools: [{ type: 'web_search' }],
            input: buildSearchPrompt(query)
        }),
        timeoutMs: Math.max(settings.timeoutMs, 20000),
        label: 'OpenAI 官方搜索'
    })

    const textParts = []
    const results = []
    for (const item of data?.output || []) {
        if (item?.type === 'message') {
            for (const part of item.content || []) {
                if (part?.type === 'output_text' || part?.type === 'text') {
                    if (part.text) textParts.push(part.text)
                    for (const annotation of part.annotations || []) {
                        if (annotation?.type === 'url_citation' && annotation.url) {
                            results.push({
                                title: annotation.title || annotation.url,
                                url: annotation.url,
                                snippet: ''
                            })
                        }
                    }
                }
            }
        }
    }
    if (results.length === 0) results.push(...parseSourceLines(textParts.join('\n'), settings.maxResults))
    return { provider: 'openai', answer: textParts.join('\n').trim(), results }
}

/**
 * Claude 官方 web_search。
 * @param {string} query
 * @param {Record<string, any>} client
 * @param {Object} settings
 * @returns {Promise<Record<string, any>>}
 */
async function searchWithClaude(query, client, settings) {
    const baseUrl = trimBaseUrl(client.baseUrl)
    const model = resolveNativeSearchModel(client, 'claude')
    if (!model) throw new Error('未配置 Claude 搜索模型')
    const data = await fetchJson(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
            'x-api-key': client.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{ role: 'user', content: buildSearchPrompt(query) }],
            tools: [
                {
                    type: 'web_search_20250305',
                    name: 'web_search',
                    max_uses: Math.max(1, Number(settings.native?.maxUses) || 5)
                }
            ]
        }),
        timeoutMs: Math.max(settings.timeoutMs, 30000),
        label: 'Claude 官方搜索'
    })

    const textParts = []
    const results = []
    for (const block of data?.content || []) {
        if (block?.type === 'text' && block.text) textParts.push(block.text)
        if (block?.type === 'web_search_tool_result') {
            for (const item of block.content || []) {
                if (item?.url) {
                    results.push({ title: item.title || item.url, url: item.url, snippet: '', pageAge: item.page_age })
                }
            }
        }
    }
    if (results.length === 0) results.push(...parseSourceLines(textParts.join('\n'), settings.maxResults))
    return { provider: 'claude', answer: textParts.join('\n').trim(), results }
}

/**
 * Gemini 官方 google_search。
 * @param {string} query
 * @param {Record<string, any>} client
 * @param {Object} settings
 * @returns {Promise<Record<string, any>>}
 */
async function searchWithGemini(query, client, settings) {
    const baseUrl = trimBaseUrl(client.baseUrl)
    const model = resolveNativeSearchModel(client, 'gemini')
    if (!model) throw new Error('未配置 Gemini 搜索模型')
    const prefix = /\/v1(beta)?$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1beta`
    const url = `${prefix}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(client.apiKey)}`
    const data = await fetchJson(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: buildSearchPrompt(query) }] }],
            tools: [{ google_search: {} }]
        }),
        timeoutMs: Math.max(settings.timeoutMs, 30000),
        label: 'Gemini 官方搜索'
    })

    const candidate = data?.candidates?.[0]
    const text = (candidate?.content?.parts || [])
        .map(part => part?.text || '')
        .filter(Boolean)
        .join('\n')
        .trim()
    const results = []
    for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
        const web = chunk?.web
        if (web?.uri) results.push({ title: web.title || web.uri, url: web.uri, snippet: '' })
    }
    if (results.length === 0) results.push(...parseSourceLines(text, settings.maxResults))
    return { provider: 'gemini', answer: text, results }
}

/**
 * DeepSeek 官方 Search API。
 * @param {string} query
 * @param {Record<string, any>} client
 * @param {Object} settings
 * @returns {Promise<Record<string, any>>}
 */
async function searchWithDeepSeek(query, client, settings) {
    const baseUrl = trimBaseUrl(client.baseUrl)
    const prefix = /\/v1$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1`
    const data = await fetchJson(`${prefix}/tools/search`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${client.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            query,
            count: Math.min(Math.max(Number(settings.maxResults) || 5, 1), 50),
            need_content: false
        }),
        timeoutMs: settings.timeoutMs,
        label: 'DeepSeek 官方搜索'
    })
    const results = (data?.results || []).map(item => ({
        title: item.title || item.url,
        url: item.url,
        snippet: item.summary || item.snippet || '',
        date: item.date,
        siteName: item.site_name
    }))
    return { provider: 'deepseek', answer: '', results }
}

/**
 * 官方搜索调度。
 * @param {string} provider
 * @param {string} query
 * @param {Record<string, any>} client
 * @param {Object} settings
 * @returns {Promise<Record<string, any>>}
 */
async function searchWithProvider(provider, query, client, settings) {
    if (provider === 'openai') return searchWithOpenAI(query, client, settings)
    if (provider === 'claude') return searchWithClaude(query, client, settings)
    if (provider === 'gemini') return searchWithGemini(query, client, settings)
    if (provider === 'deepseek') return searchWithDeepSeek(query, client, settings)
    throw new Error(`不支持的官方搜索提供方: ${provider}`)
}

/**
 * 提取网页正文并转成轻量 Markdown。
 * @param {string} html
 * @param {number} maxLength
 * @returns {{title: string, content: string}}
 */
export function extractReadableMarkdown(html, maxLength = 8000) {
    const $ = load(html)
    $('script, style, noscript, iframe, svg, canvas, nav, footer, header, aside, form, button').remove()

    const title = $('title').first().text().replace(/\s+/g, ' ').trim() || $('h1').first().text().trim()
    const description =
        $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || ''

    const root =
        $('article').first().length > 0
            ? $('article').first()
            : $('main').first().length > 0
              ? $('main').first()
              : $('[role="main"]').first().length > 0
                ? $('[role="main"]').first()
                : $('body')

    root.find('h1,h2,h3,h4,h5,h6').each((_, element) => {
        const node = $(element)
        const level = Number(element.tagName?.replace('h', '') || 1)
        node.replaceWith(`\n${'#'.repeat(Math.min(level, 6))} ${node.text().trim()}\n`)
    })
    root.find('li').each((_, element) => {
        const node = $(element)
        node.replaceWith(`\n- ${node.text().trim()}`)
    })
    root.find('a').each((_, element) => {
        const node = $(element)
        const href = node.attr('href')
        const text = node.text().trim()
        if (href && text) node.replaceWith(`[${text}](${href})`)
    })
    root.find('br').replaceWith('\n')
    root.find('p,div,section,blockquote,pre,tr').each((_, element) => {
        const node = $(element)
        node.append('\n')
    })
    root.find('th,td').each((_, element) => {
        const node = $(element)
        node.replaceWith(`| ${node.text().trim()} `)
    })

    let content = root
        .text()
        .replace(/\r/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

    if (description && !content.startsWith(description)) {
        content = `> ${description}\n\n${content}`
    }
    if (content.length > maxLength) content = `${content.slice(0, maxLength)}\n\n...[内容已截断]`

    return { title, content }
}

/**
 * 抓取网页正文。
 * @param {string} url
 * @param {Object} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function fetchPage(url, options = {}) {
    const settings = getSearchSettings()
    const maxLength = Math.min(Math.max(Number(options.maxLength) || 8000, 200), 100000)
    const timeoutMs = Math.max(Number(options.timeoutMs) || settings.timeoutMs, 1000)
    try {
        const {
            response,
            buffer,
            url: finalUrl
        } = await fetchWithLimit(
            url,
            {
                headers: {
                    'User-Agent': SEARCH_USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                }
            },
            { timeoutMs, maxBytes: PAGE_MAX_BYTES, label: '网页抓取' }
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const contentType = response.headers.get('content-type') || ''
        const raw = buffer.toString('utf8')
        if (contentType.includes('json')) {
            let formatted = raw
            try {
                formatted = JSON.stringify(JSON.parse(raw), null, 2)
            } catch {
                // 保持原始文本
            }
            return {
                success: true,
                url: finalUrl || url,
                title: finalUrl || url,
                content:
                    formatted.length > maxLength ? `${formatted.slice(0, maxLength)}\n\n...[内容已截断]` : formatted,
                length: formatted.length
            }
        }
        const { title, content } = extractReadableMarkdown(raw, maxLength)
        return {
            success: true,
            url: finalUrl || url,
            title: title || finalUrl || url,
            content,
            length: content.length
        }
    } catch (error) {
        return {
            success: false,
            url,
            error: error?.name === 'AbortError' ? '请求超时' : error.message
        }
    }
}

/**
 * 搜索网页。
 * @param {string} query
 * @param {Object} [options]
 * @param {string} [options.provider] - auto/openai/claude/gemini/deepseek/bing/duckduckgo
 * @param {number} [options.count] - 返回数量
 * @param {boolean} [options.fetchContent] - 是否抓取正文
 * @param {number} [options.contentMaxLength] - 正文长度
 * @returns {Promise<Record<string, any>>}
 */
export async function searchWeb(query, options = {}) {
    const settings = getSearchSettings()
    const cleanQuery = String(query || '').trim()
    if (!cleanQuery) return { success: false, error: '搜索关键词不能为空' }

    const count = Math.min(Math.max(Number(options.count) || settings.maxResults, 1), 20)
    const requestedProvider = String(options.provider || settings.provider || 'auto').toLowerCase()
    const client = getActiveClient()
    const nativeProviders = new Set(['openai', 'claude', 'gemini', 'deepseek'])
    const freeEngines = new Set(['bing', 'duckduckgo'])

    /*
     * 官方搜索策略：
     * - 显式指定官方后端（provider=openai/claude/gemini/deepseek）-> 强制，失败不回退免费引擎；
     * - 渠道 nativeSearch.enabled === true -> 强制使用当前渠道官方能力，不降级；
     * - 渠道关闭或全局关闭 -> 完全不使用官方；
     * - 其余（auto）-> 官方优先，失败回退免费引擎。
     */
    const channelPolicy = String(client?.options?.nativeSearchPolicy || 'auto').toLowerCase()
    const nativeDisabled = channelPolicy === 'off' || settings.native?.backend === false
    const explicitOfficial = nativeProviders.has(requestedProvider)
    const explicitFreeEngine = freeEngines.has(requestedProvider)

    let officialProvider = ''
    let forceOfficial = false
    if (!nativeDisabled && !explicitFreeEngine) {
        if (explicitOfficial) {
            officialProvider = requestedProvider
            forceOfficial = true
        } else {
            officialProvider = detectProvider(client)
            forceOfficial = channelPolicy === 'force'
        }
    }

    const cacheKey = makeCacheKey({
        provider: `${requestedProvider}:${officialProvider}:${forceOfficial ? 'force' : 'auto'}`,
        query: cleanQuery,
        count,
        fetchContent: options.fetchContent === true
    })
    const run = async () => {
        let provider = ''
        let answer = ''
        let results = []
        let nativeError = ''

        /*
         * 渠道显式要求官方搜索，但当前 baseUrl 不是官方端点。
         * 这种情况下不能悄悄换成第三方免费引擎，必须让调用方知道官方能力不可用。
         */
        if (forceOfficial && !officialProvider) {
            return {
                success: false,
                query: cleanQuery,
                error: '当前渠道已开启官方搜索，但渠道不是官方 OpenAI/Claude/Gemini/DeepSeek 端点，不会自动降级到第三方引擎'
            }
        }

        if (officialProvider) {
            if (!client?.apiKey) {
                if (forceOfficial) {
                    return {
                        success: false,
                        query: cleanQuery,
                        provider: officialProvider,
                        error: `已强制使用 ${officialProvider} 官方搜索，但当前渠道缺少 API Key`
                    }
                }
            } else {
                try {
                    const nativeResult = await searchWithProvider(officialProvider, cleanQuery, client, settings)
                    provider = nativeResult.provider
                    answer = nativeResult.answer || ''
                    results = nativeResult.results || []
                } catch (error) {
                    nativeError = error.message
                }
            }
        }

        /*
         * 强制官方时不再降级：把官方失败原因直接返回给调用方，
         * 避免用户以为拿到了官方结果，实际却是第三方免费引擎的结果。
         */
        if (forceOfficial && results.length === 0 && !answer) {
            const reason = nativeError || (client?.apiKey ? '官方搜索没有返回结果' : '当前渠道缺少 API Key')
            return {
                success: false,
                query: cleanQuery,
                provider: officialProvider,
                error: `已强制使用 ${officialProvider || '官方'}搜索，失败后不会自动降级：${reason}`
            }
        }

        if (results.length === 0 && !answer) {
            const engines = explicitFreeEngine ? [requestedProvider] : settings.fallbackEngines
            const errors = []
            for (const engine of engines) {
                try {
                    const engineResults = await searchFreeEngine(cleanQuery, {
                        engine,
                        count,
                        timeoutMs: settings.timeoutMs
                    })
                    if (engineResults.length > 0) {
                        provider = provider || engine
                        results = engineResults
                        break
                    }
                } catch (error) {
                    errors.push(`${engine}: ${error.message}`)
                }
            }
            if (results.length === 0) {
                if (nativeError) errors.unshift(`官方搜索: ${nativeError}`)
                return {
                    success: false,
                    query: cleanQuery,
                    error: `搜索失败：${errors.join('；') || '没有获取到结果'}`
                }
            }
        }

        results = rerankResults(results, cleanQuery).slice(0, count)

        if (options.fetchContent === true && results.length > 0) {
            const limit = Math.min(results.length, 5)
            const enriched = await Promise.all(
                results.slice(0, limit).map(async item => {
                    const page = await fetchPage(item.url, {
                        maxLength: settings.contentMaxLength,
                        timeoutMs: settings.timeoutMs
                    })
                    return page.success
                        ? { ...item, content: page.content, pageTitle: page.title }
                        : { ...item, content: '', fetchError: page.error }
                })
            )
            results = [...enriched, ...results.slice(limit)]
        }

        return {
            success: true,
            query: cleanQuery,
            provider: provider || officialProvider || 'auto',
            engine: provider,
            answer,
            count: results.length,
            results
        }
    }

    const ttl = options.fetchContent === true ? Math.min(settings.cacheTTL, 60 * 1000) : settings.cacheTTL
    return cached(cacheKey, ttl, run)
}

/**
 * 清空搜索缓存（管理接口/测试使用）。
 * @returns {void}
 */
export function clearSearchCache() {
    resultCache.clear()
    inFlight.clear()
}

export const searchService = {
    searchWeb,
    fetchPage,
    detectProvider,
    getActiveClient,
    clearSearchCache
}

export default searchService
