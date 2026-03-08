/**
 * AI 插件命令处理
 * 高优先级处理各种命令，避免被其他插件抢占
 */
import config from '../config/config.js'
import { chatService } from '../src/services/llm/ChatService.js'
import { memoryManager } from '../src/services/storage/MemoryManager.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { renderService } from '../src/services/media/RenderService.js'
import { channelManager } from '../src/services/llm/ChannelManager.js'
import { presetManager } from '../src/services/preset/PresetManager.js'
import { usageStats } from '../src/services/stats/UsageStats.js'
import { LlmService } from '../src/services/llm/LlmService.js'
import { ensureScopeManager, isGroupFeatureEnabled, getGroupFeatureModel } from '../src/services/scope/ScopeManager.js'
import { isMaster } from '../src/utils/platformAdapter.js'
import { generateGroupAdminLoginCode } from '../src/services/routes/groupAdminRoutes.js'
import { getWebServer } from '../src/services/webServer.js'

// Debug模式状态管理（运行时内存，重启后重置）
const debugSessions = new Map() // key: groupId或`private_${userId}`, value: boolean

/**
 * 检查是否启用debug模式
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
function isDebugEnabled(e) {
    const key = e.group_id ? String(e.group_id) : `private_${e.user_id}`
    return debugSessions.get(key) === true
}

/**
 * 设置debug模式
 * @param {Object} e - 事件对象
 * @param {boolean} enabled - 是否启用
 * @returns {string} key
 */
function setDebugMode(e, enabled) {
    const key = e.group_id ? String(e.group_id) : `private_${e.user_id}`
    if (enabled) {
        debugSessions.set(key, true)
    } else {
        debugSessions.delete(key)
    }
    return key
}

/**
 * 获取debug会话状态
 */
function getDebugSessions() {
    return debugSessions
}

// AICommands 必须是第一个导出的类，确保被正确加载
export class AICommands extends plugin {
    constructor() {
        super({
            name: 'AI-Commands',
            dsc: 'AI插件命令处理',
            event: 'message',
            priority: -100, // 最高优先级，确保命令不被其他插件抢占（数值越小优先级越高）
            rule: [
                {
                    reg: '^#(结束对话|结束会话|新对话|新会话)$',
                    fnc: 'endConversation'
                },
                {
                    reg: '^#(清除记忆|清理记忆|删除记忆)$',
                    fnc: 'clearMemory'
                },
                {
                    reg: '^#(对话状态|会话状态)$',
                    fnc: 'conversationStatus'
                },
                {
                    reg: '^#clear$',
                    fnc: 'clearHistory'
                },
                {
                    reg: '^#chatdebug\\s*(true|false|on|off|开启|关闭)?$',
                    fnc: 'toggleChatDebug'
                },
                {
                    reg: '^#(群聊总结|总结群聊|群消息总结|画像总结)(2)?$',
                    fnc: 'groupSummary'
                },
                {
                    reg: '^#(今日群聊|群聊总结2|现代总结)$',
                    fnc: 'groupSummaryModern'
                },
                {
                    reg: '^#(个人画像|用户画像|分析我)$',
                    fnc: 'userPortrait'
                },
                {
                    reg: '^#画像',
                    fnc: 'userProfileByAt'
                },
                {
                    reg: '^#(我的记忆|查看记忆|记忆列表)$',
                    fnc: 'viewMemory'
                },
                {
                    reg: '^#(群记忆|群聊记忆)$',
                    fnc: 'viewGroupMemory'
                },
                {
                    reg: '^#(总结记忆|记忆总结|整理记忆)$',
                    fnc: 'summarizeMemory'
                },
                {
                    reg: '^#(今日词云|词云|群词云)$',
                    fnc: 'todayWordCloud'
                },
                {
                    reg: '^#(群管理面板|群管理入口|群设置面板)$',
                    fnc: 'groupAdminPanel'
                }
            ]
        })
    }

    /**
     * 检查是否是主人
     * @param {string|number} userId - 用户ID
     * @returns {boolean}
     */
    isMasterUser(userId) {
        return isMaster(userId)
    }

    /**
     * 手动触发记忆总结
     * #总结记忆 / #记忆总结 / #整理记忆
     */
    async summarizeMemory() {
        const e = this.e
        try {
            await memoryManager.init()

            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null
            const fullUserId = groupId ? `${groupId}_${userId}` : String(userId)

            await this.reply('🔄 正在整理记忆...', true)

            // 执行覆盖式总结
            const result = await memoryManager.summarizeUserMemory(fullUserId)

            if (!result.success) {
                await this.reply(`❌ 记忆整理失败: ${result.error}`, true)
                return true
            }

            // 构建反馈
            const feedbackLines = [
                '✅ 记忆整理完成',
                `━━━━━━━━━━━━`,
                `📊 整理前: ${result.beforeCount} 条`,
                `📊 整理后: ${result.afterCount} 条`
            ]

            if (result.memories && result.memories.length > 0) {
                feedbackLines.push(``, `📝 当前记忆:`)
                result.memories.slice(0, 5).forEach((m, i) => {
                    feedbackLines.push(`  ${i + 1}. ${m.substring(0, 40)}${m.length > 40 ? '...' : ''}`)
                })
                if (result.memories.length > 5) {
                    feedbackLines.push(`  ... 共 ${result.memories.length} 条`)
                }
            }

            feedbackLines.push(``, `💡 记忆已合并去重，保留有价值的信息`)

            await this.reply(feedbackLines.join('\n'), true)
        } catch (error) {
            logger.error('[AI-Commands] Summarize memory error:', error)
            await this.reply('记忆整理失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 切换聊天debug模式
     * #chatdebug true/false/on/off/开启/关闭
     */
    async toggleChatDebug() {
        const e = this.e
        const match = e.msg.match(/#chatdebug\s*(true|false|on|off|开启|关闭)?$/i)

        let enabled
        if (!match || !match[1]) {
            // 无参数时切换状态
            enabled = !isDebugEnabled(e)
        } else {
            const param = match[1].toLowerCase()
            enabled = ['true', 'on', '开启'].includes(param)
        }

        const key = setDebugMode(e, enabled)
        const status = enabled ? '开启' : '关闭'
        const scope = e.group_id ? `群聊 ${e.group_id}` : '当前私聊'

        await this.reply(
            `✅ Debug模式已${status}\n📍 作用范围: ${scope}\n💡 ${enabled ? '后续消息将输出详细日志' : '已恢复正常模式'}\n⚠️ 重启后状态将重置`,
            true
        )

        logger.debug(`[AI-Commands] Debug模式${status}: ${key}`)
        return true
    }
    async endConversation() {
        const e = this.e
        try {
            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null
            // 与 ChatService 保持一致的 conversationId 格式
            const conversationId = groupId ? `group:${groupId}` : `user:${userId}`

            // 获取清理前的统计
            databaseService.init()
            const messages = databaseService.getMessages(conversationId, 1000)
            const messageCount = messages.length
            const userMsgCount = messages.filter(m => m.role === 'user').length
            const assistantMsgCount = messages.filter(m => m.role === 'assistant').length

            // 执行清理
            await chatService.clearHistory(userId, groupId)

            // 构建反馈信息
            const feedbackLines = [
                '✅ 已结束当前对话',
                `━━━━━━━━━━━━`,
                `📊 本次会话统计:`,
                `   💬 总消息: ${messageCount} 条`,
                `   👤 你的消息: ${userMsgCount} 条`,
                `   🤖 AI回复: ${assistantMsgCount} 条`,
                ``,
                `💡 下次对话将开始新会话`
            ]

            // 如果消息数为0，简化反馈
            if (messageCount === 0) {
                await this.reply('✅ 当前无对话记录，已准备好新会话', true)
            } else {
                await this.reply(feedbackLines.join('\n'), true)
            }
        } catch (error) {
            logger.error('[AI-Commands] End conversation error:', error)
            await this.reply('操作失败: ' + error.message, true)
        }
        return true
    }
    async clearMemory() {
        const e = this.e
        try {
            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null
            const fullUserId = groupId ? `${groupId}_${userId}` : String(userId)

            await memoryManager.init()

            // 获取清理前的统计
            const userMemories = (await memoryManager.getMemories(String(userId))) || []
            let groupUserMemories = []
            if (groupId) {
                groupUserMemories = (await memoryManager.getMemories(fullUserId)) || []
            }
            const totalMemories = userMemories.length + groupUserMemories.length

            // 执行清理
            await memoryManager.clearMemory(String(userId))
            if (groupId) {
                await memoryManager.clearMemory(fullUserId)
            }

            // 构建反馈
            if (totalMemories === 0) {
                await this.reply('📭 当前没有记忆数据需要清除', true)
            } else {
                const feedbackLines = [
                    '✅ 已清除记忆数据',
                    `━━━━━━━━━━━━`,
                    `🧠 清除了 ${totalMemories} 条记忆`,
                    userMemories.length > 0 ? `   · 个人记忆: ${userMemories.length} 条` : '',
                    groupUserMemories.length > 0 ? `   · 群聊记忆: ${groupUserMemories.length} 条` : '',
                    ``,
                    `💡 AI将不再记得之前的信息`
                ].filter(Boolean)
                await this.reply(feedbackLines.join('\n'), true)
            }
        } catch (error) {
            logger.error('[AI-Commands] Clear memory error:', error)
            await this.reply('清除记忆失败: ' + error.message, true)
        }
        return true
    }
    async conversationStatus() {
        const e = this.e
        try {
            await memoryManager.init()
            databaseService.init()
            await channelManager.init()
            await presetManager.init()

            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null
            // 与 ChatService 保持一致的 conversationId 格式
            const conversationId = groupId ? `group:${groupId}` : `user:${userId}`

            // 获取对话历史
            const messages = databaseService.getMessages(conversationId, 100)
            const messageCount = messages.length
            const userMsgCount = messages.filter(m => m.role === 'user').length
            const assistantMsgCount = messages.filter(m => m.role === 'assistant').length

            // 获取记忆数量
            const memories = await memoryManager.getMemories(String(userId))
            const memoryCount = memories?.length || 0

            // 获取最后活动时间
            let lastActive = '无'
            if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1]
                if (lastMsg?.timestamp) {
                    const date = new Date(lastMsg.timestamp)
                    lastActive = date.toLocaleString('zh-CN')
                }
            }

            // 获取当前使用的模型配置
            const chatModel = LlmService.getModel()

            // 获取渠道信息
            let channelInfo = { name: '未知', status: '未知' }
            try {
                const channel = await channelManager.getBestChannel(chatModel)
                if (channel) {
                    channelInfo = {
                        name: channel.name || channel.id?.substring(0, 8) || '默认',
                        status: channel.status || 'active',
                        adapter: channel.adapterType || 'openai'
                    }
                }
            } catch {}

            // 获取预设信息
            let presetInfo = { name: '默认', id: 'default' }
            try {
                // 尝试获取群组/用户的预设配置
                const scopeManager = await ensureScopeManager()
                const scopeConfig = await scopeManager.getEffectiveSettings(
                    groupId ? String(groupId) : null,
                    String(userId)
                )
                if (scopeConfig?.presetId) {
                    const preset = presetManager.get(scopeConfig.presetId)
                    if (preset) {
                        presetInfo = { name: preset.name || preset.id, id: scopeConfig.presetId }
                    }
                }
            } catch {}

            // 获取 Token 使用统计
            let tokenStats = { input: 0, output: 0, total: 0 }
            try {
                const stats = await usageStats.getUserStats(String(userId))
                if (stats) {
                    tokenStats = {
                        input: stats.totalInputTokens || 0,
                        output: stats.totalOutputTokens || 0,
                        total: (stats.totalInputTokens || 0) + (stats.totalOutputTokens || 0)
                    }
                }
            } catch {}

            // Debug状态
            const debugEnabled = isDebugEnabled(e) ? '✅ 开启' : '❌ 关闭'
            const nickname = e.sender?.nickname || e.sender?.card || '用户'
            const scope = groupId ? `群聊 ${groupId}` : '私聊'

            // 格式化 Token 数量
            const formatTokens = n => {
                if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
                if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
                return String(n)
            }

            // 构建 Markdown
            const markdown = [
                `## 📊 对话状态`,
                ``,
                `### 💬 会话信息`,
                `| 项目 | 数值 |`,
                `|------|------|`,
                `| 总消息数 | ${messageCount} 条 |`,
                `| 用户消息 | ${userMsgCount} 条 |`,
                `| AI回复 | ${assistantMsgCount} 条 |`,
                `| 最后活动 | ${lastActive} |`,
                ``,
                `### � 模型配置`,
                `| 项目 | 数值 |`,
                `|------|------|`,
                `| 当前模型 | ${chatModel} |`,
                `| 渠道 | ${channelInfo.name} (${channelInfo.status}) |`,
                `| 预设 | ${presetInfo.name} |`,
                ``,
                `### 📈 统计信息`,
                `| 项目 | 数值 |`,
                `|------|------|`,
                `| �� 记忆条目 | ${memoryCount} 条 |`,
                `| 📥 输入Token | ${formatTokens(tokenStats.input)} |`,
                `| 📤 输出Token | ${formatTokens(tokenStats.output)} |`,
                `| 🔧 Debug模式 | ${debugEnabled} |`,
                `| 📍 作用范围 | ${scope} |`,
                ``,
                `### 💡 常用命令`,
                `- **#结束对话** - 开始新会话`,
                `- **#清除记忆** - 清除记忆数据`,
                `- **#我的记忆** - 查看记忆列表`,
                `- **#chatdebug** - 切换调试模式`
            ].join('\n')

            try {
                // 尝试渲染为图片
                const imageBuffer = await renderService.renderMarkdownToImage({
                    markdown,
                    title: '对话状态',
                    subtitle: nickname,
                    icon: '📊',
                    showTimestamp: true
                })
                await this.reply(segment.image(imageBuffer))
            } catch (renderErr) {
                // 回退到文本
                logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                const textStatus = [
                    '📊 对话状态',
                    `━━━━━━━━━━━━`,
                    `💬 会话消息: ${messageCount} 条 (用户${userMsgCount}/AI${assistantMsgCount})`,
                    `🤖 当前模型: ${chatModel}`,
                    `📡 渠道: ${channelInfo.name}`,
                    `🎭 预设: ${presetInfo.name}`,
                    `🧠 记忆条目: ${memoryCount} 条`,
                    `📊 Token: ${formatTokens(tokenStats.input)}入/${formatTokens(tokenStats.output)}出`,
                    `⏰ 最后活动: ${lastActive}`,
                    `🔧 Debug: ${debugEnabled}`
                ].join('\n')
                await this.reply(textStatus, true)
            }
        } catch (error) {
            logger.error('[AI-Commands] Status error:', error)
            await this.reply('获取状态失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 清除历史（别名）
     */
    async clearHistory() {
        return this.endConversation()
    }

    /**
     * #群管理面板 / #群管理入口 / #群设置面板
     */
    async groupAdminPanel() {
        const e = this.e

        if (!e.group_id) {
            await this.reply('此功能仅支持群聊使用', true)
            return true
        }
        const isMaster = this.isMasterUser(e.user_id)
        const isGroupAdmin = e.sender?.role === 'admin' || e.sender?.role === 'owner'
        if (!isMaster && !isGroupAdmin) {
            await this.reply('仅群管理员、群主或Bot主人可使用此功能', true)
            return true
        }

        try {
            // 生成一次性登录码（5分钟有效，使用后失效）
            const { code } = generateGroupAdminLoginCode(e.group_id, e.user_id)

            // 获取所有可用地址
            const webServer = getWebServer()
            const addresses = webServer.getAddresses()
            const loginLinks = config.get('web.loginLinks') || []
            const publicUrl = config.get('web.publicUrl')

            // 构建所有登录URL
            const mountPath = webServer.mountPath || '/chatai'
            const urls = []

            // 配置了公网URL或自定义链接时，只发送这些配置的地址
            if (publicUrl || loginLinks.length > 0) {
                if (publicUrl) {
                    urls.push({
                        label: '公网',
                        url: `${publicUrl.replace(/\/$/, '')}${mountPath}/group-admin?code=${code}`
                    })
                }
                for (const link of loginLinks) {
                    if (link.url) {
                        urls.push({
                            label: link.label || '公网',
                            url: `${link.url.replace(/\/$/, '')}${mountPath}/group-admin?code=${code}`
                        })
                    }
                }
            } else {
                // 未配置公网地址时，发送所有地址
                if (addresses.local?.length > 0) {
                    for (const addr of addresses.local) {
                        urls.push({ label: '本地', url: `${addr}${mountPath}/group-admin?code=${code}` })
                    }
                }
                if (addresses.localIPv6?.length > 0) {
                    for (const addr of addresses.localIPv6) {
                        urls.push({ label: 'IPv6', url: `${addr}${mountPath}/group-admin?code=${code}` })
                    }
                }
                if (addresses.public) {
                    urls.push({ label: '公网', url: `${addresses.public}${mountPath}/group-admin?code=${code}` })
                }
            }

            // 构建消息
            const msgLines = [
                `🔧 群管理面板`,
                `━━━━━━━━━━━━`,
                `📍 群号: ${e.group_id}`,
                `👤 管理员: ${e.sender?.nickname || e.user_id}`,
                ``
            ]

            if (urls.length > 0) {
                msgLines.push(`🔗 可用登录地址:`)
                for (const { label, url } of urls) {
                    msgLines.push(`[${label}] ${url}`)
                }
            }

            msgLines.push(``)
            msgLines.push(`🔑 手动登录码: ${code}`)
            msgLines.push(`⏰ 登录码5分钟内有效，使用后失效`)
            msgLines.push(`💡 登录后24小时内无需再次验证`)

            const msg = msgLines.join('\n')

            // 尝试私聊/临时消息发送（更安全），失败则不发送到群
            let sendSuccess = false
            const bot = e.bot || global.Bot
            try {
                // 优先判断是否为好友
                if (bot?.pickFriend) {
                    const friend = bot.pickFriend(e.user_id)
                    // 检查是否真的是好友
                    if (friend?.sendMsg && (friend.info || friend.class === 'Friend')) {
                        await friend.sendMsg(msg)
                        sendSuccess = true
                    }
                }
                // 如果不是好友，尝试使用临时消息（通过群成员）
                if (!sendSuccess && e.group_id && bot?.pickMember) {
                    const member = bot.pickMember(e.group_id, e.user_id)
                    if (member?.sendMsg) {
                        await member.sendMsg(msg)
                        sendSuccess = true
                    }
                }
                // 回退到 pickUser
                if (!sendSuccess && bot?.pickUser) {
                    const user = bot.pickUser(e.user_id)
                    if (user?.sendMsg) {
                        await user.sendMsg(msg)
                        sendSuccess = true
                    }
                }
            } catch (err) {
                logger.debug('[Commands] 私聊/临时消息发送失败:', err.message)
            }

            // 根据发送结果回复
            if (sendSuccess) {
                await this.reply('✅ 管理面板链接已私聊发送，请查收', true)
            } else {
                await this.reply('❌ 发送失败，请先添加Bot为好友或确保Bot有临时消息权限', true)
            }
        } catch (error) {
            logger.error('[AI-Commands] Group admin panel error:', error)
            await this.reply('生成管理面板失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 群聊总结
     */
    async groupSummary() {
        const e = this.e
        if (!e.group_id) {
            await this.reply('此功能仅支持群聊', true)
            return true
        }
        const useModernStyle = /2$/.test(e.msg)

        const globalEnabled = config.get('features.groupSummary.enabled')
        const isEnabled = await isGroupFeatureEnabled(e.group_id, 'summaryEnabled', globalEnabled)
        if (!isEnabled) {
            await this.reply('群聊总结功能未启用', true)
            return true
        }

        try {
            await this.reply(useModernStyle ? '正在分析群聊消息...' : '正在分析群聊消息...', true)
            const maxMessages = config.get('features.groupSummary.maxMessages') || 300
            const maxChars = config.get('features.groupSummary.maxChars') || 6000
            const groupId = String(e.group_id)
            await memoryManager.init()
            let messages = []
            let dataSource = ''
            try {
                const history = await getGroupChatHistory(e, maxMessages)
                if (history && history.length > 0) {
                    const apiMessages = await Promise.all(
                        history.map(async msg => {
                            let nickname = msg.sender?.card || msg.sender?.nickname || '用户'
                            const contentParts = await Promise.all(
                                (msg.message || []).map(async part => {
                                    if (part.type === 'text') return part.text
                                    if (part.type === 'at') {
                                        if (part.qq === 'all' || part.qq === 0) return '@全体成员'
                                        try {
                                            const info = await getMemberInfo(e, part.qq)
                                            return `@${info?.card || info?.nickname || part.qq}`
                                        } catch {
                                            return `@${part.qq}`
                                        }
                                    }
                                    return ''
                                })
                            )
                            return {
                                userId: msg.sender?.user_id,
                                nickname,
                                content: contentParts.join(''),
                                timestamp: msg.time ? msg.time * 1000 : Date.now()
                            }
                        })
                    )
                    messages = apiMessages.filter(m => m.content && m.content.trim())
                    if (messages.length > 0) dataSource = 'Bot API'
                }
            } catch (historyErr) {
                logger.debug('[AI-Commands] Bot API 获取群聊历史失败:', historyErr.message)
            }
            if (messages.length < maxMessages) {
                const memoryMessages = memoryManager.getGroupMessageBuffer(groupId) || []
                if (memoryMessages.length > messages.length) {
                    messages = memoryMessages
                    dataSource = '内存缓冲'
                }
            }
            /* 数据库始终作为保底来源，即使其他来源已有数据，数据库可能包含更多历史 */
            {
                try {
                    databaseService.init()
                    const conversationId = `group_summary_${groupId}`
                    const rawDbMessages = databaseService.getMessages(conversationId, maxMessages)
                    if (rawDbMessages && rawDbMessages.length > messages.length) {
                        const dbMessages = rawDbMessages
                            .map(m => ({
                                nickname: m.metadata?.nickname || '用户',
                                content:
                                    typeof m.content === 'string'
                                        ? m.content
                                        : Array.isArray(m.content)
                                          ? m.content
                                                .filter(c => c.type === 'text')
                                                .map(c => c.text)
                                                .join('')
                                          : String(m.content),
                                timestamp: m.timestamp
                            }))
                            .filter(m => m.content && m.content.trim())
                        if (dbMessages.length > messages.length) {
                            messages = dbMessages
                            dataSource = '数据库'
                        }
                    }
                } catch (dbErr) {
                    logger.debug('[AI-Commands] 从数据库读取群消息失败:', dbErr.message)
                }
            }

            if (messages.length < 5) {
                await this.reply(
                    '群聊消息太少，无法生成总结\n\n💡 提示：需要在群里有足够的聊天记录\n请确保：\n1. 群聊消息采集已启用 (trigger.collectGroupMsg)\n2. 群里已有一定量的聊天记录',
                    true
                )
                return true
            }

            // 构建总结提示
            const recentMessages = messages.slice(-maxMessages)
            let dialogText = recentMessages
                .map(m => {
                    if (typeof m.content === 'string' && m.content.startsWith('[')) {
                        return m.content // 已格式化
                    }
                    const content =
                        typeof m.content === 'string'
                            ? m.content
                            : Array.isArray(m.content)
                              ? m.content
                                    .filter(c => c.type === 'text')
                                    .map(c => c.text)
                                    .join('')
                              : m.content
                    return `[${m.nickname || '用户'}]: ${content}`
                })
                .join('\n')
            let truncatedNote = ''
            if (dialogText.length > maxChars) {
                dialogText = dialogText.slice(-maxChars)
                truncatedNote = '\n\n⚠️ 消息过长，已截断到最近部分。'
            }

            // 统计参与者
            const participants = new Set(recentMessages.map(m => m.nickname || m.userId || '用户'))

            // 预先统计用户活跃度数据
            const userStats = {}
            const hourlyActivity = Array(24).fill(0)

            for (const msg of recentMessages) {
                const name = msg.nickname || msg.userId || '用户'
                const odId = msg.userId || null
                if (!userStats[name]) {
                    userStats[name] = { name, odId, count: 0, lastMsg: '' }
                }
                userStats[name].count++
                if (msg.content) {
                    userStats[name].lastMsg = msg.content.substring(0, 30)
                }
                // 统计小时分布
                if (msg.timestamp) {
                    const hour = new Date(msg.timestamp).getHours()
                    hourlyActivity[hour]++
                }
            }

            // 获取活跃用户TOP（现代风格8个，普通风格5个）
            const topUsers = Object.values(userStats)
                .sort((a, b) => b.count - a.count)
                .slice(0, useModernStyle ? 8 : 5)
                .map(u => ({
                    name: u.name,
                    count: u.count,
                    odId: u.odId,
                    avatar: u.odId ? `https://q1.qlogo.cn/g?b=qq&nk=${u.odId}&s=0` : null
                }))

            // 现代风格额外数据
            let keywords = []
            let interactions = []
            let atmosphere = {}
            let quotes = []

            if (useModernStyle) {
                // 提取关键词
                const wordCounts = {}
                const stopWords = new Set([
                    '的',
                    '了',
                    '是',
                    '我',
                    '你',
                    '他',
                    '她',
                    '它',
                    '们',
                    '这',
                    '那',
                    '有',
                    '在',
                    '吗',
                    '啊',
                    '呢',
                    '吧',
                    '嗯',
                    '哦',
                    '哈',
                    '呀',
                    '好',
                    '不',
                    '也',
                    '都',
                    '就',
                    '和',
                    '与',
                    '但',
                    '而',
                    '或',
                    '一',
                    '个',
                    '什么',
                    '怎么',
                    '为什么',
                    '可以',
                    '没有',
                    '还是',
                    '已经',
                    '可能',
                    '应该',
                    '因为',
                    '所以',
                    '如果',
                    '虽然',
                    '然后',
                    '现在',
                    '知道',
                    '觉得',
                    '看看',
                    '说说'
                ])
                for (const msg of recentMessages) {
                    const content = typeof msg.content === 'string' ? msg.content : ''
                    const words = content.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g) || []
                    for (const word of words) {
                        if (!stopWords.has(word) && word.length >= 2) {
                            wordCounts[word] = (wordCounts[word] || 0) + 1
                        }
                    }
                }
                keywords = Object.entries(wordCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 12)
                    .map(([word, count]) => ({ word, count }))

                // 互动关系
                const interactionMap = {}
                for (const msg of recentMessages) {
                    const content = typeof msg.content === 'string' ? msg.content : ''
                    const from = msg.nickname || '用户'
                    const atMatches = content.match(/@([^\s@]+)/g) || []
                    for (const at of atMatches) {
                        const to = at.replace('@', '')
                        if (to && to !== from && to !== '全体成员') {
                            const key = `${from}->${to}`
                            if (!interactionMap[key]) {
                                interactionMap[key] = { from, to, count: 0 }
                            }
                            interactionMap[key].count++
                        }
                    }
                }
                interactions = Object.values(interactionMap)
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 3)

                // 群聊氛围
                const totalMsgs = recentMessages.length
                const emojiCount = recentMessages.filter(m =>
                    /[\u{1F300}-\u{1F9FF}]|[😀-🙏]/u.test(m.content || '')
                ).length
                atmosphere = {
                    positivity: Math.min(95, Math.round(50 + (emojiCount / totalMsgs) * 100 + Math.random() * 20)),
                    activity: Math.min(95, Math.round(30 + Math.min(totalMsgs / 3, 50) + Math.random() * 15)),
                    interaction: Math.min(
                        95,
                        Math.round(
                            20 + interactions.length * 15 + Object.keys(interactionMap).length * 5 + Math.random() * 10
                        )
                    )
                }

                // 精彩语录
                quotes = recentMessages
                    .filter(m => {
                        const content = typeof m.content === 'string' ? m.content : ''
                        return (
                            content.length >= 15 &&
                            content.length <= 100 &&
                            !content.startsWith('[') &&
                            !/^@/.test(content)
                        )
                    })
                    .sort(() => Math.random() - 0.5)
                    .slice(0, 3)
                    .map(m => ({
                        content: m.content.substring(0, 80),
                        author: m.nickname || '群友'
                    }))
            }

            const summaryPrompt = `请根据以下群聊记录，对群聊内容进行全面的总结分析。请从以下几个维度进行分析，并以清晰、有条理的Markdown格式呈现你的结论：

## 分析维度

1. **🔥 热门话题**：群友们最近在讨论什么话题？有哪些热点事件或共同关注的内容？按热度排序列出主要话题。

2. **👥 活跃成员**：哪些成员发言最多？简要描述他们的发言特点和主要讨论内容。

3. **💬 群聊氛围**：群聊的整体氛围如何？（例如：轻松愉快、严肃认真、热烈讨论等）

4. **📌 关键信息**：有没有重要的通知、决定或值得关注的信息？包括但不限于：活动安排、重要公告、问题讨论结论等。

5. **🎯 话题趋势**：群聊话题有什么变化趋势？哪些话题正在升温，哪些已经结束？

6. **💡 精彩瞬间**：有哪些有趣的对话、金句或值得记录的互动？

## 注意事项
- 请保持客观中立，如实反映群聊内容
- 对于敏感话题请谨慎处理
- 总结要简洁明了，突出重点

---

以下是最近的群聊记录（共 ${recentMessages.length} 条消息，${participants.size} 位参与者）：

${dialogText}${truncatedNote}`

            // 获取群组独立的总结模型配置
            const groupSummaryModel = await getGroupFeatureModel(e.group_id, 'summaryModel')
            let summaryText = ''
            let result = null
            try {
                result = await chatService.sendMessage({
                    userId: `summary_${e.group_id}`,
                    groupId: null, // 不传群ID，避免继承群人设
                    message: summaryPrompt,
                    model: groupSummaryModel || undefined, // 使用群组独立模型
                    mode: 'chat',
                    skipHistory: true, // 跳过历史记录
                    disableTools: true, // 禁用工具
                    skipPersona: true // 跳过人设获取，不使用任何人设风格
                })

                if (result.response && Array.isArray(result.response)) {
                    summaryText = result.response
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                }
            } catch (invokeErr) {
                logger.error('[AI-Commands] 调用模型生成群聊总结失败:', invokeErr)
                await this.reply(`群聊总结生成失败：${invokeErr.message || '模型调用异常'}`, true)
                return true
            }

            if (summaryText) {
                try {
                    // 获取实际使用的模型信息
                    const actualModel =
                        result?.model || groupSummaryModel || config.get('llm.defaultModel') || '默认模型'
                    const shortModel = actualModel.split('/').pop()

                    // 渲染为图片（根据样式选择渲染方法）
                    const renderOptions = {
                        title: useModernStyle ? '今日群聊' : '群聊内容总结',
                        subtitle: `${shortModel} · ${dataSource}`,
                        messageCount: messages.length,
                        participantCount: participants.size,
                        topUsers,
                        hourlyActivity,
                        ...(useModernStyle ? { keywords, interactions, atmosphere, quotes } : {})
                    }
                    const imageBuffer = useModernStyle
                        ? await renderService.renderGroupSummaryModern(summaryText, renderOptions)
                        : await renderService.renderGroupSummary(summaryText, renderOptions)
                    await this.reply(segment.image(imageBuffer))
                } catch (renderErr) {
                    const fallbackModel =
                        result?.model || groupSummaryModel || config.get('llm.defaultModel') || '默认模型'
                    const fallbackShortModel = fallbackModel.split('/').pop()
                    logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                    const titleEmoji = useModernStyle ? '✨' : '📊'
                    await this.reply(
                        `${titleEmoji} ${useModernStyle ? '今日群聊' : '群聊总结'} (${messages.length}条消息 · ${fallbackShortModel})\n\n${summaryText}`,
                        true
                    )
                }
            } else {
                await this.reply('总结生成失败', true)
            }
        } catch (error) {
            logger.error('[AI-Commands] Group summary error:', error)
            await this.reply('群聊总结失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 群聊总结 - 深色现代风格
     */
    async groupSummaryModern() {
        const e = this.e
        if (!e.group_id) {
            await this.reply('此功能仅支持群聊', true)
            return true
        }
        const globalEnabled = config.get('features.groupSummary.enabled')
        const isEnabled = await isGroupFeatureEnabled(e.group_id, 'summaryEnabled', globalEnabled)
        if (!isEnabled) {
            await this.reply('群聊总结功能未启用', true)
            return true
        }

        try {
            await this.reply('正在分析群聊消息（现代风格）...', true)
            const maxMessages = config.get('features.groupSummary.maxMessages') || 300
            const maxChars = config.get('features.groupSummary.maxChars') || 6000
            const groupId = String(e.group_id)
            await memoryManager.init()
            let messages = []
            let dataSource = ''
            try {
                const history = await getGroupChatHistory(e, maxMessages)
                if (history && history.length > 0) {
                    const apiMessages = await Promise.all(
                        history.map(async msg => {
                            let nickname = msg.sender?.card || msg.sender?.nickname || '用户'
                            const contentParts = await Promise.all(
                                (msg.message || []).map(async part => {
                                    if (part.type === 'text') return part.text
                                    if (part.type === 'at') {
                                        if (part.qq === 'all' || part.qq === 0) return '@全体成员'
                                        try {
                                            const info = await getMemberInfo(e, part.qq)
                                            return `@${info?.card || info?.nickname || part.qq}`
                                        } catch {
                                            return `@${part.qq}`
                                        }
                                    }
                                    return ''
                                })
                            )
                            return {
                                userId: msg.sender?.user_id,
                                nickname,
                                content: contentParts.join(''),
                                timestamp: msg.time ? msg.time * 1000 : Date.now()
                            }
                        })
                    )
                    messages = apiMessages.filter(m => m.content && m.content.trim())
                    if (messages.length > 0) dataSource = 'Bot API'
                }
            } catch (historyErr) {
                logger.debug('[AI-Commands] Bot API 获取群聊历史失败:', historyErr.message)
            }
            if (messages.length < maxMessages) {
                const memoryMessages = memoryManager.getGroupMessageBuffer(groupId) || []
                if (memoryMessages.length > messages.length) {
                    messages = memoryMessages
                    dataSource = '内存缓冲'
                }
            }
            /* 数据库始终作为保底来源，即使其他来源已有数据，数据库可能包含更多历史 */
            {
                try {
                    databaseService.init()
                    const conversationId = `group_summary_${groupId}`
                    const rawDbMessages = databaseService.getMessages(conversationId, maxMessages)
                    if (rawDbMessages && rawDbMessages.length > messages.length) {
                        const dbMessages = rawDbMessages
                            .map(m => ({
                                nickname: m.metadata?.nickname || '用户',
                                content:
                                    typeof m.content === 'string'
                                        ? m.content
                                        : Array.isArray(m.content)
                                          ? m.content
                                                .filter(c => c.type === 'text')
                                                .map(c => c.text)
                                                .join('')
                                          : String(m.content),
                                timestamp: m.timestamp
                            }))
                            .filter(m => m.content && m.content.trim())
                        if (dbMessages.length > messages.length) {
                            messages = dbMessages
                            dataSource = '数据库'
                        }
                    }
                } catch (dbErr) {
                    logger.debug('[AI-Commands] 从数据库读取群消息失败:', dbErr.message)
                }
            }

            if (messages.length < 5) {
                await this.reply('群聊消息太少，无法生成总结\n\n💡 提示：需要在群里有足够的聊天记录', true)
                return true
            }

            const recentMessages = messages.slice(-maxMessages)
            let dialogText = recentMessages
                .map(m => {
                    if (typeof m.content === 'string' && m.content.startsWith('[')) {
                        return m.content
                    }
                    const content =
                        typeof m.content === 'string'
                            ? m.content
                            : Array.isArray(m.content)
                              ? m.content
                                    .filter(c => c.type === 'text')
                                    .map(c => c.text)
                                    .join('')
                              : m.content
                    return `[${m.nickname || '用户'}]: ${content}`
                })
                .join('\n')
            let truncatedNote = ''
            if (dialogText.length > maxChars) {
                dialogText = dialogText.slice(-maxChars)
                truncatedNote = '\n\n⚠️ 消息过长，已截断到最近部分。'
            }

            const participants = new Set(recentMessages.map(m => m.nickname || m.userId || '用户'))
            const userStats = {}
            const hourlyActivity = Array(24).fill(0)

            for (const msg of recentMessages) {
                const name = msg.nickname || msg.userId || '用户'
                const odId = msg.userId || null
                if (!userStats[name]) {
                    userStats[name] = { name, odId, count: 0, lastMsg: '' }
                }
                userStats[name].count++
                if (msg.content) {
                    userStats[name].lastMsg = msg.content.substring(0, 30)
                }
                if (msg.timestamp) {
                    const hour = new Date(msg.timestamp).getHours()
                    hourlyActivity[hour]++
                }
            }

            const topUsers = Object.values(userStats)
                .sort((a, b) => b.count - a.count)
                .slice(0, 8)
                .map(u => ({
                    name: u.name,
                    count: u.count,
                    odId: u.odId,
                    avatar: u.odId ? `https://q1.qlogo.cn/g?b=qq&nk=${u.odId}&s=0` : null
                }))

            // 提取关键词（简单词频统计）
            const wordCounts = {}
            const stopWords = new Set([
                '的',
                '了',
                '是',
                '我',
                '你',
                '他',
                '她',
                '它',
                '们',
                '这',
                '那',
                '有',
                '在',
                '吗',
                '啊',
                '呢',
                '吧',
                '嗯',
                '哦',
                '哈',
                '呀',
                '好',
                '不',
                '也',
                '都',
                '就',
                '和',
                '与',
                '但',
                '而',
                '或',
                '一',
                '个',
                '什么',
                '怎么',
                '为什么',
                '可以',
                '没有',
                '还是',
                '已经',
                '可能',
                '应该',
                '因为',
                '所以',
                '如果',
                '虽然',
                '然后',
                '现在',
                '知道',
                '觉得',
                '看看',
                '说说'
            ])
            for (const msg of recentMessages) {
                const content = typeof msg.content === 'string' ? msg.content : ''
                const words = content.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g) || []
                for (const word of words) {
                    if (!stopWords.has(word) && word.length >= 2) {
                        wordCounts[word] = (wordCounts[word] || 0) + 1
                    }
                }
            }
            const keywords = Object.entries(wordCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 12)
                .map(([word, count]) => ({ word, count }))

            // 互动关系（@关系统计）
            const interactionMap = {}
            for (const msg of recentMessages) {
                const content = typeof msg.content === 'string' ? msg.content : ''
                const from = msg.nickname || '用户'
                const atMatches = content.match(/@([^\s@]+)/g) || []
                for (const at of atMatches) {
                    const to = at.replace('@', '')
                    if (to && to !== from && to !== '全体成员') {
                        const key = `${from}->${to}`
                        if (!interactionMap[key]) {
                            interactionMap[key] = { from, to, count: 0 }
                        }
                        interactionMap[key].count++
                    }
                }
            }
            const interactions = Object.values(interactionMap)
                .sort((a, b) => b.count - a.count)
                .slice(0, 3)

            // 群聊氛围（基于简单规则估算）
            const totalMsgs = recentMessages.length
            const avgMsgLen = recentMessages.reduce((sum, m) => sum + (m.content?.length || 0), 0) / (totalMsgs || 1)
            const emojiCount = recentMessages.filter(m => /[\u{1F300}-\u{1F9FF}]|[😀-🙏]/u.test(m.content || '')).length
            const atmosphere = {
                positivity: Math.min(95, Math.round(50 + (emojiCount / totalMsgs) * 100 + Math.random() * 20)),
                activity: Math.min(95, Math.round(30 + Math.min(totalMsgs / 3, 50) + Math.random() * 15)),
                interaction: Math.min(
                    95,
                    Math.round(
                        20 + interactions.length * 15 + Object.keys(interactionMap).length * 5 + Math.random() * 10
                    )
                )
            }

            // 精彩语录（选取较长且有趣的消息）
            const quotes = recentMessages
                .filter(m => {
                    const content = typeof m.content === 'string' ? m.content : ''
                    return (
                        content.length >= 15 && content.length <= 100 && !content.startsWith('[') && !/^@/.test(content)
                    )
                })
                .sort(() => Math.random() - 0.5)
                .slice(0, 3)
                .map(m => ({
                    content: m.content.substring(0, 80),
                    author: m.nickname || '群友'
                }))

            const summaryPrompt = `请根据以下群聊记录，对群聊内容进行全面的总结分析。请从以下几个维度进行分析，并以清晰、有条理的Markdown格式呈现你的结论：

## 分析维度

1. **🔥 热门话题**：群友们最近在讨论什么话题？有哪些热点事件或共同关注的内容？按热度排序列出主要话题。

2. **👥 活跃成员**：哪些成员发言最多？简要描述他们的发言特点和主要讨论内容。

3. **💬 群聊氛围**：群聊的整体氛围如何？（例如：轻松愉快、严肃认真、热烈讨论等）

4. **📌 关键信息**：有没有重要的通知、决定或值得关注的信息？

5. **🎯 话题趋势**：群聊话题有什么变化趋势？

6. **💡 精彩瞬间**：有哪些有趣的对话、金句或值得记录的互动？

## 注意事项
- 请保持客观中立，如实反映群聊内容
- 对于敏感话题请谨慎处理
- 总结要简洁明了，突出重点

---

以下是最近的群聊记录（共 ${recentMessages.length} 条消息，${participants.size} 位参与者）：

${dialogText}${truncatedNote}`

            const groupSummaryModel = await getGroupFeatureModel(e.group_id, 'summaryModel')
            let summaryText = ''
            let result = null
            try {
                result = await chatService.sendMessage({
                    userId: `summary_${e.group_id}`,
                    groupId: null,
                    message: summaryPrompt,
                    model: groupSummaryModel || undefined,
                    mode: 'chat',
                    skipHistory: true,
                    disableTools: true,
                    skipPersona: true
                })

                if (result.response && Array.isArray(result.response)) {
                    summaryText = result.response
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                }
            } catch (invokeErr) {
                logger.error('[AI-Commands] 调用模型生成群聊总结失败:', invokeErr)
                await this.reply(`群聊总结生成失败：${invokeErr.message || '模型调用异常'}`, true)
                return true
            }

            if (summaryText) {
                try {
                    const actualModel =
                        result?.model || groupSummaryModel || config.get('llm.defaultModel') || '默认模型'
                    const shortModel = actualModel.split('/').pop()

                    // 使用深色现代风格渲染
                    const imageBuffer = await renderService.renderGroupSummaryModern(summaryText, {
                        title: '今日群聊',
                        subtitle: `${shortModel} · ${dataSource}`,
                        messageCount: messages.length,
                        participantCount: participants.size,
                        topUsers,
                        hourlyActivity,
                        keywords,
                        interactions,
                        atmosphere,
                        quotes
                    })
                    await this.reply(segment.image(imageBuffer))
                } catch (renderErr) {
                    const fallbackModel =
                        result?.model || groupSummaryModel || config.get('llm.defaultModel') || '默认模型'
                    const fallbackShortModel = fallbackModel.split('/').pop()
                    logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                    await this.reply(
                        `📊 今日群聊 (${messages.length}条消息 · ${fallbackShortModel})\n\n${summaryText}`,
                        true
                    )
                }
            } else {
                await this.reply('总结生成失败', true)
            }
        } catch (error) {
            logger.error('[AI-Commands] Group summary modern error:', error)
            await this.reply('群聊总结失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 个人画像分析
     */
    async userPortrait() {
        const e = this.e
        if (!config.get('features.userPortrait.enabled')) {
            await this.reply('个人画像功能未启用', true)
            return true
        }

        try {
            await this.reply('正在分析用户画像...', true)

            databaseService.init()
            const groupId = e.group_id
            const userId = e.user_id
            const nickname = e.sender?.nickname || '用户'
            const minMessages = config.get('features.userPortrait.minMessages') || 10

            /* conversationId 格式与 ChatService 保持一致：群聊 group:${gid}，私聊 user:${uid} */
            const conversationId = groupId ? `group:${groupId}` : `user:${userId}`
            // 读取配置的消息数量限制 - 优先使用前端配置
            const maxMessages =
                config.get('features.groupSummary.maxMessages') || config.get('memory.maxMemories') || 100
            const analyzeCount = Math.min(maxMessages, 100)

            const allMessages = databaseService.getMessages(conversationId, maxMessages)
            const userMessages = allMessages.filter(m => m.role === 'user')

            if (userMessages.length < minMessages) {
                await this.reply(`消息数量不足（需要至少${minMessages}条），无法生成画像`, true)
                return true
            }

            // 获取模型信息
            const modelName = config.get('llm.defaultModel') || '默认模型'
            const shortModel = modelName.split('/').pop()

            const portraitPrompt = `请根据以下用户的发言记录，分析并生成用户画像：

用户昵称：${nickname}
发言记录：
${userMessages
    .slice(-analyzeCount)
    .map(m => {
        const text = Array.isArray(m.content)
            ? m.content
                  .filter(c => c.type === 'text')
                  .map(c => c.text)
                  .join('')
            : m.content
        return text
    })
    .join('\n')}

请从以下维度分析：
1. 🎭 性格特点
2. 💬 说话风格
3. 🎯 兴趣爱好
4. 🧠 思维方式
5. 📊 活跃度评估
6. 🏷️ 标签总结（3-5个关键词）`

            const result = await chatService.sendMessage({
                userId: `portrait_${userId}`,
                groupId: null, // 不传群ID，避免继承群人设
                message: portraitPrompt,
                mode: 'chat',
                skipHistory: true, // 跳过历史记录
                disableTools: true, // 禁用工具
                skipPersona: true // 跳过人设获取，不使用任何人设风格
            })

            let portraitText = ''
            if (result.response && Array.isArray(result.response)) {
                portraitText = result.response
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            }

            if (portraitText) {
                try {
                    // 渲染为图片
                    const analyzedCount = Math.min(userMessages.length, analyzeCount)
                    const imageBuffer = await renderService.renderUserProfile(portraitText, nickname, {
                        title: '用户画像分析',
                        subtitle: `基于 ${analyzedCount} 条发言记录 · ${shortModel}`,
                        userId: userId,
                        messageCount: analyzedCount
                    })
                    await this.reply(segment.image(imageBuffer))
                } catch (renderErr) {
                    // 回退到文本
                    logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                    await this.reply(`🎭 ${nickname} 的个人画像\n模型: ${shortModel}\n\n${portraitText}`, true)
                }
            } else {
                await this.reply('画像生成失败', true)
            }
        } catch (error) {
            logger.error('[AI-Commands] User portrait error:', error)
            await this.reply('个人画像失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 查看我的记忆
     */
    async viewMemory() {
        const e = this.e
        try {
            await memoryManager.init()

            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null

            // 获取用户记忆
            let userMemories = (await memoryManager.getMemories(String(userId))) || []

            // 如果在群里，也获取群内用户记忆
            let groupUserMemories = []
            if (groupId) {
                groupUserMemories = (await memoryManager.getMemories(`${groupId}_${userId}`)) || []
            }

            let allMemories = [...userMemories, ...groupUserMemories]

            if (allMemories.length === 0) {
                await this.reply(
                    '📭 暂无记忆记录\n\n💡 与AI聊天时，重要信息会被自动记住\n💡 在群里多聊几句后再试试',
                    true
                )
                return true
            }

            // 按时间排序，最新在前
            allMemories.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))

            // 最多显示15条
            const displayMemories = allMemories.slice(0, 15)

            const memoryList = displayMemories
                .map((m, i) => {
                    const time = m.timestamp ? new Date(m.timestamp).toLocaleDateString('zh-CN') : '未知'
                    const importance = m.importance ? `[${m.importance}]` : ''
                    return `${i + 1}. ${m.content.substring(0, 60)}${m.content.length > 60 ? '...' : ''}\n   📅 ${time} ${importance}`
                })
                .join('\n\n')

            // 解析元数据的辅助函数
            const getMetaInfo = m => {
                const meta = m.metadata || {}
                const parts = []
                // 来源
                const sourceMap = {
                    poll_summary: '定时总结',
                    auto_extract: '自动提取',
                    group_context: '群聊分析',
                    manual: '手动添加'
                }
                if (meta.source) parts.push(sourceMap[meta.source] || meta.source)
                // 模型（简化显示）
                if (meta.model) {
                    const shortModel = meta.model.split('/').pop().split('-')[0]
                    parts.push(shortModel)
                }
                return parts.length > 0 ? parts.join(' · ') : ''
            }

            // 构建 Markdown
            const markdown = [
                `## 🧠 我的记忆 (共${allMemories.length}条)`,
                ``,
                ...displayMemories.map((m, i) => {
                    const time = m.timestamp ? new Date(m.timestamp).toLocaleDateString('zh-CN') : '未知'
                    const importance = m.importance ? ` **[${m.importance}]**` : ''
                    const metaInfo = getMetaInfo(m)
                    const metaLine = metaInfo ? ` · ${metaInfo}` : ''
                    return `${i + 1}. ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}\n   - 📅 ${time}${importance}${metaLine}`
                }),
                ``,
                allMemories.length > 15 ? `> 📝 仅显示最近15条` : '',
                ``,
                `---`,
                `**💡 提示:** 使用 \`#清除记忆\` 可清空所有记忆`
            ]
                .filter(Boolean)
                .join('\n')

            try {
                const nickname = e.sender?.nickname || '用户'
                const imageBuffer = await renderService.renderMarkdownToImage({
                    markdown,
                    title: '我的记忆',
                    subtitle: nickname,
                    icon: '🧠',
                    showTimestamp: true
                })
                await this.reply(segment.image(imageBuffer))
            } catch (renderErr) {
                // 回退到文本
                logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                const textReply = [
                    `🧠 我的记忆 (共${allMemories.length}条)`,
                    `━━━━━━━━━━━━`,
                    memoryList,
                    `━━━━━━━━━━━━`,
                    `💡 #清除记忆 可清空所有记忆`
                ].join('\n')
                await this.reply(textReply, true)
            }
        } catch (error) {
            logger.error('[AI-Commands] View memory error:', error)
            await this.reply('获取记忆失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 查看群记忆
     */
    async viewGroupMemory() {
        const e = this.e
        if (!e.group_id) {
            await this.reply('此功能仅支持群聊', true)
            return true
        }

        try {
            await memoryManager.init()

            const groupId = e.group_id

            // 获取群聊相关记忆
            const groupContext = await memoryManager.getGroupContext(String(groupId))

            const topics = groupContext?.topics || []
            const relations = groupContext?.relations || []
            const userInfos = groupContext?.userInfos || []

            if (topics.length === 0 && relations.length === 0 && userInfos.length === 0) {
                await this.reply('📭 暂无群聊记忆\n\n💡 群聊活跃后会自动分析并记录', true)
                return true
            }

            const parts = [`🏠 群聊记忆 [${groupId}]`, `━━━━━━━━━━━━`]

            if (topics.length > 0) {
                parts.push(`\n📌 话题记忆 (${topics.length}条)`)
                topics.slice(0, 5).forEach((t, i) => {
                    parts.push(`  ${i + 1}. ${t.content?.substring(0, 50) || t}`)
                })
            }

            if (userInfos.length > 0) {
                parts.push(`\n👤 成员记忆 (${userInfos.length}条)`)
                userInfos.slice(0, 5).forEach((u, i) => {
                    parts.push(`  ${i + 1}. ${u.content?.substring(0, 50) || u}`)
                })
            }

            if (relations.length > 0) {
                parts.push(`\n🔗 关系记忆 (${relations.length}条)`)
                relations.slice(0, 3).forEach((r, i) => {
                    parts.push(`  ${i + 1}. ${r.content?.substring(0, 50) || r}`)
                })
            }

            // 构建 Markdown
            const markdownParts = [`## 🏠 群聊记忆`, ``]

            if (topics.length > 0) {
                markdownParts.push(`### 📌 话题记忆 (${topics.length}条)`)
                topics.slice(0, 5).forEach((t, i) => {
                    markdownParts.push(`${i + 1}. ${t.content?.substring(0, 60) || t}`)
                })
                markdownParts.push('')
            }

            if (userInfos.length > 0) {
                markdownParts.push(`### 👤 成员记忆 (${userInfos.length}条)`)
                userInfos.slice(0, 5).forEach((u, i) => {
                    markdownParts.push(`${i + 1}. ${u.content?.substring(0, 60) || u}`)
                })
                markdownParts.push('')
            }

            if (relations.length > 0) {
                markdownParts.push(`### 🔗 关系记忆 (${relations.length}条)`)
                relations.slice(0, 3).forEach((r, i) => {
                    markdownParts.push(`${i + 1}. ${r.content?.substring(0, 60) || r}`)
                })
                markdownParts.push('')
            }

            markdownParts.push(`---`)
            markdownParts.push(`> 💡 群聊记忆通过分析群消息自动生成`)

            try {
                const imageBuffer = await renderService.renderMarkdownToImage({
                    markdown: markdownParts.join('\n'),
                    title: '群聊记忆',
                    subtitle: `群号: ${groupId}`,
                    icon: '🏠',
                    showTimestamp: true
                })
                await this.reply(segment.image(imageBuffer))
            } catch (renderErr) {
                // 回退到文本
                logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                parts.push(`\n━━━━━━━━━━━━`)
                parts.push(`💡 群聊记忆通过分析群消息自动生成`)
                await this.reply(parts.join('\n'), true)
            }
        } catch (error) {
            logger.error('[AI-Commands] View group memory error:', error)
            await this.reply('获取群记忆失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 用户画像 - 支持@指定用户
     * #画像 @xxx 或 #画像（分析自己）
     */
    async userProfileByAt() {
        const e = this.e
        if (!e.group_id) {
            await this.reply('此功能仅支持群聊', true)
            return true
        }

        // 检查是否是 #画像总结（已有单独命令处理）
        if (e.msg.includes('总结')) {
            return false // 让 groupSummary 处理
        }

        try {
            // 查找消息中的@（排除@机器人）
            let targetUserId = e.user_id
            let targetNickname = e.sender?.card || e.sender?.nickname || '用户'

            const atMsg = e.message?.find(msg => msg.type === 'at' && String(msg.qq) !== String(e.self_id))

            if (atMsg && atMsg.qq) {
                targetUserId = atMsg.qq
                try {
                    const memberInfo = await getMemberInfo(e, targetUserId)
                    if (!memberInfo) {
                        await this.reply('未找到该用户信息', true)
                        return true
                    }
                    targetNickname = memberInfo.card || memberInfo.nickname || String(targetUserId)
                } catch (err) {
                    logger.error(`[AI-Commands] 获取用户 ${targetUserId} 信息失败:`, err)
                    await this.reply('获取用户信息失败', true)
                    return true
                }
            }

            await this.reply(`正在分析 ${targetNickname} 的用户画像...`, true)

            // 获取用户聊天记录 - 使用配置项
            const maxMessages =
                config.get('features.groupSummary.maxMessages') || config.get('memory.maxMemories') || 100
            const userMessages = await getUserTextHistory(e, targetUserId, maxMessages)

            // 获取模型信息
            const modelName = config.get('llm.defaultModel') || '默认模型'
            const shortModel = modelName.split('/').pop()

            if (!userMessages || userMessages.length < 10) {
                await this.reply(`${targetNickname} 的聊天记录太少（需要至少10条），无法生成画像`, true)
                return true
            }

            // 格式化消息
            const formattedLines = await Promise.all(
                userMessages.map(async chat => {
                    const time = new Date(chat.time * 1000).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    })

                    // 处理消息内容
                    const contentParts = await Promise.all(
                        (chat.message || []).map(async part => {
                            if (part.type === 'text') return part.text
                            if (part.type === 'at') {
                                if (part.qq === 'all' || part.qq === 0) return '@全体成员'
                                try {
                                    const info = await getMemberInfo(e, part.qq)
                                    return `@${info?.card || info?.nickname || part.qq}`
                                } catch {
                                    return `@${part.qq}`
                                }
                            }
                            return ''
                        })
                    )

                    return `[${time}] ${contentParts.join('')}`
                })
            )

            const rawChatHistory = formattedLines.join('\n')

            // AI分析提示
            const aiPrompt = `请根据【${targetNickname}】在群聊中的发言记录，对该用户进行全面的画像分析。请从以下几个维度进行分析，并以清晰、有条理的Markdown格式呈现你的结论：

1. **🎭 性格特点**：分析用户的性格倾向和个性特征
2. **💬 语言风格**：用户的说话风格是怎样的？（例如：正式、口语化、幽默、简洁等）
3. **🎯 关键主题**：分析用户最常讨论的话题或感兴趣的领域是什么？
4. **⏰ 活跃时段**：根据发言时间，分析用户的活跃时间段，推测其作息习惯
5. **👥 社交关系**：用户与哪些群成员互动最频繁？（根据@记录）
6. **🏷️ 标签总结**：用3-5个关键词概括此用户

以下是用户【${targetNickname}】的发言记录（共${userMessages.length}条）：
${rawChatHistory}`

            const result = await chatService.sendMessage({
                userId: `profile_${targetUserId}`,
                groupId: null, // 不传群ID，避免继承群人设
                message: aiPrompt,
                mode: 'chat',
                skipHistory: true, // 跳过历史记录
                disableTools: true, // 禁用工具
                prefixPersona: null // 明确不使用人设
            })

            let profileText = ''
            if (result.response && Array.isArray(result.response)) {
                profileText = result.response
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            }

            if (profileText) {
                try {
                    const imageBuffer = await renderService.renderUserProfile(profileText, targetNickname, {
                        title: '用户画像分析',
                        subtitle: `基于 ${userMessages.length} 条发言记录 · ${shortModel}`,
                        userId: targetUserId,
                        messageCount: userMessages.length
                    })
                    await this.reply(segment.image(imageBuffer))
                } catch (renderErr) {
                    logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                    await this.reply(`🎭 ${targetNickname} 的用户画像\n\n${profileText}`, true)
                }
            } else {
                await this.reply('画像生成失败', true)
            }
        } catch (error) {
            logger.error('[AI-Commands] User profile by at error:', error)
            await this.reply('用户画像分析失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 今日词云分析
     * #今日词云 / #词云 / #群词云
     */
    async todayWordCloud() {
        const e = this.e
        if (!e.group_id) {
            await this.reply('此功能仅支持群聊', true)
            return true
        }

        try {
            await this.reply('正在生成今日词云...', true)

            const groupId = String(e.group_id)
            const maxMessages = config.get('features.wordCloud.maxMessages') || 5000
            await memoryManager.init()
            let messages = []
            let dataSource = ''
            try {
                const history = await getGroupChatHistory(e, maxMessages)
                if (history && history.length > 0) {
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)
                    const todayTs = today.getTime() / 1000

                    const todayMessages = history.filter(msg => {
                        const msgTime = msg.time || 0
                        return msgTime >= todayTs
                    })

                    messages = todayMessages
                        .map(msg => {
                            const contentParts = (msg.message || [])
                                .filter(part => part.type === 'text')
                                .map(part => part.text)
                            return {
                                content: contentParts.join(''),
                                timestamp: msg.time ? msg.time * 1000 : Date.now()
                            }
                        })
                        .filter(m => m.content && m.content.trim())

                    if (messages.length > 0) dataSource = 'Bot API'
                }
            } catch (historyErr) {
                logger.debug('[AI-Commands] Bot API 获取群聊历史失败:', historyErr.message)
            }
            if (messages.length < 10) {
                const memoryMessages = memoryManager.getGroupMessageBuffer?.(groupId) || []
                if (memoryMessages.length > 0) {
                    const today = new Date()
                    today.setHours(0, 0, 0, 0)
                    const todayTs = today.getTime()

                    const todayMemMessages = memoryMessages
                        .filter(m => m.timestamp >= todayTs)
                        .map(m => ({
                            content: m.content || '',
                            timestamp: m.timestamp
                        }))

                    if (todayMemMessages.length > messages.length) {
                        messages = todayMemMessages
                        dataSource = '内存缓冲'
                    }
                }
            }
            if (messages.length < 10) {
                try {
                    databaseService.init()
                    const conversationId = `group_summary_${groupId}`
                    const rawDbMessages = databaseService.getMessages(conversationId, maxMessages)
                    if (rawDbMessages && rawDbMessages.length > 0) {
                        const today = new Date()
                        today.setHours(0, 0, 0, 0)
                        const todayTs = today.getTime()

                        const todayDbMessages = rawDbMessages
                            .filter(m => m.timestamp >= todayTs)
                            .map(m => ({
                                content:
                                    typeof m.content === 'string'
                                        ? m.content
                                        : Array.isArray(m.content)
                                          ? m.content
                                                .filter(c => c.type === 'text')
                                                .map(c => c.text)
                                                .join('')
                                          : '',
                                timestamp: m.timestamp
                            }))
                            .filter(m => m.content && m.content.trim())

                        if (todayDbMessages.length > messages.length) {
                            messages = todayDbMessages
                            dataSource = '数据库'
                        }
                    }
                } catch (dbErr) {
                    logger.debug('[AI-Commands] 从数据库读取群消息失败:', dbErr.message)
                }
            }

            if (messages.length < 5) {
                await this.reply('今日群聊消息太少，无法生成词云\n\n💡 提示：需要今天有足够的聊天记录（至少5条）', true)
                return true
            }
            const wordFreq = this.analyzeWordFrequency(messages.map(m => m.content))

            if (wordFreq.length < 5) {
                await this.reply('有效词汇太少，无法生成词云', true)
                return true
            }
            try {
                const imageBuffer = await renderService.renderWordCloud(wordFreq, {
                    title: '今日词云',
                    subtitle: `基于 ${messages.length} 条消息 · ${dataSource}`,
                    width: 800,
                    height: 600
                })
                await this.reply(segment.image(imageBuffer))
            } catch (renderErr) {
                logger.warn('[AI-Commands] 渲染词云失败:', renderErr.message)
                // 回退到文本
                const topWords = wordFreq
                    .slice(0, 20)
                    .map((w, i) => `${i + 1}. ${w.word} (${w.weight}次)`)
                    .join('\n')
                await this.reply(`☁️ 今日词云 (${messages.length}条消息)\n━━━━━━━━━━━━\n${topWords}`, true)
            }
        } catch (error) {
            logger.error('[AI-Commands] Word cloud error:', error)
            await this.reply('词云生成失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 分析词频
     * @param {string[]} texts - 文本数组
     * @returns {Array<{word: string, weight: number}>}
     */
    analyzeWordFrequency(texts) {
        const wordMap = new Map()

        // 停用词列表
        const stopWords = new Set([
            '的',
            '了',
            '是',
            '在',
            '我',
            '有',
            '和',
            '就',
            '不',
            '人',
            '都',
            '一',
            '一个',
            '上',
            '也',
            '很',
            '到',
            '说',
            '要',
            '去',
            '你',
            '会',
            '着',
            '没有',
            '看',
            '好',
            '自己',
            '这',
            '那',
            '他',
            '她',
            '它',
            '们',
            '什么',
            '吗',
            '啊',
            '呢',
            '吧',
            '嗯',
            '哦',
            '哈',
            '呀',
            '诶',
            '嘿',
            '哎',
            '唉',
            '噢',
            '额',
            '昂',
            '啦',
            '咯',
            '喔',
            '这个',
            '那个',
            '怎么',
            '为什么',
            '可以',
            '能',
            '想',
            '知道',
            '觉得',
            '还是',
            '但是',
            '因为',
            '所以',
            '如果',
            '虽然',
            '而且',
            '或者',
            '还',
            '又',
            '再',
            '才',
            '只',
            '从',
            '被',
            '把',
            '给',
            '让',
            '比',
            '等',
            '对',
            '跟',
            '向',
            '于',
            '并',
            '与',
            '及',
            '以',
            '用',
            '为',
            '由',
            '以及',
            '而',
            '且',
            '之',
            '其',
            '如',
            '则',
            '么',
            '来',
            '去',
            '过',
            '得',
            '地',
            '里',
            '后',
            '前',
            '中',
            '下',
            '多',
            '少',
            '大',
            '小',
            '好',
            '坏',
            '真',
            '假',
            '新',
            '旧',
            '高',
            '低',
            '长',
            '短',
            '快',
            '慢',
            '图片',
            '表情',
            '动画表情',
            '图片评论'
        ])

        for (const text of texts) {
            if (!text) continue

            // 清理文本：移除特殊格式
            let cleanText = text
                .replace(/\[.+?\]/g, '') // 移除 [图片] [表情] 等
                .replace(/@\S+/g, '') // 移除 @提及
                .replace(/https?:\/\/\S+/g, '') // 移除链接
                .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ') // 只保留中文、英文、数字

            // 简单分词：中文按字符组合，英文按单词
            // 提取2-4字的中文词组
            const chinesePattern = /[\u4e00-\u9fa5]{2,6}/g
            const chineseWords = cleanText.match(chinesePattern) || []

            // 提取英文单词
            const englishPattern = /[a-zA-Z]{2,}/g
            const englishWords = cleanText.match(englishPattern) || []

            // 统计词频
            const allWords = [...chineseWords, ...englishWords.map(w => w.toLowerCase())]

            for (const word of allWords) {
                if (stopWords.has(word) || word.length < 2) continue
                wordMap.set(word, (wordMap.get(word) || 0) + 1)
            }
        }

        // 转换为数组并排序
        const wordList = Array.from(wordMap.entries())
            .map(([word, weight]) => ({ word, weight }))
            .filter(w => w.weight >= 2) // 至少出现2次
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 80) // 最多80个词

        return wordList
    }
}

/**
 * 获取群成员信息
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @returns {Promise<Object|null>}
 */
async function getMemberInfo(e, userId) {
    try {
        const group = e.group || e.bot?.pickGroup?.(e.group_id)
        if (!group) return null

        // 尝试多种方式获取成员信息
        try {
            const member = group.pickMember?.(userId)
            if (member?.getInfo) {
                return await member.getInfo(true)
            }
            if (member?.info) {
                return member.info
            }
        } catch {}

        // 尝试从成员列表获取
        try {
            const memberMap = await group.getMemberMap?.()
            if (memberMap) {
                return memberMap.get(Number(userId)) || memberMap.get(String(userId))
            }
        } catch {}

        return null
    } catch (err) {
        return null
    }
}

/**
 * 获取群聊历史记录（分页获取）
 * @param {Object} e - 事件对象
 * @param {number} num - 需要的消息数量
 * @returns {Promise<Array>}
 */
async function getGroupChatHistory(e, num) {
    const group = e.group || e.bot?.pickGroup?.(e.group_id)
    if (!group || typeof group.getChatHistory !== 'function') {
        return []
    }

    try {
        let allChats = []
        let seq = e.seq || e.message_id || 0
        let totalScanned = 0
        const maxScanLimit = Math.min(num * 10, 5000) // 最多扫描5000条

        while (allChats.length < num && totalScanned < maxScanLimit) {
            const chatHistory = await group.getChatHistory(seq, 20)

            if (!chatHistory || chatHistory.length === 0) break

            totalScanned += chatHistory.length

            const oldestSeq = chatHistory[0]?.seq || chatHistory[0]?.message_id
            if (seq === oldestSeq) break
            seq = oldestSeq

            // 过滤有效消息（包含文本或@）
            const filteredChats = chatHistory.filter(chat => {
                if (!chat.message || chat.message.length === 0) return false
                return chat.message.some(part => part.type === 'text' || part.type === 'at')
            })

            if (filteredChats.length > 0) {
                allChats.unshift(...filteredChats.reverse())
            }
        }

        return allChats.slice(-num)
    } catch (err) {
        logger.error('[AI-Commands] 获取群聊记录失败:', err)
        return []
    }
}

/**
 * 获取指定用户的聊天记录
 * @param {Object} e - 事件对象
 * @param {string|number} userId - 用户ID
 * @param {number} num - 需要的消息数量
 * @returns {Promise<Array>}
 */
async function getUserTextHistory(e, userId, num) {
    const group = e.group || e.bot?.pickGroup?.(e.group_id)
    if (!group || typeof group.getChatHistory !== 'function') {
        return []
    }

    try {
        let userChats = []
        let seq = e.seq || e.message_id || 0
        let totalScanned = 0
        const maxScanLimit = 3000 // 最多扫描3000条以找到足够的用户消息

        while (userChats.length < num && totalScanned < maxScanLimit) {
            const chatHistory = await group.getChatHistory(seq, 20)

            if (!chatHistory || chatHistory.length === 0) break

            totalScanned += chatHistory.length

            const oldestSeq = chatHistory[0]?.seq || chatHistory[0]?.message_id
            if (seq === oldestSeq) break
            seq = oldestSeq

            // 过滤目标用户的消息
            const filteredChats = chatHistory.filter(chat => {
                const isTargetUser = String(chat.sender?.user_id) === String(userId)
                if (!isTargetUser) return false
                if (!chat.message || chat.message.length === 0) return false
                return chat.message.some(part => part.type === 'text' || part.type === 'at')
            })

            if (filteredChats.length > 0) {
                userChats.unshift(...filteredChats.reverse())
            }
        }

        return userChats.slice(-num)
    } catch (err) {
        logger.error('[AI-Commands] 获取用户聊天记录失败:', err)
        return []
    }
}

export { isDebugEnabled, setDebugMode, getDebugSessions }
