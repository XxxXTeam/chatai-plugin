import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './config/config.js'
import { chatLogger, c, icons } from './src/core/utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pluginName = 'ChatAI'
const pluginVersion = '1.0.0'
const startTime = Date.now()

chatLogger.banner(`${pluginName} v${pluginVersion}`, '正在加载...')
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

            chatLogger.info(
                'Skills',
                `初始化完成: ${skillCount} 个技能 (内置: ${builtinCount}, 自定义: ${customCount}, MCP: ${mcpToolCount}), ${categoryCount} 个类别`
            )
            return {
                name: 'Skills',
                status: 'ok',
                skillCount,
                categoryCount,
                mcpServerCount,
                builtinCount,
                customCount,
                mcpToolCount
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
    return Promise.allSettled(files.map(file => import(`./apps/${file}`).then(mod => ({ file, mod }))))
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
            loadStats.failedPlugins.push({ name: 'unknown', error: result.reason?.message || result.reason })
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
const statsItems = [
    { label: `${icons.module} 模块`, value: `${loadStats.success} 个`, color: c.green },
    { label: `${icons.tool} 技能`, value: `${skillCount} 个`, color: c.cyan },
    { label: `${icons.web} Web服务`, value: `端口 ${finalWebPort}`, color: c.yellow },
    { label: `${icons.time} 耗时`, value: `${loadTime}ms`, color: c.gray }
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
chatLogger.successBanner(`${pluginName} 加载完成`, statsItems)
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
