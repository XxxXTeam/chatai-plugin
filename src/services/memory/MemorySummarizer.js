/**
 * 记忆总结器
 * 负责合并、去重、清理和总结记忆
 */
import { chatLogger } from '../../core/utils/logger.js'
import { memoryService } from './MemoryService.js'
import { MemoryCategory, CategoryLabels, MemorySource, getCategoryLabel } from './MemoryTypes.js'

const logger = chatLogger

/**
 * 记忆总结 Prompt 模板
 */
const SUMMARY_PROMPT = `你是一个记忆总结助手，负责合并和整理用户记忆。

【任务】将以下同类记忆合并整理，去除重复和矛盾信息，保留最重要的内容。

【分类】{categoryLabel}

【现有记忆】
{memories}

【要求】
1. 合并相似的记忆，保留最准确的表述
2. 如果有矛盾信息，保留最新的
3. 去除重复和冗余
4. 每条记忆一行，简洁明了
5. 如果所有记忆都应保留，原样输出即可

【输出格式】
每行一条整理后的记忆，不需要序号或前缀。

整理结果：`

/**
 * 冲突解决 Prompt 模板
 */
const CONFLICT_PROMPT = `你是一个记忆管理助手，需要解决信息冲突。

【冲突信息】
旧记忆：{oldMemory}（记录时间：{oldTime}）
新记忆：{newMemory}（记录时间：{newTime}）

【要求】
判断应该保留哪个记忆，或如何合并：
1. 如果是更正信息，保留新的
2. 如果是补充信息，合并两者
3. 如果无法判断，保留新的

【输出格式】
只输出最终应保留的记忆内容，一行即可。

结果：`

class MemorySummarizer {
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
     * 总结用户的所有记忆
     * @param {string} userId - 用户ID
     * @param {Object} options - 选项
     */
    async summarizeUserMemories(userId, options = {}) {
        const { groupId = null, useLLM = true } = options

        try {
            const result = {
                userId,
                originalCount: 0,
                finalCount: 0,
                mergedCount: 0,
                removedCount: 0,
                byCategory: {}
            }

            // 1. 先进行简单的去重合并
            const mergeResult = await memoryService.mergeMemories(userId)
            result.originalCount = mergeResult.originalCount
            result.mergedCount = mergeResult.mergedCount
            result.removedCount = mergeResult.deletedCount

            // 2. 如果启用 LLM，对每个分类进行智能总结
            if (useLLM && this.llmClient) {
                const tree = await memoryService.getMemoryTree(userId, { groupId })

                for (const category of Object.values(MemoryCategory)) {
                    const categoryData = tree[category]
                    if (!categoryData || categoryData.items.length <= 2) {
                        result.byCategory[category] = {
                            count: categoryData?.count || 0,
                            summarized: false
                        }
                        continue
                    }

                    // 对超过一定数量的分类进行 LLM 总结
                    if (categoryData.items.length > 5) {
                        const summarized = await this.summarizeCategory(userId, category, categoryData.items, {
                            groupId
                        })
                        result.byCategory[category] = {
                            count: summarized.length,
                            summarized: true,
                            original: categoryData.items.length
                        }
                    } else {
                        result.byCategory[category] = {
                            count: categoryData.count,
                            summarized: false
                        }
                    }
                }
            }

            // 更新最终计数
            const stats = await memoryService.getStats(userId)
            result.finalCount = stats.total

            logger.info(
                `[MemorySummarizer] 用户 ${userId} 记忆总结完成: ${result.originalCount} -> ${result.finalCount}`
            )

            return result
        } catch (error) {
            logger.error('[MemorySummarizer] 总结记忆失败:', error)
            throw error
        }
    }

    /**
     * 对单个分类进行总结
     */
    async summarizeCategory(userId, category, memories, options = {}) {
        const { groupId = null } = options

        if (!this.llmClient || memories.length <= 2) {
            return memories
        }

        try {
            // 格式化记忆列表
            const memoriesText = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n')
            const categoryLabel = getCategoryLabel(category)

            const prompt = SUMMARY_PROMPT.replace('{categoryLabel}', categoryLabel).replace('{memories}', memoriesText)

            const response = await this.callLLM(prompt)

            if (!response || response.trim() === '') {
                return memories
            }

            // 解析总结结果
            const summarizedContents = response
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))

            // 如果总结结果和原来差不多，保留原来的
            if (summarizedContents.length >= memories.length * 0.9) {
                return memories
            }

            // 删除旧记忆，保存新的总结记忆
            const oldIds = memories.map(m => m.id)
            for (const id of oldIds) {
                await memoryService.deleteMemory(id, true)
            }

            const newMemories = []
            for (const content of summarizedContents) {
                const memory = await memoryService.saveMemory({
                    userId,
                    groupId,
                    category,
                    content,
                    confidence: 0.85,
                    source: MemorySource.SUMMARY
                })
                newMemories.push(memory)
            }

            logger.debug(`[MemorySummarizer] 分类 ${category} 总结: ${memories.length} -> ${newMemories.length}`)

            return newMemories
        } catch (error) {
            logger.error(`[MemorySummarizer] 分类 ${category} 总结失败:`, error)
            return memories
        }
    }

    /**
     * 解决记忆冲突
     * @param {Object} oldMemory - 旧记忆
     * @param {Object} newMemory - 新记忆
     * @returns {Object} 解决后的记忆
     */
    async resolveConflict(oldMemory, newMemory) {
        // 如果没有 LLM，默认保留新的
        if (!this.llmClient) {
            return newMemory
        }

        try {
            const prompt = CONFLICT_PROMPT.replace('{oldMemory}', oldMemory.content)
                .replace('{oldTime}', this.formatTime(oldMemory.updatedAt))
                .replace('{newMemory}', newMemory.content)
                .replace('{newTime}', this.formatTime(newMemory.updatedAt))

            const response = await this.callLLM(prompt)

            if (!response || response.trim() === '') {
                return newMemory
            }

            // 返回合并后的记忆
            return {
                ...newMemory,
                content: response.trim(),
                confidence: Math.max(oldMemory.confidence, newMemory.confidence),
                source: MemorySource.SUMMARY
            }
        } catch (error) {
            logger.error('[MemorySummarizer] 解决冲突失败:', error)
            return newMemory
        }
    }

    /**
     * 清理低质量记忆
     * @param {string} userId - 用户ID
     * @param {Object} options - 选项
     */
    async cleanupMemories(userId, options = {}) {
        const {
            minConfidence = 0.3,
            maxAge = 90 * 24 * 60 * 60 * 1000, // 90天
            minContentLength = 5
        } = options

        const memories = await memoryService.getMemoriesByUser(userId, { limit: 1000 })
        const now = Date.now()
        let removedCount = 0

        for (const memory of memories) {
            let shouldRemove = false

            // 低可信度
            if (memory.confidence < minConfidence) {
                shouldRemove = true
            }

            // 过期
            if (memory.expiresAt && memory.expiresAt < now) {
                shouldRemove = true
            }

            // 太老且可信度不高
            if (now - memory.updatedAt > maxAge && memory.confidence < 0.6) {
                shouldRemove = true
            }

            // 内容太短
            if (memory.content.length < minContentLength) {
                shouldRemove = true
            }

            if (shouldRemove) {
                await memoryService.deleteMemory(memory.id, true)
                removedCount++
            }
        }

        logger.info(`[MemorySummarizer] 清理用户 ${userId} 低质量记忆: ${removedCount} 条`)

        return { removedCount }
    }

    /**
     * 全局清理任务
     */
    async globalCleanup() {
        const users = await memoryService.listUsers()
        let totalRemoved = 0

        for (const user of users) {
            const result = await this.cleanupMemories(user.userId)
            totalRemoved += result.removedCount
        }

        logger.info(`[MemorySummarizer] 全局清理完成: 共清理 ${totalRemoved} 条记忆`)

        return { totalRemoved, usersProcessed: users.length }
    }

    /**
     * 衰减记忆可信度
     * 随时间降低未被引用记忆的可信度
     */
    async decayConfidence(options = {}) {
        const { decayRate = 0.95, minConfidence = 0.3, daysThreshold = 30 } = options

        const db = await this.getDB()
        const threshold = Date.now() - daysThreshold * 24 * 60 * 60 * 1000

        // 更新长时间未访问的记忆可信度
        const result = db
            .prepare(
                `
            UPDATE structured_memories 
            SET confidence = MAX(confidence * ?, ?),
                updated_at = ?
            WHERE is_active = 1 
            AND updated_at < ?
            AND confidence > ?
        `
            )
            .run(decayRate, minConfidence, Date.now(), threshold, minConfidence)

        logger.debug(`[MemorySummarizer] 衰减了 ${result.changes} 条记忆的可信度`)

        return { affected: result.changes }
    }

    /**
     * 获取数据库连接
     */
    async getDB() {
        const { databaseService } = await import('../storage/DatabaseService.js')
        databaseService.init()
        return databaseService.db
    }

    /**
     * 调用 LLM
     */
    async callLLM(prompt) {
        if (!this.llmClient) {
            throw new Error('LLM client not configured')
        }

        try {
            if (typeof this.llmClient.sendMessage === 'function') {
                const response = await this.llmClient.sendMessage(prompt, {
                    maxTokens: 800,
                    temperature: 0.3
                })
                return response?.text || response?.content || response
            } else if (typeof this.llmClient.complete === 'function') {
                const response = await this.llmClient.complete(prompt, {
                    maxTokens: 800,
                    temperature: 0.3
                })
                return response
            } else if (typeof this.llmClient.chat === 'function') {
                const response = await this.llmClient.chat([{ role: 'user', content: prompt }], {
                    maxTokens: 800,
                    temperature: 0.3
                })
                return response?.choices?.[0]?.message?.content || response?.content || response
            }

            throw new Error('Unknown LLM client type')
        } catch (error) {
            logger.error('[MemorySummarizer] LLM call failed:', error)
            throw error
        }
    }

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
        if (!timestamp) return '未知'
        const date = new Date(timestamp)
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    /**
     * 生成用户记忆报告
     */
    async generateReport(userId) {
        const tree = await memoryService.getMemoryTree(userId)
        const stats = await memoryService.getStats(userId)

        const report = {
            userId,
            generatedAt: new Date().toISOString(),
            summary: {
                totalMemories: stats.total,
                categories: Object.keys(stats.byCategory).length
            },
            byCategory: {}
        }

        for (const [category, data] of Object.entries(tree)) {
            if (data.count > 0) {
                report.byCategory[category] = {
                    label: data.label,
                    count: data.count,
                    items: data.items.slice(0, 10).map(m => ({
                        content: m.content,
                        subType: m.subType,
                        confidence: m.confidence
                    }))
                }
            }
        }

        return report
    }
}

export const memorySummarizer = new MemorySummarizer()
export default memorySummarizer
