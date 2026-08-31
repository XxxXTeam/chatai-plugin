/**
 * 工具路由模块 - MCP工具、自定义工具、JS工具
 */
import express from 'express'
import config from '../../../config/config.js'
import { ChaiteResponse } from './shared.js'
import { mcpManager } from '../../mcp/McpManager.js'
import { builtinMcpServer, resolveDangerousTools } from '../../mcp/BuiltinMcpServer.js'
import { getToolIdentity } from '../../core/adapters/tooling.js'
import { customToolService, CustomToolValidationError } from '../tools/CustomToolService.js'
import { chatLogger } from '../../core/utils/logger.js'

const defaultToolRouteServices = Object.freeze({ config, mcpManager, builtinMcpServer, customToolService })
let toolRouteServices = { ...defaultToolRouteServices }

/**
 * 注入工具路由依赖，仅供隔离测试使用。
 * @param {Partial<typeof defaultToolRouteServices>} overrides - 测试替身
 * @returns {() => void} 恢复默认依赖的函数
 */
export function setToolsRouteServicesForTest(overrides = {}) {
    toolRouteServices = { ...defaultToolRouteServices, ...overrides }
    return () => {
        toolRouteServices = { ...defaultToolRouteServices }
    }
}

/**
 * 标记旧接口并提供真实配置接口位置，同时保持既有响应体结构。
 * @param {import('express').Response} res - Express 响应
 * @param {string} replacement - 替代接口
 */
function markDeprecated(res, replacement) {
    res.setHeader('Deprecation', 'true')
    res.setHeader('Link', `<${replacement}>; rel="successor-version"`)
}

/**
 * 返回内置、配置型自定义与 JS 工具的完整名称集合。
 * @returns {Promise<string[]>} 工具名列表
 */
async function getManagedToolNames() {
    const manager = toolRouteServices.mcpManager
    const server = toolRouteServices.builtinMcpServer
    await manager.init()
    await server.init()
    const names = new Set()
    for (const category of server.getToolCategories?.() || []) {
        for (const tool of category.tools || []) {
            if (typeof tool?.name === 'string' && tool.name) names.add(tool.name)
        }
    }
    for (const name of server.jsTools?.keys?.() || []) names.add(name)
    for (const tool of server.getCustomTools?.() || []) {
        if (typeof tool?.name === 'string' && tool.name) names.add(tool.name)
    }
    return Array.from(names)
}

/**
 * 原子更新真实 disabledTools 配置；刷新失败时恢复原值和注册表。
 * @param {string[]} disabledTools - 新禁用列表
 * @returns {Promise<void>}
 */
async function replaceDisabledTools(disabledTools) {
    const routeConfig = toolRouteServices.config
    const previous = routeConfig.get('builtinTools.disabledTools') || []
    await routeConfig.set('builtinTools.disabledTools', disabledTools)
    try {
        await toolRouteServices.mcpManager.refreshBuiltinTools()
    } catch (error) {
        await routeConfig.set('builtinTools.disabledTools', previous)
        try {
            await toolRouteServices.mcpManager.refreshBuiltinTools()
        } catch (restoreError) {
            chatLogger.error('[Tools API] 恢复 disabledTools 注册表失败', restoreError)
        }
        throw error
    }
}

/**
 * 把自定义源码服务的稳定错误转换为 HTTP 语义。
 * @param {import('express').Response} res - Express 响应
 * @param {*} error - 捕获到的错误
 * @returns {import('express').Response} 已发送响应
 */
function sendCustomToolError(res, error) {
    if (error instanceof CustomToolValidationError) {
        const conflictCodes = new Set(['CUSTOM_TOOL_EXISTS', 'CUSTOM_TOOL_NAME_CONFLICT'])
        const missingCodes = new Set(['CUSTOM_TOOL_NOT_FOUND', 'CUSTOM_TOOL_UPDATE_TARGET_INVALID'])
        const status = conflictCodes.has(error.code) ? 409 : missingCodes.has(error.code) ? 404 : 400
        return res.status(status).json(ChaiteResponse.fail({ code: error.code }, error.message))
    }
    chatLogger.error('[Tools API] JS 工具操作失败', error)
    return res.status(500).json(ChaiteResponse.fail(null, 'JS 工具操作失败'))
}

const router = express.Router()

// GET /list - 获取所有工具列表
router.get('/list', async (req, res) => {
    try {
        const manager = toolRouteServices.mcpManager
        await manager.init()
        // 不应用配置过滤，返回全部工具（前端需要显示禁用状态）
        const tools = manager.getTools({ applyConfig: false, includeDuplicateNames: true }).map(tool => ({
            ...tool,
            identity: getToolIdentity(tool)
        }))
        res.json(ChaiteResponse.ok(tools))
    } catch (error) {
        chatLogger.error('[Tools API] 获取工具列表失败', error)
        res.status(500).json(ChaiteResponse.fail(null, '获取工具列表失败'))
    }
})

// GET /builtin - 获取内置工具
router.get('/builtin', async (req, res) => {
    try {
        await toolRouteServices.mcpManager.init()
        const tools = toolRouteServices.builtinMcpServer.listTools()
        res.json(ChaiteResponse.ok(tools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /builtin/config - 获取内置工具配置
router.get('/builtin/config', async (req, res) => {
    try {
        const builtinConfig = toolRouteServices.config.get('builtinTools') || {}
        res.json(
            ChaiteResponse.ok({
                enabled: builtinConfig.enabled !== false,
                enabledCategories: builtinConfig.enabledCategories || [],
                allowedTools: builtinConfig.allowedTools || [],
                disabledTools: builtinConfig.disabledTools || [],
                allowDangerous: builtinConfig.allowDangerous || false,
                dangerousTools: builtinConfig.dangerousTools || [],
                approvalMode: builtinConfig.approvalMode || 'auto',
                approvalTimeoutMs: builtinConfig.approvalTimeoutMs || 60000,
                approvalLowRiskTools: builtinConfig.approvalLowRiskTools || [],
                approvalMediumRiskTools: builtinConfig.approvalMediumRiskTools || [],
                approvalHighRiskTools: builtinConfig.approvalHighRiskTools || [],
                approvalBypassTools: builtinConfig.approvalBypassTools || [],
                approvalAllowSessionBypass: builtinConfig.approvalAllowSessionBypass !== false,
                approvalSessionBypassMaxRisk: builtinConfig.approvalSessionBypassMaxRisk || 'medium'
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /builtin/config - 更新内置工具配置
router.put('/builtin/config', async (req, res) => {
    try {
        const {
            enabled,
            enabledCategories,
            allowedTools,
            disabledTools,
            allowDangerous,
            dangerousTools,
            approvalMode,
            approvalTimeoutMs,
            approvalLowRiskTools,
            approvalMediumRiskTools,
            approvalHighRiskTools,
            approvalBypassTools,
            approvalAllowSessionBypass,
            approvalSessionBypassMaxRisk
        } = req.body || {}
        const routeConfig = toolRouteServices.config
        const currentConfig = routeConfig.get('builtinTools') || {}

        const newConfig = {
            ...currentConfig,
            enabled: enabled !== undefined ? enabled : currentConfig.enabled,
            enabledCategories: enabledCategories !== undefined ? enabledCategories : currentConfig.enabledCategories,
            allowedTools: allowedTools !== undefined ? allowedTools : currentConfig.allowedTools,
            disabledTools: disabledTools !== undefined ? disabledTools : currentConfig.disabledTools,
            allowDangerous: allowDangerous !== undefined ? allowDangerous : currentConfig.allowDangerous,
            dangerousTools: dangerousTools !== undefined ? dangerousTools : currentConfig.dangerousTools,
            approvalMode: approvalMode !== undefined ? approvalMode : currentConfig.approvalMode,
            approvalTimeoutMs: approvalTimeoutMs !== undefined ? approvalTimeoutMs : currentConfig.approvalTimeoutMs,
            approvalLowRiskTools:
                approvalLowRiskTools !== undefined ? approvalLowRiskTools : currentConfig.approvalLowRiskTools,
            approvalMediumRiskTools:
                approvalMediumRiskTools !== undefined ? approvalMediumRiskTools : currentConfig.approvalMediumRiskTools,
            approvalHighRiskTools:
                approvalHighRiskTools !== undefined ? approvalHighRiskTools : currentConfig.approvalHighRiskTools,
            approvalBypassTools:
                approvalBypassTools !== undefined ? approvalBypassTools : currentConfig.approvalBypassTools,
            approvalAllowSessionBypass:
                approvalAllowSessionBypass !== undefined
                    ? approvalAllowSessionBypass
                    : currentConfig.approvalAllowSessionBypass,
            approvalSessionBypassMaxRisk:
                approvalSessionBypassMaxRisk !== undefined
                    ? approvalSessionBypassMaxRisk
                    : currentConfig.approvalSessionBypassMaxRisk
        }

        await routeConfig.set('builtinTools', newConfig)

        try {
            await toolRouteServices.mcpManager.refreshBuiltinTools()
        } catch (error) {
            await routeConfig.set('builtinTools', currentConfig)
            try {
                await toolRouteServices.mcpManager.refreshBuiltinTools()
            } catch (restoreError) {
                chatLogger.error('[Tools API] 恢复内置工具配置失败', restoreError)
            }
            throw error
        }

        res.json(ChaiteResponse.ok({ success: true, config: newConfig }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /builtin/list - 获取内置工具列表
router.get('/builtin/list', async (req, res) => {
    try {
        await toolRouteServices.mcpManager.init()
        await toolRouteServices.builtinMcpServer.init()
        const tools = toolRouteServices.builtinMcpServer.listTools()
        res.json(ChaiteResponse.ok(tools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /builtin/categories - 获取内置工具类别
router.get('/builtin/categories', async (req, res) => {
    try {
        await toolRouteServices.mcpManager.init()
        await toolRouteServices.builtinMcpServer.init()
        const categories = toolRouteServices.builtinMcpServer.getToolCategories() || []
        res.json(ChaiteResponse.ok(categories))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /builtin/category/toggle - 切换工具类别启用状态
router.post('/builtin/category/toggle', async (req, res) => {
    try {
        const { category, enabled } = req.body
        if (typeof category !== 'string' || !category.trim() || typeof enabled !== 'boolean') {
            return res.status(400).json(ChaiteResponse.fail(null, 'category 和 enabled(boolean) 为必填项'))
        }
        const result = await toolRouteServices.mcpManager.toggleCategory(category.trim(), enabled)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /builtin/tool/toggle - 切换单个工具启用状态
router.post('/builtin/tool/toggle', async (req, res) => {
    try {
        const { toolName, enabled } = req.body
        if (typeof toolName !== 'string' || !toolName.trim() || typeof enabled !== 'boolean') {
            return res.status(400).json(ChaiteResponse.fail(null, 'toolName 和 enabled(boolean) 为必填项'))
        }
        const result = await toolRouteServices.mcpManager.toggleTool(toolName.trim(), enabled)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /builtin/refresh - 刷新内置工具
router.post('/builtin/refresh', async (req, res) => {
    try {
        const tools = await toolRouteServices.mcpManager.refreshBuiltinTools()
        res.json(ChaiteResponse.ok({ success: true, count: tools.length }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /enabled - 获取启用的工具
router.get('/enabled', async (req, res) => {
    try {
        markDeprecated(res, '/api/tools/builtin/config')
        const names = await getManagedToolNames()
        const disabled = new Set(toolRouteServices.config.get('builtinTools.disabledTools') || [])
        const enabledTools = names.filter(name => !disabled.has(name))
        res.json(ChaiteResponse.ok(enabledTools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /enabled - 更新启用的工具
router.put('/enabled', async (req, res) => {
    try {
        const { tools } = req.body
        if (!Array.isArray(tools) || tools.some(name => typeof name !== 'string' || !name.trim())) {
            return res.status(400).json(ChaiteResponse.fail(null, 'tools 必须为工具名字符串数组'))
        }
        markDeprecated(res, '/api/tools/builtin/config')
        const managedNames = await getManagedToolNames()
        const managed = new Set(managedNames)
        const enabled = new Set(tools.map(name => name.trim()))
        const currentDisabled = toolRouteServices.config.get('builtinTools.disabledTools') || []
        const preserved = currentDisabled.filter(name => !managed.has(name))
        const disabledTools = [...preserved, ...managedNames.filter(name => !enabled.has(name))]
        await replaceDisabledTools(disabledTools)
        res.json(
            ChaiteResponse.ok({
                success: true,
                deprecated: true,
                replacement: '/api/tools/builtin/config',
                enabled: managedNames.filter(name => enabled.has(name)),
                disabledTools
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /toggle/:name - 切换工具启用状态
router.post('/toggle/:name', async (req, res) => {
    try {
        const { name } = req.params
        const { enabled } = req.body
        if (typeof enabled !== 'boolean') {
            return res.status(400).json(ChaiteResponse.fail(null, 'enabled(boolean) 为必填项'))
        }
        markDeprecated(res, '/api/tools/builtin/tool/toggle')
        const result = await toolRouteServices.mcpManager.toggleTool(name, enabled)
        res.json(
            ChaiteResponse.ok({
                ...result,
                deprecated: true,
                replacement: '/api/tools/builtin/tool/toggle',
                enabled
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 自定义工具 ====================
router.get('/custom', async (req, res) => {
    try {
        const customTools = await toolRouteServices.customToolService.listConfiguredTools()
        res.json(ChaiteResponse.ok(customTools))
    } catch (error) {
        sendCustomToolError(res, error)
    }
})

router.post('/custom', async (req, res) => {
    try {
        const newTool = await toolRouteServices.customToolService.createConfiguredTool(req.body || {})
        await toolRouteServices.mcpManager.refreshBuiltinTools()

        res.status(201).json(ChaiteResponse.ok(newTool))
    } catch (error) {
        sendCustomToolError(res, error)
    }
})

router.put('/custom/:name', async (req, res) => {
    try {
        const updatedTool = await toolRouteServices.customToolService.updateConfiguredTool(
            req.params.name,
            req.body || {}
        )
        await toolRouteServices.mcpManager.refreshBuiltinTools()

        res.json(ChaiteResponse.ok(updatedTool))
    } catch (error) {
        sendCustomToolError(res, error)
    }
})

router.delete('/custom/:name', async (req, res) => {
    try {
        const result = await toolRouteServices.customToolService.deleteConfiguredTool(req.params.name)
        await toolRouteServices.mcpManager.refreshBuiltinTools()

        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        sendCustomToolError(res, error)
    }
})

// ==================== JS工具 ====================
router.get('/js', async (req, res) => {
    try {
        const jsTools = await toolRouteServices.customToolService.listSources()
        res.json(ChaiteResponse.ok(jsTools))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/js/:name', async (req, res) => {
    try {
        const result = await toolRouteServices.customToolService.readSource(req.params.name)

        res.json(
            ChaiteResponse.ok({
                name: result.name,
                filename: result.filename,
                source: result.source,
                size: result.size,
                modifiedAt: result.modifiedAt
            })
        )
    } catch (error) {
        sendCustomToolError(res, error)
    }
})

router.put('/js/:name', async (req, res) => {
    try {
        const { source } = req.body
        if (!source) return res.status(400).json(ChaiteResponse.fail(null, 'source is required'))
        const result = await toolRouteServices.customToolService.saveSource(req.params.name, source, {
            overwrite: true
        })
        res.json(ChaiteResponse.ok({ ...result, message: '工具已保存并热重载' }))
    } catch (error) {
        sendCustomToolError(res, error)
    }
})

router.post('/js', async (req, res) => {
    try {
        const { name, source } = req.body
        if (!name) return res.status(400).json(ChaiteResponse.fail(null, 'name is required'))

        const { name: toolName } = toolRouteServices.customToolService.resolveSourcePath(name)

        const defaultSource =
            source ||
            `/**
 * ${toolName} - 自定义工具
 */
export default {
    name: '${toolName}',
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

        const result = await toolRouteServices.customToolService.saveSource(toolName, defaultSource, {
            overwrite: false
        })
        res.status(201).json(ChaiteResponse.ok(result))
    } catch (error) {
        sendCustomToolError(res, error)
    }
})

router.delete('/js/:name', async (req, res) => {
    try {
        const result = await toolRouteServices.customToolService.deleteSource(req.params.name)
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        sendCustomToolError(res, error)
    }
})

// POST /js/reload - 重载JS工具
router.post('/js/reload', async (req, res) => {
    try {
        await toolRouteServices.mcpManager.reloadJsTools()
        res.json(ChaiteResponse.ok({ success: true, message: 'JS工具已重载' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /refresh - 刷新工具列表
router.post('/refresh', async (req, res) => {
    try {
        await toolRouteServices.mcpManager.refreshBuiltinTools()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /test - 测试工具
router.post('/test', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    const sendEvent = (event, data) => {
        if (!res.writableEnded) {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        }
    }

    try {
        const { toolName, arguments: args } = req.body
        if (!toolName) {
            sendEvent('error', { code: 400, message: 'toolName is required' })
            return res.end()
        }

        await toolRouteServices.mcpManager.init()
        let callName = toolName
        // 管理面板请求已通过 WebServer 鉴权；测试自定义工具时显式使用管理上下文，
        // 不能依赖上一条聊天事件残留的主人状态，也不能因无事件上下文被误拒绝。
        const callOptions = {
            userPermission: 'master',
            context: { isMaster: true, isAdminTest: true, bot: global.Bot || null }
        }
        const identityMatch = typeof toolName === 'string' ? toolName.match(/^mcp:([^:]+):(.+)$/) : null
        if (identityMatch) {
            callOptions.serverName = identityMatch[1]
            callName = identityMatch[2]
        }

        sendEvent('start', { toolName: callName })

        const startTime = Date.now()
        const result = await toolRouteServices.mcpManager.callTool(callName, args || {}, callOptions)
        const duration = Date.now() - startTime

        sendEvent('result', {
            toolName: callName,
            arguments: args || {},
            result,
            duration,
            success: !result?.error
        })
    } catch (error) {
        sendEvent('error', { code: 500, message: error.message })
    } finally {
        if (!res.writableEnded) {
            res.end()
        }
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
        await toolRouteServices.mcpManager.init()
        const result = await toolRouteServices.mcpManager.enableAllTools()
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /builtin/disable-all - 一键禁用所有工具
router.post('/builtin/disable-all', async (req, res) => {
    try {
        await toolRouteServices.mcpManager.init()
        const result = await toolRouteServices.mcpManager.disableAllTools()
        res.json(ChaiteResponse.ok(result))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /reload-all - 热重载所有工具（完全重新初始化MCP模块）
router.post('/reload-all', async (req, res) => {
    try {
        // 使用 reinit 完全重新初始化，确保所有工具（包括内置工具和JS工具）都被正确重载
        const result = await toolRouteServices.mcpManager.reinit()
        res.json(
            ChaiteResponse.ok({
                success: true,
                ...result,
                message: `重载完成: ${result.tools} 个工具, ${result.servers} 个服务器`
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats - 获取工具统计信息
router.get('/stats', async (req, res) => {
    try {
        await toolRouteServices.mcpManager.init()
        const stats = toolRouteServices.mcpManager.getToolStats()
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
        // 与实际拦截行为保持一致：拦截层取"内置默认黑名单 ∪ 用户配置"，
        // 此处若只读用户配置，配置为空数组时面板会显示"没有危险工具"，与真实行为矛盾
        const dangerousTools = resolveDangerousTools(builtinConfig)
        const allowDangerous = builtinConfig.allowDangerous || false

        // 获取所有工具并标记危险状态
        await toolRouteServices.mcpManager.init()
        const allTools = toolRouteServices.mcpManager.getTools({ applyConfig: false })
        const toolsWithDangerStatus = allTools.map(t => ({
            name: t.name,
            identity: getToolIdentity(t),
            description: t.description,
            serverName: t.serverName,
            isDangerous: dangerousTools.includes(t.name) || dangerousTools.includes(getToolIdentity(t))
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
        await toolRouteServices.mcpManager.refreshBuiltinTools()

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
        const dangerousTools = Array.isArray(builtinConfig.dangerousTools) ? [...builtinConfig.dangerousTools] : []
        const excluded = Array.isArray(builtinConfig.dangerousToolsExcluded)
            ? [...builtinConfig.dangerousToolsExcluded]
            : []

        /*
         * 拦截端取 (内置默认 ∪ 用户新增) - 用户豁免，所以这里必须同时维护两个清单：
         * 只从 dangerousTools 里删除是不够的——若该工具属于内置默认黑名单，
         * 下次读取时会被并集重新加回来，表现为「取消了但仍被拦截」。
         */
        let nextDangerous = dangerousTools
        let nextExcluded = excluded
        if (isDangerous) {
            if (!nextDangerous.includes(toolName)) nextDangerous.push(toolName)
            nextExcluded = nextExcluded.filter(t => t !== toolName)
        } else {
            nextDangerous = nextDangerous.filter(t => t !== toolName)
            if (!nextExcluded.includes(toolName)) nextExcluded.push(toolName)
        }

        builtinConfig.dangerousTools = nextDangerous
        builtinConfig.dangerousToolsExcluded = nextExcluded
        config.set('builtinTools', builtinConfig)

        res.json(
            ChaiteResponse.ok({
                success: true,
                toolName,
                isDangerous,
                // 回传最终生效的名单，避免前端按原始配置渲染而与实际拦截行为不符
                dangerousTools: resolveDangerousTools(builtinConfig),
                dangerousToolsExcluded: nextExcluded
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
        const builtin = toolRouteServices.builtinMcpServer
        const status = builtin.getWatcherStatus ? builtin.getWatcherStatus() : { enabled: false }
        res.json(ChaiteResponse.ok(status))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /watcher/toggle - 切换文件监听器
router.post('/watcher/toggle', async (req, res) => {
    try {
        const { enabled } = req.body
        const builtin = toolRouteServices.builtinMcpServer
        if (enabled) {
            builtin.startFileWatcher && (await builtin.startFileWatcher())
        } else {
            builtin.stopFileWatcher && builtin.stopFileWatcher()
        }
        const status = builtin.getWatcherStatus ? builtin.getWatcherStatus() : { enabled }
        res.json(ChaiteResponse.ok(status))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
