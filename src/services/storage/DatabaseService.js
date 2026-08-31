import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hashContent as hashContentUtil } from '../../utils/common.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 统一数据目录到插件的 data 文件夹
const PLUGIN_DATA_DIR = path.resolve(__dirname, '../../../data')

const safeLogger = {
    info: (...args) => (global.logger ? global.logger.info(...args) : console.log(...args)),
    error: (...args) => (global.logger ? global.logger.error(...args) : console.error(...args)),
    warn: (...args) => (global.logger ? global.logger.warn(...args) : console.warn(...args)),
    debug: (...args) => (global.logger ? global.logger.debug(...args) : console.debug(...args))
}

/**
 * 安全解析 JSON，解析失败时返回兜底值而不是抛出
 * 单条损坏记录不应中断整条读取链路
 * @param {string} text - 待解析文本
 * @param {any} [fallback=null] - 解析失败时的返回值
 * @returns {any} 解析结果或兜底值
 */
export function safeParse(text, fallback = null) {
    if (typeof text !== 'string' || !text) return fallback
    try {
        return JSON.parse(text)
    } catch (err) {
        safeLogger.warn(`[Database] JSON 解析失败，已使用兜底值: ${err.message}`)
        return fallback
    }
}

class DatabaseService {
    constructor() {
        this.db = null
        this.initialized = false
        this.dataDir = PLUGIN_DATA_DIR
        this._exitHookRegistered = false
    }

    /**
     * 转义 LIKE 模式中的特殊字符（配合 ESCAPE '\' 使用）
     * @param {string} value - 原始值
     * @returns {string} 转义后的值
     */
    escapeLikePattern(value) {
        return String(value ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/[%_\[\]]/g, '\\$&')
    }

    /**
     * 收紧 SQLite 主文件及现有 WAL/SHM 文件权限。
     * @param {string} dbPath - SQLite 主文件绝对路径
     * @returns {void}
     */
    secureDatabaseFiles(dbPath) {
        for (const filePath of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
            if (!fs.existsSync(filePath)) continue
            try {
                fs.chmodSync(filePath, 0o600)
            } catch (error) {
                safeLogger.warn(`[Database] 无法收紧文件权限 ${path.basename(filePath)}: ${error.message}`)
            }
        }
    }

    init(dataDir = null) {
        if (this.initialized) return

        // 始终使用插件的 data 目录
        const targetDir = dataDir || this.dataDir

        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true })
        }

        const dbPath = path.join(targetDir, 'chaite.db')
        this.db = new Database(dbPath)

        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL')
        this.secureDatabaseFiles(dbPath)
        // 写锁竞争时等待而非立即抛 SQLITE_BUSY
        this.db.pragma('busy_timeout = 5000')
        try {
            const walPath = dbPath + '-wal'
            if (fs.existsSync(walPath)) {
                const walStats = fs.statSync(walPath)
                if (walStats.size > 0) {
                    this.db.pragma('wal_checkpoint(TRUNCATE)')
                    safeLogger.debug(
                        `[Database] WAL checkpoint completed, synced ${(walStats.size / 1024).toFixed(1)}KB`
                    )
                }
            }
        } catch (err) {
            safeLogger.warn(`[Database] WAL checkpoint failed: ${err.message}`)
        }

        this.createTables()
        this.secureDatabaseFiles(dbPath)
        this.initialized = true
        this.registerExitHook()
    }

    /**
     * 注册进程退出钩子，确保数据库连接被关闭（触发 WAL 落盘）
     * @returns {void}
     */
    registerExitHook() {
        if (this._exitHookRegistered || typeof process === 'undefined') return
        this._exitHookRegistered = true
        process.once('exit', () => this.close())
    }

    /**
     * 关闭数据库连接
     * @returns {void}
     */
    close() {
        if (!this.db) return
        try {
            if (this.db.open) {
                this.db.close()
            }
        } catch (err) {
            safeLogger.warn(`[Database] 关闭数据库失败: ${err.message}`)
        } finally {
            this.db = null
            this.initialized = false
        }
    }

    createTables() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
            
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                content TEXT NOT NULL,
                source TEXT DEFAULT 'manual',
                importance INTEGER DEFAULT 5,
                timestamp INTEGER NOT NULL,
                metadata TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);
            CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp);

            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            -- 知识图谱: 实体表
            CREATE TABLE IF NOT EXISTS kg_entities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id TEXT UNIQUE NOT NULL,
                entity_type TEXT NOT NULL,
                name TEXT NOT NULL,
                scope_id TEXT NOT NULL,
                properties TEXT,
                embedding BLOB,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                version INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_kg_entity_id ON kg_entities(entity_id);
            CREATE INDEX IF NOT EXISTS idx_kg_entity_scope ON kg_entities(scope_id, entity_type);
            CREATE INDEX IF NOT EXISTS idx_kg_entity_name ON kg_entities(name);
            CREATE INDEX IF NOT EXISTS idx_kg_entity_scope_name ON kg_entities(scope_id, name);
            CREATE INDEX IF NOT EXISTS idx_kg_entity_scope_updated ON kg_entities(scope_id, updated_at DESC, id DESC);

            -- 知识图谱: 关系表
            CREATE TABLE IF NOT EXISTS kg_relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                relationship_id TEXT UNIQUE NOT NULL,
                from_entity_id TEXT NOT NULL,
                to_entity_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                properties TEXT,
                scope_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                version INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_kg_rel_from ON kg_relationships(from_entity_id);
            CREATE INDEX IF NOT EXISTS idx_kg_rel_to ON kg_relationships(to_entity_id);
            CREATE INDEX IF NOT EXISTS idx_kg_rel_scope ON kg_relationships(scope_id, relation_type);
            CREATE INDEX IF NOT EXISTS idx_kg_rel_pair ON kg_relationships(from_entity_id, to_entity_id, relation_type);

            -- 知识图谱: 实体版本历史
            CREATE TABLE IF NOT EXISTS kg_entity_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                name TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                properties TEXT,
                scope_id TEXT NOT NULL,
                changed_at INTEGER NOT NULL,
                change_type TEXT NOT NULL,
                change_reason TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_kg_entity_history ON kg_entity_history(entity_id, version DESC);

            -- 知识图谱: 关系版本历史
            CREATE TABLE IF NOT EXISTS kg_relationship_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                relationship_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                from_entity_id TEXT NOT NULL,
                to_entity_id TEXT NOT NULL,
                relation_type TEXT NOT NULL,
                properties TEXT,
                scope_id TEXT NOT NULL,
                changed_at INTEGER NOT NULL,
                change_type TEXT NOT NULL,
                change_reason TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_kg_rel_history ON kg_relationship_history(relationship_id, version DESC);

            -- 知识图谱: 作用域共享配置
            CREATE TABLE IF NOT EXISTS kg_scope_sharing (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_scope_id TEXT NOT NULL,
                target_scope_id TEXT NOT NULL,
                share_type TEXT NOT NULL,
                entity_types TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_kg_scope_share ON kg_scope_sharing(source_scope_id, target_scope_id);
            CREATE INDEX IF NOT EXISTS idx_kg_scope_share_target ON kg_scope_sharing(target_scope_id, source_scope_id);

            -- 结构化记忆表
            CREATE TABLE IF NOT EXISTS structured_memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                group_id TEXT,
                category TEXT NOT NULL,
                sub_type TEXT,
                content TEXT NOT NULL,
                confidence REAL DEFAULT 0.8,
                source TEXT DEFAULT 'auto',
                metadata TEXT,
                created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
                updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
                expires_at INTEGER,
                is_active INTEGER DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_struct_mem_user ON structured_memories(user_id);
            CREATE INDEX IF NOT EXISTS idx_struct_mem_group ON structured_memories(group_id);
            CREATE INDEX IF NOT EXISTS idx_struct_mem_category ON structured_memories(category);
            CREATE INDEX IF NOT EXISTS idx_struct_mem_user_group ON structured_memories(user_id, group_id);
            CREATE INDEX IF NOT EXISTS idx_struct_mem_active ON structured_memories(is_active);
        `)
    }

    /**
     * 保存记忆
     */
    saveMemory(userId, content, options = {}) {
        this.ensureInit()
        const stmt = this.db.prepare(`
            INSERT INTO memories (user_id, content, source, importance, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `)
        const result = stmt.run(
            userId,
            content,
            options.source || 'manual',
            options.importance || 5,
            Date.now(),
            options.metadata ? JSON.stringify(options.metadata) : null
        )
        return result.lastInsertRowid
    }

    /**
     * 获取用户的所有记忆
     */
    getMemories(userId, limit = 100) {
        this.ensureInit()
        const stmt = this.db.prepare(`
            SELECT * FROM memories 
            WHERE user_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `)
        return stmt.all(userId, limit).map(row => ({
            id: row.id,
            userId: row.user_id,
            content: row.content,
            source: row.source,
            importance: row.importance,
            timestamp: row.timestamp,
            metadata: row.metadata ? safeParse(row.metadata, null) : null
        }))
    }

    /**
     * 搜索记忆（简单文本匹配）
     */
    searchMemories(userId, query, limit = 10) {
        this.ensureInit()
        // 修复 "LIKE or GLOB pattern too complex" 错误
        // 1. 限制查询字符串长度（防止过长导致模式复杂）
        // 2. 转义特殊字符
        if (!query || typeof query !== 'string') {
            return []
        }

        // 限制查询长度为200字符
        let safeQuery = query.substring(0, 200)

        // 转义 LIKE 特殊字符: % _ [ ]
        safeQuery = safeQuery.replace(/[%_\[\]]/g, '\\$&').trim()

        // 如果查询为空，返回空数组
        if (!safeQuery) {
            return []
        }

        try {
            const stmt = this.db.prepare(`
                SELECT * FROM memories 
                WHERE user_id = ? AND content LIKE ? ESCAPE '\\'
                ORDER BY importance DESC, timestamp DESC 
                LIMIT ?
            `)
            return stmt.all(userId, `%${safeQuery}%`, limit).map(row => ({
                id: row.id,
                userId: row.user_id,
                content: row.content,
                source: row.source,
                importance: row.importance,
                timestamp: row.timestamp,
                metadata: row.metadata ? safeParse(row.metadata, null) : null
            }))
        } catch (err) {
            safeLogger.warn(`[DatabaseService] 搜索记忆失败: ${err.message}, query="${query.substring(0, 50)}..."`)
            return []
        }
    }

    /**
     * 删除记忆
     */
    deleteMemory(memoryId) {
        this.ensureInit()
        const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?')
        return stmt.run(memoryId).changes > 0
    }

    /**
     * 清空用户所有记忆
     */
    clearMemories(userId) {
        this.ensureInit()
        const stmt = this.db.prepare('DELETE FROM memories WHERE user_id = ?')
        return stmt.run(userId).changes
    }

    /**
     * 事务内覆盖式替换某个 key 的全部记忆
     * 「先 DELETE 全部再逐条 INSERT」若不在事务中，中途失败会永久丢失旧记忆
     * @param {string} userId - 记忆归属 key（用户ID或 group:xxx 形式）
     * @param {Array<{content: string, source?: string, importance?: number, metadata?: Object}>} entries - 新记忆列表
     * @returns {number} 实际写入的条数
     */
    replaceMemories(userId, entries = []) {
        this.ensureInit()

        const items = (entries || []).filter(e => e && typeof e.content === 'string' && e.content.trim())
        const deleteStmt = this.db.prepare('DELETE FROM memories WHERE user_id = ?')
        const insertStmt = this.db.prepare(`
            INSERT INTO memories (user_id, content, source, importance, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?, ?)
        `)

        const runReplace = this.db.transaction(() => {
            deleteStmt.run(userId)
            for (const item of items) {
                insertStmt.run(
                    userId,
                    item.content,
                    item.source || 'manual',
                    item.importance || 5,
                    Date.now(),
                    item.metadata ? JSON.stringify(item.metadata) : null
                )
            }
        })
        runReplace()

        return items.length
    }

    /**
     * 清空所有用户的记忆
     */
    clearAllMemories() {
        this.ensureInit()
        const stmt = this.db.prepare('DELETE FROM memories')
        return stmt.run().changes
    }

    /**
     * 按前缀获取记忆
     */
    getMemoriesByPrefix(prefix, limit = 100) {
        this.ensureInit()
        const stmt = this.db.prepare(`
            SELECT * FROM memories 
            WHERE user_id LIKE ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `)
        return stmt.all(`${prefix}%`, limit).map(row => ({
            id: row.id,
            userId: row.user_id,
            content: row.content,
            source: row.source,
            importance: row.importance,
            timestamp: row.timestamp,
            metadata: row.metadata ? safeParse(row.metadata, null) : null
        }))
    }

    /**
     * 获取记忆统计
     */
    getMemoryStats(userId) {
        this.ensureInit()
        if (userId) {
            const stmt = this.db.prepare(`
                SELECT COUNT(*) as count, MIN(timestamp) as oldest, MAX(timestamp) as newest
                FROM memories WHERE user_id = ?
            `)
            return stmt.get(userId)
        }
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count, COUNT(DISTINCT user_id) as users
            FROM memories
        `)
        return stmt.get()
    }

    /**
     * 确保数据库已初始化
     */
    ensureInit() {
        if (!this.db) {
            this.init()
        }
    }

    /**
     * 获取所有有记忆的用户
     */
    getMemoryUsers() {
        this.ensureInit()
        const stmt = this.db.prepare(`
            SELECT user_id, COUNT(*) as count, MAX(timestamp) as last_update
            FROM memories
            GROUP BY user_id
            ORDER BY last_update DESC
        `)
        return stmt.all().map(row => ({
            userId: row.user_id,
            count: row.count,
            lastUpdate: row.last_update
        }))
    }

    /**
     * Save a message to the database (with deduplication)
     * @param {string} conversationId
     * @param {Object} message
     */
    saveMessage(conversationId, message) {
        this.ensureInit()
        // 消息 ID 是历史记录的唯一业务标识，按解析后的 JSON 精确比较，避免 LIKE 通配符误匹配。
        if (message.id) {
            const rows = this.db
                .prepare(
                    `
                SELECT content FROM messages
                WHERE conversation_id = ?
                ORDER BY id DESC
            `
                )
                .all(conversationId)

            const existing = rows.some(row => {
                try {
                    return JSON.parse(row.content)?.id === message.id
                } catch {
                    return false
                }
            })
            if (existing) return
        }

        const stmt = this.db.prepare(`
            INSERT INTO messages (conversation_id, role, content, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?)
        `)

        const fullMessage = {
            id: message.id,
            parentId: message.parentId,
            content: message.content,
            toolCalls: message.toolCalls,
            // 共享群会话必须保留发送者，记忆总结才能精确区分不同群友。
            // 旧记录没有该字段时 mapRowToMessage 保持 undefined，由调用方按未知发送者处理。
            sender: message.sender
        }
        const content = JSON.stringify(fullMessage)
        const metadata = message.metadata ? JSON.stringify(message.metadata) : null
        const timestamp = message.timestamp || Date.now()

        stmt.run(conversationId, message.role, content, timestamp, metadata)
    }

    /**
     * 生成消息内容的简单哈希用于去重
     * @param {any} content
     * @param {string} role
     * @returns {string}
     */
    hashContent(content, role) {
        return hashContentUtil(content, role)
    }

    /**
     * Get messages for a conversation
     * @param {string} conversationId
     * @param {number} [limit]
     * @returns {Array}
     */
    getMessages(conversationId, limit = 100) {
        this.ensureInit()
        let query = `
            SELECT * FROM messages 
            WHERE conversation_id = ? 
            ORDER BY timestamp ASC, id ASC
        `

        // If limit is provided, we want the *last* N messages, but still in ASC order
        // So we select DESC limit N, then subquery to order ASC
        if (limit) {
            query = `
                SELECT * FROM (
                    SELECT * FROM messages 
                    WHERE conversation_id = ? 
                    ORDER BY timestamp DESC, id DESC
                    LIMIT ?
                ) ORDER BY timestamp ASC, id ASC
            `
            const stmt = this.db.prepare(query)
            const rows = stmt.all(conversationId, limit)
            return rows.map(this.mapRowToMessage).filter(Boolean)
        }

        const stmt = this.db.prepare(query)
        const rows = stmt.all(conversationId)
        return rows.map(this.mapRowToMessage).filter(Boolean)
    }

    /**
     * 获取某个用户在指定会话中的可归属消息。
     * 共享群会话按 sender.user_id 切分轮次；旧库中无 sender 的用户消息不会被猜测归属。
     * 私聊和群用户隔离会话的 ID 已包含用户身份，可兼容读取无 sender 的旧记录。
     *
     * @param {string} conversationId - 会话 ID
     * @param {string|number} userId - 目标用户 ID
     * @param {number} [limit=100] - 最多返回条数
     * @returns {Object[]} 按时间升序排列的目标用户轮次消息
     */
    getMessagesForUser(conversationId, userId, limit = 100) {
        const normalizedUserId = String(userId ?? '')
        if (!conversationId || !normalizedUserId) return []

        const sharedGroupConversation = /^group:[^:]+$/.test(conversationId)
        if (!sharedGroupConversation) {
            return this.getMessages(conversationId, limit)
        }

        const normalizedLimit = Math.max(Number(limit) || 100, 1)
        const scanLimit = Math.min(normalizedLimit * 10, 1000)
        const history = this.getMessages(conversationId, scanLimit)
        const selected = []
        let belongsToTargetUser = false

        for (const message of history) {
            if (message.role === 'user') {
                const senderId = message.sender?.user_id
                belongsToTargetUser =
                    senderId !== null && senderId !== undefined && String(senderId) === normalizedUserId
                if (belongsToTargetUser) selected.push(message)
                continue
            }

            // 会话请求按 conversationId 加锁串行执行；下一条 user 消息出现前的 assistant/tool
            // 均属于当前用户轮次。记忆 prompt 只消费 user/assistant，tool 在此保留也不会误入正文。
            if (belongsToTargetUser && (message.role === 'assistant' || message.role === 'tool')) {
                selected.push(message)
            }
        }

        return selected.slice(-normalizedLimit)
    }

    mapRowToMessage(row) {
        try {
            const parsed = JSON.parse(row.content)

            // Handle both old format (content directly) and new format (full message object)
            if (parsed.content !== undefined) {
                // New format: full message object
                return {
                    id: parsed.id,
                    parentId: parsed.parentId,
                    role: row.role,
                    content: parsed.content,
                    toolCalls: parsed.toolCalls,
                    sender: parsed.sender,
                    timestamp: row.timestamp,
                    metadata: row.metadata ? JSON.parse(row.metadata) : undefined
                }
            } else {
                // Old format: content directly
                return {
                    role: row.role,
                    content: parsed,
                    timestamp: row.timestamp,
                    metadata: row.metadata ? JSON.parse(row.metadata) : undefined
                }
            }
        } catch (e) {
            safeLogger.error('[Database] Error parsing message row:', e)
            return null
        }
    }

    /**
     * Delete a conversation
     * @param {string} conversationId
     */
    deleteConversation(conversationId) {
        this.ensureInit()
        const stmt = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?')
        stmt.run(conversationId)
    }

    /**
     * Trim conversation to keep only last N messages
     * @param {string} conversationId
     * @param {number} keepCount
     */
    trimMessages(conversationId, keepCount) {
        this.ensureInit()
        const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
        const { count } = countStmt.get(conversationId)

        if (count <= keepCount) return

        const deleteStmt = this.db.prepare(`
            DELETE FROM messages 
            WHERE id NOT IN (
                SELECT id FROM messages 
                WHERE conversation_id = ? 
                ORDER BY timestamp DESC, id DESC
                LIMIT ?
            ) AND conversation_id = ?
        `)

        deleteStmt.run(conversationId, keepCount, conversationId)
    }

    /**
     * 裁剪会话消息：保留最新 N 条，外加指定时间戳的消息
     * 仅做删除排除，不重写任何消息，因此不存在数据丢失风险
     * @param {string} conversationId - 会话ID
     * @param {number} keepCount - 保留的最新消息条数
     * @param {number[]} [keepTimestamps] - 需额外保留的消息时间戳
     * @returns {number} 实际删除的消息条数
     */
    trimMessagesKeeping(conversationId, keepCount, keepTimestamps = []) {
        this.ensureInit()

        const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
        const { count } = countStmt.get(conversationId)
        if (count <= keepCount) return 0

        const uniqueTimestamps = [...new Set((keepTimestamps || []).filter(t => Number.isFinite(t)))]
        const keepClause =
            uniqueTimestamps.length > 0 ? ` AND timestamp NOT IN (${uniqueTimestamps.map(() => '?').join(', ')})` : ''

        const deleteStmt = this.db.prepare(`
            DELETE FROM messages
            WHERE conversation_id = ?
              AND id NOT IN (
                SELECT id FROM messages
                WHERE conversation_id = ?
                ORDER BY timestamp DESC, id DESC
                LIMIT ?
              )${keepClause}
        `)

        const result = deleteStmt.run(conversationId, conversationId, keepCount, ...uniqueTimestamps)
        return result.changes || 0
    }

    /**
     * 获取所有会话列表
     * @returns {Array<{id: string, userId: string, messageCount: number, updatedAt: number, lastMessage: string}>}
     */
    getConversations() {
        this.ensureInit()
        const stmt = this.db.prepare(`
            SELECT 
                m.conversation_id,
                COUNT(*) as message_count,
                MAX(m.timestamp) as last_timestamp,
                (SELECT content FROM messages m2 
                 WHERE m2.conversation_id = m.conversation_id 
                 ORDER BY m2.timestamp DESC, m2.id DESC LIMIT 1) as last_content
            FROM messages m
            GROUP BY m.conversation_id
            ORDER BY last_timestamp DESC
            LIMIT 100
        `)
        return stmt.all().map(row => {
            // 解析最后消息内容
            let lastMessage = ''
            try {
                if (row.last_content) {
                    const content = JSON.parse(row.last_content)
                    if (Array.isArray(content)) {
                        lastMessage = content
                            .filter(c => c.type === 'text')
                            .map(c => c.text || '')
                            .join('')
                            .substring(0, 100)
                    } else if (typeof content === 'string') {
                        lastMessage = content.substring(0, 100)
                    }
                }
            } catch {
                lastMessage = String(row.last_content || '').substring(0, 100)
            }

            // 解析 userId 和 groupId
            const parts = row.conversation_id.split(':')
            let userId = row.conversation_id
            let groupId = undefined

            if (parts[0] === 'user') {
                userId = parts[1] || parts[0]
            } else if (parts[0] === 'group') {
                groupId = parts[1]
                userId = parts[3] || parts[1]
            }

            return {
                id: row.conversation_id,
                userId,
                groupId,
                messageCount: row.message_count,
                updatedAt: row.last_timestamp || Date.now(),
                lastMessage: lastMessage || '无消息内容'
            }
        })
    }

    /**
     * 获取所有会话列表（别名）
     */
    listConversations() {
        return this.getConversations()
    }

    /**
     * 获取用户的所有会话
     * 会话ID格式见 ContextManager.getConversationId：
     * `user:<uid>` / `group:<gid>` / `group:<gid>:user:<uid>` / `private:shared`
     * 原实现用双侧 LIKE `%pattern%` 模糊匹配，会让 `123` 命中 `user:1234`、`group:123`，
     * 导致记忆总结被写到错误的用户名下，故改为精确匹配 + 转义
     * @param {string} userIdPattern - 用户ID或完整会话ID
     * @returns {Array<{conversationId: string, messageCount: number, lastMessage: number}>}
     */
    listUserConversations(userIdPattern, options = {}) {
        this.ensureInit()
        const raw = String(userIdPattern ?? '')
        if (!raw) return []
        const listOptions = { groupId: undefined, ...options }
        const groupId = listOptions.groupId

        if (groupId !== null && groupId !== undefined && groupId !== '') {
            const sharedId = `group:${groupId}`
            const isolatedId = `group:${groupId}:user:${raw}`
            const rows = this.db
                .prepare(
                    `
                    SELECT conversation_id, COUNT(*) as message_count, MAX(timestamp) as last_message
                    FROM messages
                    WHERE conversation_id = ? OR conversation_id = ?
                    GROUP BY conversation_id
                    ORDER BY last_message DESC
                `
                )
                .all(sharedId, isolatedId)
            return rows.map(row => ({
                conversationId: row.conversation_id,
                messageCount: row.message_count,
                lastMessage: row.last_message,
                shared: row.conversation_id === sharedId
            }))
        }

        const escaped = this.escapeLikePattern(raw)

        const stmt = this.db.prepare(`
            SELECT conversation_id, COUNT(*) as message_count, MAX(timestamp) as last_message
            FROM messages
            WHERE conversation_id = ?
               OR conversation_id = ?
               OR conversation_id LIKE ? ESCAPE '\\'
            GROUP BY conversation_id
            ORDER BY last_message DESC
        `)
        // 依次覆盖：完整会话ID（如 group:789）、私聊会话、群聊用户隔离会话
        return stmt.all(raw, `user:${raw}`, `group:%:user:${escaped}`).map(row => ({
            conversationId: row.conversation_id,
            messageCount: row.message_count,
            lastMessage: row.last_message
        }))
    }

    /**
     * 清理所有会话
     */
    clearAllConversations() {
        this.ensureInit()
        const stmt = this.db.prepare('DELETE FROM messages')
        const result = stmt.run()
        return result.changes
    }

    /**
     * 清理过期会话（超过指定天数未活动）
     * @param {number} days
     */
    cleanupOldConversations(days = 30) {
        this.ensureInit()
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
        const stmt = this.db.prepare(`
            DELETE FROM messages 
            WHERE conversation_id IN (
                SELECT conversation_id FROM messages
                GROUP BY conversation_id
                HAVING MAX(timestamp) < ?
            )
        `)
        const result = stmt.run(cutoff)
        return result.changes
    }

    /**
     * 获取数据库统计信息
     */
    getStats() {
        this.ensureInit()
        const conversations = this.db.prepare('SELECT COUNT(DISTINCT conversation_id) as count FROM messages').get()
        const messages = this.db.prepare('SELECT COUNT(*) as count FROM messages').get()
        const oldest = this.db.prepare('SELECT MIN(timestamp) as ts FROM messages').get()
        const newest = this.db.prepare('SELECT MAX(timestamp) as ts FROM messages').get()

        return {
            conversationCount: conversations.count,
            messageCount: messages.count,
            oldestMessage: oldest.ts,
            newestMessage: newest.ts
        }
    }

    /**
     * 获取所有用户列表（从会话和用户设置中提取）
     */
    getUsers() {
        this.ensureInit()
        const userMap = new Map()

        // 1. 先从 user_settings 文件加载所有已设置的用户
        const allSettings = this._loadUserSettings()
        for (const [key, settings] of Object.entries(allSettings)) {
            // 移除 user: 前缀获取真实 userId
            const userId = key.startsWith('user:') ? key.slice(5) : key
            if (!userMap.has(userId)) {
                userMap.set(userId, {
                    userId,
                    nickname: null,
                    conversationCount: 0,
                    messageCount: 0,
                    firstActivity: null,
                    lastActivity: null,
                    blocked: settings.blocked || false,
                    settings
                })
            }
        }

        // 2. 从数据库消息中提取用户信息
        const stmt = this.db.prepare(`
            SELECT 
                conversation_id,
                COUNT(*) as message_count,
                MIN(timestamp) as first_activity,
                MAX(timestamp) as last_activity
            FROM messages
            GROUP BY conversation_id
            ORDER BY last_activity DESC
        `)

        const rows = stmt.all()

        for (const row of rows) {
            // 解析 userId
            const parts = row.conversation_id.split('_')
            const userId = parts.length > 1 ? parts[parts.length - 1] : parts[0]

            if (!userMap.has(userId)) {
                userMap.set(userId, {
                    userId,
                    nickname: null,
                    conversationCount: 0,
                    messageCount: 0,
                    firstActivity: row.first_activity,
                    lastActivity: row.last_activity,
                    blocked: this.isUserBlocked(userId),
                    settings: {}
                })
            }

            const user = userMap.get(userId)
            user.conversationCount++
            user.messageCount += row.message_count
            if (!user.lastActivity || row.last_activity > user.lastActivity) {
                user.lastActivity = row.last_activity
            }
            if (!user.firstActivity || row.first_activity < user.firstActivity) {
                user.firstActivity = row.first_activity
            }
        }

        return Array.from(userMap.values())
    }

    /**
     * 获取单个用户信息
     */
    getUser(userId) {
        const users = this.getUsers()
        return users.find(u => u.userId === userId) || null
    }

    /**
     * 获取用户设置文件路径
     */
    _getUserSettingsPath() {
        const settingsDir = path.join(this.dataDir, 'user_settings')
        if (!fs.existsSync(settingsDir)) {
            fs.mkdirSync(settingsDir, { recursive: true })
        }
        return path.join(settingsDir, 'settings.json')
    }

    /**
     * 加载所有用户设置
     */
    _loadUserSettings() {
        const settingsPath = this._getUserSettingsPath()
        try {
            if (fs.existsSync(settingsPath)) {
                return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
            }
        } catch (e) {
            safeLogger.warn('[DB] 加载用户设置失败:', e.message)
        }
        return {}
    }

    /**
     * 保存所有用户设置
     */
    _saveUserSettings(settings) {
        const settingsPath = this._getUserSettingsPath()
        try {
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
        } catch (e) {
            safeLogger.error('[DB] 保存用户设置失败:', e.message)
        }
    }

    /**
     * 更新用户设置
     */
    updateUserSettings(userId, settings) {
        const allSettings = this._loadUserSettings()
        allSettings[userId] = { ...allSettings[userId], ...settings }
        this._saveUserSettings(allSettings)
    }

    /**
     * 获取用户设置
     */
    getUserSettings(userId) {
        const allSettings = this._loadUserSettings()
        return allSettings[userId] || {}
    }

    /**
     * 检查用户是否被封禁
     */
    isUserBlocked(userId) {
        // 检查多种可能的 key 格式
        const keysToCheck = [
            userId,
            `user:${userId}`,
            userId.replace('user:', '') // 如果传入的是带前缀的
        ]

        for (const key of keysToCheck) {
            const settings = this.getUserSettings(key)
            if (settings.blocked === true) {
                return true
            }
        }
        return false
    }

    /**
     * 清除用户数据
     * 原实现用双侧 LIKE `%userId%`，`clearUserData('123')` 会连带删除
     * `user:1234`、`group:123` 等他人会话，故改为精确匹配 + 转义
     * @param {string} userId - 用户ID
     * @returns {number} 删除的消息条数
     */
    clearUserData(userId) {
        this.ensureInit()
        const raw = String(userId ?? '')
        if (!raw) return 0
        const escaped = this.escapeLikePattern(raw)

        // 仅命中该用户的私聊会话与群聊用户隔离会话
        const stmt = this.db.prepare(`
            DELETE FROM messages 
            WHERE conversation_id = ?
               OR conversation_id LIKE ? ESCAPE '\\'
        `)
        return stmt.run(`user:${raw}`, `group:%:user:${escaped}`).changes || 0
    }

    /**
     * 设置键值对
     * @param {string} key
     * @param {any} value
     */
    setKV(key, value) {
        this.ensureInit()
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO kv_store (key, value, updated_at)
            VALUES (?, ?, ?)
        `)
        stmt.run(key, JSON.stringify(value), Date.now())
    }

    /**
     * 获取键值对
     * @param {string} key
     * @param {any} defaultValue
     * @returns {any}
     */
    getKV(key, defaultValue = null) {
        this.ensureInit()
        const stmt = this.db.prepare('SELECT value FROM kv_store WHERE key = ?')
        const row = stmt.get(key)
        if (row) {
            try {
                return JSON.parse(row.value)
            } catch {
                return row.value
            }
        }
        return defaultValue
    }

    /**
     * 删除键值对
     * @param {string} key
     */
    deleteKV(key) {
        this.ensureInit()
        const stmt = this.db.prepare('DELETE FROM kv_store WHERE key = ?')
        stmt.run(key)
    }

    /**
     * 获取以prefix开头的所有键值对
     * @param {string} prefix
     * @returns {Object}
     */
    getKVByPrefix(prefix) {
        this.ensureInit()
        const stmt = this.db.prepare('SELECT key, value FROM kv_store WHERE key LIKE ?')
        const rows = stmt.all(`${prefix}%`)
        const result = {}
        for (const row of rows) {
            try {
                result[row.key] = JSON.parse(row.value)
            } catch {
                result[row.key] = row.value
            }
        }
        return result
    }
}

export const databaseService = new DatabaseService()
