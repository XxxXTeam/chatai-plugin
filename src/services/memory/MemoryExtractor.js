/**
 * 记忆提取器
 * 从对话中自动提取并分类用户记忆
 */
import { chatLogger } from '../../core/utils/logger.js'
import { memoryService } from './MemoryService.js'
import { callMemoryLLM } from './llmHelper.js'
import { isSimilarContent as isSimilarContentUtil } from '../../utils/common.js'
import {
    MemoryCategory,
    ProfileSubType,
    PreferenceSubType,
    EventSubType,
    RelationSubType,
    TopicSubType,
    MemorySource,
    CategoryLabels,
    SubTypeLabels,
    getSubTypes
} from './MemoryTypes.js'

const logger = chatLogger

/**
 * 允许 LLM 使用的分类，顺序即提示词中的呈现顺序。
 * 不含 custom：该分类保留给手动录入与外部扩展，其子类型不受 isValidCategorySubType 约束，
 * 一旦放开会让模型输出任意子类型都能通过校验。
 * @constant {string[]}
 */
const EXTRACTABLE_CATEGORIES = [
    MemoryCategory.PROFILE,
    MemoryCategory.PREFERENCE,
    MemoryCategory.EVENT,
    MemoryCategory.RELATION,
    MemoryCategory.TOPIC
]

/**
 * 由 MemoryTypes.js 生成分类清单文本。
 * 分类体系此前在提示词里另抄了一份，与 MemoryTypes.js 双份维护；
 * 改为生成后，新增或删除子类型只需改 MemoryTypes.js，提示词与 isValidCategorySubType 的校验自动保持一致。
 * @returns {string} 形如 `1. profile（基本信息）\n   - name: 姓名` 的清单
 */
function buildCategoryCatalog() {
    return EXTRACTABLE_CATEGORIES.map((category, index) => {
        const subTypes = getSubTypes(category)
            .map(subType => `   - ${subType}: ${SubTypeLabels[subType] || subType}`)
            .join('\n')
        return `${index + 1}. ${category}（${CategoryLabels[category] || category}）\n${subTypes}`
    }).join('\n\n')
}

/**
 * 记忆提取 Prompt 模板。
 *
 * 输出格式与 parseExtractionResult 的 `/^\[([a-z]+):([a-z]+)\]\s*(.+)$/i` 严格耦合：
 * 方括号、冒号分隔与英文标识符不可改动，改动会让解析全部落空。
 * @constant {string}
 */
const EXTRACTION_PROMPT = `你是一个记忆提取助手，负责从对话中提取关于“用户”的关键信息。

【任务】分析对话内容，提取用户的个人信息并分类。

【输出格式】每行一条记忆，严格写成：[分类:子类型] 内容
分类与子类型必须原样使用下列英文标识，不要翻译、不要自造：

${buildCategoryCatalog()}

【示例输出】
[profile:name] 用户叫小明
[profile:age] 用户25岁
[preference:like] 用户喜欢打游戏
[event:birthday] 用户的生日是3月15日
[relation:friend] 小红是用户的朋友
[topic:interest] 用户对AI技术感兴趣

【对话内容】
每行以“用户:”或“AI:”开头，标明该条是谁说的。
{dialogText}

【提取要求】
- 只提取“用户:”说出口的明确信息；AI 的回答、建议、推测一律不提取
- 每条一句话，写清主体是谁，避免只写“25岁”这样脱离主语的片段
- 内容重复的只保留一条
- 忽略与用户个人信息无关的闲聊
- 每行必须以 [分类:子类型] 开头，不要加序号、不要用代码块包裹、不要写任何解释
- 没有可提取的信息时，只输出一个字：无

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
     * 调用 LLM（使用共享辅助函数）
     */
    async callLLM(prompt) {
        return callMemoryLLM(this.llmClient, prompt, {
            maxTokens: 1000,
            temperature: 0.3,
            caller: 'MemoryExtractor'
        })
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

    isSimilarContent(content1, content2) {
        return isSimilarContentUtil(content1, content2, { useJaccard: false })
    }
}

export const memoryExtractor = new MemoryExtractor()
export default memoryExtractor
