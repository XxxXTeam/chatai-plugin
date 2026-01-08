/**
 * 群管理员路由 - 分群管理入口，下放管理权限到群管理员
 */
import express from 'express'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { ChaiteResponse, getDatabase } from './shared.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { chatLogger } from '../../core/utils/logger.js'
import { schedulerService } from '../scheduler/SchedulerService.js'
import config from '../../../config/config.js'

const router = express.Router()

// 群管理员Token密钥
let groupAdminSecret = null
function getGroupAdminSecret() {
    if (!groupAdminSecret) {
        groupAdminSecret = config.get('web.groupAdminSecret')
        if (!groupAdminSecret) {
            groupAdminSecret = crypto.randomUUID()
            config.set('web.groupAdminSecret', groupAdminSecret)
        }
    }
    return groupAdminSecret
}

// 一次性登录码存储 (code -> { groupId, userId, expiry, used })
const loginCodes = new Map()
// 会话Token存储 (sessionId -> { groupId, userId, expiry })
const sessionTokens = new Map()

/**
 * 生成一次性登录码（5分钟有效，使用后失效）
 * @param {string} groupId - 群ID
 * @param {string} userId - 管理员用户ID
 * @returns {{ code: string, expiry: number }}
 */
export function generateGroupAdminLoginCode(groupId, userId) {
    // 生成6位字母数字码
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 排除易混淆字符
    let code = ''
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    
    const expiry = Date.now() + 5 * 60 * 1000 // 5分钟有效
    
    loginCodes.set(code, {
        groupId: String(groupId),
        userId: String(userId),
        expiry,
        used: false
    })
    
    // 清理过期的登录码
    cleanExpiredCodes()
    
    return { code, expiry }
}

/**
 * 验证登录码并生成会话Token
 * @param {string} code - 登录码
 * @returns {{ token: string, groupId: string, userId: string } | null}
 */
export function verifyLoginCodeAndCreateSession(code) {
    const codeData = loginCodes.get(code?.toUpperCase())
    
    if (!codeData) {
        return null
    }
    
    if (codeData.used) {
        return null // 已使用
    }
    
    if (Date.now() > codeData.expiry) {
        loginCodes.delete(code)
        return null // 已过期
    }
    
    // 标记为已使用
    codeData.used = true
    
    // 生成会话Token (24小时有效)
    const sessionId = crypto.randomUUID()
    const sessionExpiry = Date.now() + 24 * 60 * 60 * 1000
    
    const token = jwt.sign({
        type: 'group_admin_session',
        sessionId,
        groupId: codeData.groupId,
        userId: codeData.userId,
        iat: Math.floor(Date.now() / 1000)
    }, getGroupAdminSecret(), {
        expiresIn: '24h',
        algorithm: 'HS256'
    })
    
    sessionTokens.set(sessionId, {
        groupId: codeData.groupId,
        userId: codeData.userId,
        expiry: sessionExpiry
    })
    
    // 清理过期会话
    cleanExpiredSessions()
    
    return {
        token,
        groupId: codeData.groupId,
        userId: codeData.userId
    }
}

function cleanExpiredCodes() {
    const now = Date.now()
    for (const [code, data] of loginCodes.entries()) {
        if (now > data.expiry || data.used) {
            loginCodes.delete(code)
        }
    }
}

function cleanExpiredSessions() {
    const now = Date.now()
    for (const [sessionId, data] of sessionTokens.entries()) {
        if (now > data.expiry) {
            sessionTokens.delete(sessionId)
        }
    }
}

// 兼容旧API - 生成直接登录Token（已废弃，保留以兼容）
export function generateGroupAdminToken(groupId, userId, timeout = 24 * 60 * 60) {
    const { code } = generateGroupAdminLoginCode(groupId, userId)
    return code // 返回登录码而不是JWT
}

/**
 * 验证会话Token
 */
function verifySessionToken(token) {
    try {
        const decoded = jwt.verify(token, getGroupAdminSecret())
        if (decoded.type !== 'group_admin_session') {
            return null
        }
        // 检查会话是否仍有效
        const session = sessionTokens.get(decoded.sessionId)
        if (!session || Date.now() > session.expiry) {
            return null
        }
        return decoded
    } catch (error) {
        chatLogger.debug('[GroupAdmin] Token验证失败:', error.message)
        return null
    }
}

/**
 * 群管理员认证中间件
 */
function groupAdminAuth(req, res, next) {
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null
    
    if (!token) {
        return res.status(401).json(ChaiteResponse.fail(null, '需要群管理员认证'))
    }
    
    const decoded = verifySessionToken(token)
    if (!decoded) {
        return res.status(401).json(ChaiteResponse.fail(null, '会话无效或已过期，请重新登录'))
    }
    
    req.groupAdmin = {
        groupId: decoded.groupId,
        userId: decoded.userId
    }
    next()
}

// ==================== 群管理员认证 ====================

/**
 * POST /api/group-admin/login - 群管理员登录（通过一次性登录码）
 */
router.post('/login', async (req, res) => {
    try {
        const { code } = req.body
        
        if (!code) {
            return res.status(400).json(ChaiteResponse.fail(null, '请输入登录码'))
        }
        
        // 验证登录码并创建会话
        const result = verifyLoginCodeAndCreateSession(code)
        if (!result) {
            return res.status(401).json(ChaiteResponse.fail(null, '登录码无效、已过期或已使用'))
        }
        
        res.json(ChaiteResponse.ok({
            token: result.token,
            groupId: result.groupId,
            userId: result.userId,
            expiresIn: 24 * 60 * 60 // 24小时
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * GET /api/group-admin/verify - 验证Token
 */
router.get('/verify', groupAdminAuth, (req, res) => {
    res.json(ChaiteResponse.ok({
        valid: true,
        groupId: req.groupAdmin.groupId,
        userId: req.groupAdmin.userId
    }))
})

// ==================== 群组配置管理 ====================

/**
 * GET /api/group-admin/config - 获取群配置
 */
router.get('/config', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()
        
        const groupSettings = await scopeManager.getGroupSettings(groupId)
        const settings = groupSettings?.settings || {}
        
        // 获取预设列表（包含描述和提示词预览）
        const { presetManager } = await import('../preset/PresetManager.js')
        await presetManager.init()
        const presets = presetManager.getAll({ includeBuiltin: true }).map(p => ({
            id: p.id,
            name: p.name,
            description: p.description || '',
            systemPromptPreview: p.systemPrompt ? p.systemPrompt.substring(0, 100) + (p.systemPrompt.length > 100 ? '...' : '') : ''
        }))
        
        // 获取渠道列表（仅返回模型名称）
        const { channelManager } = await import('../llm/ChannelManager.js')
        await channelManager.init()
        const channels = channelManager.getAll().map(c => ({
            id: c.id,
            name: c.name,
            models: c.models || []
        }))
        
        // 获取知识库列表
        let knowledgeBases = []
        try {
            const { knowledgeService } = await import('../storage/KnowledgeService.js')
            await knowledgeService.init()
            knowledgeBases = knowledgeService.getAll().map(k => ({ id: k.id, name: k.name }))
        } catch (e) {
            chatLogger.debug('[GroupAdmin] 获取知识库列表失败:', e.message)
        }
        
        res.json(ChaiteResponse.ok({
            groupId,
            groupName: settings.groupName || groupSettings?.groupName || '',
            systemPrompt: groupSettings?.systemPrompt || '',
            presetId: groupSettings?.presetId || '',
            enabled: groupSettings?.enabled ?? settings.enabled ?? true,
            triggerMode: settings.triggerMode || 'default',
            customPrefix: settings.customPrefix || '',
            // 功能开关
            toolsEnabled: settings.toolsEnabled,
            imageGenEnabled: settings.imageGenEnabled,
            summaryEnabled: settings.summaryEnabled,
            eventHandler: settings.eventEnabled,
            // 表情小偷
            emojiThief: {
                enabled: settings.emojiThiefEnabled,
                independent: settings.emojiThiefSeparateFolder ?? true,
                maxCount: settings.emojiThiefMaxCount ?? 500,
                probability: settings.emojiThiefStealRate ? Math.round(settings.emojiThiefStealRate * 100) : 100,
                triggerRate: settings.emojiThiefTriggerRate ? Math.round(settings.emojiThiefTriggerRate * 100) : 5,
                triggerMode: settings.emojiThiefTriggerMode || 'off'
            },
            // 伪人配置
            bym: {
                enabled: settings.bymEnabled,
                presetId: settings.bymPresetId,
                prompt: settings.bymPrompt,
                probability: settings.bymProbability,
                modelId: settings.bymModel,
                temperature: settings.bymTemperature,
                maxTokens: settings.bymMaxTokens
            },
            // 模型配置
            models: {
                chat: settings.chatModel || settings.modelId,
                tools: settings.toolModel,
                dispatch: settings.dispatchModel,
                vision: settings.imageModel,
                image: settings.drawModel,
                search: settings.searchModel,
                bym: settings.roleplayModel,
                summary: settings.summaryModel,
                profile: settings.profileModel
            },
            // 黑白名单
            listMode: settings.listMode || 'none',
            blacklist: settings.blacklist || [],
            whitelist: settings.whitelist || [],
            // 定时推送
            summaryPush: {
                enabled: settings.summaryPushEnabled || false,
                intervalType: settings.summaryPushIntervalType || 'day',
                intervalValue: settings.summaryPushIntervalValue || 1,
                pushHour: settings.summaryPushHour ?? 20,
                messageCount: settings.summaryPushMessageCount || 100
            },
            // 事件处理扩展
            welcomeEnabled: settings.welcomeEnabled,
            welcomeMessage: settings.welcomeMessage || '',
            welcomePrompt: settings.welcomePrompt || '',
            goodbyeEnabled: settings.goodbyeEnabled,
            goodbyePrompt: settings.goodbyePrompt || '',
            pokeEnabled: settings.pokeEnabled,
            pokeBack: settings.pokeBack || false,
            // 知识库
            knowledgeIds: groupSettings?.knowledgeIds || [],
            // 辅助数据
            presets,
            channels,
            knowledgeBases
        }))
    } catch (error) {
        chatLogger.error('[GroupAdmin] 获取配置失败:', error?.message || error?.stack || String(error))
        res.status(500).json(ChaiteResponse.fail(null, error?.message || '获取配置失败'))
    }
})

/**
 * PUT /api/group-admin/config - 更新群配置
 */
router.put('/config', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()
        
        const body = req.body
        
        // 构建更新数据
        const updateData = {
            systemPrompt: body.systemPrompt,
            presetId: body.presetId || undefined,
            enabled: body.enabled,
            // 设置嵌套在 settings 中
            groupName: body.groupName,
            triggerMode: body.triggerMode,
            customPrefix: body.customPrefix,
            // 功能开关
            toolsEnabled: body.toolsEnabled,
            imageGenEnabled: body.imageGenEnabled,
            summaryEnabled: body.summaryEnabled,
            eventEnabled: body.eventHandler,
            // 表情小偷
            emojiThiefEnabled: body.emojiThief?.enabled,
            emojiThiefSeparateFolder: body.emojiThief?.independent,
            emojiThiefMaxCount: body.emojiThief?.maxCount,
            emojiThiefStealRate: body.emojiThief?.probability ? body.emojiThief.probability / 100 : undefined,
            emojiThiefTriggerRate: body.emojiThief?.triggerRate ? body.emojiThief.triggerRate / 100 : undefined,
            emojiThiefTriggerMode: body.emojiThief?.triggerMode,
            // 伪人
            bymEnabled: body.bym?.enabled,
            bymPresetId: body.bym?.presetId,
            bymPrompt: body.bym?.prompt,
            bymProbability: body.bym?.probability,
            bymModel: body.bym?.modelId,
            bymTemperature: body.bym?.temperature,
            bymMaxTokens: body.bym?.maxTokens,
            // 模型
            chatModel: body.models?.chat,
            toolModel: body.models?.tools,
            dispatchModel: body.models?.dispatch,
            imageModel: body.models?.vision,
            drawModel: body.models?.image,
            searchModel: body.models?.search,
            roleplayModel: body.models?.bym,
            summaryModel: body.models?.summary,
            profileModel: body.models?.profile,
            // 黑白名单
            listMode: body.listMode,
            blacklist: body.blacklist,
            whitelist: body.whitelist,
            // 定时推送
            summaryPushEnabled: body.summaryPush?.enabled,
            summaryPushIntervalType: body.summaryPush?.intervalType,
            summaryPushIntervalValue: body.summaryPush?.intervalValue,
            summaryPushHour: body.summaryPush?.pushHour,
            summaryPushMessageCount: body.summaryPush?.messageCount,
            // 事件处理扩展
            welcomeEnabled: body.welcomeEnabled,
            welcomeMessage: body.welcomeMessage,
            welcomePrompt: body.welcomePrompt,
            goodbyeEnabled: body.goodbyeEnabled,
            goodbyePrompt: body.goodbyePrompt,
            pokeEnabled: body.pokeEnabled,
            pokeBack: body.pokeBack
        }
        
        // 知识库单独处理（存储在 knowledgeIds 字段）
        if (body.knowledgeIds !== undefined) {
            updateData.knowledgeIds = body.knowledgeIds
        }
        
        // 移除 undefined 值
        Object.keys(updateData).forEach(key => {
            if (updateData[key] === undefined) {
                delete updateData[key]
            }
        })
        
        await scopeManager.setGroupSettings(groupId, updateData)
        
        // 更新调度任务
        schedulerService.updateGroupTask(groupId, {
            summaryPushEnabled: body.summaryPush?.enabled,
            summaryPushIntervalType: body.summaryPush?.intervalType,
            summaryPushIntervalValue: body.summaryPush?.intervalValue,
            summaryPushHour: body.summaryPush?.pushHour,
            summaryPushMessageCount: body.summaryPush?.messageCount,
            summaryModel: body.models?.summary
        })
        
        chatLogger.info(`[GroupAdmin] 群 ${groupId} 配置已更新 (操作者: ${req.groupAdmin.userId})`)
        
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        chatLogger.error('[GroupAdmin] 更新配置失败:', error)
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 黑白名单管理 ====================

/**
 * GET /api/group-admin/blacklist - 获取黑名单
 */
router.get('/blacklist', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()
        
        const groupSettings = await scopeManager.getGroupSettings(groupId)
        const blacklist = groupSettings?.settings?.blacklist || []
        
        res.json(ChaiteResponse.ok({ blacklist }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * PUT /api/group-admin/blacklist - 更新黑名单
 */
router.put('/blacklist', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { blacklist } = req.body
        
        if (!Array.isArray(blacklist)) {
            return res.status(400).json(ChaiteResponse.fail(null, 'blacklist必须是数组'))
        }
        
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()
        
        const current = await scopeManager.getGroupSettings(groupId) || {}
        const currentSettings = current.settings || {}
        
        await scopeManager.setGroupSettings(groupId, {
            ...currentSettings,
            blacklist: blacklist.map(String)
        })
        
        chatLogger.info(`[GroupAdmin] 群 ${groupId} 黑名单已更新: ${blacklist.length} 人`)
        
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * POST /api/group-admin/blacklist/add - 添加到黑名单
 */
router.post('/blacklist/add', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { userId } = req.body
        
        if (!userId) {
            return res.status(400).json(ChaiteResponse.fail(null, '缺少userId'))
        }
        
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()
        
        const current = await scopeManager.getGroupSettings(groupId) || {}
        const currentSettings = current.settings || {}
        const blacklist = currentSettings.blacklist || []
        
        if (!blacklist.includes(String(userId))) {
            blacklist.push(String(userId))
            await scopeManager.setGroupSettings(groupId, {
                ...currentSettings,
                blacklist
            })
        }
        
        res.json(ChaiteResponse.ok({ success: true, blacklist }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * POST /api/group-admin/blacklist/remove - 从黑名单移除
 */
router.post('/blacklist/remove', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { userId } = req.body
        
        if (!userId) {
            return res.status(400).json(ChaiteResponse.fail(null, '缺少userId'))
        }
        
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()
        
        const current = await scopeManager.getGroupSettings(groupId) || {}
        const currentSettings = current.settings || {}
        let blacklist = currentSettings.blacklist || []
        
        blacklist = blacklist.filter(id => id !== String(userId))
        await scopeManager.setGroupSettings(groupId, {
            ...currentSettings,
            blacklist
        })
        
        res.json(ChaiteResponse.ok({ success: true, blacklist }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * GET /api/group-admin/whitelist - 获取白名单
 */
router.get('/whitelist', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()
        
        const groupSettings = await scopeManager.getGroupSettings(groupId)
        const whitelist = groupSettings?.settings?.whitelist || []
        
        res.json(ChaiteResponse.ok({ whitelist }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * PUT /api/group-admin/whitelist - 更新白名单
 */
router.put('/whitelist', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { whitelist } = req.body
        
        if (!Array.isArray(whitelist)) {
            return res.status(400).json(ChaiteResponse.fail(null, 'whitelist必须是数组'))
        }
        
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()
        
        const current = await scopeManager.getGroupSettings(groupId) || {}
        const currentSettings = current.settings || {}
        
        await scopeManager.setGroupSettings(groupId, {
            ...currentSettings,
            whitelist: whitelist.map(String)
        })
        
        chatLogger.info(`[GroupAdmin] 群 ${groupId} 白名单已更新: ${whitelist.length} 人`)
        
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 定时任务管理 ====================

/**
 * GET /api/group-admin/scheduler/status - 获取定时任务状态
 */
router.get('/scheduler/status', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const status = schedulerService.getTaskStatus(groupId)
        res.json(ChaiteResponse.ok(status || { enabled: false }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * POST /api/group-admin/scheduler/trigger - 手动触发定时总结
 */
router.post('/scheduler/trigger', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        await schedulerService.triggerSummaryNow(groupId)
        res.json(ChaiteResponse.ok({ success: true, message: '总结推送已触发' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
