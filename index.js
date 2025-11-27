import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './config/config.js'
import { getWebServer } from './src/services/webServer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

logger.info('**************************************')
logger.info('加载中...')

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

const apps = {}

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
    } else {
      logger.error(`[NewPlugin] Failed to load app ${name}:`, result.reason)
    }
  })
}

logger.info(' 加载成功')
logger.info('**************************************')

export { apps }
