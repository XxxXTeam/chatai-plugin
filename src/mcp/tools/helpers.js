/**
 * MCP 工具辅助函数
 */

import _logger from '../../core/utils/logger.js'
import * as cheerio from 'cheerio'

const logger = _logger.tag('mcp-helper')

/**
 * icqq 群操作封装
 */
export const icqqGroup = {
    pick: (bot, groupId) => bot.pickGroup?.(parseInt(groupId)),

    async sendMsg(bot, groupId, content, source) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.sendMsg) throw new Error('icqq: 无法获取群对象')
        return await group.sendMsg(content, source)
    },

    async getMemberMap(bot, groupId) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.getMemberMap) throw new Error('icqq: 无法获取群成员')
        return await group.getMemberMap()
    },

    getInfo: (bot, groupId) => bot.gl?.get(parseInt(groupId)) || bot.pickGroup?.(parseInt(groupId))?.info,

    async recallMsg(bot, groupId, messageId) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.recallMsg) throw new Error('icqq: 无法撤回消息')
        return await group.recallMsg(messageId)
    },

    async getChatHistory(bot, groupId, seq, count = 20) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.getChatHistory) throw new Error('icqq: 无法获取聊天记录')
        return await group.getChatHistory(seq, count)
    },

    async setName(bot, groupId, name) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.setName) throw new Error('icqq: 无法设置群名')
        return await group.setName(name)
    },

    async muteAll(bot, groupId, enable = true) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.muteAll) throw new Error('icqq: 无法全员禁言')
        return await group.muteAll(enable)
    },

    async muteMember(bot, groupId, userId, duration = 600) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.muteMember) throw new Error('icqq: 无法禁言成员')
        return await group.muteMember(parseInt(userId), duration)
    },

    async kickMember(bot, groupId, userId, rejectAdd = false) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (group?.kickMember) {
            return await group.kickMember(parseInt(userId), '', rejectAdd)
        }
        // 兼容 newer API setGroupKick / setGroupKickBan
        if (typeof group?.setGroupKick === 'function') {
            return await group.setGroupKick(parseInt(userId), rejectAdd)
        }
        if (typeof group?.setGroupKickBan === 'function') {
            return await group.setGroupKickBan(parseInt(userId), rejectAdd)
        }
        throw new Error('icqq: 无法踢出成员')
    },

    async setAdmin(bot, groupId, userId, enable = true) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (group?.setAdmin) {
            return await group.setAdmin(parseInt(userId), enable)
        }
        if (typeof group?.setGroupAdmin === 'function') {
            return await group.setGroupAdmin(parseInt(userId), enable)
        }
        throw new Error('icqq: 无法设置管理员')
    },

    async setCard(bot, groupId, userId, card) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.setCard) throw new Error('icqq: 无法设置群名片')
        return await group.setCard(parseInt(userId), card)
    },

    async setTitle(bot, groupId, userId, title, duration = -1) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (group?.setTitle) {
            return await group.setTitle(parseInt(userId), title, duration)
        }
        if (typeof group?.setGroupSpecialTitle === 'function') {
            return await group.setGroupSpecialTitle(parseInt(userId), title, duration)
        }
        throw new Error('icqq: 无法设置头衔')
    },

    async pokeMember(bot, groupId, userId) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.pokeMember) throw new Error('icqq: 无法戳一戳')
        return await group.pokeMember(parseInt(userId))
    },

    async announce(bot, groupId, content) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.announce) throw new Error('icqq: 无法发送公告')
        return await group.announce(content)
    },

    async sendFile(bot, groupId, file, name) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.sendFile) throw new Error('icqq: 无法发送文件')
        return await group.sendFile(file, '/', name)
    },

    getFs: (bot, groupId) => bot.pickGroup?.(parseInt(groupId))?.fs
}

/**
 * icqq 好友/用户操作封装
 */
export const icqqFriend = {
    pick: (bot, userId) => bot.pickFriend?.(parseInt(userId)),
    pickUser: (bot, userId) => bot.pickUser?.(parseInt(userId)),

    async sendMsg(bot, userId, content, source) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.sendMsg) throw new Error('icqq: 无法获取好友对象')
        return await friend.sendMsg(content, source)
    },

    getInfo: (bot, userId) => bot.fl?.get(parseInt(userId)),

    async recallMsg(bot, userId, messageId) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.recallMsg) throw new Error('icqq: 无法撤回消息')
        return await friend.recallMsg(messageId)
    },

    async getChatHistory(bot, userId, time, count = 20) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.getChatHistory) throw new Error('icqq: 无法获取聊天记录')
        return await friend.getChatHistory(time, count)
    },

    async poke(bot, userId) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.poke) throw new Error('icqq: 无法戳一戳')
        return await friend.poke()
    },

    async thumbUp(bot, userId, times = 10) {
        const user = bot.pickUser?.(parseInt(userId))
        if (!user?.thumbUp) throw new Error('icqq: 无法点赞')
        return await user.thumbUp(times)
    },

    async sendFile(bot, userId, file, name) {
        const friend = bot.pickFriend?.(parseInt(userId))
        if (!friend?.sendFile) throw new Error('icqq: 无法发送文件')
        return await friend.sendFile(file, name)
    },

    async getSimpleInfo(bot, userId) {
        const user = bot.pickUser?.(parseInt(userId))
        if (!user?.getSimpleInfo) throw new Error('icqq: 无法获取用户信息')
        return await user.getSimpleInfo()
    }
}

export async function callOneBotApi(bot, action, params = {}) {
    if (bot.sendApi) {
        return await bot.sendApi(action, params)
    }
    if (bot[action]) {
        return await bot[action](params)
    }
    throw new Error(`不支持的API: ${action}`)
}

/**
 * 群公告 API 封装
 * 参考 yenai-plugin 实现，主要使用 QQ Web API
 */
export const groupNoticeApi = {
    /**
     * 获取群公告列表
     * @param {Object} bot - Bot 实例
     * @param {number} groupId - 群号
     * @param {number} index - 获取指定序号的公告（0表示获取列表）
     * @returns {Promise<Array|Object>}
     */
    async getNoticeList(bot, groupId, index = 0) {
        // 方式1: 使用 QQ Web API (主要方式)
        if (bot.cookies?.['qun.qq.com'] && bot.bkn) {
            return await this._getNoticeListWeb(bot, groupId, index)
        }

        // 方式2: NapCat/go-cqhttp API
        if (bot.sendApi) {
            try {
                const result = await bot.sendApi('_get_group_notice', { group_id: groupId })
                const list = result?.data || result || []
                if (index > 0 && list?.[index - 1]) {
                    return {
                        text: list[index - 1].message?.text || list[index - 1].content || '',
                        fid: list[index - 1].notice_id || list[index - 1].fid
                    }
                }
                return list
            } catch (e) {
                // 尝试另一个 API 名称
                try {
                    const result = await bot.sendApi('get_group_notice', { group_id: groupId })
                    return result?.data || result || []
                } catch (e2) {}
            }
        }

        throw new Error('当前协议不支持获取群公告，需要 cookies 或 NapCat/go-cqhttp')
    },

    /**
     * 通过 Web API 获取群公告
     */
    async _getNoticeListWeb(bot, groupId, index = 0) {
        const n = index ? 1 : 20
        const s = index ? index - 1 : 0
        const url = `https://web.qun.qq.com/cgi-bin/announce/get_t_list?bkn=${bot.bkn}&qid=${groupId}&ft=23&s=${s}&n=${n}`

        const response = await fetch(url, {
            headers: {
                Cookie: bot.cookies['qun.qq.com']
            }
        })
        const res = await response.json()

        if (res.ec !== 0) {
            throw new Error(res.em || '获取群公告失败')
        }

        if (index && res.feeds?.[0]) {
            return {
                text: res.feeds[0].msg?.text || '',
                fid: res.feeds[0].fid
            }
        }

        return res.feeds || []
    },

    /**
     * 发送群公告
     * @param {Object} bot - Bot 实例
     * @param {number} groupId - 群号
     * @param {string} content - 公告内容
     * @param {Object} options - 选项
     * @param {string} options.image - 图片URL
     * @param {boolean} options.pinned - 是否置顶
     * @param {boolean} options.confirmRequired - 是否需要确认
     * @param {boolean} options.showEditCard - 是否显示编辑卡片
     * @returns {Promise<Object>}
     */
    async sendNotice(bot, groupId, content, options = {}) {
        const { image, pinned = false, confirmRequired = true, showEditCard = true } = options

        // 方式1: 使用 QQ Web API (主要方式)
        if (bot.cookies?.['qun.qq.com'] && bot.bkn) {
            return await this._sendNoticeWeb(bot, groupId, content, { image, pinned, confirmRequired, showEditCard })
        }

        // 方式2: NapCat/go-cqhttp API
        if (bot.sendApi) {
            try {
                return await bot.sendApi('_send_group_notice', {
                    group_id: groupId,
                    content,
                    image
                })
            } catch (e) {
                // 尝试另一个 API
                try {
                    return await bot.sendApi('send_group_notice', {
                        group_id: groupId,
                        content,
                        image
                    })
                } catch (e2) {}
            }
        }

        // 方式3: icqq group.sendNotice (备用)
        const group = bot.pickGroup?.(parseInt(groupId))
        if (group?.sendNotice) {
            return await group.sendNotice(content, image)
        }
        if (group?.announce) {
            return await group.announce(content)
        }

        throw new Error('当前协议不支持发送群公告，需要 cookies 或 NapCat/go-cqhttp')
    },

    /**
     * 通过 Web API 发送群公告
     */
    async _sendNoticeWeb(bot, groupId, content, options = {}) {
        const { image, pinned = false, confirmRequired = true, showEditCard = true } = options

        const data = new URLSearchParams({
            qid: groupId,
            bkn: bot.bkn,
            text: content,
            pinned: pinned ? 1 : 0,
            type: 1,
            settings: JSON.stringify({
                is_show_edit_card: showEditCard ? 1 : 0,
                tip_window_type: 1,
                confirm_required: confirmRequired ? 1 : 0
            })
        })

        // 如果有图片，先上传
        if (image) {
            try {
                const imgResult = await this._uploadNoticeImage(bot, image)
                if (imgResult?.ec === 0 && imgResult?.id) {
                    const p = JSON.parse(imgResult.id.replace(/&quot;/g, '"'))
                    data.append('pic', p.id)
                    data.append('imgWidth', p.w)
                    data.append('imgHeight', p.h)
                }
            } catch (e) {
                // 图片上传失败，继续发送文字公告
            }
        }

        const url = `https://web.qun.qq.com/cgi-bin/announce/add_qun_notice?bkn=${bot.bkn}`
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Cookie: bot.cookies['qun.qq.com'],
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: data.toString()
        })

        return await response.json()
    },

    /**
     * 上传公告图片
     */
    async _uploadNoticeImage(bot, imageUrl) {
        // 下载图片
        const imgResponse = await fetch(imageUrl)
        const buffer = await imgResponse.arrayBuffer()

        const formData = new FormData()
        formData.append('bkn', bot.bkn)
        formData.append('source', 'troopNotice')
        formData.append('m', '0')
        formData.append('pic_up', new Blob([buffer], { type: 'image/png' }), 'image.png')

        const response = await fetch('https://web.qun.qq.com/cgi-bin/announce/upload_img', {
            method: 'POST',
            headers: {
                Cookie: bot.cookies['qun.qq.com']
            },
            body: formData
        })

        return await response.json()
    },

    /**
     * 删除群公告
     * @param {Object} bot - Bot 实例
     * @param {number} groupId - 群号
     * @param {string|number} fidOrIndex - 公告ID 或 序号
     * @returns {Promise<Object>}
     */
    async deleteNotice(bot, groupId, fidOrIndex) {
        let fid = fidOrIndex
        let text = ''

        // 如果是数字序号，先获取对应的 fid
        if (typeof fidOrIndex === 'number' || /^\d+$/.test(fidOrIndex)) {
            const index = parseInt(fidOrIndex)
            if (index > 0 && index <= 100) {
                const notice = await this.getNoticeList(bot, groupId, index)
                if (notice?.fid) {
                    fid = notice.fid
                    text = notice.text
                } else {
                    throw new Error(`未找到序号 ${index} 的公告`)
                }
            }
        }

        // 方式1: 使用 QQ Web API (主要方式)
        if (bot.cookies?.['qun.qq.com'] && bot.bkn) {
            return await this._deleteNoticeWeb(bot, groupId, fid, text)
        }

        // 方式2: NapCat/go-cqhttp API
        if (bot.sendApi) {
            try {
                const result = await bot.sendApi('_del_group_notice', {
                    group_id: groupId,
                    notice_id: fid
                })
                return { ...result, text }
            } catch (e) {
                try {
                    const result = await bot.sendApi('del_group_notice', {
                        group_id: groupId,
                        notice_id: fid
                    })
                    return { ...result, text }
                } catch (e2) {}
            }
        }

        throw new Error('当前协议不支持删除群公告，需要 cookies 或 NapCat/go-cqhttp')
    },

    /**
     * 通过 Web API 删除群公告
     */
    async _deleteNoticeWeb(bot, groupId, fid, text = '') {
        const url = `https://web.qun.qq.com/cgi-bin/announce/del_feed?bkn=${bot.bkn}`

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Cookie: bot.cookies['qun.qq.com'],
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                bkn: bot.bkn,
                fid: fid,
                qid: groupId
            }).toString()
        })

        const result = await response.json()
        return { ...result, text }
    }
}

/**
 * 获取群成员列表
 * @param {Object} options
 * @param {Object} options.bot - Bot 实例
 * @param {Object} options.event - 事件对象
 * @param {number|string} options.groupId - 群号
 * @returns {Promise<Array>} 成员列表
 */
export async function getGroupMemberList({ bot, event, groupId }) {
    const gid = groupId || event?.group_id
    if (!gid) return []

    let memberList = []

    try {
        // 方式1: 使用 event.group.getMemberMap() (icqq 标准)
        if (event?.group?.getMemberMap) {
            const memberMap = await event.group.getMemberMap()
            memberList = mapToMemberList(memberMap)
        }

        // 方式2: 使用 bot.pickGroup
        if (memberList.length === 0 && bot?.pickGroup) {
            const group = bot.pickGroup(parseInt(gid))
            if (group?.getMemberMap) {
                const memberMap = await group.getMemberMap()
                memberList = mapToMemberList(memberMap)
            } else if (group?.getMemberList) {
                memberList = (await group.getMemberList()) || []
            }
        }

        // 方式3: bot.getGroupMemberList
        if (memberList.length === 0 && bot?.getGroupMemberList) {
            const result = await bot.getGroupMemberList(parseInt(gid))
            memberList = Array.isArray(result) ? result : []
        }
    } catch (err) {
        console.error('[helpers] 获取群成员列表失败:', err.message)
    }

    return memberList
}

/**
 * Map 转成员列表数组
 */
function mapToMemberList(memberMap) {
    const list = []
    if (memberMap instanceof Map) {
        for (const [uid, member] of memberMap) {
            list.push({ user_id: uid, ...member })
        }
    } else if (memberMap && typeof memberMap === 'object') {
        for (const [uid, member] of Object.entries(memberMap)) {
            list.push({ user_id: Number(uid) || uid, ...member })
        }
    }
    return list
}

/**
 * 按条件过滤群成员
 * @param {Array} memberList - 成员列表
 * @param {Object} options - 过滤选项
 * @returns {Array} 过滤后的成员列表
 */
export function filterMembers(memberList, options = {}) {
    const {
        role, // 筛选角色: 'admin', 'owner', 'member', 'admin_only' (仅管理员不含群主)
        excludeBot, // 排除机器人
        excludeOwner, // 排除群主
        excludeAdmin, // 排除管理员
        excludeUsers, // 排除指定用户
        botId // 机器人ID
    } = options

    return memberList.filter(m => {
        const uid = String(m.user_id || m.uid)
        const memberRole = m.role || 'member'

        // 排除机器人
        if (excludeBot && botId && uid === String(botId)) return false

        // 排除群主
        if (excludeOwner && memberRole === 'owner') return false

        // 排除管理员
        if (excludeAdmin && memberRole === 'admin') return false

        // 排除指定用户
        if (excludeUsers?.length && excludeUsers.includes(uid)) return false

        // 按角色筛选
        if (role) {
            switch (role) {
                case 'admin':
                    // 管理员（包含群主）
                    return memberRole === 'admin' || memberRole === 'owner'
                case 'admin_only':
                    // 仅管理员（不含群主）
                    return memberRole === 'admin'
                case 'owner':
                    return memberRole === 'owner'
                case 'member':
                    return memberRole === 'member'
                default:
                    return true
            }
        }

        return true
    })
}

/**
 * 随机选择成员
 * @param {Array} memberList - 成员列表
 * @param {number} count - 选择数量
 * @param {boolean} allowDuplicate - 是否允许重复选择
 * @returns {Array} 选中的成员
 */
export function randomSelectMembers(memberList, count = 1, allowDuplicate = false) {
    if (!memberList.length) return []

    const selected = []
    const candidates = [...memberList]
    const actualCount = Math.min(count, allowDuplicate ? count : candidates.length)

    for (let i = 0; i < actualCount; i++) {
        const randomIndex = Math.floor(Math.random() * candidates.length)
        selected.push(candidates[randomIndex])

        if (!allowDuplicate) {
            candidates.splice(randomIndex, 1)
            if (candidates.length === 0) break
        }
    }

    return selected
}

/**
 * 通过昵称/群名片搜索成员
 * @param {Array} memberList - 成员列表
 * @param {string} searchName - 搜索关键词
 * @returns {Object|null} 匹配的成员
 */
export function findMemberByName(memberList, searchName) {
    if (!searchName || !memberList.length) return null

    const keyword = searchName.toLowerCase().trim()
    let bestMatch = null
    let bestScore = 0

    for (const member of memberList) {
        const card = (member.card || '').toLowerCase()
        const nickname = (member.nickname || member.nick || '').toLowerCase()
        const uid = String(member.user_id || member.uid || '')

        // 精确匹配
        if (card === keyword || nickname === keyword || uid === searchName) {
            return { member, score: 100 }
        }

        // 模糊匹配
        let score = 0
        if (card.includes(keyword)) {
            score = Math.max(score, 80 - (card.length - keyword.length))
        }
        if (nickname.includes(keyword)) {
            score = Math.max(score, 70 - (nickname.length - keyword.length))
        }
        if (keyword.includes(card) && card.length > 0) {
            score = Math.max(score, 60)
        }
        if (keyword.includes(nickname) && nickname.length > 0) {
            score = Math.max(score, 50)
        }

        if (score > bestScore) {
            bestScore = score
            bestMatch = member
        }
    }

    return bestScore >= 50 ? { member: bestMatch, score: bestScore } : null
}

/**
 * 格式化成员信息
 * @param {Object} member - 成员对象
 * @returns {Object} 格式化后的信息
 */
export function formatMemberInfo(member) {
    return {
        user_id: String(member.user_id || member.uid),
        nickname: member.nickname || member.nick || '',
        card: member.card || '',
        role: member.role || 'member',
        title: member.title || ''
    }
}

/**
 * 批量发送消息（带间隔）
 * @param {Object} options
 * @returns {Promise<Array>} 发送结果
 */
export async function batchSendMessages({ event, messages, count = 1, interval = 500 }) {
    const results = []
    const actualCount = Math.min(Math.max(count, 1), 10)
    const actualInterval = Math.max(interval, 200)

    for (let i = 0; i < actualCount; i++) {
        try {
            const result = await event.reply(messages)
            results.push({
                index: i + 1,
                success: true,
                message_id: result?.message_id
            })

            if (i < actualCount - 1) {
                await new Promise(r => setTimeout(r, actualInterval))
            }
        } catch (err) {
            results.push({
                index: i + 1,
                success: false,
                error: err.message
            })
        }
    }

    return results
}

/**
 * 验证工具参数
 * @param {Object} args - 传入的参数
 * @param {Object} schema - inputSchema 定义
 * @param {Object} ctx - 上下文
 * @returns {{ valid: boolean, error?: string, missing?: string[] }}
 */
export function validateParams(args, schema, ctx = null) {
    if (!schema || !schema.properties) {
        return { valid: true }
    }

    const required = schema.required || []
    const missing = []
    const invalid = []
    const event = ctx?.getEvent?.() || ctx?.event
    const currentGroupId = event?.group_id
    const currentUserId = event?.user_id

    // 遍历所有必需参数
    for (const param of required) {
        const value = args?.[param]
        const isEmpty = value === undefined || value === null || value === ''

        if (isEmpty) {
            const prop = schema.properties[param]
            const desc = prop?.description || param
            const canAutoFill = (param === 'group_id' && currentGroupId) || (param === 'user_id' && currentUserId)
            if (!canAutoFill) {
                missing.push(`${param} (${desc})`)
            }
        }
    }
    for (const [key, value] of Object.entries(args || {})) {
        if (value === undefined || value === null) continue
        const prop = schema.properties[key]
        if (!prop) continue
        const expectedType = prop.type
        if (!expectedType) continue
        const actualType = typeof value
        if (expectedType === 'string' && actualType !== 'string') {
            if (actualType !== 'number') {
                invalid.push(`${key} 应为字符串类型`)
            }
        } else if (expectedType === 'number' && actualType !== 'number') {
            // 尝试解析数字
            if (actualType === 'string' && isNaN(Number(value))) {
                invalid.push(`${key} 应为数字类型`)
            }
        } else if (expectedType === 'boolean' && actualType !== 'boolean') {
            // 允许字符串 'true'/'false'
            if (actualType === 'string' && !['true', 'false'].includes(value.toLowerCase())) {
                invalid.push(`${key} 应为布尔类型`)
            }
        } else if (expectedType === 'array' && !Array.isArray(value)) {
            invalid.push(`${key} 应为数组类型`)
        } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(value))) {
            invalid.push(`${key} 应为对象类型`)
        }
    }

    if (missing.length > 0 || invalid.length > 0) {
        const errors = []
        if (missing.length > 0) {
            errors.push(`缺少必需参数: ${missing.join(', ')}`)
        }
        if (invalid.length > 0) {
            errors.push(`参数类型错误: ${invalid.join(', ')}`)
        }
        return {
            valid: false,
            error: errors.join('; '),
            missing: missing.length > 0 ? missing : undefined,
            invalid: invalid.length > 0 ? invalid : undefined
        }
    }

    return { valid: true }
}

/**
 * 创建参数验证错误响应
 * @param {Object} validation - validateParams 返回的结果
 * @returns {Object} 工具返回格式
 */
export function paramError(validation) {
    return {
        success: false,
        error: validation.error,
        missing_params: validation.missing,
        invalid_params: validation.invalid
    }
}

/**
 * @param {Object} args - 传入的参数
 * @param {Object} schema - inputSchema 定义
 * @returns {Object|null} 验证失败返回错误对象，成功返回 null
 */
export function checkParams(args, schema) {
    const validation = validateParams(args, schema)
    if (!validation.valid) {
        return paramError(validation)
    }
    return null
}

let yunzaiCfg = null

/**
 * @returns {Promise<Object|null>}  cfg 对象
 */
export async function loadYunzaiConfig() {
    if (yunzaiCfg) return yunzaiCfg
    try {
        yunzaiCfg = (await import('../../../../../lib/config/config.js')).default
    } catch (e) {}
    return yunzaiCfg
}
const PLUGIN_DEVELOPERS = [1018037233, 2173302144]

/**
 * 获取主人QQ列表
 * @param {string|number} botId - Bot的QQ号（可选）
 * @returns {Promise<Array<number>>} 主人QQ列表
 */
export async function getMasterList(botId) {
    const masters = new Set()
    for (const dev of PLUGIN_DEVELOPERS) {
        masters.add(dev)
    }
    try {
        const config = global.chatgptPluginConfig
        if (config) {
            const pluginMasters = config.get?.('admin.masterQQ') || []
            pluginMasters.forEach(m => {
                const num = Number(m)
                if (num) masters.add(num)
            })
            const authorQQs = config.get?.('admin.pluginAuthorQQ') || []
            authorQQs.forEach(a => {
                const num = Number(a)
                if (num) masters.add(num)
            })
        }
    } catch {}

    try {
        const yzCfg = await loadYunzaiConfig()
        if (yzCfg?.masterQQ?.length > 0) {
            yzCfg.masterQQ.forEach(m => {
                const num = Number(m)
                if (num) masters.add(num)
            })
        }
        if (yzCfg?.master && botId) {
            const botMasters = yzCfg.master[botId] || yzCfg.master[String(botId)] || []
            if (Array.isArray(botMasters)) {
                botMasters.forEach(m => {
                    const num = Number(m)
                    if (num) masters.add(num)
                })
            }
        }
        if (global.Bot?.config?.master) {
            const m = global.Bot.config.master
            if (Array.isArray(m)) {
                m.forEach(x => {
                    const num = Number(x)
                    if (num) masters.add(num)
                })
            }
        }
    } catch (err) {}

    return Array.from(masters)
}

/**
 * 发送消息到指定目标
 * @param {Object} options - 发送选项
 * @param {Object} options.bot - Bot实例
 * @param {Object} options.event - 事件对象（可选）
 * @param {string|number} options.groupId - 群号（群聊）
 * @param {string|number} options.userId - 用户QQ（私聊）
 * @param {Array|string} options.message - 消息内容
 * @returns {Promise<Object>} 发送结果
 */
export async function sendMessage({ bot, event, groupId, userId, message }) {
    if (!bot && !event) {
        throw new Error('需要提供 bot 或 event')
    }

    const _bot = bot || event?.bot || global.Bot
    if (!_bot) {
        throw new Error('无法获取Bot实例')
    }

    // 确定目标
    const targetGroupId = groupId || event?.group_id
    const targetUserId = userId || event?.user_id

    let result

    if (targetGroupId) {
        // 群消息
        if (_bot.sendApi) {
            result = await _bot.sendApi('send_group_msg', {
                group_id: parseInt(targetGroupId),
                message
            })
        } else if (_bot.pickGroup) {
            const group = _bot.pickGroup(parseInt(targetGroupId))
            result = await group?.sendMsg(message)
        }
    } else if (targetUserId) {
        // 私聊消息
        if (_bot.sendApi) {
            result = await _bot.sendApi('send_private_msg', {
                user_id: parseInt(targetUserId),
                message
            })
        } else if (_bot.pickFriend) {
            const friend = _bot.pickFriend(parseInt(targetUserId))
            result = await friend?.sendMsg(message)
        }
    } else if (event?.reply) {
        // 使用事件的reply方法
        result = await event.reply(message)
    } else {
        throw new Error('需要指定 groupId 或 userId')
    }

    return {
        success: !!result,
        message_id: result?.message_id || result?.data?.message_id,
        result
    }
}

/**
 * 发送合并转发消息
 * @param {Object} options - 发送选项
 * @param {Object} options.bot - Bot实例
 * @param {Object} options.event - 事件对象（可选）
 * @param {string|number} options.groupId - 群号
 * @param {string|number} options.userId - 用户QQ（私聊转发）
 * @param {Array} options.nodes - 转发节点数组
 * @param {Object} options.options - 额外选项 { prompt, summary, source }
 * @returns {Promise<Object>} 发送结果
 */
export async function sendForwardMessage({ bot, event, groupId, userId, nodes, options = {} }) {
    if (!bot && !event) {
        throw new Error('需要提供 bot 或 event')
    }

    const _bot = bot || event?.bot || global.Bot
    if (!_bot) {
        throw new Error('无法获取Bot实例')
    }

    const targetGroupId = groupId || event?.group_id
    const targetUserId = userId || event?.user_id
    const isGroup = !!targetGroupId

    let result

    // NapCat/OneBot API
    if (_bot.sendApi) {
        const apiName = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg'
        const params = isGroup
            ? { group_id: parseInt(targetGroupId), messages: nodes }
            : { user_id: parseInt(targetUserId), messages: nodes }

        if (options.prompt) params.prompt = options.prompt
        if (options.summary) params.summary = options.summary
        if (options.source) params.source = options.source

        result = await _bot.sendApi(apiName, params)
    }
    // icqq
    else if (_bot.pickGroup || _bot.pickFriend) {
        const target = isGroup ? _bot.pickGroup(parseInt(targetGroupId)) : _bot.pickFriend(parseInt(targetUserId))

        if (target?.makeForwardMsg && target?.sendMsg) {
            // 转换节点格式为 icqq 格式
            const forwardData = nodes.map(n => ({
                user_id: parseInt(n.data?.user_id || n.data?.uin) || 10000,
                nickname: n.data?.nickname || n.data?.name || '用户',
                message: n.data?.content || n.data?.message || ''
            }))

            const forwardMsg = await target.makeForwardMsg(forwardData)
            if (forwardMsg?.data && options) {
                if (options.prompt) forwardMsg.data.prompt = options.prompt
                if (options.summary) forwardMsg.data.summary = options.summary
            }
            result = await target.sendMsg(forwardMsg)
        }
    }

    return {
        success: !!result,
        message_id: result?.message_id || result?.data?.message_id,
        res_id: result?.res_id || result?.data?.res_id,
        result
    }
}

/**
 * 解析富文本内容为消息段数组
 * 支持特殊标记：[图片:url]、[@qq]、[表情:id]等
 * @param {string|Array} content - 消息内容
 * @returns {Array} 消息段数组
 */
export function parseRichContent(content) {
    if (Array.isArray(content)) {
        return content.flatMap(seg => {
            if (typeof seg === 'string') {
                return parseRichContent(seg)
            }
            if (seg.type && !seg.data) {
                const { type, ...rest } = seg
                return [{ type, data: rest }]
            }
            return [seg]
        })
    }

    if (typeof content !== 'string') {
        return [{ type: 'text', data: { text: String(content || '') } }]
    }

    // 解析特殊标记 - 支持中英文标记
    const segments = []
    const patterns = [
        // 图片: [图片:url] 或 [image:url] 或 [img:url]
        { regex: /\[(?:图片|image|img):([^\]]+)\]/gi, handler: m => ({ type: 'image', data: { file: m[1].trim() } }) },
        // 表情: [表情:id] 或 [face:id] 或 [emoji:id]
        { regex: /\[(?:表情|face|emoji):(\d+)\]/gi, handler: m => ({ type: 'face', data: { id: parseInt(m[1]) } }) },
        // @用户: [@qq] 或 [at:qq] 或 [@all]
        { regex: /\[@(\d+|all)\]/gi, handler: m => ({ type: 'at', data: { qq: m[1] } }) },
        { regex: /\[at:(\d+|all)\]/gi, handler: m => ({ type: 'at', data: { qq: m[1] } }) },
        // 语音: [语音:url] 或 [record:url]
        {
            regex: /\[(?:语音|record|audio):([^\]]+)\]/gi,
            handler: m => ({ type: 'record', data: { file: m[1].trim() } })
        },
        // 视频: [视频:url] 或 [video:url]
        { regex: /\[(?:视频|video):([^\]]+)\]/gi, handler: m => ({ type: 'video', data: { file: m[1].trim() } }) },
        // 回复: [reply:id] 或 [回复:id]
        { regex: /\[(?:回复|reply):(\d+)\]/gi, handler: m => ({ type: 'reply', data: { id: m[1] } }) },
        // 戳一戳: [poke:type,id]
        {
            regex: /\[poke:(\d+),(\d+)\]/gi,
            handler: m => ({ type: 'poke', data: { type: parseInt(m[1]), id: parseInt(m[2]) } })
        },
        // 分享链接: [share:url,title] 或 [share:url,title,content,image]
        {
            regex: /\[share:([^,\]]+),([^,\]]+)(?:,([^,\]]+))?(?:,([^\]]+))?\]/gi,
            handler: m => ({
                type: 'share',
                data: { url: m[1].trim(), title: m[2].trim(), content: m[3]?.trim() || '', image: m[4]?.trim() || '' }
            })
        },
        // 音乐: [music:type,id] 如 [music:qq,123456]
        { regex: /\[music:(\w+),(\d+)\]/gi, handler: m => ({ type: 'music', data: { type: m[1], id: m[2] } }) },
        // 位置: [location:lat,lon,title]
        {
            regex: /\[location:([\d.]+),([\d.]+)(?:,([^\]]+))?\]/gi,
            handler: m => ({
                type: 'location',
                data: { lat: parseFloat(m[1]), lon: parseFloat(m[2]), title: m[3]?.trim() || '' }
            })
        }
    ]

    const matches = []
    for (const { regex, handler } of patterns) {
        let match
        const re = new RegExp(regex.source, regex.flags)
        while ((match = re.exec(content)) !== null) {
            matches.push({ start: match.index, end: match.index + match[0].length, segment: handler(match) })
        }
    }

    // 按位置排序，去除重叠
    matches.sort((a, b) => a.start - b.start)
    const filteredMatches = []
    let lastEnd = -1
    for (const m of matches) {
        if (m.start >= lastEnd) {
            filteredMatches.push(m)
            lastEnd = m.end
        }
    }

    if (filteredMatches.length === 0) {
        return [{ type: 'text', data: { text: content } }]
    }

    lastEnd = 0
    for (const m of filteredMatches) {
        if (m.start > lastEnd) {
            const text = content.substring(lastEnd, m.start)
            if (text) segments.push({ type: 'text', data: { text } })
        }
        segments.push(m.segment)
        lastEnd = m.end
    }
    if (lastEnd < content.length) {
        const text = content.substring(lastEnd)
        if (text) segments.push({ type: 'text', data: { text } })
    }

    return segments
}

/**
 * 构建转发节点
 * @param {Array} messages - 消息列表 [{user_id, nickname, content}]
 * @returns {Array} 节点数组
 */
export function buildForwardNodes(messages) {
    return messages.map(msg => ({
        type: 'node',
        data: {
            user_id: String(msg.user_id || msg.uin || '10000'),
            nickname: msg.nickname || msg.name || String(msg.user_id || '用户'),
            content: parseRichContent(msg.message || msg.content || '')
        }
    }))
}

/**
 * 检测协议端类型
 * @param {Object} bot - Bot实例
 * @returns {string} 协议端类型: 'napcat', 'icqq', 'onebot', 'unknown'
 */
export function detectProtocol(bot) {
    if (!bot) return 'unknown'

    // NapCat 特征
    if (bot.sendApi && bot.version?.app_name?.toLowerCase().includes('napcat')) {
        return 'napcat'
    }

    // icqq 特征
    if (bot.pickGroup && bot.pickFriend && bot.gl && bot.fl) {
        return 'icqq'
    }

    // OneBot 特征
    if (bot.sendApi || bot.send_group_msg || bot.send_private_msg) {
        return 'onebot'
    }

    return 'unknown'
}

/**
 * 获取Bot信息
 * @param {Object} bot - Bot实例
 * @returns {Object} Bot信息
 */
export function getBotInfo(bot) {
    if (!bot) return { uin: 0, nickname: 'Unknown' }

    return {
        uin: bot.uin || bot.self_id || 0,
        nickname: bot.nickname || bot.info?.nickname || 'Bot',
        protocol: detectProtocol(bot),
        version: bot.version || {},
        status: bot.status || 'unknown'
    }
}

/**
 * 统一消息段格式
 * @param {Object} seg - 消息段
 * @param {string} targetFormat - 目标格式: 'icqq' | 'onebot' | 'auto'
 * @param {Object} bot - Bot实例（用于自动检测）
 * @returns {Object} 格式化后的消息段
 */
export function normalizeSegment(seg, targetFormat = 'auto', bot = null) {
    if (!seg || !seg.type) return seg

    const format = targetFormat === 'auto' ? detectProtocol(bot) : targetFormat
    const isIcqq = format === 'icqq'

    // 提取数据
    const data = seg.data || {}
    const directData = { ...seg }
    delete directData.type
    delete directData.data

    const mergedData = { ...directData, ...data }

    if (isIcqq) {
        // icqq 格式: { type, ...data }
        return { type: seg.type, ...mergedData }
    } else {
        // OneBot/NapCat 格式: { type, data: {...} }
        return { type: seg.type, data: mergedData }
    }
}

/**
 * 批量格式化消息段数组
 * @param {Array} segments - 消息段数组
 * @param {string} targetFormat - 目标格式
 * @param {Object} bot - Bot实例
 * @returns {Array}
 */
export function normalizeSegments(segments, targetFormat = 'auto', bot = null) {
    if (!Array.isArray(segments)) {
        if (typeof segments === 'string') {
            return [{ type: 'text', data: { text: segments } }]
        }
        return segments ? [normalizeSegment(segments, targetFormat, bot)] : []
    }
    return segments.map(seg => {
        if (typeof seg === 'string') {
            return targetFormat === 'icqq' ? { type: 'text', text: seg } : { type: 'text', data: { text: seg } }
        }
        return normalizeSegment(seg, targetFormat, bot)
    })
}

/**
 * 创建兼容的消息段（同时包含icqq和OneBot格式字段）
 */
export const compatSegment = {
    text: text => ({ type: 'text', text, data: { text } }),

    image: (file, opts = {}) => ({
        type: 'image',
        file,
        ...opts,
        data: { file, ...opts }
    }),

    at: (qq, name) => ({
        type: 'at',
        qq: String(qq),
        ...(name ? { name } : {}),
        data: { qq: String(qq), ...(name ? { name } : {}) }
    }),

    reply: id => ({
        type: 'reply',
        id: String(id),
        data: { id: String(id) }
    }),

    face: id => ({
        type: 'face',
        id: Number(id),
        data: { id: Number(id) }
    }),

    record: (file, magic = false) => ({
        type: 'record',
        file,
        magic: magic ? 1 : 0,
        data: { file, magic: magic ? 1 : 0 }
    }),

    video: (file, thumb) => ({
        type: 'video',
        file,
        ...(thumb ? { thumb } : {}),
        data: { file, ...(thumb ? { thumb } : {}) }
    }),

    json: data => {
        const jsonStr = typeof data === 'string' ? data : JSON.stringify(data)
        return { type: 'json', data: jsonStr, data: { data: jsonStr } }
    },

    xml: data => ({
        type: 'xml',
        data: data,
        data: { data }
    }),

    node: (userId, nickname, content, time) => ({
        type: 'node',
        data: {
            user_id: String(userId),
            nickname: nickname || String(userId),
            content: Array.isArray(content) ? content : [{ type: 'text', data: { text: String(content) } }],
            ...(time ? { time } : {})
        }
    }),

    forward: id => ({
        type: 'forward',
        id,
        data: { id }
    }),

    mface: (emojiPackageId, emojiId, key, summary) => ({
        type: 'mface',
        emoji_package_id: emojiPackageId,
        emoji_id: emojiId,
        ...(key ? { key } : {}),
        ...(summary ? { summary } : {}),
        data: {
            emoji_package_id: emojiPackageId,
            emoji_id: emojiId,
            ...(key ? { key } : {}),
            ...(summary ? { summary } : {})
        }
    }),

    poke: (type, id) => ({
        type: 'poke',
        poke_type: type,
        id,
        data: { type, id }
    }),

    share: (url, title, content, image) => ({
        type: 'share',
        url,
        title,
        ...(content ? { content } : {}),
        ...(image ? { image } : {}),
        data: { url, title, ...(content ? { content } : {}), ...(image ? { image } : {}) }
    }),

    music: (type, id) => ({
        type: 'music',
        music_type: type,
        id: String(id),
        data: { type, id: String(id) }
    }),

    musicCustom: (url, audio, title, content, image) => ({
        type: 'music',
        music_type: 'custom',
        url,
        audio,
        title,
        content,
        image,
        data: { type: 'custom', url, audio, title, content, image }
    }),

    location: (lat, lon, title, content) => ({
        type: 'location',
        lat,
        lon,
        ...(title ? { title } : {}),
        ...(content ? { content } : {}),
        data: { lat, lon, ...(title ? { title } : {}), ...(content ? { content } : {}) }
    }),

    markdown: content => ({
        type: 'markdown',
        content,
        data: { content }
    }),

    keyboard: rows => ({
        type: 'keyboard',
        data: { content: { rows } }
    }),

    dice: () => ({ type: 'dice', data: {} }),
    rps: () => ({ type: 'rps', data: {} }),
    shake: () => ({ type: 'shake', data: {} })
}

/**
 * 发送合并转发消息
 * 自动适配 icqq/OneBot/NapCat，支持外显自定义
 * @param {Object} options
 * @param {Object} options.bot - Bot实例
 * @param {Object} options.event - 事件对象
 * @param {number|string} options.groupId - 群号
 * @param {number|string} options.userId - 用户QQ（私聊）
 * @param {Array} options.messages - 消息列表 [{user_id, nickname, content}]
 * @param {Object} options.display - 外显选项 {prompt, summary, source}
 * @returns {Promise<Object>}
 */
export async function sendForwardMsgEnhanced({ bot, event, groupId, userId, messages, display = {} }) {
    const _bot = bot || event?.bot || global.Bot
    if (!_bot) throw new Error('无法获取Bot实例')

    const targetGroupId = groupId || event?.group_id
    const targetUserId = userId || event?.user_id
    const isGroup = !!targetGroupId
    const protocol = detectProtocol(_bot)
    const isIcqq = protocol === 'icqq'

    /**
     * 解析消息内容为消息段数组
     * 支持字符串、数组、富文本标记
     */
    const parseContent = content => {
        if (!content) return [{ type: 'text', data: { text: '' } }]

        // 已经是数组
        if (Array.isArray(content)) {
            return content.flatMap(item => {
                if (typeof item === 'string') {
                    return parseRichContent(item)
                }
                // 已经是消息段对象
                if (item.type) {
                    return [normalizeSegment(item, isIcqq ? 'icqq' : 'onebot', _bot)]
                }
                return [{ type: 'text', data: { text: String(item) } }]
            })
        }

        // 字符串：解析富文本标记
        if (typeof content === 'string') {
            return parseRichContent(content)
        }

        // 对象：单个消息段
        if (content.type) {
            return [normalizeSegment(content, isIcqq ? 'icqq' : 'onebot', _bot)]
        }

        return [{ type: 'text', data: { text: String(content) } }]
    }

    // 构建节点 - OneBot 格式
    const buildOneBotNodes = () =>
        messages.map(msg => {
            const uid = String(msg.user_id || msg.uin || '10000')
            const nick = msg.nickname || msg.name || uid
            const content = parseContent(msg.message || msg.content)
            const normalizedContent = normalizeSegments(content, 'onebot', _bot)

            return {
                type: 'node',
                data: {
                    user_id: uid,
                    nickname: nick,
                    content: normalizedContent,
                    ...(msg.time ? { time: msg.time } : {})
                }
            }
        })

    // 构建节点 - icqq 格式
    const buildIcqqNodes = () =>
        messages.map(msg => {
            const uid = parseInt(msg.user_id || msg.uin) || 10000
            const nick = msg.nickname || msg.name || String(uid)
            const content = parseContent(msg.message || msg.content)
            const normalizedContent = normalizeSegments(content, 'icqq', _bot)

            return {
                user_id: uid,
                nickname: nick,
                message: normalizedContent,
                ...(msg.time ? { time: msg.time } : {})
            }
        })

    const nodes = buildOneBotNodes()

    // 检测消息中是否包含 ark/json 类型（需要特殊处理）
    const hasComplexContent = messages.some(msg => {
        const content = msg.message || msg.content
        if (!content) return false

        // 检查数组中的消息段
        if (Array.isArray(content)) {
            return content.some(
                seg => seg.type === 'json' || seg.type === 'xml' || seg.type === 'ark' || seg.type === 'markdown'
            )
        }

        // 检查单个对象
        if (typeof content === 'object' && content.type) {
            return ['json', 'xml', 'ark', 'markdown'].includes(content.type)
        }

        return false
    })

    let result = null
    let method = ''
    let lastError = null

    // 方式1: NapCat/OneBot sendApi
    if (_bot.sendApi) {
        try {
            // 如果包含ark/json等复杂内容，尝试使用不同的发送方式
            if (hasComplexContent) {
                // 方式A: 尝试 send_forward_msg (NapCat 统一接口)
                try {
                    const forwardParams = {
                        messages: nodes,
                        ...(isGroup ? { group_id: parseInt(targetGroupId) } : { user_id: parseInt(targetUserId) })
                    }
                    if (display.prompt) forwardParams.prompt = display.prompt
                    if (display.summary) forwardParams.summary = display.summary
                    if (display.source) forwardParams.source = display.source

                    result = await _bot.sendApi('send_forward_msg', forwardParams)
                    method = 'sendApi_unified'

                    if (
                        result?.status === 'ok' ||
                        result?.retcode === 0 ||
                        result?.message_id ||
                        result?.data?.message_id
                    ) {
                        return {
                            success: true,
                            message_id: result.message_id || result.data?.message_id,
                            res_id: result.res_id || result.data?.res_id,
                            method,
                            node_count: nodes.length,
                            has_complex_content: true,
                            target: isGroup
                                ? { type: 'group', id: targetGroupId }
                                : { type: 'private', id: targetUserId }
                        }
                    }
                } catch (unifiedErr) {
                    // 继续尝试其他方式
                }

                // 方式B: 尝试分步发送 - 先上传节点再发送
                try {
                    // 使用 upload_forward_msg 上传节点
                    const uploadResult = await _bot.sendApi('upload_forward_msg', {
                        messages: nodes
                    })

                    const resId = uploadResult?.res_id || uploadResult?.data?.res_id
                    if (resId) {
                        // 使用 res_id 发送
                        const sendParams = isGroup
                            ? { group_id: parseInt(targetGroupId), res_id: resId }
                            : { user_id: parseInt(targetUserId), res_id: resId }

                        const apiName = isGroup ? 'send_group_msg' : 'send_private_msg'
                        result = await _bot.sendApi(apiName, {
                            ...sendParams,
                            message: [{ type: 'forward', data: { id: resId } }]
                        })
                        method = 'upload_forward'

                        if (
                            result?.status === 'ok' ||
                            result?.retcode === 0 ||
                            result?.message_id ||
                            result?.data?.message_id
                        ) {
                            return {
                                success: true,
                                message_id: result.message_id || result.data?.message_id,
                                res_id: resId,
                                method,
                                node_count: nodes.length,
                                has_complex_content: true,
                                target: isGroup
                                    ? { type: 'group', id: targetGroupId }
                                    : { type: 'private', id: targetUserId }
                            }
                        }
                    }
                } catch (uploadErr) {
                    // 继续尝试标准方式
                }
            }

            // 标准方式: send_group_forward_msg / send_private_forward_msg
            const apiName = isGroup ? 'send_group_forward_msg' : 'send_private_forward_msg'
            const params = isGroup
                ? { group_id: parseInt(targetGroupId), messages: nodes }
                : { user_id: parseInt(targetUserId), messages: nodes }

            // 添加外显参数
            if (display.prompt) params.prompt = display.prompt
            if (display.summary) params.summary = display.summary
            if (display.source) params.source = display.source

            result = await _bot.sendApi(apiName, params)
            method = 'sendApi'

            if (result?.status === 'ok' || result?.retcode === 0 || result?.message_id || result?.data?.message_id) {
                return {
                    success: true,
                    message_id: result.message_id || result.data?.message_id,
                    res_id: result.res_id || result.data?.res_id,
                    method,
                    node_count: nodes.length,
                    target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
                }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    // 方式2: icqq makeForwardMsg
    if (_bot.pickGroup || _bot.pickFriend) {
        try {
            let target = null
            const icqqNodes = buildIcqqNodes()

            // 自定义外显的辅助函数
            const applyDisplay = forwardMsg => {
                if (forwardMsg?.data) {
                    if (display.prompt) forwardMsg.data.prompt = display.prompt
                    if (display.summary) forwardMsg.data.summary = display.summary
                    if (display.source) forwardMsg.data.source = display.source
                }
                // 如果 forwardMsg 是数组（某些 icqq 版本）
                if (Array.isArray(forwardMsg)) {
                    for (const item of forwardMsg) {
                        if (item?.data) {
                            if (display.prompt) item.data.prompt = display.prompt
                            if (display.summary) item.data.summary = display.summary
                            if (display.source) item.data.source = display.source
                        }
                    }
                }
                return forwardMsg
            }

            if (isGroup) {
                target = _bot.pickGroup(parseInt(targetGroupId))
            } else {
                // 私聊发送合并转发
                target = _bot.pickFriend(parseInt(targetUserId))

                // icqq 私聊可能没有 makeForwardMsg，尝试借用群来生成
                if (!target?.makeForwardMsg && _bot.pickGroup) {
                    const groups = _bot.gl || new Map()
                    const firstGroupId = groups.keys().next().value
                    if (firstGroupId) {
                        const tempGroup = _bot.pickGroup(firstGroupId)
                        if (tempGroup?.makeForwardMsg) {
                            const forwardMsg = applyDisplay(await tempGroup.makeForwardMsg(icqqNodes))

                            if (target?.sendMsg) {
                                result = await target.sendMsg(forwardMsg)
                                method = 'icqq_private_via_group'

                                if (result) {
                                    return {
                                        success: true,
                                        message_id: result.message_id,
                                        res_id: result.res_id,
                                        method,
                                        node_count: messages.length,
                                        target: { type: 'private', id: targetUserId }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (target?.makeForwardMsg && target?.sendMsg) {
                const forwardMsg = applyDisplay(await target.makeForwardMsg(icqqNodes))
                result = await target.sendMsg(forwardMsg)
                method = 'icqq'

                if (result) {
                    return {
                        success: true,
                        message_id: result.message_id,
                        res_id: result.res_id,
                        method,
                        node_count: messages.length,
                        target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
                    }
                }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    // 方式3: 直接Bot方法
    const legacyMethod = isGroup
        ? _bot.sendGroupForwardMsg || _bot.send_group_forward_msg
        : _bot.sendPrivateForwardMsg || _bot.send_private_forward_msg

    if (typeof legacyMethod === 'function') {
        try {
            const targetId = isGroup ? parseInt(targetGroupId) : parseInt(targetUserId)
            result = await legacyMethod.call(_bot, targetId, nodes)
            method = 'legacy'

            if (result) {
                return {
                    success: true,
                    message_id: result.message_id,
                    res_id: result.res_id,
                    method,
                    node_count: nodes.length,
                    target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
                }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    return {
        success: false,
        error: lastError || '当前环境不支持发送合并转发消息',
        tried_methods: ['sendApi', 'icqq', 'legacy'],
        target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
    }
}

/**
 * 发送卡片消息
 * @param {Object} options
 * @param {Object} options.bot - Bot实例
 * @param {Object} options.event - 事件对象
 * @param {number|string} options.groupId - 群号
 * @param {number|string} options.userId - 用户QQ
 * @param {string} options.type - 卡片类型: 'json' | 'xml'
 * @param {string|Object} options.data - 卡片数据
 * @returns {Promise<Object>}
 */
export async function sendCardMessage({ bot, event, groupId, userId, type = 'json', data }) {
    const _bot = bot || event?.bot || global.Bot
    if (!_bot) throw new Error('无法获取Bot实例')

    const targetGroupId = groupId || event?.group_id
    const targetUserId = userId || event?.user_id
    const protocol = detectProtocol(_bot)
    const isIcqq = protocol === 'icqq'

    // 构建卡片消息段
    let cardData = data
    if (type === 'json' && typeof data === 'object') {
        cardData = JSON.stringify(data)
    }

    const cardSeg = isIcqq ? { type, data: cardData } : { type, data: { data: cardData } }

    let result = null
    let lastError = null

    // 优先 icqq
    if (isIcqq && (_bot.pickGroup || _bot.pickFriend)) {
        try {
            if (targetGroupId && _bot.pickGroup) {
                result = await _bot.pickGroup(parseInt(targetGroupId))?.sendMsg(cardSeg)
            } else if (targetUserId && _bot.pickFriend) {
                result = await _bot.pickFriend(parseInt(targetUserId))?.sendMsg(cardSeg)
            }
            if (result?.message_id) {
                return { success: true, message_id: result.message_id, protocol: 'icqq' }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    // sendApi
    if (_bot.sendApi) {
        try {
            if (targetGroupId) {
                result = await _bot.sendApi('send_group_msg', {
                    group_id: parseInt(targetGroupId),
                    message: [cardSeg]
                })
            } else if (targetUserId) {
                result = await _bot.sendApi('send_private_msg', {
                    user_id: parseInt(targetUserId),
                    message: [cardSeg]
                })
            }
            if (result?.message_id || result?.data?.message_id) {
                return {
                    success: true,
                    message_id: result.message_id || result.data?.message_id,
                    protocol: 'onebot'
                }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    // event.reply
    if (event?.reply) {
        try {
            result = await event.reply(cardSeg)
            if (result?.message_id) {
                return { success: true, message_id: result.message_id, protocol: 'reply' }
            }
        } catch (err) {
            lastError = err.message
        }
    }

    return { success: false, error: lastError || '发送失败' }
}

/**
 * 解析卡片消息
 * @param {Object|string} cardData - JSON/XML数据
 * @returns {Object} 解析结果
 */
export function parseCardData(cardData) {
    try {
        const data = typeof cardData === 'string' ? JSON.parse(cardData) : cardData
        if (!data?.app) return { type: 'unknown', data: {} }

        const result = { app: data.app, raw: data }

        switch (data.app) {
            case 'com.tencent.structmsg':
                result.type = 'link'
                result.title = data.meta?.news?.title || data.prompt || ''
                result.desc = data.meta?.news?.desc || ''
                result.url = data.meta?.news?.jumpUrl || ''
                result.image = data.meta?.news?.preview || ''
                break
            case 'com.tencent.multimsg':
                result.type = 'forward'
                result.resid = data.meta?.detail?.resid || ''
                result.summary = data.meta?.detail?.summary || ''
                result.preview = (data.meta?.detail?.news || []).map(n => n.text)
                break
            case 'com.tencent.miniapp':
            case 'com.tencent.miniapp_01':
                result.type = 'miniapp'
                result.appid = data.meta?.detail_1?.appid || ''
                result.title = data.meta?.detail_1?.title || data.prompt || ''
                result.desc = data.meta?.detail_1?.desc || ''
                result.url = data.meta?.detail_1?.qqdocurl || ''
                result.image = data.meta?.detail_1?.preview || ''
                break
            case 'com.tencent.music':
                result.type = 'music'
                result.title = data.meta?.music?.title || ''
                result.singer = data.meta?.music?.desc || ''
                result.url = data.meta?.music?.jumpUrl || ''
                result.audio = data.meta?.music?.musicUrl || ''
                break
            default:
                result.type = 'custom'
                result.prompt = data.prompt || ''
        }

        return result
    } catch {
        return { type: 'invalid', error: 'JSON解析失败' }
    }
}

/**
 * 构建链接卡片JSON
 */
export function buildLinkCard(title, desc, url, image, source = '') {
    return {
        app: 'com.tencent.structmsg',
        desc: '',
        view: 'news',
        ver: '0.0.0.1',
        prompt: title,
        meta: {
            news: {
                title,
                desc,
                jumpUrl: url,
                preview: image || '',
                tag: source,
                tagIcon: ''
            }
        }
    }
}

/**
 * 构建大图卡片
 */
export function buildBigImageCard(image, title = '', desc = '') {
    return buildLinkCard(title || '[图片]', desc, image, image)
}

/**
 * QQ Web API 封装
 * 参考 yenai-plugin 实现
 */
export const qqWebApi = {
    /**
     * 获取 GTK (g_tk) 值
     */
    getGtk(bot, domain = 'qun.qq.com') {
        const cookies = bot.cookies?.[domain] || ''
        const match = cookies.match(/p_skey=([^;]+)/)
        const pSkey = match ? match[1] : ''

        let hash = 5381
        for (let i = 0; i < pSkey.length; i++) {
            hash += (hash << 5) + pSkey.charCodeAt(i)
        }
        return hash & 2147483647
    },

    /**
     * 获取通用请求头
     */
    getHeaders(bot) {
        return {
            'Content-type': 'application/json;charset=UTF-8',
            Cookie: bot.cookies?.['qun.qq.com'] || '',
            'qname-service': '976321:131072',
            'qname-space': 'Production'
        }
    },

    /**
     * 通用请求方法
     */
    async _request(name, url, options = {}) {
        try {
            const response = await fetch(url, options)
            const text = await response.text()
            try {
                return JSON.parse(text)
            } catch {
                return { _raw: text, _parseError: true }
            }
        } catch (err) {
            logger.error(`[qqWebApi] ${name} 请求失败:`, err.message)
            throw err
        }
    },

    /**
     * 获取群星级
     * 注意：此 API 必须使用 qqweb.qq.com 的 cookie，不能使用 qun.qq.com
     */
    async getGroupLevel(bot, groupId) {
        // 必须使用 qqweb.qq.com 的 cookie
        if (!bot.cookies?.['qqweb.qq.com']) {
            return { ec: -1, em: '需要 qqweb.qq.com 的 cookie 才能获取群星级' }
        }
        const url = `https://qqweb.qq.com/c/activedata/get_credit_level_info?bkn=${bot.bkn}&uin=${bot.uin}&gc=${groupId}`
        return await this._request('getGroupLevel', url, {
            headers: {
                Cookie: bot.cookies['qqweb.qq.com'],
                Referer: `https://qqweb.qq.com/m/business/qunlevel/index.html?gc=${groupId}&from=0&_wv=1027`,
                'User-agent':
                    'Mozilla/5.0 (Linux; Android 12; M2012K11AC Build/SKQ1.220303.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/89.0.4389.72 MQQBrowser/6.2 TBS/046141 Mobile Safari/537.36 V1_AND_SQ_8.3.9_350_TIM_D QQ/3.5.0.3148 NetType/WIFI WebP/0.3.0 Pixel/1080 StatusBarHeight/81 SimpleUISwitch/0 QQTheme/1015712'
            }
        })
    },

    /**
     * 获取群龙王
     */
    async getDragonKing(bot, groupId) {
        const url = `https://qun.qq.com/interactive/honorlist?gc=${groupId}&type=1&_wv=3&_wwv=129`
        const response = await fetch(url, {
            headers: { Cookie: bot.cookies?.['qun.qq.com'] || '' }
        })
        const html = await response.text()

        // 使用 cheerio 解析 HTML
        const $ = cheerio.load(html)

        // 遍历所有 script 标签，找到包含 __INITIAL_STATE__ 的
        let data = null
        $('script').each((i, el) => {
            const content = $(el).html() || ''
            if (content.includes('__INITIAL_STATE__')) {
                // 提取 JSON 部分: window.__INITIAL_STATE__={...};
                const match = content.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/)
                if (match) {
                    try {
                        data = JSON.parse(match[1])
                        return false // 停止遍历
                    } catch {}
                }
            }
        })

        return data?.currentTalkative || null
    },

    /**
     * 今日打卡列表
     */
    async getSignInToday(bot, groupId) {
        const url = 'https://qun.qq.com/v2/signin/trpc/GetDaySignedList'
        const gtk = this.getGtk(bot, 'qun.qq.com')
        const today = new Date()
        const dayYmd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`

        return await this._request('getSignInToday', `${url}?g_tk=${gtk}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                dayYmd,
                offset: 0,
                limit: 100,
                uid: String(bot.uin),
                groupId: String(groupId)
            })
        })
    },

    /**
     * 群发言榜单
     * @param {boolean} weekly - true为7天，false为昨天
     */
    async getSpeakRank(bot, groupId, weekly = false) {
        const url = 'https://qun.qq.com/m/qun/activedata/proxy/domain/qun.qq.com/cgi-bin/manager/report/list'
        const params = new URLSearchParams({
            bkn: bot.bkn,
            gc: groupId,
            type: 0,
            start: 0,
            time: weekly ? 1 : 0
        })

        return await this._request('getSpeakRank', `${url}?${params}`, {
            headers: this.getHeaders(bot)
        })
    },

    /**
     * 群数据统计
     * @param {boolean} weekly - true为7天，false为昨天
     */
    async getGroupData(bot, groupId, weekly = false) {
        const url = 'https://qun.qq.com/m/qun/activedata/proxy/domain/qun.qq.com/cgi-bin/manager/report/index'
        const params = new URLSearchParams({
            gc: groupId,
            time: weekly ? 1 : 0,
            bkn: bot.bkn
        })

        return await this._request('getGroupData', `${url}?${params}`, {
            headers: this.getHeaders(bot)
        })
    },

    /**
     * 幸运字符列表
     */
    async getLuckyList(bot, groupId, start = 0, limit = 20) {
        const url = 'https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/word_list'
        return await this._request('getLuckyList', `${url}?bkn=${bot.bkn}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                group_code: String(groupId),
                start,
                limit,
                need_equip_info: true
            })
        })
    },

    /**
     * 抽取幸运字符
     */
    async drawLucky(bot, groupId) {
        const url = 'https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/draw_lottery'
        return await this._request('drawLucky', `${url}?bkn=${bot.bkn}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                group_code: String(groupId)
            })
        })
    },

    /**
     * 更换/装备幸运字符
     */
    async equipLucky(bot, groupId, wordId) {
        const url = 'https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/equip'
        return await this._request('equipLucky', `${url}?bkn=${bot.bkn}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                group_code: String(groupId),
                word_id: String(wordId)
            })
        })
    },

    /**
     * 开关幸运字符
     * @param {boolean} enable - true开启，false关闭
     */
    async switchLucky(bot, groupId, enable) {
        const url = 'https://qun.qq.com/v2/luckyword/proxy/domain/qun.qq.com/cgi-bin/group_lucky_word/setting'
        return await this._request('switchLucky', `${url}?bkn=${bot.bkn}`, {
            method: 'POST',
            headers: this.getHeaders(bot),
            body: JSON.stringify({
                group_code: String(groupId),
                cmd: enable ? 1 : 2
            })
        })
    }
}

/**
 * 获取 Bot 在指定群内的权限信息
 * @param {Object} bot - Bot实例
 * @param {number|string} groupId - 群号
 * @returns {Promise<{role: 'owner'|'admin'|'member'|'unknown', isAdmin: boolean, isOwner: boolean, canKick: boolean, canMute: boolean, canRecall: boolean}>}
 */
export async function getBotPermission(bot, groupId) {
    const result = {
        role: 'unknown',
        isAdmin: false,
        isOwner: false,
        canKick: false,
        canMute: false,
        canRecall: false,
        canSetCard: false,
        canSetTitle: false,
        inGroup: false
    }

    if (!bot || !groupId) return result

    const gid = parseInt(groupId)
    const botId = bot.uin || bot.self_id

    try {
        // 方式1: 从 gl (群列表缓存) 获取
        const groupInfo = bot.gl?.get(gid)
        if (groupInfo) {
            result.inGroup = true
            // admin_flag: 是否是管理员
            // owner_id: 群主QQ
            if (groupInfo.owner_id === botId) {
                result.role = 'owner'
                result.isOwner = true
                result.isAdmin = true
            } else if (groupInfo.admin_flag) {
                result.role = 'admin'
                result.isAdmin = true
            } else {
                result.role = 'member'
            }
        }

        // 方式2: 通过 pickGroup 获取成员信息
        if (result.role === 'unknown' && bot.pickGroup) {
            try {
                const group = bot.pickGroup(gid)
                const memberInfo = group?.pickMember?.(botId)?.info
                if (memberInfo) {
                    result.inGroup = true
                    if (memberInfo.role === 'owner') {
                        result.role = 'owner'
                        result.isOwner = true
                        result.isAdmin = true
                    } else if (memberInfo.role === 'admin') {
                        result.role = 'admin'
                        result.isAdmin = true
                    } else {
                        result.role = 'member'
                    }
                }
            } catch (e) {
                // 忽略错误
            }
        }

        // 方式3: OneBot API
        if (result.role === 'unknown' && bot.sendApi) {
            try {
                const info = await bot.sendApi('get_group_member_info', {
                    group_id: gid,
                    user_id: botId
                })
                if (info?.data || info?.role) {
                    result.inGroup = true
                    const role = info?.data?.role || info?.role || 'member'
                    result.role = role
                    result.isOwner = role === 'owner'
                    result.isAdmin = role === 'owner' || role === 'admin'
                }
            } catch (e) {
                // 忽略错误
            }
        }

        // 设置权限能力
        if (result.isOwner) {
            result.canKick = true
            result.canMute = true
            result.canRecall = true
            result.canSetCard = true
            result.canSetTitle = true
        } else if (result.isAdmin) {
            result.canKick = true
            result.canMute = true
            result.canRecall = true
            result.canSetCard = true
            result.canSetTitle = false // 只有群主能设置头衔
        }
    } catch (e) {
        logger.debug(`[helpers] getBotPermission error: ${e.message}`)
    }

    return result
}

/**
 * 检查工具执行结果是否为错误
 * 用于判断工具返回的结果是否表示失败（如权限不足、被禁用等）
 * @param {Object} result - 工具返回结果
 * @returns {boolean} 是否为错误
 */
export function isToolResultError(result) {
    if (!result) return true
    // 显式标记为错误
    if (result.isError === true) return true
    // success 为 false
    if (result.success === false) return true
    // 有 error 字段
    if (result.error) return true
    // content 中包含错误
    if (Array.isArray(result.content)) {
        const textContent = result.content.find(c => c.type === 'text')
        if (textContent?.text) {
            const errorPatterns = [
                /失败/,
                /错误/,
                /无权限/,
                /被禁用/,
                /被拦截/,
                /不存在/,
                /无法/,
                /拒绝/,
                /Error:/i,
                /Failed/i,
                /Permission denied/i,
                /Forbidden/i
            ]
            for (const pattern of errorPatterns) {
                if (pattern.test(textContent.text)) return true
            }
        }
    }
    return false
}

/**
 * 创建权限不足的错误响应
 * @param {string} action - 操作名称
 * @param {string} requiredRole - 所需权限
 * @param {string} currentRole - 当前权限
 * @returns {Object} 错误响应
 */
export function permissionDeniedError(action, requiredRole, currentRole) {
    return {
        success: false,
        error: `权限不足: 执行"${action}"需要${requiredRole}权限，当前Bot权限为${currentRole}`,
        isError: true,
        permissionDenied: true,
        required: requiredRole,
        current: currentRole
    }
}

/**
 * 创建工具被禁用的错误响应
 * @param {string} toolName - 工具名称
 * @param {string} reason - 禁用原因
 * @returns {Object} 错误响应
 */
export function toolDisabledError(toolName, reason = '已被管理员禁用') {
    return {
        success: false,
        error: `工具"${toolName}"${reason}，无法执行`,
        isError: true,
        toolDisabled: true,
        toolName
    }
}
