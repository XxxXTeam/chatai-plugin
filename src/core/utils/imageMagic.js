/**
 * 通过文件头魔数识别图片类型。
 * 覆盖 JPEG / PNG / GIF / WebP / BMP，以及 HEIC、AVIF 等 ISO-BMFF 容器
 * （偏移 4 起为 'ftyp'，品牌盒区分具体类型）。
 * 长度不足 12 字节时一律返回 null：ISO-BMFF 的品牌盒读取需要 12 字节，
 * WebP 的 'WEBP' 标记也落在偏移 8-11。
 * @param {Buffer} buffer - 图片字节
 * @returns {string|null} MIME 类型；无法识别时返回 null
 */
export function detectImageMagicBytes(buffer) {
    if (!buffer || buffer.length < 12) return null
    // JPEG: FF D8
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg'
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png'
    // GIF: 47 49 46
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif'
    // WebP: RIFF....WEBP
    if (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    ) {
        return 'image/webp'
    }
    // BMP: 42 4D
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
    // HEIC/AVIF 等 ISO-BMFF 容器：偏移 4 起为 'ftyp'，品牌盒区分具体类型
    if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
        const brand = buffer.toString('latin1', 8, 12).toLowerCase()
        if (brand.startsWith('avif') || brand.startsWith('avis')) return 'image/avif'
        if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('hevc')) return 'image/heic'
    }
    return null
}
