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
        handler: async args => {
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
        name: 'send_face',
        description: '发送QQ表情',
        inputSchema: {
            type: 'object',
            properties: {
                id: {
                    type: 'number',
                    description:
                        'QQ表情ID。常用: 0(惊讶) 1(撇嘴) 2(色) 4(得意) 5(流泪) 6(害羞) 12(调皮) 14(微笑) 21(飞吻) 23(发怒) 49(拥抱) 66(爱心) 76(赞) 124(OK)'
                },
                message: { type: 'string', description: '附带的文字消息（可选）' }
            },
            required: ['id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                const msgParts = [{ type: 'face', id: args.id }]
                if (args.message) {
                    msgParts.push(args.message)
                }

                const result = await e.reply(msgParts)
                return {
                    success: true,
                    message_id: result?.message_id,
                    face_id: args.id
                }
            } catch (err) {
                return { success: false, error: `发送表情失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_mface',
        description: '发送商城表情/大表情',
        inputSchema: {
            type: 'object',
            properties: {
                emoji_id: { type: 'string', description: '表情包ID' },
                emoji_package_id: { type: 'string', description: '表情包包ID' },
                key: { type: 'string', description: '表情key（可选）' },
                summary: { type: 'string', description: '表情描述（可选）' }
            },
            required: ['emoji_id', 'emoji_package_id']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                const mfaceSeg = {
                    type: 'mface',
                    emoji_id: args.emoji_id,
                    emoji_package_id: args.emoji_package_id,
                    key: args.key || '',
                    summary: args.summary || ''
                }

                const result = await e.reply(mfaceSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送商城表情失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_flash_image',
        description: '发送闪照（阅后即焚图片）',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '图片URL' },
                file: { type: 'string', description: '本地图片路径' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                let imageData
                if (args.url) {
                    imageData = args.url
                } else if (args.file) {
                    imageData = `file://${args.file}`
                } else {
                    return { success: false, error: '需要提供 url 或 file' }
                }

                const flashSeg = {
                    type: 'image',
                    file: imageData,
                    type: 'flash'
                }

                const result = await e.reply(flashSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送闪照失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_gift',
        description: '发送礼物（需要是好友或群友）',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '接收者QQ号' },
                gift_id: {
                    type: 'number',
                    description:
                        '礼物ID。0(甜Wink) 1(快乐肥宅水) 2(幸运手链) 3(卡布奇诺) 4(猫咪手表) 5(绒绒手套) 6(彩虹糖果) 7(坚强) 8(告白话筒) 9(牵你的手) 10(可爱猫咪) 11(神秘面具) 12(我超忙的) 13(爱心口罩)'
                }
            },
            required: ['user_id', 'gift_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const userId = parseInt(args.user_id)

                // NapCat/go-cqhttp API
                if (bot.sendApi) {
                    await bot.sendApi('send_group_gift', {
                        group_id: ctx.getEvent()?.group_id,
                        user_id: userId,
                        gift_id: args.gift_id
                    })
                    return { success: true, user_id: userId, gift_id: args.gift_id }
                }

                // icqq 方式
                const friend = bot.pickFriend?.(userId)
                if (friend?.sendGift) {
                    await friend.sendGift(args.gift_id)
                    return { success: true, user_id: userId, gift_id: args.gift_id }
                }

                return { success: false, error: '当前协议不支持发送礼物' }
            } catch (err) {
                return { success: false, error: `发送礼物失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_face_list',
        description: '获取常用QQ表情ID列表',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            const faces = [
                { id: 0, name: '惊讶' },
                { id: 1, name: '撇嘴' },
                { id: 2, name: '色' },
                { id: 4, name: '得意' },
                { id: 5, name: '流泪' },
                { id: 6, name: '害羞' },
                { id: 7, name: '闭嘴' },
                { id: 8, name: '睡' },
                { id: 9, name: '大哭' },
                { id: 10, name: '尴尬' },
                { id: 11, name: '发怒' },
                { id: 12, name: '调皮' },
                { id: 13, name: '呲牙' },
                { id: 14, name: '微笑' },
                { id: 15, name: '难过' },
                { id: 16, name: '酷' },
                { id: 18, name: '抓狂' },
                { id: 19, name: '吐' },
                { id: 20, name: '偷笑' },
                { id: 21, name: '飞吻' },
                { id: 22, name: '白眼' },
                { id: 23, name: '傲慢' },
                { id: 24, name: '饥饿' },
                { id: 25, name: '困' },
                { id: 26, name: '惊恐' },
                { id: 27, name: '流汗' },
                { id: 28, name: '憨笑' },
                { id: 29, name: '悠闲' },
                { id: 30, name: '奋斗' },
                { id: 31, name: '咒骂' },
                { id: 32, name: '疑问' },
                { id: 33, name: '嘘' },
                { id: 34, name: '晕' },
                { id: 35, name: '折磨' },
                { id: 36, name: '衰' },
                { id: 37, name: '骷髅' },
                { id: 38, name: '敲打' },
                { id: 39, name: '再见' },
                { id: 49, name: '拥抱' },
                { id: 53, name: '蛋糕' },
                { id: 66, name: '爱心' },
                { id: 74, name: '太阳' },
                { id: 75, name: '月亮' },
                { id: 76, name: '赞' },
                { id: 77, name: '踩' },
                { id: 78, name: '握手' },
                { id: 79, name: 'V胜利' },
                { id: 89, name: '西瓜' },
                { id: 96, name: '冷汗' },
                { id: 97, name: '擦汗' },
                { id: 98, name: '抠鼻' },
                { id: 99, name: '鼓掌' },
                { id: 100, name: '糗大了' },
                { id: 101, name: '坏笑' },
                { id: 102, name: '左哼哼' },
                { id: 103, name: '右哼哼' },
                { id: 104, name: '哈欠' },
                { id: 105, name: '鄙视' },
                { id: 106, name: '委屈' },
                { id: 107, name: '快哭了' },
                { id: 108, name: '阴险' },
                { id: 109, name: '亲亲' },
                { id: 110, name: '吓' },
                { id: 111, name: '可怜' },
                { id: 112, name: '菜刀' },
                { id: 114, name: '篮球' },
                { id: 116, name: '示爱' },
                { id: 118, name: '抱拳' },
                { id: 119, name: '勾引' },
                { id: 120, name: '拳头' },
                { id: 121, name: '差劲' },
                { id: 122, name: '爱你' },
                { id: 123, name: 'NO' },
                { id: 124, name: 'OK' },
                { id: 179, name: 'doge' },
                { id: 180, name: '汗' },
                { id: 181, name: '滑稽' }
            ]

            return {
                success: true,
                count: faces.length,
                faces
            }
        }
    },

    {
        name: 'parse_mface',
        description: '解析消息中的商城表情信息',
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

                const mfaces = []
                for (const seg of e.message || []) {
                    if (seg.type === 'mface') {
                        mfaces.push({
                            emoji_id: seg.emoji_id || seg.data?.emoji_id,
                            emoji_package_id: seg.emoji_package_id || seg.data?.emoji_package_id,
                            key: seg.key || seg.data?.key,
                            summary: seg.summary || seg.data?.summary,
                            url: seg.url || seg.data?.url
                        })
                    }
                }

                if (mfaces.length === 0) {
                    return { success: false, error: '消息中没有商城表情' }
                }

                return {
                    success: true,
                    count: mfaces.length,
                    mfaces
                }
            } catch (err) {
                return { success: false, error: `解析商城表情失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_image',
        description: '下载图片并返回本地路径',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '图片URL' },
                filename: { type: 'string', description: '保存的文件名（可选）' }
            },
            required: ['url']
        },
        handler: async args => {
            try {
                const response = await fetch(args.url)
                if (!response.ok) {
                    return { success: false, error: `下载失败: HTTP ${response.status}` }
                }

                const buffer = await response.arrayBuffer()
                const contentType = response.headers.get('content-type') || 'image/jpeg'
                const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg'

                // 返回 base64 格式，可直接用于发送
                const base64 = Buffer.from(buffer).toString('base64')

                return {
                    success: true,
                    url: args.url,
                    size: buffer.byteLength,
                    mime_type: contentType,
                    base64: `base64://${base64}`,
                    data_url: `data:${contentType};base64,${base64}`
                }
            } catch (err) {
                return { success: false, error: `下载图片失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_markdown',
        description: '发送Markdown消息（需要协议端支持）',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'Markdown内容' }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                // 尝试发送 markdown 消息段
                const mdSeg = {
                    type: 'markdown',
                    content: args.content
                }

                const result = await e.reply(mdSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                // 如果不支持，回退到普通文本
                try {
                    const result = await ctx.getEvent().reply(args.content)
                    return {
                        success: true,
                        message_id: result?.message_id,
                        note: '不支持Markdown，已降级为纯文本'
                    }
                } catch (e) {
                    return { success: false, error: `发送Markdown失败: ${err.message}` }
                }
            }
        }
    },

    {
        name: 'send_button',
        description: '发送按钮消息（需要协议端支持）',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: '按钮配置JSON' }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                let buttonData
                try {
                    buttonData = typeof args.content === 'string' ? JSON.parse(args.content) : args.content
                } catch (e) {
                    return { success: false, error: '无效的按钮配置JSON' }
                }

                const buttonSeg = {
                    type: 'button',
                    data: buttonData
                }

                const result = await e.reply(buttonSeg)
                return {
                    success: true,
                    message_id: result?.message_id
                }
            } catch (err) {
                return { success: false, error: `发送按钮失败: ${err.message}` }
            }
        }
    }
]
