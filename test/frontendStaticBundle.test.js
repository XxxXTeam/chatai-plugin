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

test('静态 HTML 与 RSC 载荷禁止沿用旧缓存', () => {
    const source = fs.readFileSync(path.resolve('src/services/webServer.js'), 'utf8')
    assert.match(source, /extension === '\.html' \|\| extension === '\.txt'/)
    assert.match(source, /res\.setHeader\('Cache-Control', 'no-store'\)/)
})
