/**
 * MCP 工具辅助函数
 * 提供适配器封装、群成员获取、消息发送等通用功能
 */

// ======================= icqq API 封装 =======================

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

/**
 * 调用 OneBot API (napcat/onebot)
 */
export async function callOneBotApi(bot, action, params = {}) {
    if (bot.sendApi) {
        return await bot.sendApi(action, params)
    }
    if (bot[action]) {
        return await bot[action](params)
    }
    throw new Error(`不支持的API: ${action}`)
}

// ======================= 群成员操作 =======================

/**
 * 获取群成员列表
 * 兼容 icqq/miao-adapter 和 OneBot/NapCat
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
            
            // 如果不能自动填充，报告缺失
            if (!canAutoFill) {
                missing.push(`${param} (${desc})`)
            }
        }
    }
    
    // 类型检查
    for (const [key, value] of Object.entries(args || {})) {
        if (value === undefined || value === null) continue
        
        const prop = schema.properties[key]
        if (!prop) continue
        
        const expectedType = prop.type
        if (!expectedType) continue
        
        const actualType = typeof value
        
        // 类型匹配检查
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
