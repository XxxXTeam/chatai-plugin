import { Marked } from 'marked'
import { load } from 'cheerio'
import hljs from 'highlight.js'
import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'

const THEMES = {
    light: {
        bg: '#f7f7f7',
        containerBg: '#ffffff',
        text: '#333333',
        heading: '#1a1a1a',
        accent: '#0056b3',
        border: '#dddddd',
        codeBg: '#f4f4f4',
        quoteBg: '#f9f9f9',
        quoteBar: '#bbbbbb',
        tableHeader: '#f0f0f0',
        keyword: '#8250df',
        string: '#116329',
        number: '#953800',
        comment: '#57606a',
        name: '#0550ae'
    },
    dark: {
        bg: '#16162a',
        containerBg: '#1d1d35',
        text: '#e4e4e4',
        heading: '#ffffff',
        accent: '#79b8ff',
        border: '#444468',
        codeBg: '#12122a',
        quoteBg: '#24244a',
        quoteBar: '#777799',
        tableHeader: '#2a2a50',
        keyword: '#d2a8ff',
        string: '#a5d6a7',
        number: '#ffa657',
        comment: '#a0a8b7',
        name: '#79c0ff'
    }
}

// 单张 PNG 的边界：超限交给调用方已有的文本回退，避免分配超大原生位图。
const MAX_TEXT_LENGTH = 100_000
const MAX_PIXELS = 32_000_000
const MAX_HEIGHT = 32_000
const MAX_FORMULAS = 256
const MAX_DEPTH = 32
const DEFAULT_PIXEL_RATIO = 2
const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' })

/** 仅解开完整的 markdown/md 外包装；无语言或其他语言围栏是正文代码。 */
export function unwrapMarkdownFence(text) {
    const source = String(text ?? '').replace(/\r\n?/g, '\n')
    const trimmed = source.trim()
    const match = /^(`{3,}|~{3,})(?:markdown|md)[ \t]*\n([\s\S]*?)\n\1[ \t]*$/i.exec(trimmed)
    if (!match) return source
    // 提前闭合的围栏说明并非完整外包装。
    const fence = match[1][0] === '`' ? '`' : '~'
    if (new RegExp(`^ {0,3}${fence}{${match[1].length},}[ \\t]*$`, 'm').test(match[2])) return source
    return match[2]
}

function mathToken(src, block) {
    const prefix = block ? /^ {0,3}/.exec(src)[0].length : 0
    const rest = src.slice(prefix)
    const delimiters = block
        ? [
              ['$$', '$$'],
              ['\\[', '\\]']
          ]
        : [
              ['$$', '$$'],
              ['\\[', '\\]'],
              ['\\(', '\\)'],
              ['$', '$']
          ]
    for (const [open, close] of delimiters) {
        if (!rest.startsWith(open)) continue
        if (open === '$' && (rest.startsWith('$$') || /\s/.test(rest[1] || ' '))) continue
        let end = open.length
        while ((end = rest.indexOf(close, end)) !== -1) {
            let slashCount = 0
            for (let i = end - 1; i >= 0 && rest[i] === '\\'; i--) slashCount++
            if (slashCount % 2) {
                end += close.length
                continue
            }
            const text = rest.slice(open.length, end)
            const tail = rest.slice(end + close.length)
            if (!text.trim()) return
            if (open === '$' && (/[\n`]/.test(text) || /\s$/.test(text) || /^\d/.test(tail))) return
            if (block && !/^[ \t]*(?:\n|$)/.test(tail)) return
            const raw = src.slice(0, prefix + end + close.length) + (block ? /^[ \t]*(?:\n|$)/.exec(tail)[0] : '')
            return {
                type: block ? 'mathBlock' : 'mathInline',
                raw,
                text: text.trim(),
                display: block || open === '$$' || open === '\\['
            }
        }
    }
}

// 使用独立实例，不改变项目其他调用方的 marked 全局配置。
const markdownParser = new Marked({ gfm: true, breaks: false })
markdownParser.use({
    extensions: [
        {
            name: 'mathBlock',
            level: 'block',
            start(src) {
                return src.search(/^ {0,3}(?:\$\$|\\\[)/m)
            },
            tokenizer(src) {
                return mathToken(src, true)
            }
        },
        {
            name: 'mathInline',
            level: 'inline',
            start(src) {
                return src.search(/\$|\\[([]/)
            },
            tokenizer(src) {
                return mathToken(src, false)
            }
        }
    ]
})

// 只解码实体，先保护字面量 <，不把 Markdown 文本作为 HTML 解析。
function decodeEntities(text) {
    return text.includes('&') ? load(text.replace(/</g, '&lt;'), {}, false).root().text() : text
}

let mathJaxEngine
function getMathJax() {
    if (!mathJaxEngine) {
        const adaptor = liteAdaptor()
        RegisterHTMLHandler(adaptor)
        const html = mathjax.document('', {
            InputJax: new TeX({
                packages: AllPackages.filter(name => !['noerrors', 'noundefined'].includes(name)),
                maxBuffer: 10_000,
                maxMacros: 1000
            }),
            OutputJax: new SVG({ fontCache: 'none' })
        })
        mathJaxEngine = { adaptor, html }
    }
    return mathJaxEngine
}

async function renderLatexImage(
    latex,
    { canvasModule, fontSize = 18, display = false, color = '#333333', pixelRatio = DEFAULT_PIXEL_RATIO }
) {
    if (latex.length > 10_000) throw new RangeError('公式过长')
    const { adaptor, html } = getMathJax()
    const output = adaptor.outerHTML(html.convert(latex, { display }))
    const match = /<svg\b[\s\S]*?<\/svg>/.exec(output)
    if (!match || output.includes('data-mjx-error=')) throw new Error('公式无法解析')
    let svg = match[0]
    // 只替换根节点尺寸，不能误改公式文本或路径中的 em/ex 字符。
    const root = /^<svg\b[^>]*>/.exec(svg)[0]
    const dimension = name => {
        const m = new RegExp(`${name}="([\\d.eE+-]+)(ex|em|px)?"`).exec(root)
        if (!m) throw new Error('公式尺寸无效')
        return Number(m[1]) * (m[2] === 'ex' ? fontSize * 0.43 : m[2] === 'em' ? fontSize : 1)
    }
    const w = dimension('width'),
        h = dimension('height')
    if (!(w > 0 && h > 0 && Number.isFinite(w + h))) throw new Error('公式尺寸无效')
    const scale = Math.min(1, 4096 / w, 4096 / h, Math.sqrt(4_000_000 / (w * h)))
    // 保留原来的逻辑尺寸；提高 SVG 栅格尺寸不能改变公式占宽、行高和换行。
    const width = Math.max(1, Math.floor(w * scale))
    const height = Math.max(1, Math.floor(h * scale))
    const rasterScale = Math.min(pixelRatio, 4096 / width, 4096 / height, Math.sqrt(4_000_000 / (width * height)))
    const rasterWidth = Math.max(1, Math.floor(width * rasterScale))
    const rasterHeight = Math.max(1, Math.floor(height * rasterScale))
    const scaledRoot = root
        .replace(/width="[^"]*"/, `width="${rasterWidth}"`)
        .replace(/height="[^"]*"/, `height="${rasterHeight}"`)
    svg = (scaledRoot + svg.slice(root.length)).replace(/currentColor/g, color)
    return { image: await canvasModule.loadImage(Buffer.from(svg)), width, height }
}

function highlightRuns(code, language, style, palette) {
    const lang = String(language || '')
        .trim()
        .split(/\s+/)[0]
        .toLowerCase()
    if (!lang || !hljs.getLanguage(lang)) return [{ text: code, style }]
    try {
        // highlight.js 的嵌套 span 和实体由已有 cheerio 正确解析；不执行 HTML。
        const tree = load(hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, {}, false)
        const runs = []
        const visit = (node, inherited) => {
            if (node.type === 'text') {
                runs.push({ text: node.data, style: inherited })
                return
            }
            const classes = (node.attribs?.class || '').split(/\s+/)
            let color = inherited.color
            for (const cls of classes) {
                if (/^hljs-(keyword|literal|type|built_in)$/.test(cls)) color = palette.keyword
                else if (/^hljs-(string|regexp)$/.test(cls)) color = palette.string
                else if (/^hljs-(number|attr|attribute)$/.test(cls)) color = palette.number
                else if (/^hljs-(comment|meta)$/.test(cls)) color = palette.comment
                else if (/^hljs-(title|name|tag|variable|property)$/.test(cls)) color = palette.name
            }
            for (const child of node.children || []) visit(child, { ...inherited, color })
        }
        for (const node of tree.root().contents().toArray()) visit(node, style)
        return runs
    } catch {
        return [{ text: code, style }]
    }
}

function font(style) {
    return `${style.italic ? 'italic ' : ''}${style.bold ? '600 ' : ''}${style.size}px ${style.family}`
}

/** 布局产生绝对坐标绘制指令；最终绘制不再重新测量或再次换行。 */
class CanvasLayout {
    constructor(ctx, options) {
        Object.assign(this, options)
        this.ctx = ctx
        this.formulas = new Map()
        this.base = { size: options.fontSize, family: options.fontFamily, color: options.palette.text }
    }

    checkHeight(y) {
        if (y > this.maxHeight) throw new RangeError('Markdown 图片过高，请缩短内容或使用文本输出')
    }

    async inline(tokens, style = this.base, depth = 0) {
        if (depth > MAX_DEPTH) throw new RangeError('Markdown 嵌套过深')
        const runs = []
        for (const token of tokens || []) {
            switch (token.type) {
                case 'strong':
                case 'em':
                case 'del':
                case 'link': {
                    const next = { ...style }
                    if (token.type === 'strong') next.bold = true
                    if (token.type === 'em') next.italic = true
                    if (token.type === 'del') next.strike = true
                    if (token.type === 'link') {
                        next.color = this.palette.accent
                        next.underline = true
                    }
                    runs.push(...(await this.inline(token.tokens, next, depth + 1)))
                    break
                }
                case 'codespan':
                    runs.push({
                        text: token.text,
                        preserveWhitespace: true,
                        style: {
                            ...style,
                            size: style.size * 0.9,
                            family: this.codeFont,
                            background: this.palette.codeBg
                        }
                    })
                    break
                case 'br':
                    runs.push({ break: true })
                    break
                case 'image':
                    runs.push({ text: `[图片${token.text ? ':' + decodeEntities(token.text) : ''}]`, style })
                    break
                case 'mathInline':
                case 'mathBlock': {
                    const key = JSON.stringify([token.text, token.display, style.size, style.color])
                    if (!this.formulas.has(key)) {
                        if (this.formulas.size >= MAX_FORMULAS) throw new RangeError('公式数量过多')
                        let image = null
                        try {
                            image = await renderLatexImage(token.text, {
                                canvasModule: this.canvasModule,
                                fontSize: style.size,
                                display: token.display,
                                color: style.color,
                                pixelRatio: this.pixelRatio
                            })
                        } catch {
                            /* 无效公式保留源文本，不能让整张回复丢失。 */
                        }
                        this.formulas.set(key, image)
                    }
                    const image = this.formulas.get(key)
                    runs.push(image ? { ...image, style } : { text: token.raw.trim(), style })
                    break
                }
                case 'checkbox':
                    break // 列表项统一绘制，防止 marked 新版重复 checkbox。
                case 'html':
                    runs.push({ text: token.raw, style })
                    break
                default:
                    if (token.tokens) runs.push(...(await this.inline(token.tokens, style, depth + 1)))
                    else
                        runs.push({
                            text: token.type === 'escape' ? token.text : decodeEntities(token.text || token.raw || ''),
                            style
                        })
            }
        }
        return runs
    }

    text(runs, x, y, width, { align = 'left', preserveWhitespace = false, baseSize = this.fontSize } = {}) {
        if (width < 1) throw new RangeError('Markdown 嵌套或表格列数超出可用宽度')
        const ops = [],
            lines = []
        let items = [],
            used = 0,
            height = baseSize * 1.7
        const finish = () => {
            lines.push({ items, width: used, height })
            items = []
            used = 0
            height = baseSize * 1.7
        }
        const append = item => {
            if (used + item.width > width + 0.01 && items.length) finish()
            // 超宽公式/单字等比缩放到可用宽度，既不截字也不扩大整行。
            if (item.width > width) {
                const ratio = width / item.width
                item = { ...item, width, height: item.height * ratio, scale: ratio }
            }
            items.push({ ...item, x: used })
            used += item.width
            height = Math.max(height, item.height + baseSize * 0.35)
        }
        for (const run of runs) {
            if (run.break) {
                finish()
                continue
            }
            if (run.image) {
                append({ image: run.image, width: run.width, height: run.height, style: run.style })
                continue
            }
            const value =
                preserveWhitespace || run.preserveWhitespace
                    ? run.text.replace(/\t/g, '    ')
                    : run.text.replace(/\s+/g, ' ')
            // 单词优先换行；中文、超长 URL/代码按字素切分，保留 emoji 组合。
            for (const piece of value.match(/\n|[^\S\n]+|[A-Za-z0-9_]+|[^A-Za-z0-9_\s]+/gu) || []) {
                if (piece === '\n') {
                    finish()
                    continue
                }
                this.ctx.font = font(run.style)
                const measure = text => this.ctx.measureText(text).width
                const pieceWidth = measure(piece)
                if (pieceWidth <= width) {
                    append({ text: piece, width: pieceWidth, height: run.style.size * 1.2, style: run.style })
                } else {
                    let chunk = ''
                    for (const { segment } of graphemes.segment(piece)) {
                        const next = chunk + segment
                        if (chunk && measure(next) > width - used) {
                            append({
                                text: chunk,
                                width: measure(chunk),
                                height: run.style.size * 1.2,
                                style: run.style
                            })
                            finish()
                            chunk = segment
                        } else chunk = next
                    }
                    if (chunk)
                        append({ text: chunk, width: measure(chunk), height: run.style.size * 1.2, style: run.style })
                }
            }
        }
        if (items.length || !lines.length) finish()
        let cy = y
        for (const line of lines) {
            const offset = align === 'center' ? (width - line.width) / 2 : align === 'right' ? width - line.width : 0
            for (const item of line.items) {
                const left = x + offset + item.x
                const top = cy + (line.height - item.height) / 2
                if (item.image)
                    ops.push({
                        type: 'image',
                        image: item.image,
                        x: left,
                        y: top,
                        width: item.width,
                        height: item.height
                    })
                else {
                    if (item.style.background)
                        ops.push({
                            type: 'rect',
                            x: left,
                            y: top,
                            width: item.width,
                            height: item.height,
                            color: item.style.background
                        })
                    ops.push({
                        type: 'text',
                        text: item.text,
                        x: left,
                        y: top + item.height * 0.8,
                        width: item.width,
                        scale: item.scale || 1,
                        style: item.style
                    })
                    if (item.style.strike || item.style.underline)
                        ops.push({
                            type: 'rect',
                            x: left,
                            y: top + item.height * (item.style.strike ? 0.48 : 0.94),
                            width: item.width,
                            height: 1,
                            color: item.style.color
                        })
                }
            }
            cy += line.height
            this.checkHeight(cy)
        }
        return { ops, height: cy - y }
    }

    async blocks(tokens, x, y, width, depth = 0) {
        if (depth > MAX_DEPTH || width < this.fontSize) throw new RangeError('Markdown 嵌套或表格列数超出可用范围')
        const ops = [],
            startY = y,
            gap = this.fontSize * 0.55
        for (const token of tokens) {
            let result
            switch (token.type) {
                case 'space':
                case 'checkbox':
                    continue
                case 'heading': {
                    const size = this.fontSize * [1.6, 1.4, 1.2, 1.1, 1, 1][token.depth - 1]
                    const runs = await this.inline(token.tokens, {
                        ...this.base,
                        size,
                        bold: true,
                        color: this.palette.heading
                    })
                    result = this.text(runs, x + 10, y, width - 10, { baseSize: size })
                    ops.push({
                        type: 'rect',
                        x,
                        y: y + 4,
                        width: 3,
                        height: result.height - 8,
                        color: this.palette.accent
                    })
                    break
                }
                case 'blockquote': {
                    result = await this.blocks(token.tokens, x + 16, y + 8, width - 24, depth + 1)
                    result.height += 16
                    ops.push({ type: 'rect', x, y, width, height: result.height, color: this.palette.quoteBg })
                    ops.push({ type: 'rect', x, y, width: 3, height: result.height, color: this.palette.quoteBar })
                    break
                }
                case 'list': {
                    const markers = token.items.map((item, i) =>
                        item.task ? (item.checked ? '☑' : '☐') : token.ordered ? `${Number(token.start) + i}.` : '•'
                    )
                    this.ctx.font = font(this.base)
                    const indent = Math.max(22, ...markers.map(m => this.ctx.measureText(m).width + 8))
                    const listOps = [],
                        listY = y
                    for (let i = 0; i < token.items.length; i++) {
                        const marker = this.text(
                            [{ text: markers[i], style: { ...this.base, color: this.palette.accent } }],
                            x,
                            y,
                            indent
                        )
                        const body = await this.blocks(token.items[i].tokens, x + indent, y, width - indent, depth + 1)
                        listOps.push(...marker.ops, ...body.ops)
                        y += Math.max(marker.height, body.height) + (token.loose ? gap : 3)
                    }
                    result = { ops: listOps, height: y - listY }
                    y = listY
                    break
                }
                case 'table': {
                    const tableOps = [],
                        tableY = y
                    const colWidth = width / token.header.length
                    if (colWidth - 12 < this.fontSize) throw new RangeError('表格列数过多，请增加渲染宽度')
                    for (const [rowIndex, row] of [token.header, ...token.rows].entries()) {
                        const cells = []
                        for (let ci = 0; ci < token.header.length; ci++) {
                            const style = {
                                ...this.base,
                                bold: rowIndex === 0,
                                color: rowIndex === 0 ? this.palette.heading : this.palette.text
                            }
                            cells.push(
                                this.text(
                                    await this.inline(row[ci]?.tokens || [], style),
                                    x + ci * colWidth + 6,
                                    y + 6,
                                    colWidth - 12,
                                    { align: token.align[ci] }
                                )
                            )
                        }
                        const rowHeight = Math.max(...cells.map(c => c.height)) + 12
                        if (rowIndex === 0)
                            tableOps.push({
                                type: 'rect',
                                x,
                                y,
                                width,
                                height: rowHeight,
                                color: this.palette.tableHeader
                            })
                        for (const cell of cells) tableOps.push(...cell.ops)
                        tableOps.push({
                            type: 'rect',
                            x,
                            y: y + rowHeight - 1,
                            width,
                            height: 1,
                            color: this.palette.border
                        })
                        for (let ci = 0; ci <= token.header.length; ci++)
                            tableOps.push({
                                type: 'rect',
                                x: x + ci * colWidth,
                                y,
                                width: 1,
                                height: rowHeight,
                                color: this.palette.border
                            })
                        y += rowHeight
                        this.checkHeight(y)
                    }
                    result = { ops: tableOps, height: y - tableY }
                    y = tableY
                    break
                }
                case 'code': {
                    const style = { ...this.base, family: this.codeFont, size: this.fontSize * 0.9 }
                    result = this.text(
                        highlightRuns(token.text, token.lang, style, this.palette),
                        x + 10,
                        y + 8,
                        width - 20,
                        { preserveWhitespace: true }
                    )
                    result.height += 16
                    ops.push({ type: 'rect', x, y, width, height: result.height, color: this.palette.codeBg })
                    break
                }
                case 'hr':
                    result = {
                        ops: [{ type: 'rect', x, y: y + 8, width, height: 1, color: this.palette.border }],
                        height: 17
                    }
                    break
                case 'mathBlock':
                    result = this.text(await this.inline([token]), x, y, width, { align: 'center' })
                    break
                default: {
                    const runs =
                        token.type === 'html'
                            ? [{ text: token.raw, style: this.base }]
                            : await this.inline(token.tokens || [token])
                    result = this.text(runs, x, y, width, { preserveWhitespace: token.type === 'html' })
                }
            }
            ops.push(...result.ops)
            y += result.height + gap
            this.checkHeight(y)
        }
        return { ops, height: y - startY }
    }
}

/** Markdown → marked tokens → 一次布局 → Canvas PNG。width 为逻辑宽度，默认输出 2 倍像素。 */
export async function renderMarkdownToCanvas(markdown, options = {}) {
    const {
        canvasModule,
        theme = 'light',
        width = 800,
        title = '',
        subtitle = '',
        showTimestamp = true,
        fontSize = 15,
        pixelRatio = DEFAULT_PIXEL_RATIO,
        fontFamily = 'LXGW, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
        codeFont = 'Inconsolata, "Courier New", monospace'
    } = options
    if (!canvasModule) throw new Error('Canvas 模块未加载')
    if (pixelRatio !== 1 && pixelRatio !== 2) throw new RangeError('像素密度必须为 1 或 2')
    if (!Number.isInteger(width) || width < 240 || width > 2400) throw new RangeError('渲染宽度必须是 240–2400 的整数')
    if (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 48) throw new RangeError('渲染字号必须在 8–48 之间')
    if (typeof title !== 'string' || typeof subtitle !== 'string') throw new TypeError('标题和副标题必须是字符串')
    const source = String(markdown ?? '')
    if (source.length + title.length + subtitle.length > MAX_TEXT_LENGTH) throw new RangeError('Markdown 内容过长')
    const palette = THEMES[theme] || THEMES.light
    const layout = new CanvasLayout(canvasModule.createCanvas(1, 1).getContext('2d'), {
        canvasModule,
        palette,
        fontSize,
        fontFamily,
        codeFont,
        pixelRatio,
        // 高度和总像素上限按物理位图计算，2 倍密度占用约 4 倍像素。
        maxHeight: Math.floor(Math.min(MAX_HEIGHT / pixelRatio, MAX_PIXELS / (width * pixelRatio ** 2))) - 48
    })
    const padding = 24,
        contentWidth = width - padding * 2,
        ops = []
    let y = padding
    for (const [text, size, color, bold] of [
        [title, fontSize * 1.6, palette.heading, true],
        [subtitle, fontSize * 0.95, palette.accent, false]
    ]) {
        if (!text) continue
        const result = layout.text([{ text, style: { ...layout.base, size, color, bold } }], padding, y, contentWidth, {
            baseSize: size
        })
        ops.push(...result.ops)
        y += result.height + 6
    }
    if (title || subtitle) {
        ops.push({ type: 'rect', x: padding, y, width: contentWidth, height: 1, color: palette.border })
        y += 12
    }
    const body = await layout.blocks(markdownParser.lexer(source), padding, y, contentWidth)
    ops.push(...body.ops)
    y += body.height
    if (showTimestamp) {
        const footer = layout.text(
            [
                {
                    text: `生成时间：${new Date().toLocaleString('zh-CN')}`,
                    style: { ...layout.base, size: fontSize * 0.8, color: palette.comment }
                }
            ],
            padding,
            y + 8,
            contentWidth
        )
        ops.push(...footer.ops)
        y += footer.height + 8
    }
    layout.checkHeight(y)
    const height = Math.max(200, Math.ceil(y + padding))
    const canvas = canvasModule.createCanvas(width * pixelRatio, height * pixelRatio)
    const g = canvas.getContext('2d')
    g.scale(pixelRatio, pixelRatio)
    g.fillStyle = palette.bg
    g.fillRect(0, 0, width, height)
    g.fillStyle = palette.containerBg
    g.fillRect(4, 4, width - 8, height - 8)
    for (const op of ops) {
        if (op.type === 'rect') {
            g.fillStyle = op.color
            g.fillRect(op.x, op.y, op.width, op.height)
        } else if (op.type === 'image') g.drawImage(op.image, op.x, op.y, op.width, op.height)
        else {
            g.font = font(op.style)
            g.fillStyle = op.style.color
            g.textBaseline = 'alphabetic'
            if (op.scale !== 1) {
                g.save()
                g.translate(op.x, op.y)
                g.scale(op.scale, op.scale)
                g.fillText(op.text, 0, 0)
                g.restore()
            } else g.fillText(op.text, op.x, op.y)
        }
    }
    return canvas.toBuffer('image/png')
}

/** image 使用物理像素；width/height 为排版时的逻辑尺寸。 */
export async function renderLatexToImageBuffer(
    latex,
    { canvasModule, fontSize = 18, pixelRatio = DEFAULT_PIXEL_RATIO }
) {
    if (!canvasModule) throw new Error('Canvas 模块未加载')
    if (pixelRatio !== 1 && pixelRatio !== 2) throw new RangeError('像素密度必须为 1 或 2')
    return renderLatexImage(latex, { canvasModule, fontSize, pixelRatio })
}
