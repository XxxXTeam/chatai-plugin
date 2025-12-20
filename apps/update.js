import plugin from '../../../lib/plugins/plugin.js'
import { createRequire } from 'module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import config from '../config/config.js'

const require = createRequire(import.meta.url)
const { exec, execSync } = require('child_process')

// 获取插件目录路径（相对于Yunzai根目录）
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginPath = path.resolve(__dirname, '..')

let uping = false
let upingTimeout = null // 超时自动解锁
const UPING_TIMEOUT = 120000 // 2分钟超时

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
                }
            ]
        })
    }

    /**
     * 更新插件
     */
    async update() {
        if (!this.e.isMaster) return false

        if (uping) {
            // 检查是否超时锁定
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
            // 先检查远程更新
            await this.reply('正在检查更新...')
            
            // fetch远程信息
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

                // 提示重启
                await this.reply('更新完成，请发送 #重启 使更新生效')
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
