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
 * 4. 内容约束：必须含 SKILL.md，扩展名白名单，可执行文件一律拒绝。
 *
 * 落盘采用两阶段：先解到 temp/ 下的暂存目录，全部校验通过后再整体 rename 到位，
 * 中途失败不会在技能目录里留下半个包。
 */
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import YAML from 'yaml'
import { chatLogger } from '../../core/utils/logger.js'

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
 * 只收纯文本与位图：技能包的实际内容就是文档、模板和少量插图。脚本类（.js .sh .py
 * .bat 等）与 .svg 都不在其中 —— 前者是可执行文件，后者是能内嵌脚本的 XML，
 * 而技能包并不需要它们。
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

/** skill 目录名白名单：必须以字母数字开头，因此天然排除 . 与 .. */
const SKILL_DIR_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** 技能包的入口文件名 */
const ENTRY_SKILL_FILE = 'SKILL.md'

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
    let totalBytes = 0

    for (const item of fileEntries) {
        const relative = prefix ? item.name.slice(prefix.length + 1) : item.name
        if (!relative) {
            throw new SkillImportError(`压缩包内含无效条目: ${item.entry.entryName}`)
        }
        if (relative.split('/').length > MAX_ENTRY_DEPTH) {
            throw new SkillImportError(`条目层级过深，已拒绝: ${relative}`)
        }
        if (!ALLOWED_ENTRY_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
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
        fs.writeFileSync(resolved, file.data)
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
 * @param {string} [options.name] - 用户指定的技能目录名
 * @param {string} [options.originalName] - 上传文件名，用于兜底推导目录名
 * @param {boolean} [options.overwrite] - 同名时是否覆盖
 * @param {string[]} [options.existingNames] - 已加载的技能名列表，用于重名检测
 * @returns {{name: string, directory: string, files: string[], totalBytes: number, overwritten: boolean, backup: string|null}} 导入结果
 * @throws {SkillImportError} 任一校验不通过时抛出
 */
export function importSkillPackage(buffer, options = {}) {
    const { importRoot, tempRoot, name, originalName, overwrite = false, existingNames = [] } = options
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

    // 目录名来源按可信度排序：用户显式指定 > zip 顶层目录名 > frontmatter name > 上传文件名
    const candidates = [name, rootPrefix, declaredName, String(originalName || '').replace(/\.zip$/i, '')]
    let directoryName = ''
    for (const candidate of candidates) {
        directoryName = sanitizeDirectoryName(candidate)
        if (directoryName) break
    }
    if (!directoryName) {
        directoryName = `skill-${Date.now()}`
    }

    const targetDir = path.resolve(importRoot, directoryName)
    const importRootWithSep = importRoot.endsWith(path.sep) ? importRoot : importRoot + path.sep
    if (!targetDir.startsWith(importRootWithSep)) {
        throw new SkillImportError(`目标目录越界，已拒绝: ${directoryName}`)
    }

    const targetExists = fs.existsSync(targetDir)
    if (targetExists && !overwrite) {
        throw new SkillImportError(`技能目录 ${directoryName} 已存在`, 409, { directory: directoryName, exists: true })
    }

    // 目录不同但技能名相同同样是冲突：getDocumentByName 只会命中先加载的那个，
    // 放任重名会让「编辑 A 却改到 B」这类问题在面板上完全看不出来
    if (!targetExists && declaredName && existingNames.includes(declaredName)) {
        throw new SkillImportError(`已存在同名技能 ${declaredName}，请先重命名或删除`, 409, {
            skillName: declaredName,
            exists: true
        })
    }

    fs.mkdirSync(tempRoot, { recursive: true })
    const stagingDir = fs.mkdtempSync(path.join(tempRoot, 'import-'))
    let backupDir = null

    try {
        writeFiles(files, stagingDir)

        if (targetExists) {
            // 覆盖不做递归删除：旧目录整体挪到 temp/ 下留档，出问题还能捞回来
            backupDir = path.join(tempRoot, `backup-${directoryName}-${Date.now()}`)
            fs.renameSync(targetDir, backupDir)
        }

        fs.mkdirSync(path.dirname(targetDir), { recursive: true })
        fs.renameSync(stagingDir, targetDir)
    } catch (error) {
        cleanup(stagingDir)
        // 落位失败时把备份挪回原处，避免用户丢掉原有技能
        if (backupDir && !fs.existsSync(targetDir)) {
            try {
                fs.renameSync(backupDir, targetDir)
                backupDir = null
            } catch (restoreError) {
                logger.error(`[SkillPackageImporter] 回滚失败，备份保留在 ${backupDir}: ${restoreError.message}`)
            }
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
        backup: backupDir
    }
}

export default importSkillPackage
