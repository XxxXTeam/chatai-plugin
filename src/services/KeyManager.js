import config from '../../config/config.js'

/**
 * Manages API keys and rotation strategies
 */
export class KeyManager {
    constructor() {
        this.keyIndices = new Map() // adapterType -> currentIndex
    }

    /**
     * Get next API key for adapter
     * @param {string} adapterType
     * @returns {string} apiKey
     */
    getNextKey(adapterType) {
        const adapterConfig = config.get(adapterType)
        if (!adapterConfig) return null

        // Legacy support: single apiKey
        if (adapterConfig.apiKey && (!adapterConfig.apiKeys || adapterConfig.apiKeys.length === 0)) {
            return adapterConfig.apiKey
        }

        // Multi-key support
        const keys = adapterConfig.apiKeys || []

        // Filter enabled keys if they are objects, or use all if strings
        const activeKeys = keys.filter(k => {
            if (typeof k === 'string') return true
            return k.enabled !== false
        })

        if (activeKeys.length === 0) {
            // Fallback to legacy apiKey if no active keys in list
            return adapterConfig.apiKey || null
        }

        // Get strategy
        const strategy = adapterConfig.strategy || 'round-robin'

        if (strategy === 'random') {
            const randomKey = activeKeys[Math.floor(Math.random() * activeKeys.length)]
            return typeof randomKey === 'string' ? randomKey : randomKey.key
        } else {
            // Round-robin
            let index = this.keyIndices.get(adapterType) || 0
            if (index >= activeKeys.length) index = 0

            const keyObj = activeKeys[index]
            const key = typeof keyObj === 'string' ? keyObj : keyObj.key

            // Update index for next time
            this.keyIndices.set(adapterType, (index + 1) % activeKeys.length)

            return key
        }
    }
}

export const keyManager = new KeyManager()
