/**
 * MCP路由模块 - MCP服务器管理
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'
import { mcpManager } from '../../mcp/McpManager.js'

const router = express.Router()

// GET /servers - 获取所有MCP服务器
router.get('/servers', async (req, res) => {
    try {
        await mcpManager.init()
        const servers = mcpManager.getServers()
        res.json(ChaiteResponse.ok(servers))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/servers/:name', async (req, res) => {
    try {
        await mcpManager.init()
        const server = mcpManager.getServer(req.params.name)
        if (!server) return res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
        res.json(ChaiteResponse.ok(server))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /servers - 创建MCP服务器（支持所有类型）
router.post('/servers', async (req, res) => {
    try {
        const { name, config } = req.body
        if (!name) {
            return res.status(400).json(ChaiteResponse.fail(null, 'name is required'))
        }

        // 验证配置
        const serverConfig = config || {}
        const type = (serverConfig.type || 'stdio').toLowerCase()

        // 根据类型验证必需字段
        if (type === 'stdio') {
            if (!serverConfig.command) {
                return res.status(400).json(ChaiteResponse.fail(null, 'command is required for stdio type'))
            }
        } else if (type === 'npm' || type === 'npx') {
            if (!serverConfig.package) {
                return res.status(400).json(ChaiteResponse.fail(null, 'package is required for npm/npx type'))
            }
        } else if (type === 'sse' || type === 'http') {
            if (!serverConfig.url) {
                return res.status(400).json(ChaiteResponse.fail(null, 'url is required for sse/http type'))
            }
        } else {
            return res.status(400).json(ChaiteResponse.fail(null, `Unsupported server type: ${type}`))
        }

        // 使用 McpManager 添加服务器
        await mcpManager.init()
        const result = await mcpManager.addServer(name, serverConfig)

        res.status(201).json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /servers/:name - 更新MCP服务器配置
router.put('/servers/:name', async (req, res) => {
    try {
        await mcpManager.init()
        const server = mcpManager.getServer(req.params.name)
        if (!server) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
        }

        if (server.isBuiltin) {
            return res.status(400).json(ChaiteResponse.fail(null, 'Cannot update builtin server'))
        }

        const { config: newConfig } = req.body
        if (!newConfig || typeof newConfig !== 'object') {
            return res.status(400).json(ChaiteResponse.fail(null, 'config object is required'))
        }

        // 使用 McpManager 更新服务器
        const result = await mcpManager.updateServer(req.params.name, newConfig)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /servers/:name - 删除MCP服务器
router.delete('/servers/:name', async (req, res) => {
    try {
        await mcpManager.init()
        const server = mcpManager.getServer(req.params.name)
        if (!server) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
        }

        if (server.isBuiltin) {
            return res.status(400).json(ChaiteResponse.fail(null, 'Cannot delete builtin server'))
        }

        // 使用 McpManager 删除服务器
        await mcpManager.removeServer(req.params.name)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /servers/:name/reconnect - 重连MCP服务器
router.post('/servers/:name/reconnect', async (req, res) => {
    try {
        await mcpManager.init()
        await mcpManager.reloadServer(req.params.name)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /servers/:name/tools - 获取服务器工具列表
router.get('/servers/:name/tools', async (req, res) => {
    try {
        await mcpManager.init()
        const server = mcpManager.getServer(req.params.name)
        if (!server) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
        }
        res.json(ChaiteResponse.ok(server.tools || []))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /import - 导入MCP配置（支持所有服务器类型）
router.post('/import', async (req, res) => {
    try {
        const { mcpServers } = req.body
        if (!mcpServers || typeof mcpServers !== 'object') {
            return res
                .status(400)
                .json(ChaiteResponse.fail(null, 'Invalid config format, expected { mcpServers: { ... } }'))
        }

        await mcpManager.init()

        let success = 0
        let failed = 0
        const errors = []

        for (const [name, serverConfig] of Object.entries(mcpServers)) {
            try {
                // 转换配置格式（兼容 Claude Desktop 格式）
                const config = { ...serverConfig }

                // 如果没有 type，根据配置推断
                if (!config.type) {
                    if (config.url) {
                        config.type = 'sse'
                    } else if (config.package) {
                        config.type = 'npm'
                    } else if (config.command) {
                        config.type = 'stdio'
                    }
                }

                await mcpManager.addServer(name, config)
                success++
            } catch (error) {
                failed++
                errors.push({ name, error: error.message })
            }
        }

        res.json(
            ChaiteResponse.ok({
                success,
                failed,
                total: Object.keys(mcpServers).length,
                errors: errors.length > 0 ? errors : undefined
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /resources - 获取MCP资源
router.get('/resources', async (req, res) => {
    try {
        await mcpManager.init()
        const resources = mcpManager.getResources()
        res.json(ChaiteResponse.ok(resources))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /resources/read - 读取MCP资源
router.post('/resources/read', async (req, res) => {
    try {
        const { serverName, uri } = req.body
        if (!serverName || !uri) {
            return res.status(400).json(ChaiteResponse.fail(null, 'serverName and uri are required'))
        }
        await mcpManager.init()
        const content = await mcpManager.readResource(serverName, uri)
        res.json(ChaiteResponse.ok(content))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /prompts - 获取MCP提示
router.get('/prompts', async (req, res) => {
    try {
        await mcpManager.init()
        const prompts = await mcpManager.listPrompts()
        res.json(ChaiteResponse.ok(prompts))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /prompts/get - 获取单个MCP提示
router.post('/prompts/get', async (req, res) => {
    try {
        const { serverName, name, args } = req.body
        if (!serverName || !name) {
            return res.status(400).json(ChaiteResponse.fail(null, 'serverName and name are required'))
        }
        await mcpManager.init()
        const prompt = await mcpManager.getPrompt(serverName, name, args)
        res.json(ChaiteResponse.ok(prompt))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
