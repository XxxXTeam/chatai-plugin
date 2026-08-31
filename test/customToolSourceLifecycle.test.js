import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'

globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }

const { CustomToolService, validateCustomToolSchema } = await import('../src/services/tools/CustomToolService.js')

test('模型自定义工具 schema 拒绝数组形 properties', () => {
    assert.throws(
        () => validateCustomToolSchema({ type: 'object', properties: [] }),
        error => error?.code === 'CUSTOM_TOOL_SCHEMA_INVALID'
    )
})

test('完整 ESM 工具源码支持原子创建、更新回滚和删除', async t => {
    const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-tool-source-'))
    const toolsDir = path.join(pluginRoot, 'data', 'tools')
    let registry = new Map()
    let revision = 0
    t.after(() => fs.rmSync(pluginRoot, { recursive: true, force: true }))

    const reloadHandler = async () => {
        registry = new Map()
        if (!fs.existsSync(toolsDir)) return
        for (const filename of fs.readdirSync(toolsDir).filter(name => name.endsWith('.js'))) {
            try {
                const filePath = path.join(toolsDir, filename)
                const module = await import(`${pathToFileURL(filePath).href}?revision=${revision++}`)
                const tool = module.default
                if (tool?.name && typeof tool.run === 'function') {
                    tool.__filename = filename
                    registry.set(filename, tool)
                }
            } catch {}
        }
    }
    const service = new CustomToolService({
        pluginRoot,
        reloadHandler,
        sourceRegistryInspector: async filename => registry.get(filename) || null,
        registryInspector: async name => {
            const custom = Array.from(registry.values())
                .filter(tool => tool.name === name)
                .map(tool => ({ ...tool, serverName: 'custom-tools', isJsTool: true }))
            return name === 'builtin_conflict'
                ? [...custom, { name, identity: `builtin:${name}`, serverName: 'builtin', isBuiltin: true }]
                : custom
        }
    })

    const originalSource = `export default {
    name: 'source_probe',
    description: '源码探针',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    async run(args) { return { value: args.value } }
}`
    const created = await service.saveSource('source_probe', originalSource)
    const sourcePath = path.join(toolsDir, 'source_probe.js')
    assert.equal(created.created, true)
    assert.equal(created.name, 'source_probe')
    assert.equal(fs.statSync(sourcePath).mode & 0o777, 0o600)
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), originalSource)

    await assert.rejects(service.saveSource('source_probe', 'export default {', { overwrite: true }), /热加载后未注册/)
    assert.equal(fs.readFileSync(sourcePath, 'utf8'), originalSource)
    assert.equal((await service.getLoadedSourceTool('source_probe.js')).name, 'source_probe')

    const updatedSource = originalSource.replace("description: '源码探针'", "description: '已更新源码探针'")
    const updated = await service.saveSource('source_probe', updatedSource, { overwrite: true })
    assert.equal(updated.updated, true)
    assert.equal(registry.get('source_probe.js').description, '已更新源码探针')

    const readBack = service.readSource('source_probe')
    assert.equal(readBack.filename, 'source_probe.js')
    assert.equal(readBack.source, updatedSource)
    assert.equal(readBack.size, Buffer.byteLength(updatedSource))

    const outsideSource = path.join(pluginRoot, 'outside-secret.js')
    fs.writeFileSync(outsideSource, 'export default { secret: true }')
    const linkedSource = path.join(toolsDir, 'linked.js')
    fs.symlinkSync(outsideSource, linkedSource)
    assert.throws(
        () => service.readSource('linked'),
        error => error?.code === 'CUSTOM_TOOL_FILE_INVALID' || error?.code === 'CUSTOM_TOOL_PATH_INVALID'
    )

    const structured = await service.saveTool({
        name: 'structured_probe',
        description: '结构化工具权限探针',
        inputSchema: { type: 'object', properties: {} },
        handlerCode: "return { content: [{ type: 'text', text: 'ok' }] }"
    })
    assert.equal(structured.created, true)
    assert.equal(fs.statSync(path.join(toolsDir, 'structured_probe.js')).mode & 0o777, 0o600)

    const deleted = await service.deleteSource('source_probe')
    assert.equal(deleted.deleted, true)
    assert.equal(fs.existsSync(sourcePath), false)
    assert.equal(registry.has('source_probe.js'), false)

    await assert.rejects(
        service.saveSource(
            'conflict_file',
            `export default {
                name: 'builtin_conflict',
                description: '冲突',
                inputSchema: { type: 'object', properties: {} },
                async run() { return true }
            }`
        ),
        /其他来源占用/
    )
    assert.equal(fs.existsSync(path.join(toolsDir, 'conflict_file.js')), false)
    await assert.rejects(service.deleteSource('CustomTool'), /受保护/)
})

test('旧版 customTools 配置通过 CustomToolService 统一读写且保留字段契约', () => {
    const state = {
        customTools: [
            {
                name: 'legacy_existing',
                description: '旧工具',
                parameters: { type: 'object', properties: { value: { type: 'string' } } },
                handler: 'return args.value'
            }
        ]
    }
    const configStore = {
        get(key) {
            return key === 'customTools' ? state.customTools : undefined
        },
        set(key, value) {
            assert.equal(key, 'customTools')
            state.customTools = value
        }
    }
    const service = new CustomToolService({ configStore })

    assert.equal(service.listConfiguredTools().length, 1)
    assert.throws(() => service.createConfiguredTool({ name: 'legacy_existing' }), /Tool already exists/)
    const created = service.createConfiguredTool({ name: 'legacy_created' })
    assert.equal(created.parameters.type, 'object')
    assert.equal(created.handler, 'function')
    const updated = service.updateConfiguredTool('legacy_created', { description: '已更新' })
    assert.equal(updated.description, '已更新')
    assert.equal(service.deleteConfiguredTool('legacy_created').success, true)
    assert.throws(() => service.deleteConfiguredTool('missing_legacy'), /Tool not found/)
    assert.equal(
        state.customTools.some(tool => tool.name === 'legacy_created'),
        false
    )
})
