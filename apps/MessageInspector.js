import { detectFramework as getBotFramework, detectAdapter as getAdapter } from '../src/utils/platformAdapter.js'
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
let masterList = null
async function getMasterList() {
    if (masterList === null) {
        try {
            const yunzaiCfg = (await import('../../../lib/config/config.js')).default
            masterList = yunzaiCfg?.masterQQ || []
        } catch {
            const config = (await import('../config/config.js')).default
            masterList = config.get('admin.masterQQ') || []
        }
    }
    return masterList
}

/**
 * 检查是否是主人
 */
async function isMaster(userId) {
    const masters = await getMasterList()
    return masters.includes(String(userId)) || masters.includes(Number(userId))
}

/**
 * 获取框架类型
 */
function getFramework() {
    return getBotFramework()  // 'trss' 或 'miao'
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
            priority: 1,  // 高优先级，确保命令能被触发
            rule: [
                {
                    reg: '^#取(\\d*)$',  // 简化正则，匹配#取 或 #取123
                    fnc: 'inspectMessage',
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
        
        // 从引用消息中获取
        if (!targetSeq && e.source) {
            targetSeq = e.source.seq
            targetMsgId = e.source.message_id || e.source.id
        }
        
        // 没有指定seq也没有引用，则获取上一条消息
        if (!targetSeq && !targetMsgId) {
            getPrevious = true
        }
        
        try {
            let rawMsg = null
            let isForwardMsg = false
            let forwardData = null
            
            // 获取消息
            if (getPrevious) {
                // 获取上一条消息（通过聊天历史）
                if (e.group_id) {
                    const group = bot.pickGroup(e.group_id)
                    if (group?.getChatHistory) {
                        const history = await group.getChatHistory(0, 2)
                        // 第一条是当前命令消息，第二条是上一条
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
                // 通过seq或message_id获取
                rawMsg = await this.fetchMessage(bot, e, targetSeq, targetMsgId)
            }
            
            if (!rawMsg) {
                await this.reply('❌ 获取消息失败，请引用消息后发送 #取 或提供消息seq', true)
                return true
            }
            
            // 检查是否是转发消息
            const message = rawMsg.message || rawMsg.content || []
            for (const seg of message) {
                const segType = seg.type || seg.data?._type
                if (segType === 'forward') {
                    isForwardMsg = true
                    // 解析转发消息
                    forwardData = await ForwardMessageParser.parse(e, seg, {
                        extractProto: true,
                        extractSerialized: true,
                        maxDepth: 10
                    })
                    break
                }
                if (segType === 'json') {
                    try {
                        const jsonStr = seg.data?.data || seg.data
                        const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
                        if (jsonData?.app === 'com.tencent.multimsg' && jsonData?.meta?.detail?.resid) {
                            isForwardMsg = true
                            forwardData = await ForwardMessageParser.parse(e, jsonData.meta.detail.resid, {
                                extractProto: true,
                                extractSerialized: true,
                                maxDepth: 10
                            })
                            break
                        }
                    } catch {}
                }
            }
            
            // 构建完整数据
            const fullData = await this.buildFullMessageData(rawMsg, forwardData)
            
            // 发送合并转发
            await this.sendDataAsForward(e, fullData, isForwardMsg)
            
        } catch (error) {
            logger.error('[MessageInspector] Error:', error)
            await this.reply(`❌ 获取消息失败: ${error.message}`, true)
        }
        
        return true
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
     * 构建完整消息数据
     */
    async buildFullMessageData(rawMsg, forwardData) {
        const data = {
            // 基础信息
            message_id: rawMsg.message_id || rawMsg.id || null,
            seq: rawMsg.seq || null,
            rand: rawMsg.rand || null,
            time: rawMsg.time || null,
            // 发送者
            user_id: rawMsg.user_id || rawMsg.sender?.user_id || null,
            sender: rawMsg.sender || null,
            // 群信息
            group_id: rawMsg.group_id || null,
            // 消息内容
            message: rawMsg.message || rawMsg.content || [],
            raw_message: rawMsg.raw_message || null,
            // icqq 特有
            font: rawMsg.font || null,
            pktnum: rawMsg.pktnum || null,
            atme: rawMsg.atme || null,
            atall: rawMsg.atall || null
        }
        
        // 提取 proto 数据
        const proto = IcqqMessageUtils.extractProto(rawMsg)
        if (proto) {
            data.proto = proto
        }
        
        // 提取序列化数据
        const serialized = IcqqMessageUtils.serializeMessage(rawMsg)
        if (serialized) {
            data.serialized = serialized.toString('base64')
        }
        
        // 提取 raw buffer (pb 原始数据)
        if (rawMsg.raw) {
            if (Buffer.isBuffer(rawMsg.raw)) {
                data.pb = {
                    hex: rawMsg.raw.toString('hex'),
                    base64: rawMsg.raw.toString('base64'),
                    length: rawMsg.raw.length
                }
            } else {
                data.pb = rawMsg.raw
            }
        }
        
        // 提取 elem 数据
        if (rawMsg.elems) {
            data.elems = rawMsg.elems
        }
        
        // 提取 parsed 数据 (Parser)
        if (rawMsg.parsed) {
            data.parsed = {
                brief: rawMsg.parsed.brief,
                content: rawMsg.parsed.content,
                atme: rawMsg.parsed.atme,
                atall: rawMsg.parsed.atall,
                quotation: rawMsg.parsed.quotation
            }
        }
        
        // 添加 msgrecord
        data.msgrecord = MsgRecordExtractor.fromApiResponse(rawMsg)
        
        // 转发消息数据
        if (forwardData?.success) {
            data.forward = {
                total: forwardData.totalCount,
                messages: forwardData.messages.map(msg => ({
                    user_id: msg.user_id,
                    nickname: msg.nickname,
                    time: msg.time,
                    message: msg.message,
                    raw_message: msg.raw_message,
                    proto: msg.proto || null,
                    serialized: msg.serialized || null,
                    nested_forward: msg.nested_forward?.success ? {
                        total: msg.nested_forward.totalCount
                    } : null
                }))
            }
        }
        
        return data
    }
    
    /**
     * 以合并转发形式发送数据
     */
    async sendDataAsForward(e, data, isForwardMsg) {
        const bot = e.bot || Bot
        const botId = bot?.uin || e.self_id || 10000
        const msgs = []
        
        // 1. 基础消息信息
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
        msgs.push(`${this.safeStringify(basicInfo)}`)
        if (data.message?.length > 0) {
            msgs.push(`${this.safeStringify(data.message)}`)
        }
        
        // 3. icqq 特有字段
        const icqqFields = {
            font: data.font,
            pktnum: data.pktnum,
            atme: data.atme,
            atall: data.atall
        }
        if (Object.values(icqqFields).some(v => v !== null)) {
            msgs.push(`${this.safeStringify(icqqFields)}`)
        }
        
        // 4. elems 数据
        if (data.elems) {
            const elemsStr = this.safeStringify(data.elems)
            msgs.push(`${elemsStr.substring(0, 3000)}`)
        }
        
        // 5. parsed 数据
        if (data.parsed) {
            msgs.push(`${this.safeStringify(data.parsed)}`)
        }
        
        // 6. pb 数据
        if (data.pb) {
            if (typeof data.pb === 'object' && data.pb.base64) {
                msgs.push(`📦 pb (protobuf) 数据\n长度: ${data.pb.length} bytes\n\nBase64:\n${data.pb.base64}`)
                if (data.pb.hex) {
                    // HEX 可能很长，分段发送
                    const hexChunks = this.chunkString(data.pb.hex, 3000)
                    hexChunks.forEach((chunk, i) => {
                        msgs.push(`📦 pb HEX (${i + 1}/${hexChunks.length})\n${chunk}`)
                    })
                }
            } else {
                msgs.push(`📦 pb 数据\n${this.safeStringify(data.pb)}`)
            }
        }
        
        // 7. proto 数据
        if (data.proto) {
            const protoStr = this.safeStringify(data.proto)
            const protoChunks = this.chunkString(protoStr, 3000)
            protoChunks.forEach((chunk, i) => {
                msgs.push(`📦 proto 数据 (${i + 1}/${protoChunks.length})\n${chunk}`)
            })
        }
        
        // 8. serialized 数据
        if (data.serialized) {
            msgs.push(`📦 serialized数据\n${data.serialized}`)
        }
        
        // 9. msgrecord
        if (data.msgrecord) {
            const recordStr = this.safeStringify(data.msgrecord)
            msgs.push(`📋 msgrecord\n${recordStr}`)
        }
        if (data.forward) {
            msgs.push(`📨 转发消息 (共${data.forward.total}条)`)
            for (let i = 0; i < Math.min(data.forward.messages.length, 20); i++) {
                const fwdMsg = data.forward.messages[i]
                const fwdStr = this.safeStringify(fwdMsg)
                msgs.push(`📨 转发消息 [${i + 1}]\n${fwdStr.substring(0, 3000)}`)
            }
        }
        const sendResult = await this.sendForwardMsg(e, '消息数据', msgs)
        if (!sendResult) {
            await this.reply(`📋 消息数据 (seq: ${data.seq})\n${this.safeStringify(basicInfo).substring(0, 1000)}`, true)
        }
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
        return JSON.stringify(obj, (key, value) => {
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
        }, space)
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
            '```',
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
        ].filter(Boolean).join('\n')
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
            ...result.methods.map(m => 
                `${m.success ? '✅' : '❌'} ${m.name}${m.error ? ` (${m.error})` : ''}`
            )
        ].join('\n')
        msgs.push(methodsInfo)
        
        // 6. 完整JSON
        const fullJson = JSON.stringify({
            ...rawMsg,
            raw: result.pb?.exists ? '[Buffer]' : undefined  // 不序列化 Buffer
        }, null, 2)
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
        ].filter(Boolean).join('\n')
        
        await this.reply(output, true)
        
        // 输出完整信息到控制台
        logger.info('[MessageInspector] 完整消息数据:', JSON.stringify(result, (key, value) => {
            if (Buffer.isBuffer(value)) {
                return `[Buffer: ${value.length} bytes]`
            }
            return value
        }, 2))
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
        msgs.push([
            '📊 AI 统计概览',
            '━━━━━━━━━━━━━━━━',
            `🕐 运行时间: ${stats.uptime.days}天${stats.uptime.hours}小时`,
            `📨 消息总数: ${stats.messages.total}`,
            `💬 对话数: ${stats.messages.conversations}`,
            `🤖 模型调用: ${stats.models.totalCalls}`,
            `🔧 工具调用: ${stats.tools.totalCalls}`,
            `📝 Tokens: ${this.formatNumber(stats.tokens.totalSum)}`
        ].join('\n'))
        
        // 2. 消息类型分布
        if (Object.keys(stats.messages.types).length > 0) {
            const typeLines = Object.entries(stats.messages.types)
                .sort((a, b) => b[1] - a[1])
                .map(([type, count]) => `  ${type}: ${count}`)
            msgs.push([
                '📝 消息类型分布',
                '━━━━━━━━━━━━━━━━',
                ...typeLines
            ].join('\n'))
        }
        
        // 3. 模型使用统计
        if (stats.models.byModel.length > 0) {
            const modelLines = stats.models.byModel.slice(0, 15).map(m => 
                `  ${m.name.split('/').pop()}: ${m.calls}次 (${this.formatNumber(m.inputTokens + m.outputTokens)} tokens)`
            )
            msgs.push([
                '🤖 模型使用统计',
                '━━━━━━━━━━━━━━━━',
                ...modelLines
            ].join('\n'))
        }
        
        // 4. Tokens 统计
        msgs.push([
            '📊 Tokens 统计',
            '━━━━━━━━━━━━━━━━',
            `总输入: ${this.formatNumber(stats.tokens.total.input)}`,
            `总输出: ${this.formatNumber(stats.tokens.total.output)}`,
            `总计: ${this.formatNumber(stats.tokens.totalSum)}`
        ].join('\n'))
        
        // 5. 群组 Top 10
        if (stats.messages.topGroups.length > 0) {
            const groupLines = stats.messages.topGroups.map((g, i) => 
                `  ${i + 1}. ${g.id}: ${g.count}条`
            )
            msgs.push([
                '👥 活跃群组 Top 10',
                '━━━━━━━━━━━━━━━━',
                ...groupLines
            ].join('\n'))
        }
        
        // 6. 用户 Top 10
        if (stats.messages.topUsers.length > 0) {
            const userLines = stats.messages.topUsers.map((u, i) => 
                `  ${i + 1}. ${u.id}: ${u.count}条`
            )
            msgs.push([
                '👤 活跃用户 Top 10',
                '━━━━━━━━━━━━━━━━',
                ...userLines
            ].join('\n'))
        }
        
        // 7. 工具使用 Top 10
        if (stats.tools.byTool.length > 0) {
            const toolLines = stats.tools.byTool.slice(0, 10).map(t => 
                `  ${t.name}: ${t.calls}次 (成功${t.success})`
            )
            msgs.push([
                '🔧 工具使用 Top 10',
                '━━━━━━━━━━━━━━━━',
                ...toolLines
            ].join('\n'))
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
                msgs.push([
                    '⏰ 消息时段分布',
                    '━━━━━━━━━━━━━━━━',
                    ...hourLines
                ].join('\n'))
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
            await this.reply([
                '🔧 Debug 信息',
                '━━━━━━━━━━━━━━━━',
                `框架: ${framework}`,
                `适配器: ${adapter}`,
                `Bot: ${debugInfo.bot.uin}`,
                `内存: ${debugInfo.memory.heapUsed}`,
                `消息: ${debugInfo.stats.messages}`,
                `模型调用: ${debugInfo.stats.modelCalls}`,
                `Tokens: ${this.formatNumber(debugInfo.stats.tokens)}`
            ].join('\n'), true)
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
