import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import skillsRoutes from '../src/services/routes/skillsRoutes.js'
import SkillDocumentLoader, {
    isEditableSkillFile,
    normalizeManagedPackagePath,
    skillDocumentLoader
} from '../src/services/skills/SkillDocumentLoader.js'

/**
 * 构造仅暴露文档技能配置的测试配置。
 * @returns {{getDocumentSkillsConfig: () => object}} 配置对象
 */
function createSkillsConfig() {
    return {
        getDocumentSkillsConfig: () => ({
            enabled: true,
            paths: ['data/skills'],
            maxDepth: 6,
            maxFileBytes: 65536,
            maxPromptChars: 20000
        })
    }
}

test('SkillDocumentLoader 以原子备份语义完成标准技能与附属文件生命周期', async () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-plugin-skill-loader-'))
    fs.mkdirSync(path.join(pluginRoot, 'data', 'skills'), { recursive: true })
    const loader = new SkillDocumentLoader()

    try {
        await loader.init(pluginRoot, createSkillsConfig())

        const created = loader.createSkillPackage({
            name: 'release-notes',
            description: '生成结构化发布说明',
            allowedTools: ['read_skill_file', 'get_skill_info'],
            metadata: { owner: 'ops' },
            body: '# 工作流程\n\n读取变更并生成发布说明。'
        })
        assert.equal(created.ok, true)
        assert.equal(created.standardCompliant, true)

        await loader.load()
        const document = loader.getDocumentByName('release-notes')
        assert.equal(document.standardCompliant, true)
        assert.deepEqual(document.allowedTools, ['read_skill_file', 'get_skill_info'])

        const createdFile = loader.createPackageFile('release-notes', 'references/format.md', '# 输出格式\n')
        assert.deepEqual({ ok: createdFile.ok, path: createdFile.path }, { ok: true, path: 'references/format.md' })
        assert.equal(loader.createPackageFile('release-notes', 'scripts/run.md', 'no').ok, false)
        assert.equal(loader.createPackageFile('release-notes', 'references/../escape.md', 'no').ok, false)
        assert.equal(isEditableSkillFile('scripts/readme.md'), false)
        assert.equal(isEditableSkillFile('references/readme.md'), true)

        await loader.load()
        const updatedFile = loader.writePackageFile('release-notes', 'references/format.md', '# 输出格式\n\n- 标题\n')
        assert.equal(updatedFile.ok, true)

        const deletedFile = loader.deletePackageFile('release-notes', 'references/format.md')
        assert.equal(deletedFile.ok, true)
        assert.equal(deletedFile.recoverable, true)
        assert.equal(fs.existsSync(path.join(pluginRoot, deletedFile.backup)), true)
        await loader.load()

        const invalidStructured = loader.writeStructuredSkill('release-notes', {
            metadata: { name: 'renamed', description: '目录名不一致' },
            body: '正文'
        })
        assert.equal(invalidStructured.ok, false)
        assert.equal(invalidStructured.errorCode, 'SKILL_NAME_IMMUTABLE')
        assert.match(invalidStructured.error, /父目录同名/)

        fs.writeFileSync(path.join(pluginRoot, 'data', 'skills', 'release-notes', 'NOTICE.txt'), 'notice')
        await loader.load()

        const deletedSkill = loader.deleteSkill('release-notes')
        assert.equal(deletedSkill.ok, true)
        assert.equal(deletedSkill.recoverable, true)
        assert.equal(deletedSkill.affectedFiles, 2)
        assert.equal(fs.existsSync(path.join(pluginRoot, deletedSkill.backup, 'SKILL.md')), true)

        assert.equal(normalizeManagedPackagePath('assets/template.json').ok, true)
        assert.equal(normalizeManagedPackagePath('/assets/template.json').ok, false)
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
    }
})

let server
let baseUrl
let pluginRoot
let originalLoaderState
let originalGlobalLoader
const loadedNames = new Set()

/**
 * 请求隔离启动的 Skills API。
 * @param {string} pathname - 相对路由
 * @param {RequestInit} [init] - fetch 参数
 * @returns {Promise<{status:number,body:object}>} 响应
 */
async function request(pathname, init = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
            ...init.headers
        }
    })
    return { status: response.status, body: await response.json() }
}

before(async () => {
    pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chatgpt-plugin-skill-api-'))
    fs.mkdirSync(path.join(pluginRoot, 'data', 'skills'), { recursive: true })
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
        getLoadedSkillNames: () => Array.from(loadedNames),
        loadSkill: name => {
            if (!skillDocumentLoader.getDocumentByName(name)) return false
            loadedNames.add(name)
            return true
        },
        unloadSkill: name => loadedNames.delete(name),
        reloadDocuments: async () => {
            await skillDocumentLoader.load()
            for (const name of Array.from(loadedNames)) {
                if (!skillDocumentLoader.getDocumentByName(name)) loadedNames.delete(name)
            }
            return { documents: skillDocumentLoader.getDocuments().length, loaded: loadedNames.size }
        }
    }

    const app = express()
    app.use(express.json({ limit: '2mb' }))
    app.use('/api/skills', skillsRoutes)
    await new Promise((resolve, reject) => {
        server = app.listen(0, '127.0.0.1', resolve)
        server.once('error', reject)
    })
    const address = server.address()
    assert.equal(typeof address, 'object')
    baseUrl = `http://127.0.0.1:${address.port}/api/skills`
})

after(async () => {
    if (server) {
        await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    }
    global.chatAiSkillsLoader = originalGlobalLoader
    Object.assign(skillDocumentLoader, originalLoaderState)
    fs.rmSync(pluginRoot, { recursive: true, force: true })
})

test('Skills API 提供创建、校验、结构化编辑、文件管理、加载与可恢复删除', async () => {
    const createResult = await request('/documents', {
        method: 'POST',
        body: JSON.stringify({
            name: 'incident-report',
            description: '编写故障报告',
            allowedTools: ['get_skill_info'],
            body: '# 要求\n\n输出时间线与根因。'
        })
    })
    assert.equal(createResult.status, 201)
    assert.equal(createResult.body.data.standardCompliant, true)

    const documents = await request('/documents')
    assert.equal(documents.status, 200)
    assert.equal(documents.body.data.documents.length, 1)
    assert.equal(documents.body.data.documents[0].status, 'available')
    assert.equal(documents.body.data.documents[0].standardCompliant, true)

    const loadResult = await request('/load/incident-report', { method: 'POST' })
    assert.equal(loadResult.status, 200)
    const loadedDocuments = await request('/documents')
    assert.equal(loadedDocuments.body.data.documents[0].status, 'loaded')

    const source = await request('/documents/incident-report/source')
    assert.equal(source.status, 200)
    assert.equal(source.body.data.metadata.name, 'incident-report')
    assert.match(source.body.data.body, /时间线/)

    const structured = await request('/documents/incident-report', {
        method: 'PUT',
        body: JSON.stringify({
            metadata: {
                ...source.body.data.metadata,
                compatibility: '需要支持 Markdown 的客户端',
                extensionNumber: 7,
                extensionBoolean: false,
                extensionList: ['alpha', 2]
            },
            body: '# 要求\n\n输出时间线、根因和修复动作。'
        })
    })
    assert.equal(structured.status, 200)
    assert.equal(structured.body.data.standardCompliant, true)
    const structuredSource = await request('/documents/incident-report/source')
    assert.equal(typeof structuredSource.body.data.metadata.extensionNumber, 'number')
    assert.equal(typeof structuredSource.body.data.metadata.extensionBoolean, 'boolean')
    assert.deepEqual(structuredSource.body.data.metadata.extensionList, ['alpha', 2])
    const rejectedRename = await request('/documents/incident-report', {
        method: 'PUT',
        body: JSON.stringify({
            metadata: { ...structuredSource.body.data.metadata, name: 'renamed-skill' },
            body: structuredSource.body.data.body
        })
    })
    assert.equal(rejectedRename.status, 409)
    assert.equal(rejectedRename.body.data.errorCode, 'SKILL_NAME_IMMUTABLE')

    const createdFile = await request('/documents/incident-report/files', {
        method: 'POST',
        body: JSON.stringify({ path: 'assets/report-template.md', content: '# 报告模板\n' })
    })
    assert.equal(createdFile.status, 201)

    const forbiddenFile = await request('/documents/incident-report/files', {
        method: 'POST',
        body: JSON.stringify({ path: 'scripts/run.md', content: '不可写入' })
    })
    assert.equal(forbiddenFile.status, 400)

    const deletedFile = await request('/documents/incident-report/files?path=assets%2Freport-template.md', {
        method: 'DELETE'
    })
    assert.equal(deletedFile.status, 200)
    assert.equal(deletedFile.body.data.recoverable, true)
    assert.equal(fs.existsSync(path.join(pluginRoot, deletedFile.body.data.backup)), true)

    const binaryAssetPath = path.join(pluginRoot, 'data', 'skills', 'incident-report', 'assets', 'icon.png')
    fs.mkdirSync(path.dirname(binaryAssetPath), { recursive: true })
    fs.writeFileSync(binaryAssetPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await skillDocumentLoader.load()
    const deletedBinaryAsset = await request('/documents/incident-report/files?path=assets%2Ficon.png', {
        method: 'DELETE'
    })
    assert.equal(deletedBinaryAsset.status, 200)
    assert.equal(deletedBinaryAsset.body.data.recoverable, true)
    assert.equal(fs.existsSync(path.join(pluginRoot, deletedBinaryAsset.body.data.backup)), true)

    const deletedSkill = await request('/documents/incident-report', { method: 'DELETE' })
    assert.equal(deletedSkill.status, 200)
    assert.equal(deletedSkill.body.data.recoverable, true)
    assert.equal(deletedSkill.body.data.affectedFiles, 1)
    assert.equal(fs.existsSync(path.join(pluginRoot, deletedSkill.body.data.backup, 'SKILL.md')), true)

    const afterDelete = await request('/documents')
    assert.equal(afterDelete.body.data.documents.length, 0)
})
