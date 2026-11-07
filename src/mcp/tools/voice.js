import axios from 'axios'
import fs from 'node:fs'
import config from '../../../config/config.js'
import { chatLogger as logger } from '../../core/utils/logger.js'
import { StandardBotApi, StandardMessage, StandardRawApi } from '../../core/platform/index.js'

/**
 * 语音消息工具
 */

/** VITS 语音合成服务地址 */
const VITS_BASE_URL = 'https://vist.openel.top'

/** VITS 服务访问令牌 */
const VITS_AUTH_TOKEN = 'vits_88e801332d5485b08731a5f0e3c742b11a799d00693a5d4f'

/** 调用 VITS 服务时统一携带的鉴权头 */
const VITS_AUTH_HEADERS = { Authorization: `Bearer ${VITS_AUTH_TOKEN}` }

/** gradio 6 语音合成端点名 */
const VITS_API_NAME = 'GetSpeech'

/** 服务端音色/语言枚举的缓存时长（毫秒） */
const VITS_META_CACHE_TTL = 10 * 60 * 1000

/** 提交合成请求的排队超时（毫秒） */
const VITS_CALL_TIMEOUT = 30 * 1000

/** 等待合成结果的超时（毫秒） */
const VITS_RESULT_TIMEOUT = 120 * 1000

/** 下载合成音频的超时（毫秒） */
const VITS_AUDIO_TIMEOUT = 30 * 1000

/** 合成音频大小上限（字节） */
const VITS_AUDIO_MAX_BYTES = 32 * 1024 * 1024

/** @type {{at: number, speakers: string[], languages: string[]}} */
let vitsMetaCache = { at: 0, speakers: [], languages: [] }

/**
 * AI 声聊角色中文名到官方角色 ID 的映射
 * 协议端只认 lucy-voice-* 形式的 ID，中文名必须先经此表转换
 * @type {Record<string, string>}
 */
const AI_VOICE_CHARACTER_MAP = {
    小新: 'lucy-voice-laibixiaoxin',
    猴哥: 'lucy-voice-houge',
    妲己: 'lucy-voice-daji',
    四郎: 'lucy-voice-silang',
    吕布: 'lucy-voice-lvbu',
    霸道总裁: 'lucy-voice-lizeyan',
    酥心御姐: 'lucy-voice-suxinjiejie',
    元气少女: 'lucy-voice-xueling',
    邻家小妹: 'lucy-voice-female1',
    嘉然_元气: 'lucy-voice-xueling',
    珈乐_温柔: 'lucy-voice-female2',
    乃琳_温柔: 'lucy-voice-suxinjiejie',
    贝拉_可爱: 'lucy-voice-female1',
    阿梓_元气: 'lucy-voice-xueling'
}

/**
 * 归一化 AI 语音角色标识
 *
 * 用户通常用中文角色名（"嘉然_元气"）而非音色 ID 表述，若只有 send_ai_voice 做转换，
 * 私聊语音等同源工具就会对同一句话报错，形成难以理解的行为差异。
 * 命中转换表则返回音色 ID，未命中原样返回（调用方可能直接传 ID）。
 * @param {string} character - 角色名或音色 ID
 * @returns {string} 音色 ID
 */
function resolveAiVoiceCharacter(character) {
    if (typeof character !== 'string') return character
    const key = character.trim()
    return AI_VOICE_CHARACTER_MAP[key] || key
}

/**
 * 获取标准语音工具上下文。
 * @param {Object} ctx - 工具上下文
 * @returns {{api: StandardBotApi, rawApi: StandardRawApi, adapter: string, isNT: boolean, canAiVoice: boolean}}
 */
function getVoiceContext(ctx) {
    const api = StandardBotApi.fromContext(ctx)
    const rawApi = new StandardRawApi(api)
    const capabilities = rawApi.capabilities()
    const isNT = capabilities.sendOidbSvcTrpcTcp
    return { api, rawApi, adapter: api.adapterType, isNT, canAiVoice: api.supportsCapability('ai_voice') }
}

function detectLanguage(text = '') {
    if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) {
        return '日语'
    }
    return '中文'
}

function safePositiveNumber(value, fallback) {
    const num = Number(value)
    return Number.isFinite(num) && num > 0 ? num : fallback
}

/**
 * 读取服务端 `/gradio_api/info` 中声明的音色与语言枚举并缓存。
 * 角色列表完全以服务端为准，服务端换模型后无需改代码。
 * @returns {Promise<{at: number, speakers: string[], languages: string[]}>} 音色与语言枚举
 */
async function fetchVitsMeta() {
    const now = Date.now()
    if (now - vitsMetaCache.at < VITS_META_CACHE_TTL && vitsMetaCache.speakers.length) {
        return vitsMetaCache
    }

    const response = await axios.get(`${VITS_BASE_URL}/gradio_api/info`, {
        timeout: 10000,
        headers: VITS_AUTH_HEADERS
    })
    const endpoint = response.data?.named_endpoints?.[`/${VITS_API_NAME}`]
    const parameters = Array.isArray(endpoint?.parameters) ? endpoint.parameters : []
    const speakerParam = parameters.find(item => item?.parameter_name === 'speaker_id')
    const languageParam = parameters.find(item => item?.parameter_name === 'language')
    const speakers = Array.isArray(speakerParam?.type?.enum) ? speakerParam.type.enum.map(String) : []
    const languages = Array.isArray(languageParam?.type?.enum) ? languageParam.type.enum.map(String) : []

    if (!speakers.length) {
        throw new Error('服务端未返回可用音色列表，请确认 VITS 服务是否正常')
    }

    vitsMetaCache = { at: now, speakers, languages }
    return vitsMetaCache
}

/**
 * 去掉音色名中的括号别名，例如「甘雨（椰羊）」->「甘雨」。
 * @param {string} name - 服务端音色名
 * @returns {string} 主名
 */
function stripSpeakerAlias(name) {
    return String(name)
        .replace(/（[^）]*）/g, '')
        .replace(/\([^)]*\)/g, '')
        .trim()
}

/**
 * 计算两个字符串的最长公共子串长度，仅用于生成候选提示。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function longestCommonSubstringLength(a, b) {
    const left = String(a).toLowerCase()
    const right = String(b).toLowerCase()
    if (!left || !right) return 0
    let best = 0
    let prev = new Array(right.length + 1).fill(0)
    for (let i = 1; i <= left.length; i++) {
        const cur = new Array(right.length + 1).fill(0)
        for (let j = 1; j <= right.length; j++) {
            if (left[i - 1] === right[j - 1]) {
                cur[j] = prev[j - 1] + 1
                if (cur[j] > best) best = cur[j]
            }
        }
        prev = cur
    }
    return best
}

/**
 * 把用户输入的简称解析为服务端枚举中的精确音色名。
 * 解析顺序：精确匹配 → 主名匹配 → 服务端名包含输入 → 输入包含服务端主名。
 * 命中多个候选时报错，不做猜测。
 * @param {string} input - 用户输入的音色名
 * @param {string[]} speakers - 服务端音色枚举
 * @returns {string} 服务端接受的音色名
 */
function resolveVitsSpeaker(input, speakers) {
    const raw = String(input ?? '').trim()
    if (!raw) throw new Error('缺少音色名')
    const lower = raw.toLowerCase()

    const exact = speakers.find(name => name.toLowerCase() === lower)
    if (exact) return exact

    const aliasMatches = speakers.filter(name => stripSpeakerAlias(name).toLowerCase() === lower)
    if (aliasMatches.length === 1) return aliasMatches[0]

    const containsInput = speakers.filter(name => name.toLowerCase().includes(lower))
    if (containsInput.length === 1) return containsInput[0]

    const containedByInput = speakers.filter(name => {
        const main = stripSpeakerAlias(name).toLowerCase()
        return main && lower.includes(main)
    })
    if (containedByInput.length === 1) return containedByInput[0]

    const suggestions = [...speakers]
        .map(name => ({ name, score: longestCommonSubstringLength(raw, name) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
        .slice(0, 5)
        .map(item => item.name)
    const hint = suggestions.length
        ? `，你可能想用：${suggestions.join('、')}`
        : '，请先调用 get_tts_speakers 查看可用音色'
    throw new Error(`音色「${raw}」不存在${hint}`)
}

/**
 * 把调用方语言参数规范化为服务端枚举值。
 * 服务端只提供「中文 / 日语 / 中日混合」，英文文本由中文 cleaner 处理。
 * @param {string} input - 调用方传入的语言
 * @param {string} text - 待合成文本
 * @param {string[]} languages - 服务端语言枚举
 * @returns {string} 服务端接受的枚举值
 */
function resolveVitsLanguage(input, text, languages) {
    const choices = Array.isArray(languages) && languages.length ? languages : ['中文', '日语']
    const raw = String(input ?? '').trim()
    let keyword = ''
    if (/^(zh|cn|chinese|中文)/i.test(raw)) keyword = '中文'
    else if (/^(ja|jp|japanese|日语|日本語)/i.test(raw)) keyword = '日语'
    else if (/(mix|混合)/i.test(raw)) keyword = '混合'
    else if (!raw) keyword = detectLanguage(text)

    const chineseChoice = choices.find(item => item.includes('中文') && !item.includes('混合')) || choices[0]
    if (keyword === '日语') return choices.find(item => item.includes('日语')) || chineseChoice
    if (keyword === '混合') return choices.find(item => item.includes('混合')) || chineseChoice
    return chineseChoice
}

/**
 * 解析 gradio 的 SSE 响应文本为事件列表。
 * @param {string} body - SSE 原始文本
 * @returns {{event: string, data: string}[]} 事件列表
 */
function parseGradioSse(body) {
    const events = []
    let eventName = 'message'
    let dataLines = []
    const flush = () => {
        if (!dataLines.length) {
            eventName = 'message'
            return
        }
        events.push({ event: eventName, data: dataLines.join('\n') })
        eventName = 'message'
        dataLines = []
    }
    for (const line of String(body ?? '').split(/\r?\n/)) {
        if (line === '') {
            flush()
        } else if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim()
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trim())
        }
    }
    flush()
    return events
}

/**
 * 调用 VITS 服务合成语音。
 * gradio 6 采用「POST 取 event_id → GET SSE 取结果」的两步协议。
 * @param {Object} options - 合成参数
 * @param {string} options.text - 文本
 * @param {string} options.language - 服务端语言枚举值
 * @param {string} options.speaker - 服务端音色名
 * @param {number} options.noiseScale - noise_scale
 * @param {number} options.noiseScaleW - noise_scale_w
 * @param {number} options.lengthScale - length_scale
 * @returns {Promise<{message: string, audio: Object|null, extra: string}>} 合成结果
 */
async function callVitsSpeech(options) {
    const { text, language, speaker, noiseScale, noiseScaleW, lengthScale } = options
    const endpoint = `${VITS_BASE_URL}/gradio_api/call/${VITS_API_NAME}`

    const accepted = await axios.post(
        endpoint,
        { data: [text, language, speaker, noiseScale, noiseScaleW, lengthScale] },
        { timeout: VITS_CALL_TIMEOUT, headers: VITS_AUTH_HEADERS }
    )
    const eventId = accepted.data?.event_id
    if (!eventId) {
        throw new Error(`服务未返回 event_id: ${JSON.stringify(accepted.data).slice(0, 200)}`)
    }

    const stream = await axios.get(`${endpoint}/${eventId}`, {
        timeout: VITS_RESULT_TIMEOUT,
        responseType: 'text',
        transformResponse: [value => value],
        headers: VITS_AUTH_HEADERS
    })
    const events = parseGradioSse(stream.data)

    const errorEvent = events.find(item => item.event === 'error')
    if (errorEvent) {
        let detail = errorEvent.data
        try {
            detail = JSON.parse(errorEvent.data)?.error || detail
        } catch {
            // data 非 JSON 时保留原文
        }
        throw new Error(String(detail).split('\n')[0])
    }

    const completeEvent = events.find(item => item.event === 'complete')
    if (!completeEvent) {
        throw new Error('服务未返回合成结果（SSE 流缺少 complete 事件）')
    }

    let payload
    try {
        payload = JSON.parse(completeEvent.data)
    } catch {
        throw new Error('服务返回的合成结果不是合法 JSON')
    }
    if (!Array.isArray(payload)) {
        throw new Error('服务返回的合成结果格式异常')
    }
    return { message: payload[0], audio: payload[1] || null, extra: payload[2] || '' }
}

/**
 * 把服务端返回的 FileData 转为可下载的绝对地址。
 * 服务端返回的 url 基于它自己的 localhost，跨机访问需按固定端点重写。
 * @param {Object} audio - gradio FileData
 * @returns {string} 可下载地址
 */
function resolveVitsAudioUrl(audio) {
    if (!audio || typeof audio !== 'object') return ''
    if (typeof audio.path === 'string' && audio.path) {
        return `${VITS_BASE_URL}/gradio_api/file=${audio.path}`
    }
    if (typeof audio.url === 'string' && audio.url) {
        try {
            const target = new URL(audio.url)
            const base = new URL(VITS_BASE_URL)
            target.protocol = base.protocol
            target.host = base.host
            return target.toString()
        } catch {
            return audio.url
        }
    }
    return ''
}

export const voiceTools = [
    {
        name: 'set_ai_voice_chat',
        description: '设置群AI声聊开关（需要NapCat协议端）。开启后群内消息将触发AI语音回复',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                enable: { type: 'boolean', description: '是否开启，默认true' },
                character: { type: 'string', description: '声聊角色/音色（可选）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const { api, adapter: protocol } = getVoiceContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                api.requireCapability('ai_voice')
                const groupId = args.group_id ? api.targetId(args.group_id) : e?.group_id
                if (!groupId) {
                    return { success: false, error: '需要指定群号或在群聊中使用' }
                }
                const enable = args.enable !== false
                await api.callAction(
                    'set_group_ai_record',
                    { group_id: groupId, enable, character: args.character || '' },
                    { strict: true }
                )
                return {
                    success: true,
                    protocol,
                    group_id: groupId,
                    enabled: enable,
                    message: enable ? 'AI声聊已开启' : 'AI声聊已关闭'
                }
            } catch (err) {
                return { success: false, error: `设置AI声聊失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_ai_voice_characters',
        description:
            '【查询】获取AI声聊可用的角色/音色列表。仅用于查询可用角色，不发送消息。常见角色包括：嘉然_元气、珈乐_温柔、乃琳_温柔、贝拉_可爱、阿梓_元气',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号（可选）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const { api, adapter: protocol } = getVoiceContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                const groupId = args.group_id ? api.targetId(args.group_id) : e?.group_id
                try {
                    const fs = await import('fs')
                    const path = await import('path')
                    const { fileURLToPath } = await import('url')
                    const __dirname = path.dirname(fileURLToPath(import.meta.url))
                    const configPath = path.join(__dirname, '../../../config/aivoice.json')

                    if (fs.existsSync(configPath)) {
                        const data = fs.readFileSync(configPath, 'utf8')
                        const voiceConfig = JSON.parse(data)
                        const allCharacters = []

                        for (const category in voiceConfig) {
                            for (const char of voiceConfig[category]) {
                                allCharacters.push({
                                    id: char.id,
                                    name: char.name,
                                    category: category
                                })
                            }
                        }

                        if (allCharacters.length > 0) {
                            return {
                                success: true,
                                protocol,
                                source: 'local_config',
                                count: allCharacters.length,
                                characters: allCharacters,
                                usage: '使用 send_ai_voice 工具发送语音，character 参数填写角色ID'
                            }
                        }
                    }
                } catch {
                    // 配置文件不存在或读取失败，尝试API
                }

                const result = await api.callAction('get_ai_characters', { group_id: groupId }, { strict: true })
                const characters = result?.data || result || []
                if (Array.isArray(characters) && characters.length > 0) {
                    return {
                        success: true,
                        protocol,
                        source: 'standard_api',
                        group_id: groupId,
                        count: characters.length,
                        characters: characters.map(c => ({
                            id: c.character_id || c.id,
                            name: c.character_name || c.name,
                            voice_type: c.voice_type,
                            description: c.description
                        }))
                    }
                }

                return {
                    success: false,
                    protocol,
                    error: 'AI声聊功能需要 NapCat 协议端支持，或配置 config/aivoice.json',
                    hint: '请确认协议端是否支持 get_ai_characters API，或创建 aivoice.json 配置文件',
                    alternatives: ['send_tts', 'send_voice']
                }
            } catch (err) {
                return { success: false, error: `获取AI声聊角色失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_ai_voice',
        description:
            '【发送】AI语音消息到群聊（使用QQ的AI声聊功能合成语音）。必须提供当前群号group_id。角色ID推荐：lucy-voice-laibixiaoxin(小新)、lucy-voice-houge(猴哥)、lucy-voice-daji(妲己)、lucy-voice-xueling(元气少女)、lucy-voice-female1(邻家小妹)',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要转为语音的文字内容' },
                character: {
                    type: 'string',
                    description: '角色ID（必填），推荐：lucy-voice-laibixiaoxin、lucy-voice-houge、lucy-voice-daji'
                },
                group_id: { type: 'string', description: '群号（必填，请填写当前群号）' }
            },
            required: ['text', 'character', 'group_id']
        },
        handler: async (args, ctx) => {
            try {
                if (!args.text || args.text.trim() === '') {
                    return { success: false, error: '缺少必需参数: text (要转为语音的文字内容)' }
                }
                if (!args.character || args.character.trim() === '') {
                    return { success: false, error: '缺少必需参数: character (角色ID)' }
                }

                const e = ctx.getEvent()
                const { api, rawApi, adapter, isNT, canAiVoice } = getVoiceContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                api.requireCapability('ai_voice')
                const groupId = args.group_id ? api.targetId(args.group_id) : e?.group_id

                // 转换角色ID：后续所有适配器分支都必须使用转换后的 character，不能再用 args.character
                const character = resolveAiVoiceCharacter(args.character)
                if (character !== args.character) {
                    logger.info(`[send_ai_voice] 角色名转换: ${args.character} -> ${character}`)
                }

                if (!groupId) {
                    return { success: false, error: '需要指定群号或在群聊中使用' }
                }
                if (!character) {
                    return { success: false, error: '需要指定角色ID' }
                }
                let result
                try {
                    result = await api.callGroup(groupId, 'sendAiRecord', [character, args.text])
                } catch {
                    try {
                        result = await api.callAction(
                            'send_group_ai_record',
                            { character, group_id: groupId, text: args.text },
                            { strict: true }
                        )
                    } catch (actionError) {
                        if (!rawApi.capabilities().sendOidbSvcTrpcTcp) throw actionError
                        const rawResult = await rawApi.send({
                            method: 'send_oidb_svc_trpc_tcp',
                            cmd: 'OidbSvcTrpcTcp.0x929b_0',
                            body: {
                                1: groupId,
                                2: character,
                                3: args.text,
                                4: 1,
                                5: { 1: Math.floor(Math.random() * 4294967295) }
                            }
                        })
                        result = rawResult.response
                    }
                }
                const data = result?.toJSON?.() || result
                if (data?.error || data?.err) throw new Error(data.error || data.err)
                return {
                    success: true,
                    completed: true,
                    adapter,
                    is_nt: isNT,
                    can_ai_voice: canAiVoice,
                    message: `AI语音已发送到群 ${groupId}`,
                    message_id: data?.message_id || data?.data?.message_id,
                    debug: data
                }
            } catch (err) {
                return { success: false, error: `发送AI语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_voice',
        description: '发送语音消息（直接发送语音文件）',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '语音文件URL' },
                file: { type: 'string', description: '本地语音文件路径' },
                base64: { type: 'string', description: '语音base64数据' },
                magic: { type: 'boolean', description: '是否变声' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                let recordData
                if (args.url) {
                    recordData = args.url
                } else if (args.file) {
                    recordData = `file://${args.file}`
                } else if (args.base64) {
                    recordData = `base64://${args.base64.replace(/^data:[^;]+;base64,/, '')}`
                } else {
                    return { success: false, error: '需要提供 url、file 或 base64' }
                }
                const recordSeg = { ...StandardMessage.record(recordData), magic: args.magic ? 1 : 0 }
                const result = await StandardBotApi.fromContext(ctx).reply(recordSeg)

                // 检查发送结果
                if (result.success) {
                    return {
                        success: true,
                        completed: true,
                        message: '语音消息已发送',
                        message_id: result.message_id
                    }
                } else if (result === true || (result && !result.error)) {
                    return { success: true, completed: true, message: '语音消息已发送' }
                } else if (result?.error || result?.retcode !== 0) {
                    return {
                        success: false,
                        error: result?.error || result?.message || '发送语音失败',
                        debug: result
                    }
                }

                return { success: true, completed: true, message: '语音消息已发送' }
            } catch (err) {
                return { success: false, error: `发送语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'parse_voice',
        description: '获取消息中的语音信息',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }
                let voiceInfo = null
                for (const seg of e.message || []) {
                    if (seg.type === 'record' || seg.type === 'audio') {
                        voiceInfo = {
                            url: seg.url || seg.file,
                            file: seg.file,
                            magic: seg.magic,
                            duration: seg.seconds
                        }
                        break
                    }
                }
                if (!voiceInfo) {
                    return { success: false, error: '消息中没有语音' }
                }
                return { success: true, voice: voiceInfo }
            } catch (err) {
                return { success: false, error: `解析语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_record',
        description: '获取语音文件详情（转换格式等）',
        inputSchema: {
            type: 'object',
            properties: {
                file: { type: 'string', description: '语音文件标识' },
                out_format: {
                    type: 'string',
                    enum: ['mp3', 'amr', 'wma', 'm4a', 'spx', 'ogg', 'wav', 'flac'],
                    description: '输出格式'
                }
            },
            required: ['file']
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                if (!args.file || args.file.trim() === '') {
                    return { success: false, error: '缺少必需参数: file (语音文件标识)' }
                }

                const result = await api.callAction(
                    'get_record',
                    { file: args.file, out_format: args.out_format || 'mp3' },
                    { strict: true }
                )

                // 检查返回值
                const fileData = result?.data?.file || result?.file
                const urlData = result?.data?.url || result?.url
                if (!fileData && !urlData) return { success: false, error: '获取语音文件失败: 返回数据为空' }
                return { success: true, file: fileData, url: urlData, format: args.out_format || 'mp3' }
            } catch (err) {
                return { success: false, error: `获取语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_tts_speakers',
        description: '【查询】获取VITS语音合成服务当前支持的音色与语言列表（实时读取服务端枚举，不在本地硬编码）',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            try {
                const { speakers, languages } = await fetchVitsMeta()
                return {
                    success: true,
                    source: 'vits',
                    api: VITS_BASE_URL,
                    count: speakers.length,
                    speakers,
                    languages,
                    usage: '使用 send_tts 工具发送语音，speaker 参数填写音色名；支持简称，如 甘雨 会自动匹配 甘雨（椰羊）',
                    note: '音色列表来自服务端，服务端更换模型后自动更新'
                }
            } catch (err) {
                const hint = err.response?.status === 401 ? '（401：令牌无效，请检查 VITS_AUTH_TOKEN）' : ''
                return { success: false, error: `获取VITS音色失败: ${err.message}${hint}` }
            }
        }
    },

    {
        name: 'send_tts',
        description: '发送TTS语音消息（使用 VITS 语音合成，音色列表实时读取自服务端）',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: '要转换的文字内容'
                },
                speaker: {
                    type: 'string',
                    description:
                        '音色名，默认"派蒙"。支持简称（如 甘雨 会匹配 甘雨（椰羊）），完整列表用 get_tts_speakers 查询'
                },
                lang: {
                    type: 'string',
                    description: '语言（自动检测），可选：中文/日语；英文文本使用中文模式'
                },
                noise_scale: {
                    type: 'number',
                    description: '噪声控制（0-1），默认0.6，影响音色变化'
                },
                noise_scale_w: {
                    type: 'number',
                    description: '清晰度控制（0-1），默认0.668，数值越小越清晰'
                },
                length_scale: {
                    type: 'number',
                    description: '语速控制（>0），默认1.2，数值越大语速越慢'
                },
                group_id: {
                    type: 'string',
                    description: '目标群号（可选，不填则回复当前会话）'
                },
                user_id: {
                    type: 'string',
                    description: '目标用户QQ号，用于私聊发送（可选）'
                }
            },
            required: ['text']
        },
        handler: async (args, ctx) => {
            const logger = global.logger || console

            try {
                // 参数验证
                if (!args.text || args.text.trim() === '') {
                    return { success: false, error: '缺少必需参数: text (要转换的文字)' }
                }

                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!e && !api.bot) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                // 确定发送目标
                const targetGroupId = args.group_id ? api.targetId(args.group_id) : null
                const targetUserId = args.user_id ? api.targetId(args.user_id) : null

                // 发送emoji表情反馈（表示正在处理）
                if (e?.isGroup) {
                    try {
                        await api.setReaction({ messageId: e.message_id, emojiId: '124', groupId: e.group_id })
                    } catch (emojiErr) {
                        // emoji 发送失败不影响主流程
                        logger.debug(`[send_tts] emoji反馈失败: ${emojiErr.message}`)
                    }
                }

                // 文本长度限制
                const text = args.text.trim()
                const maxTextLength = Number(config.get('voice.maxTextLength')) || 500
                if (text.length > maxTextLength) {
                    return { success: false, error: `文本过长（${text.length} > ${maxTextLength} 字），请分段发送` }
                }

                // 音色与语言：枚举实时读取自服务端，再解析成服务端接受的精确值
                const meta = await fetchVitsMeta()
                const speakerInput = (args.speaker || '派蒙').trim() || '派蒙'
                const speaker = resolveVitsSpeaker(speakerInput, meta.speakers)
                const lang = resolveVitsLanguage(args.lang, text, meta.languages)
                const noise_scale = safePositiveNumber(args.noise_scale, 0.6)
                const noise_scale_w = safePositiveNumber(args.noise_scale_w, 0.668)
                const length_scale = safePositiveNumber(args.length_scale, 1.2)

                logger.info(
                    `[send_tts] 开始生成: api=${VITS_BASE_URL}, speaker=${speaker}${speaker !== speakerInput ? `(输入 ${speakerInput})` : ''}, lang=${lang}, text="${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`
                )

                // 合成语音：服务端只返回文件信息，音频在下一步单独下载
                const speech = await callVitsSpeech({
                    text,
                    language: lang,
                    speaker,
                    noiseScale: noise_scale,
                    noiseScaleW: noise_scale_w,
                    lengthScale: length_scale
                })
                if (!speech.audio) {
                    return {
                        success: false,
                        error: `生成失败: ${speech.message || '服务未返回音频'}`,
                        extra: speech.extra
                    }
                }

                const audioUrl = resolveVitsAudioUrl(speech.audio)
                if (!audioUrl) {
                    logger.warn(`[send_tts] 服务返回的音频缺少地址: ${JSON.stringify(speech.audio)}`)
                    return { success: false, error: '服务返回的音频缺少下载地址' }
                }

                // 协议端无法直接转码远端地址，先下载再转 base64
                logger.debug(`[send_tts] 下载合成音频: ${audioUrl}`)
                let recordData = ''
                try {
                    const audioResponse = await axios.get(audioUrl, {
                        responseType: 'arraybuffer',
                        timeout: VITS_AUDIO_TIMEOUT,
                        maxContentLength: VITS_AUDIO_MAX_BYTES,
                        headers: VITS_AUTH_HEADERS
                    })
                    const base64Audio = Buffer.from(audioResponse.data).toString('base64')
                    recordData = `base64://${base64Audio}`
                    logger.debug(`[send_tts] 音频已转为 base64 (${base64Audio.length} 字符)`)
                } catch (downloadErr) {
                    logger.error(`[send_tts] 下载音频失败: ${downloadErr.message}`)
                    return { success: false, error: `下载音频失败: ${downloadErr.message}` }
                }

                // 发送语音消息
                const recordSeg = StandardMessage.record(recordData)
                const result = await api.send({ groupId: targetGroupId, userId: targetUserId, message: recordSeg })
                const targetInfo = targetUserId
                    ? `私聊 ${targetUserId}`
                    : targetGroupId
                      ? `群 ${targetGroupId}`
                      : e?.isGroup
                        ? `当前群 ${e.group_id}`
                        : `当前私聊 ${e?.user_id}`

                logger.debug(`[send_tts] 发送目标: ${targetInfo}`)

                if (result.success) {
                    logger.info(`[send_tts] 语音发送成功: message_id=${result.message_id}`)
                    return {
                        success: true,
                        completed: true,
                        message: `VITS语音已发送 (角色: ${speaker})`,
                        message_id: result.message_id,
                        speaker,
                        text: text.substring(0, 100)
                    }
                }

                logger.info(`[send_tts] 语音发送完成`)
                return {
                    success: true,
                    completed: true,
                    message: `VITS语音已发送 (角色: ${speaker})`,
                    speaker,
                    text: text.substring(0, 100)
                }
            } catch (err) {
                // 详细的错误日志
                let errMsg = err.message
                if (err.response) {
                    errMsg += ` [HTTP ${err.response.status}]`
                    if (err.response.data) {
                        const dataPreview = JSON.stringify(err.response.data).substring(0, 100)
                        errMsg += ` [Data: ${dataPreview}...]`
                    }
                }

                logger.error(`[send_tts] 语音生成出错: ${errMsg}`)

                // 本地校验类错误（音色不存在、文本过长、SSE 报错等）已是可读文案，直接透传
                if (!err.isAxiosError) {
                    return { success: false, error: err.message }
                }

                // 网络类错误给出可操作的提示
                if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
                    return { success: false, error: 'VITS 服务请求超时，请稍后再试' }
                }
                if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH') {
                    return { success: false, error: `VITS 服务不可达（${err.code}），请检查服务状态或稍后重试` }
                }
                if (err.response?.status === 401) {
                    return {
                        success: false,
                        error: 'VITS 服务鉴权失败（401），请确认插件内 VITS_AUTH_TOKEN 与服务端 auth_tokens.txt 一致'
                    }
                }
                if (err.response?.status >= 500) {
                    return { success: false, error: 'VITS 服务暂时不可用，请稍后再试' }
                }
                if (err.response?.status === 404) {
                    return { success: false, error: 'VITS API 地址无效' }
                }

                return { success: false, error: `VITS 语音生成失败: ${errMsg}` }
            }
        }
    },

    {
        name: 'get_ai_record',
        description: '【获取数据】仅获取AI语音的文件数据，不会发送消息。如需发送AI语音，请使用 send_ai_voice',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要转换的文字' },
                character: { type: 'string', description: '角色/音色ID' },
                group_id: { type: 'string', description: '群号' }
            },
            required: ['text', 'character']
        },
        handler: async (args, ctx) => {
            try {
                // 参数验证
                if (!args.text || args.text.trim() === '') {
                    return { success: false, error: '缺少必需参数: text (要转换的文字)' }
                }
                if (!args.character || args.character.trim() === '') {
                    return { success: false, error: '缺少必需参数: character (角色/音色ID)' }
                }

                const e = ctx.getEvent()
                const { api, adapter } = getVoiceContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                api.requireCapability('ai_voice')

                const groupId = args.group_id ? api.targetId(args.group_id) : e?.group_id
                const result = await api.callAction(
                    'get_ai_record',
                    { group_id: groupId, character: resolveAiVoiceCharacter(args.character), text: args.text },
                    { strict: true }
                )

                // 检查返回值
                const fileData = result?.data?.file || result?.file
                const urlData = result?.data?.url || result?.url
                if (!fileData && !urlData) return { success: false, adapter, error: '获取AI语音失败: 返回数据为空' }
                return {
                    success: true,
                    adapter,
                    text: args.text,
                    character: resolveAiVoiceCharacter(args.character),
                    file: fileData,
                    url: urlData
                }
            } catch (err) {
                return { success: false, error: `获取AI语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'send_private_ai_record',
        description: '发送私聊AI语音消息。注意：AI语音功能需要先通过群聊生成语音，然后转发到私聊。',
        inputSchema: {
            type: 'object',
            properties: {
                user_id: { type: 'string', description: '目标用户QQ号' },
                text: { type: 'string', description: '要转为语音的文字' },
                character: { type: 'string', description: '角色/音色ID' },
                group_id: { type: 'string', description: '用于生成AI语音的群号（可选，用于icqq协议）' }
            },
            required: ['user_id', 'text', 'character']
        },
        handler: async (args, ctx) => {
            try {
                // 参数验证
                if (!args.user_id) {
                    return { success: false, error: '缺少必需参数: user_id (目标用户QQ号)' }
                }
                if (!args.text || args.text.trim() === '') {
                    return { success: false, error: '缺少必需参数: text (要转为语音的文字)' }
                }
                if (!args.character || args.character.trim() === '') {
                    return { success: false, error: '缺少必需参数: character (角色/音色ID)' }
                }

                const e = ctx.getEvent()
                const { api, adapter } = getVoiceContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                api.requireCapability('ai_voice')

                const userId = api.targetId(args.user_id)
                try {
                    const result = await api.callAction(
                        'send_private_ai_record',
                        { user_id: userId, character: resolveAiVoiceCharacter(args.character), text: args.text },
                        { strict: true }
                    )
                    return {
                        success: true,
                        completed: true,
                        adapter,
                        user_id: userId,
                        message_id: result?.message_id || result?.data?.message_id
                    }
                } catch {}
                const aiRecord = await api.callAction(
                    'get_ai_record',
                    {
                        character: resolveAiVoiceCharacter(args.character),
                        text: args.text,
                        group_id: args.group_id || e?.group_id
                    },
                    { strict: true }
                )
                const file = aiRecord?.data?.file || aiRecord?.file || aiRecord?.data?.url || aiRecord?.url
                if (!file) throw new Error('协议端未返回AI语音文件')
                const sent = await api.sendPrivate(userId, StandardMessage.record(file))
                return {
                    success: true,
                    completed: true,
                    adapter,
                    user_id: userId,
                    message_id: sent.message_id
                }
            } catch (err) {
                return { success: false, error: `发送私聊AI语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_voice_info',
        description: '获取语音消息的详细信息（包括下载URL）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息ID（包含语音的消息）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                // 如果没有指定消息ID，尝试从当前消息获取
                if (!args.message_id) {
                    for (const seg of e?.message || []) {
                        if (seg.type === 'record') {
                            return {
                                success: true,
                                type: 'record',
                                file: seg.file,
                                url: seg.url,
                                fid: seg.fid,
                                md5: seg.md5,
                                size: seg.size,
                                seconds: seg.seconds
                            }
                        }
                    }
                    return { success: false, error: '当前消息不包含语音' }
                }

                const msg = await api.getMessage(
                    args.message_id,
                    /* 群聊事件同时带 group_id 与 user_id，StandardBotApi 不允许两者并存，只取群目标 */
                    e?.group_id ? { groupId: e.group_id } : { userId: e?.user_id }
                )
                const message = msg?.data?.message || msg?.message || []

                for (const seg of message) {
                    if (seg.type === 'record') {
                        return {
                            success: true,
                            type: 'record',
                            file: seg.data?.file || seg.file,
                            url: seg.data?.url || seg.url,
                            path: seg.data?.path || seg.path
                        }
                    }
                }

                return { success: false, error: '消息中未找到语音' }
            } catch (err) {
                return { success: false, error: `获取语音信息失败: ${err.message}` }
            }
        }
    },

    {
        name: 'download_voice',
        description: '下载语音文件',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '语音文件URL' },
                file_id: { type: 'string', description: '语音文件ID（从消息获取）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const api = StandardBotApi.fromContext(ctx)

                let url = args.url

                // 如果提供了 file_id，先获取 URL
                if (!url && args.file_id) {
                    const result = await api.callAction(
                        'get_record',
                        { file: args.file_id, out_format: 'mp3' },
                        { strict: true }
                    )
                    url = result?.data?.url || result?.url
                }

                if (!url) {
                    return { success: false, error: '需要提供 url 或 file_id' }
                }

                /* 与文件/媒体工具共用受限下载链：逐跳校验 URL、超时、大小上限，并在返回前清理临时文件。 */
                const { cleanupTemporaryDownload, downloadToManagedCache } = await import('./file.js')
                let downloaded
                try {
                    downloaded = await downloadToManagedCache(url, {
                        filename: 'voice.bin',
                        maxBytes: 16 * 1024 * 1024
                    })
                    const buffer = await fs.promises.readFile(downloaded.filePath)
                    const base64 = buffer.toString('base64')

                    return {
                        success: true,
                        url: downloaded.url,
                        size: downloaded.size,
                        content_type: downloaded.contentType,
                        base64: `base64://${base64}`
                    }
                } finally {
                    if (downloaded?.filePath) await cleanupTemporaryDownload(downloaded.filePath)
                }
            } catch (err) {
                return { success: false, error: `下载语音失败: ${err.message}` }
            }
        }
    },

    {
        name: 'voice_to_text',
        description: '语音转文字（语音识别）',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '包含语音的消息ID（不填则使用当前消息）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const api = StandardBotApi.fromContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                let fileId = null

                // 获取语音文件ID
                if (args.message_id) {
                    const msg = await api.getMessage(
                        args.message_id,
                        /* 群聊事件同时带 group_id 与 user_id，StandardBotApi 不允许两者并存，只取群目标 */
                        e?.group_id ? { groupId: e.group_id } : { userId: e?.user_id }
                    )
                    const message = msg?.data?.message || msg?.message || []
                    for (const seg of message) {
                        if (seg.type === 'record') {
                            fileId = seg.data?.file || seg.file
                            break
                        }
                    }
                } else {
                    for (const seg of e?.message || []) {
                        if (seg.type === 'record') {
                            fileId = seg.file || seg.fid
                            break
                        }
                    }
                }

                if (!fileId) {
                    return { success: false, error: '未找到语音消息' }
                }

                const asrResult = await api.callAction('asr', { file: fileId }, { strict: true })
                const text = asrResult?.data?.text || asrResult?.text
                if (!text) return { success: false, error: '协议端未返回识别文本' }
                return { success: true, text, file: fileId }
            } catch (err) {
                return { success: false, error: `语音转文字失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_ai_voice_status',
        description: '【查询】群AI声聊功能是否可用（仅查询状态，不发送消息）。如需发送AI语音，请使用 send_ai_voice',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const { api, adapter, isNT, canAiVoice } = getVoiceContext(ctx)
                if (!api.bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const groupId = args.group_id ? api.targetId(args.group_id) : e?.group_id

                if (!groupId) {
                    return { success: false, error: '需要指定群号或在群聊中使用' }
                }

                if (!canAiVoice) {
                    return {
                        success: true,
                        group_id: groupId,
                        adapter,
                        isNT,
                        canAiVoice: false,
                        note: '当前协议端未声明 AI 声聊能力'
                    }
                }

                const result = await api.callAction('get_group_ai_record_status', { group_id: groupId })
                const data = result?.data || result || {}
                const characters = await api.callAction('get_ai_characters', { group_id: groupId })
                return {
                    success: true,
                    group_id: groupId,
                    adapter,
                    isNT,
                    canAiVoice,
                    enabled: data.enabled,
                    character: data.character,
                    character_count: Array.isArray(characters?.data || characters)
                        ? (characters?.data || characters).length
                        : undefined
                }
            } catch (err) {
                return { success: false, error: `获取AI声聊状态失败: ${err.message}` }
            }
        }
    },

    {
        name: 'list_voice_formats',
        description: '列出支持的语音格式',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            return {
                success: true,
                supported_input: [
                    { format: 'silk', description: 'QQ原生语音格式，推荐使用' },
                    { format: 'amr', description: 'AMR格式，兼容性好' },
                    { format: 'mp3', description: 'MP3格式，需要转码' },
                    { format: 'wav', description: 'WAV格式，需要转码' },
                    { format: 'ogg', description: 'OGG格式，需要转码' }
                ],
                supported_output: [
                    { format: 'mp3', description: 'MP3格式' },
                    { format: 'amr', description: 'AMR格式' },
                    { format: 'wma', description: 'WMA格式' },
                    { format: 'm4a', description: 'M4A格式' },
                    { format: 'spx', description: 'Speex格式' },
                    { format: 'ogg', description: 'OGG格式' },
                    { format: 'wav', description: 'WAV格式' },
                    { format: 'flac', description: 'FLAC格式' }
                ],
                notes: [
                    '发送语音需要协议端支持，推荐使用 silk 或 amr 格式',
                    'AI声聊功能需要 NapCat 协议端支持',
                    '语音转码可能需要 ffmpeg'
                ]
            }
        }
    },
    {
        name: 'send_voice_reply',
        description: '回复消息并发送语音',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '语音文件URL' },
                file: { type: 'string', description: '本地语音文件路径' },
                base64: { type: 'string', description: '语音base64数据' },
                reply_to: { type: 'string', description: '要回复的消息ID（不填则回复当前消息）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                if (!e) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                let recordData
                if (args.url) {
                    recordData = args.url
                } else if (args.file) {
                    recordData = `file://${args.file}`
                } else if (args.base64) {
                    recordData = `base64://${args.base64.replace(/^data:[^;]+;base64,/, '')}`
                } else {
                    return { success: false, error: '需要提供 url、file 或 base64' }
                }

                const replyId = args.reply_to || e.message_id

                const msg = [StandardMessage.reply(replyId), StandardMessage.record(recordData)]
                const result = await StandardBotApi.fromContext(ctx).reply(msg)
                return { success: true, message_id: result.message_id }
            } catch (err) {
                return { success: false, error: `发送语音回复失败: ${err.message}` }
            }
        }
    }
]
