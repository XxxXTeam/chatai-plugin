/**
 * 模型可创建的自定义 JS 工具服务。
 *
 * 只接受结构化的 name/description/inputSchema/handlerCode，由本服务生成模块外壳，
 * 避免把任意顶层源码直接写入运行目录。写入流程为同目录临时文件、语法校验、
 * 原子替换、单飞热重载；重载失败时恢复旧文件。
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chatLogger as logger } from '../../core/utils/logger.js'
import config from '../../../config/config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_PLUGIN_ROOT = path.resolve(__dirname, '../../..')
const TOOL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * @typedef {Object} CustomToolServiceOptions
 * @property {string} [pluginRoot] - 插件根目录
 * @property {() => Promise<void>} [reloadHandler] - 自定义重载函数
 * @property {(name:string) => Promise<Object|Object[]|null>} [registryInspector] - 注册表检查函数
 * @property {(filename:string) => Promise<Object|null>} [sourceRegistryInspector] - 按文件名检查源码工具
 * @property {{get:(key?:string)=>*,set:(key:string,value:*)=>void}} [configStore] - 旧 customTools 配置存储
 */

export class CustomToolValidationError extends Error {
    /**
     * @param {string} message - 错误说明
     * @param {string} code - 稳定错误码
     */
    /** @type {string} */
    code

    constructor(message, code = 'CUSTOM_TOOL_INVALID') {
        super(message)
        this.name = 'CustomToolValidationError'
        this.code = code
    }
}

/**
 * 校验并归一化工具名。
 * 名称约束与当前文本工具调用解析器保持一致，确保所有协议及 JSON 兜底均可调用。
 * @param {*} value - 原始名称
 * @returns {string} 归一化名称
 */
export function validateCustomToolName(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new CustomToolValidationError('工具名不能为空', 'CUSTOM_TOOL_NAME_REQUIRED')
    }
    const name = value.trim()
    if (!TOOL_NAME_PATTERN.test(name)) {
        throw new CustomToolValidationError(
            '工具名必须以字母或下划线开头，且只能包含字母、数字和下划线',
            'CUSTOM_TOOL_NAME_INVALID'
        )
    }
    return name
}

/**
 * 校验工具参数 JSON Schema。
 * @param {*} value - 参数 schema
 * @returns {Object} 可序列化 schema
 */
export function validateCustomToolSchema(value) {
    const schema = value ?? { type: 'object', properties: {} }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
        throw new CustomToolValidationError('input_schema 必须是 JSON 对象', 'CUSTOM_TOOL_SCHEMA_INVALID')
    }
    if (schema.type !== undefined && schema.type !== 'object') {
        throw new CustomToolValidationError('input_schema.type 必须为 object', 'CUSTOM_TOOL_SCHEMA_INVALID')
    }
    if (
        schema.properties !== undefined &&
        (!schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties))
    ) {
        throw new CustomToolValidationError('input_schema.properties 必须是对象', 'CUSTOM_TOOL_SCHEMA_INVALID')
    }
    if (
        schema.required !== undefined &&
        (!Array.isArray(schema.required) || schema.required.some(name => typeof name !== 'string'))
    ) {
        throw new CustomToolValidationError('input_schema.required 必须是字符串数组', 'CUSTOM_TOOL_SCHEMA_INVALID')
    }
    try {
        return JSON.parse(JSON.stringify(schema))
    } catch (error) {
        throw new CustomToolValidationError(`input_schema 无法序列化: ${error.message}`, 'CUSTOM_TOOL_SCHEMA_INVALID')
    }
}

/**
 * 校验 async run 函数体语法。
 * @param {*} value - handler 函数体
 * @returns {string} 原始函数体
 */
export function validateCustomToolHandler(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new CustomToolValidationError('handler_code 不能为空', 'CUSTOM_TOOL_HANDLER_REQUIRED')
    }
    const code = value.trim()
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    try {
        // 仅编译函数体，不执行模型生成代码。
        new AsyncFunction('args', 'ctx', code)
    } catch (error) {
        throw new CustomToolValidationError(`handler_code 语法错误: ${error.message}`, 'CUSTOM_TOOL_HANDLER_SYNTAX')
    }
    return code
}

/**
 * 生成受控的自定义工具 ESM 源码。
 * @param {Object} definition - 工具定义
 * @returns {string} ESM 源码
 */
export function buildCustomToolSource(definition) {
    const name = validateCustomToolName(definition?.name)
    const description = String(definition?.description || '').trim()
    if (!description) {
        throw new CustomToolValidationError('description 不能为空', 'CUSTOM_TOOL_DESCRIPTION_REQUIRED')
    }
    const inputSchema = validateCustomToolSchema(definition?.inputSchema)
    const handlerCode = validateCustomToolHandler(definition?.handlerCode)

    return `/**
 * ${name} - 模型创建的自定义工具
 */
export default {
    name: ${JSON.stringify(name)},
    description: ${JSON.stringify(description)},
    inputSchema: ${JSON.stringify(inputSchema, null, 4)},
    dangerous: true,
    requireMaster: true,
    async run(args, ctx) {
        const masterState = typeof ctx?.isMaster === 'function' ? ctx.isMaster() : ctx?.isMaster
        if (masterState !== true) {
            return {
                content: [{ type: 'text', text: '该模型创建工具仅允许主人调用' }],
                isError: true
            }
        }

${handlerCode
    .split('\n')
    .map(line => `        ${line}`)
    .join('\n')}
    }
}
`
}

/**
 * 自定义工具持久化与热加载服务。
 */
export class CustomToolService {
    /**
     * @param {CustomToolServiceOptions} [options] - 服务选项
     * @param {string} [options.pluginRoot] - 插件根目录
     * @param {Function} [options.reloadHandler] - 测试或嵌入场景的重载函数
     */
    /** @type {string} */
    pluginRoot
    /** @type {string} */
    toolsDir
    /** @type {(() => Promise<void>)|null} */
    reloadHandler
    /** @type {((name:string) => Promise<Object|Object[]|null>)|null} */
    registryInspector
    /** @type {((filename:string) => Promise<Object|null>)|null} */
    sourceRegistryInspector
    /** @type {Promise<Object>|null} */
    reloadPromise
    /** @type {number} */
    registryVersion
    /** @type {{get:(key?:string)=>*,set:(key:string,value:*)=>void}} */
    configStore

    constructor(options = {}) {
        this.pluginRoot = path.resolve(options.pluginRoot || DEFAULT_PLUGIN_ROOT)
        this.toolsDir = path.resolve(this.pluginRoot, 'data/tools')
        this.reloadHandler = options.reloadHandler || null
        this.registryInspector = options.registryInspector || null
        this.sourceRegistryInspector = options.sourceRegistryInspector || null
        this.configStore = options.configStore || config
        this.reloadPromise = null
        this.registryVersion = 0
    }

    /**
     * 读取旧版 config.yaml customTools 数组。
     * 该入口只负责兼容持久化格式，不把旧工具误当作模型生成的 JS 工具。
     * @returns {Array<Object>} 配置型自定义工具
     */
    listConfiguredTools() {
        const tools = this.configStore.get('customTools')
        return Array.isArray(tools) ? tools : []
    }

    /**
     * 创建旧版配置型工具，保留原有字段及默认值契约。
     * @param {Object} definition - 配置型工具定义
     * @returns {Object} 已写入的工具
     */
    createConfiguredTool(definition = {}) {
        const { name, description, parameters, handler } = definition
        if (!name) {
            throw new CustomToolValidationError('name is required', 'CUSTOM_TOOL_NAME_REQUIRED')
        }
        const customTools = this.listConfiguredTools()
        if (customTools.some(tool => tool?.name === name)) {
            throw new CustomToolValidationError('Tool already exists', 'CUSTOM_TOOL_EXISTS')
        }
        const tool = {
            name,
            description: description || '',
            parameters: parameters || { type: 'object', properties: {}, required: [] },
            handler: handler || 'function',
            custom: true,
            createdAt: Date.now()
        }
        this.configStore.set('customTools', [...customTools, tool])
        return tool
    }

    /**
     * 更新旧版配置型工具，按历史接口只更新 truthy 字段。
     * @param {*} rawName - 工具名
     * @param {Object} patch - 可更新字段
     * @returns {Object} 更新后的工具
     */
    updateConfiguredTool(rawName, patch = {}) {
        const customTools = this.listConfiguredTools()
        const index = customTools.findIndex(tool => tool?.name === rawName)
        if (index === -1) {
            throw new CustomToolValidationError('Tool not found', 'CUSTOM_TOOL_NOT_FOUND')
        }
        const tool = { ...customTools[index] }
        const { description, parameters, handler } = patch
        if (description) tool.description = description
        if (parameters) tool.parameters = parameters
        if (handler) tool.handler = handler
        tool.updatedAt = Date.now()
        customTools[index] = tool
        this.configStore.set('customTools', customTools)
        return tool
    }

    /**
     * 删除旧版配置型工具。
     * @param {*} rawName - 工具名
     * @returns {{success:boolean,name:*}} 删除结果
     */
    deleteConfiguredTool(rawName) {
        const customTools = this.listConfiguredTools()
        const filtered = customTools.filter(tool => tool?.name !== rawName)
        if (filtered.length === customTools.length) {
            throw new CustomToolValidationError('Tool not found', 'CUSTOM_TOOL_NOT_FOUND')
        }
        this.configStore.set('customTools', filtered)
        return { success: true, name: rawName }
    }

    /**
     * 列出已加载的完整源码工具，统一 /api/tools/js 的读取入口。
     * @returns {Promise<Array<Object>>} 工具文件元数据
     */
    async listSources() {
        const { mcpManager } = await import('../../mcp/McpManager.js')
        const { builtinMcpServer } = await import('../../mcp/BuiltinMcpServer.js')
        await mcpManager.init()
        await builtinMcpServer.init()
        fs.mkdirSync(this.toolsDir, { recursive: true })

        const sources = []
        for (const [toolName, tool] of builtinMcpServer.jsTools || new Map()) {
            const filename = tool.__filename || `${toolName}.js`
            const filePath = path.join(this.toolsDir, filename)
            let stat = { size: 0, mtimeMs: 0 }
            try {
                stat = fs.statSync(filePath)
            } catch {}
            sources.push({
                name: toolName,
                filename,
                description: tool.description || tool.function?.description || '',
                size: stat.size,
                modifiedAt: stat.mtimeMs
            })
        }
        return sources
    }

    /**
     * 获取经过目录边界校验的工具路径。
     * @param {string} rawName - 工具名
     * @returns {{name:string, filePath:string}} 工具名与绝对路径
     */
    resolveToolPath(rawName) {
        const name = validateCustomToolName(rawName)
        const filePath = path.resolve(this.toolsDir, `${name}.js`)
        if (!filePath.startsWith(this.toolsDir + path.sep)) {
            throw new CustomToolValidationError('工具路径越界', 'CUSTOM_TOOL_PATH_INVALID')
        }
        return { name, filePath }
    }

    /**
     * 按旧 Web API 的文件名契约解析完整源码文件，同时保持目录边界。
     * @param {*} rawName - 文件名或不带扩展名的文件键
     * @returns {{name:string,filename:string,filePath:string}} 文件信息
     */
    resolveSourcePath(rawName) {
        if (typeof rawName !== 'string' || !rawName.trim()) {
            throw new CustomToolValidationError('工具文件名不能为空', 'CUSTOM_TOOL_NAME_REQUIRED')
        }
        const trimmed = rawName.trim()
        if (/[/\\]/.test(trimmed) || trimmed.includes('..')) {
            throw new CustomToolValidationError('工具文件路径越界', 'CUSTOM_TOOL_PATH_INVALID')
        }
        const filename = trimmed.endsWith('.js') ? trimmed : `${trimmed}.js`
        if (!/^[\w.-]+\.js$/.test(filename)) {
            throw new CustomToolValidationError('工具文件名包含非法字符', 'CUSTOM_TOOL_NAME_INVALID')
        }
        if (filename.toLowerCase() === 'customtool.js') {
            throw new CustomToolValidationError('CustomTool.js 是受保护的运行时模板', 'CUSTOM_TOOL_PROTECTED')
        }
        const filePath = path.resolve(this.toolsDir, filename)
        if (!filePath.startsWith(this.toolsDir + path.sep)) {
            throw new CustomToolValidationError('工具文件路径越界', 'CUSTOM_TOOL_PATH_INVALID')
        }
        return { name: filename.slice(0, -3), filename, filePath }
    }

    /**
     * 以不跟随符号链接的方式读取受管工具源码。
     * @param {*} rawName - 文件名或不带扩展名的文件键
     * @returns {{name:string,filename:string,source:string,size:number,modifiedAt:number}}
     */
    readSource(rawName) {
        const { name, filename, filePath } = this.resolveSourcePath(rawName)
        let descriptor = null
        try {
            const initial = fs.lstatSync(filePath)
            if (initial.isSymbolicLink() || !initial.isFile()) {
                throw new CustomToolValidationError(`工具文件 "${filename}" 不是普通文件`, 'CUSTOM_TOOL_FILE_INVALID')
            }

            descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
            const stat = fs.fstatSync(descriptor)
            if (!stat.isFile()) {
                throw new CustomToolValidationError(`工具文件 "${filename}" 不是普通文件`, 'CUSTOM_TOOL_FILE_INVALID')
            }

            const realToolsDir = fs.realpathSync(this.toolsDir)
            let realFilePath
            try {
                realFilePath = fs.realpathSync(`/proc/self/fd/${descriptor}`)
            } catch {
                realFilePath = fs.realpathSync(filePath)
            }
            const relative = path.relative(realToolsDir, realFilePath)
            if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                throw new CustomToolValidationError('工具源码真实路径越界', 'CUSTOM_TOOL_PATH_INVALID')
            }

            return {
                name,
                filename,
                source: fs.readFileSync(descriptor, 'utf8'),
                size: stat.size,
                modifiedAt: stat.mtimeMs
            }
        } catch (error) {
            if (error instanceof CustomToolValidationError) throw error
            if (error?.code === 'ENOENT') {
                throw new CustomToolValidationError(`工具文件 "${filename}" 不存在`, 'CUSTOM_TOOL_NOT_FOUND')
            }
            throw new CustomToolValidationError(`读取工具源码失败: ${error.message}`, 'CUSTOM_TOOL_FILE_INVALID')
        } finally {
            if (descriptor !== null) {
                try {
                    fs.closeSync(descriptor)
                } catch {}
            }
        }
    }

    /**
     * 单飞刷新 MCP 与 Skills 工具注册表。
     * @returns {Promise<Object>} 重载结果
     */
    async reload() {
        if (this.reloadPromise) return await this.reloadPromise

        this.reloadPromise = (async () => {
            if (this.reloadHandler) {
                await this.reloadHandler()
            } else {
                const { mcpManager } = await import('../../mcp/McpManager.js')
                await mcpManager.reloadJsTools()
                const loader = global.chatAiSkillsLoader
                if (loader?.initialized && typeof loader.loadAll === 'function') {
                    await loader.loadAll()
                }
            }
            this.registryVersion += 1
            return { success: true, version: this.registryVersion }
        })()

        try {
            return await this.reloadPromise
        } finally {
            this.reloadPromise = null
        }
    }

    /**
     * 创建或更新工具，并在热加载失败时恢复原文件。
     * @param {Object} definition - 工具定义
     * @param {boolean} [definition.overwrite=false] - 是否覆盖
     * @returns {Promise<Object>} 写入结果
     */
    /**
     * 读取当前工具注册表中的同名定义。
     * @param {string} name - 工具名
     * @returns {Promise<Object[]>} 同名工具列表
     */
    async getRegisteredToolsByName(name) {
        if (this.registryInspector) {
            const inspected = await this.registryInspector(name)
            return Array.isArray(inspected) ? inspected : inspected ? [inspected] : []
        }
        if (this.reloadHandler) return []
        const { mcpManager } = await import('../../mcp/McpManager.js')
        return /** @type {any} */ (mcpManager)
            .getTools({ applyConfig: false, includeDuplicateNames: true })
            .filter(tool => tool.name === name)
    }

    /**
     * 断言新版本已经进入 custom-tools 注册表且 schema 一致。
     * @param {string} name - 工具名
     * @param {Object} inputSchema - 预期 schema
     * @returns {Promise<Object>} 已注册工具
     */
    async assertToolLoaded(name, inputSchema) {
        if (this.registryInspector) {
            const inspected = await this.registryInspector(name)
            const tool = Array.isArray(inspected)
                ? inspected.find(item => item?.serverName === 'custom-tools' && item?.isJsTool === true)
                : inspected
            if (!tool || tool.isJsTool !== true || tool.name !== name) {
                throw new Error(`工具 "${name}" 热加载后未注册`)
            }
            if (JSON.stringify(tool.inputSchema || {}) !== JSON.stringify(inputSchema || {})) {
                throw new Error(`工具 "${name}" 热加载后的 inputSchema 与写入定义不一致`)
            }
            return tool
        }
        if (this.reloadHandler) return { name, inputSchema, isJsTool: true, serverName: 'custom-tools' }

        const { mcpManager } = await import('../../mcp/McpManager.js')
        const tool = mcpManager.getTool(name, { serverName: 'custom-tools' })
        if (!tool || tool.isJsTool !== true || tool.serverName !== 'custom-tools' || tool.name !== name) {
            throw new Error(`工具 "${name}" 热加载后未进入 custom-tools 注册表`)
        }
        if (JSON.stringify(tool.inputSchema || {}) !== JSON.stringify(inputSchema || {})) {
            throw new Error(`工具 "${name}" 热加载后的 inputSchema 与写入定义不一致`)
        }
        return tool
    }

    /**
     * 按源码文件名读取刚完成热加载的工具。
     * @param {string} filename - data/tools 下的文件名
     * @returns {Promise<Object|null>} 已加载工具
     */
    async getLoadedSourceTool(filename) {
        if (this.sourceRegistryInspector) {
            return (await this.sourceRegistryInspector(filename)) || null
        }
        if (this.reloadHandler) return null
        const { builtinMcpServer } = await import('../../mcp/BuiltinMcpServer.js')
        for (const tool of builtinMcpServer.jsTools?.values?.() || []) {
            if (tool?.__filename === filename) return tool
        }
        return null
    }

    /**
     * 验证完整 ESM 源码已经按对应文件注册，并且没有占用其他来源的工具名。
     * @param {string} filename - 源码文件名
     * @returns {Promise<{tool:Object,name:string,inputSchema:Object}>} 注册结果
     */
    async assertSourceToolLoaded(filename) {
        const tool = await this.getLoadedSourceTool(filename)
        if (!tool || typeof tool.run !== 'function') {
            throw new CustomToolValidationError(
                `工具源码 ${filename} 热加载后未注册；必须默认导出包含 name、inputSchema 和 run() 的工具对象`,
                'CUSTOM_TOOL_SOURCE_INVALID'
            )
        }
        const name = validateCustomToolName(tool.name || tool.function?.name)
        const inputSchema = validateCustomToolSchema(
            tool.inputSchema || tool.function?.parameters || tool.parameters || { type: 'object', properties: {} }
        )
        const conflicts = (await this.getRegisteredToolsByName(name)).filter(
            item => !(item.serverName === 'custom-tools' && item.isJsTool === true)
        )
        if (conflicts.length > 0) {
            throw new CustomToolValidationError(
                `工具名 "${name}" 已被其他来源占用: ${conflicts
                    .map(item => item.identity || `${item.serverName || item.source || 'unknown'}:${item.name}`)
                    .join(', ')}`,
                'CUSTOM_TOOL_NAME_CONFLICT'
            )
        }
        return { tool, name, inputSchema }
    }

    /**
     * 原子创建或更新 Web 编辑器提交的完整 ESM 工具源码。
     * @param {string} rawName - 文件键
     * @param {string} source - 完整 ESM 源码
     * @param {Object} [options] - 写入选项
     * @param {boolean} [options.overwrite=false] - 是否覆盖既有文件
     * @returns {Promise<Object>} 写入与注册结果
     */
    async saveSource(rawName, source, options = {}) {
        const { name: fileKey, filename, filePath } = this.resolveSourcePath(rawName)
        if (typeof source !== 'string' || !source.trim()) {
            throw new CustomToolValidationError('source 不能为空', 'CUSTOM_TOOL_SOURCE_REQUIRED')
        }

        fs.mkdirSync(this.toolsDir, { recursive: true })
        const existed = fs.existsSync(filePath)
        if (!options.overwrite && existed) {
            throw new CustomToolValidationError(`工具文件 "${filename}" 已存在`, 'CUSTOM_TOOL_EXISTS')
        }
        if (options.overwrite && !existed) {
            throw new CustomToolValidationError(`工具文件 "${filename}" 不存在`, 'CUSTOM_TOOL_NOT_FOUND')
        }

        const nonce = `${process.pid}-${crypto.randomUUID()}`
        const tempPath = path.join(this.toolsDir, `.${fileKey}.${nonce}.tmp`)
        const backupPath = path.join(this.toolsDir, `.${fileKey}.${nonce}.bak`)
        let backedUp = false
        let targetInstalled = false

        try {
            fs.writeFileSync(tempPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
            if (existed) {
                fs.renameSync(filePath, backupPath)
                backedUp = true
            }
            fs.renameSync(tempPath, filePath)
            targetInstalled = true

            const reloadResult = await this.reload()
            const loaded = await this.assertSourceToolLoaded(filename)
            if (backedUp) {
                fs.rmSync(backupPath, { force: true })
                backedUp = false
            }
            return {
                success: true,
                name: loaded.name,
                filename,
                created: !existed,
                updated: existed,
                version: reloadResult.version,
                inputSchema: loaded.inputSchema
            }
        } catch (error) {
            fs.rmSync(tempPath, { force: true })
            if (targetInstalled) fs.rmSync(filePath, { force: true })
            if (backedUp) {
                try {
                    fs.renameSync(backupPath, filePath)
                    backedUp = false
                } catch (restoreFileError) {
                    throw new AggregateError(
                        [error, restoreFileError],
                        `工具源码更新失败，且旧文件恢复失败；备份保留在 ${backupPath}`
                    )
                }
            }
            try {
                await this.reload()
            } catch (restoreError) {
                logger.error('[CustomToolService] 回滚源码工具后的重载失败:', restoreError.message)
            }
            throw error
        } finally {
            fs.rmSync(tempPath, { force: true })
            if (!backedUp) fs.rmSync(backupPath, { force: true })
        }
    }

    /**
     * 按文件名原子删除完整源码工具；热加载失败时恢复原文件。
     * @param {string} rawName - 文件键
     * @returns {Promise<Object>} 删除结果
     */
    async deleteSource(rawName) {
        const { name: fileKey, filename, filePath } = this.resolveSourcePath(rawName)
        if (!fs.existsSync(filePath)) {
            throw new CustomToolValidationError(`工具文件 "${filename}" 不存在`, 'CUSTOM_TOOL_NOT_FOUND')
        }
        const loadedBefore = await this.getLoadedSourceTool(filename)
        const backupPath = path.join(this.toolsDir, `.${fileKey}.${process.pid}-${crypto.randomUUID()}.bak`)
        let backupAvailable = true
        fs.renameSync(filePath, backupPath)
        try {
            const reloadResult = await this.reload()
            if (await this.getLoadedSourceTool(filename)) {
                throw new Error(`工具源码 ${filename} 删除后仍在注册表中`)
            }
            fs.rmSync(backupPath, { force: true })
            backupAvailable = false
            return {
                success: true,
                name: loadedBefore?.name || fileKey,
                filename,
                deleted: true,
                version: reloadResult.version
            }
        } catch (error) {
            try {
                fs.renameSync(backupPath, filePath)
                backupAvailable = false
            } catch (restoreFileError) {
                throw new AggregateError(
                    [error, restoreFileError],
                    `工具源码删除失败，且旧文件恢复失败；备份保留在 ${backupPath}`
                )
            }
            try {
                await this.reload()
            } catch (restoreError) {
                logger.error('[CustomToolService] 恢复被删源码工具后的重载失败:', restoreError.message)
            }
            throw error
        } finally {
            if (!backupAvailable) fs.rmSync(backupPath, { force: true })
        }
    }

    async saveTool(definition) {
        const { name, filePath } = this.resolveToolPath(definition?.name)
        const inputSchema = validateCustomToolSchema(definition?.inputSchema)
        const source = buildCustomToolSource({ ...definition, name, inputSchema })
        const overwrite = definition?.overwrite === true

        fs.mkdirSync(this.toolsDir, { recursive: true })
        const existed = fs.existsSync(filePath)
        const registered = await this.getRegisteredToolsByName(name)
        const registeredCustom = registered.find(tool => tool.serverName === 'custom-tools' && tool.isJsTool === true)
        const conflicts = registered.filter(tool => !(tool.serverName === 'custom-tools' && tool.isJsTool === true))

        if (conflicts.length > 0) {
            throw new CustomToolValidationError(
                `工具名 "${name}" 已被其他来源占用: ${conflicts
                    .map(tool => tool.identity || `${tool.serverName || tool.source || 'unknown'}:${tool.name}`)
                    .join(', ')}`,
                'CUSTOM_TOOL_NAME_CONFLICT'
            )
        }
        if (!overwrite && (existed || registeredCustom)) {
            throw new CustomToolValidationError(`工具 "${name}" 已存在`, 'CUSTOM_TOOL_EXISTS')
        }
        if (overwrite && (!existed || !registeredCustom)) {
            throw new CustomToolValidationError(
                `仅允许更新已注册的 custom-tools JS 工具 "${name}"`,
                'CUSTOM_TOOL_UPDATE_TARGET_INVALID'
            )
        }

        const nonce = `${process.pid}-${crypto.randomUUID()}`
        const tempPath = path.join(this.toolsDir, `.${name}.${nonce}.tmp`)
        const backupPath = path.join(this.toolsDir, `.${name}.${nonce}.bak`)
        let backedUp = false
        let targetInstalled = false

        try {
            fs.writeFileSync(tempPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
            if (existed) {
                fs.renameSync(filePath, backupPath)
                backedUp = true
            }
            fs.renameSync(tempPath, filePath)
            targetInstalled = true

            const reloadResult = await this.reload()
            await this.assertToolLoaded(name, inputSchema)
            if (backedUp) {
                fs.rmSync(backupPath, { force: true })
                backedUp = false
            }

            return {
                success: true,
                name,
                filename: path.basename(filePath),
                created: !existed,
                updated: existed,
                version: reloadResult.version
            }
        } catch (error) {
            fs.rmSync(tempPath, { force: true })
            if (targetInstalled) fs.rmSync(filePath, { force: true })
            if (backedUp) {
                try {
                    fs.renameSync(backupPath, filePath)
                    backedUp = false
                } catch (restoreFileError) {
                    throw new AggregateError(
                        [error, restoreFileError],
                        `工具更新失败，且旧文件恢复失败；备份保留在 ${backupPath}`
                    )
                }
            }
            try {
                await this.reload()
            } catch (restoreError) {
                logger.error('[CustomToolService] 回滚工具后的重载失败:', restoreError.message)
            }
            throw error
        } finally {
            fs.rmSync(tempPath, { force: true })
            if (!backedUp) fs.rmSync(backupPath, { force: true })
        }
    }

    /**
     * 删除工具；重载失败则恢复。
     * @param {string} rawName - 工具名
     * @returns {Promise<Object>} 删除结果
     */
    async deleteTool(rawName) {
        const { name, filePath } = this.resolveToolPath(rawName)
        const registered = await this.getRegisteredToolsByName(name)
        const custom = registered.find(tool => tool.serverName === 'custom-tools' && tool.isJsTool === true)
        const conflict = registered.find(tool => !(tool.serverName === 'custom-tools' && tool.isJsTool === true))
        if (conflict || !custom) {
            throw new CustomToolValidationError(
                `仅允许删除已注册的 custom-tools JS 工具 "${name}"`,
                'CUSTOM_TOOL_DELETE_TARGET_INVALID'
            )
        }
        if (!fs.existsSync(filePath)) {
            throw new CustomToolValidationError(`工具 "${name}" 不存在`, 'CUSTOM_TOOL_NOT_FOUND')
        }

        const backupPath = path.join(this.toolsDir, `.${name}.${process.pid}-${crypto.randomUUID()}.bak`)
        fs.renameSync(filePath, backupPath)
        try {
            const reloadResult = await this.reload()
            fs.rmSync(backupPath, { force: true })
            return { success: true, name, deleted: true, version: reloadResult.version }
        } catch (error) {
            fs.renameSync(backupPath, filePath)
            try {
                await this.reload()
            } catch (restoreError) {
                logger.error('[CustomToolService] 恢复被删工具后的重载失败:', restoreError.message)
            }
            throw error
        }
    }

    /**
     * 立即调用已加载的模型自定义工具。
     * @param {string} rawName - 工具名
     * @param {Object} args - 工具参数
     * @param {Object} ctx - 当前工具上下文
     * @returns {Promise<*>} MCP 工具结果
     */
    async invokeTool(rawName, args, ctx) {
        const masterState = typeof ctx?.isMaster === 'function' ? ctx.isMaster() : ctx?.isMaster
        if (masterState !== true) {
            throw new CustomToolValidationError('调用模型自定义工具需要经过主人鉴权', 'CUSTOM_TOOL_MASTER_REQUIRED')
        }

        const { name } = this.resolveToolPath(rawName)
        const { mcpManager } = await import('../../mcp/McpManager.js')
        const tool = mcpManager.getTool(name, { serverName: 'custom-tools' })
        if (!tool || tool.isJsTool !== true || tool.serverName !== 'custom-tools' || tool.name !== name) {
            throw new CustomToolValidationError(`工具 "${name}" 尚未加载`, 'CUSTOM_TOOL_NOT_LOADED')
        }

        const event = ctx?.getEvent?.() || ctx?.event || null
        const bot = ctx?.getBot?.() || ctx?.bot || event?.bot || null
        const adapterInfo = ctx?.getAdapter?.() || ctx?.adapterInfo || null
        const context = event ? { event, bot, adapterInfo } : { isMaster: true, bot, adapterInfo }
        return await mcpManager.callTool(name, args || {}, {
            serverName: 'custom-tools',
            userPermission: 'master',
            context
        })
    }
}

/**
 * 返回旧版配置型工具的只读快照，供 MCP 注册表统一消费。
 * @param {{get:(key?:string)=>*}} [configStore] - 配置存储
 * @returns {Array<Object>} 配置型工具快照
 */
export function getConfiguredCustomTools(configStore = config) {
    const tools = configStore.get('customTools')
    return Array.isArray(tools) ? tools.map(tool => ({ ...tool })) : []
}

export const customToolService = new CustomToolService()
export default customToolService
