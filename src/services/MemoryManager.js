import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LocalIndex } from 'vectra'
import config from '../../config/config.js'
import { redisClient } from '../core/cache/RedisClient.js'
import { LlmService } from './LlmService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Memory Manager - Manages long-term memory using Vector Database (Vectra)
 */
export class MemoryManager {
    constructor() {
        this.initialized = false
        this.dataDir = path.join(__dirname, '../../data/memory')
        this.indices = new Map() // userId -> LocalIndex
    }

    /**
     * Initialize memory manager
     */
    async init() {
        if (this.initialized) return

        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true })
        }

        await redisClient.init()
        this.initialized = true
        logger.info('[MemoryManager] Initialized')
    }

    /**
     * Get or create vector index for a user
     * @param {string} userId 
     * @returns {Promise<LocalIndex>}
     */
    async getIndex(userId) {
        if (this.indices.has(userId)) {
            return this.indices.get(userId)
        }

        const indexDir = path.join(this.dataDir, userId)
        if (!fs.existsSync(indexDir)) {
            fs.mkdirSync(indexDir, { recursive: true })
        }

        const index = new LocalIndex(path.join(indexDir, 'index.json'))

        if (!await index.isIndexCreated()) {
            await index.createIndex()
        }

        this.indices.set(userId, index)
        return index
    }

    /**
     * Save a fact or memory for a user
     * @param {string} userId
     * @param {string} content
     * @param {Object} metadata
     */
    async saveMemory(userId, content, metadata = {}) {
        if (!config.get('memory.enabled')) return

        try {
            const client = await LlmService.getEmbeddingClient()
            const { embeddings } = await client.getEmbedding(content, {
                model: 'text-embedding-3-small',
                dimensions: 1536
            })
            const vector = embeddings[0]

            const index = await this.getIndex(userId)
            const memoryId = Date.now().toString()

            await index.insertItem({
                id: memoryId,
                vector,
                metadata: {
                    ...metadata,
                    content,
                    timestamp: Date.now()
                }
            })

            return {
                id: memoryId,
                content,
                metadata,
                timestamp: Date.now()
            }
        } catch (error) {
            logger.error(`[MemoryManager] Failed to save memory for user ${userId}`, error)
            throw error
        }
    }

    /**
     * Retrieve relevant memories for a user
     * @param {string} userId
     * @param {string} query
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async searchMemory(userId, query, limit = 5) {
        if (!config.get('memory.enabled')) return []

        try {
            const client = await LlmService.getEmbeddingClient()
            const { embeddings } = await client.getEmbedding(query, {
                model: 'text-embedding-3-small',
                dimensions: 1536
            })
            const vector = embeddings[0]

            const index = await this.getIndex(userId)
            const results = await index.queryItems(vector, limit)

            return results.map(item => ({
                id: item.item.id,
                content: item.item.metadata.content,
                metadata: item.item.metadata,
                timestamp: item.item.metadata.timestamp,
                score: item.score
            }))
        } catch (error) {
            logger.error(`[MemoryManager] Failed to search memory for user ${userId}`, error)
            return []
        }
    }

    /**
     * Get all memories for a user
     * @param {string} userId
     */
    async getAllMemories(userId) {
        // Vectra doesn't support "get all" easily without query, but we can iterate the index file if needed.
        // Or just query with a generic vector? No, that's inefficient.
        // We can list items from the index if the library exposes it.
        // Checking Vectra docs (mental model): LocalIndex stores items in memory/file.
        // We can access `index.listItems()` if available, or just return empty for now as "All Memories" view might need pagination.
        // Actually, let's try to read the index file directly for "getAll" since it's just JSON.

        const indexDir = path.join(this.dataDir, userId)
        const indexPath = path.join(indexDir, 'index.json')

        if (!fs.existsSync(indexPath)) return []

        try {
            // Vectra format: { version, metadata, items: [...] }
            const data = JSON.parse(fs.readFileSync(indexPath, 'utf-8'))
            return data.items.map(item => ({
                id: item.id,
                content: item.metadata.content,
                metadata: item.metadata,
                timestamp: item.metadata.timestamp
            })).sort((a, b) => b.timestamp - a.timestamp)
        } catch (e) {
            return []
        }
    }

    /**
     * Delete a specific memory
     * @param {string} userId
     * @param {string} memoryId
     */
    async deleteMemory(userId, memoryId) {
        try {
            const index = await this.getIndex(userId)
            await index.deleteItem(memoryId)
            return true
        } catch (e) {
            logger.error(`[MemoryManager] Failed to delete memory ${memoryId}`, e)
            return false
        }
    }

    /**
     * Get all memories for a user (alias for getAllMemories)
     * @param {string} userId
     */
    async getMemories(userId) {
        return this.getAllMemories(userId)
    }

    /**
     * Clear all memories for a user
     * @param {string} userId
     */
    async clearMemory(userId) {
        try {
            const indexDir = path.join(this.dataDir, userId)
            
            if (fs.existsSync(indexDir)) {
                // 删除整个用户记忆目录
                fs.rmSync(indexDir, { recursive: true, force: true })
                // 从缓存中移除
                this.indices.delete(userId)
                logger.info(`[MemoryManager] Cleared all memories for user ${userId}`)
            }
            
            return true
        } catch (e) {
            logger.error(`[MemoryManager] Failed to clear memory for user ${userId}`, e)
            return false
        }
    }

    /**
     * Get memory statistics for a user
     * @param {string} userId
     */
    async getStats(userId) {
        const memories = await this.getAllMemories(userId)
        return {
            count: memories.length,
            oldest: memories.length > 0 ? memories[memories.length - 1]?.timestamp : null,
            newest: memories.length > 0 ? memories[0]?.timestamp : null
        }
    }

    /**
     * List all users with memories
     * @returns {Promise<string[]>}
     */
    async listUsers() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                return []
            }
            const dirs = fs.readdirSync(this.dataDir, { withFileTypes: true })
            return dirs
                .filter(d => d.isDirectory())
                .map(d => d.name)
        } catch (e) {
            logger.error('[MemoryManager] Failed to list users', e)
            return []
        }
    }

    /**
     * Add a memory (alias for saveMemory)
     * @param {string} userId
     * @param {string} content
     * @param {Object} metadata
     */
    async addMemory(userId, content, metadata = {}) {
        return this.saveMemory(userId, content, metadata)
    }
}

export const memoryManager = new MemoryManager()
