import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DATA_DIR = path.join(__dirname, '../../data')
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json')

/**
 * 预设/人设配置结构
 * @typedef {Object} Preset
 * @property {string} id - 唯一标识
 * @property {string} name - 预设名称
 * @property {string} description - 描述
 * @property {string} systemPrompt - 系统提示词
 * @property {string} [model] - 指定模型
 * @property {ModelParams} [modelParams] - 模型参数配置
 * @property {PersonaConfig} [persona] - 人设配置
 * @property {ContextConfig} [context] - 上下文配置
 * @property {ToolsConfig} [tools] - 工具配置
 */

/**
 * 模型参数配置
 * @typedef {Object} ModelParams
 * @property {number} [temperature] - 温度 (0-2)，控制输出随机性
 * @property {number} [top_p] - 核采样参数 (0-1)
 * @property {number} [top_k] - Top-K采样
 * @property {number} [max_tokens] - 最大输出token数
 * @property {number} [presence_penalty] - 存在惩罚 (-2 to 2)
 * @property {number} [frequency_penalty] - 频率惩罚 (-2 to 2)
 * @property {string[]} [stop] - 停止词列表
 */

/**
 * 人设配置
 * @typedef {Object} PersonaConfig
 * @property {string} [name] - 角色名称
 * @property {string} [avatar] - 头像URL
 * @property {string} [personality] - 性格特点
 * @property {string} [background] - 背景故事
 * @property {string} [speakingStyle] - 说话风格
 * @property {string[]} [traits] - 性格标签
 * @property {string[]} [likes] - 喜好
 * @property {string[]} [dislikes] - 厌恶
 * @property {Object} [customFields] - 自定义字段
 * @property {string} [documentPath] - 人格文档路径
 * @property {string} [documentContent] - 人格文档内容
 * @property {string} [acgCharacter] - ACG角色名称
 * @property {Object} [acgData] - ACG角色数据
 */

/**
 * 上下文配置
 * @typedef {Object} ContextConfig
 * @property {number} [maxMessages] - 最大消息数
 * @property {number} [maxTokens] - 最大token数
 * @property {boolean} [isolateContext] - 是否使用独立上下文（不与其他预设共享）
 * @property {boolean} [includeGroupContext] - 是否包含群聊上下文
 * @property {number} [groupContextLength] - 群聊上下文长度
 * @property {boolean} [clearOnSwitch] - 切换预设时是否清除上下文
 */

/**
 * 工具配置
 * @typedef {Object} ToolsConfig
 * @property {boolean} [enableBuiltinTools] - 启用内置工具
 * @property {boolean} [enableMcpTools] - 启用MCP工具
 * @property {string[]} [allowedTools] - 允许的工具列表
 * @property {string[]} [disabledTools] - 禁用的工具列表
 */

export class PresetManager {
    constructor() {
        this.presets = new Map()
        this.initialized = false
    }

    async init() {
        if (this.initialized) return

        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true })
        }

        await this.loadPresets()
        this.initialized = true
    }

    async loadPresets() {
        try {
            if (fs.existsSync(PRESETS_FILE)) {
                const data = fs.readFileSync(PRESETS_FILE, 'utf-8')
                const presets = JSON.parse(data)
                this.presets.clear()
                presets.forEach(p => this.presets.set(p.id, p))
            }
        } catch (err) {
            console.error('[PresetManager] Failed to load presets:', err)
        }

        // Ensure default preset exists
        if (!this.presets.has('default')) {
            this.presets.set('default', this.createDefaultPreset())
            await this.savePresets()
        }
    }

    /**
     * 创建默认预设
     */
    createDefaultPreset() {
        return {
            id: 'default',
            name: '默认预设',
            description: '通用助手预设',
            systemPrompt: '你是一个有帮助的AI助手。',
            model: '',
            modelParams: {
                temperature: 0.7,
                top_p: 0.9,
                max_tokens: 4096,
                presence_penalty: 0,
                frequency_penalty: 0
            },
            persona: {
                name: 'AI助手',
                personality: '友好、专业、乐于助人',
                speakingStyle: '礼貌、清晰、简洁',
                traits: ['helpful', 'friendly', 'professional'],
                likes: [],
                dislikes: [],
                customFields: {}
            },
            context: {
                maxMessages: 20,
                maxTokens: 8000,
                isolateContext: false,      // 是否使用独立上下文
                includeGroupContext: false,
                groupContextLength: 10,
                clearOnSwitch: false        // 切换预设时是否清除上下文
            },
            tools: {
                enableBuiltinTools: true,
                enableMcpTools: true,
                allowedTools: [],
                disabledTools: []
            }
        }
    }

    async savePresets() {
        try {
            const data = JSON.stringify(Array.from(this.presets.values()), null, 2)
            fs.writeFileSync(PRESETS_FILE, data, 'utf-8')
        } catch (err) {
            console.error('[PresetManager] Failed to save presets:', err)
        }
    }

    getAll() {
        return Array.from(this.presets.values())
    }

    get(id) {
        return this.presets.get(id)
    }

    async create(data) {
        const id = crypto.randomUUID()
        const defaultPreset = this.createDefaultPreset()
        const preset = {
            ...defaultPreset,
            ...data,
            id,
            name: data.name || '未命名预设',
            description: data.description || '',
            systemPrompt: data.systemPrompt || '',
            model: data.model || '',
            temperature: data.temperature ?? 0.7,
            persona: { ...defaultPreset.persona, ...data.persona },
            context: { ...defaultPreset.context, ...data.context },
            tools: { ...defaultPreset.tools, ...data.tools }
        }
        this.presets.set(id, preset)
        await this.savePresets()
        return preset
    }

    /**
     * 根据人设配置生成完整的系统提示词
     * @param {string} id 预设ID
     * @param {Object} context 上下文变量
     * @returns {string} 完整的系统提示词
     */
    buildSystemPrompt(id, context = {}) {
        const preset = this.get(id)
        if (!preset) return '你是一个有帮助的AI助手。'

        const parts = []

        // 基础系统提示词
        if (preset.systemPrompt) {
            parts.push(preset.systemPrompt)
        }

        // 人设信息
        const persona = preset.persona
        if (persona) {
            const personaParts = []

            if (persona.name) {
                personaParts.push(`你的名字是「${persona.name}」。`)
            }
            if (persona.personality) {
                personaParts.push(`你的性格特点：${persona.personality}。`)
            }
            if (persona.background) {
                personaParts.push(`你的背景故事：${persona.background}`)
            }
            if (persona.speakingStyle) {
                personaParts.push(`你的说话风格：${persona.speakingStyle}。`)
            }
            if (persona.traits && persona.traits.length > 0) {
                personaParts.push(`你的性格标签：${persona.traits.join('、')}。`)
            }
            if (persona.likes && persona.likes.length > 0) {
                personaParts.push(`你喜欢：${persona.likes.join('、')}。`)
            }
            if (persona.dislikes && persona.dislikes.length > 0) {
                personaParts.push(`你不喜欢：${persona.dislikes.join('、')}。`)
            }

            // 自定义字段
            if (persona.customFields) {
                for (const [key, value] of Object.entries(persona.customFields)) {
                    if (value) {
                        personaParts.push(`${key}：${value}`)
                    }
                }
            }

            // 人格文档内容
            if (persona.documentContent) {
                personaParts.push(`\n【角色详细设定】\n${persona.documentContent}`)
            } else if (persona.documentPath) {
                // 从文件加载
                try {
                    const docContent = this.loadDocumentContent(persona.documentPath)
                    if (docContent) {
                        personaParts.push(`\n【角色详细设定】\n${docContent}`)
                    }
                } catch (e) {
                    console.warn('[PresetManager] 加载人格文档失败:', e.message)
                }
            }

            // ACG角色数据
            if (persona.acgCharacter || persona.acgData) {
                const acgParts = this.buildAcgPersona(persona.acgCharacter, persona.acgData)
                if (acgParts) {
                    personaParts.push(acgParts)
                }
            }

            if (personaParts.length > 0) {
                parts.push('\n【角色设定】\n' + personaParts.join('\n'))
            }
        }

        let prompt = parts.join('\n\n')
        
        // 替换变量
        prompt = this.replaceVariables(prompt, context)
        
        return prompt
    }

    /**
     * 替换提示词中的变量
     * 支持的变量：
     * - {{user_name}} 用户名称
     * - {{user_id}} 用户ID
     * - {{group_name}} 群名称
     * - {{group_id}} 群ID
     * - {{bot_name}} 机器人名称
     * - {{date}} 当前日期
     * - {{time}} 当前时间
     * - {{datetime}} 当前日期时间
     * - {{weekday}} 星期几
     * @param {string} text 原始文本
     * @param {Object} context 上下文变量
     * @returns {string} 替换后的文本
     */
    replaceVariables(text, context = {}) {
        if (!text) return text
        
        const now = new Date()
        const weekdays = ['日', '一', '二', '三', '四', '五', '六']
        
        // 内置变量
        const builtinVars = {
            date: now.toLocaleDateString('zh-CN'),
            time: now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            datetime: now.toLocaleString('zh-CN'),
            weekday: `星期${weekdays[now.getDay()]}`,
            year: now.getFullYear().toString(),
            month: (now.getMonth() + 1).toString(),
            day: now.getDate().toString()
        }
        
        // 合并上下文变量
        const vars = { ...builtinVars, ...context }
        
        // 替换 {{variable}} 格式的变量
        return text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
            // 转换为 snake_case 查找
            const snakeName = varName.replace(/([A-Z])/g, '_$1').toLowerCase()
            return vars[varName] ?? vars[snakeName] ?? match
        })
    }

    /**
     * 获取预设的工具配置
     * @param {string} id 预设ID
     * @returns {ToolsConfig|null}
     */
    getToolsConfig(id) {
        const preset = this.get(id)
        return preset?.tools || null
    }

    /**
     * 获取预设的上下文配置
     * @param {string} id 预设ID
     * @returns {ContextConfig|null}
     */
    getContextConfig(id) {
        const preset = this.get(id)
        return preset?.context || null
    }

    async update(id, data) {
        if (!this.presets.has(id)) {
            throw new Error(`Preset not found: ${id}`)
        }
        const preset = this.presets.get(id)
        
        // 深度合并嵌套对象
        const updated = {
            ...preset,
            ...data,
            id, // Ensure ID doesn't change
            // 深度合并嵌套字段
            modelParams: { ...(preset.modelParams || {}), ...(data.modelParams || {}) },
            persona: { ...(preset.persona || {}), ...(data.persona || {}) },
            context: { ...(preset.context || {}), ...(data.context || {}) },
            tools: { ...(preset.tools || {}), ...(data.tools || {}) },
        }
        
        this.presets.set(id, updated)
        await this.savePresets()
        return updated
    }

    async delete(id) {
        if (id === 'default') {
            throw new Error('Cannot delete default preset')
        }
        if (this.presets.delete(id)) {
            await this.savePresets()
            return true
        }
        return false
    }

    /**
     * 加载人格文档内容
     * @param {string} docPath - 文档路径（相对于persona目录或绝对路径）
     * @returns {string|null}
     */
    loadDocumentContent(docPath) {
        if (!docPath) return null
        
        // 支持的文档目录
        const personaDir = path.join(DATA_DIR, 'persona')
        
        // 确保 persona 目录存在
        if (!fs.existsSync(personaDir)) {
            fs.mkdirSync(personaDir, { recursive: true })
        }
        
        // 尝试多种路径
        const possiblePaths = [
            docPath,                                    // 绝对路径
            path.join(personaDir, docPath),             // persona目录
            path.join(personaDir, `${docPath}.txt`),    // 添加.txt后缀
            path.join(personaDir, `${docPath}.md`),     // 添加.md后缀
            path.join(DATA_DIR, docPath)                // data目录
        ]
        
        for (const filePath of possiblePaths) {
            try {
                if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
                    const content = fs.readFileSync(filePath, 'utf-8')
                    console.log(`[PresetManager] 加载人格文档: ${filePath}`)
                    return content.trim()
                }
            } catch (e) {
                // 继续尝试下一个路径
            }
        }
        
        console.warn(`[PresetManager] 人格文档不存在: ${docPath}`)
        return null
    }

    /**
     * 构建ACG角色人设
     * @param {string} characterName - 角色名称
     * @param {Object} acgData - ACG角色数据
     * @returns {string|null}
     */
    buildAcgPersona(characterName, acgData = {}) {
        const parts = []
        
        if (characterName) {
            parts.push(`【ACG角色】你正在扮演「${characterName}」这个角色。`)
        }
        
        if (acgData) {
            // 作品信息
            if (acgData.series || acgData.anime || acgData.game) {
                const source = acgData.series || acgData.anime || acgData.game
                parts.push(`来源作品：${source}`)
            }
            
            // 角色属性
            if (acgData.gender) parts.push(`性别：${acgData.gender}`)
            if (acgData.age) parts.push(`年龄：${acgData.age}`)
            if (acgData.height) parts.push(`身高：${acgData.height}`)
            if (acgData.birthday) parts.push(`生日：${acgData.birthday}`)
            
            // 性格设定
            if (acgData.personality) {
                parts.push(`性格特点：${acgData.personality}`)
            }
            
            // 说话方式
            if (acgData.speech) {
                parts.push(`说话方式：${acgData.speech}`)
            }
            
            // 口头禅
            if (acgData.catchphrase) {
                parts.push(`口头禅：「${acgData.catchphrase}」`)
            }
            
            // 角色关系
            if (acgData.relationships && Array.isArray(acgData.relationships)) {
                const relParts = acgData.relationships.map(r => 
                    `${r.name}（${r.relation}）`
                ).join('、')
                parts.push(`人物关系：${relParts}`)
            }
            
            // 背景故事
            if (acgData.story) {
                parts.push(`背景故事：${acgData.story}`)
            }
            
            // 角色设定文档
            if (acgData.characterDocument) {
                parts.push(`\n【角色详细设定】\n${acgData.characterDocument}`)
            }
        }
        
        if (parts.length === 0) return null
        
        return '\n' + parts.join('\n')
    }

    /**
     * 创建ACG角色预设
     * @param {string} characterName - 角色名称
     * @param {Object} acgData - ACG角色数据
     * @returns {Promise<Object>}
     */
    async createAcgPreset(characterName, acgData = {}) {
        const systemPrompt = `你现在是${characterName}，请以该角色的身份、性格、语气进行对话。
始终保持角色特征，不要跳出角色。
回复时使用角色特有的语气和说话方式。`
        
        return this.create({
            name: `ACG-${characterName}`,
            description: `ACG角色扮演: ${characterName}`,
            systemPrompt,
            temperature: 0.8,  // 稍高的温度让角色更有活力
            persona: {
                name: characterName,
                acgCharacter: characterName,
                acgData: acgData
            }
        })
    }
}

export const presetManager = new PresetManager()
