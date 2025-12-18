import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './config/config.js'
import { getWebServer } from './src/services/webServer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 颜色日志
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
}

const pluginName = 'Chaite-AI'
const pluginVersion = '1.0.0'

// 居中显示的启动横幅
const bannerWidth = 36
const title = `${pluginName} v${pluginVersion}`
const padding = Math.max(0, Math.floor((bannerWidth - title.length) / 2))
const paddedTitle = ' '.repeat(padding) + title + ' '.repeat(bannerWidth - title.length - padding)

logger.info(`${colors.cyan}╔${'═'.repeat(bannerWidth)}╗${colors.reset}`)
logger.info(`${colors.cyan}║${colors.reset}${colors.bright}${colors.magenta}${paddedTitle}${colors.reset}${colors.cyan}║${colors.reset}`)
logger.info(`${colors.cyan}╚${'═'.repeat(bannerWidth)}╝${colors.reset}`)

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

// Start web server
const webServer = getWebServer()
webServer.start()

// 异步初始化 MCP（不阻塞插件加载）
let mcpToolCount = 0
let mcpCustomToolCount = 0
;(async () => {
  try {
    const { mcpManager } = await import('./src/mcp/McpManager.js')
    await mcpManager.init()
    mcpToolCount = mcpManager.builtinServer?.tools?.length || 0
    mcpCustomToolCount = mcpManager.customToolsServer?.tools?.length || 0
  } catch (err) {
    logger.error(`${colors.red}[MCP] 初始化失败:${colors.reset}`, err.message)
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
      logger.error(`${colors.red}[Plugin] 加载失败 ${name}:${colors.reset}`, result.reason?.message || result.reason)
    }
  })
}

// 输出加载统计
logger.info(`${colors.green}[Plugin]${colors.reset} 加载完成: ${colors.bright}${loadStats.success}${colors.reset} 个插件`)
if (loadStats.failed > 0) {
  logger.warn(`${colors.yellow}[Plugin]${colors.reset} 加载失败: ${colors.red}${loadStats.failed}${colors.reset} 个`)
}
logger.info(`${colors.cyan}════════════════════════════════════${colors.reset}`)

export { apps }
