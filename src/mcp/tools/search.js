/**
 * 搜索工具
 * 网页搜索、知识检索等
 */

/**
 * 外部搜索/查询类 API 的请求超时（毫秒）
 *
 * Node 的 fetch 没有默认超时，外部站点被中间设备黑洞时 await 永不 resolve，
 * 工具 handler 随之挂起，该次 LLM 调用会被无限期阻塞（表现为"机器人不回话了"）。
 */
import { StandardBotApi } from '../../core/platform/index.js'
import { searchWeb, fetchPage } from '../../services/search/SearchService.js'

const SEARCH_API_TIMEOUT_MS = 10000

export const searchTools = [
    {
        name: 'bing_search',
        description: '使用Bing搜索引擎搜索内容（无需API Key）',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词' },
                count: { type: 'number', description: '返回结果数量，默认5' },
                fetchContent: { type: 'boolean', description: '是否获取搜索结果的网页内容，默认false' }
            },
            required: ['query']
        },
        handler: async args => {
            const result = await searchWeb(args.query, {
                provider: 'bing',
                count: args.count,
                fetchContent: args.fetchContent === true
            })
            if (result.success) {
                result.engine = 'bing'
            } else {
                result.error = `Bing搜索失败: ${result.error}`
            }
            return result
        }
    },

    {
        name: 'fetch_webpage',
        description: '获取指定URL的网页内容并转换为Markdown格式',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '要获取的网页URL' },
                maxLength: { type: 'number', description: '最大返回长度，默认8000字符' }
            },
            required: ['url']
        },
        handler: async args => {
            return await fetchPage(args.url, { maxLength: args.maxLength })
        }
    },

    {
        name: 'web_search',
        description:
            '联网搜索最新信息。当用户询问新闻、时事、版本发布、价格、比赛结果等可能随时间变化的事实时，调用此工具搜索后再回答。后端自动优先使用当前渠道的官方搜索接口，不可用时回退到免费引擎。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词' },
                provider: {
                    type: 'string',
                    description: '搜索后端：auto自动选择（默认）、bing、duckduckgo'
                },
                count: { type: 'number', description: '返回结果数量，默认5' },
                fetchContent: { type: 'boolean', description: '是否抓取前几条结果的网页正文，默认false' }
            },
            required: ['query']
        },
        handler: async args => {
            return await searchWeb(args.query, {
                provider: args.provider,
                count: args.count,
                fetchContent: args.fetchContent === true
            })
        }
    },

    {
        name: 'search_wiki',
        description: '搜索维基百科',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词' },
                lang: { type: 'string', description: '语言代码，默认zh', enum: ['zh', 'en', 'ja'] }
            },
            required: ['query']
        },
        handler: async args => {
            try {
                const lang = args.lang || 'zh'
                const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.query)}`

                const response = await fetch(url, {
                    headers: { 'User-Agent': 'ChatBot/1.0' },
                    signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS)
                })

                if (!response.ok) {
                    if (response.status === 404) {
                        return { success: false, error: '未找到相关词条' }
                    }
                    throw new Error(`HTTP ${response.status}`)
                }

                const data = await response.json()

                return {
                    success: true,
                    title: data.title,
                    extract: data.extract,
                    url: data.content_urls?.desktop?.page,
                    thumbnail: data.thumbnail?.source,
                    description: data.description
                }
            } catch (err) {
                return { success: false, error: `Wiki搜索失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_group_history',
        description: '搜索群聊历史记录中的关键词',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '搜索关键词' },
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                limit: { type: 'number', description: '返回数量，默认10' }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                const groupId = args.group_id || e?.group_id

                if (!groupId) {
                    return { success: false, error: '需要群号参数或在群聊中使用' }
                }
                // QQBot 没有数字 seq，适配器只接受当前事件的 message_id 作为本地缓存键。
                const sequence = api.historySequence(e?.seq ?? e?.message_seq ?? e?.message_id, 0)
                if (api.isQQBot && !sequence) {
                    return {
                        success: false,
                        error: 'QQBot 只能从当前事件 message_id 查询本地缓存，当前事件没有可用消息 ID'
                    }
                }
                // 获取最近的消息
                const history = await api.getHistory({ groupId, sequence, count: 100 })
                const keyword = args.keyword.toLowerCase()
                const limit = args.limit || 10

                // 搜索包含关键词的消息
                const matches = []
                for (const msg of (history || []).reverse()) {
                    const content = msg.raw_message || msg.message?.map(m => m.text || '').join('') || ''
                    if (content.toLowerCase().includes(keyword)) {
                        matches.push({
                            time: msg.time,
                            user_id: msg.sender?.user_id || msg.user_id,
                            nickname: msg.sender?.nickname || msg.sender?.card || '',
                            content: content.substring(0, 200)
                        })
                        if (matches.length >= limit) break
                    }
                }

                return {
                    success: true,
                    keyword: args.keyword,
                    group_id: groupId,
                    count: matches.length,
                    messages: matches
                }
            } catch (err) {
                return { success: false, error: `搜索失败: ${err.message}` }
            }
        }
    },

    {
        name: 'translate',
        description: '文本翻译',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要翻译的文本' },
                from: { type: 'string', description: '源语言，auto自动检测' },
                to: { type: 'string', description: '目标语言，默认zh' }
            },
            required: ['text']
        },
        handler: async args => {
            try {
                const text = args.text
                const targetLang = args.to || 'zh'

                // 使用免费翻译 API
                const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${args.from || 'auto'}|${targetLang}`

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.responseStatus !== 200) {
                    return { success: false, error: data.responseDetails || '翻译失败' }
                }

                return {
                    success: true,
                    original: text,
                    translated: data.responseData.translatedText,
                    from: args.from || 'auto',
                    to: targetLang
                }
            } catch (err) {
                return { success: false, error: `翻译失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_weather',
        description:
            '获取天气信息。当用户问"天气怎么样""会不会下雨""温度多少"等天气相关问题时，必须调用此工具获取实时天气数据。',
        inputSchema: {
            type: 'object',
            properties: {
                city: { type: 'string', description: '城市名称（中文或拼音）' },
                days: { type: 'number', description: '预报天数（1-7），默认1' }
            },
            required: ['city']
        },
        handler: async args => {
            try {
                const city = encodeURIComponent(args.city)

                // 使用 wttr.in 免费天气 API
                const url = `https://wttr.in/${city}?format=j1&lang=zh`
                const response = await fetch(url, {
                    headers: { 'User-Agent': 'curl/7.68.0' },
                    signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS)
                })

                if (!response.ok) {
                    return { success: false, error: '获取天气失败，请检查城市名称' }
                }

                const data = await response.json()
                const current = data.current_condition?.[0]
                const forecast = data.weather?.slice(0, args.days || 1) || []

                if (!current) {
                    return { success: false, error: '未找到该城市的天气信息' }
                }

                return {
                    success: true,
                    city: args.city,
                    current: {
                        temp: `${current.temp_C}°C`,
                        feels_like: `${current.FeelsLikeC}°C`,
                        humidity: `${current.humidity}%`,
                        weather: current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value,
                        wind: `${current.winddir16Point} ${current.windspeedKmph}km/h`,
                        visibility: `${current.visibility}km`,
                        uv_index: current.uvIndex
                    },
                    forecast: forecast.map(day => ({
                        date: day.date,
                        max_temp: `${day.maxtempC}°C`,
                        min_temp: `${day.mintempC}°C`,
                        weather: day.hourly?.[4]?.lang_zh?.[0]?.value || day.hourly?.[4]?.weatherDesc?.[0]?.value,
                        sunrise: day.astronomy?.[0]?.sunrise,
                        sunset: day.astronomy?.[0]?.sunset
                    }))
                }
            } catch (err) {
                return { success: false, error: `获取天气失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_ip_info',
        description: '查询IP地址信息',
        inputSchema: {
            type: 'object',
            properties: {
                ip: { type: 'string', description: 'IP地址，不填则查询当前IP' }
            }
        },
        handler: async args => {
            try {
                const ip = args.ip || ''
                const url = ip ? `http://ip-api.com/json/${ip}?lang=zh-CN` : 'http://ip-api.com/json/?lang=zh-CN'

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.status !== 'success') {
                    return { success: false, error: data.message || 'IP查询失败' }
                }

                return {
                    success: true,
                    ip: data.query,
                    country: data.country,
                    region: data.regionName,
                    city: data.city,
                    isp: data.isp,
                    org: data.org,
                    timezone: data.timezone,
                    lat: data.lat,
                    lon: data.lon
                }
            } catch (err) {
                return { success: false, error: `IP查询失败: ${err.message}` }
            }
        }
    },

    {
        name: 'search_baike',
        description: '搜索百度百科',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: '搜索关键词' }
            },
            required: ['keyword']
        },
        handler: async args => {
            try {
                // 使用百度百科 OpenSearch API
                const url = `https://baike.baidu.com/api/openapi/BaikeLemmaCardApi?scope=103&format=json&appid=379020&bk_key=${encodeURIComponent(args.keyword)}&bk_length=600`

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (!data.title) {
                    return { success: false, error: '未找到相关词条' }
                }

                return {
                    success: true,
                    title: data.title,
                    abstract: data.abstract,
                    url: data.url,
                    image: data.image,
                    card: data.card?.map(c => ({ key: c.key, value: c.value?.join(', ') }))
                }
            } catch (err) {
                return { success: false, error: `百科搜索失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_hitokoto',
        description: '获取一言（随机句子）',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description:
                        '句子类型: a(动画) b(漫画) c(游戏) d(文学) e(原创) f(网络) g(其他) h(影视) i(诗词) j(网易云) k(哲学) l(抖机灵)',
                    enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
                }
            }
        },
        handler: async args => {
            try {
                let url = 'https://v1.hitokoto.cn/?encode=json'
                if (args.type) {
                    url += `&c=${args.type}`
                }

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                return {
                    success: true,
                    content: data.hitokoto,
                    from: data.from,
                    from_who: data.from_who,
                    type: data.type,
                    creator: data.creator
                }
            } catch (err) {
                return { success: false, error: `获取一言失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_hot_search',
        description: '获取热搜榜单',
        inputSchema: {
            type: 'object',
            properties: {
                platform: {
                    type: 'string',
                    description: '平台: weibo(微博) zhihu(知乎) baidu(百度) bilibili(B站)',
                    enum: ['weibo', 'zhihu', 'baidu', 'bilibili']
                },
                limit: { type: 'number', description: '返回数量，默认10' }
            }
        },
        handler: async args => {
            try {
                const platform = args.platform || 'weibo'
                const limit = args.limit || 10

                // 使用第三方热搜 API
                const apiMap = {
                    weibo: 'https://tenapi.cn/v2/weibohot',
                    zhihu: 'https://tenapi.cn/v2/zhihuhot',
                    baidu: 'https://tenapi.cn/v2/baiduhot',
                    bilibili: 'https://tenapi.cn/v2/bilihot'
                }

                const url = apiMap[platform]
                if (!url) {
                    return { success: false, error: '不支持的平台' }
                }

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.code !== 200) {
                    return { success: false, error: '获取热搜失败' }
                }

                const items = (data.data || []).slice(0, limit)

                return {
                    success: true,
                    platform,
                    count: items.length,
                    items: items.map((item, idx) => ({
                        rank: idx + 1,
                        title: item.name || item.title,
                        hot: item.hot || item.hotnum,
                        url: item.url
                    }))
                }
            } catch (err) {
                return { success: false, error: `获取热搜失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_douyin_hot',
        description: '获取抖音热榜',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: '返回数量，默认10' }
            }
        },
        handler: async args => {
            try {
                const limit = args.limit || 10
                const url = 'https://tenapi.cn/v2/douyinhot'

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.code !== 200) {
                    return { success: false, error: '获取抖音热榜失败' }
                }

                const items = (data.data || []).slice(0, limit)

                return {
                    success: true,
                    count: items.length,
                    items: items.map((item, idx) => ({
                        rank: idx + 1,
                        title: item.name || item.title,
                        hot: item.hot,
                        url: item.url
                    }))
                }
            } catch (err) {
                return { success: false, error: `获取抖音热榜失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_history_today',
        description: '获取历史上的今天',
        inputSchema: {
            type: 'object',
            properties: {
                month: { type: 'number', description: '月份（1-12），默认当前月' },
                day: { type: 'number', description: '日期（1-31），默认当前日' }
            }
        },
        handler: async args => {
            try {
                const now = new Date()
                const month = args.month || now.getMonth() + 1
                const day = args.day || now.getDate()

                const url = `https://api.oioweb.cn/api/common/history?month=${month}&day=${day}`

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.code !== 200) {
                    return { success: false, error: '获取历史上的今天失败' }
                }

                const events = (data.result || []).slice(0, 10)

                return {
                    success: true,
                    date: `${month}月${day}日`,
                    count: events.length,
                    events: events.map(e => ({
                        year: e.year,
                        title: e.title
                    }))
                }
            } catch (err) {
                return { success: false, error: `获取失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_joke',
        description: '获取随机笑话',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            try {
                const url = 'https://api.oioweb.cn/api/common/OneDuanzi'

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.code !== 200) {
                    return { success: false, error: '获取笑话失败' }
                }

                return {
                    success: true,
                    content: data.result
                }
            } catch (err) {
                return { success: false, error: `获取笑话失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_morning_paper',
        description: '获取60秒早报',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            try {
                const url = 'https://api.oioweb.cn/api/common/60s'

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.code !== 200) {
                    return { success: false, error: '获取早报失败' }
                }

                return {
                    success: true,
                    date: data.result?.date,
                    news: data.result?.news || [],
                    tip: data.result?.tip,
                    image: data.result?.image
                }
            } catch (err) {
                return { success: false, error: `获取早报失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_short_url',
        description: '生成短链接',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '要缩短的URL' }
            },
            required: ['url']
        },
        handler: async args => {
            try {
                const url = `https://api.oioweb.cn/api/common/ShortUrl?url=${encodeURIComponent(args.url)}`

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.code !== 200) {
                    return { success: false, error: '生成短链接失败' }
                }

                return {
                    success: true,
                    original: args.url,
                    short_url: data.result
                }
            } catch (err) {
                return { success: false, error: `生成短链接失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_oil_price',
        description: '获取今日油价',
        inputSchema: {
            type: 'object',
            properties: {
                province: { type: 'string', description: '省份名称，如"北京"、"上海"' }
            }
        },
        handler: async args => {
            try {
                let url = 'https://api.oioweb.cn/api/common/OilPrice'
                if (args.province) {
                    url += `?prov=${encodeURIComponent(args.province)}`
                }

                const response = await fetch(url, { signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS) })
                const data = await response.json()

                if (data.code !== 200) {
                    return { success: false, error: '获取油价失败' }
                }

                return {
                    success: true,
                    province: data.result?.prov || args.province,
                    prices: {
                        p0: data.result?.p0, // 0号柴油
                        p92: data.result?.p92,
                        p95: data.result?.p95,
                        p98: data.result?.p98
                    },
                    update_time: data.result?.time
                }
            } catch (err) {
                return { success: false, error: `获取油价失败: ${err.message}` }
            }
        }
    }
]
