/**
 * @fileoverview 对外 MCP HTTP 服务。
 * @description 同一端点同时支持 2026-07-28 无状态 Streamable HTTP、
 * 2025-11-25 会话式 Streamable HTTP，以及 2024-11-05 HTTP+SSE 兼容端点。
 */
import express from 'express'
import crypto from 'node:crypto'
import { isIP } from 'node:net'
import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'
import { mcpManager } from '../../mcp/McpManager.js'
import {
    MCP_PROMPT_METADATA_FIELDS,
    MCP_RESOURCE_METADATA_FIELDS,
    MCP_RESOURCE_TEMPLATE_METADATA_FIELDS,
    MCP_TOOL_METADATA_FIELDS,
    copyMcpDefinitionMetadata,
    decodeMcpHeaderValue,
    validateMcpParameterHeaders
} from '../../mcp/McpProtocol.js'

const logger = chatLogger

const MODERN_PROTOCOL_VERSION = '2026-07-28'
const LATEST_SESSION_PROTOCOL_VERSION = '2025-11-25'
const LEGACY_SSE_PROTOCOL_VERSION = '2024-11-05'
const SESSION_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26', LEGACY_SSE_PROTOCOL_VERSION])
const STREAMABLE_SESSION_PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26'])
const SUPPORTED_PROTOCOL_VERSIONS = [MODERN_PROTOCOL_VERSION, ...SESSION_PROTOCOL_VERSIONS]
const NAME_HEADER_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get'])
const SESSION_TTL_MS = 30 * 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 60 * 1000
const MAX_ACTIVE_SESSIONS = 256
const SERVER_INFO = { name: 'chatai-plugin', version: '1.0.0' }
const SERVER_CAPABILITIES = {
    tools: { listChanged: false },
    resources: { listChanged: false, subscribe: false },
    prompts: { listChanged: false }
}

/**
 * @typedef {Object} McpSession
 * @property {'streamable-http'|'legacy-sse'} transport - 传输类型
 * @property {string} protocolVersion - 已协商协议版本
 * @property {'created'|'initializing'|'ready'} phase - 生命周期阶段
 * @property {number} createdAt - 创建时间
 * @property {number} lastAccessAt - 最近访问时间
 * @property {express.Response|null} legacyResponse - 旧 SSE 响应
 * @property {Set<express.Response>} streams - 会话式 GET SSE 流
 */

/** @type {Map<string, McpSession>} */
const activeSessions = new Map()

function terminateSession(sessionId) {
    const session = activeSessions.get(sessionId)
    if (!session) return false
    activeSessions.delete(sessionId)
    if (session.legacyResponse && !session.legacyResponse.writableEnded) session.legacyResponse.end()
    for (const stream of session.streams) {
        if (!stream.writableEnded) stream.end()
    }
    session.streams.clear()
    return true
}

function pruneSessions(now = Date.now()) {
    for (const [sessionId, session] of activeSessions) {
        if (now - session.lastAccessAt >= SESSION_TTL_MS) terminateSession(sessionId)
    }
    while (activeSessions.size > MAX_ACTIVE_SESSIONS) evictOldestSession()
}

function evictOldestSession() {
    if (activeSessions.size === 0) return false
    let oldestId = null
    let oldestAccess = Infinity
    for (const [sessionId, session] of activeSessions) {
        if (session.lastAccessAt < oldestAccess) {
            oldestId = sessionId
            oldestAccess = session.lastAccessAt
        }
    }
    return oldestId ? terminateSession(oldestId) : false
}

const sessionCleanupTimer = setInterval(pruneSessions, SESSION_CLEANUP_INTERVAL_MS)
sessionCleanupTimer.unref?.()

function createSession(transport, protocolVersion, legacyResponse = null) {
    pruneSessions()
    while (activeSessions.size >= MAX_ACTIVE_SESSIONS) evictOldestSession()
    const sessionId = crypto.randomUUID()
    const now = Date.now()
    const session = {
        transport,
        protocolVersion,
        phase: transport === 'legacy-sse' ? 'created' : 'initializing',
        createdAt: now,
        lastAccessAt: now,
        legacyResponse,
        streams: new Set()
    }
    activeSessions.set(sessionId, session)
    return { sessionId, session }
}

function getSession(sessionId) {
    if (!sessionId) return null
    const session = activeSessions.get(sessionId)
    if (!session) return null
    if (Date.now() - session.lastAccessAt >= SESSION_TTL_MS) {
        terminateSession(sessionId)
        return null
    }
    session.lastAccessAt = Date.now()
    return session
}

function isMcpServerEnabled() {
    return config.get('mcp.server.enabled') === true
}

function getMcpServerApiKey() {
    return config.get('mcp.server.apiKey') || null
}

function timingSafeEqualString(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false
    const bufA = Buffer.from(a)
    const bufB = Buffer.from(b)
    if (bufA.length !== bufB.length) return false
    return crypto.timingSafeEqual(bufA, bufB)
}

function jsonRpcOk(result, id) {
    return { jsonrpc: '2.0', result, id }
}

function jsonRpcError(code, message, id = null, data) {
    return {
        jsonrpc: '2.0',
        error: { code, message, ...(data === undefined ? {} : { data }) },
        id
    }
}

function parseConfiguredHost(value) {
    if (typeof value !== 'string' || !value.trim()) return null
    try {
        const host = new URL(value).host.toLowerCase()
        if (host) return host
    } catch {}
    const bare = value.trim().toLowerCase()
    return /^[a-z0-9.:[\]-]+(?::\d+)?$/i.test(bare) ? bare : null
}

function getTrustedMcpHosts() {
    const trusted = new Set()
    const add = value => {
        const host = parseConfiguredHost(value)
        if (host) trusted.add(host)
    }
    add(config.get('web.publicUrl'))
    const loginLinks = config.get('web.loginLinks')
    if (Array.isArray(loginLinks)) {
        for (const link of loginLinks) add(link?.baseUrl)
    }
    const corsOrigins = config.get('web.corsOrigins')
    if (Array.isArray(corsOrigins)) {
        for (const origin of corsOrigins) add(origin)
    }
    return trusted
}

function isIntrinsicTrustedHostname(hostname) {
    const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
    return normalized === 'localhost' || isIP(normalized) !== 0
}

/**
 * 解析并校验 HTTP Host。Host 只允许主机名/地址及可选端口，不能借助 URL
 * userinfo、查询串或异常端口把可信主机伪装到请求中。
 * @param {*} value - 原始 Host 头
 * @param {string} protocol - 当前请求协议
 * @returns {URL|null} 合法 Host URL
 */
function parseRequestHost(value, protocol) {
    if (typeof value !== 'string' || !value || /[\s\\/,]/.test(value) || /[:?\#]$/.test(value)) return null
    let parsed
    try {
        parsed = new URL(`${protocol}://${value}`)
    } catch {
        return null
    }
    if (
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash ||
        (parsed.port && (!/^\d+$/.test(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65535))
    ) {
        return null
    }
    return parsed
}

function mcpTransportSecurityMiddleware(req, res, next) {
    const host = req.headers.host
    const hostUrl = parseRequestHost(host, req.protocol)
    if (!hostUrl) {
        return res.status(400).json(jsonRpcError(-32600, 'Invalid Host header'))
    }
    const trustedHosts = getTrustedMcpHosts()
    const hostTrusted = isIntrinsicTrustedHostname(hostUrl.hostname) || trustedHosts.has(hostUrl.host.toLowerCase())
    if (!hostTrusted) return res.status(400).json(jsonRpcError(-32600, 'Untrusted Host header'))
    const origin = req.headers.origin
    if (origin !== undefined) {
        try {
            const originUrl = new URL(origin)
            const originTrusted =
                isIntrinsicTrustedHostname(originUrl.hostname) || trustedHosts.has(originUrl.host.toLowerCase())
            if (!originTrusted || !hostTrusted || originUrl.host.toLowerCase() !== hostUrl.host.toLowerCase()) {
                return res.status(403).json(jsonRpcError(-32003, 'Forbidden Origin'))
            }
        } catch {
            return res.status(403).json(jsonRpcError(-32003, 'Forbidden Origin'))
        }
    }
    next()
}

function mcpAuthMiddleware(req, res, next) {
    if (!isMcpServerEnabled()) {
        return res.status(403).json(jsonRpcError(-32001, 'MCP Server 未启用，请在管理面板开启'))
    }
    const apiKey = getMcpServerApiKey()
    if (!apiKey) return res.status(500).json(jsonRpcError(-32002, 'MCP Server 未配置 API Key'))
    const authHeader = req.headers.authorization
    // RFC 6750 的认证方案名称大小写不敏感；保留凭据正文原样参与常量时间比较。
    const tokenMatch = typeof authHeader === 'string' ? authHeader.match(/^Bearer[ \t]+(.+)$/i) : null
    const token = tokenMatch ? tokenMatch[1] : null
    if (!token || !timingSafeEqualString(token, apiKey)) {
        return res.status(401).json(jsonRpcError(-32003, '鉴权失败: 无效的 API Key'))
    }
    next()
}

function createMcpRequestContext(input = {}) {
    return {
        event: null,
        bot: globalThis.Bot || null,
        isMaster: true,
        userId: null,
        groupId: null,
        inputResponses: input.inputResponses,
        requestState: input.requestState,
        source: 'mcp-server'
    }
}

function formatToolExecutionError(error) {
    return { content: [{ type: 'text', text: `工具执行失败: ${error.message}` }], isError: true }
}

function negotiateSessionProtocol(requestedVersion, legacySse) {
    if (legacySse && requestedVersion === LEGACY_SSE_PROTOCOL_VERSION) return requestedVersion
    return STREAMABLE_SESSION_PROTOCOL_VERSIONS.has(requestedVersion)
        ? requestedVersion
        : LATEST_SESSION_PROTOCOL_VERSION
}

function handleInitialize(params, id, legacySse) {
    if (
        !params ||
        typeof params !== 'object' ||
        typeof params.protocolVersion !== 'string' ||
        !params.clientInfo ||
        typeof params.clientInfo.name !== 'string' ||
        typeof params.clientInfo.version !== 'string' ||
        !params.capabilities ||
        typeof params.capabilities !== 'object'
    ) {
        return jsonRpcError(-32602, 'Invalid initialize params', id)
    }
    return jsonRpcOk(
        {
            protocolVersion: negotiateSessionProtocol(params.protocolVersion, legacySse),
            capabilities: SERVER_CAPABILITIES,
            serverInfo: SERVER_INFO
        },
        id
    )
}

function handleServerDiscover(id) {
    return jsonRpcOk(
        {
            resultType: 'complete',
            supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
            capabilities: SERVER_CAPABILITIES,
            _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
            ttlMs: 0,
            cacheScope: 'private'
        },
        id
    )
}

/**
 * 生成对外 MCP 工具清单；同名工具必须带来源身份，避免聚合服务器覆盖其中一个实现。
 * @returns {Array<Object>} MCP 工具定义
 */
function getExposedTools() {
    const tools = mcpManager.getTools({ includeDuplicateNames: true })
    const counts = new Map()
    for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) || 0) + 1)
    return tools.map(tool => {
        const duplicate = counts.get(tool.name) > 1
        const exposedName = duplicate
            ? tool.source === 'mcp' && tool.serverName
                ? `mcp:${tool.serverName}:${tool.name}`
                : `${tool.serverName || tool.source || 'tool'}:${tool.name}`
            : tool.name
        return {
            name: exposedName,
            description: tool.description || '',
            inputSchema: tool.inputSchema || { type: 'object', properties: {} },
            ...copyMcpDefinitionMetadata(tool, MCP_TOOL_METADATA_FIELDS)
        }
    })
}

async function handleToolsList(id, modern) {
    await mcpManager.init()
    const result = { tools: getExposedTools() }
    if (modern) Object.assign(result, modernResult({ ttlMs: 0, cacheScope: 'private' }))
    return jsonRpcOk(result, id)
}

async function handleResourcesList(id, modern) {
    await mcpManager.init()
    const result = {
        resources: mcpManager.getResources().map(resource => ({
            uri: resource.uri,
            name: resource.name || resource.uri,
            ...(resource.description !== undefined ? { description: resource.description } : {}),
            ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
            ...copyMcpDefinitionMetadata(resource, MCP_RESOURCE_METADATA_FIELDS)
        }))
    }
    if (modern) Object.assign(result, modernResult({ ttlMs: 0, cacheScope: 'private' }))
    return jsonRpcOk(result, id)
}

async function handleResourcesRead(params, id, modern) {
    const uri = params?.uri
    if (typeof uri !== 'string' || !uri) return jsonRpcError(-32602, 'Invalid params: resource uri is required', id)
    try {
        await mcpManager.init()
        const contents = await mcpManager.readResource(uri)
        // 正常响应是 contents 数组；MRTR 允许服务端返回 input_required，
        // 此时必须把完整结果透传给客户端，不能静默变成空 contents。
        const result = Array.isArray(contents) ? { contents } : contents
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            return jsonRpcError(-32603, 'Resource read returned an invalid result', id)
        }
        return jsonRpcOk(modern ? modernResult(result) : result, id)
    } catch (error) {
        if (error?.code === 'MCP_RESOURCE_NOT_FOUND') {
            return jsonRpcError(-32602, `Resource not found: ${uri}`, id, { uri })
        }
        logger.error(`[McpServer] Resource read failed: ${error.message}`)
        return jsonRpcError(-32603, 'Resource read failed', id)
    }
}

async function handleResourceTemplatesList(id, modern) {
    await mcpManager.init()
    const result = {
        resourceTemplates: mcpManager.getResourceTemplates().map(template => ({
            uriTemplate: template.uriTemplate,
            name: template.name || template.uriTemplate,
            ...(template.description !== undefined ? { description: template.description } : {}),
            ...(template.mimeType !== undefined ? { mimeType: template.mimeType } : {}),
            ...copyMcpDefinitionMetadata(template, MCP_RESOURCE_TEMPLATE_METADATA_FIELDS)
        }))
    }
    if (modern) Object.assign(result, modernResult({ ttlMs: 0, cacheScope: 'private' }))
    return jsonRpcOk(result, id)
}

async function handlePromptsList(id, modern) {
    await mcpManager.init()
    const prompts = mcpManager.getPrompts()
    const counts = new Map()
    for (const prompt of prompts) counts.set(prompt.name, (counts.get(prompt.name) || 0) + 1)
    const result = {
        prompts: prompts.map(prompt => ({
            name:
                counts.get(prompt.name) > 1 && prompt.serverName
                    ? `mcp:${prompt.serverName}:${prompt.name}`
                    : prompt.name,
            ...(prompt.description !== undefined ? { description: prompt.description } : {}),
            ...(Array.isArray(prompt.arguments) ? { arguments: prompt.arguments } : {}),
            ...copyMcpDefinitionMetadata(prompt, MCP_PROMPT_METADATA_FIELDS)
        }))
    }
    if (modern) Object.assign(result, modernResult({ ttlMs: 0, cacheScope: 'private' }))
    return jsonRpcOk(result, id)
}

async function handlePromptsGet(params, id, modern) {
    const name = params?.name
    if (typeof name !== 'string' || !name) return jsonRpcError(-32602, 'Invalid params: prompt name is required', id)
    if (
        params?.arguments !== undefined &&
        (!params.arguments || typeof params.arguments !== 'object' || Array.isArray(params.arguments))
    ) {
        return jsonRpcError(-32602, 'Invalid params: prompt arguments must be an object', id)
    }
    try {
        await mcpManager.init()
        const promptResult = await mcpManager.getPrompt(name, params?.arguments || {})
        const parsed = mcpManager.parseToolIdentity(name)
        const originalName = parsed?.name || name
        const definitionDescription =
            mcpManager
                .getPrompts()
                .find(prompt => prompt.name === originalName && (!parsed || prompt.serverName === parsed.serverName))
                ?.description || ''
        const responseObject =
            promptResult && typeof promptResult === 'object' && !Array.isArray(promptResult) ? promptResult : null
        // MRTR input_required 必须保持 inputRequests/requestState 不透明透传；正常结果则
        // 保留下游协议字段，并统一补齐 messages 与定义描述。
        const result =
            responseObject?.resultType === 'input_required'
                ? {
                      ...responseObject,
                      ...(responseObject.description === undefined ? { description: definitionDescription } : {})
                  }
                : {
                      ...(responseObject || {}),
                      description: responseObject?.description ?? definitionDescription,
                      messages: Array.isArray(promptResult)
                          ? promptResult
                          : Array.isArray(responseObject?.messages)
                            ? responseObject.messages
                            : []
                  }
        return jsonRpcOk(modern ? modernResult(result) : result, id)
    } catch (error) {
        return jsonRpcError(-32602, `Prompt get failed: ${error.message}`, id)
    }
}

async function handleToolsCall(params, id, modern) {
    const { name, arguments: args } = params || {}
    if (typeof name !== 'string' || !name) {
        return jsonRpcError(-32602, 'Invalid params: tool name is required', id)
    }
    if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) {
        return jsonRpcError(-32602, 'Invalid params: tool arguments must be an object', id)
    }
    if (
        params?.inputResponses !== undefined &&
        (!params.inputResponses || typeof params.inputResponses !== 'object' || Array.isArray(params.inputResponses))
    ) {
        return jsonRpcError(-32602, 'Invalid params: inputResponses must be an object', id)
    }
    if (params?.requestState !== undefined && typeof params.requestState !== 'string') {
        return jsonRpcError(-32602, 'Invalid params: requestState must be a string', id)
    }
    try {
        await mcpManager.init()
        const callOptions = {
            context: createMcpRequestContext({
                inputResponses: params?.inputResponses,
                requestState: params?.requestState
            })
        }
        if (params?.inputResponses !== undefined) callOptions.inputResponses = params.inputResponses
        if (params?.requestState !== undefined) callOptions.requestState = params.requestState
        const result = await mcpManager.callTool(name, args ?? {}, callOptions)
        return jsonRpcOk(modern ? modernResult(result) : result, id)
    } catch (error) {
        if (error?.code === 'MCP_TOOL_NOT_FOUND' || error?.code === 'MCP_TOOL_IDENTITY_MISMATCH') {
            return jsonRpcError(-32602, error.message, id)
        }
        const result = formatToolExecutionError(error)
        return jsonRpcOk(modern ? modernResult(result) : result, id)
    }
}

function modernResult(result) {
    return {
        ...result,
        resultType: result.resultType || 'complete',
        _meta: { ...(result._meta || {}), 'io.modelcontextprotocol/serverInfo': SERVER_INFO }
    }
}

async function handleJsonRpc(body, { modern = false, legacySse = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.jsonrpc !== '2.0') {
        return jsonRpcError(-32600, 'Invalid Request', null)
    }
    const { method, params, id } = body
    if (typeof method !== 'string' || !method) return jsonRpcError(-32600, 'Invalid Request: method is required', id)
    const hasId = Object.prototype.hasOwnProperty.call(body, 'id')
    const notificationMethod = method.startsWith('notifications/')
    if ((notificationMethod && hasId) || (!notificationMethod && !hasId)) {
        return jsonRpcError(-32600, 'Invalid Request: request and notification id semantics do not match', id ?? null)
    }
    switch (method) {
        case 'server/discover':
            return modern ? handleServerDiscover(id) : jsonRpcError(-32601, `Method not found: ${method}`, id)
        case 'initialize':
            return modern
                ? jsonRpcError(-32601, `Method not found: ${method}`, id)
                : handleInitialize(params, id, legacySse)
        case 'notifications/initialized':
            return null
        case 'notifications/cancelled':
            // 2026-07-28 通常通过关闭响应流取消 HTTP 请求；接受该通知仍可兼容
            // 较早客户端，且不会把无害的取消误报为方法不存在。
            return null
        case 'tools/list':
            return await handleToolsList(id, modern)
        case 'tools/call':
            return await handleToolsCall(params, id, modern)
        case 'resources/list':
            return await handleResourcesList(id, modern)
        case 'resources/read':
            return await handleResourcesRead(params, id, modern)
        case 'resources/templates/list':
            return await handleResourceTemplatesList(id, modern)
        case 'prompts/list':
            return await handlePromptsList(id, modern)
        case 'prompts/get':
            return await handlePromptsGet(params, id, modern)
        case 'ping':
            return jsonRpcOk(modern ? modernResult({}) : {}, id)
        default:
            return jsonRpcError(-32601, `Method not found: ${method}`, id)
    }
}

function accepts(req, mediaType) {
    return String(req.headers.accept || '')
        .toLowerCase()
        .split(',')
        .some(value => value.trim().split(';')[0] === mediaType)
}

function acceptsStreamablePost(req) {
    return accepts(req, 'application/json') && accepts(req, 'text/event-stream')
}

async function validateModernRequest(req) {
    const body = req.body
    const id = Object.prototype.hasOwnProperty.call(body || {}, 'id') ? body.id : null
    const notification = isNotification(body)
    const protocolHeader = req.get('MCP-Protocol-Version')
    const metadata = body?.params?._meta
    const metadataVersion = metadata?.['io.modelcontextprotocol/protocolVersion']
    const capabilities = metadata?.['io.modelcontextprotocol/clientCapabilities']
    const clientInfo = metadata?.['io.modelcontextprotocol/clientInfo']

    // 2026-07-28 没有规定通知 POST 必须携带标准头。对完全没有元数据的
    // 通知直接放行；若客户端只提供了部分头，则仍执行完整一致性校验，
    // 避免中间层依据不完整的头部作出错误路由判断。
    if (
        notification &&
        protocolHeader === undefined &&
        metadataVersion === undefined &&
        req.get('Mcp-Method') === undefined &&
        capabilities === undefined &&
        clientInfo === undefined
    ) {
        return null
    }

    if (protocolHeader !== MODERN_PROTOCOL_VERSION || metadataVersion !== MODERN_PROTOCOL_VERSION) {
        if (protocolHeader && protocolHeader === metadataVersion) {
            return jsonRpcError(-32022, 'Unsupported protocol version', id, {
                supported: SUPPORTED_PROTOCOL_VERSIONS,
                requested: protocolHeader
            })
        }
        return jsonRpcError(-32020, 'Header mismatch: MCP-Protocol-Version does not match request metadata', id)
    }
    if (req.get('Mcp-Method') !== body?.method) {
        return jsonRpcError(-32020, 'Header mismatch: Mcp-Method does not match request method', id)
    }
    if (!notification && (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities))) {
        return jsonRpcError(-32602, 'Invalid request metadata: clientCapabilities is required', id)
    }
    if (
        clientInfo !== undefined &&
        (!clientInfo ||
            typeof clientInfo !== 'object' ||
            typeof clientInfo.name !== 'string' ||
            typeof clientInfo.version !== 'string')
    ) {
        return jsonRpcError(-32602, 'Invalid request metadata: malformed clientInfo', id)
    }
    if (NAME_HEADER_METHODS.has(body?.method)) {
        const nameHeader = decodeMcpHeaderValue(req.get('Mcp-Name'))
        const bodyName = body?.method === 'resources/read' ? body?.params?.uri : body?.params?.name
        if (nameHeader === null || nameHeader !== bodyName) {
            return jsonRpcError(-32020, 'Header mismatch: Mcp-Name does not match request name', id)
        }
    }
    if (body?.method === 'tools/call') {
        await mcpManager.init()
        const tool = mcpManager.getTool(body?.params?.name)
        if (tool?.inputSchema) {
            const headerError = validateMcpParameterHeaders(
                tool.inputSchema,
                body?.params?.arguments || {},
                req.headers
            )
            if (headerError) {
                return jsonRpcError(-32020, `Header mismatch: ${headerError}`, id)
            }
        }
    }
    return null
}

function isNotification(body) {
    return body && typeof body === 'object' && !Object.prototype.hasOwnProperty.call(body, 'id')
}

function sendJsonRpc(res, response, status = 200) {
    return res.status(status).type('application/json').json(response)
}

function asyncRoute(handler) {
    return (req, res) => {
        Promise.resolve(handler(req, res)).catch(error => {
            logger.error(`[McpServer] HTTP transport error: ${error.message}`)
            if (res.headersSent) {
                if (!res.writableEnded) res.end()
                return
            }
            sendJsonRpc(res, jsonRpcError(-32603, 'Internal error', req.body?.id), 500)
        })
    }
}

const router = express.Router()
router.use(mcpTransportSecurityMiddleware)

router.get('/sse', mcpAuthMiddleware, (req, res) => {
    const { sessionId, session } = createSession('legacy-sse', LEGACY_SSE_PROTOCOL_VERSION, res)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    })
    res.write(`event: endpoint\ndata: ${req.baseUrl}/message?sessionId=${sessionId}\n\n`)
    req.on('close', () => {
        if (activeSessions.get(sessionId) === session) terminateSession(sessionId)
    })
})

router.post(
    '/message',
    mcpAuthMiddleware,
    express.json(),
    asyncRoute(async (req, res) => {
        const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : ''
        const session = getSession(sessionId)
        if (!session || session.transport !== 'legacy-sse' || !session.legacyResponse) {
            return sendJsonRpc(res, jsonRpcError(-32000, '无效或过期的 sessionId', req.body?.id), 400)
        }
        const response = await handleJsonRpc(req.body, { modern: false, legacySse: true })
        if (req.body?.method === 'initialize' && response?.result?.protocolVersion) {
            session.protocolVersion = response.result.protocolVersion
            session.phase = 'initializing'
        } else if (req.body?.method === 'notifications/initialized' && isNotification(req.body)) {
            session.phase = 'ready'
        }
        if (response && !session.legacyResponse.writableEnded) {
            session.legacyResponse.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
        }
        return res.status(202).end()
    })
)

router.post(
    '/',
    mcpAuthMiddleware,
    express.json(),
    asyncRoute(async (req, res) => {
        if (!acceptsStreamablePost(req)) {
            return sendJsonRpc(
                res,
                jsonRpcError(-32600, 'Accept must include application/json and text/event-stream'),
                406
            )
        }
        const body = req.body
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return sendJsonRpc(res, jsonRpcError(-32600, 'Invalid Request'), 400)
        }
        const metadataVersion = body.params?._meta?.['io.modelcontextprotocol/protocolVersion']
        const protocolHeader = req.get('MCP-Protocol-Version')
        const modern =
            metadataVersion !== undefined ||
            body.method === 'server/discover' ||
            (Boolean(protocolHeader) && !req.get('Mcp-Session-Id')) ||
            (!req.get('Mcp-Session-Id') && isNotification(body) && !protocolHeader && metadataVersion === undefined)
        if (modern) {
            const validationError = await validateModernRequest(req)
            if (validationError) return sendJsonRpc(res, validationError, 400)
            const response = await handleJsonRpc(body, { modern: true })
            if (isNotification(body)) {
                if (response?.error) return sendJsonRpc(res, response, response.error.code === -32601 ? 404 : 400)
                return res.status(202).end()
            }
            if (response?.error?.code === -32601) return sendJsonRpc(res, response, 404)
            return sendJsonRpc(res, response)
        }
        if (body.method === 'initialize') {
            if (req.get('Mcp-Session-Id')) {
                return sendJsonRpc(
                    res,
                    jsonRpcError(-32600, 'Initialize request must not include Mcp-Session-Id', body.id),
                    400
                )
            }
            const response = await handleJsonRpc(body, { modern: false })
            if (response?.error) return sendJsonRpc(res, response, 400)
            const { sessionId, session } = createSession('streamable-http', response.result.protocolVersion)
            session.phase = 'initializing'
            res.setHeader('Mcp-Session-Id', sessionId)
            return sendJsonRpc(res, response)
        }
        const sessionId = req.get('Mcp-Session-Id') || ''
        if (!sessionId) return sendJsonRpc(res, jsonRpcError(-32600, 'Mcp-Session-Id header is required', body.id), 400)
        const session = getSession(sessionId)
        if (!session || session.transport !== 'streamable-http') {
            return sendJsonRpc(res, jsonRpcError(-32000, 'Session not found', body.id), 404)
        }
        if (protocolHeader !== session.protocolVersion) {
            return sendJsonRpc(
                res,
                jsonRpcError(-32600, 'Invalid or missing MCP-Protocol-Version header', body.id),
                400
            )
        }
        if (body.method === 'notifications/initialized' && isNotification(body)) {
            session.phase = 'ready'
            return res.status(202).end()
        }
        if (isNotification(body)) {
            if (typeof body.method !== 'string' || !body.method.startsWith('notifications/')) {
                return sendJsonRpc(res, jsonRpcError(-32600, 'Invalid Request: requests must include an id', null), 400)
            }
            return res.status(202).end()
        }
        if (session.phase !== 'ready' && body.method !== 'ping') {
            return sendJsonRpc(res, jsonRpcError(-32600, 'Session initialization is not complete', body.id), 400)
        }
        return sendJsonRpc(res, await handleJsonRpc(body, { modern: false }))
    })
)

router.get('/', mcpAuthMiddleware, (req, res) => {
    if (!accepts(req, 'text/event-stream')) return res.status(405).set('Allow', 'POST').end()
    if (req.get('MCP-Protocol-Version') === MODERN_PROTOCOL_VERSION) {
        return res.status(405).set('Allow', 'POST').end()
    }
    const sessionId = req.get('Mcp-Session-Id') || ''
    if (!sessionId) return sendJsonRpc(res, jsonRpcError(-32600, 'Mcp-Session-Id header is required'), 400)
    const session = getSession(sessionId)
    if (!session || session.transport !== 'streamable-http') {
        return sendJsonRpc(res, jsonRpcError(-32000, 'Session not found'), 404)
    }
    if (req.get('MCP-Protocol-Version') !== session.protocolVersion) {
        return sendJsonRpc(res, jsonRpcError(-32600, 'Invalid or missing MCP-Protocol-Version header'), 400)
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    })
    res.write(': connected\n\n')
    session.streams.add(res)
    req.on('close', () => session.streams.delete(res))
})

router.delete('/', mcpAuthMiddleware, (req, res) => {
    if (req.get('MCP-Protocol-Version') === MODERN_PROTOCOL_VERSION) {
        return res.status(405).set('Allow', 'POST').end()
    }
    const sessionId = req.get('Mcp-Session-Id') || ''
    if (!sessionId) return sendJsonRpc(res, jsonRpcError(-32600, 'Mcp-Session-Id header is required'), 400)
    const session = getSession(sessionId)
    if (!session || session.transport !== 'streamable-http') {
        return sendJsonRpc(res, jsonRpcError(-32000, 'Session not found'), 404)
    }
    if (req.get('MCP-Protocol-Version') !== session.protocolVersion) {
        return sendJsonRpc(res, jsonRpcError(-32600, 'Invalid or missing MCP-Protocol-Version header'), 400)
    }
    terminateSession(sessionId)
    return res.status(204).end()
})

router.get(
    '/status',
    mcpAuthMiddleware,
    asyncRoute(async (req, res) => {
        await mcpManager.init()
        pruneSessions()
        res.json({
            name: SERVER_INFO.name,
            version: SERVER_INFO.version,
            supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
            status: 'running',
            toolCount: mcpManager.getTools().length,
            activeSessions: activeSessions.size,
            maxSessions: MAX_ACTIVE_SESSIONS,
            sessionTtlMs: SESSION_TTL_MS,
            transports: ['streamable-http', 'legacy-http-sse']
        })
    })
)

export default router
