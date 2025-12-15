/**
 * MCP 工具辅助函数
 * 提供群成员获取、消息发送等通用功能
 */

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
