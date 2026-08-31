import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { formatStandardBotApiViolations, scanStandardBotApiBusinessFiles } from './support/standardBotApiAstGuard.js'

const root = path.resolve('.')
const toolsDir = path.join(root, 'src', 'mcp', 'tools')
const toolFiles = fs
    .readdirSync(toolsDir)
    .filter(name => name.endsWith('.js'))
    .map(name => path.join(toolsDir, name))

function listJavaScriptFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const target = path.join(directory, entry.name)
        return entry.isDirectory() ? listJavaScriptFiles(target) : entry.name.endsWith('.js') ? [target] : []
    })
}

const legacyAdapterPath = '(?:botCompat|eventAdapter|platformAdapter)\\.js'
const forbiddenImports = new RegExp(
    `(?:from\\s+['"][^'"]*${legacyAdapterPath}['"]|import\\s*\\(\\s*['"][^'"]*${legacyAdapterPath}['"]\\s*\\)|require\\s*\\(\\s*['"][^'"]*${legacyAdapterPath}['"]\\s*\\))`
)
const forbiddenProtocolCalls =
    /\b(?:isQQBot|isIcqq|isNapCat|detectProtocol|normalizeBotTargetId|isCurrentEventTarget)\s*\(/
const directNames = [
    'pickGroup',
    'pickFriend',
    'pickUser',
    'pickMember',
    'sendApi',
    'sendGroupMsg',
    'sendPrivateMsg',
    'send_group_msg',
    'send_private_msg',
    'getMsg',
    'getForwardMsg',
    'getChatHistory',
    'getGroupMap',
    'getFriendMap',
    'getMemberMap',
    'getNoticeList',
    'sendMsg',
    'sendForwardMsg',
    'recallMsg',
    'setGroupKick',
    'setGroupKickBan',
    'setGroupAdmin',
    'setGroupSpecialTitle',
    'sendOidbSvcTrpcTcp',
    'sendOidb',
    'sendUni',
    'writeUni',
    'sendPacket',
    'sendMergeUni'
].join('|')
const forbiddenDirectCalls = new RegExp(
    `(?:\\.(?:${directNames})(?:\\?\\.)?\\s*\\(|\\[['"](?:${directNames})['"]\\](?:\\?\\.)?\\s*\\()`
)
const forbiddenDirectDestructure = new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b(?:${directNames})\\b[^}]*\\}`)
const forbiddenReflectLookup = new RegExp(`\\bReflect\\.get\\s*\\([^,]+,\\s*['"](?:${directNames})['"]`)
const forbiddenAdapterLookup = /\bctx\??\.getAdapter(?:\?\.)?\s*\(/
const forbiddenBotLookup = /\bctx\??\.getBot(?:\?\.)?\s*\(/
const forbiddenEventReply = /\b(?:e|event)\??\.reply(?:\?\.)?\s*\(/
const legacySegmentImport = /import\s*\{[^}]*\bsegment\b[^}]*\}\s*from\s*['"][^'"]*messageParser\.js['"]/

function assertNoDirectProtocol(source, label) {
    assert.doesNotMatch(source, forbiddenDirectCalls, `${label} 不得直接调用 Bot 协议方法`)
    assert.doesNotMatch(source, forbiddenDirectDestructure, `${label} 不得解构 Bot 协议方法`)
    assert.doesNotMatch(source, forbiddenReflectLookup, `${label} 不得通过 Reflect.get 隐藏协议方法`)
}

test('业务工具只能通过 StandardBotApi 边界访问协议端', () => {
    const astViolations = scanStandardBotApiBusinessFiles(root)
    assert.equal(astViolations.length, 0, formatStandardBotApiViolations(astViolations))

    for (const file of toolFiles.filter(file => path.basename(file) !== 'helpers.js')) {
        const source = fs.readFileSync(file, 'utf8')
        assert.doesNotMatch(source, forbiddenImports, `${path.basename(file)} 不得导入旧协议适配器`)
        assert.doesNotMatch(source, forbiddenProtocolCalls, `${path.basename(file)} 不得自行识别协议或转换目标 ID`)
        assertNoDirectProtocol(source, path.basename(file))
        assert.doesNotMatch(source, forbiddenAdapterLookup, `${path.basename(file)} 不得读取旧 ctx.getAdapter()`)
        assert.doesNotMatch(source, forbiddenBotLookup, `${path.basename(file)} 不得读取旧 ctx.getBot()`)
        assert.doesNotMatch(source, forbiddenEventReply, `${path.basename(file)} 不得直接调用 event.reply`)
        assert.doesNotMatch(source, legacySegmentImport, `${path.basename(file)} 不得导入旧 messageParser.segment`)
    }
})

test('helpers 只保留 deprecated 薄代理，不再包含协议分支', () => {
    const source = fs.readFileSync(path.join(toolsDir, 'helpers.js'), 'utf8')
    assert.doesNotMatch(source, forbiddenImports)
    assertNoDirectProtocol(source, 'helpers.js')
    assert.doesNotMatch(source, forbiddenAdapterLookup)
    assert.match(source, /export function detectProtocol\(bot\) \{\s*return detectStandardAdapter\(bot\)\s*\}/)
    assert.match(source, /export const compatSegment = StandardMessage/)
    assert.match(source, /return getStandardResultError\(result\)/)
})

test('core/platform 是叶子边界，不反向依赖旧兼容模块', () => {
    const platformDir = path.join(root, 'src', 'core', 'platform')
    for (const name of fs.readdirSync(platformDir).filter(file => file.endsWith('.js'))) {
        const source = fs.readFileSync(path.join(platformDir, name), 'utf8')
        assert.doesNotMatch(
            source,
            /(?:from\s+['"][^'"]*(?:utils|mcp\/tools)\/|import\s*\(\s*['"][^'"]*(?:utils|mcp\/tools)\/|require\s*\(\s*['"][^'"]*(?:utils|mcp\/tools)\/)/,
            `${name} 出现反向依赖`
        )
    }
})

test('MCP 运行时和工具服务不重新实现协议动作', () => {
    const infrastructureFiles = [
        ...listJavaScriptFiles(path.join(root, 'src', 'mcp')).filter(
            file => !file.startsWith(`${toolsDir}${path.sep}`)
        ),
        ...listJavaScriptFiles(path.join(root, 'src', 'services', 'tools'))
    ]
    for (const file of infrastructureFiles) {
        const source = fs.readFileSync(file, 'utf8')
        assertNoDirectProtocol(source, path.relative(root, file))
        assert.doesNotMatch(source, forbiddenEventReply, `${path.relative(root, file)} 不得直接调用 event.reply`)
    }
    const builtinSource = fs.readFileSync(path.join(root, 'src', 'mcp', 'BuiltinMcpServer.js'), 'utf8')
    assert.match(builtinSource, /platform:\s*\{\s*api:\s*platformApi,\s*message:\s*StandardMessage,/)
    assert.match(builtinSource, /context:\s*\{[^}]*getApi:\s*\(\)\s*=>\s*platformApi,[^}]*message:\s*StandardMessage/s)
})

test('旧平台模块仅保留无协议分支的兼容代理', () => {
    const utilsDir = path.join(root, 'src', 'utils')
    const botCompat = fs.readFileSync(path.join(utilsDir, 'botCompat.js'), 'utf8')
    assert.doesNotMatch(botCompat, /\b(?:function|class)\s+\w+/)
    assert.match(botCompat, /@deprecated/)
    assert.match(botCompat, /export\s*\{/)

    for (const name of ['eventAdapter.js', 'platformAdapter.js', 'group.js']) {
        const source = fs.readFileSync(path.join(utilsDir, name), 'utf8')
        assertNoDirectProtocol(source, name)
    }
    const platformSource = fs.readFileSync(path.join(utilsDir, 'platformAdapter.js'), 'utf8')
    assert.equal((platformSource.match(/\b(?:e|event)\??\.reply(?:\?\.)?\s*\(/g) || []).length, 1)
    assert.match(platformSource, /@deprecated[\s\S]*StandardBotApi/)
})

test('模型自建工具文档只示范标准上下文接口', () => {
    const sources = [
        path.join(root, 'data', 'tools', 'example_tool.js'),
        path.join(root, 'data', 'tools', 'CustomTool.js'),
        path.join(root, 'docs', 'TOOLS.md')
    ].map(file => fs.readFileSync(file, 'utf8'))
    for (const source of sources) {
        assert.doesNotMatch(source, /\bcontext\.getBot\s*\(\s*\)/)
        assert.doesNotMatch(source, /\b(?:e|event)\.reply\s*\(/)
        assert.doesNotMatch(source, /\bcompatSegment\b|\bsendForwardMsgEnhanced\b/)
    }
    assert.match(sources[0], /context\.getApi\(\)/)
    assert.match(sources[0], /context\.message/)
})

test('messageParser 只解析和归一化，协议 I/O 统一委托 StandardBotApi', () => {
    const source = fs.readFileSync(path.join(root, 'src', 'utils', 'messageParser.js'), 'utf8')
    const directIoNames =
        'sendApi|pickGroup|pickFriend|pickUser|getForwardMsg|getChatHistory|getGroupMemberInfo|deleteMsg|recallMsg|pickMember|sendPrivateMsg|sendGroupMsg'
    const directIoCalls = new RegExp(
        `(?:\\.(?:${directIoNames})(?:\\?\\.)?\\s*\\(|\\[['"](?:${directIoNames})['"]\\](?:\\?\\.)?\\s*\\()`
    )
    const directMessageLookup = /\b(?:e(?:vent)?\.bot|bot|group|friend|target|this\.bot)\??\.getMsg(?:\?\.)?\s*\(/
    const directReplyLookup = /\b(?:e|event)\??\.getReply(?:\?\.)?\s*\(/

    assert.doesNotMatch(
        source,
        /from\s+['"][^'"]*(?:botCompat|eventAdapter|platformAdapter)\.js['"]/,
        '不得依赖旧协议适配器'
    )
    assert.doesNotMatch(source, /\bnormalizeBotTargetId\s*\(/, '不得在解析层转换目标 ID')
    assert.doesNotMatch(source, directIoCalls, '不得直接调用协议端消息方法')
    assert.doesNotMatch(source, directMessageLookup, '不得绕过标准接口读取消息')
    assert.doesNotMatch(source, directReplyLookup, '不得绕过标准接口读取引用')
    assert.match(source, /from\s+['"]\.\.\/core\/platform\/StandardBotApi\.js['"]/)
    assert.match(source, /return new StandardBotApi\(\{ event, bot:/)
})
