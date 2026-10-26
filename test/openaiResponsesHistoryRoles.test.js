import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OpenAIClient } from '../src/core/adapters/openai/OpenAIClient.js'

const client = Object.create(OpenAIClient.prototype)

for (const [label, content] of [
    ['string', 'previous answer'],
    ['text array', [{ type: 'text', text: 'previous answer' }]],
    ['input_text array', [{ type: 'input_text', text: 'previous answer' }]]
]) {
    test(`Responses assistant ${label} history uses output_text`, () => {
        const before = structuredClone(content)
        const [message] = client.openAIMessagesToResponsesInput([{ role: 'assistant', content }])
        assert.deepEqual(message.content, [{ type: 'output_text', text: 'previous answer' }])
        assert.deepEqual(content, before, 'conversion must not mutate stored history')
    })
}

for (const role of ['user', 'system', 'developer']) {
    test(`Responses ${role} text remains input_text`, () => {
        const [message] = client.openAIMessagesToResponsesInput([{ role, content: 'input' }])
        assert.deepEqual(message.content, [{ type: 'input_text', text: 'input' }])
        assert.equal(message.role, role === 'developer' ? 'system' : role)
    })
}

test('Responses preserves existing assistant output_text and refusal blocks', () => {
    const content = [
        { type: 'output_text', text: 'answer', annotations: [] },
        { type: 'refusal', refusal: 'not allowed' }
    ]
    const [message] = client.openAIMessagesToResponsesInput([{ role: 'assistant', content }])
    assert.deepEqual(message.content, content)
})

test('Responses preserves user images and audio while converting text', () => {
    const [message] = client.openAIMessagesToResponsesInput([
        {
            role: 'user',
            content: [
                { type: 'text', text: 'look' },
                { type: 'image_url', image_url: { url: 'https://example.invalid/image.png' } },
                { type: 'input_audio', input_audio: { data: 'audio', format: 'wav' } }
            ]
        }
    ])
    assert.deepEqual(message.content, [
        { type: 'input_text', text: 'look' },
        { type: 'input_image', image_url: 'https://example.invalid/image.png' },
        { type: 'input_audio', input_audio: { data: 'audio', format: 'wav' } }
    ])
})

test('Responses tool calls and tool results retain call IDs', () => {
    const input = client.openAIMessagesToResponsesInput([
        {
            role: 'assistant',
            content: 'checking',
            tool_calls: [{ id: 'call_probe', function: { name: 'echo', arguments: '{}' } }]
        },
        { role: 'tool', tool_call_id: 'call_probe', content: 'PONG' },
        {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'call_next', function: { name: 'echo', arguments: '{}' } }]
        }
    ])
    assert.deepEqual(input[0].content, [{ type: 'output_text', text: 'checking' }])
    assert.deepEqual(input.slice(1), [
        { type: 'function_call', call_id: 'call_probe', name: 'echo', arguments: '{}' },
        { type: 'function_call_output', call_id: 'call_probe', output: 'PONG' },
        { type: 'function_call', call_id: 'call_next', name: 'echo', arguments: '{}' }
    ])
})

for (const stream of [false, true]) {
    test(`Responses payload with stream=${stream} uses role-correct text in long history`, () => {
        const messages = [{ role: 'system', content: 'system' }]
        for (let i = 0; i < 50; i++) {
            messages.push({ role: 'user', content: [{ type: 'text', text: `question ${i}` }] })
            messages.push({ role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] })
        }
        messages.push({ role: 'user', content: 'next' })
        const payload = client.buildResponsesPayload({ model: 'gpt-6-luna', messages, stream, max_tokens: 150 })
        assert.equal(payload.input.length, 102)
        assert.equal(payload.stream, stream)
        assert.equal(payload.max_output_tokens, 150)
        for (const message of payload.input) {
            assert.ok(
                message.content.every(c => c.type === (message.role === 'assistant' ? 'output_text' : 'input_text'))
            )
        }
    })
}
