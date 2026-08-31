/**
 * Skill 压缩包导入器
 *
 * 把上传的 zip 解压成一个完整的 skill 包放进技能目录。zip 解压是典型的高危操作，
 * 这里的防护分四类，全部为「拒绝整包」而非「跳过条目」——静默跳过会让用户以为导入
 * 完整、实际却缺文件，出问题时更难排查：
 *
 * 1. 路径逃逸（Zip Slip）：条目名可以是 ../../../etc/cron.d/pwn。除了在条目名层面
 *    拒绝 .. 与绝对路径，落盘前还会对 path.resolve 的结果再做一次前缀校验，两道独立；
 * 2. 符号链接条目：zip 能保存 symlink，解开后即是一条指向包外的写入通道，直接拒绝；
 * 3. 解压炸弹：条目数、单条目解压后大小、总解压大小三重上限。声明大小与实际读出的
 *    字节数都要过一遍，防止头部声明撒谎；
 * 4. 内容约束：必须且只能含一个定义入口；普通资源走扩展名白名单，scripts/ 仅允许文本脚本且落盘后不赋执行位。
 *
 * 落盘采用两阶段：先解到 temp/ 下的暂存目录，全部校验通过后再整体 rename 到位，
 * 中途失败不会在技能目录里留下半个包。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import YAML from 'yaml'
import { chatLogger } from '../../core/utils/logger.js'
import { ensureDirectoryWithinRoot, isPathWithin, validateSkillSource } from './SkillDocumentLoader.js'

const logger = chatLogger

/** 上传的 zip 文件大小上限 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** 压缩包内条目总数上限 */
const MAX_ENTRIES = 200

/** 单个条目解压后的大小上限 */
const MAX_ENTRY_BYTES = 2 * 1024 * 1024

/** 整包解压后的总大小上限 */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024

/** 条目路径相对包根的深度上限 */
const MAX_ENTRY_DEPTH = 5

/*
 * 允许解压的扩展名白名单。
 *
 * 普通目录只收纯文本与位图；脚本扩展名由 scripts/ 的独立白名单处理，.svg 仍拒绝。
 */
const ALLOWED_ENTRY_EXTENSIONS = new Set([
    '.md',
    '.markdown',
    '.txt',
    '.yaml',
    '.yml',
    '.json',
    '.csv',
    '.tsv',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp'
])

/** scripts/ 仅在整包安装时允许落盘，管理 API 仍保持只读且不会执行它们 */
const ALLOWED_SCRIPT_EXTENSIONS = new Set([
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.py',
    '.sh',
    '.bash',
    '.zsh',
    '.ps1',
    '.bat',
    '.cmd',
    '.rb',
    '.pl',
    '.lua'
])

/** skill 目录名白名单：必须以字母数字开头，因此天然排除 . 与 .. */
const SKILL_DIR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** 技能包的入口文件名 */
const ENTRY_SKILL_FILE = 'SKILL.md'
const FOLDER_SKILL_FILES = new Set(['skill.yaml', 'skill.yml', 'skill.json'])

/** POSIX 文件类型掩码与符号链接标志，用于识别 zip 条目的 unix mode */
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

/**
 * 导入失败的结构化错误
 * @property {string} message - 面向用户的中文原因
 * @property {number} status - 建议的 HTTP 状态码
 * @property {object} [detail] - 附加信息，例如冲突时的已存在技能名
 */
export class SkillImportError extends Error {
    /**
     * @param {string} message - 失败原因
     * @param {number} [status] - HTTP 状态码
     * @param {object} [detail] - 附加信息
     */
    constructor(message, status = 400, detail = undefined) {
        super(message)
        this.name = 'SkillImportError'
        this.status = status
        this.detail = detail
    }
}

/**
 * 判断 zip 条目是否为符号链接
 *
 * adm-zip 的 attr 高 16 位是 unix mode（仅当压缩包由 Unix 工具创建时有效，
 * Windows 侧创建的包该段为 0，此时按普通文件处理）。
 * @param {object} entry - adm-zip 条目
 * @returns {boolean} 是否为符号链接
 */
function isSymlinkEntry(entry) {
    const mode = (entry.attr || 0) >>> 16
    if (!mode) return false
    return (mode & S_IFMT) === S_IFLNK
}

/**
 * 规范化 zip 条目名并拒绝一切危险形态
 * @param {string} rawName - 条目原始名称
 * @returns {string} 规范化后的相对路径（以 / 分隔）
 * @throws {SkillImportError} 条目名为绝对路径、含 .. 段或为空时抛出
 */
function normalizeEntryName(rawName) {
    const name = String(rawName || '')
        .replace(/\\/g, '/')
        .trim()
    if (!name) {
        throw new SkillImportError('压缩包内存在空的条目名')
    }
    if (name.startsWith('/') || /^[A-Za-z]:\//.test(name)) {
        throw new SkillImportError(`压缩包内含绝对路径条目，已拒绝: ${rawName}`)
    }
    const segments = name.split('/').filter(segment => segment !== '')
    for (const segment of segments) {
        if (segment === '..' || segment === '.') {
            throw new SkillImportError(`压缩包内含路径穿越条目，已拒绝: ${rawName}`)
        }
        if (segment.includes('\0')) {
            throw new SkillImportError(`压缩包内含非法条目名，已拒绝: ${rawName}`)
        }
    }
    if (segments.length === 0) {
        throw new SkillImportError('压缩包内存在空的条目名')
    }
    return segments.join('/')
}

/**
 * 计算所有条目共有的顶层目录前缀
 *
 * 常见的打包方式是把整个 skill 目录塞进 zip（`my-skill/SKILL.md`），也有人在包根直接
 * 放 SKILL.md。这里把前一种的外层目录剥掉，两种形态统一成「包根即 SKILL.md 所在层」。
 * @param {string[]} names - 已规范化的条目名列表
 * @returns {string} 共有顶层目录名；无共有前缀时返回空字符串
 */
function detectRootPrefix(names) {
    if (names.length === 0) return ''
    let prefix = null
    for (const name of names) {
        const segments = name.split('/')
        if (segments.length < 2) return ''
        if (prefix === null) {
            prefix = segments[0]
        } else if (prefix !== segments[0]) {
            return ''
        }
    }
    return prefix || ''
}

/**
 * 从 SKILL.md 内容里取 frontmatter 声明的技能名
 * @param {string} content - SKILL.md 全文
 * @returns {string} 技能名；无法解析时返回空字符串
 */
function readSkillNameFromContent(content) {
    const match = String(content || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
    if (!match) return ''
    try {
        const metadata = YAML.parse(match[1])
        if (metadata && typeof metadata === 'object' && typeof metadata.name === 'string') {
            return metadata.name.trim()
        }
    } catch {
        return ''
    }
    return ''
}

/**
 * 把任意来源的名称收敛成一个安全的目录名
 *
 * 先 basename 掐掉路径成分，再走字符白名单；中文等非 ASCII 名称会被转写成 skill-<时间戳>，
 * 因为目录名要参与 URL 与跨平台文件系统，保持 ASCII 才不会在别处出问题。
 * @param {string} rawName - 原始名称
 * @returns {string} 合法的目录名；无法收敛时返回空字符串
 */
function sanitizeDirectoryName(rawName) {
    const base = path.basename(
        String(rawName || '')
            .replace(/\\/g, '/')
            .trim()
    )
    if (!base) return ''
    if (base === '.' || base === '..') return ''
    if (!SKILL_DIR_NAME_PATTERN.test(base)) return ''
    return base
}

/**
 * 逐条校验 zip 条目并读出内容
 * @param {object[]} entries - adm-zip 条目列表
 * @returns {{files: Array<{path: string, data: Buffer}>, totalBytes: number, rootPrefix: string}} 通过校验的文件内容与被剥掉的顶层目录名
 * @throws {SkillImportError} 任一条目不合规时抛出
 */
function collectEntries(entries) {
    if (entries.length === 0) {
        throw new SkillImportError('压缩包为空')
    }
    if (entries.length > MAX_ENTRIES) {
        throw new SkillImportError(`压缩包条目数 ${entries.length} 超出上限 ${MAX_ENTRIES}`)
    }

    // 第一轮：只做条目名与元信息校验，拿到规范化名称后才能推导包根前缀
    const normalized = []
    for (const entry of entries) {
        if (isSymlinkEntry(entry)) {
            throw new SkillImportError(`压缩包内含符号链接条目，已拒绝: ${entry.entryName}`)
        }
        const name = normalizeEntryName(entry.entryName)
        normalized.push({ entry, name })
    }

    const fileEntries = normalized.filter(item => !item.entry.isDirectory)
    if (fileEntries.length === 0) {
        throw new SkillImportError('压缩包内没有任何文件')
    }

    const prefix = detectRootPrefix(fileEntries.map(item => item.name))
    const files = []
    const seenPaths = new Set()
    let totalBytes = 0

    for (const item of fileEntries) {
        const relative = prefix ? item.name.slice(prefix.length + 1) : item.name
        if (!relative) {
            throw new SkillImportError(`压缩包内含无效条目: ${item.entry.entryName}`)
        }
        if (relative.split('/').length > MAX_ENTRY_DEPTH) {
            throw new SkillImportError(`条目层级过深，已拒绝: ${relative}`)
        }
        if (seenPaths.has(relative)) {
            throw new SkillImportError(`压缩包内含重复的规范化路径，已拒绝: ${relative}`)
        }
        seenPaths.add(relative)

        const extension = path.extname(relative).toLowerCase()
        const topDirectory = relative.split('/')[0]
        const allowedExtension =
            ALLOWED_ENTRY_EXTENSIONS.has(extension) ||
            (topDirectory === 'scripts' && ALLOWED_SCRIPT_EXTENSIONS.has(extension))
        if (!allowedExtension) {
            throw new SkillImportError(`不支持的文件类型，已拒绝整包: ${relative}`)
        }

        // 先看头部声明的大小，明显超限的直接拒，避免为一个炸弹包付出实际解压成本
        const declaredSize = Number(item.entry.header?.size) || 0
        if (declaredSize > MAX_ENTRY_BYTES) {
            throw new SkillImportError(
                `文件 ${relative} 解压后 ${declaredSize} 字节，超出单文件上限 ${MAX_ENTRY_BYTES}`
            )
        }

        let data
        try {
            data = item.entry.getData()
        } catch (error) {
            throw new SkillImportError(`读取条目失败: ${relative} (${error.message})`)
        }

        // 头部声明可以撒谎，实际读出的字节数必须再过一遍同样的两个上限
        if (data.length > MAX_ENTRY_BYTES) {
            throw new SkillImportError(
                `文件 ${relative} 实际大小 ${data.length} 字节，超出单文件上限 ${MAX_ENTRY_BYTES}`
            )
        }
        totalBytes += data.length
        if (totalBytes > MAX_TOTAL_BYTES) {
            throw new SkillImportError(`解压后总大小超出上限 ${MAX_TOTAL_BYTES} 字节`)
        }

        files.push({ path: relative, data })
    }

    if (!files.some(file => file.path === ENTRY_SKILL_FILE)) {
        throw new SkillImportError(`压缩包内缺少 ${ENTRY_SKILL_FILE}，不是有效的技能包`)
    }

    const definitionFiles = files.filter(file => {
        const baseName = path.posix.basename(file.path)
        return baseName === 'SKILL.md' || FOLDER_SKILL_FILES.has(baseName.toLowerCase())
    })
    if (definitionFiles.length !== 1 || definitionFiles[0].path !== ENTRY_SKILL_FILE) {
        throw new SkillImportError(
            `技能包必须且只能包含根目录 ${ENTRY_SKILL_FILE} 一个定义入口，当前检测到: ${definitionFiles
                .map(file => file.path)
                .join(', ')}`
        )
    }

    return { files, totalBytes, rootPrefix: prefix }
}

/**
 * 把校验通过的文件写入暂存目录
 *
 * 这是 Zip Slip 的第二道防线：条目名在 collectEntries 已经拒绝过 .. 与绝对路径，
 * 此处仍对 path.resolve 的结果做前缀校验，任一条越界即整体失败。
 * @param {Array<{path: string, data: Buffer}>} files - 待写入文件
 * @param {string} stagingDir - 暂存目录绝对路径
 * @throws {SkillImportError} 出现越界路径时抛出
 */
function writeFiles(files, stagingDir) {
    const rootWithSep = stagingDir.endsWith(path.sep) ? stagingDir : stagingDir + path.sep
    for (const file of files) {
        const resolved = path.resolve(stagingDir, file.path)
        if (resolved !== stagingDir && !resolved.startsWith(rootWithSep)) {
            throw new SkillImportError(`检测到路径穿越，已拒绝整包: ${file.path}`)
        }
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, file.data, { flag: 'wx', mode: 0o600 })
    }
}

/**
 * 递归删除目录，失败只记日志不抛出（用于清理暂存目录）
 * @param {string} target - 目标目录
 */
function cleanup(target) {
    try {
        fs.rmSync(target, { recursive: true, force: true })
    } catch (error) {
        logger.warn(`[SkillPackageImporter] 清理暂存目录失败: ${target}, ${error.message}`)
    }
}

/**
 * 从 zip 缓冲区导入一个 skill 包
 * @param {Buffer} buffer - zip 文件内容
 * @param {object} options - 导入选项
 * @param {string} options.importRoot - 技能目录绝对路径（由 SkillDocumentLoader.getImportRoot 提供）
 * @param {string} options.tempRoot - 暂存与备份根目录绝对路径
 * @param {string} [options.pluginRoot] - 插件根目录，用于约束导入、暂存与备份真实路径
 * @param {string} [options.name] - 用户指定的技能目录名
 * @param {string} [options.originalName] - 上传文件名，用于兜底推导目录名
 * @param {boolean} [options.overwrite] - 同名时是否覆盖
 * @param {string[]} [options.existingNames] - 已加载的技能名列表，用于重名检测
 * @param {object[]} [options.existingDocuments] - 已加载技能的名称与目录，用于排除覆盖目标自身
 * @param {number} [options.maxFileBytes] - SKILL.md 加载大小上限
 * @returns {{name: string, directory: string, files: string[], totalBytes: number, overwritten: boolean, backup: string|null}} 导入结果
 * @throws {SkillImportError} 任一校验不通过时抛出
 */
export function importSkillPackage(buffer, options = {}) {
    const {
        importRoot,
        tempRoot,
        pluginRoot,
        name,
        originalName,
        overwrite = false,
        existingNames = [],
        existingDocuments = [],
        maxFileBytes
    } = options
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new SkillImportError('上传内容为空')
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
        throw new SkillImportError(`压缩包大小超出上限 ${MAX_UPLOAD_BYTES} 字节`)
    }
    if (!importRoot) {
        throw new SkillImportError('未找到可用的技能导入目录，请检查 skills.documents.paths 配置', 500)
    }

    let zip
    try {
        zip = new AdmZip(buffer)
    } catch (error) {
        throw new SkillImportError(`压缩包解析失败: ${error.message}`)
    }

    let entries
    try {
        entries = zip.getEntries()
    } catch (error) {
        throw new SkillImportError(`压缩包解析失败: ${error.message}`)
    }

    const { files, totalBytes, rootPrefix } = collectEntries(entries)
    const skillFile = files.find(file => file.path === ENTRY_SKILL_FILE)
    const declaredName = readSkillNameFromContent(skillFile.data.toString('utf8'))

    if (Number.isFinite(maxFileBytes) && skillFile.data.length > maxFileBytes) {
        throw new SkillImportError(
            `${ENTRY_SKILL_FILE} 大小 ${skillFile.data.length} 字节超出加载上限 ${maxFileBytes} 字节`
        )
    }

    const explicitName = typeof name === 'string' ? name.trim() : ''
    if (explicitName && explicitName !== declaredName) {
        throw new SkillImportError('显式目录名必须与 SKILL.md 的 name 完全一致')
    }

    // 安装目录优先服从 frontmatter name；zip 顶层目录只是打包容器，不能改变技能标识。
    const candidates = [declaredName, rootPrefix, String(originalName || '').replace(/\.zip$/i, '')]
    let directoryName = ''
    for (const candidate of candidates) {
        directoryName = sanitizeDirectoryName(candidate)
        if (directoryName) break
    }
    if (!directoryName) {
        directoryName = `skill-${Date.now()}`
    }

    const validation = validateSkillSource('markdown', skillFile.data.toString('utf8'), {
        directoryName,
        strictStandard: true
    })
    if (!validation.valid) {
        throw new SkillImportError(`SKILL.md 校验失败: ${validation.error}`)
    }

    let realImportRoot = ''
    let realTempRoot = ''
    try {
        if (pluginRoot) {
            realImportRoot = ensureDirectoryWithinRoot(pluginRoot, importRoot)
            realTempRoot = ensureDirectoryWithinRoot(pluginRoot, tempRoot)
        } else {
            const importStat = fs.lstatSync(importRoot)
            if (importStat.isSymbolicLink() || !importStat.isDirectory()) {
                throw new Error('导入根目录必须是普通目录，且不能是符号链接')
            }
            realImportRoot = fs.realpathSync(importRoot)
            fs.mkdirSync(tempRoot, { recursive: true, mode: 0o700 })
            const tempStat = fs.lstatSync(tempRoot)
            if (tempStat.isSymbolicLink() || !tempStat.isDirectory()) {
                throw new Error('暂存根目录必须是普通目录，且不能是符号链接')
            }
            realTempRoot = fs.realpathSync(tempRoot)
        }
    } catch (error) {
        throw new SkillImportError(`技能导入目录不可用: ${error.message}`, 500)
    }

    const targetDir = path.resolve(realImportRoot, directoryName)
    const targetRelative = path.relative(realImportRoot, targetDir)
    if (
        !targetRelative ||
        targetRelative === '..' ||
        targetRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(targetRelative)
    ) {
        throw new SkillImportError(`目标目录越界，已拒绝: ${directoryName}`)
    }

    const targetExists = fs.existsSync(targetDir)
    let targetIdentity = null
    if (targetExists) {
        const targetStat = fs.lstatSync(targetDir)
        if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) {
            throw new SkillImportError(`技能目录 ${directoryName} 不是普通目录，已拒绝覆盖`, 409)
        }
        targetIdentity = { dev: targetStat.dev, ino: targetStat.ino }
    }
    if (targetExists && !overwrite) {
        throw new SkillImportError(`技能目录 ${directoryName} 已存在`, 409, { directory: directoryName, exists: true })
    }

    // 目录不同但技能名相同同样是冲突：getDocumentByName 只会命中先加载的那个，
    // 放任重名会让「编辑 A 却改到 B」这类问题在面板上完全看不出来
    const conflictsWithOtherDirectory = existingDocuments.some(document => {
        if (document?.name !== declaredName) return false
        const existingDirectoryName = document.directoryName || path.basename(document.directory || '')
        return existingDirectoryName !== directoryName
    })
    if (conflictsWithOtherDirectory || (!targetExists && declaredName && existingNames.includes(declaredName))) {
        throw new SkillImportError(`已存在同名技能 ${declaredName}，请先重命名或删除`, 409, {
            skillName: declaredName,
            exists: true
        })
    }

    let importRootIdentity
    let tempRootIdentity
    let stagingDir = ''
    let realStagingDir = ''
    let stagingIdentity
    try {
        importRootIdentity = fs.statSync(realImportRoot)
        tempRootIdentity = fs.statSync(realTempRoot)
        stagingDir = fs.mkdtempSync(path.join(realTempRoot, `import-${randomUUID()}-`))
        realStagingDir = fs.realpathSync(stagingDir)
        if (!isPathWithin(realTempRoot, realStagingDir)) {
            throw new Error('技能暂存目录真实路径越界')
        }
        const stagingStat = fs.statSync(realStagingDir)
        stagingIdentity = { dev: stagingStat.dev, ino: stagingStat.ino }
    } catch (error) {
        if (stagingDir) cleanup(stagingDir)
        throw new SkillImportError(`创建技能暂存目录失败: ${error.message}`, 500)
    }
    let backupDir = null
    let backupContainer = null

    try {
        const currentImportRoot = fs.statSync(realImportRoot)
        const currentTempRoot = fs.statSync(realTempRoot)
        if (
            currentImportRoot.dev !== importRootIdentity.dev ||
            currentImportRoot.ino !== importRootIdentity.ino ||
            currentTempRoot.dev !== tempRootIdentity.dev ||
            currentTempRoot.ino !== tempRootIdentity.ino
        ) {
            throw new SkillImportError('技能导入目录在操作期间已被替换', 409)
        }

        writeFiles(files, realStagingDir)

        const finalImportRootStat = fs.lstatSync(realImportRoot)
        const finalTempRootStat = fs.lstatSync(realTempRoot)
        if (
            finalImportRootStat.isSymbolicLink() ||
            finalTempRootStat.isSymbolicLink() ||
            finalImportRootStat.dev !== importRootIdentity.dev ||
            finalImportRootStat.ino !== importRootIdentity.ino ||
            finalTempRootStat.dev !== tempRootIdentity.dev ||
            finalTempRootStat.ino !== tempRootIdentity.ino
        ) {
            throw new SkillImportError('技能导入目录在落位前已被替换', 409)
        }
        const finalStagingStat = fs.lstatSync(realStagingDir)
        if (
            finalStagingStat.isSymbolicLink() ||
            !finalStagingStat.isDirectory() ||
            finalStagingStat.dev !== stagingIdentity.dev ||
            finalStagingStat.ino !== stagingIdentity.ino
        ) {
            throw new SkillImportError('技能暂存目录在落位前已被替换', 409)
        }

        if (targetExists) {
            // 覆盖不做递归删除：旧目录整体挪到 temp/ 下留档，出问题还能捞回来
            const currentTarget = fs.lstatSync(targetDir)
            if (
                currentTarget.isSymbolicLink() ||
                !currentTarget.isDirectory() ||
                currentTarget.dev !== targetIdentity.dev ||
                currentTarget.ino !== targetIdentity.ino
            ) {
                throw new SkillImportError('待覆盖技能目录在导入期间已被替换', 409)
            }
            backupContainer = fs.mkdtempSync(path.join(realTempRoot, `backup-${directoryName}-${randomUUID()}-`))
            const realBackupContainer = fs.realpathSync(backupContainer)
            if (!isPathWithin(realTempRoot, realBackupContainer)) {
                throw new SkillImportError('覆盖备份目录真实路径越界', 500)
            }
            const backupRootBeforeMove = fs.lstatSync(realTempRoot)
            if (
                backupRootBeforeMove.isSymbolicLink() ||
                backupRootBeforeMove.dev !== tempRootIdentity.dev ||
                backupRootBeforeMove.ino !== tempRootIdentity.ino
            ) {
                throw new SkillImportError('覆盖备份根目录在操作期间已被替换', 409)
            }
            backupDir = path.join(realBackupContainer, directoryName)
            fs.renameSync(targetDir, backupDir)
        } else {
            try {
                fs.lstatSync(targetDir)
                throw new SkillImportError(`技能目录 ${directoryName} 在导入期间已出现`, 409)
            } catch (error) {
                if (error instanceof SkillImportError) throw error
                if (error?.code !== 'ENOENT') throw error
            }
        }

        const stagingBeforeMove = fs.lstatSync(realStagingDir)
        if (
            stagingBeforeMove.isSymbolicLink() ||
            !stagingBeforeMove.isDirectory() ||
            stagingBeforeMove.dev !== stagingIdentity.dev ||
            stagingBeforeMove.ino !== stagingIdentity.ino
        ) {
            throw new SkillImportError('技能暂存目录在最终落位前已被替换', 409)
        }

        fs.renameSync(realStagingDir, targetDir)
    } catch (error) {
        cleanup(stagingDir)
        // 落位失败时把备份挪回原处，避免用户丢掉原有技能
        if (backupDir && !fs.existsSync(targetDir)) {
            try {
                fs.renameSync(backupDir, targetDir)
                backupDir = null
                if (backupContainer) fs.rmdirSync(backupContainer)
                backupContainer = null
            } catch (restoreError) {
                logger.error(`[SkillPackageImporter] 回滚失败，备份保留在 ${backupDir}: ${restoreError.message}`)
            }
        }
        if (backupContainer && (!backupDir || !fs.existsSync(backupDir))) {
            try {
                fs.rmdirSync(backupContainer)
            } catch {}
        }
        if (error instanceof SkillImportError) throw error
        throw new SkillImportError(`写入技能目录失败: ${error.message}`, 500)
    }

    logger.info(`[SkillPackageImporter] 已导入技能包: ${directoryName} (${files.length} 个文件, ${totalBytes} 字节)`)

    return {
        name: declaredName || directoryName,
        directory: directoryName,
        files: files.map(file => file.path),
        totalBytes,
        overwritten: targetExists,
        backup: backupDir,
        recoverable: Boolean(backupDir),
        standardCompliant: validation.standardCompliant === true,
        compatibilityWarnings: validation.warnings || []
    }
}

export default importSkillPackage
