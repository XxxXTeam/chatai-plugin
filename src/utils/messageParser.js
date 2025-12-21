/**
 * 消息解析工具
 * 兼容多种协议:
 * - icqq: Yunzai默认协议
 * - NapCat(NC): https://napneko.github.io/develop/msg
 * - OneBot v11: https://github.com/botuniverse/onebot-11
 * - go-cqhttp: https://docs.go-cqhttp.org/cqcode
 * 
 * 支持的消息类型:
 * - text: 文本消息
 * - image: 图片消息
 * - face: QQ表情
 * - at: @消息
 * - reply: 引用消息
 * - forward: 转发消息
 * - json: JSON卡片
 * - xml: XML消息
 * - record: 语音消息
 * - video: 视频消息
 * - file: 文件消息
 * - share: 链接分享
 * - location: 位置分享
 * - music: 音乐分享
 * - poke: 戳一戳
 * - mface: 商城表情
 * - markdown: Markdown消息
 */

/**
 * 统一获取消息段数据 - 兼容 NC/icqq/OneBot 格式
 * NC/OneBot格式: { type: 'image', data: { url: '...', file: '...' } }
 * icqq格式: { type: 'image', url: '...', file: '...' }
 * @param {Object} segment - 消息段
 * @returns {Object} 统一的数据对象
 */
function getSegmentData(segment) {
    if (!segment) return {}
    // NC/OneBot 格式: 数据在 data 字段中
    if (segment.data && typeof segment.data === 'object') {
        return { ...segment.data, _type: segment.type }
    }
    // icqq 格式: 数据直接在 segment 上
    return segment
}

/**
 * 获取图片/视频/文件的URL
 * 兼容 NC/NapCat/icqq/OneBot 多种格式
 * 
 * NapCat image 格式:
 * { type: 'image', data: { file, file_id, url, path, file_size, file_unique, sub_type } }
 * 
 * @param {Object} data - 消息段数据
 * @param {boolean} debug - 是否输出调试日志
 * @returns {string|null} URL
 */
function getMediaUrl(data, debug = false) {
    if (!data) return null
    const innerData = data.data || data
    
    if (debug) {
        logger.debug('[getMediaUrl] 输入数据:', JSON.stringify({
            hasData: !!data.data,
            keys: Object.keys(data),
            innerKeys: Object.keys(innerData),
            url: innerData.url,
            file: innerData.file,
            path: innerData.path,
            file_id: innerData.file_id
        }))
    }
    const urlCandidates = [
        innerData.url,
        data.url,
        innerData.path,
        data.path,
        innerData.file,
        data.file,
        innerData.file_url,
        data.file_url,
        innerData.download_url,
        data.download_url,
        innerData.image,
        data.image,
    ]
    
    for (const candidate of urlCandidates) {
        if (candidate && typeof candidate === 'string') {
            if (candidate.startsWith('http://') || candidate.startsWith('https://')) {
                if (debug) logger.debug(`[getMediaUrl] 找到 HTTP URL: ${candidate.substring(0, 80)}...`)
                return candidate
            }
            if (candidate.startsWith('base64://')) {
                if (debug) logger.debug('[getMediaUrl] 找到 base64 数据')
                return candidate
            }
            if (candidate.startsWith('file://')) {
                if (debug) logger.debug(`[getMediaUrl] 找到 file:// 路径: ${candidate}`)
                return candidate
            }
            if (candidate.startsWith('/') || candidate.match(/^[A-Za-z]:\\/)) {
                if (debug) logger.debug(`[getMediaUrl] 找到本地路径: ${candidate}`)
                return `file://${candidate}`
            }
        }
    }
    
    if (debug) {
        logger.warn('[getMediaUrl] 未找到有效 URL，原始数据:', JSON.stringify(data).substring(0, 500))
    }
    
    return null
}

/**
 * 将 Yunzai 事件消息转换为统一的用户消息格式
 * @param {Object} e - Yunzai 事件对象
 * @param {Object} options - 解析选项
 * @returns {Promise<{role: 'user', content: Array}>}
 */
export async function parseUserMessage(e, options = {}) {
    const {
        handleReplyText = true,
        handleReplyImage = true,
        handleReplyFile = true,
        handleForward = true,
        handleAtMsg = true,
        excludeAtBot = true,
        useRawMessage = false,
        triggerMode = 'at',
        triggerPrefix = '',
        includeDebugInfo = false,      // 是否包含调试信息
        includeSenderInfo = true       // 是否包含发送者信息
    } = options

    const contents = []
    let text = ''
    let quoteInfo = null
    let forwardInfo = null
    
    // 调试信息收集
    const debugInfo = includeDebugInfo ? {
        originalMessage: e.message,
        rawMessage: e.raw_message,
        hasSource: !!e.source,
        hasForward: false,
        parseSteps: [],
        errors: []
    } : null

    // 处理引用消息
    if ((e.source || e.reply_id) && (handleReplyImage || handleReplyText || handleReplyFile)) {
        if (debugInfo) debugInfo.parseSteps.push('解析引用消息')
        try {
            const replyResult = await parseReplyMessage(e, {
                handleReplyText,
                handleReplyImage,
                handleReplyFile,
                handleForward
            })
            
            if (replyResult.text) {
                text = replyResult.text
            }
            contents.push(...replyResult.contents)
            quoteInfo = replyResult.quoteInfo
            
            if (debugInfo) {
                debugInfo.quoteResult = {
                    hasText: !!replyResult.text,
                    textLength: replyResult.text?.length || 0,
                    contentsCount: replyResult.contents.length,
                    quoteSender: quoteInfo?.sender
                }
            }
        } catch (err) {
            if (debugInfo) debugInfo.errors.push(`引用消息解析失败: ${err.message}`)
            logger.warn('[MessageParser] 引用消息解析失败:', err.message)
        }
    }

    // 处理当前消息
    if (useRawMessage) {
        text += e.raw_message || ''
    } else {
        for (const val of e.message || []) {
            // 统一获取消息段数据，兼容 NC 和 icqq 格式
            const segData = getSegmentData(val)
            const segType = val.type || segData._type || ''
            
            switch (segType) {
                case 'at': {
                    if (handleAtMsg) {
                        const qq = segData.qq || val.qq || segData.data?.qq
                        const atCard = segData.text || val.text || segData.data?.text || segData.name || ''
                        const uid = segData.uid || val.uid || segData.data?.uid || ''
                        
                        logger.debug(`[MessageParser][AT] 解析@消息: qq=${qq}, atCard=${atCard}, excludeAtBot=${excludeAtBot}, self_id=${e.self_id}`)
                        
                        // 如果是@机器人且需要排除，跳过
                        if (excludeAtBot && (qq === e.bot?.uin || String(qq) === String(e.self_id))) {
                            continue
                        }
                        let memberInfo = null
                        let groupCard = ''
                        let nickname = atCard || ''
                        let role = ''
                        let title = ''
                        if (e.group_id && qq && qq !== 'all') {
                            logger.debug(`[MessageParser][AT] 开始获取群成员信息: group_id=${e.group_id}, qq=${qq}`)
                            try {
                                const bot = e.bot || global.Bot
                                if (bot) {
                                    const group = bot.pickGroup?.(e.group_id)
                                    if (group) {
                                        // 尝试获取成员信息
                                        const member = group.pickMember?.(parseInt(qq))
                                        logger.debug(`[MessageParser][AT] pickMember 结果: hasInfo=${!!member?.info}`)
                                        if (member?.info) {
                                            memberInfo = member.info
                                            groupCard = memberInfo.card || ''
                                            nickname = memberInfo.nickname || nickname
                                            role = memberInfo.role || ''
                                            title = memberInfo.title || ''
                                            logger.debug(`[MessageParser][AT] 从 pickMember 获取: card=${groupCard}, nickname=${nickname}, role=${role}`)
                                        }
                                        if (!memberInfo && group.getMemberMap) {
                                            try {
                                                logger.debug(`[MessageParser][AT] 尝试 getMemberMap`)
                                                const memberMap = await group.getMemberMap()
                                                const memberData = memberMap?.get?.(parseInt(qq))
                                                if (memberData) {
                                                    groupCard = memberData.card || ''
                                                    nickname = memberData.nickname || nickname
                                                    role = memberData.role || ''
                                                    title = memberData.title || ''
                                                    logger.debug(`[MessageParser][AT] 从 getMemberMap 获取: card=${groupCard}, nickname=${nickname}, role=${role}`)
                                                }
                                            } catch (err) {
                                                logger.debug(`[MessageParser][AT] getMemberMap 失败: ${err.message}`)
                                            }
                                        }
                                    }
                                }
                            } catch (err) {
                                // 获取群成员信息失败，使用默认值
                                logger.warn(`[MessageParser][AT] 获取群成员信息失败: ${err.message}`)
                            }
                        }
                        
                        // 构建清晰的显示名称（优先使用群名片）
                        const displayName = groupCard || nickname || atCard || `用户${qq}`
                        
                        // 增强的文本格式：提供完整的用户身份信息，避免模型虚构
                        // 格式：[提及用户 QQ:xxx 群名片:xxx 昵称:xxx]
                        let atText = `[提及用户 QQ:${qq}`
                        if (groupCard) atText += ` 群名片:"${groupCard}"`
                        if (nickname && nickname !== groupCard) atText += ` 昵称:"${nickname}"`
                        if (role && role !== 'member') atText += ` 角色:${role === 'owner' ? '群主' : role === 'admin' ? '管理员' : role}`
                        if (title) atText += ` 头衔:"${title}"`
                        atText += ']'
                        
                        logger.debug(`[MessageParser][AT] 最终文本: ${atText}`)
                        text += ` ${atText} `
                        
                        // 结构化信息：添加到 contents 中供工具使用
                        contents.push({
                            type: 'at_info',
                            at: {
                                qq: String(qq),
                                uid: uid ? String(uid) : '',
                                name: atCard || '',
                                display: displayName,
                                // 增强字段：群成员详细信息
                                card: groupCard,
                                nickname: nickname,
                                role: role,
                                title: title
                            }
                        })
                    }
                    break
                }
                
                case 'text': {
                    const textContent = segData.text || val.text || ''
                    text += textContent
                    break
                }
                
                case 'image': {
                    // 调试日志：记录原始消息段
                    logger.debug('[MessageParser][Image] 原始消息段:', JSON.stringify({
                        type: val.type,
                        hasData: !!val.data,
                        segDataKeys: Object.keys(segData),
                        url: segData.url,
                        file: segData.file,
                        path: segData.path,
                        file_id: segData.file_id,
                        file_unique: segData.file_unique
                    }))
                    
                    let imgUrl = getMediaUrl(segData, true) || val.url
                    if (!imgUrl && segData.file_id && e.bot?.sendApi) {
                        try {
                            logger.debug(`[MessageParser][Image] 尝试通过 file_id 获取: ${segData.file_id}`)
                            const fileInfo = await e.bot.sendApi('get_image', { file_id: segData.file_id })
                            imgUrl = fileInfo?.data?.url || fileInfo?.url
                            if (imgUrl) {
                                logger.debug(`[MessageParser][Image] 通过 get_image 获取成功: ${imgUrl.substring(0, 80)}...`)
                            }
                        } catch (err) {
                            logger.warn(`[MessageParser][Image] get_image API 失败:`, err.message)
                        }
                    }
                    
                    // 如果还是没有，尝试通过 file 字段获取 (可能是文件名或ID)
                    if (!imgUrl && segData.file && e.bot?.sendApi) {
                        try {
                            logger.debug(`[MessageParser][Image] 尝试通过 file 获取: ${segData.file}`)
                            const fileInfo = await e.bot.sendApi('get_image', { file: segData.file })
                            imgUrl = fileInfo?.data?.url || fileInfo?.url
                            if (imgUrl) {
                                logger.debug(`[MessageParser][Image] 通过 get_image(file) 获取成功: ${imgUrl.substring(0, 80)}...`)
                            }
                        } catch (err) {
                            logger.debug(`[MessageParser][Image] get_image(file) 失败:`, err.message)
                        }
                    }
                    
                    logger.debug(`[MessageParser][Image] 最终 URL: ${imgUrl || '无'}`)
                    
                    if (imgUrl) {
                        try {
                            if (imgUrl.startsWith('http')) {
                                contents.push({
                                    type: 'image_url',
                                    image_url: { url: imgUrl },
                                    source: 'message'
                                })
                            } else if (imgUrl.startsWith('file://') || imgUrl.startsWith('/')) {
                                const imageData = await fetchImage(imgUrl)
                                if (imageData) {
                                    contents.push({
                                        type: 'image',
                                        image: imageData.base64,
                                        mimeType: imageData.mimeType
                                    })
                                }
                            } else if (imgUrl.startsWith('base64://')) {
                                contents.push({
                                    type: 'image',
                                    image: imgUrl.replace('base64://', ''),
                                    mimeType: 'image/png'
                                })
                            } else {
                                const imageData = await fetchImage(imgUrl)
                                if (imageData) {
                                    contents.push({
                                        type: 'image',
                                        image: imageData.base64,
                                        mimeType: imageData.mimeType
                                    })
                                }
                            }
                        } catch (err) {
                            logger.warn(`[MessageParser][Image] 获取图片失败: ${imgUrl}`, err.message)
                            text += `[图片:${imgUrl.substring(0, 50)}...]`
                        }
                    } else {
                        const debugInfo = segData.file_id || segData.file || segData.file_unique || '未知'
                        text += `[图片:${debugInfo}]`
                        logger.warn('[MessageParser][Image] 无法获取图片URL，原始数据:', JSON.stringify(val).substring(0, 300))
                    }
                    break
                }
                
                case 'face': {
                    const faceId = segData.id || val.id || ''
                    text += `[表情:${faceId}]`
                    break
                }
                case 'file': {
                    // 文件信息
                    const fileName = segData.name || val.name || segData.fid || val.fid || '未知文件'
                    const fileUrl = getMediaUrl(segData)
                    text += `[文件:${fileName}${fileUrl ? ' URL:' + fileUrl : ''}]`
                    break
                }
                case 'json':
                    try {
                        const jsonData = JSON.parse(val.data)
                        if (jsonData.app === 'com.tencent.multimsg' && handleForward) {
                            if (debugInfo) debugInfo.parseSteps.push('解析JSON合并转发消息')
                            try {
                                const resid = jsonData.meta?.detail?.resid
                                if (resid && e.group?.getForwardMsg) {
                                    const forwardResult = await parseForwardMessage(e, { id: resid, resid })
                                    if (forwardResult.text) {
                                        text += forwardResult.text
                                    }
                                    contents.push(...forwardResult.contents)
                                    forwardInfo = forwardResult.forwardInfo
                                    if (debugInfo) debugInfo.hasForward = true
                                } else {
                                    // 无法获取内容，使用预览信息
                                    const preview = jsonData.meta?.detail?.news?.map(n => n.text).join('\n') || ''
                                    const summary = jsonData.meta?.detail?.summary || jsonData.prompt || '[聊天记录]'
                                    text += `[转发消息: ${summary}]\n${preview ? '预览: ' + preview : ''}`
                                }
                            } catch (err) {
                                if (debugInfo) debugInfo.errors.push(`JSON转发解析失败: ${err.message}`)
                                // 回退到预览信息
                                const preview = jsonData.meta?.detail?.news?.map(n => n.text).join('\n') || ''
                                text += `[转发消息]${preview ? '\n预览: ' + preview : ''}`
                            }
                        } else {
                            // 其他 JSON 卡片
                            text += `[卡片消息:${jsonData.prompt || jsonData.desc || 'JSON'}]`
                        }
                    } catch {
                        text += '[卡片消息]'
                    }
                    // 存储原始JSON数据到contents中，供工具使用
                    contents.push({
                        type: 'json_card',
                        data: segData.data || segData,
                        prompt: '如需转发此卡片，请使用resend_quoted_card工具'
                    })
                    break
                
                case 'xml':
                    // XML 消息
                    text += '[XML消息]'
                    break
                
                case 'forward':
                    // 转发消息
                    if (handleForward) {
                        if (debugInfo) debugInfo.parseSteps.push('解析转发消息')
                        try {
                            const forwardResult = await parseForwardMessage(e, val)
                            if (forwardResult.text) {
                                text += forwardResult.text
                            }
                            contents.push(...forwardResult.contents)
                            forwardInfo = forwardResult.forwardInfo
                            if (debugInfo) debugInfo.hasForward = true
                        } catch (err) {
                            if (debugInfo) debugInfo.errors.push(`转发消息解析失败: ${err.message}`)
                            text += '[转发消息]'
                        }
                    }
                    break
                
                case 'reply':
                    // 引用标记 - 已在上面处理，跳过
                    break
                
                case 'record': {
                    // 语音消息 - 尝试获取URL
                    const recordUrl = getMediaUrl(segData)
                    const recordName = segData.name || val.name || ''
                    text += `[语音${recordName ? ':' + recordName : ''}${recordUrl ? ' URL:' + recordUrl : ''}]`
                    break
                }
                
                case 'video': {
                    // 视频消息 - 获取URL信息
                    const videoUrl = getMediaUrl(segData)
                    const videoName = segData.name || val.name || ''
                    const videoThumb = segData.thumb || val.thumb || ''
                    if (videoUrl) {
                        // 将视频URL作为文本描述传递给AI
                        text += `[视频${videoName ? ':' + videoName : ''} URL:${videoUrl}]`
                        // 同时添加视频信息到contents
                        contents.push({
                            type: 'video_info',
                            url: videoUrl,
                            name: videoName,
                            thumb: videoThumb,
                            source: 'message'
                        })
                    } else {
                        text += `[视频${videoName ? ':' + videoName : ''}]`
                    }
                    break
                }
                
                case 'poke': {
                    // 戳一戳消息
                    const pokeType = segData.type || segData.poke_type || val.type || ''
                    const pokeId = segData.id || val.id || ''
                    const pokeName = segData.name || val.name || ''
                    const pokeStrength = segData.strength || val.strength || ''
                    
                    let pokeText = '[戳一戳'
                    if (pokeName) pokeText += `:${pokeName}`
                    else if (pokeType) pokeText += `:类型${pokeType}`
                    if (pokeStrength) pokeText += ` 力度:${pokeStrength}`
                    pokeText += ']'
                    text += pokeText
                    
                    // 添加结构化数据
                    contents.push({
                        type: 'poke_info',
                        poke: {
                            type: pokeType,
                            id: pokeId,
                            name: pokeName,
                            strength: pokeStrength
                        }
                    })
                    break
                }
                
                case 'share': {
                    // 链接分享
                    const shareTitle = segData.title || val.title || ''
                    const shareUrl = segData.url || val.url || ''
                    text += `[分享:${shareTitle || shareUrl || '链接'}]`
                    break
                }
                
                case 'location': {
                    // 位置分享
                    const locName = segData.name || val.name || ''
                    const locAddr = segData.address || val.address || ''
                    text += `[位置:${locName || locAddr || '位置'}]`
                    break
                }
                
                case 'music': {
                    // 音乐分享
                    const musicTitle = segData.title || val.title || ''
                    text += `[音乐:${musicTitle || '音乐'}]`
                    break
                }
                
                case 'mface': {
                    // 商城表情 (NC/OneBot)
                    const mfaceName = segData.summary || segData.text || val.summary || ''
                    text += `[商城表情${mfaceName ? ':' + mfaceName : ''}]`
                    break
                }
                
                case 'dice': {
                    // 骰子
                    const diceResult = segData.result || segData.value || val.result || val.value || '?'
                    text += `[骰子:点数${diceResult}]`
                    contents.push({ type: 'dice_info', result: diceResult })
                    break
                }
                
                case 'new_dice': {
                    // 新版骰子 (NC)
                    const newDiceResult = segData.result || segData.value || val.result || '?'
                    text += `[骰子:点数${newDiceResult}]`
                    contents.push({ type: 'dice_info', result: newDiceResult, version: 'new' })
                    break
                }
                
                case 'rps': {
                    // 猜拳
                    const rpsResult = segData.result || segData.value || val.result || '?'
                    const rpsMap = { '0': '石头', '1': '石头', '2': '剪刀', '3': '布', '4': '剪刀', '5': '布' }
                    const rpsName = rpsMap[rpsResult] || rpsResult
                    text += `[猜拳:${rpsName}]`
                    contents.push({ type: 'rps_info', result: rpsResult, name: rpsName })
                    break
                }
                
                case 'new_rps': {
                    // 新版猜拳 (NC)
                    const newRpsResult = segData.result || segData.value || val.result || '?'
                    const newRpsMap = { '0': '石头', '1': '石头', '2': '剪刀', '3': '布' }
                    const newRpsName = newRpsMap[newRpsResult] || newRpsResult
                    text += `[猜拳:${newRpsName}]`
                    contents.push({ type: 'rps_info', result: newRpsResult, name: newRpsName, version: 'new' })
                    break
                }
                
                case 'markdown': {
                    // Markdown消息 (NC)
                    const mdContent = segData.content || segData.text || val.content || ''
                    if (mdContent) {
                        text += mdContent
                    } else {
                        text += '[Markdown消息]'
                    }
                    break
                }
                
                case 'contact': {
                    // 推荐联系人/群
                    const contactType = segData.type || val.type || 'qq'
                    const contactId = segData.id || val.id || ''
                    text += `[推荐${contactType === 'group' ? '群' : '好友'}:${contactId}]`
                    break
                }
                
                case 'node': {
                    // 转发节点 (在forward中使用)
                    // 通常不单独出现，跳过
                    break
                }
                
                case 'gift': {
                    // 礼物
                    const giftId = segData.id || val.id || ''
                    const giftQq = segData.qq || val.qq || ''
                    text += `[礼物${giftId ? ':' + giftId : ''}${giftQq ? ' 给:' + giftQq : ''}]`
                    break
                }
                
                case 'shake': {
                    // 窗口抖动
                    text += '[窗口抖动]'
                    break
                }
                
                case 'anonymous': {
                    // 匿名消息标记
                    const anonIgnore = segData.ignore || val.ignore || '0'
                    text += anonIgnore === '1' ? '[匿名(强制)]' : '[匿名]'
                    break
                }
                
                case 'basketball': {
                    // 篮球表情
                    const basketResult = segData.result || val.result || '?'
                    text += `[篮球:${basketResult}]`
                    break
                }
                
                case 'bubble_face': {
                    // 气泡表情
                    const bubbleId = segData.id || val.id || ''
                    const bubbleCount = segData.count || val.count || '1'
                    text += `[气泡表情:${bubbleId}${bubbleCount > 1 ? ' x' + bubbleCount : ''}]`
                    break
                }
                
                case 'tts': {
                    // TTS 语音
                    const ttsText = segData.text || val.text || ''
                    text += `[TTS语音:${ttsText.substring(0, 50)}${ttsText.length > 50 ? '...' : ''}]`
                    break
                }
                
                case 'touch': {
                    // 触摸/拍一拍
                    const touchId = segData.id || val.id || ''
                    text += `[拍一拍${touchId ? ':' + touchId : ''}]`
                    break
                }
                
                case 'weather': {
                    // 天气
                    const city = segData.city || val.city || ''
                    text += `[天气${city ? ':' + city : ''}]`
                    break
                }
                
                default: {
                    // 未知类型 - 记录但不报错
                    if (segType && segType !== 'reply' && segType !== 'source') {
                        text += `[${segType}]`
                        if (debugInfo) {
                            debugInfo.parseSteps.push(`未知消息类型: ${segType}`)
                        }
                    }
                    break
                }
            }
        }
    }

    // 处理前缀模式下的文本清理
    if (triggerMode === 'prefix' && triggerPrefix) {
        const prefixRegex = new RegExp(`^#?(图片)?${escapeRegex(triggerPrefix)}`)
        text = text.replace(prefixRegex, '')
    }

    // 清理CQ码并添加文本内容
    const cleanedText = cleanCQCode(text)
    if (cleanedText) {
        contents.push({
            type: 'text',
            text: cleanedText
        })
    }

    // 构建返回结果
    const result = {
        role: 'user',
        content: contents
    }
    
    // 添加发送者信息 (用于多用户上下文区分)
    if (includeSenderInfo) {
        result.sender = extractSender(e)
        result.timestamp = e.time ? e.time * 1000 : Date.now()
        result.source_type = e.isGroup || e.group_id ? 'group' : 'private'
        if (e.group_id) result.group_id = e.group_id
        if (e.message_id) result.message_id = e.message_id
    }
    
    // 添加引用/转发信息
    if (quoteInfo) result.quote = quoteInfo
    if (forwardInfo) result.forward = forwardInfo
    
    // 提取 @ 用户列表（方便工具直接使用）
    const atInfos = contents.filter(c => c.type === 'at_info')
    if (atInfos.length > 0) {
        result.atList = atInfos.map(c => c.at)
    }
    
    // 添加调试信息
    if (debugInfo) {
        debugInfo.parseSteps.push('解析完成')
        debugInfo.finalTextLength = contents.filter(c => c.type === 'text').map(c => c.text?.length || 0).reduce((a, b) => a + b, 0)
        debugInfo.finalContentsCount = contents.length
        debugInfo.atCount = atInfos.length
        result.debug = debugInfo
    }
    
    return result
}

/**
 * 提取发送者信息 (icqq/TRSS 兼容)
 * @param {Object} e - 事件对象
 * @returns {Object} 发送者信息
 */
function extractSender(e) {
    const sender = e.sender || {}
    return {
        user_id: e.user_id || sender.user_id || 0,
        nickname: sender.nickname || e.nickname || '未知用户',
        card: sender.card || '',                    // 群名片
        role: sender.role || 'member',              // owner/admin/member
        level: sender.level || 0,                   // 群等级
        title: sender.title || '',                  // 专属头衔
        user_uid: sender.user_uid || e.user_uid || ''  // QQNT uid
    }
}

/**
 * 解析引用消息
 * 支持多平台: icqq, NapCat(NC), TRSS 等
 */
async function parseReplyMessage(e, options) {
    const { handleReplyText, handleReplyImage, handleReplyFile, handleForward } = options
    const contents = []
    let text = ''
    const parseLog = [] // 解析日志

    try {
        let replyData = null
        let replySenderId = null
        let replySenderName = null

        parseLog.push(`[Reply] 开始解析引用消息, hasSource=${!!e.source}, hasGetReply=${typeof e.getReply === 'function'}`)

        // 方式1: 使用 e.getReply() (TRSS/部分平台)
        if (e.getReply && typeof e.getReply === 'function') {
            try {
                parseLog.push(`[Reply] 尝试 e.getReply()`)
                const reply = await e.getReply()
                if (reply) {
                    replyData = reply
                    // 兼容 NC 格式: reply.data 或直接 reply
                    const replyInfo = reply.data || reply
                    replySenderId = replyInfo.user_id || replyInfo.sender?.user_id || reply.user_id
                    replySenderName = replyInfo.sender?.card || replyInfo.sender?.nickname || 
                                      replyInfo.nickname || reply.nickname
                    parseLog.push(`[Reply] e.getReply() 成功, sender=${replySenderId}`)
                }
            } catch (err) {
                parseLog.push(`[Reply] e.getReply() 失败: ${err.message}`)
            }
        }
        
        // 方式2: 从 e.source 获取并通过 API 拉取完整消息
        if (!replyData && e.source) {
            parseLog.push(`[Reply] 尝试从 e.source 获取, seq=${e.source.seq}, message_id=${e.source.message_id}`)
            
            // NC/NapCat 使用 message_id, icqq 使用 seq
            const msgId = e.source.message_id || e.source.id
            const seq = e.isGroup 
                ? (e.source.seq || msgId || e.reply_id) 
                : (e.source.time || e.source.seq)
            
            if (seq || msgId) {
                // 群聊
                if (e.isGroup || e.group_id) {
                    // NC/NapCat: 优先使用 bot.getMsg (message_id)
                    if (!replyData && e.bot?.getMsg && msgId) {
                        try {
                            parseLog.push(`[Reply] 尝试 bot.getMsg(message_id=${msgId})`)
                            replyData = await e.bot.getMsg(msgId)
                            if (replyData) parseLog.push(`[Reply] bot.getMsg(message_id) 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] bot.getMsg(message_id) 失败: ${err.message}`)
                        }
                    }
                    
                    // NC/NapCat: 尝试 get_msg API (OneBot标准)
                    if (!replyData && e.bot?.sendApi && msgId) {
                        try {
                            parseLog.push(`[Reply] 尝试 sendApi get_msg(${msgId})`)
                            replyData = await e.bot.sendApi('get_msg', { message_id: msgId })
                            if (replyData?.data) replyData = replyData.data
                            if (replyData) parseLog.push(`[Reply] sendApi get_msg 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] sendApi get_msg 失败: ${err.message}`)
                        }
                    }
                    
                    // icqq: group.getMsg
                    if (!replyData && e.group?.getMsg) {
                        try {
                            parseLog.push(`[Reply] 尝试 group.getMsg(${seq})`)
                            replyData = await e.group.getMsg(seq)
                            if (replyData) parseLog.push(`[Reply] group.getMsg 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] group.getMsg 失败: ${err.message}`)
                        }
                    }
                    
                    // 回退: group.getChatHistory
                    if (!replyData && e.group?.getChatHistory && seq) {
                        try {
                            parseLog.push(`[Reply] 尝试 group.getChatHistory(${seq})`)
                            const history = await e.group.getChatHistory(seq, 1)
                            replyData = history?.pop?.() || history?.[0]
                            if (replyData) parseLog.push(`[Reply] group.getChatHistory 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] group.getChatHistory 失败: ${err.message}`)
                        }
                    }
                    
                    // 回退: bot.getMsg (使用 seq)
                    if (!replyData && e.bot?.getMsg && seq) {
                        try {
                            parseLog.push(`[Reply] 尝试 bot.getMsg(seq=${seq})`)
                            replyData = await e.bot.getMsg(seq)
                            if (replyData) parseLog.push(`[Reply] bot.getMsg(seq) 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] bot.getMsg(seq) 失败: ${err.message}`)
                        }
                    }
                } 
                // 私聊
                else {
                    // NC: bot.getMsg
                    if (!replyData && e.bot?.getMsg && msgId) {
                        try {
                            parseLog.push(`[Reply] 私聊 bot.getMsg(${msgId})`)
                            replyData = await e.bot.getMsg(msgId)
                            if (replyData) parseLog.push(`[Reply] 私聊 bot.getMsg 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] 私聊 bot.getMsg 失败: ${err.message}`)
                        }
                    }
                    
                    // icqq: friend.getChatHistory
                    if (!replyData && e.friend?.getChatHistory) {
                        try {
                            parseLog.push(`[Reply] 尝试 friend.getChatHistory(${seq})`)
                            const history = await e.friend.getChatHistory(seq, 1)
                            replyData = history?.pop?.() || history?.[0]
                            if (replyData) parseLog.push(`[Reply] friend.getChatHistory 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] friend.getChatHistory 失败: ${err.message}`)
                        }
                    }
                }
                
                if (replyData) {
                    // 兼容 NC 格式: 数据可能在 data 字段中
                    const replyInfo = replyData.data || replyData
                    replySenderId = replyInfo.user_id || replyInfo.sender?.user_id || replyData.user_id
                    replySenderName = replyInfo.sender?.card || replyInfo.sender?.nickname || 
                                      replyInfo.nickname || replyData.nickname
                }
            }
        }
        
        // 方式3: 直接使用 e.source 中的信息 (部分平台 source 包含完整消息)
        if (!replyData && e.source?.message) {
            parseLog.push(`[Reply] 使用 e.source 中的消息数据`)
            replyData = e.source
            replySenderId = e.source.user_id
            replySenderName = e.source.nickname
        }

        // 提取消息内容 - 兼容多种格式
        const replyInfo = replyData?.data || replyData || {}
        let replyMessage = replyInfo.message || replyInfo.content || replyData?.message || replyData?.content
        
        // 确保是数组
        if (replyMessage && !Array.isArray(replyMessage)) {
            if (typeof replyMessage === 'string') {
                replyMessage = [{ type: 'text', data: { text: replyMessage } }]
            } else {
                replyMessage = []
            }
        }
        
        parseLog.push(`[Reply] 消息内容: ${replyMessage ? `${replyMessage.length} 段` : '无'}`)
        
        if (!replyMessage || replyMessage.length === 0) {
            logger.info('[MessageParser]', parseLog.join('\n'))
            return { text: '', contents: [], quoteInfo: null }
        }

        // 判断引用的是否是机器人的消息
        const botId = e.bot?.uin || e.self_id
        const isQuotingBot = replySenderId && botId && String(replySenderId) === String(botId)
        const senderLabel = isQuotingBot ? 'AI助手' : (replySenderName || '用户')

        // 解析引用消息内容 - 兼容 NC 格式
        let replyTextContent = ''
        for (const val of replyMessage) {
            // 使用统一的数据获取函数
            const valData = getSegmentData(val)
            const valType = val.type || valData._type || ''
            
            switch (valType) {
                case 'text':
                    if (handleReplyText) {
                        // NC: valData.text, icqq: val.text
                        replyTextContent += valData.text || val.text || ''
                    }
                    break
                
                case 'image':
                    if (handleReplyImage) {
                        // 调试日志
                        parseLog.push(`[Reply][Image] 原始数据: ${JSON.stringify({
                            type: val.type,
                            url: valData.url,
                            file: valData.file,
                            path: valData.path,
                            file_id: valData.file_id
                        })}`)
                        
                        // 使用统一的URL获取函数
                        let imgUrl = getMediaUrl(valData, true) || val.url || val.file
                        
                        // 如果没有直接 URL，尝试通过 file_id 获取 (NapCat)
                        if (!imgUrl && valData.file_id && e.bot?.sendApi) {
                            try {
                                parseLog.push(`[Reply][Image] 尝试通过 file_id 获取: ${valData.file_id}`)
                                const fileInfo = await e.bot.sendApi('get_image', { file_id: valData.file_id })
                                imgUrl = fileInfo?.data?.url || fileInfo?.url
                                if (imgUrl) parseLog.push(`[Reply][Image] get_image 成功`)
                            } catch (err) {
                                parseLog.push(`[Reply][Image] get_image 失败: ${err.message}`)
                            }
                        }
                        
                        parseLog.push(`[Reply][Image] 最终 URL: ${imgUrl ? imgUrl.substring(0, 50) + '...' : '无'}`)
                        
                        if (imgUrl) {
                            try {
                                // 优先使用URL直接传递
                                if (imgUrl.startsWith('http')) {
                                    contents.push({
                                        type: 'image_url',
                                        image_url: { url: imgUrl },
                                        source: 'reply'
                                    })
                                } else if (imgUrl.startsWith('file://') || imgUrl.startsWith('/')) {
                                    const imageData = await fetchImage(imgUrl)
                                    if (imageData) {
                                        contents.push({
                                            type: 'image',
                                            image: imageData.base64,
                                            mimeType: imageData.mimeType,
                                            source: 'reply'
                                        })
                                    }
                                } else if (imgUrl.startsWith('base64://')) {
                                    contents.push({
                                        type: 'image',
                                        image: imgUrl.replace('base64://', ''),
                                        mimeType: 'image/png',
                                        source: 'reply'
                                    })
                                } else {
                                    const imageData = await fetchImage(imgUrl)
                                    if (imageData) {
                                        contents.push({
                                            type: 'image',
                                            image: imageData.base64,
                                            mimeType: imageData.mimeType,
                                            source: 'reply'
                                        })
                                    }
                                }
                            } catch (err) {
                                logger.warn(`[MessageParser] 获取引用图片失败: ${imgUrl}`, err.message)
                                replyTextContent += `[图片:${imgUrl.substring(0, 30)}...]`
                            }
                        } else {
                            const debugInfo = valData.file_id || valData.file || '未知'
                            replyTextContent += `[图片:${debugInfo}]`
                        }
                    }
                    break
                
                case 'file':
                    if (handleReplyFile) {
                        let fileUrl = ''
                        const fid = valData.fid || val.fid
                        try {
                            if (e.group?.getFileUrl && fid) {
                                fileUrl = await e.group.getFileUrl(fid)
                            } else if (e.friend?.getFileUrl && fid) {
                                fileUrl = await e.friend.getFileUrl(fid)
                            }
                        } catch {}
                        const fileName = valData.name || val.name || fid || '未知文件'
                        replyTextContent += `[文件: ${fileName}${fileUrl ? ' URL:' + fileUrl : ''}]`
                    }
                    break
                
                case 'video': {
                    const videoUrl = getMediaUrl(valData) || val.url || val.file || ''
                    const videoName = valData.name || val.name
                    replyTextContent += `[视频${videoName ? ':' + videoName : ''}${videoUrl ? ' URL:' + videoUrl : ''}]`
                    // 添加视频信息到contents
                    if (videoUrl) {
                        contents.push({
                            type: 'video_info',
                            url: videoUrl,
                            name: videoName || '',
                            source: 'reply'
                        })
                    }
                    break
                }
                
                case 'face': {
                    const faceId = valData.id || val.id || ''
                    replyTextContent += `[表情:${faceId}]`
                    break
                }
                
                case 'at': {
                    const atQQ = valData.qq || val.qq || ''
                    replyTextContent += `@${atQQ} `
                    break
                }
                
                case 'forward':
                    if (handleForward) {
                        try {
                            const fwdResult = await parseForwardMessage(e, val)
                            if (fwdResult.text) {
                                replyTextContent += fwdResult.text
                            }
                            if (fwdResult.contents?.length > 0) {
                                contents.push(...fwdResult.contents)
                            }
                            if (!fwdResult.text) {
                                replyTextContent += '[转发消息]'
                            }
                        } catch {
                            replyTextContent += '[转发消息]'
                        }
                    }
                    break
                
                case 'json':
                    if (handleForward) {
                        try {
                            // NC: valData.data 可能是字符串或对象
                            const jsonStr = valData.data || val.data
                            const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
                            if (jsonData.app === 'com.tencent.multimsg') {
                                const resid = jsonData.meta?.detail?.resid
                                if (resid) {
                                    const fwdResult = await parseForwardMessage(e, { id: resid, resid })
                                    if (fwdResult.text) {
                                        replyTextContent += fwdResult.text
                                    }
                                    if (fwdResult.contents?.length > 0) {
                                        contents.push(...fwdResult.contents)
                                    }
                                    if (!fwdResult.text) {
                                        const preview = jsonData.meta?.detail?.news?.map(n => n.text).join('\n') || ''
                                        replyTextContent += `[聊天记录]${preview ? '\n' + preview : ''}`
                                    }
                                } else {
                                    const preview = jsonData.meta?.detail?.news?.map(n => n.text).join('\n') || ''
                                    replyTextContent += `[聊天记录]${preview ? '\n' + preview : ''}`
                                }
                            } else {
                                replyTextContent += `[卡片消息:${jsonData.prompt || jsonData.desc || ''}]`
                                // 添加提示，告诉AI使用正确的工具
                                replyTextContent += '(要转发此卡片请使用resend_quoted_card工具,如需伪造消息则设置as_forward=true)'
                            }
                        } catch {
                            replyTextContent += '[卡片消息](要转发请用resend_quoted_card,伪造消息设置as_forward=true)'
                        }
                    }
                    break
                    
                default:
                    // 其他未知类型
                    if (valType) {
                        replyTextContent += `[${valType}]`
                    }
                    break
            }
        }

        parseLog.push(`[Reply] 解析完成, 文本长度: ${replyTextContent.length}, 图片数: ${contents.length}`)
        
        // 输出解析日志
        logger.info('[MessageParser]', parseLog.join('\n'))

        // 构建引用上下文（简化格式，避免冗余）
        if (replyTextContent) {
            replyTextContent = cleanCQCode(replyTextContent)
            // 截断过长的引用内容
            const maxQuoteLen = 200
            const truncatedQuote = replyTextContent.length > maxQuoteLen 
                ? replyTextContent.substring(0, maxQuoteLen) + '...' 
                : replyTextContent
            
            if (isQuotingBot) {
                // 引用机器人消息：简洁格式
                text = `[引用你之前的回复: "${truncatedQuote}"]\n`
            } else {
                // 引用其他用户消息
                text = `[引用${senderLabel}的消息: "${truncatedQuote}"]\n`
            }
        }
        
        // 构建完整的引用信息对象 - 兼容 NC/icqq
        const quoteInfo = {
            // 发送者信息
            sender: {
                user_id: replySenderId,
                nickname: replySenderName,
                card: replyData?.sender?.card || replyInfo?.sender?.card || '',
                role: replyData?.sender?.role || replyInfo?.sender?.role || 'member',
                uid: replyData?.sender?.uid || replyInfo?.sender?.uid || ''
            },
            // 消息内容
            content: replyTextContent,
            isBot: isQuotingBot,
            // 消息标识 - 完整字段
            message_id: replyData?.message_id || replyInfo?.message_id || e.source?.message_id || '',
            seq: replyData?.seq || replyInfo?.seq || e.source?.seq || 0,
            rand: replyData?.rand || replyInfo?.rand || e.source?.rand || 0,
            time: replyData?.time || replyInfo?.time || e.source?.time || 0,
            // 原始消息数据 - 供工具使用
            raw_message: replyData?.raw_message || replyInfo?.raw_message || '',
            // 原始消息段数组
            message: replyMessage,
            // 群信息（如果是群消息）
            group_id: replyData?.group_id || replyInfo?.group_id || e.group_id || '',
            // 完整原始数据（调试用）
            _raw: replyData
        }
        
        return { text, contents, quoteInfo }
    } catch (err) {
        logger.warn('[MessageParser] 解析引用消息失败:', err.message)
    }

    return { text, contents, quoteInfo: null }
}

/**
 * 解析转发消息
 * 支持多平台: icqq, NapCat(NC), TRSS 等
 * 支持多层嵌套转发的递归处理
 * @param {Object} e - 事件对象
 * @param {Object} forwardElement - 转发消息元素
 * @param {number} depth - 递归深度（防止无限递归）
 */
async function parseForwardMessage(e, forwardElement, depth = 0) {
    const contents = []
    let text = ''
    let forwardInfo = null
    const parseLog = [] // 解析日志
    
    // 防止无限递归，最多3层嵌套
    const MAX_DEPTH = 10
    if (depth >= MAX_DEPTH) {
        return { text: '[嵌套转发消息，层级过深]', contents: [], forwardInfo: null }
    }

    try {
        // 尝试获取转发消息内容 - 支持多种方式
        let forwardMessages = null
        let parseMethod = ''
        
        parseLog.push(`[Forward][深度${depth}] 开始解析, element keys: ${Object.keys(forwardElement || {}).join(', ')}`)
        if (forwardElement.data) {
            parseLog.push(`[Forward] data keys: ${Object.keys(forwardElement.data || {}).join(', ')}`)
            // NapCat 文档: content 应该在 [收] 时直接包含
            if (forwardElement.data.content) {
                parseLog.push(`[Forward] data.content 存在, 长度: ${forwardElement.data.content?.length || 0}`)
            }
        }
        // 输出完整结构用于调试 (限制长度)
        parseLog.push(`[Forward] 完整结构: ${JSON.stringify(forwardElement).substring(0, 500)}`)
        
        // NC/NapCat 文档: forward 消息段 { type: "forward", data: { id: "", content: [] } }
        // content 在 [收] 时直接包含，优先检查
        if (forwardElement.data?.content && Array.isArray(forwardElement.data.content)) {
            forwardMessages = forwardElement.data.content
            parseMethod = 'data_content'
            parseLog.push(`[Forward] 使用 data.content 方式 (NapCat标准), 消息数: ${forwardMessages.length}`)
        }
        else if (forwardElement.content && Array.isArray(forwardElement.content)) {
            forwardMessages = forwardElement.content
            parseMethod = 'direct_content'
            parseLog.push(`[Forward] 使用 direct_content 方式, 消息数: ${forwardMessages.length}`)
        }
        else if (forwardElement.message && Array.isArray(forwardElement.message)) {
            forwardMessages = forwardElement.message
            parseMethod = 'message_array'
            parseLog.push(`[Forward] 使用 message_array 方式, 消息数: ${forwardMessages.length}`)
        }
        else if (forwardElement.data?.message && Array.isArray(forwardElement.data.message)) {
            forwardMessages = forwardElement.data.message
            parseMethod = 'data_message'
            parseLog.push(`[Forward] 使用 data.message 方式, 消息数: ${forwardMessages.length}`)
        }
        // 方式3: 通过 id 获取 (icqq e.group.getForwardMsg)
        else if (forwardElement.id && e.group?.getForwardMsg) {
            parseLog.push(`[Forward] 尝试通过 id=${forwardElement.id} 获取`)
            try {
                forwardMessages = await e.group.getForwardMsg(forwardElement.id)
                parseMethod = 'group_getForwardMsg_id'
                parseLog.push(`[Forward] 通过 id 获取成功, 消息数: ${forwardMessages?.length || 0}`)
            } catch (err) {
                parseLog.push(`[Forward] 通过 id 获取失败: ${err.message}`)
            }
        }
        // 方式4: 通过 data.id 获取 (NC 格式)
        else if (forwardElement.data?.id && e.group?.getForwardMsg) {
            parseLog.push(`[Forward] 尝试通过 data.id=${forwardElement.data.id} 获取`)
            try {
                forwardMessages = await e.group.getForwardMsg(forwardElement.data.id)
                parseMethod = 'group_getForwardMsg_data_id'
                parseLog.push(`[Forward] 通过 data.id 获取成功, 消息数: ${forwardMessages?.length || 0}`)
            } catch (err) {
                parseLog.push(`[Forward] 通过 data.id 获取失败: ${err.message}`)
            }
        }
        // 方式5: 通过 resid 获取 (TRSS)
        else if (forwardElement.resid && e.group?.getForwardMsg) {
            parseLog.push(`[Forward] 尝试通过 resid=${forwardElement.resid} 获取`)
            try {
                forwardMessages = await e.group.getForwardMsg(forwardElement.resid)
                parseMethod = 'group_getForwardMsg_resid'
                parseLog.push(`[Forward] 通过 resid 获取成功, 消息数: ${forwardMessages?.length || 0}`)
            } catch (err) {
                parseLog.push(`[Forward] 通过 resid 获取失败: ${err.message}`)
            }
        }
        // 方式6: 通过 bot.getForwardMsg 获取 (全局方法)
        if (!forwardMessages && e.bot?.getForwardMsg) {
            const fwdId = forwardElement.id || forwardElement.data?.id || forwardElement.resid
            if (fwdId) {
                parseLog.push(`[Forward] 尝试通过 bot.getForwardMsg id=${fwdId} 获取`)
                try {
                    forwardMessages = await e.bot.getForwardMsg(fwdId)
                    parseMethod = 'bot_getForwardMsg'
                    parseLog.push(`[Forward] 通过 bot.getForwardMsg 获取成功, 消息数: ${forwardMessages?.length || 0}`)
                } catch (err) {
                    parseLog.push(`[Forward] 通过 bot.getForwardMsg 获取失败: ${err.message}`)
                }
            }
        }
        
        // 方式7: OneBot v11 标准 - sendApi get_forward_msg (参数: id)
        if (!forwardMessages && e.bot?.sendApi) {
            const fwdId = forwardElement.id || forwardElement.data?.id || forwardElement.resid || forwardElement.data?.resid
            if (fwdId) {
                parseLog.push(`[Forward] 尝试 sendApi get_forward_msg id=${fwdId}`)
                try {
                    const result = await e.bot.sendApi('get_forward_msg', { id: fwdId })
                    // OneBot v11 返回格式: { message: [...] }
                    // NapCat 可能返回: { data: { messages: [...] } } 或 { messages: [...] }
                    const messages = result?.message || result?.data?.messages || result?.messages || result?.data?.message
                    if (messages && Array.isArray(messages)) {
                        forwardMessages = messages
                        parseMethod = 'sendApi_get_forward_msg'
                        parseLog.push(`[Forward] 通过 sendApi 获取成功, 消息数: ${forwardMessages.length}`)
                    } else if (result) {
                        parseLog.push(`[Forward] sendApi 返回格式异常: ${JSON.stringify(result).substring(0, 200)}`)
                    }
                } catch (err) {
                    parseLog.push(`[Forward] sendApi 获取失败: ${err.message}`)
                }
            }
        }
        
        // 方式8: 尝试从引用消息中获取转发内容
        if (!forwardMessages && e.source?.message) {
            const sourceMsg = e.source.message
            if (Array.isArray(sourceMsg)) {
                const fwdSeg = sourceMsg.find(s => s.type === 'forward')
                if (fwdSeg?.data?.content || fwdSeg?.data?.message || fwdSeg?.message) {
                    forwardMessages = fwdSeg.data?.content || fwdSeg.data?.message || fwdSeg.message
                    if (Array.isArray(forwardMessages)) {
                        parseMethod = 'source_message'
                        parseLog.push(`[Forward] 从 source.message 获取成功, 消息数: ${forwardMessages.length}`)
                    }
                }
            }
        }

        if (forwardMessages && Array.isArray(forwardMessages)) {
            const forwardTexts = []
            const parsedMessages = []
            
            parseLog.push(`[Forward] 开始解析 ${forwardMessages.length} 条消息, 方法: ${parseMethod}`)
            
            // 最多处理15条转发消息
            for (let i = 0; i < Math.min(forwardMessages.length, 15); i++) {
                const msg = forwardMessages[i]
                const msgData = msg.data || msg
                
                // 提取用户信息 - 兼容多种格式
                const userId = msgData.user_id || msgData.uin || msgData.sender?.user_id || msg.user_id || ''
                const nickname = msgData.nickname || msgData.nick || msgData.sender?.nickname || 
                                 msgData.sender?.card || msg.nickname || msg.nick || `用户${userId || i}`
                const time = msgData.time || msg.time || 0
                
                // 提取消息内容 - 兼容多种格式
                // NC 格式: msg.data.content 或 msg.content
                // icqq 格式: msg.message
                let messageContent = msgData.content || msgData.message || msg.message || msg.content || []
                
                // 确保是数组
                if (!Array.isArray(messageContent)) {
                    if (typeof messageContent === 'string') {
                        messageContent = [{ type: 'text', data: { text: messageContent } }]
                    } else {
                        messageContent = []
                    }
                }
                
                parseLog.push(`[Forward] 消息 ${i}: user=${userId}, nick=${nickname}, content_len=${messageContent.length}`)
                
                const msgInfo = {
                    user_id: userId,
                    nickname: nickname,
                    time: time,
                    content: []
                }
                
                for (const val of messageContent) {
                    // 使用统一的数据获取函数
                    const valData = getSegmentData(val)
                    const valType = val.type || valData._type || ''
                    
                    if (valType === 'text') {
                        const textContent = valData.text || valData || ''
                        if (textContent) {
                            forwardTexts.push(`${nickname}: ${textContent}`)
                            msgInfo.content.push({ type: 'text', text: textContent })
                        }
                    } else if (valType === 'image') {
                        // 图片 URL - 使用统一函数获取
                        const imgUrl = getMediaUrl(valData) || val.url || val.file || ''
                        forwardTexts.push(`${nickname}: [图片${imgUrl ? '' : '(无URL)'}]`)
                        msgInfo.content.push({ type: 'image', url: imgUrl })
                        if (imgUrl && imgUrl.startsWith('http')) {
                            contents.push({
                                type: 'image_url',
                                image_url: { url: imgUrl },
                                source: 'forward'
                            })
                        }
                    } else if (valType === 'video') {
                        // 视频 URL
                        const videoUrl = getMediaUrl(valData) || val.url || val.file || ''
                        const videoName = valData.name || val.name || ''
                        forwardTexts.push(`${nickname}: [视频${videoName ? ':' + videoName : ''}]`)
                        msgInfo.content.push({ type: 'video', url: videoUrl, name: videoName })
                        if (videoUrl) {
                            contents.push({
                                type: 'video_info',
                                url: videoUrl,
                                name: videoName,
                                source: 'forward'
                            })
                        }
                    } else if (valType === 'face') {
                        const faceId = valData.id || val.id || ''
                        forwardTexts.push(`${nickname}: [表情:${faceId}]`)
                        msgInfo.content.push({ type: 'face', id: faceId })
                    } else if (valType === 'at') {
                        const atQQ = valData.qq || val.qq || ''
                        forwardTexts.push(`${nickname}: @${atQQ}`)
                        msgInfo.content.push({ type: 'at', qq: atQQ })
                    } else if (valType === 'forward') {
                        // 递归处理嵌套转发消息
                        try {
                            const nestedResult = await parseForwardMessage(e, val, depth + 1)
                            if (nestedResult.text) {
                                forwardTexts.push(`${nickname}: ${nestedResult.text}`)
                            } else {
                                forwardTexts.push(`${nickname}: [嵌套转发消息]`)
                            }
                            contents.push(...nestedResult.contents)
                            msgInfo.content.push({ type: 'forward', nested: true, parsed: !!nestedResult.text })
                        } catch (err) {
                            forwardTexts.push(`${nickname}: [嵌套转发消息]`)
                            msgInfo.content.push({ type: 'forward', nested: true })
                        }
                    } else if (valType === 'file') {
                        const fileName = valData.name || val.name || '文件'
                        forwardTexts.push(`${nickname}: [文件:${fileName}]`)
                        msgInfo.content.push({ type: 'file', name: fileName })
                    } else if (valType === 'video') {
                        forwardTexts.push(`${nickname}: [视频]`)
                        msgInfo.content.push({ type: 'video' })
                    } else if (valType === 'record') {
                        forwardTexts.push(`${nickname}: [语音]`)
                        msgInfo.content.push({ type: 'record' })
                    } else if (valType) {
                        // 其他类型
                        forwardTexts.push(`${nickname}: [${valType}]`)
                        msgInfo.content.push({ type: valType })
                    }
                }
                
                // 如果没有解析出任何内容，尝试获取 raw_message
                if (msgInfo.content.length === 0) {
                    const rawMsg = msgData.raw_message || msg.raw_message || ''
                    if (rawMsg) {
                        forwardTexts.push(`${nickname}: ${rawMsg}`)
                        msgInfo.content.push({ type: 'text', text: rawMsg })
                    }
                }
                
                parsedMessages.push(msgInfo)
            }
            
            if (forwardTexts.length > 0) {
                text = `[转发消息内容 共${forwardMessages.length}条]\n${forwardTexts.join('\n')}\n[转发消息结束]\n`
            } else {
                text = `[转发消息 共${forwardMessages.length}条，内容解析为空]\n`
                parseLog.push(`[Forward] 警告: 转发消息内容解析为空`)
            }
            
            // 构建转发信息对象
            forwardInfo = {
                total: forwardMessages.length,
                parsed: parsedMessages.length,
                method: parseMethod,
                messages: parsedMessages
            }
            
            parseLog.push(`[Forward] 解析完成, 共 ${parsedMessages.length} 条, 文本行数: ${forwardTexts.length}`)
        } else {
            text = '[转发消息]'
            parseLog.push(`[Forward] 未能获取转发消息内容`)
        }
    } catch (err) {
        parseLog.push(`[Forward] 解析失败: ${err.message}`)
        logger.warn('[MessageParser] 解析转发消息失败:', err.message)
        text = '[转发消息]'
    }
    
    // 输出解析日志
    if (parseLog.length > 0) {
        logger.info('[MessageParser]', parseLog.join('\n'))
    }

    return { text, contents, forwardInfo }
}

/**
 * 获取图片并转为 base64
 */
async function fetchImage(url) {
    if (!url) return null

    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
        }
        
        const arrayBuffer = await response.arrayBuffer()
        const base64 = Buffer.from(arrayBuffer).toString('base64')
        const mimeType = response.headers.get('content-type') || 'image/jpeg'
        
        return { base64, mimeType }
    } catch (err) {
        logger.warn(`[MessageParser] 获取图片失败: ${url}`, err.message)
        return null
    }
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 清理CQ码 - 将CQ码转换为可读文本或移除
 * 参考: https://docs.go-cqhttp.org/cqcode
 * @param {string} text - 包含CQ码的文本
 * @returns {string} 清理后的文本
 */
function cleanCQCode(text) {
    if (!text) return ''
    
    return text
        // === 先处理HTML实体编码 ===
        .replace(/&#91;/g, '[')
        .replace(/&#93;/g, ']')
        .replace(/&#44;/g, ',')
        .replace(/&amp;/g, '&')
        
        // === 需要移除的CQ码（不显示任何内容）===
        // 回复消息 - 移除（已在引用解析中处理）
        .replace(/\[CQ:reply,[^\]]+\]/g, '')
        // 匿名消息标记 - 移除
        .replace(/\[CQ:anonymous[^\]]*\]/g, '')
        
        // === @消息 ===
        // [CQ:at,qq=123] 或 [CQ:at,qq=123,name=xxx] 或 [CQ:at,qq=all]
        .replace(/\[CQ:at,qq=all\]/g, '@全体成员')
        .replace(/\[CQ:at,qq=(\d+)(?:,name=([^\],]+))?[^\]]*\]/g, (_, qq, name) => ` @${name || qq} `)
        
        // === 多媒体消息 ===
        // 图片 [CQ:image,file=xxx,type=flash] - 闪照
        .replace(/\[CQ:image,[^\]]*type=flash[^\]]*\]/g, '[闪照]')
        // 图片 [CQ:image,file=xxx,type=show] - 秀图
        .replace(/\[CQ:image,[^\]]*type=show[^\]]*\]/g, '[秀图]')
        // 普通图片
        .replace(/\[CQ:image,[^\]]+\]/g, '[图片]')
        // 语音
        .replace(/\[CQ:record,[^\]]+\]/g, '[语音]')
        // 视频
        .replace(/\[CQ:video,[^\]]+\]/g, '[视频]')
        // 文件
        .replace(/\[CQ:file,[^\]]+\]/g, '[文件]')
        
        // === 表情类 ===
        // QQ表情
        .replace(/\[CQ:face,id=(\d+)[^\]]*\]/g, '[表情]')
        // 戳一戳
        .replace(/\[CQ:poke,qq=(\d+)[^\]]*\]/g, '[戳一戳]')
        // 礼物
        .replace(/\[CQ:gift,[^\]]+\]/g, '[礼物]')
        // 窗口抖动
        .replace(/\[CQ:shake\]/g, '[窗口抖动]')
        
        // === 互动类 ===
        // 猜拳
        .replace(/\[CQ:rps\]/g, '[猜拳]')
        // 骰子
        .replace(/\[CQ:dice\]/g, '[骰子]')
        
        // === 分享类 ===
        // 链接分享 - 提取标题
        .replace(/\[CQ:share,[^\]]*title=([^\],]+)[^\]]*\]/g, '[分享:$1]')
        .replace(/\[CQ:share,[^\]]+\]/g, '[链接分享]')
        // 音乐分享
        .replace(/\[CQ:music,[^\]]*type=(\w+)[^\]]*\]/g, '[音乐:$1]')
        // 位置分享
        .replace(/\[CQ:location,[^\]]+\]/g, '[位置]')
        // 推荐联系人/群
        .replace(/\[CQ:contact,type=qq[^\]]*\]/g, '[推荐好友]')
        .replace(/\[CQ:contact,type=group[^\]]*\]/g, '[推荐群]')
        
        // === 卡片消息 ===
        // JSON卡片
        .replace(/\[CQ:json,[^\]]+\]/g, '[卡片消息]')
        // XML卡片
        .replace(/\[CQ:xml,[^\]]+\]/g, '[XML消息]')
        // 装逼大图
        .replace(/\[CQ:cardimage,[^\]]+\]/g, '[大图]')
        
        // === 转发消息 ===
        // 转发消息
        .replace(/\[CQ:forward,[^\]]+\]/g, '[转发消息]')
        // 合并转发节点
        .replace(/\[CQ:node,[^\]]+\]/g, '')
        
        // === 特殊消息 ===
        // 红包
        .replace(/\[CQ:redbag,[^\]]*title=([^\],]+)[^\]]*\]/g, '[红包:$1]')
        .replace(/\[CQ:redbag,[^\]]+\]/g, '[红包]')
        // TTS语音
        .replace(/\[CQ:tts,text=([^\]]+)\]/g, '[语音:$1]')
        
        // === 兜底处理 ===
        // 其他未知CQ码 - 移除
        .replace(/\[CQ:[^\]]+\]/g, '')
        
        // === 清理格式 ===
        // 清理多余空格
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * 从用户消息中提取纯文本
 */
export function extractTextFromMessage(message) {
    if (!message?.content) return ''
    
    return message.content
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n')
        .trim()
}

/**
 * 检查消息是否包含图片
 */
export function hasImages(message) {
    if (!message?.content) return false
    return message.content.some(c => c.type === 'image')
}

/**
 * 获取消息中的所有图片
 */
export function getImages(message) {
    if (!message?.content) return []
    return message.content
        .filter(c => c.type === 'image')
        .map(c => ({
            base64: c.image,
            mimeType: c.mimeType || 'image/jpeg',
            source: c.source
        }))
}

/**
 * 导出CQ码清理函数供外部使用
 */
export { cleanCQCode }


export const segment = {
    /**
     * 自定义消息段
     * @param {string} type - 消息类型
     * @param {Object} data - 消息内容
     */
    custom: (type, data) => ({ type, ...data }),
    
    /**
     * Raw消息 (TRSS)
     * @param {Object} data - raw内容
     */
    raw: (data) => ({ type: 'raw', data }),
    /** 文本消息 */
    text: (text) => ({ type: 'text', data: { text: String(text) } }),
    image: (file, opts = {}) => ({ 
        type: 'image', 
        file,  // icqq 格式
        ...opts,  // icqq 其他参数
        data: { file, ...opts }  // NC/OneBot 格式
    }),
    
    /** @消息 - qq可以是QQ号或'all' */
    at: (qq, name) => ({ 
        type: 'at', 
        data: { qq: String(qq), ...(name ? { name } : {}) } 
    }),
    
    /** 引用回复 */
    reply: (id) => ({ type: 'reply', data: { id: String(id) } }),
    
    /** QQ表情 */
    face: (id) => ({ type: 'face', data: { id: Number(id) } }),
    
    /** 语音消息 */
    record: (file) => ({ type: 'record', file, data: { file } }),
    
    /** 视频消息 */
    video: (file, thumb) => ({ 
        type: 'video', 
        file,  // icqq 格式
        ...(thumb ? { thumb } : {}),
        data: { file, ...(thumb ? { thumb } : {}) }  // NC/OneBot 格式
    }),
    
    /** JSON卡片消息 */
    json: (data) => ({ 
        type: 'json', 
        data: { data: typeof data === 'string' ? data : JSON.stringify(data) } 
    }),
    
    /** XML消息 */
    xml: (data) => ({ type: 'xml', data: { data } }),
    
    /** 转发消息 */
    forward: (id) => ({ type: 'forward', data: { id } }),
    
    /** 转发节点 - 用于构建合并转发 */
    node: (userId, nickname, content) => ({
        type: 'node',
        data: {
            user_id: String(userId),
            nickname,
            content: Array.isArray(content) ? content : [segment.text(content)]
        }
    }),
    
    /** 文件消息 */
    file: (file, name) => ({ 
        type: 'file', 
        file,  // icqq 格式
        ...(name ? { name } : {}),
        data: { file, ...(name ? { name } : {}) }  // NC/OneBot 格式
    }),
    
    /** 链接分享 */
    share: (url, title, content, image) => ({
        type: 'share',
        data: { url, title, ...(content ? { content } : {}), ...(image ? { image } : {}) }
    }),
    
    /** 音乐分享 - type: qq/163/kugou/kuwo/migu/custom */
    music: (type, idOrData) => {
        if (type === 'custom' && typeof idOrData === 'object') {
            return { type: 'music', data: { type: 'custom', ...idOrData } }
        }
        return { type: 'music', data: { type, id: String(idOrData) } }
    },
    
    /** 位置分享 */
    location: (lat, lon, title, content) => ({
        type: 'location',
        data: { lat, lon, ...(title ? { title } : {}), ...(content ? { content } : {}) }
    }),
    
    /** 戳一戳 */
    poke: (type, id) => ({ type: 'poke', data: { type, id } }),
    
    /** 商城表情 */
    mface: (emojiPackageId, emojiId, key, summary) => ({
        type: 'mface',
        data: {
            emoji_package_id: emojiPackageId,
            emoji_id: emojiId,
            ...(key ? { key } : {}),
            ...(summary ? { summary } : {})
        }
    }),
    
    /** 骰子 */
    dice: () => ({ type: 'dice', data: {} }),
    /** 猜拳 */
    rps: () => ({ type: 'rps', data: {} }),
    /** Markdown消息 (NapCat/TRSS) */
    markdown: (content, params) => ({ 
        type: 'markdown', 
        data: typeof content === 'object' 
            ? content 
            : { content, ...(params || {}) }
    }),
    
    /** 按钮键盘 (NapCat) */
    keyboard: (content) => ({
        type: 'keyboard',
        data: typeof content === 'object' 
            ? content 
            : { content }
    }),
    
    /** 推荐联系人/群 */
    contact: (type, id) => ({ type: 'contact', data: { type, id: String(id) } }),
    
    /** TTS语音 */
    tts: (text) => ({ type: 'tts', data: { text } }),
    
    /** 触摸/拍一拍 */
    touch: (id) => ({ type: 'touch', data: { id: String(id) } }),
    /** 礼物消息 */
    gift: (qq, id) => ({ type: 'gift', data: { qq: String(qq), id } }),
    /** 窗口抖动 */
    shake: () => ({ type: 'shake', data: {} }),
    /** 匿名消息 */
    anonymous: (ignore = false) => ({ type: 'anonymous', data: { ignore: ignore ? 1 : 0 } }),
    /** 按钮消息  */
    button: (buttons) => ({ type: 'button', data: { buttons } }),
    /** 气泡表情 */
    bubble_face: (id, count = 1) => ({ type: 'bubble_face', data: { id, count } }),
    /** 篮球表情 */
    basketball: () => ({ type: 'basketball', data: {} }),
    /** 新版骰子 (可指定点数 1-6，默认随机) */
    new_dice: (value) => ({ type: 'new_dice', data: value ? { id: value } : {} }),
    /** 新版猜拳 (可指定 1石头/2剪刀/3布，默认随机) */
    new_rps: (value) => ({ type: 'new_rps', data: value ? { id: value } : {} }),
    /** 长消息 (NapCat) */
    long_msg: (id) => ({ type: 'long_msg', data: { id } }),
    /** 天气分享 (NapCat) */
    weather: (city, code) => ({ type: 'weather', data: { city, code } }),
    
    /** 
     * 多图消息 - 发送多张图片
     * @param {Array<string>} urls - 图片URL数组
     */
    images: (urls) => urls.map(url => ({ type: 'image', file: url, data: { file: url } })),
    
    /**
     * 引用+文本组合
     * @param {string} replyId - 引用的消息ID
     * @param {string} text - 文本内容
     */
    replyText: (replyId, text) => [
        { type: 'reply', data: { id: String(replyId) } },
        { type: 'text', data: { text } }
    ],
    
    /**
     * @+文本组合
     * @param {string|number} qq - 要@的QQ号
     * @param {string} text - 文本内容
     */
    atText: (qq, text) => [
        { type: 'at', data: { qq: String(qq) } },
        { type: 'text', data: { text: ' ' + text } }
    ],
    
    /**
     * 图文混合消息
     * @param {string} text - 文本内容
     * @param {string|Array} images - 图片URL或URL数组
     */
    textImage: (text, images) => {
        const segs = [{ type: 'text', data: { text } }]
        const imgList = Array.isArray(images) ? images : [images]
        imgList.forEach(url => segs.push({ type: 'image', file: url, data: { file: url } }))
        return segs
    },
    
    /**
     * 闪照 (NapCat/icqq)
     * @param {string} file - 图片文件/URL
     */
    flash: (file) => ({ 
        type: 'image', 
        file, 
        flash: true,
        data: { file, type: 'flash' }
    }),
    
    /**
     * 秀图 (icqq)
     * @param {string} file - 图片文件/URL
     * @param {number} id - 秀图类型 (40000普通/40001幻影/40002抖动/40003生日/40004爱你/40005征友)
     */
    show: (file, id = 40000) => ({
        type: 'image',
        file,
        data: { file, type: 'show', id }
    }),
    
    /**
     * 语音消息 - 支持更多参数 (NapCat)
     * @param {string} file - 语音文件/URL
     * @param {boolean} magic - 是否变声
     */
    voice: (file, magic = false) => ({
        type: 'record',
        file,
        magic: magic ? 1 : 0,
        data: { file, magic: magic ? 1 : 0 }
    }),
    
    /**
     * 合并转发节点 - 使用现有消息ID
     * @param {string} id - 消息ID
     */
    nodeId: (id) => ({
        type: 'node',
        data: { id: String(id) }
    }),
    
    /**
     * 合并转发节点 - 自定义内容（支持富文本）
     * @param {string|number} userId - 发送者QQ
     * @param {string} nickname - 发送者昵称
     * @param {Array|string} content - 消息内容
     * @param {number} time - 时间戳（可选）
     */
    nodeCustom: (userId, nickname, content, time) => ({
        type: 'node',
        data: {
            user_id: String(userId),
            nickname,
            content: Array.isArray(content) ? content : [{ type: 'text', data: { text: content } }],
            ...(time ? { time } : {})
        }
    }),
    
    /**
     * 链接卡片 (JSON)
     * @param {string} title - 标题
     * @param {string} desc - 描述
     * @param {string} url - 链接
     * @param {string} image - 图片URL（可选）
     */
    linkCard: (title, desc, url, image) => ({
        type: 'json',
        data: {
            data: JSON.stringify({
                app: 'com.tencent.structmsg',
                desc: '',
                view: 'news',
                ver: '0.0.0.1',
                prompt: title,
                meta: {
                    news: { title, desc, jumpUrl: url, preview: image || '', tag: '', tagIcon: '' }
                }
            })
        }
    }),
    
    /**
     * 音乐卡片 - 自定义
     * @param {Object} data - 音乐数据 { url, audio, title, singer, image }
     */
    musicCustom: (data) => ({
        type: 'music',
        data: {
            type: 'custom',
            url: data.url || '',
            audio: data.audio || '',
            title: data.title || '',
            content: data.singer || data.content || '',
            image: data.image || ''
        }
    }),
    
    /**
     * 表情回应消息段 (NapCat扩展)
     * @param {string} messageId - 目标消息ID
     * @param {string|number} emojiId - 表情ID
     */
    reaction: (messageId, emojiId) => ({
        type: 'reaction',
        data: { message_id: messageId, emoji_id: String(emojiId) }
    }),
    
    /**
     * 长文本消息 (会自动转为合并转发)
     * @param {string} text - 长文本内容
     * @param {number} chunkSize - 每段最大字符数（默认500）
     */
    longText: (text, chunkSize = 500) => {
        if (text.length <= chunkSize) {
            return [{ type: 'text', data: { text } }]
        }
        // 分割为多个文本段
        const chunks = []
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push(text.substring(i, i + chunkSize))
        }
        return chunks.map(chunk => ({ type: 'text', data: { text: chunk } }))
    }
}

/**
 * JSON卡片类型
 */
export const CardType = {
    LINK: 'com.tencent.structmsg',        // 链接卡片
    FORWARD: 'com.tencent.multimsg',      // 合并转发
    MINIAPP: 'com.tencent.miniapp',       // 小程序
    MUSIC: 'com.tencent.music',           // 音乐分享
}
/**
 * 卡片消息解析器
 */
export const CardParser = {
    /**
     * 解析JSON卡片消息
     * @param {string|Object} json 
     * @returns {{type: string, data: Object, raw: Object}|null}
     */
    parse(json) {
        try {
            const data = typeof json === 'string' ? JSON.parse(json) : json
            if (!data?.app) return null

            const result = { type: 'unknown', data: {}, raw: data }

            switch (data.app) {
                case CardType.LINK:
                    result.type = 'link'
                    result.data = {
                        title: data.meta?.news?.title || data.prompt || '',
                        desc: data.meta?.news?.desc || data.desc || '',
                        url: data.meta?.news?.jumpUrl || '',
                        image: data.meta?.news?.preview || '',
                        source: data.meta?.news?.tag || ''
                    }
                    break

                case CardType.FORWARD:
                    result.type = 'forward'
                    result.data = {
                        resid: data.meta?.detail?.resid || '',
                        summary: data.meta?.detail?.summary || '',
                        source: data.meta?.detail?.source || '',
                        preview: (data.meta?.detail?.news || []).map(n => n.text)
                    }
                    break

                case CardType.MUSIC:
                    result.type = 'music'
                    result.data = {
                        title: data.meta?.music?.title || '',
                        singer: data.meta?.music?.desc || '',
                        url: data.meta?.music?.jumpUrl || '',
                        audio: data.meta?.music?.musicUrl || '',
                        image: data.meta?.music?.preview || ''
                    }
                    break

                case CardType.MINIAPP:
                    result.type = 'miniapp'
                    result.data = {
                        appid: data.meta?.detail_1?.appid || '',
                        title: data.meta?.detail_1?.title || data.prompt || '',
                        desc: data.meta?.detail_1?.desc || '',
                        url: data.meta?.detail_1?.qqdocurl || '',
                        image: data.meta?.detail_1?.preview || ''
                    }
                    break

                default:
                    result.type = 'custom'
                    result.data = { app: data.app, prompt: data.prompt || '', meta: data.meta || {} }
            }
            return result
        } catch {
            return null
        }
    },
    /** 判断是否是转发消息卡片 */
    isForward: (json) => CardParser.parse(json)?.type === 'forward',
    
    /** 判断是否是链接卡片 */
    isLink: (json) => CardParser.parse(json)?.type === 'link',
    
    /** 提取卡片中的URL */
    extractUrl: (json) => CardParser.parse(json)?.data?.url || null,
    
    /** 提取卡片中的图片 */
    extractImage: (json) => CardParser.parse(json)?.data?.image || null
}

/**
 * 卡片消息构建器
 */
export const CardBuilder = {
    /**
     * 创建链接卡片
     */
    link(title, desc, url, image) {
        return segment.json({
            app: CardType.LINK,
            desc: '',
            view: 'news',
            ver: '0.0.0.1',
            prompt: title,
            meta: {
                news: { title, desc, jumpUrl: url, preview: image || '', tag: '', tagIcon: '' }
            }
        })
    },

    /**
     * 创建音乐分享卡片
     */
    music(type, idOrData) {
        return segment.music(type, idOrData)
    },

    /**
     * 创建自定义JSON卡片
     */
    json(data) {
        return segment.json(data)
    },

    /**
     * 创建大图卡片
     * @param {string} image - 图片URL
     * @param {string} title - 标题
     * @param {string} content - 内容描述
     */
    bigImage(image, title = '', content = '') {
        return segment.json({
            app: 'com.tencent.structmsg',
            desc: '',
            view: 'news',
            ver: '0.0.0.1',
            prompt: title || '[图片]',
            meta: {
                news: {
                    title: title || '',
                    desc: content || '',
                    preview: image,
                    tag: '',
                    jumpUrl: image
                }
            }
        })
    },

    /**
     * 创建文本卡片 (带图标)
     * @param {string} title - 标题
     * @param {string} content - 内容
     * @param {string} icon - 图标URL
     */
    textCard(title, content, icon = '') {
        return segment.json({
            app: 'com.tencent.structmsg',
            desc: '',
            view: 'news',
            ver: '0.0.0.1',
            prompt: title,
            meta: {
                news: {
                    title,
                    desc: content,
                    preview: icon,
                    tag: '',
                    jumpUrl: ''
                }
            }
        })
    },

    /**
     * 创建小程序卡片
     * @param {Object} data - 小程序数据
     */
    miniApp(data) {
        return segment.json({
            app: CardType.MINIAPP,
            desc: '',
            view: 'all',
            ver: '1.0.0.89',
            prompt: data.title || '[小程序]',
            meta: {
                detail_1: {
                    appid: data.appid || '',
                    title: data.title || '',
                    desc: data.desc || '',
                    preview: data.image || '',
                    qqdocurl: data.url || '',
                    host: { uin: 0, nick: '' },
                    shareTemplateId: '',
                    shareTemplateData: {}
                }
            }
        })
    },

    /**
     * 创建Ark消息（通用模板）
     * @param {string} templateId - 模板ID
     * @param {Object} kv - 键值对参数
     */
    ark(templateId, kv = {}) {
        const kvList = Object.entries(kv).map(([key, value]) => ({ key, value: String(value) }))
        return {
            type: 'ark',
            data: {
                template_id: templateId,
                kv: kvList
            }
        }
    }
}

/**
 * 消息构建器 - 链式构建消息
 */
export class MessageBuilder {
    constructor() {
        this.segments = []
    }

    /**
     * 添加文本
     */
    text(content) {
        if (content) {
            this.segments.push(segment.text(content))
        }
        return this
    }

    /**
     * 添加图片
     */
    image(file, opts = {}) {
        this.segments.push(segment.image(file, opts))
        return this
    }

    /**
     * 添加@
     */
    at(qq, name) {
        this.segments.push(segment.at(qq, name))
        return this
    }

    /**
     * 添加表情
     */
    face(id) {
        this.segments.push(segment.face(id))
        return this
    }

    /**
     * 添加引用
     */
    reply(id) {
        this.segments.push(segment.reply(id))
        return this
    }

    /**
     * 添加语音
     */
    record(file) {
        this.segments.push(segment.record(file))
        return this
    }

    /**
     * 添加视频
     */
    video(file, thumb) {
        this.segments.push(segment.video(file, thumb))
        return this
    }

    /**
     * 添加JSON卡片
     */
    json(data) {
        this.segments.push(segment.json(data))
        return this
    }

    /**
     * 添加Markdown
     */
    markdown(content) {
        this.segments.push(segment.markdown(content))
        return this
    }

    /**
     * 添加商城表情
     */
    mface(packageId, emojiId, key, summary) {
        this.segments.push(segment.mface(packageId, emojiId, key, summary))
        return this
    }

    /**
     * 添加任意消息段
     */
    add(seg) {
        if (Array.isArray(seg)) {
            this.segments.push(...seg)
        } else {
            this.segments.push(seg)
        }
        return this
    }

    /**
     * 构建消息数组
     */
    build() {
        return this.segments
    }

    /**
     * 静态创建方法
     */
    static create() {
        return new MessageBuilder()
    }
}

/**
 * Raw消息工具 - 用于发送原始协议消息
 */
export const RawMessage = {
    /**
     * 创建raw消息段 (TRSS/Chronocat)
     * @param {Object} data - raw数据
     */
    raw(data) {
        return { type: 'raw', data }
    },

    /**
     * 构建OneBot消息段数组
     * @param {Array} segments - 简化格式的消息段 [{type, ...data}]
     * @returns {Array} OneBot格式消息段
     */
    toOneBot(segments) {
        return segments.map(seg => {
            if (seg.type && seg.data) return seg
            const { type, ...data } = seg
            return { type, data }
        })
    },

    /**
     * 构建icqq消息段数组
     * @param {Array} segments - OneBot格式消息段
     * @returns {Array} icqq格式消息段
     */
    toIcqq(segments) {
        return segments.map(seg => {
            const data = seg.data || {}
            return { type: seg.type, ...data }
        })
    },

    /**
     * 解析CQ码字符串为消息段数组
     * @param {string} cqString - CQ码字符串
     * @returns {Array} 消息段数组
     */
    parseCQCode(cqString) {
        if (!cqString) return []
        
        const segments = []
        const regex = /\[CQ:([^,\]]+)(?:,([^\]]*))?\]|([^\[\]]+)/g
        let match
        
        while ((match = regex.exec(cqString)) !== null) {
            if (match[3]) {
                // 普通文本
                segments.push({ type: 'text', data: { text: match[3] } })
            } else {
                // CQ码
                const type = match[1]
                const paramsStr = match[2] || ''
                const data = {}
                
                if (paramsStr) {
                    paramsStr.split(',').forEach(param => {
                        const [key, ...valueParts] = param.split('=')
                        const value = valueParts.join('=')
                            .replace(/&#91;/g, '[')
                            .replace(/&#93;/g, ']')
                            .replace(/&#44;/g, ',')
                            .replace(/&amp;/g, '&')
                        if (key) data[key] = value
                    })
                }
                
                segments.push({ type, data })
            }
        }
        
        return segments
    },

    /**
     * 将消息段数组转换为CQ码字符串
     * @param {Array} segments - 消息段数组
     * @returns {string} CQ码字符串
     */
    toCQCode(segments) {
        return MessageUtils.toCQCode(segments)
    }
}

/**
 * 转发消息构建器
 */
export class ForwardBuilder {
    constructor() {
        this.nodes = []
        this.options = {}
    }

    /**
     * 添加自定义节点
     * @param {string|number} userId - 发送者QQ
     * @param {string} nickname - 发送者昵称
     * @param {Array|string} content - 消息内容
     * @param {number} time - 时间戳（可选）
     */
    addNode(userId, nickname, content, time) {
        this.nodes.push(segment.nodeCustom(userId, nickname, content, time))
        return this
    }

    /**
     * 添加消息ID节点（引用现有消息）
     * @param {string} messageId - 消息ID
     */
    addMessageId(messageId) {
        this.nodes.push(segment.nodeId(messageId))
        return this
    }

    /**
     * 批量添加文本消息节点
     * @param {Array<{user_id, nickname, text}>} messages - 消息列表
     */
    addTexts(messages) {
        messages.forEach(msg => {
            this.addNode(msg.user_id || '10000', msg.nickname || '用户', msg.text || msg.content || '')
        })
        return this
    }

    /**
     * 设置外显选项
     * @param {Object} opts - { prompt, summary, source }
     */
    setOptions(opts) {
        this.options = { ...this.options, ...opts }
        return this
    }

    /**
     * 构建节点数组
     */
    build() {
        return this.nodes
    }

    /**
     * 获取完整配置
     */
    getConfig() {
        return {
            nodes: this.nodes,
            ...this.options
        }
    }

    /**
     * 静态创建方法
     */
    static create() {
        return new ForwardBuilder()
    }
}


/**
 * 标准化消息API - 兼容多平台
 * 提供统一的消息发送和获取接口
 */
export const MessageApi = {
    /**
     * 获取消息（支持多平台）- 返回完整统一格式
     * @param {Object} e - 事件对象
     * @param {string|number} messageId - 消息ID（可以是 message_id 或 seq）
     * @param {Object} options - 选项
     * @param {boolean} options.useSeq - 是否使用 seq 方式获取（icqq）
     * @returns {Promise<Object|null>} 返回统一格式的消息对象
     */
    async getMsg(e, messageId, options = {}) {
        if (!e || !messageId) return null
        const bot = e.bot || Bot
        const { useSeq = false } = options
        
        let rawMsg = null
        let source = 'unknown'
        
        try {
            // NapCat/OneBot: bot.getMsg 或 sendApi（使用 message_id）
            if (!useSeq && typeof bot?.getMsg === 'function') {
                rawMsg = await bot.getMsg(messageId)
                source = 'bot.getMsg'
            }
            else if (!useSeq && typeof bot?.sendApi === 'function') {
                const result = await bot.sendApi('get_msg', { message_id: messageId })
                rawMsg = result?.data || result
                source = 'sendApi.get_msg'
            }
            // icqq: group.getMsg（使用 seq）
            else if (e.isGroup && e.group?.getMsg) {
                rawMsg = await e.group.getMsg(messageId)
                source = 'group.getMsg'
            }
            // icqq: group.getChatHistory
            else if (e.isGroup && e.group?.getChatHistory) {
                const history = await e.group.getChatHistory(messageId, 1)
                rawMsg = history?.[0] || null
                source = 'group.getChatHistory'
            }
            // icqq: friend.getChatHistory
            else if (!e.isGroup && e.friend?.getChatHistory) {
                const history = await e.friend.getChatHistory(messageId, 1)
                rawMsg = history?.[0] || null
                source = 'friend.getChatHistory'
            }
            
            if (!rawMsg) return null
            
            // 统一格式化返回
            const data = rawMsg.data || rawMsg
            return {
                // 消息标识
                message_id: data.message_id || rawMsg.message_id || messageId,
                seq: data.seq || rawMsg.seq || data.message_seq || 0,
                rand: data.rand || rawMsg.rand || 0,
                time: data.time || rawMsg.time || 0,
                // 发送者
                user_id: data.user_id || data.sender?.user_id || rawMsg.user_id || 0,
                sender: {
                    user_id: data.sender?.user_id || data.user_id || rawMsg.user_id || 0,
                    nickname: data.sender?.nickname || data.nickname || rawMsg.nickname || '',
                    card: data.sender?.card || data.card || rawMsg.card || '',
                    role: data.sender?.role || 'member',
                    uid: data.sender?.uid || data.uid || ''
                },
                // 群信息
                group_id: data.group_id || rawMsg.group_id || e.group_id || '',
                // 消息内容
                message: data.message || rawMsg.message || [],
                raw_message: data.raw_message || rawMsg.raw_message || '',
                // 原始数据
                _raw: rawMsg,
                _source: source
            }
        } catch (err) {
            logger.debug('[MessageApi] getMsg failed:', err.message)
        }
        return null
    },

    /**
     * 获取转发消息内容
     * @param {Object} e - 事件对象  
     * @param {string} resid - 转发消息ID
     * @returns {Promise<Array|null>}
     */
    async getForwardMsg(e, resid) {
        if (!e || !resid) return null
        const bot = e.bot || Bot
        
        try {
            // NapCat/OneBot: sendApi
            if (typeof bot?.sendApi === 'function') {
                const result = await bot.sendApi('get_forward_msg', { id: resid })
                return result?.data?.messages || result?.messages || null
            }
            // icqq: group.getForwardMsg
            if (e.group?.getForwardMsg) {
                return await e.group.getForwardMsg(resid)
            }
            // bot.getForwardMsg
            if (typeof bot?.getForwardMsg === 'function') {
                return await bot.getForwardMsg(resid)
            }
        } catch (err) {
            logger.debug('[MessageApi] getForwardMsg failed:', err.message)
        }
        return null
    },

    /**
     * 发送私聊消息
     * @param {Object} e - 事件对象
     * @param {string|number} userId - 用户ID
     * @param {Array|string} message - 消息内容
     * @returns {Promise<Object|null>}
     */
    async sendPrivateMsg(e, userId, message) {
        const bot = e?.bot || Bot
        
        try {
            if (typeof bot?.sendPrivateMsg === 'function') {
                return await bot.sendPrivateMsg(userId, message)
            }
            if (typeof bot?.sendApi === 'function') {
                return await bot.sendApi('send_private_msg', { user_id: userId, message })
            }
            if (typeof bot?.pickFriend === 'function') {
                const friend = bot.pickFriend(userId)
                if (friend?.sendMsg) {
                    return await friend.sendMsg(message)
                }
            }
        } catch (err) {
            logger.debug('[MessageApi] sendPrivateMsg failed:', err.message)
        }
        return null
    },

    /**
     * 发送群消息
     * @param {Object} e - 事件对象
     * @param {string|number} groupId - 群号
     * @param {Array|string} message - 消息内容
     * @returns {Promise<Object|null>}
     */
    async sendGroupMsg(e, groupId, message) {
        const bot = e?.bot || Bot
        
        try {
            if (typeof bot?.sendGroupMsg === 'function') {
                return await bot.sendGroupMsg(groupId, message)
            }
            if (typeof bot?.sendApi === 'function') {
                return await bot.sendApi('send_group_msg', { group_id: groupId, message })
            }
            if (typeof bot?.pickGroup === 'function') {
                const group = bot.pickGroup(groupId)
                if (group?.sendMsg) {
                    return await group.sendMsg(message)
                }
            }
        } catch (err) {
            logger.debug('[MessageApi] sendGroupMsg failed:', err.message)
        }
        return null
    },

    /**
     * 撤回消息
     * @param {Object} e - 事件对象
     * @param {string|number} messageId - 消息ID
     * @returns {Promise<boolean>}
     */
    async deleteMsg(e, messageId) {
        const bot = e?.bot || Bot
        
        try {
            if (typeof bot?.deleteMsg === 'function') {
                await bot.deleteMsg(messageId)
                return true
            }
            if (typeof bot?.recallMsg === 'function') {
                await bot.recallMsg(messageId)
                return true
            }
            if (typeof bot?.sendApi === 'function') {
                await bot.sendApi('delete_msg', { message_id: messageId })
                return true
            }
        } catch (err) {
            logger.debug('[MessageApi] deleteMsg failed:', err.message)
        }
        return false
    },

    /**
     * 获取群成员信息
     * @param {Object} e - 事件对象
     * @param {string|number} groupId - 群号
     * @param {string|number} userId - 用户ID
     * @returns {Promise<Object|null>}
     */
    async getGroupMemberInfo(e, groupId, userId) {
        const bot = e?.bot || Bot
        
        try {
            if (typeof bot?.getGroupMemberInfo === 'function') {
                return await bot.getGroupMemberInfo(groupId, userId)
            }
            if (typeof bot?.sendApi === 'function') {
                const result = await bot.sendApi('get_group_member_info', { 
                    group_id: groupId, 
                    user_id: userId 
                })
                return result?.data || result
            }
            if (typeof bot?.pickGroup === 'function') {
                const group = bot.pickGroup(groupId)
                if (group?.pickMember) {
                    const member = group.pickMember(userId)
                    return member?.info || null
                }
            }
        } catch (err) {
            logger.debug('[MessageApi] getGroupMemberInfo failed:', err.message)
        }
        return null
    },

    /**
     * 获取图片信息（通过file_id获取URL）
     * @param {Object} e - 事件对象
     * @param {string} fileId - 文件ID
     * @returns {Promise<{url: string}|null>}
     */
    async getImage(e, fileId) {
        const bot = e?.bot || Bot
        
        try {
            if (typeof bot?.sendApi === 'function') {
                const result = await bot.sendApi('get_image', { file_id: fileId })
                return result?.data || result
            }
        } catch (err) {
            logger.debug('[MessageApi] getImage failed:', err.message)
        }
        return null
    }
}


/**
 * 消息数组工具
 */
export const MessageUtils = {
    /**
     * 提取所有文本内容
     * @param {Array} segments - 消息段数组
     * @returns {string}
     */
    extractText(segments) {
        if (!Array.isArray(segments)) return ''
        return segments
            .filter(s => s.type === 'text')
            .map(s => s.data?.text || s.text || '')
            .join('')
    },

    /**
     * 提取所有图片
     * @param {Array} segments - 消息段数组
     * @returns {Array<{file: string, url?: string}>}
     */
    extractImages(segments) {
        if (!Array.isArray(segments)) return []
        return segments
            .filter(s => s.type === 'image')
            .map(s => ({
                file: s.data?.file || s.file,
                url: s.data?.url || s.url
            }))
    },

    /**
     * 判断消息是否包含指定类型
     * @param {Array} segments
     * @param {string} type
     * @returns {boolean}
     */
    hasType(segments, type) {
        if (!Array.isArray(segments)) return false
        return segments.some(s => s.type === type)
    },

    /**
     * 获取指定类型的消息段
     * @param {Array} segments
     * @param {string} type
     * @returns {Array}
     */
    getByType(segments, type) {
        if (!Array.isArray(segments)) return []
        return segments.filter(s => s.type === type)
    },

    /**
     * 将消息段数组转换为CQ码字符串
     * @param {Array} segments
     * @returns {string}
     */
    toCQCode(segments) {
        if (!Array.isArray(segments)) return ''
        return segments.map(seg => {
            if (seg.type === 'text') {
                return seg.data?.text || seg.text || ''
            }
            const data = seg.data || seg
            const params = Object.entries(data)
                .filter(([k, v]) => k !== 'type' && v !== undefined && v !== null)
                .map(([k, v]) => `${k}=${String(v).replace(/[&\[\],]/g, c => `&#${c.charCodeAt(0)};`)}`)
                .join(',')
            return `[CQ:${seg.type}${params ? ',' + params : ''}]`
        }).join('')
    }
}
