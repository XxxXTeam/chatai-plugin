import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.logger ||= { debug() {}, info() {}, warn() {}, error() {} }
globalThis.Bot ||= {}

const { ForwardMessageParser, MessageApi, NapCatMessageUtils, parseUserMessage } =
    await import('../src/utils/messageParser.js')

test('parseUserMessage 通过标准接口查询 QQBot OpenID 成员与字符串图片 URL', async () => {
    const calls = []
    const member = {
        info: {
            user_id: 'member_openid',
            nickname: '成员昵称',
            card: '群名片',
            role: 'admin',
            title: '头衔'
        }
    }
    const bot = {
        adapter: { id: 'QQBot' },
        pickGroup(groupId) {
            calls.push(['pickGroup', groupId])
            return {
                pickMember(userId) {
                    calls.push(['pickMember', userId])
                    return member
                }
            }
        },
        async getImage(fileId) {
            calls.push(['getImage', fileId])
            return 'https://example.com/image.png'
        }
    }
    const event = {
        bot,
        group_id: 'group_openid',
        user_id: 'sender_openid',
        self_id: 'bot_openid',
        isGroup: true,
        message: [
            { type: 'at', qq: 'member_openid', name: '成员' },
            { type: 'image', file_id: 'image_file_id' }
        ]
    }

    const parsed = await parseUserMessage(event, { excludeAtBot: false })
    const atInfo = parsed.content.find(item => item.type === 'at_info')
    const image = parsed.content.find(item => item.type === 'image_url')

    assert.equal(atInfo.at.qq, 'member_openid')
    assert.equal(atInfo.at.card, '群名片')
    assert.equal(image.image_url.url, 'https://example.com/image.png')
    assert.deepEqual(calls, [
        ['pickGroup', 'group_openid'],
        ['pickMember', 'member_openid'],
        ['getImage', 'image_file_id']
    ])
})

test('引用读取与文件 URL 查询只经过标准事件和目标接口', async () => {
    const calls = []
    const group = {
        async getFileUrl(fileId) {
            calls.push(['getFileUrl', fileId])
            return 'https://example.com/document.txt'
        }
    }
    const event = {
        bot: { adapter: { id: 'QQBot' } },
        group,
        group_id: 'group_openid',
        user_id: 'sender_openid',
        self_id: 'bot_openid',
        isGroup: true,
        source: { message_id: 'quoted_message' },
        message: [{ type: 'text', text: '当前消息' }],
        async getReply() {
            calls.push(['getReply'])
            return {
                message_id: 'quoted_message',
                user_id: 'quoted_openid',
                sender: { user_id: 'quoted_openid', nickname: '引用用户' },
                message: [{ type: 'file', fid: 'file_openid', name: 'document.txt' }]
            }
        }
    }

    const parsed = await parseUserMessage(event)
    const text = parsed.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n')

    assert.match(text, /document\.txt/)
    assert.match(text, /https:\/\/example\.com\/document\.txt/)
    assert.deepEqual(calls, [['getReply'], ['getFileUrl', 'file_openid']])
})

test('引用消息的合并转发直接解析内联节点，不依赖远程转发接口', async () => {
    const event = {
        bot: {
            adapter: { id: 'OneBot' },
            async sendApi(action) {
                throw new Error(`不应调用 ${action}`)
            }
        },
        group_id: '123456',
        user_id: 'sender',
        source: { message_id: 'quoted-forward' },
        async getReply() {
            return {
                message_id: 'quoted-forward',
                user_id: 'quoted-user',
                sender: { user_id: 'quoted-user', nickname: '引用用户' },
                message: [
                    {
                        type: 'forward',
                        data: {
                            nodes: [
                                {
                                    user_id: 'node-user',
                                    nickname: '节点用户',
                                    content: [{ type: 'text', text: '内联转发正文' }]
                                }
                            ]
                        }
                    }
                ]
            }
        },
        message: [{ type: 'text', text: '当前消息' }]
    }

    const parsed = await parseUserMessage(event)
    const text = parsed.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n')

    assert.match(text, /内联转发正文/)
    assert.equal(parsed.quote.content.includes('内联转发正文'), true)
})

test('引用接口直接返回 forward 对象时保留外层类型并解析节点内容', async () => {
    const event = {
        bot: { adapter: { id: 'OneBot' } },
        group_id: '123456',
        user_id: 'sender',
        source: { message_id: 'quoted-forward-direct' },
        async getReply() {
            return {
                type: 'forward',
                id: 'inline-forward',
                data: {
                    nodes: [
                        {
                            user_id: 'node-user',
                            nickname: '节点用户',
                            content: [{ type: 'text', text: '直接转发对象正文' }]
                        }
                    ]
                }
            }
        },
        message: [{ type: 'text', text: '当前消息' }]
    }

    const parsed = await parseUserMessage(event)
    const text = parsed.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n')

    assert.match(text, /直接转发对象正文/)
    assert.equal(parsed.quote.content.includes('直接转发对象正文'), true)
})

test('引用 source 中的 node 数组可以直接解析，不依赖远程转发接口', async () => {
    const event = {
        bot: {
            adapter: { id: 'OneBot' },
            async sendApi(action) {
                throw new Error(`不应调用 ${action}`)
            }
        },
        group_id: '123456',
        user_id: 'sender',
        source: {
            message: [
                {
                    type: 'node',
                    data: [
                        {
                            user_id: 'node-user',
                            nickname: '节点用户',
                            message: [{ type: 'text', text: 'source 节点正文' }]
                        }
                    ]
                }
            ]
        },
        message: [{ type: 'text', text: '当前消息' }]
    }

    const parsed = await parseUserMessage(event)
    const text = parsed.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n')

    assert.match(text, /source 节点正文/)
})

test('标准引用查询失败时从内置消息缓存恢复原消息', async () => {
    const { cacheGroupMessage, messageCache } = await import('../src/services/storage/MessageCache.js')
    messageCache.clear()
    cacheGroupMessage({
        message_id: 'cached-quote',
        group_id: 'cached-group',
        user_id: 'cached-user',
        sender: { user_id: 'cached-user', nickname: '缓存用户' },
        message: [{ type: 'text', text: '缓存引用正文' }]
    })

    const parsed = await parseUserMessage({
        bot: { adapter: { id: 'QQBot' } },
        group_id: 'cached-group',
        user_id: 'current-user',
        source: { message_id: 'cached-quote' },
        async getReply() {
            return null
        },
        message: [{ type: 'text', text: '当前消息' }]
    })

    assert.equal(parsed.quote.sender.nickname, '缓存用户')
    assert.equal(parsed.quote.content, '缓存引用正文')
})

test('MessageApi getMsg/getForward/member/send/delete 均保持 QQBot OpenID', async () => {
    const calls = []
    const group = {
        async getForwardMsg(id) {
            calls.push(['getForwardMsg', id])
            return [{ nickname: '节点', message: [{ type: 'text', text: '转发内容' }] }]
        },
        pickMember(userId) {
            calls.push(['pickMember', userId])
            return { info: { user_id: userId, nickname: '成员' } }
        },
        async sendMsg(message) {
            calls.push(['group.sendMsg', message])
            return { message_id: 'sent_group_message' }
        },
        async recallMsg(messageId) {
            calls.push(['recallMsg', messageId])
            return true
        }
    }
    const bot = {
        adapter: { id: 'QQBot' },
        async getMsg(messageId) {
            calls.push(['getMsg', messageId])
            return {
                message_id: messageId,
                user_id: 'sender_openid',
                group_id: 'group_openid',
                message: [{ type: 'text', text: '正文' }]
            }
        },
        pickGroup(groupId) {
            calls.push(['pickGroup', groupId])
            return group
        },
        pickFriend(userId) {
            calls.push(['pickFriend', userId])
            return {
                async sendMsg(message) {
                    calls.push(['friend.sendMsg', message])
                    return { message_id: 'sent_private_message' }
                }
            }
        }
    }
    const event = { bot, group, group_id: 'group_openid', user_id: 'sender_openid', isGroup: true }

    const message = await MessageApi.getMsg(event, 'message_openid')
    const forward = await MessageApi.getForwardMsg(event, 'forward_resid')
    const memberInfo = await MessageApi.getGroupMemberInfo(event, 'group_openid', 'member_openid')
    const groupSent = await MessageApi.sendGroupMsg(event, 'other_group_openid', '群消息')
    const privateSent = await MessageApi.sendPrivateMsg(event, 'friend_openid', '私聊消息')
    const deleted = await MessageApi.deleteMsg(event, 'message_openid')

    assert.equal(message.message_id, 'message_openid')
    assert.equal(forward[0].nickname, '节点')
    assert.equal(memberInfo.user_id, 'member_openid')
    assert.equal(groupSent.message_id, 'sent_group_message')
    assert.equal(privateSent.message_id, 'sent_private_message')
    assert.equal(groupSent.success, undefined)
    assert.equal(privateSent.success, undefined)
    assert.equal(deleted, true)
    assert.ok(calls.some(call => call[0] === 'pickGroup' && call[1] === 'other_group_openid'))
    assert.ok(calls.some(call => call[0] === 'pickFriend' && call[1] === 'friend_openid'))
    assert.ok(calls.some(call => call[0] === 'recallMsg' && call[1] === 'message_openid'))
})

test('ForwardMessageParser 使用标准转发查询并保留解析能力', async () => {
    const calls = []
    const event = {
        bot: {
            adapter: { id: 'QQBot' },
            pickGroup(groupId) {
                calls.push(['pickGroup', groupId])
                return {
                    async getForwardMsg(id) {
                        calls.push(['getForwardMsg', id])
                        return [
                            { user_id: 'member_openid', nickname: '成员', message: [{ type: 'text', text: '正文' }] }
                        ]
                    }
                }
            }
        },
        group_id: 'group_openid'
    }

    const parsed = await ForwardMessageParser.parse(event, 'forward_resid', {
        extractProto: false,
        extractSerialized: false
    })

    assert.equal(parsed.success, true)
    assert.equal(parsed.method, 'standard_api')
    assert.equal(parsed.messages[0].user_id, 'member_openid')
    assert.match(ForwardMessageParser.toReadableText(parsed), /成员: 正文/)
    assert.deepEqual(calls, [
        ['pickGroup', 'group_openid'],
        ['getForwardMsg', 'forward_resid']
    ])
})

test('NapCat 识别基于精确适配器，读操作仍委托标准边界', async () => {
    const oneBot = { bot: { adapter: { id: 'OneBot' }, sendApi: async () => ({ retcode: 0 }) } }
    assert.equal(NapCatMessageUtils.isNapCat(oneBot), false)

    const calls = []
    const napCat = {
        bot: {
            adapter: { id: 'NapCat' },
            async sendApi(action, params) {
                calls.push([action, params])
                if (action === 'get_msg') {
                    return { retcode: 0, data: { message_id: params.message_id, message: [] } }
                }
                if (action === 'get_forward_msg') {
                    return { retcode: 0, data: { messages: [{ nickname: '节点', message: [] }] } }
                }
                return { retcode: 1404, message: 'unsupported' }
            }
        },
        group_id: '123456'
    }

    assert.equal(NapCatMessageUtils.isNapCat(napCat), true)
    assert.equal((await NapCatMessageUtils.getFullMessage(napCat, 'message-1')).message_id, 'message-1')
    assert.equal((await NapCatMessageUtils.getForwardMessage(napCat, 'forward-1')).messages.length, 1)
    assert.deepEqual(calls, [
        ['get_msg', { message_id: 'message-1' }],
        ['get_forward_msg', { id: 'forward-1' }]
    ])
})

test('引用 ICQQ long_msg 时解析转发资源内容', async () => {
    const calls = []
    const event = {
        bot: {
            adapter: { id: 'QQ', name: 'ICQQ' },
            pickGroup(groupId) {
                calls.push(['pickGroup', groupId])
                return {
                    async getForwardMsg(resid) {
                        calls.push(['getForwardMsg', resid])
                        return [
                            {
                                user_id: 'quoted-user',
                                nickname: '引用用户',
                                message: [{ type: 'text', text: '长消息正文' }]
                            }
                        ]
                    }
                }
            }
        },
        group_id: '123456',
        user_id: 'current-user',
        self_id: '10000',
        source: { message_id: 'current-message' },
        async getReply() {
            return {
                message_id: 'current-message',
                user_id: 'quoted-user',
                sender: { user_id: 'quoted-user', nickname: '引用用户' },
                message: [{ type: 'long_msg', resid: 'long-message-resid' }]
            }
        },
        message: [{ type: 'text', text: '当前消息' }]
    }

    const parsed = await parseUserMessage(event)
    const text = parsed.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n')

    assert.match(text, /长消息正文/)
    assert.match(parsed.quote.content, /长消息正文/)
    assert.deepEqual(calls, [
        ['pickGroup', 123456],
        ['getForwardMsg', 'long-message-resid']
    ])
})

test('上下文工具与引用上下文都能展开 ICQQ long_msg', async () => {
    const group = {
        async getForwardMsg(resid) {
            assert.equal(resid, 'context-forward-resid')
            return [
                {
                    user_id: 'quoted-user',
                    nickname: '引用用户',
                    message: [{ type: 'text', text: '上下文长消息正文' }]
                }
            ]
        }
    }
    const bot = {
        adapter: { id: 'QQ', name: 'ICQQ' },
        pickGroup() {
            return group
        }
    }
    const event = {
        bot,
        group,
        group_id: '123456',
        user_id: 'current-user',
        source: { message_id: 'quoted-message' },
        async getReply() {
            return {
                message_id: 'quoted-message',
                user_id: 'quoted-user',
                sender: { user_id: 'quoted-user', nickname: '引用用户' },
                message: [{ type: 'long_msg', resid: 'context-forward-resid' }]
            }
        },
        message: [{ type: 'text', text: '当前消息' }]
    }

    const { contextTools } = await import('../src/mcp/tools/context.js')
    const getReplyMessage = contextTools.find(tool => tool.name === 'get_reply_message')
    const contextResult = await getReplyMessage.handler(
        { include_chain: false },
        {
            getEvent: () => event,
            getBot: () => bot
        }
    )
    assert.equal(contextResult.success, true)
    assert.match(contextResult.reply.content, /上下文长消息正文/)

    const { contextManager } = await import('../src/services/llm/ContextManager.js')
    const quoteResult = await contextManager.getQuoteContent(event, { includeChain: false })
    assert.match(quoteResult.text, /上下文长消息正文/)
})

test('协议端读取业务错误不会被 MessageApi 当作正常消息', async () => {
    const messageEvent = {
        bot: {
            adapter: { id: 'QQBot' },
            getMsg: async () => ({ retcode: 100, message: 'message denied' }),
            pickFriend: () => ({})
        },
        user_id: 'user_openid'
    }
    assert.equal(await MessageApi.getMsg(messageEvent, 'message_openid'), null)

    const forwardEvent = {
        bot: { adapter: { id: 'QQBot' } },
        group_id: 'group_openid',
        group: {
            getForwardMsg: async () => ({ retcode: 101, message: 'forward denied' })
        }
    }
    assert.equal(await MessageApi.getForwardMsg(forwardEvent, 'forward_resid'), null)
})
