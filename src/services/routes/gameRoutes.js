/**
 * Galgame路由模块
 * 管理游戏角色预设和游戏设置
 */

import express from 'express'
import { asyncHandler } from '../middleware/routeFactory.js'
import config from '../../../config/config.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { galgameService } from '../galgame/GalgameService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = global.logger || console

class ChaiteResponse {
    constructor(code, data, message) {
        this.code = code
        this.data = data
        this.message = message
    }
    static ok(data) {
        return new ChaiteResponse(0, data, 'ok')
    }
    static fail(data, msg) {
        return new ChaiteResponse(-1, data, msg)
    }
}

// 预设存储路径
const PRESETS_DIR = path.join(__dirname, '../../../data/game')
const PRESETS_FILE = path.join(PRESETS_DIR, 'presets.json')

// 确保目录存在
function ensureDir() {
    if (!fs.existsSync(PRESETS_DIR)) {
        fs.mkdirSync(PRESETS_DIR, { recursive: true })
    }
}

// 加载预设
function loadPresets() {
    ensureDir()
    if (!fs.existsSync(PRESETS_FILE)) {
        return []
    }
    try {
        const data = fs.readFileSync(PRESETS_FILE, 'utf-8')
        return JSON.parse(data)
    } catch (e) {
        logger.error('[GameRoutes] 加载预设失败:', e)
        return []
    }
}

// 保存预设
function savePresets(presets) {
    ensureDir()
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf-8')
}

// 生成ID
function generateId() {
    return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// 生成UUID
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

// 临时编辑会话存储 (内存中，30分钟过期)
const editSessions = new Map()
const SESSION_EXPIRE_MS = 30 * 60 * 1000 // 30分钟

// 清理过期会话
function cleanExpiredSessions() {
    const now = Date.now()
    for (const [id, session] of editSessions) {
        if (now - session.createdAt > SESSION_EXPIRE_MS) {
            editSessions.delete(id)
        }
    }
}

// 定期清理
setInterval(cleanExpiredSessions, 5 * 60 * 1000)

// 受保护的字段（不可通过在线编辑修改）
const PROTECTED_FIELDS = ['userId', 'groupId', 'characterId', 'createdAt', 'messageCount']

// 可编辑的环境字段
const EDITABLE_ENV_FIELDS = [
    'name',
    'world',
    'identity',
    'personality',
    'likes',
    'dislikes',
    'background',
    'scene',
    'meetingReason',
    'greeting',
    'summary'
]

// 可编辑的会话字段
const EDITABLE_SESSION_FIELDS = ['relationship']

/**
 * 创建游戏路由
 * @param {Function} authMiddleware - 认证中间件
 * @returns {express.Router}
 */
export function createGameRoutes(authMiddleware) {
    const router = express.Router()
    const auth = authMiddleware ? [authMiddleware] : []

    // GET /api/game/presets - 获取所有预设
    router.get(
        '/presets',
        ...auth,
        asyncHandler(async (req, res) => {
            const presets = loadPresets()
            res.json(ChaiteResponse.ok(presets))
        })
    )

    // GET /api/game/presets/:id - 获取单个预设
    router.get(
        '/presets/:id',
        ...auth,
        asyncHandler(async (req, res) => {
            const presets = loadPresets()
            const preset = presets.find(p => p.id === req.params.id)
            if (preset) {
                res.json(ChaiteResponse.ok(preset))
            } else {
                res.status(404).json(ChaiteResponse.fail(null, '预设不存在'))
            }
        })
    )

    // POST /api/game/presets - 创建预设
    router.post(
        '/presets',
        ...auth,
        asyncHandler(async (req, res) => {
            const presets = loadPresets()
            const newPreset = {
                id: generateId(),
                ...req.body,
                createdAt: Date.now()
            }

            // 如果设为默认，取消其他默认
            if (newPreset.isDefault) {
                presets.forEach(p => (p.isDefault = false))
            }

            presets.push(newPreset)
            savePresets(presets)
            logger.info(`[GameRoutes] 创建预设: ${newPreset.name}`)
            res.status(201).json(ChaiteResponse.ok(newPreset))
        })
    )

    // PUT /api/game/presets/:id - 更新预设
    router.put(
        '/presets/:id',
        ...auth,
        asyncHandler(async (req, res) => {
            const presets = loadPresets()
            const index = presets.findIndex(p => p.id === req.params.id)
            if (index === -1) {
                return res.status(404).json(ChaiteResponse.fail(null, '预设不存在'))
            }

            const updated = {
                ...presets[index],
                ...req.body,
                id: req.params.id,
                updatedAt: Date.now()
            }

            // 如果设为默认，取消其他默认
            if (updated.isDefault) {
                presets.forEach(p => (p.isDefault = false))
            }

            presets[index] = updated
            savePresets(presets)
            logger.info(`[GameRoutes] 更新预设: ${updated.name}`)
            res.json(ChaiteResponse.ok(updated))
        })
    )

    // DELETE /api/game/presets/:id - 删除预设
    router.delete(
        '/presets/:id',
        ...auth,
        asyncHandler(async (req, res) => {
            const presets = loadPresets()
            const index = presets.findIndex(p => p.id === req.params.id)
            if (index === -1) {
                return res.status(404).json(ChaiteResponse.fail(null, '预设不存在'))
            }

            const deleted = presets.splice(index, 1)[0]
            savePresets(presets)
            logger.info(`[GameRoutes] 删除预设: ${deleted.name}`)
            res.json(ChaiteResponse.ok({ id: req.params.id }))
        })
    )

    // GET /api/game/settings - 获取游戏设置
    router.get(
        '/settings',
        ...auth,
        asyncHandler(async (req, res) => {
            const settings = {
                probability: config.get('game.probability') ?? 30,
                temperature: config.get('game.temperature') ?? 0.8,
                maxTokens: config.get('game.maxTokens') ?? 1000,
                gameModel: config.get('llm.models.game') || '',
                enableTools: config.get('game.enableTools') ?? false
            }
            res.json(ChaiteResponse.ok(settings))
        })
    )

    // PUT /api/game/settings - 更新游戏设置
    router.put(
        '/settings',
        ...auth,
        asyncHandler(async (req, res) => {
            const { probability, temperature, maxTokens, gameModel, enableTools } = req.body

            if (probability !== undefined) config.set('game.probability', probability)
            if (temperature !== undefined) config.set('game.temperature', temperature)
            if (maxTokens !== undefined) config.set('game.maxTokens', maxTokens)
            if (gameModel !== undefined) config.set('llm.models.game', gameModel)
            if (enableTools !== undefined) config.set('game.enableTools', enableTools)

            logger.info('[GameRoutes] 游戏设置已更新')
            res.json(ChaiteResponse.ok({ success: true }))
        })
    )

    // GET /api/game/sessions - 获取所有游戏会话
    router.get(
        '/sessions',
        ...auth,
        asyncHandler(async (req, res) => {
            try {
                await galgameService.init()
                const db = (await import('../database/DatabaseService.js')).databaseService.db
                const sessions = db
                    .prepare(
                        `
                    SELECT s.*, 
                           c.name as character_name,
                           (SELECT COUNT(*) FROM galgame_history WHERE session_id = s.id) as message_count
                    FROM galgame_sessions s
                    LEFT JOIN galgame_characters c ON s.character_id = c.character_id
                    ORDER BY s.updated_at DESC
                    LIMIT 100
                `
                    )
                    .all()
                res.json(ChaiteResponse.ok(sessions))
            } catch (err) {
                logger.error('[GameRoutes] 获取会话失败:', err)
                res.status(500).json(ChaiteResponse.fail(null, '获取会话失败'))
            }
        })
    )

    // DELETE /api/game/sessions/:id - 删除游戏会话
    router.delete(
        '/sessions/:id',
        ...auth,
        asyncHandler(async (req, res) => {
            try {
                await galgameService.init()
                const db = (await import('../database/DatabaseService.js')).databaseService.db
                const sessionId = parseInt(req.params.id)

                // 删除历史记录
                db.prepare('DELETE FROM galgame_history WHERE session_id = ?').run(sessionId)
                // 删除会话
                db.prepare('DELETE FROM galgame_sessions WHERE id = ?').run(sessionId)

                logger.info(`[GameRoutes] 删除会话: ${sessionId}`)
                res.json(ChaiteResponse.ok({ id: sessionId }))
            } catch (err) {
                logger.error('[GameRoutes] 删除会话失败:', err)
                res.status(500).json(ChaiteResponse.fail(null, '删除会话失败'))
            }
        })
    )

    // GET /api/game/characters - 获取所有角色
    router.get(
        '/characters',
        ...auth,
        asyncHandler(async (req, res) => {
            try {
                await galgameService.init()
                const db = (await import('../database/DatabaseService.js')).databaseService.db
                const characters = db
                    .prepare(
                        `
                    SELECT * FROM galgame_characters
                    ORDER BY created_at DESC
                `
                    )
                    .all()
                res.json(ChaiteResponse.ok(characters))
            } catch (err) {
                logger.error('[GameRoutes] 获取角色失败:', err)
                res.status(500).json(ChaiteResponse.fail(null, '获取角色失败'))
            }
        })
    )

    // DELETE /api/game/characters/:id - 删除角色
    router.delete(
        '/characters/:id',
        ...auth,
        asyncHandler(async (req, res) => {
            try {
                await galgameService.init()
                const db = (await import('../database/DatabaseService.js')).databaseService.db
                const characterId = req.params.id

                db.prepare('DELETE FROM galgame_characters WHERE character_id = ?').run(characterId)

                logger.info(`[GameRoutes] 删除角色: ${characterId}`)
                res.json(ChaiteResponse.ok({ id: characterId }))
            } catch (err) {
                logger.error('[GameRoutes] 删除角色失败:', err)
                res.status(500).json(ChaiteResponse.fail(null, '删除角色失败'))
            }
        })
    )

    // GET /api/game/stats - 获取游戏统计
    router.get(
        '/stats',
        ...auth,
        asyncHandler(async (req, res) => {
            try {
                await galgameService.init()
                const db = (await import('../database/DatabaseService.js')).databaseService.db

                const totalSessions = db.prepare('SELECT COUNT(*) as count FROM galgame_sessions').get()
                const activeSessions = db
                    .prepare('SELECT COUNT(*) as count FROM galgame_sessions WHERE in_game = 1')
                    .get()
                const totalMessages = db.prepare('SELECT COUNT(*) as count FROM galgame_history').get()
                const totalCharacters = db.prepare('SELECT COUNT(*) as count FROM galgame_characters').get()

                res.json(
                    ChaiteResponse.ok({
                        totalSessions: totalSessions?.count || 0,
                        activeSessions: activeSessions?.count || 0,
                        totalMessages: totalMessages?.count || 0,
                        totalCharacters: totalCharacters?.count || 0
                    })
                )
            } catch (err) {
                logger.error('[GameRoutes] 获取统计失败:', err)
                res.status(500).json(ChaiteResponse.fail(null, '获取统计失败'))
            }
        })
    )

    // ========== 在线编辑会话API (无需认证，使用UUID访问) ==========

    // POST /api/game/edit/create - 创建临时编辑会话
    router.post(
        '/edit/create',
        asyncHandler(async (req, res) => {
            const { userId, groupId, characterId, gameData } = req.body

            if (!userId || !gameData) {
                return res.status(400).json(ChaiteResponse.fail(null, '缺少必要参数'))
            }

            const editId = generateUUID()
            const session = {
                editId,
                userId,
                groupId: groupId || null,
                characterId: characterId || 'default',
                gameData,
                createdAt: Date.now(),
                expiresAt: Date.now() + SESSION_EXPIRE_MS
            }

            editSessions.set(editId, session)
            logger.info(`[GameRoutes] 创建编辑会话: ${editId} for user ${userId}`)

            res.json(
                ChaiteResponse.ok({
                    editId,
                    expiresAt: session.expiresAt,
                    editableFields: {
                        environment: EDITABLE_ENV_FIELDS,
                        session: EDITABLE_SESSION_FIELDS
                    },
                    protectedFields: PROTECTED_FIELDS
                })
            )
        })
    )

    // GET /api/game/edit/:editId - 获取编辑会话数据
    router.get(
        '/edit/:editId',
        asyncHandler(async (req, res) => {
            const { editId } = req.params
            const session = editSessions.get(editId)

            if (!session) {
                return res.status(404).json(ChaiteResponse.fail(null, '编辑会话不存在或已过期'))
            }

            if (Date.now() > session.expiresAt) {
                editSessions.delete(editId)
                return res.status(410).json(ChaiteResponse.fail(null, '编辑会话已过期'))
            }

            // 过滤掉受保护字段的值，只显示但不可编辑
            const safeData = { ...session.gameData }

            res.json(
                ChaiteResponse.ok({
                    editId,
                    gameData: safeData,
                    editableFields: {
                        environment: EDITABLE_ENV_FIELDS,
                        session: EDITABLE_SESSION_FIELDS
                    },
                    protectedFields: PROTECTED_FIELDS,
                    expiresAt: session.expiresAt,
                    remainingTime: Math.max(0, session.expiresAt - Date.now())
                })
            )
        })
    )

    // PUT /api/game/edit/:editId - 提交编辑
    router.put(
        '/edit/:editId',
        asyncHandler(async (req, res) => {
            const { editId } = req.params
            const { updates } = req.body
            const session = editSessions.get(editId)

            if (!session) {
                return res.status(404).json(ChaiteResponse.fail(null, '编辑会话不存在或已过期'))
            }

            if (Date.now() > session.expiresAt) {
                editSessions.delete(editId)
                return res.status(410).json(ChaiteResponse.fail(null, '编辑会话已过期'))
            }

            // 过滤掉受保护字段
            const filteredUpdates = {}

            if (updates.environment) {
                filteredUpdates.environment = {}
                for (const key of EDITABLE_ENV_FIELDS) {
                    if (updates.environment[key] !== undefined) {
                        filteredUpdates.environment[key] = updates.environment[key]
                    }
                }
            }

            if (updates.session) {
                filteredUpdates.session = {}
                for (const key of EDITABLE_SESSION_FIELDS) {
                    if (updates.session[key] !== undefined) {
                        filteredUpdates.session[key] = updates.session[key]
                    }
                }
            }

            // 标记为已提交
            session.submitted = true
            session.updates = filteredUpdates
            session.submittedAt = Date.now()

            logger.info(`[GameRoutes] 编辑会话已提交: ${editId}`)

            res.json(
                ChaiteResponse.ok({
                    editId,
                    updates: filteredUpdates,
                    message: '编辑已提交，请返回游戏查看更新'
                })
            )
        })
    )

    // GET /api/game/edit/:editId/result - 获取编辑结果（供游戏端轮询）
    router.get(
        '/edit/:editId/result',
        asyncHandler(async (req, res) => {
            const { editId } = req.params
            const session = editSessions.get(editId)

            if (!session) {
                return res.status(404).json(ChaiteResponse.fail(null, '编辑会话不存在'))
            }

            if (session.submitted) {
                // 返回结果后删除会话
                const result = {
                    editId,
                    userId: session.userId,
                    groupId: session.groupId,
                    characterId: session.characterId,
                    updates: session.updates,
                    submittedAt: session.submittedAt
                }
                editSessions.delete(editId)
                return res.json(ChaiteResponse.ok(result))
            }

            res.json(
                ChaiteResponse.ok({
                    editId,
                    submitted: false,
                    expiresAt: session.expiresAt
                })
            )
        })
    )

    return router
}

// 游戏编辑会话Token存储 (token -> { editId, expiry })
const gameEditTokens = new Map()

// 验证编辑会话Token
function verifyGameEditToken(token) {
    const tokenData = gameEditTokens.get(token)
    if (!tokenData) return null
    if (Date.now() > tokenData.expiry) {
        gameEditTokens.delete(token)
        return null
    }
    return tokenData
}

// 游戏编辑认证中间件
function gameEditAuth(req, res, next) {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

    if (!token) {
        return res.status(401).json(ChaiteResponse.fail(null, '需要登录'))
    }

    const tokenData = verifyGameEditToken(token)
    if (!tokenData) {
        return res.status(401).json(ChaiteResponse.fail(null, 'Token无效或已过期'))
    }

    req.editId = tokenData.editId
    next()
}

// 创建独立的编辑路由（使用editId登录）
export function createGameEditRoutes() {
    const router = express.Router()

    // POST /api/game-edit/login - 用editId登录
    router.post(
        '/login',
        asyncHandler(async (req, res) => {
            const { code } = req.body
            const editId = code?.trim()

            if (!editId) {
                return res.status(400).json(ChaiteResponse.fail(null, '请输入编辑码'))
            }

            const session = editSessions.get(editId)
            if (!session) {
                return res.status(404).json(ChaiteResponse.fail(null, '编辑码无效或已过期'))
            }

            if (Date.now() > session.expiresAt) {
                editSessions.delete(editId)
                return res.status(410).json(ChaiteResponse.fail(null, '编辑会话已过期'))
            }

            // 生成Token
            const token = generateUUID()
            gameEditTokens.set(token, {
                editId,
                expiry: session.expiresAt
            })

            logger.info(`[GameRoutes] 编辑会话登录: ${editId}`)

            res.json(
                ChaiteResponse.ok({
                    token,
                    editId,
                    expiresAt: session.expiresAt,
                    remainingTime: Math.max(0, session.expiresAt - Date.now())
                })
            )
        })
    )

    // GET /api/game-edit/session - 获取当前编辑会话数据（需登录）
    router.get(
        '/session',
        gameEditAuth,
        asyncHandler(async (req, res) => {
            const editId = req.editId
            const session = editSessions.get(editId)

            if (!session) {
                return res.status(404).json(ChaiteResponse.fail(null, '编辑会话不存在或已过期'))
            }

            if (Date.now() > session.expiresAt) {
                editSessions.delete(editId)
                return res.status(410).json(ChaiteResponse.fail(null, '编辑会话已过期'))
            }

            // 过滤掉受保护的字段（如 secret）
            const safeEnvironment = { ...session.gameData.environment }
            delete safeEnvironment.secret

            const safeGameData = {
                environment: safeEnvironment,
                session: {
                    affection: session.gameData.session?.affection,
                    trust: session.gameData.session?.trust,
                    gold: session.gameData.session?.gold,
                    relationship: session.gameData.session?.relationship
                }
            }

            res.json(
                ChaiteResponse.ok({
                    editId,
                    gameData: safeGameData,
                    editableFields: {
                        environment: EDITABLE_ENV_FIELDS,
                        session: EDITABLE_SESSION_FIELDS
                    },
                    protectedFields: PROTECTED_FIELDS,
                    expiresAt: session.expiresAt,
                    remainingTime: Math.max(0, session.expiresAt - Date.now())
                })
            )
        })
    )

    // PUT /api/game-edit/session - 提交编辑（需登录）
    router.put(
        '/session',
        gameEditAuth,
        asyncHandler(async (req, res) => {
            const editId = req.editId
            const { updates } = req.body
            const session = editSessions.get(editId)

            if (!session) {
                return res.status(404).json(ChaiteResponse.fail(null, '编辑会话不存在或已过期'))
            }

            if (Date.now() > session.expiresAt) {
                editSessions.delete(editId)
                return res.status(410).json(ChaiteResponse.fail(null, '编辑会话已过期'))
            }

            // 过滤受保护字段
            const safeUpdates = { environment: {}, session: {} }

            if (updates.environment) {
                for (const field of EDITABLE_ENV_FIELDS) {
                    if (updates.environment[field] !== undefined) {
                        safeUpdates.environment[field] = updates.environment[field]
                    }
                }
            }

            if (updates.session) {
                for (const field of EDITABLE_SESSION_FIELDS) {
                    if (updates.session[field] !== undefined) {
                        safeUpdates.session[field] = updates.session[field]
                    }
                }
            }

            // 直接应用更新到数据库，无需轮询
            try {
                const { userId, characterId, groupId } = session

                if (Object.keys(safeUpdates.environment).length > 0) {
                    await galgameService.updateEnvironment(userId, characterId, safeUpdates.environment, groupId)
                    logger.info(`[GameRoutes] 用户 ${userId} 通过在线编辑更新了环境设定`)
                }

                if (Object.keys(safeUpdates.session).length > 0) {
                    await galgameService.updateSession(userId, characterId, safeUpdates.session, groupId)
                    logger.info(`[GameRoutes] 用户 ${userId} 通过在线编辑更新了会话数据`)
                }

                // 标记会话已提交并清理
                session.submittedAt = Date.now()
                session.updates = safeUpdates
                editSessions.set(editId, session)

                // 30秒后清理会话
                setTimeout(() => editSessions.delete(editId), 30000)

                logger.info(`[GameRoutes] 编辑会话已提交并应用: ${editId}`)

                res.json(
                    ChaiteResponse.ok({
                        editId,
                        updates: safeUpdates,
                        message: '编辑已提交并生效！'
                    })
                )
            } catch (err) {
                logger.error(`[GameRoutes] 应用编辑失败: ${err.message}`)
                res.status(500).json(ChaiteResponse.fail(null, `应用编辑失败: ${err.message}`))
            }
        })
    )

    return router
}

// 导出编辑会话存储供外部使用
export { editSessions, generateUUID, SESSION_EXPIRE_MS, EDITABLE_ENV_FIELDS, EDITABLE_SESSION_FIELDS, PROTECTED_FIELDS }

export default createGameRoutes
