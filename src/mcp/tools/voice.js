import axios from 'axios'
import { randomUUID } from 'crypto'

/**
 * 语音消息工具
 */

const VITS_API_URL = 'https://mikusfan-vits-uma-genshin-honkai.hf.space/api/generate'

/**
 * 检测Bot适配器类型
 * @param {Object} bot - Bot实例
 * @returns {{ adapter: string, isNT: boolean, canAiVoice: boolean }}
 */
function detectAdapter(bot) {
    if (!bot) return { adapter: 'unknown', isNT: false, canAiVoice: false }

    const hasIcqqFeatures = !!(bot.pickGroup && bot.pickFriend && bot.fl && bot.gl)
    const hasNT = typeof bot.sendOidbSvcTrpcTcp === 'function'

    if (hasIcqqFeatures) {
        return { adapter: 'icqq', isNT: hasNT, canAiVoice: hasNT }
    }

    if (bot.sendApi) {
        const isNapCat = !!(
            bot.adapter?.name?.toLowerCase?.()?.includes?.('napcat') ||
            bot.config?.protocol === 'napcat' ||
            bot.version?.app_name?.toLowerCase?.()?.includes?.('napcat')
        )
        if (isNapCat) {
            return { adapter: 'napcat', isNT: true, canAiVoice: true }
        }
        return { adapter: 'onebot', isNT: false, canAiVoice: false }
    }

    return { adapter: 'unknown', isNT: false, canAiVoice: false }
}

/**
 * 检测协议类型（兼容旧代码）
 */
function detectProtocol(bot) {
    return detectAdapter(bot).adapter
}

/**
 * 获取适配器信息（用于ctx缺少getAdapter时的兼容）
 */
function getAdapterInfo(ctx) {
    if (ctx.getAdapter && typeof ctx.getAdapter === 'function') {
        return ctx.getAdapter()
    }
    const e = ctx.getEvent?.() || ctx.event
    const bot = e?.bot || ctx.getBot?.() || global.Bot
    return detectAdapter(bot)
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
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const protocol = detectProtocol(bot)
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                if (!groupId) {
                    return { success: false, error: '需要指定群号或在群聊中使用' }
                }
                const enable = args.enable !== false
                if (bot.sendApi) {
                    try {
                        await bot.sendApi('set_group_ai_record', {
                            group_id: groupId,
                            enable: enable,
                            character: args.character || ''
                        })
                        return {
                            success: true,
                            protocol,
                            group_id: groupId,
                            enabled: enable,
                            message: enable ? 'AI声聊已开启' : 'AI声聊已关闭'
                        }
                    } catch (apiErr) {
                        // API不存在
                    }
                }
                // 备用方法名
                if (bot.setGroupAiRecord) {
                    await bot.setGroupAiRecord(groupId, enable, args.character)
                    return { success: true, protocol, group_id: groupId, enabled: enable }
                }

                return {
                    success: false,
                    protocol,
                    error: 'AI声聊功能需要 NapCat 协议端支持',
                    hint: protocol === 'icqq'
                        ? 'icqq 协议不支持AI声聊，这是QQ原生功能，需要通过NapCat调用'
                        : '请确认协议端是否支持 set_group_ai_record API'
                }
            } catch (err) {
                return { success: false, error: `设置AI声聊失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_ai_voice_characters',
        description: '【查询】获取AI声聊可用的角色/音色列表。仅用于查询可用角色，不发送消息。常见角色包括：嘉然_元气、珈乐_温柔、乃琳_温柔、贝拉_可爱、阿梓_元气',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号（可选）' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const protocol = detectProtocol(bot)
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
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
                } catch (configErr) {
                    // 配置文件不存在或读取失败，尝试API
                }

                // 方法2: NapCat API: get_ai_characters
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('get_ai_characters', {
                            group_id: groupId
                        })
                        const characters = result?.data || result || []

                        if (Array.isArray(characters) && characters.length > 0) {
                            return {
                                success: true,
                                protocol,
                                source: 'api',
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
                    } catch (apiErr) {
                        // API调用失败
                    }
                }

                if (bot.getAiCharacters) {
                    const characters = await bot.getAiCharacters(groupId)
                    return { success: true, protocol, source: 'bot_method', characters }
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
        description: '【发送】AI语音消息到群聊（使用QQ的AI声聊功能合成语音）。必须提供当前群号group_id。角色ID推荐：lucy-voice-laibixiaoxin(小新)、lucy-voice-houge(猴哥)、lucy-voice-daji(妲己)、lucy-voice-xueling(元气少女)、lucy-voice-female1(邻家小妹)',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: '要转为语音的文字内容' },
                character: { type: 'string', description: '角色ID（必填），推荐：lucy-voice-laibixiaoxin、lucy-voice-houge、lucy-voice-daji' },
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
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                // 角色名到ID的映射
                const characterMap = {
                    '小新': 'lucy-voice-laibixiaoxin',
                    '猴哥': 'lucy-voice-houge',
                    '妲己': 'lucy-voice-daji',
                    '四郎': 'lucy-voice-silang',
                    '吕布': 'lucy-voice-lvbu',
                    '霸道总裁': 'lucy-voice-lizeyan',
                    '酥心御姐': 'lucy-voice-suxinjiejie',
                    '元气少女': 'lucy-voice-xueling',
                    '邻家小妹': 'lucy-voice-female1',
                    '嘉然_元气': 'lucy-voice-xueling',
                    '珈乐_温柔': 'lucy-voice-female2',
                    '乃琳_温柔': 'lucy-voice-suxinjiejie',
                    '贝拉_可爱': 'lucy-voice-female1',
                    '阿梓_元气': 'lucy-voice-xueling'
                }

                const { adapter, isNT, canAiVoice } = getAdapterInfo(ctx)
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id

                // 转换角色ID
                let character = args.character
                if (characterMap[character]) {
                    character = characterMap[character]
                    logger.info(`[send_ai_voice] 角色名转换: ${args.character} -> ${character}`)
                }

                if (!groupId) {
                    return { success: false, error: '需要指定群号或在群聊中使用' }
                }
                if (!character) {
                    return { success: false, error: '需要指定角色ID' }
                }
                if (adapter === 'icqq') {
                    // 方法1: 优先使用 pickGroup().sendAiRecord()
                    try {
                        const group = bot.pickGroup?.(groupId)
                        if (group?.sendAiRecord && typeof group.sendAiRecord === 'function') {
                            const result = await group.sendAiRecord(character, args.text)
                            // 检查返回值判断是否成功
                            if (result && (result.message_id || result.seq || result.rand)) {
                                return {
                                    success: true,
                                    completed: true,
                                    adapter: 'icqq',
                                    message: `AI语音已发送到群 ${groupId}`,
                                    message_id: result.message_id,
                                    debug: result
                                }
                            } else if (result === true || (result && !result.error)) {
                                return {
                                    success: true,
                                    completed: true,
                                    adapter: 'icqq',
                                    message: `AI语音已发送到群 ${groupId}`
                                }
                            }
                            // 返回值异常，继续尝试其他方法
                            logger.debug(`[send_ai_voice] sendAiRecord 返回异常:`, result)
                        }
                    } catch (err1) {
                        logger.debug(`[send_ai_voice] sendAiRecord 失败: ${err1.message}`)
                    }

                    // 方法2: 直接发送协议包
                    try {
                        if (typeof bot.sendOidbSvcTrpcTcp === 'function') {
                            const rand = Math.floor(Math.random() * 4294967295)
                            const body = {
                                1: groupId,
                                2: character,
                                3: args.text,
                                4: 1,
                                5: { 1: rand }
                            }
                            logger.info(`[send_ai_voice] 发送协议包, group=${groupId}, character=${character}`)
                            const result = await bot.sendOidbSvcTrpcTcp('OidbSvcTrpcTcp.0x929b_0', body)
                            const data = result?.toJSON?.() || result
                            const hasExplicitError = data && (data.error || data.err)

                            if (hasExplicitError) {
                                const errorMsg = data.error || data.err
                                logger.info(`[send_ai_voice] 协议包返回错误:`, data)
                                return {
                                    success: false,
                                    adapter: 'icqq',
                                    error: `AI语音发送失败: ${errorMsg}`,
                                    debug: data
                                }
                            }
                            const hasVoiceData = data && (data[4] || data['4'] || data[3] || data['3'])
                            if (hasVoiceData || (data && data[1] !== undefined)) {
                                logger.info(`[send_ai_voice] AI语音发送成功, group=${groupId}`)
                                return {
                                    success: true,
                                    completed: true,
                                    adapter: 'icqq',
                                    message: `AI语音已发送到群 ${groupId}`,
                                    debug: data
                                }
                            }
                        }
                    } catch (err2) {
                        logger.info(`[send_ai_voice] 协议包发送失败: ${err2.message}`)
                        return {
                            success: false,
                            adapter,
                            error: `icqq发送失败: ${err2.message}`
                        }
                    }

                    // 无可用方法
                    return {
                        success: false,
                        adapter,
                        error: 'icqq 缺少发送方法，请确认使用 QQNT 协议'
                    }
                }

                // NapCat 适配器
                if (adapter === 'napcat') {
                    try {
                        const result = await bot.sendApi('send_group_ai_record', {
                            character: args.character,
                            group_id: groupId,
                            text: args.text
                        })
                        logger.debug(`[send_ai_voice] NapCat API 返回:`, result)

                        // 检查返回值判断是否成功
                        const msgId = result?.message_id || result?.data?.message_id
                        const isSuccess = msgId || result?.retcode === 0 || result?.status === 'ok'
                        const hasError = result?.retcode !== 0 && result?.retcode !== undefined

                        if (hasError) {
                            const errorMsg = result?.message || result?.msg || result?.wording || 'API 返回错误'
                            return {
                                success: false,
                                adapter,
                                error: `NapCat发送失败: ${errorMsg}`,
                                retcode: result?.retcode
                            }
                        }

                        if (isSuccess) {
                            return {
                                success: true,
                                completed: true,
                                adapter: 'napcat',
                                message: `AI语音已发送到群 ${groupId}`,
                                message_id: msgId
                            }
                        }

                        return { success: false, adapter, error: 'NapCat API 返回异常', debug: result }
                    } catch (err) {
                        return { success: false, adapter, error: `NapCat发送失败: ${err.message}` }
                    }
                }

                // 其他 OneBot 实现尝试
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('send_group_ai_record', {
                            character: args.character,
                            group_id: groupId,
                            text: args.text
                        })
                        logger.debug(`[send_ai_voice] OneBot API 返回:`, result)

                        const msgId = result?.message_id || result?.data?.message_id
                        const isSuccess = msgId || result?.retcode === 0 || result?.status === 'ok'

                        if (isSuccess) {
                            return {
                                success: true,
                                completed: true,
                                adapter,
                                message: `AI语音已发送到群 ${groupId}`,
                                message_id: msgId
                            }
                        }

                        // API 存在但返回失败
                        if (result?.retcode !== undefined) {
                            return {
                                success: false,
                                adapter,
                                error: result?.message || result?.msg || 'OneBot API 返回失败',
                                retcode: result?.retcode
                            }
                        }
                    } catch (e) {
                        logger.debug(`[send_ai_voice] OneBot API 失败: ${e.message}`)
                    }
                }

                // 备用方法
                if (bot.sendGroupAiRecord) {
                    try {
                        const result = await bot.sendGroupAiRecord(groupId, args.text, args.character)
                        if (result && (result.message_id || result === true || !result.error)) {
                            return {
                                success: true,
                                completed: true,
                                message: `AI语音已发送到群 ${groupId}`,
                                message_id: result?.message_id
                            }
                        }
                    } catch (e) {
                        logger.debug(`[send_ai_voice] sendGroupAiRecord 失败: ${e.message}`)
                    }
                }

                return {
                    success: false,
                    adapter,
                    error: '当前适配器不支持AI声聊',
                    hint: adapter === 'onebot'
                        ? 'OneBot 实现需要支持 send_group_ai_record API'
                        : '需要 icqq(NT) 或 NapCat 适配器'
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
                const recordSeg = {
                    type: 'record',
                    file: recordData,
                    magic: args.magic ? 1 : 0
                }
                const result = await e.reply(recordSeg)

                // 检查发送结果
                if (result?.message_id || result?.seq || result?.rand) {
                    return {
                        success: true,
                        completed: true,
                        message: '语音消息已发送',
                        message_id: result?.message_id
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
                const e = ctx.getEvent()
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }
                if (!args.file || args.file.trim() === '') {
                    return { success: false, error: '缺少必需参数: file (语音文件标识)' }
                }

                // OneBot API: get_record
                if (bot.sendApi) {
                    const result = await bot.sendApi('get_record', {
                        file: args.file,
                        out_format: args.out_format || 'mp3'
                    })

                    // 检查返回值
                    const hasError = result?.retcode !== 0 && result?.retcode !== undefined
                    if (hasError) {
                        return {
                            success: false,
                            error: result?.message || result?.msg || '获取语音文件失败',
                            retcode: result?.retcode
                        }
                    }

                    const fileData = result?.data?.file || result?.file
                    const urlData = result?.data?.url || result?.url

                    if (fileData || urlData) {
                        return {
                            success: true,
                            file: fileData,
                            url: urlData,
                            format: args.out_format || 'mp3'
                        }
                    }

                    return { success: false, error: '获取语音文件失败: 返回数据为空' }
                }
                if (bot.getRecord) {
                    const result = await bot.getRecord(args.file, args.out_format)
                    if (result && (result.file || result.url)) {
                        return { success: true, ...result }
                    }
                    return { success: false, error: '获取语音文件失败' }
                }
                return { success: false, error: '当前协议不支持获取语音文件' }
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
                '原神': [
                    '派蒙', '凯亚', '安柏', '丽莎', '琴', '香菱', '枫原万叶', '迪卢克',
                    '温迪', '可莉', '早柚', '托马', '芭芭拉', '优菈', '云堇', '钟离',
                    '魈', '凝光', '雷电将军', '北斗', '甘雨', '七七', '刻晴', '神里绫华',
                    '戴因斯雷布', '雷泽', '神里绫人', '罗莎莉亚', '阿贝多', '八重神子',
                    '宵宫', '若陀龙王', '九条裟罗', '夜兰', '珊瑚宫心海', '五郎',
                    '散兵', '女士', '达达利亚', '莫娜', '班尼特', '申鹤', '行秋',
                    '烟绯', '久岐忍', '辛焱', '砂糖', '胡桃', '重云', '菲谢尔',
                    '诺艾尔', '迪奥娜', '鹿野院平藏'
                ],
                '崩坏3': [
                    '琪亚娜', '爱莉希雅', '卡莲', '八重樱', '雷电芽衣', '布洛妮娅',
                    '希儿', '明日香', '符华', '德丽莎', '渡鸦', '芽衣'
                ],
                '崩坏星穹铁道': [
                    '开拓者女', '开拓者男', '三月七', '丹恒', '希露瓦', '姬子',
                    '瓦尔特', '艾丝妲', '布洛妮娅', '希儿', '杰帕德', '景元'
                ],
                '赛马娘': [
                    '特别周', '无声铃鹿', '东海帝王', '丸善斯基', '富士奇迹', '小栗帽',
                    '黄金船', '伏特加', '大和赤骥', '目白麦昆', '神鹰', '好歌剧',
                    '成田白仁', '草上飞'
                ],
                '其他': [
                    '塔菲', '阿梓', '奶绿', '星瞳', '向晚', '嘉然', '乃琳', '贝拉', '珈乐'
                ]
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
                const bot = ctx.getBot()
                if (!e && !bot) {
                    return { success: false, error: '没有可用的会话上下文' }
                }

                // 确定发送目标
                const targetGroupId = args.group_id ? parseInt(args.group_id) : null
                const targetUserId = args.user_id ? parseInt(args.user_id) : null

                // 发送emoji表情反馈（表示正在处理）
                if (e?.isGroup && typeof e.group?.setMsgEmojiLike === 'function') {
                    try {
                        await e.group.setMsgEmojiLike(e.message_id, '124')
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

                logger.info(`[send_tts] 开始生成: speaker=${speaker}, lang=${lang}, text="${text.substring(0, 30)}${text.length > 30 ? '...' : ''}"`)

                // 构建 API 请求
                const payload = {
                    fn_index: 0,
                    data: [text, lang, speaker, noise_scale, noise_scale_w, length_scale],
                    session_hash: randomUUID()
                }

                const response = await axios.post(VITS_API_URL, payload, {
                    timeout: 30000  // 30秒超时
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
                const recordSeg = { type: 'record', file: recordData }
                let result
                let targetInfo = ''

                if (targetUserId && bot?.pickFriend) {
                    // 发送到指定用户（私聊）
                    const friend = bot.pickFriend(targetUserId)
                    result = await friend.sendMsg(recordSeg)
                    targetInfo = `私聊 ${targetUserId}`
                } else if (targetGroupId && bot?.pickGroup) {
                    // 发送到指定群
                    const group = bot.pickGroup(targetGroupId)
                    result = await group.sendMsg(recordSeg)
                    targetInfo = `群 ${targetGroupId}`
                } else if (e) {
                    // 回复当前会话
                    result = await e.reply(recordSeg)
                    targetInfo = e.isGroup ? `当前群 ${e.group_id}` : `当前私聊 ${e.user_id}`
                } else {
                    return { success: false, error: '无法确定发送目标，请指定 group_id 或 user_id' }
                }

                logger.debug(`[send_tts] 发送目标: ${targetInfo}`)

                // 检查发送结果
                if (result?.message_id || result?.seq || result?.rand) {
                    logger.info(`[send_tts] 语音发送成功: message_id=${result.message_id}`)
                    return {
                        success: true,
                        completed: true,
                        message: `VITS语音已发送 (角色: ${speaker})`,
                        message_id: result?.message_id,
                        speaker,
                        text: text.substring(0, 100)
                    }
                } else if (result === true) {
                    logger.info(`[send_tts] 语音发送成功`)
                    return {
                        success: true,
                        completed: true,
                        message: `VITS语音已发送 (角色: ${speaker})`,
                        speaker,
                        text: text.substring(0, 100)
                    }
                } else if (result?.error || result?.code < 0 || (result?.retcode !== undefined && result?.retcode !== 0)) {
                    const errorMsg = result?.error || result?.message || '发送VITS语音失败'
                    logger.warn(`[send_tts] 发送失败: ${errorMsg} (code: ${result?.code})`)
                    return {
                        success: false,
                        error: errorMsg,
                        debug: result
                    }
                } else if (result && !result.error && result.code === undefined) {
                    // 只有在没有error且没有负code时才认为成功
                    logger.info(`[send_tts] 语音发送成功 (无message_id)`)
                    return {
                        success: true,
                        completed: true,
                        message: `VITS语音已发送 (角色: ${speaker})`,
                        speaker,
                        text: text.substring(0, 100)
                    }
                } else if (result?.error || (result?.retcode !== undefined && result?.retcode !== 0)) {
                    logger.warn(`[send_tts] 发送失败: ${result?.error || result?.message}`)
                    return {
                        success: false,
                        error: result?.error || result?.message || '发送VITS语音失败',
                        debug: result
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
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const { adapter } = getAdapterInfo(ctx)
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                if (adapter === 'icqq') {
                    return {
                        success: false,
                        adapter,
                        error: 'icqq适配器不支持获取AI语音数据',
                        hint: '请直接使用 send_ai_voice 工具发送AI语音到群'
                    }
                }
                if (adapter === 'napcat' || adapter === 'onebot') {
                    const result = await bot.sendApi('get_ai_record', {
                        group_id: groupId,
                        character: args.character,
                        text: args.text
                    })

                    // 检查返回值
                    const hasError = result?.retcode !== 0 && result?.retcode !== undefined
                    if (hasError) {
                        return {
                            success: false,
                            adapter,
                            error: result?.message || result?.msg || '获取AI语音失败',
                            retcode: result?.retcode
                        }
                    }

                    const fileData = result?.data?.file || result?.file
                    const urlData = result?.data?.url || result?.url

                    if (fileData || urlData) {
                        return {
                            success: true,
                            adapter,
                            text: args.text,
                            character: args.character,
                            file: fileData,
                            url: urlData
                        }
                    }

                    return { success: false, adapter, error: '获取AI语音失败: 返回数据为空' }
                }

                return { success: false, adapter, error: '当前适配器不支持获取AI语音数据' }
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
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const { adapter } = getAdapterInfo(ctx)
                const userId = parseInt(args.user_id)

                // 方式1: NapCat API: send_private_ai_record
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('send_private_ai_record', {
                            user_id: userId,
                            character: args.character,
                            text: args.text
                        })

                        const msgId = result?.message_id || result?.data?.message_id
                        const isSuccess = msgId || result?.retcode === 0 || result?.status === 'ok'

                        if (isSuccess) {
                            return {
                                success: true,
                                completed: true,
                                adapter,
                                user_id: userId,
                                message_id: msgId
                            }
                        }
                    } catch (apiErr) {
                        logger.debug(`[send_private_ai_record] NapCat API 失败: ${apiErr.message}`)
                    }
                }

                // 方式2: icqq - 先通过群聊生成AI语音，然后转发私聊
                if (adapter === 'icqq' && typeof bot.sendOidbSvcTrpcTcp === 'function') {
                    // 需要一个群来生成AI语音
                    const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id
                    if (!groupId) {
                        // 尝试获取bot所在的任意群
                        const groups = bot.gl || new Map()
                        const firstGroup = groups.keys().next().value
                        if (!firstGroup) {
                            return {
                                success: false,
                                adapter,
                                error: '私聊AI语音需要指定 group_id 来生成语音，或在群聊中使用'
                            }
                        }
                    }

                    try {
                        const rand = Math.floor(Math.random() * 4294967295)
                        const body = {
                            1: groupId,
                            2: args.character,
                            3: args.text,
                            4: 1,
                            5: { 1: rand }
                        }

                        const result = await bot.sendOidbSvcTrpcTcp('OidbSvcTrpcTcp.0x929b_0', body)
                        const data = result?.toJSON?.() || result

                        // 检查是否有语音数据
                        const voiceData = data?.[4]?.[1]?.[1]
                        if (voiceData) {
                            // 语音已经生成并发送到群，转发到私聊
                            // 注：icqq 目前不支持直接私聊AI语音，只能通过这种方式
                            logger.info(`[send_private_ai_record] AI语音已通过群${groupId}生成`)
                            return {
                                success: true,
                                completed: true,
                                adapter: 'icqq',
                                user_id: userId,
                                note: `AI语音已发送到群${groupId}，icqq不支持直接私聊AI语音`
                            }
                        }
                    } catch (err) {
                        logger.debug(`[send_private_ai_record] icqq 方式失败: ${err.message}`)
                    }
                }

                // 方式3: 降级方案 - 获取AI语音文件后发送
                if (bot.sendApi) {
                    try {
                        const aiRecord = await bot.sendApi('get_ai_record', {
                            character: args.character,
                            text: args.text,
                            group_id: args.group_id || e?.group_id
                        })

                        const file = aiRecord?.data?.file || aiRecord?.file
                        const url = aiRecord?.data?.url || aiRecord?.url

                        if (file || url) {
                            const friend = bot.pickFriend?.(userId)
                            if (friend?.sendMsg) {
                                const recordSeg = { type: 'record', file: file || url }
                                const result = await friend.sendMsg(recordSeg)
                                const msgId = result?.message_id || result?.seq
                                if (msgId || result === true || (result && !result.error)) {
                                    return {
                                        success: true,
                                        completed: true,
                                        adapter,
                                        user_id: userId,
                                        message_id: msgId
                                    }
                                }
                            }

                            // 备用: sendApi 发送
                            const result = await bot.sendApi('send_private_msg', {
                                user_id: userId,
                                message: [{ type: 'record', data: { file: file || url } }]
                            })
                            const msgId = result?.message_id || result?.data?.message_id
                            if (msgId || result?.retcode === 0) {
                                return {
                                    success: true,
                                    completed: true,
                                    adapter,
                                    user_id: userId,
                                    message_id: msgId
                                }
                            }
                        }
                    } catch (fallbackErr) {
                        logger.debug(`[send_private_ai_record] 降级方案失败: ${fallbackErr.message}`)
                    }
                }

                return {
                    success: false,
                    adapter,
                    error: '当前协议不支持私聊AI语音',
                    hint: adapter === 'icqq'
                        ? 'icqq不支持直接私聊AI语音，请在群聊中使用 send_ai_voice'
                        : '请确认协议端支持 send_private_ai_record 或 get_ai_record API'
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
                const bot = e?.bot || global.Bot
                if (!bot) {
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

                // 通过消息ID获取消息内容
                if (bot.sendApi) {
                    const msg = await bot.sendApi('get_msg', { message_id: args.message_id })
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
                const bot = ctx.getBot()

                let url = args.url

                // 如果提供了 file_id，先获取 URL
                if (!url && args.file_id) {
                    if (bot.sendApi) {
                        const result = await bot.sendApi('get_record', {
                            file: args.file_id,
                            out_format: 'mp3'
                        })
                        url = result?.data?.url || result?.url
                    }
                }

                if (!url) {
                    return { success: false, error: '需要提供 url 或 file_id' }
                }

                // 下载语音
                const response = await fetch(url)
                if (!response.ok) {
                    return { success: false, error: `下载失败: HTTP ${response.status}` }
                }

                const buffer = await response.arrayBuffer()
                const base64 = Buffer.from(buffer).toString('base64')

                return {
                    success: true,
                    url,
                    size: buffer.byteLength,
                    base64: `base64://${base64}`
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
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                let fileId = null

                // 获取语音文件ID
                if (args.message_id) {
                    if (bot.sendApi) {
                        const msg = await bot.sendApi('get_msg', { message_id: args.message_id })
                        const message = msg?.data?.message || msg?.message || []
                        for (const seg of message) {
                            if (seg.type === 'record') {
                                fileId = seg.data?.file || seg.file
                                break
                            }
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

                // NapCat API: 语音转文字
                if (bot.sendApi) {
                    try {
                        const result = await bot.sendApi('get_record_url', { file: fileId })
                        // 某些协议可能有语音识别API
                        const asrResult = await bot.sendApi('asr', { file: fileId }).catch(() => null)

                        if (asrResult?.data?.text || asrResult?.text) {
                            return {
                                success: true,
                                text: asrResult.data?.text || asrResult.text,
                                file: fileId
                            }
                        }
                    } catch (e) { }
                }

                return { success: false, error: '当前协议不支持语音转文字' }
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
                const bot = e?.bot || global.Bot
                if (!bot) {
                    return { success: false, error: '无法获取Bot实例' }
                }

                const { adapter, isNT, canAiVoice } = getAdapterInfo(ctx)
                const groupId = args.group_id ? parseInt(args.group_id) : e?.group_id

                if (!groupId) {
                    return { success: false, error: '需要指定群号或在群聊中使用' }
                }

                // icqq 适配器
                if (adapter === 'icqq') {
                    return {
                        success: true,
                        group_id: groupId,
                        adapter,
                        isNT,
                        canAiVoice,
                        note: isNT
                            ? 'icqq(NT)支持AI声聊，使用 send_ai_voice 发送'
                            : 'icqq需要NT协议才能使用AI声聊'
                    }
                }

                // NapCat 适配器
                if (adapter === 'napcat') {
                    try {
                        const result = await bot.sendApi('get_group_ai_record_status', { group_id: groupId })
                        return {
                            success: true,
                            group_id: groupId,
                            adapter,
                            canAiVoice: true,
                            enabled: result?.data?.enabled ?? result?.enabled,
                            character: result?.data?.character || result?.character
                        }
                    } catch (e) {
                        return {
                            success: true,
                            group_id: groupId,
                            adapter,
                            canAiVoice: true,
                            note: 'NapCat支持AI声聊'
                        }
                    }
                }

                // 其他 OneBot
                if (adapter === 'onebot') {
                    try {
                        const chars = await bot.sendApi('get_ai_characters', { group_id: groupId })
                        return {
                            success: true,
                            group_id: groupId,
                            adapter,
                            canAiVoice: true,
                            character_count: (chars?.data || chars || []).length
                        }
                    } catch (e) {
                        return {
                            success: false,
                            adapter,
                            canAiVoice: false,
                            error: '当前OneBot实现不支持AI声聊'
                        }
                    }
                }

                return { success: false, adapter, canAiVoice: false, error: '未知适配器' }
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

                const msg = [
                    { type: 'reply', id: replyId },
                    { type: 'record', file: recordData }
                ]

                const result = await e.reply(msg)
                return { success: true, message_id: result?.message_id }
            } catch (err) {
                return { success: false, error: `发送语音回复失败: ${err.message}` }
            }
        }
    }
]
