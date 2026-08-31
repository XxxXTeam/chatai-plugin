import assert from 'node:assert/strict'
import { test } from 'node:test'
import { skillsApi } from '../frontend/lib/api.ts'

test('前端技能下载使用鉴权 fetch 获取 Blob，不请求 JSON 内容', async () => {
    const originalFetch = globalThis.fetch
    const originalWindow = globalThis.window
    const originalLocalStorage = globalThis.localStorage
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined

    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true })
    Object.defineProperty(globalThis, 'localStorage', {
        value: { getItem: (key: string) => (key === 'chatai_token' ? 'test-token' : null) },
        configurable: true
    })
    globalThis.fetch = async (input, init) => {
        capturedUrl = String(input)
        capturedInit = init
        return new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), {
            status: 200,
            headers: {
                'Content-Type': 'image/png',
                'Content-Disposition': `attachment; filename="report.png"; filename*=UTF-8''%E6%8A%A5%E5%91%8A.png`
            }
        })
    }

    try {
        const result = await skillsApi.downloadDocumentFile('binary-assets', 'assets/报告.png')
        assert.match(capturedUrl, /download=1/)
        assert.match(capturedUrl, /path=assets%2F%E6%8A%A5%E5%91%8A\.png/)
        assert.equal(capturedInit?.credentials, 'include')
        assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer test-token')
        assert.equal(result.fileName, '报告.png')
        assert.equal(result.mimeType, 'image/png')
        assert.deepEqual(Array.from(new Uint8Array(await result.blob.arrayBuffer())), [0x89, 0x50, 0x4e, 0x47])
    } finally {
        globalThis.fetch = originalFetch
        if (originalWindow === undefined) delete globalThis.window
        else Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true })
        if (originalLocalStorage === undefined) delete globalThis.localStorage
        else Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, configurable: true })
    }
})
