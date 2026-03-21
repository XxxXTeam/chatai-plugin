/**
 * 扩展工具
 * 包含天气、一言、骰子、倒计时、提醒、短链接、IP查询等实用功能
 */

const activeReminders = new Map()

export const extraTools = [
    {
        name: 'get_weather',
        description: '查询指定城市的天气信息。用户问天气相关问题时必须调用此工具获取实时数据，不要编造天气信息。',
        inputSchema: {
            type: 'object',
            properties: {
                city: {
                    type: 'string',
                    description: '城市名称（中文或英文），如：北京、Shanghai'
                },
                lang: {
                    type: 'string',
                    description: '返回语言，默认zh（中文）',
                    enum: ['zh', 'en', 'ja']
                }
            },
            required: ['city']
        },
        handler: async args => {
            const { city, lang = 'zh' } = args
            if (!city) return { error: '请提供城市名称' }

            // 尝试多个天气API
            const apis = [
                {
                    name: 'wttr.in',
                    url: `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=${lang}`,
                    parse: data => {
                        if (!data.current_condition?.[0]) {
                            throw new Error('无法获取该城市的天气信息')
                        }
                        const current = data.current_condition[0]
                        const location = data.nearest_area?.[0]
                        const forecast = data.weather?.slice(0, 3) || []
                        return {
                            success: true,
                            location: {
                                city: location?.areaName?.[0]?.value || city,
                                region: location?.region?.[0]?.value || '',
                                country: location?.country?.[0]?.value || ''
                            },
                            current: {
                                temperature: `${current.temp_C}°C`,
                                feels_like: `${current.FeelsLikeC}°C`,
                                humidity: `${current.humidity}%`,
                                weather: current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知',
                                wind: `${current.winddir16Point} ${current.windspeedKmph}km/h`,
                                visibility: `${current.visibility}km`,
                                uv_index: current.uvIndex
                            },
                            forecast: forecast.map(day => ({
                                date: day.date,
                                max_temp: `${day.maxtempC}°C`,
                                min_temp: `${day.mintempC}°C`
                            }))
                        }
                    }
                },
                {
                    name: 'open-meteo',
                    // 备用API：使用地理编码+天气查询
                    url: `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`,
                    parse: async geoData => {
                        if (!geoData.results?.[0]) {
                            throw new Error('找不到该城市')
                        }
                        const { latitude, longitude, name, country } = geoData.results[0]
                        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`
                        const weatherResp = await fetch(weatherUrl, {
                            signal: AbortSignal.timeout(10000),
                            headers: { 'User-Agent': 'ChatBot/1.0' }
                        })
                        if (!weatherResp.ok) throw new Error('天气API请求失败')
                        const weatherData = await weatherResp.json()
                        const current = weatherData.current
                        const weatherCodes = {
                            0: '晴天',
                            1: '基本晴朗',
                            2: '多云',
                            3: '阴天',
                            45: '雾',
                            48: '雾凇',
                            51: '小毛毛雨',
                            53: '毛毛雨',
                            61: '小雨',
                            63: '中雨',
                            65: '大雨',
                            71: '小雪',
                            73: '中雪',
                            75: '大雪',
                            95: '雷暴',
                            96: '冰雹雷暴'
                        }
                        return {
                            success: true,
                            location: { city: name, country },
                            current: {
                                temperature: `${current.temperature_2m}°C`,
                                humidity: `${current.relative_humidity_2m}%`,
                                weather: weatherCodes[current.weather_code] || '未知',
                                wind: `${current.wind_speed_10m}km/h`
                            }
                        }
                    }
                }
            ]

            let lastError = null
            for (const api of apis) {
                try {
                    const controller = new AbortController()
                    const timeoutId = setTimeout(() => controller.abort(), 15000)

                    const response = await fetch(api.url, {
                        headers: { 'User-Agent': 'ChatBot/1.0' },
                        signal: controller.signal
                    })
                    clearTimeout(timeoutId)

                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`)
                    }

                    const data = await response.json()
                    const result = await api.parse(data)
                    return result
                } catch (error) {
                    lastError = error
                    // 继续尝试下一个API
                }
            }

            return { error: `获取天气失败: ${lastError?.message || '所有API都不可用'}` }
        }
    },
    {
        name: 'hitokoto',
        description: '获取一条随机的一言（名言、语录、台词等）',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description:
                        '句子类型：a(动画), b(漫画), c(游戏), d(文学), e(原创), f(网络), g(其他), h(影视), i(诗词), j(网易云), k(哲学), l(抖机灵)',
                    enum: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
                }
            }
        },
        handler: async args => {
            const { type } = args
            try {
                let url = 'https://v1.hitokoto.cn/?encode=json'
                if (type) url += `&c=${type}`

                const response = await fetch(url, {
                    headers: { 'User-Agent': 'ChatBot/1.0' }
                })

                if (!response.ok) {
                    return { error: `一言API请求失败: HTTP ${response.status}` }
                }

                const data = await response.json()
                const typeNames = {
                    a: '动画',
                    b: '漫画',
                    c: '游戏',
                    d: '文学',
                    e: '原创',
                    f: '网络',
                    g: '其他',
                    h: '影视',
                    i: '诗词',
                    j: '网易云',
                    k: '哲学',
                    l: '抖机灵'
                }

                return {
                    success: true,
                    hitokoto: data.hitokoto,
                    from: data.from || '未知',
                    from_who: data.from_who || '佚名',
                    type: typeNames[data.type] || data.type,
                    formatted: `「${data.hitokoto}」\n—— ${data.from_who || '佚名'}${data.from ? `《${data.from}》` : ''}`
                }
            } catch (error) {
                return { error: `获取一言失败: ${error.message}` }
            }
        }
    },
    {
        name: 'roll_dice',
        description: '掷骰子，支持多种格式如 2d6（投2个6面骰子）、1d20+5（投1个20面骰子加5）',
        inputSchema: {
            type: 'object',
            properties: {
                expression: {
                    type: 'string',
                    description: '骰子表达式，如 1d6、2d20、3d6+10、1d100。格式：[数量]d[面数][+/-修正值]'
                },
                reason: {
                    type: 'string',
                    description: '投掷原因（可选）'
                }
            },
            required: ['expression']
        },
        handler: async args => {
            const { expression, reason } = args
            if (!expression) return { error: '请提供骰子表达式' }

            const match = expression.toLowerCase().match(/^(\d+)?d(\d+)([+-]\d+)?$/)
            if (!match) {
                return { error: '无效的骰子表达式格式，正确格式: [数量]d[面数][+/-修正值]' }
            }

            const count = parseInt(match[1] || '1')
            const sides = parseInt(match[2])
            const modifier = parseInt(match[3] || '0')

            if (count < 1 || count > 100) return { error: '骰子数量必须在 1-100 之间' }
            if (sides < 2 || sides > 1000) return { error: '骰子面数必须在 2-1000 之间' }

            const rolls = []
            for (let i = 0; i < count; i++) {
                rolls.push(Math.floor(Math.random() * sides) + 1)
            }

            const subtotal = rolls.reduce((a, b) => a + b, 0)
            const total = subtotal + modifier

            let text = `🎲 ${expression}${reason ? ` (${reason})` : ''}\n投掷结果: [${rolls.join(', ')}]`
            if (count > 1) text += ` = ${subtotal}`
            if (modifier !== 0) text += ` ${modifier > 0 ? '+' : ''}${modifier}`
            text += `\n总计: ${total}`

            if (count === 1 && sides === 20) {
                if (rolls[0] === 20) text += ' 🎉 大成功！'
                else if (rolls[0] === 1) text += ' 💀 大失败！'
            }

            return { success: true, expression, rolls, subtotal, modifier: modifier || undefined, total, text }
        }
    },
    {
        name: 'random_choose',
        description: '从给定的选项中随机选择一个或多个',
        inputSchema: {
            type: 'object',
            properties: {
                options: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '选项列表'
                },
                count: {
                    type: 'integer',
                    description: '选择数量，默认1'
                },
                unique: {
                    type: 'boolean',
                    description: '是否不重复选择，默认true'
                }
            },
            required: ['options']
        },
        handler: async args => {
            const { options, count = 1, unique = true } = args
            if (!options?.length) return { error: '请提供至少一个选项' }
            if (unique && count > options.length) {
                return { error: `不重复选择时，选择数量(${count})不能超过选项数量(${options.length})` }
            }

            const results = []
            const available = [...options]

            for (let i = 0; i < count; i++) {
                if (unique) {
                    const idx = Math.floor(Math.random() * available.length)
                    results.push(available.splice(idx, 1)[0])
                } else {
                    results.push(options[Math.floor(Math.random() * options.length)])
                }
            }

            return {
                success: true,
                results,
                text:
                    count === 1
                        ? `🎯 选择结果: ${results[0]}`
                        : `🎯 选择结果:\n${results.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
            }
        }
    },
    {
        name: 'countdown',
        description: '计算距离指定日期还有多少时间',
        inputSchema: {
            type: 'object',
            properties: {
                target_date: {
                    type: 'string',
                    description: '目标日期，格式 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss'
                },
                event_name: {
                    type: 'string',
                    description: '事件名称（可选）'
                }
            },
            required: ['target_date']
        },
        handler: async args => {
            const { target_date, event_name } = args
            if (!target_date) return { error: '请提供目标日期' }

            const target = new Date(target_date)
            const now = new Date()

            if (isNaN(target.getTime())) return { error: '无效的日期格式' }

            const diff = target.getTime() - now.getTime()
            const isPast = diff < 0
            const absDiff = Math.abs(diff)

            const days = Math.floor(absDiff / (1000 * 60 * 60 * 24))
            const hours = Math.floor((absDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
            const minutes = Math.floor((absDiff % (1000 * 60 * 60)) / (1000 * 60))

            const parts = []
            if (days > 0) parts.push(`${days}天`)
            if (hours > 0) parts.push(`${hours}小时`)
            if (minutes > 0) parts.push(`${minutes}分钟`)
            if (parts.length === 0) parts.push('不到1分钟')

            const readable = parts.join('')
            const prefix = isPast ? '已过去' : '还有'
            const emoji = isPast ? '⏪' : '⏳'

            return {
                success: true,
                target_date: target.toISOString(),
                is_past: isPast,
                days,
                hours,
                minutes,
                text: `${emoji} ${event_name ? `距离「${event_name}」` : '距离目标日期'}${prefix} ${readable}`
            }
        }
    },
    {
        name: 'create_short_url',
        description: '将长链接转换为短链接',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '需要缩短的长链接' }
            },
            required: ['url']
        },
        handler: async args => {
            const { url } = args
            if (!url) return { error: '请提供需要缩短的链接' }

            try {
                new URL(url)
            } catch {
                return { error: '无效的URL格式' }
            }

            try {
                const apiUrl = `https://is.gd/create.php?format=json&url=${encodeURIComponent(url)}`
                const response = await fetch(apiUrl, {
                    headers: { 'User-Agent': 'ChatBot/1.0' }
                })

                if (!response.ok) return { error: `短链接服务请求失败: HTTP ${response.status}` }

                const data = await response.json()
                if (data.errorcode) return { error: `生成短链接失败: ${data.errormessage}` }

                return {
                    success: true,
                    original_url: url,
                    short_url: data.shorturl
                }
            } catch (error) {
                return { error: `生成短链接失败: ${error.message}` }
            }
        }
    },
    {
        name: 'query_ip_info',
        description: '查询IP地址的地理位置和相关信息',
        inputSchema: {
            type: 'object',
            properties: {
                ip: { type: 'string', description: 'IP地址，不填则查询当前IP' }
            }
        },
        handler: async args => {
            const { ip } = args
            try {
                const url = ip ? `http://ip-api.com/json/${ip}?lang=zh-CN` : 'http://ip-api.com/json/?lang=zh-CN'

                const response = await fetch(url, {
                    headers: { 'User-Agent': 'ChatBot/1.0' }
                })

                if (!response.ok) return { error: `IP查询失败: HTTP ${response.status}` }

                const data = await response.json()
                if (data.status === 'fail') return { error: `IP查询失败: ${data.message}` }

                return {
                    success: true,
                    ip: data.query,
                    location: {
                        country: data.country,
                        region: data.regionName,
                        city: data.city,
                        timezone: data.timezone
                    },
                    network: {
                        isp: data.isp,
                        org: data.org
                    },
                    summary: `🌐 IP: ${data.query}\n📍 位置: ${data.country} ${data.regionName} ${data.city}\n🏢 运营商: ${data.isp}`
                }
            } catch (error) {
                return { error: `查询IP信息失败: ${error.message}` }
            }
        }
    },
    {
        name: 'set_reminder',
        description: '设置简单的定时提醒（内存版，重启会丢失）。复杂定时任务请使用 create_scheduled_task 工具',
        inputSchema: {
            type: 'object',
            properties: {
                time: {
                    type: 'string',
                    description: "时间格式：'HH:mm' 或相对时间如 '30m'、'1h30m'、'10s'"
                },
                qq: {
                    type: 'string',
                    description: '提醒的用户QQ，不填则提醒发起者'
                },
                content: {
                    type: 'string',
                    description: '提醒内容'
                }
            },
            required: ['content']
        },
        handler: async (args, ctx) => {
            let { time, qq, content } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            if (!qq) qq = String(e.user_id || e.sender?.user_id)
            if (!time) return { error: '请提供时间' }
            if (!content?.trim()) return { error: '提醒内容不能为空' }

            try {
                let delayMs
                const now = new Date()

                // HH:mm 格式
                if (/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(time)) {
                    const [hour, minute, second = 0] = time.split(':').map(Number)
                    let target = new Date()
                    target.setHours(hour, minute, second, 0)
                    if (target <= now) target.setDate(target.getDate() + 1)
                    delayMs = target.getTime() - now.getTime()
                } else {
                    // 相对时间
                    const h = time.match(/(\d+)\s*h/i)?.[1] || 0
                    const m = time.match(/(\d+)\s*m/i)?.[1] || 0
                    const s = time.match(/(\d+)\s*s/i)?.[1] || 0
                    delayMs = Number(h) * 3600000 + Number(m) * 60000 + Number(s) * 1000
                    if (delayMs <= 0) return { error: '时间格式无效' }
                }

                if (delayMs > 7 * 24 * 60 * 60 * 1000) {
                    return { error: '提醒时间不能超过7天，超过请使用 create_scheduled_task' }
                }

                const targetDate = new Date(now.getTime() + delayMs)
                const reminderId = `${qq}_${Date.now()}`

                const timerId = setTimeout(async () => {
                    try {
                        await e.reply([segment.at(qq), ' ⏰ 提醒：', content])
                        activeReminders.delete(reminderId)
                    } catch (err) {
                        logger.error(`[Reminder] 发送提醒失败:`, err)
                    }
                }, delayMs)

                activeReminders.set(reminderId, { timerId, qq, content, targetTime: targetDate })

                const timeStr = targetDate.toLocaleString('zh-CN', {
                    hour12: false,
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                })

                return {
                    success: true,
                    message: `提醒已设置，将在 ${timeStr} 提醒`,
                    reminder_id: reminderId
                }
            } catch (error) {
                return { error: `设置提醒失败: ${error.message}` }
            }
        }
    },
    {
        name: 'get_illustration',
        description: '获取动漫插画图片',
        inputSchema: {
            type: 'object',
            properties: {
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '图片标签（日文或英文），如 ["かわいい", "少女"]'
                },
                num: {
                    type: 'integer',
                    description: '返回图片数量，默认1，最大5'
                }
            }
        },
        handler: async (args, ctx) => {
            const { tags = [], num = 1 } = args
            const e = ctx?.getEvent?.()
            if (!e) return { error: '无法获取事件上下文' }

            try {
                const params = new URLSearchParams({
                    size: 'regular',
                    r18: '0',
                    num: String(Math.min(Math.max(1, num), 5)),
                    excludeAI: 'true',
                    proxy: 'i.pixiv.re'
                })

                if (tags.length > 0) {
                    tags.forEach(tag => params.append('tag', tag))
                }

                const response = await fetch(`https://api.lolicon.app/setu/v2?${params}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                })

                if (!response.ok) return { error: `API请求失败: HTTP ${response.status}` }

                const data = await response.json()
                if (!data?.data?.length) {
                    return {
                        message: tags.length > 0 ? `找不到包含标签「${tags.join(', ')}」的图片` : '暂时没有找到图片'
                    }
                }

                const results = []
                for (const img of data.data) {
                    const imageUrl = img.urls?.regular || img.urls?.original
                    if (!imageUrl) continue

                    try {
                        await e.reply(segment.image(imageUrl))
                        results.push({ pid: img.pid, title: img.title, author: img.author })
                    } catch (err) {
                        logger.warn(`[Illustration] 发送图片失败:`, err.message)
                    }
                }

                if (results.length === 0) return { error: '图片发送失败' }

                return {
                    success: true,
                    count: results.length,
                    message: `已发送 ${results.length} 张图片`,
                    details: results.map(r => `PID: ${r.pid} | ${r.title} by ${r.author}`).join('\n')
                }
            } catch (error) {
                return { error: `获取图片失败: ${error.message}` }
            }
        }
    }
]
