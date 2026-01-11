/**
 * 预设路由模块
 * 使用routeFactory简化CRUD路由
 */

import express from 'express'
import { asyncHandler } from '../middleware/routeFactory.js'
import { presetManager } from '../preset/PresetManager.js'
import config from '../../../config/config.js'

const logger = global.logger || console

// ChaiteResponse helper
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

/**
 * 创建预设路由
 * @param {Function} authMiddleware - 认证中间件
 * @returns {express.Router}
 */
export function createPresetRoutes(authMiddleware) {
    const router = express.Router()
    const auth = authMiddleware ? [authMiddleware] : []

    // 确保presetManager初始化
    const ensureInit = async () => {
        await presetManager.init()
    }

    // GET /api/preset/list - 获取所有预设
    router.get(
        '/list',
        ...auth,
        asyncHandler(async (req, res) => {
            await ensureInit()
            res.json(ChaiteResponse.ok(presetManager.getAll()))
        })
    )

    // GET /api/preset/:id - 获取单个预设
    router.get(
        '/:id',
        ...auth,
        asyncHandler(async (req, res) => {
            await ensureInit()
            const preset = presetManager.get(req.params.id)
            if (preset) {
                res.json(ChaiteResponse.ok(preset))
            } else {
                res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
            }
        })
    )

    // POST /api/preset/ - 创建预设
    router.post(
        '/',
        ...auth,
        asyncHandler(async (req, res) => {
            const preset = await presetManager.create(req.body)
            res.status(201).json(ChaiteResponse.ok(preset))
        })
    )

    // PUT /api/preset/:id - 更新预设
    router.put(
        '/:id',
        ...auth,
        asyncHandler(async (req, res) => {
            // 如果设置 isDefault=true，需要先取消其他预设的 isDefault 状态
            if (req.body.isDefault === true) {
                const allPresets = presetManager.getAll()
                for (const p of allPresets) {
                    if (p.id !== req.params.id && p.isDefault) {
                        await presetManager.update(p.id, { isDefault: false })
                    }
                }
                config.set('presets.defaultId', req.params.id)
                config.set('llm.defaultChatPresetId', req.params.id)
            }

            const preset = await presetManager.update(req.params.id, req.body)
            if (preset) {
                res.json(ChaiteResponse.ok(preset))
            } else {
                res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
            }
        })
    )

    // DELETE /api/preset/:id - 删除预设
    router.delete(
        '/:id',
        ...auth,
        asyncHandler(async (req, res) => {
            const deleted = await presetManager.delete(req.params.id)
            if (deleted) {
                res.json(ChaiteResponse.ok(null))
            } else {
                res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
            }
        })
    )

    // POST /api/preset/:id/default - 设置默认预设
    router.post(
        '/:id/default',
        ...auth,
        asyncHandler(async (req, res) => {
            await ensureInit()
            const preset = presetManager.get(req.params.id)
            if (!preset) {
                return res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
            }

            const allPresets = presetManager.getAll()
            for (const p of allPresets) {
                if (p.id === req.params.id) {
                    await presetManager.update(p.id, { isDefault: true })
                } else if (p.isDefault) {
                    await presetManager.update(p.id, { isDefault: false })
                }
            }

            config.set('presets.defaultId', req.params.id)
            config.set('llm.defaultChatPresetId', req.params.id)

            res.json(ChaiteResponse.ok({ success: true }))
        })
    )

    // GET /api/preset/:id/prompt - 获取预设的系统提示词
    router.get(
        '/:id/prompt',
        ...auth,
        asyncHandler(async (req, res) => {
            await ensureInit()
            const prompt = presetManager.buildSystemPrompt(req.params.id)
            res.json(ChaiteResponse.ok({ prompt }))
        })
    )

    // POST /api/preset/from-builtin/:builtinId - 从内置预设创建新预设
    router.post(
        '/from-builtin/:builtinId',
        ...auth,
        asyncHandler(async (req, res) => {
            await ensureInit()
            const builtinId = req.params.builtinId
            const overrides = req.body || {}

            // 获取内置预设
            const builtinPreset = presetManager.getBuiltin(builtinId)
            if (!builtinPreset) {
                return res.status(404).json(ChaiteResponse.fail(null, `内置预设 ${builtinId} 不存在`))
            }

            // 生成新的预设ID（避免与内置预设冲突）
            const newId = overrides.id || `custom_${builtinId}_${Date.now()}`

            // 合并内置预设和覆盖配置
            const newPreset = {
                ...builtinPreset,
                ...overrides,
                id: newId,
                isBuiltin: false, // 标记为非内置
                createdFrom: builtinId, // 记录来源
                createdAt: Date.now()
            }

            // 创建新预设
            const created = await presetManager.create(newPreset)

            logger.info(`[PresetRoutes] 从内置预设 ${builtinId} 创建新预设 ${newId}`)
            res.status(201).json(ChaiteResponse.ok(created))
        })
    )

    return router
}

/**
 * 创建预设配置路由
 * @param {Function} authMiddleware - 认证中间件
 * @returns {express.Router}
 */
export function createPresetsConfigRoutes(authMiddleware) {
    const router = express.Router()
    const auth = authMiddleware ? [authMiddleware] : []

    // GET /api/presets/config - 获取预设配置
    router.get('/config', ...auth, (req, res) => {
        const presetsConfig = config.get('presets') || {
            defaultId: 'default',
            allowUserSwitch: true,
            perUserPreset: false,
            perGroupPreset: false
        }
        res.json(ChaiteResponse.ok(presetsConfig))
    })

    // PUT /api/presets/config - 更新预设配置
    router.put('/config', ...auth, (req, res) => {
        const { defaultId, allowUserSwitch, perUserPreset, perGroupPreset } = req.body

        if (defaultId !== undefined) config.set('presets.defaultId', defaultId)
        if (allowUserSwitch !== undefined) config.set('presets.allowUserSwitch', allowUserSwitch)
        if (perUserPreset !== undefined) config.set('presets.perUserPreset', perUserPreset)
        if (perGroupPreset !== undefined) config.set('presets.perGroupPreset', perGroupPreset)
        if (defaultId !== undefined) config.set('llm.defaultChatPresetId', defaultId)

        res.json(ChaiteResponse.ok({ success: true }))
    })

    // GET /api/presets/builtin - 获取所有内置预设
    router.get(
        '/builtin',
        ...auth,
        asyncHandler(async (req, res) => {
            await presetManager.init()
            res.json(ChaiteResponse.ok(presetManager.getAllBuiltin()))
        })
    )

    // GET /api/presets/categories - 获取预设分类
    router.get(
        '/categories',
        ...auth,
        asyncHandler(async (req, res) => {
            await presetManager.init()
            res.json(ChaiteResponse.ok(presetManager.getCategories()))
        })
    )

    return router
}

export default { createPresetRoutes, createPresetsConfigRoutes }
