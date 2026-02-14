/**
 * 作用域路由模块 - 用户/群组配置管理
 */
import express from 'express'
import { ChaiteResponse, getDatabase } from './shared.js'
import { getScopeManager } from '../scope/ScopeManager.js'

const router = express.Router()

let scopeManager = null
const ensureScopeManager = async () => {
    if (!scopeManager) {
        const db = getDatabase()
        scopeManager = getScopeManager(db)
        await scopeManager.init()
    }
    return scopeManager
}

// ==================== 用户作用域 ====================
router.get('/users', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const users = await sm.listUserSettings()
        res.json(ChaiteResponse.ok(users))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/user/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const settings = await sm.getUserSettings(req.params.userId)
        res.json(ChaiteResponse.ok(settings))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.put('/user/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.setUserSettings(req.params.userId, req.body)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.delete('/user/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.deleteUserSettings(req.params.userId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 私聊作用域 ====================
router.get('/privates', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const privates = await sm.listPrivateSettings()
        res.json(ChaiteResponse.ok(privates))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/private/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const settings = await sm.getPrivateSettings(req.params.userId)
        res.json(ChaiteResponse.ok(settings))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.put('/private/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.setPrivateSettings(req.params.userId, req.body)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.delete('/private/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.deletePrivateSettings(req.params.userId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 群组作用域 ====================
router.get('/groups', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const groups = await sm.listGroupSettings()
        const formattedGroups = groups.map(g => ({
            ...g,
            enabled: g.settings?.enabled ?? true,
            triggerMode: g.settings?.triggerMode || 'default',
            groupName: g.settings?.groupName || g.groupName
        }))
        res.json(ChaiteResponse.ok(formattedGroups))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/group/:groupId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const settings = await sm.getGroupSettings(req.params.groupId)
        if (settings) {
            // 提取 settings.enabled 到顶层
            settings.enabled = settings.settings?.enabled ?? true
            settings.triggerMode = settings.settings?.triggerMode || 'default'
            settings.groupName = settings.settings?.groupName || settings.groupName
        }
        res.json(ChaiteResponse.ok(settings))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.put('/group/:groupId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const { enabled, groupName, triggerMode, usageLimit, independentChannels, ...otherData } = req.body

        /* 拉平 usageLimit 嵌套对象为平铺键，与 groupAdminRoutes 存储格式一致 */
        const flatUsageLimit = usageLimit
            ? {
                  dailyGroupLimit: usageLimit.dailyGroupLimit,
                  dailyUserLimit: usageLimit.dailyUserLimit,
                  usageLimitMessage: usageLimit.limitMessage
              }
            : {}

        const dataToSave = {
            ...otherData,
            ...flatUsageLimit,
            enabled,
            groupName,
            triggerMode,
            /* independentChannels 序列化为 JSON 字符串，与 setGroupChannelConfig 格式一致 */
            ...(independentChannels !== undefined
                ? {
                      independentChannels: Array.isArray(independentChannels)
                          ? JSON.stringify(independentChannels)
                          : independentChannels
                  }
                : {})
        }
        await sm.setGroupSettings(req.params.groupId, dataToSave)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.delete('/group/:groupId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.deleteGroupSettings(req.params.groupId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 群用户组合作用域 ====================
router.get('/group-users', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const groupUsers = await sm.listAllGroupUserSettings()
        res.json(ChaiteResponse.ok(groupUsers))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/group/:groupId/users', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const users = await sm.listGroupUserSettings(req.params.groupId)
        res.json(ChaiteResponse.ok(users))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/group/:groupId/user/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const settings = await sm.getGroupUserSettings(req.params.groupId, req.params.userId)
        res.json(ChaiteResponse.ok(settings))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.put('/group/:groupId/user/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.setGroupUserSettings(req.params.groupId, req.params.userId, req.body)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.delete('/group/:groupId/user/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.deleteGroupUserSettings(req.params.groupId, req.params.userId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 群组知识库与继承 ====================
router.get('/group/:groupId/knowledge', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const settings = await sm.getGroupSettings(req.params.groupId)
        res.json(
            ChaiteResponse.ok({
                knowledgeIds: settings?.knowledgeIds || [],
                inheritFrom: settings?.inheritFrom || []
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.put('/group/:groupId/knowledge', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const { knowledgeIds } = req.body
        await sm.setGroupKnowledge(req.params.groupId, knowledgeIds || [])
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.post('/group/:groupId/knowledge/:knowledgeId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.addGroupKnowledge(req.params.groupId, req.params.knowledgeId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.delete('/group/:groupId/knowledge/:knowledgeId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        await sm.removeGroupKnowledge(req.params.groupId, req.params.knowledgeId)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.put('/group/:groupId/inheritance', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const { inheritFrom } = req.body
        await sm.setGroupInheritance(req.params.groupId, inheritFrom || [])
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/group/:groupId/effective', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const effectiveSettings = await sm.getEffectiveGroupSettings(req.params.groupId)
        res.json(ChaiteResponse.ok(effectiveSettings))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.post('/group/:groupId/inheritance', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const { source } = req.body
        await sm.addGroupInheritance(req.params.groupId, source)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.delete('/group/:groupId/inheritance', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const { source } = req.body
        await sm.removeGroupInheritance(req.params.groupId, source)
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/group/:groupId/resolved', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const resolved = await sm.getResolvedGroupSettings(req.params.groupId)
        res.json(ChaiteResponse.ok(resolved))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/group/:groupId/bym-config', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const { userId } = req.query
        const config = await sm.getGroupBymConfig(req.params.groupId, userId)
        res.json(ChaiteResponse.ok(config))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

router.get('/effective/:userId', async (req, res) => {
    try {
        const sm = await ensureScopeManager()
        const effective = await sm.getEffectiveUserSettings(req.params.userId)
        res.json(ChaiteResponse.ok(effective))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
