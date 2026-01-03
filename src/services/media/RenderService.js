import puppeteer from 'puppeteer'
import { marked } from 'marked'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { logService } from '../stats/LogService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Markdown渲染服务 - 将Markdown转换为图片
 * 支持群聊总结、用户画像、分析报告等场景
 */
class RenderService {
    constructor() {
        this.browser = null
        this.defaultTheme = 'light'
        this.templateDir = path.join(__dirname, '../../resources/templates')
        
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
            mathCommands: /\\(frac|sqrt|sum|int|prod|lim|sin|cos|tan|log|ln|exp|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|infty|partial|nabla|cdot|times|div|pm|mp|leq|geq|neq|approx|equiv|subset|supset|cap|cup|in|notin|forall|exists|rightarrow|leftarrow|Rightarrow|Leftarrow|vec|hat|bar|dot|ddot|matrix|bmatrix|pmatrix|cases)\b/,
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
            /\d{4}[-/]\d{1,2}[-/]\d{1,2}/g,  // 日期
            /\d{1,2}:\d{2}(:\d{2})?/g,        // 时间
            /v?\d+\.\d+(\.\d+)?/gi,           // 版本号
            /[¥$€£]\s*\d+/g,                  // 货币
            /\d+%/g,                           // 百分比
            /\d+\s*(个|条|篇|次|人|天|小时|分钟|秒)/g,  // 中文计数
        ]
        
        let cleanText = text
        for (const pattern of excludePatterns) {
            cleanText = cleanText.replace(pattern, ' ')
        }
        
        // 只检测明确的 LaTeX 语法
        const blockMatches = text.match(this.mathPatterns.blockLatex) || []
        if (blockMatches.length > 0) {
            // 验证块级公式内容确实包含数学元素
            const validBlocks = blockMatches.filter(m => 
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
        result = result.replace(/\^(\d+)/g, '^{$1}')       // x^2 -> x^{2}
        result = result.replace(/\^([a-zA-Z])(?![a-zA-Z{])/g, '^{$1}') // x^n -> x^{n}
        result = result.replace(/²/g, '^{2}')            // ² -> ^{2}
        result = result.replace(/³/g, '^{3}')            // ³ -> ^{3}

        result = result.replace(/_\{([^}]+)\}/g, '_{$1}')  // 保持已有格式
        result = result.replace(/_(\d+)/g, '_{$1}')        // x_1 -> x_{1}
        result = result.replace(/_([a-zA-Z])(?![a-zA-Z{])/g, '_{$1}') // x_n -> x_{n}
        // Unicode下标
        result = result.replace(/[₀-₉]/g, m => `_{${m.charCodeAt(0) - 0x2080}}`)
        const greekMap = {
            'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta',
            'ε': '\\epsilon', 'θ': '\\theta', 'λ': '\\lambda', 'μ': '\\mu',
            'π': '\\pi', 'σ': '\\sigma', 'ω': '\\omega', 'ξ': '\\xi',
            'η': '\\eta', 'ζ': '\\zeta', '∞': '\\infty'
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
        result = result.replace(/\\(cdot|times|to|pm|approx|neq|leq|geq|in|partial|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|omega|xi|eta|zeta|infty)([a-zA-Z])/g, '\\$1 $2')
        const mathPattern = /\\[a-zA-Z]+|\^{|_{/
        if (!mathPattern.test(result)) return result
        
        // 按行处理
        return result.split('\n').map(line => {
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
        }).join('\n')
    }

    /**
     * 渲染包含数学公式的文本为图片
     * @param {string} text - 包含数学公式的文本
     * @param {Object} options - 渲染选项
     * @returns {Promise<Buffer>} 图片Buffer
     */
    async renderMathContent(text, options = {}) {
        const {
            theme = 'light',
            width = 800,
            showTimestamp = false,
            title = ''
        } = options
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
                logger.warn('[RenderService] 关闭浏览器失败:', e.message)
            }
            this.browser = null
        }
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
                    ${title ? `
                    <div class="header">
                        <div class="header-icon">${icon}</div>
                        <div>
                            <h1 style="margin: 0; border: none; padding: 0;">${title}</h1>
                            ${subtitle ? `<p style="margin: 0.3em 0 0 0; opacity: 0.7; font-size: 0.9em;">${subtitle}</p>` : ''}
                        </div>
                    </div>
                    <hr>
                    ` : ''}
                    ${html}
                    ${showTimestamp ? `<div class="timestamp">生成时间：${timestamp}</div>` : ''}
                </div>
                ${hasMath ? `
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
                ` : ''}
            </body>
            </html>
        `

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width, height: 600 })
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
            width = 520
        } = options

        const cleanedMd = this.cleanMarkdown(markdown)
        const { text: protectedMd, expressions } = this.protectMathExpressions(cleanedMd)
        let html = marked(protectedMd)
        html = this.restoreMathExpressions(html, expressions)
        
        const now = new Date()
        const dateStr = now.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
        const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        const activityData = hourlyActivity.length === 24 ? hourlyActivity : Array(24).fill(0)
        const maxActivity = Math.max(...activityData, 1)
        const activityBars = activityData.map((v, i) => {
            const height = maxActivity > 0 ? Math.max(2, Math.round((v / maxActivity) * 50)) : 2
            const color = v > 0 ? '#FFB347' : '#FFE8D8'
            return `<div class="bar" style="height:${height}px;background:${color}"></div>`
        }).join('')
        const userCardsHtml = topUsers.length > 0 ? topUsers.map((u, i) => {
            const gradients = [
                'linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%)',
                'linear-gradient(135deg, #4ECDC4 0%, #6EE7DF 100%)',
                'linear-gradient(135deg, #A78BFA 0%, #C4B5FD 100%)',
                'linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)',
                'linear-gradient(135deg, #10B981 0%, #34D399 100%)'
            ]
            const bgGradient = gradients[i % gradients.length]
            const initial = (u.name || '?').charAt(0).toUpperCase()
            const rankBadge = i === 0 ? '👑' : (i === 1 ? '🥈' : (i === 2 ? '🥉' : `#${i+1}`))
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
        }).join('') : ''

        const beautifulHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
            background: linear-gradient(180deg, #FFF8F5 0%, #FFFAF8 100%);
            min-height: 100vh;
            padding: 15px;
        }
        .container {
            max-width: ${width}px;
            margin: 0 auto;
            background: #FFFCFA;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 2px 12px rgba(255, 180, 150, 0.12);
            border: 1px solid rgba(255, 210, 180, 0.25);
        }
        /* 顶部头部 - 渐变粉橙色 */
        .header {
            background: linear-gradient(135deg, #FFEEE6 0%, #FFE0D0 50%, #FFD4C0 100%);
            padding: 20px;
            position: relative;
            min-height: 100px;
        }
        .header-main {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }
        .header-left { flex: 1; }
        .header-title {
            font-size: 16px;
            font-weight: 700;
            color: #C75000;
            margin-bottom: 6px;
            line-height: 1.4;
        }
        .header-desc {
            font-size: 11px;
            color: #D07030;
        }
        .header-right {
            text-align: right;
            padding-left: 15px;
        }
        .header-date {
            font-size: 10px;
            color: #C08060;
        }
        .header-time {
            font-size: 20px;
            font-weight: 700;
            color: #D06020;
        }
        /* 统计栏 */
        .stats-row {
            display: flex;
            justify-content: center;
            gap: 30px;
            padding: 12px 20px;
            background: #FFF9F5;
            border-bottom: 1px solid rgba(255, 200, 170, 0.15);
        }
        .stat-box {
            text-align: center;
        }
        .stat-num {
            font-size: 18px;
            font-weight: 700;
            color: #E07020;
        }
        .stat-txt {
            font-size: 10px;
            color: #B08060;
            margin-top: 2px;
        }
        /* 活动图表 */
        .chart-section {
            padding: 15px 20px;
            background: #FFFBF8;
            border-bottom: 1px solid rgba(255, 200, 170, 0.15);
        }
        .chart-title {
            font-size: 11px;
            color: #A07050;
            margin-bottom: 10px;
        }
        .chart-bars {
            display: flex;
            align-items: flex-end;
            gap: 2px;
            height: 65px;
            padding: 0 5px;
        }
        .bar {
            flex: 1;
            min-width: 8px;
            border-radius: 2px 2px 0 0;
            transition: height 0.3s;
        }
        .chart-labels {
            display: flex;
            justify-content: space-between;
            margin-top: 5px;
            padding: 0 5px;
        }
        .chart-labels span {
            font-size: 9px;
            color: #B0A090;
        }
        /* 活跃用户区域 */
        .users-section {
            padding: 16px 20px;
            background: linear-gradient(180deg, #FFF9F5 0%, #FFFBF8 100%);
            border-bottom: 1px solid rgba(255, 200, 170, 0.15);
        }
        .users-title {
            font-size: 12px;
            font-weight: 600;
            color: #C06030;
            margin-bottom: 14px;
        }
        .users-grid {
            display: flex;
            justify-content: space-between;
            gap: 8px;
        }
        .user-card {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            background: #FFF;
            padding: 12px 8px;
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(200,150,100,0.08);
            border: 1px solid rgba(255,200,170,0.15);
            position: relative;
        }
        .user-rank {
            position: absolute;
            top: -6px;
            right: -4px;
            font-size: 14px;
        }
        .user-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin-bottom: 6px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
            overflow: hidden;
            position: relative;
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
            align-items: center;
            justify-content: center;
            color: #FFF;
            font-size: 16px;
            font-weight: 700;
        }
        .user-name {
            font-size: 10px;
            font-weight: 600;
            color: #605040;
            max-width: 70px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-align: center;
            margin-bottom: 2px;
        }
        .user-count {
            font-size: 9px;
            color: #A09080;
            background: #FFF5F0;
            padding: 2px 6px;
            border-radius: 8px;
        }
        /* 内容区 */
        .content {
            padding: 18px 20px;
        }
        .section {
            margin-bottom: 16px;
        }
        .section-header {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 10px;
        }
        .section-icon {
            font-size: 14px;
        }
        .section-title {
            font-size: 13px;
            font-weight: 600;
            color: #C06020;
        }
        .content h1, .content h2 {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            font-weight: 600;
            color: #C06020;
            margin: 16px 0 10px 0;
            padding-bottom: 6px;
            border-bottom: 1px dashed #FFE0D0;
        }
        .content h1:first-child, .content h2:first-child { margin-top: 0; }
        .content h3 {
            font-size: 12px;
            font-weight: 600;
            color: #D08040;
            margin: 12px 0 6px 0;
        }
        .content p {
            font-size: 12px;
            color: #605040;
            line-height: 1.7;
            margin: 8px 0;
        }
        .content ul, .content ol {
            padding-left: 16px;
            margin: 8px 0;
        }
        .content li {
            font-size: 12px;
            color: #605040;
            line-height: 1.7;
            margin: 4px 0;
        }
        .content strong {
            color: #D06020;
            font-weight: 600;
        }
        .content blockquote {
            background: #FFF5F0;
            border-left: 3px solid #FFB080;
            padding: 10px 12px;
            margin: 10px 0;
            border-radius: 0 8px 8px 0;
            font-size: 11px;
            color: #906050;
        }
        .content code {
            background: #FFF0E8;
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 11px;
            color: #C06030;
        }
        .content hr {
            border: none;
            height: 1px;
            background: linear-gradient(90deg, transparent, #FFE0D0, transparent);
            margin: 14px 0;
        }
        /* 底部 */
        .footer {
            padding: 12px 20px;
            background: linear-gradient(90deg, #FFF8F4 0%, #FFFAF6 100%);
            border-top: 1px solid rgba(255, 200, 170, 0.15);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .footer-left {
            font-size: 10px;
            color: #B09080;
        }
        .footer-right {
            font-size: 10px;
            color: #C0A090;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-main">
                <div class="header-left">
                    <div class="header-title">📊 ${title}</div>
                    <div class="header-desc">${subtitle || `基于 ${messageCount} 条消息`}</div>
                </div>
                <div class="header-right">
                    <div class="header-date">📅 ${dateStr}</div>
                    <div class="header-time">${timeStr}</div>
                </div>
            </div>
        </div>
        <div class="stats-row">
            <div class="stat-box">
                <div class="stat-num">${messageCount || '-'}</div>
                <div class="stat-txt">消息数</div>
            </div>
            <div class="stat-box">
                <div class="stat-num">${participantCount || '-'}</div>
                <div class="stat-txt">参与者</div>
            </div>
            <div class="stat-box">
                <div class="stat-num">🔥</div>
                <div class="stat-txt">活跃</div>
            </div>
        </div>
        <div class="chart-section">
            <div class="chart-title">📈 24小时活跃度</div>
            <div class="chart-bars">${activityBars}</div>
            <div class="chart-labels">
                <span>0时</span>
                <span>6时</span>
                <span>12时</span>
                <span>18时</span>
                <span>24时</span>
            </div>
        </div>
        ${userCardsHtml ? `
        <div class="users-section">
            <div class="users-title">👥 活跃成员 TOP${topUsers.length}</div>
            <div class="users-grid">${userCardsHtml}</div>
        </div>` : ''}
        <div class="content">
            ${html}
        </div>
        <div class="footer">
            <div class="footer-left">✨ AI 智能生成</div>
            <div class="footer-right">${now.toLocaleString('zh-CN')}</div>
        </div>
    </div>
</body>
</html>`

        let browser = null
        try {
            browser = await this.getBrowser()
            const page = await browser.newPage()
            await page.setViewport({ width: width + 30, height: 800 })
            await page.setContent(beautifulHtml, { waitUntil: 'networkidle0', timeout: 30000 })
            // 等待头像图片加载完成
            if (topUsers.some(u => u.avatar)) {
                try {
                    await page.waitForSelector('.avatar-img', { timeout: 5000 })
                    await new Promise(r => setTimeout(r, 500))
                } catch (e) {
                    // 图片加载超时，继续使用降级显示
                }
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
     * 渲染用户画像 - 美化版本
     * @param {string} markdown - 画像内容
     * @param {string} nickname - 用户昵称
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderUserProfile(markdown, nickname, options = {}) {
        const { messageCount = 0, width = 480, userId = null } = options
        
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
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
            background: linear-gradient(180deg, #E8F4FD 0%, #F0F7FF 100%);
            min-height: 100vh;
            padding: 15px;
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
            font-size: 13px;
            font-weight: 600;
            color: #5060A0;
            margin: 16px 0 10px 0;
            padding-bottom: 6px;
            border-bottom: 1px dashed #E0E8F0;
        }
        .content h1:first-child, .content h2:first-child { margin-top: 0; }
        .content h3 {
            font-size: 12px;
            font-weight: 600;
            color: #6070B0;
            margin: 12px 0 6px 0;
        }
        .content p {
            font-size: 12px;
            color: #505060;
            line-height: 1.7;
            margin: 8px 0;
        }
        .content ul, .content ol {
            padding-left: 16px;
            margin: 8px 0;
        }
        .content li {
            font-size: 12px;
            color: #505060;
            line-height: 1.7;
            margin: 4px 0;
        }
        .content strong { color: #667eea; font-weight: 600; }
        .content blockquote {
            background: #F0F4FF;
            border-left: 3px solid #667eea;
            padding: 10px 12px;
            margin: 10px 0;
            border-radius: 0 8px 8px 0;
            font-size: 11px;
            color: #6070A0;
        }
        .content code {
            background: #EEF2FF;
            padding: 1px 4px;
            border-radius: 3px;
            font-size: 11px;
            color: #667eea;
        }
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
            <div class="avatar">${avatarUrl ? `<img src="${avatarUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="avatar-fallback" style="display:none">${initial}</div>` : `<div class="avatar-fallback">${initial}</div>`}</div>
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
            await page.setViewport({ width: width + 30, height: 800 })
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
        const {
            title = '今日词云',
            subtitle = '',
            width = 800,
            height = 600
        } = options

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
                    const words = ${JSON.stringify(normalizedWords.map((w, i, arr) => {
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
                    }))};
                    
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
            await page.setViewport({ width, height })
            await page.setContent(wordCloudHtml, { waitUntil: 'networkidle0', timeout: 30000 })
            // 等待词云布局完成
            await page.waitForFunction(() => {
                const words = document.querySelectorAll('.word');
                return words.length > 0 && Array.from(words).some(w => w.style.opacity === '1');
            }, { timeout: 8000 }).catch(() => {})
            const imageBuffer = await page.screenshot({ fullPage: true, timeout: 30000 })
            await page.close()
            return imageBuffer
        } catch (error) {
            logService.error('[RenderService] 渲染词云失败', error)
            throw error
        }
    }
}

export const renderService = new RenderService()
