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
        `)
    }

    /**
     * Save a message to the database
     * @param {string} conversationId 
     * @param {Object} message 
     */
    saveMessage(conversationId, message) {
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
     * @returns {Array<{id: string, userId: string, messageCount: number, lastActivity: number}>}
     */
    getConversations() {
        const stmt = this.db.prepare(`
            SELECT conversation_id, COUNT(*) as message_count, MAX(timestamp) as last_message
            FROM messages
            GROUP BY conversation_id
            ORDER BY last_message DESC
            LIMIT 100
        `)
        return stmt.all().map(row => ({
            id: row.conversation_id,
            userId: row.conversation_id.split(':')[0] || row.conversation_id,
            messageCount: row.message_count,
            lastActivity: row.last_message
        }))
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
     * 获取所有用户列表（从会话中提取）
     */
    getUsers() {
        // 从 conversation_id 中提取用户信息
        // conversation_id 格式通常是 userId 或 groupId_userId
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
        const userMap = new Map()
        
        for (const row of rows) {
            // 解析 userId
            const parts = row.conversation_id.split('_')
            const userId = parts.length > 1 ? parts[parts.length - 1] : parts[0]
            
            if (!userMap.has(userId)) {
                const userSettings = this.getUserSettings(userId)
                userMap.set(userId, {
                    userId,
                    nickname: null,
                    conversationCount: 0,
                    messageCount: 0,
                    firstActivity: row.first_activity,
                    lastActivity: row.last_activity,
                    blocked: userSettings.blocked || false,
                    settings: userSettings
                })
            }
            
            const user = userMap.get(userId)
            user.conversationCount++
            user.messageCount += row.message_count
            if (row.last_activity > user.lastActivity) {
                user.lastActivity = row.last_activity
            }
            if (row.first_activity < user.firstActivity) {
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
        const settings = this.getUserSettings(userId)
        return settings.blocked === true
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
