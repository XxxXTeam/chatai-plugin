import assert from 'node:assert/strict'
import fs from 'fs'
import http from 'node:http'
import https from 'node:https'
import path from 'path'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { after, before, test } from 'node:test'

import {
    MANAGED_DOWNLOAD_DIR,
    MANAGED_DOWNLOAD_TTL_MS,
    cleanupTemporaryDownload,
    downloadToManagedCache,
    fileTools,
    isTemporaryDownload,
    parseDownloadHeaders,
    registerTemporaryDownload,
    saveResponseToFile,
    startManagedDownloadCleanup,
    stopManagedDownloadCleanup,
    stripCrossOriginSensitiveHeaders,
    sweepManagedDownloads
} from '../src/mcp/tools/file.js'
import { mediaTools } from '../src/mcp/tools/media.js'
import { voiceTools } from '../src/mcp/tools/voice.js'

const testRoot = path.join(process.cwd(), 'data', 'temp', `download-lifecycle-${randomUUID()}`)

function getTool(tools, name) {
    const tool = tools.find(item => item.name === name)
    assert.ok(tool, `工具 ${name} 必须存在`)
    return tool
}

/**
 * @param {{request: Function}} transport - node:http 或 node:https 模块
 * @param {(record: {url: URL, options: Object}, index: number) => Promise<Object>|Object} responder - 响应生成器
 * @returns {{requests: Array<{url: URL, options: Object}>, restore: () => void}} 请求记录与恢复函数
 */
function installRequestMock(transport, responder) {
    /** @type {Function} */
    const originalRequest = transport.request
    const requests = new Array()

    transport.request = (url, options, onResponse) => {
        const requestRecord = { url: new URL(url), options }
        requests.push(requestRecord)
        let incoming
        const request = Object.assign(new EventEmitter(), {
            write: () => true,
            destroy: error => {
                if (incoming) incoming.destroy(error)
                else if (error) request.emit('error', error)
            },
            end: () => {
                queueMicrotask(async () => {
                    try {
                        const result = await responder(requestRecord, requests.length - 1)
                        const bodyChunks =
                            result.body === undefined || result.body === null
                                ? []
                                : Array.isArray(result.body)
                                  ? result.body
                                  : [result.body]
                        incoming =
                            result.body instanceof Readable
                                ? result.body
                                : Readable.from(bodyChunks.map(chunk => Buffer.from(chunk)))
                        incoming.statusCode = result.status ?? 200
                        incoming.statusMessage = result.statusMessage || ''
                        incoming.headers = { ...(result.headers || {}) }
                        onResponse(incoming)
                    } catch (error) {
                        request.emit('error', error)
                    }
                })
            }
        })

        return request
    }

    return {
        requests,
        restore() {
            transport.request = originalRequest
        }
    }
}

async function createTemporaryFile(name, content = 'temporary') {
    await fs.promises.mkdir(MANAGED_DOWNLOAD_DIR, { recursive: true })
    const filePath = path.join(MANAGED_DOWNLOAD_DIR, `${randomUUID()}-${name}`)
    await fs.promises.writeFile(filePath, content)
    registerTemporaryDownload(filePath)
    return filePath
}

before(async () => {
    await fs.promises.mkdir(testRoot, { recursive: true })
})

after(async () => {
    stopManagedDownloadCleanup()
    await fs.promises.rm(testRoot, { recursive: true, force: true })
    await sweepManagedDownloads(Date.now() + MANAGED_DOWNLOAD_TTL_MS * 2)
})

test('清理计时器已 unref，不阻止进程退出', () => {
    const timer = startManagedDownloadCleanup()
    assert.equal(typeof timer.hasRef, 'function')
    assert.equal(timer.hasRef(), false)
})

test('请求头过滤敏感项，跨源时继续剥离认证类头', () => {
    const filtered = parseDownloadHeaders({
        Host: 'evil.test',
        Authorization: 'Bearer secret',
        Cookie: 'sid=secret',
        'Proxy-Test': 'secret',
        'Sec-Test': 'secret',
        'X-API-Key': 'api-secret',
        'X-Token': 'x-token-secret',
        'Api-Key': 'api-key-secret',
        Secret: 'plain-secret',
        Credential: 'credential-secret',
        Signature: 'signature-secret',
        Accept: 'application/octet-stream',
        'X-Custom': 'kept'
    })
    assert.equal(filtered['X-API-Key'], 'api-secret')
    assert.equal(filtered['X-Token'], 'x-token-secret')
    assert.equal(filtered['Api-Key'], 'api-key-secret')
    assert.equal(filtered.Secret, 'plain-secret')
    assert.equal(filtered.Credential, 'credential-secret')
    assert.equal(filtered.Signature, 'signature-secret')
    assert.deepEqual(stripCrossOriginSensitiveHeaders(filtered), { Accept: 'application/octet-stream' })
})

test('跨源重定向不会携带认证类自定义头', async () => {
    const mock = installRequestMock(http, (_request, index) => {
        if (index === 0) {
            return {
                status: 302,
                headers: { location: 'http://8.8.8.8/final.bin' }
            }
        }
        return {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
            body: 'redirected'
        }
    })

    let downloaded
    try {
        downloaded = await downloadToManagedCache('http://1.1.1.1/start.bin', {
            headers: {
                'X-API-Key': 'api-secret',
                'X-Token': 'x-token-secret',
                'Api-Key': 'api-key-secret',
                Secret: 'plain-secret',
                Credential: 'credential-secret',
                Signature: 'signature-secret',
                Accept: 'application/octet-stream',
                'X-Custom': 'not-forwarded'
            }
        })
        assert.equal(mock.requests.length, 2)
        const firstHeaders = mock.requests[0].options.headers
        const redirectedHeaders = mock.requests[1].options.headers
        assert.equal(firstHeaders['X-API-Key'], 'api-secret')
        for (const name of ['X-API-Key', 'X-Token', 'Api-Key', 'Secret', 'Credential', 'Signature', 'X-Custom']) {
            assert.equal(redirectedHeaders[name], undefined, `${name} 不得跨源转发`)
        }
        assert.equal(redirectedHeaders.Accept, 'application/octet-stream')
    } finally {
        mock.restore()
        if (downloaded?.filePath) await cleanupTemporaryDownload(downloaded.filePath)
    }
})

test('HTTPS 下载保留原始主机用于 SNI，并仅把已校验地址交给连接层', async () => {
    const safeAddresses = [
        { address: '1.1.1.1', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 }
    ]
    let dnsLookups = 0
    const lookup = async () => {
        dnsLookups++
        return safeAddresses
    }
    const mock = installRequestMock(https, async requestRecord => {
        const pinnedAddresses = await new Promise((resolve, reject) => {
            requestRecord.options.lookup('downloads.example.test', { all: true }, (error, addresses) => {
                if (error) reject(error)
                else resolve(addresses)
            })
        })
        assert.deepEqual(pinnedAddresses, safeAddresses)
        return {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
            body: 'pinned'
        }
    })

    let downloaded
    try {
        downloaded = await downloadToManagedCache('https://downloads.example.test/archive.bin', { lookup })
        assert.equal(dnsLookups, 1)
        assert.equal(mock.requests.length, 1)
        assert.equal(mock.requests[0].url.hostname, 'downloads.example.test')
        assert.equal(mock.requests[0].options.servername, 'downloads.example.test')
        assert.equal(mock.requests[0].options.agent, false)
        assert.equal(fs.statSync(downloaded.filePath).mode & 0o777, 0o600)
    } finally {
        mock.restore()
        if (downloaded?.filePath) await cleanupTemporaryDownload(downloaded.filePath)
    }
})

test('真实下载入口不会二次解析 DNS 或连接 rebinding 回环地址', async () => {
    let internalHits = 0
    const server = http.createServer((_request, response) => {
        internalHits++
        response.end('internal-service')
    })
    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => resolve(undefined))
    })

    const address = server.address()
    assert.ok(address && typeof address === 'object')
    let dnsLookups = 0
    const rebindingLookup = (_hostname, lookupOptions, callback) => {
        dnsLookups++
        const result = dnsLookups === 1 ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]
        if (typeof callback === 'function') {
            if (lookupOptions?.all) callback(null, result)
            else callback(null, result[0].address, result[0].family)
            return undefined
        }
        return Promise.resolve(result)
    }

    try {
        await assert.rejects(
            downloadToManagedCache(`http://rebind-probe.invalid:${address.port}/private`, {
                lookup: rebindingLookup,
                timeoutMs: 300
            })
        )
        assert.equal(dnsLookups, 1)
        assert.equal(internalHits, 0)
    } finally {
        await new Promise(resolve => server.close(resolve))
    }
})

test('声明超限和响应流中断都不会留下目标或半文件', async () => {
    const oversizedPath = path.join(testRoot, 'oversized.bin')
    const oversized = new Response('x', {
        headers: { 'content-length': String(100 * 1024 * 1024 + 1) }
    })
    await assert.rejects(saveResponseToFile(oversized, oversizedPath), /文件过大/)
    assert.equal(fs.existsSync(oversizedPath), false)

    let pulled = false
    const interrupted = new Response(
        new ReadableStream({
            pull(controller) {
                if (!pulled) {
                    pulled = true
                    controller.enqueue(new Uint8Array([1, 2, 3]))
                    return
                }
                controller.error(new Error('forced stream interruption'))
            }
        })
    )
    const interruptedPath = path.join(testRoot, 'interrupted.bin')
    await assert.rejects(saveResponseToFile(interrupted, interruptedPath), /forced stream interruption/)
    assert.equal(fs.existsSync(interruptedPath), false)
    assert.equal(
        (await fs.promises.readdir(testRoot)).some(name => name.includes('.part')),
        false
    )
})

test('覆盖交换失败会恢复旧文件且不遗留备份', async () => {
    const targetPath = path.join(testRoot, 'overwrite.bin')
    await fs.promises.writeFile(targetPath, 'old-content')

    const originalRename = fs.promises.rename
    let renameCalls = 0
    fs.promises.rename = async (...args) => {
        renameCalls++
        if (renameCalls === 2) throw new Error('forced rename failure')
        return originalRename(...args)
    }

    try {
        await assert.rejects(
            saveResponseToFile(new Response('new-content'), targetPath, { overwrite: true }),
            /forced rename failure/
        )
    } finally {
        fs.promises.rename = originalRename
    }

    assert.equal(await fs.promises.readFile(targetPath, 'utf8'), 'old-content')
    assert.deepEqual(await fs.promises.readdir(testRoot), ['overwrite.bin'])
})

test('QQBot 当前事件发送成功后清理临时文件并保留字符串 OpenID', async () => {
    const filePath = await createTemporaryFile('success.txt')
    let sentSegment = null
    const event = {
        group_id: 'mapped-group',
        _raw_group_id: 'raw-open-group',
        reply: async segment => {
            sentSegment = segment
            return { message_id: 'message-1' }
        }
    }
    const bot = { adapter: { id: 'QQBot' } }
    const result = await getTool(fileTools, 'send_file_message').handler(
        {
            file: filePath,
            name: 'success.txt',
            target_type: 'group',
            target_id: 'raw-open-group'
        },
        { getBot: () => bot, getEvent: () => event }
    )

    assert.equal(result.success, true)
    assert.equal(result.target_id, 'raw-open-group')
    assert.deepEqual(sentSegment, { type: 'file', file: filePath, name: 'success.txt' })
    assert.equal(fs.existsSync(filePath), false)
})

test('QQBot 发送失败后仍在 finally 清理临时文件', async () => {
    const filePath = await createTemporaryFile('failure.txt')
    const event = {
        user_id: 'mapped-user',
        _raw_user_id: 'raw-open-user',
        reply: async () => {
            throw new Error('forced send failure')
        }
    }
    const bot = { version: { name: 'QQBot' } }
    const result = await getTool(fileTools, 'send_file_message').handler(
        {
            file: filePath,
            name: 'failure.txt',
            target_type: 'private',
            target_id: 'raw-open-user'
        },
        { getBot: () => bot, getEvent: () => event }
    )

    assert.equal(result.success, false)
    assert.match(result.error, /forced send failure/)
    assert.equal(fs.existsSync(filePath), false)
})

test('QQBot 聚合 error 数组会判定为失败并清理临时文件', async () => {
    const filePath = await createTemporaryFile('aggregate-failure.txt')
    const event = {
        group_id: 'mapped-group',
        reply: async () => ({
            message_id: [],
            data: [],
            error: [new Error('aggregate send failure')]
        })
    }
    const bot = { adapter: { name: 'QQBot' } }
    const result = await getTool(fileTools, 'send_file_message').handler(
        {
            file: filePath,
            name: 'aggregate-failure.txt',
            target_type: 'group',
            target_id: 'mapped-group'
        },
        { getBot: () => bot, getEvent: () => event }
    )

    assert.equal(result.success, false)
    assert.match(result.error, /aggregate send failure/)
    assert.equal(fs.existsSync(filePath), false)
})

test('QQBot 空聚合结果不会误报发送成功', async () => {
    const filePath = await createTemporaryFile('empty-aggregate.txt')
    const event = {
        group_id: 'mapped-group',
        reply: async () => ({ message_id: [], data: [], error: [] })
    }
    const bot = { adapter: { id: 'QQBot' } }
    const result = await getTool(fileTools, 'send_file_message').handler(
        {
            file: filePath,
            name: 'empty-aggregate.txt',
            target_type: 'group',
            target_id: 'mapped-group'
        },
        { getBot: () => bot, getEvent: () => event }
    )

    assert.equal(result.success, false)
    assert.match(result.error, /未返回任何.*发送/)
    assert.equal(fs.existsSync(filePath), false)
})

test('不支持的文件读取 API 不会返回 success 加空字段', async () => {
    const qqBot = { adapter: { id: 'QQBot' } }
    const qqContext = { getBot: () => qqBot, getAdapter: () => ({ adapter: 'qqbot' }) }
    assert.equal(
        (await getTool(fileTools, 'get_group_files').handler({ group_id: 'open-group' }, qqContext)).success,
        false
    )
    assert.equal(
        (await getTool(fileTools, 'get_group_file_system_info').handler({ group_id: 'open-group' }, qqContext)).success,
        false
    )
    assert.equal(
        (await getTool(fileTools, 'get_private_file_url').handler({ file_id: 'file-open-id' }, qqContext)).success,
        false
    )

    const emptyOneBot = { sendApi: async () => null }
    const oneBotContext = { getBot: () => emptyOneBot, getAdapter: () => ({ adapter: 'napcat' }) }
    assert.equal(
        (await getTool(fileTools, 'get_group_files').handler({ group_id: '123' }, oneBotContext)).success,
        false
    )
    assert.equal(
        (await getTool(fileTools, 'get_group_file_system_info').handler({ group_id: '123' }, oneBotContext)).success,
        false
    )
    assert.equal(
        (await getTool(fileTools, 'get_private_file_url').handler({ file_id: 'file-id' }, oneBotContext)).success,
        false
    )
})

test('QQBot 群文件系统工具保留 qg 标识并明确返回不支持', async () => {
    const groupId = 'qg_guild-channel'
    let picked = false
    const qqBot = {
        adapter: { id: 'QQBot' },
        pickGroup: () => {
            picked = true
            throw new Error('QQBot 文件系统工具不应调用 pickGroup')
        }
    }
    const context = { getBot: () => qqBot, getAdapter: () => ({ adapter: 'qqbot' }) }
    const cases = [
        ['get_file_url', { group_id: groupId, file_id: 'file-open-id' }],
        ['create_group_folder', { group_id: groupId, name: 'folder' }],
        ['get_group_file_system_info', { group_id: groupId }],
        ['get_group_root_files', { group_id: groupId }],
        ['get_group_files_by_folder', { group_id: groupId, folder_id: 'folder-open-id' }],
        [
            'move_group_file',
            {
                group_id: groupId,
                file_id: 'file-open-id',
                parent_directory: '/',
                target_directory: 'folder-open-id'
            }
        ],
        ['rename_group_file', { group_id: groupId, file_id: 'file-open-id', new_name: 'renamed.txt' }],
        ['delete_group_folder', { group_id: groupId, folder_id: 'folder-open-id' }]
    ]

    for (const [name, args] of cases) {
        const result = await getTool(fileTools, name).handler(args, context)
        assert.equal(result.success, false, `${name} 必须明确失败`)
        assert.equal(result.adapter, 'qqbot', `${name} 必须标记 QQBot 适配器`)
        assert.equal(result.group_id, groupId, `${name} 必须原样保留 qg 群标识`)
    }
    assert.equal(picked, false)
})

test('OneBot 群文件读写工具不会把 null 返回误报为成功', async () => {
    const oneBot = {
        pickGroup: () => ({}),
        sendApi: async () => null
    }
    const context = { getBot: () => oneBot, getAdapter: () => ({ adapter: 'napcat' }) }
    const cases = [
        ['get_file_url', { group_id: '123', file_id: 'file-id' }],
        ['create_group_folder', { group_id: '123', name: 'folder' }],
        ['get_group_file_system_info', { group_id: '123' }],
        ['get_group_root_files', { group_id: '123' }],
        ['get_group_files_by_folder', { group_id: '123', folder_id: 'folder-id' }],
        [
            'move_group_file',
            { group_id: '123', file_id: 'file-id', parent_directory: '/', target_directory: 'folder-id' }
        ],
        ['rename_group_file', { group_id: '123', file_id: 'file-id', new_name: 'renamed.txt' }],
        ['delete_group_folder', { group_id: '123', folder_id: 'folder-id' }]
    ]

    for (const [name, args] of cases) {
        const result = await getTool(fileTools, name).handler(args, context)
        assert.equal(result.success, false, `${name} 不得把 null 返回误报为成功`)
    }
})

test('TTL 清理受管残留，显式持久下载默认保留', async () => {
    const expiredPath = await createTemporaryFile('expired.txt')
    registerTemporaryDownload(expiredPath, 1)
    await sweepManagedDownloads(Date.now() + 10)
    assert.equal(fs.existsSync(expiredPath), false)

    const mock = installRequestMock(http, () => ({
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: 'persistent-content'
    }))
    try {
        const result = await getTool(fileTools, 'download_to_file').handler({
            url: 'http://1.1.1.1/persistent.bin',
            save_path: testRoot,
            filename: 'persistent.bin'
        })
        assert.equal(result.success, true)
        assert.equal(result.cleanup, false)
        assert.equal(isTemporaryDownload(result.saved_path), false)
        await sweepManagedDownloads(Date.now() + MANAGED_DOWNLOAD_TTL_MS * 2)
        assert.equal(await fs.promises.readFile(result.saved_path, 'utf8'), 'persistent-content')
    } finally {
        mock.restore()
    }
})

test('download_image 返回受管本地路径，send_image 发送后清理', async () => {
    const mock = installRequestMock(http, () => ({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array([137, 80, 78, 71])
    }))

    let downloaded
    try {
        downloaded = await getTool(mediaTools, 'download_image').handler({
            url: 'http://1.1.1.1/image.png',
            filename: 'image.png'
        })
        assert.equal(downloaded.success, true)
        assert.equal(downloaded.mime_type, 'image/png')
        assert.equal(typeof downloaded.file_path, 'string')
        assert.equal(downloaded.base64, undefined)
        assert.equal(fs.existsSync(downloaded.file_path), true)

        const sent = await getTool(mediaTools, 'send_image').handler(
            { url: downloaded.file_path },
            { getEvent: () => ({ reply: async () => ({ message_id: 'image-message' }) }) }
        )
        assert.equal(sent.success, true)
        assert.equal(fs.existsSync(downloaded.file_path), false)
    } finally {
        mock.restore()
        if (downloaded?.file_path) await cleanupTemporaryDownload(downloaded.file_path)
    }
})

test('send_video 与 send_flash_image 在成功和聚合失败后都会清理受管文件', async () => {
    for (const [toolName, argumentName] of [
        ['send_video', 'file'],
        ['send_flash_image', 'file']
    ]) {
        const tool = getTool(mediaTools, toolName)

        const successfulPath = await createTemporaryFile(`${toolName}-success.bin`)
        const successful = await tool.handler(
            { [argumentName]: successfulPath },
            { getEvent: () => ({ reply: async () => ({ message_id: `${toolName}-message` }) }) }
        )
        assert.equal(successful.success, true, `${toolName} 成功发送必须返回成功`)
        assert.equal(fs.existsSync(successfulPath), false, `${toolName} 成功发送后必须立即清理`)

        const failedPath = await createTemporaryFile(`${toolName}-failure.bin`)
        const failed = await tool.handler(
            { [argumentName]: failedPath },
            {
                getEvent: () => ({
                    reply: async () => ({
                        message_id: [],
                        data: [],
                        error: [new Error(`${toolName} aggregate failure`)]
                    })
                })
            }
        )
        assert.equal(failed.success, false, `${toolName} 聚合失败不得误报成功`)
        assert.match(failed.error, new RegExp(`${toolName} aggregate failure`))
        assert.equal(fs.existsSync(failedPath), false, `${toolName} 聚合失败后必须立即清理`)
    }
})

test('媒体下载逐跳拒绝内网重定向，图片信息非2xx返回失败', async () => {
    const mock = installRequestMock(http, requestRecord => {
        if (requestRecord.options.method === 'HEAD') {
            return { status: 404 }
        }
        return {
            status: 302,
            headers: { location: 'http://127.0.0.1/private-image.png' }
        }
    })

    try {
        const downloadResult = await getTool(mediaTools, 'download_image').handler({
            url: 'http://1.1.1.1/redirect-image.png'
        })
        assert.equal(downloadResult.success, false)
        assert.match(downloadResult.error, /禁止访问本机地址|内网|保留地址/)
        assert.equal(mock.requests.length, 1)

        const infoResult = await getTool(mediaTools, 'get_image_info').handler({
            url: 'http://1.1.1.1/not-found.png'
        })
        assert.equal(infoResult.success, false)
        assert.match(infoResult.error, /HTTP 404/)
    } finally {
        mock.restore()
    }
})

test('download_voice 复用受限下载链并在返回 base64 后清理临时文件', async () => {
    const mock = installRequestMock(http, () => ({
        status: 200,
        headers: { 'content-type': 'audio/ogg' },
        body: Buffer.from('voice-bytes')
    }))
    let result
    try {
        result = await getTool(voiceTools, 'download_voice').handler({ url: 'http://1.1.1.1/voice.ogg' }, {})
        assert.equal(result.success, true)
        assert.equal(result.size, Buffer.byteLength('voice-bytes'))
        assert.equal(result.content_type, 'audio/ogg')
        assert.equal(result.base64, `base64://${Buffer.from('voice-bytes').toString('base64')}`)
        const managedFiles = fs.existsSync(MANAGED_DOWNLOAD_DIR)
            ? fs.readdirSync(MANAGED_DOWNLOAD_DIR).filter(name => name.includes('voice.bin'))
            : []
        assert.deepEqual(managedFiles, [])
    } finally {
        mock.restore()
    }
})

test('媒体 buffer 下载复用统一受限请求实现', async () => {
    const mock = installRequestMock(http, () => ({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: new Uint8Array([137, 80, 78, 71])
    }))
    try {
        const result = await getTool(mediaTools, 'parse_image').handler(
            { image_url: 'http://1.1.1.1/buffer.png', to_base64: true },
            { getEvent: () => ({}) }
        )
        assert.equal(result.success, true)
        assert.equal(result.images.length, 1)
        assert.equal(result.images[0].mimeType, 'image/png')
        assert.equal(result.images[0].base64, 'data:image/png;base64,iVBORw==')
        assert.equal(mock.requests.length, 1)
    } finally {
        mock.restore()
    }
})

test('媒体发送识别 QQBot 聚合业务错误，undefined 返回保持兼容成功', async () => {
    const diceTool = getTool(mediaTools, 'send_dice')
    const failed = await diceTool.handler(
        {},
        {
            getEvent: () => ({
                reply: async () => ({ message_id: [], data: [], error: [new Error('media aggregate failure')] })
            })
        }
    )
    assert.equal(failed.success, false)
    assert.match(failed.error, /media aggregate failure/)

    const compatible = await diceTool.handler({}, { getEvent: () => ({ reply: async () => undefined }) })
    assert.equal(compatible.success, true)
    assert.equal(compatible.message_id, null)
})
