/**
 * AI 插件命令处理
 * 高优先级处理各种命令，避免被其他插件抢占
 */
import config from '../config/config.js'
import { chatService } from '../src/services/ChatService.js'
import { memoryManager } from '../src/services/MemoryManager.js'
import { databaseService } from '../src/services/DatabaseService.js'

// Debug模式状态管理（运行时内存，重启后重置）
const debugSessions = new Map()  // key: groupId或`private_${userId}`, value: boolean

/**
 * 检查是否启用debug模式
 * @param {Object} e - 事件对象
 * @returns {boolean}
 */
export function isDebugEnabled(e) {
    const key = e.group_id ? String(e.group_id) : `private_${e.user_id}`
    return debugSessions.get(key) === true
}

/**
 * 设置debug模式
 * @param {Object} e - 事件对象
 * @param {boolean} enabled - 是否启用
 * @returns {string} key
 */
export function setDebugMode(e, enabled) {
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
export function getDebugSessions() {
    return debugSessions
}

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
                    reg: '^#(群聊总结|总结群聊|群消息总结)$',
                    fnc: 'groupSummary'
                },
                {
                    reg: '^#(个人画像|用户画像|分析我)$',
                    fnc: 'userPortrait'
                },
                {
                    reg: '^#(我的记忆|查看记忆|记忆列表)$',
                    fnc: 'viewMemory'
                },
                {
                    reg: '^#(群记忆|群聊记忆)$',
                    fnc: 'viewGroupMemory'
                }
                // #取 命令已独立到 MessageInspector.js
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

    /**
     * 结束对话/开始新对话
     */
    async endConversation() {
        const e = this.e
        try {
            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null

            await chatService.clearHistory(userId, groupId)
            await this.reply('✅ 已结束当前对话，下次对话将开始新会话', true)
        } catch (error) {
            logger.error('[AI-Commands] End conversation error:', error)
            await this.reply('操作失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 清除用户记忆
     */
    async clearMemory() {
        const e = this.e
        try {
            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null
            const fullUserId = groupId ? `${groupId}_${userId}` : String(userId)

            await memoryManager.init()
            await memoryManager.clearMemory(fullUserId)
            await this.reply('✅ 已清除你的所有记忆数据', true)
        } catch (error) {
            logger.error('[AI-Commands] Clear memory error:', error)
            await this.reply('清除记忆失败: ' + error.message, true)
        }
        return true
    }

    /**
     * 查看对话状态
     */
    async conversationStatus() {
        const e = this.e
        try {
            await memoryManager.init()
            databaseService.init()

            const userId = e.user_id || e.sender?.user_id || 'unknown'
            const groupId = e.group_id || null
            const fullUserId = groupId ? `${groupId}_${userId}` : userId

            // 获取对话历史
            const messages = databaseService.getMessages(fullUserId, 100)
            const messageCount = messages.length

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

            // Debug状态
            const debugEnabled = isDebugEnabled(e) ? '✅ 开启' : '❌ 关闭'

            const status = [
                '📊 对话状态',
                `━━━━━━━━━━━━`,
                `💬 当前会话消息: ${messageCount} 条`,
                `🧠 记忆条目: ${memoryCount} 条`,
                `⏰ 最后活动: ${lastActive}`,
                `🔧 Debug模式: ${debugEnabled}`,
                `━━━━━━━━━━━━`,
                `💡 提示:`,
                `  #结束对话 - 开始新会话`,
                `  #清除记忆 - 清除记忆数据`,
                `  #chatdebug - 切换调试模式`
            ].join('\n')

            await this.reply(status, true)
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
            
            // 3. 最后尝试 bot API 获取群聊历史
            if (messages.length < 5) {
                try {
                    const bot = e.bot || Bot
                    const group = e.group || bot?.pickGroup?.(e.group_id)
                    if (group && typeof group.getChatHistory === 'function') {
                        const history = await group.getChatHistory(0, maxMessages)
                        if (history && history.length > 0) {
                            messages = history.map(msg => ({
                                userId: msg.user_id || msg.sender?.user_id,
                                nickname: msg.sender?.nickname || msg.sender?.card || '用户',
                                content: msg.raw_message || msg.message?.filter?.(m => m.type === 'text')?.map?.(m => m.text)?.join('') || '',
                                timestamp: msg.time ? msg.time * 1000 : Date.now()
                            })).filter(m => m.content && m.content.trim())
                            dataSource = 'Bot API'
                        }
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
                await this.reply(`📊 群聊总结 (${messages.length}条消息 · ${dataSource})\n\n${summaryText}`, true)
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
                await this.reply(`🎭 ${nickname} 的个人画像\n\n${portraitText}`, true)
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
            
            const reply = [
                `🧠 我的记忆 (共${allMemories.length}条)`,
                `━━━━━━━━━━━━`,
                memoryList,
                `━━━━━━━━━━━━`,
                allMemories.length > 15 ? `📝 仅显示最近15条` : '',
                `💡 #清除记忆 可清空所有记忆`
            ].filter(Boolean).join('\n')
            
            await this.reply(reply, true)
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
            
            parts.push(`\n━━━━━━━━━━━━`)
            parts.push(`💡 群聊记忆通过分析群消息自动生成`)
            
            await this.reply(parts.join('\n'), true)
        } catch (error) {
            logger.error('[AI-Commands] View group memory error:', error)
            await this.reply('获取群记忆失败: ' + error.message, true)
        }
        return true
    }
}
