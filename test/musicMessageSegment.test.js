/**
 * @fileoverview 音乐卡片消息段的正向测试。
 * 验证 send_music / search_music_qq 构造出的 music 段经 StandardBotApi 发送时，
 * 序列化结果严格符合 OneBot 11 规范（平台类型收敛到 data.type）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StandardMessage } from '../src/core/platform/StandardMessage.js'
import { StandardBotApi } from '../src/core/platform/index.js'

test('music: 标准构造器(qq平台ID)序列化为规范形态', async () => {
    const segment = StandardMessage.music('qq', '229682492')
    assert.deepEqual(segment, { type: 'music', music_type: 'qq', id: '229682492' })

    const onebot = await serializeForTest(segment)
    assert.deepEqual(onebot, { type: 'music', data: { type: 'qq', id: '229682492' } })
})

test('music: custom 构造器序列化保留 url/audio/title/content/image', async () => {
    const segment = StandardMessage.music('custom', {
        url: 'https://y.qq.com/n/yqq/song/229682492.html',
        audio: 'http://example.com/song.mp3',
        title: '测试歌曲',
        content: '歌手名',
        image: 'http://example.com/cover.jpg'
    })
    const onebot = await serializeForTest(segment)
    assert.deepEqual(onebot, {
        type: 'music',
        data: {
            type: 'custom',
            url: 'https://y.qq.com/n/yqq/song/229682492.html',
            audio: 'http://example.com/song.mp3',
            title: '测试歌曲',
            content: '歌手名',
            image: 'http://example.com/cover.jpg'
        }
    })
})

test('music: 直接传入 OneBot 数据包装形态透传无损', async () => {
    // send_music 与 search_music_qq 现在都直接构造 {type:'music', data:{...}}
    const wrapped = {
        type: 'music',
        data: {
            type: 'custom',
            url: 'https://y.qq.com/n/yqq/song/123.html',
            audio: 'http://example.com/song.mp3',
            title: '测试歌曲',
            image: 'http://example.com/cover.jpg',
            singer: '歌手'
        }
    }
    const normalized = await serializeForTest(wrapped)

    assert.equal(normalized.type, 'music')
    assert.equal(normalized.data.type, 'custom')
    assert.equal(normalized.data.title, '测试歌曲')
    assert.equal(normalized.data.audio, 'http://example.com/song.mp3')
    assert.equal(normalized.data.url, 'https://y.qq.com/n/yqq/song/123.html')
    assert.equal(normalized.data.image, 'http://example.com/cover.jpg')
    assert.equal(normalized.data.singer, '歌手')
    // 平台类型不得泄露到 data 外层导致协议端误判
    assert.ok(!('music_type' in normalized.data), JSON.stringify(normalized))
})

test('music: 通过 StandardBotApi(OneBot 适配器)发送不丢失任何字段', async () => {
    let received = null
    const api = new StandardBotApi({
        bot: {
            adapter: { id: 'OneBotv11' },
            pickGroup: () => ({
                async sendMsg(message) {
                    received = message
                    return { message_id: 'music-message' }
                }
            })
        }
    })

    const musicMsg = {
        type: 'music',
        data: {
            type: 'custom',
            url: 'https://y.qq.com/n/yqq/song/999.html',
            audio: 'http://example.com/999.mp3',
            title: '发送链测试',
            image: 'http://example.com/999.jpg',
            singer: '测试歌手'
        }
    }
    const result = await api.sendGroup('123', musicMsg)
    assert.equal(result.message_id, 'music-message')
    assert.deepEqual(received, [
        {
            type: 'music',
            data: {
                type: 'custom',
                url: 'https://y.qq.com/n/yqq/song/999.html',
                audio: 'http://example.com/999.mp3',
                title: '发送链测试',
                image: 'http://example.com/999.jpg',
                singer: '测试歌手'
            }
        }
    ])
})

/**
 * 通过内部序列化 API 把标准段转为 OneBot 段（测试用）。
 * @param {Object} segment - 标准消息段
 * @returns {Object} OneBot 消息段
 */
async function serializeForTest(segment) {
    const { serializeOneBotMessage } = await import('../src/core/platform/StandardMessage.js')
    return serializeOneBotMessage(segment)[0]
}
