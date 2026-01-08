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

// 并行初始化基础组件
const initTasks = []

// 1. 初始化 segment
initTasks.push((async () => {
  if (!global.segment) {
    try {
      global.segment = (await import('icqq')).segment
    } catch {
      global.segment = (await import('oicq')).segment
    }
  }
  return { name: 'Segment', status: 'ok' }
})())

// 2. 初始化配置
const dataDir = path.join(__dirname, 'data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}
config.startSync(dataDir)
let webServerPort = null
initTasks.push((async () => {
  const { getWebServer } = await import('./src/services/webServer.js')
  const webServer = getWebServer()
  const result = await webServer.start()
  webServerPort = result?.port || config.get('webServer.port') || 3000
  return { name: 'WebServer', status: 'ok', port: webServerPort }
})())
initTasks.push((async () => {
  try {
    const { mcpManager } = await import('./src/mcp/McpManager.js')
    await mcpManager.init()
    const toolCount = mcpManager.tools?.size || mcpManager.getTools({ applyConfig: false }).length || 0
    return { name: 'MCP', status: 'ok', toolCount }
  } catch (err) {
    chatLogger.error('MCP', '初始化失败:', err.message)
    return { name: 'MCP', status: 'fail', toolCount: 0, error: err.message }
  }
})())

const apps = {}
const loadStats = { success: 0, failed: 0, plugins: [], failedPlugins: [] }
const appsDir = path.join(__dirname, 'apps')
if (fs.existsSync(appsDir)) {
  const files = fs.readdirSync(appsDir).filter(file => file.endsWith('.js') && file !== 'update.js')
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
      loadStats.failedPlugins.push({ name, error: result.reason?.message || result.reason })
    }
  })
}
const initResults = await Promise.allSettled(initTasks)
const loadTime = Date.now() - startTime
const mcpResult = initResults.find(r => r.status === 'fulfilled' && r.value?.name === 'MCP')
const mcpToolCount = mcpResult?.value?.toolCount || 0
const webResult = initResults.find(r => r.status === 'fulfilled' && r.value?.name === 'WebServer')
const finalWebPort = webResult?.value?.port || webServerPort || config.get('webServer.port') || 3000

const statsItems = [
  { label: `${icons.module} 模块`, value: `${loadStats.success} 个`, color: c.green },
  { label: `${icons.tool} MCP工具`, value: `${mcpToolCount} 个`, color: c.cyan },
  { label: `${icons.web} Web服务`, value: `端口 ${finalWebPort}`, color: c.yellow },
  { label: `${icons.time} 耗时`, value: `${loadTime}ms`, color: c.gray }
]
if (loadStats.failed > 0) {
  statsItems.push({ label: `${icons.error} 失败`, value: `${loadStats.failed} 个`, color: c.red })
  loadStats.failedPlugins.forEach(p => {
    chatLogger.error('Plugin', `${p.name}: ${p.error}`)
  })
}
chatLogger.successBanner(`${pluginName} 加载完成`, statsItems)

export { apps }
