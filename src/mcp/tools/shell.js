/**
 * Shell 命令执行工具
 * 支持执行 shell 命令、获取环境信息等
 * 
 * 注意：这是一个危险工具，需要在配置中显式允许
 */

import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'

const execAsync = promisify(exec)

export const shellTools = [
    {
        name: 'execute_command',
        description: '执行 Shell 命令。这是一个危险操作，仅限管理员使用。支持执行系统命令并返回输出结果。',
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
                    description: '超时时间（毫秒），默认 30000'
                },
                shell: {
                    type: 'string',
                    description: '使用的 shell，默认 /bin/bash'
                }
            },
            required: ['command']
        },
        dangerous: true,
        handler: async (args, context) => {
            const { command, cwd, timeout = 30000, shell = '/bin/bash' } = args
            
            // 安全检查：只有主人可以执行
            if (!context?.isMaster) {
                return {
                    success: false,
                    error: '权限不足：只有主人可以执行命令'
                }
            }
            
            // 危险命令黑名单
            const dangerousPatterns = [
                /rm\s+-rf\s+\/(?!\w)/i,  // rm -rf /
                /mkfs/i,
                /dd\s+if=/i,
                />\s*\/dev\/sd/i,
                /chmod\s+777\s+\//i,
                /:(){ :|:& };:/,  // fork bomb
            ]
            
            for (const pattern of dangerousPatterns) {
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
                    maxBuffer: 1024 * 1024 * 10,  // 10MB
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
        handler: async (args) => {
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
        handler: async (args) => {
            const { name, pattern } = args
            
            // 敏感变量列表（不返回）
            const sensitivePatterns = [
                /password/i, /secret/i, /token/i, /key/i, /credential/i,
                /auth/i, /api_key/i, /private/i
            ]
            
            const isSensitive = (varName) => 
                sensitivePatterns.some(p => p.test(varName))
            
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
            
            let envVars = Object.entries(process.env)
                .filter(([k]) => !isSensitive(k))
            
            if (pattern) {
                const regex = new RegExp(pattern, 'i')
                envVars = envVars.filter(([k]) => regex.test(k))
            }
            
            return {
                count: envVars.length,
                variables: Object.fromEntries(envVars.slice(0, 50))  // 最多返回50个
            }
        }
    },

    {
        name: 'list_directory',
        description: '列出目录内容',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: '目录路径，默认为当前目录'
                },
                showHidden: {
                    type: 'boolean',
                    description: '是否显示隐藏文件'
                },
                limit: {
                    type: 'number',
                    description: '最大返回数量，默认 50'
                }
            }
        },
        handler: async (args) => {
            const fs = await import('fs/promises')
            const targetPath = args.path || process.cwd()
            const showHidden = args.showHidden ?? false
            const limit = args.limit || 50
            
            try {
                const entries = await fs.readdir(targetPath, { withFileTypes: true })
                
                let items = entries
                    .filter(e => showHidden || !e.name.startsWith('.'))
                    .slice(0, limit)
                
                const results = await Promise.all(items.map(async (entry) => {
                    const fullPath = path.join(targetPath, entry.name)
                    try {
                        const stat = await fs.stat(fullPath)
                        return {
                            name: entry.name,
                            type: entry.isDirectory() ? 'directory' : 'file',
                            size: entry.isFile() ? formatBytes(stat.size) : null,
                            modified: stat.mtime.toISOString()
                        }
                    } catch {
                        return {
                            name: entry.name,
                            type: entry.isDirectory() ? 'directory' : 'file',
                            error: 'stat failed'
                        }
                    }
                }))
                
                return {
                    path: targetPath,
                    total: entries.length,
                    returned: results.length,
                    items: results
                }
            } catch (error) {
                return {
                    success: false,
                    path: targetPath,
                    error: error.message
                }
            }
        }
    }
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
