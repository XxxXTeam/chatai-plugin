import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const bundleRoot = path.resolve('resources/web')

function listHtmlFiles(directory) {
    const files = []
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name)
        if (entry.isDirectory()) files.push(...listHtmlFiles(filePath))
        else if (entry.isFile() && entry.name.endsWith('.html')) files.push(filePath)
    }
    return files
}

test('静态前端 HTML 的每个 Next 资源引用都存在', () => {
    assert.equal(fs.existsSync(bundleRoot), true, 'resources/web 不得为空')
    const missing = []
    for (const htmlFile of listHtmlFiles(bundleRoot)) {
        const html = fs.readFileSync(htmlFile, 'utf8')
        for (const match of html.matchAll(/(?:src|href)="(\/chatai\/[^"?#]+)"/g)) {
            const resource = match[1]
            if (!resource.includes('/_next/')) continue
            const resourcePath = path.join(bundleRoot, resource.replace(/^\/chatai\//, ''))
            if (!fs.existsSync(resourcePath)) missing.push(`${path.relative(bundleRoot, htmlFile)} -> ${resource}`)
        }
    }
    assert.deepEqual(missing, [], `HTML 引用了缺失的静态资源：${missing.join('; ')}`)
})

test('静态 memory 页面包含可写知识图谱工作台代码', () => {
    const memoryHtml = path.join(bundleRoot, 'memory/index.html')
    assert.equal(fs.existsSync(memoryHtml), true, 'memory 页面必须存在')
    const html = fs.readFileSync(memoryHtml, 'utf8')
    const chunkNames = [...html.matchAll(/(?:src|href)="\/chatai\/(?:_next\/static\/chunks\/)([^"?#]+\.js)"/g)].map(
        match => match[1]
    )
    const graphChunk = chunkNames
        .map(name => path.join(bundleRoot, '_next/static/chunks', name))
        .filter(filePath => fs.existsSync(filePath))
        .find(filePath => fs.readFileSync(filePath, 'utf8').includes('知识图谱工作台'))
    assert.ok(graphChunk, 'memory 页面引用的 chunk 中必须包含知识图谱工作台')
    const source = fs.readFileSync(graphChunk, 'utf8')
    assert.match(source, /新建实体/)
    assert.match(source, /创建关系失败/)
})

test('静态 HTML 与 RSC 载荷启用协商缓存而非沿用旧缓存', () => {
    const source = fs.readFileSync(path.resolve('src/services/webServer.js'), 'utf8')
    assert.match(source, /extension === '\.html' \|\| extension === '\.txt'/)
    assert.match(source, /res\.setHeader\('Cache-Control', 'no-cache'\)/)
})

/**
 * 剥离模板字符串外层，取出 postbuild 生成的 sw.js 本体源码。
 * @param {string} templateSource - buildServiceWorkerSource 函数源码
 * @returns {string} 去除模板引号后的 SW 源码
 */
function extractSwSourceFromGenerator(templateSource) {
    const start = templateSource.indexOf('return `')
    const end = templateSource.lastIndexOf('`')
    if (start === -1 || end === -1) throw new Error('找不到 buildServiceWorkerSource 的模板字符串')
    return templateSource.slice(start + 'return `'.length, end)
}

test('Service Worker 必须放行所有 API 请求（数据新鲜性）', () => {
    const postbuild = fs.readFileSync(path.resolve('frontend/scripts/postbuild.mjs'), 'utf8')
    const swSource = extractSwSourceFromGenerator(postbuild)

    // 归类函数存在且语义正确
    assert.match(swSource, /function isApiRequest\(request\)/, 'SW 必须定义 API 请求识别')
    assert.match(swSource, /url\.pathname\.startsWith\(BASE \+ '\/api\/'\)/, 'SW 必须按路径识别 /api/ 请求')
    // fetch 守卫在第一行放行 API
    const guardedFetch = swSource.match(/self\.addEventListener\('fetch'[\s\S]*?if \(isApiRequest\(request\)\) return/)
    assert.ok(guardedFetch, 'fetch 守卫必须直接 return 放行 API 请求')

    // query=_ 等 API URL 也不能进入 static 分支
    assert.match(swSource, /cache-first/, '静态资源分支保留 cache-first 是可接受的')
})

test('Service Worker 对非静态资源采用 network-first', () => {
    const postbuild = fs.readFileSync(path.resolve('frontend/scripts/postbuild.mjs'), 'utf8')
    const swSource = extractSwSourceFromGenerator(postbuild)
    // 非 HTML、非静态资源的普通 GET 必须走网络优先（HTML 分支）
    assert.match(swSource, /isHtmlRequest\(request\)/, 'HTML 请求保留 network-first')
    assert.match(swSource, /\.catch\(\(\) =>/, '离线回退逻辑必须保留')
})
