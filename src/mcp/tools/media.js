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
    }
]
