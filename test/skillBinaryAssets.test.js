import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { skillsTools } from '../src/mcp/tools/skills.js'
import skillsRoutes from '../src/services/routes/skillsRoutes.js'
import { skillDocumentLoader } from '../src/services/skills/SkillDocumentLoader.js'

const PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
)
const PDF_BYTES = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    'ascii'
)

let server
let baseUrl
let pluginRoot
let outsideRoot
let originalLoaderState
let originalGlobalLoader

function createSkillsConfig() {
    return {
        getDocumentSkillsConfig: () => ({
            enabled: true,
            paths: ['data/skills'],
            maxDepth: 6,
            maxFileBytes: 256,
            maxPromptChars: 20000
        })
    }
}

before(async () => {
    pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-binary-assets-'))
    outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-binary-outside-'))
    const skillRoot = path.join(pluginRoot, 'data', 'skills', 'binary-assets')
    fs.mkdirSync(path.join(skillRoot, 'assets'), { recursive: true })
    fs.mkdirSync(path.join(skillRoot, 'references'), { recursive: true })
    fs.mkdirSync(path.join(skillRoot, 'scripts'), { recursive: true })
    fs.writeFileSync(
        path.join(skillRoot, 'SKILL.md'),
        '---\nname: binary-assets\ndescription: binary assets test\n---\n\nRead package files safely.\n'
    )
    fs.writeFileSync(path.join(skillRoot, 'assets', 'pixel.png'), PNG_BYTES)
    fs.writeFileSync(path.join(skillRoot, 'assets', 'disguised.md'), PNG_BYTES)
    fs.writeFileSync(path.join(skillRoot, 'assets', '报告.pdf'), PDF_BYTES)
    fs.writeFileSync(path.join(skillRoot, 'references', 'guide.md'), '# UTF-8 文本\n')
    fs.writeFileSync(path.join(skillRoot, 'references', 'oversized.txt'), 'x'.repeat(300))
    fs.writeFileSync(path.join(skillRoot, 'scripts', 'inspect.js'), 'export default () => "ok"\n')
    fs.writeFileSync(path.join(outsideRoot, 'secret.txt'), 'outside')
    fs.symlinkSync(path.join(outsideRoot, 'secret.txt'), path.join(skillRoot, 'assets', 'outside-link.txt'))

    originalLoaderState = {
        documents: skillDocumentLoader.documents,
        initialized: skillDocumentLoader.initialized,
        pluginRoot: skillDocumentLoader.pluginRoot,
        skillsConfig: skillDocumentLoader.skillsConfig
    }
    originalGlobalLoader = global.chatAiSkillsLoader
    await skillDocumentLoader.init(pluginRoot, createSkillsConfig())
    global.chatAiSkillsLoader = {
        initialized: true,
        getSkillDocuments: () => skillDocumentLoader.getDocuments(),
        getLoadedSkillNames: () => []
    }

    const app = express()
    app.use(express.json())
    app.use('/api/skills', skillsRoutes)
    await new Promise((resolve, reject) => {
        server = app.listen(0, '127.0.0.1', resolve)
        server.once('error', reject)
    })
    const address = server.address()
    baseUrl = `http://127.0.0.1:${address.port}/api/skills`
})

after(async () => {
    if (server) await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    global.chatAiSkillsLoader = originalGlobalLoader
    Object.assign(skillDocumentLoader, originalLoaderState)
    fs.rmSync(pluginRoot, { recursive: true, force: true })
    fs.rmSync(outsideRoot, { recursive: true, force: true })
})

test('扫描清单由服务端声明文本、编辑、下载和 MIME 能力', () => {
    const document = skillDocumentLoader.getDocuments().find(item => item.name === 'binary-assets')
    assert.ok(document)
    assert.equal(
        document.files.some(file => file.path === 'assets/outside-link.txt'),
        false
    )

    const byPath = new Map(document.files.map(file => [file.path, file]))
    assert.deepEqual(
        {
            textReadable: byPath.get('assets/pixel.png').textReadable,
            editable: byPath.get('assets/pixel.png').editable,
            downloadable: byPath.get('assets/pixel.png').downloadable,
            mimeType: byPath.get('assets/pixel.png').mimeType
        },
        { textReadable: false, editable: false, downloadable: true, mimeType: 'image/png' }
    )
    assert.equal(byPath.get('assets/报告.pdf').mimeType, 'application/pdf')
    assert.equal(byPath.get('assets/报告.pdf').textReadable, false)
    assert.equal(byPath.get('assets/disguised.md').mimeType, 'image/png')
    assert.equal(byPath.get('assets/disguised.md').editable, false)
    assert.equal(byPath.get('references/guide.md').textReadable, true)
    assert.equal(byPath.get('references/guide.md').editable, true)
    assert.equal(byPath.get('scripts/inspect.js').textReadable, true)
    assert.equal(byPath.get('scripts/inspect.js').editable, false)
    assert.equal(byPath.get('references/oversized.txt').textReadable, false)
    assert.equal('identity' in byPath.get('assets/pixel.png'), false)
})

test('Skills 文档 API 原样返回服务端能力且不泄露绝对路径', async () => {
    const response = await fetch(`${baseUrl}/documents`)
    assert.equal(response.status, 200)
    const body = await response.json()
    const document = body.data.documents.find(item => item.name === 'binary-assets')
    const png = document.files.find(file => file.path === 'assets/pixel.png')
    assert.deepEqual(
        {
            textReadable: png.textReadable,
            editable: png.editable,
            downloadable: png.downloadable,
            mimeType: png.mimeType
        },
        { textReadable: false, editable: false, downloadable: true, mimeType: 'image/png' }
    )
    assert.equal(JSON.stringify(document).includes(pluginRoot), false)
})

test('文本读取明确拒绝二进制和超限文件，scripts 文本保持模型可读', async () => {
    const binary = skillDocumentLoader.readPackageFile('binary-assets', 'assets/pixel.png')
    assert.equal(binary.ok, false)
    assert.equal(binary.status, 415)
    assert.equal(binary.errorCode, 'SKILL_FILE_NOT_TEXT')
    assert.equal('content' in binary, false)

    const oversized = skillDocumentLoader.readPackageFile('binary-assets', 'references/oversized.txt')
    assert.equal(oversized.ok, false)
    assert.equal(oversized.status, 413)
    assert.equal(oversized.errorCode, 'SKILL_FILE_TEXT_LIMIT')

    const disguisedWrite = skillDocumentLoader.writePackageFile('binary-assets', 'assets/disguised.md', '# replaced')
    assert.equal(disguisedWrite.ok, false)
    assert.equal(disguisedWrite.status, 415)

    const script = skillDocumentLoader.readPackageFile('binary-assets', 'scripts/inspect.js')
    assert.match(script.content, /export default/)
    assert.equal(script.editable, false)

    const readTool = skillsTools.find(tool => tool.name === 'read_skill_file')
    const listTool = skillsTools.find(tool => tool.name === 'list_skill_files')
    const listed = await listTool.handler({ name: 'binary-assets' })
    const listedPng = listed.files.find(file => file.path === 'assets/pixel.png')
    assert.deepEqual(
        {
            textReadable: listedPng.textReadable,
            editable: listedPng.editable,
            downloadable: listedPng.downloadable,
            mimeType: listedPng.mimeType
        },
        { textReadable: false, editable: false, downloadable: true, mimeType: 'image/png' }
    )
    const rejected = await readTool.handler({ name: 'binary-assets', path: 'assets/pixel.png' })
    assert.equal(rejected.success, false)
    assert.equal(rejected.errorCode, 'SKILL_FILE_NOT_TEXT')
    assert.equal('content' in rejected, false)

    const scriptResult = await readTool.handler({ name: 'binary-assets', path: 'scripts/inspect.js' })
    assert.equal(scriptResult.success, true)
    assert.match(scriptResult.content, /export default/)
})

test('下载端点按原始字节返回 PNG/PDF 并设置安全私有响应头', async () => {
    const pngResponse = await fetch(
        `${baseUrl}/documents/binary-assets/files?path=${encodeURIComponent('assets/pixel.png')}&download=1`
    )
    assert.equal(pngResponse.status, 200)
    assert.equal(pngResponse.headers.get('content-type'), 'image/png')
    assert.equal(pngResponse.headers.get('x-content-type-options'), 'nosniff')
    assert.match(pngResponse.headers.get('cache-control'), /private/)
    assert.match(pngResponse.headers.get('content-disposition'), /^attachment;/)
    assert.deepEqual(Buffer.from(await pngResponse.arrayBuffer()), PNG_BYTES)

    const pdfResponse = await fetch(
        `${baseUrl}/documents/binary-assets/files?path=${encodeURIComponent('assets/报告.pdf')}&download=1`
    )
    assert.equal(pdfResponse.status, 200)
    assert.equal(pdfResponse.headers.get('content-type'), 'application/pdf')
    const disposition = pdfResponse.headers.get('content-disposition')
    assert.match(disposition, /filename\*=UTF-8''/)
    assert.match(disposition, /%E6%8A%A5%E5%91%8A\.pdf/)
    assert.equal(disposition.includes(pluginRoot), false)
    assert.deepEqual(Buffer.from(await pdfResponse.arrayBuffer()), PDF_BYTES)

    const textOnlyResponse = await fetch(
        `${baseUrl}/documents/binary-assets/files?path=${encodeURIComponent('assets/pixel.png')}`
    )
    assert.equal(textOnlyResponse.status, 415)
    const textOnlyBody = await textOnlyResponse.json()
    assert.equal(textOnlyBody.data.errorCode, 'SKILL_FILE_NOT_TEXT')
    assert.equal(JSON.stringify(textOnlyBody).includes(PNG_BYTES.toString('base64')), false)
})

test('下载在文件被替换或改成符号链接后返回冲突且不读取新目标', async () => {
    const target = path.join(pluginRoot, 'data', 'skills', 'binary-assets', 'assets', '报告.pdf')
    fs.rmSync(target)
    fs.symlinkSync(path.join(outsideRoot, 'secret.txt'), target)

    const response = await fetch(
        `${baseUrl}/documents/binary-assets/files?path=${encodeURIComponent('assets/报告.pdf')}&download=1`
    )
    assert.equal(response.status, 409)
    const body = await response.json()
    assert.equal(body.data.errorCode, 'SKILL_FILE_UNAVAILABLE')
    assert.equal(JSON.stringify(body).includes('outside'), false)
    assert.equal(JSON.stringify(body).includes(outsideRoot), false)
})
