/**
 * @fileoverview 拟人化分段发送工具（messageSegment）的正向测试。
 * 覆盖：语义分段、CQ 码/emoji/URL/代码块保护、短句合并、硬切、延迟与统一发送入口。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitMessage, splitIntoSentences, calculateDelay, sendSegmentedMessage } from '../src/utils/messageSegment.js'

test('messageSegment: 长文本按句末标点自然分段且无内容丢失', () => {
    const text =
        '第一句话讲一个完整的观点并且把这句话刻意写得比较长，让整段文本的总长度超过一百四十个字符的阈值。' +
        '第二句话接着补充细节并且向你提出一个问题看看你的想法是怎么样的？' +
        '第三句话给出一个总结性的回答并且说明清楚关键的理由！' +
        '第四句话再补充一个小小的提醒希望大家注意细节啊。' +
        '第五句话最后聊聊后续的方向和可能做的事情。'
    const segments = splitMessage(text)
    assert.ok(segments.length >= 2, `期望 2 段以上，实际 ${segments.length} 段`)
    assert.equal(segments.join(''), text, '分段拼接必须还原原文')
})

test('messageSegment: CQ 码在分段过程中保持完整', () => {
    const cq = '[CQ:image,file=abcd.jpg,url=http://img.example.com/photo.jpg]'
    const text =
        `先给你看一张图片${cq}后面接着说第一句需要足够长的话。` +
        '第二句话再补充一下内容确保总长度超过分段阈值这样可以触发实际的分段逻辑。'
    const segments = splitMessage(text)
    assert.ok(
        segments.some(s => s.includes(cq)),
        `CQ 码必须完整保留在单一段内: ${JSON.stringify(segments)}`
    )
    assert.equal(segments.join(''), text)
})

test('messageSegment: URL 不因分段而断裂', () => {
    const url = 'https://example.com/very/long/path?query=1&another=2'
    const text =
        `看看这个链接：${url} 应该完整保留下来不能被切割掉因为链接中断会很奇怪而且影响使用。` +
        '后面继续补充一句让你再想想这段话的内容有没有遗漏的地方需要修正的地方补充完整。'
    const segments = splitMessage(text)
    assert.ok(
        segments.some(s => s.includes(url)),
        `URL 必须完整保留在单一段内: ${JSON.stringify(segments)}`
    )
    assert.equal(segments.join(''), text)
})

test('messageSegment: 代码围栏整体不被切开', () => {
    const text =
        '先说明一下背景内容，这里写足够长的介绍文字让整体长度超过分段阈值达到要求再说。' +
        '```js\nconst x = 1\nconst y = 2\nconst z = 3\n```\n' +
        '之后还有内容补充说明一下，这句话也写长一些确保触发分段逻辑生效。'
    const segments = splitMessage(text)
    const protectedSegment = segments.find(s => s.includes('const x'))
    assert.ok(protectedSegment, '必须存在包含代码块的片段')
    assert.ok(protectedSegment.includes('const x') && protectedSegment.includes('const z'), '代码块首尾必须同段')
    assert.equal(segments.join(''), text)
})

test('messageSegment: emoji 不会被截断', () => {
    const emoji = '😀🎉'
    const text = `前面讲一句足够长的开场内容好好的说一下事情经过莫要急😀再来第二句🎉继续补充一些细节让总长度超过分段阈值然后看看效果怎么样。`
    const segments = splitMessage(text)
    assert.equal(segments.join(''), text)
    assert.ok(
        segments.every(s => /[\u{1F300}-\u{1F9FF}]/u.test(s) === s.includes(emoji[0])),
        'emoji 字符必须完整'
    )
})

test('messageSegment: 无标点超长文本硬切且无内容丢失', () => {
    const text = '字'.repeat(300)
    const segments = splitMessage(text)
    assert.ok(segments.length >= 3, `期望 3 段以上，实际 ${segments.length} 段`)
    assert.equal(segments.join(''), text)
})

test('messageSegment: 短文本保持单段', () => {
    assert.deepEqual(splitMessage('你好呀。今天过得怎么样？'), ['你好呀。今天过得怎么样？'])
})

test('messageSegment: 短句合并到上一段', () => {
    const text =
        '前面一段足够长的内容撑起第一条消息长度该结束了所以继续多写一些字吧让字数达标之后再看效果。好。好。这个字太少。'
    const segments = splitMessage(text)
    assert.ok(
        segments.some(s => s.includes('好。好。')),
        `过短句应并入前段: ${JSON.stringify(segments)}`
    )
    assert.equal(segments.join(''), text)
})

test('messageSegment: splitIntoSentences 对超阈值文本逐句拆分', () => {
    const text =
        '你好呀这是第一句话并且我说得比较长一些内容必须超过九十字。' +
        '今天天气不错啊这是第二句话也要继续说下去不能停！' +
        '你要出门吗第三句话还要继续补充多讲一些？' +
        '记得带伞哦第四句话再多说一点细节。别着凉了呀第五句话结束。'
    const sentences = splitIntoSentences(text)
    assert.ok(sentences.length >= 2, `期望 2 段以上，实际 ${sentences.length} 段`)
    assert.equal(sentences.join(''), text)
})

test('messageSegment: 真实聊天记录样本按发言单位分段且内容无损', () => {
    // 用户提供的真实样本：QQ 复制出来的多时间戳消息拼接成的完整文本
    const realText = [
        '我是残花: 09-20 22:19:45',
        '懂你意思了，锅巴里对应的项是"全局解析黑名单"。',
        '',
        '我是残花: 09-20 22:19:46',
        'R插件的逻辑是把所有网页链接（包括GitHub）统一归在"AI总结"控制器下面。',
        '',
        '我是残花: 09-20 22:19:47',
        '我已经直接把 `AI总结` 加进 `plugins/rconsole-plugin/config/tools.yaml` 的 `globalBlackList` 里了，这样锅巴读取和插件运行都会直接拦截，不用动任何业务代码。',
        '',
        '我是残花: 09-20 22:22:50',
        '1.',
        '',
        '我是残花: 09-20 22:22:51',
        '原版 R 插件根本没有单独为 GitHub 开关写锅巴配置项，它把 GitHub 和 知乎、V2EX、微信文章 一起塞在"AI总结"里。',
        '',
        '我是残花: 09-20 22:22:52',
        '2.之前改动是在 `tools.js` 的正则里把 `github.com` 删掉了，同时 `constant.js` 里的正则也注释了。3.',
        '',
        '我是残花: 09-20 22:22:58',
        '锅巴里的"全局解析黑名单"能控制的是整个 `AI总结` 分类。',
        '',
        '我是残花: 09-20 22:23:00',
        '现在代码里的 GitHub 正则早已被彻底剔除，只要云崽进程重启重载了 `tools.js`，发 GitHub 链接就绝对不会再触发总结。'
    ].join('\n')

    const segments = splitMessage(realText)
    assert.ok(segments.length >= 5, `期望 5 段以上，实际 ${segments.length} 段`)

    // 除分界空白外，内容必须无损：去掉全部空白字符后序列一致
    assert.equal(segments.join('').replace(/\s+/g, ''), realText.replace(/\s+/g, ''), '去空白后必须还原原文')

    // 133 字的完整发言必须保持单段，不能被逗号拆碎
    const longUtterance = segments.find(s => s.includes('我已经直接把'))
    assert.ok(longUtterance, '必须存在包含该发言的段落')
    assert.ok(
        longUtterance.includes('这样锅巴读取和插件运行都会直接拦截，不用动任何业务代码。'),
        `超长发言必须整体保留在单一段内: ${JSON.stringify(longUtterance)}`
    )

    // 编号 "3." 归属后文，不得悬空丢失
    assert.ok(
        segments.some(s => s.includes('3.')),
        `编号 3. 必须保留: ${JSON.stringify(segments)}`
    )

    // 每条发言的时间戳行必须与它自己的正文同段（不允许时间戳单独成段）
    for (const segment of segments) {
        if (segment.startsWith('我是残花: 09-20')) {
            const lines = segment.split('\n')
            assert.ok(lines.length >= 2 && lines[1].trim(), `时间戳行后必须跟随正文: ${JSON.stringify(segment)}`)
        }
    }
})

test('messageSegment: 空白与空串返回空数组', () => {
    assert.deepEqual(splitMessage(''), [])
    assert.deepEqual(splitMessage('   '), [])
    assert.deepEqual(splitMessage(null), [])
    assert.deepEqual(splitMessage(undefined), [])
})

test('messageSegment: 计算延迟落在配置区间内', () => {
    for (let i = 0; i < 50; i++) {
        const delay = calculateDelay('测试文本'.repeat(5))
        assert.ok(delay >= 400, `延迟 ${delay} 不应低于基础值`)
        assert.ok(delay <= 4000, `延迟 ${delay} 不应超过上限`)
    }
    const shortDelay = calculateDelay('短')
    const longDelay = calculateDelay('很长的文本内容'.repeat(10))
    assert.ok(shortDelay <= longDelay, '延迟应随文本长度增大')
})

test('messageSegment: 统一发送入口-短文本单条回复', async () => {
    const sent = []
    const fakeEvent = {
        reply: async (message, quote, replyOptions) => {
            sent.push({ message, quote, replyOptions })
            return { message_id: `id-${sent.length}` }
        }
    }
    const result = await sendSegmentedMessage(fakeEvent, '你好呀。')
    assert.deepEqual(
        sent.map(s => s.message),
        ['你好呀。']
    )
    assert.equal(result.folded, false)
    assert.equal(result.messageIds.length, 1)
})

test('messageSegment: 统一发送入口-长文本逐条发送', async () => {
    const sent = []
    const fakeEvent = {
        reply: async (message, quote, replyOptions) => {
            sent.push({ message, quote, replyOptions })
            return { message_id: `id-${sent.length}` }
        }
    }
    const text =
        '这是一条足够长的回复内容，第一条把话讲清楚说明来龙去脉并且给出背景信息而且字数必须足够多每次都要认真写完。' +
        '第二条继续补充细节回答问题并给出建议是什么让我们来看看具体的做法？' +
        '第三条最后总结一下重点并祝你好运呀！' +
        '第四条再补充一点提醒注意细节并保持耐心。' +
        '第五条收尾结束这段话。' +
        '第六条最后再讲一句让总长度彻底超过一百四十个字符的阈值出来。'
    const result = await sendSegmentedMessage(fakeEvent, text, { chunkSize: 50, maxChunk: 120 })
    assert.ok(sent.length >= 2, `期望 2 条以上，实际 ${sent.length} 条`)
    assert.equal(sent.map(s => s.message).join(''), text)
    assert.equal(result.folded, false)
    assert.ok(result.messageIds.length === sent.length)
})

test('messageSegment: 统一发送入口-超长文本触发折叠', async () => {
    const sent = []
    let foldCalled = 0
    const fakeEvent = {
        reply: async (message, quote, replyOptions) => {
            sent.push({ message, quote, replyOptions })
            return { message_id: `id-${sent.length}` }
        }
    }
    const text = '内容充实的一行字'.repeat(80)
    const result = await sendSegmentedMessage(fakeEvent, text, {
        foldLimit: 500,
        foldHandler: async fullText => {
            foldCalled += 1
            assert.equal(fullText, text)
            return true
        }
    })
    assert.equal(foldCalled, 1)
    assert.equal(result.folded, true)
    assert.equal(sent.length, 0, '折叠成功时不应逐条发送')
})

test('messageSegment: 统一发送入口-折叠失败回退逐条', async () => {
    const sent = []
    const fakeEvent = {
        reply: async (message, quote, replyOptions) => {
            sent.push({ message, quote, replyOptions })
            return { message_id: `id-${sent.length}` }
        }
    }
    const text = '内容充实的一行字'.repeat(80)
    const result = await sendSegmentedMessage(fakeEvent, text, {
        foldLimit: 500,
        foldHandler: async () => {
            throw new Error('合并转发不可用')
        }
    })
    assert.equal(result.folded, false)
    assert.ok(sent.length >= 2, `折叠失败应回退逐条，实际 ${sent.length} 条`)
    assert.equal(sent.map(s => s.message).join(''), text)
})

/**
 * 逐条无损契约：分段后每条消息拼接出的内容序列与原文本一致。
 * 覆盖上述每个测试的样本，防止裁剪改动破坏既有语义。
 */
test('messageSegment: 裁剪后每条样本逐条拼接无损', () => {
    const samples = [
        '第一句话讲一个完整的观点并且把这句话刻意写得比较长，让整段文本的总长度超过一百四十个字符的阈值。第二句话接着补充细节并且向你提出一个问题看看你的想法是怎么样的？第三句话给出一个总结性的回答并且说明清楚关键的理由！第四句话再补充一个小小的提醒希望大家注意细节啊。第五句话最后聊聊后续的方向和可能做的事情。',
        '懂你意思了，锅巴里对应的项是“全局解析黑名单”。R插件的逻辑是把所有网页链接（包括GitHub）统一归在“AI总结”控制器下面。我已经直接把 `AI总结` 加进 `plugins/rconsole-plugin/config/tools.yaml` 的 `globalBlackList` 里了，这样锅巴读取和插件运行都会直接拦截，不用动任何业务代码。\n\n1.原版 R 插件根本没有单独为 GitHub 开关写锅巴配置项，它把 GitHub 和 知乎、V2EX、微信文章 一起塞在“AI总结”里。2.之前改动是在 `tools.js` 的正则里把 `github.com` 删掉了，同时 `constant.js` 里的正则也注释了。3.锅巴里的“全局解析黑名单”能控制的是整个 `AI总结` 分类。现在代码里的 GitHub 正则早已被彻底剔除，只要云崽进程重启重载了 `tools.js`，发 GitHub 链接就绝对不会再触发总结。'
    ]
    for (const text of samples) {
        const segments = splitMessage(text)
        assert.equal(
            segments.join('').replace(/\s+/g, ''),
            text.replace(/\s+/g, ''),
            '序列级无损（忽略纯空白差异）：全部字符必须按序出现'
        )
    }
})

test('messageSegment: 默认导出与具名导出一致', async () => {
    const mod = await import('../src/utils/messageSegment.js')
    assert.equal(typeof mod.default.splitMessage, 'function')
    assert.equal(typeof mod.default.splitIntoSentences, 'function')
    assert.equal(typeof mod.default.calculateDelay, 'function')
    assert.equal(typeof mod.default.sendSegmentedMessage, 'function')
})
