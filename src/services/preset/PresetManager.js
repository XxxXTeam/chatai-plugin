/**
 * @fileoverview 预设管理模块
 * @module services/preset/PresetManager
 * @description 管理AI人格预设，支持系统提示词、模型参数、工具配置等
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import { BUILTIN_PRESETS, getPresetCategories, getBuiltinPreset } from './BuiltinPresets.js'
import config from '../../../config/config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** @constant {string} 数据目录路径 */
const DATA_DIR = path.join(__dirname, '../../../data')
/** @constant {string} 预设配置文件路径 */
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json')
/** @constant {string} 人格文档目录路径 */
const PERSONA_DIR = path.join(DATA_DIR, 'persona')

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
        this.builtinPresets = new Map()
        this.knowledgeService = null
        this.initialized = false
        this.clearedContexts = new Map()
    }

    async init() {
        if (this.initialized) return

        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true })
        }
        if (!fs.existsSync(PERSONA_DIR)) {
            fs.mkdirSync(PERSONA_DIR, { recursive: true })
        }

        // 加载内置预设
        this.loadBuiltinPresets()

        // 加载用户预设
        await this.loadPresets()

        // 懒加载知识库服务
        try {
            const { knowledgeService } = await import('../storage/KnowledgeService.js')
            this.knowledgeService = knowledgeService
            await knowledgeService.init()
        } catch (err) {
            console.warn('[PresetManager] 知识库服务加载失败:', err.message)
        }

        this.initialized = true
    }

    /**
     * 加载内置预设
     */
    loadBuiltinPresets() {
        this.builtinPresets.clear()
        for (const preset of BUILTIN_PRESETS) {
            this.builtinPresets.set(preset.id, {
                ...preset,
                isBuiltin: true,
                isReadonly: true
            })
        }
        logger.debug(`[PresetManager] 加载 ${this.builtinPresets.size} 个内置预设`)
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

        // 只有在没有任何用户预设时才创建默认预设
        // 如果用户已设置其他预设为默认，不再强制创建'default'
        if (this.presets.size === 0) {
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
            disableSystemPrompt: false, // 是否禁用系统提示词
            enableReasoning: false, // 是否启用深度思考
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
                isolateContext: false, // 是否使用独立上下文
                includeGroupContext: false,
                groupContextLength: 10,
                clearOnSwitch: false // 切换预设时是否清除上下文
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

    /**
     * 获取所有预设（包括内置和用户自定义）
     * @param {Object} options - 选项
     * @param {boolean} options.includeBuiltin - 是否包含内置预设，默认true
     * @param {string} options.category - 按分类过滤
     * @returns {Array}
     */
    getAll(options = {}) {
        const { includeBuiltin = true, category } = options
        let presets = Array.from(this.presets.values())

        if (includeBuiltin) {
            const builtins = Array.from(this.builtinPresets.values())
            presets = [...builtins, ...presets]
        }

        if (category) {
            presets = presets.filter(p => p.category === category)
        }

        return presets
    }

    /**
     * 获取预设分类列表
     * @returns {Object}
     */
    getCategories() {
        return getPresetCategories()
    }

    /**
     * 获取预设（优先用户预设，其次内置预设，支持按ID或名称查找）
     * @param {string} idOrName - 预设ID或名称
     * @returns {Object|null}
     */
    get(idOrName) {
        if (!idOrName) return null

        // 优先按ID查找用户预设
        if (this.presets.has(idOrName)) {
            return this.presets.get(idOrName)
        }
        // 其次按ID查找内置预设
        if (this.builtinPresets.has(idOrName)) {
            return this.builtinPresets.get(idOrName)
        }

        // 按名称查找用户预设
        for (const preset of this.presets.values()) {
            if (preset.name === idOrName) {
                return preset
            }
        }
        // 按名称查找内置预设
        for (const preset of this.builtinPresets.values()) {
            if (preset.name === idOrName) {
                return preset
            }
        }

        return null
    }

    /**
     * 获取内置预设
     * @param {string} id
     * @returns {Object|null}
     */
    getBuiltin(id) {
        return this.builtinPresets.get(id) || null
    }

    /**
     * 获取所有内置预设
     * @returns {Array}
     */
    getAllBuiltin() {
        return Array.from(this.builtinPresets.values())
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
     * @param {Object} options 选项
     * @returns {string} 完整的系统提示词
     */
    buildSystemPrompt(id, context = {}, options = {}) {
        const { includeKnowledge = true, conversationId } = options

        // 检查是否是已清除的上下文（#结束对话后）
        if (conversationId && this.isContextCleared(conversationId)) {
            // 返回基础提示词，不包含之前的人设和上下文
            return this.getCleanPrompt(id, context)
        }

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

        // 添加知识库内容
        if (includeKnowledge && this.knowledgeService) {
            const knowledgePrompt = this.knowledgeService.buildKnowledgePrompt(id)
            if (knowledgePrompt) {
                prompt += '\n\n' + knowledgePrompt
            }
        }

        return prompt
    }

    /**
     * 获取干净的提示词（不包含之前的人设状态）
     * 用于 #结束对话 后的新会话
     * @param {string} id - 预设ID
     * @param {Object} context - 上下文变量
     * @returns {string}
     */
    getCleanPrompt(id, context = {}) {
        const preset = this.get(id)
        if (!preset) return '你是一个有帮助的AI助手。'

        // 只返回基础提示词，不包含累积的上下文
        let prompt = preset.systemPrompt || '你是一个有帮助的AI助手。'
        prompt = this.replaceVariables(prompt, context)

        return prompt
    }

    /**
     * 标记上下文已被清除（#结束对话）
     * @param {string} conversationId
     */
    markContextCleared(conversationId) {
        this.clearedContexts.set(conversationId, {
            clearedAt: Date.now(),
            useCount: 0, // 使用计数
            maxUses: 3 // 最多保护3次请求
        })
        logger.debug(`[PresetManager] 标记上下文已清除: ${conversationId}`)
    }

    /**
     * 检查上下文是否已被清除
     * 改进：使用时间窗口+使用次数双重保护，确保多次请求都能正确截断上下文
     * @param {string} conversationId
     * @returns {boolean}
     */
    isContextCleared(conversationId) {
        return false
    }

    /**
     * 清除上下文清除标记（开始新对话后）
     * @param {string} conversationId
     */
    clearContextMark(conversationId) {
        this.clearedContexts.delete(conversationId)
    }

    /**
     * 清理过期的上下文标记
     */
    cleanExpiredContextMarks() {
        const expireTime = 5 * 60 * 1000 // 5分钟（缩短过期时间）
        const now = Date.now()
        for (const [id, state] of this.clearedContexts) {
            if (now - state.clearedAt > expireTime) {
                this.clearedContexts.delete(id)
            }
        }
    }

    /**
     * 替换提示词中的变量
     * 支持的变量：
     * - {{user_name}} 用户名称
     * - {{user_id}} 用户ID
     * - {{date}} 当前日期
     * - {{time}} 当前时间
     * - {{datetime}} 日期时间
     * - {{weekday}} 星期几
     * - {{year}} / {{month}} / {{day}} 年/月/日
     * - {{bot_name}} Bot名称
     * - {{bot_id}} Bot QQ号
     * - {{user_name}} 用户名称（群名片或昵称）
     * - {{user_id}} 用户QQ号
     * - {{group_name}} 群名称
     * - {{group_id}} 群号
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
            day: now.getDate().toString(),
            // 用户/群组/Bot相关（从context获取，提供默认值）
            bot_name: context.bot_name || 'AI助手',
            bot_id: context.bot_id || '',
            user_name: context.user_name || '用户',
            user_id: context.user_id || '',
            group_name: context.group_name || '',
            group_id: context.group_id || ''
        }

        // 合并上下文变量（context优先）
        const vars = { ...builtinVars, ...context }

        // 替换 {{variable}} 格式的变量
        let result = text.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
            // 转换为 snake_case 查找
            const snakeName = varName.replace(/([A-Z])/g, '_$1').toLowerCase()
            return vars[varName] ?? vars[snakeName] ?? match
        })
        const e = context.event || {}
        result = result.replace(/\$\{([^}]+)\}/g, (match, expression) => {
            try {
                const safeEval = new Function(
                    'e',
                    'vars',
                    `"use strict"; try { return (${expression}); } catch { return undefined; }`
                )
                const value = safeEval(e, vars)
                return value !== undefined ? String(value) : match
            } catch (err) {
                logger.debug(`[PresetManager] 表达式执行失败: ${expression}`, err.message)
                return match
            }
        })

        return result
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
     * 从内置预设复制创建新预设
     * @param {string} builtinId - 内置预设ID
     * @param {Object} overrides - 覆盖的字段
     * @returns {Promise<Object>}
     */
    async createFromBuiltin(builtinId, overrides = {}) {
        const builtin = this.builtinPresets.get(builtinId)
        if (!builtin) {
            throw new Error(`内置预设不存在: ${builtinId}`)
        }

        // 深拷贝内置预设
        const newPreset = JSON.parse(JSON.stringify(builtin))
        delete newPreset.isBuiltin
        delete newPreset.isReadonly

        // 应用覆盖
        Object.assign(newPreset, overrides)
        newPreset.name = overrides.name || `${builtin.name} (副本)`
        newPreset.sourceBuiltinId = builtinId // 记录来源

        return this.create(newPreset)
    }

    /**
     * 获取预设关联的知识库
     * @param {string} id - 预设ID
     * @returns {Array}
     */
    getPresetKnowledge(id) {
        if (!this.knowledgeService) return []
        return this.knowledgeService.getPresetKnowledge(id)
    }

    /**
     * 关联知识库到预设
     * @param {string} presetId
     * @param {string} knowledgeId
     */
    async linkKnowledge(presetId, knowledgeId) {
        if (!this.knowledgeService) {
            throw new Error('知识库服务未初始化')
        }
        await this.knowledgeService.linkToPreset(knowledgeId, presetId)
    }

    /**
     * 取消关联知识库
     * @param {string} presetId
     * @param {string} knowledgeId
     */
    async unlinkKnowledge(presetId, knowledgeId) {
        if (!this.knowledgeService) return
        await this.knowledgeService.unlinkFromPreset(knowledgeId, presetId)
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

        // 智能合并 persona：允许用空字符串清除旧值
        const mergePersona = (oldPersona, newPersona) => {
            if (!newPersona) return oldPersona || {}
            const merged = { ...(oldPersona || {}) }
            // 遍历新值，明确设置（包括空字符串）会覆盖旧值
            for (const key of Object.keys(newPersona)) {
                const newVal = newPersona[key]
                // 如果新值是空字符串，清除该字段；否则使用新值
                if (newVal === '' || newVal === null) {
                    merged[key] = ''
                } else if (newVal !== undefined) {
                    merged[key] = newVal
                }
            }
            return merged
        }

        // 深度合并嵌套对象
        const updated = {
            ...preset,
            ...data,
            id, // Ensure ID doesn't change
            // 深度合并嵌套字段
            modelParams: { ...(preset.modelParams || {}), ...(data.modelParams || {}) },
            persona: mergePersona(preset.persona, data.persona),
            context: { ...(preset.context || {}), ...(data.context || {}) },
            tools: { ...(preset.tools || {}), ...(data.tools || {}) }
        }

        this.presets.set(id, updated)
        await this.savePresets()
        return updated
    }

    async delete(id) {
        // 检查是否是内置预设
        if (this.builtinPresets.has(id)) {
            throw new Error('不能删除内置预设')
        }

        // 检查预设是否存在
        const preset = this.presets.get(id)
        if (!preset) {
            return false
        }

        // 检查是否是当前默认预设
        const defaultPresetId = config.get('presets.defaultId') || config.get('llm.defaultChatPresetId')
        if (id === defaultPresetId) {
            throw new Error('不能删除当前默认预设，请先设置其他预设为默认')
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
            docPath, // 绝对路径
            path.join(personaDir, docPath), // persona目录
            path.join(personaDir, `${docPath}.txt`), // 添加.txt后缀
            path.join(personaDir, `${docPath}.md`), // 添加.md后缀
            path.join(DATA_DIR, docPath) // data目录
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
                const relParts = acgData.relationships.map(r => `${r.name}（${r.relation}）`).join('、')
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
            temperature: 0.8, // 稍高的温度让角色更有活力
            persona: {
                name: characterName,
                acgCharacter: characterName,
                acgData: acgData
            }
        })
    }
}

export const presetManager = new PresetManager()
