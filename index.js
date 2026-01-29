import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './config/config.js'
import { chatLogger, c, icons } from './src/core/utils/logger.js'
import { telemetryService } from './src/services/telemetry/index.js'
import { getFullVersionInfo } from './src/utils/version.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pluginName = 'ChatAI'
const versionInfo = getFullVersionInfo()
const pluginVersion = versionInfo.displayVersion
const startTime = Date.now()

chatLogger.banner(`${pluginName} ${pluginVersion}`, '正在加载...')
const initTasks = []
initTasks.push(
    (async () => {
        if (!global.segment) {
            try {
                global.segment = (await import('icqq')).segment
            } catch {
                global.segment = (await import('oicq')).segment
            }
        }
        return { name: 'Segment', status: 'ok' }
    })()
)
const dataDir = path.join(__dirname, 'data')
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
}
config.startSync(dataDir)
global.chatgptPluginConfig = config
let webServerPort = null
initTasks.push(
    (async () => {
        const { getWebServer } = await import('./src/services/webServer.js')
        const webServer = getWebServer()
        const result = await webServer.start()
        webServerPort = result?.port || config.get('webServer.port') || 3000
        return { name: 'WebServer', status: 'ok', port: webServerPort }
    })()
)
initTasks.push(
    (async () => {
        try {
            const result = await telemetryService.init({
                pluginName,
                version: pluginVersion,
                branch: versionInfo.branch,
                commit: versionInfo.commit
            })

            // 检查版本更新
            try {
                const versionCheck = await telemetryService.checkVersion()
                if (versionCheck.success && versionCheck.hasUpdate) {
                    result.versionUpdate = {
                        hasUpdate: true,
                        currentVersion: versionCheck.currentVersion,
                        latestVersion: versionCheck.latestVersion,
                        repoUrl: versionCheck.repoUrl,
                        isPublic: versionCheck.isPublic
                    }
                }
            } catch (err) {
                chatLogger.debug('Telemetry', '版本检查失败:', err.message)
            }

            return {
                name: 'Telemetry',
                status: result.success ? 'ok' : 'warn',
                globalStartups: result.globalStartups || 0,
                announcements: result.announcements || [],
                versionUpdate: result.versionUpdate
            }
        } catch (err) {
            return { name: 'Telemetry', status: 'warn', error: err.message, globalStartups: 0 }
        }
    })()
)
initTasks.push(
    (async () => {
        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 3000) // 3秒超时
            const res = await fetch('https://v1.openel.top/', { signal: controller.signal })
            clearTimeout(timeout)
            const data = await res.json()
            return { name: 'Hitokoto', status: 'ok', data }
        } catch (err) {
            return { name: 'Hitokoto', status: 'warn', error: err.message }
        }
    })()
)
initTasks.push(
    (async () => {
        try {
            // 初始化 Skills 配置和加载器
            const { initSkillsModule } = await import('./src/services/skills/index.js')
            const skillsModule = await initSkillsModule(__dirname)
            global.chatAiSkillsConfig = skillsModule.config
            global.chatAiSkillsLoader = skillsModule.loader

            // 创建默认 SkillsAgent 实例
            const { createSkillsAgent, SkillsAgent } = await import('./src/services/agent/index.js')
            const defaultAgent = await createSkillsAgent({})
            const skillCount = defaultAgent.skills?.size || 0
            const categoryCount = defaultAgent.categories?.size || 0
            const mcpServerCount = defaultAgent.mcpServerTools?.size || 0
            const bySource = defaultAgent.getSkillsBySource()
            const builtinCount = bySource.builtin?.length || 0
            const customCount = bySource.custom?.length || 0
            const mcpToolCount = Object.values(bySource.mcp || {}).flat().length
            global.chatAiSkillsAgent = defaultAgent
            global.ChatAiSkillsAgent = SkillsAgent

            const mode = skillsModule.config.getMode()
            chatLogger.info(
                'Skills',
                `初始化完成: ${skillCount} 个技能 (内置: ${builtinCount}, 自定义: ${customCount}, MCP: ${mcpToolCount}), ${categoryCount} 个类别, mode=${mode}`
            )
            return {
                name: 'Skills',
                status: 'ok',
                skillCount,
                categoryCount,
                mcpServerCount,
                builtinCount,
                customCount,
                mcpToolCount,
                mode
            }
        } catch (err) {
            chatLogger.error('Skills', '初始化失败:', err.message)
            return { name: 'Skills', status: 'fail', error: err.message }
        }
    })()
)

const apps = {}
const loadStats = { success: 0, failed: 0, plugins: [], failedPlugins: [] }
const appsDir = path.join(__dirname, 'apps')
const appsPromise = (async () => {
    if (!fs.existsSync(appsDir)) return []
    const files = fs.readdirSync(appsDir).filter(file => file.endsWith('.js') && file !== 'update.js')
    return Promise.allSettled(
        files.map(async file => {
            try {
                const mod = await import(`./apps/${file}`)
                return { file, mod }
            } catch (err) {
                // 记录具体文件名的错误
                throw { file, error: err }
            }
        })
    )
})()
const [appsResults, ...initResults] = await Promise.all([appsPromise, ...initTasks])
if (Array.isArray(appsResults)) {
    for (const result of appsResults) {
        if (result.status === 'fulfilled') {
            const { file, mod } = result.value
            const name = file.replace('.js', '')
            apps[name] = mod[Object.keys(mod)[0]]
            loadStats.success++
            loadStats.plugins.push(name)
        } else {
            loadStats.failed++
            const reason = result.reason
            const fileName = reason?.file || 'unknown'
            const errorMsg = reason?.error?.message || reason?.message || String(reason)
            loadStats.failedPlugins.push({ name: fileName.replace('.js', ''), error: errorMsg })
            chatLogger.warn('Plugin', `跳过加载 ${fileName}: ${errorMsg}`)
        }
    }
}
const loadTime = Date.now() - startTime
const skillsResult = initResults.find(r => r?.name === 'Skills')
const skillCount = skillsResult?.skillCount || 0
const builtinCount = skillsResult?.builtinCount || 0
const customCount = skillsResult?.customCount || 0
const mcpServerCount = skillsResult?.mcpServerCount || 0
const webResult = initResults.find(r => r?.name === 'WebServer')
const finalWebPort = webResult?.port || webServerPort || config.get('webServer.port') || 3000
const telemetryResult = initResults.find(r => r?.name === 'Telemetry')
const globalStartups = telemetryResult?.globalStartups || 0
const announcements = telemetryResult?.announcements || []
const hitokotoResult = initResults.find(r => r?.name === 'Hitokoto')
const statsItems = [
    { label: `${icons.module} 模块`, value: `${loadStats.success} 个`, color: c.green },
    { label: `${icons.tool} 技能`, value: `${skillCount} 个`, color: c.cyan },
    { label: `${icons.web} Web服务`, value: `端口 ${finalWebPort}`, color: c.yellow },
    { label: `🌐 插件全网累计启动`, value: `${globalStartups} 次`, color: c.magenta },
    { label: `${icons.time} 耗时`, value: `${loadTime}ms`, color: c.gray },
    ...(hitokotoResult?.status === 'ok' && hitokotoResult.data
        ? [
              {
                  label: `${hitokotoResult.data.hitokoto || hitokotoResult.data.content || hitokotoResult.data.text}`,
                  value: hitokotoResult.data.from || hitokotoResult.data.source || '',
                  color: c.white
              }
          ]
        : [])
]
if (mcpServerCount > 0) {
    statsItems.splice(2, 0, { label: `🔌 MCP服务器`, value: `${mcpServerCount} 个`, color: c.magenta })
}
if (loadStats.failed > 0) {
    statsItems.push({ label: `${icons.error} 失败`, value: `${loadStats.failed} 个`, color: c.red })
    loadStats.failedPlugins.forEach(p => {
        chatLogger.error('Plugin', `${p.name}: ${p.error}`)
    })
}
chatLogger.successBanner(`${pluginName} ${pluginVersion} 加载完成`, statsItems)

if (announcements.length > 0) {
    for (const ann of announcements) {
        const icon = ann.type === 'warning' ? '⚠️' : ann.type === 'update' ? '🆕' : 'ℹ️'
        chatLogger.info('公告', `${icon} ${ann.title}: ${ann.content}`)
    }
}

// 显示版本更新信息
if (telemetryResult?.versionUpdate?.hasUpdate) {
    const update = telemetryResult.versionUpdate
    const repoType = update.isPublic ? '公开仓库' : '内测仓库'
    chatLogger.info(
        '版本更新',
        `🆕 发现新版本! 当前: ${update.currentVersion} -> 最新: ${update.latestVersion} (${repoType})`
    )
}
let _skillsModule = null
async function loadSkillsModule() {
    if (!_skillsModule) {
        _skillsModule = await import('./src/services/agent/index.js')
    }
    return _skillsModule
}

const skills = {
    // 获取全局实例
    get agent() {
        return global.chatAiSkillsAgent
    },
    get SkillsAgent() {
        return _skillsModule?.SkillsAgent || global.ChatAiSkillsAgent
    },

    // Skills 配置和加载器
    get config() {
        return global.chatAiSkillsConfig
    },
    get loader() {
        return global.chatAiSkillsLoader
    },

    // 核心方法
    async createSkillsAgent(options = {}) {
        const mod = await loadSkillsModule()
        return await mod.createSkillsAgent(options)
    },
    async getAllTools(options = {}) {
        if (global.chatAiSkillsAgent) return global.chatAiSkillsAgent.getExecutableSkills()
        const mod = await loadSkillsModule()
        return await mod.getAllTools(options)
    },
    async executeTool(toolName, args, context, options = {}) {
        if (global.chatAiSkillsAgent) return await global.chatAiSkillsAgent.execute(toolName, args)
        const mod = await loadSkillsModule()
        return await mod.executeTool(toolName, args, context, options)
    },

    // 别名
    async getTools(options = {}) {
        return await this.getAllTools(options)
    },
    async execute(toolName, args, context, options = {}) {
        return await this.executeTool(toolName, args, context, options)
    },

    // Skills 配置方法
    getMode() {
        return global.chatAiSkillsConfig?.getMode() || 'hybrid'
    },
    isEnabled() {
        return global.chatAiSkillsConfig?.isEnabled() !== false
    },
    getGroups() {
        return global.chatAiSkillsConfig?.getGroups() || []
    },
    getEnabledGroups() {
        return global.chatAiSkillsConfig?.getEnabledGroups() || []
    },
    async updateConfig(updates) {
        if (global.chatAiSkillsConfig) {
            await global.chatAiSkillsConfig.update(updates)
        }
    },
    async reloadConfig() {
        if (global.chatAiSkillsConfig) {
            await global.chatAiSkillsConfig.reload()
        }
        if (global.chatAiSkillsLoader) {
            await global.chatAiSkillsLoader.reload()
        }
    },

    // MCP服务器管理
    async getMcpServers() {
        const mod = await loadSkillsModule()
        return mod.getMcpServers()
    },
    async connectMcpServer(name, config) {
        const mod = await loadSkillsModule()
        return await mod.connectMcpServer(name, config)
    },
    async disconnectMcpServer(name) {
        const mod = await loadSkillsModule()
        return await mod.disconnectMcpServer(name)
    },

    // 工具管理
    async getToolCategories() {
        const mod = await loadSkillsModule()
        return mod.getToolCategories()
    },
    async toggleTool(toolName, enabled) {
        const mod = await loadSkillsModule()
        return await mod.toggleTool(toolName, enabled)
    },
    async reloadAllTools() {
        const mod = await loadSkillsModule()
        return await mod.reloadAllTools()
    },

    async init() {
        await loadSkillsModule()
        return this
    }
}
loadSkillsModule().catch(() => {})

export { apps, skills }
