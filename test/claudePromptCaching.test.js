import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ClaudeClient } from '../src/core/adapters/claude/ClaudeClient.js'

const history = [
    { role: 'system', content: 'stable shared system prefix' },
    { role: 'user', content: [{ type: 'text', text: 'cache probe' }] }
]

function createClient(fetch) {
    const client = new ClaudeClient({ apiKey: 'unit-test-key', baseUrl: 'https://cache-probe.invalid/v1' })
    client.buildClaudeClientOptions = apiKey => ({
        apiKey,
        baseURL: 'https://cache-probe.invalid',
        maxRetries: 0,
        fetch
    })
    return client
}

function messageResponse() {
    return new Response(
        JSON.stringify({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-5.5',
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 128, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
    )
}

test('non-stream Claude requests opt in to ephemeral prompt caching', async () => {
    let requestPayload
    const client = createClient(async (_url, init) => {
        requestPayload = JSON.parse(init.body)
        return messageResponse()
    })

    await client._sendMessage(history, 'unit-test-key', { model: 'claude-haiku-5.5', maxToken: 32 })

    assert.deepEqual(requestPayload.cache_control, { type: 'ephemeral' })
})

test('streaming Claude requests opt in to ephemeral prompt caching', async () => {
    let requestPayload
    const client = createClient(async (_url, init) => {
        requestPayload = JSON.parse(init.body)
        return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const stream = await client.streamMessage(history, { model: 'claude-haiku-5.5', maxToken: 32 })
    for await (const _chunk of stream) {
        // Consume the complete mocked stream.
    }

    assert.deepEqual(requestPayload.cache_control, { type: 'ephemeral' })
})
