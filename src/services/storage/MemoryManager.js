/**
 * @fileoverview 记忆管理模块
 * @module services/storage/MemoryManager
 * @description 管理AI的长期记忆，支持自动提取、存储和检索用户信息
 */

import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import config from '../../../config/config.js'
import { databaseService } from './DatabaseService.js'
import { LlmService } from '../llm/LlmService.js'
import { statsService } from '../stats/StatsService.js'

/**
 * @class MemoryManager
 * @classdesc 记忆管理器 - 使用数据库存储和管理AI的长期记忆
 *
 * @description
 * @example
 * // 获取用户记忆
 * const memories = await memoryManager.getMemories(userId)
 *
 * // 添加记忆
 * await memoryManager.addMemory(userId, '喜欢编程', 'preference')
 *
 * // 搜索记忆
 * const results = await memoryManager.searchMemories('编程', { userId })
 */
export class MemoryManager {
    constructor() {
        this.initialized = false
        this.pollInterval = null
        this.lastPollTime = new Map() // userId -> timestamp
        this.lastSummarizeTime = new Map() // groupId/userId -> timestamp 记录上次总结时间
    }

    /**
     * Initialize memory manager
     */
    async init() {
        if (this.initialized) return
        databaseService.init()
        this.initialized = true

        // 启动周期性轮询
        this.startPolling()
        logger.debug('[MemoryManager] Initialized')
    }

    /**
     * 启动周期性轮询
     */
    startPolling() {
        if (!config.get('memory.enabled')) return

        const intervalMinutes = config.get('memory.pollInterval') || 5
        const intervalMs = intervalMinutes * 60 * 1000

        // 清除旧的定时器
        if (this.pollInterval) {
            clearInterval(this.pollInterval)
        }

        // 启动新的定时器
        this.pollInterval = setInterval(() => {
            this.pollAndSummarize().catch(e => logger.warn('[MemoryManager] 轮询分析失败:', e.message))
        }, intervalMs)

        logger.debug(`[MemoryManager] 启动周期轮询: ${intervalMinutes}分钟`)

        // 启动群聊上下文采集
        this.startGroupContextCollection()
    }

    /**
     * 启动群聊上下文采集
     */
    startGroupContextCollection() {
        const groupConfig = config.get('memory.groupContext') || {}
        if (!groupConfig.enabled) return

        const intervalMinutes = groupConfig.collectInterval || 10
        const intervalMs = intervalMinutes * 60 * 1000

        // 清除旧的定时器
        if (this.groupContextInterval) {
            clearInterval(this.groupContextInterval)
        }

        // 启动新的定时器
        this.groupContextInterval = setInterval(() => {
            this.collectAndAnalyzeGroupContext().catch(e =>
                logger.warn('[MemoryManager] 群聊上下文分析失败:', e.message)
            )
        }, intervalMs)

        logger.debug(`[MemoryManager] 启动群聊上下文采集: ${intervalMinutes}分钟`)
    }

    /**
     * 采集并分析群聊上下文
     */
    async collectAndAnalyzeGroupContext() {
        const groupConfig = config.get('memory.groupContext') || {}
        if (!groupConfig.enabled) return

        try {
            // 获取所有活跃群聊
            const groupMessages = this.groupMessageBuffer || new Map()

            for (const [groupId, messages] of groupMessages) {
                const threshold = groupConfig.analyzeThreshold || 20
                if (messages.length < threshold) continue

                // 分析群聊上下文
                await this.analyzeGroupContext(groupId, messages)

                // 清空已分析的消息
                groupMessages.delete(groupId)
            }
        } catch (error) {
            logger.warn('[MemoryManager] 群聊上下文分析失败:', error.message)
        }
    }

    /**
     * 收集群聊消息（由监听器调用）
     * @param {string} groupId - 群ID
     * @param {Object} message - 消息对象
     */
    collectGroupMessage(groupId, message) {
        if (!this.groupMessageBuffer) {
            this.groupMessageBuffer = new Map()
        }

        if (!this.groupMessageBuffer.has(groupId)) {
            this.groupMessageBuffer.set(groupId, [])
        }

        const messages = this.groupMessageBuffer.get(groupId)
        const maxMessages = 100 // 内存保留100条

        const msgData = {
            userId: message.user_id,
            nickname: message.sender?.nickname || message.sender?.card || '未知',
            content: message.msg || message.raw_message || '',
            timestamp: Date.now()
        }

        // 添加到内存缓冲区
        messages.push(msgData)

        // 限制内存消息数量
        while (messages.length > maxMessages) {
            messages.shift()
        }

        // 同时持久化到数据库（用于群聊总结的保底数据）
        try {
            databaseService.init()
            const conversationId = `group_summary_${groupId}`
            databaseService.saveMessage(conversationId, {
                role: 'user',
                content: `[${msgData.nickname}]: ${msgData.content}`,
                timestamp: msgData.timestamp,
                metadata: { userId: msgData.userId, nickname: msgData.nickname }
            })
            // 保留最近100条
            databaseService.trimMessages(conversationId, 100)
        } catch (e) {
            // 静默失败，不影响主流程
        }
    }

    /**
     * 分析群聊上下文，提取记忆
     * @param {string} groupId - 群ID
     * @param {Array} messages - 消息列表
     */
    async analyzeGroupContext(groupId, messages) {
        const groupConfig = config.get('memory.groupContext') || {}

        try {
            // 构建对话文本
            const dialogText = messages.map(m => `[${m.nickname}]: ${m.content.substring(0, 100)}`).join('\n')

            if (dialogText.length < 100) return
            const existingTopics = databaseService.getMemories(`group:${groupId}:topics`, 20)
            const existingRelations = databaseService.getMemories(`group:${groupId}:relations`, 20)
            const existingUserInfos = databaseService.getMemoriesByPrefix(`group:${groupId}:user:`, 30)

            const existingMemoryText = [
                existingTopics.length > 0 ? `话题: ${existingTopics.map(t => t.content).join('; ')}` : '',
                existingRelations.length > 0 ? `关系: ${existingRelations.map(r => r.content).join('; ')}` : '',
                existingUserInfos.length > 0 ? `用户信息: ${existingUserInfos.map(u => u.content).join('; ')}` : ''
            ]
                .filter(Boolean)
                .join('\n')
            const analysisTypes = []
            if (groupConfig.extractUserInfo) analysisTypes.push('用户特征和偏好')
            if (groupConfig.extractTopics) analysisTypes.push('讨论话题')
            if (groupConfig.extractRelations) analysisTypes.push('社交关系')

            // 覆盖式总结prompt - 改进版：更准确区分用户身份
            const prompt = `你是群聊记忆管理专家。分析群聊记录，提取有价值的信息。

【重要规则】
- 每条消息格式为 [昵称]: 内容，昵称就是该用户的群名片
- 只提取用户自己透露的具体信息，不要推测
- 区分不同用户，按昵称分别记录
- 忽略无意义的日常对话（如"哈哈"、"好的"等）

【分析维度】${analysisTypes.join('、') || '用户特征、话题、关系'}

【现有记忆】
${existingMemoryText || '暂无'}

【新群聊记录】
${dialogText}

【总结要求】
1. 合并现有记忆和新信息，删除重复或过时的
2. 用户信息必须关联到具体昵称（如"小明喜欢打游戏"而不是"有人喜欢打游戏"）
3. 话题必须是具体主题（如"讨论原神3.0版本"而不是"聊游戏"）
4. 关系必须指明具体人物（如"小明和小红是好友"）
5. 不要输出分析过程，只输出结果

【输出格式】
每行一条，严格按以下格式：
【用户:昵称】该用户的具体信息
【话题】具体话题内容
【关系】A和B：关系描述

最多15条，没有有效信息则只输出"无"：`

            const startTime = Date.now()
            const memoryModel = config.get('memory.model')
            const client = await LlmService.getChatClient({ model: memoryModel || undefined })
            const channelInfo = client._channelInfo || {}
            const model = channelInfo.model || config.get('llm.defaultModel')
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                {
                    model,
                    maxToken: 600,
                    disableHistorySave: true,
                    temperature: 0.3
                }
            )

            const responseText = result.contents?.[0]?.text?.trim() || ''
            // 记录统计
            try {
                const recordSuccess = !!responseText && responseText !== '无'
                await statsService.recordApiCall({
                    channelId: channelInfo.id || 'memory',
                    channelName: channelInfo.name || '记忆服务',
                    model,
                    duration: Date.now() - startTime,
                    success: recordSuccess,
                    source: '群记忆总结',
                    groupId,
                    responseText,
                    request: { messages: [{ role: 'user', content: prompt }], model },
                    response: !recordSuccess ? { error: '响应为空' } : null
                })
            } catch (e) {
                /* 统计失败不影响主流程 */
            }

            if (!responseText || responseText === '无' || responseText.length < 10) return

            // 解析并覆盖保存记忆
            const lines = responseText.split('\n').filter(line => line.trim())

            // 收集新记忆
            const newTopics = []
            const newRelations = []
            const newUserInfos = new Map() // nickname -> info

            for (const line of lines) {
                // 过滤无效行
                if (this._isInvalidMemoryLine(line)) continue

                // 提取用户记忆
                const userMatch = line.match(/【用户[:：](.+?)】(.+)/)
                if (userMatch) {
                    const nickname = userMatch[1].trim()
                    const info = userMatch[2].trim()
                    if (info.length > 3 && info.length < 100) {
                        // 同一用户可能有多条信息，合并
                        const existing = newUserInfos.get(nickname) || []
                        existing.push(info)
                        newUserInfos.set(nickname, existing)
                    }
                    continue
                }

                // 提取话题记忆
                const topicMatch = line.match(/【话题】(.+)/)
                if (topicMatch) {
                    const topic = topicMatch[1].trim()
                    if (topic.length > 3 && topic.length < 100) {
                        newTopics.push(topic)
                    }
                    continue
                }

                // 提取关系记忆
                const relationMatch = line.match(/【关系】(.+)/)
                if (relationMatch) {
                    const relation = relationMatch[1].trim()
                    if (relation.length > 3 && relation.length < 100) {
                        newRelations.push(relation)
                    }
                }
            }

            // 覆盖式替换群记忆
            if (newTopics.length > 0) {
                databaseService.clearMemories(`group:${groupId}:topics`)
                for (const topic of newTopics.slice(0, 10)) {
                    databaseService.saveMemory(`group:${groupId}:topics`, topic, {
                        source: 'group_context',
                        groupId,
                        type: 'topic'
                    })
                }
            }

            if (newRelations.length > 0) {
                databaseService.clearMemories(`group:${groupId}:relations`)
                for (const relation of newRelations.slice(0, 10)) {
                    databaseService.saveMemory(`group:${groupId}:relations`, relation, {
                        source: 'group_context',
                        groupId,
                        type: 'relation'
                    })
                }
            }

            if (newUserInfos.size > 0) {
                // 清除旧用户信息并保存新的
                for (const [nickname, infos] of newUserInfos) {
                    const key = `group:${groupId}:user:${nickname}`
                    databaseService.clearMemories(key)
                    for (const info of infos.slice(0, 3)) {
                        databaseService.saveMemory(key, info, {
                            source: 'group_context',
                            groupId,
                            type: 'user_info'
                        })
                    }
                }
            }

            logger.debug(
                `[MemoryManager] 群 ${groupId} 覆盖式总结完成: 话题${newTopics.length} 关系${newRelations.length} 用户${newUserInfos.size}`
            )
        } catch (error) {
            logger.debug(`[MemoryManager] 分析群 ${groupId} 上下文失败:`, error.message)
        }
    }

    /**
     * 检查是否是无效的记忆行
     * @param {string} line
     * @returns {boolean}
     */
    _isInvalidMemoryLine(line) {
        const trimmed = line.trim()

        // 长度检查
        if (trimmed.length < 3 || trimmed.length > 200) return true

        const invalidPatterns = [
            // 英文分析标题
            /^(identifying|understanding|pinpointing|interpreting|decoding|analyzing)/i,
            /^(personal data|user goals|user identity|user intent|dialogue structure)/i,
            /^(summary|conclusion|analysis|result|output|note)/i,
            // 中文分析标题
            /^(提取|分析|总结|理解|识别|归纳|整理|梳理)/,
            /^(步骤|第[一二三四五六七八九十]|\d+\.|\d+、|\d+\))/,
            /^(以下是|根据|综合|结合|通过|经过)/,
            /^(用户信息|话题|关系|记忆|内容)[:：]?\s*$/,
            // 分隔符和空内容
            /^[-=*#]{3,}/,
            /^[【\[].+[】\]][:：]?\s*$/, // 纯标题行如【用户信息】
            /^无$/,
            /^暂无$/,
            /^没有/,
            /^无有效/,
            // AI常见废话
            /^好的|^明白|^收到|^了解/,
            /^根据对话|^从对话中|^在对话中/,
            // 引用AI回复的错误记忆
            /^助手[:：]/,
            /^AI[:：]/,
            /^机器人[:：]/
        ]

        for (const pattern of invalidPatterns) {
            if (pattern.test(trimmed)) return true
        }
        return false
    }

    /**
     * 获取群聊相关记忆
     * @param {string} groupId - 群ID
     * @param {string} [userId] - 可选的用户ID
     * @param {Object} [options] - 选项
     * @param {string} [options.nickname] - 用户昵称（用于按昵称查找记忆）
     * @returns {Object} 群聊记忆上下文
     */
    async getGroupMemoryContext(groupId, userId = null, options = {}) {
        await this.init()
        const { nickname } = options

        const result = {
            userInfo: [],
            topics: [],
            relations: []
        }

        try {
            // 获取用户信息记忆（按userId）
            if (userId) {
                const userMemories = databaseService.getMemories(`group:${groupId}:user:${userId}`, 5)
                result.userInfo.push(...userMemories.map(m => m.content))
            }

            // 获取用户信息记忆（按昵称）- 支持按昵称存储的记忆格式
            if (nickname) {
                const nicknameMemories = databaseService.getMemories(`group:${groupId}:user:${nickname}`, 5)
                for (const m of nicknameMemories) {
                    if (!result.userInfo.includes(m.content)) {
                        result.userInfo.push(m.content)
                    }
                }
            }

            // 获取话题记忆
            const topicMemories = databaseService.getMemories(`group:${groupId}:topics`, 5)
            result.topics = topicMemories.map(m => m.content)

            // 获取关系记忆
            const relationMemories = databaseService.getMemories(`group:${groupId}:relations`, 5)
            result.relations = relationMemories.map(m => m.content)
        } catch (error) {
            logger.debug(`[MemoryManager] 获取群 ${groupId} 记忆失败:`, error.message)
        }

        return result
    }

    /**
     * 获取群聊上下文
     * @param {string} groupId - 群ID
     * @returns {Object} 群聊记忆
     */
    async getGroupContext(groupId) {
        await this.init()

        const result = {
            topics: [],
            relations: [],
            userInfos: []
        }

        try {
            // 获取话题记忆
            result.topics = databaseService.getMemories(`group:${groupId}:topics`, 20)

            // 获取关系记忆
            result.relations = databaseService.getMemories(`group:${groupId}:relations`, 20)

            // 获取群内用户记忆（按前缀查询）
            result.userInfos = databaseService.getMemoriesByPrefix(`group:${groupId}:user:`, 30)
        } catch (error) {
            logger.debug(`[MemoryManager] 获取群 ${groupId} 上下文失败:`, error.message)
        }

        return result
    }

    /**
     * 停止轮询
     */
    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval)
            this.pollInterval = null
            logger.debug('[MemoryManager] 停止周期轮询')
        }
        if (this.groupContextInterval) {
            clearInterval(this.groupContextInterval)
            this.groupContextInterval = null
            logger.debug('[MemoryManager] 停止群聊上下文采集')
        }
    }

    /**
     * 轮询所有活跃用户，分析对话并提取记忆
     */
    async pollAndSummarize() {
        if (!config.get('memory.enabled')) return

        try {
            // 获取最近有对话的用户
            const conversations = databaseService.getConversations()
            const processedUsers = new Set()
            const minPollInterval = (config.get('memory.minPollInterval') || 30) * 60 * 1000 // 默认30分钟
            const now = Date.now()

            for (const conv of conversations) {
                const userId = conv.userId
                if (processedUsers.has(userId)) continue
                processedUsers.add(userId)

                // 检查用户上次处理时间（确保不会过于频繁）
                const lastPoll = this.lastPollTime.get(userId) || 0
                if (now - lastPoll < minPollInterval) continue

                // 检查对话是否有新消息（距离上次轮询后是否有新对话）
                const convTime = conv.updatedAt || conv.timestamp || 0
                if (convTime <= lastPoll) continue

                // 分析该用户的最近对话
                await this.analyzeUserConversations(userId)
                this.lastPollTime.set(userId, now)

                // 避免一次处理太多用户，限制单次轮询最多处理10个用户
                if (processedUsers.size >= 100) {
                    logger.debug(`[MemoryManager] 单次轮询处理了 ${processedUsers.size} 个用户，等待下次轮询`)
                    break
                }
            }

            if (processedUsers.size > 0) {
                logger.debug(`[MemoryManager] 本次轮询处理了 ${processedUsers.size} 个用户`)
            }
        } catch (error) {
            logger.warn('[MemoryManager] 轮询处理失败:', error.message)
        }
    }

    /**
     * 分析用户最近的对话，提取并总结记忆
     * @param {string} userId
     */
    async analyzeUserConversations(userId) {
        try {
            const isGroupConversation = userId.includes('group:') || userId.includes(':')

            const conversations = databaseService.listUserConversations(userId)
            if (conversations.length === 0) return
            const recentConv = conversations[0]
            const messages = databaseService.getMessages(recentConv.conversationId, 30)
            if (messages.length < 3) return
            const dialogText = messages
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => {
                    const content = Array.isArray(m.content)
                        ? m.content
                              .filter(c => c.type === 'text')
                              .map(c => c.text)
                              .join('')
                        : typeof m.content === 'string'
                          ? m.content
                          : ''
                    return `${m.role === 'user' ? '用户' : '助手'}: ${content.substring(0, 200)}`
                })
                .join('\n')

            if (dialogText.length < 50) return

            // 获取现有记忆用于合并总结
            const existingMemories = databaseService.getMemories(userId, 50)
            const existingMemoryList = existingMemories.map(m => `- ${m.content}`).join('\n')

            const botName = global.Bot?.nickname || config.get('basic.botName') || '助手'
            const contextHint = isGroupConversation
                ? `这是【群聊】中的对话记录。
- "用户:"后面是与机器人直接对话的那个人说的话
- 消息中的[某某]:xxx格式表示其他群友的发言，不是当前用户
- 只提取与机器人直接对话的"用户"本人透露的信息
- 不要把其他群友的信息当成当前用户的信息`
                : `这是【私聊】对话。"用户:"后面是用户本人说的话。`

            // 覆盖式总结prompt - 改进版：更准确区分用户身份
            const prompt = `你是用户记忆管理专家。分析对话，提取用户透露的个人信息。

【重要规则】
${contextHint}
- "助手:"或"${botName}"是机器人/AI的回复，绝对不是用户信息
- 只记录用户自己明确说出的具体信息
- 不要推测或臆断用户信息
- 不要把AI回复的内容当成用户信息

【现有记忆】
${existingMemoryList || '暂无'}

【最新对话】
${dialogText}

【提取类型】
- 基本信息：姓名、年龄、职业、所在地等
- 偏好习惯：喜欢/不喜欢的事物
- 重要事件：生日、纪念日、计划等
- 个性特点：兴趣爱好、性格等

【总结要求】
1. 合并现有记忆和新信息，删除重复或过时的
2. 每条必须是用户明确说过的具体事实
3. 格式：直接描述事实，不超过50字
4. 不要输出分析过程或格式说明

【输出格式】
每行一条记忆，最多10条。没有有效信息则只输出"无"：`

            const startTime2 = Date.now()
            const memoryModel2 = config.get('memory.model')
            const client = await LlmService.getChatClient({ model: memoryModel2 || undefined })
            const channelInfo2 = client._channelInfo || {}
            const model2 = channelInfo2.model || config.get('llm.defaultModel')
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                {
                    model: model2,
                    maxToken: 500,
                    disableHistorySave: true,
                    temperature: 0.3
                }
            )

            const responseText = result.contents?.[0]?.text?.trim() || ''
            // 记录统计
            try {
                const recordSuccess = !!responseText && responseText !== '无'
                await statsService.recordApiCall({
                    channelId: channelInfo2.id || 'memory',
                    channelName: channelInfo2.name || '记忆服务',
                    model: model2,
                    duration: Date.now() - startTime2,
                    success: recordSuccess,
                    source: '记忆总结',
                    userId,
                    responseText,
                    request: { messages: [{ role: 'user', content: prompt }], model: model2 },
                    response: !recordSuccess ? { error: '响应为空或无效' } : null
                })
            } catch (e) {
                /* 统计失败不影响主流程 */
            }

            if (!responseText || responseText === '无' || responseText.length < 5) return

            // 解析新记忆列表
            const newMemories = this._parseMemoryResponse(responseText)

            if (newMemories.length > 0) {
                // 覆盖式替换：清除旧记忆，保存新记忆
                await this.replaceUserMemories(userId, newMemories, 'poll_summary')
                logger.debug(`[MemoryManager] 覆盖式总结完成 [${userId}]: ${newMemories.length}条记忆`)
            }
        } catch (error) {
            logger.debug(`[MemoryManager] 分析用户 ${userId} 对话失败:`, error.message)
        }
    }

    /**
     * 解析记忆响应文本，过滤无效内容
     * @param {string} responseText
     * @returns {string[]}
     */
    _parseMemoryResponse(responseText) {
        // 无效内容的特征模式
        const invalidPatterns = [
            /^(identifying|understanding|pinpointing|interpreting|decoding|analyzing)/i,
            /^(personal data|user goals|user identity|user intent|dialogue structure)/i,
            /^(提取|分析|总结|理解|识别)/,
            /^(步骤|第[一二三四五]|\d+\.|\d+、)/,
            /^(以下是|根据|综合|结合)/,
            /^[-=]{3,}/, // 分隔线
            /^[【\[].+[】\]]:?$/ // 纯标题行
        ]

        return responseText
            .split('\n')
            .map(line => line.replace(/^[-•\*\d.)、\s]+/, '').trim())
            .filter(line => {
                // 长度检查
                if (line.length < 5 || line.length > 100) return false
                if (line === '无') return false
                // 无效模式检查
                for (const pattern of invalidPatterns) {
                    if (pattern.test(line)) return false
                }
                return true
            })
            .slice(0, 15) // 最多15条
    }

    /**
     * 覆盖式替换用户记忆
     * @param {string} userId
     * @param {string[]} memories - 新记忆列表
     * @param {string} source - 来源标记
     */
    async replaceUserMemories(userId, memories, source = 'summary') {
        try {
            await this.init()

            // 1. 清除该用户所有旧记忆
            databaseService.clearMemories(userId)

            // 2. 保存新记忆
            for (const content of memories) {
                databaseService.saveMemory(userId, content, {
                    source,
                    importance: 6,
                    metadata: { replacedAt: Date.now() }
                })
            }

            logger.debug(`[MemoryManager] 替换记忆 [${userId}]: ${memories.length}条`)
            return true
        } catch (error) {
            logger.error(`[MemoryManager] 替换记忆失败 [${userId}]:`, error.message)
            return false
        }
    }

    /**
     * 从对话中自动提取记忆
     * @param {string} userId
     * @param {string} userMessage
     * @param {string} assistantResponse
     */
    async extractMemoryFromConversation(userId, userMessage, assistantResponse) {
        if (!config.get('memory.enabled')) return

        try {
            // 判断是否包含值得记忆的信息
            const importantPatterns = [
                /我(是|叫|住在|喜欢|讨厌|今年|的生日|工作)/,
                /我的(名字|职业|年龄|爱好|家人)/,
                /记住/,
                /别忘了/,
                /以后/
            ]

            const shouldExtract = importantPatterns.some(p => p.test(userMessage))
            if (!shouldExtract) return null

            // 获取现有记忆用于合并
            const existingMemories = databaseService.getMemories(userId, 20)
            const existingMemoryList = existingMemories.map(m => `- ${m.content}`).join('\n')

            const botName = global.Bot?.nickname || config.get('basic.botName') || '助手'

            // 合并式总结prompt
            const extractPrompt = `你是用户记忆管理专家。请综合现有记忆和新对话，生成更新后的完整记忆列表。

【现有记忆】
${existingMemoryList || '暂无'}

【新对话】
用户说：${userMessage}
助手回复：${assistantResponse}

【规则】
1. 只记录用户（人类）透露的具体个人信息
2. 助手/${botName}是机器人，不要记录机器人的信息
3. 合并现有记忆和新信息，删除重复项
4. 每条记忆必须是具体事实，不超过50字
5. 不要输出标题、序号或格式说明

【输出格式】
直接输出记忆内容，每行一条，最多10条。无有效信息则输出"无"：`

            const startTime3 = Date.now()
            const memoryModel3 = config.get('memory.model')
            const client = await LlmService.getChatClient({ model: memoryModel3 || undefined })
            const channelInfo3 = client._channelInfo || {}
            const model3 = channelInfo3.model || config.get('llm.defaultModel')
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: extractPrompt }] },
                { model: model3, maxToken: 400, disableHistorySave: true, temperature: 0.3 }
            )

            const responseText = result.contents?.[0]?.text?.trim()
            try {
                const recordSuccess = !!responseText && responseText !== '无'
                await statsService.recordApiCall({
                    channelId: channelInfo3.id || 'memory',
                    channelName: channelInfo3.name || '记忆服务',
                    model: model3,
                    duration: Date.now() - startTime3,
                    success: recordSuccess,
                    source: '记忆提取',
                    userId,
                    responseText: responseText || '',
                    request: { messages: [{ role: 'user', content: extractPrompt }], model: model3 },
                    response: !recordSuccess ? { error: '响应为空' } : null
                })
            } catch (e) {
                /* 统计失败不影响主流程 */
            }

            if (!responseText || responseText === '无' || responseText.length < 5) return null

            // 解析并覆盖替换记忆
            const newMemories = this._parseMemoryResponse(responseText)
            if (newMemories.length > 0) {
                await this.replaceUserMemories(userId, newMemories, 'auto_extract')
                logger.debug(`[MemoryManager] 自动提取并合并记忆: ${newMemories.length}条`)
                return newMemories.join('; ')
            }
        } catch (error) {
            logger.warn('[MemoryManager] 自动提取记忆失败:', error.message)
        }
        return null
    }

    /**
     * 获取用户记忆上下文
     * @param {string} userId
     * @param {string} query
     * @param {Object} options - 选项
     * @param {Object} options.event - 事件对象
     * @param {string} options.groupId - 群ID（用于获取群相关记忆）
     * @param {boolean} options.includeProfile - 是否包含用户画像
     * @returns {string} 格式化的记忆上下文
     */
    async getMemoryContext(userId, query, options = {}) {
        if (!config.get('memory.enabled')) return ''

        await this.init()
        const { groupId, includeProfile } = options
        const pureUserId = userId?.includes('_') ? userId.split('_').pop() : userId
        let allMemories = []

        // 1. 获取用户基础记忆
        const userMemories = databaseService.getMemories(pureUserId, 10)
        allMemories.push(...userMemories)

        // 2. 如果在群聊中，尝试获取群内用户记忆
        if (groupId) {
            const groupUserKey = `group:${groupId}:user:${pureUserId}`
            const groupUserMemories = databaseService.getMemories(groupUserKey, 5)
            for (const gm of groupUserMemories) {
                if (!allMemories.find(m => m.id === gm.id)) {
                    allMemories.push(gm)
                }
            }
            logger.debug(`[MemoryManager] 群 ${groupId} 用户 ${pureUserId} 加载 ${groupUserMemories.length} 条群内记忆`)
        }

        // 3. 搜索相关记忆
        if (query && query.trim()) {
            const searchedMemories = databaseService.searchMemories(pureUserId, query, 5)
            for (const sm of searchedMemories) {
                if (!allMemories.find(m => m.id === sm.id)) {
                    allMemories.push(sm)
                }
            }
            // 群内搜索
            if (groupId) {
                const groupUserKey = `group:${groupId}:user:${pureUserId}`
                const groupSearched = databaseService.searchMemories(groupUserKey, query, 3)
                for (const gs of groupSearched) {
                    if (!allMemories.find(m => m.id === gs.id)) {
                        allMemories.push(gs)
                    }
                }
            }
        }

        // 4. 兼容旧格式的组合ID
        if (userId?.includes('_')) {
            const combinedMemories = databaseService.getMemories(userId, 5)
            for (const cm of combinedMemories) {
                if (!allMemories.find(m => m.id === cm.id)) {
                    allMemories.push(cm)
                }
            }
        }

        if (allMemories.length === 0) {
            logger.debug(`[MemoryManager] 用户 ${pureUserId} 无记忆数据`)
            return ''
        }

        // 按重要性和时间排序
        allMemories.sort((a, b) => {
            const importanceA = a.importance || 5
            const importanceB = b.importance || 5
            if (importanceB !== importanceA) return importanceB - importanceA
            return (b.timestamp || 0) - (a.timestamp || 0)
        })

        // 最多取15条
        const selectedMemories = allMemories.slice(0, 15)

        const memoryText = selectedMemories.map(m => `- ${m.content}`).join('\n')
        logger.info(
            `[MemoryManager] 为用户 ${pureUserId}${groupId ? ` (群${groupId})` : ''} 加载 ${selectedMemories.length} 条记忆`
        )
        logger.debug(`[MemoryManager] 记忆内容:\n${memoryText}`)
        return `\n【用户记忆】\n${memoryText}\n`
    }

    /**
     * 保存记忆
     * @param {string} userId
     * @param {string} content
     * @param {Object} options
     */
    async saveMemory(userId, content, options = {}) {
        const isManual = options.source === 'manual' || options.forceManual
        if (!config.get('memory.enabled') && !isManual) return null

        try {
            await this.init()

            // 检查记忆数量上限
            const maxMemories = config.get('memory.maxMemories') || 100
            const existingMemories = databaseService.getMemories(userId, maxMemories + 10)

            // 如果超过上限，删除最旧的记忆
            if (existingMemories.length >= maxMemories) {
                // 按时间排序，保留最新的 maxMemories - 1 条
                const sortedMemories = existingMemories.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
                const memoriesToDelete = sortedMemories.slice(maxMemories - 1)
                for (const m of memoriesToDelete) {
                    databaseService.deleteMemory(m.id)
                }
                logger.debug(`[MemoryManager] 清理旧记忆 ${memoriesToDelete.length} 条，用户 ${userId}`)
            }

            const id = databaseService.saveMemory(userId, content, {
                source: options.source || 'manual',
                importance: options.importance || 5,
                metadata: options.metadata || options
            })

            logger.debug(`[MemoryManager] 保存记忆: userId=${userId}, id=${id}`)
            return { id, content, timestamp: Date.now() }
        } catch (error) {
            logger.error(`[MemoryManager] 保存记忆失败:`, error.message)
            return null
        }
    }

    /**
     * 搜索记忆
     * @param {string} userId
     * @param {string} query
     * @param {number} limit
     */
    async searchMemory(userId, query, limit = 5) {
        if (!config.get('memory.enabled')) return []

        await this.init()
        return databaseService.searchMemories(userId, query, limit)
    }

    /**
     * 获取用户所有记忆
     * @param {string} userId
     */
    async getAllMemories(userId) {
        await this.init()
        return databaseService.getMemories(userId, 100)
    }

    /**
     * 删除记忆
     * @param {string} userId
     * @param {number} memoryId
     */
    async deleteMemory(userId, memoryId) {
        try {
            await this.init()
            return databaseService.deleteMemory(memoryId)
        } catch (e) {
            logger.error(`[MemoryManager] Failed to delete memory ${memoryId}`, e)
            return false
        }
    }

    /**
     * 获取用户所有记忆（别名）
     */
    async getMemories(userId) {
        return this.getAllMemories(userId)
    }

    /**
     * 清空用户所有记忆
     * @param {string} userId
     */
    async clearMemory(userId) {
        try {
            await this.init()
            const count = databaseService.clearMemories(userId)
            logger.debug(`[MemoryManager] 清除 ${userId} 的 ${count} 条记忆`)
            return true
        } catch (e) {
            logger.error(`[MemoryManager] Failed to clear memory for user ${userId}`, e)
            return false
        }
    }

    /**
     * 获取记忆统计
     * @param {string} userId
     */
    async getStats(userId) {
        await this.init()
        return databaseService.getMemoryStats(userId)
    }

    /**
     * 获取所有有记忆的用户
     */
    async listUsers() {
        try {
            await this.init()
            return databaseService.getMemoryUsers().map(u => u.userId)
        } catch (e) {
            logger.error('[MemoryManager] Failed to list users', e)
            return []
        }
    }

    /**
     * 添加记忆（别名）
     */
    async addMemory(userId, content, metadata = {}) {
        return this.saveMemory(userId, content, metadata)
    }

    /**
     * 获取群消息缓冲区中的消息（用于群聊总结）
     * @param {string} groupId - 群ID
     * @returns {Array} 消息列表
     */
    getGroupMessageBuffer(groupId) {
        if (!this.groupMessageBuffer) {
            return []
        }
        return this.groupMessageBuffer.get(groupId) || []
    }

    /**
     * 手动触发用户记忆总结（立即执行覆盖式总结）
     * @param {string} userId - 用户ID
     * @returns {Object} 总结结果
     */
    async summarizeUserMemory(userId) {
        if (!config.get('memory.enabled')) {
            return { success: false, error: '记忆功能未启用' }
        }

        try {
            await this.init()

            // 获取现有记忆数量
            const beforeCount = databaseService.getMemories(userId, 100).length

            // 执行覆盖式总结
            await this.analyzeUserConversations(userId)

            // 获取总结后的记忆
            const afterMemories = databaseService.getMemories(userId, 100)

            return {
                success: true,
                userId,
                beforeCount,
                afterCount: afterMemories.length,
                memories: afterMemories.map(m => m.content)
            }
        } catch (error) {
            logger.error(`[MemoryManager] 手动总结失败 [${userId}]:`, error.message)
            return { success: false, error: error.message }
        }
    }

    /**
     * 手动触发群记忆总结
     * @param {string} groupId - 群ID
     * @returns {Object} 总结结果
     */
    async summarizeGroupMemory(groupId) {
        if (!config.get('memory.enabled')) {
            return { success: false, error: '记忆功能未启用' }
        }

        try {
            await this.init()

            // 获取群消息缓冲区
            const messages = this.getGroupMessageBuffer(groupId)

            if (messages.length < 10) {
                return { success: false, error: '群消息记录太少，需要至少10条' }
            }

            // 执行覆盖式总结
            await this.analyzeGroupContext(groupId, messages)

            // 获取总结后的记忆
            const context = await this.getGroupContext(groupId)

            return {
                success: true,
                groupId,
                messageCount: messages.length,
                topics: context.topics?.length || 0,
                relations: context.relations?.length || 0,
                userInfos: context.userInfos?.length || 0
            }
        } catch (error) {
            logger.error(`[MemoryManager] 群记忆总结失败 [${groupId}]:`, error.message)
            return { success: false, error: error.message }
        }
    }

    /**
     * 基于时间段的综合记忆总结
     * 收集指定时间范围内的所有消息和群对话，进行综合总结
     * @param {string} groupId - 群ID
     * @param {Object} options - 配置选项
     * @param {number} options.timeRange - 时间范围（毫秒），默认1小时
     * @param {number} options.minMessages - 最少消息数，默认10
     * @param {string} options.model - 指定使用的模型（可选）
     * @returns {Object} 总结结果
     */
    async summarizeByTimeRange(groupId, options = {}) {
        if (!config.get('memory.enabled')) {
            return { success: false, error: '记忆功能未启用' }
        }

        const {
            timeRange = 60 * 60 * 1000, // 默认1小时
            minMessages = 10,
            model = null
        } = options

        try {
            await this.init()

            const now = Date.now()
            const startTime = now - timeRange

            // 1. 从内存缓冲区获取时间范围内的消息
            const bufferMessages = this.getGroupMessageBuffer(groupId) || []
            const recentBufferMessages = bufferMessages.filter(m => m.timestamp >= startTime)

            // 2. 从数据库获取持久化的消息（作为补充）
            const conversationId = `group_summary_${groupId}`
            let dbMessages = []
            try {
                dbMessages = databaseService.getMessages(conversationId, 200) || []
                dbMessages = dbMessages.filter(m => (m.timestamp || 0) >= startTime)
            } catch (e) {
                // 数据库查询失败时继续使用缓冲区消息
            }

            // 3. 合并消息，去重
            const allMessages = [...recentBufferMessages]
            const existingContents = new Set(allMessages.map(m => m.content))

            for (const dbMsg of dbMessages) {
                const content = typeof dbMsg.content === 'string' ? dbMsg.content : dbMsg.content?.text || ''
                if (content && !existingContents.has(content)) {
                    allMessages.push({
                        userId: dbMsg.metadata?.userId || 'unknown',
                        nickname: dbMsg.metadata?.nickname || '未知',
                        content: content,
                        timestamp: dbMsg.timestamp || now
                    })
                    existingContents.add(content)
                }
            }

            // 按时间排序
            allMessages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))

            if (allMessages.length < minMessages) {
                return {
                    success: false,
                    error: `时间范围内消息不足（${allMessages.length}/${minMessages}）`,
                    messageCount: allMessages.length
                }
            }

            // 4. 获取现有记忆作为上下文
            const existingTopics = databaseService.getMemories(`group:${groupId}:topics`, 10)
            const existingRelations = databaseService.getMemories(`group:${groupId}:relations`, 10)
            const existingUserInfos = databaseService.getMemoriesByPrefix(`group:${groupId}:user:`, 20)

            const existingMemoryText = [
                existingTopics.length > 0 ? `已知话题: ${existingTopics.map(t => t.content).join('; ')}` : '',
                existingRelations.length > 0 ? `已知关系: ${existingRelations.map(r => r.content).join('; ')}` : '',
                existingUserInfos.length > 0 ? `已知用户: ${existingUserInfos.map(u => u.content).join('; ')}` : ''
            ]
                .filter(Boolean)
                .join('\n')

            // 5. 构建对话文本
            const timeRangeMinutes = Math.round(timeRange / 60000)
            const dialogText = allMessages.map(m => `[${m.nickname}]: ${m.content.substring(0, 150)}`).join('\n')

            // 6. 构建总结prompt
            const prompt = `你是群聊记忆管理专家。请分析过去${timeRangeMinutes}分钟内的${allMessages.length}条群聊消息，提取有价值的信息。

【重要规则】
- 每条消息格式为 [昵称]: 内容，昵称是用户的群名片
- 只提取用户自己透露的具体信息，不推测
- 区分不同用户，按昵称分别记录
- 忽略无意义的日常对话（如"哈哈"、"好的"等）

【现有记忆（需要更新或保留）】
${existingMemoryText || '暂无'}

【最近${timeRangeMinutes}分钟的群聊记录】
${dialogText}

【总结要求】
1. 综合现有记忆和新消息，生成更新后的完整记忆
2. 删除过时或重复的信息
3. 用户信息必须关联到具体昵称
4. 话题必须是具体主题
5. 关系必须指明具体人物

【输出格式】
每行一条，严格按以下格式：
【用户:昵称】该用户的具体信息
【话题】具体话题内容
【关系】A和B：关系描述

最多20条，没有有效信息则只输出"无"：`

            // 7. 调用LLM进行总结
            const startApiTime = Date.now()
            const memoryModel = model || config.get('memory.model')
            const client = await LlmService.getChatClient({ model: memoryModel || undefined })
            const channelInfo = client._channelInfo || {}
            const usedModel = channelInfo.model || config.get('llm.defaultModel')

            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                {
                    model: usedModel,
                    maxToken: 800,
                    disableHistorySave: true,
                    temperature: 0.3
                }
            )

            const responseText = result.contents?.[0]?.text?.trim() || ''

            // 记录统计
            try {
                await statsService.recordApiCall({
                    channelId: channelInfo.id || 'memory',
                    channelName: channelInfo.name || '记忆服务',
                    model: usedModel,
                    duration: Date.now() - startApiTime,
                    success: !!responseText && responseText !== '无',
                    source: '时间段记忆总结',
                    groupId,
                    responseText,
                    request: { model: usedModel, timeRange: timeRangeMinutes }
                })
            } catch (e) {
                /* 统计失败不影响主流程 */
            }

            if (!responseText || responseText === '无' || responseText.length < 10) {
                return {
                    success: true,
                    groupId,
                    messageCount: allMessages.length,
                    timeRangeMinutes,
                    result: '无新的有效信息'
                }
            }

            // 8. 解析并保存记忆
            const lines = responseText.split('\n').filter(line => line.trim())
            const newTopics = []
            const newRelations = []
            const newUserInfos = new Map()

            for (const line of lines) {
                if (this._isInvalidMemoryLine(line)) continue

                const userMatch = line.match(/【用户[:：](.+?)】(.+)/)
                if (userMatch) {
                    const nickname = userMatch[1].trim()
                    const info = userMatch[2].trim()
                    if (info.length > 3 && info.length < 100) {
                        const existing = newUserInfos.get(nickname) || []
                        existing.push(info)
                        newUserInfos.set(nickname, existing)
                    }
                    continue
                }

                const topicMatch = line.match(/【话题】(.+)/)
                if (topicMatch) {
                    const topic = topicMatch[1].trim()
                    if (topic.length > 3 && topic.length < 100) {
                        newTopics.push(topic)
                    }
                    continue
                }

                const relationMatch = line.match(/【关系】(.+)/)
                if (relationMatch) {
                    const relation = relationMatch[1].trim()
                    if (relation.length > 3 && relation.length < 100) {
                        newRelations.push(relation)
                    }
                }
            }

            // 9. 覆盖式保存记忆
            if (newTopics.length > 0) {
                databaseService.clearMemories(`group:${groupId}:topics`)
                for (const topic of newTopics.slice(0, 10)) {
                    databaseService.saveMemory(`group:${groupId}:topics`, topic, {
                        source: 'time_range_summary',
                        groupId,
                        type: 'topic',
                        timeRange: timeRangeMinutes
                    })
                }
            }

            if (newRelations.length > 0) {
                databaseService.clearMemories(`group:${groupId}:relations`)
                for (const relation of newRelations.slice(0, 10)) {
                    databaseService.saveMemory(`group:${groupId}:relations`, relation, {
                        source: 'time_range_summary',
                        groupId,
                        type: 'relation',
                        timeRange: timeRangeMinutes
                    })
                }
            }

            if (newUserInfos.size > 0) {
                for (const [nickname, infos] of newUserInfos) {
                    const key = `group:${groupId}:user:${nickname}`
                    databaseService.clearMemories(key)
                    for (const info of infos.slice(0, 3)) {
                        databaseService.saveMemory(key, info, {
                            source: 'time_range_summary',
                            groupId,
                            type: 'user_info',
                            timeRange: timeRangeMinutes
                        })
                    }
                }
            }

            // 记录本次总结时间
            this.lastSummarizeTime.set(groupId, now)

            logger.info(
                `[MemoryManager] 群 ${groupId} 时间段总结完成: 消息${allMessages.length}条, 话题${newTopics.length}, 关系${newRelations.length}, 用户${newUserInfos.size}`
            )

            return {
                success: true,
                groupId,
                messageCount: allMessages.length,
                timeRangeMinutes,
                topics: newTopics.length,
                relations: newRelations.length,
                userInfos: newUserInfos.size,
                model: usedModel
            }
        } catch (error) {
            logger.error(`[MemoryManager] 时间段总结失败 [${groupId}]:`, error.message)
            return { success: false, error: error.message }
        }
    }

    /**
     * 搜索群聊记忆
     * @param {string} groupId - 群ID
     * @param {string} query - 搜索关键词
     * @param {Object} options - 选项
     * @returns {Object} 搜索结果
     */
    async searchGroupMemory(groupId, query, options = {}) {
        await this.init()
        const { limit = 10, type = 'all' } = options

        const results = {
            topics: [],
            relations: [],
            userInfos: [],
            total: 0
        }

        try {
            // 搜索话题
            if (type === 'all' || type === 'topics') {
                const topicKey = `group:${groupId}:topics`
                const topics = databaseService.searchMemories(topicKey, query, limit)
                results.topics = topics.map(t => t.content)
            }

            // 搜索关系
            if (type === 'all' || type === 'relations') {
                const relationKey = `group:${groupId}:relations`
                const relations = databaseService.searchMemories(relationKey, query, limit)
                results.relations = relations.map(r => r.content)
            }

            // 搜索用户信息
            if (type === 'all' || type === 'users') {
                const userInfos = databaseService.getMemoriesByPrefix(`group:${groupId}:user:`, 50)
                const matchedUsers = userInfos.filter(
                    u =>
                        u.content?.toLowerCase().includes(query.toLowerCase()) ||
                        u.userId?.toLowerCase().includes(query.toLowerCase())
                )
                results.userInfos = matchedUsers.slice(0, limit).map(u => ({
                    user: u.userId?.replace(`group:${groupId}:user:`, ''),
                    content: u.content
                }))
            }

            results.total = results.topics.length + results.relations.length + results.userInfos.length

            logger.debug(`[MemoryManager] 群 ${groupId} 搜索 "${query}": 找到 ${results.total} 条结果`)
            return results
        } catch (error) {
            logger.error(`[MemoryManager] 搜索群记忆失败:`, error.message)
            return results
        }
    }

    /**
     * 获取群内所有用户的记忆摘要
     * @param {string} groupId - 群ID
     * @returns {Array} 用户记忆列表
     */
    async getGroupUsersSummary(groupId) {
        await this.init()

        try {
            const userInfos = databaseService.getMemoriesByPrefix(`group:${groupId}:user:`, 100)

            // 按用户分组
            const userMap = new Map()
            for (const info of userInfos) {
                const user = info.userId?.replace(`group:${groupId}:user:`, '') || 'unknown'
                if (!userMap.has(user)) {
                    userMap.set(user, [])
                }
                userMap.get(user).push(info.content)
            }

            // 转换为数组
            const result = []
            for (const [user, memories] of userMap) {
                result.push({
                    user,
                    memories,
                    count: memories.length
                })
            }

            return result.sort((a, b) => b.count - a.count)
        } catch (error) {
            logger.error(`[MemoryManager] 获取群用户摘要失败:`, error.message)
            return []
        }
    }

    /**
     * 列出所有有记忆的群
     * @returns {Array} 群ID列表
     */
    async listGroups() {
        await this.init()

        try {
            const allMemories = databaseService.getMemoriesByPrefix('group:', 1000)
            const groupIds = new Set()

            for (const m of allMemories) {
                const match = m.userId?.match(/^group:(\d+)/)
                if (match) {
                    groupIds.add(match[1])
                }
            }

            return Array.from(groupIds)
        } catch (error) {
            logger.error(`[MemoryManager] 列出群失败:`, error.message)
            return []
        }
    }

    /**
     * 清除群的所有记忆
     * @param {string} groupId - 群ID
     * @returns {Object} 清除结果
     */
    async clearGroupMemory(groupId) {
        await this.init()

        try {
            let cleared = 0

            // 清除话题
            cleared += databaseService.clearMemories(`group:${groupId}:topics`)

            // 清除关系
            cleared += databaseService.clearMemories(`group:${groupId}:relations`)

            // 清除用户信息
            const userInfos = databaseService.getMemoriesByPrefix(`group:${groupId}:user:`, 100)
            for (const info of userInfos) {
                databaseService.deleteMemory(info.id)
                cleared++
            }

            // 清除消息缓冲区
            if (this.groupMessageBuffer) {
                this.groupMessageBuffer.delete(groupId)
            }

            logger.info(`[MemoryManager] 清除群 ${groupId} 的 ${cleared} 条记忆`)
            return { success: true, cleared }
        } catch (error) {
            logger.error(`[MemoryManager] 清除群记忆失败:`, error.message)
            return { success: false, error: error.message }
        }
    }
}

export const memoryManager = new MemoryManager()
