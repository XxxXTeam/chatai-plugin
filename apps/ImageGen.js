/**
 * AI 图片/视频生成插件
 * 支持文生图、图生图、文生视频、图生视频和预设提示词模式
 * 使用 Gemini 图片/视频生成模型
 * 兼容 icqq / NapCat / OneBot
 */
import config from '../config/config.js'
import { segment, MessageApi } from '../src/utils/messageParser.js'

// 预设提示词组
const PRESET_PROMPTS = [
    {
        keywords: ['手办', '手办化', '变手办', '转手办'],
        needImage: true,
        prompt: 'Please accurately transform the main subject in this photo into a realistic, masterpiece-like 1/7 scale PVC statue. Behind this statue, a packaging box should be placed: the box has a large clear front window on its front side, and is printed with subject artwork, product name, brand logo, barcode, as well as a small specifications or authenticity verification panel. A small price tag sticker must also be attached to one corner of the box. Meanwhile, a computer monitor is placed at the back, and the monitor screen needs to display the ZBrush modeling process of this statue. In front of the packaging box, this statue should be placed on a round plastic base. The statue must have 3D dimensionality and a sense of realism, and the texture of the PVC material needs to be clearly represented. The human figure\'s expression and movements must be exactly consistent with those in the photo.',
    },
    {
        keywords: ['Q版', 'q版', '表情包'],
        needImage: true,
        prompt: '请以图片中的主要人物生成q版半身像表情符号包中的人物形象给我。丰富多彩的手绘风格，采用4x6的布局，涵盖了各种常见的聊天用语。要求:1.注意正确的头饰。2.不要复制原始图像。3.所有注释都应该是手写的简体中文。4.每个表情符号行动应该是独特的。5.生成的图像需要是4K，分辨率为16:9。',
    },
    {
        keywords: ['动漫化', '二次元化', '卡通化'],
        needImage: true,
        prompt: '将图片中的人物转换为高质量动漫风格，保持人物的主要特征和表情，使用精美的日系动漫画风，色彩鲜艳，线条流畅。',
    },
    {
        keywords: ['赛博朋克', '赛博'],
        needImage: true,
        prompt: '将图片转换为赛博朋克风格，添加霓虹灯效果、科幻元素、未来都市背景，保持主体人物特征，整体色调偏蓝紫色调。',
    },
    {
        keywords: ['油画', '油画风'],
        needImage: true,
        prompt: '将图片转换为古典油画风格，模仿文艺复兴时期大师的画风，注重光影效果和细节质感，保持人物特征。',
    },
    {
        keywords: ['水彩', '水彩画'],
        needImage: true,
        prompt: '将图片转换为精美的水彩画风格，色彩透明、层次丰富，有水彩特有的晕染效果和纸张质感。',
    },
]

// 构建预设关键词正则
const presetKeywords = PRESET_PROMPTS
    .flatMap(p => p.keywords)
    .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
const presetReg = new RegExp(`^#?(${presetKeywords})$`, 'i')

export class ImageGen extends plugin {
    constructor() {
        super({
            name: 'AI-ImageGen',
            dsc: 'AI图片/视频生成 - 文生图/图生图/文生视频/图生视频',
            event: 'message',
            priority: 50,
            rule: [
                { reg: /^#?文生图\s*(.+)$/s, fnc: 'text2img' },
                { reg: /^#?图生图\s*(.*)$/s, fnc: 'img2img' },
                { reg: /^#?文生视频\s*(.+)$/s, fnc: 'text2video' },
                { reg: /^#?图生视频\s*(.*)$/s, fnc: 'img2video' },
                { reg: presetReg, fnc: 'presetHandler' },
                { reg: /^#?(谷歌状态|画图状态|api状态)$/i, fnc: 'apiStatus' },
            ]
        })
        
        this.timeout = 600000 // 10分钟超时（视频生成需要更长时间）
        this.maxImages = 3
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
        
        const apiConfig = config.get('features.imageGen') || {}
        const apis = this.getApiList()
        
        if (apis.length === 0) {
            await e.reply('未配置任何API', true)
            return true
        }
        
        await e.reply('正在获取API状态...', true)
        
        const results = []
        
        for (let i = 0; i < apis.length; i++) {
            const api = apis[i]
            try {
                // 请求根路径获取状态
                const statusUrl = api.baseUrl.replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/v1\/?$/, '').replace(/\/$/, '')
                
                const response = await fetch(statusUrl, {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(10000)
                })
                
                if (response.ok) {
                    const data = await response.json()
                    results.push({
                        index: i + 1,
                        baseUrl: api.baseUrl,
                        success: true,
                        data
                    })
                } else {
                    results.push({
                        index: i + 1,
                        baseUrl: api.baseUrl,
                        success: false,
                        error: `HTTP ${response.status}`
                    })
                }
            } catch (err) {
                results.push({
                    index: i + 1,
                    baseUrl: api.baseUrl,
                    success: false,
                    error: err.message
                })
            }
        }
        
        // 格式化输出
        const output = results.map(r => {
            if (!r.success) {
                return `【API ${r.index}】❌ 连接失败\n地址: ${r.baseUrl}\n错误: ${r.error}`
            }
            
            const d = r.data
            const lines = [
                `【API ${r.index}】✅ ${d.service || 'Unknown'} v${d.version || '?'}`,
                `状态: ${d.status || 'unknown'}`,
                `运行时间: ${d.uptime || '-'}`,
            ]
            
            // 显示已配置的模型数量
            const apiObj = apis[r.index - 1]
            if (apiObj?.models?.length > 0) {
                lines.push(`已配置模型: ${apiObj.models.length} 个`)
            }
            
            if (d.pool) {
                lines.push(`资源池: ${d.pool.ready}/${d.pool.total} 可用`)
            }
            if (d.images_generated !== undefined) {
                lines.push(`已生成图片: ${d.images_generated}`)
            }
            if (d.videos_generated !== undefined) {
                lines.push(`已生成视频: ${d.videos_generated}`)
            }
            if (d.success_rate) {
                lines.push(`成功率: ${d.success_rate}`)
            }
            if (d.current_rpm !== undefined) {
                lines.push(`当前RPM: ${d.current_rpm} (平均: ${d.average_rpm || '-'})`)
            }
            if (d.total_requests !== undefined) {
                lines.push(`总请求: ${d.total_requests} (成功: ${d.success_requests || 0})`)
            }
            if (d.clients?.count !== undefined) {
                lines.push(`客户端: ${d.clients.count} 个, ${d.clients.total_threads || 0} 线程`)
            }
            if (d.input_tokens !== undefined || d.output_tokens !== undefined) {
                const input = d.input_tokens ? (d.input_tokens / 1000000).toFixed(1) + 'M' : '-'
                const output = d.output_tokens ? (d.output_tokens / 1000000).toFixed(1) + 'M' : '-'
                lines.push(`Token: 输入${input} / 输出${output}`)
            }
            if (d.mode) {
                lines.push(`模式: ${d.mode}${d.flow_enabled ? ' (流式)' : ''}`)
            }
            // 显示备注信息
            if (d.note && Array.isArray(d.note) && d.note.length > 0) {
                lines.push(`━━━━━━━━━━`)
                lines.push(`📝 备注:`)
                d.note.forEach(n => lines.push(`  • ${n}`))
            }
            
            return lines.join('\n')
        }).join('\n\n')
        
        await e.reply(`📊 画图API状态\n${'━'.repeat(15)}\n${output}`, true)
        return true
    }

    /**
     * 文生图处理
     */
    async text2img() {
        const e = this.e
        
        // 检查功能是否启用
        if (!config.get('features.imageGen.enabled')) {
            return false
        }
        
        const prompt = e.msg.replace(/^#?文生图\s*/s, '').trim()
        if (!prompt) {
            await e.reply('请输入图片描述，例如：#文生图 一只可爱的猫咪', true)
            return true
        }
        
        await e.reply('正在生成图片，请稍候...', true, { recallMsg: 60 })
        
        try {
            const result = await this.generateImage({ prompt })
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
        
        if (!config.get('features.imageGen.enabled')) {
            return false
        }
        
        const urls = await this.getAllImages(e)
        if (!urls.length) {
            await e.reply('请发送或引用至少1张图片', true)
            return true
        }
        
        const prompt = e.msg.replace(/^#?图生图\s*/s, '').trim() || '请根据这张图片进行艺术化处理'
        
        await e.reply('正在处理图片，请稍候...', true, { recallMsg: 60 })
        
        try {
            const result = await this.generateImage({ 
                prompt, 
                imageUrls: urls.slice(0, this.maxImages) 
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
        
        if (!config.get('features.imageGen.enabled')) {
            return false
        }
        
        const prompt = e.msg.replace(/^#?文生视频\s*/s, '').trim()
        if (!prompt) {
            await e.reply('请输入视频描述，例如：#文生视频 一只猫咪在草地上奔跑', true)
            return true
        }
        
        await e.reply('正在生成视频，这可能需要几分钟，请耐心等待...', true, { recallMsg: 120 })
        
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
        
        if (!config.get('features.imageGen.enabled')) {
            return false
        }
        
        const urls = await this.getAllImages(e)
        if (!urls.length) {
            await e.reply('请发送或引用至少1张图片作为视频首帧', true)
            return true
        }
        
        const prompt = e.msg.replace(/^#?图生视频\s*/s, '').trim() || '请根据这张图片生成一段流畅的视频动画'
        
        await e.reply('正在根据图片生成视频，这可能需要几分钟，请耐心等待...', true, { recallMsg: 120 })
        
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
     * 预设提示词处理
     */
    async presetHandler() {
        const e = this.e
        
        if (!config.get('features.imageGen.enabled')) {
            return false
        }
        
        const pureMsg = e.msg.replace(/^#?/, '').toLowerCase()
        const preset = PRESET_PROMPTS.find(p => 
            p.keywords.some(k => k.toLowerCase() === pureMsg)
        )
        
        if (!preset) return false
        
        const urls = preset.needImage ? await this.getAllImages(e) : []
        if (preset.needImage && !urls.length) {
            await e.reply('请发送或引用至少1张图片', true)
            return true
        }
        
        await e.reply(`正在生成${pureMsg}效果，请稍候...`, true, { recallMsg: 60 })
        
        try {
            const result = await this.generateImage({
                prompt: preset.prompt,
                imageUrls: urls.slice(0, this.maxImages)
            })
            await this.sendResult(e, result)
        } catch (err) {
            logger.error('[ImageGen] 预设处理失败:', err)
            await e.reply(`处理失败: ${err.message}`, true)
        }
        
        return true
    }

    /**
     * 标准化baseUrl为完整API地址
     * @param {string} baseUrl - 基础URL
     * @returns {string} 完整的chat/completions地址
     */
    normalizeApiUrl(baseUrl) {
        if (!baseUrl) return ''
        let url = baseUrl.trim().replace(/\/$/, '')
        
        // 如果已经是完整的chat/completions路径
        if (url.endsWith('/chat/completions')) {
            return url
        }
        // 如果只有/v1
        if (url.endsWith('/v1')) {
            return url + '/chat/completions'
        }
        // 如果是根路径
        return url + '/v1/chat/completions'
    }

    /**
     * 获取所有API列表（图片+视频通用）
     * @returns {Array<{baseUrl: string, apiKey: string, model: string, videoModel: string}>}
     */
    getApiList() {
        const apiConfig = config.get('features.imageGen') || {}
        const globalModel = apiConfig.model || 'gemini-3-pro-image'
        const globalVideoModel = apiConfig.videoModel || 'veo-2.0-generate-001'
        
        // 新格式：apis 数组 [{baseUrl, apiKey, models: []}]
        if (Array.isArray(apiConfig.apis) && apiConfig.apis.length > 0) {
            return apiConfig.apis
                .filter(api => api && api.baseUrl)  // 过滤无效配置
                .map(api => ({
                    baseUrl: this.normalizeApiUrl(api.baseUrl),
                    apiKey: api.apiKey || 'X-Free',
                    model: globalModel,
                    videoModel: globalVideoModel,
                    models: api.models || []  // 保存模型列表用于状态显示
                }))
        }
        
        // 兼容旧格式：单个apiUrl
        if (apiConfig.apiUrl) {
            return [{
                baseUrl: this.normalizeApiUrl(apiConfig.apiUrl),
                apiKey: apiConfig.apiKey || 'X-Free',
                model: globalModel,
                videoModel: globalVideoModel,
                models: []
            }]
        }
        
        // 默认API
        return [{
            baseUrl: 'https://business.928100.xyz/v1/chat/completions',
            apiKey: 'X-Free',
            model: globalModel,
            videoModel: globalVideoModel,
            models: []
        }]
    }

    /**
     * 获取图片生成API配置
     * @param {number} apiIndex - API索引
     */
    getImageApiConfig(apiIndex = 0) {
        const apis = this.getApiList()
        if (apiIndex >= apis.length) return null
        
        const api = apis[apiIndex]
        return {
            apiUrl: api.baseUrl,
            apiKey: api.apiKey,
            model: api.model
        }
    }
    
    /**
     * 获取可用API数量
     */
    getApiCount() {
        return this.getApiList().length
    }

    /**
     * 调用图片生成 API（支持多API轮询和自动重试）
     */
    async generateImage({ prompt, imageUrls = [] }) {
        const startTime = Date.now()
        const maxApiRetries = this.getApiCount()  // 最多尝试的API数量
        const maxEmptyRetries = 2  // 每个API空响应时的重试次数
        
        let lastError = null
        
        // 遍历所有可用API
        for (let apiIndex = 0; apiIndex < maxApiRetries; apiIndex++) {
            const apiConf = this.getImageApiConfig(apiIndex)
            if (!apiConf) break
            
            // 每个API尝试多次（应对空响应）
            for (let retry = 0; retry <= maxEmptyRetries; retry++) {
                try {
                    if (apiIndex > 0 || retry > 0) {
                        logger.info(`[ImageGen] 图片生成重试 (API=${apiIndex}, retry=${retry})`)
                    }
                    
                    // 构建消息内容
                    const content = []
                    if (prompt) {
                        content.push({ type: 'text', text: prompt })
                    }
                    if (imageUrls.length) {
                        content.push(...imageUrls.map(url => ({
                            type: 'image_url',
                            image_url: { url }
                        })))
                    }
                    
                    const requestData = {
                        model: apiConf.model,
                        messages: [{ role: 'user', content }],
                        stream: false,
                        temperature: 0.7,
                    }
                    
                    const response = await fetch(apiConf.apiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiConf.apiKey}`,
                        },
                        body: JSON.stringify(requestData),
                        signal: AbortSignal.timeout(this.timeout),
                    })
                    
                    if (!response.ok) {
                        throw new Error(`API 错误: ${response.status}`)
                    }
                    
                    const data = await response.json()
                    const resultImages = this.extractImages(data)
                    
                    if (resultImages.length) {
                        const duration = Date.now() - startTime
                        return {
                            success: true,
                            images: resultImages,
                            duration: this.formatDuration(duration),
                            apiUsed: apiIndex > 0 ? `备用API${apiIndex}` : '主API'
                        }
                    }
                    
                    // 空响应，继续重试
                    logger.warn(`[ImageGen] API返回空图片，准备重试...`)
                    await new Promise(r => setTimeout(r, 1000))
                    
                } catch (err) {
                    lastError = err
                    if (err.name === 'TimeoutError') {
                        logger.warn(`[ImageGen] 请求超时，切换下一个API`)
                        break // 超时直接切换API
                    }
                    logger.warn(`[ImageGen] API请求失败: ${err.message}`)
                    await new Promise(r => setTimeout(r, 500))
                }
            }
        }
        
        const duration = Date.now() - startTime
        return {
            success: false,
            error: lastError?.message || '所有API均未能生成图片，请稍后重试',
            duration: this.formatDuration(duration)
        }
    }

    /**
     * 获取视频生成API配置
     * @param {number} apiIndex - API索引
     */
    getVideoApiConfig(apiIndex = 0) {
        const apis = this.getApiList()
        if (apiIndex >= apis.length) return null
        
        const api = apis[apiIndex]
        return {
            apiUrl: api.baseUrl,
            apiKey: api.apiKey,
            model: api.videoModel
        }
    }

    /**
     * 调用视频生成 API（支持多API轮询和空响应自动重试）
     */
    async generateVideo({ prompt, imageUrls = [] }) {
        const startTime = Date.now()
        const maxApiCount = this.getApiCount()
        const maxEmptyRetries = 3  // 空响应时的重试次数（视频生成需要更多重试）
        
        let lastError = null
        
        // 遍历所有可用API
        for (let apiIndex = 0; apiIndex < maxApiCount; apiIndex++) {
            const apiConf = this.getVideoApiConfig(apiIndex)
            if (!apiConf) break
            
            // 每个API尝试多次（应对空响应）
            for (let retry = 0; retry <= maxEmptyRetries; retry++) {
                try {
                    if (apiIndex > 0 || retry > 0) {
                        logger.info(`[ImageGen] 视频生成重试 (API=${apiIndex}, retry=${retry})`)
                    }
                    
                    // 构建消息内容
                    const content = []
                    if (prompt) {
                        content.push({ type: 'text', text: prompt })
                    }
                    if (imageUrls.length) {
                        content.push(...imageUrls.map(url => ({
                            type: 'image_url',
                            image_url: { url }
                        })))
                    }
                    
                    const requestData = {
                        model: apiConf.model,
                        messages: [{ role: 'user', content }],
                        stream: false,
                        temperature: 0.7,
                    }
                    
                    const response = await fetch(apiConf.apiUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiConf.apiKey}`,
                        },
                        body: JSON.stringify(requestData),
                        signal: AbortSignal.timeout(this.timeout),
                    })
                    
                    if (!response.ok) {
                        const errorText = await response.text().catch(() => '')
                        throw new Error(`API 错误: ${response.status} ${errorText.substring(0, 100)}`)
                    }
                    
                    const data = await response.json()
                    
                    // 调试日志
                    logger.debug('[ImageGen] 视频API响应:', JSON.stringify(data, null, 2))
                    
                    // 解析返回的视频
                    const resultVideos = this.extractVideos(data)
                    
                    if (resultVideos.length) {
                        const duration = Date.now() - startTime
                        return {
                            success: true,
                            videos: resultVideos,
                            duration: this.formatDuration(duration),
                            apiUsed: apiIndex > 0 ? `备用API${apiIndex}` : '主API'
                        }
                    }
                    
                    // 如果没有视频，尝试提取图片作为备选
                    const resultImages = this.extractImages(data)
                    if (resultImages.length) {
                        const duration = Date.now() - startTime
                        return {
                            success: true,
                            images: resultImages,
                            isImage: true,
                            duration: this.formatDuration(duration)
                        }
                    }
                    
                    // 空响应，等待后重试
                    logger.warn(`[ImageGen] 视频API返回空结果，等待后重试...`)
                    await new Promise(r => setTimeout(r, 2000))  // 视频需要更长等待
                    
                } catch (err) {
                    lastError = err
                    const isNetworkError = err.cause?.code === 'UND_ERR_SOCKET' || 
                                           err.message.includes('fetch failed') ||
                                           err.message.includes('socket')
                    
                    if (isNetworkError) {
                        logger.warn(`[ImageGen] 网络错误，准备重试: ${err.message}`)
                        await new Promise(r => setTimeout(r, 1500))
                        continue
                    }
                    
                    if (err.name === 'TimeoutError') {
                        logger.warn(`[ImageGen] 请求超时，切换下一个API`)
                        break // 超时直接切换API
                    }
                    
                    logger.warn(`[ImageGen] 视频API请求失败: ${err.message}`)
                    await new Promise(r => setTimeout(r, 1000))
                }
            }
        }
        
        const duration = Date.now() - startTime
        return {
            success: false,
            error: lastError?.message || '所有API均未能生成视频，请稍后重试',
            duration: this.formatDuration(duration)
        }
    }

    /**
     * 从响应中提取视频
     */
    extractVideos(data) {
        const videos = []
        const msg = data?.choices?.[0]?.message
        
        // 处理数组格式的 content
        if (Array.isArray(msg?.content)) {
            for (const item of msg.content) {
                // 视频URL格式
                if (item?.type === 'video_url' && item?.video_url?.url) {
                    videos.push(item.video_url.url)
                }
                // 文件格式
                if (item?.type === 'file' && item?.file?.url) {
                    const url = item.file.url
                    if (url.includes('.mp4') || url.includes('video')) {
                        videos.push(url)
                    }
                }
            }
        }
        
        // 处理字符串格式的 content（Markdown 视频链接）
        if (!videos.length && typeof msg?.content === 'string') {
            // 匹配视频URL
            const videoUrlRegex = /(https?:\/\/[^\s]+\.mp4[^\s]*)/gi
            let match
            while ((match = videoUrlRegex.exec(msg.content)) !== null) {
                videos.push(match[1])
            }
            
            // 匹配 Markdown 链接格式的视频
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
     * 发送视频结果
     */
    async sendVideoResult(e, result) {
        if (result.success) {
            if (result.isImage) {
                // 如果返回的是图片而非视频
                const msgs = [
                    ...result.images.map(url => segment.image(url)),
                    `⚠️ 模型返回了图片而非视频 (${result.duration})`
                ]
                await e.reply(msgs, true)
            } else {
                // 发送视频
                const msgs = []
                for (const url of result.videos) {
                    try {
                        // 尝试发送视频
                        msgs.push(segment.video(url))
                    } catch {
                        // 如果视频发送失败，发送链接
                        msgs.push(`🎬 视频链接: ${url}`)
                    }
                }
                msgs.push(`✅ 视频生成完成 (${result.duration})`)
                await e.reply(msgs, true)
            }
        } else {
            await e.reply(`❌ ${result.error}`, true)
        }
    }

    /**
     * 从响应中提取图片
     */
    extractImages(data) {
        const images = []
        const msg = data?.choices?.[0]?.message
        
        // 处理数组格式的 content
        if (Array.isArray(msg?.content)) {
            for (const item of msg.content) {
                if (item?.type === 'image_url' && item?.image_url?.url) {
                    images.push(item.image_url.url)
                }
            }
        }
        
        // 处理字符串格式的 content（Markdown 图片）
        if (!images.length && typeof msg?.content === 'string') {
            const mdImageRegex = /!\[.*?\]\((.*?)\)/g
            let match
            while ((match = mdImageRegex.exec(msg.content)) !== null) {
                let imgUrl = match[1]
                // 转换 base64 格式
                if (imgUrl.startsWith('data:image')) {
                    imgUrl = imgUrl.replace(/^data:image\/\w+;base64,/, 'base64://')
                }
                images.push(imgUrl)
            }
        }
        
        return images
    }

    /**
     * 发送结果
     */
    async sendResult(e, result) {
        if (result.success) {
            const msgs = [
                ...result.images.map(url => segment.image(url)),
                `✅ 生成完成 (${result.duration})`
            ]
            await e.reply(msgs, true)
        } else {
            await e.reply(`❌ ${result.error}`, true)
        }
    }

    /**
     * 获取所有图片 (兼容 icqq / NapCat / OneBot)
     */
    async getAllImages(e) {
        const urls = []
        const bot = e.bot || Bot
        
        // 从引用消息获取图片
        if (e.getReply || e.source || e.reply_id) {
            try {
                let source = null
                
                // 方式1: e.getReply() (TRSS/部分平台)
                if (e.getReply) {
                    source = await e.getReply()
                }
                
                // 方式2: MessageApi.getMsg() (标准化API，兼容多平台)
                if (!source && e.source?.message_id) {
                    try {
                        source = await MessageApi.getMsg(e, e.source.message_id)
                    } catch {}
                }
                
                // 方式2b: bot.getMsg() (直接调用)
                if (!source && e.source?.message_id) {
                    try {
                        if (typeof bot?.getMsg === 'function') {
                            source = await bot.getMsg(e.source.message_id)
                        }
                    } catch {}
                }
                
                // 方式3: group.getChatHistory (icqq)
                if (!source && e.source) {
                    if (e.group?.getChatHistory) {
                        const history = await e.group.getChatHistory(e.source.seq, 1)
                        source = history?.pop()
                    } else if (e.friend?.getChatHistory) {
                        const history = await e.friend.getChatHistory(e.source.time, 1)
                        source = history?.pop()
                    }
                }
                
                // 方式4: bot.pickGroup().getMsg (icqq)
                if (!source && e.source?.seq && e.group_id && bot?.pickGroup) {
                    try {
                        const group = bot.pickGroup(e.group_id)
                        if (group?.getMsg) {
                            source = await group.getMsg(e.source.seq)
                        } else if (group?.getChatHistory) {
                            const history = await group.getChatHistory(e.source.seq, 1)
                            source = history?.pop()
                        }
                    } catch {}
                }
                
                // 提取图片URL (兼容多种格式)
                const msgs = source?.message || source?.data?.message || []
                const msgArray = Array.isArray(msgs) ? msgs : []
                
                for (const m of msgArray) {
                    if (m.type === 'image') {
                        // icqq: m.url, NapCat: m.data?.url 或 m.file
                        const imgUrl = m.url || m.data?.url || m.file
                        if (imgUrl) urls.push(imgUrl)
                    }
                }
            } catch (err) {
                logger.debug('[ImageGen] 获取引用图片失败:', err.message)
            }
        }
        
        // 从当前消息获取图片 (兼容多种格式)
        const msgArray = Array.isArray(e.message) ? e.message : []
        for (const m of msgArray) {
            if (m.type === 'image') {
                const imgUrl = m.url || m.data?.url || m.file
                if (imgUrl && !urls.includes(imgUrl)) {
                    urls.push(imgUrl)
                }
            }
        }
        
        // 如果没有图片，尝试获取@用户的头像
        if (!urls.length) {
            const atSeg = msgArray.find(m => m.type === 'at')
            const atQQ = atSeg?.qq || atSeg?.data?.qq
            if (atQQ) {
                urls.push(`https://q1.qlogo.cn/g?b=qq&nk=${atQQ}&s=640`)
            } else if (e.user_id) {
                urls.push(`https://q1.qlogo.cn/g?b=qq&nk=${e.user_id}&s=640`)
            }
        }
        
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
