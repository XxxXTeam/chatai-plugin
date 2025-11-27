import Redis from 'ioredis'
import config from '../../../config/config.js'

class RedisClient {
    constructor() {
        this.client = null
        this.isConnected = false
    }

    async init() {
        const redisConfig = config.get('redis')
        if (!redisConfig || !redisConfig.enabled) {
            logger.info('[Redis] Redis is disabled')
            return
        }

        this.client = new Redis({
            host: redisConfig.host || '127.0.0.1',
            port: redisConfig.port || 6379,
            password: redisConfig.password || undefined,
            db: redisConfig.db || 0,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000)
                return delay
            }
        })

        this.client.on('connect', () => {
            this.isConnected = true
            logger.info('[Redis] Connected to Redis')
        })

        this.client.on('error', (err) => {
            logger.error('[Redis] Error:', err)
        })

        this.client.on('close', () => {
            this.isConnected = false
            logger.warn('[Redis] Connection closed')
        })
    }

    async get(key) {
        if (!this.isConnected) return null
        return await this.client.get(key)
    }

    async set(key, value, ttl = null) {
        if (!this.isConnected) return
        if (ttl) {
            await this.client.set(key, value, 'EX', ttl)
        } else {
            await this.client.set(key, value)
        }
    }

    async del(key) {
        if (!this.isConnected) return
        await this.client.del(key)
    }

    async keys(pattern) {
        if (!this.isConnected) return []
        return await this.client.keys(pattern)
    }

    async quit() {
        if (this.client) {
            await this.client.quit()
        }
    }
}

export const redisClient = new RedisClient()
