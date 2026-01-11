import config from '../../../config/config.js'
import { chatLogger } from '../../core/utils/logger.js'
import { qqBotSender } from './QQBotSender.js'

const logger = {
    info: (...args) => chatLogger.info('QQBotMsg', ...args),
    warn: (...args) => chatLogger.warn('QQBotMsg', ...args),
    error: (...args) => chatLogger.error('QQBotMsg', ...args),
    debug: (...args) => chatLogger.debug('QQBotMsg', ...args)
}

let _chatService = null

async function getChatService() {
    if (!_chatService) {
        const { chatService } = await import('../llm/ChatService.js')
        _chatService = chatService
    }
    return _chatService
}

class QQBotMessageHandler {
    constructor() {
        this.messageQueue = []
        this.processing = false
    }

    async handleMessage(eventType, data, botInstance) {
        const cfg = config.get('qqBotProxy.messageHandler')
        if (!cfg?.enabled) return

        logger.debug(`处理消息事件: ${eventType}`)

        switch (eventType) {
            case 'AT_MESSAGE_CREATE':
            case 'MESSAGE_CREATE':
                await this.handleGuildMessage(data, botInstance)
                break
            case 'DIRECT_MESSAGE_CREATE':
                await this.handleDirectMessage(data, botInstance)
                break
            case 'C2C_MESSAGE_CREATE':
                await this.handleC2CMessage(data, botInstance)
                break
            case 'GROUP_AT_MESSAGE_CREATE':
                await this.handleGroupMessage(data, botInstance)
                break
            case 'INTERACTION_CREATE':
                await this.handleInteraction(data, botInstance)
                break
            default:
                logger.debug(`未处理的事件类型: ${eventType}`)
        }
    }

    async handleGuildMessage(data, botInstance) {
        const { id, content, author, channel_id, guild_id, member } = data

        if (!content || !author) {
            logger.debug('消息内容或作者为空，跳过')
            return
        }

        // 过滤Bot自己的消息
        if (author.bot) {
            return
        }

        const cleanContent = this.cleanAtContent(content)
        if (!cleanContent.trim()) {
            return
        }

        logger.info(`频道消息 [${guild_id}/${channel_id}] ${author.username}: ${cleanContent.substring(0, 50)}`)

        const context = {
            type: 'guild',
            messageId: id,
            channelId: channel_id,
            guildId: guild_id,
            userId: author.id,
            username: author.username,
            nickname: member?.nick || author.username,
            content: cleanContent,
            raw: data
        }

        await this.processWithAI(context, botInstance)
    }

    async handleDirectMessage(data, botInstance) {
        const { id, content, author, guild_id } = data

        if (!content || !author) {
            return
        }

        const cleanContent = this.cleanAtContent(content)
        if (!cleanContent.trim()) {
            return
        }

        logger.info(`私信消息 [${guild_id}] ${author.username}: ${cleanContent.substring(0, 50)}`)

        const context = {
            type: 'direct',
            messageId: id,
            guildId: guild_id,
            userId: author.id,
            username: author.username,
            content: cleanContent,
            raw: data
        }

        await this.processWithAI(context, botInstance)
    }

    async handleC2CMessage(data, botInstance) {
        const { id, content, author } = data

        if (!content || !author) {
            return
        }

        logger.info(`C2C消息 ${author.user_openid}: ${content.substring(0, 50)}`)

        const context = {
            type: 'c2c',
            messageId: id,
            userId: author.user_openid,
            content: content,
            raw: data
        }

        await this.processWithAI(context, botInstance)
    }

    async handleGroupMessage(data, botInstance) {
        const { id, content, author, group_openid } = data

        if (!author) {
            return
        }

        const cleanContent = this.cleanAtContent(content || '')
        logger.info(`群消息 [${group_openid}] ${author.member_openid}: ${cleanContent.substring(0, 50) || '(空)'}`)

        // IC代发模式：存储被动消息ID
        const icRelayCfg = config.get('qqBotProxy.icRelay')
        if (icRelayCfg?.enabled) {
            qqBotSender.onOfficialBotTriggered(group_openid, id)

            // 同时存储到事件ID（作为备用）
            const icGroupId = qqBotSender.getICGroupId(group_openid)
            if (icGroupId) {
                // 群@消息也可以作为事件ID使用
                qqBotSender.saveEventId(icGroupId, id, group_openid, author.member_openid)
            }

            // 检查是否需要回复带按钮的MD消息（用于获取buttonId）
            const buttonCfg = icRelayCfg.button
            const mdCfg = icRelayCfg.markdown
            if (buttonCfg?.enabled && buttonCfg?.templateId && mdCfg?.enabled && mdCfg?.templateId) {
                // 回复带按钮的MD消息
                await this.replyWithButtonMD(group_openid, id, botInstance)
            }
            return
        }

        if (!cleanContent.trim()) {
            return
        }

        const context = {
            type: 'group',
            messageId: id,
            groupId: group_openid,
            userId: author.member_openid,
            content: cleanContent,
            raw: data
        }

        await this.processWithAI(context, botInstance)
    }

    async handleInteraction(data, botInstance) {
        logger.debug('收到互动事件:', JSON.stringify(data).substring(0, 200))

        // 处理按钮点击事件
        const { id, group_openid, data: interactionData, group_member_openid } = data

        if (group_openid && id) {
            // 存储交互事件ID供IC代发使用（包含用户ID）
            qqBotSender.onInteractionCreate(group_openid, id, group_member_openid)
            logger.info(`按钮点击事件: group=${group_openid}, eventId=${id}, user=${group_member_openid}`)

            // 提取按钮ID信息（用于后续模拟点击）
            const buttonId = interactionData?.resolved?.button_id
            const buttonData = interactionData?.resolved?.button_data
            if (buttonId && buttonData) {
                // 保存按钮ID供后续模拟点击使用
                qqBotSender.saveButtonIdFromInteraction(group_openid, buttonId, buttonData)
            }

            // 回应交互事件（必须回应否则客户端会显示loading）
            await this.ackInteraction(data, botInstance)
        }
    }

    async ackInteraction(data, botInstance) {
        try {
            const bot = await this.getBotInstance(botInstance)
            if (!bot) return

            const accessToken = await this.getAccessToken(bot.bot_id)
            if (!accessToken) return

            const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

            const apiPath = `/interactions/${data.id}`
            const proxyUrl = config.get('qqBotProxy.proxyUrl') || 'http://localhost:2173'
            const ackUrl = `${proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

            await fetch(ackUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': bot.appid
                },
                body: JSON.stringify({ code: 0 })
            })
            logger.debug('交互事件已确认')
        } catch (err) {
            logger.debug(`确认交互事件失败: ${err.message}`)
        }
    }

    async replyWithButtonMD(groupOpenId, msgId, botInstance) {
        try {
            const bot = await this.getBotInstance(botInstance)
            if (!bot) return

            const accessToken = await this.getAccessToken(bot.bot_id)
            if (!accessToken) return

            const icRelayCfg = config.get('qqBotProxy.icRelay')
            const mdCfg = icRelayCfg?.markdown
            const buttonCfg = icRelayCfg?.button

            const apiBase = bot.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

            const apiPath = `/v2/groups/${groupOpenId}/messages`
            const proxyUrl = config.get('qqBotProxy.proxyUrl') || 'http://localhost:2173'
            const sendUrl = `${proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

            // 构建MD模板参数
            const templateKeys = this.parseTemplateKeys(mdCfg?.templateKeys)
            const params = templateKeys.map((key, idx) => ({
                key,
                values: [idx === 0 ? '点击按钮' : ' ']
            }))

            const body = {
                msg_type: 2,
                msg_id: msgId,
                msg_seq: Math.floor(Math.random() * 1000000),
                markdown: {
                    custom_template_id: mdCfg.templateId,
                    params
                },
                keyboard: {
                    id: buttonCfg.templateId
                }
            }

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
                logger.warn(`回复按钮MD失败: ${result.code} ${result.message}`)
            } else {
                logger.info(`按钮MD回复成功: ${groupOpenId}`)
            }
        } catch (err) {
            logger.error(`回复按钮MD异常: ${err.message}`)
        }
    }

    parseTemplateKeys(keysStr) {
        if (!keysStr) return ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8', 'v9', 'v10']
        if (keysStr.includes(',')) {
            return keysStr.split(',').map(k => k.trim())
        }
        return keysStr.split('')
    }

    async getBotInstance(botInstance) {
        if (!this.proxyUrl) {
            this.proxyUrl = config.get('qqBotProxy.proxyUrl') || 'http://localhost:2173'
        }
        try {
            const listRes = await fetch(`${this.proxyUrl}/bot/list`)
            const listData = await listRes.json()
            if (!listData.bots?.length) return null
            return listData.bots.find(b => b.appid === botInstance.appid) || listData.bots[0]
        } catch {
            return null
        }
    }

    async getAccessToken(botId) {
        if (!this.proxyUrl) {
            this.proxyUrl = config.get('qqBotProxy.proxyUrl') || 'http://localhost:2173'
        }
        try {
            const tokenRes = await fetch(`${this.proxyUrl}/bot/${botId}/token`)
            const tokenData = await tokenRes.json()
            return tokenData.access_token
        } catch {
            return null
        }
    }

    cleanAtContent(content) {
        // 移除@机器人的部分
        return content
            .replace(/<@!\d+>/g, '')
            .replace(/<@\d+>/g, '')
            .trim()
    }

    async processWithAI(context, botInstance) {
        const cfg = config.get('qqBotProxy.messageHandler')
        if (!cfg?.useAI) {
            logger.debug('AI处理未启用')
            return
        }

        try {
            const chatService = await getChatService()

            // 构建伪装的e对象，适配现有的ChatService
            const mockE = this.createMockE(context, botInstance)

            // 使用ChatService.sendMessage处理
            const result = await chatService.sendMessage({
                userId: context.userId,
                message: context.content,
                event: mockE,
                presetId: cfg.presetId || ''
            })

            if (result?.response) {
                const responseText = Array.isArray(result.response)
                    ? result.response.map(r => (typeof r === 'string' ? r : r.text || '')).join('')
                    : String(result.response)
                if (responseText) {
                    await this.sendReply(context, responseText, botInstance)
                }
            }
        } catch (err) {
            logger.error(`AI处理失败: ${err.message}`)
        }
    }

    createMockE(context, botInstance) {
        const reply = async msg => {
            await this.sendReply(context, msg, botInstance)
        }

        return {
            user_id: context.userId,
            sender: {
                user_id: context.userId,
                nickname: context.nickname || context.username || context.userId
            },
            group_id: context.groupId || context.guildId,
            isGroup: context.type === 'group' || context.type === 'guild',
            isPrivate: context.type === 'direct' || context.type === 'c2c',
            msg: context.content,
            message: [{ type: 'text', text: context.content }],
            reply,
            // QQBot特有标识
            isQQBot: true,
            qqBotContext: context,
            qqBotInstance: botInstance
        }
    }

    async sendReply(context, message, botInstance) {
        const proxyUrl = config.get('qqBotProxy.proxyUrl') || 'http://localhost:2173'

        // 根据消息类型构建不同的API请求
        let apiPath = ''
        let body = {}

        const msgContent = typeof message === 'string' ? message : message.toString()

        switch (context.type) {
            case 'guild':
                apiPath = `/channels/${context.channelId}/messages`
                body = {
                    content: msgContent,
                    msg_id: context.messageId
                }
                break
            case 'direct':
                apiPath = `/dms/${context.guildId}/messages`
                body = {
                    content: msgContent,
                    msg_id: context.messageId
                }
                break
            case 'c2c':
                apiPath = `/v2/users/${context.userId}/messages`
                body = {
                    content: msgContent,
                    msg_type: 0,
                    msg_id: context.messageId
                }
                break
            case 'group':
                apiPath = `/v2/groups/${context.groupId}/messages`
                body = {
                    content: msgContent,
                    msg_type: 0,
                    msg_id: context.messageId
                }
                break
            default:
                logger.warn(`未知的消息类型: ${context.type}`)
                return
        }

        try {
            // 获取Bot的AccessToken
            const tokenUrl = `${proxyUrl}/bot/${botInstance.botId}/token`
            const tokenRes = await fetch(tokenUrl)
            const tokenData = await tokenRes.json()
            const accessToken = tokenData.access_token

            if (!accessToken) {
                logger.error('获取AccessToken失败')
                return
            }

            // 发送消息
            const apiBase = context.raw?.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com'

            const sendUrl = `${proxyUrl}/proxy?url=${encodeURIComponent(apiBase + apiPath)}`

            const res = await fetch(sendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `QQBot ${accessToken}`,
                    'X-Union-Appid': botInstance.appid
                },
                body: JSON.stringify(body)
            })

            const result = await res.json()

            if (result.code) {
                logger.error(`发送消息失败: ${result.code} ${result.message}`)
            } else {
                logger.info(`消息发送成功: ${context.type}`)
            }
        } catch (err) {
            logger.error(`发送消息异常: ${err.message}`)
        }
    }
}

export const qqBotMessageHandler = new QQBotMessageHandler()
export { QQBotMessageHandler }
