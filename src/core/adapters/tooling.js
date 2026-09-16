import crypto from 'node:crypto'

/**
 * 生成确定性的工具调用 ID（供无原生 id 的协议使用，如 Gemini functionCall）。
 * 使用工具名 + 参数的稳定哈希，同一轮内重复调用会得到相同 ID，
 * 且不会产生数字型 ID（OpenAI 兼容端点要求 id 必须为字符串）。
 * @param {string} toolName - 工具名
 * @param {unknown} args - 工具调用参数
 * @returns {string} 形如 call_<工具名>_<短哈希> 的确定性 ID
 */
export function generateDeterministicToolCallId(toolName, args) {
    const namePart = String(toolName || 'tool')
        .replace(/[^a-zA-Z0-9_.-]/g, '_')
        .slice(0, 40)
    let serialized = ''
    if (typeof args === 'string') {
        serialized = args
    } else if (args !== undefined && args !== null) {
        try {
            serialized = JSON.stringify(args)
        } catch {
            serialized = String(args)
        }
    }
    return `call_${namePart}_${crypto.createHash('sha256').update(serialized).digest('hex').slice(0, 8)}`
}

/**
 * 归一化工具调用 ID：任何来源的 ID 在本插件内部统一保持字符串。
 * 数字 id 不再透传，否则下一轮请求会在 OpenAI 兼容端点触发 400/500。
 * assistant 侧 tool_calls[].id 与 tool 侧 tool_call_id 走下同一条归一化，
 * 值经 String() 后类型也一致，历史配对不受影响。
 * @param {*} toolCallId - 上游工具调用 ID（string/number/空值）
 * @returns {string} 合法 ID；空值兜底为随机 UUID 字符串
 */
export function normalizeAnyToolCallId(toolCallId) {
    if (typeof toolCallId === 'string' && toolCallId.trim()) return toolCallId
    if (toolCallId === undefined || toolCallId === null || toolCallId === '') return crypto.randomUUID()
    return String(toolCallId)
}

export function getToolDefinitionName(tool) {
    return tool?.function?.name || tool?.custom?.name || tool?.name || ''
}

export function getToolServerName(tool) {
    return tool?.server_label || tool?.serverName || tool?.server_name || ''
}

export function getToolIdentity(tool) {
    if (typeof tool?.identity === 'string' && tool.identity.trim()) return tool.identity.trim()
    const name = getToolDefinitionName(tool)
    if (!name) return ''
    const serverName = getToolServerName(tool)
    const isMcpTool =
        tool?.type === 'mcp' ||
        tool?.source === 'mcp' ||
        tool?.isMcpTool === true ||
        (serverName && serverName !== 'builtin' && serverName !== 'custom-tools')
    return isMcpTool && serverName ? `mcp:${serverName}:${name}` : name
}

const SINGLETON_RESPONSES_TOOL_TYPES = new Set([
    'apply_patch',
    'shell',
    'local_shell',
    'image_generation',
    'tool_search'
])

const RESPONSES_TOOL_CHOICE_TYPES = new Set([
    'apply_patch',
    'shell',
    'local_shell',
    'file_search',
    'web_search_preview',
    'web_search_preview_2025_03_11',
    'computer',
    'computer_use_preview',
    'computer_use',
    'code_interpreter',
    'image_generation'
])

const VALID_TOOL_CHOICE_MODES = new Set(['auto', 'required'])
const TOOL_METADATA_KEYS = [
    'identity',
    'serverName',
    'server_name',
    'server_label',
    'source',
    'isMcpTool',
    'isBuiltin',
    'isCustom',
    'isJsTool',
    'category',
    'dangerous',
    'requireMaster',
    'requiredPermission',
    'requirePermission',
    'permissionRequired'
]

export function attachToolMetadata(target, source) {
    if (!target || !source || typeof target !== 'object' || typeof source !== 'object') return target
    for (const key of TOOL_METADATA_KEYS) {
        if (source[key] !== undefined && target[key] === undefined) {
            Object.defineProperty(target, key, {
                value: source[key],
                enumerable: false,
                configurable: true,
                writable: true
            })
        }
    }
    if (target.identity === undefined) {
        const identity = getToolIdentity(source)
        if (identity) {
            Object.defineProperty(target, 'identity', {
                value: identity,
                enumerable: false,
                configurable: true,
                writable: true
            })
        }
    }
    return target
}

function copyToolChoiceList(source, target) {
    if (Array.isArray(source?.tools)) {
        target.tools = source.tools
    }
    return target
}

function normalizeToolChoiceMode(mode) {
    return VALID_TOOL_CHOICE_MODES.has(mode) ? mode : undefined
}

export function normalizeToolChoice(value) {
    if (typeof value === 'string') {
        if (value === 'none' || value === 'auto') return { type: value }
        if (value === 'required' || value === 'any') return { type: 'any' }
        return null
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null

    if (value.type === 'none' || value.type === 'auto' || value.type === 'any') {
        return { type: value.type }
    }
    if (value.type === 'required') {
        return { type: 'any' }
    }
    if (value.type === 'specified' || value.type === 'allowed') {
        const result = copyToolChoiceList(value, { type: value.type })
        const mode = normalizeToolChoiceMode(value.mode)
        if (mode) result.mode = mode
        return result
    }
    if (value.type === 'allowed_tools') {
        const source = value.allowed_tools && typeof value.allowed_tools === 'object' ? value.allowed_tools : value
        const result = copyToolChoiceList(source, { type: 'allowed' })
        const mode = normalizeToolChoiceMode(source.mode)
        if (mode) result.mode = mode
        return result
    }
    if (value.type === 'tool' && value.name) {
        return { type: 'specified', tools: [value.name] }
    }
    if (value.type === 'function' || value.type === 'custom' || value.type === 'mcp') {
        return { type: 'specified', tools: [value] }
    }
    if (RESPONSES_TOOL_CHOICE_TYPES.has(value.type)) {
        return { type: 'specified', tools: [value] }
    }

    return null
}

function resolveRequestedToolChoice(options = {}, provider = 'openai-chat') {
    const raw =
        provider === 'openai-responses'
            ? (options.responsesToolChoice ??
              options.responseToolChoice ??
              options.tool_choice ??
              options.toolChoice ??
              options.openaiResponses?.tool_choice)
            : (options.tool_choice ?? options.toolChoice)
    return normalizeToolChoice(raw) || { type: 'auto' }
}

function getToolDefinitionKey(tool) {
    const name = getToolDefinitionName(tool)
    if (tool?.type === 'mcp' && tool.server_label) return `mcp:${tool.server_label}:${tool.name || ''}`
    if (tool?.isMcpTool && tool.serverName && name) return `mcp:${tool.serverName}:${name}`
    if (name) return `${tool?.type || 'function'}:${name}`
    if (SINGLETON_RESPONSES_TOOL_TYPES.has(tool?.type)) return tool.type
    if (tool?.type) return `${tool.type}:${JSON.stringify(tool)}`
    return ''
}

export function mergeToolDefinitions(...toolLists) {
    const merged = []
    const seen = new Map()
    for (const tools of toolLists) {
        if (!Array.isArray(tools)) continue
        for (const tool of tools) {
            if (!tool || typeof tool !== 'object') continue
            const key = getToolDefinitionKey(tool) || JSON.stringify(tool)
            if (seen.has(key)) {
                merged[seen.get(key)] = tool
                continue
            }
            seen.set(key, merged.length)
            merged.push(tool)
        }
    }
    return merged
}

function normalizeToolNames(toolChoice = {}) {
    return (toolChoice.tools || [])
        .map(tool => (typeof tool === 'string' ? tool : getToolDefinitionName(tool)))
        .filter(Boolean)
}

function isResponsesMcpToolChoice(tool) {
    return Boolean(
        tool &&
        typeof tool === 'object' &&
        tool.type === 'mcp' &&
        tool.server_label &&
        Object.prototype.hasOwnProperty.call(tool, 'name')
    )
}

function isResponsesMcpToolDefinition(tool) {
    return Boolean(
        tool &&
        typeof tool === 'object' &&
        tool.type === 'mcp' &&
        tool.server_label &&
        !Object.prototype.hasOwnProperty.call(tool, 'name')
    )
}

function normalizeToolNamesForProvider(toolChoice = {}, provider = '') {
    if (provider !== 'openai-responses') return normalizeToolNames(toolChoice)
    return (toolChoice.tools || [])
        .map(tool =>
            typeof tool === 'string' || !isResponsesMcpToolChoice(tool)
                ? typeof tool === 'string'
                    ? tool
                    : getToolDefinitionName(tool)
                : ''
        )
        .filter(Boolean)
}

function filterToolsByNames(tools, names) {
    if (!Array.isArray(names) || names.length === 0) return []
    const allowed = new Set(names)
    return tools.filter(tool => {
        const name = getToolDefinitionName(tool)
        const identity = getToolIdentity(tool)
        if (identity && allowed.has(identity)) return true
        if (name) return allowed.has(name)
        return tool?.type ? allowed.has(tool.type) : false
    })
}

function findToolDefinition(tools, selector) {
    const selectorKey = getToolDefinitionKey(selector)
    if (selectorKey) {
        const byKey = tools.find(tool => getToolDefinitionKey(tool) === selectorKey)
        if (byKey) return byKey
    }

    const selectorName = getToolDefinitionName(selector)
    if (selectorName) {
        const selectorIdentity = getToolIdentity(selector)
        if (selectorIdentity) {
            const byIdentity = tools.find(tool => getToolIdentity(tool) === selectorIdentity)
            if (byIdentity) return byIdentity
        }
        return tools.find(
            tool =>
                getToolDefinitionName(tool) === selectorName &&
                (!selector?.type || tool.type === selector.type) &&
                (!getToolServerName(selector) || getToolServerName(tool) === getToolServerName(selector))
        )
    }

    return null
}

function isOpenAIChatTool(tool) {
    return Boolean(
        tool &&
        typeof tool === 'object' &&
        ((tool.type === 'function' && tool.function?.name) || (tool.type === 'custom' && tool.custom?.name))
    )
}

function isFunctionTool(tool) {
    return Boolean(tool && typeof tool === 'object' && tool.function?.name)
}

function getToolParameters(tool) {
    return (
        tool?.function?.parameters ||
        tool?.parameters ||
        tool?.inputSchema ||
        tool?.input_schema || { type: 'object', properties: {} }
    )
}

function isClaudeTool(tool) {
    return Boolean(tool && typeof tool === 'object' && tool.name && tool.input_schema)
}

function isGeminiTool(tool) {
    return Boolean(tool && typeof tool === 'object' && tool.name && tool.parameters)
}

function filterToolsForProvider(tools, provider) {
    if (!Array.isArray(tools)) return []
    if (provider === 'openai-chat') return tools.filter(isOpenAIChatTool)
    if (provider === 'claude') return tools.filter(isClaudeTool)
    if (provider === 'gemini') return tools.filter(isGeminiTool)
    return tools.filter(tool => tool && typeof tool === 'object')
}

function dedupeProviderToolsByName(tools, provider = '') {
    const result = []
    const seen = new Set()
    for (const tool of tools || []) {
        const name = getToolDefinitionName(tool)
        const key =
            provider === 'openai-responses'
                ? getToolDefinitionKey(tool) || name || getToolIdentity(tool) || JSON.stringify(tool)
                : name || getToolIdentity(tool) || JSON.stringify(tool)
        if (seen.has(key)) continue
        seen.add(key)
        result.push(tool)
    }
    return result
}

export function toOpenAIChatTool(tool) {
    if (tool?.type === 'function' && (tool.function?.name || tool.name)) {
        return attachToolMetadata(
            {
                type: 'function',
                function: {
                    name: tool.function?.name || tool.name,
                    description: tool.function?.description || tool.description || '',
                    parameters: getToolParameters(tool)
                }
            },
            tool
        )
    }
    if (tool?.type === 'custom' && (tool.custom?.name || tool.name)) {
        const custom = {
            name: tool.custom?.name || tool.name,
            description: tool.custom?.description || tool.description || ''
        }
        if (tool.custom?.format || tool.format) custom.format = tool.custom?.format || tool.format
        return attachToolMetadata({ type: 'custom', custom }, tool)
    }
    if (tool?.name) {
        return attachToolMetadata(
            {
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description || '',
                    parameters: getToolParameters(tool)
                }
            },
            tool
        )
    }
    return null
}

export function toClaudeTool(tool) {
    if (isClaudeTool(tool)) {
        return attachToolMetadata(
            {
                name: tool.name,
                description: tool.description || '',
                input_schema: tool.input_schema
            },
            tool
        )
    }
    if (isFunctionTool(tool)) {
        return attachToolMetadata(
            {
                name: tool.function.name,
                description: tool.function.description || '',
                input_schema: getToolParameters(tool)
            },
            tool
        )
    }
    if (tool?.name) {
        return attachToolMetadata(
            {
                name: tool.name,
                description: tool.description || '',
                input_schema: getToolParameters(tool)
            },
            tool
        )
    }
    return null
}

export function toGeminiTool(tool) {
    if (isGeminiTool(tool) && !tool.function) {
        return attachToolMetadata(
            {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.parameters
            },
            tool
        )
    }
    if (isFunctionTool(tool)) {
        return attachToolMetadata(
            {
                name: tool.function.name,
                description: tool.function.description || '',
                parameters: getToolParameters(tool)
            },
            tool
        )
    }
    if (tool?.name) {
        return attachToolMetadata(
            {
                name: tool.name,
                description: tool.description || '',
                parameters: getToolParameters(tool)
            },
            tool
        )
    }
    return null
}

function toResponsesToolChoiceDefinition(tool) {
    if (tool.type === 'function' && tool.function) {
        return { type: 'function', name: tool.function.name }
    }
    if (tool.type === 'custom' && tool.custom?.name) {
        return { type: 'custom', name: tool.custom.name }
    }
    if (tool.type === 'mcp' && tool.server_label) {
        const result = { type: 'mcp', server_label: tool.server_label }
        if (tool.name) result.name = tool.name
        return result
    }
    if (tool.type === 'apply_patch' || tool.type === 'local_shell' || tool.type === 'shell') {
        return { type: tool.type }
    }
    if (tool.type && tool.name) {
        return { type: tool.type, name: tool.name }
    }
    return tool
}

function toOpenAIChatAllowedToolDefinition(tool) {
    if (tool.type === 'function' && (tool.function?.name || tool.name)) {
        return { type: 'function', function: { name: tool.function?.name || tool.name } }
    }
    if (tool.type === 'custom' && (tool.custom?.name || tool.name)) {
        return { type: 'custom', custom: { name: tool.custom?.name || tool.name } }
    }
    return null
}

function toOpenAIChatSpecifiedToolChoice(tool, fallbackName) {
    if (tool?.type === 'custom' && tool.custom?.name) {
        return { type: 'custom', custom: { name: tool.custom.name } }
    }
    if (tool?.type === 'custom' && tool.name) {
        return { type: 'custom', custom: { name: tool.name } }
    }
    if (tool?.type === 'function' && tool.function?.name) {
        return { type: 'function', function: { name: tool.function.name } }
    }
    if (tool?.type === 'function' && tool.name) {
        return { type: 'function', function: { name: tool.name } }
    }
    return { type: 'function', function: { name: fallbackName } }
}

function providerToolNames(filteredTools, fallbackNames = []) {
    const names = filteredTools.map(getToolDefinitionName).filter(Boolean)
    return names.length > 0 ? names : fallbackNames
}

function toResponsesAllowedTools(toolChoice, filteredTools, names) {
    const explicitTools = (toolChoice.tools || [])
        .filter(tool => tool && typeof tool === 'object')
        .map(toResponsesToolChoiceDefinition)
    const filteredAllowedTools = filteredTools.map(toResponsesToolChoiceDefinition)
    if (filteredTools.length > 0) {
        return mergeToolDefinitions(explicitTools, filteredAllowedTools)
    }
    return mergeToolDefinitions(
        explicitTools,
        names.map(name => ({ type: 'function', name }))
    )
}

function toOpenAIChatAllowedTools(toolChoice, filteredTools, names) {
    const explicitTools = (toolChoice.tools || [])
        .filter(tool => tool && typeof tool === 'object')
        .map(toOpenAIChatAllowedToolDefinition)
        .filter(Boolean)
    const filteredAllowedTools = filteredTools.map(toOpenAIChatAllowedToolDefinition).filter(Boolean)
    if (filteredAllowedTools.length > 0) {
        return mergeToolDefinitions(explicitTools, filteredAllowedTools)
    }
    return mergeToolDefinitions(
        explicitTools,
        names.map(name => ({ type: 'function', function: { name } }))
    )
}

function getExplicitResponsesTools(toolChoice = {}) {
    return (toolChoice.tools || []).filter(tool => {
        if (!tool || typeof tool !== 'object') return false
        if (!tool.type) return false
        if (tool.type === 'function' && tool.function) return false
        return true
    })
}

function resolveExplicitResponsesTools(toolChoice, tools) {
    return getExplicitResponsesTools(toolChoice).map(tool => {
        if (isResponsesMcpToolChoice(tool)) return tool
        return findToolDefinition(tools, tool) || tool
    })
}

function getResponsesMcpDefinitionsForChoices(tools, explicitResponsesTools) {
    const labels = new Set(
        explicitResponsesTools
            .filter(isResponsesMcpToolChoice)
            .map(tool => tool.server_label)
            .filter(Boolean)
    )
    if (labels.size === 0) return []
    return tools.filter(tool => isResponsesMcpToolDefinition(tool) && labels.has(tool.server_label))
}

function getExplicitResponsesToolDefinitions(tools, explicitResponsesTools) {
    return mergeToolDefinitions(
        getResponsesMcpDefinitionsForChoices(tools, explicitResponsesTools),
        explicitResponsesTools.filter(tool => !isResponsesMcpToolChoice(tool))
    )
}

export function resolveToolChoice(options = {}, tools = [], provider = 'openai-chat') {
    const rawTools = Array.isArray(tools) ? tools : []
    if (provider === 'openai-responses') {
        const responseTools = resolveOpenAIResponsesTools(options)
        if (responseTools.length > 0) {
            tools = mergeToolDefinitions(rawTools, responseTools)
        }
    }
    tools = filterToolsForProvider(tools, provider)
    const requested = resolveRequestedToolChoice(options, provider)
    if (!requested || !requested.type || requested.type === 'auto') {
        return {
            tools: dedupeProviderToolsByName(tools, provider),
            toolChoice: provider === 'claude' ? { type: 'auto' } : provider === 'gemini' ? undefined : 'auto',
            toolConfig: provider === 'gemini' ? { functionCallingConfig: { mode: 'AUTO' } } : undefined,
            disabled: false
        }
    }

    if (requested.type === 'none') {
        return {
            tools: [],
            toolChoice: provider === 'claude' ? undefined : provider === 'gemini' ? undefined : 'none',
            toolConfig: provider === 'gemini' ? { functionCallingConfig: { mode: 'NONE' } } : undefined,
            disabled: true
        }
    }

    if (requested.type === 'any') {
        return {
            tools: dedupeProviderToolsByName(tools, provider),
            toolChoice: provider === 'claude' ? { type: 'any' } : provider === 'gemini' ? undefined : 'required',
            toolConfig: provider === 'gemini' ? { functionCallingConfig: { mode: 'ANY' } } : undefined,
            disabled: false
        }
    }

    if (requested.type === 'specified' || requested.type === 'allowed') {
        const names = normalizeToolNamesForProvider(requested, provider)
        const explicitTools = (requested.tools || []).filter(tool => tool && typeof tool === 'object')
        const explicitResponsesTools = resolveExplicitResponsesTools(requested, tools)
        const hasExplicitResponsesTools = provider === 'openai-responses' && explicitResponsesTools.length > 0
        if (names.length === 0 && !hasExplicitResponsesTools) {
            throw new Error('`toolChoice.tools` must be set when `toolChoice.type` is `specified` or `allowed`')
        }

        const filteredTools = filterToolsByNames(tools, names)
        const providerNames = providerToolNames(filteredTools, names)
        const firstName = providerNames[0]
        const required = requested.type === 'specified' || requested.mode === 'required'

        if (provider === 'openai-responses') {
            const explicitResponseToolDefinitions = getExplicitResponsesToolDefinitions(tools, explicitResponsesTools)
            if (requested.type === 'specified' && explicitResponsesTools.length === 1) {
                return {
                    tools: dedupeProviderToolsByName(
                        mergeToolDefinitions(explicitResponseToolDefinitions, filteredTools),
                        provider
                    ),
                    toolChoice: toResponsesToolChoiceDefinition(explicitResponsesTools[0]),
                    disabled: false
                }
            }

            const firstTool = filteredTools[0]
            return {
                tools: dedupeProviderToolsByName(
                    requested.type === 'allowed'
                        ? mergeToolDefinitions(filteredTools, explicitResponseToolDefinitions)
                        : mergeToolDefinitions(filteredTools, explicitResponseToolDefinitions),
                    provider
                ),
                toolChoice:
                    requested.type === 'allowed'
                        ? {
                              type: 'allowed_tools',
                              mode: required ? 'required' : 'auto',
                              tools: toResponsesAllowedTools(requested, filteredTools, names)
                          }
                        : firstTool
                          ? toResponsesToolChoiceDefinition(firstTool)
                          : { type: 'function', name: names[0] },
                disabled: false
            }
        }

        if (provider === 'openai-chat') {
            const explicitChatTools = explicitTools.filter(isOpenAIChatTool)
            const firstTool = filteredTools[0] || explicitChatTools[0]
            return {
                tools: dedupeProviderToolsByName(
                    requested.type === 'allowed'
                        ? mergeToolDefinitions(filteredTools, explicitChatTools)
                        : filteredTools,
                    provider
                ),
                toolChoice:
                    requested.type === 'specified'
                        ? toOpenAIChatSpecifiedToolChoice(firstTool, firstName)
                        : {
                              type: 'allowed_tools',
                              allowed_tools: {
                                  mode: required ? 'required' : 'auto',
                                  tools: toOpenAIChatAllowedTools(requested, filteredTools, names)
                              }
                          },
                disabled: false
            }
        }

        if (provider === 'claude') {
            return {
                tools: dedupeProviderToolsByName(filteredTools, provider),
                toolChoice:
                    requested.type === 'specified'
                        ? { type: 'tool', name: firstName }
                        : { type: required ? 'any' : 'auto' },
                disabled: false
            }
        }

        if (provider === 'gemini') {
            return {
                tools: dedupeProviderToolsByName(filteredTools, provider),
                toolConfig: {
                    functionCallingConfig: {
                        mode: required ? 'ANY' : 'AUTO',
                        allowedFunctionNames: providerNames
                    }
                },
                disabled: false
            }
        }
    }

    return {
        tools: dedupeProviderToolsByName(tools, provider),
        toolChoice: provider === 'claude' ? { type: 'auto' } : 'auto',
        disabled: false
    }
}

function resolveOpenAIResponsesTools(options = {}) {
    const responsesConfig = {
        ...(options.openaiResponses || {}),
        ...(options.responsesOptions || {})
    }
    return Array.isArray(responsesConfig.tools) ? responsesConfig.tools : []
}
