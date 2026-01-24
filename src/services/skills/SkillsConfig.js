/**
 * SkillsConfig - Skills 模块配置管理器
 *
 * 负责加载、管理和验证 skills.yaml 配置文件
 * 提供配置热重载和默认值处理功能
 */

import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

// 默认配置
const DEFAULT_CONFIG = {
    skills: {
        enabled: true,
        mode: 'hybrid',
        sources: {
            builtin: {
                enabled: true,
                categories: [],
                disabledTools: []
            },
            custom: {
                enabled: true,
                path: 'data/tools',
                autoReload: true
            },
            mcp: {
                enabled: true,
                servers: [],
                disabledServers: []
            }
        },
        groups: [],
        execution: {
            timeout: 30000,
            maxParallel: 5,
            retryOnError: false,
            maxRetries: 2,
            cacheResults: true,
            cacheTTL: 60000
        },
        dispatch: {
            enabled: true,
            useSummary: true,
            maxGroups: 3
        },
        security: {
            dangerousTools: ['kick_member', 'mute_member', 'recall_message', 'set_group_admin', 'write_file'],
            allowDangerous: false,
            dangerousRequiredPermission: 'admin'
        }
    }
}

class SkillsConfig {
    constructor() {
        this.config = null
        this.configPath = null
        this.lastModified = null
        this.watchers = new Set()
        this.initialized = false
    }

    /**
     * 初始化配置
     * @param {string} pluginRoot - 插件根目录
     */
    async init(pluginRoot) {
        if (this.initialized) return this

        this.pluginRoot = pluginRoot
        this.configPath = path.join(pluginRoot, 'data', 'skills.yaml')

        await this.load()
        this.initialized = true

        logger.info('[SkillsConfig] 配置初始化完成')
        return this
    }

    /**
     * 加载配置文件
     */
    async load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const content = fs.readFileSync(this.configPath, 'utf-8')
                const parsed = YAML.parse(content)
                this.config = this._mergeWithDefaults(parsed)
                this.lastModified = fs.statSync(this.configPath).mtime

                logger.debug(`[SkillsConfig] 已加载配置: mode=${this.config.skills.mode}`)
            } else {
                // 配置文件不存在，使用默认配置并创建文件
                this.config = { ...DEFAULT_CONFIG }
                await this._createDefaultConfig()
                logger.info('[SkillsConfig] 使用默认配置并创建 skills.yaml')
            }

            this._validateConfig()
        } catch (error) {
            logger.error('[SkillsConfig] 加载配置失败:', error)
            this.config = { ...DEFAULT_CONFIG }
        }
    }

    /**
     * 合并用户配置与默认配置
     */
    _mergeWithDefaults(userConfig) {
        const merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG))

        if (!userConfig || !userConfig.skills) {
            return merged
        }

        const skills = userConfig.skills

        // 合并顶层属性
        if (skills.enabled !== undefined) merged.skills.enabled = skills.enabled
        if (skills.mode) merged.skills.mode = skills.mode

        // 合并 sources
        if (skills.sources) {
            if (skills.sources.builtin) {
                Object.assign(merged.skills.sources.builtin, skills.sources.builtin)
            }
            if (skills.sources.custom) {
                Object.assign(merged.skills.sources.custom, skills.sources.custom)
            }
            if (skills.sources.mcp) {
                Object.assign(merged.skills.sources.mcp, skills.sources.mcp)
            }
        }

        // 合并 groups（完全替换）
        if (Array.isArray(skills.groups)) {
            merged.skills.groups = skills.groups
        }

        // 合并 execution
        if (skills.execution) {
            Object.assign(merged.skills.execution, skills.execution)
        }

        // 合并 dispatch
        if (skills.dispatch) {
            Object.assign(merged.skills.dispatch, skills.dispatch)
        }

        // 合并 security
        if (skills.security) {
            Object.assign(merged.skills.security, skills.security)
        }

        return merged
    }

    /**
     * 验证配置有效性
     */
    _validateConfig() {
        const skills = this.config.skills

        // 验证 mode
        const validModes = ['hybrid', 'skills-only', 'mcp-only']
        if (!validModes.includes(skills.mode)) {
            logger.warn(`[SkillsConfig] 无效的 mode: ${skills.mode}，使用默认值 'hybrid'`)
            skills.mode = 'hybrid'
        }

        // 验证 execution 参数
        if (skills.execution.timeout < 1000) {
            logger.warn('[SkillsConfig] timeout 太小，设置为最小值 1000ms')
            skills.execution.timeout = 1000
        }
        if (skills.execution.maxParallel < 1) {
            skills.execution.maxParallel = 1
        }
        if (skills.execution.maxParallel > 20) {
            logger.warn('[SkillsConfig] maxParallel 太大，设置为最大值 20')
            skills.execution.maxParallel = 20
        }

        // 验证 groups
        for (const group of skills.groups) {
            if (!group.name) {
                logger.warn('[SkillsConfig] 工具组缺少 name 字段')
            }
            if (!Array.isArray(group.tools)) {
                group.tools = []
            }
        }
    }

    /**
     * 创建默认配置文件
     */
    async _createDefaultConfig() {
        try {
            const dir = path.dirname(this.configPath)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }

            const yamlContent = YAML.stringify(DEFAULT_CONFIG, {
                indent: 2,
                lineWidth: 0
            })

            // 添加注释头
            const contentWithComments = `# Skills 模块配置
# 此文件定义了技能系统的独立配置，与 MCP 服务器配置解耦
# 详细说明请参考文档

${yamlContent}`

            fs.writeFileSync(this.configPath, contentWithComments, 'utf-8')
        } catch (error) {
            logger.error('[SkillsConfig] 创建默认配置文件失败:', error)
        }
    }

    /**
     * 重新加载配置
     */
    async reload() {
        await this.load()
        this._notifyWatchers()
        logger.info('[SkillsConfig] 配置已重新加载')
    }

    /**
     * 检查配置文件是否已修改
     */
    hasChanged() {
        if (!fs.existsSync(this.configPath)) return false

        const currentMtime = fs.statSync(this.configPath).mtime
        return currentMtime > this.lastModified
    }

    /**
     * 添加配置变更监听器
     */
    addWatcher(callback) {
        this.watchers.add(callback)
        return () => this.watchers.delete(callback)
    }

    /**
     * 通知所有监听器
     */
    _notifyWatchers() {
        for (const watcher of this.watchers) {
            try {
                watcher(this.config)
            } catch (error) {
                logger.error('[SkillsConfig] 监听器回调失败:', error)
            }
        }
    }

    // ========== 配置获取方法 ==========

    /**
     * 获取完整配置
     */
    getConfig() {
        return this.config?.skills || DEFAULT_CONFIG.skills
    }

    /**
     * 判断 Skills 模块是否启用
     */
    isEnabled() {
        return this.config?.skills?.enabled !== false
    }

    /**
     * 获取工作模式
     */
    getMode() {
        return this.config?.skills?.mode || 'hybrid'
    }

    /**
     * 获取工具源配置
     */
    getSources() {
        return this.config?.skills?.sources || DEFAULT_CONFIG.skills.sources
    }

    /**
     * 判断内置工具是否启用
     */
    isBuiltinEnabled() {
        const mode = this.getMode()
        if (mode === 'mcp-only') return false
        return this.config?.skills?.sources?.builtin?.enabled !== false
    }

    /**
     * 判断自定义工具是否启用
     */
    isCustomEnabled() {
        const mode = this.getMode()
        if (mode === 'mcp-only') return false
        return this.config?.skills?.sources?.custom?.enabled !== false
    }

    /**
     * 判断 MCP 工具是否启用
     */
    isMcpEnabled() {
        const mode = this.getMode()
        if (mode === 'skills-only') return false
        return this.config?.skills?.sources?.mcp?.enabled !== false
    }

    /**
     * 获取启用的内置工具类别
     */
    getEnabledCategories() {
        return this.config?.skills?.sources?.builtin?.categories || []
    }

    /**
     * 获取禁用的工具列表
     */
    getDisabledTools() {
        return this.config?.skills?.sources?.builtin?.disabledTools || []
    }

    /**
     * 获取自定义工具路径
     */
    getCustomToolsPath() {
        const relativePath = this.config?.skills?.sources?.custom?.path || 'data/tools'
        return path.join(this.pluginRoot, relativePath)
    }

    /**
     * 获取启用的 MCP 服务器列表
     */
    getEnabledMcpServers() {
        return this.config?.skills?.sources?.mcp?.servers || []
    }

    /**
     * 获取禁用的 MCP 服务器列表
     */
    getDisabledMcpServers() {
        return this.config?.skills?.sources?.mcp?.disabledServers || []
    }

    /**
     * 获取工具组配置
     */
    getGroups() {
        return this.config?.skills?.groups || []
    }

    /**
     * 获取启用的工具组
     */
    getEnabledGroups() {
        return this.getGroups().filter(g => g.enabled !== false)
    }

    /**
     * 根据索引获取工具组
     */
    getGroupByIndex(index) {
        return this.getGroups().find(g => g.index === index)
    }

    /**
     * 根据名称获取工具组
     */
    getGroupByName(name) {
        return this.getGroups().find(g => g.name === name)
    }

    /**
     * 获取执行配置
     */
    getExecutionConfig() {
        return this.config?.skills?.execution || DEFAULT_CONFIG.skills.execution
    }

    /**
     * 获取调度配置
     */
    getDispatchConfig() {
        return this.config?.skills?.dispatch || DEFAULT_CONFIG.skills.dispatch
    }

    /**
     * 获取安全配置
     */
    getSecurityConfig() {
        return this.config?.skills?.security || DEFAULT_CONFIG.skills.security
    }

    /**
     * 判断工具是否为危险工具
     */
    isDangerousTool(toolName) {
        const dangerousTools = this.config?.skills?.security?.dangerousTools || []
        return dangerousTools.includes(toolName)
    }

    /**
     * 判断是否允许执行危险工具
     */
    allowDangerous() {
        return this.config?.skills?.security?.allowDangerous === true
    }

    /**
     * 获取危险工具所需权限
     */
    getDangerousRequiredPermission() {
        return this.config?.skills?.security?.dangerousRequiredPermission || 'admin'
    }

    // ========== 配置修改方法 ==========

    /**
     * 更新配置
     * @param {Object} updates - 要更新的配置项
     */
    async update(updates) {
        if (!updates || typeof updates !== 'object') return

        // 深度合并更新
        this._deepMerge(this.config.skills, updates)
        this._validateConfig()

        // 保存到文件
        await this._saveConfig()
        this._notifyWatchers()

        logger.info('[SkillsConfig] 配置已更新')
    }

    /**
     * 深度合并对象
     */
    _deepMerge(target, source) {
        for (const key of Object.keys(source)) {
            if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                if (!target[key]) target[key] = {}
                this._deepMerge(target[key], source[key])
            } else {
                target[key] = source[key]
            }
        }
    }

    /**
     * 保存配置到文件
     */
    async _saveConfig() {
        try {
            const yamlContent = YAML.stringify(this.config, {
                indent: 2,
                lineWidth: 0
            })

            const contentWithComments = `# Skills 模块配置
# 此文件定义了技能系统的独立配置，与 MCP 服务器配置解耦

${yamlContent}`

            fs.writeFileSync(this.configPath, contentWithComments, 'utf-8')
            this.lastModified = fs.statSync(this.configPath).mtime
        } catch (error) {
            logger.error('[SkillsConfig] 保存配置失败:', error)
            throw error
        }
    }

    /**
     * 启用/禁用工具组
     */
    async toggleGroup(name, enabled) {
        const group = this.getGroupByName(name)
        if (group) {
            group.enabled = enabled
            await this._saveConfig()
            this._notifyWatchers()
        }
    }

    /**
     * 添加工具到禁用列表
     */
    async disableTool(toolName) {
        const disabledTools = this.getDisabledTools()
        if (!disabledTools.includes(toolName)) {
            disabledTools.push(toolName)
            await this._saveConfig()
            this._notifyWatchers()
        }
    }

    /**
     * 从禁用列表移除工具
     */
    async enableTool(toolName) {
        const disabledTools = this.config.skills.sources.builtin.disabledTools
        const index = disabledTools.indexOf(toolName)
        if (index !== -1) {
            disabledTools.splice(index, 1)
            await this._saveConfig()
            this._notifyWatchers()
        }
    }
}

// 单例实例
export const skillsConfig = new SkillsConfig()

export default SkillsConfig
