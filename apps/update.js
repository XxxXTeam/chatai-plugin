import plugin from '../../../lib/plugins/plugin.js'
import { createRequire } from 'module'
import config from '../config/config.js'

const require = createRequire(import.meta.url)
const { exec, execSync } = require('child_process')

let uping = false

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
    async update(e) {
        if (!e.isMaster) return false

        if (uping) {
            await e.reply('已有命令更新中..请勿重复操作')
            return false
        }

        // 检查git
        if (!(await this.checkGit())) return false

        const isForce = e.msg.includes('强制')
        await this.runUpdate(isForce)

        return true
    }

    /**
     * 执行更新
     */
    async runUpdate(isForce) {
        try {
            let command = 'git -C ./plugins/new-plugin/ pull --no-rebase'
            if (isForce) {
                command = `git -C ./plugins/new-plugin/ checkout . && ${command}`
                await this.e.reply('正在执行强制更新操作，请稍等')
            } else {
                await this.e.reply('正在执行更新操作，请稍等')
            }

            this.oldCommitId = await this.getcommitId('new-plugin')
            uping = true

            let ret = await this.execSync(command)

            if (ret.error) {
                logger.mark(`${this.e.logFnc} 更新失败：new-plugin`)
                this.gitErr(ret.error, ret.stdout)
                return false
            }

            // 检查包管理器
            let packageManager = await this.checkPnpm()
            await this.reply(`正在使用 ${packageManager} 更新依赖...`)

            let npmRet = await this.execSync(`cd ./plugins/new-plugin/ && ${packageManager} install`)

            if (npmRet.error) {
                logger.mark(`${this.e.logFnc} 依赖更新失败`)
                await this.reply(`依赖更新失败：\n${npmRet.error.toString()}`)
                return false
            }

            let time = await this.getTime('new-plugin')

            if (/(Already up[ -]to[ -]date|已经是最新的)/.test(ret.stdout)) {
                await this.reply(`new-plugin已经是最新版本\n最后更新时间：${time}`)
            } else {
                await this.reply(`new-plugin更新成功\n最后更新时间：${time}`)
                let log = await this.getLog('new-plugin')
                if (log) {
                    await this.reply(log)
                }

                // 提示重启
                await this.reply('更新完成，请重启云崽后生效')
            }

            return true
        } catch (err) {
            logger.error(err)
            await this.reply(`更新失败：\n${err.toString()}`)
            return false
        } finally {
            uping = false
        }
    }

    /**
     * 获取更新日志
     */
    async getLog(plugin = '') {
        let cm = `cd ./plugins/${plugin}/ && git log -20 --oneline --pretty=format:"%h||[%cd]  %s" --date=format:"%m-%d %H:%M"`

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
        log = await this.makeForwardMsg(`new-plugin更新日志，共${line}条`, log, end)

        return log
    }

    /**
     * 获取commit ID
     */
    async getcommitId(plugin = '') {
        let cm = `git -C ./plugins/${plugin}/ rev-parse --short HEAD`
        let commitId = await execSync(cm, { encoding: 'utf-8' })
        return commitId.trim()
    }

    /**
     * 获取最后提交时间
     */
    async getTime(plugin = '') {
        let cm = `cd ./plugins/${plugin}/ && git log -1 --oneline --pretty=format:"%cd" --date=format:"%m-%d %H:%M"`

        try {
            let time = await execSync(cm, { encoding: 'utf-8' })
            return time.trim()
        } catch (error) {
            logger.error(error.toString())
            return '获取时间失败'
        }
    }

    /**
     * 制作转发消息
     */
    async makeForwardMsg(title, msg, end) {
        const _bot = this.e.bot ?? Bot
        let nickname = _bot.nickname

        if (this.e.isGroup) {
            let info = await _bot?.pickMember?.(this.e.group_id, _bot.uin) ||
                await _bot?.getGroupMemberInfo?.(this.e.group_id, _bot.uin)
            nickname = info.card || info.nickname
        }

        let userInfo = {
            user_id: _bot.uin,
            nickname
        }

        let forwardMsg = [
            { ...userInfo, message: title },
            { ...userInfo, message: msg }
        ]

        if (end) {
            forwardMsg.push({ ...userInfo, message: end })
        }

        if (this.e.group?.makeForwardMsg) {
            forwardMsg = await this.e.group.makeForwardMsg(forwardMsg)
        } else if (this.e?.friend?.makeForwardMsg) {
            forwardMsg = await this.e.friend.makeForwardMsg(forwardMsg)
        } else {
            return msg
        }

        return forwardMsg
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
            await this.reply(
                msg + `存在冲突：\n${errMsg}\n` +
                '请解决冲突后再更新，或者执行#强制更新，放弃本地修改'
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
