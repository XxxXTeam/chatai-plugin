import { databaseService } from './DatabaseService.js'
import { memoryService } from '../memory/MemoryService.js'

const TAG_DEFINITION_PATTERN =
    /<\s*([\p{Script=Han}A-Za-z_][\p{Script=Han}A-Za-z0-9_-]*?(?:变化|增减))\s*:\s*([+-]?X)\s*>/gu
const TAG_VALUE_PATTERN =
    /<\s*([\p{Script=Han}A-Za-z_][\p{Script=Han}A-Za-z0-9_-]*?(?:变化|增减))\s*:\s*([+-]?\d+)\s*>/gu
const DEFAULT_MIN = -100
const DEFAULT_MAX = 100
const MEMORY_CATEGORY = 'custom'
const MEMORY_SOURCE = 'auto'
const MEMORY_METADATA_TYPE = 'personal_dynamic_tag'

/**
 * 从预设提示词中提取动态数值标签定义。
 * @param {string} prompt - 当前生效的预设提示词
 * @returns {Map<string, { outputName: string, stateName: string }>}
 */
export function parsePersonalTagDefinitions(prompt) {
    const definitions = new Map()
    for (const match of String(prompt || '').matchAll(TAG_DEFINITION_PATTERN)) {
        const outputName = match[1]
        const stateName = outputName.replace(/(?:变化|增减)$/u, '')
        definitions.set(outputName, { outputName, stateName })
    }
    return definitions
}

/**
 * 解析模型回复中的动态标签并从显示文本中移除。
 * @param {string} text - 模型回复文本
 * @param {Map<string, { outputName: string, stateName: string }>} definitions - 标签定义
 * @returns {{ text: string, changes: Array<{ outputName: string, stateName: string, delta: number }> }}
 */
export function parsePersonalTagChanges(text, definitions) {
    const changes = []
    const cleanText = String(text || '').replace(TAG_VALUE_PATTERN, (full, outputName, rawValue) => {
        const definition = definitions.get(outputName)
        if (!definition) return full
        changes.push({ ...definition, delta: Number.parseInt(rawValue, 10) })
        return ''
    })
    return { text: cleanText.trim(), changes }
}

/**
 * 将动态标签变化累加到用户全局状态，并同步为结构化个人记忆。
 * @param {string} userId - 用户标识
 * @param {Array<{ outputName: string, stateName: string, delta: number }>} changes - 标签变化
 * @returns {Promise<Record<string, number>>} 更新后的标签状态
 */
export async function applyPersonalTagChanges(userId, changes) {
    const normalizedUserId = String(userId || '').trim()
    if (!normalizedUserId || !Array.isArray(changes) || changes.length === 0) return {}

    const key = `personal-tags:${normalizedUserId}`
    const state = databaseService.getKV(key, {}) || {}
    const changedNames = new Set()
    for (const change of changes) {
        const current = Number(state[change.stateName]) || 0
        state[change.stateName] = Math.max(DEFAULT_MIN, Math.min(DEFAULT_MAX, current + change.delta))
        changedNames.add(change.stateName)
    }
    databaseService.setKV(key, state)

    const memories = await memoryService.getMemoriesByUser(normalizedUserId, {
        category: MEMORY_CATEGORY,
        includeInactive: true,
        limit: 1000
    })
    const tagMemories = new Map(
        memories
            .filter(memory => memory.metadata?.type === MEMORY_METADATA_TYPE && memory.metadata?.stateName)
            .map(memory => [memory.metadata.stateName, memory])
    )

    for (const stateName of changedNames) {
        const value = state[stateName]
        const content = `${stateName}: ${value}`
        const metadata = { type: MEMORY_METADATA_TYPE, stateName, value }
        const existing = tagMemories.get(stateName)
        if (existing) {
            await memoryService.updateMemory(existing.id, {
                content,
                metadata,
                isActive: 1
            })
        } else {
            await memoryService.saveMemory({
                userId: normalizedUserId,
                category: MEMORY_CATEGORY,
                content,
                source: MEMORY_SOURCE,
                confidence: 1,
                metadata
            })
        }
    }

    return state
}

/**
 * 构建供模型读取的用户动态标签上下文。
 * @param {string} userId - 用户标识
 * @returns {string} 系统提示片段
 */
export function buildPersonalTagContext(userId) {
    const normalizedUserId = String(userId || '').trim()
    if (!normalizedUserId) return ''
    const state = databaseService.getKV(`personal-tags:${normalizedUserId}`, {}) || {}
    const entries = Object.entries(state)
    if (entries.length === 0) return ''
    return `\n【当前用户动态标签】\n${entries.map(([name, value]) => `- ${name}: ${value}`).join('\n')}\n`
}
