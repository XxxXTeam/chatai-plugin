/**
 * @fileoverview Skills 内置工具
 *
 * 配合渐进式披露（skills.documents.disclosure = 'progressive'）工作：
 * 系统提示词中只保留技能的元数据与附属文件清单，模型按需通过这些工具逐层取内容。
 * - list_skills / get_skill_info  —— Level 1→2：从技能清单到完整 SKILL.md 正文
 * - list_skill_files / read_skill_file —— Level 3：读取包内 references/ assets/ scripts/
 *
 * 注意：所有 handler 一律返回对象而非 JSON 字符串。上层 isToolResultError 依赖
 * success/error 等对象属性判断成败，返回字符串会导致失败被误判为成功。
 */

// get_skill_info 返回正文的最大字符数。渐进式披露下这是模型获取完整说明的主路径，
// 上限需覆盖典型 SKILL.md；超长部分提示改用 read_skill_file 读取拆分出的附属文件
import { customToolService } from '../../services/tools/CustomToolService.js'

const MAX_INSTRUCTION_CHARS = 20000

/**
 * 惰性获取文档加载器
 * @returns {Promise<object>} skillDocumentLoader 单例
 */
async function getDocumentLoader() {
    const { skillDocumentLoader } = await import('../../services/skills/SkillDocumentLoader.js')
    return skillDocumentLoader
}

/**
 * 校验技能名参数并返回归一化结果
 * @param {object} args - 工具入参
 * @returns {{ok: boolean, name: string, error?: object}} 校验结果
 */
function requireSkillName(args) {
    if (!global.chatAiSkillsLoader?.initialized) {
        return { ok: false, name: '', error: { success: false, error: 'Skills 系统未初始化' } }
    }
    const name = String(args?.name || '').trim()
    if (!name) {
        return { ok: false, name: '', error: { success: false, error: '技能名称不能为空' } }
    }
    return { ok: true, name }
}

/**
 * 校验当前工具上下文是否为主人。
 * @param {Object} ctx - 工具上下文
 * @returns {boolean} 是否为主人
 */
function isMasterContext(ctx) {
    return (typeof ctx?.isMaster === 'function' ? ctx.isMaster() : ctx?.isMaster) === true
}

/**
 * 构造主人权限错误。
 * @returns {Object} MCP 兼容错误对象
 */
function masterOnlyError() {
    return { success: false, isError: true, error: '该操作仅允许主人执行' }
}

export const skillsTools = [
    {
        name: 'list_skills',
        description:
            '列出所有可用的技能(skills)及其描述。用于了解有哪些技能可以加载到当前会话中。返回技能名称、描述、是否自动激活等信息。',
        inputSchema: {
            type: 'object',
            properties: {},
            required: []
        },
        category: 'basic',
        handler: async () => {
            const loader = global.chatAiSkillsLoader
            if (!loader?.initialized) {
                return { success: false, error: 'Skills 系统未初始化', skills: [] }
            }

            const skills = loader.getExposedSkillList()
            const loadedNames = loader.getLoadedSkillNames()

            const result = skills.map(s => ({
                name: s.name,
                description: s.description,
                autoActivate: s.autoActivate,
                loaded: loadedNames.includes(s.name),
                triggers: s.triggers,
                standardCompliant: s.standardCompliant === true,
                compatibilityWarnings: s.compatibilityWarnings || []
            }))

            return { success: true, count: result.length, loaded: loadedNames.length, skills: result }
        }
    },
    {
        name: 'load_skill',
        description:
            '读取指定技能的完整指令并在当前工具调用链中生效。默认不写全局状态；主人可显式 persist_global 供所有会话持久启用。',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '要加载的技能名称（从 list_skills 返回的 name 字段获取）'
                },
                persist_global: {
                    type: 'boolean',
                    description: '仅主人可设 true；把技能持久加入全局激活列表'
                }
            },
            required: ['name']
        },
        category: 'basic',
        handler: async (args, ctx) => {
            const checked = requireSkillName(args)
            if (!checked.ok) return checked.error

            const loader = global.chatAiSkillsLoader
            const documentLoader = await getDocumentLoader()
            const doc = documentLoader.getDocumentByName(checked.name)
            if (!doc) return { success: false, error: `技能 "${checked.name}" 不存在` }

            let persisted = false
            if (args.persist_global === true) {
                if (!isMasterContext(ctx)) return masterOnlyError()
                persisted = loader.loadSkill(checked.name)
            }

            const body = String(doc.body || '')
            return {
                success: true,
                message: persisted
                    ? `技能 "${checked.name}" 已由主人持久加入全局激活列表${body.length > MAX_INSTRUCTION_CHARS ? '；当前返回首段指令，请按 nextOffset 继续读取' : ''}`
                    : body.length > MAX_INSTRUCTION_CHARS
                      ? `技能 "${checked.name}" 的首段指令已返回，仅对当前工具调用链生效；请按 nextOffset 调用 get_skill_info 继续读取`
                      : `技能 "${checked.name}" 的完整指令已返回，仅对当前工具调用链生效`,
                persisted,
                skill: {
                    name: doc.name,
                    description: doc.description,
                    allowedTools: doc.allowedTools || [],
                    disallowedTools: doc.disallowedTools || [],
                    standardCompliant: doc.standardCompliant === true,
                    compatibilityWarnings: doc.compatibilityWarnings || [],
                    instructions: body.length > MAX_INSTRUCTION_CHARS ? body.slice(0, MAX_INSTRUCTION_CHARS) : body,
                    truncated: body.length > MAX_INSTRUCTION_CHARS,
                    totalChars: body.length,
                    nextOffset: body.length > MAX_INSTRUCTION_CHARS ? MAX_INSTRUCTION_CHARS : null
                }
            }
        }
    },
    {
        name: 'get_skill_info',
        description:
            '获取指定技能的说明，包括正文指令、触发词、允许/禁止的工具列表，以及该技能包内可供读取的附属文件清单。长正文通过 offset 和 nextOffset 分段完整读取。',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '技能名称'
                },
                offset: {
                    type: 'integer',
                    minimum: 0,
                    description: '正文起始字符偏移；用于继续读取被截断的长技能说明'
                },
                max_chars: {
                    type: 'integer',
                    minimum: 1,
                    maximum: MAX_INSTRUCTION_CHARS,
                    description: `本次最多返回字符数，默认 ${MAX_INSTRUCTION_CHARS}`
                }
            },
            required: ['name']
        },
        category: 'basic',
        handler: async args => {
            const checked = requireSkillName(args)
            if (!checked.ok) return checked.error

            const skillDocumentLoader = await getDocumentLoader()
            const doc = skillDocumentLoader.getDocumentByName(checked.name)
            if (!doc) {
                return { success: false, error: `技能 "${checked.name}" 不存在` }
            }

            const body = doc.body || ''
            const offset = Math.max(0, Math.floor(Number(args?.offset) || 0))
            const maxChars = Math.min(
                MAX_INSTRUCTION_CHARS,
                Math.max(1, Math.floor(Number(args?.max_chars) || MAX_INSTRUCTION_CHARS))
            )
            const end = Math.min(body.length, offset + maxChars)
            const truncated = end < body.length

            return {
                success: true,
                skill: {
                    name: doc.name,
                    description: doc.description,
                    triggers: doc.triggers,
                    allowedTools: doc.allowedTools,
                    disallowedTools: doc.disallowedTools,
                    capabilities: doc.capabilities || [],
                    priority: doc.priority || 0,
                    autoActivate: doc.autoActivate !== false,
                    type: doc.type,
                    path: doc.relativePath,
                    isPackage: doc.isPackage === true,
                    files: (doc.files || []).map(file => file.path),
                    fileManifest: (doc.files || []).map(file => ({
                        path: file.path,
                        dir: file.dir,
                        size: file.size,
                        textReadable: file.textReadable === true,
                        editable: file.editable === true,
                        downloadable: file.downloadable === true,
                        mimeType: file.mimeType || 'application/octet-stream'
                    })),
                    standardCompliant: doc.standardCompliant === true,
                    compatibilityWarnings: doc.compatibilityWarnings || [],
                    instructions: body.slice(offset, end),
                    offset,
                    totalChars: body.length,
                    nextOffset: truncated ? end : null,
                    truncated
                }
            }
        }
    },
    {
        name: 'list_skill_files',
        description:
            '列出指定技能包内可读取的附属文件（references/ 详细文档、assets/ 模板资源、scripts/ 脚本）。仅包形式的技能（含 SKILL.md 的目录）才有附属文件。',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '技能名称'
                }
            },
            required: ['name']
        },
        category: 'basic',
        handler: async args => {
            const checked = requireSkillName(args)
            if (!checked.ok) return checked.error

            const skillDocumentLoader = await getDocumentLoader()
            const doc = skillDocumentLoader.getDocumentByName(checked.name)
            if (!doc) {
                return { success: false, error: `技能 "${checked.name}" 不存在` }
            }
            if (!doc.isPackage) {
                return {
                    success: true,
                    skill: checked.name,
                    isPackage: false,
                    count: 0,
                    files: [],
                    message: '该技能是单文件形式，没有附属文件；完整说明请用 get_skill_info 获取'
                }
            }

            const files = (doc.files || []).map(file => ({
                path: file.path,
                dir: file.dir,
                size: file.size,
                textReadable: file.textReadable === true,
                editable: file.editable === true,
                downloadable: file.downloadable === true,
                mimeType: file.mimeType || 'application/octet-stream'
            }))
            return { success: true, skill: checked.name, isPackage: true, count: files.length, files }
        }
    },
    {
        name: 'read_skill_file',
        description:
            '读取技能包内由服务端确认为 UTF-8 文本的附属文件。路径取自 list_skill_files；textReadable=false 的二进制或超限文件会明确拒绝，不会作为乱码返回。当 SKILL.md 正文中引用文本附属文件时使用。',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '技能名称'
                },
                path: {
                    type: 'string',
                    description: '相对技能包根目录的文件路径，例如 references/output-format.md'
                }
            },
            required: ['name', 'path']
        },
        category: 'basic',
        handler: async args => {
            const checked = requireSkillName(args)
            if (!checked.ok) return checked.error

            const filePath = String(args?.path || '').trim()
            if (!filePath) {
                return { success: false, error: '文件路径不能为空' }
            }

            const skillDocumentLoader = await getDocumentLoader()
            const doc = skillDocumentLoader.getDocumentByName(checked.name)
            if (!doc) {
                return { success: false, error: `技能 "${checked.name}" 不存在` }
            }
            if (!doc.isPackage) {
                return { success: false, error: `技能 "${checked.name}" 是单文件形式，没有附属文件` }
            }

            const result = skillDocumentLoader.readPackageFile(checked.name, filePath)
            if (!result) {
                const available = (doc.files || []).filter(file => file.textReadable === true).map(file => file.path)
                return {
                    success: false,
                    error: `无法读取 "${filePath}"：该文件不在技能包的文本可读清单中`,
                    availableFiles: available
                }
            }
            if (result.ok === false) {
                return {
                    success: false,
                    errorCode: result.errorCode,
                    error: result.error,
                    path: filePath,
                    size: result.size,
                    mimeType: result.mimeType,
                    downloadable: (doc.files || []).find(file => file.path === filePath)?.downloadable === true
                }
            }

            return {
                success: true,
                skill: checked.name,
                path: result.path,
                size: result.size,
                content: result.content,
                mimeType: result.mimeType,
                editable: result.editable,
                downloadable: result.downloadable
            }
        }
    },
    {
        name: 'search_skills',
        description: '按名称、说明或触发词搜索本地 Agent Skills；先搜索再按需调用 get_skill_info 或 load_skill。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索词' },
                limit: { type: 'integer', description: '最多返回数量', minimum: 1, maximum: 50 }
            },
            required: ['query']
        },
        category: 'basic',
        handler: async args => {
            const loader = global.chatAiSkillsLoader
            if (!loader?.initialized) return { success: false, error: 'Skills 系统未初始化', skills: [] }
            const query = String(args?.query || '')
                .trim()
                .toLowerCase()
            if (!query) return { success: false, error: 'query 不能为空', skills: [] }
            const limit = Math.min(Math.max(Number(args?.limit) || 10, 1), 50)
            const skills = loader
                .getExposedSkillList()
                .map(skill => {
                    const name = String(skill.name || '')
                    const description = String(skill.description || '')
                    const triggers = Array.isArray(skill.triggers) ? skill.triggers : []
                    const fields = [name, description, ...triggers].map(value => String(value).toLowerCase())
                    let score = 0
                    if (name.toLowerCase() === query) score += 100
                    if (name.toLowerCase().includes(query)) score += 30
                    if (description.toLowerCase().includes(query)) score += 20
                    if (triggers.some(trigger => String(trigger).toLowerCase().includes(query))) score += 10
                    return { skill, score, matched: fields.some(value => value.includes(query)) }
                })
                .filter(item => item.matched)
                .sort((a, b) => b.score - a.score || String(a.skill.name).localeCompare(String(b.skill.name)))
                .slice(0, limit)
                .map(item => ({
                    name: item.skill.name,
                    description: item.skill.description,
                    triggers: item.skill.triggers,
                    loaded: loader.getLoadedSkillNames().includes(item.skill.name),
                    standardCompliant: item.skill.standardCompliant,
                    compatibilityWarnings: item.skill.compatibilityWarnings || []
                }))
            return { success: true, query: args.query, count: skills.length, skills }
        }
    },
    {
        name: 'unload_skill',
        description: '从后续对话提示中卸载已显式加载的技能。自动匹配技能不受此操作影响。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '技能名称' }
            },
            required: ['name']
        },
        category: 'basic',
        dangerous: true,
        requireMaster: true,
        handler: async (args, ctx) => {
            if (!isMasterContext(ctx)) return masterOnlyError()
            const checked = requireSkillName(args)
            if (!checked.ok) return checked.error
            const loader = global.chatAiSkillsLoader
            const unloaded = loader.unloadSkill(checked.name)
            return unloaded
                ? { success: true, name: checked.name, message: '技能已从显式加载列表卸载' }
                : { success: false, error: `技能 "${checked.name}" 未处于显式加载状态` }
        }
    },
    {
        name: 'reload_skills',
        description: '重新扫描 Skills 文档和所有工具注册表。仅主人可用，且需要开启危险工具。',
        inputSchema: { type: 'object', properties: {} },
        category: 'basic',
        dangerous: true,
        requireMaster: true,
        handler: async (_args, ctx) => {
            if (!isMasterContext(ctx)) return masterOnlyError()
            const loader = global.chatAiSkillsLoader
            if (!loader?.initialized) return { success: false, error: 'Skills 系统未初始化' }
            const result = await loader.reload()
            return {
                success: true,
                tools: loader.getTools().length,
                documents: loader.getSkillDocuments().length,
                loaded: loader.getLoadedSkillNames(),
                result
            }
        }
    },
    {
        name: 'create_custom_tool',
        description:
            '创建模型自定义 JavaScript 工具并原子热加载。handler_code 是 async run(args, ctx) 的函数体；业务动作必须使用 ctx.getApi()，消息段必须使用 ctx.message，不得通过旧 Bot/适配器接口自行区分协议。仅主人可用，且需要开启危险工具。可传 invoke_arguments 在同一轮立即执行新工具。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '工具名，仅允许字母、数字、下划线，且不能以数字开头' },
                description: { type: 'string', description: '工具能力与适用场景说明' },
                input_schema: { type: 'object', description: '参数 JSON Schema，type 必须为 object' },
                handler_code: {
                    type: 'string',
                    description:
                        'async run(args, ctx) 的函数体，必须显式 return；仅使用 ctx.getApi() 和 ctx.message 访问平台能力'
                },
                invoke_arguments: {
                    type: 'object',
                    description: '可选；创建并热加载成功后立即调用新工具的参数'
                }
            },
            required: ['name', 'description', 'input_schema', 'handler_code']
        },
        category: 'basic',
        dangerous: true,
        requireMaster: true,
        handler: async (args, ctx) => {
            if (!isMasterContext(ctx)) return masterOnlyError()
            const saved = await customToolService.saveTool({
                name: args.name,
                description: args.description,
                inputSchema: args.input_schema,
                handlerCode: args.handler_code,
                overwrite: false
            })
            let invocation
            if (args.invoke_arguments !== undefined) {
                invocation = await customToolService.invokeTool(saved.name, args.invoke_arguments, ctx)
            }
            return {
                ...saved,
                success: true,
                callableThisRound: true,
                immediateInvocation: invocation
            }
        }
    },
    {
        name: 'update_custom_tool',
        description:
            '覆盖更新模型自定义 JavaScript 工具并原子热加载；失败会恢复旧版本。仅主人可用，且需要开启危险工具。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '已存在的模型自定义工具名' },
                description: { type: 'string', description: '工具能力与适用场景说明' },
                input_schema: { type: 'object', description: '参数 JSON Schema，type 必须为 object' },
                handler_code: {
                    type: 'string',
                    description: 'async run(args, ctx) 的函数体；仅使用 ctx.getApi() 和 ctx.message 访问平台能力'
                },
                invoke_arguments: { type: 'object', description: '可选；更新后立即调用的参数' }
            },
            required: ['name', 'description', 'input_schema', 'handler_code']
        },
        category: 'basic',
        dangerous: true,
        requireMaster: true,
        handler: async (args, ctx) => {
            if (!isMasterContext(ctx)) return masterOnlyError()
            const saved = await customToolService.saveTool({
                name: args.name,
                description: args.description,
                inputSchema: args.input_schema,
                handlerCode: args.handler_code,
                overwrite: true
            })
            let invocation
            if (args.invoke_arguments !== undefined) {
                invocation = await customToolService.invokeTool(saved.name, args.invoke_arguments, ctx)
            }
            return {
                ...saved,
                success: true,
                callableThisRound: true,
                immediateInvocation: invocation
            }
        }
    },
    {
        name: 'invoke_custom_tool',
        description:
            '在当前工具调用链中立即执行已热加载的模型自定义工具，解决当前模型客户端工具列表尚未重建的问题。仅主人可用。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '已加载的模型自定义工具名' },
                arguments: { type: 'object', description: '传给目标工具的参数' }
            },
            required: ['name']
        },
        category: 'basic',
        dangerous: true,
        requireMaster: true,
        handler: async (args, ctx) => {
            if (!isMasterContext(ctx)) return masterOnlyError()
            return await customToolService.invokeTool(args.name, args.arguments || {}, ctx)
        }
    },
    {
        name: 'delete_custom_tool',
        description: '删除模型自定义 JavaScript 工具并热加载；失败会恢复原文件。仅主人可用。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '要删除的模型自定义工具名' }
            },
            required: ['name']
        },
        category: 'basic',
        dangerous: true,
        requireMaster: true,
        handler: async (args, ctx) => {
            if (!isMasterContext(ctx)) return masterOnlyError()
            return await customToolService.deleteTool(args.name)
        }
    }
]
