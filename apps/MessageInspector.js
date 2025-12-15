/**
 * 消息检查器插件
 * #取 - 获取消息完整raw/pb信息
 * 仅主人可用，使用图片+合并转发输出
 */
import { getBotFramework, getAdapter } from '../src/utils/bot.js'
import { formatTimeToBeiJing } from '../src/utils/common.js'
import { renderService } from '../src/services/RenderService.js'

// 缓存主人列表
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
                }
            ]
        })
    }

    /**
     * 检查消息详情
     */
    async inspectMessage() {
        const e = this.e
        const bot = e.bot || Bot
        
        // 获取目标消息
        let targetSeq = null
        let targetMsgId = null
        
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
        
        if (!targetSeq && !targetMsgId) {
            await this.reply('❌ 请提供消息seq或引用需要查询的消息\n用法:\n  #取 [seq]\n  引用消息后发送 #取', true)
            return true
        }
        
        await this.reply('🔍 正在获取消息信息...', true)
        
        try {
            const framework = getFramework()
            const adapter = detectAdapter(e)
            
            const result = {
                framework,
                adapter,
                query: { seq: targetSeq, message_id: targetMsgId },
                raw: null,
                pb: null,
                methods: []
            }
            
            let rawMsg = null
            if (e.group_id) {
                const group = bot.pickGroup(e.group_id)
                if (group?.getMsg) {
                    try {
                        rawMsg = await group.getMsg(targetSeq || targetMsgId)
                        result.methods.push({ name: 'group.getMsg', success: !!rawMsg })
                    } catch (err) {
                        result.methods.push({ name: 'group.getMsg', success: false, error: err.message })
                    }
                }
                if (!rawMsg && group?.getChatHistory && targetSeq) {
                    try {
                        const history = await group.getChatHistory(targetSeq, 1)
                        if (history?.length > 0) {
                            rawMsg = history[0]
                            result.methods.push({ name: 'group.getChatHistory', success: true })
                        } else {
                            result.methods.push({ name: 'group.getChatHistory', success: false, error: 'empty result' })
                        }
                    } catch (err) {
                        result.methods.push({ name: 'group.getChatHistory', success: false, error: err.message })
                    }
                }
                
                // 方式3: bot.getMsg (NC/OneBot)
                if (!rawMsg && bot?.getMsg) {
                    try {
                        rawMsg = await bot.getMsg(targetMsgId || targetSeq)
                        result.methods.push({ name: 'bot.getMsg', success: !!rawMsg })
                    } catch (err) {
                        result.methods.push({ name: 'bot.getMsg', success: false, error: err.message })
                    }
                }
            } else {
                // 私聊消息
                const friend = bot.pickFriend(e.user_id)
                
                if (friend?.getMsg) {
                    try {
                        rawMsg = await friend.getMsg(targetSeq || targetMsgId)
                        result.methods.push({ name: 'friend.getMsg', success: !!rawMsg })
                    } catch (err) {
                        result.methods.push({ name: 'friend.getMsg', success: false, error: err.message })
                    }
                }
                
                if (!rawMsg && bot?.getMsg) {
                    try {
                        rawMsg = await bot.getMsg(targetMsgId || targetSeq)
                        result.methods.push({ name: 'bot.getMsg', success: !!rawMsg })
                    } catch (err) {
                        result.methods.push({ name: 'bot.getMsg', success: false, error: err.message })
                    }
                }
            }
            
            if (!rawMsg) {
                const methodsInfo = result.methods.map(m => 
                    `${m.name}: ${m.success ? '✅' : '❌ ' + (m.error || '')}`
                ).join('\n')
                
                await this.reply(`❌ 获取消息失败\n\n框架: ${framework}\n适配器: ${adapter}\nSeq: ${targetSeq || 'N/A'}\nMsgID: ${targetMsgId || 'N/A'}\n\n尝试方法:\n${methodsInfo}`, true)
                return true
            }
            
            result.raw = rawMsg
            
            // 处理 pb 数据 (icqq 特有)
            if (rawMsg.raw) {
                result.pb = {
                    exists: true,
                    type: typeof rawMsg.raw,
                    isBuffer: Buffer.isBuffer(rawMsg.raw),
                    length: rawMsg.raw?.length || 0
                }
                if (Buffer.isBuffer(rawMsg.raw)) {
                    result.pb.hex = rawMsg.raw.toString('hex')
                    result.pb.base64 = rawMsg.raw.toString('base64')
                }
            }
            
            // 优先尝试渲染为图片
            try {
                const imageBuffer = await this.renderMessageDetails(result, rawMsg)
                await this.reply(segment.image(imageBuffer))
                
                // PB数据较多时，额外发送合并转发
                if (result.pb?.exists && result.pb.base64) {
                    const forwardMsgs = await this.buildForwardMessages(e, result, rawMsg)
                    await this.sendForwardMsg(e, '消息PB数据', forwardMsgs)
                }
            } catch (renderErr) {
                logger.warn('[MessageInspector] 渲染图片失败:', renderErr.message)
                // 回退: 构建合并转发消息
                const forwardMsgs = await this.buildForwardMessages(e, result, rawMsg)
                const sendResult = await this.sendForwardMsg(e, '消息详情', forwardMsgs)
                
                if (!sendResult) {
                    await this.sendFallbackReply(result, rawMsg)
                }
            }
            
        } catch (error) {
            logger.error('[MessageInspector] Error:', error)
            await this.reply(`❌ 获取消息失败: ${error.message}`, true)
        }
        
        return true
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
}
