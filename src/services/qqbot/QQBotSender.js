import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'

const logger = {
    info: (...args) => chatLogger.info('QQBotSend', ...args),
    warn: (...args) => chatLogger.warn('QQBotSend', ...args),
    error: (...args) => chatLogger.error('QQBotSend', ...args),
    debug: (...args) => chatLogger.debug('QQBotSend', ...args),
}

class QQBotSender {
    constructor() {
        this.proxyUrl = null
        this.defaultAppId = null
        // 多Bot配置
        this.bots = []
        // 存储被动消息ID: { groupOpenId: { msgId, timestamp, msgSeq, appId } }
        this.passiveMessages = new Map()
        // 存储交互事件ID: { groupOpenId: { eventId, timestamp } }
        this.interactionIds = new Map()
        // IC群号 -> group_openid 映射（自动学习）
        this.groupMapping = new Map()
        // 群号 -> appId 映射（指定群使用特定Bot）
        this.groupBotMapping = new Map()
        // 等待中的IC群号（用于学习映射）
        this.pendingICGroups = new Map()
        // 按钮ID缓存超时时间（4分钟，留1分钟余量）
        this.BUTTON_TIMEOUT = 4 * 60 * 1000
    }

    init() {
        const cfg = config.get('qqBotProxy') || {}
        this.proxyUrl = cfg.proxyUrl || 'http://localhost:2173'
        this.bots = cfg.bots || []
        if (this.bots.length > 0) {
            this.defaultAppId = this.bots[0].appid
        }
        // 加载群组Bot映射配置
        const icRelayCfg = cfg.icRelay || {}
        if (icRelayCfg.groupBots) {
            for (const [groupId, appId] of Object.entries(icRelayCfg.groupBots)) {
                this.groupBotMapping.set(String(groupId), String(appId))
            }
            logger.info(`已加载 ${this.groupBotMapping.size} 个群组Bot映射`)
        }
    }
    
    // 获取群组指定的Bot appId
    getBotForGroup(icGroupId) {
        const groupId = String(icGroupId)
        return this.groupBotMapping.get(groupId) || this.defaultAppId
    }

    // 当官方Bot收到@消息时调用，存储被动消息ID供IC使用
    onOfficialBotTriggered(groupOpenId, msgId) {
        logger.info(`官方Bot收到消息: groupOpenId=${groupOpenId}, msgId=${msgId}`)
        
        // 检查是否有等待中的IC群号，用于学习映射
        let isICTrigger = false
        if (this.pendingICGroups.size > 0) {
            // 查找匹配的pending群（通过groupOpenId反查）
            for (const [icGroupId, pendingData] of this.pendingICGroups.entries()) {
                // 检查是否是这个群的触发（已有映射或首次学习）
                const existingOpenId = this.groupMapping.get(icGroupId)
                if (existingOpenId === groupOpenId || !existingOpenId) {
                    // 学习映射
                    this.groupMapping.set(icGroupId, groupOpenId)
                    logger.info(`自动学习群映射: IC群${icGroupId} -> ${groupOpenId}`)
                    
                    // 清除pending
                    clearTimeout(pendingData.timeout)
                    this.pendingICGroups.delete(icGroupId)
                    isICTrigger = true
                    break
                }
            }
        }
        
        // 只有IC触发时才更新被动消息ID，避免其他用户@刷新ID
        if (isICTrigger) {
            const existing = this.passiveMessages.get(groupOpenId)
            this.passiveMessages.set(groupOpenId, {
                msgId,
                timestamp: Date.now(),
                msgSeq: 1,  // 每次新的被动ID从1开始
                useCount: existing?.useCount || 0,  // 保留使用次数统计
            })
            logger.debug(`被动消息ID已${existing ? '更新' : '存储'}: ${groupOpenId}`)
        } else {
            logger.debug(`非IC触发，忽略被动消息ID: ${groupOpenId}`)
        }
    }
    onInteractionCreate(groupOpenId, eventId) {
        logger.info(`收到交互事件: groupOpenId=${groupOpenId}, eventId=${eventId}`)
        
        // 存储交互事件ID
        this.interactionIds.set(groupOpenId, {
            eventId,
            timestamp: Date.now(),
        })
    }

    // 获取有效的交互事件ID
    getValidInteractionId(groupOpenId) {
        const interaction = this.interactionIds.get(groupOpenId)
        if (!interaction) return null
        
        // 检查是否过期
        if (Date.now() - interaction.timestamp > this.BUTTON_TIMEOUT) {
            this.interactionIds.delete(groupOpenId)
            logger.debug(`交互事件ID已过期: ${groupOpenId}`)
            return null
        }
        
        return interaction.eventId
    }

    // IC触发官方Bot前调用，标记pending
    markPendingICGroup(icGroupId) {
        const key = String(icGroupId)
        // 15秒超时（签名可能需要较长时间）
        const timeout = setTimeout(() => {
            this.pendingICGroups.delete(key)
            logger.debug(`等待映射超时: IC群${icGroupId}`)
        }, 15000)
        this.pendingICGroups.set(key, { timeout, timestamp: Date.now() })
        logger.debug(`标记等待映射: IC群${icGroupId}`)
    }

    // 生成随机按钮ID
    generateButtonId() {
        return `btn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    // 学习群号映射：IC群号 <-> group_openid
    learnGroupMapping(icGroupId, groupOpenId) {
        if (!icGroupId || !groupOpenId) return
        this.groupMapping.set(String(icGroupId), groupOpenId)
        logger.info(`学习群映射: IC群${icGroupId} -> ${groupOpenId}`)
    }

    // 获取IC群号对应的group_openid
    getGroupOpenId(icGroupId) {
        return this.groupMapping.get(String(icGroupId))
    }

    // 获取可用的被动消息ID
    getPassiveMessage(groupOpenId) {
        const passive = this.passiveMessages.get(groupOpenId)
        if (!passive) return null
        
        // 检查是否过期（4分50秒，留10秒余量）
        const PASSIVE_TIMEOUT = 4 * 60 * 1000 + 50 * 1000
        if (Date.now() - passive.timestamp > PASSIVE_TIMEOUT) {
            this.passiveMessages.delete(groupOpenId)
            logger.debug(`被动消息ID已过期: ${groupOpenId}`)
            return null
        }
        
        return passive
    }
    
    // 标记被动消息ID使用成功（用于统计和保持）
    markPassiveUsed(groupOpenId) {
        const passive = this.passiveMessages.get(groupOpenId)
        if (passive) {
            passive.useCount = (passive.useCount || 0) + 1
            passive.msgSeq = (passive.msgSeq || 1) + 1  // 递增msg_seq用于下次发送
            passive.lastUsed = Date.now()
            logger.debug(`被动消息ID使用成功: ${groupOpenId}, 已使用${passive.useCount}次, 下次seq=${passive.msgSeq}`)
        }
    }
    
    // 获取当前的msg_seq并递增
    getAndIncrementMsgSeq(groupOpenId) {
        const passive = this.passiveMessages.get(groupOpenId)
        if (!passive) return 1
        const seq = passive.msgSeq || 1
        return seq
    }
    
    // 标记被动消息ID失效（发送失败时调用）
    invalidatePassive(groupOpenId) {
        this.passiveMessages.delete(groupOpenId)
        logger.debug(`被动消息ID已失效: ${groupOpenId}`)
    }

    // 检查是否应该使用官方Bot代发
    shouldUseOfficialBot(icGroupId) {
        const cfg = config.get('qqBotProxy.icRelay')
        // 明确检查enabled字段，确保可以禁用
        if (cfg?.enabled !== true) {
            logger.debug(`[QQBotSender] IC代发已禁用 (enabled=${cfg?.enabled})`)
            return false
        }
        if (!cfg?.officialBotQQ) {
            logger.debug(`[QQBotSender] IC代发未配置官方Bot QQ`)
            return false
        }
        // 可选：检查群组白名单
        if (cfg.groups && Object.keys(cfg.groups).length > 0) {
            const groupId = String(icGroupId)
            if (!cfg.groups[groupId]) {
                // 如果配置了群组映射但当前群不在列表中，也允许（会自动学习）
                logger.debug(`[QQBotSender] 群 ${groupId} 不在预配置列表，将自动学习映射`)
            }
        }
        return true
    }
    async relayFromIC(icGroupId, content, e) {
        const cfg = config.get('qqBotProxy.icRelay')
        if (!cfg?.enabled) {
            return { success: false, error: 'IC relay not enabled', useIC: true }
        }

        const officialBotQQ = cfg.officialBotQQ
        if (!officialBotQQ) {
            return { success: false, error: 'No official bot QQ', useIC: cfg.fallbackToIC !== false }
        }

        // 检查是否已有映射
        let groupOpenId = this.getGroupOpenId(icGroupId)
        if (!groupOpenId) {
            
            // 标记pending
            this.markPendingICGroup(icGroupId)
            if (e && e.group) {
                try {
                    const randomId = Math.random().toString(36).substring(2, 8)
                    const triggerResult = await e.group.sendMsg([
                        { type: 'at', qq: officialBotQQ },
                        { type: 'text', text: ` ${randomId}` }
                    ])
                    const maxWait = 15000
                    const pollInterval = 200
                    const startTime = Date.now()
                    
                    while (Date.now() - startTime < maxWait) {
                        groupOpenId = this.getGroupOpenId(icGroupId)
                        if (groupOpenId) {
                            logger.debug(`映射建立成功，等待了${Date.now() - startTime}ms`)
                            break
                        }
                        await new Promise(resolve => setTimeout(resolve, pollInterval))
                    }
                    
                    // 收到映射后立即撤回触发消息
                    if (triggerResult?.message_id) {
                        try {
                            await e.group.recallMsg(triggerResult.message_id)
                            logger.debug('触发消息已撤回')
                        } catch {}
                    }
                } catch (err) {
                    logger.warn(`触发官方Bot失败: ${err.message}`)
                }
            }
        }

        if (!groupOpenId) {
            logger.debug(`群 ${icGroupId} 仍无映射`)
            return { success: false, error: 'No group mapping', useIC: cfg.fallbackToIC !== false }
        }

        // 检查是否有可用的被动消息ID
        let passive = this.getPassiveMessage(groupOpenId)
        
        // 如果没有被动消息ID，IC主动@官方Bot获取
        if (!passive) {
            logger.info(`群 ${groupOpenId} 无被动ID，IC触发官方Bot...`)
            
            if (e && e.group) {
                try {
                    // 发送@官方Bot触发（随机ID让消息看起来更自然）
                    const randomId = Math.random().toString(36).substring(2, 8)
                    const triggerResult = await e.group.sendMsg([
                        { type: 'at', qq: officialBotQQ },
                        { type: 'text', text: ` ${randomId}` }
                    ])
                    
                    // 轮询等待被动ID，收到后立即撤回（最多等15秒）
                    const maxWait = 15000
                    const pollInterval = 200
                    const startTime = Date.now()
                    
                    while (Date.now() - startTime < maxWait) {
                        passive = this.getPassiveMessage(groupOpenId)
                        if (passive) {
                            logger.debug(`收到被动ID，等待了${Date.now() - startTime}ms`)
                            break
                        }
                        await new Promise(resolve => setTimeout(resolve, pollInterval))
                    }
                    
                    // 收到被动ID后立即撤回触发消息
                    if (triggerResult?.message_id) {
                        try {
                            await e.group.recallMsg(triggerResult.message_id)
                            logger.debug('触发消息已撤回')
                        } catch {}
                    }
                    
                    // 如果轮询没拿到，最后再试一次
                    if (!passive) {
                        passive = this.getPassiveMessage(groupOpenId)
                    }
                } catch (err) {
                    logger.warn(`IC触发官方Bot失败: ${err.message}`)
                }
            }
        }

        if (!passive) {
            logger.debug(`群 ${groupOpenId} 仍无被动消息ID`)
            return { success: false, error: 'No passive msg_id', useIC: cfg.fallbackToIC !== false }
        }

        logger.info(`IC代发: 群${icGroupId} -> ${groupOpenId}`)

        try {
            const result = await this.sendGroupMessage(groupOpenId, content, passive.msgId)
            
            if (result.success) {
                // 成功时保留被动ID继续复用，只更新使用统计
                this.markPassiveUsed(groupOpenId)
                return { success: true, data: result.data, useIC: false }
            } else {
                if (result.code === 304023 || result.code === 304024) {
                    this.invalidatePassive(groupOpenId)
                    logger.info(`被动消息ID已失效(${result.code})，下次将重新获取`)
                }
                logger.warn(`官方Bot发送失败: ${result.error}`)
                return { success: false, error: result.error, useIC: cfg.fallbackToIC !== false }
            }
        } catch (err) {
            logger.warn(`IC代发失败: ${err.message}`)
            return { success: false, error: err.message, useIC: cfg.fallbackToIC !== false }
        }
    }

    // 发送带按钮的群消息
    async sendGroupMessageWithButton(groupOpenId, content, msgId, buttonId) {
        const bot = await this.getBotInstance()
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox 
            ? 'https://sandbox.api.sgroup.qq.com'
            : 'https://api.sgroup.qq.com'
        
        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
            msg_type: 0,
            msg_id: msgId,
            keyboard: {
                content: {
                    rows: [{
                        buttons: [{
                            id: buttonId,
                            render_data: { label: '💬', visited_label: '💬', style: 0 },
                            action: {
                                type: 1,
                                permission: { type: 2 },
                                data: buttonId,
                                unsupport_tips: '请更新QQ'
                            }
                        }]
                    }]
                }
            }
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid,
                },
                body: JSON.stringify(body),
            })
            const result = await res.json()
            
            if (result.code) {
                logger.debug(`带按钮消息失败: ${result.message}，尝试普通消息`)
                return await this.sendGroupMessage(groupOpenId, content, msgId)
            }
            
            logger.info(`带按钮消息发送成功`)
            return { success: true, data: result }
        } catch (err) {
            return { success: false, error: err.message }
        }
    }

    // 使用事件ID发送消息
    async sendGroupMessageWithEventId(groupOpenId, content, eventId) {
        const bot = await this.getBotInstance()
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox 
            ? 'https://sandbox.api.sgroup.qq.com'
            : 'https://api.sgroup.qq.com'
        
        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
            msg_type: 0,
            event_id: eventId,
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid,
                },
                body: JSON.stringify(body),
            })
            const result = await res.json()
            
            if (result.code) {
                return { success: false, error: result.message, code: result.code }
            }
            
            logger.info(`使用事件ID发送成功`)
            return { success: true, data: result }
        } catch (err) {
            return { success: false, error: err.message }
        }
    }

    async getBotInstance(appid) {
        if (!this.proxyUrl) this.init()
        
        const targetAppId = appid || this.defaultAppId
        if (!targetAppId) {
            logger.error('未配置默认Bot')
            return null
        }

        try {
            const listRes = await fetch(`${this.proxyUrl}/bot/list`)
            const listData = await listRes.json()
            
            if (!listData.bots || listData.bots.length === 0) {
                logger.warn('没有可用的Bot实例')
                return null
            }

            // 查找匹配的Bot
            const bot = listData.bots.find(b => b.appid === targetAppId) || listData.bots[0]
            return bot
        } catch (err) {
            logger.error(`获取Bot实例失败: ${err.message}`)
            return null
        }
    }

    async getAccessToken(botId, forceRefresh = false) {
        if (!this.proxyUrl) this.init()

        try {
            const url = forceRefresh 
                ? `${this.proxyUrl}/bot/${botId}/token?refresh=1`
                : `${this.proxyUrl}/bot/${botId}/token`
            const tokenRes = await fetch(url)
            const tokenData = await tokenRes.json()
            if (tokenData.error) {
                logger.error(`获取Token错误: ${tokenData.error}`)
                return null
            }
            return tokenData.access_token
        } catch (err) {
            logger.error(`获取AccessToken失败: ${err.message}`)
            return null
        }
    }

    async sendGroupMessage(groupOpenId, content, msgId, appid, retry = true) {
        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox 
            ? 'https://sandbox.api.sgroup.qq.com'
            : 'https://api.sgroup.qq.com'
        
        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
            msg_type: 0,
        }
        if (msgId) {
            body.msg_id = msgId
            // 获取msg_seq用于去重，每次发送同一个msg_id需要不同的seq
            const msgSeq = this.getAndIncrementMsgSeq(groupOpenId)
            body.msg_seq = msgSeq
            logger.debug(`发送消息: groupOpenId=${groupOpenId}, msg_seq=${msgSeq}`)
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid,
                },
                body: JSON.stringify(body),
            })

            const result = await res.json()
            
            if (result.code) {
                // Token过期时强制刷新并重试
                if (result.code === 11244 && retry) {
                    logger.info('Token过期，强制刷新后重试...')
                    // 重新获取bot实例（可能proxy重启了）
                    const newBot = await this.getBotInstance(appid)
                    if (newBot) {
                        await this.getAccessToken(newBot.bot_id, true)
                        return await this.sendGroupMessage(groupOpenId, content, msgId, appid, false)
                    }
                }
                logger.error(`发送群消息失败: ${result.code} ${result.message}`)
                return { success: false, error: result.message, code: result.code }
            }
            
            logger.info(`群消息发送成功: ${groupOpenId}`)
            return { success: true, data: result }
        } catch (err) {
            logger.error(`发送群消息异常: ${err.message}`)
            return { success: false, error: err.message }
        }
    }

    async sendC2CMessage(userOpenId, content, msgId, appid) {
        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox 
            ? 'https://sandbox.api.sgroup.qq.com'
            : 'https://api.sgroup.qq.com'
        
        const apiPath = `/v2/users/${userOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
            msg_type: 0,
        }
        if (msgId) {
            body.msg_id = msgId
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid,
                },
                body: JSON.stringify(body),
            })

            const result = await res.json()
            
            if (result.code) {
                logger.error(`发送C2C消息失败: ${result.code} ${result.message}`)
                return { success: false, error: result.message, code: result.code }
            }
            
            logger.info(`C2C消息发送成功: ${userOpenId}`)
            return { success: true, data: result }
        } catch (err) {
            logger.error(`发送C2C消息异常: ${err.message}`)
            return { success: false, error: err.message }
        }
    }

    async sendChannelMessage(channelId, content, msgId, appid) {
        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox 
            ? 'https://sandbox.api.sgroup.qq.com'
            : 'https://api.sgroup.qq.com'
        
        const apiPath = `/channels/${channelId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
        }
        if (msgId) {
            body.msg_id = msgId
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid,
                },
                body: JSON.stringify(body),
            })

            const result = await res.json()
            
            if (result.code) {
                logger.error(`发送频道消息失败: ${result.code} ${result.message}`)
                return { success: false, error: result.message, code: result.code }
            }
            
            logger.info(`频道消息发送成功: ${channelId}`)
            return { success: true, data: result }
        } catch (err) {
            logger.error(`发送频道消息异常: ${err.message}`)
            return { success: false, error: err.message }
        }
    }

    async replyToEvent(e, content, appid) {
        // 检查是否有QQBot上下文
        if (e.qqBotContext) {
            const context = e.qqBotContext
            const bot = await this.getBotInstance(appid || e.qqBotInstance?.appid)
            if (!bot) return { success: false, error: 'No bot available' }

            switch (context.type) {
                case 'group':
                    return this.sendGroupMessage(context.groupId, content, context.messageId, bot.appid)
                case 'c2c':
                    return this.sendC2CMessage(context.userId, content, context.messageId, bot.appid)
                case 'guild':
                    return this.sendChannelMessage(context.channelId, content, context.messageId, bot.appid)
                default:
                    return { success: false, error: `Unknown context type: ${context.type}` }
            }
        }

        // 普通IC/NC事件，尝试使用群openid映射
        // 这需要有群号到openid的映射关系
        logger.warn('非QQBot事件，无法直接使用官方Bot回复')
        return { success: false, error: 'Not a QQBot event' }
    }

    getStatus() {
        return {
            proxyUrl: this.proxyUrl,
            defaultAppId: this.defaultAppId,
            enabled: config.get('qqBotProxy.enabled') || false,
        }
    }
}

export const qqBotSender = new QQBotSender()
export { QQBotSender }
