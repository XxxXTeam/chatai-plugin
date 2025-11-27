import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

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
    }

    init(dataDir = './data') {
        if (this.initialized) return

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true })
        }

        const dbPath = path.join(dataDir, 'history.db')
        this.db = new Database(dbPath)

        // Enable WAL mode for better concurrency
        this.db.pragma('journal_mode = WAL')

        this.createTables()
        this.initialized = true
        safeLogger.info('[Database] Initialized SQLite database')
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

        const content = JSON.stringify(message.content)
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
            return {
                role: row.role,
                content: JSON.parse(row.content),
                timestamp: row.timestamp,
                metadata: row.metadata ? JSON.parse(row.metadata) : undefined
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
        // Find the timestamp of the Nth most recent message
        // Delete everything older than that

        // First, check count
        const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?')
        const { count } = countStmt.get(conversationId)

        if (count <= keepCount) return

        // Delete older messages
        // We want to keep the 'keepCount' newest messages.
        // So we delete those not in the top 'keepCount' sorted by timestamp desc
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
}

export const databaseService = new DatabaseService()
