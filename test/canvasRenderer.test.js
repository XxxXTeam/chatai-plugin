import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import * as nativeCanvas from '@napi-rs/canvas'
import {
    renderMarkdownToCanvas,
    renderLatexToImageBuffer,
    unwrapMarkdownFence
} from '../src/services/media/canvasRenderer.js'
import { renderService } from '../src/services/media/RenderService.js'

// 使用真实字体测量和 PNG 编码，同时记录绘制位置、颜色和文本。
async function render(markdown, options = {}) {
    const surfaces = [],
        loads = []
    const canvasModule = {
        async loadImage(input) {
            loads.push(input.toString())
            return nativeCanvas.loadImage(input)
        },
        createCanvas(width, height) {
            const canvas = nativeCanvas.createCanvas(width, height)
            const ctx = canvas.getContext('2d'),
                calls = []
            const proxy = new Proxy(ctx, {
                get(target, key) {
                    if (key === 'fillText')
                        return (text, x, y) => {
                            calls.push({
                                type: 'text',
                                text,
                                x,
                                y,
                                width: target.measureText(text).width,
                                font: target.font,
                                color: target.fillStyle
                            })
                            target.fillText(text, x, y)
                        }
                    if (key === 'drawImage')
                        return (image, x, y, w, h) => {
                            calls.push({
                                type: 'image',
                                x,
                                y,
                                width: w,
                                height: h,
                                sourceWidth: image.width,
                                sourceHeight: image.height
                            })
                            target.drawImage(image, x, y, w, h)
                        }
                    const value = Reflect.get(target, key, target)
                    return typeof value === 'function' ? value.bind(target) : value
                },
                set(target, key, value) {
                    return Reflect.set(target, key, value, target)
                }
            })
            surfaces.push({ canvas, ctx, calls })
            return { getContext: () => proxy, toBuffer: (...args) => canvas.toBuffer(...args) }
        }
    }
    const buffer = await renderMarkdownToCanvas(markdown, {
        canvasModule,
        width: 480,
        showTimestamp: false,
        ...options
    })
    assert.equal(buffer.subarray(1, 4).toString(), 'PNG')
    const surface = surfaces.at(-1)
    return {
        ...surface,
        buffer,
        loads,
        pixelRatio: options.pixelRatio ?? 2,
        text: surface.calls.filter(c => c.type === 'text')
    }
}

function assertInside(result, right = result.canvas.width / result.pixelRatio - 24) {
    for (const call of result.calls) {
        assert.ok(call.x >= 23.99 && call.x + call.width <= right + 0.1, `横向越界: ${JSON.stringify(call)}`)
        assert.ok(
            call.y >= 24 && call.y < result.canvas.height / result.pixelRatio - 15,
            `纵向越界: ${JSON.stringify(call)}`
        )
    }
}

test('非表格管道行、空标题和不完整 Markdown 不阻塞进程', () => {
    const result = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `
        import * as canvasModule from '@napi-rs/canvas'
        import { renderMarkdownToCanvas } from './src/services/media/canvasRenderer.js'
        await renderMarkdownToCanvas('| not a table\\n\\n# \\n\\n**unclosed', { canvasModule })
    `
        ],
        { cwd: new URL('..', import.meta.url), timeout: 5000, encoding: 'utf8' }
    )
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
})

test('无标题普通正文可见，行内代码不污染后续正文颜色，背景填满画布', async () => {
    for (const [theme, textColor, background] of [
        ['light', '#333333', [255, 255, 255, 255]],
        ['dark', '#e4e4e4', [29, 29, 53, 255]]
    ]) {
        const out = await render('plain `code` after\n\nnext', { theme })
        for (const word of ['plain', 'after', 'next'])
            assert.equal(out.text.find(c => c.text.includes(word)).color, textColor)
        assert.deepEqual([...out.ctx.getImageData(10, out.canvas.height - 10, 1, 1).data], background)
    }
})

test('中文、长单词、混合强调的换行不越界、不重叠且保留所有文字', async () => {
    const long = '这是很长的一段中文用于检查自动换行。'.repeat(25)
    const out = await render(`${long} **${'Bold'.repeat(35)}** tail`, { width: 300 })
    assert.equal(out.text.map(c => c.text).join(''), `${long} ${'Bold'.repeat(35)} tail`)
    assert.ok(new Set(out.text.map(c => c.y)).size > 10)
    assertInside(out)
    const byY = Map.groupBy
        ? Map.groupBy(out.text, c => c.y)
        : out.text.reduce((m, c) => m.set(c.y, [...(m.get(c.y) || []), c]), new Map())
    for (const row of byY.values())
        for (let i = 1; i < row.length; i++) assert.ok(row[i].x >= row[i - 1].x + row[i - 1].width - 0.1)
})

test('长标题和副标题换行；标题、引用及表格支持行内语义', async () => {
    const out = await render('# **Heading** $x^2$\n\n> **quote**\n\nA | B\n:---|---:\n**cell**|value', {
        width: 300,
        title: 'Long title '.repeat(15),
        subtitle: 'subtitle '.repeat(12)
    })
    assertInside(out)
    for (const word of ['Heading', 'quote', 'cell']) assert.match(out.text.find(c => c.text === word).font, /600/)
    assert.ok(out.calls.some(c => c.type === 'image'))
    assert.doesNotMatch(out.text.map(c => c.text).join(''), /\*\*|\$x/)
})

test('列表保留起始编号、嵌套缩进和任务状态', async () => {
    const out = await render('3. first\n4. second\n   - nested\n\n- [x] done\n- [ ] pending')
    const text = out.text.map(c => c.text).join('')
    assert.match(text, /3\.first4\.second/)
    assert.equal((text.match(/☑/g) || []).length, 1)
    assert.equal((text.match(/☐/g) || []).length, 1)
    assert.ok(out.text.find(c => c.text === 'nested').x > out.text.find(c => c.text === 'second').x)
    assertInside(out)
})

test('组合 emoji 不会跨行拆开，行内代码保留连续空格', async () => {
    const emoji = '👩🏽‍💻'
    const out = await render(emoji.repeat(60) + '\n\n`a   b`', { width: 300 })
    const chunks = out.text.filter(c => c.text.includes('👩'))
    assert.equal(chunks.map(c => c.text).join(''), emoji.repeat(60))
    assert.ok(chunks.every(c => c.text.replaceAll(emoji, '') === ''))
    assert.ok(out.text.some(c => c.text === '   '))
    assertInside(out)
})

test('表格长单元格独立换行，后续行位于上一行内容下方', async () => {
    const long = '长单元格内容'.repeat(20)
    const out = await render(`左 | 右\n---|---\n${long}|right\nEND|done`, { width: 300 })
    const left = out.text.filter(c => c.text.includes('长') || c.text.includes('单元'))
    assert.ok(left.length > 2)
    assert.ok(left.every(c => c.x + c.width <= 150))
    assert.ok(out.text.find(c => c.text === 'END').y > Math.max(...left.map(c => c.y)))
    assertInside(out)
})

test('代码高亮保留嵌套 span 内容和实体原文，支持长代码折行', async () => {
    for (const [lang, code] of [
        ['json', '{"ok":true,"x":"<a>&amp;"}'],
        ['html', '<div class="x">A&B</div>'],
        ['js', '/* first\n second */\nconst url = "' + 'abcdefgh'.repeat(50) + '"'],
        ['unknown', '  <tag> &amp;\n    literal']
    ]) {
        const out = await render('```' + lang + '\n' + code + '\n```', { width: 300 })
        assert.equal(out.text.map(c => c.text).join(''), code.replace(/\n/g, ''))
        assert.ok(out.text.every(c => c.color !== '#e4e4e4'))
        assertInside(out)
    }
})

test('四种公式定界符、深色公式、带空格公式及嵌套样式正确绘制', async () => {
    const out = await render(
        '说明 $ x^2 $ 是字面量，$x^2$ 有效。 **$ y^2 $**\n\n$$\\frac{1}{2}$$\n\n\\[x+y\\]\n\n\\(\\sqrt{x}\\)',
        { theme: 'dark' }
    )
    assert.equal(out.calls.filter(c => c.type === 'image').length, 4)
    assert.equal(out.loads.length, 4)
    assert.ok(out.loads.every(svg => !svg.includes('currentColor') && svg.includes('#e4e4e4')))
    assertInside(out)
})

test('块级公式中 Markdown 特殊符号不会被二次解析，公式高度参与排版', async () => {
    const out = await render('$$\n\\begin{matrix}a & b \\\\ c & d\n\\end{matrix}\n$$\n\nafter')
    const image = out.calls.find(c => c.type === 'image')
    assert.ok(image)
    assert.ok(out.text.find(c => c.text === 'after').y > image.y + image.height)
    assert.equal(out.text.map(c => c.text).join(''), 'after')
})

test('金额、转义美元、代码中的公式保持原文，坏公式有可读回退', async () => {
    const out = await render('价格 $5，优惠后 $3；\\$x\\$；`$x^2$`\n\n$\\notARealCommand{x}$')
    assert.match(out.text.map(c => c.text).join(''), /价格 \$5，优惠后 \$3；\$x\$；\$x\^2\$/)
    assert.match(out.text.map(c => c.text).join(''), /notARealCommand/)
    assert.equal(out.calls.filter(c => c.type === 'image').length, 0)
})

test('删除线、链接、实体、硬换行和 HTML 均有可读结果，不加载远程图片', async () => {
    const out = await render(
        '~~deleted~~ [link](https://example.com) &amp; `&amp;`  \nnext\n\n![photo](https://example.com/a.png)\n\n<script>alert(1)</script>'
    )
    const text = out.text.map(c => c.text).join('')
    assert.match(text, /deleted link & &amp;next/)
    assert.match(text, /\[图片:photo\]/)
    assert.match(text, /<script>alert\(1\)<\/script>/)
    assert.equal(out.loads.length, 0)
    assert.ok(out.text.find(c => c.text === 'next').y > out.text.find(c => c.text === 'link').y)
})

test('只剥离 Markdown 外包装，不损坏语言围栏、无语言围栏、缩进代码', () => {
    for (const source of [
        '```js\nconst x = 1\n```',
        '```\nplain\n```',
        '    indented\n    code',
        '```markdown\n# One\n```\ntext\n```'
    ]) {
        assert.equal(unwrapMarkdownFence(source), source)
        assert.equal(renderService.cleanMarkdown(source, { stripEmoji: false }), source)
    }
    assert.equal(unwrapMarkdownFence('```markdown\n# Hi\n```'), '# Hi')
    assert.equal(unwrapMarkdownFence('````md\n```js\nx\n```\n````'), '```js\nx\n```')
})

test('服务入口保留代码块，标题图标不重复，现代总结不合并段落', async () => {
    const original = renderService.renderMarkdownToImage
    let captured
    try {
        renderService.renderMarkdownToImage = async options => {
            captured = options
            return Buffer.alloc(0)
        }
        await renderService.renderGroupSummaryModern('body', { keywords: ['keyword'], topics: ['topic'] })
        assert.match(captured.markdown, /keyword\n\n/)
        assert.match(captured.markdown, /topic\n\n/)
    } finally {
        renderService.renderMarkdownToImage = original
    }
    // 通过真实入口生成 PNG，覆盖 cleanMarkdown → marked → native Canvas。
    const buffer = await renderService.renderMarkdownToImage({
        markdown: '```json\n{"ok":true}\n```',
        title: '📊 示例',
        showTimestamp: false
    })
    assert.equal(buffer.subarray(1, 4).toString(), 'PNG')
    const once = await renderService.renderMarkdownToImage({
        markdown: 'body',
        title: '示例',
        icon: '📊',
        showTimestamp: false
    })
    const prefixed = await renderService.renderMarkdownToImage({
        markdown: 'body',
        title: '📊 示例',
        icon: '📊',
        showTimestamp: false
    })
    assert.deepEqual(once, prefixed)
})

test('数学自动渲染入口保持括号定界符及 LaTeX 内容', async () => {
    const original = renderService.renderMarkdownToImage
    try {
        renderService.renderMarkdownToImage = async options => options.markdown
        for (const source of ['解释 \\(x^2+1\\)', '\\[\\frac{a}{b}\\]']) {
            assert.equal(await renderService.renderMathContent(source), source)
        }
    } finally {
        renderService.renderMarkdownToImage = original
    }
})

test('异常尺寸及超长内容在最终位图分配前拒绝', async () => {
    for (const width of [0, -1, 239, 2401, NaN, Infinity, '800'])
        await assert.rejects(render('', { width }), RangeError)
    await assert.rejects(render('x'.repeat(100_001)), /过长/)
    await assert.rejects(render('line\n\n'.repeat(1500)), /过高/)
})

test('默认输出 2 倍 PNG，混合正文、表格和公式的逻辑布局与 1 倍一致', async () => {
    const markdown =
        '# 清晰度\n\n' +
        '正文 **加粗** `code` $x^2$。'.repeat(20) +
        '\n\n|公式|说明|\n|---|---|\n|$\\frac{1}{2}$|换行测试|\n\n$$x=\\frac{-1\\pm i\\sqrt{7}}{2}$$'
    const low = await render(markdown, { width: 800, pixelRatio: 1 })
    const high = await render(markdown, { width: 800 })
    assert.equal(low.canvas.width, 800)
    assert.equal(high.canvas.width, 1600)
    assert.equal(high.canvas.height, low.canvas.height * 2)
    assert.equal(high.buffer.readUInt32BE(16), 1600)
    assert.equal(high.buffer.readUInt32BE(20), low.canvas.height * 2)
    assert.equal(high.ctx.getTransform().a, 2)
    assert.equal(high.ctx.getTransform().d, 2)
    const geometry = calls => calls.map(({ sourceWidth, sourceHeight, ...layout }) => layout)
    assert.deepEqual(geometry(high.calls), geometry(low.calls))
    for (const formula of high.calls.filter(c => c.type === 'image')) {
        assert.equal(formula.sourceWidth, formula.width * 2)
        assert.equal(formula.sourceHeight, formula.height * 2)
    }
    assertInside(high)
})

test('公式辅助入口区分物理分辨率与逻辑尺寸，超大公式遵守物理像素上限', async () => {
    const input = 'x=\\frac{-1\\pm i\\sqrt{7}}{2}'
    const low = await renderLatexToImageBuffer(input, { canvasModule: nativeCanvas, pixelRatio: 1 })
    const high = await renderLatexToImageBuffer(input, { canvasModule: nativeCanvas })
    assert.equal(high.width, low.width)
    assert.equal(high.height, low.height)
    assert.equal(high.image.width, low.image.width * 2)
    assert.equal(high.image.height, low.image.height * 2)
    const oversized = await renderLatexToImageBuffer('\\rule{1000em}{1000em}', {
        canvasModule: {
            async loadImage(input) {
                const svg = input.toString()
                return {
                    width: Number(/width="([\d.]+)"/.exec(svg)[1]),
                    height: Number(/height="([\d.]+)"/.exec(svg)[1])
                }
            }
        }
    })
    assert.ok(oversized.image.width <= 4096 && oversized.image.height <= 4096)
    assert.ok(oversized.image.width * oversized.image.height <= 4_000_000)
})

test('2 倍输出按物理面积拒绝超限图片，不分配最终画布', async () => {
    const allocations = []
    await assert.rejects(
        renderMarkdownToCanvas('line\n\n'.repeat(110), {
            width: 2400,
            showTimestamp: false,
            canvasModule: {
                createCanvas(w, h) {
                    allocations.push([w, h])
                    assert.equal(w, 1, '不应分配超限的输出位图')
                    return nativeCanvas.createCanvas(w, h)
                }
            }
        }),
        /过高/
    )
    assert.deepEqual(allocations, [[1, 1]])
    for (const pixelRatio of [0, 3, NaN, '2']) await assert.rejects(render('', { pixelRatio }), /像素密度/)
})
