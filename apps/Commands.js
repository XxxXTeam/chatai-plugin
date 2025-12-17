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
import { getScopeManager } from '../src/services/scope/ScopeManager.js'

// Debug模式状态管理（运行时内存，重启后重置）
const debugSessions = new Map()  // key: groupId或`private_${userId}`, value: boolean

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
            priority: -100,  // 最高优先级，确保命令不被其他插件抢占（数值越小优先级越高）
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
                    reg: '^#(群聊总结|总结群聊|群消息总结|画像总结)$',
                    fnc: 'groupSummary'
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
                }
            ]
        })
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
        
        await this.reply(`✅ Debug模式已${status}\n📍 作用范围: ${scope}\n💡 ${enabled ? '后续消息将输出详细日志' : '已恢复正常模式'}\n⚠️ 重启后状态将重置`, true)
        
        logger.info(`[AI-Commands] Debug模式${status}: ${key}`)
        return true
    }
    async endConversation() {
        const e = this.e
        try {
            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null
            const fullUserId = groupId ? `${groupId}_${userId}` : userId

            // 获取清理前的统计
            databaseService.init()
            const messages = databaseService.getMessages(fullUserId, 1000)
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
            const userMemories = await memoryManager.getMemories(String(userId)) || []
            let groupUserMemories = []
            if (groupId) {
                groupUserMemories = await memoryManager.getMemories(fullUserId) || []
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
            const fullUserId = groupId ? `${groupId}_${userId}` : userId

            // 获取对话历史
            const messages = databaseService.getMessages(fullUserId, 100)
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
            const llmService = new LlmService()
            const chatModel = llmService.getModel('chat')
            
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
                const scopeManager = getScopeManager(databaseService)
                await scopeManager.init()
                const scopeConfig = await scopeManager.getEffectiveConfig(groupId, String(userId))
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
            const formatTokens = (n) => {
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
                `- **#chatdebug** - 切换调试模式`,
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
                    `🔧 Debug: ${debugEnabled}`,
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
     * 群聊总结
     */
    async groupSummary() {
        const e = this.e
        if (!e.group_id) {
            await this.reply('此功能仅支持群聊', true)
            return true
        }

        if (!config.get('features.groupSummary.enabled')) {
            await this.reply('群聊总结功能未启用', true)
            return true
        }

        try {
            await this.reply('正在分析群聊消息...', true)
            
            const maxMessages = config.get('features.groupSummary.maxMessages') || 100
            const groupId = String(e.group_id)
            
            // 1. 优先使用内存缓冲区（实时数据）
            await memoryManager.init()
            let messages = memoryManager.getGroupMessageBuffer(groupId)
            let dataSource = '内存缓冲'
            
            // 2. 如果内存不足，从数据库读取持久化的群消息
            if (messages.length < 5) {
                try {
                    databaseService.init()
                    const conversationId = `group_summary_${groupId}`
                    const dbMessages = databaseService.getMessages(conversationId, maxMessages)
                    if (dbMessages && dbMessages.length > 0) {
                        messages = dbMessages.map(m => ({
                            nickname: m.metadata?.nickname || '用户',
                            content: typeof m.content === 'string' ? m.content : 
                                (Array.isArray(m.content) ? m.content.filter(c => c.type === 'text').map(c => c.text).join('') : String(m.content)),
                            timestamp: m.timestamp
                        })).filter(m => m.content && m.content.trim())
                        dataSource = '数据库'
                    }
                } catch (dbErr) {
                    logger.debug('[AI-Commands] 从数据库读取群消息失败:', dbErr.message)
                }
            }
            
            // 3. 最后尝试 bot API 获取群聊历史（增强版，支持分页获取更多消息）
            if (messages.length < 5) {
                try {
                    const history = await getGroupChatHistory(e, maxMessages)
                    if (history && history.length > 0) {
                        messages = await Promise.all(history.map(async msg => {
                            // 获取发送者昵称
                            let nickname = msg.sender?.card || msg.sender?.nickname || '用户'
                            
                            // 处理消息内容，包括@解析
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
                        }))
                        messages = messages.filter(m => m.content && m.content.trim())
                        dataSource = 'Bot API'
                    }
                } catch (historyErr) {
                    logger.debug('[AI-Commands] 获取群聊历史失败:', historyErr.message)
                }
            }
            
            if (messages.length < 5) {
                await this.reply('群聊消息太少，无法生成总结\n\n💡 提示：需要在群里有足够的聊天记录\n请确保：\n1. 群聊消息采集已启用 (trigger.collectGroupMsg)\n2. 群里已有一定量的聊天记录', true)
                return true
            }

            // 构建总结提示
            const recentMessages = messages.slice(-maxMessages)
            const dialogText = recentMessages.map(m => {
                // 处理已格式化的消息（来自数据库）和原始消息
                if (typeof m.content === 'string' && m.content.startsWith('[')) {
                    return m.content  // 已格式化
                }
                const content = typeof m.content === 'string' ? m.content : 
                    (Array.isArray(m.content) ? m.content.filter(c => c.type === 'text').map(c => c.text).join('') : m.content)
                return `[${m.nickname || '用户'}]: ${content}`
            }).join('\n')
            
            // 统计参与者
            const participants = new Set(recentMessages.map(m => m.nickname || m.userId || '用户'))
            
            const summaryPrompt = `请分析以下群聊记录并生成结构化总结：

【群聊记录】
${dialogText}

【输出要求】
请严格按以下格式输出，使用 emoji 美化：

📌 **核心话题** (2-3个最主要的讨论话题)
• 话题1：简要描述
• 话题2：简要描述

💬 **关键讨论**
列出最重要的观点交流（3-5条）

👥 **活跃成员**
最活跃的发言者及其主要贡献

📊 **氛围评估**
一句话总结群聊氛围和互动质量

⏰ **时间范围**
总结的消息时间跨度

注意：
- 保持简洁，每项不超过2-3行
- 使用要点形式，避免长段落
- 如有争议或有趣的互动，优先提取`

            const result = await chatService.sendMessage({
                userId: `summary_${e.group_id}`,
                message: summaryPrompt,
                mode: 'chat'
            })

            let summaryText = ''
            if (result.response && Array.isArray(result.response)) {
                summaryText = result.response
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            }

            if (summaryText) {
                try {
                    // 渲染为图片
                    const imageBuffer = await renderService.renderGroupSummary(summaryText, {
                        title: '群聊内容总结',
                        subtitle: `基于 ${messages.length} 条消息 · 数据源: ${dataSource}`,
                        messageCount: messages.length
                    })
                    await this.reply(segment.image(imageBuffer))
                } catch (renderErr) {
                    // 回退到文本
                    logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                    await this.reply(`📊 群聊总结 (${messages.length}条消息)\n\n${summaryText}`, true)
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
            
            const userKey = groupId ? `${groupId}_${userId}` : String(userId)
            const messages = databaseService.getMessages(userKey, 200)
            const userMessages = messages.filter(m => m.role === 'user')
            
            if (userMessages.length < minMessages) {
                await this.reply(`消息数量不足（需要至少${minMessages}条），无法生成画像`, true)
                return true
            }

            const portraitPrompt = `请根据以下用户的发言记录，分析并生成用户画像：

用户昵称：${nickname}
发言记录：
${userMessages.slice(-50).map(m => {
    const text = Array.isArray(m.content) 
        ? m.content.filter(c => c.type === 'text').map(c => c.text).join('') 
        : m.content
    return text
}).join('\n')}

请从以下维度分析：
1. 🎭 性格特点
2. 💬 说话风格
3. 🎯 兴趣爱好
4. 🧠 思维方式
5. 📊 活跃度评估
6. 🏷️ 标签总结（3-5个关键词）`

            const result = await chatService.sendMessage({
                userId: `portrait_${userId}`,
                message: portraitPrompt,
                mode: 'chat'
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
                    const imageBuffer = await renderService.renderUserProfile(portraitText, nickname, {
                        title: '用户画像分析',
                        subtitle: `基于 ${userMessages.length} 条发言记录`
                    })
                    await this.reply(segment.image(imageBuffer))
                } catch (renderErr) {
                    // 回退到文本
                    logger.warn('[AI-Commands] 渲染图片失败:', renderErr.message)
                    await this.reply(`🎭 ${nickname} 的个人画像\n\n${portraitText}`, true)
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
            const userMemories = await memoryManager.getMemories(String(userId)) || []
            
            // 如果在群里，也获取群内用户记忆
            let groupUserMemories = []
            if (groupId) {
                groupUserMemories = await memoryManager.getMemories(`${groupId}_${userId}`) || []
            }
            
            const allMemories = [...userMemories, ...groupUserMemories]
            
            if (allMemories.length === 0) {
                await this.reply('📭 暂无记忆记录\n\n💡 与AI聊天时，重要信息会被自动记住', true)
                return true
            }
            
            // 按时间排序，最新在前
            allMemories.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            
            // 最多显示15条
            const displayMemories = allMemories.slice(0, 15)
            
            const memoryList = displayMemories.map((m, i) => {
                const time = m.timestamp ? new Date(m.timestamp).toLocaleDateString('zh-CN') : '未知'
                const importance = m.importance ? `[${m.importance}]` : ''
                return `${i + 1}. ${m.content.substring(0, 60)}${m.content.length > 60 ? '...' : ''}\n   📅 ${time} ${importance}`
            }).join('\n\n')
            
            // 构建 Markdown
            const markdown = [
                `## 🧠 我的记忆 (共${allMemories.length}条)`,
                ``,
                ...displayMemories.map((m, i) => {
                    const time = m.timestamp ? new Date(m.timestamp).toLocaleDateString('zh-CN') : '未知'
                    const importance = m.importance ? ` **[${m.importance}]**` : ''
                    return `${i + 1}. ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}\n   - 📅 ${time}${importance}`
                }),
                ``,
                allMemories.length > 15 ? `> 📝 仅显示最近15条` : '',
                ``,
                `---`,
                `**💡 提示:** 使用 \`#清除记忆\` 可清空所有记忆`
            ].filter(Boolean).join('\n')
            
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
            const markdownParts = [
                `## 🏠 群聊记忆`,
                ``
            ]
            
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
            return false  // 让 groupSummary 处理
        }

        try {
            // 查找消息中的@（排除@机器人）
            let targetUserId = e.user_id
            let targetNickname = e.sender?.card || e.sender?.nickname || '用户'
            
            const atMsg = e.message?.find(msg => 
                msg.type === 'at' && String(msg.qq) !== String(e.self_id)
            )

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

            // 获取用户聊天记录
            const maxMessages = 100
            const userMessages = await getUserTextHistory(e, targetUserId, maxMessages)

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
                message: aiPrompt,
                mode: 'chat'
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
                        subtitle: `基于 ${userMessages.length} 条发言记录`
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
}

// ================== 辅助函数 ==================

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
        const maxScanLimit = Math.min(num * 10, 2000)  // 最多扫描2000条

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
        const maxScanLimit = 3000  // 最多扫描3000条以找到足够的用户消息

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
