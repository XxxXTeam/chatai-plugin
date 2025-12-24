import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { redisClient } from '../../core/cache/RedisClient.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)


const urlValidationCache = new Map()
const URL_CACHE_TTL = 5 * 60 * 1000 // 5分钟

/**
 * 图片服务 - 处理图片上传和加工
 */
export class ImageService {
    constructor() {
        this.storagePath = path.join(__dirname, '../../../data/images')
        this.maxSize = 10 * 1024 * 1024 // 10MB
        this.allowedFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp']

        this.init()
    }

    /**
     * 初始化存储目录
     */
    init() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true })
        }
    }

    /**
     * 上传并处理图片
     * @param {Buffer} buffer - 图片缓冲区
     * @param {string} originalName - 原始文件名
     * @returns {Promise<Object>} 图片元数据
     */
    async uploadImage(buffer, originalName = 'image.png') {
        // 验证大小
        if (buffer.length > this.maxSize) {
            throw new Error(`Image size exceeds maximum allowed size of ${this.maxSize / 1024 / 1024}MB`)
        }

        // 生成唯一ID
        const id = crypto.randomBytes(16).toString('hex')
        const ext = path.extname(originalName).toLowerCase().replace('.', '') || 'png'

        // 验证格式
        if (!this.allowedFormats.includes(ext)) {
            throw new Error(`Unsupported image format: ${ext}`)
        }

        // 使用sharp处理图片
        const image = sharp(buffer)
        const metadata = await image.metadata()

        // 保存原图
        const filename = `${id}.${ext}`
        const filepath = path.join(this.storagePath, filename)
        await image.toFile(filepath)

        // 创建缩略图
        const thumbnailFilename = `${id}_thumb.webp`
        const thumbnailPath = path.join(this.storagePath, thumbnailFilename)
        await sharp(buffer)
            .resize(200, 200, { fit: 'inside' })
            .webp({ quality: 80 })
            .toFile(thumbnailPath)

        const imageData = {
            id,
            filename,
            thumbnailFilename,
            originalName,
            format: metadata.format,
            width: metadata.width,
            height: metadata.height,
            size: buffer.length,
            uploadedAt: Date.now()
        }

        // 缓存元数据（24小时）
        await redisClient.set(`image:${id}`, JSON.stringify(imageData), 86400)

        return imageData
    }

    /**
     * 根据ID获取图片
     * @param {string} id - 图片ID
     * @returns {Object|null} 图片信息或null
     */
    async getImage(id) {
        // 检查缓存
        const cached = await redisClient.get(`image:${id}`)
        if (cached) {
            try {
                return JSON.parse(cached)
            } catch (e) {
                // 忽略错误
            }
        }

        // 尝试查找文件
        const files = fs.readdirSync(this.storagePath)
        const imageFile = files.find(f => f.startsWith(id) && !f.includes('_thumb'))

        if (!imageFile) return null

        const filepath = path.join(this.storagePath, imageFile)
        const stats = fs.statSync(filepath)

        const imageData = {
            id,
            filename: imageFile,
            size: stats.size,
            filepath
        }

        await redisClient.set(`image:${id}`, JSON.stringify(imageData), 86400)
        return imageData
    }

    /**
     * 获取图片缓冲区
     * @param {string} id - 图片ID
     * @returns {Buffer|null} 图片缓冲区或null
     */
    async getImageBuffer(id) {
        const image = await this.getImage(id)
        if (!image) return null

        const filepath = path.join(this.storagePath, image.filename)
        return fs.readFileSync(filepath)
    }

    /**
     * 获取图片的base64编码
     * @param {string} id - 图片ID
     * @param {string} format - 输出格式 (jpeg, png, webp)
     * @returns {Promise<string>} Base64编码的图片
     */
    async getImageBase64(id, format = 'jpeg') {
        const buffer = await this.getImageBuffer(id)
        if (!buffer) return null

        // 转换为目标格式
        let processedBuffer = buffer
        if (format !== 'original') {
            processedBuffer = await sharp(buffer)
                .toFormat(format)
                .toBuffer()
        }

        const mimeType = format === 'png' ? 'image/png' :
            format === 'webp' ? 'image/webp' : 'image/jpeg'

        return `data:${mimeType};base64,${processedBuffer.toString('base64')}`
    }

    /**
     * 验证图片URL是否可访问
     * @param {string} url - 图片URL
     * @param {number} timeout - 超时时间(ms)
     * @returns {Promise<{valid: boolean, error?: string, contentType?: string, size?: number}>}
     */
    async validateImageUrl(url, timeout = 10000) {
        if (!url || typeof url !== 'string') {
            return { valid: false, error: '无效的URL' }
        }

        // base64格式直接有效
        if (url.startsWith('base64://') || url.startsWith('data:image')) {
            return { valid: true, isBase64: true }
        }

        // 本地文件检查
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            if (fs.existsSync(url)) {
                return { valid: true, isLocal: true }
            }
            return { valid: false, error: '本地文件不存在' }
        }

        // 检查缓存
        const cacheKey = `url_valid:${url}`
        const cached = urlValidationCache.get(cacheKey)
        if (cached && Date.now() - cached.time < URL_CACHE_TTL) {
            return cached.result
        }

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)

            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            })

            clearTimeout(timeoutId)

            if (!response.ok) {
                // HEAD失败，尝试GET（某些服务器不支持HEAD）
                const getResponse = await fetch(url, {
                    method: 'GET',
                    signal: AbortSignal.timeout(timeout),
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Range': 'bytes=0-1024' // 只获取前1KB验证
                    }
                })
                
                if (!getResponse.ok && getResponse.status !== 206) {
                    const result = { valid: false, error: `HTTP ${getResponse.status}` }
                    urlValidationCache.set(cacheKey, { result, time: Date.now() })
                    return result
                }
            }

            const contentType = response.headers.get('content-type') || ''
            const contentLength = response.headers.get('content-length')

            // 验证是否为图片类型
            const isImage = contentType.startsWith('image/') || 
                           url.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/i)

            const result = {
                valid: isImage,
                contentType,
                size: contentLength ? parseInt(contentLength) : undefined,
                error: isImage ? undefined : '非图片类型'
            }

            urlValidationCache.set(cacheKey, { result, time: Date.now() })
            return result
        } catch (err) {
            const result = { 
                valid: false, 
                error: err.name === 'AbortError' ? '请求超时' : err.message 
            }
            urlValidationCache.set(cacheKey, { result, time: Date.now() })
            return result
        }
    }

    /**
     * 下载图片并转为Buffer
     * @param {string} url - 图片URL
     * @param {number} timeout - 超时时间(ms)
     * @returns {Promise<Buffer>}
     */
    async downloadImageBuffer(url, timeout = 30000) {
        if (!url || typeof url !== 'string') {
            throw new Error('无效的URL')
        }

        // base64格式
        if (url.startsWith('base64://')) {
            return Buffer.from(url.replace('base64://', ''), 'base64')
        }
        if (url.startsWith('data:image')) {
            const base64Data = url.split(',')[1]
            return Buffer.from(base64Data, 'base64')
        }

        // 本地文件
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            if (fs.existsSync(url)) {
                return fs.readFileSync(url)
            }
            throw new Error('本地文件不存在')
        }

        // HTTP下载
        const response = await fetch(url, {
            signal: AbortSignal.timeout(timeout),
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })

        if (!response.ok) {
            throw new Error(`下载失败: HTTP ${response.status}`)
        }

        return Buffer.from(await response.arrayBuffer())
    }

    /**
     * 从URL下载图片
     * @param {string} url - 图片URL
     * @returns {Promise<Object>} 图片元数据
     */
    async downloadImage(url) {
        const buffer = await this.downloadImageBuffer(url)
        let originalName = 'downloaded_image.jpg'
        
        try {
            if (url.startsWith('http')) {
                const urlPath = new URL(url).pathname
                originalName = path.basename(urlPath) || originalName
            }
        } catch {}

        return await this.uploadImage(buffer, originalName)
    }

    /**
     * 将图片URL转换为base64用于API调用
     * @param {string} url - 图片URL
     * @returns {Promise<string>} base64编码的图片
     */
    async urlToBase64(url) {
        // 已经是base64格式
        if (url.startsWith('base64://')) {
            const base64Data = url.replace('base64://', '')
            return `data:image/jpeg;base64,${base64Data}`
        }
        if (url.startsWith('data:image')) {
            return url
        }

        const imageData = await this.downloadImage(url)
        return await this.getImageBase64(imageData.id)
    }

    /**
     * 准备图片用于API调用（验证URL并在需要时转为base64）
     * @param {string} url - 图片URL
     * @param {Object} options - 选项
     * @param {boolean} options.forceBase64 - 强制转为base64
     * @param {number} options.timeout - 超时时间
     * @returns {Promise<{url: string, converted: boolean, error?: string}>}
     */
    async prepareImageForApi(url, options = {}) {
        const { forceBase64 = false, timeout = 15000 } = options

        if (!url) {
            return { url: '', converted: false, error: '空URL' }
        }

        // 已经是base64，直接返回
        if (url.startsWith('data:image')) {
            return { url, converted: false }
        }
        if (url.startsWith('base64://')) {
            const base64Data = url.replace('base64://', '')
            return { url: `data:image/jpeg;base64,${base64Data}`, converted: true }
        }

        // 本地文件直接转base64
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            try {
                if (fs.existsSync(url)) {
                    const buffer = fs.readFileSync(url)
                    const base64 = buffer.toString('base64')
                    const ext = path.extname(url).toLowerCase().replace('.', '') || 'jpeg'
                    const mimeType = ext === 'png' ? 'image/png' : 
                                    ext === 'gif' ? 'image/gif' : 
                                    ext === 'webp' ? 'image/webp' : 'image/jpeg'
                    return { url: `data:${mimeType};base64,${base64}`, converted: true }
                }
            } catch (err) {
                logger.warn('[ImageService] 读取本地文件失败:', err.message)
            }
            return { url: '', converted: false, error: '本地文件不存在' }
        }

        // 强制转base64
        if (forceBase64) {
            try {
                const base64Url = await this.urlToBase64(url)
                return { url: base64Url, converted: true }
            } catch (err) {
                return { url: '', converted: false, error: err.message }
            }
        }

        // 验证URL可访问性
        const validation = await this.validateImageUrl(url, timeout)
        
        if (validation.valid) {
            // QQ头像等特殊URL可能需要转base64才能被外部API访问
            const needsConversion = this.shouldConvertToBase64(url)
            
            if (needsConversion) {
                try {
                    const base64Url = await this.urlToBase64(url)
                    logger.debug('[ImageService] URL需要转换:', url.substring(0, 50))
                    return { url: base64Url, converted: true }
                } catch (err) {
                    logger.warn('[ImageService] 转base64失败，使用原URL:', err.message)
                    return { url, converted: false }
                }
            }
            
            return { url, converted: false }
        }

        // URL不可访问，尝试转base64
        logger.warn('[ImageService] URL不可访问，尝试转base64:', url.substring(0, 80), validation.error)
        try {
            const base64Url = await this.urlToBase64(url)
            return { url: base64Url, converted: true }
        } catch (err) {
            logger.error('[ImageService] 转base64也失败:', err.message)
            return { url: '', converted: false, error: `无法获取图片: ${validation.error}` }
        }
    }

    /**
     * 批量准备图片用于API
     * @param {string[]} urls - 图片URL数组
     * @param {Object} options - 选项
     * @returns {Promise<{urls: string[], errors: string[]}>}
     */
    async prepareImagesForApi(urls, options = {}) {
        const results = await Promise.all(
            urls.map(url => this.prepareImageForApi(url, options))
        )

        const validUrls = []
        const errors = []

        for (let i = 0; i < results.length; i++) {
            const result = results[i]
            if (result.url) {
                validUrls.push(result.url)
            } else if (result.error) {
                errors.push(`图片${i + 1}: ${result.error}`)
            }
        }

        return { urls: validUrls, errors }
    }

    /**
     * 判断URL是否需要转为base64（内网/特殊域名）
     * @param {string} url
     * @returns {boolean}
     */
    shouldConvertToBase64(url) {
        if (!url || !url.startsWith('http')) return false
        
        const needConvertPatterns = [
            /qlogo\.cn/i,           // QQ头像
            /gchat\.qpic\.cn/i,     // QQ图片
            /c2cpicdw\.qpic\.cn/i,  // QQ私聊图片
            /p\.qpic\.cn/i,         // QQ其他图片
            /multimedia\.nt\.qq\.com/i, // NTQQ多媒体
            /localhost/i,           // 本地服务
            /127\.0\.0\.1/,         // 本地IP
            /192\.168\./,           // 内网IP
            /10\./,                 // 内网IP
            /172\.(1[6-9]|2[0-9]|3[01])\./  // 内网IP
        ]
        
        return needConvertPatterns.some(pattern => pattern.test(url))
    }

    /**
     * 删除图片
     * @param {string} id - 图片ID
     * @returns {boolean} 是否删除成功
     */
    async deleteImage(id) {
        const image = await this.getImage(id)
        if (!image) return false

        try {
            // 删除主图片
            const filepath = path.join(this.storagePath, image.filename)
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath)
            }

            // 删除缩略图
            if (image.thumbnailFilename) {
                const thumbPath = path.join(this.storagePath, image.thumbnailFilename)
                if (fs.existsSync(thumbPath)) {
                    fs.unlinkSync(thumbPath)
                }
            }

            await redisClient.del(`image:${id}`)
            return true
        } catch (error) {
            logger.error(`[ImageService] Failed to delete image ${id}:`, error)
            return false
        }
    }

    /**
     * 清理旧图片（超过7天）
     */
    async cleanupOldImages() {
        const files = fs.readdirSync(this.storagePath)
        const now = Date.now()
        const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days

        let cleaned = 0
        for (const file of files) {
            const filepath = path.join(this.storagePath, file)
            const stats = fs.statSync(filepath)

            if (now - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filepath)
                cleaned++
            }
        }

        logger.info(`[ImageService] Cleaned up ${cleaned} old images`)
        return cleaned
    }

    /**
     * 处理Yunzai图片消息段
     * @param {Array} segments - Yunzai的消息段
     * @returns {Promise<Array>} 处理后的图片内容
     */
    async processYunzaiImages(segments) {
        const imageContents = []

        for (const segment of segments) {
            if (segment.type === 'image') {
                try {
                    let imageUrl = segment.file || segment.url
                    let base64 = ''

                    // 处理base64图片
                    if (imageUrl && imageUrl.startsWith('base64://')) {
                        const base64Data = imageUrl.replace('base64://', '')
                        const buffer = Buffer.from(base64Data, 'base64')
                        const uploaded = await this.uploadImage(buffer, 'yunzai_image.png')
                        base64 = await this.getImageBase64(uploaded.id, 'jpeg')
                    }
                    // 处理URL图片
                    else if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
                        base64 = await this.urlToBase64(imageUrl)
                    }
                    // 处理本地文件路径
                    else if (imageUrl && fs.existsSync(imageUrl)) {
                        const buffer = fs.readFileSync(imageUrl)
                        const uploaded = await this.uploadImage(buffer, path.basename(imageUrl))
                        base64 = await this.getImageBase64(uploaded.id, 'jpeg')
                    }

                    if (base64) {
                        imageContents.push({
                            type: 'image_url',
                            image_url: {
                                url: base64
                            }
                        })
                    }
                } catch (error) {
                    logger.error('[ImageService] Failed to process image:', error)
                }
            }
        }

        return imageContents
    }

    /**
     * 转换图片用于API调用（确保格式和大小限制）
     * @param {string} imageId - 图片ID
     * @param {string} targetFormat - 目标格式
     * @returns {Promise<string>} Base64字符串
     */
    async convertForApi(imageId, targetFormat = 'jpeg') {
        return await this.getImageBase64(imageId, targetFormat)
    }

    /**
     * 压缩图片
     * @param {string} imageId - 图片ID
     * @param {Object} options - 压缩选项
     * @param {number} [options.quality=80] - 质量 (1-100)
     * @param {number} [options.maxWidth] - 最大宽度
     * @param {number} [options.maxHeight] - 最大高度
     * @param {string} [options.format='jpeg'] - 输出格式
     * @returns {Promise<Object>} 新图片数据
     */
    async compressImage(imageId, options = {}) {
        const {
            quality = 80,
            maxWidth,
            maxHeight,
            format = 'jpeg'
        } = options

        const buffer = await this.getImageBuffer(imageId)
        if (!buffer) {
            throw new Error('Image not found')
        }

        let processor = sharp(buffer)

        // 如果指定了尺寸则调整大小
        if (maxWidth || maxHeight) {
            processor = processor.resize(maxWidth, maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            })
        }

        // 转换并压缩
        if (format === 'jpeg' || format === 'jpg') {
            processor = processor.jpeg({ quality })
        } else if (format === 'png') {
            processor = processor.png({ quality })
        } else if (format === 'webp') {
            processor = processor.webp({ quality })
        }

        const compressedBuffer = await processor.toBuffer()
        const originalSize = buffer.length
        const newSize = compressedBuffer.length
        const reduction = ((originalSize - newSize) / originalSize * 100).toFixed(2)

        // 保存压缩版本
        const newImageData = await this.uploadImage(compressedBuffer, `compressed.${format}`)

        return {
            ...newImageData,
            originalSize,
            newSize,
            reduction: `${reduction}%`
        }
    }

    /**
     * 转换图片格式
     * @param {string} imageId - 图片ID
     * @param {string} targetFormat - 目标格式 (jpeg, png, webp)
     * @returns {Promise<Object>} 新图片数据
     */
    async convertFormat(imageId, targetFormat) {
        const allowedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif']
        if (!allowedFormats.includes(targetFormat.toLowerCase())) {
            throw new Error(`Unsupported format: ${targetFormat}`)
        }

        const buffer = await this.getImageBuffer(imageId)
        if (!buffer) {
            throw new Error('Image not found')
        }

        let convertedBuffer
        if (targetFormat === 'jpeg' || targetFormat === 'jpg') {
            convertedBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
        } else if (targetFormat === 'png') {
            convertedBuffer = await sharp(buffer).png().toBuffer()
        } else if (targetFormat === 'webp') {
            convertedBuffer = await sharp(buffer).webp({ quality: 90 }).toBuffer()
        } else if (targetFormat === 'gif') {
            convertedBuffer = await sharp(buffer).gif().toBuffer()
        }

        // 上传转换后的图片
        return await this.uploadImage(convertedBuffer, `converted.${targetFormat}`)
    }

    /**
     * 调整图片大小
     * @param {string} imageId - 图片ID
     * @param {number} width - 目标宽度
     * @param {number} height - 目标高度
     * @param {string} [fit='inside'] - 适应模式 (cover, contain, fill, inside, outside)
     * @returns {Promise<Object>} 新图片数据
     */
    async resizeImage(imageId, width, height, fit = 'inside') {
        const buffer = await this.getImageBuffer(imageId)
        if (!buffer) {
            throw new Error('Image not found')
        }

        const resizedBuffer = await sharp(buffer)
            .resize(width, height, { fit })
            .toBuffer()

        return await this.uploadImage(resizedBuffer, `resized_${width}x${height}.jpg`)
    }

    /**
     * 切割网格图片
     * @param {Buffer|string} input - 图片Buffer或URL
     * @param {Object} options - 切割选项
     * @param {number} [options.cols=6] - 列数（会被分成两个半边）
     * @param {number} [options.rows=4] - 行数
     * @param {number} [options.shrinkPercent=2] - 每边收缩百分比(0-20)，用于去除单元格间的间隙
     * @returns {Promise<Buffer[]>} 切割后的图片Buffer数组
     */
    async splitGridImage(input, options = {}) {
        const { cols = 6, rows = 4, shrinkPercent = 2 } = options
        
        // 获取图片Buffer
        let buffer
        if (Buffer.isBuffer(input)) {
            buffer = input
        } else if (typeof input === 'string') {
            try {
                buffer = await this.downloadImageBuffer(input)
            } catch (err) {
                logger.error('[ImageService] 下载切割图片失败:', err.message)
                throw new Error(`获取图片失败: ${err.message}`)
            }
        } else {
            throw new Error('输入必须是Buffer或URL字符串')
        }

        // 验证图片数据
        if (!buffer || buffer.length === 0) {
            throw new Error('图片数据为空')
        }

        let metadata
        try {
            const image = sharp(buffer)
            metadata = await image.metadata()
        } catch (err) {
            logger.error('[ImageService] 解析图片元数据失败:', err.message)
            throw new Error(`图片格式无效: ${err.message}`)
        }

        const { width, height } = metadata
        
        if (!width || !height || width < cols || height < rows) {
            throw new Error(`图片尺寸无效: ${width}x${height}，无法切割为 ${cols}x${rows}`)
        }
        const halfCols = cols / 2
        const halfWidth = width / 2
        const cellWidth = halfWidth / halfCols
        const cellHeight = height / rows
        const shrinkX = Math.round(cellWidth * Math.min(shrinkPercent, 20) / 100)
        const shrinkY = Math.round(cellHeight * Math.min(shrinkPercent, 20) / 100)
        const extractWidth = Math.floor(cellWidth - shrinkX * 2)
        const extractHeight = Math.floor(cellHeight - shrinkY * 2)
        if (extractWidth < 10 || extractHeight < 10) {
            throw new Error(`计算的单元格尺寸过小: ${extractWidth}x${extractHeight}`)
        }
        
        logger.debug(`[ImageService] 切割参数: ${cols}x${rows}, 图片${width}x${height}, 半边${halfCols}列, 格子${Math.round(cellWidth)}x${Math.round(cellHeight)}, 提取${extractWidth}x${extractHeight}`)

        const results = []
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // 判断在左半边还是右半边
                const isRightHalf = col >= halfCols
                const localCol = isRightHalf ? col - halfCols : col
                const baseX = isRightHalf ? halfWidth : 0
                
                // 计算该格子的中心位置
                const centerX = baseX + (localCol + 0.5) * cellWidth
                const centerY = (row + 0.5) * cellHeight
                
                // 从中心向外扩展提取区域
                const left = Math.round(centerX - extractWidth / 2)
                const top = Math.round(centerY - extractHeight / 2)
                
                // 边界保护
                const safeLeft = Math.max(0, Math.min(left, width - extractWidth))
                const safeTop = Math.max(0, Math.min(top, height - extractHeight))
                
                if (extractWidth <= 0 || extractHeight <= 0) {
                    logger.warn(`[ImageService] 跳过无效单元格 [${row},${col}]`)
                    continue
                }
                
                try {
                    const cellBuffer = await sharp(buffer)
                        .extract({
                            left: safeLeft,
                            top: safeTop,
                            width: extractWidth,
                            height: extractHeight
                        })
                        .png()
                        .toBuffer()
                    
                    results.push(cellBuffer)
                } catch (err) {
                    logger.warn(`[ImageService] 切割单元格失败 [${row},${col}]: ${err.message}`)
                }
            }
        }

        if (results.length === 0) {
            throw new Error('切割失败：未能生成任何单元格')
        }

        logger.info(`[ImageService] 切割完成: 成功 ${results.length}/${cols * rows} 个`)
        return results
    }

    /**
     * 切割表情包图片并返回base64数组
     * @param {Buffer|string} input - 图片Buffer或URL
     * @param {Object} options - 切割选项
     * @returns {Promise<string[]>} base64图片数组
     */
    async splitEmojiGrid(input, options = {}) {
        const buffers = await this.splitGridImage(input, options)
        return buffers.map(buf => `base64://${buf.toString('base64')}`)
    }

    /**
     * 从图片中提取文字 (OCR)
     * @param {string} id - 图片ID
     * @param {string} [lang='eng'] - 语言代码
     * @returns {Promise<string>} 提取的文字
     */
    async extractText(id, lang = 'eng') {
        const image = await this.getImage(id)
        if (!image) {
            throw new Error('Image not found')
        }

        const filePath = path.join(this.uploadDir, image.filename)

        try {
            const { createWorker } = await import('tesseract.js')
            const worker = await createWorker(lang)
            const { data: { text } } = await worker.recognize(filePath)
            await worker.terminate()
            return text
        } catch (error) {
            logger.error('[ImageService] OCR failed:', error)
            throw error
        }
    }
}

// 导出单例
export const imageService = new ImageService()
