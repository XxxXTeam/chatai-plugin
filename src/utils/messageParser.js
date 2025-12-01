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

    // 添加文本内容
    const trimmedText = text.trim()
    if (trimmedText) {
        contents.push({
            type: 'text',
            text: trimmedText
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
        let replyMessage = null

        // 获取引用消息
        if (e.getReply && typeof e.getReply === 'function') {
            const reply = await e.getReply()
            replyMessage = reply?.message
        } else {
            // 兼容旧版本
            const seq = e.isGroup 
                ? (e.source?.seq || e.reply_id) 
                : (e.source?.time)
            
            if (seq) {
                if (e.isGroup && e.group?.getChatHistory) {
                    const history = await e.group.getChatHistory(seq, 1)
                    replyMessage = history?.pop()?.message
                } else if (!e.isGroup && e.friend?.getChatHistory) {
                    const history = await e.friend.getChatHistory(seq, 1)
                    replyMessage = history?.pop()?.message
                }
            }
        }

        if (!replyMessage) {
            return { text: '', contents: [] }
        }

        // 解析引用消息内容
        for (const val of replyMessage) {
            switch (val.type) {
                case 'text':
                    if (handleReplyText) {
                        text = `[引用消息]\n${val.text}\n\n[当前消息]\n`
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
                        text = `[引用文件]\n文件名: ${val.name || val.fid}\n下载地址: ${fileUrl || '无法获取'}\n\n[当前消息]\n`
                    }
                    break
                
                case 'forward':
                    if (handleForward) {
                        text = '[引用了一条转发消息]\n\n[当前消息]\n'
                    }
                    break
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
