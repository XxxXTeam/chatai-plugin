/**
 * AI 图片生成插件
 * 支持文生图、图生图和预设提示词模式
 * 使用 Gemini 图片生成模型
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
            dsc: 'AI图片生成 - 文生图/图生图',
            event: 'message',
            priority: 50,
            rule: [
                { reg: /^#?文生图\s*(.+)$/s, fnc: 'text2img' },
                { reg: /^#?图生图\s*(.*)$/s, fnc: 'img2img' },
                { reg: presetReg, fnc: 'presetHandler' },
            ]
        })
        
        this.timeout = 360000 // 6分钟超时
        this.maxImages = 3
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
     * 调用图片生成 API
     */
    async generateImage({ prompt, imageUrls = [] }) {
        const apiConfig = config.get('features.imageGen') || {}
        const apiUrl = apiConfig.apiUrl || 'https://business.928100.xyz/v1/chat/completions'
        const apiKey = apiConfig.apiKey || 'X-Free'
        const model = apiConfig.model || 'gemini-3-pro-image'
        
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
            model,
            messages: [{ role: 'user', content }],
            stream: false,
            temperature: 0.7,
        }
        
        const startTime = Date.now()
        
        try {
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify(requestData),
                signal: AbortSignal.timeout(this.timeout),
            })
            
            if (!response.ok) {
                throw new Error(`API 错误: ${response.status}`)
            }
            
            const data = await response.json()
            const duration = Date.now() - startTime
            
            // 解析返回的图片
            const resultImages = this.extractImages(data)
            
            if (resultImages.length) {
                return {
                    success: true,
                    images: resultImages,
                    duration: this.formatDuration(duration)
                }
            }
            
            return {
                success: false,
                error: '未能生成图片，请重试',
                duration: this.formatDuration(duration)
            }
        } catch (err) {
            const duration = Date.now() - startTime
            if (err.name === 'TimeoutError') {
                return { success: false, error: '请求超时，请重试', duration: this.formatDuration(duration) }
            }
            throw err
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
