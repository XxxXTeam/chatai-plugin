/**
 * MCP 传输层共享协议工具。
 *
 * 这里集中处理现代版本的头部编码与 x-mcp-header 参数镜像，客户端和服务端必须使用
 * 同一套路径遍历与比较规则，避免代理层看到的值与实际执行值不一致。
 */

const HEADER_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const PRIMITIVE_HEADER_TYPES = new Set(['string', 'integer', 'boolean'])

/** MCP 工具定义允许透传的可选协议元数据字段。 */
export const MCP_TOOL_METADATA_FIELDS = Object.freeze(['title', 'icons', 'outputSchema', 'annotations', '_meta'])
/** MCP 资源定义允许透传的可选协议元数据字段。 */
export const MCP_RESOURCE_METADATA_FIELDS = Object.freeze([
    'title',
    'icons',
    'annotations',
    'size',
    'uriTemplate',
    '_meta'
])
/** MCP 资源模板定义允许透传的可选协议元数据字段。 */
export const MCP_RESOURCE_TEMPLATE_METADATA_FIELDS = Object.freeze(['title', 'icons', 'annotations', 'size', '_meta'])
/** MCP 提示词定义允许透传的可选协议元数据字段。 */
export const MCP_PROMPT_METADATA_FIELDS = Object.freeze(['title', 'icons', 'annotations', '_meta'])

/**
 * 复制定义中实际存在的协议元数据，避免暴露 handler/client 等运行时字段。
 * @param {*} source - 原始定义
 * @param {string[]} fields - 允许复制的字段
 * @returns {Object} 元数据副本
 */
export function copyMcpDefinitionMetadata(source, fields) {
    if (!source || typeof source !== 'object' || !Array.isArray(fields)) return {}
    const metadata = {}
    for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined) {
            metadata[field] = source[field]
        }
    }
    return metadata
}

/**
 * 编码可放入 HTTP 头的 MCP 值。
 * @param {*} value - 原始值
 * @returns {string} 可安全传输的头部值
 */
export function encodeMcpHeaderValue(value) {
    const text = String(value)
    const plainSafe = /^[\x20-\x7e\t]*$/.test(text) && !/^[\t ]|[\t ]$/.test(text)
    if (plainSafe && !/^=\?base64\?.*\?=$/.test(text)) return text
    return `=?base64?${Buffer.from(text, 'utf8').toString('base64')}?=`
}

/**
 * 解码 MCP 头部值。
 * @param {*} value - 头部值
 * @returns {string|null} 解码结果；非法值返回 null
 */
export function decodeMcpHeaderValue(value) {
    if (typeof value !== 'string') return null
    const hasBase64Sentinel = value.startsWith('=?base64?')
    const match = value.match(/^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/)
    if (!match) return hasBase64Sentinel ? null : /^[\x20-\x7e\t]*$/.test(value) ? value : null
    const payload = match[1]
    if (payload.length % 4 !== 0) return null
    try {
        const bytes = Buffer.from(payload, 'base64')
        // Buffer.from 容忍非法字符，先用规范化后的 Base64 文本确认输入完整有效。
        if (bytes.toString('base64') !== payload) return null
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
        return null
    }
}

function hasHeaderAnnotation(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    if (Object.prototype.hasOwnProperty.call(value, 'x-mcp-header')) return true
    return Object.values(value).some(item => hasHeaderAnnotation(item, seen))
}

/**
 * 检查工具 inputSchema 中的 x-mcp-header 声明，并返回静态属性路径。
 * @param {*} schema - 工具 inputSchema
 * @returns {{headers:Array<{name:string,path:string[],type:string}>}|{error:string}} 检查结果
 */
export function inspectMcpHeaderSchema(schema) {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { headers: [] }
    const headers = []
    const names = new Set()
    const visited = new Set()

    const walk = (node, propertyPath, insideProperties) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return null
        if (visited.has(node)) return null
        visited.add(node)

        if (Object.prototype.hasOwnProperty.call(node, 'x-mcp-header')) {
            if (!insideProperties) return 'x-mcp-header 只能出现在 properties 属性路径上'
            const headerName = node['x-mcp-header']
            if (typeof headerName !== 'string' || !headerName || !HEADER_TOKEN_PATTERN.test(headerName)) {
                return 'x-mcp-header 必须是非空 HTTP token'
            }
            const type = node.type
            if (!PRIMITIVE_HEADER_TYPES.has(type)) {
                return 'x-mcp-header 只允许 string、integer 或 boolean 参数'
            }
            const lowerName = headerName.toLowerCase()
            if (names.has(lowerName)) return `x-mcp-header 名称重复: ${headerName}`
            names.add(lowerName)
            headers.push({ name: headerName, path: propertyPath, type })
        }

        if (node.properties !== undefined) {
            if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) {
                return 'inputSchema.properties 必须是对象'
            }
            for (const [key, child] of Object.entries(node.properties)) {
                const error = walk(child, [...propertyPath, key], true)
                if (error) return error
            }
        }

        // 任何非 properties 链上的嵌套注解都不可达，包含 items/composition/conditional/$ref。
        for (const [key, value] of Object.entries(node)) {
            if (key === 'properties' || key === 'x-mcp-header') continue
            if (hasHeaderAnnotation(value)) return 'x-mcp-header 必须位于静态 properties 链上'
        }
        return null
    }

    const error = walk(schema, [], false)
    return error ? { error } : { headers }
}

function getPathValue(value, propertyPath) {
    let current = value
    for (const key of propertyPath) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
        current = current[key]
    }
    return current
}

function formatHeaderParameterValue(definition, value) {
    if (value === null || value === undefined) return undefined
    if (definition.type === 'string' && typeof value !== 'string') return undefined
    if (definition.type === 'integer' && (!Number.isSafeInteger(value) || typeof value !== 'number')) return undefined
    if (definition.type === 'boolean' && typeof value !== 'boolean') return undefined
    return encodeMcpHeaderValue(definition.type === 'boolean' ? String(value).toLowerCase() : value)
}

/**
 * 从工具参数提取需要镜像的 MCP 参数头。
 * @param {*} schema - 工具 inputSchema
 * @param {*} args - tools/call arguments
 * @returns {Record<string,string>} 头部键值
 * @throws {Error} schema 声明非法
 */
export function extractMcpParameterHeaders(schema, args) {
    const inspected = inspectMcpHeaderSchema(schema)
    if (inspected.error) throw new Error(inspected.error)
    const headers = {}
    for (const definition of inspected.headers) {
        const value = formatHeaderParameterValue(definition, getPathValue(args, definition.path))
        if (value !== undefined) headers[`Mcp-Param-${definition.name}`] = value
    }
    return headers
}

/**
 * 校验服务端收到的 MCP 参数头是否与请求体一致。
 * @param {*} schema - 工具 inputSchema
 * @param {*} args - tools/call arguments
 * @param {Record<string,string|string[]>} requestHeaders - HTTP 请求头
 * @returns {string|null} 错误说明；通过时返回 null
 */
export function validateMcpParameterHeaders(schema, args, requestHeaders = {}) {
    const inspected = inspectMcpHeaderSchema(schema)
    if (inspected.error) return inspected.error

    const headers = new Map()
    for (const [key, value] of Object.entries(requestHeaders || {})) {
        if (!key.toLowerCase().startsWith('mcp-param-')) continue
        headers.set(key.slice('mcp-param-'.length).toLowerCase(), Array.isArray(value) ? value[0] : value)
    }

    const recognized = new Set()
    for (const definition of inspected.headers) {
        const bodyValue = getPathValue(args, definition.path)
        const headerKey = definition.name.toLowerCase()
        recognized.add(headerKey)
        const headerValue = headers.get(headerKey)
        if (bodyValue === null || bodyValue === undefined) {
            if (headerValue !== undefined) return `Mcp-Param-${definition.name} 在参数缺失时不得出现`
            continue
        }
        const expected = formatHeaderParameterValue(definition, bodyValue)
        if (expected === undefined) return `参数 ${definition.path.join('.')} 类型与 x-mcp-header 不匹配`
        if (typeof headerValue !== 'string') return `缺少 MCP 参数头: Mcp-Param-${definition.name}`
        const decoded = decodeMcpHeaderValue(headerValue)
        if (decoded === null) return `Mcp-Param-${definition.name} 包含非法值`
        const expectedDecoded = definition.type === 'boolean' ? String(bodyValue).toLowerCase() : String(bodyValue)
        if (definition.type === 'integer') {
            if (!/^-?\d+$/.test(decoded) || Number(decoded) !== bodyValue) {
                return `Mcp-Param-${definition.name} 与请求参数不一致`
            }
        } else if (decoded !== expectedDecoded) {
            return `Mcp-Param-${definition.name} 与请求参数不一致`
        }
    }

    // 对已声明的 MCP 参数头之外的字段保持转发兼容，不在此处误杀代理扩展。
    void recognized
    return null
}
