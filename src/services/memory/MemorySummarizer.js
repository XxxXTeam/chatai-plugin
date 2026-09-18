/**
 * 记忆总结器
 * 负责合并、去重、清理和总结记忆
 */
import { chatLogger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'
import { memoryService } from './MemoryService.js'
import { callMemoryLLM, formatMemoryTime } from './llmHelper.js'
import { MemoryCategory, MemorySource, getCategoryLabel, isValidCategory } from './MemoryTypes.js'
import { preserveTargetId } from '../../core/platform/StandardBotIdentity.js'

const logger = chatLogger

/**
 * 记忆总结 Prompt 模板。
 *
 * 输出被 summarizeCategory 逐行拆开直接落库，因此必须是结构化行（[分类] 内容），
 * 并显式切断归纳、比较、解释等诱导思考链的措辞——思考过程一旦以文本形式流出
 * 就会被解析端误收为记忆（2026-09-17 线上事故）。
 * @constant {string}
 */
const SUMMARY_PROMPT = `你是记忆整理器。你的唯一任务是输出整理后的记忆行，不要解释、不要推理，不要说"注意""所以""可以"之类的话。

【任务】把下面同一分类的用户记忆合并精简：同一件事的多条合并为一条；互相矛盾时保留更新的一条；删除空泛无信息量的条目。

【分类】{categoryLabel}

【现有记忆】
{memories}

【输出格式（必须严格遵守）】
1. 每行一条记忆，行首必须以方括号标注分类，形如：[preference] 用户喜欢打游戏
2. 方括号内的分类标识只能使用下列之一（写英文，不要翻译）：profile、preference、event、relation、topic、custom
3. 除记忆行之外不输出任何内容：不要序号、标题、解释、分析过程、开场白或结尾语
4. 合并后总行数必须少于现有记忆行数；确实无法合并时，把现有记忆逐条原样抄一遍（保持 [分类] 前缀）`

const MEMORY_CATEGORY_PREFIX_PATTERN = /^\[([a-z]+)(?::[a-zA-Z0-9_-]+)?\]\s*[:：]?\s*(.+)$/i

/** 推理/元叙述行首词：自由文本回退模式下命中即视为思考过程丢弃 */
const REASONING_LINE_START =
    /^(?:我们|注意|因此|所以|首先|其次|然后|最后|综上|接下来|需要|应该|可以|要|请|不要|避免|确保|检查|输出|输入|整理|合并|保留|删除|编号|格式|要求|最终|以上|以下|可能|或者|这样|如果)/

/** 推理连接词重复计数：短句中出现 2 个以上即判定为思考过程 */
const REASONING_WORDS = /(?:需要|应该|可以|所以|因此|注意|输出|整理|合并|编号|格式|检查|确保)/g

/** 结果标签前缀：自由文本行先剥掉这些前缀，露出未带结构化前缀的真实记忆内容 */
const RESULT_LABEL_PREFIX = /^(?:整理结果|总结结果|最终结果|结果)[：:]\s*/i

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
 *
 * 双通道解析：
 * 1. 结构化行 `[category] 内容`（或 `[category:sub] 内容`，分类经白名单校验）
 *    直接采信——这是提示词要求的主通道；
 * 2. 自由文本行仅作兼容回退，过「思考过程过滤器」才保留；
 *    过滤锚点包括：推理词集中的行、短句内推理词密度过高、明显元叙述句式。
 * 模型把思考过程整段输出的坏 case（2026-09-17）会被两种通道共同拦截。
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

    /** 结构化行：命中的行直接入库，不做其他过滤 */
    const structured = []
    /** 自由文本回退通道收集的行 */
    const rest = []

    for (const raw of lines) {
        const line = String(raw ?? '')
            .trim()
            .replace(/^```(?:json|markdown|text)?\s*$/i, '')
            .trim()
        if (!line || line === '```' || line === '无') continue

        const structMatch = line.match(MEMORY_CATEGORY_PREFIX_PATTERN)
        if (structMatch) {
            const category = structMatch[1].toLowerCase()
            const content = structMatch[2].trim()
            if (!isValidCategory(category) || !content) continue
            structured.push(content)
            continue
        }

        // 自由文本回退通道（详见函数注释）
        rest.push(line)
    }

    for (const line of rest) {
        // 整行围栏、标题
        if (/^#{1,6}\s*/.test(line)) continue

        // 先剥旧格式列表/序号前缀与结果标签，露出内容本体再判断
        const cleaned = line
            .replace(/^[-*•+]+\s*/, '')
            .replace(/^\d+[.)、]\s*/, '')
            .replace(RESULT_LABEL_PREFIX, '')
            .trim()
        if (!cleaned || cleaned === '无' || cleaned.length > 500) continue

        // 说明性前缀行
        if (/^(?:以下是|以下|根据|我将|说明|备注|注意|总结|整理后|输出|输入)[：:，,]/.test(cleaned)) continue
        if (/^(?:整理结果|总结结果|最终结果|接下来|所以|因此|综上|首先|其次|最后)[：:]?/.test(cleaned)) continue
        // 行首推理元叙述（"注意""所以""我们只需要"等引导语）
        if (REASONING_LINE_START.test(cleaned)) continue
        // 推理连接词密度：短句中出现 2 个以上即判为思考过程
        const reasoningMatch = cleaned.match(REASONING_WORDS)
        if (reasoningMatch && reasoningMatch.length >= 2) continue
        // 元叙述/自我问答句式
        if (/为什么要|怎么(?:办|做|处理)|这样(?:做|行|可以|的话)/.test(cleaned)) continue

        structured.push(cleaned)
    }

    return [...new Set(structured)]
}

class MemorySummarizer {
    /** @type {Object|null} */
    llmClient = null

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
        let cleanupResult = null

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
                cleanedCount: 0,
                byCategory: {}
            }

            // 1. 先进行简单的去重合并
            const mergeResult = await memoryService.mergeMemories(userId, { groupId })
            result.originalCount = mergeResult.originalCount
            result.beforeCount = mergeResult.originalCount
            result.mergedCount = mergeResult.mergedCount
            result.removedCount = mergeResult.deletedCount

            // 清理低质量记忆（confidence 过低 / 过期 / 过老 / 过短）。
            // 显式 cleanup === true 才执行：直接用服务的能力（如对话结束链、测试）保持
            // 既有语义，前端"总结整理"按钮经 API 传 cleanup=true 时附带清理
            if (summaryOptions.cleanup === true) {
                try {
                    cleanupResult = await this.cleanupMemories(userId, {
                        ...(hasGroupId ? { groupId } : {})
                    })
                    result.cleanedCount = cleanupResult.removedCount || 0
                } catch (cleanupError) {
                    logger.warn('[MemorySummarizer] 清理步骤失败，继续总结:', cleanupError.message)
                }
            }

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
                        /*
                         * 原实现桶内 >5 才总结，且结果条数 >= 输入的 90% 就整体放弃，
                         * 导致"总结整理"按钮大概率 no-op。改为：桶内 >2 且该分类
                         * 累计 >=5 条件即总结；保底阈值由 90% 收紧为 100%（条数相同但
                         * 内容去重合并时仍允许替换）。
                         */
                        if (bucket.items.length > 2 && categoryData.items.length >= 5) {
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
            if (cleanupResult) {
                result.cleanedCount = cleanupResult.removedCount || 0
            }

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

            const parsed = parseMemorySummaryResponse(response)
            if (parsed.length === 0) {
                return memories
            }

            const summarizedContents = parsed.filter(
                (line, index) => parsed.findIndex(other => other === line) === index
            )

            // 保底保护：只有"逐条完全相同"才视为无变化，原样保留；
            // 原实现 90% 阈值把轻度合并也整体放弃，导致整理按钮大概率 no-op
            if (summarizedContents.length === memories.length) {
                const identical = memories.every((m, index) => m.content === summarizedContents[index])
                if (identical) return memories
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
        const result = db
            .prepare(
                `
            UPDATE structured_memories
            SET confidence = MAX(confidence * ?, ?)
            WHERE is_active = 1
            AND COALESCE(last_access_at, updated_at) < ?
            AND confidence > ?
        `
            )
            .run(decayRate, minConfidence, threshold, minConfidence)

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
            cleanedCount: 0,
            graphExtracted: false
        }

        try {
            // 优先动态解析 LLM 客户端，避免依赖外部注入的空客户端导致自动提取失效
            let llmClient = this.llmClient
            if (!llmClient) {
                try {
                    llmClient = await this.resolveLLMClient({ groupId, model: config.get('memory.model') })
                } catch (clientErr) {
                    logger.debug('[MemorySummarizer] 动态解析 LLM 客户端失败，回退为无 LLM 模式:', clientErr.message)
                }
            }

            // 图谱提取需要 3 条以上消息，对话才刚起步时跳过，避免每轮空跑
            const graphReady = Array.isArray(messages) && messages.length >= 3
            if (graphReady) {
                try {
                    const { knowledgeGraphExtractor } = await import('../storage/KnowledgeGraphExtractor.js')
                    const graphUserId = String(preserveTargetId(globalThis.Bot, userId) ?? userId)
                    const graphGroupId =
                        groupId === null || groupId === undefined || groupId === ''
                            ? null
                            : String(preserveTargetId(globalThis.Bot, groupId) ?? groupId)
                    const scopeId = graphGroupId ? `group:${graphGroupId}:user:${graphUserId}` : `user:${graphUserId}`
                    await knowledgeGraphExtractor.extractFromConversation(messages, scopeId, {
                        groupId: graphGroupId
                    })
                    result.graphExtracted = true
                } catch (graphErr) {
                    logger.debug('[MemorySummarizer] 知识图谱提取失败:', graphErr.message)
                }
            }

            const { memoryExtractor } = await import('./MemoryExtractor.js')
            if (llmClient && !memoryExtractor.llmClient) {
                memoryExtractor.setLLMClient(llmClient)
            }

            const extracted = await memoryExtractor.extractFromSession(userId, messages, {
                groupId,
                useLLM: !!llmClient
            })
            result.extractedCount = extracted.length
            if (summarize && llmClient) {
                const stats = await memoryService.getStats(userId)
                if (stats.total > 20) {
                    const summaryResult = await this.summarizeUserMemories(userId, {
                        groupId,
                        useLLM: !!llmClient,
                        llmClient
                    })
                    result.summarized = true
                    Object.assign(result, { summaryResult })
                }
                const cleanResult = await this.cleanupMemories(userId, {
                    groupId,
                    minConfidence: 0.3,
                    minContentLength: 3
                })
                result.cleanedCount = cleanResult.removedCount
            }

            logger.info(
                `[MemorySummarizer] 对话结束处理完成: userId=${userId}, 提取=${result.extractedCount}, 图谱=${result.graphExtracted}, 总结=${result.summarized}, 清理=${result.cleanedCount}`
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
            const data = Object.assign({ label: '', count: 0, items: [] }, rawData)
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
