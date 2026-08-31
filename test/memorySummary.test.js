import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import Database from 'better-sqlite3'

import config from '../config/config.js'
import { contextManager, extractConversationGroupId } from '../src/services/llm/ContextManager.js'
import { LlmService } from '../src/services/llm/LlmService.js'
import { callMemoryLLM, extractMemoryLLMText } from '../src/services/memory/llmHelper.js'
import { memoryService } from '../src/services/memory/MemoryService.js'
import { memorySummarizer, parseMemorySummaryResponse } from '../src/services/memory/MemorySummarizer.js'
import { statsService } from '../src/services/stats/StatsService.js'
import { databaseService } from '../src/services/storage/DatabaseService.js'
import { memoryManager } from '../src/services/storage/MemoryManager.js'

let db

function insertMemory({ userId = 'user-1', groupId = null, category = 'profile', content, confidence = 0.8 }) {
    return db
        .prepare(
            `
            INSERT INTO structured_memories
            (user_id, group_id, category, content, confidence, source, created_at, updated_at, is_active)
            VALUES (?, ?, ?, ?, ?, 'test', ?, ?, 1)
        `
        )
        .run(userId, groupId, category, content, confidence, Date.now(), Date.now()).lastInsertRowid
}

before(() => {
    db = new Database(':memory:')
    db.exec(`
        CREATE TABLE structured_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            group_id TEXT,
            category TEXT NOT NULL,
            sub_type TEXT,
            content TEXT NOT NULL,
            confidence REAL DEFAULT 0.8,
            source TEXT DEFAULT 'auto',
            metadata TEXT,
            created_at INTEGER,
            updated_at INTEGER,
            expires_at INTEGER,
            is_active INTEGER DEFAULT 1
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER,
            metadata TEXT
        );
        CREATE TABLE memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            content TEXT NOT NULL,
            source TEXT DEFAULT 'manual',
            importance INTEGER DEFAULT 5,
            timestamp INTEGER NOT NULL,
            metadata TEXT
        );
    `)
    databaseService.db = db
    databaseService.initialized = true
    memoryService.initialized = true
    memorySummarizer.setLLMClient(null)
    memoryManager.initialized = true
})

beforeEach(() => {
    db.exec(
        'DROP TRIGGER IF EXISTS fail_summary_insert; DELETE FROM structured_memories; DELETE FROM messages; DELETE FROM memories;'
    )
})

after(() => {
    memoryService.stopDecayTimer()
    db.close()
})

test('记忆总结区分未传 groupId、显式 null 和具体群标识', async () => {
    insertMemory({ content: '全局记忆一' })
    insertMemory({ content: '全局记忆二' })
    insertMemory({ groupId: 'group-open-a', content: '群A记忆一' })
    insertMemory({ groupId: 'group-open-a', content: '群A记忆二' })
    insertMemory({ groupId: 'qg_guild-channel', content: '频道记忆' })

    const allScopes = await memorySummarizer.summarizeUserMemories('user-1', { useLLM: false })
    const globalOnly = await memorySummarizer.summarizeUserMemories('user-1', {
        useLLM: false,
        groupId: null
    })
    const groupOnly = await memorySummarizer.summarizeUserMemories('user-1', {
        useLLM: false,
        groupId: 'group-open-a'
    })

    assert.equal(allScopes.success, true)
    assert.equal(allScopes.beforeCount, 5)
    assert.equal(allScopes.afterCount, 5)
    assert.equal(globalOnly.beforeCount, 2)
    assert.equal(globalOnly.afterCount, 2)
    assert.equal(groupOnly.beforeCount, 2)
    assert.equal(groupOnly.afterCount, 2)
})

test('两个群中的同文记忆不会互相合并', async () => {
    insertMemory({ groupId: 'group-a', content: '用户喜欢黑咖啡' })
    insertMemory({ groupId: 'group-b', content: '用户喜欢黑咖啡' })

    const result = await memoryService.mergeMemories('user-1')
    const rows = db
        .prepare('SELECT group_id, content FROM structured_memories WHERE user_id = ? ORDER BY group_id')
        .all('user-1')

    assert.equal(result.originalCount, 2)
    assert.equal(result.deletedCount, 0)
    assert.deepEqual(rows, [
        { group_id: 'group-a', content: '用户喜欢黑咖啡' },
        { group_id: 'group-b', content: '用户喜欢黑咖啡' }
    ])
})

test('低质量清理按 omitted、null、具体群标识隔离作用域', async () => {
    insertMemory({ content: '全局低质量记忆', confidence: 0.1 })
    insertMemory({ groupId: 'group-a', content: '群A低质量记忆', confidence: 0.1 })
    insertMemory({ groupId: 'group-b', content: '群B低质量记忆', confidence: 0.1 })

    const groupResult = await memorySummarizer.cleanupMemories('user-1', { groupId: 'group-a' })
    assert.equal(groupResult.removedCount, 1)
    assert.deepEqual(
        db
            .prepare('SELECT group_id FROM structured_memories ORDER BY id')
            .all()
            .map(row => row.group_id),
        [null, 'group-b']
    )

    const globalResult = await memorySummarizer.cleanupMemories('user-1', { groupId: null })
    assert.equal(globalResult.removedCount, 1)
    assert.deepEqual(
        db
            .prepare('SELECT group_id FROM structured_memories ORDER BY id')
            .all()
            .map(row => row.group_id),
        ['group-b']
    )

    const allResult = await memorySummarizer.cleanupMemories('user-1')
    assert.equal(allResult.removedCount, 1)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM structured_memories').get().count, 0)
})

test('共享群记忆总结只读取目标用户轮次', async () => {
    const conversationId = 'group:group-open-id'
    databaseService.saveMessage(conversationId, {
        id: 'user-a-1',
        role: 'user',
        sender: { user_id: 'user-a', nickname: '用户A' },
        content: [{ type: 'text', text: '我是用户A，我长期住在上海并且很喜欢手冲咖啡，请记住这些信息。' }],
        timestamp: 1
    })
    databaseService.saveMessage(conversationId, {
        id: 'assistant-a-1',
        role: 'assistant',
        content: [{ type: 'text', text: '已了解用户A的信息。' }],
        timestamp: 2
    })
    databaseService.saveMessage(conversationId, {
        id: 'user-b-1',
        role: 'user',
        sender: { user_id: 'user-b', nickname: '用户B' },
        content: [{ type: 'text', text: '我是用户B，我喜欢榴莲，这条信息绝对不能归到用户A。' }],
        timestamp: 3
    })
    databaseService.saveMessage(conversationId, {
        id: 'assistant-b-1',
        role: 'assistant',
        content: [{ type: 'text', text: '已了解用户B的信息。' }],
        timestamp: 4
    })

    const originalGetChatClient = LlmService.getChatClient
    const originalRecordApiCall = statsService.recordApiCall
    let receivedPrompt = ''
    LlmService.getChatClient = async () => ({
        _channelInfo: { id: 'test', name: 'test', model: 'test-model' },
        sendMessage: async message => {
            receivedPrompt = message.content[0].text
            return { contents: [{ type: 'text', text: '用户A长期住在上海\n用户A喜欢手冲咖啡' }] }
        }
    })
    statsService.recordApiCall = async () => {}

    try {
        const result = await memoryManager.analyzeUserConversations('user-a', { groupId: 'group-open-id' })
        assert.equal(result.success, true)
        assert.match(receivedPrompt, /用户A.*上海/)
        assert.doesNotMatch(receivedPrompt, /用户B|榴莲/)
        assert.deepEqual(
            databaseService
                .getMemories('group:group-open-id:user:user-a', 10)
                .map(memory => memory.content)
                .sort(),
            ['用户A喜欢手冲咖啡', '用户A长期住在上海'].sort()
        )
        assert.deepEqual(databaseService.getMemories('user-a', 10), [])
    } finally {
        LlmService.getChatClient = originalGetChatClient
        statsService.recordApiCall = originalRecordApiCall
    }
})

test('自动轮询按共享群 sender 精确枚举 QQBot 用户并跳过无 sender 旧记录', async () => {
    const groupId = 'qg_guild-channel'
    const conversationId = `group:${groupId}`
    databaseService.saveMessage(conversationId, {
        id: 'poll-user-a',
        role: 'user',
        sender: { user_id: 'qg_user_a' },
        content: [{ type: 'text', text: '用户A消息' }],
        timestamp: 1
    })
    databaseService.saveMessage(conversationId, {
        id: 'poll-user-b',
        role: 'user',
        sender: { user_id: 'qg_user_b' },
        content: [{ type: 'text', text: '用户B消息' }],
        timestamp: 2
    })
    databaseService.saveMessage('group:qg_legacy-channel', {
        id: 'poll-legacy-user',
        role: 'user',
        content: [{ type: 'text', text: '旧记录没有 sender' }],
        timestamp: 3
    })

    const originalGet = config.get
    const originalAnalyze = memoryManager.analyzeUserConversations
    const calls = []
    config.get = function (key) {
        if (key === 'memory.enabled') return true
        if (key === 'memory.minPollInterval') return 0
        return originalGet.call(this, key)
    }
    memoryManager.analyzeUserConversations = async (userId, options) => {
        calls.push({ userId, groupId: options?.groupId })
        return { success: true }
    }
    memoryManager.lastPollTime.clear()

    try {
        await memoryManager.pollAndSummarize()
        assert.deepEqual(calls.map(call => `${call.groupId}/${call.userId}`).sort(), [
            `${groupId}/qg_user_a`,
            `${groupId}/qg_user_b`
        ])
        assert.equal(
            calls.some(call => call.userId === groupId || call.groupId === 'qg_legacy-channel'),
            false
        )
        assert.equal(memoryManager.lastPollTime.has(`group:${groupId}:user:qg_user_a`), true)
        assert.equal(memoryManager.lastPollTime.has(`group:${groupId}:user:qg_user_b`), true)
    } finally {
        config.get = originalGet
        memoryManager.analyzeUserConversations = originalAnalyze
        memoryManager.lastPollTime.clear()
    }
})

test('旧库无 sender 与无会话时不会误报总结成功', async () => {
    const conversationId = 'group:legacy-group'
    const insertLegacy = db.prepare(
        'INSERT INTO messages (conversation_id, role, content, timestamp, metadata) VALUES (?, ?, ?, ?, NULL)'
    )
    insertLegacy.run(
        conversationId,
        'user',
        JSON.stringify({ id: 'legacy-user', content: [{ type: 'text', text: '旧记录没有发送者字段' }] }),
        1
    )
    insertLegacy.run(
        conversationId,
        'assistant',
        JSON.stringify({ id: 'legacy-assistant', content: [{ type: 'text', text: '旧助手回复' }] }),
        2
    )

    const originalGet = config.get
    config.get = function (key) {
        if (key === 'memory.enabled') return true
        return originalGet.call(this, key)
    }
    try {
        const legacyResult = await memoryManager.summarizeUserMemory('user-a', { groupId: 'legacy-group' })
        assert.equal(legacyResult.success, false)
        assert.equal(legacyResult.reason, 'insufficient_attributed_messages')

        const emptyResult = await memoryManager.summarizeUserMemory('user-a', { groupId: 'missing-group' })
        assert.equal(emptyResult.success, false)
        assert.equal(emptyResult.reason, 'no_conversation')
    } finally {
        config.get = originalGet
    }
})

test('qg_ 下划线用户标识按原值读取全部记忆', async () => {
    const qgUserId = 'qg_open_user_with_underscore'
    const insert = db.prepare(
        "INSERT INTO memories (user_id, content, source, importance, timestamp, metadata) VALUES (?, ?, 'test', 5, ?, NULL)"
    )
    for (let index = 1; index <= 6; index++) {
        insert.run(qgUserId, `频道用户记忆-${index}`, index)
    }

    const originalGet = config.get
    config.get = function (key) {
        if (key === 'memory.enabled') return true
        return originalGet.call(this, key)
    }
    try {
        const context = await memoryManager.getMemoryContext(qgUserId, '')
        assert.match(context, /频道用户记忆-1/)
        assert.match(context, /频道用户记忆-6/)
    } finally {
        config.get = originalGet
    }
})

test('分类替换写入任一步失败时完整保留旧记忆', async () => {
    const firstId = insertMemory({ groupId: 'group-a', content: '旧记忆一' })
    const secondId = insertMemory({ groupId: 'group-a', content: '旧记忆二' })
    db.exec(`
        CREATE TRIGGER fail_summary_insert
        BEFORE INSERT ON structured_memories
        WHEN NEW.content = '触发回滚'
        BEGIN
            SELECT RAISE(ABORT, 'forced summary failure');
        END;
    `)

    await assert.rejects(
        memoryService.replaceCategoryMemories({
            userId: 'user-1',
            groupId: 'group-a',
            category: 'profile',
            oldIds: [firstId, secondId],
            contents: ['新记忆', '触发回滚']
        }),
        /forced summary failure/
    )

    const contents = db
        .prepare('SELECT content FROM structured_memories WHERE user_id = ? ORDER BY id')
        .all('user-1')
        .map(row => row.content)
    assert.deepEqual(contents, ['旧记忆一', '旧记忆二'])
})

test('总结输出解析会移除围栏、编号和说明前缀', () => {
    assert.deepEqual(parseMemorySummaryResponse('```text\n1. 喜欢咖啡\n- 常住上海\n整理结果：周末骑行\n```'), [
        '喜欢咖啡',
        '常住上海',
        '周末骑行'
    ])
})

test('统一提取 OpenAI、Claude 和 Gemini 响应文本', async () => {
    assert.equal(await extractMemoryLLMText({ choices: [{ message: { content: 'OpenAI 文本' } }] }), 'OpenAI 文本')
    assert.equal(await extractMemoryLLMText({ content: [{ type: 'text', text: 'Claude 文本' }] }), 'Claude 文本')
    assert.equal(
        await extractMemoryLLMText({ candidates: [{ content: { parts: [{ text: 'Gemini 文本' }] } }] }),
        'Gemini 文本'
    )
    assert.equal(
        await extractMemoryLLMText({ response: { text: () => 'Gemini response 文本' } }),
        'Gemini response 文本'
    )
})

test('内部客户端优先使用 sendMessageWithHistory 并读取 contents', async () => {
    let historyCalls = 0
    let sendCalls = 0
    const client = {
        sendMessageWithHistory: async history => {
            historyCalls++
            assert.deepEqual(history, [{ role: 'user', content: [{ type: 'text', text: '总结提示' }] }])
            return { contents: [{ type: 'text', text: '统一响应' }] }
        },
        sendMessage: async () => {
            sendCalls++
            return '错误分支'
        }
    }

    assert.equal(await callMemoryLLM(client, '总结提示'), '统一响应')
    assert.equal(historyCalls, 1)
    assert.equal(sendCalls, 0)
})

test('会话群标识解析支持 QQBot OpenID 和频道标识', () => {
    assert.equal(extractConversationGroupId('group:123456'), '123456')
    assert.equal(extractConversationGroupId('group:openid_A-b:user:user-openid'), 'openid_A-b')
    assert.equal(extractConversationGroupId('group:qg_guild-channel'), 'qg_guild-channel')
    assert.equal(extractConversationGroupId('user:123456'), null)
    assert.equal(extractConversationGroupId('group:'), null)
})

test('同毫秒历史按数据库 id 稳定排序并裁剪最后写入的消息', () => {
    const conversationId = 'user:same-timestamp'
    for (const id of ['first', 'second', 'third']) {
        databaseService.saveMessage(conversationId, {
            id,
            role: 'assistant',
            content: [{ type: 'text', text: id }],
            timestamp: 1000
        })
    }

    assert.deepEqual(
        databaseService.getMessages(conversationId, 100).map(message => message.id),
        ['first', 'second', 'third']
    )
    databaseService.trimMessages(conversationId, 2)
    assert.deepEqual(
        databaseService.getMessages(conversationId, 100).map(message => message.id),
        ['second', 'third']
    )
})

test('频道会话总结把完整 qg 群标识传给渠道选择', async () => {
    const conversationId = 'group:qg_guild-channel'
    databaseService.saveMessage(conversationId, {
        id: 'message-user',
        role: 'user',
        content: [
            { type: 'text', text: '这是一段足够长的频道对话内容，用于确认自动总结选择了频道自己的独立模型渠道。' }
        ],
        timestamp: 1
    })
    databaseService.saveMessage(conversationId, {
        id: 'message-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: '助手继续补充足够长的回复内容，确保对话达到总结所需的最小长度。' }],
        timestamp: 2
    })

    const originalGetChatClient = LlmService.getChatClient
    let receivedGroupId = null
    LlmService.getChatClient = async options => {
        receivedGroupId = options.groupId
        return {
            sendMessage: async () => ({ contents: [{ type: 'text', text: '频道对话摘要\n未解决：无' }] })
        }
    }

    try {
        assert.equal(await contextManager.summarizeConversation(conversationId), true)
        assert.equal(receivedGroupId, 'qg_guild-channel')
        const remaining = databaseService.getMessages(conversationId, 100)
        assert.equal(remaining.length, 1)
        assert.equal(remaining[0].metadata?.summarized, true)
    } finally {
        LlmService.getChatClient = originalGetChatClient
    }
})
