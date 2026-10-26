import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'

// Yunzai injects the plugin base and initializes config before loading apps.
// Use in-memory test config: importing webServer must not create a real JWT key.
globalThis.plugin = class {}
globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }
const { default: config } = await import('../config/config.js')
config.config = { web: { jwtSecret: 'unit-test-only' } }
const { AIManagement } = await import('../apps/Management.js')
const { AICommands } = await import('../apps/Commands.js')
const { databaseService } = await import('../src/services/storage/DatabaseService.js')
const { chatService } = await import('../src/services/llm/ChatService.js')
const { memorySummarizer } = await import('../src/services/memory/MemorySummarizer.js')

let originals
before(() => {
    originals = {
        init: databaseService.init,
        getMessages: databaseService.getMessages,
        getMessagesForUser: databaseService.getMessagesForUser,
        clearHistory: chatService.clearHistory,
        onConversationEnd: memorySummarizer.onConversationEnd
    }
})
after(() => {
    Object.assign(databaseService, {
        init: originals.init,
        getMessages: originals.getMessages,
        getMessagesForUser: originals.getMessagesForUser
    })
    chatService.clearHistory = originals.clearHistory
    memorySummarizer.onConversationEnd = originals.onConversationEnd
})

function fixture(App, { groupId = null, count = 3, readError = false, clearError = false, settleError = false } = {}) {
    let release
    const gate = new Promise(resolve => {
        release = resolve
    })
    const events = []
    const replies = []
    const settlements = []
    let rows = Array.from({ length: count }, (_, i) => ({
        id: `old-${i}`,
        role: i % 2 ? 'assistant' : 'user',
        content: [{ type: 'text', text: `old message ${i}` }],
        sender: { user_id: 'end-test-user' }
    }))
    const snapshot = structuredClone(rows)
    databaseService.init = () => {}
    databaseService.getMessages = () => structuredClone(rows)
    databaseService.getMessagesForUser = (conversationId, userId) => {
        events.push(['snapshot', conversationId, userId])
        if (readError) throw new Error('snapshot read failed')
        return structuredClone(rows)
    }
    chatService.clearHistory = async (userId, group) => {
        events.push(['clear', userId, group])
        if (clearError) throw new Error('clear failed')
        rows = []
    }
    memorySummarizer.onConversationEnd = async (userId, messages, options) => {
        events.push(['settle'])
        settlements.push({ userId, messages: structuredClone(messages), options })
        await gate
        if (settleError) throw new Error('upstream memory timeout')
        return { extractedCount: 1 }
    }
    const app = Object.create(App.prototype)
    app.e = { user_id: 'end-test-user', group_id: groupId }
    app.reply = async text => {
        events.push(['reply'])
        replies.push(text)
    }
    return {
        app,
        events,
        replies,
        settlements,
        snapshot,
        release,
        addNewMessage: () => rows.push({ role: 'user', content: 'NEW SESSION' })
    }
}

async function flush() {
    for (let i = 0; i < 4; i++) await nextTurn()
}

for (const App of [AIManagement, AICommands]) {
    test(`${App.name}: slow memory extraction does not block clearing and confirmation`, async () => {
        const f = fixture(App)
        const command = f.app.endConversation()
        try {
            await flush()
            assert.equal(f.replies.length, 1, 'confirm immediately while memory is still pending')
            assert.ok(f.events.some(e => e[0] === 'clear'))
            assert.ok(f.replies[0].includes('已结束当前对话'))
            assert.ok(f.events.findIndex(e => e[0] === 'clear') < f.events.findIndex(e => e[0] === 'reply'))
            assert.ok(f.events.findIndex(e => e[0] === 'clear') < f.events.findIndex(e => e[0] === 'settle'))
        } finally {
            f.release()
            await command
            await flush()
        }
    })

    test(`${App.name}: background settlement keeps only the captured old session and group scope`, async () => {
        const f = fixture(App, { groupId: 'end-test-group' })
        const command = f.app.endConversation()
        try {
            await flush()
            f.addNewMessage()
            assert.equal(f.settlements.length, 1)
            assert.deepEqual(f.settlements[0], {
                userId: 'end-test-user',
                messages: f.snapshot,
                options: { groupId: 'end-test-group', summarize: true }
            })
            assert.ok(
                f.events.some(e => e[0] === 'snapshot' && e[1] === 'group:end-test-group' && e[2] === 'end-test-user')
            )
        } finally {
            f.release()
            await command
            await flush()
        }
    })

    test(`${App.name}: background failure does not change successful confirmation`, async () => {
        const f = fixture(App, { settleError: true })
        const command = f.app.endConversation()
        await flush()
        f.release()
        await command
        await flush()
        assert.equal(f.replies.length, 1)
        assert.ok(f.replies[0].includes('已结束当前对话'))
    })

    test(`${App.name}: short session skips memory extraction`, async () => {
        const f = fixture(App, { count: 2 })
        await f.app.endConversation()
        await flush()
        assert.equal(f.settlements.length, 0)
        assert.equal(f.replies.length, 1)
    })

    test(`${App.name}: failed clear never confirms success or starts background settlement`, async () => {
        const f = fixture(App, { clearError: true })
        const command = f.app.endConversation()
        try {
            await flush()
            assert.equal(f.settlements.length, 0)
            assert.equal(f.replies.length, 1)
            assert.ok(f.replies[0].includes('clear failed'))
            assert.ok(!f.replies[0].includes('已结束当前对话'))
        } finally {
            f.release()
            await command
            await flush()
        }
    })

    test(`${App.name}: snapshot error still allows actual context clearing`, async () => {
        const f = fixture(App, { readError: true })
        await f.app.endConversation()
        await flush()
        assert.equal(f.settlements.length, 0)
        assert.equal(f.replies.length, 1)
        assert.ok(f.replies[0].includes('已结束当前对话'))
    })
}
