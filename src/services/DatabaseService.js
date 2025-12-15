import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 统一数据目录到插件的 data 文件夹
const PLUGIN_DATA_DIR = path.resolve(__dirname, '../../data')

const safeLogger = {
    info: (...args) => (global.logger ? global.logger.info(...args) : console.log(...args)),
    error: (...args) => (global.logger ? global.logger.error(...args) : console.error(...args)),
    warn: (...args) => (global.logger ? global.logger.warn(...args) : console.warn(...args)),
    debug: (...args) => (global.logger ? global.logger.debug(...args) : console.debug(...args))
}

class DatabaseService {
    constructor() {
        this.db = null
        this.initialized = false
        this.dataDir = PLUGIN_DATA_DIR
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

        this.createTables()
        this.initialized = true
        safeLogger.info(`[Database] Initialized: ${dbPath}`)
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
        `)
    }
    
    /**
     * 保存记忆
     */
    saveMemory(userId, content, options = {}) {
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
    getMemories(userId, limit = 50) {
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
            metadata: row.metadata ? JSON.parse(row.metadata) : null
        }))
    }
    
    /**
     * 搜索记忆（简单文本匹配）
     */
    searchMemories(userId, query, limit = 10) {
        const stmt = this.db.prepare(`
            SELECT * FROM memories 
            WHERE user_id = ? AND content LIKE ? 
            ORDER BY importance DESC, timestamp DESC 
            LIMIT ?
        `)
        return stmt.all(userId, `%${query}%`, limit).map(row => ({
            id: row.id,
            userId: row.user_id,
            content: row.content,
            source: row.source,
            importance: row.importance,
            timestamp: row.timestamp,
            metadata: row.metadata ? JSON.parse(row.metadata) : null
        }))
    }
    
    /**
     * 删除记忆
     */
    deleteMemory(memoryId) {
        const stmt = this.db.prepare('DELETE FROM memories WHERE id = ?')
        return stmt.run(memoryId).changes > 0
    }
    
    /**
     * 清空用户所有记忆
     */
    clearMemories(userId) {
        const stmt = this.db.prepare('DELETE FROM memories WHERE user_id = ?')
        return stmt.run(userId).changes
    }
    
    /**
     * 清空所有用户的记忆
     */
    clearAllMemories() {
        const stmt = this.db.prepare('DELETE FROM memories')
        return stmt.run().changes
    }
    
    /**
     * 按前缀获取记忆
     */
    getMemoriesByPrefix(prefix, limit = 50) {
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
            metadata: row.metadata ? JSON.parse(row.metadata) : null
        }))
    }
    
    /**
     * 获取记忆统计
     */
    getMemoryStats(userId) {
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
     * 获取所有有记忆的用户
     */
    getMemoryUsers() {
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
        // 去重：检查是否已存在相同 ID 的消息
        if (message.id) {
            const existing = this.db.prepare(`
                SELECT id FROM messages 
                WHERE conversation_id = ? AND content LIKE ?
                LIMIT 1
            `).get(conversationId, `%"id":"${message.id}"%`)
            
            if (existing) {
                // 消息已存在，跳过保存
                return
            }
        }
        
        // 内容去重：检查最近5条消息是否有相同内容（防止重复触发）
        const contentHash = this.hashContent(message.content, message.role)
        const recentDuplicate = this.db.prepare(`
            SELECT id FROM messages 
            WHERE conversation_id = ? 
            ORDER BY timestamp DESC 
            LIMIT 5
        `).all(conversationId)
        
        for (const recent of recentDuplicate) {
            const recentMsg = this.db.prepare(`SELECT content, role FROM messages WHERE id = ?`).get(recent.id)
            if (recentMsg) {
                try {
                    const parsed = JSON.parse(recentMsg.content)
                    if (this.hashContent(parsed.content, recentMsg.role) === contentHash) {
                        // 最近已有相同内容，跳过保存
                        return
                    }
                } catch (e) {
                    // 解析失败，继续
                }
            }
        }
        
        const stmt = this.db.prepare(`
            INSERT INTO messages (conversation_id, role, content, timestamp, metadata)
            VALUES (?, ?, ?, ?, ?)
        `)

        // Store the full message object to preserve id, toolCalls, etc.
        const fullMessage = {
            id: message.id,
            parentId: message.parentId,
            content: message.content,
            toolCalls: message.toolCalls
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
        const str = JSON.stringify(content) + role
        let hash = 0
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i)
            hash = ((hash << 5) - hash) + char
            hash = hash & hash
        }
        return hash.toString(16)
    }

    /**
     * Get messages for a conversation
     * @param {string} conversationId 
     * @param {number} [limit] 
     * @returns {Array}
     */
    getMessages(conversationId, limit = 100) {
        let query = `
            SELECT * FROM messages 
            WHERE conversation_id = ? 
            ORDER BY timestamp ASC
        `

        // If limit is provided, we want the *last* N messages, but still in ASC order
        // So we select DESC limit N, then subquery to order ASC
        if (limit) {
            query = `
                SELECT * FROM (
                    SELECT * FROM messages 
                    WHERE conversation_id = ? 
                    ORDER BY timestamp DESC 
                    LIMIT ?
                ) ORDER BY timestamp ASC
            `
            const stmt = this.db.prepare(query)
            const rows = stmt.all(conversationId, limit)
            return rows.map(this.mapRowToMessage)
        }

        const stmt = this.db.prepare(query)
        const rows = stmt.all(conversationId)
        return rows.map(this.mapRowToMessage)
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
        const stmt = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?')
        stmt.run(conversationId)
    }

    /**
     * Trim conversation to keep only last N messages
     * @param {string} conversationId 
     * @param {number} keepCount 
     */
    trimMessages(conversationId, keepCount) {
        const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
        const { count } = countStmt.get(conversationId)

        if (count <= keepCount) return

        const deleteStmt = this.db.prepare(`
            DELETE FROM messages 
            WHERE id NOT IN (
                SELECT id FROM messages 
                WHERE conversation_id = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            ) AND conversation_id = ?
        `)

        deleteStmt.run(conversationId, keepCount, conversationId)
    }

    /**
     * 获取所有会话列表
     * @returns {Array<{id: string, userId: string, messageCount: number, updatedAt: number, lastMessage: string}>}
     */
    getConversations() {
        const stmt = this.db.prepare(`
            SELECT 
                m.conversation_id,
                COUNT(*) as message_count,
                MAX(m.timestamp) as last_timestamp,
                (SELECT content FROM messages m2 
                 WHERE m2.conversation_id = m.conversation_id 
                 ORDER BY m2.timestamp DESC LIMIT 1) as last_content
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
     * @param {string} userIdPattern - 用户ID模式（支持前缀匹配）
     */
    listUserConversations(userIdPattern) {
        const stmt = this.db.prepare(`
            SELECT conversation_id, COUNT(*) as message_count, MAX(timestamp) as last_message
            FROM messages
            WHERE conversation_id LIKE ?
            GROUP BY conversation_id
            ORDER BY last_message DESC
        `)
        return stmt.all(`%${userIdPattern}%`).map(row => ({
            conversationId: row.conversation_id,
            messageCount: row.message_count,
            lastMessage: row.last_message
        }))
    }

    /**
     * 清理所有会话
     */
    clearAllConversations() {
        const stmt = this.db.prepare('DELETE FROM messages')
        const result = stmt.run()
        return result.changes
    }

    /**
     * 清理过期会话（超过指定天数未活动）
     * @param {number} days 
     */
    cleanupOldConversations(days = 30) {
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000)
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
            userId.replace('user:', '')  // 如果传入的是带前缀的
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
     */
    clearUserData(userId) {
        // 删除该用户的所有会话
        const stmt = this.db.prepare(`
            DELETE FROM messages 
            WHERE conversation_id LIKE ?
        `)
        stmt.run(`%${userId}%`)
    }
}

export const databaseService = new DatabaseService()
