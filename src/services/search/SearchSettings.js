/**
 * 联网搜索与工具检索的配置读取。
 *
 * 所有配置均挂在 builtinTools 下，与现有工具管理面板共用同一份 config.yaml，
 * 避免再引入独立的配置文件与迁移逻辑。
 */

import config from '../../../config/config.js'

/** @type {Readonly<Record<string, any>>} */
export const DEFAULT_SEARCH_SETTINGS = Object.freeze({
    // 内置 web_search 的后端选择：auto 时优先使用当前渠道的官方搜索能力，失败后回退免费引擎
    provider: 'auto',
    // 免费引擎回退顺序
    fallbackEngines: ['bing', 'duckduckgo'],
    // 结果缓存时间（毫秒）
    cacheTTL: 5 * 60 * 1000,
    // 单次搜索超时（毫秒）
    timeoutMs: 10000,
    // 默认返回结果数
    maxResults: 5,
    // 是否默认抓取前几条结果的正文
    fetchContent: false,
    // 正文最大长度
    contentMaxLength: 3000,
    // 官方搜索能力
    native: {
        // 内置 web_search 使用官方搜索 API 作为后端
        backend: true,
        // 主对话请求中附加官方 hosted search 工具
        hosted: true,
        // Gemini 的 google_search 不能与 function declarations 同时使用，默认不替换工具
        geminiReplaceTools: false,
        // Claude web_search 单轮最大搜索次数
        maxUses: 5
    }
})

/** @type {Readonly<Record<string, any>>} */
export const DEFAULT_TOOL_SEARCH_SETTINGS = Object.freeze({
    // 是否启用延迟加载：只暴露核心工具 + tool_search，命中后再注入完整工具
    enabled: false,
    // 核心工具（始终暴露）。tool_search 会自动加入，无需配置
    coreTools: [
        'get_time',
        'get_date',
        'get_system_info',
        'web_search',
        'fetch_webpage',
        'send_message',
        'reply_current_message',
        'search_group_history'
    ],
    // 单次搜索返回并注入的工具数量上限
    maxResults: 8,
    // 搜索命中后是否自动注入工具 schema
    autoLoad: true,
    // 是否把工具名称/描述索引缓存到进程内
    cacheIndex: true
})

/**
 * 深度合并对象，数组直接覆盖。
 * @param {Record<string, any>} base
 * @param {Record<string, any>} override
 * @returns {Record<string, any>}
 */
function mergeSettings(base, override) {
    if (!override || typeof override !== 'object' || Array.isArray(override)) return { ...base }
    const result = { ...base }
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined) continue
        const baseValue = base[key]
        if (
            baseValue &&
            typeof baseValue === 'object' &&
            !Array.isArray(baseValue) &&
            value &&
            typeof value === 'object' &&
            !Array.isArray(value)
        ) {
            result[key] = mergeSettings(baseValue, value)
        } else {
            result[key] = value
        }
    }
    return result
}

/**
 * 读取联网搜索配置。
 * @returns {typeof DEFAULT_SEARCH_SETTINGS}
 */
export function getSearchSettings() {
    return mergeSettings(DEFAULT_SEARCH_SETTINGS, config.get('builtinTools.search') || {})
}

/**
 * 读取工具检索配置。
 * @returns {typeof DEFAULT_TOOL_SEARCH_SETTINGS}
 */
export function getToolSearchSettings() {
    const settings = mergeSettings(DEFAULT_TOOL_SEARCH_SETTINGS, config.get('builtinTools.toolSearch') || {})
    settings.coreTools = Array.isArray(settings.coreTools)
        ? Array.from(new Set(settings.coreTools.map(item => String(item || '').trim()).filter(Boolean)))
        : [...DEFAULT_TOOL_SEARCH_SETTINGS.coreTools]
    settings.maxResults = Math.min(Math.max(Number(settings.maxResults) || 8, 1), 30)
    return settings
}

/**
 * 校验并归一化搜索配置，供管理接口写入。
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function normalizeSearchSettings(input = {}) {
    const merged = mergeSettings(DEFAULT_SEARCH_SETTINGS, input)
    merged.provider = String(merged.provider || 'auto').toLowerCase()
    merged.maxResults = Math.min(Math.max(Number(merged.maxResults) || 5, 1), 20)
    merged.cacheTTL = Math.min(Math.max(Number(merged.cacheTTL) || 0, 0), 60 * 60 * 1000)
    merged.timeoutMs = Math.min(Math.max(Number(merged.timeoutMs) || 10000, 1000), 60000)
    merged.contentMaxLength = Math.min(Math.max(Number(merged.contentMaxLength) || 3000, 200), 20000)
    merged.fallbackEngines = Array.isArray(merged.fallbackEngines)
        ? merged.fallbackEngines
              .map(item => String(item || '').toLowerCase())
              .filter(item => ['bing', 'duckduckgo'].includes(item))
        : [...DEFAULT_SEARCH_SETTINGS.fallbackEngines]
    merged.native = mergeSettings(DEFAULT_SEARCH_SETTINGS.native, merged.native || {})
    merged.native.maxUses = Math.min(Math.max(Number(merged.native.maxUses) || 5, 1), 20)
    return merged
}

/**
 * 校验并归一化工具检索配置。
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
export function normalizeToolSearchSettings(input = {}) {
    const merged = mergeSettings(DEFAULT_TOOL_SEARCH_SETTINGS, input)
    merged.enabled = merged.enabled === true
    merged.autoLoad = merged.autoLoad !== false
    merged.cacheIndex = merged.cacheIndex !== false
    merged.coreTools = Array.isArray(merged.coreTools)
        ? Array.from(new Set(merged.coreTools.map(item => String(item || '').trim()).filter(Boolean)))
        : [...DEFAULT_TOOL_SEARCH_SETTINGS.coreTools]
    merged.maxResults = Math.min(Math.max(Number(merged.maxResults) || 8, 1), 30)
    return merged
}
