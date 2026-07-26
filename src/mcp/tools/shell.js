/**
 * Shell 命令执行工具
 * 支持执行 shell 命令、获取环境信息等
 *
 * 注意：这是一个危险工具，需要在配置中显式允许
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execAsync = promisify(exec)

/** execute_command 默认超时（毫秒） */
const DEFAULT_COMMAND_TIMEOUT_MS = 30000

/** execute_command 超时上限（毫秒），防止长时间占用工具调用 */
const MAX_COMMAND_TIMEOUT_MS = 300000

/** execute_command 输出缓冲上限（字节） */
const COMMAND_MAX_BUFFER = 1024 * 1024 * 10

/** read_env 单次返回的变量数量上限 */
const MAX_ENV_VARS = 50

/**
 * 危险命令黑名单
 * 说明：这是尽力而为的兜底防护，真正的边界是 execute_command 的主人权限校验
 */
const DANGEROUS_COMMAND_PATTERNS = [
    // rm 删除根目录：覆盖 -rf / -fr / -r -f / --recursive --force / rm / 等写法，以及 /*
    /\brm\s+(?:-{1,2}[^\s]+\s+)*\/(?:\s|$|\*)/i,
    // 任何显式关闭根目录保护的命令
    /--no-preserve-root/i,
    /\bmkfs(\.\w+)?\b/i,
    /\bdd\s+if=/i,
    />\s*\/dev\/(sd|nvme|hd|vd)/i,
    /\bchmod\s+(-[^\s]+\s+)*777\s+\/(?:\s|$)/i,
    /\bchown\s+(-[^\s]+\s+)*[^\s]+\s+\/(?:\s|$)/i,
    // fork bomb :(){ :|:& };:  （原实现未转义元字符，实际从不命中）
    /:\s*\(\s*\)\s*\{[^}]*\|[^}]*&[^}]*\}\s*;?\s*:/,
    // 关机 / 重启（限定出现在命令起始位置，避免误伤普通文本中的同名单词）
    /(^|[;&|]\s*)(sudo\s+)?(shutdown|reboot|halt|poweroff)\b/i,
    /(^|[;&|]\s*)(sudo\s+)?init\s+0\b/i,
    // Windows 格式化与强制删除
    /\bformat\s+[a-z]:/i,
    /\bdel\s+\/[fqs]\s+[a-z]:\\/i,
    /\brd\s+\/s\s+\/q\s+[a-z]:\\/i
]

/**
 * 敏感环境变量匹配规则（命中则不返回值）
 */
const SENSITIVE_ENV_PATTERNS = [
    /pass/i, // PASSWORD / DB_PASS / PASSPHRASE
    /secret/i,
    /token/i,
    /key/i,
    /credential/i,
    /auth/i,
    /private/i,
    /cert/i,
    /salt/i,
    /signature/i,
    /session/i,
    /cookie/i,
    /webhook/i,
    /license/i,
    // 连接串类：DATABASE_URL / REDIS_URL / MONGO_URI / POSTGRES_DSN 等
    /(database|db|redis|mongo|mongodb|postgres|postgresql|mysql|mariadb|mssql|clickhouse|elastic|amqp|rabbitmq|kafka|s3|oss)_?(url|uri|dsn|conn|connection)/i,
    /connection_?string/i,
    /\bdsn\b/i,
    /npm_config/i
]

export const shellTools = [
    {
        name: 'execute_command',
        description: '执行 Shell 命令。这是一个危险操作，仅限主人使用，支持执行系统命令并返回输出结果。',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: '要执行的命令'
                },
                cwd: {
                    type: 'string',
                    description: '工作目录，默认为插件目录'
                },
                timeout: {
                    type: 'number',
                    description: `超时时间（毫秒），默认 ${DEFAULT_COMMAND_TIMEOUT_MS}，上限 ${MAX_COMMAND_TIMEOUT_MS}`,
                    minimum: 1,
                    maximum: MAX_COMMAND_TIMEOUT_MS
                }
            },
            required: ['command']
        },
        dangerous: true,
        requireMaster: true, // 标记需要主人权限
        handler: async (args, context) => {
            // 主人权限检查
            if (!context?.event?.isMaster) {
                return {
                    success: false,
                    error: '权限不足：execute_command 仅限主人使用'
                }
            }

            const { command, cwd } = args
            const timeout = Math.min(
                Math.max(Number(args.timeout) || DEFAULT_COMMAND_TIMEOUT_MS, 1),
                MAX_COMMAND_TIMEOUT_MS
            )
            // 解释器固定为平台默认，不接受调用方指定，避免绕开命令黑名单
            const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash'

            for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
                if (pattern.test(command)) {
                    return {
                        success: false,
                        error: '检测到危险命令，已拒绝执行'
                    }
                }
            }

            try {
                const workDir = cwd || process.cwd()
                const { stdout, stderr } = await execAsync(command, {
                    cwd: workDir,
                    timeout,
                    shell,
                    maxBuffer: COMMAND_MAX_BUFFER,
                    env: { ...process.env, LANG: 'en_US.UTF-8' }
                })

                return {
                    success: true,
                    command,
                    cwd: workDir,
                    stdout: stdout.trim() || '(无输出)',
                    stderr: stderr.trim() || null,
                    exitCode: 0
                }
            } catch (error) {
                return {
                    success: false,
                    command,
                    error: error.message,
                    stdout: error.stdout?.trim() || null,
                    stderr: error.stderr?.trim() || null,
                    exitCode: error.code || 1,
                    killed: error.killed || false,
                    signal: error.signal || null
                }
            }
        }
    },

    {
        name: 'get_system_info',
        description: '获取系统信息，包括操作系统、CPU、内存、磁盘等',
        inputSchema: {
            type: 'object',
            properties: {
                detailed: {
                    type: 'boolean',
                    description: '是否返回详细信息'
                }
            }
        },
        handler: async args => {
            const detailed = args.detailed ?? false

            const info = {
                platform: os.platform(),
                arch: os.arch(),
                hostname: os.hostname(),
                release: os.release(),
                uptime: formatUptime(os.uptime()),
                memory: {
                    total: formatBytes(os.totalmem()),
                    free: formatBytes(os.freemem()),
                    used: formatBytes(os.totalmem() - os.freemem()),
                    usagePercent: ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1) + '%'
                },
                cpu: {
                    model: os.cpus()[0]?.model || 'Unknown',
                    cores: os.cpus().length,
                    loadavg: os.loadavg().map(l => l.toFixed(2))
                },
                user: os.userInfo().username,
                home: os.homedir(),
                tmpdir: os.tmpdir()
            }

            if (detailed) {
                info.cpus = os.cpus().map((cpu, i) => ({
                    core: i,
                    model: cpu.model,
                    speed: cpu.speed + ' MHz'
                }))
                info.network = Object.entries(os.networkInterfaces())
                    .filter(([name]) => !name.startsWith('lo'))
                    .map(([name, addrs]) => ({
                        name,
                        addresses: addrs.filter(a => a.family === 'IPv4').map(a => a.address)
                    }))
                info.env = {
                    NODE_VERSION: process.version,
                    NODE_ENV: process.env.NODE_ENV || 'development',
                    PATH: process.env.PATH?.split(':').slice(0, 5).join(':') + '...'
                }
            }

            return info
        }
    },

    {
        name: 'get_process_info',
        description: '获取当前 Node.js 进程信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            const memUsage = process.memoryUsage()
            return {
                pid: process.pid,
                ppid: process.ppid,
                title: process.title,
                version: process.version,
                uptime: formatUptime(process.uptime()),
                cwd: process.cwd(),
                memory: {
                    rss: formatBytes(memUsage.rss),
                    heapTotal: formatBytes(memUsage.heapTotal),
                    heapUsed: formatBytes(memUsage.heapUsed),
                    external: formatBytes(memUsage.external)
                },
                cpu: process.cpuUsage()
            }
        }
    },

    {
        name: 'read_env',
        description: '读取环境变量',
        inputSchema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: '环境变量名称，不提供则返回所有非敏感变量'
                },
                pattern: {
                    type: 'string',
                    description: '正则匹配模式，用于筛选环境变量'
                }
            }
        },
        handler: async args => {
            const { name, pattern } = args

            const isSensitive = varName => SENSITIVE_ENV_PATTERNS.some(p => p.test(varName))

            if (name) {
                if (isSensitive(name)) {
                    return { error: '不允许读取敏感环境变量' }
                }
                return {
                    name,
                    value: process.env[name] || null,
                    exists: name in process.env
                }
            }

            let envVars = Object.entries(process.env).filter(([k]) => !isSensitive(k))

            if (pattern) {
                const regex = new RegExp(pattern, 'i')
                envVars = envVars.filter(([k]) => regex.test(k))
            }

            return {
                count: envVars.length,
                variables: Object.fromEntries(envVars.slice(0, MAX_ENV_VARS))
            }
        }
    }

    // list_directory 已由 file.js 统一实现（带沙箱路径校验、递归与过滤），此处不再重复注册
]

// 辅助函数
function formatBytes(bytes) {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    const parts = []
    if (days > 0) parts.push(`${days}天`)
    if (hours > 0) parts.push(`${hours}小时`)
    if (mins > 0) parts.push(`${mins}分钟`)
    if (secs > 0 || parts.length === 0) parts.push(`${secs}秒`)

    return parts.join('')
}
