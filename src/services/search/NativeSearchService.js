/**
 * 官方 hosted search 解析。
 *
 * 这里只负责判断“当前渠道能不能在请求里附带官方搜索工具”，
 * 具体如何拼装请求由各适配器完成，避免把 provider 细节散落到业务层。
 */

import { getSearchSettings } from './SearchSettings.js'

/**
 * 判断 host 是否属于官方域名。
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
 * 根据渠道信息推断官方搜索提供方。
 *
 * 判定口径：优先看 baseUrl 是否官方域名；只有 baseUrl 为空（客户端自行拼默认域名）时
 * 才用 adapterType 兜底。这样第三方中转（含自建反代）不会被误判为官方，
 * 避免向不支持官方搜索工具的服务端发送 web_search 导致 400。
 *
 * @param {Object} params
 * @param {string} params.adapterType
 * @param {string} params.baseUrl
 * @param {string} params.model
 * @returns {'openai'|'claude'|'gemini'|'deepseek'|''}
 */
export function resolveSearchProvider({ adapterType, baseUrl, model }) {
    const type = String(adapterType || '').toLowerCase()
    const url = String(baseUrl || '').toLowerCase()
    const modelName = String(model || '').toLowerCase()

    if (matchesHost(url, ['api.anthropic.com'])) return 'claude'
    if (matchesHost(url, ['generativelanguage.googleapis.com'])) return 'gemini'
    if (matchesHost(url, ['api.deepseek.com']) || modelName.includes('deepseek')) return 'deepseek'
    if (matchesHost(url, ['api.openai.com'])) return 'openai'

    // baseUrl 未配置时按适配器类型兜底（SDK 会使用厂商默认域名）
    if (!url) {
        if (type === 'claude') return 'claude'
        if (type === 'gemini') return 'gemini'
    }
    return ''
}

/**
 * 判断 DeepSeek 模型是否支持 Responses API 的 web_search。
 *
 * 依据官方文档（api-docs.deepseek.com/guides/responses_api）：
 * `web_search` 仅在 deepseek-v4-pro 上生效，deepseek-flash 等模型会被静默忽略。
 *
 * @param {string} model
 * @returns {boolean}
 */
function supportsDeepSeekWebSearch(model) {
    return String(model || '')
        .toLowerCase()
        .includes('v4-pro')
}

/**
 * 解析当前请求可用的官方 hosted search。
 *
 * @param {Object} params
 * @param {string} params.adapterType - 适配器类型
 * @param {string} params.baseUrl - 渠道 baseUrl
 * @param {string} params.model - 实际模型
 * @param {string} [params.apiInterface] - chat / responses
 * @param {boolean} [params.hasFunctionTools] - 是否已有 function tools
 * @param {Record<string, any>} [params.channel] - 渠道配置（支持 nativeSearch 覆盖）
 * @returns {{enabled: boolean, provider: string, tool?: Record<string, any>, maxUses?: number, reason?: string}}
 */
export function resolveHostedSearch({
    adapterType,
    baseUrl,
    model,
    apiInterface = 'chat',
    hasFunctionTools = false,
    channel = null
}) {
    const settings = getSearchSettings()
    if (settings.native?.hosted === false) {
        return { enabled: false, provider: '', reason: 'hosted search 已全局关闭' }
    }

    const channelOverride = channel?.nativeSearch || {}
    if (channelOverride.enabled === false) {
        return { enabled: false, provider: '', reason: '该渠道已关闭官方搜索' }
    }

    const provider = resolveSearchProvider({ adapterType, baseUrl, model })
    if (!provider) {
        return { enabled: false, provider: '', reason: '当前渠道不是官方 OpenAI/Claude/Gemini/DeepSeek 端点' }
    }

    const maxUses = Math.min(Math.max(Number(channelOverride.maxUses || settings.native?.maxUses) || 5, 1), 20)
    const interfaceMode = String(apiInterface || 'chat').toLowerCase()

    if (provider === 'openai' || provider === 'deepseek') {
        if (interfaceMode !== 'responses') {
            return {
                enabled: false,
                provider,
                reason: `${provider} 官方 hosted web_search 仅在 Responses 接口下可用`
            }
        }
        if (provider === 'deepseek' && !supportsDeepSeekWebSearch(model)) {
            return { enabled: false, provider, reason: '当前 DeepSeek 模型不支持 hosted web_search' }
        }
        return {
            enabled: true,
            provider,
            maxUses,
            tool: { type: 'web_search' }
        }
    }

    if (provider === 'claude') {
        return {
            enabled: true,
            provider,
            maxUses,
            tool: {
                type: 'web_search_20250305',
                name: 'web_search',
                max_uses: maxUses
            }
        }
    }

    if (provider === 'gemini') {
        // Gemini 的 google_search 不能与普通 function declarations 同时出现。
        if (hasFunctionTools && settings.native?.geminiReplaceTools !== true) {
            return {
                enabled: false,
                provider,
                reason: 'Gemini google_search 与 function tools 不兼容；可让内置 web_search 走官方后端'
            }
        }
        return {
            enabled: true,
            provider,
            maxUses,
            tool: { googleSearch: {} },
            replaceTools: hasFunctionTools && settings.native?.geminiReplaceTools === true
        }
    }

    return { enabled: false, provider, reason: '未识别的官方搜索提供方' }
}

export const nativeSearchService = {
    resolveHostedSearch,
    resolveSearchProvider
}

export default nativeSearchService
