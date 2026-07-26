import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger
const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', '.next', 'dist', 'build', 'coverage'])

// 目录内被识别为“文件夹型 skill 定义”的固定文件名
const FOLDER_SKILL_FILES = new Set(['skill.yaml', 'skill.yml', 'skill.json'])

// skill 包内的标准子目录（Agent Skills 规范）
// references: 详细文档，按需读取；assets: 模板与静态资源；scripts: 可执行脚本（当前仅列出，不执行）
const SKILL_PACKAGE_DIRS = ['references', 'assets', 'scripts']

// 单个 skill 包最多收录的附属文件数，避免超大目录拖慢加载与撑爆提示词
const MAX_PACKAGE_FILES = 50

// 附属文件递归深度上限（相对于包根目录）
const MAX_PACKAGE_DEPTH = 3

// 单个扫描根允许访问的目录总数上限，防止 documents.paths 指向超大目录树时耗尽 IO
const MAX_SCAN_DIRECTORIES = 1000

/*
 * 面板允许改写的附属文件扩展名白名单。
 *
 * 只放纯文本类：references/ 与 assets/ 的实际用途是文档与模板。scripts/ 下的脚本
 * 刻意不在白名单内 —— 当前实现只列出脚本、不执行它们，开放改写等于把面板变成一个
 * 往磁盘落可执行文件的通道，收益为零而风险不为零。
 */
const EDITABLE_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.json'])

/**
 * 判断附属文件是否允许通过面板改写
 * @param {string} relativePath - 相对包根目录的文件路径
 * @returns {boolean} 是否允许写入
 */
export function isEditableSkillFile(relativePath) {
    return EDITABLE_FILE_EXTENSIONS.has(path.extname(String(relativePath || '')).toLowerCase())
}

/**
 * 校验待写入的 skill 定义内容能否被正常解析
 *
 * frontmatter 一旦有 YAML 语法错误，parseSkillMarkdown 只会打一条 warn 并返回空元数据，
 * 于是技能名回退成目录名、description/triggers 全部丢失 —— 表现为技能「改名」或从匹配
 * 逻辑里消失，而文件本身看起来还在。写入前先解析一遍，把这种损坏挡在落盘之前。
 * @param {'markdown'|'yaml'|'json'} type - 定义文件类型
 * @param {string} content - 待写入的完整文件内容
 * @returns {{valid: boolean, error?: string, metadata?: object}} 校验结果，valid 为 true 时带回解析出的元数据
 */
export function validateSkillSource(type, content) {
    if (typeof content !== 'string') {
        return { valid: false, error: '内容必须是字符串' }
    }
    if (!content.trim()) {
        return { valid: false, error: '内容不能为空' }
    }

    if (type === 'markdown') {
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
        if (!match) {
            return { valid: false, error: 'SKILL.md 必须以 --- 包裹的 YAML frontmatter 开头' }
        }
        let metadata
        try {
            metadata = YAML.parse(match[1])
        } catch (error) {
            return { valid: false, error: `frontmatter YAML 解析失败: ${error.message}` }
        }
        if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
            return { valid: false, error: 'frontmatter 顶层必须是键值对象' }
        }
        if (typeof metadata.name !== 'string' || !metadata.name.trim()) {
            return { valid: false, error: 'frontmatter 缺少有效的 name 字段' }
        }
        return { valid: true, metadata }
    }

    let metadata
    try {
        metadata = type === 'json' ? JSON.parse(content) : YAML.parse(content)
    } catch (error) {
        return { valid: false, error: `${type === 'json' ? 'JSON' : 'YAML'} 解析失败: ${error.message}` }
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return { valid: false, error: 'skill 定义顶层必须是键值对象' }
    }
    return { valid: true, metadata }
}

/**
 * 判断文件名是否为可识别的 skill 定义文件，并返回其类型
 * @param {string} fileName - 文件名（basename）
 * @returns {'markdown'|'yaml'|'json'|null} skill 文件类型，非 skill 文件返回 null
 */
function classifySkillFile(fileName) {
    if (fileName === 'SKILL.md') return 'markdown'
    if (/\.skill\.ya?ml$/i.test(fileName)) return 'yaml'
    if (/\.skill\.json$/i.test(fileName)) return 'json'
    const lower = fileName.toLowerCase()
    if (lower === 'skill.yaml' || lower === 'skill.yml') return 'yaml'
    if (lower === 'skill.json') return 'json'
    return null
}

/**
 * 判断 skill 定义文件是否构成一个「包」
 *
 * 固定名（SKILL.md / skill.yaml / skill.yml / skill.json）所在的目录即为包根，
 * 其下的 references/ assets/ scripts/ 属于该技能的附属资源；
 * 带前缀的散文件（如 foo.skill.yaml）不构成包，仅是单文件技能。
 * @param {string} filePath - skill 定义文件绝对路径
 * @returns {boolean} 是否为包形式
 */
function isPackageSkill(filePath) {
    const fileName = path.basename(filePath)
    return fileName === 'SKILL.md' || FOLDER_SKILL_FILES.has(fileName.toLowerCase())
}

/**
 * 收集 skill 包内的附属文件清单（references/ assets/ scripts/）
 *
 * 只遍历包根下这三个固定子目录，不会扫描包根本身的其他内容，因此不存在越界风险。
 * 返回的是相对包根的路径，供 LLM 通过 read_skill_file 工具按需读取。
 * @param {string} packageRoot - 包根目录绝对路径
 * @returns {Array<{path: string, size: number, dir: string}>} 附属文件清单
 */
function collectPackageFiles(packageRoot) {
    const files = []

    for (const subDir of SKILL_PACKAGE_DIRS) {
        const dirPath = path.join(packageRoot, subDir)
        let dirStat = null
        try {
            dirStat = fs.statSync(dirPath)
        } catch {
            continue
        }
        if (!dirStat.isDirectory()) continue

        const stack = [{ dir: dirPath, depth: 0 }]
        while (stack.length > 0 && files.length < MAX_PACKAGE_FILES) {
            const current = stack.pop()
            let entries = []
            try {
                entries = fs.readdirSync(current.dir, { withFileTypes: true })
            } catch (error) {
                logger.debug(`[SkillDocumentLoader] 读取 skill 包子目录失败: ${current.dir}, ${error.message}`)
                continue
            }

            for (const entry of entries) {
                if (files.length >= MAX_PACKAGE_FILES) break
                const fullPath = path.join(current.dir, entry.name)

                if (entry.isFile()) {
                    let size = 0
                    try {
                        size = fs.statSync(fullPath).size
                    } catch {
                        continue
                    }
                    files.push({
                        path: path.relative(packageRoot, fullPath).replace(/\\/g, '/'),
                        size,
                        dir: subDir
                    })
                } else if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name) && current.depth < MAX_PACKAGE_DEPTH) {
                    stack.push({ dir: fullPath, depth: current.depth + 1 })
                }
            }
        }
    }

    return files
}

/**
 * 从 skill 定义文件名推导默认 skill 名称
 * @param {string} filePath - skill 文件绝对路径
 * @param {'markdown'|'yaml'|'json'} type - skill 文件类型
 * @returns {string} 默认名称（去除 skill 后缀，或回退到所在目录名）
 */
function deriveDefaultName(filePath, type) {
    const fileName = path.basename(filePath)
    const lower = fileName.toLowerCase()
    // 命名型定义 <name>.skill.yaml / <name>.skill.json 直接取前缀
    const namedMatch = fileName.match(/^(.+)\.skill\.(?:ya?ml|json)$/i)
    if (namedMatch && namedMatch[1].trim()) {
        return namedMatch[1].trim()
    }
    // SKILL.md / skill.yaml / skill.json 这类固定名，回退到目录名
    if (type === 'markdown' || lower === 'skill.yaml' || lower === 'skill.yml' || lower === 'skill.json') {
        return path.basename(path.dirname(filePath))
    }
    return path.basename(fileName, path.extname(fileName))
}

function parseSkillMarkdown(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    if (!match) {
        return { metadata: {}, body: content }
    }

    let metadata = {}
    try {
        const parsed = YAML.parse(match[1])
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            metadata = parsed
        }
    } catch (error) {
        logger.warn(`[SkillDocumentLoader] SKILL.md frontmatter 解析失败: ${error.message}`)
    }

    return { metadata, body: content.slice(match[0].length) }
}

/**
 * 解析 documents.paths 中配置的扫描路径，并强制约束在插件根目录内
 *
 * 扫描命中的 SKILL.md 正文会被 buildInstructions 注入 LLM system prompt，
 * 因此必须拒绝逃逸插件根目录的配置（如 '/' 或 '../../'），避免任意文件内容进入提示词
 * @param {string} pluginRoot - 插件根目录绝对路径
 * @param {string} configuredPath - 配置项中的路径，可为相对或绝对路径
 * @returns {string|null} 规范化后的绝对路径；配置无效或越界时返回 null
 */
function resolvePath(pluginRoot, configuredPath) {
    if (!configuredPath || typeof configuredPath !== 'string') return null
    if (!pluginRoot || typeof pluginRoot !== 'string') return null
    const trimmed = configuredPath.trim()
    if (!trimmed) return null

    const root = path.resolve(pluginRoot)
    const resolved = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(root, trimmed)

    const relative = path.relative(root, resolved)
    const escapesRoot = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
    if (escapesRoot) {
        logger.warn(`[SkillDocumentLoader] 忽略插件根目录之外的扫描路径: ${configuredPath}`)
        return null
    }

    return resolved
}

function relativeToPlugin(pluginRoot, filePath) {
    const relativePath = path.relative(pluginRoot, filePath)
    if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
        return relativePath.replace(/\\/g, '/')
    }
    return filePath
}

function toStringList(value) {
    if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean)
    if (typeof value === 'string' && value.trim()) return [value.trim()]
    return []
}

function normalizeSearchText(value) {
    return String(value || '').toLowerCase()
}

function normalizeDocumentOptions(options = {}, config = {}) {
    return {
        selectedNames: Array.isArray(options.selectedNames)
            ? new Set(options.selectedNames.filter(Boolean).map(String))
            : null,
        mode: options.mode || config.mode || 'auto',
        contextText: normalizeSearchText(
            options.contextText || options.message || options.userMessage || options.query || ''
        )
    }
}

function matchesDocument(document, normalizedOptions) {
    const { selectedNames, mode, contextText } = normalizedOptions
    if (selectedNames && (selectedNames.has(document.name) || selectedNames.has(document.relativePath))) {
        return true
    }
    if (mode === 'explicit') return false
    if (mode === 'all') return !selectedNames
    if (!contextText) return false

    const terms = [document.name, document.description, document.relativePath, ...toStringList(document.triggers)]
        .map(normalizeSearchText)
        .filter(Boolean)

    return terms.some(term => contextText.includes(term))
}

class SkillDocumentLoader {
    constructor() {
        this.documents = []
        this.initialized = false
        this.pluginRoot = null
        this.skillsConfig = null
    }

    async init(pluginRoot, skillsConfig) {
        this.pluginRoot = pluginRoot
        this.skillsConfig = skillsConfig
        await this.load()
        this.initialized = true
        return this
    }

    async load() {
        this.documents = []
        const config = this.skillsConfig?.getDocumentSkillsConfig?.() || {}
        if (config.enabled === false) {
            return
        }

        const paths = Array.isArray(config.paths) ? config.paths : []
        const maxDepth = Number.isFinite(config.maxDepth) ? config.maxDepth : 6
        const maxFileBytes = Number.isFinite(config.maxFileBytes) ? config.maxFileBytes : 65536
        const seenFiles = new Set()

        for (const configuredPath of paths) {
            const root = resolvePath(this.pluginRoot, configuredPath)
            if (!root || !fs.existsSync(root)) continue

            for (const filePath of this.findSkillFiles(root, maxDepth)) {
                let realPath = filePath
                try {
                    realPath = fs.realpathSync(filePath)
                } catch {}
                if (seenFiles.has(realPath)) continue
                seenFiles.add(realPath)

                const document = this.readSkillFile(filePath, maxFileBytes)
                if (document) {
                    this.documents.push(document)
                }
            }
        }

        logger.debug(`[SkillDocumentLoader] 加载文档技能: ${this.documents.length} 个`)
    }

    /**
     * 递归查找扫描根下的 skill 定义文件
     * @param {string} root - 扫描根（文件或目录）的绝对路径
     * @param {number} maxDepth - 目录递归最大深度
     * @returns {string[]} 命中的 skill 文件绝对路径列表
     */
    findSkillFiles(root, maxDepth) {
        const files = []
        const stat = fs.statSync(root)
        if (stat.isFile()) {
            if (classifySkillFile(path.basename(root))) files.push(root)
            return files
        }
        if (!stat.isDirectory()) return files

        const stack = [{ dir: root, depth: 0 }]
        let visitedDirectories = 0
        while (stack.length > 0) {
            const current = stack.pop()
            if (!current || current.depth > maxDepth) continue

            if (visitedDirectories >= MAX_SCAN_DIRECTORIES) {
                logger.warn(`[SkillDocumentLoader] 已访问目录数达到上限 ${MAX_SCAN_DIRECTORIES}，停止扫描: ${root}`)
                break
            }
            visitedDirectories++

            let entries = []
            try {
                entries = fs.readdirSync(current.dir, { withFileTypes: true })
            } catch (error) {
                logger.debug(`[SkillDocumentLoader] 读取目录失败: ${current.dir}, ${error.message}`)
                continue
            }

            for (const entry of entries) {
                const fullPath = path.join(current.dir, entry.name)
                if (entry.isFile() && classifySkillFile(entry.name)) {
                    files.push(fullPath)
                } else if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name) && current.depth < maxDepth) {
                    stack.push({ dir: fullPath, depth: current.depth + 1 })
                }
            }
        }

        return files
    }

    /**
     * 读取单个 skill 定义文件，按扩展名分派到对应解析器
     * @param {string} filePath - skill 文件绝对路径
     * @param {number} maxFileBytes - 单文件最大字节数
     * @returns {object|null} 规范化后的 skill 文档对象，读取失败返回 null
     */
    readSkillFile(filePath, maxFileBytes) {
        const type = classifySkillFile(path.basename(filePath))
        if (type === 'yaml' || type === 'json') {
            return this.readSkillYamlJson(filePath, maxFileBytes, type)
        }
        return this.readSkillMarkdown(filePath, maxFileBytes)
    }

    /**
     * 解析 SKILL.md 格式技能（frontmatter + 正文）
     * @param {string} filePath - SKILL.md 绝对路径
     * @param {number} maxFileBytes - 单文件最大字节数
     * @returns {object|null} 规范化 skill 文档，失败返回 null
     */
    readSkillMarkdown(filePath, maxFileBytes) {
        try {
            const stat = fs.statSync(filePath)
            if (stat.size > maxFileBytes) {
                logger.warn(`[SkillDocumentLoader] 跳过过大的 SKILL.md: ${filePath}`)
                return null
            }

            const content = fs.readFileSync(filePath, 'utf-8')
            const { metadata, body } = parseSkillMarkdown(content)
            return this.buildDocument(filePath, metadata, body.trim(), 'markdown')
        } catch (error) {
            logger.warn(`[SkillDocumentLoader] 读取 SKILL.md 失败: ${filePath}, ${error.message}`)
            return null
        }
    }

    /**
     * 解析 YAML / JSON 格式技能定义文件
     * @param {string} filePath - skill 文件绝对路径
     * @param {number} maxFileBytes - 单文件最大字节数
     * @param {'yaml'|'json'} type - 文件类型
     * @returns {object|null} 规范化 skill 文档，失败返回 null
     */
    readSkillYamlJson(filePath, maxFileBytes, type) {
        try {
            const stat = fs.statSync(filePath)
            if (stat.size > maxFileBytes) {
                logger.warn(`[SkillDocumentLoader] 跳过过大的 skill 定义: ${filePath}`)
                return null
            }

            const content = fs.readFileSync(filePath, 'utf-8')
            const resolvedType = type || classifySkillFile(path.basename(filePath)) || 'yaml'
            let metadata
            if (resolvedType === 'json') {
                metadata = JSON.parse(content)
            } else {
                metadata = YAML.parse(content)
            }
            if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
                logger.warn(`[SkillDocumentLoader] skill 定义顶层需为对象: ${filePath}`)
                return null
            }

            // instructions 作为技能正文；兼容 body 字段
            const body =
                typeof metadata.instructions === 'string'
                    ? metadata.instructions.trim()
                    : typeof metadata.body === 'string'
                      ? metadata.body.trim()
                      : ''

            return this.buildDocument(filePath, metadata, body, resolvedType)
        } catch (error) {
            logger.warn(`[SkillDocumentLoader] 读取 skill 定义失败: ${filePath}, ${error.message}`)
            return null
        }
    }

    /**
     * 将解析出的元数据与正文规范化为统一的 skill 文档对象
     * @param {string} filePath - skill 文件绝对路径
     * @param {object} metadata - 解析出的元数据对象
     * @param {string} body - 技能正文/指令
     * @param {'markdown'|'yaml'|'json'} type - 来源文件类型
     * @returns {object} 规范化 skill 文档
     */
    buildDocument(filePath, metadata, body, type) {
        const directory = path.dirname(filePath)
        // 包形式的技能（SKILL.md / skill.yaml 等固定名），其所在目录即包根，
        // 附属资源（references/ assets/ scripts/）作为清单随文档一并记录，供按需读取
        const isPackage = isPackageSkill(filePath)
        const files = isPackage ? collectPackageFiles(directory) : []
        const name =
            typeof metadata.name === 'string' && metadata.name.trim()
                ? metadata.name.trim()
                : deriveDefaultName(filePath, type)
        const description =
            typeof metadata.description === 'string' && metadata.description.trim() ? metadata.description.trim() : ''
        const triggers = [
            ...toStringList(metadata.triggers),
            ...toStringList(metadata.trigger),
            ...toStringList(metadata.aliases),
            ...toStringList(metadata.alias)
        ]
        const allowedTools = [
            ...toStringList(metadata.allowedTools),
            ...toStringList(metadata.allowed_tools),
            ...toStringList(metadata['allowed-tools'])
        ]
        const disallowedTools = [
            ...toStringList(metadata.disallowedTools),
            ...toStringList(metadata.disallowed_tools),
            ...toStringList(metadata['disallowed-tools'])
        ]
        const capabilities = toStringList(metadata.capabilities)
        const priority = Number.isFinite(metadata.priority) ? metadata.priority : 0
        const autoActivate = metadata.autoActivate !== false

        return {
            name,
            description,
            triggers,
            allowedTools,
            disallowedTools,
            capabilities,
            priority,
            autoActivate,
            type,
            metadata,
            body,
            isPackage,
            files,
            path: filePath,
            relativePath: relativeToPlugin(this.pluginRoot, filePath),
            directory,
            loadedAt: Date.now()
        }
    }

    getDocuments() {
        return this.documents.map(document => ({ ...document }))
    }

    /**
     * 按名称或相对路径获取单个文档技能
     * @param {string} name - 技能名称或相对路径
     * @returns {object|null} 匹配的文档副本，未找到返回 null
     */
    getDocumentByName(name) {
        if (!name) return null
        const key = String(name).trim()
        const found = this.documents.find(doc => doc.name === key || doc.relativePath === key)
        return found ? { ...found } : null
    }

    /**
     * 读取 skill 包内的附属文件（references/ assets/ scripts/ 下的内容）
     *
     * 安全上采取双重校验，两道都通过才允许读取：
     * 1. 白名单——目标必须是扫描阶段由 collectPackageFiles 收录的文件，杜绝任意路径拼接；
     * 2. 真实路径前缀——用 fs.realpathSync 解析后仍须位于包根内，防止白名单条目本身是
     *    指向包外的符号链接。
     * @param {string} skillName - 技能名称或相对路径
     * @param {string} relativePath - 相对包根目录的文件路径
     * @param {number} [maxBytes] - 最大读取字节数，缺省取配置的 maxFileBytes
     * @returns {{content: string, path: string, size: number}|null} 文件内容；技能不存在、
     *          非包形式、文件未收录、路径越界或超出大小上限时返回 null
     */
    readPackageFile(skillName, relativePath, maxBytes) {
        const document = this.getDocumentByName(skillName)
        if (!document || !document.isPackage) return null
        if (!relativePath || typeof relativePath !== 'string') return null

        const normalized = relativePath.trim().replace(/\\/g, '/')
        const entry = (document.files || []).find(file => file.path === normalized)
        if (!entry) {
            logger.debug(`[SkillDocumentLoader] 附属文件不在收录清单中: ${skillName} -> ${relativePath}`)
            return null
        }

        let realRoot = ''
        let realTarget = ''
        try {
            realRoot = fs.realpathSync(path.resolve(document.directory))
            realTarget = fs.realpathSync(path.resolve(realRoot, normalized))
        } catch (error) {
            logger.debug(`[SkillDocumentLoader] 解析附属文件路径失败: ${relativePath}, ${error.message}`)
            return null
        }

        const relative = path.relative(realRoot, realTarget)
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            logger.warn(`[SkillDocumentLoader] 拒绝读取 skill 包之外的文件: ${skillName} -> ${relativePath}`)
            return null
        }

        const config = this.skillsConfig?.getDocumentSkillsConfig?.() || {}
        const limit = Number.isFinite(maxBytes)
            ? maxBytes
            : Number.isFinite(config.maxFileBytes)
              ? config.maxFileBytes
              : 65536

        try {
            const stat = fs.statSync(realTarget)
            if (stat.size > limit) {
                logger.warn(
                    `[SkillDocumentLoader] 附属文件超出大小上限，已拒绝: ${relativePath} (${stat.size} > ${limit})`
                )
                return null
            }
            return { content: fs.readFileSync(realTarget, 'utf8'), path: normalized, size: stat.size }
        } catch (error) {
            logger.warn(`[SkillDocumentLoader] 读取附属文件失败: ${relativePath}, ${error.message}`)
            return null
        }
    }

    /**
     * 获取当前生效的扫描根目录列表（均已通过插件根目录校验）
     *
     * 写入类操作必须以这些目录为边界。这里刻意复用 load() 用的同一个 resolvePath，
     * 避免出现「读取走一套边界、写入走另一套边界」这种最容易被绕过的不一致。
     * @returns {string[]} 扫描根绝对路径列表
     */
    getScanRoots() {
        const config = this.skillsConfig?.getDocumentSkillsConfig?.() || {}
        const paths = Array.isArray(config.paths) ? config.paths : []
        const roots = []
        for (const configuredPath of paths) {
            const root = resolvePath(this.pluginRoot, configuredPath)
            if (root) roots.push(root)
        }
        return roots
    }

    /**
     * 判断真实路径是否位于某个扫描根之内
     * @param {string} realTarget - 已由 realpath 解析过的绝对路径
     * @returns {boolean} 是否落在扫描根内
     */
    isWithinScanRoots(realTarget) {
        for (const root of this.getScanRoots()) {
            let realRoot = ''
            try {
                realRoot = fs.realpathSync(root)
            } catch {
                continue
            }
            const relative = path.relative(realRoot, realTarget)
            if (relative === '') return true
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) return true
        }
        return false
    }

    /**
     * 获取压缩包导入的目标根目录（documents.paths 的首个有效项），目录不存在时创建
     * @returns {string|null} 导入根绝对路径；无可用配置路径或创建失败时返回 null
     */
    getImportRoot() {
        const roots = this.getScanRoots()
        if (roots.length === 0) return null
        const target = roots[0]
        try {
            fs.mkdirSync(target, { recursive: true })
        } catch (error) {
            logger.warn(`[SkillDocumentLoader] 创建导入目录失败: ${target}, ${error.message}`)
            return null
        }
        return target
    }

    /**
     * 取单文件字节上限，缺省回落到 documents.maxFileBytes
     * @returns {number} 字节上限
     */
    getMaxFileBytes() {
        const config = this.skillsConfig?.getDocumentSkillsConfig?.() || {}
        return Number.isFinite(config.maxFileBytes) ? config.maxFileBytes : 65536
    }

    /**
     * 校验写入目标并返回其真实路径
     *
     * 三道校验缺一不可：
     * 1. 目标必须来自扫描结果（document.path / files 白名单），杜绝由入参拼路径；
     * 2. realpath 解析后仍须落在扫描根内，防止白名单条目本身是指向外部的符号链接；
     * 3. 内容字节数不超过 maxFileBytes，避免写进一个下次加载时会被直接跳过的大文件。
     * @param {string} targetPath - 目标文件绝对路径（取自扫描结果，非用户拼接）
     * @param {string} content - 待写入内容
     * @returns {{ok: true, realPath: string}|{ok: false, error: string}} 校验结果
     * @private
     */
    _prepareWrite(targetPath, content) {
        let realPath = ''
        try {
            realPath = fs.realpathSync(path.resolve(targetPath))
        } catch (error) {
            return { ok: false, error: `目标文件不可访问: ${error.message}` }
        }

        if (!this.isWithinScanRoots(realPath)) {
            logger.warn(`[SkillDocumentLoader] 拒绝写入扫描目录之外的文件: ${targetPath}`)
            return { ok: false, error: '目标文件不在已配置的技能目录内，已拒绝写入' }
        }

        const limit = this.getMaxFileBytes()
        const size = Buffer.byteLength(content, 'utf8')
        if (size > limit) {
            return { ok: false, error: `内容大小 ${size} 字节超出上限 ${limit} 字节` }
        }

        return { ok: true, realPath }
    }

    /**
     * 先写同目录临时文件再 rename，避免写入中途失败留下半截文件
     * @param {string} realPath - 目标文件真实路径
     * @param {string} content - 文件内容
     * @returns {{ok: true, size: number}|{ok: false, error: string}} 写入结果
     * @private
     */
    _writeTextFileAtomic(realPath, content) {
        // 临时文件名刻意不落在 classifySkillFile 能识别的模式上，防止残留文件被当成技能加载
        const tempPath = `${realPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        try {
            fs.writeFileSync(tempPath, content, 'utf8')
            fs.renameSync(tempPath, realPath)
            return { ok: true, size: Buffer.byteLength(content, 'utf8') }
        } catch (error) {
            try {
                fs.unlinkSync(tempPath)
            } catch {}
            return { ok: false, error: error.message }
        }
    }

    /**
     * 读取技能定义文件的原始内容（含 frontmatter）
     * @param {string} skillName - 技能名称或相对路径
     * @returns {{name: string, path: string, relativePath: string, type: string, isPackage: boolean,
     *           content: string, size: number}|null} 原始内容；技能不存在或读取失败时返回 null
     */
    readSkillSource(skillName) {
        const document = this.getDocumentByName(skillName)
        if (!document) return null

        let realPath = ''
        try {
            realPath = fs.realpathSync(path.resolve(document.path))
        } catch (error) {
            logger.warn(`[SkillDocumentLoader] 读取技能定义失败: ${document.path}, ${error.message}`)
            return null
        }
        if (!this.isWithinScanRoots(realPath)) {
            logger.warn(`[SkillDocumentLoader] 拒绝读取扫描目录之外的定义文件: ${document.path}`)
            return null
        }

        try {
            const stat = fs.statSync(realPath)
            return {
                name: document.name,
                path: document.path,
                relativePath: document.relativePath,
                type: document.type,
                isPackage: document.isPackage === true,
                content: fs.readFileSync(realPath, 'utf8'),
                size: stat.size
            }
        } catch (error) {
            logger.warn(`[SkillDocumentLoader] 读取技能定义失败: ${document.path}, ${error.message}`)
            return null
        }
    }

    /**
     * 覆盖写入技能定义文件
     *
     * 只允许写入扫描阶段已发现的定义文件本身，不支持新建路径；写入前会先解析一遍内容，
     * 语法不合法直接拒绝，不会落盘。
     * @param {string} skillName - 技能名称或相对路径
     * @param {string} content - 完整的新内容（含 frontmatter）
     * @returns {{ok: true, name: string, relativePath: string, size: number}|{ok: false, error: string, status?: number}} 写入结果
     */
    writeSkillSource(skillName, content) {
        const document = this.getDocumentByName(skillName)
        if (!document) {
            return { ok: false, error: `技能 ${skillName} 不存在`, status: 404 }
        }

        const validation = validateSkillSource(document.type, content)
        if (!validation.valid) {
            return { ok: false, error: validation.error, status: 400 }
        }

        const prepared = this._prepareWrite(document.path, content)
        if (!prepared.ok) {
            return { ok: false, error: prepared.error, status: 400 }
        }

        const written = this._writeTextFileAtomic(prepared.realPath, content)
        if (!written.ok) {
            return { ok: false, error: `写入失败: ${written.error}`, status: 500 }
        }

        // frontmatter 里的 name 可被改写，此处回传解析结果，调用方据此更新引用
        const nextName =
            document.type === 'markdown' && typeof validation.metadata?.name === 'string'
                ? validation.metadata.name.trim()
                : document.name
        return { ok: true, name: nextName || document.name, relativePath: document.relativePath, size: written.size }
    }

    /**
     * 覆盖写入 skill 包内的附属文件
     *
     * 目标必须是 collectPackageFiles 已收录的文件（不能新建），且扩展名在纯文本白名单内。
     * @param {string} skillName - 技能名称或相对路径
     * @param {string} relativePath - 相对包根目录的文件路径
     * @param {string} content - 完整的新内容
     * @returns {{ok: true, path: string, size: number}|{ok: false, error: string, status?: number}} 写入结果
     */
    writePackageFile(skillName, relativePath, content) {
        const document = this.getDocumentByName(skillName)
        if (!document || !document.isPackage) {
            return { ok: false, error: `技能 ${skillName} 不存在或不是包形式`, status: 404 }
        }
        if (!relativePath || typeof relativePath !== 'string') {
            return { ok: false, error: '缺少文件路径', status: 400 }
        }

        const normalized = relativePath.trim().replace(/\\/g, '/')
        const entry = (document.files || []).find(file => file.path === normalized)
        if (!entry) {
            return { ok: false, error: `文件 ${normalized} 不在该技能包的收录清单中`, status: 404 }
        }
        if (!isEditableSkillFile(normalized)) {
            return { ok: false, error: `文件类型不支持编辑: ${normalized}`, status: 400 }
        }

        const prepared = this._prepareWrite(path.resolve(document.directory, normalized), content)
        if (!prepared.ok) {
            return { ok: false, error: prepared.error, status: 400 }
        }

        const written = this._writeTextFileAtomic(prepared.realPath, content)
        if (!written.ok) {
            return { ok: false, error: `写入失败: ${written.error}`, status: 500 }
        }
        return { ok: true, path: normalized, size: written.size }
    }

    getMatchingDocuments(options = {}) {
        const config = this.skillsConfig?.getDocumentSkillsConfig?.() || {}
        if (config.enabled === false || this.documents.length === 0) return []
        const normalizedOptions = normalizeDocumentOptions(options, config)
        return this.documents
            .filter(document => matchesDocument(document, normalizedOptions))
            .map(document => ({ ...document }))
    }

    buildInstructions(options = {}) {
        const config = this.skillsConfig?.getDocumentSkillsConfig?.() || {}
        if (config.enabled === false || this.documents.length === 0) return ''

        const maxPromptChars = Number.isFinite(options.maxPromptChars)
            ? options.maxPromptChars
            : Number.isFinite(config.maxPromptChars)
              ? config.maxPromptChars
              : 20000

        /*
         * 披露深度（与 mode 正交：mode 决定选哪些技能，disclosure 决定选中后注入多少内容）
         * - progressive（默认）：只注入元数据与附属文件清单，正文由 LLM 按需调工具读取
         * - full：注入 SKILL.md 全文，等同旧行为
         */
        const disclosure = options.disclosure || config.disclosure || 'progressive'
        const isProgressive = disclosure !== 'full'

        const docs = this.getMatchingDocuments(options)
        if (docs.length === 0) return ''

        const sections = ['【Agent Skills】']
        if (isProgressive) {
            sections.push(
                '以下是当前可用的本地技能清单（仅元数据）。它们不是可执行工具，而是改变任务处理方式的说明书。',
                '当某个技能与当前任务相关时，先用 get_skill_info 读取它的完整说明；若说明中引用了附属文件，再用 read_skill_file 按需读取。不要凭技能名猜测其内容。'
            )
        } else {
            sections.push(
                '以下内容来自本项目配置目录中的 SKILL.md。它们是本地文档技能说明，不是可执行工具；必须按正文说明调整任务处理方式。'
            )
        }

        for (const document of docs) {
            const lines = [`\n### ${document.name}`]
            if (document.description) lines.push(`说明: ${document.description}`)
            lines.push(`来源: ${document.relativePath}`)

            if (isProgressive) {
                const triggers = toStringList(document.triggers)
                if (triggers.length > 0) lines.push(`触发场景: ${triggers.join('、')}`)
                if (Array.isArray(document.files) && document.files.length > 0) {
                    lines.push(`附属文件: ${document.files.map(file => file.path).join('、')}`)
                }
            } else if (document.body) {
                lines.push(document.body)
            }

            sections.push(lines.join('\n'))
        }

        const fullText = sections.join('\n')
        if (fullText.length <= maxPromptChars) return fullText
        return fullText.slice(0, maxPromptChars).trimEnd() + '\n[内容因 skills.documents.maxPromptChars 限制截断]'
    }
}

export const skillDocumentLoader = new SkillDocumentLoader()

export default SkillDocumentLoader
