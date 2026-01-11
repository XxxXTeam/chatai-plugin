import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'
import fs from 'node:fs'
import path from 'node:path'

const logger = {
    info: (...args) => chatLogger.info('QQBotSend', ...args),
    warn: (...args) => chatLogger.warn('QQBotSend', ...args),
    error: (...args) => chatLogger.error('QQBotSend', ...args),
    debug: (...args) => chatLogger.debug('QQBotSend', ...args)
}

class QQBotSender {
    constructor() {
        this.proxyUrl = null
        this.defaultAppId = null
        // 多Bot配置
        this.bots = []
        // 存储被动消息ID: { groupOpenId: { msgId, timestamp, msgSeq, appId } }
        this.passiveMessages = new Map()
        // 存储交互事件ID: { groupOpenId: [{ eventId, timestamp, userId }] }
        this.interactionIds = new Map()
        this.groupMapping = new Map()
        // group_openid -> IC群号 反向映射
        this.openidMapping = new Map()
        // 群号 -> appId 映射（指定群使用特定Bot）
        this.groupBotMapping = new Map()
        // 等待中的IC群号（用于学习映射）
        this.pendingICGroups = new Map()
        // 按钮ID缓存: { groupId: { data, id, timestamp } }
        this.buttonIds = new Map()
        // 事件ID缓存: { groupId: [{ id, openid, userId, timestamp }] }
        this.eventIds = new Map()
        // 按钮ID缓存超时时间（4分钟，留1分钟余量）
        this.BUTTON_TIMEOUT = 4 * 60 * 1000
        // 数据存储路径
        this.dataDir = null
        this.mappingFile = null
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
        // 初始化数据存储路径
        this.initDataStorage()
        // 加载持久化映射数据
        this.loadMappingData()
        // 加载配置文件中的预设群映射（IC群号 -> group_openid）
        if (icRelayCfg.groups && Object.keys(icRelayCfg.groups).length > 0) {
            for (const [icGroupId, openId] of Object.entries(icRelayCfg.groups)) {
                const key = String(icGroupId)
                if (!this.groupMapping.has(key)) {
                    this.groupMapping.set(key, openId)
                    this.openidMapping.set(openId, key)
                }
            }
            logger.info(`已加载 ${Object.keys(icRelayCfg.groups).length} 个预设群映射`)
        }
    }

    initDataStorage() {
        try {
            const currentFile = new URL(import.meta.url).pathname
            const pluginDir = path.resolve(path.dirname(currentFile), '../../../')
            this.dataDir = path.join(pluginDir, 'data', 'qqbot')
            this.mappingFile = path.join(this.dataDir, 'group_mapping.json')

            // 确保目录存在
            if (!fs.existsSync(this.dataDir)) {
                fs.mkdirSync(this.dataDir, { recursive: true })
                logger.info(`创建数据目录: ${this.dataDir}`)
            }
        } catch (err) {
            logger.warn(`初始化数据存储失败: ${err.message}`)
            // 回退到当前工作目录
            try {
                this.dataDir = path.join(process.cwd(), 'data', 'chatai', 'qqbot')
                this.mappingFile = path.join(this.dataDir, 'group_mapping.json')
                if (!fs.existsSync(this.dataDir)) {
                    fs.mkdirSync(this.dataDir, { recursive: true })
                }
            } catch {}
        }
    }

    loadMappingData() {
        try {
            if (!this.mappingFile || !fs.existsSync(this.mappingFile)) return

            const data = JSON.parse(fs.readFileSync(this.mappingFile, 'utf-8'))

            // 加载群号映射
            if (data.groupMapping) {
                for (const [icGroupId, openId] of Object.entries(data.groupMapping)) {
                    this.groupMapping.set(icGroupId, openId)
                    this.openidMapping.set(openId, icGroupId)
                }
                logger.info(`已加载 ${this.groupMapping.size} 个群号映射`)
            }

            // 加载按钮ID映射
            if (data.buttonIds) {
                for (const [groupId, btnData] of Object.entries(data.buttonIds)) {
                    this.buttonIds.set(groupId, btnData)
                }
                logger.info(`已加载 ${this.buttonIds.size} 个按钮ID映射`)
            }
        } catch (err) {
            logger.warn(`加载映射数据失败: ${err.message}`)
        }
    }

    saveMappingData() {
        try {
            if (!this.mappingFile) return

            const data = {
                groupMapping: Object.fromEntries(this.groupMapping),
                buttonIds: Object.fromEntries(this.buttonIds),
                updatedAt: new Date().toISOString()
            }

            fs.writeFileSync(this.mappingFile, JSON.stringify(data, null, 2))
            logger.debug('映射数据已保存')
        } catch (err) {
            logger.warn(`保存映射数据失败: ${err.message}`)
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
                    // 学习映射并保存
                    this.learnGroupMapping(icGroupId, groupOpenId)

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
                msgSeq: 1, // 每次新的被动ID从1开始
                useCount: existing?.useCount || 0 // 保留使用次数统计
            })
            logger.debug(`被动消息ID已${existing ? '更新' : '存储'}: ${groupOpenId}`)
        } else {
            logger.debug(`非IC触发，忽略被动消息ID: ${groupOpenId}`)
        }
    }
    onInteractionCreate(groupOpenId, eventId, userId = null) {
        if (!this.interactionIds.has(groupOpenId)) {
            this.interactionIds.set(groupOpenId, [])
        }
        const queue = this.interactionIds.get(groupOpenId)
        queue.push({
            eventId,
            timestamp: Date.now(),
            userId
        })
        setTimeout(() => {
            const idx = queue.findIndex(e => e.eventId === eventId)
            if (idx !== -1) queue.splice(idx, 1)
        }, this.BUTTON_TIMEOUT)
        const icGroupId = this.openidMapping.get(groupOpenId)
        if (icGroupId) {
            this.saveEventId(icGroupId, eventId, groupOpenId, userId)
        }
    }

    // 保存事件ID（按IC群号索引）
    saveEventId(icGroupId, eventId, openid, userId = null) {
        const key = String(icGroupId)
        if (!this.eventIds.has(key)) {
            this.eventIds.set(key, [])
        }
        const queue = this.eventIds.get(key)

        const data = {
            id: eventId,
            openid,
            userId,
            timestamp: Date.now()
        }

        queue.push(data)

        // 4分钟后自动移除
        setTimeout(() => {
            const idx = queue.findIndex(e => e.id === eventId)
            if (idx !== -1) queue.splice(idx, 1)
        }, this.BUTTON_TIMEOUT)

        logger.debug(`事件ID已保存: IC群${icGroupId}, eventId=${eventId}`)
    }

    // 获取有效的交互事件ID
    getValidInteractionId(groupOpenId) {
        const queue = this.interactionIds.get(groupOpenId)
        if (!queue || queue.length === 0) return null

        // 获取最新的有效事件
        const now = Date.now()
        for (let i = queue.length - 1; i >= 0; i--) {
            const interaction = queue[i]
            if (now - interaction.timestamp <= this.BUTTON_TIMEOUT) {
                return interaction.eventId
            }
        }

        return null
    }

    // 获取事件ID（按IC群号）
    getEventId(icGroupId) {
        const key = String(icGroupId)
        const queue = this.eventIds.get(key)
        if (!queue || queue.length === 0) return null

        // 获取最新的有效事件
        const now = Date.now()
        for (let i = queue.length - 1; i >= 0; i--) {
            const event = queue[i]
            if (now - event.timestamp <= this.BUTTON_TIMEOUT) {
                return { event_id: event.id, openid: event.openid }
            }
        }

        return null
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
        const key = String(icGroupId)
        this.groupMapping.set(key, groupOpenId)
        this.openidMapping.set(groupOpenId, key)
        logger.info(`学习群映射: IC群${icGroupId} -> ${groupOpenId}`)
        // 持久化保存
        this.saveMappingData()
    }

    // 设置按钮ID
    setButtonId(icGroupId, buttonData, buttonId) {
        const key = String(icGroupId)
        this.buttonIds.set(key, {
            data: buttonData,
            id: buttonId,
            timestamp: Date.now()
        })
        logger.debug(`按钮ID已设置: IC群${icGroupId}, buttonId=${buttonId}`)
        // 持久化保存
        this.saveMappingData()
    }

    // 获取按钮ID
    getButtonId(icGroupId) {
        const key = String(icGroupId)
        return this.buttonIds.get(key) || null
    }

    // 通过openid获取IC群号
    getICGroupId(groupOpenId) {
        return this.openidMapping.get(groupOpenId) || null
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
            passive.msgSeq = (passive.msgSeq || 1) + 1 // 递增msg_seq用于下次发送
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

        const groupId = String(icGroupId)

        // 检查全局代发设置
        if (cfg.globalRelay) {
            // 全局代发模式：检查黑名单
            const blacklist = cfg.blacklistGroups || []
            if (blacklist.includes(groupId)) {
                logger.debug(`[QQBotSender] 群 ${groupId} 在黑名单中，不代发`)
                return false
            }
            return true
        } else {
            // 非全局模式：检查白名单
            const whitelist = cfg.whitelistGroups || []
            // 如果配置了预设群映射，也算白名单
            const presetGroups = cfg.groups ? Object.keys(cfg.groups) : []
            const allowedGroups = [...new Set([...whitelist, ...presetGroups])]

            if (allowedGroups.length === 0) {
                // 没有配置任何白名单，不代发
                logger.debug(`[QQBotSender] 未配置代发白名单，不代发`)
                return false
            }

            if (!allowedGroups.includes(groupId)) {
                logger.debug(`[QQBotSender] 群 ${groupId} 不在白名单中，不代发`)
                return false
            }
            return true
        }
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
            // 检查是否使用MD模板发送
            const mdCfg = cfg.markdown
            let result
            if (mdCfg?.enabled && mdCfg?.templateId) {
                result = await this.sendGroupMarkdownMessage(groupOpenId, content, passive.msgId)
            } else {
                result = await this.sendGroupMessage(groupOpenId, content, passive.msgId)
            }

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

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
            msg_type: 0,
            msg_id: msgId,
            keyboard: {
                content: {
                    rows: [
                        {
                            buttons: [
                                {
                                    id: buttonId,
                                    render_data: { label: '💬', visited_label: '💬', style: 0 },
                                    action: {
                                        type: 1,
                                        permission: { type: 2 },
                                        data: buttonId,
                                        unsupport_tips: '请更新QQ'
                                    }
                                }
                            ]
                        }
                    ]
                }
            }
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
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

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
            msg_type: 0,
            event_id: eventId
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
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

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
            msg_type: 0
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
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
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

    // 发送Markdown模板消息
    async sendGroupMarkdownMessage(groupOpenId, content, msgId, appid) {
        const cfg = config.get('qqBotProxy.icRelay.markdown')
        if (!cfg?.enabled || !cfg?.templateId) {
            // MD模板未启用，回退到普通消息
            return await this.sendGroupMessage(groupOpenId, content, msgId, appid)
        }

        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        // 构建MD模板参数
        const templateKeys = this.parseTemplateKeys(cfg.templateKeys)
        const params = this.buildMarkdownParams(content, templateKeys)

        const body = {
            msg_type: 2, // markdown消息
            markdown: {
                custom_template_id: cfg.templateId,
                params
            },
            msg_seq: Math.floor(Math.random() * 1000000)
        }

        if (msgId) {
            body.msg_id = msgId
        }

        // 添加按钮（如果配置了）
        const buttonCfg = config.get('qqBotProxy.icRelay.button')
        if (buttonCfg?.enabled && buttonCfg?.templateId) {
            body.keyboard = {
                id: buttonCfg.templateId
            }
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
            })

            const result = await res.json()

            if (result.code) {
                logger.warn(`MD消息发送失败(${result.code})，尝试普通消息`)
                // 回退到普通消息
                return await this.sendGroupMessage(groupOpenId, content, msgId, appid)
            }

            logger.info(`MD消息发送成功: ${groupOpenId}`)
            return { success: true, data: result }
        } catch (err) {
            logger.error(`MD消息发送异常: ${err.message}`)
            return await this.sendGroupMessage(groupOpenId, content, msgId, appid)
        }
    }
    parseTemplateKeys(keysStr) {
        if (!keysStr) return ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10']
        if (keysStr.includes(',')) {
            return keysStr.split(',').map(k => k.trim())
        }
        // 否则按单字符分隔
        return keysStr.split('')
    }

    // 构建Markdown模板参数
    buildMarkdownParams(content, keysOrStr) {
        const keys = Array.isArray(keysOrStr) ? keysOrStr : this.parseTemplateKeys(keysOrStr)
        const params = []
        // 将内容按换行分割并分配到各个参数
        const lines = content.split(/\r?\n/)
        let currentIdx = 0

        for (let i = 0; i < keys.length; i++) {
            if (currentIdx < lines.length) {
                params.push({
                    key: keys[i],
                    values: [lines[currentIdx] || '\u200B']
                })
                currentIdx++
            } else {
                params.push({
                    key: keys[i],
                    values: ['\u200B'] // 空白字符占位
                })
            }
        }

        // 如果内容行数超过模板参数数量，合并到最后一个参数
        if (currentIdx < lines.length && params.length > 0) {
            const remaining = lines.slice(currentIdx - 1).join('\n')
            params[params.length - 1].values = [remaining]
        }

        return params
    }

    async sendC2CMessage(userOpenId, content, msgId, appid) {
        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/users/${userOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content,
            msg_type: 0
        }
        if (msgId) {
            body.msg_id = msgId
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
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

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/channels/${channelId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        const body = {
            content: content
        }
        if (msgId) {
            body.msg_id = msgId
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
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

    // 上传媒体文件到群
    async uploadGroupMedia(groupOpenId, fileData, fileType = 1, appid) {
        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/groups/${groupOpenId}/files`
        const uploadUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        // 处理文件数据
        let file_data = fileData
        if (Buffer.isBuffer(fileData)) {
            file_data = fileData.toString('base64')
        } else if (typeof fileData === 'string' && !fileData.startsWith('http')) {
            // 如果是base64字符串，移除可能的前缀
            file_data = fileData.replace(/^data:[^;]+;base64,/, '')
        }

        const body = {
            file_type: fileType, // 1=图片, 2=视频, 3=语音, 4=文件
            file_data,
            srv_send_msg: false // 不直接发送，只上传获取file_info
        }

        try {
            const res = await fetch(uploadUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
            })

            const result = await res.json()

            if (result.code) {
                logger.error(`上传媒体失败: ${result.code} ${result.message}`)
                return { success: false, error: result.message, code: result.code }
            }

            logger.debug(`媒体上传成功: ${groupOpenId}`)
            return { success: true, file_info: result.file_info }
        } catch (err) {
            logger.error(`上传媒体异常: ${err.message}`)
            return { success: false, error: err.message }
        }
    }

    // 发送带媒体的群消息
    async sendGroupMediaMessage(groupOpenId, content, media, eventId, appid) {
        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        // 如果media是文件数据，先上传
        let mediaInfo = null
        if (media?.data) {
            const uploadResult = await this.uploadGroupMedia(groupOpenId, media.data, media.type || 1, appid)
            if (!uploadResult.success) {
                return uploadResult
            }
            mediaInfo = { file_info: uploadResult.file_info }
        } else if (media?.file_info) {
            mediaInfo = media
        }

        const body = {
            content: content || '',
            msg_type: mediaInfo ? 7 : 0, // 7=富媒体消息
            msg_seq: Math.floor(Math.random() * 1000000)
        }

        if (eventId) {
            body.event_id = eventId
        }

        if (mediaInfo) {
            body.media = mediaInfo
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
            })

            const result = await res.json()

            if (result.code) {
                logger.error(`发送媒体消息失败: ${result.code} ${result.message}`)
                return { success: false, error: result.message, code: result.code }
            }

            logger.info(`媒体消息发送成功: ${groupOpenId}`)
            return { success: true, data: result }
        } catch (err) {
            logger.error(`发送媒体消息异常: ${err.message}`)
            return { success: false, error: err.message }
        }
    }

    // 使用事件ID发送完整消息（支持文本+媒体）
    async sendMessageWithEventId(icGroupId, messages, e) {
        const cfg = config.get('qqBotProxy.icRelay')
        if (!cfg?.enabled) {
            return { success: false, error: 'IC relay not enabled', useIC: true }
        }

        // 获取群openid
        let groupOpenId = this.getGroupOpenId(icGroupId)
        if (!groupOpenId) {
            // 尝试从配置文件获取
            const presetGroups = cfg.groups || {}
            groupOpenId = presetGroups[String(icGroupId)]
        }
        if (!groupOpenId) {
            logger.debug(`群 ${icGroupId} 无映射`)
            return { success: false, error: 'No group mapping', useIC: cfg.fallbackToIC !== false }
        }

        // 获取事件ID
        let eventData = this.getEventId(icGroupId)

        if (!eventData) {
            // 没有事件ID，尝试发送按钮MD获取
            logger.info(`群 ${icGroupId} 无事件ID，发送按钮MD获取...`)
            const triggerResult = await this.sendButtonMDForEventId(groupOpenId, icGroupId)

            if (triggerResult.success) {
                // 等待用户点击按钮获取event_id（最多等5秒）
                const maxWait = 5000
                const pollInterval = 100
                const startTime = Date.now()

                while (Date.now() - startTime < maxWait) {
                    eventData = this.getEventId(icGroupId)
                    if (eventData) {
                        logger.debug(`获取到事件ID，等待了${Date.now() - startTime}ms`)
                        break
                    }
                    await new Promise(resolve => setTimeout(resolve, pollInterval))
                }
            }

            if (!eventData) {
                logger.debug(`群 ${icGroupId} 等待事件ID超时`)
                return { success: false, error: 'No event_id available', useIC: cfg.fallbackToIC !== false }
            }
        }

        const { event_id, openid } = eventData
        const appid = this.getBotForGroup(icGroupId)

        // 处理消息内容
        let textContent = ''
        let mediaData = null

        if (typeof messages === 'string') {
            textContent = messages
        } else if (Array.isArray(messages)) {
            for (const msg of messages) {
                if (typeof msg === 'string') {
                    textContent += msg
                } else if (msg.type === 'text') {
                    textContent += msg.text || ''
                } else if (msg.type === 'image') {
                    // 图片消息
                    mediaData = { data: msg.file || msg.url, type: 1 }
                } else if (msg.type === 'video') {
                    mediaData = { data: msg.file || msg.url, type: 2 }
                } else if (msg.type === 'record' || msg.type === 'audio') {
                    mediaData = { data: msg.file || msg.url, type: 3 }
                }
            }
        }
        const mdCfg = config.get('qqBotProxy.icRelay.markdown')
        if (mediaData) {
            return await this.sendGroupMediaMessage(openid || groupOpenId, textContent, mediaData, event_id, appid)
        } else if (mdCfg?.enabled && mdCfg?.templateId) {
            return await this.sendGroupMarkdownMessageWithEventId(openid || groupOpenId, textContent, event_id, appid)
        } else {
            return await this.sendGroupMessageWithEventId(openid || groupOpenId, textContent, event_id)
        }
    }

    // 模拟点击按钮获取event_id（参考temp/QQBot.js的clickButton实现）
    async clickButton(icGroupId, selfId) {
        const cfg = config.get('qqBotProxy.icRelay')
        const buttonCfg = cfg?.button

        if (!buttonCfg?.enabled || !buttonCfg?.appid) {
            logger.debug('未配置按钮appid')
            return { success: false, error: 'No button appid configured' }
        }

        // 检查是否有按钮ID
        let buttonInfo = this.getButtonId(icGroupId)

        if (!buttonInfo) {
            // 没有按钮ID，需要先触发官方Bot发送带按钮的消息
            logger.info(`群 ${icGroupId} 无按钮ID，需要先触发官方Bot`)
            return { success: false, error: 'No button ID, need to trigger official bot first', needTrigger: true }
        }

        const { data: buttonData, id: buttonId } = buttonInfo

        // 获取ICQQ Bot实例
        const icBot = Bot[selfId]
        if (!icBot?.sdk?.sendUni || !icBot?.icqq?.core?.pb?.encode) {
            logger.warn('ICQQ Bot不支持sendUni协议')
            return { success: false, error: 'ICQQ does not support sendUni' }
        }

        // 构建按钮点击协议包
        const seq = Math.floor(Math.random() * 65535)
        const body = {
            1: 4398,
            2: 1,
            12: 1,
            4: {
                3: Number(buttonCfg.appid),
                4: seq,
                5: String(buttonId),
                6: buttonData,
                7: 0,
                8: icGroupId,
                9: 1
            }
        }

        try {
            await icBot.sdk.sendUni('OidbSvcTrpcTcp.0x112e_1', icBot.icqq.core.pb.encode(body))
            logger.info(`模拟点击按钮成功: 群${icGroupId}, buttonId=${buttonId}`)
            return { success: true }
        } catch (err) {
            logger.error(`模拟点击按钮失败: ${err.message}`)
            return { success: false, error: err.message }
        }
    }

    // 获取event_id（参考temp/QQBot.js的getEventId实现）
    async getEventIdWithClick(icGroupId, selfId) {
        // 先检查缓存
        let eventData = this.getEventId(icGroupId)
        if (eventData) {
            return eventData
        }

        // 没有缓存，尝试点击按钮
        const clickResult = await this.clickButton(icGroupId, selfId)
        if (!clickResult.success) {
            return null
        }

        // 等待event_id（最多5秒）
        for (let i = 0; i < 50; i++) {
            await new Promise(r => setTimeout(r, 100))
            eventData = this.getEventId(icGroupId)
            if (eventData) {
                return eventData
            }
        }

        return null
    }

    // 存储按钮ID（从INTERACTION_CREATE事件中提取）
    saveButtonIdFromInteraction(groupOpenId, buttonId, buttonData) {
        const icGroupId = this.getICGroupId(groupOpenId)
        if (icGroupId && buttonId && buttonData) {
            this.setButtonId(icGroupId, buttonData, buttonId)
            logger.info(`保存按钮ID: IC群${icGroupId}, buttonId=${buttonId}, data=${buttonData}`)
        }
    }

    // 发送带按钮的MD消息以获取event_id
    async sendButtonMDForEventId(groupOpenId, icGroupId) {
        const cfg = config.get('qqBotProxy.icRelay')
        const mdCfg = cfg?.markdown
        const buttonCfg = cfg?.button

        // 需要MD模板和按钮配置
        if (!mdCfg?.enabled || !mdCfg?.templateId) {
            logger.debug('未配置MD模板，无法发送按钮消息获取event_id')
            return { success: false, error: 'No markdown template configured' }
        }

        if (!buttonCfg?.enabled || !buttonCfg?.templateId) {
            logger.debug('未配置按钮模板，无法获取event_id')
            return { success: false, error: 'No button template configured' }
        }

        const appid = this.getBotForGroup(icGroupId)
        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        // 构建简单的MD消息内容
        const templateKeys = this.parseTemplateKeys(mdCfg.templateKeys)
        const params = this.buildMarkdownParams('💬', templateKeys)

        const body = {
            msg_type: 2, // markdown消息
            markdown: {
                custom_template_id: mdCfg.templateId,
                params
            },
            keyboard: {
                id: buttonCfg.templateId
            },
            msg_seq: Math.floor(Math.random() * 1000000)
        }

        // 尝试使用被动消息ID
        const passive = this.getPassiveMessage(groupOpenId)
        if (passive?.msgId) {
            body.msg_id = passive.msgId
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
            })

            const result = await res.json()

            if (result.code) {
                logger.warn(`发送按钮MD获取event_id失败: ${result.code} ${result.message}`)
                return { success: false, error: result.message, code: result.code }
            }

            logger.debug(`按钮MD发送成功，等待用户点击获取event_id`)
            return { success: true, data: result }
        } catch (err) {
            logger.error(`发送按钮MD异常: ${err.message}`)
            return { success: false, error: err.message }
        }
    }

    async sendGroupMarkdownMessageWithEventId(groupOpenId, content, eventId, appid) {
        const cfg = config.get('qqBotProxy.icRelay.markdown')
        if (!cfg?.enabled || !cfg?.templateId) {
            return await this.sendGroupMessageWithEventId(groupOpenId, content, eventId)
        }

        const bot = await this.getBotInstance(appid)
        if (!bot) return { success: false, error: 'No bot available' }

        const accessToken = await this.getAccessToken(bot.bot_id)
        if (!accessToken) return { success: false, error: 'No access token' }

        const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

        const apiPath = `/v2/groups/${groupOpenId}/messages`
        const sendUrl = `${this.proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

        // 构建MD模板参数
        const templateKeys = this.parseTemplateKeys(cfg.templateKeys)
        const params = this.buildMarkdownParams(content, templateKeys)

        const body = {
            msg_type: 2, // markdown消息
            markdown: {
                custom_template_id: cfg.templateId,
                params
            },
            event_id: eventId,
            msg_seq: Math.floor(Math.random() * 1000000)
        }

        // 添加按钮（如果配置了）
        const buttonCfg = config.get('qqBotProxy.icRelay.button')
        if (buttonCfg?.enabled && buttonCfg?.templateId) {
            body.keyboard = {
                id: buttonCfg.templateId
            }
        }

        try {
            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify(body)
            })

            const result = await res.json()

            if (result.code) {
                logger.warn(`MD消息(eventId)发送失败(${result.code})，尝试普通消息`)
                return await this.sendGroupMessageWithEventId(groupOpenId, content, eventId)
            }

            logger.info(`MD消息(eventId)发送成功: ${groupOpenId}`)
            return { success: true, data: result }
        } catch (err) {
            logger.error(`MD消息(eventId)发送异常: ${err.message}`)
            return await this.sendGroupMessageWithEventId(groupOpenId, content, eventId)
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
            icRelayEnabled: config.get('qqBotProxy.icRelay.enabled') || false,
            groupMappingCount: this.groupMapping.size,
            buttonIdCount: this.buttonIds.size,
            eventIdCount: this.eventIds.size
        }
    }

    // 增强版IC代发：优先使用事件ID，回退到被动消息ID
    async relayFromICEnhanced(icGroupId, messages, e) {
        const cfg = config.get('qqBotProxy.icRelay')
        if (!cfg?.enabled) {
            return { success: false, error: 'IC relay not enabled', useIC: true }
        }

        // 1. 先尝试使用事件ID发送
        const eventResult = await this.sendMessageWithEventId(icGroupId, messages, e)
        if (eventResult.success) {
            return eventResult
        }

        // 2. 如果事件ID不可用，尝试被动消息ID方式
        const textContent =
            typeof messages === 'string'
                ? messages
                : Array.isArray(messages)
                  ? messages
                        .filter(m => typeof m === 'string' || m.type === 'text')
                        .map(m => (typeof m === 'string' ? m : m.text))
                        .join('')
                  : String(messages)

        const relayResult = await this.relayFromIC(icGroupId, textContent, e)
        return relayResult
    }

    // 处理按钮点击回调（从ICQQ消息中提取按钮信息）
    handleButtonCallback(e, buttonData, buttonId) {
        if (!e?.group_id) return

        const icGroupId = String(e.group_id)

        // 检查按钮数据是否包含BOT标识
        if (buttonData?.startsWith?.('BOT')) {
            this.setButtonId(icGroupId, buttonData, buttonId)
            logger.info(`从消息中提取按钮ID: 群${icGroupId}, buttonId=${buttonId}`)
        }
    }

    // 学习群映射（从官方Bot消息中提取openid）
    handleOfficialBotMessage(e, groupOpenId) {
        if (!e?.group_id || !groupOpenId) return

        const icGroupId = String(e.group_id)

        // 检查是否已有映射
        const existing = this.groupMapping.get(icGroupId)
        if (!existing) {
            this.learnGroupMapping(icGroupId, groupOpenId)
        }
    }
}

export const qqBotSender = new QQBotSender()
export { QQBotSender }
