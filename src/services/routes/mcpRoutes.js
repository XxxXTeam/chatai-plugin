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

router.post('/servers', async (req, res) => {
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

// PUT /servers/:name - 更新MCP服务器
router.put('/servers/:name', async (req, res) => {
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

// DELETE /servers/:name - 删除MCP服务器
router.delete('/servers/:name', async (req, res) => {
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

// POST /servers/:name/reconnect - 重连MCP服务器
router.post('/servers/:name/reconnect', async (req, res) => {
    try {
        await mcpManager.init()
        await mcpManager.restartServer(req.params.name)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /servers/:name/tools - 获取服务器工具列表
router.get('/servers/:name/tools', async (req, res) => {
    try {
        await mcpManager.init()
        const tools = await mcpManager.getServerTools(req.params.name)
        res.json(ChaiteResponse.ok(tools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /import - 导入MCP配置
router.post('/import', async (req, res) => {
    try {
        const { mcpServers } = req.body
        if (!mcpServers || typeof mcpServers !== 'object') {
            return res.status(400).json(ChaiteResponse.fail(null, 'Invalid config format'))
        }
        
        const existingServers = config.get('mcpServers') || {}
        const mergedServers = { ...existingServers, ...mcpServers }
        config.set('mcpServers', mergedServers)
        
        res.json(ChaiteResponse.ok({ success: true, count: Object.keys(mcpServers).length }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /resources - 获取MCP资源
router.get('/resources', async (req, res) => {
    try {
        await mcpManager.init()
        const resources = await mcpManager.listResources()
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
