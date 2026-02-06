import {
    detectFramework as getBotFramework,
    detectAdapter as getAdapter,
    isMaster
} from '../src/utils/platformAdapter.js'
import { formatTimeToBeiJing } from '../src/utils/common.js'
import { renderService } from '../src/services/media/RenderService.js'
import { statsService } from '../src/services/stats/StatsService.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import {
    IcqqMessageUtils,
    ProtobufUtils,
    ForwardMessageParser,
    MsgRecordExtractor,
    NapCatMessageUtils
} from '../src/utils/messageParser.js'

/**
 * 获取框架类型
 */
function getFramework() {
    return getBotFramework() // 'trss' 或 'miao'
}

/**
 * 检测适配器类型 (使用 bot.js 的 getAdapter)
 */
function detectAdapter(e) {
    return getAdapter(e)
}

export class MessageInspector extends plugin {
    constructor() {
        super({
            name: 'AI-MessageInspector',
            dsc: '消息检查器 - 获取消息raw/pb信息',
            event: 'message',
            priority: 1, // 高优先级，确保命令能被触发
            rule: [
                {
                    reg: '^#取(\\d*)$', // 匹配 #取 或 #取123
                    fnc: 'inspectMessage',
                    permission: 'master'
                },
                {
                    reg: '^#取上(\\d+)条?$', // 匹配 #取上5条 或 #取上5
                    fnc: 'inspectPreviousMessages',
                    permission: 'master'
                },
                {
                    reg: '^#取\\$(\\d+)$', // 匹配 #取$12345 (明确按seq取)
                    fnc: 'inspectBySeq',
                    permission: 'master'
                },
                {
                    reg: '^#取消息(\\d*)$',
                    fnc: 'inspectMessage',
                    permission: 'master'
                },
                {
                    reg: '^#消息详情(\\d*)$',
                    fnc: 'inspectMessage',
                    permission: 'master'
                },
                {
                    reg: '^#(ai)?统计$',
                    fnc: 'showStats',
                    permission: 'master'
                },
                {
                    reg: '^#(ai)?统计详情$',
                    fnc: 'showDetailedStats',
                    permission: 'master'
                },
                {
                    reg: '^#(ai)?debug(信息)?$',
                    fnc: 'showDebugInfo',
                    permission: 'master'
                },
                {
                    reg: '^#(ai)?重置统计$',
                    fnc: 'resetStats',
                    permission: 'master'
                }
            ]
        })
    }

    /**
     * 检查消息详情 - 增强版
     * 支持提取完整的 pb/elem/msg 数据
     * 深度递归解析合并转发，使用嵌套合并转发包裹
     */
    async inspectMessage() {
        const e = this.e
        const bot = e.bot || Bot

        // 获取目标消息
        let targetSeq = null
        let targetMsgId = null
        let getPrevious = false

        // 从命令中提取seq
        const match = e.msg.match(/#(?:取|取消息|消息详情)\s*(\d+)?/)
        if (match && match[1]) {
            targetSeq = parseInt(match[1])
        }

        // 调试：打印引用相关字段
        logger.debug(
            `[MessageInspector] Reply debug: source=${JSON.stringify(e.source)}, reply_id=${e.reply_id}, message_type=${typeof e.message}, message_len=${Array.isArray(e.message) ? e.message.length : 'N/A'}`
        )
        if (Array.isArray(e.message)) {
            logger.debug(
                `[MessageInspector] e.message segments: ${JSON.stringify(e.message.map(s => ({ type: s.type, id: s.data?.id || s.id })))}`
            )
        }

        // 从引用消息中获取
        if (!targetSeq && e.source) {
            targetSeq = e.source.seq
            targetMsgId = e.source.message_id || e.source.id
            logger.debug(`[MessageInspector] Got from e.source: seq=${targetSeq}, msgId=${targetMsgId}`)
        }

        // NapCat/OneBot: 从 e.reply_id 获取
        if (!targetSeq && !targetMsgId && e.reply_id) {
            targetMsgId = e.reply_id
            logger.debug(`[MessageInspector] Got from e.reply_id: ${targetMsgId}`)
        }

        // NapCat/OneBot: 从消息数组中提取 reply 段的 id
        if (!targetSeq && !targetMsgId) {
            const msgArrays = [e.message, e.original_msg?.message, e.raw_message_json].filter(Boolean)
            for (const msgArray of msgArrays) {
                if (!Array.isArray(msgArray)) continue
                for (const seg of msgArray) {
                    if (seg.type === 'reply' && (seg.data?.id || seg.id)) {
                        targetMsgId = seg.data?.id || seg.id
                        logger.debug(`[MessageInspector] Got from message array: ${targetMsgId}`)
                        break
                    }
                }
                if (targetMsgId) break
            }
        }

        logger.debug(
            `[MessageInspector] Final: targetSeq=${targetSeq}, targetMsgId=${targetMsgId}, getPrevious=${!targetSeq && !targetMsgId}`
        )

        // 没有指定seq也没有引用，则获取上一条消息
        if (!targetSeq && !targetMsgId) {
            getPrevious = true
        }

        try {
            let rawMsg = null

            // 获取消息
            if (getPrevious) {
                if (e.group_id) {
                    const group = bot.pickGroup(e.group_id)
                    if (group?.getChatHistory) {
                        const history = await group.getChatHistory(0, 2)
                        rawMsg = history?.length >= 2 ? history[history.length - 2] : history?.[0]
                    }
                } else {
                    const friend = bot.pickFriend(e.user_id)
                    if (friend?.getChatHistory) {
                        const history = await friend.getChatHistory(0, 2)
                        rawMsg = history?.length >= 2 ? history[history.length - 2] : history?.[0]
                    }
                }
            } else {
                rawMsg = await this.fetchMessage(bot, e, targetSeq, targetMsgId)
            }

            if (!rawMsg) {
                await this.reply('❌ 获取消息失败，请引用消息后发送 #取 或提供消息seq', true)
                return true
            }

            // 完整解析消息（包括深度递归转发）
            const fullData = await this.parseMessageComplete(e, rawMsg, { maxDepth: 10 })

            // 使用嵌套合并转发发送数据
            await this.sendNestedForward(e, fullData)
        } catch (error) {
            logger.error('[MessageInspector] Error:', error)
            await this.reply(`❌ 获取消息失败: ${error.message}`, true)
        }

        return true
    }
    async inspectPreviousMessages() {
        const e = this.e
        const bot = e.bot || Bot
        const botId = bot.uin || bot.self_id || 10000

        const match = e.msg.match(/#取上(\d+)条?/)
        const count = match ? Math.min(parseInt(match[1]), 50) : 5 // 最多50条

        try {
            let history = null

            if (e.group_id) {
                const group = bot.pickGroup(e.group_id)
                if (group?.getChatHistory) {
                    history = await group.getChatHistory(0, count + 1) // +1 因为可能包含当前消息
                } else if (bot?.sendApi) {
                    const result = await bot.sendApi('get_group_msg_history', {
                        group_id: e.group_id,
                        count: count + 1
                    })
                    history = result?.data?.messages || result?.messages || []
                }
            } else {
                const friend = bot.pickFriend(e.user_id)
                if (friend?.getChatHistory) {
                    history = await friend.getChatHistory(0, count + 1)
                }
            }

            if (!history || history.length === 0) {
                await this.reply('❌ 获取历史消息失败', true)
                return true
            }

            // 排除当前命令消息本身（如果存在）
            const messages = history
                .filter(msg => {
                    const msgSeq = msg.seq || msg.message_seq
                    return msgSeq !== e.seq
                })
                .slice(-count)

            if (messages.length === 0) {
                await this.reply('❌ 没有找到历史消息', true)
                return true
            }

            // 构建主节点列表
            const mainNodes = []

            // 标题节点
            const timeRange = `${messages.length > 0 ? formatTimeToBeiJing(messages[0].time * 1000) : '?'} ~ ${messages.length > 0 ? formatTimeToBeiJing(messages[messages.length - 1].time * 1000) : '?'}`
            mainNodes.push(
                this.createTextNode(
                    botId,
                    'MessageInspector',
                    `📋 获取前 ${messages.length} 条消息\n时间范围: ${timeRange}`
                )
            )

            // 逐条完整解析
            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i]

                // 完整解析消息（包括 proto/pb/转发等）
                const fullData = await this.parseMessageComplete(e, msg, { maxDepth: 10 })

                // 构建该消息的详情子节点
                const subNodes = await this.buildInspectNodes(e, fullData)

                // 获取发送者信息作为子转发标题
                const senderName = msg.sender?.nickname || msg.sender?.card || String(msg.user_id || '?')
                const seq = msg.seq || msg.message_seq || '?'
                const time = msg.time ? formatTimeToBeiJing(msg.time * 1000) : '?'

                // 包裹为子合并转发
                const subForward = await this.createForwardNode(
                    e,
                    `[${i + 1}/${messages.length}] ${senderName} (seq:${seq} ${time})`,
                    subNodes
                )
                mainNodes.push(subForward)
            }

            // 发送合并转发
            const sendResult = await this.sendForwardNodes(e, mainNodes)
            if (!sendResult) {
                // 回退：直接发送文本摘要
                const text = messages
                    .map(msg => {
                        const seq = msg.seq || '?'
                        const sender = msg.sender?.nickname || msg.user_id || '?'
                        const content = msg.raw_message || '[无法解析]'
                        return `[${seq}] ${sender}: ${content}`
                    })
                    .join('\n')
                await this.reply(`📋 前 ${messages.length} 条消息:\n${text}`, true)
            }
        } catch (error) {
            logger.error('[MessageInspector] inspectPreviousMessages Error:', error)
            await this.reply(`❌ 获取历史消息失败: ${error.message}`, true)
        }

        return true
    }

    /**
     * 按 seq 获取消息（明确按序列号）
     * 命令: #取$12345
     */
    async inspectBySeq() {
        const e = this.e
        const bot = e.bot || Bot

        const match = e.msg.match(/#取\$(\d+)/)
        if (!match || !match[1]) {
            await this.reply('❌ 请提供消息seq，如: #取$12345', true)
            return true
        }

        const targetSeq = parseInt(match[1])

        try {
            const rawMsg = await this.fetchMessage(bot, e, targetSeq, null)

            if (!rawMsg) {
                await this.reply(`❌ 未找到 seq=${targetSeq} 的消息`, true)
                return true
            }

            const fullData = await this.parseMessageComplete(e, rawMsg, { maxDepth: 10 })
            await this.sendNestedForward(e, fullData)
        } catch (error) {
            logger.error('[MessageInspector] inspectBySeq Error:', error)
            await this.reply(`❌ 获取消息失败: ${error.message}`, true)
        }

        return true
    }

    /**
     * 完整解析消息（包括 proto 反序列化和深度递归转发）
     */
    async parseMessageComplete(e, rawMsg, options = {}) {
        const { maxDepth = 10, currentDepth = 0 } = options
        const bot = e.bot || Bot

        const result = {
            // 基础信息
            message_id: rawMsg.message_id || rawMsg.id || null,
            seq: rawMsg.seq || null,
            rand: rawMsg.rand || null,
            time: rawMsg.time || null,
            user_id: rawMsg.user_id || rawMsg.sender?.user_id || null,
            sender: rawMsg.sender || null,
            group_id: rawMsg.group_id || null,
            // 消息内容
            message: rawMsg.message || rawMsg.content || [],
            raw_message: rawMsg.raw_message || null,
            // icqq 特有
            font: rawMsg.font || null,
            pktnum: rawMsg.pktnum || null,
            atme: rawMsg.atme || null,
            atall: rawMsg.atall || null,
            // proto 相关
            proto: null,
            protoDecoded: null,
            serialized: null,
            pb: null,
            elems: null,
            parsed: null,
            msgrecord: null,
            // 转发消息
            isForward: false,
            forwardMessages: null
        }

        // 1. 提取 proto 数据
        result.proto = IcqqMessageUtils.extractProto(rawMsg)

        // 2. 尝试序列化消息
        const serialized = IcqqMessageUtils.serializeMessage(rawMsg)
        if (serialized) {
            result.serialized = serialized.toString('base64')
            // 尝试解码 proto
            const decoded = ProtobufUtils.safeDecode(serialized)
            if (decoded) {
                result.protoDecoded = decoded
            }
        }

        // 3. 提取 raw buffer (pb 原始数据)
        if (rawMsg.raw) {
            if (Buffer.isBuffer(rawMsg.raw)) {
                result.pb = {
                    hex: rawMsg.raw.toString('hex'),
                    base64: rawMsg.raw.toString('base64'),
                    length: rawMsg.raw.length
                }
                // 尝试解码 pb
                const pbDecoded = ProtobufUtils.safeDecode(rawMsg.raw)
                if (pbDecoded) {
                    result.pb.decoded = pbDecoded
                }
            } else {
                result.pb = rawMsg.raw
            }
        }

        // 4. 提取 elems 数据
        if (rawMsg.elems) {
            result.elems = rawMsg.elems
        }

        // 5. 提取 parsed 数据
        if (rawMsg.parsed) {
            result.parsed = {
                brief: rawMsg.parsed.brief,
                content: rawMsg.parsed.content,
                atme: rawMsg.parsed.atme,
                atall: rawMsg.parsed.atall,
                quotation: rawMsg.parsed.quotation
            }
        }

        // 6. 添加 msgrecord
        result.msgrecord = MsgRecordExtractor.fromApiResponse(rawMsg)

        // 7. 检查并深度解析转发消息
        const message = result.message || []
        for (const seg of message) {
            const segType = seg.type || seg.data?._type
            if (segType === 'forward') {
                result.isForward = true
                if (currentDepth < maxDepth) {
                    result.forwardMessages = await this.parseForwardDeep(e, seg, {
                        maxDepth,
                        currentDepth: currentDepth + 1
                    })
                }
                break
            }
            if (segType === 'json') {
                try {
                    const jsonStr = seg.data?.data || seg.data
                    const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
                    if (jsonData?.app === 'com.tencent.multimsg' && jsonData?.meta?.detail?.resid) {
                        result.isForward = true
                        if (currentDepth < maxDepth) {
                            result.forwardMessages = await this.parseForwardDeep(e, jsonData.meta.detail.resid, {
                                maxDepth,
                                currentDepth: currentDepth + 1
                            })
                        }
                        break
                    }
                } catch {}
            }
        }

        return result
    }

    /**
     * 深度递归解析转发消息
     */
    async parseForwardDeep(e, forwardElement, options = {}) {
        const { maxDepth = 10, currentDepth = 0 } = options
        const bot = e.bot || Bot

        const result = {
            success: false,
            messages: [],
            totalCount: 0,
            method: 'unknown',
            proto: null,
            raw: null,
            errors: []
        }

        if (currentDepth >= maxDepth) {
            result.errors.push(`达到最大递归深度 ${maxDepth}`)
            return result
        }

        try {
            // 获取 resid
            const resid =
                typeof forwardElement === 'string'
                    ? forwardElement
                    : forwardElement?.id ||
                      forwardElement?.data?.id ||
                      forwardElement?.resid ||
                      forwardElement?.data?.resid

            let forwardMessages = null
            let rawData = null

            // 方式1: 直接从元素中获取内容
            if (forwardElement?.data?.content && Array.isArray(forwardElement.data.content)) {
                forwardMessages = forwardElement.data.content
                result.method = 'element.data.content'
                rawData = forwardElement
            } else if (forwardElement?.content && Array.isArray(forwardElement.content)) {
                forwardMessages = forwardElement.content
                result.method = 'element.content'
                rawData = forwardElement
            }

            // 方式2: 通过 API 获取
            if (!forwardMessages && resid) {
                // icqq: group.getForwardMsg
                if (e.group?.getForwardMsg) {
                    try {
                        const fwdResult = await e.group.getForwardMsg(resid)
                        if (fwdResult) {
                            forwardMessages = Array.isArray(fwdResult) ? fwdResult : [fwdResult]
                            result.method = 'group.getForwardMsg'
                            rawData = fwdResult
                        }
                    } catch (err) {
                        result.errors.push(`group.getForwardMsg: ${err.message}`)
                    }
                }

                // bot.getForwardMsg
                if (!forwardMessages && bot?.getForwardMsg) {
                    try {
                        const fwdResult = await bot.getForwardMsg(resid)
                        if (fwdResult) {
                            forwardMessages = Array.isArray(fwdResult) ? fwdResult : [fwdResult]
                            result.method = 'bot.getForwardMsg'
                            rawData = fwdResult
                        }
                    } catch (err) {
                        result.errors.push(`bot.getForwardMsg: ${err.message}`)
                    }
                }

                // NapCat/OneBot: sendApi get_forward_msg
                if (!forwardMessages && bot?.sendApi) {
                    try {
                        const apiResult = await bot.sendApi('get_forward_msg', { id: resid })
                        const messages =
                            apiResult?.message ||
                            apiResult?.data?.messages ||
                            apiResult?.messages ||
                            apiResult?.data?.message
                        if (messages && Array.isArray(messages)) {
                            forwardMessages = messages
                            result.method = 'sendApi.get_forward_msg'
                            rawData = apiResult
                        }
                    } catch (err) {
                        result.errors.push(`sendApi.get_forward_msg: ${err.message}`)
                    }
                }
            }

            if (!forwardMessages || !Array.isArray(forwardMessages)) {
                result.errors.push('无法获取转发消息内容')
                return result
            }

            result.success = true
            result.totalCount = forwardMessages.length
            result.raw = rawData

            // 解析每条消息（深度递归）
            for (const msg of forwardMessages) {
                const msgData = msg.data || msg
                const parsedMsg = {
                    user_id: msgData.user_id || msgData.uin || msgData.sender?.user_id || 0,
                    nickname: msgData.nickname || msgData.nick || msgData.sender?.nickname || '',
                    time: msgData.time || 0,
                    group_id: msgData.group_id || null,
                    seq: msgData.seq || 0,
                    message: msgData.content || msgData.message || [],
                    raw_message: msgData.raw_message || '',
                    proto: null,
                    serialized: null,
                    protoDecoded: null,
                    nestedForward: null
                }

                // 提取 proto 数据
                parsedMsg.proto = IcqqMessageUtils.extractProto(msg)
                if (!parsedMsg.proto && msg.proto) {
                    parsedMsg.proto = msg.proto
                }

                // 提取序列化数据
                const serialized = IcqqMessageUtils.serializeForwardMessage(msg)
                if (serialized) {
                    parsedMsg.serialized = serialized.toString('base64')
                    const decoded = ProtobufUtils.safeDecode(serialized)
                    if (decoded) {
                        parsedMsg.protoDecoded = decoded
                    }
                }

                // 检查嵌套转发（递归解析）
                const messageContent = parsedMsg.message
                if (Array.isArray(messageContent)) {
                    for (const elem of messageContent) {
                        const elemType = elem.type || elem.data?._type
                        if (elemType === 'forward') {
                            parsedMsg.nestedForward = await this.parseForwardDeep(e, elem, {
                                maxDepth,
                                currentDepth: currentDepth + 1
                            })
                            break
                        }
                        if (elemType === 'json') {
                            try {
                                const jsonStr = elem.data?.data || elem.data
                                const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
                                if (jsonData?.app === 'com.tencent.multimsg' && jsonData?.meta?.detail?.resid) {
                                    parsedMsg.nestedForward = await this.parseForwardDeep(
                                        e,
                                        jsonData.meta.detail.resid,
                                        { maxDepth, currentDepth: currentDepth + 1 }
                                    )
                                    break
                                }
                            } catch {}
                        }
                    }
                }

                result.messages.push(parsedMsg)
            }
        } catch (err) {
            result.errors.push(`解析异常: ${err.message}`)
            logger.warn('[MessageInspector] parseForwardDeep failed:', err)
        }

        return result
    }

    /**
     * 构建消息检查的详情节点列表（可复用）
     */
    async buildInspectNodes(e, data) {
        const bot = e.bot || Bot
        const botId = bot?.uin || e.self_id || 10000

        const nodes = []

        // 1. 基础信息节点
        const basicInfo = {
            message_id: data.message_id,
            seq: data.seq,
            rand: data.rand,
            time: data.time,
            user_id: data.user_id,
            group_id: data.group_id,
            sender: data.sender,
            raw_message: data.raw_message
        }
        nodes.push(this.createTextNode(botId, '📋 基础信息', this.safeStringify(basicInfo)))

        // 2. 消息段节点
        if (data.message?.length > 0) {
            const msgStr = this.safeStringify(data.message)
            if (msgStr.length > 3000) {
                nodes.push(await this.wrapInForward(e, '💬 消息段', this.chunkString(msgStr, 2500)))
            } else {
                nodes.push(this.createTextNode(botId, '💬 消息段', msgStr))
            }
        }

        // 3. icqq 特有字段
        const icqqFields = { font: data.font, pktnum: data.pktnum, atme: data.atme, atall: data.atall }
        if (Object.values(icqqFields).some(v => v !== null)) {
            nodes.push(this.createTextNode(botId, '🎲 icqq字段', this.safeStringify(icqqFields)))
        }

        // 4. elems 数据
        if (data.elems) {
            const elemsStr = this.safeStringify(data.elems)
            if (elemsStr.length > 3000) {
                nodes.push(await this.wrapInForward(e, '📦 elems', this.chunkString(elemsStr, 2500)))
            } else {
                nodes.push(this.createTextNode(botId, '📦 elems', elemsStr))
            }
        }

        // 5. parsed 数据
        if (data.parsed) {
            nodes.push(this.createTextNode(botId, '📝 parsed', this.safeStringify(data.parsed)))
        }

        // 6. pb 数据
        if (data.pb) {
            const pbNodes = []
            if (typeof data.pb === 'object') {
                pbNodes.push(`长度: ${data.pb.length || 'N/A'} bytes`)
                if (data.pb.base64) {
                    pbNodes.push(`\nBase64:\n${data.pb.base64}`)
                }
                if (data.pb.decoded) {
                    const decodedStr = this.safeStringify(data.pb.decoded)
                    pbNodes.push(`\n解码结果:\n${decodedStr.substring(0, 2000)}`)
                }
            } else {
                pbNodes.push(this.safeStringify(data.pb))
            }
            const pbContent = pbNodes.join('')
            if (pbContent.length > 3000) {
                nodes.push(await this.wrapInForward(e, '📦 pb数据', this.chunkString(pbContent, 2500)))
            } else {
                nodes.push(this.createTextNode(botId, '📦 pb数据', pbContent))
            }
        }

        // 7. proto 数据
        if (data.proto) {
            const protoStr = this.safeStringify(data.proto)
            if (protoStr.length > 3000) {
                nodes.push(await this.wrapInForward(e, '📦 proto', this.chunkString(protoStr, 2500)))
            } else {
                nodes.push(this.createTextNode(botId, '📦 proto', protoStr))
            }
        }

        // 8. protoDecoded 数据
        if (data.protoDecoded) {
            const decodedStr = this.safeStringify(data.protoDecoded)
            if (decodedStr.length > 3000) {
                nodes.push(await this.wrapInForward(e, '🔓 proto解码', this.chunkString(decodedStr, 2500)))
            } else {
                nodes.push(this.createTextNode(botId, '🔓 proto解码', decodedStr))
            }
        }

        // 9. serialized 数据
        if (data.serialized) {
            nodes.push(this.createTextNode(botId, '📦 serialized', data.serialized))
        }

        // 10. msgrecord
        if (data.msgrecord) {
            nodes.push(this.createTextNode(botId, '📋 msgrecord', this.safeStringify(data.msgrecord)))
        }

        // 11. 转发消息（深度递归）
        if (data.isForward && data.forwardMessages) {
            const forwardNode = await this.buildForwardDataNode(e, data.forwardMessages, 0)
            if (forwardNode) {
                nodes.push(forwardNode)
            }
        }

        return nodes
    }

    /**
     * 使用嵌套合并转发发送数据
     * 太长的数据会被包裹到子合并转发中
     */
    async sendNestedForward(e, data) {
        const mainNodes = await this.buildInspectNodes(e, data)

        // 发送合并转发
        const sendResult = await this.sendForwardNodes(e, mainNodes)
        if (!sendResult) {
            // 回退到普通消息
            const basicInfo = {
                message_id: data.message_id,
                seq: data.seq,
                time: data.time,
                user_id: data.user_id
            }
            await this.reply(
                `📋 消息数据 (seq: ${data.seq})\n${this.safeStringify(basicInfo).substring(0, 1000)}`,
                true
            )
        }
    }

    /**
     * 构建转发数据节点（递归）
     */
    async buildForwardDataNode(e, forwardData, depth) {
        const bot = e.bot || Bot
        const botId = bot?.uin || e.self_id || 10000

        if (!forwardData?.success) {
            return this.createTextNode(
                botId,
                '📨 转发消息',
                `解析失败: ${forwardData?.errors?.join(', ') || '未知错误'}`
            )
        }

        const subNodes = []
        subNodes.push(
            this.createTextNode(
                botId,
                '📨 转发概览',
                `共 ${forwardData.totalCount} 条消息\n获取方式: ${forwardData.method}\n深度: ${depth}`
            )
        )

        // 添加每条消息
        for (let i = 0; i < forwardData.messages.length; i++) {
            const msg = forwardData.messages[i]
            const msgNodes = []

            // 消息基本信息
            const msgInfo = {
                user_id: msg.user_id,
                nickname: msg.nickname,
                time: msg.time,
                seq: msg.seq,
                message: msg.message,
                raw_message: msg.raw_message
            }
            msgNodes.push(this.safeStringify(msgInfo))

            // proto 数据
            if (msg.proto) {
                msgNodes.push(`\n\n📦 proto:\n${this.safeStringify(msg.proto).substring(0, 1500)}`)
            }

            // protoDecoded 数据
            if (msg.protoDecoded) {
                msgNodes.push(`\n\n🔓 proto解码:\n${this.safeStringify(msg.protoDecoded).substring(0, 1500)}`)
            }

            // serialized 数据
            if (msg.serialized) {
                msgNodes.push(`\n\n📦 serialized:\n${msg.serialized.substring(0, 500)}`)
            }

            const msgContent = msgNodes.join('')
            if (msgContent.length > 3000) {
                subNodes.push(
                    await this.wrapInForward(e, `消息[${i + 1}] ${msg.nickname}`, this.chunkString(msgContent, 2500))
                )
            } else {
                subNodes.push(this.createTextNode(botId, `消息[${i + 1}] ${msg.nickname}`, msgContent))
            }

            // 嵌套转发（递归）
            if (msg.nestedForward?.success) {
                const nestedNode = await this.buildForwardDataNode(e, msg.nestedForward, depth + 1)
                if (nestedNode) {
                    subNodes.push(nestedNode)
                }
            }
        }

        // 包裹为子合并转发
        return this.createForwardNode(e, `📨 转发消息 (${forwardData.totalCount}条)`, subNodes)
    }

    /**
     * 创建文本消息节点
     */
    createTextNode(botId, title, content) {
        return {
            user_id: botId,
            nickname: title,
            message: [{ type: 'text', text: content }]
        }
    }

    /**
     * 将长文本包裹到子合并转发中
     */
    async wrapInForward(e, title, chunks) {
        const bot = e.bot || Bot
        const botId = bot?.uin || e.self_id || 10000

        const chunkArray = Array.isArray(chunks) ? chunks : [chunks]
        const subNodes = chunkArray.map((chunk, i) => ({
            user_id: botId,
            nickname: `${title} [${i + 1}/${chunkArray.length}]`,
            message: [{ type: 'text', text: chunk }]
        }))

        return this.createForwardNode(e, title, subNodes)
    }

    /**
     * 创建合并转发节点
     */
    async createForwardNode(e, title, nodes) {
        const bot = e.bot || Bot
        const botId = bot?.uin || e.self_id || 10000

        try {
            // 尝试使用 makeForwardMsg 创建嵌套转发
            if (e.group?.makeForwardMsg) {
                const forwardMsg = await e.group.makeForwardMsg(nodes)
                if (forwardMsg) {
                    return {
                        user_id: botId,
                        nickname: title,
                        message: forwardMsg
                    }
                }
            }

            const group = bot.pickGroup?.(e.group_id)
            if (group?.makeForwardMsg) {
                const forwardMsg = await group.makeForwardMsg(nodes)
                if (forwardMsg) {
                    return {
                        user_id: botId,
                        nickname: title,
                        message: forwardMsg
                    }
                }
            }
        } catch (err) {
            logger.debug('[MessageInspector] createForwardNode failed:', err.message)
        }

        // 回退：将节点内容合并为单条消息
        const combined = nodes
            .map(n => {
                const text = n.message?.[0]?.text || n.message || ''
                return `【${n.nickname}】\n${typeof text === 'string' ? text.substring(0, 500) : JSON.stringify(text).substring(0, 500)}`
            })
            .join('\n\n')

        return {
            user_id: botId,
            nickname: title,
            message: [{ type: 'text', text: combined.substring(0, 4000) }]
        }
    }

    /**
     * 发送合并转发节点
     */
    async sendForwardNodes(e, nodes) {
        const bot = e.bot || Bot

        try {
            // TRSS 框架
            if (getFramework() === 'trss') {
                if (e.isGroup && e.group?.makeForwardMsg) {
                    const forwardMsg = await e.group.makeForwardMsg(nodes)
                    if (forwardMsg) {
                        await e.group.sendMsg(forwardMsg)
                        return true
                    }
                } else if (!e.isGroup && e.friend?.makeForwardMsg) {
                    const forwardMsg = await e.friend.makeForwardMsg(nodes)
                    if (forwardMsg) {
                        await e.friend.sendMsg(forwardMsg)
                        return true
                    }
                }
            }

            // Miao-Yunzai / icqq
            if (e.isGroup || e.group_id) {
                const group = bot.pickGroup(e.group_id)
                if (group?.makeForwardMsg) {
                    const forwardMsg = await group.makeForwardMsg(nodes)
                    if (forwardMsg) {
                        await group.sendMsg(forwardMsg)
                        return true
                    }
                }
            } else {
                const friend = bot.pickFriend(e.user_id)
                if (friend?.makeForwardMsg) {
                    const forwardMsg = await friend.makeForwardMsg(nodes)
                    if (forwardMsg) {
                        await friend.sendMsg(forwardMsg)
                        return true
                    }
                }
            }

            // Bot.makeForwardMsg
            if (typeof Bot?.makeForwardMsg === 'function') {
                const forwardMsg = await Bot.makeForwardMsg(nodes)
                await this.reply(forwardMsg)
                return true
            }

            return false
        } catch (err) {
            logger.warn('[MessageInspector] sendForwardNodes failed:', err.message)
            return false
        }
    }

    /**
     * 获取消息
     */
    async fetchMessage(bot, e, targetSeq, targetMsgId) {
        let rawMsg = null

        if (e.group_id) {
            const group = bot.pickGroup(e.group_id)

            // icqq: group.getMsg
            if (!rawMsg && group?.getMsg) {
                try {
                    rawMsg = await group.getMsg(targetSeq || targetMsgId)
                } catch {}
            }

            // icqq: group.getChatHistory
            if (!rawMsg && group?.getChatHistory && targetSeq) {
                try {
                    const history = await group.getChatHistory(targetSeq, 1)
                    rawMsg = history?.[0]
                } catch {}
            }

            // NapCat/OneBot: bot.getMsg
            if (!rawMsg && bot?.getMsg) {
                try {
                    rawMsg = await bot.getMsg(targetMsgId || targetSeq)
                } catch {}
            }

            // NapCat: sendApi
            if (!rawMsg && bot?.sendApi) {
                try {
                    const result = await bot.sendApi('get_msg', { message_id: targetMsgId || targetSeq })
                    rawMsg = result?.data || result
                } catch {}
            }
        } else {
            const friend = bot.pickFriend(e.user_id)

            if (!rawMsg && friend?.getMsg) {
                try {
                    rawMsg = await friend.getMsg(targetSeq || targetMsgId)
                } catch {}
            }

            if (!rawMsg && friend?.getChatHistory) {
                try {
                    const history = await friend.getChatHistory(targetSeq, 1)
                    rawMsg = history?.[0]
                } catch {}
            }

            if (!rawMsg && bot?.getMsg) {
                try {
                    rawMsg = await bot.getMsg(targetMsgId || targetSeq)
                } catch {}
            }
        }

        return rawMsg
    }

    /**
     * 分割长字符串
     */
    chunkString(str, size) {
        const chunks = []
        for (let i = 0; i < str.length; i += size) {
            chunks.push(str.substring(i, i + size))
        }
        return chunks
    }

    /**
     * 安全的 JSON 序列化（处理 BigInt 和 Buffer）
     */
    safeStringify(obj, space = 2) {
        return JSON.stringify(
            obj,
            (key, value) => {
                if (typeof value === 'bigint') {
                    return value.toString()
                }
                if (Buffer.isBuffer(value)) {
                    return `[Buffer: ${value.length} bytes]`
                }
                if (key === '_event' || key === '_raw') {
                    return undefined
                }
                return value
            },
            space
        )
    }

    /**
     * 渲染消息详情为图片
     */
    async renderMessageDetails(result, rawMsg) {
        const markdown = [
            `## 📝 消息详情`,
            ``,
            `### 📋 基本信息`,
            `| 项目 | 数值 |`,
            `|------|------|`,
            `| 🖥️ 框架 | ${result.framework} |`,
            `| 🔌 适配器 | ${result.adapter} |`,
            `| 🔢 Seq | ${rawMsg.seq || 'N/A'} |`,
            `| 🆔 消息ID | ${rawMsg.message_id || rawMsg.id || 'N/A'} |`,
            `| ⏰ 时间 | ${rawMsg.time ? formatTimeToBeiJing(rawMsg.time) : 'N/A'} |`,
            `| 👤 发送者 | ${rawMsg.sender?.nickname || rawMsg.sender?.card || 'N/A'} |`,
            `| 🆔 发送者ID | ${rawMsg.sender?.user_id || 'N/A'} |`,
            rawMsg.group_id ? `| 👥 群号 | ${rawMsg.group_id} |` : '',
            ``,
            `### 💬 消息内容`,
            '```',
            rawMsg.raw_message || '(无)',
            '```',
            ``,
            `### 📦 消息段`,
            '```json',
            JSON.stringify(rawMsg.message || [], null, 2).substring(0, 800),
            '```'
        ].filter(Boolean)

        // icqq 特有字段
        if (rawMsg.rand !== undefined || rawMsg.font !== undefined) {
            markdown.push(``, `### 🎲 icqq 特有字段`)
            markdown.push(`- **Rand:** ${rawMsg.rand ?? 'N/A'}`)
            markdown.push(`- **Font:** ${rawMsg.font ?? 'N/A'}`)
            markdown.push(`- **PktNum:** ${rawMsg.pktnum ?? 'N/A'}`)
        }

        // PB 数据
        if (result.pb?.exists) {
            markdown.push(``, `### 📦 PB 原始数据`)
            markdown.push(`- **类型:** ${result.pb.type}`)
            markdown.push(`- **是否Buffer:** ${result.pb.isBuffer}`)
            markdown.push(`- **长度:** ${result.pb.length} bytes`)
        }

        // 查询方法
        markdown.push(``, `### 🛠️ 查询方法`)
        result.methods.forEach(m => {
            markdown.push(`- ${m.success ? '✅' : '❌'} **${m.name}**${m.error ? ` - ${m.error}` : ''}`)
        })

        return renderService.renderMarkdownToImage({
            markdown: markdown.join('\n'),
            title: '消息检查器',
            subtitle: `Seq: ${rawMsg.seq || 'N/A'}`,
            icon: '🔍',
            showTimestamp: true
        })
    }

    /**
     * 构建合并转发消息
     */
    async buildForwardMessages(e, result, rawMsg) {
        const msgs = []
        const botId = e.bot?.uin || e.self_id || Bot?.uin || 10000
        const nickname = '消息检查器'

        // 1. 基本信息
        const basicInfo = [
            '📋 基本信息',
            '━━━━━━━━━━━━━━━━',
            `🖥️ 框架: ${result.framework}`,
            `🔌 适配器: ${result.adapter}`,
            `🔢 Seq: ${rawMsg.seq || 'N/A'}`,
            `🆔 消息ID: ${rawMsg.message_id || rawMsg.id || 'N/A'}`,
            `⏰ 时间: ${rawMsg.time ? formatTimeToBeiJing(rawMsg.time) : 'N/A'}`,
            `👤 发送者: ${rawMsg.sender?.nickname || rawMsg.sender?.card || rawMsg.sender?.user_id || 'N/A'}`,
            `🆔 发送者ID: ${rawMsg.sender?.user_id || 'N/A'}`,
            rawMsg.group_id ? `👥 群号: ${rawMsg.group_id}` : '',
            '━━━━━━━━━━━━━━━━'
        ]
            .filter(Boolean)
            .join('\n')
        msgs.push(basicInfo)

        // 2. 消息内容
        const contentInfo = [
            '💬 消息内容',
            '━━━━━━━━━━━━━━━━',
            `原始文本: ${rawMsg.raw_message || '(无)'}`,
            '',
            '消息段:',
            JSON.stringify(rawMsg.message || [], null, 2)
        ].join('\n')
        msgs.push(contentInfo)

        // 3. icqq 特有字段
        if (rawMsg.rand !== undefined || rawMsg.font !== undefined || rawMsg.pktnum !== undefined) {
            const icqqInfo = [
                '🎲 icqq 特有字段',
                '━━━━━━━━━━━━━━━━',
                `Rand: ${rawMsg.rand ?? 'N/A'}`,
                `Font: ${rawMsg.font ?? 'N/A'}`,
                `PktNum: ${rawMsg.pktnum ?? 'N/A'}`,
                `Atme: ${rawMsg.atme ?? 'N/A'}`,
                `Atall: ${rawMsg.atall ?? 'N/A'}`
            ].join('\n')
            msgs.push(icqqInfo)
        }

        // 4. PB 数据
        if (result.pb?.exists) {
            const pbInfo = [
                '📦 PB 原始数据',
                '━━━━━━━━━━━━━━━━',
                `类型: ${result.pb.type}`,
                `是否Buffer: ${result.pb.isBuffer}`,
                `长度: ${result.pb.length} bytes`,
                '',
                'HEX (前500字符):',
                (result.pb.hex || '').substring(0, 500) + (result.pb.hex?.length > 500 ? '...' : '')
            ].join('\n')
            msgs.push(pbInfo)

            // Base64 单独一条
            if (result.pb.base64) {
                msgs.push(`📦 PB Base64 数据:\n${result.pb.base64}`)
            }
        }

        // 5. 查询方法记录
        const methodsInfo = [
            '🛠️ 查询方法',
            '━━━━━━━━━━━━━━━━',
            ...result.methods.map(m => `${m.success ? '✅' : '❌'} ${m.name}${m.error ? ` (${m.error})` : ''}`)
        ].join('\n')
        msgs.push(methodsInfo)

        // 6. 完整JSON
        const fullJson = JSON.stringify(
            {
                ...rawMsg,
                raw: result.pb?.exists ? '[Buffer]' : undefined // 不序列化 Buffer
            },
            null,
            2
        )
        msgs.push(`📄 完整 JSON:\n${fullJson}`)

        return msgs
    }

    /**
     * 发送合并转发消息
     */
    async sendForwardMsg(e, title, messages) {
        const bot = e.bot || Bot
        const botId = bot?.uin || e.self_id || 10000
        const nickname = title

        try {
            // 构建转发节点
            const forwardNodes = messages.map(msg => ({
                user_id: botId,
                nickname: nickname,
                message: typeof msg === 'string' ? [{ type: 'text', text: msg }] : msg
            }))

            // TRSS 框架
            if (getFramework() === 'trss') {
                if (e.isGroup && e.group?.makeForwardMsg) {
                    const forwardMsg = await e.group.makeForwardMsg(forwardNodes)
                    if (forwardMsg) {
                        await e.group.sendMsg(forwardMsg)
                        return true
                    }
                } else if (!e.isGroup && e.friend?.makeForwardMsg) {
                    const forwardMsg = await e.friend.makeForwardMsg(forwardNodes)
                    if (forwardMsg) {
                        await e.friend.sendMsg(forwardMsg)
                        return true
                    }
                }
            }

            // Miao-Yunzai / icqq
            if (e.isGroup || e.group_id) {
                const group = bot.pickGroup(e.group_id)
                if (group?.makeForwardMsg) {
                    const forwardMsg = await group.makeForwardMsg(forwardNodes)
                    if (forwardMsg) {
                        await group.sendMsg(forwardMsg)
                        return true
                    }
                }
            } else {
                const friend = bot.pickFriend(e.user_id)
                if (friend?.makeForwardMsg) {
                    const forwardMsg = await friend.makeForwardMsg(forwardNodes)
                    if (forwardMsg) {
                        await friend.sendMsg(forwardMsg)
                        return true
                    }
                }
            }

            // 尝试使用 Bot.makeForwardMsg
            if (typeof Bot?.makeForwardMsg === 'function') {
                const forwardMsg = await Bot.makeForwardMsg(forwardNodes)
                await this.reply(forwardMsg)
                return true
            }

            return false
        } catch (err) {
            logger.warn('[MessageInspector] 发送合并转发失败:', err.message)
            return false
        }
    }

    /**
     * 发送回退简要信息
     */
    async sendFallbackReply(result, rawMsg) {
        const output = [
            '📝 消息详情 (简要)',
            '━━━━━━━━━━━━━━━━',
            `框架: ${result.framework}`,
            `适配器: ${result.adapter}`,
            `Seq: ${rawMsg.seq || 'N/A'}`,
            `消息ID: ${rawMsg.message_id || rawMsg.id || 'N/A'}`,
            `时间: ${rawMsg.time ? formatTimeToBeiJing(rawMsg.time) : 'N/A'}`,
            `发送者: ${rawMsg.sender?.nickname || rawMsg.sender?.user_id || 'N/A'}`,
            '━━━━━━━━━━━━━━━━',
            `内容: ${(rawMsg.raw_message || '').substring(0, 200)}`,
            result.pb?.exists ? `\nPB数据: ✅ ${result.pb.length} bytes` : '',
            '━━━━━━━━━━━━━━━━',
            '(合并转发发送失败，显示简要信息)',
            '完整数据已输出到控制台'
        ]
            .filter(Boolean)
            .join('\n')

        await this.reply(output, true)

        // 输出完整信息到控制台
        logger.info(
            '[MessageInspector] 完整消息数据:',
            JSON.stringify(
                result,
                (key, value) => {
                    if (Buffer.isBuffer(value)) {
                        return `[Buffer: ${value.length} bytes]`
                    }
                    return value
                },
                2
            )
        )
    }

    /**
     * 显示统计信息（图片版）
     */
    async showStats() {
        await this.reply('📊 正在生成统计信息...', true)

        try {
            const stats = statsService.getOverview()
            const imageBuffer = await this.renderStatsImage(stats)
            await this.reply(segment.image(imageBuffer))
        } catch (err) {
            logger.error('[MessageInspector] 生成统计失败:', err)
            // 回退到文本版
            await this.showStatsText()
        }
        return true
    }

    /**
     * 显示详细统计（合并转发）
     */
    async showDetailedStats() {
        const stats = statsService.getOverview()
        const msgs = []

        // 1. 概览
        msgs.push(
            [
                '📊 AI 统计概览',
                '━━━━━━━━━━━━━━━━',
                `🕐 运行时间: ${stats.uptime.days}天${stats.uptime.hours}小时`,
                `📨 消息总数: ${stats.messages.total}`,
                `💬 对话数: ${stats.messages.conversations}`,
                `🤖 模型调用: ${stats.models.totalCalls}`,
                `🔧 工具调用: ${stats.tools.totalCalls}`,
                `📝 Tokens: ${this.formatNumber(stats.tokens.totalSum)}`
            ].join('\n')
        )

        // 2. 消息类型分布
        if (Object.keys(stats.messages.types).length > 0) {
            const typeLines = Object.entries(stats.messages.types)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => `  ${type}: ${count}`)
            msgs.push(['📝 消息类型分布', '━━━━━━━━━━━━━━━━', ...typeLines].join('\n'))
        }

        // 3. 模型使用统计
        if (stats.models.byModel.length > 0) {
            const modelLines = stats.models.byModel
                .slice(0, 15)
                .map(
                    m =>
                        `  ${m.name.split('/').pop()}: ${m.calls}次 (${this.formatNumber(m.inputTokens + m.outputTokens)} tokens)`
                )
            msgs.push(['🤖 模型使用统计', '━━━━━━━━━━━━━━━━', ...modelLines].join('\n'))
        }

        // 4. Tokens 统计
        msgs.push(
            [
                '📊 Tokens 统计',
                '━━━━━━━━━━━━━━━━',
                `总输入: ${this.formatNumber(stats.tokens.total.input)}`,
                `总输出: ${this.formatNumber(stats.tokens.total.output)}`,
                `总计: ${this.formatNumber(stats.tokens.totalSum)}`
            ].join('\n')
        )

        // 5. 群组 Top 10
        if (stats.messages.topGroups.length > 0) {
            const groupLines = stats.messages.topGroups.map((g, i) => `  ${i + 1}. ${g.id}: ${g.count}条`)
            msgs.push(['👥 活跃群组 Top 10', '━━━━━━━━━━━━━━━━', ...groupLines].join('\n'))
        }

        // 6. 用户 Top 10
        if (stats.messages.topUsers.length > 0) {
            const userLines = stats.messages.topUsers.map((u, i) => `  ${i + 1}. ${u.id}: ${u.count}条`)
            msgs.push(['👤 活跃用户 Top 10', '━━━━━━━━━━━━━━━━', ...userLines].join('\n'))
        }

        // 7. 工具使用 Top 10
        if (stats.tools.byTool.length > 0) {
            const toolLines = stats.tools.byTool.slice(0, 10).map(t => `  ${t.name}: ${t.calls}次 (成功${t.success})`)
            msgs.push(['🔧 工具使用 Top 10', '━━━━━━━━━━━━━━━━', ...toolLines].join('\n'))
        }

        // 8. 小时分布
        if (Object.keys(stats.messages.hourlyDistribution).length > 0) {
            const hourLines = []
            for (let h = 0; h < 24; h++) {
                const count = stats.messages.hourlyDistribution[h] || 0
                if (count > 0) {
                    hourLines.push(`  ${String(h).padStart(2, '0')}:00 - ${count}条`)
                }
            }
            if (hourLines.length > 0) {
                msgs.push(['⏰ 消息时段分布', '━━━━━━━━━━━━━━━━', ...hourLines].join('\n'))
            }
        }

        const sendResult = await this.sendForwardMsg(this.e, 'AI 详细统计', msgs)
        if (!sendResult) {
            await this.reply(msgs.slice(0, 3).join('\n\n'))
        }
        return true
    }

    /**
     * 显示调试信息
     */
    async showDebugInfo() {
        const e = this.e
        const bot = e.bot || Bot

        const framework = getBotFramework()
        const adapter = getAdapter(e)

        // 收集调试信息
        const debugInfo = {
            framework,
            adapter,
            bot: {
                uin: bot?.uin,
                nickname: bot?.nickname,
                status: bot?.status,
                fl: bot?.fl?.size || 0,
                gl: bot?.gl?.size || 0
            },
            event: {
                message_type: e.message_type,
                sub_type: e.sub_type,
                message_id: e.message_id,
                user_id: e.user_id,
                group_id: e.group_id,
                self_id: e.self_id,
                atBot: e.atBot,
                atme: e.atme,
                hasReply: !!e.source
            },
            sender: e.sender,
            message: e.message,
            raw_message: e.raw_message
        }

        // 内存使用
        const memUsage = process.memoryUsage()
        debugInfo.memory = {
            rss: this.formatBytes(memUsage.rss),
            heapUsed: this.formatBytes(memUsage.heapUsed),
            heapTotal: this.formatBytes(memUsage.heapTotal)
        }

        // 统计概览
        const stats = statsService.getOverview()
        debugInfo.stats = {
            messages: stats.messages.total,
            modelCalls: stats.models.totalCalls,
            toolCalls: stats.tools.totalCalls,
            tokens: stats.tokens.totalSum
        }

        try {
            const markdown = [
                `## 🔧 Debug 信息`,
                ``,
                `### 📋 环境信息`,
                `| 项目 | 数值 |`,
                `|------|------|`,
                `| 框架 | ${framework} |`,
                `| 适配器 | ${adapter} |`,
                `| Bot QQ | ${debugInfo.bot.uin || 'N/A'} |`,
                `| 好友数 | ${debugInfo.bot.fl} |`,
                `| 群数 | ${debugInfo.bot.gl} |`,
                ``,
                `### 📨 当前事件`,
                `| 项目 | 数值 |`,
                `|------|------|`,
                `| 类型 | ${debugInfo.event.message_type} |`,
                `| 用户 | ${debugInfo.event.user_id} |`,
                `| 群号 | ${debugInfo.event.group_id || '私聊'} |`,
                `| @Bot | ${debugInfo.event.atBot ? '是' : '否'} |`,
                ``,
                `### 💾 内存使用`,
                `| 项目 | 数值 |`,
                `|------|------|`,
                `| RSS | ${debugInfo.memory.rss} |`,
                `| Heap Used | ${debugInfo.memory.heapUsed} |`,
                `| Heap Total | ${debugInfo.memory.heapTotal} |`,
                ``,
                `### 📊 统计概览`,
                `| 项目 | 数值 |`,
                `|------|------|`,
                `| 消息 | ${debugInfo.stats.messages} |`,
                `| 模型调用 | ${debugInfo.stats.modelCalls} |`,
                `| 工具调用 | ${debugInfo.stats.toolCalls} |`,
                `| Tokens | ${this.formatNumber(debugInfo.stats.tokens)} |`
            ]

            const imageBuffer = await renderService.renderMarkdownToImage({
                markdown: markdown.join('\n'),
                title: 'Debug 信息',
                icon: '🔧',
                showTimestamp: true
            })
            await this.reply(segment.image(imageBuffer))
        } catch (err) {
            // 文本回退
            await this.reply(
                [
                    '🔧 Debug 信息',
                    '━━━━━━━━━━━━━━━━',
                    `框架: ${framework}`,
                    `适配器: ${adapter}`,
                    `Bot: ${debugInfo.bot.uin}`,
                    `内存: ${debugInfo.memory.heapUsed}`,
                    `消息: ${debugInfo.stats.messages}`,
                    `模型调用: ${debugInfo.stats.modelCalls}`,
                    `Tokens: ${this.formatNumber(debugInfo.stats.tokens)}`
                ].join('\n'),
                true
            )
        }
        return true
    }

    /**
     * 重置统计
     */
    async resetStats() {
        statsService.reset()
        await this.reply('✅ 统计数据已重置', true)
        return true
    }

    /**
     * 渲染统计图片
     */
    async renderStatsImage(stats) {
        const markdown = [
            `## 📊 AI 使用统计`,
            ``,
            `### 📋 概览`,
            `| 项目 | 数值 |`,
            `|------|------|`,
            `| 🕐 运行时间 | ${stats.uptime.days}天${stats.uptime.hours}小时 |`,
            `| 📨 消息总数 | ${stats.messages.total} |`,
            `| 💬 对话数 | ${stats.messages.conversations} |`,
            `| 🤖 模型调用 | ${stats.models.totalCalls} |`,
            `| 🔧 工具调用 | ${stats.tools.totalCalls} |`,
            `| 📝 总Tokens | ${this.formatNumber(stats.tokens.totalSum)} |`,
            ``,
            `### 🤖 模型使用 Top 5`
        ]

        if (stats.models.byModel.length > 0) {
            markdown.push(`| 模型 | 调用 | Tokens |`)
            markdown.push(`|------|------|--------|`)
            stats.models.byModel.slice(0, 5).forEach(m => {
                const shortName = m.name.split('/').pop().substring(0, 20)
                markdown.push(`| ${shortName} | ${m.calls} | ${this.formatNumber(m.inputTokens + m.outputTokens)} |`)
            })
        } else {
            markdown.push(`暂无数据`)
        }

        markdown.push(``, `### 👥 活跃群组 Top 5`)
        if (stats.messages.topGroups.length > 0) {
            markdown.push(`| 群号 | 消息数 |`)
            markdown.push(`|------|--------|`)
            stats.messages.topGroups.slice(0, 5).forEach(g => {
                markdown.push(`| ${g.id} | ${g.count} |`)
            })
        } else {
            markdown.push(`暂无数据`)
        }

        markdown.push(``, `### 👤 活跃用户 Top 5`)
        if (stats.messages.topUsers.length > 0) {
            markdown.push(`| 用户 | 消息数 |`)
            markdown.push(`|------|--------|`)
            stats.messages.topUsers.slice(0, 5).forEach(u => {
                markdown.push(`| ${u.id} | ${u.count} |`)
            })
        } else {
            markdown.push(`暂无数据`)
        }

        return renderService.renderMarkdownToImage({
            markdown: markdown.join('\n'),
            title: 'AI 统计',
            subtitle: `更新于 ${new Date().toLocaleString('zh-CN')}`,
            icon: '📊',
            showTimestamp: false
        })
    }

    /**
     * 文本版统计
     */
    async showStatsText() {
        const stats = statsService.getOverview()
        const text = [
            '📊 AI 统计概览',
            '━━━━━━━━━━━━━━━━',
            `🕐 运行: ${stats.uptime.days}天${stats.uptime.hours}小时`,
            `📨 消息: ${stats.messages.total}`,
            `💬 对话: ${stats.messages.conversations}`,
            `🤖 模型调用: ${stats.models.totalCalls}`,
            `🔧 工具调用: ${stats.tools.totalCalls}`,
            `📝 Tokens: ${this.formatNumber(stats.tokens.totalSum)}`,
            '━━━━━━━━━━━━━━━━',
            '发送 #ai统计详情 查看完整统计'
        ].join('\n')
        await this.reply(text, true)
    }

    /**
     * 格式化数字
     */
    formatNumber(num) {
        if (!num) return '0'
        if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M'
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
        return String(num)
    }

    /**
     * 格式化字节
     */
    formatBytes(bytes) {
        if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + ' GB'
        if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + ' MB'
        if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB'
        return bytes + ' B'
    }
}
