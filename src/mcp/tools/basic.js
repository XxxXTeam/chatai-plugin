/**
 * 基础工具
 * 包含时间获取、工具列表等基础功能
 */

export const basicTools = [
    {
        name: 'get_current_time',
        description: '获取当前时间和日期信息',
        inputSchema: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    description: '时间格式：full(完整)、date(仅日期)、time(仅时间)、timestamp(时间戳)',
                    enum: ['full', 'date', 'time', 'timestamp']
                },
                timezone: {
                    type: 'string',
                    description: '时区，默认 Asia/Shanghai'
                }
            }
        },
        handler: async args => {
            const now = new Date()
            const tz = args.timezone || 'Asia/Shanghai'
            const format = args.format || 'full'

            const options = { timeZone: tz }
            const dateStr = now.toLocaleDateString('zh-CN', {
                ...options,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            })
            const timeStr = now.toLocaleTimeString('zh-CN', {
                ...options,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            })
            const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]

            let result
            switch (format) {
                case 'date':
                    result = dateStr
                    break
                case 'time':
                    result = timeStr
                    break
                case 'timestamp':
                    result = now.getTime().toString()
                    break
                default:
                    result = `${dateStr} ${timeStr} 星期${weekday}`
            }

            return {
                text: `当前时间: ${result}`,
                datetime: now.toISOString(),
                timestamp: now.getTime(),
                formatted: result,
                timezone: tz,
                weekday: `星期${weekday}`
            }
        }
    },

    {
        name: 'sleep',
        description: '等待指定时间（用于需要延迟的场景）',
        inputSchema: {
            type: 'object',
            properties: {
                seconds: { type: 'number', description: '等待秒数，最大60秒' }
            },
            required: ['seconds']
        },
        handler: async args => {
            const seconds = Math.min(Math.max(args.seconds, 0.1), 60)
            await new Promise(r => setTimeout(r, seconds * 1000))
            return { success: true, waited: seconds }
        }
    },

    {
        name: 'echo',
        description: '原样返回输入内容（用于测试或调试）',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '要返回的内容' }
            },
            required: ['message']
        },
        handler: async args => {
            return { success: true, message: args.message }
        }
    },

    {
        name: 'get_environment',
        description: '获取运行环境信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            const e = ctx?.getEvent?.()
            const bot = ctx?.getBot?.()

            return {
                success: true,
                node_version: process.version,
                platform: process.platform,
                arch: process.arch,
                uptime: Math.floor(process.uptime()),
                memory: {
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
                },
                bot: {
                    id: bot?.uin || bot?.self_id,
                    friends: bot?.fl?.size || 0,
                    groups: bot?.gl?.size || 0
                },
                context: {
                    is_group: !!e?.group_id,
                    group_id: e?.group_id,
                    user_id: e?.user_id
                }
            }
        }
    },

    {
        name: 'list_available_tools',
        description: '列出所有可用的工具',
        inputSchema: {
            type: 'object',
            properties: {
                category: { type: 'string', description: '工具类别（可选）' },
                keyword: { type: 'string', description: '搜索关键词（可选）' }
            }
        },
        handler: async args => {
            try {
                const { getCategoryInfo } = await import('./index.js')
                const categories = getCategoryInfo()

                let result = []

                for (const cat of categories) {
                    if (args.category && cat.key !== args.category) continue

                    let tools = cat.tools
                    if (args.keyword) {
                        const keyword = args.keyword.toLowerCase()
                        tools = tools.filter(
                            t => t.name.toLowerCase().includes(keyword) || t.description.toLowerCase().includes(keyword)
                        )
                    }

                    if (tools.length > 0) {
                        result.push({
                            category: cat.key,
                            name: cat.name,
                            description: cat.description,
                            tools: tools.map(t => ({ name: t.name, description: t.description }))
                        })
                    }
                }

                const totalTools = result.reduce((sum, cat) => sum + cat.tools.length, 0)

                return {
                    success: true,
                    total_categories: result.length,
                    total_tools: totalTools,
                    categories: result
                }
            } catch (err) {
                return { success: false, error: `获取工具列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_tool_info',
        description: '获取指定工具的详细信息',
        inputSchema: {
            type: 'object',
            properties: {
                tool_name: { type: 'string', description: '工具名称' }
            },
            required: ['tool_name']
        },
        handler: async args => {
            try {
                const { getToolByName } = await import('./index.js')
                const tool = getToolByName(args.tool_name)

                if (!tool) {
                    return { success: false, error: `未找到工具: ${args.tool_name}` }
                }

                return {
                    success: true,
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema?.properties || {},
                    required: tool.inputSchema?.required || []
                }
            } catch (err) {
                return { success: false, error: `获取工具信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_lunar_date',
        description: '获取农历日期',
        inputSchema: {
            type: 'object',
            properties: {
                date: { type: 'string', description: '公历日期，格式 YYYY-MM-DD，不填则使用今天' }
            }
        },
        handler: async args => {
            try {
                const date = args.date ? new Date(args.date) : new Date()

                // 简单农历计算（仅供参考，精确农历需要专门的库）
                const lunarMonths = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']
                const lunarDays = [
                    '初一',
                    '初二',
                    '初三',
                    '初四',
                    '初五',
                    '初六',
                    '初七',
                    '初八',
                    '初九',
                    '初十',
                    '十一',
                    '十二',
                    '十三',
                    '十四',
                    '十五',
                    '十六',
                    '十七',
                    '十八',
                    '十九',
                    '二十',
                    '廿一',
                    '廿二',
                    '廿三',
                    '廿四',
                    '廿五',
                    '廿六',
                    '廿七',
                    '廿八',
                    '廿九',
                    '三十'
                ]
                const animals = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']
                const stems = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
                const branches = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥']

                const year = date.getFullYear()
                const animal = animals[(year - 4) % 12]
                const stem = stems[(year - 4) % 10]
                const branch = branches[(year - 4) % 12]

                return {
                    success: true,
                    solar_date: date.toISOString().split('T')[0],
                    year: year,
                    ganzhi_year: `${stem}${branch}年`,
                    zodiac: `${animal}年`,
                    note: '农历日期为简化计算，如需精确农历请使用专门的农历API'
                }
            } catch (err) {
                return { success: false, error: `获取农历失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_festival',
        description: '获取近期节日/节气信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            const now = new Date()
            const year = now.getFullYear()

            // 主要节日列表
            const festivals = [
                { date: `${year}-01-01`, name: '元旦' },
                { date: `${year}-02-14`, name: '情人节' },
                { date: `${year}-03-08`, name: '妇女节' },
                { date: `${year}-03-12`, name: '植树节' },
                { date: `${year}-04-01`, name: '愚人节' },
                { date: `${year}-05-01`, name: '劳动节' },
                { date: `${year}-05-04`, name: '青年节' },
                { date: `${year}-06-01`, name: '儿童节' },
                { date: `${year}-07-01`, name: '建党节' },
                { date: `${year}-08-01`, name: '建军节' },
                { date: `${year}-09-10`, name: '教师节' },
                { date: `${year}-10-01`, name: '国庆节' },
                { date: `${year}-10-31`, name: '万圣节' },
                { date: `${year}-11-11`, name: '双十一' },
                { date: `${year}-12-24`, name: '平安夜' },
                { date: `${year}-12-25`, name: '圣诞节' },
                { date: `${year + 1}-01-01`, name: '元旦' }
            ]

            // 找出近期节日
            const upcoming = festivals
                .filter(f => new Date(f.date) >= now)
                .slice(0, 5)
                .map(f => {
                    const fDate = new Date(f.date)
                    const diff = Math.ceil((fDate - now) / (1000 * 60 * 60 * 24))
                    return {
                        name: f.name,
                        date: f.date,
                        days_left: diff
                    }
                })

            return {
                success: true,
                today: now.toISOString().split('T')[0],
                upcoming_festivals: upcoming
            }
        }
    },

    {
        name: 'format_number',
        description: '格式化数字（添加千位分隔符、转中文等）',
        inputSchema: {
            type: 'object',
            properties: {
                number: { type: 'number', description: '要格式化的数字' },
                format: {
                    type: 'string',
                    description: '格式：thousand(千位分隔)、chinese(中文数字)、currency(货币)',
                    enum: ['thousand', 'chinese', 'currency']
                },
                currency: { type: 'string', description: '货币符号，默认￥' }
            },
            required: ['number']
        },
        handler: async args => {
            const num = args.number
            const format = args.format || 'thousand'

            let result
            switch (format) {
                case 'thousand':
                    result = num.toLocaleString('zh-CN')
                    break
                case 'chinese':
                    const units = ['', '万', '亿', '万亿']
                    let n = Math.abs(num)
                    let unitIndex = 0
                    while (n >= 10000 && unitIndex < units.length - 1) {
                        n /= 10000
                        unitIndex++
                    }
                    result = (num < 0 ? '-' : '') + n.toFixed(2).replace(/\.?0+$/, '') + units[unitIndex]
                    break
                case 'currency':
                    const symbol = args.currency || '￥'
                    result =
                        symbol + num.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    break
                default:
                    result = String(num)
            }

            return {
                success: true,
                original: num,
                formatted: result,
                format
            }
        }
    }
]
