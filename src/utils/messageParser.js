/**
 * @param {Object} segment - 消息段
 * @returns {Object} 统一的数据对象
 */
function getSegmentData(segment) {
    if (!segment) return {}
    // NC/OneBot 格式: 数据在 data 字段中
    if (segment.data && typeof segment.data === 'object') {
        return { ...segment.data, _type: segment.type }
    }
    return segment
}

/**
 * @param {Object} data - 消息段数据
 * @param {boolean} debug - 是否输出调试日志
 * @returns {string|null} URL
 */
function getMediaUrl(data, debug = false) {
    if (!data) return null
    const innerData = data.data || data

    if (debug) {
        logger.debug(
            '[getMediaUrl] 输入数据:',
            JSON.stringify({
                hasData: !!data.data,
                keys: Object.keys(data),
                innerKeys: Object.keys(innerData),
                url: innerData.url,
                file: innerData.file,
                path: innerData.path,
                file_id: innerData.file_id
            })
        )
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
        data.image
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
 * 获取 bface 原创表情的图片 URL
 * @param {string} file - bface 的 file 哈希值
 * @returns {string|null} 图片 URL
 */
export function getBfaceUrl(file) {
    if (!file || typeof file !== 'string' || file.length < 32) {
        return null
    }
    return `https://gxh.vip.qq.com/club/item/parcel/item/${file.substring(0, 2)}/${file.substring(0, 32)}/raw300.gif`
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
        includeDebugInfo = false, // 是否包含调试信息
        includeSenderInfo = true // 是否包含发送者信息
    } = options

    const contents = []
    let text = ''
    let quoteInfo = null
    let forwardInfo = null

    // 调试信息收集
    const debugInfo = includeDebugInfo
        ? {
              originalMessage: e.message,
              rawMessage: e.raw_message,
              hasSource: !!e.source,
              hasForward: false,
              parseSteps: [],
              errors: []
          }
        : null

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

                        logger.debug(
                            `[MessageParser][AT] 解析@消息: qq=${qq}, atCard=${atCard}, excludeAtBot=${excludeAtBot}, self_id=${e.self_id}`
                        )

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
                                            logger.debug(
                                                `[MessageParser][AT] 从 pickMember 获取: card=${groupCard}, nickname=${nickname}, role=${role}`
                                            )
                                        }
                                        if (!memberInfo && group.getMemberMap) {
                                            try {
                                                const memberMap = await group.getMemberMap()
                                                const memberData = memberMap?.get?.(parseInt(qq))
                                                if (memberData) {
                                                    groupCard = memberData.card || ''
                                                    nickname = memberData.nickname || nickname
                                                    role = memberData.role || ''
                                                    title = memberData.title || ''
                                                    logger.debug(
                                                        `[MessageParser][AT] 从 getMemberMap 获取: card=${groupCard}, nickname=${nickname}, role=${role}`
                                                    )
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
                        const displayName = groupCard || nickname || atCard || `用户${qq}`
                        let atText = `[提及用户 QQ:${qq}`
                        if (groupCard) atText += ` 群名片:"${groupCard}"`
                        if (nickname && nickname !== groupCard) atText += ` 昵称:"${nickname}"`
                        if (role && role !== 'member')
                            atText += ` 角色:${role === 'owner' ? '群主' : role === 'admin' ? '管理员' : role}`
                        if (title) atText += ` 头衔:"${title}"`
                        atText += ']'

                        logger.debug(`[MessageParser][AT] 最终文本: ${atText}`)
                        text += ` ${atText} `
                        contents.push({
                            type: 'at_info',
                            at: {
                                qq: String(qq),
                                uid: uid ? String(uid) : '',
                                name: atCard || '',
                                display: displayName,
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
                    let imgUrl = getMediaUrl(segData, true) || val.url
                    if (!imgUrl && segData.file_id && e.bot?.sendApi) {
                        try {
                            logger.debug(`[MessageParser][Image] 尝试通过 file_id 获取: ${segData.file_id}`)
                            const fileInfo = await e.bot.sendApi('get_image', { file_id: segData.file_id })
                            imgUrl = fileInfo?.data?.url || fileInfo?.url
                            if (imgUrl) {
                            }
                        } catch (err) {
                            logger.warn(`[MessageParser][Image] get_image API 失败:`, err.message)
                        }
                    }
                    if (!imgUrl && segData.file && e.bot?.sendApi) {
                        try {
                            logger.debug(`[MessageParser][Image] 尝试通过 file 获取: ${segData.file}`)
                            const fileInfo = await e.bot.sendApi('get_image', { file: segData.file })
                            imgUrl = fileInfo?.data?.url || fileInfo?.url
                            if (imgUrl) {
                                logger.debug(
                                    `[MessageParser][Image] 通过 get_image(file) 获取成功: ${imgUrl.substring(0, 80)}...`
                                )
                            }
                        } catch (err) {
                            logger.debug(`[MessageParser][Image] get_image(file) 失败:`, err.message)
                        }
                    }

                    logger.debug(`[MessageParser][Image] 最终 URL: ${imgUrl || '无'}`)

                    if (imgUrl) {
                        try {
                            if (imgUrl.startsWith('http')) {
                                // QQ图片需要预先下载（需要特殊referer）
                                if (isQQPicUrl(imgUrl)) {
                                    const imageData = await fetchImage(imgUrl)
                                    if (imageData) {
                                        contents.push({
                                            type: 'image',
                                            image: imageData.base64,
                                            mimeType: imageData.mimeType,
                                            source: 'message'
                                        })
                                    } else {
                                        // 下载失败时记录文本
                                        text += `[图片:${imgUrl.substring(0, 50)}...]`
                                    }
                                } else {
                                    contents.push({
                                        type: 'image_url',
                                        image_url: { url: imgUrl },
                                        source: 'message'
                                    })
                                }
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
                        logger.warn(
                            '[MessageParser][Image] 无法获取图片URL，原始数据:',
                            JSON.stringify(val).substring(0, 300)
                        )
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

                case 'bface': {
                    // 原创表情/大表情 (icqq/TRSS)
                    // 消息结构: { type: 'bface', file: 'hash...', text: '[表情名]' }
                    const bfaceFile = segData.file || val.file || ''
                    const bfaceName = segData.text || val.text || ''
                    const bfaceUrl = getBfaceUrl(bfaceFile)

                    if (bfaceUrl) {
                        logger.debug(
                            `[MessageParser][Bface] 原创表情: name=${bfaceName}, file=${bfaceFile.substring(0, 32)}..., url=${bfaceUrl}`
                        )

                        contents.push({
                            type: 'image_url',
                            image_url: { url: bfaceUrl },
                            source: 'bface',
                            bface: {
                                file: bfaceFile,
                                name: bfaceName,
                                url: bfaceUrl
                            }
                        })
                    } else {
                        text += `[原创表情${bfaceName ? ':' + bfaceName : ''}]`
                    }
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
                    const rpsMap = { 0: '石头', 1: '石头', 2: '剪刀', 3: '布', 4: '剪刀', 5: '布' }
                    const rpsName = rpsMap[rpsResult] || rpsResult
                    text += `[猜拳:${rpsName}]`
                    contents.push({ type: 'rps_info', result: rpsResult, name: rpsName })
                    break
                }

                case 'new_rps': {
                    // 新版猜拳 (NC)
                    const newRpsResult = segData.result || segData.value || val.result || '?'
                    const newRpsMap = { 0: '石头', 1: '石头', 2: '剪刀', 3: '布' }
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
        debugInfo.finalTextLength = contents
            .filter(c => c.type === 'text')
            .map(c => c.text?.length || 0)
            .reduce((a, b) => a + b, 0)
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
        card: sender.card || '', // 群名片
        role: sender.role || 'member', // owner/admin/member
        level: sender.level || 0, // 群等级
        title: sender.title || '', // 专属头衔
        user_uid: sender.user_uid || e.user_uid || '' // QQNT uid
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

    const isNapCatPlatform = NapCatMessageUtils.isNapCat(e)

    try {
        let replyData = null
        let replySenderId = null
        let replySenderName = null
        if (e.getReply && typeof e.getReply === 'function') {
            try {
                const reply = await e.getReply()
                if (reply) {
                    replyData = reply
                    const replyInfo = reply.data || reply
                    replySenderId = replyInfo.user_id || replyInfo.sender?.user_id || reply.user_id
                    replySenderName =
                        replyInfo.sender?.card || replyInfo.sender?.nickname || replyInfo.nickname || reply.nickname
                }
            } catch (err) {}
        }
        if (!replyData && e.source) {
            const msgId = e.source.message_id || e.source.id
            const seq = e.isGroup ? e.source.seq || msgId || e.reply_id : e.source.time || e.source.seq

            if (seq || msgId) {
                if (e.isGroup || e.group_id) {
                    if (!replyData && isNapCatPlatform && msgId) {
                        try {
                            const napCatMsg = await NapCatMessageUtils.getFullMessage(e, msgId)
                            if (napCatMsg) {
                                replyData = napCatMsg
                            }
                        } catch (err) {
                            parseLog.push(`[Reply] NapCat getFullMessage 失败: ${err.message}`)
                        }
                    }

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
                    if (!replyData && e.bot?.sendApi && msgId) {
                        try {
                            replyData = await e.bot.sendApi('get_msg', { message_id: msgId })
                            if (replyData?.data) replyData = replyData.data
                        } catch (err) {}
                    }
                    if (!replyData && e.group?.getMsg) {
                        try {
                            replyData = await e.group.getMsg(seq)
                            if (replyData) parseLog.push(`[Reply] group.getMsg 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] group.getMsg 失败: ${err.message}`)
                        }
                    }
                    if (!replyData && e.group?.getChatHistory && seq) {
                        try {
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
                    replySenderName =
                        replyInfo.sender?.card || replyInfo.sender?.nickname || replyInfo.nickname || replyData.nickname
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
        const senderLabel = isQuotingBot ? 'AI助手' : replySenderName || '用户'

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
                        parseLog.push(
                            `[Reply][Image] 原始数据: ${JSON.stringify({
                                type: val.type,
                                url: valData.url,
                                file: valData.file,
                                path: valData.path,
                                file_id: valData.file_id
                            })}`
                        )

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
                                    // QQ图片需要预先下载（需要特殊referer）
                                    if (isQQPicUrl(imgUrl)) {
                                        const imageData = await fetchImage(imgUrl)
                                        if (imageData) {
                                            contents.push({
                                                type: 'image',
                                                image: imageData.base64,
                                                mimeType: imageData.mimeType,
                                                source: 'reply'
                                            })
                                        } else {
                                            replyTextContent += `[图片:${imgUrl.substring(0, 30)}...]`
                                        }
                                    } else {
                                        contents.push({
                                            type: 'image_url',
                                            image_url: { url: imgUrl },
                                            source: 'reply'
                                        })
                                    }
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

                case 'bface': {
                    // 原创表情/大表情 (icqq/TRSS)
                    const bfaceFile = valData.file || val.file || ''
                    const bfaceName = valData.text || val.text || ''
                    const bfaceUrl = getBfaceUrl(bfaceFile)

                    if (bfaceUrl && handleReplyImage) {
                        parseLog.push(`[Reply][Bface] 原创表情: name=${bfaceName}, url=${bfaceUrl}`)
                        contents.push({
                            type: 'image_url',
                            image_url: { url: bfaceUrl },
                            source: 'reply_bface',
                            bface: {
                                file: bfaceFile,
                                name: bfaceName,
                                url: bfaceUrl
                            }
                        })
                    } else {
                        replyTextContent += `[原创表情${bfaceName ? ':' + bfaceName : ''}]`
                    }
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
                                replyTextContent +=
                                    '(要转发此卡片请使用resend_quoted_card工具,如需伪造消息则设置as_forward=true)'
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
            const truncatedQuote =
                replyTextContent.length > maxQuoteLen
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

    // 防止无限递归，最多5层嵌套
    const MAX_DEPTH = 50
    if (depth >= MAX_DEPTH) {
        parseLog.push(`[Forward] 达到最大深度 ${MAX_DEPTH}，停止解析`)
        return { text: '[嵌套转发消息，层级过深]', contents: [], forwardInfo: null }
    }

    // 用于收集所有待解析的转发消息（循环解析）
    const pendingForwards = []

    try {
        // 尝试获取转发消息内容 - 支持多种方式
        let forwardMessages = null
        let parseMethod = ''
        if (forwardElement.data) {
            parseLog.push(`[Forward] data keys: ${Object.keys(forwardElement.data || {}).join(', ')}`)
            // NapCat 文档: content 应该在 [收] 时直接包含
            if (forwardElement.data.content) {
                parseLog.push(`[Forward] data.content 存在, 长度: ${forwardElement.data.content?.length || 0}`)
            }
        }
        if (forwardElement.data?.content && Array.isArray(forwardElement.data.content)) {
            forwardMessages = forwardElement.data.content
            parseMethod = 'data_content'
        } else if (forwardElement.content && Array.isArray(forwardElement.content)) {
            forwardMessages = forwardElement.content
            parseMethod = 'direct_content'
        } else if (forwardElement.message && Array.isArray(forwardElement.message)) {
            forwardMessages = forwardElement.message
            parseMethod = 'message_array'
        } else if (forwardElement.data?.message && Array.isArray(forwardElement.data.message)) {
            forwardMessages = forwardElement.data.message
            parseMethod = 'data_message'
        } else if (forwardElement.id && e.group?.getForwardMsg) {
            try {
                forwardMessages = await e.group.getForwardMsg(forwardElement.id)
                parseMethod = 'group_getForwardMsg_id'
            } catch (err) {}
        } else if (forwardElement.data?.id && e.group?.getForwardMsg) {
            try {
                forwardMessages = await e.group.getForwardMsg(forwardElement.data.id)
                parseMethod = 'group_getForwardMsg_data_id'
            } catch (err) {}
        } else if (forwardElement.resid && e.group?.getForwardMsg) {
            parseLog.push(`[Forward] 尝试通过 resid=${forwardElement.resid} 获取`)
            try {
                forwardMessages = await e.group.getForwardMsg(forwardElement.resid)
                parseMethod = 'group_getForwardMsg_resid'
            } catch (err) {}
        }
        if (!forwardMessages && e.bot?.getForwardMsg) {
            const fwdId = forwardElement.id || forwardElement.data?.id || forwardElement.resid
            if (fwdId) {
                try {
                    forwardMessages = await e.bot.getForwardMsg(fwdId)
                    parseMethod = 'bot_getForwardMsg'
                } catch (err) {}
            }
        }
        if (!forwardMessages && e.bot?.sendApi) {
            const fwdId =
                forwardElement.id || forwardElement.data?.id || forwardElement.resid || forwardElement.data?.resid
            if (fwdId) {
                try {
                    const result = await e.bot.sendApi('get_forward_msg', { id: fwdId })
                    const messages =
                        result?.message || result?.data?.messages || result?.messages || result?.data?.message
                    if (messages && Array.isArray(messages)) {
                        forwardMessages = messages
                        parseMethod = 'sendApi_get_forward_msg'
                    } else if (result) {
                    }
                } catch (err) {}
            }
        }
        if (!forwardMessages && e.source?.message) {
            const sourceMsg = e.source.message
            if (Array.isArray(sourceMsg)) {
                const fwdSeg = sourceMsg.find(s => s.type === 'forward')
                if (fwdSeg?.data?.content || fwdSeg?.data?.message || fwdSeg?.message) {
                    forwardMessages = fwdSeg.data?.content || fwdSeg.data?.message || fwdSeg.message
                    if (Array.isArray(forwardMessages)) {
                        parseMethod = 'source_message'
                    }
                }
            }
        }

        if (forwardMessages && Array.isArray(forwardMessages)) {
            const forwardTexts = []
            const parsedMessages = []
            // 最多处理15条转发消息
            for (let i = 0; i < Math.min(forwardMessages.length, 15); i++) {
                const msg = forwardMessages[i]
                const msgData = msg.data || msg

                // 提取用户信息 - 兼容多种格式
                const userId = msgData.user_id || msgData.uin || msgData.sender?.user_id || msg.user_id || ''
                const nickname =
                    msgData.nickname ||
                    msgData.nick ||
                    msgData.sender?.nickname ||
                    msgData.sender?.card ||
                    msg.nickname ||
                    msg.nick ||
                    `用户${userId || i}`
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

                parseLog.push(
                    `[Forward] 消息 ${i}: user=${userId}, nick=${nickname}, content_len=${messageContent.length}`
                )

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
                            // QQ图片需要预先下载（需要特殊referer）
                            if (isQQPicUrl(imgUrl)) {
                                const imageData = await fetchImage(imgUrl)
                                if (imageData) {
                                    contents.push({
                                        type: 'image',
                                        image: imageData.base64,
                                        mimeType: imageData.mimeType,
                                        source: 'forward'
                                    })
                                }
                            } else {
                                contents.push({
                                    type: 'image_url',
                                    image_url: { url: imgUrl },
                                    source: 'forward'
                                })
                            }
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
                    } else if (valType === 'bface') {
                        // 原创表情/大表情
                        const bfaceFile = valData.file || val.file || ''
                        const bfaceName = valData.text || val.text || ''
                        const bfaceUrl = getBfaceUrl(bfaceFile)
                        forwardTexts.push(`${nickname}: [原创表情${bfaceName ? ':' + bfaceName : ''}]`)
                        msgInfo.content.push({ type: 'bface', file: bfaceFile, name: bfaceName, url: bfaceUrl })
                        if (bfaceUrl) {
                            contents.push({
                                type: 'image_url',
                                image_url: { url: bfaceUrl },
                                source: 'forward_bface',
                                bface: { file: bfaceFile, name: bfaceName, url: bfaceUrl }
                            })
                        }
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
                    } else if (valType === 'json') {
                        // JSON 卡片消息 - 尝试解析内容
                        try {
                            const jsonStr = valData.data || val.data || ''
                            const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr

                            // 检查是否是嵌套的合并转发
                            if (jsonData.app === 'com.tencent.multimsg') {
                                const resid = jsonData.meta?.detail?.resid
                                if (resid) {
                                    // 递归解析嵌套转发
                                    const nestedResult = await parseForwardMessage(e, { id: resid, resid }, depth + 1)
                                    if (nestedResult.text) {
                                        forwardTexts.push(`${nickname}: ${nestedResult.text}`)
                                    } else {
                                        // 使用预览信息
                                        const preview =
                                            jsonData.meta?.detail?.news?.map(n => n.text).join('\n') || '[嵌套转发]'
                                        forwardTexts.push(`${nickname}: ${preview}`)
                                    }
                                    contents.push(...nestedResult.contents)
                                    msgInfo.content.push({ type: 'forward', nested: true, parsed: !!nestedResult.text })
                                } else {
                                    const preview =
                                        jsonData.meta?.detail?.news?.map(n => n.text).join('\n') || '[转发消息]'
                                    forwardTexts.push(`${nickname}: ${preview}`)
                                    msgInfo.content.push({ type: 'forward', preview })
                                }
                            } else {
                                // 其他 JSON 卡片 - 提取关键信息
                                const prompt = jsonData.prompt || jsonData.desc || jsonData.meta?.detail?.desc || ''
                                const title = jsonData.meta?.detail?.title || jsonData.meta?.news?.title || ''
                                const cardInfo = title ? `[卡片:${title}]` : prompt ? `[卡片:${prompt}]` : '[JSON卡片]'
                                forwardTexts.push(`${nickname}: ${cardInfo}`)
                                msgInfo.content.push({ type: 'json', prompt, title, app: jsonData.app })
                            }
                        } catch {
                            forwardTexts.push(`${nickname}: [JSON消息]`)
                            msgInfo.content.push({ type: 'json' })
                        }
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
 * 检查是否为QQ图片URL（需要特殊referer处理）
 */
function isQQPicUrl(url) {
    return url && (url.includes('gchat.qpic.cn') || url.includes('c2cpicdw.qpic.cn'))
}

/**
 * 获取图片并转为 base64
 * @param {string} url - 图片URL
 * @param {Object} options - 选项
 * @param {string} options.referer - 自定义Referer
 */
async function fetchImage(url, options = {}) {
    if (!url) return null

    try {
        // QQ图片需要特殊的 Referer
        const isQQPic = isQQPicUrl(url)
        const referer = options.referer || (isQQPic ? 'https://qzone.qq.com/' : undefined)

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...(referer && { Referer: referer })
            }
        })
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

    return (
        text
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
    )
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
    raw: data => ({ type: 'raw', data }),
    /** 文本消息 */
    text: text => ({ type: 'text', data: { text: String(text) } }),
    image: (file, opts = {}) => ({
        type: 'image',
        file, // icqq 格式
        ...opts, // icqq 其他参数
        data: { file, ...opts } // NC/OneBot 格式
    }),

    /** @消息 - qq可以是QQ号或'all' */
    at: (qq, name) => ({
        type: 'at',
        data: { qq: String(qq), ...(name ? { name } : {}) }
    }),

    /** 引用回复 */
    reply: id => ({ type: 'reply', data: { id: String(id) } }),

    /** QQ表情 */
    face: id => ({ type: 'face', data: { id: Number(id) } }),

    /** 语音消息 */
    record: file => ({ type: 'record', file, data: { file } }),

    /** 视频消息 */
    video: (file, thumb) => ({
        type: 'video',
        file, // icqq 格式
        ...(thumb ? { thumb } : {}),
        data: { file, ...(thumb ? { thumb } : {}) } // NC/OneBot 格式
    }),

    /** JSON卡片消息 */
    json: data => ({
        type: 'json',
        data: { data: typeof data === 'string' ? data : JSON.stringify(data) }
    }),

    /** XML消息 */
    xml: data => ({ type: 'xml', data: { data } }),

    /** 转发消息 */
    forward: id => ({ type: 'forward', data: { id } }),

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
        file, // icqq 格式
        ...(name ? { name } : {}),
        data: { file, ...(name ? { name } : {}) } // NC/OneBot 格式
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
        data: typeof content === 'object' ? content : { content, ...(params || {}) }
    }),

    /** 按钮键盘 (NapCat) */
    keyboard: content => ({
        type: 'keyboard',
        data: typeof content === 'object' ? content : { content }
    }),

    /** 推荐联系人/群 */
    contact: (type, id) => ({ type: 'contact', data: { type, id: String(id) } }),

    /** TTS语音 */
    tts: text => ({ type: 'tts', data: { text } }),

    /** 触摸/拍一拍 */
    touch: id => ({ type: 'touch', data: { id: String(id) } }),
    /** 礼物消息 */
    gift: (qq, id) => ({ type: 'gift', data: { qq: String(qq), id } }),
    /** 窗口抖动 */
    shake: () => ({ type: 'shake', data: {} }),
    /** 匿名消息 */
    anonymous: (ignore = false) => ({ type: 'anonymous', data: { ignore: ignore ? 1 : 0 } }),
    /** 按钮消息  */
    button: buttons => ({ type: 'button', data: { buttons } }),
    /** 气泡表情 */
    bubble_face: (id, count = 1) => ({ type: 'bubble_face', data: { id, count } }),
    /** 篮球表情 */
    basketball: () => ({ type: 'basketball', data: {} }),
    /** 新版骰子 (可指定点数 1-6，默认随机) */
    new_dice: value => ({ type: 'new_dice', data: value ? { id: value } : {} }),
    /** 新版猜拳 (可指定 1石头/2剪刀/3布，默认随机) */
    new_rps: value => ({ type: 'new_rps', data: value ? { id: value } : {} }),
    /** 长消息 (NapCat) */
    long_msg: id => ({ type: 'long_msg', data: { id } }),
    /** 天气分享 (NapCat) */
    weather: (city, code) => ({ type: 'weather', data: { city, code } }),

    /**
     * 多图消息 - 发送多张图片
     * @param {Array<string>} urls - 图片URL数组
     */
    images: urls => urls.map(url => ({ type: 'image', file: url, data: { file: url } })),

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
    flash: file => ({
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
    nodeId: id => ({
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
    musicCustom: data => ({
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
            } else if (!useSeq && typeof bot?.sendApi === 'function') {
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
 * icqq 消息工具 - 处理消息序列化/反序列化
 * 基于 icqq 的 Message 和 ForwardMessage 类
 */
export const IcqqMessageUtils = {
    /**
     * @returns {Object|null} icqq 模块
     */
    getIcqq() {
        try {
            // 尝试从全局获取
            if (global.icqq) return global.icqq
            try {
                return require('icqq')
            } catch {
                return null
            }
        } catch {
            return null
        }
    },

    /**
     * 序列化消息为 Buffer
     * @param {Object} message - icqq Message 对象
     * @returns {Buffer|null}
     */
    serializeMessage(message) {
        try {
            if (message && typeof message.serialize === 'function') {
                return message.serialize()
            }
            return null
        } catch (err) {
            logger.debug('[IcqqMessageUtils] serializeMessage failed:', err.message)
            return null
        }
    },

    /**
     * 反序列化消息
     * @param {Buffer} buffer - 序列化的消息数据
     * @param {number} uin - QQ号（私聊消息需要）
     * @returns {Object|null} Message 对象
     */
    deserializeMessage(buffer, uin) {
        try {
            const icqq = this.getIcqq()
            if (!icqq?.Message?.deserialize) {
                logger.debug('[IcqqMessageUtils] icqq.Message.deserialize not available')
                return null
            }
            return icqq.Message.deserialize(buffer, uin)
        } catch (err) {
            logger.debug('[IcqqMessageUtils] deserializeMessage failed:', err.message)
            return null
        }
    },

    /**
     * 序列化转发消息为 Buffer
     * @param {Object} forwardMessage - icqq ForwardMessage 对象
     * @returns {Buffer|null}
     */
    serializeForwardMessage(forwardMessage) {
        try {
            if (forwardMessage && typeof forwardMessage.serialize === 'function') {
                return forwardMessage.serialize()
            }
            return null
        } catch (err) {
            logger.debug('[IcqqMessageUtils] serializeForwardMessage failed:', err.message)
            return null
        }
    },

    /**
     * 反序列化转发消息
     * @param {Buffer} buffer - 序列化的转发消息数据
     * @returns {Object|null} ForwardMessage 对象
     */
    deserializeForwardMessage(buffer) {
        try {
            const icqq = this.getIcqq()
            if (!icqq?.ForwardMessage?.deserialize) {
                logger.debug('[IcqqMessageUtils] icqq.ForwardMessage.deserialize not available')
                return null
            }
            return icqq.ForwardMessage.deserialize(buffer)
        } catch (err) {
            logger.debug('[IcqqMessageUtils] deserializeForwardMessage failed:', err.message)
            return null
        }
    },

    /**
     * 从消息对象提取 proto 数据
     * @param {Object} message - 消息对象
     * @returns {Object|null} proto 数据
     */
    extractProto(message) {
        if (!message) return null
        // icqq Message 对象的 proto 是 protected，但可以通过某些方式访问
        // 尝试直接访问
        if (message.proto) return message.proto
        // 尝试通过 _proto 访问
        if (message._proto) return message._proto
        // 尝试通过序列化后再解析
        try {
            const buffer = this.serializeMessage(message)
            if (buffer) {
                return this.decodeProtobuf(buffer)
            }
        } catch {}
        return null
    },

    /**
     * 从转发消息提取完整数据
     * @param {Object} forwardMsg - 转发消息对象
     * @returns {Object} 完整数据
     */
    extractForwardData(forwardMsg) {
        if (!forwardMsg) return null

        const result = {
            user_id: forwardMsg.user_id || 0,
            nickname: forwardMsg.nickname || '',
            group_id: forwardMsg.group_id || null,
            time: forwardMsg.time || 0,
            seq: forwardMsg.seq || 0,
            message: forwardMsg.message || [],
            raw_message: forwardMsg.raw_message || '',
            proto: null,
            serialized: null
        }

        // 尝试获取 proto
        if (forwardMsg.proto) {
            result.proto = forwardMsg.proto
        }

        // 尝试序列化
        const buffer = this.serializeForwardMessage(forwardMsg)
        if (buffer) {
            result.serialized = buffer.toString('base64')
        }

        return result
    }
}

/**
 * Protobuf 编解码工具
 * 基于 icqq.core.pb
 */
export const ProtobufUtils = {
    /**
     * 获取 icqq.core.pb 模块
     * @returns {Object|null}
     */
    getPb() {
        try {
            const icqq = IcqqMessageUtils.getIcqq()
            return icqq?.core?.pb || null
        } catch {
            return null
        }
    },

    /**
     * 编码数据为 Protobuf
     * @param {Object} data - 要编码的数据
     * @returns {Buffer|null}
     */
    encode(data) {
        try {
            const pb = this.getPb()
            if (pb?.encode) {
                return pb.encode(data)
            }
            return null
        } catch (err) {
            logger.debug('[ProtobufUtils] encode failed:', err.message)
            return null
        }
    },

    /**
     * 解码 Protobuf 数据
     * @param {Buffer} buffer - Protobuf 数据
     * @returns {Object|null}
     */
    decode(buffer) {
        try {
            const pb = this.getPb()
            if (pb?.decode) {
                return pb.decodePb(buffer)
            }
            // 尝试使用 decode
            if (pb?.decodePb) {
                return pb.decode(buffer)
            }
            return null
        } catch (err) {
            logger.debug('[ProtobufUtils] decode failed:', err.message)
            return null
        }
    },

    /**
     * 创建 Proto 包装对象
     * @param {Buffer|Object} data - 数据
     * @returns {Object|null}
     */
    createProto(data) {
        try {
            const pb = this.getPb()
            if (pb?.Proto) {
                return new pb.Proto(data)
            }
            return null
        } catch (err) {
            logger.debug('[ProtobufUtils] createProto failed:', err.message)
            return null
        }
    },

    /**
     * 安全解析 Protobuf 数据（带错误处理）
     * @param {Buffer|string} data - Buffer 或 base64 字符串
     * @returns {Object|null}
     */
    safeDecode(data) {
        try {
            let buffer = data
            if (typeof data === 'string') {
                buffer = Buffer.from(data, 'base64')
            }
            if (!Buffer.isBuffer(buffer)) {
                return null
            }
            return this.decode(buffer)
        } catch (err) {
            logger.debug('[ProtobufUtils] safeDecode failed:', err.message)
            return null
        }
    }
}

/**
 * 增强型转发消息解析器
 * 支持提取完整的 pb/pbelem/msgrecord 数据
 */
export const ForwardMessageParser = {
    /**
     * 解析转发消息并提取完整数据
     * @param {Object} e - 事件对象
     * @param {Object|string} forwardElement - 转发消息元素或 resid
     * @param {Object} options - 解析选项
     * @returns {Promise<Object>} 完整的转发消息数据
     */
    async parse(e, forwardElement, options = {}) {
        const {
            extractProto = true, // 是否提取 proto 数据
            extractSerialized = true, // 是否提取序列化数据
            maxDepth = 10, // 最大递归深度
            currentDepth = 0 // 当前深度
        } = options

        const result = {
            success: false,
            messages: [],
            totalCount: 0,
            method: 'unknown',
            proto: null,
            serialized: null,
            raw: null,
            errors: []
        }

        if (currentDepth >= maxDepth) {
            result.errors.push(`达到最大递归深度 ${maxDepth}`)
            return result
        }

        try {
            const bot = e.bot || global.Bot
            let forwardMessages = null
            let rawData = null

            // 获取 resid
            const resid =
                typeof forwardElement === 'string'
                    ? forwardElement
                    : forwardElement?.id ||
                      forwardElement?.data?.id ||
                      forwardElement?.resid ||
                      forwardElement?.data?.resid

            // 方式1: 直接从元素中获取内容
            if (forwardElement?.data?.content && Array.isArray(forwardElement.data.content)) {
                forwardMessages = forwardElement.data.content
                result.method = 'element.data.content'
                rawData = forwardElement
            } else if (forwardElement?.content && Array.isArray(forwardElement.content)) {
                forwardMessages = forwardElement.content
                result.method = 'element.content'
                rawData = forwardElement
            }

            // 方式2: 通过 API 获取
            if (!forwardMessages && resid) {
                // icqq: group.getForwardMsg
                if (e.group?.getForwardMsg) {
                    try {
                        const fwdResult = await e.group.getForwardMsg(resid)
                        if (fwdResult) {
                            forwardMessages = Array.isArray(fwdResult) ? fwdResult : [fwdResult]
                            result.method = 'group.getForwardMsg'
                            rawData = fwdResult
                        }
                    } catch (err) {
                        result.errors.push(`group.getForwardMsg: ${err.message}`)
                    }
                }

                // bot.getForwardMsg
                if (!forwardMessages && bot?.getForwardMsg) {
                    try {
                        const fwdResult = await bot.getForwardMsg(resid)
                        if (fwdResult) {
                            forwardMessages = Array.isArray(fwdResult) ? fwdResult : [fwdResult]
                            result.method = 'bot.getForwardMsg'
                            rawData = fwdResult
                        }
                    } catch (err) {
                        result.errors.push(`bot.getForwardMsg: ${err.message}`)
                    }
                }

                // NapCat/OneBot: sendApi get_forward_msg
                if (!forwardMessages && bot?.sendApi) {
                    try {
                        const apiResult = await bot.sendApi('get_forward_msg', { id: resid })
                        const messages =
                            apiResult?.message ||
                            apiResult?.data?.messages ||
                            apiResult?.messages ||
                            apiResult?.data?.message
                        if (messages && Array.isArray(messages)) {
                            forwardMessages = messages
                            result.method = 'sendApi.get_forward_msg'
                            rawData = apiResult
                        }
                    } catch (err) {
                        result.errors.push(`sendApi.get_forward_msg: ${err.message}`)
                    }
                }
            }

            if (!forwardMessages || !Array.isArray(forwardMessages)) {
                result.errors.push('无法获取转发消息内容')
                return result
            }

            result.success = true
            result.totalCount = forwardMessages.length
            result.raw = rawData

            // 解析每条消息
            for (const msg of forwardMessages) {
                const msgData = msg.data || msg
                const parsedMsg = {
                    user_id: msgData.user_id || msgData.uin || msgData.sender?.user_id || 0,
                    nickname: msgData.nickname || msgData.nick || msgData.sender?.nickname || '',
                    time: msgData.time || 0,
                    group_id: msgData.group_id || null,
                    seq: msgData.seq || 0,
                    message: msgData.content || msgData.message || [],
                    raw_message: msgData.raw_message || '',
                    // 原始消息对象
                    _raw: msg,
                    // Proto 数据
                    proto: null,
                    // 序列化数据
                    serialized: null,
                    // 嵌套转发
                    nested_forward: null
                }

                // 提取 proto 数据 (icqq)
                if (extractProto) {
                    parsedMsg.proto = IcqqMessageUtils.extractProto(msg)
                    // 如果消息对象有 proto 属性
                    if (!parsedMsg.proto && msg.proto) {
                        parsedMsg.proto = msg.proto
                    }
                }

                // 提取序列化数据 (icqq)
                if (extractSerialized) {
                    const serialized = IcqqMessageUtils.serializeForwardMessage(msg)
                    if (serialized) {
                        parsedMsg.serialized = serialized.toString('base64')
                    }
                }

                // 检查是否有嵌套转发
                const messageContent = parsedMsg.message
                if (Array.isArray(messageContent)) {
                    for (const elem of messageContent) {
                        const elemType = elem.type || elem.data?._type
                        if (elemType === 'forward') {
                            // 递归解析嵌套转发
                            const nestedResult = await this.parse(e, elem, {
                                ...options,
                                currentDepth: currentDepth + 1
                            })
                            parsedMsg.nested_forward = nestedResult
                            break
                        }
                        if (elemType === 'json') {
                            // 检查 JSON 是否是合并转发
                            try {
                                const jsonStr = elem.data?.data || elem.data
                                const jsonData = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr
                                if (jsonData?.app === 'com.tencent.multimsg' && jsonData?.meta?.detail?.resid) {
                                    const nestedResult = await this.parse(e, jsonData.meta.detail.resid, {
                                        ...options,
                                        currentDepth: currentDepth + 1
                                    })
                                    parsedMsg.nested_forward = nestedResult
                                    break
                                }
                            } catch {}
                        }
                    }
                }

                result.messages.push(parsedMsg)
            }

            // 尝试获取整体的 proto/serialized
            if (extractProto && rawData) {
                // 尝试从原始数据提取
                if (typeof rawData === 'object') {
                    result.proto = rawData.proto || rawData._proto || null
                }
            }
        } catch (err) {
            result.errors.push(`解析异常: ${err.message}`)
            logger.warn('[ForwardMessageParser] parse failed:', err)
        }

        return result
    },

    /**
     * 将解析结果转换为可读文本
     * @param {Object} parseResult - parse() 的返回结果
     * @param {Object} options - 格式化选项
     * @returns {string}
     */
    toReadableText(parseResult, options = {}) {
        const { maxMessages = 15, includeTime = false } = options

        if (!parseResult?.success || !parseResult.messages?.length) {
            return '[转发消息: 无法解析内容]'
        }

        const lines = [`[转发消息 共${parseResult.totalCount}条]`]
        const messages = parseResult.messages.slice(0, maxMessages)

        for (const msg of messages) {
            const nickname = msg.nickname || `用户${msg.user_id}`
            const timeStr = includeTime && msg.time ? `[${new Date(msg.time * 1000).toLocaleTimeString()}] ` : ''

            // 提取文本内容
            let textContent = ''
            const msgContent = msg.message || []

            for (const elem of msgContent) {
                const elemData = elem.data || elem
                const elemType = elem.type || elemData._type

                switch (elemType) {
                    case 'text':
                        textContent += elemData.text || ''
                        break
                    case 'image':
                        textContent += '[图片]'
                        break
                    case 'face':
                        textContent += '[表情]'
                        break
                    case 'at':
                        textContent += `@${elemData.qq || ''} `
                        break
                    case 'forward':
                        textContent += '[嵌套转发消息]'
                        break
                    case 'video':
                        textContent += '[视频]'
                        break
                    case 'record':
                        textContent += '[语音]'
                        break
                    case 'file':
                        textContent += `[文件:${elemData.name || ''}]`
                        break
                    default:
                        if (elemType) textContent += `[${elemType}]`
                }
            }

            // 如果没有解析出内容，使用 raw_message
            if (!textContent && msg.raw_message) {
                textContent = msg.raw_message
            }

            lines.push(`${timeStr}${nickname}: ${textContent || '[空消息]'}`)
        }

        if (parseResult.totalCount > maxMessages) {
            lines.push(`... 还有 ${parseResult.totalCount - maxMessages} 条消息`)
        }

        lines.push('[转发消息结束]')
        return lines.join('\n')
    },

    /**
     * 提取转发消息中的所有图片 URL
     * @param {Object} parseResult - parse() 的返回结果
     * @returns {Array<string>}
     */
    extractImageUrls(parseResult) {
        const urls = []
        if (!parseResult?.messages) return urls

        const extractFromMessage = msg => {
            const msgContent = msg.message || []
            for (const elem of msgContent) {
                const elemData = elem.data || elem
                if (elem.type === 'image' || elemData._type === 'image') {
                    const url = getMediaUrl(elemData)
                    if (url) urls.push(url)
                }
            }
            // 递归处理嵌套转发
            if (msg.nested_forward?.messages) {
                for (const nestedMsg of msg.nested_forward.messages) {
                    extractFromMessage(nestedMsg)
                }
            }
        }

        for (const msg of parseResult.messages) {
            extractFromMessage(msg)
        }

        return urls
    }
}

/**
 * NapCat 消息工具
 * 处理 NapCat 特有的消息格式
 */
export const NapCatMessageUtils = {
    /**
     * 判断是否是 NapCat 环境
     * @param {Object} e - 事件对象
     * @returns {boolean}
     */
    isNapCat(e) {
        const bot = e?.bot || global.Bot
        // NapCat 通常有 sendApi 方法
        if (typeof bot?.sendApi === 'function') {
            return true
        }
        // 检查适配器名称
        if (bot?.adapter?.name?.toLowerCase?.()?.includes('napcat')) {
            return true
        }
        return false
    },

    /**
     * 获取 NapCat 消息的完整数据
     * @param {Object} e - 事件对象
     * @param {string} messageId - 消息 ID
     * @returns {Promise<Object|null>}
     */
    async getFullMessage(e, messageId) {
        const bot = e?.bot || global.Bot
        if (!bot?.sendApi) return null

        try {
            const result = await bot.sendApi('get_msg', { message_id: messageId })
            return result?.data || result
        } catch (err) {
            logger.debug('[NapCatMessageUtils] getFullMessage failed:', err.message)
            return null
        }
    },

    /**
     * 获取 NapCat 转发消息的完整数据
     * @param {Object} e - 事件对象
     * @param {string} resid - 转发消息 ID
     * @returns {Promise<Object|null>}
     */
    async getForwardMessage(e, resid) {
        const bot = e?.bot || global.Bot
        if (!bot?.sendApi) return null

        try {
            const result = await bot.sendApi('get_forward_msg', { id: resid })
            return {
                messages: result?.message || result?.data?.messages || result?.messages || [],
                raw: result
            }
        } catch (err) {
            logger.debug('[NapCatMessageUtils] getForwardMessage failed:', err.message)
            return null
        }
    },

    /**
     * 将 NapCat 消息格式转换为 icqq 格式
     * @param {Array} segments - NapCat 格式消息段
     * @returns {Array} icqq 格式消息段
     */
    toIcqqFormat(segments) {
        if (!Array.isArray(segments)) return segments
        return segments.map(seg => {
            if (seg.data && typeof seg.data === 'object') {
                return { type: seg.type, ...seg.data }
            }
            return seg
        })
    },

    /**
     * 将 icqq 消息格式转换为 NapCat/OneBot 格式
     * @param {Array} segments - icqq 格式消息段
     * @returns {Array} NapCat/OneBot 格式消息段
     */
    toNapCatFormat(segments) {
        if (!Array.isArray(segments)) return segments
        return segments.map(seg => {
            const { type, ...data } = seg
            return { type, data }
        })
    }
}

/**
 * 消息记录提取器
 * 用于从各种来源提取 msgrecord 数据
 */
export const MsgRecordExtractor = {
    /**
     * 从事件对象提取消息记录
     * @param {Object} e - 事件对象
     * @returns {Object} 消息记录
     */
    fromEvent(e) {
        if (!e) return null

        return {
            // 基础信息
            message_id: e.message_id || '',
            seq: e.seq || 0,
            rand: e.rand || 0,
            time: e.time || 0,
            // 发送者
            user_id: e.user_id || e.sender?.user_id || 0,
            sender: {
                user_id: e.sender?.user_id || e.user_id || 0,
                nickname: e.sender?.nickname || e.nickname || '',
                card: e.sender?.card || '',
                role: e.sender?.role || 'member',
                uid: e.sender?.uid || e.user_uid || ''
            },
            // 群信息
            group_id: e.group_id || null,
            // 消息内容
            message: e.message || [],
            raw_message: e.raw_message || '',
            // icqq 特有
            font: e.font || '',
            // 原始事件
            _event: e
        }
    },

    /**
     * 从 API 响应提取消息记录
     * @param {Object} apiResponse - API 响应
     * @returns {Object} 消息记录
     */
    fromApiResponse(apiResponse) {
        if (!apiResponse) return null
        const data = apiResponse.data || apiResponse

        return {
            message_id: data.message_id || '',
            seq: data.seq || data.message_seq || 0,
            rand: data.rand || 0,
            time: data.time || 0,
            user_id: data.user_id || data.sender?.user_id || 0,
            sender: {
                user_id: data.sender?.user_id || data.user_id || 0,
                nickname: data.sender?.nickname || data.nickname || '',
                card: data.sender?.card || '',
                role: data.sender?.role || 'member',
                uid: data.sender?.uid || ''
            },
            group_id: data.group_id || null,
            message: data.message || [],
            raw_message: data.raw_message || '',
            _raw: apiResponse
        }
    },

    /**
     * 从转发消息节点提取消息记录
     * @param {Object} node - 转发节点
     * @returns {Object} 消息记录
     */
    fromForwardNode(node) {
        if (!node) return null
        const data = node.data || node

        return {
            user_id: data.user_id || data.uin || 0,
            nickname: data.nickname || data.nick || '',
            time: data.time || 0,
            message: data.content || data.message || [],
            raw_message: data.raw_message || '',
            // 转发特有
            group_id: data.group_id || null,
            seq: data.seq || 0,
            _node: node
        }
    }
}
