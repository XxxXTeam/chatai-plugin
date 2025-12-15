/**
 * 媒体处理工具
 * 图片解析、语音处理、视频处理等
 */

import fetch from 'node-fetch'

export const mediaTools = [
    {
        name: 'parse_image',
        description: '解析消息中的图片，获取图片URL或base64数据',
        inputSchema: {
            type: 'object',
            properties: {
                image_url: { type: 'string', description: '图片URL，不填则从当前消息获取' },
                to_base64: { type: 'boolean', description: '是否转换为base64，默认false' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                
                // 从消息中获取图片
                let images = []
                if (args.image_url) {
                    images = [args.image_url]
                } else if (e?.img?.length > 0) {
                    images = e.img.map(img => img.url || img.file || img)
                } else if (e?.message) {
                    // 从消息段中提取
                    for (const seg of e.message) {
                        if (seg.type === 'image') {
                            images.push(seg.url || seg.file || seg.data?.url)
                        }
                    }
                }
                
                if (images.length === 0) {
                    return { success: false, error: '没有找到图片' }
                }
                
                const results = []
                for (const url of images) {
                    if (!url) continue
                    
                    const result = { url }
                    
                    if (args.to_base64) {
                        try {
                            const response = await fetch(url)
                            if (response.ok) {
                                const buffer = await response.arrayBuffer()
                                const contentType = response.headers.get('content-type') || 'image/jpeg'
                                result.base64 = `data:${contentType};base64,${Buffer.from(buffer).toString('base64')}`
                                result.mimeType = contentType
                                result.size = buffer.byteLength
                            }
                        } catch (err) {
                            result.error = err.message
                        }
                    }
                    
                    results.push(result)
                }
                
                return {
                    success: true,
                    count: results.length,
                    images: results
                }
            } catch (err) {
                return { success: false, error: `解析图片失败: ${err.message}` }
            }
        }
    },

    {
        name: 'generate_qrcode',
        description: '生成二维码图片',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要编码的文本内容' },
                size: { type: 'number', description: '二维码尺寸（像素），默认200' }
            },
            required: ['text']
        },
        handler: async (args, ctx) => {
            try {
                const size = args.size || 200
                // 使用公共 API 生成二维码
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(args.text)}`
                
                const e = ctx.getEvent()
                if (e) {
                    await e.reply(segment.image(qrUrl))
                }
                
                return {
                    success: true,
                    url: qrUrl,
                    text: args.text,
                    size
                }
            } catch (err) {
                return { success: false, error: `生成二维码失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_image_info',
        description: '获取图片的基本信息（尺寸、格式等）',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '图片URL' }
            },
            required: ['url']
        },
        handler: async (args) => {
            try {
                const response = await fetch(args.url, { method: 'HEAD' })
                
                return {
                    success: true,
                    url: args.url,
                    contentType: response.headers.get('content-type'),
                    contentLength: response.headers.get('content-length'),
                    status: response.status
                }
            } catch (err) {
                return { success: false, error: `获取图片信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_image',
        description: '发送图片消息',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '图片URL' },
                base64: { type: 'string', description: '图片base64数据（与url二选一）' },
                message: { type: 'string', description: '附带的文字消息' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                const msgParts = []
                
                if (args.url) {
                    msgParts.push(segment.image(args.url))
                } else if (args.base64) {
                    msgParts.push(segment.image(`base64://${args.base64.replace(/^data:[^;]+;base64,/, '')}`))
                } else {
                    return { success: false, error: '需要提供 url 或 base64' }
                }
                
                if (args.message) {
                    msgParts.push(args.message)
                }
                
                const result = await e.reply(msgParts)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送图片失败: ${err.message}` }
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
                
                // 从消息中查找语音
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
                
                return {
                    success: true,
                    voice: voiceInfo
                }
            } catch (err) {
                return { success: false, error: `解析语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_voice',
        description: '发送语音消息。支持URL、本地文件路径或base64数据',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '语音文件URL' },
                file: { type: 'string', description: '本地文件路径（绝对路径）' },
                base64: { type: 'string', description: '语音base64数据' },
                magic: { type: 'boolean', description: '是否变声，默认false' }
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
                
                // 构建语音消息段
                const recordSeg = {
                    type: 'record',
                    file: recordData,
                    magic: args.magic ? 1 : 0
                }
                
                const result = await e.reply(recordSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_tts',
        description: '发送文字转语音(TTS)消息。将文字转为语音并发送',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要转换为语音的文字内容' }
            },
            required: ['text']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                // TTS 消息段（NapCat/go-cqhttp 支持）
                const ttsSeg = {
                    type: 'tts',
                    text: args.text
                }
                
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

    {
        name: 'send_video',
        description: '发送短视频消息',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '视频文件URL' },
                file: { type: 'string', description: '本地视频文件路径' },
                cover: { type: 'string', description: '视频封面图URL（可选）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                let videoData
                if (args.url) {
                    videoData = args.url
                } else if (args.file) {
                    videoData = `file://${args.file}`
                } else {
                    return { success: false, error: '需要提供 url 或 file' }
                }
                
                const videoSeg = {
                    type: 'video',
                    file: videoData
                }
                
                if (args.cover) {
                    videoSeg.cover = args.cover
                }
                
                const result = await e.reply(videoSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送视频失败: ${err.message}` }
            }
        }
    },

    {
        name: 'parse_video',
        description: '获取消息中的视频信息',
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
                
                let videoInfo = null
                for (const seg of e.message || []) {
                    if (seg.type === 'video') {
                        const data = seg.data || seg
                        videoInfo = {
                            url: data.url || data.file,
                            file: data.file,
                            file_id: data.file_id,
                            cover: data.cover,
                            file_size: data.file_size
                        }
                        break
                    }
                }
                
                if (!videoInfo) {
                    return { success: false, error: '消息中没有视频' }
                }
                
                return {
                    success: true,
                    video: videoInfo
                }
            } catch (err) {
                return { success: false, error: `解析视频失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_poke',
        description: '发送戳一戳消息',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'number', description: '要戳的用户QQ号' }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                const bot = e.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                // 群聊戳一戳
                if (e.group_id) {
                    if (bot.pickGroup) {
                        const group = bot.pickGroup(e.group_id)
                        if (group?.pokeMember) {
                            await group.pokeMember(args.user_id)
                            return { success: true, target: args.user_id, group_id: e.group_id }
                        }
                    }
                    // NapCat/go-cqhttp API
                    if (bot.sendGroupPoke || bot.group_poke) {
                        await (bot.sendGroupPoke || bot.group_poke)(e.group_id, args.user_id)
                        return { success: true, target: args.user_id, group_id: e.group_id }
                    }
                } else {
                    // 私聊戳一戳
                    if (bot.pickFriend) {
                        const friend = bot.pickFriend(args.user_id)
                        if (friend?.poke) {
                            await friend.poke()
                            return { success: true, target: args.user_id }
                        }
                    }
                    if (bot.sendFriendPoke || bot.friend_poke) {
                        await (bot.sendFriendPoke || bot.friend_poke)(args.user_id)
                        return { success: true, target: args.user_id }
                    }
                }
                
                return { success: false, error: '当前环境不支持戳一戳' }
            } catch (err) {
                return { success: false, error: `发送戳一戳失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_dice',
        description: '发送骰子表情',
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
                
                const diceSeg = { type: 'dice' }
                const result = await e.reply(diceSeg)
                
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送骰子失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_rps',
        description: '发送猜拳表情（石头剪刀布）',
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
                
                const rpsSeg = { type: 'rps' }
                const result = await e.reply(rpsSeg)
                
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送猜拳失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_music',
        description: '发送音乐分享卡片',
        inputSchema: {
            type: 'object',
            properties: {
                type: { 
                    type: 'string', 
                    enum: ['qq', '163', 'xm', 'custom'],
                    description: '音乐平台类型: qq(QQ音乐), 163(网易云), xm(虾米), custom(自定义)'
                },
                id: { type: 'string', description: '音乐ID（qq/163/xm平台使用）' },
                url: { type: 'string', description: '跳转链接（custom类型使用）' },
                audio: { type: 'string', description: '音频链接（custom类型使用）' },
                title: { type: 'string', description: '标题（custom类型使用）' },
                content: { type: 'string', description: '描述（custom类型使用）' },
                image: { type: 'string', description: '封面图（custom类型使用）' }
            },
            required: ['type']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                let musicSeg
                if (args.type === 'custom') {
                    if (!args.url || !args.audio || !args.title) {
                        return { success: false, error: 'custom类型需要提供 url, audio, title' }
                    }
                    musicSeg = {
                        type: 'music',
                        subType: 'custom',
                        url: args.url,
                        audio: args.audio,
                        title: args.title,
                        content: args.content || '',
                        image: args.image || ''
                    }
                } else {
                    if (!args.id) {
                        return { success: false, error: '需要提供音乐ID' }
                    }
                    musicSeg = {
                        type: 'music',
                        subType: args.type,
                        id: args.id
                    }
                }
                
                const result = await e.reply(musicSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送音乐失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_location',
        description: '发送位置分享',
        inputSchema: {
            type: 'object',
            properties: {
                lat: { type: 'number', description: '纬度' },
                lon: { type: 'number', description: '经度' },
                title: { type: 'string', description: '位置名称' },
                content: { type: 'string', description: '详细地址' }
            },
            required: ['lat', 'lon']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                const locationSeg = {
                    type: 'location',
                    lat: args.lat,
                    lon: args.lon,
                    title: args.title || '位置',
                    content: args.content || ''
                }
                
                const result = await e.reply(locationSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送位置失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_share',
        description: '发送链接分享卡片',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '链接URL' },
                title: { type: 'string', description: '标题' },
                content: { type: 'string', description: '描述内容' },
                image: { type: 'string', description: '预览图URL' }
            },
            required: ['url', 'title']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                
                const shareSeg = {
                    type: 'share',
                    url: args.url,
                    title: args.title,
                    content: args.content || '',
                    image: args.image || ''
                }
                
                const result = await e.reply(shareSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送分享失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_msg_emoji_like',
        description: '对消息设置表情回应（NapCat扩展）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID' },
                emoji_id: { type: 'string', description: '表情ID' }
            },
            required: ['message_id', 'emoji_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                
                // NapCat API
                if (bot.set_msg_emoji_like) {
                    await bot.set_msg_emoji_like(args.message_id, args.emoji_id)
                    return { success: true }
                }
                
                // 其他可能的 API 名称
                if (bot.setMsgEmojiLike) {
                    await bot.setMsgEmojiLike(args.message_id, args.emoji_id)
                    return { success: true }
                }
                
                return { success: false, error: '当前环境不支持消息表情回应' }
            } catch (err) {
                return { success: false, error: `设置表情回应失败: ${err.message}` }
            }
        }
    }
]
