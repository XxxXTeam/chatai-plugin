import { marked } from 'marked'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { logService } from '../stats/LogService.js'
import { generateModernSummaryHtml } from './templates/groupSummaryModern.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 插件根目录
const PLUGIN_ROOT = path.join(__dirname, '../../../')

// 加载 puppeteer
let puppeteer = null
try {
    puppeteer = (await import('puppeteer')).default
} catch (e) {
    logService.warn('[RenderService] Puppeteer 加载失败，图片渲染将不可用')
}

let canvasModule = null
try {
    canvasModule = await import('@napi-rs/canvas')
} catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
    } else {
    }
}

/**
 * Markdown渲染服务 - 将Markdown转换为图片
 * 支持群聊总结、用户画像、分析报告等场景
 */
class RenderService {
    constructor() {
        this.browser = null
        this.defaultTheme = 'light'
        this.templateDir = path.join(__dirname, '../../resources/templates')
        this.useCanvas = !!canvasModule
        this.fontLoaded = false

        // 数学公式检测正则表达式
        this.mathPatterns = {
            // LaTeX 块级公式 $$...$$
            blockLatex: /\$\$[\s\S]+?\$\$/g,
            // LaTeX 行内公式 $...$（排除货币符号）
            inlineLatex: /(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$/g,
            // \[...\] 块级公式
            bracketBlock: /\\\[[\s\S]+?\\\]/g,
            // \(...\) 行内公式
            bracketInline: /\\\([\s\S]+?\\\)/g,
            // \begin{...}...\end{...} 环境
            latexEnv: /\\begin\{[^}]+\}[\s\S]+?\\end\{[^}]+\}/g,
            // 常见数学命令
            mathCommands:
                /\\(frac|sqrt|sum|int|prod|lim|sin|cos|tan|log|ln|exp|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|infty|partial|nabla|cdot|times|div|pm|mp|leq|geq|neq|approx|equiv|subset|supset|cap|cup|in|notin|forall|exists|rightarrow|leftarrow|Rightarrow|Leftarrow|vec|hat|bar|dot|ddot|matrix|bmatrix|pmatrix|cases)\b/,
            // 函数表示如 f(x), g(x), f'(x), f''(x)
            functionNotation: /\b[fghFGH]'*\s*\([^)]+\)/g,
            // 极限表示 lim(x→...) 或 lim_{x→...}
            limitNotation: /lim\s*[({\[]?\s*[a-zA-Z]\s*(?:→|->)+\s*[^)\]}>\s]+/gi,
            // 下标和上标 Unicode 字符
            subscriptSuperscript: /[₀-₉ₐ-ₜ²³¹⁰-ⁿⁱ]/g,
            // 导数表示 f'(x), y', dy/dx
            derivativeNotation: /\b[a-zA-Z]'+'|d[a-zA-Z]\/d[a-zA-Z]/g,
            // 积分表示 ∫
            integralSymbol: /∫/g,
            // 数学符号 ∑, ∏, ∞, ∂, √, ±, ≈, ≠, ≤, ≥, ∈, ∉
            mathSymbols: /[∑∏∞∂√±≈≠≤≥∈∉⊂⊃∩∪∀∃→←⇒⇐×÷∙⋅]/g,
            // 三角函数（无空格）sinx, cosx, tanx
            trigFunctions: /\b(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh)[a-zA-Zα-ω]/gi,
            // 常见数学表达式模式（含上标、分数线等）
            mathExprPattern: /[a-zA-Z][²³⁰-ⁿ]|[a-zA-Z]\^\d+|\([^)]+\)\/\([^)]+\)|\[[^\]]+\]\/\[[^\]]+\]/g,
            // 希腊字母
            greekLetters: /[α-ωΑ-Ω]/g,
            // 数学区间表示 [a,b], (a,b), [a,b)
            intervalNotation: /[\[(]\s*-?\d*[a-zA-Z]?\s*,\s*-?\d*[a-zA-Z]?\s*[\])]/g
        }
    }

    /**
     * 检测文本中是否包含数学公式
     * @param {string} text - 要检测的文本
     * @returns {{ hasMath: boolean, confidence: 'high'|'medium'|'low', matches: string[] }}
     */
    detectMathFormulas(text) {
        if (!text || typeof text !== 'string') {
            return { hasMath: false, confidence: 'low', matches: [], mathScore: 0 }
        }

        const matches = []
        let confidence = 'low'
        let mathScore = 0

        // 排除普通文本中的数字和常见格式
        // 如：日期、时间、版本号、货币、百分比等
        const excludePatterns = [
            /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g, // 日期
            /\d{1,2}:\d{2}(:\d{2})?/g, // 时间
            /v?\d+\.\d+(\.\d+)?/gi, // 版本号
            /[¥$€£]\s*\d+/g, // 货币
            /\d+%/g, // 百分比
            /\d+\s*(个|条|篇|次|人|天|小时|分钟|秒)/g // 中文计数
        ]

        let cleanText = text
        for (const pattern of excludePatterns) {
            cleanText = cleanText.replace(pattern, ' ')
        }

        // 只检测明确的 LaTeX 语法
        const blockMatches = text.match(this.mathPatterns.blockLatex) || []
        if (blockMatches.length > 0) {
            // 验证块级公式内容确实包含数学元素
            const validBlocks = blockMatches.filter(
                m =>
                    this.mathPatterns.mathCommands.test(m) ||
                    /[+\-*/=<>^_{}\\]/.test(m) ||
                    /[α-ωΑ-Ω∑∏∞∂√±≈≠≤≥∈∉]/.test(m)
            )
            if (validBlocks.length > 0) {
                matches.push(...validBlocks)
                confidence = 'high'
                mathScore += validBlocks.length * 10
            }
        }

        // 检测 \[...\] 块级公式
        const bracketBlockMatches = text.match(this.mathPatterns.bracketBlock) || []
        if (bracketBlockMatches.length > 0) {
            matches.push(...bracketBlockMatches)
            confidence = 'high'
            mathScore += bracketBlockMatches.length * 10
        }

        // 检测 LaTeX 环境
        const envMatches = text.match(this.mathPatterns.latexEnv) || []
        if (envMatches.length > 0) {
            matches.push(...envMatches)
            confidence = 'high'
            mathScore += envMatches.length * 10
        }

        // 检测行内 LaTeX 公式 $...$ - 更严格的验证
        const inlineMatches = text.match(this.mathPatterns.inlineLatex) || []
        if (inlineMatches.length > 0) {
            const validInline = inlineMatches.filter(m => {
                // 必须包含 LaTeX 命令或明确的数学运算符
                const hasLatexCmd = this.mathPatterns.mathCommands.test(m)
                const hasMathOps = /[+\-*/=<>^_{}\\]/.test(m) && m.length > 3
                const hasVarNum = /[a-zA-Z][²³⁰-ⁿ]|\d+[a-zA-Z]/.test(m)
                const hasGreek = /[α-ωΑ-Ω]/.test(m)
                // 排除纯数字和简单文本
                const isPureNumber = /^\$\s*\d+(\.\d+)?\s*\$$/.test(m)
                const isSimpleText = /^\$\s*[a-zA-Z]+\s*\$$/.test(m) && m.length < 8

                return (hasLatexCmd || hasMathOps || hasVarNum || hasGreek) && !isPureNumber && !isSimpleText
            })
            if (validInline.length > 0) {
                matches.push(...validInline)
                if (confidence !== 'high') confidence = 'medium'
                mathScore += validInline.length * 5
            }
        }

        // 检测 \(...\) 行内公式
        const bracketInlineMatches = text.match(this.mathPatterns.bracketInline) || []
        if (bracketInlineMatches.length > 0) {
            matches.push(...bracketInlineMatches)
            if (confidence !== 'high') confidence = 'medium'
            mathScore += bracketInlineMatches.length * 5
        }

        // 以下检测只在明确的数学上下文中才加分
        // 检测LaTeX数学命令 - 这是最可靠的指标
        if (this.mathPatterns.mathCommands.test(text)) {
            mathScore += 8
            if (confidence === 'low') confidence = 'medium'
        }

        // 检测积分符号
        const integralMatches = text.match(this.mathPatterns.integralSymbol) || []
        mathScore += integralMatches.length * 5

        // 检测数学符号 (∑, ∞, ∂ 等) - 只有这些才明确是数学
        const symbolMatches = text.match(this.mathPatterns.mathSymbols) || []
        mathScore += symbolMatches.length * 4

        // 检测希腊字母
        const greekMatches = text.match(this.mathPatterns.greekLetters) || []
        mathScore += greekMatches.length * 3

        // 检测下标上标 (₀-₉, ²³等)
        const subSupMatches = text.match(this.mathPatterns.subscriptSuperscript) || []
        mathScore += subSupMatches.length * 2

        // 检测极限表示 lim(x→...)
        const limitMatches = text.match(this.mathPatterns.limitNotation) || []
        mathScore += limitMatches.length * 5

        // 检测函数表示 f(x), g(x)
        const funcMatches = text.match(this.mathPatterns.functionNotation) || []
        mathScore += funcMatches.length * 2

        // 检测三角函数 sin, cos, tan 等跟着变量
        const trigMatches = text.match(this.mathPatterns.trigFunctions) || []
        mathScore += trigMatches.length * 3

        // 检测数学表达式模式（分数、幂等）
        const exprMatches = text.match(this.mathPatterns.mathExprPattern) || []
        mathScore += exprMatches.length * 3

        // 提高阈值，避免误判
        if (mathScore >= 20 && confidence !== 'high') {
            confidence = 'high'
        } else if (mathScore >= 12 && confidence === 'low') {
            confidence = 'medium'
        }

        // 提高判定阈值
        const hasMath = (mathScore >= 12 && matches.length > 0) || mathScore >= 20

        return {
            hasMath,
            confidence,
            mathScore,
            matches: [...new Set(matches)]
        }
    }

    /**
     * 将纯文本数学表达式转换为 LaTeX 格式
     * 支持全部类型的公式
     * @param {string} text - 原始文本
     * @returns {string} 转换后的文本
     */
    convertToLatex(text) {
        if (!text) return text
        if (/\$[\s\S]+?\$/.test(text)) return text

        let result = text
        result = result.replace(/\[([^\[\]]+)\]\/\[([^\[\]]+)\]/g, '\\frac{$1}{$2}')
        result = result.replace(/\[([^\[\]]+)\]\/([a-zA-Z0-9^{}]+)/g, '\\frac{$1}{$2}')
        result = result.replace(/([a-zA-Z0-9^{}]+)\/\[([^\[\]]+)\]/g, '\\frac{$1}{$2}')
        // (a)/(b) 或 (a)/b
        result = result.replace(/\(([^()]+)\)\/\(([^()]+)\)/g, '\\frac{$1}{$2}')
        result = result.replace(/\(([^()]+)\)\/([a-zA-Z0-9^{}]+)/g, '\\frac{$1}{$2}')
        // 简单分数 a/b
        result = result.replace(/\b([a-zA-Z0-9]+)\/([a-zA-Z0-9^{}]+)\b/g, '\\frac{$1}{$2}')
        result = result.replace(/\^\{([^}]+)\}/g, '^{$1}') // 保持已有格式
        result = result.replace(/\^(\d+)/g, '^{$1}') // x^2 -> x^{2}
        result = result.replace(/\^([a-zA-Z])(?![a-zA-Z{])/g, '^{$1}') // x^n -> x^{n}
        result = result.replace(/²/g, '^{2}') // ² -> ^{2}
        result = result.replace(/³/g, '^{3}') // ³ -> ^{3}

        result = result.replace(/_\{([^}]+)\}/g, '_{$1}') // 保持已有格式
        result = result.replace(/_(\d+)/g, '_{$1}') // x_1 -> x_{1}
        result = result.replace(/_([a-zA-Z])(?![a-zA-Z{])/g, '_{$1}') // x_n -> x_{n}
        // Unicode下标
        result = result.replace(/[₀-₉]/g, m => `_{${m.charCodeAt(0) - 0x2080}}`)
        const greekMap = {
            α: '\\alpha',
            β: '\\beta',
            γ: '\\gamma',
            δ: '\\delta',
            ε: '\\epsilon',
            θ: '\\theta',
            λ: '\\lambda',
            μ: '\\mu',
            π: '\\pi',
            σ: '\\sigma',
            ω: '\\omega',
            ξ: '\\xi',
            η: '\\eta',
            ζ: '\\zeta',
            '∞': '\\infty'
        }
        for (const [g, l] of Object.entries(greekMap)) {
            result = result.replace(new RegExp(g, 'g'), l)
        }
        result = result.replace(/→/g, '\\to')
        result = result.replace(/->/g, '\\to')
        result = result.replace(/±/g, '\\pm')
        result = result.replace(/≈/g, '\\approx')
        result = result.replace(/≠/g, '\\neq')
        result = result.replace(/≤/g, '\\leq')
        result = result.replace(/≥/g, '\\geq')
        result = result.replace(/∈/g, '\\in')
        result = result.replace(/×/g, '\\times ')
        result = result.replace(/·/g, '\\cdot ')
        result = result.replace(/√/g, '\\sqrt ')
        result = result.replace(/∫/g, '\\int ')
        result = result.replace(/∑/g, '\\sum ')
        result = result.replace(/∏/g, '\\prod ')
        result = result.replace(/∂/g, '\\partial ')
        result = result.replace(/\b(sin|cos|tan|cot|sec|csc|ln|log|exp|lim|max|min|sup|inf)(?![a-zA-Z\\])/gi, '\\$1 ')
        // 修复LaTeX命令后紧跟字母的问题，如 \cdotx -> \cdot x
        result = result.replace(
            /\\(cdot|times|to|pm|approx|neq|leq|geq|in|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|xi|eta|zeta|infty)([a-zA-Z])/g,
            '\\$1 $2'
        )
        const mathPattern = /\\[a-zA-Z]+|\^{|_{/
        if (!mathPattern.test(result)) return result

        // 按行处理
        return result
            .split('\n')
            .map(line => {
                // 纯中文行跳过
                if (/^[\u4e00-\u9fa5，。：！？、\s~\-（）]+$/.test(line)) return line
                if (!mathPattern.test(line)) return line
                let processed = ''
                let i = 0

                while (i < line.length) {
                    // 检查是否是数学表达式开始
                    const remaining = line.slice(i)

                    // 匹配: \command 或 字母数字后跟^{或_{
                    const mathStart = remaining.match(/^([a-zA-Z0-9]*)(\\[a-zA-Z]+|\^{|_{)/)

                    if (mathStart) {
                        // 找到数学表达式开始
                        let mathExpr = mathStart[1] // 前缀字母/数字
                        let j = mathStart[1].length
                        let braceDepth = 0

                        // 继续扫描直到表达式结束
                        while (j < remaining.length) {
                            const ch = remaining[j]

                            if (ch === '{') braceDepth++
                            else if (ch === '}') braceDepth--

                            // 检查是否到达表达式结尾
                            if (braceDepth === 0) {
                                const next = remaining[j + 1]
                                // 如果下一个字符是中文或空格或特殊符号，表达式结束
                                if (!next || /[\u4e00-\u9fa5，。：；]/.test(next)) {
                                    mathExpr += remaining.slice(mathStart[1].length, j + 1)
                                    break
                                }
                                // 如果不是数学相关字符，结束
                                if (!/[a-zA-Z0-9_^{}\\+\-=*/(.)\[\]\s]/.test(next)) {
                                    mathExpr += remaining.slice(mathStart[1].length, j + 1)
                                    break
                                }
                            }
                            j++
                        }
                        if (j >= remaining.length) {
                            mathExpr += remaining.slice(mathStart[1].length)
                            j = remaining.length
                        }

                        // 包裹数学表达式
                        if (mathExpr && /\\|\^{|_{/.test(mathExpr)) {
                            processed += `$${mathExpr.trim()}$`
                        } else {
                            processed += mathExpr
                        }
                        i += j
                    } else {
                        // 不是数学表达式，添加当前字符
                        processed += line[i]
                        i++
                    }
                }

                return processed
            })
            .join('\n')
    }

    /**
     * 渲染包含数学公式的文本为图片
     * @param {string} text - 包含数学公式的文本
     * @param {Object} options - 渲染选项
     * @returns {Promise<Buffer>} 图片Buffer
     */
    async renderMathContent(text, options = {}) {
        const { theme = 'light', width = 800, showTimestamp = false, title = '' } = options
        const processedText = this.convertToLatex(text)
        return this.renderMarkdownToImage({
            markdown: processedText,
            title,
            subtitle: '',
            icon: '📐',
            theme,
            width,
            showTimestamp
        })
    }

    /**
     * 获取或创建浏览器实例
     */
    async getBrowser() {
        if (!this.browser || !this.browser.isConnected()) {
            this.browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                headless: true,
                timeout: 30000
            })
        }
        return this.browser
    }

    /**
     * 关闭浏览器实例
     */
    async closeBrowser() {
        if (this.browser) {
            try {
                await this.browser.close()
            } catch (e) {
                logService.warn('[RenderService] 关闭浏览器失败:', e.message)
            }
            this.browser = null
        }
    }

    /**
     * 加载字体（Canvas渲染需要）
     */
    async loadFonts() {
        if (!canvasModule || this.fontLoaded) return
        try {
            const { GlobalFonts } = canvasModule

            // 优先使用插件自带字体
            const pluginFontDir = path.join(PLUGIN_ROOT, 'data/font')
            const pluginFonts = [
                { path: path.join(pluginFontDir, 'LXGWNeoXiHeiScreen.ttf'), name: 'LXGW' },
                { path: path.join(pluginFontDir, 'InconsolataNerdFontPropo-Bold.ttf'), name: 'Inconsolata' }
            ]

            for (const font of pluginFonts) {
                if (fs.existsSync(font.path)) {
                    try {
                        GlobalFonts.registerFromPath(font.path, font.name)
                        logService.debug(`[RenderService] 已加载字体: ${font.name}`)
                        this.fontLoaded = true
                    } catch (e) {
                        logService.warn(`[RenderService] 加载字体 ${font.name} 失败:`, e.message)
                    }
                }
            }

            // 回退到系统字体
            if (!this.fontLoaded) {
                const systemFontPaths = [
                    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
                    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
                    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
                    '/System/Library/Fonts/PingFang.ttc',
                    'C:\\Windows\\Fonts\\msyh.ttc'
                ]
                for (const fontPath of systemFontPaths) {
                    if (fs.existsSync(fontPath)) {
                        GlobalFonts.registerFromPath(fontPath, 'SystemCJK')
                        logService.debug(`[RenderService] 已加载系统字体: ${fontPath}`)
                        this.fontLoaded = true
                        break
                    }
                }
            }

            if (!this.fontLoaded) {
                logService.warn('[RenderService] 未找到中文字体，请将字体文件放入 data/font 目录')
            }
        } catch (e) {
            logService.warn('[RenderService] 加载字体失败:', e.message)
        }
    }

    /**
     * Canvas快速渲染 - 用于简单文本场景
     * @param {Object} options - 渲染选项
     * @returns {Promise<Buffer>}
     */
    async renderWithCanvas(options) {
        if (!canvasModule) {
            throw new Error('Canvas模块未加载')
        }

        await this.loadFonts()

        const {
            lines = [],
            width = 520,
            padding = 20,
            lineHeight = 1.6,
            fontSize = 14,
            fontFamily = 'LXGW, SystemCJK, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
            bgColor = '#FFFCFA',
            textColor = '#4A4035',
            titleColor = '#B85520',
            accentColor = '#FFB080',
            headerBg = null,
            headerHeight = 0,
            footerText = '',
            title = '',
            subtitle = ''
        } = options

        const { createCanvas } = canvasModule

        // 计算内容高度
        const contentPadding = padding * 2
        let totalHeight = contentPadding + headerHeight
        const lineHeightPx = fontSize * lineHeight

        // 预计算每行高度
        const parsedLines = lines.map(line => {
            const isTitle = line.startsWith('# ') || line.startsWith('## ')
            const isSubtitle = line.startsWith('### ')
            const isList = line.startsWith('- ') || line.startsWith('• ') || /^\d+\.\s/.test(line)
            const isQuote = line.startsWith('> ')
            const isEmpty = !line.trim()

            let height = lineHeightPx
            if (isTitle) height = fontSize * 1.8 * lineHeight
            else if (isSubtitle) height = fontSize * 1.4 * lineHeight
            else if (isEmpty) height = lineHeightPx * 0.5

            return { text: line, height, isTitle, isSubtitle, isList, isQuote, isEmpty }
        })

        totalHeight += parsedLines.reduce((sum, l) => sum + l.height, 0)
        totalHeight += 40 // footer

        // 创建 Canvas
        const canvas = createCanvas(width, Math.max(totalHeight, 200))
        const ctx = canvas.getContext('2d')

        // 绘制背景
        ctx.fillStyle = bgColor
        ctx.fillRect(0, 0, width, totalHeight)

        // 绘制头部（如果有）
        if (headerBg && headerHeight > 0) {
            const gradient = ctx.createLinearGradient(0, 0, width, headerHeight)
            gradient.addColorStop(0, '#FFEEE6')
            gradient.addColorStop(0.5, '#FFE0D0')
            gradient.addColorStop(1, '#FFD4C0')
            ctx.fillStyle = gradient
            ctx.fillRect(0, 0, width, headerHeight)

            // 绘制标题
            if (title) {
                ctx.font = `bold ${fontSize * 1.2}px ${fontFamily}`
                ctx.fillStyle = '#C75000'
                ctx.fillText(title, padding, padding + fontSize * 1.2)
            }
            if (subtitle) {
                ctx.font = `${fontSize * 0.85}px ${fontFamily}`
                ctx.fillStyle = '#D07030'
                ctx.fillText(subtitle, padding, padding + fontSize * 1.2 + fontSize)
            }
        }

        // 绘制内容
        let y = headerHeight + padding + fontSize

        for (const line of parsedLines) {
            if (line.isEmpty) {
                y += line.height
                continue
            }

            let text = line.text
            let x = padding

            // 标题样式
            if (line.isTitle) {
                text = text.replace(/^#{1,2}\s*/, '')
                ctx.font = `600 ${fontSize * 1.3}px ${fontFamily}`
                ctx.fillStyle = titleColor

                // 绘制左侧装饰条
                const gradient = ctx.createLinearGradient(x, y - fontSize, x, y + 4)
                gradient.addColorStop(0, '#FF8C42')
                gradient.addColorStop(1, '#FFB080')
                ctx.fillStyle = gradient
                ctx.fillRect(x, y - fontSize * 0.9, 4, fontSize * 1.1)
                x += 12

                ctx.fillStyle = titleColor
                ctx.fillText(text, x, y)
            } else if (line.isSubtitle) {
                text = text.replace(/^###\s*/, '')
                ctx.font = `600 ${fontSize * 1.1}px ${fontFamily}`
                ctx.fillStyle = '#C06830'

                // 左侧边框
                ctx.fillStyle = accentColor
                ctx.fillRect(x, y - fontSize * 0.8, 3, fontSize)
                x += 10

                ctx.fillStyle = '#C06830'
                ctx.fillText(text, x, y)
            } else if (line.isList) {
                // 列表项
                text = text.replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, '')
                ctx.font = `${fontSize}px ${fontFamily}`

                // 绘制列表标记
                ctx.fillStyle = accentColor
                ctx.fillText('◆', x + 4, y)
                x += 20

                ctx.fillStyle = textColor
                ctx.fillText(text, x, y)
            } else if (line.isQuote) {
                text = text.replace(/^>\s*/, '')

                // 引用块背景
                ctx.fillStyle = '#FFF8F2'
                ctx.fillRect(x, y - fontSize * 0.9, width - padding * 2, fontSize * 1.4)

                // 左侧边框
                ctx.fillStyle = '#FF9060'
                ctx.fillRect(x, y - fontSize * 0.9, 4, fontSize * 1.4)

                ctx.font = `${fontSize * 0.95}px ${fontFamily}`
                ctx.fillStyle = '#7A5545'
                ctx.fillText(text, x + 12, y)
            } else {
                // 普通文本
                ctx.font = `${fontSize}px ${fontFamily}`
                ctx.fillStyle = textColor

                // 处理加粗文本
                const boldParts = text.split(/\*\*([^*]+)\*\*/g)
                let currentX = x
                for (let i = 0; i < boldParts.length; i++) {
                    if (i % 2 === 1) {
                        // 加粗部分
                        ctx.font = `600 ${fontSize}px ${fontFamily}`
                        ctx.fillStyle = '#C85520'
                    } else {
                        ctx.font = `${fontSize}px ${fontFamily}`
                        ctx.fillStyle = textColor
                    }
                    ctx.fillText(boldParts[i], currentX, y)
                    currentX += ctx.measureText(boldParts[i]).width
                }
            }

            y += line.height
        }

        // 绘制底部
        if (footerText) {
            const footerY = totalHeight - 15
            ctx.font = `${fontSize * 0.75}px ${fontFamily}`
            ctx.fillStyle = '#B09080'
            ctx.fillText(footerText, padding, footerY)

            const timestamp = new Date().toLocaleString('zh-CN')
            const timestampWidth = ctx.measureText(timestamp).width
            ctx.fillStyle = '#C0A090'
            ctx.fillText(timestamp, width - padding - timestampWidth, footerY)
        }

        return canvas.toBuffer('image/png')
    }

    /**
     * 解析 Markdown 为简单行数组（用于 Canvas 渲染）
     * @param {string} markdown
     * @returns {string[]}
     */
    parseMarkdownToLines(markdown) {
        if (!markdown) return []
        const clean = this.cleanMarkdown(markdown)
        return clean.split('\n').filter(line => {
            // 过滤掉分隔线
            if (/^[-=*]{3,}$/.test(line.trim())) return false
            return true
        })
    }

    /**
     * 清理Markdown内容（移除代码块标记等）
     * @param {string} text
     * @returns {string}
     */
    cleanMarkdown(text) {
        if (!text) return ''
        let clean = text.trim()
        // 移除开头的 ```markdown 或 ``` 标记
        clean = clean.replace(/^```(?:markdown|md)?\s*\n?/i, '')
        // 移除结尾的 ``` 标记
        clean = clean.replace(/\n?```\s*$/i, '')
        // 移除无法渲染的 Emoji 字符（保留基本标点和中文）
        clean = clean.replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // 常见 Emoji
        clean = clean.replace(/[\u{2600}-\u{26FF}]/gu, '') // 杂项符号
        clean = clean.replace(/[\u{2700}-\u{27BF}]/gu, '') // 装饰符号
        clean = clean.replace(/[\u{1F600}-\u{1F64F}]/gu, '') // 表情符号
        clean = clean.replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // 交通和地图符号
        clean = clean.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // 国旗
        return clean.trim()
    }

    /**
     * 保护数学公式，避免被Markdown解析器处理
     * @param {string} text
     * @returns {{ text: string, expressions: string[] }}
     */
    protectMathExpressions(text) {
        const expressions = []
        // 保护块级公式 $$...$$
        let protected_ = text.replace(/\$\$([\s\S]+?)\$\$/g, match => {
            expressions.push(match)
            return `MATHBLOCK${expressions.length - 1}END`
        })
        // 保护行内公式 $...$
        protected_ = protected_.replace(/\$([^$\n]+?)\$/g, match => {
            expressions.push(match)
            return `MATHINLINE${expressions.length - 1}END`
        })
        return { text: protected_, expressions }
    }

    /**
     * 恢复数学公式
     * @param {string} html
     * @param {string[]} expressions
     * @returns {string}
     */
    restoreMathExpressions(html, expressions) {
        let restored = html
        expressions.forEach((expr, index) => {
            restored = restored.replace(`MATHBLOCK${index}END`, expr)
            restored = restored.replace(`MATHINLINE${index}END`, expr)
        })
        return restored
    }

    /**
     * 获取主题样式
     * @param {string} theme - 'light' | 'dark' | 'auto'
     * @returns {string}
     */
    getThemeStyles(theme = 'light') {
        const themes = {
            light: {
                bg: '#f7f7f7',
                containerBg: '#ffffff',
                text: '#333333',
                heading: '#1a1a1a',
                accent: '#0056b3',
                border: 'rgba(0,0,0,0.1)',
                codeBg: '#f4f4f4'
            },
            dark: {
                bg: '#1a1a2e',
                containerBg: '#16213e',
                text: '#e4e4e4',
                heading: '#ffffff',
                accent: '#4da6ff',
                border: 'rgba(255,255,255,0.1)',
                codeBg: '#0f0f23'
            }
        }
        const t = themes[theme] || themes.light
        return `
            body { 
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; 
                padding: 20px; 
                background-color: ${t.bg}; 
                color: ${t.text};
                margin: 0;
            }
            h1, h2, h3, h4 { color: ${t.heading}; margin-top: 1.5em; margin-bottom: 0.5em; }
            h1 { font-size: 1.8em; border-bottom: 2px solid ${t.accent}; padding-bottom: 0.3em; }
            h2 { font-size: 1.4em; }
            h3 { font-size: 1.2em; }
            ul, ol { padding-left: 1.5em; }
            li { margin-bottom: 0.5em; line-height: 1.6; }
            strong { color: ${t.accent}; }
            p { line-height: 1.8; margin: 0.8em 0; }
            code { 
                background: ${t.codeBg}; 
                padding: 0.2em 0.4em; 
                border-radius: 4px; 
                font-size: 0.9em;
            }
            pre { 
                background: ${t.codeBg}; 
                padding: 1em; 
                border-radius: 8px; 
                overflow-x: auto;
            }
            blockquote {
                border-left: 4px solid ${t.accent};
                margin: 1em 0;
                padding: 0.5em 1em;
                background: ${t.codeBg};
                border-radius: 0 8px 8px 0;
            }
            hr { 
                border: none; 
                border-top: 1px solid ${t.border}; 
                margin: 1.5em 0;
            }
            .container { 
                max-width: 800px; 
                margin: auto; 
                background: ${t.containerBg}; 
                padding: 30px; 
                border-radius: 12px; 
                box-shadow: 0 4px 20px ${t.border};
            }
            .header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 20px;
            }
            .header-icon {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: linear-gradient(135deg, ${t.accent}, #6366f1);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-size: 24px;
            }
            .timestamp {
                color: ${t.text};
                opacity: 0.6;
                font-size: 0.85em;
                margin-top: 20px;
                text-align: right;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin: 1em 0;
            }
            th, td {
                border: 1px solid ${t.border};
                padding: 0.6em 1em;
                text-align: left;
            }
            th {
                background: ${t.codeBg};
            }
        `
    }

    /**
     * 渲染Markdown为图片
     * @param {Object} options
     * @param {string} options.markdown - Markdown内容
     * @param {string} options.title - 标题
     * @param {string} options.subtitle - 副标题
     * @param {string} options.icon - 图标emoji
     * @param {string} options.theme - 主题 'light' | 'dark'
     * @param {number} options.width - 视口宽度
     * @param {boolean} options.showTimestamp - 是否显示时间戳
     * @returns {Promise<Buffer>} 图片Buffer
     */
    async renderMarkdownToImage(options) {
        const {
            markdown,
            title = '',
            subtitle = '',
            icon = '📊',
            theme = 'light',
            width = 800,
            showTimestamp = true
        } = options

        const cleanedMd = this.cleanMarkdown(markdown)

        // 保护数学公式
        const { text: protectedMd, expressions } = this.protectMathExpressions(cleanedMd)
        let html = marked(protectedMd)
        // 恢复数学公式
        html = this.restoreMathExpressions(html, expressions)

        const styles = this.getThemeStyles(theme)
        const timestamp = new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })

        // 检测是否包含数学公式
        const hasMath = expressions.length > 0

        // KaTeX 样式优化 - 高亮显示
        const katexStyles = `
            /* 行内公式样式 */
            .katex {
                font-size: 1.15em !important;
                color: #1a5276;
                background: linear-gradient(135deg, rgba(52,152,219,0.08) 0%, rgba(155,89,182,0.08) 100%);
                padding: 0.15em 0.4em;
                border-radius: 4px;
                border: 1px solid rgba(52,152,219,0.2);
            }
            /* 块级公式样式 */
            .katex-display {
                margin: 1em 0 !important;
                padding: 0.8em 1em;
                background: linear-gradient(135deg, #f8f9fa 0%, #e8f4fc 100%);
                border-radius: 8px;
                border-left: 4px solid #3498db;
                overflow-x: auto;
                overflow-y: hidden;
                text-align: center;
            }
            .katex-display > .katex {
                background: none;
                border: none;
                padding: 0;
                font-size: 1.25em !important;
                color: #2c3e50;
            }
            /* 公式内元素颜色 */
            .katex .mord.text { color: #27ae60; }
            .katex .mbin { color: #e74c3c; }
            .katex .mrel { color: #9b59b6; }
        `

        const styledHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                ${hasMath ? `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">` : ''}
                <style>
                    ${styles}
                    ${hasMath ? katexStyles : ''}
                </style>
            </head>
            <body>
                <div class="container">
                    ${
                        title
                            ? `
                    <div class="header">
                        <div class="header-icon">${icon}</div>
                        <div>
                            <h1 style="margin: 0; border: none; padding: 0;">${title}</h1>
                            ${subtitle ? `<p style="margin: 0.3em 0 0 0; opacity: 0.7; font-size: 0.9em;">${subtitle}</p>` : ''}
                        </div>
                    </div>
                    <hr>
                    `
                            : ''
                    }
                    ${html}
                    ${showTimestamp ? `<div class="timestamp">生成时间：${timestamp}</div>` : ''}
                </div>
                ${
                    hasMath
                        ? `
                <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
                <script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
                <script>
                    document.addEventListener("DOMContentLoaded", function() {
                        renderMathInElement(document.body, {
                            delimiters: [
                                {left: '$$', right: '$$', display: true},
                                {left: '$', right: '$', display: false},
                                {left: '\\\\[', right: '\\\\]', display: true},
                                {left: '\\\\(', right: '\\\\)', display: false}
                            ],
                            throwOnError: false,
                            trust: true
                        });
                        window.katexRendered = true;
                    });
                </script>
                `
                        : ''
                }
            </body>
            </html>
        `

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width, height: 600, deviceScaleFactor: 2 })
            await page.setContent(styledHtml, { waitUntil: 'networkidle0', timeout: 30000 })

            // 等待 KaTeX 渲染完成
            if (hasMath) {
                try {
                    await page.waitForFunction(() => window.katexRendered === true, { timeout: 5000 })
                } catch {
                    // 超时继续
                }
                await new Promise(r => setTimeout(r, 200))
            }

            const imageBuffer = await page.screenshot({ fullPage: true, timeout: 30000 })
            await page.close()
            return imageBuffer
        } catch (error) {
            logService.error('[RenderService] 渲染图片失败', error)
            throw error
        }
    }

    /**
     * @param {string} markdown - 总结内容
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderGroupSummary(markdown, options = {}) {
        const {
            title = '群聊内容总结',
            subtitle = '',
            messageCount = 0,
            participantCount = 0,
            topUsers = [],
            hourlyActivity = [],
            theme = 'light',
            width = 520,
            fastMode = true // 优先使用Canvas快速渲染
        } = options

        // 快速模式：使用 Canvas 渲染（无头像、无图表，但速度快10倍+）
        if (fastMode && this.useCanvas && topUsers.length === 0 && hourlyActivity.every(v => v === 0)) {
            try {
                const lines = this.parseMarkdownToLines(markdown)
                const statsLine = `📊 消息数: ${messageCount}  |  👥 参与者: ${participantCount}`
                return await this.renderWithCanvas({
                    lines: [statsLine, '', ...lines],
                    width,
                    title: `📊 ${title}`,
                    subtitle: subtitle || `基于 ${messageCount} 条消息`,
                    headerBg: true,
                    headerHeight: 60,
                    footerText: '✨ AI 智能生成',
                    bgColor: '#FFFCFA',
                    titleColor: '#B85520',
                    accentColor: '#FFB080'
                })
            } catch (e) {
                logService.warn('[RenderService] Canvas渲染失败，回退到Puppeteer:', e.message)
            }
        }

        const cleanedMd = this.cleanMarkdown(markdown)
        const { text: protectedMd, expressions } = this.protectMathExpressions(cleanedMd)
        let html = marked(protectedMd)
        html = this.restoreMathExpressions(html, expressions)

        const now = new Date()
        const dateStr = now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
        const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        const activityData = hourlyActivity.length === 24 ? hourlyActivity : Array(24).fill(0)
        const maxActivity = Math.max(...activityData, 1)
        const activityBars = activityData
            .map((v, i) => {
                const height = maxActivity > 0 ? Math.max(4, Math.round((v / maxActivity) * 60)) : 4
                const emptyClass = v === 0 ? ' empty' : ''
                return `<div class="bar${emptyClass}" style="height:${height}px"></div>`
            })
            .join('')
        const userCardsHtml =
            topUsers.length > 0
                ? topUsers
                      .map((u, i) => {
                          const gradients = [
                              'linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%)',
                              'linear-gradient(135deg, #4ECDC4 0%, #6EE7DF 100%)',
                              'linear-gradient(135deg, #A78BFA 0%, #C4B5FD 100%)',
                              'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
                              'linear-gradient(135deg, #10B981 0%, #34D399 100%)'
                          ]
                          const bgGradient = gradients[i % gradients.length]
                          const initial = (u.name || '?').charAt(0).toUpperCase()
                          const rankBadge = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`
                          // 使用真实头像URL，如果没有则显示首字母
                          const avatarContent = u.avatar
                              ? `<img src="${u.avatar}" class="avatar-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
                              : ''
                          const fallbackContent = `<div class="avatar-fallback" style="background:${bgGradient};display:${u.avatar ? 'none' : 'flex'}">${initial}</div>`
                          return `
                <div class="user-card">
                    <div class="user-rank">${rankBadge}</div>
                    <div class="user-avatar">
                        ${avatarContent}
                        ${fallbackContent}
                    </div>
                    <div class="user-name">${u.name || '用户'}</div>
                    <div class="user-count">${u.count} 条</div>
                </div>`
                      })
                      .join('')
                : ''

        const beautifulHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "WenQuanYi Micro Hei", sans-serif, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji";
            background: linear-gradient(135deg, #fdf6f0 0%, #f8f0ea 50%, #fff5f0 100%);
            min-height: 100vh;
            padding: 16px;
            -webkit-font-smoothing: antialiased;
        }
        .container {
            max-width: ${width}px;
            margin: 0 auto;
            background: linear-gradient(180deg, #ffffff 0%, #fffcfa 100%);
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 4px 24px rgba(180, 120, 80, 0.08), 0 1px 3px rgba(180, 120, 80, 0.05);
            border: 1px solid rgba(255, 200, 160, 0.2);
        }
        /* 顶部头部 - 现代渐变 */
        .header {
            background: linear-gradient(135deg, #ff9a56 0%, #ff7b4d 50%, #ff6b3d 100%);
            padding: 28px 24px 24px;
            position: relative;
            overflow: hidden;
        }
        .header::before {
            content: '';
            position: absolute;
            top: -50%;
            right: -20%;
            width: 200px;
            height: 200px;
            background: radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%);
            border-radius: 50%;
        }
        .header::after {
            content: '';
            position: absolute;
            bottom: -30%;
            left: -10%;
            width: 150px;
            height: 150px;
            background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%);
            border-radius: 50%;
        }
        .header-main {
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: relative;
            z-index: 1;
        }
        .header-left { flex: 1; }
        .header-title {
            font-size: 20px;
            font-weight: 800;
            color: #fff;
            margin-bottom: 6px;
            line-height: 1.3;
            text-shadow: 0 2px 4px rgba(180, 80, 20, 0.2);
            letter-spacing: 0.5px;
        }
        .header-desc {
            font-size: 12px;
            color: rgba(255,255,255,0.85);
            font-weight: 500;
        }
        .header-right {
            text-align: right;
            background: rgba(255,255,255,0.2);
            backdrop-filter: blur(10px);
            padding: 12px 16px;
            border-radius: 16px;
            border: 1px solid rgba(255,255,255,0.25);
        }
        .header-date {
            font-size: 11px;
            color: rgba(255,255,255,0.9);
            margin-bottom: 2px;
        }
        .header-time {
            font-size: 24px;
            font-weight: 800;
            color: #fff;
            text-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        /* 统计卡片 */
        .stats-row {
            display: flex;
            justify-content: center;
            gap: 12px;
            padding: 20px 24px;
            background: linear-gradient(180deg, #fff9f5 0%, #fffbf8 100%);
            margin-top: -12px;
            position: relative;
            z-index: 2;
        }
        .stat-card {
            flex: 1;
            text-align: center;
            background: linear-gradient(135deg, #ffffff 0%, #fff8f4 100%);
            padding: 16px 12px;
            border-radius: 16px;
            box-shadow: 0 2px 12px rgba(255, 150, 100, 0.1);
            border: 1px solid rgba(255, 180, 140, 0.15);
            transition: transform 0.2s ease;
        }
        .stat-card:hover { transform: translateY(-2px); }
        .stat-icon {
            font-size: 20px;
            margin-bottom: 6px;
        }
        .stat-num {
            font-size: 22px;
            font-weight: 800;
            background: linear-gradient(135deg, #ff7b4d 0%, #ff9a56 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .stat-txt {
            font-size: 11px;
            color: #a08070;
            margin-top: 4px;
            font-weight: 500;
        }
        /* 活动图表 */
        .chart-section {
            padding: 20px 24px;
            background: #fffbf8;
        }
        .chart-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
        }
        .chart-icon {
            width: 28px;
            height: 28px;
            background: linear-gradient(135deg, #ffb080 0%, #ff9060 100%);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        }
        .chart-title {
            font-size: 13px;
            font-weight: 600;
            color: #c06030;
        }
        .chart-container {
            background: linear-gradient(180deg, #fff 0%, #fff8f4 100%);
            border-radius: 16px;
            padding: 16px;
            border: 1px solid rgba(255, 180, 140, 0.12);
        }
        .chart-bars {
            display: flex;
            align-items: flex-end;
            gap: 3px;
            height: 70px;
            padding: 0 4px;
        }
        .bar {
            flex: 1;
            min-width: 10px;
            border-radius: 4px 4px 0 0;
            background: linear-gradient(180deg, #ffb347 0%, #ffd080 100%);
            box-shadow: 0 -2px 4px rgba(255, 180, 100, 0.2);
            transition: all 0.3s ease;
        }
        .bar:hover { transform: scaleY(1.05); filter: brightness(1.05); }
        .bar.empty { background: linear-gradient(180deg, #ffe8d8 0%, #fff0e8 100%); box-shadow: none; }
        .chart-labels {
            display: flex;
            justify-content: space-between;
            margin-top: 10px;
            padding: 0 4px;
        }
        .chart-labels span {
            font-size: 10px;
            color: #b0a090;
            font-weight: 500;
        }
        /* 活跃用户 */
        .users-section {
            padding: 20px 24px;
            background: linear-gradient(180deg, #fff9f5 0%, #fffbf8 100%);
        }
        .users-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 16px;
        }
        .users-icon {
            width: 28px;
            height: 28px;
            background: linear-gradient(135deg, #ff8c60 0%, #ff7040 100%);
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
        }
        .users-title {
            font-size: 13px;
            font-weight: 600;
            color: #c06030;
        }
        .users-grid {
            display: flex;
            justify-content: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .user-card {
            width: 80px;
            display: flex;
            flex-direction: column;
            align-items: center;
            background: linear-gradient(180deg, #ffffff 0%, #fff8f4 100%);
            padding: 14px 10px 12px;
            border-radius: 16px;
            box-shadow: 0 3px 12px rgba(200, 120, 80, 0.08);
            border: 1px solid rgba(255, 180, 140, 0.12);
            position: relative;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        .user-card:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 20px rgba(200, 120, 80, 0.12);
        }
        .user-rank {
            position: absolute;
            top: -8px;
            right: -4px;
            font-size: 16px;
            filter: drop-shadow(0 2px 2px rgba(0,0,0,0.1));
        }
        .user-avatar {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            margin-bottom: 8px;
            box-shadow: 0 3px 10px rgba(0,0,0,0.12);
            overflow: hidden;
            position: relative;
            border: 3px solid #fff;
        }
        .user-card:first-child .user-avatar {
            border-color: #ffd700;
            box-shadow: 0 3px 12px rgba(255, 200, 0, 0.3);
        }
        .user-card:nth-child(2) .user-avatar {
            border-color: #c0c0c0;
        }
        .user-card:nth-child(3) .user-avatar {
            border-color: #cd7f32;
        }
        .user-avatar .avatar-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 50%;
        }
        .user-avatar .avatar-fallback {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #FFF;
            font-size: 18px;
            font-weight: 700;
        }
        .user-name {
            font-size: 11px;
            font-weight: 600;
            color: #504030;
            max-width: 70px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-align: center;
            margin-bottom: 4px;
        }
        .user-count {
            font-size: 10px;
            color: #ff7b4d;
            background: linear-gradient(135deg, #fff5f0 0%, #ffe8e0 100%);
            padding: 3px 8px;
            border-radius: 10px;
            font-weight: 600;
        }
        /* 内容区 */
        .content {
            padding: 24px;
        }
        .content h1, .content h2 {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 15px;
            font-weight: 700;
            color: #c04510;
            margin: 24px 0 14px 0;
            padding: 12px 16px;
            background: linear-gradient(135deg, #fff5f0 0%, #ffebe0 100%);
            border-radius: 12px;
            border-left: 4px solid;
            border-image: linear-gradient(180deg, #ff8c42, #ffb080) 1;
            letter-spacing: 0.3px;
        }
        .content h1:first-child, .content h2:first-child { margin-top: 0; }
        .content h3 {
            font-size: 14px;
            font-weight: 700;
            color: #d05820;
            margin: 18px 0 10px 0;
            padding-left: 14px;
            border-left: 3px solid #ffb080;
            position: relative;
        }
        .content h3::before {
            content: '';
            position: absolute;
            left: 0;
            top: -2px;
            bottom: -2px;
            width: 3px;
            background: linear-gradient(180deg, #ff8c42 0%, #ffb080 100%);
            border-radius: 2px;
        }
        .content h4 {
            font-size: 13px;
            font-weight: 600;
            color: #e06830;
            margin: 14px 0 8px 0;
        }
        .content p {
            font-size: 13px;
            color: #4a4035;
            line-height: 1.9;
            margin: 12px 0;
            text-align: justify;
        }
        .content ul, .content ol {
            padding-left: 8px;
            margin: 12px 0;
        }
        .content ul { list-style-type: none; }
        .content ul li {
            position: relative;
            padding-left: 20px;
            margin: 10px 0;
        }
        .content ul li::before {
            content: '';
            position: absolute;
            left: 4px;
            top: 8px;
            width: 6px;
            height: 6px;
            background: linear-gradient(135deg, #ff9060 0%, #ffb080 100%);
            border-radius: 50%;
        }
        .content ol { 
            list-style-type: none;
            counter-reset: item;
        }
        .content ol li {
            counter-increment: item;
            position: relative;
            padding-left: 28px;
            margin: 10px 0;
        }
        .content ol li::before {
            content: counter(item);
            position: absolute;
            left: 0;
            top: 0;
            width: 20px;
            height: 20px;
            background: linear-gradient(135deg, #ff9060 0%, #ffb080 100%);
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .content li {
            font-size: 13px;
            color: #4a4035;
            line-height: 1.85;
        }
        .content strong {
            color: #d04510;
            font-weight: 700;
            background: linear-gradient(180deg, transparent 55%, rgba(255, 160, 100, 0.25) 55%);
            padding: 0 3px;
            border-radius: 2px;
        }
        .content em {
            color: #c06030;
            font-style: italic;
        }
        .content blockquote {
            background: linear-gradient(135deg, #fff8f2 0%, #ffefe6 100%);
            border-left: 4px solid;
            border-image: linear-gradient(180deg, #ff9060, #ffb080) 1;
            padding: 14px 18px 14px 20px;
            margin: 16px 0;
            border-radius: 0 14px 14px 0;
            font-size: 12.5px;
            color: #6a5545;
            box-shadow: 0 2px 10px rgba(255, 144, 96, 0.08);
            position: relative;
        }
        .content blockquote::before {
            content: '"';
            position: absolute;
            top: 8px;
            left: 10px;
            font-size: 28px;
            color: #ffb080;
            opacity: 0.4;
            font-family: Georgia, serif;
            line-height: 1;
        }
        .content code {
            background: linear-gradient(135deg, #fff5ed 0%, #ffe8dc 100%);
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 12px;
            color: #c04510;
            font-family: "SF Mono", Monaco, "Cascadia Code", Consolas, monospace;
            border: 1px solid rgba(255, 140, 66, 0.15);
        }
        .content pre {
            background: linear-gradient(135deg, #2d2d3a 0%, #1f1f2a 100%);
            padding: 16px 18px;
            border-radius: 12px;
            margin: 14px 0;
            overflow-x: auto;
            border: 1px solid rgba(100, 100, 120, 0.2);
        }
        .content pre code {
            background: none;
            border: none;
            padding: 0;
            font-size: 12px;
            color: #e8e8f0;
        }
        .content hr {
            border: none;
            height: 1px;
            background: linear-gradient(90deg, transparent 0%, #ffd0b0 20%, #ffb080 50%, #ffd0b0 80%, transparent 100%);
            margin: 20px 0;
        }
        .content a {
            color: #e05020;
            text-decoration: none;
            border-bottom: 1px dashed #ffb080;
            transition: all 0.2s ease;
        }
        .content a:hover { border-bottom-style: solid; }
        .content table {
            width: 100%;
            border-collapse: collapse;
            margin: 14px 0;
            font-size: 12.5px;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: 0 2px 12px rgba(200, 100, 50, 0.06);
        }
        .content th {
            background: linear-gradient(135deg, #ffe8dc 0%, #ffd8c8 100%);
            color: #a05020;
            font-weight: 700;
            padding: 12px 14px;
            text-align: left;
        }
        .content td {
            padding: 10px 14px;
            border-bottom: 1px solid #fff0e8;
            color: #5a4a40;
        }
        .content tr:last-child td { border-bottom: none; }
        .content tr:nth-child(even) { background: #fffaf6; }
        /* 底部 */
        .footer {
            padding: 16px 24px;
            background: linear-gradient(135deg, #fff8f4 0%, #fffaf6 50%, #fff5f0 100%);
            border-top: 1px solid rgba(255, 180, 140, 0.12);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .footer-left {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 11px;
            color: #b09080;
            font-weight: 500;
        }
        .footer-left::before {
            content: '✨';
            font-size: 12px;
        }
        .footer-right {
            font-size: 11px;
            color: #c0a090;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-main">
                <div class="header-left">
                    <div class="header-title">${title}</div>
                    <div class="header-desc">${subtitle || '基于最近群聊消息的智能分析'}</div>
                </div>
                <div class="header-right">
                    <div class="header-date">${dateStr}</div>
                    <div class="header-time">${timeStr}</div>
                </div>
            </div>
        </div>
        <div class="stats-row">
            <div class="stat-card">
                <div class="stat-icon">💬</div>
                <div class="stat-num">${messageCount || '-'}</div>
                <div class="stat-txt">消息总数</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">👥</div>
                <div class="stat-num">${participantCount || '-'}</div>
                <div class="stat-txt">参与成员</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">⚡</div>
                <div class="stat-num">${messageCount && participantCount ? Math.round(messageCount / participantCount) : '-'}</div>
                <div class="stat-txt">人均发言</div>
            </div>
        </div>
        <div class="chart-section">
            <div class="chart-header">
                <div class="chart-icon">📊</div>
                <div class="chart-title">24小时活跃分布</div>
            </div>
            <div class="chart-container">
                <div class="chart-bars">${activityBars}</div>
                <div class="chart-labels">
                    <span>0:00</span>
                    <span>6:00</span>
                    <span>12:00</span>
                    <span>18:00</span>
                    <span>24:00</span>
                </div>
            </div>
        </div>
        ${
            userCardsHtml
                ? `
        <div class="users-section">
            <div class="users-header">
                <div class="users-icon">🏆</div>
                <div class="users-title">活跃排行 TOP${topUsers.length}</div>
            </div>
            <div class="users-grid">${userCardsHtml}</div>
        </div>`
                : ''
        }
        <div class="content">
            ${html}
        </div>
        <div class="footer">
            <div class="footer-left">AI 智能分析生成</div>
            <div class="footer-right">${now.toLocaleString('zh-CN')}</div>
        </div>
    </div>
</body>
</html>`

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width: width + 30, height: 800, deviceScaleFactor: 2 })
            await page.setContent(beautifulHtml, { waitUntil: 'networkidle0', timeout: 30000 })
            // 等待头像图片加载完成
            if (topUsers.some(u => u.avatar)) {
                try {
                    await page.waitForSelector('.avatar-img', { timeout: 5000 })
                    await new Promise(r => setTimeout(r, 500))
                } catch (e) {}
            }
            const imageBuffer = await page.screenshot({ fullPage: true, timeout: 30000 })
            await page.close()
            return imageBuffer
        } catch (error) {
            logService.error('[RenderService] 渲染群聊总结失败', error)
            throw error
        }
    }

    /**
     * 渲染群聊总结 - 深色现代风格
     * @param {string} markdown - 总结内容
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderGroupSummaryModern(markdown, options = {}) {
        const {
            title = '今日群聊',
            subtitle = '',
            messageCount = 0,
            participantCount = 0,
            topUsers = [],
            hourlyActivity = [],
            width = 520,
            topics = [],
            keywords = [],
            interactions = [],
            atmosphere = {},
            quotes = []
        } = options

        const cleanedMd = this.cleanMarkdown(markdown)
        const { text: protectedMd, expressions } = this.protectMathExpressions(cleanedMd)
        let html = marked(protectedMd)
        html = this.restoreMathExpressions(html, expressions)

        const beautifulHtml = generateModernSummaryHtml({
            title,
            subtitle,
            html,
            messageCount,
            participantCount,
            topUsers,
            hourlyActivity,
            width,
            topics,
            keywords,
            interactions,
            atmosphere,
            quotes
        })

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width: width + 30, height: 800, deviceScaleFactor: 2 })
            await page.setContent(beautifulHtml, { waitUntil: 'networkidle0', timeout: 30000 })
            if (topUsers.some(u => u.avatar)) {
                try {
                    await page.waitForSelector('.avatar-img', { timeout: 5000 })
                    await new Promise(r => setTimeout(r, 500))
                } catch (e) {}
            }
            const imageBuffer = await page.screenshot({ fullPage: true, timeout: 30000 })
            await page.close()
            return imageBuffer
        } catch (error) {
            logService.error('[RenderService] 渲染深色风格群聊总结失败', error)
            throw error
        }
    }

    /**
     * 渲染用户画像 - 美化版本
     * @param {string} markdown - 画像内容
     * @param {string} nickname - 用户昵称
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderUserProfile(markdown, nickname, options = {}) {
        const { messageCount = 0, width = 480, userId = null, fastMode = true } = options

        // 快速模式：使用 Canvas 渲染（无头像，但速度快10倍+）
        if (fastMode && this.useCanvas) {
            try {
                const lines = this.parseMarkdownToLines(markdown)
                const statsLine = `📈 发言数: ${messageCount}  |  📅 ${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
                return await this.renderWithCanvas({
                    lines: [statsLine, '', ...lines],
                    width,
                    title: `👤 ${nickname || '用户'}`,
                    subtitle: '用户画像分析',
                    headerBg: true,
                    headerHeight: 60,
                    footerText: '✨ AI 智能生成',
                    bgColor: '#FAFCFF',
                    textColor: '#3A3A4A',
                    titleColor: '#4A5690',
                    accentColor: '#8B9FE8'
                })
            } catch (e) {
                logService.warn('[RenderService] Canvas渲染失败，回退到Puppeteer:', e.message)
            }
        }

        const cleanedMd = this.cleanMarkdown(markdown)
        const { text: protectedMd, expressions } = this.protectMathExpressions(cleanedMd)
        let html = marked(protectedMd)
        html = this.restoreMathExpressions(html, expressions)

        const now = new Date()
        const dateStr = now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
        const initial = (nickname || '?').charAt(0).toUpperCase()
        // 生成真实头像URL
        const avatarUrl = userId ? `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=0` : null

        const profileHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Noto Sans CJK SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "WenQuanYi Micro Hei", sans-serif, "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji";
            background: linear-gradient(180deg, #E8F4FD 0%, #F0F7FF 100%);
            min-height: 100vh;
            padding: 15px;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            text-rendering: optimizeLegibility;
        }
        .container {
            max-width: ${width}px;
            margin: 0 auto;
            background: #FAFCFF;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 12px rgba(100, 150, 200, 0.12);
            border: 1px solid rgba(150, 180, 220, 0.2);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 24px 20px;
            text-align: center;
            position: relative;
        }
        .header::before {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
            opacity: 0.3;
        }
        .avatar {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: linear-gradient(135deg, #fff 0%, #f0f0f0 100%);
            margin: 0 auto 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            position: relative;
            z-index: 1;
            overflow: hidden;
        }
        .avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            border-radius: 50%;
        }
        .avatar img[data-failed="true"] {
            display: none !important;
        }
        .avatar-fallback {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            font-weight: 700;
            color: #667eea;
            background: linear-gradient(135deg, #f0f4ff 0%, #e8eeff 100%);
            border-radius: 50%;
        }
        .avatar-fallback.show {
            display: flex !important;
        }
        .nickname {
            font-size: 18px;
            font-weight: 700;
            color: #FFF;
            margin-bottom: 4px;
            position: relative;
            z-index: 1;
        }
        .subtitle {
            font-size: 11px;
            color: rgba(255,255,255,0.8);
            position: relative;
            z-index: 1;
        }
        .stats-bar {
            display: flex;
            justify-content: center;
            gap: 30px;
            padding: 14px 20px;
            background: #F5F8FF;
            border-bottom: 1px solid rgba(150,180,220,0.15);
        }
        .stat-item { text-align: center; }
        .stat-value {
            font-size: 16px;
            font-weight: 700;
            color: #667eea;
        }
        .stat-label {
            font-size: 10px;
            color: #8090A0;
            margin-top: 2px;
        }
        .content {
            padding: 18px 20px;
        }
        .content h1, .content h2 {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            font-weight: 600;
            color: #4A5690;
            margin: 18px 0 12px 0;
            padding-bottom: 8px;
            border-bottom: 2px solid transparent;
            background: linear-gradient(90deg, #E8EDFF, transparent) border-box;
            border-image: linear-gradient(90deg, #8B9FE8, transparent) 1;
            letter-spacing: 0.5px;
        }
        .content h1::before, .content h2::before {
            content: '';
            width: 4px;
            height: 16px;
            background: linear-gradient(180deg, #667eea, #8B9FE8);
            border-radius: 2px;
            flex-shrink: 0;
        }
        .content h1:first-child, .content h2:first-child { margin-top: 0; }
        .content h3 {
            font-size: 13px;
            font-weight: 600;
            color: #5A6AA0;
            margin: 14px 0 8px 0;
            padding-left: 10px;
            border-left: 3px solid #8B9FE8;
        }
        .content h4 {
            font-size: 12px;
            font-weight: 600;
            color: #6A7AB0;
            margin: 12px 0 6px 0;
        }
        .content p {
            font-size: 12.5px;
            color: #3A3A4A;
            line-height: 1.85;
            margin: 10px 0;
            text-align: justify;
            letter-spacing: 0.3px;
        }
        .content ul, .content ol {
            padding-left: 20px;
            margin: 10px 0;
        }
        .content ul { list-style-type: none; }
        .content ul li::before {
            content: '◆';
            color: #8B9FE8;
            font-size: 8px;
            margin-right: 8px;
            vertical-align: middle;
        }
        .content ol { list-style-type: decimal; }
        .content ol li::marker {
            color: #667eea;
            font-weight: 600;
        }
        .content li {
            font-size: 12.5px;
            color: #3A3A4A;
            line-height: 1.85;
            margin: 6px 0;
            padding-left: 2px;
        }
        .content strong {
            color: #5A6ACA;
            font-weight: 600;
            background: linear-gradient(180deg, transparent 60%, rgba(139,159,232,0.25) 60%);
            padding: 0 2px;
        }
        .content em {
            color: #6A7AB0;
            font-style: italic;
        }
        .content blockquote {
            background: linear-gradient(135deg, #F5F7FF 0%, #EEF2FF 100%);
            border-left: 4px solid #667eea;
            padding: 12px 16px;
            margin: 14px 0;
            border-radius: 0 10px 10px 0;
            font-size: 12px;
            color: #5A6AA0;
            box-shadow: 0 2px 8px rgba(102,126,234,0.1);
            position: relative;
        }
        .content blockquote::before {
            content: '"';
            position: absolute;
            top: 6px;
            left: 8px;
            font-size: 24px;
            color: #8B9FE8;
            opacity: 0.5;
            font-family: Georgia, serif;
        }
        .content code {
            background: linear-gradient(135deg, #F0F4FF 0%, #E8EDFF 100%);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            color: #5A6ACA;
            font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
            border: 1px solid rgba(102,126,234,0.2);
        }
        .content pre {
            background: linear-gradient(135deg, #F5F7FF 0%, #EEF2FF 100%);
            padding: 14px 16px;
            border-radius: 8px;
            margin: 12px 0;
            overflow-x: auto;
            border: 1px solid rgba(102,126,234,0.15);
        }
        .content pre code {
            background: none;
            border: none;
            padding: 0;
            font-size: 11px;
        }
        .content hr {
            border: none;
            height: 2px;
            background: linear-gradient(90deg, transparent, #C0D0F0, #8B9FE8, #C0D0F0, transparent);
            margin: 18px 0;
            border-radius: 1px;
        }
        .content a {
            color: #667eea;
            text-decoration: none;
            border-bottom: 1px dashed #8B9FE8;
            transition: all 0.2s ease;
        }
        .content table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
            font-size: 12px;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(102,126,234,0.08);
        }
        .content th {
            background: linear-gradient(135deg, #E8EDFF 0%, #D8E0FF 100%);
            color: #4A5690;
            font-weight: 600;
            padding: 10px 12px;
            text-align: left;
        }
        .content td {
            padding: 8px 12px;
            border-bottom: 1px solid #EEF2FF;
            color: #4A4A5A;
        }
        .content tr:last-child td { border-bottom: none; }
        .content tr:nth-child(even) { background: #FAFBFF; }
        .footer {
            padding: 12px 20px;
            background: #F5F8FF;
            border-top: 1px solid rgba(150,180,220,0.15);
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #8090A0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="avatar">${avatarUrl ? `<img src="${avatarUrl}" onerror="this.setAttribute('data-failed','true');this.nextElementSibling.classList.add('show')"><div class="avatar-fallback">${initial}</div>` : `<div class="avatar-fallback show">${initial}</div>`}</div>
            <div class="nickname">${nickname || '用户'}</div>
            <div class="subtitle">👤 用户画像分析</div>
        </div>
        <div class="stats-bar">
            <div class="stat-item">
                <div class="stat-value">${messageCount || '-'}</div>
                <div class="stat-label">发言数</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">📊</div>
                <div class="stat-label">AI分析</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">📅</div>
                <div class="stat-label">${dateStr}</div>
            </div>
        </div>
        <div class="content">
            ${html}
        </div>
        <div class="footer">
            <span>✨ AI 智能生成</span>
            <span>${now.toLocaleString('zh-CN')}</span>
        </div>
    </div>
</body>
</html>`

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width: width + 30, height: 800, deviceScaleFactor: 2 })
            await page.setContent(profileHtml, { waitUntil: 'networkidle0', timeout: 30000 })
            // 等待头像图片加载完成
            if (avatarUrl) {
                try {
                    await page.waitForSelector('.avatar img', { timeout: 5000 })
                    await new Promise(r => setTimeout(r, 500))
                } catch (e) {
                    // 图片加载超时，继续使用降级显示
                }
            }
            const imageBuffer = await page.screenshot({ fullPage: true, timeout: 30000 })
            await page.close()
            return imageBuffer
        } catch (error) {
            logService.error('[RenderService] 渲染用户画像失败', error)
            throw error
        }
    }

    /**
     * 渲染分析报告
     * @param {string} markdown - 报告内容
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderAnalysisReport(markdown, options = {}) {
        return this.renderMarkdownToImage({
            markdown,
            title: options.title || '分析报告',
            subtitle: options.subtitle || '',
            icon: options.icon || '📈',
            theme: options.theme || 'light',
            ...options
        })
    }

    /**
     * 渲染记忆列表
     * @param {Array} memories - 记忆数组
     * @param {string} nickname - 用户昵称
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderMemoryList(memories, nickname, options = {}) {
        const markdown = memories.map((m, i) => `${i + 1}. ${m}`).join('\n')
        return this.renderMarkdownToImage({
            markdown,
            title: '记忆列表',
            subtitle: nickname,
            icon: '🧠',
            theme: options.theme || 'light',
            ...options
        })
    }

    /**
     * 渲染词云图片 - 使用优化的螺旋布局算法，按权重从中心向外排列
     * @param {Array<{word: string, weight: number}>} words - 词频数组
     * @param {Object} options - 选项
     * @param {string} options.title - 标题
     * @param {string} options.subtitle - 副标题
     * @param {number} options.width - 宽度
     * @param {number} options.height - 高度
     * @returns {Promise<Buffer>}
     */
    async renderWordCloud(words, options = {}) {
        const { title = '今日词云', subtitle = '', width = 800, height = 600 } = options

        if (!words || words.length === 0) {
            throw new Error('没有足够的词汇生成词云')
        }

        // 限制词数，避免太多词导致布局缓慢
        const maxWords = Math.min(words.length, 120)

        // 归一化权重并按权重降序排序（大的在前，放中间）
        const maxWeight = Math.max(...words.map(w => w.weight))
        const minWeight = Math.min(...words.map(w => w.weight))
        const weightRange = maxWeight - minWeight || 1

        const normalizedWords = words
            .slice(0, maxWords)
            .map(w => {
                // 使用对数缩放让大小差异更明显
                const normalizedWeight = (w.weight - minWeight) / weightRange
                const logScale = Math.log10(normalizedWeight * 9 + 1) // 0~1 映射到 log(1)~log(10)
                return {
                    ...w,
                    size: Math.round(20 + logScale * 56) // 20~76px
                }
            })
            .sort((a, b) => b.size - a.size)

        // 更丰富的彩色调色板（按权重分组配色）
        const highWeightColors = ['#E74C3C', '#9B59B6', '#3498DB', '#1ABC9C', '#F39C12']
        const midWeightColors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#DDA0DD', '#F7DC6F']
        const lowWeightColors = ['#85C1E9', '#A9DFBF', '#F5B7B1', '#D7BDE2', '#AED6F1', '#FADBD8']

        const timestamp = new Date().toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })

        // 词云区域尺寸
        const cloudWidth = width - 48
        const cloudHeight = height - 160

        const wordCloudHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        padding: 20px;
                    }
                    .container {
                        background: rgba(255, 255, 255, 0.95);
                        border-radius: 16px;
                        padding: 20px;
                        box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 12px;
                        padding-bottom: 12px;
                        border-bottom: 2px solid #eee;
                    }
                    .header h1 {
                        font-size: 24px;
                        color: #333;
                        margin-bottom: 4px;
                    }
                    .header .subtitle {
                        font-size: 13px;
                        color: #666;
                    }
                    .word-cloud {
                        width: ${cloudWidth}px;
                        height: ${cloudHeight}px;
                        position: relative;
                        margin: 0 auto;
                        overflow: hidden;
                    }
                    .word {
                        position: absolute;
                        white-space: nowrap;
                        cursor: default;
                        text-shadow: 1px 1px 2px rgba(0,0,0,0.08);
                        line-height: 1.1;
                    }
                    .footer {
                        text-align: center;
                        padding-top: 10px;
                        border-top: 1px solid #eee;
                        margin-top: 10px;
                    }
                    .footer .credit {
                        font-size: 11px;
                        color: #999;
                    }
                    .footer .timestamp {
                        font-size: 10px;
                        color: #bbb;
                        margin-top: 2px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        <h1>☁️ ${title}</h1>
                        ${subtitle ? `<div class="subtitle">${subtitle}</div>` : ''}
                    </div>
                    <div class="word-cloud" id="wordCloud"></div>
                    <div class="footer">
                        <div class="credit">Created By Yunzai-Bot and ChatAI-Plugin</div>
                        <div class="timestamp">生成时间：${timestamp}</div>
                    </div>
                </div>
                <script>
                    const highColors = ${JSON.stringify(highWeightColors)};
                    const midColors = ${JSON.stringify(midWeightColors)};
                    const lowColors = ${JSON.stringify(lowWeightColors)};
                    
                    // 词云数据
                    const words = ${JSON.stringify(
                        normalizedWords.map((w, i, arr) => {
                            // 根据排名选择颜色组
                            const rank = i / arr.length
                            let colorPool, colorIdx
                            if (rank < 0.15) {
                                colorPool = 'high'
                                colorIdx = i % highWeightColors.length
                            } else if (rank < 0.5) {
                                colorPool = 'mid'
                                colorIdx = (i - Math.floor(arr.length * 0.15)) % midWeightColors.length
                            } else {
                                colorPool = 'low'
                                colorIdx = (i - Math.floor(arr.length * 0.5)) % lowWeightColors.length
                            }
                            return {
                                word: w.word,
                                size: w.size,
                                colorPool,
                                colorIdx
                            }
                        })
                    )};
                    
                    const container = document.getElementById('wordCloud');
                    const containerWidth = ${cloudWidth};
                    const containerHeight = ${cloudHeight};
                    const centerX = containerWidth / 2;
                    const centerY = containerHeight / 2;
                    
                    // 已放置的词的边界框
                    const placedBoxes = [];
                    
                    // 检测碰撞（带padding）
                    function checkCollision(box, padding = 4) {
                        const expandedBox = {
                            left: box.left - padding,
                            top: box.top - padding,
                            right: box.right + padding,
                            bottom: box.bottom + padding
                        };
                        for (const placed of placedBoxes) {
                            if (!(expandedBox.right < placed.left || 
                                  expandedBox.left > placed.right || 
                                  expandedBox.bottom < placed.top || 
                                  expandedBox.top > placed.bottom)) {
                                return true;
                            }
                        }
                        return false;
                    }
                    
                    // 检查是否在边界内
                    function isInBounds(box, margin = 5) {
                        return box.left >= margin && 
                               box.right <= containerWidth - margin &&
                               box.top >= margin && 
                               box.bottom <= containerHeight - margin;
                    }
                    
                    // 阿基米德螺旋布局算法（优化版）
                    function spiralPlace(wordEl, fontSize) {
                        const wordWidth = wordEl.offsetWidth;
                        const wordHeight = wordEl.offsetHeight;
                        
                        // 从中心开始，使用阿基米德螺旋
                        const a = 0;  // 起始半径
                        const b = 3;  // 螺旋扩展速度
                        const maxAngle = 50 * Math.PI; // 最大旋转角度
                        const angleStep = fontSize > 50 ? 0.15 : fontSize > 35 ? 0.2 : 0.25;
                        
                        for (let angle = 0; angle < maxAngle; angle += angleStep) {
                            const radius = a + b * angle;
                            const x = centerX + radius * Math.cos(angle) - wordWidth / 2;
                            const y = centerY + radius * Math.sin(angle) - wordHeight / 2;
                            
                            const box = {
                                left: x,
                                top: y,
                                right: x + wordWidth,
                                bottom: y + wordHeight
                            };
                            
                            if (isInBounds(box) && !checkCollision(box)) {
                                wordEl.style.left = x + 'px';
                                wordEl.style.top = y + 'px';
                                placedBoxes.push(box);
                                return true;
                            }
                        }
                        return false;
                    }
                    
                    // 放置所有词（按大小降序，大词优先占据中心位置）
                    let placedCount = 0;
                    words.forEach((w, index) => {
                        const span = document.createElement('span');
                        span.className = 'word';
                        span.textContent = w.word;
                        span.style.fontSize = w.size + 'px';
                        
                        // 根据颜色池选择颜色
                        const colorPools = { high: highColors, mid: midColors, low: lowColors };
                        span.style.color = colorPools[w.colorPool][w.colorIdx];
                        
                        // 大词加粗
                        span.style.fontWeight = w.size > 50 ? 'bold' : w.size > 35 ? '600' : 'normal';
                        span.style.opacity = '0';
                        
                        container.appendChild(span);
                        
                        if (spiralPlace(span, w.size)) {
                            span.style.opacity = '1';
                            placedCount++;
                        } else {
                            span.remove();
                        }
                    });
                    
                    console.log('词云已放置 ' + placedCount + '/' + words.length + ' 个词');
                </script>
            </body>
            </html>
        `

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width, height, deviceScaleFactor: 2 })
            await page.setContent(wordCloudHtml, { waitUntil: 'networkidle0', timeout: 30000 })
            // 等待词云布局完成
            await page
                .waitForFunction(
                    () => {
                        const words = document.querySelectorAll('.word')
                        return words.length > 0 && Array.from(words).some(w => w.style.opacity === '1')
                    },
                    { timeout: 8000 }
                )
                .catch(() => {})
            const imageBuffer = await page.screenshot({ fullPage: true, timeout: 30000 })
            await page.close()
            return imageBuffer
        } catch (error) {
            logService.error('[RenderService] 渲染词云失败', error)
            throw error
        }
    }
    /**
     * 渲染插件帮助图片 - 三列网格布局
     * @param {Object} options - 渲染选项
     * @param {Array<{category: string, icon: string, commands: Array<{cmd: string, desc: string, icon?: string}>}>} options.commands - 命令分类列表
     * @param {string} options.title - 标题
     * @param {string} options.subtitle - 副标题
     * @param {string} options.footer - 底部文字
     * @param {number} options.width - 宽度
     * @returns {Promise<Buffer>}
     */
    async renderHelpImage(options = {}) {
        const {
            commands = [],
            title = 'ChatAI Plugin',
            subtitle = 'Yunzai-Bot AI助手',
            footer = 'Created by ChatAI-Plugin',
            width = 540
        } = options

        // 分类颜色配置
        const categoryColors = [
            { bg: 'linear-gradient(135deg, #FFE4E1 0%, #FFB6C1 100%)', border: '#FFB6C1', title: '#C44569' },
            { bg: 'linear-gradient(135deg, #E8F5E9 0%, #A5D6A7 100%)', border: '#A5D6A7', title: '#2E7D32' },
            { bg: 'linear-gradient(135deg, #E3F2FD 0%, #90CAF9 100%)', border: '#90CAF9', title: '#1565C0' },
            { bg: 'linear-gradient(135deg, #FFF3E0 0%, #FFCC80 100%)', border: '#FFCC80', title: '#E65100' },
            { bg: 'linear-gradient(135deg, #F3E5F5 0%, #CE93D8 100%)', border: '#CE93D8', title: '#7B1FA2' },
            { bg: 'linear-gradient(135deg, #E0F7FA 0%, #80DEEA 100%)', border: '#80DEEA', title: '#00838F' },
            { bg: 'linear-gradient(135deg, #FFFDE7 0%, #FFF59D 100%)', border: '#FFF59D', title: '#F57F17' },
            { bg: 'linear-gradient(135deg, #FCE4EC 0%, #F48FB1 100%)', border: '#F48FB1', title: '#C2185B' },
            { bg: 'linear-gradient(135deg, #E8EAF6 0%, #9FA8DA 100%)', border: '#9FA8DA', title: '#303F9F' }
        ]

        // 生成命令列表HTML - 三列网格布局
        const commandsHtml = commands
            .map((cat, catIdx) => {
                const color = categoryColors[catIdx % categoryColors.length]
                const cmdList = cat.commands
                    .map(cmd => {
                        const icon = cmd.icon || '📌'
                        return `<div class="cmd-card">
                    <div class="cmd-icon">${icon}</div>
                    <div class="cmd-info">
                        <div class="cmd-name">${cmd.cmd}</div>
                        <div class="cmd-desc">${cmd.desc}</div>
                    </div>
                </div>`
                    })
                    .join('')
                return `
                <div class="category" style="--cat-bg: ${color.bg}; --cat-border: ${color.border}; --cat-title: ${color.title};">
                    <div class="category-header">
                        <span class="category-icon">${cat.icon}</span>
                        <span class="category-title">${cat.category}</span>
                    </div>
                    <div class="cmd-grid">${cmdList}</div>
                </div>`
            })
            .join('')

        const helpHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif;
            background: linear-gradient(180deg, #fce4ec 0%, #f8bbd9 50%, #f48fb1 100%);
            min-height: 100vh;
            padding: 12px;
            -webkit-font-smoothing: antialiased;
        }
        .container {
            max-width: ${width}px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.92);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            position: relative;
        }
        .bg-decor {
            position: absolute;
            top: 0;
            right: 0;
            width: 45%;
            height: 100%;
            background: linear-gradient(180deg, rgba(255,182,193,0.15) 0%, rgba(255,182,193,0.05) 100%);
            pointer-events: none;
            z-index: 0;
        }
        .header {
            background: linear-gradient(135deg, rgba(255,182,193,0.3) 0%, rgba(255,218,225,0.5) 100%);
            padding: 16px 20px;
            position: relative;
            z-index: 1;
            border-bottom: 1px solid rgba(255,182,193,0.3);
        }
        .header-title {
            font-size: 20px;
            font-weight: 700;
            color: #C44569;
            margin-bottom: 2px;
        }
        .header-subtitle {
            font-size: 11px;
            color: #888;
        }
        .content {
            padding: 10px 12px;
            position: relative;
            z-index: 1;
        }
        .category {
            margin-bottom: 10px;
            background: var(--cat-bg);
            border-radius: 10px;
            overflow: hidden;
            border: 1px solid var(--cat-border);
        }
        .category-header {
            padding: 8px 12px;
            display: flex;
            align-items: center;
            gap: 6px;
            border-bottom: 1px solid rgba(0,0,0,0.05);
        }
        .category-icon {
            font-size: 14px;
        }
        .category-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--cat-title);
        }
        .cmd-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            padding: 8px;
        }
        .cmd-card {
            background: rgba(255,255,255,0.85);
            border-radius: 6px;
            padding: 8px;
            display: flex;
            align-items: flex-start;
            gap: 6px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .cmd-icon {
            font-size: 12px;
            flex-shrink: 0;
            width: 18px;
            height: 18px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .cmd-info {
            flex: 1;
            min-width: 0;
        }
        .cmd-name {
            font-size: 10px;
            font-weight: 600;
            color: #333;
            line-height: 1.3;
            word-break: break-all;
        }
        .cmd-desc {
            font-size: 9px;
            color: #666;
            line-height: 1.3;
            margin-top: 2px;
        }
        .footer {
            padding: 10px 16px;
            text-align: center;
            position: relative;
            z-index: 1;
            border-top: 1px solid rgba(255,182,193,0.3);
        }
        .footer-text {
            font-size: 10px;
            color: #999;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="bg-decor"></div>
        <div class="header">
            <div class="header-title">${title}</div>
            <div class="header-subtitle">${subtitle}</div>
        </div>
        <div class="content">
            ${commandsHtml}
        </div>
        <div class="footer">
            <div class="footer-text">${footer}</div>
        </div>
    </div>
</body>
</html>`

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width: width + 24, height: 800, deviceScaleFactor: 2 })
            await page.setContent(helpHtml, { waitUntil: 'networkidle0', timeout: 30000 })
            const imageBuffer = await page.screenshot({ fullPage: true, timeout: 30000 })
            await page.close()
            return imageBuffer
        } catch (error) {
            logService.error('[RenderService] 渲染帮助图片失败', error)
            throw error
        }
    }
}

export const renderService = new RenderService()
