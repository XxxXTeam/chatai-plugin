/**
 * 消息解析工具
 * 参考 chatgpt-plugin/utils/message.js 实现
 * 支持引用消息、图片、文件、转发消息体等
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
        triggerPrefix = ''
    } = options

    const contents = []
    let text = ''

    // 处理引用消息
    if ((e.source || e.reply_id) && (handleReplyImage || handleReplyText || handleReplyFile)) {
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
                    // JSON 卡片消息
                    try {
                        const jsonData = JSON.parse(val.data)
                        text += `[卡片消息:${jsonData.prompt || jsonData.desc || 'JSON'}]`
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
                        const forwardResult = await parseForwardMessage(e, val)
                        if (forwardResult.text) {
                            text += forwardResult.text
                        }
                        contents.push(...forwardResult.contents)
                    }
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

    return {
        role: 'user',
        content: contents
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
            return { text: '', contents: [] }
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
                        replyTextContent += `[文件: ${val.name || val.fid}]`
                    }
                    break
                
                case 'forward':
                    if (handleForward) {
                        replyTextContent += '[转发消息]'
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
    } catch (err) {
        logger.warn('[MessageParser] 解析引用消息失败:', err.message)
    }

    return { text, contents }
}

/**
 * 解析转发消息
 */
async function parseForwardMessage(e, forwardElement) {
    const contents = []
    let text = ''

    try {
        // 尝试获取转发消息内容
        let forwardMessages = null
        
        if (forwardElement.content) {
            forwardMessages = forwardElement.content
        } else if (forwardElement.id && e.group?.getForwardMsg) {
            forwardMessages = await e.group.getForwardMsg(forwardElement.id)
        }

        if (forwardMessages && Array.isArray(forwardMessages)) {
            const forwardTexts = []
            for (const msg of forwardMessages.slice(0, 10)) { // 最多处理10条
                if (msg.message) {
                    for (const val of msg.message) {
                        if (val.type === 'text') {
                            forwardTexts.push(`${msg.nickname || '未知'}: ${val.text}`)
                        }
                    }
                }
            }
            
            if (forwardTexts.length > 0) {
                text = `[转发消息内容]\n${forwardTexts.join('\n')}\n[转发消息结束]\n`
            }
        } else {
            text = '[转发消息]'
        }
    } catch (err) {
        logger.warn('[MessageParser] 解析转发消息失败:', err.message)
        text = '[转发消息]'
    }

    return { text, contents }
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
