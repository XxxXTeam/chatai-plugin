/**
 * AI 插件管理命令
 * 提供群聊中的管理功能
 */
import config from '../config/config.js'
import { getWebServer } from '../src/services/webServer.js'
import { getScopeManager } from '../src/services/scope/ScopeManager.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { chatService } from '../src/services/llm/ChatService.js'
import { isQQBotPlatform, urlToQRCode } from '../src/utils/platformAdapter.js'

// 缓存 Yunzai 主人配置
let yunzaiCfg = null
try {
    yunzaiCfg = (await import('../../../lib/config/config.js')).default
} catch (e) {}

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
                    reg: `^${cmdPrefix}群伪人(开启|关闭)$`,
                    fnc: 'toggleGroupBym'
                },
                {
                    reg: `^${cmdPrefix}群绘图(开启|关闭)$`,
                    fnc: 'toggleGroupImageGen'
                },
                {
                    reg: `^${cmdPrefix}群设置$`,
                    fnc: 'viewGroupSettings'
                },
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
                },
                {
                    reg: `^${cmdPrefix}调试(开启|关闭)$`,
                    fnc: 'toggleDebug',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}伪人(开启|关闭)$`,
                    fnc: 'toggleBym',
                    permission: 'master'
                },
                {
                    reg: `^${cmdPrefix}设置(模型|model)\\s*(.+)$`,
                    fnc: 'setModel',
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
        const pluginMasters = config.get('admin.masterQQ') || []
        if (pluginMasters.length > 0) {
            return pluginMasters
        }
        if (yunzaiCfg?.masterQQ?.length > 0) {
            return yunzaiCfg.masterQQ
        }
        return global.Bot?.config?.master || []
    }

    /**
     * 检查是否是群管理员或群主（非主人）
     * @returns {Promise<boolean>}
     */
    async isGroupAdmin() {
        const e = this.e
        if (!e.isGroup) return false

        // 主人始终有权限
        if (this.isMasterUser(e.user_id)) return true

        // 检查群管理员/群主
        try {
            const role = e.sender?.role
            if (role === 'owner' || role === 'admin') {
                return true
            }

            // 尝试获取群成员信息
            const group = e.group || e.bot?.pickGroup?.(e.group_id)
            if (group?.pickMember) {
                const member = group.pickMember(e.user_id)
                const info = await member?.getInfo?.()
                if (info?.role === 'owner' || info?.role === 'admin') {
                    return true
                }
            }
        } catch (err) {
            logger.debug('[Management] 获取群成员信息失败:', err.message)
        }

        return false
    }

    /**
     * 获取群组功能设置
     * @param {string} groupId
     * @returns {Promise<Object>}
     */
    async getGroupFeatureSettings(groupId) {
        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const groupSettings = await scopeManager.getGroupSettings(groupId)
            return groupSettings?.settings || {}
        } catch (err) {
            logger.debug('[Management] 获取群组设置失败:', err.message)
            return {}
        }
    }

    /**
     * 设置群组功能
     * @param {string} groupId
     * @param {string} feature
     * @param {boolean} enabled
     * @returns {Promise<boolean>}
     */
    async setGroupFeature(groupId, feature, enabled) {
        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            const scopeManager = getScopeManager(databaseService)
            await scopeManager.init()

            const existingSettings = (await scopeManager.getGroupSettings(groupId)) || {}
            const currentFeatures = existingSettings.settings || {}

            // 更新功能设置
            currentFeatures[feature] = enabled

            // 正确结构：顶层字段单独传递，功能设置存储在otherSettings中
            await scopeManager.setGroupSettings(groupId, {
                systemPrompt: existingSettings.systemPrompt,
                presetId: existingSettings.presetId,
                knowledgeIds: existingSettings.knowledgeIds,
                inheritFrom: existingSettings.inheritFrom,
                ...currentFeatures
            })

            return true
        } catch (err) {
            logger.error('[Management] 设置群组功能失败:', err.message)
            return false
        }
    }

    /**
     * 获取管理面板链接（临时token，5分钟有效）
     */
    async managementPanel() {
        try {
            await this.sendPanelInfo(false)
        } catch (err) {
            await this.reply(`获取管理面板失败: ${err.message}`, true)
        }
    }

    /**
     * 获取管理面板链接（永久token，复用现有）
     */
    async permanentPanel() {
        try {
            await this.sendPanelInfo(true, false)
        } catch (err) {
            await this.reply(`获取管理面板失败: ${err.message}`, true)
        }
    }

    /**
     * 发送面板登录信息（私聊+合并转发）
     * @param {boolean} permanent - 是否永久有效
     * @param {boolean} forceNew - 是否强制生成新token
     */
    async sendPanelInfo(permanent = false, forceNew = false) {
        const webServer = getWebServer()

        // 使用新的getLoginInfo方法获取完整登录信息
        const loginInfo = webServer.getLoginInfo(permanent, forceNew)
        const { localUrl, localUrls, localIPv6Urls, publicUrl, customUrls, validity } = loginInfo

        const validityText = validity
        const warningText = permanent ? '\n\n⚠️ 请妥善保管此链接，不要泄露给他人！' : ''
        const newTokenText = forceNew ? '（已重新生成）' : ''

        // 检测是否为QQBot平台，需要将URL转为二维码
        const isQQBot = isQQBotPlatform(this.e)

        // 构建消息内容
        const messages = []

        // 标题
        messages.push({
            message: `🔐 AI插件管理面板（${validityText}）`,
            nickname: 'AI管理面板',
            user_id: this.e.self_id
        })

        // QQBot平台：优先使用公网地址或第一个可用地址生成二维码
        if (isQQBot) {
            const primaryUrl = publicUrl || (customUrls && customUrls[0]?.url) || localUrl
            if (primaryUrl) {
                const qrcode = await urlToQRCode(primaryUrl)
                if (qrcode) {
                    messages.push({
                        message: [`📱 请扫描二维码打开管理面板：`, { type: 'image', file: qrcode }],
                        nickname: 'AI管理面板',
                        user_id: this.e.self_id
                    })
                }
            }

            // 使用说明（QQBot版本）
            messages.push({
                message: `📌 使用说明：\n1. 使用手机扫描上方二维码\n2. 或在浏览器中打开链接\n3. 链接包含登录凭证，请勿分享${warningText}`,
                nickname: 'AI管理面板',
                user_id: this.e.self_id
            })
        } else {
            // 非QQBot平台：正常显示URL列表
            // 所有本地IPv4地址
            if (localUrls && localUrls.length > 0) {
                messages.push({
                    message: `📍 本地地址（IPv4）：\n${localUrls.join('\n')}`,
                    nickname: 'AI管理面板',
                    user_id: this.e.self_id
                })
            }

            // 所有本地IPv6地址
            if (localIPv6Urls && localIPv6Urls.length > 0) {
                messages.push({
                    message: `📍 本地地址（IPv6）：\n${localIPv6Urls.join('\n')}`,
                    nickname: 'AI管理面板',
                    user_id: this.e.self_id
                })
            }

            // 公网地址
            if (publicUrl) {
                messages.push({
                    message: `🌐 公网地址：\n${publicUrl}`,
                    nickname: 'AI管理面板',
                    user_id: this.e.self_id
                })
            }

            // 自定义地址
            if (customUrls && customUrls.length > 0) {
                for (const custom of customUrls) {
                    messages.push({
                        message: `🔗 ${custom.label}：\n${custom.url}`,
                        nickname: 'AI管理面板',
                        user_id: this.e.self_id
                    })
                }
            }

            // 使用说明
            messages.push({
                message: `📌 使用说明：\n1. 点击链接在浏览器中打开\n2. 优先使用与设备同网段的地址\n3. 如本地访问失败，请尝试公网地址\n4. 链接包含登录凭证，请勿分享${warningText}`,
                nickname: 'AI管理面板',
                user_id: this.e.self_id
            })
        }

        // 私聊发送
        const userId = this.e.user_id
        try {
            // 尝试发送合并转发
            const bot = this.e.bot || Bot
            if (bot?.pickUser) {
                const friend = bot.pickUser(userId)
                if (friend?.sendMsg) {
                    // 构建合并转发消息
                    const forwardMsg = await this.makeForwardMsg(messages)
                    if (forwardMsg) {
                        await friend.sendMsg(forwardMsg)
                        // 如果在群聊中，提示已私聊发送
                        if (this.e.group_id) {
                            await this.reply('✅ 管理面板链接已私聊发送，请查收', true)
                        }
                        return
                    }
                }
            }

            if (isQQBot) {
                const msgParts = [`🔐 AI插件管理面板（${validityText}）`]

                // 收集所有可用URL
                const allUrls = []
                if (customUrls && customUrls.length > 0) {
                    for (const custom of customUrls) {
                        allUrls.push({ label: custom.label, url: custom.url })
                    }
                }
                if (publicUrl) {
                    allUrls.push({ label: '公网', url: publicUrl })
                }
                if (localUrl) {
                    allUrls.push({ label: '本地', url: localUrl })
                }

                // 为每个URL生成二维码
                for (const item of allUrls) {
                    const qrcode = await urlToQRCode(item.url)
                    if (qrcode) {
                        msgParts.push(`\n📍 ${item.label}：`)
                        msgParts.push({ type: 'image', file: qrcode })
                    }
                }

                msgParts.push(`\n📌 链接包含登录凭证，请勿分享${warningText}`)
                await this.reply(msgParts, true)
                return
            } else {
                // 非QQBot平台：发送文本
                const textParts = [`🔐 AI插件管理面板（${validityText}）`, '']

                // 添加所有IPv4地址
                if (localUrls && localUrls.length > 0) {
                    textParts.push(`📍 本地地址（IPv4）：`)
                    textParts.push(...localUrls)
                    textParts.push('')
                }

                // 添加所有IPv6地址
                if (localIPv6Urls && localIPv6Urls.length > 0) {
                    textParts.push(`📍 本地地址（IPv6）：`)
                    textParts.push(...localIPv6Urls)
                    textParts.push('')
                }

                if (publicUrl) {
                    textParts.push(`🌐 公网地址：`, publicUrl, '')
                }

                // 添加自定义地址
                if (customUrls && customUrls.length > 0) {
                    for (const custom of customUrls) {
                        textParts.push(`🔗 ${custom.label}：`, custom.url, '')
                    }
                }

                textParts.push(`📌 链接包含登录凭证，请勿分享${warningText}`)

                const textMsg = textParts.filter(Boolean).join('\n')

                if (this.e.friend?.sendMsg) {
                    await this.e.friend.sendMsg(textMsg)
                } else if (bot?.sendPrivateMsg) {
                    await bot.sendPrivateMsg(userId, textMsg)
                } else {
                    await this.reply(textMsg, true)
                    return
                }
            }

            if (this.e.group_id) {
                await this.reply('✅ 管理面板链接已私聊发送，请查收', true)
            }
        } catch (err) {
            logger.error('[Management] 私聊发送失败:', err)
            // 私聊失败时在群里回复
            if (isQQBot) {
                const qrcode = await urlToQRCode(localUrl)
                const fallbackMsg = [`管理面板（${validityText}）：\n请扫描二维码：`]
                if (qrcode) {
                    fallbackMsg.push({ type: 'image', file: qrcode })
                }
                await this.reply(fallbackMsg, true)
            } else {
                await this.reply(`管理面板（${validityText}）：\n${localUrl}${warningText}`, true)
            }
        }
    }

    /**
     * 构建合并转发消息
     */
    async makeForwardMsg(messages) {
        try {
            const bot = this.e.bot || Bot
            if (bot?.makeForwardMsg) {
                return await bot.makeForwardMsg(messages)
            }
            // 尝试使用 segment 构建
            if (typeof segment !== 'undefined' && segment.forward) {
                return segment.forward(messages)
            }
            return null
        } catch {
            return null
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
     * 结束全部对话（清除数据库中所有对话历史）
     */
    async endAllConversations() {
        try {
            databaseService.init()
            // 清除所有对话历史
            const cleared = databaseService.clearAllConversations?.() || 0
            await this.reply(`✅ 已结束全部对话，共清除 ${cleared} 条消息记录`, true)
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

            await this.reply(
                `已设置你的专属人格：\n${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}`,
                true
            )
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

        const msg = `📚 AI插件命令帮助

━━━━ 对话命令 ━━━━
#结束对话 - 结束当前对话，清除上下文
#清除记忆 - 清除个人记忆数据
#对话状态 - 查看当前对话详细状态
#我的记忆 - 查看已保存的记忆
#总结记忆 - 整理合并记忆条目

━━━━ 群聊功能 ━━━━
#群聊总结 - AI总结近期群聊内容
#个人画像 - 分析用户个人画像
#画像@xxx - 分析指定用户画像
#今日词云 - 生成群聊词云图
#群记忆 - 查看群聊共享记忆

━━━━ 人格设定 ━━━━
${cmdPrefix}设置人格 <内容> - 设置个人专属人格
${cmdPrefix}查看人格 - 查看当前生效的人格
${cmdPrefix}清除人格 - 清除个人人格设定

━━━━ 群管理命令 ━━━━
#群管理面板 - 获取群设置面板
${cmdPrefix}群设置 - 查看本群功能状态
${cmdPrefix}群伪人开启/关闭 - 本群伪人模式
${cmdPrefix}群绘图开启/关闭 - 本群绘图功能
${cmdPrefix}设置群人格 <内容> - 设置群人格
${cmdPrefix}清除群人格 - 清除群人格设定

━━━━ 主人命令 ━━━━
${cmdPrefix}管理面板 - Web管理面板(临时)
${cmdPrefix}管理面板 永久 - Web管理面板(永久)
${cmdPrefix}状态 - 查看插件运行状态
${cmdPrefix}调试开启/关闭 - 调试模式
${cmdPrefix}伪人开启/关闭 - 全局伪人模式
${cmdPrefix}设置模型 <名称> - 设置默认模型
${cmdPrefix}结束全部对话 - 清除所有对话
#ai更新 - 更新插件
#ai版本 - 查看版本信息

━━━━ 调试命令 ━━━━
#chatdebug - 切换聊天调试模式

💡 人格优先级: 群内用户 > 群组 > 用户全局 > 默认预设`

        await this.reply(msg, true)
    }

    /**
     * 切换调试模式
     */
    async toggleDebug() {
        const action = this.e.msg.includes('开启')
        config.set('basic.debug', action)
        await this.reply(`调试模式已${action ? '开启' : '关闭'}`, true)
        return true
    }

    /**
     * 切换伪人模式（全局，仅主人）
     */
    async toggleBym() {
        const action = this.e.msg.includes('开启')
        config.set('bym.enable', action)
        await this.reply(`伪人模式已${action ? '开启' : '关闭'}（全局）`, true)
        return true
    }

    /**
     * 切换群组伪人模式（群管理员可用）
     */
    async toggleGroupBym() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        // 检查权限：主人或群管理员
        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        const action = this.e.msg.includes('开启')
        const groupId = String(this.e.group_id)

        const success = await this.setGroupFeature(groupId, 'bymEnabled', action)
        if (success) {
            await this.reply(`本群伪人模式已${action ? '开启' : '关闭'}`, true)
        } else {
            await this.reply('设置失败，请稍后重试', true)
        }
        return true
    }

    /**
     * 切换群组绘图功能（群管理员可用）
     */
    async toggleGroupImageGen() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        // 检查权限：主人或群管理员
        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        const action = this.e.msg.includes('开启')
        const groupId = String(this.e.group_id)

        const success = await this.setGroupFeature(groupId, 'imageGenEnabled', action)
        if (success) {
            await this.reply(`本群绘图功能已${action ? '开启' : '关闭'}`, true)
        } else {
            await this.reply('设置失败，请稍后重试', true)
        }
        return true
    }

    /**
     * 查看群组设置
     */
    async viewGroupSettings() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        // 检查权限：主人或群管理员
        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        const groupId = String(this.e.group_id)
        const settings = await this.getGroupFeatureSettings(groupId)

        // 获取全局设置作为默认值
        const globalBym = config.get('bym.enable') || false
        const globalImageGen = config.get('features.imageGen.enabled') !== false

        const bymStatus = settings.bymEnabled !== undefined ? settings.bymEnabled : globalBym
        const imageGenStatus = settings.imageGenEnabled !== undefined ? settings.imageGenEnabled : globalImageGen

        const cmdPrefix = config.get('basic.commandPrefix') || '#ai'

        const msg = `📋 本群AI功能设置\n━━━━━━━━━━━━\n🎭 伪人模式: ${bymStatus ? '✅ 开启' : '❌ 关闭'}${settings.bymEnabled === undefined ? ' (继承全局)' : ''}\n🎨 绘图功能: ${imageGenStatus ? '✅ 开启' : '❌ 关闭'}${settings.imageGenEnabled === undefined ? ' (继承全局)' : ''}\n━━━━━━━━━━━━\n💡 管理命令:\n${cmdPrefix}群伪人开启/关闭\n${cmdPrefix}群绘图开启/关闭`

        await this.reply(msg, true)
        return true
    }

    /**
     * 设置默认模型
     */
    async setModel() {
        const model = this.e.msg.match(/设置(?:模型|model)\s*(.+)$/)?.[1]?.trim()
        if (!model) {
            await this.reply('请指定模型名称', true)
            return false
        }

        config.set('llm.defaultModel', model)
        await this.reply(`默认模型已设置为: ${model}`, true)
        return true
    }
}
