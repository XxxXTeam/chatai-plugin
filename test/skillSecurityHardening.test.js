import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import SkillDocumentLoader from '../src/services/skills/SkillDocumentLoader.js'
import { importSkillPackage, SkillImportError } from '../src/services/skills/SkillPackageImporter.js'

/**
 * 构造文档技能配置。
 * @param {number} maxFileBytes - 定义文件大小上限
 * @returns {{getDocumentSkillsConfig:() => object}} 配置对象
 */
function createSkillsConfig(maxFileBytes = 65536) {
    return {
        getDocumentSkillsConfig: () => ({
            enabled: true,
            paths: ['data/skills'],
            maxDepth: 6,
            maxFileBytes,
            maxPromptChars: 20000
        })
    }
}

/**
 * 构造标准技能压缩包。
 * @param {string} name - frontmatter name
 * @param {Record<string,string>} files - 包内附属文件
 * @param {string} [wrapper] - zip 顶层包装目录
 * @param {string} [body] - 技能正文
 * @returns {Buffer} zip 字节
 */
function buildSkillZip(name, files = {}, wrapper = name, body = 'body') {
    const zip = new AdmZip()
    const prefix = wrapper ? `${wrapper}/` : ''
    zip.addFile(`${prefix}SKILL.md`, Buffer.from(`---\nname: ${name}\ndescription: security test\n---\n\n${body}\n`))
    for (const [filePath, content] of Object.entries(files)) {
        zip.addFile(`${prefix}${filePath}`, Buffer.from(content))
    }
    return zip.toBuffer()
}

/**
 * 调用导入器并断言结构化导入错误。
 * @param {Buffer} buffer - zip 字节
 * @param {object} options - 导入选项
 * @param {RegExp} pattern - 错误消息模式
 */
function assertImportRejected(buffer, options, pattern) {
    assert.throws(
        () => importSkillPackage(buffer, options),
        error => error instanceof SkillImportError && pattern.test(error.message)
    )
}

test('不存在的扫描根不会经由外部符号链接祖先创建或导入文件', async () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-root-link-'))
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-root-outside-'))
    try {
        fs.symlinkSync(outsideRoot, path.join(pluginRoot, 'data'))
        const loader = new SkillDocumentLoader()
        await loader.init(pluginRoot, createSkillsConfig())

        assert.equal(loader.getScanRoots().length, 0)
        assert.equal(loader.getImportRoot(), null)
        assert.equal(fs.existsSync(path.join(outsideRoot, 'skills')), false)
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
        fs.rmSync(outsideRoot, { recursive: true, force: true })
    }
})

test('导入拒绝重复规范化路径与同包多个定义入口', () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-zip-guards-'))
    const importRoot = path.join(pluginRoot, 'data', 'skills')
    const tempRoot = path.join(pluginRoot, 'temp', 'imports')
    fs.mkdirSync(importRoot, { recursive: true })
    const options = { importRoot, tempRoot, pluginRoot, maxFileBytes: 65536 }

    try {
        const duplicate = new AdmZip()
        duplicate.addFile('first.md', Buffer.from('---\nname: duplicate\ndescription: valid\n---\n\nbody'))
        duplicate.addFile('second.md', Buffer.from('not frontmatter'))
        duplicate.getEntries()[0].entryName = 'duplicate/SKILL.md'
        duplicate.getEntries()[1].entryName = 'duplicate/SKILL.md'
        assertImportRejected(duplicate.toBuffer(), options, /重复的规范化路径/)

        const multiple = new AdmZip()
        multiple.addFile('multiple/SKILL.md', Buffer.from('---\nname: multiple\ndescription: valid\n---\n'))
        multiple.addFile('multiple/skill.yaml', Buffer.from('name: shadow\ndescription: shadow\n'))
        assertImportRejected(multiple.toBuffer(), options, /只能包含根目录 SKILL\.md 一个定义入口/)
        assert.deepEqual(fs.readdirSync(importRoot), [])
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
    }
})

test('导入目录固定为 frontmatter name，并执行严格名称与加载大小校验', () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-import-name-'))
    const importRoot = path.join(pluginRoot, 'data', 'skills')
    const tempRoot = path.join(pluginRoot, 'temp', 'imports')
    fs.mkdirSync(importRoot, { recursive: true })
    const options = { importRoot, tempRoot, pluginRoot, maxFileBytes: 256 }

    try {
        const imported = importSkillPackage(buildSkillZip('declared-name', {}, 'archive-wrapper'), options)
        assert.equal(imported.name, 'declared-name')
        assert.equal(imported.directory, 'declared-name')
        assert.equal(fs.existsSync(path.join(importRoot, 'declared-name', 'SKILL.md')), true)

        assertImportRejected(
            buildSkillZip('another-name'),
            { ...options, name: 'forced-name' },
            /必须与 SKILL\.md 的 name 完全一致/
        )
        assertImportRejected(buildSkillZip('large-skill', {}, 'large-skill', 'x'.repeat(400)), options, /加载上限/)
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
    }
})

test('新建遵守 maxFileBytes，旧格式技能可编辑非 name 字段但不能改名', async () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-legacy-edit-'))
    const skillDirectory = path.join(pluginRoot, 'data', 'skills', 'legacy-folder')
    fs.mkdirSync(skillDirectory, { recursive: true })
    fs.writeFileSync(
        path.join(skillDirectory, 'SKILL.md'),
        '---\nname: 中文旧技能\ndescription: 初始描述\nallowed-tools:\n  - old_tool\n---\n\n初始正文\n'
    )
    const loader = new SkillDocumentLoader()

    try {
        await loader.init(pluginRoot, createSkillsConfig(256))
        const oversized = loader.createSkillPackage({
            name: 'oversized',
            description: 'oversized',
            body: 'x'.repeat(400)
        })
        assert.equal(oversized.ok, false)
        assert.equal(fs.existsSync(path.join(pluginRoot, 'data', 'skills', 'oversized')), false)

        const source = loader.readSkillSource('中文旧技能')
        const edited = loader.writeStructuredSkill('中文旧技能', {
            metadata: { ...source.metadata, description: '更新描述' },
            body: '更新正文'
        })
        assert.equal(edited.ok, true)

        const renamed = loader.writeStructuredSkill('中文旧技能', {
            metadata: { ...source.metadata, name: 'renamed-skill' },
            body: '更新正文'
        })
        assert.equal(renamed.ok, false)
        assert.equal(renamed.errorCode, 'SKILL_NAME_IMMUTABLE')
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
    }
})

test('扫描只加载包目录明确主入口，并忽略资源目录符号链接', async () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-scan-entry-'))
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-assets-outside-'))
    const skillDirectory = path.join(pluginRoot, 'data', 'skills', 'primary')
    fs.mkdirSync(skillDirectory, { recursive: true })
    fs.writeFileSync(path.join(skillDirectory, 'SKILL.md'), '---\nname: primary\ndescription: primary\n---\n')
    fs.writeFileSync(path.join(skillDirectory, 'skill.yaml'), 'name: shadow\ndescription: shadow\n')
    const conflictingDirectory = path.join(pluginRoot, 'data', 'skills', 'legacy-conflict')
    fs.mkdirSync(conflictingDirectory, { recursive: true })
    fs.writeFileSync(path.join(conflictingDirectory, 'skill.yaml'), 'name: legacy-yaml\ndescription: yaml\n')
    fs.writeFileSync(
        path.join(conflictingDirectory, 'skill.json'),
        JSON.stringify({ name: 'legacy-json', description: 'json' })
    )
    fs.writeFileSync(path.join(outsideRoot, 'secret.md'), 'secret')
    fs.symlinkSync(outsideRoot, path.join(skillDirectory, 'references'))
    const loader = new SkillDocumentLoader()

    try {
        await loader.init(pluginRoot, createSkillsConfig())
        assert.deepEqual(
            loader.getDocuments().map(document => document.name),
            ['primary']
        )
        assert.deepEqual(loader.getDocumentByName('primary').files, [])
        assert.equal(loader.getDocumentByName('shadow'), null)
        assert.equal(loader.getDocumentByName('legacy-yaml'), null)
        assert.equal(loader.getDocumentByName('legacy-json'), null)
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
        fs.rmSync(outsideRoot, { recursive: true, force: true })
    }
})

test('scripts 可随标准包导入和读取，但不能通过管理接口改写或删除', async () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-script-readonly-'))
    const importRoot = path.join(pluginRoot, 'data', 'skills')
    const tempRoot = path.join(pluginRoot, 'temp', 'imports')
    fs.mkdirSync(importRoot, { recursive: true })
    const loader = new SkillDocumentLoader()

    try {
        importSkillPackage(buildSkillZip('script-skill', { 'scripts/run.js': 'return 1' }), {
            importRoot,
            tempRoot,
            pluginRoot,
            maxFileBytes: 65536
        })
        await loader.init(pluginRoot, createSkillsConfig())
        assert.equal(loader.readPackageFile('script-skill', 'scripts/run.js').content, 'return 1')
        assert.equal(loader.writePackageFile('script-skill', 'scripts/run.js', 'return 2').ok, false)
        assert.equal(loader.deletePackageFile('script-skill', 'scripts/run.js').ok, false)
        assert.equal(fs.statSync(path.join(importRoot, 'script-skill', 'scripts', 'run.js')).mode & 0o111, 0)
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
    }
})

test('备份目标排他且连续覆盖不会复用已有备份', async () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-backup-unique-'))
    const importRoot = path.join(pluginRoot, 'data', 'skills')
    const tempRoot = path.join(pluginRoot, 'temp', 'imports')
    fs.mkdirSync(importRoot, { recursive: true })
    const options = { importRoot, tempRoot, pluginRoot, maxFileBytes: 65536, overwrite: true }

    try {
        importSkillPackage(buildSkillZip('backup-skill', {}, 'backup-skill', 'v1'), options)
        const second = importSkillPackage(buildSkillZip('backup-skill', {}, 'backup-skill', 'v2'), options)
        const third = importSkillPackage(buildSkillZip('backup-skill', {}, 'backup-skill', 'v3'), options)
        assert.notEqual(second.backup, third.backup)
        assert.equal(fs.readFileSync(path.join(second.backup, 'SKILL.md'), 'utf8').includes('v1'), true)
        assert.equal(fs.readFileSync(path.join(third.backup, 'SKILL.md'), 'utf8').includes('v2'), true)

        const loader = new SkillDocumentLoader()
        await loader.init(pluginRoot, createSkillsConfig())
        loader.createPackageFile('backup-skill', 'references/a.md', 'a')
        await loader.load()
        loader.createPackageFile('backup-skill', 'references/b.md', 'b')
        await loader.load()
        const firstFile = loader.deletePackageFile('backup-skill', 'references/a.md')
        await loader.load()
        const secondFile = loader.deletePackageFile('backup-skill', 'references/b.md')
        assert.equal(firstFile.ok, true)
        assert.equal(secondFile.ok, true)
        assert.notEqual(firstFile.backup, secondFile.backup)
        assert.equal(fs.readFileSync(path.join(pluginRoot, firstFile.backup), 'utf8'), 'a')
        assert.equal(fs.readFileSync(path.join(pluginRoot, secondFile.backup), 'utf8'), 'b')
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
    }
})

test('加载后的定义文件被原地改写或替换为符号链接时拒绝读取、写入和删除', async () => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-definition-swap-'))
    const alphaDirectory = path.join(pluginRoot, 'data', 'skills', 'alpha')
    const betaDirectory = path.join(pluginRoot, 'data', 'skills', 'beta')
    fs.mkdirSync(alphaDirectory, { recursive: true })
    fs.mkdirSync(betaDirectory, { recursive: true })
    fs.writeFileSync(path.join(alphaDirectory, 'SKILL.md'), '---\nname: alpha\ndescription: alpha\n---\n')
    fs.writeFileSync(path.join(betaDirectory, 'SKILL.md'), '---\nname: beta\ndescription: beta\n---\n')
    const loader = new SkillDocumentLoader()

    try {
        await loader.init(pluginRoot, createSkillsConfig())
        fs.writeFileSync(
            path.join(alphaDirectory, 'SKILL.md'),
            '---\nname: alpha\ndescription: externally changed\n---\n'
        )
        assert.equal(loader.readSkillSource('alpha'), null)
        assert.equal(loader.writeSkillSource('alpha', '---\nname: alpha\ndescription: overwritten\n---\n').ok, false)
        assert.equal(loader.deleteSkill('alpha').ok, false)

        await loader.load()
        fs.renameSync(path.join(alphaDirectory, 'SKILL.md'), path.join(alphaDirectory, 'SKILL.original.md'))
        fs.symlinkSync(path.join(betaDirectory, 'SKILL.md'), path.join(alphaDirectory, 'SKILL.md'))

        assert.equal(loader.readSkillSource('alpha'), null)
        assert.equal(loader.writeSkillSource('alpha', '---\nname: alpha\ndescription: changed\n---\n').ok, false)
        assert.equal(loader.deleteSkill('alpha').ok, false)
        assert.equal(fs.readFileSync(path.join(betaDirectory, 'SKILL.md'), 'utf8').includes('description: beta'), true)
    } finally {
        fs.rmSync(pluginRoot, { recursive: true, force: true })
    }
})
