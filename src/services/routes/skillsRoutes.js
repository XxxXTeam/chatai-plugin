/**
 * Skills Agent 路由模块
 * 提供统一的技能/工具管理接口
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'
import {
    SkillsAgent,
    createSkillsAgent,
    getMcpServers,
    getMcpServer,
    connectMcpServer,
    disconnectMcpServer,
    reloadMcpServer,
    removeMcpServer,
    getToolCategories,
    getToolStats,
    reloadAllTools,
    enableAllTools,
    disableAllTools,
    toggleCategory,
    toggleTool
} from '../agent/SkillsAgent.js'

const router = express.Router()

// SSE 连接管理
const sseClients = new Set()

/**
 * SSE 事件广播
 * @param {string} event - 事件名称
 * @param {any} data - 事件数据
 */
function broadcastSSE(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of sseClients) {
        try {
            client.write(message)
        } catch (e) {
            sseClients.delete(client)
        }
    }
}

// GET /sse - SSE 实时状态推送
router.get('/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    // 发送初始连接消息
    res.write(`event: connected\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`)

    sseClients.add(res)

    // 定期发送心跳
    const heartbeat = setInterval(() => {
        try {
            res.write(`event: heartbeat\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`)
        } catch (e) {
            clearInterval(heartbeat)
            sseClients.delete(res)
        }
    }, 30000)

    // 连接关闭时清理
    req.on('close', () => {
        clearInterval(heartbeat)
        sseClients.delete(res)
    })
})

// GET /status - 获取 Skills Agent 整体状态
router.get('/status', async (req, res) => {
    try {
        const servers = getMcpServers()
        const stats = getToolStats()
        const categories = getToolCategories()

        res.json(
            ChaiteResponse.ok({
                servers: servers.map(s => ({
                    name: s.name,
                    status: s.status,
                    type: s.type,
                    toolsCount: s.toolsCount,
                    connectedAt: s.connectedAt
                })),
                stats,
                categories: categories.map(c => ({
                    key: c.key,
                    name: c.name,
                    toolCount: c.toolCount,
                    enabled: c.enabled
                })),
                timestamp: Date.now()
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /tools - 获取所有可用技能
router.get('/tools', async (req, res) => {
    try {
        const { includeBuiltin = 'true', includeMcp = 'true', presetId = 'default' } = req.query

        const agent = await createSkillsAgent({
            includeBuiltinTools: includeBuiltin === 'true',
            includeMcpTools: includeMcp === 'true',
            presetId
        })

        const skills = Array.from(agent.skills.values())
        res.json(
            ChaiteResponse.ok({
                count: skills.length,
                tools: skills
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /tools/by-source - 按来源分类获取技能
router.get('/tools/by-source', async (req, res) => {
    try {
        const agent = await createSkillsAgent({})
        const bySource = agent.getSkillsBySource()

        res.json(
            ChaiteResponse.ok({
                builtin: {
                    count: bySource.builtin.length,
                    tools: bySource.builtin.map(t => ({ name: t.name, description: t.description }))
                },
                custom: {
                    count: bySource.custom.length,
                    tools: bySource.custom.map(t => ({ name: t.name, description: t.description }))
                },
                mcp: Object.fromEntries(
                    Object.entries(bySource.mcp).map(([server, tools]) => [
                        server,
                        {
                            count: tools.length,
                            tools: tools.map(t => ({ name: t.name, description: t.description }))
                        }
                    ])
                )
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /execute - 执行技能
router.post('/execute', async (req, res) => {
    try {
        const { toolName, args = {}, presetId = 'default' } = req.body

        if (!toolName) {
            return res.status(400).json(ChaiteResponse.fail(null, 'toolName is required'))
        }

        const agent = await createSkillsAgent({ presetId })
        const result = await agent.execute(toolName, args)

        // 广播执行事件
        broadcastSSE('tool-executed', {
            toolName,
            success: !result.isError,
            timestamp: Date.now()
        })

        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /categories - 获取工具类别
router.get('/categories', async (req, res) => {
    try {
        const categories = getToolCategories()
        res.json(ChaiteResponse.ok(categories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /categories/:key/toggle - 切换类别启用状态
router.post('/categories/:key/toggle', async (req, res) => {
    try {
        const { key } = req.params
        const { enabled } = req.body

        if (typeof enabled !== 'boolean') {
            return res.status(400).json(ChaiteResponse.fail(null, 'enabled (boolean) is required'))
        }

        const result = await toggleCategory(key, enabled)

        // 广播状态变更
        broadcastSSE('category-toggled', { category: key, enabled, timestamp: Date.now() })

        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /tools/:name/toggle - 切换单个工具启用状态
router.post('/tools/:name/toggle', async (req, res) => {
    try {
        const { name } = req.params
        const { enabled } = req.body

        if (typeof enabled !== 'boolean') {
            return res.status(400).json(ChaiteResponse.fail(null, 'enabled (boolean) is required'))
        }

        const result = await toggleTool(name, enabled)

        // 广播状态变更
        broadcastSSE('tool-toggled', { tool: name, enabled, timestamp: Date.now() })

        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /reload - 重载所有工具
router.post('/reload', async (req, res) => {
    try {
        const result = await reloadAllTools()

        // 广播重载完成
        broadcastSSE('tools-reloaded', { ...result, timestamp: Date.now() })

        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /enable-all - 启用所有工具
router.post('/enable-all', async (req, res) => {
    try {
        const result = await enableAllTools()

        broadcastSSE('tools-enabled-all', { ...result, timestamp: Date.now() })

        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /disable-all - 禁用所有工具
router.post('/disable-all', async (req, res) => {
    try {
        const result = await disableAllTools()

        broadcastSSE('tools-disabled-all', { ...result, timestamp: Date.now() })

        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ========== MCP 服务器管理 ==========

// GET /mcp/servers - 获取 MCP 服务器列表
router.get('/mcp/servers', async (req, res) => {
    try {
        const servers = getMcpServers()
        res.json(ChaiteResponse.ok(servers))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /mcp/servers/:name - 获取单个服务器详情
router.get('/mcp/servers/:name', async (req, res) => {
    try {
        const server = getMcpServer(req.params.name)
        if (!server) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
        }
        res.json(ChaiteResponse.ok(server))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /mcp/servers - 添加 MCP 服务器
router.post('/mcp/servers', async (req, res) => {
    try {
        const { name, config } = req.body

        if (!name) {
            return res.status(400).json(ChaiteResponse.fail(null, 'name is required'))
        }

        // 广播正在连接
        broadcastSSE('server-connecting', { name, timestamp: Date.now() })

        const result = await connectMcpServer(name, config)

        // 广播连接成功
        broadcastSSE('server-connected', {
            name,
            toolsCount: result?.tools?.length || 0,
            timestamp: Date.now()
        })

        res.status(201).json(ChaiteResponse.ok(result))
    } catch (error) {
        // 广播连接失败
        broadcastSSE('server-error', {
            name: req.body.name,
            error: error.message,
            timestamp: Date.now()
        })

        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /mcp/servers/:name - 移除 MCP 服务器
router.delete('/mcp/servers/:name', async (req, res) => {
    try {
        await removeMcpServer(req.params.name)

        // 广播移除
        broadcastSSE('server-removed', { name: req.params.name, timestamp: Date.now() })

        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /mcp/servers/:name/reconnect - 重连 MCP 服务器
router.post('/mcp/servers/:name/reconnect', async (req, res) => {
    try {
        const { name } = req.params

        // 广播正在重连
        broadcastSSE('server-reconnecting', { name, timestamp: Date.now() })

        await reloadMcpServer(name)

        // 广播重连成功
        broadcastSSE('server-reconnected', { name, timestamp: Date.now() })

        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        // 广播重连失败
        broadcastSSE('server-error', {
            name: req.params.name,
            error: error.message,
            timestamp: Date.now()
        })

        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats - 获取工具统计
router.get('/stats', async (req, res) => {
    try {
        const stats = getToolStats()
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// 导出广播函数供其他模块使用
export { broadcastSSE }
export default router
