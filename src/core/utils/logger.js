import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'

const icons = {
    success: '✓',
    error: '✗',
    warn: '⚠',
    info: '●',
    debug: '○',
    arrow: '→',
    dot: '•',
    star: '★',
    check: '✔',
    cross: '✘',
    loading: '◐',
    plugin: '◆',
    module: '▸',
    time: '⏱',
    memory: '🧠',
    api: '🔌',
    web: '🌐',
    tool: '🛠',
    chat: '💬',
    image: '🖼',
    audio: '🔊',
    file: '📄',
    folder: '📁',
    database: '💾',
    cache: '📦',
    config: '⚙',
    user: '👤',
    group: '👥',
    bot: '🤖',
    sparkle: '✨'
}

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m'
}

const c = colors
const LOG_LEVELS = {
    debug: { color: c.gray, label: `${c.gray}${icons.debug} DBG${c.reset}`, icon: icons.debug, priority: 0 },
    info: { color: c.cyan, label: `${c.cyan}${icons.info} INF${c.reset}`, icon: icons.info, priority: 1 },
    warn: { color: c.yellow, label: `${c.yellow}${icons.warn} WRN${c.reset}`, icon: icons.warn, priority: 2 },
    error: { color: c.red, label: `${c.red}${icons.error} ERR${c.reset}`, icon: icons.error, priority: 3 },
    success: { color: c.green, label: `${c.green}${icons.success} OK ${c.reset}`, icon: icons.success, priority: 1 },
    mark: { color: c.magenta, label: `${c.magenta}${icons.star} MRK${c.reset}`, icon: icons.star, priority: 4 }
}

// 日志级别优先级映射（与 log4js 兼容）
const LEVEL_PRIORITY = {
    trace: 0,
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    fatal: 4,
    mark: 4
}

// 缓存日志级别（避免重复读取配置）
let cachedLogLevel = null

/*
 * 记录初始化失败原因。
 * 本模块在加载期执行，此时框架 logger 尚未就绪，无法直接输出；
 * 原实现的空 catch 会让"日志级别静默回落默认值"完全无迹可循。
 * 因此先暂存，待框架 logger 可用时由 getFrameworkLogLevel 补报一次。
 */
let logLevelInitError = null
let logLevelInitErrorReported = false

/**
 * 框架日志级别配置文件路径
 * Yunzai 将 bot.yaml 置于 <root>/config/config/ 下；用 path.join 拼接以兼容不同平台的分隔符
 * @returns {string} bot.yaml 的绝对路径
 */
function getFrameworkConfigPath() {
    return path.join(process.cwd(), 'config', 'config', 'bot.yaml')
}

/**
 * 初始化时同步读取框架配置中的日志级别
 * @returns {void}
 */
function initLogLevel() {
    if (cachedLogLevel !== null) return
    const configPath = getFrameworkConfigPath()
    try {
        if (fs.existsSync(configPath)) {
            const content = fs.readFileSync(configPath, 'utf-8')
            const config = yaml.parse(content)
            if (config?.log_level) {
                const level = config.log_level.toLowerCase()
                if (LEVEL_PRIORITY[level] !== undefined) {
                    cachedLogLevel = LEVEL_PRIORITY[level]
                }
            }
        }
    } catch (err) {
        logLevelInitError = `读取 ${configPath} 失败: ${err.message}`
    }
}
initLogLevel()

/**
 * 获取框架当前的日志级别优先级
 * @returns {number} LEVEL_PRIORITY 中的优先级数值，无法确定时返回 info 级
 */
function getFrameworkLogLevel() {
    // 首次拿到可用的框架 logger 时补报初始化失败原因，避免级别回落无从排查
    if (logLevelInitError && !logLevelInitErrorReported && typeof logger !== 'undefined' && logger?.debug) {
        logLevelInitErrorReported = true
        try {
            logger.debug(`[ChatAI][日志] 框架日志级别读取失败，已回落默认级别 - ${logLevelInitError}`)
        } catch {
            /* 框架 logger 尚不可用，放弃补报 */
        }
    }
    if (cachedLogLevel !== null) {
        return cachedLogLevel
    }
    try {
        if (typeof logger !== 'undefined' && logger.logger?.defaultLogger?.level) {
            const level = logger.logger.defaultLogger.level.levelStr?.toLowerCase()
            if (level && LEVEL_PRIORITY[level] !== undefined) {
                cachedLogLevel = LEVEL_PRIORITY[level]
                return cachedLogLevel
            }
        }
    } catch {}
    return 1
}

/**
 * 检查是否应该输出该级别的日志
 */
function shouldLog(level) {
    const levelConfig = LOG_LEVELS[level]
    if (!levelConfig) return true
    const frameworkLevel = getFrameworkLogLevel()
    return levelConfig.priority >= frameworkLevel
}

const PLUGIN_NAME = 'ChatAI'

/**
 * 格式化时间
 */
function formatTime() {
    const now = new Date()
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    const s = String(now.getSeconds()).padStart(2, '0')
    const ms = String(now.getMilliseconds()).padStart(3, '0')
    return `${h}:${m}:${s}.${ms}`
}

/**
 * 格式化日志消息
 */
function formatMessage(level, tag, ...args) {
    const config = LOG_LEVELS[level] || LOG_LEVELS.info
    const time = formatTime()
    const tagStr = tag ? `${c.gray}[${c.reset}${c.brightCyan}${tag}${c.reset}${c.gray}]${c.reset}` : ''

    // 格式化参数
    const message = args
        .map(arg => {
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2)
                } catch {
                    return String(arg)
                }
            }
            return String(arg)
        })
        .join(' ')

    return `${c.gray}${time}${c.reset} ${config.label} ${c.gray}[${c.reset}${c.brightMagenta}${PLUGIN_NAME}${c.reset}${c.gray}]${c.reset}${tagStr} ${config.color}${message}${c.reset}`
}
class ChatAILogger {
    constructor(defaultTag = '') {
        this.defaultTag = defaultTag
    }

    /**
     * 创建带标签的子logger
     */
    tag(tagName) {
        return new ChatAILogger(tagName)
    }

    debug(tag, ...args) {
        if (!shouldLog('debug')) return
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('debug', tag, ...args))
        } else {
            console.log(formatMessage('debug', this.defaultTag, tag, ...args))
        }
    }

    info(tag, ...args) {
        if (!shouldLog('info')) return
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('info', tag, ...args))
        } else {
            console.log(formatMessage('info', this.defaultTag, tag, ...args))
        }
    }

    warn(tag, ...args) {
        if (!shouldLog('warn')) return
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('warn', tag, ...args))
        } else {
            console.log(formatMessage('warn', this.defaultTag, tag, ...args))
        }
    }

    error(tag, ...args) {
        if (!shouldLog('error')) return
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('error', tag, ...args))
        } else {
            console.log(formatMessage('error', this.defaultTag, tag, ...args))
        }
    }

    success(tag, ...args) {
        if (!shouldLog('success')) return
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('success', tag, ...args))
        } else {
            console.log(formatMessage('success', this.defaultTag, tag, ...args))
        }
    }

    mark(tag, ...args) {
        if (!shouldLog('mark')) return
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('mark', tag, ...args))
        } else {
            console.log(formatMessage('mark', this.defaultTag, tag, ...args))
        }
    }

    /**
     * 打印分隔线
     */
    line(char = '─', length = 50) {
        console.log(`${c.gray}${char.repeat(length)}${c.reset}`)
    }

    /**
     * 打印标题横幅
     */
    banner(title, subtitle = '') {
        const line = `${c.gray}${'─'.repeat(50)}${c.reset}`
        console.log('')
        console.log(line)
        console.log(`${c.bright}${c.cyan}  ${title}${c.reset}${subtitle ? ` ${c.gray}${subtitle}${c.reset}` : ''}`)
        console.log(line)
    }

    /**
     * 打印列表项
     */
    item(label, value, color = c.cyan) {
        console.log(`${c.gray}    ➜${c.reset}  ${c.bright}${label}:${c.reset} ${color}${value}${c.reset}`)
    }

    /**
     * 打印成功横幅
     */
    successBanner(title, items = []) {
        const line = `${c.gray}${'─'.repeat(50)}${c.reset}`
        console.log('')
        console.log(line)
        console.log(`${c.bright}${c.green}  ${icons.success} ${title}${c.reset}`)
        if (items.length > 0) {
            console.log(line)
            for (const item of items) {
                if (typeof item === 'string') {
                    console.log(`${c.gray}    ${icons.arrow}${c.reset}  ${item}`)
                } else if (item.value === '') {
                    console.log(`  ${c.bright}${item.color || c.white}${item.label}${c.reset}`)
                } else {
                    console.log(`  ${c.gray}${item.label}${c.reset}  ${item.color || c.cyan}${item.value}${c.reset}`)
                }
            }
        }
        console.log(line)
        console.log('')
    }
    moduleLoad(moduleName, status = 'ok', detail = '') {
        const icon =
            status === 'ok'
                ? `${c.green}${icons.check}${c.reset}`
                : status === 'skip'
                  ? `${c.gray}${icons.dot}${c.reset}`
                  : `${c.red}${icons.cross}${c.reset}`
        const detailStr = detail ? ` ${c.gray}${detail}${c.reset}` : ''
        console.log(`  ${icon} ${c.cyan}${moduleName}${c.reset}${detailStr}`)
    }

    /**
     * 打印加载进度
     */
    loadProgress(current, total, name) {
        const percent = Math.round((current / total) * 100)
        const bar = this.progressBar(percent, 20)
        console.log(`  ${c.gray}[${bar}]${c.reset} ${c.cyan}${name}${c.reset}`)
    }

    /**
     * 生成进度条
     */
    progressBar(percent, width = 20) {
        const filled = Math.round((width * percent) / 100)
        const empty = width - filled
        return `${c.green}${'█'.repeat(filled)}${c.reset}${c.gray}${'░'.repeat(empty)}${c.reset}`
    }

    /**
     * 打印统计卡片
     */
    statsCard(title, stats = {}) {
        const line = `${c.gray}${'─'.repeat(40)}${c.reset}`
        console.log('')
        console.log(`  ${c.bright}${c.cyan}${icons.sparkle} ${title}${c.reset}`)
        console.log(`  ${line}`)
        for (const [key, value] of Object.entries(stats)) {
            const icon = this.getStatIcon(key)
            console.log(`  ${icon} ${c.gray}${key}:${c.reset} ${c.white}${value}${c.reset}`)
        }
        console.log('')
    }

    /**
     * 获取统计项图标
     */
    getStatIcon(key) {
        const lower = key.toLowerCase()
        if (lower.includes('模块') || lower.includes('module')) return icons.module
        if (lower.includes('工具') || lower.includes('tool')) return icons.tool
        if (lower.includes('渠道') || lower.includes('channel')) return icons.api
        if (lower.includes('预设') || lower.includes('preset')) return icons.config
        if (lower.includes('耗时') || lower.includes('time')) return icons.time
        if (lower.includes('缓存') || lower.includes('cache')) return icons.cache
        if (lower.includes('数据') || lower.includes('data')) return icons.database
        return icons.dot
    }

    /**
     * 打印服务启动信息
     */
    serviceStart(name, port = null, extra = '') {
        const portStr = port ? ` ${c.yellow}:${port}${c.reset}` : ''
        const extraStr = extra ? ` ${c.gray}${extra}${c.reset}` : ''
        console.log(`  ${c.green}${icons.success}${c.reset} ${c.bright}${name}${c.reset}${portStr}${extraStr}`)
    }

    /**
     * 打印错误横幅
     */
    errorBanner(title, message = '') {
        const line = `${c.gray}${'─'.repeat(50)}${c.reset}`
        console.log('')
        console.log(line)
        console.log(`${c.bright}${c.red}  ✗ ${title}${c.reset}`)
        if (message) {
            console.log(`${c.gray}    ${message}${c.reset}`)
        }
        console.log(line)
        console.log('')
    }

    /**
     * 打印警告横幅
     */
    warnBanner(title, items = []) {
        const line = `${c.yellow}${'═'.repeat(50)}${c.reset}`
        console.log('')
        console.log(line)
        console.log(`${c.bright}${c.yellow}  ⚠ ${title}${c.reset}`)
        if (items.length > 0) {
            for (const item of items) {
                console.log(`${c.yellow}    ${item}${c.reset}`)
            }
        }
        console.log(line)
        console.log('')
    }
}

// 导出单例和颜色常量
export const chatLogger = new ChatAILogger()
export { colors, c, icons }
export default chatLogger
