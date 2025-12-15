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
        handler: async (args) => {
            try {
                // 安全的数学表达式计算
                const expr = args.expression
                    .replace(/\s+/g, '')
                    .replace(/[^0-9+\-*/().%^sqrtpilognabsceilfoor]/gi, '')
                
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
                const result = Function(`'use strict'; const {sqrt,abs,ceil,floor,round,sin,cos,tan,log,log10,exp,pow} = Math; return (${safeExpr})`)()
                
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
        handler: async (args) => {
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
        handler: async (args) => {
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
        handler: async (args) => {
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
                algorithm: { type: 'string', description: '哈希算法：md5, sha1, sha256, sha512', enum: ['md5', 'sha1', 'sha256', 'sha512'] }
            },
            required: ['text']
        },
        handler: async (args) => {
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
        handler: async (args) => {
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
        handler: async (args) => {
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
        handler: async (args) => {
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
        handler: async (args) => {
            try {
                const parsed = JSON.parse(args.json)
                const result = args.minify 
                    ? JSON.stringify(parsed) 
                    : JSON.stringify(parsed, null, 2)
                
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
        handler: async (args) => {
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
        handler: async (args) => {
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
    }
]
