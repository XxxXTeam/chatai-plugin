import crypto from 'node:crypto'
import { DefaultLogger } from '../types/common.js'

/**
 * Helper to get API key from single or multiple keys
 * @param {string | string[]} apiKey
 * @param {'random' | 'round-robin' | 'conversation-hash'} [strategy='random']
 * @returns {Promise<string>}
 */
export async function getKey(apiKey, strategy = 'random') {
    if (typeof apiKey === 'string') {
        return apiKey
    }

    if (!Array.isArray(apiKey) || apiKey.length === 0) {
        throw new Error('No API key provided')
    }

    if (apiKey.length === 1) {
        return apiKey[0]
    }

    // Simple random selection for now
    const randomIndex = Math.floor(Math.random() * apiKey.length)
    return apiKey[randomIndex]
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
