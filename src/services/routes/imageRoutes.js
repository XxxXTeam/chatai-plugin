/**
 * 图像生成路由模块
 */
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import config from '../../../config/config.js'
import { ChaiteResponse } from './shared.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PRESET_CACHE_DIR = path.join(__dirname, '../../../data/presets')

// 确保缓存目录存在
if (!fs.existsSync(PRESET_CACHE_DIR)) {
    fs.mkdirSync(PRESET_CACHE_DIR, { recursive: true })
}

// 从URL获取远程预设
async function fetchRemotePresets(url) {
    try {
        const fetch = (await import('node-fetch')).default
        const response = await fetch(url, { timeout: 10000 })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json()
    } catch (error) {
        console.error(`[ImageGen] 获取远程预设失败: ${url}`, error.message)
        return null
    }
}

const urlToFilename = url => url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)

// 获取所有预设（包括远程缓存的）
async function getAllPresets() {
    const builtinPresets = config.get('features.imageGen.builtinPresets') || []
    const customPresets = config.get('features.imageGen.customPresets') || []
    const sources = config.get('features.imageGen.presetSources') || []

    const remotePresets = {}
    for (const source of sources) {
        if (!source.enabled) continue
        const cacheFile = path.join(PRESET_CACHE_DIR, `${urlToFilename(source.url)}.json`)
        if (fs.existsSync(cacheFile)) {
            try {
                remotePresets[source.name] = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
            } catch (e) {
                console.error(`[ImageGen] 读取缓存失败: ${cacheFile}`)
            }
        }
    }

    return { builtinPresets, customPresets, remotePresets, sources }
}

const router = express.Router()

router.get('/config', (req, res) => {
    try {
        const imageGenConfig = config.get('features.imageGen') || {}
        res.json(ChaiteResponse.ok(imageGenConfig))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /config - 更新图像生成配置
router.put('/config', async (req, res) => {
    try {
        const current = config.get('features.imageGen') || {}
        config.set('features.imageGen', { ...current, ...req.body })
        res.json(ChaiteResponse.ok({ success: true }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /presets - 获取图像生成预设（包括远程预设）
router.get('/presets', async (req, res) => {
    try {
        const { builtinPresets, customPresets, remotePresets, sources } = await getAllPresets()

        // 合并所有预设，并设置source字段
        const allPresets = [
            ...builtinPresets.map(p => ({ ...p, source: 'builtin' })),
            ...customPresets.map(p => ({ ...p, source: 'custom' }))
        ]
        for (const [sourceName, presets] of Object.entries(remotePresets)) {
            if (Array.isArray(presets)) {
                allPresets.push(...presets.map(p => ({ ...p, source: sourceName })))
            }
        }

        res.json(
            ChaiteResponse.ok({
                presets: allPresets,
                remotePresets,
                sources,
                stats: {
                    builtin: builtinPresets.length,
                    custom: customPresets.length,
                    remote: Object.values(remotePresets).reduce(
                        (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
                        0
                    )
                }
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /presets/builtin - 获取内置预设
router.get('/presets/builtin', async (req, res) => {
    try {
        const presets = config.get('features.imageGen.builtinPresets') || []
        res.json(ChaiteResponse.ok(presets))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// GET /presets/custom - 获取自定义预设
router.get('/presets/custom', async (req, res) => {
    try {
        const presets = config.get('features.imageGen.customPresets') || []
        res.json(ChaiteResponse.ok(presets))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /custom-presets - 添加自定义预设
router.post('/custom-presets', async (req, res) => {
    try {
        const { keywords, prompt, needImage = true, splitGrid } = req.body
        if (!keywords || !prompt) {
            return res.status(400).json(ChaiteResponse.fail(null, 'keywords and prompt are required'))
        }

        const keywordArr = Array.isArray(keywords) ? keywords : [keywords]
        const presets = config.get('features.imageGen.customPresets') || []
        const newPreset = { keywords: keywordArr, prompt, needImage }
        if (splitGrid && splitGrid.cols && splitGrid.rows) {
            newPreset.splitGrid = { cols: splitGrid.cols, rows: splitGrid.rows }
        }
        presets.push(newPreset)
        config.set('features.imageGen.customPresets', presets)

        res.status(201).json(ChaiteResponse.ok({ message: '预设已添加', presets }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /custom-presets/:index - 更新自定义预设
router.put('/custom-presets/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index)
        const presets = config.get('features.imageGen.customPresets') || []

        if (index < 0 || index >= presets.length) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
        }

        const { keywords, prompt, needImage, splitGrid } = req.body
        if (keywords) presets[index].keywords = Array.isArray(keywords) ? keywords : [keywords]
        if (prompt !== undefined) presets[index].prompt = prompt
        if (needImage !== undefined) presets[index].needImage = needImage
        if (splitGrid !== undefined) presets[index].splitGrid = splitGrid

        config.set('features.imageGen.customPresets', presets)
        res.json(ChaiteResponse.ok({ message: '预设已更新', presets }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /custom-presets/:index - 删除自定义预设
router.delete('/custom-presets/:index', async (req, res) => {
    try {
        const index = parseInt(req.params.index)
        const presets = config.get('features.imageGen.customPresets') || []

        if (index < 0 || index >= presets.length) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
        }

        presets.splice(index, 1)
        config.set('features.imageGen.customPresets', presets)

        res.json(ChaiteResponse.ok({ message: '预设已删除', presets }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 内置预设管理 ====================
// PUT /builtin-presets/:uid - 更新内置预设
router.put('/builtin-presets/:uid', async (req, res) => {
    try {
        const { uid } = req.params
        console.log(`[ImageGen] 更新内置预设: uid=${uid}`)
        const presets = config.get('features.imageGen.builtinPresets') || []
        const index = presets.findIndex(p => p.uid === uid)

        if (index === -1) {
            return res.status(404).json(ChaiteResponse.fail(null, `预设不存在`))
        }

        const { keywords, prompt, needImage, splitGrid } = req.body
        if (keywords) presets[index].keywords = Array.isArray(keywords) ? keywords : [keywords]
        if (prompt !== undefined) presets[index].prompt = prompt
        if (needImage !== undefined) presets[index].needImage = needImage
        if (splitGrid !== undefined) presets[index].splitGrid = splitGrid

        config.set('features.imageGen.builtinPresets', presets)
        res.json(ChaiteResponse.ok({ message: '预设已更新' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /builtin-presets/:uid - 删除内置预设
router.delete('/builtin-presets/:uid', async (req, res) => {
    try {
        const { uid } = req.params
        const presets = config.get('features.imageGen.builtinPresets') || []
        const index = presets.findIndex(p => p.uid === uid)

        if (index === -1) {
            return res.status(404).json(ChaiteResponse.fail(null, 'Preset not found'))
        }

        presets.splice(index, 1)
        config.set('features.imageGen.builtinPresets', presets)
        res.json(ChaiteResponse.ok({ message: '预设已删除' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 远程预设管理 ====================
// 根据 source name 查找对应的缓存文件
function findCacheFileBySourceName(sourceName) {
    const sources = config.get('features.imageGen.presetSources') || []
    const source = sources.find(s => s.name === sourceName)
    if (!source || !source.url) return null
    return path.join(PRESET_CACHE_DIR, `${urlToFilename(source.url)}.json`)
}

// PUT /remote-presets/:source/:uid - 更新远程预设（保存到本地覆盖）
router.put('/remote-presets/:source/:uid', async (req, res) => {
    try {
        const { source, uid } = req.params
        const decodedSource = decodeURIComponent(source)
        const cacheFile = findCacheFileBySourceName(decodedSource)

        console.log(`[ImageGen] 更新远程预设: source=${decodedSource}, uid=${uid}, file=${cacheFile}`)

        if (!cacheFile || !fs.existsSync(cacheFile)) {
            return res.status(404).json(ChaiteResponse.fail(null, `来源 ${decodedSource} 的缓存文件不存在`))
        }

        const presets = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
        if (!Array.isArray(presets)) {
            return res.status(500).json(ChaiteResponse.fail(null, '预设格式错误'))
        }

        const index = presets.findIndex(p => p.uid === uid)
        if (index === -1) {
            return res.status(404).json(ChaiteResponse.fail(null, `预设 ${uid} 不存在`))
        }

        const { keywords, prompt, needImage, splitGrid } = req.body
        if (keywords) presets[index].keywords = Array.isArray(keywords) ? keywords : [keywords]
        if (prompt !== undefined) presets[index].prompt = prompt
        if (needImage !== undefined) presets[index].needImage = needImage
        if (splitGrid !== undefined) presets[index].splitGrid = splitGrid

        fs.writeFileSync(cacheFile, JSON.stringify(presets, null, 2))
        res.json(ChaiteResponse.ok({ message: '预设已更新' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /remote-presets/:source/:uid - 删除远程预设（从本地缓存删除）
router.delete('/remote-presets/:source/:uid', async (req, res) => {
    try {
        const { source, uid } = req.params
        const decodedSource = decodeURIComponent(source)
        const cacheFile = findCacheFileBySourceName(decodedSource)

        if (!cacheFile || !fs.existsSync(cacheFile)) {
            return res.status(404).json(ChaiteResponse.fail(null, `来源 ${decodedSource} 的缓存文件不存在`))
        }

        const presets = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
        if (!Array.isArray(presets)) {
            return res.status(500).json(ChaiteResponse.fail(null, '预设格式错误'))
        }

        const index = presets.findIndex(p => p.uid === uid)
        if (index === -1) {
            return res.status(404).json(ChaiteResponse.fail(null, `预设 ${uid} 不存在`))
        }

        presets.splice(index, 1)
        fs.writeFileSync(cacheFile, JSON.stringify(presets, null, 2))
        res.json(ChaiteResponse.ok({ message: '预设已删除' }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /generate - 生成图像
router.post('/generate', async (req, res) => {
    try {
        const { prompt, options } = req.body
        if (!prompt) return res.status(400).json(ChaiteResponse.fail(null, 'prompt is required'))

        // 图像生成需要通过渠道API实现
        res.status(501).json(ChaiteResponse.fail(null, '图像生成功能需要配置渠道API'))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /presets/reload - 热重载预设（从缓存重新读取）
router.post('/presets/reload', async (req, res) => {
    try {
        const { builtinPresets, customPresets, remotePresets } = await getAllPresets()
        res.json(
            ChaiteResponse.ok({
                message: '预设已重载',
                stats: {
                    builtin: builtinPresets.length,
                    custom: customPresets.length,
                    remote: Object.values(remotePresets).reduce(
                        (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
                        0
                    )
                }
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /presets/update - 从远程更新预设
router.post('/presets/update', async (req, res) => {
    try {
        const { sourceName } = req.body || {}
        const sources = config.get('features.imageGen.presetSources') || []
        const results = []

        const sourcesToUpdate = sourceName
            ? sources.filter(s => s.name === sourceName && s.enabled)
            : sources.filter(s => s.enabled)

        for (const source of sourcesToUpdate) {
            const presets = await fetchRemotePresets(source.url)
            if (presets) {
                // 使用 urlToFilename 与读取时保持一致
                const cacheFile = path.join(PRESET_CACHE_DIR, `${urlToFilename(source.url)}.json`)
                fs.writeFileSync(cacheFile, JSON.stringify(presets, null, 2))
                results.push({ name: source.name, success: true, count: Array.isArray(presets) ? presets.length : 0 })
            } else {
                results.push({ name: source.name, success: false, error: '获取失败' })
            }
        }

        const { builtinPresets, customPresets, remotePresets } = await getAllPresets()
        res.json(
            ChaiteResponse.ok({
                message: '远程预设已更新',
                results,
                stats: {
                    builtin: builtinPresets.length,
                    custom: customPresets.length,
                    remote: Object.values(remotePresets).reduce(
                        (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
                        0
                    )
                }
            })
        )
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// ==================== 预设来源管理 ====================
// GET /sources - 获取预设来源列表
router.get('/sources', (req, res) => {
    try {
        const sources = config.get('features.imageGen.presetSources') || []
        res.json(ChaiteResponse.ok(sources))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// POST /sources - 添加预设来源
router.post('/sources', async (req, res) => {
    try {
        const { name, url, enabled = true } = req.body
        if (!name || !url) {
            return res.status(400).json(ChaiteResponse.fail(null, '缺少 name 或 url'))
        }

        const sources = config.get('features.imageGen.presetSources') || []
        if (sources.some(s => s.url === url)) {
            return res.status(400).json(ChaiteResponse.fail(null, '来源已存在'))
        }

        sources.push({ name, url, enabled })
        config.set('features.imageGen.presetSources', sources)

        // 立即尝试获取远程预设
        const presets = await fetchRemotePresets(url)
        if (presets) {
            // 使用 urlToFilename 与读取时保持一致
            const cacheFile = path.join(PRESET_CACHE_DIR, `${urlToFilename(url)}.json`)
            fs.writeFileSync(cacheFile, JSON.stringify(presets, null, 2))
        }

        res.json(ChaiteResponse.ok({ message: '来源已添加', sources }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// PUT /sources/:index - 更新预设来源
router.put('/sources/:index', (req, res) => {
    try {
        const index = parseInt(req.params.index)
        const sources = config.get('features.imageGen.presetSources') || []

        if (index < 0 || index >= sources.length) {
            return res.status(404).json(ChaiteResponse.fail(null, '来源不存在'))
        }

        const { name, url, enabled } = req.body
        if (name !== undefined) sources[index].name = name
        if (url !== undefined) sources[index].url = url
        if (enabled !== undefined) sources[index].enabled = enabled

        config.set('features.imageGen.presetSources', sources)
        res.json(ChaiteResponse.ok({ message: '来源已更新', sources }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

// DELETE /sources/:index - 删除预设来源
router.delete('/sources/:index', (req, res) => {
    try {
        const index = parseInt(req.params.index)
        const sources = config.get('features.imageGen.presetSources') || []

        if (index < 0 || index >= sources.length) {
            return res.status(404).json(ChaiteResponse.fail(null, '来源不存在'))
        }

        // 删除缓存文件
        const source = sources[index]
        const cacheFile = path.join(PRESET_CACHE_DIR, `${source.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`)
        if (fs.existsSync(cacheFile)) {
            fs.unlinkSync(cacheFile)
        }

        sources.splice(index, 1)
        config.set('features.imageGen.presetSources', sources)

        res.json(ChaiteResponse.ok({ message: '来源已删除', sources }))
    } catch (error) {
        res.status(500).json(ChaiteResponse.fail(null, error.message))
    }
})

export default router

/* ==================== 公开图片访问路由（无需认证） ==================== */

const IMAGE_DIR = path.join(__dirname, '../../../data/images')
const IMAGE_TOKEN_SECRET = 'chatai-image-view-2026'

/**
 * 生成图片访问 Token（HMAC 签名，防止路径遍历）
 * @param {string} imageId - 图片唯一标识
 * @param {number} [expireMs=86400000] - 有效期（毫秒），默认24小时
 * @returns {{ token: string, expires: number }}
 */
export function generateImageToken(imageId, expireMs = 86400000) {
    const expires = Date.now() + expireMs
    const payload = `${imageId}|${expires}`
    const hmac = crypto.createHmac('sha256', IMAGE_TOKEN_SECRET).update(payload).digest('hex').substring(0, 16)
    return { token: `${hmac}.${expires}`, expires }
}

/**
 * 验证图片访问 Token
 * @param {string} imageId - 图片唯一标识
 * @param {string} token - 访问令牌
 * @returns {boolean}
 */
function verifyImageToken(imageId, token) {
    if (!token || !imageId) return false
    const parts = token.split('.')
    if (parts.length !== 2) return false
    const [hmacPart, expiresPart] = parts
    const expires = parseInt(expiresPart)
    if (isNaN(expires) || Date.now() > expires) return false
    const payload = `${imageId}|${expires}`
    const expected = crypto.createHmac('sha256', IMAGE_TOKEN_SECRET).update(payload).digest('hex').substring(0, 16)
    return hmacPart === expected
}

/**
 * 根据图片ID查找实际文件路径
 * @param {string} imageId - 图片ID
 * @returns {string|null}
 */
function findImageFile(imageId) {
    /* 安全检查：只允许十六进制字符的ID */
    if (!/^[a-f0-9]+$/i.test(imageId)) return null
    if (!fs.existsSync(IMAGE_DIR)) return null

    const files = fs.readdirSync(IMAGE_DIR)
    const match = files.find(f => f.startsWith(imageId) && !f.includes('_thumb'))
    if (!match) return null
    return path.join(IMAGE_DIR, match)
}

/**
 * 构建完整的图片访问URL
 * @param {string} imageId - 图片ID
 * @param {number} [expireMs] - 有效期
 * @returns {string|null}
 */
export function buildImageViewUrl(imageId, expireMs) {
    const { token } = generateImageToken(imageId, expireMs)
    const baseUrl = getImageBaseUrl()
    if (!baseUrl) return null
    return `${baseUrl}/api/images/view/${imageId}?token=${token}`
}

/**
 * 获取图片访问的基础URL
 * @returns {string}
 */
export function getImageBaseUrl() {
    /* 优先使用 imageGen 配置的 imageBaseUrl */
    const imageBaseUrl = config.get('features.imageGen.imageBaseUrl')
    if (imageBaseUrl) return imageBaseUrl.replace(/\/$/, '')

    /* 其次使用 web.publicUrl */
    const publicUrl = config.get('web.publicUrl')
    if (publicUrl) return `${publicUrl.replace(/\/$/, '')}/chatai`

    /* 最后尝试从 WebServer 获取本地地址 */
    try {
        const port = config.get('web.port') || 3000
        return `http://127.0.0.1:${port}/chatai`
    } catch {
        return null
    }
}

/**
 * 公开图片访问路由（无需认证）
 */
export const publicImageRouter = express.Router()

/**
 * @route GET /api/images/view/:id
 * @description 通过签名 Token 公开访问生成的图片
 * @query token - 图片访问令牌
 */
publicImageRouter.get('/view/:id', (req, res) => {
    try {
        const { id } = req.params
        const { token } = req.query

        if (!verifyImageToken(id, token)) {
            return res.status(403).json({ error: '链接无效或已过期' })
        }

        const filepath = findImageFile(id)
        if (!filepath) {
            return res.status(404).json({ error: '图片不存在或已过期' })
        }

        /* 设置缓存头和内容类型 */
        const ext = path.extname(filepath).toLowerCase()
        const mimeMap = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }
        res.setHeader('Content-Type', mimeMap[ext] || 'image/jpeg')
        res.setHeader('Cache-Control', 'public, max-age=3600')
        res.setHeader('Content-Disposition', `inline; filename="image_${id.substring(0, 8)}${ext}"`)

        const stream = fs.createReadStream(filepath)
        stream.pipe(res)
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
})
