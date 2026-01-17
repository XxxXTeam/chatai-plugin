/**
 * AI 插件更新管理
 * 处理插件版本检查、更新、依赖安装等功能
 */
import { createRequire } from 'module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { exec, execSync } = require('child_process')
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginPath = path.resolve(__dirname, '..')

// 更新状态管理
let uping = false
let upingTimeout = null
const UPING_TIMEOUT = 120000 // 2分钟超时

// 缓存 Yunzai 主人配置
let yunzaiCfg = null
try {
    yunzaiCfg = (await import('../../../lib/config/config.js')).default
} catch (e) {}

export class AIUpdate extends plugin {
    constructor() {
        super({
            name: 'AI插件更新',
            dsc: 'AI插件版本管理与更新',
            event: 'message',
            priority: 10,
            rule: [
                {
                    reg: '^#ai(强制)?更新$',
                    fnc: 'doUpdate',
                    permission: 'master'
                },
                {
                    reg: '^#ai版本$',
                    fnc: 'showVersion'
                },
                {
                    reg: '^#ai检查更新$',
                    fnc: 'checkUpdate',
                    permission: 'master'
                },
                {
                    reg: '^#ai更新日志$',
                    fnc: 'showChangelog',
                    permission: 'master'
                }
            ]
        })
    }

    /**
     * 检查是否是主人
     */
    isMasterUser(userId) {
        const masters = this.getMasterList()
        return masters.includes(String(userId)) || masters.includes(Number(userId))
    }

    /**
     * 获取主人 QQ 列表
     */
    getMasterList() {
        const masters = new Set()
        const PLUGIN_DEVELOPERS = [1018037233, 2173302144]
        for (const dev of PLUGIN_DEVELOPERS) {
            masters.add(String(dev))
            masters.add(dev)
        }
        try {
            const config = global.chatgptPluginConfig
            if (config) {
                const pluginMasters = config.get?.('admin.masterQQ') || []
                for (const m of pluginMasters) {
                    masters.add(String(m))
                    masters.add(Number(m))
                }
                const authorQQs = config.get?.('admin.pluginAuthorQQ') || []
                for (const a of authorQQs) {
                    masters.add(String(a))
                    masters.add(Number(a))
                }
            }
        } catch {}
        if (yunzaiCfg?.masterQQ?.length > 0) {
            for (const m of yunzaiCfg.masterQQ) {
                masters.add(String(m))
                masters.add(Number(m))
            }
        }
        const botMasters = global.Bot?.config?.master || []
        for (const m of botMasters) {
            masters.add(String(m))
            masters.add(Number(m))
        }

        return Array.from(masters)
    }

    /**
     * 显示版本信息
     * #ai版本
     */
    async showVersion() {
        try {
            let commitId = 'unknown'
            let branch = 'unknown'
            let commitTime = ''
            let commitMsg = ''

            try {
                commitId = execSync(`git -C "${pluginPath}" rev-parse --short HEAD`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe']
                }).trim()
            } catch {}

            try {
                branch = execSync(`git -C "${pluginPath}" rev-parse --abbrev-ref HEAD`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe']
                }).trim()
            } catch {}

            try {
                commitTime = execSync(`git -C "${pluginPath}" log -1 --format="%ci"`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe']
                }).trim()
            } catch {}

            try {
                commitMsg = execSync(`git -C "${pluginPath}" log -1 --format="%s"`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe']
                }).trim()
            } catch {}

            const lines = [
                `📦 ChatAI Plugin 版本信息`,
                `━━━━━━━━━━━━━━`,
                `🌿 分支: ${branch}`,
                `📝 提交: ${commitId}`,
                `📅 时间: ${commitTime.substring(0, 19)}`,
                `💬 说明: ${commitMsg.substring(0, 50)}${commitMsg.length > 50 ? '...' : ''}`,
                `━━━━━━━━━━━━━━`,
                `💡 发送 #ai检查更新 检查新版本`,
                `💡 发送 #ai更新 进行更新`
            ]
            await this.reply(lines.join('\n'))
        } catch (e) {
            await this.reply(`获取版本信息失败: ${e.message}`)
        }
        return true
    }

    /**
     * 检查更新
     * #ai检查更新
     */
    async checkUpdate() {
        if (!this.e.isMaster) return false
        await this.reply('🔍 正在检查更新...')

        try {
            await this.execCommand(`git -C "${pluginPath}" fetch --all`)

            const localCommit = execSync(`git -C "${pluginPath}" rev-parse --short HEAD`, { encoding: 'utf-8' }).trim()
            const remoteCommit = execSync(`git -C "${pluginPath}" rev-parse --short origin/HEAD`, {
                encoding: 'utf-8'
            }).trim()

            if (localCommit === remoteCommit) {
                await this.reply('✅ 已是最新版本')
            } else {
                // 获取更新日志
                const logs = execSync(
                    `git -C "${pluginPath}" log ${localCommit}..origin/HEAD --oneline --pretty=format:"%h %s"`,
                    { encoding: 'utf-8' }
                ).trim()
                const logLines = logs.split('\n').slice(0, 10)
                const updateCount = logs.split('\n').length

                const lines = [
                    `🆕 发现新版本！`,
                    `━━━━━━━━━━━━━━`,
                    `📊 共 ${updateCount} 个更新`,
                    ``,
                    `📝 更新内容:`,
                    ...logLines.map(l => `  · ${l}`),
                    updateCount > 10 ? `  ... 还有 ${updateCount - 10} 个更新` : '',
                    ``,
                    `💡 发送 #ai更新 进行更新`,
                    `💡 发送 #ai强制更新 强制覆盖本地修改`
                ].filter(Boolean)

                await this.reply(lines.join('\n'))
            }
        } catch (e) {
            await this.reply(`❌ 检查更新失败: ${e.message}`)
        }
        return true
    }

    /**
     * 显示更新日志
     * #ai更新日志
     */
    async showChangelog() {
        if (!this.e.isMaster) return false

        try {
            const logs = execSync(`git -C "${pluginPath}" log -15 --oneline --pretty=format:"%h|%s|%cr"`, {
                encoding: 'utf-8'
            }).trim()

            const logLines = logs.split('\n').map(line => {
                const [hash, msg, time] = line.split('|')
                return `${hash} ${msg.substring(0, 40)}${msg.length > 40 ? '...' : ''} (${time})`
            })

            const lines = [
                `📜 ChatAI Plugin 更新日志`,
                `━━━━━━━━━━━━━━`,
                ...logLines.map(l => `· ${l}`),
                `━━━━━━━━━━━━━━`,
                `💡 显示最近 15 条提交记录`
            ]

            await this.reply(lines.join('\n'))
        } catch (e) {
            await this.reply(`❌ 获取更新日志失败: ${e.message}`)
        }
        return true
    }

    /**
     * 执行更新
     * #ai更新 / #ai强制更新
     */
    async doUpdate() {
        if (!this.e.isMaster) return false

        // 检查是否正在更新
        if (uping) {
            if (upingTimeout && Date.now() > upingTimeout) {
                uping = false
                upingTimeout = null
            } else {
                await this.reply('⏳ 已有更新任务进行中，请勿重复操作')
                return false
            }
        }

        // 检查 git 是否可用
        try {
            const ret = execSync('git --version', { encoding: 'utf-8' })
            if (!ret || !ret.includes('git version')) {
                await this.reply('❌ 请先安装 Git')
                return false
            }
        } catch {
            await this.reply('❌ 请先安装 Git')
            return false
        }

        const isForce = this.e.msg.includes('强制')

        try {
            await this.reply('🔄 正在检查更新...')
            await this.execCommand(`git -C "${pluginPath}" fetch --all`)

            const oldCommitId = execSync(`git -C "${pluginPath}" rev-parse --short HEAD`, { encoding: 'utf-8' }).trim()
            uping = true
            upingTimeout = Date.now() + UPING_TIMEOUT

            if (isForce) {
                await this.reply('⚠️ 正在执行强制更新，重置本地修改...')
                await this.execCommand(`git -C "${pluginPath}" checkout . && git -C "${pluginPath}" clean -fd`)
            } else {
                await this.reply('📥 正在拉取更新...')
            }

            const { stdout, error } = await this.execCommand(`git -C "${pluginPath}" pull`)

            if (error && !stdout.includes('Already up') && !stdout.includes('已经是最新')) {
                await this.reply(`❌ 更新失败: ${error.toString()}`)
                return false
            }

            const hasUpdate = !/(Already up[ -]to[ -]date|已经是最新的)/.test(stdout)

            if (hasUpdate) {
                // 检测包管理器
                let npm = 'npm'
                try {
                    execSync('pnpm -v', { encoding: 'utf-8' })
                    npm = 'pnpm'
                } catch {}

                await this.reply(`📦 代码已更新，正在使用 ${npm} 安装依赖...`)
                const { error: installError } = await this.execCommand(
                    `cd "${pluginPath}" && ${npm} install --prefer-offline`
                )

                if (installError) {
                    await this.reply(`⚠️ 依赖安装可能存在问题: ${installError.toString().substring(0, 100)}`)
                } else {
                    await this.reply('✅ 依赖安装完成')
                }
            }

            // 获取更新后的版本信息
            const newCommitId = execSync(`git -C "${pluginPath}" rev-parse --short HEAD`, { encoding: 'utf-8' }).trim()
            const time = execSync(
                `git -C "${pluginPath}" log -1 --oneline --pretty=format:"%cd" --date=format:"%m-%d %H:%M"`,
                { encoding: 'utf-8' }
            ).trim()

            if (!hasUpdate) {
                await this.reply(`✅ ChatAI Plugin 已是最新版本\n📅 最后更新: ${time}`)
            } else {
                const lines = [
                    `✅ ChatAI Plugin 更新成功`,
                    `━━━━━━━━━━━━━━`,
                    `📝 ${oldCommitId} → ${newCommitId}`,
                    `📅 最后更新: ${time}`,
                    ``,
                    `💡 请发送 #重启 使更新生效`
                ]
                await this.reply(lines.join('\n'))
            }

            return true
        } catch (err) {
            await this.reply(`❌ 更新失败: ${err.message}`)
            return false
        } finally {
            uping = false
            upingTimeout = null
        }
    }

    /**
     * 异步执行命令
     * @param {string} cmd - 要执行的命令
     * @returns {Promise<{error: Error|null, stdout: string, stderr: string}>}
     */
    async execCommand(cmd) {
        return new Promise(resolve => {
            exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
                resolve({ error, stdout: stdout || '', stderr: stderr || '' })
            })
        })
    }
}
