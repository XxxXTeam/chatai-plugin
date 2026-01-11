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
            retryStrategy: times => {
                const delay = Math.min(times * 50, 2000)
                return delay
            }
        })

        this.client.on('connect', () => {
            this.isConnected = true
            logger.info('[Redis] Connected to Redis')
        })

        this.client.on('error', err => {
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

    async lpush(key, ...values) {
        if (!this.isConnected) return 0
        return await this.client.lpush(key, ...values)
    }

    async lrange(key, start, stop) {
        if (!this.isConnected) return []
        return await this.client.lrange(key, start, stop)
    }

    async ltrim(key, start, stop) {
        if (!this.isConnected) return
        return await this.client.ltrim(key, start, stop)
    }

    async hset(key, field, value) {
        if (!this.isConnected) return
        return await this.client.hset(key, field, value)
    }

    async hget(key, field) {
        if (!this.isConnected) return null
        return await this.client.hget(key, field)
    }

    async hgetall(key) {
        if (!this.isConnected) return {}
        return await this.client.hgetall(key)
    }

    async hincrby(key, field, increment) {
        if (!this.isConnected) return 0
        return await this.client.hincrby(key, field, increment)
    }

    async expire(key, seconds) {
        if (!this.isConnected) return 0
        return await this.client.expire(key, seconds)
    }

    async incr(key) {
        if (!this.isConnected) return 0
        return await this.client.incr(key)
    }

    async llen(key) {
        if (!this.isConnected) return 0
        return await this.client.llen(key)
    }

    async exists(key) {
        if (!this.isConnected) return 0
        return await this.client.exists(key)
    }

    async quit() {
        if (this.client) {
            await this.client.quit()
        }
    }
}

export const redisClient = new RedisClient()
