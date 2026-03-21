import config from '../config/config.js'
import { segment, MessageApi } from '../src/utils/messageParser.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getBotIds } from '../src/utils/messageDedup.js'
import { getAvatarUrl, getUserInfo } from '../src/utils/platformAdapter.js'

import { ensureScopeManager } from '../src/services/scope/ScopeManager.js'

// 懒加载服务
let _statsService = null
let _imageService = null
let _imageRouteUtils = null

async function getStatsService() {
    if (!_statsService) {
        const { statsService } = await import('../src/services/stats/StatsService.js')
        _statsService = statsService
    }
    return _statsService
}

async function getImageService() {
    if (!_imageService) {
        const { imageService } = await import('../src/services/media/ImageService.js')
        _imageService = imageService
    }
    return _imageService
}

/**
 * 获取图片路由工具（懒加载）
 * @returns {Promise<{buildImageViewUrl: Function, getImageBaseUrl: Function}>}
 */
async function getImageRouteUtils() {
    if (!_imageRouteUtils) {
        const mod = await import('../src/services/routes/imageRoutes.js')
        _imageRouteUtils = {
            buildImageViewUrl: mod.buildImageViewUrl,
            getImageBaseUrl: mod.getImageBaseUrl
        }
    }
    return _imageRouteUtils
}

/* getScopeManagerLazy 已统一到 ensureScopeManager */
const getScopeManagerLazy = ensureScopeManager

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PRESET_CACHE_DIR = path.join(__dirname, '../data/presets')
class PresetManager {
    constructor() {
        this.builtinPresets = [] // 内置预设
        this.remotePresets = {} // 远程预设 { sourceName: presets[] }
        this.customPresets = [] // 自定义预设（配置文件）
        this.allPresets = [] // 合并后的所有预设
        this.presetReg = /^$/ // 预设匹配正则
        this.initialized = false
    }

    // 默认内置预设
    getDefaultBuiltinPresets() {
        return [
            {
                keywords: ['手办', '手办化', '变手办', '转手办'],
                needImage: true,
                prompt: "Please accurately transform the main subject in this photo into a realistic, masterpiece-like 1/7 scale PVC statue. Behind this statue, a packaging box should be placed: the box has a large clear front window on its front side, and is printed with subject artwork, product name, brand logo, barcode, as well as a small specifications or authenticity verification panel. A small price tag sticker must also be attached to one corner of the box. Meanwhile, a computer monitor is placed at the back, and the monitor screen needs to display the ZBrush modeling process of this statue. In front of the packaging box, this statue should be placed on a round plastic base. The statue must have 3D dimensionality and a sense of realism, and the texture of the PVC material needs to be clearly represented. The human figure's expression and movements must be exactly consistent with those in the photo."
            },
            {
                keywords: ['Q版', 'q版', '表情包', '表情', 'p表情', 'P表情', '表情切割'],
                needImage: true,
                prompt: '请以图片中的主要人物生成q版半身像表情符号包中的人物形象给我。丰富多彩的手绘风格，采用5列4行的网格布局，共20个表情，涵盖了各种常见的聊天用语。要求:1.注意正确的头饰。2.不要复制原始图像。3.所有注释都应该是手写的简体中文。4.每个表情符号行动应该是独特的。5.生成的图像需要是4K，分辨率为16:9。6.严格按照5列4行的网格排列，每个表情大小相同。',
                splitGrid: { cols: 6, rows: 4 }
            },
            {
                keywords: ['动漫化', '二次元化', '卡通化'],
                needImage: true,
                prompt: '将图片中的人物转换为高质量动漫风格，保持人物的主要特征和表情，使用精美的日系动漫画风，色彩鲜艳，线条流畅。'
            },
            {
                keywords: ['赛博朋克', '赛博'],
                needImage: true,
                prompt: '将图片转换为赛博朋克风格，添加霓虹灯效果、科幻元素、未来都市背景，保持主体人物特征，整体色调偏蓝紫色调。'
            },
            {
                keywords: ['油画', '油画风'],
                needImage: true,
                prompt: '将图片转换为古典油画风格，模仿文艺复兴时期大师的画风，注重光影效果和细节质感，保持人物特征。'
            },
            {
                keywords: ['水彩', '水彩画'],
                needImage: true,
                prompt: '将图片转换为精美的水彩画风格，色彩透明、层次丰富，有水彩特有的晕染效果和纸张质感。'
            }
        ]
    }
    getBuiltinPresets() {
        let builtinPresets = config.get('features.imageGen.builtinPresets')
        if (!builtinPresets || builtinPresets.length === 0) {
            builtinPresets = this.getDefaultBuiltinPresets().map(p => ({
                ...p,
                uid: this.generateUid()
            }))
            config.set('features.imageGen.builtinPresets', builtinPresets)
        } else {
            let needSave = false
            const defaultPresets = this.getDefaultBuiltinPresets()
            builtinPresets = builtinPresets.map(p => {
                let updated = { ...p }
                if (!p.uid) {
                    needSave = true
                    updated.uid = this.generateUid()
                }
                const matchDefault = defaultPresets.find(dp => dp.keywords.some(k => p.keywords?.includes(k)))
                if (matchDefault?.splitGrid && !p.splitGrid) {
                    updated.splitGrid = matchDefault.splitGrid
                    needSave = true
                }
                return updated
            })
            if (needSave) {
                config.set('features.imageGen.builtinPresets', builtinPresets)
            }
        }
        return builtinPresets.map(p => ({ ...p, source: 'builtin' }))
    }

    // 初始化
    async init() {
        if (this.initialized) return
        this.builtinPresets = this.getBuiltinPresets()
        await this.loadAllPresets()
        this.initialized = true
    }
    async loadAllPresets() {
        // 为自定义预设添加uid
        let customPresets = config.get('features.imageGen.customPresets') || []
        let needSave = false
        customPresets = customPresets.map(p => {
            if (!p.uid) {
                needSave = true
                return { ...p, uid: this.generateUid() }
            }
            return p
        })
        if (needSave) {
            config.set('features.imageGen.customPresets', customPresets)
        }
        this.customPresets = customPresets.map(p => ({ ...p, source: 'custom' }))
        await this.loadRemotePresetsFromCache()
        this.mergeAllPresets()
    }

    async loadRemotePresetsFromCache() {
        const sources = config.get('features.imageGen.presetSources') || []

        for (const source of sources) {
            if (!source.enabled || !source.url) continue
            const cacheFile = path.join(PRESET_CACHE_DIR, `${this.urlToFilename(source.url)}.json`)

            try {
                if (fs.existsSync(cacheFile)) {
                    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
                    if (Array.isArray(data)) {
                        // 为没有uid的预设生成uid
                        let needSave = false
                        const presetsWithUid = data.map(p => {
                            if (!p.uid) {
                                needSave = true
                                return { ...p, uid: this.generateUid() }
                            }
                            return p
                        })
                        // 如果有预设缺少uid，保存更新后的数据
                        if (needSave) {
                            fs.writeFileSync(cacheFile, JSON.stringify(presetsWithUid, null, 2), 'utf-8')
                        }
                        this.remotePresets[source.name] = presetsWithUid.map(p => ({ ...p, source: source.name }))
                    }
                }
            } catch (err) {
                logger.debug(`[ImageGen] 加载远程预设缓存失败 [${source.name}]:`, err.message)
            }
        }
    }

    generateUid() {
        return 'preset_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
    }

    // 从远程更新预设
    async updateFromRemote(sourceName = null) {
        const sources = config.get('features.imageGen.presetSources') || []
        const results = []

        if (!fs.existsSync(PRESET_CACHE_DIR)) {
            fs.mkdirSync(PRESET_CACHE_DIR, { recursive: true })
        }

        for (const source of sources) {
            if (!source.enabled || !source.url) continue
            if (sourceName && source.name !== sourceName) continue

            try {
                const response = await fetch(source.url, { signal: AbortSignal.timeout(15000) })
                if (!response.ok) throw new Error(`HTTP ${response.status}`)

                const data = await response.json()
                if (!Array.isArray(data)) throw new Error('数据格式错误')

                // 保存缓存（清理可能存在的内部字段）
                const cacheFile = path.join(PRESET_CACHE_DIR, `${this.urlToFilename(source.url)}.json`)
                const cleanData = data.map(p => {
                    const { source: _, _originalIndex: __, ...rest } = p
                    return rest
                })
                fs.writeFileSync(cacheFile, JSON.stringify(cleanData, null, 2), 'utf-8')

                this.remotePresets[source.name] = cleanData.map((p, idx) => ({
                    ...p,
                    source: source.name,
                    _originalIndex: idx
                }))
                results.push({ name: source.name, success: true, count: data.length })
            } catch (err) {
                results.push({ name: source.name, success: false, error: err.message })
            }
        }

        this.mergeAllPresets()
        return results
    }
    mergeAllPresets() {
        const usedKeywords = new Set()
        const merged = []
        // 表情相关关键词，匹配时自动添加splitGrid
        const emojiKeywords = ['q版', '表情包', '表情', 'p表情', '表情切割']
        const builtinEmojiPreset = this.builtinPresets.find(p => p.splitGrid)
        const defaultSplitGrid = builtinEmojiPreset?.splitGrid || { cols: 5, rows: 4 }

        const addPresets = presets => {
            for (const p of presets) {
                const newKeywords = p.keywords.filter(k => !usedKeywords.has(k.toLowerCase()))
                if (newKeywords.length > 0) {
                    let preset = { ...p, keywords: newKeywords }
                    if (!preset.splitGrid) {
                        const hasEmojiKeyword = p.keywords.some(k => emojiKeywords.includes(k.toLowerCase()))
                        if (hasEmojiKeyword) {
                            preset.splitGrid = defaultSplitGrid
                        }
                    }
                    merged.push(preset)
                    newKeywords.forEach(k => usedKeywords.add(k.toLowerCase()))
                }
            }
        }

        addPresets(this.customPresets)
        addPresets(this.builtinPresets)
        Object.values(this.remotePresets).forEach(addPresets)

        this.allPresets = merged
        this.presetReg = this.buildPresetReg()
    }

    // 构建正则
    buildPresetReg() {
        const keywords = this.allPresets
            .flatMap(p => p.keywords)
            .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|')
        return keywords ? new RegExp(`^#?(${keywords})$`, 'i') : /^$/
    }
    urlToFilename(url) {
        return url.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)
    }
    findPreset(msg) {
        if (!msg || typeof msg !== 'string') return null
        const pureMsg = msg.replace(/^#?/, '').toLowerCase()
        return this.allPresets.find(p => p.keywords.some(k => k.toLowerCase() === pureMsg))
    }
    getStats() {
        const remoteCount = Object.values(this.remotePresets).flat().length
        return {
            builtin: this.builtinPresets.length,
            remote: remoteCount,
            custom: this.customPresets.length,
            total: this.allPresets.length,
            sources: Object.keys(this.remotePresets).map(name => ({
                name,
                count: this.remotePresets[name].length
            }))
        }
    }
    getAllPresets() {
        return this.allPresets
    }
}
const presetMgr = new PresetManager()
export { presetMgr as imageGenPresetManager }

export class ImageGen extends plugin {
    constructor() {
        // 初始化预设管理器
        presetMgr.init().catch(err => logger.warn('[ImageGen] 预设初始化失败:', err.message))

        /* 读取自定义前缀配置，动态生成触发规则 */
        const customPrefix = config.get('features.imageGen.customPrefix') || ''
        const rules = [
            { reg: /^#?文生图\s*(.+)$/s, fnc: 'text2img' },
            { reg: /^#?图生图\s*(.*)$/s, fnc: 'img2img' },
            { reg: /^#?文生视频\s*(.+)$/s, fnc: 'text2video' },
            { reg: /^#?图生视频\s*(.*)$/s, fnc: 'img2video' },
            { reg: /^.+$/, fnc: 'presetHandler', log: false },
            { reg: /^#?(谷歌状态|画图状态|api状态)$/i, fnc: 'apiStatus' },
            { reg: /^#?(绘图帮助|画图帮助|绘图帮助)$/i, fnc: 'showHelp' },
            { reg: /^#?(更新预设|更新焚决|刷新预设|重载预设)$/i, fnc: 'updatePresets' },
            { reg: /^#?(绘图模型|画图模型|设置绘图模型|切换绘图模型)\s*(.*)$/i, fnc: 'setModel' }
        ]
        /* 自定义前缀触发：如配置了 customPrefix，添加 「前缀+描述」 触发绘图的规则 */
        if (customPrefix) {
            const escaped = customPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            rules.unshift({ reg: new RegExp(`^${escaped}\\s*(.+)$`, 's'), fnc: 'customPrefixDraw' })
        }

        super({
            name: 'AI-ImageGen',
            dsc: 'AI图片/视频生成 - 文生图/图生图/文生视频/图生视频',
            event: 'message',
            priority: 50,
            rule: rules
        })

        this.customPrefix = customPrefix
        this.timeout = config.get('features.imageGen.timeout') || 600000
        this.maxImages = config.get('features.imageGen.maxImages') || 3
    }

    /**
     * 获取全局撤回配置的延迟时间
     * @param {number} defaultDelay - 默认延迟(秒)
     * @returns {number} 撤回延迟秒数，0表示不撤回
     */
    getRecallDelay(defaultDelay = 60) {
        const autoRecall = config.get('basic.autoRecall')
        if (autoRecall?.enabled === true) {
            return autoRecall.delay || defaultDelay
        }
        return 0
    }

    /**
     * 检查绘图功能是否启用（支持群组独立配置）
     * @returns {Promise<boolean>}
     */
    async isImageGenEnabled() {
        const e = this.e
        const globalEnabled = config.get('features.imageGen.enabled') !== false

        // 检查群组独立设置
        if (e.isGroup && e.group_id) {
            try {
                const groupId = String(e.group_id)
                const scopeManager = await getScopeManagerLazy()
                const groupSettings = await scopeManager.getGroupSettings(groupId)
                const groupFeatures = groupSettings?.settings || {}

                // 如果群组有独立设置，使用群组设置
                if (groupFeatures.imageGenEnabled !== undefined) {
                    return groupFeatures.imageGenEnabled
                }
            } catch (err) {
                logger.debug('[ImageGen] 获取群组设置失败:', err.message)
            }
        }

        return globalEnabled
    }

    /**
     * 获取图像生成模型（支持群组独立配置 + 文生图/图生图独立模型）
     * 优先级：群组特定类型模型 > 群组通用绘图模型 > 全局特定类型模型 > 全局通用绘图模型
     * @param {'text2img'|'img2img'|null} genType - 生成类型，null表示不区分
     * @returns {Promise<string|null>} 最终使用的模型，null表示使用全局默认
     */
    async getImageModel(genType = null) {
        const e = this.e

        // 1. 尝试获取群组独立模型
        if (e.isGroup && e.group_id) {
            try {
                const groupId = String(e.group_id)
                const scopeManager = await getScopeManagerLazy()
                const groupSettings = await scopeManager.getGroupSettings(groupId)
                const groupFeatures = groupSettings?.settings || {}

                // 群组特定类型模型（text2imgModel / img2imgModel）
                if (genType) {
                    const groupTypeModel = groupFeatures[`${genType}Model`]
                    if (groupTypeModel && groupTypeModel.trim()) {
                        logger.info(`[ImageGen] 模型选择: 群组${genType}独立模型 → ${groupTypeModel} (群: ${groupId})`)
                        return groupTypeModel.trim()
                    }
                }

                // 群组通用绘图模型
                if (groupFeatures.imageGenModel && groupFeatures.imageGenModel.trim()) {
                    logger.info(
                        `[ImageGen] 模型选择: 群组通用绘图模型 → ${groupFeatures.imageGenModel} (群: ${groupId})`
                    )
                    return groupFeatures.imageGenModel.trim()
                }
            } catch (err) {
                logger.debug('[ImageGen] 获取群组模型设置失败:', err.message)
            }
        }

        // 2. 尝试获取全局特定类型模型
        if (genType) {
            const globalTypeModel = config.get(`features.imageGen.${genType}Model`)
            if (globalTypeModel && globalTypeModel.trim()) {
                logger.info(`[ImageGen] 模型选择: 全局${genType}独立模型 → ${globalTypeModel}`)
                return globalTypeModel.trim()
            }
        }

        // 3. 返回null，由调用方使用API自定义模型或全局默认模型
        logger.debug(`[ImageGen] 模型选择: 无覆盖模型(genType=${genType})，将使用API自定义模型或全局默认`)
        return null
    }

    /**
     * 兼容旧接口：获取群组的图像生成模型
     * @returns {Promise<string|null>}
     */
    async getGroupImageModel() {
        return this.getImageModel(null)
    }

    /**
     * 显示绘图帮助
     */
    async showHelp() {
        const e = this.e

        // 检查功能是否启用（支持群组独立配置）
        if (!(await this.isImageGenEnabled())) {
            return false
        }

        const stats = presetMgr.getStats()

        // 构建预设列表
        const presetLines = presetMgr
            .getAllPresets()
            .map((p, i) => {
                const keys = p.keywords.join(' / ')
                const sourceTag = p.source === 'builtin' ? '' : p.source === 'custom' ? ' [自定义]' : ` [云端]`
                return `${i + 1}. ${keys}${sourceTag}`
            })
            .join('\n')

        const helpLines = [
            '【AI绘图指令帮助】',
            '',
            '一、基础命令',
            '  #文生图 [描述] - 根据文字生成图片',
            '  #图生图 [描述] - 根据图片+文字重绘',
            '  #文生视频 [描述] - 根据文字生成视频',
            '  #图生视频 [描述] - 根据图片生成视频'
        ]
        /* 自定义前缀提示 */
        const cfgPrefix = config.get('features.imageGen.customPrefix')
        if (cfgPrefix) {
            helpLines.push(`  ${cfgPrefix} [描述] - 快捷绘图（有图时自动图生图）`)
        }
        helpLines.push(
            '',
            '二、使用方式',
            '  发送指令时带图片，或引用他人图片发送指令',
            '',
            '三、管理命令',
            '  #更新预设 - 从云端拉取最新预设',
            '  #重载预设 - 热重载所有预设',
            '  #画图状态 - 查看API状态',
            '  #绘图模型 - 查看/切换绘图模型'
        )
        const helpHeader = helpLines.join('\n')

        /**
         * 将预设列表分页，每页最多 pageSize 条
         * 避免单条消息过长被QQ截断
         */
        const allPresets = presetMgr.getAllPresets()
        const pageSize = 30
        const presetPages = []
        for (let i = 0; i < allPresets.length; i += pageSize) {
            const chunk = allPresets.slice(i, i + pageSize)
            const lines = chunk
                .map((p, idx) => {
                    const keys = p.keywords.join(' / ')
                    const sourceTag = p.source === 'builtin' ? '' : p.source === 'custom' ? ' [自定义]' : ` [云端]`
                    return `${i + idx + 1}. ${keys}${sourceTag}`
                })
                .join('\n')
            const pageNum = presetPages.length + 1
            const totalPages = Math.ceil(allPresets.length / pageSize)
            const header =
                totalPages > 1
                    ? `【预设模板 ${pageNum}/${totalPages}】`
                    : `【预设模板】共${stats.total}个: 内置${stats.builtin} + 云端${stats.remote} + 自定义${stats.custom}`
            presetPages.push(`${header}\n\n${lines}`)
        }

        if (presetPages.length === 0) {
            presetPages.push(`【预设模板】暂无预设`)
        }

        /* 使用合并转发发送，避免预设列表过长被截断 */
        const bot = e.bot || Bot
        const botInfo = {
            user_id: bot.uin || bot.self_id || e.self_id || 10000,
            nickname: bot.nickname || bot.info?.nickname || 'Bot'
        }

        const makeNode = text => ({
            user_id: botInfo.user_id,
            nickname: botInfo.nickname,
            message: [text]
        })

        const forwardNodes = [makeNode(helpHeader), ...presetPages.map(page => makeNode(page))]

        let sent = false

        // NapCat/OneBot: sendApi
        if (!sent && bot?.sendApi) {
            try {
                const onebotNodes = forwardNodes.map(n => ({
                    type: 'node',
                    data: {
                        user_id: String(n.user_id),
                        nickname: n.nickname,
                        content: Array.isArray(n.message)
                            ? n.message.map(m => (typeof m === 'string' ? { type: 'text', data: { text: m } } : m))
                            : [{ type: 'text', data: { text: String(n.message) } }]
                    }
                }))
                const isGroup = e.isGroup && e.group_id
                const apiName = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg'
                const params = isGroup
                    ? { group_id: parseInt(e.group_id), messages: onebotNodes }
                    : { user_id: parseInt(e.user_id), messages: onebotNodes }
                const result = await bot.sendApi(apiName, params)
                if (
                    result?.status === 'ok' ||
                    result?.retcode === 0 ||
                    result?.message_id ||
                    result?.data?.message_id
                ) {
                    sent = true
                    logger.debug('[ImageGen] 绘图帮助已通过sendApi合并转发发送')
                }
            } catch (err) {
                logger.warn('[ImageGen] sendApi合并转发失败:', err.message)
            }
        }

        // icqq: makeForwardMsg
        if (!sent && e.isGroup && e.group?.makeForwardMsg) {
            try {
                const forwardMsg = await e.group.makeForwardMsg(forwardNodes)
                if (forwardMsg) {
                    await e.group.sendMsg(forwardMsg)
                    sent = true
                    logger.debug('[ImageGen] 绘图帮助已通过group.makeForwardMsg发送')
                }
            } catch (err) {
                logger.warn('[ImageGen] group.makeForwardMsg失败:', err.message)
            }
        } else if (!sent && !e.isGroup && e.friend?.makeForwardMsg) {
            try {
                const forwardMsg = await e.friend.makeForwardMsg(forwardNodes)
                if (forwardMsg) {
                    await e.friend.sendMsg(forwardMsg)
                    sent = true
                    logger.debug('[ImageGen] 绘图帮助已通过friend.makeForwardMsg发送')
                }
            } catch (err) {
                logger.warn('[ImageGen] friend.makeForwardMsg失败:', err.message)
            }
        }

        // 回退: Bot.makeForwardMsg
        if (!sent && typeof bot?.makeForwardMsg === 'function') {
            try {
                const forwardMsg = await bot.makeForwardMsg(forwardNodes)
                if (e.group?.sendMsg) {
                    await e.group.sendMsg(forwardMsg)
                    sent = true
                } else if (e.friend?.sendMsg) {
                    await e.friend.sendMsg(forwardMsg)
                    sent = true
                }
                if (sent) logger.debug('[ImageGen] 绘图帮助已通过Bot.makeForwardMsg发送')
            } catch (err) {
                logger.warn('[ImageGen] Bot.makeForwardMsg失败:', err.message)
            }
        }

        // 最终回退：分批发送文本
        if (!sent) {
            logger.warn('[ImageGen] 所有合并转发方式均失败，回退到分批文本发送')
            await e.reply(helpHeader, true)
            for (const page of presetPages) {
                await e.reply(page, true)
                await new Promise(r => setTimeout(r, 300))
            }
        }

        return true
    }

    /**
     * 更新/重载预设（支持热重载）
     */
    async updatePresets() {
        const e = this.e
        const isReload = e.msg.includes('重载')

        if (isReload) {
            // 热重载：仅重新加载配置和缓存
            await e.reply('正在热重载预设...', true)
            await presetMgr.loadAllPresets()
            const stats = presetMgr.getStats()
            await e.reply(
                `✅ 预设重载成功！\n内置: ${stats.builtin} 条\n云端: ${stats.remote} 条\n自定义: ${stats.custom} 条\n合计: ${stats.total} 条`,
                true
            )
        } else {
            // 更新：从远程拉取新数据
            await e.reply('正在从云端拉取最新预设...', true)
            const results = await presetMgr.updateFromRemote()

            if (results.length === 0) {
                await e.reply('❌ 没有配置任何启用的预设来源', true)
                return true
            }

            const lines = results.map(r => (r.success ? `✅ ${r.name}: ${r.count} 条` : `❌ ${r.name}: ${r.error}`))
            const stats = presetMgr.getStats()
            await e.reply(`预设更新结果:\n${lines.join('\n')}\n\n合计: ${stats.total} 条预设`, true)
        }

        return true
    }

    /**
     * 获取API状态信息
     */
    async apiStatus() {
        const e = this.e

        if (!config.get('features.imageGen.enabled')) {
            await e.reply('图片生成功能未启用', true)
            return true
        }

        const apis = this.getApiList()

        if (apis.length === 0) {
            await e.reply('未配置任何API', true)
            return true
        }

        await e.reply('正在获取API状态...', true)

        const results = await Promise.all(
            apis.map(async (api, i) => {
                try {
                    const statusUrl = api.baseUrl
                        .replace(/\/v1\/chat\/completions\/?$/, '')
                        .replace(/\/v1\/?$/, '')
                        .replace(/\/$/, '')

                    const response = await fetch(statusUrl, {
                        method: 'GET',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(10000)
                    })

                    if (response.ok) {
                        const data = await response.json()
                        return { index: i + 1, baseUrl: api.baseUrl, success: true, data, models: api.models || [] }
                    } else {
                        return { index: i + 1, baseUrl: api.baseUrl, success: false, error: `HTTP ${response.status}` }
                    }
                } catch (err) {
                    return { index: i + 1, baseUrl: api.baseUrl, success: false, error: err.message }
                }
            })
        )
        const mdLines = ['# 📊 画图API状态', '', `> 检测时间: ${new Date().toLocaleString()}`, '']

        for (const r of results) {
            if (!r.success) {
                mdLines.push(`## ❌ API ${r.index} - 连接失败`)
                mdLines.push(`- **地址**: \`${r.baseUrl}\``)
                mdLines.push(`- **错误**: ${r.error}`)
                mdLines.push('')
                continue
            }

            const d = r.data
            mdLines.push(`## ✅ API ${r.index} - ${d.service || 'Unknown'} v${d.version || '?'}`)
            mdLines.push('')
            mdLines.push('| 项目 | 值 |')
            mdLines.push('|------|-----|')
            mdLines.push(`| 状态 | ${d.status || 'unknown'} |`)
            mdLines.push(`| 运行时间 | ${d.uptime || '-'} |`)

            if (r.models?.length > 0) {
                mdLines.push(`| 已配置模型 | ${r.models.length} 个 |`)
            }
            if (d.pool) {
                mdLines.push(`| 资源池 | ${d.pool.ready}/${d.pool.total} 可用 |`)
            }
            if (d.images_generated !== undefined) {
                mdLines.push(`| 已生成图片 | ${d.images_generated} |`)
            }
            if (d.videos_generated !== undefined) {
                mdLines.push(`| 已生成视频 | ${d.videos_generated} |`)
            }
            if (d.success_rate) {
                mdLines.push(`| 成功率 | ${d.success_rate} |`)
            }
            if (d.current_rpm !== undefined) {
                mdLines.push(`| 当前RPM | ${d.current_rpm} (平均: ${d.average_rpm || '-'}) |`)
            }
            if (d.total_requests !== undefined) {
                mdLines.push(`| 总请求 | ${d.total_requests} (成功: ${d.success_requests || 0}) |`)
            }
            if (d.clients?.count !== undefined) {
                mdLines.push(`| 客户端 | ${d.clients.count} 个, ${d.clients.total_threads || 0} 线程 |`)
            }
            if (d.input_tokens !== undefined || d.output_tokens !== undefined) {
                const input = d.input_tokens ? (d.input_tokens / 1000000).toFixed(1) + 'M' : '-'
                const output = d.output_tokens ? (d.output_tokens / 1000000).toFixed(1) + 'M' : '-'
                mdLines.push(`| Token | 输入${input} / 输出${output} |`)
            }
            if (d.mode) {
                mdLines.push(`| 模式 | ${d.mode}${d.flow_enabled ? ' (流式)' : ''} |`)
            }

            mdLines.push('')

            if (d.note && Array.isArray(d.note) && d.note.length > 0) {
                mdLines.push('**📝 备注:**')
                d.note.forEach(n => mdLines.push(`- ${n}`))
                mdLines.push('')
            }
        }

        // 尝试渲染为图片
        try {
            const { renderService } = await import('../src/services/media/RenderService.js')
            const imageBuffer = await renderService.renderMarkdownToImage({
                markdown: mdLines.join('\n'),
                title: '画图API状态',
                icon: '📊',
                theme: 'light',
                showTimestamp: false
            })
            await e.reply(segment.image(imageBuffer))
        } catch (renderErr) {
            logger.warn('[ImageGen] 图片渲染失败，使用文本输出:', renderErr.message)
            const textOutput = results
                .map(r => {
                    if (!r.success) return `【API ${r.index}】❌ ${r.error}`
                    const d = r.data
                    return `【API ${r.index}】✅ ${d.service || 'Unknown'} v${d.version || '?'}\n状态: ${d.status || 'unknown'} | 运行: ${d.uptime || '-'}`
                })
                .join('\n\n')
            await e.reply(`📊 画图API状态\n${'━'.repeat(15)}\n${textOutput}`, true)
        }

        return true
    }

    /**
     * 自定义前缀绘图（customPrefix 触发）
     * 自动判断：有图片时为图生图，否则为文生图
     */
    async customPrefixDraw() {
        const e = this.e

        if (!(await this.isImageGenEnabled())) {
            return false
        }

        const prefix = this.customPrefix
        if (!prefix) return false

        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const prompt = e.msg.replace(new RegExp(`^${escaped}\\s*`, 's'), '').trim()
        if (!prompt) {
            await e.reply(`请输入图片描述，例如：${prefix} 一只可爱的猫咪`, true)
            return true
        }

        const imageUrls = await this.getAllImages(e)
        const genType = imageUrls.length > 0 ? 'img2img' : 'text2img'
        const recallDelay = this.getRecallDelay(60)
        await e.reply(`正在${genType === 'img2img' ? '重绘' : '生成'}图片，请稍候...`, true, { recallMsg: recallDelay })

        try {
            const result = await this.generateImage({
                prompt,
                imageUrls: imageUrls.slice(0, this.maxImages),
                genType
            })
            await this.sendResult(e, result)
        } catch (err) {
            logger.error('[ImageGen] 自定义前缀绘图失败:', err)
            await e.reply(`生成失败: ${err.message}`, true)
        }

        return true
    }

    /**
     * 文生图处理
     */
    async text2img() {
        const e = this.e

        // 检查功能是否启用（支持群组独立配置）
        if (!(await this.isImageGenEnabled())) {
            return false
        }

        const prompt = e.msg.replace(/^#?文生图\s*/s, '').trim()
        if (!prompt) {
            await e.reply('请输入图片描述，例如：#文生图 一只可爱的猫咪', true)
            return true
        }

        const recallDelay = this.getRecallDelay(60)
        await e.reply('正在生成图片，请稍候...', true, { recallMsg: recallDelay })

        try {
            const result = await this.generateImage({ prompt, genType: 'text2img' })
            await this.sendResult(e, result)
        } catch (err) {
            logger.error('[ImageGen] 文生图失败:', err)
            await e.reply(`生成失败: ${err.message}`, true)
        }

        return true
    }

    /**
     * 图生图处理
     */
    async img2img() {
        const e = this.e

        if (!(await this.isImageGenEnabled())) {
            return false
        }

        const urls = await this.getAllImages(e)
        if (!urls.length) {
            await e.reply('请发送或引用至少1张图片', true)
            return true
        }

        const prompt = e.msg.replace(/^#?图生图\s*/s, '').trim() || '请根据这张图片进行艺术化处理'

        const recallDelay = this.getRecallDelay(60)
        await e.reply('正在处理图片，请稍候...', true, { recallMsg: recallDelay })

        try {
            const result = await this.generateImage({
                prompt,
                imageUrls: urls.slice(0, this.maxImages),
                genType: 'img2img'
            })
            await this.sendResult(e, result)
        } catch (err) {
            logger.error('[ImageGen] 图生图失败:', err)
            await e.reply(`处理失败: ${err.message}`, true)
        }

        return true
    }

    /**
     * 文生视频处理
     */
    async text2video() {
        const e = this.e

        if (!(await this.isImageGenEnabled())) {
            return false
        }

        const prompt = e.msg.replace(/^#?文生视频\s*/s, '').trim()
        if (!prompt) {
            await e.reply('请输入视频描述，例如：#文生视频 一只猫咪在草地上奔跑', true)
            return true
        }

        const recallDelay = this.getRecallDelay(120)
        await e.reply('正在生成视频，这可能需要几分钟，请耐心等待...', true, { recallMsg: recallDelay })

        try {
            const result = await this.generateVideo({ prompt })
            await this.sendVideoResult(e, result)
        } catch (err) {
            logger.error('[ImageGen] 文生视频失败:', err)
            await e.reply(`生成失败: ${err.message}`, true)
        }

        return true
    }

    /**
     * 图生视频处理
     */
    async img2video() {
        const e = this.e

        if (!(await this.isImageGenEnabled())) {
            return false
        }

        const urls = await this.getAllImages(e)
        if (!urls.length) {
            await e.reply('请发送或引用至少1张图片作为视频首帧', true)
            return true
        }

        const prompt = e.msg.replace(/^#?图生视频\s*/s, '').trim() || '请根据这张图片生成一段流畅的视频动画'

        const recallDelay = this.getRecallDelay(120)
        await e.reply('正在根据图片生成视频，这可能需要几分钟，请耐心等待...', true, { recallMsg: recallDelay })

        try {
            const result = await this.generateVideo({
                prompt,
                imageUrls: urls.slice(0, 1) // 视频生成通常只支持1张首帧图片
            })
            await this.sendVideoResult(e, result)
        } catch (err) {
            logger.error('[ImageGen] 图生视频失败:', err)
            await e.reply(`处理失败: ${err.message}`, true)
        }

        return true
    }

    /**
     * 预设提示词处理（动态匹配）
     */
    async presetHandler() {
        const e = this.e

        if (!(await this.isImageGenEnabled())) {
            return false
        }
        const preset = presetMgr.findPreset(e.msg)
        if (!preset) return false

        logger.debug('[ImageGen] 匹配预设:', preset.keywords, 'splitGrid:', preset.splitGrid)

        const urls = preset.needImage ? await this.getAllImages(e) : []
        if (preset.needImage && !urls.length) {
            await e.reply('请发送或引用至少1张图片', true)
            return true
        }

        const pureMsg = e.msg.replace(/^#?/, '')
        const hasSplit = !!(preset.splitGrid && preset.splitGrid.cols && preset.splitGrid.rows)
        logger.debug('[ImageGen] hasSplit:', hasSplit)
        const recallDelay = this.getRecallDelay(60)
        await e.reply(`正在生成${pureMsg}效果，请稍候...${hasSplit ? '（完成后将自动切割）' : ''}`, true, {
            recallMsg: recallDelay
        })

        try {
            const result = await this.generateImage({
                prompt: preset.prompt,
                imageUrls: urls.slice(0, this.maxImages),
                genType: urls.length > 0 ? 'img2img' : 'text2img'
            })

            if (hasSplit && result.success && result.images?.length > 0) {
                await this.sendSplitResult(e, result, preset.splitGrid)
            } else {
                await this.sendResult(e, result)
            }
        } catch (err) {
            logger.error('[ImageGen] 预设处理失败:', err)
            await e.reply(`处理失败: ${err.message}`, true)
        }

        return true
    }

    /**
     * 切换绘图模型
     */
    async setModel() {
        const e = this.e
        const match = e.msg.match(/^#?(绘图模型|画图模型|设置绘图模型|切换绘图模型)\s*(.*)$/i)
        const modelName = match?.[2]?.trim()

        // 获取当前配置
        const currentModel = config.get('features.imageGen.model') || 'gemini-2.0-flash-preview-image-generation'
        const currentVideoModel = config.get('features.imageGen.videoModel') || 'veo-2.0-generate-001'

        // 从API配置中获取可用模型列表
        const apis = this.getApiList()
        const allModels = new Set()
        apis.forEach(api => {
            if (Array.isArray(api.models)) {
                api.models.forEach(m => allModels.add(m))
            }
        })
        const availableModels = Array.from(allModels)

        // 分离图片模型和视频模型
        const imageModels = availableModels.filter(
            m => m.includes('image') || m.includes('imagen') || m.includes('gemini')
        )
        const videoModels = availableModels.filter(m => m.includes('veo') || m.includes('video'))

        if (!modelName) {
            // 显示当前模型和可用模型列表
            let reply = ['【绘图模型设置】', '', `当前图片模型: ${currentModel}`, `当前视频模型: ${currentVideoModel}`]

            if (imageModels.length > 0) {
                reply.push('', '可用图片模型:')
                reply.push(...imageModels.map((m, i) => `${i + 1}. ${m}${m === currentModel ? ' ✓' : ''}`))
            }

            if (videoModels.length > 0) {
                reply.push('', '可用视频模型:')
                reply.push(...videoModels.map((m, i) => `${i + 1}. ${m}${m === currentVideoModel ? ' ✓' : ''}`))
            }

            if (availableModels.length === 0) {
                reply.push('', '⚠️ API配置中未定义模型列表，可直接输入模型名称切换')
            }

            reply.push('', '使用方法: #绘图模型 模型名称')

            await e.reply(reply.join('\n'), true)
            return true
        }

        // 支持通过序号选择模型
        const numMatch = modelName.match(/^(\d+)$/)
        if (numMatch) {
            const idx = parseInt(numMatch[1]) - 1
            if (idx >= 0 && idx < imageModels.length) {
                const selected = imageModels[idx]
                config.set('features.imageGen.model', selected)
                await e.reply(`✅ 图片模型已切换为: ${selected}`, true)
                return true
            }
        }

        // 检查是否是视频模型
        if (videoModels.includes(modelName) || modelName.includes('veo') || modelName.includes('video')) {
            config.set('features.imageGen.videoModel', modelName)
            await e.reply(`✅ 视频模型已切换为: ${modelName}`, true)
            return true
        }

        // 设置图片模型（支持任意模型名）
        config.set('features.imageGen.model', modelName)
        await e.reply(`✅ 图片模型已切换为: ${modelName}`, true)
        return true
    }

    /**
     * 根据 baseUrl 和自定义 path 构建完整请求地址
     * @param {string} baseUrl - API基础地址
     * @param {string} [apiPath] - 自定义请求路径，默认 /v1/chat/completions
     * @returns {string} 完整的请求地址
     */
    buildApiUrl(baseUrl, apiPath) {
        if (!baseUrl) return ''
        let url = baseUrl.trim().replace(/\/$/, '')
        let p = (apiPath || '/v1/chat/completions').trim()
        if (!p.startsWith('/')) p = '/' + p
        return url + p
    }

    /**
     * 获取所有API列表（图片+视频通用），按优先级排序
     * 每个 API 支持：独立模型、多Key轮询、自定义请求方法/路径、流式开关
     * @param {string} [overrideModel] - 覆盖模型（用于群组独立配置）
     * @param {string} [genType] - 生成类型：'text2img' | 'img2img' | null
     * @returns {Array<Object>} API 配置列表
     */
    getApiList(overrideModel = null, genType = null) {
        const apiConfig = config.get('features.imageGen') || {}
        const globalModel = overrideModel || apiConfig.model || 'gemini-3-pro-image'
        const globalVideoModel = apiConfig.videoModel || 'veo-2.0-generate-001'

        if (Array.isArray(apiConfig.apis) && apiConfig.apis.length > 0) {
            return apiConfig.apis
                .filter(api => api && api.baseUrl && api.enabled !== false)
                .map((api, idx) => {
                    /* 向后兼容：旧 apiKey 字段自动迁移为 apiKeys 数组 */
                    const apiKeys =
                        Array.isArray(api.apiKeys) && api.apiKeys.filter(k => k?.trim()).length > 0
                            ? api.apiKeys.filter(k => k?.trim())
                            : api.apiKey
                              ? [api.apiKey]
                              : ['']

                    return {
                        name: api.name || `API ${idx + 1}`,
                        baseUrl: api.baseUrl.trim().replace(/\/$/, ''),
                        path: api.path?.trim() || '/v1/chat/completions',
                        method: (api.method || 'POST').toUpperCase(),
                        apiKeys,
                        model:
                            genType === 'text2img'
                                ? api.text2imgModel?.trim() || overrideModel || globalModel
                                : genType === 'img2img'
                                  ? api.img2imgModel?.trim() || api.model?.trim() || overrideModel || globalModel
                                  : api.model?.trim() || overrideModel || globalModel,
                        videoModel: api.videoModel?.trim() || globalVideoModel,
                        stream: api.stream === true,
                        priority: api.priority ?? idx,
                        models: api.models || [],
                        imageTransferMode: api.imageTransferMode || 'auto',
                        enabled: true
                    }
                })
                .sort((a, b) => a.priority - b.priority)
        }

        /* 旧版单 API 兼容 */
        if (apiConfig.apiUrl) {
            return [
                {
                    name: '默认API',
                    baseUrl: apiConfig.apiUrl.trim().replace(/\/$/, ''),
                    path: '/v1/chat/completions',
                    method: 'POST',
                    apiKeys: [apiConfig.apiKey || ''],
                    model: globalModel,
                    videoModel: globalVideoModel,
                    stream: false,
                    priority: 0,
                    models: [],
                    imageTransferMode: apiConfig.imageTransferMode || 'auto',
                    enabled: true
                }
            ]
        }

        /* 无任何 API 配置时返回空数组，避免硬编码第三方地址 */
        logger.warn('[ImageGen] 未配置绘图API，请在管理面板中配置 features.imageGen.apis')
        return []
    }

    /**
     * 获取图片生成API配置（含多Key、请求方法/路径、流式开关）
     * @param {number} apiIndex - API索引
     * @param {string} [overrideModel] - 覆盖模型（用于群组独立配置）
     * @param {string} [genType] - 生成类型：'text2img' | 'img2img' | null
     */
    getImageApiConfig(apiIndex = 0, overrideModel = null, genType = null) {
        const apis = this.getApiList(overrideModel, genType)
        if (apiIndex >= apis.length) return null

        const api = apis[apiIndex]
        return {
            apiUrl: this.buildApiUrl(api.baseUrl, api.path),
            apiKeys: api.apiKeys,
            model: api.model,
            method: api.method,
            stream: api.stream,
            name: api.name,
            imageTransferMode: api.imageTransferMode
        }
    }

    /**
     * 获取可用API数量
     */
    getApiCount() {
        return this.getApiList().length
    }

    /**
     * 通用 API 调用方法
     * @param {Object} options - 配置选项
     * @param {string} options.prompt - 提示词
     * @param {string[]} options.imageUrls - 图片URL列表
     * @param {Function} options.getApiConfig - 获取API配置的方法
     * @param {Function} options.extractResult - 提取结果的方法
     * @param {number} options.maxEmptyRetries - 空响应重试次数
     * @param {number} options.retryDelay - 重试延迟(ms)
     * @param {string} options.logPrefix - 日志前缀
     */
    async callGenApi({
        prompt,
        imageUrls = [],
        getApiConfig,
        extractResult,
        maxEmptyRetries = 2,
        retryDelay = 1000,
        logPrefix = ''
    }) {
        const startTime = Date.now()
        const maxApiCount = this.getApiCount()
        let lastError = null
        let preparedUrls = imageUrls
        let preparedBase64Urls = null
        if (imageUrls.length > 0) {
            try {
                const imgSvc = await getImageService()
                const { urls, errors } = await imgSvc.prepareImagesForApi(imageUrls, { timeout: 15000 })
                preparedUrls = urls

                if (errors.length > 0) {
                    logger.warn(`[ImageGen] 部分图片处理失败: ${errors.join(', ')}`)
                }
                if (preparedUrls.length === 0 && imageUrls.length > 0) {
                    return {
                        success: false,
                        error: `所有图片都无法获取: ${errors.join('; ')}`,
                        duration: this.formatDuration(Date.now() - startTime)
                    }
                }
                logger.debug(`[ImageGen] 图片预处理完成: ${imageUrls.length} -> ${preparedUrls.length}`)
            } catch (prepErr) {
                logger.warn('[ImageGen] 图片预处理失败，使用原始URL:', prepErr.message)
            }
        }

        const getUrlsForApi = async apiConf => {
            if (imageUrls.length === 0) return preparedUrls
            if (apiConf.imageTransferMode === 'base64') {
                if (!preparedBase64Urls) {
                    try {
                        const imgSvc = await getImageService()
                        const { urls, errors } = await imgSvc.prepareImagesForApi(imageUrls, {
                            forceBase64: true,
                            timeout: 15000
                        })
                        if (errors.length > 0) {
                            logger.warn(`[ImageGen] 部分图片base64转换失败: ${errors.join(', ')}`)
                        }
                        preparedBase64Urls = urls.length > 0 ? urls : preparedUrls
                    } catch (err) {
                        logger.warn('[ImageGen] base64转换失败，使用默认URL:', err.message)
                        return preparedUrls
                    }
                }
                return preparedBase64Urls
            }
            return preparedUrls
        }

        for (let apiIndex = 0; apiIndex < maxApiCount; apiIndex++) {
            const apiConf = getApiConfig(apiIndex)
            if (!apiConf) break

            const apiKeys = apiConf.apiKeys || ['']
            let skipToNextApi = false

            /* 多 Key 轮询：依次尝试每个 Key，认证失败自动切换 */
            for (let keyIdx = 0; keyIdx < apiKeys.length && !skipToNextApi; keyIdx++) {
                const currentKey = apiKeys[keyIdx]

                for (let retry = 0; retry <= maxEmptyRetries; retry++) {
                    try {
                        const keyInfo = apiKeys.length > 1 ? ` Key${keyIdx + 1}/${apiKeys.length}` : ''
                        const apiLabel = apiConf.name || `API${apiIndex}`
                        if (apiIndex > 0 || retry > 0 || keyIdx > 0) {
                            logger.info(
                                `[ImageGen] ${logPrefix}重试 ${apiLabel}${keyInfo} (retry=${retry}, model=${apiConf.model})`
                            )
                        } else {
                            logger.info(
                                `[ImageGen] ${logPrefix}调用 ${apiLabel}${keyInfo} (model=${apiConf.model}, method=${apiConf.method || 'POST'}, stream=${apiConf.stream || false})`
                            )
                        }

                        const currentUrls = await getUrlsForApi(apiConf)
                        const content = []
                        if (prompt) content.push({ type: 'text', text: prompt })
                        if (currentUrls.length) {
                            content.push(...currentUrls.map(url => ({ type: 'image_url', image_url: { url } })))
                        }

                        const isStream = apiConf.stream || false
                        const method = apiConf.method || 'POST'
                        const headers = { 'Content-Type': 'application/json' }
                        if (currentKey) headers['Authorization'] = `Bearer ${currentKey}`

                        const fetchOptions = { method, headers, signal: AbortSignal.timeout(this.timeout) }
                        /* GET 请求不携带 body */
                        if (method !== 'GET') {
                            fetchOptions.body = JSON.stringify({
                                model: apiConf.model,
                                messages: [{ role: 'user', content }],
                                stream: isStream,
                                temperature: 0.7
                            })
                        }

                        const response = await fetch(apiConf.apiUrl, fetchOptions)

                        if (!response.ok) {
                            const errorText = await response.text().catch(() => '')
                            /* 认证失败(401/403)时尝试下一个 Key，而非直接抛错 */
                            if ((response.status === 401 || response.status === 403) && keyIdx < apiKeys.length - 1) {
                                logger.warn(
                                    `[ImageGen] ${logPrefix}Key${keyIdx + 1} 认证失败(${response.status})，尝试下一个Key`
                                )
                                break
                            }
                            logger.error(`[ImageGen] API响应错误 ${response.status}:`, errorText)
                            throw new Error(`API 错误 ${response.status}: ${errorText || '未知错误'}`)
                        }

                        /* 根据 stream 配置解析响应 */
                        let data
                        if (isStream) {
                            data = await this.parseStreamResponse(response)
                        } else {
                            data = await response.json()
                        }

                        const result = extractResult(data)
                        if (result && result.length) {
                            // 记录绘图统计（使用统一入口）
                            try {
                                const estimateImageTokens = base64OrUrl => {
                                    if (!base64OrUrl) return 1000
                                    if (base64OrUrl.startsWith('data:') || base64OrUrl.startsWith('base64:')) {
                                        const base64Part = base64OrUrl.split(',').pop() || base64OrUrl
                                        return Math.ceil((base64Part.length * 0.75) / 100)
                                    }
                                    return 1000
                                }
                                const stats = await getStatsService()
                                const textTokens = stats.estimateTokens(prompt || '')
                                const inputImgTokens = imageUrls.reduce((sum, url) => sum + estimateImageTokens(url), 0)
                                const inputTokens = textTokens + inputImgTokens
                                const outputTokens = result.reduce((sum, img) => sum + estimateImageTokens(img), 0)

                                await stats.recordApiCall({
                                    channelId: `imagegen-api${apiIndex}`,
                                    channelName: apiConf.name || `绘图API${apiIndex + 1}`,
                                    model: apiConf.model,
                                    inputTokens,
                                    outputTokens,
                                    duration: Date.now() - startTime,
                                    success: true,
                                    source: 'imagegen',
                                    apiUsage: data.usage,
                                    request: {
                                        prompt: prompt?.substring(0, 200),
                                        imageCount: imageUrls.length,
                                        model: apiConf.model
                                    }
                                })
                            } catch (e) {
                                /* 统计失败不影响主流程 */
                            }
                            return {
                                success: true,
                                result,
                                duration: this.formatDuration(Date.now() - startTime),
                                apiUsed: apiConf.name || (apiIndex > 0 ? `备用API${apiIndex}` : '主API')
                            }
                        }

                        logger.warn(`[ImageGen] ${logPrefix}API返回空结果，准备重试...`)
                        await new Promise(r => setTimeout(r, retryDelay))
                    } catch (err) {
                        lastError = err
                        if (err.name === 'TimeoutError') {
                            logger.warn(`[ImageGen] ${logPrefix}请求超时，切换下一个API`)
                            skipToNextApi = true
                            break
                        }
                        logger.warn(`[ImageGen] ${logPrefix}API请求失败: ${err.message}`)
                        await new Promise(r => setTimeout(r, retryDelay / 2))
                    }
                }
            }
        }

        return {
            success: false,
            error: lastError?.message || `所有API均未能完成${logPrefix}，请稍后重试`,
            duration: this.formatDuration(Date.now() - startTime)
        }
    }

    /**
     * 调用图片生成 API
     * @param {Object} options
     * @param {string} options.prompt - 提示词
     * @param {string[]} options.imageUrls - 图片URL列表
     * @param {'text2img'|'img2img'|null} options.genType - 生成类型，用于选择独立模型
     */
    async generateImage({ prompt, imageUrls = [], genType = null }) {
        /*
         * 获取模型覆盖配置（群组/全局特定类型模型）
         * 优先级：API自定义模型 > overrideModel > 全局通用模型（在 getApiList 中实现）
         */
        const overrideModel = await this.getImageModel(genType)
        const apiConfig = config.get('features.imageGen') || {}
        const firstApi = Array.isArray(apiConfig.apis) && apiConfig.apis[0]
        const firstApiModel = firstApi?.model?.trim() || ''
        const globalModel = apiConfig.model || 'gemini-3-pro-image'

        if (firstApiModel) {
            logger.info(
                `[ImageGen] generateImage: API自定义模型=${firstApiModel}${overrideModel ? `, 群组/全局覆盖=${overrideModel}(已被API模型优先)` : ''}, genType=${genType}`
            )
        } else if (overrideModel) {
            logger.info(`[ImageGen] generateImage: 群组/全局覆盖模型=${overrideModel}, genType=${genType}`)
        } else {
            logger.info(`[ImageGen] generateImage: 全局通用模型=${globalModel}, genType=${genType}`)
        }

        const result = await this.callGenApi({
            prompt,
            imageUrls,
            getApiConfig: idx => this.getImageApiConfig(idx, overrideModel, genType),
            extractResult: data => this.extractImages(data),
            maxEmptyRetries: 2,
            retryDelay: 1000,
            logPrefix: '图片生成'
        })

        return result.success
            ? { success: true, images: result.result, duration: result.duration, apiUsed: result.apiUsed }
            : result
    }

    /**
     * 获取视频生成API配置（含多Key、请求方法/路径、流式开关）
     * @param {number} apiIndex - API索引
     */
    getVideoApiConfig(apiIndex = 0) {
        const apis = this.getApiList()
        if (apiIndex >= apis.length) return null

        const api = apis[apiIndex]
        return {
            apiUrl: this.buildApiUrl(api.baseUrl, api.path),
            apiKeys: api.apiKeys,
            model: api.videoModel,
            method: api.method,
            stream: api.stream,
            name: api.name
        }
    }

    /**
     * 调用视频生成 API
     */
    async generateVideo({ prompt, imageUrls = [] }) {
        const extractVideoOrImage = data => {
            const videos = this.extractVideos(data)
            if (videos.length) return { type: 'video', data: videos }
            const images = this.extractImages(data)
            if (images.length) return { type: 'image', data: images }
            return null
        }

        const result = await this.callGenApi({
            prompt,
            imageUrls,
            getApiConfig: idx => this.getVideoApiConfig(idx),
            extractResult: data => {
                const extracted = extractVideoOrImage(data)
                return extracted ? [extracted] : []
            },
            maxEmptyRetries: 3,
            retryDelay: 2000,
            logPrefix: '视频生成'
        })

        if (!result.success) return result

        const extracted = result.result[0]
        if (extracted.type === 'video') {
            return { success: true, videos: extracted.data, duration: result.duration, apiUsed: result.apiUsed }
        } else {
            return { success: true, images: extracted.data, isImage: true, duration: result.duration }
        }
    }

    /**
     * 从响应中提取视频
     */
    extractVideos(data) {
        const videos = []
        const msg = data?.choices?.[0]?.message
        if (Array.isArray(msg?.content)) {
            for (const item of msg.content) {
                if (item?.type === 'video_url' && item?.video_url?.url) {
                    videos.push(item.video_url.url)
                }
                if (item?.type === 'file' && item?.file?.url) {
                    const url = item.file.url
                    if (url.includes('.mp4') || url.includes('video')) {
                        videos.push(url)
                    }
                }
            }
        }
        if (!videos.length && typeof msg?.content === 'string') {
            const videoUrlRegex = /(https?:\/\/[^\s]+\.mp4[^\s]*)/gi
            let match
            while ((match = videoUrlRegex.exec(msg.content)) !== null) {
                videos.push(match[1])
            }
            const mdLinkRegex = /\[.*?视频.*?\]\((.*?)\)/gi
            while ((match = mdLinkRegex.exec(msg.content)) !== null) {
                if (!videos.includes(match[1])) {
                    videos.push(match[1])
                }
            }
        }
        return videos
    }

    /**
     * 发送视频结果（支持三种发送模式）
     */
    async sendVideoResult(e, result) {
        if (!result.success) {
            await e.reply(`❌ ${result.error}`, true)
            return
        }

        /* 视频结果直接发送（视频不走链接模式） */
        if (!result.isImage) {
            const msgs = []
            for (const url of result.videos) {
                try {
                    msgs.push(segment.video(url))
                } catch {
                    msgs.push(`🎬 视频链接: ${url}`)
                }
            }
            msgs.push(`✅ 视频生成完成 (${result.duration})`)
            await e.reply(msgs, true)
            return
        }

        /* 模型返回图片而非视频，走图片发送模式 */
        const sendMode = this.getSendMode()

        if (sendMode === 'direct') {
            const msgs = [
                ...result.images.map(url => segment.image(url)),
                `⚠️ 模型返回了图片而非视频 (${result.duration})`
            ]
            await e.reply(msgs, true)
            return
        }

        if (sendMode === 'link_qrcode') {
            /* 上传到QQ图床获取CDN链接 */
            const cdnUrls = await Promise.all(result.images.map(url => this.uploadToQQImageBed(e, url)))
            const msgs = [`⚠️ 模型返回了图片而非视频 (${result.duration})`]

            const validCdnUrls = cdnUrls.filter(u => u !== null)
            if (validCdnUrls.length > 0) {
                for (let i = 0; i < validCdnUrls.length; i++) {
                    msgs.push(...this.buildLinkMessages(validCdnUrls[i], i, validCdnUrls.length))
                }
            }
            await e.reply(msgs, true)
            /* QQ图床失败时，将图片压缩为zip发送 */
            if (validCdnUrls.length === 0) {
                await this.sendImagesAsZip(e, result.images)
            }
            return
        }

        /* hybrid 模式 */
        const linkResults = await Promise.all(result.images.map(url => this.saveAndBuildViewUrl(url)))
        const validLinks = linkResults.filter(r => r !== null)

        if (validLinks.length === 0) {
            const msgs = [
                ...result.images.map(url => segment.image(url)),
                `⚠️ 模型返回了图片而非视频 (${result.duration})`
            ]
            await e.reply(msgs, true)
            return
        }

        const msgs = [...result.images.map(url => segment.image(url)), `⚠️ 模型返回了图片而非视频 (${result.duration})`]
        for (let i = 0; i < validLinks.length; i++) {
            msgs.push(...this.buildLinkMessages(validLinks[i].viewUrl, i, validLinks.length))
        }
        await e.reply(msgs, true)
    }

    /**
     * 解析 SSE 流式响应，将流式数据拼合为完整的 OpenAI 兼容响应对象
     * @param {Response} response - fetch 返回的 Response 对象
     * @returns {Promise<Object>} 拼合后的 OpenAI 格式响应
     */
    async parseStreamResponse(response) {
        const text = await response.text()
        const lines = text.split('\n')

        let accumulatedText = ''
        const mediaItems = []

        for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line.startsWith('data:')) continue
            const jsonStr = line.slice(5).trim()
            if (jsonStr === '[DONE]') break

            try {
                const chunk = JSON.parse(jsonStr)
                const delta = chunk?.choices?.[0]?.delta
                if (!delta) continue

                if (typeof delta.content === 'string') {
                    accumulatedText += delta.content
                } else if (Array.isArray(delta.content)) {
                    for (const item of delta.content) {
                        if (item?.type === 'text' && item?.text) {
                            accumulatedText += item.text
                        } else if (item?.type === 'image_url' || item?.type === 'video_url' || item?.type === 'file') {
                            mediaItems.push(item)
                        }
                    }
                }
            } catch {
                /* 跳过无法解析的行 */
            }
        }

        /* 构建与非流式响应兼容的消息结构 */
        let content
        if (mediaItems.length > 0) {
            content = []
            if (accumulatedText) content.push({ type: 'text', text: accumulatedText })
            content.push(...mediaItems)
        } else {
            content = accumulatedText
        }

        return { choices: [{ message: { role: 'assistant', content } }] }
    }

    /**
     * 从响应中提取图片
     */
    extractImages(data) {
        const images = []
        const msg = data?.choices?.[0]?.message
        if (Array.isArray(msg?.content)) {
            for (const item of msg.content) {
                if (item?.type === 'image_url' && item?.image_url?.url) {
                    images.push(item.image_url.url)
                }
            }
        }
        if (!images.length && typeof msg?.content === 'string') {
            const mdImageRegex = /!\[.*?\]\((.*?)\)/g
            let match
            while ((match = mdImageRegex.exec(msg.content)) !== null) {
                let imgUrl = match[1]
                if (imgUrl.startsWith('data:image')) {
                    imgUrl = imgUrl.replace(/^data:image\/\w+;base64,/, 'base64://')
                }
                images.push(imgUrl)
            }
        }

        return images
    }
    /**
     * 获取绘图结果发送模式
     * @returns {'direct'|'link_qrcode'|'hybrid'}
     */
    getSendMode() {
        return config.get('features.imageGen.sendMode') || 'direct'
    }

    /**
     * 将图片URL保存到本地并生成访问链接
     * @param {string} imageUrl - 图片URL（可以是 base64:// 或 http(s)://）
     * @returns {Promise<{viewUrl: string, imageId: string}|null>}
     */
    async saveAndBuildViewUrl(imageUrl) {
        try {
            const imgSvc = await getImageService()
            const routeUtils = await getImageRouteUtils()

            let imageData
            if (imageUrl.startsWith('base64://')) {
                const base64Data = imageUrl.replace('base64://', '')
                const buffer = Buffer.from(base64Data, 'base64')
                imageData = await imgSvc.uploadImage(buffer, 'generated_image.png')
            } else if (imageUrl.startsWith('data:image')) {
                const base64Data = imageUrl.split(',')[1]
                const buffer = Buffer.from(base64Data, 'base64')
                imageData = await imgSvc.uploadImage(buffer, 'generated_image.png')
            } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                imageData = await imgSvc.downloadImage(imageUrl)
            } else {
                return null
            }

            const viewUrl = routeUtils.buildImageViewUrl(imageData.id)
            return viewUrl ? { viewUrl, imageId: imageData.id } : null
        } catch (err) {
            logger.warn('[ImageGen] 保存图片并生成链接失败:', err.message)
            return null
        }
    }

    /**
     * 将图片URL/base64/本地路径转换为 Buffer
     * @param {string} imageUrl - 图片来源（http(s)://、base64://、data:image、本地路径）
     * @returns {Promise<Buffer|null>} 图片 Buffer，失败返回 null
     */
    async _getImageBuffer(imageUrl) {
        try {
            if (imageUrl.startsWith('base64://')) {
                return Buffer.from(imageUrl.replace('base64://', ''), 'base64')
            } else if (imageUrl.startsWith('data:image')) {
                return Buffer.from(imageUrl.split(',')[1], 'base64')
            } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) })
                if (!resp.ok) return null
                return Buffer.from(await resp.arrayBuffer())
            } else if (fs.existsSync(imageUrl)) {
                return fs.readFileSync(imageUrl)
            }
            return null
        } catch (err) {
            logger.warn('[ImageGen] 获取图片Buffer失败:', err.message)
            return null
        }
    }

    /**
     * 上传图片到QQ图床，获取CDN链接
     * 支持 ICQQ 的 uploadImages 接口，其他平台回退返回 null
     * @param {Object} e - 消息事件
     * @param {string} imageUrl - 图片URL（http(s)://、base64:// 或 data:image）
     * @returns {Promise<string|null>} QQ CDN URL，失败返回 null
     */
    async uploadToQQImageBed(e, imageUrl) {
        try {
            const bot = e.bot || Bot
            const groupId = e.group_id
            const buffer = await this._getImageBuffer(imageUrl)
            if (!buffer || buffer.length === 0) return null

            /* ICQQ: uploadImages 批量上传图片到 QQ 图床（无需发送） */
            const target =
                groupId && typeof bot.pickGroup === 'function'
                    ? bot.pickGroup(parseInt(groupId))
                    : e.user_id && typeof bot.pickFriend === 'function'
                      ? bot.pickFriend(parseInt(e.user_id))
                      : null

            if (target && typeof target.uploadImages === 'function') {
                const imgElem = { type: 'image', file: buffer }
                const rejected = await target.uploadImages([imgElem])
                if (rejected && rejected.length > 0) {
                    logger.warn('[ImageGen] QQ图床上传被拒绝:', rejected[0]?.reason || '未知原因')
                    return null
                }
                /* 上传成功后通过 getPicUrl 获取 CDN 下载地址 */
                let url = imgElem.url
                if (!url && typeof target.getPicUrl === 'function') {
                    url = await target.getPicUrl(imgElem)
                }
                if (url) {
                    logger.debug('[ImageGen] QQ图床上传成功:', url.substring(0, 80))
                    return url
                }
            }

            return null
        } catch (err) {
            logger.warn('[ImageGen] QQ图床上传失败:', err.message)
            return null
        }
    }

    /**
     * CRC32 计算（ZIP 格式所需）
     * @param {Buffer} buf - 数据
     * @returns {number} CRC32 校验值
     */
    _crc32(buf) {
        if (!ImageGen._crc32Table) {
            ImageGen._crc32Table = new Uint32Array(256)
            for (let i = 0; i < 256; i++) {
                let c = i
                for (let j = 0; j < 8; j++) {
                    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
                }
                ImageGen._crc32Table[i] = c
            }
        }
        let crc = 0xffffffff
        for (let i = 0; i < buf.length; i++) {
            crc = ImageGen._crc32Table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
        }
        return (crc ^ 0xffffffff) >>> 0
    }

    /**
     * 将文件列表构建为 ZIP Buffer（STORE 方式，无压缩）
     * @param {{ name: string, data: Buffer }[]} files - 文件列表
     * @returns {Buffer} ZIP 文件 Buffer
     */
    _buildZipBuffer(files) {
        const parts = []
        const centralParts = []
        let offset = 0

        for (const file of files) {
            const nameBuffer = Buffer.from(file.name, 'utf8')
            const crc = this._crc32(file.data)

            /* 本地文件头 (30 + 文件名长度) */
            const local = Buffer.alloc(30)
            local.writeUInt32LE(0x04034b50, 0)
            local.writeUInt16LE(20, 4)
            local.writeUInt16LE(0, 8)
            local.writeUInt32LE(crc, 14)
            local.writeUInt32LE(file.data.length, 18)
            local.writeUInt32LE(file.data.length, 22)
            local.writeUInt16LE(nameBuffer.length, 26)

            const localEntry = Buffer.concat([local, nameBuffer, file.data])
            parts.push(localEntry)

            /* 中央目录头 (46 + 文件名长度) */
            const central = Buffer.alloc(46)
            central.writeUInt32LE(0x02014b50, 0)
            central.writeUInt16LE(20, 4)
            central.writeUInt16LE(20, 6)
            central.writeUInt32LE(crc, 16)
            central.writeUInt32LE(file.data.length, 20)
            central.writeUInt32LE(file.data.length, 24)
            central.writeUInt16LE(nameBuffer.length, 28)
            central.writeUInt32LE(offset, 42)

            centralParts.push(Buffer.concat([central, nameBuffer]))
            offset += localEntry.length
        }

        const centralDir = Buffer.concat(centralParts)

        /* 中央目录结束记录 (22 bytes) */
        const eocd = Buffer.alloc(22)
        eocd.writeUInt32LE(0x06054b50, 0)
        eocd.writeUInt16LE(files.length, 8)
        eocd.writeUInt16LE(files.length, 10)
        eocd.writeUInt32LE(centralDir.length, 12)
        eocd.writeUInt32LE(offset, 16)

        return Buffer.concat([...parts, centralDir, eocd])
    }

    /**
     * 将图片压缩为 ZIP 文件并通过群文件/私聊文件发送
     * QQ图床上传失败时的回退方案
     * @param {Object} e - 消息事件
     * @param {string[]} imageUrls - 图片URL列表
     */
    async sendImagesAsZip(e, imageUrls) {
        try {
            const files = []
            for (let i = 0; i < imageUrls.length; i++) {
                const buffer = await this._getImageBuffer(imageUrls[i])
                if (buffer && buffer.length > 0) {
                    files.push({ name: `image_${i + 1}.png`, data: buffer })
                }
            }
            if (files.length === 0) {
                logger.warn('[ImageGen] 没有可打包的图片')
                return
            }

            const zipBuffer = this._buildZipBuffer(files)
            const __dirname = path.dirname(fileURLToPath(import.meta.url))
            const tmpDir = path.join(__dirname, '..', 'data', 'temp')
            fs.mkdirSync(tmpDir, { recursive: true })
            const zipName = `生成图片_${Date.now()}.zip`
            const zipPath = path.join(tmpDir, zipName)
            fs.writeFileSync(zipPath, zipBuffer)

            const bot = e.bot || Bot
            const groupId = e.group_id

            /* ICQQ: group.sendFile / friend.sendFile */
            if (groupId && typeof bot.pickGroup === 'function') {
                const group = bot.pickGroup(parseInt(groupId))
                if (typeof group.sendFile === 'function') {
                    await group.sendFile(zipPath, '/', zipName)
                    setTimeout(() => {
                        try {
                            fs.unlinkSync(zipPath)
                        } catch {}
                    }, 60000)
                    return
                }
            }
            if (!groupId && e.user_id && typeof bot.pickFriend === 'function') {
                const friend = bot.pickFriend(parseInt(e.user_id))
                if (typeof friend.sendFile === 'function') {
                    await friend.sendFile(zipPath, zipName)
                    setTimeout(() => {
                        try {
                            fs.unlinkSync(zipPath)
                        } catch {}
                    }, 60000)
                    return
                }
            }

            /* OneBotv11: upload_group_file / upload_private_file */
            if (typeof bot.sendApi === 'function') {
                if (groupId) {
                    await bot.sendApi('upload_group_file', {
                        group_id: parseInt(groupId),
                        file: zipPath,
                        name: zipName
                    })
                } else if (e.user_id) {
                    await bot.sendApi('upload_private_file', {
                        user_id: parseInt(e.user_id),
                        file: zipPath,
                        name: zipName
                    })
                }
            }

            setTimeout(() => {
                try {
                    fs.unlinkSync(zipPath)
                } catch {}
            }, 60000)
        } catch (err) {
            logger.warn('[ImageGen] 发送图片ZIP失败:', err.message)
        }
    }

    /**
     * 生成QR码图片URL
     * @param {string} text - 要编码的内容
     * @param {number} [size=300] - 二维码尺寸
     * @returns {string}
     */
    getQRCodeUrl(text, size = 300) {
        return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`
    }

    /**
     * 获取默认占位图
     * @returns {string|null} 占位图路径或URL
     */
    getDefaultImage() {
        const defaultImage = config.get('features.imageGen.defaultImage')
        if (defaultImage) return defaultImage

        /* 未配置时使用内置默认占位图 */
        const builtinDefault = path.join(__dirname, '../image/image.png')
        if (fs.existsSync(builtinDefault)) return builtinDefault
        return null
    }

    /**
     * 构建链接+二维码消息段
     * @param {string} viewUrl - 图片访问链接
     * @param {number} [index] - 图片序号（多图时使用）
     * @param {number} [total] - 图片总数
     * @returns {Array} 消息段数组
     */
    buildLinkMessages(viewUrl, index, total) {
        const msgs = []
        const qrUrl = this.getQRCodeUrl(viewUrl)
        const label = total > 1 ? `图片${index + 1}/${total}` : '图片'

        msgs.push(`🔗 ${label}链接:\n${viewUrl}`)
        msgs.push(segment.image(qrUrl))
        return msgs
    }

    /**
     * 发送结果（支持三种模式：direct / link_qrcode / hybrid）
     * @param {Object} e - 消息事件
     * @param {Object} result - 生成结果
     */
    async sendResult(e, result) {
        if (!result.success) {
            await e.reply(`❌ ${result.error}`, true)
            return
        }

        const sendMode = this.getSendMode()

        if (sendMode === 'direct') {
            /* 直接发送图片（原始行为） */
            const msgs = [...result.images.map(url => segment.image(url)), `✅ 生成完成 (${result.duration})`]
            await e.reply(msgs, true)
            return
        }

        if (sendMode === 'link_qrcode') {
            /* 上传到QQ图床获取CDN链接，发送图片 + CDN链接 + 二维码 */
            const cdnUrls = await Promise.all(result.images.map(url => this.uploadToQQImageBed(e, url)))
            const msgs = [`✅ 生成完成 (${result.duration})`]

            const validCdnUrls = cdnUrls.filter(u => u !== null)
            if (validCdnUrls.length > 0) {
                for (let i = 0; i < validCdnUrls.length; i++) {
                    msgs.push(...this.buildLinkMessages(validCdnUrls[i], i, validCdnUrls.length))
                }
            }
            await e.reply(msgs, true)
            /* QQ图床失败时，将图片压缩为zip发送 */
            if (validCdnUrls.length === 0) {
                await this.sendImagesAsZip(e, result.images)
            }
            return
        }

        /* hybrid 模式：发送原图 + 本地服务器链接 + 二维码 */
        const linkResults = await Promise.all(result.images.map(url => this.saveAndBuildViewUrl(url)))
        const validLinks = linkResults.filter(r => r !== null)

        if (validLinks.length === 0) {
            logger.warn('[ImageGen] 链接生成失败，回退到直接发送模式')
            const msgs = [...result.images.map(url => segment.image(url)), `✅ 生成完成 (${result.duration})`]
            await e.reply(msgs, true)
            return
        }

        const msgs = [...result.images.map(url => segment.image(url)), `✅ 生成完成 (${result.duration})`]
        for (let i = 0; i < validLinks.length; i++) {
            msgs.push(...this.buildLinkMessages(validLinks[i].viewUrl, i, validLinks.length))
        }
        await e.reply(msgs, true)
    }

    /**
     * 发送切割后的表情包结果（使用合并转发）
     * @param {Object} e - 消息事件
     * @param {Object} result - 生成结果
     * @param {Object} splitGrid - 切割配置 { cols, rows }
     */
    async sendSplitResult(e, result, splitGrid) {
        if (!result.success) {
            await e.reply(`❌ ${result.error}`, true)
            return
        }

        try {
            /* 发送原图预览时根据 sendMode 决定是否发送原图 */
            const sendMode = this.getSendMode()
            if (sendMode === 'link_qrcode') {
                /* link_qrcode 模式：上传QQ图床，发送CDN链接 + 二维码，然后切割 */
                const cdnUrls = await Promise.all(result.images.map(url => this.uploadToQQImageBed(e, url)))
                const previewMsgs = [`✅ 表情生成完成，正在切割...请稍等`]

                const validCdnUrls = cdnUrls.filter(u => u !== null)
                if (validCdnUrls.length > 0) {
                    for (let i = 0; i < validCdnUrls.length; i++) {
                        previewMsgs.push(...this.buildLinkMessages(validCdnUrls[i], i, validCdnUrls.length))
                    }
                }
                await e.reply(previewMsgs, true)
                /* QQ图床失败时，将图片压缩为zip发送 */
                if (validCdnUrls.length === 0) {
                    await this.sendImagesAsZip(e, result.images)
                }
            } else if (sendMode === 'hybrid') {
                /* hybrid 模式：发送原图 + 链接 + 二维码，然后切割 */
                const previewMsgs = [
                    ...result.images.map(url => segment.image(url)),
                    `✅ 表情生成完成，正在切割...请稍等`
                ]
                const linkResults = await Promise.all(result.images.map(url => this.saveAndBuildViewUrl(url)))
                const validLinks = linkResults.filter(r => r !== null)
                for (let i = 0; i < validLinks.length; i++) {
                    previewMsgs.push(...this.buildLinkMessages(validLinks[i].viewUrl, i, validLinks.length))
                }
                await e.reply(previewMsgs, true)
            } else {
                /* direct 模式：直接发送原图 */
                await e.reply(
                    [...result.images.map(url => segment.image(url)), `✅ 表情生成完成，正在切割...请稍等`],
                    true
                )
            }

            const { cols, rows } = splitGrid
            const bot = e.bot || Bot
            // 使用统一的Bot信息获取
            const botInfo = {
                user_id: bot.uin || bot.self_id || e.self_id || 10000,
                nickname: bot.nickname || bot.info?.nickname || 'Bot'
            }

            for (const imageUrl of result.images) {
                try {
                    const imgSvc = await getImageService()

                    // 预处理图片URL：验证并在需要时转为base64
                    let processedUrl = imageUrl
                    try {
                        const prepared = await imgSvc.prepareImageForApi(imageUrl, { forceBase64: false })
                        if (prepared.url) {
                            processedUrl = prepared.url
                            logger.debug('[ImageGen] 切割图片URL已处理:', prepared.converted ? '已转换' : '无需转换')
                        } else if (prepared.error) {
                            logger.warn('[ImageGen] 图片预处理失败:', prepared.error)
                        }
                    } catch (prepErr) {
                        logger.warn('[ImageGen] 图片预处理异常:', prepErr.message)
                    }

                    const splitImages = await imgSvc.splitEmojiGrid(processedUrl, { cols, rows })

                    if (splitImages.length === 0) {
                        await e.reply('切割失败：未能生成切割图片', true)
                        continue
                    }

                    // 构建合并转发消息节点
                    const forwardNodes = splitImages.map((img, idx) => ({
                        user_id: botInfo.user_id,
                        nickname: botInfo.nickname,
                        message: [segment.image(img)]
                    }))

                    // 添加完成提示节点
                    forwardNodes.push({
                        user_id: botInfo.user_id,
                        nickname: botInfo.nickname,
                        message: [`✅ 表情切割完成！共 ${splitImages.length} 个表情 (${result.duration})`]
                    })

                    // 发送合并转发
                    let sent = false

                    // NapCat/OneBot: sendApi
                    if (!sent && bot?.sendApi) {
                        try {
                            const onebotNodes = forwardNodes.map(n => ({
                                type: 'node',
                                data: {
                                    user_id: String(n.user_id),
                                    nickname: n.nickname,
                                    content: Array.isArray(n.message)
                                        ? n.message.map(m =>
                                              typeof m === 'string' ? { type: 'text', data: { text: m } } : m
                                          )
                                        : [{ type: 'text', data: { text: String(n.message) } }]
                                }
                            }))
                            const isGroup = e.isGroup && e.group_id
                            const apiName = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg'
                            const params = isGroup
                                ? { group_id: parseInt(e.group_id), messages: onebotNodes }
                                : { user_id: parseInt(e.user_id), messages: onebotNodes }
                            const apiResult = await bot.sendApi(apiName, params)
                            if (
                                apiResult?.status === 'ok' ||
                                apiResult?.retcode === 0 ||
                                apiResult?.message_id ||
                                apiResult?.data?.message_id
                            ) {
                                sent = true
                            }
                        } catch {}
                    }

                    // icqq: makeForwardMsg
                    if (!sent && e.isGroup && e.group?.makeForwardMsg) {
                        const forwardMsg = await e.group.makeForwardMsg(forwardNodes)
                        if (forwardMsg) {
                            await e.group.sendMsg(forwardMsg)
                            sent = true
                        }
                    } else if (!sent && !e.isGroup && e.friend?.makeForwardMsg) {
                        const forwardMsg = await e.friend.makeForwardMsg(forwardNodes)
                        if (forwardMsg) {
                            await e.friend.sendMsg(forwardMsg)
                            sent = true
                        }
                    }

                    // 回退：使用 Bot.makeForwardMsg
                    if (!sent && typeof bot?.makeForwardMsg === 'function') {
                        const forwardMsg = await bot.makeForwardMsg(forwardNodes)
                        if (e.group?.sendMsg) {
                            await e.group.sendMsg(forwardMsg)
                            sent = true
                        } else if (e.friend?.sendMsg) {
                            await e.friend.sendMsg(forwardMsg)
                            sent = true
                        }
                    }

                    // 最后回退：分批发送
                    if (!sent) {
                        logger.warn('[ImageGen] 合并转发不可用，回退到分批发送')
                        const batchSize = 10
                        for (let i = 0; i < splitImages.length; i += batchSize) {
                            const batch = splitImages.slice(i, Math.min(i + batchSize, splitImages.length))
                            const batchMsgs = batch.map(img => segment.image(img))
                            batchMsgs.push(
                                `表情 ${i + 1}-${Math.min(i + batchSize, splitImages.length)} / ${splitImages.length}`
                            )
                            await e.reply(batchMsgs, true)
                            if (i + batchSize < splitImages.length) {
                                await new Promise(r => setTimeout(r, 500))
                            }
                        }
                        await e.reply(`✅ 表情切割完成！共 ${splitImages.length} 个表情 (${result.duration})`, true)
                    }
                } catch (splitErr) {
                    logger.error('[ImageGen] 表情切割失败:', splitErr)
                    await e.reply(`切割失败: ${splitErr.message}，已发送原图`, true)
                }
            }
        } catch (err) {
            logger.error('[ImageGen] sendSplitResult 失败:', err)
            await this.sendResult(e, result)
        }
    }
    async getAllImages(e) {
        const urls = []
        const bot = e.bot || Bot

        // 提取图片URL（优先级：url > file > path）
        const extractImgUrl = m => {
            const d = m.data || m

            // 处理普通图片
            if (m.type === 'image') {
                // 优先使用url，然后是file，最后是path
                let imgUrl = d.url || m.url || d.file || m.file || d.path || null

                // 处理file://协议
                if (imgUrl && imgUrl.startsWith('file://')) {
                    imgUrl = imgUrl.replace('file://', '')
                }

                return imgUrl
            }

            // 处理 bface 原创表情
            if (m.type === 'bface') {
                const bfaceFile = d.file || m.file || ''
                if (bfaceFile && bfaceFile.length >= 32) {
                    // 构建 bface URL
                    return `https://gxh.vip.qq.com/club/item/parcel/item/${bfaceFile.substring(0, 2)}/${bfaceFile.substring(0, 32)}/raw300.gif`
                }
            }

            return null
        }

        logger.debug(
            '[ImageGen] getAllImages 开始, hasGetReply=',
            !!e.getReply,
            'hasSource=',
            !!e.source,
            'reply_id=',
            e.reply_id
        )

        // 从引用消息获取图片
        if (e.getReply || e.source || e.reply_id) {
            try {
                let source = null

                if (e.getReply) {
                    logger.debug('[ImageGen] 尝试 e.getReply()')
                    source = await e.getReply()
                    logger.debug('[ImageGen] e.getReply() 结果:', source ? 'success' : 'null')
                }

                if (!source && e.source?.message_id) {
                    try {
                        logger.debug('[ImageGen] 尝试 MessageApi.getMsg, message_id=', e.source.message_id)
                        source = await MessageApi.getMsg(e, e.source.message_id)
                        logger.debug('[ImageGen] MessageApi.getMsg 结果:', source ? 'success' : 'null')
                    } catch (err) {
                        logger.debug('[ImageGen] MessageApi.getMsg 失败:', err.message)
                    }
                }
                if (!source && e.source?.message_id) {
                    try {
                        logger.debug(
                            '[ImageGen] 尝试 bot.getMsg/sendApi, hasGetMsg=',
                            !!bot?.getMsg,
                            'hasSendApi=',
                            !!bot?.sendApi
                        )
                        if (bot?.getMsg) {
                            source = await bot.getMsg(e.source.message_id)
                        } else if (bot?.sendApi) {
                            const res = await bot.sendApi('get_msg', { message_id: e.source.message_id })
                            source = res?.data || res
                        }
                        logger.debug('[ImageGen] bot方式结果:', source ? 'success' : 'null')
                    } catch (err) {
                        logger.debug('[ImageGen] bot方式失败:', err.message)
                    }
                }
                if (!source && e.source) {
                    const seq = e.source.seq || e.source.message_id
                    logger.debug(
                        '[ImageGen] 尝试 group/friend 方式, seq=',
                        seq,
                        'hasGroup=',
                        !!e.group,
                        'hasFriend=',
                        !!e.friend
                    )
                    if (e.group?.getMsg && seq) {
                        try {
                            source = await e.group.getMsg(seq)
                        } catch {}
                    }
                    if (!source && e.group?.getChatHistory && seq) {
                        try {
                            const history = await e.group.getChatHistory(seq, 1)
                            source = history?.pop()
                        } catch {}
                    }
                    if (!source && e.friend?.getChatHistory && e.source.time) {
                        try {
                            const history = await e.friend.getChatHistory(e.source.time, 1)
                            source = history?.pop()
                        } catch {}
                    }
                    logger.debug('[ImageGen] group/friend 方式结果:', source ? 'success' : 'null')
                }
                if (!source && e.source?.seq && e.group_id && bot?.pickGroup) {
                    try {
                        logger.debug('[ImageGen] 尝试 bot.pickGroup')
                        const group = bot.pickGroup(e.group_id)
                        if (group?.getMsg) {
                            source = await group.getMsg(e.source.seq)
                        } else if (group?.getChatHistory) {
                            const history = await group.getChatHistory(e.source.seq, 1)
                            source = history?.pop()
                        }
                        logger.debug('[ImageGen] pickGroup 结果:', source ? 'success' : 'null')
                    } catch (err) {
                        logger.debug('[ImageGen] pickGroup 失败:', err.message)
                    }
                }

                logger.debug('[ImageGen] 最终 source=', source ? 'found' : 'null')

                const sourceData = source?.data || source
                const msgs = sourceData?.message || sourceData?.content || source?.message || []
                const msgArr = Array.isArray(msgs) ? msgs : []

                logger.debug(
                    '[ImageGen] 消息数组长度:',
                    msgArr.length,
                    '类型:',
                    msgArr.map(m => m.type)
                )

                for (const m of msgArr) {
                    const imgUrl = extractImgUrl(m)
                    if (imgUrl && !urls.includes(imgUrl)) {
                        logger.debug('[ImageGen] 从引用提取到图片:', imgUrl.substring(0, 80))
                        urls.push(imgUrl)
                    }
                }
                if (source && urls.length === 0) {
                    logger.debug(
                        '[ImageGen] 引用消息结构:',
                        JSON.stringify({
                            keys: Object.keys(source || {}),
                            dataKeys: Object.keys(sourceData || {}),
                            msgCount: msgArr.length,
                            msgTypes: msgArr.map(m => m.type),
                            rawSource: JSON.stringify(source).substring(0, 500)
                        })
                    )
                }
            } catch (err) {
                logger.debug('[ImageGen] 获取引用图片失败:', err.message)
            }
        }

        // 从当前消息获取图片
        const msgArray = Array.isArray(e.message) ? e.message : []
        logger.debug(
            '[ImageGen] 当前消息数组:',
            msgArray.map(m => m.type)
        )

        for (const m of msgArray) {
            const imgUrl = extractImgUrl(m)
            if (imgUrl && !urls.includes(imgUrl)) {
                logger.debug('[ImageGen] 从当前消息提取图片:', imgUrl.substring(0, 80))
                urls.push(imgUrl)
            }
        }

        // 只有在没有其他图片时，才添加@用户头像
        if (urls.length === 0) {
            for (const m of msgArray) {
                if (m.type === 'at') {
                    const qq = m.qq || m.data?.qq
                    if (qq && qq !== 'all' && String(qq) !== String(e.self_id)) {
                        // 使用统一的头像获取接口
                        const avatarUrl = getAvatarUrl(e, qq, 640)
                        if (avatarUrl && !urls.includes(avatarUrl)) {
                            logger.debug('[ImageGen] 添加@用户头像:', qq)
                            urls.push(avatarUrl)
                        }
                    }
                }
            }
        }

        // 回退到发送者头像
        const hasQuote = !!(e.getReply || e.source || e.reply_id)
        if (urls.length === 0 && !hasQuote && e.user_id) {
            // 使用统一的头像获取接口
            const senderAvatar = getAvatarUrl(e, e.user_id, 640)
            if (senderAvatar) {
                logger.debug('[ImageGen] 回退到发送者头像:', e.user_id)
                urls.push(senderAvatar)
            } else {
                logger.debug('[ImageGen] 无法获取用户头像')
            }
        }

        logger.debug('[ImageGen] 最终获取到的图片数:', urls.length)
        return urls
    }

    /**
     * 格式化时长
     */
    formatDuration(ms) {
        const sec = Math.floor(ms / 1000)
        if (sec < 60) return `${sec}秒`
        return `${Math.floor(sec / 60)}分${sec % 60}秒`
    }
}
