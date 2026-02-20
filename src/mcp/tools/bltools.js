import fetch from 'node-fetch'
import crypto from 'crypto'
import config from '../../../config/config.js'

export const bltoolsTools = [
    {
        name: 'search_music_qq',
        description: '搜索QQ音乐并发送音乐卡片',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: {
                    type: 'string',
                    description: '歌曲名或歌曲名+歌手名'
                },
                random: {
                    type: 'boolean',
                    description: '是否从搜索结果中随机选择（适用于只提供歌手名的情况）',
                    default: false
                }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            const { keyword, random = false } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            try {
                const searchCount = random ? 20 : 1
                const body = {
                    comm: { uin: '0', authst: '', ct: 29 },
                    search: {
                        method: 'DoSearchForQQMusicMobile',
                        module: 'music.search.SearchCgiService',
                        param: {
                            grp: 1,
                            num_per_page: searchCount,
                            page_num: 1,
                            query: keyword,
                            remoteplace: 'miniapp.1109523715',
                            search_type: 0,
                            searchid: String(Date.now())
                        }
                    }
                }

                const response = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                })

                const res = await response.json()
                if (res?.code !== 0) return { error: '搜索失败' }

                const songBody = res.search?.data?.body || {}
                const songs = songBody.song?.list || songBody.item_song || []

                if (!songs.length) return { error: '未找到相关音乐' }

                const selectedSong = random ? songs[Math.floor(Math.random() * songs.length)] : songs[0]

                const name = selectedSong.title?.replace(/<\/?em>/g, '') || '未知'
                const artist = selectedSong.singer?.map(s => s.name).join('/') || '未知'
                const mid = selectedSong.mid
                const albumMid = selectedSong.album?.mid || ''

                const pic = albumMid ? `http://y.gtimg.cn/music/photo_new/T002R150x150M000${albumMid}.jpg` : ''

                const code = crypto
                    .createHash('md5')
                    .update(`${mid}q;z(&l~sdf2!nK`)
                    .digest('hex')
                    .substring(0, 5)
                    .toUpperCase()

                const audioUrl = `http://c6.y.qq.com/rsc/fcgi-bin/fcg_pyq_play.fcg?songmid=${mid}&songtype=1&fromtag=50&code=${code}`

                const musicMsg = {
                    type: 'music',
                    data: {
                        type: 'custom',
                        url: `https://y.qq.com/n/yqq/song/${mid}.html`,
                        audio: audioUrl,
                        title: name,
                        image: pic,
                        singer: artist
                    }
                }

                await e.reply(musicMsg)

                return {
                    success: true,
                    song: { name, artist, mid },
                    message: `已发送音乐：${name} - ${artist}`
                }
            } catch (error) {
                return { error: `音乐搜索失败: ${error.message}` }
            }
        }
    },

    {
        name: 'search_emoji',
        description: '搜索表情包并发送',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: {
                    type: 'string',
                    description: '表情包搜索关键词'
                },
                count: {
                    type: 'number',
                    description: '发送数量(1-10)',
                    default: 1
                }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            const { keyword, count = 1 } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            const validCount = Math.min(Math.max(parseInt(count) || 1, 1), 10)

            try {
                const headers = {
                    accept: 'application/json',
                    'accept-language': 'zh-CN,zh;q=0.9',
                    'user-agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
                    'x-requested-with': 'XMLHttpRequest'
                }

                const apiUrl = `https://www.duitang.com/napi/blog/list/by_search/?kw=${encodeURIComponent(keyword)}&start=0&limit=48`
                const response = await fetch(apiUrl, { headers })
                const data = await response.json()

                const imageUrls = []
                if (data.data?.object_list) {
                    for (const item of data.data.object_list) {
                        if (item.photo?.path) {
                            imageUrls.push(item.photo.path)
                        }
                    }
                }

                if (imageUrls.length === 0) {
                    return { error: '未找到相关表情包' }
                }

                // 随机打乱
                for (let i = imageUrls.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1))
                    ;[imageUrls[i], imageUrls[j]] = [imageUrls[j], imageUrls[i]]
                }

                const selectedUrls = imageUrls.slice(0, validCount)
                let successCount = 0

                for (const url of selectedUrls) {
                    try {
                        await e.reply(segment.image(url))
                        successCount++
                    } catch (err) {
                        logger.warn(`[search_emoji] 发送图片失败: ${err.message}`)
                    }
                }

                if (successCount === 0) {
                    return { error: '所有图片发送失败' }
                }

                return {
                    success: true,
                    count: successCount,
                    message: `已发送 ${successCount} 张表情包`
                }
            } catch (error) {
                return { error: `表情包搜索失败: ${error.message}` }
            }
        }
    },

    {
        name: 'search_image_bing',
        description: '使用Bing搜索图片并发送',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '图片搜索关键词'
                },
                count: {
                    type: 'number',
                    description: '返回图片数量(1-10)',
                    default: 3
                }
            },
            required: ['query']
        },
        handler: async (args, ctx) => {
            const { query, count = 3 } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            const validCount = Math.min(Math.max(parseInt(count) || 3, 1), 10)

            try {
                const gecSignature = crypto.randomBytes(32).toString('hex').toUpperCase()
                const clientData = Buffer.from(
                    JSON.stringify({
                        1: '2',
                        2: '1',
                        4: Date.now().toString(),
                        6: 'stable',
                        9: 'desktop'
                    })
                ).toString('base64')

                const headers = {
                    accept: '*/*',
                    'accept-language': 'zh-CN,zh;q=0.9',
                    'sec-ch-ua': '"Microsoft Edge";v="131"',
                    'sec-ms-gec': gecSignature,
                    'x-client-data': clientData,
                    Referer: 'https://cn.bing.com/visualsearch',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }

                const url = `https://cn.bing.com/images/vsasync?q=${encodeURIComponent(query)}&count=${validCount * 2}`
                const response = await fetch(url, { headers })
                const data = await response.json()

                const imageUrls = (data.results || []).map(item => item.imageUrl).filter(Boolean)

                if (imageUrls.length === 0) {
                    return { error: '未找到相关图片' }
                }

                // 随机打乱
                for (let i = imageUrls.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1))
                    ;[imageUrls[i], imageUrls[j]] = [imageUrls[j], imageUrls[i]]
                }

                const selectedUrls = imageUrls.slice(0, validCount)
                let successCount = 0

                for (const imgUrl of selectedUrls) {
                    try {
                        await e.reply(segment.image(imgUrl))
                        successCount++
                    } catch (err) {
                        logger.warn(`[search_image_bing] 发送图片失败: ${err.message}`)
                    }
                }

                if (successCount === 0) {
                    return { error: '所有图片发送失败' }
                }

                return {
                    success: true,
                    count: successCount,
                    message: `已发送 ${successCount} 张图片`
                }
            } catch (error) {
                return { error: `图片搜索失败: ${error.message}` }
            }
        }
    },

    {
        name: 'set_msg_reaction',
        description: '对消息添加表情回应（贴表情），可从聊天记录的[消息ID:xxx]获取message_id',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: {
                    type: 'string',
                    description: '要添加表情回应的消息ID'
                },
                count: {
                    type: 'number',
                    description: '贴表情数量(1-20)',
                    default: 1
                }
            },
            required: ['message_id']
        },
        handler: async (args, ctx) => {
            const { message_id, count = 1 } = args
            const e = ctx?.getEvent?.()
            const bot = ctx?.getBot?.()

            if (!e?.group_id) {
                return { error: '此功能仅支持群聊' }
            }

            if (!message_id) {
                return { error: '缺少message_id参数' }
            }

            const emojiCount = Math.min(Math.max(1, count), 20)

            const getRandomEmojiId = () => {
                const range1 = { min: 1, max: 500 }
                const range2 = { min: 127801, max: 128563 }
                const range1Size = range1.max - range1.min + 1
                const range2Size = range2.max - range2.min + 1
                const totalSize = range1Size + range2Size
                const randomValue = Math.floor(Math.random() * totalSize)
                return randomValue < range1Size ? randomValue + range1.min : randomValue - range1Size + range2.min
            }

            try {
                let successCount = 0

                for (let i = 0; i < emojiCount; i++) {
                    const emojiId = String(getRandomEmojiId())

                    try {
                        const response = await bot.sendApi('set_msg_emoji_like', {
                            message_id: String(message_id),
                            emoji_id: emojiId
                        })

                        if (response?.status === 'ok' || response?.retcode === 0) {
                            successCount++
                        }
                    } catch (err) {
                        // 忽略单个失败
                    }

                    if (emojiCount > 1 && i < emojiCount - 1) {
                        await new Promise(resolve => setTimeout(resolve, 100))
                    }
                }

                return {
                    success: successCount > 0,
                    message_id: String(message_id),
                    emoji_count: successCount,
                    message: `已对消息贴了${successCount}个表情`
                }
            } catch (error) {
                return { error: `添加表情回应失败: ${error.message}` }
            }
        }
    },

    {
        name: 'search_wallpaper',
        description: '搜索壁纸图片',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '壁纸搜索关键词'
                },
                count: {
                    type: 'number',
                    description: '返回数量(1-5)',
                    default: 1
                }
            },
            required: ['query']
        },
        handler: async (args, ctx) => {
            const { query, count = 1 } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            const validCount = Math.min(Math.max(parseInt(count) || 1, 1), 5)

            try {
                const hashValue = crypto.randomBytes(32).toString('hex')
                const params = new URLSearchParams({
                    product_id: '52',
                    version_code: '28103',
                    page: '0',
                    search_word: query,
                    maxWidth: '99999',
                    minWidth: '0',
                    maxHeight: '99999',
                    minHeight: '0',
                    searchMode: 'ACCURATE_SEARCH',
                    sort: '0',
                    sign: hashValue
                })

                const response = await fetch('https://wallpaper.soutushenqi.com/v1/wallpaper/list', {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: params.toString()
                })

                const data = await response.json()

                if (!data.data || !Array.isArray(data.data)) {
                    return { error: '未找到相关壁纸' }
                }

                const imageUrls = data.data
                    .filter(item => item.largeUrl && !item.largeUrl.includes('fw480'))
                    .map(item => item.largeUrl)

                if (imageUrls.length === 0) {
                    return { error: '未找到相关壁纸' }
                }

                // 随机打乱
                for (let i = imageUrls.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1))
                    ;[imageUrls[i], imageUrls[j]] = [imageUrls[j], imageUrls[i]]
                }

                const selectedUrls = imageUrls.slice(0, validCount)
                let successCount = 0

                for (const url of selectedUrls) {
                    try {
                        await e.reply(segment.image(url))
                        successCount++
                    } catch (err) {
                        logger.warn(`[search_wallpaper] 发送图片失败: ${err.message}`)
                    }
                }

                if (successCount === 0) {
                    return { error: '所有壁纸发送失败' }
                }

                return {
                    success: true,
                    count: successCount,
                    message: `已发送 ${successCount} 张壁纸`
                }
            } catch (error) {
                return { error: `壁纸搜索失败: ${error.message}` }
            }
        }
    },

    {
        name: 'bilibili_search',
        description: '搜索B站视频并发送结果',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: {
                    type: 'string',
                    description: '视频搜索关键词'
                }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            const { keyword } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            try {
                const biliRes = await fetch('https://www.bilibili.com')
                const setCookieHeaders = []
                for (const [key, value] of biliRes.headers) {
                    if (key.toLowerCase() === 'set-cookie') {
                        setCookieHeaders.push(value)
                    }
                }
                const cookieHeader = setCookieHeaders.map(c => c.split(';')[0]).join('; ')

                const headers = {
                    accept: 'application/json, text/javascript, */*; q=0.01',
                    'accept-language': 'zh-US,en;q=0.9',
                    Referer: 'https://www.bilibili.com',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    cookie: cookieHeader
                }

                const response = await fetch(
                    `https://api.bilibili.com/x/web-interface/search/type?keyword=${encodeURIComponent(keyword)}&search_type=video`,
                    { headers }
                )
                const json = await response.json()

                if (!json.data?.result?.length) {
                    return { error: `未找到与"${keyword}"相关的视频` }
                }

                const video = json.data.result[Math.floor(Math.random() * json.data.result.length)]
                const formatPlay = count => (count >= 10000 ? `${(count / 10000).toFixed(1)}万` : String(count))

                const result = {
                    title: video.title.replace(/<[^>]+>/g, ''),
                    author: video.author,
                    bvid: video.bvid,
                    duration: video.duration,
                    play: formatPlay(video.play),
                    like: formatPlay(video.like),
                    url: `https://www.bilibili.com/video/${video.bvid}`,
                    cover: video.pic.startsWith('//') ? 'https:' + video.pic : video.pic
                }

                await e.reply([
                    segment.image(result.cover),
                    `🎬 ${result.title}\n👤 UP主：${result.author}\n⏱️ 时长：${result.duration}\n👁️ 播放：${result.play}\n🔗 ${result.url}`
                ])

                return { success: true, video: result }
            } catch (error) {
                return { error: `B站搜索失败: ${error.message}` }
            }
        }
    },

    {
        name: 'github_repo_info',
        description: '获取GitHub仓库的详细信息',
        inputSchema: {
            type: 'object',
            properties: {
                repo_url: {
                    type: 'string',
                    description: 'GitHub仓库URL，如 https://github.com/user/repo'
                }
            },
            required: ['repo_url']
        },
        handler: async (args, ctx) => {
            const { repo_url } = args

            try {
                const match = repo_url.match(/github\.com\/([^\/]+)\/([^\/]+)/)
                if (!match) return { error: '无效的GitHub仓库URL' }

                const owner = match[1]
                const repo = match[2].replace(/\.git$/, '').replace(/\?.*$/, '')

                const headers = {
                    'User-Agent': 'GitHub-Repository-Tool',
                    Accept: 'application/vnd.github.v3+json'
                }

                const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers })
                const repoData = await repoRes.json()

                if (repoData.message) {
                    return { error: `GitHub API错误: ${repoData.message}` }
                }

                const [commitsRes, contributorsRes] = await Promise.all([
                    fetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=5`, { headers }),
                    fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=5`, { headers })
                ])

                const commits = await commitsRes.json().catch(() => [])
                const contributors = await contributorsRes.json().catch(() => [])

                return {
                    success: true,
                    data: {
                        name: repoData.name,
                        description: repoData.description || '无描述',
                        stars: repoData.stargazers_count,
                        forks: repoData.forks_count,
                        watchers: repoData.subscribers_count,
                        open_issues: repoData.open_issues_count,
                        language: repoData.language,
                        license: repoData.license?.name || '未指定',
                        created_at: repoData.created_at,
                        updated_at: repoData.updated_at,
                        url: repoData.html_url,
                        recent_commits: Array.isArray(commits)
                            ? commits.slice(0, 5).map(c => ({
                                  message: c.commit?.message?.split('\n')[0] || '',
                                  author: c.commit?.author?.name || '',
                                  date: c.commit?.author?.date || ''
                              }))
                            : [],
                        top_contributors: Array.isArray(contributors)
                            ? contributors.slice(0, 5).map(c => ({
                                  login: c.login,
                                  contributions: c.contributions
                              }))
                            : []
                    }
                }
            } catch (error) {
                return { error: `获取GitHub仓库信息失败: ${error.message}` }
            }
        }
    },

    {
        name: 'ai_image_edit',
        description: '使用AI编辑图片，使用框架配置的图片模型',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '图片编辑需求，如"将图片转为黑白"、"给人物换一件衣服"'
                },
                image_url: {
                    type: 'string',
                    description: '要编辑的图片URL'
                }
            },
            required: ['prompt', 'image_url']
        },
        handler: async (args, ctx) => {
            const { prompt, image_url } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            try {
                // 动态导入框架服务
                const { LlmService } = await import('../../services/llm/LlmService.js')
                const { channelManager } = await import('../../services/llm/ChannelManager.js')
                const config = (await import('../../../config/config.js')).default

                // 下载图片并转base64
                const imageRes = await fetch(image_url)
                const arrayBuffer = await imageRes.arrayBuffer()
                const base64 = Buffer.from(arrayBuffer).toString('base64')
                const mimeType = imageRes.headers.get('content-type') || 'image/png'
                const dataUrl = `data:${mimeType};base64,${base64}`

                // 获取图片模型配置
                await channelManager.init()
                const imageModel = config.get('llm.models.image') || config.get('llm.defaultModel')

                if (!imageModel) {
                    return { error: '未配置图片模型，请在配置中设置 llm.models.image' }
                }

                // 创建LLM客户端（从渠道获取imageConfig）
                const imgChannel = channelManager.getBestChannel(imageModel)
                const client = await LlmService.createClient({
                    model: imageModel,
                    enableTools: false,
                    event: e,
                    imageConfig: imgChannel?.imageConfig || {}
                })

                // 构建消息
                const messages = [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: `请根据以下要求编辑图片：${prompt}\n\n请直接输出编辑后的图片。` },
                            { type: 'image_url', image_url: { url: dataUrl } }
                        ]
                    }
                ]

                // 发送请求
                const response = await client.chat(messages, {
                    model: imageModel,
                    stream: false
                })

                // 处理响应 - 检查是否有图片输出
                const content = response?.content || response?.choices?.[0]?.message?.content || ''

                // 尝试从响应中提取图片
                // Markdown格式: ![xxx](data:image/...;base64,xxx) 或 ![xxx](https://...)
                const mdMatch = content.match(/!\[.*?\]\((data:image\/[^;]+;base64,[^)]+|https?:\/\/[^)]+)\)/)
                if (mdMatch) {
                    const imgUrl = mdMatch[1]
                    if (imgUrl.startsWith('data:image')) {
                        const b64 = imgUrl.replace(/^data:image\/[^;]+;base64,/, '')
                        await e.reply(segment.image(`base64://${b64}`))
                        return { success: true, message: '图片编辑成功' }
                    }
                    await e.reply(segment.image(imgUrl))
                    return { success: true, message: '图片编辑成功' }
                }

                // 纯base64格式
                const b64Match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/)
                if (b64Match) {
                    await e.reply(segment.image(`base64://${b64Match[1]}`))
                    return { success: true, message: '图片编辑成功' }
                }

                // 如果模型不支持图片生成，返回文本描述
                if (content) {
                    return {
                        success: false,
                        message: '当前图片模型不支持图片生成，返回文本描述',
                        description: content
                    }
                }

                return { error: '未能生成编辑后的图片，请确认图片模型支持图片生成功能' }
            } catch (error) {
                return { error: `图片编辑失败: ${error.message}` }
            }
        }
    },

    {
        name: 'bilibili_video_summary',
        description: '获取B站视频的AI总结，包含视频摘要、大纲和精选弹幕',
        inputSchema: {
            type: 'object',
            properties: {
                bvid: {
                    type: 'string',
                    description: 'B站视频的BV号，如 BV1xx411c7mD'
                }
            },
            required: ['bvid']
        },
        handler: async (args, ctx) => {
            const { bvid } = args

            try {
                const baseHeaders = {
                    accept: '*/*',
                    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    'user-agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36'
                }

                // 从配置获取SESSDATA
                const sessdata = config.get('bilibili.sessdata') || ''

                // 获取Cookie
                const getCookie = async () => {
                    if (sessdata) {
                        return `SESSDATA=${sessdata}`
                    }
                    const response = await fetch('https://www.bilibili.com')
                    const setCookies = []
                    for (const [k, v] of response.headers) {
                        if (k.toLowerCase() === 'set-cookie') setCookies.push(v)
                    }
                    return setCookies.map(c => c.split(';')[0]).join('; ')
                }

                const cookie = await getCookie()

                // 获取视频信息
                const videoRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                    headers: { ...baseHeaders, cookie }
                })
                const videoData = await videoRes.json()

                if (videoData.code !== 0) {
                    return { error: `获取视频信息失败: ${videoData.message}` }
                }

                const { cid, owner } = videoData.data

                // 初始化WBI密钥
                const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', {
                    headers: { ...baseHeaders, cookie: sessdata ? `SESSDATA=${sessdata};` : cookie }
                })
                const navData = await navRes.json()

                // wbi_img 即使未登录也能获取
                const { img_url, sub_url } = navData.data?.wbi_img || {}
                if (!img_url || !sub_url) {
                    return {
                        video_info: { title: videoData.data.title, author: owner.name },
                        error: '无法获取WBI密钥'
                    }
                }
                const imgKey = img_url.split('/').pop().split('.')[0]
                const subKey = sub_url.split('/').pop().split('.')[0]

                // WBI签名
                const mixinKeyEncTab = [
                    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28,
                    14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21,
                    56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
                ]
                const orig = imgKey + subKey
                const mixinKey = mixinKeyEncTab
                    .map(i => orig[i])
                    .join('')
                    .slice(0, 32)

                const params = {
                    bvid,
                    cid,
                    up_mid: owner.mid,
                    web_location: '333.788',
                    wts: Math.round(Date.now() / 1000)
                }

                const chrFilter = /[!'()*]/g
                const query = Object.keys(params)
                    .sort()
                    .map(k => {
                        const value = params[k].toString().replace(chrFilter, '')
                        return `${encodeURIComponent(k)}=${encodeURIComponent(value)}`
                    })
                    .join('&')
                const wrid = crypto
                    .createHash('md5')
                    .update(query + mixinKey)
                    .digest('hex')

                const summaryRes = await fetch(
                    `https://api.bilibili.com/x/web-interface/view/conclusion/get?${query}&w_rid=${wrid}`,
                    { headers: { ...baseHeaders, cookie, referer: `https://www.bilibili.com/video/${bvid}` } }
                )
                const summaryData = await summaryRes.json()

                if (summaryData.code !== 0) {
                    return {
                        video_info: { title: videoData.data.title, author: owner.name },
                        summary: `获取AI总结失败: ${summaryData.message}`
                    }
                }

                if (!summaryData.data?.model_result) {
                    return {
                        video_info: { title: videoData.data.title, author: owner.name },
                        summary: '暂无AI总结'
                    }
                }

                // 格式化返回结果
                const { summary, outline, subtitle } = summaryData.data.model_result
                const parts = []

                if (summary) {
                    parts.push('【视频摘要】', summary, '')
                }

                if (outline?.[0]?.part_outline?.length > 0) {
                    parts.push('【视频大纲】')
                    outline[0].part_outline.forEach(({ timestamp, content }) => {
                        const minutes = Math.floor(timestamp / 60)
                        const seconds = timestamp % 60
                        const time = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                        parts.push(`${time} - ${content}`)
                    })
                    parts.push('')
                }

                if (subtitle?.[0]?.part_subtitle?.length > 0) {
                    parts.push('【精选弹幕】')
                    subtitle[0].part_subtitle.forEach(({ start_timestamp, content }) => {
                        const time = `${Math.floor(start_timestamp / 60)
                            .toString()
                            .padStart(2, '0')}:${(start_timestamp % 60).toString().padStart(2, '0')}`
                        parts.push(`${time} - ${content}`)
                    })
                }

                return {
                    success: true,
                    video_info: { title: videoData.data.title, author: owner.name, bvid },
                    formatted_summary: parts.join('\n'),
                    raw: { summary, outline, subtitle }
                }
            } catch (error) {
                return { error: `获取视频总结失败: ${error.message}` }
            }
        }
    },

    {
        name: 'video_analysis',
        description: '分析视频内容，支持从消息中获取视频或提供视频URL，使用智谱AI进行视频理解',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '视频分析需求描述，如"分析视频内容"、"总结视频要点"',
                    default: '请详细分析这个视频的内容，包括主题、关键信息和要点'
                },
                video_url: {
                    type: 'string',
                    description: '视频URL（可选，不提供则从消息上下文获取）'
                }
            }
        },
        handler: async (args, ctx) => {
            const { prompt = '请详细分析这个视频的内容，包括主题、关键信息和要点', video_url } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            try {
                // 获取视频URL
                let videoUrl = video_url

                // 如果没有提供URL，尝试从消息中获取
                if (!videoUrl) {
                    // 从当前消息获取视频
                    const videos = e.message?.filter(m => m.type === 'video')?.map(v => v.url) || []
                    if (videos.length > 0) {
                        videoUrl = videos[0]
                    }

                    // 从引用消息获取视频
                    if (!videoUrl && (e.reply_id || e.source)) {
                        try {
                            let source = null
                            if (e.getReply) {
                                source = await e.getReply()
                            } else if (e.source && e.group_id) {
                                const bot = ctx?.getBot?.() || Bot
                                source = await bot.pickGroup?.(e.group_id)?.getChatHistory?.(e.source.seq, 1)
                            }

                            if (source) {
                                const sourceArray = Array.isArray(source) ? source : [source]
                                const quotedVideos = sourceArray
                                    .flatMap(item => item.message || [])
                                    .filter(msg => msg.type === 'video')
                                    .map(v => v.url)
                                if (quotedVideos.length > 0) {
                                    videoUrl = quotedVideos[0]
                                }
                            }
                        } catch (err) {
                            // 忽略获取引用消息失败
                        }
                    }

                    // 检查 e.video
                    if (!videoUrl && e.video?.length > 0) {
                        videoUrl = e.video[0]
                    }
                }

                if (!videoUrl) {
                    return { error: '未找到视频，请提供视频URL或引用包含视频的消息' }
                }

                // 使用框架的LlmService
                const { LlmService } = await import('../../services/llm/LlmService.js')
                const { channelManager } = await import('../../services/llm/ChannelManager.js')

                await channelManager.init()

                // 查找支持视频的模型（优先使用 glm-4.1v-thinking-flash）
                const videoModels = ['glm-4.1v-thinking-flash', 'glm-4v-plus', 'glm-4v']
                let selectedModel = null
                let selectedChannel = null

                for (const model of videoModels) {
                    const channel = channelManager.getBestChannel(model)
                    if (channel) {
                        selectedModel = model
                        selectedChannel = channel
                        break
                    }
                }

                // 如果没有找到视频模型渠道，尝试使用智谱渠道
                if (!selectedChannel) {
                    const allChannels = channelManager.getAll()
                    selectedChannel = allChannels.find(c => c.enabled && c.baseUrl?.includes('bigmodel.cn'))
                    if (selectedChannel) {
                        selectedModel = 'glm-4.1v-thinking-flash'
                    }
                }

                if (!selectedChannel) {
                    return {
                        error: '未找到支持视频分析的渠道，请添加智谱AI渠道（免费智谱视频）',
                        hint: '在渠道管理中添加智谱AI渠道，或使用免费智谱视频预设'
                    }
                }

                // 处理视频URL - 如果需要可以下载并上传
                let publicVideoUrl = videoUrl
                if (!videoUrl.endsWith('.mp4') && videoUrl.includes('qq.com')) {
                    // 下载QQ视频并上传到智谱临时存储
                    try {
                        const videoRes = await fetch(videoUrl, {
                            headers: {
                                Referer: 'https://www.qq.com/',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                            }
                        })
                        const arrayBuffer = await videoRes.arrayBuffer()
                        const buffer = Buffer.from(arrayBuffer)

                        const formData = new FormData()
                        const blob = new Blob([buffer], { type: 'video/mp4' })
                        formData.append('file', blob, `video_${Date.now()}.mp4`)

                        const apiKey = channelManager.getChannelKey(selectedChannel)
                        const uploadRes = await fetch('https://www.bigmodel.cn/api/biz/file/uploadTemporaryImage', {
                            method: 'POST',
                            body: formData,
                            headers: { authorization: `Bearer ${apiKey}` }
                        })
                        const uploadResult = await uploadRes.json()
                        if (uploadResult.url) {
                            publicVideoUrl = uploadResult.url
                        }
                    } catch (err) {
                        logger.warn(`[video_analysis] 视频上传失败，使用原始URL: ${err.message}`)
                    }
                }

                // 创建LLM客户端并发送请求
                const client = await LlmService.createClient({
                    model: selectedModel,
                    apiKey: channelManager.getChannelKey(selectedChannel),
                    baseUrl: selectedChannel.baseUrl,
                    enableTools: false,
                    event: e,
                    imageConfig: selectedChannel.imageConfig || {}
                })

                const messages = [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'video_url', video_url: { url: publicVideoUrl } }
                        ]
                    }
                ]

                const response = await client.chat(messages, {
                    model: selectedModel,
                    stream: false
                })

                const analysis = response?.content || response?.choices?.[0]?.message?.content || ''

                if (!analysis) {
                    return { error: '视频分析失败，未获取到分析结果' }
                }

                return {
                    success: true,
                    analysis,
                    video_url: videoUrl,
                    model: selectedModel
                }
            } catch (error) {
                return { error: `视频分析失败: ${error.message}` }
            }
        }
    },

    {
        name: 'ai_mindmap',
        description: '生成思维导图，基于描述生成Markmap格式的思维导图并渲染为图片',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '思维导图内容描述，如"JavaScript学习路线"、"项目管理流程"'
                },
                width: {
                    type: 'number',
                    description: '图片宽度',
                    default: 2400
                },
                height: {
                    type: 'number',
                    description: '图片高度',
                    default: 1600
                }
            },
            required: ['prompt']
        },
        handler: async (args, ctx) => {
            const { prompt, width = 2400, height = 1600 } = args
            const e = ctx?.getEvent?.()

            if (!prompt?.trim()) {
                return { error: '思维导图描述不能为空' }
            }

            try {
                // 动态导入依赖
                const { LlmService } = await import('../../services/llm/LlmService.js')
                const { channelManager } = await import('../../services/llm/ChannelManager.js')
                const { Transformer } = await import('markmap-lib')
                const { createRequire } = await import('module')
                const require = createRequire(import.meta.url)
                const puppeteer = require('puppeteer')
                const fs = await import('fs')
                const path = await import('path')

                // 获取默认模型和渠道配置
                await channelManager.init()
                const model = LlmService.getModel()
                if (!model) {
                    return { error: '未配置默认模型' }
                }

                const channel = channelManager.getBestChannel(model)
                if (!channel) {
                    return { error: `未找到支持模型 ${model} 的渠道` }
                }

                // 生成Markdown内容
                const systemPrompt = `你是一个专业的思维导图生成助手。请根据用户的描述生成符合Markdown语法的思维导图代码。
要求：
1. 只输出Markdown代码，不要其他解释或代码块标记
2. 使用#表示主节点，##表示一级子节点，###表示二级子节点，以此类推
3. 合理组织层级结构，最多5级
4. 使用简洁清晰的描述`

                const keyInfo = channelManager.getChannelKey(channel)
                if (!keyInfo?.key) {
                    return { error: '未找到可用的 API 密钥' }
                }

                const client = await LlmService.createClient({
                    model,
                    apiKey: keyInfo.key,
                    baseUrl: channel.baseUrl,
                    enableTools: false,
                    imageConfig: channel.imageConfig || {}
                })

                const userMessage = {
                    role: 'user',
                    content: [{ type: 'text', text: `请根据以下描述生成思维导图：${prompt}` }]
                }

                const response = await client.sendMessage(userMessage, {
                    model,
                    systemPrompt,
                    stream: false,
                    maxToken: 4096
                })

                // 从 contents 数组中提取文本内容
                const textContent = response?.contents?.find(c => c.type === 'text')
                const markdownContent = textContent?.text || response?.text || response?.content || ''

                if (!markdownContent) {
                    return {
                        error: '生成失败，未获取到Markdown内容',
                        debug: { response: JSON.stringify(response).slice(0, 500) }
                    }
                }

                // 验证Markdown
                const lines = markdownContent.split('\n').map(l => l.trim())
                if (!lines.some(l => l.startsWith('#'))) {
                    return { error: '生成的内容不是有效的Markdown格式' }
                }

                // 清理可能的代码块标记
                let cleanMarkdown = markdownContent
                    .replace(/```markdown\n?/gi, '')
                    .replace(/```\n?/g, '')
                    .trim()

                // 转换为markmap数据
                const transformer = new Transformer()
                const { root } = transformer.transform(cleanMarkdown)
                const data = JSON.stringify(root, null, 2)

                // 使用Puppeteer渲染
                const nodeVersion = process.version.slice(1).split('.')[0]
                const browser = await puppeteer.launch({
                    headless: parseInt(nodeVersion) >= 16 ? 'new' : true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                })

                const page = await browser.newPage()
                await page.setViewport({ width, height })

                await page.setContent(
                    `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <script src="https://cdn.jsdelivr.net/npm/d3@6"></script>
                        <script src="https://cdn.jsdelivr.net/npm/markmap-view@0.18.10"></script>
                        <style>
                            body, html { margin: 0; padding: 0; height: 100%; overflow: hidden; background: white; }
                            #markmap { width: 100%; height: 100%; }
                        </style>
                    </head>
                    <body>
                        <svg id="markmap" width="${width}" height="${height}"></svg>
                        <script>
                            const { Markmap } = window.markmap;
                            const svg = document.getElementById('markmap');
                            const mm = Markmap.create(svg, null, ${data});
                            setTimeout(() => mm.fit(), 100);
                        </script>
                    </body>
                    </html>
                `,
                    { waitUntil: 'networkidle0' }
                )

                await page.waitForFunction('document.querySelector("#markmap").children.length > 0', { timeout: 10000 })

                // 保存截图
                const outputDir = './data/chatai-plugin/temp'
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true })
                }
                const outputPath = path.join(outputDir, `mindmap_${Date.now()}.png`)
                await page.screenshot({ path: outputPath, fullPage: true, type: 'png' })

                await browser.close()
                browser = null

                // 发送图片
                await e.reply(segment.image(outputPath))

                // 清理临时文件（延迟删除）
                setTimeout(() => {
                    try {
                        fs.unlinkSync(outputPath)
                    } catch {}
                }, 60000)

                return {
                    success: true,
                    message: '思维导图已生成并发送'
                }
            } catch (error) {
                if (browser)
                    try {
                        await browser.close()
                    } catch {}
                return { error: `思维导图生成失败: ${error.message}` }
            }
        }
    }
]
