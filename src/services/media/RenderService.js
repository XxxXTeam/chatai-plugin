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
            return { hasMath: false, confidence: 'low', matches: [] }
        }
        
        const matches = []
        let confidence = 'low'
        let mathScore = 0  
        const blockMatches = text.match(this.mathPatterns.blockLatex) || []
        if (blockMatches.length > 0) {
            matches.push(...blockMatches)
            confidence = 'high'
            mathScore += blockMatches.length * 10
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
        
        // 检测行内 LaTeX 公式 $...$
        const inlineMatches = text.match(this.mathPatterns.inlineLatex) || []
        if (inlineMatches.length > 0) {
            const validInline = inlineMatches.filter(m => {
                return this.mathPatterns.mathCommands.test(m) || 
                       /[+\-*/=<>^_{}\\]/.test(m) ||
                       /\d+[a-zA-Z]|[a-zA-Z]\d+/.test(m)
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
        const funcMatches = text.match(this.mathPatterns.functionNotation) || []
        mathScore += funcMatches.length * 3
        
        // 检测极限表示 lim(x→...)
        const limitMatches = text.match(this.mathPatterns.limitNotation) || []
        mathScore += limitMatches.length * 5
        
        // 检测下标/上标 Unicode
        const subSupMatches = text.match(this.mathPatterns.subscriptSuperscript) || []
        mathScore += subSupMatches.length * 2
        
        // 检测导数表示
        const derivMatches = text.match(this.mathPatterns.derivativeNotation) || []
        mathScore += derivMatches.length * 3
        
        // 检测积分符号
        const integralMatches = text.match(this.mathPatterns.integralSymbol) || []
        mathScore += integralMatches.length * 5
        
        // 检测数学符号 (∑, ∞, ∂ 等)
        const symbolMatches = text.match(this.mathPatterns.mathSymbols) || []
        mathScore += symbolMatches.length * 3
        
        // 检测三角函数 sinx, cosx
        const trigMatches = text.match(this.mathPatterns.trigFunctions) || []
        mathScore += trigMatches.length * 2
        
        // 检测希腊字母
        const greekMatches = text.match(this.mathPatterns.greekLetters) || []
        mathScore += greekMatches.length * 1
        
        // 检测数学区间表示 [a,b]
        const intervalMatches = text.match(this.mathPatterns.intervalNotation) || []
        mathScore += intervalMatches.length * 2
        
        // 检测数学表达式模式 x², x^2
        const exprMatches = text.match(this.mathPatterns.mathExprPattern) || []
        mathScore += exprMatches.length * 2
        
        // 检测LaTeX数学命令
        if (this.mathPatterns.mathCommands.test(text)) {
            mathScore += 5
        }
        
        // 根据评分确定置信度
        if (mathScore >= 15 && confidence !== 'high') {
            confidence = 'high'
        } else if (mathScore >= 8 && confidence === 'low') {
            confidence = 'medium'
        }
        
        // 如果评分超过阈值，认为包含数学内容
        const hasMath = mathScore >= 8 || matches.length > 0
        
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
        result = result.replace(/×/g, '\\times')
        result = result.replace(/·/g, '\\cdot')
        result = result.replace(/√/g, '\\sqrt')
        result = result.replace(/∫/g, '\\int')
        result = result.replace(/∑/g, '\\sum')
        result = result.replace(/∏/g, '\\prod')
        result = result.replace(/∂/g, '\\partial')
        result = result.replace(/\b(sin|cos|tan|cot|sec|csc|ln|log|exp|lim|max|min|sup|inf)(?![a-zA-Z\\])/gi, '\\$1')
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
                    
                    // 如果j到达末尾
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
     * 渲染群聊总结
     * @param {string} markdown - 总结内容
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderGroupSummary(markdown, options = {}) {
        return this.renderMarkdownToImage({
            markdown,
            title: options.title || '群聊内容总结',
            subtitle: options.subtitle || `基于最近 ${options.messageCount || '?'} 条消息`,
            icon: '💬',
            theme: options.theme || 'light',
            ...options
        })
    }

    /**
     * 渲染用户画像
     * @param {string} markdown - 画像内容
     * @param {string} nickname - 用户昵称
     * @param {Object} options - 选项
     * @returns {Promise<Buffer>}
     */
    async renderUserProfile(markdown, nickname, options = {}) {
        return this.renderMarkdownToImage({
            markdown,
            title: `用户画像分析`,
            subtitle: nickname,
            icon: '👤',
            theme: options.theme || 'light',
            ...options
        })
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
