import assert from 'node:assert/strict'

global.Bot = {}
global.logger = {
    debug() {},
    info() {},
    warn() {},
    error() {}
}

const { detectAdapter, sendGroupMessage, sendPrivateMessage, getGroupMemberList, deleteMessage } =
    await import('../src/utils/platformAdapter.js')
const { normalizeSegment, sendMessage, sendForwardMsgEnhanced } = await import('../src/mcp/tools/helpers.js')
const { parseUserMessage } = await import('../src/utils/messageParser.js')
const { messageTools } = await import('../src/mcp/tools/message.js')

const calls = []
const successResult = id => ({ message_id: [id], data: [{ id }], error: [] })
const group = {
    async sendMsg(message) {
        calls.push(['group.sendMsg', message])
        return successResult('group-message')
    },
    async getMemberMap() {
        return new Map([['member_openid', { user_id: 'member_openid', nickname: '成员', role: 'member' }]])
    },
    async recallMsg() {
        return [true]
    },
    pickMember(userId) {
        calls.push(['group.pickMember', userId])
        return { user_id: userId, nickname: '成员', role: 'member' }
    }
}
const friend = {
    async sendMsg(message) {
        calls.push(['friend.sendMsg', message])
        return successResult('private-message')
    },
    async recallMsg() {
        return [true]
    },
    getAvatarUrl() {
        return 'https://q.qlogo.cn/qqapp/appid/member_openid/0'
    }
}
const bot = {
    adapter: { id: 'QQBot', name: 'QQBot' },
    version: { id: 'QQBot', name: 'QQBot' },
    uin: '10001',
    fl: new Map(),
    gl: new Map(),
    gml: new Map(),
    pickGroup(groupId) {
        calls.push(['pickGroup', groupId])
        return group
    },
    pickFriend(userId) {
        calls.push(['pickFriend', userId])
        return friend
    }
}
const event = {
    bot,
    self_id: '10001',
    user_id: 'member_openid',
    _raw_user_id: 'member_openid',
    group_id: 'group_openid',
    _raw_group_id: 'group_openid',
    sender: { user_id: 'member_openid', nickname: '成员' },
    isGroup: true,
    async reply(message) {
        calls.push(['event.reply', message])
        return successResult('reply-message')
    }
}

assert.equal(detectAdapter(event), 'qqbot')

await sendGroupMessage(event, 'other_group_openid', '跨群')
assert.deepEqual(
    calls.find(item => item[0] === 'pickGroup'),
    ['pickGroup', 'other_group_openid']
)
calls.length = 0

await sendPrivateMessage(event, 'other_user_openid', '私聊')
assert.deepEqual(
    calls.find(item => item[0] === 'pickFriend'),
    ['pickFriend', 'other_user_openid']
)
calls.length = 0

const current = await sendMessage({ event, message: '当前群回复' })
assert.equal(current.success, true)
assert.equal(current.method, 'event.reply')
assert.equal(current.message_id, 'reply-message')
calls.length = 0

const crossPrivate = await sendMessage({ event, userId: 'other_user_openid', message: '群内主动私聊' })
assert.equal(crossPrivate.success, true)
assert.equal(crossPrivate.method, 'pickFriend.sendMsg')
assert.equal(
    calls.some(item => item[0] === 'event.reply'),
    false
)
assert.equal(
    calls.some(item => item[0] === 'pickGroup'),
    false
)
assert.deepEqual(
    calls.find(item => item[0] === 'pickFriend'),
    ['pickFriend', 'other_user_openid']
)
calls.length = 0

const members = await getGroupMemberList(event, 'group_openid')
assert.equal(members[0].user_id, 'member_openid')
assert.equal(calls.find(item => item[0] === 'pickGroup')[1], 'group_openid')
calls.length = 0

const forward = await sendForwardMsgEnhanced({
    bot,
    event,
    messages: [{ user_id: 'member_openid', nickname: '成员', message: '转发正文' }]
})
assert.equal(forward.success, true)
const sentNode = calls.find(item => item[0] === 'event.reply')[1]
assert.equal(sentNode.type, 'node')
assert.ok(Array.isArray(sentNode.data))
assert.equal(sentNode.data[0].message[0].type, 'text')
assert.equal(sentNode.data[0].message[0].text, '转发正文')
calls.length = 0
const jsonString = JSON.stringify({ app: 'test.card', prompt: '卡片' })
const jsonForward = await sendForwardMsgEnhanced({
    bot,
    event,
    messages: [{ user_id: 'member_openid', nickname: '成员', message: [{ type: 'json', data: jsonString }] }]
})
assert.equal(jsonForward.success, true)
const jsonNode = calls.find(item => item[0] === 'event.reply')[1]
assert.equal(jsonNode.data[0].message[0].data, jsonString)
assert.equal(
    Object.keys(jsonNode.data[0].message[0]).some(key => /^\d+$/.test(key)),
    false
)

const nestedNode = normalizeSegment(
    { type: 'node', title: '嵌套标题', data: [{ message: [{ type: 'text', text: '嵌套内容' }] }] },
    'qqbot',
    bot
)
assert.equal(nestedNode.title, '嵌套标题')
assert.ok(Array.isArray(nestedNode.data))
assert.equal(nestedNode.data[0].message[0].text, '嵌套内容')

const parsed = await parseUserMessage(
    {
        ...event,
        message: [
            {
                type: 'node',
                title: '转发',
                data: [
                    {
                        nickname: '甲',
                        message: [
                            { type: 'text', text: '外层正文' },
                            {
                                type: 'node',
                                data: [{ nickname: '乙', message: [{ type: 'text', text: '内层正文' }] }]
                            }
                        ]
                    }
                ]
            },
            { type: 'at', qq: 'member_openid', name: '成员' }
        ]
    },
    { handleAtMsg: true, excludeAtBot: false }
)
const parsedText = parsed.content
    .filter(item => item.type === 'text')
    .map(item => item.text)
    .join('\n')
assert.match(parsedText, /外层正文/)
assert.match(parsedText, /内层正文/)
assert.match(parsedText, /member_openid/)
assert.ok(calls.some(item => item[0] === 'group.pickMember' && item[1] === 'member_openid'))
calls.length = 0

const sendGroupTool = messageTools.find(tool => tool.name === 'send_group_message')
const toolResult = await sendGroupTool.handler(
    { group_id: 'group_openid', message: '工具群回复' },
    { getBot: () => bot, getEvent: () => event }
)
assert.equal(toolResult.success, true)
assert.equal(toolResult.message_id, 'reply-message')
assert.equal(
    calls.some(item => item[0] === 'event.reply'),
    true
)

const failedEvent = {
    ...event,
    async reply() {
        return { message_id: [], data: [], error: [new Error('QQBot send failed')] }
    }
}
const failedResult = await sendGroupTool.handler(
    { group_id: 'group_openid', message: '失败回复' },
    { getBot: () => bot, getEvent: () => failedEvent }
)
assert.equal(failedResult.success, false)
assert.match(failedResult.error, /QQBot send failed/)

assert.equal(await deleteMessage(event, 'message-id'), true)

console.log('qqbot-tooling-regression: PASS')
