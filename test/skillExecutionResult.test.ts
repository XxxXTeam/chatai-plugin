import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSkillExecutionError } from '../frontend/components/skills/skill-execution-result.ts'

test('技能执行结果按结构化错误字段判定', () => {
    assert.equal(isSkillExecutionError(null), true)
    assert.equal(isSkillExecutionError({ isError: true, content: [] }), true)
    assert.equal(isSkillExecutionError({ success: false }), true)
    assert.equal(isSkillExecutionError({ error: '权限不足' }), true)
    assert.equal(isSkillExecutionError({ isError: false, content: [] }), false)
    assert.equal(isSkillExecutionError('正常文本结果'), false)
})

test('正常正文包含错误字样不会被误判', () => {
    assert.equal(isSkillExecutionError({ content: [{ type: 'text', text: '排查登录失败问题的方法' }] }), false)
})
