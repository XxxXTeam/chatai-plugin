import Redis from 'ioredis'
import config from '../../../config/config.js'
import { chatLogger as logger } from '../utils/logger.js'

/** 重连尝试上限，超过后停止重连并降级为内存模式 */
const MAX_RETRY_ATTEMPTS = 10
/** error 日志抑制窗口(ms) */
const ERROR_LOG_THROTTLE_MS = 60 * 1000

class RedisClient {
    constructor() {
        this.client = null
        this.isConnected = false
        /** Redis 不可用时降级为内存模式 */
        this.degraded = false
        this._lastErrorLogAt = 0
        this._suppressedErrorCount = 0
    }

    async init() {
        if (this.client) {
            if (this.client.status === 'ready') {
                this.isConnected = true
                this.degraded = false
            }
            return
        }

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
                // 超过上限返回 null 停止重连并降级，否则 Redis 不可用时会永久重连并刷屏
                if (times > MAX_RETRY_ATTEMPTS) {
                    this.degraded = true
                    this.isConnected = false
                    logger.warn(`[Redis] 重连 ${times} 次仍失败，停止重连并降级为内存模式`)
                    return null
                }
                return Math.min(times * 50, 2000)
            }
        })

        // isConnected 挂在 ready 而非 connect：
        // connect 只代表 TCP 已建立，此后 AUTH / SELECT 完成前的读写仍会失败
        this.client.on('ready', () => {
            this.isConnected = true
            this.degraded = false
            this._suppressedErrorCount = 0
            logger.info('[Redis] Connected to Redis')
        })

        this.client.on('error', err => {
            this._logErrorThrottled(err)
        })

        this.client.on('close', () => {
            if (this.isConnected) {
                logger.warn('[Redis] Connection closed')
            }
            this.isConnected = false
        })

        this.client.on('end', () => {
            this.isConnected = false
            logger.warn('[Redis] 连接已终止，后续缓存操作降级为内存模式')
        })
    }

    /**
     * 等待连接就绪（供启动阶段使用）。
     * init() 只负责创建客户端，连接是异步建立的；启动时需要等 ready，
     * 否则首个面板请求会读到空数据（统计显示 0）。
     * @param {number} timeoutMs - 最长等待时间
     * @returns {Promise<boolean>} 是否已就绪
     */
    async waitForReady(timeoutMs = 3000) {
        if (!this.client) return false
        if (this.client.status === 'ready') {
            this.isConnected = true
            return true
        }

        const client = this.client
        return await new Promise(resolve => {
            let settled = false
            const finish = ready => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                client.removeListener('ready', onReady)
                client.removeListener('end', onEnd)
                resolve(ready)
            }
            const onReady = () => finish(true)
            const onEnd = () => finish(false)
            const timer = setTimeout(() => finish(client.status === 'ready'), timeoutMs)
            client.once('ready', onReady)
            client.once('end', onEnd)
        })
    }

    /**
     * 抑制高频 error 日志：窗口内只输出一条，并在下次输出时汇总被抑制的条数
     * @param {Error} err - Redis 错误
     * @returns {void}
     */
    _logErrorThrottled(err) {
        const now = Date.now()
        if (now - this._lastErrorLogAt < ERROR_LOG_THROTTLE_MS) {
            this._suppressedErrorCount++
            return
        }

        const suppressed = this._suppressedErrorCount
        this._lastErrorLogAt = now
        this._suppressedErrorCount = 0
        const extra = suppressed > 0 ? ` (另有 ${suppressed} 条同类错误被抑制)` : ''
        logger.error(`[Redis] Error: ${err?.message || err}${extra}`)
    }

    /**
     * 以 ioredis 的实时状态为准，避免热重载后旧事件回调覆盖共享实例状态。
     * @returns {boolean} Redis 是否可读写
     */
    _isReady() {
        const ready = this.client?.status === 'ready'
        this.isConnected = ready
        return ready
    }

    async get(key) {
        if (!this._isReady()) return null
        return await this.client.get(key)
    }

    async set(key, value, ttl = null) {
        if (!this._isReady()) return
        if (ttl) {
            await this.client.set(key, value, 'EX', ttl)
        } else {
            await this.client.set(key, value)
        }
    }

    async del(key) {
        if (!this._isReady()) return
        await this.client.del(key)
    }

    async keys(pattern) {
        if (!this._isReady()) return []
        return await this.client.keys(pattern)
    }

    async lpush(key, ...values) {
        if (!this._isReady()) return 0
        return await this.client.lpush(key, ...values)
    }

    async lrange(key, start, stop) {
        if (!this._isReady()) return []
        return await this.client.lrange(key, start, stop)
    }

    async ltrim(key, start, stop) {
        if (!this._isReady()) return
        return await this.client.ltrim(key, start, stop)
    }

    async hset(key, field, value) {
        if (!this._isReady()) return
        return await this.client.hset(key, field, value)
    }

    async hget(key, field) {
        if (!this._isReady()) return null
        return await this.client.hget(key, field)
    }

    async hgetall(key) {
        if (!this._isReady()) return {}
        return await this.client.hgetall(key)
    }

    async hincrby(key, field, increment) {
        if (!this._isReady()) return 0
        return await this.client.hincrby(key, field, increment)
    }

    async expire(key, seconds) {
        if (!this._isReady()) return 0
        return await this.client.expire(key, seconds)
    }

    async incr(key) {
        if (!this._isReady()) return 0
        return await this.client.incr(key)
    }

    async llen(key) {
        if (!this._isReady()) return 0
        return await this.client.llen(key)
    }

    async exists(key) {
        if (!this._isReady()) return 0
        return await this.client.exists(key)
    }

    async quit() {
        if (!this.client) return
        try {
            await this.client.quit()
        } catch (err) {
            logger.debug('[Redis] 关闭连接失败:', err?.message || err)
        } finally {
            this.client = null
            this.isConnected = false
        }
    }
}

export const redisClient = new RedisClient()
