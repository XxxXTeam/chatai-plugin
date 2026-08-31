/**
 * QQ空间说说相关工具
 * 支持发布说说、获取说说列表、点赞、删除等操作
 * 兼容 icqq（直接读取 bot.cookies）和 NapCat/go-cqhttp（通过 get_cookies API）
 */

import { chatLogger as logger } from '../../core/utils/logger.js'
import { StandardBotApi } from '../../core/platform/index.js'

/** 单条说说最多携带的图片数（QQ 空间侧限制） */
const MAX_MOOD_IMAGES = 9

/** 单张图片下载的体积上限（字节）。图片 URL 由模型给出，必须设硬上限，避免超大响应整个读进内存 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * QQ 空间接口返回体的 JSONP 包装剥离正则
 * @description s 标志不可省略：响应体含换行时 . 匹配不到换行会导致剥离失败，
 *              JSON.parse 抛错后走到失败分支，出现“说说实际已发布却返回 success:false”的误判
 */
const JSONP_PAYLOAD_PATTERN = /^[^{]*({.*})[^}]*$/s

/**
 * 从 p_skey 计算 g_tk（QQ空间鉴权令牌）
 * @param {string} skey - p_skey 值
 * @returns {number}
 */
function calcGtk(skey) {
    if (!skey) return 0
    let hash = 5381
    for (let i = 0; i < skey.length; i++) {
        hash += (hash << 5) + skey.charCodeAt(i)
    }
    return hash & 0x7fffffff
}

/**
 * 从 cookie 字符串中提取指定 key 的值
 * @param {string} cookies - Cookie 字符串
 * @param {string} key - Cookie 键名
 * @returns {string|null}
 */
function getCookieValue(cookies, key) {
    if (!cookies) return null
    const match = cookies.match(new RegExp(`(?:^|;\\s*)${key}=([^;]+)`))
    return match ? match[1] : null
}

/**
 * 获取 QQ 空间认证信息
 * 兼容 icqq（bot.cookies 直接可用）和 NapCat/go-cqhttp（通过 OneBot API）
 * @param {StandardBotApi} api - 标准 Bot API
 * @returns {Promise<{cookies: string, gtk: number, uin: string}>}
 */
async function getQzoneAuth(api) {
    const { cookies, userId: uin } = await api.getCredentials('qzone.qq.com')
    if (!cookies) {
        throw new Error(
            '无法获取QQ空间认证信息。' +
                'icqq 需要正常登录且协议端已缓存 cookies；' +
                'NapCat/go-cqhttp 需要支持 get_cookies API'
        )
    }

    let pskey = getCookieValue(cookies, 'p_skey')
    if (!pskey) pskey = getCookieValue(cookies, 'skey')
    const gtk = calcGtk(pskey || '')

    return { cookies, gtk, uin }
}

/**
 * QQ空间 API 请求公共 headers
 * @param {string} cookies
 * @param {string} uin
 * @returns {Object}
 */
function qzoneHeaders(cookies, uin) {
    return {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookies,
        Referer: `https://user.qzone.qq.com/${uin}`,
        Origin: 'https://user.qzone.qq.com',
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
}

export const qzoneTools = [
    {
        name: 'publish_qzone_mood',
        description:
            '发布QQ空间说说（心情动态）。' +
            '可以发布纯文字说说，或包含图片的说说。' +
            '需要协议端支持 get_cookies API（如NapCat）。',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: '说说文字内容'
                },
                image_urls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '图片URL列表（可选），最多9张'
                }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const { cookies, gtk, uin } = await getQzoneAuth(api)
                const { content, image_urls = [] } = args

                /* 构建发布参数 */
                const params = new URLSearchParams()
                params.append('syn_tweet_verson', '1')
                params.append('paramstr', '1')
                params.append('who', '1')
                params.append('con', content)
                params.append('feedversion', '1')
                params.append('ver', '1')
                params.append('ugc_right', '1')
                params.append('to_sign', '0')
                params.append('hostuin', uin)
                params.append('code_version', '1')
                params.append('format', 'json')
                params.append('qzreferrer', `https://user.qzone.qq.com/${uin}`)

                /* 处理图片上传：picInfos 提到块外，返回值需要用实际成功数而非请求数 */
                const picInfos = []
                const uploadErrors = []
                if (image_urls.length > 0) {
                    for (let i = 0; i < Math.min(image_urls.length, MAX_MOOD_IMAGES); i++) {
                        try {
                            picInfos.push(await uploadQzoneImage(cookies, gtk, uin, image_urls[i]))
                        } catch (err) {
                            logger.warn(`[QZone] 上传第${i + 1}张图片失败:`, err.message)
                            uploadErrors.push(`第${i + 1}张: ${err.message}`)
                        }
                    }

                    if (picInfos.length > 0) {
                        const picBo = picInfos
                            .map(
                                (p, i) =>
                                    `"${i}":{"url":"${p.url}","width":${p.width || 0},"height":${p.height || 0},"pre":"${p.pre || p.url}"}`
                            )
                            .join(',')
                        params.append('pic_bo', `{${picBo}}`)
                        params.append('richtype', '1')
                        params.append(
                            'richval',
                            picInfos
                                .map(
                                    p =>
                                        `\t${p.bo}\t${p.url}\t${p.width || 0}\t${p.height || 0}\t${p.width || 0}\t${p.height || 0}\t0`
                                )
                                .join('\t')
                        )
                    }
                }

                const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk=${gtk}`
                const response = await fetch(url, {
                    method: 'POST',
                    headers: qzoneHeaders(cookies, uin),
                    body: params.toString(),
                    signal: AbortSignal.timeout(15000)
                })

                const text = await response.text()

                /* 解析响应 */
                let data
                try {
                    /* 响应可能是 JSONP 格式 */
                    const jsonStr = text.replace(JSONP_PAYLOAD_PATTERN, '$1')
                    data = JSON.parse(jsonStr)
                } catch {
                    data = { message: text }
                }

                if (data.code === 0 || data.ret === 0 || data.subcode === 0) {
                    return {
                        success: true,
                        message: '说说发布成功',
                        tid: data.tid || data.feedinfo?.tid,
                        content: content.substring(0, 50),
                        /* 带图数量取上传成功数，请求数单独用 image_requested 暴露 */
                        image_count: picInfos.length,
                        image_requested: image_urls.length,
                        ...(uploadErrors.length > 0 && { image_errors: uploadErrors })
                    }
                }

                return {
                    success: false,
                    error: data.message || data.msg || `发布失败: code=${data.code || data.ret}`,
                    detail: data
                }
            } catch (err) {
                return { success: false, error: `发布说说失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_qzone_feeds',
        description: '获取QQ空间说说列表。' + '可以获取自己或好友的说说动态。' + '需要协议端支持 get_cookies API。',
        inputSchema: {
            type: 'object',
            properties: {
                target_uin: {
                    type: 'string',
                    description: '目标QQ号（可选），不填则获取自己的说说'
                },
                count: {
                    type: 'number',
                    description: '获取数量，默认10，最多40'
                },
                pos: {
                    type: 'number',
                    description: '起始位置，用于翻页，默认0'
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const { cookies, gtk, uin } = await getQzoneAuth(api)
                const targetUin = args?.target_uin || uin
                const count = Math.min(args?.count || 10, 40)
                const pos = args?.pos || 0

                const params = new URLSearchParams({
                    uin: targetUin,
                    ftype: '0',
                    sort: '0',
                    pos: String(pos),
                    num: String(count),
                    replynum: '10',
                    g_tk: String(gtk),
                    code_version: '1',
                    format: 'json',
                    need_private_comment: '1'
                })

                const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_msglist_v6?${params.toString()}`
                const response = await fetch(url, {
                    method: 'GET',
                    headers: qzoneHeaders(cookies, uin),
                    signal: AbortSignal.timeout(15000)
                })

                const text = await response.text()

                let data
                try {
                    const jsonStr = text.replace(JSONP_PAYLOAD_PATTERN, '$1')
                    data = JSON.parse(jsonStr)
                } catch {
                    return { success: false, error: '解析响应失败' }
                }

                if (data.code !== 0 && data.ret !== 0) {
                    return {
                        success: false,
                        error: data.message || data.msg || `获取失败: code=${data.code}`
                    }
                }

                const msglist = data.msglist || []
                const feeds = msglist.map(msg => ({
                    tid: msg.tid,
                    content: msg.content || msg.con,
                    create_time: msg.createTime || msg.created_time,
                    comment_count: msg.commentlist?.length || msg.cmtnum || 0,
                    like_count: msg.fwdnum || 0,
                    images: (msg.pic || []).map(p => ({
                        url: p.url1 || p.url2 || p.url3,
                        width: p.width,
                        height: p.height
                    })),
                    source_name: msg.source_name,
                    uin: msg.uin
                }))

                return {
                    success: true,
                    target_uin: targetUin,
                    total: data.total || feeds.length,
                    pos,
                    count: feeds.length,
                    feeds
                }
            } catch (err) {
                return { success: false, error: `获取说说列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'like_qzone_post',
        description: '点赞QQ空间说说。' + '需要提供说说的 tid（可通过 get_qzone_feeds 获取）。',
        inputSchema: {
            type: 'object',
            properties: {
                target_uin: {
                    type: 'string',
                    description: '说说所属的QQ号'
                },
                tid: {
                    type: 'string',
                    description: '说说ID（tid）'
                }
            },
            required: ['target_uin', 'tid']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const { cookies, gtk, uin } = await getQzoneAuth(api)
                const { target_uin, tid } = args

                const params = new URLSearchParams({
                    opuin: uin,
                    unikey: `http://user.qzone.qq.com/${target_uin}/mood/${tid}`,
                    curkey: `http://user.qzone.qq.com/${target_uin}/mood/${tid}`,
                    from: '1',
                    appid: '311',
                    typeid: '0',
                    abstime: String(Math.floor(Date.now() / 1000)),
                    fid: tid,
                    format: 'json'
                })

                const url = `https://user.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/likes/internal_dolike_app?g_tk=${gtk}`
                const response = await fetch(url, {
                    method: 'POST',
                    headers: qzoneHeaders(cookies, uin),
                    body: params.toString(),
                    signal: AbortSignal.timeout(10000)
                })

                const text = await response.text()
                let data
                try {
                    const jsonStr = text.replace(JSONP_PAYLOAD_PATTERN, '$1')
                    data = JSON.parse(jsonStr)
                } catch {
                    data = { message: text }
                }

                if (data.ret === 0 || data.code === 0) {
                    return { success: true, message: '点赞成功', target_uin, tid }
                }

                return {
                    success: false,
                    error: data.message || data.msg || '点赞失败'
                }
            } catch (err) {
                return { success: false, error: `点赞失败: ${err.message}` }
            }
        }
    },

    {
        name: 'delete_qzone_mood',
        description: '删除自己的QQ空间说说。' + '只能删除自己发布的说说。',
        inputSchema: {
            type: 'object',
            properties: {
                tid: {
                    type: 'string',
                    description: '要删除的说说ID（tid）'
                }
            },
            required: ['tid']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const { cookies, gtk, uin } = await getQzoneAuth(api)
                const { tid } = args

                const params = new URLSearchParams({
                    hostuin: uin,
                    tid,
                    t1_source: '1',
                    code_version: '1',
                    format: 'json'
                })

                const url = `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6?g_tk=${gtk}`
                const response = await fetch(url, {
                    method: 'POST',
                    headers: qzoneHeaders(cookies, uin),
                    body: params.toString(),
                    signal: AbortSignal.timeout(10000)
                })

                const text = await response.text()
                let data
                try {
                    const jsonStr = text.replace(JSONP_PAYLOAD_PATTERN, '$1')
                    data = JSON.parse(jsonStr)
                } catch {
                    data = { message: text }
                }

                if (data.code === 0 || data.ret === 0 || data.subcode === 0) {
                    return { success: true, message: '说说删除成功', tid }
                }

                return {
                    success: false,
                    error: data.message || data.msg || '删除失败'
                }
            } catch (err) {
                return { success: false, error: `删除说说失败: ${err.message}` }
            }
        }
    },

    {
        name: 'set_self_longnick',
        description: '设置机器人的个性签名/个人说明',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: '个性签名内容'
                }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const { content } = args
                await api.callAction('set_self_longnick', { long_nick: content }, { strict: true })
                return { success: true, message: '个性签名设置成功', content }
            } catch (err) {
                return { success: false, error: `设置签名失败: ${err.message}` }
            }
        }
    },

    {
        name: 'friend_poke',
        description: '戳一戳好友，兼容 icqq 和 NapCat/go-cqhttp',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: {
                    type: 'string',
                    description: '目标好友的QQ号'
                }
            },
            required: ['user_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const userId = api.targetId(args.user_id)
                if (userId === null || userId === undefined || userId === '') {
                    return { success: false, error: `user_id 格式错误: ${args.user_id}` }
                }
                await api.pokeUser(userId)
                return { success: true, message: '戳一戳成功', user_id: userId }
            } catch (err) {
                return { success: false, error: `戳一戳失败: ${err.message}` }
            }
        }
    },

    {
        name: 'group_poke',
        description: '在群里戳一戳某人，兼容 icqq 和 NapCat/go-cqhttp',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: {
                    type: 'string',
                    description: '群号'
                },
                user_id: {
                    type: 'string',
                    description: '目标成员的QQ号'
                }
            },
            required: ['group_id', 'user_id']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const groupId = api.targetId(args.group_id)
                const userId = api.targetId(args.user_id)
                if (groupId === null || groupId === undefined || groupId === '') {
                    return { success: false, error: `group_id 格式错误: ${args.group_id}` }
                }
                if (userId === null || userId === undefined || userId === '') {
                    return { success: false, error: `user_id 格式错误: ${args.user_id}` }
                }
                await api.pokeMember(groupId, userId)
                return { success: true, message: '群内戳一戳成功', group_id: groupId, user_id: userId }
            } catch (err) {
                return { success: false, error: `群内戳一戳失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_profile_like',
        description: '获取QQ资料卡点赞信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const result = await api.callAction('get_profile_like', {}, { strict: true })
                const data = result?.data || result

                return {
                    success: true,
                    like_info: data
                }
            } catch (err) {
                return { success: false, error: `获取点赞信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'create_collection',
        description: '创建QQ收藏（将内容添加到QQ收藏夹）',
        inputSchema: {
            type: 'object',
            properties: {
                rawData: {
                    type: 'string',
                    description: '收藏内容的原始文本'
                },
                brief: {
                    type: 'string',
                    description: '收藏的简要描述'
                }
            },
            required: ['rawData', 'brief']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                await api.callAction(
                    'create_collection',
                    {
                        rawData: args.rawData,
                        brief: args.brief
                    },
                    { strict: true }
                )

                return { success: true, message: '收藏创建成功', brief: args.brief }
            } catch (err) {
                return { success: false, error: `创建收藏失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_collection_list',
        description: '获取QQ收藏列表',
        inputSchema: {
            type: 'object',
            properties: {
                category: {
                    type: 'number',
                    description: '收藏分类，默认0（全部）'
                },
                count: {
                    type: 'number',
                    description: '获取数量，默认20'
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                const result = await api.callAction(
                    'get_collection_list',
                    {
                        category: args?.category || 0,
                        count: args?.count || 20
                    },
                    { strict: true }
                )

                const data = result?.data || result
                return {
                    success: true,
                    collections: Array.isArray(data) ? data : data?.collections || []
                }
            } catch (err) {
                return { success: false, error: `获取收藏列表失败: ${err.message}` }
            }
        }
    }
]

/**
 * 按体积上限读取响应体
 * @description 先用 Content-Length 预检，再在流式读取过程中累计字节数，任一环节超限立即中断，
 *              避免 arrayBuffer() 把来源不可控的超大响应整体读进内存
 * @param {Response} response - fetch 响应对象
 * @param {number} limit - 体积上限（字节）
 * @returns {Promise<Buffer>} 响应体
 * @throws {Error} 响应体超出上限
 */
async function readBodyWithLimit(response, limit) {
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > limit) {
        throw new Error(`图片体积 ${declared} 字节超出上限 ${limit} 字节`)
    }

    if (!response.body) {
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length > limit) {
            throw new Error(`图片体积 ${buffer.length} 字节超出上限 ${limit} 字节`)
        }
        return buffer
    }

    const chunks = []
    let total = 0
    for await (const chunk of response.body) {
        total += chunk.length
        if (total > limit) {
            throw new Error(`图片体积超出上限 ${limit} 字节（读到 ${total} 字节后中断）`)
        }
        chunks.push(Buffer.from(chunk))
    }

    return Buffer.concat(chunks)
}

/**
 * 上传图片到QQ空间
 * @param {string} cookies - Cookie 字符串
 * @param {number} gtk - g_tk 令牌
 * @param {string} uin - QQ号
 * @param {string} imageUrl - 图片URL
 * @returns {Promise<{url: string, bo: string, width: number, height: number, pre: string}>} 上传结果
 * @throws {Error} 下载失败、体积超限、响应解析失败或协议端返回失败；调用方需据此统计实际成功数
 */
async function uploadQzoneImage(cookies, gtk, uin, imageUrl) {
    try {
        /* 下载图片 */
        let imageBuffer
        if (imageUrl.startsWith('base64://')) {
            imageBuffer = Buffer.from(imageUrl.replace('base64://', ''), 'base64')
        } else if (imageUrl.startsWith('data:image')) {
            const base64Data = imageUrl.split(',')[1]
            if (!base64Data) throw new Error('data:image URL 缺少 base64 数据段')
            imageBuffer = Buffer.from(base64Data, 'base64')
        } else {
            const isQQPic = imageUrl.includes('gchat.qpic.cn') || imageUrl.includes('c2cpicdw.qpic.cn')
            const referer = isQQPic ? 'https://qzone.qq.com/' : undefined
            const { fetchDownloadResponse } = await import('./file.js')
            const { response } = await fetchDownloadResponse(imageUrl, {
                timeoutMs: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    ...(referer && { Referer: referer })
                }
            })
            if (!response.ok) throw new Error(`下载图片失败: HTTP ${response.status}`)
            imageBuffer = await readBodyWithLimit(response, MAX_IMAGE_BYTES)
        }

        /* base64 / data URL 分支同样要卡上限 */
        if (imageBuffer.length === 0) throw new Error('图片内容为空')
        if (imageBuffer.length > MAX_IMAGE_BYTES) {
            throw new Error(`图片体积 ${imageBuffer.length} 字节超出上限 ${MAX_IMAGE_BYTES} 字节`)
        }

        /* 构建 multipart 上传 */
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2)
        const filename = `upload_${Date.now()}.jpg`

        const bodyParts = [
            `--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n${filename}`,
            `--${boundary}\r\nContent-Disposition: form-data; name="uin"\r\n\r\n${uin}`,
            `--${boundary}\r\nContent-Disposition: form-data; name="skey"\r\n\r\n${getCookieValue(cookies, 'skey') || ''}`,
            `--${boundary}\r\nContent-Disposition: form-data; name="zzpaneluin"\r\n\r\n${uin}`,
            `--${boundary}\r\nContent-Disposition: form-data; name="output_type"\r\n\r\njson`,
            `--${boundary}\r\nContent-Disposition: form-data; name="qzonetoken"\r\n\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="uploadtype"\r\n\r\n1`,
            `--${boundary}\r\nContent-Disposition: form-data; name="pic"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`
        ]

        const headerBuffer = Buffer.from(bodyParts.join('\r\n') + '\r\n')
        const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`)
        const body = Buffer.concat([headerBuffer, imageBuffer, footerBuffer])

        const uploadUrl = `https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${gtk}`
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                Cookie: cookies,
                Referer: `https://user.qzone.qq.com/${uin}`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body,
            signal: AbortSignal.timeout(30000)
        })

        const text = await response.text()

        let data
        try {
            /* 响应可能包装在回调中 */
            const jsonStr = text.replace(JSONP_PAYLOAD_PATTERN, '$1')
            data = JSON.parse(jsonStr)
        } catch {
            logger.warn('[QZone] 解析上传响应失败:', text.substring(0, 200))
            throw new Error(`解析上传响应失败: ${text.substring(0, 100)}`)
        }

        if (data.ret === 0 && data.data?.url) {
            return {
                url: data.data.url,
                bo: data.data.bo || '',
                width: data.data.width,
                height: data.data.height,
                pre: data.data.pre || data.data.url
            }
        }

        /* 失败必须抛出：返回 null 会让调用方无从区分“上传失败”与“上传成功但无返回” */
        throw new Error(data.msg || data.message || `上传失败: ret=${data.ret}`)
    } catch (err) {
        logger.warn('[QZone] 上传图片异常:', err.message)
        throw err
    }
}
