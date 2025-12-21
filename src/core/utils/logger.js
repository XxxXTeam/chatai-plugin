/**
 * ChatAI 美化日志工具
 * 统一插件的日志输出风格
 */

// ANSI 颜色码
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    
    // 前景色
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    
    // 亮色
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    
    // 背景色
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m'
}

const c = colors

// 日志级别配置
const LOG_LEVELS = {
    debug: { color: c.gray, label: `${c.gray}DEBUG${c.reset}` },
    info: { color: c.cyan, label: `${c.cyan}INFO ${c.reset}` },
    warn: { color: c.yellow, label: `${c.yellow}WARN ${c.reset}` },
    error: { color: c.red, label: `${c.red}ERROR${c.reset}` },
    success: { color: c.green, label: `${c.green}OK   ${c.reset}` },
    mark: { color: c.magenta, label: `${c.magenta}MARK ${c.reset}` }
}

// 插件名称
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
    const message = args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2)
            } catch {
                return String(arg)
            }
        }
        return String(arg)
    }).join(' ')
    
    return `${c.gray}${time}${c.reset} ${config.label} ${c.gray}[${c.reset}${c.brightMagenta}${PLUGIN_NAME}${c.reset}${c.gray}]${c.reset}${tagStr} ${config.color}${message}${c.reset}`
}

/**
 * 美化日志类
 */
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
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('debug', tag, ...args))
        } else {
            console.log(formatMessage('debug', this.defaultTag, tag, ...args))
        }
    }

    info(tag, ...args) {
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('info', tag, ...args))
        } else {
            console.log(formatMessage('info', this.defaultTag, tag, ...args))
        }
    }

    warn(tag, ...args) {
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('warn', tag, ...args))
        } else {
            console.log(formatMessage('warn', this.defaultTag, tag, ...args))
        }
    }

    error(tag, ...args) {
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('error', tag, ...args))
        } else {
            console.log(formatMessage('error', this.defaultTag, tag, ...args))
        }
    }

    success(tag, ...args) {
        if (typeof tag === 'string' && args.length > 0) {
            console.log(formatMessage('success', tag, ...args))
        } else {
            console.log(formatMessage('success', this.defaultTag, tag, ...args))
        }
    }

    mark(tag, ...args) {
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
        console.log(`${c.bright}${c.green}  ✓ ${title}${c.reset}`)
        if (items.length > 0) {
            console.log(line)
            for (const item of items) {
                if (typeof item === 'string') {
                    console.log(`${c.gray}    ➜${c.reset}  ${item}`)
                } else if (item.value === '') {
                    // 标题项（无值）
                    console.log(`  ${c.bright}${item.color || c.white}${item.label}${c.reset}`)
                } else {
                    // 带值的项
                    console.log(`  ${c.gray}${item.label}${c.reset}  ${item.color || c.cyan}${item.value}${c.reset}`)
                }
            }
        }
        console.log(line)
        console.log('')
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
export { colors, c }
export default chatLogger

