import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { redisClient } from '../../core/cache/RedisClient.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Image Service - Handle image uploads and processing
 */
export class ImageService {
    constructor() {
        this.storagePath = path.join(__dirname, '../../../data/images')
        this.maxSize = 10 * 1024 * 1024 // 10MB
        this.allowedFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp']
        this.allowedFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp']

        this.init()
    }

    /**
     * Initialize storage directory
     */
    init() {
        if (!fs.existsSync(this.storagePath)) {
            fs.mkdirSync(this.storagePath, { recursive: true })
        }
    }

    /**
     * Upload and process image
     * @param {Buffer} buffer - Image buffer
     * @param {string} originalName - Original filename
     * @returns {Promise<Object>} Image metadata
     */
    async uploadImage(buffer, originalName = 'image.png') {
        // Validate size
        if (buffer.length > this.maxSize) {
            throw new Error(`Image size exceeds maximum allowed size of ${this.maxSize / 1024 / 1024}MB`)
        }

        // Generate unique ID
        const id = crypto.randomBytes(16).toString('hex')
        const ext = path.extname(originalName).toLowerCase().replace('.', '') || 'png'

        // Validate format
        if (!this.allowedFormats.includes(ext)) {
            throw new Error(`Unsupported image format: ${ext}`)
        }

        // Process image with sharp
        const image = sharp(buffer)
        const metadata = await image.metadata()

        // Save original
        const filename = `${id}.${ext}`
        const filepath = path.join(this.storagePath, filename)
        await image.toFile(filepath)

        // Create thumbnail
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

        // Cache metadata
        // Cache metadata (24 hours)
        await redisClient.set(`image:${id}`, JSON.stringify(imageData), 86400)

        return imageData
    }

    /**
     * Get image by ID
     * @param {string} id
     * @returns {Object|null}
     */
    async getImage(id) {
        // Check cache
        const cached = await redisClient.get(`image:${id}`)
        if (cached) {
            try {
                return JSON.parse(cached)
            } catch (e) {
                // Ignore
            }
        }

        // Try to find file
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
     * Get image buffer
     * @param {string} id
     * @returns {Buffer|null}
     */
    async getImageBuffer(id) {
        const image = await this.getImage(id)
        if (!image) return null

        const filepath = path.join(this.storagePath, image.filename)
        return fs.readFileSync(filepath)
    }

    /**
     * Get image as base64
     * @param {string} id
     * @param {string} format - Output format (jpeg, png, webp)
     * @returns {Promise<string>} Base64 encoded image
     */
    async getImageBase64(id, format = 'jpeg') {
        const buffer = await this.getImageBuffer(id)
        if (!buffer) return null

        // Convert to desired format
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
     * Download image from URL
     * @param {string} url
     * @returns {Promise<Object>} Image metadata
     */
    async downloadImage(url) {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.statusText}`)
        }

        const buffer = Buffer.from(await response.arrayBuffer())
        const urlPath = new URL(url).pathname
        const originalName = path.basename(urlPath) || 'downloaded_image.jpg'

        return await this.uploadImage(buffer, originalName)
    }

    /**
     * Convert image URL to base64 for API usage
     * @param {string} url
     * @returns {Promise<string>}
     */
    async urlToBase64(url) {
        const imageData = await this.downloadImage(url)
        return await this.getImageBase64(imageData.id)
    }

    /**
     * Delete image
     * @param {string} id
     * @returns {boolean}
     */
    async deleteImage(id) {
        const image = await this.getImage(id)
        if (!image) return false

        try {
            // Delete main image
            const filepath = path.join(this.storagePath, image.filename)
            if (fs.existsSync(filepath)) {
                fs.unlinkSync(filepath)
            }

            // Delete thumbnail
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
     * Clean up old images (older than 7 days)
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
     * Process Yunzai image message segments
     * @param {Array} segments - Message segments from Yunzai
     * @returns {Promise<Array>} Processed image content
     */
    /**
     * Process Yunzai image message segments
     * @param {Array} segments - Message segments from Yunzai
     * @returns {Promise<Array>} Processed image content
     */
    async processYunzaiImages(segments) {
        const imageContents = []

        for (const segment of segments) {
            if (segment.type === 'image') {
                try {
                    let imageUrl = segment.file || segment.url
                    let base64 = ''

                    // Handle base64 images
                    if (imageUrl && imageUrl.startsWith('base64://')) {
                        const base64Data = imageUrl.replace('base64://', '')
                        const buffer = Buffer.from(base64Data, 'base64')
                        const uploaded = await this.uploadImage(buffer, 'yunzai_image.png')
                        base64 = await this.getImageBase64(uploaded.id, 'jpeg')
                    }
                    // Handle URL images
                    else if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
                        base64 = await this.urlToBase64(imageUrl)
                    }
                    // Handle local file paths
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
     * Convert image for API usage (ensure format and size limits)
     * @param {string} imageId
     * @param {string} targetFormat
     * @returns {Promise<string>} Base64 string
     */
    async convertForApi(imageId, targetFormat = 'jpeg') {
        return await this.getImageBase64(imageId, targetFormat)
    }

    /**
     * Compress image
     * @param {string} imageId - Image ID
     * @param {Object} options - Compression options
     * @param {number} [options.quality=80] - Quality (1-100)
     * @param {number} [options.maxWidth] - Max width
     * @param {number} [options.maxHeight] - Max height
     * @param {string} [options.format='jpeg'] - Output format
     * @returns {Promise<Object>} - New image data
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

        // Resize if dimensions specified
        if (maxWidth || maxHeight) {
            processor = processor.resize(maxWidth, maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            })
        }

        // Convert and compress
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

        // Save compressed version
        const newImageData = await this.uploadImage(compressedBuffer, `compressed.${format}`)

        return {
            ...newImageData,
            originalSize,
            newSize,
            reduction: `${reduction}%`
        }
    }

    /**
     * Convert image format
     * @param {string} imageId - Image ID
     * @param {string} targetFormat - Target format (jpeg, png, webp)
     * @returns {Promise<Object>} - New image data
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

        // Upload converted image
        return await this.uploadImage(convertedBuffer, `converted.${targetFormat}`)
    }

    /**
     * Resize image
     * @param {string} imageId - Image ID
     * @param {number} width - Target width
     * @param {number} height - Target height
     * @param {string} [fit='inside'] - Fit mode (cover, contain, fill, inside, outside)
     * @returns {Promise<Object>} - New image data
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
     * 切割网格图片（用于表情包等）
     * @param {Buffer|string} input - 图片Buffer或URL
     * @param {Object} options - 切割选项
     * @param {number} [options.cols=5] - 列数
     * @param {number} [options.rows=4] - 行数
     * @param {number} [options.padding=0] - 内边距（像素）
     * @param {boolean} [options.autoPadding=false] - 是否自动检测边距（默认关闭，AI生成图片通常不需要）
     * @returns {Promise<Buffer[]>} 切割后的图片Buffer数组
     */
    async splitGridImage(input, options = {}) {
        const { cols = 5, rows = 4, autoPadding = false } = options
        let { padding = 0 } = options
        
        let buffer
        if (Buffer.isBuffer(input)) {
            buffer = input
        } else if (typeof input === 'string') {
            if (input.startsWith('http://') || input.startsWith('https://')) {
                const response = await fetch(input)
                if (!response.ok) throw new Error(`下载图片失败: ${response.status}`)
                buffer = Buffer.from(await response.arrayBuffer())
            } else if (input.startsWith('base64://')) {
                buffer = Buffer.from(input.replace('base64://', ''), 'base64')
            } else if (input.startsWith('data:image')) {
                const base64Data = input.split(',')[1]
                buffer = Buffer.from(base64Data, 'base64')
            } else {
                throw new Error('不支持的图片格式')
            }
        } else {
            throw new Error('输入必须是Buffer或URL字符串')
        }

        const image = sharp(buffer)
        const metadata = await image.metadata()
        const { width, height } = metadata

        // 自动估算边距（AI生成的表情包通常有约2-5%的边距）
        if (autoPadding && padding === 0) {
            padding = Math.round(Math.min(width, height) * 0.02)
        }

        const cellWidth = Math.floor((width - padding * 2) / cols)
        const cellHeight = Math.floor((height - padding * 2) / rows)
        
        logger.debug(`[ImageService] 切割参数: ${cols}x${rows}, 图片${width}x${height}, 单元格${cellWidth}x${cellHeight}, 边距${padding}`)

        const results = []
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const left = padding + col * cellWidth
                const top = padding + row * cellHeight
                
                try {
                    const cellBuffer = await sharp(buffer)
                        .extract({
                            left,
                            top,
                            width: cellWidth,
                            height: cellHeight
                        })
                        .png()
                        .toBuffer()
                    
                    results.push(cellBuffer)
                } catch (err) {
                    logger.warn(`[ImageService] 切割单元格失败 [${row},${col}]:`, err.message)
                }
            }
        }

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
     * Extract text from image (OCR)
     * @param {string} id Image ID
     * @param {string} [lang='eng'] Language code
     * @returns {Promise<string>} Extracted text
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

// Export singleton
export const imageService = new ImageService()
