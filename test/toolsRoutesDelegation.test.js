import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'

globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }

const { default: toolsRoutes, setToolsRouteServicesForTest } = await import('../src/services/routes/toolsRoutes.js')
const { CustomToolValidationError } = await import('../src/services/tools/CustomToolService.js')

function createConfigStore() {
    const state = {
        customTools: [],
        builtinTools: {
            enabled: true,
            enabledCategories: ['basic'],
            allowedTools: [],
            disabledTools: ['tool_b'],
            allowDangerous: false
        }
    }
    return {
        state,
        get(key) {
            if (key === 'customTools') return state.customTools
            if (key === 'builtinTools') return state.builtinTools
            if (key === 'builtinTools.disabledTools') return state.builtinTools.disabledTools
            return undefined
        },
        async set(key, value) {
            if (key === 'builtinTools') state.builtinTools = value
            else if (key === 'builtinTools.disabledTools') state.builtinTools.disabledTools = value
            else throw new Error(`unexpected config key: ${key}`)
        }
    }
}

test('工具旧接口通过 McpManager 与 CustomToolService 薄代理执行', async t => {
    const calls = []
    const configStore = createConfigStore()
    const manager = {
        async init() {
            calls.push(['init'])
        },
        async refreshBuiltinTools() {
            calls.push(['refreshBuiltinTools'])
            return [{ name: 'tool_a' }, { name: 'tool_b' }]
        },
        async toggleCategory(category, enabled) {
            calls.push(['toggleCategory', category, enabled])
            return { success: true, category, enabled }
        },
        async toggleTool(name, enabled) {
            calls.push(['toggleTool', name, enabled])
            return { success: true, disabledTools: enabled ? [] : [name] }
        },
        async reloadJsTools() {
            calls.push(['reloadJsTools'])
            return 1
        },
        async callTool(name, args, options) {
            calls.push(['callTool', name, args, options])
            return { success: true, content: [{ type: 'text', text: 'ok' }] }
        }
    }
    const builtin = {
        jsTools: new Map([['js_tool', {}]]),
        async init() {
            calls.push(['builtin.init'])
        },
        listTools() {
            calls.push(['builtin.listTools'])
            return [{ name: 'injected_builtin' }]
        },
        getToolCategories() {
            return [{ key: 'basic', tools: [{ name: 'tool_a' }, { name: 'tool_b' }] }]
        },
        getCustomTools() {
            return [{ name: 'config_tool' }]
        },
        getWatcherStatus() {
            calls.push(['builtin.getWatcherStatus'])
            return { enabled: false, source: 'injected' }
        },
        async startFileWatcher() {
            calls.push(['builtin.startFileWatcher'])
        },
        stopFileWatcher() {
            calls.push(['builtin.stopFileWatcher'])
        }
    }
    const sourceService = {
        async readSource(name) {
            calls.push(['readSource', name])
            return { name, filename: `${name}.js`, source: 'export default {}', size: 18, modifiedAt: 1 }
        },
        async saveSource(name, source, options) {
            calls.push(['saveSource', name, source, options])
            if (source === 'invalid') {
                throw new CustomToolValidationError('源码无效', 'CUSTOM_TOOL_SOURCE_INVALID')
            }
            return { success: true, name, filename: `${name}.js`, ...options }
        },
        async deleteSource(name) {
            calls.push(['deleteSource', name])
            return { success: true, name, deleted: true }
        },
        async listSources() {
            calls.push(['listSources'])
            return [{ name: 'web_tool', filename: 'web_tool.js', size: 1, modifiedAt: 1 }]
        },
        resolveSourcePath(name) {
            calls.push(['resolveSourcePath', name])
            return { name: String(name).replace(/\.js$/, ''), filename: `${name}.js` }
        },
        async listConfiguredTools() {
            calls.push(['listConfiguredTools'])
            return configStore.state.customTools
        },
        async createConfiguredTool(definition) {
            calls.push(['createConfiguredTool', definition])
            const tool = { name: definition.name, description: definition.description || '', custom: true }
            configStore.state.customTools.push(tool)
            return tool
        },
        async updateConfiguredTool(name, patch) {
            calls.push(['updateConfiguredTool', name, patch])
            return { name, ...patch, updatedAt: 1 }
        },
        async deleteConfiguredTool(name) {
            calls.push(['deleteConfiguredTool', name])
            return { success: true, name }
        }
    }
    const restore = setToolsRouteServicesForTest({
        config: configStore,
        mcpManager: manager,
        builtinMcpServer: builtin,
        customToolService: sourceService
    })
    t.after(restore)

    const app = express()
    app.use(express.json())
    app.use('/api/tools', toolsRoutes)
    const server = await new Promise((resolve, reject) => {
        const listening = app.listen(0, '127.0.0.1', () => resolve(listening))
        listening.once('error', reject)
    })
    t.after(() => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))))
    const address = server.address()
    const baseUrl = `http://127.0.0.1:${address.port}/api/tools`
    const request = async (pathname, init = {}) => {
        const response = await fetch(`${baseUrl}${pathname}`, {
            ...init,
            headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }
        })
        return { response, body: await response.json() }
    }

    const failedList = await request('/list')
    assert.equal(failedList.response.status, 500)
    assert.equal(failedList.body.code, -1)
    assert.match(failedList.body.message, /获取工具列表失败/)

    const builtinList = await request('/builtin')
    assert.equal(builtinList.response.status, 200)
    assert.deepEqual(builtinList.body.data, [{ name: 'injected_builtin' }])
    await request('/builtin/list')
    await request('/builtin/categories')
    const watcher = await request('/watcher/status')
    assert.equal(watcher.body.data.source, 'injected')
    await request('/watcher/toggle', { method: 'POST', body: JSON.stringify({ enabled: true }) })
    await request('/watcher/toggle', { method: 'POST', body: JSON.stringify({ enabled: false }) })
    assert.ok(calls.some(call => call[0] === 'builtin.listTools'))
    assert.ok(calls.some(call => call[0] === 'builtin.startFileWatcher'))
    assert.ok(calls.some(call => call[0] === 'builtin.stopFileWatcher'))

    assert.equal(
        (
            await request('/builtin/category/toggle', {
                method: 'POST',
                body: JSON.stringify({ category: 'basic', enabled: false })
            })
        ).response.status,
        200
    )
    await request('/builtin/tool/toggle', {
        method: 'POST',
        body: JSON.stringify({ toolName: 'tool_a', enabled: false })
    })
    await request('/builtin/refresh', { method: 'POST' })
    await request('/builtin/config', {
        method: 'PUT',
        body: JSON.stringify({ allowDangerous: true })
    })
    assert.ok(calls.some(call => call[0] === 'toggleCategory'))
    assert.ok(calls.some(call => call[0] === 'toggleTool' && call[1] === 'tool_a'))
    assert.ok(calls.filter(call => call[0] === 'refreshBuiltinTools').length >= 2)

    const enabled = await request('/enabled')
    assert.equal(enabled.response.headers.get('deprecation'), 'true')
    assert.deepEqual(enabled.body.data.sort(), ['config_tool', 'js_tool', 'tool_a'])

    const replaced = await request('/enabled', {
        method: 'PUT',
        body: JSON.stringify({ tools: ['tool_b'] })
    })
    assert.equal(replaced.response.status, 200)
    assert.equal(replaced.body.data.deprecated, true)
    assert.ok(configStore.state.builtinTools.disabledTools.includes('tool_a'))
    assert.equal(configStore.state.builtinTools.disabledTools.includes('tool_b'), false)

    const legacyToggle = await request('/toggle/tool_b', {
        method: 'POST',
        body: JSON.stringify({ enabled: false })
    })
    assert.equal(legacyToggle.response.headers.get('deprecation'), 'true')
    assert.equal(legacyToggle.body.data.replacement, '/api/tools/builtin/tool/toggle')

    const source = "export default { name: 'web_tool', inputSchema: { type: 'object' }, async run() {} }"

    const legacyCreated = await request('/custom', {
        method: 'POST',
        body: JSON.stringify({ name: 'legacy_tool', description: 'legacy' })
    })
    assert.equal(legacyCreated.response.status, 201)
    await request('/custom')
    await request('/custom/legacy_tool', {
        method: 'PUT',
        body: JSON.stringify({ description: 'updated' })
    })
    await request('/custom/legacy_tool', { method: 'DELETE' })
    assert.ok(calls.some(call => call[0] === 'listConfiguredTools'))
    assert.ok(calls.some(call => call[0] === 'createConfiguredTool'))
    assert.ok(calls.some(call => call[0] === 'updateConfiguredTool'))
    assert.ok(calls.some(call => call[0] === 'deleteConfiguredTool'))

    const jsList = await request('/js')
    assert.equal(jsList.response.status, 200)
    assert.ok(calls.some(call => call[0] === 'listSources'))

    const readSource = await request('/js/web_tool')
    assert.equal(readSource.response.status, 200)
    assert.equal(readSource.body.data.filename, 'web_tool.js')
    assert.ok(calls.some(call => call[0] === 'readSource'))

    const created = await request('/js', {
        method: 'POST',
        body: JSON.stringify({ name: 'web_tool', source })
    })
    assert.equal(created.response.status, 201)
    await request('/js/web_tool', { method: 'PUT', body: JSON.stringify({ source }) })
    await request('/js/web_tool', { method: 'DELETE' })
    assert.ok(calls.some(call => call[0] === 'saveSource' && call[3].overwrite === false))
    assert.ok(calls.some(call => call[0] === 'saveSource' && call[3].overwrite === true))
    assert.ok(calls.some(call => call[0] === 'deleteSource'))
    assert.ok(calls.some(call => call[0] === 'resolveSourcePath'))

    const testResponse = await fetch(`${baseUrl}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName: 'web_tool', arguments: { value: 'x' } })
    })
    const testEvents = await testResponse.text()
    assert.equal(testResponse.status, 200)
    assert.match(testEvents, /event: result/)
    const testCall = calls.find(call => call[0] === 'callTool')
    assert.equal(testCall[3].userPermission, 'master')
    assert.equal(testCall[3].context.isAdminTest, true)

    const invalid = await request('/js', {
        method: 'POST',
        body: JSON.stringify({ name: 'invalid_tool', source: 'invalid' })
    })
    assert.equal(invalid.response.status, 400)
    assert.equal(invalid.body.data.code, 'CUSTOM_TOOL_SOURCE_INVALID')
})
