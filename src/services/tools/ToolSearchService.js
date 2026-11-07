/**
 * 工具检索服务。
 *
 * 目标是在 300+ 个工具中快速、准确地定位少量相关工具，并把结果压缩成
 * 适合模型阅读的短文本，避免把完整 JSON Schema 全部塞进上下文。
 */

const CJK_PATTERN = /[\u3400-\u9fff]/
const TOKEN_SPLIT_PATTERN = /[^\p{L}\p{N}_-]+/u

/**
 * 常见中英文/同义词扩展。键为归一化后的词，值为额外参与匹配的词。
 * 只做轻量扩展，避免把搜索变成不可控的语义推理。
 * @type {Record<string, string[]>}
 */
const SYNONYMS = {
    搜索: ['search', '查询', '查找', '检索'],
    search: ['搜索', '查询', '查找'],
    查询: ['search', 'query', '获取', '查找'],
    query: ['查询', 'search'],
    图片: ['image', 'img', '照片', '绘图', '生成图'],
    image: ['图片', 'img', '照片'],
    绘图: ['image', '画图', '生成图片', 'draw'],
    画图: ['draw', '绘图', 'image'],
    群: ['group', '群组', '群聊'],
    group: ['群', '群组', '群聊'],
    成员: ['member', '用户', '群员'],
    member: ['成员', '用户', '群员'],
    消息: ['message', '聊天记录', '发送'],
    message: ['消息', '聊天记录', '发送'],
    文件: ['file', '文档', '目录'],
    file: ['文件', '文档', '目录'],
    记忆: ['memory', '记住', '回忆'],
    memory: ['记忆', '记住', '回忆'],
    语音: ['voice', '音频', 'tts', '声聊'],
    voice: ['语音', '音频', 'tts'],
    天气: ['weather', '气温'],
    weather: ['天气', '气温'],
    时间: ['time', '日期', '现在几点'],
    time: ['时间', '日期'],
    日期: ['date', '时间'],
    date: ['日期', '时间'],
    网页: ['web', 'url', '链接', '抓取'],
    web: ['网页', 'url', '链接'],
    视频: ['video', 'b站', 'bilibili'],
    video: ['视频', 'b站'],
    音乐: ['music', '歌曲', '点歌'],
    music: ['音乐', '歌曲'],
    翻译: ['translate', '翻译'],
    提醒: ['reminder', '定时', '闹钟'],
    reminder: ['提醒', '定时'],
    定时: ['schedule', 'cron', '任务'],
    权限: ['permission', '管理员', '主人'],
    permission: ['权限', '管理员'],
    统计: ['stats', '排行', '活跃'],
    stats: ['统计', '排行', '活跃']
}

/**
 * 归一化文本。
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
    return String(value ?? '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * 把查询/文本切分为检索 token。
 * 中文额外生成二元组，兼顾召回与精度。
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
    const normalized = normalizeText(text)
    if (!normalized) return []
    const rawTokens = normalized.split(TOKEN_SPLIT_PATTERN).filter(Boolean)
    const tokens = new Set()

    for (const token of rawTokens) {
        tokens.add(token)
        const expansions = SYNONYMS[token]
        if (Array.isArray(expansions)) {
            for (const item of expansions) tokens.add(normalizeText(item))
        }
        if (CJK_PATTERN.test(token) && token.length > 2) {
            for (let i = 0; i < token.length - 1; i++) {
                tokens.add(token.slice(i, i + 2))
            }
        }
    }

    // 中文查询没有空格时，rawTokens 可能是一个长串，补充整串与二元组
    if (rawTokens.length === 1 && CJK_PATTERN.test(rawTokens[0]) && rawTokens[0].length > 2) {
        const token = rawTokens[0]
        tokens.add(token)
        for (let i = 0; i < token.length - 1; i++) tokens.add(token.slice(i, i + 2))
    }

    return Array.from(tokens).filter(token => token.length > 0)
}

/**
 * 计算子序列匹配比例，用于英文/拼音的模糊匹配。
 * @param {string} needle
 * @param {string} haystack
 * @returns {number} 0-1
 */
function subsequenceRatio(needle, haystack) {
    if (!needle || !haystack) return 0
    let index = 0
    let matched = 0
    for (const char of needle) {
        const found = haystack.indexOf(char, index)
        if (found === -1) continue
        matched++
        index = found + 1
    }
    return matched / needle.length
}

/**
 * 从工具对象中读取字段，兼容 Chaite 工具与原始 MCP 工具。
 * @param {Record<string, any>} tool
 * @returns {{rawName: string, name: string, description: string, parameters: Record<string, any>, identity: string, source: string, serverName: string, category: string}}
 */
function readToolFields(tool) {
    const fn = tool?.function || {}
    const parameters = fn.parameters || tool?.inputSchema || tool?.parameters || { type: 'object', properties: {} }
    return {
        /* 展示与注入必须用原始名称：第三方 MCP 工具名可能含大写，小写化后模型会调用到不存在的工具 */
        rawName: String(fn.name || tool?.name || '').trim(),
        name: normalizeText(fn.name || tool?.name || ''),
        description: normalizeText(fn.description || tool?.description || ''),
        parameters,
        identity: normalizeText(tool?.identity || ''),
        source: normalizeText(tool?.source || (tool?.isMcpTool ? 'mcp' : tool?.isBuiltin ? 'builtin' : '')),
        serverName: normalizeText(tool?.serverName || tool?.server_name || ''),
        category: normalizeText(tool?.category || tool?.serverName || tool?.server_name || '')
    }
}

/**
 * 生成工具索引文档。
 * @param {Array<Record<string, any>>} tools
 * @returns {Array<Record<string, any>>}
 */
function buildDocuments(tools) {
    return (Array.isArray(tools) ? tools : []).map(tool => {
        const fields = readToolFields(tool)
        const paramNames = Object.keys(fields.parameters?.properties || {}).map(normalizeText)
        const paramText = paramNames.join(' ')
        const text = [fields.name, fields.identity, fields.description, fields.category, fields.serverName, paramText]
            .filter(Boolean)
            .join(' ')
        return {
            tool,
            ...fields,
            paramNames,
            text,
            tokenSet: new Set(tokenize(text))
        }
    })
}

/**
 * 工具索引缓存。同一个候选数组在递归工具调用中会被反复检索。
 * @type {WeakMap<Array<any>, Array<Record<string, any>>>}
 */
const documentCache = new WeakMap()

/**
 * 获取（或构建）工具索引。
 * @param {Array<Record<string, any>>} tools
 * @returns {Array<Record<string, any>>}
 */
function getDocuments(tools) {
    if (!Array.isArray(tools)) return []
    const cached = documentCache.get(tools)
    if (cached) return cached
    const documents = buildDocuments(tools)
    documentCache.set(tools, documents)
    return documents
}

/**
 * 计算每个 token 的逆文档频率，降低“获取/工具”这类高频词的权重。
 * @param {Array<Record<string, any>>} documents
 * @param {string[]} tokens
 * @returns {Map<string, number>}
 */
function buildIdf(documents, tokens) {
    const idf = new Map()
    const total = Math.max(documents.length, 1)
    for (const token of tokens) {
        let df = 0
        for (const doc of documents) {
            if (doc.text.includes(token)) df++
        }
        idf.set(token, Math.log(1 + total / (1 + df)))
    }
    return idf
}

/**
 * 对单个工具打分。
 * @param {Record<string, any>} doc
 * @param {string[]} queryTokens
 * @param {string} rawQuery
 * @param {Map<string, number>} idf
 * @returns {number}
 */
function scoreDocument(doc, queryTokens, rawQuery, idf) {
    let score = 0
    const name = doc.name
    const identity = doc.identity

    if (name === rawQuery || identity === rawQuery) score += 140
    else if (name.startsWith(rawQuery) || identity.startsWith(rawQuery)) score += 95
    else if (name.includes(rawQuery) || identity.includes(rawQuery)) score += 70

    let matchedTokens = 0
    for (const token of queryTokens) {
        const weight = idf.get(token) || 1
        let matched = false
        if (name.includes(token)) {
            score += 30 * weight
            matched = true
        }
        if (identity.includes(token)) {
            score += 18 * weight
            matched = true
        }
        if (doc.description.includes(token)) {
            score += 12 * weight
            matched = true
        }
        if (doc.paramNames.some(param => param.includes(token))) {
            score += 8 * weight
            matched = true
        }
        if (doc.category.includes(token) || doc.serverName.includes(token)) {
            score += 10 * weight
            matched = true
        }
        if (doc.tokenSet.has(token)) {
            score += 4 * weight
            matched = true
        }
        if (matched) matchedTokens++
    }

    if (queryTokens.length > 0) {
        score += (matchedTokens / queryTokens.length) * 45
    }

    // 名称模糊匹配兜底，处理缩写/拼写不完整
    if (score < 40 && !CJK_PATTERN.test(rawQuery)) {
        const ratio = subsequenceRatio(rawQuery, name)
        if (ratio >= 0.7) score += ratio * 25
    }

    return score
}

/**
 * 搜索工具。
 * @param {Array<Record<string, any>>} tools - 候选工具
 * @param {string} query - 查询词
 * @param {Object} [options]
 * @param {number} [options.limit=8] - 返回数量
 * @param {string} [options.source] - 限定来源：builtin/custom/mcp
 * @param {string} [options.category] - 限定类别
 * @param {boolean} [options.includeSelf=false] - 是否包含 tool_search 自身
 * @returns {Array<{tool: Record<string, any>, name: string, description: string, source: string, serverName: string, category: string, requiredParams: string[], score: number}>}
 */
export function searchTools(tools, query, options = {}) {
    const { limit = 8, source = '', category = '', includeSelf = false } = options
    const rawQuery = normalizeText(query)
    if (!rawQuery) return []

    let documents = getDocuments(tools)
    if (!includeSelf) documents = documents.filter(doc => doc.name !== 'tool_search')
    if (source) documents = documents.filter(doc => doc.source === normalizeText(source))
    if (category) documents = documents.filter(doc => doc.category === normalizeText(category))

    const queryTokens = tokenize(rawQuery)
    const idf = buildIdf(documents, queryTokens)
    const scored = []

    for (const doc of documents) {
        const score = scoreDocument(doc, queryTokens, rawQuery, idf)
        if (score <= 0) continue
        const required = Array.isArray(doc.parameters?.required) ? doc.parameters.required.map(String).slice(0, 8) : []
        scored.push({
            tool: doc.tool,
            name: doc.rawName || doc.name,
            description: doc.description,
            source: doc.source,
            serverName: doc.serverName,
            category: doc.category,
            requiredParams: required,
            score
        })
    }

    scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    return scored.slice(0, Math.min(Math.max(Number(limit) || 8, 1), 30))
}

/**
 * 把搜索结果压缩成短文本，避免返回完整 schema。
 * @param {Array<Record<string, any>>} results
 * @param {Object} [options]
 * @param {string[]} [options.loadedNames]
 * @param {number} [options.descriptionLimit=160]
 * @returns {string}
 */
export function formatSearchResults(results, options = {}) {
    const { loadedNames = [], descriptionLimit = 160 } = options
    const loaded = new Set(loadedNames)
    if (!Array.isArray(results) || results.length === 0) {
        return '未找到匹配的工具。可以换用更短的关键词，或直接描述你要完成的事情。'
    }

    const lines = results.map((item, index) => {
        const description =
            item.description.length > descriptionLimit
                ? `${item.description.slice(0, descriptionLimit)}…`
                : item.description || '无描述'
        const meta = [
            item.source ? `来源:${item.source}` : '',
            item.serverName && item.serverName !== item.source ? `服务:${item.serverName}` : '',
            item.category && item.category !== item.serverName ? `类别:${item.category}` : '',
            item.requiredParams.length > 0 ? `必填:${item.requiredParams.join(',')}` : ''
        ]
            .filter(Boolean)
            .join(' | ')
        const state = loaded.has(item.name) ? ' [已加载]' : ''
        return `${index + 1}. ${item.name}${state} — ${description}${meta ? ` (${meta})` : ''}`
    })

    return `找到 ${results.length} 个匹配工具：\n${lines.join('\n')}`
}

export const toolSearchService = {
    searchTools,
    formatSearchResults,
    tokenize
}

export default toolSearchService
