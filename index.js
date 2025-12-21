import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './config/config.js'
import { getWebServer } from './src/services/webServer.js'
import { chatLogger, c } from './src/core/utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pluginName = 'ChatAI'
const pluginVersion = '1.0.0'
chatLogger.banner(`${pluginName} v${pluginVersion}`, '正在加载...')

// Initialize global object if needed
if (!global.segment) {
  try {
    global.segment = (await import('icqq')).segment
  } catch (err) {
    global.segment = (await import('oicq')).segment
  }
}

// Initialize configuration
const dataDir = path.join(__dirname, 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}
config.startSync(dataDir)
const webServer = getWebServer()
webServer.start()
let mcpToolCount = 0
let mcpCustomToolCount = 0
;(async () => {
  try {
    const { mcpManager } = await import('./src/mcp/McpManager.js')
    await mcpManager.init()
    mcpToolCount = mcpManager.builtinServer?.tools?.length || 0
    mcpCustomToolCount = mcpManager.customToolsServer?.tools?.length || 0
  } catch (err) {
    chatLogger.error('MCP', '初始化失败:', err.message)
  }
})()

const apps = {}
const loadStats = { success: 0, failed: 0, plugins: [] }

// Load apps
const appsDir = path.join(__dirname, 'apps')
if (fs.existsSync(appsDir)) {
  const files = fs.readdirSync(appsDir).filter(file => file.endsWith('.js'))

  const loadedApps = await Promise.allSettled(files.map(file => import(`./apps/${file}`)))

  files.forEach((file, index) => {
    const name = file.replace('.js', '')
    const result = loadedApps[index]

    if (result.status === 'fulfilled') {
      apps[name] = result.value[Object.keys(result.value)[0]]
      loadStats.success++
      loadStats.plugins.push(name)
    } else {
      loadStats.failed++
      chatLogger.error('Plugin', `加载失败 ${name}:`, result.reason?.message || result.reason)
    }
  })
}

const statsItems = [
  { label: '已加载', value: `${loadStats.success} 个模块`, color: c.green },
  { label: '模块列表', value: loadStats.plugins.join(', '), color: c.cyan }
]
if (loadStats.failed > 0) {
  statsItems.push({ label: '加载失败', value: `${loadStats.failed} 个`, color: c.red })
}
chatLogger.successBanner(`${pluginName} 加载完成`, statsItems)

export { apps }
