/**
 * 遥测服务
 */

import { chatLogger } from '../../core/utils/logger.js'
import { v4 as uuidv4 } from 'uuid'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = chatLogger
const DEFAULT_TELEMETRY_SERVER = 'https://plugin.openel.top'

class TelemetryService {
    constructor() {
        this.instanceId = null
        this.instanceFile = path.join(__dirname, '../../../data/instance.json')
        this.enabled = true
        this.serverUrl = DEFAULT_TELEMETRY_SERVER
        this.reportInterval = 60 * 60 * 1000 // 1小时上报一次使用量
        this.usageBuffer = {
            modelUsage: {},
            totalCalls: 0,
            totalTokens: 0,
            successCount: 0,
            failCount: 0,
            totalDuration: 0,
            lastReportTime: Date.now()
        }
        this.intervalHandle = null
        this.globalStartups = 0
        this.announcements = []
    }

    /**
     * 初始化遥测服务
     */
    async init(options = {}) {
        const {
            pluginName = 'ChatAI',
            version = '1.0.0',
            branch = null,
            commit = null,
            serverUrl = null,
            enabled = true
        } = options

        this.pluginName = pluginName
        this.version = version
        this.branch = branch
        this.commit = commit
        this.enabled = enabled

        if (serverUrl) {
            this.serverUrl = serverUrl
        }
        this.loadInstanceId()
        const reportResult = await this.reportVersion()
        this.startPeriodicReport()

        return reportResult
    }

    /**
     * 加载或生成实例ID
     */
    loadInstanceId() {
        try {
            if (fs.existsSync(this.instanceFile)) {
                const data = JSON.parse(fs.readFileSync(this.instanceFile, 'utf8'))
                this.instanceId = data.instanceId
            }
        } catch (err) {
            logger.debug('[Telemetry] 加载实例ID失败:', err.message)
        }

        if (!this.instanceId) {
            this.instanceId = uuidv4()
            this.saveInstanceId()
        }
    }

    /**
     * 保存实例ID
     */
    saveInstanceId() {
        try {
            const dir = path.dirname(this.instanceFile)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }
            fs.writeFileSync(
                this.instanceFile,
                JSON.stringify(
                    {
                        instanceId: this.instanceId,
                        createdAt: Date.now()
                    },
                    null,
                    2
                )
            )
        } catch (err) {
            logger.debug('[Telemetry] 保存实例ID失败:', err.message)
        }
    }

    /**
     * 上报版本信息
     */
    async reportVersion() {
        if (!this.enabled) return { success: false, disabled: true }

        const report = {
            pluginName: this.pluginName,
            version: this.version,
            branch: this.branch,
            commit: this.commit,
            nodeVersion: process.version,
            platform: os.platform(),
            arch: os.arch(),
            instanceId: this.instanceId,
            timestamp: Date.now()
        }

        try {
            const response = await this.sendRequest('/api/v1/report', report)

            if (response.success) {
                this.globalStartups = response.globalStartups || 0
                this.announcements = response.announcements || []
                return {
                    success: true,
                    globalStartups: this.globalStartups,
                    uniqueInstances: response.uniqueInstances || 0,
                    announcements: this.announcements
                }
            }

            return { success: false, error: 'Server returned error' }
        } catch (err) {
            logger.debug('[Telemetry] 版本上报失败:', err.message)
            return { success: false, error: err.message }
        }
    }

    /**
     * 记录模型使用（不含敏感信息）
     * @param {Object} usage - 使用记录
     */
    recordUsage(usage) {
        if (!this.enabled) return

        const { model, inputTokens = 0, outputTokens = 0, success = true, duration = 0 } = usage

        // 更新模型使用统计
        if (!this.usageBuffer.modelUsage[model]) {
            this.usageBuffer.modelUsage[model] = {
                calls: 0,
                inputTokens: 0,
                outputTokens: 0,
                successCount: 0,
                failCount: 0,
                totalDuration: 0
            }
        }

        const modelStats = this.usageBuffer.modelUsage[model]
        modelStats.calls++
        modelStats.inputTokens += inputTokens
        modelStats.outputTokens += outputTokens
        if (success) {
            modelStats.successCount++
        } else {
            modelStats.failCount++
        }
        modelStats.totalDuration += duration

        // 更新总计
        this.usageBuffer.totalCalls++
        this.usageBuffer.totalTokens += inputTokens + outputTokens
        if (success) {
            this.usageBuffer.successCount++
        } else {
            this.usageBuffer.failCount++
        }
        this.usageBuffer.totalDuration += duration
    }

    /**
     * 上报使用量统计
     */
    async reportUsage() {
        if (!this.enabled) return { success: false, disabled: true }

        const now = Date.now()
        const totalCalls = this.usageBuffer.totalCalls
        if (totalCalls === 0) {
            return { success: true, skipped: true }
        }
        const modelUsage = {}
        for (const [model, stats] of Object.entries(this.usageBuffer.modelUsage)) {
            modelUsage[model] = {
                calls: stats.calls,
                inputTokens: stats.inputTokens,
                outputTokens: stats.outputTokens,
                successCount: stats.successCount,
                failCount: stats.failCount,
                avgDuration: stats.calls > 0 ? Math.round(stats.totalDuration / stats.calls) : 0
            }
        }

        const report = {
            instanceId: this.instanceId,
            version: this.version,
            period: 'hourly',
            startTime: this.usageBuffer.lastReportTime,
            endTime: now,
            modelUsage,
            totalCalls,
            totalTokens: this.usageBuffer.totalTokens,
            successRate: totalCalls > 0 ? this.usageBuffer.successCount / totalCalls : 0,
            avgDuration: totalCalls > 0 ? Math.round(this.usageBuffer.totalDuration / totalCalls) : 0
        }

        try {
            const response = await this.sendRequest('/api/v1/usage', report)

            if (response.success) {
                // 重置缓冲区
                this.resetUsageBuffer()
                logger.debug(`[Telemetry] 使用量上报成功: ${totalCalls} 次调用`)
                return { success: true }
            }

            return { success: false, error: 'Server returned error' }
        } catch (err) {
            logger.debug('[Telemetry] 使用量上报失败:', err.message)
            return { success: false, error: err.message }
        }
    }

    /**
     * 重置使用量缓冲区
     */
    resetUsageBuffer() {
        this.usageBuffer = {
            modelUsage: {},
            totalCalls: 0,
            totalTokens: 0,
            successCount: 0,
            failCount: 0,
            totalDuration: 0,
            lastReportTime: Date.now()
        }
    }

    /**
     * 启动定时上报
     */
    startPeriodicReport() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle)
        }

        this.intervalHandle = setInterval(async () => {
            await this.reportUsage()
        }, this.reportInterval)

        // 确保进程退出时上报
        process.on('beforeExit', async () => {
            await this.reportUsage()
        })
    }

    /**
     * 停止定时上报
     */
    stopPeriodicReport() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle)
            this.intervalHandle = null
        }
    }

    /**
     * 获取全网启动次数
     */
    getGlobalStartups() {
        return this.globalStartups
    }

    /**
     * 获取公告列表
     */
    getAnnouncements() {
        return this.announcements
    }

    /**
     * 获取实例ID
     */
    getInstanceId() {
        return this.instanceId
    }

    /**
     * 发送HTTP请求
     */
    async sendRequest(endpoint, data) {
        const url = `${this.serverUrl}${endpoint}`

        try {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 10000)

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': `ChatAI/${this.version}`
                },
                body: JSON.stringify(data),
                signal: controller.signal
            })

            clearTimeout(timeout)

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            return await response.json()
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('Request timeout')
            }
            throw err
        }
    }

    /**
     * 获取遥测统计摘要
     */
    getLocalStats() {
        const totalCalls = this.usageBuffer.totalCalls
        return {
            instanceId: this.instanceId?.substring(0, 8) + '...',
            globalStartups: this.globalStartups,
            currentSession: {
                totalCalls,
                totalTokens: this.usageBuffer.totalTokens,
                successRate: totalCalls > 0 ? Math.round((this.usageBuffer.successCount / totalCalls) * 100) : 0,
                models: Object.keys(this.usageBuffer.modelUsage).length
            },
            enabled: this.enabled
        }
    }
    setServerUrl(url) {
        this.serverUrl = url
    }

    /**
     * 启用/禁用遥测
     */
    setEnabled(enabled) {
        this.enabled = enabled
        if (!enabled) {
            this.stopPeriodicReport()
        } else if (!this.intervalHandle) {
            this.startPeriodicReport()
        }
    }
}

export const telemetryService = new TelemetryService()
export default telemetryService
