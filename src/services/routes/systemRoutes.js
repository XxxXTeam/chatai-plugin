/**
 * 系统路由模块 - 健康检查、指标、系统信息
 */
import express from 'express'
import { ChaiteResponse } from './shared.js'

const router = express.Router()

// GET /health - 健康检查（公开）
router.get('/health', (req, res) => {
    const health = {
        status: 'healthy',
        timestamp: Date.now(),
        uptime: process.uptime(),
        memoryUsage: {
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
        }
    }
    res.json(health)
})

// GET /version - 获取版本信息
router.get('/version', async (req, res) => {
    try {
        const { execSync } = await import('node:child_process')
        const { fileURLToPath } = await import('node:url')
        const path = await import('node:path')
        
        const __filename = fileURLToPath(import.meta.url)
        const pluginPath = path.resolve(path.dirname(__filename), '../../..')
        
        // 获取所有远程仓库信息
        let remotes = []
        try {
            const remotesOutput = execSync(`git -C "${pluginPath}" remote -v`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
            for (const line of remotesOutput.split('\n')) {
                const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/)
                if (match) {
                    remotes.push({ name: match[1], url: match[2] })
                }
            }
        } catch {}
        
        // 查找 chatgpt-plugin (内测) 和 chatai-plugin (公开) 的远程
        const betaRemote = remotes.find(r => r.url.includes('chatgpt-plugin'))
        const publicRemote = remotes.find(r => r.url.includes('chatai-plugin'))
        
        // 获取提交信息
        let commitId = ''
        let branch = ''
        let commitTime = ''
        
        try {
            commitId = execSync(`git -C "${pluginPath}" rev-parse --short HEAD`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
        } catch {}
        try {
            branch = execSync(`git -C "${pluginPath}" rev-parse --abbrev-ref HEAD`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
        } catch {}
        try {
            commitTime = execSync(`git -C "${pluginPath}" log -1 --format="%ci"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
        } catch {}
        
        // 判断版本类型
        let type = 'unknown'
        let typeName = '本地版'
        let repoName = '本地仓库'
        let remoteUrl = ''
        
        // 检查当前分支的上游追踪
        let upstream = ''
        try {
            upstream = execSync(`git -C "${pluginPath}" rev-parse --abbrev-ref @{upstream}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
        } catch {}
        
        // 根据上游追踪判断版本类型
        if (upstream) {
            if (upstream.startsWith('gpt/') || upstream.includes('chatgpt')) {
                type = 'beta'
                typeName = '内测版'
                repoName = 'chatgpt-plugin'
                remoteUrl = betaRemote?.url || ''
            } else if (upstream.startsWith('chatai/') || upstream.includes('chatai')) {
                type = 'public'
                typeName = '公开版'
                repoName = 'chatai-plugin'
                remoteUrl = publicRemote?.url || ''
            }
        }
        
        // 如果没有上游追踪，根据分支名和可用远程判断
        if (type === 'unknown') {
            if (/^(v3|dev|beta|test|alpha|canary|next)$/i.test(branch) && betaRemote) {
                type = 'beta'
                typeName = '内测版'
                repoName = 'chatgpt-plugin'
                remoteUrl = betaRemote.url
            } else if (/^(main|master|stable|release)$/i.test(branch) && publicRemote) {
                type = 'public'
                typeName = '公开版'
                repoName = 'chatai-plugin'
                remoteUrl = publicRemote.url
            } else if (betaRemote && !publicRemote) {
                type = 'beta'
                typeName = '内测版'
                repoName = 'chatgpt-plugin'
                remoteUrl = betaRemote.url
            } else if (publicRemote && !betaRemote) {
                type = 'public'
                typeName = '公开版'
                repoName = 'chatai-plugin'
                remoteUrl = publicRemote.url
            } else if (betaRemote && publicRemote) {
                if (/^(v3|dev|beta|test|alpha)$/i.test(branch)) {
                    type = 'beta'
                    typeName = '内测版'
                    repoName = 'chatgpt-plugin'
                    remoteUrl = betaRemote.url
                } else {
                    type = 'public'
                    typeName = '公开版'
                    repoName = 'chatai-plugin'
                    remoteUrl = publicRemote.url
                }
            }
        }
        
        res.json(ChaiteResponse.ok({
            type,
            typeName,
            repoName,
            remoteUrl,
            commitId: commitId || 'unknown',
            branch: branch || 'unknown',
            commitTime,
            shortTime: commitTime ? commitTime.split(' ').slice(0, 2).join(' ') : ''
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /metrics - 性能指标
router.get('/metrics', async (req, res) => {
    try {
        const metrics = {
            timestamp: Date.now(),
            uptime: process.uptime(),
            process: {
                pid: process.pid,
                cpu: process.cpuUsage(),
                memory: process.memoryUsage()
            },
            system: {
                platform: process.platform,
                arch: process.arch,
                nodeVersion: process.version
            }
        }
        res.json(ChaiteResponse.ok(metrics))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /system/info - 系统信息
router.get('/system/info', async (req, res) => {
    try {
        const { presetManager } = await import('../preset/PresetManager.js')
        await presetManager.init()
        res.json(ChaiteResponse.ok({
            version: '1.0.0',
            systemInfo: {
                nodejs: process.version,
                platform: process.platform,
                arch: process.arch,
                memory: {
                    used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
                    total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
                }
            },
            stats: {
                totalConversations: 0,
                activeUsers: 0,
                apiCalls: 0,
                presets: presetManager.getAll().length
            }
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats - 基础统计
router.get('/stats', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const stats = statsService.getOverview()
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/full - 完整统计
router.get('/stats/full', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const stats = statsService.getStats()
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /stats/reset - 重置统计
router.post('/stats/reset', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        statsService.reset()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/usage - API使用统计
router.get('/stats/usage', async (req, res) => {
    try {
        const { usageStats } = await import('../stats/UsageStats.js')
        const today = await usageStats.getTodayStats()
        const recent = await usageStats.getRecent(50)
        const modelRanking = await usageStats.getModelRanking(10)
        const channelRanking = await usageStats.getChannelRanking(10)
        res.json(ChaiteResponse.ok({ today, recent, modelRanking, channelRanking }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/usage/recent - 最近使用记录
router.get('/stats/usage/recent', async (req, res) => {
    try {
        const { usageStats } = await import('../stats/UsageStats.js')
        const { limit = 100, channelId, model, success, status, source } = req.query
        const filter = {}
        if (channelId) filter.channelId = channelId
        if (model) filter.model = model
        if (success !== undefined) filter.success = success === 'true'
        else if (status !== undefined) filter.success = status === 'success'
        if (source) filter.source = source
        const records = await usageStats.getRecent(parseInt(limit), filter)
        res.json(ChaiteResponse.ok(records))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/usage/channel/:id - 渠道使用统计
router.get('/stats/usage/channel/:id', async (req, res) => {
    try {
        const { usageStats } = await import('../stats/UsageStats.js')
        const stats = await usageStats.getChannelStats(req.params.id)
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /stats/usage/clear - 清除使用统计
router.post('/stats/usage/clear', async (req, res) => {
    try {
        const { usageStats } = await import('../stats/UsageStats.js')
        await usageStats.clear()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/tool-calls - 工具调用统计
router.get('/stats/tool-calls', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const summary = await statsService.getToolCallSummary()
        res.json(ChaiteResponse.ok(summary))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/tool-calls/records - 工具调用记录
router.get('/stats/tool-calls/records', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const { limit = 100, toolName, success, userId, groupId, keyword, startTime, endTime } = req.query
        const filter = {}
        if (toolName) filter.toolName = toolName
        if (success !== undefined) filter.success = success === 'true'
        if (userId) filter.userId = userId
        if (groupId) filter.groupId = groupId
        if (keyword) filter.keyword = keyword
        if (startTime) filter.startTime = parseInt(startTime)
        if (endTime) filter.endTime = parseInt(endTime)
        const records = await statsService.getToolCallRecords(filter, parseInt(limit))
        res.json(ChaiteResponse.ok(records))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/tool-calls/record/:id - 单条记录详情
router.get('/stats/tool-calls/record/:id', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const record = await statsService.getToolCallRecord(req.params.id)
        if (!record) return res.status(404).json(ChaiteResponse.fail(null, '记录不存在'))
        res.json(ChaiteResponse.ok(record))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/tool-calls/errors - 工具调用错误
router.get('/stats/tool-calls/errors', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const { limit = 50 } = req.query
        const errors = await statsService.getToolErrors(parseInt(limit))
        res.json(ChaiteResponse.ok(errors))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /stats/unified - 统一完整统计
router.get('/stats/unified', async (req, res) => {
    try {
        const { statsService } = await import('../stats/StatsService.js')
        const stats = await statsService.getUnifiedStats()
        res.json(ChaiteResponse.ok(stats))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /stats/tool-calls/clear - 清除工具调用统计
router.post('/stats/tool-calls/clear', async (req, res) => {
    try {
        const { toolCallStats } = await import('../stats/ToolCallStats.js')
        await toolCallStats.clear()
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /system/release_port - 释放端口（用于热重载）
router.delete('/system/release_port', async (req, res) => {
    try {
        const { getWebServer } = await import('../webServer.js')
        const webServer = getWebServer()
        if (webServer && webServer.server && !webServer.sharedPort) {
            webServer.server.close()
            res.json(ChaiteResponse.ok({ success: true, message: '端口已释放' }))
        } else {
            res.json(ChaiteResponse.ok({ success: false, message: '无需释放或共享端口模式' }))
        }
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /system/version - 获取版本信息
router.get('/system/version', async (req, res) => {
    try {
        const { exec } = await import('child_process')
        const { promisify } = await import('util')
        const execAsync = promisify(exec)
        const path = await import('path')
        const { fileURLToPath } = await import('url')
        
        const __dirname = path.dirname(fileURLToPath(import.meta.url))
        const pluginPath = path.resolve(__dirname, '../../..')
        
        let commitId = 'unknown'
        let commitTime = 'unknown'
        let branch = 'unknown'
        
        try {
            const { stdout: id } = await execAsync(`git -C "${pluginPath}" rev-parse --short HEAD`)
            commitId = id.trim()
            const { stdout: time } = await execAsync(`git -C "${pluginPath}" log -1 --format="%ci"`)
            commitTime = time.trim()
            const { stdout: br } = await execAsync(`git -C "${pluginPath}" rev-parse --abbrev-ref HEAD`)
            branch = br.trim()
        } catch {}
        
        res.json(ChaiteResponse.ok({
            version: '1.0.0',
            commitId,
            commitTime,
            branch,
            nodejs: process.version,
            platform: process.platform
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /system/server-mode - 获取服务器模式信息
router.get('/system/server-mode', async (req, res) => {
    try {
        const { getWebServer } = await import('../webServer.js')
        const config = (await import('../../../config/config.js')).default
        const webServer = getWebServer()
        
        const isTRSS = !!(global.Bot?.express && global.Bot?.server)
        const sharePortConfig = config.get('web.sharePort') !== false
        
        res.json(ChaiteResponse.ok({
            isTRSS,
            sharePortEnabled: sharePortConfig,
            currentMode: webServer?.sharedPort ? 'shared' : 'standalone',
            port: webServer?.port,
            canRestart: typeof Bot?.restart === 'function'
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /system/server-mode - 设置共享端口模式
router.put('/system/server-mode', async (req, res) => {
    try {
        const { sharePort } = req.body
        const config = (await import('../../../config/config.js')).default
        
        if (typeof sharePort !== 'boolean') {
            return res.status(400).json(ChaiteResponse.fail(null, 'sharePort 必须是布尔值'))
        }
        
        config.set('web.sharePort', sharePort)
        await config.save()
        
        res.json(ChaiteResponse.ok({ 
            success: true, 
            message: '配置已保存，重启后生效',
            needRestart: true
        }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /system/restart - 重启服务
router.post('/system/restart', async (req, res) => {
    try {
        const { type = 'reload' } = req.body || {}
        res.json(ChaiteResponse.ok({ success: true, message: '正在重启...' }))
        
        // 延迟执行重启
        setTimeout(async () => {
            try {
                if (type === 'full') {
                    // 完整重启Bot
                    if (typeof Bot?.restart === 'function') {
                        await Bot.restart()
                    } else {
                        process.exit(0)
                    }
                } else {
                    // 仅重载WebServer
                    const { reloadWebServer } = await import('../webServer.js')
                    await reloadWebServer()
                }
            } catch (e) {
                console.error('[System] 重启失败:', e)
            }
        }, 100)
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router
