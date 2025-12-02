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
 */
async function parseReplyMessage(e, options) {
    const { handleReplyText, handleReplyImage, handleReplyFile, handleForward } = options
    const contents = []
    let text = ''

    try {
        let replyData = null
        let replySenderId = null
        let replySenderName = null

        // 获取引用消息
        if (e.getReply && typeof e.getReply === 'function') {
            const reply = await e.getReply()
            replyData = reply
            replySenderId = reply?.user_id || reply?.sender?.user_id
            replySenderName = reply?.sender?.card || reply?.sender?.nickname || reply?.nickname
        } else {
            // 兼容旧版本
            const seq = e.isGroup 
                ? (e.source?.seq || e.reply_id) 
                : (e.source?.time)
            
            if (seq) {
                if (e.isGroup && e.group?.getChatHistory) {
                    const history = await e.group.getChatHistory(seq, 1)
                    replyData = history?.pop()
                } else if (!e.isGroup && e.friend?.getChatHistory) {
                    const history = await e.friend.getChatHistory(seq, 1)
                    replyData = history?.pop()
                }
                if (replyData) {
                    replySenderId = replyData.user_id || replyData.sender?.user_id
                    replySenderName = replyData.sender?.card || replyData.sender?.nickname || replyData.nickname
                }
            }
        }

        const replyMessage = replyData?.message
        if (!replyMessage) {
            return { text: '', contents: [], quoteInfo: null }
        }

        // 判断引用的是否是机器人的消息
        const botId = e.bot?.uin || e.self_id
        const isQuotingBot = replySenderId && botId && String(replySenderId) === String(botId)
        const senderLabel = isQuotingBot ? 'AI助手' : (replySenderName || '用户')

        // 解析引用消息内容
        let replyTextContent = ''
        for (const val of replyMessage) {
            switch (val.type) {
                case 'text':
                    if (handleReplyText) {
                        replyTextContent += val.text || ''
                    }
                    break
                
                case 'image':
                    if (handleReplyImage) {
                        try {
                            const imageData = await fetchImage(val.url)
                            if (imageData) {
                                contents.push({
                                    type: 'image',
                                    image: imageData.base64,
                                    mimeType: imageData.mimeType,
                                    source: 'reply'
                                })
                            }
                        } catch (err) {
                            logger.warn(`[MessageParser] 获取引用图片失败: ${val.url}`, err.message)
                        }
                    }
                    break
                
                case 'file':
                    if (handleReplyFile) {
                        let fileUrl = ''
                        try {
                            if (e.group?.getFileUrl) {
                                fileUrl = await e.group.getFileUrl(val.fid)
                            } else if (e.friend?.getFileUrl) {
                                fileUrl = await e.friend.getFileUrl(val.fid)
                            }
                        } catch {}
                        // 包含文件名和URL（如果有）
                        const fileName = val.name || val.fid || '未知文件'
                        replyTextContent += `[文件: ${fileName}${fileUrl ? ' URL:' + fileUrl : ''}]`
                    }
                    break
                
                case 'video':
                    // 视频消息
                    const videoUrl = val.url || val.file || ''
                    replyTextContent += `[视频${val.name ? ':' + val.name : ''}${videoUrl ? ' URL:' + videoUrl : ''}]`
                    break
                
                case 'forward':
                    if (handleForward) {
                        try {
                            const fwdResult = await parseForwardMessage(e, val)
                            if (fwdResult.text) {
                                replyTextContent += fwdResult.text
                            }
                            // 添加转发消息中的图片
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
                    // 检查是否是合并转发消息
                    if (handleForward) {
                        try {
                            const jsonData = JSON.parse(val.data)
                            if (jsonData.app === 'com.tencent.multimsg') {
                                const resid = jsonData.meta?.detail?.resid
                                if (resid && e.group?.getForwardMsg) {
                                    const fwdResult = await parseForwardMessage(e, { id: resid, resid })
                                    if (fwdResult.text) {
                                        replyTextContent += fwdResult.text
                                    }
                                    // 添加转发消息中的图片
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
            }
        }

        // 构建引用上下文，明确标注发送者身份
        if (replyTextContent) {
            // 清理引用内容中的CQ码
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
                card: replyData?.sender?.card || '',
                role: replyData?.sender?.role || 'member'
            },
            content: replyTextContent,
            isBot: isQuotingBot,
            time: replyData?.time,
            seq: replyData?.seq
        }
        
        return { text, contents, quoteInfo }
    } catch (err) {
        logger.warn('[MessageParser] 解析引用消息失败:', err.message)
    }

    return { text, contents, quoteInfo: null }
}

/**
 * 解析转发消息
 */
async function parseForwardMessage(e, forwardElement) {
    const contents = []
    let text = ''
    let forwardInfo = null

    try {
        // 尝试获取转发消息内容 - 支持多种方式
        let forwardMessages = null
        
        // 方式1: 直接包含 content
        if (forwardElement.content) {
            forwardMessages = forwardElement.content
        } 
        // 方式2: 通过 id 获取 (icqq e.group.getForwardMsg)
        else if (forwardElement.id && e.group?.getForwardMsg) {
            forwardMessages = await e.group.getForwardMsg(forwardElement.id)
        }
        // 方式3: 通过 resid 获取 (TRSS)
        else if (forwardElement.resid && e.group?.getForwardMsg) {
            forwardMessages = await e.group.getForwardMsg(forwardElement.resid)
        }

        if (forwardMessages && Array.isArray(forwardMessages)) {
            const forwardTexts = []
            const parsedMessages = []
            
            // 最多处理15条转发消息
            for (const msg of forwardMessages.slice(0, 15)) {
                const msgInfo = {
                    user_id: msg.user_id,
                    nickname: msg.nickname || '未知',
                    time: msg.time,
                    content: []
                }
                
                if (msg.message) {
                    for (const val of msg.message) {
                        if (val.type === 'text') {
                            forwardTexts.push(`${msg.nickname || '未知'}: ${val.text}`)
                            msgInfo.content.push({ type: 'text', text: val.text })
                        } else if (val.type === 'image') {
                            // 图片直接传递给模型解析
                            const imgUrl = val.url || val.file || ''
                            forwardTexts.push(`${msg.nickname || '未知'}: [图片]`)
                            msgInfo.content.push({ type: 'image', url: imgUrl })
                            // 添加到 contents 供模型直接解析
                            if (imgUrl) {
                                contents.push({
                                    type: 'image_url',
                                    image_url: { url: imgUrl },
                                    source: 'forward'  // 标记来源
                                })
                            }
                        } else if (val.type === 'forward') {
                            // 嵌套转发
                            forwardTexts.push(`${msg.nickname || '未知'}: [嵌套转发消息]`)
                            msgInfo.content.push({ type: 'forward', nested: true })
                        }
                    }
                }
                
                parsedMessages.push(msgInfo)
            }
            
            if (forwardTexts.length > 0) {
                text = `[转发消息内容 共${forwardMessages.length}条]\n${forwardTexts.join('\n')}\n[转发消息结束]\n`
            }
            
            // 构建转发信息对象
            forwardInfo = {
                total: forwardMessages.length,
                parsed: parsedMessages.length,
                messages: parsedMessages
            }
        } else {
            text = '[转发消息]'
        }
    } catch (err) {
        logger.warn('[MessageParser] 解析转发消息失败:', err.message)
        text = '[转发消息]'
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
