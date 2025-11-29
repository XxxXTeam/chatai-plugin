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
 * @property {number} [temperature] - 温度
 * @property {PersonaConfig} [persona] - 人设配置
 * @property {ContextConfig} [context] - 上下文配置
 * @property {ToolsConfig} [tools] - 工具配置
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
 */

/**
 * 上下文配置
 * @typedef {Object} ContextConfig
 * @property {number} [maxMessages] - 最大消息数
 * @property {number} [maxTokens] - 最大token数
 * @property {boolean} [includeGroupContext] - 是否包含群聊上下文
 * @property {number} [groupContextLength] - 群聊上下文长度
 */

/**
 * 工具配置
 * @typedef {Object} ToolsConfig
 * @property {boolean} [enableBuiltinTools] - 启用内置工具
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
            temperature: 0.7,
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
                includeGroupContext: false,
                groupContextLength: 10
            },
            tools: {
                enableBuiltinTools: true,
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
        const updated = { ...preset, ...data, id } // Ensure ID doesn't change
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
}

export const presetManager = new PresetManager()
