import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
import config from '../../../config/config.js'
import { databaseService } from './DatabaseService.js'
import { LlmService } from '../llm/LlmService.js'
import { statsService } from '../stats/StatsService.js'

/**
 * Memory Manager - 使用数据库存储记忆
 * 支持周期性轮询分析对话历史并提取记忆
 */
export class MemoryManager {
    constructor() {
        this.initialized = false
        this.pollInterval = null
        this.lastPollTime = new Map() // userId -> timestamp
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
            this.pollAndSummarize().catch(e => 
                logger.warn('[MemoryManager] 轮询分析失败:', e.message)
            )
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
        // 群消息采集独立于 memory.groupContext 配置
        // 只要触发器配置 collectGroupMsg=true 就会采集
        
        if (!this.groupMessageBuffer) {
            this.groupMessageBuffer = new Map()
        }
        
        if (!this.groupMessageBuffer.has(groupId)) {
            this.groupMessageBuffer.set(groupId, [])
        }
        
        const messages = this.groupMessageBuffer.get(groupId)
        const maxMessages = 100  // 内存保留100条
        
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
            const dialogText = messages
                .map(m => `[${m.nickname}]: ${m.content.substring(0, 100)}`)
                .join('\n')
            
            if (dialogText.length < 100) return
            
            // 构建分析提示
            const analysisTypes = []
            if (groupConfig.extractUserInfo) analysisTypes.push('用户特征和偏好')
            if (groupConfig.extractTopics) analysisTypes.push('讨论话题')
            if (groupConfig.extractRelations) analysisTypes.push('社交关系')
            
            const prompt = `你是一个记忆提取专家。请仔细分析以下群聊记录，提取有长期价值的信息。

【分析维度】${analysisTypes.join('、')}

【群聊记录】
${dialogText}

【提取要求】
1. 只提取具体、明确的信息，避免模糊描述
2. 用户信息包括：性格特点、兴趣爱好、专业技能、生活习惯等
3. 话题需要是具体主题，如"讨论Python编程"而非"技术讨论"
4. 关系需要明确说明是什么关系，如"经常互动""观点相似"

【输出格式】每行一条，格式如下：
【用户:昵称】具体信息描述
【话题】具体话题内容
【关系】A和B：关系描述

只输出有价值的信息，宁缺毋滥，没有则输出"无"：`

            const startTime = Date.now()
            const memoryModel = config.get('memory.model')
            const client = await LlmService.getChatClient({ model: memoryModel || undefined })
            const channelInfo = client._channelInfo || {}
            const model = channelInfo.model || config.get('llm.defaultModel')
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                { 
                    model, 
                    maxToken: 500, 
                    disableHistorySave: true,
                    temperature: 0.3
                }
            )
            
            const responseText = result.contents?.[0]?.text?.trim() || ''
            // 记录统计（群聊记忆分析）
            try {
                const recordSuccess = !!responseText
                await statsService.recordApiCall({
                    channelId: channelInfo.id || 'memory',
                    channelName: channelInfo.name || '记忆服务',
                    model,
                    duration: Date.now() - startTime,
                    success: recordSuccess,
                    source: '记忆提取',
                    groupId,
                    responseText,
                    request: { messages: [{ role: 'user', content: prompt }], model },
                    response: !recordSuccess ? { error: '响应为空' } : null,
                })
            } catch (e) { /* 统计失败不影响主流程 */ }
            if (!responseText || responseText.length < 10) return
            
            // 解析并保存记忆
            const lines = responseText.split('\n').filter(line => line.trim())
            
            for (const line of lines) {
                // 提取用户记忆
                const userMatch = line.match(/【用户[:：](.+?)】(.+)/)
                if (userMatch) {
                    const nickname = userMatch[1].trim()
                    const info = userMatch[2].trim()
                    if (info.length > 5 && info.length < 100) {
                        await this.saveMemory(`group:${groupId}:user:${nickname}`, info, {
                            source: 'group_context',
                            groupId,
                            type: 'user_info'
                        })
                        logger.debug(`[MemoryManager] 群聊用户记忆 [${groupId}:${nickname}]`)
                    }
                }
                
                // 提取话题记忆
                const topicMatch = line.match(/【话题】(.+)/)
                if (topicMatch) {
                    const topic = topicMatch[1].trim()
                    if (topic.length > 3 && topic.length < 100) {
                        await this.saveMemory(`group:${groupId}:topics`, topic, {
                            source: 'group_context',
                            groupId,
                            type: 'topic'
                        })
                        logger.debug(`[MemoryManager] 群聊话题 [${groupId}]`)
                    }
                }
                
                // 提取关系记忆
                const relationMatch = line.match(/【关系】(.+)/)
                if (relationMatch) {
                    const relation = relationMatch[1].trim()
                    if (relation.length > 5 && relation.length < 100) {
                        await this.saveMemory(`group:${groupId}:relations`, relation, {
                            source: 'group_context',
                            groupId,
                            type: 'relation'
                        })
                        logger.debug(`[MemoryManager] 群聊关系 [${groupId}]`)
                    }
                }
            }
            
            logger.debug(`[MemoryManager] 群 ${groupId} 分析完成: ${messages.length}条`)
        } catch (error) {
            logger.debug(`[MemoryManager] 分析群 ${groupId} 上下文失败:`, error.message)
        }
    }
    
    /**
     * 获取群聊相关记忆
     * @param {string} groupId - 群ID
     * @param {string} [userId] - 可选的用户ID
     * @returns {Object} 群聊记忆上下文
     */
    async getGroupMemoryContext(groupId, userId = null) {
        await this.init()
        
        const result = {
            userInfo: [],
            topics: [],
            relations: []
        }
        
        try {
            // 获取用户信息记忆
            if (userId) {
                const userMemories = databaseService.getMemories(`group:${groupId}:user:${userId}`, 5)
                result.userInfo = userMemories.map(m => m.content)
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
            const messages = databaseService.getMessages(recentConv.conversationId, 20)
            if (messages.length < 2) return
            const dialogText = messages
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => {
                    const content = Array.isArray(m.content) 
                        ? m.content.filter(c => c.type === 'text').map(c => c.text).join('')
                        : (typeof m.content === 'string' ? m.content : '')
                    return `${m.role === 'user' ? '用户' : '助手'}: ${content.substring(0, 200)}`
                })
                .join('\n')
            
            if (dialogText.length < 50) return
            const existingMemories = databaseService.getMemories(userId, 20)
            const existingText = existingMemories.map(m => m.content).join('\n')
            const botName = global.Bot?.nickname || config.get('basic.botName') || '助手'
            const contextHint = isGroupConversation 
                ? `这是【群聊】对话。"用户:"后面的内容是与机器人直接对话的那个人说的话。
- 对话中可能出现其他群友的名字或信息（如[某某]:xxx格式），这些是其他人，不是当前用户
- 只提取与机器人直接对话的"用户"本人的信息，忽略其他群友的信息
- 不要把群友的名字、昵称当作当前用户的`
                : `这是【私聊】对话。"用户:"后面是用户本人说的话。`
            
            const prompt = `你是一个用户记忆管理专家。请分析对话，提取关于【当前用户】的有长期价值的信息。

【重要提示】
${contextHint}
- "助手:"或"${botName}"是机器人/AI的回复，不是用户
- 只提取当前用户本人明确表达的个人信息

【已有记忆】（避免重复）
${existingText || '暂无'}

【最近对话】
${dialogText}

【提取规则】
1. 只提取当前用户本人明确说的个人信息：姓名、年龄、职业、所在地等
2. 提取用户明确表达的偏好：喜欢/不喜欢的事物、习惯
3. 提取用户提到的重要事件：生日、纪念日、重要计划等
4. 避免重复已有记忆，只提取新信息
5. 不要把助手/机器人的信息当作用户的
6. 群聊中不要把其他群友的信息当作当前用户的
7. 每条记忆简洁明了，不超过40字

【输出格式】每行一条记忆，最多3条，没有新信息则输出"无"：`

            const startTime2 = Date.now()
            const memoryModel2 = config.get('memory.model')
            const client = await LlmService.getChatClient({ model: memoryModel2 || undefined })
            const channelInfo2 = client._channelInfo || {}
            const model2 = channelInfo2.model || config.get('llm.defaultModel')
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                { 
                    model: model2, 
                    maxToken: 200, 
                    disableHistorySave: true,
                    temperature: 0.3
                }
            )
            
            const responseText = result.contents?.[0]?.text?.trim() || ''
            // 记录统计（用户记忆提取）
            try {
                const recordSuccess = !!responseText && responseText !== '无'
                await statsService.recordApiCall({
                    channelId: channelInfo2.id || 'memory',
                    channelName: channelInfo2.name || '记忆服务',
                    model: model2,
                    duration: Date.now() - startTime2,
                    success: recordSuccess,
                    source: '用户记忆',
                    userId,
                    responseText,
                    request: { messages: [{ role: 'user', content: prompt }], model: model2 },
                    response: !recordSuccess ? { error: '响应为空或无效' } : null,
                })
            } catch (e) { /* 统计失败不影响主流程 */ }
            if (!responseText || responseText === '无' || responseText.length < 5) return
            
            // 解析并保存新记忆
            const newMemories = responseText
                .split('\n')
                .map(line => line.replace(/^[-•\d.)\s]+/, '').trim())
                .filter(line => line.length > 5 && line.length < 200 && line !== '无')
                .slice(0, 3)
            
            for (const memory of newMemories) {
                // 检查是否与已有记忆重复
                const isDuplicate = existingMemories.some(m => 
                    m.content.includes(memory) || memory.includes(m.content)
                )
                if (!isDuplicate) {
                    await this.saveMemory(userId, memory, { 
                        source: 'poll_summary',
                        importance: 6
                    })
                    logger.debug(`[MemoryManager] 轮询提取记忆 [${userId}]`)
                }
            }
        } catch (error) {
            logger.debug(`[MemoryManager] 分析用户 ${userId} 对话失败:`, error.message)
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
                /以后/,
            ]

            const shouldExtract = importantPatterns.some(p => p.test(userMessage))
            if (!shouldExtract) return null
            const botName = global.Bot?.nickname || config.get('basic.botName') || '助手'
            const extractPrompt = `分析以下对话，提取【用户】（人类）透露的个人信息或偏好，生成一条简短的记忆（不超过50字）。
注意：助手/${botName}是机器人，不要把机器人的信息当作用户的。如果没有值得记忆的信息，返回空。

用户说：${userMessage}
助手回复：${assistantResponse}

记忆内容（直接输出，无需解释）：`

            const startTime3 = Date.now()
            const memoryModel3 = config.get('memory.model')
            const client = await LlmService.getChatClient({ model: memoryModel3 || undefined })
            const channelInfo3 = client._channelInfo || {}
            const model3 = channelInfo3.model || config.get('llm.defaultModel')
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: extractPrompt }] },
                { model: model3, maxToken: 100, disableHistorySave: true }
            )

            const memoryContent = result.contents?.[0]?.text?.trim()
            try {
                const recordSuccess = !!memoryContent
                await statsService.recordApiCall({
                    channelId: channelInfo3.id || 'memory',
                    channelName: channelInfo3.name || '记忆服务',
                    model: model3,
                    duration: Date.now() - startTime3,
                    success: recordSuccess,
                    source: '记忆提取',
                    userId,
                    responseText: memoryContent || '',
                    request: { messages: [{ role: 'user', content: extractPrompt }], model: model3 },
                    response: !recordSuccess ? { error: '响应为空' } : null,
                })
            } catch (e) { /* 统计失败不影响主流程 */ }
            if (memoryContent && memoryContent.length > 5 && memoryContent.length < 200) {
                await this.saveMemory(userId, memoryContent, { 
                    source: 'auto_extract',
                    originalMessage: userMessage.substring(0, 100)
                })
                logger.debug(`[MemoryManager] 自动提取记忆`)
                return memoryContent
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
     * @returns {string} 格式化的记忆上下文
     */
    async getMemoryContext(userId, query) {
        if (!config.get('memory.enabled')) return ''
        
        await this.init()
        const pureUserId = userId?.includes('_') ? userId.split('_').pop() : userId
        let allMemories = []
        const userMemories = databaseService.getMemories(pureUserId, 10)
        allMemories.push(...userMemories)
        if (query && query.trim()) {
            const searchedMemories = databaseService.searchMemories(pureUserId, query, 5)
            // 合并去重
            for (const sm of searchedMemories) {
                if (!allMemories.find(m => m.id === sm.id)) {
                    allMemories.push(sm)
                }
            }
        }
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
        allMemories.sort((a, b) => {
            const importanceA = a.importance || 5
            const importanceB = b.importance || 5
            if (importanceB !== importanceA) return importanceB - importanceA
            return (b.timestamp || 0) - (a.timestamp || 0)
        })
        
        // 最多取15条
        const selectedMemories = allMemories.slice(0, 15)

        const memoryText = selectedMemories.map(m => `- ${m.content}`).join('\n')
        logger.info(`[MemoryManager] 为用户 ${pureUserId} 加载 ${selectedMemories.length} 条记忆`)
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
        if (!config.get('memory.enabled')) return null

        try {
            await this.init()
            
            // 检查记忆数量上限
            const maxMemories = config.get('memory.maxMemories') || 100
            const existingMemories = databaseService.getMemories(userId, maxMemories + 10)
            
            // 如果超过上限，删除最旧的记忆
            if (existingMemories.length >= maxMemories) {
                // 按时间排序，保留最新的 maxMemories - 1 条
                const sortedMemories = existingMemories.sort((a, b) => 
                    (b.timestamp || 0) - (a.timestamp || 0)
                )
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
}

export const memoryManager = new MemoryManager()
