/**
 * MCP 服务端暴露路由
 * 将插件的内置工具以标准 MCP 协议通过 HTTP+SSE 暴露给外部 MCP 客户端
 *
 * 路由挂载于 /mcp，支持：
 * - GET  /sse    SSE 传输通道（服务端→客户端流）
 * - POST /message JSON-RPC 消息端点（客户端→服务端）
 * - POST /        Streamable HTTP 单端点模式
 *
 * @requires 配置项 mcp.server.enabled = true 才可访问
 * @requires 配置项 mcp.server.apiKey 用于 Bearer Token 鉴权
 */
import express from 'express'
import crypto from 'node:crypto'
import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

/**
 * MCP 协议版本与服务器信息
 */
const MCP_PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = {
    name: 'chatai-plugin',
    version: '1.0.0'
}

/**
 * 活跃 SSE 会话管理
 * @type {Map<string, {res: express.Response, createdAt: number}>}
 */
const activeSessions = new Map()

/**
 * 懒加载 BuiltinMcpServer 实例
 */
let _builtinServer = null
async function getBuiltinServer() {
    if (!_builtinServer) {
        const { BuiltinMcpServer } = await import('../../mcp/BuiltinMcpServer.js')
        _builtinServer = new BuiltinMcpServer()
        await _builtinServer.init()
    }
    return _builtinServer
}

/**
 * 检查 MCP Server 功能是否启用
 * @returns {boolean}
 */
function isMcpServerEnabled() {
    return config.get('mcp.server.enabled') === true
}

/**
 * 获取配置的 API Key
 * @returns {string|null}
 */
function getMcpServerApiKey() {
    return config.get('mcp.server.apiKey') || null
}

/**
 * API Key 鉴权中间件
 */
function mcpAuthMiddleware(req, res, next) {
    if (!isMcpServerEnabled()) {
        return res.status(403).json({
            jsonrpc: '2.0',
            error: { code: -32001, message: 'MCP Server 未启用，请在管理面板开启' },
            id: null
        })
    }

    const apiKey = getMcpServerApiKey()
    if (!apiKey) {
        return res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32002, message: 'MCP Server 未配置 API Key' },
            id: null
        })
    }

    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

    if (!token || token !== apiKey) {
        return res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32003, message: '鉴权失败: 无效的 API Key' },
            id: null
        })
    }

    next()
}

/**
 * 构建 JSON-RPC 成功响应
 * @param {*} result - 响应内容
 * @param {string|number|null} id - 请求 ID
 * @returns {Object}
 */
function jsonRpcOk(result, id) {
    return { jsonrpc: '2.0', result, id }
}

/**
 * 构建 JSON-RPC 错误响应
 * @param {number} code - 错误码
 * @param {string} message - 错误信息
 * @param {string|number|null} id - 请求 ID
 * @returns {Object}
 */
function jsonRpcError(code, message, id = null) {
    return { jsonrpc: '2.0', error: { code, message }, id }
}

/**
 * 处理 MCP JSON-RPC 请求
 * @param {Object} body - JSON-RPC 请求体
 * @returns {Promise<Object>} JSON-RPC 响应
 */
async function handleJsonRpc(body) {
    const { method, params, id } = body

    if (!method) {
        return jsonRpcError(-32600, 'Invalid Request: method is required', id)
    }

    try {
        switch (method) {
            case 'initialize':
                return handleInitialize(params, id)

            case 'initialized':
                /* 客户端确认初始化完成（通知，无需响应） */
                return null

            case 'tools/list':
                return await handleToolsList(params, id)

            case 'tools/call':
                return await handleToolsCall(params, id)

            case 'ping':
                return jsonRpcOk({}, id)

            default:
                return jsonRpcError(-32601, `Method not found: ${method}`, id)
        }
    } catch (err) {
        logger.error(`[McpServer] 处理请求失败 (method=${method}):`, err.message)
        return jsonRpcError(-32603, `Internal error: ${err.message}`, id)
    }
}

/**
 * 处理 initialize 请求
 */
function handleInitialize(params, id) {
    logger.info(
        `[McpServer] 客户端初始化: ${params?.clientInfo?.name || 'unknown'} v${params?.clientInfo?.version || '?'}`
    )

    return jsonRpcOk(
        {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
                tools: { listChanged: false }
            },
            serverInfo: SERVER_INFO
        },
        id
    )
}

/**
 * 处理 tools/list 请求
 */
async function handleToolsList(params, id) {
    const server = await getBuiltinServer()
    const tools = server.listTools()

    const mcpTools = tools.map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} }
    }))

    logger.debug(`[McpServer] tools/list: 返回 ${mcpTools.length} 个工具`)

    return jsonRpcOk({ tools: mcpTools }, id)
}

/**
 * 处理 tools/call 请求
 */
async function handleToolsCall(params, id) {
    const { name, arguments: args } = params || {}

    if (!name) {
        return jsonRpcError(-32602, 'Invalid params: tool name is required', id)
    }

    logger.info(`[McpServer] tools/call: ${name}`)

    const server = await getBuiltinServer()
    const allTools = server.listTools()
    const toolDef = allTools.find(t => t.name === name)

    if (!toolDef) {
        return jsonRpcError(-32602, `Tool not found: ${name}`, id)
    }

    try {
        /* 查找可执行的工具处理器 */
        let result

        /* 1. 优先从模块化工具中查找 */
        const modularTool = server.modularTools.find(t => t.name === name)
        if (modularTool?.handler) {
            result = await modularTool.handler(args || {}, {
                getBot: () => global.Bot,
                getEvent: () => null,
                getAdapter: () => ({ adapter: 'unknown', isNT: false, canAiVoice: false }),
                isMaster: true
            })
        } else if (server.jsTools.has(name)) {
        /* 2. JS 自定义工具 */
            const jsTool = server.jsTools.get(name)
            result = await jsTool.run(args || {}, {
                getBot: () => global.Bot,
                getEvent: () => null
            })
        } else {
        /* 3. 自定义代码工具 */
            const customTools = server.getCustomTools()
            const ct = customTools.find(t => t.name === name)
            if (ct?.handler) {
                result = await server.executeCustomHandler(ct.handler, args || {}, {
                    getBot: () => global.Bot,
                    getEvent: () => null
                })
            } else {
                return jsonRpcError(-32602, `Tool handler not found: ${name}`, id)
            }
        }

        /* 格式化返回结果 */
        const content =
            typeof result === 'string'
                ? [{ type: 'text', text: result }]
                : [{ type: 'text', text: JSON.stringify(result, null, 2) }]

        return jsonRpcOk({ content, isError: false }, id)
    } catch (err) {
        logger.error(`[McpServer] 工具执行失败 (${name}):`, err.message)
        return jsonRpcOk(
            {
                content: [{ type: 'text', text: `工具执行失败: ${err.message}` }],
                isError: true
            },
            id
        )
    }
}

const router = express.Router()

/*
 * SSE 传输模式
 * GET /sse - 建立 SSE 连接，返回 message endpoint URI
 */
router.get('/sse', mcpAuthMiddleware, (req, res) => {
    const sessionId = crypto.randomUUID()

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    })

    /* 发送 endpoint 事件，告知客户端 POST 地址 */
    const messageUrl = `${req.baseUrl}/message?sessionId=${sessionId}`
    res.write(`event: endpoint\ndata: ${messageUrl}\n\n`)

    activeSessions.set(sessionId, { res, createdAt: Date.now() })
    logger.info(`[McpServer] SSE 会话建立: ${sessionId}`)

    req.on('close', () => {
        activeSessions.delete(sessionId)
        logger.info(`[McpServer] SSE 会话关闭: ${sessionId}`)
    })
})

/*
 * SSE 传输模式
 * POST /message - 接收 JSON-RPC 消息，通过 SSE 通道返回响应
 */
router.post('/message', mcpAuthMiddleware, express.json(), async (req, res) => {
    const sessionId = req.query.sessionId

    if (!sessionId || !activeSessions.has(sessionId)) {
        return res.status(400).json(jsonRpcError(-32000, '无效或过期的 sessionId', req.body?.id))
    }

    const session = activeSessions.get(sessionId)
    const response = await handleJsonRpc(req.body)

    if (response) {
        /* 通过 SSE 通道发送响应 */
        session.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`)
    }

    res.status(202).json({ status: 'accepted' })
})

/*
 * Streamable HTTP 单端点模式（推荐）
 * POST / - 直接接收 JSON-RPC 请求并返回 JSON-RPC 响应
 */
router.post('/', mcpAuthMiddleware, express.json(), async (req, res) => {
    const response = await handleJsonRpc(req.body)

    if (!response) {
        /* 通知类消息（如 initialized）无需响应 */
        return res.status(204).end()
    }

    res.json(response)
})

/*
 * GET / - 返回 MCP Server 状态信息
 */
router.get('/', mcpAuthMiddleware, async (req, res) => {
    try {
        const server = await getBuiltinServer()
        const tools = server.listTools()

        res.json({
            name: SERVER_INFO.name,
            version: SERVER_INFO.version,
            protocolVersion: MCP_PROTOCOL_VERSION,
            status: 'running',
            toolCount: tools.length,
            activeSessions: activeSessions.size,
            transports: ['streamable-http', 'sse']
        })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

export default router
