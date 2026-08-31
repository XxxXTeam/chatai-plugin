/**
 * 扩展工具
 * 包含天气、一言、骰子、倒计时、提醒、短链接、IP查询等实用功能
 */

import { StandardBotApi, StandardMessage as segment } from '../../core/platform/index.js'
import { chatLogger as logger } from '../../core/utils/logger.js'

/** 外部 API 请求超时（毫秒）：缺少超时会让 tool_call 永久挂起 */
const API_TIMEOUT_MS = 10000

/** random_choose 单次最多返回的结果数 */
const MAX_RANDOM_CHOOSE_COUNT = 100

export const extraTools = [
    // get_weather 已由 search.js 统一实现（加载顺序更靠前，实际执行的一直是该实现）。
    // 此处原有的重复定义只会覆盖暴露给模型的 schema，造成 schema 与 handler 来自不同文件，故移除。
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
                    headers: { 'User-Agent': 'ChatBot/1.0' },
                    signal: AbortSignal.timeout(API_TIMEOUT_MS)
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
                    description: `选择数量，默认1，最大${MAX_RANDOM_CHOOSE_COUNT}`,
                    minimum: 1,
                    maximum: MAX_RANDOM_CHOOSE_COUNT
                },
                unique: {
                    type: 'boolean',
                    description: '是否不重复选择，默认true'
                }
            },
            required: ['options']
        },
        handler: async args => {
            const { options, unique = true } = args
            if (!options?.length) return { error: '请提供至少一个选项' }

            // 二次夹取：unique=false 时 count 会直接决定同步循环次数，无上限会冻死进程
            const count = Math.min(Math.max(Math.floor(Number(args.count) || 1), 1), MAX_RANDOM_CHOOSE_COUNT)
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
    // countdown 已由 utils.js 统一实现（加载顺序更靠前，实际执行的一直是该实现），移除重复定义
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
                    headers: { 'User-Agent': 'ChatBot/1.0' },
                    signal: AbortSignal.timeout(API_TIMEOUT_MS)
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
                    headers: { 'User-Agent': 'ChatBot/1.0' },
                    signal: AbortSignal.timeout(API_TIMEOUT_MS)
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
    // set_reminder 已由 reminder.js 统一实现（支持每天/每周重复，功能更完整）。
    // 此前两处同名注册导致模型看到 reminder.js 的 schema（required: time+message）
    // 却执行本文件的 handler（required: content），该工具在任何调用下都会参数校验失败，故移除本文件的实现。
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
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    signal: AbortSignal.timeout(API_TIMEOUT_MS)
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
                        await StandardBotApi.fromContext(ctx).reply(segment.image(imageUrl))
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
