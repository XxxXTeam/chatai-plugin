/**
 * Skills Agent 路由模块
 * 提供统一的技能/工具管理接口
 */
import path from 'node:path'
import express from 'express'
import multer from 'multer'
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
import { skillsLoader } from '../skills/SkillsLoader.js'
import { skillDocumentLoader, isEditableSkillFile } from '../skills/SkillDocumentLoader.js'
import { importSkillPackage, SkillImportError, MAX_UPLOAD_BYTES } from '../skills/SkillPackageImporter.js'
import config from '../../../config/config.js'

const router = express.Router()

/**
 * 取当前生效的 SkillsLoader 实例
 *
 * 运行期用 global 上那个（已完成 init），单测或未初始化时回落到模块单例
 * @returns {object} SkillsLoader 实例
 */
function getSkillsLoader() {
    const loader = global.chatAiSkillsLoader
    return loader?.initialized ? loader : skillsLoader
}

/**
 * 重新加载文档技能并广播
 * @param {string} reason - 触发原因，用于事件负载
 * @returns {Promise<{documents: number, loaded: number}|null>} 重载结果
 */
async function reloadSkillDocuments(reason) {
    const loader = getSkillsLoader()
    if (typeof loader.reloadDocuments !== 'function') return null
    const result = await loader.reloadDocuments()
    broadcastSSE('skill-documents-reloaded', { reason, ...result, timestamp: Date.now() })
    return result
}

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

/**
 * GET /documents - 获取 SKILL.md 文档技能
 *
 * 返回 SkillDocumentLoader.buildDocument 已规范化的顶层字段。
 * 其中 priority 与 autoActivate 的缺省语义（0 / true）由后端统一给出，
 * 前端不得回退去读 metadata 原值，否则 frontmatter 未声明时会丢失默认值语义。
 * @returns {ChaiteResponse} { count, documents }
 */
router.get('/documents', async (req, res) => {
    try {
        const documents = global.chatAiSkillsLoader?.getSkillDocuments?.() || skillsLoader.getSkillDocuments()
        res.json(
            ChaiteResponse.ok({
                count: documents.length,
                documents: documents.map(document => ({
                    name: document.name,
                    description: document.description,
                    triggers: document.triggers || [],
                    allowedTools: document.allowedTools || [],
                    disallowedTools: document.disallowedTools || [],
                    capabilities: document.capabilities || [],
                    priority: Number.isFinite(document.priority) ? document.priority : 0,
                    autoActivate: document.autoActivate !== false,
                    type: document.type,
                    // 包形式技能（含 SKILL.md 的目录）会附带 references/ assets/ scripts/ 下的资源清单
                    isPackage: document.isPackage === true,
                    files: (document.files || []).map(file => ({
                        path: file.path,
                        dir: file.dir,
                        size: file.size
                    })),
                    path: document.relativePath,
                    directory: document.directory
                }))
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ========== 文档技能编辑 ==========

/**
 * GET /documents/:name/source - 读取技能定义文件的原始内容（含 frontmatter）
 *
 * name 只用于在已加载的文档表里查表，不参与任何路径拼接；实际读取路径来自扫描结果，
 * 并在 SkillDocumentLoader 内再做一次 realpath 前缀校验。
 * @returns {ChaiteResponse} { name, path, type, isPackage, content, size }
 */
router.get('/documents/:name/source', async (req, res) => {
    try {
        const source = skillDocumentLoader.readSkillSource(req.params.name)
        if (!source) {
            return res.status(404).json(ChaiteResponse.fail(null, `技能 ${req.params.name} 不存在或不可读取`))
        }
        res.json(
            ChaiteResponse.ok({
                name: source.name,
                path: source.relativePath,
                type: source.type,
                isPackage: source.isPackage,
                content: source.content,
                size: source.size
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * PUT /documents/:name/source - 保存技能定义文件
 *
 * 写入前先解析内容（markdown 校验 frontmatter 是否为含 name 的合法 YAML，
 * yaml/json 校验顶层是否为对象），语法不合法直接拒绝、不落盘；
 * 写入后只重载文档技能，不动 MCP 与可执行工具。
 * @returns {ChaiteResponse} { name, path, size, reloaded }
 */
router.put('/documents/:name/source', async (req, res) => {
    try {
        const { content } = req.body || {}
        if (typeof content !== 'string') {
            return res.status(400).json(ChaiteResponse.fail(null, 'content (string) is required'))
        }

        const result = skillDocumentLoader.writeSkillSource(req.params.name, content)
        if (!result.ok) {
            return res.status(result.status || 400).json(ChaiteResponse.fail(null, result.error))
        }

        await reloadSkillDocuments('document-saved')
        broadcastSSE('skill-document-saved', { name: result.name, timestamp: Date.now() })
        res.json(ChaiteResponse.ok({ name: result.name, path: result.relativePath, size: result.size }, '已保存'))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * GET /documents/:name/files - 读取技能包内附属文件内容
 *
 * 目标必须是扫描阶段收录的文件，readPackageFile 内含白名单 + realpath 双重校验
 * @returns {ChaiteResponse} { path, content, size, editable }
 */
router.get('/documents/:name/files', async (req, res) => {
    try {
        const filePath = typeof req.query.path === 'string' ? req.query.path : ''
        if (!filePath) {
            return res.status(400).json(ChaiteResponse.fail(null, 'path is required'))
        }

        const file = skillDocumentLoader.readPackageFile(req.params.name, filePath)
        if (!file) {
            return res.status(404).json(ChaiteResponse.fail(null, '文件不存在或不可读取'))
        }
        res.json(
            ChaiteResponse.ok({
                path: file.path,
                content: file.content,
                size: file.size,
                editable: isEditableSkillFile(file.path)
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * PUT /documents/:name/files - 保存技能包内附属文件
 *
 * 仅允许改写纯文本类扩展名，scripts/ 下的脚本不在白名单内
 * @returns {ChaiteResponse} { path, size }
 */
router.put('/documents/:name/files', async (req, res) => {
    try {
        const { path: filePath, content } = req.body || {}
        if (typeof filePath !== 'string' || !filePath) {
            return res.status(400).json(ChaiteResponse.fail(null, 'path (string) is required'))
        }
        if (typeof content !== 'string') {
            return res.status(400).json(ChaiteResponse.fail(null, 'content (string) is required'))
        }

        const result = skillDocumentLoader.writePackageFile(req.params.name, filePath, content)
        if (!result.ok) {
            return res.status(result.status || 400).json(ChaiteResponse.fail(null, result.error))
        }

        await reloadSkillDocuments('package-file-saved')
        broadcastSSE('skill-document-saved', { name: req.params.name, file: result.path, timestamp: Date.now() })
        res.json(ChaiteResponse.ok({ path: result.path, size: result.size }, '已保存'))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ========== 技能包导入 ==========

/**
 * zip 上传中间件
 * 内存存储 + 单文件 + 大小上限，避免大文件先落盘再校验
 */
const uploadSkillZip = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 }
}).single('file')

/**
 * POST /documents/import - 导入 skill 压缩包
 *
 * 全部解压防护集中在 SkillPackageImporter：Zip Slip 双重校验、符号链接条目拒绝、
 * 条目数/单条目/总量三重限额、扩展名白名单、必须含 SKILL.md、目录名白名单。
 * 同名时返回 409，需显式带 overwrite=true 才覆盖，覆盖前旧目录会挪到 temp/ 留档。
 * @returns {ChaiteResponse} { name, directory, files, totalBytes, overwritten }
 */
router.post('/documents/import', (req, res) => {
    uploadSkillZip(req, res, async uploadError => {
        try {
            if (uploadError) {
                const message =
                    uploadError.code === 'LIMIT_FILE_SIZE'
                        ? `压缩包大小超出上限 ${MAX_UPLOAD_BYTES} 字节`
                        : `上传失败: ${uploadError.message}`
                return res.status(400).json(ChaiteResponse.fail(null, message))
            }
            if (!req.file?.buffer) {
                return res.status(400).json(ChaiteResponse.fail(null, '请选择要上传的 zip 文件'))
            }

            const loader = getSkillsLoader()
            const pluginRoot = skillDocumentLoader.pluginRoot || loader.pluginRoot
            if (!pluginRoot) {
                return res.status(500).json(ChaiteResponse.fail(null, 'Skills 未初始化'))
            }

            const result = importSkillPackage(req.file.buffer, {
                importRoot: skillDocumentLoader.getImportRoot(),
                tempRoot: path.join(pluginRoot, 'temp', 'skills-import'),
                name: typeof req.body?.name === 'string' ? req.body.name : '',
                originalName: req.file.originalname,
                overwrite: req.body?.overwrite === 'true' || req.body?.overwrite === true,
                existingNames: skillDocumentLoader.getDocuments().map(document => document.name)
            })

            await reloadSkillDocuments('package-imported')
            broadcastSSE('skill-imported', {
                name: result.name,
                directory: result.directory,
                timestamp: Date.now()
            })

            res.status(201).json(
                ChaiteResponse.ok(
                    {
                        name: result.name,
                        directory: result.directory,
                        files: result.files,
                        totalBytes: result.totalBytes,
                        overwritten: result.overwritten
                    },
                    result.overwritten ? '已覆盖导入技能包' : '已导入技能包'
                )
            )
        } catch (error) {
            if (error instanceof SkillImportError) {
                return res.status(error.status || 400).json(ChaiteResponse.fail(error.detail || null, error.message))
            }
            res.status(500).json(ChaiteResponse.fail(null, error.message))
        }
    })
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

// ========== 发现 (Discovery) API ==========

// GET /search - 搜索技能
router.get('/search', async (req, res) => {
    try {
        const { q = '', limit = '20', category, source } = req.query
        const agent = await createSkillsAgent({})
        const results = agent.searchSkills(q, {
            limit: parseInt(limit) || 20,
            category: category || undefined,
            source: source || undefined
        })
        res.json(ChaiteResponse.ok({ query: q, count: results.length, results }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /discover - 获取发现摘要（分类统计）
router.get('/discover', async (req, res) => {
    try {
        const agent = await createSkillsAgent({})
        const summary = agent.getDiscoverySummary()
        const total = agent.skills.size
        res.json(ChaiteResponse.ok({ total, categories: summary }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /tools/:name/detail - 获取技能详情
router.get('/tools/:name/detail', async (req, res) => {
    try {
        const agent = await createSkillsAgent({})
        const detail = agent.getSkillDetail(req.params.name)
        if (!detail) {
            return res.status(404).json(ChaiteResponse.fail(null, `技能 ${req.params.name} 不存在`))
        }
        res.json(ChaiteResponse.ok(detail))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /recommend - 根据上下文推荐技能
router.post('/recommend', async (req, res) => {
    try {
        const { context = '', limit = 5 } = req.body
        if (!context) {
            return res.status(400).json(ChaiteResponse.fail(null, 'context is required'))
        }
        const agent = await createSkillsAgent({})
        const recommendations = agent.getRecommendations(context, { limit })
        res.json(ChaiteResponse.ok({ context, count: recommendations.length, recommendations }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /execute/batch - 批量执行技能
router.post('/execute/batch', async (req, res) => {
    try {
        const { calls = [], presetId = 'default' } = req.body
        if (!Array.isArray(calls) || calls.length === 0) {
            return res.status(400).json(ChaiteResponse.fail(null, 'calls array is required'))
        }
        const agent = await createSkillsAgent({ presetId })
        const results = await agent.executeBatch(calls)

        broadcastSSE('batch-executed', {
            count: calls.length,
            timestamp: Date.now()
        })

        res.json(ChaiteResponse.ok({ count: results.length, results }))
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

// ========== 上下文压缩配置 ==========

/**
 * 上下文压缩配置允许更新的字段白名单
 * @type {string[]}
 */
const CONTEXT_CONFIG_ALLOWED_KEYS = [
    'maxTokens',
    'maxMessages',
    'compressionThreshold',
    'compressionStrategy',
    'preserveSystemPrompt',
    'preserveRecentMessages',
    'autoReloadSkills'
]

/**
 * GET /context-config - 获取当前上下文压缩配置
 * @returns {ChaiteResponse} 当前 context 配置对象
 */
router.get('/context-config', async (req, res) => {
    try {
        const contextConfig = config.get('context') || {}
        res.json(ChaiteResponse.ok(contextConfig))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * POST /context-config - 更新上下文压缩配置
 * 仅接受白名单字段，以 merge 方式写入 config 的 context key
 * @returns {ChaiteResponse} 本次实际生效的字段
 */
router.post('/context-config', async (req, res) => {
    try {
        const updates = req.body || {}
        const filtered = {}
        for (const key of CONTEXT_CONFIG_ALLOWED_KEYS) {
            if (key in updates) filtered[key] = updates[key]
        }

        const current = config.get('context') || {}
        config.set('context', { ...current, ...filtered })

        res.json(ChaiteResponse.ok(filtered, '上下文配置已更新'))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ========== 已加载技能管理 ==========

/**
 * GET /loaded - 获取当前已加载（激活）的技能列表
 * @returns {ChaiteResponse} { skills: 全部文档, loaded: 已加载名称数组 }
 */
router.get('/loaded', async (req, res) => {
    try {
        const loader = global.chatAiSkillsLoader
        if (!loader?.initialized) {
            return res.json(ChaiteResponse.ok({ skills: [], loaded: [] }))
        }
        res.json(
            ChaiteResponse.ok({
                skills: loader.getSkillDocuments(),
                loaded: loader.getLoadedSkillNames()
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * POST /load/:name - 加载（激活）指定技能
 * @returns {ChaiteResponse} { name, loaded: true } 或 404
 */
router.post('/load/:name', async (req, res) => {
    try {
        const { name } = req.params
        const loader = global.chatAiSkillsLoader
        if (!loader?.initialized) {
            return res.status(500).json(ChaiteResponse.fail(null, 'Skills 未初始化'))
        }

        const loaded = loader.loadSkill(name)
        if (!loaded) {
            return res.status(404).json(ChaiteResponse.fail(null, `技能 ${name} 不存在`))
        }

        broadcastSSE('skill-loaded', { name, timestamp: Date.now() })
        res.json(ChaiteResponse.ok({ name, loaded: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * POST /unload/:name - 卸载指定技能
 * @returns {ChaiteResponse} { name, loaded: false }
 */
router.post('/unload/:name', async (req, res) => {
    try {
        const { name } = req.params
        const loader = global.chatAiSkillsLoader
        if (!loader?.initialized) {
            return res.status(500).json(ChaiteResponse.fail(null, 'Skills 未初始化'))
        }

        loader.unloadSkill(name)

        broadcastSSE('skill-unloaded', { name, timestamp: Date.now() })
        res.json(ChaiteResponse.ok({ name, loaded: false }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// 导出广播函数供其他模块使用
export { broadcastSSE }
export default router
