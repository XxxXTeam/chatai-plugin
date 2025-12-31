/**
 * 工具路由模块 - MCP工具、自定义工具、JS工具
 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '../../../config/config.js'
import { ChaiteResponse } from './shared.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { builtinMcpServer } from '../../mcp/BuiltinMcpServer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const jsToolsDir = path.join(__dirname, '../../../data/tools')

const router = express.Router()

// GET /list - 获取所有工具列表
router.get('/list', async (req, res) => {
    try {
        await mcpManager.init()
        const tools = mcpManager.getTools()
        const customTools = config.get('customTools') || []
        res.json(ChaiteResponse.ok([...tools, ...customTools]))
    } catch (error) {
        res.json(ChaiteResponse.ok([]))
    }
})

// GET /builtin - 获取内置工具
router.get('/builtin', async (req, res) => {
    try {
        await mcpManager.init()
        const tools = builtinMcpServer.listTools()
        res.json(ChaiteResponse.ok(tools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /enabled - 获取启用的工具
router.get('/enabled', async (req, res) => {
    try {
        const enabledTools = config.get('tools.enabled') || []
        res.json(ChaiteResponse.ok(enabledTools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /enabled - 更新启用的工具
router.put('/enabled', async (req, res) => {
    try {
        const { tools } = req.body
        config.set('tools.enabled', tools || [])
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /toggle/:name - 切换工具启用状态
router.post('/toggle/:name', async (req, res) => {
    try {
        const { name } = req.params
        const { enabled } = req.body
        const enabledTools = config.get('tools.enabled') || []
        
        if (enabled && !enabledTools.includes(name)) {
            enabledTools.push(name)
        } else if (!enabled) {
            const idx = enabledTools.indexOf(name)
            if (idx > -1) enabledTools.splice(idx, 1)
        }
        
        config.set('tools.enabled', enabledTools)
        res.json(ChaiteResponse.ok({ success: true, enabled: enabledTools.includes(name) }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 自定义工具 ====================
router.get('/custom', async (req, res) => {
    try {
        const customTools = config.get('customTools') || []
        res.json(ChaiteResponse.ok(customTools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.post('/custom', async (req, res) => {
    try {
        const { name, description, parameters, handler } = req.body
        if (!name) return res.status(400).json(ChaiteResponse.fail(null, 'name is required'))
        
        const customTools = config.get('customTools') || []
        if (customTools.some(t => t.name === name)) {
            return res.status(409).json(ChaiteResponse.fail(null, 'Tool already exists'))
        }
        
        const newTool = {
            name,
            description: description || '',
            parameters: parameters || { type: 'object', properties: {}, required: [] },
            handler: handler || 'function',
            custom: true,
            createdAt: Date.now()
        }
        
        customTools.push(newTool)
        config.set('customTools', customTools)
        await mcpManager.refreshBuiltinTools()
        
        res.status(201).json(ChaiteResponse.ok(newTool))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.put('/custom/:name', async (req, res) => {
    try {
        const customTools = config.get('customTools') || []
        const toolIndex = customTools.findIndex(t => t.name === req.params.name)
        
        if (toolIndex === -1) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Tool not found'))
        }
        
        const { description, parameters, handler } = req.body
        if (description) customTools[toolIndex].description = description
        if (parameters) customTools[toolIndex].parameters = parameters
        if (handler) customTools[toolIndex].handler = handler
        customTools[toolIndex].updatedAt = Date.now()
        
        config.set('customTools', customTools)
        await mcpManager.refreshBuiltinTools()
        
        res.json(ChaiteResponse.ok(customTools[toolIndex]))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.delete('/custom/:name', async (req, res) => {
    try {
        const customTools = config.get('customTools') || []
        const filteredTools = customTools.filter(t => t.name !== req.params.name)
        
        if (filteredTools.length === customTools.length) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Tool not found'))
        }
        
        config.set('customTools', filteredTools)
        await mcpManager.refreshBuiltinTools()
        
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== JS工具 ====================
router.get('/js', async (req, res) => {
    try {
        if (!fs.existsSync(jsToolsDir)) {
            fs.mkdirSync(jsToolsDir, { recursive: true })
        }
        
        await mcpManager.init()
        const jsTools = []
        
        for (const [toolName, tool] of builtinMcpServer.jsTools || new Map()) {
            const filename = tool.__filename || `${toolName}.js`
            const filePath = tool.__filepath || path.join(jsToolsDir, filename)
            let stat = { size: 0, mtime: new Date() }
            try { stat = fs.statSync(filePath) } catch {}
            
            jsTools.push({
                name: toolName,
                filename,
                description: tool.description || tool.function?.description || '',
                size: stat.size,
                modifiedAt: stat.mtime.getTime()
            })
        }
        
        res.json(ChaiteResponse.ok(jsTools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/js/:name', async (req, res) => {
    try {
        const filename = req.params.name.endsWith('.js') ? req.params.name : `${req.params.name}.js`
        const filePath = path.join(jsToolsDir, filename)
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Tool file not found'))
        }
        
        const source = fs.readFileSync(filePath, 'utf-8')
        const stat = fs.statSync(filePath)
        
        res.json(ChaiteResponse.ok({
            name: req.params.name,
            filename,
            source,
            size: stat.size,
            modifiedAt: stat.mtime.getTime()
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.put('/js/:name', async (req, res) => {
    try {
        const { source } = req.body
        if (!source) return res.status(400).json(ChaiteResponse.fail(null, 'source is required'))
        
        const filename = req.params.name.endsWith('.js') ? req.params.name : `${req.params.name}.js`
        const filePath = path.join(jsToolsDir, filename)
        
        fs.writeFileSync(filePath, source, 'utf-8')
        await mcpManager.reloadJsTools()
        
        res.json(ChaiteResponse.ok({ success: true, message: '工具已保存并热重载' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.post('/js', async (req, res) => {
    try {
        const { name, source } = req.body
        if (!name) return res.status(400).json(ChaiteResponse.fail(null, 'name is required'))
        
        const filename = name.endsWith('.js') ? name : `${name}.js`
        const filePath = path.join(jsToolsDir, filename)
        
        if (fs.existsSync(filePath)) {
            return res.status(409).json(ChaiteResponse.fail(null, 'Tool file already exists'))
        }
        
        const defaultSource = source || `/**
 * ${name} - 自定义工具
 */
export default {
    name: '${name}',
    description: '自定义工具描述',
    inputSchema: {
        type: 'object',
        properties: {
            message: { type: 'string', description: '参数描述' }
        },
        required: []
    },
    async run(args, ctx) {
        return { content: [{ type: 'text', text: '工具执行成功' }] }
    }
}
`
        
        if (!fs.existsSync(jsToolsDir)) {
            fs.mkdirSync(jsToolsDir, { recursive: true })
        }
        
        fs.writeFileSync(filePath, defaultSource, 'utf-8')
        await mcpManager.reloadJsTools()
        
        res.status(201).json(ChaiteResponse.ok({ success: true, filename }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.delete('/js/:name', async (req, res) => {
    try {
        const filename = req.params.name.endsWith('.js') ? req.params.name : `${req.params.name}.js`
        const filePath = path.join(jsToolsDir, filename)
        
        if (!fs.existsSync(filePath)) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Tool file not found'))
        }
        
        fs.unlinkSync(filePath)
        await mcpManager.reloadJsTools()
        
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /refresh - 刷新工具列表
router.post('/refresh', async (req, res) => {
    try {
        await mcpManager.refreshBuiltinTools()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 工具调用日志 ====================
// GET /logs - 获取工具调用日志
router.get('/logs', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const { limit = 100, toolName, success, userId, groupId } = req.query
        const filter = {}
        if (toolName) filter.toolName = toolName
        if (success !== undefined) filter.success = success === 'true'
        if (userId) filter.userId = userId
        if (groupId) filter.groupId = groupId
        const records = await statsService.getToolCallRecords(filter, parseInt(limit))
        res.json(ChaiteResponse.ok(records))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /logs - 清除工具调用日志
router.delete('/logs', async (req, res) => {
    try {
        const { toolCallStats } = await import('../stats/ToolCallStats.js')
        await toolCallStats.clear()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
