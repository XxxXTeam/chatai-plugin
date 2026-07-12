import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger
const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules', '.next', 'dist', 'build', 'coverage'])

// 目录内被识别为“文件夹型 skill 定义”的固定文件名
const FOLDER_SKILL_FILES = new Set(['skill.yaml', 'skill.yml', 'skill.json'])

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

function resolvePath(pluginRoot, configuredPath) {
    if (!configuredPath || typeof configuredPath !== 'string') return null
    const trimmed = configuredPath.trim()
    if (!trimmed) return null
    return path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(pluginRoot, trimmed)
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

    findSkillFiles(root, maxDepth) {
        const files = []
        const stat = fs.statSync(root)
        if (stat.isFile()) {
            if (classifySkillFile(path.basename(root))) files.push(root)
            return files
        }
        if (!stat.isDirectory()) return files

        const stack = [{ dir: root, depth: 0 }]
        while (stack.length > 0) {
            const current = stack.pop()
            if (!current || current.depth > maxDepth) continue

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

        const docs = this.getMatchingDocuments(options)
        if (docs.length === 0) return ''

        const sections = [
            '【Agent Skills】',
            '以下内容来自本项目配置目录中的 SKILL.md。它们是本地文档技能说明，不是可执行工具；必须按正文说明调整任务处理方式。'
        ]

        for (const document of docs) {
            const lines = [`\n### ${document.name}`]
            if (document.description) lines.push(`说明: ${document.description}`)
            lines.push(`来源: ${document.relativePath}`)
            if (document.body) lines.push(document.body)
            sections.push(lines.join('\n'))
        }

        const fullText = sections.join('\n')
        if (fullText.length <= maxPromptChars) return fullText
        return fullText.slice(0, maxPromptChars).trimEnd() + '\n[内容因 skills.documents.maxPromptChars 限制截断]'
    }
}

export const skillDocumentLoader = new SkillDocumentLoader()

export default SkillDocumentLoader
