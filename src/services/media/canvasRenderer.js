import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'
import hljs from 'highlight.js'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import markdown from 'highlight.js/lib/languages/markdown'

// highlight.js 核心默认只带少量语言，此处注册常用语言（幂等）
if (!hljs.getLanguage('javascript')) hljs.registerLanguage('javascript', javascript)
if (!hljs.getLanguage('python')) hljs.registerLanguage('python', python)
if (!hljs.getLanguage('bash')) hljs.registerLanguage('bash', bash)
if (!hljs.getLanguage('json')) hljs.registerLanguage('json', json)
if (!hljs.getLanguage('yaml')) hljs.registerLanguage('yaml', yaml)
if (!hljs.getLanguage('typescript')) hljs.registerLanguage('typescript', typescript)
if (!hljs.getLanguage('xml')) hljs.registerLanguage('xml', xml)
if (!hljs.getLanguage('css')) hljs.registerLanguage('css', css)
if (!hljs.getLanguage('markdown')) hljs.registerLanguage('markdown', markdown)

/** 主题配色 */
const THEMES = {
    light: {
        bg: '#f7f7f7',
        containerBg: '#ffffff',
        text: '#333333',
        heading: '#1a1a1a',
        accent: '#0056b3',
        border: 'rgba(0,0,0,0.1)',
        codeBg: '#f4f4f4',
        quoteBg: '#f9f9f9',
        quoteBar: '#ddd',
        tableHeader: '#f0f0f0',
        tableBorder: '#e0e0e0'
    },
    dark: {
        bg: '#16162a',
        containerBg: '#1d1d35',
        text: '#e4e4e4',
        heading: '#ffffff',
        accent: '#4da6ff',
        border: 'rgba(255,255,255,0.1)',
        codeBg: '#12122a',
        quoteBg: '#24244a',
        quoteBar: '#555',
        tableHeader: '#2a2a50',
        tableBorder: '#444468'
    }
}

/** 每行一个块级元素的解析结果 */
class Block {
    constructor(type, ...args) {
        this.type = type
        this.args = args
    }
}

/** 行内解析：识别 `code`、$公式$、**粗**、*斜*、[链接](url)、![图](url) */
function parseInline(line, formulaImages) {
    const tokens = []
    let i = 0
    const n = line.length

    const pushText = t => {
        if (!t) return
        const last = tokens[tokens.length - 1]
        if (last && last.type === 'text') last.text += t
        else tokens.push({ type: 'text', text: t })
    }

    while (i < n) {
        // 图片 ![...](url)
        const imgMatch = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(line.slice(i))
        if (imgMatch) {
            tokens.push({ type: 'image', text: imgMatch[1], meta: imgMatch[2] })
            i += imgMatch[0].length
            continue
        }
        // 链接 [text](url)
        const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(line.slice(i))
        if (linkMatch) {
            pushText(linkMatch[1])
            i += linkMatch[0].length
            continue
        }
        // 行内公式 $...$
        const mathMatch = /^\$([^$\n]+?)\$/.exec(line.slice(i))
        if (mathMatch) {
            tokens.push({ type: 'math', text: mathMatch[1] })
            i += mathMatch[0].length
            continue
        }
        // 代码 `...`
        const codeMatch = /^`([^`\n]+?)`/.exec(line.slice(i))
        if (codeMatch) {
            tokens.push({ type: 'code', text: codeMatch[1] })
            i += codeMatch[0].length
            continue
        }
        // 粗体 **...**
        const boldMatch = /^\*\*([^*]+?)\*\*/.exec(line.slice(i))
        if (boldMatch) {
            tokens.push({ type: 'bold', text: boldMatch[1] })
            i += boldMatch[0].length
            continue
        }
        // 斜体 *...*
        const italicMatch = /^\*([^*\n]+?)\*/.exec(line.slice(i))
        if (italicMatch) {
            tokens.push({ type: 'italic', text: italicMatch[1] })
            i += italicMatch[0].length
            continue
        }

        // 普通字符：尽量贪心地推进到下一个特殊起点
        const nextSpecial = line.slice(i).search(/[!*$`\[]/)
        if (nextSpecial === -1) {
            pushText(line.slice(i))
            i = n
        } else if (nextSpecial === 0) {
            // 特殊字符但不匹配（如单个 * 或 [ 无闭合），原样保留该字符
            pushText(line[i])
            i += 1
        } else {
            pushText(line.slice(i, i + nextSpecial))
            i += nextSpecial
        }
    }
    if (formulaImages) {
        for (const token of tokens) {
            if (token.type === 'math') {
                const key = token.text
                if (formulaImages.has(key)) {
                    token.image = formulaImages.get(key)
                }
            }
        }
    }
    return tokens
}

/** 提取 Markdown 块级结构 */
function parseBlocks(markdown) {
    const lines = String(markdown || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
    const blocks = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()

        // 空行
        if (!trimmed) {
            i++
            continue
        }

        // 分隔线
        if (/^([-*_])\1{2,}\s*$/.test(trimmed)) {
            blocks.push(new Block('hr'))
            i++
            continue
        }

        // 代码块 ```lang
        if (/^```/.test(trimmed)) {
            const lang = trimmed.replace(/^```/, '').trim()
            const codeLines = []
            i++
            while (i < lines.length && !/^```/.test(lines[i].trim())) {
                codeLines.push(lines[i])
                i++
            }
            i++ // 跳过结束 ```（若存在）
            blocks.push(new Block('code', codeLines.join('\n'), lang))
            continue
        }

        // 表格：连续以 | 开头的行
        if (
            /^\s*\|/.test(line) &&
            i + 1 < lines.length &&
            /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1].trim()) &&
            lines[i + 1].includes('-')
        ) {
            const header = line
                .trim()
                .replace(/^\||\|$/g, '')
                .split('|')
                .map(c => c.trim())
            i += 2 // 跳过分隔行
            const rows = []
            while (i < lines.length && /^\s*\|/.test(lines[i])) {
                rows.push(
                    lines[i]
                        .trim()
                        .replace(/^\||\|$/g, '')
                        .split('|')
                        .map(c => c.trim())
                )
                i++
            }
            blocks.push(new Block('table', header, rows))
            continue
        }

        // 标题 / 列表 / 引用 / 无序列表 / 普通段落：逐行或合并段
        if (/^\s{0,3}#{1,6}\s/.test(line)) {
            const m = /^\s{0,3}(#{1,6})\s+(.+)$/.exec(line)
            blocks.push(new Block('heading', m[2].trim(), m[1].length))
            i++
            continue
        }

        if (/^\s*[-+*]\s+/.test(line)) {
            const text = line.replace(/^\s*[-+*]\s+/, '').trim()
            blocks.push(new Block('list', text, false))
            i++
            continue
        }

        if (/^\s*\d+[.)]\s+/.test(line)) {
            const text = line.replace(/^\s*\d+[.)]\s+/, '').trim()
            blocks.push(new Block('list', text, true))
            i++
            continue
        }

        if (/^\s*>\s?/.test(line)) {
            const text = line.replace(/^\s*>\s?/, '').trim()
            blocks.push(new Block('quote', text))
            i++
            continue
        }

        // 普通段落：合并连续非空、非结构行
        const paraLines = []
        while (
            i < lines.length &&
            lines[i].trim() !== '' &&
            !/^\s{0,3}#{1,6}\s/.test(lines[i]) &&
            !/^\s*[-+*]\s+/.test(lines[i]) &&
            !/^\s*\d+[.)]\s+/.test(lines[i]) &&
            !/^\s*>\s?/.test(lines[i]) &&
            !/^```/.test(lines[i].trim()) &&
            !/^\s*\|/.test(lines[i]) &&
            !/^([-*_])\1{2,}\s*$/.test(lines[i].trim())
        ) {
            paraLines.push(lines[i].trim())
            i++
        }
        if (paraLines.length > 0) {
            blocks.push(new Block('paragraph', paraLines.join(' ')))
        }
    }

    return blocks
}

/** highlight.js 语义类 → 固定色板（与主题解耦，用可读性高的深/浅两套） */
const HLJS_COLORS = {
    default: '#e4e4e4',
    'hljs-keyword': '#c678dd',
    'hljs-built_in': '#e6c07b',
    'hljs-type': '#e6c07b',
    'hljs-string': '#98c379',
    'hljs-number': '#d19a66',
    'hljs-comment': '#7f848e',
    'hljs-title': '#61afef',
    'hljs-function': '#61afef',
    'hljs-params': '#abb2bf',
    'hljs-attr': '#d19a66',
    'hljs-attribute': '#d19a66',
    'hljs-property': '#61afef',
    'hljs-variable': '#e06c75',
    'hljs-literal': '#d19a66',
    'hljs-tag': '#e06c75',
    'hljs-name': '#e06c75',
    'hljs-meta': '#7f848e',
    'hljs-symbol': '#d19a66',
    'hljs-bullet': '#61afef',
    'hljs-link': '#56b6c2',
    'hljs-emphasis': '#e06c75',
    'hljs-strong': '#e06c75'
}

/** 用注入的 highlight.js 实例对代码块做 token 化高亮 */
function highlightCodeWithHljs(code, lang, hljs) {
    try {
        const normalizedLang = String(lang || '').toLowerCase()
        const language = normalizedLang && hljs.getLanguage(normalizedLang) ? normalizedLang : null
        if (!language && normalizedLang) {
            // 常见别名归一
            const alias = {
                js: 'javascript',
                ts: 'typescript',
                py: 'python',
                sh: 'bash',
                yml: 'yaml',
                md: 'markdown',
                shell: 'bash'
            }[normalizedLang]
            if (alias && hljs.getLanguage(alias)) {
                const result = hljs.highlight(code, { language: alias, ignoreIllegals: true })
                return tokenizeHljsHtml(result.value)
            }
            return null
        }
        if (!language) return null
        const result = hljs.highlight(code, { language, ignoreIllegals: true })
        return tokenizeHljsHtml(result.value)
    } catch {
        return null
    }
}

/** 把 hljs 输出的 HTML 行转成 { text, color } token 行 */
function tokenizeHljsHtml(html) {
    return String(html)
        .split('\n')
        .map(lineHtml => {
            const tokens = []
            const re = /<span class="([^"]+)">([\s\S]*?)<\/span>|([^<]+)/g
            let m
            while ((m = re.exec(lineHtml)) !== null) {
                if (m[1] && m[2]) {
                    const cls = m[1].includes('hljs-') ? m[1] : 'hljs-' + m[1]
                    tokens.push({ text: m[2], color: HLJS_COLORS[cls] || HLJS_COLORS.default })
                } else if (m[3]) {
                    tokens.push({ text: m[3], color: HLJS_COLORS.default })
                }
            }
            return tokens.length ? tokens : [{ text: '', color: HLJS_COLORS.default }]
        })
}

/** 从 markdown 中提取所有公式（块级与行内），返回 Map<公式文本, Image> */
async function extractFormulas(markdown, { canvasModule, baseFontSizePx }) {
    const formulas = new Map()

    const collect = text => {
        const regexes = [
            /\$\$([\s\S]+?)\$\$/g, // $$...$$
            /\$([^$\n]+?)\$/g, // $...$
            /\\\[([\s\S]+?)\\\]/g, // \[...\]
            /\\\(([^\\\n]+?)\\\)/g // \(...\)
        ]
        for (const re of regexes) {
            let m
            while ((m = re.exec(text)) !== null) {
                const latex = m[1].trim()
                if (latex && !formulas.has(latex)) {
                    formulas.set(latex, null) // 占位，稍后填充
                }
            }
        }
    }

    // 先收集所有公式文本
    const scan = block => {
        if (block.type === 'paragraph' || block.type === 'quote' || block.type === 'list') {
            collect(block.args[0])
        } else if (block.type === 'heading') {
            collect(block.args[0])
        } else if (block.type === 'table') {
            collect(block.args[0].join(' '))
            for (const row of block.args[1]) collect(row.join(' '))
        }
    }
    const blocks = parseBlocks(markdown)
    for (const block of blocks) scan(block)

    // 渲染公式为 Image（mathjax SVG → @napi-rs/canvas）
    for (const latex of formulas.keys()) {
        try {
            formulas.set(latex, await renderLatexImage(latex, { canvasModule, baseFontSizePx }))
        } catch {
            formulas.set(latex, null)
        }
    }
    return { formulas, blocks }
}

// ---- mathjax 单例（lazy）----
let mathJaxEngine = null
function getMathJax() {
    if (mathJaxEngine) return mathJaxEngine
    const adaptor = liteAdaptor()
    RegisterHTMLHandler(adaptor)
    const tex = new TeX({ packages: AllPackages })
    const svg = new SVG({ fontCache: 'none' })
    const html = mathjax.document('', { InputJax: tex, OutputJax: svg })
    mathJaxEngine = { adaptor, html }
    return mathJaxEngine
}
async function renderLatexImage(latex, { canvasModule, baseFontSizePx = 18 }) {
    const { adaptor, html } = getMathJax()
    const node = html.convert(latex, { display: false })
    const full = adaptor.outerHTML(node)
    const start = full.indexOf('<svg')
    const end = full.indexOf('</svg>') + 6
    if (start < 0 || end < start + 6) {
        throw new Error('mathjax 未输出 SVG')
    }
    let svgTag = full.substring(start, end)
    const EM = baseFontSizePx
    // ex/em 单位换算为像素（mathjax 1ex = 0.43em）
    svgTag = svgTag.replace(/([\d.eE+-]+)ex/g, m => String(parseFloat(m) * EM * 0.43))
    svgTag = svgTag.replace(/([\d.eE+-]+)em/g, m => String(parseFloat(m) * EM))
    return await canvasModule.loadImage(Buffer.from(svgTag))
}

function imageLayoutWidth(_token, _baseFontSizePx) {
    return 0
}

/**
 * 主要渲染入口：将 markdown 渲染为 PNG Buffer。
 * @param {string} markdown - Markdown 文本
 * @param {Object} options - 渲染选项
 * @param {Object} options.canvasModule - @napi-rs/canvas 模块
 * @param {string} [options.theme='light'] - 主题
 * @param {number} [options.width=800] - 画布宽度
 * @param {string} [options.title=''] - 标题
 * @param {string} [options.subtitle=''] - 副标题
 * @param {boolean} [options.showTimestamp=true] - 是否显示时间戳
 * @param {number} [options.fontSize=15] - 正文字号
 * @param {string} [options.fontFamily] - 字体族
 * @param {string} [options.codeFont] - 等宽字体
 * @returns {Promise<Buffer>} PNG 图片
 */
export async function renderMarkdownToCanvas(markdown, options = {}) {
    const {
        canvasModule,
        theme = 'light',
        width = 800,
        title = '',
        subtitle = '',
        showTimestamp = true,
        fontSize = 15,
        fontFamily = 'LXGW, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
        codeFont = 'Inconsolata, "Courier New", monospace'
    } = options

    if (!canvasModule) throw new Error('Canvas 模块未加载')
    const palette = THEMES[theme] || THEMES.light
    const padding = 24
    const contentWidth = width - padding * 2
    const { formulas, blocks } = await extractFormulas(markdown, { canvasModule, baseFontSizePx: fontSize })
    const measured = []
    let totalHeight = padding * 2 // 上下留白
    const lineHeight = fontSize * 1.7

    const measureCanvas = canvasModule.createCanvas(1, 1)
    const ctx = measureCanvas.getContext('2d')
    ctx.font = `${fontSize}px ${fontFamily}`

    for (const block of blocks) {
        let h = 0
        switch (block.type) {
            case 'heading': {
                const level = block.args[1]
                const size = fontSize * (level === 1 ? 1.5 : level === 2 ? 1.3 : 1.15)
                const tokens = parseInline(block.args[0], formulas)

                // 测量换行
                const linesOf = []
                let cur = []
                let curW = 0
                for (const token of tokens) {
                    if (token.type === 'image') {
                        cur.push(token)
                        curW += imageLayoutWidth(token, fontSize)
                        continue
                    }
                    ctx.font = `${size}px ${fontFamily}`
                    const w = ctx.measureText(token.text).width
                    if (curW + w > contentWidth && cur.length) {
                        linesOf.push(cur)
                        cur = [token]
                        curW = w
                    } else {
                        cur.push(token)
                        curW += w
                    }
                }
                if (cur.length) linesOf.push(cur)
                h = linesOf.length * size * 1.5 + 8
                break
            }
            case 'paragraph':
            case 'quote':
            case 'list': {
                const text = block.args[0]
                const w = ctx.measureText(text).width
                const linesCount = Math.max(1, Math.ceil(w / contentWidth))
                h = linesCount * lineHeight + (block.type === 'quote' ? 12 : 4)
                break
            }
            case 'code': {
                const code = block.args[0]
                const codeLines = code.split('\n')
                h = codeLines.length * (fontSize * 1.4) + 20
                break
            }
            case 'table': {
                const rows = block.args[1]
                h = (rows.length + 1) * lineHeight + 16
                break
            }
            case 'hr':
                h = fontSize * 1.2 + 8
                break
        }
        measured.push({ block, height: h })
        totalHeight += h
    }
    if (title) totalHeight += fontSize * 3 + padding
    if (showTimestamp) totalHeight += fontSize * 2
    const canvas = canvasModule.createCanvas(width, Math.max(200, Math.ceil(totalHeight)))
    const g = canvas.getContext('2d')
    g.fillStyle = palette.bg
    g.fillRect(0, 0, width, totalHeight)
    g.fillStyle = palette.containerBg
    g.fillRect(4, 4, width - 8, totalHeight - 8)
    let y = padding + fontSize
    if (title) {
        g.fillStyle = palette.heading
        g.font = `600 ${fontSize * 1.6}px ${fontFamily}`
        g.fillText(title, padding, y)
        y += fontSize * 1.8
        if (subtitle) {
            g.fillStyle = palette.accent
            g.font = `${fontSize * 0.95}px ${fontFamily}`
            g.fillText(subtitle, padding, y)
            y += fontSize * 1.5
        }
        // 分隔线
        g.strokeStyle = palette.border
        g.beginPath()
        g.moveTo(padding, y)
        g.lineTo(width - padding, y)
        g.stroke()
        y += fontSize
    }

    // 内容
    for (const item of measured) {
        const block = item.block
        const h = item.height

        switch (block.type) {
            case 'heading': {
                const level = block.args[1]
                const size = fontSize * (level === 1 ? 1.5 : level === 2 ? 1.3 : 1.15)

                // 左侧装饰条
                g.fillStyle = palette.accent
                g.fillRect(padding, y - size * 1.2, 4, size * 1.4)
                g.font = `600 ${size}px ${fontFamily}`
                g.fillStyle = palette.heading
                g.fillText(block.args[0], padding + 10, y)
                y += h
                break
            }
            case 'paragraph':
            case 'list':
            case 'quote': {
                const tokens = parseInline(block.args[0], formulas)

                if (block.type === 'quote') {
                    g.fillStyle = palette.quoteBg
                    g.fillRect(padding, y - fontSize * 1.3, contentWidth, h)
                    g.fillStyle = palette.quoteBar
                    g.fillRect(padding, y - fontSize * 1.3, 3, h)
                }

                // 逐行在限宽内绘制 tokens
                const linesOf = wrapTokens(
                    g,
                    tokens,
                    contentWidth - (block.type === 'quote' ? 16 : 0),
                    fontSize,
                    fontFamily,
                    formulas
                )
                for (let li = 0; li < linesOf.length; li++) {
                    const lineTokens = linesOf[li]
                    let x = padding + (block.type === 'list' ? 16 : block.type === 'quote' ? 14 : 0)
                    if (li === 0 && block.type === 'list') {
                        g.fillStyle = palette.accent
                        g.font = `${fontSize}px ${fontFamily}`
                        g.fillText('◆', padding, y)
                        x = padding + 22
                    }
                    if (li === 0 && block.type === 'quote') {
                        g.fillStyle = palette.text
                        g.font = `${fontSize * 0.9}px ${fontFamily}`
                        g.fillText('▍', padding, y)
                    }
                    x = drawTokens(g, lineTokens, x, y, fontSize, fontFamily, codeFont)
                }
                y += h
                break
            }
            case 'code': {
                const code = block.args[0]
                const lang = block.args[1] || ''
                // highlight.js 已在本模块顶部注册常用语言
                const highlighted = highlightCodeWithHljs(code, lang, hljs)
                g.fillStyle = palette.codeBg
                g.fillRect(padding, y - fontSize * 1.2 + 4, contentWidth, h - 8)
                g.font = `${fontSize * 0.9}px ${codeFont}`
                let cy = y
                if (highlighted) {
                    for (const lineTokens of highlighted) {
                        let cx = padding + 12
                        for (const token of lineTokens) {
                            g.fillStyle = token.color || palette.text
                            g.fillText(token.text, cx, cy)
                            cx += g.measureText(token.text).width
                        }
                        cy += fontSize * 1.4
                    }
                } else {
                    g.fillStyle = palette.text
                    for (const codeLine of code.split('\n')) {
                        g.fillText(codeLine, padding + 12, cy)
                        cy += fontSize * 1.4
                    }
                }
                y += h
                break
            }
            case 'table': {
                const header = block.args[0]
                const rows = block.args[1]
                const colCount = header.length
                const colWidth = Math.floor(contentWidth / Math.max(1, colCount))

                // 表头
                g.fillStyle = palette.tableHeader
                g.fillRect(padding, y - fontSize * 1.2, contentWidth, lineHeight + 4)
                g.fillStyle = palette.heading
                g.font = `600 ${fontSize}px ${fontFamily}`
                header.forEach((cell, ci) => {
                    g.fillText(cell, padding + ci * colWidth + 6, y)
                })
                y += lineHeight
                // 数据行
                for (const row of rows) {
                    g.fillStyle = palette.text
                    g.font = `${fontSize}px ${fontFamily}`
                    row.forEach((cell, ci) => {
                        g.fillText(String(cell || ''), padding + ci * colWidth + 6, y)
                    })
                    g.strokeStyle = palette.tableBorder
                    g.beginPath()
                    g.moveTo(padding, y + 4)
                    g.lineTo(width - padding, y + 4)
                    g.stroke()
                    y += lineHeight
                }
                y += 8
                break
            }
            case 'hr': {
                g.strokeStyle = palette.border
                g.beginPath()
                g.moveTo(padding, y)
                g.lineTo(width - padding, y)
                g.stroke()
                y += h
                break
            }
        }
    }

    // 时间戳
    if (showTimestamp) {
        g.fillStyle = palette.text
        g.font = `${fontSize * 0.8}px ${fontFamily}`
        g.globalAlpha = 0.6
        g.fillText(`生成时间：${new Date().toLocaleString('zh-CN')}`, padding, totalHeight - padding)
        g.globalAlpha = 1
    }

    return canvas.toBuffer('image/png')
}

/** 将 tokens 按宽度换行为多行以便逐行绘制 */
function wrapTokens(ctx, tokens, maxWidth, fontSize, fontFamily) {
    const lines = []
    let cur = []
    let curW = 0
    for (const token of tokens) {
        if (token.type === 'math' && token.image) {
            const w = token._w || 40
            if (curW + w > maxWidth && cur.length) {
                lines.push(cur)
                cur = [token]
                curW = w
            } else {
                cur.push(token)
                curW += w
            }
            continue
        }
        ctx.font = `${fontSize}px ${fontFamily}`
        const w = ctx.measureText(token.text).width
        if (curW + w > maxWidth && cur.length) {
            lines.push(cur)
            cur = [token]
            curW = w
        } else {
            cur.push(token)
            curW += w
        }
    }
    if (cur.length) lines.push(cur)
    return lines
}

/** 绘制一行 tokens，返回下一个 x 坐标 */
function drawTokens(g, tokens, x, y, fontSize, fontFamily, codeFont) {
    const baseline = y
    for (const token of tokens) {
        if (token.type === 'image') {
            // 远程图片：无法同步绘制，这里输出占位文本
            g.font = `${fontSize}px ${fontFamily}`
            g.fillText(`[图片${token.text ? ':' + token.text : ''}]`, x, baseline)
            x += g.measureText(`[图片]`).width + 10
            continue
        }
        if (token.type === 'math') {
            const img = token.image
            if (img && img.width > 0) {
                const h = fontSize * 1.1
                const scale = h / img.height
                const drawW = img.width * scale
                g.drawImage(img, x, baseline - h * 0.78, drawW, h)
                x += drawW + 4
                continue
            }
            // 公式渲染失败：退化为文本
            g.fillStyle = '#c0392b'
            g.font = `${fontSize}px ${fontFamily}`
            g.fillText(` ${token.text} `, x, baseline)
            x += g.measureText(` ${token.text} `).width
            continue
        }
        if (token.type === 'code') {
            const codeFontSize = fontSize * 0.9
            g.font = `${codeFontSize}px ${codeFont}`
            const w = g.measureText(token.text).width
            g.fillStyle = '#eceff4'
            g.fillRect(x - 3, baseline - fontSize * 0.9, w + 6, fontSize * 1.2)
            g.fillStyle = '#c0392b'
            g.fillText(token.text, x, baseline)
            x += w + 8
            continue
        }
        if (token.type === 'link') {
            g.fillStyle = '#0563c1'
            g.font = `${fontSize}px ${fontFamily}`
            g.fillText(token.text, x, baseline)
            x += g.measureText(token.text).width
            continue
        }
        // 文本 / 粗体 / 斜体
        const isBold = token.type === 'bold'
        const isItalic = token.type === 'italic'
        g.font = `${isBold ? '600 ' : ''}${isItalic ? 'italic ' : ''}${fontSize}px ${fontFamily}`
        g.fillStyle = isBold ? g.fillStyle : g.fillStyle
        g.fillText(token.text, x, baseline)
        x += g.measureText(token.text).width
    }
    return x
}

/**
 * 供 RenderService 使用的辅助：渲染单条 LaTeX 公式为图片
 * @returns {Promise<{image: Object, width: number, height: number}>}
 */
export async function renderLatexToImageBuffer(latex, { canvasModule, fontSize = 18 }) {
    if (!canvasModule) throw new Error('Canvas 模块未加载')
    const img = await renderLatexImage(latex, { canvasModule, baseFontSizePx: fontSize })
    return { image: img, width: img.width, height: img.height }
}
