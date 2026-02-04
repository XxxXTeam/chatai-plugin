/**
 * @fileoverview Galgame 游戏状态图片渲染器
 * @module services/galgame/GameRenderer
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGIN_ROOT = path.join(__dirname, '../../../')

let canvasModule = null
try {
    canvasModule = await import('@napi-rs/canvas')
} catch (e) {
    // Canvas not available
}

/**
 * 游戏状态渲染器
 */
class GameRenderer {
    constructor() {
        this.fontLoaded = false
        this.fontPath = path.join(PLUGIN_ROOT, 'data/font/LXGWNeoXiHeiScreen.ttf')
    }

    /**
     * 加载字体
     */
    async loadFont() {
        if (this.fontLoaded || !canvasModule) return

        try {
            if (fs.existsSync(this.fontPath)) {
                canvasModule.GlobalFonts.registerFromPath(this.fontPath, 'GameFont')
                this.fontLoaded = true
            }
        } catch (e) {
            // Font load failed
        }
    }

    /**
     * 检查是否可用
     */
    isAvailable() {
        return !!canvasModule
    }

    /**
     * 渲染游戏状态为图片
     * @param {Object} status - 游戏状态
     * @returns {Promise<Buffer|null>} PNG图片Buffer
     */
    async renderStatus(status) {
        if (!canvasModule) return null

        await this.loadFont()

        const { createCanvas } = canvasModule
        const width = 500
        const height = 600
        const canvas = createCanvas(width, height)
        const ctx = canvas.getContext('2d')

        // 背景渐变
        const gradient = ctx.createLinearGradient(0, 0, 0, height)
        gradient.addColorStop(0, '#1a1a2e')
        gradient.addColorStop(1, '#16213e')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)

        // 字体设置
        const fontFamily = this.fontLoaded ? 'GameFont' : 'sans-serif'

        let y = 40

        // 标题
        ctx.fillStyle = '#e94560'
        ctx.font = `bold 24px ${fontFamily}`
        ctx.textAlign = 'center'
        ctx.fillText('🎮 Galgame 状态', width / 2, y)
        y += 50

        // 分割线
        ctx.strokeStyle = '#e94560'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(30, y)
        ctx.lineTo(width - 30, y)
        ctx.stroke()
        y += 30

        // 角色信息
        ctx.textAlign = 'left'
        ctx.fillStyle = '#ffffff'
        ctx.font = `18px ${fontFamily}`

        const drawInfo = (label, value, emoji = '') => {
            ctx.fillStyle = '#888888'
            ctx.fillText(`${emoji} ${label}:`, 40, y)
            ctx.fillStyle = '#ffffff'
            ctx.fillText(value || '???', 160, y)
            y += 30
        }

        drawInfo('角色', status.characterName, '👤')
        drawInfo('世界观', status.world, '🌍')
        drawInfo('身份', status.identity, '📋')
        y += 10

        // 分割线
        ctx.strokeStyle = '#333366'
        ctx.beginPath()
        ctx.moveTo(30, y)
        ctx.lineTo(width - 30, y)
        ctx.stroke()
        y += 25

        // 属性条
        const drawProgressBar = (label, value, maxValue, color, emoji, levelName) => {
            ctx.fillStyle = '#888888'
            ctx.font = `16px ${fontFamily}`
            ctx.fillText(`${emoji} ${label}`, 40, y)

            // 等级名称
            ctx.fillStyle = color
            ctx.fillText(`${levelName} (${value})`, 200, y)
            y += 25

            // 进度条背景
            const barWidth = 400
            const barHeight = 16
            const barX = 40
            ctx.fillStyle = '#333366'
            ctx.beginPath()
            ctx.roundRect(barX, y, barWidth, barHeight, 8)
            ctx.fill()

            // 进度条填充
            const progress = Math.max(0, Math.min(1, (value + 100) / 250)) // -100 to 150
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.roundRect(barX, y, barWidth * progress, barHeight, 8)
            ctx.fill()
            y += 35
        }

        const affectionLevel = status.level || { name: '陌生', color: '#A0A0A0' }
        const trustLevel = status.trustLevel || { name: '观望', color: '#A0A0A0' }

        drawProgressBar(
            '好感度',
            status.affection || 0,
            150,
            affectionLevel.color || '#FF69B4',
            '💕',
            affectionLevel.name
        )
        drawProgressBar('信任度', status.trust || 0, 150, trustLevel.color || '#4169E1', '🤝', trustLevel.name)

        // 金币和物品
        y += 10
        ctx.fillStyle = '#ffd700'
        ctx.font = `bold 20px ${fontFamily}`
        ctx.fillText(`💰 金币: ${status.gold || 100}`, 40, y)
        ctx.fillStyle = '#87ceeb'
        ctx.fillText(`📦 物品: ${status.items?.length || 0}个`, 250, y)
        y += 40

        // 分割线
        ctx.strokeStyle = '#333366'
        ctx.beginPath()
        ctx.moveTo(30, y)
        ctx.lineTo(width - 30, y)
        ctx.stroke()
        y += 25

        // 已知信息（部分显示???）
        ctx.fillStyle = '#888888'
        ctx.font = `14px ${fontFamily}`
        const infoItems = [
            { label: '性格', value: status.personality },
            { label: '喜好', value: status.likes },
            { label: '厌恶', value: status.dislikes },
            { label: '秘密', value: status.secret }
        ]

        for (const item of infoItems) {
            const displayValue = item.value || '???'
            const isUnknown = displayValue === '???'
            ctx.fillStyle = isUnknown ? '#555555' : '#aaaaaa'
            const text = `${item.label}: ${displayValue.length > 25 ? displayValue.substring(0, 25) + '...' : displayValue}`
            ctx.fillText(text, 40, y)
            y += 22
        }

        // 底部信息
        y = height - 30
        ctx.fillStyle = '#555555'
        ctx.font = `12px ${fontFamily}`
        ctx.textAlign = 'center'
        ctx.fillText(`开始时间: ${new Date(status.createdAt).toLocaleDateString()}`, width / 2, y)

        return canvas.toBuffer('image/png')
    }

    /**
     * 渲染对话响应为图片
     * @param {Object} result - 对话结果
     * @returns {Promise<Buffer|null>} PNG图片Buffer
     */
    async renderResponse(result) {
        if (!canvasModule) return null

        await this.loadFont()

        const { createCanvas } = canvasModule
        const width = 500

        // 计算高度
        let estimatedHeight = 150
        if (result.scene) estimatedHeight += 40
        if (result.task) estimatedHeight += 30
        if (result.affectionChange || result.trustChange || result.goldChange) estimatedHeight += 40
        if (result.options?.length > 0) estimatedHeight += 30 + result.options.length * 35
        if (result.event) estimatedHeight += 80 + (result.eventOptions?.length || 0) * 35

        const height = Math.min(800, Math.max(200, estimatedHeight))
        const canvas = createCanvas(width, height)
        const ctx = canvas.getContext('2d')

        // 背景
        const gradient = ctx.createLinearGradient(0, 0, 0, height)
        gradient.addColorStop(0, '#0f0f23')
        gradient.addColorStop(1, '#1a1a3e')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)

        const fontFamily = this.fontLoaded ? 'GameFont' : 'sans-serif'
        let y = 30

        // 场景信息
        if (result.scene) {
            ctx.fillStyle = '#4ecdc4'
            ctx.font = `14px ${fontFamily}`
            ctx.fillText(
                `📍 ${result.scene.name}${result.scene.description ? ' - ' + result.scene.description : ''}`,
                20,
                y
            )
            y += 35
        }

        // 任务
        if (result.task) {
            ctx.fillStyle = '#95a5a6'
            ctx.font = `13px ${fontFamily}`
            ctx.fillText(`📋 ${result.task}`, 20, y)
            y += 30
        }

        // 属性变化
        const changes = []
        if (result.affectionChange) {
            const emoji = result.affectionChange > 0 ? '💕' : '💔'
            changes.push(`${emoji}好感${result.affectionChange > 0 ? '+' : ''}${result.affectionChange}`)
        }
        if (result.trustChange) {
            const emoji = result.trustChange > 0 ? '🤝' : '⚔️'
            changes.push(`${emoji}信任${result.trustChange > 0 ? '+' : ''}${result.trustChange}`)
        }
        if (result.goldChange) {
            const emoji = result.goldChange > 0 ? '💰' : '💸'
            changes.push(`${emoji}金币${result.goldChange > 0 ? '+' : ''}${result.goldChange}`)
        }

        if (changes.length > 0) {
            ctx.fillStyle = '#f39c12'
            ctx.font = `bold 14px ${fontFamily}`
            ctx.fillText(changes.join('  '), 20, y)
            y += 35
        }

        // 状态行
        const level = result.session?.level || { emoji: '🙂', name: '陌生' }
        const trustLevel = result.session?.trustLevel || { emoji: '🤔', name: '观望' }
        ctx.fillStyle = '#7f8c8d'
        ctx.font = `13px ${fontFamily}`
        ctx.fillText(
            `${level.emoji}${level.name}(${result.session?.affection || 0}) ${trustLevel.emoji}${trustLevel.name}(${result.session?.trust || 0}) 💰${result.session?.gold || 100}`,
            20,
            y
        )
        y += 30

        // 选项
        if (result.options?.length > 0) {
            ctx.fillStyle = '#e74c3c'
            ctx.font = `bold 14px ${fontFamily}`
            ctx.fillText('━━━ 请选择 ━━━', 20, y)
            y += 25

            for (let i = 0; i < Math.min(result.options.length, 4); i++) {
                ctx.fillStyle = '#ecf0f1'
                ctx.font = `14px ${fontFamily}`
                ctx.fillText(`${i + 1}. ${result.options[i].text}`, 30, y)
                y += 28
            }
        }

        // 事件
        if (result.event) {
            ctx.fillStyle = '#9b59b6'
            ctx.font = `bold 14px ${fontFamily}`
            ctx.fillText(`⚡ 触发事件: ${result.event.name}`, 20, y)
            y += 25
            ctx.fillStyle = '#bdc3c7'
            ctx.font = `13px ${fontFamily}`
            ctx.fillText(result.event.description, 30, y)
            y += 30

            if (result.eventOptions?.length > 0) {
                for (let i = 0; i < Math.min(result.eventOptions.length, 4); i++) {
                    ctx.fillStyle = '#ecf0f1'
                    ctx.font = `14px ${fontFamily}`
                    ctx.fillText(`${i + 1}. ${result.eventOptions[i].text}`, 30, y)
                    y += 28
                }
            }
        }

        return canvas.toBuffer('image/png')
    }
}

export const gameRenderer = new GameRenderer()
