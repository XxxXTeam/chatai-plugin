import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSkillFileAccess } from '../frontend/components/skills/skill-file-capabilities.ts'

test('前端文件路由只消费服务端能力字段，不按扩展名推断', () => {
    assert.deepEqual(
        getSkillFileAccess({
            path: 'assets/looks-like-text.md',
            dir: 'assets',
            size: 8,
            textReadable: false,
            editable: false,
            downloadable: true,
            mimeType: 'application/octet-stream'
        }),
        { loadText: false, edit: false, download: true, remove: true }
    )

    assert.deepEqual(
        getSkillFileAccess({
            path: 'scripts/no-extension',
            dir: 'scripts',
            size: 12,
            textReadable: true,
            editable: false,
            downloadable: true,
            mimeType: 'text/plain'
        }),
        { loadText: true, edit: false, download: true, remove: false }
    )

    assert.deepEqual(
        getSkillFileAccess({
            path: 'references/data.bin',
            dir: 'references',
            size: 6,
            textReadable: true,
            editable: true,
            downloadable: false,
            mimeType: 'text/plain'
        }),
        { loadText: true, edit: true, download: false, remove: true }
    )
})
