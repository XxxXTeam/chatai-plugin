/**
 * 记忆总结器
 * 负责合并、去重、清理和总结记忆
 */
import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'
import { memoryService } from './MemoryService.js'
import { callMemoryLLM, formatMemoryTime } from './llmHelper.js'
import { MemoryCategory, CategoryLabels, MemorySource, getCategoryLabel } from './MemoryTypes.js'

const logger = chatLogger

/**
 * 记忆总结 Prompt 模板。
 *
 * 输出被 summarizeCategory 逐行拆开直接落库，因此必须禁止序号与说明性文字，
 * 否则“1.”“整理后：”这类前缀会成为记忆内容的一部分。
 * @constant {string}
 */
const SUMMARY_PROMPT = `你是一个记忆总结助手，负责合并和整理同一分类下的用户记忆。

【任务】把下面这组记忆整理成更短、更准确的一组，去掉重复、冗余和已被推翻的内容。

【分类】{categoryLabel}

【现有记忆】
下列记忆按更新时间从新到旧排列，编号越小表示记录得越新；编号只用于阅读，不要出现在输出里。
{memories}

【要求】
1. 表达同一件事的多条记忆合并成一条，保留信息最完整、最具体的说法
2. 两条互相矛盾且无法共存时，保留编号更小的那条（它记录得更新）
3. 删除与该分类无关、或空泛到没有信息量的条目
4. 每条记忆一行，一句话说清
5. 整理后的条数应当明显少于输入条数；若确实无可合并，原样输出全部记忆

【输出格式】
每行一条整理后的记忆。
不要加序号、符号前缀、小标题或任何解释文字。

整理结果：`

/**
 * 冲突解决 Prompt 模板。
 *
 * 输出被 resolveConflict 原样当作新的记忆内容，任何解释性文字都会污染记忆库。
 * @constant {string}
 */
const CONFLICT_PROMPT = `你是一个记忆管理助手，需要在两条冲突的记忆之间做出裁决。

【冲突信息】
旧记忆：{oldMemory}（记录时间：{oldTime}）
新记忆：{newMemory}（记录时间：{newTime}）

【判断规则】
1. 新记忆是对旧记忆的更正（同一件事换了说法/改了数值）：只保留新记忆
2. 两者说的是同一主题的不同侧面：合并成一句话，同时保留两边的信息
3. 依据不足、无法判断属于哪种情况：保留新记忆（记录时间更近，通常更接近现状）

【输出格式】
只输出最终要保留的那条记忆内容本身，一行，不超过50字。
不要写“保留新记忆”“结果是”之类的说明，不要加引号、编号或任何前后缀。

结果：`

/**
 * 将模型输出解析为可直接写入记忆库的纯文本条目。
 * 兼容逐行文本和字符串数组 JSON，并剔除代码围栏、标题、编号及说明性前缀。
 *
 * @param {unknown} response - 模型原始输出
 * @returns {string[]} 去重后的记忆内容
 */
export function parseMemorySummaryResponse(response) {
    const text = typeof response === 'string' ? response.trim() : ''
    if (!text) return []

    let lines = text.split(/\r?\n/)
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text)
            if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
                lines = parsed.map(String)
            }
        } catch {}
    }

    const normalized = lines
        .map(line =>
            String(line || '')
                .trim()
                .replace(/^```(?:json|markdown|text)?\s*$/i, '')
                .replace(/^#{1,6}\s*/, '')
                .replace(/^[-*•]+\s*/, '')
                .replace(/^\d+[.)、]\s*/, '')
                .replace(/^(?:整理结果|总结结果|结果)[：:]\s*/i, '')
                .trim()
        )
        .filter(line => {
            if (!line || line === '```' || line === '无') return false
            if (/^(?:以下是|根据|我将|说明|备注)[：:]?$/i.test(line)) return false
            return line.length <= 500
        })

    return [...new Set(normalized)]
}

class MemorySummarizer {
    /** @type {Object|null} */
    llmClient = null

    constructor() {}

    /**
     * 设置 LLM 客户端
     * @param {Object|null} client - 客户端实例；null 表示恢复按配置动态解析
     */
    setLLMClient(client) {
        this.llmClient = client
    }

    /**
     * 获取本次总结使用的 LLM 客户端。
     * 显式注入的客户端优先；否则按记忆模型和群作用域实时选择渠道，
     * 避免把某个群的独立渠道客户端缓存后复用于其他群。
     *
     * @param {{groupId?: string|number|null, model?: string}} [options] - 解析选项
     * @param {string} [options.model] - 指定模型
     * @returns {Promise<Object>} LLM 客户端
     */
    async resolveLLMClient(options = {}) {
        if (this.llmClient) return this.llmClient

        const resolvedOptions = { groupId: undefined, model: undefined, ...options }
        const { LlmService } = await import('../llm/LlmService.js')
        const configuredMemoryModel = config.get('memory.model')
        const model =
            typeof resolvedOptions.model === 'string' && resolvedOptions.model
                ? resolvedOptions.model
                : typeof configuredMemoryModel === 'string' && configuredMemoryModel
                  ? configuredMemoryModel
                  : undefined
        return LlmService.getChatClient({
            model,
            ...(resolvedOptions.groupId !== null &&
            resolvedOptions.groupId !== undefined &&
            resolvedOptions.groupId !== ''
                ? { groupId: String(resolvedOptions.groupId) }
                : {})
        })
    }

    /**
     * 总结用户的所有记忆
     * @param {string} userId - 用户ID
     * @param {{groupId?: string|null, useLLM?: boolean, model?: string}} [options] - 选项
     */
    async summarizeUserMemories(userId, options = {}) {
        const hasGroupId = Object.prototype.hasOwnProperty.call(options, 'groupId')
        const summaryOptions = { groupId: undefined, useLLM: true, model: undefined, ...options }
        const groupId = hasGroupId ? summaryOptions.groupId : undefined
        const { useLLM = true, model } = summaryOptions

        try {
            const result = {
                success: true,
                userId,
                originalCount: 0,
                finalCount: 0,
                beforeCount: 0,
                afterCount: 0,
                mergedCount: 0,
                removedCount: 0,
                byCategory: {}
            }

            // 1. 先进行简单的去重合并
            const mergeResult = await memoryService.mergeMemories(userId, { groupId })
            result.originalCount = mergeResult.originalCount
            result.beforeCount = mergeResult.originalCount
            result.mergedCount = mergeResult.mergedCount
            result.removedCount = mergeResult.deletedCount

            // 2. 如果启用 LLM，对每个分类进行智能总结
            if (useLLM) {
                const tree = await memoryService.getMemoryTree(userId, { groupId })
                const scopeClients = new Map()

                for (const category of Object.values(MemoryCategory)) {
                    const categoryData = tree[category]
                    if (!categoryData || categoryData.items.length === 0) {
                        result.byCategory[category] = {
                            count: 0,
                            summarized: false
                        }
                        continue
                    }

                    // 同一分类仍需按群作用域分别总结，禁止把两个群的用户信息合并到一起。
                    const scopeBuckets = new Map()
                    for (const item of categoryData.items) {
                        const scopedGroupId = item.groupId ?? null
                        const scopeKey = scopedGroupId === null ? 'global' : `group:${scopedGroupId}`
                        if (!scopeBuckets.has(scopeKey)) {
                            scopeBuckets.set(scopeKey, { groupId: scopedGroupId, items: [] })
                        }
                        scopeBuckets.get(scopeKey).items.push(item)
                    }

                    let finalCategoryCount = 0
                    let categorySummarized = false
                    for (const bucket of scopeBuckets.values()) {
                        if (bucket.items.length > 5) {
                            const scopeKey = bucket.groupId === null ? 'global' : `group:${bucket.groupId}`
                            if (!scopeClients.has(scopeKey)) {
                                scopeClients.set(
                                    scopeKey,
                                    await this.resolveLLMClient({ groupId: bucket.groupId, model })
                                )
                            }
                            const summarized = await this.summarizeCategory(userId, category, bucket.items, {
                                groupId: bucket.groupId,
                                llmClient: scopeClients.get(scopeKey)
                            })
                            finalCategoryCount += summarized.length
                            categorySummarized ||= summarized !== bucket.items
                        } else {
                            finalCategoryCount += bucket.items.length
                        }
                    }

                    result.byCategory[category] = {
                        count: finalCategoryCount,
                        summarized: categorySummarized,
                        original: categoryData.items.length
                    }
                }
            }

            // 更新最终计数
            const finalMemories = await memoryService.getMemoriesByUser(userId, { groupId, limit: 1000 })
            result.finalCount = finalMemories.length
            result.afterCount = result.finalCount

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
     * @param {string} userId - 用户 ID
     * @param {string} category - 记忆分类
     * @param {Object[]} memories - 同一作用域中的旧记忆
     * @param {{groupId?: string|null, llmClient?: Object|null}} [options] - 总结选项
     * @returns {Promise<Object[]>} 新记忆；未执行替换时原样返回 memories
     */
    async summarizeCategory(userId, category, memories, options = {}) {
        const categoryOptions = { groupId: null, llmClient: this.llmClient, ...options }
        const { groupId = null, llmClient = this.llmClient } = categoryOptions

        if (!llmClient || memories.length <= 2) {
            return memories
        }

        try {
            // 格式化记忆列表
            const memoriesText = memories.map((m, i) => `${i + 1}. ${m.content}`).join('\n')
            const categoryLabel = getCategoryLabel(category)

            const prompt = SUMMARY_PROMPT.replace('{categoryLabel}', categoryLabel).replace('{memories}', memoriesText)

            const response = await this.callLLM(prompt, llmClient)

            if (!response || response.trim() === '') {
                return memories
            }

            // 解析总结结果
            const summarizedContents = parseMemorySummaryResponse(response)

            if (summarizedContents.length === 0) {
                return memories
            }

            // 如果总结结果和原来差不多，保留原来的
            if (summarizedContents.length >= memories.length * 0.9) {
                return memories
            }

            const oldIds = memories.map(m => m.id)
            const newMemories = await memoryService.replaceCategoryMemories({
                userId,
                groupId,
                category,
                oldIds,
                contents: summarizedContents,
                confidence: 0.85,
                source: MemorySource.SUMMARY
            })

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
     * @param {{groupId?: string|null, minConfidence?: number, maxAge?: number, minContentLength?: number}} [options] - 选项；groupId 未传表示全部作用域，null 表示全局作用域
     */
    async cleanupMemories(userId, options = {}) {
        const hasGroupId = Object.prototype.hasOwnProperty.call(options, 'groupId')
        const cleanupOptions = {
            groupId: undefined,
            minConfidence: 0.3,
            maxAge: 90 * 24 * 60 * 60 * 1000,
            minContentLength: 5,
            ...options
        }
        const {
            groupId,
            minConfidence,
            maxAge, // 默认90天
            minContentLength
        } = cleanupOptions

        const memories = await memoryService.getMemoriesByUser(userId, {
            ...(hasGroupId ? { groupId } : {}),
            limit: 1000
        })
        const now = Date.now()

        const toRemoveIds = memories
            .filter(
                memory =>
                    memory.confidence < minConfidence ||
                    (memory.expiresAt && memory.expiresAt < now) ||
                    (now - memory.updatedAt > maxAge && memory.confidence < 0.6) ||
                    memory.content.length < minContentLength
            )
            .map(m => m.id)

        if (toRemoveIds.length > 0) {
            await memoryService.deleteMemoriesBatch(toRemoveIds, true)
        }

        logger.info(`[MemorySummarizer] 清理用户 ${userId} 低质量记忆: ${toRemoveIds.length} 条`)

        return { removedCount: toRemoveIds.length }
    }

    /**
     * 全局清理任务
     */
    async globalCleanup() {
        const users = await memoryService.listUsers()
        const BATCH_SIZE = 10
        let totalRemoved = 0

        for (let i = 0; i < users.length; i += BATCH_SIZE) {
            const batch = users.slice(i, i + BATCH_SIZE)
            const results = await Promise.all(
                batch.map(user =>
                    this.cleanupMemories(user.userId).catch(err => {
                        logger.warn(`[MemorySummarizer] 清理用户 ${user.userId} 失败:`, err.message)
                        return { removedCount: 0 }
                    })
                )
            )
            totalRemoved += results.reduce((sum, r) => sum + r.removedCount, 0)
        }

        logger.info(`[MemorySummarizer] 全局清理完成: 共清理 ${totalRemoved} 条记忆`)

        return { totalRemoved, usersProcessed: users.length }
    }

    /**
     * 衰减记忆可信度
     * 随时间降低未被引用记忆的可信度
     * @param {{decayRate?: number, minConfidence?: number, daysThreshold?: number}} [options] - 衰减选项
     */
    async decayConfidence(options = {}) {
        const decayOptions = { decayRate: 0.95, minConfidence: 0.3, daysThreshold: 30, ...options }
        const { decayRate, minConfidence, daysThreshold } = decayOptions

        const { databaseService } = await import('../storage/DatabaseService.js')
        databaseService.init()
        const db = databaseService.db
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
     * 调用 LLM（使用共享辅助函数）
     */
    async callLLM(prompt, llmClient = this.llmClient) {
        return callMemoryLLM(llmClient, prompt, {
            maxTokens: 800,
            temperature: 0.3,
            caller: 'MemorySummarizer'
        })
    }

    /**
     * 格式化时间（使用共享辅助函数）
     */
    formatTime(timestamp) {
        return formatMemoryTime(timestamp)
    }

    /**
     * 对话结束时自动触发记忆提取和总结
     * 可在对话结束（如 #ai结束对话）时调用此方法
     * @param {string} userId - 用户ID
     * @param {Array} messages - 本次对话消息列表
     * @param {{groupId?: string|null, summarize?: boolean}} [options] - 选项
     * @returns {Promise<Object>} 提取和总结结果
     */
    async onConversationEnd(userId, messages, options = {}) {
        const conversationOptions = { groupId: null, summarize: true, ...options }
        const { groupId, summarize } = conversationOptions

        const result = {
            extractedCount: 0,
            summarized: false,
            cleanedCount: 0
        }

        try {
            // 1. 从对话中提取记忆
            const { memoryExtractor } = await import('./MemoryExtractor.js')
            if (this.llmClient && !memoryExtractor.llmClient) {
                memoryExtractor.setLLMClient(this.llmClient)
            }

            const extracted = await memoryExtractor.extractFromSession(userId, messages, {
                groupId,
                useLLM: !!this.llmClient
            })
            result.extractedCount = extracted.length

            // 2. 如果启用总结且记忆条数超过阈值，执行智能总结
            if (summarize) {
                const stats = await memoryService.getStats(userId)
                if (stats.total > 20) {
                    const summaryResult = await this.summarizeUserMemories(userId, {
                        groupId,
                        useLLM: !!this.llmClient
                    })
                    result.summarized = true
                    Object.assign(result, { summaryResult })
                }

                // 3. 清理低质量记忆
                const cleanResult = await this.cleanupMemories(userId, {
                    groupId,
                    minConfidence: 0.3,
                    minContentLength: 3
                })
                result.cleanedCount = cleanResult.removedCount
            }

            logger.info(
                `[MemorySummarizer] 对话结束处理完成: userId=${userId}, 提取=${result.extractedCount}, 总结=${result.summarized}, 清理=${result.cleanedCount}`
            )
        } catch (error) {
            logger.error('[MemorySummarizer] 对话结束处理失败:', error.message)
            Object.assign(result, { error: error.message })
        }

        return result
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

        for (const [category, rawData] of Object.entries(tree)) {
            if (!rawData || typeof rawData !== 'object') continue
            const data = Object.assign({ label: '', count: 0, items: new Array() }, rawData)
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
