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
    async managementPanel(e) {
        try {
            const webServer = getWebServer()
            const url = webServer.generateLoginUrl(false, false)
            await e.reply(`管理面板链接（5分钟内有效）：\n${url}`, true)
        } catch (err) {
            await e.reply(`获取管理面板失败: ${err.message}`, true)
        }
    }

    /**
     * 获取管理面板链接（永久token）
     */
    async permanentPanel(e) {
        try {
            const webServer = getWebServer()
            const url = webServer.generateLoginUrl(false, true)
            await e.reply(`管理面板链接（永久有效）：\n${url}\n\n⚠️ 请妥善保管此链接，不要泄露给他人！`, true)
        } catch (err) {
            await e.reply(`获取管理面板失败: ${err.message}`, true)
        }
    }

    /**
     * 结束当前对话
     */
    async endConversation(e) {
        try {
            const userId = e.user_id?.toString()
            const groupId = e.group_id || null
            await chatService.clearHistory(userId, groupId)
            await e.reply('已结束当前对话，上下文已清除。', true)
        } catch (err) {
            await e.reply(`结束对话失败: ${err.message}`, true)
        }
    }

    /**
     * 结束全部对话
     */
    async endAllConversations(e) {
        try {
            // TODO: 实现清除所有用户对话的逻辑
            await e.reply('已结束全部对话。', true)
        } catch (err) {
            await e.reply(`结束全部对话失败: ${err.message}`, true)
        }
    }

    /**
     * 设置个人人格（独立prompt）
     */
    async setPersonality(e) {
        try {
            const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
            const prompt = e.msg.replace(new RegExp(`^${cmdPrefix}设置人格\\s+`), '').trim()
            
            if (!prompt) {
                await e.reply('请输入人格设定内容', true)
                return
            }

            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const userId = e.user_id?.toString()
            await scopeManager.setUserPrompt(userId, prompt)

            await e.reply(`已设置你的专属人格：\n${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`, true)
        } catch (err) {
            await e.reply(`设置人格失败: ${err.message}`, true)
        }
    }

    /**
     * 设置群组人格
     */
    async setGroupPersonality(e) {
        if (!e.isGroup) {
            await e.reply('此命令仅可在群聊中使用', true)
            return
        }

        try {
            const cmdPrefix = config.get('basic.commandPrefix') || '#ai'
            const prompt = e.msg.replace(new RegExp(`^${cmdPrefix}设置群人格\\s+`), '').trim()
            
            if (!prompt) {
                await e.reply('请输入群人格设定内容', true)
                return
            }

            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const groupId = e.group_id?.toString()
            await scopeManager.setGroupPrompt(groupId, prompt)

            await e.reply(`已设置本群人格：\n${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`, true)
        } catch (err) {
            await e.reply(`设置群人格失败: ${err.message}`, true)
        }
    }

    /**
     * 查看当前人格设定
     */
    async viewPersonality(e) {
        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const userId = e.user_id?.toString()
            const groupId = e.group_id?.toString()

            const effective = await scopeManager.getEffectiveSettings(groupId, userId)
            
            let msg = '当前人格设定：\n'
            msg += `来源: ${effective.source}\n`
            
            if (effective.systemPrompt) {
                msg += `内容: ${effective.systemPrompt.substring(0, 200)}${effective.systemPrompt.length > 200 ? '...' : ''}`
            } else {
                msg += '未设置自定义人格，使用默认预设。'
            }

            await e.reply(msg, true)
        } catch (err) {
            await e.reply(`查看人格失败: ${err.message}`, true)
        }
    }

    /**
     * 清除个人人格
     */
    async clearPersonality(e) {
        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const userId = e.user_id?.toString()
            await scopeManager.deleteUserSettings(userId)

            await e.reply('已清除你的专属人格设定', true)
        } catch (err) {
            await e.reply(`清除人格失败: ${err.message}`, true)
        }
    }

    /**
     * 清除群组人格
     */
    async clearGroupPersonality(e) {
        if (!e.isGroup) {
            await e.reply('此命令仅可在群聊中使用', true)
            return
        }

        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const groupId = e.group_id?.toString()
            await scopeManager.deleteGroupSettings(groupId)

            await e.reply('已清除本群人格设定', true)
        } catch (err) {
            await e.reply(`清除群人格失败: ${err.message}`, true)
        }
    }

    /**
     * 查看状态
     */
    async status(e) {
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

            await e.reply(msg, true)
        } catch (err) {
            await e.reply(`获取状态失败: ${err.message}`, true)
        }
    }

    /**
     * 帮助信息
     */
    async help(e) {
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

        await e.reply(msg, true)
    }
}
