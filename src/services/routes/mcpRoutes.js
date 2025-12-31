/**
 * MCP路由模块 - MCP服务器管理
 */
import express from 'express'
import config from '../../../config/config.js'
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

// GET /server/:name - 获取单个MCP服务器
router.get('/server/:name', async (req, res) => {
    try {
        await mcpManager.init()
        const server = mcpManager.getServer(req.params.name)
        if (!server) return res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
        res.json(ChaiteResponse.ok(server))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /server - 添加MCP服务器
router.post('/server', async (req, res) => {
    try {
        const { name, command, args, env } = req.body
        if (!name || !command) {
            return res.status(400).json(ChaiteResponse.fail(null, 'name and command are required'))
        }
        
        const mcpServers = config.get('mcpServers') || {}
        if (mcpServers[name]) {
            return res.status(409).json(ChaiteResponse.fail(null, 'Server already exists'))
        }
        
        mcpServers[name] = { command, args: args || [], env: env || {} }
        config.set('mcpServers', mcpServers)
        
        res.status(201).json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /server/:name - 更新MCP服务器
router.put('/server/:name', async (req, res) => {
    try {
        const mcpServers = config.get('mcpServers') || {}
        if (!mcpServers[req.params.name]) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
        }
        
        const { command, args, env } = req.body
        if (command) mcpServers[req.params.name].command = command
        if (args) mcpServers[req.params.name].args = args
        if (env) mcpServers[req.params.name].env = env
        
        config.set('mcpServers', mcpServers)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /server/:name - 删除MCP服务器
router.delete('/server/:name', async (req, res) => {
    try {
        const mcpServers = config.get('mcpServers') || {}
        if (!mcpServers[req.params.name]) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Server not found'))
        }
        
        delete mcpServers[req.params.name]
        config.set('mcpServers', mcpServers)
        
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /server/:name/restart - 重启MCP服务器
router.post('/server/:name/restart', async (req, res) => {
    try {
        await mcpManager.restartServer(req.params.name)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /server/:name/tools - 获取服务器工具列表
router.get('/server/:name/tools', async (req, res) => {
    try {
        await mcpManager.init()
        const tools = await mcpManager.getServerTools(req.params.name)
        res.json(ChaiteResponse.ok(tools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
