/**
 * 将 messageParser 生成的内联图片对象规范化为 data URL。
 *
 * @param {Object} imageRef - `{ type: 'image', image, mimeType }` 图片引用
 * @returns {string|null} 内联图片 data URL
 */
export function normalizeInlineImageDataUrl(imageRef) {
    if (imageRef?.type !== 'image' || typeof imageRef.image !== 'string') return null

    const image = imageRef.image.trim()
    if (!image) return null
    if (image.startsWith('data:image/')) return image

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
