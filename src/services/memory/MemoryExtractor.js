/**
 * 记忆提取器
 * 从对话中自动提取并分类用户记忆
 */
import { chatLogger } from '../../core/utils/logger.js'
import { memoryService } from './MemoryService.js'
import {
    MemoryCategory,
    ProfileSubType,
    PreferenceSubType,
    EventSubType,
    RelationSubType,
    TopicSubType,
    MemorySource
} from './MemoryTypes.js'

const logger = chatLogger

/**
 * 记忆提取 Prompt 模板
 */
const EXTRACTION_PROMPT = `你是一个记忆提取助手，负责从对话中提取用户的关键信息。

【任务】分析对话内容，提取用户个人信息并分类。

【输出格式】每行一条记忆，格式：[分类:子类型] 内容
分类和子类型必须使用以下英文标识：

1. profile（基本信息）
   - name: 姓名/昵称
   - age: 年龄
   - gender: 性别
   - location: 所在地
   - occupation: 职业
   - education: 学历/学校
   - contact: 联系方式

2. preference（偏好习惯）
   - like: 喜欢的事物
   - dislike: 讨厌的事物
   - hobby: 爱好
   - habit: 习惯
   - food: 食物偏好
   - style: 风格偏好

3. event（重要事件）
   - birthday: 生日
   - anniversary: 纪念日
   - plan: 计划/安排
   - milestone: 里程碑
   - schedule: 日程

4. relation（人际关系）
   - family: 家人
   - friend: 朋友
   - colleague: 同事
   - partner: 伴侣
   - pet: 宠物

5. topic（话题兴趣）
   - interest: 感兴趣的话题
   - discussed: 讨论过的话题
   - knowledge: 知识领域

【示例输出】
[profile:name] 用户叫小明
[profile:age] 25岁
[preference:like] 喜欢打游戏
[event:birthday] 生日是3月15日
[relation:friend] 小红是用户的朋友
[topic:interest] 对AI技术感兴趣

【对话内容】
{dialogText}

【提取要求】
- 只提取明确的信息，不要推测
- 内容要简洁，一句话说明
- 如果没有有价值的信息，只输出"无"
- 不要输出重复的信息
- 忽略无关的聊天内容

提取结果：`

class MemoryExtractor {
    constructor() {
        this.llmClient = null
    }

    /**
     * 设置 LLM 客户端
     */
    setLLMClient(client) {
        this.llmClient = client
    }

    /**
     * 从对话中提取记忆
     * @param {string} userId - 用户ID
     * @param {Array} messages - 对话消息列表
     * @param {Object} options - 选项
     * @returns {Array} 提取的记忆列表
     */
    async extractFromConversation(userId, messages, options = {}) {
        const { groupId = null, maxMessages = 20, saveImmediately = true } = options

        if (!this.llmClient) {
            logger.warn('[MemoryExtractor] LLM client not set, skipping extraction')
            return []
        }

        if (!messages || messages.length === 0) {
            return []
        }

        // 格式化对话文本
        const dialogText = this.formatMessages(messages.slice(-maxMessages))

        if (dialogText.length < 10) {
            return []
        }

        try {
            // 调用 LLM 提取记忆
            const prompt = EXTRACTION_PROMPT.replace('{dialogText}', dialogText)
            const response = await this.callLLM(prompt)

            if (!response || response.trim() === '无' || response.trim() === '') {
                return []
            }

            // 解析提取结果
            const memories = this.parseExtractionResult(response, userId, groupId)

            // 保存记忆
            if (saveImmediately && memories.length > 0) {
                const results = await memoryService.saveMemories(memories)
                logger.info(`[MemoryExtractor] 提取并保存了 ${results.filter(r => r.success).length} 条记忆`)
                return results.filter(r => r.success).map(r => r.memory)
            }

            return memories
        } catch (error) {
            logger.error('[MemoryExtractor] 提取记忆失败:', error)
            return []
        }
    }

    /**
     * 格式化消息列表为对话文本
     */
    formatMessages(messages) {
        return messages
            .map(msg => {
                const role = msg.role === 'user' ? '用户' : 'AI'
                const content =
                    typeof msg.content === 'string' ? msg.content : msg.content?.text || JSON.stringify(msg.content)
                return `${role}: ${content}`
            })
            .join('\n')
    }

    /**
     * 解析 LLM 提取结果
     */
    parseExtractionResult(result, userId, groupId = null) {
        const memories = []
        const lines = result.split('\n').filter(line => line.trim())

        for (const line of lines) {
            // 匹配格式：[category:subType] content
            const match = line.match(/^\[([a-z]+):([a-z]+)\]\s*(.+)$/i)

            if (match) {
                const [, category, subType, content] = match
                const normalizedCategory = category.toLowerCase()
                const normalizedSubType = subType.toLowerCase()

                // 验证分类
                if (this.isValidCategorySubType(normalizedCategory, normalizedSubType)) {
                    memories.push({
                        userId,
                        groupId,
                        category: normalizedCategory,
                        subType: normalizedSubType,
                        content: content.trim(),
                        confidence: 0.7,
                        source: MemorySource.AUTO
                    })
                }
            } else {
                // 尝试只匹配分类格式：[category] content
                const simpleMatch = line.match(/^\[([a-z]+)\]\s*(.+)$/i)
                if (simpleMatch) {
                    const [, category, content] = simpleMatch
                    const normalizedCategory = category.toLowerCase()

                    if (Object.values(MemoryCategory).includes(normalizedCategory)) {
                        memories.push({
                            userId,
                            groupId,
                            category: normalizedCategory,
                            subType: null,
                            content: content.trim(),
                            confidence: 0.6,
                            source: MemorySource.AUTO
                        })
                    }
                }
            }
        }

        return memories
    }

    /**
     * 验证分类和子类型是否有效
     */
    isValidCategorySubType(category, subType) {
        const validSubTypes = {
            [MemoryCategory.PROFILE]: Object.values(ProfileSubType),
            [MemoryCategory.PREFERENCE]: Object.values(PreferenceSubType),
            [MemoryCategory.EVENT]: Object.values(EventSubType),
            [MemoryCategory.RELATION]: Object.values(RelationSubType),
            [MemoryCategory.TOPIC]: Object.values(TopicSubType),
            [MemoryCategory.CUSTOM]: []
        }

        if (!validSubTypes[category]) {
            return false
        }

        // custom 分类允许任意子类型
        if (category === MemoryCategory.CUSTOM) {
            return true
        }

        return validSubTypes[category].includes(subType)
    }

    /**
     * 调用 LLM
     */
    async callLLM(prompt) {
        if (!this.llmClient) {
            throw new Error('LLM client not configured')
        }

        try {
            // 根据不同的客户端类型调用
            if (typeof this.llmClient.sendMessage === 'function') {
                // ChatGPT/Claude style
                const response = await this.llmClient.sendMessage(prompt, {
                    maxTokens: 1000,
                    temperature: 0.3
                })
                return response?.text || response?.content || response
            } else if (typeof this.llmClient.complete === 'function') {
                // Completion style
                const response = await this.llmClient.complete(prompt, {
                    maxTokens: 1000,
                    temperature: 0.3
                })
                return response
            } else if (typeof this.llmClient.chat === 'function') {
                // Chat style
                const response = await this.llmClient.chat([{ role: 'user', content: prompt }], {
                    maxTokens: 1000,
                    temperature: 0.3
                })
                return response?.choices?.[0]?.message?.content || response?.content || response
            }

            throw new Error('Unknown LLM client type')
        } catch (error) {
            logger.error('[MemoryExtractor] LLM call failed:', error)
            throw error
        }
    }

    /**
     * 从单条消息中快速提取记忆（使用规则匹配，不调用 LLM）
     * @param {string} userId - 用户ID
     * @param {string} message - 消息内容
     * @param {Object} options - 选项
     */
    quickExtract(userId, message, options = {}) {
        const { groupId = null } = options
        const memories = []

        // 姓名匹配
        const namePatterns = [
            /我(?:的名字)?(?:叫|是|名)([^\s,，。！!？?\n]{1,10})/,
            /(?:大家)?(?:可以)?叫我([^\s,，。！!？?\n]{1,10})/,
            /我姓([^\s,，。！!？?\n]{1,5})/
        ]
        for (const pattern of namePatterns) {
            const match = message.match(pattern)
            if (match) {
                memories.push({
                    userId,
                    groupId,
                    category: MemoryCategory.PROFILE,
                    subType: ProfileSubType.NAME,
                    content: `用户名叫${match[1]}`,
                    confidence: 0.9,
                    source: MemorySource.AUTO
                })
                break
            }
        }

        // 年龄匹配
        const ageMatch = message.match(/我(?:今年)?(\d{1,3})岁/)
        if (ageMatch) {
            memories.push({
                userId,
                groupId,
                category: MemoryCategory.PROFILE,
                subType: ProfileSubType.AGE,
                content: `${ageMatch[1]}岁`,
                confidence: 0.9,
                source: MemorySource.AUTO
            })
        }

        // 职业匹配
        const occupationPatterns = [
            /我是(?:一[名个位])?([^\s,，。！!？?\n]{2,10}(?:师|员|生|家|者|长|士))/,
            /我(?:从事|做)([^\s,，。！!？?\n]{2,15})(?:工作|行业)?/,
            /我的(?:职业|工作)是([^\s,，。！!？?\n]{2,15})/
        ]
        for (const pattern of occupationPatterns) {
            const match = message.match(pattern)
            if (match) {
                memories.push({
                    userId,
                    groupId,
                    category: MemoryCategory.PROFILE,
                    subType: ProfileSubType.OCCUPATION,
                    content: `职业是${match[1]}`,
                    confidence: 0.85,
                    source: MemorySource.AUTO
                })
                break
            }
        }

        // 位置匹配
        const locationPatterns = [
            /我(?:在|住|来自)([^\s,，。！!？?\n]{2,15})/,
            /我是([^\s,，。！!？?\n]{2,10})人/,
            /坐标([^\s,，。！!？?\n]{2,15})/
        ]
        for (const pattern of locationPatterns) {
            const match = message.match(pattern)
            if (match) {
                memories.push({
                    userId,
                    groupId,
                    category: MemoryCategory.PROFILE,
                    subType: ProfileSubType.LOCATION,
                    content: `在${match[1]}`,
                    confidence: 0.8,
                    source: MemorySource.AUTO
                })
                break
            }
        }

        // 生日匹配
        const birthdayPatterns = [
            /我(?:的)?生日(?:是)?(\d{1,2})月(\d{1,2})[日号]/,
            /我是(\d{1,2})月(\d{1,2})[日号](?:出)?生/
        ]
        for (const pattern of birthdayPatterns) {
            const match = message.match(pattern)
            if (match) {
                memories.push({
                    userId,
                    groupId,
                    category: MemoryCategory.EVENT,
                    subType: EventSubType.BIRTHDAY,
                    content: `生日是${match[1]}月${match[2]}日`,
                    confidence: 0.95,
                    source: MemorySource.AUTO
                })
                break
            }
        }

        // 喜好匹配
        const likeMatch = message.match(/我(?:很)?(?:喜欢|爱)([^\s,，。！!？?\n]{2,20})/)
        if (likeMatch) {
            memories.push({
                userId,
                groupId,
                category: MemoryCategory.PREFERENCE,
                subType: PreferenceSubType.LIKE,
                content: `喜欢${likeMatch[1]}`,
                confidence: 0.75,
                source: MemorySource.AUTO
            })
        }

        // 讨厌匹配
        const dislikeMatch = message.match(/我(?:很)?(?:讨厌|不喜欢|烦)([^\s,，。！!？?\n]{2,20})/)
        if (dislikeMatch) {
            memories.push({
                userId,
                groupId,
                category: MemoryCategory.PREFERENCE,
                subType: PreferenceSubType.DISLIKE,
                content: `讨厌${dislikeMatch[1]}`,
                confidence: 0.75,
                source: MemorySource.AUTO
            })
        }

        return memories
    }

    /**
     * 从多轮对话中提取记忆（结合规则和 LLM）
     */
    async extractFromSession(userId, messages, options = {}) {
        const { groupId = null, useLLM = true } = options
        const allMemories = []

        // 先用规则快速提取
        for (const msg of messages) {
            if (msg.role === 'user') {
                const content = typeof msg.content === 'string' ? msg.content : msg.content?.text
                if (content) {
                    const quickMemories = this.quickExtract(userId, content, { groupId })
                    allMemories.push(...quickMemories)
                }
            }
        }

        // 如果规则提取不够且有 LLM，则调用 LLM 补充
        if (useLLM && this.llmClient && allMemories.length < 3 && messages.length >= 5) {
            const llmMemories = await this.extractFromConversation(userId, messages, {
                groupId,
                saveImmediately: false
            })

            // 去重合并
            for (const mem of llmMemories) {
                const isDuplicate = allMemories.some(
                    m =>
                        m.category === mem.category &&
                        m.subType === mem.subType &&
                        this.isSimilarContent(m.content, mem.content)
                )
                if (!isDuplicate) {
                    allMemories.push(mem)
                }
            }
        }

        // 保存所有记忆
        if (allMemories.length > 0) {
            const results = await memoryService.saveMemories(allMemories)
            return results.filter(r => r.success).map(r => r.memory)
        }

        return []
    }

    /**
     * 简单内容相似度检查
     */
    isSimilarContent(content1, content2) {
        const normalize = s =>
            s
                .toLowerCase()
                .replace(/\s+/g, '')
                .replace(/[，。！？、：；""''（）【】]/g, '')
        const n1 = normalize(content1)
        const n2 = normalize(content2)
        return n1 === n2 || n1.includes(n2) || n2.includes(n1)
    }
}

export const memoryExtractor = new MemoryExtractor()
export default memoryExtractor
