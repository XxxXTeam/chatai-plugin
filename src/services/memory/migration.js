/**
 * 记忆数据迁移脚本
 * 将旧的 memories 表数据迁移到新的 structured_memories 表
 */
import { chatLogger } from '../../core/utils/logger.js'
import { databaseService } from '../storage/DatabaseService.js'
import { memoryService } from './MemoryService.js'
import { MemoryCategory, MemorySource } from './MemoryTypes.js'

const logger = chatLogger

/**
 * 分类推断规则
 * 根据内容关键词推断记忆分类
 */
const CategoryRules = [
    // 基本信息
    { pattern: /(?:叫|名字是|姓|名叫|称呼)/i, category: MemoryCategory.PROFILE, subType: 'name' },
    { pattern: /(?:\d+岁|年龄|岁数)/i, category: MemoryCategory.PROFILE, subType: 'age' },
    { pattern: /(?:性别|男|女|性向)/i, category: MemoryCategory.PROFILE, subType: 'gender' },
    {
        pattern: /(?:在|住|来自|坐标|位置|所在)(?:[\u4e00-\u9fa5]{2,10})/i,
        category: MemoryCategory.PROFILE,
        subType: 'location'
    },
    {
        pattern: /(?:职业|工作|从事|做|是一(?:名|个|位))(?:[\u4e00-\u9fa5]{2,15})/i,
        category: MemoryCategory.PROFILE,
        subType: 'occupation'
    },
    { pattern: /(?:学历|毕业|上学|学校|大学|高中)/i, category: MemoryCategory.PROFILE, subType: 'education' },

    // 偏好习惯
    { pattern: /(?:喜欢|爱|热爱|钟爱)/i, category: MemoryCategory.PREFERENCE, subType: 'like' },
    { pattern: /(?:讨厌|不喜欢|烦|厌恶)/i, category: MemoryCategory.PREFERENCE, subType: 'dislike' },
    { pattern: /(?:爱好|兴趣)/i, category: MemoryCategory.PREFERENCE, subType: 'hobby' },
    { pattern: /(?:习惯|经常|总是)/i, category: MemoryCategory.PREFERENCE, subType: 'habit' },
    { pattern: /(?:吃|喝|食物|美食|餐)/i, category: MemoryCategory.PREFERENCE, subType: 'food' },

    // 重要事件
    { pattern: /(?:生日|出生)(?:是)?(?:\d{1,2}月\d{1,2})?/i, category: MemoryCategory.EVENT, subType: 'birthday' },
    { pattern: /(?:纪念日|周年|结婚)/i, category: MemoryCategory.EVENT, subType: 'anniversary' },
    { pattern: /(?:计划|打算|准备|想要)/i, category: MemoryCategory.EVENT, subType: 'plan' },

    // 人际关系
    { pattern: /(?:家人|父母|爸|妈|兄弟|姐妹|儿子|女儿)/i, category: MemoryCategory.RELATION, subType: 'family' },
    { pattern: /(?:朋友|好友|闺蜜|哥们)/i, category: MemoryCategory.RELATION, subType: 'friend' },
    { pattern: /(?:同事|同学|同僚)/i, category: MemoryCategory.RELATION, subType: 'colleague' },
    { pattern: /(?:男朋友|女朋友|对象|伴侣|老婆|老公|爱人)/i, category: MemoryCategory.RELATION, subType: 'partner' },
    { pattern: /(?:宠物|猫|狗|养)/i, category: MemoryCategory.RELATION, subType: 'pet' },

    // 话题兴趣
    { pattern: /(?:感兴趣|关注|在意)/i, category: MemoryCategory.TOPIC, subType: 'interest' },
    { pattern: /(?:讨论|聊过|说过|提到)/i, category: MemoryCategory.TOPIC, subType: 'discussed' }
]

/**
 * 推断记忆分类
 */
function inferCategory(content) {
    for (const rule of CategoryRules) {
        if (rule.pattern.test(content)) {
            return {
                category: rule.category,
                subType: rule.subType
            }
        }
    }
    // 默认为自定义分类
    return {
        category: MemoryCategory.CUSTOM,
        subType: null
    }
}

/**
 * 迁移单个用户的记忆
 */
async function migrateUserMemories(userId, oldMemories) {
    let migratedCount = 0
    let skippedCount = 0

    for (const oldMem of oldMemories) {
        try {
            const { category, subType } = inferCategory(oldMem.content)

            await memoryService.saveMemory({
                userId,
                category,
                subType,
                content: oldMem.content,
                confidence: oldMem.importance || oldMem.score || 0.7,
                source: MemorySource.MIGRATION,
                metadata: {
                    migratedFrom: 'memories',
                    originalId: oldMem.id,
                    originalTimestamp: oldMem.timestamp,
                    originalSource: oldMem.source || oldMem.metadata?.source
                }
            })
            migratedCount++
        } catch (error) {
            logger.debug(`[Migration] 迁移记忆失败 (用户: ${userId}):`, error.message)
            skippedCount++
        }
    }

    return { migratedCount, skippedCount }
}

/**
 * 执行完整迁移
 */
export async function runMigration(options = {}) {
    const { dryRun = false, clearExisting = false } = options

    logger.info('[Migration] 开始记忆数据迁移...')

    try {
        databaseService.init()
        await memoryService.init()

        const db = databaseService.db

        // 检查旧表是否存在
        const oldTableExists = db
            .prepare(
                `
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='memories'
        `
            )
            .get()

        if (!oldTableExists) {
            logger.info('[Migration] 旧记忆表不存在，无需迁移')
            return { success: true, message: '无需迁移' }
        }

        // 获取所有旧记忆
        const oldMemories = db
            .prepare(
                `
            SELECT * FROM memories ORDER BY user_id, timestamp DESC
        `
            )
            .all()

        if (oldMemories.length === 0) {
            logger.info('[Migration] 旧记忆表为空，无需迁移')
            return { success: true, message: '无数据需要迁移' }
        }

        logger.info(`[Migration] 发现 ${oldMemories.length} 条旧记忆`)

        if (dryRun) {
            // 模拟迁移
            const userMemoriesMap = new Map()
            for (const mem of oldMemories) {
                if (!userMemoriesMap.has(mem.user_id)) {
                    userMemoriesMap.set(mem.user_id, [])
                }
                userMemoriesMap.get(mem.user_id).push(mem)
            }

            const preview = []
            for (const [userId, memories] of userMemoriesMap) {
                const sample = memories.slice(0, 3).map(m => {
                    const { category, subType } = inferCategory(m.content)
                    return { content: m.content.substring(0, 50), category, subType }
                })
                preview.push({ userId, count: memories.length, sample })
            }

            return {
                success: true,
                dryRun: true,
                totalMemories: oldMemories.length,
                userCount: userMemoriesMap.size,
                preview
            }
        }

        // 清空现有数据（如果指定）
        if (clearExisting) {
            db.prepare('DELETE FROM structured_memories').run()
            logger.info('[Migration] 已清空现有结构化记忆')
        }

        // 按用户分组迁移
        const userMemoriesMap = new Map()
        for (const mem of oldMemories) {
            if (!userMemoriesMap.has(mem.user_id)) {
                userMemoriesMap.set(mem.user_id, [])
            }
            userMemoriesMap.get(mem.user_id).push(mem)
        }

        let totalMigrated = 0
        let totalSkipped = 0
        const results = []

        for (const [userId, memories] of userMemoriesMap) {
            const result = await migrateUserMemories(userId, memories)
            totalMigrated += result.migratedCount
            totalSkipped += result.skippedCount
            results.push({ userId, ...result })
        }

        logger.info(`[Migration] 迁移完成: ${totalMigrated} 条成功, ${totalSkipped} 条跳过`)

        return {
            success: true,
            totalMemories: oldMemories.length,
            migratedCount: totalMigrated,
            skippedCount: totalSkipped,
            userCount: userMemoriesMap.size,
            results
        }
    } catch (error) {
        logger.error('[Migration] 迁移失败:', error)
        return {
            success: false,
            error: error.message
        }
    }
}

/**
 * 检查迁移状态
 */
export async function checkMigrationStatus() {
    databaseService.init()
    const db = databaseService.db

    const oldCount = db.prepare('SELECT COUNT(*) as count FROM memories').get()?.count || 0
    const newCount = db.prepare('SELECT COUNT(*) as count FROM structured_memories').get()?.count || 0
    const migratedCount =
        db
            .prepare(
                `
        SELECT COUNT(*) as count FROM structured_memories 
        WHERE source = 'migration'
    `
            )
            .get()?.count || 0

    return {
        oldTableCount: oldCount,
        newTableCount: newCount,
        migratedCount,
        needsMigration: oldCount > 0 && migratedCount === 0
    }
}

export default {
    runMigration,
    checkMigrationStatus,
    inferCategory
}
