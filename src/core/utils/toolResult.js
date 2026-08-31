/**
 * MCP/模型工具结果归一化。
 *
 * 内部保留 MCP content[]、structuredContent、isError；发送给仅接受文本工具结果的
 * 协议时提供兼容 JSON 文本。日志使用无二进制副本，避免把 base64/blob 整段落盘。
 */

const MODEL_TEXT_LIMIT = 50000
const LOG_TEXT_LIMIT = 4000

/**
 * 估算 base64 字符串对应的字节数。
 * @param {string} value - base64 数据
 * @returns {number} 估算字节数
 */
function estimateBase64Bytes(value) {
    const text = String(value || '')
    const payload = text.includes(',') ? text.slice(text.indexOf(',') + 1) : text
    return Math.max(
        0,
        Math.floor((payload.length * 3) / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0)
    )
}

/**
 * 安全序列化并限制供模型读取的结构化数据。
 * @param {*} value - 任意值
 * @param {number} [limit] - 字符上限
 * @returns {string} JSON 或文本
 */
export function stringifyToolValue(value, limit = MODEL_TEXT_LIMIT) {
    if (value === undefined) return ''
    if (typeof value === 'string') return value.length > limit ? `${value.slice(0, limit)}…[truncated]` : value
    let text
    try {
        text = JSON.stringify(value)
    } catch {
        text = String(value)
    }
    return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text
}

/**
 * 将 MCP 内容块转成所有模型均可消费的文本。
 * @param {Object} block - MCP 内容块
 * @returns {string} 兼容文本
 */
export function mcpContentBlockToText(block) {
    if (!block || typeof block !== 'object') return String(block ?? '')
    switch (block.type) {
        case 'text':
            return String(block.text || '')
        case 'image':
            return `[图片 mimeType=${block.mimeType || 'unknown'} bytes=${estimateBase64Bytes(block.data)}]`
        case 'audio':
            return `[音频 mimeType=${block.mimeType || 'unknown'} bytes=${estimateBase64Bytes(block.data)}]`
        case 'resource_link':
            return `[资源链接 ${block.name || ''} ${block.uri || ''}]`.trim()
        case 'resource': {
            const resource = block.resource || {}
            if (typeof resource.text === 'string') {
                return `[资源 ${resource.uri || ''}]\n${resource.text}`
            }
            return `[二进制资源 ${resource.uri || ''} mimeType=${resource.mimeType || 'unknown'} bytes=${estimateBase64Bytes(resource.blob)}]`
        }
        default:
            return stringifyToolValue(sanitizeToolResultForLog(block), LOG_TEXT_LIMIT)
    }
}

/**
 * 深度复制工具结果并移除二进制正文。
 * @param {*} value - 工具结果
 * @param {WeakSet<object>} [seen] - 循环引用集合
 * @returns {*} 日志安全结果
 */
export function sanitizeToolResultForLog(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value
    if (typeof value === 'string') {
        return value.length > LOG_TEXT_LIMIT ? `${value.slice(0, LOG_TEXT_LIMIT)}…[truncated]` : value
    }
    if (typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeToolResultForLog(item, seen))

    const result = {}
    for (const [key, child] of Object.entries(value)) {
        const isBinaryField = ['data', 'blob', 'audio', 'image'].includes(key)
        if (isBinaryField && typeof child === 'string' && child.length > 256) {
            result[key] = `[binary omitted, bytes=${estimateBase64Bytes(child)}]`
            continue
        }
        result[key] = sanitizeToolResultForLog(child, seen)
    }
    return result
}

/**
 * 把任意工具返回归一为内部 MCP 兼容结果。
 * @param {*} rawResult - 原始工具返回
 * @param {Object} [options] - 归一化选项
 * @returns {Object} 归一结果
 */
export function normalizeToolExecutionResult(rawResult, options = {}) {
    if (rawResult?.__normalizedToolResult === true) return rawResult

    let source = rawResult
    if (typeof source === 'string' && source.trim().startsWith('{')) {
        try {
            source = JSON.parse(source)
        } catch {
            // 普通文本结果保持字符串。
        }
    }

    const isObject = source && typeof source === 'object' && !Array.isArray(source)
    const isError = Boolean(
        isObject && (source.isError === true || source.success === false || source.status === 'error')
    )
    let mcpContent
    if (isObject && Array.isArray(source.content)) {
        mcpContent = source.content.map(block =>
            block && typeof block === 'object' && block.type
                ? { ...block }
                : { type: 'text', text: stringifyToolValue(block) }
        )
    } else if (isObject && source.content !== undefined) {
        mcpContent = [{ type: 'text', text: stringifyToolValue(source.content) }]
    } else {
        mcpContent = [{ type: 'text', text: stringifyToolValue(source) }]
    }

    const structuredContent = isObject ? source.structuredContent : undefined
    const textParts = mcpContent.map(mcpContentBlockToText).filter(Boolean)
    if (structuredContent !== undefined) {
        textParts.push(`structuredContent: ${stringifyToolValue(structuredContent)}`)
    }
    const text = textParts.join('\n') || (isError ? '工具执行失败' : '工具执行完成')
    const toolName = options.toolName || (isObject ? source.tool || source.name : '') || 'unknown_tool'
    const duration = options.duration ?? (isObject ? source.metadata?.duration : undefined) ?? 0
    const providerEnvelope = {
        status: isError ? 'error' : 'success',
        tool: toolName,
        content: text,
        ...(structuredContent !== undefined ? { structuredContent } : {}),
        metadata: { ...(isObject ? source.metadata : {}), duration }
    }

    return {
        __normalizedToolResult: true,
        status: providerEnvelope.status,
        tool: toolName,
        content: text,
        providerContent: stringifyToolValue(providerEnvelope),
        mcpContent,
        ...(structuredContent !== undefined ? { structuredContent } : {}),
        isError,
        metadata: providerEnvelope.metadata,
        rawResult
    }
}
