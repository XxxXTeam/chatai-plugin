import assert from 'node:assert/strict'
import test from 'node:test'

import { getFromChaiteConverter } from '../src/core/utils/converter.js'
import { normalizeInlineImageContent, normalizeInlineImageDataUrl } from '../src/services/llm/InlineImageDataUrl.js'

await Promise.all([
    import('../src/core/adapters/openai/converter.js'),
    import('../src/core/adapters/claude/converter.js'),
    import('../src/core/adapters/gemini/converter.js')
])

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

test('内联图片保留通用 image 内容块，并可由所有适配器转换', () => {
    const imageContent = normalizeInlineImageContent({
        type: 'image',
        image: 'YWJj',
        mimeType: 'image/png'
    })
    assert.deepEqual(imageContent, {
        type: 'image',
        image: 'data:image/png;base64,YWJj'
    })

    const message = {
        role: 'user',
        content: [{ type: 'text', text: '描述图片' }, imageContent]
    }

    const openai = getFromChaiteConverter('openai')(message)
    assert.equal(openai.content[1].type, 'image_url')
    assert.equal(openai.content[1].image_url.url, imageContent.image)

    const claude = getFromChaiteConverter('claude')(message)
    assert.deepEqual(claude.content[1], {
        type: 'image',
        source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'YWJj'
        }
    })

    const gemini = getFromChaiteConverter('gemini')(message)
    assert.deepEqual(gemini.parts[1], {
        inlineData: {
            mimeType: 'image/png',
            data: 'YWJj'
        }
    })
})
