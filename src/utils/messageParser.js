/**
 * 消息解析工具
 * 参考 chatgpt-plugin/utils/message.js 实现
 * 基于 icqq API: https://icqq.pages.dev
 * 
 * 支持:
 * - 引用消息 (e.source / e.getReply)
 * - 合并转发消息 (e.group.getForwardMsg)
 * - 群聊历史 (e.group.getChatHistory)
 * - 完整的消息段类型
 * - 用户身份标签 (sender)
 */

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
            switch (val.type) {
                case 'at':
                    if (handleAtMsg) {
                        const { qq, text: atCard } = val
                        // 如果是@机器人且需要排除，跳过
                        if (excludeAtBot && qq === e.bot?.uin) {
                            continue
                        }
                        text += ` @${atCard || qq} `
                    }
                    break
                
                case 'text':
                    text += val.text || ''
                    break
                
                case 'image':
                    try {
                        const imageData = await fetchImage(val.url)
                        if (imageData) {
                            contents.push({
                                type: 'image',
                                image: imageData.base64,
                                mimeType: imageData.mimeType
                            })
                        }
                    } catch (err) {
                        logger.warn(`[MessageParser] 获取图片失败: ${val.url}`, err.message)
                    }
                    break
                
                case 'face':
                    // 表情转文字描述
                    text += `[表情:${val.id}]`
                    break
                
                case 'file':
                    // 文件信息
                    text += `[文件:${val.name || val.fid}]`
                    break
                
                case 'json':
                    // JSON 卡片消息 - 特别处理合并转发类型
                    try {
                        const jsonData = JSON.parse(val.data)
                        
                        // 检查是否是合并转发消息 (com.tencent.multimsg)
                        if (jsonData.app === 'com.tencent.multimsg' && handleForward) {
                            if (debugInfo) debugInfo.parseSteps.push('解析JSON合并转发消息')
                            try {
                                const resid = jsonData.meta?.detail?.resid
                                if (resid && e.group?.getForwardMsg) {
                                    // 使用 resid 获取转发内容
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
                
                case 'record':
                    // 语音消息
                    text += '[语音消息]'
                    break
                
                case 'video':
                    // 视频消息
                    text += `[视频${val.name ? ':' + val.name : ''}]`
                    break
                
                case 'poke':
                    // 戳一戳
                    text += '[戳一戳]'
                    break
                
                case 'share':
                    // 链接分享
                    text += `[分享:${val.title || val.url || '链接'}]`
                    break
                
                case 'location':
                    // 位置分享
                    text += `[位置:${val.name || val.address || '位置'}]`
                    break
                
                case 'music':
                    // 音乐分享
                    text += `[音乐:${val.title || '音乐'}]`
                    break
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
    
    // 添加调试信息
    if (debugInfo) {
        debugInfo.parseSteps.push('解析完成')
        debugInfo.finalTextLength = contents.filter(c => c.type === 'text').map(c => c.text?.length || 0).reduce((a, b) => a + b, 0)
        debugInfo.finalContentsCount = contents.length
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
            const seq = e.isGroup 
                ? (e.source.seq || e.source.message_id || e.reply_id) 
                : (e.source.time || e.source.seq)
            
            if (seq) {
                // 群聊
                if (e.isGroup || e.group_id) {
                    // 尝试 group.getMsg
                    if (e.group?.getMsg) {
                        try {
                            parseLog.push(`[Reply] 尝试 group.getMsg(${seq})`)
                            replyData = await e.group.getMsg(seq)
                            if (replyData) parseLog.push(`[Reply] group.getMsg 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] group.getMsg 失败: ${err.message}`)
                        }
                    }
                    // 回退: group.getChatHistory
                    if (!replyData && e.group?.getChatHistory) {
                        try {
                            parseLog.push(`[Reply] 尝试 group.getChatHistory(${seq})`)
                            const history = await e.group.getChatHistory(seq, 1)
                            replyData = history?.pop?.() || history?.[0]
                            if (replyData) parseLog.push(`[Reply] group.getChatHistory 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] group.getChatHistory 失败: ${err.message}`)
                        }
                    }
                    // 回退: bot.getMsg (NC)
                    if (!replyData && e.bot?.getMsg) {
                        try {
                            parseLog.push(`[Reply] 尝试 bot.getMsg(${seq})`)
                            replyData = await e.bot.getMsg(seq)
                            if (replyData) parseLog.push(`[Reply] bot.getMsg 成功`)
                        } catch (err) {
                            parseLog.push(`[Reply] bot.getMsg 失败: ${err.message}`)
                        }
                    }
                } 
                // 私聊
                else if (e.friend?.getChatHistory) {
                    try {
                        parseLog.push(`[Reply] 尝试 friend.getChatHistory(${seq})`)
                        const history = await e.friend.getChatHistory(seq, 1)
                        replyData = history?.pop?.() || history?.[0]
                        if (replyData) parseLog.push(`[Reply] friend.getChatHistory 成功`)
                    } catch (err) {
                        parseLog.push(`[Reply] friend.getChatHistory 失败: ${err.message}`)
                    }
                }
                
                if (replyData) {
                    // 兼容 NC 格式
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
            // NC 格式: { type: 'xxx', data: {...} }
            const valData = val.data || val
            const valType = val.type || ''
            
            switch (valType) {
                case 'text':
                    if (handleReplyText) {
                        // NC: valData.text, icqq: val.text
                        replyTextContent += valData.text || val.text || ''
                    }
                    break
                
                case 'image':
                    if (handleReplyImage) {
                        try {
                            // NC: valData.url/file, icqq: val.url
                            const imgUrl = valData.url || valData.file || val.url || val.file
                            if (imgUrl) {
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
                            logger.warn(`[MessageParser] 获取引用图片失败: ${valData.url || val.url}`, err.message)
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
                    const videoUrl = valData.url || valData.file || val.url || val.file || ''
                    const videoName = valData.name || val.name
                    replyTextContent += `[视频${videoName ? ':' + videoName : ''}${videoUrl ? ' URL:' + videoUrl : ''}]`
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
                            }
                        } catch {
                            replyTextContent += '[卡片消息]'
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

        // 构建引用上下文，明确标注发送者身份
        if (replyTextContent) {
            replyTextContent = cleanCQCode(replyTextContent)
            if (isQuotingBot) {
                text = `[用户引用了你(AI助手)之前的回复]\n"${replyTextContent}"\n\n[用户针对上述引用的提问]\n`
            } else {
                text = `[用户引用了${senderLabel}的消息]\n"${replyTextContent}"\n\n[用户的提问]\n`
            }
        }
        
        // 构建引用信息对象
        const quoteInfo = {
            sender: {
                user_id: replySenderId,
                nickname: replySenderName,
                card: replyData?.sender?.card || replyInfo?.sender?.card || '',
                role: replyData?.sender?.role || replyInfo?.sender?.role || 'member'
            },
            content: replyTextContent,
            isBot: isQuotingBot,
            time: replyData?.time || replyInfo?.time,
            seq: replyData?.seq || replyInfo?.seq
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
 */
async function parseForwardMessage(e, forwardElement) {
    const contents = []
    let text = ''
    let forwardInfo = null
    const parseLog = [] // 解析日志

    try {
        // 尝试获取转发消息内容 - 支持多种方式
        let forwardMessages = null
        let parseMethod = ''
        
        parseLog.push(`[Forward] 开始解析转发消息, element keys: ${Object.keys(forwardElement || {}).join(', ')}`)
        if (forwardElement.content && Array.isArray(forwardElement.content)) {
            forwardMessages = forwardElement.content
            parseMethod = 'direct_content'
            parseLog.push(`[Forward] 使用 direct_content 方式, 消息数: ${forwardMessages.length}`)
        }
        else if (forwardElement.data?.content && Array.isArray(forwardElement.data.content)) {
            forwardMessages = forwardElement.data.content
            parseMethod = 'data_content'
            parseLog.push(`[Forward] 使用 data_content 方式, 消息数: ${forwardMessages.length}`)
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

        if (forwardMessages && Array.isArray(forwardMessages)) {
            const forwardTexts = []
            const parsedMessages = []
            
            parseLog.push(`[Forward] 开始解析 ${forwardMessages.length} 条消息, 方法: ${parseMethod}`)
            
            // 最多处理15条转发消息
            for (let i = 0; i < Math.min(forwardMessages.length, 15); i++) {
                const msg = forwardMessages[i]
                
                // NC/NapCat 兼容: 消息可能在 msg 或 msg.data 中
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
                    // NC 格式: val.data.text, icqq 格式: val.text
                    const valData = val.data || val
                    const valType = val.type || ''
                    
                    if (valType === 'text') {
                        const textContent = valData.text || valData || ''
                        if (textContent) {
                            forwardTexts.push(`${nickname}: ${textContent}`)
                            msgInfo.content.push({ type: 'text', text: textContent })
                        }
                    } else if (valType === 'image') {
                        // 图片 URL 兼容多种格式
                        const imgUrl = valData.url || valData.file || val.url || val.file || ''
                        forwardTexts.push(`${nickname}: [图片]`)
                        msgInfo.content.push({ type: 'image', url: imgUrl })
                        if (imgUrl) {
                            contents.push({
                                type: 'image_url',
                                image_url: { url: imgUrl },
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
                        forwardTexts.push(`${nickname}: [嵌套转发消息]`)
                        msgInfo.content.push({ type: 'forward', nested: true })
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
