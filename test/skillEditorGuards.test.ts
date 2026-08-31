import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
    createEmptySkillEditorContentState,
    getPendingSkillEditorAction,
    shouldBlockSkillEditorUnload
} from '../frontend/components/skills/skill-editor-guards.ts'

test('未保存修改会拦截所有会丢失内容的编辑器动作', () => {
    const actions = [
        { type: 'switch', file: 'references/next.md' } as const,
        { type: 'mode', mode: 'source' } as const,
        { type: 'close' } as const,
        { type: 'create-file' } as const,
        { type: 'delete-file', file: 'assets/current.md' } as const
    ]

    for (const action of actions) {
        assert.deepEqual(getPendingSkillEditorAction(true, action), action)
        assert.equal(getPendingSkillEditorAction(false, action), null)
    }
})

test('浏览器离开保护只在编辑器打开且存在未保存修改时生效', () => {
    assert.equal(shouldBlockSkillEditorUnload(true, true), true)
    assert.equal(shouldBlockSkillEditorUnload(true, false), false)
    assert.equal(shouldBlockSkillEditorUnload(false, true), false)
})

test('读取失败时生成完全清空且非脏状态的编辑器内容', () => {
    const first = createEmptySkillEditorContentState()
    first.structuredMetadata.name = '旧技能'
    const second = createEmptySkillEditorContentState()

    assert.deepEqual(second.structuredMetadata, {})
    assert.equal(second.content, '')
    assert.equal(second.originalContent, '')
    assert.equal(second.structuredBody, '')
    assert.equal(second.originalStructured, JSON.stringify({ metadata: {}, body: '' }))
    assert.deepEqual(second.meta, {})
})
