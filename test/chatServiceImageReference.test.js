import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }

const { normalizeInlineImageDataUrl } = await import('../src/services/llm/ChatService.js')

test('ChatService 将 messageParser 的裸 base64 图片对象转换为 data URL', () => {
    assert.equal(
        normalizeInlineImageDataUrl({
            type: 'image',
            image: '/9j/example',
            mimeType: 'image/jpeg'
        }),
        'data:image/jpeg;base64,/9j/example'
    )
})

test('ChatService 兼容 base64:// 与已有 data URL', () => {
    assert.equal(
        normalizeInlineImageDataUrl({
            type: 'image',
            image: 'base64://iVBORw0KGgo=',
            mimeType: 'image/png'
        }),
        'data:image/png;base64,iVBORw0KGgo='
    )

    const dataUrl = 'data:image/webp;base64,UklGRg=='
    assert.equal(normalizeInlineImageDataUrl({ type: 'image', image: dataUrl }), dataUrl)
})

test('ChatService 对缺失 MIME 类型使用 JPEG，并拒绝空图片', () => {
    assert.equal(normalizeInlineImageDataUrl({ type: 'image', image: 'YWJj' }), 'data:image/jpeg;base64,YWJj')
    assert.equal(normalizeInlineImageDataUrl({ type: 'image', image: '' }), null)
    assert.equal(normalizeInlineImageDataUrl({ type: 'image_url', image: 'YWJj' }), null)
})
