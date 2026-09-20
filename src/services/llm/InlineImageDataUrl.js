/**
 * 将 messageParser 生成的内联图片对象规范化为 data URL。
 *
 * @param {Object} imageRef - `{ type: 'image', image, mimeType }` 图片引用
 * @returns {string|null} 内联图片 data URL
 */
const BASE64_CONTENT_RE = /^[A-Za-z0-9+/]+={0,2}$/

/**
 * 判断去掉空白后是否为合法 base64 内容（不校验解码长度）。
 * @param {string} value - 候选字符串
 * @returns {boolean}
 */
function looksLikeBase64(value) {
    // 行内 base64 容许少量空白与换行（历史上来自消息段拼接）
    return BASE64_CONTENT_RE.test(value.replace(/\s+/g, ''))
}

export function normalizeInlineImageDataUrl(imageRef) {
    if (imageRef?.type !== 'image' || typeof imageRef.image !== 'string') return null

    const image = imageRef.image.trim()
    if (!image) return null
    if (image.startsWith('data:image/')) return image
    if (/^image\/[a-z0-9.+-]+;base64,/i.test(image)) {
        return `data:${image}`
    }
    if (image.startsWith('base64://')) {
        const mimeType =
            typeof imageRef.mimeType === 'string' && /^image\/[a-z0-9.+-]+$/i.test(imageRef.mimeType)
                ? imageRef.mimeType
                : 'image/jpeg'
        return `data:${mimeType};base64,${image.slice('base64://'.length)}`
    }
    if (image.startsWith('base64:')) {
        const raw = image.slice('base64:'.length)
        if (raw.startsWith('data:')) return raw
        if (/^https?:\/\//i.test(raw) || raw.startsWith('file://')) return null
        return looksLikeBase64(raw) ? image : null
    }
    if (/^https?:\/\//i.test(image) || image.startsWith('file://')) {
        return null
    }
    if (!looksLikeBase64(image)) return null

    const mimeType =
        typeof imageRef.mimeType === 'string' && /^image\/[a-z0-9.+-]+$/i.test(imageRef.mimeType)
            ? imageRef.mimeType
            : 'image/jpeg'
    const base64 = image.startsWith('base64://') ? image.slice('base64://'.length) : image

    return `data:${mimeType};base64,${base64}`
}

/**
 * 将内联图片引用转换为适配器无关的内部图片内容块。
 *
 * @param {Object} imageRef - 内联图片引用
 * @returns {{type:'image', image:string}|null} 内部图片内容块
 */
export function normalizeInlineImageContent(imageRef) {
    const image = normalizeInlineImageDataUrl(imageRef)
    return image ? { type: 'image', image } : null
}
