import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
    serializeOneBotMessage,
    StandardBotApi,
    StandardFileApi,
    StandardMessage,
    UnsupportedBotApiError
} from '../src/core/platform/index.js'

const success = id => ({ message_id: [id], data: [{ id }], error: [] })

test('QQBot 保留 OpenID，当前会话使用 event.reply，跨会话使用标准目标对象', async () => {
    const calls = []
    const bot = {
        adapter: { id: 'QQBot', name: 'QQBot' },
        pickGroup(groupId) {
            calls.push(['pickGroup', groupId])
            return { sendMsg: async message => (calls.push(['group.sendMsg', message]), success('group')) }
        },
        pickFriend(userId) {
            calls.push(['pickFriend', userId])
            return { sendMsg: async message => (calls.push(['friend.sendMsg', message]), success('friend')) }
        }
    }
    const event = {
        bot,
        group_id: 'group_openid',
        _raw_group_id: 'group_openid',
        user_id: 'user_openid',
        async reply(message) {
            calls.push(['event.reply', message])
            return success('reply')
        }
    }
    const api = new StandardBotApi({ bot, event })

    assert.equal(api.targetId('group_openid'), 'group_openid')
    assert.equal((await api.sendGroup('group_openid', 'current')).method, 'event.reply')
    assert.equal((await api.sendGroup('other_group_openid', 'cross')).method, 'pickGroup.sendMsg')
    assert.equal((await api.sendPrivate('other_user_openid', 'private')).method, 'pickFriend.sendMsg')
    assert.deepEqual(
        calls.find(call => call[0] === 'pickGroup'),
        ['pickGroup', 'other_group_openid']
    )
    assert.deepEqual(
        calls.find(call => call[0] === 'pickFriend'),
        ['pickFriend', 'other_user_openid']
    )
})

test('ICQQ 安全整数目标转换为 number，非数字标识保持原值', async () => {
    const ids = []
    const bot = {
        adapter: { id: 'ICQQ' },
        pickGroup(groupId) {
            ids.push(groupId)
            return { sendMsg: async () => ({ message_id: 1 }) }
        }
    }
    const api = new StandardBotApi({ bot })
    await api.sendGroup('123456', 'hello')
    assert.equal(ids[0], 123456)
    assert.equal(api.targetId('group-open-id'), 'group-open-id')
})

test('目录缓存可用数字字符串读取 Map<number> 键', async () => {
    const api = new StandardBotApi({
        bot: {
            adapter: { id: 'QQBot' },
            fl: new Map([[123456, { user_id: 123456, nickname: '数字键好友' }]]),
            pickFriend: userId => ({ user_id: userId })
        }
    })
    const info = await api.getUserInfo('123456')
    assert.equal(info.nickname, '数字键好友')
})

test('OneBot 动作统一通过 callAction 且严格保留标准化参数', async () => {
    const calls = []
    const api = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBot' },
            async sendApi(action, params) {
                calls.push([action, params])
                return { retcode: 0, data: { ok: true } }
            }
        }
    })
    const result = await api.callAction('custom_action', { group_id: '123456', user_id: '654321' }, { strict: true })
    assert.equal(result.retcode, 0)
    assert.deepEqual(calls, [['custom_action', { group_id: 123456, user_id: 654321 }]])
})

test('sendApi-only OneBot 覆盖发送、资料、历史与群文件回退', async () => {
    const calls = []
    const bot = {
        adapter: { id: 'OneBot' },
        async sendApi(action, params) {
            calls.push([action, params])
            const data = {
                send_group_msg: { message_id: 'group-message' },
                send_private_msg: { message_id: 'private-message' },
                get_group_info: { group_id: params.group_id, group_name: '群' },
                get_group_member_list: [{ user_id: 1, nickname: '成员' }],
                get_msg: { message_id: params.message_id, message: [] },
                get_group_msg_history: { messages: [{ message_id: 'history-message' }] },
                get_group_root_files: { files: [{ file_id: 'file-1', file_name: '文件' }], folders: [] }
            }[action]
            return { retcode: 0, data }
        }
    }
    const api = new StandardBotApi({ bot })
    assert.equal((await api.sendGroup('123', '群消息')).message_id, 'group-message')
    assert.equal((await api.sendPrivate('456', '私聊消息')).message_id, 'private-message')
    assert.equal((await api.getGroupInfo('123')).group_name, '群')
    assert.equal((await api.getMemberList('123'))[0].nickname, '成员')
    assert.equal((await api.getMessage('message-1')).message_id, 'message-1')
    assert.equal((await api.getHistory({ groupId: '123', sequence: 1, count: 10 }))[0].message_id, 'history-message')
    assert.equal((await new StandardFileApi(api).listGroupFiles('123'))[0].file_id, 'file-1')
    assert.ok(calls.some(([action]) => action === 'send_group_msg'))
})

test('BuiltinMcpServer 复用精确适配器识别', async () => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    globalThis.Bot ||= {}
    const { detectAdapter } = await import('../src/mcp/BuiltinMcpServer.js')
    assert.equal(detectAdapter({ adapter: { id: 'QQBot' } }).adapter, 'qqbot')
    assert.equal(detectAdapter({ adapter: { id: 'ICQQ' } }).adapter, 'icqq')
    assert.equal(detectAdapter({ adapter: { id: 'OneBot' } }).adapter, 'onebot')
    assert.equal(detectAdapter({ adapter: { id: 'NapCat' } }).adapter, 'napcat')
    assert.equal(detectAdapter({}).adapter, 'unknown')
})

test('BuiltinMcpServer 工具清单保留标准可选元数据且不暴露 handler', async () => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    const { BuiltinMcpServer } = await import('../src/mcp/BuiltinMcpServer.js')
    const server = new BuiltinMcpServer()
    server.modularTools = [
        {
            name: 'metadata_builtin',
            description: 'metadata builtin',
            inputSchema: { type: 'object', properties: {} },
            title: '内置元数据工具',
            icons: [{ src: 'https://example.invalid/builtin.svg' }],
            outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
            annotations: { readOnlyHint: true },
            _meta: { source: 'test' },
            handler() {}
        }
    ]
    server.jsTools.set('metadata_js', {
        name: 'metadata_js',
        description: 'metadata js',
        inputSchema: { type: 'object', properties: {} },
        title: 'JS 元数据工具',
        annotations: { destructiveHint: false },
        run() {}
    })

    const builtin = server.listTools().find(tool => tool.name === 'metadata_builtin')
    const jsTool = server.listTools().find(tool => tool.name === 'metadata_js')
    assert.equal(builtin.title, '内置元数据工具')
    assert.deepEqual(builtin.icons, [{ src: 'https://example.invalid/builtin.svg' }])
    assert.deepEqual(builtin.annotations, { readOnlyHint: true })
    assert.equal(Object.hasOwn(builtin, 'handler'), false)
    assert.equal(jsTool.title, 'JS 元数据工具')
    assert.deepEqual(jsTool.annotations, { destructiveHint: false })
    assert.equal(Object.hasOwn(jsTool, 'run'), false)
})

test('BuiltinMcpServer 目录轮询兜底可启动、报告并停止', async t => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    const { BuiltinMcpServer } = await import('../src/mcp/BuiltinMcpServer.js')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-mcp-polling-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    const server = new BuiltinMcpServer()
    const before = server.getToolDirectorySnapshot(directory)
    fs.writeFileSync(path.join(directory, 'probe.js'), 'export default {}')
    assert.notEqual(server.getToolDirectorySnapshot(directory), before)

    server.startPollingWatcher([{ path: directory, name: '测试工具目录' }], async () => {})
    const status = server.getWatcherStatus()
    assert.equal(status.enabled, true)
    assert.equal(status.pollingFallback, true)
    assert.equal(status.watchPaths[0].mode, 'polling')
    assert.equal(server.pollingWatcherTimer.hasRef?.(), false)
    server.stopFileWatcher()
    assert.equal(server.getWatcherStatus().enabled, false)
})

test('显式空工具上下文不会继承上一条聊天事件', async () => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    globalThis.Bot ||= {}
    const { BuiltinMcpServer, setBuiltinToolContext } = await import('../src/mcp/BuiltinMcpServer.js')
    const previousEvent = { user_id: 'previous-user', group_id: 'previous-group' }
    const previousBot = { adapter: { id: 'QQBot' } }
    setBuiltinToolContext({ event: previousEvent, bot: previousBot })

    const server = new BuiltinMcpServer()
    const isolated = server.createRequestContext(null)
    assert.equal(isolated.getEvent(), null)
    assert.equal(isolated.isMaster, false)

    const explicit = server.createRequestContext({ event: null, bot: { adapter: { id: 'OneBot' } }, isMaster: false })
    assert.equal(explicit.getEvent(), null)
    assert.equal(explicit.isMaster, false)

    setBuiltinToolContext({ event: null, bot: null })
})

test('发送业务错误与 unsupported 都显式失败', async () => {
    const failed = new StandardBotApi({
        bot: {
            pickGroup: () => ({
                sendMsg: async () => ({ message_id: [], data: [], error: [new Error('send failed')] })
            })
        }
    })
    await assert.rejects(failed.sendGroup('123', 'x'), /send failed/)

    const unsupported = new StandardBotApi({ bot: {} })
    await assert.rejects(unsupported.sendGroup('123', 'x'), error => {
        assert.ok(error instanceof UnsupportedBotApiError)
        assert.equal(error.code, 'UNSUPPORTED_BOT_API')
        return true
    })
})

test('OneBot 动作严格校验 retcode，文件边界拒绝 QQBot 群文件系统', async () => {
    const api = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBot' },
            sendApi: async () => ({ retcode: 1404, message: 'unsupported' })
        }
    })
    await assert.rejects(api.callAction('unknown_action', {}, { strict: true }), /retcode=1404/)

    let picked = false
    const qqApi = new StandardBotApi({
        bot: {
            adapter: { id: 'QQBot' },
            pickGroup() {
                picked = true
                return {}
            }
        }
    })
    await assert.rejects(new StandardFileApi(qqApi).getGroupFileSystemInfo('qg_group'), /group\.fileSystem/)
    assert.equal(picked, false)
})

test('callAction 首个已匹配业务错误立即终止，不重复执行后备动作', async () => {
    const calls = []
    const api = new StandardBotApi({
        bot: {
            async setGroupBan() {
                calls.push('direct')
                return { retcode: 1404, message: 'unsupported' }
            },
            async sendApi() {
                calls.push('sendApi')
                return { retcode: 0 }
            }
        }
    })

    await assert.rejects(
        api.callAction('set_group_ban', { group_id: '123', user_id: '456', duration: 60 }, { strict: true }),
        /retcode=1404/
    )
    assert.deepEqual(calls, ['direct'])

    calls.length = 0
    const probed = await api.callAction('set_group_ban', {
        group_id: '123',
        user_id: '456',
        duration: 60
    })
    assert.equal(probed, null)
    assert.deepEqual(calls, ['direct'])
})

test('Yunzai 转发数组逐项校验并提取最后一个成功消息 ID', async () => {
    let result = [success('forward-1'), success('forward-2')]
    const api = new StandardBotApi({
        bot: {
            pickGroup: () => ({ sendForwardMsg: async () => result })
        }
    })
    const sent = await api.sendForward({
        groupId: '123',
        nodes: [{ user_id: '1', nickname: '发送者', message: '正文' }]
    })
    assert.equal(sent.success, true)
    assert.equal(sent.message_id, 'forward-2')

    result = [success('forward-ok'), { message_id: [], data: [], error: [new Error('forward failed')] }]
    await assert.rejects(
        api.sendForward({ groupId: '123', nodes: [{ user_id: '1', nickname: '发送者', message: '正文' }] }),
        /forward failed/
    )
})

test('StandardFileApi 校验所有文件系统写操作业务结果', async () => {
    const results = {
        rm: false,
        mkdir: { retcode: 100, message: 'mkdir failed' },
        mv: false,
        rename: { retcode: 101, message: 'rename failed' },
        rmdir: false
    }
    const api = new StandardBotApi({
        bot: {
            pickGroup: () => ({
                fs: Object.fromEntries(Object.keys(results).map(name => [name, async () => results[name]]))
            })
        }
    })
    const files = new StandardFileApi(api)
    await assert.rejects(files.deleteGroupFile('123', 'file'), /group\.fs\.rm/)
    await assert.rejects(files.createGroupFolder('123', 'folder'), /mkdir failed/)
    await assert.rejects(files.moveGroupFile('123', 'file', '/', 'target'), /group\.fs\.mv/)
    await assert.rejects(files.renameGroupFile('123', 'file', 'new'), /rename failed/)
    await assert.rejects(files.deleteGroupFolder('123', 'folder'), /group\.fs\.rmdir/)

    for (const name of Object.keys(results)) results[name] = undefined
    await files.deleteGroupFile('123', 'file')
    await files.createGroupFolder('123', 'folder')
    await files.moveGroupFile('123', 'file', '/', 'target')
    await files.renameGroupFile('123', 'file', 'new')
    await files.deleteGroupFolder('123', 'folder')
})

test('标准表情回应不会把协议端 false 误报为成功', async () => {
    const api = new StandardBotApi({
        bot: {
            pickGroup: () => ({ setReaction: async () => false })
        }
    })
    await assert.rejects(api.setReaction({ messageId: '1', emojiId: '76', groupId: '123' }), /group\.setReaction/)
})

test('严格读取动作允许合法空列表，空转发发送结果仍失败', async () => {
    const readApi = new StandardBotApi({ bot: { getGroupMemberList: async () => [] } })
    assert.deepEqual(await readApi.callAction('get_group_member_list', { group_id: '123' }, { strict: true }), [])

    const forwardApi = new StandardBotApi({ bot: { pickGroup: () => ({ sendForwardMsg: async () => [] }) } })
    await assert.rejects(
        forwardApi.sendForward({ groupId: '123', nodes: [{ user_id: '1', nickname: '发送者', message: '正文' }] }),
        /未返回任何发送结果/
    )
})

test('StandardMessage 使用 Yunzai 扁平消息段', () => {
    assert.deepEqual(StandardMessage.text('hello'), { type: 'text', text: 'hello' })
    assert.deepEqual(StandardMessage.at('openid'), { type: 'at', qq: 'openid' })
    assert.deepEqual(StandardMessage.file('/tmp/a.txt', 'a.txt'), {
        type: 'file',
        file: '/tmp/a.txt',
        name: 'a.txt'
    })
})

test('send_forward_direct handler 使用标准接口实际发送每条消息', async () => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    globalThis.Bot ||= {}
    const { messageTools } = await import('../src/mcp/tools/message.js')
    const calls = []
    const bot = { adapter: { id: 'QQBot' } }
    const event = {
        bot,
        group_id: 'group_openid',
        _raw_group_id: 'group_openid',
        async reply(message) {
            calls.push(message)
            return success(`message-${calls.length}`)
        }
    }
    const tool = messageTools.find(item => item.name === 'send_forward_direct')
    const result = await tool.handler(
        { messages: ['第一条', '第二条'], group_id: 'group_openid', interval: 0 },
        { getBot: () => bot, getEvent: () => event }
    )
    assert.equal(result.success, true)
    assert.equal(result.success_count, 2)
    assert.equal(calls.length, 2)
})

test('send_raw_message 与 get_message_record handler 不依赖隐式变量', async () => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    globalThis.Bot ||= {}
    const { forwardDataTools, messageTools } = await import('../src/mcp/tools/message.js')
    const sent = []
    const bot = {
        adapter: { id: 'QQBot' },
        async getMsg(messageId) {
            return { message_id: messageId, message: [], sender: { user_id: 'user_openid' } }
        }
    }
    const event = {
        bot,
        group_id: 'group_openid',
        _raw_group_id: 'group_openid',
        async reply(message) {
            sent.push(message)
            return success('raw-message')
        }
    }
    const ctx = { getBot: () => bot, getEvent: () => event }
    const rawTool = messageTools.find(item => item.name === 'send_raw_message')
    const rawResult = await rawTool.handler(
        { segments: [{ type: 'text', data: { text: '正文' } }], group_id: 'group_openid' },
        ctx
    )
    assert.equal(rawResult.success, true)
    assert.equal(rawResult.message_id, 'raw-message')
    assert.equal(sent.length, 1)

    const recordTool = forwardDataTools.find(item => item.name === 'get_message_record')
    const recordResult = await recordTool.handler({ message_id: 'record-message' }, ctx)
    assert.equal(recordResult.success, true)
    assert.equal(recordResult.msgrecord.message_id, 'record-message')
})

test('get_master_info debug 仅主人可用且不返回配置或凭据对象', async () => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    globalThis.Bot ||= {}
    const { messageTools } = await import('../src/mcp/tools/message.js')
    const tool = messageTools.find(item => item.name === 'get_master_info')
    const bot = { adapter: { id: 'QQBot' }, uin: '10000' }
    const event = { bot, user_id: 'user_openid' }
    const denied = await tool.handler(
        { debug: true },
        { getBot: () => bot, getEvent: () => event, isMaster: () => false }
    )
    assert.equal(denied.success, false)
    assert.equal(denied.permissionDenied, true)

    const allowed = await tool.handler(
        { debug: true },
        { getBot: () => bot, getEvent: () => event, isMaster: () => true }
    )
    assert.equal(allowed.success, true)
    assert.doesNotMatch(JSON.stringify(allowed), /token|secret|password|authorization|cookie|config/i)
})

test('adapter metadata 可在全局 Bot 容器场景精确保留 QQBot 数字形 OpenID', () => {
    const api = new StandardBotApi({ bot: {}, adapter: { adapter: 'qqbot' } })
    assert.equal(api.adapterType, 'qqbot')
    assert.equal(api.isQQBot, true)
    assert.equal(api.targetId('123456'), '123456')
    assert.equal(new StandardFileApi(api).adapterType, 'qqbot')
})

test('QQBot 主人列表保留 OpenID，不因 Number 转换丢失', async () => {
    const originalBot = globalThis.Bot
    const originalPluginConfig = globalThis.chatgptPluginConfig
    const botId = 'qqbot-openid-bot'
    globalThis.Bot = {
        [botId]: { adapter: { id: 'QQBot' } },
        config: { master: ['global-master-openid'] }
    }
    globalThis.chatgptPluginConfig = {
        get(key) {
            if (key === 'admin.masterQQ') return ['plugin-master-openid']
            if (key === 'admin.pluginAuthorQQ') return []
            return []
        }
    }
    try {
        const { getMasterList } = await import('../src/mcp/tools/helpers.js')
        const masters = await getMasterList(botId)
        assert.ok(masters.includes('plugin-master-openid'))
        assert.ok(masters.includes('global-master-openid'))
    } finally {
        if (originalBot === undefined) delete globalThis.Bot
        else globalThis.Bot = originalBot
        if (originalPluginConfig === undefined) delete globalThis.chatgptPluginConfig
        else globalThis.chatgptPluginConfig = originalPluginConfig
    }
})

test('Bot 信息统计兼容 Map、数组和普通对象容器', () => {
    const mapInfo = new StandardBotApi({
        bot: {
            fl: new Map([['a', {}]]),
            gl: new Map([
                ['g1', {}],
                ['g2', {}]
            ])
        }
    }).getBotInfo()
    assert.equal(mapInfo.friend_count, 1)
    assert.equal(mapInfo.group_count, 2)

    const objectInfo = new StandardBotApi({
        bot: { fl: { a: {}, b: {} }, gl: [{ group_id: 'g1' }] }
    }).getBotInfo()
    assert.equal(objectInfo.friend_count, 2)
    assert.equal(objectInfo.group_count, 1)
})

test('OneBot 标准 target 统一接收 raw OneBot 消息段', async () => {
    let received
    const api = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({
                async sendMsg(message) {
                    received = message
                    return { message_id: 'onebot-message' }
                }
            })
        }
    })
    await api.sendGroup('123', [
        StandardMessage.image('image.png'),
        StandardMessage.at('456'),
        StandardMessage.reply('message-id'),
        StandardMessage.file('file.txt', 'file.txt'),
        StandardMessage.json({ app: 'card' }),
        StandardMessage.xml('<msg/>'),
        StandardMessage.music('qq', '1'),
        StandardMessage.poke(2, 3)
    ])
    assert.deepEqual(received[0], { type: 'image', data: { file: 'image.png' } })
    assert.deepEqual(received[1], { type: 'at', data: { qq: '456' } })
    assert.deepEqual(received[2], { type: 'reply', data: { id: 'message-id' } })
    assert.deepEqual(received[3], { type: 'file', data: { file: 'file.txt', name: 'file.txt' } })
    assert.equal(received[4].data.data, JSON.stringify({ app: 'card' }))
    assert.equal(received[5].data.data, '<msg/>')
    assert.deepEqual(received[6].data, { type: 'qq', id: '1' })
    assert.deepEqual(received[7].data, { type: 2, id: 3 })
})

test('OneBot 转发优先标准 target，缺少标准方法时才走 raw action', async () => {
    const calls = []
    let dualTargetNodes
    const dualApi = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({
                async sendForwardMsg(nodes) {
                    dualTargetNodes = nodes
                    return [{ message_id: 'target-forward' }]
                }
            }),
            async sendApi(action, params) {
                calls.push([action, params])
                return { retcode: 0, data: { message_id: 'forward-action' } }
            }
        }
    })
    await dualApi.sendForward({
        groupId: '123',
        nodes: [{ user_id: '1', nickname: '发送者', message: StandardMessage.json({ app: 'card' }) }]
    })
    assert.equal(calls.length, 0)
    assert.equal(dualTargetNodes[0].message[0].data.data, JSON.stringify({ app: 'card' }))

    await dualApi.sendForward({
        groupId: '123',
        nodes: [{ user_id: '1', nickname: '发送者', message: '带外显字段' }],
        display: { prompt: '点击查看', summary: '1条消息' }
    })
    assert.equal(calls[0][0], 'send_group_forward_msg')
    assert.equal(calls[0][1].prompt, '点击查看')
    assert.equal(calls[0][1].summary, '1条消息')
    calls.length = 0

    const rawApi = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({}),
            async sendApi(action, params) {
                calls.push([action, params])
                return { retcode: 0, data: { message_id: 'forward-action' } }
            }
        }
    })
    await rawApi.sendForward({
        groupId: '123',
        nodes: [{ user_id: '1', nickname: '发送者', message: StandardMessage.json({ app: 'card' }) }]
    })
    assert.equal(calls[0][0], 'send_group_forward_msg')
    assert.equal(calls[0][1].messages[0].type, 'node')
    assert.equal(calls[0][1].messages[0].data.uin, '1')
    assert.equal(calls[0][1].messages[0].data.name, '发送者')
    assert.equal(calls[0][1].messages[0].data.content[0].data.data, JSON.stringify({ app: 'card' }))

    let temporaryMessage
    const temporaryApi = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({
                pickMember: () => ({
                    async sendMsg(message) {
                        temporaryMessage = message
                        return { message_id: 'temporary' }
                    }
                })
            })
        }
    })
    await temporaryApi.sendTemporary('123', '456', StandardMessage.json({ app: 'card' }))
    assert.equal(temporaryMessage[0].data.data, JSON.stringify({ app: 'card' }))

    let targetNodes
    const targetApi = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({
                async sendForwardMsg(nodes) {
                    targetNodes = nodes
                    return [{ message_id: 'target-forward' }]
                }
            })
        }
    })
    await targetApi.sendForward({
        groupId: '123',
        nodes: [{ user_id: '1', nickname: '发送者', message: StandardMessage.xml('<msg/>') }]
    })
    assert.equal(targetNodes[0].message[0].data.data, '<msg/>')
})

test('文件发送保持 QQBot 段回退与 ICQQ/OneBot 精确 sendFile 签名', async () => {
    const qqCalls = []
    const qqApi = new StandardBotApi({
        bot: {
            adapter: { id: 'QQBot' },
            pickGroup: () => ({
                async sendMsg(message) {
                    qqCalls.push(message)
                    return success('qq-file')
                }
            }),
            pickFriend: () => ({
                async sendMsg(message) {
                    qqCalls.push(message)
                    return success('qq-private-file')
                }
            })
        }
    })
    await qqApi.sendFile({ groupId: 'group_openid', file: '/tmp/a', name: 'a' })
    await qqApi.sendFile({ userId: 'user_openid', file: '/tmp/b', name: 'b' })
    assert.equal(qqCalls[0].type, 'file')
    assert.equal(qqCalls[1].type, 'file')

    const icqqArgs = []
    const icqqApi = new StandardBotApi({
        bot: {
            adapter: { id: 'ICQQ' },
            pickGroup: () => ({ sendFile: async (...args) => (icqqArgs.push(args), true) })
        }
    })
    await icqqApi.sendFile({ groupId: '123', file: 'a', name: 'name' })
    assert.deepEqual(icqqArgs[0], ['a', '/', 'name'])

    const oneBotArgs = []
    const oneBotApi = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({ sendFile: async (...args) => (oneBotArgs.push(args), true) })
        }
    })
    await oneBotApi.sendFile({ groupId: '123', file: 'a', name: 'name' })
    assert.deepEqual(oneBotArgs[0], ['a', 'name'])
})

test('群文件根目录、分组、folder upload 与 df 包装遵循 OneBotv11 契约', async () => {
    const lsArgs = []
    const uploadArgs = []
    const api = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({
                fs: {
                    async ls(...args) {
                        lsArgs.push(args)
                        return { files: [{ file_id: 'f' }], folders: [{ folder_id: 'd' }] }
                    },
                    async upload(...args) {
                        uploadArgs.push(args)
                        return { retcode: 0 }
                    },
                    async df() {
                        return { retcode: 0, data: { total_space: 10, used_space: 1 } }
                    }
                }
            })
        }
    })
    const files = new StandardFileApi(api)
    const root = await files.getGroupRootFiles('123')
    assert.deepEqual(lsArgs[0], [])
    assert.equal(root.files.length, 1)
    assert.equal(root.folders.length, 1)
    assert.equal((await files.listGroupFiles('123')).length, 2)
    await files.uploadGroupFile({ groupId: '123', file: 'a', name: 'a', folderId: 'folder' })
    assert.deepEqual(uploadArgs[0], ['a', 'folder', 'a'])
    assert.deepEqual(await files.getGroupFileSystemInfo('123'), { total_space: 10, used_space: 1 })
})

test('踢人按 ICQQ 三参和 OneBot 两参契约传递 reject_add', async () => {
    const icqqArgs = []
    const icqqApi = new StandardBotApi({
        bot: {
            adapter: { id: 'ICQQ' },
            pickGroup: () => ({ kickMember: async (...args) => (icqqArgs.push(args), true) })
        }
    })
    await icqqApi.kickMember('123', '456', true, '原因')
    assert.deepEqual(icqqArgs[0], [456, '原因', true])

    const oneBotArgs = []
    const oneBotApi = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({ kickMember: async (...args) => (oneBotArgs.push(args), true) })
        }
    })
    await oneBotApi.kickMember('123', '456', true)
    assert.deepEqual(oneBotArgs[0], [456, true])
})

test('群公告、成员戳一戳与精华消息使用已验证的标准对象别名', async () => {
    const calls = []
    const group = {
        async sendNotice(content, image) {
            calls.push(['sendNotice', content, image])
            return true
        },
        pickMember(userId) {
            return { poke: async () => (calls.push(['poke', userId]), true) }
        }
    }
    const api = new StandardBotApi({
        bot: {
            pickGroup: () => group,
            async setEssenceMessage(messageId) {
                calls.push(['setEssenceMessage', messageId])
                return true
            },
            async removeEssenceMessage(messageId) {
                calls.push(['removeEssenceMessage', messageId])
                return true
            }
        }
    })
    await api.sendGroupNotice('123', '公告', { image: 'image.png' })
    await api.pokeMember('123', '456')
    await api.callAction('set_essence_msg', { message_id: 'message' }, { strict: true })
    await api.callAction('delete_essence_msg', { message_id: 'message' }, { strict: true })
    assert.deepEqual(calls, [
        ['sendNotice', '公告', 'image.png'],
        ['poke', 456],
        ['setEssenceMessage', 'message'],
        ['removeEssenceMessage', 'message']
    ])
})

test('标准 reply 完整透传 quote 与 reply data', async () => {
    let received
    const event = {
        group_id: 'group',
        async reply(...args) {
            received = args
            return success('reply-options')
        }
    }
    await new StandardBotApi({ bot: {}, event }).reply('处理中', true, { recallMsg: 60, at: false })
    assert.deepEqual(received, ['处理中', true, { recallMsg: 60, at: false }])
})

test('只有 reply 能力的 Yunzai 事件也可标准回复并校验业务结果', async () => {
    const sent = []
    const event = {
        async reply(message) {
            sent.push(message)
            return undefined
        }
    }
    const api = new StandardBotApi({ event, bot: {} })
    assert.equal((await api.reply('正文')).success, true)
    assert.deepEqual(sent, ['正文'])

    event.reply = async () => ({ message_id: [], data: [], error: [new Error('reply failed')] })
    await assert.rejects(api.reply('失败正文'), /reply failed/)
})

test('转发、图片、引用与文件 URL 查询统一走标准读取接口', async () => {
    const calls = []
    const api = new StandardBotApi({
        bot: {
            getForwardMsg: async id => [{ id }],
            getImage: async id => ({ file_id: id, url: 'https://image' }),
            pickGroup: () => ({ getFileUrl: async id => `https://file/${id}` })
        },
        event: {
            async getReply() {
                return { message_id: 'reply' }
            }
        }
    })
    assert.equal((await api.getForwardMessage('forward'))[0].id, 'forward')
    assert.equal((await api.getImage({ fileId: 'image-id' })).url, 'https://image')
    assert.equal((await api.getReplyMessage()).message_id, 'reply')
    assert.equal(await api.getFileUrl({ fileId: 'file-id', groupId: '123' }), 'https://file/file-id')
    void calls
})

test('QQBot 未知用户与仅 ID 群成员不会伪造资料成功', async () => {
    const api = new StandardBotApi({
        bot: {
            adapter: { id: 'QQBot' },
            fl: new Map(),
            gml: new Map(),
            pickFriend: userId => ({ user_id: userId }),
            pickGroup: groupId => ({ group_id: groupId, pickMember: userId => ({ user_id: userId }) })
        }
    })
    await assert.rejects(api.getUserInfo('unknown_openid'), /get_stranger_info/)
    await assert.rejects(api.getMemberInfo('group_openid', 'unknown_openid'), /get_group_member_info/)
})

test('AI voice 能力只对精确 NapCat 或实际 NT 方法开启', () => {
    assert.equal(
        new StandardBotApi({ bot: { adapter: { id: 'NapCat' }, sendApi() {} } }).supportsCapability('ai_voice'),
        true
    )
    assert.equal(
        new StandardBotApi({ bot: { adapter: { id: 'OneBot' }, sendApi() {} } }).supportsCapability('ai_voice'),
        false
    )
    assert.equal(
        new StandardBotApi({ bot: { adapter: { id: 'ICQQ' }, sendOidbSvcTrpcTcp() {} } }).supportsCapability(
            'ai_voice'
        ),
        true
    )
})

test('消息、转发与历史读取不会吞掉协议端业务错误', async () => {
    const failure = { retcode: 1, message: 'read failed' }
    await assert.rejects(new StandardBotApi({ bot: { getMsg: async () => failure } }).getMessage('1'), /read failed/)
    await assert.rejects(
        new StandardBotApi({ bot: { pickGroup: () => ({ getMsg: async () => failure }) } }).getMessage('1', {
            groupId: '123'
        }),
        /read failed/
    )
    await assert.rejects(
        new StandardBotApi({ bot: { pickGroup: () => ({ getForwardMsg: async () => failure }) } }).getForwardMessage(
            'forward',
            { groupId: '123' }
        ),
        /read failed/
    )
    await assert.rejects(
        new StandardBotApi({ bot: { pickGroup: () => ({ getChatHistory: async () => failure }) } }).getHistory({
            groupId: '123'
        }),
        /read failed/
    )
    await assert.rejects(
        new StandardBotApi({ bot: {}, event: { getReply: async () => failure } }).getReplyMessage(),
        /read failed/
    )
})

test('读取未命中会安全后备，合法空数组保持为空', async () => {
    const calls = []
    const api = new StandardBotApi({
        bot: {
            getMsg: async () => false,
            pickGroup: () => ({ getForwardMsg: async () => null, getChatHistory: async () => [] }),
            async sendApi(action) {
                calls.push(action)
                if (action === 'get_msg') return { retcode: 0, data: { message_id: 'fallback' } }
                if (action === 'get_forward_msg') return { retcode: 0, data: { messages: [] } }
                return { retcode: 0, data: {} }
            }
        }
    })
    assert.equal((await api.getMessage('1')).message_id, 'fallback')
    assert.deepEqual(await api.getForwardMessage('forward', { groupId: '123' }), [])
    assert.deepEqual(await api.getHistory({ groupId: '123' }), [])
    assert.deepEqual(calls, ['get_msg', 'get_forward_msg'])
})

test('群事件中的显式私聊读取不会被当前群覆盖', async () => {
    const calls = []
    const bot = {
        pickGroup() {
            calls.push('group')
            return {}
        },
        pickFriend(userId) {
            calls.push(['friend', userId])
            return {
                getMsg: async id => ({ message_id: id }),
                getForwardMsg: async id => [{ id }]
            }
        }
    }
    const api = new StandardBotApi({ bot, event: { group_id: 'current-group', user_id: 'sender' } })
    assert.equal((await api.getMessage('message', { userId: 'target-user' })).message_id, 'message')
    assert.equal((await api.getForwardMessage('forward', { userId: 'target-user' }))[0].id, 'forward')
    assert.equal(
        calls.some(call => call === 'group'),
        false
    )
    assert.deepEqual(calls, [
        ['friend', 'target-user'],
        ['friend', 'target-user']
    ])
})

test('全局撤回与私聊文件 URL 无需伪造会话目标', async () => {
    const calls = []
    const api = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            async sendApi(action, params) {
                calls.push([action, params])
                if (action === 'get_private_file_url') {
                    return { retcode: 0, data: { url: 'https://file.example/private' } }
                }
                return { retcode: 0 }
            }
        }
    })
    await api.recall({ messageId: 'message-id' })
    assert.equal(await new StandardFileApi(api).getPrivateFileUrl('file-id'), 'https://file.example/private')
    assert.deepEqual(calls, [
        ['delete_msg', { message_id: 'message-id' }],
        ['get_private_file_url', { file_id: 'file-id' }]
    ])
})

test('需要会话目标的标准方法统一拒绝冲突或缺失目标', async () => {
    const api = new StandardBotApi({ bot: {} })
    await assert.rejects(
        api.sendForward({ groupId: '1', userId: '2', nodes: [{ user_id: '3', nickname: 'n', message: 'm' }] }),
        /不能同时提供/
    )
    await assert.rejects(api.sendFile({ groupId: '1', userId: '2', file: 'f' }), /不能同时提供/)
    await assert.rejects(api.getHistory(), /需要当前事件或显式/)
    await assert.rejects(api.recall({ messageId: '1', groupId: '1', userId: '2' }), /不能同时提供/)
})

test('StandardBotApi 在 QQBot 群历史中保留 message_id 字符串锚点', async () => {
    const calls = []
    const bot = { adapter: { id: 'QQBot' } }
    const event = {
        bot,
        group_id: 'group-openid',
        message_id: 'message-openid',
        group: {
            async getChatHistory(sequence, count) {
                calls.push([sequence, count])
                return [{ message_id: sequence, seq: sequence }]
            }
        }
    }
    const api = new StandardBotApi({ bot, event })
    const history = await api.getHistory({ groupId: 'group-openid', sequence: 0, count: 1 })
    assert.equal(history[0].message_id, 'message-openid')
    assert.deepEqual(calls, [['message-openid', 1]])

    const noAnchor = new StandardBotApi({
        bot: { adapter: { id: 'QQBot' }, pickGroup: () => event.group }
    })
    await assert.rejects(noAnchor.getHistory({ groupId: 'group-openid', sequence: 0 }), /message_id/)
})

test('事件标准对象不依赖 event.reply 才能被解析', () => {
    const group = { group_id: 'group-openid' }
    const friend = { user_id: 'user-openid' }
    const event = { group_id: 'group-openid', user_id: 'user-openid', group, friend }
    const api = new StandardBotApi({ bot: {}, event, adapter: { adapter: 'qqbot' } })
    assert.equal(api.group('group-openid'), group)

    const privateEvent = { user_id: 'user-openid', friend }
    assert.equal(new StandardBotApi({ bot: {}, event: privateEvent }).friend('user-openid'), friend)
})

test('状态默认在线，凭据读取兼容 OneBot data 包装', async () => {
    const api = new StandardBotApi({
        bot: {
            self_id: 10000,
            async sendApi(action) {
                if (action === 'get_cookies') return { retcode: 0, data: { cookies: 'p_skey=value' } }
                if (action === 'get_credentials') return { retcode: 0, data: { csrf_token: 12345 } }
                return null
            }
        }
    })
    assert.equal((await api.getBotStatus()).online, true)
    assert.deepEqual(await api.getCredentials('qun.qq.com'), {
        cookies: 'p_skey=value',
        csrfToken: 12345,
        userId: '10000'
    })
})

test('文件读取校验业务错误且列表接口保留精确形状', async () => {
    const failedUrlApi = new StandardBotApi({
        bot: { pickGroup: () => ({ getFileUrl: async () => ({ retcode: 100, message: 'download failed' }) }) }
    })
    await assert.rejects(new StandardFileApi(failedUrlApi).getGroupFileUrl('123', 'file'), /download failed/)

    const failedListApi = new StandardBotApi({ bot: { pickGroup: () => ({ fs: { ls: async () => false } }) } })
    await assert.rejects(new StandardFileApi(failedListApi).listGroupFiles('123'), /group\.fs\.ls/)
})

test('目录标准对象读取拒绝业务错误并允许合法空列表', async () => {
    const failure = { retcode: 1, message: 'directory failed' }
    await assert.rejects(
        new StandardBotApi({ bot: { pickGroup: () => ({ getInfo: async () => failure }) } }).getGroupInfo('123'),
        /directory failed/
    )
    await assert.rejects(
        new StandardBotApi({ bot: { getGroupMap: async () => failure } }).getGroupList(),
        /directory failed/
    )
    await assert.rejects(
        new StandardBotApi({ bot: { getFriendMap: async () => failure } }).getFriendList(),
        /directory failed/
    )
    await assert.rejects(
        new StandardBotApi({ bot: { pickGroup: () => ({ getMemberMap: async () => failure }) } }).getMemberList('123'),
        /directory failed/
    )
    await assert.rejects(
        new StandardBotApi({
            bot: { pickGroup: () => ({ pickMember: () => ({ getInfo: async () => failure }) }) }
        }).getMemberInfo('123', '456'),
        /directory failed/
    )
    await assert.rejects(
        new StandardBotApi({ bot: { pickFriend: () => ({ getInfo: async () => failure }) } }).getUserInfo('456'),
        /directory failed/
    )
    await assert.rejects(
        new StandardBotApi({ bot: { pickGroup: () => ({ getNoticeList: async () => failure }) } }).getGroupNotices(
            '123'
        ),
        /directory failed/
    )

    assert.deepEqual(await new StandardBotApi({ bot: { getGroupMap: async () => new Map() } }).getGroupList(), [])
    assert.deepEqual(
        await new StandardBotApi({ bot: { pickGroup: () => ({ getMemberMap: async () => new Map() }) } }).getMemberList(
            '123'
        ),
        []
    )
})

test('OneBot node 序列化兼容 raw 单节点与标准 node 容器', () => {
    const raw = serializeOneBotMessage({
        type: 'node',
        data: { uin: 'openid', name: '发送者', content: [{ type: 'text', data: { text: '正文' } }] }
    })
    assert.deepEqual(raw, [
        {
            type: 'node',
            data: { uin: 'openid', name: '发送者', content: [{ type: 'text', data: { text: '正文' } }] }
        }
    ])

    const container = serializeOneBotMessage(
        StandardMessage.node([StandardMessage.nodeItem('openid', '发送者', StandardMessage.text('正文'))])
    )
    assert.equal(container[0].type, 'node')
    assert.equal(container[0].data[0].uin, 'openid')
    assert.equal(container[0].data[0].name, '发送者')
    assert.deepEqual(container[0].data[0].content, [{ type: 'text', data: { text: '正文' } }])
})

test('深度解析工具统一限制 max_depth 为 1 到 10', async () => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    globalThis.Bot ||= {}
    const { ForwardMessageParser } = await import('../src/utils/messageParser.js')
    const originalParse = ForwardMessageParser.parse
    const depths = []
    ForwardMessageParser.parse = async (_event, _id, options) => {
        depths.push(options.maxDepth)
        return { success: true, totalCount: 0, method: 'mock', messages: [], errors: [], raw: null }
    }
    try {
        const { forwardDataTools, messageTools } = await import('../src/mcp/tools/message.js')
        const ctx = { getBot: () => ({}), getEvent: () => ({ group_id: '123' }) }
        const deep = messageTools.find(item => item.name === 'deep_parse_message')
        for (const [value, expected] of [
            [undefined, 5],
            [0, 1],
            [-3, 1],
            [100, 10]
        ]) {
            const result = await deep.handler({ forward_id: 'forward', max_depth: value }, ctx)
            assert.equal(result.max_depth, expected)
        }
        await messageTools.find(item => item.name === 'get_forward_msg').handler({ id: 'forward', max_depth: 100 }, ctx)
        await forwardDataTools
            .find(item => item.name === 'extract_forward_data')
            .handler({ id: 'forward', max_depth: 100 }, ctx)
        assert.deepEqual(depths, [10, 10])
    } finally {
        ForwardMessageParser.parse = originalParse
    }
})

test('自定义工具上下文公开标准 api、message 与 adapter 元数据', async () => {
    globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
    globalThis.Bot ||= {}
    const { BuiltinMcpServer } = await import('../src/mcp/BuiltinMcpServer.js')
    const server = new BuiltinMcpServer()
    const bot = {}
    const context = server.createRequestContext({
        isMaster: true,
        bot,
        adapterInfo: { adapter: 'qqbot', isNT: false, canAiVoice: false }
    })
    assert.equal(context.getApi().targetId('123456'), '123456')
    assert.equal(context.message, StandardMessage)
})
