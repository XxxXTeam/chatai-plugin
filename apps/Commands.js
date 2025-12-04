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
            
            databaseService.init()
            
            const maxMessages = config.get('features.groupSummary.maxMessages') || 100
            const groupKey = `group_${e.group_id}`
            
            const messages = databaseService.getMessages(groupKey, maxMessages)
            
            if (messages.length < 5) {
                await this.reply('群聊消息太少，无法生成总结', true)
                return true
            }

            const summaryPrompt = `请总结以下群聊对话的主要内容，提取关键话题和讨论要点：\n\n${
                messages.map(m => `${m.role}: ${
                    Array.isArray(m.content) 
                        ? m.content.filter(c => c.type === 'text').map(c => c.text).join('') 
                        : m.content
                }`).join('\n')
            }\n\n请用简洁的方式总结：
1. 主要讨论话题
2. 关键观点
3. 参与度分析`

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
                await this.reply(`📊 群聊总结\n\n${summaryText}`, true)
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
}
