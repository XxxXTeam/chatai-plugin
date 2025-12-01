import config from '../../config/config.js'
import { databaseService } from './DatabaseService.js'
import { LlmService } from './LlmService.js'

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
        logger.info('[MemoryManager] Initialized with database')
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
        
        logger.info(`[MemoryManager] 启动周期轮询，间隔 ${intervalMinutes} 分钟`)
        
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
        
        logger.info(`[MemoryManager] 启动群聊上下文采集，间隔 ${intervalMinutes} 分钟`)
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
        const groupConfig = config.get('memory.groupContext') || {}
        if (!groupConfig.enabled) return
        
        if (!this.groupMessageBuffer) {
            this.groupMessageBuffer = new Map()
        }
        
        if (!this.groupMessageBuffer.has(groupId)) {
            this.groupMessageBuffer.set(groupId, [])
        }
        
        const messages = this.groupMessageBuffer.get(groupId)
        const maxMessages = groupConfig.maxMessagesPerCollect || 50
        
        // 添加消息
        messages.push({
            userId: message.user_id,
            nickname: message.sender?.nickname || message.sender?.card || '未知',
            content: message.msg || message.raw_message || '',
            timestamp: Date.now()
        })
        
        // 限制消息数量
        while (messages.length > maxMessages) {
            messages.shift()
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
            if (groupConfig.extractUserInfo) analysisTypes.push('用户信息（如：爱好、职业、特点）')
            if (groupConfig.extractTopics) analysisTypes.push('讨论话题和群氛围')
            if (groupConfig.extractRelations) analysisTypes.push('用户之间的关系')
            
            const prompt = `分析以下群聊记录，提取有价值的信息用于记忆。
分析维度：${analysisTypes.join('、')}

【群聊记录】
${dialogText}

请按以下格式输出（每行一条，不超过50字）：
【用户:用户昵称】具体信息
【话题】讨论的主题
【关系】用户A与用户B的关系

只输出有意义的信息，没有则不输出：`

            const client = await LlmService.getChatClient()
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                { 
                    model: config.get('llm.defaultModel'), 
                    maxToken: 500, 
                    disableHistorySave: true,
                    temperature: 0.3
                }
            )
            
            const responseText = result.contents?.[0]?.text?.trim() || ''
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
                        logger.info(`[MemoryManager] 群聊提取用户记忆 [${groupId}:${nickname}]: ${info}`)
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
                        logger.info(`[MemoryManager] 群聊提取话题 [${groupId}]: ${topic}`)
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
                        logger.info(`[MemoryManager] 群聊提取关系 [${groupId}]: ${relation}`)
                    }
                }
            }
            
            logger.info(`[MemoryManager] 群 ${groupId} 上下文分析完成，处理 ${messages.length} 条消息`)
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
     * 停止轮询
     */
    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval)
            this.pollInterval = null
            logger.info('[MemoryManager] 停止周期轮询')
        }
        if (this.groupContextInterval) {
            clearInterval(this.groupContextInterval)
            this.groupContextInterval = null
            logger.info('[MemoryManager] 停止群聊上下文采集')
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
            
            for (const conv of conversations) {
                const userId = conv.userId
                if (processedUsers.has(userId)) continue
                processedUsers.add(userId)
                
                // 检查是否需要处理（距离上次处理超过间隔）
                const lastPoll = this.lastPollTime.get(userId) || 0
                const pollInterval = (config.get('memory.pollInterval') || 5) * 60 * 1000
                if (Date.now() - lastPoll < pollInterval) continue
                
                // 分析该用户的最近对话
                await this.analyzeUserConversations(userId)
                this.lastPollTime.set(userId, Date.now())
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
            // 获取用户最近的对话
            const conversations = databaseService.listUserConversations(userId)
            if (conversations.length === 0) return
            
            // 获取最近的消息
            const recentConv = conversations[0]
            const messages = databaseService.getMessages(recentConv.conversationId, 20)
            if (messages.length < 2) return
            
            // 构建对话文本
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
            
            // 获取已有记忆，避免重复
            const existingMemories = databaseService.getMemories(userId, 20)
            const existingText = existingMemories.map(m => m.content).join('\n')
            
            // 使用 LLM 分析并提取新记忆
            const prompt = `分析以下对话，提取关于用户的重要信息（如：个人信息、偏好、习惯、重要事件等）。
每条记忆一行，不超过50字。只输出新信息，不要重复已有记忆。如果没有新信息，返回"无"。

【已有记忆】
${existingText || '暂无'}

【最近对话】
${dialogText}

【新记忆】（每行一条，最多3条）：`

            const client = await LlmService.getChatClient()
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: prompt }] },
                { 
                    model: config.get('llm.defaultModel'), 
                    maxToken: 200, 
                    disableHistorySave: true,
                    temperature: 0.3
                }
            )
            
            const responseText = result.contents?.[0]?.text?.trim() || ''
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
                    logger.info(`[MemoryManager] 轮询提取记忆 [${userId}]: ${memory}`)
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

            // 构造提取提示
            const extractPrompt = `分析以下对话，提取用户透露的个人信息或偏好，生成一条简短的记忆（不超过50字）。如果没有值得记忆的信息，返回空。

用户说：${userMessage}
助手回复：${assistantResponse}

记忆内容（直接输出，无需解释）：`

            const client = await LlmService.getChatClient()
            const result = await client.sendMessage(
                { role: 'user', content: [{ type: 'text', text: extractPrompt }] },
                { model: config.get('llm.defaultModel'), maxToken: 100, disableHistorySave: true }
            )

            const memoryContent = result.contents?.[0]?.text?.trim()
            if (memoryContent && memoryContent.length > 5 && memoryContent.length < 200) {
                await this.saveMemory(userId, memoryContent, { 
                    source: 'auto_extract',
                    originalMessage: userMessage.substring(0, 100)
                })
                logger.info(`[MemoryManager] 自动提取记忆: ${memoryContent}`)
                return memoryContent
            }
        } catch (error) {
            logger.warn('[MemoryManager] 自动提取记忆失败:', error.message)
        }
        return null
    }

    /**
     * 获取与查询相关的记忆上下文
     * @param {string} userId
     * @param {string} query
     * @returns {string} 格式化的记忆上下文
     */
    async getMemoryContext(userId, query) {
        if (!config.get('memory.enabled')) return ''
        
        await this.init()
        
        // 优先搜索相关记忆，否则获取最近记忆
        let memories = query 
            ? databaseService.searchMemories(userId, query, 5)
            : databaseService.getMemories(userId, 10)
        
        if (memories.length === 0) return ''

        const memoryText = memories.map(m => `- ${m.content}`).join('\n')
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
            logger.info(`[MemoryManager] 清除 ${userId} 的 ${count} 条记忆`)
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
}

export const memoryManager = new MemoryManager()
