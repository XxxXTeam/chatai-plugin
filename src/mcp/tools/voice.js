/**
 * AI语音/声聊工具
 * QQ原生AI声聊功能、语音消息操作
 * 
 * AI声聊是QQ的原生功能，通过 NapCat 的扩展API调用
 * 参考: https://napcat.apifox.cn/
 * 
 * 语音消息类型:
 * - PttElem: { type: 'record', file: string|Buffer, url?, fid?, md5?, size?, seconds? }
 * - segment.record(file, data) 构造语音消息段
 */

/**
 * 检测协议类型
 */
function detectProtocol(bot) {
    if (!bot) return 'unknown'
    
    // NapCat 特征检测
    if (bot.sendApi && (bot.adapter?.name?.includes?.('napcat') || bot.config?.protocol === 'napcat')) {
        return 'napcat'
    }
    // go-cqhttp 特征
    if (bot.sendApi || bot.config?.baseUrl) {
        return 'onebot'
    }
    // icqq 特征: 有 pickGroup, pickFriend, fl, gl 等属性
    if (bot.pickGroup && bot.pickFriend && bot.fl && bot.gl) {
        return 'icqq'
    }
    // 其他 OneBot 实现
    if (bot.sendApi) {
        return 'onebot'
    }
    return 'unknown'
}

/**
 * 调用 OneBot API (支持 NapCat/go-cqhttp/icqq)
 */
async function callOneBotApi(bot, action, params = {}) {
    if (bot.sendApi) {
        return await bot.sendApi(action, params)
    }
    if (bot[action]) {
        return await bot[action](params)
    }
    if (bot.config?.baseUrl || bot.adapter?.config?.baseUrl) {
        const baseUrl = bot.config?.baseUrl || bot.adapter?.config?.baseUrl
        const res = await fetch(`${baseUrl}/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        })
        return await res.json()
    }
    throw new Error('不支持的协议类型')
}

export const voiceTools = [
    {
        name: 'set_ai_voice_chat',
        description: '设置群AI声聊开关（需要NapCat协议端）。开启后群内消息将触发AI语音回复',
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
                
                const protocol = detectProtocol(bot)
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                if (!groupId) {
                    return { success: false, error: '需要指定群号或在群聊中使用' }
                }
                const enable = args.enable !== false
                
                // NapCat API: set_group_ai_record
                if (bot.sendApi) {
                    try {
                        await bot.sendApi('set_group_ai_record', {
                            group_id: groupId,
                            enable: enable,
                            character: args.character || ''
                        })
                        return { 
                            success: true, 
                            protocol,
                            group_id: groupId, 
                            enabled: enable,
                            message: enable ? 'AI声聊已开启' : 'AI声聊已关闭'
                        }
                    } catch (apiErr) {
                        // API不存在
                    }
                }
                // 备用方法名
                if (bot.setGroupAiRecord) {
                    await bot.setGroupAiRecord(groupId, enable, args.character)
                    return { success: true, protocol, group_id: groupId, enabled: enable }
                }
                
                return { 
                    success: false, 
                    protocol,
                    error: 'AI声聊功能需要 NapCat 协议端支持',
                    hint: protocol === 'icqq' 
                        ? 'icqq 协议不支持AI声聊，这是QQ原生功能，需要通过NapCat调用'
                        : '请确认协议端是否支持 set_group_ai_record API'
                }
            } catch (err) {
                return { success: false, error: `设置AI声聊失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_ai_voice_characters',
        description: '获取AI声聊可用的角色/音色列表（需要NapCat协议端）',
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
                
                const protocol = detectProtocol(bot)
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                
                // NapCat API: get_ai_characters
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('get_ai_characters', {
                            group_id: groupId
                        })
                        const characters = result?.data || result || []
                        
                        if (Array.isArray(characters) && characters.length > 0) {
                            return {
                                success: true,
                                protocol,
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
                    } catch (apiErr) {
                        // API调用失败
                    }
                }
                
                if (bot.getAiCharacters) {
                    const characters = await bot.getAiCharacters(groupId)
                    return { success: true, protocol, characters }
                }
                
                return { 
                    success: false, 
                    protocol,
                    error: 'AI声聊功能需要 NapCat 协议端支持',
                    hint: '请确认协议端是否支持 get_ai_characters API',
                    alternatives: ['send_tts', 'send_voice']
                }
            } catch (err) {
                return { success: false, error: `获取AI声聊角色失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_ai_voice',
        description: '发送AI语音消息（需要NapCat协议端，使用QQ的AI声聊功能合成语音）',
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
                
                const protocol = detectProtocol(bot)
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                
                // NapCat API: send_group_ai_record
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('send_group_ai_record', {
                            group_id: groupId,
                            text: args.text,
                            character: args.character || ''
                        })
                        if (result?.message_id || result?.data?.message_id) {
                            return {
                                success: true,
                                protocol,
                                group_id: groupId,
                                text: args.text,
                                message_id: result?.message_id || result?.data?.message_id
                            }
                        }
                    } catch (apiErr) {
                        // API不存在
                    }
                }
                if (bot.sendGroupAiRecord) {
                    const result = await bot.sendGroupAiRecord(groupId, args.text, args.character)
                    return { success: true, protocol, message_id: result?.message_id }
                }
                
                return { 
                    success: false, 
                    protocol,
                    error: 'AI语音功能需要 NapCat 协议端支持',
                    hint: '请确认协议端是否支持 send_group_ai_record API',
                    alternatives: ['send_tts', 'send_voice']
                }
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
    },

    // ========== NapCat AI声聊增强API ==========

    {
        name: 'get_ai_record',
        description: '获取AI语音（文字转语音，不发送，返回语音数据）',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要转换的文字' },
                character: { type: 'string', description: '角色/音色ID' },
                group_id: { type: 'string', description: '群号（用于获取可用角色）' }
            },
            required: ['text', 'character']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                
                // NapCat API: get_ai_record
                const result = await callOneBotApi(bot, 'get_ai_record', {
                    group_id: groupId,
                    character: args.character,
                    text: args.text
                })
                
                if (result?.data || result?.file) {
                    return {
                        success: true,
                        text: args.text,
                        character: args.character,
                        file: result.data?.file || result.file,
                        url: result.data?.url || result.url
                    }
                }
                
                return { success: false, error: '获取AI语音失败' }
            } catch (err) {
                return { success: false, error: `获取AI语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_private_ai_record',
        description: '发送私聊AI语音消息',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '目标用户QQ号' },
                text: { type: 'string', description: '要转为语音的文字' },
                character: { type: 'string', description: '角色/音色ID' }
            },
            required: ['user_id', 'text', 'character']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                const userId = parseInt(args.user_id)
                
                // NapCat API: send_private_ai_record (如果支持)
                try {
                    const result = await callOneBotApi(bot, 'send_private_ai_record', {
                        user_id: userId,
                        character: args.character,
                        text: args.text
                    })
                    return {
                        success: true,
                        user_id: userId,
                        text: args.text,
                        message_id: result?.message_id
                    }
                } catch (e) {
                    // 降级方案：先获取语音再发送
                    const aiRecord = await callOneBotApi(bot, 'get_ai_record', {
                        character: args.character,
                        text: args.text
                    })
                    
                    if (aiRecord?.data?.file || aiRecord?.file) {
                        const file = aiRecord.data?.file || aiRecord.file
                        const friend = bot.pickFriend?.(userId)
                        if (friend?.sendMsg) {
                            const result = await friend.sendMsg({ type: 'record', file })
                            return { success: true, user_id: userId, message_id: result?.message_id }
                        }
                    }
                    
                    return { success: false, error: '当前协议不支持私聊AI语音' }
                }
            } catch (err) {
                return { success: false, error: `发送私聊AI语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_voice_info',
        description: '获取语音消息的详细信息（包括下载URL）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID（包含语音的消息）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                // 如果没有指定消息ID，尝试从当前消息获取
                if (!args.message_id) {
                    for (const seg of e?.message || []) {
                        if (seg.type === 'record') {
                            return {
                                success: true,
                                type: 'record',
                                file: seg.file,
                                url: seg.url,
                                fid: seg.fid,
                                md5: seg.md5,
                                size: seg.size,
                                seconds: seg.seconds
                            }
                        }
                    }
                    return { success: false, error: '当前消息不包含语音' }
                }
                
                // 通过消息ID获取消息内容
                if (bot.sendApi) {
                    const msg = await bot.sendApi('get_msg', { message_id: args.message_id })
                    const message = msg?.data?.message || msg?.message || []
                    
                    for (const seg of message) {
                        if (seg.type === 'record') {
                            return {
                                success: true,
                                type: 'record',
                                file: seg.data?.file || seg.file,
                                url: seg.data?.url || seg.url,
                                path: seg.data?.path || seg.path
                            }
                        }
                    }
                }
                
                return { success: false, error: '消息中未找到语音' }
            } catch (err) {
                return { success: false, error: `获取语音信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_voice',
        description: '下载语音文件',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '语音文件URL' },
                file_id: { type: 'string', description: '语音文件ID（从消息获取）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                
                let url = args.url
                
                // 如果提供了 file_id，先获取 URL
                if (!url && args.file_id) {
                    if (bot.sendApi) {
                        const result = await bot.sendApi('get_record', {
                            file: args.file_id,
                            out_format: 'mp3'
                        })
                        url = result?.data?.url || result?.url
                    }
                }
                
                if (!url) {
                    return { success: false, error: '需要提供 url 或 file_id' }
                }
                
                // 下载语音
                const response = await fetch(url)
                if (!response.ok) {
                    return { success: false, error: `下载失败: HTTP ${response.status}` }
                }
                
                const buffer = await response.arrayBuffer()
                const base64 = Buffer.from(buffer).toString('base64')
                
                return {
                    success: true,
                    url,
                    size: buffer.byteLength,
                    base64: `base64://${base64}`
                }
            } catch (err) {
                return { success: false, error: `下载语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'voice_to_text',
        description: '语音转文字（语音识别）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '包含语音的消息ID（不填则使用当前消息）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                let fileId = null
                
                // 获取语音文件ID
                if (args.message_id) {
                    if (bot.sendApi) {
                        const msg = await bot.sendApi('get_msg', { message_id: args.message_id })
                        const message = msg?.data?.message || msg?.message || []
                        for (const seg of message) {
                            if (seg.type === 'record') {
                                fileId = seg.data?.file || seg.file
                                break
                            }
                        }
                    }
                } else {
                    for (const seg of e?.message || []) {
                        if (seg.type === 'record') {
                            fileId = seg.file || seg.fid
                            break
                        }
                    }
                }
                
                if (!fileId) {
                    return { success: false, error: '未找到语音消息' }
                }
                
                // NapCat API: 语音转文字
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('get_record_url', { file: fileId })
                        // 某些协议可能有语音识别API
                        const asrResult = await bot.sendApi('asr', { file: fileId }).catch(() => null)
                        
                        if (asrResult?.data?.text || asrResult?.text) {
                            return {
                                success: true,
                                text: asrResult.data?.text || asrResult.text,
                                file: fileId
                            }
                        }
                    } catch (e) {}
                }
                
                return { success: false, error: '当前协议不支持语音转文字' }
            } catch (err) {
                return { success: false, error: `语音转文字失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_ai_voice_status',
        description: '获取群AI声聊状态',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
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
                
                // NapCat API: get_group_ai_record_status (如果存在)
                try {
                    const result = await callOneBotApi(bot, 'get_group_ai_record_status', { group_id: groupId })
                    return {
                        success: true,
                        group_id: groupId,
                        enabled: result?.data?.enabled ?? result?.enabled,
                        character: result?.data?.character || result?.character
                    }
                } catch (e) {
                    // 尝试获取角色列表来判断功能是否可用
                    try {
                        const chars = await callOneBotApi(bot, 'get_ai_characters', { group_id: groupId })
                        return {
                            success: true,
                            group_id: groupId,
                            available: true,
                            character_count: (chars?.data || chars || []).length,
                            note: '无法获取具体状态，但AI声聊功能可用'
                        }
                    } catch (e2) {
                        return { success: false, error: '当前协议不支持获取AI声聊状态' }
                    }
                }
            } catch (err) {
                return { success: false, error: `获取AI声聊状态失败: ${err.message}` }
            }
        }
    },

    {
        name: 'list_voice_formats',
        description: '列出支持的语音格式',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            return {
                success: true,
                supported_input: [
                    { format: 'silk', description: 'QQ原生语音格式，推荐使用' },
                    { format: 'amr', description: 'AMR格式，兼容性好' },
                    { format: 'mp3', description: 'MP3格式，需要转码' },
                    { format: 'wav', description: 'WAV格式，需要转码' },
                    { format: 'ogg', description: 'OGG格式，需要转码' }
                ],
                supported_output: [
                    { format: 'mp3', description: 'MP3格式' },
                    { format: 'amr', description: 'AMR格式' },
                    { format: 'wma', description: 'WMA格式' },
                    { format: 'm4a', description: 'M4A格式' },
                    { format: 'spx', description: 'Speex格式' },
                    { format: 'ogg', description: 'OGG格式' },
                    { format: 'wav', description: 'WAV格式' },
                    { format: 'flac', description: 'FLAC格式' }
                ],
                notes: [
                    '发送语音需要协议端支持，推荐使用 silk 或 amr 格式',
                    'AI声聊功能需要 NapCat 协议端支持',
                    '语音转码可能需要 ffmpeg'
                ]
            }
        }
    },

    {
        name: 'send_voice_reply',
        description: '回复消息并发送语音',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '语音文件URL' },
                file: { type: 'string', description: '本地语音文件路径' },
                base64: { type: 'string', description: '语音base64数据' },
                reply_to: { type: 'string', description: '要回复的消息ID（不填则回复当前消息）' }
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
                
                const replyId = args.reply_to || e.message_id
                
                const msg = [
                    { type: 'reply', id: replyId },
                    { type: 'record', file: recordData }
                ]
                
                const result = await e.reply(msg)
                return { success: true, message_id: result?.message_id }
            } catch (err) {
                return { success: false, error: `发送语音回复失败: ${err.message}` }
            }
        }
    }
]
