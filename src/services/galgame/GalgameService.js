/**
 * @fileoverview Galgame 对话游戏服务
 * @module services/galgame/GalgameService
 * @description 提供类似 Galgame 的对话体验，支持好感度系统、事件触发、自定义剧本
 */

import { databaseService } from '../storage/DatabaseService.js'
import { LlmService } from '../llm/LlmService.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { statsService } from '../stats/StatsService.js'
import config from '../../../config/config.js'
import { enforceMaxCharacters } from '../../utils/common.js'
import chatLogger from '../../core/utils/logger.js'

// 从拆分的模块导入
import {
    OPTION_EMOJIS,
    AFFECTION_LEVELS,
    TRUST_LEVELS,
    ENVIRONMENT_PROMPT,
    INIT_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
    GOLD_CONFIG
} from './constants.js'
import {
    parseResponse,
    parseInitResponse,
    extractTextFromContent,
    processEventChoice,
    processEventWithCustomInput
} from './ResponseParser.js'
import {
    getAffectionLevel,
    getRelationshipStatus,
    buildSystemPrompt,
    buildKnownInfo,
    buildStoryProgress,
    buildOpeningPrompt
} from './PromptBuilder.js'

const gameLogger = chatLogger.tag('Game')

class GalgameService {
    constructor() {
        this.initialized = false
        this.activeSessions = new Map() // `${groupId}_${userId}` -> { characterId, lastActivity, inGame }
        this.pendingChoices = new Map() // `${groupId}_${messageId}` -> { userId, type, options, eventInfo, timestamp }
        this.triggeredEvents = new Map() // `${userId}_${characterId}` -> Set of triggered event names
    }

    /**
     * 初始化服务
     */
    async init() {
        if (this.initialized) return

        try {
            if (!databaseService.initialized) {
                await databaseService.init()
            }
            this.createGalgameTables()
            await this.restoreActiveSessions()
            this.initialized = true
            gameLogger.info('Galgame服务初始化完成')
        } catch (err) {
            gameLogger.error('初始化失败:', err.message)
            throw err
        }
    }

    /**
     * 从数据库恢复活跃会话
     */
    async restoreActiveSessions() {
        try {
            const db = databaseService.db
            const sessions = db
                .prepare(
                    `
                SELECT user_id, character_id, group_id FROM galgame_sessions 
                WHERE in_game = 1
            `
                )
                .all()

            for (const session of sessions) {
                const key = `${session.group_id || 'private'}_${session.user_id}`
                this.activeSessions.set(key, {
                    characterId: session.character_id,
                    lastActivity: Date.now(),
                    inGame: true,
                    groupId: session.group_id,
                    userId: session.user_id
                })
            }

            if (sessions.length > 0) {
                gameLogger.info(`恢复了 ${sessions.length} 个活跃游戏会话`)
            }
        } catch (err) {
            gameLogger.debug(`恢复会话失败: ${err.message}`)
        }
    }
    createGalgameTables() {
        const db = databaseService.db

        // 检查是否需要迁移旧表结构
        this.migrateSessionsTable(db)

        db.exec(`
            -- Galgame 会话表 (唯一约束: user_id + group_id)
            CREATE TABLE IF NOT EXISTS galgame_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                group_id TEXT,
                affection INTEGER DEFAULT 10,
                trust INTEGER DEFAULT 10,
                gold INTEGER DEFAULT 100,
                items TEXT DEFAULT '[]',
                relationship TEXT DEFAULT 'stranger',
                triggered_events TEXT DEFAULT '[]',
                in_game INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                settings TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_galgame_user_group ON galgame_sessions(user_id, group_id);

            -- Galgame 对话历史表
            CREATE TABLE IF NOT EXISTS galgame_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                event_type TEXT,
                event_result TEXT,
                affection_change INTEGER DEFAULT 0,
                trust_change INTEGER DEFAULT 0,
                gold_change INTEGER DEFAULT 0,
                timestamp INTEGER NOT NULL,
                FOREIGN KEY(session_id) REFERENCES galgame_sessions(id)
            );
            CREATE INDEX IF NOT EXISTS idx_galgame_history_session ON galgame_history(session_id);

            -- Galgame 角色预设表
            CREATE TABLE IF NOT EXISTS galgame_characters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                character_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                system_prompt TEXT,
                initial_message TEXT,
                created_by TEXT,
                is_public INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_galgame_char_id ON galgame_characters(character_id);
        `)

        // 迁移新字段
        this.migrateNewFields(db)
    }

    /**
     * 迁移新字段（trust, gold, items）
     */
    migrateNewFields(db) {
        try {
            // 检查sessions表是否需要添加新字段
            const columns = db.prepare(`PRAGMA table_info(galgame_sessions)`).all()
            const columnNames = columns.map(c => c.name)

            if (!columnNames.includes('trust')) {
                db.exec(`ALTER TABLE galgame_sessions ADD COLUMN trust INTEGER DEFAULT 10`)
                gameLogger.info('已添加 trust 字段')
            }
            if (!columnNames.includes('gold')) {
                db.exec(`ALTER TABLE galgame_sessions ADD COLUMN gold INTEGER DEFAULT 100`)
                gameLogger.info('已添加 gold 字段')
            }
            if (!columnNames.includes('items')) {
                db.exec(`ALTER TABLE galgame_sessions ADD COLUMN items TEXT DEFAULT '[]'`)
                gameLogger.info('已添加 items 字段')
            }

            // 检查history表是否需要添加新字段
            const historyColumns = db.prepare(`PRAGMA table_info(galgame_history)`).all()
            const historyColumnNames = historyColumns.map(c => c.name)

            if (!historyColumnNames.includes('trust_change')) {
                db.exec(`ALTER TABLE galgame_history ADD COLUMN trust_change INTEGER DEFAULT 0`)
            }
            if (!historyColumnNames.includes('gold_change')) {
                db.exec(`ALTER TABLE galgame_history ADD COLUMN gold_change INTEGER DEFAULT 0`)
            }
        } catch (err) {
            gameLogger.debug(`字段迁移检查: ${err.message}`)
        }
    }

    /**
     * 迁移旧表结构 (移除 UNIQUE(user_id, character_id) 约束)
     */
    migrateSessionsTable(db) {
        try {
            // 检查旧表是否存在
            const tableInfo = db
                .prepare(
                    `
                SELECT sql FROM sqlite_master WHERE type='table' AND name='galgame_sessions'
            `
                )
                .get()

            if (!tableInfo) return // 表不存在，无需迁移

            // 检查是否有旧的 UNIQUE 约束
            if (tableInfo.sql && tableInfo.sql.includes('UNIQUE(user_id, character_id)')) {
                gameLogger.info('检测到旧表结构，开始迁移...')

                // 禁用外键检查，重建表
                db.exec(`PRAGMA foreign_keys = OFF;`)

                db.exec(`
                    -- 备份旧数据
                    CREATE TABLE IF NOT EXISTS galgame_sessions_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id TEXT NOT NULL,
                        character_id TEXT NOT NULL,
                        group_id TEXT,
                        affection INTEGER DEFAULT 10,
                        relationship TEXT DEFAULT 'stranger',
                        triggered_events TEXT DEFAULT '[]',
                        in_game INTEGER DEFAULT 0,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        settings TEXT
                    );
                    
                    -- 复制数据
                    INSERT INTO galgame_sessions_new (id, user_id, character_id, group_id, affection, relationship, triggered_events, in_game, created_at, updated_at, settings)
                    SELECT id, user_id, character_id, 
                           group_id,
                           COALESCE(affection, 10), 
                           COALESCE(relationship, 'stranger'),
                           COALESCE(triggered_events, '[]'),
                           COALESCE(in_game, 0),
                           created_at, updated_at, settings
                    FROM galgame_sessions;
                    
                    -- 删除旧表
                    DROP TABLE galgame_sessions;
                    
                    -- 重命名新表
                    ALTER TABLE galgame_sessions_new RENAME TO galgame_sessions;
                    
                    -- 创建新索引
                    CREATE INDEX IF NOT EXISTS idx_galgame_user_group ON galgame_sessions(user_id, group_id);
                `)

                db.exec(`PRAGMA foreign_keys = ON;`)

                gameLogger.info('表结构迁移完成')
            }
        } catch (err) {
            gameLogger.warn(`表迁移检查失败: ${err.message}`)
            // 确保外键检查恢复
            try {
                db.exec(`PRAGMA foreign_keys = ON;`)
            } catch (e) {}
        }
    }

    /**
     * 检查用户是否在游戏模式中
     */
    isUserInGame(groupId, userId) {
        const key = `${groupId || 'private'}_${userId}`
        const session = this.activeSessions.get(key)
        return session?.inGame === true
    }

    /**
     * 设置用户游戏状态
     * 隔离策略: groupId + userId
     */
    async setUserGameState(groupId, userId, characterId, inGame = true) {
        const key = `${groupId || 'private'}_${userId}`
        this.activeSessions.set(key, {
            characterId,
            lastActivity: Date.now(),
            inGame,
            groupId,
            userId
        })

        // 持久化到数据库 - 按 groupId + userId 更新
        try {
            await this.init()
            const db = databaseService.db

            // 先确保会话存在
            const session = await this.getOrCreateSession(userId, characterId, groupId)

            // 更新会话状态
            db.prepare(
                `
                UPDATE galgame_sessions SET in_game = ?, character_id = ?, updated_at = ?
                WHERE id = ?
            `
            ).run(inGame ? 1 : 0, characterId, Date.now(), session.id)
        } catch (err) {
            gameLogger.debug(`持久化游戏状态失败: ${err.message}`)
        }
    }

    /**
     * 获取用户当前游戏会话
     */
    getUserGameSession(groupId, userId) {
        const key = `${groupId || 'private'}_${userId}`
        return this.activeSessions.get(key)
    }

    /**
     * 退出游戏模式
     */
    async exitGame(groupId, userId) {
        const key = `${groupId || 'private'}_${userId}`
        const session = this.activeSessions.get(key)
        this.activeSessions.delete(key)

        // 持久化到数据库 - 清除该用户在该群组的所有活跃会话
        try {
            await this.init()
            const db = databaseService.db
            db.prepare(
                `
                UPDATE galgame_sessions SET in_game = 0, updated_at = ?
                WHERE user_id = ? AND (group_id = ? OR (group_id IS NULL AND ? IS NULL))
            `
            ).run(Date.now(), userId, groupId, groupId)
        } catch (err) {
            gameLogger.debug(`持久化退出状态失败: ${err.message}`)
        }
    }

    /**
     * 获取或创建会话
     * 隔离策略: groupId + userId (每个用户在每个群组只有一个会话)
     * @param {string} userId - 用户ID
     * @param {string} characterId - 角色ID (存储在会话中，不参与唯一性)
     * @param {string|null} groupId - 群组ID
     */
    async getOrCreateSession(userId, characterId = 'default', groupId = null) {
        await this.init()
        const db = databaseService.db

        // 按 groupId + userId 查询（不含 characterId）
        let session
        if (groupId) {
            session = db
                .prepare(
                    `
                SELECT * FROM galgame_sessions WHERE user_id = ? AND group_id = ?
            `
                )
                .get(userId, groupId)
        } else {
            session = db
                .prepare(
                    `
                SELECT * FROM galgame_sessions WHERE user_id = ? AND group_id IS NULL
            `
                )
                .get(userId)
        }

        if (!session) {
            // 创建新会话
            const now = Date.now()
            const initialGold = GOLD_CONFIG.initial || 100
            db.prepare(
                `
                INSERT INTO galgame_sessions (user_id, character_id, group_id, affection, trust, gold, items, relationship, created_at, updated_at)
                VALUES (?, ?, ?, 10, 10, ?, '[]', 'stranger', ?, ?)
            `
            ).run(userId, characterId, groupId, initialGold, now, now)

            if (groupId) {
                session = db
                    .prepare(
                        `
                    SELECT * FROM galgame_sessions WHERE user_id = ? AND group_id = ?
                `
                    )
                    .get(userId, groupId)
            } else {
                session = db
                    .prepare(
                        `
                    SELECT * FROM galgame_sessions WHERE user_id = ? AND group_id IS NULL
                `
                    )
                    .get(userId)
            }
        } else if (session.character_id !== characterId) {
            // 会话存在但角色不同，更新角色（切换角色场景）
            db.prepare(
                `
                UPDATE galgame_sessions SET character_id = ?, updated_at = ? WHERE id = ?
            `
            ).run(characterId, Date.now(), session.id)
            session.character_id = characterId
        }

        return session
    }

    /**
     * 更新好感度
     */
    async updateAffection(userId, characterId, change, groupId = null) {
        await this.init()
        const db = databaseService.db

        const session = await this.getOrCreateSession(userId, characterId, groupId)
        const newAffection = Math.max(-100, Math.min(150, session.affection + change))
        const newRelationship = getAffectionLevel(newAffection).name

        db.prepare(
            `
            UPDATE galgame_sessions 
            SET affection = ?, relationship = ?, updated_at = ?
            WHERE id = ?
        `
        ).run(newAffection, newRelationship, Date.now(), session.id)

        return {
            oldAffection: session.affection,
            newAffection,
            change,
            oldLevel: getAffectionLevel(session.affection),
            newLevel: getAffectionLevel(newAffection)
        }
    }

    /**
     * 更新信任度
     */
    async updateTrust(userId, characterId, change, groupId = null) {
        await this.init()
        const db = databaseService.db

        const session = await this.getOrCreateSession(userId, characterId, groupId)
        const oldTrust = session.trust || 0
        const newTrust = Math.max(-100, Math.min(150, oldTrust + change))

        db.prepare(
            `
            UPDATE galgame_sessions SET trust = ?, updated_at = ? WHERE id = ?
        `
        ).run(newTrust, Date.now(), session.id)

        return {
            oldTrust,
            newTrust,
            change,
            oldLevel: this.getTrustLevel(oldTrust),
            newLevel: this.getTrustLevel(newTrust)
        }
    }

    /**
     * 获取信任等级
     */
    getTrustLevel(trust) {
        for (const level of TRUST_LEVELS) {
            if (trust >= level.min && trust <= level.max) {
                return level
            }
        }
        return TRUST_LEVELS[3] // 默认观望
    }

    /**
     * 更新金币
     */
    async updateGold(userId, characterId, change, groupId = null) {
        await this.init()
        const db = databaseService.db

        const session = await this.getOrCreateSession(userId, characterId, groupId)
        const oldGold = session.gold || 0
        const maxGold = GOLD_CONFIG.maxGold || 99999
        const newGold = Math.max(0, Math.min(maxGold, oldGold + change))

        db.prepare(
            `
            UPDATE galgame_sessions SET gold = ?, updated_at = ? WHERE id = ?
        `
        ).run(newGold, Date.now(), session.id)

        return { oldGold, newGold, change, success: true }
    }

    /**
     * 添加物品到背包
     * @param {string} userId
     * @param {string} characterId
     * @param {Object} item - { name, type?, description? }
     * @param {string|null} groupId
     */
    async addItem(userId, characterId, item, groupId = null) {
        await this.init()
        const db = databaseService.db

        const session = await this.getOrCreateSession(userId, characterId, groupId)
        let items = []
        try {
            items = JSON.parse(session.items || '[]')
        } catch {
            items = []
        }

        items.push({
            name: item.name,
            type: item.type || 'consumable',
            description: item.description || '',
            obtainedAt: Date.now()
        })

        db.prepare(`UPDATE galgame_sessions SET items = ?, updated_at = ? WHERE id = ?`).run(
            JSON.stringify(items),
            Date.now(),
            session.id
        )

        return { success: true, item, totalItems: items.length }
    }

    /**
     * 获取全部物品列表
     */
    async getItems(userId, characterId, groupId = null) {
        const session = await this.getOrCreateSession(userId, characterId, groupId)
        try {
            return JSON.parse(session.items || '[]')
        } catch {
            return []
        }
    }

    /**
     * 检查是否拥有指定物品
     * @param {string} userId
     * @param {string} characterId
     * @param {string} itemName - 物品名称
     * @param {string|null} groupId
     * @returns {boolean}
     */
    async hasItem(userId, characterId, itemName, groupId = null) {
        const items = await this.getItems(userId, characterId, groupId)
        return items.some(i => i.name === itemName)
    }

    /**
     * 使用物品（消耗品从背包移除，关键道具保留）
     * @returns {{ success: boolean, item?: Object, error?: string }}
     */
    async useItem(userId, characterId, itemName, groupId = null) {
        await this.init()
        const db = databaseService.db
        const session = await this.getOrCreateSession(userId, characterId, groupId)

        let items = []
        try {
            items = JSON.parse(session.items || '[]')
        } catch {
            items = []
        }

        const itemIndex = items.findIndex(i => i.name === itemName)
        if (itemIndex === -1) {
            return { success: false, error: `没有物品「${itemName}」` }
        }

        const item = items[itemIndex]

        // 关键道具不会消失，只标记已使用
        if (item.type === 'key') {
            item.used = true
            db.prepare(`UPDATE galgame_sessions SET items = ?, updated_at = ? WHERE id = ?`).run(
                JSON.stringify(items),
                Date.now(),
                session.id
            )
            return { success: true, item, kept: true }
        }

        // 消耗品/礼物/线索 使用后移除
        items.splice(itemIndex, 1)
        db.prepare(`UPDATE galgame_sessions SET items = ?, updated_at = ? WHERE id = ?`).run(
            JSON.stringify(items),
            Date.now(),
            session.id
        )
        return { success: true, item, kept: false }
    }

    /**
     * 移除物品
     */
    async removeItem(userId, characterId, itemName, groupId = null) {
        await this.init()
        const db = databaseService.db
        const session = await this.getOrCreateSession(userId, characterId, groupId)

        let items = []
        try {
            items = JSON.parse(session.items || '[]')
        } catch {
            items = []
        }

        const newItems = items.filter(i => i.name !== itemName)
        if (newItems.length === items.length) {
            return { success: false, error: '物品不存在' }
        }

        db.prepare(`UPDATE galgame_sessions SET items = ?, updated_at = ? WHERE id = ?`).run(
            JSON.stringify(newItems),
            Date.now(),
            session.id
        )
        return { success: true }
    }

    /**
     * 按类型获取物品
     * @param {string} type - 'key' | 'gift' | 'consumable' | 'clue'
     */
    async getItemsByType(userId, characterId, type, groupId = null) {
        const items = await this.getItems(userId, characterId, groupId)
        return items.filter(i => i.type === type)
    }

    /**
     * 检查用户是否有对话历史
     */
    async hasHistory(userId, characterId = 'default', groupId = null) {
        await this.init()
        const db = databaseService.db
        const session = await this.getOrCreateSession(userId, characterId, groupId)

        const count = db
            .prepare(
                `
            SELECT COUNT(*) as count FROM galgame_history WHERE session_id = ?
        `
            )
            .get(session.id)

        return count.count > 0
    }

    /**
     * 获取角色配置
     */
    async getCharacter(characterId) {
        await this.init()
        const db = databaseService.db

        const character = db
            .prepare(
                `
            SELECT * FROM galgame_characters WHERE character_id = ?
        `
            )
            .get(characterId)

        if (character && character.events) {
            try {
                character.events = JSON.parse(character.events)
            } catch {
                character.events = {}
            }
        }

        return character
    }

    /**
     * 创建或更新角色
     */
    async saveCharacter(characterData) {
        await this.init()
        const db = databaseService.db
        const now = Date.now()

        const existing = await this.getCharacter(characterData.character_id)
        const eventsJson = characterData.events ? JSON.stringify(characterData.events) : null

        if (existing) {
            db.prepare(
                `
                UPDATE galgame_characters 
                SET name = ?, description = ?, system_prompt = ?, initial_message = ?, 
                    events = ?, is_public = ?, updated_at = ?
                WHERE character_id = ?
            `
            ).run(
                characterData.name,
                characterData.description || null,
                characterData.system_prompt || null,
                characterData.initial_message || null,
                eventsJson,
                characterData.is_public ? 1 : 0,
                now,
                characterData.character_id
            )
        } else {
            db.prepare(
                `
                INSERT INTO galgame_characters 
                (character_id, name, description, system_prompt, initial_message, events, created_by, is_public, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
            ).run(
                characterData.character_id,
                characterData.name,
                characterData.description || null,
                characterData.system_prompt || null,
                characterData.initial_message || null,
                eventsJson,
                characterData.created_by || null,
                characterData.is_public ? 1 : 0,
                now,
                now
            )
        }

        return await this.getCharacter(characterData.character_id)
    }

    /**
     * 获取对话历史
     */
    async getHistory(sessionId, limit = 20) {
        await this.init()
        const db = databaseService.db

        return db
            .prepare(
                `
            SELECT * FROM galgame_history 
            WHERE session_id = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `
            )
            .all(sessionId, limit)
            .reverse()
    }

    /**
     * 添加对话记录
     * @param {number} sessionId - 会话ID
     * @param {string} role - 角色 'user' | 'assistant'
     * @param {string} content - 内容
     * @param {string|null} eventType - 事件类型
     * @param {string|null} eventResult - 事件结果
     * @param {number} affectionChange - 好感度变化
     * @param {number} trustChange - 信任度变化
     * @param {number} goldChange - 金币变化
     */
    async addHistory(
        sessionId,
        role,
        content,
        eventType = null,
        eventResult = null,
        affectionChange = 0,
        trustChange = 0,
        goldChange = 0
    ) {
        await this.init()
        const db = databaseService.db

        db.prepare(
            `
            INSERT INTO galgame_history 
            (session_id, role, content, event_type, event_result, affection_change, trust_change, gold_change, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(sessionId, role, content, eventType, eventResult, affectionChange, trustChange, goldChange, Date.now())
    }

    /**
     * 获取已触发的事件列表
     */
    async getTriggeredEvents(userId, characterId, groupId = null) {
        await this.init()
        const session = await this.getOrCreateSession(userId, characterId, groupId)

        if (session?.triggered_events) {
            try {
                return JSON.parse(session.triggered_events)
            } catch {
                return []
            }
        }
        return []
    }

    /**
     * 记录已触发的事件
     */
    async addTriggeredEvent(userId, characterId, eventName, groupId = null) {
        await this.init()
        const db = databaseService.db

        const session = await this.getOrCreateSession(userId, characterId, groupId)
        const events = await this.getTriggeredEvents(userId, characterId, groupId)
        if (!events.includes(eventName)) {
            events.push(eventName)
            db.prepare(
                `
                UPDATE galgame_sessions SET triggered_events = ?, updated_at = ?
                WHERE id = ?
            `
            ).run(JSON.stringify(events), Date.now(), session.id)
        }
        return events
    }

    /**
     * 检查事件是否已触发过
     */
    async isEventTriggered(userId, characterId, eventName, groupId = null) {
        const events = await this.getTriggeredEvents(userId, characterId, groupId)
        return events.includes(eventName)
    }

    /**
     * 保存待选择项（用于表情回应选择）
     */
    savePendingChoice(groupId, messageId, userId, type, options, eventInfo = null) {
        const key = `${groupId || 'private'}_${messageId}`
        this.pendingChoices.set(key, {
            userId,
            type, // 'option' 或 'event'
            options,
            eventInfo,
            timestamp: Date.now()
        })

        // 清理过期的待选择项（5分钟）
        const now = Date.now()
        for (const [k, v] of this.pendingChoices) {
            if (now - v.timestamp > 5 * 60 * 1000) {
                this.pendingChoices.delete(k)
            }
        }
    }

    /**
     * 获取待选择项
     */
    getPendingChoice(groupId, messageId) {
        const key = `${groupId || 'private'}_${messageId}`
        return this.pendingChoices.get(key)
    }

    /**
     * 删除待选择项
     */
    removePendingChoice(groupId, messageId) {
        const key = `${groupId || 'private'}_${messageId}`
        this.pendingChoices.delete(key)
    }

    /**
     * 查找用户的待处理事件（用于文本输入触发）
     */
    findUserPendingEvent(groupId, userId) {
        const prefix = `${groupId || 'private'}_`
        for (const [key, value] of this.pendingChoices) {
            if (key.startsWith(prefix) && value.userId === String(userId)) {
                // 返回找到的待处理项及其key
                return { ...value, key }
            }
        }
        return null
    }

    /**
     * 查找用户的任意待处理选项（用于数字选择）
     */
    findUserPendingChoice(groupId, userId) {
        const prefix = `${groupId || 'private'}_`
        for (const [key, value] of this.pendingChoices) {
            if (key.startsWith(prefix) && value.userId === String(userId)) {
                return { ...value, key }
            }
        }
        return null
    }

    /**
     * 通过key删除待选择项
     */
    removePendingChoiceByKey(key) {
        this.pendingChoices.delete(key)
    }

    /**
     * 清理用户的所有待选择项
     */
    clearUserPendingChoices(groupId, userId) {
        const prefix = `${groupId || 'private'}_`
        for (const [key, value] of this.pendingChoices) {
            if (key.startsWith(prefix) && value.userId === String(userId)) {
                this.pendingChoices.delete(key)
            }
        }
    }

    /**
     * 获取会话设置
     */
    async getSessionSettings(userId, characterId, groupId = null) {
        const session = await this.getOrCreateSession(userId, characterId, groupId)
        if (session.settings) {
            try {
                return JSON.parse(session.settings)
            } catch {
                return null
            }
        }
        return null
    }

    /**
     * 保存会话设置（包含环境信息）
     */
    async saveSessionSettings(userId, characterId, settings, groupId = null) {
        await this.init()
        const db = databaseService.db
        const session = await this.getOrCreateSession(userId, characterId, groupId)
        db.prepare(
            `
            UPDATE galgame_sessions SET settings = ?, updated_at = ?
            WHERE id = ?
        `
        ).run(JSON.stringify(settings), Date.now(), session.id)
    }

    /**
     * 更新环境设定（在线编辑用）
     */
    async updateEnvironment(userId, characterId, updates, groupId = null) {
        await this.init()
        let settings = await this.getSessionSettings(userId, characterId, groupId)

        // 如果没有设置，创建新的
        if (!settings) {
            settings = { environment: {}, initialized: false, createdAt: Date.now() }
        }

        // 如果没有环境数据，初始化空对象
        if (!settings.environment) {
            settings.environment = {}
        }

        // 合并更新
        const updatedEnv = { ...settings.environment, ...updates }
        settings.environment = updatedEnv
        settings.updatedAt = Date.now()
        settings.initialized = true

        await this.saveSessionSettings(userId, characterId, settings, groupId)
        gameLogger.info(`[GalgameService] 用户 ${userId} 环境设定已更新`)
    }

    /**
     * 更新会话数据（在线编辑用）
     */
    async updateSession(userId, characterId, updates, groupId = null) {
        await this.init()
        const db = databaseService.db
        const session = await this.getOrCreateSession(userId, characterId, groupId)
        if (!session) {
            gameLogger.warn(`[GalgameService] 无法更新会话: 用户 ${userId} 没有会话数据`)
            return
        }

        // 只允许更新特定字段
        const allowedFields = ['relationship']
        const updateParts = []
        const values = []

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                updateParts.push(`${field} = ?`)
                values.push(updates[field])
            }
        }

        if (updateParts.length === 0) return

        values.push(Date.now(), session.id)
        db.prepare(`UPDATE galgame_sessions SET ${updateParts.join(', ')}, updated_at = ? WHERE id = ?`).run(...values)
        gameLogger.info(`[GalgameService] 用户 ${userId} 会话数据已更新: ${updateParts.join(', ')}`)
    }

    /**
     * 统一 LLM 调用辅助方法（消除重复代码）
     * @param {Object} options - 调用选项
     * @param {Array} options.messages - 消息数组
     * @param {string} options.source - 调用来源标识
     * @param {string} [options.userId] - 用户ID（统计用）
     * @param {string} [options.groupId] - 群组ID（统计用，用于群组配置）
     * @param {boolean} [options.enableTools=false] - 是否启用工具
     * @returns {Promise<string>} AI响应文本
     */
    async callGameLLM(options) {
        const { messages, source, userId, groupId, enableTools = false } = options

        // 获取群组配置
        let groupGameConfig = null
        if (groupId) {
            try {
                const scopeManager = getScopeManager(databaseService)
                await scopeManager.init()
                const groupSettings = await scopeManager.getGroupSettings(groupId)
                groupGameConfig = groupSettings?.settings || null
            } catch (err) {
                gameLogger.debug(`获取群组游戏配置失败: ${err.message}`)
            }
        }

        // 模型优先级: 群组配置 > 全局game模型 > 默认模型
        const configGameModel = config.get('llm.models.game') || ''
        const groupGameModel = groupGameConfig?.gameModel || ''
        const gameModel = groupGameModel || configGameModel || LlmService.getModel()
        const gameTemperature = groupGameConfig?.gameTemperature ?? config.get('game.temperature') ?? 0.8
        const gameMaxTokens = groupGameConfig?.gameMaxTokens ?? config.get('game.maxTokens') ?? 1000
        const gameEnableTools =
            enableTools && (groupGameConfig?.gameEnableTools ?? config.get('game.enableTools') !== false)

        gameLogger.info(`[${source}] 使用模型: ${gameModel}`)

        const client = await LlmService.getChatClient({
            model: gameModel,
            enableTools: gameEnableTools
        })

        /* 字符上限检查 */
        const maxCharacters = client._channelInfo?.maxCharacters || 0
        enforceMaxCharacters(messages, maxCharacters, 'GalgameService')

        const startTime = Date.now()
        let response = null
        let requestSuccess = false

        try {
            response = await client.sendMessageWithHistory(messages, {
                model: gameModel,
                temperature: gameTemperature,
                maxTokens: gameMaxTokens
            })
            requestSuccess = true
        } catch (err) {
            gameLogger.error(`[${source}] LLM 调用失败: ${err.message}`)
            // 记录失败统计
            try {
                await statsService.recordApiCall({
                    channelId: client._channelInfo?.id || 'game',
                    channelName: client._channelInfo?.name || '游戏模式',
                    model: gameModel,
                    duration: Date.now() - startTime,
                    success: false,
                    source: 'game',
                    userId: userId || source
                })
            } catch {}
            throw err
        }

        // 记录统计
        try {
            await statsService.recordApiCall({
                channelId: client._channelInfo?.id || 'game',
                channelName: client._channelInfo?.name || '游戏模式',
                model: gameModel,
                duration: Date.now() - startTime,
                success: requestSuccess,
                source: 'game',
                userId: userId || source,
                groupId: groupId || null
            })
        } catch (err) {
            gameLogger.debug(`统计记录失败: ${err.message}`)
        }

        // 提取文本响应
        const contentArray = Array.isArray(response?.content) ? response.content : []
        const aiResponse =
            contentArray
                ?.filter(c => c.type === 'text')
                ?.map(c => c.text)
                ?.join('') || ''

        return { text: aiResponse, response, usage: response?.usage || {} }
    }

    /**
     * 初始化环境设定（请求AI生成）
     */
    async initializeEnvironment(userId, characterId, event, groupId = null) {
        gameLogger.info(`初始化环境: 提示词长度=${INIT_PROMPT.length}`)

        const messages = [
            { role: 'system', content: INIT_PROMPT },
            { role: 'user', content: '请生成' }
        ]

        const { text: aiResponse } = await this.callGameLLM({
            messages,
            source: 'game_init',
            userId: `game_init_${Date.now()}`,
            groupId
        })

        gameLogger.info(`AI返回环境设定: ${aiResponse.substring(0, 300)}...`)

        // 解析环境设定
        const envSettings = parseInitResponse(aiResponse)
        gameLogger.info(
            `解析结果: name=${envSettings.name}, world=${envSettings.world}, personality=${envSettings.personality?.substring(0, 30)}..., likes=${envSettings.likes?.substring(0, 30)}...`
        )

        // 保存到会话设置
        await this.saveSessionSettings(
            userId,
            characterId,
            {
                environment: envSettings,
                initialized: true,
                createdAt: Date.now()
            },
            groupId
        )

        return envSettings
    }

    /**
     * 第二阶段：生成完整的开场上下文
     * 基于已初始化的人设环境，生成丰富的开场白和背景描述
     */
    async generateOpeningContext(userId, characterId, event, groupId = null) {
        const settings = await this.getSessionSettings(userId, characterId, groupId)
        const env = settings?.environment

        if (!env || !env.name) {
            throw new Error('请先初始化环境设定')
        }

        // 使用 PromptBuilder 构建开场提示词
        const openingPrompt = buildOpeningPrompt(env)

        const messages = [
            { role: 'system', content: openingPrompt },
            { role: 'user', content: '请开始' }
        ]

        const { text: aiResponse } = await this.callGameLLM({
            messages,
            source: 'game_opening',
            userId: `game_opening_${Date.now()}`,
            groupId
        })

        gameLogger.info(`开场上下文生成完成: ${aiResponse.substring(0, 200)}...`)

        // 解析场景信息
        const parsed = parseResponse(aiResponse)

        // 更新游戏状态
        await this.updateGameState(userId, characterId, parsed, groupId)

        return {
            response: parsed.cleanResponse,
            scene: parsed.scene,
            rawResponse: aiResponse
        }
    }

    /**
     * 更新游戏状态（场景、任务、线索、剧情）
     */
    async updateGameState(userId, characterId, parsed, groupId = null) {
        const settings = await this.getSessionSettings(userId, characterId, groupId)
        if (!settings) return

        // 确保 gameState 及其所有数组属性都已初始化
        const gameState = settings.gameState || {}
        gameState.currentScene = gameState.currentScene ?? null
        gameState.currentTask = gameState.currentTask ?? null
        gameState.clues = gameState.clues || []
        gameState.knownNPCs = gameState.knownNPCs || []
        gameState.visitedPlaces = gameState.visitedPlaces || []
        gameState.plotHistory = gameState.plotHistory || []
        gameState.revealedSecrets = gameState.revealedSecrets || []
        gameState.discoveredInfo = gameState.discoveredInfo || {}

        let changed = false

        // 更新当前场景
        if (parsed.scene) {
            gameState.currentScene = parsed.scene
            // 记录去过的地点
            if (parsed.scene.name && !gameState.visitedPlaces.includes(parsed.scene.name)) {
                gameState.visitedPlaces.push(parsed.scene.name)
            }
            changed = true
        }

        // 更新当前任务
        if (parsed.task) {
            gameState.currentTask = parsed.task
            changed = true
        }

        // 添加新线索
        if (parsed.clue && !gameState.clues.includes(parsed.clue)) {
            gameState.clues.push(parsed.clue)
            changed = true
        }

        // 添加剧情进展
        if (parsed.plot) {
            gameState.plotHistory.push(parsed.plot)
            // 最多保留10条剧情记录
            if (gameState.plotHistory.length > 10) {
                gameState.plotHistory = gameState.plotHistory.slice(-10)
            }
            changed = true
        }

        // 处理信息发现
        if (parsed.discoveries && parsed.discoveries.length > 0) {
            for (const discovery of parsed.discoveries) {
                const type = discovery.type.toLowerCase()

                // 记录发现的信息
                if (!gameState.discoveredInfo[type]) {
                    gameState.discoveredInfo[type] = []
                }
                if (!gameState.discoveredInfo[type].includes(discovery.content)) {
                    gameState.discoveredInfo[type].push(discovery.content)
                    gameLogger.info(`玩家发现新信息: [${type}] ${discovery.content}`)
                }

                // 特殊处理秘密揭示
                if (type === '秘密' || type === 'secret') {
                    if (!gameState.revealedSecrets.includes('main_secret')) {
                        gameState.revealedSecrets.push('main_secret')
                    }
                }

                // 记录NPC
                if (type === 'npc' && discovery.content) {
                    if (!gameState.knownNPCs.includes(discovery.content)) {
                        gameState.knownNPCs.push(discovery.content)
                    }
                }
            }
            changed = true
        }

        // 保存更新
        if (changed) {
            settings.gameState = gameState
            await this.saveSessionSettings(userId, characterId, settings, groupId)
        }
    }

    /**
     * 发送Galgame对话消息
     */
    async sendMessage(options) {
        const {
            userId,
            groupId,
            message,
            characterId = 'default',
            event,
            isOptionChoice = false,
            optionIndex = null,
            imageUrls = []
        } = options

        await this.init()

        // 获取会话和角色（使用 groupId 隔离）
        const session = await this.getOrCreateSession(userId, characterId, groupId)
        const character = await this.getCharacter(characterId)

        // 获取历史对话用于上下文 - 同时构建实际对话消息
        const history = await this.getHistory(session.id, 10)
        const historySummary = history
            .map(h => `${h.role === 'user' ? '玩家' : '角色'}: ${h.content.substring(0, 100)}`)
            .join('\n')

        // 构建系统提示词
        const triggeredEvents = await this.getTriggeredEvents(session.user_id, session.character_id, session.group_id)
        const settings = await this.getSessionSettings(session.user_id, session.character_id, session.group_id)
        const systemPrompt = buildSystemPrompt({
            character,
            session,
            settings,
            triggeredEvents,
            historySummary
        })

        // 构建实际发送的消息
        let actualMessage = message
        if (isOptionChoice && optionIndex !== null) {
            actualMessage = `[玩家选择了选项${optionIndex}] ${message}`
        }

        // 构建消息内容（支持图片）
        const messageContent = [{ type: 'text', text: actualMessage }]
        for (const url of imageUrls || []) {
            if (url) {
                messageContent.push({ type: 'image_url', image_url: { url } })
            }
        }

        // 构建请求消息 - 包含实际历史对话轮次（而不仅是摘要）
        const messages = [{ role: 'system', content: systemPrompt }]
        // 添加最近的历史对话消息（最多最近6轮）
        const recentHistory = history.slice(-6)
        for (const h of recentHistory) {
            messages.push({
                role: h.role === 'user' ? 'user' : 'assistant',
                content: h.content
            })
        }
        // 添加当前用户消息
        messages.push({ role: 'user', content: messageContent })

        // 使用统一 LLM 调用方法
        const { text: aiResponse } = await this.callGameLLM({
            messages,
            source: 'game_chat',
            userId: String(userId),
            groupId,
            enableTools: true
        })

        // 解析回复中的所有标记
        const parsed = parseResponse(aiResponse)

        // 更新游戏状态（场景、任务、线索、剧情）
        await this.updateGameState(userId, characterId, parsed, groupId)

        // 记录用户消息
        await this.addHistory(session.id, 'user', message)

        // 处理好感度变化
        let totalAffectionChange = parsed.affectionChange
        let totalTrustChange = parsed.trustChange || 0
        let totalGoldChange = parsed.goldChange || 0

        // 检查事件是否已触发过
        let eventInfo = null
        if (parsed.event) {
            const alreadyTriggered = await this.isEventTriggered(userId, characterId, parsed.event.name)
            if (alreadyTriggered) {
                gameLogger.debug(`事件 "${parsed.event.name}" 已触发过，忽略`)
            } else {
                eventInfo = parsed.event
            }
        }

        // 更新好感度
        if (totalAffectionChange !== 0) {
            await this.updateAffection(userId, characterId, totalAffectionChange, groupId)
        }

        // 更新信任度
        if (totalTrustChange !== 0) {
            await this.updateTrust(userId, characterId, totalTrustChange, groupId)
        }

        // 更新金币
        if (totalGoldChange !== 0) {
            await this.updateGold(userId, characterId, totalGoldChange, groupId)
        }

        // 添加获得的物品
        for (const item of parsed.obtainedItems || []) {
            await this.addItem(userId, characterId, item, groupId)
        }

        // 处理使用的物品
        for (const itemName of parsed.usedItems || []) {
            await this.useItem(userId, characterId, itemName, groupId)
        }

        // 记录AI回复（包含好感度、信任度、金币变化）
        await this.addHistory(
            session.id,
            'assistant',
            parsed.cleanResponse,
            eventInfo?.name || null,
            null,
            totalAffectionChange,
            totalTrustChange,
            totalGoldChange
        )

        // 获取更新后的会话
        const updatedSession = await this.getOrCreateSession(userId, characterId, groupId)
        const trustLevel = this.getTrustLevel(updatedSession.trust || 10)

        return {
            response: parsed.cleanResponse,
            affectionChange: totalAffectionChange,
            trustChange: totalTrustChange,
            goldChange: totalGoldChange,
            purchases: parsed.purchases || [],
            obtainedItems: parsed.obtainedItems || [],
            usedItems: parsed.usedItems || [],
            requiredItems: parsed.requiredItems || [],
            shop: parsed.shop || null,
            shopItems: parsed.shopItems || [],
            options: parsed.options,
            event: eventInfo,
            eventOptions: parsed.eventOptions,
            scene: parsed.scene,
            task: parsed.task,
            clue: parsed.clue,
            plot: parsed.plot,
            discoveries: parsed.discoveries || [],
            session: {
                affection: updatedSession.affection,
                trust: updatedSession.trust || 10,
                gold: updatedSession.gold || 100,
                level: getAffectionLevel(updatedSession.affection),
                trustLevel: trustLevel,
                relationship: updatedSession.relationship,
                characterName: session.character_id
            }
        }
    }

    /**
     * 获取用户状态
     */
    async getStatus(userId, characterId = 'default', groupId = null) {
        await this.init()
        const session = await this.getOrCreateSession(userId, characterId, groupId)
        const character = await this.getCharacter(characterId)
        const settings = await this.getSessionSettings(userId, characterId, groupId)
        const triggeredEvents = await this.getTriggeredEvents(userId, characterId, groupId)

        const env = settings?.environment
        const gameState = settings?.gameState || {}

        // 检查秘密是否已揭示
        const secretRevealed = gameState.revealedSecrets?.includes('main_secret')

        // 获取物品
        let items = []
        try {
            items = JSON.parse(session.items || '[]')
        } catch {
            items = []
        }

        return {
            userId,
            characterId,
            characterName: env?.name || character?.name || '默认角色',
            world: env?.world || '未知',
            identity: env?.identity || '未知',
            // 角色详细信息
            personality: env?.personality || '???',
            likes: env?.likes || '???',
            dislikes: env?.dislikes || '???',
            background: env?.background || '???',
            secret: secretRevealed ? env?.secret : '???',
            meetingReason: env?.meetingReason || '???',
            // 双属性系统
            affection: session.affection,
            trust: session.trust || 10,
            gold: session.gold || 100,
            items: items,
            level: getAffectionLevel(session.affection),
            trustLevel: this.getTrustLevel(session.trust || 10),
            relationship: session.relationship,
            // 游戏进度信息
            currentScene: gameState.currentScene,
            currentTask: gameState.currentTask,
            clues: gameState.clues || [],
            knownNPCs: gameState.knownNPCs || [],
            visitedPlaces: gameState.visitedPlaces || [],
            triggeredEvents: triggeredEvents,
            plotHistory: gameState.plotHistory || [],
            createdAt: session.created_at,
            updatedAt: session.updated_at
        }
    }

    /**
     * 导出会话数据为JSON
     * @param {boolean} includeEnvPrompt - 是否包含环境提示词（默认不包含）
     */
    async exportSession(userId, characterId = 'default', includeEnvPrompt = false, groupId = null) {
        await this.init()
        const db = databaseService.db

        const session = await this.getOrCreateSession(userId, characterId, groupId)
        const character = await this.getCharacter(characterId)
        const triggeredEvents = await this.getTriggeredEvents(userId, characterId, groupId)
        const settings = await this.getSessionSettings(userId, characterId, groupId)

        // 获取对话历史
        const history = db
            .prepare(
                `
            SELECT role, content, event_type, affection_change, timestamp
            FROM galgame_history 
            WHERE session_id = ? 
            ORDER BY timestamp ASC
        `
            )
            .all(session.id)

        // 获取AI生成的环境设定
        const env = settings?.environment

        // 构建导出数据
        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            character: {
                id: characterId,
                name: env?.name || character?.name || '默认角色',
                description: character?.description || null,
                systemPrompt: character?.system_prompt || null,
                initialMessage: character?.initial_message || null
            },
            // AI生成的完整环境设定
            environment: env
                ? {
                      name: env.name,
                      world: env.world,
                      identity: env.identity,
                      personality: env.personality,
                      likes: env.likes,
                      dislikes: env.dislikes,
                      background: env.background,
                      secret: env.secret,
                      meetingReason: env.meetingReason,
                      scene: env.scene,
                      greeting: env.greeting
                  }
                : null,
            // 游戏状态
            gameState: settings?.gameState || null,
            session: {
                affection: session.affection,
                relationship: session.relationship,
                triggeredEvents: triggeredEvents,
                createdAt: session.created_at,
                updatedAt: session.updated_at
            },
            history: history.map(h => ({
                role: h.role,
                content: h.content,
                eventName: h.event_type,
                affectionChange: h.affection_change,
                timestamp: h.timestamp
            }))
        }

        // 只有明确要求时才包含环境提示词
        if (includeEnvPrompt) {
            exportData.environmentPrompt = ENVIRONMENT_PROMPT
        }

        return exportData
    }

    /**
     * 导入会话数据
     * @param {string} userId - 用户ID
     * @param {object} importData - 导入的数据
     * @param {string|null} groupId - 群组ID
     */
    async importSession(userId, importData, groupId = null) {
        await this.init()
        const db = databaseService.db
        const now = Date.now()
        const characterId = `imported_${userId}_${now}`

        // 先清除该用户在该群组的旧会话
        const existingSession = groupId
            ? db.prepare(`SELECT id FROM galgame_sessions WHERE user_id = ? AND group_id = ?`).get(userId, groupId)
            : db.prepare(`SELECT id FROM galgame_sessions WHERE user_id = ? AND group_id IS NULL`).get(userId)

        if (existingSession) {
            // 删除旧会话的历史记录
            db.prepare(`DELETE FROM galgame_history WHERE session_id = ?`).run(existingSession.id)
            // 删除旧会话
            db.prepare(`DELETE FROM galgame_sessions WHERE id = ?`).run(existingSession.id)
            gameLogger.info(`已清除旧会话: sessionId=${existingSession.id}`)
        }

        // 保存角色信息
        db.prepare(
            `
            INSERT INTO galgame_characters 
            (character_id, name, description, system_prompt, initial_message, created_by, is_public, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
            characterId,
            importData.character.name || '导入角色',
            importData.character.description || null,
            importData.character.systemPrompt || null,
            importData.character.initialMessage || null,
            userId,
            0, // 不公开
            now,
            now
        )

        // 创建会话（包含 group_id）
        const sessionResult = db
            .prepare(
                `
            INSERT INTO galgame_sessions 
            (user_id, character_id, group_id, affection, relationship, triggered_events, in_game, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `
            )
            .run(
                userId,
                characterId,
                groupId,
                importData.session.affection || 10,
                importData.session.relationship || 'stranger',
                JSON.stringify(importData.session.triggeredEvents || []),
                now,
                now
            )

        const sessionId = sessionResult.lastInsertRowid

        // 导入环境设定（如果有）
        if (importData.environment) {
            await this.saveSessionSettings(
                userId,
                characterId,
                {
                    environment: importData.environment,
                    gameState: importData.gameState || {},
                    initialized: true,
                    createdAt: now
                },
                groupId
            )
        }

        // 导入历史记录
        if (importData.history && importData.history.length > 0) {
            const insertHistory = db.prepare(`
                INSERT INTO galgame_history 
                (session_id, role, content, event_type, affection_change, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            `)

            for (const h of importData.history) {
                insertHistory.run(
                    sessionId,
                    h.role,
                    h.content,
                    h.eventName || null,
                    h.affectionChange || 0,
                    h.timestamp || now
                )
            }
        }

        return {
            characterId,
            characterName: importData.environment?.name || importData.character.name || '导入角色',
            affection: importData.session.affection || 10
        }
    }

    /**
     * 重置会话
     */
    async resetSession(userId, characterId = 'default', groupId = null) {
        await this.init()
        const db = databaseService.db

        const session = await this.getOrCreateSession(userId, characterId, groupId)

        // 删除历史记录
        db.prepare(`DELETE FROM galgame_history WHERE session_id = ?`).run(session.id)

        // 重置会话数据（包括所有字段）
        db.prepare(
            `
            UPDATE galgame_sessions 
            SET affection = 10, 
                trust = 10, 
                gold = 100, 
                items = '[]',
                relationship = 'stranger', 
                triggered_events = '[]', 
                settings = NULL,
                in_game = 0,
                updated_at = ?
            WHERE id = ?
        `
        ).run(Date.now(), session.id)

        // 退出游戏模式并清理内存缓存
        await this.exitGame(groupId, userId)

        // 清理activeSessions缓存
        const key = `${groupId || 'private'}_${userId}`
        this.activeSessions.delete(key)

        // 清理待选择项
        this.clearUserPendingChoices(groupId, userId)

        return { success: true, message: '会话已重置' }
    }

    /**
     * 列出所有公开角色
     */
    async listPublicCharacters() {
        await this.init()
        const db = databaseService.db

        return db
            .prepare(
                `
            SELECT character_id, name, description, created_by, created_at
            FROM galgame_characters 
            WHERE is_public = 1
            ORDER BY created_at DESC
        `
            )
            .all()
    }

    /**
     * 删除角色
     */
    async deleteCharacter(characterId, userId) {
        await this.init()
        const db = databaseService.db

        const character = await this.getCharacter(characterId)
        if (!character) {
            return { success: false, message: '角色不存在' }
        }

        if (character.created_by !== userId) {
            return { success: false, message: '只能删除自己创建的角色' }
        }

        db.prepare(`DELETE FROM galgame_characters WHERE character_id = ?`).run(characterId)
        return { success: true, message: '角色已删除' }
    }

    /**
     * 通过表情回应触发对话
     */
    async handleReaction(userId, characterId, emojiId, emojiName, groupId = null) {
        await this.init()

        const session = await this.getOrCreateSession(userId, characterId, groupId)
        const character = await this.getCharacter(characterId)

        // 构建表情事件消息
        const reactionMessage = `[玩家对你做出了"${emojiName}"的表情回应]`

        // 发送到AI处理
        return await this.sendMessage({
            userId,
            groupId,
            message: reactionMessage,
            characterId
        })
    }
}

export const galgameService = new GalgameService()
export {
    OPTION_EMOJIS,
    AFFECTION_LEVELS,
    TRUST_LEVELS,
    DEFAULT_SYSTEM_PROMPT,
    ENVIRONMENT_PROMPT,
    INIT_PROMPT,
    CHOICE_EMOJIS,
    MESSAGE_CACHE_TTL,
    EVENT_TYPES,
    DAILY_EVENTS,
    EXPLORE_EVENTS,
    GOLD_CONFIG,
    ITEM_TYPES,
    ITEM_TYPE_LABELS,
    ITEM_TYPE_ICONS,
    DEFAULT_ITEMS
} from './constants.js'
export {
    parseResponse,
    parseInitResponse,
    extractTextFromContent,
    processEventChoice,
    processEventWithCustomInput
} from './ResponseParser.js'
export {
    getAffectionLevel,
    getRelationshipStatus,
    buildSystemPrompt,
    buildKnownInfo,
    buildStoryProgress,
    buildOpeningPrompt
} from './PromptBuilder.js'
