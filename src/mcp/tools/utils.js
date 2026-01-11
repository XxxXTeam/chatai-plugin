/**
 * 实用工具
 * 计算、转换、格式化等通用功能
 */

import crypto from 'node:crypto'

export const utilsTools = [
    {
        name: 'calculate',
        description: '执行数学计算（支持基本运算和函数）',
        inputSchema: {
            type: 'object',
            properties: {
                expression: { type: 'string', description: '数学表达式，如 "2 + 3 * 4" 或 "sqrt(16)"' }
            },
            required: ['expression']
        },
        handler: async args => {
            try {
                // 安全的数学表达式计算
                const expr = args.expression.replace(/\s+/g, '').replace(/[^0-9+\-*/().%^sqrtpilognabsceilfoor]/gi, '')

                // 支持的数学函数
                const mathFunctions = {
                    sqrt: Math.sqrt,
                    abs: Math.abs,
                    ceil: Math.ceil,
                    floor: Math.floor,
                    round: Math.round,
                    sin: Math.sin,
                    cos: Math.cos,
                    tan: Math.tan,
                    log: Math.log,
                    log10: Math.log10,
                    exp: Math.exp,
                    pow: Math.pow,
                    pi: Math.PI,
                    e: Math.E
                }

                // 替换函数名
                let safeExpr = expr
                for (const [name, fn] of Object.entries(mathFunctions)) {
                    if (typeof fn === 'number') {
                        safeExpr = safeExpr.replace(new RegExp(name, 'gi'), fn.toString())
                    }
                }

                // 使用 Function 计算（仍需谨慎）
                const result = Function(
                    `'use strict'; const {sqrt,abs,ceil,floor,round,sin,cos,tan,log,log10,exp,pow} = Math; return (${safeExpr})`
                )()

                if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
                    return { success: false, error: '计算结果无效' }
                }

                return {
                    success: true,
                    expression: args.expression,
                    result: result,
                    text: `${args.expression} = ${result}`
                }
            } catch (err) {
                return { success: false, error: `计算失败: ${err.message}` }
            }
        }
    },

    {
        name: 'random_number',
        description: '生成随机数',
        inputSchema: {
            type: 'object',
            properties: {
                min: { type: 'number', description: '最小值，默认1' },
                max: { type: 'number', description: '最大值，默认100' },
                count: { type: 'number', description: '生成数量，默认1' },
                unique: { type: 'boolean', description: '是否不重复，默认true' }
            }
        },
        handler: async args => {
            const min = args.min ?? 1
            const max = args.max ?? 100
            const count = Math.min(args.count || 1, 100)
            const unique = args.unique !== false

            if (min > max) {
                return { success: false, error: 'min 不能大于 max' }
            }

            const range = max - min + 1
            if (unique && count > range) {
                return { success: false, error: `范围内只有 ${range} 个数，无法生成 ${count} 个不重复数` }
            }

            const results = []
            const used = new Set()

            while (results.length < count) {
                const num = Math.floor(Math.random() * range) + min
                if (!unique || !used.has(num)) {
                    results.push(num)
                    used.add(num)
                }
            }

            return {
                success: true,
                min,
                max,
                count: results.length,
                numbers: results,
                text: results.join(', ')
            }
        }
    },

    {
        name: 'random_choice',
        description: '从列表中随机选择',
        inputSchema: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '选项列表'
                },
                count: { type: 'number', description: '选择数量，默认1' },
                unique: { type: 'boolean', description: '是否不重复选择，默认true' }
            },
            required: ['items']
        },
        handler: async args => {
            const items = args.items
            if (!items || items.length === 0) {
                return { success: false, error: '选项列表不能为空' }
            }

            const count = Math.min(args.count || 1, items.length)
            const unique = args.unique !== false

            const results = []
            const available = [...items]

            for (let i = 0; i < count; i++) {
                if (available.length === 0) break
                const idx = Math.floor(Math.random() * available.length)
                results.push(available[idx])
                if (unique) {
                    available.splice(idx, 1)
                }
            }

            return {
                success: true,
                count: results.length,
                selected: results,
                text: results.join('、')
            }
        }
    },

    {
        name: 'uuid',
        description: '生成 UUID',
        inputSchema: {
            type: 'object',
            properties: {
                version: { type: 'string', description: 'UUID版本：v4（默认）', enum: ['v4'] },
                count: { type: 'number', description: '生成数量，默认1' }
            }
        },
        handler: async args => {
            const count = Math.min(args.count || 1, 10)
            const uuids = []

            for (let i = 0; i < count; i++) {
                uuids.push(crypto.randomUUID())
            }

            return {
                success: true,
                count: uuids.length,
                uuids,
                text: uuids.join('\n')
            }
        }
    },

    {
        name: 'hash',
        description: '计算文本的哈希值',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要计算哈希的文本' },
                algorithm: {
                    type: 'string',
                    description: '哈希算法：md5, sha1, sha256, sha512',
                    enum: ['md5', 'sha1', 'sha256', 'sha512']
                }
            },
            required: ['text']
        },
        handler: async args => {
            try {
                const algorithm = args.algorithm || 'sha256'
                const hash = crypto.createHash(algorithm).update(args.text).digest('hex')

                return {
                    success: true,
                    algorithm,
                    hash,
                    text: `${algorithm.toUpperCase()}: ${hash}`
                }
            } catch (err) {
                return { success: false, error: `计算哈希失败: ${err.message}` }
            }
        }
    },

    {
        name: 'base64_encode',
        description: '将文本编码为 Base64',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要编码的文本' }
            },
            required: ['text']
        },
        handler: async args => {
            return {
                success: true,
                original: args.text,
                encoded: Buffer.from(args.text).toString('base64')
            }
        }
    },

    {
        name: 'base64_decode',
        description: '将 Base64 解码为文本',
        inputSchema: {
            type: 'object',
            properties: {
                base64: { type: 'string', description: 'Base64 编码的文本' }
            },
            required: ['base64']
        },
        handler: async args => {
            try {
                return {
                    success: true,
                    encoded: args.base64,
                    decoded: Buffer.from(args.base64, 'base64').toString('utf-8')
                }
            } catch (err) {
                return { success: false, error: `解码失败: ${err.message}` }
            }
        }
    },

    {
        name: 'url_encode',
        description: 'URL 编码/解码',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要处理的文本' },
                decode: { type: 'boolean', description: 'true解码，false编码（默认）' }
            },
            required: ['text']
        },
        handler: async args => {
            try {
                if (args.decode) {
                    return {
                        success: true,
                        original: args.text,
                        result: decodeURIComponent(args.text),
                        action: 'decode'
                    }
                } else {
                    return {
                        success: true,
                        original: args.text,
                        result: encodeURIComponent(args.text),
                        action: 'encode'
                    }
                }
            } catch (err) {
                return { success: false, error: `处理失败: ${err.message}` }
            }
        }
    },

    {
        name: 'json_format',
        description: '格式化或压缩 JSON',
        inputSchema: {
            type: 'object',
            properties: {
                json: { type: 'string', description: 'JSON 字符串' },
                minify: { type: 'boolean', description: 'true压缩，false美化（默认）' }
            },
            required: ['json']
        },
        handler: async args => {
            try {
                const parsed = JSON.parse(args.json)
                const result = args.minify ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2)

                return {
                    success: true,
                    result,
                    action: args.minify ? 'minify' : 'format'
                }
            } catch (err) {
                return { success: false, error: `JSON 解析失败: ${err.message}` }
            }
        }
    },

    {
        name: 'timestamp',
        description: '时间戳转换',
        inputSchema: {
            type: 'object',
            properties: {
                timestamp: { type: 'number', description: '时间戳（秒或毫秒）' },
                datetime: { type: 'string', description: '日期时间字符串' },
                format: { type: 'string', description: '输出格式' }
            }
        },
        handler: async args => {
            try {
                let date

                if (args.timestamp) {
                    // 自动识别秒或毫秒
                    const ts = args.timestamp > 1e12 ? args.timestamp : args.timestamp * 1000
                    date = new Date(ts)
                } else if (args.datetime) {
                    date = new Date(args.datetime)
                } else {
                    date = new Date()
                }

                if (isNaN(date.getTime())) {
                    return { success: false, error: '无效的时间' }
                }

                return {
                    success: true,
                    timestamp_s: Math.floor(date.getTime() / 1000),
                    timestamp_ms: date.getTime(),
                    iso: date.toISOString(),
                    local: date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
                    utc: date.toUTCString()
                }
            } catch (err) {
                return { success: false, error: `时间转换失败: ${err.message}` }
            }
        }
    },

    {
        name: 'countdown',
        description: '计算距离目标时间的倒计时',
        inputSchema: {
            type: 'object',
            properties: {
                target: { type: 'string', description: '目标时间，如 "2025-01-01" 或 "2025-12-31 23:59:59"' },
                title: { type: 'string', description: '倒计时标题' }
            },
            required: ['target']
        },
        handler: async args => {
            try {
                const target = new Date(args.target)
                if (isNaN(target.getTime())) {
                    return { success: false, error: '无效的目标时间' }
                }

                const now = new Date()
                const diff = target.getTime() - now.getTime()

                if (diff <= 0) {
                    return {
                        success: true,
                        title: args.title || '倒计时',
                        target: args.target,
                        passed: true,
                        text: `${args.title || '目标时间'} 已过去`
                    }
                }

                const days = Math.floor(diff / (1000 * 60 * 60 * 24))
                const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
                const seconds = Math.floor((diff % (1000 * 60)) / 1000)

                return {
                    success: true,
                    title: args.title || '倒计时',
                    target: args.target,
                    days,
                    hours,
                    minutes,
                    seconds,
                    total_seconds: Math.floor(diff / 1000),
                    text: `距离${args.title || '目标'}: ${days}天${hours}小时${minutes}分钟${seconds}秒`
                }
            } catch (err) {
                return { success: false, error: `计算失败: ${err.message}` }
            }
        }
    },

    {
        name: 'regex_match',
        description: '使用正则表达式匹配文本',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要匹配的文本' },
                pattern: { type: 'string', description: '正则表达式模式' },
                flags: { type: 'string', description: '正则标志（g/i/m等），默认gi' }
            },
            required: ['text', 'pattern']
        },
        handler: async args => {
            try {
                const regex = new RegExp(args.pattern, args.flags || 'gi')
                const matches = args.text.match(regex) || []

                return {
                    success: true,
                    pattern: args.pattern,
                    count: matches.length,
                    matches
                }
            } catch (err) {
                return { success: false, error: `正则匹配失败: ${err.message}` }
            }
        }
    },

    {
        name: 'regex_replace',
        description: '使用正则表达式替换文本',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '原文本' },
                pattern: { type: 'string', description: '正则表达式模式' },
                replacement: { type: 'string', description: '替换内容' },
                flags: { type: 'string', description: '正则标志，默认g' }
            },
            required: ['text', 'pattern', 'replacement']
        },
        handler: async args => {
            try {
                const regex = new RegExp(args.pattern, args.flags || 'g')
                const result = args.text.replace(regex, args.replacement)

                return {
                    success: true,
                    original: args.text,
                    result,
                    replaced: args.text !== result
                }
            } catch (err) {
                return { success: false, error: `正则替换失败: ${err.message}` }
            }
        }
    },

    {
        name: 'text_stats',
        description: '统计文本信息（字数、行数等）',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要统计的文本' }
            },
            required: ['text']
        },
        handler: async args => {
            const text = args.text
            const lines = text.split('\n')
            const words = text.match(/[\u4e00-\u9fa5]|[a-zA-Z]+/g) || []
            const chars = text.replace(/\s/g, '').length
            const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
            const englishWords = (text.match(/[a-zA-Z]+/g) || []).length
            const numbers = (text.match(/\d+/g) || []).length

            return {
                success: true,
                char_count: text.length,
                char_count_no_space: chars,
                word_count: words.length,
                line_count: lines.length,
                chinese_chars: chineseChars,
                english_words: englishWords,
                numbers
            }
        }
    },

    {
        name: 'text_transform',
        description: '文本转换（大小写、繁简体等）',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要转换的文本' },
                transform: {
                    type: 'string',
                    description:
                        '转换类型：upper(大写)、lower(小写)、capitalize(首字母大写)、reverse(反转)、trim(去空格)',
                    enum: ['upper', 'lower', 'capitalize', 'reverse', 'trim']
                }
            },
            required: ['text', 'transform']
        },
        handler: async args => {
            let result
            switch (args.transform) {
                case 'upper':
                    result = args.text.toUpperCase()
                    break
                case 'lower':
                    result = args.text.toLowerCase()
                    break
                case 'capitalize':
                    result = args.text.replace(/\b\w/g, c => c.toUpperCase())
                    break
                case 'reverse':
                    result = [...args.text].reverse().join('')
                    break
                case 'trim':
                    result = args.text.trim().replace(/\s+/g, ' ')
                    break
                default:
                    result = args.text
            }

            return {
                success: true,
                original: args.text,
                result,
                transform: args.transform
            }
        }
    },

    {
        name: 'extract_urls',
        description: '从文本中提取URL链接',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要提取的文本' }
            },
            required: ['text']
        },
        handler: async args => {
            const urlRegex = /https?:\/\/[^\s<>\[\]()]+/gi
            const urls = args.text.match(urlRegex) || []

            return {
                success: true,
                count: urls.length,
                urls
            }
        }
    },

    {
        name: 'extract_emails',
        description: '从文本中提取邮箱地址',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要提取的文本' }
            },
            required: ['text']
        },
        handler: async args => {
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi
            const emails = args.text.match(emailRegex) || []

            return {
                success: true,
                count: emails.length,
                emails
            }
        }
    },

    {
        name: 'extract_phones',
        description: '从文本中提取手机号码',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要提取的文本' }
            },
            required: ['text']
        },
        handler: async args => {
            const phoneRegex = /1[3-9]\d{9}/g
            const phones = args.text.match(phoneRegex) || []

            return {
                success: true,
                count: phones.length,
                phones
            }
        }
    },

    {
        name: 'split_text',
        description: '按分隔符分割文本',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要分割的文本' },
                delimiter: { type: 'string', description: '分隔符，默认换行' },
                trim: { type: 'boolean', description: '是否去除每项空白，默认true' },
                filter_empty: { type: 'boolean', description: '是否过滤空项，默认true' }
            },
            required: ['text']
        },
        handler: async args => {
            const delimiter = args.delimiter || '\n'
            let parts = args.text.split(delimiter)

            if (args.trim !== false) {
                parts = parts.map(p => p.trim())
            }
            if (args.filter_empty !== false) {
                parts = parts.filter(p => p.length > 0)
            }

            return {
                success: true,
                count: parts.length,
                parts
            }
        }
    },

    {
        name: 'join_text',
        description: '将数组合并为文本',
        inputSchema: {
            type: 'object',
            properties: {
                items: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '要合并的项'
                },
                delimiter: { type: 'string', description: '分隔符，默认换行' }
            },
            required: ['items']
        },
        handler: async args => {
            const delimiter = args.delimiter ?? '\n'
            const result = args.items.join(delimiter)

            return {
                success: true,
                count: args.items.length,
                result
            }
        }
    },

    {
        name: 'truncate_text',
        description: '截断文本到指定长度',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要截断的文本' },
                length: { type: 'number', description: '最大长度' },
                suffix: { type: 'string', description: '后缀，默认...' }
            },
            required: ['text', 'length']
        },
        handler: async args => {
            const suffix = args.suffix ?? '...'
            const maxLen = args.length - suffix.length

            if (args.text.length <= args.length) {
                return { success: true, result: args.text, truncated: false }
            }

            const result = args.text.substring(0, maxLen) + suffix
            return { success: true, result, truncated: true }
        }
    },

    {
        name: 'escape_html',
        description: 'HTML转义/反转义',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要处理的文本' },
                unescape: { type: 'boolean', description: 'true反转义，false转义（默认）' }
            },
            required: ['text']
        },
        handler: async args => {
            let result
            if (args.unescape) {
                result = args.text
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
            } else {
                result = args.text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;')
            }

            return {
                success: true,
                original: args.text,
                result,
                action: args.unescape ? 'unescape' : 'escape'
            }
        }
    },

    {
        name: 'generate_password',
        description: '生成随机密码',
        inputSchema: {
            type: 'object',
            properties: {
                length: { type: 'number', description: '密码长度，默认16' },
                include_upper: { type: 'boolean', description: '包含大写字母，默认true' },
                include_lower: { type: 'boolean', description: '包含小写字母，默认true' },
                include_numbers: { type: 'boolean', description: '包含数字，默认true' },
                include_symbols: { type: 'boolean', description: '包含符号，默认true' }
            }
        },
        handler: async args => {
            const length = args.length || 16
            let chars = ''

            if (args.include_upper !== false) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
            if (args.include_lower !== false) chars += 'abcdefghijklmnopqrstuvwxyz'
            if (args.include_numbers !== false) chars += '0123456789'
            if (args.include_symbols !== false) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?'

            if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz0123456789'

            let password = ''
            for (let i = 0; i < length; i++) {
                password += chars[Math.floor(Math.random() * chars.length)]
            }

            return {
                success: true,
                password,
                length
            }
        }
    },

    {
        name: 'dice_roll',
        description: '掷骰子',
        inputSchema: {
            type: 'object',
            properties: {
                dice: { type: 'string', description: '骰子表达式，如 "2d6+3" 或 "d20"' },
                count: { type: 'number', description: '掷几次，默认1' }
            },
            required: ['dice']
        },
        handler: async args => {
            try {
                const count = Math.min(args.count || 1, 10)
                const results = []

                // 解析骰子表达式 如 2d6+3
                const match = args.dice.toLowerCase().match(/^(\d*)d(\d+)([+-]\d+)?$/)
                if (!match) {
                    return { success: false, error: '无效的骰子表达式，格式如 "2d6+3" 或 "d20"' }
                }

                const diceCount = parseInt(match[1]) || 1
                const diceSides = parseInt(match[2])
                const modifier = parseInt(match[3]) || 0

                if (diceSides < 2 || diceSides > 100) {
                    return { success: false, error: '骰子面数必须在2-100之间' }
                }
                if (diceCount > 20) {
                    return { success: false, error: '单次最多掷20个骰子' }
                }

                for (let i = 0; i < count; i++) {
                    const rolls = []
                    for (let j = 0; j < diceCount; j++) {
                        rolls.push(Math.floor(Math.random() * diceSides) + 1)
                    }
                    const sum = rolls.reduce((a, b) => a + b, 0) + modifier
                    results.push({ rolls, modifier, total: sum })
                }

                return {
                    success: true,
                    dice: args.dice,
                    count,
                    results,
                    summary: results.map(r => r.total).join(', ')
                }
            } catch (err) {
                return { success: false, error: `掷骰子失败: ${err.message}` }
            }
        }
    },

    {
        name: 'draw_lots',
        description: '抽签/抽奖',
        inputSchema: {
            type: 'object',
            properties: {
                options: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '选项列表，不填则使用默认签文'
                },
                count: { type: 'number', description: '抽取数量，默认1' }
            }
        },
        handler: async args => {
            const defaultOptions = [
                '大吉：万事如意，心想事成',
                '中吉：诸事顺遂，稳中有进',
                '小吉：平安顺利，小有收获',
                '吉：普通运势，保持平常心',
                '末吉：运势一般，需要努力',
                '凶：注意小心，谨慎行事',
                '大凶：多加注意，化险为夷'
            ]

            const options = args.options?.length > 0 ? args.options : defaultOptions
            const count = Math.min(args.count || 1, options.length)

            const shuffled = [...options].sort(() => Math.random() - 0.5)
            const selected = shuffled.slice(0, count)

            return {
                success: true,
                count,
                results: selected
            }
        }
    }
]
