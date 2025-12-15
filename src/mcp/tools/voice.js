/**
 * AI语音/声聊工具
 * QQ原生AI声聊功能、语音消息操作
 * 
 * AI声聊是QQ的原生功能，通过 NapCat 的扩展API调用
 * 参考: https://napcat.apifox.cn/
 */

export const voiceTools = [
    {
        name: 'set_ai_voice_chat',
        description: '设置群AI声聊开关（QQ原生功能）。开启后群内消息将触发AI语音回复',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                enable: { type: 'boolean', description: '是否开启，默认true' },
                character: { type: 'string', description: '声聊角色/音色（可选）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                if (!groupId) {
                    return { success: false, error: '需要指定群号或在群聊中使用' }
                }
                const enable = args.enable !== false
                // NapCat API: set_group_ai_record
                if (bot.sendApi) {
                    await bot.sendApi('set_group_ai_record', {
                        group_id: groupId,
                        enable: enable,
                        character: args.character || ''
                    })
                    return { 
                        success: true, 
                        group_id: groupId, 
                        enabled: enable,
                        message: enable ? 'AI声聊已开启' : 'AI声聊已关闭'
                    }
                }
                // 备用方法名
                if (bot.setGroupAiRecord) {
                    await bot.setGroupAiRecord(groupId, enable, args.character)
                    return { success: true, group_id: groupId, enabled: enable }
                }
                return { success: false, error: '当前协议不支持AI声聊设置' }
            } catch (err) {
                return { success: false, error: `设置AI声聊失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_ai_voice_characters',
        description: '获取AI声聊可用的角色/音色列表',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号（可选）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                // NapCat API: get_ai_characters
                if (bot.sendApi) {
                    const result = await bot.sendApi('get_ai_characters', {
                        group_id: groupId
                    })
                    const characters = result?.data || result || []
                    return {
                        success: true,
                        group_id: groupId,
                        count: characters.length,
                        characters: characters.map(c => ({
                            id: c.character_id || c.id,
                            name: c.character_name || c.name,
                            voice_type: c.voice_type,
                            description: c.description
                        }))
                    }
                }
                if (bot.getAiCharacters) {
                    const characters = await bot.getAiCharacters(groupId)
                    return { success: true, characters }
                }
                return { success: false, error: '当前协议不支持获取AI声聊角色' }
            } catch (err) {
                return { success: false, error: `获取AI声聊角色失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_ai_voice',
        description: '发送AI语音消息（使用QQ的AI声聊功能合成语音）',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要转为语音的文字' },
                character: { type: 'string', description: '角色/音色ID（可选）' },
                group_id: { type: 'string', description: '群号（可选）' }
            },
            required: ['text']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                // NapCat API: send_group_ai_record
                if (bot.sendApi) {
                    const result = await bot.sendApi('send_group_ai_record', {
                        group_id: groupId,
                        text: args.text,
                        character: args.character || ''
                    })
                    return {
                        success: true,
                        group_id: groupId,
                        text: args.text,
                        message_id: result?.message_id
                    }
                }
                if (bot.sendGroupAiRecord) {
                    const result = await bot.sendGroupAiRecord(groupId, args.text, args.character)
                    return { success: true, message_id: result?.message_id }
                }
                return { success: false, error: '当前协议不支持AI语音发送' }
            } catch (err) {
                return { success: false, error: `发送AI语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_voice',
        description: '发送语音消息（直接发送语音文件）',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '语音文件URL' },
                file: { type: 'string', description: '本地语音文件路径' },
                base64: { type: 'string', description: '语音base64数据' },
                magic: { type: 'boolean', description: '是否变声' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                let recordData
                if (args.url) {
                    recordData = args.url
                } else if (args.file) {
                    recordData = `file://${args.file}`
                } else if (args.base64) {
                    recordData = `base64://${args.base64.replace(/^data:[^;]+;base64,/, '')}`
                } else {
                    return { success: false, error: '需要提供 url、file 或 base64' }
                }
                const recordSeg = {
                    type: 'record',
                    file: recordData,
                    magic: args.magic ? 1 : 0
                }
                const result = await e.reply(recordSeg)
                return { success: true, message_id: result?.message_id }
            } catch (err) {
                return { success: false, error: `发送语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'parse_voice',
        description: '获取消息中的语音信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                let voiceInfo = null
                for (const seg of e.message || []) {
                    if (seg.type === 'record' || seg.type === 'audio') {
                        voiceInfo = {
                            url: seg.url || seg.file,
                            file: seg.file,
                            magic: seg.magic,
                            duration: seg.seconds
                        }
                        break
                    }
                }
                if (!voiceInfo) {
                    return { success: false, error: '消息中没有语音' }
                }
                return { success: true, voice: voiceInfo }
            } catch (err) {
                return { success: false, error: `解析语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_record',
        description: '获取语音文件详情（转换格式等）',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: '语音文件标识' },
                out_format: { 
                    type: 'string', 
                    enum: ['mp3', 'amr', 'wma', 'm4a', 'spx', 'ogg', 'wav', 'flac'],
                    description: '输出格式' 
                }
            },
            required: ['file']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                // OneBot API: get_record
                if (bot.sendApi) {
                    const result = await bot.sendApi('get_record', {
                        file: args.file,
                        out_format: args.out_format || 'mp3'
                    })
                    return {
                        success: true,
                        file: result?.data?.file || result?.file,
                        url: result?.data?.url || result?.url,
                        format: args.out_format || 'mp3'
                    }
                }
                if (bot.getRecord) {
                    const result = await bot.getRecord(args.file, args.out_format)
                    return { success: true, ...result }
                }
                return { success: false, error: '当前协议不支持获取语音文件' }
            } catch (err) {
                return { success: false, error: `获取语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_tts',
        description: '发送TTS语音消息（系统文字转语音）',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要转换的文字' }
            },
            required: ['text']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                // TTS 消息段
                const ttsSeg = { type: 'tts', text: args.text }
                const result = await e.reply(ttsSeg)
                return { 
                    success: true, 
                    message_id: result?.message_id,
                    text: args.text
                }
            } catch (err) {
                return { success: false, error: `发送TTS失败: ${err.message}` }
            }
        }
    }
]
