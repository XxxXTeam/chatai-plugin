/**
 * 结构化记忆服务
 * 统一管理所有记忆操作，支持分类存储和树状结构
 */
import { chatLogger } from '../../core/utils/logger.js'
import { databaseService } from '../storage/DatabaseService.js'
import { MemoryCategory, CategoryLabels, isValidCategory, getCategoryLabel, getSubTypeLabel } from './MemoryTypes.js'

const logger = chatLogger

class MemoryService {
    constructor() {
        this.initialized = false
    }

    /**
     * 初始化服务
     */
    async init() {
        if (this.initialized) return
        databaseService.init()
        this.initialized = true
        logger.debug('[MemoryService] Initialized')
    }

    /**
     * 确保初始化
     */
    async ensureInit() {
        if (!this.initialized) {
            await this.init()
        }
    }

    // ==================== 基础 CRUD 操作 ====================

    /**
     * 保存结构化记忆
     * @param {Object} memory - 记忆对象
     * @param {string} memory.userId - 用户ID
     * @param {string} [memory.groupId] - 群ID（可选）
     * @param {string} memory.category - 分类
     * @param {string} [memory.subType] - 子类型
     * @param {string} memory.content - 内容
     * @param {number} [memory.confidence] - 可信度 0-1
     * @param {string} [memory.source] - 来源
     * @param {Object} [memory.metadata] - 元数据
     * @returns {Object} 保存的记忆
     */
    async saveMemory(memory) {
        await this.ensureInit()

        const {
            userId,
            groupId = null,
            category,
            subType = null,
            content,
            confidence = 0.8,
            source = 'auto',
            metadata = null
        } = memory

        if (!userId || !category || !content) {
            throw new Error('userId, category and content are required')
        }

        if (!isValidCategory(category)) {
            throw new Error(`Invalid category: ${category}`)
        }

        const now = Date.now()
        const db = databaseService.db

        // 检查是否存在相似记忆（避免重复）
        const existing = this.findSimilarMemory(userId, category, content, groupId)
        if (existing) {
            // 更新现有记忆
            return this.updateMemory(existing.id, {
                content,
                confidence: Math.max(existing.confidence, confidence),
                updatedAt: now
            })
        }

        const stmt = db.prepare(`
            INSERT INTO structured_memories 
            (user_id, group_id, category, sub_type, content, confidence, source, metadata, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)

        const result = stmt.run(
            userId,
            groupId,
            category,
            subType,
            content,
            confidence,
            source,
            metadata ? JSON.stringify(metadata) : null,
            now,
            now
        )

        logger.debug(`[MemoryService] 保存记忆: userId=${userId}, category=${category}, id=${result.lastInsertRowid}`)

        return {
            id: result.lastInsertRowid,
            userId,
            groupId,
            category,
            subType,
            content,
            confidence,
            source,
            metadata,
            createdAt: now,
            updatedAt: now,
            isActive: 1
        }
    }

    /**
     * 查找相似记忆
     */
    findSimilarMemory(userId, category, content, groupId = null) {
        const db = databaseService.db

        // 简单匹配：相同用户、分类和内容
        let query = `
            SELECT * FROM structured_memories 
            WHERE user_id = ? AND category = ? AND is_active = 1
        `
        const params = [userId, category]

        if (groupId) {
            query += ' AND group_id = ?'
            params.push(groupId)
        } else {
            query += ' AND group_id IS NULL'
        }

        const memories = db.prepare(query).all(...params)

        // 查找内容相似度高的记忆（简单字符串匹配）
        for (const mem of memories) {
            if (this.isSimilarContent(mem.content, content)) {
                return this.mapRow(mem)
            }
        }

        return null
    }

    /**
     * 判断内容是否相似
     */
    isSimilarContent(content1, content2) {
        if (!content1 || !content2) return false

        // 标准化内容
        const normalize = s =>
            s
                .toLowerCase()
                .replace(/\s+/g, '')
                .replace(/[，。！？、：；""''（）【】]/g, '')
        const n1 = normalize(content1)
        const n2 = normalize(content2)

        // 完全相同
        if (n1 === n2) return true

        // 一个包含另一个
        if (n1.includes(n2) || n2.includes(n1)) return true

        // 简单相似度计算（Jaccard）
        const set1 = new Set(n1.split(''))
        const set2 = new Set(n2.split(''))
        const intersection = new Set([...set1].filter(x => set2.has(x)))
        const union = new Set([...set1, ...set2])
        const similarity = intersection.size / union.size

        return similarity > 0.8
    }

    /**
     * 更新记忆
     */
    async updateMemory(id, updates) {
        await this.ensureInit()
        const db = databaseService.db

        const allowedFields = ['content', 'category', 'sub_type', 'confidence', 'metadata', 'is_active', 'updated_at']
        const setClauses = []
        const params = []

        for (const [key, value] of Object.entries(updates)) {
            const dbKey = this.camelToSnake(key)
            if (allowedFields.includes(dbKey)) {
                setClauses.push(`${dbKey} = ?`)
                params.push(dbKey === 'metadata' && value ? JSON.stringify(value) : value)
            }
        }

        if (setClauses.length === 0) return null

        // 总是更新 updated_at
        if (!updates.updatedAt) {
            setClauses.push('updated_at = ?')
            params.push(Date.now())
        }

        params.push(id)

        const stmt = db.prepare(`
            UPDATE structured_memories 
            SET ${setClauses.join(', ')}
            WHERE id = ?
        `)

        stmt.run(...params)

        return this.getMemoryById(id)
    }

    /**
     * 获取单条记忆
     */
    async getMemoryById(id) {
        await this.ensureInit()
        const db = databaseService.db

        const row = db.prepare('SELECT * FROM structured_memories WHERE id = ?').get(id)
        return row ? this.mapRow(row) : null
    }

    /**
     * 删除记忆（软删除）
     */
    async deleteMemory(id, hard = false) {
        await this.ensureInit()
        const db = databaseService.db

        if (hard) {
            db.prepare('DELETE FROM structured_memories WHERE id = ?').run(id)
        } else {
            db.prepare('UPDATE structured_memories SET is_active = 0, updated_at = ? WHERE id = ?').run(Date.now(), id)
        }

        return true
    }

    // ==================== 查询方法 ====================

    /**
     * 获取用户所有记忆
     * @param {string} userId
     * @param {Object} options
     */
    async getMemoriesByUser(userId, options = {}) {
        await this.ensureInit()
        const db = databaseService.db

        const { category, groupId, includeInactive = false, limit = 100 } = options

        let query = 'SELECT * FROM structured_memories WHERE user_id = ?'
        const params = [userId]

        if (!includeInactive) {
            query += ' AND is_active = 1'
        }

        if (category) {
            query += ' AND category = ?'
            params.push(category)
        }

        if (groupId !== undefined) {
            if (groupId === null) {
                query += ' AND group_id IS NULL'
            } else {
                query += ' AND group_id = ?'
                params.push(groupId)
            }
        }

        query += ' ORDER BY updated_at DESC LIMIT ?'
        params.push(limit)

        const rows = db.prepare(query).all(...params)
        return rows.map(row => this.mapRow(row))
    }

    /**
     * 获取群组记忆
     */
    async getMemoriesByGroup(groupId, options = {}) {
        await this.ensureInit()
        const db = databaseService.db

        const { category, userId, includeInactive = false, limit = 100 } = options

        let query = 'SELECT * FROM structured_memories WHERE group_id = ?'
        const params = [groupId]

        if (!includeInactive) {
            query += ' AND is_active = 1'
        }

        if (category) {
            query += ' AND category = ?'
            params.push(category)
        }

        if (userId) {
            query += ' AND user_id = ?'
            params.push(userId)
        }

        query += ' ORDER BY updated_at DESC LIMIT ?'
        params.push(limit)

        const rows = db.prepare(query).all(...params)
        return rows.map(row => this.mapRow(row))
    }

    /**
     * 获取用户记忆的树状结构
     * @param {string} userId
     * @param {Object} options
     * @returns {Object} 按分类组织的记忆树
     */
    async getMemoryTree(userId, options = {}) {
        await this.ensureInit()

        const { groupId, includeInactive = false } = options
        const memories = await this.getMemoriesByUser(userId, { groupId, includeInactive, limit: 500 })

        // 按分类组织
        const tree = {}

        for (const category of Object.values(MemoryCategory)) {
            tree[category] = {
                label: getCategoryLabel(category),
                items: [],
                count: 0
            }
        }

        for (const memory of memories) {
            if (tree[memory.category]) {
                tree[memory.category].items.push({
                    ...memory,
                    subTypeLabel: memory.subType ? getSubTypeLabel(memory.subType) : null
                })
                tree[memory.category].count++
            }
        }

        return tree
    }

    /**
     * 搜索记忆
     */
    async searchMemories(query, options = {}) {
        await this.ensureInit()
        const db = databaseService.db

        const { userId, groupId, category, limit = 20 } = options

        if (!query || query.length < 2) {
            return []
        }

        // 转义特殊字符
        const safeQuery = query.substring(0, 100).replace(/[%_]/g, '\\$&')

        let sql = "SELECT * FROM structured_memories WHERE is_active = 1 AND content LIKE ? ESCAPE '\\'"
        const params = [`%${safeQuery}%`]

        if (userId) {
            sql += ' AND user_id = ?'
            params.push(userId)
        }

        if (groupId) {
            sql += ' AND group_id = ?'
            params.push(groupId)
        }

        if (category) {
            sql += ' AND category = ?'
            params.push(category)
        }

        sql += ' ORDER BY confidence DESC, updated_at DESC LIMIT ?'
        params.push(limit)

        const rows = db.prepare(sql).all(...params)
        return rows.map(row => this.mapRow(row))
    }

    // ==================== 统计方法 ====================

    /**
     * 获取记忆统计
     */
    async getStats(userId = null) {
        await this.ensureInit()
        const db = databaseService.db

        if (userId) {
            // 用户统计
            const total = db
                .prepare(
                    `
                SELECT COUNT(*) as count FROM structured_memories 
                WHERE user_id = ? AND is_active = 1
            `
                )
                .get(userId)

            const byCategory = db
                .prepare(
                    `
                SELECT category, COUNT(*) as count FROM structured_memories 
                WHERE user_id = ? AND is_active = 1
                GROUP BY category
            `
                )
                .all(userId)

            return {
                total: total.count,
                byCategory: byCategory.reduce((acc, row) => {
                    acc[row.category] = row.count
                    return acc
                }, {})
            }
        }

        // 全局统计
        const total = db.prepare('SELECT COUNT(*) as count FROM structured_memories WHERE is_active = 1').get()
        const users = db
            .prepare('SELECT COUNT(DISTINCT user_id) as count FROM structured_memories WHERE is_active = 1')
            .get()
        const byCategory = db
            .prepare(
                `
            SELECT category, COUNT(*) as count FROM structured_memories 
            WHERE is_active = 1
            GROUP BY category
        `
            )
            .all()

        return {
            total: total.count,
            users: users.count,
            byCategory: byCategory.reduce((acc, row) => {
                acc[row.category] = row.count
                return acc
            }, {})
        }
    }

    /**
     * 获取所有有记忆的用户列表
     */
    async listUsers() {
        await this.ensureInit()
        const db = databaseService.db

        const rows = db
            .prepare(
                `
            SELECT 
                user_id,
                COUNT(*) as count,
                MAX(updated_at) as last_update,
                GROUP_CONCAT(DISTINCT category) as categories
            FROM structured_memories 
            WHERE is_active = 1
            GROUP BY user_id
            ORDER BY last_update DESC
        `
            )
            .all()

        return rows.map(row => ({
            userId: row.user_id,
            count: row.count,
            lastUpdate: row.last_update,
            categories: row.categories ? row.categories.split(',') : []
        }))
    }

    // ==================== 批量操作 ====================

    /**
     * 批量保存记忆
     */
    async saveMemories(memories) {
        await this.ensureInit()

        const results = []
        for (const memory of memories) {
            try {
                const result = await this.saveMemory(memory)
                results.push({ success: true, memory: result })
            } catch (error) {
                results.push({ success: false, error: error.message, memory })
            }
        }

        return results
    }

    /**
     * 清空用户所有记忆
     */
    async clearUserMemories(userId, hard = false) {
        await this.ensureInit()
        const db = databaseService.db

        if (hard) {
            const result = db.prepare('DELETE FROM structured_memories WHERE user_id = ?').run(userId)
            return result.changes
        } else {
            const result = db
                .prepare(
                    `
                UPDATE structured_memories 
                SET is_active = 0, updated_at = ? 
                WHERE user_id = ? AND is_active = 1
            `
                )
                .run(Date.now(), userId)
            return result.changes
        }
    }

    /**
     * 合并重复记忆
     */
    async mergeMemories(userId) {
        await this.ensureInit()

        const memories = await this.getMemoriesByUser(userId, { limit: 1000 })
        const merged = new Map() // key: category+content_hash -> memory
        const toDelete = []

        for (const memory of memories) {
            const key = `${memory.category}:${this.hashContent(memory.content)}`

            if (merged.has(key)) {
                const existing = merged.get(key)
                // 保留可信度更高或更新的
                if (memory.confidence > existing.confidence || memory.updatedAt > existing.updatedAt) {
                    toDelete.push(existing.id)
                    merged.set(key, memory)
                } else {
                    toDelete.push(memory.id)
                }
            } else {
                merged.set(key, memory)
            }
        }

        // 删除重复的
        for (const id of toDelete) {
            await this.deleteMemory(id, true)
        }

        return {
            originalCount: memories.length,
            mergedCount: merged.size,
            deletedCount: toDelete.length
        }
    }

    // ==================== 辅助方法 ====================

    /**
     * 映射数据库行到对象
     */
    mapRow(row) {
        return {
            id: row.id,
            userId: row.user_id,
            groupId: row.group_id,
            category: row.category,
            subType: row.sub_type,
            content: row.content,
            confidence: row.confidence,
            source: row.source,
            metadata: row.metadata ? JSON.parse(row.metadata) : null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            expiresAt: row.expires_at,
            isActive: row.is_active
        }
    }

    /**
     * 驼峰转蛇形
     */
    camelToSnake(str) {
        return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
    }

    /**
     * 简单内容哈希
     */
    hashContent(content) {
        let hash = 0
        const str = content.toLowerCase().replace(/\s+/g, '')
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i)
            hash = hash & hash
        }
        return hash.toString(16)
    }

    // ==================== 上下文构建 ====================

    /**
     * 构建记忆上下文（用于传递给 AI）
     * @param {string} userId
     * @param {Object} options
     * @returns {string} 格式化的记忆上下文
     */
    async buildMemoryContext(userId, options = {}) {
        await this.ensureInit()

        const { groupId, maxItems = 15 } = options

        // 获取用户记忆
        const memories = await this.getMemoriesByUser(userId, { groupId, limit: maxItems * 2 })

        if (memories.length === 0) {
            return ''
        }

        // 按分类组织
        const byCategory = {}
        for (const memory of memories) {
            if (!byCategory[memory.category]) {
                byCategory[memory.category] = []
            }
            byCategory[memory.category].push(memory)
        }

        // 构建上下文文本
        const parts = []

        // 按优先级排序分类
        const categoryOrder = [
            MemoryCategory.PROFILE,
            MemoryCategory.PREFERENCE,
            MemoryCategory.EVENT,
            MemoryCategory.RELATION,
            MemoryCategory.TOPIC,
            MemoryCategory.CUSTOM
        ]

        for (const category of categoryOrder) {
            const items = byCategory[category]
            if (!items || items.length === 0) continue

            const label = getCategoryLabel(category)
            const contents = items
                .sort((a, b) => b.confidence - a.confidence)
                .slice(0, 5)
                .map(m => m.content)
                .join('；')

            parts.push(`${label}：${contents}`)
        }

        if (parts.length === 0) {
            return ''
        }

        return '\n【用户记忆】\n' + parts.join('\n') + '\n'
    }
}

export const memoryService = new MemoryService()
export default memoryService
