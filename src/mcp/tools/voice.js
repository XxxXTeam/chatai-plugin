import axios from 'axios'
import { randomUUID } from 'crypto'
import fs from 'node:fs'
import { chatLogger as logger } from '../../core/utils/logger.js'
import { StandardBotApi, StandardMessage, StandardRawApi } from '../../core/platform/index.js'

/**
 * 语音消息工具
 */

const VITS_API_URL = 'https://mikusfan-vits-uma-genshin-honkai.hf.space/api/generate'

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
    if (/^[a-zA-Z\s,.?!]+$/.test(text)) {
        return 'English'
    }
    return '中文'
}

function safePositiveNumber(value, fallback) {
    const num = Number(value)
    return Number.isFinite(num) && num > 0 ? num : fallback
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
        description: '【查询】获取VITS语音合成可用的角色/音色列表。常用角色包括原神、崩坏角色等',
        inputSchema: {
            type: 'object',
            properties: {}
        },
        handler: async () => {
            // VITS 支持的角色列表（按游戏/来源分类）
            const speakers = {
                原神: [
                    '派蒙',
                    '凯亚',
                    '安柏',
                    '丽莎',
                    '琴',
                    '香菱',
                    '枫原万叶',
                    '迪卢克',
                    '温迪',
                    '可莉',
                    '早柚',
                    '托马',
                    '芭芭拉',
                    '优菈',
                    '云堇',
                    '钟离',
                    '魈',
                    '凝光',
                    '雷电将军',
                    '北斗',
                    '甘雨',
                    '七七',
                    '刻晴',
                    '神里绫华',
                    '戴因斯雷布',
                    '雷泽',
                    '神里绫人',
                    '罗莎莉亚',
                    '阿贝多',
                    '八重神子',
                    '宵宫',
                    '若陀龙王',
                    '九条裟罗',
                    '夜兰',
                    '珊瑚宫心海',
                    '五郎',
                    '散兵',
                    '女士',
                    '达达利亚',
                    '莫娜',
                    '班尼特',
                    '申鹤',
                    '行秋',
                    '烟绯',
                    '久岐忍',
                    '辛焱',
                    '砂糖',
                    '胡桃',
                    '重云',
                    '菲谢尔',
                    '诺艾尔',
                    '迪奥娜',
                    '鹿野院平藏'
                ],
                崩坏3: [
                    '琪亚娜',
                    '爱莉希雅',
                    '卡莲',
                    '八重樱',
                    '雷电芽衣',
                    '布洛妮娅',
                    '希儿',
                    '明日香',
                    '符华',
                    '德丽莎',
                    '渡鸦',
                    '芽衣'
                ],
                崩坏星穹铁道: [
                    '开拓者女',
                    '开拓者男',
                    '三月七',
                    '丹恒',
                    '希露瓦',
                    '姬子',
                    '瓦尔特',
                    '艾丝妲',
                    '布洛妮娅',
                    '希儿',
                    '杰帕德',
                    '景元'
                ],
                赛马娘: [
                    '特别周',
                    '无声铃鹿',
                    '东海帝王',
                    '丸善斯基',
                    '富士奇迹',
                    '小栗帽',
                    '黄金船',
                    '伏特加',
                    '大和赤骥',
                    '目白麦昆',
                    '神鹰',
                    '好歌剧',
                    '成田白仁',
                    '草上飞'
                ],
                其他: ['塔菲', '阿梓', '奶绿', '星瞳', '向晚', '嘉然', '乃琳', '贝拉', '珈乐']
            }

            const allSpeakers = []
            for (const [category, names] of Object.entries(speakers)) {
                for (const name of names) {
                    allSpeakers.push({ name, category })
                }
            }

            return {
                success: true,
                source: 'vits',
                api: 'https://mikusfan-vits-uma-genshin-honkai.hf.space',
                count: allSpeakers.length,
                categories: Object.keys(speakers),
                speakers,
                popular: ['派蒙', '甘雨', '雷电将军', '胡桃', '刻晴', '神里绫华', '钟离', '琪亚娜', '爱莉希雅'],
                usage: '使用 send_tts 工具发送语音，speaker 参数填写角色名',
                note: '角色名需要准确匹配，支持中文名。如果生成失败请尝试换个角色'
            }
        }
    },

    {
        name: 'send_tts',
        description: '发送TTS语音消息（使用 VITS 语音合成，支持多种角色和语言）',
        inputSchema: {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: '要转换的文字内容'
                },
                speaker: {
                    type: 'string',
                    description: '角色/音色名，默认"派蒙"。常用角色：派蒙、凯亚、甘雨、雷电将军等'
                },
                lang: {
                    type: 'string',
                    description: '语言（自动检测），可选：中文/English/日语'
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

                const text = args.text.trim()
                const speaker = (args.speaker || '派蒙').trim() || '派蒙'
                const lang = args.lang || detectLanguage(text)
                const noise_scale = safePositiveNumber(args.noise_scale, 0.6)
                const noise_scale_w = safePositiveNumber(args.noise_scale_w, 0.668)
                const length_scale = safePositiveNumber(args.length_scale, 1.0)

                logger.info(
                    `[send_tts] 开始生成: speaker=${speaker}, lang=${lang}, text="${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`
                )

                // 构建 API 请求
                const payload = {
                    fn_index: 0,
                    data: [text, lang, speaker, noise_scale, noise_scale_w, length_scale],
                    session_hash: randomUUID()
                }

                const response = await axios.post(VITS_API_URL, payload, {
                    timeout: 30000 // 30秒超时
                })
                const data = response.data

                // 检查 API 响应
                if (!(data?.data && data.data[1])) {
                    logger.warn(`[send_tts] API 返回无效数据: ${JSON.stringify(data)}`)
                    return {
                        success: false,
                        error: '生成失败，API 未返回有效数据。可能是角色名不正确或服务繁忙，请检查角色名或稍后再试'
                    }
                }

                const audioData = data.data[1]
                let recordData = ''

                // 支持两种音频数据格式
                if (audioData.data) {
                    // 格式1: Base64 编码的音频数据
                    const base64 = audioData.data.split(',')[1] || audioData.data
                    recordData = `base64://${base64}`
                    logger.debug(`[send_tts] 使用 base64 音频数据 (${base64.length} 字符)`)
                } else if (audioData.name) {
                    // 格式2: 服务器上的文件路径 - 需要下载并转为base64
                    // 远程URL无法被ICQQ直接转码为AMR，必须先下载
                    const audioUrl = `https://mikusfan-vits-uma-genshin-honkai.hf.space/file=${audioData.name}`
                    logger.debug(`[send_tts] 下载远程音频: ${audioUrl}`)
                    try {
                        const audioResponse = await axios.get(audioUrl, {
                            responseType: 'arraybuffer',
                            timeout: 15000
                        })
                        const base64Audio = Buffer.from(audioResponse.data).toString('base64')
                        recordData = `base64://${base64Audio}`
                        logger.debug(`[send_tts] 音频已转为 base64 (${base64Audio.length} 字符)`)
                    } catch (downloadErr) {
                        logger.error(`[send_tts] 下载音频失败: ${downloadErr.message}`)
                        return { success: false, error: `下载音频失败: ${downloadErr.message}` }
                    }
                }

                if (!recordData) {
                    logger.warn(`[send_tts] API 返回数据格式异常: ${JSON.stringify(audioData)}`)
                    return { success: false, error: 'API 返回数据格式异常，无法获取音频' }
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

                // 检查发送结果
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

                // 根据错误类型返回友好的错误信息
                if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
                    return { success: false, error: 'VITS 服务请求超时，请稍后再试' }
                } else if (err.response?.status >= 500) {
                    return { success: false, error: 'VITS 服务暂时不可用，请稍后再试' }
                } else if (err.response?.status === 404) {
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

                const msg = await api.getMessage(args.message_id, { groupId: e?.group_id, userId: e?.user_id })
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
                    const msg = await api.getMessage(args.message_id, { groupId: e?.group_id, userId: e?.user_id })
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
