/**
 * 特殊事件检测工具
 * 兼容 icqq / NapCat / OneBot v11 / go-cqhttp / TRSS-Yunzai
 */

/**
 * 检测戳一戳事件
 * @param {Object} e - 事件对象
 * @returns {{ isPoke: boolean, isGroup: boolean, operator: string|number, target: string|number, action?: string }}
 */
export function detectPoke(e) {
    const result = { isPoke: false, isGroup: false, operator: null, target: null, action: null }
    
    // NapCat: notice_type='group_poke' | 'friend_poke'
    if (e.notice_type === 'group_poke') {
        result.isPoke = true
        result.isGroup = true
        result.operator = e.operator_id || e.user_id
        result.target = e.target_id || e.poked_uid
        result.action = e.action || 'poke'
        return result
    }
    
    if (e.notice_type === 'friend_poke') {
        result.isPoke = true
        result.isGroup = false
        result.operator = e.operator_id || e.user_id
        result.target = e.target_id || e.poked_uid
        return result
    }
    
    // OneBot v11 / go-cqhttp: notice_type='notify', sub_type='poke'
    if (e.notice_type === 'notify' && e.sub_type === 'poke') {
        result.isPoke = true
        result.isGroup = !!e.group_id
        result.operator = e.user_id || e.sender_id
        result.target = e.target_id
        return result
    }
    
    // icqq: notice_type='group'/'friend', sub_type='poke'
    if ((e.notice_type === 'group' || e.notice_type === 'friend') && e.sub_type === 'poke') {
        result.isPoke = true
        result.isGroup = e.notice_type === 'group'
        result.operator = e.user_id || e.operator_id
        result.target = e.target || e.target_id
        return result
    }
    
    // TRSS-Yunzai 格式
    if (e.post_type === 'notice' && e.sub_type === 'poke') {
        result.isPoke = true
        result.isGroup = !!e.group_id
        result.operator = e.operator_id || e.user_id
        result.target = e.target_id || e.target
        return result
    }
    
    // 通用检测：action='poke' 或事件名包含 poke
    if (e.action === 'poke' || e.raw_event?.includes?.('poke')) {
        result.isPoke = true
        result.isGroup = !!e.group_id
        result.operator = e.operator_id || e.user_id
        result.target = e.target_id || e.target
        return result
    }
    
    return result
}

/**
 * 检测表情回应事件
 * @param {Object} e - 事件对象
 * @returns {{ isReaction: boolean, messageId: string|number, userId: string|number, emojiId: string|number, emojiType?: string, count?: number, msgSenderId?: string|number }}
 */
export function detectReaction(e) {
    const result = { isReaction: false, messageId: null, userId: null, emojiId: null }
    
    // NapCat: notice_type='group_msg_emoji_like'
    if (e.notice_type === 'group_msg_emoji_like') {
        result.isReaction = true
        result.messageId = e.message_id
        result.userId = e.user_id
        result.msgSenderId = e.message_sender_id
        // NapCat likes 数组格式: [{emoji_id, count}]
        if (e.likes && Array.isArray(e.likes) && e.likes.length > 0) {
            result.emojiId = e.likes[0].emoji_id || e.likes[0].id
            result.count = e.likes[0].count
        }
        return result
    }
    
    // OneBot 扩展: sub_type='emoji_like' 或 'reaction'
    if (e.sub_type === 'emoji_like' || e.sub_type === 'reaction') {
        result.isReaction = true
        result.messageId = e.message_id
        result.userId = e.user_id || e.operator_id
        result.emojiId = e.emoji_id || e.face_id
        result.msgSenderId = e.target_id
        return result
    }
    
    // Lagrange / LLOneBot 格式
    if (e.notice_type === 'reaction') {
        result.isReaction = true
        result.messageId = e.message_id
        result.userId = e.user_id || e.operator_id
        result.emojiId = e.emoji?.id || e.emoji_id
        result.emojiType = e.emoji?.type
        result.msgSenderId = e.target_id
        return result
    }
    
    // 通用检测：有 emoji_id 和 message_id
    if (e.emoji_id !== undefined && e.message_id) {
        result.isReaction = true
        result.messageId = e.message_id
        result.userId = e.user_id || e.operator_id
        result.emojiId = e.emoji_id
        return result
    }
    
    return result
}

/**
 * 检测消息撤回事件
 * @param {Object} e - 事件对象
 * @returns {{ isRecall: boolean, isGroup: boolean, messageId: string|number, operatorId: string|number, userId?: string|number }}
 */
export function detectRecall(e) {
    const result = { isRecall: false, isGroup: false, messageId: null, operatorId: null }
    
    // NapCat / OneBot v11: notice_type='group_recall' / 'friend_recall'
    if (e.notice_type === 'group_recall') {
        result.isRecall = true
        result.isGroup = true
        result.messageId = e.message_id
        result.operatorId = e.operator_id
        result.userId = e.user_id
        return result
    }
    
    if (e.notice_type === 'friend_recall') {
        result.isRecall = true
        result.isGroup = false
        result.messageId = e.message_id
        result.operatorId = e.user_id
        result.userId = e.user_id
        return result
    }
    
    // icqq: notice_type='group'/'friend', sub_type='recall'
    if ((e.notice_type === 'group' || e.notice_type === 'friend') && e.sub_type === 'recall') {
        result.isRecall = true
        result.isGroup = e.notice_type === 'group'
        result.messageId = e.message_id || e.seq
        result.operatorId = e.operator_id || e.user_id
        result.userId = e.user_id
        return result
    }
    
    // TRSS-Yunzai
    if (e.post_type === 'notice' && e.sub_type === 'recall') {
        result.isRecall = true
        result.isGroup = !!e.group_id
        result.messageId = e.message_id
        result.operatorId = e.operator_id || e.user_id
        return result
    }
    
    return result
}

/**
 * 检测入群/退群事件
 * @param {Object} e - 事件对象
 * @returns {{ isMemberChange: boolean, type: 'increase'|'decrease'|null, userId: string|number, operatorId?: string|number, subType?: string }}
 */
export function detectMemberChange(e) {
    const result = { isMemberChange: false, type: null, userId: null }
    
    // NapCat / OneBot v11: notice_type='group_increase' / 'group_decrease'
    if (e.notice_type === 'group_increase') {
        result.isMemberChange = true
        result.type = 'increase'
        result.userId = e.user_id
        result.operatorId = e.operator_id
        result.subType = e.sub_type // 'approve'=管理员同意, 'invite'=被邀请
        return result
    }
    
    if (e.notice_type === 'group_decrease') {
        result.isMemberChange = true
        result.type = 'decrease'
        result.userId = e.user_id
        result.operatorId = e.operator_id
        result.subType = e.sub_type // 'leave'=主动退群, 'kick'=被踢, 'kick_me'=机器人被踢
        return result
    }
    
    // icqq: notice_type='group', sub_type='increase'/'decrease'
    if (e.notice_type === 'group' && (e.sub_type === 'increase' || e.sub_type === 'decrease')) {
        result.isMemberChange = true
        result.type = e.sub_type
        result.userId = e.user_id
        result.operatorId = e.operator_id
        return result
    }
    
    return result
}

/**
 * 检测运气王事件
 * @param {Object} e - 事件对象
 * @returns {{ isLuckyKing: boolean, userId: string|number, targetId: string|number }}
 */
export function detectLuckyKing(e) {
    const result = { isLuckyKing: false, userId: null, targetId: null }
    
    // NapCat / OneBot v11: notice_type='notify', sub_type='lucky_king'
    if (e.notice_type === 'notify' && e.sub_type === 'lucky_king') {
        result.isLuckyKing = true
        result.userId = e.user_id   // 红包发送者
        result.targetId = e.target_id  // 运气王
        return result
    }
    
    // icqq
    if (e.sub_type === 'lucky_king') {
        result.isLuckyKing = true
        result.userId = e.user_id
        result.targetId = e.target_id || e.target
        return result
    }
    
    return result
}

/**
 * 检测荣誉变更事件（龙王、群聊之火等）
 * @param {Object} e - 事件对象
 * @returns {{ isHonor: boolean, honorType: string, userId: string|number }}
 */
export function detectHonor(e) {
    const result = { isHonor: false, honorType: null, userId: null }
    
    // NapCat / OneBot v11: notice_type='notify', sub_type='honor'
    if (e.notice_type === 'notify' && e.sub_type === 'honor') {
        result.isHonor = true
        result.honorType = e.honor_type // 'talkative'=龙王, 'performer'=群聊之火, 'emotion'=快乐源泉
        result.userId = e.user_id
        return result
    }
    
    // icqq
    if (e.sub_type === 'honor') {
        result.isHonor = true
        result.honorType = e.honor_type
        result.userId = e.user_id
        return result
    }
    
    return result
}

/**
 * 检测精华消息事件
 * @param {Object} e - 事件对象
 * @returns {{ isEssence: boolean, type: 'add'|'delete'|null, messageId: string|number, senderId: string|number, operatorId: string|number }}
 */
export function detectEssence(e) {
    const result = { isEssence: false, type: null, messageId: null }
    
    // NapCat / OneBot v11
    if (e.notice_type === 'essence') {
        result.isEssence = true
        result.type = e.sub_type // 'add' 或 'delete'
        result.messageId = e.message_id
        result.senderId = e.sender_id
        result.operatorId = e.operator_id
        return result
    }
    
    // 部分适配器使用 notify
    if (e.notice_type === 'notify' && e.sub_type === 'essence') {
        result.isEssence = true
        result.type = e.action || 'add'
        result.messageId = e.message_id
        result.senderId = e.sender_id
        result.operatorId = e.operator_id
        return result
    }
    
    return result
}

/**
 * 检测群管理员变动事件
 * @param {Object} e - 事件对象
 * @returns {{ isAdminChange: boolean, type: 'set'|'unset'|null, userId: string|number }}
 */
export function detectAdminChange(e) {
    const result = { isAdminChange: false, type: null, userId: null }
    
    // NapCat / OneBot v11: notice_type='group_admin'
    if (e.notice_type === 'group_admin') {
        result.isAdminChange = true
        result.type = e.sub_type // 'set' 或 'unset'
        result.userId = e.user_id
        return result
    }
    
    // icqq
    if (e.notice_type === 'group' && e.sub_type === 'admin') {
        result.isAdminChange = true
        result.type = e.set ? 'set' : 'unset'
        result.userId = e.user_id
        return result
    }
    
    return result
}

/**
 * 检测群禁言事件
 * @param {Object} e - 事件对象
 * @returns {{ isBan: boolean, type: 'ban'|'lift_ban'|null, userId: string|number, operatorId: string|number, duration: number }}
 */
export function detectBan(e) {
    const result = { isBan: false, type: null, userId: null, duration: 0 }
    
    // NapCat / OneBot v11: notice_type='group_ban'
    if (e.notice_type === 'group_ban') {
        result.isBan = true
        result.type = e.sub_type // 'ban' 或 'lift_ban'
        result.userId = e.user_id
        result.operatorId = e.operator_id
        result.duration = e.duration || 0
        return result
    }
    
    // icqq
    if (e.notice_type === 'group' && (e.sub_type === 'ban' || e.sub_type === 'lift_ban')) {
        result.isBan = true
        result.type = e.sub_type
        result.userId = e.user_id
        result.operatorId = e.operator_id
        result.duration = e.duration || 0
        return result
    }
    
    return result
}

/**
 * 检测文件上传事件
 * @param {Object} e - 事件对象
 * @returns {{ isFileUpload: boolean, isGroup: boolean, file: Object, userId: string|number }}
 */
export function detectFileUpload(e) {
    const result = { isFileUpload: false, isGroup: false, file: null }
    
    // NapCat / OneBot v11: notice_type='group_upload' / 'offline_file'
    if (e.notice_type === 'group_upload') {
        result.isFileUpload = true
        result.isGroup = true
        result.file = e.file
        result.userId = e.user_id
        return result
    }
    
    if (e.notice_type === 'offline_file') {
        result.isFileUpload = true
        result.isGroup = false
        result.file = e.file
        result.userId = e.user_id
        return result
    }
    
    // icqq
    if (e.sub_type === 'upload') {
        result.isFileUpload = true
        result.isGroup = !!e.group_id
        result.file = e.file
        result.userId = e.user_id
        return result
    }
    
    return result
}

/**
 * 表情ID到描述的映射表（QQ表情）
 */
export const EMOJI_MAP = {
    '1': '撇嘴', '2': '色', '3': '发呆', '4': '得意', '5': '流泪',
    '6': '害羞', '7': '闭嘴', '8': '睡', '9': '大哭', '10': '尴尬',
    '11': '发怒', '12': '调皮', '13': '呲牙', '14': '微笑', '15': '难过',
    '16': '酷', '21': '可爱', '23': '傲慢', '24': '饥饿', '25': '困',
    '26': '惊恐', '27': '流汗', '28': '憨笑', '29': '悠闲', '30': '奋斗',
    '31': '咒骂', '32': '疑问', '33': '嘘', '34': '晕', '35': '折磨',
    '36': '衰', '37': '骷髅', '38': '敲打', '39': '再见', '42': '鼓掌',
    '53': '蛋糕', '60': '咖啡', '63': '玫瑰', '64': '凋谢', '66': '爱心',
    '67': '心碎', '74': '太阳', '75': '月亮', '76': '赞', '77': '踩',
    '78': '握手', '79': '胜利', '85': '飞吻', '89': '西瓜', '96': '冷汗',
    '97': '擦汗', '98': '抠鼻', '99': '鼓掌', '100': '糗大了', '101': '坏笑',
    '102': '左哼哼', '103': '右哼哼', '104': '哈欠', '105': '鄙视', '106': '委屈',
    '107': '快哭了', '108': '阴险', '109': '亲亲', '110': '吓', '111': '可怜',
    '112': '菜刀', '113': '啤酒', '114': '篮球', '115': '乒乓', '116': '示爱',
    '117': '瓢虫', '118': '抱拳', '119': '勾引', '120': '拳头', '121': '差劲',
    '122': '爱你', '123': 'NO', '124': 'OK', '125': '转圈', '126': '磕头',
    '127': '回头', '128': '跳绳', '129': '挥手', '130': '激动', '131': '街舞',
    '132': '献吻', '133': '左太极', '134': '右太极', '136': '双喜', '137': '鞭炮',
    '138': '灯笼', '140': 'K歌', '144': '喝彩', '145': '祈祷', '146': '爆筋',
    '147': '棒棒糖', '148': '喝奶', '168': '药', '169': '手枪', '171': '茶',
    '172': '眨眼睛', '173': '泪奔', '174': '无奈', '175': '卖萌', '176': '小纠结',
    '177': '喷血', '178': '斜眼笑', '179': 'doge', '180': '惊喜', '181': '骚扰',
    '182': '笑哭', '183': '我最美', '184': '河蟹', '185': '羊驼', '187': '幽灵',
    '188': '蛋', '190': '菊花', '192': '红包', '193': '大笑', '194': '不开心',
    '197': '冷漠', '198': '呃', '199': '好棒', '200': '拜托', '201': '点赞',
    '202': '无聊', '203': '托脸', '204': '吃', '205': '送花', '206': '害怕',
    '207': '花痴', '208': '小样儿', '210': '飙泪', '211': '我不看', '212': '托腮',
    '214': '啵啵', '215': '糊脸', '216': '拍头', '217': '扯一扯', '218': '舔一舔',
    '219': '蹭一蹭', '220': '拽炸天', '221': '顶呱呱', '222': '抱抱', '223': '暴击',
    '224': '开枪', '225': '撩一撩', '226': '拍桌', '227': '拍手', '228': '恭喜',
    '229': '干杯', '230': '嘲讽', '231': '哼', '232': '佛系', '233': '掐一掐',
    '234': '惊呆', '235': '颤抖', '236': '啃头', '237': '偷看', '238': '扇脸',
    '239': '原谅', '240': '喷脸', '241': '生日快乐', '242': '头撞击', '243': '甩头',
    '244': '扔狗', '245': '加油必胜', '246': '加油抱抱', '247': '口罩护体',
    '260': '搬砖中', '261': '忙到飞起', '262': '脑阔疼', '263': '沧桑', '264': '捂脸',
    '265': '辣眼睛', '266': '哦哟', '267': '头秃', '268': '问号脸', '269': '暗中观察',
    '270': 'emm', '271': '吃瓜', '272': '呵呵哒', '273': '我酸了', '274': '太南了',
    '276': '汪汪', '277': '火', '278': '冰', '279': '落叶', '280': '彩虹',
    '281': '雪花', '282': '流星', '283': '放炮', '284': '拥抱', '285': '加一',
    '286': '一言难尽', '287': '右亲亲', '288': '牛啊', '289': '奋斗', '290': '点赞(加粗)',
    '291': '撇嘴(加粗)', '292': '害羞(加粗)', '293': '睡觉', '294': '咬手绢',
    '295': '让我看看', '296': '敬礼', '297': '斜眼笑', '298': '喵喵', '299': '恰饭',
    '300': '顶', '301': '哈哈', '302': '委屈', '303': '太强了', '304': '热恋',
    '305': '打工人', '306': '666', '307': '摇摆', '308': '豹富', '309': '花朵脸',
    '310': '我想开了', '311': '舔屏', '312': '热化了', '313': '可', '314': '老铁没毛病',
    '315': '真香', '316': '裂开', '317': '芬芳', '318': '嘿嘿嘿', '319': '社会社会',
    '320': '抱歉', '321': '蜡烛', '322': '球球', '323': '大侦探', '324': '菜狗',
    '325': '狗狗问', '326': '脸红', '327': '悄悄话', '328': '心跳', '329': '打卡',
    '330': '胜利'
}

/**
 * 获取表情描述
 * @param {string|number} emojiId - 表情ID
 * @returns {string} 表情描述
 */
export function getEmojiDescription(emojiId) {
    return EMOJI_MAP[String(emojiId)] || `表情[${emojiId}]`
}

/**
 * 荣誉类型映射
 */
export const HONOR_TYPE_MAP = {
    'talkative': '龙王',
    'performer': '群聊之火',
    'emotion': '快乐源泉',
    'legend': '群聊传说',
    'strong_newbie': '冒尖小春笋'
}

/**
 * 获取荣誉描述
 * @param {string} honorType 
 * @returns {string}
 */
export function getHonorDescription(honorType) {
    return HONOR_TYPE_MAP[honorType] || honorType || '未知荣誉'
}
