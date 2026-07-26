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
 * @returns {{ok: true, name: string}|{ok: false, error: object}} 校验结果
 */
function requireSkillName(args) {
    if (!global.chatAiSkillsLoader?.initialized) {
        return { ok: false, error: { success: false, error: 'Skills 系统未初始化' } }
    }
    const name = String(args?.name || '').trim()
    if (!name) {
        return { ok: false, error: { success: false, error: '技能名称不能为空' } }
    }
    return { ok: true, name }
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
                triggers: s.triggers
            }))

            return { success: true, count: result.length, loaded: loadedNames.length, skills: result }
        }
    },
    {
        name: 'load_skill',
        description:
            '加载指定的技能(skill)到当前会话。加载后，技能的指令和约束将在后续对话中生效。使用前请先调用 list_skills 了解可用技能。',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '要加载的技能名称（从 list_skills 返回的 name 字段获取）'
                }
            },
            required: ['name']
        },
        category: 'basic',
        handler: async args => {
            const checked = requireSkillName(args)
            if (!checked.ok) return checked.error

            const loader = global.chatAiSkillsLoader
            if (!loader.loadSkill(checked.name)) {
                return { success: false, error: `技能 "${checked.name}" 不存在` }
            }

            const doc = loader.loadedSkills.get(checked.name)
            return {
                success: true,
                message: `技能 "${checked.name}" 已加载，其指令将在后续对话中生效`,
                skill: {
                    name: doc?.name,
                    description: doc?.description,
                    allowedTools: doc?.allowedTools || [],
                    disallowedTools: doc?.disallowedTools || []
                }
            }
        }
    },
    {
        name: 'get_skill_info',
        description:
            '获取指定技能的完整说明，包括正文指令、触发词、允许/禁止的工具列表，以及该技能包内可供读取的附属文件清单。当系统提示词中的技能元数据显示某技能与当前任务相关时，用本工具取得完整说明。',
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

            const body = doc.body || ''
            const truncated = body.length > MAX_INSTRUCTION_CHARS

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
                    instructions: truncated ? body.slice(0, MAX_INSTRUCTION_CHARS) : body,
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
                size: file.size
            }))
            return { success: true, skill: checked.name, isPackage: true, count: files.length, files }
        }
    },
    {
        name: 'read_skill_file',
        description:
            '读取技能包内的某个附属文件内容。路径取自 list_skill_files 或 get_skill_info 返回的 files 字段，只能读取该技能包内已收录的文件。当 SKILL.md 正文中引用了某个附属文件时使用。',
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
                const available = (doc.files || []).map(file => file.path)
                return {
                    success: false,
                    error: `无法读取 "${filePath}"：该文件不在技能包的可读清单中，或超出大小上限`,
                    availableFiles: available
                }
            }

            return {
                success: true,
                skill: checked.name,
                path: result.path,
                size: result.size,
                content: result.content
            }
        }
    }
]
