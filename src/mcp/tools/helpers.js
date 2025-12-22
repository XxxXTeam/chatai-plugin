/**
 * MCP 工具辅助函数
 */

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
        if (!group?.kickMember) throw new Error('icqq: 无法踢出成员')
        return await group.kickMember(parseInt(userId), '', rejectAdd)
    },
    
    async setAdmin(bot, groupId, userId, enable = true) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.setAdmin) throw new Error('icqq: 无法设置管理员')
        return await group.setAdmin(parseInt(userId), enable)
    },
    
    async setCard(bot, groupId, userId, card) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.setCard) throw new Error('icqq: 无法设置群名片')
        return await group.setCard(parseInt(userId), card)
    },
    
    async setTitle(bot, groupId, userId, title, duration = -1) {
        const group = bot.pickGroup?.(parseInt(groupId))
        if (!group?.setTitle) throw new Error('icqq: 无法设置头衔')
        return await group.setTitle(parseInt(userId), title, duration)
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
                memberList = await group.getMemberList() || []
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
        role,           // 筛选角色: 'admin', 'owner', 'member', 'admin_only' (仅管理员不含群主)
        excludeBot,     // 排除机器人
        excludeOwner,   // 排除群主
        excludeAdmin,   // 排除管理员
        excludeUsers,   // 排除指定用户
        botId           // 机器人ID
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
            const canAutoFill = (
                (param === 'group_id' && currentGroupId) ||
                (param === 'user_id' && currentUserId)
            )
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

/**
 * 获取主人QQ列表
 * @param {string|number} botId - Bot的QQ号（可选）
 * @returns {Promise<Array<number>>} 主人QQ列表
 */
export async function getMasterList(botId) {
    const masters = new Set()
    
    try {
        const yzCfg = await loadYunzaiConfig()
        
        // 方式1: Yunzai cfg.masterQQ
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
        const target = isGroup 
            ? _bot.pickGroup(parseInt(targetGroupId)) 
            : _bot.pickFriend(parseInt(targetUserId))
        
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
        { regex: /\[(?:图片|image|img):([^\]]+)\]/gi, handler: (m) => ({ type: 'image', data: { file: m[1].trim() } }) },
        // 表情: [表情:id] 或 [face:id] 或 [emoji:id]
        { regex: /\[(?:表情|face|emoji):(\d+)\]/gi, handler: (m) => ({ type: 'face', data: { id: parseInt(m[1]) } }) },
        // @用户: [@qq] 或 [at:qq] 或 [@all]
        { regex: /\[@(\d+|all)\]/gi, handler: (m) => ({ type: 'at', data: { qq: m[1] } }) },
        { regex: /\[at:(\d+|all)\]/gi, handler: (m) => ({ type: 'at', data: { qq: m[1] } }) },
        // 语音: [语音:url] 或 [record:url]
        { regex: /\[(?:语音|record|audio):([^\]]+)\]/gi, handler: (m) => ({ type: 'record', data: { file: m[1].trim() } }) },
        // 视频: [视频:url] 或 [video:url]
        { regex: /\[(?:视频|video):([^\]]+)\]/gi, handler: (m) => ({ type: 'video', data: { file: m[1].trim() } }) },
        // 回复: [reply:id] 或 [回复:id]
        { regex: /\[(?:回复|reply):(\d+)\]/gi, handler: (m) => ({ type: 'reply', data: { id: m[1] } }) },
        // 戳一戳: [poke:type,id]
        { regex: /\[poke:(\d+),(\d+)\]/gi, handler: (m) => ({ type: 'poke', data: { type: parseInt(m[1]), id: parseInt(m[2]) } }) },
        // 分享链接: [share:url,title] 或 [share:url,title,content,image]
        { regex: /\[share:([^,\]]+),([^,\]]+)(?:,([^,\]]+))?(?:,([^\]]+))?\]/gi, handler: (m) => ({ 
            type: 'share', 
            data: { url: m[1].trim(), title: m[2].trim(), content: m[3]?.trim() || '', image: m[4]?.trim() || '' } 
        }) },
        // 音乐: [music:type,id] 如 [music:qq,123456]
        { regex: /\[music:(\w+),(\d+)\]/gi, handler: (m) => ({ type: 'music', data: { type: m[1], id: m[2] } }) },
        // 位置: [location:lat,lon,title]
        { regex: /\[location:([\d.]+),([\d.]+)(?:,([^\]]+))?\]/gi, handler: (m) => ({ 
            type: 'location', 
            data: { lat: parseFloat(m[1]), lon: parseFloat(m[2]), title: m[3]?.trim() || '' } 
        }) },
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
            return targetFormat === 'icqq' 
                ? { type: 'text', text: seg }
                : { type: 'text', data: { text: seg } }
        }
        return normalizeSegment(seg, targetFormat, bot)
    })
}

/**
 * 创建兼容的消息段（同时包含icqq和OneBot格式字段）
 */
export const compatSegment = {
    text: (text) => ({ type: 'text', text, data: { text } }),
    
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
    
    reply: (id) => ({ 
        type: 'reply', 
        id: String(id),
        data: { id: String(id) }
    }),
    
    face: (id) => ({ 
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
    
    json: (data) => {
        const jsonStr = typeof data === 'string' ? data : JSON.stringify(data)
        return { type: 'json', data: jsonStr, data: { data: jsonStr } }
    },
    
    xml: (data) => ({ 
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
    
    forward: (id) => ({ 
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
        url, title,
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
        url, audio, title, content, image,
        data: { type: 'custom', url, audio, title, content, image }
    }),
    
    location: (lat, lon, title, content) => ({
        type: 'location',
        lat, lon,
        ...(title ? { title } : {}),
        ...(content ? { content } : {}),
        data: { lat, lon, ...(title ? { title } : {}), ...(content ? { content } : {}) }
    }),
    
    markdown: (content) => ({
        type: 'markdown',
        content,
        data: { content }
    }),
    
    keyboard: (rows) => ({
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
    const parseContent = (content) => {
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
    const buildOneBotNodes = () => messages.map(msg => {
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
    const buildIcqqNodes = () => messages.map(msg => {
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
            return content.some(seg => 
                seg.type === 'json' || seg.type === 'xml' || 
                seg.type === 'ark' || seg.type === 'markdown'
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
                    
                    if (result?.status === 'ok' || result?.retcode === 0 || result?.message_id || result?.data?.message_id) {
                        return {
                            success: true,
                            message_id: result.message_id || result.data?.message_id,
                            res_id: result.res_id || result.data?.res_id,
                            method,
                            node_count: nodes.length,
                            has_complex_content: true,
                            target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
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
                        
                        if (result?.status === 'ok' || result?.retcode === 0 || result?.message_id || result?.data?.message_id) {
                            return {
                                success: true,
                                message_id: result.message_id || result.data?.message_id,
                                res_id: resId,
                                method,
                                node_count: nodes.length,
                                has_complex_content: true,
                                target: isGroup ? { type: 'group', id: targetGroupId } : { type: 'private', id: targetUserId }
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
            const applyDisplay = (forwardMsg) => {
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
        ? (_bot.sendGroupForwardMsg || _bot.send_group_forward_msg)
        : (_bot.sendPrivateForwardMsg || _bot.send_private_forward_msg)
    
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
    
    const cardSeg = isIcqq
        ? { type, data: cardData }
        : { type, data: { data: cardData } }
    
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
