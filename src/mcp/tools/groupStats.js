/**
 * 群统计与管理工具
 * 幸运字符、龙王、群星级、打卡、发言榜等功能
 * 参考 yenai-plugin 实现
 */

import { qqWebApi, getGroupMemberList } from './helpers.js'
import { formatTimeToBeiJing } from '../../utils/common.js'

function requireGroupId(args, ctx) {
    const gid = args.group_id || ctx.getEvent?.()?.group_id || ctx.getEvent?.()?.group?.group_id
    if (!gid) throw new Error('缺少群号 group_id')
    return parseInt(gid)
}

export const groupStatsTools = [
    {
        name: 'get_group_level',
        description: '获取QQ群星级信息，包括群等级、活跃人数、群排名等。群星级是QQ官方对群活跃度的评估指标。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                
                // 群星级 API 必须使用 qqweb.qq.com 的 cookie
                if (!bot.cookies?.['qqweb.qq.com']) {
                    return { success: false, error: '需要 qqweb.qq.com 的 cookie 才能获取群星级，当前协议可能不支持' }
                }
                
                const result = await qqWebApi.getGroupLevel(bot, groupId)
                
                // 响应结构: { ec: 0, info: { uiGroupLevel, group_name, group_uin, ... } }
                if (result?.ec === 0 || result?.errcode === 0) {
                    const info = result.info || {}
                    const level = info.uiGroupLevel
                    
                    // 如果没有 uiGroupLevel 字段，说明该群没有星级数据
                    if (level === undefined || level === null) {
                        return {
                            success: true,
                            group_id: groupId,
                            level: null,
                            level_name: '无星级',
                            group_name: info.group_name || '',
                            group_uin: info.group_uin || groupId,
                            group_owner: info.group_owner,
                            group_role: info.group_role,
                            _tip: '该群暂无星级数据，可能是新群、不活跃的群或未开启星级功能'
                        }
                    }
                    
                    return {
                        success: true,
                        group_id: groupId,
                        level: level,
                        level_name: `LV${level}`,
                        level_stars: '⭐'.repeat(level),
                        group_name: info.group_name || '',
                        group_uin: info.group_uin || groupId,
                        group_owner: info.group_owner,
                        group_role: info.group_role,
                        _tip: '群星级从LV1到LV5，等级越高表示群越活跃。level_stars是星级的星星表示'
                    }
                }
                
                return { success: false, error: result?.em || result?.msg || '获取群星级失败' }
            } catch (err) {
                return { success: false, error: `获取群星级失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_dragon_king',
        description: '获取群龙王信息。龙王是QQ群中当日发言最多的成员，每天0点更新。返回当前龙王的QQ号、昵称和连续天数。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                
                if (!bot.cookies?.['qun.qq.com']) {
                    return { success: false, error: '需要 cookies 支持，当前协议可能不支持此功能' }
                }
                
                const result = await qqWebApi.getDragonKing(bot, groupId)
                
                // 响应结构: { uin, nick, avatar, avatar_size(连续天数) }
                if (result) {
                    return {
                        success: true,
                        group_id: groupId,
                        has_dragon_king: true,
                        dragon_king: {
                            user_id: result.uin || result.user_id,
                            nickname: result.nick || result.nickname,
                            avatar: result.avatar,
                            consecutive_days: result.day_count || "获取失败"
                        },
                        _tip: '龙王是当日群内发言最多的成员，consecutive_days表示连续蝉联天数'
                    }
                }
                
                return { 
                    success: true, 
                    group_id: groupId, 
                    has_dragon_king: false,
                    dragon_king: null, 
                    _tip: '该群当前没有龙王，可能是今日还没有人发言或群未开启此功能' 
                }
            } catch (err) {
                return { success: false, error: `获取龙王失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_sign_in_today',
        description: '获取今日群打卡列表。群打卡是QQ群的签到功能，成员可以每天打卡一次。返回今日已打卡的成员列表。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                
                if (!bot.cookies?.['qun.qq.com']) {
                    return { success: false, error: '需要 cookies 支持，当前协议可能不支持此功能' }
                }
                
                const result = await qqWebApi.getSignInToday(bot, groupId)
                
                // 响应结构: { retCode: 0, response: { page: [{ total, infos: [...] }] } }
                // infos 中每个元素: { uid, uidGroupNick, signedTimeStamp }
                if (result?.retCode === 0 || result?.response?.page) {
                    const page = result.response?.page?.[0] || {}
                    const list = page.infos || []
                    const total = page.total || list.length
                    
                    return {
                        success: true,
                        group_id: groupId,
                        signed_count: total,
                        signed_members: list.map(m => {
                            const ts = m.signedTimeStamp || m.signTime || m.sign_time || 0
                            return {
                                user_id: m.uid || m.uin || m.user_id,
                                nickname: m.uidGroupNick || m.nick || m.nickname || '',
                                sign_time: ts ? formatTimeToBeiJing(ts) : ''
                            }
                        }),
                        _tip: 'sign_time是打卡时间(北京时间)，signed_count是今日打卡人数'
                    }
                }
                
                // 兼容其他可能的响应格式
                if (result?.retcode === 0 || result?.data) {
                    const data = result.data || result
                    const list = data.signedList || data.list || []
                    return {
                        success: true,
                        group_id: groupId,
                        signed_count: list.length,
                        signed_members: list.map(m => {
                            const ts = m.signTime || m.sign_time || 0
                            return {
                                user_id: m.uin || m.user_id || m.uid,
                                nickname: m.nick || m.nickname || '',
                                sign_time: ts ? formatTimeToBeiJing(ts) : ''
                            }
                        }),
                        _tip: 'sign_time是打卡时间(北京时间)，signed_count是今日打卡人数'
                    }
                }
                
                return { success: false, error: result?.msg || result?.message || '获取打卡列表失败' }
            } catch (err) {
                return { success: false, error: `获取打卡列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_speak_rank',
        description: '获取群发言排行榜。统计群成员的发言消息数量并排名。可选择查看昨日榜单或近7天榜单。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                weekly: { type: 'boolean', description: 'true查看近7天榜单，false查看昨日榜单，默认false' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                const weekly = args.weekly || false
                
                if (!bot.cookies?.['qun.qq.com']) {
                    return { success: false, error: '需要 cookies 支持，当前协议可能不支持此功能' }
                }
                
                const result = await qqWebApi.getSpeakRank(bot, groupId, weekly)
                
                if (result?.ec === 0 || result?.retcode === 0) {
                    const list = result.list || result.data?.list || []
                    return {
                        success: true,
                        group_id: groupId,
                        time_range: weekly ? '近7天' : '昨日',
                        total_ranked: list.length,
                        rank_list: list.map((m, i) => ({
                            rank: i + 1,
                            user_id: m.uin || m.user_id,
                            nickname: m.nick || m.nickname,
                            message_count: m.msg_count || m.msgCount || m.count
                        })),
                        _tip: 'rank从1开始，message_count是该时间段内的发言条数'
                    }
                }
                
                return { success: false, error: result?.em || result?.msg || '获取发言榜单失败' }
            } catch (err) {
                return { success: false, error: `获取发言榜单失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_data',
        description: '获取群活跃数据统计，包括消息总数、活跃成员数、新增成员数、退群人数等。可查看昨日或近7天的数据。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                weekly: { type: 'boolean', description: 'true查看近7天数据，false查看昨日数据，默认false' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                const weekly = args.weekly || false
                
                if (!bot.cookies?.['qun.qq.com']) {
                    return { success: false, error: '需要 cookies 支持，当前协议可能不支持此功能' }
                }
                
                const result = await qqWebApi.getGroupData(bot, groupId, weekly)
                
                if (result?.ec === 0 || result?.retcode === 0) {
                    const data = result.data || result
                    return {
                        success: true,
                        group_id: groupId,
                        time_range: weekly ? '近7天' : '昨日',
                        message_count: data.msgCount || data.msg_count,
                        active_member_count: data.activeNum || data.active_num,
                        new_member_count: data.joinNum || data.join_num,
                        exit_member_count: data.exitNum || data.exit_num,
                        _tip: 'message_count是消息总数，active_member_count是发过言的成员数，new/exit是入群/退群人数'
                    }
                }
                
                return { success: false, error: result?.em || result?.msg || '获取群数据失败' }
            } catch (err) {
                return { success: false, error: `获取群数据失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_lucky_list',
        description: '获取群幸运字符列表。幸运字符是QQ群的趣味功能，成员可以抽取并装备字符显示在群名片旁。返回已拥有的字符和当前装备的字符。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                limit: { type: 'number', description: '获取数量，默认20' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                const limit = args.limit || 20
                
                if (!bot.cookies?.['qun.qq.com']) {
                    return { success: false, error: '需要 cookies 支持，当前协议可能不支持此功能' }
                }
                
                const result = await qqWebApi.getLuckyList(bot, groupId, 0, limit)
                
                if (result?.retcode === 0 || result?.data?.word_list || result?.word_list) {
                    const data = result.data || result
                    const list = data.word_list || []
                    const equipped = data.equip_info
                    
                    // 解析字符列表 - 字段在 word_info 里: { wording, word_id, word_desc }
                    const parsedWords = list.map(w => {
                        const info = w.word_info || w
                        return {
                            word_id: info.word_id || w.word_id,
                            word: info.wording || info.word || w.wording || w.word,
                            word_desc: info.word_desc || w.word_desc || '',
                            word_type: info.word_type || w.word_type,
                            is_currently_equipped: w.is_equip || info.is_equip || false
                        }
                    })
                    
                    // 解析当前装备的字符
                    let currentEquipped = null
                    if (equipped) {
                        const eqInfo = equipped.word_info || equipped
                        currentEquipped = {
                            word_id: eqInfo.word_id || equipped.word_id,
                            word: eqInfo.wording || eqInfo.word || equipped.wording || equipped.word,
                            word_desc: eqInfo.word_desc || equipped.word_desc || '',
                            word_type: eqInfo.word_type || equipped.word_type
                        }
                    }
                    
                    return {
                        success: true,
                        group_id: groupId,
                        total_owned: parsedWords.length,
                        currently_equipped: currentEquipped,
                        owned_words: parsedWords,
                        _tip: 'word_id用于装备字符，word是字符文字，word_desc是寓意说明，currently_equipped是当前佩戴的字符'
                    }
                }
                
                return { success: false, error: result?.msg || '获取幸运字符列表失败' }
            } catch (err) {
                return { success: false, error: `获取幸运字符列表失败: ${err.message}` }
            }
        }
    },

    {
        name: 'draw_lucky',
        description: '抽取幸运字符。每天可以抽取一次，抽到的字符会加入你的字符库。如果今日已抽取则会失败。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                
                if (!bot.cookies?.['qun.qq.com']) {
                    return { success: false, error: '需要 cookies 支持，当前协议可能不支持此功能' }
                }
                
                const result = await qqWebApi.drawLucky(bot, groupId)
                
                // 响应结构: { retcode: 0, data: { word_info: { wording, word_id, word_desc } } }
                // retcode 11004 表示今天已经抽过了
                if (result?.retcode === 11004) {
                    return { success: false, error: '今天已经抽过了，明天再来抽取吧' }
                }
                
                if (result?.retcode === 0) {
                    const data = result.data || result
                    const wordInfo = data.word_info?.word_info || data.word_info || data
                    
                    if (wordInfo?.wording || wordInfo?.word) {
                        return {
                            success: true,
                            group_id: groupId,
                            drawn_word: wordInfo.wording || wordInfo.word,
                            word_id: wordInfo.word_id,
                            word_desc: wordInfo.word_desc || '',
                            is_new_word: data.is_new || false,
                            _tip: 'drawn_word是抽到的字符，word_desc是寓意说明，is_new_word为true表示抽到了新字符'
                        }
                    } else {
                        return {
                            success: true,
                            group_id: groupId,
                            drawn_word: null,
                            _tip: '抽取成功但没有获得字符'
                        }
                    }
                }
                
                return { success: false, error: result?.msg || '抽取失败，可能今日已抽取过', _debug: result }
            } catch (err) {
                return { success: false, error: `抽取幸运字符失败: ${err.message}` }
            }
        }
    },

    {
        name: 'equip_lucky',
        description: '装备或更换幸运字符。将指定的字符设为当前显示的字符，会显示在群名片旁边。需要先通过get_lucky_list获取word_id。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                word_id: { type: 'string', description: '要装备的字符ID，从get_lucky_list返回的word_id获取' }
            },
            required: ['word_id']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                
                if (!bot.cookies?.['qun.qq.com']) {
                    return { success: false, error: '需要 cookies 支持，当前协议可能不支持此功能' }
                }
                
                const result = await qqWebApi.equipLucky(bot, groupId, args.word_id)
                
                if (result?.retcode === 0) {
                    return {
                        success: true,
                        group_id: groupId,
                        equipped_word_id: args.word_id,
                        _tip: '装备成功，该字符现在会显示在你的群名片旁边'
                    }
                }
                
                return { success: false, error: result?.msg || '装备失败，请确认word_id正确且你拥有该字符' }
            } catch (err) {
                return { success: false, error: `装备幸运字符失败: ${err.message}` }
            }
        }
    },

    {
        name: 'switch_lucky',
        description: '开启或关闭群幸运字符功能。需要群管理员权限。关闭后群成员将无法抽取和显示幸运字符。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                enable: { type: 'boolean', description: 'true开启幸运字符功能，false关闭' }
            },
            required: ['enable']
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                
                if (!bot.cookies?.['qun.qq.com']) {
                    return { success: false, error: '需要 cookies 支持，当前协议可能不支持此功能' }
                }
                
                const result = await qqWebApi.switchLucky(bot, groupId, args.enable)
                
                // retcode 11111 表示重复开启或关闭
                if (result?.retcode === 11111) {
                    return { success: false, error: '重复开启或关闭，当前状态已经是' + (args.enable ? '开启' : '关闭') }
                }
                
                if (result?.retcode === 0) {
                    return {
                        success: true,
                        group_id: groupId,
                        lucky_enabled: args.enable,
                        _tip: args.enable ? '幸运字符功能已开启，群成员可以抽取和装备字符' : '幸运字符功能已关闭'
                    }
                }
                
                return { success: false, error: result?.msg || '设置失败，可能没有管理员权限', _debug: result }
            } catch (err) {
                return { success: false, error: `设置幸运字符开关失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_inactive_members',
        description: '获取群内不活跃成员列表。可以查找从未发言的成员，或指定天数内未发言的成员。常用于清理僵尸粉或了解群活跃情况。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                days: { type: 'number', description: '多少天未发言视为不活跃，默认30。设为0表示查找从未发言过的成员' },
                limit: { type: 'number', description: '最多返回多少人，默认50' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                const days = args.days ?? 30
                const limit = args.limit || 50
                
                const memberList = await getGroupMemberList({ bot, groupId })
                
                if (!memberList || memberList.length === 0) {
                    return { success: false, error: '无法获取群成员列表' }
                }
                
                const now = Math.floor(Date.now() / 1000)
                const threshold = days > 0 ? now - days * 24 * 3600 : 0
                
                const inactiveMembers = memberList
                    .filter(m => {
                        const lastSpeakTime = m.last_sent_time || m.last_speak_time || m.lastSpeakTime || 0
                        if (days === 0) {
                            return lastSpeakTime === 0
                        }
                        return lastSpeakTime < threshold
                    })
                    .sort((a, b) => {
                        const aTime = a.last_sent_time || a.last_speak_time || a.lastSpeakTime || 0
                        const bTime = b.last_sent_time || b.last_speak_time || b.lastSpeakTime || 0
                        return aTime - bTime
                    })
                    .slice(0, limit)
                    .map(m => {
                        const joinTs = m.join_time || m.joinTime || 0
                        const speakTs = m.last_sent_time || m.last_speak_time || m.lastSpeakTime || 0
                        return {
                            user_id: m.user_id || m.uin,
                            nickname: m.nickname || m.nick || '',
                            card: m.card || '',
                            join_time: joinTs ? formatTimeToBeiJing(joinTs) : '',
                            last_speak_time: speakTs ? formatTimeToBeiJing(speakTs) : '从未发言',
                            role: m.role || 'member'
                        }
                    })
                
                return {
                    success: true,
                    group_id: groupId,
                    filter_criteria: days === 0 ? '从未发言' : `${days}天内未发言`,
                    group_total_members: memberList.length,
                    inactive_count: inactiveMembers.length,
                    inactive_members: inactiveMembers,
                    _tip: 'last_speak_time显示最后发言时间或"从未发言"，join_time是入群时间，role可能是owner/admin/member'
                }
            } catch (err) {
                return { success: false, error: `获取不活跃成员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_recent_join_members',
        description: '获取最近入群的成员列表。可以查看指定天数内新加入群的成员，了解群的新人情况。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                days: { type: 'number', description: '查看最近多少天内入群的成员，默认7天' },
                limit: { type: 'number', description: '最多返回多少人，默认50' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                const days = args.days || 7
                const limit = args.limit || 50
                
                const memberList = await getGroupMemberList({ bot, groupId })
                
                if (!memberList || memberList.length === 0) {
                    return { success: false, error: '无法获取群成员列表' }
                }
                
                const now = Math.floor(Date.now() / 1000)
                const threshold = now - days * 24 * 3600
                
                const recentMembers = memberList
                    .filter(m => {
                        const joinTime = m.join_time || m.joinTime || 0
                        return joinTime >= threshold
                    })
                    .sort((a, b) => {
                        const aTime = a.join_time || a.joinTime || 0
                        const bTime = b.join_time || b.joinTime || 0
                        return bTime - aTime
                    })
                    .slice(0, limit)
                    .map(m => {
                        const joinTs = m.join_time || m.joinTime || 0
                        const speakTs = m.last_sent_time || m.last_speak_time || m.lastSpeakTime || 0
                        return {
                            user_id: m.user_id || m.uin,
                            nickname: m.nickname || m.nick || '',
                            card: m.card || '',
                            join_time: joinTs ? formatTimeToBeiJing(joinTs) : '',
                            last_speak_time: speakTs ? formatTimeToBeiJing(speakTs) : '从未发言'
                        }
                    })
                
                return {
                    success: true,
                    group_id: groupId,
                    filter_criteria: `最近${days}天入群`,
                    group_total_members: memberList.length,
                    new_member_count: recentMembers.length,
                    new_members: recentMembers,
                    _tip: 'join_time是入群时间，last_speak_time显示最后发言时间或"从未发言"，列表按入群时间倒序排列(最新的在前)'
                }
            } catch (err) {
                return { success: false, error: `获取最近入群成员失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_honor',
        description: '获取群荣誉信息，包括龙王、群聊之火、群聊炽焰、冒尖小春笋、快乐源泉等荣誉称号及获得者。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                type: { 
                    type: 'string', 
                    description: '荣誉类型：talkative(龙王)、performer(群聊之火)、legend(群聊炽焰)、strong_newbie(冒尖小春笋)、emotion(快乐源泉)、all(全部)',
                    enum: ['talkative', 'performer', 'legend', 'strong_newbie', 'emotion', 'all']
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                const honorType = args.type || 'all'
                
                if (!bot.getGroupHonorInfo) {
                    return { success: false, error: '当前协议不支持获取群荣誉' }
                }
                
                const honor = await bot.getGroupHonorInfo(groupId, honorType)
                
                return {
                    success: true,
                    group_id: groupId,
                    type: honorType,
                    honor: honor,
                    _tip: 'talkative是龙王(发言最多)，performer是群聊之火(活跃度高)，legend是群聊炽焰(长期活跃)，strong_newbie是冒尖小春笋(活跃新人)，emotion是快乐源泉(表情包达人)'
                }
            } catch (err) {
                return { success: false, error: `获取群荣誉失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_group_stat',
        description: '获取群成员统计信息，包括成员总数、群主数、管理员数、普通成员数，以及性别分布统计。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                
                const groupInfo = bot.gl?.get(groupId)
                if (!groupInfo) {
                    return { success: false, error: '机器人不在此群内' }
                }
                
                const memberList = await getGroupMemberList({ bot, groupId })
                
                if (!memberList || memberList.length === 0) {
                    return { success: false, error: '无法获取群成员列表' }
                }
                
                const stats = {
                    total: memberList.length,
                    owner: 0,
                    admin: 0,
                    member: 0,
                    male: 0,
                    female: 0,
                    unknown_sex: 0
                }
                
                for (const m of memberList) {
                    if (m.role === 'owner') stats.owner++
                    else if (m.role === 'admin') stats.admin++
                    else stats.member++
                    
                    if (m.sex === 'male') stats.male++
                    else if (m.sex === 'female') stats.female++
                    else stats.unknown_sex++
                }
                
                return {
                    success: true,
                    group_id: groupId,
                    group_name: groupInfo.group_name,
                    max_member_count: groupInfo.max_member_count,
                    stats,
                    _tip: 'owner是群主(只有1个)，admin是管理员，member是普通成员。male/female/unknown_sex是性别统计'
                }
            } catch (err) {
                return { success: false, error: `获取统计失败: ${err.message}` }
            }
        }
    },

    {
        name: 'get_random_group_member',
        description: '随机抽取群成员，可用于随机点名、抽奖、随机@等场景。支持过滤条件如排除机器人、排除管理员、按角色筛选等。',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群号，不填则使用当前群' },
                count: { type: 'number', description: '抽取数量，默认1，最多50' },
                exclude_bot: { type: 'boolean', description: '是否排除机器人自己，默认true' },
                exclude_admin: { type: 'boolean', description: '是否排除管理员和群主，默认false' },
                role_filter: { 
                    type: 'string', 
                    description: '角色过滤：all(所有人)、member(仅普通成员)、admin(仅管理员)、owner(仅群主)',
                    enum: ['all', 'member', 'admin', 'owner']
                }
            }
        },
        handler: async (args, ctx) => {
            try {
                const bot = ctx.getBot()
                const groupId = requireGroupId(args, ctx)
                const count = Math.min(Math.max(args.count || 1, 1), 50)
                const excludeBot = args.exclude_bot !== false
                const excludeAdmin = args.exclude_admin === true
                const roleFilter = args.role_filter || 'all'
                
                const groupInfo = bot.gl?.get(groupId)
                if (!groupInfo) {
                    return { success: false, error: '机器人不在此群内' }
                }
                
                const memberList = await getGroupMemberList({ bot, groupId })
                
                if (!memberList || memberList.length === 0) {
                    return { success: false, error: '群成员列表为空' }
                }
                
                // 过滤成员
                let filteredList = memberList.filter(m => {
                    const userId = m.user_id || m.uid
                    const role = m.role || 'member'
                    if (excludeBot && userId === bot.uin) return false
                    if (excludeAdmin && (role === 'admin' || role === 'owner')) return false
                    if (roleFilter === 'member' && role !== 'member') return false
                    if (roleFilter === 'admin' && role !== 'admin') return false
                    if (roleFilter === 'owner' && role !== 'owner') return false
                    return true
                })
                
                if (filteredList.length === 0) {
                    return { success: false, error: '没有符合条件的群成员' }
                }
                
                // 随机抽取
                const selected = []
                const usedIndices = new Set()
                const actualCount = Math.min(count, filteredList.length)
                
                while (selected.length < actualCount) {
                    const randomIndex = Math.floor(Math.random() * filteredList.length)
                    if (!usedIndices.has(randomIndex)) {
                        usedIndices.add(randomIndex)
                        const m = filteredList[randomIndex]
                        selected.push({
                            user_id: m.user_id || m.uid,
                            nickname: m.nickname || m.nick || '',
                            card: m.card || '',
                            role: m.role || 'member',
                            title: m.title || '',
                            display_name: m.card || m.nickname || m.nick || `用户${m.user_id || m.uid}`,
                            avatar_url: `https://q1.qlogo.cn/g?b=qq&nk=${m.user_id || m.uid}&s=100`
                        })
                    }
                }
                
                return {
                    success: true,
                    group_id: groupId,
                    group_name: groupInfo.group_name,
                    total_members: memberList.length,
                    filtered_count: filteredList.length,
                    selected_count: selected.length,
                    members: selected,
                    _tip: 'display_name是优先显示群名片(card)，没有则显示昵称。可用user_id来@被抽中的成员'
                }
            } catch (err) {
                return { success: false, error: `随机抽取失败: ${err.message}` }
            }
        }
    }
]
