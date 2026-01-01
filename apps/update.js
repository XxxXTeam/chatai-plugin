import plugin from '../../../lib/plugins/plugin.js'
import { createRequire } from 'module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import config from '../config/config.js'
import { chatLogger } from '../src/core/utils/logger.js'

const require = createRequire(import.meta.url)
const { exec, execSync } = require('child_process')
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginPath = path.resolve(__dirname, '..')

let uping = false
let upingTimeout = null 
const UPING_TIMEOUT = 120000

// 更新状态常量
const UPDATE_STATUS = {
    FAIL: 'FAIL',
    SUCCESS: 'SUCCESS',
    NO_UPDATE: 'NO_UPDATE',
    HAS_UPDATE: 'HAS_UPDATE',
}

// 是否已检查过更新
let isChecked = false 

/**
 * 插件更新
 */
export class update extends plugin {
    constructor() {
        const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
        super({
            name: 'AI-更新',
            event: 'message',
            priority: 1000,
            rule: [
                {
                    reg: `^${cmdPrefix}?(强制)?更新$`,
                    fnc: 'update',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}?版本$`,
                    fnc: 'getVersion'
                },
                {
                    reg: `^${cmdPrefix}?检查更新$`,
                    fnc: 'checkUpdate',
                    permission: 'master'
                }
            ]
        })
        
        // 创建定时任务：每天凌晨4点检查更新
        if (config.get('update.autoCheck') !== false) {
            this.task = {
                cron: '0 0 4 * * ?',
                name: 'ChatAI自动检查更新',
                fnc: this.doAutoCheckUpdate.bind(this)
            }
        }
        
        // 启动时检查更新（延迟执行）
        if (!isChecked && config.get('update.checkOnStart') !== false) {
            isChecked = true
            setTimeout(() => this.doAutoCheckUpdate(true), 5000)
        }
    }
    
    /**
     * 获取版本信息
     */
    async getVersion() {
        try {
            const commitId = await this.getcommitId()
            const time = await this.getTime()
            const branch = await this.getBranch()
            await this.reply(`[ChatAI] 版本信息\n分支: ${branch}\n提交: ${commitId}\n时间: ${time}`)
        } catch (e) {
            await this.reply(`[ChatAI] 获取版本信息失败: ${e.message}`)
        }
        return true
    }
    
    /**
     * 手动检查更新
     */
    async checkUpdate() {
        if (!this.e.isMaster) return false
        await this.reply('[ChatAI] 正在检查更新...')
        const result = await this.doCheckUpdate()
        if (result.status === UPDATE_STATUS.HAS_UPDATE) {
            await this.reply(`[ChatAI] 发现新版本！\n更新内容:\n${result.logs || '暂无更新日志'}\n\n发送 #ai更新 进行更新`)
        } else if (result.status === UPDATE_STATUS.NO_UPDATE) {
            await this.reply('[ChatAI] 已是最新版本')
        } else {
            await this.reply(`[ChatAI] 检查更新失败: ${result.message || '未知错误'}`)
        }
        return true
    }

    /**
     * 更新插件
     */
    async update() {
        if (!this.e.isMaster) return false

        if (uping) {
            if (upingTimeout && Date.now() > upingTimeout) {
                logger.warn('[Update] 检测到锁定超时，强制解锁')
                uping = false
                upingTimeout = null
            } else {
                await this.reply('已有命令更新中..请勿重复操作')
                return false
            }
        }

        // 检查git
        if (!(await this.checkGit())) return false

        const isForce = this.e.msg.includes('强制')
        await this.runUpdate(isForce)

        return true
    }

    /**
     * 执行更新
     */
    async runUpdate(isForce) {
        try {
            await this.reply('正在检查更新...')
            let fetchRet = await this.execSync(`git -C "${pluginPath}" fetch --all`)
            if (fetchRet.error) {
                logger.warn('[Update] git fetch warning:', fetchRet.error.toString())
            }
            
            this.oldCommitId = await this.getcommitId()
            uping = true
            upingTimeout = Date.now() + UPING_TIMEOUT

            let command = `git -C "${pluginPath}" pull `
            if (isForce) {
                await this.reply('正在执行强制更新，重置本地修改...')
                let resetRet = await this.execSync(`git -C "${pluginPath}" checkout . && git -C "${pluginPath}" clean -fd`)
                if (resetRet.error) {
                    logger.warn('[Update] git reset warning:', resetRet.error.toString())
                }
            } else {
                await this.reply('正在拉取更新...')
            }

            let ret = await this.execSync(command)

            if (ret.error) {
                logger.mark(`${this.e?.logFnc || 'update'} 更新失败：chatai-plugin`)
                this.gitErr(ret.error, ret.stdout)
                return false
            }

            // 检查是否有更新
            const hasUpdate = !/(Already up[ -]to[ -]date|已经是最新的)/.test(ret.stdout)
            
            if (hasUpdate) {
                // 有更新才安装依赖
                let packageManager = await this.checkPnpm()
                await this.reply(`代码已更新，正在使用 ${packageManager} 安装依赖...`)

                // 使用--prefer-offline加速，--no-frozen-lockfile允许更新lock文件
                let installCmd = packageManager === 'pnpm' 
                    ? `cd "${pluginPath}" && pnpm install --prefer-offline`
                    : `cd "${pluginPath}" && npm install --prefer-offline`
                    
                let npmRet = await this.execSync(installCmd)

                if (npmRet.error && !npmRet.stdout?.includes('up to date')) {
                    logger.warn(`${this.e?.logFnc || 'update'} 依赖更新警告:`, npmRet.error.toString())
                    // 不因依赖警告而失败，继续执行
                }
                
                await this.reply('依赖安装完成')
            }

            let time = await this.getTime()

            if (!hasUpdate) {
                await this.reply(`chatai-plugin已经是最新版本\n最后更新时间：${time}`)
            } else {
                await this.reply(`chatai-plugin更新成功\n最后更新时间：${time}`)
                let log = await this.getLog()
                if (log) {
                    await this.reply(log)
                }

                // 检查是否需要重启
                const needRestart = await this.checkNeedRestart()
                if (needRestart) {
                    if (config.get('update.autoRestart')) {
                        await this.reply('更新完成，即将自动重启...')
                        setTimeout(() => this.doRestart(), 2000)
                    } else {
                        await this.reply('更新完成，请发送 #重启 使更新生效')
                    }
                } else {
                    // 尝试热重载
                    await this.reply('更新完成，正在尝试热重载...')
                    const reloaded = await this.doHotReload()
                    if (reloaded) {
                        await this.reply('热重载成功，无需重启')
                    } else {
                        await this.reply('热重载失败，请发送 #重启 使更新生效')
                    }
                }
            }

            return true
        } catch (err) {
            logger.error(err)
            await this.reply(`更新失败：\n${err.toString()}`)
            return false
        } finally {
            uping = false
            upingTimeout = null
        }
    }
    
    /**
     * 自动检查更新任务
     */
    async doAutoCheckUpdate(isStartup = false) {
        if (config.get('update.autoCheck') === false) return
        
        const result = await this.doCheckUpdate()
        if (result.status === UPDATE_STATUS.HAS_UPDATE) {
            const msg = `[ChatAI] 发现新版本！\n${result.logs || ''}\n发送 #ai更新 进行更新`
            
            // 通知主人
            if (config.get('update.notifyMaster') !== false) {
                await this.sendToMaster(msg)
            }
            
            // 自动更新
            if (config.get('update.autoUpdate') && !isStartup) {
                chatLogger.info('[Update] 检测到新版本，开始自动更新...')
                await this.runUpdate(false)
            }
        } else if (isStartup && result.status === UPDATE_STATUS.NO_UPDATE) {
            chatLogger.info('[Update] 已是最新版本')
        }
    }
    
    /**
     * 检查更新
     */
    async doCheckUpdate() {
        try {
            // git fetch
            await this.execSync(`git -C "${pluginPath}" fetch --all`)
            
            // 获取本地和远程提交
            const localCommit = await this.getcommitId()
            const { stdout: remoteCommit } = await this.execSync(`git -C "${pluginPath}" rev-parse --short origin/HEAD`)
            
            if (localCommit === remoteCommit.trim()) {
                return { status: UPDATE_STATUS.NO_UPDATE }
            }
            
            // 获取更新日志
            const { stdout: logs } = await this.execSync(
                `git -C "${pluginPath}" log ${localCommit}..origin/HEAD --oneline --pretty=format:"%s"`
            )
            
            return {
                status: UPDATE_STATUS.HAS_UPDATE,
                logs: logs.trim().split('\n').slice(0, 10).join('\n')
            }
        } catch (e) {
            return { status: UPDATE_STATUS.FAIL, message: e.message }
        }
    }
    
    /**
     * 检查是否需要重启（而非热重载）
     */
    async checkNeedRestart() {
        try {
            const { stdout } = await this.execSync(
                `git -C "${pluginPath}" diff HEAD~1 --name-only`
            )
            const changedFiles = stdout.trim().split('\n')
            
            // 这些文件变更需要重启
            const restartFiles = ['package.json', 'index.js']
            return changedFiles.some(f => restartFiles.includes(f))
        } catch {
            return true // 出错时默认需要重启
        }
    }
    
    /**
     * 热重载（不重启云崽）
     */
    async doHotReload() {
        try {
            const { reloadWebServer } = await import('../src/services/webServer.js')
            await reloadWebServer()
            return true
        } catch (e) {
            chatLogger.warn('[Update] 热重载失败:', e.message)
            return false
        }
    }
    
    /**
     * 重启云崽
     */
    async doRestart() {
        chatLogger.info('[Update] 准备重启...')
        if (typeof Bot?.restart === 'function') {
            try {
                await Bot.restart()
                return
            } catch (e) {
                chatLogger.warn('[Update] Bot.restart() 失败:', e.message)
            }
        }
        try {
            if (redis && typeof redis.set === 'function') {
                await redis.set('Yz:restart', JSON.stringify({
                    isGroup: this.e?.isGroup,
                    id: this.e?.isGroup ? this.e.group_id : this.e?.user_id,
                    time: Date.now()
                }), { EX: 120 })
            }
        } catch {}
        process.exit(0)
    }
    
    /**
     * 给主人发送消息
     */
    async sendToMaster(msg) {
        try {
            const masterQQ = config.get('admin.masterQQ') || []
            if (masterQQ.length === 0) {
                // 尝试从云崽配置获取
                const yunzaiConfig = (await import('../../../lib/config/config.js')).default
                const masters = yunzaiConfig.masterQQ || []
                for (const qq of masters) {
                    const friend = Bot.fl?.get(Number(qq))
                    if (friend) {
                        await Bot.pickUser(Number(qq)).sendMsg(msg).catch(() => {})
                    }
                }
            } else {
                for (const qq of masterQQ) {
                    const friend = Bot.fl?.get(Number(qq))
                    if (friend) {
                        await Bot.pickUser(Number(qq)).sendMsg(msg).catch(() => {})
                    }
                }
            }
        } catch (e) {
            chatLogger.warn('[Update] 发送主人消息失败:', e.message)
        }
    }
    
    /**
     * 获取当前分支
     */
    async getBranch() {
        try {
            const { stdout } = await this.execSync(`git -C "${pluginPath}" rev-parse --abbrev-ref HEAD`)
            return stdout.trim()
        } catch {
            return 'unknown'
        }
    }

    /**
     * 获取更新日志
     */
    async getLog() {
        let cm = `git -C "${pluginPath}" log -20 --oneline --pretty=format:"%h||[%cd]  %s" --date=format:"%m-%d %H:%M"`

        let logAll
        try {
            logAll = await execSync(cm, { encoding: 'utf-8' })
        } catch (error) {
            logger.error(error.toString())
            return false
        }

        if (!logAll) return false

        logAll = logAll.split('\n')
        let log = []

        for (let str of logAll) {
            str = str.split('||')
            if (str[0] == this.oldCommitId) break
            if (str[1].includes('Merge branch')) continue
            log.push(str[1])
        }

        if (log.length <= 0) return ''

        let line = log.length
        log = log.join('\n\n')

        let end = '更多详细信息，请前往github查看'
        log = await this.makeForwardMsg(`chatai-plugin更新日志，共${line}条`, log, end)

        return log
    }

    /**
     * 获取commit ID
     */
    async getcommitId() {
        let cm = `git -C "${pluginPath}" rev-parse --short HEAD`
        let commitId = await execSync(cm, { encoding: 'utf-8' })
        return commitId.trim()
    }

    /**
     * 获取最后提交时间
     */
    async getTime() {
        let cm = `git -C "${pluginPath}" log -1 --oneline --pretty=format:"%cd" --date=format:"%m-%d %H:%M"`

        try {
            let time = await execSync(cm, { encoding: 'utf-8' })
            return time.trim()
        } catch (error) {
            logger.error(error.toString())
            return '获取时间失败'
        }
    }

    /**
     * 制作并发送转发消息
     * @param {string} title 标题
     * @param {string} msg 消息内容
     * @param {string} end 结尾消息
     * @returns {Promise<Object|string>} 转发消息或原始消息
     */
    async makeForwardMsg(title, msg, end) {
        const e = this.e
        const bot = e?.bot || Bot
        const botId = bot?.uin || e?.self_id || 10000
        let nickname = bot?.nickname || 'Bot'

        // 尝试获取群内昵称
        if (e?.isGroup && bot?.uin) {
            try {
                const info = await bot?.pickMember?.(e.group_id, bot.uin) ||
                    await bot?.getGroupMemberInfo?.(e.group_id, bot.uin)
                if (info) nickname = info.card || info.nickname || nickname
            } catch { }
        }

        // 构建消息节点
        const forwardNodes = [
            { user_id: botId, nickname, message: title },
            { user_id: botId, nickname, message: msg }
        ]
        if (end) {
            forwardNodes.push({ user_id: botId, nickname, message: end })
        }

        // 优先使用 e.group/e.friend 的方法
        if (e?.group?.makeForwardMsg) {
            return await e.group.makeForwardMsg(forwardNodes)
        } else if (e?.friend?.makeForwardMsg) {
            return await e.friend.makeForwardMsg(forwardNodes)
        } else if (typeof Bot?.makeForwardMsg === 'function') {
            return Bot.makeForwardMsg(forwardNodes)
        }

        // 最终回退：直接返回消息内容
        return msg
    }

    /**
     * 检查pnpm
     */
    async checkPnpm() {
        let npm = 'npm'
        let ret = await this.execSync('pnpm -v')
        if (ret.stdout) npm = 'pnpm'
        return npm
    }

    /**
     * Git错误处理
     */
    async gitErr(err, stdout) {
        let msg = '更新失败！'
        let errMsg = err.toString()
        stdout = stdout.toString()

        if (errMsg.includes('Timed out')) {
            let remote = errMsg.match(/'(.+?)'/g)?.[0].replace(/'/g, '') || 'unknown'
            await this.reply(msg + `\n连接超时：${remote}`)
            return
        }

        if (/Failed to connect|unable to access/g.test(errMsg)) {
            let remote = errMsg.match(/'(.+?)'/g)?.[0].replace(/'/g, '') || 'unknown'
            await this.reply(msg + `\n连接失败：${remote}`)
            return
        }

        if (errMsg.includes('be overwritten by merge')) {
            // 提取被修改的文件列表
            const files = errMsg.match(/\t(.+)/g)?.map(f => f.trim()).join('\n') || ''
            await this.reply(
                msg + `本地文件有未提交的修改：\n${files}\n\n` +
                '这不是冲突，是本地修改未保存。\n' +
                '选择：\n' +
                '1. #ai强制更新 - 放弃本地修改，使用远程版本\n' +
                '2. 手动备份修改后再更新'
            )
            return
        }

        await this.reply([errMsg, stdout])
    }

    /**
     * 异步执行命令
     */
    async execSync(cmd) {
        return new Promise((resolve, reject) => {
            exec(cmd, { windowsHide: true }, (error, stdout, stderr) => {
                resolve({ error, stdout, stderr })
            })
        })
    }

    /**
     * 检查git
     */
    async checkGit() {
        try {
            let ret = await execSync('git --version', { encoding: 'utf-8' })
            if (!ret || !ret.includes('git version')) {
                await this.reply('请先安装git')
                return false
            }
            return true
        } catch (error) {
            await this.reply('请先安装git')
            return false
        }
    }
}
