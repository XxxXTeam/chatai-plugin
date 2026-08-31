import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import YAML from 'yaml'
import { chatLogger } from '../../core/utils/logger.js'

const logger = chatLogger
const IGNORED_DIRS = new Set([
    '.git',
    '.hg',
    '.svn',
    'node_modules',
    '.next',
    'dist',
    'build',
    'coverage',
    'skills-backups',
    'skills-import'
])

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

/** MIME 类型只在服务端判定，前端不得按扩展名重复推断。 */
const TEXT_MIME_TYPES = new Map([
    ['.md', 'text/markdown'],
    ['.markdown', 'text/markdown'],
    ['.txt', 'text/plain'],
    ['.yaml', 'application/yaml'],
    ['.yml', 'application/yaml'],
    ['.json', 'application/json'],
    ['.csv', 'text/csv'],
    ['.tsv', 'text/tab-separated-values'],
    ['.js', 'text/javascript'],
    ['.mjs', 'text/javascript'],
    ['.cjs', 'text/javascript'],
    ['.ts', 'text/typescript'],
    ['.py', 'text/x-python'],
    ['.sh', 'text/x-shellscript'],
    ['.bash', 'text/x-shellscript'],
    ['.zsh', 'text/x-shellscript'],
    ['.ps1', 'text/plain'],
    ['.bat', 'text/plain'],
    ['.cmd', 'text/plain'],
    ['.rb', 'text/x-ruby'],
    ['.pl', 'text/x-perl'],
    ['.lua', 'text/x-lua']
])

const BINARY_MIME_TYPES = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.pdf', 'application/pdf'],
    ['.zip', 'application/zip']
])

/*
 * 面板允许改写的附属文件扩展名白名单。
 *
 * 只放纯文本类：references/ 与 assets/ 的实际用途是文档与模板。scripts/ 下的脚本
 * 刻意不在白名单内 —— 当前实现只列出脚本、不执行它们，开放改写等于把面板变成一个
 * 往磁盘落可执行文件的通道，收益为零而风险不为零。
 */
const EDITABLE_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.yaml', '.yml', '.json'])

// 面板可管理的附属目录；scripts 只允许读取，不允许通过管理接口创建、改写或删除
const MANAGED_PACKAGE_DIRS = new Set(['references', 'assets'])

// Agent Skills 标准技能名：小写字母、数字、单连字符，最长 64 字符
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * 判断附属文件是否允许通过面板改写
 * @param {string} relativePath - 相对包根目录的文件路径
 * @returns {boolean} 是否允许写入
 */
export function isEditableSkillFile(relativePath) {
    const normalized = String(relativePath || '')
        .replace(/\\/g, '/')
        .toLowerCase()
    const [directory] = normalized.split('/')
    return MANAGED_PACKAGE_DIRS.has(directory) && EDITABLE_FILE_EXTENSIONS.has(path.extname(normalized))
}

/**
 * 校验并规范化可由管理面板操作的附属文件路径。
 * @param {string} relativePath - 相对技能包根目录的路径
 * @returns {{ok:true,path:string,segments:string[]}|{ok:false,error:string}} 校验结果
 */
export function normalizeManagedPackagePath(relativePath, options = {}) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
        return { ok: false, error: '缺少文件路径' }
    }

    const raw = relativePath.trim().replace(/\\/g, '/')
    if (raw.includes('\0') || raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
        return { ok: false, error: '文件路径必须是技能包内的相对路径' }
    }

    const segments = raw.split('/')
    if (segments.length < 2 || segments.some(segment => !segment || segment === '.' || segment === '..')) {
        return { ok: false, error: '文件路径包含空目录或路径穿越片段' }
    }
    if (!MANAGED_PACKAGE_DIRS.has(segments[0])) {
        return { ok: false, error: '仅允许管理 references/ 或 assets/ 下的附属文件' }
    }
    if (segments.length - 1 > MAX_PACKAGE_DEPTH + 1) {
        return { ok: false, error: `附属文件目录层级不能超过 ${MAX_PACKAGE_DEPTH + 1} 层` }
    }
    if (options.requireEditable !== false && !isEditableSkillFile(raw)) {
        return { ok: false, error: `文件类型不支持管理: ${raw}` }
    }

    return { ok: true, path: segments.join('/'), segments }
}

/**
 * 解析官方 allowed-tools 空格分隔字符串。
 * 项目扩展键 allowedTools / allowed_tools 继续由 toStringList 处理。
 * @param {*} value - allowed-tools 值
 * @returns {string[]} 工具名列表
 */
function parseStandardAllowedTools(value) {
    if (typeof value !== 'string') return toStringList(value)
    return value
        .split(/\s+/)
        .map(name => name.trim())
        .filter(Boolean)
}

/**
 * 校验 Agent Skills 官方 frontmatter 约束。
 * 旧技能仍可加载；调用方可用 strictStandard 在新建场景执行严格拒绝。
 * @param {Object} metadata - frontmatter
 * @param {{directoryName?: string}} [options] - 校验选项
 * @returns {{standardCompliant:boolean, errors:string[], warnings:string[]}} 结果
 */
export function validateAgentSkillMetadata(metadata, options = {}) {
    /** @type {string[]} */
    const errors = []
    /** @type {string[]} */
    const warnings = []
    const name = typeof metadata?.name === 'string' ? metadata.name.trim() : ''
    const description = typeof metadata?.description === 'string' ? metadata.description.trim() : ''

    if (!name) {
        errors.push('name 必须是非空字符串')
    } else {
        if (name.length > 64) errors.push('name 长度必须为 1-64')
        if (!SKILL_NAME_PATTERN.test(name)) {
            errors.push('name 只能包含小写字母、数字和单连字符，且不能首尾或连续使用连字符')
        }
        if (options.directoryName && name !== options.directoryName) {
            errors.push(`name 必须与父目录同名（当前目录: ${options.directoryName}）`)
        }
    }

    if (!description) {
        errors.push('description 必须是非空字符串')
    } else if (description.length > 1024) {
        errors.push('description 长度必须为 1-1024')
    }

    for (const key of ['license', 'compatibility']) {
        if (metadata?.[key] !== undefined && typeof metadata[key] !== 'string') {
            errors.push(`${key} 必须是字符串`)
        }
    }

    if (metadata?.metadata !== undefined) {
        if (!metadata.metadata || typeof metadata.metadata !== 'object' || Array.isArray(metadata.metadata)) {
            errors.push('metadata 必须是字符串键值映射')
        } else if (Object.values(metadata.metadata).some(value => typeof value !== 'string')) {
            errors.push('metadata 的所有值必须是字符串')
        }
    }

    if (metadata?.['allowed-tools'] !== undefined && typeof metadata['allowed-tools'] !== 'string') {
        errors.push('allowed-tools 必须是空格分隔字符串')
    }

    if (errors.length > 0) {
        warnings.push(...errors.map(error => `旧格式兼容加载: ${error}`))
    }
    return { standardCompliant: errors.length === 0, errors, warnings }
}

/**
 * 校验技能源文件；旧格式默认兼容，新建场景可启用 strictStandard。
 * @param {string} type - markdown/yaml/json
 * @param {string} content - 文件内容
 * @param {{directoryName?:string, strictStandard?:boolean}} [options] - 校验选项
 * @returns {Object} 校验结果
 */
export function validateSkillSource(type, content, options = {}) {
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

        const standard = validateAgentSkillMetadata(metadata, {
            directoryName: options.directoryName
        })
        if (options.strictStandard === true && !standard.standardCompliant) {
            return {
                valid: false,
                error: `Agent Skills frontmatter 不符合规范: ${standard.errors.join('; ')}`,
                metadata,
                ...standard
            }
        }
        return {
            valid: true,
            metadata,
            body: content.slice(match[0].length),
            ...standard
        }
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

    const standard = validateAgentSkillMetadata(metadata, {
        directoryName: options.directoryName
    })
    if (options.strictStandard === true && !standard.standardCompliant) {
        return {
            valid: false,
            error: `Agent Skills 定义不符合规范: ${standard.errors.join('; ')}`,
            metadata,
            ...standard
        }
    }
    const body =
        typeof metadata.instructions === 'string'
            ? metadata.instructions
            : typeof metadata.body === 'string'
              ? metadata.body
              : ''
    return { valid: true, metadata, body, ...standard }
}

/**
 * 将结构化字段序列化为标准 SKILL.md。
 * @param {object} metadata - Agent Skills frontmatter
 * @param {string} body - 技能正文
 * @returns {string} 完整 SKILL.md 内容
 */
export function serializeSkillMarkdown(metadata, body) {
    const frontmatter = YAML.stringify(metadata, { lineWidth: 0 }).trimEnd()
    const normalizedBody = typeof body === 'string' ? body.trim() : ''
    return `---\n${frontmatter}\n---\n${normalizedBody ? `\n${normalizedBody}\n` : ''}`
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
 * 判断目标路径是否位于根目录内。
 * @param {string} root - 已解析的根目录
 * @param {string} target - 已解析的目标路径
 * @returns {boolean} 目标是否等于根目录或位于根目录内
 */
export function isPathWithin(root, target) {
    const relative = path.relative(root, target)
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/**
 * 提取用于检测文件系统对象替换或原地改写的稳定身份字段。
 * @param {fs.Stats} stat - 文件状态
 * @returns {{dev:number,ino:number,size:number,mtimeMs:number,ctimeMs:number}} 身份字段
 */
function toFileIdentity(stat) {
    return {
        dev: stat.dev,
        ino: stat.ino,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs
    }
}

/**
 * 比较两个文件系统身份。
 * @param {object} current - 当前身份
 * @param {object} expected - 期望身份
 * @returns {boolean} 是否一致
 */
function sameFileIdentity(current, expected) {
    if (!expected) return true
    return (
        current.dev === expected.dev &&
        current.ino === expected.ino &&
        current.size === expected.size &&
        current.mtimeMs === expected.mtimeMs &&
        current.ctimeMs === expected.ctimeMs
    )
}

/**
 * 判断完整文件内容是否为可安全展示的 UTF-8 文本。
 * @param {Buffer} buffer - 文件完整字节
 * @returns {boolean} 是否为 UTF-8 文本
 */
function isReadableUtf8Text(buffer) {
    try {
        const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
        for (let index = 0; index < content.length; index++) {
            const code = content.charCodeAt(index)
            if (code === 0 || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d)) {
                return false
            }
        }
        return true
    } catch {
        return false
    }
}

/**
 * 根据文件签名、服务端扩展名映射和文本检测结果确定 MIME。
 * @param {string} fileName - 文件名
 * @param {Buffer} prefix - 文件开头字节
 * @param {boolean} textReadable - 是否已确认是可读 UTF-8 文本
 * @returns {string} MIME 类型
 */
function detectPackageFileMimeType(fileName, prefix, textReadable) {
    if (
        prefix.length >= 8 &&
        prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
        return 'image/png'
    }
    if (prefix.length >= 5 && prefix.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf'
    if (prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) return 'image/jpeg'
    if (prefix.length >= 6) {
        const signature = prefix.subarray(0, 6).toString('ascii')
        if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
    }
    if (
        prefix.length >= 12 &&
        prefix.subarray(0, 4).toString('ascii') === 'RIFF' &&
        prefix.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return 'image/webp'
    }
    if (prefix.length >= 4 && prefix[0] === 0x50 && prefix[1] === 0x4b && [0x03, 0x05, 0x07].includes(prefix[2])) {
        return 'application/zip'
    }

    const extension = path.extname(fileName).toLowerCase()
    if (BINARY_MIME_TYPES.has(extension)) return BINARY_MIME_TYPES.get(extension)
    if (textReadable) return TEXT_MIME_TYPES.get(extension) || 'text/plain'
    return 'application/octet-stream'
}

/**
 * 以 O_NOFOLLOW 打开并检查普通文件，同时生成服务端能力清单。
 * @param {string} targetPath - 文件路径
 * @param {string} realPackageRoot - 包根真实路径
 * @param {number} maxTextBytes - 文本读取上限
 * @returns {{size:number,identity:object,textReadable:boolean,mimeType:string}|null} 能力信息
 */
function inspectPackageFile(targetPath, realPackageRoot, maxTextBytes) {
    let descriptor = null
    try {
        const initialStat = fs.lstatSync(targetPath)
        if (initialStat.isSymbolicLink() || !initialStat.isFile()) return null

        descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
        const stat = fs.fstatSync(descriptor)
        if (!stat.isFile()) return null

        let realPath = ''
        try {
            realPath = fs.realpathSync(`/proc/self/fd/${descriptor}`)
        } catch {
            realPath = fs.realpathSync(targetPath)
        }
        if (!isPathWithin(realPackageRoot, realPath)) return null

        const canInspectText = stat.size <= maxTextBytes
        const inspectBytes = canInspectText ? stat.size : Math.min(stat.size, 512)
        const bytes = Buffer.alloc(inspectBytes)
        if (inspectBytes > 0) fs.readSync(descriptor, bytes, 0, inspectBytes, 0)
        let textReadable = canInspectText && isReadableUtf8Text(bytes)
        const mimeType = detectPackageFileMimeType(
            targetPath,
            bytes.subarray(0, Math.min(bytes.length, 512)),
            textReadable
        )
        if (mimeType.startsWith('image/') || mimeType === 'application/pdf' || mimeType === 'application/zip') {
            textReadable = false
        }

        return {
            size: stat.size,
            identity: toFileIdentity(stat),
            textReadable,
            mimeType
        }
    } catch {
        return null
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor)
            } catch {}
        }
    }
}

/**
 * 找到路径本身或最近的既有祖先，并解析其真实路径。
 *
 * 对尚未创建的扫描根不能只做字符串前缀检查：其既有父目录可能是指向插件外部的符号链接。
 * @param {string} targetPath - 待检查路径
 * @returns {{path:string,realPath:string}|null} 最近既有路径及其真实路径
 */
function findNearestExistingAncestor(targetPath) {
    let current = path.resolve(targetPath)
    while (true) {
        try {
            fs.lstatSync(current)
            return { path: current, realPath: fs.realpathSync(current) }
        } catch (error) {
            if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') return null
        }

        const parent = path.dirname(current)
        if (parent === current) return null
        current = parent
    }
}

/**
 * 在受信根目录内创建并解析一个普通目录。
 * @param {string} rootPath - 受信根目录
 * @param {string} targetPath - 要创建或复用的目录
 * @returns {string} 目标目录真实路径
 * @throws {Error} 路径越界、祖先符号链接逃逸或目标不是普通目录时抛出
 */
export function ensureDirectoryWithinRoot(rootPath, targetPath) {
    const lexicalRoot = path.resolve(rootPath)
    const lexicalTarget = path.resolve(targetPath)
    const realRoot = fs.realpathSync(lexicalRoot)
    if (!isPathWithin(lexicalRoot, lexicalTarget) && !isPathWithin(realRoot, lexicalTarget)) {
        throw new Error('目标目录不在受信根目录内')
    }

    const ancestor = findNearestExistingAncestor(lexicalTarget)
    if (!ancestor || !isPathWithin(realRoot, ancestor.realPath)) {
        throw new Error('目标目录的既有祖先真实路径位于受信根目录外')
    }

    fs.mkdirSync(lexicalTarget, { recursive: true, mode: 0o700 })
    const targetStat = fs.lstatSync(lexicalTarget)
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
        throw new Error('目标目录必须是普通目录，且不能是符号链接')
    }
    const realTarget = fs.realpathSync(lexicalTarget)
    if (!isPathWithin(realRoot, realTarget)) {
        throw new Error('目标目录真实路径位于受信根目录外')
    }
    return realTarget
}

/**
 * 通过不跟随最终符号链接的文件描述符读取普通文本文件。
 * @param {string} targetPath - 目标文件
 * @param {number} maxBytes - 最大字节数
 * @param {(realPath:string) => boolean} isAllowed - 对已打开文件真实路径的边界检查
 * @returns {{content:string,size:number,realPath:string,identity:object}|null} 读取结果
 */
function readRegularTextFile(targetPath, maxBytes, isAllowed) {
    let descriptor = null
    try {
        const resolvedTarget = path.resolve(targetPath)
        const initialStat = fs.lstatSync(resolvedTarget)
        if (initialStat.isSymbolicLink() || !initialStat.isFile()) return null

        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
        descriptor = fs.openSync(resolvedTarget, flags)
        const stat = fs.fstatSync(descriptor)
        if (!stat.isFile() || stat.size > maxBytes) return null

        let realPath = ''
        try {
            realPath = fs.realpathSync(`/proc/self/fd/${descriptor}`)
        } catch {
            realPath = fs.realpathSync(resolvedTarget)
        }
        if (!isAllowed(realPath)) return null

        return {
            content: fs.readFileSync(descriptor, 'utf8'),
            size: stat.size,
            realPath,
            identity: toFileIdentity(stat)
        }
    } catch {
        return null
    } finally {
        if (descriptor !== null) {
            try {
                fs.closeSync(descriptor)
            } catch {}
        }
    }
}

/**
 * 选择每个包目录唯一、明确的定义入口，并忽略已选包的资源目录内嵌套定义。
 * @param {string[]} files - 扫描命中的定义文件
 * @returns {string[]} 可安全加载的定义文件
 */
function selectSkillDefinitionFiles(files) {
    const flatFiles = []
    const packageFilesByDirectory = new Map()

    for (const filePath of files) {
        if (!isPackageSkill(filePath)) {
            flatFiles.push(filePath)
            continue
        }
        const directory = path.dirname(filePath)
        if (!packageFilesByDirectory.has(directory)) packageFilesByDirectory.set(directory, [])
        packageFilesByDirectory.get(directory).push(filePath)
    }

    const selected = [...flatFiles]
    for (const [directory, entries] of packageFilesByDirectory) {
        const ordered = entries.slice().sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
        const standardEntry = ordered.find(filePath => path.basename(filePath) === 'SKILL.md')
        if (standardEntry) {
            selected.push(standardEntry)
            if (ordered.length > 1) {
                logger.warn(
                    `[SkillDocumentLoader] 技能包 ${directory} 含多个定义入口，仅加载明确主入口 SKILL.md: ${ordered
                        .map(filePath => path.basename(filePath))
                        .join(', ')}`
                )
            }
            continue
        }
        if (ordered.length === 1) {
            selected.push(ordered[0])
            continue
        }
        logger.error(
            `[SkillDocumentLoader] 技能包 ${directory} 含多个旧格式定义入口且没有 SKILL.md，已全部跳过: ${ordered
                .map(filePath => path.basename(filePath))
                .join(', ')}`
        )
    }

    const accepted = []
    const packageRoots = []
    for (const filePath of selected.sort(
        (a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b)
    )) {
        const nestedInResources = packageRoots.some(packageRoot => {
            const relative = path.relative(packageRoot, filePath)
            if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                return false
            }
            return SKILL_PACKAGE_DIRS.includes(relative.split(path.sep)[0])
        })
        if (nestedInResources) {
            logger.warn(`[SkillDocumentLoader] 忽略技能包资源目录内的嵌套定义: ${filePath}`)
            continue
        }
        accepted.push(filePath)
        if (isPackageSkill(filePath)) packageRoots.push(path.dirname(filePath))
    }
    return accepted
}

/**
 * 收集 skill 包内的附属文件清单（references/ assets/ scripts/）
 *
 * 只遍历包根下这三个固定子目录，不会扫描包根本身的其他内容，因此不存在越界风险。
 * 返回的是相对包根的路径，供 LLM 通过 read_skill_file 工具按需读取。
 * @param {string} packageRoot - 包根目录绝对路径
 * @param {number} maxTextBytes - 文本读取上限
 * @returns {Array<{path:string,size:number,dir:string,textReadable:boolean,editable:boolean,downloadable:boolean,mimeType:string,identity:object}>} 附属文件清单
 */
function collectPackageFiles(packageRoot, maxTextBytes) {
    const files = []
    let realPackageRoot = ''
    try {
        realPackageRoot = fs.realpathSync(packageRoot)
    } catch {
        return files
    }

    for (const subDir of SKILL_PACKAGE_DIRS) {
        const dirPath = path.join(packageRoot, subDir)
        let dirStat = null
        try {
            dirStat = fs.lstatSync(dirPath)
        } catch {
            continue
        }
        if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) continue

        let realDirectory = ''
        try {
            realDirectory = fs.realpathSync(dirPath)
        } catch {
            continue
        }
        if (!isPathWithin(realPackageRoot, realDirectory)) continue

        const stack = [{ dir: realDirectory, depth: 0 }]
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
                    const inspected = inspectPackageFile(fullPath, realPackageRoot, maxTextBytes)
                    if (!inspected) continue
                    const relativePath = path.relative(packageRoot, fullPath).replace(/\\/g, '/')
                    files.push({
                        path: relativePath,
                        size: inspected.size,
                        dir: subDir,
                        textReadable: inspected.textReadable,
                        editable: inspected.textReadable && isEditableSkillFile(relativePath),
                        downloadable: true,
                        mimeType: inspected.mimeType,
                        identity: inspected.identity
                    })
                } else if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name) && current.depth < MAX_PACKAGE_DEPTH) {
                    try {
                        const stat = fs.lstatSync(fullPath)
                        const realDirectoryPath = fs.realpathSync(fullPath)
                        if (stat.isSymbolicLink() || !stat.isDirectory()) continue
                        if (!isPathWithin(realPackageRoot, realDirectoryPath)) continue
                        stack.push({ dir: realDirectoryPath, depth: current.depth + 1 })
                    } catch {}
                }
            }
        }
    }

    return files
}

/**
 * 统计技能包目录内会随目录整体移动的普通文件数，不跟随符号链接。
 * @param {string} packageRoot - 技能包根目录
 * @returns {number} 文件总数
 */
function countPackageTreeFiles(packageRoot) {
    let count = 0
    const stack = [packageRoot]
    let visitedDirectories = 0

    while (stack.length > 0 && visitedDirectories < MAX_SCAN_DIRECTORIES) {
        const current = stack.pop()
        if (!current) continue
        visitedDirectories++

        let entries = []
        try {
            entries = fs.readdirSync(current, { withFileTypes: true })
        } catch {
            continue
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue
            if (entry.isFile()) count++
            else if (entry.isDirectory()) stack.push(path.join(current, entry.name))
        }
    }

    return count
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

/**
 * 从 description 中提取可复现的显式触发短语。
 * @param {string} description - 技能说明
 * @returns {string[]} 触发短语
 */
function getDescriptionTriggerTerms(description) {
    const text = String(description || '')
    /** @type {string[]} */
    const terms = []
    const quoted = /["“”']([^"“”']{2,})["“”']/g
    let match
    while ((match = quoted.exec(text))) terms.push(match[1])
    terms.push(
        ...text
            .split(/[。！？.!?；;\n]/)
            .map(value => value.trim())
            .filter(value => value.length >= 2 && value.length <= 64)
    )
    return Array.from(new Set(terms))
}

function matchesDocument(document, normalizedOptions) {
    const { selectedNames, mode, contextText } = normalizedOptions
    if (selectedNames && (selectedNames.has(document.name) || selectedNames.has(document.relativePath))) {
        return true
    }
    if (mode === 'explicit') return false
    if (mode === 'all') return !selectedNames
    if (document.autoActivate === false || !contextText) return false

    const directTerms = [
        document.name,
        document.relativePath,
        ...toStringList(document.triggers),
        ...getDescriptionTriggerTerms(document.description)
    ]
        .map(normalizeSearchText)
        .filter(Boolean)

    if (directTerms.some(term => contextText.includes(term))) return true

    const description = normalizeSearchText(document.description)
    const compactContext = contextText.trim()
    return compactContext.length >= 4 && compactContext.length <= 64 && description.includes(compactContext)
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

        const maxDepth = Number.isFinite(config.maxDepth) ? config.maxDepth : 6
        const maxFileBytes = Number.isFinite(config.maxFileBytes) ? config.maxFileBytes : 65536
        const seenFiles = new Set()
        const discoveredFiles = []

        for (const root of this.getScanRoots()) {
            if (!fs.existsSync(root)) continue

            let rootFiles = []
            try {
                rootFiles = this.findSkillFiles(root, maxDepth)
            } catch (error) {
                logger.warn(`[SkillDocumentLoader] 扫描根在读取期间不可用: ${root}, ${error.message}`)
                continue
            }

            for (const filePath of rootFiles) {
                let realPath = ''
                try {
                    const stat = fs.lstatSync(filePath)
                    if (stat.isSymbolicLink() || !stat.isFile()) continue
                    realPath = fs.realpathSync(filePath)
                } catch {
                    continue
                }
                if (!this.isWithinScanRoots(realPath)) {
                    logger.warn(`[SkillDocumentLoader] 忽略真实路径位于扫描根之外的定义文件: ${filePath}`)
                    continue
                }
                if (seenFiles.has(realPath)) continue
                seenFiles.add(realPath)
                discoveredFiles.push(realPath)
            }
        }

        for (const filePath of selectSkillDefinitionFiles(discoveredFiles)) {
            const document = this.readSkillFile(filePath, maxFileBytes)
            if (document) {
                this.documents.push(document)
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
            const file = readRegularTextFile(filePath, maxFileBytes, realPath => this.isWithinScanRoots(realPath))
            if (!file) {
                logger.warn(`[SkillDocumentLoader] 跳过过大的 SKILL.md: ${filePath}`)
                return null
            }

            const { metadata, body } = parseSkillMarkdown(file.content)
            return this.buildDocument(file.realPath, metadata, body.trim(), 'markdown', file.identity)
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
            const file = readRegularTextFile(filePath, maxFileBytes, realPath => this.isWithinScanRoots(realPath))
            if (!file) {
                logger.warn(`[SkillDocumentLoader] 跳过过大的 skill 定义: ${filePath}`)
                return null
            }

            const content = file.content
            const resolvedType = type || classifySkillFile(path.basename(file.realPath)) || 'yaml'
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

            return this.buildDocument(file.realPath, metadata, body, resolvedType, file.identity)
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
     * @param {object} [loadedDefinitionIdentity] - 与已读取内容对应的文件身份
     * @returns {object} 规范化 skill 文档
     */
    buildDocument(filePath, metadata, body, type, loadedDefinitionIdentity = undefined) {
        const directory = path.dirname(filePath)
        const isPackage = isPackageSkill(filePath)
        let definitionIdentity = null
        let directoryIdentity = null
        try {
            definitionIdentity = loadedDefinitionIdentity || toFileIdentity(fs.lstatSync(filePath))
            directoryIdentity = toFileIdentity(fs.lstatSync(directory))
        } catch {}
        const files = isPackage ? collectPackageFiles(directory, this.getMaxFileBytes()) : []
        const packageFileCount = isPackage ? countPackageTreeFiles(directory) : 1
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
            ...parseStandardAllowedTools(metadata['allowed-tools'])
        ]
        const disallowedTools = [
            ...toStringList(metadata.disallowedTools),
            ...toStringList(metadata.disallowed_tools),
            ...toStringList(metadata['disallowed-tools'])
        ]
        const capabilities = toStringList(metadata.capabilities)
        const priority = Number.isFinite(metadata.priority) ? metadata.priority : 0
        const autoActivate = metadata.autoActivate !== false
        const standard = validateAgentSkillMetadata(metadata, {
            directoryName: isPackage ? path.basename(directory) : undefined
        })

        return {
            name,
            description,
            triggers,
            allowedTools: Array.from(new Set(allowedTools)),
            disallowedTools: Array.from(new Set(disallowedTools)),
            capabilities,
            priority,
            autoActivate,
            license: typeof metadata.license === 'string' ? metadata.license : '',
            compatibility: typeof metadata.compatibility === 'string' ? metadata.compatibility : '',
            standardMetadata:
                metadata.metadata && typeof metadata.metadata === 'object' && !Array.isArray(metadata.metadata)
                    ? { ...metadata.metadata }
                    : {},
            standardCompliant: standard.standardCompliant,
            compatibilityWarnings: standard.warnings,
            type,
            metadata,
            body,
            isPackage,
            files,
            packageFileCount,
            path: filePath,
            relativePath: relativeToPlugin(this.pluginRoot, filePath),
            directory,
            definitionIdentity,
            directoryIdentity,
            loadedAt: Date.now()
        }
    }

    getDocuments() {
        return this.documents.map(document => {
            const { definitionIdentity, directoryIdentity, ...publicDocument } = document
            return {
                ...publicDocument,
                files: (publicDocument.files || []).map(file => {
                    const { identity, ...publicFile } = file
                    return publicFile
                })
            }
        })
    }

    /**
     * 按名称或相对路径获取单个文档技能
     * @param {string} name - 技能名称或相对路径
     * @returns {object|null} 匹配的文档副本，未找到返回 null
     */
    getDocumentByName(name) {
        if (!name) return null
        const key = String(name).trim()
        const byPath = this.documents.find(doc => doc.relativePath === key)
        if (byPath) return { ...byPath }

        const matches = this.documents.filter(doc => doc.name === key)
        if (matches.length > 1) {
            logger.error(`[SkillDocumentLoader] 技能名称 ${key} 对应多个定义文件，拒绝按名称解析`)
            return null
        }
        return matches.length === 1 ? { ...matches[0] } : null
    }

    /**
     * 返回不含文件系统身份信息的附属文件能力。
     * @param {object} entry - 内部扫描条目
     * @returns {object} 可对外返回的能力清单
     * @private
     */
    _toPublicPackageFile(entry) {
        return {
            path: entry.path,
            dir: entry.dir,
            size: entry.size,
            textReadable: entry.textReadable === true,
            editable: entry.editable === true,
            downloadable: entry.downloadable === true,
            mimeType: entry.mimeType || 'application/octet-stream'
        }
    }

    /**
     * 从扫描白名单中解析并以 O_NOFOLLOW 打开附属文件。
     * @param {string} skillName - 技能名称或相对路径
     * @param {string} relativePath - 相对包根目录的文件路径
     * @returns {{ok:true,descriptor:number,entry:object,path:string}|{ok:false,status:number,errorCode:string,error:string}} 打开结果
     * @private
     */
    _openCollectedPackageFile(skillName, relativePath) {
        const document = this.getDocumentByName(skillName)
        if (!document || !document.isPackage) {
            return {
                ok: false,
                status: 404,
                errorCode: 'SKILL_PACKAGE_NOT_FOUND',
                error: `技能 ${skillName} 不存在或不是包形式`
            }
        }
        if (!relativePath || typeof relativePath !== 'string') {
            return { ok: false, status: 400, errorCode: 'SKILL_FILE_PATH_REQUIRED', error: '文件路径不能为空' }
        }

        const normalized = relativePath.trim().replace(/\\/g, '/')
        const entry = (document.files || []).find(file => file.path === normalized)
        if (!entry) {
            logger.debug(`[SkillDocumentLoader] 附属文件不在收录清单中: ${skillName} -> ${relativePath}`)
            return {
                ok: false,
                status: 404,
                errorCode: 'SKILL_FILE_NOT_LISTED',
                error: `文件 ${normalized || relativePath} 不在该技能包的扫描白名单中`
            }
        }

        let descriptor = null
        let realRoot = ''
        try {
            const rootStat = fs.lstatSync(document.directory)
            if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
                throw new Error('技能包目录不再是普通目录')
            }
            if (!sameFileIdentity(toFileIdentity(rootStat), document.directoryIdentity)) {
                return {
                    ok: false,
                    status: 409,
                    errorCode: 'SKILL_PACKAGE_CHANGED',
                    error: '技能包目录自上次扫描后已发生变化，请刷新后重试'
                }
            }
            realRoot = fs.realpathSync(path.resolve(document.directory))
            if (!this.isWithinScanRoots(realRoot)) throw new Error('技能包目录不在扫描范围内')

            const targetPath = path.resolve(realRoot, normalized)
            if (!isPathWithin(realRoot, targetPath) || targetPath === realRoot) {
                throw new Error('附属文件路径越界')
            }
            const targetStat = fs.lstatSync(targetPath)
            if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
                throw new Error('附属文件不再是普通文件')
            }

            descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
            const openedStat = fs.fstatSync(descriptor)
            if (!openedStat.isFile()) throw new Error('打开的对象不是普通文件')
            if (!sameFileIdentity(toFileIdentity(openedStat), entry.identity)) {
                fs.closeSync(descriptor)
                descriptor = null
                return {
                    ok: false,
                    status: 409,
                    errorCode: 'SKILL_FILE_CHANGED',
                    error: '附属文件自上次扫描后已发生变化，请刷新后重试'
                }
            }

            let realFile = ''
            try {
                realFile = fs.realpathSync(`/proc/self/fd/${descriptor}`)
            } catch {
                realFile = fs.realpathSync(targetPath)
            }
            if (!isPathWithin(realRoot, realFile) || realFile === realRoot) {
                throw new Error('附属文件真实路径位于技能包之外')
            }

            return { ok: true, descriptor, entry, path: normalized }
        } catch (error) {
            if (descriptor !== null) {
                try {
                    fs.closeSync(descriptor)
                } catch {}
            }
            logger.debug(`[SkillDocumentLoader] 解析附属文件路径失败: ${relativePath}, ${error.message}`)
            return {
                ok: false,
                status: 409,
                errorCode: 'SKILL_FILE_UNAVAILABLE',
                error: '附属文件不可用、越界或已发生变化，请刷新后重试'
            }
        }
    }

    /**
     * 读取 skill 包内已确认的 UTF-8 文本文件。
     * @param {string} skillName - 技能名称或相对路径
     * @param {string} relativePath - 相对包根目录的文件路径
     * @param {number} [maxBytes] - 最大读取字节数，缺省取配置的 maxFileBytes
     * @returns {{content:string,path:string,size:number,textReadable:true,editable:boolean,downloadable:boolean,mimeType:string}|{ok:false,status:number,errorCode:string,error:string,mimeType?:string,size?:number}|null} 读取结果
     */
    readPackageFile(skillName, relativePath, maxBytes) {
        const opened = this._openCollectedPackageFile(skillName, relativePath)
        if (!opened.ok) return opened.status === 404 || opened.status === 400 ? null : opened

        const config = this.skillsConfig?.getDocumentSkillsConfig?.() || {}
        const limit = Number.isFinite(maxBytes)
            ? maxBytes
            : Number.isFinite(config.maxFileBytes)
              ? config.maxFileBytes
              : 65536

        if (opened.entry.size > limit) {
            fs.closeSync(opened.descriptor)
            return {
                ok: false,
                status: 413,
                errorCode: 'SKILL_FILE_TEXT_LIMIT',
                error: `文件大小 ${opened.entry.size} 字节超出文本读取上限 ${limit} 字节`,
                size: opened.entry.size,
                mimeType: opened.entry.mimeType
            }
        }
        if (opened.entry.textReadable !== true) {
            fs.closeSync(opened.descriptor)
            return {
                ok: false,
                status: 415,
                errorCode: 'SKILL_FILE_NOT_TEXT',
                error: `文件 ${opened.path} 不是可读取的 UTF-8 文本，请使用下载接口获取原始字节`,
                size: opened.entry.size,
                mimeType: opened.entry.mimeType
            }
        }

        try {
            const bytes = fs.readFileSync(opened.descriptor)
            if (!isReadableUtf8Text(bytes)) {
                return {
                    ok: false,
                    status: 415,
                    errorCode: 'SKILL_FILE_NOT_TEXT',
                    error: `文件 ${opened.path} 不是可读取的 UTF-8 文本，请使用下载接口获取原始字节`,
                    size: opened.entry.size,
                    mimeType: opened.entry.mimeType
                }
            }
            return {
                content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
                ...this._toPublicPackageFile(opened.entry)
            }
        } finally {
            fs.closeSync(opened.descriptor)
        }
    }

    /**
     * 为 HTTP 下载返回经身份校验的字节流。
     * @param {string} skillName - 技能名称
     * @param {string} relativePath - 扫描清单中的相对路径
     * @returns {{ok:true,stream:fs.ReadStream,path:string,fileName:string,size:number,mimeType:string}|{ok:false,status:number,errorCode:string,error:string}} 下载结果
     */
    openPackageFileDownload(skillName, relativePath) {
        const opened = this._openCollectedPackageFile(skillName, relativePath)
        if (!opened.ok) return opened
        if (opened.entry.downloadable !== true) {
            fs.closeSync(opened.descriptor)
            return {
                ok: false,
                status: 403,
                errorCode: 'SKILL_FILE_DOWNLOAD_DISABLED',
                error: '该文件未开放下载能力'
            }
        }

        const stream = fs.createReadStream(opened.path, {
            fd: opened.descriptor,
            autoClose: true,
            start: 0
        })
        return {
            ok: true,
            stream,
            path: opened.path,
            fileName: path.basename(opened.path),
            size: opened.entry.size,
            mimeType: opened.entry.mimeType || 'application/octet-stream'
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
        let realPluginRoot = ''
        try {
            realPluginRoot = fs.realpathSync(this.pluginRoot)
        } catch {
            return roots
        }
        for (const configuredPath of paths) {
            const root = resolvePath(this.pluginRoot, configuredPath)
            if (!root) continue

            const ancestor = findNearestExistingAncestor(root)
            if (!ancestor || !isPathWithin(realPluginRoot, ancestor.realPath)) {
                logger.warn(`[SkillDocumentLoader] 忽略真实路径位于插件外部的扫描根: ${configuredPath}`)
                continue
            }

            if (ancestor.path === path.resolve(root)) {
                roots.push(ancestor.realPath)
            } else {
                roots.push(root)
            }
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
            if (isPathWithin(realRoot, realTarget)) return true
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
            return ensureDirectoryWithinRoot(this.pluginRoot, target)
        } catch (error) {
            logger.warn(`[SkillDocumentLoader] 创建导入目录失败: ${target}, ${error.message}`)
            return null
        }
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
    _prepareWrite(targetPath, content, expectedIdentity = undefined) {
        if (typeof content !== 'string') {
            return { ok: false, error: '内容必须是字符串' }
        }

        let realPath = ''
        let targetStat = null
        try {
            const resolvedTarget = path.resolve(targetPath)
            targetStat = fs.lstatSync(resolvedTarget)
            if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
                return { ok: false, error: '目标必须是普通文件，且不能是符号链接' }
            }
            if (!sameFileIdentity(toFileIdentity(targetStat), expectedIdentity)) {
                return { ok: false, error: '目标文件自上次加载后已发生变化，请刷新后重试' }
            }
            realPath = fs.realpathSync(resolvedTarget)
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

        let realParent = ''
        let parentStat = null
        try {
            realParent = fs.realpathSync(path.dirname(realPath))
            parentStat = fs.statSync(realParent)
        } catch (error) {
            return { ok: false, error: `目标父目录不可访问: ${error.message}` }
        }

        return {
            ok: true,
            realPath,
            realParent,
            targetIdentity: toFileIdentity(targetStat),
            parentIdentity: { dev: parentStat.dev, ino: parentStat.ino }
        }
    }

    /**
     * 先写同目录临时文件再 rename，避免写入中途失败留下半截文件
     * @param {string} realPath - 目标文件真实路径
     * @param {string} content - 文件内容
     * @returns {{ok: true, size: number}|{ok: false, error: string}} 写入结果
     * @private
     */
    _writeTextFileAtomic(realPath, content, options = {}) {
        // 临时文件名刻意不落在 classifySkillFile 能识别的模式上，防止残留文件被当成技能加载
        const tempPath = `${realPath}.tmp-${randomUUID()}`
        let descriptor = null
        try {
            const realParent = fs.realpathSync(path.dirname(realPath))
            const parentStat = fs.statSync(realParent)
            if (options.expectedParent && realParent !== options.expectedParent) {
                throw new Error('目标父目录在写入期间发生变化')
            }
            if (
                options.parentIdentity &&
                (parentStat.dev !== options.parentIdentity.dev || parentStat.ino !== options.parentIdentity.ino)
            ) {
                throw new Error('目标父目录在写入期间已被替换')
            }

            const flags =
                fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0)
            descriptor = fs.openSync(tempPath, flags, 0o600)
            fs.writeFileSync(descriptor, content, 'utf8')
            fs.fsyncSync(descriptor)
            const tempIdentity = fs.fstatSync(descriptor)
            fs.closeSync(descriptor)
            descriptor = null

            const currentParent = fs.realpathSync(path.dirname(realPath))
            const currentParentStat = fs.statSync(currentParent)
            if (
                currentParent !== realParent ||
                currentParentStat.dev !== parentStat.dev ||
                currentParentStat.ino !== parentStat.ino
            ) {
                throw new Error('目标父目录在原子替换前发生变化')
            }

            if (options.mustExist === false) {
                try {
                    fs.lstatSync(realPath)
                    throw new Error('目标文件在创建期间已存在')
                } catch (error) {
                    if (error?.code !== 'ENOENT') throw error
                }
            } else {
                const currentTarget = fs.lstatSync(realPath)
                if (currentTarget.isSymbolicLink() || !currentTarget.isFile()) {
                    throw new Error('目标文件在写入期间不再是普通文件')
                }
                if (!sameFileIdentity(toFileIdentity(currentTarget), options.targetIdentity)) {
                    throw new Error('目标文件在写入期间已被替换')
                }
            }

            const currentTemp = fs.lstatSync(tempPath)
            if (
                currentTemp.isSymbolicLink() ||
                !currentTemp.isFile() ||
                currentTemp.dev !== tempIdentity.dev ||
                currentTemp.ino !== tempIdentity.ino
            ) {
                throw new Error('原子写入临时文件在落位前已被替换')
            }

            fs.renameSync(tempPath, realPath)
            return { ok: true, size: Buffer.byteLength(content, 'utf8') }
        } catch (error) {
            if (descriptor !== null) {
                try {
                    fs.closeSync(descriptor)
                } catch {}
            }
            try {
                fs.unlinkSync(tempPath)
            } catch {}
            return { ok: false, error: error.message }
        }
    }

    /**
     * 解析一个受管理的附属文件目标，统一执行目录、扩展名、白名单和真实路径校验。
     * @param {string} skillName - 技能名称
     * @param {string} relativePath - 相对技能包根目录的路径
     * @param {{mustExist?:boolean}} [options] - 是否要求文件已经存在并在扫描清单中
     * @returns {object} 解析结果
     * @private
     */
    _resolveManagedPackageTarget(skillName, relativePath, options = {}) {
        const document = this.getDocumentByName(skillName)
        if (!document || !document.isPackage) {
            return { ok: false, error: `技能 ${skillName} 不存在或不是包形式`, status: 404 }
        }

        const normalized = normalizeManagedPackagePath(relativePath, {
            requireEditable: options.requireEditable !== false
        })
        if (!normalized.ok) {
            return { ok: false, error: normalized.error, status: 400 }
        }

        let realRoot = ''
        try {
            const rootStat = fs.lstatSync(document.directory)
            if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
                return { ok: false, error: '技能包目录不能是符号链接', status: 400 }
            }
            if (!sameFileIdentity(toFileIdentity(rootStat), document.directoryIdentity)) {
                return { ok: false, error: '技能包目录自上次加载后已发生变化，请刷新后重试', status: 409 }
            }
            realRoot = fs.realpathSync(document.directory)
            const definitionStat = fs.lstatSync(document.path)
            const realDefinition = fs.realpathSync(document.path)
            if (
                definitionStat.isSymbolicLink() ||
                !definitionStat.isFile() ||
                path.dirname(realDefinition) !== realRoot
            ) {
                return { ok: false, error: '技能定义文件或包目录在加载后发生变化', status: 409 }
            }
            if (!sameFileIdentity(toFileIdentity(definitionStat), document.definitionIdentity)) {
                return { ok: false, error: '技能定义文件自上次加载后已发生变化，请刷新后重试', status: 409 }
            }
        } catch (error) {
            return { ok: false, error: `技能包目录不可访问: ${error.message}`, status: 404 }
        }
        if (!this.isWithinScanRoots(realRoot)) {
            return { ok: false, error: '技能包不在已配置的技能目录内', status: 400 }
        }

        const targetPath = path.resolve(realRoot, ...normalized.segments)
        const relative = path.relative(realRoot, targetPath)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            return { ok: false, error: '附属文件路径越界，已拒绝', status: 400 }
        }

        const mustExist = options.mustExist !== false
        const listedEntry = (document.files || []).find(file => file.path === normalized.path)
        if (mustExist && !listedEntry) {
            return { ok: false, error: `文件 ${normalized.path} 不在该技能包的收录清单中`, status: 404 }
        }
        if (mustExist && options.requireEditable !== false && listedEntry?.editable !== true) {
            return {
                ok: false,
                error: `文件 ${normalized.path} 未被服务端判定为可编辑 UTF-8 文本`,
                status: 415
            }
        }
        if (!mustExist && (listedEntry || fs.existsSync(targetPath))) {
            return { ok: false, error: `文件 ${normalized.path} 已存在`, status: 409 }
        }
        if (!mustExist && (document.files || []).length >= MAX_PACKAGE_FILES) {
            return { ok: false, error: `技能包附属文件数已达到上限 ${MAX_PACKAGE_FILES}`, status: 409 }
        }

        // 任一既有祖先为符号链接都会让后续 mkdir/write 越过包根，必须逐段拒绝。
        let currentPath = realRoot
        for (const segment of normalized.segments.slice(0, -1)) {
            currentPath = path.join(currentPath, segment)
            if (!fs.existsSync(currentPath)) continue
            const stat = fs.lstatSync(currentPath)
            if (stat.isSymbolicLink()) {
                return { ok: false, error: `附属目录不能是符号链接: ${segment}`, status: 400 }
            }
            if (!stat.isDirectory()) {
                return { ok: false, error: `附属文件父路径不是目录: ${segment}`, status: 400 }
            }
        }

        if (mustExist) {
            let realTarget = ''
            let targetStat = null
            try {
                targetStat = fs.lstatSync(targetPath)
                if (targetStat.isSymbolicLink() || !targetStat.isFile()) {
                    return { ok: false, error: `附属文件不是普通文件: ${normalized.path}`, status: 400 }
                }
                if (!sameFileIdentity(toFileIdentity(targetStat), listedEntry?.identity)) {
                    return { ok: false, error: '附属文件自上次加载后已发生变化，请刷新后重试', status: 409 }
                }
                realTarget = fs.realpathSync(targetPath)
            } catch (error) {
                return { ok: false, error: `附属文件不可访问: ${error.message}`, status: 404 }
            }
            const targetRelative = path.relative(realRoot, realTarget)
            if (targetRelative.startsWith('..') || path.isAbsolute(targetRelative)) {
                return { ok: false, error: '附属文件真实路径越界，已拒绝', status: 400 }
            }
            return {
                ok: true,
                document,
                path: normalized.path,
                targetPath: realTarget,
                realRoot,
                targetIdentity: toFileIdentity(targetStat)
            }
        }

        return { ok: true, document, path: normalized.path, targetPath, realRoot }
    }

    /**
     * 将文件或目录原子移动到插件受管备份目录。
     * @param {string} sourcePath - 已校验的真实源路径
     * @param {string} label - 备份目录标签
     * @returns {{ok:true,backup:string,recoverable:true}|{ok:false,error:string}} 结果
     * @private
     */
    _moveToManagedBackup(sourcePath, label, expectedIdentity = undefined) {
        const safeLabel =
            String(label || 'skill')
                .replace(/[^a-zA-Z0-9._-]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'skill'
        const backupRoot = path.resolve(this.pluginRoot, 'temp', 'skills-backups')
        let backupContainer = ''

        try {
            const realBackupRoot = ensureDirectoryWithinRoot(this.pluginRoot, backupRoot)
            const backupRootStat = fs.statSync(realBackupRoot)
            const sourceStat = fs.lstatSync(sourcePath)
            if (sourceStat.isSymbolicLink()) throw new Error('拒绝备份符号链接目标')
            if (!sameFileIdentity(toFileIdentity(sourceStat), expectedIdentity)) {
                throw new Error('备份源在操作期间已被替换')
            }

            backupContainer = fs.mkdtempSync(path.join(realBackupRoot, `${safeLabel}-${randomUUID()}-`))
            const realBackupContainer = fs.realpathSync(backupContainer)
            if (!isPathWithin(realBackupRoot, realBackupContainer)) throw new Error('备份暂存目录真实路径越界')
            const currentBackupRoot = fs.lstatSync(realBackupRoot)
            if (
                currentBackupRoot.isSymbolicLink() ||
                currentBackupRoot.dev !== backupRootStat.dev ||
                currentBackupRoot.ino !== backupRootStat.ino
            ) {
                throw new Error('备份根目录在操作期间已被替换')
            }
            const backupPath = path.join(realBackupContainer, path.basename(sourcePath))
            const currentSource = fs.lstatSync(sourcePath)
            if (
                currentSource.isSymbolicLink() ||
                !sameFileIdentity(toFileIdentity(currentSource), toFileIdentity(sourceStat))
            ) {
                throw new Error('备份源在移动前已被替换')
            }
            fs.renameSync(sourcePath, backupPath)
            return {
                ok: true,
                backup: relativeToPlugin(this.pluginRoot, backupPath),
                recoverable: true
            }
        } catch (error) {
            if (backupContainer) {
                try {
                    fs.rmdirSync(backupContainer)
                } catch {}
            }
            return { ok: false, error: `移动到受管备份目录失败: ${error.message}` }
        }
    }

    /**
     * 在本实例内同步刷新刚完成磁盘变更的技能，避免连续管理操作依赖额外 reload。
     * @param {object} document - 变更前的技能文档
     * @returns {object|null} 刷新后的文档
     * @private
     */
    _refreshDocumentAfterMutation(document) {
        const index = this.documents.findIndex(item => item.path === document.path)
        if (index < 0) return null
        const refreshed = this.readSkillFile(document.path, this.getMaxFileBytes())
        if (!refreshed) {
            this.documents.splice(index, 1)
            return null
        }
        this.documents[index] = refreshed
        return refreshed
    }

    /**
     * 新建标准 SKILL.md 技能包。
     * @param {object} input - 标准 frontmatter 与正文
     * @returns {object} 创建结果
     */
    createSkillPackage(input = {}) {
        const name = typeof input.name === 'string' ? input.name.trim() : ''
        const description = typeof input.description === 'string' ? input.description.trim() : ''
        const body = typeof input.body === 'string' ? input.body : ''
        const metadata = { name, description }

        if (typeof input.license === 'string' && input.license.trim()) metadata.license = input.license.trim()
        if (typeof input.compatibility === 'string' && input.compatibility.trim()) {
            metadata.compatibility = input.compatibility.trim()
        }
        if (Array.isArray(input.allowedTools) && input.allowedTools.length > 0) {
            metadata['allowed-tools'] = Array.from(
                new Set(input.allowedTools.map(item => String(item).trim()).filter(Boolean))
            ).join(' ')
        }
        if (input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)) {
            metadata.metadata = { ...input.metadata }
        }

        const content = serializeSkillMarkdown(metadata, body)
        const contentSize = Buffer.byteLength(content, 'utf8')
        const maxFileBytes = this.getMaxFileBytes()
        if (contentSize > maxFileBytes) {
            return {
                ok: false,
                error: `内容大小 ${contentSize} 字节超出上限 ${maxFileBytes} 字节`,
                status: 400
            }
        }
        const validation = validateSkillSource('markdown', content, {
            directoryName: name,
            strictStandard: true
        })
        if (!validation.valid) {
            return { ok: false, error: validation.error, status: 400, validation }
        }
        if (this.documents.some(document => document.name === name)) {
            return { ok: false, error: `技能 ${name} 已存在`, status: 409 }
        }

        const importRoot = this.getImportRoot()
        if (!importRoot) {
            return { ok: false, error: '未找到可用的技能创建目录', status: 500 }
        }

        let realRoot = ''
        try {
            realRoot = fs.realpathSync(importRoot)
        } catch (error) {
            return { ok: false, error: `技能创建目录不可访问: ${error.message}`, status: 500 }
        }
        if (!this.isWithinScanRoots(realRoot)) {
            return { ok: false, error: '技能创建目录不在已配置的扫描范围内', status: 400 }
        }

        const targetDirectory = path.resolve(realRoot, name)
        const rootRelative = path.relative(realRoot, targetDirectory)
        if (!rootRelative || rootRelative.startsWith('..') || path.isAbsolute(rootRelative)) {
            return { ok: false, error: '技能目录越界，已拒绝创建', status: 400 }
        }
        if (fs.existsSync(targetDirectory)) {
            return { ok: false, error: `技能目录 ${name} 已存在`, status: 409 }
        }

        let stagingDirectory = ''
        try {
            const rootStat = fs.statSync(realRoot)
            stagingDirectory = fs.mkdtempSync(path.join(realRoot, `.${name}.creating-${randomUUID()}-`))
            const realStagingDirectory = fs.realpathSync(stagingDirectory)
            if (!isPathWithin(realRoot, realStagingDirectory)) throw new Error('技能暂存目录真实路径越界')
            const parentStat = fs.statSync(realStagingDirectory)
            const written = this._writeTextFileAtomic(path.join(realStagingDirectory, 'SKILL.md'), content, {
                mustExist: false,
                expectedParent: realStagingDirectory,
                parentIdentity: { dev: parentStat.dev, ino: parentStat.ino }
            })
            if (!written.ok) throw new Error(written.error)

            const currentRoot = fs.lstatSync(realRoot)
            if (currentRoot.isSymbolicLink() || currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino) {
                throw new Error('技能创建目录在操作期间已被替换')
            }
            try {
                fs.lstatSync(targetDirectory)
                throw new Error(`技能目录 ${name} 在创建期间已存在`)
            } catch (error) {
                if (error?.code !== 'ENOENT') throw error
            }
            const currentStaging = fs.lstatSync(realStagingDirectory)
            if (
                currentStaging.isSymbolicLink() ||
                !currentStaging.isDirectory() ||
                currentStaging.dev !== parentStat.dev ||
                currentStaging.ino !== parentStat.ino
            ) {
                throw new Error('技能暂存目录在最终落位前已被替换')
            }
            fs.renameSync(realStagingDirectory, targetDirectory)
            return {
                ok: true,
                name,
                path: relativeToPlugin(this.pluginRoot, path.join(targetDirectory, 'SKILL.md')),
                size: written.size,
                standardCompliant: true
            }
        } catch (error) {
            if (stagingDirectory) {
                try {
                    fs.rmSync(stagingDirectory, { recursive: true, force: true })
                } catch {}
            }
            return { ok: false, error: `创建技能包失败: ${error.message}`, status: 500 }
        }
    }

    /**
     * 以结构化 frontmatter 与正文更新标准 SKILL.md。
     * @param {string} skillName - 技能名称
     * @param {object} input - metadata 与 body
     * @returns {object} 更新结果
     */
    writeStructuredSkill(skillName, input = {}) {
        const document = this.getDocumentByName(skillName)
        if (!document) return { ok: false, error: `技能 ${skillName} 不存在`, status: 404 }
        if (document.type !== 'markdown') {
            return { ok: false, error: '结构化编辑仅支持 SKILL.md；YAML/JSON 技能请使用源码编辑', status: 400 }
        }
        if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
            return { ok: false, error: 'metadata 必须是 frontmatter 键值对象', status: 400 }
        }
        if (typeof input.body !== 'string') {
            return { ok: false, error: 'body 必须是字符串', status: 400 }
        }

        const content = serializeSkillMarkdown(input.metadata, input.body)
        return this.writeSkillSource(skillName, content, { strictStandard: true })
    }

    /**
     * 新建 references/assets 下的文本附属文件。
     * @param {string} skillName - 技能名称
     * @param {string} relativePath - 文件路径
     * @param {string} content - 文件内容
     * @returns {object} 创建结果
     */
    createPackageFile(skillName, relativePath, content) {
        if (typeof content !== 'string') {
            return { ok: false, error: '内容必须是字符串', status: 400 }
        }
        const size = Buffer.byteLength(content, 'utf8')
        const limit = this.getMaxFileBytes()
        if (size > limit) {
            return { ok: false, error: `内容大小 ${size} 字节超出上限 ${limit} 字节`, status: 400 }
        }

        const resolved = this._resolveManagedPackageTarget(skillName, relativePath, { mustExist: false })
        if (!resolved.ok) return resolved

        try {
            fs.mkdirSync(path.dirname(resolved.targetPath), { recursive: true, mode: 0o700 })
            const realParent = fs.realpathSync(path.dirname(resolved.targetPath))
            const parentRelative = path.relative(resolved.realRoot, realParent)
            if (parentRelative.startsWith('..') || path.isAbsolute(parentRelative)) {
                return { ok: false, error: '附属文件父目录越界，已拒绝创建', status: 400 }
            }
            const parentStat = fs.statSync(realParent)
            const written = this._writeTextFileAtomic(resolved.targetPath, content, {
                mustExist: false,
                expectedParent: realParent,
                parentIdentity: { dev: parentStat.dev, ino: parentStat.ino }
            })
            if (!written.ok) {
                return { ok: false, error: `写入失败: ${written.error}`, status: 500 }
            }
            const refreshed = this._refreshDocumentAfterMutation(resolved.document)
            const entry = refreshed?.files?.find(file => file.path === resolved.path)
            return {
                ok: true,
                path: resolved.path,
                size: written.size,
                file: entry ? this._toPublicPackageFile(entry) : undefined
            }
        } catch (error) {
            return { ok: false, error: `创建附属文件失败: ${error.message}`, status: 500 }
        }
    }

    /**
     * 删除一个受管理附属文件；实际操作为移动到受管备份目录。
     * @param {string} skillName - 技能名称
     * @param {string} relativePath - 文件路径
     * @returns {object} 删除结果
     */
    deletePackageFile(skillName, relativePath) {
        const resolved = this._resolveManagedPackageTarget(skillName, relativePath, {
            mustExist: true,
            requireEditable: false
        })
        if (!resolved.ok) return resolved
        const moved = this._moveToManagedBackup(
            resolved.targetPath,
            `${resolved.document.name}-file`,
            resolved.targetIdentity
        )
        if (!moved.ok) return { ...moved, status: 500 }
        this._refreshDocumentAfterMutation(resolved.document)
        return { ok: true, path: resolved.path, ...moved }
    }

    /**
     * 删除技能定义；包形式移动整个目录，单文件形式移动定义文件。
     * @param {string} skillName - 技能名称
     * @returns {object} 删除结果
     */
    deleteSkill(skillName) {
        const document = this.getDocumentByName(skillName)
        if (!document) return { ok: false, error: `技能 ${skillName} 不存在`, status: 404 }

        const sourcePath = document.isPackage ? document.directory : document.path
        let realSource = ''
        let sourceStat = null
        try {
            sourceStat = fs.lstatSync(sourcePath)
            if (sourceStat.isSymbolicLink()) {
                return { ok: false, error: '技能路径在加载后变成了符号链接', status: 409 }
            }
            const expectedSourceIdentity = document.isPackage ? document.directoryIdentity : document.definitionIdentity
            if (!sameFileIdentity(toFileIdentity(sourceStat), expectedSourceIdentity)) {
                return { ok: false, error: '技能路径自上次加载后已发生变化，请刷新后重试', status: 409 }
            }
            realSource = fs.realpathSync(sourcePath)
            const definitionStat = fs.lstatSync(document.path)
            const realDefinition = fs.realpathSync(document.path)
            if (definitionStat.isSymbolicLink() || !definitionStat.isFile()) {
                return { ok: false, error: '技能定义文件在加载后发生变化', status: 409 }
            }
            if (!sameFileIdentity(toFileIdentity(definitionStat), document.definitionIdentity)) {
                return { ok: false, error: '技能定义文件自上次加载后已发生变化，请刷新后重试', status: 409 }
            }
            if (document.isPackage && path.dirname(realDefinition) !== realSource) {
                return { ok: false, error: '技能定义文件已不属于原技能包目录', status: 409 }
            }
        } catch (error) {
            return { ok: false, error: `技能文件不可访问: ${error.message}`, status: 404 }
        }
        if (!this.isWithinScanRoots(realSource)) {
            return { ok: false, error: '技能不在已配置的扫描范围内', status: 400 }
        }
        let isScanRoot = false
        if (document.isPackage) {
            for (const root of this.getScanRoots()) {
                try {
                    if (fs.realpathSync(root) === realSource) {
                        isScanRoot = true
                        break
                    }
                } catch {}
            }
        }
        if (isScanRoot) {
            return { ok: false, error: '拒绝删除技能扫描根目录', status: 400 }
        }

        const affectedFiles = document.isPackage ? countPackageTreeFiles(realSource) : 1

        const moved = this._moveToManagedBackup(realSource, document.name, toFileIdentity(sourceStat))
        if (!moved.ok) return { ...moved, status: 500 }
        return {
            ok: true,
            name: document.name,
            affectedFiles,
            ...moved
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

        const expectedPath = path.resolve(document.path)
        const file = readRegularTextFile(expectedPath, this.getMaxFileBytes(), realPath => {
            return realPath === expectedPath && this.isWithinScanRoots(realPath)
        })
        if (!file) {
            logger.warn(`[SkillDocumentLoader] 读取技能定义失败、路径已变化或超出大小上限: ${document.path}`)
            return null
        }
        if (!sameFileIdentity(file.identity, document.definitionIdentity)) {
            logger.warn(`[SkillDocumentLoader] 技能定义自上次加载后已发生变化，请刷新后重试: ${document.path}`)
            return null
        }

        return {
            name: document.name,
            path: document.path,
            relativePath: document.relativePath,
            type: document.type,
            isPackage: document.isPackage === true,
            content: file.content,
            size: file.size,
            metadata: { ...(document.metadata || {}) },
            body: document.body || '',
            standardCompliant: document.standardCompliant === true,
            compatibilityWarnings: [...(document.compatibilityWarnings || [])]
        }
    }

    /**
     * 覆盖写入技能定义文件
     *
     * 只允许写入扫描阶段已发现的定义文件本身，不支持新建路径；写入前会先解析一遍内容，
     * 语法不合法直接拒绝，不会落盘。
     * @param {string} skillName - 技能名称或相对路径
     * @param {string} content - 完整的新内容（含 frontmatter）
     * @param {{strictStandard?:boolean}} [options] - 是否强制 Agent Skills 标准校验
     * @returns {{ok: true, name: string, relativePath: string, size: number}|{ok: false, error: string, status?: number}} 写入结果
     */
    writeSkillSource(skillName, content, options = {}) {
        const document = this.getDocumentByName(skillName)
        if (!document) {
            return { ok: false, error: `技能 ${skillName} 不存在`, status: 404 }
        }

        if (typeof content !== 'string') {
            return { ok: false, error: '内容必须是字符串', status: 400 }
        }
        const contentSize = Buffer.byteLength(content, 'utf8')
        const maxFileBytes = this.getMaxFileBytes()
        if (contentSize > maxFileBytes) {
            return {
                ok: false,
                error: `内容大小 ${contentSize} 字节超出上限 ${maxFileBytes} 字节`,
                status: 400
            }
        }

        const validation = validateSkillSource(document.type, content, {
            directoryName: document.isPackage ? path.basename(document.directory) : undefined,
            strictStandard: false
        })
        if (!validation.valid) {
            return { ok: false, error: validation.error, status: 400, validation }
        }

        const currentDeclaredName = document.metadata?.name
        const nextDeclaredName = validation.metadata?.name
        if (!isDeepStrictEqual(currentDeclaredName, nextDeclaredName)) {
            return {
                ok: false,
                errorCode: 'SKILL_NAME_IMMUTABLE',
                error: '不允许通过编辑器修改 metadata.name；技能包 metadata.name 必须保持不变且与父目录同名，请新建技能后迁移内容',
                status: 409,
                validation
            }
        }

        const directoryName = document.isPackage ? path.basename(document.directory) : undefined
        const currentStandard = validateAgentSkillMetadata(document.metadata || {}, { directoryName })
        const introducedErrors = (validation.errors || []).filter(error => !currentStandard.errors.includes(error))
        if (introducedErrors.length > 0) {
            return {
                ok: false,
                error: `编辑引入了新的 Agent Skills 规范错误: ${introducedErrors.join('; ')}`,
                status: 400,
                validation
            }
        }
        if (options.strictStandard === true && currentStandard.standardCompliant && !validation.standardCompliant) {
            return {
                ok: false,
                error: `Agent Skills 定义不符合规范: ${validation.errors.join('; ')}`,
                status: 400,
                validation
            }
        }

        const prepared = this._prepareWrite(document.path, content, document.definitionIdentity)
        if (!prepared.ok) {
            return { ok: false, error: prepared.error, status: 400 }
        }

        const written = this._writeTextFileAtomic(prepared.realPath, content, {
            expectedParent: prepared.realParent,
            parentIdentity: prepared.parentIdentity,
            targetIdentity: prepared.targetIdentity
        })
        if (!written.ok) {
            return { ok: false, error: `写入失败: ${written.error}`, status: 500 }
        }
        this._refreshDocumentAfterMutation(document)

        // name 是稳定标识，不允许编辑器改写；调用方可继续使用原名称刷新当前技能。
        return {
            ok: true,
            name: document.name,
            relativePath: document.relativePath,
            size: written.size,
            standardCompliant: validation.standardCompliant === true,
            compatibilityWarnings: validation.warnings || []
        }
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
        const resolved = this._resolveManagedPackageTarget(skillName, relativePath, { mustExist: true })
        if (!resolved.ok) return resolved

        const prepared = this._prepareWrite(resolved.targetPath, content, resolved.targetIdentity)
        if (!prepared.ok) {
            return { ok: false, error: prepared.error, status: 400 }
        }

        const written = this._writeTextFileAtomic(prepared.realPath, content, {
            expectedParent: prepared.realParent,
            parentIdentity: prepared.parentIdentity,
            targetIdentity: prepared.targetIdentity
        })
        if (!written.ok) {
            return { ok: false, error: `写入失败: ${written.error}`, status: 500 }
        }
        const refreshed = this._refreshDocumentAfterMutation(resolved.document)
        const entry = refreshed?.files?.find(file => file.path === resolved.path)
        return {
            ok: true,
            path: resolved.path,
            size: written.size,
            file: entry ? this._toPublicPackageFile(entry) : undefined
        }
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

        // progressive 是发现层：始终展示全部技能的 name/description，模型再按需读取或加载。
        // 完整正文与工具约束仍只作用于显式加载或确定匹配的技能。
        const docs =
            isProgressive && !Array.isArray(options.selectedNames)
                ? this.getMatchingDocuments({ ...options, mode: 'all' })
                : this.getMatchingDocuments(options)
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
