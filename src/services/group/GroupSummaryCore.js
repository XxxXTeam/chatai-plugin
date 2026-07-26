import config from '../../../config/config.js'
import { chatService } from '../llm/ChatService.js'
import { memoryManager } from '../storage/MemoryManager.js'
import { databaseService } from '../storage/DatabaseService.js'
import { getGroupFeatureModel } from '../scope/ScopeManager.js'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger

/**
 * 群聊总结核心逻辑 — 可被命令 & 定时推送共用
 * 不依赖 this.e / plugin 上下文，接收纯参数即可运行
 */
export class GroupSummaryCore {
    /**
     * 从多来源收集群聊消息
     * @param {string} groupId
     * @param {number} maxMessages
     * @param {object} [bot] - Bot 实例（用于通过 API 获取历史）
     * @returns {Promise<{messages: Array, dataSource: string}>}
     */
    static async collectMessages(groupId, maxMessages, bot) {
        groupId = String(groupId)
        let messages = []
        let dataSource = ''

        if (bot) {
            try {
                const group = bot.pickGroup?.(parseInt(groupId))
                if (group && typeof group.getChatHistory === 'function') {
                    let allChats = []
                    let seq = 0
                    let totalScanned = 0
                    const maxScanLimit = Math.min(maxMessages * 10, 5000)

                    while (allChats.length < maxMessages && totalScanned < maxScanLimit) {
                        const chatHistory = await group.getChatHistory(seq, 20)
                        if (!chatHistory || chatHistory.length === 0) break
                        totalScanned += chatHistory.length
                        const oldestSeq = Number(chatHistory[0]?.seq) || 0
                        if (seq && oldestSeq && seq === oldestSeq) break
                        if (oldestSeq) seq = oldestSeq
                        const filteredChats = chatHistory.filter(chat => {
                            if (!chat.message || chat.message.length === 0) return false
                            return chat.message.some(part => part.type === 'text' || part.type === 'at')
                        })
                        if (filteredChats.length > 0) {
                            allChats.unshift(...filteredChats.reverse())
                        }
                        if (!oldestSeq) break
                    }
                    const history = allChats.slice(-maxMessages)
                    if (history.length > 0) {
                        const apiMessages = history.map(msg => {
                            const nickname = msg.sender?.card || msg.sender?.nickname || '用户'
                            const contentParts = (msg.message || []).map(part => {
                                if (part.type === 'text') return part.text
                                if (part.type === 'at') {
                                    if (part.qq === 'all' || part.qq === 0) return '@全体成员'
                                    return `@${part.qq}`
                                }
                                return ''
                            })
                            return {
                                userId: msg.sender?.user_id,
                                nickname,
                                content: contentParts.join(''),
                                timestamp: msg.time ? msg.time * 1000 : Date.now()
                            }
                        })
                        messages = apiMessages.filter(m => m.content && m.content.trim())
                        if (messages.length > 0) dataSource = 'Bot API'
                    }
                }
            } catch (err) {
                logger.debug(`[GroupSummaryCore] Bot API 获取群 ${groupId} 历史失败:`, err.message)
            }
        }

        if (messages.length === 0) {
            try {
                await memoryManager.init()
                const memoryMessages = memoryManager.getGroupMessageBuffer(groupId) || []
                if (memoryMessages.length > 0) {
                    messages = memoryMessages
                    dataSource = '内存缓冲'
                }
            } catch (err) {
                logger.debug(`[GroupSummaryCore] 内存缓冲获取失败:`, err.message)
            }
        }

        if (messages.length === 0) {
            try {
                databaseService.init()
                const conversationId = `group_summary_${groupId}`
                const rawDbMessages = databaseService.getMessages(conversationId, maxMessages)
                if (rawDbMessages && rawDbMessages.length > 0) {
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
                    if (dbMessages.length > 0) {
                        messages = dbMessages
                        dataSource = '数据库'
                    }
                }
            } catch (dbErr) {
                logger.debug(`[GroupSummaryCore] 从数据库读取群 ${groupId} 消息失败:`, dbErr.message)
            }
        }

        return { messages, dataSource }
    }

    /**
     * 使用 LLM 生成群聊总结文本
     * @param {string} groupId
     * @param {Array} messages - 已收集的消息列表
     * @param {object} [options]
     * @param {number} [options.maxChars]
     * @param {string} [options.model] - 指定模型
     * @returns {Promise<{summaryText: string, model: string}>}
     */
    static async generateSummary(groupId, messages, options = {}) {
        const maxChars = options.maxChars || config.get('features.groupSummary.maxChars') || 6000
        const recentMessages = messages

        let dialogText = recentMessages
            .map(m => {
                if (typeof m.content === 'string' && m.content.startsWith('[')) return m.content
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
        if (dialogText.length > maxChars) {
            dialogText = dialogText.slice(-maxChars)
        }

        const participants = new Set(recentMessages.map(m => m.nickname || m.userId || '用户'))

        /* 输出经 marked() 渲染成图片，Markdown 标题与 emoji 是渲染契约，不可改成纯文本 */
        const summaryPrompt = `你是群聊观察员。请阅读下面的群聊记录，按给定维度写一份总结，直接输出 Markdown。

## 分析维度

1. **🔥 热门话题**：群友们最近在讨论什么话题？有哪些热点事件或共同关注的内容？按热度排序列出主要话题。

2. **👥 活跃成员**：哪些成员发言最多？简要描述他们的发言特点和主要讨论内容。

3. **💬 群聊氛围**：群聊的整体氛围如何？（例如：轻松愉快、严肃认真、热烈讨论等）

4. **📌 关键信息**：有没有重要的通知、决定或值得关注的信息？包括但不限于：活动安排、重要公告、问题讨论结论等。

5. **🎯 话题趋势**：群聊话题有什么变化趋势？哪些话题正在升温，哪些已经结束？

6. **💡 精彩瞬间**：有哪些有趣的对话、金句或值得记录的互动？

## 注意事项
- 记录中每行的格式是 \`[昵称]: 内容\`，方括号里是发言人的群名片
- 保持客观中立，只写记录里真实出现过的内容，不要推测群友的动机或身份
- 某个维度在这段记录里确实没有对应内容时，整节略去不写，不要为了凑齐六项而编造
- 用自己的话概括，不要逐条复述原始聊天记录
- 敏感话题一笔带过即可
- 每个维度用二级标题起头并带上对应 emoji，例如 \`## 🔥 热门话题\`；直接从第一个标题开始写，不要开场白

---

以下是最近的群聊记录（共 ${recentMessages.length} 条消息，${participants.size} 位参与者）：

${dialogText}`

        const groupSummaryModel =
            options.model ||
            (await getGroupFeatureModel(groupId, 'summaryModel', ['features.groupSummary.model', 'llm.models.summary']))

        const result = await chatService.sendMessage({
            userId: `summary_${groupId}`,
            groupId: null,
            message: summaryPrompt,
            model: groupSummaryModel || undefined,
            mode: 'chat',
            skipHistory: true,
            disableTools: true,
            skipPersona: true
        })

        let summaryText = ''
        if (result.response && Array.isArray(result.response)) {
            summaryText = result.response
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n')
        }

        const actualModel = result?.model || groupSummaryModel || config.get('llm.defaultModel') || '默认模型'
        return { summaryText, model: actualModel }
    }
}
