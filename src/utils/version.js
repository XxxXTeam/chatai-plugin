/**
 * 版本信息工具 - 从 Git 获取版本数据
 */

import { execSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const pluginRoot = path.join(__dirname, '../..')

/**
 * 执行 git 命令
 * @param {string} command - git 命令
 * @returns {string|null}
 */
function execGit(command) {
    try {
        return execSync(command, {
            cwd: pluginRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim()
    } catch {
        return null
    }
}

/**
 * 获取 Git 版本信息
 * @returns {Object} 版本信息
 */
export function getGitVersion() {
    const info = {
        branch: null,
        commit: null,
        commitShort: null,
        tag: null,
        version: null,
        isDirty: false,
        commitDate: null,
        commitCount: null
    }

    // 获取当前分支
    info.branch = execGit('git rev-parse --abbrev-ref HEAD')

    // 获取当前 commit hash
    info.commit = execGit('git rev-parse HEAD')
    info.commitShort = info.commit?.substring(0, 7)

    // 获取最近的 tag
    info.tag = execGit('git describe --tags --abbrev=0 2>/dev/null') || execGit('git describe --tags --abbrev=0 2>nul')

    // 获取 commit 数量（从最近 tag 或全部）
    if (info.tag) {
        info.commitCount = execGit(`git rev-list ${info.tag}..HEAD --count`)
    } else {
        info.commitCount = execGit('git rev-list HEAD --count')
    }

    // 检查是否有未提交的更改
    const status = execGit('git status --porcelain')
    info.isDirty = status && status.length > 0

    // 获取 commit 日期
    info.commitDate = execGit('git log -1 --format=%ci')

    // 构建版本字符串
    if (info.tag) {
        // 有 tag: v1.0.0 或 v1.0.0+5 (5个commit在tag之后)
        const commits = parseInt(info.commitCount) || 0
        if (commits > 0) {
            info.version = `${info.tag}+${commits}`
        } else {
            info.version = info.tag
        }
    } else if (info.commitShort) {
        // 无 tag: 直接使用 commit hash
        info.version = info.commitShort
    } else {
        info.version = 'unknown'
    }
    if (info.isDirty) {
        info.version += '-dirty'
    }

    return info
}

/**
 * 获取格式化的版本字符串
 * @returns {string}
 */
export function getVersionString() {
    const git = getGitVersion()
    return git.version || 'unknown'
}

/**
 * 获取完整版本信息
 * @returns {Object}
 */
export function getFullVersionInfo() {
    const git = getGitVersion()
    let packageName = 'ChatAI'
    let packageVersion = '1.0.0'
    try {
        const pkgPath = path.join(pluginRoot, 'package.json')
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
            packageName = pkg.name || packageName
            packageVersion = pkg.version || packageVersion
        }
    } catch {}

    return {
        name: 'ChatAI',
        packageVersion,
        gitVersion: git.version,
        branch: git.branch,
        commit: git.commitShort,
        commitFull: git.commit,
        tag: git.tag,
        isDirty: git.isDirty,
        commitDate: git.commitDate,
        displayVersion: git.version || packageVersion
    }
}

export default {
    getGitVersion,
    getVersionString,
    getFullVersionInfo
}
