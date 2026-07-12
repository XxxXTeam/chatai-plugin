/**
 * @fileoverview Skills 内置工具
 * 允许模型动态查看和加载 skills
 */

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
                return JSON.stringify({ error: 'Skills 系统未初始化', skills: [] })
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

            return JSON.stringify({
                count: result.length,
                loaded: loadedNames.length,
                skills: result
            })
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
            const loader = global.chatAiSkillsLoader
            if (!loader?.initialized) {
                return JSON.stringify({ success: false, error: 'Skills 系统未初始化' })
            }

            const name = String(args.name || '').trim()
            if (!name) {
                return JSON.stringify({ success: false, error: '技能名称不能为空' })
            }

            const success = loader.loadSkill(name)
            if (!success) {
                return JSON.stringify({ success: false, error: `技能 "${name}" 不存在` })
            }

            const doc = loader.loadedSkills.get(name)
            return JSON.stringify({
                success: true,
                message: `技能 "${name}" 已加载，其指令将在后续对话中生效`,
                skill: {
                    name: doc?.name,
                    description: doc?.description,
                    allowedTools: doc?.allowedTools || [],
                    disallowedTools: doc?.disallowedTools || []
                }
            })
        }
    },
    {
        name: 'get_skill_info',
        description: '获取指定技能的详细信息，包括完整描述、触发词、允许/禁止的工具列表、指令内容等。',
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
            const loader = global.chatAiSkillsLoader
            if (!loader?.initialized) {
                return JSON.stringify({ success: false, error: 'Skills 系统未初始化' })
            }

            const name = String(args.name || '').trim()
            if (!name) {
                return JSON.stringify({ success: false, error: '技能名称不能为空' })
            }

            const { skillDocumentLoader } = await import('../../services/skills/SkillDocumentLoader.js')
            const doc = skillDocumentLoader.getDocumentByName(name)
            if (!doc) {
                return JSON.stringify({ success: false, error: `技能 "${name}" 不存在` })
            }

            return JSON.stringify({
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
                    instructions: doc.body ? doc.body.slice(0, 2000) : ''
                }
            })
        }
    }
]
