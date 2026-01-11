import WebSocket from 'ws'
import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'

const logger = {
    info: (...args) => chatLogger.info('QQBot', ...args),
    warn: (...args) => chatLogger.warn('QQBot', ...args),
    error: (...args) => chatLogger.error('QQBot', ...args),
    debug: (...args) => chatLogger.debug('QQBot', ...args)
}

class QQBotInstance {
    constructor(botId, appid, proxyUrl) {
        this.botId = botId
        this.appid = appid
        this.proxyUrl = proxyUrl
        this.ws = null
        this.status = 'disconnected'
        this.username = ''
        this.sessionId = ''
        this.seq = 0
        this.reconnectAttempts = 0
        this.handlers = new Map()
        this.connected = false
    }

    connect() {
        const wsUrl = `${this.proxyUrl.replace('http', 'ws')}/bot/${this.botId}/ws`
        logger.info(`连接WebSocket: ${wsUrl}`)

        try {
            this.ws = new WebSocket(wsUrl)

            this.ws.on('open', () => {
                logger.info(`Bot ${this.appid} WebSocket连接成功`)
                this.status = 'connected'
                this.connected = true
                this.reconnectAttempts = 0
                this.emit('open')
            })

            this.ws.on('message', data => {
                try {
                    const payload = JSON.parse(data.toString())
                    this.handleMessage(payload)
                } catch (err) {
                    logger.error(`解析消息失败: ${err.message}`)
                }
            })

            this.ws.on('close', (code, reason) => {
                logger.warn(`Bot ${this.appid} WebSocket关闭: ${code} ${reason}`)
                this.status = 'disconnected'
                this.connected = false
                this.emit('close', { code, reason: reason?.toString() })
                this.attemptReconnect()
            })

            this.ws.on('error', err => {
                logger.error(`Bot ${this.appid} WebSocket错误: ${err.message}`)
                this.emit('error', err)
            })
        } catch (err) {
            logger.error(`创建WebSocket失败: ${err.message}`)
            this.attemptReconnect()
        }
    }

    handleMessage(payload) {
        const { op, t, d, s } = payload

        if (s) {
            this.seq = s
        }

        switch (op) {
            case 0: // Dispatch
                if (t === 'READY') {
                    this.sessionId = d?.session_id || ''
                    this.username = d?.user?.username || ''
                    logger.info(`Bot ${this.appid} 已就绪: ${this.username}`)
                }
                this.emit(t, d)
                this.emit('dispatch', payload)
                break
            case 10: // Hello
                logger.debug(`Bot ${this.appid} 收到Hello`)
                this.emit('hello', d)
                break
            case 11: // Heartbeat ACK
                this.emit('heartbeat_ack')
                break
            default:
                this.emit('raw', payload)
        }
    }

    attemptReconnect() {
        const cfg = config.get('qqBotProxy') || {}
        if (!cfg.autoReconnect) return

        const maxAttempts = cfg.maxReconnectAttempts || 10
        const interval = cfg.reconnectInterval || 5000

        if (this.reconnectAttempts >= maxAttempts) {
            logger.error(`Bot ${this.appid} 达到最大重连次数`)
            this.emit('max_reconnect')
            return
        }

        this.reconnectAttempts++
        logger.info(`Bot ${this.appid} ${interval / 1000}秒后重连 (${this.reconnectAttempts}/${maxAttempts})`)

        setTimeout(() => {
            this.connect()
        }, interval)
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data))
        } else {
            logger.warn(`Bot ${this.appid} 无法发送消息，连接未就绪`)
        }
    }

    on(event, handler) {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, [])
        }
        this.handlers.get(event).push(handler)
        return this
    }

    off(event, handler) {
        const handlers = this.handlers.get(event)
        if (handlers) {
            const index = handlers.indexOf(handler)
            if (index > -1) {
                handlers.splice(index, 1)
            }
        }
        return this
    }

    emit(event, data) {
        const handlers = this.handlers.get(event) || []
        handlers.forEach(handler => {
            try {
                handler(data, this)
            } catch (err) {
                logger.error(`事件处理错误 ${event}: ${err.message}`)
            }
        })
    }

    close() {
        if (this.ws) {
            this.reconnectAttempts = Infinity // 防止重连
            this.ws.close()
            this.ws = null
        }
        this.status = 'closed'
        this.connected = false
    }

    getStatus() {
        return {
            botId: this.botId,
            appid: this.appid,
            status: this.status,
            connected: this.connected,
            username: this.username,
            sessionId: this.sessionId,
            seq: this.seq,
            reconnectAttempts: this.reconnectAttempts
        }
    }
}

class QQBotProxyService {
    constructor() {
        this.instances = new Map()
        this.initialized = false
        this.globalHandlers = new Map()
    }

    async init() {
        if (this.initialized) return

        const cfg = config.get('qqBotProxy')
        if (!cfg?.enabled) {
            logger.info('QQ官方Bot代理未启用')
            return
        }

        logger.info('初始化QQ官方Bot代理服务...')

        const proxyUrl = cfg.proxyUrl || 'http://localhost:2173'
        const bots = cfg.bots || []

        if (bots.length === 0) {
            logger.warn('未配置任何Bot，请在config.yaml中添加qqBotProxy.bots配置')
            return
        }

        for (const botConfig of bots) {
            try {
                await this.createBot(botConfig, proxyUrl)
            } catch (err) {
                logger.error(`创建Bot ${botConfig.appid} 失败: ${err.message}`)
            }
        }

        this.initialized = true
        logger.info(`QQ官方Bot代理服务初始化完成，共${this.instances.size}个Bot`)
    }

    async createBot(botConfig, proxyUrl) {
        const { appid, secret, sandbox = false, intents = 0 } = botConfig

        if (!appid || !secret) {
            throw new Error('缺少appid或secret')
        }

        // 检查是否已存在
        if (this.instances.has(appid)) {
            logger.warn(`Bot ${appid} 已存在，跳过创建`)
            return this.instances.get(appid)
        }

        // 调用代理服务器创建Bot实例
        const createUrl = `${proxyUrl}/bot/create`
        logger.info(`创建Bot实例: ${appid}`)

        try {
            const response = await fetch(createUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ appid, secret, sandbox, intents })
            })

            const result = await response.json()

            if (!result.success && !result.bot_id) {
                throw new Error(result.error || '创建失败')
            }

            const botId = result.bot_id
            logger.info(`Bot ${appid} 创建成功，ID: ${botId}`)

            // 创建实例并连接WebSocket
            const instance = new QQBotInstance(botId, appid, proxyUrl)
            this.instances.set(appid, instance)

            // 注册全局事件处理
            this.registerGlobalHandlers(instance)

            // 连接WebSocket
            instance.connect()

            return instance
        } catch (err) {
            logger.error(`请求代理服务器失败: ${err.message}`)
            throw err
        }
    }

    registerGlobalHandlers(instance) {
        const cfg = config.get('qqBotProxy')
        const events = cfg?.events || {}

        // 注册配置中启用的事件
        for (const [eventName, enabled] of Object.entries(events)) {
            if (enabled) {
                instance.on(eventName, data => {
                    this.handleEvent(eventName, data, instance)
                })
            }
        }
    }

    handleEvent(eventName, data, instance) {
        logger.debug(`Bot ${instance.appid} 事件: ${eventName}`)

        // 触发全局处理器
        const handlers = this.globalHandlers.get(eventName) || []
        handlers.forEach(handler => {
            try {
                handler(data, instance)
            } catch (err) {
                logger.error(`全局事件处理错误 ${eventName}: ${err.message}`)
            }
        })

        // 触发通配符处理器
        const allHandlers = this.globalHandlers.get('*') || []
        allHandlers.forEach(handler => {
            try {
                handler(eventName, data, instance)
            } catch (err) {
                logger.error(`通配符事件处理错误: ${err.message}`)
            }
        })
    }

    on(event, handler) {
        if (!this.globalHandlers.has(event)) {
            this.globalHandlers.set(event, [])
        }
        this.globalHandlers.get(event).push(handler)
        return this
    }

    off(event, handler) {
        const handlers = this.globalHandlers.get(event)
        if (handlers) {
            const index = handlers.indexOf(handler)
            if (index > -1) {
                handlers.splice(index, 1)
            }
        }
        return this
    }

    getInstance(appid) {
        return this.instances.get(appid)
    }

    getAllInstances() {
        return Array.from(this.instances.values())
    }

    getStatus() {
        const statuses = []
        for (const instance of this.instances.values()) {
            statuses.push(instance.getStatus())
        }
        return {
            enabled: config.get('qqBotProxy.enabled') || false,
            initialized: this.initialized,
            botCount: this.instances.size,
            bots: statuses
        }
    }

    async deleteBot(appid) {
        const instance = this.instances.get(appid)
        if (!instance) {
            return false
        }

        instance.close()
        this.instances.delete(appid)

        // 通知代理服务器删除
        const proxyUrl = config.get('qqBotProxy.proxyUrl') || 'http://localhost:2173'
        try {
            await fetch(`${proxyUrl}/bot/${instance.botId}`, {
                method: 'DELETE'
            })
        } catch (err) {
            logger.warn(`通知代理服务器删除失败: ${err.message}`)
        }

        logger.info(`Bot ${appid} 已删除`)
        return true
    }

    async shutdown() {
        logger.info('关闭QQ官方Bot代理服务...')
        for (const instance of this.instances.values()) {
            instance.close()
        }
        this.instances.clear()
        this.initialized = false
    }
}

export const qqBotProxyService = new QQBotProxyService()
export { QQBotInstance, QQBotProxyService }
