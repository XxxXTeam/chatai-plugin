import crypto from 'node:crypto'
import { DefaultLogger } from '../types/common.js'

// Round-robin 计数器
const roundRobinCounters = new Map()

/**
 * Helper to get API key from single or multiple keys
 * @param {string | string[]} apiKey
 * @param {'random' | 'round-robin' | 'conversation-hash'} [strategy='random']
 * @param {string} [conversationId] - 用于 conversation-hash 策略
 * @returns {Promise<string>}
 */
export async function getKey(apiKey, strategy = 'random', conversationId) {
    if (typeof apiKey === 'string') {
        return apiKey
    }

    if (!Array.isArray(apiKey) || apiKey.length === 0) {
        throw new Error('No API key provided')
    }

    if (apiKey.length === 1) {
        return apiKey[0]
    }

    switch (strategy) {
        case 'round-robin': {
            // 基于 apiKey 数组的哈希作为 key
            const keyHash = crypto.createHash('md5').update(apiKey.join(',')).digest('hex')
            const current = roundRobinCounters.get(keyHash) || 0
            roundRobinCounters.set(keyHash, (current + 1) % apiKey.length)
            return apiKey[current]
        }

        case 'conversation-hash': {
            if (conversationId) {
                // 根据 conversationId 哈希选择固定的 key
                const hash = crypto.createHash('md5').update(conversationId).digest('hex')
                const index = parseInt(hash.substring(0, 8), 16) % apiKey.length
                return apiKey[index]
            }
            // fallback to random
        }

        case 'random':
        default: {
            const randomIndex = Math.floor(Math.random() * apiKey.length)
            return apiKey[randomIndex]
        }
    }
}

/**
 * Extract class name from code string
 * @param {string} code
 * @returns {string | null}
 */
export function extractClassName(code) {
    const classMatch = code.match(/class\s+(\w+)/)
    return classMatch ? classMatch[1] : null
}

/**
 * Simple async local storage implementation
 */
class AsyncLocalStorage {
    constructor() {
        this.store = new Map()
    }

    /**
     * @param {any} store
     * @param {Function} callback
     */
    async run(store, callback) {
        const id = crypto.randomUUID()
        this.store.set(id, store)
        try {
            return await callback()
        } finally {
            this.store.delete(id)
        }
    }

    getStore() {
        // Return the most recent store
        const values = Array.from(this.store.values())
        return values[values.length - 1]
    }
}

export const asyncLocalStorage = new AsyncLocalStorage()

export { DefaultLogger }
