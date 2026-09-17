import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { logService } from '../stats/LogService.js'
import { renderMarkdownToCanvas, unwrapMarkdownFence } from './canvasRenderer.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 插件根目录
const PLUGIN_ROOT = path.join(__dirname, '../../../')

let canvasModule = null
try {
    canvasModule = await import('@napi-rs/canvas')
} catch (e) {
    logService.debug('[RenderService] 可选画布模块不可用:', e?.message)
}

/**
 * Markdown渲染服务 - 将Markdown转换为图片
 * 支持群聊总结、用户画像、分析报告等场景
 */
class RenderService {
    constructor() {
        this.defaultTheme = 'light'
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
        // 已有定界符的 LaTeX 直接交给解析器，避免自动转换再次包裹并破坏公式。
        if (/\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/.test(text)) return text

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
    async loadFonts() {
        if (!canvasModule || this.fontLoaded) return
        try {
            const { GlobalFonts } = canvasModule
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
     * 文本自动换行辅助方法
     * @param {CanvasRenderingContext2D} ctx - Canvas上下文
     * @param {string} text - 文本内容
     * @param {number} maxWidth - 最大宽度
     * @returns {string[]} 换行后的文本行数组
     */
    wrapText(ctx, text, maxWidth) {
        if (!text) return ['']
        const words = []
        let current = ''
        for (const char of text) {
            if (/[\s]/.test(char) && current) {
                words.push(current)
                current = ''
                if (char !== ' ') words.push(char)
            } else {
                current += char
                if (ctx.measureText(current).width > maxWidth * 0.9) {
                    words.push(current)
                    current = ''
                }
            }
        }
        if (current) words.push(current)

        const lines = []
        let line = ''
        for (const word of words) {
            if (ctx.measureText(word).width > maxWidth) {
                if (line) {
                    lines.push(line)
                    line = ''
                }
                let chunk = ''
                for (const ch of word) {
                    if (ctx.measureText(chunk + ch).width > maxWidth) {
                        if (chunk) lines.push(chunk)
                        chunk = ch
                    } else {
                        chunk += ch
                    }
                }
                line = chunk
            } else {
                const testLine = line ? line + word : word
                if (ctx.measureText(testLine).width > maxWidth) {
                    if (line) lines.push(line)
                    line = word
                } else {
                    line = testLine
                }
            }
        }
        if (line) lines.push(line)
        return lines.length > 0 ? lines : ['']
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

        // 预计算每行高度（创建临时canvas用于文本测量）
        const measureCanvas = createCanvas(1, 1)
        const measureCtx = measureCanvas.getContext('2d')
        const textMaxWidth = width - padding * 2 - 24

        const parsedLines = lines.map(line => {
            const isTitle = line.startsWith('# ') || line.startsWith('## ')
            const isSubtitle = line.startsWith('### ')
            const isList = line.startsWith('- ') || line.startsWith('• ') || /^\d+\.\s/.test(line)
            const isQuote = line.startsWith('> ')
            const isEmpty = !line.trim()

            let singleLineHeight = lineHeightPx
            if (isTitle) singleLineHeight = fontSize * 1.8 * lineHeight
            else if (isSubtitle) singleLineHeight = fontSize * 1.4 * lineHeight
            else if (isEmpty) singleLineHeight = lineHeightPx * 0.5

            let wrapCount = 1
            if (!isEmpty) {
                let cleanText = line
                if (isTitle) cleanText = line.replace(/^#{1,2}\s*/, '')
                else if (isSubtitle) cleanText = line.replace(/^###\s*/, '')
                else if (isList) cleanText = line.replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, '')
                else if (isQuote) cleanText = line.replace(/^>\s*/, '')

                const fontSizePx = isTitle ? fontSize * 1.3 : isSubtitle ? fontSize * 1.1 : fontSize
                measureCtx.font = `${isTitle || isSubtitle ? '600 ' : ''}${fontSizePx}px ${fontFamily}`
                const wrappedLines = this.wrapText(measureCtx, cleanText, textMaxWidth)
                wrapCount = wrappedLines.length
            }

            const height = singleLineHeight * wrapCount

            return { text: line, height, isTitle, isSubtitle, isList, isQuote, isEmpty }
        })

        totalHeight += parsedLines.reduce((sum, l) => sum + l.height, 0)
        totalHeight += 40 // footer
        totalHeight = Math.ceil(totalHeight * 1.05) + 20

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
                // 列表项（支持自动换行）
                text = text.replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, '')
                ctx.font = `${fontSize}px ${fontFamily}`

                // 绘制列表标记
                ctx.fillStyle = accentColor
                ctx.fillText('◆', x + 4, y)
                x += 20

                ctx.fillStyle = textColor
                const listWrapped = this.wrapText(ctx, text, width - padding * 2 - 20)
                for (let wIdx = 0; wIdx < listWrapped.length; wIdx++) {
                    ctx.fillText(listWrapped[wIdx], x, y)
                    if (wIdx < listWrapped.length - 1) y += lineHeightPx
                }
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
                // 普通文本（支持自动换行）
                ctx.font = `${fontSize}px ${fontFamily}`
                ctx.fillStyle = textColor

                const wrappedLines = this.wrapText(ctx, text, width - padding * 2)
                for (let wIdx = 0; wIdx < wrappedLines.length; wIdx++) {
                    const wLine = wrappedLines[wIdx]
                    const boldParts = wLine.split(/\*\*([^*]+)\*\*/g)
                    let currentX = x
                    for (let i = 0; i < boldParts.length; i++) {
                        if (i % 2 === 1) {
                            ctx.font = `600 ${fontSize}px ${fontFamily}`
                            ctx.fillStyle = '#C85520'
                        } else {
                            ctx.font = `${fontSize}px ${fontFamily}`
                            ctx.fillStyle = textColor
                        }
                        ctx.fillText(boldParts[i], currentX, y)
                        currentX += ctx.measureText(boldParts[i]).width
                    }
                    if (wIdx < wrappedLines.length - 1) y += lineHeightPx
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
     * @param {Object} [options]
     * @param {boolean} [options.stripEmoji=true] - 是否移除Emoji（Canvas需要移除，Puppeteer/浏览器保留）
     * @returns {string}
     */
    cleanMarkdown(text, { stripEmoji = true } = {}) {
        if (!text) return ''
        let clean = unwrapMarkdownFence(text)
        if (stripEmoji) {
            // Canvas 无法渲染 Emoji，需要移除
            clean = clean.replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // 常见 Emoji
            clean = clean.replace(/[\u{2600}-\u{26FF}]/gu, '') // 杂项符号
            clean = clean.replace(/[\u{2700}-\u{27BF}]/gu, '') // 装饰符号
            clean = clean.replace(/[\u{1F600}-\u{1F64F}]/gu, '') // 表情符号
            clean = clean.replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // 交通和地图符号
            clean = clean.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // 国旗
        }
        return clean
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

        // 纯 Canvas 渲染（mathjax SVG 光栅化公式），不再使用 Puppeteer
        if (!this.useCanvas) {
            throw new Error('Canvas 模块未加载，无法渲染图片')
        }
        await this.loadFonts()
        return renderMarkdownToCanvas(this.cleanMarkdown(markdown, { stripEmoji: false }), {
            canvasModule,
            theme,
            width,
            title: title && icon && !title.startsWith(`${icon} `) ? `${icon} ${title}` : title,
            subtitle,
            showTimestamp,
            fontFamily: 'LXGW, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif'
        })
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
            width = 520,
            _fastMode = true // 保留参数兼容；渲染已统一走 Canvas
        } = options

        if (!this.useCanvas) {
            throw new Error('Canvas 模块未加载，无法渲染图片')
        }

        // 24 小时活跃柱状（纯文本可读版）
        const activityData = hourlyActivity.length === 24 ? hourlyActivity : Array(24).fill(0)
        const activityMax = Math.max(...activityData, 1)
        const activityChart = activityData
            .map((v, i) => {
                const bar = '█'.repeat(Math.max(1, Math.round((v / activityMax) * 10)))
                return `${String(i).padStart(2, '0')}时 ${v > 0 ? bar + ' ' + v : '·'}`
            })
            .join('\n')

        // 活跃排行（无头像卡片，首字符 + 条数）
        const userLines =
            topUsers.length > 0
                ? topUsers
                      .map((u, i) => {
                          const badge = ['👑', '🥈', '🥉'][i] || `#${i + 1}`
                          return `${badge} ${u.name || '用户'}：${u.count} 条`
                      })
                      .join('\n\n')
                : ''

        const md = [
            '### 📊 统计',
            `消息数: ${messageCount}  |  参与者: ${participantCount}`,
            '',
            '### 📈 24小时活跃',
            '```',
            activityChart,
            '```',
            ...(userLines ? ['', '### 🏆 活跃排行', userLines] : []),
            '',
            markdown
        ].join('\n')

        return this.renderMarkdownToImage({
            markdown: md,
            title: `📊 ${title}`,
            subtitle: subtitle || `基于 ${messageCount} 条消息`,
            icon: '📊',
            theme: 'light',
            width,
            showTimestamp: true
        })
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
            _topUsers = [],
            _hourlyActivity = [],
            width = 520,
            topics = [],
            keywords = [],
            _interactions = [],
            _atmosphere = {},
            quotes = []
        } = options

        if (!this.useCanvas) {
            throw new Error('Canvas 模块未加载，无法渲染图片')
        }

        const md = [
            `消息数: ${messageCount}  |  参与者: ${participantCount}`,
            keywords && keywords.length > 0 ? `🏷️ 关键词：${keywords.join(' · ')}` : '',
            topics && topics.length > 0 ? `📌 话题：${topics.join(' · ')}` : '',
            quotes && quotes.length > 0 ? `💬 金句：${quotes.join(' · ')}` : '',
            '',
            markdown
        ].join('\n\n')

        return this.renderMarkdownToImage({
            markdown: md,
            title: `🌙 ${title}`,
            subtitle: subtitle,
            icon: '🌙',
            theme: 'dark',
            width,
            showTimestamp: true
        })
    }

    /**
     * 渲染用户画像 - 美化版本
     * @param {string} markdown - 画像内容
     * @param {string} nickname - 用户昵称
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderUserProfile(markdown, nickname, options = {}) {
        const { messageCount = 0, width = 480, _fastMode = true } = options

        if (!this.useCanvas) {
            throw new Error('Canvas 模块未加载，无法渲染图片')
        }

        const statsLine = `📈 发言数: ${messageCount}  |  📅 ${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`
        const md = `${statsLine}\n\n${markdown}`

        return this.renderMarkdownToImage({
            markdown: md,
            title: `👤 ${nickname || '用户'}`,
            subtitle: '用户画像分析',
            icon: '👤',
            theme: 'light',
            width,
            showTimestamp: true
        })
    }

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
        if (!this.useCanvas) {
            throw new Error('Canvas 模块未加载，无法渲染图片')
        }
        await this.loadFonts()

        // 归一化权重并排序
        const maxWords = Math.min(words.length, 120)
        const maxWeight = Math.max(...words.map(w => w.weight))
        const minWeight = Math.min(...words.map(w => w.weight))
        const weightRange = maxWeight - minWeight || 1
        const normalizedWords = words
            .slice(0, maxWords)
            .map(w => {
                const normalizedWeight = (w.weight - minWeight) / weightRange
                const logScale = Math.log10(normalizedWeight * 9 + 1)
                return { ...w, size: Math.round(20 + logScale * 56) }
            })
            .sort((a, b) => b.size - a.size)

        const colors = ['#E74C3C', '#9B59B6', '#3498DB', '#1ABC9C', '#F39C12', '#2ECC71', '#E67E22', '#16A085']

        const { createCanvas } = canvasModule
        const canvas = createCanvas(width, height)
        const ctx = canvas.getContext('2d')

        // 背景
        ctx.fillStyle = '#f7f7f7'
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(8, 8, width - 16, height - 16)

        // 标题
        ctx.fillStyle = '#1a1a1a'
        ctx.font = `600 26px LXGW, "Noto Sans SC", sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(title, width / 2, 48)
        if (subtitle) {
            ctx.fillStyle = '#888'
            ctx.font = `14px LXGW, "Noto Sans SC", sans-serif`
            ctx.fillText(subtitle, width / 2, 70)
        }
        ctx.textAlign = 'left'

        // 简单两行式布局：按权重画多行（类似柱状但保留字词）
        // 第一行大字，其余按行排布
        let y = 100
        ctx.textBaseline = 'middle'
        const usableWidth = width - 30
        let x = 0
        for (const w of normalizedWords) {
            ctx.font = `${w.size}px LXGW, "Noto Sans SC", sans-serif`
            const textW = ctx.measureText(w.word).width + 12
            if (x + textW > usableWidth) {
                x = 0
                y += 50
                if (y > height - 40) break
            }
            ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)]
            const angle = Math.random() < 0.08 ? (Math.random() < 0.5 ? -0.4 : 0.4) : 0
            if (angle) {
                ctx.save()
                ctx.translate(x + textW / 2, y)
                ctx.rotate(angle)
                ctx.fillText(w.word, -textW / 2, 0)
                ctx.restore()
            } else {
                ctx.fillText(w.word, x, y)
            }
            x += textW
        }
        ctx.textBaseline = 'alphabetic'

        return canvas.toBuffer('image/png')
    }

    async renderHelpImage(options = {}) {
        const {
            commands = [],
            title = 'ChatAI Plugin',
            subtitle = 'Yunzai-Bot AI助手',
            footer = 'Created by ChatAI-Plugin',
            width = 540
        } = options

        const md = [
            '# ' + title,
            subtitle ? `> ${subtitle}` : '',
            '',
            ...commands.flatMap(cat => {
                const items = (cat.commands || []).map(cmd => `${cmd.icon || '📌'} **${cmd.cmd}** - ${cmd.desc || ''}`)
                return [`## ${cat.icon || ''} ${cat.category || ''}`, ...items, '']
            }),
            footer ? `---\n${footer}` : ''
        ].join('\n')

        return this.renderMarkdownToImage({
            markdown: md,
            title,
            subtitle: '',
            icon: '❓',
            theme: 'light',
            width,
            showTimestamp: false
        })
    }
}

export const renderService = new RenderService()
