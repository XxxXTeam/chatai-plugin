/**
 * 绘图服务 MCP 工具
 * 直接调用内置 ImageGen 绘图模块，支持文生图、图生图、预设关键词、文生视频、图生视频
 */

import config from '../../../config/config.js'

/* 懒加载 ImageGen 实例和预设管理器 */
let _imageGenInstance = null
let _presetManager = null

/**
 * 获取 ImageGen 插件实例（懒加载单例）
 * @returns {Promise<Object>}
 */
async function getImageGen() {
    if (!_imageGenInstance) {
        const { ImageGen } = await import('../../../apps/ImageGen.js')
        _imageGenInstance = new ImageGen()
    }
    return _imageGenInstance
}

/**
 * 获取预设管理器（懒加载单例）
 * @returns {Promise<Object>}
 */
async function getPresetManager() {
    if (!_presetManager) {
        const { imageGenPresetManager } = await import('../../../apps/ImageGen.js')
        await imageGenPresetManager.init()
        _presetManager = imageGenPresetManager
    }
    return _presetManager
}

/**
 * 为 ImageGen 实例注入事件上下文
 * @param {Object} imageGen - ImageGen 实例
 * @param {Object|null} e - 消息事件对象
 */
function injectEvent(imageGen, e) {
    if (e) {
        imageGen.e = e
    } else {
        /* 无事件上下文时构造最小模拟对象，避免 getImageModel 等方法报错 */
        imageGen.e = { isGroup: false, reply: async () => {} }
    }
}

export const imageGenTools = [
    {
        name: 'generate_image',
        description:
            '使用内置绘图服务生成图片（文生图/图生图）。' +
            '支持传入提示词生成图片，或同时传入提示词和参考图片进行图生图。' +
            '生成的图片会自动发送给用户。',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '图片生成提示词，详细描述你想要生成的图片内容'
                },
                image_urls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '参考图片URL列表（可选），传入后变为图生图模式。可从消息中解析获取'
                },
                auto_send: {
                    type: 'boolean',
                    description: '是否自动发送生成的图片给用户，默认true',
                    default: true
                }
            },
            required: ['prompt']
        },
        handler: async (args, ctx) => {
            try {
                const { prompt, image_urls = [], auto_send = true } = args
                const e = ctx?.getEvent?.()
                const imageGen = await getImageGen()
                injectEvent(imageGen, e)

                const genType = image_urls.length > 0 ? 'img2img' : 'text2img'

                if (auto_send && e) {
                    const recallDelay = imageGen.getRecallDelay(60)
                    await e.reply(genType === 'img2img' ? '正在处理图片，请稍候...' : '正在生成图片，请稍候...', true, {
                        recallMsg: recallDelay
                    })
                }

                const result = await imageGen.generateImage({
                    prompt,
                    imageUrls: image_urls.slice(0, imageGen.maxImages),
                    genType
                })

                if (!result.success) {
                    return { success: false, error: result.error }
                }

                /* 自动发送图片 */
                if (auto_send && e) {
                    await imageGen.sendResult(e, result)
                }

                return {
                    success: true,
                    images: result.images,
                    duration: result.duration,
                    apiUsed: result.apiUsed,
                    image_count: result.images?.length || 0,
                    mode: genType
                }
            } catch (err) {
                return { success: false, error: `图片生成失败: ${err.message}` }
            }
        }
    },

    {
        name: 'generate_video',
        description:
            '使用内置绘图服务生成视频（文生视频/图生视频）。' +
            '支持传入提示词生成视频，或同时传入提示词和首帧图片。' +
            '生成时间较长，通常需要几分钟。',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: '视频生成提示词，描述你想要生成的视频内容'
                },
                image_url: {
                    type: 'string',
                    description: '首帧图片URL（可选），传入后变为图生视频模式'
                },
                auto_send: {
                    type: 'boolean',
                    description: '是否自动发送生成的视频给用户，默认true',
                    default: true
                }
            },
            required: ['prompt']
        },
        handler: async (args, ctx) => {
            try {
                const { prompt, image_url, auto_send = true } = args
                const e = ctx?.getEvent?.()
                const imageGen = await getImageGen()
                injectEvent(imageGen, e)

                if (auto_send && e) {
                    const recallDelay = imageGen.getRecallDelay(60)
                    await e.reply('正在生成视频，这可能需要几分钟，请耐心等待...', true, { recallMsg: recallDelay })
                }

                const imageUrls = image_url ? [image_url] : []
                const result = await imageGen.generateVideo({ prompt, imageUrls })

                if (!result.success) {
                    return { success: false, error: result.error }
                }

                /* 自动发送结果 */
                if (auto_send && e) {
                    await imageGen.sendVideoResult(e, result)
                }

                return {
                    success: true,
                    videos: result.videos,
                    images: result.images,
                    isImage: result.isImage || false,
                    duration: result.duration,
                    apiUsed: result.apiUsed
                }
            } catch (err) {
                return { success: false, error: `视频生成失败: ${err.message}` }
            }
        }
    },

    {
        name: 'list_image_presets',
        description:
            '列出所有可用的绘图预设模板。' +
            '预设包含预定义的提示词和关键词，可以通过 use_image_preset 工具直接使用。' +
            '包括内置预设、自定义预设和云端预设。',
        inputSchema: {
            type: 'object',
            properties: {
                source: {
                    type: 'string',
                    enum: ['all', 'builtin', 'custom', 'remote'],
                    description: '筛选预设来源，默认all返回所有'
                }
            }
        },
        handler: async args => {
            try {
                const presetMgr = await getPresetManager()
                const source = args?.source || 'all'
                const allPresets = presetMgr.getAllPresets()
                const stats = presetMgr.getStats()

                let filtered = allPresets
                if (source !== 'all') {
                    filtered = allPresets.filter(p => {
                        if (source === 'builtin') return p.source === 'builtin'
                        if (source === 'custom') return p.source === 'custom'
                        if (source === 'remote') return p.source !== 'builtin' && p.source !== 'custom'
                        return true
                    })
                }

                const presets = filtered.map(p => ({
                    keywords: p.keywords,
                    source: p.source,
                    need_image: !!p.needImage,
                    has_split_grid: !!(p.splitGrid?.cols && p.splitGrid?.rows),
                    prompt_preview: p.prompt?.substring(0, 80) + (p.prompt?.length > 80 ? '...' : '')
                }))

                return {
                    success: true,
                    total: stats.total,
                    builtin_count: stats.builtin,
                    custom_count: stats.custom,
                    remote_count: stats.remote,
                    filtered_count: presets.length,
                    presets
                }
            } catch (err) {
                return { success: false, error: `获取预设列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'use_image_preset',
        description:
            '使用内置绘图预设生成图片。' +
            '传入预设关键词即可使用对应的提示词模板。' +
            '常见预设: 手办/手办化、Q版/表情包、动漫化、赛博朋克、油画、水彩。' +
            '需要图片的预设（如手办化、Q版表情包）必须提供 image_urls。' +
            '表情包类预设会自动切割为独立表情。',
        inputSchema: {
            type: 'object',
            properties: {
                keyword: {
                    type: 'string',
                    description: '预设关键词，如"手办"、"Q版"、"动漫化"、"赛博朋克"等'
                },
                image_urls: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '参考图片URL列表，部分预设需要提供图片'
                },
                auto_send: {
                    type: 'boolean',
                    description: '是否自动发送结果给用户，默认true',
                    default: true
                }
            },
            required: ['keyword']
        },
        handler: async (args, ctx) => {
            try {
                const { keyword, image_urls = [], auto_send = true } = args
                const e = ctx?.getEvent?.()
                const presetMgr = await getPresetManager()
                const imageGen = await getImageGen()
                injectEvent(imageGen, e)

                const preset = presetMgr.findPreset(keyword)
                if (!preset) {
                    const allPresets = presetMgr.getAllPresets()
                    const availableKeywords = allPresets
                        .flatMap(p => p.keywords)
                        .slice(0, 30)
                        .join('、')
                    return {
                        success: false,
                        error: `未找到关键词"${keyword}"对应的预设`,
                        available_keywords: availableKeywords
                    }
                }

                if (preset.needImage && image_urls.length === 0) {
                    return {
                        success: false,
                        error: `预设"${keyword}"需要提供参考图片，请传入 image_urls 参数`,
                        need_image: true
                    }
                }

                const hasSplit = !!(preset.splitGrid?.cols && preset.splitGrid?.rows)

                if (auto_send && e) {
                    const recallDelay = imageGen.getRecallDelay(60)
                    await e.reply(`正在生成${keyword}效果，请稍候...${hasSplit ? '（完成后将自动切割）' : ''}`, true, {
                        recallMsg: recallDelay
                    })
                }

                /* 直接调用绘图模块生成图片 */
                const result = await imageGen.generateImage({
                    prompt: preset.prompt,
                    imageUrls: image_urls.slice(0, imageGen.maxImages),
                    genType: image_urls.length > 0 ? 'img2img' : 'text2img'
                })

                if (!result.success) {
                    return { success: false, error: result.error }
                }

                /* 发送结果：表情包类预设走切割逻辑，其他直接发送 */
                if (auto_send && e) {
                    if (hasSplit) {
                        await imageGen.sendSplitResult(e, result, preset.splitGrid)
                    } else {
                        await imageGen.sendResult(e, result)
                    }
                }

                return {
                    success: true,
                    preset_keyword: keyword,
                    preset_source: preset.source,
                    images: result.images,
                    duration: result.duration,
                    apiUsed: result.apiUsed,
                    has_split: hasSplit
                }
            } catch (err) {
                return { success: false, error: `预设绘图失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_image_gen_status',
        description: '获取绘图服务的当前状态，包括是否启用、当前模型、可用API数量、预设统计等',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            try {
                const apiConfig = config.get('features.imageGen') || {}
                const imageGen = await getImageGen()
                const apis = imageGen.getApiList()

                let presetStats = null
                try {
                    const presetMgr = await getPresetManager()
                    presetStats = presetMgr.getStats()
                } catch {
                    /* 预设加载失败不影响主流程 */
                }

                /* 收集可用模型 */
                const allModels = new Set()
                apis.forEach(api => {
                    if (Array.isArray(api.models)) {
                        api.models.forEach(m => allModels.add(m))
                    }
                })

                return {
                    success: true,
                    enabled: apiConfig.enabled !== false,
                    current_model: apiConfig.model || 'gemini-3-pro-image',
                    current_video_model: apiConfig.videoModel || 'veo-2.0-generate-001',
                    api_count: apis.length,
                    available_models: Array.from(allModels),
                    max_images: imageGen.maxImages,
                    timeout_ms: imageGen.timeout,
                    presets: presetStats
                }
            } catch (err) {
                return { success: false, error: `获取绘图状态失败: ${err.message}` }
            }
        }
    }
]
