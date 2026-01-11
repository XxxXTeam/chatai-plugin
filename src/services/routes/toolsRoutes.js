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
        // 不应用配置过滤，返回全部工具（前端需要显示禁用状态）
        const tools = mcpManager.getTools({ applyConfig: false })
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

// GET /builtin/config - 获取内置工具配置
router.get('/builtin/config', async (req, res) => {
    try {
        const builtinConfig = config.get('builtinTools') || {}
        res.json(
            ChaiteResponse.ok({
                enabled: builtinConfig.enabled !== false,
                enabledCategories: builtinConfig.enabledCategories || [],
                allowedTools: builtinConfig.allowedTools || [],
                disabledTools: builtinConfig.disabledTools || [],
                allowDangerous: builtinConfig.allowDangerous || false,
                dangerousTools: builtinConfig.dangerousTools || []
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /builtin/config - 更新内置工具配置
router.put('/builtin/config', async (req, res) => {
    try {
        const { enabled, enabledCategories, allowedTools, disabledTools, allowDangerous, dangerousTools } = req.body
        const currentConfig = config.get('builtinTools') || {}

        const newConfig = {
            ...currentConfig,
            enabled: enabled !== undefined ? enabled : currentConfig.enabled,
            enabledCategories: enabledCategories !== undefined ? enabledCategories : currentConfig.enabledCategories,
            allowedTools: allowedTools !== undefined ? allowedTools : currentConfig.allowedTools,
            disabledTools: disabledTools !== undefined ? disabledTools : currentConfig.disabledTools,
            allowDangerous: allowDangerous !== undefined ? allowDangerous : currentConfig.allowDangerous,
            dangerousTools: dangerousTools !== undefined ? dangerousTools : currentConfig.dangerousTools
        }

        config.set('builtinTools', newConfig)

        // 重新加载内置工具
        await builtinMcpServer.loadModularTools()

        res.json(ChaiteResponse.ok({ success: true, config: newConfig }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /builtin/list - 获取内置工具列表
router.get('/builtin/list', async (req, res) => {
    try {
        await mcpManager.init()
        await builtinMcpServer.init()
        const tools = builtinMcpServer.listTools()
        res.json(ChaiteResponse.ok(tools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /builtin/categories - 获取内置工具类别
router.get('/builtin/categories', async (req, res) => {
    try {
        await mcpManager.init()
        await builtinMcpServer.init()
        const categories = builtinMcpServer.getToolCategories() || []
        res.json(ChaiteResponse.ok(categories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /builtin/category/toggle - 切换工具类别启用状态
router.post('/builtin/category/toggle', async (req, res) => {
    try {
        await builtinMcpServer.init()
        const { category, enabled } = req.body
        const result = await builtinMcpServer.toggleCategory(category, enabled)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /builtin/tool/toggle - 切换单个工具启用状态
router.post('/builtin/tool/toggle', async (req, res) => {
    try {
        await builtinMcpServer.init()
        const { toolName, enabled } = req.body
        const result = await builtinMcpServer.toggleTool(toolName, enabled)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /builtin/refresh - 刷新内置工具
router.post('/builtin/refresh', async (req, res) => {
    try {
        await builtinMcpServer.loadModularTools()
        const tools = builtinMcpServer.listTools()
        res.json(ChaiteResponse.ok({ success: true, count: tools.length }))
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
            try {
                stat = fs.statSync(filePath)
            } catch {}

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

        res.json(
            ChaiteResponse.ok({
                name: req.params.name,
                filename,
                source,
                size: stat.size,
                modifiedAt: stat.mtime.getTime()
            })
        )
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

        const defaultSource =
            source ||
            `/**
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

// POST /js/reload - 重载JS工具
router.post('/js/reload', async (req, res) => {
    try {
        await mcpManager.reloadJsTools()
        res.json(ChaiteResponse.ok({ success: true, message: 'JS工具已重载' }))
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

// POST /test - 测试工具
router.post('/test', async (req, res) => {
    try {
        const { toolName, arguments: args } = req.body
        if (!toolName) {
            return res.status(400).json(ChaiteResponse.fail(null, 'toolName is required'))
        }

        await mcpManager.init()
        const startTime = Date.now()
        const result = await mcpManager.callTool(toolName, args || {})
        const duration = Date.now() - startTime

        res.json(
            ChaiteResponse.ok({
                toolName,
                arguments: args || {},
                result,
                duration,
                success: !result?.error
            })
        )
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

// ==================== 一键操作 & 热重载 ====================

// POST /builtin/enable-all - 一键启用所有工具
router.post('/builtin/enable-all', async (req, res) => {
    try {
        await mcpManager.init()
        const result = await mcpManager.enableAllTools()
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /builtin/disable-all - 一键禁用所有工具
router.post('/builtin/disable-all', async (req, res) => {
    try {
        await mcpManager.init()
        const result = await mcpManager.disableAllTools()
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /reload-all - 热重载所有工具
router.post('/reload-all', async (req, res) => {
    try {
        await mcpManager.init()
        const result = await mcpManager.reloadAllTools()
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats - 获取工具统计信息
router.get('/stats', async (req, res) => {
    try {
        await mcpManager.init()
        const stats = mcpManager.getToolStats()
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 危险工具管理 ====================

// GET /dangerous - 获取危险工具列表和配置
router.get('/dangerous', async (req, res) => {
    try {
        const builtinConfig = config.get('builtinTools') || {}
        const dangerousTools = builtinConfig.dangerousTools || []
        const allowDangerous = builtinConfig.allowDangerous || false

        // 获取所有工具并标记危险状态
        await mcpManager.init()
        const allTools = mcpManager.getTools({ applyConfig: false })
        const toolsWithDangerStatus = allTools.map(t => ({
            name: t.name,
            description: t.description,
            serverName: t.serverName,
            isDangerous: dangerousTools.includes(t.name)
        }))

        res.json(
            ChaiteResponse.ok({
                allowDangerous,
                dangerousTools,
                tools: toolsWithDangerStatus
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /dangerous - 更新危险工具配置
router.put('/dangerous', async (req, res) => {
    try {
        const { dangerousTools, allowDangerous } = req.body
        const builtinConfig = config.get('builtinTools') || {}

        if (dangerousTools !== undefined) {
            builtinConfig.dangerousTools = dangerousTools
        }
        if (allowDangerous !== undefined) {
            builtinConfig.allowDangerous = allowDangerous
        }

        config.set('builtinTools', builtinConfig)
        await mcpManager.refreshBuiltinTools()

        res.json(
            ChaiteResponse.ok({
                success: true,
                dangerousTools: builtinConfig.dangerousTools,
                allowDangerous: builtinConfig.allowDangerous
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /dangerous/toggle - 切换单个工具的危险状态
router.post('/dangerous/toggle', async (req, res) => {
    try {
        const { toolName, isDangerous } = req.body
        if (!toolName) {
            return res.status(400).json(ChaiteResponse.fail(null, 'toolName is required'))
        }

        const builtinConfig = config.get('builtinTools') || {}
        let dangerousTools = builtinConfig.dangerousTools || []

        if (isDangerous) {
            if (!dangerousTools.includes(toolName)) {
                dangerousTools.push(toolName)
            }
        } else {
            dangerousTools = dangerousTools.filter(t => t !== toolName)
        }

        builtinConfig.dangerousTools = dangerousTools
        config.set('builtinTools', builtinConfig)

        res.json(
            ChaiteResponse.ok({
                success: true,
                toolName,
                isDangerous,
                dangerousTools
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 事件处理概率配置 ====================

// GET /event-probability - 获取事件处理概率配置
router.get('/event-probability', async (req, res) => {
    try {
        const eventConfig = config.get('events') || {}
        res.json(
            ChaiteResponse.ok({
                enabled: eventConfig.enabled !== false,
                probability: eventConfig.probability ?? 0.5,
                enabledEvents: eventConfig.enabledEvents || ['poke', 'reaction', 'groupIncrease'],
                eventProbabilities: eventConfig.eventProbabilities || {}
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /event-probability - 更新事件处理概率配置
router.put('/event-probability', async (req, res) => {
    try {
        const { enabled, probability, enabledEvents, eventProbabilities } = req.body
        const eventConfig = config.get('events') || {}

        if (enabled !== undefined) eventConfig.enabled = enabled
        if (probability !== undefined) eventConfig.probability = probability
        if (enabledEvents !== undefined) eventConfig.enabledEvents = enabledEvents
        if (eventProbabilities !== undefined) eventConfig.eventProbabilities = eventProbabilities

        config.set('events', eventConfig)

        res.json(
            ChaiteResponse.ok({
                success: true,
                config: eventConfig
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 文件监听状态 ====================

// GET /watcher/status - 获取文件监听器状态
router.get('/watcher/status', async (req, res) => {
    try {
        const status = builtinMcpServer.getWatcherStatus ? builtinMcpServer.getWatcherStatus() : { enabled: false }
        res.json(ChaiteResponse.ok(status))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /watcher/toggle - 切换文件监听器
router.post('/watcher/toggle', async (req, res) => {
    try {
        const { enabled } = req.body
        if (enabled) {
            builtinMcpServer.startFileWatcher && (await builtinMcpServer.startFileWatcher())
        } else {
            builtinMcpServer.stopFileWatcher && builtinMcpServer.stopFileWatcher()
        }
        const status = builtinMcpServer.getWatcherStatus ? builtinMcpServer.getWatcherStatus() : { enabled }
        res.json(ChaiteResponse.ok(status))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
