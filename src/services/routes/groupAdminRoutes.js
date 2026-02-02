/**
 * 群管理员路由 - 分群管理入口，下放管理权限到群管理员
 */
import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import { ChaiteResponse, getDatabase } from './shared.js'
import { getScopeManager } from '../scope/ScopeManager.js'
import { chatLogger } from '../../core/utils/logger.js'
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

    const token = jwt.sign(
        {
            type: 'group_admin_session',
            sessionId,
            groupId: codeData.groupId,
            userId: codeData.userId,
            iat: Math.floor(Date.now() / 1000)
        },
        getGroupAdminSecret(),
        {
            expiresIn: '24h',
            algorithm: 'HS256'
        }
    )

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

        res.json(
            ChaiteResponse.ok({
                token: result.token,
                groupId: result.groupId,
                userId: result.userId,
                expiresIn: 24 * 60 * 60 // 24小时
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * GET /api/group-admin/verify - 验证Token
 */
router.get('/verify', groupAdminAuth, (req, res) => {
    res.json(
        ChaiteResponse.ok({
            valid: true,
            groupId: req.groupAdmin.groupId,
            userId: req.groupAdmin.userId
        })
    )
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
            systemPromptPreview: p.systemPrompt
                ? p.systemPrompt.substring(0, 100) + (p.systemPrompt.length > 100 ? '...' : '')
                : ''
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

        // 获取表情统计
        let emojiStats = { total: 0, images: [] }
        try {
            const { emojiThiefService } = await import('../../../apps/EmojiThief.js')
            const groupIdStr = String(groupId)
            const config = await emojiThiefService.getGroupConfig(groupIdStr)
            const emojiPath = emojiThiefService.getEmojiDir(groupIdStr, config.separateFolder)

            if (emojiPath && fs.existsSync(emojiPath)) {
                const files = fs.readdirSync(emojiPath).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f))
                emojiStats = {
                    total: files.length,
                    images: files.slice(0, 50).map(f => ({
                        name: f,
                        url: `/api/group-admin/emoji/view?groupId=${groupId}&file=${encodeURIComponent(f)}`
                    }))
                }
            }
        } catch (e) {
            chatLogger.debug('[GroupAdmin] 获取表情统计失败:', e.message)
        }

        res.json(
            ChaiteResponse.ok({
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
                // 伪人配置（含主动发言）
                bym: {
                    enabled: settings.bymEnabled,
                    presetId: settings.bymPresetId,
                    prompt: settings.bymPrompt,
                    probability: settings.bymProbability,
                    modelId: settings.bymModel,
                    temperature: settings.bymTemperature,
                    maxTokens: settings.bymMaxTokens,
                    // 主动发言（伪人扩展）
                    proactive: {
                        enabled: settings.proactiveChatEnabled || false,
                        probability: settings.proactiveChatProbability ?? 0.05,
                        cooldown: settings.proactiveChatCooldown ?? 300,
                        maxDaily: settings.proactiveChatMaxDaily ?? 10,
                        minMessages: settings.proactiveChatMinMessages ?? 5,
                        keywords: settings.proactiveChatKeywords || [],
                        timeRange: {
                            start: settings.proactiveChatTimeStart ?? 8,
                            end: settings.proactiveChatTimeEnd ?? 23
                        }
                    },
                    // 回复风格
                    style: {
                        replyLength: settings.bymReplyLength || 'medium',
                        useEmoji: settings.bymUseEmoji ?? true,
                        personalityStrength: settings.bymPersonalityStrength ?? 0.7
                    }
                },
                // 聊天配置
                chat: {
                    enabled: settings.chatEnabled ?? true,
                    contextLength: settings.chatContextLength ?? 20,
                    temperature: settings.chatTemperature,
                    maxTokens: settings.chatMaxTokens,
                    streamReply: settings.chatStreamReply ?? true,
                    quoteReply: settings.chatQuoteReply ?? false,
                    showThinking: settings.chatShowThinking ?? true,
                    autoRecall: {
                        enabled: settings.chatAutoRecallEnabled ?? false,
                        delay: settings.chatAutoRecallDelay ?? 60
                    }
                },
                // 绘图配置
                imageGen: {
                    enabled: settings.imageGenEnabled,
                    modelId: settings.drawModel || settings.imageGenModel,
                    size: settings.imageGenSize || '1024x1024',
                    quality: settings.imageGenQuality || 'standard',
                    style: settings.imageGenStyle || 'vivid',
                    negativePrompt: settings.imageGenNegativePrompt || '',
                    maxDailyLimit: settings.imageGenDailyLimit ?? 0,
                    cooldown: settings.imageGenCooldown ?? 0
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
                // 知识库
                knowledgeIds: groupSettings?.knowledgeIds || [],
                // 群独立渠道配置
                independentChannel: {
                    hasChannel: !!(settings.independentBaseUrl && settings.independentApiKey),
                    baseUrl: settings.independentBaseUrl || '',
                    apiKey: settings.independentApiKey ? '****' + settings.independentApiKey.slice(-4) : '',
                    adapterType: settings.independentAdapterType || 'openai',
                    // forbidGlobal 字段不返回给群管理面板，该设置仅主管理面板可访问和修改
                    channels: (() => {
                        if (!settings.independentChannels) return []
                        try {
                            const channels =
                                typeof settings.independentChannels === 'string'
                                    ? JSON.parse(settings.independentChannels)
                                    : settings.independentChannels
                            if (Array.isArray(channels)) {
                                return channels.map(ch => ({
                                    ...ch,
                                    apiKey: ch.apiKey ? '****' + ch.apiKey.slice(-4) : ''
                                }))
                            }
                            return []
                        } catch (e) {
                            return []
                        }
                    })()
                },
                // 使用限制
                usageLimit: {
                    dailyGroupLimit: settings.dailyGroupLimit || 0,
                    dailyUserLimit: settings.dailyUserLimit || 0,
                    limitMessage: settings.usageLimitMessage || '',
                    // 分功能限制
                    chatLimit: settings.chatDailyLimit ?? 0,
                    imageLimit: settings.imageDailyLimit ?? 0,
                    toolsLimit: settings.toolsDailyLimit ?? 0
                },
                // 总结配置
                summary: {
                    enabled: settings.summaryEnabled,
                    modelId: settings.summaryModel,
                    autoTrigger: settings.summaryAutoTrigger ?? false,
                    triggerCount: settings.summaryTriggerCount ?? 100,
                    includeImages: settings.summaryIncludeImages ?? false,
                    maxLength: settings.summaryMaxLength ?? 500,
                    // 定时推送
                    push: {
                        enabled: settings.summaryPushEnabled || false,
                        intervalType: settings.summaryPushIntervalType || 'day',
                        intervalValue: settings.summaryPushIntervalValue || 1,
                        pushHour: settings.summaryPushHour ?? 20,
                        messageCount: settings.summaryPushMessageCount || 100
                    }
                },
                // 工具调用配置
                tools: {
                    enabled: settings.toolsEnabled,
                    allowedTools: settings.allowedTools || [],
                    blockedTools: settings.blockedTools || [],
                    autoApprove: settings.toolsAutoApprove ?? true,
                    maxCalls: settings.toolsMaxCalls ?? 5
                },
                // 事件处理配置
                events: {
                    enabled: settings.eventEnabled,
                    welcome: {
                        enabled: settings.welcomeEnabled,
                        message: settings.welcomeMessage || '',
                        prompt: settings.welcomePrompt || '',
                        probability: settings.welcomeProbability,
                        useAI: settings.welcomeUseAI ?? false
                    },
                    goodbye: {
                        enabled: settings.goodbyeEnabled,
                        prompt: settings.goodbyePrompt || '',
                        probability: settings.goodbyeProbability,
                        useAI: settings.goodbyeUseAI ?? false
                    },
                    poke: {
                        enabled: settings.pokeEnabled,
                        pokeBack: settings.pokeBack ?? false,
                        probability: settings.pokeProbability,
                        message: settings.pokeMessage || ''
                    }
                },
                // 表情小偷管理
                emojiStats,
                // 辅助数据
                presets,
                channels,
                knowledgeBases
            })
        )
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

        // 处理 masked apiKey
        let newChannels = body.independentChannel?.channels
        if (newChannels && Array.isArray(newChannels)) {
            const existingGroupSettings = await scopeManager.getGroupSettings(groupId)
            const existingSettings = existingGroupSettings?.settings || {}
            let existingChannels = existingSettings.independentChannels || []
            if (typeof existingChannels === 'string') {
                try {
                    existingChannels = JSON.parse(existingChannels)
                } catch (e) {
                    existingChannels = []
                }
            }

            newChannels = newChannels.map(ch => {
                if (ch.apiKey && ch.apiKey.startsWith('****')) {
                    const oldCh = Array.isArray(existingChannels)
                        ? existingChannels.find(old => old.id === ch.id)
                        : null
                    if (oldCh) {
                        return { ...ch, apiKey: oldCh.apiKey }
                    }
                }
                return ch
            })
        }

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
            // 伪人（含主动发言）
            bymEnabled: body.bym?.enabled,
            bymPresetId: body.bym?.presetId,
            bymPrompt: body.bym?.prompt,
            bymProbability: body.bym?.probability,
            bymModel: body.bym?.modelId,
            bymTemperature: body.bym?.temperature,
            bymMaxTokens: body.bym?.maxTokens,
            // 伪人 - 主动发言
            proactiveChatEnabled: body.bym?.proactive?.enabled,
            proactiveChatProbability: body.bym?.proactive?.probability,
            proactiveChatCooldown: body.bym?.proactive?.cooldown,
            proactiveChatMaxDaily: body.bym?.proactive?.maxDaily,
            proactiveChatMinMessages: body.bym?.proactive?.minMessages,
            proactiveChatKeywords: body.bym?.proactive?.keywords,
            proactiveChatTimeStart: body.bym?.proactive?.timeRange?.start,
            proactiveChatTimeEnd: body.bym?.proactive?.timeRange?.end,
            // 伪人 - 回复风格
            bymReplyLength: body.bym?.style?.replyLength,
            bymUseEmoji: body.bym?.style?.useEmoji,
            bymPersonalityStrength: body.bym?.style?.personalityStrength,
            // 聊天配置
            chatEnabled: body.chat?.enabled,
            chatContextLength: body.chat?.contextLength,
            chatTemperature: body.chat?.temperature,
            chatMaxTokens: body.chat?.maxTokens,
            chatStreamReply: body.chat?.streamReply,
            chatQuoteReply: body.chat?.quoteReply,
            chatShowThinking: body.chat?.showThinking,
            chatAutoRecallEnabled: body.chat?.autoRecall?.enabled,
            chatAutoRecallDelay: body.chat?.autoRecall?.delay,
            // 绘图配置
            imageGenEnabled: body.imageGen?.enabled,
            imageGenModel: body.imageGen?.modelId,
            imageGenSize: body.imageGen?.size,
            imageGenQuality: body.imageGen?.quality,
            imageGenStyle: body.imageGen?.style,
            imageGenNegativePrompt: body.imageGen?.negativePrompt,
            imageGenDailyLimit: body.imageGen?.maxDailyLimit,
            imageGenCooldown: body.imageGen?.cooldown,
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
            // 总结配置
            summaryEnabled: body.summary?.enabled,
            summaryModel: body.summary?.modelId ?? body.models?.summary,
            summaryAutoTrigger: body.summary?.autoTrigger,
            summaryTriggerCount: body.summary?.triggerCount,
            summaryIncludeImages: body.summary?.includeImages,
            summaryMaxLength: body.summary?.maxLength,
            // 总结 - 定时推送
            summaryPushEnabled: body.summary?.push?.enabled,
            summaryPushIntervalType: body.summary?.push?.intervalType,
            summaryPushIntervalValue: body.summary?.push?.intervalValue,
            summaryPushHour: body.summary?.push?.pushHour,
            summaryPushMessageCount: body.summary?.push?.messageCount,
            // 工具配置
            toolsEnabled: body.tools?.enabled ?? body.toolsEnabled,
            allowedTools: body.tools?.allowedTools,
            blockedTools: body.tools?.blockedTools,
            toolsAutoApprove: body.tools?.autoApprove,
            toolsMaxCalls: body.tools?.maxCalls,
            // 事件处理
            eventEnabled: body.events?.enabled ?? body.eventHandler,
            welcomeEnabled: body.events?.welcome?.enabled,
            welcomeMessage: body.events?.welcome?.message,
            welcomePrompt: body.events?.welcome?.prompt,
            welcomeProbability: body.events?.welcome?.probability,
            welcomeUseAI: body.events?.welcome?.useAI,
            goodbyeEnabled: body.events?.goodbye?.enabled,
            goodbyePrompt: body.events?.goodbye?.prompt,
            goodbyeProbability: body.events?.goodbye?.probability,
            goodbyeUseAI: body.events?.goodbye?.useAI,
            pokeEnabled: body.events?.poke?.enabled,
            pokeBack: body.events?.poke?.pokeBack,
            pokeProbability: body.events?.poke?.probability,
            pokeMessage: body.events?.poke?.message,
            // 群独立渠道配置
            independentBaseUrl: body.independentChannel?.baseUrl,
            independentApiKey:
                body.independentChannel?.apiKey && !body.independentChannel.apiKey.startsWith('****')
                    ? body.independentChannel.apiKey
                    : undefined,
            independentAdapterType: body.independentChannel?.adapterType,
            // forbidGlobalModel 不允许通过群管理面板修改，该设置仅主管理面板可修改
            independentChannels: newChannels,
            // 使用限制
            dailyGroupLimit: body.usageLimit?.dailyGroupLimit,
            dailyUserLimit: body.usageLimit?.dailyUserLimit,
            usageLimitMessage: body.usageLimit?.limitMessage,
            chatDailyLimit: body.usageLimit?.chatLimit,
            imageDailyLimit: body.usageLimit?.imageLimit,
            toolsDailyLimit: body.usageLimit?.toolsLimit
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

        const current = (await scopeManager.getGroupSettings(groupId)) || {}
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

        const current = (await scopeManager.getGroupSettings(groupId)) || {}
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

        const current = (await scopeManager.getGroupSettings(groupId)) || {}
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

        const current = (await scopeManager.getGroupSettings(groupId)) || {}
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
        // 定时任务已重构，返回空状态
        res.json(ChaiteResponse.ok({ enabled: false, message: '定时任务模块已重构' }))
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
        // 定时任务已重构，此功能待重新实现
        res.json(ChaiteResponse.ok({ success: false, message: '定时总结功能已重构，请使用新的自然语言定时任务' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * GET /api/group-admin/channel - 获取群独立渠道配置
 */
router.get('/channel', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()

        const channelConfig = await scopeManager.getGroupChannelConfig(groupId)

        res.json(
            ChaiteResponse.ok({
                groupId,
                hasIndependentChannel: !!(channelConfig?.baseUrl && channelConfig?.apiKey),
                channelId: channelConfig?.channelId || null,
                baseUrl: channelConfig?.baseUrl || '',
                apiKey: channelConfig?.apiKey ? '****' + channelConfig.apiKey.slice(-4) : '',
                adapterType: channelConfig?.adapterType || 'openai',
                // forbidGlobal 字段不返回给群管理面板
                modelId: channelConfig?.modelId || ''
            })
        )
    } catch (error) {
        chatLogger.error('[GroupAdmin] 获取渠道配置失败:', error)
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * PUT /api/group-admin/channel - 更新群独立渠道配置
 */
router.put('/channel', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { baseUrl, apiKey, adapterType, modelId } = req.body // 移除 forbidGlobal 参数

        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()

        // 获取现有配置
        const existing = (await scopeManager.getGroupChannelConfig(groupId)) || {}

        // 构建更新数据（不允许修改 forbidGlobal）
        const updateData = {
            channelId: existing.channelId,
            baseUrl: baseUrl !== undefined ? baseUrl : existing.baseUrl,
            apiKey: apiKey !== undefined && apiKey !== '' && !apiKey.startsWith('****') ? apiKey : existing.apiKey,
            adapterType: adapterType !== undefined ? adapterType : existing.adapterType,
            // forbidGlobal 保持现有值，不允许通过群管理面板修改
            forbidGlobal: existing.forbidGlobal,
            modelId: modelId !== undefined ? modelId : existing.modelId
        }

        await scopeManager.setGroupChannelConfig(groupId, updateData)

        chatLogger.info(`[GroupAdmin] 群 ${groupId} 渠道配置已更新 (操作者: ${req.groupAdmin.userId})`)

        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        chatLogger.error('[GroupAdmin] 更新渠道配置失败:', error)
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * DELETE /api/group-admin/channel - 清除群独立渠道配置
 */
router.delete('/channel', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()

        await scopeManager.setGroupChannelConfig(groupId, {
            channelId: null,
            baseUrl: null,
            apiKey: null,
            adapterType: 'openai',
            // forbidGlobal 不在清空时重置，保持现有值
            modelId: null
        })

        chatLogger.info(`[GroupAdmin] 群 ${groupId} 渠道配置已清除`)

        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 群使用限制 ====================

/**
 * GET /api/group-admin/usage-limit - 获取群使用限制配置
 */
router.get('/usage-limit', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()

        const limitConfig = await scopeManager.getGroupUsageLimitConfig(groupId)

        res.json(
            ChaiteResponse.ok({
                groupId,
                dailyGroupLimit: limitConfig.dailyGroupLimit,
                dailyUserLimit: limitConfig.dailyUserLimit,
                limitMessage: limitConfig.limitMessage
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * PUT /api/group-admin/usage-limit - 更新群使用限制配置
 */
router.put('/usage-limit', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { dailyGroupLimit, dailyUserLimit, limitMessage } = req.body

        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()

        await scopeManager.setGroupUsageLimitConfig(groupId, {
            dailyGroupLimit: dailyGroupLimit || 0,
            dailyUserLimit: dailyUserLimit || 0,
            limitMessage: limitMessage || undefined
        })

        chatLogger.info(`[GroupAdmin] 群 ${groupId} 使用限制已更新: 群${dailyGroupLimit}/用户${dailyUserLimit}`)

        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * GET /api/group-admin/usage-stats - 获取群使用统计
 */
router.get('/usage-stats', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()

        const summary = await scopeManager.getUsageSummary(groupId)

        res.json(
            ChaiteResponse.ok({
                groupId,
                date: summary.date,
                groupCount: summary.groupCount,
                dailyGroupLimit: summary.dailyGroupLimit,
                dailyUserLimit: summary.dailyUserLimit,
                groupRemaining: summary.groupRemaining,
                topUsers: summary.topUsers,
                totalUsers: summary.totalUsers
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * POST /api/group-admin/usage-stats/reset - 重置群使用统计
 */
router.post('/usage-stats/reset', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const db = getDatabase()
        const scopeManager = getScopeManager(db)
        await scopeManager.init()

        await scopeManager.resetUsage(groupId)

        chatLogger.info(`[GroupAdmin] 群 ${groupId} 使用统计已重置`)

        res.json(ChaiteResponse.ok({ success: true, message: '使用统计已重置' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * DELETE /api/group-admin/emoji/clear - 清空群表情
 */
router.delete('/emoji/clear', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { emojiThiefService } = await import('../../../apps/EmojiThief.js')
        const config = await emojiThiefService.getGroupConfig(groupId)
        const emojiDir = emojiThiefService.getEmojiDir(groupId, config.separateFolder)

        if (emojiDir && fs.existsSync(emojiDir)) {
            const files = fs.readdirSync(emojiDir)
            let count = 0
            for (const file of files) {
                if (/\.(jpg|jpeg|png|gif|webp)$/i.test(file)) {
                    fs.unlinkSync(path.join(emojiDir, file))
                    count++
                }
            }
            res.json(ChaiteResponse.ok({ success: true, count }))
        } else {
            res.json(ChaiteResponse.fail(null, '未找到表情目录'))
        }
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * DELETE /api/group-admin/emoji/delete - 删除单个表情
 */
router.delete('/emoji/delete', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { file } = req.query

        if (!file) return res.status(400).json(ChaiteResponse.fail(null, '缺少参数'))

        const { emojiThiefService } = await import('../../../apps/EmojiThief.js')
        const config = await emojiThiefService.getGroupConfig(groupId)
        const emojiDir = emojiThiefService.getEmojiDir(groupId, config.separateFolder)

        if (emojiDir) {
            const filePath = path.join(emojiDir, path.basename(String(file)))
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath)
                res.json(ChaiteResponse.ok({ success: true }))
            } else {
                res.status(404).json(ChaiteResponse.fail(null, '文件不存在'))
            }
        } else {
            res.status(400).json(ChaiteResponse.fail(null, '未找到表情目录'))
        }
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

/**
 * GET /api/group-admin/emoji/view - 查看表情图片
 */
router.get('/emoji/view', groupAdminAuth, async (req, res) => {
    try {
        const { groupId } = req.groupAdmin
        const { file } = req.query

        if (!file) return res.status(400).send('缺少参数')

        const { emojiThiefService } = await import('../../../apps/EmojiThief.js')
        const config = await emojiThiefService.getGroupConfig(groupId)
        const emojiDir = emojiThiefService.getEmojiDir(groupId, config.separateFolder)

        if (emojiDir) {
            const filePath = path.join(emojiDir, path.basename(String(file)))
            if (fs.existsSync(filePath)) {
                res.sendFile(filePath)
            } else {
                res.status(404).send('文件不存在')
            }
        } else {
            res.status(400).send('目录不存在')
        }
    } catch (error) {
        res.status(500).send(error.message)
    }
})

export default router
