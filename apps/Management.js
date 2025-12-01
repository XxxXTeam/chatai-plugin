/**
 * AI 插件管理命令
 * 提供群聊中的管理功能
 */
import config from '../config/config.js'
import { getWebServer } from '../src/services/webServer.js'
import { getScopeManager } from '../src/services/ScopeManager.js'
import { databaseService } from '../src/services/DatabaseService.js'
import { chatService } from '../src/services/ChatService.js'

export class AIManagement extends plugin {
    constructor() {
        const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
        
        super({
            name: 'AI插件管理',
            dsc: 'AI插件管理命令',
            event: 'message',
            priority: 20,
            rule: [
                {
                    reg: `^${cmdPrefix}管理面板$`,
                    fnc: 'managementPanel',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}管理面板\\s*永久$`,
                    fnc: 'permanentPanel',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}结束对话$`,
                    fnc: 'endConversation'
                },
                {
                    reg: `^${cmdPrefix}结束全部对话$`,
                    fnc: 'endAllConversations',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}设置人格\\s+`,
                    fnc: 'setPersonality'
                },
                {
                    reg: `^${cmdPrefix}设置群人格\\s+`,
                    fnc: 'setGroupPersonality',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}查看人格$`,
                    fnc: 'viewPersonality'
                },
                {
                    reg: `^${cmdPrefix}清除人格$`,
                    fnc: 'clearPersonality'
                },
                {
                    reg: `^${cmdPrefix}清除群人格$`,
                    fnc: 'clearGroupPersonality',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}状态$`,
                    fnc: 'status',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}帮助$`,
                    fnc: 'help'
                }
            ]
        })
    }

    /**
     * 获取管理面板链接（临时token，5分钟有效）
     */
    async managementPanel() {
        try {
            const webServer = getWebServer()
            const url = webServer.generateLoginUrl(false, false)
            await this.reply(`管理面板链接（5分钟内有效）：\n${url}`, true)
        } catch (err) {
            await this.reply(`获取管理面板失败: ${err.message}`, true)
        }
    }

    /**
     * 获取管理面板链接（永久token）
     */
    async permanentPanel() {
        try {
            const webServer = getWebServer()
            const url = webServer.generateLoginUrl(false, true)
            await this.reply(`管理面板链接（永久有效）：\n${url}\n\n⚠️ 请妥善保管此链接，不要泄露给他人！`, true)
        } catch (err) {
            await this.reply(`获取管理面板失败: ${err.message}`, true)
        }
    }

    /**
     * 结束当前对话
     */
    async endConversation() {
        try {
            const userId = this.e.user_id?.toString()
            const groupId = this.e.group_id || null
            await chatService.clearHistory(userId, groupId)
            await this.reply('已结束当前对话，上下文已清除。', true)
        } catch (err) {
            await this.reply(`结束对话失败: ${err.message}`, true)
        }
    }

    /**
     * 结束全部对话
     */
    async endAllConversations() {
        try {
            // TODO: 实现清除所有用户对话的逻辑
            await this.reply('已结束全部对话。', true)
        } catch (err) {
            await this.reply(`结束全部对话失败: ${err.message}`, true)
        }
    }

    /**
     * 设置个人人格（独立prompt）
     */
    async setPersonality() {
        try {
            const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
            const prompt = this.e.msg.replace(new RegExp(`^${cmdPrefix}设置人格\\s+`), '').trim()
            
            if (!prompt) {
                await this.reply('请输入人格设定内容', true)
                return
            }

            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const userId = this.e.user_id?.toString()
            await scopeManager.setUserPrompt(userId, prompt)

            await this.reply(`已设置你的专属人格：\n${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`, true)
        } catch (err) {
            await this.reply(`设置人格失败: ${err.message}`, true)
        }
    }

    /**
     * 设置群组人格
     */
    async setGroupPersonality() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return
        }

        try {
            const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
            const prompt = this.e.msg.replace(new RegExp(`^${cmdPrefix}设置群人格\\s+`), '').trim()
            
            if (!prompt) {
                await this.reply('请输入群人格设定内容', true)
                return
            }

            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const groupId = this.e.group_id?.toString()
            await scopeManager.setGroupPrompt(groupId, prompt)

            await this.reply(`已设置本群人格：\n${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`, true)
        } catch (err) {
            await this.reply(`设置群人格失败: ${err.message}`, true)
        }
    }

    /**
     * 查看当前人格设定
     */
    async viewPersonality() {
        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const userId = this.e.user_id?.toString()
            const groupId = this.e.group_id?.toString()

            const effective = await scopeManager.getEffectiveSettings(groupId, userId)
            
            let msg = '当前人格设定：\n'
            msg += `来源: ${effective.source}\n`
            
            if (effective.systemPrompt) {
                msg += `内容: ${effective.systemPrompt.substring(0, 200)}${effective.systemPrompt.length > 200 ? '...' : ''}`
            } else {
                msg += '未设置自定义人格，使用默认预设。'
            }

            await this.reply(msg, true)
        } catch (err) {
            await this.reply(`查看人格失败: ${err.message}`, true)
        }
    }

    /**
     * 清除个人人格
     */
    async clearPersonality() {
        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const userId = this.e.user_id?.toString()
            await scopeManager.deleteUserSettings(userId)

            await this.reply('已清除你的专属人格设定', true)
        } catch (err) {
            await this.reply(`清除人格失败: ${err.message}`, true)
        }
    }

    /**
     * 清除群组人格
     */
    async clearGroupPersonality() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return
        }

        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const groupId = this.e.group_id?.toString()
            await scopeManager.deleteGroupSettings(groupId)

            await this.reply('已清除本群人格设定', true)
        } catch (err) {
            await this.reply(`清除群人格失败: ${err.message}`, true)
        }
    }

    /**
     * 查看状态
     */
    async status() {
        try {
            const webServer = getWebServer()
            const addresses = webServer.getAddresses()
            
            let msg = 'AI插件状态：\n'
            msg += `运行状态: 正常\n`
            msg += `本地地址: ${addresses.local[0] || '未知'}\n`
            if (addresses.public) {
                msg += `公网地址: ${addresses.public}\n`
            }
            msg += `\n使用 ${config.get('basic.commandPrefix') || '#ai'}帮助 查看可用命令`

            await this.reply(msg, true)
        } catch (err) {
            await this.reply(`获取状态失败: ${err.message}`, true)
        }
    }

    /**
     * 帮助信息
     */
    async help() {
        const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
        
        const msg = `AI插件命令帮助：

${cmdPrefix}管理面板 - 获取管理面板链接（5分钟有效）
${cmdPrefix}管理面板 永久 - 获取永久管理面板链接
${cmdPrefix}结束对话 - 结束当前对话
${cmdPrefix}设置人格 <内容> - 设置个人专属人格
${cmdPrefix}设置群人格 <内容> - 设置群组人格（管理员）
${cmdPrefix}查看人格 - 查看当前生效的人格设定
${cmdPrefix}清除人格 - 清除个人人格设定
${cmdPrefix}清除群人格 - 清除群组人格设定（管理员）
${cmdPrefix}状态 - 查看插件状态
${cmdPrefix}帮助 - 显示此帮助信息

人格优先级：群内用户设定 > 群组设定 > 用户全局设定 > 默认预设`

        await this.reply(msg, true)
    }

    /**
     * 发送私聊消息给主人
     * @param {string|Array} msg 消息内容
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendToMaster(msg) {
        try {
            const bot = this.e?.bot || Bot
            const masters = bot?.config?.master || []
            
            for (const masterId of masters) {
                await this.sendPrivateMsg(masterId, msg)
            }
            return true
        } catch (err) {
            logger.debug('[Management] sendToMaster failed:', err.message)
            return false
        }
    }

    /**
     * 发送私聊消息
     * @param {string|number} userId 用户ID
     * @param {string|Array} msg 消息内容
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendPrivateMsg(userId, msg) {
        try {
            const bot = this.e?.bot || Bot
            
            if (typeof bot?.sendPrivateMsg === 'function') {
                await bot.sendPrivateMsg(userId, msg)
                return true
            }
            if (typeof bot?.pickFriend === 'function') {
                const friend = bot.pickFriend(userId)
                if (friend?.sendMsg) {
                    await friend.sendMsg(msg)
                    return true
                }
            }
            if (typeof Bot?.sendFriendMsg === 'function') {
                await Bot.sendFriendMsg(bot?.uin, userId, msg)
                return true
            }
            
            return false
        } catch (err) {
            logger.debug('[Management] sendPrivateMsg failed:', err.message)
            return false
        }
    }

    /**
     * 发送合并转发消息
     * @param {string} title 标题
     * @param {Array} messages 消息数组
     * @returns {Promise<boolean>} 是否发送成功
     */
    async sendForwardMsg(title, messages) {
        const e = this.e
        if (!e) return false
        
        try {
            const bot = e.bot || Bot
            const botId = bot?.uin || e.self_id || 10000
            
            const forwardNodes = messages.map(msg => ({
                user_id: botId,
                nickname: title || 'Bot',
                message: Array.isArray(msg) ? msg : [msg]
            }))
            
            if (e.isGroup && e.group?.makeForwardMsg) {
                const forwardMsg = await e.group.makeForwardMsg(forwardNodes)
                if (forwardMsg) {
                    await e.group.sendMsg(forwardMsg)
                    return true
                }
            } else if (!e.isGroup && e.friend?.makeForwardMsg) {
                const forwardMsg = await e.friend.makeForwardMsg(forwardNodes)
                if (forwardMsg) {
                    await e.friend.sendMsg(forwardMsg)
                    return true
                }
            }
            
            return false
        } catch (err) {
            logger.debug('[Management] sendForwardMsg failed:', err.message)
            return false
        }
    }
}
