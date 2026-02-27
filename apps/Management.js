/**
 * AI 插件管理命令
 * 提供群聊中的管理功能
 */
import config from '../config/config.js'
import { getWebServer } from '../src/services/webServer.js'
import { ensureScopeManager } from '../src/services/scope/ScopeManager.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { isMaster, urlToQRCode } from '../src/utils/platformAdapter.js'
import { chatService } from '../src/services/llm/ChatService.js'
import { renderService } from '../src/services/media/RenderService.js'
import { segment } from '../src/utils/messageParser.js'

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
                },
                {
                    reg: `^${cmdPrefix}群渠道设置$`,
                    fnc: 'viewGroupChannel'
                },
                {
                    reg: `^${cmdPrefix}群渠道(开启|关闭)独立$`,
                    fnc: 'toggleGroupIndependent'
                },
                {
                    reg: `^${cmdPrefix}群(禁用|启用)全局$`,
                    fnc: 'toggleForbidGlobal'
                },
                {
                    reg: `^${cmdPrefix}群限制设置$`,
                    fnc: 'viewUsageLimit'
                },
                {
                    reg: `^${cmdPrefix}群限制\\s+(\\d+)\\s*(\\d*)$`,
                    fnc: 'setUsageLimit'
                },
                {
                    reg: `^${cmdPrefix}群使用统计$`,
                    fnc: 'viewUsageStats'
                },
                {
                    reg: `^${cmdPrefix}群重置统计$`,
                    fnc: 'resetUsageStats'
                }
            ]
        })
    }

    /**
     * 检查是否是主人
     */
    isMasterUser(userId) {
        return isMaster(userId)
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
            const scopeManager = await ensureScopeManager()
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
            const scopeManager = await ensureScopeManager()
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
        const { localUrl, localUrls, localIPv6Urls, publicUrl, customUrls, validity, isPublicUrlConfigured } = loginInfo

        const validityText = validity
        const warningText = permanent ? '\n\n⚠️ 请妥善保管此链接，不要泄露给他人！' : ''
        const newTokenText = forceNew ? '（已重新生成）' : ''

        // 构建消息内容
        const messages = []

        // 标题
        messages.push({
            message: `🔐 AI插件管理面板（${validityText}）`,
            nickname: 'AI管理面板',
            user_id: this.e.self_id
        })

        // 显示所有地址
        // 本地IPv4地址
        if (localUrls && localUrls.length > 0) {
            messages.push({
                message: `📍 本地地址（IPv4）：\n${localUrls.join('\n')}`,
                nickname: 'AI管理面板',
                user_id: this.e.self_id
            })
        }

        // 本地IPv6地址
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

        // 私聊发送
        const userId = this.e.user_id
        try {
            // 尝试发送合并转发
            const bot = this.e.bot || Bot
            // 优先判断是否为好友，否则使用临时消息
            let target = null
            if (bot?.pickFriend) {
                const friend = bot.pickFriend(userId)
                // 检查是否真的是好友（有sendMsg方法且不是临时会话对象）
                if (friend?.sendMsg && (friend.info || friend.class === 'Friend')) {
                    target = friend
                }
            }
            // 如果不是好友且在群聊中，尝试使用临时消息
            if (!target && this.e.group_id && bot?.pickMember) {
                const member = bot.pickMember(this.e.group_id, userId)
                if (member?.sendMsg) {
                    target = member
                }
            }
            // 回退到pickUser
            if (!target && bot?.pickUser) {
                const user = bot.pickUser(userId)
                if (user?.sendMsg) {
                    target = user
                }
            }
            if (target?.sendMsg) {
                let forwardSent = false
                if (bot?.sendApi) {
                    try {
                        const nodes = messages.map(m => ({
                            type: 'node',
                            data: {
                                user_id: String(m.user_id || this.e.self_id || 10000),
                                nickname: m.nickname || 'AI管理面板',
                                content: [{ type: 'text', data: { text: String(m.message || '') } }]
                            }
                        }))
                        const result = await bot.sendApi('send_private_forward_msg', {
                            user_id: parseInt(userId),
                            messages: nodes
                        })
                        if (
                            result?.status === 'ok' ||
                            result?.retcode === 0 ||
                            result?.message_id ||
                            result?.data?.message_id
                        ) {
                            forwardSent = true
                        }
                    } catch {}
                }
                if (!forwardSent) {
                    const forwardMsg = await this.makeForwardMsg(messages)
                    if (forwardMsg) {
                        await target.sendMsg(forwardMsg)
                        forwardSent = true
                    }
                }

                if (forwardSent) {
                    // 如果在群聊中，提示已私聊发送
                    if (this.e.group_id) {
                        await this.reply('✅ 管理面板链接已私聊发送，请查收', true)
                    }
                    return
                }
            }

            // 发送文本消息
            const textParts = [`🔐 AI插件管理面板（${validityText}）`, '']

            // 如果配置了公网地址，只显示公网地址；否则显示所有地址
            if (isPublicUrlConfigured && publicUrl) {
                textParts.push(`🌐 公网地址：`, publicUrl, '')
            } else {
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

            if (this.e.group_id) {
                await this.reply('✅ 管理面板链接已私聊发送，请查收', true)
            }
        } catch (err) {
            logger.error('[Management] 私聊/临时消息发送失败:', err)
            // 发送失败不在群里发送链接，提示用户添加好友
            await this.reply('❌ 发送失败，请先添加Bot为好友或确保Bot有临时消息权限', true)
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

            const scopeManager = await ensureScopeManager()

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

            const scopeManager = await ensureScopeManager()

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
            const scopeManager = await ensureScopeManager()

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
            const scopeManager = await ensureScopeManager()

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
            const scopeManager = await ensureScopeManager()

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
     * 帮助信息 - 渲染为图片发送
     */
    async help() {
        const cmdPrefix = config.get('basic.commandPrefix') || '#ai'

        // 定义所有命令分类
        const commandCategories = [
            {
                category: '对话命令',
                icon: '💬',
                commands: [
                    { cmd: '#结束对话', desc: '结束对话清除上下文', icon: '🔚' },
                    { cmd: '#清除记忆', desc: '清除个人记忆数据', icon: '🧹' },
                    { cmd: '#对话状态', desc: '查看对话详细状态', icon: '📊' },
                    { cmd: '#我的记忆', desc: '查看已保存的记忆', icon: '🧠' },
                    { cmd: '#总结记忆', desc: '整理合并记忆条目', icon: '📝' },
                    { cmd: '#chatdebug', desc: '切换聊天调试模式', icon: '🐛' }
                ]
            },
            {
                category: '群聊功能',
                icon: '👥',
                commands: [
                    { cmd: '#群聊总结', desc: 'AI总结群聊内容', icon: '📋' },
                    { cmd: '#今日群聊', desc: '现代风格群聊总结', icon: '📰' },
                    { cmd: '#个人画像', desc: '分析用户画像', icon: '👤' },
                    { cmd: '#画像@xxx', desc: '分析指定用户画像', icon: '🎯' },
                    { cmd: '#今日词云', desc: '生成群聊词云图', icon: '☁️' },
                    { cmd: '#群记忆', desc: '查看群聊共享记忆', icon: '💭' }
                ]
            },
            {
                category: '绘图功能',
                icon: '🎨',
                commands: [
                    { cmd: '画 <描述>', desc: 'AI绘图支持中英文', icon: '🖼️' },
                    { cmd: '手办化', desc: '图片转手办风格', icon: '🎎' },
                    { cmd: 'Q版/动漫化', desc: '图片风格转换', icon: '✨' },
                    { cmd: '赛博朋克', desc: '赛博朋克风格', icon: '🌃' },
                    { cmd: '油画/水彩', desc: '绘画风格转换', icon: '🎭' }
                ]
            },
            {
                category: 'Galgame 游戏',
                icon: '🎮',
                commands: [
                    { cmd: `${cmdPrefix}游戏 开始`, desc: '开始Galgame冒险', icon: '🎬' },
                    { cmd: `${cmdPrefix}游戏 状态`, desc: '查看游戏状态', icon: '📈' },
                    { cmd: `${cmdPrefix}游戏 退出`, desc: '暂时退出游戏', icon: '⏸️' },
                    { cmd: `${cmdPrefix}游戏 结束`, desc: '结束并清空数据', icon: '⏹️' },
                    { cmd: `${cmdPrefix}游戏 帮助`, desc: '查看游戏帮助', icon: '❓' }
                ]
            },
            {
                category: '人格设定',
                icon: '🎭',
                commands: [
                    { cmd: `${cmdPrefix}设置人格`, desc: '设置个人专属人格', icon: '✏️' },
                    { cmd: `${cmdPrefix}查看人格`, desc: '查看当前人格', icon: '👁️' },
                    { cmd: `${cmdPrefix}清除人格`, desc: '清除个人人格', icon: '🗑️' },
                    { cmd: `${cmdPrefix}设置群人格`, desc: '设置群人格[主人]', icon: '👥' },
                    { cmd: `${cmdPrefix}清除群人格`, desc: '清除群人格[主人]', icon: '❌' }
                ]
            },
            {
                category: '群管理命令',
                icon: '⚙️',
                commands: [
                    { cmd: '#群管理面板', desc: '获取群设置面板', icon: '🖥️' },
                    { cmd: `${cmdPrefix}群设置`, desc: '查看本群功能状态', icon: '📋' },
                    { cmd: `${cmdPrefix}群伪人开/关`, desc: '本群伪人模式', icon: '🤖' },
                    { cmd: `${cmdPrefix}群绘图开/关`, desc: '本群绘图功能', icon: '🖌️' }
                ]
            },
            {
                category: '群渠道与限制',
                icon: '📡',
                commands: [
                    { cmd: `${cmdPrefix}群渠道设置`, desc: '查看群渠道配置', icon: '📺' },
                    { cmd: `${cmdPrefix}群禁/启用全局`, desc: '切换全局渠道', icon: '🔄' },
                    { cmd: `${cmdPrefix}群限制设置`, desc: '查看使用限制', icon: '🚧' },
                    { cmd: `${cmdPrefix}群限制 N M`, desc: '设置群/用户限制', icon: '⚖️' },
                    { cmd: `${cmdPrefix}群使用统计`, desc: '查看今日使用', icon: '📊' },
                    { cmd: `${cmdPrefix}群重置统计`, desc: '重置今日统计', icon: '🔃' }
                ]
            },
            {
                category: '主人命令',
                icon: '👑',
                commands: [
                    { cmd: `${cmdPrefix}管理面板`, desc: 'Web管理面板', icon: '🌐' },
                    { cmd: `${cmdPrefix}状态`, desc: '查看插件状态', icon: '📈' },
                    { cmd: `${cmdPrefix}调试开/关`, desc: '切换调试模式', icon: '🔧' },
                    { cmd: `${cmdPrefix}伪人开/关`, desc: '全局伪人模式', icon: '🎭' },
                    { cmd: `${cmdPrefix}设置模型`, desc: '设置默认模型', icon: '🤖' },
                    { cmd: `${cmdPrefix}结束全部对话`, desc: '清除所有对话', icon: '🧹' }
                ]
            },
            {
                category: '版本更新',
                icon: '🔄',
                commands: [
                    { cmd: '#ai版本', desc: '查看版本信息', icon: 'ℹ️' },
                    { cmd: '#ai检查更新', desc: '检查新版本', icon: '🔍' },
                    { cmd: '#ai更新', desc: '更新插件', icon: '⬆️' },
                    { cmd: '#ai更新日志', desc: '查看提交历史', icon: '📜' }
                ]
            }
        ]

        try {
            // 尝试渲染为图片
            const imageBuffer = await renderService.renderHelpImage({
                commands: commandCategories,
                title: 'ChatAI 插件帮助',
                subtitle: `命令前缀: ${cmdPrefix} | 人格优先级: 群内用户 > 群组 > 用户全局 > 默认预设`,
                footer: '💡 [主人] 需主人权限 | [管理] 需群管理员权限'
            })
            await this.reply(segment.image(imageBuffer))
        } catch (err) {
            logger.warn('[Management] 渲染帮助图片失败，回退到文本:', err.message)
            // 回退到文本模式
            const textHelp = commandCategories
                .map(cat => {
                    const cmds = cat.commands.map(c => `  ${c.cmd} - ${c.desc}`).join('\n')
                    return `━━ ${cat.icon} ${cat.category} ━━\n${cmds}`
                })
                .join('\n\n')
            await this.reply(
                `📚 AI插件命令帮助\n\n${textHelp}\n\n💡 人格优先级: 群内用户 > 群组 > 用户全局 > 默认预设`,
                true
            )
        }
        return true
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

    // ==================== 群独立渠道配置 ====================

    /**
     * 查看群渠道设置
     */
    async viewGroupChannel() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        try {
            const groupId = String(this.e.group_id)
            const scopeManager = await ensureScopeManager()

            const channelConfig = await scopeManager.getGroupChannelConfig(groupId)
            const cmdPrefix = config.get('basic.commandPrefix') || '#ai'

            let msg = `📡 本群渠道配置\n━━━━━━━━━━━━\n`

            if (channelConfig?.baseUrl && channelConfig?.apiKey) {
                msg += `🔗 独立渠道: ✅ 已配置\n`
                msg += `📍 接口地址: ${channelConfig.baseUrl.substring(0, 30)}...\n`
                msg += `🔑 API Key: ${channelConfig.apiKey.substring(0, 8)}****\n`
                msg += `🤖 适配器: ${channelConfig.adapterType || 'openai'}\n`
            } else {
                msg += `🔗 独立渠道: ❌ 未配置\n`
            }

            msg += `\n🚫 禁用全局: ${channelConfig?.forbidGlobal ? '✅ 是' : '❌ 否'}\n`

            if (channelConfig?.modelId) {
                msg += `🎯 独立模型: ${channelConfig.modelId}\n`
            }

            msg += `\n━━━━━━━━━━━━\n`
            msg += `💡 渠道优先级: 群独立 > 全局\n`
            msg += `📌 禁用全局后需配置独立渠道才能使用\n`
            msg += `\n管理命令:\n`
            msg += `${cmdPrefix}群禁用全局 - 禁用全局渠道\n`
            msg += `${cmdPrefix}群启用全局 - 启用全局渠道`

            await this.reply(msg, true)
        } catch (err) {
            await this.reply(`获取渠道配置失败: ${err.message}`, true)
        }
        return true
    }

    /**
     * 切换禁用全局模型
     */
    async toggleForbidGlobal() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        try {
            const groupId = String(this.e.group_id)
            const action = this.e.msg.includes('禁用')

            const scopeManager = await ensureScopeManager()

            // 如果要禁用全局，检查是否有独立渠道
            if (action) {
                const hasIndependent = await scopeManager.hasIndependentChannel(groupId)
                if (!hasIndependent) {
                    await this.reply(
                        '⚠️ 警告：本群尚未配置独立渠道，禁用全局后将无法使用AI功能！\n请先在管理面板配置群独立渠道',
                        true
                    )
                }
            }

            const channelConfig = (await scopeManager.getGroupChannelConfig(groupId)) || {}
            await scopeManager.setGroupChannelConfig(groupId, {
                ...channelConfig,
                forbidGlobal: action
            })

            await this.reply(`本群已${action ? '禁用' : '启用'}全局渠道`, true)
        } catch (err) {
            await this.reply(`设置失败: ${err.message}`, true)
        }
        return true
    }

    /**
     * 切换群独立渠道模式（占位，实际配置需通过管理面板）
     */
    async toggleGroupIndependent() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        await this.reply('群独立渠道需要通过管理面板配置\n请使用 #群管理面板 获取管理链接', true)
        return true
    }

    // ==================== 群使用限制 ====================

    /**
     * 查看群使用限制设置
     */
    async viewUsageLimit() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        try {
            const groupId = String(this.e.group_id)
            const scopeManager = await ensureScopeManager()

            const limitConfig = await scopeManager.getGroupUsageLimitConfig(groupId)
            const cmdPrefix = config.get('basic.commandPrefix') || '#ai'

            let msg = `📊 本群使用限制\n━━━━━━━━━━━━\n`
            msg += `📈 每日群总限制: ${limitConfig.dailyGroupLimit > 0 ? limitConfig.dailyGroupLimit + '次' : '无限制'}\n`
            msg += `👤 每日用户限制: ${limitConfig.dailyUserLimit > 0 ? limitConfig.dailyUserLimit + '次' : '无限制'}\n`

            if (limitConfig.limitMessage && limitConfig.limitMessage !== '今日使用次数已达上限，请明天再试') {
                msg += `💬 限制提示: ${limitConfig.limitMessage.substring(0, 50)}...\n`
            }

            msg += `\n━━━━━━━━━━━━\n`
            msg += `💡 设置命令:\n`
            msg += `${cmdPrefix}群限制 100 20 - 设置群100次/用户20次\n`
            msg += `${cmdPrefix}群限制 0 0 - 取消限制\n`
            msg += `${cmdPrefix}群使用统计 - 查看今日使用情况\n`
            msg += `${cmdPrefix}群重置统计 - 重置今日统计`

            await this.reply(msg, true)
        } catch (err) {
            await this.reply(`获取限制配置失败: ${err.message}`, true)
        }
        return true
    }

    /**
     * 设置群使用限制
     */
    async setUsageLimit() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        try {
            const groupId = String(this.e.group_id)
            const match = this.e.msg.match(/群限制\s+(\d+)\s*(\d*)/)
            if (!match) {
                await this.reply('格式错误，请使用: #ai群限制 群次数 用户次数', true)
                return true
            }

            const dailyGroupLimit = parseInt(match[1]) || 0
            const dailyUserLimit = parseInt(match[2]) || 0

            const scopeManager = await ensureScopeManager()

            await scopeManager.setGroupUsageLimitConfig(groupId, {
                dailyGroupLimit,
                dailyUserLimit
            })

            let msg = `✅ 使用限制已更新\n`
            msg += `📈 每日群总限制: ${dailyGroupLimit > 0 ? dailyGroupLimit + '次' : '无限制'}\n`
            msg += `👤 每日用户限制: ${dailyUserLimit > 0 ? dailyUserLimit + '次' : '无限制'}`

            await this.reply(msg, true)
        } catch (err) {
            await this.reply(`设置失败: ${err.message}`, true)
        }
        return true
    }

    /**
     * 查看群使用统计
     */
    async viewUsageStats() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        try {
            const groupId = String(this.e.group_id)
            const scopeManager = await ensureScopeManager()

            const summary = await scopeManager.getUsageSummary(groupId)

            let msg = `📊 本群今日使用统计\n━━━━━━━━━━━━\n`
            msg += `📅 日期: ${summary.date}\n`
            msg += `📈 群使用次数: ${summary.groupCount}`
            if (summary.dailyGroupLimit > 0) {
                msg += ` / ${summary.dailyGroupLimit} (剩余${summary.groupRemaining})`
            }
            msg += `\n`
            msg += `👥 活跃用户数: ${summary.totalUsers}\n`

            if (summary.topUsers.length > 0) {
                msg += `\n🏆 使用排行:\n`
                summary.topUsers.forEach((u, i) => {
                    msg += `${i + 1}. ${u.userId}: ${u.count}次\n`
                })
            }

            await this.reply(msg, true)
        } catch (err) {
            await this.reply(`获取统计失败: ${err.message}`, true)
        }
        return true
    }

    /**
     * 重置群使用统计
     */
    async resetUsageStats() {
        if (!this.e.isGroup) {
            await this.reply('此命令仅可在群聊中使用', true)
            return true
        }

        const isAdmin = await this.isGroupAdmin()
        if (!isAdmin) {
            await this.reply('此命令需要群管理员或群主权限', true)
            return true
        }

        try {
            const groupId = String(this.e.group_id)
            const scopeManager = await ensureScopeManager()

            await scopeManager.resetUsage(groupId)
            await this.reply('✅ 今日使用统计已重置', true)
        } catch (err) {
            await this.reply(`重置失败: ${err.message}`, true)
        }
        return true
    }
}
