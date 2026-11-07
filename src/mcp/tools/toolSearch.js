/**
 * 工具检索工具（tool_search）
 *
 * 延迟加载模式下，模型初始只拿到核心工具 + tool_search。
 * 模型用它按自然语言检索其余工具，命中后由本工具把完整 schema 动态注入当前客户端，
 * 下一轮请求即可直接调用，避免一次性把所有工具定义塞进上下文。
 */

import { asyncLocalStorage } from '../../core/utils/helpers.js'
import { searchTools, formatSearchResults } from '../../services/tools/ToolSearchService.js'
import { getToolSearchSettings } from '../../services/search/SearchSettings.js'

/**
 * 读取当前请求的客户端。
 * @returns {Record<string, any> | null}
 */
function getActiveClient() {
    try {
        const store = asyncLocalStorage.getStore()
        return store?.getClient?.() || null
    } catch {
        return null
    }
}

/**
 * 读取工具名称，兼容 Chaite 与原始 MCP 格式。
 * @param {Record<string, any>} tool
 * @returns {string}
 */
function getToolName(tool) {
    return String(tool?.function?.name || tool?.name || '').trim()
}

/**
 * 解析可检索的候选工具。
 *
 * 优先级：
 * 1. 延迟加载状态里的全量候选（ChatAgent 已按预设与权限筛选）；
 * 2. 当前客户端暴露的工具；
 * 3. 内置 MCP 服务器持有的模块化工具。
 *
 * 第 3 级用于没有活跃客户端的场景（例如管理面板直接测试本工具）：
 * 此时无法注入 schema，但检索结果仍然有效，不能直接报“没有可检索的工具”。
 *
 * @param {Record<string, any> | null} client
 * @param {Record<string, any> | null} state
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function resolveCandidates(client, state) {
    if (Array.isArray(state?.candidates) && state.candidates.length > 0) {
        return state.candidates
    }
    if (Array.isArray(client?.tools) && client.tools.length > 0) {
        return client.tools
    }
    try {
        /* 动态导入：BuiltinMcpServer 会在顶层加载 tools/index，静态导入会形成循环依赖 */
        const { builtinMcpServer } = await import('../BuiltinMcpServer.js')
        if (Array.isArray(builtinMcpServer?.modularTools) && builtinMcpServer.modularTools.length > 0) {
            /*
             * 模块化工具定义本身没有 source/category 字段，直接作为候选会让
             * source=builtin、category=xxx 这类筛选永远返回空。这里按内置服务器的
             * 类别表补全，保证兜底候选与 MCP 工具列表的元数据一致。
             */
            const categoryByTool = new Map()
            for (const [key, category] of Object.entries(builtinMcpServer.toolCategories || {})) {
                for (const tool of category?.tools || []) {
                    if (tool?.name && !categoryByTool.has(tool.name)) categoryByTool.set(tool.name, key)
                }
            }
            return builtinMcpServer.modularTools.map(tool => ({
                ...tool,
                source: tool?.source || 'builtin',
                category: tool?.category || categoryByTool.get(tool?.name) || ''
            }))
        }
    } catch {
        /* 内置服务器尚未初始化时按空候选处理 */
    }
    return []
}

/**
 * 把命中工具注入客户端，返回本次新增的工具名。
 * @param {Record<string, any>} client
 * @param {Array<Record<string, any>>} hits
 * @param {Set<string>} loaded
 * @returns {string[]}
 */
function injectTools(client, hits, loaded) {
    if (!client) return []
    if (!Array.isArray(client.tools)) client.tools = []

    const existing = new Set(client.tools.map(getToolName).filter(Boolean))
    const added = []

    for (const hit of hits) {
        const name = getToolName(hit.tool)
        if (!name || existing.has(name)) continue
        client.tools.push(hit.tool)
        existing.add(name)
        loaded.add(name)
        added.push(name)
    }

    return added
}

export const toolSearchTools = [
    {
        name: 'tool_search',
        description:
            '检索可用工具。当前只加载了常用核心工具，其余工具需要先用本工具检索，命中后会自动加载并可直接调用。' +
            '用简短的中文或英文关键词描述你要完成的事情或需要的工具名，例如"群成员列表""生成图片""定时提醒""github"。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '检索关键词，描述要完成的事情或工具功能' },
                limit: { type: 'number', description: '返回并加载的工具数量，默认 8，最大 30' },
                source: {
                    type: 'string',
                    description: '限定工具来源',
                    enum: ['builtin', 'mcp', 'custom']
                },
                category: { type: 'string', description: '限定工具类别/服务名，例如 message、imageGen' },
                load: {
                    type: 'boolean',
                    description: '是否加载命中工具，默认 true。只想查看有哪些工具时设为 false'
                }
            },
            required: ['query']
        },
        handler: async args => {
            const query = String(args?.query || '').trim()
            if (!query) {
                return {
                    content: [{ type: 'text', text: '检索关键词不能为空，请提供要完成的事情或工具功能关键词。' }],
                    success: false,
                    isError: true
                }
            }

            const settings = getToolSearchSettings()
            const client = getActiveClient()
            const state = client?.toolSearchState || null
            const candidates = await resolveCandidates(client, state)

            if (candidates.length === 0) {
                return {
                    content: [{ type: 'text', text: '当前没有可检索的工具。' }],
                    success: false,
                    isError: true
                }
            }

            const limit = Math.min(
                Math.max(Number(args?.limit) || Number(state?.maxResults) || settings.maxResults, 1),
                30
            )
            const hits = searchTools(candidates, query, {
                limit,
                source: args?.source || '',
                category: args?.category || ''
            })

            const loaded = state?.loaded instanceof Set ? state.loaded : new Set()
            const autoLoad = state?.autoLoad !== false && settings.autoLoad !== false
            const shouldLoad = args?.load !== false && autoLoad
            /*
             * 无活跃客户端时（管理面板测试等）只返回检索结果。
             * 此时既不能注入 schema，也不能声称“已加载”，否则提示与实际不符。
             */
            const added = client && shouldLoad ? injectTools(client, hits, loaded) : []

            const text = formatSearchResults(hits, { loadedNames: Array.from(loaded) })
            let summary = ''
            if (added.length > 0) {
                summary = `\n\n已加载 ${added.length} 个工具，现在可以直接调用：${added.join(', ')}`
            } else if (!client) {
                summary = '\n\n当前没有活跃对话，无法自动加载工具；在对话中调用本工具会自动加载。'
            } else if (shouldLoad) {
                summary = '\n\n命中的工具均已加载，可直接调用。'
            }

            return {
                content: [{ type: 'text', text: `${text}${summary}` }],
                success: true,
                query,
                total: hits.length,
                loaded: added,
                results: hits.map(item => ({
                    name: item.name,
                    description: item.description,
                    source: item.source,
                    serverName: item.serverName,
                    requiredParams: item.requiredParams,
                    score: Math.round(item.score)
                }))
            }
        }
    }
]

export default toolSearchTools
