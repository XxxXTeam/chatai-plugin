/**
 * KnowledgeGraphExtractor - 知识图谱提取器
 *
 * 从对话中提取实体和关系，构建知识图谱
 * 使用 LLM 进行实体识别和关系提取
 */

import { knowledgeGraphService } from './KnowledgeGraphService.js'
import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'

const logger = chatLogger

// 实体提取提示词
const ENTITY_EXTRACTION_PROMPT = `你是知识图谱专家，负责从对话中提取结构化实体信息。

【任务】
从以下对话中提取实体信息。实体类型包括：
1. person - 人物（用户、朋友、家人、同事等）
2. thing - 物品（手机、书籍、游戏、食物等）
3. place - 地点（城市、公司、学校、餐厅等）
4. concept - 抽象概念（爱好、技能、目标、情感等）
5. event - 事件（生日、会议、计划、纪念日等）

【输出格式】
每行输出一个 JSON 对象，格式如下：
{"name": "实体名称", "type": "实体类型", "properties": {"属性名": "属性值"}}

【约束】
- 只提取明确提到的实体，不要推测
- 人名、地名必须完整准确
- 属性只记录确定的事实
- 如果没有发现任何实体，输出空行
- 不要输出解释或分析文字

【对话内容】
{conversation}

【提取结果】`

// 关系提取提示词
const RELATION_EXTRACTION_PROMPT = `你是关系分析专家，从对话和已知实体中提取关系三元组。

【已知实体】
{entities}

【任务】
提取实体之间的关系。常见关系类型：
- knows（认识）
- friend_of（朋友）
- family_of（家人）
- works_at（工作于）
- lives_in（居住在）
- likes（喜欢）
- dislikes（不喜欢）
- owns（拥有）
- attends（参加）
- born_on（出生于）
- created（创作）
- member_of（成员）

【输出格式】
每行输出一个关系，格式：
{"from": "实体1名称", "relation": "关系类型", "to": "实体2名称", "properties": {"属性名": "值"}}

【约束】
- 只提取明确的关系，不要推测
- from 和 to 必须是已知实体列表中的实体名称
- 如果没有发现任何关系，输出空行

【对话内容】
{conversation}

【提取结果】`

class KnowledgeGraphExtractor {
    constructor() {
        this.llmClient = null
    }

    /**
     * 获取 LLM 客户端
     */
    async _getLlmClient() {
        if (this.llmClient) return this.llmClient

        try {
            const { LlmService } = await import('../llm/LlmService.js')
            this.llmClient = await LlmService.getSimpleChatClient({
                enableTools: false
            })
            return this.llmClient
        } catch (error) {
            logger.error('[KGExtractor] 获取 LLM 客户端失败:', error.message)
            return null
        }
    }

    /**
     * 从对话中提取知识
     * @param {Array} messages - 消息列表 [{role, content}]
     * @param {string} scopeId - 作用域 ID
     * @param {Object} options - 选项
     */
    async extractFromConversation(messages, scopeId, options = {}) {
        const { minMessages = 3, extractRelations = true } = options

        if (!messages || messages.length < minMessages) {
            return { entities: [], relationships: [] }
        }

        // 格式化对话内容
        const conversationText = this._formatConversation(messages)

        // 提取实体
        const entities = await this.extractEntities(conversationText, scopeId)

        // 提取关系
        let relationships = []
        if (extractRelations && entities.length > 0) {
            relationships = await this.extractRelationships(conversationText, entities, scopeId)
        }

        // 去重和验证
        const validatedEntities = this._validateEntities(entities)
        const validatedRelationships = this._validateRelationships(relationships, validatedEntities)

        // 保存到知识图谱
        const savedEntities = await this._saveEntities(validatedEntities, scopeId)
        const savedRelationships = await this._saveRelationships(validatedRelationships, scopeId, savedEntities)

        logger.info(`[KGExtractor] 提取完成: ${savedEntities.length} 个实体, ${savedRelationships.length} 个关系`)

        return {
            entities: savedEntities,
            relationships: savedRelationships
        }
    }

    /**
     * 提取实体
     */
    async extractEntities(conversationText, scopeId) {
        const client = await this._getLlmClient()
        if (!client) return []

        const prompt = ENTITY_EXTRACTION_PROMPT.replace('{conversation}', conversationText)

        try {
            const model = config.get('memory.model') || config.get('llm.defaultModel')
            const response = await client.sendMessage(prompt, {
                model,
                maxTokens: 1000,
                temperature: 0.3,
                systemMessage: '你是一个精确的知识图谱实体提取器。只输出 JSON 格式的实体，每行一个。'
            })

            const content = this._extractContent(response)
            return this._parseEntities(content)
        } catch (error) {
            logger.error('[KGExtractor] 实体提取失败:', error.message)
            return []
        }
    }

    /**
     * 提取关系
     */
    async extractRelationships(conversationText, entities, scopeId) {
        const client = await this._getLlmClient()
        if (!client) return []

        const entityList = entities.map(e => `- ${e.name} (${e.type})`).join('\n')
        const prompt = RELATION_EXTRACTION_PROMPT.replace('{entities}', entityList).replace(
            '{conversation}',
            conversationText
        )

        try {
            const model = config.get('memory.model') || config.get('llm.defaultModel')
            const response = await client.sendMessage(prompt, {
                model,
                maxTokens: 800,
                temperature: 0.3,
                systemMessage: '你是一个精确的关系提取器。只输出 JSON 格式的关系，每行一个。'
            })

            const content = this._extractContent(response)
            return this._parseRelationships(content, entities)
        } catch (error) {
            logger.error('[KGExtractor] 关系提取失败:', error.message)
            return []
        }
    }

    /**
     * 从用户消息模式中提取简单实体（无需 LLM）
     */
    extractSimpleEntities(text, scopeId) {
        const entities = []

        // 匹配 "我是XXX"、"我叫XXX" 等自我介绍
        const namePatterns = [/我(?:是|叫|名字是|名叫)\s*([^\s,，。！？]+)/g, /(?:叫我|称呼我)\s*([^\s,，。！？]+)/g]

        for (const pattern of namePatterns) {
            const matches = text.matchAll(pattern)
            for (const match of matches) {
                const name = match[1].trim()
                if (name.length >= 1 && name.length <= 20) {
                    entities.push({
                        name,
                        type: 'person',
                        properties: { relation: '用户本人' }
                    })
                }
            }
        }

        // 匹配 "我喜欢XXX"
        const likePatterns = [/我(?:喜欢|爱|热爱|迷)\s*([^\s,，。！？]+)/g]

        for (const pattern of likePatterns) {
            const matches = text.matchAll(pattern)
            for (const match of matches) {
                const thing = match[1].trim()
                if (thing.length >= 1 && thing.length <= 30) {
                    entities.push({
                        name: thing,
                        type: 'concept',
                        properties: { category: '爱好' }
                    })
                }
            }
        }

        // 匹配 "我在XXX工作/上学"
        const placePatterns = [
            /我在\s*([^\s,，。！？]+)\s*(?:工作|上班|上学|读书|住)/g,
            /我(?:住在|家在)\s*([^\s,，。！？]+)/g
        ]

        for (const pattern of placePatterns) {
            const matches = text.matchAll(pattern)
            for (const match of matches) {
                const place = match[1].trim()
                if (place.length >= 2 && place.length <= 30) {
                    entities.push({
                        name: place,
                        type: 'place',
                        properties: {}
                    })
                }
            }
        }

        return entities
    }

    /**
     * 格式化对话内容
     */
    _formatConversation(messages) {
        return messages
            .map(m => {
                const role = m.role === 'user' ? '用户' : 'AI'
                const content =
                    typeof m.content === 'string'
                        ? m.content
                        : Array.isArray(m.content)
                          ? m.content
                                .filter(c => c.type === 'text')
                                .map(c => c.text)
                                .join('')
                          : ''
                return `${role}: ${content}`
            })
            .join('\n')
            .slice(0, 3000) // 限制长度
    }

    /**
     * 从响应中提取内容
     */
    _extractContent(response) {
        if (!response) return ''

        if (typeof response === 'string') return response

        if (response.contents) {
            return response.contents
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n')
        }

        if (response.content) {
            if (typeof response.content === 'string') return response.content
            if (Array.isArray(response.content)) {
                return response.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n')
            }
        }

        return ''
    }

    /**
     * 解析实体
     */
    _parseEntities(content) {
        const entities = []
        const lines = content.split('\n')

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('{')) continue

            try {
                const entity = JSON.parse(trimmed)
                if (entity.name && entity.type) {
                    entities.push({
                        name: String(entity.name).trim(),
                        type: String(entity.type).trim(),
                        properties: entity.properties || {}
                    })
                }
            } catch {
                // 忽略解析错误
            }
        }

        return entities
    }

    /**
     * 解析关系
     */
    _parseRelationships(content, entities) {
        const relationships = []
        const entityNames = new Set(entities.map(e => e.name))
        const lines = content.split('\n')

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('{')) continue

            try {
                const rel = JSON.parse(trimmed)
                if (rel.from && rel.relation && rel.to) {
                    // 验证实体名称存在
                    if (entityNames.has(rel.from) && entityNames.has(rel.to)) {
                        relationships.push({
                            from: String(rel.from).trim(),
                            relation: String(rel.relation).trim(),
                            to: String(rel.to).trim(),
                            properties: rel.properties || {}
                        })
                    }
                }
            } catch {
                // 忽略解析错误
            }
        }

        return relationships
    }

    /**
     * 验证实体
     */
    _validateEntities(entities) {
        const seen = new Set()
        const valid = []

        for (const entity of entities) {
            // 检查必需字段
            if (!entity.name || !entity.type) continue

            // 检查名称长度
            if (entity.name.length < 1 || entity.name.length > 100) continue

            // 检查类型有效性
            const validTypes = ['person', 'thing', 'place', 'concept', 'event']
            if (!validTypes.includes(entity.type)) continue

            // 去重
            const key = `${entity.type}:${entity.name}`
            if (seen.has(key)) continue
            seen.add(key)

            valid.push(entity)
        }

        return valid
    }

    /**
     * 验证关系
     */
    _validateRelationships(relationships, entities) {
        const entityNames = new Set(entities.map(e => e.name))
        const seen = new Set()
        const valid = []

        for (const rel of relationships) {
            // 检查必需字段
            if (!rel.from || !rel.relation || !rel.to) continue

            // 检查实体存在
            if (!entityNames.has(rel.from) || !entityNames.has(rel.to)) continue

            // 去重
            const key = `${rel.from}:${rel.relation}:${rel.to}`
            if (seen.has(key)) continue
            seen.add(key)

            valid.push(rel)
        }

        return valid
    }

    /**
     * 保存实体到知识图谱
     */
    async _saveEntities(entities, scopeId) {
        const saved = []

        for (const entity of entities) {
            try {
                const result = knowledgeGraphService.createEntity({
                    name: entity.name,
                    type: entity.type,
                    scopeId,
                    properties: entity.properties,
                    changeReason: '从对话中提取'
                })
                saved.push(result)
            } catch (error) {
                logger.warn(`[KGExtractor] 保存实体失败: ${entity.name}`, error.message)
            }
        }

        return saved
    }

    /**
     * 保存关系到知识图谱
     */
    async _saveRelationships(relationships, scopeId, savedEntities) {
        const saved = []
        const entityMap = new Map(savedEntities.map(e => [e.name, e.entityId]))

        for (const rel of relationships) {
            try {
                const fromId = entityMap.get(rel.from)
                const toId = entityMap.get(rel.to)

                if (!fromId || !toId) continue

                const result = knowledgeGraphService.createRelationship({
                    fromEntityId: fromId,
                    toEntityId: toId,
                    relationType: rel.relation,
                    scopeId,
                    properties: rel.properties,
                    changeReason: '从对话中提取'
                })
                saved.push(result)
            } catch (error) {
                logger.warn(`[KGExtractor] 保存关系失败: ${rel.from} -> ${rel.to}`, error.message)
            }
        }

        return saved
    }

    /**
     * 合并重复实体
     * @param {string} scopeId - 作用域
     * @param {number} similarityThreshold - 相似度阈值 (0-1)
     */
    async deduplicateEntities(scopeId, similarityThreshold = 0.9) {
        // 获取作用域下所有实体
        const entities = knowledgeGraphService.listEntities(scopeId, { limit: 1000 })

        // 按类型分组
        const byType = {}
        for (const entity of entities) {
            if (!byType[entity.entityType]) {
                byType[entity.entityType] = []
            }
            byType[entity.entityType].push(entity)
        }

        let mergedCount = 0

        // 对每种类型进行去重
        for (const [type, typeEntities] of Object.entries(byType)) {
            for (let i = 0; i < typeEntities.length; i++) {
                for (let j = i + 1; j < typeEntities.length; j++) {
                    const similarity = this._calculateSimilarity(typeEntities[i].name, typeEntities[j].name)

                    if (similarity >= similarityThreshold) {
                        // 合并：保留较早创建的，删除较晚的
                        const [keep, remove] =
                            typeEntities[i].createdAt < typeEntities[j].createdAt
                                ? [typeEntities[i], typeEntities[j]]
                                : [typeEntities[j], typeEntities[i]]

                        // 合并属性
                        const mergedProps = {
                            ...remove.properties,
                            ...keep.properties
                        }

                        knowledgeGraphService.updateEntity(keep.entityId, {
                            properties: mergedProps,
                            changeReason: `合并实体: ${remove.name}`
                        })

                        knowledgeGraphService.deleteEntity(remove.entityId, `合并到 ${keep.name}`)
                        mergedCount++

                        // 移除已删除的实体
                        typeEntities.splice(j, 1)
                        j--
                    }
                }
            }
        }

        logger.info(`[KGExtractor] 实体去重完成: 合并 ${mergedCount} 个`)
        return mergedCount
    }

    /**
     * 计算字符串相似度（Levenshtein 距离）
     */
    _calculateSimilarity(str1, str2) {
        const s1 = str1.toLowerCase()
        const s2 = str2.toLowerCase()

        if (s1 === s2) return 1

        const len1 = s1.length
        const len2 = s2.length

        if (len1 === 0 || len2 === 0) return 0

        const matrix = []

        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i]
        }
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j
        }

        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
                matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
            }
        }

        const distance = matrix[len1][len2]
        return 1 - distance / Math.max(len1, len2)
    }
}

export const knowledgeGraphExtractor = new KnowledgeGraphExtractor()
export default KnowledgeGraphExtractor
