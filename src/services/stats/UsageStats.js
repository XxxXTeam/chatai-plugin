import { chatLogger } from '../../core/utils/logger.js'
const logger = chatLogger
/**
 * API使用统计模块
 * 记录每次API请求的详细信息
 */

import { redisClient } from '../../core/cache/RedisClient.js'
import { encode } from 'gpt-tokenizer'

const STATS_KEY = 'chaite:usage_stats'
const STATS_LIST_KEY = 'chaite:usage_list'
const MAX_RECORDS = 10000 // 最多保留记录数
const FILTER_INDEX_BATCH = 500 // 重建筛选索引时每批读取的记录数

/**
 * 使用记录结构
 * @typedef {Object} UsageRecord
 * @property {string} id - 唯一ID
 * @property {number} timestamp - 时间戳
 * @property {string} channelId - 渠道ID
 * @property {string} channelName - 渠道名称
 * @property {string} model - 使用的模型
 * @property {number} keyIndex - 使用的Key索引 (-1表示单key)
 * @property {string} keyName - Key名称
 * @property {string} strategy - 轮询策略
 * @property {number} inputTokens - 输入token数
 * @property {number} outputTokens - 输出token数
 * @property {number} totalTokens - 总token数
 * @property {number} duration - 耗时(ms)
 * @property {boolean} success - 是否成功
 * @property {string} [error] - 错误信息
 * @property {number} retryCount - 重试次数
 * @property {boolean} channelSwitched - 是否切换了渠道
 * @property {boolean} fallbackUsed - 是否使用了备选模型
 * @property {string} [previousChannelId] - 切换前的渠道ID
 * @property {string[]} [switchChain] - 渠道切换链 (1 > 2 > 3)
 * @property {string} source - 请求来源 (chat/test/api)
 * @property {string} [userId] - 用户ID
 * @property {string} [groupId] - 群组ID
 * @property {boolean} stream - 是否流式请求
 * @property {Object} [request] - 请求信息（消息摘要）
 * @property {Object} [response] - 响应信息（仅失败时记录）
 */

class UsageStats {
    constructor() {
        this.initialized = false
        // 内存缓存最近的统计
        this.recentStats = []
        this.maxMemoryRecords = 100
        // 筛选用轻量索引：与 Redis 列表下标一一对应（0 = 最新），只保存筛选字段
        this._filterIndex = null
        this._filterIndexBuilding = null
        this._filterIndexWrites = 0
        this._filterIndexBuiltAt = 0
        // 索引最长存活时间：兜底外部直接改写 Redis（LSET/LREM 等）造成的字段过期
        this.filterIndexMaxAgeMs = 10 * 60 * 1000
        this.filterIndexWarmEnabled = true
    }

    /**
     * 提取筛选所需的轻量字段（不含 request/response 正文）
     * @param {Object|null} record
     */
    _toIndexEntry(record) {
        if (!record || typeof record !== 'object') return null
        return {
            id: record.id,
            timestamp: record.timestamp,
            channelId: record.channelId,
            model: record.model,
            success: record.success,
            source: record.source
        }
    }

    _parseRaw(raw) {
        try {
            const record = typeof raw === 'string' ? JSON.parse(raw) : raw
            return record && typeof record === 'object' ? record : null
        } catch {
            return null
        }
    }

    /**
     * 全量扫描一次 Redis 列表，重建筛选索引。并发调用共享同一次构建。
     * 构建期间若有新记录写入，本次结果只返回给调用方、不缓存，下次查询再重建。
     * @returns {Promise<{raw: string[], index: Array<Object|null>}>}
     */
    async _buildFilterIndex() {
        if (this._filterIndexBuilding) return this._filterIndexBuilding
        const writesBefore = this._filterIndexWrites
        this._filterIndex = null
        const task = (async () => {
            // 分批读取并解析，批次之间让出事件循环，避免一次性解析几十 MB 卡住机器人收发消息
            const raw = []
            const index = []
            for (let start = 0; start < MAX_RECORDS; start += FILTER_INDEX_BATCH) {
                const stop = Math.min(start + FILTER_INDEX_BATCH, MAX_RECORDS) - 1
                const chunk = await redisClient.lrange(STATS_LIST_KEY, start, stop)
                const items = Array.isArray(chunk) ? chunk : []
                for (const item of items) {
                    raw.push(item)
                    index.push(this._toIndexEntry(this._parseRaw(item)))
                }
                if (items.length < stop - start + 1) break
                await new Promise(resolve => setImmediate(resolve))
            }
            if (writesBefore === this._filterIndexWrites && redisClient.isConnected !== false) {
                this._filterIndex = index
                this._filterIndexBuiltAt = Date.now()
            }
            return { raw, index }
        })()
        this._filterIndexBuilding = task
        try {
            return await task
        } finally {
            this._filterIndexBuilding = null
        }
    }

    /**
     * 后台预热筛选索引（打开调用记录页时调用），让用户第一次切换筛选就走索引。
     */
    warmFilterIndex() {
        if (!this.filterIndexWarmEnabled || this._filterIndexBuilding) return
        if (this._filterIndex && Date.now() - this._filterIndexBuiltAt < this.filterIndexMaxAgeMs) return
        setTimeout(() => {
            this._buildFilterIndex().catch(error => {
                logger.debug('[UsageStats] 预热筛选索引失败:', error.message)
            })
        }, 0)
    }

    /**
     * 按索引下标从 Redis 取完整记录，并校验 id 与索引一致。
     * 连续下标合并为一次 LRANGE。任何不一致返回 null（索引已过期）。
     * @param {number[]} positions - 升序下标
     * @param {Array<Object|null>} index
     */
    async _fetchIndexedRecords(positions, index) {
        const wanted = positions.length > 0 && positions[0] === 0 ? positions : [0, ...positions]
        const runs = []
        for (const position of wanted) {
            const last = runs[runs.length - 1]
            if (last && position === last.end + 1) last.end = position
            else runs.push({ start: position, end: position })
        }
        const chunks = await Promise.all(runs.map(run => redisClient.lrange(STATS_LIST_KEY, run.start, run.end)))
        const byPosition = new Map()
        runs.forEach((run, runIndex) => {
            const chunk = Array.isArray(chunks[runIndex]) ? chunks[runIndex] : []
            for (let position = run.start; position <= run.end; position++) {
                byPosition.set(position, chunk[position - run.start])
            }
        })

        // 头部校验：最新一条必须与索引一致（发现其他进程写入、清空等）
        const head = this._parseRaw(byPosition.get(0))
        const expectedHead = index[0] || null
        if ((head?.id ?? null) !== (expectedHead?.id ?? null)) return null

        const records = []
        for (const position of positions) {
            const record = this._parseRaw(byPosition.get(position))
            if (!record || record.id !== index[position]?.id) return null
            records.push(record)
        }
        return records
    }

    /**
     * 带筛选的分页查询：在内存索引上筛选，只从 Redis 取当前页完整记录。
     * Redis 列表为空且内存缓存有数据时返回 null，由调用方回退到内存缓存。
     * @param {(record: Object) => boolean} matches
     * @param {number} start
     * @param {number} limit
     * @returns {Promise<{records: Object[], total: number}|null>}
     */
    async _queryFiltered(matches, start, limit) {
        const select = index => {
            const positions = []
            for (let position = 0; position < index.length; position++) {
                const entry = index[position]
                if (entry && matches(entry)) positions.push(position)
            }
            return positions
        }

        // 快路径：索引已缓存且与 Redis 长度一致
        let index = this._filterIndex
        if (index && Date.now() - this._filterIndexBuiltAt >= this.filterIndexMaxAgeMs) {
            this._filterIndex = null
            index = null
        }
        if (index) {
            // 索引只覆盖前 MAX_RECORDS 条（与原先全量读取的窗口一致），LTRIM 之前列表可能短暂多出几条
            const length = Math.min(Number(await redisClient.llen(STATS_LIST_KEY)), MAX_RECORDS)
            if (length === index.length && length > 0) {
                const positions = select(index)
                const records = await this._fetchIndexedRecords(positions.slice(start, start + limit), index)
                if (records) return { total: positions.length, records }
            }
            // 索引过期（其他进程写入、清空等），丢弃后重建
            if (this._filterIndex === index) this._filterIndex = null
        }

        // 慢路径：全量扫描一次并重建索引，本次直接用扫描到的原文
        const built = await this._buildFilterIndex()
        if (built.index.length === 0 && this.recentStats.length > 0) return null
        const positions = select(built.index)
        return {
            total: positions.length,
            records: positions.slice(start, start + limit).map(p => this._parseRaw(built.raw[p]))
        }
    }

    async init() {
        if (this.initialized) return
        this.initialized = true
        logger.info('[UsageStats] 初始化完成')
    }

    /**
     * @param {string} text - 文本内容
     * @returns {number} token数
     */
    estimateTokens(text) {
        if (!text) return 0
        try {
            const tokens = encode(text)
            return tokens.length
        } catch (e) {
            // 回退到估算方式
            const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
            const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
            const otherChars = text.length - chineseChars - (text.match(/[a-zA-Z]+/g) || []).join('').length
            return Math.ceil(chineseChars / 1.5 + englishWords * 1.3 + otherChars / 4)
        }
    }

    /**
     * 截断请求数据（保留原始JSON，限制大小）
     * @param {Object} request - 原始请求
     * @returns {Object} 截断后的请求
     */
    truncateRequest(request) {
        if (!request) return null

        try {
            const truncated = { ...request }

            // 处理 messages 数组
            if (truncated.messages && Array.isArray(truncated.messages)) {
                truncated.messages = truncated.messages.map(msg => {
                    const newMsg = { ...msg }
                    // 截断过长的 content
                    if (typeof newMsg.content === 'string' && newMsg.content.length > 500) {
                        newMsg.content = newMsg.content.substring(0, 500) + '...(截断)'
                    } else if (Array.isArray(newMsg.content)) {
                        newMsg.content = newMsg.content.map(c => {
                            if (c.type === 'text' && c.text?.length > 500) {
                                return { ...c, text: c.text.substring(0, 500) + '...(截断)' }
                            }
                            if (c.type === 'image_url' || c.type === 'image') {
                                return { type: c.type, url: '[图片数据已省略]' }
                            }
                            return c
                        })
                    }
                    return newMsg
                })
            }

            // 保留工具列表（只保留名称和简短描述）
            if (truncated.tools && Array.isArray(truncated.tools)) {
                truncated.toolsCount = truncated.tools.length
                truncated.tools = truncated.tools
                    .slice(0, 20)
                    .map(t =>
                        typeof t === 'object' ? { name: t.name, description: t.description?.substring(0, 50) } : t
                    )
                if (truncated.toolsCount > 20) {
                    truncated.tools.push({ name: `...还有 ${truncated.toolsCount - 20} 个工具` })
                }
            }

            // systemPrompt 已在调用处截断，这里不再处理

            return truncated
        } catch (e) {
            return { error: '解析请求失败', raw: String(request).substring(0, 500) }
        }
    }

    /**
     * 截断响应数据（仅用于失败记录）
     * @param {Object} response - 原始响应或错误
     * @returns {Object} 截断后的响应
     */
    truncateResponse(response) {
        if (!response) return null

        try {
            // 如果是错误对象
            if (response instanceof Error) {
                return {
                    error: response.message,
                    stack: response.stack?.substring(0, 500)
                }
            }

            // 如果是响应对象，直接返回（限制大小）
            if (typeof response === 'object') {
                const jsonStr = JSON.stringify(response)
                if (jsonStr.length > 2000) {
                    return { truncated: true, preview: jsonStr.substring(0, 2000) + '...' }
                }
                return response
            }

            // 字符串响应
            if (typeof response === 'string') {
                return response.length > 2000 ? response.substring(0, 2000) + '...' : response
            }

            return response
        } catch (e) {
            return { parseError: e.message }
        }
    }

    /**
     * 估算消息数组的tokens
     * @param {Array} messages - 消息数组
     * @returns {number}
     */
    estimateMessagesTokens(messages) {
        if (!messages || !Array.isArray(messages)) return 0
        let total = 0
        for (const msg of messages) {
            if (typeof msg === 'string') {
                total += this.estimateTokens(msg)
            } else if (msg.content) {
                if (typeof msg.content === 'string') {
                    total += this.estimateTokens(msg.content)
                } else if (Array.isArray(msg.content)) {
                    for (const c of msg.content) {
                        if (c.type === 'text' && c.text) {
                            total += this.estimateTokens(c.text)
                        }
                    }
                }
            }
            total += 4
        }
        return total
    }

    /**
     * 记录一次API使用
     * @param {Partial<UsageRecord>} record
     * @returns {Promise<string>} 记录ID
     */
    async record(record) {
        const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        const isSuccess = record.success !== false

        const fullRecord = {
            id,
            timestamp: Date.now(),
            channelId: record.channelId || 'unknown',
            channelName: record.channelName || 'Unknown',
            model: record.model || 'unknown',
            requestedModel: record.requestedModel || record.model || 'unknown',
            reportedModel: record.reportedModel || null,
            keyIndex: record.keyIndex ?? -1,
            keyName: record.keyName || '',
            strategy: record.strategy || '',
            inputTokens: record.inputTokens || 0,
            outputTokens: record.outputTokens || 0,
            totalTokens: record.totalTokens || (record.inputTokens || 0) + (record.outputTokens || 0),
            cacheReadTokens: record.cacheReadTokens || 0,
            cacheCreationTokens: record.cacheCreationTokens || 0,
            cacheWriteTokens: record.cacheWriteTokens || record.cacheCreationTokens || 0,
            cacheReadCount: record.cacheReadCount || 0,
            cacheWriteCount: record.cacheWriteCount || 0,
            reasoningTokens: record.reasoningTokens || 0,
            duration: record.duration || 0,
            success: isSuccess,
            error: record.error || null,
            retryCount: record.retryCount || 0,
            channelSwitched: record.channelSwitched || false,
            fallbackUsed: record.fallbackUsed || false,
            previousChannelId: record.previousChannelId || null,
            switchChain: record.switchChain || null,
            source: record.source || 'chat',
            userId: record.userId || null,
            groupId: record.groupId || null,
            stream: record.stream || false,
            isEstimated: record.isEstimated || false, // 标记是否为估算值
            // 记录原始请求（限制大小）
            request: record.request ? this.truncateRequest(record.request) : null,
            // 仅失败时记录响应
            response: !isSuccess && record.response ? this.truncateResponse(record.response) : null
        }

        // 记录日志
        const keyInfo = fullRecord.keyIndex >= 0 ? ` Key#${fullRecord.keyIndex + 1}(${fullRecord.keyName})` : ''
        const tokenInfo =
            fullRecord.totalTokens > 0 ? ` tokens:${fullRecord.inputTokens}/${fullRecord.outputTokens}` : ''
        const statusIcon = fullRecord.success ? '✓' : '✗'
        logger.info(
            `[UsageStats] ${statusIcon} ${fullRecord.channelName}${keyInfo} | ${fullRecord.model} | ${fullRecord.duration}ms${tokenInfo}`
        )

        // 保存到内存
        this.recentStats.unshift(fullRecord)
        if (this.recentStats.length > this.maxMemoryRecords) {
            this.recentStats.pop()
        }

        // 保存到Redis
        try {
            this._filterIndexWrites++
            const pushed = await redisClient.lpush(STATS_LIST_KEY, JSON.stringify(fullRecord))
            // 同步更新筛选索引（与 Redis 的 LPUSH + LTRIM 保持同样的顺序和长度）
            if (this._filterIndex && pushed > 0) {
                this._filterIndex.unshift(this._toIndexEntry(fullRecord))
                if (this._filterIndex.length > MAX_RECORDS) this._filterIndex.length = MAX_RECORDS
            } else {
                this._filterIndex = null
            }
            await redisClient.ltrim(STATS_LIST_KEY, 0, MAX_RECORDS - 1)

            // 更新汇总统计
            await this.updateAggregateStats(fullRecord)

            // 更新用户统计
            await this.updateUserStats(fullRecord)
        } catch (error) {
            logger.debug('[UsageStats] Redis保存失败，仅使用内存缓存:', error.message)
        }

        return id
    }

    /**
     * 更新汇总统计
     */
    async updateAggregateStats(record) {
        const today = new Date().toISOString().split('T')[0]
        const hourKey = new Date().toISOString().split(':')[0]

        const statsKey = `${STATS_KEY}:${today}`
        const hourlyKey = `${STATS_KEY}:hourly:${hourKey}`
        const channelKey = `${STATS_KEY}:channel:${record.channelId}`

        const updates = [
            ['totalCalls', 1],
            ['successCalls', record.success ? 1 : 0],
            ['failedCalls', record.success ? 0 : 1],
            ['totalInputTokens', record.inputTokens],
            ['totalOutputTokens', record.outputTokens],
            ['totalCacheReadTokens', record.cacheReadTokens || 0],
            ['totalCacheWriteTokens', record.cacheWriteTokens || record.cacheCreationTokens || 0],
            ['totalCacheReadCount', record.cacheReadCount || 0],
            ['totalCacheWriteCount', record.cacheWriteCount || 0],
            ['totalReasoningTokens', record.reasoningTokens || 0],
            ['totalDuration', record.duration]
        ]

        for (const [field, value] of updates) {
            await redisClient.hincrby(statsKey, field, value)
            await redisClient.hincrby(hourlyKey, field, value)
            await redisClient.hincrby(channelKey, field, value)
        }

        // 设置过期时间
        await redisClient.expire(statsKey, 86400 * 30) // 30天
        await redisClient.expire(hourlyKey, 86400 * 7) // 7天
        await redisClient.expire(channelKey, 86400 * 90) // 90天
    }

    /**
     * 获取最近的使用记录（筛选后取第一页）
     * @param {number} limit
     * @param {Object} filter
     */
    async getRecent(limit = 50, filter = {}) {
        const result = await this.getRecentPaged(1, limit, filter)
        return result.records
    }

    /**
     * 获取使用记录分页结果。
     * 无筛选时只读取 Redis 当前页，带筛选时读取最多 MAX_RECORDS 条后再筛选，
     * 避免来源、状态、时间筛选只作用于未筛选的前几条记录。
     * @param {number|Object} pageOrOptions - 页码，或 { page, limit, filter }
     * @param {number} limitArg - 每页数量
     * @param {Object} filterArg - 筛选条件
     * @returns {Promise<{records: UsageRecord[], pagination: Object}>}
     */
    async getRecentPaged(pageOrOptions = 1, limitArg = 100, filterArg = {}) {
        let pageValue = pageOrOptions
        let limitValue = limitArg
        let filter = filterArg

        if (pageOrOptions && typeof pageOrOptions === 'object' && !Array.isArray(pageOrOptions)) {
            const { page, limit, filter: optionFilter, ...filterOptions } = pageOrOptions
            pageValue = page
            limitValue = limit
            filter = optionFilter || filterOptions
        }

        const pageNumber = Number(pageValue)
        const limitNumber = Number(limitValue)
        const page = Number.isFinite(pageNumber) && pageNumber >= 1 ? Math.floor(pageNumber) : 1
        const limit =
            Number.isFinite(limitNumber) && limitNumber >= 1 ? Math.min(Math.floor(limitNumber), MAX_RECORDS) : 100
        const safeFilter = filter && typeof filter === 'object' ? filter : {}
        const hasValue = value => value !== undefined && value !== null && value !== ''
        const parseTime = value => {
            if (!hasValue(value) || (typeof value === 'string' && value.trim() === '')) return undefined
            const numeric = Number(value)
            return Number.isFinite(numeric) ? numeric : undefined
        }
        const startTime = parseTime(safeFilter.startTime)
        const endTime = parseTime(safeFilter.endTime)
        const hasFilters =
            ['channelId', 'model', 'success', 'source'].some(key => hasValue(safeFilter[key])) ||
            startTime !== undefined ||
            endTime !== undefined
        const parseRecords = rawRecords =>
            (Array.isArray(rawRecords) ? rawRecords : [])
                .map(raw => {
                    try {
                        return typeof raw === 'string' ? JSON.parse(raw) : raw
                    } catch {
                        return null
                    }
                })
                .filter(record => record && typeof record === 'object')
        const applyFilters = input => {
            let records = input
            if (hasValue(safeFilter.channelId)) {
                records = records.filter(record => record.channelId === safeFilter.channelId)
            }
            if (hasValue(safeFilter.model)) {
                records = records.filter(record => record.model === safeFilter.model)
            }
            if (safeFilter.success !== undefined && safeFilter.success !== null && safeFilter.success !== '') {
                records = records.filter(record => record.success === safeFilter.success)
            }
            if (hasValue(safeFilter.source)) {
                const sourceAliases = {
                    memory_group: ['memory_group', '群记忆总结', '群记忆', '时间段记忆总结'],
                    memory_user: ['memory_user', '记忆总结', '用户记忆'],
                    memory_extract: ['memory_extract', '记忆提取'],
                    群记忆: ['memory_group', '群记忆总结', '群记忆', '时间段记忆总结'],
                    群记忆总结: ['memory_group', '群记忆总结', '群记忆', '时间段记忆总结'],
                    用户记忆: ['memory_user', '记忆总结', '用户记忆'],
                    记忆总结: ['memory_user', '记忆总结', '用户记忆'],
                    记忆提取: ['memory_extract', '记忆提取']
                }
                const allowedSources = sourceAliases[safeFilter.source] || [safeFilter.source]
                records = records.filter(record => allowedSources.includes(record.source))
            }
            if (startTime !== undefined) {
                records = records.filter(record => record.timestamp >= startTime)
            }
            if (endTime !== undefined) {
                records = records.filter(record => record.timestamp <= endTime)
            }
            return records
        }

        const start = (page - 1) * limit
        let records
        let total
        try {
            if (!hasFilters) {
                this.warmFilterIndex()
                total = Number(await redisClient.llen(STATS_LIST_KEY))
                if (!Number.isFinite(total) || total < 0) throw new Error('Redis返回了无效的记录总数')
                const rawRecords =
                    total > start ? await redisClient.lrange(STATS_LIST_KEY, start, start + limit - 1) : []
                records = parseRecords(rawRecords)
                if (redisClient.isConnected === false && total > start && rawRecords.length === 0) {
                    records = applyFilters([...this.recentStats])
                    total = records.length
                    records = records.slice(start, start + limit)
                } else if (records.length < rawRecords.length) {
                    // 当前页存在坏记录时，扩大读取窗口以重新统计有效记录总数。
                    const allRawRecords = await redisClient.lrange(STATS_LIST_KEY, 0, MAX_RECORDS - 1)
                    const validRecords = parseRecords(allRawRecords)
                    total = validRecords.length
                    records = validRecords.slice(start, start + limit)
                } else if (total === 0 && this.recentStats.length > 0) {
                    records = applyFilters([...this.recentStats])
                    total = records.length
                    records = records.slice(start, start + limit)
                }
            } else {
                // 在内存轻量索引上筛选，只从 Redis 取当前页的完整记录
                const matches = entry => applyFilters([entry]).length > 0
                const result = await this._queryFiltered(matches, start, limit)
                if (result) {
                    total = result.total
                    records = result.records
                } else {
                    records = applyFilters([...this.recentStats])
                    total = records.length
                    records = records.slice(start, start + limit)
                }
            }
        } catch (error) {
            logger.debug('[UsageStats] 分页读取Redis失败，改用内存缓存:', error.message)
            records = applyFilters([...this.recentStats])
            total = records.length
            records = records.slice(start, start + limit)
        }

        const totalPages = total > 0 ? Math.ceil(total / limit) : 0
        return {
            records,
            pagination: {
                page,
                limit,
                total,
                totalPages,
                hasMore: page < totalPages
            }
        }
    }

    /**
     * 获取指定天数内的使用统计
     */
    async getStats(days = 7) {
        const safeDays = Math.max(1, Math.min(90, Number(days) || 7))
        const since = Date.now() - safeDays * 24 * 60 * 60 * 1000
        const records = await this.getRecent(MAX_RECORDS, { startTime: since })
        return {
            days: safeDays,
            since,
            ...this.calculateStats(records, `${safeDays}d`),
            modelRanking: await this.getModelRanking(20),
            channelRanking: await this.getChannelRanking(20),
            recent: records.slice(0, 100)
        }
    }

    /**
     * 获取今日统计
     */
    async getTodayStats() {
        const today = new Date().toISOString().split('T')[0]
        const statsKey = `${STATS_KEY}:${today}`

        try {
            const stats = await redisClient.hgetall(statsKey)
            if (stats && Object.keys(stats).length > 0) {
                const totalCalls = parseInt(stats.totalCalls || '0')
                const successCalls = parseInt(stats.successCalls || '0')
                const totalDuration = parseInt(stats.totalDuration || '0')
                return {
                    date: today,
                    totalCalls,
                    successCalls,
                    failedCalls: parseInt(stats.failedCalls || '0'),
                    totalInputTokens: parseInt(stats.totalInputTokens || '0'),
                    totalOutputTokens: parseInt(stats.totalOutputTokens || '0'),
                    totalCacheReadTokens: parseInt(stats.totalCacheReadTokens || '0'),
                    totalCacheWriteTokens: parseInt(stats.totalCacheWriteTokens || '0'),
                    totalCacheReadCount: parseInt(stats.totalCacheReadCount || '0'),
                    totalCacheWriteCount: parseInt(stats.totalCacheWriteCount || '0'),
                    totalReasoningTokens: parseInt(stats.totalReasoningTokens || '0'),
                    totalDuration,
                    avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
                    successRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0
                }
            }
        } catch (error) {
            logger.debug('[UsageStats] 读取每日汇总失败，改用调用记录统计:', error.message)
        }

        const startTime = Date.parse(`${today}T00:00:00.000Z`)
        const recentRecords = await this.getRecent(MAX_RECORDS, { startTime })
        const todayRecords =
            recentRecords.length > 0 ? recentRecords : this.recentStats.filter(r => r.timestamp >= startTime)
        return { date: today, ...this.calculateStats(todayRecords, today) }
    }

    /**
     * 获取渠道统计
     */
    async getChannelStats(channelId) {
        const channelKey = `${STATS_KEY}:channel:${channelId}`

        try {
            const stats = await redisClient.hgetall(channelKey)
            return {
                channelId,
                totalCalls: parseInt(stats?.totalCalls || '0'),
                successCalls: parseInt(stats?.successCalls || '0'),
                failedCalls: parseInt(stats?.failedCalls || '0'),
                totalInputTokens: parseInt(stats?.totalInputTokens || '0'),
                totalOutputTokens: parseInt(stats?.totalOutputTokens || '0'),
                totalDuration: parseInt(stats?.totalDuration || '0'),
                avgDuration:
                    stats?.totalCalls > 0
                        ? Math.round(parseInt(stats?.totalDuration || '0') / parseInt(stats?.totalCalls || '1'))
                        : 0
            }
        } catch {
            const channelRecords = this.recentStats.filter(r => r.channelId === channelId)
            return this.calculateStats(channelRecords, channelId)
        }
    }

    /**
     * 从记录计算统计
     */
    calculateStats(records, label = '') {
        const totalCalls = records.length
        const successCalls = records.filter(r => r.success).length
        const totalInputTokens = records.reduce((sum, r) => sum + (r.inputTokens || 0), 0)
        const totalOutputTokens = records.reduce((sum, r) => sum + (r.outputTokens || 0), 0)
        const totalCacheReadTokens = records.reduce((sum, r) => sum + (r.cacheReadTokens || 0), 0)
        const totalCacheWriteTokens = records.reduce(
            (sum, r) => sum + (r.cacheWriteTokens || r.cacheCreationTokens || 0),
            0
        )
        const totalCacheReadCount = records.reduce((sum, r) => sum + (r.cacheReadCount || 0), 0)
        const totalCacheWriteCount = records.reduce((sum, r) => sum + (r.cacheWriteCount || 0), 0)
        const totalReasoningTokens = records.reduce((sum, r) => sum + (r.reasoningTokens || 0), 0)
        const totalDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0)

        return {
            label,
            totalCalls,
            successCalls,
            failedCalls: totalCalls - successCalls,
            totalInputTokens,
            totalOutputTokens,
            totalCacheReadTokens,
            totalCacheWriteTokens,
            totalCacheReadCount,
            totalCacheWriteCount,
            totalReasoningTokens,
            totalDuration,
            avgDuration: totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0,
            successRate: totalCalls > 0 ? Math.round((successCalls / totalCalls) * 100) : 0
        }
    }

    /**
     * 获取模型使用排行
     */
    async getModelRanking(limit = 10) {
        const records = await this.getRecent(1000)
        const modelCounts = {}

        for (const record of records) {
            const model = record.model
            if (!modelCounts[model]) {
                modelCounts[model] = { model, calls: 0, tokens: 0, duration: 0 }
            }
            modelCounts[model].calls++
            modelCounts[model].tokens += record.totalTokens || 0
            modelCounts[model].duration += record.duration || 0
        }

        return Object.values(modelCounts)
            .sort((a, b) => b.calls - a.calls)
            .slice(0, limit)
    }

    /**
     * 获取渠道使用排行
     */
    async getChannelRanking(limit = 10) {
        const records = await this.getRecent(1000)
        const channelCounts = {}

        for (const record of records) {
            const id = record.channelId
            if (!channelCounts[id]) {
                channelCounts[id] = {
                    channelId: id,
                    channelName: record.channelName,
                    calls: 0,
                    successCalls: 0,
                    tokens: 0,
                    duration: 0
                }
            }
            channelCounts[id].calls++
            if (record.success) channelCounts[id].successCalls++
            channelCounts[id].tokens += record.totalTokens || 0
            channelCounts[id].duration += record.duration || 0
        }

        return Object.values(channelCounts)
            .sort((a, b) => b.calls - a.calls)
            .slice(0, limit)
    }

    /**
     * 获取用户统计（真实统计，非估算）
     * @param {string} userId - 用户ID
     * @returns {Promise<Object>} 用户统计数据
     */
    async getUserStats(userId) {
        if (!userId) return null

        const userKey = `${STATS_KEY}:user:${userId}`

        try {
            // 先尝试从 Redis 获取
            const stats = await redisClient.hgetall(userKey)
            if (stats && Object.keys(stats).length > 0) {
                return {
                    userId,
                    totalCalls: parseInt(stats.totalCalls || '0'),
                    successCalls: parseInt(stats.successCalls || '0'),
                    totalInputTokens: parseInt(stats.totalInputTokens || '0'),
                    totalOutputTokens: parseInt(stats.totalOutputTokens || '0'),
                    totalDuration: parseInt(stats.totalDuration || '0'),
                    lastUpdated: parseInt(stats.lastUpdated || '0')
                }
            }
        } catch {}

        // 从内存记录计算
        const userRecords = this.recentStats.filter(r => r.userId === userId)
        if (userRecords.length === 0) return null

        return {
            userId,
            totalCalls: userRecords.length,
            successCalls: userRecords.filter(r => r.success).length,
            totalInputTokens: userRecords.reduce((sum, r) => sum + (r.inputTokens || 0), 0),
            totalOutputTokens: userRecords.reduce((sum, r) => sum + (r.outputTokens || 0), 0),
            totalDuration: userRecords.reduce((sum, r) => sum + (r.duration || 0), 0),
            lastUpdated: userRecords[0]?.timestamp || 0
        }
    }

    /**
     * 更新用户统计（在 record 时调用）
     * @param {Object} record - 使用记录
     */
    async updateUserStats(record) {
        if (!record.userId) return

        const userKey = `${STATS_KEY}:user:${record.userId}`

        try {
            await redisClient.hincrby(userKey, 'totalCalls', 1)
            await redisClient.hincrby(userKey, 'successCalls', record.success ? 1 : 0)
            await redisClient.hincrby(userKey, 'totalInputTokens', record.inputTokens || 0)
            await redisClient.hincrby(userKey, 'totalOutputTokens', record.outputTokens || 0)
            await redisClient.hincrby(userKey, 'totalDuration', record.duration || 0)
            await redisClient.hset(userKey, 'lastUpdated', Date.now())
            await redisClient.expire(userKey, 86400 * 90) // 90天
        } catch (error) {
            logger.debug('[UsageStats] 更新用户统计失败:', error.message)
        }
    }

    /**
     * 清除统计数据
     */
    async clear() {
        this.recentStats = []
        this._filterIndex = null
        this._filterIndexWrites++
        let deletedCount = 0
        let listLen = 0
        try {
            // 清除所有相关的 Redis 键
            const patterns = [
                `${STATS_KEY}*`, // chaite:usage_stats*
                STATS_LIST_KEY // chaite:usage_list
            ]

            for (const pattern of patterns) {
                if (pattern.includes('*')) {
                    const keys = await redisClient.keys(pattern)
                    if (keys.length > 0) {
                        for (const key of keys) {
                            await redisClient.del(key)
                            deletedCount++
                        }
                    }
                } else {
                    const exists = await redisClient.exists(pattern)
                    if (exists) {
                        listLen = await redisClient.llen(pattern)
                        await redisClient.del(pattern)
                        deletedCount++
                    }
                }
            }

            logger.info(`[UsageStats] 统计数据已清除, 删除 ${deletedCount} 个键, ${listLen} 条记录`)
        } catch (error) {
            logger.warn('[UsageStats] 清除Redis数据失败:', error.message)
            // 尝试单独删除关键键
            try {
                const today = new Date().toISOString().split('T')[0]
                await redisClient.del(`${STATS_KEY}:${today}`)
                await redisClient.del(STATS_LIST_KEY)
            } catch (e) {
                logger.warn('[UsageStats] 备用清除也失败:', e.message)
            }
        }
    }
}

export const usageStats = new UsageStats()
export default usageStats
